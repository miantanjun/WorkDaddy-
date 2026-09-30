#!/usr/bin/env node
/**
 * 开局检索：一条命令跨「技能 / 记忆 / 代码索引」找答案（2026-10-01 新增）
 *
 * 借鉴 Hindsight 的「会话开始自动注入相关页面」——但**不引向量库**：
 * 维护手册本身就有 13 份 references + 一张「症状 → 章节」反查表 + 代码索引，
 * 缺的只是**一次能同时搜它们**的入口。
 *
 * 用法：
 *   node .wd-analysis/wd-recall.js 切号 弹窗
 *   node .wd-analysis/wd-recall.js --workspace "D:/WorkBuddy date/2026-09-23-09-10-08" 弹窗 收敛
 *   node .wd-analysis/wd-recall.js --all 死锁          # 不过滤，正文命中全列（默认每文件最多 3 条）
 *
 * 环境变量 WD_WORKSPACE 等价于 --workspace。
 *
 * 排序（高 → 低）：
 *   ① 技能 SKILL.md 的「症状 → 章节反查表」命中   —— 直接给答案
 *   ② 技能章节**标题**命中                        —— 定位到节
 *   ③ references 正文命中（按命中数聚合）          —— 找细节
 *   ④ 工作区 memory（日档 / MEMORY.md）+ CODE-INDEX —— 找历史决策
 *
 * ⚠️ 纯只读：不写任何文件。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
let workspace = process.env.WD_WORKSPACE || '';
let showAll = false;
const terms = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--workspace' || a === '-w') { workspace = argv[i + 1] || ''; i += 1; continue; }
  if (a === '--all') { showAll = true; continue; }
  terms.push(a);
}
if (!terms.length) {
  console.log('用法: node .wd-analysis/wd-recall.js [--workspace <dir>] [--all] <关键词...>');
  console.log('示例: node .wd-analysis/wd-recall.js 切号 弹窗');
  process.exit(0);
}

const SKILL_DIR = path.join(os.homedir(), '.workbuddy', 'skills', 'workdaddy-maintain');
const repo = path.resolve(__dirname, '..');
const TERMS = terms.map((t) => t.toLowerCase());

function collect(dir, exts, out = [], depth = 0) {
  if (depth > 3) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, exts, out, depth + 1);
    else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) out.push(full);
  }
  return out;
}

function readNorm(file) {
  try { return String(fs.readFileSync(file, 'utf8')).replace(/\r\n/g, '\n'); } catch (_) { return ''; }
}
function hitCount(text) {
  const low = text.toLowerCase();
  let n = 0;
  for (const t of TERMS) {
    let idx = 0;
    while ((idx = low.indexOf(t, idx)) >= 0) { n += 1; idx += t.length; }
  }
  return n;
}

const results = { table: [], headings: [], bodies: [], memory: [] };

// ① + ② 技能：反查表命中优先，其次章节标题
if (fs.existsSync(SKILL_DIR)) {
  const skillMd = path.join(SKILL_DIR, 'SKILL.md');
  const t = readNorm(skillMd);
  const anchor = t.indexOf('## G. 症状 → 章节反查表');
  if (anchor >= 0) {
    // ⚠️ 只取 G 区这一段（到下一个 `## ` 标题为止）—— 否则会把后面的「参考文件索引」表
    // 和「§55 映射」表的行也当反查表命中，前排全是噪音。
    const nextH2 = t.indexOf('\n## ', anchor + 5);
    const body = t.slice(anchor, nextH2 > 0 ? nextH2 : undefined);
    body.split('\n').forEach((line) => {
      if (!/^\|/.test(line)) return;
      if (line.indexOf('症状') >= 0 && line.indexOf('文件') >= 0) return;   // 表头
      if (/^\|[\s\-:|]+\|$/.test(line)) return;                            // 分隔行
      const n = hitCount(line);
      if (n > 0) results.table.push({ hits: n, text: line.trim() });
    });
  }
  const mdFiles = collect(SKILL_DIR, ['.md']);
  for (const file of mdFiles) {
    const rel = path.relative(SKILL_DIR, file).replace(/\\/g, '/');
    const text = readNorm(file);
    // 章节标题命中
    text.split('\n').forEach((line, idx) => {
      if (!/^#{2,4}\s/.test(line)) return;
      const n = hitCount(line);
      if (n > 0) results.headings.push({ hits: n, where: rel + ':' + (idx + 1), text: line.replace(/^#+\s*/, '').trim() });
    });
    // 正文命中
    const lines = text.split('\n');
    let total = 0;
    const samples = [];
    lines.forEach((line, idx) => {
      if (/^#{2,4}\s/.test(line)) return;
      const n = hitCount(line);
      if (n <= 0) return;
      total += n;
      if (samples.length < (showAll ? 999 : 3)) {
        samples.push('      ' + (idx + 1) + ': ' + line.trim().slice(0, 150));
      }
    });
    if (total > 0) results.bodies.push({ hits: total, where: rel, samples });
  }
}

