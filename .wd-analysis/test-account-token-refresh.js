'use strict';
/*
 * test-account-token-refresh.js —— B4（上游 1.2.13）：打开账号面板时按日保活**全部**账号。
 *
 * 背景：以前只有「切到某个账号」才会刷新它的 token ⇒ 长期不切的账号会一直过期，
 *   面板上显示的有效期也是旧的。上游 1.2.13 把保活提到「面板打开」时统一做。
 *
 * 本套件守五件事：
 *   [A] daemon 侧契约（9 个新符号 + 路由 + 列表合并）
 *   [B] 判据语义：**按自然日**（不是满 24h）/ force 出口 / 按天去重 / 并发合并 / 上限 3
 *   [C] ⚠️ **隐私红线**：只缓存公开时间字段，**解密后的 token 绝不写回磁盘**
 *   [D] 账号列表合并（内存缓存优先，落盘状态兜底，两者都要过签名比对）
 *   [E] inject 侧：面板打开触发 + 代际守卫 + 面板已关不刷新 + 全链 catch
 *   [F] 反向守卫（防「顺手把 token 写进状态文件」这类跑偏）
 *
 * 跑法：node .wd-analysis/test-account-token-refresh.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAEMON_RAW = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const INJECT_RAW = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8');

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

/* ⚠️ 静态断言必须剥注释：本文件/源码的注释里会**点名** token 字样，
 *    不剥就会把「注释里提了一句」误判成「代码里写了」。
 * ⚠️ 且必须先归一化行尾 —— JS 的 `.` 不匹配 `\r`，CRLF 文件上 `//.*$` 会**整条静默失效**。 */
function codeOnly(src) {
  return src.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}
const daemon = codeOnly(DAEMON_RAW);
const inject = codeOnly(INJECT_RAW);

/** 取函数体（函数头起固定长度切片）——**不用「到某个缩进的 }」收尾**（缩进易变） */
function body(src, header, len = 900) {
  const i = src.indexOf(header);
  return i < 0 ? '' : src.slice(i, i + len);
}

/* ==================================================================== */
section('[A] daemon 侧契约');
/* ==================================================================== */

ok(/const TOKEN_REFRESH_STATE_FILE = path\.join\(DATA_DIR, 'token-refresh-state\.json'\);/.test(daemon),
  'A1 状态文件落在 DATA_DIR/token-refresh-state.json');
ok(/let accountTokenRefreshInFlight = null;/.test(daemon),
  'A2 accountTokenRefreshInFlight 用于合并并发批次');
ok(/function accountBackupSignature\(file\)/.test(daemon),
  'A3 accountBackupSignature（mtime+size 指纹）');
ok(/function loadTokenRefreshState\(\)/.test(daemon), 'A4 loadTokenRefreshState');
ok(/function saveTokenRefreshState\(\)/.test(daemon), 'A5 saveTokenRefreshState');
ok(/function persistedTokenRefreshState\(uid, signature\)/.test(daemon),
  'A6 persistedTokenRefreshState（**带签名比对**：文件换了就不认旧时间）');
ok(/function rememberTokenRefreshSuccess\(uid, file, auth\)/.test(daemon),
  'A7 rememberTokenRefreshSuccess');
ok(/function listAccountsWithRuntimeTokenCache\(\)/.test(daemon),
  'A8 listAccountsWithRuntimeTokenCache');
ok(/async function refreshAllAccountTokensOnPanelOpen\(\)/.test(daemon),
  'A9 refreshAllAccountTokensOnPanelOpen');

const rStart = daemon.indexOf("p === '/api/accounts/refresh-tokens'");
const rEnd = daemon.indexOf("if (req.method === 'GET' && p === '/api/accounts')", rStart);
ok(rStart >= 0, 'A10 新路由 POST /api/accounts/refresh-tokens 存在');
ok(rEnd > rStart, 'A11 新路由排在 GET /api/accounts 之前（同前缀先匹配具体路由）');
ok(/refreshAllAccountTokensOnPanelOpen\(\)/.test(daemon.slice(rStart, rEnd)),
  'A12 路由体确实调 refreshAllAccountTokensOnPanelOpen()');
ok(/return json\(res, 500, \{ ok: false, error: '账号 token 刷新失败' \}\);/.test(daemon.slice(rStart, rEnd)),
  'A13 失败要落 500 且不裸抛（前端有 catch，但后端别把栈打给用户）');

