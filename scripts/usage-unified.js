'use strict';

/**
 * 统一用量看板的数据抽取器（WorkDaddy 自绘）。
 *
 * 设计目标：把「原来的用量统计」与「第三方 Usage Status 看板」两套数据源合成
 * **一份带 (日期 × 账号 × 模型) 三键的 JSON**，供单个 HTML 面板做即时筛选。
 *
 * 三个数据源，各司其职（2026-09-23 实测确定，别换）：
 *   ① 账号/模型/日期的 token 分项  → `token-stats.js` 的 scanTokenStatsCached
 *      （它已经解决了「切号副本重复计数」「已删会话归属丢失」两个历史 bug，不要另写一套）
 *   ② 积分（credit）               → `%APPDATA%/WorkDaddy/credit-usage.db` 的
 *      `credit_usage_records`（**权威源**：daemon 自己从官方用量接口同步下来的逐请求记录，
 *      天然带 uid / usage_date / model 三个维度，不需要任何猜归属）
 *   ③ 思维链 token                 → jsonl 的 `providerData.rawUsage.completion_thinking_tokens`
 *
 * ⚠️ 为什么不用 session_usage.credit_json（2026-09-23 踩坑记录）：
 * 它看起来更「官方」（就在 workbuddy.db 里），但有两个致命问题：
 *   1. 它的键是请求 id，要靠 jsonl 记录去反查日期与模型；而同一个 id 会在**多条** jsonl
 *      记录里重复出现（父子引用等），逐条累加会重复计数 —— 实测把 5 511 积分算成 275 470
 *      （≈50×），并且把绝大部分虚增堆到「今天」，趋势图完全失真。
 *   2. 它的覆盖范围受本地 jsonl 保留期限制，会话一被清理就只能计入 orphan（实测 84% 的
 *      积分拆不动）。
 * 现在只把它当作**兜底**（没有 credit-usage.db 时），并且已经修掉重复计数。
 */

const fs = require('fs');
const path = require('path');

const { scanTokenStatsCached, localDayString } = require('./token-stats.js');
const { createSessionTitleResolver, mergeTitleSnapshot, sanitizeTitle } = require('./session-titles.js');

const DEFAULT_DAYS = 90;
const MAX_JSONL_READ_BYTES = 64 * 1024 * 1024; // 单文件读取上限，防极端文件拖死

function pad2(value) {
  return String(value).padStart(2, '0');
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dayOf(timestamp) {
  return localDayString(Number(timestamp));
}

/** 在 <root>/projects/<slug>/<sessionId>.jsonl 里定位会话文件（只扫一层目录）。 */
function locateSessionJsonl(root, sessionId) {
  if (!sessionId) return null;
  const projects = path.join(root, 'projects');
  let slugs;
  try { slugs = fs.readdirSync(projects, { withFileTypes: true }); } catch (_) { return null; }
  for (const entry of slugs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projects, entry.name, sessionId + '.jsonl');
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) { /* 继续找 */ }
  }
  return null;
}

/**
 * 【兜底路径】把某个会话的 credit 拆到 (日期 × 模型)。
 * @returns {{items: Array<{day:string,model:string,credit:number}>, unmatched: number, unmatchedAmount: number}}
 */
function splitSessionCredit(jsonlPath, creditMap) {
  const result = { items: [], unmatched: 0, unmatchedAmount: 0 };
  const keys = Object.keys(creditMap);
  if (!keys.length) return result;
  if (!jsonlPath) {
    result.unmatched = keys.length;
    for (const key of keys) result.unmatchedAmount += Number(creditMap[key]) || 0;
    return result;
  }
  let stat;
  try { stat = fs.statSync(jsonlPath); } catch (_) { stat = null; }
  if (!stat || stat.size > MAX_JSONL_READ_BYTES) {
    result.unmatched = keys.length;
    for (const key of keys) result.unmatchedAmount += Number(creditMap[key]) || 0;
    return result;
  }
  let text;
  try { text = fs.readFileSync(jsonlPath, 'utf8'); } catch (_) { text = ''; }
  // 用一次正则替代表达全部待找 id：每行只做一次扫描，避免逐行 JSON.parse 大文件。
  const matcher = new RegExp('"(' + keys.join('|') + ')"', 'g');
  // ⚠️ 两条纪律（都踩过）：
  //   1) 必须带 /g 并收集**同一行内的全部**命中，否则同行多 id 会被误判成「明细已丢失」；
  //   2) 每个 id **全局只计一次** —— 同一个请求 id 会出现在多条记录里（父子引用），
  //      逐条累加会重复计数，实测把 5 511 积分算成 275 470。
  const counted = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    matcher.lastIndex = 0;
    const ids = [];
    let match;
    while ((match = matcher.exec(line)) !== null) ids.push(match[1]);
    if (!ids.length) continue;
    const fresh = ids.filter((id) => !counted.has(id));
    if (!fresh.length) continue;
    for (const id of fresh) counted.add(id);
    let record = null;
    try { record = JSON.parse(line); } catch (_) { record = null; }
    const day = record ? dayOf(Number(record.timestamp || record.created_at || record.createdAt)) : null;
    const model = record ? String(
      (record.message && record.message.model) ||
      record.model ||
      (record.providerData && (record.providerData.model || record.providerData.requestModelId)) ||
      ''
    ) : '';
    for (const requestId of fresh) {
      if (!day) continue;
      result.items.push({ day, model, credit: Number(creditMap[requestId]) || 0 });
    }
  }
  for (const key of keys) {
    if (counted.has(key)) continue;
    result.unmatched += 1;
    result.unmatchedAmount += Number(creditMap[key]) || 0;
  }
  return result;
}

