/* probe-memory-health.js — 记忆系统现状体检（只读）
 *
 * 回答两个问题：
 *   1) 这套记忆系统"做好了没有" —— 看数据完整性、覆盖率、是否有孤儿/空洞
 *   2) "有什么用、实际效果如何" —— 拿真实查询跑一遍，看能不能查到、排得准不准
 *
 * 只读，不写库。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();

const MB = (n) => (n / 1048576).toFixed(1);
const q = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);

console.log('======= 一、库体量与完整性 =======');
const page = one('PRAGMA page_size');
const cnt = one('PRAGMA page_count');
const free = one('PRAGMA freelist_count');
console.log(`文件        ${MB(fs.statSync(ck._internal.dbFile()).size)} MB`);
console.log(`页          ${page.page_size}B × ${cnt.page_count} 页`);
console.log(`空闲页      ${free.freelist_count} 页 (${MB(free.freelist_count * page.page_size)} MB 碎片)`);
console.log(`WAL 限制    ${one('PRAGMA journal_size_limit').journal_size_limit} B`);
console.log(`journal     ${one('PRAGMA journal_mode').journal_mode}`);
console.log(`quick_check ${one('PRAGMA quick_check').quick_check}`);

console.log('\n======= 二、数据规模 =======');
console.log(`seg 总条数   ${one('SELECT COUNT(*) c FROM seg').c}`);
console.log(`会话数       ${one('SELECT COUNT(DISTINCT sid) c FROM seg').c}`);
console.log(`sessions 表  ${one('SELECT COUNT(*) c FROM sessions').c}`);
console.log(`FTS 条数     ${one('SELECT COUNT(*) c FROM seg_fts').c}`);

console.log('\n--- 按优先级 pri 分布（2=用户原话 1=回合末条 0=过程话）---');
for (const r of q('SELECT pri, COUNT(*) c FROM seg GROUP BY pri ORDER BY pri DESC')) {
  console.log(`  pri=${r.pri}  ${String(r.c).padStart(7)} 条`);
}
console.log('\n--- 按 kind 分布 ---');
for (const r of q('SELECT kind, COUNT(*) c FROM seg GROUP BY kind ORDER BY c DESC')) {
  console.log(`  ${String(r.kind).padEnd(10)} ${String(r.c).padStart(7)} 条`);
}

console.log('\n--- 时间跨度 ---');
const t = one('SELECT MIN(h) mn, MAX(h) mx FROM seg');
console.log(`  最早 ${String(t.mn).slice(0, 4)}-${String(t.mn).slice(4, 6)}-${String(t.mn).slice(6, 8)}`);
console.log(`  最近 ${String(t.mx).slice(0, 4)}-${String(t.mx).slice(4, 6)}-${String(t.mx).slice(6, 8)}`);

console.log('\n======= 三、完整性检查 =======');
const segC = one('SELECT COUNT(*) c FROM seg').c;
const ftsC = one('SELECT COUNT(*) c FROM seg_fts').c;
const toolNoise = one('SELECT COUNT(*) c FROM seg WHERE kind=? AND noise=1', 'tool').c;
console.log(`seg - seg_fts = ${segC - ftsC}（应等于 tool+noise=1 的 ${toolNoise}）`);
const orphan = one('SELECT COUNT(*) c FROM seg WHERE sid NOT IN (SELECT sid FROM sessions)').c;
console.log(`seg 中无 sessions 记录的孤儿行 ${orphan}`);
const emptyText = one("SELECT COUNT(*) c FROM seg WHERE text IS NULL OR text=''").c;
console.log(`空正文行 ${emptyText}`);
const dupIdx = one('SELECT COUNT(*) c FROM (SELECT sid,h,kind,COUNT(*) n FROM seg GROUP BY sid,h,kind HAVING n>1)').c;
console.log(`(sid,h,kind) 重复组 ${dupIdx}`);

console.log('\n--- 前 10 大会话 ---');
for (const r of q(`SELECT sid, COUNT(*) c FROM seg GROUP BY sid ORDER BY c DESC LIMIT 10`)) {
  const s = one('SELECT * FROM sessions WHERE sid=?', r.sid);
  const title = s ? (s.title || s.name || '(无标题)') : '(sessions 无记录)';
  console.log(`  ${String(r.c).padStart(6)} 条  ${r.sid.slice(0, 8)}  ${String(title).slice(0, 40)}`);
}

console.log('\n======= 四、检索实测 =======');
const cases = [
  ['WAL 只增不减怎么修', '过程/技术决策'],
  ['重复会话 正品判定', '过程/技术决策'],
  ['REL_TIE 阈值', '过程/技术决策'],
  ['老叶 埃及 订单 尾款', '外贸业务'],
  ['SUNRISE-FZCO 70% 尾款', '外贸业务'],
  ['波兰 SHARDA 首单', '外贸业务'],
  ['OfficeTool 彩色打印机', '办公室IT'],
  ['ZeroTier 10.10.10.0', '网络'],
  ['喜马拉雅 音频助手', '个人项目'],
];
for (const [query, tag] of cases) {
  const t0 = Date.now();
  let r;
  try { r = ck.search(query, { k: 5, sid: null }); } catch (e) { console.log(`  [ERR] ${query} -> ${e.message}`); continue; }
  const ms = Date.now() - t0;
  const hits = (r && r.hits) ? r.hits : [];
  const via = (r && r.via) || '?';
  console.log(`\n  ▸ "${query}"  [${tag}]`);
  console.log(`    ${hits.length} 命中 / via=${via} / ${ms}ms`);
  hits.slice(0, 3).forEach((h, i) => {
    const txt = String(h.text || '').replace(/\s+/g, ' ').slice(0, 68);
    console.log(`    ${i + 1}. [${h.pri}] ${h.sid ? h.sid.slice(0, 8) : '?'}  ${txt}`);
  });
}
