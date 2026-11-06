/* probe-sumidf-pipeline.js — sumIdf 的 AUC 有 0.896，为何 MRR 只有 51.55%？
 *
 * 假说：rankRelevanceFirst 的重排把 sumIdf 的强序打乱了。
 *   现状流程：sumIdf → 定名次 → 分组 → 组内按 rankKey（新鲜度+重要度）重排
 *   如果 RANK_TIE=0 且按 score 判并列，理论上只重排真并列，不该乱。
 *
 * 对比四条流水线（都从同一个 OR 候选池出发）：
 *   P0 纯 sumIdf 降序，无任何重排
 *   P1 sumIdf 降序 → rankRelevanceFirst(现状参数)
 *   P2 bm25 降序 → rankRelevanceFirst
 *   P3 直接用产品 search()（含多样性去重、邻近过滤）
 * 这样能分离出「重排」和「多样性过滤」各自的损耗。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const A = require('./all-cases.js');
const cases = A.ALL.filter((c) => (c.gold || []).length > 0);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t JOIN seg s ON s.id = t.rid`;
const talk = db.prepare(`SELECT s.id, s.seq, s.pri, s.ts, s.h, s.text, COALESCE(s.dup,1) AS dup, COALESCE(s.last_hit_ts,0) AS last_hit_ts, t.score ${TAIL} WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}

const M = {};
for (const k of ['P0_sumIdf_only', 'P1_sumIdf_rerank', 'P2_bm25_rerank', 'P3_product', 'P4_sumIdf_dedup']) M[k] = { rr: 0, hit5: 0, hit8: 0, n: 0 };

const NOW = Date.now();

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rows.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const scored = rows.map((r) => {
    const t = String(r.text || '');
    let got = 0;
    for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
    return { r, seq: r.seq, sumIdf: got };
  });

  const measure = (name, arr) => {
    const i = arr.findIndex((x) => c.gold.includes(x.seq !== undefined ? x.seq : x.r.seq));
    M[name].n++;
    if (i >= 0) { M[name].rr += 1 / (i + 1); if (i < 5) M[name].hit5++; if (i < 8) M[name].hit8++; }
  };

  /* P0 纯 sumIdf */
  const p0 = scored.slice().sort((a, b) => b.sumIdf - a.sumIdf).slice(0, k);
  measure('P0_sumIdf_only', p0);

  /* P1 sumIdf → rankRelevanceFirst */
  const ordered = scored.slice().sort((a, b) => b.sumIdf - a.sumIdf);
  const p1 = ck.rankRelevanceFirst(
    ordered.map((x, i) => ({ r: x.r, rel: i })),
    NOW,
    { rankMode: true, rankTie: ck.RANK_TIE }
  ).slice(0, k).map((x) => ({ seq: x.r.seq }));
  measure('P1_sumIdf_rerank', p1);

  /* P2 bm25 → rankRelevanceFirst */
  const bm = scored.slice().sort((a, b) => a.r.score - b.r.score);
  const p2 = ck.rankRelevanceFirst(
    bm.map((x, i) => ({ r: x.r, rel: i })),
    NOW,
    { rankMode: true, rankTie: ck.RANK_TIE }
  ).slice(0, k).map((x) => ({ seq: x.r.seq }));
  measure('P2_bm25_rerank', p2);

  /* P4 sumIdf + 产品同款去重（h 相同、seq 相邻 ≤2） */
  const picked = [];
  const seenH = new Set();
  const take = (strict) => {
    for (const it of p0) {
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
  measure('P4_sumIdf_dedup', picked);

  /* P3 产品实际 */
  const r3 = ck._internal.search(c.sid, c.q, k);
  measure('P3_product', (r3.hits || []).map((h) => ({ seq: h.seq })));
}

console.log('流水线损耗拆解（109 题）\n');
console.log('流水线'.padEnd(20), 'MRR'.padStart(8), 'top5'.padStart(8), 'top8'.padStart(8));
for (const [k, m] of Object.entries(M)) {
  if (!m.n) continue;
  console.log(k.padEnd(20), (m.rr / m.n * 100).toFixed(2).padStart(7) + '%', ((m.hit5 / m.n) * 100).toFixed(1).padStart(7) + '%', ((m.hit8 / m.n) * 100).toFixed(1).padStart(7) + '%');
}
