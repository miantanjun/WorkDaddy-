'use strict';

/**
 * 思考效率与模型性价比（T20）—— 回答「花得值不值」，而不是「花了多少」。
 *
 * ## 三条数据源（互补，不是互相替代）
 *
 * | 维度 | 来源 | 口径说明 |
 * |---|---|---|
 * | **思考秒数** | `<root>/traces/<pid>/trace_*.json` 里 `type=generation` 的 span `duration` 求和 | 单位 ms，**端到端 wall-clock**（含排队与网络），不是模型内部算力时间 |
 * | **输出 / 思考 token** | `token-stats.js` 的 `models[]`（jsonl `usage` / `rawUsage.completion_thinking_tokens`） | 与三维统计同源，保证两处数字不会打架 |
 * | **积分 credit** | 权威源 `credit_usage_records`（`credit-usage.db`，**带 model 列**） | 按模型直接 `SUM(credit)`，不是按 token 占比摊派 |
 *
 * ## 为什么不用 trace 里的 token
 * `trace.modelInfo` 确实自带 `totalInputTokens/totalOutputTokens`，但那是**只覆盖到 trace 的文件**，
 * 而三维统计走的是全量 jsonl。两套 token 混用会让「同一模型在两个页面数字不同」——
 * 违反「数字错比报错糟糕」。⇒ token 一律取 `token-stats`，trace 只负责**时间**这一个维度。
 *
 * ## 实测（2026-09-23，本机）
 * - `traces/` 2733 个文件 / 1206 MB，单文件最大 16.3 MB，`JSON.parse` 16 MB ≈ 27 ms ⇒ 全量 ≈ 7 s。
 * - `trace` 元信息排在 `spans` **之前**，所以「窗口外的文件」只读 64 KB 头就能判定并跳过（纪律 3）。
 * - 磁盘缓存按 `(mtimeMs, size)` 增量：第二次起 &lt;100 ms。
 *
 * ## 已知边界（必须显式暴露，不许静默）
 * 1. **官方只保留约 30 天 traces**（T24 实测）；窗口超过实际覆盖时给 `coverage` 提示。
 * 2. 积分权威表当前只覆盖约 10 天（历史回填未跑完，见报告 B 表）⇒ `creditCoverage` 提示。
 * 3. `generation` span 数 &gt; 调用次数（一次 LLM 往返可能产生多条 span）⇒ **不要**用 span 数当调用数。
 */

const fs = require('fs');
const path = require('path');
const discipline = require('./stats-discipline.js');

// ⚠️ 缓存条目**形状**一变就必须改这个号：本机实测过一次「代码改了但缓存照用」的假象
//    —— 旧缓存里的条目没有 spans 字段，于是 2255 个 trace 被当成「没有 span 时间」，
//    归属率凭空从 92% 掉到 49%，看起来像代码坏了。版本号是唯一能在读缓存前拦住它的东西。
const CACHE_VERSION = 2;
const MAX_CACHE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 纪律 3：trace 元信息在 span 之前，读 64 KB 头足够判定「在不在窗口内」 */
const HEAD_BYTES = 64 * 1024;
/** 单文件上限：超过就记成 unreadable 并告警，不硬啃（防一个畸形大文件拖死整轮） */
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 20000;

const TRACE_FULL_RE = /(^|[\\/])trace_[^\\/]+\.json$/i;

/* -------------------------------------------------------------------- */
/* 窗口 / 路径                                                           */
/* -------------------------------------------------------------------- */

function windowOf(options, now) {
  if (Number.isFinite(options.from) && Number.isFinite(options.until)) {
    const from = Number(options.from);
    const until = Number(options.until);
    discipline.assertShape(from <= until, 'bad-param', '开始时间不能晚于结束时间');
    discipline.assertShape(until - from <= MAX_CACHE_DAYS * DAY_MS, 'bad-param', '日期范围不能超过 90 天');
    return { from, until, days: Math.round((until - from) / DAY_MS) };
  }
  const days = discipline.requireIntRange(options.days === undefined ? 7 : options.days, 1, MAX_CACHE_DAYS, 'days');
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { from: start.getTime(), until: now, days };
}

