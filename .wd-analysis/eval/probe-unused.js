/* 导出「还没被任何题用作 gold」的候选行 —— 造新题时只看这些，避免重复挖同一行
 * 用法：node probe-unused.js [--sid=xxx] [--pri=1|2|all] [--len=60]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');
ck.configure({ dataDir: DATA, log: () => {} });
const db = ck._internal.open();

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}
const SIDS = {
  wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  cat: '96f77df6-452b-4c05-916f-92e30accd72b',
};
const tag = argv.sid || 'wd';
const sid = SIDS[tag];
if (!sid) { console.error('未知 sid: ' + tag); process.exit(2); }

const { ALL } = require('./all-cases.js');
const used = new Set();
for (const c of ALL) if (c.sid === sid) for (const g of (c.gold || [])) used.add(g);

const rows = db.prepare(`
  SELECT seq, kind, COALESCE(pri,0) pri, ts, text
  FROM seg
  WHERE sid = ? AND COALESCE(pri,0) >= 1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant')
  ORDER BY seq`).all(sid);

const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const wantPri = argv.pri === 'all' ? 0 : Number(argv.pri || 0);
const lines = [];
let skipped = 0;
for (const r of rows) {
  if (used.has(r.seq)) { skipped++; continue; }
  if (wantPri && r.pri !== wantPri) continue;
  const txt = one(r.text);
  const n = r.pri === 2 ? 190 : 260;
  lines.push('#' + r.seq + ' p' + r.pri + ' ' + (r.kind === 'user' ? 'U' : 'A') + ' ' + txt.slice(0, n));
}
const dest = path.join(__dirname, 'out', 'unused-' + tag + '.txt');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, lines.join('\n'), 'utf8');
console.log(tag + ' 可见 ' + rows.length + ' 行 / 已用 ' + skipped + ' / 未用 ' + lines.length + ' -> ' + dest);
