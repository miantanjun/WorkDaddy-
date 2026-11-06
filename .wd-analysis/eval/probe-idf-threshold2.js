/* probe-idf-threshold2.js — 定案：df <= max(60, total*0.004)（只读）
 *
 * 设计要点：
 *   ① 去掉「跨会话数<=2」这个维度 —— 它在长期库里方向是反的（跨会话多 = 关键实体）
 *   ② 用「df 占总行数比例」判泛化，这才是真正的泛化指标
 *   ③ 加绝对下限 max(60, ...)：小库里占比会失真（1000 行的库 0.4% 只有 4 行，
 *      连 Nafeza 这种真专名都会被判成泛词）⇒ 取两者较宽者
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;

const RATIO = 0.004;
const FLOOR = 60;

function judge(n, total) {
  if (n === 0) return 'KEEP(库里没有)';
  const cap = Math.max(FLOOR, total * RATIO);
  return n <= cap ? 'PASS' : 'DROP';
}
console.log(`库 ${total} 行 ⇒ 上限 max(${FLOOR}, ${(total * RATIO).toFixed(0)}) = ${Math.max(FLOOR, total * RATIO).toFixed(0)} 行\n`);

const shouldPass = ['YKW-SU-260713', 'OfficeTool.exe', 'ck.db', 'SUNRISE', 'OCTAGON', 'SHARDA',
  'Nafeza', 'CargoX', 'REL_TIE', 'ZeroTier', '喜马拉雅', 'KITFIRE', 'SUNRISE-FZCO',
  'CAIRO-11371', 'PT. ADIKENCANA', 'SEMARANG'];
const shouldDrop = ['127.0.0.1', 'github.com', 'Windows', 'Microsoft', 'PowerShell', 'the', 'and'];

function show(list, expect) {
  console.log(`--- 期望 ${expect} ---`);
  for (const id of list) {
    const n = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ?').get('%' + id + '%').c;
    const s = db.prepare('SELECT COUNT(*) c FROM (SELECT sid FROM seg WHERE text LIKE ? GROUP BY sid)').get('%' + id + '%').c;
    const j = judge(n, total);
    const bad = (expect === 'PASS' && j.startsWith('DROP')) || (expect === 'DROP' && j === 'PASS');
    console.log('  ' + (bad ? '✗ ' : '✓ ') + String(id).padEnd(18) + String(n).padStart(6) + ' 行 / '
      + String(s).padStart(2) + ' 会话  ' + (n / total * 100).toFixed(2).padStart(6) + '%  → ' + j);
  }
  console.log('');
}
show(shouldPass, 'PASS');
show(shouldDrop, 'DROP');

console.log('--- 小库模拟（1000 行）—— 绝对下限必须兜住 ---');
for (const n of [5, 20, 26, 50, 60, 61, 100]) {
  console.log('  df=' + String(n).padStart(4) + '  → ' + judge(n, 1000));
}
