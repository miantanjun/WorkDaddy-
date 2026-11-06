/* probe-weights.js — 正确 df 口径下，cov 的权重方案还能不能优化？
 *
 * 背景修正：旧探针用 COUNT(DISTINCT sid) 当 df（最多 3）⇒ idf 塌缩成常数
 * ⇒ 「45.4% 假并列」「纯词面到顶」都是**错误前提下的结论**，作废。
 * 正确口径下真并列只有 2.8%，所以问题不是「破并列」，而是「权重方案」和「gold 压根没写这些词」。
 *
 * 测 8 种权重（都是 cov = Σw(命中) / Σw(全部)）：
 *   W1 idf（现状）        W2 不加权（计数）      W3 sqrt(idf)
 *   W4 idf 上限 6        W5 idf 归一化到 1~2    W6 三段分桶（df<1%=3, <10%=2, else=1）
 *   W7 idf × tf 饱和      W8 idf 但只算 df<5% 的词
 * 以及两个二阶方案：
 *   S1 cov 选前 30 → bm25 重排
 *   S2 cov + 0.3*bm25 归一化合成
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('main','seg_fts','row')");
const A = require('./all-cases.js');
const cases = A.ALL.filter((c) => (c.gold || []).length > 0);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const docDf = (p) => {
  try { const r = db.prepare('SELECT doc FROM temp.wd_vocab WHERE term = ?').get(String(p).toLowerCase()); return r ? Number(r.doc) : 0; }
  catch (_) { return 0; }
};
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);

const WM = {
  W1_idf: (d) => idf(d),
  W2_count: () => 1,
  W3_sqrt: (d) => Math.sqrt(idf(d)),
  W4_cap6: (d) => Math.min(idf(d), 6),
  W5_norm: (d) => 1 + (idf(d) - 2.03) / (11.15 - 2.03),      // 归一化到 1~2，压住极稀有
  W6_bucket: (d) => (d < total * 0.01 ? 3 : d < total * 0.10 ? 2 : 1),
  W7_idf5pct: (d) => (d < total * 0.05 ? idf(d) : 0),
  W8_log2: (d) => 1 + Math.log2(Math.max(1, total / (d + 1))),
};
const KEYS = [...Object.keys(WM), 'S1_cov30_bm25', 'S2_blend', 'S3_prod'];
const MRR = {}, HIT = {}, PER = {};
for (const k of KEYS) { MRR[k] = 0; HIT[k] = 0; PER[k] = []; }
let n = 0;

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;
  n++;

  const tf = (t, p) => { let c2 = 0, f = 0; for (;;) { const at = t.indexOf(p, f); if (at < 0) break; c2++; f = at + 1; } return c2; };

  const res = {};
  for (const [tag, wf] of Object.entries(WM)) {
    const w = new Map(live.map((x) => [x.p, wf(x.df)]));
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: r.seq, s: got / wSum, bm: Number(r.score) || 0 };
    }).sort((a, b) => b.s - a.s || a.bm - b.bm);
    res[tag] = docs;
  }
  /* S1：cov 前 30 → bm25 重排 */
  {
    const base = res.W1_idf.slice(0, 30).sort((a, b) => a.bm - b.bm);
    res.S1_cov30_bm25 = base.concat(res.W1_idf.slice(30));
  }
  /* S2：cov 与 bm25 各归一化后加权 */
  {
    const covs = res.W1_idf.map((d) => d.s);
    const bms = res.W1_idf.map((d) => d.bm);
    const mnC = Math.min(...covs), mxC = Math.max(...covs);
    const mnB = Math.min(...bms), mxB = Math.max(...bms);
    const norm = (v, mn, mx) => (mx - mn < 1e-12 ? 0 : (v - mn) / (mx - mn));
    res.S2_blend = res.W1_idf.map((d) => ({ ...d, s2: 0.7 * norm(d.s, mnC, mxC) + 0.3 * (1 - norm(d.bm, mnB, mxB)) }))
      .sort((a, b) => b.s2 - a.s2);
  }
  for (const tag of Object.keys(WM).concat(['S1_cov30_bm25', 'S2_blend'])) {
    const docs = res[tag];
    const i = docs.findIndex((d) => c.gold.includes(d.seq));
    const rk = i + 1;
    const rr = rk <= k ? 1 / rk : 0;
    MRR[tag] += rr; if (rk <= 8) HIT[tag]++; PER[tag].push(rr);
  }
  {
    const r2 = ck._internal.search(c.sid, c.q, k);
    const hits = (r2 && r2.hits) || [];
    const hi = hits.findIndex((h) => c.gold.includes(h.seq));
    const rr = hi >= 0 ? 1 / (hi + 1) : 0;
    MRR.S3_prod += rr; if (hi >= 0) HIT.S3_prod++; PER.S3_prod.push(rr);
  }
}

console.log('权重方案对比（' + n + ' 题，正确 df 口径）\n');
const base = MRR.W1_idf / n * 100;
console.log('方案              MRR      HIT@8   vs W1_idf');
for (const kk of KEYS) {
  const m = MRR[kk] / n * 100;
  console.log(kk.padEnd(14), m.toFixed(2) + '%', '  ' + String(HIT[kk]).padStart(3) + '/' + n,
    '  ' + ((m - base) >= 0 ? '+' : '') + (m - base).toFixed(2) + 'pp');
}

function wil(a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; if (Math.abs(x) > 1e-12) d.push(x); }
  const N = d.length;
  if (N < 3) return { n: N, p: 1 };
  const ab = d.map(Math.abs).sort((x, y) => x - y);
  let Wp = 0;
  for (const x of d) {
    const ax = Math.abs(x);
    const i = ab.findIndex((v) => Math.abs(v - ax) < 1e-12);
    let j = i;
    while (j + 1 < ab.length && Math.abs(ab[j + 1] - ax) < 1e-12) j++;
    if (x > 0) Wp += (i + j) / 2 + 1;
  }
  const Wn = N * (N + 1) / 2 - Wp;
  const W = Math.min(Wp, Wn);
  const mu = N * (N + 1) / 4, sd = Math.sqrt(N * (N + 1) * (2 * N + 1) / 24);
  const z = (W - mu) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const dd = 0.3989423 * Math.exp(-z * z / 2);
  const pr = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdfA = 1 - pr;
  return { n: N, p: Math.min(1, 2 * (1 - cdfA)) };
}
console.log('\n配对 Wilcoxon vs W1_idf：');
for (const kk of KEYS) {
  if (kk === 'W1_idf') continue;
  const w = wil(PER[kk], PER.W1_idf);
  const d = (MRR[kk] - MRR.W1_idf) / n * 100;
  console.log(' ', kk.padEnd(14), 'n=' + String(w.n).padStart(3), 'p=' + w.p.toFixed(4),
    ((d >= 0 ? '+' : '') + d.toFixed(2) + 'pp').padStart(9), w.p < 0.05 ? '✅ 显著' : '—');
}
