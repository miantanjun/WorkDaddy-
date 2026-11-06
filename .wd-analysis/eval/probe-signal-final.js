/* 诊断十七（收口）：所有候选信号的统一口径对比 + 真实成本
 *
 * ⚠️⚠️⚠️ 本脚本存在的原因：前两版对「hereN」用了两个不同定义，
 *   一个说 3/9 有效、一个说 0/9 无效，差别全在定义上：
 *     · hereN_search = search(sid,q,8).hits.length  ⇒ 配对负例恒为 8（OR 总能填满）⇒ 完全无效
 *     · hereN_global = 全局 top-N 结果中落在本会话的条数 ⇒ 有区分度，但要付全局查询成本
 *   这类"同名不同义"必须在一个脚本里并排跑，否则结论会互相打架。
 *
 * 信号清单：
 *   S1 hereN_search     本会话 hits 数          （零成本，实测无效）
 *   S2 share            本会话在全局 topN 中占比（1 次全局查询）
 *   S3 margin           here − bestOther 会话分  （1 次全局查询）
 *   S4 share + margin   组合
 *   S5 top1 全局 bm25 是否落在本会话            （1 次全局查询）
 *
 * 评估口径：
 *   · 配对负例（9）应提示     · 正例（109）不应提示     · 纯负例（8）应提示（但它们连结果都没有）
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
const db = ck._internal.open();
const N_SESS = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, LENGTH(s.text) AS len, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 3000) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 400`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
function globalRows(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  return stmt.all(parts.map(esc).join(' OR '));
}

let globalQueries = 0, searchQueries = 0;
const gCache = new Map();
function G(q) {
  if (gCache.has(q)) return gCache.get(q);
  const r = globalRows(q);
  globalQueries++;
  gCache.set(q, r);
  return r;
}

function feats(c) {
  /* S1：本会话 hits 数 */
  const sr = ck._internal.search(c.sid, c.q, 8);
  searchQueries++;
  const hereN = (sr.hits || []).length;

  /* 全局一次查询 ⇒ S2/S3/S5 */
  const rows = G(c.q);
  const g = new Map();
  for (const r of rows) {
    if (!g.has(r.sid)) g.set(r.sid, []);
    g.get(r.sid).push(r);
  }
  const hereRows = g.get(c.sid) || [];
  const share = rows.length ? hereRows.length / rows.length : 0;

  const sessScore = (list) => {
    const t = list.slice(0, 3).map((x) => Number(x.score));
    return t.reduce((a, b) => a + b, 0) / (t.length || 1);
  };
  const hereScore = hereRows.length ? sessScore(hereRows) : null;
  let bestOther = null;
  for (const [sid, list] of g) {
    if (sid === c.sid) continue;
    const v = sessScore(list);
    if (bestOther === null || v < bestOther) bestOther = v;
  }
  const margin = hereScore === null ? 99 : (bestOther === null ? -99 : hereScore - bestOther);
  const top1Here = rows.length > 0 && rows[0].sid === c.sid ? 1 : 0;

  return { hereN, share, margin, top1Here, gN: rows.length, hereG: hereRows.length };
}

const rowsAll = [];
for (const [label, list] of [['PN', PN], ['P', P], ['NEG', NEG]]) {
  for (const c of list) rowsAll.push({ label, id: c.id, ...feats(c) });
}

const sel = (label) => rowsAll.filter((x) => x.label === label);
console.log('会话数 ' + N_SESS + ' ｜ 全局查询 ' + globalQueries + ' 次 ｜ 会话内 search ' + searchQueries + ' 次\n');

/* 每个信号按"越大越该提示"统一方向后，看三个组的分布 */
console.log('=== ① 各信号在三组上的分布（p50 / p90）===');
console.log('  信号            配对负例p50  正例p50  正例p90  纯负例p50');
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
const SIG = {
  'S1 hereN(零成本)': (x) => x.hereN,
  'S2 share': (x) => x.share,
  'S3 margin': (x) => x.margin,
  'S5 top1在本会话': (x) => x.top1Here,
};
for (const [name, fn] of Object.entries(SIG)) {
  const a = sel('PN').map(fn), b = sel('P').map(fn), c2 = sel('NEG').map(fn);
  console.log('  ' + name.padEnd(18)
    + String(pct(a, 0.5).toFixed(2)).padStart(11)
    + String(pct(b, 0.5).toFixed(2)).padStart(9)
    + String(pct(b, 0.9).toFixed(2)).padStart(9)
    + String(pct(c2, 0.5).toFixed(2)).padStart(10));
}

console.log('\n=== ② 阈值扫描：只看"零误提示"能达到多少 ===');
function scan(name, fn, thresholds) {
  console.log('\n  ' + name);
  for (const t of thresholds) {
    const tp = sel('PN').filter((x) => fn(x) > t).length;
    const fp = sel('P').filter((x) => fn(x) > t).length;
    const tn = sel('NEG').filter((x) => fn(x) > t).length;
    console.log('    >' + String(t).padEnd(6) + ' 配对负例 ' + String(tp + '/9').padStart(5)
      + ' · 正例误提示 ' + String(fp + '/109').padStart(7)
      + ' · 纯负例 ' + String(tn + '/8').padStart(4)
      + (fp === 0 ? '  ← 零误伤，净 ' + (tp - fp) : '  净 ' + (tp - fp)));
  }
}
scan('S1 hereN（预期无效，仅作对照）', (x) => x.hereN, [0, 3, 5, 7]);
scan('S2 share（本会话在全局 top400 中占比）', (x) => x.share, [0, 0.02, 0.05, 0.1, 0.2, 0.3]);
scan('S3 margin', (x) => x.margin, [0, 2, 4, 6, 8, 10, 15]);
scan('S4 share>0.2 或 margin>8', (x) => (x.share > 0.2 || x.margin > 8) ? 1 : 0, [0]);

console.log('\n=== ③ 成本 ===');
const t0 = Date.now();
for (let i = 0; i < 30; i++) { gCache.clear(); globalRows(P[0].q); }
const perG = (Date.now() - t0) / 30;
const t1 = Date.now();
for (let i = 0; i < 30; i++) ck._internal.search(P[0].sid, P[0].q, 8);
const perS = (Date.now() - t1) / 30;
console.log('  单次全局 FTS 查询 ' + perG.toFixed(1) + ' ms');
console.log('  单次会话内 search ' + perS.toFixed(1) + ' ms');
console.log('  ⇒ 若采用「全局查询」方案：每次提问 +' + perG.toFixed(0) + ' ms（' + N_SESS + ' 会话一次扫完，与会话数无关）');
console.log('  ⇒ 对比「逐会话循环」方案：' + (N_SESS * perS).toFixed(0) + ' ms（随会话数线性增长）');
