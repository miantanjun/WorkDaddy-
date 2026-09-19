'use strict';
/*
 * test-failover-clock.js —— 模型限流切号的两处 P1/P2 修复（v1.4.1 §9-7）。
 *
 * 覆盖两个缺陷：
 *   ① 限流窗口的到期时刻由「每次现算 blockedAt + 窗口」改为标记当时写死的**绝对时刻**
 *      blockedUntil，并给「记录时刻晚于现在」这种只可能来自时钟回拨的记录加上不可信判据。
 *      旧行为：时钟被往回拨多久，账号就要多等「回拨量 + 窗口」才可能被重新选中 ——
 *      备用账号被静默废掉，而日志里只会写「其他账号都无法接管本次任务」。
 *   ② pickFailoverTarget 在选不出账号时返回裸 null，于是「压根没有别的账号」与
 *      「别的账号全在限流窗口里、最早 X 点可重试」在调用方看来完全一样（审查 P1-7）。
 *      改为返回带 reason 的结构化对象，并把最早恢复时刻一路带到提示、日志与返回值。
 *
 * 设计约束（照抄维护手册 §6）：
 *   1. 不 require daemon.js（它 require 即起 HTTP 服务）—— 切片 + new Function 注入依赖；
 *   2. limit-failover.js 没有副作用，直接 require 真跑；
 *   3. daemon.js 是 CRLF，切片前先归一化为 LF；
 *   4. 时刻全部用**固定基准 T0**，断言不依赖真实时钟。
 *
 * 跑法：node .wd-analysis/test-failover-clock.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(title) { console.log(title); }

const lf = require(path.join(ROOT, 'scripts', 'limit-failover.js'));
const CL = require(path.join(ROOT, 'scripts', 'account-switch-log.js'));
const W = lf.LIMIT_FAILOVER_WINDOW_MS;

/* ==================================================================== */
section('[A] limit-failover.js：到期时刻绝对化 + 时钟回拨');
/* ==================================================================== */

// 固定基准时刻。用常量而不是 Date.now()：断言只跟「记录时刻 / 判据时刻」的差有关，
// 跟跑测试的钟没关系。
const T0 = 1758300000000;

const st1 = lf.markAccountBlocked({}, 'u1', T0, 'detected');
ok(st1.u1.blockedAt === T0 && st1.u1.blockedUntil === T0 + W,
  'A1 markAccountBlocked 同时写 blockedAt 与 blockedUntil（until = at + 窗口）', st1.u1);
ok(lf.isAccountBlocked(st1, 'u1', T0 + 1000, W) === true, 'A2 窗口内 → 仍算被限流');
ok(lf.isAccountBlocked(st1, 'u1', T0 + W - 1, W) === true, 'A3 到期前一毫秒仍算被限流');
ok(lf.isAccountBlocked(st1, 'u1', T0 + W, W) === false, 'A4 到点即放行（now === blockedUntil 不放行就永远差一毫秒）');

// 老格式向后兼容：v1.4.1 之前落盘的状态文件里只有 blockedAt。
const legacy = { u2: { blockedAt: T0, reason: 'detected' } };
ok(lf.isAccountBlocked(legacy, 'u2', T0 + 60000, W) === true, 'A5 老格式（只有 blockedAt）仍判「窗口内」');
ok(lf.isAccountBlocked(legacy, 'u2', T0 + W + 1, W) === false, 'A6 老格式：窗口过去后放行');
ok(lf.isAccountBlocked({}, 'u9', T0, W) === false, 'A7 没有任何记录 → 不算被限流');
ok(lf.isAccountBlocked(null, 'u9', T0, W) === false, 'A8 state 不是对象（文件读坏了）→ 不算被限流');