const accStart = daemon.indexOf("if (req.method === 'GET' && p === '/api/accounts')");
ok(/listAccountsWithRuntimeTokenCache\(\)/.test(daemon.slice(accStart, accStart + 200)),
  'A14 GET /api/accounts 改用 listAccountsWithRuntimeTokenCache()（合并运行时有效期）');

/* ==================================================================== */
section('[B] 判据语义（按自然日 / 去重 / 并发合并）');
/* ==================================================================== */

ok(/lastRefreshDay !== todayStr\(new Date\(now\)\)/.test(daemon),
  'B1 保活判据按**自然日**（跨零点即算新的一天），不再是「满 24 小时」');
ok(/if \(options\.dailyKeepalive === true && !dailyDue\) return \{ root, skipped: true \};/.test(daemon),
  'B2 dailyKeepalive 且当天已刷过 → 直接 skipped（**按天去重，防空刷**）');
ok(/options\.force !== true && !dailyDue && !shouldRefreshAccessToken/.test(daemon),
  'B3 force 只在非 dailyKeepalive 路径上放宽（不会绕过按天去重）');
ok(/const lastRefreshTime = Math\.max\(authLastRefreshTime, persistedLastRefreshTime\) \|\| null;/.test(daemon),
  'B4 备份里的时间与落盘状态**取较晚者**（文件被换过时不许倒退）');
ok(/refreshAccountBackupToken\(uid, \{ dailyKeepalive: true, force: true \}\)/.test(daemon),
  'B5 面板保活按 dailyKeepalive + force 调刷新');
ok(/if \(accountTokenRefreshInFlight\) return accountTokenRefreshInFlight;/.test(daemon),
  'B6 ⭐ 并发合并：已有批次在跑就复用它（快速开关面板不产生 refresh token 风暴）');
ok(/Math\.min\(3, accounts\.length\)/.test(daemon),
  'B7 单账号并发上限 3');
ok(/if \(accountTokenRefreshInFlight === wrapped\) accountTokenRefreshInFlight = null;/.test(daemon),
  'B8 批次结束要清 in-flight（否则此后永远复用那个已完成的 Promise）');
ok(/results\.filter\(\(item\) => item && item\.refreshed\)\.length/.test(daemon) &&
   /skipped: results\.filter/.test(daemon) && /failed: results\.filter/.test(daemon),
  'B9 返回 { total, refreshed, skipped, failed } 四件套（前端按 refreshed>0 决定是否重取快照）');
ok(/rememberTokenRefreshSuccess\(uid, file, result\.auth\);/.test(daemon),
  'B10 刷新成功后把**公开时间字段**记进状态文件');

/* ==================================================================== */
section('[C] ⚠️ 隐私红线：解密后的 token 绝不写回磁盘');
/* ==================================================================== */

const rememberBody = body(daemon, 'function rememberTokenRefreshSuccess(uid, file, auth)', 700);
ok(rememberBody.length > 0, 'C1 能取到 rememberTokenRefreshSuccess 函数体');
ok(!/accessToken|refreshToken|access_token|refresh_token/.test(rememberBody),
  'C2 ⭐ 它**只**写公开时间字段 —— 函数体里不得出现任何 token 字段名');
ok(/signature,/.test(rememberBody) && /lastRefreshTime,/.test(rememberBody) &&
   /expiresAt:/.test(rememberBody) && /refreshExpiresAt:/.test(rememberBody),
  'C3 落盘字段 = signature / lastRefreshTime / expiresAt / refreshExpiresAt（纯时间元数据）');

const saveBody = body(daemon, 'function saveTokenRefreshState()', 700);
ok(/JSON\.stringify\(loadTokenRefreshState\(\), null, 2\)/.test(saveBody),
  'C4 落盘内容取自 loadTokenRefreshState()（内存里的时间元数据），不掺任何 auth');
ok(/mode: 0o600/.test(saveBody) && /chmodSync\(TOKEN_REFRESH_STATE_FILE, 0o600\)/.test(saveBody),
  'C5 文件 0600（即使只是时间元数据，也不给别的账户读）');
ok(/fs\.unlinkSync\(tmp\)/.test(saveBody),
  'C6 写失败要清理半成品临时文件');

/* ==================================================================== */
section('[D] 账号列表合并');
/* ==================================================================== */

