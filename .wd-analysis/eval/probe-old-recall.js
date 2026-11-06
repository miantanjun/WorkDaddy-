/* probe-old-recall.js — 老记忆会不会被新记忆挤掉（只读）
 *
 * 核心疑问：跨 87 天，早期内容会不会因为「时间旧」被排到很后面？
 * 排序键 rankKey = 0.6×新鲜度(半衰期30天) + 0.4×重要度。
 * 这里直接量化：同一条查询里，老内容 vs 新内容的排名差。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const fd = (ms) => { const d = new Date(Number(ms)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const now = Date.now();

console.log('=== A. 新鲜度得分随天数的衰减（半衰期 30 天）===');
for (const d of [0, 7, 30, 45, 60, 87, 120]) {
  const s = Math.pow(0.5, d / 30);
  console.log(`  ${String(d).padStart(4)} 天前  →  新鲜度 ${s.toFixed(3)}  （rankKey 里占 60%，即贡献 ${(0.6 * s).toFixed(3)}）`);
}
console.log('\n  重要度占 40%：pri=2(0.40) + 含标识符(0.20) + 长度合适(0.10) = 0.70 封顶的常见值');
console.log('  ⇒ 三个月前但含单号的用户原话 rankKey = 0.6×0.17 + 0.4×0.70 = ' + (0.6 * Math.pow(0.5, 90 / 30) + 0.4 * 0.70).toFixed(3));
console.log('  ⇒ 今天的普通过程话（pri=1，无标识符）rankKey = 0.6×1.00 + 0.4×0.30 = ' + (0.6 * 1 + 0.4 * 0.30).toFixed(3));

console.log('\n=== B. 真实查询：老内容排第几 ===');
// 在长跨度会话里，查一个早期才有的具体事，看排名
const cases = [
  { sid: 'cd5f08de', q: 'ACI 登记 PI 号', early: '2026-09-04', note: '早期结论' },
  { sid: '405fa88e', q: 'REX 指南 6000 门槛', early: '2026-09-22', note: '早期结论' },
  { sid: 'e567d9db', q: '工厂 尾款 30% 定金', early: '2026-09-17', note: '早期' },
  { sid: '639ebe4c', q: '开始处理 保存 按钮 加回来', early: '2026-09-01', note: '最早一天' },
  { sid: '39229fed', q: '功能说明 弹窗 删掉 悬停提示', early: '2026-08-24', note: '最早几天' },
];
for (const c of cases) {
  const s = db.prepare('SELECT sid FROM sessions WHERE sid LIKE ?').get(c.sid + '%');
  if (!s) continue;
  const r = ck._internal.search(s.sid, c.q, 10, false);
  const hits = r.hits || [];
  console.log(`\n会话 ${c.sid} 查「${c.q}」（${c.note} ${c.early}）  ${hits.length} 命中 via=${r.via}`);
  hits.slice(0, 5).forEach((h, i) => {
    const age = ((now - Number(h.ts)) / 86400000).toFixed(0);
    console.log(`   ${i + 1}. ${fd(h.ts)}（${age}天前） ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 50)}`);
  });
}

console.log('\n=== C. 最老那条到底还在不在（2026-08-11 的记录能否命中）===');
const oldest = db.prepare("SELECT sid, text, ts FROM seg WHERE ts>0 AND kind='user' AND LENGTH(text)>20 ORDER BY ts ASC LIMIT 1").get();
if (oldest) {
  const q = String(oldest.text).replace(/\s+/g, ' ').slice(0, 30);
  const r = ck._internal.search(oldest.sid, q, 5, false);
  console.log(`  会话 ${oldest.sid.slice(0, 8)}  最早记录 ${fd(oldest.ts)}（${((now - Number(oldest.ts)) / 86400000).toFixed(0)} 天前）`);
  console.log(`  查「${q}」 → ${(r.hits || []).length} 命中`);
  (r.hits || []).slice(0, 3).forEach((h, i) => console.log(`    ${i + 1}. ${fd(h.ts)} ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 50)}`));
}
