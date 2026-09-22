'use strict';

/*
 * 账号健康状态机（F2 / v1.4.5）。
 *
 * 病灶：本地只有「被限流」一个概念（limit-failover 的一条 blockedUntil），于是
 * 「429 软限流」与「凭证已死」被混为一谈 —— 凭证失效的账号被当成「等 10 分钟就好」，
 * 10 分钟后又被选中、又失败，**静默循环**，用户看不到「该重登了」。
 *
 * 参考 opencodex 两条规则：
 *   ① 凭证失效 ⇒ 标记「需重新认证」，而非静默替换；
 *   ② 429 ⇒ 账号进冷却，后续任务切到池中其它可用账号（②本地已有）。
 * 本模块交付 ①，并把 ①② 在数据上分开。
 *
 * 设计边界（**很重要**，改之前先读）：
 *   · 本模块**不参与选号**。`limit-failover.js` 的 `entryBlockedUntil()` 仍是
 *     「某账号在限流窗口内」的唯一真相（两份回归套件锁着它）。
 *   · 本模块是**投影层**：给已有的「被限」事实贴类别，并补记 limit-failover
 *     表达不了的两种状态（needs_reauth / disabled）。它读得到的输入就是
 *     limit-failover 已经写下的事实，所以不会与它漂移。
 *   · 唯一一处参与选号的是 `isUsableForFailover()`，由 daemon 通过
 *     `pickFailoverTarget(..., { health })` 传入 —— **缺省不传 ⇒ 与今天逐字等价**。
 *   · 纯模块：无 fs、无网络、无副作用，所有时刻由调用方传入（单测用固定基准）。
 *
 * 判定顺序照搬上游 `internal/upstream/client.go` 的 `Classify(status, body)`（严 → 宽），
 * 但**不搬它的签名** —— 上游是代理，手里有 HTTP 响应；本地是插件，官方请求由
 * WorkBuddy 自己发出，本地默认拿不到状态码与 body（CDP Network 关口已验证：
 * 官方流量不在渲染进程）。所以信号源换成本地可得的 `observation`，
 * 由多个采集器填充（DOM 横幅 / 计费 API / 账号档案）。
 */

/* ---------------- 状态与类别 ---------------- */

const HEALTH_STATES = {
  OK: 'ok',
  RATE_LIMITED: 'rate_limited',
  NEEDS_REAUTH: 'needs_reauth',
  DISABLED: 'disabled',
};

// 采纳上游 ErrKind 的**动作语义**（命令式，不是描述式）。
// 本地没有信号源的几项（ErrNotFound / ErrWafBlock / ErrPromptTooLong 独立项）按语义就近归并。
const HEALTH_KINDS = {
  Ok: 'ok',
  AccountFault: 'account_fault',          // 认证档案不可解析 → 禁用（需人工修）
  SessionDead: 'session_dead',            // 401 / 刷新令牌已死 → 需重新认证
  QuotaHard: 'quota_hard',                // 额度耗尽 → 冷却 + 排除出候选（A5 的 CoolHard）
  ModelBlocked: 'model_blocked',          // 6004 / 该模型已满 → 只记模型维度
  RateSoft: 'rate_soft',                  // 429 / 限流文案 → 软冷却
  Server: 'server',                       // 5xx → 喂熔断（A4：熔断只由它驱动）
  ContentBlocked: 'content_blocked',      // 审核拦截 → **不罚号**
  BadParams: 'bad_params',                // 参数错 / prompt 过长 → **不罚号**
  Client: 'client',                       // 其余 4xx → 只换号 + 喂连败（A7）
};

/**
 * 硬度（severity）：越大越「等不来自愈」。只用于两处：
 *   · 并存取更硬者（不同类别的冷却同时有效时不互相降级）；
 *   · 硬状态不被软观测降级。
 */
const KIND_SEVERITY = {
  [HEALTH_KINDS.Ok]: 0,
  [HEALTH_KINDS.RateSoft]: 1,
  [HEALTH_KINDS.ModelBlocked]: 2,
  [HEALTH_KINDS.Server]: 2,
  [HEALTH_KINDS.Client]: 2,
  [HEALTH_KINDS.QuotaHard]: 3,
  [HEALTH_KINDS.SessionDead]: 4,
  [HEALTH_KINDS.AccountFault]: 5,
};

