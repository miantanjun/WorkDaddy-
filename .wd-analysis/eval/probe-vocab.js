/* 只读：验证 fts5vocab 在本环境能否建、df 能不能读 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

console.log('--- 尝试建 fts5vocab ---');
for (const sql of [
  "CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab('seg_fts','row')",
  'CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab USING fts5vocab(seg_fts, row)',
  'CREATE VIRTUAL TABLE IF NOT EXISTS temp.wd_vocab2 USING fts5vocab(seg_fts)',
]) {
  try { db.exec(sql); console.log('OK  ', sql); } catch (e) { console.log('FAIL', sql, '=>', e.message); }
}

console.log('\n--- 查几个 term ---');
for (const t of ['压缩', '排序', '重启', 'aa', 'su', '260713']) {
  try {
    const r = db.prepare('SELECT doc FROM temp.wd_vocab WHERE term = ?').get(t);
    console.log('  ', t, '=>', r ? r.doc : '(null)');
  } catch (e) {
    console.log('  ', t, 'ERR', e.message);
  }
}

console.log('\n--- 直接跑一次 FTS 看库是否正常 ---');
try {
  const n = db.prepare("SELECT COUNT(*) c FROM seg_fts WHERE seg_fts MATCH '\"压缩\"'").get();
  console.log('  FTS "压缩" 命中', n.c);
} catch (e) { console.log('  FTS ERR', e.message); }

console.log('\n--- VOCAB_SQL 原文 ---');
const src = require('fs').readFileSync(path.join(ROOT, 'scripts', 'ck-memory.js'), 'utf8');
const i = src.indexOf('VOCAB_SQL');
console.log(src.slice(i - 200, i + 400));
