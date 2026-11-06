/* probe-remote-recall.js — 很久以前的记忆还能不能找回（只读）
 *
 * 设计前提：不跨会话，每个会话只查自己。
 * 那么真正要验的就是：同一条会话里，最早的内容（隔了几十天）
 * 还能不能被检索命中，且不被后期的海量内容挤死。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const fd = (ms) => { const d = new Date(Number(ms)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 挑几个跨时最长的会话，取它们【最早】的用户原话当查询
const sids = db.prepare(`
  SELECT sid, title, first_ts, last_ts,
    (SELECT COUNT(*) FROM seg g WHERE g.sid=s.sid) n
  FROM sessions s
  WHERE (last_ts-first_ts) > 15*86400000
  ORDER BY (last_ts-first_ts) DESC
`).all();

console.log('=== 用「每个会话最早的原话」当查询，看能否命中它自己 ===\n');
let total = 0, ok = 0, rankSum = 0;
for (const s of sids) {
  // 取最早 3 条够长的用户发言，选第一条
  const early = db.prepare(`
    SELECT seq, ts, text FROM seg
     WHERE sid=? AND kind='user' AND COALESCE(pri,0)=2
       AND LENGTH(text) BETWEEN 8 AND 60
     ORDER BY ts ASC LIMIT 5
  `).all(s.sid);
  if (!early.length) continue;
  const q = String(early[0].text).replace(/\s+/g, ' ').trim();
  total++;

  const r = ck._internal.search(s.sid, q, 10, false);
  const hits = r.hits || [];
  // 这条原始记录是否出现在结果里（按 text 前缀比对）
  const probe = q.slice(0, 24);
  let rank = -1;
  for (let i = 0; i < hits.length; i++) {
    if (String(hits[i].text || '').replace(/\s+/g, ' ').indexOf(probe) >= 0) { rank = i + 1; break; }
  }
  if (rank > 0) { ok++; rankSum += rank; }
  console.log(`会话 ${s.sid.slice(0, 8)}  ${fd(s.first_ts)}→${fd(s.last_ts)}  共${s.n}条`);
  console.log(`  查「${q.slice(0, 46)}」`);
  console.log(`  → ${hits.length} 命中  via=${r.via}  ` + (rank > 0 ? `目标排第 ${rank}` : '目标未进前 10'));
  console.log('');
}
console.log(`===== ${total} 个长跨度会话：目标进前10 的 ${ok} 个，平均名次 ${ok ? (rankSum / ok).toFixed(1) : '-'} =====`);
