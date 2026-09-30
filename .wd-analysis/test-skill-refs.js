/**
 * 技能「知识页自愈」守卫（2026-10-01 立档）
 *
 * 背景：`workdaddy-maintain` 技能有 13 份 references（约 1.8 MB），是长期维护的**知识页**。
 *   借鉴 Hindsight「Knowledge Pages 自我修复」的思路：页面内容会随代码演进**腐烂**
 *   —— 里面的文件引用、行号引用会失效，而**人肉发现不了**（本仓真实发生过：
 *   `_loadingWithCredit_` 那条结论被证伪后才靠实测发现）。
 *
 * 本套件做**机器能判定**的那部分：
 *   A. **文件引用**：技能里写的 `scripts/xxx.js` / `.wd-analysis/xxx.js` 是否还存在；
 *   B. **行号引用**：`xxx.js:1234` 的行号是否超出该文件当前行数（越界 = 引用已经烂掉）；
 *   C. **函数名锚点**：只**统计**不判定（很多是历史留档，判定会大量误报）—— 输出清单供人工参考。
 *
 * ⚠️ **白名单是必需的**：references 里有大量「历史留档」性质的引用
 *   （记录"当时的实现是 X，后来删掉了"）。这类**必然失效且是正确留档**，不能判 FAIL。
 *   ⇒ 用 `KNOWN_STALE` 显式登记（每条必须带原因），**其余失效一律 FAIL**。
 *   新增白名单条目时**必须写清为什么它是留档**，否则这条守卫会退化成一纸空文。
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const repo = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(os.homedir(), '.workbuddy', 'skills', 'workdaddy-maintain');

/**
 * 已知的「历史留档」引用白名单：`引用原文` → `为什么它失效是正常的`。
 * ⚠️ 只登记**确认过**的；拿不准的先让它 FAIL，再人工判断。
 */
const KNOWN_STALE = {
  // 上游新增了 `scripts/account-credit-cache.js`，本地**刻意不搬**（复用 credit-rotation.js 的
  // `nearestExpiringSegment`，再造一份缓存必然与限流切号不一致）⇒ 该引用是**历史留档**。
  'scripts/account-credit-cache.js': '02-补丁与上游同步.md §52 记录「上游新增、本地不搬」的决策留档',
};

/** 占位符/示例文件名（出现在命令模板里，如 `<tag>/scripts/xxx.js`）—— 不是真引用。 */
const PLACEHOLDER_NAME = /^(?:xxx|yyy|zzz|foo|bar|baz|placeholder|example|sample)(?:[.\-_].*)?$/i;

