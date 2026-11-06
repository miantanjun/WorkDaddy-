/* 探查评测库：会话清单 + 每个会话的规模与时间跨度
 * 目的：扩题前先确认「还有哪些素材」（现在只用了 3 个会话，库里远不止这些）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

console.log('== 会话清单 ==');
const rows = db.prepare(`
  SELECT sid, COUNT(*) n, SUM(LENGTH(text)) chars,
         MIN(ts) t0, MAX(ts) t1,
         SUM(CASE WHEN COALESCE(pri,0)=0 THEN 1 ELSE 0 END) pri0,
         SUM(CASE WHEN kind='user' THEN 1 ELSE 0 END) usr
  FROM seg GROUP BY sid ORDER BY n DESC`).all();
const fmt = (t) => (t ? new Date(Number(t)).toISOString().slice(0, 10) : '-');
console.log('  sid                                    seg    字符   起  -  止    user  pri0');
for (const r of rows) {
  console.log('  ' + String(r.sid).padEnd(38) + String(r.n).padStart(6)
    + String(r.chars || 0).padStart(9) + '  ' + fmt(r.t0) + ' - ' + fmt(r.t1)
    + String(r.usr || 0).padStart(7) + String(r.pri0 || 0).padStart(7));
}
console.log('  合计 ' + rows.length + ' 个会话 / ' + rows.reduce((s, r) => s + r.n, 0) + ' 条 seg');

console.log('\n== 事实/实体规模 ==');
try { console.log('  fact 总数: ' + db.prepare('SELECT COUNT(*) c FROM fact').get().c); } catch (e) { console.log('  fact: ' + e.message); }
try {
  const f = db.prepare('SELECT sid, COUNT(*) n FROM fact GROUP BY sid ORDER BY n DESC').all();
  for (const r of f) console.log('    ' + String(r.sid).slice(0, 8) + '… ' + r.n);
} catch (_) {}
try { console.log('  ent 总数: ' + db.prepare('SELECT COUNT(*) c FROM ent').get().c); } catch (e) { console.log('  ent: ' + e.message); }