function traceDir(root) {
  return path.join(String(root || ''), 'traces');
}

function listTraceFiles(root, options = {}) {
  const files = discipline.walkFiles(traceDir(root), '.json', {
    maxFiles: Math.max(1, Number(options.maxFiles) || MAX_FILES),
  });
  return files.filter((file) => TRACE_FULL_RE.test(file));
}

function cacheFilePath(root, options = {}) {
  return options.cacheFile || path.join(String(root || ''), '.workdaddy-thinking-stats-cache.json');
}

function localDayString(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------- */
/* 元信息：头部探测（纪律 3）                                             */
/* -------------------------------------------------------------------- */

// trace 对象里各字段的**出现顺序**是固定的（实测 2026-09-23）：
// traceId … startedAt, endedAt, duration, status, spanCount, totalTokens, metadata,
// sessionId, agentName, prompt, modelInfo —— prompt 可能极长，所以 sessionId/modelInfo
// 不保证落在 64 KB 头里，取不到就置空、由调用方决定要不要读全文。
const HEAD_PATTERNS = {
  traceId: /"traceId"\s*:\s*"(trace_[0-9a-zA-Z-]+)"/,
  startedAt: /"startedAt"\s*:\s*"([^"]+)"/,
  endedAt: /"endedAt"\s*:\s*"([^"]+)"/,
  status: /"status"\s*:\s*"([^"]*)"/,
  spanCount: /"spanCount"\s*:\s*(\d+)/,
  totalTokens: /"totalTokens"\s*:\s*(\d+)/,
  sessionId: /"sessionId"\s*:\s*"([^"]+)"/,
  models: /"modelInfo"\s*:\s*\{[^{}]*?"models"\s*:\s*\[([^\]]*)\]/,
};

