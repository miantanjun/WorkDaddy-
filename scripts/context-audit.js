'use strict';

/**
 * 上下文体检（context-audit）——把「烧 token 的地方」变成可测量、可执行的清单。
 *
 * 为什么需要它：WorkDaddy 已有 `/api/token-stats` 告诉你「花了多少」，但回答不了
 * 「**花在哪、能不能省、怎么省**」。实测（2026-09-22，7 天）：
 *   总输入 15.2 亿 token，其中**单会话 8,516 轮占 75%**；每次调用中位上下文 17.1 万 token；
 *   输出只有 832（说明成本在「上下文体积 × 轮次」，不在「模型话多」）。
 *
 * 本模块只做三件事，全部是**本地只读测量 + 给出动作**：
 *   ① 记忆/身份文件体积（常驻，每个会话都付一次）
 *   ② skill 目录体积（常驻 frontmatter + 按需 body）；找出超标的 SKILL.md、
 *      重复的版本目录、超长的 description
 *   ③ 会话成本形状（轮次 / 累计输入 / 重发倍率），揪出「几千轮的怪物会话」
 *
 * 设计约束：
 *   - **纯测量，不写盘、不发网络**（`auditContext` 返回值即全部产出）。
 *   - 所有路径与阈值可注入，方便回归里造 fixture；不给参数时读真实机器。
 *   - 会话扫描只读 usage 数字，**不读任何消息正文**；复用 `token-stats.js` 的公开
 *     `walkJsonl` / `findUsage`，避免两套解析逻辑漂移。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash } = require('node:crypto');
const tokenStats = require('./token-stats.js');

// 阈值的依据：
//   - skill body：官方 skill-creator 的 Progressive Disclosure 规范是 Level 2 < 5k words
//     （约 33k 字符），500 行是社区通行红线；这里取 60KB / 500 行做 warn。
//   - description：官方对 description 的注入有截断，社区实测 1,536 字符；超了就是白写。
//   - 记忆：官方建议 SKILL.md/记忆文件都当「索引」而不是百科，8KB 是个够宽松的线。
//   - 会话：轮次与累计输入直接决定「历史重发」的总量。
const THRESHOLDS = {
  skillBodyBytes: { warn: 60 * 1024, crit: 150 * 1024 },
  skillBodyLines: { warn: 500, crit: 1500 },
  skillDescriptionChars: { warn: 700, crit: 1536 },
  memoryBytes: { warn: 8 * 1024, crit: 16 * 1024 },
  sessionTurns: { warn: 200, crit: 800 },
  sessionInputTokens: { warn: 50e6, crit: 200e6 },
  refanoutRatio: { warn: 10, crit: 30 },
};

const USAGE_FIELDS = {
  input: ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'],
  output: ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'],
};

function levelOf(value, threshold) {
  const number = Number(value) || 0;
  if (!threshold) return 'ok';
  if (number >= threshold.crit) return 'crit';
  if (number >= threshold.warn) return 'warn';
  return 'ok';
}

function numberField(value, fields) {
  for (const field of fields) {
    const number = Number(value && value[field]);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function safeStat(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch (_) {
    return null;
  }
}

function countLines(file, size) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    let lines = 1;
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lines += 1;
    return { lines, chars: text.length };
  } catch (_) {
    // 读不出来时按字节粗估，宁可保守也不要抛错打断体检
    return { lines: Math.max(1, Math.round((Number(size) || 0) / 40)), chars: Number(size) || 0 };
  }
}

/** 解析 YAML frontmatter 里的 name / description（支持 `>`、`|` 块标量）。 */
function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!match) return { name: '', description: '' };
  const body = match[1];
  const lines = body.split(/\r?\n/);
  let name = '';
  let description = '';
  for (let i = 0; i < lines.length; i += 1) {
    const nameMatch = /^name:\s*(.+)$/.exec(lines[i]);
    if (nameMatch) { name = nameMatch[1].trim(); continue; }
    const descMatch = /^description:\s*(.*)$/.exec(lines[i]);
    if (!descMatch) continue;
    const inline = descMatch[1].trim();
    if (inline && inline !== '>' && inline !== '|' && inline !== '>-' && inline !== '|-') {
      description = inline;
      continue;
    }
    const block = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[j])) break;
      if (!lines[j].trim()) continue;
      block.push(lines[j].trim());
    }
    description = block.join(' ');
  }
  return { name, description };
}

