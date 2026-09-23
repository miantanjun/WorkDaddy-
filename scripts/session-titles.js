'use strict';

/**
 * 会话标题解析器（用量看板「会话排行」用）。
 *
 * 为什么需要它（2026-09-23 定位）：
 *   看板的会话 id 来自官方 trace 的 `sessionId`，那是**会话的原始 id**；而 `workbuddy.db`
 *   的 `sessions` 表里存的是**各账号副本的 id** —— 切号自动复制会为目标账号新开一条会话
 *   （新 id、拷贝一份 jsonl），于是同一个会话在库里是一条条互不相同的行。
 *   两边对不上时，旧实现直接落成「未命名会话」，看起来跟乱码一样。
 *
 *   桥在哪里：副本 jsonl 的**文件名是副本 id**，但**内容里 `sessionId` 仍是原始 id**。
 *   所以「扫一遍 projects 下的 jsonl，把文件名与内嵌 sessionId 互记成别名」就能把
 *   原始 id 接回插件会话页认得的那些行。
 *
 * 解析顺序（先权威、后派生，任何一步命中即返回）：
 *   ① sessions 表（**插件会话页同源**）：id → `custom_title || title`
 *   ② 自动复制血缘（插件既有的会话身份体系）：同 lineage 的任一成员 id → ①
 *   ③ jsonl 桥：别名回指到有标题的 id → ①/②；再退一步用该文件里的 `aiTitle`
 *   ④ `logs/<date>/sdk/conversations/<id>.log` 的首条用户提问（官方自动标题本来就取它）
 *      —— 派生结果**必须脱敏**（提问里常带 AK/SK、口令），且只截断成一句标题
 *   ⑤ `usage-archive/sessions.json` 的历史标题
 *   全落空才返回空串，由界面显示占位（宁缺勿猜，不编造）。
 *
 * 只读、同步、结果按实例缓存；不要放进热路径逐条调用（首次会扫 jsonl 头尾）。
 */

const fs = require('fs');
const path = require('path');

/** 单文件只读头尾这么多字节：会话 id 在首条记录、aiTitle 在尾部快照里，够用且不看全文。 */
const PEEK_BYTES = 48 * 1024;
/** 由提问派生的标题截断长度（官方自动标题也是这个量级的一句话）。 */
const DERIVED_MAX = 60;

/**
 * 凭据打码。**只作用于④派生标题**：库里/归档里的标题是官方自己写的，不动。
 * 目的很实在：会话首条提问里经常直接贴 `SecretId:AKID...`，标题是最容易被截图外传的字段。
 */
const SECRET_RULES = [
  [/AKID[A-Za-z0-9]{6,}/g, 'AKID***'],
  [/ASIA[A-Za-z0-9]{6,}/g, 'ASIA***'],
  [/([Ss]ecret(?:Id|Key|Token)?\s*[:=：]\s*)\S+/g, '$1***'],
  [/([Aa]ccessKey(?:Id|Secret)?\s*[:=：]\s*)\S+/g, '$1***'],
  [/([Pp]ass(?:word|wd)?\s*[:=：]\s*)\S+/g, '$1***'],
  [/([Tt]oken\s*[:=：]\s*)\S+/g, '$1***'],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '***'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '***'],
  // 手机号：提问里「我的账号是 18xxx」这种极常见，标题又最容易被截图外传
  [/\b1[3-9]\d{9}\b/g, '1**********'],
];

