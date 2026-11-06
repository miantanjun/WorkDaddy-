/* 按**真实路径**分别测：名次制（OR）和分数制（AND/LIKE）分开算
 *
 * 上一版把所有查询都当成 rankMode:true 跑，分数制路径被歪曲了。
 * 两条路的「并列」定义本来就不一样：
 *   名次制  rel=名次整数 ⇒ tie 只能是名次差；tie=0 ⇒ 每条自成一组 ⇒ 纯相关性
 *   分数制  rel=bm25    ⇒ tie = 全距×0.12 ⇒ 真的有「分数接近」这回事
 * ⇒ 绝不能用同一个开关覆盖两条路。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const ck = M.ck;
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();
const fn = ck.rankRelevanceFirst;

function wilcoxon(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, p: 1 };
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
  const erf = (x) => {
    const sg = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return sg * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  return { n, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const rm = !!p.rankMode;
  const call = (mode) => {
    if (mode === 'A') return p.items.slice().sort((a, b) => a.rel - b.rel);
    /* 按真实路径调用：名次制传 rankTie，分数制不传（产品内部用 span×0.12） */
    if (rm) return fn(p.items, NOW, { rankMode: true, rankTie: mode === 'T0' ? 0 : M.RANK_TIE });
    return mode === 'T0'
      ? fn(p.items, NOW, { rankMode: false, rankTie: 0 })     /* tie=0：只有分数完全相等才并列 */
      : fn(p.items, NOW, { rankMode: false });
  };
  const pos = (mode) => {
    const arr = call(mode);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    return best;
  };
  const pA = pos('A'), p0 = pos('T0'), p2 = pos('T2');
  rows.push({ id: c.id, rm, pA,
    A: pA ? 1 / pA : 0, T0: p0 ? 1 / p0 : 0, T2: p2 ? 1 / p2 : 0 });
}

for (const [nm, sub] of [['名次制 OR 路径', rows.filter((r) => r.rm)], ['分数制 AND/LIKE 路径', rows.filter((r) => !r.rm)]]) {
  if (!sub.length) { console.log(nm + ' 无样本'); continue; }
  console.log('\n=== ' + nm + '  n=' + sub.length + ' ===');
  console.log('  A 纯相关 ' + (mean(sub.map((r) => r.A)) * 100).toFixed(2) + '%   '
    + 'T0 仅完全并列 ' + (mean(sub.map((r) => r.T0)) * 100).toFixed(2) + '%   '
    + 'T2 现状 ' + (mean(sub.map((r) => r.T2)) * 100).toFixed(2) + '%');
  const d0 = sub.filter((r) => r.A !== r.T0).length;
  console.log('  T0 与 A 落位不同的题: ' + d0 + '/' + sub.length);
  for (const [x, y, tag] of [['A', 'T0', 'A→T0'], ['T0', 'T2', 'T0→T2'], ['A', 'T2', 'A→T2']]) {
    const d = sub.map((r) => r[y] - r[x]);
    const w = wilcoxon(d);
    const dd = mean(d) * 100;
    const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
    console.log('    ' + tag.padEnd(8) + ' Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
      + '  改善 ' + String(up).padStart(2) + '/恶化 ' + String(dn).padStart(2)
      + '  p=' + w.p.toFixed(4) + (w.p < 0.05 ? ' ✅' : w.p < 0.10 ? ' 🟡' : ' ⚪'));
  }
}
