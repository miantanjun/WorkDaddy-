/* 精确「并列」该用哪个键？
 *
 * OR 路径的排序是两级：覆盖率 cov 主序、bm25 score 次序。
 * 那么「两条候选真的并列」只可能是：
 *   K1 score 相等          —— 文档原注释的写法（「分数完全相同」）
 *   K2 cov 相等            —— 主序相等
 *   K3 cov 且 score 都相等 —— 两级全平，最严格
 *
 * 三者对 MRR 的影响不同：
 *   键越宽松 ⇒ 组越大 ⇒ 新鲜度能覆盖的相关性差距越多 ⇒ 越可能有损
 *   键越严格 ⇒ 组越小 ⇒ 新鲜度只处理真正无法区分的情况
 *
 * ⚠️ 但也不能一味求严：若 K3 下「组内重排」永不触发，
 *    「分数完全相同时新的优先」这个产品承诺就失效了（单测 15b-3 考的就是它）。
 * ⇒ 必须同时看 MRR 和「重排触发率」。
 */
'use strict';
const M = require('./lib-pool.js');
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

function orderByTieKey(items, tieKeyOf) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  arr[0].g = 0;
  let g = 0;
  for (let k = 1; k < arr.length; k++) {
    /* 与**组起点**比，保持与原实现一致的「组内跨度」语义 */
    const anchorIdx = arr.findIndex((z) => z.g === g);
    if (tieKeyOf(arr[k].x) !== tieKeyOf(arr[anchorIdx].x)) g += 1;
    arr[k].g = g;
  }
  arr.sort((a, b) => a.g - b.g || M.rankKey(b.x.r, NOW) - M.rankKey(a.x.r, NOW) || a.i - b.i);
  return arr.map((a) => a.x);
}

const KEYS = {
  'K1 score 相等': (x) => String(Number(x.r.score)),
  'K2 cov 相等': (x) => String(Number(x.cov)),
  'K3 cov+score 都相等': (x) => Number(x.cov) + '|' + Number(x.r.score),
};

const rows = [];
let churn = {};
for (const k of Object.keys(KEYS)) churn[k] = { reordered: 0, moved: 0, total: 0 };

for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const base = p.items.slice().sort((a, b) => a.rel - b.rel);
  const posBase = new Map(); base.forEach((x, i) => posBase.set(x, i));
  const rec = { id: c.id };
  rec.pure = (() => { let b = 0; for (const g of c.gold) { const i = base.findIndex((a) => Number(a.r.seq) === Number(g)); if (i >= 0 && (!b || i + 1 < b)) b = i + 1; } return b ? 1 / b : 0; })();
  for (const [nm, kf] of Object.entries(KEYS)) {
    const arr = orderByTieKey(p.items, kf);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    rec[nm] = best ? 1 / best : 0;
    let moved = 0;
    arr.forEach((x, i) => { if (posBase.get(x) !== i) moved++; });
    churn[nm].moved += moved;
    churn[nm].total += arr.length;
    if (moved) churn[nm].reordered++;
  }
  rows.push(rec);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
console.log('样本 ' + rows.length + ' 题\n');
console.log('  纯相关（天花板）             ' + (mean(rows.map((r) => r.pure)) * 100).toFixed(2) + '%');
for (const nm of Object.keys(KEYS)) {
  const n = churn[nm];
  console.log('  ' + nm.padEnd(22) + (mean(rows.map((r) => r[nm])) * 100).toFixed(2) + '%'
    + '   重排触发 ' + String(n.reordered).padStart(3) + '/' + rows.length
    + '   候选移动 ' + (n.moved / n.total * 100).toFixed(1) + '%');
}
console.log('\n判读：MRR 应尽量接近天花板，同时重排触发率 > 0（否则产品承诺失效）。');
