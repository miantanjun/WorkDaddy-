/* probe-inject-quality.js — 注入质量抽检（只读）
 * 目的：gap=true 触发率 88%，但「捞到东西」≠「捞对了」。
 * 抽 12 条历史提问，把注入结果全文打出来，人工判断相关性。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const CUR = ck.findActiveSession({ fresh: true }).sid;

// 挑有明确主题的历史提问，均匀跨会话
const rows = db.prepare(`
  SELECT sid, text, ts FROM seg
   WHERE kind='user' AND COALESCE(pri,0)=2 AND COALESCE(noise,0)=0
     AND LENGTH(text) BETWEEN 14 AND 120
   ORDER BY ts DESC LIMIT 60
`).all();

const seen = new Set();
const picked = [];
for (const r of rows) {
  const t = String(r.text).replace(/\s+/g, ' ').trim();
  if (/^@image#|^@"?[A-Z]:\\|^\/[a-z]/i.test(t)) continue;
  if (seen.has(t.slice(0, 12))) continue;
  seen.add(t.slice(0, 12));
  picked.push({ sid: r.sid, t });
  if (picked.length >= 12) break;
}

for (const { sid, t } of picked) {
  const r = ck.searchForPrompt(t, { sid: CUR, max: 2, chars: 600, gap: true });
  const items = r.items || [];
  console.log('\n' + '='.repeat(76));
  console.log('提问：' + t);
  console.log('来源会话：' + sid.slice(0, 8));
  items.forEach((x, i) => {
    const body = String(x.text || '').replace(/\s+/g, ' ');
    console.log(`  ── 注入${i + 1}  why=${x.why} cov=${x.cov !== undefined ? x.cov : '-'}  [${x.time || '-'}]`);
    console.log('     ' + body.slice(0, 150));
  });
  if (!items.length) console.log('  （无注入）reason=' + (r.reason || '-'));
}
