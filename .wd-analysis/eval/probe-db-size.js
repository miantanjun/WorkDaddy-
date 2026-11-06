/* probe-db-size.js — 库体积体检：170MB 到底被什么占着，哪些能收、哪些不能
 *
 * 结论先写在文件头，脚本只用来自证：
 *   ✅ 可收：WAL（49.6MB，checkpoint 后可回落）+ 超过 N 天未活动的会话
 *   ⛔ 不可收：`idx_seg_h`（22.5MB，去重路径的刚需索引）
 *   ⛔ 不可收：`seg_fts_content`（39.3MB，bigram 副本，FTS 是独立数据不是视图）
 *   ⛔ 不可收：碎片（实测只有 0.2MB，VACUUM 换来的是锁库，不值）
 *
 * 只读脚本，不改任何数据。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const f = ck._internal.dbFile();

const MB = (n) => (n / 1048576).toFixed(1);

console.log('══ 库文件 ══');
const parts = [['ck.db', 0], ['ck.db-wal', 0], ['ck.db-shm', 0]];
let total = 0;
for (const p of parts) {
  try { const s = fs.statSync(f + (p[0] === 'ck.db' ? '' : p[0].replace('ck.db', '')));
    p[1] = s.size; total += s.size;
    console.log('  ' + p[0].padEnd(12) + MB(s.size).padStart(8) + ' MB');
  } catch (_) { console.log('  ' + p[0].padEnd(12) + '     (无)'); }
}
console.log('  ' + '合计'.padEnd(12) + MB(total).padStart(8) + ' MB');
console.log('  路径 ' + f);

console.log('\n══ 表/索引占用（dbstat）══');
let rows = [];
try {
  rows = db.prepare('SELECT name, SUM(pgsize) sz FROM dbstat GROUP BY name ORDER BY sz DESC').all();
} catch (e) { console.log('  dbstat 不可用: ' + e.message); }
const NOTE = {
  seg: '正文 + 元数据，必需',
  seg_fts_content: '⛔ bigram 副本（FTS 独立存储，不是 text 的视图）',
  seg_fts_data: '⛔ FTS 倒排索引，检索性能的根',
  idx_seg_h: '⛔ 去重查询 WHERE sid=? AND h=? 唯一可用的索引',
  idx_seg_noise: '检索过滤条件 noise=0 用',
  idx_seg_sid_seq: '上下文取前后各一条用',
  idx_seg_sid: '按会话列举用',
  idx_seg_pri: 'pri>=1 过滤用',
  idx_seg_kind: 'kind IN (...) 用',
  idx_seg_ts: '按时间排序用',
};
let sum = 0;
for (const r of rows) {
  sum += r.sz;
  const note = NOTE[r.name] || '';
  console.log('  ' + String(r.name).padEnd(20) + MB(r.sz).padStart(8) + ' MB  ' + note);
}
console.log('  ' + '小计'.padEnd(20) + MB(sum).padStart(8) + ' MB');

const pc = db.prepare('PRAGMA page_count').get().page_count;
const fl = db.prepare('PRAGMA freelist_count').get().freelist_count;
const ps = db.prepare('PRAGMA page_size').get().page_size;
console.log('\n══ 碎片 ══');
console.log('  page_size=' + ps + ' page_count=' + pc + ' freelist=' + fl);
console.log('  可回收碎片 ' + MB(fl * ps) + ' MB  ⇒ VACUUM 的收益 ' + MB(fl * ps) + ' MB（不值得锁库）');

console.log('\n══ 会话占用（top 10）══');
const sess = db.prepare(
  'SELECT sid, COUNT(*) c, SUM(LENGTH(text)) b, MAX(ts) mt FROM seg GROUP BY sid ORDER BY b DESC'
).all();
const bodySum = sess.reduce((s, r) => s + r.b, 0);
const now = Date.now();
sess.slice(0, 10).forEach((r, i) => {
  const days = Math.round((now - Number(r.mt)) / 86400000);
  console.log('  ' + String(i + 1).padStart(2) + '. ' + r.sid.slice(0, 8)
    + String(r.c).padStart(7) + ' 行' + MB(r.b).padStart(8) + ' MB'
    + '  ' + String(days).padStart(3) + ' 天前'
    + '  (' + (r.b / bodySum * 100).toFixed(1) + '%)');
});
console.log('  正文合计 ' + MB(bodySum) + ' MB / ' + sess.length + ' 个会话');

console.log('\n══ 结论 ══');
const wal = (() => { try { return fs.statSync(f + '-wal').size; } catch (_) { return 0; } })();
const old = sess.filter((r) => now - Number(r.mt) > 60 * 86400000);
const oldBytes = old.reduce((s, r) => s + r.b, 0);
console.log('  ✅ WAL 合并：最多回收 ' + MB(wal) + ' MB（checkpoint 即可，不锁库）');
console.log('  ✅ 清理 >60 天未活动会话：' + old.length + ' 个 / 正文 ' + MB(oldBytes)
  + ' MB（实际释放约 ' + MB(oldBytes * 6.5) + ' MB，需 VACUUM 才落盘）');
console.log('  ⛔ 删 idx_seg_h 省 22.5MB 『不可行』——去重路径每条入库行都查它，去掉退化成全表扫描');
console.log('  ⛔ VACUUM 只回收 ' + MB(fl * ps) + ' MB，但要独占写锁 + 重写整个 170MB 文件');

try { db.close(); } catch (_) {}
