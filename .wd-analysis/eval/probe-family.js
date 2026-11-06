/* 打印某个指标族在每个 pri>=1 行上的**具体数值**，用于挑选「新旧两版」题的 gold
 * 用法：node probe-family.js app apk
 *       node probe-family.js wd suites
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const SIDS = { wd: '8f92c3fc-ff73-4db1-b104-eb060127daaf', app: '3a1eef3c-382c-4d17-95ae-7b29e230ae68', cat: '96f77df6-452b-4c05-916f-92e30accd72b' };
const FAM = {
  apk: /(\d{1,2},\d{3},\d{3})\s*(?:字节|B)\b/g,
  suites: /(\d{2,3})\s*(?:个)?套件[^\d]{0,14}?(\d{3,5})\s*(?:项)?断言/g,
  ver: /v?(\d\.\d+\.\d+)/g,
  bytes_raw: /(\d{8,9})\s*(?:字节|Bytes)/g,
};
const tag = process.argv[2], fam = process.argv[3];
const sid = SIDS[tag], re = FAM[fam];
if (!sid || !re) { console.error('用法: node probe-family.js <wd|app|cat> <apk|suites|ver|bytes_raw>'); process.exit(2); }

const rows = db.prepare(`
  SELECT seq, COALESCE(pri,0) pri, ts, text FROM seg
  WHERE sid=? AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0 AND kind IN ('user','assistant')
  ORDER BY seq`).all(sid);
const one = (s) => String(s).replace(/\s+/g, ' ');
for (const r of rows) {
  const t = one(r.text);
  re.lastIndex = 0;
  const vals = [];
  let m;
  while ((m = re.exec(t))) vals.push(m[2] !== undefined ? m[1] + '/' + m[2] : m[1]);
  if (!vals.length) continue;
  const d = r.ts ? new Date(Number(r.ts)).toISOString().slice(5, 16).replace('T', ' ') : '-';
  // 打印该值前后 90 字，方便判断它到底在说什么
  const at = t.search(re);
  console.log('seq=' + String(r.seq).padStart(6) + ' p' + r.pri + ' ' + d
    + '  【' + vals.join(' ') + '】'
    + '  …' + t.slice(Math.max(0, at - 70), at + 90).replace(/\s+/g, ' ') + '…');
}
