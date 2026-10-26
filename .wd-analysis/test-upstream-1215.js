#!/usr/bin/env node
/**
 * 上游 1.2.15 吸纳守卫（2026-10-16）
 *
 * 本仓对 1.2.15（上游内部 1.2.46）**只吸纳了两项**：
 *   1.2.40 —— 周期性客户端探测改用 `tasklist`（不经 WMI）+ CIM 查询加 `-Filter` + 刷新 5s→15s
 *   1.2.41 —— 会话工作目录巡检跳过已失效的卷，同卷根只提示一次
 * **明确不吸纳** 1.2.42–1.2.46 的「同步个性化」（persona 共享）—— 用户判定对自己没用。
 *
 * 所以本套件有两条任务线：
 *   ✅ 正向：两项修复真的接上了线（不是只搬了函数没人调）；
 *   ⛔ 反向：persona 的那批导出**一个都不许溜进来**（守住「不吸纳」的决定）。
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');
const launcherSrc = fs.readFileSync(path.join(ROOT, 'scripts/win-launcher.js'), 'utf8');
const flat = daemonSrc.replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}
/** 取一个顶层 function 的源码（⚠️ daemon.js 是 CRLF，必须先归一化再找 '\n}\n'）。 */
function slice(name) {
  const src = flat;
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const end = src.indexOf('\n}\n', start);
  return end < 0 ? '' : src.slice(start, end + 3);
}

/* ── A 组：正向 —— 两项修复都接上了线 ── */
const light = slice('lightClientRunning');
ok(light.length > 0, 'A1 daemon 新增了 lightClientRunning()');
ok(/tasklist/.test(light) && !/powershell|Get-CimInstance/i.test(light),
  'A2 ⭐ 轻量探测在 Windows 上走 tasklist，完全不碰 PowerShell/WMI');
ok(/'\/FI',\s*`IMAGENAME eq \$\{name\}`/.test(light) && /'\/NH',\s*'\/FO',\s*'CSV'/.test(light),
  'A3 tasklist 用 IMAGENAME 过滤 + CSV 输出（原生 NT API，不枚举全表）');
ok(/escaped/.test(light) && /return probed \? false : null;/.test(light),
  'A4 ⭐ 探测全失败时返回 null（未知）而不是 false（否则会谎报「客户端没在跑」）');
