'use strict';
/*
 * test-upstream-125-step4-panel.js —— 上游 1.2.5 邻接吸纳 / Step 4「面板与 i18n」落地守卫。
 *
 * 覆盖四件事（台账 A4 收尾 / A7 / A8 / A10）：
 *   [A] A7 作业级指标：真跑 measurePathBytes / publicAutoCopyJob（daemon 源码切片），
 *       并真跑 autoCopyJudge.readSessionSizes（临时目录），不是文本匹配。
 *   [B] A7/A8 面板文案：注入**真词典 + 真最长匹配扫描器**，要求
 *       ① 五条分支整句在 en 下零残留中文；② 每个新词条的**生效值**等于预期。
 *       ② 是必须的 —— 词典重复 key 时「后者覆盖前者、位置留在前者」，
 *          光搜源码里有没有那条会漏掉「被 dedupe 丢弃」的情况（本轮真踩过）。
 *   [C] A10 /api/sessions：体积总量口径（**不受时间筛选影响**）。
 *   [D] A10 面板：体积列 / 体积筛选（字节精确）/ 账号总量 tag。
 *   [E] 跨文件一致性：daemon 产出的提示文案必须是 inject 词典里能整句翻译的 key。
 *
 * ⚠️ 本套件不碰真机数据、不起 HTTP 服务、不连 CDP。
 * 跑法：node .wd-analysis/test-upstream-125-step4-panel.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log('\n' + t); }

const DAEMON_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
const INJECT_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');

/** 按大括号配平从源码里切出一个函数（这些函数体内没有含 brace 的字符串/注释）。 */
function sliceFunction(src, name) {
  const head = new RegExp('^[ \\t]*(async )?function ' + name + '\\s*\\(', 'm');
  const m = head.exec(src);
  if (!m) throw new Error('未找到函数 ' + name);
  // ⚠️ 不能直接找 `(` 后面的第一个 `{` —— 形如 `options = {}` 的默认参数会把它顶到参数表里，
  //    切出来的“函数体”只剩签名。先把参数表的括号配平，再找函数体起始大括号。
  const start = m.index;
  let paren = 0;
  let i = m.index + m[0].length - 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') paren += 1;
    else if (src[i] === ')') { paren -= 1; if (paren === 0) { i += 1; break; } }
  }
  let depth = 0;
  i = src.indexOf('{', i);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('函数 ' + name + ' 大括号不配平');
}

/** 从 inject.js 里抽出「词典 + 最长匹配扫描器」，返回 wbsTranslateString。 */
function loadInjectTranslator() {
  const src = INJECT_SRC.split('\n');
  const idxOf = (re, from) => { for (let i = from || 0; i < src.length; i++) if (re.test(src[i])) return i; return -1; };
  const dS = idxOf(/var WBS_I18N_EN = \{/);
  const dE = idxOf(/^\s*\};\s*$/, dS + 1);
  const mS = idxOf(/var wbsI18nMatchers = null;/);
  const mE = idxOf(/function wbsIsBuiltinAutomation/, mS);
  if (dS < 0 || dE <= dS || mS <= 0 || mE <= mS) throw new Error('无法抽出词典/匹配器');
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(dS, dE + 1).join('\n') + '\n' + src.slice(mS, mE).join('\n') + '\nreturn wbsTranslateString;')();
}

const CJK = /[\u4e00-\u9fff]/; // 残留中文
const T = loadInjectTranslator();

