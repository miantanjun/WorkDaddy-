/* 诊断：配对负例（本会话没有答案）与正例在「覆盖率 / 命中词数 / bm25」上能不能分开？
 *
 * 目的：判断「拒答」是否可由**现有信号**判定，还是必须引入新信号。
 * 输出：正例（109，分命中/未命中）与配对负例（9）的四分位分布。
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

function qstats(c) {
  const r = S(c.sid, c.q, c.k);
  const hits = r.hits || [];
  if (!hits.length) return { via: r.via, n: 0, topScore: 0, maxCov: 0, hitWords: 0, words: 0 };
  // 复算覆盖率（与产品同口径）
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => {
    try { return db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=? AND instr(text,?)>0 AND COALESCE(pri,0)>=1').get(c.sid, p).c > 0; }
    catch (_) { return false; }
  });
  const top = hits[0];
  const covOf = (txt) => {
    if (!live.length) return 0;
    let got = 0;
    for (const p of live) if (String(txt).indexOf(p) >= 0) got++;
    return got / live.length;
  };
  return {
    via: r.via, n: hits.length,
    topScore: Number(top.score) || 0,
    maxCov: covOf(top.text || ''),
    avgCov: hits.reduce((s, h) => s + covOf(h.text || ''), 0) / hits.length,
    hitWords: Math.round(covOf(top.text || '') * live.length),
    words: live.length,
  };
}

function q(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return 'n/a';
  const at = (p) => a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))];
  return 'min=' + a[0].toFixed(3) + ' p25=' + at(0.25).toFixed(3)
    + ' p50=' + at(0.5).toFixed(3) + ' p75=' + at(0.75).toFixed(3)
    + ' max=' + a[a.length - 1].toFixed(3);
}

const rowsP = pos.map((c) => ({ c, s: qstats(c) }));
const rowsN = neg.map((c) => ({ c, s: qstats(c) }));

console.log('=== 配对负例（9 条，正确答案是「不返回任何东西」）===');
for (const x of rowsN) {
  const s = x.s;
  console.log('  ' + x.c.id.padEnd(5) + ' via=' + String(s.via).padEnd(8)
    + ' n=' + s.n + ' topScore=' + s.topScore.toFixed(2)
    + ' maxCov=' + s.maxCov.toFixed(2) + ' avgCov=' + (s.avgCov || 0).toFixed(2)
    + ' hitWords=' + s.hitWords + '/' + s.words);
}

const P = rowsP.map((x) => x.s);
const N = rowsN.map((x) => x.s);

console.log('\n=== 正例 vs 配对负例 分布 ===');
for (const key of ['maxCov', 'avgCov', 'topScore', 'hitWords']) {
  console.log('  ' + key.padEnd(9) + ' 正例  ' + q(P.map((s) => s[key])));
  console.log('  ' + ''.padEnd(9) + ' 负例  ' + q(N.map((s) => s[key])));
}

/* 单阈值扫描：用每个候选信号当「拒答线」，看 净收益 = 负例拦住 - 正例误伤 */
console.log('\n=== 单阈值扫描（拒答线以下返回空）===');
console.log('  信号      阈值     负例拦住    正例误伤    净     结束');
for (const key of ['maxCov', 'hitWords', 'topScore']) {
  const pv = P.map((s) => s[key]).filter((x) => Number.isFinite(x));
  const uni = [...new Set(pv.concat(N.map((s) => s[key])))].sort((a, b) => a - b);
  for (const t of uni) {
    if (key === 'topScore') continue;      // bm25 是负数、越小越相关，方向不同，单独处理
    const nk = N.filter((s) => s[key] < t).length;
    const pf = P.filter((s) => s[key] < t).length;
    if (nk === 0) continue;
    console.log('  ' + key.padEnd(9) + String(t).padStart(5) + '   '
      + (nk + '/9').padStart(6) + '     ' + (pf + '/' + P.length).padStart(8)
      + '   ' + String(nk - pf).padStart(4));
  }
}
