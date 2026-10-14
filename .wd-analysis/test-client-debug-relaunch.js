'use strict';
/*
 * test-client-debug-relaunch.js —— 客户端调试端口丢失检测 + 一键恢复（上游 1.2.12 吸纳 / A1）。
 *
 * 背景（本机 2026-10-06 实踩）：WorkBuddy 官方自动更新器装完更新会**自行重启**应用，
 * 新进程不再带 --remote-debugging-port。此时 daemon 表现为「客户端进程在跑、CDP 永远连不上」，
 * cdpLoop 无限重试、右下角机器人按钮消失，且**没有任何可操作的提示** ——
 * 只能靠启动器报「错误码 4」去猜。
 *
 * 上游 1.2.12 的做法（本文件守卫其落地）：
 *   ① cdpLoop 每轮采样 { cdpConnected, clientRunning }，纯函数状态机计「连续失联」；
 *   ② 连续命中 CLIENT_DEBUG_MISS_THRESHOLD(3) 次 ⇒ 标记 needsDebugRelaunch；
 *   ③ /api/status 的 client 字段 + 根路径状态页向用户暴露；
 *   ④ POST /api/client/relaunch 一键恢复（先安全退出、再带 CDP 端口启动）。
 *
 * 关键不变式：
 *   - **探测失败（未知）不计数** —— 宁可漏报也不能把「探测坏了」变成「要恢复」的误报；
 *   - **只标记、不静默重启** —— 恢复必须由用户在状态页确认触发；
 *   - 阈值语义 = 约 15 秒（cdpLoop 5 秒一轮 × 3）。
 *
 * 跑法：node .wd-analysis/test-client-debug-relaunch.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}

// 剥离注释的源码视图：在注释里「点名」某个符号不得被静态断言误判成「已接线」。
// ⚠️ 必须先归一化 CRLF —— JS 的 `.` 不匹配 \r，CRLF 文件上 `//.*$` 会整条静默失效。
function codeOnly(text) {
  return text.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const START = '// __wbsClientDebugStateBlockStart';
const END = '// __wbsClientDebugStateBlockEnd';
const block = SRC.slice(SRC.indexOf(START), SRC.indexOf(END));

// VM 切片沙箱：状态块只依赖 log / Date，可直接跑真代码（不是复刻）。
function harness() {
  const logs = [];
  const context = vm.createContext({
    log: (...args) => { logs.push(args.join(' ')); },
    Date,
    console,
  });
  vm.runInContext(block, context);
  return {
    logs,
    state: () => vm.runInContext('clientDebugState', context),
    update: (input) => vm.runInContext('updateClientDebugState(' + JSON.stringify(input) + ')', context),
    threshold: vm.runInContext('CLIENT_DEBUG_MISS_THRESHOLD', context),
  };
}

function main() {
  // ---------- A 组：状态机行为（VM 真跑） ----------

  ok(SRC.indexOf(START) > 0 && SRC.indexOf(END) > SRC.indexOf(START),
    'A0 切片标记 __wbsClientDebugStateBlockStart/End 存在且有序');

  ok(harness().threshold === 3,
    'A1 阈值常量为 3（cdpLoop 5 秒一轮 ⇒ 约 15 秒判定）',
    harness().threshold);

  {
    const h = harness();
    h.update({ cdpConnected: false, clientRunning: true });
    h.update({ cdpConnected: false, clientRunning: true });
    const before = h.state().consecutiveMiss;
    h.update({ cdpConnected: true, clientRunning: true });
    ok(before === 2 && h.state().consecutiveMiss === 0 && h.state().needsDebugRelaunch === false,
      'A2 CDP 已连接时重置计数与标记',
      { before, after: h.state() });
  }

  {
    const h = harness();
    h.update({ cdpConnected: false, clientRunning: true });
    h.update({ cdpConnected: false, clientRunning: false });
    ok(h.state().consecutiveMiss === 0 && h.state().needsDebugRelaunch === false,
      'A3 客户端没在跑时重置计数与标记（这不是「丢调试端口」）');
  }

  {
    const h = harness();
    h.update({ cdpConnected: false, clientRunning: true });
    const after1 = h.state().needsDebugRelaunch;
    h.update({ cdpConnected: false, clientRunning: true });
    const after2 = h.state().needsDebugRelaunch;
    h.update({ cdpConnected: false, clientRunning: true });
    const after3 = h.state().needsDebugRelaunch;
    ok(after1 === false && after2 === false && after3 === true && h.state().updatedAt > 0,
      'A4 进程在跑但 CDP 不可达：第 3 次才标记 needsDebugRelaunch',
      { after1, after2, after3 });
    ok(h.logs.some((line) => line.includes('调试端口不可达')),
      'A4b 标记时给出可识别的日志（含「调试端口不可达」）',
      h.logs);
  }

  {
    const h = harness();
    for (let i = 0; i < 6; i++) h.update({ cdpConnected: false, clientRunning: true });
    const hits = h.logs.filter((line) => line.includes('调试端口不可达')).length;
    ok(hits === 1 && h.state().needsDebugRelaunch === true,
      'A5 标记后继续命中不重复打日志（避免刷屏）',
      { hits });
  }

  {
    const h = harness();
    for (let i = 0; i < 5; i++) h.update({ cdpConnected: false, clientRunning: null });
    ok(h.state().consecutiveMiss === 0 && h.state().needsDebugRelaunch === false,
      'A6 探测失败（null=未知）不计数 —— 宁可漏报，不可把探测故障当成需要恢复',
      h.state());
  }

  {
    const h = harness();
    for (let i = 0; i < 3; i++) h.update({ cdpConnected: false, clientRunning: true });
    const marked = h.state().needsDebugRelaunch;
    h.update({ cdpConnected: true, clientRunning: true });
    ok(marked === true && h.state().needsDebugRelaunch === false && h.state().consecutiveMiss === 0,
      'A7 CDP 恢复后标记被清除（可再次进入告警）',
      { marked, after: h.state() });
  }

  // ---------- B 组：接线静态守卫（codeOnly 剥离注释） ----------

  const code = codeOnly(SRC);

  {
    const i = code.indexOf("p === '/api/client/relaunch'");
    const route = i >= 0 ? code.slice(i, i + 2000) : '';
    const stop = route.indexOf('await quitWorkBuddy()');
    const relaunch = route.indexOf('await relaunchWorkBuddy()');
    ok(i >= 0 && stop >= 0 && relaunch > stop,
      'B1 恢复路由必须「先安全退出、再带 CDP 启动」（防 Electron 单实例把新参数交给旧进程）',
      { i, stop, relaunch });
    ok(/json\(res,\s*202,\s*\{\s*ok:\s*true,\s*pending:\s*true\s*\}\)/.test(route),
      'B2 恢复路由返回 202 + pending（异步重启，不假装已完成）', route.slice(0, 120));
    ok(/const clientRunning = safeClientRunning\(\)/.test(route) && /if \(clientRunning !== true\)/.test(route),
      'B3 动作前重探进程：陈旧标记/未知探测不得变成「擅自拉起客户端」');
    ok(/resetClientDebugState\(\)/.test(route),
      'B4 触发恢复后立刻重置状态（等 CDP 回来）');
  }

  {
    const i = code.indexOf('function safeClientRunning()');
    const j = code.indexOf('async function cdpLoop', i);
    const helper = i >= 0 && j > i ? code.slice(i, j) : '';
    ok(i >= 0 && j > i, 'B5 safeClientRunning 定义在 cdpLoop 之前（切片可读）');
    ok(/result\.error \|\| result\.status === null/.test(helper) && /return null/.test(helper),
      'B6 探测失败一律返回 null（不得沿用破坏性操作的「按仍在运行处理」语义）');
    ok(/verifiedWindowsWorkBuddyProcesses\(binary\)\.length > 0/.test(helper),
      'B7 Windows 分支用「已验路径」的进程枚举，不用裸 tasklist');
  }

  {
    ok(/updateClientDebugState\(\{\s*cdpConnected: cdp\.connected,\s*clientRunning: clientRunningState\.value\s*\}\)/.test(code),
      'B8 cdpLoop 每轮调用采样，且 clientRunning 走后台缓存（非同步探测）');
    // 取函数头后固定长度切片（不用「到某个缩进的 }」收尾 —— 缩进易变）。
    // 注意不能用 indexOf('updateClientDebugState({') 整体比较：第一处命中是函数**定义**。
    const ci = code.indexOf('async function cdpLoop');
    const cdpBody = ci >= 0 ? code.slice(ci, ci + 1200) : '';
    ok(cdpBody.includes('updateClientDebugState({'),
      'B9 采样点落在 cdpLoop 函数体内（防被挪到死代码区）');
  }

  {
    ok(/needsDebugRelaunch: clientDebugState\.needsDebugRelaunch/.test(code) &&
      /debugStateUpdatedAt: clientDebugState\.updatedAt \|\| null/.test(code),
      'B10 /api/status 暴露 client.needsDebugRelaunch / debugStateUpdatedAt');
    ok(code.includes('running: clientRunningState.value'),
      'B11a /api/status 的 client.running 走后端缓存（毫秒级返回）');
    // 反向守卫：两处都不得回退到同步探测。
    const loopAt = code.indexOf('async function cdpLoop');
    const loopBody = loopAt >= 0 ? code.slice(loopAt, loopAt + 1200) : '';
    ok(loopBody.length > 0 && !loopBody.includes('safeClientRunning()'),
      'B11b 反向守卫：cdpLoop 内不得同步探测 —— 否则把「每次请求慢」变成「周期性不可用」');
  }

  {
    ok(/'\/api\/client\/relaunch'/.test(code),
      'B12 路由进入 PUBLIC_API_PATHS 白名单（仅 loopback 可达，与 launcher 同权限）');
    const a = code.indexOf('PUBLIC_API_PATHS = new Set([');
    const b = code.indexOf(']);', a);
    ok(a >= 0 && b > a && code.slice(a, b).includes("'/api/client/relaunch'"),
      'B13 白名单项确实在集合字面量内（不是散落在别处）');
  }

  {
    ok(code.includes('重新启动客户端并恢复'),
      'B14 状态页给出一键恢复按钮（用户可见文案）');
    ok(/fetch\("\/api\/client\/relaunch",\s*\{\s*method:\s*"POST"\s*\}\)/.test(code),
      'B15 按钮确实 POST 到恢复路由（不是只画了个按钮）');
    ok(/needRelaunch = clientDebugState\.needsDebugRelaunch/.test(code),
      'B16 状态页按标记条件渲染（未命中时不显示告警块）');
  }

  // ---------- B2 组：非阻塞探测（v1.2.13 对 A1 的补丁）----------
  {
    // 用 cdp.error → batch 之间作 /api/status 的 client 块切片。
    const a = code.indexOf('error: cdp.error,');
    const b = code.indexOf('batch: {', a);
    const clientBlock = a >= 0 && b > a ? code.slice(a, b) : '';
    ok(clientBlock.length > 0 && !clientBlock.includes('safeClientRunning()'),
      'B17 反向守卫：/api/status 的 client 块内不得同步探测 —— Windows 上会拖到 2.4~6.7s，' +
      '令 launcher 的 1500ms 探测超时 ⇒ 误判 daemon 不存在 ⇒ 误选备用端口后启动失败',
      clientBlock.slice(0, 160));

    ok(code.includes("process.argv.includes('--probe-client-running')"),
      'B18 存在一次性探测模式开关（探测子进程复用同一入口）');
    ok(/execFile\(process\.execPath,\s*\[__filename,\s*'--probe-client-running'\]/.test(code),
      'B19 后台刷新走 execFile 子进程（不是 spawnSync —— 同步会阻塞事件循环数秒）');
    ok(/const CLIENT_RUNNING_REFRESH_MS = 5000;/.test(code),
      'B20 刷新间隔 5 秒（与 cdpLoop 同量级）');
    ok(/if \(timer && typeof timer\.unref === 'function'\) timer\.unref\(\)/.test(code),
      'B21 定时器 unref —— 不得阻止 daemon 进程退出');

    const pi = code.indexOf('if (PROBE_CLIENT_RUNNING) {');
    const probe = pi >= 0 ? code.slice(pi, pi + 240) : '';
    const ensureAt = code.indexOf('ensureDirs(DATA_DIR, log)');
    ok(pi >= 0 && ensureAt > pi,
      'B22 一次性探测块位于 ensureDirs / 抢锁之前（探测进程不抢占正常 daemon 实例）');
    ok(probe.includes('process.stdout.write(JSON.stringify({ running: safeClientRunning() }))') &&
      probe.includes('process.exit(0)'),
      'B23 探测块输出 JSON 后立即退出（不留常驻进程）');
  }

  // ---------- C 组：反向守卫（防「顺手加自动重启」） ----------

  {
    // 全仓不得出现「检测到就自动重启」的调用：恢复必须人工触发。
    const autoRestart = /needsDebugRelaunch[\s\S]{0,400}?(?<!await )quitWorkBuddy\(|needsDebugRelaunch[\s\S]{0,400}?relaunchWorkBuddy\(\)/.test(code);
    ok(!autoRestart,
      'C1 反向守卫：needsDebugRelaunch 附近不得直接调用重启（只标记不静默执行）');
  }

  console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error('测试自身崩了: ' + ((error && error.stack) || error));
  process.exit(1);
}
