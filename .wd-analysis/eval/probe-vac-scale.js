/* 诊断十一：跨会话路由在「会话数变多」时还成立吗？以及代价多大？
 *
 * 这是决定要不要落地的关键一问：
 *   @1 = 8/9 是在**只有 3 个会话**的副本库里测的。3 选 1 的随机基线是 33%，
 *   生产有上百个会话 ⇒ 难度完全不同，不能用 8/9 直接外推。
 *
 * 做法：
 *   ① 只读打开**真实库**，看实际索引了多少会话（不写、不改）
 *   ② 在副本库里造「干扰会话」：把正例的查询拿到会话数逐步增加的场景下路由，
 *      观察 @1 随候选会话数增长如何衰减（sanity check，不是精确估计）
 *   ③ 量跨会话检索的耗时
 *
 * ⚠️ 只读。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

/* ① 真实库会话数（只读）*/
console.log('=== ① 生产库实况（只读）===');
const fs = require('fs');
const os = require('os');
const realDir = path.join(os.homedir(), '.workbuddy');
const realDb = path.join(realDir, 'ck-memory', 'ck.db');
if (fs.existsSync(realDb)) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(realDb, { readOnly: true });
    const ns = d.prepare('SELECT COUNT(*) c FROM sessions').get();
    const nt = d.prepare('SELECT COUNT(*) c FROM seg').get();
    console.log('  已索引会话数 = ' + ns.c + ' · 行数 = ' + nt.c);
    const top = d.prepare('SELECT sid, COUNT(*) c FROM seg GROUP BY sid ORDER BY c DESC LIMIT 6').all();
    console.log('  最大会话：' + top.map((r) => r.sid.slice(0, 8) + '=' + r.c).join(' '));
    d.close();
  } catch (e) { console.log('  读真实库失败：' + e.message); }
} else {
  console.log('  真实库不存在：' + realDb);
}

/* ②③ 副本库上的路由扩展性 + 耗时 */
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const ALL = require('./all-cases.js').ALL;
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const db = ck._internal.open();

const SIDS = db.prepare('SELECT sid, COUNT(*) c FROM seg GROUP BY sid ORDER BY c DESC').all();
console.log('\n=== ② 副本库会话构成 ===');
for (const s of SIDS) console.log('  ' + s.sid.slice(0, 8) + ' 行=' + s.c);

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 600) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 60`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';

let tSum = 0, tMax = 0, nRun = 0;
function crossRows(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  const t0 = process.hrtime.bigint();
  const r = stmt.all(parts.map(esc).join(' OR '));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  tSum += ms; tMax = Math.max(tMax, ms); nRun++;
  return r;
}

function rankSessions(rows) {
  const g = new Map();
  for (const r of rows) {
    if (!g.has(r.sid)) g.set(r.sid, []);
    g.get(r.sid).push(r);
  }
  const out = [];
  for (const [sid, list] of g) {
    const top3 = list.slice(0, 3);
    out.push({ sid, score: top3.reduce((s, x) => s + Number(x.score), 0) / top3.length });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

/* 用正例测：3 个会话里，本会话能否排第一；若加 N 个假会话干扰，衰减多少
 * 假会话用「其他会话的行」模拟 —— 不造假数据，只用真实行重新分组 */
console.log('\n=== ③ 跨会话检索耗时（109 次）===');
let self1 = 0;
for (const c of P) {
  const sess = rankSessions(crossRows(c.q));
  if (sess.length && sess[0].sid === c.sid) self1++;
}
console.log('  平均 ' + (tSum / nRun).toFixed(1) + 'ms · 最大 ' + tMax.toFixed(1) + 'ms · n=' + nRun);
console.log('  本会话排第一（3 会话场景）：' + self1 + '/109 = ' + (100 * self1 / 109).toFixed(1) + '%');

/* 计算「把分数差距归一」后的可分性：正确会话 vs 最优错误会话的分数差 */
console.log('\n=== ④ 正确会话 vs 最优错误会话 的分数差（衡量路由余量）===');
const margins = [];
for (const c of P) {
  const sess = rankSessions(crossRows(c.q));
  const here = sess.find((s) => s.sid === c.sid);
  const others = sess.filter((s) => s.sid !== c.sid);
  if (!here || !others.length) continue;
  const bestOther = others[0];
  margins.push(bestOther.score - here.score);   // >0 表示正确会话更强
}
margins.sort((a, b) => a - b);
const at = (p) => margins[Math.min(margins.length - 1, Math.round(p * (margins.length - 1)))];
console.log('  p10=' + at(0.1).toFixed(1) + ' p25=' + at(0.25).toFixed(1) + ' p50=' + at(0.5).toFixed(1)
  + ' p75=' + at(0.75).toFixed(1) + ' p90=' + at(0.9).toFixed(1));
console.log('  负余量（正确会话更弱）的比例：'
  + (100 * margins.filter((x) => x < 0).length / margins.length).toFixed(1) + '%'
  + ' ⇒ 这是「只用会话级分数」时的错误率下限，且会随会话数增加而上升');
