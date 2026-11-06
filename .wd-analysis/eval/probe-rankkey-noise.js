/* rankKey 到底是「无信息的噪声」还是「方向反了」？
 *
 * 已观测：tie 0→1→2→3→5 时 MRR 单调下降（41.03 → 40.06 → 39.62 → 39.37 → 38.58）。
 * 只要窗口开大就变差，且越大越差。两种解释：
 *   H1 无信息噪声：rankKey 与真实相关性无关 ⇒ 窗口越大 = 随机扰动越多 ⇒ 单调变差
 *   H2 方向反了：rankKey 偏爱的那类内容恰好是错的 ⇒ 同样单调变差，但可以「反过来用」救
 *
 * 判别实验（三条对照，窗口固定 tie=5 把效应放大）：
 *   R  随机 rankKey        —— H1 的基线：如果实测 ≈ R，就是纯噪声
 *   K  正用 rankKey（现状）
 *   -K 反用 rankKey        —— H2 的证据：如果 -K 明显好于 K，方向确实反
 *
 * 关键：随机基线必须用**同一批候选、同一个分组**，只替换排序键，
 *   否则测出的差异里混进了分组本身的效应。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const ck = M.ck;
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

/* 用确定性伪随机，保证可重复（不用 Math.random，否则每次跑结论都不同） */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* 复刻产品分组（tie 可调），但组内排序键可替换。
   ⚠️ 这不是「复刻产品逻辑」，只是把排序键抽出来做对照实验 ——
      分组部分已用 verify-swap-verdict 的自检锁死与产品一致。 */
function orderWith(items, tie, keyFn) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  const anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  if (arr.length > 1) arr[1].g = g;
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anchor > tie) { g += 1; }
    arr[k].g = g;
  }
  arr.sort((a, b) => a.g - b.g || keyFn(b.x) - keyFn(a.x) || a.i - b.i);
  return arr.map((a) => a.x);
}
/* 分组必须和产品一样按组起点更新 anchor，上面漏了 —— 补上 */
function orderWith2(items, tie, keyFn) {
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

const cases = ALL.concat(FRESH).filter((c) => (c.gold || []).length);
const TIE = 5;

const variants = {
  'R  随机键': null,
  'K  正用 rankKey（现状）': (x) => M.rankKey(x.r, NOW),
  '-K 反用 rankKey': (x) => -M.rankKey(x.r, NOW),
};
const rows = [];
let seed = 20261105;
for (const c of cases) {
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const rnd = mulberry32(seed++);
  const rndKey = new Map(p.items.map((x) => [x, rnd()]));
  const rec = { id: c.id };
  for (const [name, kf] of Object.entries(variants)) {
    const fn2 = kf || ((x) => rndKey.get(x));
    const arr = orderWith2(p.items, TIE, fn2);
    let best = 0;
    for (const g of c.gold) {
      const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
      if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
    }
    rec[name] = best ? 1 / best : 0;
  }
  rows.push(rec);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const names = Object.keys(variants);
console.log('样本 ' + rows.length + ' 道正例 · 窗口固定 tie=' + TIE + '（把效应放大）\n');
for (const n of names) console.log('  ' + n.padEnd(24) + (mean(rows.map((r) => r[n])) * 100).toFixed(2) + '%');

const dRK = rows.map((r) => r['-K 反用 rankKey'] - r['K  正用 rankKey（现状）']);
const dKR = rows.map((r) => r['K  正用 rankKey（现状）'] - r['R  随机键']);
console.log('\n反用 − 正用 = ' + (mean(dRK) * 100).toFixed(2) + 'pp');
console.log('正用 − 随机 = ' + (mean(dKR) * 100).toFixed(2) + 'pp');
console.log('\n判读：');
if (mean(dRK) > 0.02) {
  console.log('  ⇒ ✅ rankKey **方向相反**：反用明显更好，说明它偏爱的内容系统性地更不相关。');
} else if (Math.abs(mean(dKR)) < 0.005) {
  console.log('  ⇒ ⚠️ 正用 ≈ 随机 ⇒ rankKey 在该场景**没有信息量**，它的全部作用都是扰动。');
} else {
  console.log('  ⇒ 需进一步看：既不是纯噪声，也不是简单反向。');
}
