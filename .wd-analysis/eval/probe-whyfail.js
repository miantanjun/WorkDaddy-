/* 分类统计失败原因：新题到底是「池内没有」还是「池内排太后」
 *
 * 这是上一轮踩过的关键区分 —— 把「返回条数」当「候选池大小」，
 * 差点走上「加第四路召回」的错误方向。这次先在脚本里复刻 products 的候选池语义
 * （AND → OR → LIKE，内层 LIMIT -1 不截断），再量 gold 的真实名次。
 *
 * 输出四档：
 *   hit        —— 进了前 k
 *   in-pool-late —— 在候选池里，但排在 k 之后（排序问题）
 *   not-in-pool  —— 真的没进候选池（召回问题）
 *   blocked    —— 被 ENX/ID-MISS 拦掉（拦错了，属于判据问题）
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const { ALL } = require('./all-cases.js');
const S = ck._internal.search;

const only = process.argv[2];   // 可选：只看某类别，如 numeric
const list = ALL.filter((c) => (c.gold || []).length && (!only || c.cat === only));

const buckets = { hit: [], late: [], missing: [], blocked: [] };
for (const c of list) {
  const r = S(c.sid, c.q, c.k);
  const via = r.via;
  const hits = r.hits || [];
  const cand = r.candidates || 0;
  if (via === 'ENT-MISS' || via === 'ID-MISS') { buckets.blocked.push({ c, via }); continue; }
  const seqs = hits.map((h) => h.seq);
  const ranks = c.gold.map((g) => { const i = seqs.indexOf(g); return i < 0 ? 0 : i + 1; });
  const best = ranks.filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
  const want = c.minHit || 1;
  if (ranks.filter((x) => x > 0).length >= want) buckets.hit.push({ c, best, cand, via });
  else if (cand > 0) buckets.late.push({ c, cand, via, got: seqs.slice(0, 6), ranks });
  else buckets.missing.push({ c, cand, via });
}

const p = (n) => ((n / list.length) * 100).toFixed(1) + '%';
console.log('类别=' + (only || 'all') + '  正例 ' + list.length + ' 条\n');
console.log('  ✅ 命中            ' + String(buckets.hit.length).padStart(3) + '  ' + p(buckets.hit.length));
console.log('  🟡 池内有但排太后  ' + String(buckets.late.length).padStart(3) + '  ' + p(buckets.late.length));
console.log('  🔴 真没进候选池    ' + String(buckets.missing.length).padStart(3) + '  ' + p(buckets.missing.length));
console.log('  ⛔ 被拦截器挡掉    ' + String(buckets.blocked.length).padStart(3) + '  ' + p(buckets.blocked.length));

if (buckets.late.length) {
  console.log('\n== 池内但排太后（排序问题，不是召回问题）==');
  for (const x of buckets.late) {
    console.log('  ' + x.c.id.padEnd(5) + ' cand=' + String(x.cand).padStart(5) + ' via=' + x.via
      + ' gold=' + x.c.gold.join(',') + ' got=' + x.got.join(','));
  }
}
if (buckets.missing.length) {
  console.log('\n== 真的没进候选池（召回问题）==');
  for (const x of buckets.missing) console.log('  ' + x.c.id.padEnd(5) + ' via=' + x.via + ' q=' + x.c.q);
}
if (buckets.blocked.length) {
  console.log('\n== 被拦截器挡掉（拦错 = 判据问题）==');
  for (const x of buckets.blocked) console.log('  ' + x.c.id.padEnd(5) + ' via=' + x.via + ' q=' + x.c.q);
}
