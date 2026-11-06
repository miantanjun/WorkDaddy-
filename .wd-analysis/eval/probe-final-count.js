/* probe-final-count.js — 用产品 idfOf 公式 + 端到端（含 rankRelevanceFirst / 多样性）验证等权 */
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
const NOW = Date.now();

const R = { idf: [], count: [], prod: [] };

function pipeline(rs, w, k) {
  const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
  const scored = rs.map((r) => {
    const t = String(r.text || '');
    let got = 0;
    for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
    return { r, cov: got / wSum };
  }).filter((x) => x.cov > 0);
  const order = scored.slice().sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
  const ranked = ck.rankRelevanceFirst(order.map((x, i) => ({ r: x.r, rel: i })), NOW, { rankMode: true, rankTie: ck.RANK_TIE });
  const picked = [];
  const seenH = new Set();
  const take = (strict) => {
    for (const it of ranked) {
      if (picked.length >= k) return;
      if (picked.indexOf(it) >= 0) continue;
      if (it.r.h && seenH.has(it.r.h)) continue;
      if (strict && picked.some((x) => Math.abs((x.r.seq || 0) - (it.r.seq || 0)) <= 2)) continue;
      picked.push(it);
      if (it.r.h) seenH.add(it.r.h);
    }
  };
  take(true);
  if (picked.length < k) take(false);
  return picked;
}

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;

  const wIdf = new Map(live.map((x) => [x.p, idfProd(x.df)]));
  const wCount = new Map(live.map((x) => [x.p, 1]));
  for (const [tag, w] of [['idf', wIdf], ['count', wCount]]) {
    const picked = pipeline(rs, w, k);
    const i = picked.findIndex((x) => c.gold.includes(x.r.seq));
    R[tag].push(i >= 0 ? 1 / (i + 1) : 0);
  }
  const res = ck._internal.search(c.sid, c.q, k);
  const hits = (res && res.hits) || [];
  const hi = hits.findIndex((h) => c.gold.includes(h.seq));
  R.prod.push(hi >= 0 ? 1 / (hi + 1) : 0);
}

const N = R.idf.length;
const m = (a) => a.reduce((x, y) => x + y, 0) / N * 100;
console.log('端到端验证（n=' + N + '，产品 idfOf 公式）\n');
console.log('  idf 加权（现状）  MRR=' + m(R.idf).toFixed(2) + '%');
console.log('  等权（不含 idf）  MRR=' + m(R.count).toFixed(2) + '%   Δ=' + (m(R.count) - m(R.idf) >= 0 ? '+' : '') + (m(R.count) - m(R.idf)).toFixed(2) + 'pp');
console.log('  产品 search()     MRR=' + m(R.prod).toFixed(2) + '%   （与 idf 复刻差 ' + (m(R.prod) - m(R.idf)).toFixed(2) + 'pp）');
let b = 0, w2 = 0, s2 = 0;
for (let i = 0; i < N; i++) { if (R.count[i] > R.idf[i]) b++; else if (R.count[i] < R.idf[i]) w2++; else s2++; }
console.log('\n  逐题：等权更好 ' + b + ' / 更差 ' + w2 + ' / 相同 ' + s2);
