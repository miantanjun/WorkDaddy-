/* 诊断六：用产品自己的 IDF 加权 cov（不是手工实词表）能否分开配对负例？
 *
 * 背景：源码 866-875 行已记载「IDF 加权覆盖率做阈值方向是反的」，但那是针对
 *       **纯负例**（整库无此话题，被 OR 捞到无关内容，cov 反而很高）。
 *       配对负例不同：话题在本会话是"半新"的 —— 有主题词、没有结论词。
 *       ⇒ 同一个信号，在两类负例上可能有完全不同的表现，必须分开量。
 *
 * 判据：三组对比
 *   ① 纯负例 8 条（cat==='negative'）
 *   ② 配对负例 9 条
 *   ③ 正例 109 条（分命中 / 未命中）
 * 信号：IDF 加权 cov（产品同口径 w）、未加权 cov、以及「高 IDF 词命中率」。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const db = ck._internal.open();

const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const NEG = ALL.filter((c) => c.cat === 'negative');

/* 产品同口径的 df / idf */
const total = (() => { try { return db.prepare('SELECT COUNT(*) c FROM seg').get().c; } catch (_) { return 1; } })();
const dfCache = new Map();
function dfOf(p) {
  if (dfCache.has(p)) return dfCache.get(p);
  let v = 0;
  try { v = db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(text,?)>0').get(p).c; } catch (_) {}
  dfCache.set(p, v);
  return v;
}
const idf = (df) => (df > 0 ? Math.log((total - df + 0.5) / (df + 0.5) + 1) : 0);

function feat(c) {
  const r = ck._internal.search(c.sid, c.q, c.k);
  const hits = r.hits || [];
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const live = parts.filter((p) => dfOf(p) > 0);
  const w = new Map(live.map((p) => [p, idf(dfOf(p))]));
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const txt = hits.length ? String(hits[0].text || '') : '';
  let got = 0;
  let realHit = 0, realAll = 0;
  for (const p of live) {
    const hit = txt.indexOf(p) >= 0;
    if (hit) got += w.get(p);
    /* 「有信息量」的定义：IDF 高于该查询词中位数（数据驱动，不用手工表） */
    if (w.get(p) >= 2.5) { realAll++; if (hit) realHit++; }
  }
  return {
    via: r.via, n: hits.length,
    covW: live.length ? got / wSum : 0,                 // 产品同口径 IDF 加权
    covU: live.length ? live.filter((p) => txt.indexOf(p) >= 0).length / live.length : 0,
    hiIdfRatio: realAll ? realHit / realAll : null,     // 高 IDF 词命中比例
    nHiIdf: realAll, nLive: live.length,
    top: hits.length ? Number(hits[0].score) || 0 : 0,
  };
}

const pP = P.map((c) => ({ c, s: feat(c) }));
const pPN = PN.map((c) => ({ c, s: feat(c) }));
const pNEG = NEG.map((c) => ({ c, s: feat(c) }));

function stat(arr) {
  const a = arr.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 'n/a';
  const at = (p) => a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))];
  return 'p10=' + at(0.1).toFixed(2) + ' p25=' + at(0.25).toFixed(2) + ' p50=' + at(0.5).toFixed(2)
    + ' p75=' + at(0.75).toFixed(2) + ' p90=' + at(0.9).toFixed(2);
}

console.log('=== covW（产品同口径 IDF 加权覆盖率）分布 ===');
console.log('  正例        ' + stat(pP.map((x) => x.s.covW)));
console.log('  配对负例    ' + stat(pPN.map((x) => x.s.covW)));
console.log('  纯负例      ' + stat(pNEG.map((x) => x.s.covW)));

console.log('\n=== covU（未加权）分布 ===');
console.log('  正例        ' + stat(pP.map((x) => x.s.covU)));
console.log('  配对负例    ' + stat(pPN.map((x) => x.s.covU)));
console.log('  纯负例      ' + stat(pNEG.map((x) => x.s.covU)));

console.log('\n=== hiIdfRatio（IDF>=2.5 的词里命中多少）分布 ===');
console.log('  正例        ' + stat(pP.map((x) => x.s.hiIdfRatio)));
console.log('  配对负例    ' + stat(pPN.map((x) => x.s.hiIdfRatio)));
console.log('  纯负例      ' + stat(pNEG.map((x) => x.s.hiIdfRatio)));

console.log('\n=== 逐条配对负例 ===');
for (const x of pPN) {
  console.log('  ' + x.c.id.padEnd(5) + ' covW=' + x.s.covW.toFixed(2) + ' covU=' + x.s.covU.toFixed(2)
    + ' hiIdf=' + (x.s.hiIdfRatio === null ? ' n/a' : x.s.hiIdfRatio.toFixed(2))
    + ' (' + (x.s.hiIdfRatio === null ? 0 : Math.round(x.s.hiIdfRatio * x.s.nHiIdf)) + '/' + x.s.nHiIdf + ' 个高IDF词)');
}

/* 零误伤上限：阈值取正例最小值 */
console.log('\n=== 零误伤上限（阈值 = 正例最小值，低于则拒答）===');
for (const k of ['covW', 'covU', 'hiIdfRatio']) {
  const pv = pP.map((x) => x.s[k]).filter((x) => x !== null);
  if (!pv.length) continue;
  const T = Math.min(...pv);
  const cPN = pPN.filter((x) => x.s[k] !== null && x.s[k] < T).length;
  const cNEG = pNEG.filter((x) => x.s[k] !== null && x.s[k] < T).length;
  console.log('  ' + k.padEnd(11) + ' T=' + T.toFixed(2)
    + ' ⇒ 拦配对负例 ' + cPN + '/9 · 拦纯负例 ' + cNEG + '/8 · 误伤 0/109');
}

/* 被正例最小值卡住的位置上，正例有多少条恰好等于最小值（说明"宽松度"） */
console.log('\n=== 若把阈值放到"只误伤 1 条"，能多拦多少 ===');
for (const k of ['covW', 'covU', 'hiIdfRatio']) {
  const pv = pP.map((x) => x.s[k]).filter((x) => x !== null).sort((a, b) => a - b);
  if (pv.length < 2) continue;
  const T = pv[1];  // 只误伤最小的 1 条正例
  const cPN = pPN.filter((x) => x.s[k] !== null && x.s[k] < T).length;
  const cNEG = pNEG.filter((x) => x.s[k] !== null && x.s[k] < T).length;
  console.log('  ' + k.padEnd(11) + ' T=' + T.toFixed(2)
    + ' ⇒ 拦配对负例 ' + cPN + '/9 · 拦纯负例 ' + cNEG + '/8 · 误伤 1/109');
}
