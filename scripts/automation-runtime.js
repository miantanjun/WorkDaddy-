'use strict';

// No credential is read until this policy has accepted the final request URL.
function assertAccountRequestUrl(url, apiHost) {
  const base = new URL(apiHost);
  const allowed = new Set([base.origin]);
  if (base.hostname === 'www.codebuddy.cn') {
    allowed.add('https://www.workbuddy.cn');
    allowed.add('https://workbuddy.cn');
    allowed.add('https://codebuddy.cn');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.origin)) {
    throw new Error('账号请求仅允许当前客户端的官方 HTTPS 接口');
  }
}
const STATE_V2_MARKER = '__workdaddyAutomationStateV2';
function createTaskState(taskId, read, write, now = Date.now) {
  const keyFor = (scope, uid, key) => {
    if (!['task','account'].includes(scope) || !String(key || '').trim()) throw new Error('状态 scope 或 key 无效');
    if (scope === 'account' && !uid) throw new Error('账号状态需要账号上下文');
    return JSON.stringify(['v2', taskId, scope, scope === 'account' ? String(uid) : '', key]);
  };
  return {
    get: async (scope,uid,key) => {
      const storageKey = keyFor(scope,uid,key);
      const state = read();
      const stored = state[storageKey];
      if (!stored || typeof stored !== 'object' || stored[STATE_V2_MARKER] !== true) return stored;
      if (Number.isFinite(stored.expiresAt) && now() >= stored.expiresAt) {
        delete state[storageKey];
        write(state);
        return undefined;
      }
      return stored.value;
    },
    set: async (scope,uid,key,value,detail = {}) => {
      // Each synchronous read/merge/write sees other runs' latest changes.
      const state = read();
      const ttlMs = Number(detail.ttlMs);
      state[keyFor(scope,uid,key)] = Number.isFinite(ttlMs) && ttlMs > 0
        ? { [STATE_V2_MARKER]: true, value, expiresAt: now() + ttlMs }
        : value;
      write(state);
    },
  };
}
async function cancellableWait(ms, isCancelled = () => false) {
  const end = Date.now() + ms;
  do {
    if (isCancelled()) throw new Error('任务已停止');
    await new Promise(resolve => setTimeout(resolve, Math.min(100,Math.max(0,end-Date.now()))));
  } while (Date.now() < end);
  if (isCancelled()) throw new Error('任务已停止');
}
function createRendererGate() {
  let busy = false;
  const queue = [];
  return async isCancelled => {
    const ticket = {}; queue.push(ticket);
    try {
      while (busy || queue[0] !== ticket) await cancellableWait(50,isCancelled);
      if (isCancelled()) throw new Error('任务已停止');
      queue.shift(); busy = true;
      let released = false;
      return () => { if (!released) { released = true; busy = false; } };
    } catch (error) { const index = queue.indexOf(ticket); if (index >= 0) queue.splice(index,1); throw error; }
  };
}