function collapse(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function sanitizeTitle(value) {
  let text = collapse(value);
  if (!text) return '';
  for (const [re, to] of SECRET_RULES) text = text.replace(re, to);
  return collapse(text);
}

/**
 * 首条提问能不能当标题？官方自动标题就是「把首条提问截一段」，但有几类首条**不是用户的话**
 * （系统注入的提醒、任务通知、附件包裹），拿它当标题只会误导，直接放弃。
 */
function isUsablePrompt(text) {
  const t = collapse(text);
  if (t.length < 2) return false;
  if (t[0] === '<' || t[0] === '#') return false;
  if (/^(\{|\[)/.test(t)) return false;
  if (/task-notification|system-reminder|user-prompt-submit-hook|<user_query>$/i.test(t.slice(0, 120))) return false;
  if (/^[A-Za-z0-9+/=]{40,}$/.test(t)) return false;
  return true;
}

function truncate(value, max) {
  const t = collapse(value);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** 头尾各取一段（文件比 PEEK_BYTES*2 小就整读）。 */
function peek(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return ''; }
  if (stat.size <= PEEK_BYTES * 2) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
  }
  let head = '';
  let tail = '';
  try {
    const fd = fs.openSync(file, 'r');
    const hb = Buffer.alloc(PEEK_BYTES);
    const n1 = fs.readSync(fd, hb, 0, PEEK_BYTES, 0);
    head = hb.slice(0, n1).toString('utf8');
    const tb = Buffer.alloc(PEEK_BYTES);
    const n2 = fs.readSync(fd, tb, 0, PEEK_BYTES, stat.size - PEEK_BYTES);
    tail = tb.slice(0, n2).toString('utf8');
    fs.closeSync(fd);
  } catch (_) {
    return head;
  }
  return head + '\n' + tail;
}

/** 正则捕获到的是**已经转义好**的 JSON 字符串内容，直接补引号解析即可（不要再转义一遍）。 */
function jsonString(raw) {
  try { return JSON.parse('"' + raw + '"'); } catch (_) { return String(raw); }
}

function collectMatches(text, re, group) {
  const out = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m) {
    if (m[group]) out.push(m[group]);
    m = re.exec(text);
  }
  return out;
}

const RE_SESSION_ID = /"(?:sessionId|session_id|conversationId)"\s*:\s*"([^"]{4,})"/g;
const RE_AI_TITLE = /"aiTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * @param {object} options
 * @param {string} options.root      WorkBuddy 数据根（<home>/.workbuddy）
 * @param {string} [options.dataDir] WorkDaddy 数据目录（含 meta.json 血缘）；缺省用 %APPDATA%/WorkDaddy
 * @param {Map}    [options.dbTitles] 会话表标题：id → 标题字符串，或 id → {title, customTitle}
 */