// 时钟回拨：标记当时钟快了整整两个窗口，之后被校正回来。
const skewed = { u3: { blockedAt: T0 + 2 * W, blockedUntil: T0 + 3 * W, reason: 'detected' } };
ok(lf.isAccountBlocked(skewed, 'u3', T0, W) === false,
  'A9 时钟回拨（记录时刻晚于现在一个窗口以上）→ 判为不可信并放行，不再静默多等「回拨量 + 窗口」');
ok(lf.entryBlockedUntil(skewed.u3, W, T0) === 0, 'A10 entryBlockedUntil 对不可信记录返回 0');

// 容差以内不算回拨：窗口量级以内的偏差不值得引入额外不确定性。
const slightlyFuture = { u4: { blockedAt: T0 + Math.floor(W / 2), reason: 'detected' } };
ok(lf.isAccountBlocked(slightlyFuture, 'u4', T0, W) === true,
  'A11 偏差不足一个窗口 → 仍按记录判被限流（不误放行）');
ok(lf.BLOCKED_AT_FUTURE_TOLERANCE_MS === W,
  'A12 回拨容差取一整个限流窗口（与窗口绑定，不各写一份常量）', lf.BLOCKED_AT_FUTURE_TOLERANCE_MS);

/* ==================================================================== */
section('\n[B] pickFailoverTarget：结构化「选不出账号」');
/* ==================================================================== */

const accountsABC = [{ uid: 'A' }, { uid: 'B' }, { uid: 'C' }];
let blockedState = lf.markAccountBlocked({}, 'B', T0 - 60000, 'detected');
blockedState = lf.markAccountBlocked(blockedState, 'C', T0 - 120000, 'still-limited');

const pick1 = lf.pickFailoverTarget(accountsABC, 'A', blockedState, T0);
ok(pick1 && pick1.account === null && pick1.reason === 'all-blocked',
  'B1 全池被限 → account=null 且 reason=all-blocked（不再返回裸 null）', pick1);
// B：T0-120000 判的，所以 C 的解除时刻最早，earliestRecovery 必须取 C 那个。
ok(pick1.earliestRecovery === (T0 - 120000) + W,
  'B2 earliestRecovery = 最早解除的那个账号的时刻（取 min，不是随便挑一个）',
  { got: pick1.earliestRecovery, want: (T0 - 120000) + W });
ok(pick1.blocked.length === 2 && pick1.blocked.every((item) => item.until > T0),
  'B3 blocked 列出全部被限账号及其解除时刻（用于告诉用户等谁）', pick1.blocked);

const pick2 = lf.pickFailoverTarget([{ uid: 'A' }], 'A', {}, T0);
ok(pick2 && pick2.account === null && pick2.reason === 'no-others',
  'B4 只有当前账号 → reason=no-others（与 all-blocked 分开）', pick2);

const pick3 = lf.pickFailoverTarget(accountsABC, 'A', { B: { blockedAt: T0, reason: 'detected' } }, T0);
ok(pick3.account && pick3.account.uid === 'C', 'B5 只从「没被限流」的账号里选（B 被跳过）', pick3);
ok(pick3.blocked.length === 0 && pick3.earliestRecovery === 0,
  'B6 成功分支的 blocked/earliestRecovery 也是同一种形状（消费方不必判字段在不在）', pick3);

// 对照组：把旧实现逐字照搬，证明它确实分不清这两种情形。
const legacyPick = (accounts, currentUid, state, now) => {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && String(a.uid || ''));
  const others = list.filter((a) => String(a.uid) !== String(currentUid || ''));
  if (!others.length) return null;
  const fresh = others.filter((a) => !lf.isAccountBlocked(state, a.uid, now, W));
  return fresh.length ? { account: fresh[0] } : null;
};
const legacyBoth = [legacyPick([{ uid: 'A' }], 'A', {}, T0), legacyPick(accountsABC, 'A', blockedState, T0)];
ok(legacyBoth[0] === null && legacyBoth[1] === null,
  'B7 对照：旧实现在「没别的账号」和「全被限流」两种情形下都只给 null（无从区分）', legacyBoth);
