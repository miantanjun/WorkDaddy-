/* 只读：统计线上库的真实 seg 长度分布，判断向量编码的算力预算 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const rows = db.prepare('SELECT LENGTH(text) L FROM seg').all().map((r) => Number(r.L) || 0);
rows.sort((a, b) => a - b);
const q = (p) => rows[Math.floor(rows.length * p)];
console.log('seg 长度分位：');
for (const p of [0.5, 0.75, 0.9, 0.95, 0.99, 1]) {
  console.log(`  p${(p * 100).toFixed(0)}: ${q(p)} 字`);
}
const tot = rows.reduce((a, b) => a + b, 0);
console.log(`总字数 ${(tot / 1e6).toFixed(2)}M，平均 ${(tot / rows.length).toFixed(0)} 字/条`);
console.log(`超过 512 token 估计（按 1.4 字/token）：${rows.filter((x) => x > 700).length} 条`);