/** 遍历若干根目录，收集全部 SKILL.md 的体积信息。 */
function listSkills(roots, options) {
  const maxDepth = Number((options && options.maxDepth) || 8);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (entry.name !== 'SKILL.md') continue;
      const stat = safeStat(full);
      if (!stat) continue;
      const measured = countLines(full, stat.size);
      let frontmatter = { name: '', description: '' };
      try { frontmatter = readFrontmatter(fs.readFileSync(full, 'utf8').slice(0, 8000)); } catch (_) { /* 读不到就留空 */ }
      out.push({
        name: frontmatter.name || path.basename(path.dirname(full)),
        file: full,
        dir: path.dirname(full),
        bytes: stat.size,
        lines: measured.lines,
        descriptionChars: String(frontmatter.description || '').length,
      });
    }
  };
  for (const root of (roots || [])) walk(root, 0);
  out.sort((a, b) => b.bytes - a.bytes);
  return out;
}

/** 记忆/身份文件体积（这些是**每个会话都常驻**的）。 */
function auditMemory(files) {
  const items = [];
  let totalBytes = 0;
  for (const file of (files || [])) {
    if (!file || !file.path) continue;
    const stat = safeStat(file.path);
    const bytes = stat ? stat.size : 0;
    if (!stat) {
      items.push({ label: file.label || '', path: file.path, bytes: 0, present: false, level: 'ok' });
      continue;
    }
    totalBytes += bytes;
    items.push({
      label: file.label || '',
      path: file.path,
      bytes,
      present: true,
      level: levelOf(bytes, file.threshold || THRESHOLDS.memoryBytes),
    });
  }
  return { items, totalBytes };
}

/**
 * 会话成本形状。**只看 usage 数字**：
 *   - turns     该会话的模型调用次数
 *   - input     累计输入 token（= 历史被反复重发的总量）
 *   - lastInput 末轮输入（≈ 该会话「稳定态」的上下文体积）
 *   - ratio     input / lastInput，历史被重复发送的倍率
 *
 * 去重口径与 `token-stats.js` 的 `distinctRecords` 一致：整行 digest + 出现序号，
 * 这样切号自动复制产生的副本不会被算成「又调了一次模型」。
 */
function scanSessions(root, options) {
  const opts = options || {};
  const days = Math.max(1, Number(opts.days) || 7);
  const lowerBound = Number(opts.lowerBound) || (Date.now() - days * 86400000);
  const files = Array.isArray(opts.files) ? opts.files : tokenStats.walkJsonl(root, opts.maxFiles || 5000);
  const seen = new Map();
  const bySession = new Map();
  let copies = 0;

  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const local = new Map();
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch (_) { continue; }
      if (!record || typeof record !== 'object' || record.isSnapshotUpdate) continue;
      const usage = tokenStats.findUsage(record.message && record.message.usage)
        || tokenStats.findUsage(record.providerData && record.providerData.usage)
        || tokenStats.findUsage(record);
      if (!usage) continue;
      const input = numberField(usage, USAGE_FIELDS.input);
      if (!input) continue;
      const timestamp = Number(record.timestamp) || Date.parse(record.timestamp || record.created_at || record.createdAt || '') || 0;
      if (timestamp && timestamp < lowerBound) continue;
      const digest = createHash('sha256').update(JSON.stringify(record)).digest('hex');
      const occurrence = (local.get(digest) || 0) + 1;
      local.set(digest, occurrence);
      const key = digest + ':' + occurrence;
      if (seen.has(key)) { copies += 1; continue; }
      seen.set(key, true);
      rows.push({ timestamp, input });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.timestamp - b.timestamp);
    const input = rows.reduce((sum, row) => sum + row.input, 0);
    const lastInput = rows[rows.length - 1].input;
    bySession.set(path.basename(file, '.jsonl'), {
      id: path.basename(file, '.jsonl'),
      turns: rows.length,
      input,
      firstInput: rows[0].input,
      lastInput,
      ratio: lastInput > 0 ? input / lastInput : 0,
    });
  }

  const sessions = Array.from(bySession.values()).sort((a, b) => b.input - a.input);
  return {
    sessions,
    copies,
    totalInput: sessions.reduce((sum, item) => sum + item.input, 0),
  };
}

