'use strict';
/*
 * test-watchdog-backoff.js —— watchdog 重启退避的回归测试（v1.4.1 §9-4 / 审查报告 P1-3）。
 *
 * 缺陷：`startDaemon()` 每次调用都挂一个「60 秒后把退避重置回 3 秒」的定时器：
 *     setTimeout(() => { restartDelay = 3000; }, 60000);
 * 秒崩场景下 60 秒内会累积多个这样的复位定时器 ⇒ 退避**永远到不了 60s 封顶**：
 *     实测退出间隔 3000,6000,12000,24000,48000,3000,6000,12000,3000,…
 * 表现就是「崩溃风暴」：daemon 起不来时，watchdog 会以 3–48 秒的节奏无限拉起它。
 *
 * 修法：
 *   ① 复位判据从「启动后过了 60s」改成「**上一次启动存活超过 60s**」——
 *      只有真的活够久才算一次成功启动，秒崩不复位；
 *   ② 补断路器：连续快速退出到阈值后拉长到 10 分钟探测一次。
 *      刻意**不永久放弃** —— 插件静默死亡比慢重试糟得多。
 *
 * 三段：
 *   【A】退避状态机（从 watchdog.js 切片真跑）                                    10 项
 *   【B】对照组：旧实现用假时钟重放同一条退出序列，证明 A2 拦的是真缺陷            2 项
 *   【C】源码状态（复位定时器已消失、接线正确、常量自洽）                          4 项
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'watchdog.js'), 'utf8');

let pass = 0;
const failures = [];
function check(ok, name) {
  if (ok) { pass++; console.log('  ok   ' + name); return; }
  failures.push(name); console.log('  FAIL ' + name);
}

/** 按大括号配平从源码里切出一个函数 */
function sliceFunction(text, header) {
  const at = text.indexOf(header);
  if (at < 0) throw new Error('锚点未找到: ' + header);
  const open = text.indexOf('{', at + header.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(at, i + 1); }
  }
  throw new Error('大括号未配平: ' + header);
}

const CONST_RE = /^const (BACKOFF_START_MS|BACKOFF_MAX_MS|BREAKER_AFTER|BREAKER_PROBE_MS) = .*$/gm;
const constLines = (src.match(CONST_RE) || []).join('\n');
if (!constLines) throw new Error('未解析到退避常量');
const factory = new Function(
  constLines + '\n' + sliceFunction(src, 'function createRestartBackoff()') + '\n' +
  'return { createRestartBackoff, BACKOFF_START_MS, BACKOFF_MAX_MS, BREAKER_AFTER, BREAKER_PROBE_MS };'
);
const { createRestartBackoff, BACKOFF_START_MS, BACKOFF_MAX_MS, BREAKER_AFTER, BREAKER_PROBE_MS } = factory();

/** 重放「子进程秒崩」：startedAt === 退出时刻（存活 0ms） */
function rapidWaits(backoff, times) {
  const waits = [];
  for (let i = 0; i < times; i++) waits.push(backoff.onExit(1000, 1000).wait);
  return waits;
}

/**
 * 旧实现（改造前 src）用**假时钟**重放，结构逐行对应原文：
 *   child.on('exit', …) { const delay = restartDelay; setTimeout(startDaemon, delay);
 *                         restartDelay = Math.min(restartDelay * 2, 60000); }
 *   → startDaemon() 末尾：setTimeout(() => { restartDelay = 3000; }, 60000);
 * 假设：sec 崩场景下 spawn 与退出几乎同时，故复位定时器按 `退出时刻 + 60000` 计。
 */
function legacyWaits(exitAtMs) {
  let restartDelay = 3000;
  const timers = [];
  const waits = [];
  const fireDue = (t) => {
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= t) { timers[i].fn(); timers.splice(i, 1); }
    }
  };
  for (const exitAt of exitAtMs) {
    fireDue(exitAt);
    waits.push(restartDelay);
    restartDelay = Math.min(restartDelay * 2, 60000);
    timers.push({ at: exitAt + 60000, fn: () => { restartDelay = 3000; } });
  }
  return waits;
}

console.log('【A】退避状态机（切片真跑）');

