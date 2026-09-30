#!/usr/bin/env node
/**
 * 日档治理：报告 + 台账 +（可选）归档蒸馏（2026-10-01 新增）
 *
 * 背景：维护规则要求「30 天前的日档蒸馏进 MEMORY.md 后删除」，但**这条纪律一直只写在文档里**
 *   —— 没人执行、也没法检查。实测（2026-10-01）：能工作区日档 **6 个 / 278 KB**（09-23 ~ 09-30，
 *   平均 46 KB/天），而 `MEMORY.md` 只有 16 KB ⇒ 过程记录在涨，长期约定没同步长。
 *
 * 本脚本把这条纪律变成**一条命令**：
 *   · 默认 **dry-run**：只报告 + 打印可直接贴进 `MEMORY.md` 的台账区块，**不动任何文件**；
 *   · `--apply`：把超过 30 天的日档**归档**到 `_archive/`（⚠️ **不是删除** —— 保留可逆路径），
 *     并把「蒸馏索引」追加进 `MEMORY.md`。
 *
 * 为什么归档而不是删：日档里常有"当时怎么排查的"这类过程信息，删掉就再也找不回来；
 *   归档到子目录既让主目录清爽（检索变快），又保留追溯能力。**要真删请自己动手。**
 *
 * 用法：
 *   node .wd-analysis/wd-memory-distill.js --workspace "D:/WorkBuddy date/2026-09-23-09-10-08"
 *   node .wd-analysis/wd-memory-distill.js --workspace "..." --apply
 *   node .wd-analysis/wd-memory-distill.js --workspace "..." --days 14     # 改阈值（默认 30）
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
let workspace = process.env.WD_WORKSPACE || process.cwd();
let apply = false;
let days = 30;
let writeBack = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--workspace' || argv[i] === '-w') { workspace = argv[i + 1] || workspace; i += 1; continue; }
  if (argv[i] === '--apply') { apply = true; continue; }
  if (argv[i] === '--write') { writeBack = true; continue; }
  if (argv[i] === '--days') { days = Number(argv[i + 1]) || 30; i += 1; continue; }
}
const IDX_START = '<!-- wd-memory-index:start -->';
const IDX_END = '<!-- wd-memory-index:end -->';

const MEM_DIR = path.join(workspace, '.workbuddy', 'memory');
const ARCHIVE_DIR = path.join(MEM_DIR, '_archive');
const MEMORY_MD = path.join(MEM_DIR, 'MEMORY.md');

if (!fs.existsSync(MEM_DIR)) {
  console.log('工作区记忆目录不存在: ' + MEM_DIR);
  console.log('（用 --workspace <工作区根> 指定，或设环境变量 WD_WORKSPACE）');
  process.exit(0);
}

function listDaily() {
  return fs.readdirSync(MEM_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
}
function stampOf(name) { return name.slice(0, 10); }
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 从日档里抽「主题线索」：标题行 + 明确引用技能章节的行（粗判，只用于索引，不做判定）。 */
function outlineOf(file) {
  const text = String(fs.readFileSync(path.join(MEM_DIR, file), 'utf8')).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const heads = [];
  const refs = new Set();
  for (const line of lines) {
    if (/^#{1,3}\s+\S/.test(line)) {
      const h = line.replace(/^#+\s*/, '').trim();
      if (h.length >= 4 && h.length <= 60) heads.push(h);
    }
    const m = line.match(/§\s?\d+(?:\.\d+)*/g);
    if (m) m.forEach((s) => refs.add(s.replace(/\s+/g, '')));
  }
  return { heads: heads.slice(0, 6), refs: Array.from(refs).slice(0, 10) };
}

const today = todayLocal();
const daily = listDaily();
const old = [];
const fresh = [];
for (const f of daily) {
  const age = daysBetween(stampOf(f), today);
  (age >= days ? old : fresh).push({ file: f, age, size: fs.statSync(path.join(MEM_DIR, f)).size });
}
let totalBytes = 0;
daily.forEach((f) => { totalBytes += fs.statSync(path.join(MEM_DIR, f)).size; });

console.log('===== 日档治理报告 =====');
console.log('工作区: ' + workspace);
console.log('今天: ' + today + '　阈值: ' + days + ' 天　模式: ' + (apply ? 'APPLY（会归档文件）' : 'dry-run（不动文件）'));
console.log('');
console.log('日档 ' + daily.length + ' 个　合计 ' + (totalBytes / 1024).toFixed(0) + ' KB'
  + '　日期范围 ' + (daily[0] || '(无)') + ' ~ ' + (daily[daily.length - 1] || '(无)'));
console.log('MEMORY.md ' + (fs.existsSync(MEMORY_MD) ? (fs.statSync(MEMORY_MD).size / 1024).toFixed(0) + ' KB' : '（不存在）'));
console.log('');
console.log('超过 ' + days + ' 天（可归档）: ' + old.length + ' 个'
  + (old.length ? '　' + old.map((o) => o.file + '(' + (o.size / 1024).toFixed(0) + 'KB/' + o.age + 'd)').join('  ') : ''));
console.log('保留（未到期）      : ' + fresh.length + ' 个');
if (!old.length) {
  const earliest = daily[0];
  if (earliest) {
    const due = daysBetween(stampOf(earliest), today);
    console.log('');
    console.log('⇒ 当前**无需归档**。最早日档 ' + earliest + ' 已 ' + due + ' 天，'
      + (days - due) + ' 天后（约 ' + stampOf(earliest) + ' + ' + days + 'd）进入可归档区。');
  }
}

// ── 生成可贴进 MEMORY.md 的「日档索引」区块 ────────────────────────────────
const idxLines = [];
idxLines.push('## 日档索引（自动生成，可用 `node .wd-analysis/wd-memory-distill.js` 刷新）');
idxLines.push('');
idxLines.push('> 用途：**日档是过程记录，不当作长期约定**。这里只留「哪天的日档讲了什么 + 已沉淀到技能哪一节」，');
idxLines.push('> 这样检索不必读全文（配合 `.wd-analysis/wd-recall.js`）。');
idxLines.push('');
idxLines.push('| 日期 | 体积 | 主题（前几个小标题）| 已沉淀到的技能章节 |');
idxLines.push('|---|---|---|---|');
for (const f of daily) {
  const o = outlineOf(f);
  const size = (fs.statSync(path.join(MEM_DIR, f)).size / 1024).toFixed(0) + 'KB';
  idxLines.push('| ' + stampOf(f) + ' | ' + size + ' | ' + (o.heads.join(' / ').slice(0, 110) || '—')
    + ' | ' + (o.refs.join(' ') || '—') + ' |');
}
idxLines.push('');
idxLines.push('**蒸馏台账**：阈值 ' + days + ' 天；最近一次检查 ' + today
  + '；可归档 ' + old.length + ' 个' + (old.length ? '（' + old.map((o) => o.file).join(', ') + '）' : '')
  + '。归档位置：`.workbuddy/memory/_archive/`（**归档不删除**，保可逆）。');

console.log('');
console.log('===== 可贴进 MEMORY.md 的区块 =====');
console.log(idxLines.join('\n'));

// ── 可选：把索引区块**原地写回** MEMORY.md（标记块内替换，幂等）─────────────
if (writeBack) {
  try {
    const block = IDX_START + '\n' + idxLines.join('\n') + '\n' + IDX_END;
    let cur = fs.existsSync(MEMORY_MD) ? String(fs.readFileSync(MEMORY_MD, 'utf8')) : '';
    const s = cur.indexOf(IDX_START);
    const e = cur.indexOf(IDX_END);
    if (s >= 0 && e > s) {
      cur = cur.slice(0, s) + block + cur.slice(e + IDX_END.length);
      console.log('');
      console.log('已**替换** MEMORY.md 里的索引标记块（幂等）');
    } else {
      const merged = cur.replace(/\s*$/, '') + '\n\n' + block + '\n';
      cur = merged.replace(/^\s*\n/, '');
      console.log('');
      console.log('已在 MEMORY.md 末尾**追加**索引标记块');
    }
    fs.writeFileSync(MEMORY_MD, cur);
    console.log('MEMORY.md 现在 ' + (fs.statSync(MEMORY_MD).size / 1024).toFixed(0) + ' KB');
  } catch (err) {
    console.log('!! 写回 MEMORY.md 失败: ' + String((err && err.message) || err));
  }
}

if (!apply) {
  console.log('');
  console.log('（dry-run 结束。要真归档请加 --apply：超过 ' + days + ' 天的日档会被移动到 _archive/。）');
  process.exit(0);
}

if (!old.length) {
  console.log('');
  console.log('无可归档日档，未做改动。');
  process.exit(0);
}

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const moved = [];
for (const o of old) {
  const from = path.join(MEM_DIR, o.file);
  const to = path.join(ARCHIVE_DIR, o.file);
  try {
    fs.renameSync(from, to);
    moved.push(o.file);
  } catch (e) {
    console.log('!! 归档失败 ' + o.file + ': ' + String((e && e.message) || e));
  }
}
console.log('');
console.log('已归档 ' + moved.length + ' 个日档 → ' + ARCHIVE_DIR);
moved.forEach((f) => console.log('  · ' + f));
console.log('（⚠️ 是**移动**不是删除；确认无误后可自行清理 _archive/。）');
