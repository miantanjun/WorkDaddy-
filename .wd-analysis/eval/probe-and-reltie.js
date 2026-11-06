/* AND 路 REL_TIE 扫描 —— 用「不依赖 gold 的机制指标」判断参数是否合理
 *
 * 为什么不能只看 MRR：
 *   这套 AND 题的 gold 是用「词法重叠」构造的（短查询的全部 bigram 都出现在 gold 行内），
 *   所以它测的不是语义正确性，而是「词法强相关的那些行里，产品排序把目标行排到第几」。
 *   这个性质让它适合做**相对 A/B**，但 MRR 的绝对值不能当"AND 路召回率"引用。
 *   ⇒ 参数决策必须同时看**纯机制指标**，它们与 gold 正确性无关：
 *       · 组数（池子被切成多少组）—— 组数=1 意味着换位可以完全重排，相关性形同虚设
 *       · 最大组占比 —— 大组内完全靠新鲜度/重要度决定顺序，bm25 一点不起作用
 *       · 第 1 名是否被换掉 —— 这是"相关性优先"的核心承诺，被换掉就是失守
 *
 * 工作区记忆里有一条既有判据：
 *   「AND span×12% 分母取全池全距 ⇒ 漂移 0.14~0.71× ⇒ 不改」
 *   本脚本就是把这句话量化：AND 池的全距分布 + 0.12 换算成绝对分后漂移多少。
 */
'use strict';
const path = require('path');
const lib = require('./lib-pool.js');
const final = require('./out/and-final.json');
const now = Date.now();

function groupsOf(items, ratio) {
  const rels = items.map((x) => Number(x.rel) || 0);
  const span = Math.max(...rels) - Math.min(...rels);
  const tie = span > 0 ? span * ratio : Infinity;
  const arr = items.map((x, i) => ({ x, i })).sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const g = arr.map(() => 0);
  if (arr.length > 1) {
    let cur = 1, anchor = arr[1];
    g[1] = cur;
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor.x.rel > tie) { cur += 1; anchor = arr[k]; }
      g[k] = cur;
    }
  }
  const sizes = {};
  for (const v of g) sizes[v] = (sizes[v] || 0) + 1;
  /* 组 0 只有第 1 名（独占）。看第 2 名起的组里，第 1 名有没有被换走：
     逐个组算「组内 rankKey 最高的是不是原相关性第 1 条」。 */
  let demoted = 0;
  if (arr.length > 1) {
    const firstOfGroup = {};
    for (let k = 1; k < arr.length; k++) if (!(g[k] in firstOfGroup)) firstOfGroup[g[k]] = arr[k];
    for (const key of Object.keys(firstOfGroup)) {
      const members = arr.filter((_x, k) => k >= 1 && g[k] === Number(key));
      if (members.length < 2) continue;
      const best = members.slice().sort((a, b) => lib.rankKey(b.x.r, now) - lib.rankKey(a.x.r, now))[0];
      if (best !== firstOfGroup[key]) demoted++;
    }
  }
  return {
    nGroups: Object.keys(sizes).length,
    maxGroup: Math.max(...Object.values(sizes)),
    pool: arr.length,
    demoted,
    tie, span,
  };
}

const ratios = [0.02, 0.05, 0.08, 0.12, 0.20, 0.30, 0.50, 1.00];
console.log('REL_TIE 扫描（n=' + final.length + ' 道 AND 题）');
console.log('ratio   | MRR%  R@5  R@10 | 组数中位 最大组占比中位 换位影响组数中位 | 绝对阈值中位');
console.log('--------|-----------------|------------------------------------|---------------');

for (const r of ratios) {
  const ore = [];
  const gs = [];
  for (const x of final) {
    const p = lib.pool(x.sid, x.q);
    if (!p.items.length) { ore.push({ mrr: 0, rank: 999 }); continue; }
    /* lib.order 内部写死 REL_TIE，无法按比例覆盖 ⇒ 这里自己复算一次组结构，
       但**打分仍用 lib.order 的产物**会与组结构不一致。
       所以：本扫描只用组结构做机制分析，MRR 一列直接复用现状值（ratio=0.12）。 */
    const g = groupsOf(p.items, r);
    gs.push(g);
    ore.push(g);
  }
  const med = (arr, key) => {
    const a = arr.map((x) => x[key]).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const ratioPct = (med(gs, 'maxGroup') / med(gs, 'pool') * 100).toFixed(1);
  const tieMed = med(gs, 'tie').toFixed(2);
  const mrr = r === 0.12 ? '22.45' : '  -  ';
  console.log(String(r).padEnd(7) + ' | ' + String(mrr).padStart(5) + '   -    -  | '
    + String(med(gs, 'nGroups')).padStart(7) + '  ' + String(ratioPct).padStart(12) + '%  '
    + String(med(gs, 'demoted')).padStart(14) + ' | ' + String(tieMed).padStart(10));
}

/* 全距漂移：这是"分母取全池全距"这件事的直接量化 */
const spans = final.map((x) => {
  const p = lib.pool(x.sid, x.q);
  if (!p.items.length) return null;
  const rels = p.items.map((i) => Number(i.rel) || 0);
  return Math.max(...rels) - Math.min(...rels);
}).filter((v) => v != null).sort((a, b) => a - b);
const qs = (p) => spans[Math.min(spans.length - 1, Math.floor(spans.length * p))];
console.log('');
console.log('AND 池 bm25 全距：p10=' + qs(0.1).toFixed(2) + ' p50=' + qs(0.5).toFixed(2)
  + ' p90=' + qs(0.9).toFixed(2) + ' → 极差 ' + (qs(0.9) / qs(0.1)).toFixed(2) + '×');
console.log('REL_TIE=0.12 换算成绝对分：' + [0.1, 0.5, 0.9]
  .map((p) => 'p' + Math.round(p * 100) + '=' + (qs(p) * 0.12).toFixed(2)).join(' / ')
  + ' ⇒ 漂移 ' + ((qs(0.9) * 0.12) / (qs(0.1) * 0.12)).toFixed(2) + '×');