// ⚠️ 本文件是 CJS（package.json 无 "type":"module"），顶层 await 不可用 ⇒ 全部包进 main()。
async function main() {

/* ==================================================================== */
section('[A] A7 作业级指标：真跑切片函数');

const autoCopyJudge = require(path.join(ROOT, 'scripts', 'auto-copy-judge.js'));

const measurePathBytes = new Function('fs', 'path',
  sliceFunction(DAEMON_SRC, 'directoryStats') + '\n' +
  sliceFunction(DAEMON_SRC, 'measurePathBytes') + '\nreturn measurePathBytes;')(fs, path);

const publicAutoCopyJob = new Function(
  sliceFunction(DAEMON_SRC, 'publicAutoCopyJob') + '\nreturn publicAutoCopyJob;')();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-a7-'));
fs.writeFileSync(path.join(TMP, 'one.jsonl'), Buffer.alloc(5, 0x61));
ok(measurePathBytes(path.join(TMP, 'one.jsonl')) === 5, 'A1 单文件取 stat.size');

fs.mkdirSync(path.join(TMP, 'nested'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'nested', 'a.bin'), Buffer.alloc(3, 0x62));
fs.writeFileSync(path.join(TMP, 'nested', 'b.bin'), Buffer.alloc(4, 0x63));
ok(measurePathBytes(path.join(TMP, 'nested')) === 7, 'A2 目录递归求和（3+4）');
ok(measurePathBytes(path.join(TMP, 'not-there')) === 0, 'A3 路径不存在 → 0（不抛）');
ok(/if \(stat\.isSymbolicLink\(\)\) return 0;/.test(sliceFunction(DAEMON_SRC, 'measurePathBytes')),
  'A4 符号链接显式跳过 —— 与 directoryStats 同口径，避免把同一份数据算两遍');

const copySessionFilesBlock = sliceFunction(DAEMON_SRC, 'copySessionFiles');
ok(/const result = \{ copied: 0, failed: 0, sourceBytes: 0, copiedBytes: 0, workspacePending: false \};/.test(copySessionFilesBlock),
  'A5 copySessionFiles 增加 sourceBytes / copiedBytes 计数（mtime 路径是整目录 cp，按源体积计）');
ok(/result\.sourceBytes \+= sourceBytes;/.test(copySessionFilesBlock) && /result\.copiedBytes \+= sourceBytes;/.test(copySessionFilesBlock),
  'A6 sourceBytes 在 cp 之前记、copiedBytes 只在 cp 成功后记（失败不算“搬成功”）');

const baseJob = {
  id: 'j1', status: 'running', startedAt: 1000, finishedAt: 3000, updatedAt: 3000,
  total: 4, processed: 2, copied: 1, skipped: 1, partial: 0, failed: 0, conflicts: 0, failedItems: 0,
  copyStartedAt: 1000, copiedBytes: 1000, totalBytes: 9000, warning: '',
};
const proj = publicAutoCopyJob(baseJob);
ok(proj.copiedBytes === 1000 && proj.totalBytes === 9000,
  'A7 copiedBytes / totalBytes 透传', { copiedBytes: proj.copiedBytes, totalBytes: proj.totalBytes });
ok(proj.averageBytesPerSecond === 500,
  'A8 速率 = copiedBytes*1000/搬运耗时（copyStartedAt→finishedAt，不含排队与切号等待）', proj.averageBytesPerSecond);
ok(proj.elapsedMs === 2000 && proj.startedAt === 1000, 'A9 原有 elapsedMs（作业总时长）未被速率口径污染');

const neg = publicAutoCopyJob(Object.assign({}, baseJob, { copiedBytes: -5 }));
ok(neg.copiedBytes === 0 && neg.averageBytesPerSecond === 0,
  'A10 copiedBytes 负数被夹到 0（速率算 0，不出现负速率）', neg.copiedBytes);

const missing = publicAutoCopyJob(Object.assign({}, baseJob, { copiedBytes: undefined, totalBytes: null, copyStartedAt: null }));
ok(missing.copiedBytes === null && missing.totalBytes === null && missing.averageBytesPerSecond === null,
  'A11 缺数一律 null，**不拿 0 冒充**（0 会被面板读成“真的同步了 0 字节”）',
  { c: missing.copiedBytes, t: missing.totalBytes, r: missing.averageBytesPerSecond });

const live = publicAutoCopyJob(Object.assign({}, baseJob, { finishedAt: null }));
ok(typeof live.averageBytesPerSecond === 'number' && live.averageBytesPerSecond >= 0,
  'A12 作业未结束时速率按「现在 - copyStartedAt」现算（跑动中也能看到速率）', live.averageBytesPerSecond);

const warned = publicAutoCopyJob(Object.assign({}, baseJob, { warning: '会话超过 100 MB，同步可能较慢' }));
ok(warned.warning === '会话超过 100 MB，同步可能较慢', 'A13 warning 原样透传（文案由 daemon 定义、inject 入典）');
ok(proj.warning === '', 'A14 无提示时 warning 是空串而不是 undefined（面板按真值判断）');

const largeBytes = /const AUTO_COPY_LARGE_SESSION_BYTES = (\d+) \* 1024 \* 1024;/.exec(DAEMON_SRC);
ok(largeBytes && Number(largeBytes[1]) === 100, 'A15 大会话阈值 100 MB（与上游一致）', largeBytes && largeBytes[1]);
ok(/job\.copiedBytes \+= Math\.max\(0, Number\(result\.copiedBytes\) \|\| 0\);/.test(DAEMON_SRC),
  'A16 循环里累加 copiedBytes（`|| 0` 兜住 undefined，缺字段的实现不会算出 NaN）');
ok(/if \(Number\(item\.bytes \|\| 0\) > AUTO_COPY_LARGE_SESSION_BYTES\) job\.warning = AUTO_COPY_LARGE_WARNING;/.test(DAEMON_SRC),
  'A17 产物阶段同样给提示（本地大会话的体积主要在产物目录）');
ok(/details: Array\.isArray\(job\.details\) \? job\.details\.slice\(0, 500\) : \[\],/.test(sliceFunction(DAEMON_SRC, 'publicAutoCopyJob')),
  'A18 逐项明细仍有 500 条上限（A7 扩字段没有顺手拆掉原有护栏）');

ok(typeof autoCopyJudge.readSessionSizes === 'function',
  'A19 auto-copy-judge 透传 readSessionSizes（daemon 只 require 本模块一处）');
const sizeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-a10-'));
fs.mkdirSync(path.join(sizeRoot, 'projects', 'p1'), { recursive: true });
fs.writeFileSync(path.join(sizeRoot, 'projects', 'p1', 'sess-1.jsonl'), Buffer.alloc(11, 0x64));
fs.writeFileSync(path.join(sizeRoot, 'projects', 'p1', 'sess-1-extra.jsonl'), Buffer.alloc(99, 0x65));
fs.writeFileSync(path.join(sizeRoot, 'projects', 'p1', 'sess-2.jsonl'), Buffer.alloc(7, 0x66));
const sizes = await autoCopyJudge.readSessionSizes(sizeRoot, ['sess-1', 'sess-2', 'ghost']);
ok(sizes.get('sess-1') === 11 && sizes.get('sess-2') === 7,
  'A20 readSessionSizes 只数本会话的文件（前缀相同的 sess-1-extra 不算进来）',
  { s1: sizes.get('sess-1'), s2: sizes.get('sess-2') });

/* ==================================================================== */
section('[B] A7/A8 面板文案：真扫描器下零残留中文');

const CJK_FREE = [
  ['指标-全量', ' · 已同步 4.2 MB / 12.0 GB · 平均复制速率 96 MB/秒 · 会话超过 100 MB，同步可能较慢'],
  ['指标-无分母', ' · 已同步 4.2 MB'],
  ['指标-只有速率', ' · 平均复制速率 1.5 KB/秒'],
  ['指标-只有提示', ' · 会话超过 100 MB，同步可能较慢'],
  ['分支-running/正文', '第 3/22 个 · 共 1.2 GB · 已复制 2 · 跳过 1 · 失败 0 · 已用 12 秒 · 已同步 4.2 MB / 12.0 GB · 平均复制速率 96 MB/秒'],
  ['分支-running/产物', '正文已完成 22/22 · 产物 1/3 · 文件 120/900 · 8.0 MB · 硬链接已省 2.0 MB · 已用 1 分 20 秒 · 已同步 4.2 MB · 平均复制速率 96 MB/秒'],
  ['分支-paused', '正文 22/22 · 产物 1/3 · 已复制 18 · 跳过 4 · 点「继续同步」只搬剩下的 · 已同步 4.2 MB'],
  ['分支-done', '共 22 个 · 已复制 18 · 跳过 4 · 产物 3/3 · 硬链接省 2.0 MB · 用时 1 分 20 秒 · 已同步 4.2 MB / 12.0 GB · 平均复制速率 96 MB/秒'],
  ['分支-partial', '共 22 个 · 已复制 18 · 失败 1 · 产物 3/3 · 用时 12 秒 · 已同步 4.2 MB · 会话超过 100 MB，同步可能较慢'],
  ['标题-正文', '正在复制会话「Proj」'],
  ['标题-产物', '正在搬运产物「Proj」'],
  ['标题-准备中', '正在准备复制计划…'],
  ['标题-暂停', '同步已暂停'],
  ['标题-完成', '会话复制完成'],
  ['标题-部分失败', '复制完成（有失败项）'],
  ['标题-失败', '自动复制失败'],
  ['按钮-暂停', '暂停'],
  ['按钮-继续', '继续同步'],
  ['按钮title-暂停', '暂停同步：停下正在搬运的会话，之后可以「继续同步」接着搬'],
  ['按钮title-继续', '继续同步：只搬运尚未完成的部分（已复制的会话会被跳过）'],
  ['A10 体积筛选标签', '体积'],
  ['A10 账号总量标签', '账号总量 1.2 GB'],
  ['A10 账号总量 title', '账号全部会话的总体积（不受筛选影响）'],
];
for (const [label, zh] of CJK_FREE) {
  const en = T(zh, 'en');
  ok(!CJK.test(en), 'B1 en 下零残留中文：' + label, en);
}

// 生效值表：比对**翻译后**的结果，才能抓到「被重复 key 挤掉」的词条。
const EFFECTIVE = [
  [' · 跳过', ' · Skipped '],
  ['已同步', 'Synced '],
  [' · 已复制', ' · Copied '],
  [' · 失败', ' · Failed '],
  [' · 已用', ' · Elapsed '],
  [' · 用时', ' · Took '],
  ['第', 'No. '],
  [' 个 · 共 ', ' of '],
  ['正文已完成', 'Body done '],
  ['正文', 'Body '],
  [' · 产物 ', ' · Payload '],
  [' · 文件 ', ' · Files '],
  [' · 硬链接已省 ', ' · Hard links saved '],
  [' · 硬链接省 ', ' · Hard links saved '],
  ['正在搬运产物「', 'Moving payload “'],
  ['正在搬运产物「Proj」', 'Moving payload “Proj”'],
  ['正在准备复制计划…', 'Preparing the copy plan…'],
  ['同步已暂停', 'Sync paused'],
  ['会话复制完成', 'Session copy complete'],
  ['复制完成（有失败项）', 'Copy complete (with failures)'],
  ['自动复制失败', 'Auto copy failed'],
  ['任务异常终止', 'Task terminated unexpectedly'],
  ['暂停', 'Pause'],
  ['继续同步', 'Resume sync'],
  ['平均复制速率', 'Average copy rate '],
  ['/秒', '/s '],
  [' 秒', ' seconds '],
  [' 分', ' min '],
  [' 分钟', ' min '],
  ['体积', 'Size'],
  ['账号总量 ', 'Account total '],
];
for (const [input, expected] of EFFECTIVE) {
  const actual = T(input, 'en');
  ok(actual === expected, 'B2 词条生效值：' + JSON.stringify(input), { expected, actual });
}

/* ==================================================================== */
section('[C] A10 /api/sessions：体积与总量口径');

const routeStart = DAEMON_SRC.indexOf("if (req.method === 'GET' && p === '/api/sessions') {");
const routeEnd = DAEMON_SRC.indexOf('// 会话空间列表：GET /api/sessions/workspaces', routeStart);
const route = DAEMON_SRC.slice(routeStart, routeEnd);
ok(routeStart > 0 && routeEnd > routeStart, 'C1 定位到 /api/sessions 路由段');
ok(!/COALESCE\(last_activity_at, updated_at, created_at\) >= \?/.test(route),
  'C2 时间筛选**不写进 SQL**（写进去账号总量就会随筛选缩水）');
const idxSizes = route.indexOf('const sizes = await autoCopyJudge.readSessionSizes(');
const idxRange = route.indexOf('const sessions = rangeMs');
ok(idxSizes > 0 && idxRange > idxSizes,
  'C3 先量全量体积、算完总量，再在内存里过时间筛（顺序反了总量就只覆盖可见行）');
ok(/const totalBytes = allSessions\.every\(/.test(route) && /: allSessions;/.test(route),
  'C4 总量按 allSessions 求和；任一行读不出体积（null）就整体给 null');
ok(/^\s+totalBytes,$/m.test(route), 'C5 响应体带 totalBytes');
ok(/allSessions\.forEach\(\(row\) => \{ row\.totalBytes = sizes\.get\(String\(row\.id\)\); \}\);/.test(route),
  'C6 每行带自己的 totalBytes（面板体积列直接用）');

/* ==================================================================== */
section('[D] A10 面板：体积列 / 筛选 / 账号总量');

ok(/'<div class="wbs-sess-filter-row"><span class="wbs-sess-flabel">体积<\/span><div class="wbs-sess-seg" id="wbs-sess-size-seg">'/.test(INJECT_SRC),
  'D1 面板多了一行「体积」Segment（与「账号 / 时间」同一套结构）');
for (const [label, bytes] of [['全部', 0], ['≥10 MB', 10485760], ['≥100 MB', 104857600], ['≥1 GB', 1073741824]]) {
  ok(new RegExp('data-size="' + bytes + '">' + label + '</button>').test(INJECT_SRC),
    'D2 阈值字节精确：' + label + ' = ' + bytes);
}

const makeSessSizeFiltered = new Function('sessionsState',
  sliceFunction(INJECT_SRC, 'sessSizeFiltered') + '\nreturn sessSizeFiltered;');
// 工厂只负责把 sessionsState 绑进闭包，真正要调的是它返回的内层函数。
const runSizeFilter = (minBytes, all) => makeSessSizeFiltered({ minBytes: minBytes, all: all })();
const rows = [
  { id: 'a', totalBytes: 50 },
  { id: 'b', totalBytes: 5000 },
  { id: 'c', totalBytes: null },
  { id: 'd' },
];
let derived = runSizeFilter(0, rows);
ok(derived.length === 4 && derived[0].id === 'a', 'D3 minBytes=0 ⇒ 不过滤（「全部」与旧行为一致）');
derived = runSizeFilter(100, rows);
ok(derived.length === 1 && derived[0].id === 'b', 'D4 阈值筛选只留 >= 阈值的行', derived.map((r) => r.id));
ok(!derived.some((r) => r.id === 'c' || r.id === 'd'),
  'D5 体积读不出来的行（null / 缺字段）在筛选下被排除 —— 不按 0 混进「小于阈值」的错觉里');
ok(rows.length === 4, 'D6 派生不改动原数组（sessionsState.all 保持全量，总量才不跟着筛）');

// 同上：工厂把 fmtHumanTime / fmtBytes 绑进闭包，返回的内层函数才是被测对象。
const makeSessMetaText = new Function('fmtHumanTime', 'fmtBytes',
  sliceFunction(INJECT_SRC, 'sessMetaText') + '\nreturn sessMetaText;');
const fmtBytesStub = (v) => v + ' B';
const sessMetaText = makeSessMetaText(() => '12:00', fmtBytesStub);
ok(sessMetaText({ last_activity_at: 1, totalBytes: 2048 }) === '12:00 · 2048 B',
  'D7 行内「时间 · 体积」拼接');
ok(sessMetaText({ last_activity_at: 1, totalBytes: null }) === '12:00',
  'D8 体积读不出来时只显示时间（不写 0 B 冒充）');

ok(/var sessTotalBytes = sessionsState\.totalBytes;/.test(INJECT_SRC) && /账号总量 ' \+ fmtBytes\(sessTotalBytes\)/.test(INJECT_SRC),
  'D9 账号总量取自 sessionsState.totalBytes（全量口径），不是当前可见列表');
ok(/title="账号全部会话的总体积（不受筛选影响）"/.test(INJECT_SRC),
  'D10 面板显式标注总量口径（否则会被读成“当前列表的体积”）');
ok(/var sessionsState = \{ uid: undefined, currentUid: '', range: 'all', minBytes: 0, all: \[\], totalBytes: null, list: \[\],/.test(INJECT_SRC),
  'D11 sessionsState 新增 all / totalBytes / minBytes');
ok(/sessionsState\.all = \(\(d && d\.sessions\) \|\| \[\]\);/.test(INJECT_SRC)
  && /sessionsState\.list = sessSizeFiltered\(\);/.test(INJECT_SRC),
  'D12 取数后 all 存全量、list 由体积筛选派生（换阈值不再打接口）');

/* ==================================================================== */
section('[E] 跨文件一致性');

const warnKey = /const AUTO_COPY_LARGE_WARNING = '([^']+)';/.exec(DAEMON_SRC);
const dictHasWarn = warnKey && new RegExp("'" + warnKey[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "':").test(INJECT_SRC);
ok(dictHasWarn, 'E1 daemon 产出的大会话提示必须能在 inject 词典里整句翻译（否则英文界面里冒出中文）', warnKey && warnKey[1]);
ok(warnKey && T(warnKey[1], 'en') === 'Session exceeds 100 MB; syncing may take longer',
  'E2 该提示的英文译文不残留中文', warnKey && T(warnKey[1], 'en'));
ok(indexOfOnce(INJECT_SRC, "if (els.sub) els.sub.textContent = sub + metric;"),
  'E3 指标后缀在**唯一的** els.sub 赋值处拼接（五条分支一处不漏、也不重复拼）');

console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
if (failures.length) { failures.forEach((f) => console.log('  未通过: ' + f)); process.exit(1); }

}

function indexOfOnce(text, needle) {
  const first = text.indexOf(needle);
  return first >= 0 && text.indexOf(needle, first + 1) === -1;
}

main().catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
