/**
 * 启动器权限兜底守卫（2026-10-06 立档）
 *
 * 守的是一个**真实故障**：用户以管理员身份直接启动了 WorkBuddy（没有 CDP），
 * 而 WorkDaddy 启动器是普通权限 ⇒ Windows 不允许普通进程终止管理员进程 ⇒
 * helper 返回 exitAccessDenied(11) ⇒ JS 抛错 ⇒ 入口 catch 里 process.exit(4)
 * ⇒ 用户看到没头没脑的「启动失败（错误码 4）」。
 *
 * 正确行为：识别出「停不掉」后 **返回 10**，让 Go 外层弹
 * 「WorkBuddy 已经打开，但没有启用调试端口。请完全退出 WorkBuddy，然后点击重试。」
 * （带重试按钮 —— 用户退出后能一键继续）。
 *
 * ⚠️ 本套件用 **vm 切片**执行，不 require 整个模块 —— 因为 win-launcher.js 顶层会
 *    调 detectWindowsPrivilege()（内部 spawn powershell），在沙箱里必 EBUSY。
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const normalize = (t) => String(t || '').replace(/\r\n/g, '\n');
const SRC = normalize(fs.readFileSync(path.join(repo, 'scripts', 'win-launcher.js'), 'utf8'));

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

/* ============ 提取被测代码（vm 切片，可注入 mock） ============ */
const startMarker = '// ===== 与 native（scripts/windows-native/main.go）的退出码对齐 =====';
const endMarker = 'function findWorkBuddyNative() {';
const sliceStart = SRC.indexOf(startMarker);
const sliceEnd = SRC.indexOf(endMarker);
const hasSlice = sliceStart >= 0 && sliceEnd > sliceStart;
const slice = hasSlice ? SRC.slice(sliceStart, sliceEnd) : '';

/* ============ A. 常量与函数就位 ============ */
section('A. 结构就位');

ok(hasSlice, 'A1 可提取「退出码 + 权限兜底」代码段');
ok(/const EXIT_WORKBUDDY_RUNNING = 10;/.test(SRC),
  'A2 ⭐ EXIT_WORKBUDDY_RUNNING = 10（与 native/main.go 的 exitWorkBuddyRunning 对齐）');
ok(/const NATIVE_EXIT_ACCESS_DENIED = 11;/.test(SRC),
  'A3 NATIVE_EXIT_ACCESS_DENIED = 11（与 Go 的 exitAccessDenied 对齐）');
ok(/function isAccessDeniedStopError\(error\)/.test(SRC), 'A4 isAccessDeniedStopError 已定义');
ok(/function tryStopNativeWorkBuddy\(reason\)/.test(SRC), 'A5 tryStopNativeWorkBuddy 已定义');

/* ============ B. 行为：错误分类 ============ */
section('B. 行为：isAccessDeniedStopError 分类');

let helpers = null;
try {
  const ctx = {
    console, Error, RegExp, String, Boolean, Number, Object, Array, JSON,
    // 切片里用到的外部依赖，mock 掉
    log: () => {},
    stopNativeWorkBuddy: () => { throw new Error('未在行为测试中 mock'); },
  };
  vm.runInNewContext(
    slice + '\nthis.h = { isAccessDeniedStopError, tryStopNativeWorkBuddy, EXIT_WORKBUDDY_RUNNING };',
    ctx
  );
  helpers = ctx.h;
} catch (e) {
  console.log('  （vm 执行失败：' + e.message + '）');
}

ok(!!helpers, 'B1 切片可在 vm 中执行');

if (helpers) {
  const { isAccessDeniedStopError } = helpers;

  // 真实错误文本（取自 native-launcher.log 的实际输出）
  const realMsg = '无法精确重启当前 WorkBuddy（错误码 11）: Access is denied.';
  ok(isAccessDeniedStopError(new Error(realMsg)) === true,
    'B2 ⭐ 识别真实故障文本「（错误码 11）: Access is denied.」', realMsg);

  ok(isAccessDeniedStopError(new Error('PID 31036 WorkBuddy cannot be terminated at standard privilege')) === true,
    'B3 识别 Go 侧的另一种措辞「cannot be terminated at standard privilege」');
  ok(isAccessDeniedStopError(new Error('EPERM: Access is denied')) === true,
    'B4 识别裸的 Access is denied');

  // 不该误判的
  ok(isAccessDeniedStopError(new Error('无法精确重启当前 WorkBuddy（错误码 4）: 其他原因')) === false,
    'B5 ⭐ 不把「错误码 4」误判成权限问题（那是通用失败）');
  ok(isAccessDeniedStopError(new Error('spawn ENOENT')) === false,
    'B6 不把 spawn 类错误误判成权限问题');
  ok(isAccessDeniedStopError(null) === false, 'B7 传 null 不抛错');
  ok(isAccessDeniedStopError(undefined) === false, 'B8 传 undefined 不抛错');
  ok(isAccessDeniedStopError(new Error('（错误码 110）: 别的')) === false,
    'B9 ⭐ 不把「错误码 110」误判成 11（\\b 词边界必须生效）');
}

