/* probe-proximity.js — 49 题「与 TOP1 的 sumIdf 完全相等」时的最后一个未测维度：邻近度
 *
 * 已知：45.4%（49/108）的题，gold 与 TOP1 命中的 bigram 集合完全相同 ⇒ 任何基于
 *   「命中了哪些词」的权重（sumIdf / cov / bm25 的 tf 部分）都不可能分开它们。
 *   唯一剩下的词面差异是**这些词在文中是否集中**：
 *     文档 A：「尾款……（3000 字无关内容）……231,472.08」
 *     文档 B：「尾款 USD 231,472.08 未付」  ← 显然更相关
 *   两者 bigram 集合可能相同，但 A 的最小覆盖窗口跨度远大于 B。
 *
 * 测四个排序键（同 cov 组内的定序方式）：
 *   B0 现状口径：cov desc → bm25 asc（产品 OR 路的次级键）
 *   B1 cov desc → 最小覆盖窗口 span asc（越小越集中）
 *   B2 cov desc → span asc → bm25 asc
 *   B3 cov desc → 窗口密度 (distinct/span) desc
 *
 * ⚠️ 只看 tied 子集的变化不够 —— 救 10 害 5 净 0 的情况在这套评测里出现过（Recall@k 零和）。
 *   必须同时报全量 MRR + 配对 Wilcoxon。
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

/* 最小覆盖窗口：找一个最短区间，里面至少出现每个**已命中** bigram 各一次。
 * ⚠️ catch 绝不能返回「看起来正常」的值 —— 失败要显式标 Infinity 并在统计里体现。 */
function minSpan(text, parts) {
  const occ = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let from = 0;
    for (;;) {
      const at = text.indexOf(p, from);
      if (at < 0) break;
      occ.push([at, i]);
      from = at + 1;
      if (occ.length > 4000) break;
    }
  }
  if (!occ.length) return Infinity;
  occ.sort((a, b) => a[0] - b[0]);
  const need = new Set();
  const cnt = new Map();
  let best = Infinity, left = 0;
  for (let right = 0; right < occ.length; right++) {
    const [, gi] = occ[right];
    cnt.set(gi, (cnt.get(gi) || 0) + 1);
    need.add(gi);
    while (need.size === parts.length) {
      const span = occ[right][0] - occ[left][0];
      if (span < best) best = span;
      const gi2 = occ[left][1];
      const c2 = cnt.get(gi2) - 1;
      cnt.set(gi2, c2);
      if (c2 === 0) need.delete(gi2);
      left++;
    }
  }
  return best;
}

const MRR = { B0: 0, B1: 0, B2: 0, B3: 0, B4: 0 };
const HIT8 = { B0: 0, B1: 0, B2: 0, B3: 0, B4: 0 };
const perCase = { B0: [], B1: [], B2: [], B3: [], B4: [] };
let n = 0, tiedN = 0;
const tiedDetail = [];

for (const c of cases) {
  const k = c.k || 8;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  if (!live.length) continue;
  const rows = talk.all(live.map(esc).join(' OR '), c.sid);
  if (!rows.length) continue;
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const docs = [];
  for (const r of rows) {
    const t = String(r.text || '');
    let got = 0;
    const hitParts = [];
    for (const p of live) if (t.indexOf(p) >= 0) { got += w.get(p); hitParts.push(p); }
    if (got <= 0) continue;
    /* ⚠️ 只对**本文实际命中**的 bigram 求窗口。要求「全部 live 都出现」必然 Infinity ——
       文档不可能包含查询的所有 bigram，那样这个特征就永远是常量（第一版实测 46/46 全是 Infinity）。 */
    const span = hitParts.length ? minSpan(t, hitParts) : Infinity;
    docs.push({ seq: r.seq, cov: got / wSum, score: Number(r.score) || 0, span, nhit: hitParts.length, len: t.length });
  }
  if (!docs.length) continue;
  const gi = docs.findIndex((d) => c.gold.includes(d.seq));
  if (gi < 0) continue;
  n++;

  const goldCov = docs[gi].cov;
  const topCov = Math.max(...docs.map((d) => d.cov));
  const isTiedWithTop = Math.abs(goldCov - topCov) < 1e-9;
  if (isTiedWithTop) tiedN++;

  const rankOf = (cmp) => {
    const sorted = docs.slice().sort((a, b) => b.cov - a.cov || cmp(a, b));
    const idx = sorted.findIndex((d) => c.gold.includes(d.seq));
    return idx < 0 ? 1e9 : idx + 1;
  };
  const cmps = {
    B0: (a, b) => a.score - b.score,
    B1: (a, b) => a.span - b.span,
    B2: (a, b) => a.span - b.span || a.score - b.score,
    B3: (a, b) => a.span / Math.max(1, a.nhit) - b.span / Math.max(1, b.nhit),
    B4: (a, b) => a.span / Math.max(1, a.len) - b.span / Math.max(1, b.len),
  };
  for (const kk of Object.keys(cmps)) {
    const r = rankOf(cmps[kk]);
    const rr = r <= k ? 1 / r : 0;
    MRR[kk] += rr;
    if (r <= 8) HIT8[kk]++;
    perCase[kk].push(rr);
  }
  if (isTiedWithTop) {
    tiedDetail.push({
      id: c.id, rB0: rankOf(cmps.B0), rB1: rankOf(cmps.B1), rB2: rankOf(cmps.B2),
      goldSpan: docs[gi].span,
      topSpan: Math.min(...docs.filter((d) => Math.abs(d.cov - topCov) < 1e-9).map((d) => d.span)),
    });
  }
}

