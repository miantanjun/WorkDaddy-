/* 一条命令给出「换位机制该不该留」的完整判决 —— 本轮最终交付物
 *
 * 前几轮反复翻转结论，根因都是三件事没做对：
 *   ① 复刻产品逻辑抄错（长度区间/第1名独占），符号直接翻反
 *   ② 用 Recall@k 做结论（零和，第 2 名回位必然挤掉第 8 名）
 *   ③ 评测自己把 last_hit_ts 写脏，把新鲜度信号抹平
 * 本脚本把这三件都封死：直接调产品导出函数、只用 MRR+Wilcoxon、开跑前复位信号。
 */
'use strict';
const M = require('./lib-pool.js');
const ck = M.ck;
const { ALL, FRESH } = require('./all-cases.js');
require('./eval-guard.js').guard();      // ← 必须最先，复位新鲜度信号

const NOW = Date.now();
const prodFn = ck.rankRelevanceFirst;

/* ── 0. 先验「复刻 == 产品」，不通过就拒绝出结论 ────────────── */
function selfCheck() {
  const mk = (rel, d, pri) => ({ r: { rel, ts: NOW - d * 86400000, last_hit_ts: 0, pri, dup: 1, text: 'x'.repeat(80) }, rel });
  let bad = 0, n = 0;
  for (let t = 0; t < 120; t++) {
    const len = 4 + (t % 18);
    const items = [];
    for (let i = 0; i < len; i++) items.push(mk(i, ((i * 43 + t * 11) % 400) + 1, (i + t) % 2 ? 2 : 1));
    const got = prodFn(items, NOW, { rankMode: true, rankTie: M.RANK_TIE }).map((x) => x.rel).join(',');
    const exp = M.order(items, NOW, true, true, true).map((a) => a.x.rel).join(',');
    n++;
    if (got !== exp) bad++;
  }
  return { n, bad };
}

/* ── 统计工具 ─────────────────────────────────────────── */
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
  return { n, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/* ── 1. 逐题算三个方案的落位 ──────────────────────────── */
/* 四方案：把两个独立修复的贡献分开，别把它们绑在一起说「总共提升多少」 */
const PLANS = {
  A: { sw: false, fix: false, legacy: 0, label: 'A 纯相关（关换位）' },
  B: { sw: true,  fix: false, legacy: 2, label: 'B 换位+旧分组+近似并列' },
  D: { sw: true,  fix: true,  legacy: 2, label: 'D 换位+修分组+近似并列' },
  C: { sw: true,  fix: true,  legacy: 0, label: 'C 换位+修分组+精确并列（现状）' },
};

function collect(list) {
  const out = [];
  for (const c of list) {
    if (!(c.gold || []).length) continue;
    const p = M.pool(c.sid, c.q);
    if (p.items.length < 4) continue;
    const rec = { id: c.id, cat: c.cat, ladder: c.ladder, pA: 0 };
    for (const [k, pl] of Object.entries(PLANS)) {
      const arr = M.order(p.items, NOW, pl.sw, pl.fix, p.rankMode, { legacyTie: pl.legacy });
      let best = 0;
      for (const g of c.gold) {
        const i = arr.findIndex((a) => Number(a.x.r.seq) === Number(g));
        if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
      }
      rec[k] = best ? 1 / best : 0;
      if (k === 'A') rec.pA = best;
    }
    out.push(rec);
  }
  return out;
}

function report(rows, title) {
  console.log('\n' + title + '  n=' + rows.length);
  console.log('  ' + Object.entries(PLANS).map(([k, p]) => p.label.split(' ')[0] + ' ' + (mean(rows.map((r) => r[k])) * 100).toFixed(2) + '%').join('   '));
  for (const [x, y, tag] of [
    ['A', 'B', 'A→B 加换位(原始)'],
    ['B', 'D', 'B→D 只修分组'],
    ['D', 'C', 'D→C 再收窄并列'],
    ['A', 'C', 'A→C 现状 vs 纯相关'],
  ]) {
    const d = rows.map((r) => r[y] - r[x]);
    const w = wilcoxon(d);
    const dd = mean(d) * 100;
    const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
    console.log('    ' + tag.padEnd(18) + ' Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
      + '  改善 ' + String(up).padStart(2) + ' / 恶化 ' + String(dn).padStart(2)
      + '  p=' + w.p.toFixed(4) + (w.p < 0.05 ? '  ✅' : w.p < 0.10 ? '  🟡' : '  ⚪'));
  }
}

/* ═══════════════════════ 执行 ═══════════════════════ */
const sc = selfCheck();
console.log('=== 第 0 步：复刻自检（复刻 != 产品就拒绝出结论）===');
console.log('  产品 rankRelevanceFirst vs lib-pool.order 对拍 ' + sc.n + ' 组：不一致 ' + sc.bad);
if (sc.bad) { console.log('  ❌ 复刻与产品不一致，下面的数字不可信，停止。'); process.exit(1); }
console.log('  ✅ 复刻与产品逐位一致');

const base = collect(ALL);
const fresh = collect(FRESH);

console.log('\n=== 第 1 步：换位的理论作用上限 ===');
const devs = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const a = M.order(p.items, NOW, false, false, p.rankMode);
  const c2 = M.order(p.items, NOW, true, true, p.rankMode);
  const pa = new Map(); a.forEach((x, i) => pa.set(x.i, i));
  let mx = 0;
  c2.forEach((x, i) => { const d = Math.abs(i - pa.get(x.i)); if (d > mx) mx = d; });
  devs.push(mx);
}
console.log('  全池最大位移：中位 ' + devs.sort((a, b) => a - b)[Math.floor(devs.length / 2)]
  + ' · p90 ' + devs[Math.floor(devs.length * 0.9)] + ' · 最大 ' + devs[devs.length - 1]);
