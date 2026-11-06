/* probe-refer.js — 32 道难题是「方法边界」还是「造题口径」？
 *
 * 上一版的「单字在 gold 中」判据是废的：只要任一单字出现就算，而中文常用字到处都是。
 * 换成两个有判别力的结构性指标：
 *   ① 查询的**内容词密度**：查询 bigram 里 df 低的（真内容词）占多少，df 高的（虚词组合）占多少
 *   ② gold 与提问的**轮次距离**：(提问所在 seq) - (gold seq)。近 = 上下文指代，词面原理上无解
 * 如果 32 题普遍是「高虚词密度 + 近轮次」，结论就是造题口径问题，不是排序算法问题。
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
const talk = db.prepare(`SELECT s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}
/* 提问所在 seq：库里 user 行文本与用例 q 最像的那条 */
const userRows = db.prepare(`SELECT seq, text FROM seg WHERE sid = ? AND kind='user' ORDER BY seq`);

function qseqOf(sid, q) {
  const rs = userRows.all(sid);
  let best = null, bestScore = -1;
  for (const r of rs) {
    const t = String(r.text || '');
    if (t.indexOf(q.slice(0, 8)) >= 0) return r.seq;   // 前 8 字直接命中即可
    /* 退一步：共同 bigram 数 */
    const qb = new Set(ck.bigram(q).split(/\s+/).filter(Boolean));
    let sc = 0;
    for (const b of qb) if (t.indexOf(b) >= 0) sc++;
    if (sc > bestScore) { bestScore = sc; best = r.seq; }
  }
  return best;
}

const rows = [];
for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const dfs = parts.map((p) => ({ p, df: dfOf(p) }));
  const live = dfs.filter((x) => x.df > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map((x) => esc(x.p)).join(' OR '), c.sid);
  if (!rs.length) continue;
  const w = new Map(live.map((x) => [x.p, idf(x.df)]));
  const wSum = live.reduce((s, x) => s + w.get(x.p), 0) || 1;
  const docs = [];
  for (const r of rs) {
    const t = String(r.text || '');
    let got = 0;
    for (const x of live) if (t.indexOf(x.p) >= 0) got += w.get(x.p);
    if (got > 0) docs.push({ seq: r.seq, cov: got / wSum });
  }
  const gi = docs.findIndex((d) => c.gold.includes(d.seq));
  if (gi < 0) continue;
  docs.sort((a, b) => b.cov - a.cov);
  const rank = docs.findIndex((d) => c.gold.includes(d.seq)) + 1;

  /* 内容词 = df < 会话总行数的 5%；虚词 bigram ≈ df 接近全库 */
  const hiDf = live.filter((x) => x.df > total * 0.20).length;   // 高 df 组合
  const loDf = live.filter((x) => x.df < total * 0.02).length;   // 真内容词
  const qseq = qseqOf(c.sid, c.q);
  const dist = qseq == null ? null : Math.abs(c.gold[0] - qseq);

  rows.push({ id: c.id, cat: c.cat, rank, nlive: live.length, hiDf, loDf, dist, q: c.q.slice(0, 26) });
}

const hard = rows.filter((r) => r.rank >= 9);
const easy = rows.filter((r) => r.rank < 9);
const avg = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0) / (a.length || 1);

console.log('内容词密度 / 轮次距离：难题(9+) vs 易题(1~8)\n');
console.log('                      难题 n=' + hard.length + '     易题 n=' + easy.length);
console.log('  高df bigram 占比   ', (avg(hard, (r) => r.hiDf / r.nlive) * 100).toFixed(1) + '%   ',
  (avg(easy, (r) => r.hiDf / r.nlive) * 100).toFixed(1) + '%');
console.log('  低df 内容词 占比   ', (avg(hard, (r) => r.loDf / r.nlive) * 100).toFixed(1) + '%   ',
  (avg(easy, (r) => r.loDf / r.nlive) * 100).toFixed(1) + '%');
console.log('  gold↔提问 轮次距离 ', avg(hard, (r) => r.dist).toFixed(0).padStart(5), '  ',
  avg(easy, (r) => r.dist).toFixed(0).padStart(5));
const hd = hard.map((r) => r.dist).filter((x) => x != null).sort((a, b) => a - b);
const ed = easy.map((r) => r.dist).filter((x) => x != null).sort((a, b) => a - b);
console.log('  轮次距离 中位数     ', hd[Math.floor(hd.length / 2)], '  ', ed[Math.floor(ed.length / 2)]);

console.log('\n难题逐题：');
console.log('id    名次 nlive 高df 低df 轮次距离  分类');
for (const r of hard.sort((a, b) => a.rank - b.rank)) {
  console.log(r.id.padEnd(5), String(r.rank).padStart(4), String(r.nlive).padStart(5), String(r.hiDf).padStart(4),
    String(r.loDf).padStart(4), String(r.dist == null ? '-' : r.dist).padStart(7), '  ' + r.cat, ' ' + r.q);
}
