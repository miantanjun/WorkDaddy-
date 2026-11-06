/* 三方对比（用 MRR，不用 Recall@k）
 *
 * 为什么必须用 MRR 定案：
 *   Recall@8 是零和的。第 2 名回位必然把第 8 名挤到第 9 名，
 *   实测「修 bug 救活 10 题 / 害掉 5 题」在 Recall 上表现成 61→61（净 0），
 *   完全是 k=8 刀口上的边界效应。MRR 是连续量，不存在这个问题。
 *
 * 三个方案：
 *   A 纯相关性（关掉换位）
 *   B 现状（换位 + 分组 bug）
 *   C 修分组 bug（换位）
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');
const NOW = Date.now();

const MODES = {
  A: { useSwap: false, fix: false, label: 'A 纯相关性（关换位）' },
  B: { useSwap: true, fix: false, label: 'B 换位·现状（含bug）' },
  C: { useSwap: true, fix: true, label: 'C 换位·修分组bug' },
};

const rows = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (!p.items.length) continue;
  const rec = { id: c.id, cat: c.cat, k: c.k, pool: p.items.length };
  for (const key of Object.keys(MODES)) {
    const arr = M.order(p.items, NOW, MODES[key].useSwap, MODES[key].fix, p.rankMode);
    let best = 0, segs = arr.slice(0, c.k).map((a) => Number(a.x.r.seq));
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    let got = 0; for (const g of c.gold) if (segs.indexOf(Number(g)) >= 0) got++;
    rec[key] = { mrr: best ? 1 / best : 0, hit: got >= (c.minHit || 1) ? 1 : 0, pos: best };
  }
  rows.push(rec);
}

const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const n = rows.length;
console.log('样本 ' + n + ' 道正例（k 按每题设定，多为 8）\n');
console.log('指标            A 纯相关    B 现状    C 修bug');
const fmt = (x, w) => (x * 100).toFixed(1).padStart(w) + '%';
for (const key of ['hit', 'mrr']) {
  const name = key === 'hit' ? 'Recall@k' : 'MRR';
  console.log(name.padEnd(14) + fmt(mean(rows.map((r) => r.A[key])), 9)
    + fmt(mean(rows.map((r) => r.B[key])), 9) + fmt(mean(rows.map((r) => r.C[key])), 9));
}

function cmp(x, y, tag) {
  const up = rows.filter((r) => r[y].mrr > r[x].mrr + 1e-9).length;
  const down = rows.filter((r) => r[y].mrr < r[x].mrr - 1e-9).length;
  const d = mean(rows.map((r) => r[y].mrr)) - mean(rows.map((r) => r[x].mrr));
  console.log('\n' + tag + '：MRR Δ ' + (d >= 0 ? '+' : '') + (d * 100).toFixed(2) + 'pp'
    + '  · 改善 ' + up + ' 题 / 恶化 ' + down + ' 题 / 不变 ' + (n - up - down));
  return { up, down, d };
}
const ab = cmp('A', 'B', 'A 纯相关 → B 现状');
const ac = cmp('A', 'C', 'A 纯相关 → C 修bug');
const bc = cmp('B', 'C', 'B 现状   → C 修bug');

/* 按名次段看谁在恶化 / 谁在改善 —— 这是理解机制的关键 */
console.log('\n按「gold 在相关性排序里的名次段」分组看 MRR 变化（B→C）：');
const seg = [
  ['第 1 名', (p) => p === 1], ['第 2 名', (p) => p === 2],
  ['第 3~8 名', (p) => p >= 3 && p <= 8], ['第 9~50 名', (p) => p >= 9 && p <= 50],
  ['50 名外', (p) => p > 50],
];
/* rel 名次要用纯相关性排序下的落位 */
for (const [nm, f] of seg) {
  const sub = rows.filter((r) => f(r.A.pos));
  if (!sub.length) continue;
  const d = mean(sub.map((r) => r.C.mrr)) - mean(sub.map((r) => r.B.mrr));
  const dd = mean(sub.map((r) => r.B.mrr)) - mean(sub.map((r) => r.A.mrr));
  console.log('  ' + nm.padEnd(10) + 'n=' + String(sub.length).padStart(3)
    + '   A→B ' + (dd >= 0 ? '+' : '') + (dd * 100).toFixed(1) + 'pp'
    + '   B→C ' + (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + 'pp');
}
