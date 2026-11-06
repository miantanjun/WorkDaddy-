/* 精确修法：把「真并列」的判据从「名次相等」改成「原始分数相等」
 *
 * ⚠️ 这是本轮最关键的发现，必须写清楚：
 *   名次制（OR 路径）下 rel = 名次 = 0,1,2,3…（整数，两两不等）
 *   ⇒ `arr[1].x.rel === arr[0].x.rel` **永远为 false**
 *   ⇒ 注释里承诺的「与第 1 名分数完全相同才算真并列，才允许换位」在 OR 路径上**从未生效**
 *   ⇒ 现在实际生效的是 tie=2 这个窗口：名次差 ≤2 就归一组，整段按 rankKey 重排
 *      —— 这不是「并列时换位」，这是「把相关性第 2~4 名的真实差距交给新鲜度覆盖」。
 *
 * 所以单测 15b-3「分数完全并列时新的排前面」能过，纯粹是因为 tie=2 把名次差 1
 * 也当成了并列，而不是真并列判据在工作。这个测试给了虚假的安全感。
 *
 * 精确修法 = 两件事一起做：
 *   ① tie = 0            —— 名次差不再构成「并列」，撤掉近似换位
 *   ② 真并列判据改用 score —— 让「分数完全相同」这个承诺真的生效
 *
 * 本探针验证：改完之后 MRR 是否等于纯相关（即换位不再扰动），
 *   同时「两条同文记忆」的场景是否仍然让新的排前面（保住产品意图）。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

/* 精确修法版分组：真并列看原始 score，不看名次 */
function orderPrecise(items, rankMode) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const scoreOf = (o) => (rankMode ? Number(o.x.r.score) : Number(o.x.rel));
  const trulyTied = arr.length > 1 && scoreOf(arr[1]) === scoreOf(arr[0]);
  arr[0].g = 0;
  if (arr.length > 1) arr[1].g = trulyTied ? 0 : 1;
  /* tie=0：只有 rel 完全相同（真并列）才会归到同组，而 sorting 已保证同分相邻 */
  let g = 1;
  for (let k = 2; k < arr.length; k++) {
    const sameAsPrev = rankMode
      ? Number(arr[k].x.r.score) === Number(arr[k - 1].x.r.score)
      : arr[k].x.rel === arr[k - 1].x.rel;
    if (!sameAsPrev) g += 1;
    arr[k].g = g;
  }
  arr.sort((a, b) => a.g - b.g || M.rankKey(b.x.r, NOW) - M.rankKey(a.x.r, NOW) || a.i - b.i);
  return arr.map((a) => a.x);
}

const rows = [];
let tied = 0;
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  if (p.rankMode) {
    /* 统计真实检索里有多少次存在「原始分数完全相同」的相邻候选 */
    const s = p.items.map((x) => Number(x.r.score)).sort((a, b) => b - a);
    let has = false;
    for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) { has = true; break; }
    if (has) tied++;
  }
  const best = (arr) => {
    let b = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!b || i + 1 < b)) b = i + 1;
    }
    return b ? 1 / b : 0;
  };
  rows.push({
    id: c.id,
    pure: best(p.items.slice().sort((a, b) => a.rel - b.rel)),
    cur: best(M.ck.rankRelevanceFirst(p.items, NOW, { rankMode: true, rankTie: M.RANK_TIE })),
    fix: best(orderPrecise(p.items, p.rankMode)),
  });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
console.log('样本 ' + rows.length + ' 题\n');
console.log('  纯相关（天花板）        ' + (mean(rows.map((r) => r.pure)) * 100).toFixed(2) + '%');
console.log('  现状 tie=2 + 名次判并列 ' + (mean(rows.map((r) => r.cur)) * 100).toFixed(2) + '%');
console.log('  精确修法 tie=0 + 分数判并列 ' + (mean(rows.map((r) => r.fix)) * 100).toFixed(2) + '%');

const dFix = rows.filter((r) => Math.abs(r.fix - r.pure) > 1e-9);
console.log('\n精确修法与纯相关落位不同的题: ' + dFix.length + '/' + rows.length);
if (dFix.length) dFix.slice(0, 8).forEach((r) => console.log('  ' + r.id + ' 纯相关 ' + (r.pure * 100).toFixed(1) + '% → 修后 ' + (r.fix * 100).toFixed(1) + '%'));
console.log('  ⇒ 若为 0，说明真并列在真实检索里一次都没触发，修法等价于「完全按相关性」，');
console.log('     而「分数相同时新的优先」这个承诺依然保留（只是它几乎用不上）。');

console.log('\n真实检索里存在「原始分数完全相同」相邻候选的次数: ' + tied + '/' + rows.length);
console.log('⇒ 这个数决定「真并列」这条保护到底有多重要。若接近 0，它就是纯理论条款。');