function auditContext(options) {
  const opts = options || {};
  const days = Math.max(1, Math.min(90, Number(opts.days) || 7));
  const home = opts.home || os.homedir();
  const skillsRoots = opts.skillsRoots || [
    path.join(home, '.workbuddy', 'skills'),
    path.join(home, '.workbuddy', 'plugins', 'cache'),
  ];
  const memoryFiles = opts.memoryFiles || [
    { label: '用户级长期记忆', path: path.join(home, '.workbuddy', 'MEMORY.md') },
    { label: '身份 SOUL', path: path.join(home, '.workbuddy', 'SOUL.md') },
    { label: '身份 IDENTITY', path: path.join(home, '.workbuddy', 'IDENTITY.md') },
    { label: '身份 USER', path: path.join(home, '.workbuddy', 'USER.md') },
  ];
  const memory = auditMemory(memoryFiles);
  const skills = listSkills(skillsRoots, opts);

  // 同名 skill 出现在多个版本目录里。⚠️ 2026-09-22 实测证伪：宿主只注入
  // installed_plugins.json 里 installPath 指向的那个版本，这几份**不重复占 token**，
  // 纯粹是磁盘残留（诊断报告 §八）。
  const byName = new Map();
  for (const skill of skills) {
    const list = byName.get(skill.name) || [];
    list.push(skill);
    byName.set(skill.name, list);
  }
  const duplicates = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    duplicates.push({
      name,
      count: list.length,
      bytes: list.reduce((sum, item) => sum + item.bytes, 0),
      dirs: list.map((item) => item.dir),
    });
  }
  duplicates.sort((a, b) => b.bytes - a.bytes);

  const oversized = skills.filter((skill) =>
    levelOf(skill.bytes, THRESHOLDS.skillBodyBytes) !== 'ok'
    || levelOf(skill.lines, THRESHOLDS.skillBodyLines) !== 'ok');
  const longDescriptions = [];
  const seenDescriptionName = new Set();
  for (const skill of skills) {
    if (levelOf(skill.descriptionChars, THRESHOLDS.skillDescriptionChars) === 'ok') continue;
    // 同名 skill 有多个版本目录时只报一次（否则同一条会刷屏）
    if (seenDescriptionName.has(skill.name)) continue;
    seenDescriptionName.add(skill.name);
    longDescriptions.push(skill);
  }

  // `token-stats.walkJsonl(root)` 内部拼的是 `<root>/projects`，所以这里必须传
  // **WorkBuddy 数据根**（~/.workbuddy），不能传 home —— 传 home 会扫到空目录、
  // 会话维度静默全为零（本模块第一版就是这么错的，回归里有断言钉着）。
  const sessionRoot = opts.sessionRoot === null
    ? null
    : (opts.sessionRoot || path.join(home, '.workbuddy'));
  const sessionScan = (sessionRoot === null || opts.sessionFiles === null)
    ? { sessions: [], copies: 0, totalInput: 0 }
    : scanSessions(sessionRoot, { days, maxFiles: opts.maxFiles, files: opts.sessionFiles });

  const heavySessions = sessionScan.sessions.filter((item) =>
    levelOf(item.turns, THRESHOLDS.sessionTurns) !== 'ok'
    || levelOf(item.input, THRESHOLDS.sessionInputTokens) !== 'ok'
    || levelOf(item.ratio, THRESHOLDS.refanoutRatio) !== 'ok');

  const findings = [];
    const push = (severity, key, title, detail, action, fix) =>
      findings.push({ severity, key, title, detail, action, fix: fix || null });

  // ---- 记忆 ----
  for (const item of memory.items) {
    if (item.level === 'ok') continue;
    push(item.level, 'memory:' + item.path, '常驻记忆偏大：' + (item.label || path.basename(item.path)),
      `${item.bytes} bytes（warn ≥ ${THRESHOLDS.memoryBytes.warn}，crit ≥ ${THRESHOLDS.memoryBytes.crit}）。` +
      '这个文件**每个会话都会注入**，且之后每轮都随历史重发。',
      '当作索引精简：只留「不看会做错」的硬约束，过程性细节下沉到工作区日志或 skill 的 references/。',
      { kind: 'paste', prompt: '帮我把 ' + item.path + ' 精简成索引式文件：只留「不看会做错」的硬约束（红线 / 判据 / 路径），过程性细节挪到工作区日志或 skill 的 references/。先给我精简方案，确认后再动手。' });
  }

  // ---- skill body ----
  for (const skill of oversized.slice(0, 8)) {
    const severity = (levelOf(skill.bytes, THRESHOLDS.skillBodyBytes) === 'crit'
      || levelOf(skill.lines, THRESHOLDS.skillBodyLines) === 'crit') ? 'crit' : 'warn';
    push(severity, 'skill:' + skill.file, 'SKILL.md 过大：' + skill.name,
      `${skill.bytes} bytes / ${skill.lines} 行（官方 Progressive Disclosure 建议 Level 2 body < 5k words，约 500 行）。` +
      '被加载时整篇进上下文，之后每轮都重发。',
      '按主题拆到同目录 references/*.md，SKILL.md 只留索引 + 铁律 + 工作流，并加一张「旧编号 → 文件」映射表。',
      { kind: 'paste', prompt: '把 ' + skill.file + ' 拆成 references/ 结构：主文件只留索引 + 铁律 + 工作流，细节按主题进 references/*.md，并加一张「旧编号 → 文件」映射表。照 workdaddy-maintain 那次的手法（可重复执行的拆分脚本 + 完整性校验，.bak 为源）。' });
  }

  // ---- skill 描述 ----
  for (const skill of longDescriptions.slice(0, 5)) {
    push(levelOf(skill.descriptionChars, THRESHOLDS.skillDescriptionChars), 'desc:' + skill.file,
      'skill description 过长：' + skill.name,
      `${skill.descriptionChars} 字符（注入有截断，超出的部分不生效）。`,
      '把最重要的触发词放到最前面，其余压到 300 字符以内。',
      { kind: 'paste', prompt: '把 ' + skill.file + ' 的 frontmatter description 压到 300 字符以内，最重要的触发词放最前面，其余改成短标签。' });
  }

  // ---- 重复版本目录 ----
  for (const item of duplicates.slice(0, 5)) {
    push('warn', 'dupe:' + item.name, '同名 skill 有 ' + item.count + ' 份：' + item.name,
      `合计 ${item.bytes} bytes：${item.dirs.join(' | ')}。` +
      '⚠️ 宿主只注入 `installed_plugins.json` 里 installPath 指向的版本，这些旧版本目录**不占 token**，只占磁盘。',
      '把非激活版本移到备份目录（只移动、不删除，随时可移回）。',
      { kind: 'auto', fixId: 'prune-skill-dupes' });
  }

  // ---- 会话成本 ----
  for (const item of heavySessions.slice(0, 5)) {
    const severity = (levelOf(item.turns, THRESHOLDS.sessionTurns) === 'crit'
      || levelOf(item.input, THRESHOLDS.sessionInputTokens) === 'crit') ? 'crit' : 'warn';
    push(severity, 'session:' + item.id, '会话过长：' + item.id.slice(0, 8),
      `${item.turns} 轮 / 累计输入 ${item.input} token / 末轮输入 ${item.lastInput}` +
      `（历史重发倍率 ${item.ratio.toFixed(1)}x）。**每轮都要把整段历史重发一次**。`,
      '换任务就开新会话。先把这条粘给我生成一份交接摘要，拿它开新会话接着做。',
      { kind: 'paste', prompt: '这条会话已经 ' + item.turns + ' 轮（累计输入 ' + item.input + ' token），再继续下去每轮都要重发整段历史。帮我生成交接摘要：① 已完成 ② 待办 ③ 关键路径与判据 ④ 未提交改动 —— 写进工作区文件，然后我开新会话接着做。' });
  }

  const order = { crit: 0, warn: 1, ok: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    ok: true,
    generatedAt: Date.now(),
    days,
    memory,
    skills: {
      count: skills.length,
      totalBytes: skills.reduce((sum, item) => sum + item.bytes, 0),
      biggest: skills.slice(0, 8).map((item) => ({ name: item.name, bytes: item.bytes, lines: item.lines, file: item.file })),
      oversized: oversized.map((item) => ({ name: item.name, bytes: item.bytes, lines: item.lines, file: item.file })),
      longDescriptions: longDescriptions.map((item) => ({ name: item.name, descriptionChars: item.descriptionChars, file: item.file })),
      duplicates,
    },
    sessions: {
      count: sessionScan.sessions.length,
      totalInput: sessionScan.totalInput,
      copiesSkipped: sessionScan.copies,
      heavy: heavySessions.slice(0, 8).map((item) => ({
        id: item.id, turns: item.turns, input: item.input, lastInput: item.lastInput, ratio: item.ratio,
      })),
    },
    findings,
    counts: {
      crit: findings.filter((item) => item.severity === 'crit').length,
      warn: findings.filter((item) => item.severity === 'warn').length,
    },
  };
}

