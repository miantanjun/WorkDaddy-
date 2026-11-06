/* AND 题集的「敏感性检验」—— 这套题到底测不测得出排序改动？
 *
 * 这是定稿前必须先过的一关，理由：
 *   一个题集如果对被测变量**完全不敏感**，那它跑出来的分数无论多好看都是噪声。
 *   之前 109 道 OR 题能得出结论（RANK_TIE 0 vs 2 差 +2.01pp、p<.05），
 *   是因为验证过它对参数有反应。AND 题集同样必须先证明这一点。
 *
 * 用一个已知会改变排序的参数做探针：
 *   RANK_TIE  0（现状，只有原始分相等才算并列） vs 2（历史值，名次差≤2 就算并列）
 *   这两个值在 OR 路上已经证明效果不同，如果 AND 路上 MRR 一点不动，
 *   说明 AND 分支的并列判定根本不起作用（那本身也是一个重要发现）。
 *
 * 附加探针：REL_TIE 的取值（0.12 现状 vs 0.05 / 0.30）。
 *   注释里写着「分母取全池全距 ⇒ 漂移 0.14~0.71×」，AND 路 bm25 跨度天差地别，
 *   我怀疑这个相对阈值在 AND 路上更不稳定。这里能量出漂移幅度。
 *
 * ⚠️ 口径必须与产品一致：走 lib-pool.js（与 ck-memory.js 逐字同构），
 *    不用 ck._internal.search —— 后者不接受参数覆盖，测不了 A/B。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const lib = require('./lib-pool.js');

const final = require('./out/and-final.json');
const now = Date.now();

/* MRR：gold 的倒数名次（不在池里算 0） */
function evalOne(x, opt) {
  const p = lib.pool(x.sid, x.q);
  if (!p.items.length) return { mrr: 0, rank: 999, via: p.via };
  const ord = lib.order(p.items, now, true, true, p.rankMode, opt);
  const seqs = ord.map((a) => Number(a.x.r.seq));
  let best = -1;
  for (const g of x.gold) {
    const i = seqs.indexOf(Number(g));
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return {
    mrr: best < 0 ? 0 : 1 / (best + 1),
    rank: best < 0 ? 999 : best + 1,
    via: p.via,
    poolSize: p.items.length,
  };
}

/* lib.order 的 opt 只认 legacyTie；REL_TIE 是模块常量，要覆盖得改模块导出后的副本。
   这里直接做「最小侵入」：重算 tie 阈值不方便（在 order 内部），所以 REL_TIE 的
   敏感性改为间接量出「池内全距」分布 —— 反推阈值实际是多少分。 */

const variants = [
  { name: 'RANK_TIE=0（现状）', opt: { legacyTie: 0 } },
  { name: 'RANK_TIE=2（历史）', opt: { legacyTie: 2 } },
  { name: '纯相关性（不换位）', opt: { legacyTie: 0, noSwap: true } },
];

const rep = {};
for (const v of variants) {
  const rs = final.map((x) => evalOne(x, v.opt));
  const mrr = rs.reduce((s, r) => s + r.mrr, 0) / rs.length;
  const topk = (k) => rs.filter((r) => r.rank <= k).length;
  rep[v.name] = { mrr: +(mrr * 100).toFixed(2), r1: topk(1), r5: topk(5), r10: topk(10), rs };
  console.log(v.name.padEnd(22) + ' MRR=' + rep[v.name].mrr + '%  R@1=' + topk(1)
    + ' R@5=' + topk(5) + ' R@10=' + topk(10) + '  (n=' + rs.length + ')');
}

/* 逐题对比：现状 vs 历史，看有多少题名次真的变了 */
const a = rep['RANK_TIE=0（现状）'].rs;
const b = rep['RANK_TIE=2（历史）'].rs;
const c = rep['纯相关性（不换位）'].rs;
let changedTie = 0, changedSwap = 0;
const detail = [];
for (let i = 0; i < final.length; i++) {
  if (a[i].rank !== b[i].rank) changedTie++;
  if (a[i].rank !== c[i].rank) changedSwap++;
  if (a[i].rank !== b[i].rank || a[i].rank !== c[i].rank) {
    detail.push({ src: final[i].src, q: final[i].q, cur: a[i].rank, tie2: b[i].rank, noswap: c[i].rank });
  }
}
console.log('');
console.log('名次发生变化的题：RANK_TIE 切换影响 ' + changedTie + ' 道 · 换位开关影响 ' + changedSwap + ' 道');
console.log('');
console.log('变化明细（cur / tie2 / 纯相关）：');
for (const d of detail.slice(0, 30)) {
  console.log('  ' + d.src.padEnd(6) + ' ' + String(d.cur).padStart(4)
    + ' / ' + String(d.tie2).padStart(4) + ' / ' + String(d.noswap).padStart(4) + '   ' + d.q);
}

/* 池内全距（bm25 分差）—— 直接决定 REL_TIE 的绝对阈值 */
const spans = final.map((x) => {
  const p = lib.pool(x.sid, x.q);
  if (!p.items.length || p.rankMode) return null;
  const rels = p.items.map((i) => Number(i.rel) || 0);
  return Math.max(...rels) - Math.min(...rels);
}).filter((v) => v != null);
spans.sort((x, y) => x - y);
const qs = (p) => spans[Math.min(spans.length - 1, Math.floor(spans.length * p))];
console.log('');
console.log('AND 池 bm25 全距分布（n=' + spans.length + '）：p10=' + qs(0.1).toFixed(3)
  + ' p50=' + qs(0.5).toFixed(3) + ' p90=' + qs(0.9).toFixed(3) + ' max=' + spans[spans.length - 1].toFixed(3));
console.log('⇒ REL_TIE=0.12 对应的绝对阈值：' + [0.1, 0.5, 0.9]
  .map((p) => 'p' + (p * 100) + '=' + (qs(p) * 0.12).toFixed(4)).join(' / '));
