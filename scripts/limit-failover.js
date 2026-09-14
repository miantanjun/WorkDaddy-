'use strict';

// 模型限流（rate limit / 日额度用尽）识别与自动切号续跑的核心逻辑。
//
// 真机取证结论（WorkBuddy 5.5.6 renderer 源码 + live CDP 实测）：
//   限流提示**不在消息流里**，而在输入框上方的横幅里，共两条互斥分支：
//     A 路  bizCode === 6004（当前模型用量已达今日上限）
//           → <div class="rate-limit-info-banner" data-testid="rate-limit-info-banner" role="status">
//     B 路  429 / 6000–6003 / 14012 / 14014 / 14018 / 14019
//           → <div class="cb-input-banner cb-input-banner--error"> ，文案在 .cb-input-banner__message
//     C 路  提示队列满 → .cb-queue-banner--full / --user_limit
//   判定函数：showRateLimitInfo = !!error && isConversationRateLimitCapError(error) && eligible
//            isConversationRateLimitCapError(e) ⇔ e.terminal?.bizCode === 6004 || Number(e.code) === 6004
//            eligible = (account.type === 'personal' || 'pro') && !企业账号
//   QUOTA_BIZ_CODES = {14012, 14014, 14018, 14019, 6004}
//
// 因此定位器必须落在"横幅"上，绝不能落在消息流（.cr-message-list）——
// 消息流里出现 429 的往往是侧栏标题/正文，是纯假阳性。

// 一次成功交接后，同一账号在这段时间内不再重复触发；被判限流的账号也在这段时间内被跳过。
const LIMIT_FAILOVER_WINDOW_MS = 10 * 60 * 1000;

// 按优先级排列：先命中的分支先被判据。
const LIMIT_BANNER_SELECTORS = [
  '[data-testid="rate-limit-info-banner"]',
  '.rate-limit-info-banner',
  '.cb-input-banner--error',
  '.cb-input-banner--warning',
  '.cb-queue-banner--full',
  '.cb-queue-banner--user_limit',
];

// 注意：**故意不含裸 "429"**。客户端在渲染前已把 "429 " 前缀 strip 掉
// （main-content-core: displayMessage.replace(/^429\s+/, "")），横幅里本来就没有 429；
// 而页面别处（会话标题、正文、粘贴的日志）到处是 429，收进来只会造成误切号。
const LIMIT_TEXT_PATTERN = /(6004|14012|14014|14018|14019|使用量已超出频率限制|已超出频率限制|超出频率限制|已达今日上限|达到今日上限|使用量已达今日上限|超过当前模型的频率限制|请求过于频繁|使用频率过高|rate limit|usage limit|\bquota\b|消耗积分)/i;

function limitBannerProbeExpression() {
  return '(function(){try{' +
    'function vis(e){if(!e)return false;' +
      'if(e.closest&&e.closest(".wbs-root"))return false;' +
      'if(e.closest&&e.closest(".wbs-toast"))return false;' +
      'var r=e.getBoundingClientRect();return r.width>0&&r.height>0}' +
    'var sels=' + JSON.stringify(LIMIT_BANNER_SELECTORS) + ';' +
    'var pat=' + String(LIMIT_TEXT_PATTERN) + ';' +
    'var hits=[];var seen=null;' +
    'for(var i=0;i<sels.length;i++){var list;try{list=document.querySelectorAll(sels[i])}catch(e){continue}' +
      'for(var j=0;j<list.length;j++){var el=list[j];' +
        'if(seen&&seen.indexOf(el)>=0)continue;' +
        'if(!vis(el))continue;' +
        'var txt=String(el.innerText||el.textContent||"").replace(/[\\s\\u00A0]+/g," ").trim();' +
        'if(!txt||!pat.test(txt))continue;' +
        'if(!seen)seen=[];seen.push(el);' +
        'hits.push({sel:sels[i],text:txt.slice(0,400)})}}' +
    'return {ok:true,hit:hits.length>0,count:hits.length,hits:hits.slice(0,4)}' +
  '}catch(e){return {ok:false,hit:false,error:String(e&&e.message||e)}}})()';
}

