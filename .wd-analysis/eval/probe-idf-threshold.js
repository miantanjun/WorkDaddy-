/* probe-idf-threshold.js — IDF 门槛方案对比（只读）
 *
 * 现判：df<=60 且 跨会话数<=2
 * 问题：长期库里「跨会话多」恰恰说明是关键实体，被误杀。
 * 备选：按「df 占总行数比例」判泛化（比例才是真正的泛化指标）
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ log: () => {} });
const db = ck._internal.open();
const total = db.prepare('SELECT COUNT(*) c FROM seg').get().c;
console.log('库总行数', total);

const ids = ['YKW-SU-260713', 'OfficeTool.exe', 'ck.db', 'SUNRISE', 'OCTAGON', 'SHARDA',
  'Nafeza', 'CargoX', 'REL_TIE', 'ZeroTier', '喜马拉雅', 'KITFIRE', 'SUNRISE-FZCO',
  // 反例：真正的泛化词，必须继续 DROP
  '127.0.0.1', 'github.com', 'Windows', 'Microsoft', 'Excel', 'PowerShell', 'javascript'];

console.log('\n' + '标识符'.padEnd(16) + '行数'.padStart(6) + '会话'.padStart(5) + '占比'.padStart(9) + '  现判(60/2)  按比例0.5%  按比例2%');
for (const id of ids) {
  const n = db.prepare('SELECT COUNT(*) c FROM seg WHERE text LIKE ?').get('%' + id + '%').c;
  const s = db.prepare('SELECT COUNT(*) c FROM (SELECT sid FROM seg WHERE text LIKE ? GROUP BY sid)').get('%' + id + '%').c;
  const ratio = n / total;
  const cur = (n <= 60 && s <= 2) ? 'PASS' : 'DROP';
  const p05 = (n === 0 || ratio <= 0.005) ? 'PASS' : 'DROP';
  const p2 = (n === 0 || ratio <= 0.02) ? 'PASS' : 'DROP';
  console.log('  ' + String(id).padEnd(14) + String(n).padStart(6) + String(s).padStart(5)
    + (ratio * 100).toFixed(2).padStart(8) + '%  ' + cur.padEnd(11) + p05.padEnd(11) + p2);
}
