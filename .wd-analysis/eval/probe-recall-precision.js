/* probe-recall-precision.js — 主动检索精度（同会话内，正确口径）
 *
 * ⚠️ 关键口径：必须**在内容所在的那个会话里查**。
 *   上一版 probe-mcp-precision.js 全在当前会话 3a1eef3c 里查，
 *   而 WAL / SHARDA / OfficeTool 的内容根本不在这个会话 ⇒ 0 命中是设计如此，
 *   把它们算成「精度差」是错的。
 *
 * 这里改成：每个查询先定位「金标内容所在会话」，再在那个会话里检索，
 * 判断命中条目里是否真的包含目标内容。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const S = ck._internal.search;

// 金标：query + 目标内容特征词 + 应当命中的会话（留空=自动找）
const cases = [
  { q: 'WAL 只增不减 怎么修', must: ['WAL', 'wal', 'checkpoint', 'journal_size_limit'] },
  { q: 'REL_TIE 阈值', must: ['REL_TIE', 'rel_tie'] },
  { q: '重复会话 正品 判据', must: ['重复', '正品', 'canon', 'sha256'] },
  { q: '装柜计算器 3D 卡顿', must: ['3D', '卡顿', '装柜'] },
  { q: '悬浮球 导航栏 互斥', must: ['悬浮球', '导航栏'] },
  { q: 'XSS 后台 上传', must: ['XSS', 'xss', 'FileUpload', '注入'] },
  { q: 'SHARDA 波兰 首单', must: ['SHARDA', 'sharda', '波兰'] },
  { q: 'OfficeTool 彩色打印机', must: ['OfficeTool', '打印机', 'ColorPrinter'] },
  { q: '埃及 尾款 70%', must: ['尾款', '231,472', '70%'] },
  { q: 'Nafeza ACI 单据', must: ['Nafeza', 'ACI', 'ACID'] },
  { q: 'ZeroTier 网段', must: ['ZeroTier', '10.10.10'] },
  { q: '喜马拉雅 音频助手', must: ['喜马拉雅', '音频助手'] },
];

let tot = 0, rel = 0, zeroHit = 0;
const detail = [];

for (const c of cases) {
  // 找金标所在会话：哪个会话里有最多 must 词
  const cand = db.prepare(`
    SELECT sid, COUNT(*) c FROM seg
     WHERE (${c.must.map(() => "text LIKE ?").join(' OR ')})
       AND COALESCE(pri,0) >= 1
     GROUP BY sid ORDER BY c DESC LIMIT 1
  `).get(...c.must.map(m => '%' + m + '%'));

  if (!cand) { console.log(`\n▸ "${c.q}"  ⚠️ 全库找不到金标（跳过）`); continue; }
  const sid = cand.sid;

  const r = S(sid, c.q, 5, false);
  const hits = r.hits || [];
  let relN = 0;
  const flags = [];
  for (const h of hits) {
    const t = String(h.text || '');
    const ok = c.must.some(m => t.indexOf(m) >= 0);
    if (ok) relN++;
    flags.push(ok ? '✓' : '✗');
  }
  tot += hits.length; rel += relN;
  if (!hits.length) zeroHit++;
  detail.push({ q: c.q, n: hits.length, relN, via: r.via, sid: sid.slice(0, 8) });

  console.log(`\n▸ "${c.q}"   在会话 ${sid.slice(0, 8)}（金标 ${cand.c} 行）`);
  console.log(`   ${hits.length} 命中 via=${r.via}  相关 ${relN}  ${flags.join(' ')}`);
  hits.forEach((h, i) => {
    console.log(`     ${flags[i]} [${h.time}] ${String(h.text || '').replace(/\s+/g, ' ').slice(0, 62)}`);
  });
}

console.log('\n' + '='.repeat(70));
console.log(`合计：返回 ${tot} 条，相关 ${rel} 条 → 精度 ${(rel / Math.max(tot, 1) * 100).toFixed(1)}%`);
console.log(`零命中查询 ${zeroHit} / ${detail.length}`);
console.log('\n逐题：');
for (const d of detail) console.log(`  ${d.q.padEnd(24)} ${String(d.n).padStart(2)} 命中 / 相关 ${d.relN}  via=${d.via}`);