ok(pick1.reason !== pick2.reason, 'B8 新实现给出两个不同的 reason', [pick1.reason, pick2.reason]);

/* ==================================================================== */
section('\n[C] daemon.js 接线（源码切片 + 全文断言）');
/* ==================================================================== */

const src = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');

// C1~C4 断言在 runLimitFailoverCore 内部，先切出这个函数体。
const coreStart = src.indexOf('/* ---------------- 模型限流自动切号续跑 ---------------- */');
const coreAnchor = src.indexOf('async function runLimitFailoverCore(detail, ports) {', coreStart);
if (coreStart < 0 || coreAnchor < 0) {
  console.log('  FAIL C0 找不到限流切号代码块 / runLimitFailoverCore 锚点');
  process.exit(1);
}
let depth = 0;
let coreEnd = -1;
for (let i = src.indexOf('{', coreAnchor); i < src.length; i += 1) {
  if (src[i] === '{') depth += 1;
  else if (src[i] === '}') { depth -= 1; if (depth === 0) { coreEnd = i + 1; break; } }
}
if (coreEnd < 0) { console.log('  FAIL C0 runLimitFailoverCore 大括号配平失败'); process.exit(1); }
const core = src.slice(coreStart, coreEnd);

const guardIdx = core.indexOf('if (!pick || !pick.account)');
const triedIdx = core.indexOf('if (tried.includes(pick.account.uid)) break;');
ok(guardIdx > 0 && triedIdx > guardIdx,
  'C1 循环里「选不出账号」的判据排在使用 pick.account 之前（否则会读 null.uid 直接抛）',
  { guard: guardIdx, tried: triedIdx });
ok(/const nothingToTry = tried\.length === 0;/.test(core)
  && /const allBlocked = nothingToTry && !!\(emptyPick && emptyPick\.reason === 'all-blocked'\);/.test(core),
  'C2 收尾用 emptyPick.reason 区分「全在限流窗口里」，并用 tried 区分「一开始就没得选」与「试过都没顶上来」');
ok(core.indexOf('都在限流窗口内') > 0 && core.indexOf('后可重试') > 0,
  'C3 「全在限流窗口里」的提示带上了最早可重试时刻');
ok(/const failReason = allBlocked \? 'all-blocked' : \(noOthers \? 'no-others' : 'no-usable-target'\);/.test(core)
  && /return \{ ok: false, reason: failReason, tried, error: lastError, modelId, fromUid: current\.uid, earliestRecovery: recoveryAt \|\| null \};/.test(core),
  'C4 返回值把三种原因与最早恢复时刻一起透出去（不再是单一的 no-usable-target）');

ok(/function limitFailoverBlockedUntil[\s\S]{0,400}?limitFailover\.entryBlockedUntil\(entry, limitFailover\.LIMIT_FAILOVER_WINDOW_MS, Date\.now\(\)\)/.test(src),
  'C5 limitFailoverBlockedUntil 改走 limit-failover.js 的唯一真相（不再自己算 blockedAt + 常量）');
ok(/function limitFailoverBlockedUntil[\s\S]{0,400}?return at \+ limitFailover\.LIMIT_FAILOVER_WINDOW_MS;/.test(src) === false,
  'C5b 旧的「自己算一遍」写法已彻底移除（两处口径不能各算各的）');
ok(/earliestRecovery: Number\(result\.earliestRecovery\) \|\| 0,/.test(src),
  'C6 handleLimitFailoverOutcome 把 earliestRecovery 交给桌面日志');

/* ==================================================================== */
section('\n[D] 桌面大白话日志：all-blocked 文案');
/* ==================================================================== */

// 用「渲染出来的正文」断言收录情况，而不是去读模块私有表 —— 表不是导出面，
// 而用户能看到的只有正文。
const dReason = CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'all-blocked' });
ok(dReason.indexOf('全都还在限流窗口里') > 0,
  'D1 all-blocked 有中文文案（未收录会把英文 reason 原样吐给用户）',
  dReason.split('\n').filter((l) => l.indexOf('卡在哪') >= 0));
