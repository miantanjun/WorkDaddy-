/* 第四批（新鲜度梯度）自检
 *
 * 除了通用的「gold 可见性」，这批还要额外验两件前三批不需要的事：
 *   ① **新鲜度梯度是否真的分化** —— latest 组 gold 的 recency 必须显著高于 earliest 组，
 *      否则这批题就退化成前三批那样（都一样新鲜），白造。
 *   ② **题面不能泄露答案** —— 「问最早」的题面里若直接出现 41 / 2885，那就是把答案抄进题面。
 */
'use strict';
const M = require('./lib-pool.js');
const db = M.db;
const { FRESH, LATEST, EARLIEST, MID, FRESH_NEG } = require('./cases-fresh.js');
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

let bad = 0;
const recsBy = {};
for (const c of FRESH) {
  const probs = [];
  for (const s of (c.gold || [])) {
    const r = db.prepare(
      'SELECT seq, kind, COALESCE(pri,0) pri, COALESCE(noise,0) noise, text, ts FROM seg WHERE sid=? AND seq=?'
    ).get(c.sid, s);
    if (!r) { probs.push('seq ' + s + ' 不存在'); continue; }
    if (r.pri < 1) probs.push('seq ' + s + ' pri=' + r.pri + ' ⇒ 默认检索看不到');
    if (r.noise) probs.push('seq ' + s + ' noise=1');
    if (r.kind !== 'user' && r.kind !== 'assistant') probs.push('seq ' + s + ' kind=' + r.kind);
    /* 题面泄露检查：答案里的关键数字不能原样出现在问题里 */
    const t = one(r.text);
    const nums = (t.match(/\d{2,5}/g) || []).slice(0, 6);
    for (const n of nums) {
      if (n.length >= 3 && c.q.indexOf(n) >= 0) probs.push('题面含答案数字 ' + n);
    }
    recsBy[c.id] = M.recencyOf(r.ts, r.last_hit_ts, Date.now());
  }
  if (probs.length) { bad++; console.log('❌ ' + c.id + ' ' + probs.join(' | ')); }
  else {
    const rc = recsBy[c.id];
    console.log('✅ ' + c.id + ' [' + (c.ladder || 'neg') + '] gold=' + JSON.stringify(c.gold)
      + (rc !== undefined ? '  recency=' + rc.toFixed(3) : ''));
  }
}
console.log('\n合计 ' + FRESH.length + ' 条 · 有问题 ' + bad + ' 条');

const avg = (ids) => {
  const v = ids.map((i) => recsBy[i]).filter((x) => x !== undefined);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
const hl = avg(LATEST.map((c) => c.id));
const he = avg(EARLIEST.map((c) => c.id));
const hm = avg(MID.map((c) => c.id));
console.log('\n=== 新鲜度梯度自检（这批题的核心） ===');
console.log('  latest   组 gold 平均 recency = ' + hl.toFixed(3));
console.log('  mid      组 gold 平均 recency = ' + hm.toFixed(3));
console.log('  earliest 组 gold 平均 recency = ' + he.toFixed(3));
console.log('  latest - earliest = +' + (hl - he).toFixed(3));
if (!(hl > he + 0.15)) {
  console.log('  ❌ 梯度不够大（差值应 > 0.15），这批题无法区分「换位是否按新鲜度做事」');
  bad++;
} else {
  console.log('  ✅ 梯度成立：latest 明显比 earliest 新鲜，能作为因果实验');
}
console.log('\n最终: ' + (bad ? '有 ' + bad + ' 个问题' : '全部通过'));
process.exit(bad ? 1 : 0);