const listBody = body(daemon, 'function listAccountsWithRuntimeTokenCache()', 1100);
ok(/tokenExpiresAt: auth\.expiresAt \|\| null/.test(listBody), 'D1 合并 tokenExpiresAt');
ok(/refreshExpiresAt: auth\.refreshExpiresAt \|\| null/.test(listBody), 'D2 合并 refreshExpiresAt');
ok(/lastRefreshTime: auth\.lastRefreshTime \|\| null/.test(listBody), 'D3 合并 lastRefreshTime');
ok(/if \(cached && cached\.signature !== signature\) backupAuthRuntimeCache\.delete\(account\.uid\);/.test(listBody),
  'D4 内存缓存也要过签名比对（备份文件换过就丢缓存）');
ok(/cached && cached\.signature === signature && cached\.root && cached\.root\.auth/.test(listBody) &&
   /: persisted;/.test(listBody),
  'D5 取值优先级：内存缓存（已验签）→ 落盘状态（已验签）→ 原样返回');
ok(/catch \(_\) \{ return account; \}/.test(listBody),
  'D6 accountBackupFile 抛错（uid 非法）要吞掉并返回原账号，不许把整个列表带崩');

/* ==================================================================== */
section('[E] inject 侧（面板打开触发）');
/* ==================================================================== */

ok(/'\/api\/accounts\/refresh-tokens'/.test(inject),
  'E1 前端确实请求 /api/accounts/refresh-tokens');
ok(/var panelRefresh = refresh\(\);/.test(inject) && /Promise\.resolve\(panelRefresh\)\.then/.test(inject),
  'E2 先取一次快照，再在它之后触发刷新（避免与首屏请求打架）');
ok(/if \(newlyOpened && CAPS\.accounts\)/.test(inject),
  'E3 只在「本次才打开」且账号能力可用时触发（不会每次 re-render 都刷）');
ok(/window\.__wbsGeneration !== WBS_GENERATION \|\| !state\.open/.test(inject),
  'E4 ⭐ 代际守卫（本地口径）：热更后旧副本不许再写 DOM，且面板已关不刷新');
ok(/Number\(result\.refreshed\) <= 0\) return;/.test(inject),
  'E5 没有任何账号被刷新就**不**再取快照（省一次请求）');
ok(/\}\)\.catch\(function \(\) \{\}\);/.test(inject.slice(inject.indexOf('/api/accounts/refresh-tokens') - 200,
  inject.indexOf('/api/accounts/refresh-tokens') + 900)),
  'E6 整链有 catch 兜底（刷新失败绝不许冒泡成面板报错）');

/* ==================================================================== */
section('[F] 反向守卫');
/* ==================================================================== */

ok(!/TOKEN_REFRESH_STATE_FILE[\s\S]{0,200}(accessToken|refreshToken)/.test(daemon),
  'F1 状态文件写入路径附近不得出现 token 字段（防「顺手把 auth 也存了」）');
ok(/const TOKEN_REFRESH_STATE_FILE = path\.join\(DATA_DIR, /.test(daemon),
  'F2 状态文件必须在 DATA_DIR 下（不散落到别处）');
ok(/const tmp = TOKEN_REFRESH_STATE_FILE \+ '\.tmp\.' \+ process\.pid;/.test(daemon),
  'F3 临时文件名带 pid（多进程不互踩）');
ok(!/refreshAccountBackupToken[\s\S]{0,1200}saveTokenRefreshState\(\)/.test(
  body(daemon, 'async function refreshAccountBackupToken(uid, options = {})', 2200)),
  'F4 刷新函数本体不直接落盘状态（统一走 rememberTokenRefreshSuccess，避免有出口漏记）');

const DAEMON_BYTES = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'));
const crlf = (DAEMON_BYTES.toString('latin1').match(/\r\n/g) || []).length;
const bareLf = (DAEMON_BYTES.toString('latin1').match(/(?<!\r)\n/g) || []).length;
ok(crlf > 0 && bareLf === 0, 'F5 daemon.js 仍为纯 CRLF（裸 LF=' + bareLf + '）');
const INJ_BYTES = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'));
const icrlf = (INJ_BYTES.toString('latin1').match(/\r\n/g) || []).length;
const ibare = (INJ_BYTES.toString('latin1').match(/(?<!\r)\n/g) || []).length;
ok(icrlf > 0 && ibare === 0, 'F6 inject.js 仍为纯 CRLF（裸 LF=' + ibare + '）');

console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
