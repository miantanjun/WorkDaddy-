'use strict';

/**
 * 模型切换守卫 —— 只读提醒，不参与发请求。
 *
 * ## 它解决的问题（2026-10-29 实测确认）
 *
 * 客户端在「报错后重新发送」这条路径上**不带**模型参数：日志里
 * `requestOptions.model=<none>`，于是回落到会话默认模型 —— 也就是报错时那个旧模型。
 * 结果：界面上模型已经换到别家，重发却还打到原来那家，拿回一模一样的报错，
 * 观感就是「切换无效」。只有新建会话、或重启客户端（CLI 用持久化设置重起）
 * 才会真正用上新模型。
 *
 * 客户端本体不能改（会被官方更新覆盖），所以这里只做**提醒**：从客户端自己的
 * 日志里取证，发现「切了模型但请求仍发往旧模型并且失败了」就报一次，建议新建会话。
 *
 * ## 为什么读日志，而不看 DOM
 *
 * 错误块用的是 constructable stylesheet + CSS Modules hash，类名不可枚举
 * （2026-10-29 实测：遍历 cssRules 筛不出任何带 hash 的 error 类）。
 * 而日志里这三行是逐字节可验证的：
 *
 *     unstable_setSessionModel called: ... modelId=custom-local:cn:deepseek-v4.1-flash
 *     Sending request: ... model=deepseek-v4.1-flash, ... url=https://www.workbuddy.cn/...
 *     refusal classified: ... httpStatus=429, bizCode=6004 ...
 *
 * 第一行「想用的」、第二行「实际发的」、第三行「确实失败了」。三者连起来才是判据。
 *
 * ## 判据的精度（4 天真实日志回放）
 *
 * SET=118 / REQ=3567，只命中 5 次，且全部带错误码；276 次正常切换零误报。
 * 命中的 5 次正是用户报障的现场（10-29 09:06:41 / 09:07:00 / 09:07:53、
 * 10-28 15:11:15 / 15:12:51）。
 *
 * ## 为什么只提醒、不自动补救
 *
 * 自动补救（把切换指令补发到真正的运行时会话 id 上）需要拦客户端内部的 ACP 调用，
 * 属于「站调度层」，与插件既定的「配置层 + 指令层 + 观测层」边界冲突，且一旦客户端
 * 内部 id 映射变化就会静默失效。提醒的成本为零，误报最坏情况也只是一句「建议新建会话」。
 */

const fs = require('fs');
const path = require('path');

const GUARD_FILENAME = 'model-switch-guard.json';

// 缺文件 / 坏文件时的默认值：开。提醒是纯提示，误报也不会造成损失，缺省关掉反而
// 让用户继续在「切了没用」里耗时间。
const DEFAULT_ENABLED = true;

// 只读日志尾部：一次重发最多涉及几 KB，384KB 足够覆盖几十分钟的密集操作。
const TAIL_BYTES = 384 * 1024;
// 只看最近两个日期目录（跨零点时昨天那个还得看）。
const SCAN_DIRS = 2;
// 每次最多解析 8 个会话日志（多会话并存时按 mtime 倒序取）。
const MAX_FILES = 8;
// 只解析最近 20 分钟内被写过的日志文件，老文件直接跳过。
const ACTIVE_WINDOW_MS = 20 * 60 * 1000;
// 命中的时效：3 分钟内刚发生的才值得弹提醒，避免把早上的旧账翻出来。
const FRESH_WINDOW_MS = 3 * 60 * 1000;
// 定时任务等非用户触发的请求，模型名固定，不参与判定。
const IGNORED_MODELS = new Set(['wb-lite']);
// 请求之后几条事件内出现错误，才算「这次重发失败了」。
const ERROR_LOOKAHEAD = 6;

const TS_RE = /^\[(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/;

function toMs(m) {
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime();
}

/** 去掉客户端自加的 `custom-local:` 前缀 —— SET 带、Sending request 不一定带。 */
function normalizeModel(value) {
  return String(value == null ? '' : value).replace(/^custom-local:/, '').trim();
}

/**
 * 把日志文本切成事件序列。只认三种行：
 *   set — unstable_setSessionModel（用户切了模型）
 *   req — Sending request（真发出去的请求）
 *   err — refusal classified（这次请求失败了）
 */
function parseLogEvents(text) {
  const out = [];
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = TS_RE.exec(line);
    if (!m) continue;
    const at = toMs(m);
    let x;
    if ((x = /unstable_setSessionModel called:.*?modelId=(\S+)/.exec(line))) {
      out.push({ at, kind: 'set', model: x[1] });
    } else if ((x = /Sending request: .*?model=([^,\s]+).*?url=(\S+)/.exec(line))) {
      out.push({ at, kind: 'req', model: x[1], url: x[2] });
    } else if (/refusal classified:/.test(line)) {
      // 有的分类日志不带 bizCode / httpStatus（比如本地异常），仍然算一次失败。
      out.push({
        at,
        kind: 'err',
        status: (x = /httpStatus=(\d+)/.exec(line)) ? +x[1] : 0,
        code: (x = /bizCode=(-?\d+)/.exec(line)) ? +x[1] : 0,
      });
    }
  }
  return out;
}

/**
 * 在事件序列里找「切了模型却仍发往旧模型、并且失败了」的组合。
 * 返回最后一条命中，没有则 null。
 *
 * 配对规则：一次 set 之后的第一条 req 就是这次切换的检验点 ——
 *   · 模型一致   → 切换生效，丢弃这组
 *   · 模型不一致 → 再看后面几条里有没有 err；有才是真命中
 * 不一致但请求成功的情况（比如旧线路自己恢复了）不提醒：用户没受影响。
 */
function detectSwitchMismatch(events) {
  const list = Array.isArray(events) ? events : [];
  let pending = null;
  let last = null;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    if (ev.kind === 'set') { pending = ev; continue; }
    if (ev.kind !== 'req' || !pending) continue;
    const wanted = normalizeModel(pending.model);
    const used = normalizeModel(ev.model);
    if (!used || IGNORED_MODELS.has(used) || used === wanted) { pending = null; continue; }
    let err = null;
    for (let j = i + 1; j < list.length && j <= i + ERROR_LOOKAHEAD; j++) {
      if (list[j].kind === 'err') { err = list[j]; break; }
      if (list[j].kind === 'req') break;
    }
    if (err) {
      last = {
        at: pending.at,
        errorAt: err.at,
        wanted,
        used,
        url: String(ev.url || ''),
        status: err.status,
        code: err.code,
      };
    }
    pending = null;
  }
  return last;
}

