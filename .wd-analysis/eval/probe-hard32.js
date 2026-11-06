/* probe-hard32.js — 名次 9+ 的 32 题是同一类问题，还是 32 个各自的问题？
 *
 * 如果是同一类（比如 gold 文本超长 / gold 被截断 / gold 是转述），那是**数据层**能修的；
 * 如果各自不同，那就是词面方法的真实边界，继续磨参数毫无意义。
 *
 * 逐题记录：gold 长度、TOP1 长度、gold 的 cov、gold nhit/查询 bigram 总数、
 *          gold 是否包含查询里的**数字/英文标识符**（强信号）
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
const talk = db.prepare(`SELECT s.id, s.seq, s.pri, s.ts, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}

const rowsOut = [];
for (const c of cases) {
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rs = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rs.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const docs = [];
  for (const r of rs) {
    const t = String(r.text || '');
    let got = 0, nh = 0;
    for (const p of live) if (t.indexOf(p) >= 0) { got += w.get(p); nh++; }
    if (got <= 0) continue;
    docs.push({ seq: r.seq, cov: got / wSum, nh, len: t.length, text: t });
  }
  const gi = docs.findIndex((d) => c.gold.includes(d.seq));
  if (gi < 0) continue;
  docs.sort((a, b) => b.cov - a.cov);
  const rank = docs.findIndex((d) => c.gold.includes(d.seq)) + 1;
  if (rank < 9) continue;
  const g = docs[rank - 1], top = docs[0];
  /* 查询里的「硬标识符」：数字串 / 英文串 —— 命中了这些本该是决定性的 */
  const nums = c.q.match(/[0-9][0-9.,]*/g) || [];
  const lats = c.q.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g) || [];
  const hard = [...nums, ...lats];
  const goldHitHard = hard.filter((h) => g.text.indexOf(h) >= 0).length;
  rowsOut.push({
    id: c.id, cat: c.cat, rank, covG: g.cov, covTop: top.cov, nhit: g.nh, nlive: live.length,
    lenG: g.len, lenTop: top.len, hard: hard.length, hardHit: goldHitHard,
    q: c.q.slice(0, 30),
  });
}

console.log('名次 9+ 的题共', rowsOut.length, '道\n');
console.log('id     名次  cov(gold) cov(TOP1) nhit/nlive  lenG  lenTop  硬标识符命中');
for (const r of rowsOut.sort((a, b) => a.rank - b.rank)) {
  console.log(
    r.id.padEnd(6),
    String(r.rank).padStart(3),
    '  ' + r.covG.toFixed(3) + '    ' + r.covTop.toFixed(3),
    '   ' + r.nhit + '/' + r.nlive,
    '     ' + String(r.lenG).padStart(4),
    '  ' + String(r.lenTop).padStart(4),
    '   ' + r.hardHit + '/' + r.hard,
    '  ' + r.q
  );
}

const avg = (f) => (rowsOut.reduce((s, r) => s + f(r), 0) / rowsOut.length);
console.log('\n汇总：');
console.log('  gold 平均长度', avg((r) => r.lenG).toFixed(0), '| TOP1 平均长度', avg((r) => r.lenTop).toFixed(0));
console.log('  gold 平均 cov', avg((r) => r.covG).toFixed(3), '| TOP1 平均 cov', avg((r) => r.covTop).toFixed(3));
console.log('  gold 平均命中 bigram', avg((r) => r.nhit).toFixed(1), '/', avg((r) => r.nlive).toFixed(1));
const withHard = rowsOut.filter((r) => r.hard > 0);
console.log('  查询含硬标识符的题:', withHard.length, '/', rowsOut.length,
  '| 其中 gold 命中了全部硬标识符:', withHard.filter((r) => r.hardHit === r.hard).length);
const covGap = rowsOut.map((r) => r.covTop - r.covG).sort((a, b) => a - b);
console.log('  cov 差距 p50=' + covGap[Math.floor(covGap.length / 2)].toFixed(3),
  'p90=' + covGap[Math.floor(covGap.length * 0.9)].toFixed(3));
