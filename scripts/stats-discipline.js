'use strict';

/**
 * 统计模块工程纪律（T23）—— 把 wb-credits 的五条纪律做成**可执行的零件**。
 *
 * 为什么单独成文件：这五条是「口径纪律」，不是某个统计脚本的实现细节。
 * token-stats / thinking-stats / session-cost / usage-unified 都要用同一条口径，
 * 各抄一遍必然漂移 —— 历史上「命中率是 cached/input 还是 cached/(input+cached)」
 * 就差点在两处出现两种答案。⇒ 一处定义、各处 require、测试里做静态反向守卫。
 *
 * 五条（来源：报告 §13.4 T23，出自 wb-credits 拆解）：
 *   1) **数字错比报错糟糕** —— 结构不匹配就明确报错；时间戳拿不到就留空，绝不猜一个填上。
 *      （原文：「用户不会核对数字，他会直接信。」）
 *   2) **只读打开** —— 不干扰正在跑的客户端；统计永远不许以写模式碰数据文件。
 *   3) **只读头部 / 尾部** —— 要元信息时先读文件头（或尾），拿不到再读全文。
 *      （wb-credits 实测：571 文件 / 462 MB 只读头部 = 42 ms。）
 *   4) **参数组合做不到就报错** —— 不静默降级成「看起来对」的结果。
 *   5) **缓存命中率口径加防护** —— 口径是 `cached ÷ input`；若实测 `cached > input`
 *      则自动切 `cached ÷ (input + cached)`，防真实边界（input 已含 cache 的口径混入）。
 *
 * ⚠️ 使用约定：本模块的函数**不做 I/O 之外的兜底猜测**。任何「拿不到就编一个」的写法
 *    都不属于这里；要兜底必须在调用点显式写明并留痕。
 */

const fs = require('fs');
const path = require('path');

/* ==================================================================== */
/* 纪律 1：数字错比报错糟糕                                             */
/* ==================================================================== */

/**
 * 结构化统计错误。抛出它 = 「我知道这里不对，宁可失败也不给一个错的数」。
 * code 用机器可判的短横线串，调用方（daemon 路由）据此决定 HTTP 状态码。
 */
function statsError(code, message, detail) {
  const error = new Error(String(message || '统计失败'));
  error.name = 'StatsError';
  error.code = String(code || 'stats-error');
  error.detail = detail === undefined ? null : detail;
  return error;
}

function isStatsError(error) {
  return !!error && error.name === 'StatsError' && typeof error.code === 'string';
}

/**
 * 结构断言：不匹配就抛 StatsError，**绝不返回一个「差不多」的值**。
 * @returns {true} 断言通过（方便 `return assertShape(...)` 直接用在表达式里）
 */
function assertShape(condition, code, message, detail) {
  if (!condition) throw statsError(code, message, detail);
  return true;
}

/** 拿不到就是拿不到：时间戳哨兵。**不要**用 `now`/`0`/`''` 代替它。 */
const UNKNOWN_TIMESTAMP = null;

/**
 * 解析时间戳：数字（秒 / 毫秒）、数字串、ISO 串。
 * 解析不出 ⇒ 返回 `UNKNOWN_TIMESTAMP`（= null），**不回落到现在**。
 * 回落成 `now` 会让「导入的历史用量」在时间轴上跳到今天，而且没人会去核对。
 */
function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return UNKNOWN_TIMESTAMP;
}

/** 依次尝试多个候选字段，全部拿不到 ⇒ null（调用点负责计数留痕，而不是填一个） */
function firstTimestamp(candidates) {
  for (const value of candidates || []) {
    const parsed = parseTimestamp(value);
    if (parsed !== UNKNOWN_TIMESTAMP) return parsed;
  }
  return UNKNOWN_TIMESTAMP;
}

/** 数值兜底：只认有限数字，其余返回 null（与 credit-usage-store 的 finiteNumber 同口径） */
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * 「无时间戳」留痕。调用点收集到 > 0 时应当**显式暴露**（面板/接口），
 * 这样总量与日期维度对不上时一眼能看出原因，而不是静默少一块。
 */
