/* 修 bug 救活 8 题、总数却不变 ⇒ 必有另外 8 题被挤掉。
 * 这是「Recall@k 零和」还是「别的原因」？逐题查。
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
  const posOf = (fix) => {
    const arr = M.order(p.items, NOW, true, fix, p.rankMode);
    const out = [];
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      out.push(i < 0 ? 0 : i + 1);
    }
    return out;
  };
  const b = posOf(false), f = posOf(true);
  rows.push({ id: c.id, cat: c.cat, k: c.k, minHit: c.minHit || 1, gold: c.gold, b, f, pool: p.items.length });
}

const saved = rows.filter((r) => r.b.every((x) => !x || x > r.k) && r.f.some((x) => x && x <= r.k));
const killed = rows.filter((r) => r.b.some((x) => x && x <= r.k) && r.f.every((x) => !x || x > r.k));
console.log('修 bug 救活的题（' + saved.length + '）');
for (const r of saved) console.log('  ' + r.id.padEnd(6) + ' 池' + String(r.pool).padStart(4)
  + ' 现状落位' + JSON.stringify(r.b) + ' → 修后' + JSON.stringify(r.f));
console.log('\n修 bug 害掉的题（' + killed.length + '）');
for (const r of killed) console.log('  ' + r.id.padEnd(6) + ' 池' + String(r.pool).padStart(4)
  + ' 现状落位' + JSON.stringify(r.b) + ' → 修后' + JSON.stringify(r.f));

/* 净变化 + MRR 对照 */
const hitOf = (r, fix) => {
  const ok = (fix ? r.f : r.b).filter((x) => x && x <= r.k).length;
  return ok >= r.minHit;
};
const mrrOf = (r, fix) => {
  const a = (fix ? r.f : r.b).filter((x) => x > 0).sort((p, q) => p - q)[0];
  return a ? 1 / a : 0;
};
const h0 = rows.filter((r) => hitOf(r, false)).length;
const h1 = rows.filter((r) => hitOf(r, true)).length;
const m0 = rows.reduce((s, r) => s + mrrOf(r, false), 0) / rows.length;
const m1 = rows.reduce((s, r) => s + mrrOf(r, true), 0) / rows.length;
console.log('\nRecall@k  现状 ' + h0 + '/' + rows.length + '  → 修后 ' + h1 + '/' + rows.length);
console.log('MRR       现状 ' + m0.toFixed(4) + '  → 修后 ' + m1.toFixed(4)
  + '  (' + ((m1 - m0) >= 0 ? '+' : '') + ((m1 - m0) * 100).toFixed(1) + '%相对)');
console.log('\n⇒ 若 MRR 明显提升而 Recall 不变，说明 bug 危害真实存在，');
console.log('  但被 Recall@k 的零和性掩盖了（第 2 名回来必然挤掉原来第 k 位）。');