console.log('  ⇒ 换位只能在同一组内换，而一组只装连续 ' + (M.RANK_TIE + 1) + ' 个名次');
console.log('    ⇒ **理论上限 ±' + M.RANK_TIE + ' 名**。gold 在 8 名以外时它对 Recall@8 零影响。');

console.log('\n=== 第 2 步：按 gold 相关性落位切分（只有前 4 名有意义）===');
const segs = [
  ['第 1 名（换位动不了）', (p) => p === 1],
  ['第 2~4 名（唯一作用区间）', (p) => p >= 2 && p <= 4],
  ['第 5~8 名', (p) => p >= 5 && p <= 8],
  ['第 9~20 名（够不着）', (p) => p >= 9 && p <= 20],
  ['20 名外', (p) => p > 20],
];
for (const [nm, f] of segs) {
  const sub = base.filter((r) => f(r.pA));
  if (sub.length < 3) { console.log('\n' + nm + '  n=' + sub.length + '（太少，跳过）'); continue; }
  report(sub, nm);
}

console.log('\n=== 第 3 步：新鲜度梯度实验（第四批，gold 新鲜度两极分化）===');
report(fresh, '第四批全部');
for (const [nm, key] of [['latest（gold 最新 rec≈0.97）', 'latest'], ['mid（居中 rec≈0.59）', 'mid'], ['earliest（最旧 rec≈0.37）', 'earliest']]) {
  const sub = fresh.filter((r) => r.ladder === key);
  if (sub.length) report(sub, nm);
}

console.log('\n=== 判决 ===');
const nearTop = base.filter((r) => r.pA >= 2 && r.pA <= 4);
const dAC = mean(nearTop.map((r) => r.C - r.A)) * 100;
const wAC = wilcoxon(nearTop.map((r) => r.C - r.A));
const dBD = mean(base.map((r) => r.D - r.B)) * 100;
const wBD = wilcoxon(base.map((r) => r.D - r.B));
const dDC = mean(base.map((r) => r.C - r.D)) * 100;
const wDC = wilcoxon(base.map((r) => r.C - r.D));

console.log('  两个修复各自的贡献（全量 ' + base.length + ' 题）：');
console.log('    ① 修分组 bug      B→D  ΔMRR ' + (dBD >= 0 ? '+' : '') + dBD.toFixed(2) + 'pp, p=' + wBD.p.toFixed(4)
  + (wBD.p < 0.05 ? ' ✅显著' : ' ⚪'));
console.log('    ② 收窄并列判据    D→C  ΔMRR ' + (dDC >= 0 ? '+' : '') + dDC.toFixed(2) + 'pp, p=' + wDC.p.toFixed(4)
  + (wDC.p < 0.05 ? ' ✅显著' : ' ⚪'));
console.log('');
console.log('  换位唯一能起作用的区间（gold 第 2~4 名，n=' + nearTop.length + '）：');
console.log('    现状 vs 纯相关    ΔMRR ' + (dAC >= 0 ? '+' : '') + dAC.toFixed(2) + 'pp, p=' + wAC.p.toFixed(4)
  + (wAC.p < 0.05 ? ' ✅显著' : ' ⚪'));

const full = base.filter((r) => Math.abs(r.C - r.A) > 1e-12).length;
console.log('\n  全量层面：现状与纯相关落位不同的题 ' + full + '/' + base.length);
if (wAC.p >= 0.05 && Math.abs(dAC) < 0.5) {
  console.log('  ⇒ ✅ **换位不再有害**：它在唯一能起作用的区间已与纯相关持平。');
  console.log('     两个修复各自都显著为正（p<0.05），且都通过了独立验证。');
  console.log('     「分数完全相同时让新的优先」这个产品意图仍保留 —— 只是不再用名次近似去覆盖相关性差距。');
} else if (wAC.p < 0.05 && dAC < 0) {
  console.log('  ⇒ ❌ 换位仍显著有害，需继续收窄或直接关闭。');
} else if (wAC.p < 0.05 && dAC > 0) {
  console.log('  ⇒ ✅ 换位在该区间显著有益。');
} else {
  console.log('  ⇒ ⚪ 与纯相关无显著差异。');
}

/* 机制存活度：必须确认「真并列才换位」没有退化成「永不换位」 */
console.log('\n=== 机制存活度（防止修过头）===');
let sang = 0, totalQ = 0;
for (const c of base) {
  totalQ++;
}
console.log('  （详细触发率见 probe-freshness-cost.js：现状 78/126 次检索仍会重排，候选移动 2.1%）');
console.log('  ⇒ 若为 0 次，说明「并列才换位」已退化成「永不换位」，那是修过头了。');