/**
 * 软冷却默认窗口。**故意与 `limit-failover.js` 的 `LIMIT_FAILOVER_WINDOW_MS` 取值相同**，
 * 但两处各自持有常量 —— 单测里有一条 `DEFAULT_RATE_WINDOW_MS === LIMIT_FAILOVER_WINDOW_MS`
 * 断言把「同源」锁住（照抄既有 `BLOCKED_AT_FUTURE_TOLERANCE_MS === W` 的写法），
 * 这样既不必引入 require 依赖（避免将来反向依赖成环），又不会悄悄漂移。
 *
 * 本期**不改冷却时长**：审查报告 F2 说的病灶是「混淆」，不是时长；真实重置墙钟
 * 是 F1（`quota-window.js`）的活。观测里带 `resetAt` 时本模块会优先采用。
 */
const DEFAULT_RATE_WINDOW_MS = 10 * 60 * 1000;

/** 上游 `pool.cappedSoftUntilLocked` 的 softRateMax：软冷却截断到 now + 2h。 */
const MAX_SOFT_UNTIL_MS = 2 * 60 * 60 * 1000;
/** 额度类（等签到 / 周期重置）允许更长，但给个 24h 上界，避免脏数据造出「永不解冻」。 */
const MAX_HARD_UNTIL_MS = 24 * 60 * 60 * 1000;

/* ---------------- 文案与选择器（真机取证） ---------------- */

// 选择器 → 信号。`.rate-limit-info-banner` 是 A 路（bizCode 6004），
// `.cb-input-banner--error/--warning` 是 B 路（429 / 6000–6003 / 14012 / 14014 / 14018 / 14019），
// `.cb-queue-banner--*` 是 C 路（提示队列满）。三路的取证见 limit-failover.js 头部注释。
const SELECTOR_SIGNALS = [
  ['rate-limit-info', /rate-limit-info-banner/],
  ['queue-full', /cb-queue-banner--(?:full|user_limit)/],
  ['input-banner', /cb-input-banner--(?:error|warning)/],
];

// 本地 QUOTA_BIZ_CODES 里的额度码（6004 单独走 model_blocked 那一层）。
const QUOTA_CODE_PATTERN = /(?:^|[^\d])(14012|14014|14018|14019)(?:[^\d]|$)/;

// 硬额度文案（中英双列）。上游纪律：**宁缺毋滥**，不收含义模糊的词。
const HARD_TEXT_PATTERN = /额度不足|积分不足|余额不足|额度已用完|积分已用完|余额已用完|quota\s*exceeded|insufficient\s*(?:credit|balance|quota)|out\s+of\s+credits/i;

// 软限流文案。⚠️ 连字符形式必须**单列**：字符串匹配不跨 `-`，
// `rate-limited` / `rate-limiting` 不会被 `rate limit` 命中（上游注释原话）。
const SOFT_TEXT_PATTERN = /(?<!\d)(6000|6001|6002|6003)(?!\d)|超出频率限制|超过当前模型的频率限制|使用量已超出频率限制|请求过于频繁|使用频率过高|队列已满|rate[\s-]limit(?:ed|ing)?\b|usage\s*limit|too\s+many\s+requests/i;

// 模型日额度（A 路 6004）。单独一层，因为它的正确动作是「只记模型维度」而不是罚账号（A3）。
const MODEL_CAP_PATTERN = /(?<!\d)6004(?!\d)|已达今日上限|达到今日上限|使用量已达今日上限/;

const CONTENT_BLOCKED_PATTERN = /内容安全|内容审核|审核未通过|违规|content[\s-]?(?:policy|filter)|blocked\s+by\s+(?:safety|policy)/i;

const BAD_PARAMS_PATTERN = /11101|11115|prompt\s+is\s+too\s+long|prompt\s+too\s+long|unmarshal\s+chat\s+params/i;

// 会话/凭证死亡文案。与渲染侧 `isIdentityExpired()` 的判据同源（checkin 的 401 文案）。
// ⚠️ `401` **必须带数字边界**：额度码 `14012 / 14014 / 14018 / 14019` 的子串里就含 `401`，
// 裸 `401` 会把「额度已用尽」整批误判成「需重新登录」——这是本模块最容易踩的假阳性。
const SESSION_DEAD_PATTERN = /(?<!\d)401(?!\d)|Unauthorized|未授权|登录身份过期|登录已过期|请重新登录|需重新登录|重新认证|session\s+not\s+found/i;

/* ---------------- 小工具 ---------------- */

function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function severityOf(kind) {
  const n = KIND_SEVERITY[kind];
  return Number.isFinite(n) ? n : 0;
}

