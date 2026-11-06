/* 候选池与排序的**唯一**共享实现
 *
 * 为什么必须抽成模块：
 *   上一轮出现了三个脚本各自复刻一遍产品排序，其中一处抄错（长度区间 120~1500
 *   写成实际 40~400、漏了第 1 名独占规则），直接把结论符号翻反了。
 *   只要逻辑存在两份，早晚会不一致。所以从这一轮起，所有探针都从这里取。
 *
 * ⚠️⚠️⚠️ 这里的每一行都是从 scripts/ck-memory.js 逐字搬过来的，不许"优化"：
 *   · rankRelevanceFirst    → 1760–1794 行
 *   · recencyOf             → 1801–1808 行
 *   · importanceOf          → 精确口径见下（长度区间是 40~400，不是 120~1500）
 *   · RANK_TIE=2 / REL_TIE=0.12 / RECENCY_HALF_LIFE_DAYS=30
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const RANK_TIE = 0;              /* 产品当前值：名次差不构成并列，只有原始分相等才算 */
const RANK_TIE_LEGACY = 2;       /* 历史值：仅用于复现「旧版近似并列」做对照 */
const REL_TIE = 0.12;
const RECENCY_HALF_LIFE_DAYS = 30;
const ID_SHAPE = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/;

function recencyOf(ts, lastHit, now) {
  const created = Number(ts) || 0;
  const hit = Number(lastHit) || 0;
  const ref = Math.max(created, hit);
  if (!ref) return 0;
  const days = Math.max(0, (now - ref) / 86400000);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

function importanceOf(row) {
  let s = Number(row.pri) === 2 ? 0.40 : 0.20;
  if (ID_SHAPE.test(String(row.text || ''))) s += 0.20;
  const dup = Number(row.dup) || 1;
  if (dup > 1) s += Math.min(0.15, 0.05 * Math.log2(dup + 1));
  const L = String(row.text || '').length;
  if (L >= 40 && L <= 400) s += 0.10;      // ← 40~400，不是 120~1500
  return Math.min(1, s);
}

function rankKey(row, now) {
  return 0.6 * recencyOf(row.ts, row.last_hit_ts, now) + 0.4 * importanceOf(row);
}

/* ---------- 候选池：与产品同口径（AND → OR → LIKE），OR 走名次制 ---------- */
/* ⚠️⚠️⚠️ 必须与产品 `ck-memory.js:781 bigram()` **逐字同构**。
 *
 * 曾经的写法是「先删掉所有非中文字符，再整体切 bigram」：
 *     const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
 *     for (let i = 0; i + 1 < zh.length; i++) out.push(zh.slice(i, i + 2));
 * 这是**错的**：删标点会把原本不相邻的字粘在一起。
 *     实测「…记录…合…」⇒ 产出垃圾 bigram「录合」；
 *          「…关三…号按…」⇒「关三」「号按」；「…试套…件断…言是…」⇒「试套」「件断」。
 *     146 道题里 **93 道**分词结果与产品不一致，平均多出 4.4% 的 bigram，
 *     而且多出来的全是跨标点的噪声词 —— 它们会污染 cov 的分母。
 *
 * 产品口径是「**每个连续中文段各自切分**，段与段之间不跨界」：
 *     t.replace(/[\u4e00-\u9fa5]+/g, m => m.length===1 ? m : ' ' + bigramsOf(m) + ' ')
 *      .replace(/[^\w\u4e00-\u9fa5]+/g, ' ').trim()
 * 这里直接调产品函数，不再复刻 —— 「逻辑存在两份，早晚会不一致」这句话
 * 已经在这个文件里被印证两次了。 */
function bigrams(q) {
  const ckMod = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
  return [...new Set(ckMod.bigram(q).split(/\s+/).filter(Boolean))];
}
const quote = (p) => '"' + String(p).replace(/"/g, '""') + '"';

function pool(sid, q) {
  const ps = bigrams(q);
  if (!ps.length) return { items: [], rankMode: false, via: 'none' };

  /* fts5vocab 三参形式；列名是 cnt 不是 count */
  try { db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv USING fts5vocab('main','seg_fts','row')"); } catch (_) {}
  let live = ps;
  try {
    const st = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
    live = ps.filter((p) => { const r = st.get(p.toLowerCase()); return r && Number(r.cnt) > 0; });
  } catch (_) {}

  const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
                WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
                JOIN seg s ON s.id = t.rid`;
  const COLS = 's.id, s.seq, s.ts, s.text, COALESCE(s.dup,1) dup, COALESCE(s.pri,0) pri,'
    + ' COALESCE(s.last_hit_ts,0) last_hit_ts, t.score';
  const talk = db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=? AND s.kind IN ('user','assistant')
      AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
  /* ⚠️ 产品还有 `any`：对话里确实没有时，放宽到工具输出（找文件路径/命令）。 */
  const any = db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=? AND COALESCE(s.pri,0)>=1`);

  let rows = [], via = 'none';
  try {
    if (live.length && live.length === ps.length) {
      rows = talk.all(live.map(quote).join(' AND '), sid); via = 'AND';
    }
    if (!rows.length && live.length) {
      rows = talk.all(live.map(quote).join(' OR '), sid); via = 'OR';
      if (!rows.length) rows = any.all(live.map(quote).join(' OR '), sid);
    }
    if (!rows.length) {
      rows = db.prepare(`SELECT id, seq, ts, text, 1 AS dup, COALESCE(pri,0) pri,
          COALESCE(last_hit_ts,0) last_hit_ts, 0 AS score FROM seg
          WHERE sid=? AND kind IN ('user','assistant') AND COALESCE(noise,0)=0
            AND COALESCE(pri,0)>=1 AND text LIKE ? ORDER BY ts DESC LIMIT 300`)
        .all(sid, '%' + String(q).trim() + '%');
      if (rows.length) via = 'LIKE';
    }
  } catch (_) { return { items: [], rankMode: false, via: 'err' }; }

  if (via === 'OR' && live.length > 1) {
    /* ⚠️⚠️⚠️ 权重必须是**等权 1**，与产品 `ck-memory.js` search() OR 分支一致。
     *
     * 这里曾有两处与产品不同构：
     *   ① 用 `Math.log(1 + total/(1+df))` 加权，而产品已于 2026-11-05 改成等权
     *      （评测：等权 51.49% vs IDF 加权 47.85%，p=0.0246 显著）。
     *   ② `total` 取的是 `WHERE sid=?` 的**会话内**行数，产品取的是**全库**行数。
     * ② 最隐蔽：会话内行数只有几千、全库 5 万，同一个 df 算出的相对权重完全不同。
     * ⇒ 探针若继续用旧口径，测出来的排序就不是产品会给出的排序，结论没有意义。 */
    const w = new Map(live.map((p) => [p, 1]));
    const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
    const scored = rows.map((r) => {
      let got = 0;
      const t = String(r.text || '');
      for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
      return { r, cov: got / wSum };
    }).filter((x) => x.cov > 0);
    const order = scored.sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
    /* OR 走名次制：rel = 名次（覆盖率是阶梯分布，不能当分数比大小） */
    return { items: order.map((x, i) => ({ r: x.r, rel: i })), rankMode: true, via };
  }
  return { items: rows.map((r) => ({ r, rel: Number(r.score) || 0 })), rankMode: false, via };
}

/* ---------- 三种排序 ---------- */
/**
 * @param items  pool().items
 * @param now    时间基准
 * @param useSwap false = 纯相关性（组内也按相关性）；true = 组内按 rankKey 换位
 * @param fixGroup true = 修掉「第 2 名被赋成最后组号」的 bug
 */
function order(items, now, useSwap, fixGroup, rankMode, opts) {
  if (!items.length) return [];
  const o = opts || {};
  /* legacyTie：显式传 >0 时退回旧语义（名次差 ≤N 即并列），只给 A/B 对照用。
     产品现状是「原始分相等才算并列」，即 RANK_TIE=0。 */
  const rankTie = o.legacyTie ? Number(o.legacyTie) : RANK_TIE;
  const span = Math.max.apply(null, items.map((x) => x.rel)) - Math.min.apply(null, items.map((x) => x.rel));
  /* relTie：**仅探针用**的覆盖入口（AND 路的并列阈值 = span × REL_TIE）。
     不传时取生产值 REL_TIE，行为与 ck-memory.js 完全一致。
     加这个口子的原因：AND 路的并列判定用的是一个**相对阈值**（占全池全距的比例），
     不扫一遍就不知道 0.12 是不是合适；而 REL_TIE 是模块常量，不改它就没法做 A/B。 */
  const relTie = (o.relTie === undefined || o.relTie === null) ? REL_TIE : Number(o.relTie);
  const tie = rankMode ? 0 : (span > 0 ? span * relTie : Infinity);
  /* 名次模式的组身份键：原始分相等 = 真并列 */
  const hasScore = rankMode && items.some((x) => x.r && x.r.score !== undefined && x.r.score !== null);
  const keyOf = (x) => (rankMode ? (hasScore ? 'S' + Number(x.r.score) : 'R' + x.rel) : String(x.rel));

  const arr = items.map((x, i) => ({ x, i, g: 0, k: keyOf(x) }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);

  if (!useSwap) {
    /* 纯相关性：组内也不换位，完全按 rel（再按原序兜底） */
    return arr;
  }

  const trulyTied = arr.length > 1 && arr[1].k === arr[0].k;
  arr[0].g = 0;                                   // 不变量①：第 1 名独占 0 组
  /* 分组：名次模式按组身份键（真并列同组）；分数模式按与组起点的跨度 */
  const breaks = (cur, anchor) => (rankMode
    ? (rankTie ? (cur.x.rel - anchor.x.rel > rankTie) : cur.k !== anchor.k)
    : (cur.x.rel - anchor.x.rel > tie));
  if (fixGroup) {
    /* 正解（与产品 ck-memory.js 逐字同构）：第 2 名在循环**之前**定组，
       组号就是 g 的初始值。之前写成「循环内 k=1 时赋值 + 循环后再覆盖一次」，
       等价但多一步，容易和产品走样 —— 现在按产品写法对齐。 */
    let g = trulyTied ? 0 : 1;
    let anchor = arr.length > 1 ? arr[1] : arr[0];
    if (arr.length > 1) arr[1].g = g;
    for (let k = 2; k < arr.length; k++) {
      if (breaks(arr[k], anchor)) { g += 1; anchor = arr[k]; }
      arr[k].g = g;
    }
  } else {
    /* 旧版（含 bug）：第 2 名被赋成循环结束后的最终组号 —— 只用于做「修复前后」对比 */
    let g = trulyTied ? 0 : 1;
    let anchor = arr.length > 1 ? arr[1] : arr[0];
    for (let k = 2; k < arr.length; k++) {
      if (breaks(arr[k], anchor)) { g += 1; anchor = arr[k]; }
      arr[k].g = g;
    }
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;
  }
  arr.sort((a, b) => a.g - b.g || rankKey(b.x.r, now) - rankKey(a.x.r, now) || a.i - b.i);
  return arr;
}

/** gold 是否全中（按 minHit） */
function hitOf(items, now, k, gold, minHit, fixGroup, rankMode) {
  const seqs = order(items, now, true, fixGroup, rankMode).slice(0, k).map((a) => Number(a.x.r.seq));
  let got = 0;
  for (const g of gold) if (seqs.indexOf(Number(g)) >= 0) got++;
  return got >= minHit;
}

module.exports = {
  ck, db, RANK_TIE, RANK_TIE_LEGACY, REL_TIE, RECENCY_HALF_LIFE_DAYS, ID_SHAPE,
  recencyOf, importanceOf, rankKey, bigrams, pool, order, hitOf,
};
