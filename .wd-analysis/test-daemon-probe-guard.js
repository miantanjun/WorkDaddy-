'use strict';
/*
 * 守卫：daemon 的「一次性探测子进程」不得再派生探测子进程。
 *
 * 背景（上游 1.2.14 / 1.2.38 修复，2026-10-14 吸纳）：
 *   refreshClientRunning() 原本在**模块顶层**被调用。而 --probe-client-running
 *   子进程会从文件顶部重新执行 daemon.js ⇒ 它在走到 L19542 的 PROBE 早退门禁
 *   **之前**就已经又派生了一个探测子进程，形成进程链；每个 probe 又同步冷启一个
 *   PowerShell 做 CIM 全进程枚举（实测单个 2.4–6.7s）⇒ 实测 9 代深进程链、
 *   16 逻辑核周期性打满 100%，表现为「点哪都慢半拍」的周期性全局卡顿。
 *
 * 本套件同时守两件事：
 *   ① 静态：守卫存在 + 顶层调用已收进 startClientRunningMonitor() + 只在取锁后调用；
 *   ② 动态：真的用 --probe-client-running 跑一次入口，断言它**不派生**任何子探测进程。
 *
 * ⚠️ 沙箱注意：本机沙箱里子进程内 `spawnSync('powershell')` 会 EBUSY（生产环境正常，
 *    因为生产 daemon 跑在沙箱外）。因此在 preload 里桩掉 PS 权限探测，让模块加载能走到
 *    目标行；`execFile('--probe-client-running')` 也被拦截（记录 + 回调 error），
 *    双重保证**不会真的制造进程风暴**。桩不影响本套件的断言对象（execFile/probe 递归）。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DAEMON_PATH = path.join(__dirname, '..', 'scripts', 'daemon.js');
const raw = fs.readFileSync(DAEMON_PATH, 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// 剥掉注释：本仓 scripts/*.js 是 CRLF，而 JS 的 `.` 不匹配 `\r` ⇒ 必须先归一化（上面已做）。
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const code = codeOnly(raw);

/* ══════════ A. 静态：守卫与启动门禁 ══════════ */
section('A. 静态：probe 守卫 / 监控启动门禁');

ok(/if \(PROBE_CLIENT_RUNNING\) return Promise\.resolve\(clientRunningState\.value\);/.test(code),
  'A1 ⭐⭐ refreshClientRunning() 首部有 PROBE_CLIENT_RUNNING 守卫');

// 守卫必须落在 refreshClientRunning 函数体内（取函数头后固定长度切片，别用缩进收尾）
const fnHead = code.indexOf('function refreshClientRunning() {');
ok(fnHead >= 0, 'A2 refreshClientRunning 函数可定位');
const fnSlice = fnHead >= 0 ? code.slice(fnHead, fnHead + 600) : '';
ok(/if \(PROBE_CLIENT_RUNNING\) return/.test(fnSlice),
  'A3 ⭐ 守卫落在 refreshClientRunning 函数体内（非别处）');

// 顶层不得再有裸调用：refreshClientRunning() 只能出现在函数体内
const rawCalls = code.match(/(^|\n)\s*refreshClientRunning\(\)/g) || [];
const topLevelCalls = (code.match(/(^|\n)refreshClientRunning\(\)/g) || []).length;
ok(topLevelCalls === 0,
  'A4 ⭐⭐ 模块顶层没有裸的 refreshClientRunning() 调用（曾因此形成进程链）', 'top-level=' + topLevelCalls);
ok(rawCalls.length >= 1, 'A5 refreshClientRunning() 仍被调用（只是移进了函数内）', 'calls=' + rawCalls.length);