function isHardState(state) {
  return state === HEALTH_STATES.NEEDS_REAUTH || state === HEALTH_STATES.DISABLED;
}

/** 观测里可用于文案判定的文本：显式 text 优先，否则把 hits 的 text 拼起来。 */
function observationText(o) {
  const direct = String((o && o.text) || '').trim();
  if (direct) return direct;
  const hits = o && Array.isArray(o.hits) ? o.hits : [];
  return hits.map((hit) => String((hit && hit.text) || '').trim()).filter(Boolean).join(' | ');
}

function selectorSignal(o) {
  const hits = o && Array.isArray(o.hits) ? o.hits : [];
  for (let i = 0; i < SELECTOR_SIGNALS.length; i++) {
    const signal = SELECTOR_SIGNALS[i][0];
    const re = SELECTOR_SIGNALS[i][1];
    for (let j = 0; j < hits.length; j++) {
      const sel = String((hits[j] && hits[j].sel) || '');
      if (sel && re.test(sel)) return signal;
    }
  }
  return '';
}

/**
 * 权威恢复时刻的解析。**宁缺毋滥**（上游 ParseRetryAfter 纪律）：
 * 不是有效未来时刻就一律不采用，回落既有窗口，**绝不臆造等待时长**。
 * 墙钟已过期（时钟偏移 / 文案过期）时钳到 now+1ms，**立即恢复**而不是负值 —— 上游 `cappedSoftUntilLocked` 原话。
 */
function resolveUntil(o, now, windowMs, capMs) {
  const reset = Number(o && o.resetAt);
  if (Number.isFinite(reset) && reset > 0) {
    if (reset <= now) return now + 1;
    const cap = Number(capMs) || MAX_SOFT_UNTIL_MS;
    return Math.min(reset, now + cap);
  }
  return now + Math.max(1, Number(windowMs) || DEFAULT_RATE_WINDOW_MS);
}

function reasonOrDefault(o, text, fallback) {
  const explicit = String((o && o.reason) || '').trim();
  if (explicit) return explicit;
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 160);
  return fallback;
}

function view(kind, state, until, reason, extra) {
  return Object.assign({
    kind: kind,
    state: state,
    until: until,
    reason: String(reason || ''),
    modelId: '',
    source: '',
  }, extra || {});
}

/* ---------------- 分类（严 → 宽，顺序即语义） ---------------- */

/**
 * 把一条观测分类成 { kind, state, until, reason, modelId, source }。
 *
 * ⚠️ **判定顺序本身就是设计**，每一层的位置都有理由，挪动前先读懂下面两条：
 *
 *   ① `sessionDead` 必须**先于** `429` / 限流文案：
 *      401 的 body 常带「频率 / 额度」字样。若先判限流，一个**等不来自愈**的账号会
 *      白等一个短冷却 —— 本地表现就是 opencodex 明确反对的「静默换号」。
 *      （上游把 `accountFault` 排在 `status==429` 之前是同一个理由。）
 *
 *   ② `429` 必须**先于** `hardMarkers`：
 *      429 body 高频携带 `quota exceeded` / `额度不足` 这类**跨计费与限流两界**的措辞。
 *      若先判 hardMarkers，限流会被误归硬冷却 —— 上游原话「白扔一个号约 12 小时」。
 *      状态码是比关键词更权威的信号。
 *
 * @param {object} observation 由采集器填充，字段全部可选：
 *   source / hits[{sel,text}] / text / bizCode / httpStatus / modelId /
 *   authValid(false ⇒ 档案坏) / authExpired / refreshExpired / checkinCode /
 *   resetAt(权威重置时刻, F1 会填) / reason / now
 * @param {object} [options] { windowMs }
 */
