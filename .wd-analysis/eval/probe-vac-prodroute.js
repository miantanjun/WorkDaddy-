/* 诊断十三：按【生产路径】重测跨会话路由（上一版用裸 OR+bm25 平均值，口径不对）
 *
 * ⚠️⚠️⚠️ 口径教训：上一个探针 probe-vac-scale-route.js 直接拼 FTS OR + bm25 前 3 名平均，
 *   而产品真实路径是 AND 优先 → 0 条才 OR+IDF → 全空退 LIKE，且每条 hit 有 cov/covW。
 *   拿粗糙路径的结论去否定产品能力，等于再次犯「复刻不逐字照抄」的错。
 *   本脚本一律走 ck._internal.search(sid, q, k)，不自己写 SQL。
 *
 * 需要量三件事：
 *   ① 会话级打分用 hit.score（生产值），聚合方式：top1 / top3均值 / topN之和
 *   ② 路由 @1/@2 在 79 会话下的真实值
 *   ③ 全库扫描的耗时（决定这个能力能不能上生产）
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
const db = ck._internal.open();
const SIDS = db.prepare('SELECT sid FROM sessions').all().map((r) => r.sid);

const SID = { WD: '8f92c3fc-ff73-4db1-b104-eb060127daaf', 画册: '96f77df6-452b-4c05-916f-92e30accd72b', APP: '3a1eef3c-382c-4d17-95ae-7b29e230ae68' };
const ANSWER_SID = { CX02: 'APP', CX04: 'APP', CX06: 'WD', CX08: '画册', CX10: 'WD', XC01: '画册', XC02: 'WD', XC03: 'APP', XC04: '画册' };

/* 对一条查询，跑遍全部会话，返回按会话聚合的排名 */
function routeAll(q, k) {
  const K = k || 8;
  const out = [];
  for (const sid of SIDS) {
    let r;
    try { r = ck._internal.search(sid, q, K); } catch (e) { continue; }
    const hits = (r.hits || []).filter((h) => Number.isFinite(Number(h.score)));
    if (!hits.length) continue;
    /* ⚠️ score 是 bm25，越负越相关。产品还会做相关性优先重排，但 hits[] 已按最终顺序。
       这里只用「该会话最好的那一条」的 score —— 会话级排序要单一指标，不做加权，
       描述性统计：也能看到 topN 均值是否更稳。 */
    const sc = hits.map((h) => Number(h.score));
    out.push({
      sid,
      n: hits.length,
      via: r.via,
      top1: sc[0],
      top3: sc.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, sc.length),
      best: hits[0],
    });
  }
  out.sort((a, b) => a.top1 - b.top1);
  return out;
}

const T0 = Date.now();
let calls = 0;

console.log('=== ① 配对负例：生产路径的会话级路由（' + SIDS.length + ' 会话）===');
const agg = { top1: { at1: 0, at2: 0, at3: 0 }, top3: { at1: 0, at2: 0, at3: 0 } };
for (const c of PN) {
  const sess = routeAll(c.q, 8);
  calls += SIDS.length;
  const want = SID[ANSWER_SID[c.id]];
  const p1 = sess.findIndex((s) => s.sid === want) + 1;
  const byT3 = [...sess].sort((a, b) => a.top3 - b.top3);
  const p3 = byT3.findIndex((s) => s.sid === want) + 1;
  if (p1 === 1) agg.top1.at1++;
  if (p1 > 0 && p1 <= 2) agg.top1.at2++;
  if (p1 > 0 && p1 <= 3) agg.top1.at3++;
  if (p3 === 1) agg.top3.at1++;
  if (p3 > 0 && p3 <= 2) agg.top3.at2++;
  if (p3 > 0 && p3 <= 3) agg.top3.at3++;
  console.log('  ' + c.id.padEnd(5) + ' 应去=' + ANSWER_SID[c.id].padEnd(3)
    + ' 按top1排名=' + String(p1 || '未命中').padEnd(4)
    + ' 按top3排名=' + String(p3 || '未命中').padEnd(4)
    + (p1 === 1 ? ' ✅' : '')
    + '  有结果会话=' + sess.length
    + '  Top1=' + (sess[0] ? sess[0].sid.slice(0, 6) + '(' + sess[0].top1.toFixed(1) + ',' + sess[0].via + ')' : '-'));
}
console.log('\n  按 top1：@1=' + agg.top1.at1 + '/9 @2=' + agg.top1.at2 + '/9 @3=' + agg.top1.at3 + '/9');
console.log('  按 top3：@1=' + agg.top3.at1 + '/9 @2=' + agg.top3.at2 + '/9 @3=' + agg.top3.at3 + '/9');

console.log('\n=== ② 正例：本会话能否排第一（生产路径）===');
let s1 = 0, s2 = 0, s3 = 0, s1b = 0;
const misses = [];
for (const c of P) {
  const sess = routeAll(c.q, 8);
  calls += SIDS.length;
  const i1 = sess.findIndex((s) => s.sid === c.sid) + 1;
  if (i1 === 1) s1++;
  if (i1 > 0 && i1 <= 2) s2++;
  if (i1 > 0 && i1 <= 3) s3++;
  const byT3 = [...sess].sort((a, b) => a.top3 - b.top3);
  if (byT3.findIndex((s) => s.sid === c.sid) + 1 === 1) s1b++;
  if (i1 !== 1) misses.push({ id: c.id, i1, top: sess[0] });
}
console.log('  按 top1：@1=' + s1 + '/109 (' + (100 * s1 / 109).toFixed(1) + '%) @2=' + s2 + ' @3=' + s3);
console.log('  按 top3：@1=' + s1b + '/109 (' + (100 * s1b / 109).toFixed(1) + '%)');

const who = {};
for (const m of misses) {
  const k = m.top ? m.top.sid.slice(0, 6) : '-';
  who[k] = (who[k] || 0) + 1;
}
console.log('  未排第一 ' + misses.length + ' 条，被谁占：'
  + Object.keys(who).sort((a, b) => who[b] - who[a]).slice(0, 10).map((k) => k + '=' + who[k]).join(' '));

console.log('\n=== ③ 耗时 ===');
const ms = Date.now() - T0;
console.log('  总调用 ' + calls + ' 次 search，耗时 ' + (ms / 1000).toFixed(1) + 's ⇒ 平均 ' + (ms / calls).toFixed(1) + ' ms/次');
console.log('  ⇒ 单次提问若扫全库：约 ' + (SIDS.length * ms / calls / 1000).toFixed(2) + ' s（' + SIDS.length + ' 会话）');