// findings[i].fix 的形状：
//   { kind: "auto",  fixId: "prune-skill-dupes" }        前端给「一键清理」按钮，走 POST /api/context-audit/fix
//   { kind: "paste", prompt: "..." }                     前端给「复制指令」按钮，粘给 AI 执行
//   { kind: "manual", hint: "..." }                      纯手工，无按钮
// auto 类的实现不在本模块（本模块只读），在 scripts/context-fix.js。
/**
 * 交接摘要（**纯函数**：只拼字符串，不写盘、不发网络）。
 *
 * 用途：会话太长要换新会话时，一键拿到「已经烧了多少 / 还剩什么问题」的**事实**摘要，
 * 粘到新会话开头 —— 不必把旧会话那几万行历史带过去。
 * 刻意不调用模型：这里全是已经量出来的数字，不需要再花 token 让模型复述一遍。
 */
function buildHandoff(report) {
  const r = report || {};
  const s = r.sessions || {};
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const out = [];
  out.push('# 交接摘要（自动生成）', '');
  out.push('> 生成时间：' + new Date(r.generatedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19));
  out.push('> 用途：粘到新会话开头，让新会话接手 —— 不必把旧会话的整段历史带过去。', '');
  out.push('## 一、会话成本现状', '');
  out.push('- 近 ' + (r.days || 7) + ' 天：**' + (s.count || 0) + '** 条会话 / 累计输入 **' + (s.totalInput || 0) + '** token'
    + (s.copiesSkipped ? '（已跳过 ' + s.copiesSkipped + ' 份切号副本）' : ''));
  const heavy = Array.isArray(s.heavy) ? s.heavy.slice(0, 3) : [];
  for (const h of heavy) {
    out.push('- 重点会话 `' + String(h.id || '').slice(0, 8) + '`：' + h.turns + ' 轮 / 累计 ' + h.input
      + ' / 末轮 ' + h.lastInput + ' / 历史重发倍率 ' + Number(h.ratio || 0).toFixed(1) + 'x');
  }
  out.push('');
  out.push('## 二、待处理项（上下文体检发现 ' + findings.length + ' 条）', '');
  if (!findings.length) out.push('- 无');
  for (const item of findings.slice(0, 10)) {
    out.push('- **[' + (item.severity === 'crit' ? '严重' : '警告') + ']** ' + String(item.title || ''));
    if (item.action) out.push('  - 处理：' + String(item.action));
  }
  out.push('');
  out.push('## 三、接下来', '');
  out.push('请基于以上事实继续推进当前任务；需要细节时再让我去读工作区日志 / 仓库代码（别把旧会话的整段历史带过来）。');
  out.push('');
  return out.join('\n');
}

module.exports = {
  buildHandoff,
  auditContext,
  auditMemory,
  listSkills,
  readFrontmatter,
  scanSessions,
  levelOf,
  THRESHOLDS,
};
