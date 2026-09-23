'use strict';

/**
 * 单会话成本卡（T21）—— 面板「会话」页顶部的实时成本读数。
 *
 * ⚠️ 口径是本节的核心，改代码前先读这段（2026-09-23 实测确定）：
 *
 * 1) **credit_json 的键 = `providerData.conversationRequestId`（= `traceId`）**，
 *    不是 jsonl 顶层 `record.id`。它出现在**同一次请求的每一条记录**上
 *    （reasoning / message / function_call / function_call_result 各一条），
 *    实测一个会话里同一个键出现 **204 次** —— 这正是历史上「按 record.id 累加」
 *    把积分算到 ≈50× 的根因（见 usage-unified.js 头部记录）。⇒ **必须按 requestId 去重**。
 *
 * 2) 一个 `conversationRequestId` = **一次用户轮次里的整段 agentic loop**（多次 LLM 往返），
 *    组内 input 从 45k 一路涨到 112k。⇒ 它天然就是「一轮」的口径：credit 按轮结算。
 *
 * 3) 组内每次往返各有一条 usage，**数值互不相同**（不是快照重复）：
 *    `input_tokens` 已含 `cache_read_input_tokens`（本仓 token 口径铁律，勿再相加）。
 *
 * 4) `session_usage.used / size` 是**官方给的上下文窗口占用**（如 223960 / 300000），
 *    比我们自己从 jsonl 推更准 ⇒ 上下文规模直接用它，不自己算。
 *
 * 性能：大会话 jsonl 可达 158 MB，**只读文件尾部**（默认 8 MB）足够覆盖最近 N 轮；
 *      累计积分 / 轮次 / 上下文规模都不需要 jsonl（分别来自 credit_json 与 session_usage）。
 */

const fs = require('fs');
const path = require('path');
const discipline = require('./stats-discipline.js');

// 自适应窗口：从 4 MB 起翻倍，直到窗口内**已结算轮次**够 N 轮，或触顶 64 MB。
// 为什么自适应：本机一个重轮次的 jsonl 段落可达 10+ MB（实测 24.9 MB 的会话里
// 8 MB 尾窗只覆盖 2 轮），固定窗口会让「边际成本」抖动到没有参考价值。
const TAIL_MIN_BYTES = 4 * 1024 * 1024;
const TAIL_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_ROUNDS = 10;               // 「最近 N 轮」默认值
const MAX_ROUNDS = 50;

/** 会话 id 白名单：防目录穿越（会拼进文件路径）。 */
function safeSessionId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 128) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return '';
  if (id === '.' || id === '..' || id.includes('..')) return '';
  return id;
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
 * 读文件尾部（limit 字节）。
 * T23 起实现搬到 `stats-discipline.readTail`（纪律 3：只读头部/尾部一处定义），
 * 这里保留同名包装，`readTail(file, limit)` 的调用点与返回字段完全不变。
 */
const readTail = discipline.readTail;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(num(value) * 100) / 100;
}

/**
 * 扫 jsonl 尾部，按 conversationRequestId 归拢出「轮」。
 * 返回 Map<requestId, { lastTs, firstTs, maxInput, sumInput, sumCache, sumOutput, thinking, model, calls, steps }>
 */
function groupRounds(text) {
  const groups = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue;
    let record;
    try { record = JSON.parse(line); } catch (_) { continue; }
    if (!record || typeof record !== 'object' || record.isSnapshotUpdate) continue;
    const pd = record.providerData || {};
    const rid = String(pd.conversationRequestId || pd.traceId || '').trim();
    if (!rid) continue;
    const usage = (record.message && record.message.usage) || pd.usage || record.usage;
    const ts = num(record.timestamp || record.created_at || record.createdAt);
    let g = groups.get(rid);
    if (!g) {
      g = { requestId: rid, firstTs: ts, lastTs: ts, maxInput: 0, sumInput: 0, sumCache: 0,
        sumOutput: 0, thinking: 0, model: '', calls: 0, steps: 0 };
      groups.set(rid, g);
    }
    if (ts) { if (!g.firstTs || ts < g.firstTs) g.firstTs = ts; if (ts > g.lastTs) g.lastTs = ts; }
    if (!g.model && (pd.model || pd.requestModelName)) g.model = String(pd.requestModelName || pd.model || '');
    g.steps++;
    if (!usage) continue;
    g.calls++;
    const input = num(usage.input_tokens != null ? usage.input_tokens : usage.input);
    const output = num(usage.output_tokens != null ? usage.output_tokens : usage.output);
    const cache = num(usage.cache_read_input_tokens != null ? usage.cache_read_input_tokens
      : (usage.cache_read_tokens != null ? usage.cache_read_tokens : usage.cached_tokens));
    const think = num(usage.completion_thinking_tokens) ||
      num(pd.rawUsage && pd.rawUsage.completion_thinking_tokens);
    if (input > g.maxInput) g.maxInput = input;
    g.sumInput += input;
    g.sumOutput += output;
    g.sumCache += cache;
    g.thinking += think;
  }
  return groups;
}