function makeUndatedLedger() {
  const ledger = { count: 0, tokens: 0, calls: 0 };
  ledger.add = function add(record) {
    ledger.count++;
    ledger.calls += finiteNumber(record && record.calls) || 1;
    ledger.tokens += (finiteNumber(record && record.input) || 0) + (finiteNumber(record && record.output) || 0);
    return ledger;
  };
  ledger.isEmpty = function isEmpty() { return ledger.count === 0; };
  return ledger;
}

/* ==================================================================== */
/* 纪律 2：只读打开                                                     */
/* ==================================================================== */

/**
 * node:sqlite `DatabaseSync` 的只读打开选项。
 * `fileMustExist: true` 是第二道闸：路径写错时**报错**，而不是**新建一个空库**
 * —— 后者会让统计读出「0 条记录」还一本正经地展示出来。
 */
function readonlySqliteOptions() {
  return { readOnly: true, fileMustExist: true };
}

/** 只读文件句柄（统计侧唯一允许的打开方式） */
function openReadOnly(file) {
  return fs.openSync(file, 'r');
}

const WRITE_MODE_OPEN = /openSync\s*\([^)]*,\s*['"](?!r['"])[^'"]*['"]/g;

/**
 * 静态扫描：找出源码里以**写模式**打开的调用点，供测试做反向守卫
 * （统计模块一旦出现写模式打开，纪律 2 就破了 —— 脚本会干扰运行中的客户端）。
 * @returns {string[]} 命中的代码片段
 */
function scanWriteModeOpens(source) {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const found = [];
  WRITE_MODE_OPEN.lastIndex = 0;
  let match;
  while ((match = WRITE_MODE_OPEN.exec(text))) {
    // 代码里出现 'r' 之外的第一个参数即视为写模式；注释里提到不算（只扫整行非注释）
    const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index));
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    found.push(line.trim().slice(0, 160));
  }
  return found;
}

/* ==================================================================== */
/* 纪律 3：只读头部 / 尾部                                              */
/* ==================================================================== */

/**
 * 读文件头：要元信息时先读这里，拿不到再读全文。
 *
 * ⚠️ `lineMode` 说明（2026-09-23 踩坑）：JSON 文件**没有换行**，如果照 jsonl 的做法
 * 「丢掉被截断的那一行」，`lastIndexOf('\n')` 会是 −1 ⇒ 整段被切成空串，
 * 表现为「头部探测永远失败、悄悄退化成全文读」。所以这里按用途分：
 *  - **尾部**（jsonl 场景）默认 `lineMode: true` —— 必须丢掉被截掉的首行，否则解析必炸；
 *  - **头部**（JSON/元信息场景）默认 `lineMode: false` —— 原样返回，不假设有换行。
 */
function readHead(file, maxBytes = 64 * 1024, options = {}) {
  return readWindow(file, maxBytes, 'head', options);
}

/** 读文件尾：只要「最近 N 条」时用这个（大会话 jsonl 可达 158 MB）。 */
function readTail(file, maxBytes = 8 * 1024 * 1024, options = {}) {
  return readWindow(file, maxBytes, 'tail', options);
}

