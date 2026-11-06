/* probe-swap-weight.js — 端到端验证：把 cov 权重从 idf 改成等权，产品 search() 会怎样？
 *
 * ⚠️ 只在**运行时**替换模块内的 idfOf/termDf 行为不可行（cov 在 search 内部算），
 *   所以采用「复刻 search 的 OR 分支 + 走真实 diversity/rankRelevanceFirst」的方式，
 *   与 probe-sumidf-pipeline 的 P4 同构。同时对照真实 search()。
 *
 * 关键：两版都必须过 rankRelevanceFirst（production 参数），否则测的就不只是权重。
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
const talk = db.prepare(`SELECT s.id, s.seq, s.ts, s.text, s.h, s.pri, COALESCE(s.last_hit_ts,0) AS last_hit_ts, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);

const NOW = Date.now();
const M = { A_idf: 0, B_count: 0, C_prod: 0 };
const P = { A_idf: [], B_count: [], C_prod: [] };
let n = 0;

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;

  for (const [tag, wf] of [['A_idf', (d) => idf(d)], ['B_count', () => 1]]) {
    const w = new Map(live.map((x) => [x.p, wf(x.df)]));
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const scored = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { r, cov: got / wSum };
    }).filter((x) => x.cov > 0);
    const order = scored.slice().sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
    let ranked = ck.rankRelevanceFirst(order.map((x, i) => ({ r: x.r, rel: i })), NOW, { rankMode: true, rankTie: ck.RANK_TIE });
    /* 复刻 diversity（同 h 去重 + seq ±2 邻近过滤） */
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
    const idx = picked.findIndex((x) => c.gold.includes(x.r.seq));
    const rr = idx >= 0 ? 1 / (idx + 1) : 0;
    M[tag] += rr; P[tag].push(rr);
  }
  const res = ck._internal.search(c.sid, c.q, k);
  const hits = (res && res.hits) || [];
  const hi = hits.findIndex((h) => c.gold.includes(h.seq));
  const rr = hi >= 0 ? 1 / (hi + 1) : 0;
  M.C_prod += rr; P.C_prod.push(rr);
  n++;
}

console.log('端到端（含 rankRelevanceFirst + 多样性去重，n=' + n + '）\n');
console.log('A_idf   （现状）  MRR=' + (M.A_idf / n * 100).toFixed(2) + '%');
console.log('B_count （等权）  MRR=' + (M.B_count / n * 100).toFixed(2) + '%   Δ=' +
  ((M.B_count - M.A_idf) / n * 100 >= 0 ? '+' : '') + ((M.B_count - M.A_idf) / n * 100).toFixed(2) + 'pp');
console.log('C_prod  （真实）  MRR=' + (M.C_prod / n * 100).toFixed(2) + '%');
console.log('\nA 与 C 应基本一致（差在 AND 分支与回写），若差很大说明复刻有出入。');

let better = 0, worse = 0, same = 0;
for (let i = 0; i < n; i++) {
  if (P.B_count[i] > P.A_idf[i]) better++;
  else if (P.B_count[i] < P.A_idf[i]) worse++;
  else same++;
}
console.log('逐题：B 更好 ' + better + ' / 更差 ' + worse + ' / 相同 ' + same);
