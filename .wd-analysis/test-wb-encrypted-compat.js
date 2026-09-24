'use strict';
/*
 * test-wb-encrypted-compat.js —— WorkBuddy 5.6+ `$wbEncrypted` 字段信封适配层（批次 6 · 阶段一）的守卫。
 *
 * 背景（见 WorkDaddy-上游1.2.6吸纳报告 §3 A6 / §4 批次 6）：
 *   WorkBuddy 5.6 起对 workbuddy.cn 域账号启用 at-rest 字段级加密（编译期策略、无用户开关），
 *   auth/account 文件里的 nickname / phoneNumber / accessToken 等变成
 *   {"$wbEncrypted":1,"envelope":"<base64(JSON)>"} 信封（内层 AES-256-GCM）。
 *   不做读取端解密 ⇒ 客户端一升级就取不到明文 token ⇒ 切号 / 自动化 / 账号列表整条链断。
 *
 * ⚠️ 本套件的**核心立场**：本机客户端目前是 **5.5.6.0**（未到 5.6 ⇒ 磁盘上没有信封），
 *   所以「层已落地」必须是**可证明的零行为变化**。任何拿不出「明文路径逐字节不变」证据的改动
 *   都不该进这一批。据此本套件最重要的一组断言是 [B]（明文不变）与 [D]/[E]（明文不许被写盘）。
 *
 * 本套件守六件事：
 *   [A] 层落地位置、导出面、落地纪律（CRLF）与「唯一的取钥/写盘入口」
 *   [B] **5.5.6 明文路径零行为变化**（逐例与旧表达式等价；有意偏差显式登记）
 *   [C] 信封 + 取钥不可用时的 fail-safe（保留原值、不抛错、不返回 [object Object]、留痕、不重复取钥）
 *   [D] 安全不变量（源码级）：解密只用于校验、密文原样备份、明文不入盘
 *   [E] 行为实测：backupAuthFile 对**明文源**与**信封源**都逐字节原样
 *   [F] 阶段边界账本：lib 层已就绪 / daemon 层**未接线**（含危险点登记），防「假装做完了」
 *
 * 跑法：node .wd-analysis/test-wb-encrypted-compat.js
 * ⚠️ 全程把 WORKDADDY_WB_EXE 指向不存在的文件 ⇒ 取钥必然失败，**绝不会 spawn 真的 WorkBuddy.exe**；
 *    并把 fs.appendFileSync 打桩 ⇒ **不会污染真机 daemon.log**。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB_FILE = path.join(ROOT, 'scripts', 'lib.js');
const DAEMON_FILE = path.join(ROOT, 'scripts', 'daemon.js');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

/* ---- 安全护栏：绝不 spawn 真客户端、绝不写真机 daemon.log ---- */
process.env.WORKDADDY_WB_EXE = path.join(os.tmpdir(), 'wd-no-such-workbuddy-exe-' + process.pid + '.exe');
process.env.WBSWITCH_PROFILE = process.env.WBSWITCH_PROFILE || 'workbuddy-cn';
const logLines = [];
const realAppend = fs.appendFileSync;
fs.appendFileSync = function patched(file, data, ...rest) {
  if (String(file).includes('daemon.log')) { logLines.push(String(data).trim()); return; }
  return realAppend.call(fs, file, data, ...rest);
};

const LIB_SRC = fs.readFileSync(LIB_FILE, 'utf8');
const lib = require(LIB_FILE);

/* ==================================================================== */
section('[A] 层落地位置、导出面与落地纪律');
/* ==================================================================== */

const HEAD = '// ===================== [wd-compat] WorkBuddy 5.6+ $wbEncrypted 字段信封解密适配';
const TAIL = '// ===================== [wd-compat] 适配层结束';
ok(LIB_SRC.split(HEAD).length - 1 === 1, 'A1 [wd-compat] 区块头标记出现恰好 1 次');
ok(LIB_SRC.split(TAIL).length - 1 === 1, 'A2 [wd-compat] 区块尾标记出现恰好 1 次');

