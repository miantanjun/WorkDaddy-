/* probe-ceiling.js — 纯词面信号的天花板在哪？
 *
 * 已知：sumIdf 的 AUC=0.896，但 MRR 只有 50%。
 * 需要回答：这是「排序键不够好」还是「词面信号本身到顶」？
 *
 * 关键检验：**oracle 组合**——把 gold 的排名按各特征的最优组合来算。
 * 如果连「手工给每题挑最好的特征」都上不去，就证明是信号问题。
 * 另外统计：gold 与 TOP1 的 sumIdf 差距分布，看有多少题是"真的分不开"。
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
const talk = db.prepare(`SELECT s.id, s.seq, s.pri, s.ts, s.text, t.score ${TAIL} WHERE s.sid = ? AND s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
const idf = (d) => Math.log((total + 1) / (d + 1)) + 1;
const DF = new Map();
function dfOf(p) {
  if (DF.has(p)) return DF.get(p);
  const n = db.prepare('SELECT COUNT(DISTINCT s.sid) c FROM seg_fts f JOIN seg s ON s.id=f.rowid WHERE seg_fts MATCH ?').get(esc(p)).c;
  DF.set(p, n); return n;
}

let n = 0;
let goldIsTop1BySumIdf = 0;
const gaps = [];          /* gold 与最高分候选的 sumIdf 差距 */
const ranks = [];         /* gold 按 sumIdf 的名次 */
let tiesAtGold = [];      /* 与 gold 同分的候选数 */

for (const c of cases) {
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
    return { seq: r.seq, sumIdf: got };
  }).sort((a, b) => b.sumIdf - a.sumIdf);
  const gi = scored.findIndex((x) => c.gold.includes(x.seq));
  if (gi < 0) continue;
  n++;
  ranks.push(gi + 1);
  if (gi === 0) goldIsTop1BySumIdf++;
  gaps.push(scored[0].sumIdf - scored[gi].sumIdf);
  tiesAtGold.push(scored.filter((x) => x.sumIdf === scored[gi].sumIdf).length);
}

const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };

console.log('纯 sumIdf 排序的天花板诊断（' + n + ' 题，gold 均在池中）\n');
console.log('gold 排第 1 的比例:', (goldIsTop1BySumIdf / n * 100).toFixed(1) + '%');
console.log('gold 名次分布: p10=' + pct(ranks, 0.1) + ' p25=' + pct(ranks, 0.25) + ' p50=' + pct(ranks, 0.5) + ' p75=' + pct(ranks, 0.75) + ' p90=' + pct(ranks, 0.9));
console.log('gold 与 TOP1 的 sumIdf 差距: p10=' + pct(gaps, 0.1).toFixed(2) + ' p50=' + pct(gaps, 0.5).toFixed(2) + ' p90=' + pct(gaps, 0.9).toFixed(2));
console.log('与 gold 同分的候选数: p50=' + pct(tiesAtGold, 0.5) + ' max=' + Math.max(...tiesAtGold));
console.log();

/* 差距为零的题 = 完全分不开 */
const zeroGap = gaps.filter((g) => g === 0).length;
const smallGap = gaps.filter((g) => g > 0 && g < 11.15).length;  /* 小于一个词的权重 */
console.log('差距 = 0（完全同分，词面无法区分）:', zeroGap, '(' + (zeroGap / n * 100).toFixed(1) + '%)');
console.log('差距 < 一个词权重（几乎分不开）  :', smallGap, '(' + (smallGap / n * 100).toFixed(1) + '%)');
console.log();

/* 分层：gold 名次 1 vs 2~4 vs 5+ */
const tier = (lo, hi) => ranks.filter((r) => r >= lo && r <= hi).length;
console.log('名次 1       :', tier(1, 1));
console.log('名次 2~4     :', tier(2, 4), ' ← 换位能力区间');
console.log('名次 5~8     :', tier(5, 8));
console.log('名次 9+      :', ranks.filter((r) => r >= 9).length, ' ← 需要更强信号才能救');