// ③ 工作区 memory + 代码索引
const memDirs = [];
if (workspace) memDirs.push(path.join(workspace, '.workbuddy', 'memory'));
memDirs.push(path.join(repo, '.wd-analysis'));
for (const dir of memDirs) {
  const files = collect(dir, ['.md'], []).filter((f) => /memory|CODE-INDEX|MEMORY/i.test(path.basename(f)));
  for (const file of files) {
    const text = readNorm(file);
    const lines = text.split('\n');
    let total = 0;
    const samples = [];
    lines.forEach((line, idx) => {
      const n = hitCount(line);
      if (n <= 0) return;
      total += n;
      if (samples.length < (showAll ? 999 : 2)) samples.push('      ' + (idx + 1) + ': ' + line.trim().slice(0, 150));
    });
    if (total > 0) results.memory.push({ hits: total, where: path.relative(path.dirname(dir), file).replace(/\\/g, '/'), samples });
  }
}

const sorter = (a, b) => b.hits - a.hits;
results.table.sort(sorter);
results.headings.sort(sorter);
results.bodies.sort(sorter);
results.memory.sort(sorter);

const out = [];
out.push('检索: ' + terms.join(' + '));
out.push('范围: 技能=' + (fs.existsSync(SKILL_DIR) ? '是' : '否')
  + '  工作区记忆=' + (workspace ? workspace : '（未指定，用 --workspace 或 WD_WORKSPACE）')
  + '  代码索引=是');
out.push('');

if (results.table.length) {
  out.push('== ① 反查表命中（直接给答案）==');
  results.table.slice(0, 12).forEach((r) => out.push('  ' + r.text));
  out.push('');
}
if (results.headings.length) {
  out.push('== ② 技能章节标题命中（定位到节）==');
  results.headings.slice(0, 14).forEach((r) => out.push('  [' + r.hits + '] ' + r.where + '  ' + r.text));
  out.push('');
}
if (results.bodies.length) {
  out.push('== ③ references 正文命中（按命中数）==');
  results.bodies.slice(0, 10).forEach((r) => {
    out.push('  [' + r.hits + '] ' + r.where);
    r.samples.forEach((s) => out.push(s));
  });
  out.push('');
}
if (results.memory.length) {
  out.push('== ④ 记忆 / 代码索引命中 ==');
  results.memory.slice(0, 8).forEach((r) => {
    out.push('  [' + r.hits + '] ' + r.where);
    r.samples.forEach((s) => out.push(s));
  });
  out.push('');
}
const totalHits = results.table.length + results.headings.length + results.bodies.length + results.memory.length;
if (!totalHits) out.push('（无命中。试试更短的关键词，例如「切号」「弹窗」「token」「发版」）');

console.log(out.join('\n'));