const dNoOthers = CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'no-others' });
ok(dNoOthers.indexOf('没有别的账号可以接管') > 0,
  'D1b no-others 也有中文文案（同理）',
  dNoOthers.split('\n').filter((l) => l.indexOf('卡在哪') >= 0));
const recAt = new Date(2026, 8, 20, 14, 35, 0).getTime();
const dText = CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'all-blocked', earliestRecovery: recAt });
ok(dText.indexOf('最早') > 0 && dText.indexOf('14:35') > 0,
  'D2 all-blocked 段落写明「最早几点可以再试一次」', dText.split('\n').filter((l) => l.indexOf('卡在哪') >= 0));
const dNoTime = CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'all-blocked' });
ok(dNoTime.indexOf('最早') < 0, 'D3 没有 earliestRecovery 时不硬编一个时间出来');
ok(CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'no-usable-target' }).indexOf('20 秒内没看到正常回复') > 0,
  'D4 旧 reason 的原文案没有被改坏');

/* ==================================================================== */
section('\n[E] 沙箱真跑 runLimitFailoverCore（端到端走一遍）');
/* ==================================================================== */

// 沙箱跑真实核心需要 await，按本目录既有做法包一层 async IIFE（顶层 await 会让
// Node 判定本文件「模块格式有歧义」直接报 ERR_AMBIGUOUS_MODULE_SYNTAX）。
(async function run() {
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-failover-clock-'));
const logs = [];
const world = {
  current: { uid: 'A', nickname: '账号A' },
  accounts: [{ uid: 'A', nickname: '账号A' }, { uid: 'B', nickname: '账号B' }, { uid: 'C', nickname: '账号C' }],
};

const factory = new Function(
  'path', 'DATA_DIR', 'fs', 'log',
  'cachedCreditRotationAccounts', 'listAccounts',
  'limitFailover', 'currentAccount', 'sleep',
  'readAutomations', 'automationRuns', 'automationPublicRun',
  core + '\nreturn { runLimitFailoverCore: runLimitFailoverCore, STATE_FILE: LIMIT_FAILOVER_STATE_FILE };'
);
const coreApi = factory(
  path,
  stateDir,
  fs,
  (m) => logs.push(m),
  () => [],
  () => world.accounts,
  lf,
  () => world.current,
  () => Promise.resolve(),
  () => [{ id: 't1', name: '限流切号续跑', enabled: true, steps: [{ op: 'account.failoverContinue' }] }],
  new Map(),
  (r) => r
);
const STATE_FILE = coreApi.STATE_FILE;
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s));

function makePorts() {
  const calls = { switched: [], notified: [] };
  return {
    calls,
    readBanner: async () => ({ ok: true, hit: false, count: 0, hits: [] }),
    replyStarted: async () => true,
    readModel: async () => ({ ok: true, model: 'deepseek-v4.1-flash', conversationId: 'conv-1' }),
    setModel: async (m) => ({ ok: true, model: m, changed: true }),
    readTaskText: async () => ({ ok: true, text: '请把这段合同的关键条款列出来' }),
    switchAccount: async (acct) => { calls.switched.push(acct.uid); world.current = acct; return { ok: true }; },
    ensureNewTask: async () => ({}),
    sendPhrase: async () => ({}),
    guard: async () => {},
    notify: async (level, message) => { calls.notified.push([level, message]); },
    log: (m) => logs.push(m),
    setPanelOpen: async () => ({}),
    wasPanelOpen: false,
  };
}
function resetLogs() { logs.length = 0; }

