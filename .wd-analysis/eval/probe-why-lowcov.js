/* probe-why-lowcov.js — 32 道难题的 gold 命中率只有 24%（3.0/12.5），原因是什么？
 *
 * 三个互斥假说：
 *   H1 查询里的词**在库里根本不存在**（用户用的是新说法）⇒ bigram_df=0 被过滤，属数据层问题
 *   H2 词存在，但 gold 那段**确实没写这些词**（指代消解：所说的是上文的"那个东西"）⇒ 语义问题，词面无解
 *   H3 索引把 gold 切坏了（跨段边界的 bigram 丢失）⇒ 索引层可修
 *
 * 判据：对每题 live（df>0）的 bigram，检查 gold 文本里是否存在**相邻两字的原文**。
 *   H2 的特征：gold 里含有某个 live bigram 的**单字**，但不含该 bigram ⇒ 只是分词/表述差异
 *   H3 的特征：gold 里连单字都不含，但相邻段落含 ⇒ 切段丢了上下文
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
const talk = db.prepare(`SELECT s.id, s.seq, s.text, t.score ${TAIL}
  WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}
const bySeq = db.prepare('SELECT seq, text FROM seg WHERE sid = ? AND seq BETWEEN ? AND ? ORDER BY seq');

let h1 = 0, h2 = 0, h3 = 0;
const detail = [];
let sumLive = 0, sumDf0 = 0, sumInGold = 0, sumCharOnly = 0, sumMissing = 0;

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
    let got = 0; const hp = [];
    for (const p of live) if (t.indexOf(p) >= 0) { got += w.get(p); hp.push(p); }
    if (got <= 0) continue;
    docs.push({ seq: r.seq, cov: got / wSum, text: t, hp });
  }
  const gi = docs.findIndex((d) => c.gold.includes(d.seq));
  if (gi < 0) continue;
  docs.sort((a, b) => b.cov - a.cov);
  const rank = docs.findIndex((d) => c.gold.includes(d.seq)) + 1;
  if (rank < 9) continue;
  const g = docs[rank - 1];
  const gseq = c.gold[0];
  const gtext = String(g.text);

  sumLive += live.length;
  sumDf0 += parts.length - live.length;   // 全库 df=0 的 bigram
  const missed = live.filter((p) => gtext.indexOf(p) < 0);
  sumInGold += live.length - missed.length;
  let charOnly = 0, missing = 0;
  for (const p of missed) {
    const c1 = p[0], c2 = p[1];
    /* 单字在 gold 里出现过吗？（说明"说的就是这件事，只是措辞不同"） */
    if (gtext.indexOf(c1) >= 0 || gtext.indexOf(c2) >= 0) charOnly++;
    else missing++;
  }
  sumCharOnly += charOnly;
  sumMissing += missing;

  /* H3 检验：gold 的**前后段**是否含这些缺失 bigram（切段丢上下文） */
  const nbr = bySeq.all(c.sid, gseq - 2, gseq + 2).filter((r) => r.seq !== gseq);
  const nbrText = nbr.map((r) => String(r.text || '')).join('\n');
  const inNbr = missed.filter((p) => nbrText.indexOf(p) >= 0).length;

  if (inNbr >= Math.max(2, missed.length * 0.5)) h3++;
  else if (charOnly >= missed.length * 0.5) h2++;
  else h1++;

  detail.push({ id: c.id, rank, live: live.length, df0: parts.length - live.length, missed: missed.length, charOnly, missing, inNbr, q: c.q.slice(0, 26) });
}

console.log('32 道难题的命中率来源分解\n');
console.log('id    名次 live df0  缺失  单字在  全缺  邻段有  判定');
for (const d of detail.sort((a, b) => a.rank - b.rank)) {
  const kind = d.inNbr >= Math.max(2, d.missed * 0.5) ? 'H3切段' : (d.charOnly >= d.missed * 0.5 ? 'H2指代' : 'H1新词');
  console.log(d.id.padEnd(5), String(d.rank).padStart(4), String(d.live).padStart(4), String(d.df0).padStart(3),
    String(d.missed).padStart(5), String(d.charOnly).padStart(6), String(d.missing).padStart(5), String(d.inNbr).padStart(6), '  ' + kind, ' ' + d.q);
}
console.log('\n合计：');
console.log('  查询 bigram 总数', sumLive + sumDf0, '| 其中全库 df=0：', sumDf0);
console.log('  gold 命中', sumInGold, '/', sumLive, '=', (sumInGold / sumLive * 100).toFixed(1) + '%');
console.log('  未命中里「单字在 gold 中」:', sumCharOnly, '（措辞差异/指代）');
console.log('  未命中里「单字也不在」   :', sumMissing, '（换说法/新词）');
console.log('\n假说归类：H1(新词) ' + h1 + ' / H2(指代) ' + h2 + ' / H3(切段) ' + h3);