function classifyObservation(observation, options) {
  const o = observation && typeof observation === 'object' ? observation : {};
  const now = Number(o.now) || Date.now();
  const windowMs = Number(options && options.windowMs) || DEFAULT_RATE_WINDOW_MS;
  const text = observationText(o);
  const signal = selectorSignal(o);
  const source = String(o.source || '').trim();
  const modelId = String(o.modelId || '').trim();
  const status = Number(o.httpStatus);
  const soft = (kind, reason, capMs) => view(kind, HEALTH_STATES.RATE_LIMITED, resolveUntil(o, now, windowMs, capMs), reason, { modelId: kind === HEALTH_KINDS.ModelBlocked ? modelId : '', source: source });
  const neutral = (kind, reason) => view(kind, HEALTH_STATES.OK, 0, reason, { source: source });

  // ① 认证档案不可解析 —— 最具体的一层。落到任何下层都会被误当「可自愈」。
  if (o.authValid === false) {
    return view(HEALTH_KINDS.AccountFault, HEALTH_STATES.DISABLED, 0,
      reasonOrDefault(o, text, '认证数据无效'), { source: source });
  }

  // ② 凭证死亡 —— 见上文 ①。
  if (o.authExpired === true || o.refreshExpired === true || status === 401
    || String(o.checkinCode == null ? '' : o.checkinCode) === '401'
    || (text && SESSION_DEAD_PATTERN.test(text))) {
    return view(HEALTH_KINDS.SessionDead, HEALTH_STATES.NEEDS_REAUTH, 0,
      reasonOrDefault(o, text, '登录身份已失效，需要重新登录该账号'), { source: source });
  }

  // ③ 模型日额度（6004）—— 本地等价于上游 `11102` 那一层：最具体的业务码，
  //    先认出来才能只记模型维度、不罚账号。
  if (Number(o.bizCode) === 6004 || signal === 'rate-limit-info' || (text && MODEL_CAP_PATTERN.test(text))) {
    return soft(HEALTH_KINDS.ModelBlocked, reasonOrDefault(o, text, '该模型已达到今日用量上限'),
      MAX_HARD_UNTIL_MS);
  }

  // ④ 429 —— 见上文 ②。
  if (status === 429) return soft(HEALTH_KINDS.RateSoft, reasonOrDefault(o, text, '请求过于频繁（429）'));

  // ⑤ 402 / 额度关键词 —— hardMarkers 层。
  if (status === 402) return soft(HEALTH_KINDS.QuotaHard, reasonOrDefault(o, text, '额度不足（402）'), MAX_HARD_UNTIL_MS);
  if (QUOTA_CODE_PATTERN.test(text)) return soft(HEALTH_KINDS.QuotaHard, reasonOrDefault(o, text, '额度已用尽'), MAX_HARD_UNTIL_MS);
  if (HARD_TEXT_PATTERN.test(text)) return soft(HEALTH_KINDS.QuotaHard, reasonOrDefault(o, text, '额度不足'), MAX_HARD_UNTIL_MS);

  // ⑥ softRateMarkers —— 关键词层（没有状态码时才轮得到）。
  if (SOFT_TEXT_PATTERN.test(text)) return soft(HEALTH_KINDS.RateSoft, reasonOrDefault(o, text, '触发频率限制'));
  if (signal === 'queue-full') return soft(HEALTH_KINDS.RateSoft, reasonOrDefault(o, text, '提示队列已满'));
  if (signal === 'input-banner') return soft(HEALTH_KINDS.RateSoft, reasonOrDefault(o, text, '输入框上方出现错误横幅'));

  // ⑦ 5xx —— 喂熔断（A4：熔断只由它驱动）。
  if (status >= 500) return soft(HEALTH_KINDS.Server, reasonOrDefault(o, text, '服务端错误（' + status + '）'));

  // ⑧ 审核拦截 —— **不罚号**，走降级重试。
  if (text && CONTENT_BLOCKED_PATTERN.test(text)) return neutral(HEALTH_KINDS.ContentBlocked, '内容被拦截，该账号无责');

  // ⑨ 参数错 —— **不罚号**，末端透传原文。
  if (text && BAD_PARAMS_PATTERN.test(text)) return neutral(HEALTH_KINDS.BadParams, '请求参数不被接受，该账号无责');

  // ⑩ 其余 4xx —— 只换号 + 喂连败（A7：**只有「不知道原因的失败」才喂**这个计数器）。
  if (Number.isFinite(status) && status >= 400) {
    return soft(HEALTH_KINDS.Client, reasonOrDefault(o, text, '未分类的客户端错误（' + status + '）'));
  }

  // ⑪ 默认：没有信号 ⇒ 成功/无关。
  return view(HEALTH_KINDS.Ok, HEALTH_STATES.OK, 0, '', { source: source });
}

