/* AND 路 REL_TIE 扫描 v2 —— 真正扫 MRR 曲线
 *
 * v1 只算了组结构、MRR 列全是「-」，因为它无法覆盖 REL_TIE。
 * v2 给 lib-pool.order 加了 relTie 覆盖入口（默认不传 = 生产值 0.12），现在能扫了。
 *
 * ⚠️ 读数纪律（别被自己的数字骗）：
 *   这套题的 gold 是「词法重叠」构造的，MRR 绝对值不代表语义召回率。
 *   它只能回答一个**相对**问题：在这个构造方式下，阈值取大取小哪个更好。
 *   而且 n=50，MRR 差 2~3pp 完全可能在噪声里 —— 所以必须同时看：
 *     ① 逐题胜/负计数（不是只看均值）
 *     ② 配对符号检验的 p 值（Wilcoxon 简化版，样本小用精确符号检验更稳）
 *   只报均值不报显著性，是上一阶段反复吃过的亏。
 */
'use strict';
const path = require('path');
const lib = require('./lib-pool.js');
const final = require('./out/and-final.json');
const now = Date.now();

function evalRatio(ratio) {
  const out = [];
  for (const x of final) {
    const p = lib.pool(x.sid, x.q);
    if (!p.items.length) { out.push({ mrr: 0, rank: 999 }); continue; }
    const ord = lib.order(p.items, now, true, true, p.rankMode, { relTie: ratio });
    const seqs = ord.map((a) => Number(a.x.r.seq));
    let best = -1;
    for (const g of x.gold) {
      const i = seqs.indexOf(Number(g));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    out.push({ mrr: best < 0 ? 0 : 1 / (best + 1), rank: best < 0 ? 999 : best + 1 });
  }
  return out;
}

/* 配对符号检验（精确二项，n<=25 时够用；n 大时正态近似）
   p = 2 * P(X <= min(wins,losses) | n, 0.5) */
function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let cum = 0;
  for (let i = 0; i <= k; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1);
    cum += c;
  }
  const p = 2 * cum / Math.pow(2, n);
  return Math.min(1, p);
}

const ratios = [0.02, 0.05, 0.08, 0.12, 0.20, 0.30, 0.50];
const base = evalRatio(0.12);
const baseM = base.reduce((s, r) => s + r.mrr, 0) / base.length;

console.log('REL_TIE 扫描（n=' + final.length + '，基线 0.12 MRR='
  + (baseM * 100).toFixed(2) + '%）');
console.log('ratio | MRR%   R@1 R@5 R@10 | vs基线 胜/负/平 | 符号检验 p');
console.log('------|---------------------|-----------------|-----------');
for (const r of ratios) {
  const rs = evalRatio(r);
  const m = rs.reduce((s, x) => s + x.mrr, 0) / rs.length;
  const r1 = rs.filter((x) => x.rank === 1).length;
  const r5 = rs.filter((x) => x.rank <= 5).length;
  const r10 = rs.filter((x) => x.rank <= 10).length;
  let w = 0, l = 0, t = 0;
  for (let i = 0; i < rs.length; i++) {
    if (rs[i].mrr > base[i].mrr + 1e-9) w++;
    else if (rs[i].mrr < base[i].mrr - 1e-9) l++;
    else t++;
  }
  const p = r === 0.12 ? '-' : signTest(w, l).toFixed(3);
  console.log(String(r).padEnd(5) + ' | ' + (m * 100).toFixed(2).padStart(6)
    + ' ' + String(r1).padStart(3) + String(r5).padStart(4) + String(r10).padStart(5)
    + ' | ' + (w + '/' + l + '/' + t).padStart(15) + ' | ' + String(p).padStart(9));
}

/* 关键对照：完全不换位（纯相关性）在同一批题上的分数 */
console.log('');
const noSwap = [];
for (const x of final) {
  const p = lib.pool(x.sid, x.q);
  if (!p.items.length) { noSwap.push({ mrr: 0, rank: 999 }); continue; }
  const ord = lib.order(p.items, now, false, true, p.rankMode, {});
  const seqs = ord.map((a) => Number(a.x.r.seq));
  let best = -1;
  for (const g of x.gold) {
    const i = seqs.indexOf(Number(g));
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  noSwap.push({ mrr: best < 0 ? 0 : 1 / (best + 1), rank: best < 0 ? 999 : best + 1 });
}
const nm = noSwap.reduce((s, x) => s + x.mrr, 0) / noSwap.length;
let w = 0, l = 0;
for (let i = 0; i < noSwap.length; i++) {
  if (noSwap[i].mrr > base[i].mrr + 1e-9) w++;
  else if (noSwap[i].mrr < base[i].mrr - 1e-9) l++;
}
console.log('对照「纯相关性不换位」：MRR=' + (nm * 100).toFixed(2) + '%  R@1='
  + noSwap.filter((x) => x.rank === 1).length + '  R@5=' + noSwap.filter((x) => x.rank <= 5).length
  + '  vs 换位 胜/负 ' + w + '/' + l + '  p=' + signTest(w, l).toFixed(3));
