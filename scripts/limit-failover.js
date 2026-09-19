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

// 续跑指令：落在原会话副本里时只发这一句，而不是把原任务全文重发一遍。
// 「已完成的内容不要重做」这个语义**写死在文案里**，不靠模型猜；要改就改这个常量
// （或给步骤传 continueText）。
const DEFAULT_CONTINUE_TEXT = '继续（接着上面未完成的部分做，已完成的内容不要重做）';

// 快照里回看的消息条数。判据只需要「源的最后一条已完成回复还在副本里」，
// 它在快照时刻就在会话尾部，所以回看一小段足够，不必把整段历史拉回来（长会话太贵）。
const SNAPSHOT_TAIL = 20;

/** 正文前 N 字（digest 与判据都只看这一小段，避免跨 CDP 传大字符串） */
const DIGEST_TEXT_CHARS = 200;

/** FNV-1a 32 位：只用来区分「是不是同一条消息」，不做安全用途 */
function hashText(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 一条消息的稳定摘要：优先 id（最可靠），没有就退化成「正文摘要 + 长度」 */
function digestOfParts(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const id = String(p.id || '').trim();
  if (id) return 'id:' + id;
  const text = String(p.text || '');
  const len = Number(p.len);
  return 'tx:' + hashText(text) + ':' + (Number.isFinite(len) ? len : text.length);
}

/**
 * 读「当前会话」的消息级指纹。切号前抓源、切号后抓副本，两边用同一份口径。
 *
 * 锚点取**最后一条已完成的 assistant 消息**，而不是最后一条消息 ——
 * 限流经常**打断正在流式输出的那条回复**，最后一条往往是半截的；
 * 要核验的是「限流前**已完成**的内容」有没有同步过去。
 */
function sessionSnapshotExpression() {
  return '(function(){try{' +
    'var compat=window.__wbsWorkBuddyCompat;if(!compat)return {ok:false,error:"compat 未加载"};' +
    'var list;try{list=compat.findConversationControllers(document)}catch(e){list=null};' +
    'if(!list||!list.length)return {ok:false,error:"未找到会话控制器"};' +
    'var ctl=list[0];var st=ctl.messageStore.getState();var msgs=st.messages||[];' +
    'function text(m){var c=m&&m.content;if(typeof c==="string")return c;' +
      'if(!Array.isArray(c))return "";' +
      'return c.map(function(b){return b&&b.type==="text"?String(b.text||""):""}).filter(Boolean).join("\\n")}' +
    'function parts(m,withText){var t=text(m);' +
      'return {id:String(m&&(m.id||m.messageId||m.requestId)||""),' +
      'text:withText?t.slice(0,' + DIGEST_TEXT_CHARS + '):"",len:t.length}}' +
    'var anchor=null;' +
    'for(var i=msgs.length-1;i>=0;i--){var mm=msgs[i];if(!mm)continue;' +
      'if(mm.messageType!=="assistant")continue;' +
      'if(mm.loading)continue;' +
      'var at=text(mm);if(!at)continue;' +
      'anchor={index:i,id:String(mm.id||mm.messageId||mm.requestId||""),' +
        'text:at.slice(0,' + DIGEST_TEXT_CHARS + '),len:at.length};break}' +
    'var tail=[];' +
    'for(var k=Math.max(0,msgs.length-' + SNAPSHOT_TAIL + ');k<msgs.length;k++){tail.push(parts(msgs[k],true))}' +
    'return {ok:true,conversationId:ctl.conversationId||"",count:msgs.length,' +
      'streaming:!!(st.streamingRequestId||st.streamingMessageId),anchor:anchor,tail:tail}' +
  '}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()';
}

/**
 * 把 renderer 返回的原始对象规整成判据要用的快照（digest 在 Node 侧算，口径只有一份）。
 * 读不到就返回 null —— 调用方据此走「不冒险」的降级路径。
 */
function normalizeSnapshot(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || r.ok !== true) return null;
  const anchor = r.anchor && typeof r.anchor === 'object' ? r.anchor : null;
  const tail = Array.isArray(r.tail) ? r.tail : [];
  return {
    conversationId: String(r.conversationId || ''),
    count: Number(r.count) || 0,
    streaming: r.streaming === true,
    anchor: anchor ? { index: Number(anchor.index) || 0, digest: digestOfParts(anchor) } : null,
    tail: tail.map(digestOfParts),
  };
}

