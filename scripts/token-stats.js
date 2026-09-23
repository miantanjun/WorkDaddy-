'use strict';

/**
 * Token 用量三维统计（日期 × 账号 × 模型）。
 *
 * ⚠️ T23（2026-09-23）起本文件遵守 `stats-discipline.js` 的五条工程纪律：
 *  1. **数字错比报错糟糕** —— 时间戳拿不到**就留空**（不再回落成 `now`），并计入 `undated`
 *     台账显式暴露。旧实现把「无时间戳的导入行」记到扫描当天，等于把历史搬到今天，
 *     而用户不会去核对数字。实测本机 60 397 条 usage 行的时间戳覆盖率 = 100%，
 *     所以这次收紧对真实数字**零位移**，纯粹是把「万一」变成「报出来」。
 *  2. 只读打开（本文件只 `readFileSync`，不做任何写入）。
 *  3. 只读头部/尾部 —— 见 `thinking-stats.js`（trace 元信息在 span 之前，读头即可判窗口）。
 *  4. **参数组合做不到就报错** —— `days` 与 `from` 同时给、只给 `until` 不给 `from`，
 *     一律抛 `bad-param`，不再「静默挑一个用」。
 *  5. 命中率口径走 `stats-discipline.cacheHitRate`（`cached/input`，越界自动换分母）。
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');
const discipline = require('./stats-discipline.js');

const TOKEN_FIELDS = {
  input: ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'],
  output: ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'],
  cacheRead: ['cache_read_input_tokens', 'cache_read_tokens', 'cacheReadTokens', 'cached_tokens'],
  cacheWrite: ['cache_creation_input_tokens', 'cache_write_tokens', 'cacheWriteTokens'],
};

// 思维链 token。实测（2026-09-23，本机 88 个 jsonl / 52858 条 usage 行）：
// `completion_thinking_tokens` 每条 usage 行都有且**只出现一次**；
// 而 `reasoning_tokens` 会在同一条记录里重复出现 3 次（会算成 3 倍）⇒ 只用前者。
const THINKING_FIELDS = ['completion_thinking_tokens', 'completionThinkingTokens'];

function numberField(value, fields) {
  for (const field of fields) {
    const number = Number(value && value[field]);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function findUsage(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const hasUsage = Object.values(TOKEN_FIELDS).some((fields) => fields.some((field) => value[field] !== undefined));
  if (hasUsage) return value;
  for (const child of Object.values(value)) {
    const found = findUsage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function findText(value, fields, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return '';
  for (const field of fields) {
    if (typeof value[field] === 'string' && value[field].trim()) return value[field].trim();
  }
  for (const child of Object.values(value)) {
    const found = findText(child, fields, depth + 1);
    if (found) return found;
  }
  return '';
}

function walkJsonl(root, maxFiles = 5000) {
  const out = [];
  function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.name === 'subagents' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    }
  }
  // Official session files live under projects; logs contain duplicate usage snapshots.
  const projects = path.join(root, 'projects');
  walk(fs.existsSync(projects) ? projects : root);
  return out;
}

function dayString(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function localDayString(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const CACHE_VERSION = 10; // 10: item 增加 undated 台账（纪律 1）；9: entries 增加 thinking / requestId
const MAX_CACHE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateBounds(now, options = {}) {
  // 纪律 4：参数组合做不到就报错。
  // 旧实现在「给了 days 又给了 from」时静默用 from、「只给 until 不给 from」时静默忽略 until
  // —— 两种都是「看起来对、其实答非所问」，而调用方无法察觉。
  const hasFrom = options.from !== undefined && options.from !== null && options.from !== '';
  const hasUntil = options.until !== undefined && options.until !== null && options.until !== '';
  const hasDays = options.days !== undefined && options.days !== null && options.days !== '';
  discipline.rejectUnsupported(!(hasFrom && hasDays), 'bad-param',
    'from 与 days 不能同时给：区间要么用 days 反推，要么用 from/until 显式指定', { from: options.from, days: options.days });
  discipline.rejectUnsupported(!(hasUntil && !hasFrom), 'bad-param',
    'until 必须与 from 成对出现（只给 until 无法确定窗口起点）', { until: options.until });
  if (hasDays) discipline.requireIntRange(options.days, 1, MAX_CACHE_DAYS, 'days');
  const days = hasDays ? Number(options.days) : 7;
  const localStart = new Date(now); localStart.setHours(0, 0, 0, 0);
  localStart.setDate(localStart.getDate() - (days - 1));
  const defaultSince = localStart.getTime();
  const parsedFrom = hasFrom ? Date.parse(options.from) : NaN;
  const parsedUntil = hasUntil ? Date.parse(options.until) + DAY_MS - 1 : now;
  if (hasFrom && !Number.isFinite(parsedFrom)) throw discipline.statsError('bad-param', '开始日期无效', { from: options.from });
  if (hasUntil && !Number.isFinite(parsedUntil)) throw discipline.statsError('bad-param', '结束日期无效', { until: options.until });
  const from = Number.isFinite(parsedFrom) ? parsedFrom : defaultSince;
  const until = Number.isFinite(parsedUntil) ? Math.min(parsedUntil, now) : now;
  if (from > until) throw discipline.statsError('bad-param', '开始日期不能晚于结束日期');
  if (until - from > MAX_CACHE_DAYS * DAY_MS) throw discipline.statsError('bad-param', '日期范围不能超过 90 天');
  return { from, until, days };
}

function parseRecords(root, options = {}) {
  const now = Number(options.now) || Date.now();
  const lowerBound = Number.isFinite(options.lowerBound) ? options.lowerBound : now - MAX_CACHE_DAYS * DAY_MS;
  const upperBound = Number.isFinite(options.upperBound) ? options.upperBound : now + 60 * 1000;
  const files = Array.isArray(options.files) ? options.files : walkJsonl(root, options.maxFiles || 5000);
  const records = [];
  let parseErrors = 0;
  let parsedLines = 0;
  const parseErrorFiles = new Set();
  // 纪律 1：无时间戳的记录**不猜**。这里只计数留痕，不把它们混进任何日期/账号/模型维度。
  const undated = discipline.makeUndatedLedger();
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (options.skipUnchanged && options.knownFileState && options.knownFileState[relative]) {
      try {
        const stat = fs.statSync(file);
        const known = options.knownFileState[relative];
        if (Number(known.mtimeMs) === Number(stat.mtimeMs) && Number(known.size) === Number(stat.size)) continue;
      } catch (_) { continue; }
    }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const occurrences = new Map();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch (_) {
        // Only object-like lines are likely structured records. WorkBuddy may
        // place plain text, stack traces, or array annotations in the same file.
        if (options.legacyParseErrors ? /^\s*[\[{]/.test(line) :
          /^\s*\{/.test(line) && /"(?:usage|input_tokens|output_tokens|model)"/i.test(line)) {
          parseErrors++;
          parseErrorFiles.add(relative);
        }
        continue;
      }
      if (!record || typeof record !== 'object' || record.isSnapshotUpdate) continue;
      const usage = findUsage(record.message && record.message.usage) || findUsage(record.providerData && record.providerData.usage) || findUsage(record);
      if (!usage) continue;
      const input = numberField(usage, TOKEN_FIELDS.input);
      const output = numberField(usage, TOKEN_FIELDS.output);
      const cacheRead = numberField(usage, TOKEN_FIELDS.cacheRead);
      const cacheWrite = numberField(usage, TOKEN_FIELDS.cacheWrite);
      if (!(input || output || cacheRead || cacheWrite)) continue;
      // 纪律 1：时间戳拿不到就**留空**，绝不回落成 `now`。
      // 旧实现回落成扫描时刻 ⇒ 导入的历史行会在时间轴上跳到今天，
      // 而且总量仍然对得上（少的那块补到了今天），没人能看出来。
      // 现在：这类记录不进任何日期维度，但进 `undated` 台账并被显式暴露。
      const timestamp = discipline.firstTimestamp([record.timestamp, record.created_at, record.createdAt, usage.timestamp]);
      if (timestamp === discipline.UNKNOWN_TIMESTAMP) {
        undated.add({ input, output, calls: 1 });
        continue;
      }
      if (timestamp < lowerBound || timestamp > upperBound) continue;
      // 思维链 token：优先 usage，其次 providerData.rawUsage（WorkBuddy 多数落在这里）
      const thinking = numberField(usage, THINKING_FIELDS) ||
        numberField(record.providerData && record.providerData.rawUsage, THINKING_FIELDS);
      // 记录 id：32 位 hex，是 workbuddy.db `session_usage.credit_json` 的键（实测 54/54 命中）。
      const recordId = typeof record.id === 'string' && /^[0-9a-f]{32}$/i.test(record.id) ? record.id : '';
      const model = findText(record, ['model', 'modelName', 'model_id', 'modelId']) || findText(usage, ['model', 'modelName', 'model_id', 'modelId']);
      const account = findText(record, ['accountUid', 'accountId', 'uid', 'userId']) || findText(usage, ['accountUid', 'accountId', 'uid', 'userId']);
      // Imports/copies preserve the entire JSONL row. Hash the whole record,
      // not just requestId or token totals: a request can have multiple usage
      // rows, and different calls can have identical token counts. Only the
      // digest and usage metadata enter the cache; never persist message text.
      const digest = createHash('sha256').update(JSON.stringify(record)).digest('hex');
      const occurrence = (occurrences.get(digest) || 0) + 1;
      occurrences.set(digest, occurrence);
      records.push({
        key: digest + ':' + occurrence,
        file: relative,
        sourceSession: (['sessionId', 'conversationId', 'session_id', 'conversation_id']
          .map(field => record[field]).find(value => typeof value === 'string' && value.trim()) || '').trim(),
        timestamp,
        model: model || '',
        account: account || '',
        input,
        output,
        cacheRead,
        cacheWrite,
        thinking,
        recordId,
        calls: 1,
      });
      parsedLines++;
    }
  }
  return {
    records, files: files.length, parsedLines, parseErrors,
    parseErrorFiles: Array.from(parseErrorFiles),
    undated: { count: undated.count, tokens: undated.tokens, calls: undated.calls },
  };
}

function sessionAccount(options, id) {
  const accounts = options.sessionAccounts;
  return String((accounts instanceof Map ? accounts.get(id) : accounts && accounts[id]) || '').trim();
}

function fileSessionId(file) {
  return path.posix.basename(String(file || ''), '.jsonl');
}

function distinctRecords(records, options = {}) {
  const accountIds = new Set((options.accountOptions || [])
    .map(item => String(item && (item.uid || item.account) || '').trim()).filter(Boolean));
  const distinct = new Map();
  for (const record of records) {
    let item = distinct.get(record.key);
    if (!item) {
      item = { record, files: new Set(), copies: [] };
      distinct.set(record.key, item);
    }
    // Undated legacy rows use scan time as a fallback. Prefer the earliest
    // cached observation so importing them later does not move usage to today.
    if (record.timestamp < item.record.timestamp) item.record = record;
    item.files.add(fileSessionId(record.file));
    item.copies.push(record);
  }
  // Occurrence indices preserve multiple equal rows in one original file;
  // matching occurrences in other files are copies, not extra model calls.
  return Array.from(distinct.values(), ({ record, files, copies }) => {
    const owners = new Set();
    for (const copy of copies) {
      // Resolve owners on every scan, including cache hits.
      // 归属按「物理文件」判定，而不是盲信记录里内嵌的 sessionId：
      // 切号自动复制（autoCopy）是把 projects/<pj>/<源会话>.jsonl 整份 cp 成
      // <目标会话>.jsonl，目标会话此后继续往副本里追加，但追加出来的新行内嵌的
      // sessionId 仍然是「源会话」——于是内嵌字段既可能是导入来源，也可能是这
      // 个文件自己新产生的。可靠的判据只有一条：内嵌的源会话是不是也持有一条
      // 同样内容的记录（digest 相同）。持有 → 这行原产于源会话（导入副本）；
      // 不持有 → 源会话文件里没有这行，说明它是在本文件里新生成的。
      const fileSession = fileSessionId(copy.file);
      const embedded = copy.sourceSession;
      const origin = embedded && embedded !== fileSession && files.has(embedded) ? embedded : fileSession;
      let account = copy.account;
      if (!account) account = sessionAccount(options, origin);
      // 兜底：会话表里查不到（已删除/未登记）时，允许路径段直接命中账号 uid。
      if (!account) account = copy.file.split('/').map(part => part.replace(/\.jsonl$/i, ''))
        .find(part => accountIds.has(part)) || '';
      if (account) owners.add(account);
    }
    // 多份副本给出不同账号，才是真正的歧义；此时宁可不归属，也不要凭空记给一方。
    return { ...record, account: owners.size === 1 ? owners.values().next().value : '' };
  });
}

function cacheFile(root, options = {}) {
  return options.cacheFile || path.join(root, '.workdaddy-token-stats-cache.json');
}

function readCache(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.version !== CACHE_VERSION || !Array.isArray(value.historicalBuckets) || !value.todayFiles || typeof value.todayFiles !== 'object') return null;
    if (Object.values(value.todayFiles).some(item => !item || !Array.isArray(item.entries))) return null;
    return value;
  } catch (_) { return null; }
}

function usableCache(cache, now) {
  return !!cache && Number.isFinite(cache.generatedAt) && cache.generatedAt <= now &&
    Number.isFinite(cache.cutoff) && cache.cutoff <= dateBounds(now, { days: MAX_CACHE_DAYS }).from &&
    cache.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function tokenStatsCacheReady(root, options = {}) {
  return usableCache(readCache(cacheFile(root, options)), Number(options.now) || Date.now());
}

function writeCache(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (_) { return false; /* cache failure must not break statistics */ }
}

