/* probe-idf-ceiling.js — 用**正确 df 口径**（FTS5 doc 列 = 行数）重测纯词面天花板
 *
 * ⚠️⚠️⚠️ 本探针修的是此前一整套结论的口径错误：
 *   过去所有探针写 `COUNT(DISTINCT s.sid)` 取 df，而库里只有 3 个会话 ⇒ df ∈ {0,1,2,3}
 *   ⇒ idf = log(51394/(df+1))+1 全部落在 9.46~10.15，**差不到 7%**，权重几乎等于常数
 *   ⇒ cov 退化成「命中 bigram 的个数」，不是「IDF 加权覆盖率」。
 *   正确口径：temp.wd_vocab 的 doc 列（行数），最大 18393，idf 跨度 2.3~11.2。
 *
 * 对比：
 *   V0 不加权（纯命中个数 / 总数）        —— 复现旧探针的实际行为
 *   V1 IDF 加权（正确 df）               —— 产品名义实现
 *   V2 IDF² 加权（更激进压虚词）
 *   V3 只算稀有词（df < 1% 全库）的覆盖率
 *   V4 bm25（FTS5 原生，本身就有长度归一 + tf 饱和）
 *   V5 product search()（端到端）
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

const KEYS = ['V0_count', 'V1_idf', 'V2_idf2', 'V3_rare', 'V4_bm25', 'V5_product'];
const MRR = {}, HIT = {}, PER = {}, TIE = {};
for (const k of KEYS) { MRR[k] = 0; HIT[k] = 0; PER[k] = []; TIE[k] = 0; }
let n = 0;

/* idf 跨度统计，验证口径 */
let mn = 1e9, mx = -1e9;
for (const p of new Set(cases.flatMap((c) => ck.bigram(c.q).split(/\s+/).filter(Boolean)))) {
  const d = docDf(p);
  if (d > 0) { mn = Math.min(mn, idf(d)); mx = Math.max(mx, idf(d)); }
}
console.log('正确口径 idf 跨度: ' + mn.toFixed(2) + ' ~ ' + mx.toFixed(2) + '（全库 ' + total + ' 行）');
console.log('错误口径 idf 跨度: ' + idf(3).toFixed(2) + ' ~ ' + idf(1).toFixed(2) + '（只有 3 个会话）');
console.log('⇒ 旧口径下 idf 极差仅 ' + ((idf(1) - idf(3)) / idf(3) * 100).toFixed(1) + '%，权重几乎是常数\n');

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;
  n++;

  const W = {
    V0_count: new Map(live.map((x) => [x.p, 1])),
    V1_idf: new Map(live.map((x) => [x.p, idf(x.df)])),
    V2_idf2: new Map(live.map((x) => [x.p, Math.pow(idf(x.df), 2)])),
    V3_rare: new Map(live.map((x) => [x.p, x.df < total * 0.01 ? idf(x.df) : 0])),
  };
  for (const kk of ['V0_count', 'V1_idf', 'V2_idf2', 'V3_rare']) {
    const w = W[kk];
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: r.seq, s: got / wSum };
    }).sort((a, b) => b.s - a.s);
    const i = docs.findIndex((d) => c.gold.includes(d.seq));
    const rk = i + 1;
    const rr = rk <= k ? 1 / rk : 0;
    MRR[kk] += rr; if (rk <= 8) HIT[kk]++; PER[kk].push(rr);
    /* 与 TOP1 完全同分的题 */
    if (i > 0 && Math.abs(docs[i].s - docs[0].s) < 1e-12) TIE[kk]++;
  }
  /* V4 纯 bm25 */
  {
    const docs = rs.map((r) => ({ seq: r.seq, s: Number(r.score) || 0 })).sort((a, b) => a.s - b.s);
    const i = docs.findIndex((d) => c.gold.includes(d.seq));
    const rk = i + 1;
    const rr = rk <= k ? 1 / rk : 0;
    MRR.V4_bm25 += rr; if (rk <= 8) HIT.V4_bm25++; PER.V4_bm25.push(rr);
    if (i > 0 && Math.abs(docs[i].s - docs[0].s) < 1e-12) TIE.V4_bm25++;
  }
  /* V5 产品 */
  {
    const res = ck._internal.search(c.sid, c.q, k);
    const hits = (res && res.hits) || [];
    const hi = hits.findIndex((h) => c.gold.includes(h.seq));
    const rk = hi + 1;
    const rr = hi >= 0 ? 1 / rk : 0;
    MRR.V5_product += rr; if (hi >= 0) HIT.V5_product++; PER.V5_product.push(rr);
  }
}

console.log('题数', n, '\n');
console.log('键            MRR      HIT@8   与TOP1完全同分');
for (const kk of KEYS) {
  console.log(kk.padEnd(12), (MRR[kk] / n * 100).toFixed(2) + '%',
    '  ' + String(HIT[kk]).padStart(3) + '/' + n,
    '   ' + (TIE[kk] === undefined ? '-' : TIE[kk] + ' (' + (TIE[kk] / n * 100).toFixed(1) + '%)'));
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
  const cdf = z > 0 ? 1 - pr : pr;
  return { n: N, p: Math.min(1, 2 * (1 - (Math.abs(z) > 0 ? (Math.abs(z) > 0 ? cdfFor(Math.abs(z)) : 0.5) : 0.5))) };
}
function cdfFor(z) {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const pr = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - pr;
}
console.log('\n配对 Wilcoxon vs V1_idf（产品名义口径）：');
for (const kk of KEYS) {
  if (kk === 'V1_idf') continue;
  const w = wil(PER[kk], PER.V1_idf);
  const d = (MRR[kk] - MRR.V1_idf) / n * 100;
  console.log(' ', kk.padEnd(12), 'n=' + String(w.n).padStart(3), 'p=' + w.p.toFixed(4),
    (d >= 0 ? '+' : '') + d.toFixed(2) + 'pp', w.p < 0.05 ? '✅' : '—');
}
