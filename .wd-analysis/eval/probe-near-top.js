/* 只看「换位真能起作用」的那批题：gold 在相关性排序前 4 名
 *
 * 为什么要切出这个子集：
 *   实测换位的理论作用范围只有 ±2 名（RANK_TIE=2 决定）。gold 在第 8 名以外时，
 *   它无论怎么排都进不了前 8，纳入统计只会把真实效应稀释成 0。
 *   只有 gold 在第 1~4 名时，±2 名的位移才可能改变「是否进前 8」或 MRR 的实质。
 *   这是唯一能给出「换位值不值」答案的样本。
 */
'use strict';
const { ALL, FRESH } = require('./all-cases.js');
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
  return { n, Wp, Wm, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const m = (sw, fix) => {
    const arr = M.order(p.items, NOW, sw, fix, p.rankMode);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    return best;
  };
  const pA = m(false, false);
  const pB = m(true, false);
  const pC = m(true, true);
  rows.push({ id: c.id, cat: c.cat, pA, A: pA ? 1 / pA : 0, B: pB ? 1 / pB : 0, C: pC ? 1 / pC : 0 });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
function seg(name, f) {
  const sub = rows.filter((r) => f(r.pA));
  if (sub.length < 3) { console.log('\n' + name + '  n=' + sub.length + '（太少，跳过）'); return; }
  console.log('\n' + name + '  n=' + sub.length);
  console.log('  A 纯相关 ' + (mean(sub.map((r) => r.A)) * 100).toFixed(2) + '%'
    + '   B 旧版 ' + (mean(sub.map((r) => r.B)) * 100).toFixed(2) + '%'
    + '   C 修复 ' + (mean(sub.map((r) => r.C)) * 100).toFixed(2) + '%');
  for (const [x, y, tag] of [['A', 'B', 'A→B 加换位(旧)'], ['A', 'C', 'A→C 加换位(修复)'], ['B', 'C', 'B→C 修 bug']]) {
    const d = sub.map((r) => r[y] - r[x]);
    const w = wilcoxon(d);
    const dd = mean(d) * 100;
    const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
    const sig = w.p < 0.05 ? '✅' : w.p < 0.10 ? '🟡' : '⚪';
    console.log('    ' + tag.padEnd(20) + ' Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
      + '  改善 ' + up + '/恶化 ' + dn + '  n=' + w.n + '  p=' + w.p.toFixed(4) + ' ' + sig);
  }
}

console.log('=== 按「gold 在相关性排序的落位」切分（全部 143 题） ===');
console.log('前 8 命中: ' + rows.filter((r) => r.pA >= 1 && r.pA <= 8).length + '/' + rows.length);
seg('gold 在第 1 名（换位动不了，应 Δ=0）', (p) => p === 1);
seg('gold 在第 2~4 名（换位唯一的作用区间）', (p) => p >= 2 && p <= 4);
seg('gold 在第 5~8 名', (p) => p >= 5 && p <= 8);
seg('gold 在第 9~20 名（换位够不着）', (p) => p >= 9 && p <= 20);
seg('gold 在 20 名外', (p) => p > 20);
