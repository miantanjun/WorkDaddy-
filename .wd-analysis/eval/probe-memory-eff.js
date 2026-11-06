/* probe-memory-eff.js — 记忆系统效果实测（只读）
 *
 * 签名修正：ck.search(sid, q, limit, deep)
 *   sid=null 表示跨全部会话检索
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const one = (s, ...a) => db.prepare(s).get(...a);

console.log('======= A. 关键词是否真的在库里 =======');
const words = ['REL_TIE', 'WAL', 'journal_size_limit', 'dupSession', 'SUNRISE', 'SHARDA',
  'OCTAGON', 'OfficeTool', 'ZeroTier', '喜马拉雅', 'CargoX', 'Nafeza'];
for (const w of words) {
  const r = one('SELECT COUNT(*) c FROM seg WHERE text LIKE ?', '%' + w + '%');
  const f = one('SELECT COUNT(*) c FROM seg_fts WHERE seg_fts MATCH ?', '"' + w + '"');
  console.log(`  ${String(w).padEnd(20)} seg=${String(r.c).padStart(6)}  fts=${String(f.c).padStart(6)}`);
}

console.log('\n======= B. 检索实测（sid=null 全库）=======');
const cases = [
  ['WAL 只增不减 修复', '技术决策'],
  ['REL_TIE 阈值', '技术决策'],
  ['重复会话 正品', '技术决策'],
  ['SUNRISE 尾款', '外贸'],
  ['OCTAGON 5 柜', '外贸'],
  ['SHARDA 波兰', '外贸'],
  ['OfficeTool 彩色打印机', '办公室IT'],
  ['ZeroTier 虚拟网卡', '网络'],
  ['喜马拉雅 下载', '个人'],
  ['CargoX 单据', '外贸'],
];
let stat = { ok: 0, zero: 0, totalMs: 0 };
for (const [query, tag] of cases) {
  const t0 = Date.now();
  const r = ck.search(null, query, 5, false);
  const ms = Date.now() - t0;
  stat.totalMs += ms;
  const hits = r.hits || [];
  if (hits.length > 0) stat.ok++; else stat.zero++;
  console.log(`\n  ▸ "${query}" [${tag}]  ${hits.length} 命中 via=${r.via} cand=${r.candidates} ${ms}ms`);
  hits.slice(0, 2).forEach((h, i) => {
    const t = String(h.text || '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`    ${i + 1}. pri=${h.pri} kind=${h.kind} sid=${String(h.sid).slice(0, 8)} ${t}`);
  });
}
console.log(`\n  小结：有命中 ${stat.ok} / 零命中 ${stat.zero}，总耗时 ${stat.totalMs}ms，均值 ${(stat.totalMs / cases.length).toFixed(0)}ms`);

console.log('\n======= C. 只用用户原话（pri=2）检索 =======');
const p2 = [
  ['尾款', '外贸'],
  ['重复会话', '技术'],
  ['WAL', '技术'],
  ['打印机', '办公室'],
];
for (const [query, tag] of p2) {
  const r = ck.search(null, query, 5, false);
  const hits = (r.hits || []).filter(h => h.pri === 2);
  console.log(`  "${query}" 命中 ${(r.hits || []).length} 条，其中 pri=2 有 ${hits.length} 条  (via=${r.via})`);
  hits.slice(0, 2).forEach((h, i) => {
    console.log(`     ${i + 1}. ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 60)}`);
  });
}

console.log('\n======= D. 排序质量：同一查询不同 k =======');
const rk = ck.search(null, '尾款 70%', 20, false);
console.log(`  "尾款 70%" 返回 ${(rk.hits || []).length} 条：`);
(rk.hits || []).slice(0, 8).forEach((h, i) => {
  console.log(`   ${String(i + 1).padStart(2)}. pri=${h.pri} score=${h.score !== undefined ? Number(h.score).toFixed(3) : '-'} ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 55)}`);
});