function parseModelList(raw) {
  if (!raw) return [];
  return String(raw).split(',')
    .map((item) => item.trim().replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

/** 只读文件头拿元信息。拿不到 `startedAt` ⇒ 返回 null（调用方读全文，纪律 3）。 */
function probeHead(file) {
  const head = discipline.readHead(file, HEAD_BYTES);
  if (!head.ok) return null;
  const text = head.text;
  const started = discipline.parseTimestamp((HEAD_PATTERNS.startedAt.exec(text) || [])[1]);
  if (started === discipline.UNKNOWN_TIMESTAMP) return null;
  const ended = discipline.parseTimestamp((HEAD_PATTERNS.endedAt.exec(text) || [])[1]);
  const spanCountRaw = HEAD_PATTERNS.spanCount.exec(text);
  const totalTokensRaw = HEAD_PATTERNS.totalTokens.exec(text);
  return {
    traceId: (HEAD_PATTERNS.traceId.exec(text) || [])[1] || '',
    sessionId: (HEAD_PATTERNS.sessionId.exec(text) || [])[1] || '',
    startedAt: started,
    endedAt: ended,
    status: (HEAD_PATTERNS.status.exec(text) || [])[1] || '',
    spanCount: spanCountRaw ? Number(spanCountRaw[1]) : null,
    totalTokens: totalTokensRaw ? Number(totalTokensRaw[1]) : null,
    models: parseModelList((HEAD_PATTERNS.models.exec(text) || [])[1]),
    headBytes: head.windowBytes,
  };
}

/**
 * 全文读：拿 generation span 的时长。
 * 不用正则抠半截 JSON —— 结构一变就静默少算，宁可多花 20 ms 做一次完整 parse。
 */
function readTraceFull(file, size) {
  if (Number.isFinite(size) && size > MAX_TRACE_BYTES) return { oversized: true, size };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) {
    return { unreadable: true, error: String((error && error.message) || error) };
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (error) {
    return { unreadable: true, error: 'JSON 解析失败: ' + String((error && error.message) || error) };
  }
  const trace = (doc && doc.trace) || {};
  const spans = Array.isArray(doc && doc.spans) ? doc.spans : [];
  const startedAt = discipline.firstTimestamp([trace.startedAt]) || discipline.UNKNOWN_TIMESTAMP;
  const endedAt = discipline.firstTimestamp([trace.endedAt]);
  const modelInfo = (trace.modelInfo && typeof trace.modelInfo === 'object') ? trace.modelInfo : {};
  const models = Array.isArray(modelInfo.models)
    ? modelInfo.models.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const day = startedAt === discipline.UNKNOWN_TIMESTAMP ? null : localDayString(startedAt);
  let genSpans = 0, genMs = 0;
  const genMsByDay = Object.create(null);
  const spanList = [];
  for (const span of spans) {
    if (!span || span.type !== 'generation') continue;
    const duration = discipline.finiteNumber(span.duration);
    if (duration === null || duration < 0) continue;
    genSpans++;
    genMs += duration;
    const spanStart = discipline.firstTimestamp([span.startedAt]);
    const spanEnd = discipline.firstTimestamp([span.endedAt]);
    const spanDay = localDayString(spanStart === discipline.UNKNOWN_TIMESTAMP ? startedAt : spanStart);
    if (spanDay) genMsByDay[spanDay] = (genMsByDay[spanDay] || 0) + duration;
    // 只有「trace 自己没说模型」时才需要保留 span 时间，供聚合阶段按时间窗对齐（见 JOIN 段）。
    if (!models.length && spanStart !== discipline.UNKNOWN_TIMESTAMP) {
      spanList.push({ s: spanStart, e: spanEnd === discipline.UNKNOWN_TIMESTAMP ? spanStart : spanEnd, d: duration });
    }
  }
  return {
    meta: {
      traceId: String(trace.traceId || ''),
      sessionId: String(trace.sessionId || ''),
      startedAt,
      endedAt,
      status: String(trace.status || ''),
      spanCount: Number.isFinite(Number(trace.spanCount)) ? Number(trace.spanCount) : spans.length,
      totalTokens: discipline.finiteNumber(trace.totalTokens),
      models,
      modelInfoTokens: {
        input: discipline.finiteNumber(modelInfo.totalInputTokens),
        output: discipline.finiteNumber(modelInfo.totalOutputTokens),
        cached: discipline.finiteNumber(modelInfo.totalCachedTokens),
        calls: discipline.finiteNumber(modelInfo.callCount),
      },
      runMs: discipline.finiteNumber(trace.duration),
    },
    agg: { genSpans, genMs, genMsByDay, day, spans: spanList.length ? spanList : null },
  };
}

/* -------------------------------------------------------------------- */
/* JOIN：把「无 modelInfo 的 trace」按其 span 时间窗对齐到模型             */
/* -------------------------------------------------------------------- */

/**
 * 为什么需要这个 join（2026-09-23 实测）：本机 2732 个 trace 里**只有 363 个**自带
 * `trace.modelInfo.models`；其余全部缺模型。而 `traces/<pid>` 目录名是 PID、trace 对象里
 * 也没有 sessionId（仅 30 个有）⇒ 没有直接键可连。
 *
 * 但两条流在时间上是同一件事：`generation` span 的 [startedAt, endedAt] 就是**一次 LLM 调用**的
 * 起止，而 jsonl 里每条 usage 行都带 `timestamp` 与 `model`（实测模型覆盖率 100%）。
 * ⇒ 用「时间窗内是否有唯一模型」来归属，**多候选一律判歧义、不猜**（纪律 1）。
 *
 * 实测（本机 7 天）：唯一命中 92.0%、歧义 0.3%、无候选 7.7%；按时长算可归属 84.4%。
 * 无候选的主要来源是 **subagent 的 jsonl**（`walkJsonl` 有意跳过 `subagents/` 目录）。
 */
const MATCH_SLACK_BEFORE_MS = 1500;
const MATCH_SLACK_AFTER_MS = 2000;
const MATCH_SCAN_LIMIT = 1000;

function lowerBound(points, value) {
  let low = 0, high = points.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].t < value) low = mid + 1; else high = mid;
  }
  return low;
}

/**
 * 归属一个 span。
 * @returns {{model: string|null, reason: 'unique'|'ambiguous'|'none'}}
 */
