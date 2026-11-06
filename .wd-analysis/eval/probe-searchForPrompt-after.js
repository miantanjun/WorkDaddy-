/* probe-searchForPrompt-after.js — 改后效果对比（只读）
 * 用真实历史提问回放，看 no-signal 的比例有没有下降、抓到的是不是对的会话。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();

console.log('=== A. 标识符过滤结果（改后）===');
const probes = [
  'YKW-SU-260713 这单尾款收到没有',
  'OfficeTool.exe 彩色打印机模块怎么加',
  'SUNRISE 那边的 70% 尾款',
  'SHARDA 波兰首单 PI',
  'ZeroTier 网段是多少',
  '喜马拉雅音频助手进度',
  'Nafeza ACI 单据要填什么',
  'REL_TIE 现在多少',
  'ck.db 越来越大怎么办',
  '127.0.0.1 是哪个服务',
  'github.com 上那个仓库',
];
const CUR = ck.findActiveSession({ fresh: true }).sid;
for (const p of probes) {
  const r = ck.searchForPrompt(p, { sid: CUR, max: 3, chars: 900, gap: false, crossOnly: false });
  console.log('\n▸ ' + p);
  console.log('   ids=' + JSON.stringify(r.ids || []));
  console.log('   dropped=' + JSON.stringify(r.dropped || []));
  console.log('   reason=' + (r.reason || '-') + '  n=' + (r.items || []).length);
}

console.log('\n\n=== B. 真实历史提问回放（145 条，看 no-signal 比例变化）===');
const rows = db.prepare(`
  SELECT text FROM seg
   WHERE kind='user' AND COALESCE(pri,0)=2 AND COALESCE(noise,0)=0
     AND LENGTH(text) BETWEEN 6 AND 300
   ORDER BY ts DESC LIMIT 145
`).all();
const prompts = rows.map(r => String(r.text).replace(/\s+/g, ' ').trim())
  .filter(t => t && !/^@image#|^@"?[A-Z]:\\|^\/[a-z]/i.test(t));

let ok = 0, noSig = 0, idMiss = 0;
const reasons = {};
for (const p of prompts) {
  let r;
  try { r = ck.searchForPrompt(p, { sid: CUR, max: 3, chars: 1200 }); } catch (e) { continue; }
  const n = (r.items || []).length;
  const why = r.reason || (n ? 'ok' : '-');
  reasons[why] = (reasons[why] || 0) + 1;
  if (why === 'no-signal') noSig++;
  else if (why === 'id-miss') idMiss++;
  if (n) ok++;
}
console.log('样本 ' + prompts.length + ' 条');
console.log('  注入成功   ' + ok + '  (' + (ok / prompts.length * 100).toFixed(1) + '%)');
console.log('  no-signal  ' + noSig);
console.log('  id-miss    ' + idMiss);
console.log('  reason 分布 ' + JSON.stringify(reasons));