/**
 * 判定「副本是不是已经把限流前已完成的内容同步过来了」。
 *
 * 纯函数，**判据只有一份**：daemon 与单测共用，两边不会漂移。
 * @returns {{complete:boolean, reason:string}}
 *   reason ∈ ok | no-source | no-anchor | no-copy | copy-shorter | anchor-mismatch
 */
function compareSnapshot(source, copy) {
  const s = source && typeof source === 'object' ? source : null;
  const c = copy && typeof copy === 'object' ? copy : null;
  if (!s) return { complete: false, reason: 'no-source' };
  // 源里没有「已完成的回复」⇒ 副本里没有可续的上下文，发「继续」没有意义（立刻降级重发）
  if (!s.anchor) return { complete: false, reason: 'no-anchor' };
  if (!c) return { complete: false, reason: 'no-copy' };
  // 条数不能少：少了就说明还没同步完（或者只同步了一部分）
  if (Number(c.count) < Number(s.count)) return { complete: false, reason: 'copy-shorter' };
  // 源快照的那条锚点必须能在副本里找到。
  // 不比「副本的锚点 === 源的锚点」：抓完快照之后源这边还可能把那条被打断的回复落成
  // 「已完成」，于是副本的锚点会往后挪一条 —— 那种情况内容是**齐的**，不该判失败。
  const hit = c.tail.indexOf(s.anchor.digest) >= 0 || (c.anchor && c.anchor.digest === s.anchor.digest);
  if (!hit) return { complete: false, reason: 'anchor-mismatch' };
  return { complete: true, reason: 'ok' };
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

/**
 * 「记录时刻比现在还晚」的容差上限。超过这个量就认定记录不可信（见 entryBlockedUntil）。
 *
 * 取值是一整个限流窗口，理由是能反推：markAccountBlocked 写的永远是**当时的当下**，
 * 所以任何一条记录，只要它的 blockedAt 比「现在」还晚了不止一个窗口，就不可能是真实观测 ——
 * 只能是写完记录之后系统时钟被往回拨过。窗口以内的回拨（< 10 分钟）只会让账号多等
 * 一小会儿，与窗口本身同量级，不值得为它引入额外的不确定性。
 */
const BLOCKED_AT_FUTURE_TOLERANCE_MS = LIMIT_FAILOVER_WINDOW_MS;

/**
 * 一条限流记录的「解除时刻」（绝对时间戳 ms）。没有可用记录 / 记录不可信 → 0。
 *
 * 优先取记录里**在标记当时**算好的绝对时刻 `blockedUntil`；只有 `blockedAt` 的老记录
 * （v1.4.1 之前落盘的状态文件都长这样）才现算 `blockedAt + window`：两代格式必须都能读。
 *
 * ⚠️ 判据以绝对时刻为准，而不是每次现算「相对窗口」。同一份状态文件被
 * isAccountBlocked（选备选账号）与 daemon 的 limitFailoverBlockedUntil（等主账号窗口）
 * 两处读，两边现算就会有各算各的空间；存下来则只有一份真相。
 *
 * @param {object} entry 状态文件里的一条记录 {blockedAt, blockedUntil?, reason?}
 * @param {number} [windowMs] 只有老记录（无 blockedUntil）才用得到
 * @param {number} [now] 提供时做时钟回拨校验，见 BLOCKED_AT_FUTURE_TOLERANCE_MS
 */
function entryBlockedUntil(entry, windowMs, now) {
  const e = entry && typeof entry === 'object' ? entry : null;
  if (!e) return 0;
  const at = Number(e.blockedAt);
  const hasAt = Number.isFinite(at) && at > 0;
  const ref = Number(now);
  if (hasAt && Number.isFinite(ref) && at > ref + BLOCKED_AT_FUTURE_TOLERANCE_MS) return 0;
  const until = Number(e.blockedUntil);
  if (Number.isFinite(until) && until > 0) return until;
  if (!hasAt) return 0;
  return at + (Number(windowMs) || LIMIT_FAILOVER_WINDOW_MS);
}

/**
 * 账号是否还在限流窗口内。判据是**绝对时刻** `now < blockedUntil`。
 *
 * 存绝对时刻还顺带解掉一个只在时钟回拨时才现形的坑：旧写法每次都用「现在」重算
 * `blockedAt + window`，若写记录之后时钟被往回拨了一大截，`blockedUntil` 会落在
 * 「（错误时钟下的）未来」，该账号就要多等「回拨量 + 窗口」才可能被重新选中；
 * 极端情况下（虚拟机快照恢复、RTC 走错）等于把备用账号静默废掉。
 * entryBlockedUntil 会把这种记录判为不可信并直接放行，代价只是多试一次
 * （真被限流的话 waitLimitVerdict 会当场看到横幅，再用一个正常时间戳记回来）。
 */
function isAccountBlocked(state, uid, now, windowMs) {
  const entry = normalizeState(state)[String(uid || '')];
  if (!entry) return false;
  const ref = Number(now);
  const until = entryBlockedUntil(entry, windowMs, ref);
  if (!until) return false;
  return (Number.isFinite(ref) ? ref : Date.now()) < until;
}

/**
 * 记录一次限流。同时写 `blockedAt`（人看的「什么时候被判的」）与
 * `blockedUntil`（判据用的绝对解除时刻）—— 判据不再依赖读取时的 windowMs。
 */
function markAccountBlocked(state, uid, now, reason, windowMs) {
  const at = Number(now) || Date.now();
  const window = Number(windowMs) || LIMIT_FAILOVER_WINDOW_MS;
  const next = { ...normalizeState(state) };
  next[String(uid || '')] = { blockedAt: at, blockedUntil: at + window, reason: String(reason || 'limit') };
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
  // 选不出账号时**不再返回 null**：调用方原来只能看到「没得选」，于是
  // 「压根没有别的账号」和「别的账号全在限流窗口里、最早 X 点才能重试」在日志与
  // 用户提示里长得一模一样（审查 P1-7）。返回带 reason 的对象，两种情形才分得开。
  if (!others.length) {
    return { account: null, reason: 'no-others', candidates: [], blocked: [], earliestRecovery: 0 };
  }
  const fresh = others.filter((a) => !isAccountBlocked(state, a.uid, at, windowMs));
  if (!fresh.length) {
    const blocked = others
      .map((a) => ({ uid: String(a.uid), until: entryBlockedUntil(normalizeState(state)[String(a.uid)], windowMs, at) }))
      .filter((item) => item.until > at);
    return {
      account: null,
      reason: 'all-blocked',
      candidates: [],
      blocked,
      earliestRecovery: blocked.length ? Math.min(...blocked.map((item) => item.until)) : 0,
    };
  }
  const pool = fresh;

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
  // 成功分支也带上 blocked/earliestRecovery，返回形状与失败分支一致（消费方不必判字段在不在）。
  return {
    account: chosen,
    reason: withCredit.length ? 'credit' : 'order',
    candidates: pool.map((a) => a.uid),
    blocked: [],
    earliestRecovery: 0,
  };
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
  DEFAULT_CONTINUE_TEXT,
  SNAPSHOT_TAIL,
  limitBannerProbeExpression,
  limitReplyIdleExpression,
  liveModelExpression,
  lastUserTaskTextExpression,
  hashText,
  digestOfParts,
  sessionSnapshotExpression,
  normalizeSnapshot,
  compareSnapshot,
  BLOCKED_AT_FUTURE_TOLERANCE_MS,
  entryBlockedUntil,
  isAccountBlocked,
  markAccountBlocked,
  clearAccountBlocked,
  pickFailoverTarget,
  nearestCreditSegment,
};