const headAt = LIB_SRC.indexOf(HEAD);
const tailAt = LIB_SRC.indexOf(TAIL);
const legacyAt = LIB_SRC.indexOf('const LEGACY_DATA_DIR');
const samePathAt = LIB_SRC.indexOf('function samePath(');
ok(headAt > legacyAt && headAt < samePathAt,
  'A3 区块位置正确：在 LEGACY_DATA_DIR 之后、samePath 之前（与上游同位，便于日后 diff）');
const BLOCK = LIB_SRC.slice(headAt, tailAt);

const EXPORTS = ['isWbEncryptedEnvelope', 'wdCompatExeCandidates', 'wdCompatContainsEncryptedFields',
  'wdCompatText', 'wdCompatAuthToken', 'wdCompatHasAuthCredential', 'normalizeAccountImportJson',
  'wdCompatDecryptAuthJson'];
const missing = EXPORTS.filter((n) => typeof lib[n] !== 'function');
ok(missing.length === 0, 'A4 8 个 wd-compat 函数全部导出可调用', missing);
ok(typeof lib.backupAuthFile === 'function', 'A5 backupAuthFile 已导出（密文原样备份的入口）');

const raw = fs.readFileSync(LIB_FILE);
const latin = raw.toString('latin1');
const crlf = (latin.match(/\r\n/g) || []).length;
const totalN = (latin.match(/\n/g) || []).length;
ok(crlf > 0 && totalN - crlf === 0, 'A6 lib.js 纯 CRLF（裸 LF 必须为 0）', { crlf, bareLf: totalN - crlf });

ok(!BLOCK.includes('writeFileSync') && !BLOCK.includes('JSON.stringify'),
  'A7 区块内**没有**写盘/序列化调用 ⇒ 适配层自身不产生任何「明文落盘」路径');
ok((BLOCK.split('spawnSync').length - 1) === 1 && (BLOCK.split("_linkedBinding").length - 1) === 1,
  'A8 取钥入口唯一（恰 1 处 spawnSync + 1 处 _linkedBinding）');
ok(BLOCK.includes("ELECTRON_RUN_AS_NODE: '1'") && BLOCK.includes('WD_COMPAT_KEY '),
  'A9 取钥走 ELECTRON_RUN_AS_NODE=1，且只经 stdout 回传 WD_COMPAT_KEY <base64>（不落盘、不进日志）');

/* ==================================================================== */
section('[B] 5.5.6 明文路径：必须是零行为变化');
/* ==================================================================== */

const isEnv = lib.isWbEncryptedEnvelope;
ok([null, undefined, 'str', 123, true, [], {}].every((v) => isEnv(v) === false),
  'B1 非信封值（null/字符串/数字/布尔/数组/空对象）一律判 false');
const ENV_SAMPLE = {
  $wbEncrypted: 1,
  envelope: Buffer.from(JSON.stringify({ suite: 1, keyId: 'k1', nonce: 'AAAA', authTag: 'AAAA', ciphertext: 'AAAA' })).toString('base64'),
};
ok(isEnv(ENV_SAMPLE) === true, 'B2 真信封（$wbEncrypted===1 且 envelope 是 base64 字符串）判 true');
ok(isEnv({ $wbEncrypted: true, envelope: 'x' }) === false
  && isEnv({ $wbEncrypted: 1, envelope: 42 }) === false
  && isEnv({ envelope: 'x' }) === false,
  'B3 近似形状不误判（===1 严格判定 + envelope 必须是字符串 + 缺字段即否）');

const contains = lib.wdCompatContainsEncryptedFields;
ok(contains({ a: { b: [1, 2, { c: 'plain' }] } }) === false, 'B4 纯明文（含嵌套数组）判 false');
ok(contains({ a: [1, { b: ENV_SAMPLE }] }) === true, 'B5 嵌套数组里的信封也能找到（递归覆盖数组）');
ok(contains('plain') === false && contains(null) === false, 'B6 非对象入参不抛错、判 false');

