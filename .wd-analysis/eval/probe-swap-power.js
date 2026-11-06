/* 换位机制的**理论作用上限** —— 这条决定了一切
 *
 * 源码：rankMode 下 tie = RANK_TIE = 2，分组条件是「与组起点 anchor 的差 > 2 才另起组」
 *   ⇒ 一个组只装 rel ∈ [anchor, anchor+2]，也就是**连续 3 个名次**。
 *   组内按 rankKey 重排 ⇒ 最极端情况也只能把组内最后一名挪到组首 ⇒ **净位移 ±2 名**。
 *
 * 这不是调参问题，是机制定义决定的数学上限。
 * 所以：
 *   · gold 在相关性第 58 名 ⇒ 换位怎么排都进不了前 8，测不出差异
 *   · gold 在第 2 名 ⇒ 换位能把它挪到第 4（或反过来）⇒ 这是它唯一能造成显著差异的位置
 *
 * 本脚本实测这个上限，用真实 126+17 道题逐题算「A→C 的最大绝对位移」。
 */
'use strict';
const { ALL, FRESH } = require('./all-cases.js');
const M = require('./lib-pool.js');
const NOW = Date.now();

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const a = M.order(p.items, NOW, false, false, p.rankMode);
  const c2 = M.order(p.items, NOW, true, true, p.rankMode);
  const posA = new Map(), posC = new Map();
  a.forEach((x, i) => posA.set(x.i, i));
  c2.forEach((x, i) => posC.set(x.i, i));
  let maxD = 0, moved = 0;
  for (const k of posA.keys()) {
    const d = Math.abs(posC.get(k) - posA.get(k));
    if (d > 0) moved++;
    if (d > maxD) maxD = d;
  }
  /* gold 的位移 */
  let gA = 0, gC = 0;
  for (const g of c.gold) {
    const iA = a.findIndex((x) => Number(x.x.r.seq) === Number(g));
    const iC = c2.findIndex((x) => Number(x.x.r.seq) === Number(g));
    if (iA >= 0) { gA = iA + 1; gC = iC + 1; break; }
  }
  rows.push({ id: c.id, pool: p.items.length, rankMode: p.rankMode, maxD, moved, gA, gC, gshift: gC - gA });
}

const byMode = (rm) => rows.filter((r) => r.rankMode === rm);
for (const [name, rm] of [['OR / 名次制（绝大多数查询走这条）', true], ['AND / LIKE / 分数制', false]]) {
  const sub = byMode(rm);
  if (!sub.length) continue;
  const ds = sub.map((r) => r.maxD).sort((a, b) => a - b);
  const sh = sub.map((r) => r.gshift).filter((x) => x !== 0).sort((a, b) => Math.abs(b) - Math.abs(a));
  console.log('=== ' + name + '  n=' + sub.length + ' 次检索 ===');
  console.log('  全池最大位移（不限 gold）：中位 ' + ds[Math.floor(ds.length / 2)]
    + ' · p90 ' + ds[Math.floor(ds.length * 0.9)] + ' · 最大 ' + ds[ds.length - 1]);
  console.log('  有位移的候选平均 ' + (sub.reduce((s, r) => s + r.moved, 0) / sub.reduce((s, r) => s + r.pool, 0) * 100).toFixed(1) + '%');
  if (sh.length) console.log('  gold 位移最大的几例: ' + sh.slice(0, 8).join(', '));
  console.log('');
}

/* gold 的位移分布 */
const gs = rows.filter((r) => r.gA > 0).map((r) => r.gshift);
const hist = {};
for (const d of gs) hist[d] = (hist[d] || 0) + 1;
console.log('gold 位移分布（0 = 换位没动它）:');
for (const k of Object.keys(hist).map(Number).sort((a, b) => a - b)) {
  console.log('   ' + (k > 0 ? '+' : '') + k + ' 名 : ' + hist[k] + ' 题');
}
const untouched = gs.filter((d) => d === 0).length;
console.log('\ngold 完全没被换位影响: ' + untouched + '/' + gs.length
  + ' (' + (untouched / gs.length * 100).toFixed(0) + '%)');

console.log('\n=== 结论 ===');
const rankModeRows = byMode(true);
const maxAll = Math.max(...rankModeRows.map((r) => r.maxD));
console.log('名次制下全池最大位移只有 ' + maxAll + ' 名。');
console.log('⇒ 换位机制的**理论作用范围就是 ±' + maxAll + ' 名**，这是 RANK_TIE=2 决定的，不是调参问题。');
console.log('⇒ gold 在相关性第 8 名以外时，换位无论怎么做都进不了前 8 ⇒ 对 Recall@8 零影响。');
console.log('⇒ 它能造成显著差异的唯一位置是「gold 恰在前 4 名附近」。');
