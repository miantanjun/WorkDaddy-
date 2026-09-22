'use strict';
/*
 * test-account-health.js —— F2「429 冷却与『需重新认证』状态机」（v1.4.5）。
 *
 * 病灶：本地只有「被限流」一个概念（limit-failover 的一条 blockedUntil），于是
 * 「429 软限流」与「凭证已死」被混为一谈 —— 凭证失效的账号被当成「等 10 分钟就好」，
 * 10 分钟后又被选中、又失败，**静默循环**，用户看不到「该重登了」。
 *
 * 本套件锁四件事：
 *   [A] 分类器优先级：13 层「严 → 宽」的顺序，尤其两条**反向对照** ——
 *       401 不被限流文案吞、429 不被额度关键词吞（顺序挪一格就是 bug）。
 *   [B] 状态迁移三条纪律：冷却期内不加深、不同类别取更远者、硬状态不被软观测降级。
 *   [C] A5 分级排除 + A8 手动/自动双状态位（enable 不碰自动位、revive 不碰手动位）。
 *   [D] 接线静态守卫（daemon 端点/落盘/ports、inject 徽标/i18n/CSS、mac 打包白名单），
 *       含一条**反向守卫**：runLimitFailoverCore 切片里不许出现模块级新标识符
 *       （否则切片沙箱 ReferenceError，被外层 catch 吞成静默业务失败）。
 *
 * 设计约束（照抄维护手册 §6 与既有做法）：
 *   1. 不 require daemon.js（它 require 即起 HTTP 服务）—— 静态源码断言；
 *   2. account-health.js / limit-failover.js 都无副作用，直接 require 真跑；
 *   3. daemon.js / inject.js 是 CRLF，断言前先归一化为 LF；
 *   4. 时刻全部用**固定基准 T0**，断言不依赖真实时钟。
 *
 * 跑法：node .wd-analysis/test-account-health.js
 */

const fs = require('fs');
const path = require('path');

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

const AH = require(path.join(ROOT, 'scripts', 'account-health.js'));
const LF = require(path.join(ROOT, 'scripts', 'limit-failover.js'));
const CL = require(path.join(ROOT, 'scripts', 'account-switch-log.js'));

// 固定基准时刻：断言只跟「记录时刻 / 判据时刻」的差有关，跟跑测试的钟没关系。
const T0 = 1758300000000;
const W = AH.DEFAULT_RATE_WINDOW_MS;
const MIN = 60 * 1000;
const cls = (o) => AH.classifyObservation(Object.assign({ now: T0 }, o));
// 观测时刻与基准不同的场合用它：分类器用 `now` 算「相对窗口」的 until，
// 传错时刻会让 until 差出一整段（症状是「明明取更远者，结果没变长」）。
const clsAt = (o, now) => AH.classifyObservation(Object.assign({ now: now }, o));
const table = (o) => { const c = cls(o); return c.kind + '/' + c.state + '/' + (c.until ? (c.until - T0) : 0); };

/* ==================================================================== */
section('[A] 分类器：13 层「严 → 宽」，顺序即语义');
/* ==================================================================== */

ok(W === LF.LIMIT_FAILOVER_WINDOW_MS,
  'A1 软冷却默认窗口与 limit-failover 同源（两处各持常量，但取值必须一致）', { ah: W, lf: LF.LIMIT_FAILOVER_WINDOW_MS });

// —— 正常分层 ——
ok(table({ source: 'dom-banner', hits: [{ sel: '.rate-limit-info-banner', text: '当前模型用量已达今日上限' }] })
  === 'model_blocked/rate_limited/' + W,
  'A2 A 路横幅（bizCode 6004）→ model_blocked（只记模型维度，不罚账号）', table({ text: '6004' }));
ok(table({ text: '6004' }) === 'model_blocked/rate_limited/' + W, 'A3 文案带 6004 → model_blocked');
ok(table({ text: '已达今日上限' }) === 'model_blocked/rate_limited/' + W, 'A4 「已达今日上限」文案 → model_blocked');
ok(table({ text: '14012' }) === 'quota_hard/rate_limited/' + W, 'A5 额度码 14012 → quota_hard');
ok(table({ text: '14014' }) === 'quota_hard/rate_limited/' + W, 'A6 额度码 14014 → quota_hard');
ok(table({ httpStatus: 402 }) === 'quota_hard/rate_limited/' + W, 'A7 HTTP 402 → quota_hard（额度用尽）');
ok(table({ text: '额度不足，请充值' }) === 'quota_hard/rate_limited/' + W, 'A8 硬额度文案 → quota_hard');
ok(table({ httpStatus: 429 }) === 'rate_soft/rate_limited/' + W, 'A9 HTTP 429 → rate_soft');
ok(table({ source: 'dom-banner', hits: [{ sel: '.cb-input-banner--error', text: '请求过于频繁' }] }) === 'rate_soft/rate_limited/' + W,
  'A10 B 路错误横幅 + 限流文案 → rate_soft');
