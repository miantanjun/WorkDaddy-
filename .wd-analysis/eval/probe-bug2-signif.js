/* 修分组 bug 的真实收益：用「每题 MRR」而不是 Recall@k 做检验
 *
 * 为什么必须换指标：
 *   Recall@8 是零和的 —— 第 2 名回到第 2 位，必然把原来第 8 名挤到第 9 名。
 *   实测被杀掉的 5 题全都是「第 8 → 第 9」，恰好压在 k=8 的刀口上。
 *   于是「救活 10 题 / 害掉 5 题」在 Recall 上表现成 61→61（净 0），
 *   这是指标的边界效应，不是收益消失。
 *
 * MRR 没有这个边界问题（每题的 1/rank 连续变化）。
 *   对 MRR 做配对 Wilcoxon 符号秩检验（小样本用精确/近似正态皆可），
 *   并给出「改善题数 vs 恶化题数」。
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');
const NOW = Date.now();

function mcnemar01(a, b) {
  let n01 = 0, n10 = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > b[i] ? 1 : 0, y = a[i] < b[i] ? 1 : 0;
    if (x && !y) n01++; else if (!x && y) n10++;
  }
  const n = n01 + n10;
  if (!n) return { n01, n10, n: 0, p: 1 };
  const C = (nn, kk) => {
    let r = 1; for (let i = 0; i < kk; i++) r = r * (nn - i) / (i + 1); return r;
  };
  let p = 0;
  for (let i = 0; i <= Math.min(n01, n10); i++) p += C(n, i) * Math.pow(0.5, n);
  return { n01, n10, n, p: Math.min(1, 2 * p) };
}

/* Wilcoxon 符号秩（正态近似 + 连续性校正，n 大时可用） */
function wilcoxon(diff) {
  const nz = diff.filter((d) => Math.abs(d) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, W: 0, z: 0, p: 1 };
  const sorted = nz.map((d) => ({ d, a: Math.abs(d) })).sort((x, y) => x.a - y.a);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && Math.abs(sorted[j + 1].a - sorted[i].a) < 1e-12) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) sorted[k].rank = rank;
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (const s of sorted) { if (s.d > 0) Wp += s.rank; else Wm += s.rank; }
  const W = Math.min(Wp, Wm);
  const mu = n * (n + 1) / 4;
  const sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu + 0.5) / sd;
  /* 双侧 p 用正态近似 */
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { n, W, Wp, Wm, z, p: Math.min(1, Math.max(0, p)) };
}
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

const rows = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (!p.items.length) continue;
  const mr = (fix) => {
    const arr = M.order(p.items, NOW, true, fix, p.rankMode);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    return best ? 1 / best : 0;
  };
  rows.push({ id: c.id, m0: mr(false), m1: mr(true) });
}

const a = rows.map((r) => r.m0), b = rows.map((r) => r.m1);
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
console.log('样本 ' + rows.length + ' 题');
console.log('MRR 现状(含bug) ' + mean(a).toFixed(4) + '  →  修分组bug ' + mean(b).toFixed(4)
  + '   Δ = ' + ((mean(b) - mean(a)) * 100).toFixed(2) + 'pp'
  + '（' + ((mean(b) / mean(a) - 1) * 100).toFixed(1) + '% 相对）');
const up = rows.filter((r) => r.m1 > r.m0 + 1e-9).length;
const down = rows.filter((r) => r.m1 < r.m0 - 1e-9).length;
const same = rows.length - up - down;
console.log('改善 ' + up + ' 题 · 恶化 ' + down + ' 题 · 不变 ' + same + ' 题');
const mc = mcnemar01(a, b);
console.log('符号检验（改善 vs 恶化）: n1=' + mc.n01 + ' n2=' + mc.n10 + ' p=' + mc.p.toFixed(4));
const w = wilcoxon(a.map((x, i) => x - b[i]));
console.log('Wilcoxon 符号秩: n=' + w.n + ' W=' + w.W + ' z=' + w.z.toFixed(3) + ' p=' + w.p.toFixed(4));

/* 分位置看：改善集中在哪些名次段 */
const bucket = {};
for (const r of rows) {
  const d = r.m1 - r.m0;
  const key = d > 0.2 ? '大幅改善(>0.2)' : d > 1e-9 ? '小幅改善' : d < -0.2 ? '大幅恶化(<-0.2)' : d < -1e-9 ? '小幅恶化' : '不变';
  bucket[key] = (bucket[key] || 0) + 1;
}
console.log('\n分布：');
for (const k of Object.keys(bucket)) console.log('  ' + k + ' : ' + bucket[k] + ' 题');