function matchSpanModel(points, span) {
  const from = span.s - MATCH_SLACK_BEFORE_MS;
  const to = span.e + MATCH_SLACK_AFTER_MS;
  let index = lowerBound(points, from);
  let model = null;
  let scanned = 0;
  while (index < points.length && points[index].t <= to) {
    const candidate = points[index].model;
    if (model === null) model = candidate;
    else if (candidate !== model) return { model: null, reason: 'ambiguous' };
    if (++scanned > MATCH_SCAN_LIMIT) return { model: null, reason: 'ambiguous' };
    index++;
  }
  return model === null ? { model: null, reason: 'none' } : { model, reason: 'unique' };
}

/* -------------------------------------------------------------------- */
/* 磁盘缓存：按 (mtimeMs, size) 增量                                      */
/* -------------------------------------------------------------------- */

function readCache(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.version !== CACHE_VERSION || !value.files || typeof value.files !== 'object') return null;
    return value;
  } catch (_) { return null; }
}

function writeCache(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (_) { return false; } // 缓存失败绝不能阻断统计
}

function usableCache(cache) {
  return !!cache && Number.isFinite(cache.generatedAt);
}

function thinkingStatsCacheReady(root, options = {}) {
  return usableCache(readCache(cacheFilePath(root, options)));
}

/* -------------------------------------------------------------------- */
/* 主流程                                                               */
/* -------------------------------------------------------------------- */

function emptyBuckets() {
  return { genSpans: 0, genMs: 0, runs: 0, runMs: 0, sessions: new Set(), models: new Set(), genMsByDay: Object.create(null) };
}

/** 按模型取桶。**键一律小写归一**，否则和 token-stats / 积分表的模型名大小写不同就对不上。 */
function bucketFor(map, model) {
  const display = String(model || '').trim();
  if (!display) return null;
  const key = display.toLowerCase();
  if (!map.has(key)) map.set(key, { model: display, ...emptyBuckets() });
  return map.get(key);
}

/**
 * 扫 traces 并聚合。**纯同步**，daemon 侧放在异步路由里 await 即可。
 * @param {object} options
 * @param {string} options.root      WorkBuddy 数据根（= PROFILE.dataRoot）
 * @param {number} [options.days]    窗口天数（1–90），默认 7
 * @param {number} [options.now]     基准时刻（测试注入）
 * @param {Array}  [options.models]  token-stats 的 models[]（token 维度）
 * @param {object} [options.creditByModel] 权威积分表按模型的 credit：{ [model]: { credit, count } }
 * @param {string} [options.cacheFile]     磁盘缓存路径覆盖
 */
