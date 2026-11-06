/* 诊断二：bm25 topScore 能否分开「本会话没答案」？必须做留一交叉验证。
 *
 * 为什么要 LOO：配对负例只有 9 条。任何在 9 条上挑出来的阈值都是过拟合嫌疑。
 * 做法 = 用 8 条定阈值（最大化净收益），测第 9 条。9 折全跑一遍。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const pos = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const neg = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const S = ck._internal.search;
const db = ck._internal.open();

function stats(c) {
  const r = S(c.sid, c.q, c.k);
  const hits = r.hits || [];
  if (!hits.length) return { via: r.via, top: 0, n: 0, perWord: 0, words: 1 };
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => {
    try { return db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=? AND instr(text,?)>0 AND COALESCE(pri,0)>=1').get(c.sid, p).c > 0; }
    catch (_) { return false; }
  });
  const top = Number(hits[0].score) || 0;
  return { via: r.via, top, n: hits.length, perWord: top / Math.max(1, live.length), words: live.length };
}

const P = pos.map((c) => ({ c, s: stats(c) }));
const N = neg.map((c) => ({ c, s: stats(c) }));

console.log('=== 原始 topScore（bm25，越小越相关）===');
for (const x of N) console.log('  NEG ' + x.c.id.padEnd(5) + ' top=' + x.s.top.toFixed(2).padStart(8) + ' words=' + x.s.words);
console.log('  ---');
const Ps = P.map((x) => x.s.top).sort((a, b) => a - b);
const at = (a, p) => a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))];
console.log('  POS min=' + Ps[0].toFixed(1) + ' p10=' + at(Ps, 0.1).toFixed(1) + ' p25=' + at(Ps, 0.25).toFixed(1)
  + ' p50=' + at(Ps, 0.5).toFixed(1) + ' p75=' + at(Ps, 0.75).toFixed(1) + ' max=' + Ps[Ps.length - 1].toFixed(1));

/* 拒答条件：top > T（越接近 0 越不相关） */
function sweep(pv, nv, key) {
  const cands = [...new Set(nv.map((x) => x.s[key]).concat(pv.map((x) => x.s[key])))].sort((a, b) => a - b);
  let best = null;
  for (const T of cands) {
    const nk = nv.filter((x) => x.s[key] > T).length;
    const pf = pv.filter((x) => x.s[key] > T).length;
    const net = nk - pf;
    if (!best || net > best.net) best = { T, nk, pf, net };
  }
  return best;
}

console.log('\n=== 全量阈值扫描（拒答线以上返回空）===');
for (const key of ['top', 'perWord']) {
  const b = sweep(P, N, key);
  console.log('  ' + key.padEnd(8) + ' best T=' + b.T.toFixed(3) + '  拦 ' + b.nk + '/9  误伤 ' + b.pf + '/109  净 ' + b.net);
}

console.log('\n=== 留一交叉验证（8 条定阈值 → 测第 9 条）===');
for (const key of ['top', 'perWord']) {
  let hitNeg = 0, hitPos = 0;
  const detail = [];
  for (let i = 0; i < N.length; i++) {
    const trainN = N.filter((_, j) => j !== i);
    const b = sweep(P, trainN, key);
    const caught = N[i].s[key] > b.T;
    if (caught) hitNeg++;
    detail.push('    ' + N[i].c.id.padEnd(5) + ' T=' + b.T.toFixed(2).padStart(7) + ' top=' + N[i].s[key].toFixed(2).padStart(8) + (caught ? ' 拦住' : ' 漏'));
  }
  /* 正例误伤也用 LOO 阈值逐折估，这里取各折误伤率的均值 */
  let sumPF = 0;
  for (let i = 0; i < N.length; i++) {
    const trainN = N.filter((_, j) => j !== i);
    const b = sweep(P, trainN, key);
    sumPF += P.filter((x) => x.s[key] > b.T).length;
  }
  console.log('  ' + key.padEnd(8) + ' LOO 拦住 ' + hitNeg + '/9 · 平均误伤 ' + (sumPF / N.length).toFixed(1) + '/109');
  detail.forEach((d) => console.log(d));
}

console.log('\n=== 上限判断：任何单词法阈值最多能拦几条负例而不误伤正例 ===');
for (const key of ['top', 'perWord']) {
  const posMax = Math.max(...P.map((x) => x.s[key]));
  const caughtNoHarm = N.filter((x) => x.s[key] > posMax).length;
  console.log('  ' + key.padEnd(8) + ' 正例最差值=' + posMax.toFixed(2) + ' ⇒ 零误伤仍可拦 ' + caughtNoHarm + '/9');
}