function createSessionTitleResolver(options = {}) {
  const root = String(options.root || '');
  const dataDir = String(options.dataDir || path.join(process.env.APPDATA || '', 'WorkDaddy'));
  const dbTitles = options.dbTitles instanceof Map ? options.dbTitles : new Map();

  let index = null;
  const logCache = new Map();

  /** WorkDaddy 自己落的标题快照（只增不减）：官方清理掉会话行之后，名字还能从这儿补回来。 */
  function snapshotFile() {
    return path.join(dataDir, 'usage-board', 'session-title-snapshot.json');
  }

  /**
   * 标题统一出口：**所有来源都走一次脱敏**。
   * 官方自己生成的自动标题就是「首条提问截一段」，所以库里/缓存里的标题同样可能带
   * 手机号、AK/SK —— 看板是最容易被截图外传的界面，一律不原样输出。
   * （只动凭据/手机号这类片段，正常中文标题不受影响。）
   */
  function pushTitle(map, id, title) {
    const key = String(id || '');
    const value = sanitizeTitle(cleanTitle(title));
    if (!key || !value) return;
    if (!map.has(key)) map.set(key, value);
  }

  function cleanTitle(value) {
    if (value && typeof value === 'object') {
      return collapse(value.customTitle || value.custom_title || value.title || '');
    }
    return collapse(value);
  }

  /**
   * 把两个 id 记成「同一个会话的别名」（并查集式合并：合并后组内任意 id 都能互相回指）。
   * 血缘与 jsonl 桥共用这一份实现，合并语义必须一致，否则会出现单向别名。
   */
  function link(aliasOf, left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (!a || !b) return;
    if (!aliasOf.has(a)) aliasOf.set(a, new Set([a]));
    if (!aliasOf.has(b)) aliasOf.set(b, new Set([b]));
    const ga = aliasOf.get(a);
    const gb = aliasOf.get(b);
    if (ga === gb) return;
    for (const id of gb) ga.add(id);
    for (const id of gb) aliasOf.set(id, ga);
  }

  function build() {
    if (index) return index;
    const direct = new Map();
    const aliasOf = new Map();
    const fileTitle = new Map();
    const archive = new Map();

    for (const [id, value] of dbTitles) pushTitle(direct, id, value);

    // ② 自动复制血缘：sessions[lineage].members[].id / sessionIndex / copies[].targetId
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
      const ac = (meta && meta.autoCopy) || {};
      const lineages = ac.sessions && typeof ac.sessions === 'object' ? ac.sessions : {};
      for (const lineageId of Object.keys(lineages)) {
        const members = Array.isArray(lineages[lineageId] && lineages[lineageId].members)
          ? lineages[lineageId].members : [];
        for (const member of members) {
          if (member && member.id) link(aliasOf, lineageId, String(member.id));
        }
        link(aliasOf, lineageId, lineageId);
      }
      const copies = ac.copies && typeof ac.copies === 'object' ? ac.copies : {};
      for (const key of Object.keys(copies)) {
        let pair = null;
        try { pair = JSON.parse(key); } catch (_) { pair = null; }
        const lineageId = pair && pair[0];
        const targetId = copies[key] && copies[key].targetId;
        if (lineageId && targetId) link(aliasOf, String(lineageId), String(targetId));
      }
      const sessionIndex = ac.sessionIndex && typeof ac.sessionIndex === 'object' ? ac.sessionIndex : {};
      for (const uid of Object.keys(sessionIndex)) {
        const bucket = sessionIndex[uid] || {};
        for (const sid of Object.keys(bucket)) {
          if (bucket[sid]) link(aliasOf, String(bucket[sid]), String(sid));
        }
      }
    } catch (_) { /* 没有 meta.json 就只靠 ①③④⑤ */ }

    // ③ jsonl 桥：文件名 id ↔ 内嵌 sessionId；顺带收 aiTitle
    const projects = path.join(root, 'projects');
    let slugs = [];
    try { slugs = fs.readdirSync(projects, { withFileTypes: true }); } catch (_) { slugs = []; }
    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      let files = [];
      try { files = fs.readdirSync(path.join(projects, slug.name)); } catch (_) { continue; }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const fileId = name.slice(0, -'.jsonl'.length);
        const text = peek(path.join(projects, slug.name, name));
        if (!text) continue;
        const embedded = collectMatches(text, RE_SESSION_ID, 1);
        const titles = collectMatches(text, RE_AI_TITLE, 1).map(jsonString).map(collapse).filter(Boolean);
        const aiTitle = titles.length ? titles[titles.length - 1] : '';
        if (aiTitle) {
          pushTitle(fileTitle, fileId, aiTitle);
          for (const id of embedded) pushTitle(fileTitle, id, aiTitle);
        }
        for (const id of embedded) {
          const other = collapse(id);
          if (!other || other === fileId) continue;
          link(aliasOf, fileId, other);
        }
      }
    }

    // ③ 历史标题（都算「保存下来的真标题」，比⑥派生的可信）：
    //    · usage-archive/sessions.json —— 抽取器归档的
    //    · session-title-snapshot.json —— **WorkDaddy 自己落的**快照（见 mergeTitleSnapshot）
    const saved = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, 'usage-archive', 'sessions.json'), 'utf8'));
      for (const sid of Object.keys(j || {})) pushTitle(saved, sid, (j[sid] || {}).title);
    } catch (_) { /* 归档缺失不是错误 */ }
    try {
      const s = JSON.parse(fs.readFileSync(snapshotFile(), 'utf8'));
      const titles = (s && s.titles) || {};
      for (const sid of Object.keys(titles)) pushTitle(saved, sid, titles[sid]);
    } catch (_) { /* 首次运行没有快照 */ }

    index = { direct, aliasOf, fileTitle, saved };
    return index;
  }

  /** 客户端缓存里那份「更早的 /api/sessions 快照」——只在前面全落空时才读（见 resolve）。 */
  function fromClientCache(sessionId) {
    const needle = Buffer.from(String(sessionId || ''), 'utf8');
    if (!needle.length) return '';
    const cacheDir = path.join(root, 'app', 'session', 'Cache', 'Cache_Data');
    let files = [];
    try { files = fs.readdirSync(cacheDir); } catch (_) { return ''; }
    for (const name of files) {
      if (!/^data_\d+$/.test(name)) continue;
      let buf;
      try { buf = fs.readFileSync(path.join(cacheDir, name)); } catch (_) { continue; }
      const at = buf.indexOf(needle);
      if (at < 0) continue;
      // 命中的是 WorkDaddy 自己 /api/sessions 响应里的那一行（含 title/custom_title），
      // 按 id 精确匹配取同一对象里的标题，不做任何模糊关联。
      const seg = buf.slice(Math.max(0, at - 40), Math.min(buf.length, at + 900)).toString('utf8');
      const custom = seg.match(/"custom_title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const plain = seg.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const pick = collapse(custom ? jsonString(custom[1]) : '') || collapse(plain ? jsonString(plain[1]) : '');
      if (pick) return sanitizeTitle(pick);
    }
    return '';
  }

  /** ④ 从 SDK 会话日志里取首条用户提问，派生一句标题（脱敏 + 截断）。 */
  function derivedFromLog(sessionId) {
    const id = String(sessionId || '');
    if (!id) return '';
    if (logCache.has(id)) return logCache.get(id);
    let result = '';
    const logsDir = path.join(root, 'logs');
    let days = [];
    try { days = fs.readdirSync(logsDir).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort(); } catch (_) { days = []; }
    for (const day of days) {
      const file = path.join(logsDir, day, 'sdk', 'conversations', id + '.log');
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
      const at = text.indexOf('"userContent"');
      if (at < 0) continue;
      const window = text.slice(at, at + 8000);
      const m = window.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const raw = m ? jsonString(m[1]) : '';
      const picked = raw.match(/<user_query>([\s\S]*?)<\/user_query>/);
      const candidate = collapse(picked ? picked[1] : raw);
      if (isUsablePrompt(candidate)) { result = truncate(sanitizeTitle(candidate), DERIVED_MAX); break; }
    }
    logCache.set(id, result);
    return result;
  }

  /** @returns {{title:string, source:string}} source ∈ db|lineage|saved|jsonl|client-cache|first-prompt|none */
  function resolve(sessionId) {
    const id = collapse(sessionId);
    if (!id) return { title: '', source: 'none' };
    const { direct, aliasOf, fileTitle, saved } = build();
    const own = direct.get(id);
    if (own) return { title: own, source: 'db' };
    const group = aliasOf.get(id);
    if (group) {
      for (const other of group) {
        const t = direct.get(other);
        if (t) return { title: t, source: 'lineage' };
      }
    }
    const kept = saved.get(id);
    if (kept) return { title: kept, source: 'saved' };
    const fromFile = fileTitle.get(id);
    if (fromFile) return { title: fromFile, source: 'jsonl' };
    const fromCache = fromClientCache(id);
    if (fromCache) return { title: fromCache, source: 'client-cache' };
    const derived = derivedFromLog(id);
    if (derived) return { title: derived, source: 'first-prompt' };
    return { title: '', source: 'none' };
  }

  /** 给界面写口径说明用：解析器到底挂了哪些源、有多少条可用标题。 */
  function describe() {
    const { direct, aliasOf, fileTitle, saved } = build();
    return {
      dbTitles: direct.size,
      savedTitles: saved.size,
      jsonlTitles: fileTitle.size,
      aliases: aliasOf.size,
    };
  }

  return { resolve, describe, dataDir };
}