/** 纪律 5：给一行聚合结果补上命中率（口径见 stats-discipline.cacheHitRate，越界自动换分母） */
function withHitRate(row) {
  if (!row) return row;
  const detail = discipline.cacheHitRateDetail(row.cacheRead, row.input);
  row.cacheHitRate = detail.rate;
  row.cacheHitDenominator = detail.denominator;
  row.cacheHitGuarded = detail.guarded;
  return row;
}

/** 调用点表（thinking-stats 用它按时间窗把 trace span 对齐到模型） */
function buildCallPoints(records, limit = 200000) {
  const seen = new Set();
  const points = [];
  let truncated = false;
  for (const record of records || []) {
    if (!record || !record.timestamp || !record.model) continue;
    // 同一个物理调用会在「副本文件」里重复出现 ⇒ 按 (时间, 模型, 输入, 输出) 去重，
    // 否则一次调用会变成多个候选点，把「唯一命中」判成「歧义」。
    const key = record.timestamp + '\u0000' + record.model + '\u0000' + record.input + '\u0000' + record.output;
    if (seen.has(key)) continue;
    seen.add(key);
    if (points.length >= limit) { truncated = true; break; }
    points.push({ t: record.timestamp, model: record.model });
  }
  points.sort((a, b) => a.t - b.t);
  return { points, truncated };
}