function buildThinkingStats(options = {}) {
  const started = Date.now();
  const now = Number(options.now) || started;
  const root = String(options.root || '');
  discipline.assertShape(!!root, 'bad-param', '缺少 root（WorkBuddy 数据根）');
  const window = windowOf(options, now);

  const cacheFile = cacheFilePath(root, options);
  const loaded = options.ignoreCache ? null : readCache(cacheFile);
  const cached = usableCache(loaded) ? loaded : null;
  const cacheFiles = (cached && cached.files) || {};

  const files = listTraceFiles(root, options);
  const nextCache = {};
  const warnings = [];
  const counters = { total: files.length, reused: 0, headOnly: 0, full: 0, skipped: 0, oversized: 0, unreadable: 0, refused: 0 };

  // 按模型聚合；同时记「无模型可归属」的一桶，便于暴露而不是丢弃
  const byModel = new Map();
  const unknownBucket = { model: '', ...emptyBuckets() };
  const seenDays = new Set();
  const attribution = {
    byModelInfo: { spans: 0, ms: 0 },
    byTimeWindow: { spans: 0, ms: 0 },
    ambiguous: { spans: 0, ms: 0 },
    unattributed: { spans: 0, ms: 0 },
  };
  const callPoints = Array.isArray(options.callPoints) ? options.callPoints.slice().sort((a, b) => a.t - b.t) : null;

  // 累加 span 数/时长到某个模型（不分「trace 计数」——它由 finishTrace 单独记）
  const addSpanMs = (model, spanCount, ms) => {
    const bucket = model ? bucketFor(byModel, model) : unknownBucket;
    if (!bucket) return null;
    bucket.genSpans += spanCount;
    bucket.genMs += ms;
    if (model) bucket.models.add(model);
    return bucket;
  };

  // 「每个 trace 一次」的量（轮数 / 整轮耗时 / 会话）
  const finishTrace = (model, meta) => {
    const bucket = model ? bucketFor(byModel, model) : unknownBucket;
    if (!bucket) return;
    bucket.runs++;
    bucket.runMs += discipline.finiteNumber(meta && meta.runMs) || 0;
    if (meta && meta.sessionId) bucket.sessions.add(meta.sessionId);
  };

  const addByDay = (bucket, map) => {
    if (!bucket) return;
    for (const [day, ms] of Object.entries(map || {})) {
      if (!day || day === 'null' || day === 'undefined') continue;
      bucket.genMsByDay[day] = (bucket.genMsByDay[day] || 0) + ms;
    }
  };

  for (const file of files) {
    let stat;
    try { stat = fs.statSync(file); } catch (_) { counters.unreadable++; continue; }
    const known = cacheFiles[file];
    let entry = (known && Number(known.mtimeMs) === Number(stat.mtimeMs) && Number(known.size) === Number(stat.size)) ? known : null;
    if (entry) counters.reused++;

    const inWindow = (meta) => {
      if (!meta) return true;
      const end = Number.isFinite(meta.endedAt) ? meta.endedAt : meta.startedAt;
      return meta.startedAt <= window.until && end >= window.from;
    };

    // 缓存里只有头（窗口外）⇒ 这次窗口若覆盖它，必须补读全文
    if (entry && entry.agg === null && inWindow(entry.meta)) entry = null;

    if (!entry) {
      let meta = null;
      try { meta = probeHead(file); } catch (_) { meta = null; }
      if (meta && !inWindow(meta)) {
        // 纪律 3 的核心收益：窗口外的 trace 只读 64 KB 头就跳过
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, meta, agg: null };
        counters.headOnly++; counters.skipped++;
      } else {
        const full = readTraceFull(file, stat.size);
        counters.full++;
        if (full.oversized) { counters.oversized++; warnings.push(`文件超过 ${Math.round(MAX_TRACE_BYTES / 1048576)} MB 未解析：${path.basename(file)}`); continue; }
        if (full.unreadable) { counters.unreadable++; warnings.push(`读取失败：${path.basename(file)}（${full.error}）`); continue; }
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, meta: full.meta, agg: full.agg };
      }
    } else if (entry.agg === null) {
      counters.headOnly++; counters.skipped++;
    }

    nextCache[file] = entry;
    if (!entry.agg) continue;

    const models = (entry.meta && entry.meta.models) || [];
    if (entry.agg.day) seenDays.add(entry.agg.day);

    // 路径 A：trace 自带 modelInfo 且只有一个模型 ⇒ 直接按它归属（最可信）
    if (models.length === 1) {
      attribution.byModelInfo.spans += entry.agg.genSpans;
      attribution.byModelInfo.ms += entry.agg.genMs;
      addByDay(addSpanMs(models[0], entry.agg.genSpans, entry.agg.genMs), entry.agg.genMsByDay);
      finishTrace(models[0], entry.meta);
      continue;
    }
    // modelInfo 里列了多个模型 ⇒ 无法判断哪个 span 属于谁。**不摊派**（纪律 1）。
    if (models.length > 1) {
      attribution.ambiguous.spans += entry.agg.genSpans;
      attribution.ambiguous.ms += entry.agg.genMs;
      addByDay(addSpanMs('', entry.agg.genSpans, entry.agg.genMs), entry.agg.genMsByDay);
      finishTrace('', entry.meta);
      continue;
    }

    // 路径 B：无 modelInfo ⇒ 逐 span 按时间窗对齐（多候选判歧义，不猜）
    const spans = entry.agg.spans;
    if (!spans || !spans.length) {
      counters.refused++;
      attribution.unattributed.spans += entry.agg.genSpans;
      attribution.unattributed.ms += entry.agg.genMs;
      addByDay(addSpanMs('', entry.agg.genSpans, entry.agg.genMs), entry.agg.genMsByDay);
      finishTrace('', entry.meta);
      continue;
    }
    let firstModel = '';
    for (const span of spans) {
      const hit = callPoints ? matchSpanModel(callPoints, span) : { model: null, reason: 'no-points' };
      if (hit.reason === 'unique') {
        attribution.byTimeWindow.spans++;
        attribution.byTimeWindow.ms += span.d;
        addByDay(addSpanMs(hit.model, 1, span.d), { [localDayString(span.s)]: span.d });
        if (!firstModel) firstModel = hit.model;
      } else if (hit.reason === 'ambiguous') {
        attribution.ambiguous.spans++;
        attribution.ambiguous.ms += span.d;
        addByDay(addSpanMs('', 1, span.d), { [localDayString(span.s)]: span.d });
      } else {
        attribution.unattributed.spans++;
        attribution.unattributed.ms += span.d;
        addByDay(addSpanMs('', 1, span.d), { [localDayString(span.s)]: span.d });
      }
    }
    // 整轮耗时/会话挂在「首个被归属的模型」上，避免同一个 trace 往多个桶里各记一遍
    finishTrace(firstModel, entry.meta);
  }

  writeCache(cacheFile, {
    version: CACHE_VERSION, generatedAt: now, root, files: nextCache,
  });

  /* ---- 合并 token 维度（token-stats）与积分维度（权威表） ---- */
  const tokenByKey = new Map();
  for (const item of Array.isArray(options.models) ? options.models : []) {
    const key = String(item && item.model || '').trim().toLowerCase();
    if (!key) continue;
    const row = tokenByKey.get(key) || { model: String(item.model), input: 0, output: 0, cacheRead: 0, thinking: 0, calls: 0 };
    row.input += discipline.finiteNumber(item.input) || 0;
    row.output += discipline.finiteNumber(item.output) || 0;
    row.cacheRead += discipline.finiteNumber(item.cacheRead) || 0;
    row.thinking += discipline.finiteNumber(item.thinking) || 0;
    row.calls += discipline.finiteNumber(item.calls) || 0;
    tokenByKey.set(key, row);
  }
  const creditByKey = new Map();
  const creditInput = options.creditByModel || {};
  for (const [model, value] of Object.entries(creditInput)) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) continue;
    creditByKey.set(key, {
      model: String(model),
      credit: discipline.finiteNumber(value && value.credit) || 0,
      count: discipline.finiteNumber(value && value.count) || 0,
    });
  }

  const keys = new Set([...tokenByKey.keys(), ...creditByKey.keys(), ...byModel.keys()].map((k) => k.toLowerCase()));
  const rows = [];
  for (const key of keys) {
    const trace = byModel.get(key) || null;
    const token = tokenByKey.get(key) || null;
    const credit = creditByKey.get(key) || null;
    const model = (token && token.model) || (credit && credit.model) || (trace && trace.model) || key;
    const genMs = trace ? trace.genMs : 0;
    const thinkingSec = genMs > 0 ? genMs / 1000 : null;
    const output = token ? token.output : null;
    const creditValue = credit ? credit.credit : null;
    rows.push({
      model,
      // 时间维度（traces）
      traces: trace ? trace.runs : 0,
      generationSpans: trace ? trace.genSpans : 0,
      thinkingMs: genMs,
      thinkingSec,
      runMs: trace ? trace.runMs : 0,
      sessions: trace ? trace.sessions.size : 0,
      // token 维度（token-stats）
      output,
      input: token ? token.input : null,
      thinking: token ? token.thinking : null,
      calls: token ? token.calls : null,
      // 价值维度（权威积分表）
      credit: creditValue,
      creditCalls: credit ? credit.count : null,
      // 派生指标：拿不到 ⇒ null，**不是 0**（纪律 1）
      tokPerSec: (thinkingSec && output) ? output / thinkingSec : null,
      thinkingShare: (output && token && token.thinking) ? token.thinking / output : null,
      creditPer1kTokens: (output && creditValue !== null && output > 0) ? creditValue / (output / 1000) : null,
      creditPerTrace: (trace && trace.runs && creditValue !== null) ? creditValue / trace.runs : null,
    });
  }
  rows.sort((a, b) => {
    const ac = a.credit === null ? -1 : a.credit;
    const bc = b.credit === null ? -1 : b.credit;
    if (bc !== ac) return bc - ac;
    return (b.output || 0) - (a.output || 0);
  });

  const totals = rows.reduce((acc, row) => {
    acc.traces += row.traces;
    acc.generationSpans += row.generationSpans;
    acc.thinkingMs += row.thinkingMs;
    acc.output += row.output || 0;
    acc.thinking += row.thinking || 0;
    acc.calls += row.calls || 0;
    acc.credit += row.credit || 0;
    return acc;
  }, { traces: 0, generationSpans: 0, thinkingMs: 0, output: 0, thinking: 0, calls: 0, credit: 0 });
  totals.tokPerSec = totals.thinkingMs > 0 && totals.output ? totals.output / (totals.thinkingMs / 1000) : null;
  totals.creditPer1kTokens = totals.output > 0 ? totals.credit / (totals.output / 1000) : null;

  const days = Array.from(seenDays).sort();
  const attributedMs = attribution.byModelInfo.ms + attribution.byTimeWindow.ms;
  const totalMs = attributedMs + attribution.ambiguous.ms + attribution.unattributed.ms;
  const coverage = {
    traceDays: days.length,
    traceFrom: days[0] || null,
    traceTo: days[days.length - 1] || null,
    creditModels: creditByKey.size,
    attributedMs,
    totalMs,
    attributedRatio: totalMs > 0 ? attributedMs / totalMs : null,
  };
  const coverageDays = days.length ? Math.round((Date.parse(days[days.length - 1]) - Date.parse(days[0])) / DAY_MS) + 1 : 0;
  if (coverageDays && coverageDays < window.days) {
    warnings.push(`traces 实际只覆盖 ${coverageDays} 天（请求 ${window.days} 天）—— 官方 traces 有保留期，缺失属正常`);
  }
  if (!creditByKey.size) {
    warnings.push('权威积分表（credit_usage_records）里没有按模型的记录 ⇒ credit 列留空，不用 token 占比摊派替代');
  }
  // 纪律 1：归属率不足就**说出来**，而不是给一张看起来完整的表。
  // 本机实测唯一命中 92%（按时长 84%）；低于 80% 说明对齐假设已经不成立。
  if (totalMs > 0 && coverage.attributedRatio !== null && coverage.attributedRatio < 0.8) {
    warnings.push(`思考时长的模型归属率只有 ${Math.round(coverage.attributedRatio * 100)}%（阈 80%）⇒ 每模型 tok/s 不可信，看总量口径`);
  }
  if (!callPoints) {
    warnings.push('未拿到调用点表（token-stats 的 withCallPoints）⇒ 缺 modelInfo 的 trace 无法按时间窗归属，每模型 tok/s 会明显偏低');
  }
  if (counters.refused) {
    warnings.push(`${counters.refused} 个 trace 的 span 缺 startedAt ⇒ 无法对齐模型，其时长留在 unknown 桶`);
  }
  if (counters.oversized) warnings.push(`${counters.oversized} 个 trace 文件过大被跳过`);
  if (counters.unreadable) warnings.push(`${counters.unreadable} 个 trace 文件读取/解析失败被跳过`);

  return {
    ok: true,
    source: 'workbuddy-traces + credit_usage_records',
    from: window.from,
    until: window.until,
    days: window.days,
    generatedAt: now,
    elapsedMs: Date.now() - started,
    files: counters,
    totals,
    models: rows,
    attribution,
    unknown: (unknownBucket.runs || unknownBucket.genSpans) ? {
      traces: unknownBucket.runs, generationSpans: unknownBucket.genSpans,
      thinkingMs: unknownBucket.genMs, sessions: unknownBucket.sessions.size,
    } : null,
    coverage,
    warnings,
    notes: [
      '思考秒数 = type=generation 的 span duration 之和，**端到端 wall-clock**（含排队/网络），不代表模型内部算力时间',
      'tok/s = 输出 token ÷ 思考秒数，因此是「端到端吞吐」口径；不同上下文规模之间不可直接横比',
      'generation span 数 ≠ 调用次数：一次 LLM 往返可能产生多条 span，调用次数一律取 token-stats',
      '模型归属两条路径：trace 自带 modelInfo（13% 的 trace）优先；其余按 span 时间窗与 jsonl 调用点对齐，多候选判歧义、不摊派',
    ],
  };
}

