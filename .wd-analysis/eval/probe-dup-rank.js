/* probe-dup-rank.js — 重复会话是否真的影响评测（不是理论污染，是实测）
 * 做法：同一批 126 题，在 "含 3 条重复" 与 "删掉 2 条重复" 两个库上跑标准评测。
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));

const mode = process.argv[2] || 'check';
const DATA = path.join(ROOT, '.wd-tmp', 'scaledata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

const DROP = ['2a616066-b61f-480b-93d1-5642d50a1620', '882c357a-6b2a-403b-b66e-43039e07c230'];

if (mode === 'drop') {
  for (const sid of DROP) {
    const before = db.prepare('SELECT COUNT(*) c FROM seg WHERE sid = ?').get(sid).c;
    ck._internal.dropSession(db, sid);
    const after = db.prepare('SELECT COUNT(*) c FROM seg WHERE sid = ?').get(sid).c;
    const s = db.prepare('SELECT COUNT(*) c FROM sessions WHERE sid = ?').get(sid).c;
    console.log('purge', sid.slice(0, 8), '| seg', before, '→', after, '| sessions 残留', s);
  }
  const n = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
  const ns = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  console.log('删除后: 会话', ns, '/ seg', n, '行');
} else {
  const n = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
  const ns = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  console.log('当前: 会话', ns, '/ seg', n, '行');
  const fts = db.prepare('SELECT COUNT(*) c FROM seg_fts').get().c;
  console.log('fts 行', fts);
}
