/* 诊断十三：能否给出一条「这条在另一个会话」的提示规则？
 *
 * 单靠「别的会话分数更优」（Δ 扫描）误伤太多（Δ=0 → 20/109）。
 * 加入第二条件：**本会话本来就很弱**（top bm25 接近 0 = 不相关）。
 * 两个条件同时满足才提示 —— 这条是有原理的：
 *   「这里答不好」+「别处答得好」才值得打扰用户；只有一项就不该提示。
 *
 * 评价标准：9 条配对负例（应提示）vs 109 条正例（不该提示）。
 * 同时报出「真提示率」与「误提示率」，以及**正例中本会话本来就排第一却被提示**的比例。
 *
 * ⚠️ 只读。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const db = ck._internal.open();

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 600) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 80`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';

function info(c) {
  const parts = [...new Set(String(ck.bigram(c.q)).split(/\s+/).filter(Boolean))];
  const rows = parts.length ? stmt.all(parts.map(esc).join(' OR ')) : [];
  const g = new Map();
  for (const r of rows) { if (!g.has(r.sid)) g.set(r.sid, []); g.get(r.sid).push(r); }
  const sess = [];
  for (const [sid, list] of g) {
    const t3 = list.slice(0, 3);
    sess.push({ sid, score: t3.reduce((s, x) => s + Number(x.score), 0) / t3.length, top: Number(t3[0].score) });
  }
  sess.sort((a, b) => a.score - b.score);
  const here = sess.find((s) => s.sid === c.sid) || null;
  const best = sess[0] || null;
  const elsewhere = best && best.sid !== c.sid ? best : (sess[1] && sess[1].sid !== c.sid ? sess[1] : null);
  return {
    nSess: sess.length,
    hereTop: here ? here.top : 0,
    hereScore: here ? here.score : 0,
    elseTop: elsewhere ? elsewhere.top : 0,
    elseScore: elsewhere ? elsewhere.score : 0,
    margin: here && elsewhere ? elsewhere.score - here.score : 0,  // 负 = 别处更强
    rankHere: here ? sess.indexOf(here) + 1 : 0,
  };
}

const iP = P.map((c) => ({ c, i: info(c) }));
const iN = PN.map((c) => ({ c, i: info(c) }));

console.log('=== 提示规则的网格搜索（本会话弱 + 别处明显更强）===');
console.log('  弱门槛      Δ(须更负)   配对负例提示   正例误提示   净');
let best = null;
for (const weak of [-3, -5, -7, -9, -11, -13]) {
  for (const d of [3, 5, 8, 10, 12, 15]) {
    /* 条件：本会话 top 比 weak 更接近 0（=更不相关）；且别处分数比这里更负至少 d */
    const fire = (x) => x.i.hereTop > weak && x.i.margin < -d;
    const tp = iN.filter(fire).length;
    const fp = iP.filter(fire).length;
    const net = tp - fp;
    if (!best || net > best.net) best = { weak, d, tp, fp, net };
    console.log('  ' + String(weak).padStart(4) + '      ' + String(d).padStart(4)
      + '        ' + String(tp + '/9').padStart(9) + '      ' + String(fp + '/109').padStart(9)
      + '   ' + String(net).padStart(4));
  }
}
console.log('\n  最优：本会话 top > ' + best.weak + ' 且 别处比这里更强 ≥' + best.d
  + ' ⇒ 提示 ' + best.tp + '/9 · 误提示 ' + best.fp + '/109 · 净 ' + best.net);

/* 看最优规则下具体提示了哪些、漏了哪些 */
console.log('\n=== 最优规则逐条（配对负例）===');
for (const x of iN) {
  const fire = x.i.hereTop > best.weak && x.i.margin < -best.d;
  console.log('  ' + x.c.id.padEnd(5) + ' 本会话top=' + x.i.hereTop.toFixed(1).padStart(7)
    + ' 别处top=' + x.i.elseTop.toFixed(1).padStart(7)
    + ' 余量=' + x.i.margin.toFixed(1).padStart(7)
    + ' 本会话排名=' + x.i.rankHere + '/' + x.i.nSess
    + (fire ? '   → 提示 ✅' : '   → 不提示 ❌'));
}
console.log('\n=== 最优规则逐条（正例中被误提示的）===');
let k = 0;
for (const x of iP) {
  const fire = x.i.hereTop > best.weak && x.i.margin < -best.d;
  if (!fire) continue;
  k++;
  if (k <= 8) {
    console.log('  ' + x.c.id.padEnd(5) + ' 本会话top=' + x.i.hereTop.toFixed(1).padStart(7)
      + ' 余量=' + x.i.margin.toFixed(1).padStart(7) + ' 本会话排名=' + x.i.rankHere + '/' + x.i.nSess
      + '  q=' + String(x.c.q).slice(0, 34));
  }
}
console.log('  ... 共 ' + k + ' 条误提示');
