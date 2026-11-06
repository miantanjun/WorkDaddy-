/* RANK_TIE 取值曲线：0 / 1 / 2 / 3 / 5
 *
 * 为什么要扫而不是直接归零：
 *   tie 不只是「换位窗口大小」，它还是**「上次被检索就续命」这个机制的唯一出口**。
 *   名次制下 rel 是整数、永不完全相等 ⇒ tie=0 时每条自成一组 ⇒ 组内重排无效
 *   ⇒ rankKey（recency 0.6 + importance 0.4）在 OR 路径上彻底不再影响顺序。
 *   单测 15b-5 断言的是 ck.rankKey 这个**纯函数**的值，所以它照样会通过 ——
 *   但机制实际已死。必须自己看见这个代价，而不是被绿测试骗过去。
 *
 * 所以扫一遍：既看 MRR，也看「有多少次检索里顺序真的被改动了」。
 *   后者是「机制还活着吗」的直接指标。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const ck = M.ck;
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();
const fn = ck.rankRelevanceFirst;

function wilcoxon(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, p: 1 };
  const s = nz.map((v) => ({ v, a: Math.abs(v) })).sort((x, y) => x.a - y.a);
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && Math.abs(s[j + 1].a - s[i].a) < 1e-12) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) s[k].r = r;
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (const x of s) { if (x.v > 0) Wp += x.r; else Wm += x.r; }
  const W = Math.min(Wp, Wm), mu = n * (n + 1) / 4, sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu + 0.5) / sd;
  const erf = (x) => {
    const sg = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return sg * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  return { n, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

const TIES = [0, 1, 2, 3, 5];
const rows = [];
let churn = {};
for (const tie of TIES) churn[tie] = { reordered: 0, movedCandidates: 0, total: 0 };

for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const base = p.items.slice().sort((a, b) => a.rel - b.rel);
  const rec = { id: c.id, pA: 0 };
  for (const tie of TIES) {
    const arr = fn(p.items, NOW, { rankMode: true, rankTie: tie });
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    rec['t' + tie] = best ? 1 / best : 0;
    if (tie === 0) rec.pA = best;
    /* 机制存活度：有多少条候选的位置被改了 */
    const posBase = new Map(); base.forEach((x, i) => posBase.set(x, i));
    let moved = 0;
    arr.forEach((x, i) => { if (posBase.get(x) !== i) moved++; });
    churn[tie].total += arr.length;
    churn[tie].movedCandidates += moved;
    if (moved) churn[tie].reordered++;
  }
  rows.push(rec);
}

console.log('样本 ' + rows.length + ' 道正例\n');
console.log('tie   MRR      相对 tie=0   检索被重排的比例   候选被移动的比例');
for (const tie of TIES) {
  const mr = mean(rows.map((r) => r['t' + tie]));
  const d = rows.map((r) => r['t' + tie] - r.t0);
  const w = wilcoxon(d);
  const n = churn[tie];
  const reord = (n.reordered / rows.length * 100).toFixed(1);
  const moved = (n.movedCandidates / n.total * 100).toFixed(1);
  const tag = tie === 0 ? '（基准）' : ('Δ' + (mean(d) * 100 >= 0 ? '+' : '') + (mean(d) * 100).toFixed(2) + 'pp p=' + w.p.toFixed(4)
    + (w.p < 0.05 ? ' ✅' : w.p < 0.10 ? ' 🟡' : ' ⚪'));
  console.log(' ' + String(tie).padEnd(4) + (mr * 100).toFixed(2) + '%    ' + tag.padEnd(24)
    + reord.padStart(6) + '%' + '          ' + moved.padStart(5) + '%');
}

console.log('\n=== 机制存活度 ===');
const live = TIES.filter((t) => churn[t].reordered > 0);
if (!live.length) console.log('  ❌ 全部 tie 值下都没有任何重排 —— 组内重排机制彻底失效');
else console.log('  仍有重排的 tie 值: ' + live.join(', '));
console.log('  判据：若 tie=0 的重排比例为 0%，则「上次被检索就续命」在 OR 路径上失效。');
