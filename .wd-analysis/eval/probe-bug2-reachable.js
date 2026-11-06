/* bug 在生产里是否真的可达？
 *
 * 代码：`if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;`  g 是循环结束的最终组号。
 *   若全池只有 1 个组（g 恒为 1），arr[1].g = 1 与「正确值」相同 ⇒ 无害。
 *   只有池里组数 ≥ 3 时，第 2 名才会被踢到真正的池尾。
 * ⇒ 必须验：真实查询的池里到底有多少个组。
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');

const NOW = Date.now();
const groups = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  /* 复刻分组，统计组数 */
  const arr = p.items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  /* ⚠️ 这个探针要复现的是**改动前**的实现，所以必须用 LEGACY 值。
     用 M.RANK_TIE 会读到产品当前值 0，把历史结论算成「bug 不可达」。 */
  const tie = p.rankMode ? M.RANK_TIE_LEGACY : (() => {
    const rels = p.items.map((x) => x.rel);
    const span = Math.max.apply(null, rels) - Math.min.apply(null, rels);
    return span > 0 ? span * M.REL_TIE : Infinity;
  })();
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
    arr[k].g = g;
  }
  groups.push({ id: c.id, pool: p.items.length, groups: g + 1, via: p.via, rankMode: p.rankMode, trulyTied });
}

const dist = {};
for (const r of groups) {
  const k = r.groups <= 1 ? '1 组' : r.groups === 2 ? '2 组' : '≥3 组（bug 可达）';
  dist[k] = (dist[k] || 0) + 1;
}
console.log('真实查询的候选池分组数分布（n=' + groups.length + '）');
for (const k of ['1 组', '2 组', '≥3 组（bug 可达）']) if (dist[k]) console.log('  ' + k + ' : ' + dist[k] + ' 次');
const reach = groups.filter((r) => r.groups >= 3);
console.log('\n⇒ bug 可达 ' + reach.length + '/' + groups.length + ' = '
  + (reach.length / groups.length * 100).toFixed(1) + '%');
if (reach.length) {
  const gs = reach.map((r) => r.groups).sort((a, b) => a - b);
  console.log('   组数 p50=' + gs[Math.floor(gs.length / 2)] + ' max=' + gs[gs.length - 1]);
  console.log('   其中 via=OR 的占 ' + reach.filter((r) => r.via === 'OR').length);
  console.log('   样例：' + reach.slice(0, 5).map((r) => r.id + '(池' + r.pool + '/组' + r.groups + ')').join(' '));
}
