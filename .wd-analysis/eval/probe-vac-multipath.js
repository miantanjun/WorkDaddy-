/* 诊断七：多路一致性 —— fact 层 / ent 层是否也说「没有」？
 *
 * 原理：seg 路（bm25 词面）必然给东西，这是设计使然（OR 兜底）。
 *       但 fact 层是 LLM 抽取的结论句、ent 层是实体索引，它们**不做宽松兜底**。
 *       若 seg 有命中而 fact+ent 双双为空，说明「语义层面没有结论」。
 *
 * 这是 ENT-MISS / ID-MISS 的自然推广，不是新指标 —— 而且有原理：
 *       三套独立的检索机制同时失败的先验概率远低于单一机制失败。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const NEG = ALL.filter((c) => c.cat === 'negative');

function feat(c) {
  const seg = ck._internal.search(c.sid, c.q, c.k);
  let fact = { items: [], exactItems: [] };
  try { fact = ck._internal.searchFacts(c.sid, c.q, Math.min(6, c.k), {}) || fact; } catch (_) {}
  return {
    via: seg.via,
    segN: (seg.hits || []).length,
    factN: (fact.items || []).length,
    entN: (fact.exactItems || []).length,
    /* 一致性判据：三路都没有实质内容 */
    allEmpty: !(seg.hits || []).length && !(fact.items || []).length && !(fact.exactItems || []).length,
    /* 弱一致性：事实层与实体层都空（seg 必然给东西，不算票） */
    factEntEmpty: !(fact.items || []).length && !(fact.exactItems || []).length,
  };
}

const pP = P.map((c) => ({ c, s: feat(c) }));
const pPN = PN.map((c) => ({ c, s: feat(c) }));
const pNEG = NEG.map((c) => ({ c, s: feat(c) }));

const rate = (arr, k) => {
  const v = arr.filter((x) => x.s[k]);
  return v.length + '/' + arr.length + ' (' + (100 * v.length / arr.length).toFixed(0) + '%)';
};

console.log('=== 三路返回量中位数 ===');
const med = (arr, k) => {
  const a = arr.map((x) => x.s[k]).sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
console.log('  组           seg    fact   ent');
for (const [name, arr] of [['正例', pP], ['配对负例', pPN], ['纯负例', pNEG]]) {
  console.log('  ' + name.padEnd(11) + String(med(arr, 'segN')).padStart(4)
    + String(med(arr, 'factN')).padStart(7) + String(med(arr, 'entN')).padStart(6));
}

console.log('\n=== 判据「fact+ent 都空」 ===');
console.log('  正例       ' + rate(pP, 'factEntEmpty'));
console.log('  配对负例   ' + rate(pPN, 'factEntEmpty'));
console.log('  纯负例     ' + rate(pNEG, 'factEntEmpty'));

console.log('\n=== 判据「三路全空」 ===');
console.log('  正例       ' + rate(pP, 'allEmpty'));
console.log('  配对负例   ' + rate(pPN, 'allEmpty'));
console.log('  纯负例     ' + rate(pNEG, 'allEmpty'));

console.log('\n=== 逐条配对负例 ===');
for (const x of pPN) {
  console.log('  ' + x.c.id.padEnd(5) + ' seg=' + x.s.segN + ' fact=' + x.s.factN + ' ent=' + x.s.entN
    + (x.s.factEntEmpty ? '   ← fact+ent 都空' : ''));
}

/* 事实层覆盖了多少会话 —— 若大部分会话没建事实，这个判据不可用 */
console.log('\n=== 事实层覆盖率（判据是否可用的前提）===');
const db = ck._internal.open();
for (const sid of [...new Set(ALL.map((c) => c.sid))]) {
  let f = 0;
  try { f = db.prepare('SELECT COUNT(*) c FROM fact WHERE sid=?').get(sid).c; } catch (e) { f = -1; }
  let n = db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=?').get(sid).c;
  console.log('  ' + sid.slice(0, 8) + ' 事实=' + String(f).padStart(6) + ' 原文=' + String(n).padStart(6)
    + (f <= 0 ? '  ⚠️ 无事实 ⇒ 该会话此判据恒为「空」' : ''));
}
