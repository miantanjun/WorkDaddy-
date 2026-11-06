/* probe-mcp-precision.js — MCP 实际接口的检索精度（只读）
 *
 * 复刻 memory_search 的调用路径（ck.search(q,k) 只查当前会话），
 * 用「命中条目里含查询核心词的条数」做粗精度，看返回的 5 条里有几条真的相关。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const CUR = ck.findActiveSession({ fresh: true }).sid;
console.log('当前会话', CUR.slice(0, 8), '\n');

// 每条 query 附带「判定相关必须出现的词」
const cases = [
  { q: '重复会话 正品 判据', must: ['重复', '正品', 'dup'] },
  { q: 'WAL 只增不减', must: ['WAL', 'wal', 'checkpoint'] },
  { q: 'REL_TIE 阈值', must: ['REL_TIE', '阈值'] },
  { q: '悬浮球 导航栏 互斥', must: ['悬浮球', '导航栏'] },
  { q: 'canvas 真机 空白', must: ['canvas', '空白', '真机'] },
  { q: '装柜计算器 3D 卡顿', must: ['3D', '卡顿', '装柜'] },
  { q: 'XSS 后台 上传', must: ['XSS', 'xss', 'FileUpload'] },
  { q: '尾款 70%', must: ['尾款', '70%', '231,472'] },
  { q: 'SHARDA 波兰', must: ['SHARDA', '波兰'] },
  { q: 'OfficeTool 打印机', must: ['OfficeTool', '打印机'] },
];
let sum = 0, relSum = 0;
for (const c of cases) {
  const r = ck.search(c.q, 5, false);
  const hits = r.hits || [];
  let rel = 0;
  const flags = [];
  for (const h of hits) {
    const t = String(h.text || '');
    const ok = c.must.some(m => t.indexOf(m) >= 0);
    if (ok) rel++;
    flags.push(ok ? '✓' : '✗');
  }
  sum += hits.length; relSum += rel;
  console.log(`"${c.q}"  ${hits.length} 条  via=${r.via}  相关 ${rel}   ${flags.join(' ')}`);
  hits.forEach((h, i) => {
    const t = String(h.text || '').replace(/\s+/g, ' ');
    console.log(`    ${flags[i]} [${h.time}] ${t.slice(0, 62)}`);
  });
  console.log('');
}
console.log(`合计：返回 ${sum} 条，判定相关 ${relSum} 条 → 粗精度 ${(relSum / Math.max(sum, 1) * 100).toFixed(1)}%`);