/** 会话 id → 账号 uid（token 统计要靠它把用量归到账号上）。 */
async function readSessionOwners(query) {
  const owners = new Map();
  // ⚠️ `custom_title` 必须一起 SELECT：库里的 `title` 是客户端自动生成的一句话，
  //    `custom_title` 才是用户改过的名字（插件会话页正是「custom_title || title」优先显示）。
  //    少选这一列，下面 `row.custom_title` 永远 undefined，等于静默丢掉了用户改名的会话。
  const rows = await query('SELECT id, user_id, title, custom_title, model FROM sessions;', []);
  for (const row of rows || []) {
    owners.set(String(row.id || ''), {
      uid: String(row.user_id || ''),
      title: String(row.custom_title || row.title || ''),
      model: String(row.model || ''),
    });
  }
  return owners;
}

/** 【兜底路径】读 workbuddy.db：会话级 credit_json。 */
async function readSessionCreditJson(query) {
  const usage = await query('SELECT session_id, credit_json FROM session_usage;', []);
  const out = [];
  for (const row of usage || []) {
    const sessionId = String(row.session_id || '');
    let map = {};
    try { map = JSON.parse(row.credit_json || '{}') || {}; } catch (_) { map = {}; }
    const keys = Object.keys(map);
    if (!keys.length) continue;
    let total = 0;
    for (const key of keys) total += Number(map[key]) || 0;
    if (!total) continue;
    out.push({ sessionId, map, total });
  }
  return out;
}

const CREDIT_RECORDS_SQL = [
  'SELECT uid, usage_date, model, SUM(credit) AS credit, COUNT(*) AS requests',
  'FROM credit_usage_records WHERE profile_id = ?',
  'GROUP BY uid, usage_date, model;',
].join(' ');

/**
 * 【权威路径】读 credit-usage.db 的 credit_usage_records：逐请求积分，自带三维。
 * @returns {{items:Array<{day:string,account:string,model:string,credit:number,requests:number}>, total:number, requests:number, from:string, to:string}}
 */
async function readCreditRecords(queryCredit, profileId) {
  const rows = await queryCredit(CREDIT_RECORDS_SQL, [String(profileId || '')]);
  const result = { items: [], total: 0, requests: 0, from: '', to: '' };
  for (const row of rows || []) {
    const day = String(row.usage_date || '');
    if (!day) continue;
    const credit = Number(row.credit) || 0;
    const requests = Number(row.requests) || 0;
    result.items.push({ day, account: String(row.uid || ''), model: String(row.model || ''), credit, requests });
    result.total += credit;
    result.requests += requests;
    if (!result.from || day < result.from) result.from = day;
    if (!result.to || day > result.to) result.to = day;
  }
  return result;
}

function emptyBucket(day, account, model) {
  return { d: day, a: account, m: model, i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 };
}

/** 三键桶的键（与 buildUsageUnified 内的 keyOf 必须逐字一致）。 */
function bucketKey(day, account, model) {
  return day + '\u0000' + account + '\u0000' + model;
}

/** 「日期 × 模型」两键的键（分摊权重的粒度）。注意**不能**用 bucketKey(day,'',model) —— 那会多一个空段。 */
function dayModelKey(day, model) {
  return day + '\u0000' + model;
}

