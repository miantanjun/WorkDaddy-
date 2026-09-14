'use strict';
/**
 * 「非主账号闲置超时 → 自动切回主账号」的配置、活动探测与决策。
 *
 * 用户诉求（2026-09-14）：当前用的是非主账号时，如果上一轮会话任务结束后**连续闲置**超过阈值
 * （默认 30 分钟，可自行调节），自动切回主账号。
 *
 * 语义（改之前先读）：
 *   · 「活动」= 四件事任一发生：有新消息 / 回复正在生成 / 输入框里有草稿 / 定时任务在跑。
 *     只要有一件发生，闲置计时就归零。
 *   · 「闲置」= 距离最后一次活动的时间。达到阈值才切回。
 *   · 不切的情况：功能关闭、没设主账号、已经在主账号上、主账号不是可用账号、
 *     主账号还在限流窗口内（窗口内切回去立刻又会被限流，没意义 —— 下一拍再看）。
 *   · 账号切换会整页 reload，所以判定「正在生成」时绝不切（会把任务掐死）。
 *
 * 本模块不碰 daemon：全部纯函数 / 可注入 fs，daemon 只负责按拍调用 + 真正执行切号。
 * 单测：.wd-analysis/test-idle-switchback.js
 */

const fsDefault = require('node:fs');
const path = require('node:path');

const DEFAULTS = { enabled: true, minutes: 30, collapsed: true };
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;
const CONFIG_FILE = 'idle-switchback.json';
const STATE_FILE = 'idle-switchback-state.json';

function clampMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.minutes;
  // 显式写 0 = 关掉（手工改配置文件时的语义）；其余一律夹到 5 ~ 1440
  if (n === 0) return 0;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
}

function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    enabled: r.enabled === undefined || r.enabled === null ? DEFAULTS.enabled : !!r.enabled,
    minutes: clampMinutes(r.minutes === undefined || r.minutes === null ? DEFAULTS.minutes : r.minutes),
    // 卡片折叠状态：存在后端，切号会整页刷新，放前端会丢
    collapsed: r.collapsed === undefined || r.collapsed === null ? DEFAULTS.collapsed : !!r.collapsed,
  };
}

function emptyState(uid) {
  return { uid: String(uid || ''), lastActivityAt: 0, fingerprint: '', fingerprintAt: 0, lastReason: '' };
}

function resetState(uid, now) {
  return { uid: String(uid || ''), lastActivityAt: Number(now) || 0, fingerprint: '', fingerprintAt: Number(now) || 0, lastReason: 'reset' };
}

/** 配置读写（独立小文件，和 primary-account.json 同一套路：临时文件 + rename，避免写坏） */
function createIdleSwitchbackStore(dataDir, fsImpl) {
  const io = fsImpl || fsDefault;
  const file = path.join(String(dataDir || ''), CONFIG_FILE);
  function get() {
    try { return normalizeConfig(JSON.parse(io.readFileSync(file, 'utf8'))); } catch (_) { return normalizeConfig({}); }
  }
  function set(patch) {
    const next = normalizeConfig(Object.assign({}, get(), patch && typeof patch === 'object' ? patch : {}));
    const dir = path.dirname(file);
    io.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    io.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    io.renameSync(tmp, file);
    return next;
  }
  return { get, set, file };
}