ok(table({ source: 'dom-banner', hits: [{ sel: '.cb-queue-banner--full', text: '队列已满' }] }) === 'rate_soft/rate_limited/' + W,
  'A11 C 路队列满横幅 → rate_soft（保持既有「队列满也触发切号」的行为，不静默降级）');
ok(table({ httpStatus: 503 }) === 'server/rate_limited/' + W, 'A12 HTTP 5xx → server（喂熔断）');
ok(table({ httpStatus: 418 }) === 'client/rate_limited/' + W, 'A13 其余 4xx → client（只换号 + 喂连败）');
ok(table({ text: '内容审核未通过' }) === 'content_blocked/ok/0', 'A14 审核拦截 → **不罚号**（state=ok，不落盘）');
ok(table({ text: 'prompt is too long' }) === 'bad_params/ok/0', 'A15 参数错 / prompt 过长 → **不罚号**');
ok(table({ text: '' }) === 'ok/ok/0', 'A16 没有信号 → ok');
ok(table({}) === 'ok/ok/0', 'A17 空观测 → ok（默认中性）');

// —— 凭证死亡 ——
ok(table({ authValid: false }) === 'account_fault/disabled/0', 'A18 认证档案不可解析 → account_fault / disabled');
ok(table({ authExpired: true }) === 'session_dead/needs_reauth/0', 'A19 authExpired → session_dead / needs_reauth');
ok(table({ httpStatus: 401 }) === 'session_dead/needs_reauth/0', 'A20 HTTP 401 → needs_reauth');
ok(table({ refreshExpired: true }) === 'session_dead/needs_reauth/0', 'A21 刷新令牌已死 → needs_reauth');
ok(table({ checkinCode: '401' }) === 'session_dead/needs_reauth/0', 'A22 签到 code=401 → needs_reauth');
ok(table({ text: '登录已过期，请重新登录' }) === 'session_dead/needs_reauth/0', 'A23 会话死亡文案 → needs_reauth');

// —— 反向对照（顺序挪一格就出错） ——
ok(table({ httpStatus: 401, text: '14012' }) === 'session_dead/needs_reauth/0',
  'A24 【顺序·关键】401 与额度码同时出现 → 判凭证死亡（额度码里的 "401" 子串不得抢先）');
ok(cls({ text: '14012' }).state === AH.HEALTH_STATES.RATE_LIMITED,
  'A25 【数字边界】14012 / 14014 / 14018 / 14019 不会被裸 401 正则误判成需重登');
ok(cls({ text: '140120' }).kind === AH.HEALTH_KINDS.Ok && cls({ text: '4010' }).kind === AH.HEALTH_KINDS.Ok,
  'A26 【数字边界】140120 / 4010 这类超集数字不命中任何 token');
ok(table({ httpStatus: 429, text: '429 quota exceeded' }) === 'rate_soft/rate_limited/' + W,
  'A27 【顺序·关键】429 与「quota exceeded」同时出现 → 判软限流（429 先于 hardMarkers；否则白扔一个号十来小时）');
ok(table({ httpStatus: 429, text: '额度不足' }) === 'rate_soft/rate_limited/' + W,
  'A28 【顺序·关键】429 与中文硬额度文案同时出现 → 仍判软限流');

// —— resolveUntil：权威时刻优缺毋滥 ——
ok(cls({ httpStatus: 429, resetAt: T0 + 30 * MIN }).until === T0 + 30 * MIN,
  'A29 观测带权威重置时刻（F1 填）→ until 取那一刻');
ok(cls({ httpStatus: 429, resetAt: T0 - 1 }).until === T0 + 1,
  'A30 墙钟已过期 → 钳到 now+1ms 立即恢复（不给负值，也不臆造等待时长）');
ok(cls({ httpStatus: 429, resetAt: T0 + 10 * 60 * MIN }).until === T0 + AH.MAX_SOFT_UNTIL_MS,
  'A31 软冷却截断到 now + 2h（上游 cappedSoftUntil 口径）');
ok(cls({ httpStatus: 402, resetAt: T0 + 48 * 60 * MIN }).until === T0 + AH.MAX_HARD_UNTIL_MS,
  'A32 额度类允许更长，但封 24h（不造出「永不解冻」）');
ok(cls({ httpStatus: 402, resetAt: T0 + 6 * 60 * MIN }).until === T0 + 6 * 60 * MIN,
  'A32b 权威时刻在封顶之内 ⇒ 原样采信（封顶只在超限时生效，不把 6h 拉成 24h）');

/* ==================================================================== */
section('\n[B] 状态迁移：三条纪律');
/* ==================================================================== */

