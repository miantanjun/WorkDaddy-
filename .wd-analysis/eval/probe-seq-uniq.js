/* 验证 seq 在会话内是否唯一 —— 评测集的 gold 全部锚在 seq 上，这不是小事
 *
 * 如果 seq 有重复，同一个 gold 值会同时指向多行，
 * 「命中」二义化：可能命中的是过程话而不是结论行。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

for (const [tag, sid] of Object.entries({
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
})) {
  const dup = db.prepare(
    'SELECT seq, COUNT(*) c FROM seg WHERE sid=? GROUP BY seq HAVING c>1 ORDER BY c DESC LIMIT 5').all(sid);
  const tot = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT seq) d FROM seg WHERE sid=?').get(sid);
  console.log(tag + '  seg 行 ' + tot.c + ' / 不同 seq ' + tot.d + '  ⇒ ' + (tot.c === tot.d ? '唯一 ✅' : '⚠️ 有重复'));
  for (const d of dup) {
    const rows = db.prepare('SELECT id, seq, kind, COALESCE(pri,0) pri, text FROM seg WHERE sid=? AND seq=?').all(sid, d.seq);
    console.log('    seq=' + d.seq + ' 出现 ' + d.c + ' 次:');
    for (const r of rows) console.log('       id=' + r.id + ' kind=' + r.kind + ' pri=' + r.pri + ' 「' + String(r.text).replace(/\s+/g, ' ').slice(0, 70) + '」');
  }
  // 再看 id 与 seq 的关系
  const sample = db.prepare('SELECT id, seq FROM seg WHERE sid=? ORDER BY id LIMIT 5').all(sid);
  console.log('    样本 id/seq: ' + sample.map((r) => r.id + '/' + r.seq).join(' '));
}
