/* rankKey 该不该改？—— 用「组件组合」直接扫，找出可用配置
 *
 * 已定位（tie=5 放大窗口）：
 *   ID  +1.72pp   ← 唯一真正有效的信号（文本含型号/编号/长数字）
 *   LEN +0.27pp   ← 弱正
 *   IMP +0.15pp   ← 中性偏正（但包含 ID 与 PRI 互相抵消）
 *   PRI -0.19pp   ← 负
 *   REC -1.03pp   ← 显著负
 *   K   -1.19pp   ← 现状，比随机还差
 *
 * 关键洞察：REC 与 PRI 都单独为负，而它们的组合正是现状。
 *   但「独立为负」不等于「组合里该删」—— 它们可能互相抑制（负负得正），
 *   也可能叠加成更差（-1.19 比两个单项都差，说明是叠加）。
 *
 * 本脚本扫 6 个候选配置，全部在 tie=2（产品现状窗口）下测，
 *   因为最终要改的是「组内排序键」，窗口不变。
 *   同时验证 tie=0（纯相关）作为天花板参照。
 */
'use strict';
const M = require('./lib-pool.js');
/* ⚠️ 每一项新鲜度/换位相关的测量都必须先复位 last_hit_ts，否则每跑一次结果都在漂 */
require('./eval-guard.js').guard();
const { ALL, FRESH } = require('./all-cases.js');
const NOW = Date.now();

const LEN_B = (s) => (s.length >= 40 && s.length <= 400 ? 0.10 : 0);
const HAS_ID = (s) => (/[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/.test(s) ? 0.20 : 0);
const PRI_B = (r) => (Number(r.pri) === 2 ? 0.40 : 0.20);
const DUP_B = (r) => { const d = Number(r.dup) || 1; return d > 1 ? Math.min(0.15, 0.05 * Math.log2(d + 1)) : 0; };

const KEYS = {
  'K      现状 rankKey（0.6rec+0.4imp）': (r) => M.rankKey(r, NOW),
  'ID    只用标识符': (r) => HAS_ID(String(r.text || '')),
  'ID+LEN 标识符+长度': (r) => HAS_ID(String(r.text || '')) + LEN_B(String(r.text || '')),
  'IMP    只用 importance（含ID/PRI/LEN）': (r) => Math.min(1, PRI_B(r) + HAS_ID(String(r.text || '')) + DUP_B(r) + LEN_B(String(r.text || ''))),
  'REC+ID 新鲜度+标识符': (r) => 0.5 * M.recencyOf(r.ts, r.last_hit_ts, NOW) + 0.5 * (HAS_ID(String(r.text || '')) / 0.20),
  'ID+PRI  标识符+优先（去掉长度）': (r) => HAS_ID(String(r.text || '')) + (Number(r.pri) === 2 ? 0.10 : 0),
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

function wilcoxon(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12);
  const n = nz.length;
  if (!n) return { n: 0, p: 1 };
  const s = nz.map((v) => ({ v, a: Math.abs(v) })).sort((x, y) => x.a - y.a);
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && Math.abs(s[j + 1].a - s[i].a) < 1e-12) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) s[k].r = r;
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (const x of s) { if (x.v > 0) Wp += x.r; else Wm += x.r; }
  const W = Math.min(Wp, Wm), mu = n * (n + 1) / 4, sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu + 0.5) / sd;
  const erf = (x) => {
    const sg = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return sg * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  return { n, z, p: Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))) };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

const cases = ALL.concat(FRESH).filter((c) => (c.gold || []).length);
const rows = [];
for (const c of cases) {
  const p = M.pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  const rec = { id: c.id };
  for (const [name, kf] of Object.entries(KEYS)) {
    for (const tie of [2, 5]) {
      /* ⚠️ 必须包一层取 .r —— orderWith 传进来的是 {r, rel, seq} 包装对象，
         直接喂 kf 会让它读到 undefined.xxx ⇒ 键值恒 0 ⇒ 完全不重排
         ⇒ 所有配置都退回纯相关（第一版就是这么测出「全部 41.03%」的假结果）。 */
      const arr = orderWith(p.items, tie, (x) => kf(x.r));
      let best = 0;
      for (const g of c.gold) {
        const i = arr.findIndex((a) => Number(a.r.seq) === Number(g));
        if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
      }
      rec[name + '|' + tie] = best ? 1 / best : 0;
    }
  }
  /* 天花板：纯相关 */
  const pure = p.items.slice().sort((a, b) => a.rel - b.rel);
  let best = 0;
  for (const g of c.gold) {
    const i = pure.findIndex((a) => Number(a.r.seq) === Number(g));
    if (i >= 0 && (!best || i + 1 < best)) best = i + 1;
  }
  rec.pure = best ? 1 / best : 0;
  rows.push(rec);
}

console.log('样本 ' + rows.length + ' 道正例\n');
console.log('天花板（tie=0 纯相关）: ' + (mean(rows.map((r) => r.pure)) * 100).toFixed(2) + '%\n');
console.log('配置                                 tie=2      tie=5');
const names = Object.keys(KEYS);
for (const nm of names) {
  console.log('  ' + nm.padEnd(34)
    + (mean(rows.map((r) => r[nm + '|2'])) * 100).toFixed(2) + '%     '
    + (mean(rows.map((r) => r[nm + '|5'])) * 100).toFixed(2) + '%');
}

console.log('\n=== 相对现状（K，tie=2）的显著性 ===');
const base = 'K      现状 rankKey（0.6rec+0.4imp）|2';
for (const nm of names) {
  const key = nm + '|2';
  if (key === base) continue;
  const d = rows.map((r) => r[key] - r[base]);
  const w = wilcoxon(d);
  const dd = mean(d) * 100;
  const up = d.filter((v) => v > 1e-9).length, dn = d.filter((v) => v < -1e-9).length;
  console.log('  ' + nm.padEnd(34) + 'Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + 'pp'
    + '  改善 ' + String(up).padStart(2) + '/恶化 ' + String(dn).padStart(2)
    + '  p=' + w.p.toFixed(4) + (w.p < 0.05 ? ' ✅' : w.p < 0.10 ? ' 🟡' : ' ⚪'));
}
const dPure = rows.map((r) => r.pure - r[base]);
const wPure = wilcoxon(dPure);
console.log('  ' + '【天花板】纯相关（关掉换位）'.padEnd(34) + 'Δ' + (mean(dPure) * 100 >= 0 ? '+' : '') + (mean(dPure) * 100).toFixed(2) + 'pp'
  + '  p=' + wPure.p.toFixed(4) + (wPure.p < 0.05 ? ' ✅' : ' ⚪'));
