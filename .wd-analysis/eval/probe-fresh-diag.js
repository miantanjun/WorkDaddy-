/* 第四批诊断：MRR 只有 2.8% ⇒ 平均落位约第 36 名。换位只在前几组内换，
 * 落位在 30 名外的题它根本够不着 ⇒ 这批题测不出换位效果。
 *
 * 必须看清：gold 在相关性排序里的落位分布、池大小、以及「是否进前 8」。
 * 如果绝大多数 gold 都在第 20 名以外，这批题的失败是**召回/覆盖率**问题，
 * 不是排序问题 —— 那就说明题面选词有问题（问法偏离原文用词），需要改题而不是改产品。
 */
'use strict';
const { FRESH, LATEST, EARLIEST, MID } = require('./cases-fresh.js');
const M = require('./lib-pool.js');
const NOW = Date.now();
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

const rows = [];
for (const c of FRESH) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  const relRank = [], inPool = [];
  for (const g of c.gold) {
    const it = p.items.find((x) => Number(x.r.seq) === Number(g));
    if (it) { relRank.push(it.rel); inPool.push(true); } else { relRank.push(-1); inPool.push(false); }
  }
  const ordC = p.items.length ? M.order(p.items, NOW, true, true, p.rankMode) : [];
  const posC = ordC.findIndex((a) => c.gold.map(Number).indexOf(Number(a.x.r.seq)) >= 0) + 1;
  const ordA = p.items.length ? M.order(p.items, NOW, false, false, p.rankMode) : [];
  const posA = ordA.findIndex((a) => c.gold.map(Number).indexOf(Number(a.x.r.seq)) >= 0) + 1;
  rows.push({ id: c.id, ladder: c.ladder, q: c.q, pool: p.items.length, via: p.via, relRank, posA, posC, inPool });
}

console.log('题目  档位      池   via  gold相关性名次   A落位  C落位   前8?');
for (const r of rows) {
  console.log(r.id.padEnd(5) + ' ' + String(r.ladder).padEnd(9)
    + String(r.pool).padStart(4) + ' ' + String(r.via).padEnd(4) + ' '
    + JSON.stringify(r.relRank).padEnd(14)
    + String(r.posA).padStart(5) + String(r.posC).padStart(6)
    + '   ' + (r.posC && r.posC <= 8 ? '✅' : '❌'));
}

const hit = rows.filter((r) => r.posC && r.posC <= 8).length;
const deep = rows.filter((r) => r.relRank.every((x) => x < 0 || x > 20)).length;
const notIn = rows.filter((r) => r.relRank.every((x) => x < 0)).length;
console.log('\n前 8 命中 ' + hit + '/' + rows.length);
console.log('gold 相关性名次全在 20 名外: ' + deep + '/' + rows.length);
console.log('gold 完全不在候选池: ' + notIn + '/' + rows.length);
const ranks = rows.flatMap((r) => r.relRank.filter((x) => x >= 0)).sort((a, b) => a - b);
console.log('gold 相关性名次 中位 ' + (ranks.length ? ranks[Math.floor(ranks.length / 2)] : '?')
  + ' · 最小 ' + (ranks[0] ?? '?') + ' · 最大 ' + (ranks[ranks.length - 1] ?? '?'));

/* 换位只在「同一组的候选中」重排。若 gold 在 30 名外，
 * 它前面的组太多 ⇒ 换位不可能把它拉到前 8。这是数学上的上限，不是调参能解决的。 */
console.log('\n⇒ 若「gold 名次 > 8」，换位最多把它在所属组内挪几位，');
console.log('   不可能跨组提升 ⇒ 这类题对"换位值不值"毫无区分力，必须从实验里剔除。');
