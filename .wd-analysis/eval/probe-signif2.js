/* 显著性检验（McNemar 精确检验）+ 「新鲜度信号是否真有区分度」
 *
 * 两个问题：
 *   ① 分组 bug（+1.4pp）与「换位机制」（−1.4pp）各自是否显著？
 *      73 题里 1 题的差异 ≈ 1.4pp —— 必须先算 p 值再决定要不要动产品代码。
 *   ② 「问最新」的题在换位下反而变差 37.5pp，这不合直觉。
 *      假设：库里 seg 的 ts 高度集中，recencyOf 几乎全等于 1，没有区分度，
 *      于是换位做的是「近似随机交换」。这一条必须实测，不能靠推理。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { ALL } = require('./all-cases.js');

/* ---------- McNemar 精确检验 ----------
 * 只统计「一个对一个错」的配对（b / c），对角线不参与。
 * 双侧精确 p = 2 * Σ_{i=0}^{min(b,c)} C(n,i) * 0.5^n ，截到 1。
 */
function mcnemar(a, b) {
  const pairs = [];
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue;
    pairs.push([a[k], b[k]]);
  }
  let n01 = 0, n10 = 0;
  for (const [x, y] of pairs) { if (x === 0 && y === 1) n01++; if (x === 1 && y === 0) n10++; }
  const n = n01 + n10;
  if (!n) return { n01, n10, n: 0, p: 1 };
  const lgamma = (z) => {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  };
  const lnC = (nn, kk) => lgamma(nn + 1) - lgamma(kk + 1) - lgamma(nn - kk + 1);
  let p = 0;
  const lim = Math.min(n01, n10);
  for (let i = 0; i <= lim; i++) p += Math.exp(lnC(n, i) - n * Math.LN2);
  return { n01, n10, n, p: Math.min(1, 2 * p) };
}

/* ---------- 逐题命中表（三种排序） ---------- */
const REL_TIE = 0.12, RANK_TIE = 2, HALF = 30;
const ID_SHAPE = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/;
const recencyOf = (ts, lh, now) => {
  const ref = Math.max(Number(ts) || 0, Number(lh) || 0);
  if (!ref) return 0;
  return Math.pow(0.5, Math.max(0, (now - ref) / 86400000) / HALF);
};
const importanceOf = (r) => {
  let s = Number(r.pri) === 2 ? 0.40 : 0.20;
  if (ID_SHAPE.test(String(r.text || ''))) s += 0.20;
  const dup = Number(r.dup) || 1;
  if (dup > 1) s += Math.min(0.15, 0.05 * Math.log2(dup + 1));
  const L = String(r.text || '').length;
  if (L >= 40 && L <= 400) s += 0.10;
  return Math.min(1, s);
};
const rankKey = (r, now) => 0.6 * recencyOf(r.ts, r.last_hit_ts, now) + 0.4 * importanceOf(r);