{
  // 纪律一：冷却期内同 kind 重复命中 → 只 +hits，**不推进 until**。
  let h = AH.applyObservation({}, 'u1', cls({ httpStatus: 429, reason: '第一次' }), T0);
  const first = h.accounts.u1.until;
  h = AH.applyObservation(h, 'u1', cls({ httpStatus: 429, reason: '第二次' }, T0 + 60 * 1000), T0 + 60 * 1000);
  ok(h.accounts.u1.until === first, 'B1 【纪律一】同 kind 冷却期内重复命中不推进 until（越重试越冷的根因）', h.accounts.u1.until - T0);
  ok(h.accounts.u1.hits === 2, 'B2 【纪律一】只累加 hits', h.accounts.u1.hits);
  ok(h.accounts.u1.since === T0, 'B3 【纪律一】since 保持首次命中时刻（不重置冷却起点）', h.accounts.u1.since - T0);

  // 纪律二：不同类别 → until 取更远者、kind 取更硬者。
  h = AH.applyObservation(h, 'u1', clsAt({ httpStatus: 402, reason: '额度' }, T0 + 2 * MIN), T0 + 2 * MIN);
  ok(h.accounts.u1.until === T0 + 2 * MIN + W, 'B4 【纪律二】不同类别并存取更远者（或门，不叠加）', h.accounts.u1.until - T0);
  ok(h.accounts.u1.kind === AH.HEALTH_KINDS.QuotaHard, 'B5 【纪律二】kind 取更硬者（quota_hard > rate_soft）', h.accounts.u1.kind);

  // 反向：先短后长 / 先长后短 —— 取的是「最远者」，不是相加，也与到达顺序无关。
  let s1 = AH.applyObservation({}, 'v1', clsAt({ httpStatus: 429 }, T0), T0);
  s1 = AH.applyObservation(s1, 'v1', clsAt({ httpStatus: 402 }, T0 + 2 * MIN), T0 + 2 * MIN);
  let s2 = AH.applyObservation({}, 'v2', clsAt({ httpStatus: 402 }, T0 + 2 * MIN), T0 + 2 * MIN);
  s2 = AH.applyObservation(s2, 'v2', clsAt({ httpStatus: 429 }, T0), T0); // 乱序：观测时刻早于已有记录
  ok(s1.accounts.v1.until === T0 + 2 * MIN + W && s2.accounts.v2.until === T0 + 2 * MIN + W,
    'B6 【纪律二】顺序无关：两条不同类别的截止取最远者，既不相加也不被早到的观测拉短',
    { v1: s1.accounts.v1.until - T0, v2: s2.accounts.v2.until - T0, want: 2 * MIN + W });
  ok(s2.accounts.v2.kind === AH.HEALTH_KINDS.QuotaHard,
    'B6b 【纪律二】乱序到达时 kind 仍取更硬者（没有被后来的软观测覆盖）', s2.accounts.v2.kind);

  // 纪律三：硬状态不被软观测降级。
  let h3 = AH.applyObservation({}, 'u2', cls({ authExpired: true }), T0);
  h3 = AH.applyObservation(h3, 'u2', cls({ httpStatus: 429, reason: '限流' }, T0 + 1000), T0 + 1000);
  ok(h3.accounts.u2.state === AH.HEALTH_STATES.NEEDS_REAUTH && h3.accounts.u2.kind === AH.HEALTH_KINDS.SessionDead,
    'B7 【纪律三】needs_reauth 不被后续限流观测降级', h3.accounts.u2);
  ok(h3.accounts.u2.hits === 2 && h3.accounts.u2.lastReason === '限流',
    'B8 【纪律三】降级被拒时仍留痕（hits / lastReason），便于回答「为什么没变动」', h3.accounts.u2);

  // 中性分类（审核拦截 / 参数错 / 无信号）**不写健康表**。
  const h4 = AH.applyObservation({}, 'u3', cls({ text: '内容审核未通过' }), T0);
  ok(!h4.accounts.u3, 'B9 「不罚号」就是真的不写表（审核拦截 / 参数错 / 无信号都不落盘）', Object.keys(h4.accounts));

  // 到期物化为 ok，但条目保留（hits / lastReason 供诊断）。
  const expiredView = AH.readHealth(h, 'u1', T0 + 10 * 60 * MIN);
  ok(expiredView.state === AH.HEALTH_STATES.OK, 'B10 until 到期 → 视图物化为 ok');
  ok(h.accounts.u1.hits >= 2, 'B11 到期不清条目：hits / lastReason 仍保留（诊断要用）', h.accounts.u1.hits);

  // 模型维度单独记一份（A3 的本地最小形态）。
  const h5 = AH.applyObservation({}, 'u4', cls({ bizCode: 6004, modelId: 'm-x' }), T0);
  ok(h5.accounts.u4.models && h5.accounts.u4.models['m-x'] && h5.accounts.u4.models['m-x'].kind === AH.HEALTH_KINDS.ModelBlocked,
    'B12 A3 最小形态：模型维度单独记一份（本期选号粒度仍是账号级）', h5.accounts.u4.models);

  // 落盘结构宽容：非对象 / 缺字段 / 未知字段都不炸。
  ok(AH.normalizeHealth(null).accounts && Object.keys(AH.normalizeHealth(null).accounts).length === 0,
    'B13 normalizeHealth 对 null / 非对象宽容（读坏文件不炸）');
  ok(AH.readHealth({ u: { until: 'abc' } }, 'u', T0).state === AH.HEALTH_STATES.OK,
    'B14 脏 until（非数字）不会造出假的「被限流」');
  ok(AH.readHealth({}, 'nobody', T0).state === AH.HEALTH_STATES.OK, 'B15 没有记录 ⇒ ok');
}