/**
 * 从窗口文本里挑出「官方已结算」的轮（即 credit_json 里有该 requestId 的），按时间升序。
 * @returns {{list: Array, rounds: number}} rounds = 窗口内识别到的全部轮数（含未结算）
 */
function settledFrom(text, creditMap) {
  const groups = groupRounds(text);
  const list = [];
  for (const g of groups.values()) {
    if (creditMap[g.requestId] == null) continue;
    list.push({ ...g, credit: round2(creditMap[g.requestId]) });
  }
  list.sort((a, b) => (a.lastTs || 0) - (b.lastTs || 0));
  return { list, rounds: groups.size };
}

/**
 * @param {object} options
 * @param {string} options.root         WorkBuddy 数据根（PROFILE.dataRoot）
 * @param {string} options.sessionId    会话 id
 * @param {Function} options.query      sqlite 查询函数（daemon 的 sqliteQuery）
 * @param {number} [options.rounds=10]  「最近 N 轮」
 */
async function buildSessionCost(options = {}) {
  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(options.rounds) || DEFAULT_ROUNDS));
  const now = Number(options.now) || Date.now();
  const sessionId = safeSessionId(options.sessionId);
  const out = {
    ok: true, sessionId, rounds,
    state: 'ok',
    credit: { total: 0, settledRounds: 0, windowCount: 0, marginal: null, nextRoundsCost: null },
    context: null,
    cache: { hitRate: null, cacheSum: 0, inputSum: 0, basis: 'window', denominator: null, guarded: false },
    tokens: { input: 0, output: 0, thinking: 0, calls: 0 },
    model: '',
    window: { bytes: 0, truncated: false, rounds: 0 },
    notes: [], generatedAt: now,
  };
  if (!sessionId) { out.state = 'no-session'; out.notes.push('没有读到当前会话 id'); return out; }
  if (typeof options.query !== 'function') { out.state = 'error'; out.notes.push('缺少 sqlite 查询函数'); return out; }

  // ① 官方侧：累计积分（credit_json）+ 上下文窗口占用（used/size）
  let creditMap = {};
  try {
    const rows = await options.query('SELECT session_id, credit_json, used, size FROM session_usage WHERE session_id = ?;', [sessionId]);
    const row = (rows && rows[0]) || null;
    if (!row) {
      out.state = 'no-session';
      out.notes.push('官方 session_usage 里没有这个会话（可能是还没结算，或会话已不在本机）');
      return out;
    }
    try { creditMap = JSON.parse(row.credit_json || '{}') || {}; } catch (_) { creditMap = {}; }
    const total = Object.keys(creditMap).reduce((a, k) => a + num(creditMap[k]), 0);
    out.credit.total = round2(total);
    out.credit.settledRounds = Object.keys(creditMap).length;
    if (row.used != null || row.size != null) {
      const used = num(row.used), size = num(row.size);
      out.context = { used, size, ratio: size > 0 ? used / size : null };
    }
  } catch (e) {
    out.state = 'error';
    out.notes.push('读 workbuddy.db 失败：' + ((e && e.message) || e));
    return out;
  }

  // ② jsonl 尾部：把「轮」按时间排出来（credit_json 是无序 map，必须靠 jsonl 定序）
  const jsonl = locateSessionJsonl(options.root, sessionId);
  if (!jsonl) {
    out.notes.push('本机找不到该会话的 jsonl（会话可能被清理或在别的账号下）⇒ 只能显示累计积分与上下文占用，无法给边际成本');
    if (!out.credit.settledRounds) out.state = 'pending-first-settlement';
    return out;
  }
  // 自适应窗口：读尾部 → 归轮 → 数「已结算」轮，不够 N 轮就翻倍重读
  let windowBytes = TAIL_MIN_BYTES;
  let tail = readTail(jsonl, windowBytes);
  let picked = settledFrom(tail.text, creditMap);
  while (picked.list.length < rounds && tail.truncated && windowBytes < TAIL_MAX_BYTES) {
    windowBytes = Math.min(TAIL_MAX_BYTES, windowBytes * 2);
    tail = readTail(jsonl, windowBytes);
    picked = settledFrom(tail.text, creditMap);
  }
  const settled = picked.list;
  out.window.bytes = tail.bytes;
  out.window.truncated = tail.truncated;
  out.window.windowBytes = tail.windowBytes;
  out.window.rounds = picked.rounds;
  out.credit.windowCount = settled.length;

  // ③ 口径：累计积分 / 轮次 / 上下文规模（前两步已给）
  if (!out.credit.settledRounds) {
    out.state = 'pending-first-settlement';
    out.notes.push('这个会话还没有已结算的轮次 ⇒ 边际成本不做估算（显示「待首轮结算」而不是 0）');
  } else if (!settled.length) {
    out.notes.push('已结算轮次都在 jsonl 尾部窗口之外（已读到 ' + Math.round((out.window.windowBytes || 0) / 1048576) + ' MB），边际成本暂缺');
  } else {
    // 边际成本 = 最近 N 轮**实际已结算**积分均值（不是全程均值 —— 全程均值会被早期冷缓存轮拉高）
    const tailN = settled.slice(-rounds);
    const sum = tailN.reduce((a, r) => a + r.credit, 0);
    out.credit.windowCount = tailN.length;
    out.credit.marginal = round2(sum / tailN.length);
    // 「再聊 N 轮约多少」：同样的 N 轮，乘 marginal
    out.credit.nextRoundsCost = round2(out.credit.marginal * rounds);
    out.credit.windowCredits = tailN.map((r) => r.credit);

    // 缓存命中率：口径 `cache ÷ input`（input 已含 cache）。
    // 防护（纪律 5，实现见 stats-discipline.cacheHitRateDetail）：实测 cache > input 时
    // 自动切 `cache/(input+cache)`，并把「换过分母」标出来，避免给出 >100% 的命中率。
    const inputSum = tailN.reduce((a, r) => a + r.sumInput, 0);
    const cacheSum = tailN.reduce((a, r) => a + r.sumCache, 0);
    const hit = discipline.cacheHitRateDetail(cacheSum, inputSum);
    out.cache.cacheSum = cacheSum;
    out.cache.inputSum = inputSum;
    out.cache.hitRate = hit.rate;
    out.cache.denominator = hit.denominator;
    out.cache.guarded = hit.guarded;
    out.cache.basis = 'last' + tailN.length + 'rounds';
    out.tokens = {
      input: inputSum,
      output: tailN.reduce((a, r) => a + r.sumOutput, 0),
      thinking: tailN.reduce((a, r) => a + r.thinking, 0),
      calls: tailN.reduce((a, r) => a + r.calls, 0),
    };
    const models = tailN.map((r) => r.model).filter(Boolean);
    out.model = models.length ? models[models.length - 1] : '';
  }
  out.credit.totalCredits = settled.map((r) => r.credit);
  return out;
}

// 结果缓存：一次完整扫描可能读 25 MB+（实测 395 ms），面板轮询时不能每次重算。
const RESULT_TTL_MS = 5000;
const RESULT_CACHE_MAX = 40;
const resultCache = new Map();

/**
 * 带 TTL 的包装。面板按会话轮询时用这个，避免重复扫大盘。
 * @param {object} options 同 buildSessionCost
 */
async function buildSessionCostCached(options = {}) {
  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(options.rounds) || DEFAULT_ROUNDS));
  const key = String(safeSessionId(options.sessionId) || '') + '|' + rounds;
  const now = Number(options.now) || Date.now();
  const hit = resultCache.get(key);
  if (hit && now - hit.at < RESULT_TTL_MS) return { ...hit.data, cached: true };
  const data = await buildSessionCost({ ...options, rounds, now });
  resultCache.set(key, { at: now, data });
  if (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
  return data;
}

module.exports = {
  buildSessionCost, buildSessionCostCached, safeSessionId,
  TAIL_MIN_BYTES, TAIL_MAX_BYTES, DEFAULT_ROUNDS, RESULT_TTL_MS,
};