/** 解析路径用的候选根目录：技能里的引用都是相对仓库根的。 */
const ROOTS = [repo];

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); return true; }
  const detail = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  console.log('  FAIL ' + label + detail);
  failures.push(label + detail);
  return false;
}
function section(title) {
  console.log('\n--- ' + title + ' ---');
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 递归收集技能目录下的 .md。 */
function collectMarkdown(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, out);
    else if (/\.md$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** 在候选根目录里找这个相对路径，返回绝对路径或 null。 */
function resolveRef(rel) {
  const clean = String(rel || '').replace(/^[./\\]+/, '').replace(/\\/g, '/');
  for (const root of ROOTS) {
    const full = path.join(root, clean);
    try { if (fs.statSync(full).isFile()) return full; } catch (_) {}
  }
  return null;
}

console.log('===== 技能知识页「自愈」守卫 =====');
console.log('技能目录: ' + SKILL_DIR);

section('0. 前置：技能目录与文件清单');

if (!fs.existsSync(SKILL_DIR)) {
  console.log('  !! 技能目录不存在，跳过（本机未安装该技能）');
  console.log('\n===== 结果：0 通过 / 0 失败 =====');
  process.exit(0);
}
const mdFiles = collectMarkdown(SKILL_DIR);
ok(mdFiles.length >= 10, 'S0 技能目录可读且含 ≥10 个 .md（当前 ' + mdFiles.length + ' 个）', mdFiles.length);

// ── 提取引用 ──────────────────────────────────────────────────────────────
// 只认「像路径」的引用：带目录前缀 + 已知扩展名，或「文件名:行号」形态。
const RE_PATH_REF = /\b(scripts|\.wd-analysis|tools)\/([A-Za-z0-9_.\-]+\.[A-Za-z0-9]+)/g;
const RE_LINE_REF = /\b([A-Za-z0-9_.\-]+\.(?:js|sh|ps1|cmd|py|json)):(\d+)\b/g;

const fileRefs = [];   // {rel, source, line}
const lineRefs = [];   // {file, lineNo, source, srcLine}
const funcRefs = new Set();

for (const file of mdFiles) {
  const text = normalize(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(SKILL_DIR, file).replace(/\\/g, '/');
  text.split('\n').forEach((line, idx) => {
    let m;
    RE_PATH_REF.lastIndex = 0;
    while ((m = RE_PATH_REF.exec(line)) !== null) {
      // 排除占位符（命令模板里的 `scripts/xxx.js` 之类）—— 它们不是真引用，会污染判据。
      if (PLACEHOLDER_NAME.test(m[2].replace(/\.[A-Za-z0-9]+$/, ''))) continue;
      fileRefs.push({ rel: m[1] + '/' + m[2], source: rel, line: idx + 1 });
    }
    RE_LINE_REF.lastIndex = 0;
    while ((m = RE_LINE_REF.exec(line)) !== null) {
      lineRefs.push({ file: m[1], lineNo: Number(m[2]), source: rel, srcLine: idx + 1 });
    }
    const fcall = line.match(/`([A-Za-z_$][A-Za-z0-9_$]*)\(\)`/g);
    if (fcall) fcall.forEach((s) => funcRefs.add(s.replace(/`/g, '')));
  });
}

section('1. 文件引用（硬判据：引用的文件必须存在）');

const uniqFileRefs = [];
const seenRef = new Set();
for (const r of fileRefs) {
  const key = r.rel;
  if (seenRef.has(key)) continue;
  seenRef.add(key);
  uniqFileRefs.push(r);
}
console.log('  info 去重后文件引用 ' + uniqFileRefs.length + ' 条（原始 ' + fileRefs.length + ' 条）');

const missing = uniqFileRefs.filter((r) => !resolveRef(r.rel) && !KNOWN_STALE[r.rel]);
ok(uniqFileRefs.length > 0, 'S1 技能里存在可机检的文件引用（' + uniqFileRefs.length + ' 条）', uniqFileRefs.length);
if (missing.length) {
  console.log('  -- 失效的文件引用 --');
  missing.slice(0, 25).forEach((r) => console.log('     ' + r.rel + '   （出现在 ' + r.source + ':' + r.line + '）'));
  if (missing.length > 25) console.log('     … 另有 ' + (missing.length - 25) + ' 条');
}
ok(missing.length === 0,
  'S2 ⭐ 技能里引用的文件**全部存在**（失效 0 条；历史留档须登记进 KNOWN_STALE）',
  { missing: missing.length, sample: missing.slice(0, 5).map((r) => r.rel) });

section('2. 行号引用（硬判据：行号不得超出该文件当前行数）');

const lineCache = new Map();
function lineCountOf(fileName) {
  if (lineCache.has(fileName)) return lineCache.get(fileName);
  let n = null;
  // 先在仓库 scripts/ 下找，再在 .wd-analysis/ 下找
  for (const candidate of [path.join(repo, 'scripts', fileName), path.join(repo, '.wd-analysis', fileName)]) {
    try {
      if (fs.statSync(candidate).isFile()) { n = normalize(fs.readFileSync(candidate, 'utf8')).split('\n').length; break; }
    } catch (_) {}
  }
  lineCache.set(fileName, n);
  return n;
}
const overflows = [];
let checkedLineRefs = 0;
for (const r of lineRefs) {
  const total = lineCountOf(r.file);
  if (total === null) continue;          // 文件本身缺失 ⇒ 已在 S2 报；这里不重复
  checkedLineRefs += 1;
  if (r.lineNo > total) overflows.push({ ref: r.file + ':' + r.lineNo, total, source: r.source, srcLine: r.srcLine });
}
console.log('  info 可校验的行号引用 ' + checkedLineRefs + ' 条（原始 ' + lineRefs.length + ' 条）');
if (overflows.length) {
  console.log('  -- 越界的行号引用 --');
  overflows.slice(0, 20).forEach((o) => console.log('     ' + o.ref + '  超出（该文件现有 ' + o.total + ' 行）  出现在 ' + o.source + ':' + o.srcLine));
}
ok(overflows.length === 0,
  'S3 ⭐ 技能里的「文件:行号」引用全部落在文件范围内（越界 0 条）',
  { overflows: overflows.length, sample: overflows.slice(0, 5).map((o) => o.ref) });

section('3. 函数名锚点（只统计，不判定 —— 多数是历史留档）');

const funcList = Array.from(funcRefs).sort();
console.log('  info 技能里出现的函数名锚点共 ' + funcList.length + ' 个');
console.log('       ' + funcList.slice(0, 12).join('  '));
ok(funcList.length > 0, 'S4 函数名锚点可提取（' + funcList.length + ' 个，供人工参考与未来加严）', funcList.length);

section('4. 白名单纪律（防止守卫退化）');

const staleEntries = Object.entries(KNOWN_STALE);
const badEntries = staleEntries.filter(([, reason]) => !reason || String(reason).trim().length < 6);
ok(badEntries.length === 0,
  'S5 KNOWN_STALE 每条都必须写明「为什么失效是正常的」（否则守卫会退化）',
  { entries: staleEntries.length, bad: badEntries.map(([k]) => k) });

section('5. 技能主索引的「症状 → 章节」反查表存在性');

const skillMd = path.join(SKILL_DIR, 'SKILL.md');
let hasRecallTable = false;
let recallRows = 0;
try {
  const t = normalize(fs.readFileSync(skillMd, 'utf8'));
  const anchor = t.indexOf('## G. 症状 → 章节反查表');
  hasRecallTable = anchor >= 0;
  if (hasRecallTable) {
    // 只数该标题之后的表格行，避免把前面那些索引表算进来
    const after = t.slice(anchor);
    recallRows = (after.match(/^\|[^|\n]+\|[^|\n]+\|\s*$/gm) || []).length;
  }
} catch (_) {}
ok(hasRecallTable, 'S6 SKILL.md 含「## G. 症状 → 章节反查表」标题（开局检索入口）', hasRecallTable);
ok(recallRows >= 20,
  'S7 ⭐ 反查表至少 20 行（否则开局检索形同虚设；当前 ' + recallRows + ' 行）',
  recallRows);
// 反查表里引用的章节号必须真实存在于 references（防止表本身腐烂）
let badSection = [];
try {
  const t = normalize(fs.readFileSync(skillMd, 'utf8'));
  const anchor = t.indexOf('## G. 症状 → 章节反查表');
  if (anchor >= 0) {
    const body = t.slice(anchor);
    const refs = new Set();
    const re = /\|\s*`?([0-9]{2}-[^`|\s]+\.md)`?\s*\|\s*`?([^`|]+?)`?\s*\|/g;
    let m;
    while ((m = re.exec(body)) !== null) refs.add(m[1] + '\u0000' + m[2].trim());
    const allRefText = mdFiles.map((f) => normalize(fs.readFileSync(f, 'utf8'))).join('\n');
    for (const item of refs) {
      const [file, sec] = item.split('\u0000');
      const secKey = sec.replace(/^§\s*/, '').split(/[\s（(]/)[0];
      if (!secKey) continue;
      if (allRefText.indexOf(secKey) < 0) badSection.push(file + ' ' + sec);
    }
  }
} catch (_) {}
ok(badSection.length === 0,
  'S8 ⭐⭐ 反查表里每个「文件 + 章节号」都真实存在于 references（防止反查表自己腐烂）',
  { bad: badSection.length, sample: badSection.slice(0, 6) });

section('6. 代码索引新鲜度（防「索引腐烂」）');

// 2026-10-01：`CODE-INDEX.md` 实测曾 8 天未刷新（索引里的行号全漂了）⇒ 加一条新鲜度守卫。
// 回归入口 `run-regression-all.js` 每次会**自动刷新**它（0.45 秒），所以正常情况下这条必过；
// 单独跑本套件、且刚改过源码时才会红 —— 那正是要提醒你刷新。
const INDEX_FILE = path.join(repo, '.wd-analysis', 'CODE-INDEX.md');
const INDEXED_SOURCES = ['scripts/daemon.js', 'scripts/inject.js', 'scripts/context-audit.js', 'scripts/context-fix.js'];
let idxMtime = 0;
try { idxMtime = fs.statSync(INDEX_FILE).mtimeMs; } catch (_) {}
ok(idxMtime > 0, 'S9 代码索引文件存在（.wd-analysis/CODE-INDEX.md）', idxMtime ? 'ok' : 'missing');
const staler = [];
if (idxMtime) {
  for (const rel of INDEXED_SOURCES) {
    try { if (fs.statSync(path.join(repo, rel)).mtimeMs > idxMtime) staler.push(rel); } catch (_) {}
  }
}
ok(staler.length === 0,
  'S10 ⭐ 代码索引不比源码旧（脏了就 `node .wd-analysis/gen-code-index.js`；回归入口已自动做）',
  { staler });

/* ==================================================================== */
console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
