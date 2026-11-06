/* 直接调用**产品** rankRelevanceFirst 验证修复 —— 不再靠复刻
 *
 * ⚠️ 产品返回的是原始 items（不带 .g），所以只能看**输出顺序**。
 *   这反而更好：顺序是唯一对外可见的行为，也是用户真正体验到的。
 *   做法：用「正确的分组逻辑」算出期望顺序，与产品输出逐位比对。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });

const fn = ck.rankRelevanceFirst;
if (typeof fn !== 'function') { console.error('❌ 未导出 rankRelevanceFirst'); process.exit(2); }

const now = Date.now();
const DAY = 86400000;
const mk = (rel, daysAgo, pri) => {
  const r = { rel, ts: now - daysAgo * DAY, last_hit_ts: 0, pri, dup: 1, text: 'x'.repeat(80) };
  return { r, rel };
};

/* rankKey 用产品导出的，不自己写 */
const rankKeyOf = (row) => ck.rankKey(row, now);

/* 参考实现：正确分组 → 按 (g, rankKey desc, 原序) 排序 */
function expectOrder(items, rankMode, rankTie) {
  const rels = items.map((x) => x.rel);
  const span = Math.max(...rels) - Math.min(...rels);
  const tie = rankMode ? (rankTie || 0) : (span > 0 ? span * 0.12 : Infinity);
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  const anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  if (arr.length > 1) arr[1].g = g;
  let anc = anchor;                       /* ⚠️ 必须随组起点更新，漏了就每组只装一条 */
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anc > tie) { g += 1; anc = arr[k].x.rel; }
    arr[k].g = g;
  }
  arr.sort((a, b) => a.g - b.g || rankKeyOf(b.x.r) - rankKeyOf(a.x.r) || a.i - b.i);
  return arr;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

/* ① 名次制 rel=0..9 —— 核心用例：修前第 2 名会被踢到池尾 */
{
  const items = [];
  for (let i = 0; i < 10; i++) items.push(mk(i, 100 - i * 7, 1));   // 越后越新
  const got = fn(items, now, { rankMode: true, rankTie: 2 });
  const exp = expectOrder(items, true, 2).map((a) => a.x);
  const relSeq = (arr) => arr.map((x) => x.rel).join(' ');
  console.log('① 名次制 rel=0..9');
  console.log('   产品输出 : ' + relSeq(got));
  console.log('   期望输出 : ' + relSeq(exp));
  ok(relSeq(got) === relSeq(exp), '产品顺序与正确分组一致');
  ok(got[0].rel === 0, '第 1 名在首位');
  ok(got.indexOf(items[1]) <= 3, '第 2 名（rel=1）必须落在前 4 位，实际第 ' + (got.indexOf(items[1]) + 1));
}

/* ② 第 1 名绝对不动：300 轮随机新鲜度反差 */
{
  let bad = 0;
  for (let t = 0; t < 300; t++) {
    const items = [];
    for (let i = 0; i < 12; i++) items.push(mk(i, ((i * 37 + t * 13) % 400) + 1, (i + t) % 2 ? 2 : 1));
    const out = fn(items, now, { rankMode: true, rankTie: 2 });
    if (out[0] !== items[0]) bad++;
  }
  console.log('② 第 1 名不动 300 轮：异常 ' + bad);
  ok(bad === 0, '第 1 名从不被换掉');
}

/* ③ 真并列：与第 1 名同分 ⇒ 可以换位（更新的上前） */
{
  const items = [mk(5, 300, 1), mk(5, 1, 1), mk(5, 100, 1), mk(9, 1, 1)];
  const got = fn(items, now, { rankMode: true, rankTie: 2 });
  const days = got.map((x) => Math.round((now - x.r.ts) / DAY));   /* 产品返回原始 items，时间在 .r 里 */
  console.log('③ 真并列 → 顺序(天前) ' + days.join(' '));
  ok(got.length === 4, '不丢条目');
  ok(days.indexOf(1) < days.indexOf(300), '真并列时更新的确实排前面');
}

/* ④ 边界 */
{
  ok(fn([], now, { rankMode: true, rankTie: 2 }).length === 0, '空数组');
  ok(fn([mk(0, 10, 1)], now, { rankMode: true, rankTie: 2 }).length === 1, '单条');
  const o2 = fn([mk(0, 10, 1), mk(5, 1, 1)], now, { rankMode: true, rankTie: 2 });
  ok(o2[0].rel === 0, '两条时第 1 名仍最前');
  const o2b = fn([mk(0, 1, 1), mk(5, 400, 1)], now, { rankMode: true, rankTie: 2 });
  ok(o2b[0].rel === 0, '第 1 名再旧也不让位给更新的第 2 名');
}

/* ⑤ 分数制（AND/LIKE，rankMode=false） */
{
  const items = [mk(-10, 200, 1), mk(-8, 1, 1), mk(-5, 150, 1), mk(-1, 300, 1)];
  const got = fn(items, now, { rankMode: false });
  const exp = expectOrder(items, false, 0).map((a) => a.x);
  const sq = (arr) => arr.map((x) => x.rel).join(' ');
  console.log('⑤ 分数制 bm25(-10,-8,-5,-1)');
  console.log('   产品输出 : ' + sq(got));
  console.log('   期望输出 : ' + sq(exp));
  ok(sq(got) === sq(exp), '分数制与期望一致');
  ok(got[0].rel === -10, '最相关仍在首位');
}

/* ⑥ 全距 0 不崩 */
{
  const items = [mk(3, 100, 1), mk(3, 1, 1), mk(3, 50, 1)];
  const out = fn(items, now, { rankMode: false });
  ok(out.length === 3, '全距 0 不崩');
}

/* ⑦ 随机对拍：300 组随机数据，产品顺序 == 期望顺序 */
{
  let diff = 0;
  for (let t = 0; t < 300; t++) {
    const n = 3 + (t % 20);
    const items = [];
    for (let i = 0; i < n; i++) items.push(mk(i, ((i * 53 + t * 7) % 500) + 1, (i % 3) + 1));
    const got = fn(items, now, { rankMode: true, rankTie: 2 });
    const exp = expectOrder(items, true, 2).map((a) => a.x);
    if (got.map((x) => x.rel).join() !== exp.map((x) => x.rel).join()) diff++;
  }
  console.log('⑦ 随机对拍 300 组：不一致 ' + diff);
  ok(diff === 0, '随机对拍全部一致');
}

console.log('\n产品函数直测：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