// E1：其他账号全在限流窗口里。
writeState({ B: { blockedAt: Date.now() - 60000, reason: 'detected' }, C: { blockedAt: Date.now() - 30000, reason: 'detected' } });
world.current = { uid: 'A', nickname: '账号A' };
resetLogs();
{
  const p = makePorts();
  const res = await coreApi.runLimitFailoverCore({}, p);
  const err = p.calls.notified.filter((n) => n[0] === 'error').map((n) => n[1]).join(' | ');
  ok(res.ok === false && res.reason === 'all-blocked', 'E1a 返回 reason=all-blocked', res);
  ok(err.indexOf('都在限流窗口内') > 0 && /最早 \d{2}:\d{2} 后可重试/.test(err),
    'E1b 提示写明「都在限流窗口内」+ 最早重试时刻', err);
  ok(p.calls.switched.length === 0, 'E1c 一次都没切号', p.calls.switched);
  ok(res.earliestRecovery > Date.now(), 'E1d 返回值带上最早恢复时刻（给上层/日志用）', res.earliestRecovery);
  ok(logs.some((l) => l.indexOf('limit-failover:exhausted') >= 0 && l.indexOf('"reason":"all-blocked"') > 0),
    'E1e 运行日志里记了结构化原因', logs.filter((l) => l.indexOf('exhausted') >= 0));
}

// E2：只有当前账号可用。
world.accounts = [{ uid: 'A', nickname: '账号A' }];
writeState({});
resetLogs();
{
  const p = makePorts();
  const res = await coreApi.runLimitFailoverCore({}, p);
  const err = p.calls.notified.filter((n) => n[0] === 'error').map((n) => n[1]).join(' | ');
  ok(res.ok === false && res.reason === 'no-others', 'E2a 无其他账号 → reason=no-others', res);
  ok(err.indexOf('没有别的账号可以接管') >= 0 && err.indexOf('都无法接管') < 0,
    'E2b 这种情况说清「为什么没得换」，不套用「都无法接管」', err);
}

// E3：正常路径不受影响。
world.accounts = [{ uid: 'A', nickname: '账号A' }, { uid: 'B', nickname: '账号B' }, { uid: 'C', nickname: '账号C' }];
writeState({ B: { blockedAt: Date.now(), reason: 'detected' } });
world.current = { uid: 'A', nickname: '账号A' };
resetLogs();
{
  const p = makePorts();
  const res = await coreApi.runLimitFailoverCore({}, p);
  ok(res.ok === true && res.toUid === 'C', 'E3 有可用账号时照旧切过去（skip B）', { ok: res.ok, toUid: res.toUid });
}

// E4：B、C 都试过、都被判定「仍处于限流」→ 这是**试出来的**结果，不能报成「一开始全在窗口里」。
world.accounts = [{ uid: 'A', nickname: '账号A' }, { uid: 'B', nickname: '账号B' }, { uid: 'C', nickname: '账号C' }];
writeState({});
world.current = { uid: 'A', nickname: '账号A' };
resetLogs();
{
  const p = makePorts();
  // 每次发完都立刻又看到限流横幅 → 每个候选都会被记成 still-limited
  p.readBanner = async () => ({ ok: true, hit: true, count: 1, hits: [] });
  p.replyStarted = async () => false;
  const res = await coreApi.runLimitFailoverCore({}, p);
  const err = p.calls.notified.filter((n) => n[0] === 'error').map((n) => n[1]).join(' | ');
  ok(res.ok === false && res.reason === 'no-usable-target' && res.tried.length === 2,
    'E4a 试过 B/C 都没顶上来 → reason=no-usable-target（不是 all-blocked）', res);
  ok(err.indexOf('其他账号都无法接管本次任务') >= 0 && err.indexOf('都在限流窗口内') < 0,
    'E4b 这种情形沿用原文案，不谎称「一开始都在窗口里」', err);
}

/* ==================================================================== */
console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
})().catch((e) => {
  console.error('\n测试中断: ' + (e && e.stack || e));
  if (failures.length) failures.forEach((f) => console.log('  FAIL ' + f));
  process.exitCode = 1;
});
