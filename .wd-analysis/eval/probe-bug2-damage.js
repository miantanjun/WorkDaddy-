/* 量化分组 bug 的真实危害：第 2 名到底被踢到第几位
 *
 * 为什么不能只看 Recall@8：
 *   bug 的效果是「原本相关性第 2 名的候选，被赋成最后一个组的组号 ⇒ 排到池尾」。
 *   但 Recall@8 只问「gold 有没有进前 8」。如果 gold 本来就不在前 8，
 *   它从第 2 跌到第 150 还是从第 30 跌到第 150，Recall 都一样是 0 ⇒ 看起来「无影响」。
 *   这就是为什么 109 题测出「修 bug = +0.0pp」却不能说 bug 无害。
 *
 * 直接测：每次检索，取相关性排序的第 2 名（以及第 1 名），看它们在新顺序里的位置。
 *   第 1 名应当恒为 1（不变量①）；
 *   第 2 名按设计最多往下让几个名次（同组内），不该跌到池尾。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { ALL } = require('./all-cases.js');

const RANK_TIE = 2, REL_TIE = 0.12;
const items = ck._internal.__rankTest || null;   // 产品里没导出，用下面的 pool 复刻

/* 与 probe-rank-tie-v2.js 完全同口径的候选池 */
const bg = (s) => {
  const t = String(s || '').toLowerCase();
  const out = [];
  const en = t.match(/[a-z0-9][a-z0-9_.\-]*/g) || [];
  for (const w of en) if (w.length >= 2) out.push(w);
  const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i + 1 < zh.length; i++) out.push(zh.slice(i, i + 2));
  return [...new Set(out)];
};
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';

