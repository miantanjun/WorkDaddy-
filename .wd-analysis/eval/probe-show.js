/* 按 seq 打印原文，用于**逐条核对 gold**
 * 用法：node probe-show.js wd 113 116 2183 ...
 *       node probe-show.js app 236 272
 *       node probe-show.js cat 748 856
 *
 * ⚠️ 扩题时每条 gold 都必须过这一步。凭印象标 seq 是这类评测集最容易出的错，
 *   而且出错不报错 —— 只会让 Recall 凭空变低，然后被误读成「检索坏了」。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const SIDS = {
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
};
const tag = process.argv[2];
const sid = SIDS[tag];
if (!sid) { console.error('用法: node probe-show.js <wd|app|cat> <seq...>'); process.exit(2); }

const st = db.prepare('SELECT seq, kind, COALESCE(pri,0) pri, ts, text FROM seg WHERE sid=? AND seq=?');
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
for (const a of process.argv.slice(3)) {
  const seq = Number(a);
  const r = st.get(sid, seq);
  console.log('\n──────── seq=' + seq + ' ────────');
  if (!r) { console.log('  ❌ 该 seq 不存在'); continue; }
  console.log('  kind=' + r.kind + ' pri=' + r.pri + ' ts=' + (r.ts ? new Date(Number(r.ts)).toISOString().slice(0, 19) : '-'));
  console.log('  ' + one(r.text).slice(0, 700));
}
