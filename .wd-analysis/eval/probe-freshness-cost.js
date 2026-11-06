/* 收窄并列的代价：新鲜度优先还剩多少？—— 按「组」校验方向，不按全局位移
 *
 * 上一版的方法错了：按「全局位移」比 rankKey，组内两两对调时上升/下降次数
 * 必然相等 ⇒ 永远判成 0:0，得出「方向偏错」的错误结论。
 *
 * 正解：只看**每个被换位的组内部**，检查排序结果是否与 rankKey 降序一致。
 *   组内按 rankKey 降序 = 机制执行正确（新的在前）
 *   组内乱序          = 逻辑有 bug
 * 这样「方向」才有意义。
 */
'use strict';
const M = require('./lib-pool.js');
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

function audit(legacyTie) {
  let queries = 0, triggered = 0, groupsTotal = 0, groupsMulti = 0, okDesc = 0, badOrder = 0;
  let rose = 0, fell = 0;   /* 组内被往前挪的条数 / 被往后挪的条数 */
  for (const c of ALL.concat(FRESH)) {
    if (!(c.gold || []).length) continue;
    const p = M.pool(c.sid, c.q);
    if (p.items.length < 4) continue;
    queries++;
    const pure = p.items.slice().sort((a, b) => a.rel - b.rel);
    const wrapped = M.order(p.items, NOW, true, true, p.rankMode, { legacyTie });
    /* 用分组号把组切开 —— order 返回的包装对象带 g */
    const byG = new Map();
    wrapped.forEach((a, i) => {
      const g = a.g === undefined ? 0 : a.g;
      if (!byG.has(g)) byG.set(g, []);
      byG.get(g).push({ item: a.x || a, pos: i });
    });
    const posPure = new Map(); pure.forEach((x, i) => posPure.set(x, i));
    let anyMove = false;
    for (const [g, arr] of byG) {
      groupsTotal++;
      if (arr.length < 2) continue;
      groupsMulti++;
      /* 组内顺序是否按 rankKey 降序 */
      let desc = true;
      for (let i = 1; i < arr.length; i++) {
        if (M.rankKey(arr[i - 1].item.r, NOW) < M.rankKey(arr[i].item.r, NOW) - 1e-12) desc = false;
      }
      if (desc) okDesc++; else badOrder++;
      /* 位移方向 */
      arr.forEach((o, idx) => {
        const orig = posPure.get(o.item);
        if (orig === undefined) return;
        const groupStart = Math.min(...arr.map((z) => posPure.get(z.item) ?? 0));
        const before = orig - groupStart, after = idx;
        if (after < before) rose++;
        else if (after > before) fell++;
        if (after !== before) anyMove = true;
      });
    }
    if (anyMove) triggered++;
  }
  return { queries, triggered, groupsTotal, groupsMulti, okDesc, badOrder, rose, fell };
}

for (const [nm, lt] of [['旧版 tie=2（名次近似并列）', 2], ['现状 tie=0（原始分相等才并列）', 0]]) {
  const a = audit(lt);
  console.log('=== ' + nm + ' ===');
  console.log('  检索 ' + a.queries + ' 次 · 顺序被改动 ' + a.triggered + ' 次 ('
    + (a.triggered / a.queries * 100).toFixed(1) + '%)');
  console.log('  分组 ' + a.groupsTotal + ' 个，其中多成员组 ' + a.groupsMulti
    + ' 个 · 组内按 rankKey 降序正确 ' + a.okDesc + ' / 错序 ' + a.badOrder);
  console.log('  组内位移: 往前挪 ' + a.rose + ' 条 / 往后挪 ' + a.fell + ' 条');
  console.log('  ⇒ 前挪 ' + (a.rose / (a.rose + a.fell) * 100).toFixed(1) + '% 的位移是「更新的上去了」');
  console.log('');
}
console.log('判读：');
console.log('  · 错序应恒为 0（否则排序逻辑本身有 bug）');
console.log('  · 「更新的上去了」占比 > 50% 说明机制方向正确，只是作用范围被收窄');
