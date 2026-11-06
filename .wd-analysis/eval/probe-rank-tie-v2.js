/* 决定性实验：关掉「并列组内新鲜度换位」后，temporal 类题会变好还是变差？
 *
 * 这是上一轮留下的悬案：
 *   31 题上测出「关掉换位 = +9.7pp」，但 RANK_TIE 扫 1/2/3/5 完全一样，
 *   当时的解释是「机制有结构性问题」。现在题集扩到 78 正例、其中 temporal 17 条，
 *   终于可以把这件事量准 —— 而且这次能分开看：
 *     · temporal（问「最新/现在」）—— 换位**应该**帮忙
 *     · temporal（问「最早/当初」）—— 换位**应该**帮倒忙
 *   只有分方向看，才知道该保留、该删，还是该改成「按提问意图决定换不换」。
 *
 * 做法：不改产品代码。把候选池按产品口径取出来（AND→OR→LIKE），
 *   然后自己复刻 rankRelevanceFirst，用开关控制 rankTie=0 / 2，比较命中率。
 *
 * ⚠️⚠️⚠️ 复刻排序是这轮最容易出错的地方（上一轮就漏抄了 importanceOf 的两项，
 *   算出 45.2% 而真实是 38.7%）。所以这里把 rankKey 的每一项都从产品源码里
 *   逐字搬过来，并在末尾断言「rankTie=0 时的顺序必须与纯相关性顺序完全一致」。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { ALL } = require('./all-cases.js');

/* ---- 从产品源码逐字照搬的量与逻辑 ---- */
const RANK_TIE = 2;                 // scripts/ck-memory.js:1748
const REL_TIE = 0.12;               // scripts/ck-memory.js:1740（AND/LIKE 路径用）
const RECENCY_HALF_LIFE_DAYS = 30;  // scripts/ck-memory.js 同名常量
const ID_SHAPE = /[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}/;   // 逐字照搬

