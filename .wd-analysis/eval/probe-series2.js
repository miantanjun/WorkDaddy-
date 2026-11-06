/* 抽「回归套件 / 断言」这条序列 —— 造新鲜度梯度题的原料
 *
 * 为什么这条序列能用：同一指标被反复记录，值随时间单调增长（42 → 88 套件）。
 *   于是可以造**成对题**：
 *     问「现在/最新」⇒ gold = 最新那一行（换位机制应当帮忙）
 *     问「最早/一开始」⇒ gold = 最早那一行（换位机制应当帮倒忙）
 *   这一对题把「新鲜度信号有没有用」变成一个可观测的因果实验，
 *   而不是像之前的题那样 gold 全都一样新鲜、测不出差异。
 */
'use strict';
const M = require('./lib-pool.js');
const db = M.db;
const sid = '8f92c3fc-ff73-4db1-b104-eb060127daaf';
const rows = db.prepare(`SELECT seq, ts, kind, text FROM seg
  WHERE sid=? AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant') ORDER BY ts`).all(sid);
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

/* 只认「N 套件 / M 断言」这种成对出现、语义唯一的形式。
 * ⚠️ 不要放宽成「任意两个数字」—— 会把「改了 3 个文件、+58 −12 行」也吃进来。 */
const RE = /(\d{2,3})\s*(?:个)?套件\s*[\/·、]?\s*(\d{3,5})\s*(?:项)?\s*断言/;
const out = [];
for (const r of rows) {
  const t = one(r.text);
  const m = RE.exec(t);
  if (!m) continue;
  out.push({ seq: r.seq, ts: r.ts, kind: r.kind, suites: +m[1], asserts: +m[2], txt: t.slice(0, 90) });
}
console.log('命中 ' + out.length + ' 行');
let prev = -1;
for (const o of out) {
  const d = ((Date.now() - o.ts) / 86400000).toFixed(1);
  const flag = o.suites >= prev ? '' : '  ← 回落';
  if (o.suites !== prev) {                      /* 只打值变化的那几行，去重 */
    console.log('#' + String(o.seq).padStart(6) + ' ' + d.padStart(5) + '天前  '
      + String(o.suites).padStart(2) + ' 套件 / ' + String(o.asserts).padStart(4) + ' 断言' + flag);
  }
  prev = o.suites;
}
const vals = out.map((o) => o.suites);
console.log('\n单调性: ' + (vals.every((v, i) => i === 0 || v >= vals[i - 1]) ? '严格单调不减 ✅' : '有回落'));
console.log('范围: ' + Math.min(...vals) + ' → ' + Math.max(...vals) + ' 套件');
const first = out[0], last = out[out.length - 1];
console.log('最早: #' + first.seq + ' (' + first.suites + '/' + first.asserts + ')');
console.log('最新: #' + last.seq + ' (' + last.suites + '/' + last.asserts + ')');