/* ==================================================================== */
section('\n[C] A5 分级排除 + A8 双状态位');
/* ==================================================================== */

{
  let h = {};
  h = AH.applyObservation(h, 'r', cls({ httpStatus: 429 }), T0);              // rate_soft
  h = AH.applyObservation(h, 'q', cls({ httpStatus: 402 }), T0);              // quota_hard
  h = AH.applyObservation(h, 'n', cls({ authExpired: true }), T0);            // needs_reauth
  h = AH.applyObservation(h, 'd', cls({ authValid: false }), T0);             // disabled(auto)
  h = AH.setManualDisabled(h, 'm', true, '手动停用', T0);                       // disabled(manual)

  ok(AH.isUsableView(AH.readHealth(h, 'r', T0)).usable === true,
    'C1 rate_soft 冷却中**仍可**当备选（上游：CoolSoft 允许参与，可能已恢复）');
  ok(AH.isUsableView(AH.readHealth(h, 'q', T0)).reason === 'quota_hard',
    'C2 quota_hard **排除**（调了必 402，浪费轮换）');
  ok(AH.isUsableView(AH.readHealth(h, 'n', T0)).reason === 'needs_reauth',
    'C3 needs_reauth **排除**（等不来自愈，选了必失败 —— opencodex 规则 ①）');
  ok(AH.isUsableView(AH.readHealth(h, 'd', T0)).reason === 'disabled', 'C4 disabled(自动) **排除**');
  ok(AH.isUsableView(AH.readHealth(h, 'm', T0)).reason === 'disabled', 'C5 disabled(手动) **排除**');
  ok(AH.isUsableView(null).usable === true && AH.isUsableView(undefined).usable === true,
    'C6 没有视图 ⇒ 视为可用（缺省不过滤，不能因为读不到健康数据就停掉切号）');
  ok(AH.isUsableForFailover(h, 'q', T0).usable === false && AH.isUsableForFailover(h, 'r', T0).usable === true,
    'C7 isUsableForFailover 与 isUsableView 同一份规则（daemon 谓词直接问它）');

  // A8：两个状态位独立。
  const autoEntry = AH.readHealth(h, 'd', T0);
  ok(autoEntry.autoDisabled === true && autoEntry.manualDisabled === false,
    'C8 自动位由 state==="disabled" 派生（不落盘第二位，只存一份真相）', autoEntry);

  const afterEnable = AH.setManualDisabled(h, 'd', false, '', T0);
  ok(AH.readHealth(afterEnable, 'd', T0).state === AH.HEALTH_STATES.DISABLED,
    'C9 【A8】enable 解手动位，**不碰自动位** ⇒ 系统判坏的号不会被一次手动解停悄悄放回池');

  const manualOnly = AH.setManualDisabled(h, 'n', true, '手动', T0);
  const afterRevive = AH.reviveAuto(manualOnly, 'n', T0);
  ok(AH.readHealth(afterRevive, 'n', T0).state === AH.HEALTH_STATES.DISABLED
    && AH.readHealth(afterRevive, 'n', T0).manualDisabled === true,
    'C10 【A8】revive 解自动位，**不碰手动位** ⇒ 用户手动摘除的号不会被自动复活路径解除');

  const cleared = AH.clearHealth(h, 'r');
  ok(!cleared.accounts.r, 'C11 clearHealth 整条删除');
  ok(AH.readHealth(h, 'd', T0).manualDisabled === false && AH.readHealth(h, 'm', T0).manualDisabled === true,
    'C12 手动停用的视图带 manualDisabled 标记（面板据此区分「手动摘除」与「系统判坏」）');

  // A8 幂等：对「本来就没有记录」的账号解手动位 ⇒ 真 no-op，不留空壳。
  // （活体探测时实测到：面板点一下「启用」会给健康表写一条 state 为空的垃圾记录。）
  ok(Object.keys(AH.setManualDisabled({}, 'nobody', false, '', T0).accounts).length === 0,
    'C12b 【幂等】enable 一个从没被停用过的账号 ⇒ 一个字都不写（不留空壳记录）');
  ok(AH.readHealth(AH.setManualDisabled({}, 'nobody', true, '停用', T0), 'nobody', T0).state === AH.HEALTH_STATES.DISABLED,
    'C12c 但 disable 一个没有记录的账号仍要建记录（幂等 ≠ 不生效）');

  // 分组视图
  const proj = AH.projectHealth(h, T0, ['r', 'q', 'n', 'd', 'm', 'extra']);
  ok(proj.counts.total === 6 && proj.counts.ok === 1, 'C13 projectHealth 把「没有记录的账号」也算 ok 一起列出（面板要看全池）', proj.counts);
  ok(proj.groups.rate_limited.length === 2 && proj.groups.needs_reauth.length === 1 && proj.groups.disabled.length === 2,
    'C14 分组计数正确（rate_soft 与 quota_hard 同归 rate_limited —— 同一 state，面板不该为它多分一组）', proj.counts);
  ok(proj.groups.rate_limited[0].remainingMs === W, 'C15 视图带剩余冷却毫秒（面板/状态接口同源）', proj.groups.rate_limited[0].remainingMs);

  // 账号档案采集器：只认「等不来自愈」的信号。
  ok(AH.classifyAccountRecord({ authValid: false }, T0).state === AH.HEALTH_STATES.DISABLED,
    'C16 档案 authValid=false → disabled');
  ok(AH.classifyAccountRecord({ authValid: true, refreshExpiresAt: T0 - 1000 }, T0).state === AH.HEALTH_STATES.NEEDS_REAUTH,
    'C17 刷新令牌已过期 → needs_reauth');
  ok(AH.classifyAccountRecord({ authValid: true, checkin: { code: '401', message: '登录身份过期' } }, T0).state === AH.HEALTH_STATES.NEEDS_REAUTH,
    'C18 签到缓存里的 401 → needs_reauth');
  ok(AH.classifyAccountRecord({ authValid: true, tokenExpiresAt: T0 - 1000 }, T0).state === AH.HEALTH_STATES.OK,
    'C19 【刻意不认】access token 过期属**可自愈**（本地有惰性刷新 + 每日保活）⇒ 不报 needs_reauth，否则会误标正常账号');
  ok(AH.classifyAccountRecord({ authValid: true, tokenExpiresAt: T0 - 1000 }, T0).kind === AH.HEALTH_KINDS.Ok,
    'C20 同上：kind 也必须是 ok');
}

