/* 诊断十一：真实规模（79 会话）下，跨会话路由还能不能命中？
 *
 * 上一轮在 **3 个会话** 上得到 @1=8/9、@2=9/9。
 * 但 3 个会话几乎等于「二选一」，必然虚高 —— 生产环境有上百个会话。
 *
 * 本脚本在**回填后的真实规模**（79 会话 / 101k 行，见 probe-backfill-all.js）上重测，
 * 并把干扰会话数量作为自变量：逐步加入 distractor，看 @1 怎么衰减。
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const MODE = process.argv[2] || 'scaled'; // scaled | eval
const DATA = MODE === 'scaled'
  ? path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy')
  : path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });

const ALL = require('./all-cases.js').ALL;
const PN = ALL.filter((c) => c.cat !== 'negative' && !(c.gold || []).length);
const P = ALL.filter((c) => c.cat !== 'negative' && (c.gold || []).length);
const db = ck._internal.open();

const NAME = {
  '8f92c3fc-ff73-4db1-b104-eb060127daaf': 'WD',
  '96f77df6-452b-4c05-916f-92e30accd72b': '画册',
  '3a1eef3c-382c-4d17-95ae-7b29e230ae68': 'APP',
};
const SID = { WD: '8f92c3fc-ff73-4db1-b104-eb060127daaf', 画册: '96f77df6-452b-4c05-916f-92e30accd72b', APP: '3a1eef3c-382c-4d17-95ae-7b29e230ae68' };
const ANSWER_SID = { CX02: 'APP', CX04: 'APP', CX06: 'WD', CX08: '画册', CX10: 'WD', XC01: '画册', XC02: 'WD', XC03: 'APP', XC04: '画册' };

const nSess = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
console.log('数据库:', MODE, '｜会话', nSess, '｜seg', db.prepare('SELECT COUNT(*) c FROM seg').get().c);

/* 会话候选池：seed=3 时只当 3 会话用（复现上一轮），否则全量 */
const nameOf = (sid) => NAME[sid] || ('#' + String(sid).slice(0, 6));

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
  return stmt.all(parts.map(esc).join(' OR ')); // ⚠️ LIMIT 硬编码 ⇒ 只能传 1 个参数
}

