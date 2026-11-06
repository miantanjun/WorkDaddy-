/* 诊断十二：真实规模下正例「本会话排第一」失败的 36 条，根因是什么？
 *
 * 三种假说，逐一量化：
 *   H1 同项目兄弟会话抢位（d-WorkDaddy 有 13 个会话，话题本就重叠）
 *   H2 重复副本（3 个 13025 行的会话标题完全相同 ⇒ 同一谈话的多份拷贝）
 *   H3 大库 bm25 稀释（整体弱化，不是被某个会话抢走）
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy'), log: () => {} });

const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const db = ck._internal.open();

const meta = new Map();
for (const r of db.prepare('SELECT sid, proj, title, n_seg, last_ts FROM sessions').all()) meta.set(r.sid, r);
const nm = (sid) => {
  const m = meta.get(sid);
  if (!m) return '#' + String(sid).slice(0, 6);
  return '#' + String(sid).slice(0, 6) + '[' + String(m.proj || '').replace('d-WorkBuddy date-', 'D').replace('d-WorkDaddy', 'WDD') + ']';
};

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 1200) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 200`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
function crossRows(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  return stmt.all(parts.map(esc).join(' OR '));
}
function rankSessions(rows) {
  const g = new Map();
  for (const r of rows) { if (!g.has(r.sid)) g.set(r.sid, []); g.get(r.sid).push(r); }
  const out = [];
  for (const [sid, list] of g) {
    const t3 = list.slice(0, 3);
    out.push({ sid, n: list.length, score: t3.reduce((s, x) => s + Number(x.score), 0) / t3.length, best: t3[0] });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

const fails = [];
for (const c of P) {
  const sess = rankSessions(crossRows(c.q));
  const pos = sess.findIndex((s) => s.sid === c.sid) + 1;
  if (pos !== 1) fails.push({ c, sess, pos, here: sess.find((s) => s.sid === c.sid) });
}

console.log('失败正例', fails.length, '/ 109\n');

/* H1：占位者与本会话是否同项目 */
let sameProj = 0, diffProj = 0, noHere = 0;
const projStat = {};
for (const f of fails) {
  if (!f.here) { noHere++; continue; }
  const top = f.sess[0];
  const mp = meta.get(f.c.sid), tp = meta.get(top.sid);
  const same = mp && tp && mp.proj === tp.proj;
  if (same) sameProj++; else diffProj++;
  const key = same ? 'SAME_PROJ' : 'DIFF_PROJ';
  projStat[key] = (projStat[key] || 0) + 1;
}
console.log('=== H1 同项目抢位 ===');
console.log('  占位者同项目:', sameProj, '｜跨项目:', diffProj, '｜本会话压根没进榜:', noHere);
console.log('  ⇒ 同项目占', (100 * sameProj / (sameProj + diffProj || 1)).toFixed(0), '%');

/* H2：占位者与本会话标题是否相同（重复副本） */
let sameTitle = 0;
for (const f of fails) {
  const top = f.sess[0];
  if (!top) continue;
  const mp = meta.get(f.c.sid), tp = meta.get(top.sid);
  if (mp && tp && String(mp.title || '') === String(tp.title || '')) sameTitle++;
}
console.log('\n=== H2 重复副本 ===');
console.log('  占位者标题与本会话完全相同:', sameTitle, '/', fails.length);

/* H3：分数差距有多大 —— 是"差一点"还是"差很远" */
const gaps = fails.filter((f) => f.here).map((f) => f.here.score - f.sess[0].score).sort((a, b) => b - a);
console.log('\n=== H3 差距分布（here − top1，越接近 0 越可惜）===');
if (gaps.length) {
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
  console.log('  n=' + gaps.length, 'p10=' + q(0.1).toFixed(2), 'p50=' + q(0.5).toFixed(2), 'p90=' + q(0.9).toFixed(2));
  console.log('  |差| < 1 分的:', gaps.filter((g) => g > -1).length,
    '｜< 3 分:', gaps.filter((g) => g > -3).length,
    '｜< 10 分:', gaps.filter((g) => g > -10).length);
}

/* 逐条列出，看占位者到底在讲什么 */
console.log('\n=== 逐条明细（前 20）===');
fails.slice(0, 20).forEach((f) => {
  const top = f.sess[0];
  console.log(f.c.id.padEnd(12), '排名' + String(f.pos).padEnd(3),
    'here=' + (f.here ? f.here.score.toFixed(1) : 'N/A'),
    'top1=' + (top ? top.score.toFixed(1) : '-'),
    'top1会话=' + (top ? nm(top.sid) : '-'));
  if (top && top.best) console.log('    top1命中文本: ' + String(top.best.text || '').replace(/\s+/g, ' ').slice(0, 100));
  if (f.here && f.here.best) console.log('    本会话最佳  : ' + String(f.here.best.text || '').replace(/\s+/g, ' ').slice(0, 100));
});
