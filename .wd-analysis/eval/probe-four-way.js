/* 四方案分解：把两个修复各自的贡献分开
 *
 * 历史上有两个独立的改动，之前的对比把它们混在一起了：
 *   改动1  修分组 bug：第 2 名被赋成循环结束后的最终组号 → 赋成初始 g
 *   改动2  收窄并列判据：名次差 ≤2 算并列 → 原始分相等才算并列
 *
 * 四个方案（全部调 lib-pool.order，已与产品逐位对拍）：
 *   A  纯相关（关换位）                     —— 天花板
 *   B  换位 + 旧分组(bug) + 近似并列(tie2)   —— 最初的状态
 *   D  换位 + 修分组     + 近似并列(tie2)   —— 只做改动1
 *   C  换位 + 修分组     + 精确并列(tie0)   —— 现状（改动1+2）
 *
 * 只有拆成这样，才能回答「改动2 值不值」，
 * 而不是把两个改动绑在一起说「总共提升了多少」。
 */
'use strict';
const M = require('./lib-pool.js');
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

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

const PLANS = {
  A: { swap: false, fix: false, legacy: 0,      label: 'A 纯相关（关换位）' },
  B: { swap: true,  fix: false, legacy: 2,      label: 'B 换位+旧分组+近似并列' },
  D: { swap: true,  fix: true,  legacy: 2,      label: 'D 换位+修分组+近似并列' },
  C: { swap: true,  fix: true,  legacy: 0,      label: 'C 换位+修分组+精确并列（现状）' },
};

function collect(list) {
  const out = [];
  for (const c of list) {
    if (!(c.gold || []).length) continue;
    const p = M.pool(c.sid, c.q);
    if (p.items.length < 4) continue;
    const rec = { id: c.id, cat: c.cat, ladder: c.ladder };
    let basePos = 0;
    for (const [k, pl] of Object.entries(PLANS)) {
      const arr = M.order(p.items, NOW, pl.swap, pl.fix, p.rankMode, { legacyTie: pl.legacy });
      let best = 0;
      for (const g of c.gold) {
        const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
        if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
      }
      rec[k] = best ? 1 / best : 0;
      if (k === 'A') basePos = best;
    }
    rec.pA = basePos;
    out.push(rec);
  }
  return out;
}

function report(rows, title) {
  if (!rows.length) return;
  console.log('\n' + title + '  n=' + rows.length);
  console.log('   ' + Object.values(PLANS).map((p, i) => (p.label.split(' ')[0] + ' ' + (mean(rows.map((r) => r[Object.keys(PLANS)[i]])) * 100).toFixed(2) + '%')).join('   '));
  for (const [x, y, tag] of [['A', 'B', 'A→B 加换位(原始)'], ['B', 'D', 'B→D 只修分组'], ['D', 'C', 'D→C 再收窄并列'], ['B', 'C', 'B→C 两项合计'], ['A', 'C', 'A→C 现状 vs 纯相关']]) {
    const d = rows.map((r) => r[y] - r[x]);
    const w = wilcoxon(d);
    const dd = mean(d) * 100;
    const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
    console.log('    ' + tag.padEnd(20) + 'Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
      + '  改善 ' + String(up).padStart(2) + '/恶化 ' + String(dn).padStart(2)
      + '  p=' + w.p.toFixed(4) + (w.p < 0.05 ? ' ✅' : w.p < 0.10 ? ' 🟡' : ' ⚪'));
  }
}

const base = collect(ALL);
const fresh = collect(FRESH);
report(base, '=== 全量 126 题 ===');
report(fresh, '\n=== 第四批（新鲜度梯度）===');
report(base.filter((r) => r.pA >= 2 && r.pA <= 4), '\n=== gold 落在第 2~4 名（换位唯一作用区间）===');
report(base.filter((r) => r.pA === 1), '\n=== gold 落在第 1 名（不变量①）===');