function pool(sid, q) {
  const ps = bg(q);
  if (!ps.length) return { items: [], rankMode: false };
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv USING fts5vocab('main','seg_fts','row')");
  } catch (_) {}
  let live = ps;
  try {
    const dfSt = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
    live = ps.filter((p) => { const r = dfSt.get(p.toLowerCase()); return r && Number(r.cnt) > 0; });
  } catch (_) {}
  if (!live.length) return { items: [], rankMode: false };
  const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
                WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
                JOIN seg s ON s.id = t.rid`;
  const COLS = 's.id, s.seq, s.ts, s.text, COALESCE(s.dup,1) dup, COALESCE(s.pri,0) pri,'
    + ' COALESCE(s.last_hit_ts,0) last_hit_ts, t.score';
  const talk = db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=? AND s.kind IN ('user','assistant')
      AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
  let rows = [];
  try {
    if (live.length === ps.length) rows = talk.all(live.map(esc).join(' AND '), sid);
    if (!rows.length) rows = talk.all(live.map(esc).join(' OR '), sid);
  } catch (_) {}
  if (!rows.length) return { items: [], rankMode: false };
  /* 名次制（OR 路径） */
  const total = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=?').get(sid).c) || 1;
  const w = new Map();
  const dfSt = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
  for (const p of live) {
    let df = 1;
    try { const r = dfSt.get(p.toLowerCase()); if (r) df = Number(r.cnt) || 1; } catch (_) {}
    w.set(p, Math.log(1 + total / (1 + df)));
  }
  const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
  const scored = rows.map((r) => {
    let got = 0; const t = String(r.text || '');
    for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
    return { r, cov: got / wSum };
  }).filter((x) => x.cov > 0);
  const order = scored.sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
  return { items: order.map((x, i) => ({ r: x.r, rel: i })), rankMode: true };
}

const REC = 30;
const recencyOf = (ts, lh, now) => {
  const ref = Math.max(Number(ts) || 0, Number(lh) || 0);
  if (!ref) return 0;
  return Math.pow(0.5, Math.max(0, (now - ref) / 86400000) / REC);
};
const ID_SHAPE = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/;
const importanceOf = (r) => {
  let s = Number(r.pri) === 2 ? 0.40 : 0.20;
  if (ID_SHAPE.test(String(r.text || ''))) s += 0.20;
  const dup = Number(r.dup) || 1;
  if (dup > 1) s += Math.min(0.15, 0.05 * Math.log2(dup + 1));
  const L = String(r.text || '').length;
  if (L >= 40 && L <= 400) s += 0.10;
  return Math.min(1, s);
};
const rk = (r, now) => 0.6 * recencyOf(r.ts, r.last_hit_ts, now) + 0.4 * importanceOf(r);

function groupBuggy(items) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anchor > RANK_TIE) { g += 1; anchor = arr[k].x.rel; }
    arr[k].g = g;
  }
  if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;   // ← 现状（bug）
  return arr;
}
function groupFixed(items) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  const g0 = trulyTied ? 0 : 1;
  let g = g0;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  for (let k = 1; k < arr.length; k++) {
    if (k >= 2 && arr[k].x.rel - anchor > RANK_TIE) { g += 1; anchor = arr[k].x.rel; }
    if (k === 1) arr[1].g = g0; else arr[k].g = g;
  }
  return arr;
}

const NOW = Date.now();
const stat = { n: 0, rank1ok: 0, r2: [], r2f: [], pool: [] };
const worst = [];
for (const c of ALL) {
  if (!(c.gold || []).length) continue;
  const p = pool(c.sid, c.q);
  if (p.items.length < 4) continue;
  stat.n++;
  const idx2 = p.items.findIndex((x) => x.rel === 1);   // 名次制下 rel=1 就是第 2 名
  const b = groupBuggy(p.items).slice().sort((a, b2) => a.g - b2.g || 0);
  const f = groupFixed(p.items).slice().sort((a, b2) => a.g - b2.g || 0);
  /* 同一组内再按 rankKey 排 —— 与产品一致 */
  const sortIn = (arr) => {
    const byG = new Map();
    for (const a of arr) { if (!byG.has(a.g)) byG.set(a.g, []); byG.get(a.g).push(a); }
    const out = [];
    for (const k of [...byG.keys()].sort((x, y) => x - y)) {
      out.push(...byG.get(k).sort((a, b2) => rk(b2.x.r, NOW) - rk(a.x.r, NOW) || a.i - b2.i));
    }
    return out;
  };
  const ob = sortIn(groupBuggy(p.items));
  const of_ = sortIn(groupFixed(p.items));
  const posB = idx2 >= 0 ? ob.findIndex((a) => a.i === idx2) + 1 : 0;
  const posF = idx2 >= 0 ? of_.findIndex((a) => a.i === idx2) + 1 : 0;
  stat.pool.push(p.items.length);
  stat.r2.push(posB);
  stat.r2f.push(posF);
  if (b[0].g === 0 && ob[0].i === 0) stat.rank1ok++;
  worst.push({ id: c.id, posB, posF, pool: p.items.length });
}

const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
};
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

console.log('样本 ' + stat.n + ' 次检索（每次一个真实查询）');
console.log('候选池大小  p50=' + pct(stat.pool, 0.5) + '  p90=' + pct(stat.pool, 0.9) + '  max=' + Math.max.apply(null, stat.pool));
console.log('第 1 名仍是第 1 名: ' + stat.rank1ok + '/' + stat.n + '（不变量①应恒成立）');
console.log('');
console.log('相关性第 2 名的实际落位（名次）：');
console.log('  现状(含bug)  中位 ' + pct(stat.r2, 0.5) + ' · 均值 ' + avg(stat.r2).toFixed(1) + ' · 最差 ' + Math.max.apply(null, stat.r2));
console.log('  修分组bug后  中位 ' + pct(stat.r2f, 0.5) + ' · 均值 ' + avg(stat.r2f).toFixed(1) + ' · 最差 ' + Math.max.apply(null, stat.r2f));
const pushed = stat.r2.filter((x, i) => x > stat.r2f[i]).length;
const big = stat.r2.filter((x, i) => x - stat.r2f[i] >= 10).length;
console.log('  被 bug 推后的检索次数: ' + pushed + '/' + stat.n + '（其中推后 ≥10 名: ' + big + '）');
console.log('');
console.log('被推后最严重的 10 例（题目 / 池大小 / 现状落位 / 修后落位）：');
worst.slice().sort((a, b) => (b.posB - b.posF) - (a.posB - a.posF)).slice(0, 10)
  .forEach((x) => console.log('  ' + x.id.padEnd(6) + ' 池' + String(x.pool).padStart(4)
    + '  现状第 ' + String(x.posB).padStart(4) + ' → 修后第 ' + String(x.posF).padStart(3)));
