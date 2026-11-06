/* 短查询（AND 路）配对题生成器 v2 —— 关键是**让候选池够大**
 *
 * v1 失败的原因很有价值，记在这里：
 *   我一开始从长查询里挑「最稀有的 bigram」当短查询，结果 AND 之后只剩 3~5 条，
 *   182/414 条连 3 条都不到。那种题根本测不了排序 —— 排序只在「多元素组」里生效。
 *   ★ 稀有的词区分子答案，但**不产生大候选池**；真实短查询恰恰相反：
 *     「插件卡顿」「反代积分」这类查询用的是**高频词**，AND 起来几十上百条，
 *     排序（并列判定、组内换位）才有发挥空间。
 *   ⇒ v2 改成：优先用 **df 最高**的 bigram 组合，池子目标 20~400 条。
 *
 * 硬条件不变：
 *   ① gold 沿用长查询的（不重新标注，保证唯一自变量是路由）；
 *   ② 每个 bigram df>0（否则产品自动降级 OR）；
 *   ③ 至少要有一个 bigram 出现在 gold 原文里（否则是「不可能题」而非排序题）。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({
  dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'),
  log: () => {},
});

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy', 'ck-memory', 'ck.db'));
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv USING fts5vocab('main','seg_fts','row')");
const dfOf = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
const df = (p) => { const r = dfOf.get(String(p).toLowerCase()); return r ? Number(r.cnt) : 0; };
const segText = db.prepare('SELECT text FROM seg WHERE sid=? AND seq=?');

const { ALL, FRESH, isPos } = require('./all-cases.js');

const out = [];
for (const c of ALL.concat(FRESH)) {
  if (!isPos(c)) continue;
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => df(p) > 0);
  if (live.length < 2) continue;

  let goldText = '';
  for (const g of c.gold) {
    const r = segText.get(c.sid, Number(g));
    if (r) goldText += ' ' + String(r.text || '');
  }
  if (!goldText) continue;
  const goldLower = goldText.toLowerCase();

  const inGold = live.filter((p) => goldLower.indexOf(p.toLowerCase()) >= 0);
  if (!inGold.length) continue;
  /* ★ 与 v1 相反：按 df **降序** —— 高频词才能撑起大候选池 */
  inGold.sort((a, b) => df(b) - df(a));

  /* 组合：2 个与 3 个，各取「最常用」与「常用+更常用混搭」 */
  const combos = [];
  for (const n of [2, 3]) {
    if (inGold.length < n) continue;
    combos.push(inGold.slice(0, n));                       // 最常用的 n 个
    if (inGold.length >= n + 1) combos.push(inGold.slice(1, n + 1));  // 错一位
  }

  for (const set of combos) {
    if (set.some((p) => df(p) === 0)) continue;
    const q = set.join(' ');
    const r = ck._internal.search(c.sid, q, c.k);
    if (r.via !== 'AND') continue;
    const got = (r.hits || []).length;
    out.push({
      src: c.id, cat: c.cat, sid: c.sid, k: c.k, gold: c.gold,
      q, bg: set.length, got,
      cand: Number(r.candidates || got),
      hit: (r.hits || []).some((h) => c.gold.indexOf(Number(h.seq)) >= 0),
    });
  }
}

/* ⚠️ 关键修正：池子规模看 `candidates`（= rows.length），不是 `hits.length`。
 *   hits 只有 limit 条（评测里 k=5），第一版拿 hits 当池子 ⇒ 全部落在 3~5 条、
 *   被"可用"判据全灭。这正是上一个阶段的同一个陷阱：「hits ≠ 候选池」。 */
const usable = out.filter((x) => x.cand >= 20 && x.cand <= 3000);
console.log('走 AND 的候选 ' + out.length + ' 条');
console.log('池子 >=20 条的 ' + usable.length + ' 条：HIT '
  + usable.filter((x) => x.hit).length + ' / miss ' + usable.filter((x) => !x.hit).length);

/* 按源题去重：每道源题只留「池子最大」的一条，避免同一 gold 反复计分 */
const best = new Map();
for (const x of usable) {
  const k = x.src;
  const prev = best.get(k);
  if (!prev || x.cand > prev.cand) best.set(k, x);
}
const picked = [...best.values()].sort((a, b) => a.src.localeCompare(b.src));
console.log('');
console.log('按源题去重后 ' + picked.length + ' 道（每 gold 一题）');
console.log('  HIT ' + picked.filter((x) => x.hit).length
  + ' / miss ' + picked.filter((x) => !x.hit).length);
const gs = picked.map((x) => x.cand).sort((a, b) => a - b);
const q = (p) => gs[Math.min(gs.length - 1, Math.floor(gs.length * p))];
console.log('  池子规模 p10=' + q(0.1) + ' p50=' + q(0.5) + ' p90=' + q(0.9) + ' max=' + gs[gs.length - 1]);
console.log('');
for (const x of picked.slice(0, 40)) {
  console.log('  ' + x.src.padEnd(6) + x.bg + 'bg cand=' + String(x.cand).padStart(5)
    + ' ' + (x.hit ? 'HIT ' : 'miss') + ' ' + x.q);
}
require('fs').writeFileSync(path.join(__dirname, 'out', 'and-cand2.json'),
  JSON.stringify(picked, null, 1));
console.log('\n已写入 out/and-cand2.json');