/* ============ C. 行为：tryStopNativeWorkBuddy 的三态 ============ */
section('C. 行为：tryStopNativeWorkBuddy 三态');

if (helpers) {
  const runWith = (stopImpl) => {
    const ctx = {
      console, Error, RegExp, String, Boolean, Number, Object, Array, JSON,
      log: () => {},
      stopNativeWorkBuddy: stopImpl,
    };
    vm.runInNewContext(
      slice + '\nthis.h = { tryStopNativeWorkBuddy };',
      ctx
    );
    return ctx.h.tryStopNativeWorkBuddy;
  };

  const t1 = runWith(() => {});
  ok(t1('unit') === true, 'C1 ⭐ 停成功 ⇒ 返回 true');

  const t2 = runWith(() => { throw new Error('无法精确重启当前 WorkBuddy（错误码 11）: Access is denied.'); });
  ok(t2('unit') === false, 'C2 ⭐⭐ 权限被拒 ⇒ 返回 **false**（不抛错）—— 这正是修复的核心');

  const t3 = runWith(() => { throw new Error('别的无关错误'); });
  let threw = false;
  try { t3('unit'); } catch (_) { threw = true; }
  ok(threw === true, 'C3 ⭐ 无关错误 ⇒ **照旧抛出**（不吞掉真问题）');
}

/* ============ D. 接入点：三处 stop 都必须走兜底 ============ */
section('D. 接入点（漏一处就等于没修）');

const hasBareStop = (() => {
  // ⚠️ 必须先剥掉 tryStopNativeWorkBuddy 自己的函数体 —— 它内部**本来就要**调
  //    原函数（那是兜底的实现），不算"漏改的裸调用"。
  const helperStart = SRC.indexOf('function tryStopNativeWorkBuddy(reason) {');
  const helperEnd = SRC.indexOf('function findWorkBuddyNative() {', helperStart);
  const outside = helperStart >= 0 && helperEnd > helperStart
    ? SRC.slice(0, helperStart) + SRC.slice(helperEnd)
    : SRC;
  return outside.split('\n').filter((line) => line.trim() === 'stopNativeWorkBuddy();').length;
})();
ok(hasBareStop === 0,
  'D1 ⭐⭐ **没有任何裸调用** stopNativeWorkBuddy()（三处全走 tryStop 兜底）',
  { bareCalls: hasBareStop });

ok((SRC.split('tryStopNativeWorkBuddy(').length - 1) >= 4,
  'D2 tryStopNativeWorkBuddy 被调用 ≥3 次 + 1 次定义',
  { occurrences: SRC.split('tryStopNativeWorkBuddy(').length - 1 });

ok(/if \(!tryStopNativeWorkBuddy\('startup-reclaim'\)\) return EXIT_WORKBUDDY_RUNNING;/.test(SRC),
  'D3 ⭐⭐ nativeStartupMain 停不掉 ⇒ **return EXIT_WORKBUDDY_RUNNING**（让外层弹友好提示）');
ok(/if \(!tryStopNativeWorkBuddy\('launch-failed-reclaim'\)\) break;/.test(SRC),
  'D4 CDP 等待循环第 1 处停不掉 ⇒ break（不再空转重试）');
ok(/if \(!tryStopNativeWorkBuddy\('single-instance-handoff'\)\) break;/.test(SRC),
  'D5 CDP 等待循环第 2 处停不掉 ⇒ break');
ok(/CDP 等待失败且 WorkBuddy 仍在运行 ⇒ 按「需用户手动退出」处理/.test(SRC),
  'D6 ⭐ 超时后若进程仍在运行 ⇒ 也返回 10（而不是报"超时"误导用户）');

/* ============ E. 反向：入口 catch 仍保留通用兜底 ============ */
section('E. 通用兜底未被破坏');

ok(/\.finally\(\(\) => process\.exit\(4\)\)/.test(SRC),
  'E1 入口 catch 仍保留 process.exit(4)（未预期异常仍要报出来）');
ok(/const EXIT_CDP_TIMEOUT = 3;/.test(SRC) && /return 3;/.test(SRC),
  'E2 CDP 超时仍返回 3（与 Go 的 exitFailure 分支区分开）');
ok(/function stopNativeWorkBuddy\(\) \{/.test(SRC),
  'E3 原 stopNativeWorkBuddy 定义仍在（没被删掉）');

console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