/**
 * 把 token 侧三键桶的**账号维度**换成「官方账单的逐账号请求数」分摊。
 *
 * 为什么必须换（2026-09-23 本机实测，探针留在 .wd-tmp/）：
 *  1) AutoCopy 会把**同一个会话**复制成「每个账号一份」（本机 87 个会话里 70 个属于 2~3 副本组）。
 *  2) 副本是**字节级一致**的：组内各文件 usage 行的 sha256 并集 ÷ 单文件最大值 = 1.00
 *     （19 个镜像组 / 27 788 行 / 10 649 唯一行）⇒「谁做了什么」在本地文件里已无痕迹。
 *  3) 于是 token-stats 的 distinctRecords 会把每一行都判成「原产于内嵌的那个会话 id」，
 *     而内嵌 id 永远是会话创建者那一份 ⇒ **整个会话的用量全记到会话创建者一个账号上**。
 *  实测后果：账单说 18688296454 只占 27% 的请求（163/600），token 侧却拿到 91% 的调用次数
 *  与 79% 的 token；同一模型在不同账号上的 tok/credit 相差 800 倍（2.9M vs 3.8K）。
 *  记录里也**没有**可用的逐账号信号（61 941 条 usage 行里带账号字段的 = 0）。
 *
 * 做法：认权威源 —— 官方账单的 (uid, usage_date, model) 请求数。
 * token 总量保留（去重后与副本无关、可信），按「同一天同一模型」的请求数占比分摊到各账号。
 * 某 (日, 模型) 在账单里没有记录时退回「当天整体占比」；当天也没有则**保持原归属**，
 * 并把这一块的量记进 fallback 由界面如实暴露 —— 绝不凭空编一个账号出来。
 *
 * @returns {{method:string, movedCalls:number, fallbackCalls:number, fallbackTokens:number}}
 */
function apportionTokensByBill(bucketMap, creditItems, inWindow, accountOptions) {
  const byDayModel = new Map();
  const byDayMap = new Map();
  const bump = (map, key, uid, requests) => {
    let inner = map.get(key);
    if (!inner) { inner = new Map(); map.set(key, inner); }
    inner.set(uid, (inner.get(uid) || 0) + requests);
  };
  for (const item of creditItems) {
    if (!inWindow(item.day)) continue;
    const requests = Number(item.requests) || 0;
    if (!requests || !item.account) continue;
    bump(byDayModel, dayModelKey(item.day, item.model), item.account, requests);
    bump(byDayMap, item.day, item.account, requests);
  }

  // 此刻 bucketMap 里只有 token 侧的桶（积分还没合并进来），先按 (日, 模型) 合出总量。
  const groups = new Map();
  for (const bucket of bucketMap.values()) {
    const key = bucket.d + '\u0000' + bucket.m;
    let group = groups.get(key);
    if (!group) { group = { day: bucket.d, model: bucket.m, total: { i: 0, o: 0, cr: 0, cw: 0, th: 0, calls: 0 } }; groups.set(key, group); }
    for (const field of Object.keys(group.total)) group.total[field] += Number(bucket[field]) || 0;
  }

  const result = { method: 'bill-request-weighted', movedCalls: 0, fallbackCalls: 0, fallbackTokens: 0 };
  const fields = ['i', 'o', 'cr', 'cw', 'th', 'calls'];
  for (const [key, group] of groups) {
    const weights = byDayModel.get(key) || byDayMap.get(group.day);
    if (!weights || !weights.size) {
      result.fallbackCalls += group.total.calls;
      result.fallbackTokens += group.total.i + group.total.o;
      continue;
    }
    // 先把该 (日, 模型) 的旧桶整片摘掉，再按权重重建 —— 否则会留下「旧账号一行、新账号一行」的重影。
    for (const existingKey of Array.from(bucketMap.keys())) {
      const bucket = bucketMap.get(existingKey);
      if (bucket.d === group.day && bucket.m === group.model) bucketMap.delete(existingKey);
    }
    const shares = Array.from(weights.entries()).sort((a, b) => b[1] - a[1]);
    const sum = shares.reduce((acc, entry) => acc + entry[1], 0) || 1;
    const used = {};
    shares.forEach((entry, index) => {
      const isLast = index === shares.length - 1;
      const bucket = emptyBucket(group.day, entry[0], group.model);
      for (const field of fields) {
        // 最后一档吃下取整残差，保证「分摊前后总量一致」。
        const value = isLast
          ? Math.max(0, Math.round(group.total[field]) - (used[field] || 0))
          : Math.max(0, Math.round(group.total[field] * (entry[1] / sum)));
        bucket[field] = value;
        used[field] = (used[field] || 0) + value;
      }
      bucketMap.set(bucketKey(group.day, entry[0], group.model), bucket);
    });
    result.movedCalls += group.total.calls;
  }
  // 账单里出现了、但不在 accountOptions 里的 uid 也要能显示名字（否则界面上是个裸 uid）。
  for (const inner of byDayMap.values()) {
    for (const uid of inner.keys()) {
      if (!accountOptions.some((account) => String(account && account.uid || '') === uid)) {
        accountOptions.push({ uid, nickname: '' });
      }
    }
  }
  return result;
}

