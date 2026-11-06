/* 最后一问：换位机制到底该不该存在？
 *
 * 上面已经量出三层机制：
 *   ① A→B：换位（现状）MRR -3.70pp —— 但它对**相关性第 2 名**是 -44.2pp 的灾难
 *      （因为 bug 把第 2 名直接踢到池尾），而对第 3~8 名是 +5.2pp。
 *      ⇒ 「换位」本身在 3~8 名这一层是有正收益的，坑全在 bug 上。
 *   ② B→C：修 bug 后 MRR +2.28pp，其中第 2 名 +29.0pp、第 3~8 名 -3.8pp。
 *      ⇒ 修 bug 是把「第 2 名的灾难」换成「第 3~8 名的轻微损失」，净赚。
 *   ③ A→C：仍然 -1.42pp —— 修完 bug 的换位**还是比纯相关性差**。
 *
 * 所以真正的问题不是 bug，而是：**换位在 3~8 名这一层的 +5.2pp 是真是假？**
 * 如果是真的（新鲜度确实有用），那正确做法是「修 bug + 保留换位」；
 * 如果是假的（只是噪声），那正确做法是「关掉换位」，bug 自然消失。
 *
 * 本脚本直接对照：在第 3~8 名的题上，换位救活的和害掉的分别是哪些，
 * 且它们的 gold 是不是真的「更旧」—— 这是换位唯一能成立的因果链。
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');
const NOW = Date.now();

const rows = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (!p.items.length) continue;
  const posOf = (sw, fix) => {
    const arr = M.order(p.items, NOW, sw, fix, p.rankMode);
    let best = 0, bestRow = null;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) { best = i + 1; bestRow = arr[i].x.r; }
    }
    return { pos: best, row: bestRow };
  };
  const A = posOf(false, false), B = posOf(true, false), C = posOf(true, true);
  rows.push({
    id: c.id, cat: c.cat, pool: p.items.length,
    posA: A.pos, posB: B.pos, posC: C.pos,
    mrrA: A.pos ? 1 / A.pos : 0, mrrB: B.pos ? 1 / B.pos : 0, mrrC: C.pos ? 1 / C.pos : 0,
    goldRec: A.row ? M.recencyOf(A.row.ts, A.row.last_hit_ts, NOW) : null,
    goldPri: A.row ? Number(A.row.pri) : null,
  });
}

/* 只看「纯相关性下 gold 落在第 3~8 名」这一层，也就是换位真正有收益的那层 */
const mid = rows.filter((r) => r.posA >= 3 && r.posA <= 8);
console.log('=== 换位有正收益的那一层（纯相关性第 3~8 名）n=' + mid.length + ' ===');
console.log('第 1 层判断：换位（A→B）在这一层是 +5.2pp MRR。逐题看是谁贡献的：\n');
for (const r of mid.slice().sort((a, b) => (b.mrrB - b.mrrA) - (a.mrrA - a.mrrA) || 0)) {
  const d = (r.mrrB - r.mrrA) * 100;
  if (Math.abs(d) < 0.5) continue;
  console.log('  ' + r.id.padEnd(6) + ' 池' + String(r.pool).padStart(4)
    + ' 位置 ' + String(r.posA).padStart(3) + '→' + String(r.posB).padStart(3)
    + '  ΔMRR ' + (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp'
    + '  gold新鲜度 ' + (r.goldRec === null ? '?' : r.goldRec.toFixed(3))
    + '  pri=' + r.goldPri);
}

/* 关键因果检验：换位「救活」的题，gold 是否真的更新鲜？ */
const helped = mid.filter((r) => r.mrrB > r.mrrA + 1e-9);
const hurt = mid.filter((r) => r.mrrB < r.mrrA - 1e-9);
const avgRec = (arr) => { const v = arr.map((r) => r.goldRec).filter((x) => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
console.log('\n=== 换位对第 3~8 名的作用，与「gold 新鲜度」的因果关系 ===');
console.log('  换位救活 ' + helped.length + ' 题，gold 平均新鲜度 ' + avgRec(helped).toFixed(3));
console.log('  换位害掉 ' + hurt.length + ' 题，gold 平均新鲜度 ' + avgRec(hurt).toFixed(3));
console.log('  （若「救活的更新鲜」成立，前者应明显低于…… 注意：数字越小=越旧）');
console.log('\n  ⇒ 换位要让「更新的内容上前」，所以被救活的题里 gold 应当**更新鲜**（数字更大）。');
console.log('     若救活组的平均新鲜度并不高于受害组，说明换位不是在按新鲜度做事，那 +5.2pp 就是噪声。');

/* 第二个因果检验：全题层面，gold 新鲜度是否与「换位是否有益」相关 */
console.log('\n=== 全 109 题：gold 新鲜度分档 vs 换位收益 ===');
const bins = [[0, 0.3], [0.3, 0.6], [0.6, 0.85], [0.85, 1.01]];
for (const [lo, hi] of bins) {
  const sub = rows.filter((r) => r.goldRec !== null && r.goldRec >= lo && r.goldRec < hi);
  if (!sub.length) continue;
  const dAB = (sub.reduce((s, r) => s + r.mrrB, 0) / sub.length) - (sub.reduce((s, r) => s + r.mrrA, 0) / sub.length);
  const dAC = (sub.reduce((s, r) => s + r.mrrC, 0) / sub.length) - (sub.reduce((s, r) => s + r.mrrA, 0) / sub.length);
  console.log('  新鲜度 ' + lo.toFixed(2) + '~' + hi.toFixed(2) + '  n=' + String(sub.length).padStart(3)
    + '   换位A→B ' + (dAB >= 0 ? '+' : '') + (dAB * 100).toFixed(1) + 'pp'
    + '   修bug后A→C ' + (dAC >= 0 ? '+' : '') + (dAC * 100).toFixed(1) + 'pp');
}