/* ==================================================================== */
section('\n[D] pickFailoverTarget 的可选健康过滤（缺省零行为变化）');
/* ==================================================================== */

{
  const accounts = [{ uid: 'A' }, { uid: 'B' }, { uid: 'C' }];
  const blocked = LF.markAccountBlocked({}, 'C', T0 - 60000, 'detected');

  const bare = LF.pickFailoverTarget(accounts, 'A', blocked, T0);
  const explicitEmpty = LF.pickFailoverTarget(accounts, 'A', blocked, T0, {});
  const healthUndef = LF.pickFailoverTarget(accounts, 'A', blocked, T0, { health: undefined });
  ok(JSON.stringify(bare) === JSON.stringify(explicitEmpty) && JSON.stringify(bare) === JSON.stringify(healthUndef),
    'D1 【零行为变化】不传 health / 传空对象 / health 非函数 ⇒ 结果逐字节一致',
    { bare: bare.account && bare.account.uid, empty: explicitEmpty.account && explicitEmpty.account.uid });
  ok(bare.account && bare.account.uid === 'B' && bare.blocked.length === 0 && Array.isArray(bare.excluded),
    'D2 成功分支新增 excluded（附加值，既有消费方不必判字段在不在）', bare);

  const noneOk = LF.pickFailoverTarget(accounts, 'A', blocked, T0, { health: () => false });
  ok(noneOk.account === null && noneOk.reason === 'all-unhealthy',
    'D3 全池被健康判据排除 → reason=all-unhealthy（与 all-blocked 分开）', noneOk);
  ok(noneOk.excluded.length === 2 && noneOk.excluded.indexOf('B') >= 0 && noneOk.excluded.indexOf('C') >= 0,
    'D4 all-unhealthy 时列出被排除的 uid（用于日志与面板）', noneOk.excluded);
ok(LF.pickFailoverTarget(accounts, 'A', blocked, T0, { health: () => false }).reason
  !== LF.pickFailoverTarget([{ uid: 'A' }], 'A', blocked, T0, { health: () => false }).reason,
  'D5 all-unhealthy 与 no-others 是两个不同的 reason（提示词不能共用）',
  [noneOk.reason, LF.pickFailoverTarget([{ uid: 'A' }], 'A', blocked, T0, { health: () => false }).reason]);
ok(LF.pickFailoverTarget([{ uid: 'A' }], 'A', blocked, T0, { health: () => false }).reason === 'no-others',
  'D5b 没有别的账号时先判 no-others（「无账号」优先于「都有病」，否则提示会指错方向）');

// 谓词按账号逐个生效：被排除的那个不参与候选。
{
  const healthExcludesB = LF.pickFailoverTarget(accounts, 'A', {}, T0, { health: (a) => a.uid !== 'B' });
  ok(healthExcludesB.account && healthExcludesB.account.uid === 'C'
    && healthExcludesB.excluded.length === 1 && healthExcludesB.excluded[0] === 'B',
    'D6 谓词逐个账号生效：被排除的账号不进候选，且记进 excluded', healthExcludesB);
}

  // 谓词抛错必须被吞成「可用」，不能中断选号。
  const thrower = LF.pickFailoverTarget(accounts, 'A', blocked, T0, { health: () => { throw new Error('boom'); } });
  ok(thrower.account && thrower.account.uid === 'B',
    'D7 谓词抛错 ⇒ 回退到「视为可用」（宁可多试一轮，不可因为健康探测坏了就不切号）', thrower.account && thrower.account.uid);

  // 与全被限流的区分
  const allBlocked = LF.pickFailoverTarget(accounts, 'A',
    LF.markAccountBlocked(LF.markAccountBlocked({}, 'B', T0 - 1000, 'x'), 'C', T0 - 2000, 'x'), T0);
  ok(allBlocked.reason === 'all-blocked' && allBlocked.earliestRecovery > T0,
    'D8 没传 health 时 all-blocked 语义与 earliestRecovery 一字未变（v1.4.1 的 P1-7 修复未被破坏）', allBlocked.reason);
}