const PLAIN_JSON = {
  account: { uid: 'u-1', nickname: '明文明文', uin: 7, phoneNumber: '138', lastLogin: true },
  auth: { accessToken: 'plain-token-abc', domain: 'https://www.workbuddy.cn', lastRefreshTime: 9 },
};
const before = JSON.stringify(PLAIN_JSON);
const decrypted = lib.wdCompatDecryptAuthJson(PLAIN_JSON);
ok(JSON.stringify(decrypted) === before,
  'B7 ⭐ wdCompatDecryptAuthJson 对**无信封**的 JSON 逐字段不变（5.5.6 的真机形态）');
ok(decrypted === PLAIN_JSON, 'B8 且返回同一引用（不克隆 ⇒ 不引入身份/引用语义漂移）');

ok(lib.wdCompatText('昵称') === '昵称', 'B9 wdCompatText：字符串原样返回');
ok(lib.wdCompatText(undefined) === '' && lib.wdCompatText(null) === '' && lib.wdCompatText(123) === '',
  'B10 wdCompatText：缺失/非字符串非信封 → 空串（旧表达式对 number 会返回数字，见 B13 登记）');

// 与**旧表达式**逐例对照
const oldToken = (auth) => String((auth && auth.accessToken) || (auth && auth.access_token) || (auth && auth.token) || '');
const TOKEN_CASES = [
  { accessToken: 'abc' }, { access_token: 'def' }, { token: 'ghi' }, {},
  { accessToken: null, access_token: 'x' }, { accessToken: undefined, token: 'y' },
];
ok(TOKEN_CASES.every((c) => lib.wdCompatAuthToken(c) === oldToken(c)),
  'B11 ⭐ wdCompatAuthToken 对普通明文 token 与旧表达式**逐例等价**（这 6 例覆盖真机常见形态）');

ok(lib.wdCompatHasAuthCredential({ accessToken: 'abc' }) === true
  && lib.wdCompatHasAuthCredential({ accessToken: '' }) === false
  && lib.wdCompatHasAuthCredential({}) === false
  && lib.wdCompatHasAuthCredential(null) === false,
  'B12 wdCompatHasAuthCredential：有明文 token ⇒ true；空/缺 ⇒ false');

// ⚠️ 有意偏差，显式登记（不藏）
ok(lib.wdCompatAuthToken({ accessToken: '  t  ' }) === 't' && oldToken({ accessToken: '  t  ' }) === '  t  ',
  'B13 ⚠️ 已登记偏差①：带空白的 token 现在会被 trim（旧表达式保留原样）—— 对 HTTP 头更正确，无实际影响');
ok(lib.wdCompatAuthToken({ accessToken: '' , access_token: 'real' }) === ''
  && oldToken({ accessToken: '', access_token: 'real' }) === 'real',
  'B14 ⚠️ 已登记偏差②：accessToken 为空串时不再回落 access_token（`??` 语义）。'
  + '真机上 auth 文件不会把 accessToken 写成空串；若日后出现「账号突然凭据不可用」，优先查此处');
ok(lib.wdCompatText(123) === '' && oldToken({ accessToken: 123 }) === '123',
  'B15 ⚠️ 已登记偏差③：非字符串 token 现在返回空串（旧表达式会 Stringify）。'
  + '登录响应里 token 恒为字符串，实际不触发');

/* ==================================================================== */
section('[C] 信封 + 取钥不可用：fail-safe（不抛错、不污染、不返回 [object Object]）');
/* ==================================================================== */

const authWithEnv = { accessToken: ENV_SAMPLE, accessToken2: 'x' };
ok(lib.wdCompatAuthToken({ accessToken: ENV_SAMPLE }) === '',
  'C1 ⭐ 信封 token → 返回空串（**绝不能**返回 "[object Object]" 并当 Bearer 发出去）');
ok(lib.wdCompatText(ENV_SAMPLE) === '(已加密)',
  'C2 ⭐ 展示兜底：信封 → "(已加密)" 占位（不把整段密文摆到界面上）');
ok(lib.wdCompatHasAuthCredential({ accessToken: ENV_SAMPLE }) === true,
  'C3 ⭐ 信封算「有凭据」（只是暂时不可用）—— 判成 false 会让账号被误当成空号剔除');