function rankSessions(rows, allow) {
  const g = new Map();
  for (const r of rows) {
    if (allow && !allow.has(r.sid)) continue;
    if (!g.has(r.sid)) g.set(r.sid, []);
    g.get(r.sid).push(r);
  }
  const out = [];
  for (const [sid, list] of g) {
    const t3 = list.slice(0, 3);
    out.push({
      sid, name: nameOf(sid), n: list.length,
      score: t3.reduce((s, x) => s + Number(x.score), 0) / t3.length,
      best: t3[0],
    });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

/* ===== ① 配对负例路由 ===== */
console.log('\n=== ① 配对负例：答案会话排名（' + nSess + ' 个会话竞争）===');
let at1 = 0, at2 = 0, at3 = 0;
const detail = [];
for (const c of PN) {
  const sess = rankSessions(crossRows(c.q));
  const wantSid = SID[ANSWER_SID[c.id]];
  const pos = sess.findIndex((s) => s.sid === wantSid) + 1;
  if (pos === 1) at1++;
  if (pos > 0 && pos <= 2) at2++;
  if (pos > 0 && pos <= 3) at3++;
  detail.push({ id: c.id, pos, top: sess[0] });
  console.log('  ' + c.id.padEnd(5) + ' 应去=' + ANSWER_SID[c.id].padEnd(3)
    + ' 排名=' + String(pos || '未命中').padEnd(4)
    + (pos === 1 ? ' ✅' : pos === 2 ? ' 🟡' : ' ❌')
    + '  竞争会话数=' + sess.length
    + '  Top1=' + (sess[0] ? sess[0].name + '(' + sess[0].score.toFixed(1) + ')' : '-'));
}
console.log('\n  路由命中：@1 = ' + at1 + '/9 · @2 = ' + at2 + '/9 · @3 = ' + at3 + '/9');

/* ===== ② 正例：本会话能否排第一 ===== */
console.log('\n=== ② 对照：109 条正例的本会话排名（应排第一）===');
let self1 = 0, self2 = 0, self3 = 0;
const misses = [];
for (const c of P) {
  const sess = rankSessions(crossRows(c.q));
  const pos = sess.findIndex((s) => s.sid === c.sid) + 1;
  if (pos === 1) self1++;
  if (pos > 0 && pos <= 2) self2++;
  if (pos > 0 && pos <= 3) self3++;
  if (pos !== 1) misses.push({ id: c.id, pos, here: nameOf(c.sid), top: sess[0] && sess[0].name });
}
console.log('  本会话 @1 = ' + self1 + '/109 (' + (100 * self1 / 109).toFixed(1) + '%)'
  + ' · @2 = ' + self2 + ' · @3 = ' + self3);
const byTop = {};
for (const m of misses) byTop[m.top] = (byTop[m.top] || 0) + 1;
const topList = Object.keys(byTop).sort((a, b) => byTop[b] - byTop[a]).slice(0, 8);
console.log('  未排第一 ' + misses.length + ' 条，被谁占：' + topList.map((k) => k + '=' + byTop[k]).join(' '));

/* ===== ③ 余量：正确会话 vs 最强错误会话 ===== */
console.log('\n=== ③ 决策余量（会话级分数差，bm25 越负越强）===');
const margins = [];
for (const c of P) {
  const sess = rankSessions(crossRows(c.q));
  const idx = sess.findIndex((s) => s.sid === c.sid);
  if (idx < 0) { margins.push({ id: c.id, m: null }); continue; }
  const here = sess[idx];
  const rival = sess.find((s) => s.sid !== c.sid);
  margins.push({ id: c.id, m: rival ? here.score - rival.score : 99 });
}
const ok = margins.filter((x) => x.m !== null).map((x) => x.m).sort((a, b) => a - b);
const q = (p) => ok[Math.min(ok.length - 1, Math.floor(ok.length * p))];
console.log('  有 rival 的 ' + ok.length + ' 条，here−rival：p10=' + q(0.1).toFixed(2)
  + ' p50=' + q(0.5).toFixed(2) + ' p90=' + q(0.9).toFixed(2));
const neg = ok.filter((x) => x > 0).length;
console.log('  ⚠️ 负余量（here 比 rival 差）= ' + neg + '/' + ok.length + ' = ' + (100 * neg / ok.length).toFixed(1) + '%');

/* ===== ④ 干扰会话数量敏感性：逐步稀释 ===== */
console.log('\n=== ④ 干扰会话数量敏感性（只算 seed 会话 + N 个最强干扰）===');
const seeds = new Set(Object.values(SID));
const allSids = db.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid);
const distractors = allSids.filter((s) => !seeds.has(s));
for (const N of [0, 3, 10, 30, distractors.length]) {
  const allow = new Set([...seeds, ...distractors.slice(0, N)]);
  let a1 = 0;
  for (const c of PN) {
    const sess = rankSessions(crossRows(c.q), allow);
    const wantSid = SID[ANSWER_SID[c.id]];
    if (sess.length && sess[0].sid === wantSid) a1++;
  }
  let s1 = 0;
  for (const c of P) {
    const sess = rankSessions(crossRows(c.q), allow);
    if (sess.length && sess[0].sid === c.sid) s1++;
  }
  console.log('  干扰 +' + String(N).padStart(2) + ' ⇒ 负例@1 = ' + a1 + '/9'
    + ' · 正例@1 = ' + s1 + '/109 (' + (100 * s1 / 109).toFixed(1) + '%)'
    + ' · 池大小 ' + (allow.size) + '（实际有结果的 ' + rankSessions(crossRows(P[0].q), allow).length + ' 视题而定)');
}
