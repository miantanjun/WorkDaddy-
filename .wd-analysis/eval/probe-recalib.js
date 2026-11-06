/* probe-recalib.js — 正确 df 口径下的核心诊断重算
 *
 * 修正的错误：所有旧探针用 COUNT(DISTINCT sid) 当 df ⇒ 只有 3 个会话 ⇒ idf 极差 6.6%
 * ⇒ cov ≈ 命中计数 ⇒ 大量假并列。产品本身用的是 temp.wd_vocab.doc（正确），
 * **错的只是诊断脚本**，所以产品的 47.5% 一直是真的，错的是我们对它的解释。
 *
 * 重算四项：
 *   ① gold 名次分布（按正确 cov）
 *   ② 各特征 AUC（sumIdf / bm25 / pri / fresh / len）
 *   ③ 与 TOP1 真并列的比例
 *   ④ gold 不在 top8 的题逐题归因
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
const talk = db.prepare(`SELECT s.seq, s.text, s.pri, s.ts, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const NOW = Date.now();
const recency = (ts) => { const d = Math.max(0, (NOW - (Number(ts) || 0)) / 86400000); return Math.pow(0.5, d / 30); };
const imp = (pri) => (Number(pri) === 2 ? 0.40 : Number(pri) === 1 ? 0.20 : 0.10);

const ranks = [];
const feats = { sumIdf: [], bm25: [], pri: [], fresh: [], len: [], cov: [] };
let ties = 0, n = 0;
const bad = [];

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  const gi0 = rs.findIndex((r) => c.gold.includes(r.seq));
  if (gi0 < 0) { console.log('  ⚠️ gold 不在池中:', c.id); continue; }
  n++;
  const w = new Map(live.map((x) => [x.p, idf(x.df)]));
  const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
  const docs = rs.map((r) => {
    const t = String(r.text || '');
    let got = 0;
    for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
    return {
      seq: r.seq, cov: got / wSum, sumIdf: got, bm25: Number(r.score) || 0,
      pri: Number(r.pri) || 0, ts: Number(r.ts) || 0, len: t.length,
      isGold: c.gold.includes(r.seq),
    };
  });
  docs.sort((a, b) => b.cov - a.cov);
  const gi = docs.findIndex((d) => d.isGold);
  const rk = gi + 1;
  ranks.push(rk);
  if (gi > 0 && Math.abs(docs[gi].cov - docs[0].cov) < 1e-12) ties++;
  for (const f of Object.keys(feats)) {
    const d = docs[gi];
    const v = f === 'fresh' ? recency(d.ts) : f === 'pri' ? imp(d.pri) : d[f];
    feats[f].push(v);
  }
  if (rk > 8) {
    const g = docs[gi], t0 = docs[0];
    bad.push({
      id: c.id, cat: c.cat, rank: rk, covG: g.cov, covT: t0.cov,
      sumIdfG: g.sumIdf, sumIdfT: t0.sumIdf, bm25G: g.bm25, bm25T: t0.bm25,
      lenG: g.len, lenT: t0.len, pool: docs.length, q: c.q.slice(0, 30),
    });
  }
}

const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log('题数', n, '\n');
console.log('① gold 名次（正确 cov 排序）:');
console.log('   名次 1   :', ranks.filter((r) => r === 1).length);
console.log('   名次 2~4 :', ranks.filter((r) => r >= 2 && r <= 4).length);
console.log('   名次 5~8 :', ranks.filter((r) => r >= 5 && r <= 8).length);
console.log('   名次 9~30:', ranks.filter((r) => r >= 9 && r <= 30).length);
console.log('   名次 31+ :', ranks.filter((r) => r > 30).length);
console.log('   中位名次 :', pct(ranks, 0.5), '| p90:', pct(ranks, 0.9));

console.log('\n② 各特征 AUC（区分 gold 与非 gold 的能力，0.5 = 无用）:');
/* 简化 AUC：逐题算「随机抽一个非 gold 候选，gold 分更高的概率」 */
for (const f of Object.keys(feats)) {
  let tot = 0, cnt = 0;
  for (const c of cases) {
    const k = c.k || 8;
    const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
    const live = parts.map((p) => ({ p, df: docDf(p) })).filter((x) => x.df > 0);
    if (!live.length) continue;
    const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
    if (!rs.length) continue;
    if (rs.findIndex((r) => c.gold.includes(r.seq)) < 0) continue;
    const w = new Map(live.map((x) => [x.p, idf(x.df)]));
    const wSum = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    const docs = rs.map((r) => {
      const t = String(r.text || '');
      let got = 0;
      for (const [p, ww] of w) if (t.indexOf(p) >= 0) got += ww;
      return { seq: r.seq, cov: got / wSum, sumIdf: got, bm25: Number(r.score) || 0, pri: Number(r.pri) || 0, ts: Number(r.ts) || 0, len: t.length, isGold: c.gold.includes(r.seq) };
    });
    const g = docs.find((d) => d.isGold);
    const others = docs.filter((d) => !d.isGold);
    if (!g || !others.length) continue;
    const val = (d) => (f === 'fresh' ? recency(d.ts) : f === 'pri' ? imp(d.pri) : d[f]);
    const higher = f === 'bm25' ? others.filter((d) => val(d) > val(g)).length : others.filter((d) => val(d) < val(g)).length;
    tot += higher / others.length;
    cnt++;
  }
  console.log('   ' + f.padEnd(8), 'AUC=' + (1 - tot / cnt).toFixed(4));
}

console.log('\n③ 与 TOP1 完全同分（正确口径）:', ties, '/', n, '=', (ties / n * 100).toFixed(1) + '%');
console.log('   ⚠️ 旧探针报的是 46/108 = 45.4% —— 那是 idf 塌缩成常数导致的假并列。');

console.log('\n④ gold 不在 top8 的', bad.length, '道：');
console.log('id    名次 池 covG  covT  sumIdfG sumIdfT  bm25G  bm25T  lenG lenT  查询');
for (const b of bad.sort((a, b) => a.rank - b.rank)) {
  console.log(b.id.padEnd(5), String(b.rank).padStart(4), String(b.pool).padStart(4),
    b.covG.toFixed(2), b.covT.toFixed(2),
    b.sumIdfG.toFixed(1).padStart(7), b.sumIdfT.toFixed(1).padStart(7),
    b.bm25G.toFixed(1).padStart(7), b.bm25T.toFixed(1).padStart(7),
    String(b.lenG).padStart(5), String(b.lenT).padStart(5), ' ' + b.q);
}
