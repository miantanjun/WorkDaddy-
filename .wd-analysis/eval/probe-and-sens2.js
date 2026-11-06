/* AND 题集敏感性检验 v2 —— v1 有两个致命测量错误，修正后重测
 *
 * v1 的错误（必须写下来，否则会得出「AND 路对排序完全不敏感」的错误结论）：
 *   ① 把 noSwap 塞进 opts，但 lib.order 的 useSwap 是**第 3 个位置参数**。
 *      结果三个变体其实都在跑同一套逻辑 ⇒ 名次 0 变化，看起来像"不敏感"，
 *      实际是"根本没换参数"。
 *   ② 用 rankTie 去扰动 AND 路。但 AND 走的是 `rankMode=false` 分支，
 *      并列阈值是 `span * REL_TIE`，`rankTie` 只对 rankMode=true（OR 路）生效。
 *      ⇒ 又一次测了个空。
 *
 * v2 改为：
 *   · 换位开关用位置参数真传；
 *   · AND 路的并列阈值按 `span * REL_TIE` 复算，用**组结构**判断敏感度
 *     （数一下整池被切成几组、第 1 名在组内是否被换掉）。
 */
'use strict';
const path = require('path');
const lib = require('./lib-pool.js');
const final = require('./out/and-final.json');
const now = Date.now();

/* 复算 AND 路的组结构：与产品同一行逻辑（span*REL_TIE、第1名独占、与组起点比）。
 * 只用于**解释**排序结果，不参与打分 —— 打分仍走 lib.order，避免逻辑分叉。 */
function groupsOf(items) {
  const rels = items.map((x) => Number(x.rel) || 0);
  const span = Math.max(...rels) - Math.min(...rels);
  const tie = span > 0 ? span * lib.REL_TIE : Infinity;
  const arr = items.map((x, i) => ({ x, i })).sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const g = arr.map(() => 0);
  if (arr.length > 1) {
    let cur = 1, anchor = arr[1];
    g[1] = cur;
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor.x.rel > tie) { cur += 1; anchor = arr[k]; }
      g[k] = cur;
    }
  }
  const sizes = {};
  for (const v of g) sizes[v] = (sizes[v] || 0) + 1;
  return { nGroups: Object.keys(sizes).length, sizes, tie, span, maxGroup: Math.max(...Object.values(sizes)) };
}

function run(useSwap) {
  const rows = [];
  for (const x of final) {
    const p = lib.pool(x.sid, x.q);
    if (!p.items.length) { rows.push({ mrr: 0, rank: 999 }); continue; }
    const ord = lib.order(p.items, now, useSwap, true, p.rankMode, {});
    const seqs = ord.map((a) => Number(a.x.r.seq));
    let best = -1;
    for (const g of x.gold) {
      const i = seqs.indexOf(Number(g));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    rows.push({ mrr: best < 0 ? 0 : 1 / (best + 1), rank: best < 0 ? 999 : best + 1 });
  }
  return rows;
}

const withSwap = run(true);
const noSwap = run(false);
const m = (rs) => +(rs.reduce((s, r) => s + r.mrr, 0) / rs.length * 100).toFixed(2);
const top = (rs, k) => rs.filter((r) => r.rank <= k).length;

console.log('换位开：MRR=' + m(withSwap) + '%  R@1=' + top(withSwap, 1)
  + ' R@5=' + top(withSwap, 5) + ' R@10=' + top(withSwap, 10));
console.log('换位关：MRR=' + m(noSwap) + '%  R@1=' + top(noSwap, 1)
  + ' R@5=' + top(noSwap, 5) + ' R@10=' + top(noSwap, 10));

const diff = [];
for (let i = 0; i < final.length; i++) {
  if (withSwap[i].rank !== noSwap[i].rank) {
    diff.push({ src: final[i].src, q: final[i].q, on: withSwap[i].rank, off: noSwap[i].rank });
  }
}
console.log('\n换位开关导致名次变化的题：' + diff.length + ' / ' + final.length);
for (const d of diff.slice(0, 20)) {
  console.log('  ' + d.src.padEnd(6) + ' 开=' + String(d.on).padStart(3)
    + ' 关=' + String(d.off).padStart(3) + '   ' + d.q);
}

/* 组结构：这是"排序有没有空间"的直接证据 */
console.log('\n池子组结构（AND 路，span*REL_TIE 切组）：');
const stats = [];
for (const x of final) {
  const p = lib.pool(x.sid, x.q);
  if (!p.items.length) continue;
  const g = groupsOf(p.items);
  stats.push(g);
}
const ng = stats.map((s) => s.nGroups).sort((a, b) => a - b);
const mx = stats.map((s) => s.maxGroup).sort((a, b) => a - b);
const qs = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
console.log('  组数 p10=' + qs(ng, 0.1) + ' p50=' + qs(ng, 0.5) + ' p90=' + qs(ng, 0.9));
console.log('  最大组占比中位 = ' + (qs(mx, 0.5) / 40 * 100).toFixed(1) + '%（池子中位约 40 条）');
const single = stats.filter((s) => s.nGroups === 1).length;
console.log('  整池只有 1 组（换位可完全重排）的题：' + single + ' / ' + stats.length);
const mega = stats.filter((s) => s.maxGroup >= 10).length;
console.log('  存在 >=10 条大组的题：' + mega + ' / ' + stats.length);