function rerank(items, now, rankTie, rankMode, fixGroup) {
  if (!items.length) return items;
  const rels = items.map((x) => x.rel);
  const span = Math.max.apply(null, rels) - Math.min.apply(null, rels);
  const tie = rankMode ? (rankTie || 0) : (span > 0 ? span * REL_TIE : Infinity);
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  if (fixGroup) {
    let g = 1;
    let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
    for (let k = 1; k < arr.length; k++) {
      if (k >= 2 && arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
    if (trulyTied && arr.length > 1) arr[1].g = 0;
  } else {
    let g = trulyTied ? 0 : 1;
    let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;
  }
  arr.sort((a, b) => a.g - b.g || rankKey(b.x.r, now) - rankKey(a.x.r, now) || a.i - b.i);
  return arr.map((o) => o.x);
}

/* 候选池：直接用产品 search 的返回顺序做不到「纯相关性」，
 * 所以这里复用 probe-rank-tie-v2 的同口径取池逻辑（内联一份，避免跨文件依赖）。 */
function bgOf(s) {
  const t = String(s || '').toLowerCase();
  const out = new Set();
  for (const w of (t.match(/[a-z0-9][a-z0-9_.\-]*/g) || [])) if (w.length >= 2) out.add(w);
  const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i + 1 < zh.length; i++) out.add(zh.slice(i, i + 2));
  return [...out];
}
function pool(sid, q) {
  const ps = bgOf(q);
  if (!ps.length) return { items: [], rankMode: true };
  const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
  const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
                WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
                JOIN seg s ON s.id = t.rid`;
  const COLS = 's.id, s.seq, s.ts, s.text, COALESCE(s.dup,1) dup, COALESCE(s.pri,0) pri,'
    + ' COALESCE(s.last_hit_ts,0) last_hit_ts, t.score';
  const talk = db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=? AND s.kind IN ('user','assistant')
      AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
  let live = ps;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv2 USING fts5vocab('main','seg_fts','row')");
    const st = db.prepare('SELECT cnt FROM temp.wv2 WHERE term=?');
    live = ps.filter((p) => { const r = st.get(p.toLowerCase()); return r && Number(r.cnt) > 0; });
  } catch (_) {}
  let rows = [], via = 'none';
  try {
    if (live.length && live.length === ps.length) { rows = talk.all(live.length === 1 ? esc(live[0]) : live.map(esc).join(' AND '), sid); via = 'AND'; }
    if (!rows.length && live.length) { rows = talk.all(live.map(esc).join(' OR '), sid); via = 'OR'; }
  } catch (_) { return { items: [], rankMode: true }; }
  if (via === 'OR' && live.length > 1) {
    let total = 1;
    try { total = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=?').get(sid).c) || 1; } catch (_) {}
    const st = db.prepare('SELECT cnt FROM temp.wv2 WHERE term=?');
    const w = new Map();
    for (const p of live) {
      let df = 1;
      try { const r = st.get(p.toLowerCase()); if (r) df = Number(r.cnt) || 1; } catch (_) {}
      w.set(p, Math.log(1 + total / (1 + df)));
    }
    const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
    const scored = rows.map((r) => {
      let got = 0; const t = String(r.text || '');
      for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
      return { r, cov: got / wSum };
    }).filter((x) => x.cov > 0);
    scored.sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
    return { items: scored.map((x, i) => ({ r: x.r, rel: i })), rankMode: true };
  }
  return { items: rows.map((r) => ({ r, rel: Number(r.score) || 0 })), rankMode: false };
}

const now = Date.now();
const pos = ALL.filter((c) => (c.gold || []).length);
const hitTable = { pure: {}, swap: {}, swapFix: {} };
for (const c of pos) {
  const pooled = pool(c.sid, c.q);
  for (const [key, tie, fix] of [['pure', 0, true], ['swap', RANK_TIE, false], ['swapFix', RANK_TIE, true]]) {
    const out = rerank(pooled.items, now, tie, pooled.rankMode, fix);
    const seqs = out.slice(0, c.k).map((x) => Number(x.r.seq));
    const hit = c.gold.filter((g) => seqs.indexOf(g) >= 0).length;
    hitTable[key][c.id] = hit >= (c.minHit || 1) ? 1 : 0;
  }
}
const rate = (t) => Object.values(t).reduce((s, v) => s + v, 0) / Object.keys(t).length;

console.log('标题：显著性检验（McNemar 精确检验，双侧）');
console.log('='.repeat(78));
console.log('  A 纯相关性排序            ' + (rate(hitTable.pure) * 100).toFixed(1) + '%');
console.log('  B 换位·现状（含分组bug）  ' + (rate(hitTable.swap) * 100).toFixed(1) + '%');
console.log('  C 换位·修掉分组bug        ' + (rate(hitTable.swapFix) * 100).toFixed(1) + '%');
console.log('  n = ' + pos.length + ' 道正例\n');
const m1 = mcnemar(hitTable.pure, hitTable.swap);
const m2 = mcnemar(hitTable.pure, hitTable.swapFix);
const m3 = mcnemar(hitTable.swap, hitTable.swapFix);
const fmt = (name, m) => '  ' + name.padEnd(34) + 'b=' + String(m.n01).padStart(2)
  + ' c=' + String(m.n10).padStart(2) + '  p=' + m.p.toFixed(4)
  + (m.p < 0.05 ? '  ✅ 显著' : '  ⚪ 不显著');
console.log(fmt('A 纯相关 → B 换位现状', m1));
console.log(fmt('A 纯相关 → C 换位修bug', m2));
console.log(fmt('B 换位现状 → C 修分组bug', m3));

/* ---------- 新鲜度信号的区分度 ---------- */
console.log('\n' + '='.repeat(78));
console.log('新鲜度信号到底有没有区分度（这决定了换位是不是在随机洗牌）');
console.log('='.repeat(78));
for (const [tag, sid] of Object.entries({
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
})) {
  const rows = db.prepare(`SELECT ts, COALESCE(last_hit_ts,0) lh FROM seg WHERE sid=?
      AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0`).all(sid);
  const recs = rows.map((r) => recencyOf(r.ts, r.lh, now)).filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p) => recs[Math.floor(recs.length * p)] || 0;
  const days = rows.map((r) => (now - Math.max(Number(r.ts) || 0, Number(r.lh) || 0)) / 86400000).sort((a, b) => a - b);
  console.log('  ' + tag + '  n=' + String(recs.length).padStart(5)
    + '  recency p10=' + q(0.1).toFixed(4) + ' p50=' + q(0.5).toFixed(4) + ' p90=' + q(0.9).toFixed(4)
    + '  极差=' + (q(0.9) - q(0.1)).toFixed(4)
    + '  | 时间跨度 p10=' + days[Math.floor(days.length * 0.1)].toFixed(1) + '天'
    + ' p50=' + days[Math.floor(days.length * 0.5)].toFixed(1) + '天');
}
console.log('\n判断标准：若 recency 的 p10~p90 极差 < 0.05，说明「新鲜度」在库里几乎无区分度，');
console.log('  换位实际做的是近似随机交换 ⇒ 不该指望它带来收益，只会扰动相关性顺序。');