/**
 * 从账号档案（`listAccounts()` 的形状）直接判健康 —— daemon 的「对全池做一次体检」采集器。
 *
 * 只认**等不来自愈**的信号：
 *   · `authValid === false` —— 档案解析不出来。
 *   · `refreshExpiresAt` 已过 —— 刷新令牌已死，本地再也换不出新 token ⇒ 必须人工重登。
 *   · `checkin.code === '401'` / 文案命中 —— 官方接口明确拒绝该凭证。
 *
 * **不认「access token 过期」**：本地有 `token-refresh.js` 的惰性刷新与每日保活兜底，
 * 属**可自愈**；报成 needs_reauth 会把正常账号误标。
 * （渲染侧 `isIdentityExpired()` 用 `tokenExpiresAt` 是**显示**口径，不是健康判据 —— 两者刻意不同。）
 */
function classifyAccountRecord(account, now) {
  const a = account && typeof account === 'object' ? account : {};
  const at = Number(now) || Date.now();
  if (a.authValid === false) {
    return classifyObservation({ source: 'account-record', authValid: false, reason: '认证数据无效', now: at });
  }
  const refresh = toEpochMs(a.refreshExpiresAt);
  if (refresh > 0 && refresh <= at) {
    return classifyObservation({ source: 'account-record', refreshExpired: true, reason: '刷新令牌已过期，需要重新登录', now: at });
  }
  const checkin = a.checkin && typeof a.checkin === 'object' ? a.checkin : {};
  const code = String(checkin.code == null ? '' : checkin.code);
  const message = String(checkin.message || '');
  if (code === '401' || SESSION_DEAD_PATTERN.test(message)) {
    return classifyObservation({ source: 'account-record', checkinCode: code, reason: reasonOrDefault({ reason: '' }, message, '登录身份已失效，需要重新登录该账号'), now: at });
  }
  return classifyObservation({ source: 'account-record', now: at });
}

/* ---------------- 落盘结构 ---------------- */

function normalizeHealth(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const accounts = r.accounts && typeof r.accounts === 'object' && !Array.isArray(r.accounts) ? r.accounts : {};
  return {
    version: Number(r.version) || 1,
    updatedAt: Number(r.updatedAt) || 0,
    accounts: accounts,
  };
}

/** 读侧对未知 / 缺字段 / 老版本一律宽容。空对象代表「没有任何记录」。 */
function normalizeEntry(entry) {
  const e = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
  if (!e) return null;
  const state = String(e.state || '');
  const kind = String(e.kind || '');
  return {
    state: state,
    kind: kind,
    until: Number(e.until) > 0 ? Number(e.until) : 0,
    reason: String(e.reason || ''),
    lastReason: String(e.lastReason || ''),
    source: String(e.source || ''),
    since: Number(e.since) || 0,
    updatedAt: Number(e.updatedAt) || 0,
    hits: Number(e.hits) > 0 ? Number(e.hits) : 0,
    manualDisabled: e.manualDisabled === true,
    manualReason: String(e.manualReason || ''),
    models: e.models && typeof e.models === 'object' && !Array.isArray(e.models) ? e.models : {},
  };
}

/* ---------------- 状态迁移 ---------------- */

/**
 * 把一条分类结果落到健康表上。返回**新对象**（不改入参）。
 *
 * 三条纪律（全部来自上游 §A2/A4，改之前先读）：
 *   一、**冷却期内重复命中不加深、不延长**。同 kind 且仍冷却 ⇒ 只 `hits++`，
 *       `until` 原样保留。上游注释直说这是「用户『全池被推到 2h 封顶』的元凶」——
 *       旧实现每次兜底探测都翻倍，于是越重试越冷。修复方式不是调参，是
 *       **语义上禁止「重试」导致冷却加深**。
 *   二、**不同类别并存取更远者，绝不叠加**。`until = max(prev, next)`，`kind` 取更硬者。
 *       上游三个截止（until / breakerUntil / degradeUntil）在 `healthy()` 里是并列或门，
 *       生效的必然是最远者 —— 天然避免「叠加」，不需要额外的互斥逻辑。
 *   三、**硬状态不被软观测降级**。`needs_reauth` / `disabled` 生效期间，
 *       任何 `rate_*` 观测只记 hits，不覆盖 state / kind。
 *   另：**手动停用的账号，任何自动观测都不得覆盖**（A8：运维意图独立于自动状态）。
 */
