/* 路由分布探针 —— 109 道正例题各走 AND / OR / LIKE 哪一路？
 *
 * 动机（这是本脚本存在的唯一理由）：
 *   全套排序改动（RANK_TIE=0、REL_TIE、rankKey 换位）都在两条路径上跑，
 *   但 AND 与 OR **用到的东西根本不同**：
 *     · OR：以「覆盖率」定名次 ⇒ rel 是全池离散的整数名次 ⇒ 组跨度/并列都在这上面算
 *     · AND：rel 是 bm25 连续分 ⇒ 走的是「分数跨度 × REL_TIE」那条分支
 *   如果 109 题里只有 1 题走 AND，那么过去所有 A/B 结论都只证明了 OR 那半边，
 *   而真实短查询恰恰几乎全部走 AND（分词少 ⇒ 全部 bigram 都必然在索引里 ⇒ 必然 AND）。
 *
 * ⚠️ 口径：直接用产品 `ck._internal.search` 返回的 `via`，不复刻路由判断。
 *    副本库 + 不写 last_hit_ts（search 会回写，所以这里只读 via，评测前统一 eval-guard 复位）。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({
  dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'),
  log: () => {},
});

const { ALL, FRESH, isPos } = require('./all-cases.js');

const rows = [];
for (const c of ALL.concat(FRESH)) {
  if (!isPos(c)) continue;
  const r = ck._internal.search(c.sid, c.q, c.k);
  const parts = [...new Set(ck.bigram(c.q).split(/\s+/).filter(Boolean))];
  rows.push({
    id: c.id, cat: c.cat,
    qn: parts.length,
    q: c.q,
    via: r.via || '(err)',
    hits: (r.hits || []).length,
    doc: (r.miss ? r.miss : null),
  });
}

const byVia = {};
for (const r of rows) byVia[r.via] = (byVia[r.via] || 0) + 1;
console.log('正例题总数 ' + rows.length);
console.log('路由分布：' + JSON.stringify(byVia));
console.log('');

/* bigram 个数分布 —— 这是能否走 AND 的**唯一**结构性原因 */
console.log('查询 bigram 个数分布：');
const byQn = {};
for (const r of rows) byQn[r.qn] = (byQn[r.qn] || 0) + 1;
for (const k of Object.keys(byQn).sort((a, b) => a - b)) {
  console.log('  ' + k + ' 个 bigram：' + byQn[k] + ' 题');
}
console.log('');

const ands = rows.filter((r) => r.via === 'AND');
console.log('走 AND 的题（' + ands.length + ' 道）：');
for (const r of ands) console.log('  ' + r.id + ' [' + r.cat + '] ' + r.qn + 'bg  ' + r.q);

const ors = rows.filter((r) => r.via === 'OR');
console.log('');
console.log('走 OR 的题里 bigram 最少的 10 道（离 AND 最近的）：');
ors.sort((a, b) => a.qn - b.qn).slice(0, 10)
  .forEach((r) => console.log('  ' + r.id + ' ' + r.qn + 'bg  ' + r.q));
