/* 导出候选素材索引：pri>=1 的行（用户发言 + 回合末结论），带 seq 与短预览
 * 目的：扩题必须基于真实内容，先造索引再人工挑题，而不是凭空编。
 *
 * 用法：node probe-material.js [--sid=xxx] [--out=file]
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
  '8f92c3fc': '8f92c3fc-ff73-4db1-b104-eb060127daaf',
  '3a1eef3c': '3a1eef3c-382c-4d17-95ae-7b29e230ae68',
  '96f77df6': '96f77df6-452b-4c05-916f-92e30accd72b',
};
const only = argv.sid ? SIDS[argv.sid] : null;
if (argv.sid && !only) { console.error('未知 sid: ' + argv.sid); process.exit(2); }

const rows = db.prepare(`
  SELECT id, sid, seq, kind, COALESCE(pri,0) pri, ts, text
  FROM seg
  WHERE sid = ? AND COALESCE(pri,0) >= 1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant')
  ORDER BY seq`).all(only || SIDS['8f92c3fc']);

const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const lines = [];
for (const r of rows) {
  const txt = one(r.text);
  // 用户发言给足预览（题目素材多半来自这里）；assistant 结论给长一点（含数字）
  const n = r.pri === 2 ? 150 : 220;
  lines.push(`#${r.seq} p${r.pri} ${r.kind === 'user' ? 'U' : 'A'} ${txt.slice(0, n)}`);
}
const out = lines.join('\n');
const dest = argv.out ? path.resolve(ROOT, argv.out)
  : path.join(__dirname, 'out', 'material-' + (argv.sid || 'wd') + '.txt');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');
console.log('sid=' + (argv.sid || '8f92c3fc') + ' 行数=' + rows.length
  + ' 字符=' + out.length + ' -> ' + dest);
