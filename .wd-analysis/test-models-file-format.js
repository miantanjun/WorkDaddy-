#!/usr/bin/env node
/**
 * models.json 形态守卫（2026-10-23）
 *
 * 故障现场：CodeBuddy 面板点「从 WorkBuddy 导入」→ 提示导入成功，但客户端的模型
 * 下拉里一个都没有（面板显示「已导入 0 个模型」）。文件确实被写了，但写成了**裸数组**。
 *
 * 根因（读客户端源码定位，非猜测）：
 *   D:\CodeBuddy CN\resources\app\out\main.js
 *     loadLocalCustomModelsFile()      → JSON.parse + `typeof n != "object"` 检查
 *                                        （数组也是 object ⇒ 裸数组能过这一关）
 *     buildLocalCustomModelsResponse() → 只读 `e.models`
 *     ⇒ 裸数组 ⇒ models 解析成 [] ⇒ 客户端 0 条。
 *   WorkBuddy 那边正好相反，models.json 就是裸数组。
 *
 * 修法：lib.js 按「这个文件属于哪个 profile」决定读写形态
 *   （modelsFilePrefersObject / buildModelsFileDoc / normalizeModelsFileFormat），
 *   daemon 启动时对历史裸数组文件做一次幂等迁移；网关注册 / 上下文调节两条直写路径
 *   也统一走 buildModelsFileDoc。
 *
 * ⚠️ availableModels 是 CodeBuddy 的**可见性白名单**，缺失或空数组时它不过滤
 *    （AvailableModelsFilterProvider.provide() 直接 return {}）。所以绝不能凭空创建
 *    这个键 —— 一创建就得长期维护，漏加一个 id 就表现为「模型注册了但不出现」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'lib.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// 必须先归一化行尾：JS 的 `.` 不匹配 \r。
function codeOnly(raw) {
  return raw.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const LIB_RAW = read('scripts/lib.js');
const DAEMON_RAW = read('scripts/daemon.js');
const libCode = codeOnly(LIB_RAW);
const daemonCode = codeOnly(DAEMON_RAW);
// ⚠️ codeOnly 的块注释剥离是 `/* ... *​/` 非贪婪匹配，而 daemon.js 第 16537 行有一句
//    纯文字注释「与其它 /api/* 同一条」，其中的 `/api/*` 会被误判成注释开头，
//    一路吞到 17083 行的 `*/` —— 中间 500 多行代码在 codeOnly 里**整体消失**。
//    ⇒ 断言网关注册那一段必须用原始文本（只归一化行尾），不能走 codeOnly。
const daemonFlat = DAEMON_RAW.replace(/\r\n/g, '\n');

console.log('\n=== A. lib.js：按 profile 决定 models.json 形态 ===');

ok('A1 定义了 modelsFilePrefersObject',
  /function\s+modelsFilePrefersObject\s*\(\s*file\s*\)/.test(libCode));

ok('A2 判据同时要求 kind===\'codebuddy\' 与「是本 profile 的 modelsFile」',
  /return\s+ACTIVE_PROFILE\.kind\s*===\s*'codebuddy'\s*&&\s*samePath\(file,\s*workbuddyModelsFile\(\)\)/.test(libCode));

ok('A3 modelsFilePrefersObject 有 try/catch 兜底（不能让读模型页崩）',
  /function\s+modelsFilePrefersObject\s*\([^)]*\)\s*\{\s*\n\s*try\s*\{[\s\S]{0,220}?\}\s*catch\s*\(_\)\s*\{\s*\n\s*return\s+false;/.test(libCode));

ok('A4 定义了 buildModelsFileDoc(file, wrapper, models)',
  /function\s+buildModelsFileDoc\s*\(\s*file,\s*wrapper,\s*models\s*\)/.test(libCode));

ok('A5 非 CodeBuddy 且原文件为数组 ⇒ 仍输出裸数组（不误伤 WorkBuddy）',
  /if\s*\(!base\s*&&\s*!modelsFilePrefersObject\(file\)\)\s*return\s+list;/.test(libCode));

ok('A6 availableModels 只在原文件已有非空白名单时并集补入（绝不凭空创建）',
  /const\s+previous\s*=\s*base\s*&&\s*Array\.isArray\(base\.availableModels\)[\s\S]{0,400}?if\s*\(previous\.length\)\s*\{[\s\S]{0,240}?output\.availableModels\s*=\s*Array\.from\(new\s+Set\(previous\.concat\(ids\)\)\)/.test(libCode));

ok('A7 定义 normalizeModelsFileFormat 且幂等（已是对象直接返回 already-object）',
  /function\s+normalizeModelsFileFormat\s*\([^)]*\)[\s\S]{0,400}?if\s*\(!Array\.isArray\(parsed\)\)\s*return\s*\{\s*migrated:\s*false,\s*reason:\s*'already-object'/.test(libCode));

ok('A8 迁移前先备份（.bak-array- 时间戳）',
  /\.bak-array-\$\{new\s+Date\(\)\.toISOString\(\)\.replace\(\/\[:\.\]\/g,\s*'-'\)\}/.test(libCode));

ok('A9 迁移只改外层形态：以对象形态回写原数组内容',
  /writeModelsFile\(\{\s*file,\s*format:\s*'object',\s*models:\s*parsed,\s*wrapper:\s*\{\}\s*\},\s*parsed\)/.test(libCode));

ok('A10 readModelsFile 对不存在的文件按 wantObject 初始化（不再硬编码 array）',
  /const\s+wantObject\s*=\s*modelsFilePrefersObject\(file\);[\s\S]{0,300}?if\s*\(!fs\.existsSync\(file\)\)\s*\{\s*\n\s*return\s+wantObject/.test(libCode));

ok('A11 readModelsFile 读到裸数组时，CodeBuddy 侧按对象形态交出',
  /if\s*\(Array\.isArray\(parsed\)\)\s*\{[\s\S]{0,400}?if\s*\(wantObject\)\s*return\s*\{\s*file,\s*format:\s*'object',\s*models:\s*parsed,\s*wrapper:\s*\{\}\s*\};/.test(libCode));

ok('A12 writeModelsFile 统一走 buildModelsFileDoc',
  /function\s+writeModelsFile\s*\(parsed,\s*models\)\s*\{\s*\n\s*const\s+output\s*=\s*buildModelsFileDoc\(parsed\.file,\s*parsed\.format\s*===\s*'object'\s*\?\s*parsed\.wrapper\s*:\s*null,\s*models\);/.test(libCode));

ok('A13 lib.js 导出 buildModelsFileDoc',
  /^\s{2}buildModelsFileDoc,/m.test(libCode));

ok('A14 lib.js 导出 normalizeModelsFileFormat',
  /^\s{2}normalizeModelsFileFormat,/m.test(libCode));

// 用户就是被这句话带偏的：明明 6 条全都已在列表里，提示却说「已导入 0 个模型」，
// 看起来像失败，于是去查「为什么客户端看不到」。
const INJECT_RAW = read('scripts/inject.js');
const injectFlat = INJECT_RAW.replace(/\r\n/g, '\n');

ok('A15 inject.js：0 新增但全是同名时改说「都已经在列表里了」',
  /if\s*\(!imported\s*&&\s*skipped\)\s*toast\('这 '\s*\+\s*skipped\s*\+\s*' 个模型都已经在列表里了/.test(injectFlat));

ok('A16 inject.js：有新增时仍报「已导入 N 个（跳过 M 个）」',
  /else\s+toast\('已导入 '\s*\+\s*imported\s*\+\s*' 个模型'/.test(injectFlat));

console.log('\n=== B. daemon.js：三条写入路径 + 启动迁移 ===');

ok('B1 daemon 从 lib.js 引入 buildModelsFileDoc / normalizeModelsFileFormat',
  /^\s{2}buildModelsFileDoc,/m.test(daemonCode) && /^\s{2}normalizeModelsFileFormat,/m.test(daemonCode));

ok('B2 register-models 用 buildModelsFileDoc 写盘',
  /const\s+next\s*=\s*buildModelsFileDoc\(modelsFile,\s*doc\.isArray\s*\?\s*null\s*:\s*doc\.parsed,\s*result\.models\);/.test(daemonFlat));

ok('B3 register-models 不再有「数组就写数组」的旧分支',
  !/const\s+next\s*=\s*doc\.isArray\s*\?\s*result\.models\s*:/.test(daemonFlat));

ok('B4 set-model-context 用 buildModelsFileDoc 写盘',
  /const\s+out\s*=\s*buildModelsFileDoc\(modelsFile,\s*doc\.isArray\s*\?\s*null\s*:\s*doc\.parsed,\s*doc\.list\);/.test(daemonFlat));

ok('B5 启动迁移排在 acquireDaemonLock 之后（只有真 daemon 会搬）',
  daemonCode.indexOf('normalizeModelsFileFormat(workbuddyModelsFile())') > daemonCode.indexOf('if (!acquireDaemonLock()) process.exit(0);'));

ok('B6 启动迁移包了 try/catch，失败只记日志不影响启动',
  /try\s*\{\s*\n\s*const\s+formatFix\s*=\s*normalizeModelsFileFormat\(workbuddyModelsFile\(\)\);\s*\n[\s\S]{0,300}?\}\s*catch\s*\(error\)\s*\{\s*\n\s*log\('\[models\] models\.json 形态迁移失败/.test(daemonCode));

console.log('\n=== C. 真跑（隔离 HOME，不动真实配置） ===');

// 子进程里把 USERPROFILE / HOME 指到临时目录 => workbuddyModelsFile() 落在沙箱内。
// ⚠️ spawn 建 stdin 管道会 EBUSY，一律 stdio:['ignore','pipe','pipe']。
const CHILD = `
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require(${JSON.stringify(LIB)});
const home = os.homedir();
const target = lib.workbuddyModelsFile();
const srcFile = path.join(home, 'import-source', 'models.json');
const out = { home, target };
out.buildNull = lib.buildModelsFileDoc(target, null, [{ id: 'a' }]);
out.buildEmptyList = lib.buildModelsFileDoc(target, { availableModels: [] }, [{ id: 'a' }]);
out.buildMerge = lib.buildModelsFileDoc(target, { availableModels: ['zzz'] }, [{ id: 'a' }, { id: 'b' }]);
fs.mkdirSync(path.dirname(target), { recursive: true });
try { fs.unlinkSync(target); } catch (_) {}
const imp1 = lib.importModels(target, srcFile);
out.import1 = { imported: imp1.imported, skipped: imp1.skipped };
const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
out.afterImport = {
  isArray: Array.isArray(doc),
  keys: Object.keys(doc),
  count: (Array.isArray(doc) ? doc : doc.models).length,
  availableModels: Array.isArray(doc) ? null : doc.availableModels,
};
const imp2 = lib.importModels(target, srcFile);
out.import2 = { imported: imp2.imported, skipped: imp2.skipped };
out.formatAfter = lib.readModelsFile(target).format;
fs.writeFileSync(target, JSON.stringify((Array.isArray(doc) ? doc : doc.models), null, 2) + '\\n', 'utf8');
out.normalize = lib.normalizeModelsFileFormat(target);
const after = JSON.parse(fs.readFileSync(target, 'utf8'));
out.afterNormalize = { isArray: Array.isArray(after), count: (Array.isArray(after) ? after : after.models).length };
console.log(JSON.stringify(out));
`;

function runChild(profileId) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-models-' + profileId + '-'));
  fs.mkdirSync(path.join(home, 'import-source'), { recursive: true });
  fs.writeFileSync(path.join(home, 'import-source', 'models.json'), JSON.stringify([
    { id: 'a', name: 'a', vendor: 'Custom', url: 'http://127.0.0.1:1/v1/chat/completions', apiKey: 'k1' },
    { id: 'b', name: 'b', vendor: 'Custom', url: 'http://127.0.0.1:1/v1/chat/completions', apiKey: 'k2' },
  ], null, 2) + '\n', 'utf8');
  const env = Object.assign({}, process.env, {
    WBSWITCH_PROFILE: profileId,
    USERPROFILE: home,
    HOME: home,
    HOMEDRIVE: path.parse(home).root.replace(/\\$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - 1),
  });
  const raw = execFileSync(process.execPath, ['-e', CHILD], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  });
  return { home, data: JSON.parse(raw.trim()) };
}

let cb = null;
let wb = null;
let childError = null;
try {
  cb = runChild('codebuddy-cn');
  wb = runChild('workbuddy-cn');
} catch (e) {
  childError = e.message;
}

ok('C0 子进程跑通（沙箱 HOME 生效）', !childError && cb && wb, childError);

if (cb && wb) {
  ok('C1 codebuddy：HOME 被指到沙箱、modelsFile 在沙箱内',
    cb.data.target.toLowerCase().indexOf(cb.home.toLowerCase()) === 0,
    cb.data.target);

  ok('C2 codebuddy：原文件不存在时 buildModelsFileDoc 仍输出对象（不是数组）',
    Array.isArray(cb.data.buildNull) === false
      && JSON.stringify(cb.data.buildNull.models) === '[{"id":"a"}]',
    JSON.stringify(cb.data.buildNull));

  ok('C3 codebuddy：不凭空创建 availableModels（缺失就保持缺失）',
    cb.data.buildNull && cb.data.buildNull.availableModels === undefined,
    JSON.stringify(cb.data.buildNull && cb.data.buildNull.availableModels));

  ok('C4 codebuddy：原有空 white lista 保持空数组（语义=不过滤），不被填成全部 id',
    cb.data.buildEmptyList && Array.isArray(cb.data.buildEmptyList.availableModels) && cb.data.buildEmptyList.availableModels.length === 0,
    JSON.stringify(cb.data.buildEmptyList && cb.data.buildEmptyList.availableModels));

  ok('C5 codebuddy：已有非空白名单时做并集补入（新导入的 id 不丢）',
    cb.data.buildMerge && JSON.stringify(cb.data.buildMerge.availableModels) === '["zzz","a","b"]',
    JSON.stringify(cb.data.buildMerge && cb.data.buildMerge.availableModels));

  ok('C6 codebuddy：importModels 落盘成对象结构且不带 availableModels',
    cb.data.afterImport && cb.data.afterImport.isArray === false
      && JSON.stringify(cb.data.afterImport.keys) === '["models"]'
      && cb.data.afterImport.availableModels === undefined,
    JSON.stringify(cb.data.afterImport));

  ok('C7 codebuddy：导入结果是 2 条（不是 0）',
    cb.data.import1 && cb.data.import1.imported.length === 2 && cb.data.afterImport.count === 2,
    JSON.stringify(cb.data.import1));

  ok('C8 codebuddy：重复导入幂等（0 新增 / 2 跳过）',
    cb.data.import2 && cb.data.import2.imported.length === 0 && cb.data.import2.skipped.length === 2,
    JSON.stringify(cb.data.import2));

  ok('C9 codebuddy：readModelsFile 对迁移后文件报 format=object',
    cb.data.formatAfter === 'object', cb.data.formatAfter);

  ok('C10 codebuddy：normalizeModelsFileFormat 把裸数组搬成对象并留备份',
    cb.data.normalize && cb.data.normalize.migrated === true
      && typeof cb.data.normalize.backup === 'string' && cb.data.normalize.backup.indexOf('.bak-array-') > 0
      && cb.data.afterNormalize && cb.data.afterNormalize.isArray === false && cb.data.afterNormalize.count === 2,
    JSON.stringify(cb.data.normalize));

  ok('C11 workbuddy：同样的调用仍输出裸数组（不误伤主力端）',
    Array.isArray(wb.data.buildNull) && wb.data.buildNull.length === 1,
    JSON.stringify(wb.data.buildNull));

  ok('C12 workbuddy：importModels 落盘仍是裸数组',
    wb.data.afterImport && wb.data.afterImport.isArray === true && wb.data.afterImport.count === 2,
    JSON.stringify(wb.data.afterImport));

  ok('C13 workbuddy：readModelsFile 报 format=array',
    wb.data.formatAfter === 'array', wb.data.formatAfter);

  ok('C14 workbuddy：normalizeModelsFileFormat 直接跳过（not-object-format）',
    wb.data.normalize && wb.data.normalize.migrated === false && wb.data.normalize.reason === 'not-object-format'
      && wb.data.afterNormalize.isArray === true,
    JSON.stringify(wb.data.normalize));
}

console.log('\n=== D. 行尾纪律与语法 ===');
function crlfOnly(rel, raw) {
  const lf = (raw.match(/\r?\n/g) || []).length;
  const crlf = (raw.match(/\r\n/g) || []).length;
  ok(`${rel} 纯 CRLF（${crlf}/${lf}）`, crlf === lf && lf > 0);
}
crlfOnly('scripts/lib.js', LIB_RAW);
crlfOnly('scripts/daemon.js', DAEMON_RAW);
crlfOnly('scripts/inject.js', INJECT_RAW);

for (const rel of ['scripts/lib.js', 'scripts/daemon.js', 'scripts/inject.js']) {
  let err = null;
  try { new vm.Script(read(rel)); } catch (e) { err = e.message; }
  ok(`${rel} 语法编译通过`, !err, err);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
