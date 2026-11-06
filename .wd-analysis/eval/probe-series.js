/* 抽取「同一指标多次出现」的候选序列 —— 为新增「时效性」题型找素材
 *
 * 为什么这类题最关键：
 *   阶段 3 加的「并列组内新鲜度换位」被实测证明伤召回 −9.7pp，
 *   但评测集里**一道「同一事实有新旧两版」的题都没有** ⇒ 量不出它的收益。
 *   要判断「值不值」，必须先把这类题造出来。
 *
 * 判据：同一会话里，多行都出现「N 个套件 / M 项断言」这种结构化数字，
 *   且 N 随时间递增 ⇒ 天然构成「当时是 A，后来是 B，最新是 C」三段序列。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();

const SID = '8f92c3fc-ff73-4db1-b104-eb060127daaf';
const rows = db.prepare(
  'SELECT seq, kind, ts, text FROM seg WHERE sid=? ORDER BY seq').all(SID);

// 模式 A：N 个套件 / M 项断言
const reA = /(\d{2,3})\s*(?:个)?套件[^\d]{0,12}?(\d{3,5})\s*(?:项)?断言/g;
// 模式 B：pid 变化 NNN → MMM
const reB = /pid\s*(\d{3,6})\s*(?:→|->|=>)\s*(\d{3,6})/g;

function collect(re, label) {
  const out = [];
  for (const r of rows) {
    const t = String(r.text);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) out.push({ seq: r.seq, kind: r.kind, ts: Number(r.ts) || 0, v1: +m[1], v2: m[2] ? +m[2] : 0 });
  }
  // 同一个 seq 只留一条
  const seen = new Set();
  const uniq = out.filter((x) => (seen.has(x.seq) ? false : (seen.add(x.seq), true)));
  console.log('\n== ' + label + ' == 命中 ' + uniq.length + ' 行 / ' + new Set(uniq.map((x) => x.seq)).size + ' 个 seq');
  for (const x of uniq) {
    console.log('  seq=' + String(x.seq).padStart(6) + '  ' + x.v1 + (x.v2 ? '/' + x.v2 : '') + '  ' + x.kind);
  }
  return uniq;
}

const a = collect(reA, '套件/断言 序列');
const b = collect(reB, 'pid 切换序列');

// 只列套件数的单调演进（最有价值）
const suites = new Map();
for (const x of a) {
  const k = x.v1;
  if (!suites.has(k)) suites.set(k, []);
  suites.get(k).push(x.seq);
}
console.log('\n== 套件数分布（值 → seq 列表）==');
for (const k of [...suites.keys()].sort((p, q) => p - q)) {
  console.log('  ' + String(k).padStart(3) + ' 套件  ← ' + suites.get(k).join(', '));
}
