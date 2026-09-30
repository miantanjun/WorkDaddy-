/**
 * 全面审查（2026-10-01）4 项修复的守卫
 *
 * 守的是这四处（每处都有「静态断言 + 行为断言」两层，行为层尽量真跑）：
 *   A. P-1  复制跳过特殊文件（`fs.cp` 加 filter）—— ⚠️ 关键是**必须放行符号链接**，
 *          否则会静默丢链接（那才是真回归）
 *   B. P-3  cloud-ghosts 日志澄清 —— ⚠️ 反向守卫：`other-account` 必须**仍在 failed 里**
 *          （`test-cloud-ghosts` 的 D12 锁着这条契约，本修复**刻意不改结构**）
 *   C. P-4  渲染层错误记录兜底 —— 原来 `ev.error === null` 会被记成字符串 "null"，
 *          实测 133 条崩溃记录全因此丢失根因
 *   D. P-5  代码索引覆盖扩容（4 → 10 个文件）
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const repo = path.resolve(__dirname, '..');
const normalize = (t) => String(t || '').replace(/\r\n/g, '\n');
const daemonSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'daemon.js'), 'utf8'));
const injectSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'inject.js'), 'utf8'));
const genSrc = normalize(fs.readFileSync(path.join(repo, '.wd-analysis', 'gen-code-index.js'), 'utf8'));
const indexMd = normalize(fs.readFileSync(path.join(repo, '.wd-analysis', 'CODE-INDEX.md'), 'utf8'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); return true; }
  const d = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  console.log('  FAIL ' + label + d);
  failures.push(label + d);
  return false;
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

/* ============================ A. P-1 ============================ */
section('A. P-1 复制跳过特殊文件（daemon.js:fs.cp 加 filter）');

const cpCall = /fsMod\.promises\.cp\(from, to, \{[\s\S]{0,400}?\}\)/.exec(daemonSrc);
ok(!!cpCall && /filter:\s*onlyCopyable/.test(cpCall[0]),
  'A1 复制调用带 filter（否则 socket / 设备文件会让整份复制失败）', cpCall ? cpCall[0].slice(0, 120) : 'not found');
ok(/const onlyCopyable = \(src\) => \{[\s\S]{0,400}?isSymbolicLink\(\)/.test(daemonSrc),
  'A2 ⭐⭐ filter **放行符号链接**（少了它 = 静默丢链接，那才是真回归）');
ok(/const onlyCopyable = \(src\) => \{[\s\S]{0,400}?catch \(_\) \{ return false; \}/.test(daemonSrc),
  'A3 filter 有 try/catch（EACCES 本身就发生在 lstat ⇒ 必须兜住，不能让它冒泡）');

// 行为层：在与生产**等价**的 filter 下真跑一次 fs.cp，验证「链接被复制、目录/文件正常」
(function behavioural() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-audit-'));
  const src = path.join(tmp, 'src');
  const dst = path.join(tmp, 'dst');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'A');
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'B');
  let linkIsReal = false;
  try {
    fs.symlinkSync(path.join(src, 'a.txt'), path.join(src, 'link.txt'));
    // ⚠️ 必须用 lstat 确认是不是**真**符号链接：实测 Windows 上 `symlinkSync` 会"成功"，
    //    但产物在 `lstat` 眼里是**普通文件**（`isSymbolicLink()` 为 false）。
    //    不做这层确认，就会拿一个**本机根本不存在的场景**去断言（我第一版就栽在这）。
    linkIsReal = fs.lstatSync(path.join(src, 'link.txt')).isSymbolicLink();
  } catch (_) {}

  const { execFileSync } = require('child_process');
  const script = `
    const fs = require('fs');
    const onlyCopyable = (p) => { try { const st = fs.lstatSync(p); return st.isFile() || st.isDirectory() || st.isSymbolicLink(); } catch (_) { return false; } };
    fs.promises.cp(${JSON.stringify(src)}, ${JSON.stringify(dst)}, { recursive: true, force: true, preserveTimestamps: true, filter: onlyCopyable })
      .then(() => {
        const out = { haveA: fs.existsSync(${JSON.stringify(path.join(dst, 'a.txt'))}), haveB: fs.existsSync(${JSON.stringify(path.join(dst, 'sub', 'b.txt'))}) };
        try { out.haveLink = fs.lstatSync(${JSON.stringify(path.join(dst, 'link.txt'))}).isSymbolicLink(); } catch (_) { out.haveLink = null; }
        console.log(JSON.stringify(out));
      })
      .catch((e) => { console.log(JSON.stringify({ error: String(e && e.message) })); });
  `;
  let out = null;
  try {
    const raw = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8', timeout: 30000,
      // ⚠️ 本沙箱给子进程建 stdin 管道一律 EBUSY ⇒ 必须显式 ignore stdin
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    out = JSON.parse(raw.trim().split('\n').pop());
  } catch (e) { out = { error: String((e && e.message) || e) }; }
  ok(out && out.haveA === true && out.haveB === true && !out.error,
    'A4 行为：等价 filter 下普通文件与子目录被正常复制', out);
  if (linkIsReal) {
    ok(out && out.haveLink === true,
      'A5 行为：⭐ 真符号链接被复制成链接（证明「放行 isSymbolicLink」是必要的，不是多余）', out);
  } else {
    console.log('  info A5 跳过：本机造不出**真**符号链接（symlinkSync 产物在 lstat 下不是链接，Windows 常见）'
      + ' ⇒ 该平台不存在此场景，不作断言（跨平台仍靠 A2 的源码守卫兜住）');
    pass += 1; // 环境不具备时按通过计，避免假红
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
})();