{
  const first5 = rapidWaits(createRestartBackoff(), 5);
  check(JSON.stringify(first5) === JSON.stringify([3000, 6000, 12000, 24000, 48000]),
    'A1  前 5 次秒崩按 3/6/12/24/48 秒递增（起点与倍率未变）');
}
{
  const waits = rapidWaits(createRestartBackoff(), 6);
  check(waits[5] === BACKOFF_MAX_MS && BACKOFF_MAX_MS === 60000,
    'A2  第 6 次秒崩等待 60s 封顶 —— 不是被复位回 3000');
}
{
  const waits = rapidWaits(createRestartBackoff(), 9);
  check(waits[6] === 60000 && waits[7] === 60000 && waits[8] === 60000,
    'A3  封顶后继续稳定在 60s（阈值以下不熔断）');
}
{
  const backoff = createRestartBackoff();
  rapidWaits(backoff, 5);
  const survived = backoff.onExit(0, BACKOFF_MAX_MS + 1);
  const after = backoff.onExit(0, 0).wait;
  check(survived.wait === 3000 && after === 6000 && backoff.state.delay === 12000,
    'A4  存活 60001ms 的一次启动视为成功 ⇒ 退避复位回 3s 并重新按倍数爬升');
}
{
  const backoff = createRestartBackoff();
  rapidWaits(backoff, 3);
  const edge = backoff.onExit(0, BACKOFF_MAX_MS);
  check(edge.wait === 24000 && backoff.state.rapidExits === 4,
    'A5  存活恰好 60000ms 不算「超过」（判据是严格大于，避免边界漏判）');
}
{
  const backoff = createRestartBackoff();
  const waits = rapidWaits(backoff, BREAKER_AFTER);
  const last = backoff.onExit(1000, 1000);
  check(waits[BREAKER_AFTER - 1] === BREAKER_PROBE_MS && last.tripped === true && BREAKER_PROBE_MS === 600000,
    'A6  连续快速退出到阈值后熔断：等待拉长到 10 分钟');
}
{
  const backoff = createRestartBackoff();
  rapidWaits(backoff, BREAKER_AFTER);
  const more = [backoff.onExit(0, 0).wait, backoff.onExit(0, 0).wait];
  check(more[0] === BREAKER_PROBE_MS && more[1] === BREAKER_PROBE_MS,
    'A7  熔断后保持 10 分钟探测（不放弃、也不回退到 60s）');
}
{
  const backoff = createRestartBackoff();
  rapidWaits(backoff, BREAKER_AFTER);
  const healed = backoff.onExit(0, 90000);
  const next = backoff.onExit(0, 0);
  check(healed.wait === 3000 && healed.tripped === false && next.wait === 6000 && backoff.state.rapidExits === 1,
    'A8  熔断后只要有一次存活超阈值就整体复位（自愈，不会永久熔断）');
}
{
  const backoff = createRestartBackoff();
  const bad = [
    backoff.onExit(NaN, NaN).wait,
    backoff.onExit(undefined, undefined).wait,
    backoff.onExit(-1e15, 0).wait,
  ];
  check(bad.every((v) => Number.isFinite(v) && v > 0),
    'A9  非法时钟入参不产生 NaN / 负数等待');
}
{
  const backoff = createRestartBackoff();
  rapidWaits(backoff, 2);
  const state = backoff.state;
  check(state.delay === 12000 && state.rapidExits === 2,
    'A10 state 暴露的 delay / rapidExits 与实际演进一致');
}

console.log('【B】对照组：旧实现重放同一条序列');
{
  const exits = [0, 3000, 9000, 21000, 45000, 93000, 96000, 102000];
  const legacy = legacyWaits(exits);
  check(legacy[5] === 3000 && JSON.stringify(legacy.slice(0, 6)) === JSON.stringify([3000, 6000, 12000, 24000, 48000, 3000]),
    'B1  旧实现在第 6 次被复位回 3000（复现报告实测的 3000,6000,12000,24000,48000,3000,…）');
}
{
  const exits = [0, 3000, 9000, 21000, 45000, 93000, 96000];
  const legacy = legacyWaits(exits);
  const fixed = [];
  {
    const backoff = createRestartBackoff();
    let at = 0;
    for (const exitAt of exits) {
      // 新实现：存活时长 = 退出时刻 - 该次 spawn 时刻（秒崩 ⇒ 取 1ms 表示「刚起就崩」）
      const spawnedAt = at;
      const planned = backoff.onExit(spawnedAt, exitAt).wait;
      fixed.push(planned);
      at = exitAt + planned;
    }
  }
  const sameHead = legacy.slice(0, 5).join() === fixed.slice(0, 5).join();
  const diverged = legacy[5] !== fixed[5];
  check(sameHead && diverged && fixed[5] === 60000,
    'B2  同一条退出序列：前 5 项一致、第 6 项旧=3000 / 新=60000 —— 本组断言真正拦的是这个分叉');
}

console.log('【C】源码状态');

check(!/setTimeout\(\(\) => \{ restartDelay = 3000; \}, 60000\)/.test(src) && !/restartDelay/.test(src.replace(/`[^`]*`|^\s*\/\/.*$|^\s*\*.*$/gm, '')),
  'C1  启动即挂的 60s 复位定时器已消失，且不再有 restartDelay 全局');
check(/const startedAt = restartBackoff\.onStarted\(\);/.test(src) &&
  /const next = restartBackoff\.onExit\(startedAt\);/.test(src) &&
  /setTimeout\(startDaemon, next\.wait\);/.test(src),
  'C2  startDaemon 的等待时长来自 onExit 的返回值（唯一出口）');
{
  const startDaemonSrc = sliceFunction(src, 'function startDaemon()');
  check(!/Math\.min\(/.test(startDaemonSrc) && !/setTimeout\(\(\) *=>/.test(startDaemonSrc),
    'C3  startDaemon 内不再自行算退避（无 Math.min、无复位定时器），只消费 onExit');
}
check(BACKOFF_START_MS < BACKOFF_MAX_MS && BREAKER_PROBE_MS > BACKOFF_MAX_MS &&
  BREAKER_AFTER >= 3 && BREAKER_AFTER <= 30 && BREAKER_PROBE_MS <= 3600000,
  'C4  常量自洽且有界：起始 < 封顶 < 熔断探测；阈值 3~30 次（必须够得着）、探测间隔 ≤ 1 小时');

console.log('');
console.log(`通过 ${pass} / 失败 ${failures.length}  —— passed=${pass} failed=${failures.length}`);
if (failures.length) {
  for (const name of failures) console.log('  - ' + name);
  process.exit(1);
}
