// 导出用于人工出题的素材：每个会话挑「回合末结论」中最有辨识度的若干条
const path = require('path');
const fs = require('fs');
const DB = path.join(process.env.APPDATA, 'WorkDaddy', 'ck-memory', 'ck.db');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB, { readOnly: true });
const out = [];
const sids = db.prepare('SELECT sid, COUNT(*) n FROM seg WHERE COALESCE(pri,0)>=1 GROUP BY sid ORDER BY n DESC').all();
for (const s of sids) {
  const rows = db.prepare(
    `SELECT id, seq, role, pri, ts, text FROM seg
      WHERE sid = ? AND COALESCE(pri,0)>=1 AND LENGTH(text) BETWEEN 80 AND 700
        AND COALESCE(noise,0)=0
        AND text NOT LIKE '%429%' AND text NOT LIKE '%ECONNREFUSED%'
        AND text NOT LIKE '%500 internal server error%'
        AND text NOT LIKE '%no available account%'
      ORDER BY seq`
  ).all(s.sid);
  out.push({ sid: s.sid, n: rows.length });
  console.log('=== ' + s.sid.slice(0, 8) + ' (' + rows.length + ') ===');
  for (const r of rows.slice(0, 60)) {
    console.log('[' + r.id + '|seq=' + r.seq + '|p' + r.pri + '|' + new Date(r.ts).toISOString().slice(0, 10) + '] ' + r.text.replace(/\s+/g, ' ').slice(0, 220));
  }
}
db.close();
