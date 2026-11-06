/* 矛盾排查：bug 把第 2 名推到池尾（109/109），为什么 Recall@8 还是 +0.0pp？
 *
 * 两种可能，必须分清：
 *   A. 评测集里没有一道题的 gold 正好是相关性第 2 名 ⇒ Recall 天然看不见这个 bug
 *      （这叫「评测集盲区」，bug 仍然真实存在）
 *   B. 两个脚本口径不一致 ⇒ 有一个算错了
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');

const NOW = Date.now();
const raw = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (!p.items.length) continue;
  const relRank = [];
  for (const g of c.gold) {
    const it = p.items.find((x) => Number(x.r.seq) === Number(g));
    relRank.push(it ? it.rel : -1);
  }
  const h0 = M.hitOf(p.items, NOW, c.k, c.gold, c.minHit || 1, false, p.rankMode);
  const h1 = M.hitOf(p.items, NOW, c.k, c.gold, c.minHit || 1, true, p.rankMode);
  raw.push({ id: c.id, cat: c.cat, relRank, h0, h1, pool: p.items.length });
}

const dist = {};
for (const r of raw) for (const k of r.relRank) dist[k] = (dist[k] || 0) + 1;
console.log('gold 在相关性原始排序中的名次分布（-1 = 不在池里）');
Object.keys(dist).map(Number).sort((a, b) => a - b)
  .forEach((k) => console.log('  rel=' + String(k).padStart(3) + ' : ' + dist[k] + ' 条'));

const hit0 = raw.filter((r) => r.h0).length;
const hit1 = raw.filter((r) => r.h1).length;
console.log('\n现状(含bug) 命中 ' + hit0 + '/' + raw.length + ' = ' + (hit0 / raw.length * 100).toFixed(1) + '%');
console.log('修分组bug后  命中 ' + hit1 + '/' + raw.length + ' = ' + (hit1 / raw.length * 100).toFixed(1) + '%');

const r2 = raw.filter((r) => r.relRank.indexOf(1) >= 0);
console.log('\ngold 含「相关性第 2 名」的题: ' + r2.length + ' 条');
for (const r of r2) {
  console.log('  ' + r.id.padEnd(6) + ' rel名次=' + JSON.stringify(r.relRank).padEnd(14)
    + ' 现状' + (r.h0 ? '命中' : '未命中') + ' → 修后' + (r.h1 ? '命中' : '未命中'));
}

console.log('\n抽样看「现状前 8 名」的相关性名次（正常应为 0,1,2,3… 或近似）');
for (const c of ALL.filter((x) => (x.gold || []).length && x.cat === 'numeric').slice(0, 4)) {
  const p = M.pool(c.sid, c.q);
  const b = M.order(p.items, NOW, true, false, p.rankMode).slice(0, 8).map((a) => a.x.rel);
  const f = M.order(p.items, NOW, true, true, p.rankMode).slice(0, 8).map((a) => a.x.rel);
  console.log('  ' + c.id + ' 池' + String(p.items.length).padStart(4)
    + '  现状=[' + b.join(',') + ']');
  console.log('         ' + ' '.repeat(7) + '  修后=[' + f.join(',') + ']');
}
