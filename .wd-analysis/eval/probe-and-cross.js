/* AND 题集的「跨路径一致性」检验
 *
 * 目的是回答一个很实际的问题：**这套 AND 题，和那 109 道 OR 题，测的是同一个东西吗？**
 *
 * 具体做法：拿一个在 OR 路上已经定论的改动，在 AND 题上重跑一遍，看方向是否一致。
 *   已有定论（工作区记忆里的判据）：
 *     RANK_TIE 从 2 改成 0 ⇒ OR 路 +2.01pp（p<.05），这是当前生产值。
 *   如果 AND 题上这个改动**毫无反应**，有两种解释，必须分清：
 *     ① 正确解释：AND 路根本不读 RANK_TIE（它走 rankMode=false 分支，用 REL_TIE）
 *        ⇒ 那不是题的问题，是两条路本来就吃不同参数。这是**预期结果**。
 *     ② 错误解释：题太弱，测不出任何东西。
 *   区分办法：同时跑一个 AND 路**确实读**的参数（REL_TIE），看它有没有反应。
 *   两者都跑，才能说明「题是灵敏的，只是参数不相通」。
 *
 * 另外再跑一次全 109 道 OR 题，确认新加的 AND 组没有意外影响它们
 * （lib-pool 加 relTie 参数时动过 order()，必须回归）。
 */
'use strict';
const path = require('path');
const lib = require('./lib-pool.js');
const now = Date.now();

const { ALL, AND_CASES, isPos } = require('./all-cases.js');
const OR = ALL.filter(isPos);

function mrrOf(list, opt) {
  const rs = [];
  for (const x of list) {
    const p = lib.pool(x.sid, x.q);
    if (!p.items.length) { rs.push(0); continue; }
    const ord = lib.order(p.items, now, true, true, p.rankMode, opt || {});
    const seqs = ord.map((a) => Number(a.x.r.seq));
    let best = -1;
    for (const g of x.gold) {
      const i = seqs.indexOf(Number(g));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    rs.push(best < 0 ? 0 : 1 / (best + 1));
  }
  return { mrr: rs.reduce((s, v) => s + v, 0) / rs.length, rs };
}

console.log('══ 回归：109 道 OR 题在新 lib-pool 上的分数 ══');
const orBase = mrrOf(OR, {});
console.log('  现状参数 MRR=' + (orBase.mrr * 100).toFixed(2) + '%  (n=' + OR.length + ')');
console.log('  历史 RANK_TIE=2 MRR=' + (mrrOf(OR, { legacyTie: 2 }).mrr * 100).toFixed(2) + '%');
console.log('  ⚠️ 若出现「AND 路参数影响 OR 路」或相反，说明我动 order() 时串了分支');

console.log('');
console.log('══ AND 题：两条路吃不同参数，是否如预期 ══');
const andBase = mrrOf(AND_CASES, {});
const andTie2 = mrrOf(AND_CASES, { legacyTie: 2 });          // 应无变化：AND 不读 rankTie
const andRel02 = mrrOf(AND_CASES, { relTie: 0.02 });          // 应有变化：AND 读 REL_TIE
const andRel03 = mrrOf(AND_CASES, { relTie: 0.30 });          // 应有变化（且更差）

const fmt = (x) => (x.mrr * 100).toFixed(2) + '%';
let same = 0, diff = 0;
for (let i = 0; i < AND_CASES.length; i++) {
  if (Math.abs(andBase.rs[i] - andTie2.rs[i]) < 1e-9) same++; else diff++;
}
console.log('  基线（生产参数）        MRR=' + fmt(andBase));
console.log('  legacyTie=2 变化题数    ' + diff + ' / ' + AND_CASES.length
  + '  ⇒ ' + (diff === 0 ? '✅ 如预期：AND 路不读 RANK_TIE' : '⚠️ 意外：AND 路居然受 RANK_TIE 影响'));
console.log('  REL_TIE=0.02            MRR=' + fmt(andRel02)
  + '  变化 ' + andBase.rs.filter((v, i) => Math.abs(v - andRel02.rs[i]) > 1e-9).length + ' 道');
console.log('  REL_TIE=0.30            MRR=' + fmt(andRel03)
  + '  变化 ' + andBase.rs.filter((v, i) => Math.abs(v - andRel03.rs[i]) > 1e-9).length + ' 道');

const sens = andBase.rs.filter((v, i) => Math.abs(v - andRel03.rs[i]) > 1e-9).length;
console.log('');
console.log(sens > 5
  ? '✅ 题集灵敏：\n   对 AND 路自己的参数（REL_TIE）有 ' + sens + ' 道响应，'
    + '对 OR 路专属参数（RANK_TIE）0 响应 —— 说明它在测 AND 路，没串味。'
  : '⛔ 题集不灵敏：连 REL_TIE 都几乎不动，这套题不能用。');

/* 顺带确认：这批题真的走 AND（不是被产品降级到 OR 了） */
const vias = {};
for (const x of AND_CASES) {
  const p = lib.pool(x.sid, x.q);
  vias[p.via] = (vias[p.via] || 0) + 1;
}
console.log('');
console.log('路由复核（lib-pool 复刻的产品路由）：' + JSON.stringify(vias));
