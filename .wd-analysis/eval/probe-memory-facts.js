/* probe-memory-facts.js — 事实层检索实测（只读） */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const sf = ck._internal.searchFacts;

console.log('=== searchFacts 返回结构 ===');
const probe = sf(null, 'WAL', 5, {});
console.log('keys:', Object.keys(probe || {}));
console.log(JSON.stringify(probe, null, 1).slice(0, 700));

const qs = ['WAL', '库体积', '备份', 'canvas', 'XSS', '记忆库清理',
  '重复会话', '3D 空白', '悬浮球', '尾款', '埃及', 'OfficeTool'];
console.log('\n=== 事实层检索（只有 135 条事实）===');
for (const q of qs) {
  let r;
  try { r = sf(null, q, 5, {}) || []; } catch (e) { console.log(q, 'ERR', e.message); continue; }
  const items = r.items || r || [];
  const n = Array.isArray(items) ? items.length : 0;
  console.log(`\n▸ fact:"${q}"  ${n} 条`);
  (Array.isArray(items) ? items : []).slice(0, 3).forEach((x, i) => {
    console.log(`   ${i + 1}. ${String(x.text || x.fact || '').replace(/\s+/g, ' ').slice(0, 90)}`);
  });
}