// Executed read-only inside the renderer. Never returns composer or message text.
// ⚠️ 与上游 1.2.6 的关系（有意的最小化取舍，不是漏改）：
//   上游把本函数改成 `probeSessionReceipt(expectedReceipt)`，同时**改写 busy 语义并删掉**
//   `hydrating` / `streaming` / `turnActive` 三个字段。本地**只取 requestId 绑定那一半**，
//   因为 daemon 有两处闸门依赖那三个字段与本地 busy 语义：
//     · daemon `waitForAutomationTurnState` → `if (!probe.streaming && !probe.turnActive)`（换号落定闸门）
//     · daemon `session.send` 发送前落定循环 → `if (!snap.busy) break` + `snap.busy && !snap.hydrating`
//   若照抄上游版，这两处会**静默失效**（字段变 undefined ⇒ 恒判「已落定」），属于典型的
//   「只换模块 = 静默退化」。故此处保留本地三字段与本地 busy，只补 requestId 作用域。
function probeSessionReceipt(expectedReceipt) {
  const compat = window.__wbsWorkBuddyCompat;
  if (!compat) return null;
  const selected = compat.getSelectedConversationId(document);
  const controller = (compat.findConversationControllers(document) || []).find(c => String(c.conversationId) === String(selected));
  if (!controller) return null;
  try {
    const state = controller.messageStore.getState();
    const session = controller.getSessionViewState();
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const users = messages.filter(m => (m.messageType || m.role) === 'user');
    // [上游 1.2.6 / 适配 WorkBuddy 5.6] 按**稳定 requestId** 绑定本轮请求：
    //   5.6 会把「乐观 user 消息」换成正式 ID（实测本机 15 条 user 里 10 条 id !== requestId，
    //   且消息带 `_optimistic` / `_optimisticRequestId`）⇒ 只认「最后一条」会在换 ID 的瞬间
    //   指向错的回合，等待判定随即误报「会话已有其他请求，已停止等待」。
    const expectedUserMessageId = String(expectedReceipt && expectedReceipt.userMessageId || '');
    const expectedRequestId = String(expectedReceipt && expectedReceipt.requestId || '');
    const user = (expectedUserMessageId || expectedRequestId)
      ? users.find(m => String(m.id || m.requestId || '') === expectedUserMessageId || String(m.requestId || '') === expectedRequestId) || users[users.length-1]
      : users[users.length-1];
    // ⚠️ 只有**显式传入 expectedRequestId** 时才按 requestId 作用域选 assistant：
    //   不传票据的调用点（发送前 before / 发送后 selected 快照）必须与改动前逐字等价，
    //   否则会波及 daemon 的「发送是否被受理」判定（比较 userMessageId 变化）。
    const assistants = messages.filter(m => (m.messageType || m.role) === 'assistant' && !/^timeline:/.test(String(m.id || '')));
    const last = expectedRequestId
      ? [...assistants].reverse().find(m => String(m.requestId || '') === expectedRequestId) || assistants[assistants.length-1]
      : assistants[assistants.length-1];
    const error = typeof controller.getErrorViewState === 'function' ? controller.getErrorViewState() : {};
    const extra = last && last.extra || {};
    return {
      conversationId:String(selected || ''),
      userMessageId:String(user && (user.id || user.requestId) || ''),
      requestId:String(state.streamingRequestId || user && user.requestId || ''),
      assistantId:String(last && (last.id || last.requestId) || ''),
      assistantRequestId:String(last && last.requestId || ''),
      complete:!!(last && (Object.prototype.hasOwnProperty.call(extra,'isRequestTerminal') ? extra.isRequestTerminal === true : last.complete === true)),
      cancelled:extra.isCancelled === true,
      error:!!(error && (error.error || error.hasError)),
      // v1.3.16：把 busy 的构成拆开暴露。原先只有一个 busy（含 hydrating），
      // 于是「历史还在 hydration」与「助手真的在回复」在日志里长得一样 ——
      // 2026-09-18 20:43 的「目标会话正在运行」就分不清是哪一种。
      // busy 本身保持原语义不变（waitAiIdle / receiptComplete 依赖它）。
      hydrating:!!(session && session.isHydrating),
      streaming:!!(state.streamingRequestId || state.streamingMessageId),
      turnActive:!!(session && (session.isBusy || session.isRunActive || session.isTurnActive || session.isSending || session.isPending)),
      busy:!!(state.streamingRequestId || state.streamingMessageId || session && (session.isBusy || session.isRunActive || session.isTurnActive || session.isSending || session.isPending || session.isHydrating)),
    };
  } catch (_) { return null; }
}
function receiptComplete(receipt, snapshot) {
  if (!snapshot || snapshot.conversationId !== receipt.conversationId) throw new Error('目标会话不再可见，已停止等待');
  // [上游 1.2.6 / 适配 WorkBuddy 5.6] `userMessageId` 在「乐观消息换正式 ID」时**会变**，
  // 但 `requestId` 稳定 ⇒ 只要 requestId 对得上就仍属本轮，不能判成「会话已有其他请求」。
  // 向后兼容：receipt.requestId 为空（旧回执）时退化为改动前的纯 userMessageId 比较。
  const snapshotRequestId = snapshot.requestId || snapshot.assistantRequestId || '';
  if (snapshot.userMessageId !== receipt.userMessageId && snapshotRequestId !== receipt.requestId) throw new Error('会话已有其他请求，已停止等待');
  if (snapshot.error || snapshot.cancelled) throw new Error('会话回复失败或已取消');
  if (receipt.requestId && snapshot.assistantRequestId && snapshot.assistantRequestId !== receipt.requestId) return false;
  return !!snapshot.assistantId && snapshot.assistantId !== receipt.baselineAssistantId && snapshot.complete && !snapshot.busy;
}
module.exports = {assertAccountRequestUrl,createTaskState,cancellableWait,createRendererGate,probeSessionReceipt,receiptComplete};