/* -------------------------------------------------------------------- */
/* 结果缓存（面板轮询用）                                                 */
/* -------------------------------------------------------------------- */

const RESULT_TTL_MS = 60000;
let resultCache = { key: '', at: 0, data: null };

function buildThinkingStatsCached(options = {}) {
  const now = Number(options.now) || Date.now();
  const key = String(options.root || '') + '|' + (options.days || '') + '|' + (options.from || '') + '|' + (options.until || '') + '|' +
    (Array.isArray(options.models) ? options.models.length : 0) + '|' +
    (Array.isArray(options.callPoints) ? options.callPoints.length : 0);
  if (resultCache.data && resultCache.key === key && now - resultCache.at < RESULT_TTL_MS) {
    return { ...resultCache.data, cached: true };
  }
  const data = buildThinkingStats({ ...options, now });
  resultCache = { key, at: now, data };
  return data;
}

module.exports = {
  buildThinkingStats, buildThinkingStatsCached, thinkingStatsCacheReady,
  listTraceFiles, probeHead, readTraceFull, windowOf,
  MAX_CACHE_DAYS, MAX_TRACE_BYTES, HEAD_BYTES, RESULT_TTL_MS,
};

/* -------------------------------------------------------------------- */
/* CLI：node scripts/thinking-stats.js --days=7 [--root=...] [--json]     */
/* -------------------------------------------------------------------- */

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const hit = argv.find((item) => item === '--' + name || item.startsWith('--' + name + '='));
    if (!hit) return fallback;
    const eq = hit.indexOf('=');
    return eq < 0 ? true : hit.slice(eq + 1);
  };
  const root = String(arg('root', path.join(require('os').homedir(), '.workbuddy')));
  const days = Number(arg('days', 7)) || 7;
  try {
    const options = { root, days };
    // --fresh：不用磁盘缓存（验证用；缓存版本号变更后也会自动重建）
    if (argv.includes('--fresh')) options.ignoreCache = true;
    // --calls：把 jsonl 的 (时间, 模型) 调用点也带上，这样 CLI 与面板走同一条归属路径
    if (argv.includes('--calls')) {
      const tokenStats = require('./token-stats.js');
      options.callPoints = tokenStats.scanTokenStatsCached(root, { days, withCallPoints: true }).callPoints || [];
    }
    const result = buildThinkingStats(options);
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const lines = [];
      lines.push(`窗口 ${localDayString(result.from)} ~ ${localDayString(result.until)}（${result.days} 天）  用时 ${result.elapsedMs} ms`);
      lines.push(`文件 总${result.files.total} 复用${result.files.reused} 只读头${result.files.headOnly} 全文${result.files.full} 跳过${result.files.skipped}`);
      lines.push('模型'.padEnd(24) + '输出'.padStart(12) + '思考秒'.padStart(10) + 'tok/s'.padStart(9) + '积分'.padStart(10) + 'credit/1k'.padStart(11));
      for (const row of result.models.slice(0, 20)) {
        lines.push(String(row.model).slice(0, 23).padEnd(24) +
          String(row.output === null ? '—' : Math.round(row.output)).padStart(12) +
          String(row.thinkingSec === null ? '—' : row.thinkingSec.toFixed(1)).padStart(10) +
          String(row.tokPerSec === null ? '—' : row.tokPerSec.toFixed(1)).padStart(9) +
          String(row.credit === null ? '—' : row.credit.toFixed(2)).padStart(10) +
          String(row.creditPer1kTokens === null ? '—' : row.creditPer1kTokens.toFixed(3)).padStart(11));
      }
      for (const warning of result.warnings) lines.push('⚠ ' + warning);
      process.stdout.write(lines.join('\n') + '\n');
    }
  } catch (error) {
    process.stderr.write('失败 ' + (discipline.isStatsError(error) ? '[' + error.code + '] ' : '') + (error.message || error) + '\n');
    process.exit(1);
  }
}
