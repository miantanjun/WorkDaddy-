/* 诊断二十：回填 76 个会话的**净效应**统计检验
 *
 * 前面缺口径混乱的教训：一次说涨、一次说跌。这里逐题对比两个库在同一批题上的表现，
 * 用配对 Wilcoxon 判显著性（判据与排序评测一致）。
 *
 * 关注三件事：
 *   ① seg 严格 Recall 逐题变化（配对）
 *   ② MRR 逐题变化（配对）
 *   ③ 变化的题集中在哪：是「本会话内容被别处稀释」还是「纯增益」
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const { execFileSync } = require('child_process');

if (process.argv[2] === '--child') {
  ck.configure({ dataDir: process.argv[3], log: () => {} });
  const out = [];
  for (const c of P) {
    const r = ck._internal.search(c.sid, c.q, c.k || 8);
    const hits = r.hits || [];
    const seqs = hits.map((h) => h.seq);
    const gold = c.gold || [];
    const ranks = gold.map((s) => { const i = seqs.indexOf(s); return i < 0 ? 0 : i + 1; });
    const best = ranks.filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
    out.push({ id: c.id, hit: best > 0 ? 1 : 0, rr: best > 0 ? 1 / best : 0, best, via: r.via, n: hits.length });
  }
  console.log('@@JSON@@' + JSON.stringify(out));
  process.exit(0);
}

const run = (dir) => {
  const raw = execFileSync(process.execPath, [__filename, '--child', dir], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(raw.split('\n').find((l) => l.indexOf('@@JSON@@') === 0).slice(8));
};
const A = run(path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'));   // 3 会话
const B = run(path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'));  // 79 会话
const n = A.length;

/* Wilcoxon 符号秩（正态近似 + 连续性校正），与 verify-swap-verdict.js 同口径 */
function wilcoxon(diffs) {
  const d = diffs.filter((x) => x !== 0);
  const N = d.length;
  if (N < 5) return { N, p: NaN };
  const abs = d.map((x) => Math.abs(x)).sort((x, y) => x - y);
  const rank = new Map();
  let i = 0;
  while (i < abs.length) {
    let j = i;
    while (j + 1 < abs.length && abs[j + 1] === abs[i]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank.set(abs[k], r);
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (const x of d) { const r = rank.get(Math.abs(x)); if (x > 0) Wp += r; else Wm += r; }
  const W = Math.min(Wp, Wm);
  const mu = N * (N + 1) / 4;
  const sd = Math.sqrt(N * (N + 1) * (2 * N + 1) / 24);
  const z = (W - mu + 0.5 * Math.sign(mu - W)) / sd;
  const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
  return { N, W: Wp, p: 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) };
}

const accA = A.filter((x) => x.hit).length;
const accB = B.filter((x) => x.hit).length;
const mrrA = A.reduce((s, x) => s + x.rr, 0) / n;
const mrrB = B.reduce((s, x) => s + x.rr, 0) / n;

console.log('=== ① 回填 76 会话对正例的净效应（配对，n=' + n + '）===');
console.log('           3 会话        79 会话        Δ');
console.log('  Recall@k ' + (100 * accA / n).toFixed(1) + '%'.padEnd(9) + (100 * accB / n).toFixed(1) + '%'.padEnd(10)
  + ((100 * (accB - accA) / n >= 0 ? '+' : '') + (100 * (accB - accA) / n).toFixed(2) + 'pp'));
console.log('  MRR      ' + mrrA.toFixed(4).padEnd(12) + mrrB.toFixed(4).padEnd(13)
  + ((mrrB - mrrA >= 0 ? '+' : '') + (mrrB - mrrA).toFixed(4)));

const dh = A.map((x, i) => x.hit - B[i].hit);   // 正 = 3库更好（退化）
const dr = A.map((x, i) => x.rr - B[i].rr);
const t1 = wilcoxon(dr.map((x) => -x));         // 79 库更好为正
console.log('\n  逐题变化：改进 ' + dh.filter((x) => x < 0).length + ' · 退化 ' + dh.filter((x) => x > 0).length
  + ' · 不变 ' + dh.filter((x) => x === 0).length);
const w = wilcoxon(dr.map((x) => -x));
console.log('  MRR 配对 Wilcoxon：N=' + w.N + ' p=' + (isFinite(w.p) ? w.p.toFixed(4) : 'n/a')
  + (isFinite(w.p) ? (w.p < 0.05 ? ' ⇒ 显著' : ' ⇒ 不显著') : ''));

console.log('\n=== ② 变化逐条（只看有位移的）===');
const changed = [];
for (let i = 0; i < n; i++) if (A[i].hit !== B[i].hit || Math.abs(A[i].rr - B[i].rr) > 1e-9) {
  changed.push({ id: A[i].id, from: A[i], to: B[i] });
}
changed.slice(0, 20).forEach((c) => {
  const dir = c.to.rr > c.from.rr ? '↑' : '↓';
  console.log('  ' + c.id.padEnd(6) + dir + ' 3库 rank=' + String(c.from.best || 'X').padEnd(3)
    + '→79库 rank=' + String(c.to.best || 'X').padEnd(3)
    + ' (' + c.from.via + '→' + c.to.via + ')');
});
if (changed.length > 20) console.log('  ... 共 ' + changed.length + ' 条有位移');

console.log('\n=== ③ 结论 ===');
if (Math.abs(mrrB - mrrA) < 1e-9) {
  console.log('  MRR 完全一致 ⇒ 回填对本批题目无影响。');
} else if (isFinite(w.p) && w.p >= 0.05) {
  console.log('  ΔMRR=' + (mrrB - mrrA).toFixed(4) + ' 但 p=' + w.p.toFixed(4) + ' ⇒ 不显著，视为噪声。');
} else {
  console.log('  ΔMRR=' + (mrrB - mrrA).toFixed(4) + ' p=' + w.p.toFixed(4) + ' ⇒ 显著，方向：'
    + (mrrB > mrrA ? '79 会话更好' : '79 会话更差'));
}
