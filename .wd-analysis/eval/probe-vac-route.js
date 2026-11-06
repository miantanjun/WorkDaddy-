/* 诊断十：跨会话「路由」能不能命中答案所在会话？（决定 0/9 的真实解法）
 *
 * 前面的结论链：
 *   ① 单会话内加阈值 ⇒ 无解（错会话 vs 对会话 covW 间隔 −0.186，分布重叠）
 *   ② 但 v3 已索引全部会话 ⇒ 真正该做的不是「拒答」，而是「这条在另一个会话」
 *   ③ 正例的 gold 在别的会话出现 0% ⇒ 跨会话根本没有串门噪声
 *
 * 本脚本量化 ②：把检索结果按会话聚合，看「答案会话」能否排第一。
 * 判据（不依赖 gold seq，用人工标注的答案会话）：
 *   routeHit@1 = 跨会话聚合后，第一名会话 == 答案会话
 *   routeHit@2 = 前两名里包含答案会话
 *
 * ⚠️ 只读，不改产品。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

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

/* 人工核对的「答案真实所在会话」（依据 why 字段 + 上面跨会话命中的文本确认） */
const ANSWER_SID = {
  CX02: 'APP', CX04: 'APP', CX06: 'WD', CX08: '画册', CX10: 'WD',
  XC01: '画册', XC02: 'WD', XC03: 'APP', XC04: '画册',
};

const stmt = db.prepare(
  `SELECT s.sid, s.seq, s.text, s.ts, t.score
     FROM (SELECT rowid AS rid, bm25(seg_fts) AS score FROM seg_fts
            WHERE seg_fts MATCH ? ORDER BY bm25(seg_fts) LIMIT 600) t
     JOIN seg s ON s.id = t.rid
    WHERE s.kind IN ('user','assistant') AND COALESCE(s.noise,0)=0 AND COALESCE(s.pri,0)>=1
    ORDER BY t.score LIMIT 60`
);
const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';

/* ⚠️ 这个 stmt 的 LIMIT 是硬编码的，只能传 1 个参数（MATCH 表达式）。
   第一版在这里多传了一个 lim ⇒ "Too many parameter values" ⇒ 被 catch 吞成 [] ⇒
   所有题都显示「未命中」，看起来像「路由完全做不到」。诊断脚本里的 catch 绝不能静默。 */
function crossRows(q) {
  const parts = [...new Set(String(ck.bigram(q)).split(/\s+/).filter(Boolean))];
  if (!parts.length) return [];
  return stmt.all(parts.map(esc).join(' OR '));
}

/* 按会话聚合：sessionScore = 该会话前 3 条 bm25 的和（越负越相关） */
function rankSessions(rows) {
  const g = new Map();
  for (const r of rows) {
    if (!g.has(r.sid)) g.set(r.sid, []);
    g.get(r.sid).push(r);
  }
  const out = [];
  for (const [sid, list] of g) {
    const top3 = list.slice(0, 3);
    out.push({ sid, name: NAME[sid] || sid.slice(0, 8), n: list.length, score: top3.reduce((s, x) => s + Number(x.score), 0) / top3.length, best: top3[0] });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

console.log('=== 配对负例：跨会话会话级路由 ===');
let at1 = 0, at2 = 0;
for (const c of PN) {
  const rows = crossRows(c.q);
  const sess = rankSessions(rows);
  const want = ANSWER_SID[c.id];
  const wantSid = SID[want];
  const pos = sess.findIndex((s) => s.sid === wantSid) + 1;
  if (pos === 1) at1++;
  if (pos > 0 && pos <= 2) at2++;
  console.log('  ' + c.id.padEnd(5) + ' 应去=' + want.padEnd(3) + ' 实际排名=' + (pos || '未命中')
    + (pos === 1 ? ' ✅' : pos === 2 ? ' 🟡' : ' ❌')
    + '   | 排行: ' + sess.map((s, i) => (i + 1) + '.' + s.name + '(' + s.score.toFixed(1) + ')').join(' '));
  if (pos === 1) {
    console.log('        ★ ' + String(sess[0].best.text || '').replace(/\s+/g, ' ').slice(0, 90));
  }
}
console.log('\n  路由命中：@1 = ' + at1 + '/9 · @2 = ' + at2 + '/9');

/* 对照：正例做同样的跨会话会话级路由，看会不会把本会话排第一 */
console.log('\n=== 对照：109 条正例的会话级路由（本会话应排第一）===');
let self1 = 0;
const misses = [];
for (const c of P) {
  const rows = crossRows(c.q);
  const sess = rankSessions(rows);
  const pos = sess.findIndex((s) => s.sid === c.sid) + 1;
  if (pos === 1) self1++;
  else misses.push({ id: c.id, pos, name: NAME[c.sid], top: sess[0] && sess[0].name });
}
console.log('  本会话排名第一：' + self1 + '/109 (' + (100 * self1 / 109).toFixed(1) + '%)');
const byTop = {};
for (const m of misses) byTop[m.top] = (byTop[m.top] || 0) + 1;
console.log('  未排第一的 ' + misses.length + ' 条，第一名被谁占了：'
  + Object.keys(byTop).map((k) => k + '=' + byTop[k]).join(' '));

/* 关键：若按「跨会话提示」阈值 —— 只在"别的会话明显更强"时提示 */
console.log('\n=== 提示阈值扫描：别的会话分数优于本会话多少才提示 ===');
console.log('  规则：elsewhere 与 here 的分数差 < -Δ 才提示（bm25 越负越好，故 elsewhere 更负=更强）');
for (const d of [0, 5, 10, 15, 20]) {
  let pnHit = 0, pHit = 0;
  for (const c of PN) {
    const sess = rankSessions(crossRows(c.q));
    const here = sess.find((s) => s.sid === c.sid);
    const best = sess[0];
    if (best && best.sid !== c.sid && here && (best.score - here.score) < -d) pnHit++;
    else if (best && best.sid !== c.sid && !here) pnHit++;
  }
  for (const c of P) {
    const sess = rankSessions(crossRows(c.q));
    const here = sess.find((s) => s.sid === c.sid);
    const best = sess[0];
    if (best && best.sid !== c.sid && here && (best.score - here.score) < -d) pHit++;
    else if (best && best.sid !== c.sid && !here) pHit++;
  }
  console.log('  Δ=' + String(d).padStart(2) + ' ⇒ 配对负例提示 ' + pnHit + '/9 · 正例误提示 ' + pHit + '/109'
    + '  净 ' + (pnHit - pHit));
}