/**
 * 产出统一看板的完整 payload。
 * @param {object} options
 * @param {string} options.root        WorkBuddy 数据根（<home>/.workbuddy）
 * @param {number} [options.days]      统计窗口天数（1..90）
 * @param {Function} options.query     sqlite 查询函数（daemon 注入；与 PROFILE 一致）
 * @param {Function} [options.queryCredit] 查 credit-usage.db 的函数；缺省则回退 credit_json 路径
 * @param {string} [options.profileId] credit_usage_records 的 profile_id（workbuddy-cn）
 * @param {Array}  [options.accountOptions] [{uid,nickname,phone}]
 * @param {object} [options.enrich]    第三方抽取器的补充指标（错误/思考时长/缓存命中/会话排行）
 * @param {string} [options.dataDir]   WorkDaddy 数据目录（副本血缘 meta.json 与标题快照在它下面）
 */
async function buildUsageUnified(options) {
  const root = String(options && options.root || '');
  if (!root) throw new Error('buildUsageUnified 需要 root');
  const days = Math.max(1, Math.min(DEFAULT_DAYS, Number(options.days) || DEFAULT_DAYS));
  const query = options.query;
  const accountOptions = Array.isArray(options.accountOptions) ? options.accountOptions : [];

  const warnings = [];

  // ⚠️ 顺序有讲究：**必须先读 sqlite 拿到 sessionAccounts**，token 统计才能把用量归到账号上；
  // 缺了它，账号维度会整列落到空串，表现为「所有 token 都记在一个没名字的账号上、真账号只有积分」。
  let owners = new Map();
  if (typeof query === 'function') {
    try { owners = await readSessionOwners(query); } catch (error) {
      warnings.push({ type: 'owners-read-failed', detail: '会话归属读取失败：' + (error && error.message || error) });
    }
  }
  const sessionAccounts = {};
  for (const [id, owner] of owners) {
    if (id && owner && owner.uid) sessionAccounts[id] = owner.uid;
  }

  const stats = scanTokenStatsCached(root, { days, accountOptions, sessionAccounts });
  const nicknameOf = new Map();
  for (const account of accountOptions) {
    const uid = String(account && account.uid || '');
    if (uid) nicknameOf.set(uid, String(account.nickname || ''));
  }

  // 三键桶：以 token-stats 为准（它已处理副本去重与已删会话归属）
  const bucketMap = new Map();
  const keyOf = (day, account, model) => day + '\u0000' + account + '\u0000' + model;
  for (const row of stats.dailyBreakdown || []) {
    const key = keyOf(row.day, row.account, row.model);
    const bucket = bucketMap.get(key) || emptyBucket(row.day, row.account, row.model);
    bucket.i += Number(row.input) || 0;
    bucket.o += Number(row.output) || 0;
    bucket.cr += Number(row.cacheRead) || 0;
    bucket.cw += Number(row.cacheWrite) || 0;
    bucket.th += Number(row.thinking) || 0;
    bucket.calls += Number(row.calls) || 0;
    bucketMap.set(key, bucket);
  }

  const sinceDay = stats.since ? dayOf(stats.since) : '';
  const inWindow = (day) => !sinceDay || day >= sinceDay;

  // ---- 积分：优先权威路径（credit-usage.db），其次兜底（credit_json + jsonl）----
  let creditMeta = {
    source: 'none',
    label: '无可用积分数据',
    coveredFrom: '',
    coveredTo: '',
    rows: 0,
    requests: 0,
    total: 0,
    unmatchedRequests: 0,
    unmatchedAmount: 0,
  };
  let creditFromRecords = null;
  if (typeof options.queryCredit === 'function') {
    try {
      creditFromRecords = await readCreditRecords(options.queryCredit, options.profileId);
    } catch (error) {
      warnings.push({ type: 'credit-records-read-failed', detail: '积分记录读取失败，已回退旧路径：' + (error && error.message || error) });
    }
  }
  // ---- 账号维度：token 侧改由官方账单的逐账号请求数分摊（见 apportionTokensByBill 的注释）----
  // 必须在「把 credit 合并进桶」之前做：分摊后桶的键就是账单的 (uid, day, model)，
  // credit 直接落到同一个桶上，不会再出现「token 记 A、积分记 B」的重影。
  let accountAttribution = { method: 'token-stats-file-path', movedCalls: 0, fallbackCalls: 0, fallbackTokens: 0 };
  if (creditFromRecords && creditFromRecords.items.length) {
    accountAttribution = apportionTokensByBill(bucketMap, creditFromRecords.items, inWindow, accountOptions);
  }

  if (creditFromRecords && creditFromRecords.items.length) {
    let total = 0;
    let coveredFrom = '';
    let coveredTo = '';
    let countedRows = 0;
    let countedRequests = 0;
    for (const item of creditFromRecords.items) {
      if (!inWindow(item.day)) continue;
      const key = keyOf(item.day, item.account, item.model);
      const bucket = bucketMap.get(key) || emptyBucket(item.day, item.account, item.model);
      bucket.credit += item.credit;
      bucketMap.set(key, bucket);
      total += item.credit;
      countedRows += 1;
      countedRequests += Number(item.requests) || 0;
      // 覆盖区间只认**真正进了看板**的那些天。库里若还留着 90 天窗外的老记录，
      // 拿全表的 MIN/MAX 当覆盖起点，界面那句「明细自 X 起」就成了假的。
      if (!coveredFrom || item.day < coveredFrom) coveredFrom = item.day;
      if (!coveredTo || item.day > coveredTo) coveredTo = item.day;
    }
    creditMeta = {
      source: 'usage-records',
      label: '来自本机同步的官方逐请求用量记录（credit-usage.db）',
      coveredFrom,
      coveredTo,
      rows: countedRows,
      requests: countedRequests,
      total: round2(total),
      unmatchedRequests: 0,
      unmatchedAmount: 0,
    };
  } else if (typeof query === 'function') {
    // 兜底：会话级 credit_json → jsonl 反查日期/模型（会有相当比例拆不动，如实计入 unmatched）
    let sessions = [];
    try { sessions = await readSessionCreditJson(query); } catch (error) {
      warnings.push({ type: 'credit-read-failed', detail: '积分读取失败：' + (error && error.message || error) });
    }
    let attributed = 0;
    let unmatchedAmount = 0;
    let unmatchedRequests = 0;
    let from = '';
    let to = '';
    let requests = 0;
    for (const entry of sessions) {
      const owner = owners.get(entry.sessionId) || { uid: '' };
      const split = splitSessionCredit(locateSessionJsonl(root, entry.sessionId), entry.map);
      requests += Object.keys(entry.map).length;
      for (const item of split.items) {
        if (!inWindow(item.day)) continue;
        const key = keyOf(item.day, owner.uid, item.model);
        const bucket = bucketMap.get(key) || emptyBucket(item.day, owner.uid, item.model);
        bucket.credit += item.credit;
        bucketMap.set(key, bucket);
        attributed += item.credit;
        if (!from || item.day < from) from = item.day;
        if (!to || item.day > to) to = item.day;
      }
      unmatchedAmount += split.unmatchedAmount;
      unmatchedRequests += split.unmatched;
    }
    if (sessions.length) {
      creditMeta = {
        source: 'credit-jsonl',
        label: '兜底口径：workbuddy.db 的会话级 credit_json + jsonl 反查（未找到 credit-usage.db）',
        coveredFrom: from,
        coveredTo: to,
        rows: sessions.length,
        requests,
        total: round2(attributed),
        unmatchedRequests,
        unmatchedAmount: round2(unmatchedAmount),
      };
    }
  }
  if (creditMeta.unmatchedRequests > 0) {
    warnings.push({
      type: 'orphan-credit',
      count: creditMeta.unmatchedRequests,
      amount: creditMeta.unmatchedAmount,
        detail: '另有 ' + creditMeta.unmatchedRequests + ' 笔积分（合计 ' + creditMeta.unmatchedAmount +
        '）对应的会话明细已不在本地，无法拆到日期/模型，未计入趋势图。',
    });
  }
  // 账号维度的口径必须写清楚：token/次数是**分摊值**（本地文件无法逐条判定账号），
  // 积分是账单原值。以前不说，用户看到「一个账号吃掉 91% 的 token」只会以为算错了。
  if (accountAttribution.method === 'bill-request-weighted') {
    const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString('en-US');
    warnings.push({
      type: 'account-attribution-bill-weighted',
      detail: '账号维度的「token / 次数」按官方账单**逐账号请求数分摊**得出（共分摊 ' + fmtInt(accountAttribution.movedCalls) +
        ' 次调用）：AutoCopy 会把同一会话复制给每个账号、且副本字节一致，本地文件无法逐条判定账号，' +
        '直接按文件路径归属会把整块用量压到会话创建者一个账号上。积分列为账单原值，未分摊。',
    });
    if (accountAttribution.fallbackCalls > 0) {
      warnings.push({
        type: 'account-attribution-fallback',
        count: accountAttribution.fallbackCalls,
        detail: '有 ' + fmtInt(accountAttribution.fallbackCalls) + ' 次调用（' + fmtInt(accountAttribution.fallbackTokens) +
          ' token）所在的「日期 × 模型」没有官方账单记录，无法按账单分摊，仍沿用本地文件归属 —— ' +
          '这部分可能整块落在会话创建者账号上。',
      });
    }
  }

  const buckets = Array.from(bucketMap.values()).sort((a, b) =>
    a.d.localeCompare(b.d) || a.a.localeCompare(b.a) || a.m.localeCompare(b.m));

  const totals = { i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 };
  const perAccount = new Map();
  const perModel = new Map();
  for (const bucket of buckets) {
    totals.i += bucket.i; totals.o += bucket.o; totals.cr += bucket.cr;
    totals.cw += bucket.cw; totals.th += bucket.th; totals.credit += bucket.credit; totals.calls += bucket.calls;
    const account = perAccount.get(bucket.a) || { uid: bucket.a, name: nicknameOf.get(bucket.a) || '', i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 };
    account.i += bucket.i; account.o += bucket.o; account.cr += bucket.cr; account.cw += bucket.cw;
    account.th += bucket.th; account.credit += bucket.credit; account.calls += bucket.calls;
    perAccount.set(bucket.a, account);
    const model = perModel.get(bucket.m) || { m: bucket.m, i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 };
    model.i += bucket.i; model.o += bucket.o; model.cr += bucket.cr; model.cw += bucket.cw;
    model.th += bucket.th; model.credit += bucket.credit; model.calls += bucket.calls;
    perModel.set(bucket.m, model);
  }
  totals.credit = round2(totals.credit);

  // 说明：这里刻意**不预计算**「积分/百万 token」这类派生指标 ——
  // 分母口径（是否含缓存读取）换个说法结论就变，放在界面层算、并把口径写在标签上，
  // 避免 JSON 里出现一个没人知道怎么来的 cost 字段。

  const daysList = Array.from(new Set(buckets.map((bucket) => bucket.d))).sort();

  // 融合位：第三方抽取器（错误/思考时长/缓存命中/会话排行/峰值日）。
  // 它是**全窗口口径、不含账号维度**，所以只作为补充板块展示，绝不混进三维筛选的数值。
  const enrich = normalizeEnrich(options && options.enrich);
  // 会话排行的标题：第三方给的是官方 trace 里的**原始会话 id**，库里存的却是**各账号副本 id**，
  // 两边对不上就会显示成「未命名会话」。这里用多源解析接回来（见 session-titles.js）。
  const titleStats = fillSessionTitles(enrich, {
    root,
    dataDir: options && options.dataDir,
    dbTitles: owners,
  });
  if (titleStats.unresolved) {
    warnings.push({
      type: 'session-title-missing',
      count: titleStats.unresolved,
      detail: '有 ' + titleStats.unresolved + ' 个会话的标题在本机所有索引（会话库 / 副本血缘 / 会话正文 / SDK 日志）'
        + '里都查不到，排行里以占位显示 —— 会话被官方清理且没留下任何正文时无法还原，不编造名字。',
    });
  }

  return {
    meta: {
      schema: 1,
      generatedAt: Date.now(),
      days,
      since: stats.since,
      until: stats.until,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      files: stats.files,
      parsedLines: stats.parsedLines,
      parseErrors: stats.parseErrors,
      cached: !!stats.cached,
      cacheVersion: 9,
      credit: creditMeta,
      // 账号维度怎么来的：bill-request-weighted = 按官方账单逐账号请求数分摊（推荐/默认）；
      // token-stats-file-path = 没有可用账单时的兜底（直接沿用本地文件路径归属）。
      accountAttribution: {
        method: accountAttribution.method,
        movedCalls: Math.round(accountAttribution.movedCalls),
        fallbackCalls: Math.round(accountAttribution.fallbackCalls),
        fallbackTokens: Math.round(accountAttribution.fallbackTokens),
      },
      coverage: {
        thinkingAvailable: totals.th > 0,
      },
      accountOptions: accountOptions.map((account) => ({
        uid: String(account && account.uid || ''),
        nickname: String(account && account.nickname || ''),
      })).filter((account) => account.uid),
    },
    totals,
    accounts: Array.from(perAccount.values()).sort((a, b) => (b.i + b.o) - (a.i + a.o)),
    models: Array.from(perModel.values()).sort((a, b) => (b.i + b.o) - (a.i + a.o)),
    days: daysList,
    buckets,
    warnings,
    enrich,
  };
}