function readWindow(file, maxBytes, side, options = {}) {
  const empty = { text: '', bytes: 0, windowBytes: 0, truncated: false, ok: false };
  const lineMode = options.lineMode === undefined ? side === 'tail' : !!options.lineMode;
  let fd = null;
  try {
    fd = openReadOnly(file);
    const size = fs.fstatSync(fd).size;
    const limit = Math.max(1, Number(maxBytes) || 0);
    const start = side === 'tail' ? (size > limit ? size - limit : 0) : 0;
    const length = Math.min(limit, size - start);
    const buffer = Buffer.allocUnsafe(length);
    if (length > 0) fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (lineMode && start > 0) {
      // 尾部窗口：丢掉被截断的首行
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
    return { text, bytes: size, windowBytes: length, truncated: length < size, ok: true };
  } catch (_) {
    return empty;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

/* ==================================================================== */
/* 纪律 4：参数组合做不到就报错                                         */
/* ==================================================================== */

/** 整数区间校验（越界 ⇒ 抛 bad-param，而不是夹紧后继续） */
function requireIntRange(value, min, max, label) {
  const number = finiteNumber(value);
  assertShape(number !== null, 'bad-param', `${label}必须是数字`, { label, value });
  assertShape(Number.isInteger(number), 'bad-param', `${label}必须是整数`, { label, value });
  assertShape(number >= min && number <= max, 'bad-param',
    `${label}必须在 ${min}–${max} 之间（实得 ${number}）`, { label, value: number, min, max });
  return number;
}

/** 枚举校验（不在集合内 ⇒ 抛 bad-param，而不是回落到默认值） */
function requireEnum(value, allowed, label) {
  const list = Array.isArray(allowed) ? allowed : [];
  const text = String(value === undefined || value === null ? '' : value);
  assertShape(list.includes(text), 'bad-param',
    `${label}只能是 ${list.join(' / ')}（实得 ${JSON.stringify(text)}）`, { label, value: text, allowed: list });
  return text;
}

/** 参数组合做不到就报错：`rejectUnsupported(ok, msg)` */
function rejectUnsupported(supported, code, message, detail) {
  assertShape(supported, code || 'bad-param', message, detail);
  return true;
}

/* ==================================================================== */
/* 纪律 5：缓存命中率口径加防护                                          */
/* ==================================================================== */

/**
 * 命中率明细。口径（本仓铁律）：
 *  - 正常：`cached ÷ input`（本仓 `input_tokens` **已含** `cache_read_input_tokens`）；
 *  - 防护：实测 `cached > input` ⇒ 切 `cached ÷ (input + cached)`，并把 `guarded` 置真，
 *    让调用方能把「这次换了分母」标出来，而不是给出一个 > 100% 的命中率。
 *  - `input <= 0` ⇒ 返回 null（**不是 0**）—— 没有分母就没有命中率，
 *    给 0 会被当成「缓存完全没命中」。
 */
function cacheHitRateDetail(cached, input) {
  const c = finiteNumber(cached);
  const i = finiteNumber(input);
  if (c === null || i === null || i <= 0) {
    return { rate: null, denominator: null, guarded: false, cached: c === null ? 0 : c, input: i === null ? 0 : i };
  }
  const guarded = c > i;
  return {
    rate: guarded ? c / (i + c) : c / i,
    denominator: guarded ? 'input+cached' : 'input',
    guarded,
    cached: c,
    input: i,
  };
}

/** 只要数值时用这个（等价于 `cacheHitRateDetail(...).rate`） */
function cacheHitRate(cached, input) {
  return cacheHitRateDetail(cached, input).rate;
}

/* ==================================================================== */
/* 杂项：与上列纪律配套的小工具                                          */
/* ==================================================================== */

/** 目录里按后缀递归收文件（不跟随符号链接，避免统计把链接目标算两遍） */
function walkFiles(dir, extension, options = {}) {
  const out = [];
  const maxFiles = Math.max(1, Number(options.maxFiles) || 20000);
  const skipNames = new Set(Array.isArray(options.skipNames) ? options.skipNames : []);
  const stack = [dir];
  while (stack.length && out.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (skipNames.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && (!extension || entry.name.endsWith(extension))) out.push(full);
    }
  }
  return out;
}

module.exports = {
  // 纪律 1
  statsError, isStatsError, assertShape, UNKNOWN_TIMESTAMP, parseTimestamp, firstTimestamp,
  finiteNumber, makeUndatedLedger,
  // 纪律 2
  readonlySqliteOptions, openReadOnly, scanWriteModeOpens,
  // 纪律 3
  readHead, readTail,
  // 纪律 4
  requireIntRange, requireEnum, rejectUnsupported,
  // 纪律 5
  cacheHitRate, cacheHitRateDetail,
  // 杂项
  walkFiles,
};
