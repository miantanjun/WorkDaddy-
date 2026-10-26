/**
 * CodeBuddy 启动入口守卫（2026-10-22 立档）
 *
 * 守的是一个**真实故障**：`D:\CodeBuddy CN\CodeBuddy CN.exe` 用
 * `--remote-debugging-port=9224` 启动时直接报
 *   `bad option: --remote-debugging-port=9224`（exit 9）
 * 根因不是参数不被支持，而是父进程带着 **ELECTRON_RUN_AS_NODE=1**
 * （WorkBuddy CLI 环境会注入），Electron 以纯 Node 模式跑，任何
 * Chromium 开关都成了 Node 的非法选项。清掉后同一命令立刻输出
 *   `DevTools listening on ws://127.0.0.1:9224/...`
 * 且 `NODE_OPTIONS=--require ...node-language-shim.cjs` 也会被注入客户端主进程。
 *
 * 另外守两条**白名单/入口一致性**：
 *   1. 进程身份白名单必须认识 "codebuddy cn.exe"（实机主程序名带空格）。
 *      缺它 ⇒ `Expected executable is not a WorkBuddy-family binary`，
 *      启动器在「重启客户端」那一步就崩（实测已复现）。
 *   2. start-codebuddy.cmd 必须清 `WBSWITCH_NATIVE_LAUNCHER` —— 原生入口的
 *      findWorkBuddyNative 只匹配 WorkBuddy 系名字，找不到 CodeBuddy，
 *      会抛「未找到安装时选择的 WorkBuddy 客户端」。
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const normalize = (t) => String(t || '').replace(/\r\n/g, '\n');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); return true; }
  const d = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  console.log('  FAIL ' + label + d);
  failures.push(label + d);
  return false;
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

const boundaryPath = path.join(repo, 'scripts', 'windows-process-boundary.js');
const cmdPath = path.join(repo, 'start-codebuddy.cmd');
const boundaryRaw = fs.readFileSync(boundaryPath, 'utf8');
const boundarySrc = normalize(boundaryRaw);
const cmdRaw = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : '';
const cmdSrc = normalize(cmdRaw);

/* ============ A. 进程身份白名单 ============ */
section('A. 进程身份白名单认识 CodeBuddy CN');

ok(boundarySrc.includes("'codebuddy cn.exe'"),
  "A1 白名单包含 'codebuddy cn.exe'（实机主程序名带空格）");
ok(boundarySrc.includes("'codebuddy.exe'") && boundarySrc.includes("'workbuddy.exe'") &&
  boundarySrc.includes("'workbuddyai.exe'"),
  'A2 原有三个名字一个都没丢');
ok((boundarySrc.match(/'codebuddy cn\.exe'/g) || []).length === 1,
  'A3 只出现一次（没被重复插入）');

const { filterVerifiedWindowsProcesses } = require(boundaryPath);
const identity = (p) => p;

let accepted = false;
try {
  const out = filterVerifiedWindowsProcesses('C:\\Program Files\\x\\CodeBuddy CN.exe', [], identity);
  accepted = Array.isArray(out) && out.length === 0;
} catch (_) {}
ok(accepted, 'A4 以 CodeBuddy CN.exe 为期望主体时不再抛「not a WorkBuddy-family binary」');

let rejectedForeign = false;
try { filterVerifiedWindowsProcesses('C:\\Windows\\notepad.exe', [], identity); } catch (e) {
  rejectedForeign = /not a WorkBuddy-family binary/.test(String(e && e.message));
}
ok(rejectedForeign, 'A5 反向：外来可执行文件仍被拒绝（白名单没被放宽成任意 .exe）');

let rejectedPath = false;
try { filterVerifiedWindowsProcesses('C:\\x\\a\\b.exe', [], identity, ['..\\evil.exe']); } catch (e) {
  rejectedPath = /not a WorkBuddy-family binary/.test(String(e && e.message));
}
ok(rejectedPath, 'A6 反向：带路径分隔符的「进程名」仍被拒绝');

/* ============ B. 启动脚本必须清毒 ============ */
section('B. start-codebuddy.cmd 清掉环境毒化与原生标记');

ok(cmdRaw.length > 0, 'B1 启动脚本存在');
ok(/\r\n/.test(cmdRaw) && (cmdRaw.match(/(^|[^\r])\n/g) || []).length === 0,
  'B2 纯 CRLF（cmd 解析器不接受裸 LF）');
ok(/set "ELECTRON_RUN_AS_NODE="/.test(cmdSrc),
  'B3 ⭐ 清掉 ELECTRON_RUN_AS_NODE（否则 --remote-debugging-port 变 bad option，exit 9）');
ok(/set "NODE_OPTIONS="/.test(cmdSrc),
  'B4 ⭐ 清掉 NODE_OPTIONS（--require shim 会被注入客户端主进程）');
ok(/set "WBSWITCH_NATIVE_LAUNCHER="/.test(cmdSrc),
  'B5 ⭐ 清掉原生标记（原生发现只认 WorkBuddy 名字，找不到 CodeBuddy）');
ok(/set "WBSWITCH_PROFILE=codebuddy-cn"/.test(cmdSrc),
  'B6 绑定 codebuddy-cn profile');
ok(/win-launcher\.js/.test(cmdSrc) && /runtime\\node\\node\.exe/.test(cmdSrc),
  'B7 走内置 Node 跑 win-launcher.js（不依赖系统 node）');

/* ============ C. 能力开关与入口一致 ============ */
section('C. profile 能力表仍然自洽');

const { getProfile } = require(path.join(repo, 'scripts', 'profiles.js'));
const cb = getProfile('codebuddy-cn');
ok(cb.kind === 'codebuddy' && cb.capabilities.apiTransport === 'cdp',
  'C1 codebuddy-cn 仍走 CDP 传输');
ok(cb.capabilities.nativeComposer === true && cb.capabilities.enhance === false,
  'C2 nativeComposer 开、enhance 全链短路（VS Code fork 不做 composer 增强）');
ok(Array.isArray(cb.binaryNames) && cb.binaryNames.some((n) => /codebuddy cn\.exe/i.test(n)),
  'C3 二进制名候选包含 "CodeBuddy CN.exe"（与 A1 白名单对齐）');

console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