/** 闲置计时状态（内存为主，落盘是为了 daemon 重启不把计时清零） */
function createIdleSwitchbackStateStore(dataDir, fsImpl) {
  const io = fsImpl || fsDefault;
  const file = path.join(String(dataDir || ''), STATE_FILE);
  function get() {
    try {
      const raw = JSON.parse(io.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState('');
      return {
        uid: String(raw.uid || ''),
        lastActivityAt: Number(raw.lastActivityAt) || 0,
        fingerprint: String(raw.fingerprint || ''),
        fingerprintAt: Number(raw.fingerprintAt) || 0,
        lastReason: String(raw.lastReason || ''),
      };
    } catch (_) { return emptyState(''); }
  }
  function set(state) {
    const value = state && typeof state === 'object' ? state : emptyState('');
    try {
      io.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp-' + process.pid;
      io.writeFileSync(tmp, JSON.stringify(value) + '\n');
      io.renameSync(tmp, file);
    } catch (_) { /* 状态写不进去不影响判定（退化成内存计时） */ }
    return value;
  }
  return { get, set, file };
}

/**
 * 页面活动探测：一次拿齐「是否需要重置闲置计时」的全部信号。
 * 返回 {ok, hasConversation, conversationId, messageCount, lastId, streaming, draft}。
 * ok=false 表示页面读不到（刷新中/兼容层没加载）——调用方按「不可读」处理，别当成活动。
 */
function sessionActivityExpression() {
  return '(function(){try{' +
    'function vis(el){if(!el)return false;if(el.closest&&el.closest(".wbs-root"))return false;' +
      'var r=el.getBoundingClientRect();return r.width>0&&r.height>0}' +
    'function composerText(el){' +
      'if(!el)return "";' +
      'if(el.tagName==="TEXTAREA")return String(el.value||"").replace(/[\\uFEFF\\u200B]/g,"").trim();' +
      'var clone=el.cloneNode(true);' +
      'clone.querySelectorAll("[data-slate-placeholder=\\"true\\"],[data-slate-zero-width]").forEach(function(node){node.remove()});' +
      'return String(clone.innerText||clone.textContent||"").replace(/[\\uFEFF\\u200B]/g,"").trim()}' +
    'var composers=Array.prototype.slice.call(document.querySelectorAll("[contenteditable=\\"true\\"],textarea")).filter(vis);' +
    'var composer=composers.filter(function(el){return !!el.closest(".wb-home-composer")})[0]||composers[0]||null;' +
    'var draft=composerText(composer).length;' +
    'var compat=window.__wbsWorkBuddyCompat;' +
    'if(!compat)return {ok:false,why:"no-compat",draft:draft};' +
    'var list;try{list=compat.findConversationControllers(document)}catch(e){list=null}' +
    'if(!list||!list.length)return {ok:true,hasConversation:false,draft:draft};' +
    'var ctl=list[0];' +
    'var st=ctl.messageStore.getState();var msgs=st.messages||[];' +
    'var last=null;for(var i=msgs.length-1;i>=0;i--){if(msgs[i]){last=msgs[i];break}}' +
    'return {ok:true,hasConversation:true,conversationId:String(ctl.conversationId||""),' +
      'messageCount:msgs.length,lastId:String((last&&(last.id||last.messageId))||""),' +
      'lastType:String((last&&last.messageType)||""),' +
      'streaming:!!(st.streamingRequestId||st.streamingMessageId||(last&&last.loading)),draft:draft}' +
  '}catch(e){return {ok:false,why:"threw",error:String(e&&e.message||e)}}})()';
}

/** 活动指纹：只要它变了就说明「有事发生」。草稿按 0/短/长 分桶，避免每敲一个字都算一次变化 */
function activityFingerprint(probe) {
  const p = probe && typeof probe === 'object' ? probe : {};
  if (p.ok !== true) return 'unreadable';
  if (p.hasConversation === false) return 'no-conversation';
  const draftBucket = !p.draft ? '0' : (Number(p.draft) < 10 ? 's' : 'm');
  return [String(p.conversationId || ''), Number(p.messageCount) || 0, String(p.lastId || ''), p.streaming ? '1' : '0', draftBucket].join('|');
}

function activitySignals(probe) {
  const p = probe && typeof probe === 'object' ? probe : {};
  return {
    readable: p.ok === true,
    streaming: p.streaming === true,
    draft: Number(p.draft) || 0,
    fingerprint: activityFingerprint(p),
  };
}

/**
 * 纯决策：这一拍该不该切回主账号。
 *
 * @param {object} input
 *   config            {enabled, minutes}
 *   now               当前时间戳
 *   current           {uid, nickname}
 *   primaryUid        主账号 uid（空串=没设）
 *   primaryUsable     主账号在账号列表里且凭据可用
 *   blockedUntil      主账号限流窗口结束时间戳（0=不在窗口内）
 *   busy              true=此刻有任务/切号流程在跑（视为活动，计时归零，别抢账号）
 *   probe             活动探测原始结果
 *   state             上一拍的状态
 * @returns {{action:'none'|'idle'|'hold'|'switch', reason:string, idleMs?:number, threshold?:number, nextState:object}}
 */
function decideIdleSwitchBack(input) {
  const i = input && typeof input === 'object' ? input : {};
  const now = Number(i.now) || Date.now();
  const config = normalizeConfig(i.config);
  const currentUid = String((i.current && i.current.uid) || '');
  const primaryUid = String(i.primaryUid || '');

  if (!config.enabled || config.minutes <= 0) {
    return { action: 'none', reason: 'disabled', nextState: resetState(currentUid, now) };
  }
  if (!currentUid) return { action: 'none', reason: 'no-current', nextState: emptyState('') };
  if (!primaryUid) return { action: 'none', reason: 'no-primary', nextState: resetState(currentUid, now) };
  if (currentUid === primaryUid) return { action: 'none', reason: 'already-primary', nextState: resetState(currentUid, now) };

  const prev = i.state && typeof i.state === 'object' ? i.state : emptyState('');
  const base = String(prev.uid || '') === currentUid ? prev : resetState(currentUid, now);
  const signals = activitySignals(i.probe);
  const changed = !!String(base.fingerprint || '') && signals.fingerprint !== String(base.fingerprint || '');
  const active = !!i.busy || signals.streaming || signals.draft > 0 || changed;

  const nextState = active || !base.lastActivityAt
    ? {
      uid: currentUid,
      lastActivityAt: now,
      fingerprint: signals.fingerprint,
      fingerprintAt: now,
      lastReason: i.busy ? 'busy' : (signals.streaming ? 'streaming' : (signals.draft > 0 ? 'draft' : (changed ? 'changed' : 'init'))),
    }
    : {
      uid: currentUid,
      lastActivityAt: Number(base.lastActivityAt) || now,
      fingerprint: signals.fingerprint || String(base.fingerprint || ''),
      fingerprintAt: Number(base.fingerprintAt) || now,
      lastReason: 'idle',
    };

  const idleMs = Math.max(0, now - Number(nextState.lastActivityAt || now));
  const threshold = config.minutes * 60000;
  if (idleMs < threshold) return { action: 'idle', reason: 'below-threshold', idleMs, threshold, nextState };
  if (!i.primaryUsable) return { action: 'hold', reason: 'primary-unavailable', idleMs, threshold, nextState };
  if (Number(i.blockedUntil || 0) > now) {
    return { action: 'hold', reason: 'primary-limited', idleMs, threshold, blockedUntil: Number(i.blockedUntil), nextState };
  }
  return { action: 'switch', reason: 'idle-threshold', idleMs, threshold, nextState };
}

module.exports = {
  DEFAULTS,
  MIN_MINUTES,
  MAX_MINUTES,
  CONFIG_FILE,
  STATE_FILE,
  clampMinutes,
  normalizeConfig,
  emptyState,
  resetState,
  createIdleSwitchbackStore,
  createIdleSwitchbackStateStore,
  sessionActivityExpression,
  activityFingerprint,
  activitySignals,
  decideIdleSwitchBack,
};
