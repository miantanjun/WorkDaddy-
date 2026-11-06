/* 最终定案：改用 MRR 做配对 Wilcoxon，并直白给出「该不该动产品排序」
 *
 * 为什么必须换掉 Recall@k 做结论：
 *   Recall@8 是零和的（第 2 名回位必然把第 8 名挤到第 9 名），
 *   实测「修 bug 救活 10 题 / 害掉 5 题」在 Recall 上表现成 61→61 净 0，
 *   完全是 k=8 刀口效应。MRR 是连续量，才能看出真实位移。
 */
'use strict';
const { ALL } = require('./all-cases.js');
const M = require('./lib-pool.js');
/* ⚠️ 必须复位：产品 search() 会回写 last_hit_ts，跑过一次评测就把新鲜度信号抹平。
   不复位的话「recency>0.999 有 98 条」这种假象会不断重现（那正是上一轮的误判来源）。 */
require('./eval-guard.js').guard();
const NOW = Date.now();

function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function wilcoxon(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, p: 1, Wp: 0, Wm: 0 };
  const s = nz.map((v) => ({ v, a: Math.abs(v) })).sort((x, y) => x.a - y.a);
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && Math.abs(s[j + 1].a - s[i].a) < 1e-12) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) s[k].r = r;
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (const x of s) { if (x.v > 0) Wp += x.r; else Wm += x.r; }
  const W = Math.min(Wp, Wm), mu = n * (n + 1) / 4, sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu + 0.5) / sd;
  return { n, Wp, Wm, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}

const rows = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (!p.items.length) continue;
  const get = (sw, fix) => {
    const arr = M.order(p.items, NOW, sw, fix, p.rankMode);
    let best = 0, rec = null;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) { best = i + 1; }
    }
    /* gold 在**原始相关性**里的落位与新鲜度 */
    const rawArr = p.items.slice().sort((a, b) => a.rel - b.rel);
    for (const g of c.gold) {
      const it = rawArr.find((x) => Number(x.r.seq) === Number(g));
      if (it) { rec = M.recencyOf(it.r.ts, it.r.last_hit_ts, NOW); break; }
    }
    return { mrr: best ? 1 / best : 0, pos: best, rec };
  };
  const A = get(false, false), B = get(true, false), C = get(true, true);
  rows.push({ id: c.id, cat: c.cat, A, B, C });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const n = rows.length;
const M_ = (k) => mean(rows.map((r) => r[k].mrr));

console.log('=== 109 道正例，MRR 三方对比 ===');
console.log('  A 纯相关性（关换位）  ' + (M_('A') * 100).toFixed(2) + '%');
console.log('  B 换位·现状（含bug）  ' + (M_('B') * 100).toFixed(2) + '%');
console.log('  C 换位·修分组bug      ' + (M_('C') * 100).toFixed(2) + '%\n');

function test(x, y, tag) {
  const d = rows.map((r) => r[y].mrr - r[x].mrr);
  const w = wilcoxon(d);
  const up = d.filter((v) => v > 1e-9).length, down = d.filter((v) => v < -1e-9).length;
  const dd = mean(d) * 100;
  const sig = w.p < 0.05 ? '✅ 显著' : w.p < 0.10 ? '🟡 边缘' : '⚪ 不显著';
  console.log(tag);
  console.log('   ΔMRR ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp · 改善 ' + up + ' / 恶化 ' + down
    + ' · Wilcoxon n=' + w.n + ' W+=%.0f W-=%.0f z='.replace('%.0f', w.Wp).replace('%.0f', w.Wm)
    + w.z.toFixed(2) + ' p=' + w.p.toFixed(4) + '  ' + sig);
}
test('A', 'B', '① A 纯相关 → B 现状');
test('A', 'C', '② A 纯相关 → C 修bug');
test('B', 'C', '③ B 现状   → C 修bug');

/* 新鲜度信号是否被评测集压平 —— 这是解释一切的关键 */
const recs = rows.map((r) => r.A.rec).filter((x) => x !== null);
const sat = recs.filter((x) => x > 0.999).length;
console.log('\n=== 评测集盲区自检：gold 的新鲜度分布 ===');
console.log('  n=' + recs.length + ' · recency>0.999 的有 ' + sat + ' 条 ('
  + (sat / recs.length * 100).toFixed(1) + '%)');
if (sat / recs.length > 0.5) {
  console.log('  ⚠️ 过半 gold 都≈1.000 ⇒ 新鲜度信号被压平，换位的收益/损失测不出来。');
  console.log('     最常见原因不是「评测集天生如此」，而是**评测自己刚把它写脏了**：');
  console.log('     产品 search() 会回写 last_hit_ts=now（ck-memory.js:2027）。');
  console.log('     ⇒ 换位/新鲜度相关的评测必须先跑 eval-guard.js 复位。');
} else {
  console.log('  ✅ 新鲜度梯度真实存在 ⇒ 这批题可以如实测量换位机制的收益与代价。');
  console.log('     （上一轮判断「这是评测集盲区」是**错的**：真实原因是评测回写污染了信号。）');
}