/**
 * 把「真标题」并进 WorkDaddy 自己的快照（只增不减；已有条目不被空串或更差的覆盖）。
 * 为什么必须落这份：官方只保留 30 天逐笔明细、清理会话时会**连 sessions 行一起删**，
 * 而标题只存在于那一行里 —— 不在还看得见的时候抄一份，之后就永久丢了（本次 12/15 就是这么丢的）。
 * @param {string} dataDir WorkDaddy 数据目录
 * @param {Iterable<[string,string]>|object} entries id → 标题
 */
function mergeTitleSnapshot(dataDir, entries) {
  const file = path.join(String(dataDir || ''), 'usage-board', 'session-title-snapshot.json');
  if (!dataDir) return { written: 0, total: 0 };
  let current = {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j.titles === 'object' && j.titles) current = j.titles;
  } catch (_) { current = {}; }
  const before = Object.keys(current).length;
  const pairs = entries instanceof Map ? Array.from(entries.entries())
    : (Array.isArray(entries) ? entries : Object.entries(entries || {}));
  for (const pair of pairs) {
    const id = collapse(pair && pair[0]);
    const title = collapse(pair && pair[1]);
    if (!id || !title) continue;
    if (!current[id]) current[id] = title;
  }
  const total = Object.keys(current).length;
  if (total !== before) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: Date.now(), titles: current }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (_) { return { written: 0, total: before }; }
  }
  return { written: total - before, total };
}

module.exports = { createSessionTitleResolver, mergeTitleSnapshot, sanitizeTitle, isUsablePrompt, truncate };
