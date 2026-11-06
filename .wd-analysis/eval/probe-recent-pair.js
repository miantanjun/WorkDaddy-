/* 为「时效题」找成对素材：同一指标的最早 / 最新两次记录（都必须是 pri>=1）
 *
 * ⚠️⚠️⚠️ 硬约束：默认检索带 `AND COALESCE(pri,0) >= 1`，
 *   所以 gold 若落在 pri=0 的行上，**永远不可能被召回** ——
 *   那不是题难，是题错。造题前必须先用这个脚本确认每对端点都 pri>=1。
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
const tag = process.argv[2] || 'wd';
const sid = SIDS[tag];
// 只取 pri>=1 且非 noise、非 tool 的行 —— 这才是产品实际能返回的集合
const rows = db.prepare(`
  SELECT seq, kind, COALESCE(pri,0) pri, ts, text FROM seg
  WHERE sid=? AND COALESCE(pri,0)>=1 AND COALESCE(noise,0)=0
    AND kind IN ('user','assistant')
  ORDER BY seq`).all(sid);
const one = (s) => String(s).replace(/\s+/g, ' ');

const FAM = [
  { n: '套件/断言', re: /(\d{2,3})\s*(?:个)?套件[^\d]{0,14}?(\d{3,5})\s*(?:项)?断言/g },
  { n: '本地版本', re: /(?:v|版本\s*)(1\.\d+\.\d+)/g },
  { n: 'APK字节', re: /(\d{2},\d{3},\d{3})\s*(?:字节|B)/g },
  { n: '网关版本', re: /(v?1\.\d+\.\d+)\s*(?:网关|gateway)|gateway[^\d]{0,8}(\d+\.\d+\.\d+)/gi },
];

for (const f of FAM) {
  const seqs = [];
  for (const r of rows) {
    f.re.lastIndex = 0;
    if (f.re.test(one(r.text))) seqs.push({ seq: r.seq, pri: r.pri, ts: Number(r.ts) || 0 });
  }
  if (!seqs.length) { console.log('\n== ' + f.n + ' == 命中 0'); continue; }
  console.log('\n== ' + f.n + ' == pri>=1 命中 ' + seqs.length + ' 行');
  console.log('  最早 3: ' + seqs.slice(0, 3).map((x) => x.seq + '(p' + x.pri + ')').join(' '));
  console.log('  最新 3: ' + seqs.slice(-3).map((x) => x.seq + '(p' + x.pri + ')').join(' '));
}