/** 第三方 usage-status.json → 裁剪后的补充指标（缺项一律给 null，界面按「无数据」显示，不编造）。 */
function normalizeEnrich(raw) {
  if (!raw || typeof raw !== 'object') return { available: false };
  const summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const str = (value) => (value === undefined || value === null ? '' : String(value));
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    available: true,
    generatedAt: num(summary.generated_at),
    // ⚠️ 刻意不带第三方口径的积分：它的 total_credit 只有本机实测的零头（口径不同且明显滞后），
    // 混进来只会让「积分」这个数出现两个互相打架的版本。
    totalRequests: num(summary.total_requests),
    totalSessions: num(summary.total_sessions),
    totalErrors: num(summary.total_errors),
    topErrorMsg: str(summary.top_error_msg),
    totalThinkingHours: num(summary.total_thinking_hours),
    avgThinkingSecPerRequest: num(summary.avg_thinking_sec_per_request),
    avgEfficiencyTokPerSec: num(summary.avg_efficiency_tok_per_sec),
    cacheRate: num(summary.cache_rate),
    cacheCaliber: str(summary.cache_caliber),
    dateMin: str(summary.date_min),
    dateMax: str(summary.date_max),
    cacheModel: list(raw.cache_model).slice(0, 12).map((row) => ({
      model: str(row && row.model), cached: num(row && row.cached), input: num(row && row.input),
      calls: num(row && row.calls), rate: num(row && row.rate),
    })),
    errorByModel: list(raw.error_detail && raw.error_detail.by_model).slice(0, 12).map((row) => ({
      model: str(row && row.model), errors: num(row && row.errors), requests: num(row && row.requests),
    })),
    topErrors: list(raw.error_detail && raw.error_detail.top_messages).slice(0, 8).map((row) => ({
      message: str(row && (row.msg || row.message)), count: num(row && row.count), pct: num(row && row.pct),
    })),
    spikeDays: list(raw.spike_days).slice(0, 8).map((row) => ({
      date: str(row && row.date), tokens: num(row && row.tokens), credit: num(row && row.credit),
      requests: num(row && row.requests), errRate: num(row && row.err_rate), maxRequestTokens: num(row && row.max_request_tokens),
    })),
    topSessions: list(raw.by_session).slice()
      .sort((a, b) => (Number(b && b.tokens) || 0) - (Number(a && a.tokens) || 0))
      .slice(0, 15)
      .map((row) => ({
        sessionId: str(row && row.session_id), title: str(row && row.title), model: str(row && row.model),
        models: str(row && row.models), requests: num(row && row.requests), tokens: num(row && row.tokens),
        credit: num(row && row.credit), errors: num(row && row.errors), firstDate: str(row && row.first_date),
      })),
    warnings: list(raw.warnings).map((row) => ({ type: str(row && row.type), count: num(row && row.count), amount: num(row && row.amount), detail: str(row && row.detail) })),
  };
}