// 读取/设置「当前会话正在使用的模型 id」。
// 走 renderer 的 ConversationController（WorkDaddy 自己的 compat 层已经能稳定拿到），
// 而不是去点模型下拉框 —— 后者受多语言、付费线分组影响，极其脆弱。
function liveModelExpression(action, modelId) {
  const head =
    '(function(){try{' +
    'var compat=window.__wbsWorkBuddyCompat;if(!compat)return {ok:false,error:"compat 未加载"};' +
    'var list;try{list=compat.findConversationControllers(document)}catch(e){list=null};' +
    'if(!list||!list.length)return {ok:false,error:"未找到会话控制器（页面可能还没进入会话）"};' +
    'var ctl=list[0];' +
    'var st=null;try{st=ctl.sessionStore&&ctl.sessionStore.getState?ctl.sessionStore.getState():null}catch(e){}' +
    'var current=st&&st.model?String(st.model):null;';
  if (action === 'get') {
    return head + 'return {ok:true,model:current,conversationId:ctl.conversationId||null}' +
      '}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()';
  }
  const wanted = JSON.stringify(String(modelId || ''));
  return head +
    'if(!current)return {ok:false,error:"读不到当前模型 id"};' +
    'if(current===' + wanted + ')return {ok:true,changed:false,model:current,conversationId:ctl.conversationId||null};' +
    'if(typeof ctl.setModel!=="function")return {ok:false,error:"控制器不支持 setModel"};' +
    'return Promise.resolve(ctl.setModel(' + wanted + ')).then(function(){' +
      'var after=null;try{var s2=ctl.sessionStore.getState();after=s2&&s2.model?String(s2.model):null}catch(e){}' +
      'return {ok:true,changed:true,from:current,model:after||' + wanted + ',conversationId:ctl.conversationId||null}' +
    '}).catch(function(e){return {ok:false,error:String(e&&e.message||e)}});' +
  '}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()';
}

// 取当前会话里最后一条「用户消息」的文本 —— 这就是要原样续跑的任务内容。
function lastUserTaskTextExpression(maxChars) {
  const cap = Math.max(1, Number(maxChars) || 20000);
  return '(function(){try{' +
    'var compat=window.__wbsWorkBuddyCompat;if(!compat)return {ok:false,error:"compat 未加载"};' +
    'var list;try{list=compat.findConversationControllers(document)}catch(e){list=null};' +
    'if(!list||!list.length)return {ok:false,error:"未找到会话控制器"};' +
    'var ctl=list[0];var st=ctl.messageStore.getState();var msgs=st.messages||[];' +
    'function blockText(ct){' +
      'if(typeof ct==="string")return ct;' +
      'if(!Array.isArray(ct))return "";' +
      'return ct.map(function(b){return b&&b.type==="text"?String(b.text||""):""}).filter(Boolean).join("\\n")}' +
    'for(var i=msgs.length-1;i>=0;i--){var m=msgs[i];' +
      'if(!m||m.messageType!=="user")continue;' +
      'var t=blockText(m.content).trim();' +
      'if(!t)continue;' +
      'return {ok:true,text:t.slice(0,' + cap + '),truncated:t.length>' + cap + ',conversationId:ctl.conversationId||null}}' +
    'return {ok:false,error:"当前会话里没有用户消息"}' +
  '}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()';
}

// 续跑是否「已经跑完」：既没有流式请求，最后一条消息也是**已完成的 assistant 回复**。
//
// 用于「续跑结束后自动切回主账号」——账号切换会 Page.reload，回复还在流式输出时动手
// 等于把续跑当场掐死，所以「先确认跑完、再切号」的顺序不能反。
// 返回 {ok, idle, why}：ok=false 表示**页面读不到**（刷新中/不在会话里），调用方应当继续等，
// 不要把「读不到」当成「跑完了」。
function limitReplyIdleExpression() {
  return '(function(){try{' +
    'var compat=window.__wbsWorkBuddyCompat;if(!compat)return {ok:false,idle:false,why:"no-compat"};' +
    'var list;try{list=compat.findConversationControllers(document)}catch(e){list=null};' +
    'if(!list||!list.length)return {ok:false,idle:false,why:"no-controller"};' +
    'var ctl=list[0];' +
    'var st=ctl.messageStore.getState();' +
    'if(st.streamingRequestId||st.streamingMessageId)return {ok:true,idle:false,why:"streaming"};' +
    'var msgs=st.messages||[];var last=null;' +
    'for(var i=msgs.length-1;i>=0;i--){if(msgs[i]){last=msgs[i];break}}' +
    'if(!last)return {ok:true,idle:false,why:"empty"};' +
    'if(last.loading)return {ok:true,idle:false,why:"loading"};' +
    'if(last.messageType!=="assistant")return {ok:true,idle:false,why:"last-is-"+String(last.messageType||"?")};' +
    'return {ok:true,idle:true,why:"assistant-done",conversationId:ctl.conversationId||null}' +
  '}catch(e){return {ok:false,idle:false,why:"threw",error:String(e&&e.message||e)}}})()';
}

