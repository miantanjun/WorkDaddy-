/* 诊断十五：真实规模（79 会话）下，「答案在别处」这个提示信号能不能用？
 *
 * 为什么不是「路由」而是「提示」：
 *   · 路由（跨会话返回结果）需要 @1 足够高，实测 6/9 —— 33% 会把用户带到错的会话，
 *     这是**破坏性**错误，不能上线。
 *   · 提示（"这条可能在别的会话里"）是非破坏性的：猜错只是多一句废话，
 *     当前会话的结果照旧返回。所以判据该看**误提示率**，不是 @1。
 *
 * 本脚本量化：
 *   ① 余量 here − bestOther（正例应 ≤0，配对负例应 >0）
 *   ② 提示规则的 ROC 曲线与最优工作点
 *   ③ 留一交叉验证（上一轮吃过 9 条样本网格搜索过拟合的亏）
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const db = ck._internal.open();

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, LENGTH(s.text) AS len, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 3000) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 400`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
function globalRows(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  return stmt.all(parts.map(esc).join(' OR '));
}

/* 会话级分：前 3 条 bm25 均值（越负越强） */
function sessScores(rows) {
  const g = new Map();
  for (const r of rows) { if (!g.has(r.sid)) g.set(r.sid, []); g.get(r.sid).push(Number(r.score)); }
  const out = new Map();
  for (const [sid, a] of g) {
    const t = a.slice(0, 3);
    out.set(sid, { score: t.reduce((x, y) => x + y, 0) / t.length, n: a.length });
  }
  return out;
}

/* 每条题算三个特征：
 *   margin = here − bestOther   （>0 说明本会话不如别处，应提示）
 *   hereN  = 本会话命中条数
 *   bestN  = 最强别的会话命中条数
 *   ratio  = here.score − bestOther.score  （负得越多 = 别处越强）
 */
function feat(c) {
  const rows = globalRows(c.q);
  const S = sessScores(rows);
  const here = S.get(c.sid);
  let bestOther = null, bestSid = null;
  for (const [sid, v] of S) {
    if (sid === c.sid) continue;
    if (!bestOther || v.score < bestOther.score) { bestOther = v; bestSid = sid; }
  }
  if (!here) return { margin: 99, hereN: 0, bestN: bestOther ? bestOther.n : 0, noHere: true };
  if (!bestOther) return { margin: -99, hereN: here.n, bestN: 0, noHere: false };
  return { margin: here.score - bestOther.score, hereN: here.n, bestN: bestOther.n, noHere: false, bestSid };
}

const F = [];
for (const c of PN) F.push({ id: c.id, y: 1, ...feat(c) });   // 1 = 应该提示
for (const c of P) F.push({ id: c.id, y: 0, ...feat(c) });    // 0 = 不该提示

const pos = F.filter((x) => x.y === 1), neg = F.filter((x) => x.y === 0);
console.log('=== ① 余量分布 margin = here − bestOther ===');
const qs = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const pm = pos.map((x) => x.margin), nm = neg.map((x) => x.margin);
console.log('  应提示(9):  ', pm.map((x) => x.toFixed(1)).join(' '));
console.log('              p50=' + qs(pm, 0.5).toFixed(1));
console.log('  不该提示(109): p10=' + qs(nm, 0.1).toFixed(1) + ' p25=' + qs(nm, 0.25).toFixed(1)
  + ' p50=' + qs(nm, 0.5).toFixed(1) + ' p75=' + qs(nm, 0.75).toFixed(1));
console.log('  ⚠️ 重叠区间：neg 的 p90=' + qs(nm, 0.9).toFixed(1) + ' vs pos 的 p10=' + qs(pm, 0.1).toFixed(1));

console.log('\n=== ② 提示规则扫描：margin > Δ 才提示（0 误提示优先）===');
console.log('  Δ      提示(9)  误提示(109)  净  ');
for (const d of [-2, 0, 1, 2, 3, 4, 5, 6, 8, 10, 15]) {
  const tp = pos.filter((x) => x.margin > d).length;
  const fp = neg.filter((x) => x.margin > d).length;
  console.log('  ' + String(d).padStart(3) + String(tp + '/9').padStart(9)
    + String(fp + '/109').padStart(12) + String(tp - fp).padStart(6)
    + (fp === 0 ? '  ← 零误伤' : ''));
}

console.log('\n=== ③ 复合规则：margin > Δ 且 本会话命中条数 ≤ N ===');
for (const N of [1, 2, 3, 5]) {
  for (const d of [0, 2, 4]) {
    const tp = pos.filter((x) => x.margin > d && x.hereN <= N).length;
    const fp = neg.filter((x) => x.margin > d && x.hereN <= N).length;
    console.log('  N≤' + N + ' Δ>' + d + ' ⇒ 提示 ' + tp + '/9 · 误提示 ' + fp + '/109 · 净 ' + (tp - fp));
  }
}

console.log('\n=== ④ 留一交叉验证（在 8 条上选 Δ，测第 9 条）===');
const ds = [-2, 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
let loo = 0;
for (let i = 0; i < pos.length; i++) {
  const trainP = pos.filter((_, j) => j !== i);
  /* 选：零误伤下 TP 最大；并列时取最小 Δ */
  let bestD = null, bestTP = -1;
  for (const d of ds) {
    const fp = neg.filter((x) => x.margin > d).length;
    if (fp > 0) continue;
    const tp = trainP.filter((x) => x.margin > d).length;
    if (tp > bestTP) { bestTP = tp; bestD = d; }
  }
  /* 若没有任何 Δ 能零误伤，则退到 fp 最小的 */
  if (bestD === null) {
    let minFP = 1e9;
    for (const d of ds) {
      const fp = neg.filter((x) => x.margin > d).length;
      const tp = trainP.filter((x) => x.margin > d).length;
      if (fp < minFP || (fp === minFP && tp > bestTP)) { minFP = fp; bestD = d; bestTP = tp; }
    }
  }
  const hit = pos[i].margin > bestD ? 1 : 0;
  loo += hit;
  console.log('  留出 ' + pos[i].id.padEnd(5) + ' 选Δ=' + String(bestD).padStart(3)
    + ' 训练TP=' + bestTP + ' ⇒ 该条' + (hit ? '命中 ✅' : '漏 ❌') + ' (margin=' + pos[i].margin.toFixed(1) + ')');
}
console.log('  LOO 命中 ' + loo + '/9');
