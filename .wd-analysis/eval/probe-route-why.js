/* 诊断十四：跨会话路由为什么不成立 —— 量纲错配 + 长度偏置
 *
 * 前两个探针给出矛盾结果（裸 OR 6/9 vs 生产路径 3/9），根因是**口径**：
 *   · 产品 OR 路径排序主序是 cov（IDF 加权覆盖率），cov 是**会话内相对量纲**
 *     （分母是该会话候选集合），跨会话相加/比较没有意义。
 *   · hits[0].score 是 bm25（跨会话可比），但被**文档长度偏置**：短行天然分高。
 *
 * 本脚本量化三件事：
 *   ① 长度偏置有多大：占位会话的平均行长 vs 正确会话
 *   ② 长度归一化后（score / sqrt(len) 等）路由能不能救回来
 *   ③ 便宜的落地方案（一条全局 FTS 查询 + 会话聚合）的真实上限
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

const SID = { WD: '8f92c3fc-ff73-4db1-b104-eb060127daaf', 画册: '96f77df6-452b-4c05-916f-92e30accd72b', APP: '3a1eef3c-382c-4d17-95ae-7b29e230ae68' };
const ANSWER_SID = { CX02: 'APP', CX04: 'APP', CX06: 'WD', CX08: '画册', CX10: 'WD', XC01: '画册', XC02: 'WD', XC03: 'APP', XC04: '画册' };

/* 全局一条 FTS 查询（这是唯一便宜的方案：一次 SQL，不按会话循环） */
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

/* 多种会话级打分，全部只用全局一次查询的结果 */
const NORM = {
  'raw-min': (r) => Number(r.score),                                  // 原始 bm25（越负越强）
  'div-sqrt(len)': (r) => Number(r.score) / Math.sqrt(Math.max(1, r.len) / 100),
  'div-len': (r) => Number(r.score) / Math.max(1, r.len / 100),
  'plus-len': (r) => Number(r.score) + 0.02 * Math.log(1 + r.len / 100), // 往正确方向修正
};

function rankBy(rows, fn, topN) {
  const g = new Map();
  for (const r of rows) {
    const v = fn(r);
    if (!g.has(r.sid)) g.set(r.sid, []);
    g.get(r.sid).push({ r, v });
  }
  const out = [];
  for (const [sid, list] of g) {
    list.sort((a, b) => a.v - b.v);
    const t = list.slice(0, topN || 3);
    out.push({ sid, score: t.reduce((s, x) => s + x.v, 0) / t.length, n: list.length, best: list[0].r });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

console.log('=== ① 长度偏置：占位会话 vs 正确会话 ===');
let accLen = [], rivalLen = [];
for (const c of P) {
  const rows = globalRows(c.q);
  if (!rows.length) continue;
  const sess = rankBy(rows, NORM['raw-min'], 3);
  const top = sess[0];
  const here = sess.find((s) => s.sid === c.sid);
  if (!top) continue;
  const topRows = rows.filter((r) => r.sid === top.sid).slice(0, 3);
  const hereRows = rows.filter((r) => r.sid === c.sid).slice(0, 3);
  const avg = (a) => a.reduce((s, x) => s + x.len, 0) / (a.length || 1);
  if (topRows.length) rivalLen.push(avg(topRows));
  if (hereRows.length) accLen.push(avg(hereRows));
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
console.log('  正确会话前3行平均行长中位 =', med(accLen).toFixed(0), '字符（n=' + accLen.length + '）');
console.log('  占位会话前3行平均行长中位 =', med(rivalLen).toFixed(0), '字符（n=' + rivalLen.length + '）');
console.log('  ⇒ 占位者更短?', med(rivalLen) < med(accLen) ? '是（符合长度偏置假说）' : '否');

console.log('\n=== ② 各种会话级打分下的路由效果 ===');
console.log('  打分方式            负例@1  @2  正例@1        耗时');
for (const key of Object.keys(NORM)) {
  const fn = NORM[key];
  const t0 = Date.now();
  let pn1 = 0, pn2 = 0, p1 = 0;
  for (const c of PN) {
    const sess = rankBy(globalRows(c.q), fn, 3);
    const want = SID[ANSWER_SID[c.id]];
    const pos = sess.findIndex((s) => s.sid === want) + 1;
    if (pos === 1) pn1++;
    if (pos > 0 && pos <= 2) pn2++;
  }
  for (const c of P) {
    const sess = rankBy(globalRows(c.q), fn, 3);
    if (sess.length && sess[0].sid === c.sid) p1++;
  }
  console.log('  ' + key.padEnd(20)
    + String(pn1 + '/9').padStart(5) + String(pn2 + '/9').padStart(5)
    + String('  ' + p1 + '/109 (' + (100 * p1 / 109).toFixed(0) + '%)').padEnd(18)
    + ((Date.now() - t0) / 1000).toFixed(1) + 's（126 题）');
}

console.log('\n=== ③ 诊断：cx 系列失败时，答案会话到底排第几（raw-min）===');
for (const c of PN) {
  const sess = rankBy(globalRows(c.q), NORM['raw-min'], 3);
  const want = SID[ANSWER_SID[c.id]];
  const wantSess = sess.find((s) => s.sid === want);
  const pos = sess.findIndex((s) => s.sid === want) + 1;
  console.log('  ' + c.id.padEnd(5) + ' 排名=' + String(pos || '未命中').padEnd(4)
    + ' 应去分=' + (wantSess ? wantSess.score.toFixed(1) : 'N/A').padEnd(8)
    + ' 最优分=' + (sess[0] ? sess[0].score.toFixed(1) : '-').padEnd(8)
    + ' 差=' + (wantSess && sess[0] ? (wantSess.score - sess[0].score).toFixed(1) : '-'));
}
