/* 「把并列的定义收窄到相关性完全相等」—— 不改产品，先用产品函数实测
 *
 * 起因：
 *   现在的注释写着「相关度优先，并列时才让新鲜度/重要度换位」，
 *   但实现是 rankMode 下 tie = RANK_TIE = 2 ⇒ 名次差 ≤2 就归一组 ⇒ 组内整段重排。
 *   名次是整数、永远不相等 ⇒ 这个「并列」根本不是并列，是把「相关性第 2~4 名
 *   之间的真实差距」交给新鲜度去覆盖。实测这一区间 −8.77pp（p=0.0068）。
 *
 * 三个方案（后两个不改产品，直接传 opts 就能跑）：
 *   A 纯相关性        rankTie=0 且不走分组（等价于 tie=0 的效果，作为参照）
 *   T0 「并列」= 相关性完全相等   rankTie=0
 *   T2 现状                        rankTie=2
 *
 * 判据：T0 应接近 A（因为真并列很少），并且显著优于 T2。
 *   若 T0 与 A 完全等价 ⇒ 说明「真并列时让新鲜度上位」这个意图几乎无从触发，
 *   那就得直接问：这个意图还值不值得保留。
 */
'use strict';
const path = require('path');
const M = require('./lib-pool.js');
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

/* 三个排序实现：都用**产品函数**，只是 opts 不同 / 是否绕开分组不同 */
function orderBy(items, mode) {
  if (mode === 'A') {
    /* 纯相关性：不动，按 rel 原序（第 1 名独占的语义也保留 —— 反正 rel 已经定了序） */
    return items.slice().sort((a, b) => a.rel - b.rel);
  }
  const tie = mode === 'T0' ? 0 : 2;
  /* 名次制 / 分数制各自的调用方式与产品一致 */
  return fn(items, NOW, { rankMode: true, rankTie: tie });
}

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const pos = (mode) => {
    const arr = orderBy(p.items, mode);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    return best;
  };
  const pA = pos('A'), p0 = pos('T0'), p2 = pos('T2');
  rows.push({
    id: c.id, cat: c.cat, pA,
    A: pA ? 1 / pA : 0, T0: p0 ? 1 / p0 : 0, T2: p2 ? 1 / p2 : 0,
  });
}

console.log('样本 ' + rows.length + ' 道正例（126 + 17，大小池统一 ≥4）\n');
console.log('方案                            MRR');
for (const k of ['A', 'T0', 'T2']) {
  const nm = k === 'A' ? 'A 纯相关性（完全不分组）' : k === 'T0' ? 'T0 并列 = 相关性完全相等' : 'T2 现状（名次差 ≤2 即并列）';
  console.log('  ' + nm.padEnd(30) + (mean(rows.map((r) => r[k])) * 100).toFixed(2) + '%');
}

console.log('');
for (const [x, y, tag] of [['A', 'T0', 'A  纯相关 → T0 完全相等才并列'], ['T0', 'T2', 'T0 完全相等 → T2 现状'], ['A', 'T2', 'A  纯相关 → T2 现状']]) {
  const d = rows.map((r) => r[y] - r[x]);
  const w = wilcoxon(d);
  const dd = mean(d) * 100;
  const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
  console.log(tag.padEnd(34) + ' Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
    + '  改善 ' + String(up).padStart(2) + ' / 恶化 ' + String(dn).padStart(2)
    + '  p=' + w.p.toFixed(4) + (w.p < 0.05 ? ' ✅' : w.p < 0.10 ? ' 🟡' : ' ⚪'));
}

/* T0 与 A 有多少题落位不同？这决定「真并列」到底有多罕见 */
const diff = rows.filter((r) => r.A !== r.T0).length;
console.log('\nT0 与纯相关性落位不同的题: ' + diff + '/' + rows.length);
console.log('⇒ 若为 0，说明真并列在真实查询里几乎不出现，');
console.log('   「并列时让新鲜度上位」这个意图实际上无从触发，保留它只是保留了 2 名窗口的扰动。');