/**
 * 补齐「会话排行」的标题。
 *
 * 问题：第三方抽取器的会话 id 取自官方 trace 的 `sessionId`（= 会话**原始 id**），
 *      而 `workbuddy.db` 里存的是切号自动复制出来的**各账号副本 id**；两边对不上时
 *      旧实现直接显示成「未命名会话」，看上去像乱码。
 * 做法：用 session-titles.js 的多源解析把它们接回来，并把命中的**真标题**写进快照，
 *      这样官方日后清理会话行，名字也不会再永久丢失。
 * 纪律：解析不出来的**不编造**，交给界面显示占位，并回报 unresolved 让界面写明原因。
 *
 * @returns {{total:number, resolved:number, unresolved:number}}
 */
function fillSessionTitles(enrich, options) {
  const rows = Array.isArray(enrich && enrich.topSessions) ? enrich.topSessions : [];
  const stats = { total: rows.length, inherited: 0, resolved: 0, unresolved: 0 };
  if (!rows.length) return stats;
  let resolver = null;
  try { resolver = createSessionTitleResolver(options); } catch (_) { resolver = null; }
  if (!resolver) return stats;
  const keep = new Map();
  for (const row of rows) {
    if (!row) continue;
    const sid = String(row.sessionId || '').trim();
    const existing = String(row.title || '').trim();
    if (existing) {
      // 第三方已经给了名字（它读的就是 workbuddy.db 的 sessions 表，口径 custom_title || title）
      // ——照样抄进快照，别等丢了才想起来；来源标 db 让悬停提示不留空白。
      // ⚠️ 官方自动标题本身就是「首条提问截断」，可能夹带凭据 / 手机号 ⇒ 这条路径**也要脱敏**，
      //    否则只有派生标题脱敏、官方标题漏网，等于白做（实测确有一条库标题含手机号）。
      const safe = sanitizeTitle(existing);
      row.title = safe;
      row.titleSource = row.titleSource || 'db';
      stats.inherited += 1;
      if (sid && safe) keep.set(sid, safe);
      continue;
    }
    if (!sid) { row.title = ''; stats.unresolved += 1; continue; }
    let hit = { title: '', source: 'none' };
    try { hit = resolver.resolve(sid); } catch (_) { hit = { title: '', source: 'none' }; }
    if (!hit.title) { row.title = ''; stats.unresolved += 1; continue; }
    row.title = hit.title;
    row.titleSource = hit.source;
    stats.resolved += 1;
    // 只把「真标题」写进快照；由首条提问派生的不写 —— 否则下次会被当成权威值当真。
    if (hit.source !== 'first-prompt') keep.set(sid, hit.title);
  }
  if (keep.size) {
    try { mergeTitleSnapshot(resolver.dataDir || options.dataDir, keep); } catch (_) { /* 快照写不动不影响本次输出 */ }
  }
  return stats;
}