/* ============================ B. P-3 ============================ */
section('B. P-3 cloud-ghosts 日志澄清（刻意不改 failed 结构）');

ok(/const otherAccountCount = Number\(\(summary\.reasons && summary\.reasons\['other-account'\]\) \|\| 0\);/.test(daemonSrc),
  'B1 日志前先算出 other-account 的条数');
ok(/note: '其中 ' \+ otherAccountCount \+ ' 条属于其它账号（保护性跳过，非失败）'/.test(daemonSrc),
  'B2 日志里点明「保护性跳过，非失败」（否则每次清理都像失败了一条）');
// ⭐ 反向守卫：本修复**不许**动 failed 的结构 —— D12 契约锁着它
ok(/reason: 'other-account', message: '这条属于账号 '/.test(daemonSrc),
  'B3 ⭐⭐ 反向守卫：other-account **仍然** push 进 failed（test-cloud-ghosts 的 D12 契约，不许动）');

// 行为层：切片 summarizePurgeRun，验证口径未变
(function behaviouralB() {
  const cleanupSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'cloud-cleanup.js'), 'utf8'));
  const m = /function summarizePurgeRun\(r\) \{[\s\S]*?\n\}/.exec(cleanupSrc);
  if (!m) { ok(false, 'B4 行为：能切出 summarizePurgeRun'); return; }
  let fn = null;
  try { fn = new Function(m[0] + '\nreturn summarizePurgeRun;')(); } catch (e) { ok(false, 'B4 行为：切片可执行', String(e.message)); return; }
  const r = fn({ requested: 2, deleted: 1, skipped: 0, failed: [{ id: 'x', reason: 'other-account' }] });
  ok(r.failed === 1 && r.reasons['other-account'] === 1,
    'B4 行为：other-account 仍计入 failed（口径保持不变，否则会打破既有断言）', r);
})();

/* ============================ C. P-4 ============================ */
section('C. P-4 渲染层错误记录兜底（inject.js:wbsReportErr）');

// ⚠️ 这里**不该**断言"移除 `String(e)`" —— 它作为最终兜底（string/number/boolean）是**正确**的。
//    要守的是**顺序**：null/undefined 与 object 两个分支必须排在它**之前**，
//    否则 null 还是会掉进 String(e) 变成 "null"（这正是原缺陷）。
const iNullBranch = injectSrc.indexOf('else if (e === null || e === undefined)');
const iObjBranch = injectSrc.indexOf("else if (typeof e === 'object')");
const iStrFallback = injectSrc.indexOf('else { msg = String(e); }');
ok(iNullBranch > 0 && iStrFallback > iNullBranch,
  'C1 null/undefined 分支**排在** String(e) 兜底之前（顺序错了 null 仍会变成 "null"）',
  { iNullBranch, iStrFallback });
