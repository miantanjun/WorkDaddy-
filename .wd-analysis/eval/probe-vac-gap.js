/* 诊断三：配对负例是不是「半新话题」？—— 查询词在【本会话】与【整库】的覆盖差。
 *
 * 原理：正例的问题，其概念词必然在本会话出现过（否则答案无从谈起）。
 *       配对负例是「同主题跨会话」⇒ 主题词有、具体词没有。
 * 两个候选信号：
 *   sessionRatio = 本会话出现的查询词 / 全部查询词
 *   dbRatio      = 整库出现的查询词 / 全部查询词
 *   gap          = dbRatio - sessionRatio   （词在别处有、这里没有）
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
const db = ck._internal.open();

const stSes = db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=? AND instr(text,?)>0 AND COALESCE(pri,0)>=1');
const stAll = db.prepare('SELECT COUNT(*) c FROM seg WHERE instr(text,?)>0');

function feat(c) {
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const r = ck._internal.search(c.sid, c.q, c.k);
  const hits = r.hits || [];
  let inSes = 0, inDb = 0;
  for (const p of parts) {
    let a = 0, b = 0;
    try { a = stSes.get(c.sid, p).c; } catch (_) {}
    try { b = stAll.get(p).c; } catch (_) {}
    if (a > 0) inSes++;
    if (b > 0) inDb++;
  }
  const n = parts.length || 1;
  return {
    via: r.via, n: hits.length,
    words: parts.length, inSes, inDb,
    sessionRatio: inSes / n,
    dbRatio: inDb / n,
    gap: (inDb - inSes) / n,
    top: hits.length ? Number(hits[0].score) || 0 : 0,
  };
}

const P = pos.map((c) => ({ c, s: feat(c) }));
const N = neg.map((c) => ({ c, s: feat(c) }));

console.log('=== 配对负例 ===');
for (const x of N) {
  const s = x.s;
  console.log('  ' + x.c.id.padEnd(5) + ' words=' + String(s.words).padStart(2)
    + ' inSes=' + String(s.inSes).padStart(2) + ' inDb=' + String(s.inDb).padStart(2)
    + ' sesR=' + s.sessionRatio.toFixed(2) + ' dbR=' + s.dbRatio.toFixed(2)
    + ' gap=' + s.gap.toFixed(2) + ' top=' + s.top.toFixed(2));
}

function q(a, p) { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.round(p * (b.length - 1)))]; }
console.log('\n=== 分布 ===');
for (const k of ['sessionRatio', 'dbRatio', 'gap']) {
  const pv = P.map((x) => x.s[k]), nv = N.map((x) => x.s[k]);
  console.log('  ' + k.padEnd(13) + ' 正例 min=' + Math.min(...pv).toFixed(2) + ' p10=' + q(pv, 0.1).toFixed(2)
    + ' p50=' + q(pv, 0.5).toFixed(2) + ' max=' + Math.max(...pv).toFixed(2));
  console.log('  ' + ''.padEnd(13) + ' 负例 min=' + Math.min(...nv).toFixed(2) + ' p50=' + q(nv, 0.5).toFixed(2)
    + ' max=' + Math.max(...nv).toFixed(2));
}

/* 零误伤上限 */
console.log('\n=== 零误伤上限 ===');
for (const k of ['sessionRatio', 'gap', 'dbRatio']) {
  for (const dir of ['<', '>']) {
    const pv = P.map((x) => x.s[k]);
    const T = dir === '<' ? Math.min(...pv) : Math.max(...pv);
    const caught = N.filter((x) => (dir === '<' ? x.s[k] < T : x.s[k] > T)).length;
    console.log('  ' + k.padEnd(13) + dir + T.toFixed(2) + ' ⇒ 拦 ' + caught + '/9');
  }
}

/* 组合：sessionRatio 低 且 gap 高（"词有，但在别的会话"） */
console.log('\n=== 组合「本会话没词」+「整库有词」 ===');
for (const [a, b] of [[0.4, 0.3], [0.45, 0.25], [0.5, 0.2], [0.55, 0.2], [0.6, 0.2]]) {
  const ca = N.filter((x) => x.s.sessionRatio <= a && x.s.gap >= b).length;
  const fa = P.filter((x) => x.s.sessionRatio <= a && x.s.gap >= b).length;
  console.log('  sesR<=' + a + ' 且 gap>=' + b + '  拦 ' + ca + '/9  误伤 ' + fa + '/109  净 ' + (ca - fa));
}