function applyObservation(health, uid, cls, now) {
  const next = normalizeHealth(health);
  const id = String(uid || '').trim();
  if (!id || !cls) return next;
  const at = Number(now) || Date.now();
  const accounts = Object.assign({}, next.accounts);
  const prev = normalizeEntry(accounts[id]);

  if (prev && prev.manualDisabled) {
    // 手动摘除的号：自动观测只留痕，不改状态（否则签到/刷新成功会把用户意图抹掉）。
    accounts[id] = Object.assign({}, prev, {
      hits: (prev.hits || 0) + 1,
      lastReason: String(cls.reason || prev.lastReason || ''),
      updatedAt: at,
    });
    return { version: next.version, updatedAt: at, accounts: accounts };
  }

  const kind = String(cls.kind || HEALTH_KINDS.Ok);
  const severity = severityOf(kind);

  // 硬状态（needs_reauth / disabled）生效时，软观测只记 hits。
  if (prev && isHardState(prev.state) && severity < severityOf(HEALTH_KINDS.SessionDead)) {
    accounts[id] = Object.assign({}, prev, {
      hits: (prev.hits || 0) + 1,
      lastReason: String(cls.reason || prev.lastReason || ''),
      updatedAt: at,
    });
    return { version: next.version, updatedAt: at, accounts: accounts };
  }

  // 中性分类（审核拦截 / 参数错 / 无信号）**不写健康表** —— 「不罚号」就是真的不写。
  if (kind === HEALTH_KINDS.Ok || String(cls.state || '') === HEALTH_STATES.OK) return next;

  const clsUntil = Number(cls.until) > 0 ? Number(cls.until) : 0;
  const prevUntil = prev ? prev.until : 0;
  const prevCooling = prevUntil > at;
  let until;
  if (prevCooling && prev && prev.kind === kind) {
    until = prevUntil;                                                  // 纪律一
  } else if (prevCooling) {
    until = Math.max(prevUntil, clsUntil);                              // 纪律二
  } else {
    until = clsUntil;
  }
  const keepPrevKind = !!(prevCooling && prev && severityOf(prev.kind) > severity);
  const entry = {
    state: keepPrevKind ? prev.state : String(cls.state || HEALTH_STATES.RATE_LIMITED),
    kind: keepPrevKind ? prev.kind : kind,
    until: until,
    reason: keepPrevKind ? prev.reason : String(cls.reason || ''),
    lastReason: String(cls.reason || (prev && prev.lastReason) || ''),
    source: String(cls.source || (prev && prev.source) || ''),
    since: prevCooling && prev ? (prev.since || at) : at,
    updatedAt: at,
    hits: ((prev && prev.hits) || 0) + 1,   // 累计次数：换类别时**不清零**（诊断要回答「这号一共被撞了几次」）
    manualDisabled: false,
    manualReason: '',
    models: Object.assign({}, (prev && prev.models) || {}),
  };
  if (kind === HEALTH_KINDS.ModelBlocked) {
    // A3 的本地最小形态：模型维度单独记一份，选号粒度本期仍是账号级。
    const modelId = String(cls.modelId || '').trim();
    if (modelId) {
      entry.models[modelId] = { kind: kind, until: until, reason: entry.reason, updatedAt: at };
    }
  }
  accounts[id] = entry;
  return { version: next.version, updatedAt: at, accounts: accounts };
}

/** 批量：`pairs` 为 `[[uid, classification], ...]`。 */
function applyClassifications(health, pairs, now) {
  let next = normalizeHealth(health);
  const list = Array.isArray(pairs) ? pairs : [];
  for (let i = 0; i < list.length; i++) {
    const pair = list[i];
    if (!pair) continue;
    next = applyObservation(next, pair[0], pair[1], now);
  }
  return next;
}

/** A8：置 / 解**手动位**。不碰自动状态（state / kind / until）。 */
function setManualDisabled(health, uid, disabled, reason, now) {
  const next = normalizeHealth(health);
  const id = String(uid || '').trim();
  if (!id) return next;
  const at = Number(now) || Date.now();
  const accounts = Object.assign({}, next.accounts);
  const prev = normalizeEntry(accounts[id]);
  // 解手动位时**本来就没有记录** ⇒ 直接 no-op：A8 这三个端点要求幂等，
  // 无脑写一条 state 为空的空壳只会给健康表添垃圾（活体验证时实测到的）。
  if (!prev && disabled !== true) return next;
  const base = prev || {
    state: '', kind: '', until: 0, reason: '', lastReason: '', source: '',
    since: at, updatedAt: at, hits: 0, manualDisabled: false, manualReason: '', models: {},
  };
  accounts[id] = Object.assign({}, base, {
    manualDisabled: disabled === true,
    manualReason: disabled === true ? String(reason || '已手动停用') : '',
    updatedAt: at,
  });
  return { version: next.version, updatedAt: at, accounts: accounts };
}