function aggregateRecords(records, options = {}) {
  const now = Number(options.now) || Date.now();
  const bounds = dateBounds(now, options);
  const accountFilter = String(options.account || '').trim();
  const modelFilter = String(options.model || '').trim();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  const byDay = new Map();
  const byModel = new Map();
  const byAccount = new Map();
  for (const record of records) {
    if (!record || record.timestamp < bounds.from || record.timestamp > bounds.until) continue;
    if (accountFilter && record.account !== accountFilter) continue;
    if (modelFilter && record.model !== modelFilter) continue;
    const values = { input: Number(record.input) || 0, output: Number(record.output) || 0, cacheRead: Number(record.cacheRead) || 0, cacheWrite: Number(record.cacheWrite) || 0, calls: Number(record.calls) || 1 };
    for (const key of Object.keys(totals)) totals[key] += values[key];
    const day = localDayString(record.timestamp);
    if (day) {
      const row = byDay.get(day) || { day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
      for (const key of Object.keys(values)) row[key] += values[key];
      byDay.set(day, row);
    }
    if (record.model) {
      const row = byModel.get(record.model) || { model: record.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
      for (const key of Object.keys(values)) row[key] += values[key];
      byModel.set(record.model, row);
    }
    if (record.account) {
      const row = byAccount.get(record.account) || { account: record.account, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
      for (const key of Object.keys(values)) row[key] += values[key];
      byAccount.set(record.account, row);
    }
  }
  const accountOptions = Array.isArray(options.accountOptions) ? options.accountOptions : [];
  for (const account of accountOptions) {
    const uid = String(account && (account.uid || account.account) || '').trim();
    if (!uid) continue;
    if (!byAccount.has(uid)) byAccount.set(uid, { account: uid, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, nickname: account.nickname || '' });
    else if (account.nickname) byAccount.get(uid).nickname = account.nickname;
  }
  // 纪律 1 留痕：无时间戳的记录**必须暴露**（`aggregateCachedBuckets` 同款）。
  // 2026-09-23 修：此前只有缓存路径带 undated/warnings，非缓存路径（scanTokenStats，
  // CLI 与测试都用它）静默丢掉台账 —— 「留空但不说」等于用户永远看不到少了一块。
  const undated = options.undated || { count: 0, tokens: 0, calls: 0 };
  const warnings = [];
  if (undated.count > 0) {
    warnings.push(`有 ${undated.count} 条 usage 记录没有可用时间戳（${undated.tokens} token / ${undated.calls} 次调用）——`
      + '已按纪律留空、不计入任何日期维度（不猜测归到扫描当天）');
  }
  return {
    source: 'local-workbuddy-jsonl',
    since: bounds.from,
    until: bounds.until,
    totals: withHitRate(totals),
    daily: Array.from(byDay.values(), withHitRate).sort((a, b) => a.day.localeCompare(b.day)),
    models: Array.from(byModel.values(), withHitRate).sort((a, b) => (b.input + b.output) - (a.input + a.output)),
    accounts: Array.from(byAccount.values(), withHitRate).sort((a, b) => (b.input + b.output) - (a.input + a.output)),
    undated,
    warnings,
  };
}

function aggregateBuckets(records) {
  const buckets = new Map();
  for (const record of records || []) {
    const day = localDayString(record.timestamp);
    if (!day) continue;
    const account = String(record.account || '');
    const model = String(record.model || '');
    const key = day + '\u0000' + account + '\u0000' + model;
    const bucket = buckets.get(key) || { day, account, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0 };
    bucket.input += Number(record.input) || 0;
    bucket.output += Number(record.output) || 0;
    bucket.cacheRead += Number(record.cacheRead) || 0;
    bucket.cacheWrite += Number(record.cacheWrite) || 0;
    bucket.thinking += Number(record.thinking) || 0;
    bucket.calls += Number(record.calls) || 1;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values());
}

function aggregateCachedBuckets(buckets, options = {}) {
  const now = Number(options.now) || Date.now();
  const bounds = dateBounds(now, options);
  const accountFilter = String(options.account || '').trim();
  const modelFilter = String(options.model || '').trim();
  const firstDay = localDayString(bounds.from);
  const lastDay = localDayString(bounds.until);
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0 };
  const byDay = new Map();
  const byModel = new Map();
  const byAccount = new Map();
  const dailyBreakdown = [];
  for (const bucket of buckets || []) {
    if (!bucket || !bucket.day) continue;
    if (bucket.day < firstDay || bucket.day > lastDay) continue;
    if (accountFilter && String(bucket.account || '') !== accountFilter) continue;
    if (modelFilter && String(bucket.model || '') !== modelFilter) continue;
    const values = {
      input: Number(bucket.input) || 0,
      output: Number(bucket.output) || 0,
      cacheRead: Number(bucket.cacheRead) || 0,
      cacheWrite: Number(bucket.cacheWrite) || 0,
      thinking: Number(bucket.thinking) || 0,
      calls: Number(bucket.calls) || 0,
    };
    for (const key of Object.keys(totals)) totals[key] += values[key];
    const day = String(bucket.day);
    dailyBreakdown.push({ day, account: String(bucket.account || ''), model: String(bucket.model || ''), ...values });
    const dayRow = byDay.get(day) || { day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0 };
    for (const key of Object.keys(values)) dayRow[key] += values[key];
    byDay.set(day, dayRow);
    if (bucket.model) {
      const modelRow = byModel.get(bucket.model) || { model: bucket.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0 };
      for (const key of Object.keys(values)) modelRow[key] += values[key];
      byModel.set(bucket.model, modelRow);
    }
    if (bucket.account) {
      const accountRow = byAccount.get(bucket.account) || { account: bucket.account, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0 };
      for (const key of Object.keys(values)) accountRow[key] += values[key];
      byAccount.set(bucket.account, accountRow);
    }
  }
  const accountOptions = Array.isArray(options.accountOptions) ? options.accountOptions : [];
  for (const account of accountOptions) {
    const uid = String(account && (account.uid || account.account) || '').trim();
    if (!uid) continue;
    if (!byAccount.has(uid)) byAccount.set(uid, { account: uid, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0, nickname: account.nickname || '' });
    else if (account.nickname) byAccount.get(uid).nickname = account.nickname;
  }
  const undated = options.undated || { count: 0, tokens: 0, calls: 0 };
  const warnings = [];
  if (undated.count > 0) {
    warnings.push(`有 ${undated.count} 条 usage 记录没有可用时间戳（${undated.tokens} token / ${undated.calls} 次调用）——`
      + '已按纪律留空、不计入任何日期维度（不猜测归到扫描当天）');
  }
  return {
    source: 'local-workbuddy-jsonl', since: bounds.from, until: bounds.until,
    totals: withHitRate(totals),
    daily: Array.from(byDay.values(), withHitRate).sort((a, b) => a.day.localeCompare(b.day)),
    dailyBreakdown: dailyBreakdown.sort((a, b) => a.day.localeCompare(b.day) || a.account.localeCompare(b.account) || a.model.localeCompare(b.model)),
    models: Array.from(byModel.values(), withHitRate).sort((a, b) => (b.input + b.output) - (a.input + a.output)),
    accounts: Array.from(byAccount.values(), withHitRate).sort((a, b) => (b.input + b.output) - (a.input + a.output)),
    undated,
    warnings,
  };
}

function scanTokenStatsCached(root, options = {}) {
  const now = Number(options.now) || Date.now();
  // Always cache the complete retained range, independent of the UI filter.
  // Keep per-file usage metadata until cross-file deduplication. Daily buckets
  // alone discard identity and cannot distinguish imported historical copies.
  const cutoff = dateBounds(now, { days: MAX_CACHE_DAYS }).from;
  const file = cacheFile(root, options);
  const cache = readCache(file);
  const hadValidCache = usableCache(cache, now);
  const currentFiles = walkJsonl(root, options.maxFiles || 5000);
  const todayFiles = {};
  let parsedLines = 0, parseErrors = 0;
  const undated = { count: 0, tokens: 0, calls: 0 };
  const parseErrorFiles = new Set();
  for (const currentFile of currentFiles) {
    const relative = path.relative(root, currentFile).split(path.sep).join('/');
    let stat;
    try { stat = fs.statSync(currentFile); } catch (_) { continue; }
    const known = hadValidCache && cache.todayFiles[relative];
    let item;
    if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) {
      item = known;
    } else {
      const parsed = parseRecords(root, { ...options, now, lowerBound: cutoff, upperBound: now,
        files: [currentFile] });
      item = { mtimeMs: stat.mtimeMs, size: stat.size, entries: parsed.records,
        parsedLines: parsed.parsedLines, parseErrors: parsed.parseErrors, parseErrorFiles: parsed.parseErrorFiles,
        // 纪律 1 留痕：无时间戳的条目**不进 entries**（null 比较是地雷），只留计数
        undated: parsed.undated };
    }
    item.entries = item.entries.filter(entry => entry.timestamp >= cutoff);
    todayFiles[relative] = item;
    parsedLines += item.parsedLines || 0;
    parseErrors += item.parseErrors || 0;
    undated.count += (item.undated && item.undated.count) || 0;
    undated.tokens += (item.undated && item.undated.tokens) || 0;
    undated.calls += (item.undated && item.undated.calls) || 0;
    for (const errorFile of item.parseErrorFiles || []) parseErrorFiles.add(errorFile);
  }
  const records = Object.values(todayFiles).flatMap(item => item.entries);
  const buckets = aggregateBuckets(distinctRecords(records, options));
  const cacheReady = writeCache(file, { version: CACHE_VERSION, generatedAt: now, cutoff,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    historicalBuckets: [], todayFiles });
  const stats = aggregateCachedBuckets(buckets, { ...options, now, undated });
  const result = { ...stats, files: currentFiles.length, parsedLines, parseErrors,
    parseErrorFiles: Array.from(parseErrorFiles), cached: hadValidCache, cacheHit: hadValidCache,
    cacheReady, cacheGeneratedAt: hadValidCache ? cache.generatedAt : now };
  // 调用点表按需构建：三维看板不需要它（会白占 400 KB 响应），只有 thinking-stats 要。
  if (options.withCallPoints) {
    const built = buildCallPoints(records, Number(options.callPointLimit) || 200000);
    result.callPoints = built.points;
    result.callPointsTruncated = built.truncated;
  }
  return result;
}

function scanTokenStats(root, options = {}) {
  const now = Number(options.now) || Date.now();
  const bounds = dateBounds(now, options);
  const parsed = parseRecords(root, { ...options, now, lowerBound: bounds.from,
    upperBound: bounds.until, legacyParseErrors: true });
  const stats = aggregateRecords(distinctRecords(parsed.records, options), { ...options, now, undated: parsed.undated });
  return { ...stats, files: parsed.files, parsedLines: parsed.parsedLines, parseErrors: parsed.parseErrors };
}

module.exports = {
  tokenStatsCacheReady, scanTokenStats, scanTokenStatsCached, findUsage, walkJsonl, dateBounds,
  THINKING_FIELDS, localDayString, buildCallPoints, CACHE_VERSION,
};