/** 把 payload 写成 JSON（原子写：tmp + rename）。 */
function writeUsageUnified(outFile, payload) {
  const tmp = outFile + '.tmp';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, outFile);
  return outFile;
}

/** 读第三方 usage-status.json（缺失/损坏一律返回 null，不抛）。 */
function readEnrichFile(file) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

module.exports = {
  buildUsageUnified,
  writeUsageUnified,
  locateSessionJsonl,
  splitSessionCredit,
  readSessionOwners,
  readSessionCreditJson,
  readCreditRecords,
  normalizeEnrich,
  fillSessionTitles,
  readEnrichFile,
  CREDIT_RECORDS_SQL,
};

// ---------------- CLI（node --experimental-sqlite usage-unified.js --out <file>） ----------------
async function main() {
  const os = require('os');
  const args = process.argv.slice(2);
  const argOf = (name, fallback) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : fallback);
  const home = os.homedir();
  const root = argOf('--root', '') || process.env.WORKDADDY_DATA_ROOT || path.join(home, '.workbuddy');
  const outFile = argOf('--out', path.join(process.cwd(), 'usage-unified.json'));
  const days = Number(argOf('--days', DEFAULT_DAYS));
  const profileId = argOf('--profile', 'workbuddy-cn');
  const creditDb = argOf('--credit-db', path.join(process.env.APPDATA || '', 'WorkDaddy', 'credit-usage.db'));
  const enrichPath = argOf('--enrich', path.join(process.env.APPDATA || '', 'WorkDaddy', 'usage-board', 'usage-status.json'));

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (error) {
    throw new Error('需要以 --experimental-sqlite 运行（node --experimental-sqlite usage-unified.js）');
  }
  const open = (file) => new DatabaseSync('file:' + file + '?mode=ro', { readOnly: true });
  const db = open(path.join(root, 'workbuddy.db'));
  const query = async (sql, params = []) => db.prepare(sql).all(...params);
  let queryCredit = null;
  try {
    const cdb = open(creditDb);
    queryCredit = async (sql, params = []) => cdb.prepare(sql).all(...params);
  } catch (_) { /* 没有 credit-usage.db 就走兜底 */ }

  const started = Date.now();
  const payload = await buildUsageUnified({
    root, days, query, queryCredit, profileId, enrich: readEnrichFile(enrichPath),
  });
  writeUsageUnified(outFile, payload);
  console.log('ok ' + outFile + ' buckets=' + payload.buckets.length +
    ' accounts=' + payload.accounts.length + ' models=' + payload.models.length +
    ' days=' + payload.days.length +
    ' credit=' + payload.totals.credit + '(' + payload.meta.credit.source + ')' +
    ' enrich=' + (payload.enrich && payload.enrich.available ? 'yes' : 'no') +
    ' elapsedMs=' + (Date.now() - started));
}

if (require.main === module) {
  main().catch((error) => { console.error('失败: ' + (error && error.stack || error)); process.exit(1); });
}
