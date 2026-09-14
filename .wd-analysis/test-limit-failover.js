'use strict';
/*
 * test-limit-failover.js —— 限流切号续跑核心（runLimitFailoverCore + waitLimitVerdict）的行为测试。
 *
 * 设计约束（照抄维护手册 §6 的既有做法）：
 *   1. **不 require daemon.js** —— 它 require 即起 HTTP 服务。改为从源码里**切片**出相关块，
 *      用 `new Function(...)` 注入依赖后实例化。
 *   2. 所有副作用都通过 ports 注入，所以这里能用 stub 穷举分支，**不碰真实账号 / 不切号 / 不发消息**。
 *   3. daemon.js 是 CRLF，切片前先归一化为 LF。
 *
 * 跑法：node .wd-analysis/test-limit-failover.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DAEMON = path.join(__dirname, '..', 'scripts', 'daemon.js');
const raw = fs.readFileSync(DAEMON, 'utf8');
const src = raw.replace(/\r\n/g, '\n');

/* ---------- 1. 从 daemon.js 切出「模型限流自动切号续跑」整块 ---------- */
const START = '/* ---------------- 模型限流自动切号续跑 ---------------- */';
const start = src.indexOf(START);
if (start < 0) fail('daemon.js 里找不到限流切号代码块的起始注释锚点');

const anchor = 'async function runLimitFailoverCore(detail, ports) {';
const aIdx = src.indexOf(anchor, start);
if (aIdx < 0) fail('daemon.js 里找不到 runLimitFailoverCore 定义');

// 从函数体第一个 { 起做大括号配平，找到它的结束位置
let depth = 0, end = -1;
for (let i = src.indexOf('{', aIdx); i < src.length; i += 1) {
  const ch = src[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) fail('runLimitFailoverCore 大括号配平失败');
const block = src.slice(start, end);

for (const needed of ['waitLimitVerdict', 'findLimitFailoverTask', 'LIMIT_FAILOVER_VERIFY_MS', 'limitFailoverInFlight']) {
  if (!block.includes(needed)) fail('切出的代码块缺少 ' + needed + '，锚点可能已失效');
}

/* ---------- 2. 用 new Function 注入依赖，实例化核心 ---------- */
const limitFailover = require(path.join(__dirname, '..', 'scripts', 'limit-failover.js'));

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-limit-failover-'));
const logs = [];

const factory = new Function(
  'path', 'DATA_DIR', 'fs', 'log',
  'cachedCreditRotationAccounts', 'listAccounts',
  'limitFailover', 'currentAccount', 'sleep',
  'readAutomations', 'automationRuns', 'automationPublicRun',
  block + '\nreturn { runLimitFailoverCore: runLimitFailoverCore, waitLimitVerdict: waitLimitVerdict, findLimitFailoverTask: findLimitFailoverTask, STATE_FILE: LIMIT_FAILOVER_STATE_FILE };'
);

// 可变世界观：当前账号 / 账号表
const world = {
  current: { uid: 'A', nickname: '账号A' },
  accounts: [
    { uid: 'A', nickname: '账号A' },
    { uid: 'B', nickname: '账号B' },
    { uid: 'C', nickname: '账号C' },
  ],
  creditByUid: {},
};

const core = factory(
  path,
  stateDir,
  fs,
  (m) => logs.push(m),
  () => Object.keys(world.creditByUid).map((uid) => ({ uid, creditSegments: world.creditByUid[uid] })),
  () => world.accounts,
  limitFailover,
  () => world.current,
  () => Promise.resolve(),          // sleep 立即返回，让 waitLimitVerdict 的轮次循环不真的等
  () => [{ id: 't1', name: '限流切号续跑', enabled: true, steps: [{ op: 'account.failoverContinue' }] }],
  new Map(),
  (r) => r
);

const STATE_FILE = core.STATE_FILE;
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s));