function normalizeState(state) {
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
}

function isAccountBlocked(state, uid, now, windowMs) {
  const entry = normalizeState(state)[String(uid || '')];
  if (!entry) return false;
  const at = Number(entry.blockedAt || 0);
  if (!Number.isFinite(at) || at <= 0) return false;
  return Number(now) - at < (Number(windowMs) || LIMIT_FAILOVER_WINDOW_MS);
}

function markAccountBlocked(state, uid, now, reason) {
  const next = { ...normalizeState(state) };
  next[String(uid || '')] = { blockedAt: Number(now) || Date.now(), reason: String(reason || 'limit') };
  return next;
}

function clearAccountBlocked(state, uid) {
  const next = { ...normalizeState(state) };
  delete next[String(uid || '')];
  return next;
}

// 选目标账号：
//  1) 排除当前账号；
//  2) 排除窗口内已被判定限流的账号；
//  3) 有剩余积分段数据时优先「最快到期且有余额」的那个（复用 credit-rotation 的口径）；
//  4) 没有积分数据就按账号列表原顺序。
function pickFailoverTarget(accounts, currentUid, state, now, options = {}) {
  const windowMs = Number(options.windowMs) || LIMIT_FAILOVER_WINDOW_MS;
  const at = Number(now) || Date.now();
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && String(a.uid || ''));
  const others = list.filter((a) => String(a.uid) !== String(currentUid || ''));
  if (!others.length) return null;
  const fresh = others.filter((a) => !isAccountBlocked(state, a.uid, at, windowMs));
  const pool = fresh.length ? fresh : [];
  if (!pool.length) return null;

  const withCredit = pool
    .map((account) => ({ account, segment: nearestCreditSegment(account, at) }))
    .filter((item) => item.segment && item.segment.remaining > 0)
    .sort((a, b) => {
      const ae = a.segment.expiresAt === null ? Number.MAX_SAFE_INTEGER : a.segment.expiresAt;
      const be = b.segment.expiresAt === null ? Number.MAX_SAFE_INTEGER : b.segment.expiresAt;
      if (ae !== be) return ae - be;
      return b.segment.remaining - a.segment.remaining;
    });
  const chosen = (withCredit[0] && withCredit[0].account) || pool[0];
  return { account: chosen, reason: withCredit.length ? 'credit' : 'order', candidates: pool.map((a) => a.uid) };
}

function nearestCreditSegment(account, now) {
  const segments = account && (account.creditSegments || account.segments);
  if (!Array.isArray(segments) || !segments.length) return null;
  const at = Number(now) || Date.now();
  return segments
    .map((segment) => {
      if (!segment || typeof segment !== 'object') return null;
      const remaining = Number(segment.remaining);
      if (!Number.isFinite(remaining) || remaining <= 0) return null;
      const raw = segment.expiresAt;
      const expiresAt = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= at)) return null;
      return { remaining, expiresAt };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ae = a.expiresAt === null ? Number.MAX_SAFE_INTEGER : a.expiresAt;
      const be = b.expiresAt === null ? Number.MAX_SAFE_INTEGER : b.expiresAt;
      if (ae !== be) return ae - be;
      return b.remaining - a.remaining;
    })[0] || null;
}

module.exports = {
  LIMIT_FAILOVER_WINDOW_MS,
  LIMIT_BANNER_SELECTORS,
  LIMIT_TEXT_PATTERN,
  limitBannerProbeExpression,
  limitReplyIdleExpression,
  liveModelExpression,
  lastUserTaskTextExpression,
  isAccountBlocked,
  markAccountBlocked,
  clearAccountBlocked,
  pickFailoverTarget,
  nearestCreditSegment,
};
