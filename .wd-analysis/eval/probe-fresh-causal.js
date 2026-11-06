/* 新鲜度梯度的因果实验 —— 本轮的核心产出
 *
 * 问题：换位机制到底有没有用？
 *
 * 前三批 109 题答不了这个问题，因为它们的 gold 几乎全都一样新鲜（都是回合末结论），
 * 新鲜度这个自变量没有方差 ⇒ 无论换位做得对错，测出的都是噪声。
 * 第四批用「回归套件数」这条 41→88 的真实序列造了三档 gold：
 *   latest   recency≈0.97  ⇒ 换位**应该**帮忙
 *   mid      recency≈0.59  ⇒ 中性
 *   earliest recency≈0.37  ⇒ 换位**应该**帮倒忙
 *
 * 判据（这是本实验唯一的逻辑）：
 *   · 若 latest 组 A→C 显著为正、earliest 组显著为负 ⇒ 换位确实在按新鲜度做事，
 *     那问题是「要不要这种偏好」，属于产品取向。
 *   · 若两组同向、或都不显著 ⇒ 换位**根本没在按新鲜度做事**，那它就是个纯扰动。
 *
 * ⚠️ 必须用 MRR，不能用 Recall@k（零和，第 2 名回位会把第 8 名挤到第 9 名）。
 */
'use strict';
const { FRESH, LATEST, EARLIEST, MID } = require('./cases-fresh.js');
const M = require('./lib-pool.js');
const NOW = Date.now();

function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function wilcoxon(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, p: 1, Wp: 0, Wm: 0, z: 0 };
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

/* 三个方案：A 纯相关 / B 旧版含 bug / C 修复后（= 产品现状） */
function run(list) {
  const rows = [];
  for (const c of list) {
    if (!(c.gold || []).length) continue;
    const p = M.pool(c.sid, c.q);
    if (!p.items.length) continue;
    const mrrOf = (sw, fix) => {
      const arr = M.order(p.items, NOW, sw, fix, p.rankMode);
      let best = 0;
      for (const g of c.gold) {
        const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
        if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
      }
      return best ? 1 / best : 0;
    };
    let goldRec = null;
    for (const g of c.gold) {
      const it = p.items.find((x) => Number(x.r.seq) === Number(g));
      if (it) { goldRec = M.recencyOf(it.r.ts, it.r.last_hit_ts, NOW); break; }
    }
    rows.push({
      id: c.id, ladder: c.ladder || c.cat, pool: p.items.length, goldRec,
      A: mrrOf(false, false), B: mrrOf(true, false), C: mrrOf(true, true),
    });
  }
  return rows;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const rows = run(FRESH);

console.log('=== 第四批（新鲜度梯度）' + rows.length + ' 道正例 ===\n');
console.log('方案                     MRR      (A=纯相关 / B=换位含bug / C=换位修复后=产品现状)');
console.log('  A 纯相关性（关换位）    ' + (mean(rows.map((r) => r.A)) * 100).toFixed(2) + '%');
console.log('  B 换位·旧版（含 bug）   ' + (mean(rows.map((r) => r.B)) * 100).toFixed(2) + '%');
console.log('  C 换位·修复后（现状）   ' + (mean(rows.map((r) => r.C)) * 100).toFixed(2) + '%');

function cmp(sub, x, y, tag) {
  const d = sub.map((r) => r[y] - r[x]);
  const w = wilcoxon(d);
  const dd = mean(d) * 100;
  const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
  const sig = w.p < 0.05 ? '✅ 显著' : w.p < 0.10 ? '🟡 边缘' : '⚪ 不显著';
  console.log('  ' + tag.padEnd(26) + ' Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
    + '  改善 ' + String(up).padStart(2) + ' / 恶化 ' + String(dn).padStart(2)
    + '  n=' + String(w.n).padStart(2) + '  p=' + w.p.toFixed(4) + '  ' + sig);
  return { dd, p: w.p, up, dn };
}

console.log('\n── 按新鲜度分档（A→C，即「加换位」的真实影响）──');
for (const [name, list] of [['latest（gold 最新）', LATEST], ['mid（gold 居中）', MID], ['earliest（gold 最旧）', EARLIEST]]) {
  const sub = rows.filter((r) => list.some((c) => c.id === r.id));
  if (!sub.length) continue;
  const rec = mean(sub.map((r) => r.goldRec).filter((x) => x !== null));
  console.log('\n' + name + '  n=' + sub.length + '  gold recency 均值 ' + rec.toFixed(3));
  console.log('   A ' + (mean(sub.map((r) => r.A)) * 100).toFixed(1) + '% → C '
    + (mean(sub.map((r) => r.C)) * 100).toFixed(1) + '%');
  cmp(sub, 'A', 'C', 'A 纯相关 → C 换位');
  cmp(sub, 'B', 'C', 'B 旧版  → C 修复后');
}

console.log('\n── 判据（这是本实验唯一的逻辑）──');
const lat = rows.filter((r) => LATEST.some((c) => c.id === r.id));
const ear = rows.filter((r) => EARLIEST.some((c) => c.id === r.id));
const dLat = mean(lat.map((r) => r.C - r.A)) * 100;
const dEar = mean(ear.map((r) => r.C - r.A)) * 100;
console.log('  latest   组 Δ(latest C−A) = ' + (dLat >= 0 ? '+' : '') + dLat.toFixed(2) + 'pp  （期望为正）');
console.log('  earliest 组 Δ(earliest C−A) = ' + (dEar >= 0 ? '+' : '') + dEar.toFixed(2) + 'pp  （期望为负）');
if (dLat > 0 && dEar < 0) {
  console.log('  ⇒ ✅ 换位**确实在按新鲜度做事**：新内容受益、旧内容受害。');
  console.log('     那问题就不是「换位有没有生效」，而是「这种偏好值不值」——属于产品取向。');
} else if (Math.abs(dLat - dEar) < 0.15 * Math.abs(dLat + dEar) + 5) {
  console.log('  ⇒ ❌ 两组变化方向趋同 ⇒ 换位**没有按新鲜度做事**，它只是一个相关性扰动。');
} else {
  console.log('  ⇒ ⚠️ 方向异常，需逐题查。');
}