const mixed = {
  account: { uid: 'u-2', nickname: ENV_SAMPLE, phoneNumber: '138' },
  auth: { accessToken: ENV_SAMPLE, domain: 'https://www.workbuddy.cn' },
};
let threw = null;
try { lib.wdCompatDecryptAuthJson(mixed); } catch (e) { threw = e; }
ok(threw === null, 'C4 取钥不可用时解密**不抛错**（不阻断账号管理）', threw && threw.message);
ok(lib.isWbEncryptedEnvelope(mixed.account.nickname) && lib.isWbEncryptedEnvelope(mixed.auth.accessToken),
  'C5 ⭐ 解密失败的字段**保留原值**（仍是信封对象，没被改成 undefined / 空串 / 部分结果）');
ok(mixed.account.phoneNumber === '138' && mixed.account.uid === 'u-2',
  'C6 同一结构里的明文兄弟字段不受影响（逐字段降级，不整块放弃）');

// 取钥失败必须留痕，且 60s 内不重复尝试（本机绝不能反复 spawn 客户端）
// 取钥失败必须留痕，且 60s 内不重复尝试（本机绝不能反复 spawn 客户端）。
// ⚠️ 口径：`取钥失败` 恰 1 行 = 真正尝试取钥只有 1 次（60s 窗口生效）；
//    每个信封字段各留 1 行 `解密失败` = 逐字段降级（mixed 里有 2 个信封字段）。
const keyLogs = logLines.filter((l) => l.includes('[wd-compat]'));
const keyAttempts = keyLogs.filter((l) => l.includes('取钥失败'));
const fieldFailures = keyLogs.filter((l) => l.includes('解密失败'));
ok(keyAttempts.length === 1,
  'C7 ⭐ 真正尝试取钥恰 1 次（60s 重试窗口生效 ⇒ 不会对真机客户端反复 spawn）', keyAttempts);
ok(fieldFailures.length === 2 && keyLogs.length === 3,
  'C8 逐字段降级：mixed 里 2 个信封字段各留 1 行「解密失败」，共 3 行留痕', fieldFailures.length);
ok(keyLogs.every((l) => !/WD_COMPAT_KEY\s+[A-Za-z0-9+/=]{20,}/.test(l)),
  'C9 留痕只写失败摘要，**不含密钥**（密钥绝不落盘/写日志）');

ok(typeof lib.wdCompatExeCandidates === 'function' && Array.isArray(lib.wdCompatExeCandidates()),
  'C10 取钥候选列表可枚举（WORKDADDY_WB_EXE 可覆盖，便于隔离与排障）');

/* ==================================================================== */
section('[D] 安全不变量（源码级）');
/* ==================================================================== */