/* ---------- 3. 测试脚手架 ---------- */
let pass = 0; const failures = [];
function fail(msg) { failures.push(msg); throw new Error('TEST-ABORT: ' + msg); }
function check(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { failures.push(label + (extra ? ' :: ' + JSON.stringify(extra) : '')); console.log('  FAIL ' + label + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
function reset() {
  writeState({});
  world.current = { uid: 'A', nickname: '账号A' };
  world.accounts = [
    { uid: 'A', nickname: '账号A' },
    { uid: 'B', nickname: '账号B' },
    { uid: 'C', nickname: '账号C' },
  ];
  world.creditByUid = {};
  logs.length = 0;
}

function makePorts(overrides = {}) {
  const calls = { switched: [], setModel: [], sent: [], notified: [], panel: [], newTask: 0 };
  const ports = {
    calls,
    readBanner: async () => ({ ok: true, hit: false, count: 0, hits: [] }),
    replyStarted: async () => true,
    readModel: async () => ({ ok: true, model: 'deepseek-v4.1-flash', conversationId: 'conv-1' }),
    setModel: async (m) => { calls.setModel.push(m); return { ok: true, model: m, changed: true }; },
    readTaskText: async () => ({ ok: true, text: '请把这段合同的关键条款列出来' }),
    switchAccount: async (acct) => { calls.switched.push(acct.uid); world.current = acct; return { ok: true }; },
    ensureNewTask: async () => { calls.newTask += 1; return { ok: true }; },
    sendPhrase: async (t) => { calls.sent.push(t); return { ok: true }; },
    guard: async () => {},
    log: (m) => logs.push(m),
    notify: async (lvl, msg) => { calls.notified.push([lvl, msg]); },
    setPanelOpen: async (open) => { calls.panel.push(open); return true; },
    wasPanelOpen: false,
  };
  Object.assign(ports, overrides);
  return ports;
}

(async function run() {
  console.log('限流切号续跑核心测试  (state dir: ' + stateDir + ')\n');

  /* ---------- T1 正常交接：切到下一个账号、保持同一个模型、原样续跑 ---------- */
  console.log('T1 正常交接');
  reset();
  let p = makePorts();
  let r = await core.runLimitFailoverCore({}, p);
  check(r.ok === true, 'T1a 交接成功', r);
  check(r.fromUid === 'A' && r.toUid === 'B', 'T1b 从 A 切到 B', { from: r.fromUid, to: r.toUid });
  check(r.modelId === 'deepseek-v4.1-flash', 'T1c 模型保持不变（复读 live model）', r.modelId);
  check(p.calls.setModel.length === 1 && p.calls.setModel[0] === 'deepseek-v4.1-flash',
    'T1d 换号后 setModel 用的是同一个模型 id', p.calls.setModel);
  check(p.calls.sent.length === 1 && p.calls.sent[0] === '请把这段合同的关键条款列出来',
    'T1e 原任务文本被原样重发', p.calls.sent);
  check(p.calls.newTask === 1, 'T1f 先新建任务再发送', p.calls.newTask);
  check(p.calls.switched.length === 1 && p.calls.switched[0] === 'B', 'T1g 只切了一次账号', p.calls.switched);
  let st = readState();
  check(st.A && st.A.reason === 'detected', 'T1h 源账号被标记限流', st);
  check(!st.B, 'T1i 接管成功的账号不留限流记录', st);

  /* ---------- T2 modelId 由任务变量给出时优先 ---------- */
  console.log('T2 变量指定模型优先');
  reset();
  p = makePorts();
  r = await core.runLimitFailoverCore({ modelId: 'from-var-model' }, p);
  check(r.ok === true && r.modelId === 'from-var-model', 'T2a 结果模型取变量值', r.modelId);
  check(p.calls.setModel[0] === 'from-var-model', 'T2b setModel 收到变量值', p.calls.setModel);

  /* ---------- T3 prompt 变量优先于会话最后一条用户消息 ---------- */
  console.log('T3 prompt 变量优先');
  reset();
  p = makePorts();
  r = await core.runLimitFailoverCore({ prompt: '变量里的任务' }, p);
  check(p.calls.sent[0] === '变量里的任务', 'T3a 发送的是变量里的 prompt', p.calls.sent);
  check(r.taskSource === 'prompt', 'T3b taskSource=prompt', r.taskSource);

  /* ---------- T4 目标账号仍被限流 → 继续换下一个 ---------- */
  console.log('T4 目标仍限流则继续换');
  reset();
  let hitCount = 0;
  p = makePorts({
    readBanner: async () => { hitCount += 1; return { ok: true, hit: hitCount <= 1, count: 1, hits: [] }; },
  });
  r = await core.runLimitFailoverCore({}, p);
  check(r.ok === true && r.toUid === 'C', 'T4a 第一个目标 B 失败后换到 C', { ok: r.ok, toUid: r.toUid });
  check(p.calls.switched.join(',') === 'B,C', 'T4b 切换顺序 B→C', p.calls.switched);
  check(p.calls.setModel.length === 2, 'T4c 两次尝试都设了模型', p.calls.setModel);
  st = readState();
  check(st.B && st.B.reason === 'still-limited', 'T4d B 被记为 still-limited', st);
  check(!st.C, 'T4e C 接管成功被清记录', st);
  check(p.calls.notified.some((n) => n[0] === 'warning'), 'T4f 对仍限流的账号发了 warning', p.calls.notified);

  /* ---------- T5 所有账号都接管不了 → 明确失败并提示 ---------- */
  console.log('T5 全部失败');
  reset();
  p = makePorts({ readBanner: async () => ({ ok: true, hit: true, count: 1, hits: [] }) });
  r = await core.runLimitFailoverCore({}, p);
  check(r.ok === false && r.reason === 'no-usable-target', 'T5a 返回 no-usable-target', r);
  check(r.tried.join(',') === 'B,C', 'T5b 尝试过 B、C', r.tried);
  check(p.calls.notified.some((n) => n[0] === 'error'), 'T5c 发了 error 提示', p.calls.notified);
  check(p.calls.sent.length === 2, 'T5d 每个目标各发过一次（不重复轰炸）', p.calls.sent.length);

  /* ---------- T6 没有可续跑的任务文本 → 不切号 ---------- */
  console.log('T6 无可续跑文本');
  reset();
  p = makePorts({ readTaskText: async () => ({ ok: false, error: '当前会话里没有用户消息' }) });
  r = await core.runLimitFailoverCore({}, p);
  check(r.ok === false && r.reason === 'no-task-text', 'T6a 返回 no-task-text', r);
  check(p.calls.switched.length === 0, 'T6b 一次都没切号', p.calls.switched);
  check(p.calls.notified.some((n) => /没有可续跑/.test(n[1])), 'T6c 给出可读提示', p.calls.notified);

  /* ---------- T7 状态里已被判定限流的账号不会被选中 ---------- */
  console.log('T7 跳过窗口内已判限流的账号');
  reset();
  writeState({ B: { blockedAt: Date.now(), reason: 'detected' } });
  p = makePorts();
  r = await core.runLimitFailoverCore({}, p);
  check(r.ok === true && r.toUid === 'C', 'T7a 跳过 B、直接选 C', { ok: r.ok, toUid: r.toUid, switched: p.calls.switched });

  /* ---------- T8 面板开合状态被还原 ---------- */
  console.log('T8 面板还原');
  reset();
  p = makePorts({ wasPanelOpen: true });
  await core.runLimitFailoverCore({}, p);
  check(p.calls.panel.length === 2 && p.calls.panel[0] === false && p.calls.panel[1] === true,
    'T8a 先收起、后展开', p.calls.panel);

  /* ---------- T9 并发守卫：同时只允许一次交接 ---------- */
  console.log('T9 并发守卫');
  reset();
  let releaseBarrier;
  const barrier = new Promise((res) => { releaseBarrier = res; });
  let firstCall;
  const p1 = makePorts({ switchAccount: async (acct) => { await barrier; p1.calls.switched.push(acct.uid); world.current = acct; return { ok: true }; } });
  const p2 = makePorts();
  firstCall = core.runLimitFailoverCore({}, p1);
  await new Promise((res) => setTimeout(res, 10)); // 让第一次先进入 inFlight
  const second = await core.runLimitFailoverCore({}, p2);
  check(second.ok === false && second.skipped === true, 'T9a 第二次调用被跳过', second);
  releaseBarrier();
  const first = await firstCall;
  check(first.ok === true, 'T9b 第一次调用正常完成', first);

  /* ---------- T10 失败回滚：切号过程中抛错 → 记 error 并继续找下一个 ---------- */
  console.log('T10 目标切号抛错');
  reset();
  p = makePorts({
    switchAccount: async (acct) => {
      if (acct.uid === 'B') { p.calls.switched.push('B(threw)'); throw new Error('模拟切换失败'); }
      p.calls.switched.push(acct.uid); world.current = acct; return { ok: true };
    },
  });
  r = await core.runLimitFailoverCore({}, p);
  check(r.ok === true && r.toUid === 'C', 'T10a B 抛错后 C 顶上', { ok: r.ok, toUid: r.toUid });
  st = readState();
  check(st.B && st.B.reason === 'error', 'T10b B 被记为 error', st);

  /* ---------- T11 pickFailoverTarget 的积分段偏好（直接测模块） ---------- */
  console.log('T11 积分段偏好');
  reset();
  const now = Date.now();
  const picked = limitFailover.pickFailoverTarget(
    [
      { uid: 'A' },
      { uid: 'B' },
      { uid: 'C', creditSegments: [{ remaining: 500, expiresAt: now + 3600e3 }] },
    ],
    'A', {}, now
  );
  check(picked && picked.account.uid === 'C' && picked.reason === 'credit', 'T11a 优先选还有余额的积分段账号', picked);

  /* ---------- 汇总 ---------- */
  console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
  if (failures.length) { failures.forEach((f) => console.log('  FAIL ' + f)); process.exitCode = 1; }
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
})().catch((e) => { console.error('\n测试中断:', e.message); if (failures.length) failures.forEach((f) => console.log('  FAIL ' + f)); process.exitCode = 1; });