/** 读文件尾部（按行对齐），返回文本与 stat，供缓存键使用。 */
function readTail(file, maxBytes) {
  const st = fs.statSync(file);
  const size = st.size;
  if (!size) return { text: '', mtimeMs: st.mtimeMs, size: 0 };
  const len = Math.min(maxBytes, size);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  // 从中间切入时首行一定残破，丢掉。
  if (len < size) {
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }
  return { text, mtimeMs: st.mtimeMs, size };
}

/**
 * 列出值得解析的会话日志。文件名形如 `<工作区名>__<hash>.log`，
 * 主线程日志 `<谁>workbuddyMainThread__<hash>.log` 里没有模型事件，一并不需要特判 ——
 * 解析出来自然是空的，只是白读一次尾部。
 */
function collectLogFiles(logsRoot, now, activeWindowMs) {
  // 活跃窗口默认 20 分钟；排查时可能要求往前看更久，由调用方放宽。
  const active = typeof activeWindowMs === 'number' && activeWindowMs > 0 ? activeWindowMs : ACTIVE_WINDOW_MS;
  let days;
  try {
    days = fs.readdirSync(logsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-SCAN_DIRS);
  } catch (e) {
    return [];
  }
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const dir = path.join(logsRoot, days[i]);
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (let k = 0; k < names.length; k++) {
      const name = names[k];
      if (!name.endsWith('.log') || name.indexOf('__') < 0) continue;
      const file = path.join(dir, name);
      let st;
      try { st = fs.statSync(file); } catch (e) { continue; }
      if (now - st.mtimeMs > active) continue;
      out.push({ file, name, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, MAX_FILES);
}

// 解析结果按 (路径 + mtime + 大小) 缓存：日志只在追加时变，键一变就重算。
// 上限 64 项，够覆盖一天里切来切去的会话，又不会无限涨。
const parseCache = new Map();
const PARSE_CACHE_MAX = 64;

function parseFileCached(file) {
  const st = fs.statSync(file);
  const key = file + ':' + st.mtimeMs + ':' + st.size;
  const hit = parseCache.get(key);
  if (hit) return hit;
  const tail = readTail(file, TAIL_BYTES);
  const events = parseLogEvents(tail.text);
  parseCache.set(key, events);
  if (parseCache.size > PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value;
    parseCache.delete(oldest);
  }
  return events;
}

/**
 * 扫一遍日志，返回最近一次「切换无效」命中。
 * 任何异常都吞掉并返回空结果 —— 提醒功能不该成为新的故障源。
 */
function scanModelSwitch(logsRoot, options) {
  const opts = options || {};
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const freshWindow = typeof opts.freshWindowMs === 'number' ? opts.freshWindowMs : FRESH_WINDOW_MS;
  let files = [];
  // 要看多久以前的命中，就得解析多久以内写过的文件；取两者较大值。
  const activeWindow = Math.max(ACTIVE_WINDOW_MS, freshWindow);
  try { files = collectLogFiles(logsRoot, now, activeWindow); } catch (e) { files = []; }
  let best = null;
  for (let i = 0; i < files.length; i++) {
    let events;
    try { events = parseFileCached(files[i].file); } catch (e) { continue; }
    if (!events.length) continue;
    const hit = detectSwitchMismatch(events);
    if (!hit) continue;
    const at = hit.errorAt || hit.at;
    if (now - at > freshWindow) continue;
    if (!best || at > (best.errorAt || best.at)) {
      best = Object.assign({}, hit, { logFile: files[i].name });
    }
  }
  return { hit: best, scanned: files.length, at: now };
}

function guardPolicyPath(dataDir) {
  return path.join(dataDir, GUARD_FILENAME);
}

function readGuardPolicy(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(guardPolicyPath(dataDir), 'utf8'));
    if (raw && typeof raw.enabled === 'boolean') {
      return { enabled: raw.enabled, source: 'file', updatedAt: raw.updatedAt || '' };
    }
    return { enabled: DEFAULT_ENABLED, source: 'default', updatedAt: '' };
  } catch (e) {
    return { enabled: DEFAULT_ENABLED, source: 'default', updatedAt: '' };
  }
}

function writeGuardEnabled(dataDir, enabled) {
  const payload = { enabled: !!enabled, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) { /* 已存在 */ }
  const target = guardPolicyPath(dataDir);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return payload;
}

module.exports = {
  DEFAULT_ENABLED,
  FRESH_WINDOW_MS,
  normalizeModel,
  parseLogEvents,
  detectSwitchMismatch,
  readTail,
  collectLogFiles,
  scanModelSwitch,
  guardPolicyPath,
  readGuardPolicy,
  writeGuardEnabled,
};
