/* 追查「问最新反而变差」这个反直觉现象
 *
 * 观察：latest 组 8 题，纯相关 62.5% → 换位 50.0% → 修bug 25.0%。
 *   修 bug 后更差，这不合逻辑 —— 修 bug 是让第 2 名归到它「应该」在的组，
 *   按设计只会减少错位。除非：**问题出在「换位对最新行到底做了什么」**。
 *
 * 逐题打印：gold 的 rel 排位、recency、rankKey，以及三种排序后 gold 落在第几位。
 * 只有看到具体数字，才知道换位是在「帮最新的上前」还是「把最新的往后推」。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const { ALL } = require('./all-cases.js');

const RANK_TIE = 2, HALF = 30, REL_TIE = 0.12;
const ID_SHAPE = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/;
const recencyOf = (ts, lh, now) => {
  const ref = Math.max(Number(ts) || 0, Number(lh) || 0);
  if (!ref) return 0;
  return Math.pow(0.5, Math.max(0, (now - ref) / 86400000) / HALF);
};
const importanceOf = (r) => {
  let s = Number(r.pri) === 2 ? 0.40 : 0.20;
  if (ID_SHAPE.test(String(r.text || ''))) s += 0.20;
  const dup = Number(r.dup) || 1;
  if (dup > 1) s += Math.min(0.15, 0.05 * Math.log2(dup + 1));
  const L = String(r.text || '').length;
  if (L >= 40 && L <= 400) s += 0.10;
  return Math.min(1, s);
};
const rankKey = (r, now) => 0.6 * recencyOf(r.ts, r.last_hit_ts, now) + 0.4 * importanceOf(r);

function rerank(items, now, useSwap, fixGroup) {
  if (!items.length) return items;
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  if (!useSwap) {
    arr.sort((a, b) => a.x.rel - b.x.rel || (rankKey(b.x, now) - rankKey(a.x, now)) || a.i - b.i);
    return arr.map((a) => a.x);
  }
  const tie = RANK_TIE;
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  if (fixGroup) {
    let g = 1;
    let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
    for (let k = 1; k < arr.length; k++) {
      if (k >= 2 && arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
    if (trulyTied && arr.length > 1) arr[1].g = 0;
  } else {
    let g = 1;
    let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;
  }
  arr.sort((a, b) => a.g - b.g || (rankKey(b.x, now) - rankKey(a.x, now)) || a.i - b.i);
  return arr.map((a) => a.x);
}

const NOW = Date.now();
const latest = ALL.filter((c) => c.cat === 'temporal' && (c.gold || []).length);
/* 只挑题面里明确问「最新/现在/后来/变成」的 */
const isLatest = (c) => /最新|现在|后来|最终|变成|涨到|新增多少|是多少个/.test(c.q);
const group = latest.filter(isLatest);

console.log('latest 候选 ' + group.length + ' 条\n');
for (const c of group) {
  const r = ck._internal.search(c.sid, c.q, c.k);
  const hits = r.hits || [];
  if (!hits.length) { console.log(c.id + ' 无候选'); continue; }
  const a0 = rerank(hits, NOW, false, false).slice(0, c.k).map((h) => h.seq);
  const a1 = rerank(hits, NOW, true, false).slice(0, c.k).map((h) => h.seq);
  const a2 = rerank(hits, NOW, true, true).slice(0, c.k).map((h) => h.seq);
  const at = (arr) => { for (const g of c.gold) { const i = arr.indexOf(g); if (i >= 0) return i + 1; } return 0; };
  const rk = hits.map((h) => ({ seq: h.seq, rel: h.rel, rk: rankKey(h, NOW), rec: recencyOf(h.ts, h.last_hit_ts, NOW) }));
  const gInfo = c.gold.map((g) => {
    const f = rk.find((x) => x.seq === g);
    return g + (f ? '(rel=' + f.rel.toFixed(3) + ' rk=' + f.rk.toFixed(3) + ' rec=' + f.rec.toFixed(2) + ')' : '(不在池)');
  }).join(',');
  console.log(c.id + ' gold=' + gInfo);
  console.log('   池 ' + hits.length + ' 条 · 纯相关第 ' + at(a0) + ' 位 · 换位第 ' + at(a1) + ' 位 · 修bug第 ' + at(a2) + ' 位');
  const mx = rk.reduce((m, x) => Math.max(m, x.rk), 0);
  const top = rk.filter((x) => x.rk === mx).length;
  console.log('   池内 rankKey 最高 ' + mx.toFixed(3) + '（' + top + ' 条并列最高）· rel 最高 ' + Math.max.apply(null, rk.map((x) => x.rel)).toFixed(3));
}
