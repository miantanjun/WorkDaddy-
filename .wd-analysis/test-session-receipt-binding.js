'use strict';
/*
 * test-session-receipt-binding.js —— 「会话回执按 requestId 绑定」的守卫（上游 1.2.6 吸纳 · 批次 4 第 3 项）。
 *
 * 为什么需要它（实测依据）：
 *   WorkBuddy 5.6 起会把「乐观 user 消息」换成正式 ID。CDP 实测本机 5.6.2 的当前会话：
 *     15 条 user 消息里 **10 条 `id !== requestId`**，且消息带 `_optimistic` / `_optimisticRequestId`。
 *   本地旧实现 `probeSessionReceipt()` **无参**、`receiptComplete` 只比 `userMessageId`：
 *     `userMessageId = user.id || user.requestId` ⇒ ID 一换就与回执对不上
 *     ⇒ 抛「会话已有其他请求，已停止等待」⇒ **自动化「发送并等待」被误打断**（5.6 新引入）。
 *   上游 1.2.6（1.2.131）正是为此改成按稳定 `requestId` 绑定。
 *
 * ⚠️ 本套件同时守一件事：**不许照抄上游那半截**。
 *   上游版还改写了 `busy` 语义并**删掉** `hydrating` / `streaming` / `turnActive`；
 *   而 daemon 的换号落定闸门与发送前落定循环依赖它们 ⇒ 照抄会「静默退化」。
 *   本套件 [C] 组就是钉死这一点。
 *
 * 跑法：node .wd-analysis/test-session-receipt-binding.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RT_FILE = path.join(ROOT, 'scripts', 'automation-runtime.js');
const DAEMON_FILE = path.join(ROOT, 'scripts', 'daemon.js');

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

const RT_SRC = fs.readFileSync(RT_FILE, 'utf8');
const DAEMON_SRC = fs.readFileSync(DAEMON_FILE, 'utf8');
const rt = require(RT_FILE);

/* ==================================================================== */
section('[A] 落地形态：只取「requestId 绑定」那一半，且注入点真的传了票据');
/* ==================================================================== */

ok(/function probeSessionReceipt\(expectedReceipt\)/.test(RT_SRC),
  'A1 probeSessionReceipt 已接受 expectedReceipt 形参');
ok(/const snapshotRequestId = snapshot\.requestId \|\| snapshot\.assistantRequestId \|\| '';/.test(RT_SRC)
  && /snapshot\.userMessageId !== receipt\.userMessageId && snapshotRequestId !== receipt\.requestId/.test(RT_SRC),
  'A2 receiptComplete 已加 `snapshotRequestId` 回退（requestId 对得上就不算「别的请求」）');
ok(/const readSession = async \(expectedReceipt = null\) =>/.test(DAEMON_SRC)
  && /'\)\(' \+ JSON\.stringify\(expected\) \+ '\)'/.test(DAEMON_SRC),
  'A3 daemon.readSession 接受 expectedReceipt，并把票据 **序列化进注入表达式**');
ok(/const snapshot = await readSession\(receipt\);/.test(DAEMON_SRC),
  'A4 daemon 的 session.wait 用 `readSession(receipt)` —— 唯一传票据的调用点');
{
  const calls = (DAEMON_SRC.match(/await readSession\((.*?)\)/g) || []);
  const withArg = calls.filter((c) => /readSession\(\s*receipt\s*\)/.test(c)).length;
  ok(calls.length === 6 && withArg === 1,
    'A5 其余 5 处 `readSession()` 保持无参（before / selected / 发送确认快照语义与改动前逐字等价）',
    { total: calls.length, withArg });
}
{
  const rtStateFn = DAEMON_SRC.slice(DAEMON_SRC.indexOf('async function readAutomationTurnState('),
    DAEMON_SRC.indexOf('async function readAutomationTurnState(') + 600);
  ok(rtStateFn.includes("probeSessionReceipt.toString() + ')()"),
    'A6 仅剩的空参注入点是 readAutomationTurnState（纯状态读取，不参与等待判定；传 undefined ≡ 传 null ⇒ 行为不变）');
  ok(!DAEMON_SRC.replace(rtStateFn, '').includes("probeSessionReceipt.toString() + ')()"),
    'A7 除它之外没有第二处空参注入');
}

/* ==================================================================== */
section('[B] 行为：用假 renderer 驱动真函数');
/* ==================================================================== */

const CONV = 'conv-1';
let RENDERER = null;

function installRenderer({ messages, streamingRequestId = '', streamingMessageId = '', session = {} }) {
  const controller = {
    conversationId: CONV,
    messageStore: { getState: () => ({ messages, streamingRequestId, streamingMessageId }) },
    getSessionViewState: () => session,
    getErrorViewState: () => ({}),
  };
  RENDERER = controller;
  global.window = {
    __wbsWorkBuddyCompat: {
      getSelectedConversationId: () => CONV,
      findConversationControllers: () => [controller],
    },
  };
  global.document = {};
}

const userMsg = (id, requestId, extra) =>
  Object.assign({ id, requestId, messageType: 'user', content: [] }, extra || {});
