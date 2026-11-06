/* 校准评测集：检查「未召回」是不是因为金标准只写了一行，而检索命中了同一回合的邻行
 *
 * 为什么必须做这一步：
 *   第一版用例里 S08 的 gold 是 seq 2616（结论：md 快速查看器改了什么），
 *   而检索返回的是 2617（同一回合里用户那句「点开还是卡」）。
 *   站在「答案在不在前 k」的角度，这两行是**同一个回合的同一件事**，
 *   判成未召回是评测集的问题，不是检索的问题。
 *
 * 判据（自动给出建议，不自动改用例 —— 改用例必须人看过）：
 *   未召回时，看返回结果与 gold 的 seq 差是否 <= 2（同一回合），是则标记 NEAR。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const { CASES } = require('./cases.js');

const db = ck._internal.open();
const S = ck._internal.search;

console.log('ID   判定    gold        返回(gold±2 视为同回合)  问题');
for (const c of CASES) {
  if (!c.gold.length) continue;
  const r = S(c.sid, c.q, c.k);
  const got = (r.hits || []).map((h) => h.seq);
  const want = c.minHit || 1;
  const exact = c.gold.filter((g) => got.indexOf(g) >= 0).length;
  if (exact >= want) continue;
  const near = [];
  for (const g of c.gold) {
    for (const s of got) if (Math.abs(s - g) <= 2) near.push(g + '~' + s);
  }
  // 那一回合都在说什么，供人工判断
  const g0 = c.gold[0];
  const rows = db.prepare(
    'SELECT seq, role, pri, substr(replace(text, char(10), \' \'), 1, 50) t FROM seg WHERE sid = ? AND seq BETWEEN ? AND ? ORDER BY seq'
  ).all(c.sid, g0 - 2, g0 + 2);
  console.log('\n' + c.id + '   ' + (near.length ? 'NEAR   ' : 'MISS   ') + JSON.stringify(c.gold).padEnd(11)
    + ' got=' + JSON.stringify(got));
  console.log('     q=' + c.q);
  for (const x of rows) console.log('       seq=' + x.seq + ' p' + x.pri + ' ' + x.role + ' | ' + x.t);
}
