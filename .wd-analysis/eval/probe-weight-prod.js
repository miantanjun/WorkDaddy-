/* probe-weight-prod.js — 用**产品真实 idfOf** 重跑权重对比
 *
 * ⚠️⚠️ 前面 probe-weights.js 用的是我自写的 idf = log((N+1)/(df+1))+1（范围 1.0~11.2），
 *   而产品 idfOf 是 BM25 标准形式 log((N-df+0.5)/(df+0.5)+1)（范围 **0.0~10.4**）。
 *   差别是决定性的：产品的公式在 df=N 时给 **0**，即「全库都有的词权重为零」；
 *   我的公式给 1.0，仍然参与分母 ⇒ 虚词在分母里占便宜、在分子的命中里也算分。
 *   ⇒ 必须用产品公式重算，否则「等权更好」这个结论可能不成立。
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
const idfProd = (df) => (df > 0 && total > 0 ? Math.log((total - df + 0.5) / (df + 0.5) + 1) : 0);
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.id, s.seq, s.ts, s.text, s.h, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);

const WM = {
  P_idf: (d) => idfProd(d),                                  // 产品现状
  P_count: () => 1,                                          // 等权
  P_idf_floor: (d) => Math.max(0.05, idfProd(d)),            // 产品式 + 下限（防 0 权重）
  P_idf_sqrt: (d) => Math.sqrt(idfProd(d) + 0.05),
  P_idf_cap: (d) => Math.min(idfProd(d), 6),
  P_idf_mix: (d) => 0.5 * idfProd(d) + 1,                    // 折半 + 常数底
};
const KEYS = Object.keys(WM);
const MRR = {}, HIT = {}, PER = {};
for (const k of KEYS) { MRR[k] = 0; HIT[k] = 0; PER[k] = []; }
let n = 0, zeroW = 0, allZero = 0;

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;
  n++;
  const zeros = live.filter((x) => idfProd(x.df) < 1e-9).length;
  zeroW += zeros;
  if (zeros === live.length) allZero++;

  for (const [tag, wf] of Object.entries(WM)) {
    const w = new Map(live.map((x) => [x.p, wf(x.df)]));
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: r.seq, s: got / wSum, bm: Number(r.score) || 0 };
    }).sort((a, b) => b.s - a.s || a.bm - b.bm);
    const i = docs.findIndex((d) => c.gold.includes(d.seq));
    const rk = i + 1;
    const rr = rk <= k ? 1 / rk : 0;
    MRR[tag] += rr; if (rk <= 8) HIT[tag]++; PER[tag].push(rr);
  }
}

console.log('产品 idfOf 口径下的权重对比（' + n + ' 题）');
console.log('⚠️ 全库 idf=0 的 bigram 共', zeroW, '个；' + allZero + ' 道题的全部 bigram idf 都是 0\n');
const base = MRR[KEYS[0]] / n * 100;
console.log('方案            MRR      HIT@8   vs 现状');
for (const kk of KEYS) {
  const m = MRR[kk] / n * 100;
  console.log(kk.padEnd(13), m.toFixed(2) + '%', '  ' + String(HIT[kk]).padStart(3) + '/' + n,
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
  return { n: N, p: Math.min(1, 2 * (1 - (1 - pr))) };
}
console.log('\n配对 Wilcoxon vs 现状：');
for (const kk of KEYS) {
  if (kk === KEYS[0]) continue;
  const w = wil(PER[kk], PER[KEYS[0]]);
  const d = (MRR[kk] - MRR[KEYS[0]]) / n * 100;
  console.log(' ', kk.padEnd(13), 'n=' + String(w.n).padStart(3), 'p=' + w.p.toFixed(4),
    ((d >= 0 ? '+' : '') + d.toFixed(2) + 'pp').padStart(9), w.p < 0.05 ? '✅' : '—');
}
