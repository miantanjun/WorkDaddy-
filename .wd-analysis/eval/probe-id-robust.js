/* ID 信号是真的，还是我的评测集偏 numeric 造成的假象？
 *
 * 为什么必须查：
 *   126 题里 numeric 类占 31 条，它们的 gold 天然带数字/型号。
 *   「含标识符优先」在这种题上必然占优 —— 这可能是**题目构造**的 artifact，
 *   而不是「有具体事实的记忆更值得优先」这个通用规律。
 *
 * 三条判据（缺一不可）：
 *   ① 按类别拆：ID 的收益必须在 **non-numeric** 类别上同样成立
 *   ② 换成「对齐」而非「有无」：真正该做的是「查询含型号 X ⇒ 记忆也含 X 才优先」，
 *      而不是「记忆里有任何数字就优先」。后者会偏爱日志/工具输出（全是数字）。
 *   ③ 与随机键对照：ID 必须显著优于随机，才算有信息
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

const HAS_ID = (s) => /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/.test(s);
/* 标识符提取：型号 / 编号 / 长数字。用于「查询与记忆共享标识符」的对齐判定 */
const IDS_OF = (s) => {
  const out = new Set();
  const re = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/g;
  let m;
  const t = String(s || '');
  re.lastIndex = 0;
  while ((m = re.exec(t))) out.add(m[0].toLowerCase());
  return out;
};

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
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
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

const rows = [];
let seed = 20261105;
for (const c of ALL.concat(FRESH)) {
  if (!(c.gold || []).length) continue;
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const qIds = IDS_OF(c.q);       // 查询里出现的标识符
  const rnd = mulberry32(seed++);
  const rk = new Map(p.items.map((x) => [x, rnd()]));
  const rec = { id: c.id, cat: c.cat, qHasId: qIds.size > 0, qIds: [...qIds], pool: p.items.length };
  for (const tie of [2]) {
    rec.K = orderWith(p.items, tie, (x) => M.rankKey(x.r, NOW));
    rec.R = orderWith(p.items, tie, (x) => rk.get(x));
    rec.ID = orderWith(p.items, tie, (x) => (HAS_ID(String(x.r.text || '')) ? 1 : 0));
    /* 对齐：记忆里的标识符与查询共享几个 */
    rec.ALIGN = orderWith(p.items, tie, (x) => {
      const ids = IDS_OF(x.r.text);
      let hit = 0;
      for (const q of qIds) if (ids.has(q)) hit++;
      return hit;
    });
  }
  const best = (arr) => {
    let b = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!b || i + 1 < b)) b = i + 1;
    }
    return b ? 1 / b : 0;
  };
  for (const k of ['K', 'R', 'ID', 'ALIGN']) rec[k] = best(rec[k]);
  rows.push(rec);
}

const variants = [['K', '现状 rankKey'], ['R', '随机键'], ['ID', '含标识符优先'], ['ALIGN', '标识符对齐（查询与记忆共享）']];
console.log('=== 全部 ' + rows.length + ' 题（tie=2）===');
for (const [k, nm] of variants) console.log('  ' + nm.padEnd(24) + (mean(rows.map((r) => r[k])) * 100).toFixed(2) + '%');

console.log('\n=== 判据①：按类别拆（ID 必须在 non-numeric 上也成立）===');
const cats = {};
for (const r of rows) (cats[r.cat] = cats[r.cat] || []).push(r);
console.log('  类别        n    现状     含ID优先   对齐     随机');
for (const k of Object.keys(cats).sort()) {
  const s = cats[k];
  console.log('  ' + k.padEnd(10) + String(s.length).padStart(3) + '   '
    + (mean(s.map((r) => r.K)) * 100).toFixed(2).padStart(6) + '%  '
    + (mean(s.map((r) => r.ID)) * 100).toFixed(2).padStart(7) + '%  '
    + (mean(s.map((r) => r.ALIGN)) * 100).toFixed(2).padStart(6) + '%  '
    + (mean(s.map((r) => r.R)) * 100).toFixed(2).padStart(6) + '%');
}
const nonNum = rows.filter((r) => r.cat !== 'numeric');
console.log('\n  non-numeric 子集 n=' + nonNum.length);
console.log('    现状 ' + (mean(nonNum.map((r) => r.K)) * 100).toFixed(2) + '%'
  + ' · 含ID优先 ' + (mean(nonNum.map((r) => r.ID)) * 100).toFixed(2) + '%'
  + ' · 对齐 ' + (mean(nonNum.map((r) => r.ALIGN)) * 100).toFixed(2) + '%'
  + ' · 随机 ' + (mean(nonNum.map((r) => r.R)) * 100).toFixed(2) + '%');
const numOnly = rows.filter((r) => r.cat === 'numeric');
console.log('  numeric 子集 n=' + numOnly.length);
console.log('    现状 ' + (mean(numOnly.map((r) => r.K)) * 100).toFixed(2) + '%'
  + ' · 含ID优先 ' + (mean(numOnly.map((r) => r.ID)) * 100).toFixed(2) + '%'
  + ' · 对齐 ' + (mean(numOnly.map((r) => r.ALIGN)) * 100).toFixed(2) + '%'
  + ' · 随机 ' + (mean(numOnly.map((r) => r.R)) * 100).toFixed(2) + '%');

console.log('\n=== 判据②：查询里带标识符的题才有「对齐」可言 ===');
const withQ = rows.filter((r) => r.qHasId), noQ = rows.filter((r) => !r.qHasId);
console.log('  查询含标识符 n=' + withQ.length
  + '  对齐 ' + (mean(withQ.map((r) => r.ALIGN)) * 100).toFixed(2) + '%'
  + ' / 含ID优先 ' + (mean(withQ.map((r) => r.ID)) * 100).toFixed(2) + '%');
console.log('  查询不含标识符 n=' + noQ.length
  + '  对齐 ' + (mean(noQ.map((r) => r.ALIGN)) * 100).toFixed(2) + '%'
  + ' / 含ID优先 ' + (mean(noQ.map((r) => r.ID)) * 100).toFixed(2) + '%');
console.log('  ⇒ 若「查询不含标识符」时对齐法失效（键全 0），说明它只能覆盖一部分查询，不是通用解。');