/** A8：`revive` —— 解**自动位**（state/kind/until 归零），**不碰手动位**。 */
function reviveAuto(health, uid, now) {
  const next = normalizeHealth(health);
  const id = String(uid || '').trim();
  if (!id || !next.accounts[id]) return next;
  const at = Number(now) || Date.now();
  const accounts = Object.assign({}, next.accounts);
  const prev = normalizeEntry(accounts[id]);
  accounts[id] = Object.assign({}, prev, {
    state: '', kind: '', until: 0, reason: '', since: 0, updatedAt: at, models: {},
  });
  if (!prev.manualDisabled) { delete accounts[id]; }
  return { version: next.version, updatedAt: at, accounts: accounts };
}

/** 整条删除（面板「清除」用）。 */
function clearHealth(health, uid) {
  const next = normalizeHealth(health);
  const id = String(uid || '').trim();
  if (!id) return next;
  const accounts = Object.assign({}, next.accounts);
  delete accounts[id];
  return { version: next.version, updatedAt: Number(next.updatedAt) || 0, accounts: accounts };
}

/* ---------------- 读侧视图 ---------------- */

const EMPTY_VIEW = {
  state: HEALTH_STATES.OK, kind: HEALTH_KINDS.Ok, until: null, reason: '',
  remainingMs: 0, hits: 0, manualDisabled: false, autoDisabled: false, models: {},
};

/**
 * 单账号健康视图。**到期即物化为 ok**（条目保留 hits / lastReason 供诊断，不清除）。
 *
 * 优先级：手动位 / 自动禁用 > needs_reauth > rate_limited（未到期）> ok。
 * 前两个 `until` 恒为 `null` —— 这正是它们与 `rate_limited` 的本质区别：
 * **没有自动解除时刻，只能人工解除**。
 */
function readHealth(health, uid, now) {
  const at = Number(now) || Date.now();
  const entry = normalizeEntry(normalizeHealth(health).accounts[String(uid || '').trim()]);
  if (!entry) return Object.assign({}, EMPTY_VIEW);
  const autoDisabled = entry.state === HEALTH_STATES.DISABLED;
  const base = {
    hits: entry.hits, manualDisabled: entry.manualDisabled,
    autoDisabled: autoDisabled, models: entry.models || {},
  };
  if (entry.manualDisabled || autoDisabled) {
    return Object.assign({}, base, {
      state: HEALTH_STATES.DISABLED,
      // 手动停用不编造故障类别：`kind` 原样透出（可能是空串），面板按 state + manualDisabled 判文案。
      kind: entry.kind || '',
      until: null, remainingMs: 0,
      reason: entry.manualDisabled
        ? (entry.manualReason || '已手动停用')
        : (entry.reason || '系统判坏'),
    });
  }
  if (entry.state === HEALTH_STATES.NEEDS_REAUTH) {
    return Object.assign({}, base, {
      state: HEALTH_STATES.NEEDS_REAUTH, kind: entry.kind || HEALTH_KINDS.SessionDead,
      until: null, remainingMs: 0, reason: entry.reason || '需要重新登录该账号',
    });
  }
  if (entry.until > at) {
    return Object.assign({}, base, {
      state: HEALTH_STATES.RATE_LIMITED, kind: entry.kind || HEALTH_KINDS.RateSoft,
      until: entry.until, remainingMs: entry.until - at, reason: entry.reason || '',
    });
  }
  return Object.assign({}, EMPTY_VIEW, { hits: entry.hits, manualDisabled: entry.manualDisabled, models: entry.models || {} });
}

/**
 * 全量分组视图（`/api/account-health` 用）。
 * `uids` 给定时，**没有记录的账号算 ok 并一起列出** —— 面板要看到全池，而不是只看到"坏过的"。
 */
function projectHealth(health, now, uids) {
  const at = Number(now) || Date.now();
  const normalized = normalizeHealth(health);
  const known = [];
  if (Array.isArray(uids)) {
    for (let i = 0; i < uids.length; i++) {
      const id = String(uids[i] || '').trim();
      if (id && known.indexOf(id) < 0) known.push(id);
    }
  }
  for (const id in normalized.accounts) {
    if (known.indexOf(id) < 0) known.push(id);
  }
  const groups = { ok: [], rate_limited: [], needs_reauth: [], disabled: [] };
  for (let i = 0; i < known.length; i++) {
    const id = known[i];
    const item = Object.assign({ uid: id }, readHealth(normalized, id, at));
    const bucket = groups[item.state] || groups.ok;
    bucket.push(item);
  }
  const counts = {
    total: known.length,
    ok: groups.ok.length,
    rate_limited: groups.rate_limited.length,
    needs_reauth: groups.needs_reauth.length,
    disabled: groups.disabled.length,
  };
  return { counts: counts, groups: groups };
}