const asstMsg = (id, requestId, terminal, extra) =>
  Object.assign({ id, requestId, messageType: 'assistant', complete: terminal, extra: Object.assign({ isRequestTerminal: terminal }, extra || {}) });

/* --- B1/B2/B3：乐观 ID 被换掉后，等待判定不该再误报 --- */
{
  const REQ = 'req-A';
  // 回执是在「乐观」阶段抓的：userMessageId 还是乐观 id
  const receiptA = { conversationId: CONV, userMessageId: 'opt-A', requestId: REQ, baselineAssistantId: 'asst-before' };

  installRenderer({
    messages: [userMsg('real-A', REQ, { _optimistic: true }), asstMsg('asst-A', REQ, false)],
    streamingRequestId: REQ,
  });
  const snap1 = rt.probeSessionReceipt(receiptA);
  ok(snap1 && snap1.userMessageId === 'real-A' && snap1.requestId === REQ,
    'B1 按 requestId 命中本轮 user（id 已换成 real-A，不再是乐观 id）', snap1 && { u: snap1.userMessageId, r: snap1.requestId });

  let threw = null;
  try { rt.receiptComplete(receiptA, snap1); } catch (e) { threw = e.message; }
  ok(threw === null,
    'B2 ⭐ ID 被换掉也不抛「会话已有其他请求」（这正是 5.6 新引入的误报，改前必抛）', threw);
  ok(rt.receiptComplete(receiptA, snap1) === false,
    'B3 回合未结束 ⇒ 返回 false（继续等，属正常）');

  // 回合结束
  installRenderer({
    messages: [userMsg('real-A', REQ), asstMsg('asst-A', REQ, true)],
    streamingRequestId: '',
  });
  const snap2 = rt.probeSessionReceipt(receiptA);
  ok(rt.receiptComplete(receiptA, snap2) === true,
    'B4 本轮 assistant 落到终态且无在飞 ⇒ 判定完成（complete=true / busy=false）',
    { complete: snap2.complete, busy: snap2.busy, assistantId: snap2.assistantId });
}

/* --- B5：多回合并存时，选中「本轮」而不是「最后一条」 --- */
{
  const receiptA = { conversationId: CONV, userMessageId: 'real-A', requestId: 'req-A', baselineAssistantId: 'asst-before' };
  installRenderer({
    messages: [
      userMsg('real-A', 'req-A'), asstMsg('asst-A', 'req-A', true),
      userMsg('real-B', 'req-B'), asstMsg('asst-B', 'req-B', false),
    ],
    streamingRequestId: 'req-B',
  });
  const snap = rt.probeSessionReceipt(receiptA);
  ok(snap.assistantId === 'asst-A' && snap.assistantRequestId === 'req-A' && snap.complete === true,
    'B5 ⭐ 等待 A 时命中的是 A 的 assistant（不是「最后一条」B）—— 完成判定不再被别的回合带偏',
    { a: snap.assistantId, r: snap.assistantRequestId, c: snap.complete });

  // ⚠️ 有意保留的取舍（与上游不同，非漏改）：
  //   本地 busy 是**会话级**（含 isHydrating / streaming / session.isBusy 等）。A 已完成但**同一会话
  //   里另一个请求仍在流式**时，本地 busy=true ⇒ 这里返回 false（继续等会话空闲）。
  //   上游的作用域版 busy 会在这里返回 true。代价是**更晚判定完成**（有界：受 session.wait 超时约束），
  //   换来的是 daemon 两处闸门（换号落定 / 发送前落定）语义与改动前逐字一致。
  //   真实链路里同一个 composer 是单飞的，这个分支极少进入；进入也只是延迟，不会误判完成。
  ok(rt.receiptComplete(receiptA, snap) === false,
    'B6 ⭐【有意取舍】A 已完成但**别的请求在流式** ⇒ 保守返回 false（会话级 busy 未清；延迟而非错误）');
}

/* --- B6b：本轮独占流式时，完成即判定完成（真实主路径） --- */
{
  const REQ = 'req-A';
  const receiptA = { conversationId: CONV, userMessageId: 'real-A', requestId: REQ, baselineAssistantId: 'asst-before' };
  installRenderer({
    messages: [userMsg('real-A', REQ), asstMsg('asst-A', REQ, true)],
    streamingRequestId: '',
  });
  ok(rt.receiptComplete(receiptA, rt.probeSessionReceipt(receiptA)) === true,
    'B6b 会话空闲 + 本轮 assistant 终态 ⇒ 判定完成（主路径）');
}

/* --- B7：反向守卫 —— 真的换了回合仍要拦下（防过度放宽） --- */
{
  const receiptA = { conversationId: CONV, userMessageId: 'real-A', requestId: 'req-A', baselineAssistantId: 'x' };
  installRenderer({
    messages: [userMsg('real-B', 'req-B'), asstMsg('asst-B', 'req-B', false)],
    streamingRequestId: 'req-B',
  });
  const snap = rt.probeSessionReceipt(receiptA);
  let threw = null;
  try { rt.receiptComplete(receiptA, snap); } catch (e) { threw = e.message; }
  ok(threw === '会话已有其他请求，已停止等待',
    'B7 ⭐ 本轮的 user/assistant 都不在（换了回合）⇒ 仍然抛「会话已有其他请求」（没有把守卫改没了）', threw);
}