/* ==================================================================== */
section('\n[E] daemon 接线静态守卫（CRLF 先归一化再匹配）');
/* ==================================================================== */

const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
const hasD = (needle) => daemonSrc.includes(needle);

ok(hasD("const accountHealth = require('./account-health.js');"),
  'E1 daemon 启动期 require 账号健康模块（纯模块，无副作用）');
ok(hasD("const ACCOUNT_HEALTH_FILE = path.join(DATA_DIR, 'account-health.json');"),
  'E2 落盘文件是 DATA_DIR/account-health.json（F2 spec 指定）');
ok(hasD('const tmp = ACCOUNT_HEALTH_FILE + \'\.tmp\';') || /ACCOUNT_HEALTH_FILE \+ '\.tmp'/.test(daemonSrc),
  'E3 原子落盘（tmp + rename，与 limit-failover-state.json 同一手法）');
ok(hasD('if (cls.kind === accountHealth.HEALTH_KINDS.Ok || cls.state === accountHealth.HEALTH_STATES.OK) return { cls, state: readAccountHealth() };'),
  'E4 中性分类不落盘（「不罚号」在 daemon 侧也真的不写：审核拦截 / 参数错同样跳过写盘）');
ok(hasD("if (req.method === 'GET' && p === '/api/account-health') {"),
  'E5 只读视图端点 GET /api/account-health 在位');
for (const act of ['disable', 'enable', 'revive', 'clear']) {
  ok(hasD("p === '/api/account-health/" + act + "'"), 'E6-' + act + ' 幂等端点 /api/account-health/' + act + ' 在位');
}
ok(hasD('function accountHealthUidOf(body) {') && /if \(!\/\^\[A-Za-z0-9_-\]\{1,128\}\$\/\.test\(uid\)\) throw new Error\('uid 格式无效'\);/.test(daemonSrc),
  'E7 新增端点走与其他路由同一条 uid 口径（格式校验 + 抛错映射 400）');
ok(hasD('status.health = accountHealthSummary(accountHealthBadges(Date.now()));'),
  'E8 /api/status 鉴权分支透出健康概览');
