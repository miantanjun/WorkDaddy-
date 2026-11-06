/* 把 rankKey 拆成组件，找出到底是哪一项在压 gold
 *
 * rankKey = 0.6 × recency + 0.4 × importance
 *   importance = (pri==2 ? 0.40 : 0.20) + (文本含 ID ? 0.20) + dup 加分 + 长度 40~400 加分
 *
 * 已观测：rankKey 比随机键还差 1.19pp。这不可能是「三个组件都无信息」，
 *   更可能是**某一项系统性压住 gold**。评测集的 gold 绝大多数是
 *   「回合末 assistant 结论」(pri=1)，而池里大量是用户发言(pri=2) ——
 *   importance 天然把 pri=1 判低 ⇒ 换位一开就把 gold 往下压。
 *
 * 逐项对拍（窗口 tie=5 放大效应）：
 *   R   随机
 *   REC 只用 recency
 *   IMP 只用 importance
 *   ID  只用「含标识符」这一项
 *   LEN 只用长度项
 *   PRI 只用 pri 项
 *   K   完整 rankKey（现状）
 * 同时打印各组件在「gold vs 非 gold」上的均值差，直接看谁在压 gold。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const LEN_BONUS = (s) => (s.length >= 40 && s.length <= 400 ? 0.10 : 0);
const HAS_ID = (s) => (/[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/.test(s) ? 0.20 : 0);
const PRI_BONUS = (r) => (Number(r.pri) === 2 ? 0.40 : 0.20);
const DUP_BONUS = (r) => { const d = Number(r.dup) || 1; return d > 1 ? Math.min(0.15, 0.05 * Math.log2(d + 1)) : 0; };

const COMP = {
  R: null,
  REC: (r) => M.recencyOf(r.ts, r.last_hit_ts, NOW),
  IMP: (r) => Math.min(1, PRI_BONUS(r) + HAS_ID(String(r.text || '')) + DUP_BONUS(r) + LEN_BONUS(String(r.text || ''))),
  PRI: (r) => Number(r.pri) === 2 ? 1 : 0,
  ID: (r) => (HAS_ID(String(r.text || '')) ? 1 : 0),
  LEN: (r) => (LEN_BONUS(String(r.text || '')) ? 1 : 0),
  K: (r) => M.rankKey(r, NOW),
};

function orderWith(items, tie, keyFn) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  if (arr.length > 1) arr[1].g = g;
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
    arr[k].g = g;
  }
  arr.sort((a, b) => a.g - b.g || keyFn(b.x) - keyFn(a.x) || a.i - b.i);
  return arr.map((a) => a.x);
}

const rows = [];
const deltas = {};   /* 组件在 gold / 非 gold 上的均值 */
for (const k of Object.keys(COMP)) deltas[k] = { g: [], n: [] };

let seed = 20261105;
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const gset = new Set(c.gold.map(Number));
  /* 组件均值的 gold / 非 gold 对照 */
  for (const x of p.items) {
    const isG = gset.has(Number(x.r.seq));
    for (const [name, f] of Object.entries(COMP)) {
      if (!f) continue;
      const v = name === 'K' ? M.rankKey(x.r, NOW) : f(x.r);
      (isG ? deltas[name].g : deltas[name].n).push(v);
    }
  }
  const rnd = mulberry32(seed++);
  const rk = new Map(p.items.map((x) => [x, rnd()]));
  const rec = { id: c.id };
  for (const [name, f] of Object.entries(COMP)) {
    const kf = f ? ((x) => (name === 'K' ? M.rankKey(x.r, NOW) : f(x.r))) : ((x) => rk.get(x));
    const arr = orderWith(p.items, 5, kf);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    rec[name] = best ? 1 / best : 0;
  }
  rows.push(rec);
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
console.log('样本 ' + rows.length + ' 道正例 · 窗口 tie=5\n');
console.log('组件   MRR      vs 随机     gold均值  非gold均值   差值(gold-非gold)');
for (const name of Object.keys(COMP)) {
  const mr = mean(rows.map((r) => r[name]));
  const d = mean(rows.map((r) => r[name] - r.R)) * 100;
  const g = mean(deltas[name].g), n = mean(deltas[name].n);
  const dv = g - n;
  console.log('  ' + name.padEnd(5) + (mr * 100).toFixed(2) + '%   '
    + ((d >= 0 ? '+' : '') + d.toFixed(2) + 'pp').padStart(8) + '    '
    + g.toFixed(3).padStart(7) + '   ' + n.toFixed(3).padStart(8) + '   '
    + ((dv >= 0 ? '+' : '') + dv.toFixed(3)).padStart(8)
    + (dv < -0.03 ? '  ← 压 gold' : ''));
}
console.log('\n判读：差值明显为负的组件 = 它在系统性压低 gold 的排名。');