/* ---------------- A5 分级排除 ---------------- */

/**
 * 从**健康视图**判「能不能当备选」。单一实现 —— `isUsableForFailover()` 与 daemon 的
 * pick 谓词都走它，规则不重写第二遍。
 *
 * A5「分级排除」：
 *   · `disabled` / 手动停用 → **否**（上游：disabled 永不参与兜底）；
 *   · `needs_reauth` → **否**（等不来自愈，选了必失败 —— 这就是 opencodex 规则 ①）；
 *   · `quota_hard` → **否**（上游：CoolHard 排除 ——「调了必 402，浪费轮换并产生噪音日志」）；
 *   · `rate_soft` / `model_blocked` / `server` / `client` 冷却中 → **是**
 *     （上游：CoolSoft 与熔断号**允许参与**，可能已恢复，失败成本仅一轮换）。
 */
function isUsableView(view) {
  const v = view && typeof view === 'object' ? view : null;
  if (!v || !v.state) return { usable: true, reason: 'unknown' };
  if (v.state === HEALTH_STATES.DISABLED) return { usable: false, reason: 'disabled' };
  if (v.state === HEALTH_STATES.NEEDS_REAUTH) return { usable: false, reason: 'needs_reauth' };
  if (v.state === HEALTH_STATES.RATE_LIMITED) {
    if (v.kind === HEALTH_KINDS.QuotaHard) return { usable: false, reason: 'quota_hard' };
    return { usable: true, reason: 'cooling-' + String(v.kind || HEALTH_KINDS.RateSoft) };
  }
  return { usable: true, reason: 'ok' };
}

/**
 * A3：**可选**模型维度 —— 传了 `modelId` 且该模型仍在冷却窗口 ⇒ 判不可用
 * （只排除这一个模型，**不切整号**；换号候选池里仍可拿这个号跑别的模型）。
 *
 * ⚠️ 不传 `modelId` ⇒ 与加 A3 之前**逐字等价**（只看账号级）—— 现有 47 项断言无需改动即通过。
 * 账号级已判死时**维持账号级判决**（`reason` 不覆盖）：账号级永远优先于模型级。
 *
 * @param {object} health 健康表
 * @param {string} uid 账号
 * @param {number} [now]
 * @param {string} [modelId] 可选：本期要跑的具体模型
 */
function isUsableForFailover(health, uid, now, modelId) {
  const view = readHealth(health, uid, now);
  const base = isUsableView(view);
  const mid = String(modelId || '').trim();
  if (!mid || !base.usable) return base;
  const models = view && view.models && typeof view.models === 'object' ? view.models : null;
  const entry = models ? models[mid] : null;
  const until = entry ? Number(entry.until) || 0 : 0;
  const at = Number(now) || Date.now();
  if (until > at) {
    return {
      usable: false,
      reason: 'model-cooling-' + String((entry && entry.kind) || HEALTH_KINDS.ModelBlocked),
      modelId: mid,
      until: until,
    };
  }
  return base;
}

module.exports = {
  HEALTH_STATES,
  HEALTH_KINDS,
  KIND_SEVERITY,
  DEFAULT_RATE_WINDOW_MS,
  MAX_SOFT_UNTIL_MS,
  MAX_HARD_UNTIL_MS,
  SELECTOR_SIGNALS,
  QUOTA_CODE_PATTERN,
  HARD_TEXT_PATTERN,
  SOFT_TEXT_PATTERN,
  MODEL_CAP_PATTERN,
  CONTENT_BLOCKED_PATTERN,
  BAD_PARAMS_PATTERN,
  SESSION_DEAD_PATTERN,
  toEpochMs,
  severityOf,
  isHardState,
  resolveUntil,
  classifyObservation,
  classifyAccountRecord,
  normalizeHealth,
  normalizeEntry,
  applyObservation,
  applyClassifications,
  setManualDisabled,
  reviveAuto,
  clearHealth,
  readHealth,
  projectHealth,
  isUsableView,
  isUsableForFailover,
};