ok(/function startClientRunningMonitor\(\) \{/.test(code),
  'A6 ⭐ 存在 startClientRunningMonitor() 包装函数');

// 必须在 acquireDaemonLock() 之后调用
const lockIdx = code.indexOf('if (!acquireDaemonLock()) process.exit(0);');
const startIdx = code.indexOf('startClientRunningMonitor();');
ok(lockIdx >= 0, 'A7 acquireDaemonLock 门禁可定位');
ok(startIdx > lockIdx && lockIdx >= 0,
  'A8 ⭐⭐ startClientRunningMonitor() 在取到单实例锁之后调用（探测不再抢正常实例）');

/* ══════════ B. 静态：超时常量已接线 ══════════ */
section('B. 静态：探针超时常量（上游 1.2.39）');

ok(/const CLIENT_RUNNING_PROBE_TIMEOUT_MS = IS_MAC \? 4000 : 15000;/.test(code),
  'B1 CLIENT_RUNNING_PROBE_TIMEOUT_MS 定义（Win 仍 15000）');
ok(/const CLIENT_RUNNING_MAC_SCAN_TIMEOUT_MS = 2000;/.test(code),
  'B2 CLIENT_RUNNING_MAC_SCAN_TIMEOUT_MS 定义（mac 扫描 2000）');
ok(/timeout: CLIENT_RUNNING_PROBE_TIMEOUT_MS, windowsHide: true/.test(code),
  'B3 探针 execFile 使用 CLIENT_RUNNING_PROBE_TIMEOUT_MS');
ok(/timeout: IS_MAC \? CLIENT_RUNNING_MAC_SCAN_TIMEOUT_MS : 5000,/.test(code),
  'B4 safeClientRunning 的 pgrep 使用 CLIENT_RUNNING_MAC_SCAN_TIMEOUT_MS（Win 仍 5000）');

/* ══════════ C. 动态：真的跑一次 probe 入口 ══════════ */
section('C. 动态：--probe-client-running 入口不得派生探测子进程');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-probe-guard-'));
const preload = path.join(temp, 'audit-probe.cjs');
const audit = path.join(temp, 'probe-spawns.json');
fs.writeFileSync(preload, [
  "const fs = require('node:fs');",
  "const cp = require('node:child_process');",
  "const originalExecFile = cp.execFile;",
  "const originalSpawnSync = cp.spawnSync;",
  '// 桩掉 PS 权限探测（沙箱内 EBUSY；生产环境正常），只为让模块加载走到目标行。',
  'cp.spawnSync = function (bin) {',
  "  const name = String(bin || '').toLowerCase();",
  "  if (name === 'powershell' || name === 'powershell.exe' || name === 'pwsh') {",
  "    return { error: null, status: 0, stdout: 'False', stderr: '', pid: 1, output: ['', 'False', ''] };",
  '  }',
  '  try { return originalSpawnSync.apply(this, arguments); }',
  "  catch (e) { return { error: e, status: null, stdout: '', stderr: '' }; }",
  '};',
  'const probes = [];',
  'cp.execFile = function (bin, args, options, callback) {',
  "  if (args && args.includes('--probe-client-running')) {",
  '    probes.push([bin].concat(args).join(\' \'));',
  "    if (typeof callback === 'function') callback(new Error('recursive probe blocked by guard test'));",
  '    return { kill() {}, on() {}, once() {}, unref() {} };',
  '  }',
  '  return originalExecFile.apply(this, arguments);',
  '};',
  "process.on('exit', () => { try { fs.writeFileSync(" + JSON.stringify(audit) + ", JSON.stringify(probes)); } catch (e) {} });",
  '',
].join('\n'));

const PROFILES = ['workbuddy-cn', 'workbuddy-ai', 'codebuddy-cn', 'codebuddy-intl'];
const results = [];
for (const profile of PROFILES) {
  let spawned = [];
  let answered = false;
  let errMsg = null;
  try {
    const stdout = execFileSync(process.execPath,
      ['--require', preload, DAEMON_PATH, '--probe-client-running'], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],   // ⚠️ stdin 建管道会 EBUSY
        env: Object.assign({}, process.env, {
          WBSWITCH_PROFILE: profile,
          WBSWITCH_DATA_DIR: path.join(temp, profile),
          WBSWITCH_AUTH_FILE: path.join(temp, 'absent-auth.json'),
          WORKDADDY_TELEMETRY: '0',
        }),
      });
    try { answered = typeof JSON.parse(stdout).running !== 'undefined'; } catch (_) {}
  } catch (e) {
    errMsg = String(e.message || e).split('\n')[0];
  }
  try { spawned = JSON.parse(fs.readFileSync(audit, 'utf8')); } catch (_) {}
  try { fs.unlinkSync(audit); } catch (_) {}
  results.push({ profile, spawned: spawned.length, answered, errMsg });
}

const total = results.reduce((s, r) => s + r.spawned, 0);
ok(total === 0,
  'C1 ⭐⭐ 探测入口没有派生任何探测子进程（累计 ' + total + '）',
  results.map((r) => r.profile + '=' + r.spawned).join(' '));
ok(results.every((r) => r.answered),
  'C2 探测入口仍能正常应答（{running:…}）',
  results.map((r) => r.profile + (r.answered ? '✓' : '✗')).join(' '));

try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}

/* ══════════ 汇总 ══════════ */
console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