/* --- B8：会话不可见 / 回复失败仍照旧拦 --- */
{
  installRenderer({ messages: [] });
  let t1 = null; try { rt.receiptComplete({ conversationId: 'other', userMessageId: 'u', requestId: 'r' }, { conversationId: CONV }); } catch (e) { t1 = e.message; }
  ok(t1 === '目标会话不再可见，已停止等待', 'B8 会话不可见仍抛原错误');
  let t2 = null;
  try { rt.receiptComplete({ conversationId: CONV, userMessageId: 'u', requestId: 'r' }, { conversationId: CONV, userMessageId: 'u', requestId: 'r', error: true }); } catch (e) { t2 = e.message; }
  ok(t2 === '会话回复失败或已取消', 'B9 error/cancelled 仍抛原错误');
}

/* --- B10：向后兼容 —— 旧回执没有 requestId 时，退化为纯 userMessageId 比较 --- */
{
  installRenderer({
    messages: [userMsg('real-A', 'req-A'), asstMsg('asst-A', 'req-A', true)],
    streamingRequestId: '',
  });
  const legacy = { conversationId: CONV, userMessageId: 'real-A', baselineAssistantId: 'x' };
  ok(rt.receiptComplete(legacy, rt.probeSessionReceipt(null)) === true,
    'B10 旧回执（无 requestId）userMessageId 对得上 ⇒ 正常完成（与改动前一致）');
  const legacyMismatch = { conversationId: CONV, userMessageId: 'someone-else', baselineAssistantId: 'x' };
  let threw = null;
  try { rt.receiptComplete(legacyMismatch, rt.probeSessionReceipt(null)); } catch (e) { threw = e.message; }
  ok(threw === '会话已有其他请求，已停止等待',
    'B11 旧回执 + userMessageId 对不上 ⇒ 仍抛（兼容路径没有被放宽）', threw);
}

/* --- B12：不传票据 = 改动前的语义（last = 最后一条 assistant） --- */
{
  installRenderer({
    messages: [
      userMsg('real-A', 'req-A'), asstMsg('asst-A', 'req-A', true),
      userMsg('real-B', 'req-B'), asstMsg('asst-B', 'req-B', false),
    ],
    streamingRequestId: '',
  });
  const snap = rt.probeSessionReceipt();
  ok(snap.assistantId === 'asst-B' && snap.assistantRequestId === 'req-B',
    'B12 ⭐ 不传票据时仍取「最后一条 assistant」（发送前 before / 发送后 selected 快照必须不变）',
    { a: snap.assistantId, r: snap.assistantRequestId });
  ok(snap.userMessageId === 'real-B', 'B13 不传票据时仍取「最后一条 user」');
}

/* --- B14：四字段仍在（防上游式静默退化） --- */
{
  installRenderer({
    messages: [userMsg('real-A', 'req-A'), asstMsg('asst-A', 'req-A', false)],
    streamingRequestId: 'req-A', session: { isHydrating: true, isBusy: false },
  });
  const snap = rt.probeSessionReceipt();
  const has = (k) => Object.prototype.hasOwnProperty.call(snap, k);
  ok(has('hydrating') && has('streaming') && has('turnActive') && has('busy'),
    'B14 ⭐ hydrating / streaming / turnActive / busy 四字段齐备（上游版会删掉前三者）',
    Object.keys(snap));
  ok(snap.hydrating === true && snap.streaming === true,
    'B15 hydrating / streaming 取值正确（daemon 的换号落位闸门靠它们）', { h: snap.hydrating, s: snap.streaming });
  ok(snap.busy === true && /session\.isHydrating/.test(RT_SRC),
    'B16 busy 仍是**本地会话级**版本（含 isHydrating 项）—— 未采用上游的作用域版 busy');
}

/* ==================================================================== */
section('[C] 源码锚点：本地两处闸门依赖的判据没有被改坏');
/* ==================================================================== */

ok(/if \(!probe\.streaming && !probe\.turnActive\) return \{ ok: true, reason: 'settled'/.test(DAEMON_SRC),
  'C1 换号落定闸门仍用 `probe.streaming` / `probe.turnActive`');
ok(/if \(!snap\.busy\) break;/.test(DAEMON_SRC) && /if \(snap\.busy && !snap\.hydrating\)/.test(DAEMON_SRC),
  'C2 发送前落定循环仍用 `snap.busy` + `snap.hydrating`');
ok(RT_SRC.includes('有意的最小化取舍') && RT_SRC.includes('只取 requestId 绑定那一半'),
  'C3 代码里留了「为什么只取上游一半」的说明（防止后人「补全」成静默退化）');

/* ---- 清理 ---- */
delete global.window;
delete global.document;

console.log('');
console.log('结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
