/* 只读：看评测库的规模，决定向量路怎么测 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
if (!db) { console.error('库打不开'); process.exit(1); }

const tot = db.prepare('SELECT COUNT(*) c, MIN(LENGTH(text)) a, MAX(LENGTH(text)) b FROM seg').get();
console.log('seg 总数:', tot.c, ' 长度', tot.a, '~', tot.b);

console.log('\n按 sid 分布（前 8）:');
for (const r of db.prepare('SELECT sid, COUNT(*) c, SUM(LENGTH(text)) chars FROM seg GROUP BY sid ORDER BY c DESC LIMIT 8').all()) {
  console.log(`  ${String(r.sid).slice(0, 12)}  ${r.c} 条  ${(r.chars / 1e6).toFixed(2)}M 字`);
}

console.log('\n事实数:', db.prepare('SELECT COUNT(*) c FROM fact').get().c);

// 评测用例涉及哪几个 sid
const { CASES } = require(path.join(ROOT, '.wd-analysis', 'eval', 'cases.js'));
const bySid = {};
for (const c of CASES) bySid[c.sid] = (bySid[c.sid] || 0) + 1;
console.log('\n用例 sid 分布:');
for (const k of Object.keys(bySid)) console.log('  ' + k.slice(0, 12) + '  ' + bySid[k] + ' 题');
