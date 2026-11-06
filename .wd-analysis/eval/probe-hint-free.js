/* 诊断十六：提示信号能不能做到**零额外成本**？
 *
 * 前一步的复合规则里发现：真正起作用的是 hereN（本会话命中条数），margin 几乎没贡献
 * （Δ 取 0/2/4 结果完全相同）。而 hereN 是 search() 本来就返回的东西 ⇒ 零成本。
 *
 * 本脚本只测 hereN 单独作为信号的表现，并检验：
 *   ① 在 9 条配对负例 / 109 正例 / 8 条纯负例上的分离度
 *   ② 阈值扫描 + LOO
 *   ③ 与"库外话题"两道现有拦截器的关系（会不会重复/冲突）
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const NEG = ALL.filter((c) => c.cat === 'negative');

/* hereN = 本会话 search 的 candidates（不改任何参数，就用产品默认的 lim=8） */
function hereN(c, lim) {
  const r = ck._internal.search(c.sid, c.q, lim || 8);
  return { n: (r.hits || []).length, cand: r.candidates || 0, via: r.via };
}

console.log('=== ① hereN（本会话命中条数）分布 ===');
const group = (name, list) => {
  const a = list.map((c) => hereN(c).n);
  const q = (p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  console.log('  ' + name.padEnd(12) + 'n=' + String(a.length).padStart(3)
    + '  min=' + String(Math.min(...a)).padStart(2)
    + ' p10=' + String(q(0.1)).padStart(2) + ' p25=' + String(q(0.25)).padStart(2)
    + ' p50=' + String(q(0.5)).padStart(2) + ' p75=' + String(q(0.75)).padStart(2)
    + ' max=' + String(Math.max(...a)).padStart(2));
  return a;
};
const aPN = group('配对负例', PN);
const aP = group('正例', P);
const aNEG = group('纯负例', NEG);

console.log('\n  hereN 直方图：');
const hist = (a) => {
  const h = {};
  for (const x of a) h[x] = (h[x] || 0) + 1;
  return Object.keys(h).sort((x, y) => x - y).map((k) => k + '→' + h[k]).join(' ');
};
console.log('    配对负例: ' + hist(aPN));
console.log('    正例    : ' + hist(aP));
console.log('    纯负例  : ' + hist(aNEG));

console.log('\n=== ② 阈值扫描：hereN ≤ N 即提示"可能在别的会话" ===');
console.log('  N   配对负例(应提示)  正例误提示  纯负例  ');
for (const N of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  const tp = aPN.filter((x) => x <= N).length;
  const fp = aP.filter((x) => x <= N).length;
  const fpn = aNEG.filter((x) => x <= N).length;
  console.log('  ' + String(N).padStart(2) + String(tp + '/9').padStart(15)
    + String(fp + '/109').padStart(11) + String(fpn + '/8').padStart(9)
    + (fp === 0 ? '  ← 零误伤' : ''));
}

console.log('\n=== ③ 加上 via 通道（OR/AND/LIKE）能否再分一层 ===');
const cross = {};
for (const c of PN) { const r = hereN(c); const k = r.via + '|n' + r.n; cross[k] = (cross[k] || 0) + 1; }
console.log('  配对负例的 (via, n) 组合：' + Object.keys(cross).map((k) => k + '=' + cross[k]).join(' '));
const crossP = {};
for (const c of P) { const r = hereN(c); const k = r.via + '|n' + r.n; crossP[k] = (crossP[k] || 0) + 1; }
console.log('  正例的 (via, n) 组合（前 12）：' + Object.keys(crossP).sort((a, b) => crossP[b] - crossP[a]).slice(0, 12).map((k) => k + '=' + crossP[k]).join(' '));

console.log('\n=== ④ LOO（只用一个整数阈值 N，参数空间极小 ⇒ 过拟合风险低）===');
let loo = 0;
for (let i = 0; i < aPN.length; i++) {
  const trainP = aPN.filter((_, j) => j !== i);
  let bestN = null, bestTP = -1;
  for (const N of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    if (aP.filter((x) => x <= N).length > 0) continue;
    const tp = trainP.filter((x) => x <= N).length;
    if (tp > bestTP) { bestTP = tp; bestN = N; }
  }
  const hit = bestN !== null && aPN[i] <= bestN ? 1 : 0;
  loo += hit;
  console.log('  留出 ' + PN[i].id.padEnd(5) + ' 选N=' + String(bestN).padStart(2)
    + ' 训练TP=' + bestTP + ' ⇒ ' + (hit ? '命中 ✅' : '漏 ❌') + ' (n=' + aPN[i] + ')');
}
console.log('  LOO 命中 ' + loo + '/9');

console.log('\n=== ⑤ 成本核算：这条信号要不要额外 SQL ===');
const t0 = Date.now();
for (let i = 0; i < 20; i++) ck._internal.search(P[0].sid, P[0].q, 8);
console.log('  单次 search(lim=8) 平均 ' + ((Date.now() - t0) / 20).toFixed(1) + 'ms');
console.log('  hereN 直接取 hits.length ⇒ 0 额外 SQL，0 额外耗时');