function recencyOf(ts, lastHit, now) {
  const created = Number(ts) || 0;
  const hit = Number(lastHit) || 0;
  const ref = Math.max(created, hit);
  if (!ref) return 0;
  const days = Math.max(0, (now - ref) / 86400000);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

/**
 * ⚠️⚠️⚠️ 这里我上一版抄错了三处，导致算出「关换位 +9.7pp」的**符号相反**结论。
 *   教训：复刻产品逻辑时，「照抄」必须逐字，任何一处想当然都会翻转结论。
 *
 *   错误 1：长度加分区间写成 120~1500 —— 实际是 **40~400**（源码 importanceOf）。
 *   错误 2：漏了 `arr[0].g = 0` 的**第 1 名独占规则**（不变量①，第 1 名不许被换掉）。
 *   错误 3：漏了「真并列」特例（第 2 名与第 1 名分数精确相等时也进 0 组）。
 */
function importanceOf(row) {
  let s = Number(row.pri) === 2 ? 0.40 : 0.20;
  if (ID_SHAPE.test(String(row.text || ''))) s += 0.20;
  const dup = Number(row.dup) || 1;
  if (dup > 1) s += Math.min(0.15, 0.05 * Math.log2(dup + 1));
  const L = String(row.text || '').length;
  if (L >= 40 && L <= 400) s += 0.10;
  return Math.min(1, s);
}

function rankKey(row, now) {
  return 0.6 * recencyOf(row.ts, row.last_hit_ts, now) + 0.4 * importanceOf(row);
}

/**
 * 逐字复刻 rankRelevanceFirst。
 * rankTie=0（rankMode）⇒ 永不换位，返回纯相关性顺序（这是「关」的语义）。
 * fixGroup=true ⇒ 修掉「第 2 名被赋成最后一个组号」那个 bug（见 probe-group-bug.js）。
 */
function rerank(items, now, rankTie, rankMode, fixGroup) {
  if (!items.length) return items;
  const rels = items.map((x) => x.rel);
  const span = Math.max.apply(null, rels) - Math.min.apply(null, rels);
  const tie = rankMode ? (rankTie || 0) : (span > 0 ? span * REL_TIE : Infinity);
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;                                        // 不变量①：第 1 名独占
  if (fixGroup) {
    // 正解：第 2 名按它自己的 rel 归组（从 k=1 开始算），而不是最后才补一个最终 g
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
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;   // ← bug 行
  }
  arr.sort((a, b) => a.g - b.g || rankKey(b.x.r, now) - rankKey(a.x.r, now) || a.i - b.i);
  return arr.map((o) => o.x);
}

/* ---- 按产品口径取候选池（不截断） ---- */
function pool(sid, q) {
  const parts = [...new Set(ck._internal.__bigram ? ck._internal.__bigram(q).split(/\s+/).filter(Boolean) : [])];
  // bigram 没导出，退化为「用 search 的 candidates 数量 + 从 search 拿 hit 顺序」不够用，
  // 所以这里自己算 bigram（与产品同口径：相邻两字 + 英文整词/数字）
  const bg = (s) => {
    const t = String(s || '').toLowerCase();
    const out = [];
    const en = t.match(/[a-z0-9][a-z0-9_.\-]*/g) || [];
    for (const w of en) if (w.length >= 2) out.push(w);
    const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i + 1 < zh.length; i++) out.push(zh.slice(i, i + 2));
    return [...new Set(out.length ? out : parts)];
  };
  const ps = bg(q);
  if (!ps.length) return [];
  const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
  const TAIL = `FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
                WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT -1) t
                JOIN seg s ON s.id = t.rid`;
  const COLS = 's.id, s.seq, s.ts, s.text, COALESCE(s.dup,1) dup, COALESCE(s.pri,0) pri,'
    + ' COALESCE(s.last_hit_ts,0) last_hit_ts, t.score';
  const talk = db.prepare(`SELECT ${COLS} ${TAIL} WHERE s.sid=? AND s.kind IN ('user','assistant')
      AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1`);
  // 只保留库里真有的 bigram（df>0），否则 AND 必然 0 条
  // ⚠️⚠️ fts5vocab 的列名是 `cnt` 不是 `count`（踩过：写成 count 报 "no such column"）；
  //   而且**必须三参** ('main','seg_fts','row')，两参在 temp 下报 no such fts5 table。
  //   两张表（temp.wd_vocab / temp.wv）不能混用：各自建一次即可。
  let live = ps;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.wv USING fts5vocab('main','seg_fts','row')");
    const dfSt = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
    live = ps.filter((p) => { const r = dfSt.get(p.toLowerCase()); return r && Number(r.cnt) > 0; });
  } catch (e) { /* 词表不可用就全用 */ }
  let rows = [], via = 'none';
  try {
    if (live.length && live.length === ps.length) {
      rows = talk.all(live.length === 1 ? esc(live[0]) : live.map(esc).join(' AND '), sid); via = 'AND';
    }
    if (!rows.length && live.length) { rows = talk.all(live.map(esc).join(' OR '), sid); via = 'OR'; }
    if (!rows.length) {
      const like = db.prepare(`SELECT id, seq, ts, text, 1 AS dup, COALESCE(pri,0) pri,
           COALESCE(last_hit_ts,0) last_hit_ts, 0 AS score FROM seg
           WHERE sid=? AND kind IN ('user','assistant') AND COALESCE(noise,0)=0
             AND COALESCE(pri,0)>=1 AND text LIKE ? ORDER BY ts DESC LIMIT 300`);
      rows = like.all(sid, '%' + String(q).trim() + '%'); if (rows.length) via = 'LIKE';
    }
  } catch (e) { return []; }
  // OR 路径：按 IDF 加权覆盖率定名次（名次制，不换位）
  if (via === 'OR' && live.length > 1) {
    const w = new Map();
    let total = 1;
    try { total = Number(db.prepare('SELECT COUNT(*) c FROM seg WHERE sid=?').get(sid).c) || 1; } catch (_) {}
    const dfSt = db.prepare('SELECT cnt FROM temp.wv WHERE term=?');
    for (const p of live) {
      let df = 1;
      try { const r = dfSt.get(p.toLowerCase()); if (r) df = Number(r.cnt) || 1; } catch (_) {}
      w.set(p, Math.log(1 + total / (1 + df)));
    }
    const wSum = live.reduce((s, p) => s + w.get(p), 0) || 1;
    const scored = rows.map((r) => {
      let got = 0;
      const t = String(r.text || '');
      for (const p of live) if (t.indexOf(p) >= 0) got += w.get(p);
      return { r, cov: got / wSum };
    }).filter((x) => x.cov > 0);
    const order = scored.sort((a, b) => b.cov - a.cov || a.r.score - b.r.score);
    // ⚠️ OR 路径走名次制：rel = 名次（不是覆盖率，覆盖率是阶梯分布不能比大小）
    return { items: order.map((x, i) => ({ r: x.r, rel: i })), rankMode: true };
  }
  return { items: rows.map((r) => ({ r, rel: Number(r.score) || 0 })), rankMode: false };
}

/* ---- 跑对比 ---- */
const now = Date.now();
const groups = {
  'latest（问最新/现在）': ['TP02', 'TP03', 'TP06', 'TP07', 'TP08', 'TP09', 'TP11', 'NU01'],
  'earliest（问最早/当初）': ['TP01', 'TP04', 'TP05', 'TP10', 'TP12'],
  'temporal 其余': ['T01', 'T02', 'T03', 'T04', 'T05'],
};