ok(hasD('health: healthBadges[String(a.uid)] || null,'), 'E9 /api/accounts 每个账号带 health（面板徽标的数据源）');
ok(/try \{\n\s+status\.health = accountHealthSummary/.test(daemonSrc),
  'E10 status.health 整段吞异常（状态接口是启动器/更新器的就绪探针，不能被健康读盘拖挂）');
ok(daemonSrc.indexOf("const cache = loadCheckinCache();\n    const today = todayStr();") > 0
  && daemonSrc.indexOf('const healthRecords = accounts.map((a) => Object.assign({}, a, { checkin: cache[String(a.uid)] || null }));') > 0,
  'E11 体检用**原始**签到缓存条目，不用 checkinDisplayValue 的投影（后者把签到失败投影成 null，健康判据会断）');
ok(hasD('recordAccountHealth(uid, { source: \'credit-api\', httpStatus: 401, reason: \'登录身份过期\' }, Date.now());'),
  'E12 /api/credits 的 401 会记成 needs_reauth（面板最常触发的健康信号源）');

// 切号路径的三个端口（全部可选 ⇒ 测试沙箱不注入即零行为变化）
ok(hasD('healthFilter: buildFailoverHealthFilter(),'), 'E13 端口 healthFilter 已接线（A5 谓词）');
ok(hasD('recordHealth: (uid, observation) => recordAccountHealth(uid, observation, Date.now()),'), 'E14 端口 recordHealth 已接线');
ok(hasD('clearHealth: (uid) => {'), 'E15 端口 clearHealth 已接线（备选账号证明能干活后清自动位）');
ok(hasD("const healthOptions = typeof ports.healthFilter === 'function' ? { health: ports.healthFilter } : {};"),
  'E16 核心从端口取谓词，没注入就不过滤');
ok(hasD("const allUnhealthy = nothingToTry && !!(emptyPick && emptyPick.reason === 'all-unhealthy');"),
  'E17 收尾区分 all-unhealthy（与 all-blocked / no-others 三足鼎立）');
ok(hasD('其他账号需要先重新登录（或已被手动停用），已停止自动切号 —— 请到账号面板看各账号的健康状态'),
  'E18 整池不健康时的提示明确指向「重新登录」，不谎称「都无法接管」');

/* --- 反向守卫：切片沙箱里不许出现新的模块级标识符 --- */
{
  const coreStart = daemonSrc.indexOf('/* ---------------- 模型限流自动切号续跑 ---------------- */');
  const coreAnchor = daemonSrc.indexOf('async function runLimitFailoverCore(detail, ports) {', coreStart);
  let depth = 0, coreEnd = -1;
  for (let i = daemonSrc.indexOf('{', coreAnchor); i < daemonSrc.length; i += 1) {
    const ch = daemonSrc[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { coreEnd = i + 1; break; } }
  }
  const core = coreEnd > 0 ? daemonSrc.slice(coreStart, coreEnd) : '';
  ok(core.length > 0, 'E19 能切出 runLimitFailoverCore（锚点未失效）');
  ok(core.indexOf('accountHealth.') < 0,
    'E20 【反向守卫】切片内不引用 accountHealth 模块级标识符 —— 切片单测的依赖表没注入它，'
    + '一旦引用就是 ReferenceError，而它被外层 try/catch 吞掉 ⇒ 静默变成业务失败（维护手册明载的坑）');
  ok(core.indexOf('failoverHealthOptions(') < 0 && core.indexOf('buildFailoverHealthFilter(') < 0,
    'E21 【反向守卫】切片内不直接调用模块级 helper（同上）');
  ok(core.indexOf('typeof ports.recordHealth') >= 0 && core.indexOf('typeof ports.clearHealth') >= 0
    && core.indexOf('typeof ports.healthFilter') >= 0,
    'E22 三个健康端口在切片内都是 typeof 守卫（沙箱不注入即整段跳过）');
  ok(core.indexOf('recordAccountHealth(') < 0,
    'E23 【反向守卫】切片内不直接调 recordAccountHealth（只经端口）');
}

/* --- 打包白名单 --- */
{
  const mac = fs.readFileSync(path.join(ROOT, 'scripts', 'build-mac-dmg.sh'), 'utf8');
  const required = [...new Set([...daemonSrc.matchAll(/require\('\.\/([A-Za-z0-9._-]+\.js)'\)/g)].map((m) => m[1]))]
    .filter((name) => fs.existsSync(path.join(ROOT, 'scripts', name)));
  const missing = required.filter((name) => !new RegExp('(^|[\\s"])' + name.replace(/[.]/g, '\\.') + '($|[\\s;])', 'm').test(mac));
  ok(missing.length === 0, 'E24 account-health.js 已进 mac DMG 显式白名单（Windows 走 cp -R 整目录，不受影响）', missing);
}

/* ==================================================================== */
section('\n[F] 面板接线（inject.js：徽标 / i18n / CSS）');
/* ==================================================================== */

const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
const hasI = (needle) => injectSrc.includes(needle);

ok(hasI('function healthBadgeHtml(a) {'), 'F1 徽标渲染函数在位');
ok(hasI('function accountHealthLocked(a) {'), 'F2 「该不该允许切过去」的判据抽成函数（三处共用一份）');
ok(hasI("'<span class=\"wbs-health-cell\">' + healthBadge + '</span>"),
  'F3 徽标挂进账号卡片昵称行，且有稳定的容器类名（供就地重绘定位）');
ok(hasI('if (healthCell) healthCell.innerHTML = healthBadgeHtml(account);'),
  'F4 徽标随积分刷新就地重绘（否则要等 layout key 变化才更新，冷却到期会一直显示旧值）');
ok((injectSrc.match(/if \(healthCell\) healthCell\.innerHTML = healthBadgeHtml\(account\);/g) || []).length === 2,
  'F5 两处刷新路径（updateCreditCell / updateCheckinCells）都重绘徽标 —— 漏一处就会出现「有的卡片更新、有的不更新」');
ok(injectSrc.split('accountHealthLocked(account) ?').length - 1 === 2
  && injectSrc.split('|| healthLocked ?').length - 1 === 1,
  'F6 三处切换按钮的显隐都加上了健康锁定（渲染期 1 处 + 刷新期 2 处）');
ok(hasI('var healthLocked = accountHealthLocked(a);'), 'F7 渲染期用同一判据（不各写一份条件）');
ok(hasI("h ? h.state : '', h ? String(h.kind || '') : '', h && h.manualDisabled === true ? 1 : 0];"),
  'F8 健康 state/kind 进了卡片 layout key（否则「限流中 → 需重新登录」不会重建卡片）');
ok(injectSrc.indexOf('remainingMs') < 0 || injectSrc.indexOf('accountCardLayoutKey') > 0,
  'F9 layout key 里不放 remainingMs（它每秒都变，放进来等于每秒重建整列表）');
{
  const keyStart = injectSrc.indexOf('function accountCardLayoutKey() {');
  const keyBody = injectSrc.slice(keyStart, keyStart + 900);
  // 先剥掉行注释：注释里提醒「不放剩余时间」不算违规，只有真进数组的字段才算。
  const keyCode = keyBody.replace(/\/\/[^\n]*/g, '');
  ok(keyCode.indexOf('remainingMs') < 0,
    'F10 【反向守卫】layout key 内确认无 remainingMs（保住切换按钮的两击确认状态）');
  ok(keyBody.indexOf('healthBadgeHtml') < 0, 'F11 layout key 只比字符串，不做渲染（保持廉价）');
}
ok(injectSrc.split('function healthBadgeHtml(a) {').length - 1 === 1, 'F12 healthBadgeHtml 只定义一次（同名的后一份会被静默丢弃）');

/* --- CSS --- */
for (const cls2 of ['wbs-health-rate-limited', 'wbs-health-needs-reauth', 'wbs-health-disabled', 'wbs-health-cell']) {
  ok(injectSrc.indexOf("'." + cls2) >= 0 || injectSrc.indexOf('.' + cls2) >= 0, 'F13-' + cls2 + ' CSS 类 ' + cls2 + ' 有规则');
}
ok(injectSrc.split('html.cb-dark .wbs-health-rate-limited').length - 1 === 1
  && injectSrc.split('html.cb-dark .wbs-health-needs-reauth').length - 1 === 1
  && injectSrc.split('html.cb-dark .wbs-health-disabled').length - 1 === 1,
  'F14 三个健康徽标各有深色模式覆盖（浅色实色 + 深色半透明，不用一个配色打天下）');

/* --- i18n --- */
{
  const a = injectSrc.indexOf('var WBS_I18N_EN = {');
  const b = injectSrc.indexOf('\n  };', a);
  const dict = injectSrc.slice(a, b);
  ok(a > 0 && b > a, 'F15 能切出 WBS_I18N_EN 字典');
  for (const kv of [["'需重新登录'", 'Sign in again'], ["'已手动停用'", 'Disabled manually'],
    ["'额度已用尽'", 'Quota exhausted'], ["'模型额度已满'", 'Model cap reached'], ["'限流中'", 'Rate limited']]) {
    const key = kv[0];
    const count = dict.split(key).length - 1;
    ok(count === 1, 'F16 词条 ' + key + ' 在字典里**恰好一次**（重复定义会被静默丢弃，留首次）', count);
    ok(dict.indexOf(key + ': ' + "'" + kv[1] + "'") >= 0, 'F17 词条 ' + key + ' 的英文正确', kv[1]);
  }
  // 徽标文案必须整句/整词入典：面板 10px 小字被撕成中英混杂最难读。
  ok(hasI("if (state === 'needs_reauth') text = '需重新登录';")
    && hasI("else if (state === 'disabled') text = h.manualDisabled === true ? '已手动停用' : '已停用';"),
    'F18 徽标文案直接取整句，不做字符串拼接（拼接会绕过词典匹配）');
  ok(hasI("else if (h.kind === 'quota_hard') text = '额度已用尽';")
    && hasI("else if (h.kind === 'model_blocked') text = '模型额度已满';")
    && hasI("else text = '限流中';"),
    'F19 三档限流文案（额度耗尽 / 模型额度 / 普通限流）各自成句');
}

/* --- 桌面日志文案 --- */
ok(CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'all-unhealthy' }).indexOf('重新登录') > 0,
  'F20 all-unhealthy 有中文文案（未收录会把英文 reason 原样吐给用户）',
  CL.buildFailureReport({ at: T0, fromUid: 'a', fromNickname: 'A', reason: 'all-unhealthy' }).split('\n').filter((l) => l.indexOf('卡在哪') >= 0));

/* ==================================================================== */
console.log('\n==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
