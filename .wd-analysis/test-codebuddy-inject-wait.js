#!/usr/bin/env node
/**
 * CodeBuddy「一堆注入报错」守卫
 *
 * 覆盖 2026-10-23 的三处改动，每一条都对应一次**实际观测到的故障**：
 *
 *   A  /api/inject 直接把「主连接还没建立」当失败 ⇒ launcher 每秒重试一次，30 次刷
 *      30 行「CDP 未连接，无法注入组件」，用户看到满屏红字以为启动失败。
 *      实测 launcher.log：01:29:49 起，第 1/30 ~ 第 N/30，每秒一行。
 *
 *   B  CodeBuddy 的主 target（agentManager.html）是**懒创建**的：用户不点开 AI 面板
 *      就没有这个 target，主连接永远不可能成立。而 IDE 主窗口（workbench.html）那条
 *      独立通道其实早就注入成功了（实测 `[cdp-ide] IDE 浮层已注入(reload)`）。
 *      ⇒ manual 注入必须接受「IDE 通道已挂上」这个成功事实，否则永远报错。
 *
 *   C  launcher 侧：单次请求超时要放宽（daemon 会等 8 秒）、重试要退避、
 *      日志要降噪（只在第 1 次和每 5 次报进度）。
 *
 *   D  行尾纪律与语法。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// 必须先归一化行尾：JS 的 `.` 不匹配 \r，CRLF 上 `//.*$` 之类的剥离会静默失败。
function codeOnly(raw) {
  return raw.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const DAEMON_RAW = read('scripts/daemon.js');
const LAUNCHER_RAW = read('scripts/win-launcher.js');
const daemonCode = codeOnly(DAEMON_RAW);
const launcherCode = codeOnly(LAUNCHER_RAW);

console.log('\n=== A. daemon：manual 注入要先主动等主连接 ===');

ok('A1 定义了 MANUAL_INJECT_CDP_WAIT_MS 且为 8000',
  /const\s+MANUAL_INJECT_CDP_WAIT_MS\s*=\s*8000;/.test(daemonCode));

ok('A2 waitForCdpReady 会**主动**调 connectCdp（不是干等轮询）',
  /async\s+function\s+waitForCdpReady\s*\([^)]*\)\s*\{[\s\S]{0,600}?await\s+connectCdp\(\)/.test(daemonCode));

ok('A3 waitForCdpReady 首行先看 cdp.connected（已连上就零延迟返回）',
  /async\s+function\s+waitForCdpReady\s*\([^)]*\)\s*\{\s*\n\s*if\s*\(cdp\.connected\)\s*return\s+true;/.test(daemonCode));

ok('A4 waitForCdpReady 有截止时间，不会无限循环',
  /async\s+function\s+waitForCdpReady\s*\([^)]*\)\s*\{[\s\S]{0,400}?const\s+deadline\s*=\s*Date\.now\(\)\s*\+\s*Math\.max\(0,\s*timeoutMs\)/.test(daemonCode));

ok('A5 定义了冷却常量与状态（避免每次重试都硬耗 8 秒）',
  /const\s+MANUAL_INJECT_WAIT_COOLDOWN_MS\s*=\s*20000;/.test(daemonCode)
  && /let\s+manualInjectWaitCooldownUntil\s*=\s*0;/.test(daemonCode));

ok('A6 waitForManualCdpReady 在冷却期内直接返回，不再进 waitForCdpReady',
  /async\s+function\s+waitForManualCdpReady\s*\([^)]*\)\s*\{[\s\S]{0,300}?if\s*\(Date\.now\(\)\s*<\s*manualInjectWaitCooldownUntil\)\s*return\s+false;/.test(daemonCode));

ok('A7 等待失败后才写冷却时间戳',
  /if\s*\(!ok\)\s*manualInjectWaitCooldownUntil\s*=\s*Date\.now\(\)\s*\+\s*MANUAL_INJECT_WAIT_COOLDOWN_MS;/.test(daemonCode));

console.log('\n=== B. daemon：IDE 通道已挂上就算注入成功 ===');

ok('B1 定义了 ideChannelMounted',
  /function\s+ideChannelMounted\s*\(/.test(daemonCode));

ok('B2 ideChannelMounted 只看 mounted 且未 closed 的条目',
  /for\s*\(const\s+entry\s+of\s+idePages\.values\(\)\)\s*\{\s*\n\s*if\s*\(entry\s*&&\s*entry\.mounted\s*&&\s*!entry\.closed\)\s*return\s+true;/.test(daemonCode));

ok('B3 injectWidgetManual 改为先等主连接（用带冷却的入口）',
  /function\s+injectWidgetManual\s*\([^)]*\)\s*\{[\s\S]{0,400}?await\s+waitForManualCdpReady\(\);/.test(daemonCode));

ok('B4 injectWidgetManual 里 IDE 兜底顺序：ideSyncScan → ideChannelMounted → 返回 mounted',
  /await\s+ideSyncScan\(\)\.catch\(\(\)\s*=>\s*\{\}\);\s*\n\s*if\s*\(ideChannelMounted\(\)\)\s*return\s*\{\s*mounted:\s*true,\s*via:\s*'ide'\s*\};/.test(daemonCode));

ok('B5 两条路都不成才交回原始错误（injectWidget 兜底在最后）',
  /if\s*\(ideChannelMounted\(\)\)\s*return\s*\{\s*mounted:\s*true,\s*via:\s*'ide'\s*\};\s*\n\s*return\s+injectWidget\('manual'\);/.test(daemonCode));

ok('B6 injectWidgetManual 仍是单飞（manualInjectPromise 复用）',
  /if\s*\(manualInjectPromise\)\s*return\s+manualInjectPromise;/.test(daemonCode));

// 顺序断言：实测「先等主连接」会让 CodeBuddy 每次启动都硬拖 8 秒（AI 面板没打开时
// 主 target 不存在，等到超时是必然结果）。必须先快查两条通道，都不可用才值得等。
(function checkOrder() {
  const start = daemonCode.indexOf('function injectWidgetManual()');
  const body = start >= 0 ? daemonCode.slice(start, start + 1600) : '';
  ok('B10 已连上时直接注入，零延迟（cdp.connected 判断在 ideSyncScan 之前）',
    body.indexOf('if (cdp.connected) return injectWidget') >= 0
    && body.indexOf('if (cdp.connected) return injectWidget') < body.indexOf('ideSyncScan'));
  ok('B11 IDE 通道检查在「等待主连接」之前（不为必然超时的等待硬拖 8 秒）',
    body.indexOf('ideChannelMounted()') >= 0
    && body.indexOf('ideChannelMounted()') < body.indexOf('await waitForManualCdpReady()'));
  ok('B12 等完之后再补扫一次 IDE 通道（workbench 可能刚就绪）',
    body.split('ideChannelMounted()').length - 1 >= 2
    && body.lastIndexOf('ideSyncScan') > body.indexOf('await waitForManualCdpReady()'));
})();

console.log('\n=== C. launcher：超时、退避、日志降噪 ===');

ok('C1 INJECT_REQUEST_TIMEOUT_MS 放宽到 12000（必须 > daemon 的 8 秒等待）',
  /const\s+INJECT_REQUEST_TIMEOUT_MS\s*=\s*12000;/.test(launcherCode));

ok('C2 CodeBuddy 重试次数为 24（配合退避覆盖约 60 秒）',
  /const\s+INJECT_MAX_ATTEMPTS\s*=\s*PROFILE\.kind\s*===\s*'codebuddy'\s*\?\s*24\s*:\s*6;/.test(launcherCode));

ok('C3 定义了 injectRetryDelay 且只对 codebuddy 生效',
  /function\s+injectRetryDelay\s*\(attempt\)\s*\{[\s\S]{0,300}?if\s*\(PROFILE\.kind\s*!==\s*'codebuddy'\)\s*return\s+INJECT_RETRY_DELAY_MS;/.test(launcherCode));

ok('C4 退避曲线：前 6 次 1 秒，之后 3 秒',
  /return\s+attempt\s*<=\s*6\s*\?\s*1000\s*:\s*3000;/.test(launcherCode));

ok('C5 injectNow 用 injectRetryDelay(attempt) 而不是常量间隔',
  /await\s+sleep\(injectRetryDelay\(attempt\)\);/.test(launcherCode)
  && !/await\s+sleep\(INJECT_RETRY_DELAY_MS\);/.test(launcherCode));

ok('C6 进度日志只在第 1 次与 5 的倍数打印（不再每失败一次刷一行）',
  /if\s*\(attempt\s*===\s*1\s*\|\|\s*attempt\s*%\s*5\s*===\s*0\)\s*\{/.test(launcherCode));

ok('C7 进度日志带累计等待秒数，便于用户判断是不是真卡住',
  /已等待\s*\$\{waited\}s/.test(launcherCode));

ok('C8 injectStartedAt 在循环之前初始化',
  /let\s+lastError\s*=\s*'注入请求无响应';\s*\n\s*const\s+injectStartedAt\s*=\s*Date\.now\(\);/.test(launcherCode));

console.log('\n=== D. 真跑逻辑（不是只匹配字符串） ===');

// D1-D3：把 win-launcher 的 injectRetryDelay 原样抠出来，喂假 PROFILE 跑
(function runRetryDelay() {
  const m = /\nfunction injectRetryDelay\(attempt\) \{[\s\S]*?\n\}/.exec(launcherCode);
  if (!m) { ok('D1 能抠出 injectRetryDelay 函数体', false); return; }
  ok('D1 能抠出 injectRetryDelay 函数体', true);
  const mk = (kind) => {
    const ctx = { PROFILE: { kind }, INJECT_RETRY_DELAY_MS: 1000 };
    vm.createContext(ctx);
    vm.runInContext(m[0].trim(), ctx);
    return ctx.injectRetryDelay;
  };
  const cb = mk('codebuddy');
  ok('D2 codebuddy：第 1 次 1000ms，第 6 次 1000ms，第 7 次 3000ms，第 24 次 3000ms',
    cb(1) === 1000 && cb(6) === 1000 && cb(7) === 3000 && cb(24) === 3000,
    `实际 ${cb(1)}/${cb(6)}/${cb(7)}/${cb(24)}`);
  const wb = mk('workbuddy');
  ok('D3 workbuddy：任何次数都是 1000ms（维持原行为）',
    wb(1) === 1000 && wb(7) === 1000 && wb(24) === 1000);
})();

// D4-D6：真跑 waitForManualCdpReady 的冷却语义
const dTests = (async () => {
  const m = /\nasync function waitForManualCdpReady\(\) \{[\s\S]*?\n\}/.exec(daemonCode);
  if (!m) { ok('D4 能抠出 waitForManualCdpReady 函数体', false); return; }
  ok('D4 能抠出 waitForManualCdpReady 函数体', true);

  // 场景一：主连接一直连不上 ⇒ 第一次等满，第二次进冷却不再等
  let waitCalls = 0;
  const ctx1 = {
    cdp: { connected: false },
    MANUAL_INJECT_CDP_WAIT_MS: 8000,
    MANUAL_INJECT_WAIT_COOLDOWN_MS: 20000,
    waitForCdpReady: async () => { waitCalls++; return false; },
  };
  vm.createContext(ctx1);
  vm.runInContext('let manualInjectWaitCooldownUntil = 0;\n' + m[0].trim(), ctx1);
  const r1 = await ctx1.waitForManualCdpReady();
  const r2 = await ctx1.waitForManualCdpReady();
  ok('D5 连不上：第一次返回 false 且只调一次 waitForCdpReady，第二次进冷却（不重复等）',
    r1 === false && r2 === false && waitCalls === 1, `waitCalls=${waitCalls}`);

  // 场景二：已经连上 ⇒ 直接 true，一秒都不等
  let waitCalls2 = 0;
  const ctx2 = {
    cdp: { connected: true },
    MANUAL_INJECT_CDP_WAIT_MS: 8000,
    MANUAL_INJECT_WAIT_COOLDOWN_MS: 20000,
    waitForCdpReady: async () => { waitCalls2++; return true; },
  };
  vm.createContext(ctx2);
  vm.runInContext('let manualInjectWaitCooldownUntil = 0;\n' + m[0].trim(), ctx2);
  const r3 = await ctx2.waitForManualCdpReady();
  ok('D6 已连上：直接返回 true 且完全不调用 waitForCdpReady',
    r3 === true && waitCalls2 === 0, `waitCalls=${waitCalls2}`);
})();

console.log('\n=== B-2. 状态页不再误报「调试端口不可达」 ===');

ok('B7 updateClientDebugState 会先看 IDE 通道（已挂上 ⇒ 当作正常）',
  /function\s+updateClientDebugState\s*\(\{[^}]*\}\)\s*\{[\s\S]{0,600}?ideChannelMounted\(\)/.test(daemonCode));

ok('B8 该判断在 consecutiveMiss 累加之前（否则已累计过就来不及了）',
  daemonCode.indexOf('ideServing = ideChannelMounted()') > 0
  && daemonCode.indexOf('ideServing = ideChannelMounted()') < daemonCode.indexOf('clientDebugState.consecutiveMiss += 1'));

ok('B9 调用点包了 try/catch（idePages 未初始化时不能让状态探针崩）',
  /try\s*\{\s*ideServing\s*=\s*ideChannelMounted\(\);\s*\}\s*catch\s*\(_\)\s*\{/.test(daemonCode));

console.log('\n=== E. 行尾纪律与语法 ===');
function crlfOnly(rel, raw) {
  const lf = (raw.match(/\r?\n/g) || []).length;
  const crlf = (raw.match(/\r\n/g) || []).length;
  ok(`${rel} 纯 CRLF（${crlf}/${lf}）`, crlf === lf && lf > 0);
}
crlfOnly('scripts/daemon.js', DAEMON_RAW);
crlfOnly('scripts/win-launcher.js', LAUNCHER_RAW);

for (const rel of ['scripts/daemon.js', 'scripts/win-launcher.js']) {
  let err = null;
  try { new vm.Script(read(rel)); } catch (e) { err = e.message; }
  ok(`${rel} 语法编译通过`, !err, err);
}

// D 组的两条断言是异步的，汇总统一放到 dTests 完成后打印，避免读到半截计数。
dTests.then(() => {
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
});