console.log('邻近度排序诊断（' + n + ' 题 / 其中与 TOP1 sumIdf 完全相等的 ' + tiedN + ' 题）\n');
for (const kk of ['B0', 'B1', 'B2', 'B3', 'B4']) {
  console.log(kk, 'MRR=' + (MRR[kk] / n * 100).toFixed(2) + '%', 'HIT@8=' + HIT8[kk] + '/' + n);
}

/* 配对 Wilcoxon（B0 vs 各变体），方向 = 每题的 1/rank 差 */
function wilcoxon(a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - b[i];
    if (Math.abs(x) > 1e-12) d.push(x);
  }
  if (!d.length) return { n: 0, W: 0, p: 1 };
  const abs = d.map((x) => Math.abs(x)).sort((x, y) => x - y);
  const rank = new Map();
  for (let i = 0; i < abs.length; i++) {
    let j = i;
    while (j + 1 < abs.length && Math.abs(abs[j + 1] - abs[i]) < 1e-12) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) rank.set(t, avg);
    i = j;
  }
  let Wp = 0, Wn = 0;
  for (const x of d) {
    const ax = Math.abs(x);
    let idx = abs.findIndex((v) => Math.abs(v - ax) < 1e-12);
    const rk = rank.get(idx) || 1;
    if (x > 0) Wp += rk; else Wn += rk;
  }
  const W = Math.min(Wp, Wn);
  const N = d.length;
  const mu = N * (N + 1) / 4;
  const sd = Math.sqrt(N * (N + 1) * (2 * N + 1) / 24);
  const z = (W - mu) / sd;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { n: N, W, p };
}
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const pr = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - pr : pr;
}
console.log('\n配对 Wilcoxon（vs B0，正 = 该变体更好）:');
for (const kk of ['B1', 'B2', 'B3', 'B4']) {
  const w = wilcoxon(perCase[kk], perCase.B0);
  console.log(' ', kk, 'n=' + w.n, 'p=' + w.p.toFixed(4), (MRR[kk] - MRR.B0) / n * 100 >= 0 ? '+' + ((MRR[kk] - MRR.B0) / n * 100).toFixed(2) + 'pp' : ((MRR[kk] - MRR.B0) / n * 100).toFixed(2) + 'pp');
}

console.log('\n并列子集逐题（gold 名次，越小越好）:');
const better = tiedDetail.filter((d) => d.rB2 < d.rB0).length;
const worse = tiedDetail.filter((d) => d.rB2 > d.rB0).length;
const same = tiedDetail.filter((d) => d.rB2 === d.rB0).length;
for (const d of tiedDetail.slice(0, 20)) {
  console.log(' ', d.id, 'B0=' + d.rB0, 'B1=' + d.rB1, 'B2=' + d.rB2, '| goldSpan=' + d.goldSpan, 'topSpan=' + d.topSpan);
}
console.log('\n  B2 相对 B0：改进', better, '/ 退化', worse, '/ 不变', same);