const daemonSrc = fs.readFileSync(DAEMON_FILE, 'utf8');
const backupFn = LIB_SRC.slice(LIB_SRC.indexOf('function backupAuthFile('), LIB_SRC.indexOf('function backupCurrent('));
ok(backupFn.includes('fs.copyFileSync(file, tmp)') && !/fs\.writeFileSync\(\s*tmp/.test(backupFn),
  'D1 ⭐ backupAuthFile 改为 copyFileSync：**原字节**拷贝（旧实现 writeFileSync(readFileSync(file)) 会把文件读进内存再写，'
  + '对密文无害，但语义上不再是「原样」；现在明确只做字节搬运）');
ok((backupFn.split('chmodSync').length - 1) === 2, 'D2 backupAuthFile 两处 chmod 0600（tmp 与 dest）');

const switchFn = LIB_SRC.slice(LIB_SRC.indexOf('function switchTo('), LIB_SRC.indexOf('function switchTo(') + 6000);
ok(switchFn.includes('const raw = fs.readFileSync(src, \'utf8\')')
  && switchFn.includes('fs.writeFileSync(tmp, raw, { mode: 0o600 })'),
  'D3 ⭐⭐ switchTo 解密只用于**校验**，写回用的是原字节 `raw` '
  + '（若写回解密结果，就会把明文 token 落盘 —— 这正是上游明令禁止的）');
ok(/写回仍用 raw 原字节/.test(switchFn), 'D4 switchTo 代码里留有「写回仍用 raw 原字节」的警示注释');

const refreshFn = daemonSrc.slice(daemonSrc.indexOf('async function refreshAccountBackupToken('),
  daemonSrc.indexOf('async function refreshAccountBackupToken(') + 3000);
ok(refreshFn.includes('fs.writeFileSync(tmp, JSON.stringify(nextRoot, null, 2)'),
  'D5 ⚠️ 危险点已登记：refreshAccountBackupToken 会把刷新后的 root **写回 accounts/<uid>.info**。'
  + '因此 daemon 侧接线时不能简单地在 5826 行套 wdCompatDecryptAuthJson —— 必须先解决「用原密文回写」');
ok(!LIB_SRC.includes('wdCompatLog(key') && !/wdCompatLog\([^)]*\bkey\b/.test(LIB_SRC),
  'D6 密钥不进日志（wdCompatLog 的调用参数里不出现 key 变量）');

const normalize = lib.normalizeAccountImportJson;
const candidate = {
  account: { uid: '  imp-uid-1  ' },
  auth: { accessToken: 'imp-token', domain: 'https://www.workbuddy.cn' },
};
const candBefore = JSON.stringify(candidate);
const norm = normalize(candidate);
ok(JSON.stringify(candidate) === candBefore,
  'D7 ⭐ normalizeAccountImportJson **不修改入参**（在副本上归一化，避免污染调用方的原始 JSON）');
ok(norm && norm.uid === 'imp-uid-1' && norm.normalized.auth.accessToken === 'imp-token'
  && norm.normalized.account.uid === 'imp-uid-1',
  'D8 normalizeAccountImportJson：uid 与 token 都被 trim，返回 {uid, normalized, authRecord}');
ok(normalize(null) === null && normalize('x') === null && normalize([]) === null,
  'D9 非对象候选 → null（不抛错）');
ok(normalize({ account: { uid: '../evil' }, auth: { accessToken: 't' } }) === null
  && normalize({ account: { uid: 'ok' }, auth: {} }) === null,
  'D10 非法 uid（路径穿越字符）或无 token → null（导入前的第一道门）');
ok(normalize({ account: { uid: 'imp-env-1' }, auth: { accessToken: ENV_SAMPLE, domain: 'https://www.workbuddy.cn' } }) !== null,
  'D11 ⭐ 信封 token 的导入在**取钥不可用时仍被接受**（密文原样搬走，等取钥可用再解 —— 不因缺钥而丢账号）');

/* ==================================================================== */
section('[E] 行为实测：backupAuthFile 对明文源与信封源都逐字节原样');
/* ==================================================================== */

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (iss) => b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url({ iss }) + '.sig';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-wbenc-test-'));
const dataDir = path.join(SANDBOX, 'data');
fs.mkdirSync(path.join(dataDir, 'accounts'), { recursive: true });

function roundTrip(uid, auth, account) {
  const src = path.join(SANDBOX, uid + '.info');
  const text = JSON.stringify({ account: Object.assign({ uid }, account), auth }, null, 2);
  fs.writeFileSync(src, text, { mode: 0o600 });
  const info = lib.backupAuthFile(dataDir, src, () => {});
  const dest = path.join(dataDir, 'accounts', uid + '.info');
  return { src, dest, info, srcBytes: fs.readFileSync(src), destBytes: fs.readFileSync(dest), text };
}

const E1 = roundTrip('e-plain-1',
  { accessToken: jwt('https://www.workbuddy.cn'), domain: 'https://www.workbuddy.cn', lastRefreshTime: 11 },
  { nickname: '明文源' });
ok(E1.destBytes.equals(E1.srcBytes), 'E1 ⭐ 明文源 → 备份**逐字节一致**（' + E1.destBytes.length + ' bytes）');
ok(E1.info && E1.info.uid === 'e-plain-1' && E1.info.nickname === '明文源',
  'E2 返回的 info 保留 uid/nickname（meta 登记用）');
ok(fs.existsSync(path.join(dataDir, 'meta.json')), 'E3 meta.json 已登记（updateMeta 按 uid 落盘）');

const E4 = roundTrip('e-env-1',
  { accessToken: ENV_SAMPLE, domain: 'https://www.workbuddy.cn', lastRefreshTime: 12 },
  { nickname: '信封源' });
ok(E4.destBytes.equals(E4.srcBytes),
  'E4 ⭐⭐ 信封源 → 备份**逐字节一致**：密文原样搬走，**没有**在 WorkDaddy 目录制造明文副本');
let envPreserved = false;
try { envPreserved = lib.isWbEncryptedEnvelope(JSON.parse(E4.destBytes.toString('utf8')).auth.accessToken); } catch (_) {}
ok(envPreserved, 'E5 备份里的 token 仍然是信封对象（未被解成明文字符串）');
ok(fs.readFileSync(E1.src).equals(E1.srcBytes) && fs.readFileSync(E4.src).equals(E4.srcBytes),
  'E6 备份过程不改写源文件（只读源 → 写目标）');

fs.rmSync(SANDBOX, { recursive: true, force: true });

/* ==================================================================== */
section('[F] 阶段边界账本：lib 层已就绪 / daemon 层未接线（防「假装做完了」）');
/* ==================================================================== */

// lib 层：三个「读账号文件」入口已解密
const libEntries = ['function parseAuthFile(', 'function parseAuthJson(', 'function listAccounts('];
ok(libEntries.every((fn) => {
  const i = LIB_SRC.indexOf(fn);
  return i >= 0 && LIB_SRC.slice(i, i + 900).includes('wdCompatDecryptAuthJson');
}), 'F1 lib 层三个读入口（parseAuthFile / parseAuthJson / listAccounts）都已接解密');

// daemon 层：未接线 ⇒ 未接线的点必须与登记的数量一致（新增点会红，逼你做决定）
const RAW_PATTERNS = [
  ['auth.accessToken || auth.access_token || auth.token', 10],
  ['raw.auth.accessToken || raw.auth.access_token || raw.auth.token', 2],
  ['j.auth && j.auth.accessToken', 3],
  ['auth && (auth.accessToken || auth.access_token || auth.token)', 1],
];
const drift = RAW_PATTERNS.filter(([p, n]) => (daemonSrc.split(p).length - 1) !== n)
  .map(([p, n]) => p + '(期望 ' + n + ' 实际 ' + (daemonSrc.split(p).length - 1) + ')');
ok(drift.length === 0,
  'F2 阶段锁：daemon.js 里**未接线**的 raw token 直读点共 16 处，与登记一致（改动后必须同步本清单）', drift);

const INTENTIONAL = [
  ['rawToken.accessToken || rawToken.access_token', 1],
  ['data.accessToken || data.access_token', 1],
];
ok(INTENTIONAL.every(([p, n]) => (daemonSrc.split(p).length - 1) === n),
  'F3 另有 2 处属「登录响应明文，刻意不改」（rawToken / data —— 来自服务端而非磁盘文件）');

ok((daemonSrc.split('wdCompat').length - 1) === 0
  && (daemonSrc.split('isWbEncryptedEnvelope').length - 1) === 0,
  'F4 ⚠️**已知缺口（不是通过）**：daemon.js 目前 0 处 wdCompat 引用 ⇒ 客户端升到 5.6 时，'
  + '上述 16 处仍会拿到信封对象。6-B 完成后本断言的期望值必须改成 16/16 全接线');

ok((daemonSrc.split('normalizeAccountImportJson').length - 1) === 0,
  'F5 ⚠️ 已知缺口：daemon 的账号导入路径尚未接 normalizeAccountImportJson（lib 侧已就绪）');

console.log('');
console.log('本套件不通过的项 = 0 即代表「阶段一（lib 层）已落地且可证明零行为变化」；');
console.log('F2/F4/F5 是**阶段账本**，它们绿 = 缺口被如实登记，不代表 daemon 层已完成。');

/* ---- 还原桩 ---- */
fs.appendFileSync = realAppend;

console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