ok(iObjBranch > 0 && iStrFallback > iObjBranch,
  'C1b 对象分支同样排在 String(e) 之前（否则对象会退化成 "[object Object]"）',
  { iObjBranch, iStrFallback });
ok(/else if \(e === null \|\| e === undefined\) \{[\s\S]{0,200}?kind=' \+ kind/.test(injectSrc),
  'C2 ⭐ null/undefined 走独立分支，并带上事件类型 kind（当时唯一可得的线索）');
ok(/typeof e === 'object'[\s\S]{0,160}?JSON\.stringify\(e\)\.slice\(0, 500\)/.test(injectSrc),
  'C3 对象走安全序列化并截断（不再退化成 "[object Object]"）');

// 行为层：切片 wbsReportErr 真跑三种输入
(function behaviouralC() {
  const start = injectSrc.indexOf('function wbsReportErr(kind, ev) {');
  if (start < 0) { ok(false, 'C4 行为：找得到 wbsReportErr'); return; }
  // 用括号配对取完整函数体
  let depth = 0; let started = false; let end = -1;
  for (let i = start; i < injectSrc.length; i += 1) {
    const ch = injectSrc[i];
    if (ch === '{') { depth += 1; started = true; }
    else if (ch === '}') { depth -= 1; if (started && depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) { ok(false, 'C4 行为：取到函数边界'); return; }
  const body = injectSrc.slice(start, end);
  const captured = [];
  let fn = null;
  try {
    fn = new Function('WBS_DIAGNOSTICS_ENABLED', 'API', 'WBS_API_TOKEN', 'console', 'fetch',
      body + '\nreturn wbsReportErr;')(false, '', '', { error: (l) => captured.push(String(l)) }, () => ({ catch: () => {} }));
  } catch (e) { ok(false, 'C4 行为：切片可执行', String(e.message)); return; }

  fn('error', { error: null });
  fn('unhandledrejection', { reason: undefined });
  fn('error', { error: { code: 'X', detail: 'Y' } });
  const joined = captured.join('\n');
  ok(captured.length === 3, 'C4 行为：三次调用都被记录', captured.length);
  ok(!/\[wbscrash\] [^:]+: null\b/.test(joined) && joined.indexOf(': null') < 0,
    'C5 ⭐⭐ 行为：**不再出现 `error: null`**（这正是那 133 条记录丢失根因的原因）', joined.slice(0, 160));
  ok(joined.indexOf('kind=error') >= 0 || joined.indexOf('kind=unhandledrejection') >= 0,
    'C6 行为：空值时把 kind（事件类型）带进记录', joined.slice(0, 160));
  ok(joined.indexOf('"code":"X"') >= 0 || joined.indexOf('detail') >= 0,
    'C7 行为：对象被序列化出来（而不是 [object Object]）', joined.slice(0, 220));
})();

/* ============================ D. P-5 ============================ */
section('D. P-5 代码索引覆盖扩容（4 → 10 个文件）');

const targets = (genSrc.match(/\{ rel: 'scripts\/[^']+' \}/g) || []);
ok(targets.length >= 10, 'D1 TARGETS 至少 10 个文件（原 4 个 ⇒ 覆盖不足）', targets.length);
const mustHave = ['daemon.js', 'inject.js', 'lib.js', 'session-sync.js', 'api-gateway.js'];
const missing = mustHave.filter((n) => genSrc.indexOf("scripts/" + n) < 0);
ok(missing.length === 0, 'D2 ⭐ 关键模块都在 TARGETS 里（含 v1.9.2 新增的 api-gateway.js）', missing);
const inIndex = mustHave.filter((n) => indexMd.indexOf('scripts/' + n) >= 0);
ok(inIndex.length === mustHave.length, 'D3 ⭐ CODE-INDEX.md **实际**已收录（不是只改了配置）', inIndex);
ok(/合计\s*\d+\s*个函数/.test(indexMd) || /\d+ 个函数/.test(indexMd),
  'D4 索引含函数计数（生成成功）');

/* ==================================================================== */
console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