function evalSet(ids, rankTie, fixGroup) {
  let ok = 0, n = 0;
  const missIds = [];
  for (const c of ALL) {
    if (ids.indexOf(c.id) < 0) continue;
    if (!c.gold || !c.gold.length) continue;
    n++;
    const pooled = pool(c.sid, c.q);
    const out = rerank(pooled.items, now, rankTie, pooled.rankMode, fixGroup);
    const seqs = out.slice(0, c.k).map((x) => Number(x.r.seq));
    const hit = c.gold.filter((g) => seqs.indexOf(g) >= 0).length;
    if (hit >= (c.minHit || 1)) ok++; else missIds.push(c.id);
  }
  return { ok, n, rate: n ? ok / n : 0, missIds };
}

console.log('「并列组内新鲜度换位」开关对比（top-k 与产品同口径）');
console.log('='.repeat(88));
console.log('  分组                        n   纯相关   +换位(现状)   +换位(修分组bug)');
for (const [name, ids] of Object.entries(groups)) {
  const a0 = evalSet(ids, 0, false);
  const a1 = evalSet(ids, RANK_TIE, false);
  const a2 = evalSet(ids, RANK_TIE, true);
  const d1 = (a1.rate - a0.rate) * 100, d2 = (a2.rate - a0.rate) * 100;
  console.log('  ' + name.padEnd(26) + String(a0.n).padStart(3)
    + (a0.rate * 100).toFixed(1).padStart(9) + '%'
    + ((a1.rate * 100).toFixed(1) + '%').padStart(13)
    + ((a2.rate * 100).toFixed(1) + '%').padStart(16)
    + '   Δ现状' + (d1 >= 0 ? '+' : '') + d1.toFixed(1)
    + ' / Δ修后' + (d2 >= 0 ? '+' : '') + d2.toFixed(1));
}
console.log('='.repeat(88));
const allIds = ALL.filter((c) => (c.gold || []).length).map((c) => c.id);
const a0 = evalSet(allIds, 0, false), a1 = evalSet(allIds, RANK_TIE, false), a2 = evalSet(allIds, RANK_TIE, true);
console.log('  全体正例 ' + a0.n + ' 条：');
console.log('    纯相关性排序（关换位）      ' + (a0.rate * 100).toFixed(1) + '%');
console.log('    + 换位（产品现状，含分组bug）' + (a1.rate * 100).toFixed(1) + '%   Δ '
  + ((a1.rate - a0.rate) * 100 >= 0 ? '+' : '') + ((a1.rate - a0.rate) * 100).toFixed(1) + 'pp');
console.log('    + 换位（修掉分组bug）        ' + (a2.rate * 100).toFixed(1) + '%   Δ '
  + ((a2.rate - a0.rate) * 100 >= 0 ? '+' : '') + ((a2.rate - a0.rate) * 100).toFixed(1) + 'pp');
console.log('    ⇒ 分组 bug 单独值 ' + ((a2.rate - a1.rate) * 100 >= 0 ? '+' : '') + ((a2.rate - a1.rate) * 100).toFixed(1) + 'pp');

/* 自检：修分组后，rankTie=0 时必须与纯相关性顺序完全一致 */
{
  const c = ALL.find((x) => (x.gold || []).length && x.cat === 'numeric');
  const pooled = pool(c.sid, c.q);
  const off = rerank(pooled.items, now, 0, pooled.rankMode, true).map((x) => x.r.seq);
  // ⚠️ 比较基准必须带上「原始下标」做次序兜底 —— 产品里是 `a.rel - b.rel || a.i - b.i`。
  const raw = pooled.items.map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.rel - b.x.rel || a.i - b.i).map((o) => o.x.r.seq);
  console.log('\n自检 修分组后 rankTie=0 顺序一致: ' + (JSON.stringify(off) === JSON.stringify(raw) ? '✅' : '❌ 复刻有误'));
  // 反证：现状（不修）应该失败 —— 如果这里也「一致」，说明我没复现出 bug
  const offBad = rerank(pooled.items, now, 0, pooled.rankMode, false).map((x) => x.r.seq);
  console.log('反证 现状 rankTie=0 顺序打乱: ' + (JSON.stringify(offBad) === JSON.stringify(raw) ? '❌ 没复现出 bug' : '✅ 已复现'));
  console.log('自检 样本池大小: ' + pooled.items.length + ' 条（' + c.id + '） rankMode=' + pooled.rankMode);
}

/* 逐题明细：谁被换位救活 / 谁被换位害死 */
{
  const saved = a0.missIds.filter((x) => a2.missIds.indexOf(x) < 0);
  const killed = a2.missIds.filter((x) => a0.missIds.indexOf(x) < 0);
  const savedByBugfix = a1.missIds.filter((x) => a2.missIds.indexOf(x) < 0);
  console.log('\n== 换位+修bug 救活的题（' + saved.length + '）: ' + (saved.join(' ') || '无'));
  console.log('== 换位+修bug 害掉的题（' + killed.length + '）: ' + (killed.join(' ') || '无'));
  console.log('== 仅靠修分组bug 救回的题（' + savedByBugfix.length + '）: ' + (savedByBugfix.join(' ') || '无'));
}