ok(/const escaped = name\.replace\(/.test(light),
  'A5 候选进程名做了正则转义再拼匹配式（进程名里的点号不会被当通配）');

ok(daemonSrc.includes('process.stdout.write(JSON.stringify({ running: lightClientRunning() }));'),
  'A6 ⭐⭐ 探测子进程入口改用它（这是本轮 CPU 修复的正身：只搬函数不接线等于没修）');
ok(!daemonSrc.includes('process.stdout.write(JSON.stringify({ running: safeClientRunning() }));'),
  'A7 旧的「入口直接跑完整 CIM 验证」已移除');
ok(daemonSrc.includes('function safeClientRunning()'),
  'A8 ✅ safeClientRunning() 保留（切号 / 一键恢复等安全路径仍要完整 CIM 验证）');

ok(daemonSrc.includes('const CLIENT_RUNNING_REFRESH_MS = 15000;'),
  'A9 ⭐ 周期性刷新间隔 5s → 15s');
ok(/function clientRunningRefreshDelay\(\)[\s\S]{0,200}WORKDADDY_CLIENT_REFRESH_MS/.test(daemonSrc),
  'A10 支持 WORKDADDY_CLIENT_REFRESH_MS 环境变量覆盖');
ok(daemonSrc.includes('refreshClientRunning().catch(() => {}); }, clientRunningRefreshDelay());'),
  'A11 监控定时器用的是新延迟（而不是又写死常量）');
ok(!/CLIENT_RUNNING_REFRESH_MS = 5000/.test(daemonSrc), 'A12 旧值 5000 已不存在');

const daemonCim = (daemonSrc.match(/Get-CimInstance Win32_Process -Filter \(\(\\?\$?names/g) || []).length;
ok(daemonSrc.includes('Get-CimInstance Win32_Process -Filter (($names | ForEach-Object { "Name=\'$_\'" }) -join \' OR \')'),
  'A13 ⭐ daemon 的 CIM 查询加了 -Filter（服务端过滤，不再全表拉回再 Where-Object）');
ok(launcherSrc.includes('Get-CimInstance Win32_Process -Filter (($names | ForEach-Object { "Name=\'$_\'" }) -join \' OR \')'),
  'A14 ⭐ win-launcher 的 CIM 查询同步加 -Filter（两处一起改，漏一处等于没修全）');

ok(daemonSrc.includes('const reportedMissingCwdRoots = new Set();'),
  'A15 1.2.41：新增「已提示过的卷根」去重集合');
ok(daemonSrc.includes('const root = path.parse(cwd).root;')
  && daemonSrc.includes('if (root && !fs.existsSync(root)) {'),
  'A16 ⭐ 巡检前先看卷在不在（拔掉的移动盘 / 断开的网络盘直接跳过）');
ok(/for \(const root of missingCwdRoots\) \{[\s\S]{0,200}reportedMissingCwdRoots\.has\(root\)/.test(daemonSrc),
  'A17 同一个卷根只提示一次（不刷日志）但每轮仍重新检查卷状态');
ok(daemonSrc.includes('跳过所在卷不存在的会话：${root}'),
  'A18 提示只写卷根，不把完整会话路径写进日志');

ok(daemonSrc.includes("const UPSTREAM_VERSION = '1.2.18';"),
  'A19 ⭐⭐ UPSTREAM_VERSION 同步到 1.2.18（漏更 ⇒ 面板 upstreamHasUpdate 恒 true 假警报）');

/* ── B 组：反向 —— persona「同步个性化」一个都不许进来 ── */
const forbidden = ['syncSharedPersonaForSwitch', 'configurePersona', 'readPersonaSettings',
  'writePersonaSettings', 'dismissPersonaNotice', 'listPersonaSources', 'personaSettingsFile',
  'sharedPersonaDir', 'applySharedPersona', 'backupPersonaDirectory', 'PERSONA_MODES'];
const leaked = forbidden.filter((k) => daemonSrc.includes(k));
ok(leaked.length === 0, 'B1 ⛔ 未吸纳「同步个性化」：daemon 里不得出现 persona 共享那批函数', leaked);
ok(!daemonSrc.includes("p === '/api/persona/settings'"),
  'B2 ⛔ 不得新增 /api/persona/settings 路由');
ok(!/require\(['"]\.\/persona\.js['"]\)/.test(daemonSrc) && !fs.existsSync(path.join(ROOT, 'scripts/persona.js')),
  'B3 ⛔ 整条 persona 线都不进来（本仓从来没有 scripts/persona.js，保持原样）');
ok(!/inspectPersona|copyPersona/.test(daemonSrc),
  'B4 ⛔ 连 1.2.37 的 persona 复制功能也不引入（「不吸纳」是整条线）');

/* ── C 组：真值 —— vm 桩测 lightClientRunning 的三条分支 ── */
function runLight(opts) {
  const sandbox = {
    IS_WIN: !!opts.win, IS_LINUX: !!opts.linux, IS_MAC: false,
    PROFILE_BINARY_NAMES: ['WorkBuddy.exe', 'WorkBuddyAI.exe'],
    WORKBUDDY_BINARY: 'WorkBuddy', WORKBUDDY_APP: 'WorkBuddy.app',
    CLIENT_RUNNING_MAC_SCAN_TIMEOUT_MS: 2000,
    linuxWorkBuddyPids: () => (opts.linuxPids || []),
    spawnSync: opts.spawnSync,
  };
  vm.createContext(sandbox);
  new vm.Script(light + '\nthis.__light = lightClientRunning;').runInContext(sandbox);
  return sandbox.__light();
}
const csvHit = { error: null, status: 0, stdout: '"WorkBuddy.exe","1234","Console","1","100 K"\r\n' };
const csvMiss = { error: null, status: 0, stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' };
const boom = { error: new Error('EBUSY'), status: null, stdout: '' };

ok(runLight({ win: true, spawnSync: () => csvHit }) === true,
  'C1 tasklist 命中 ⇒ running=true');
ok(runLight({ win: true, spawnSync: () => csvMiss }) === false,
  'C2 ⭐ tasklist 明确回「没有匹配进程」⇒ running=false（能确定，不是未知）');
ok(runLight({ win: true, spawnSync: () => boom }) === null,
  'C3 ⭐⭐ 探测本身失败 ⇒ running=null（未知），绝不谎报 false');
let calls = 0;
ok(runLight({ win: true, spawnSync: () => { calls += 1; return csvHit; } }) === true && calls === 1,
  'C4 第一个候选进程名命中就返回（不白跑后面的名字）', calls);
ok(runLight({ linux: true, linuxPids: [11, 22] }) === true,
  'C5 Linux 走 linuxWorkBuddyPids（与 safeClientRunning 同源判据）');
ok(runLight({ win: true, spawnSync: () => { throw new Error('spawn blew up'); } }) === null,
  'C6 整体抛异常 ⇒ null（catch 兜底，绝不冒泡到调用方）');

/* ── D 组：真跑 —— 探测子进程入口仍能应答 ── */
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/daemon.js'), '--probe-client-running'], {
    encoding: 'utf8', timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'], // ⚠️ 给子进程建 stdin 管道在沙箱里会 EBUSY
  });
  let parsed = null;
  try { parsed = JSON.parse(String(out).trim()); } catch (_) {}
  ok(parsed && Object.prototype.hasOwnProperty.call(parsed, 'running')
    && (parsed.running === true || parsed.running === false || parsed.running === null),
    'D1 ⭐ 真跑 --probe-client-running ⇒ 输出 {running: true|false|null}（入口没炸）', String(out).slice(0, 120));
} catch (e) {
  ok(false, 'D1 真跑 --probe-client-running', String((e && e.message) || e).slice(0, 200));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
