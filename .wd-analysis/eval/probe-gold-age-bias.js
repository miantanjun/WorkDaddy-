/* 「反用 rankKey 更好」是真信号，还是评测集偏倚？
 *
 * 反用 rankKey = 越旧越往前。它更好有两种可能：
 *   B1 真实信号：rankKey 的构造有错（比如把 importance/recency 权重搞反）
 *   B2 评测集偏倚：gold 系统性比池内其他候选更旧 ⇒ 「越旧越好」在这批题上必然占优，
 *      换到"问最新"的真实场景就完全相反
 *
 * 判别法：直接比较 **gold 的新鲜度 vs 同一候选池内其他候选的新鲜度**。
 *   · 若 gold 系统性更旧（差值明显为负）⇒ B2 成立，反用的优势不可采信
 *   · 若 gold 与池内平均相当 ⇒ B1 更可能
 *
 * 还要按类别切：temporal 类问「最新」的题，gold 应该比池内**更新**；
 *   若连这类题 gold 都更旧，说明评测集整体偏向"旧结论"。
 */
'use strict';
const M = require('./lib-pool.js');
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const recs = p.items.map((x) => M.recencyOf(x.r.ts, x.r.last_hit_ts, NOW));
  const poolAvg = recs.reduce((s, x) => s + x, 0) / recs.length;
  let gRec = null;
  for (const g of c.gold) {
    const it = p.items.find((x) => Number(x.r.seq) === Number(g));
    if (it) { gRec = M.recencyOf(it.r.ts, it.r.last_hit_ts, NOW); break; }
  }
  if (gRec === null) continue;
  rows.push({ id: c.id, cat: c.cat, ladder: c.ladder, q: c.q, gRec, poolAvg, diff: gRec - poolAvg, n: p.items.length });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

console.log('=== gold 新鲜度 vs 同池其他候选（n=' + rows.length + '）===');
console.log('  gold 平均 ' + mean(rows.map((r) => r.gRec)).toFixed(3)
  + ' · 池平均 ' + mean(rows.map((r) => r.poolAvg)).toFixed(3)
  + ' · 差值 ' + (mean(rows.map((r) => r.diff)) >= 0 ? '+' : '') + mean(rows.map((r) => r.diff)).toFixed(3));
const older = rows.filter((r) => r.diff < 0).length;
console.log('  gold 比池平均更旧的题: ' + older + '/' + rows.length + ' (' + (older / rows.length * 100).toFixed(0) + '%)');

console.log('\n按类别切：');
const cats = {};
for (const r of rows) { (cats[r.cat] = cats[r.cat] || []).push(r); }
for (const k of Object.keys(cats).sort()) {
  const s = cats[k];
  console.log('  ' + k.padEnd(10) + 'n=' + String(s.length).padStart(3)
    + '  gold ' + mean(s.map((r) => r.gRec)).toFixed(3)
    + ' vs 池 ' + mean(s.map((r) => r.poolAvg)).toFixed(3)
    + '  差值 ' + (mean(s.map((r) => r.diff)) >= 0 ? '+' : '') + mean(s.map((r) => r.diff)).toFixed(3)
    + '  更旧的占 ' + (s.filter((r) => r.diff < 0).length / s.length * 100).toFixed(0) + '%');
}

/* 关键：问「最新」的题，gold 应当比池内更新。若不是，偏倚实锤。 */
const latestQ = rows.filter((r) => /最新|现在|最近|后来|最终/.test(r.q));
if (latestQ.length) {
  console.log('\n「问最新」的题 n=' + latestQ.length + '：');
  console.log('  gold ' + mean(latestQ.map((r) => r.gRec)).toFixed(3)
    + ' vs 池 ' + mean(latestQ.map((r) => r.poolAvg)).toFixed(3)
    + '  差值 ' + (mean(latestQ.map((r) => r.diff)) >= 0 ? '+' : '') + mean(latestQ.map((r) => r.diff)).toFixed(3));
  console.log('  ⇒ 若差值 ≤ 0，说明连「问最新」的题 gold 都不比池内新 ⇒ 评测集系统性偏向旧内容。');
}

console.log('\n=== 结论 ===');
const d = mean(rows.map((r) => r.diff));
if (d < -0.05) {
  console.log('  ⚠️ gold 系统性更旧（差值 ' + d.toFixed(3) + '）⇒「反用 rankKey 更好」是**评测集偏倚**，不可采信。');
  console.log('     评测集的 gold 大多是「会话中较早的某条结论」，而真实使用中「刚说过的话」同样重要。');
} else {
  console.log('  ✅ gold 与池内平均相当，反用优势不是明显的年龄偏倚 ⇒ 值得进一步查 rankKey 构造。');
}
