/* 最小复现：OR 路径下「相关性第 2 名」是否被踢到池子末尾
 *
 * 病根在 rankRelevanceFirst 的最后一行：
 *     if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;
 * `g` 是**循环结束后的最终值**（= 最后一个组的编号），
 * 而第 2 名本该和 k=2 同属第 1 组。于是它被扔进最后一组 ⇒ 排到池尾。
 *
 * 本脚本用三种方式确认：
 *   ① 纯合成数据（rel = 0..9）直接复现
 *   ② 真实库取一个 OR 查询，看「按覆盖率第 2 名」最终排第几
 *   ③ 统计全体正例里，gold 恰好是「覆盖率第 1、2 名」时的命中率差异
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ck = require(path.join(ROOT, 'scripts', 'ck-memory.js'));
ck.configure({ dataDir: path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy'), log: () => {} });
const db = ck._internal.open();
const { ALL } = require('./all-cases.js');

const REL_TIE = 0.12;

/* 逐字照搬产品逻辑（含那行可疑代码），只把 rankKey 换成 0，
 * 目的是**隔离**：排除新鲜度影响，只看分组本身是否正确。 */
function groupOnly(items, tie) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  for (let k = 2; k < arr.length; k++) {
    if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
    arr[k].g = g;
  }
  if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;   // ← 可疑行：g 是最终值
  arr.sort((a, b) => a.g - b.g || a.i - b.i);
  return { order: arr.map((o) => o.x), buggyG: arr.map((o) => o.g) };
}

/* 修法：让 arr[1] 归入「它自己该在的组」，即 k=2 计算出的那个 g。 */
function groupFixed(items, tie) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  for (let k = 1; k < arr.length; k++) {            // 从 k=1 开始，第 2 名自然归组
    if (k >= 2 && arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
    arr[k].g = g;
  }
  if (trulyTied) arr[1].g = 0;
  arr.sort((a, b) => a.g - b.g || a.i - b.i);
  return { order: arr.map((o) => o.x), g: arr.map((o) => o.g) };
}

console.log('══ ① 纯合成数据复现（rankTie=0，即「完全不换位」）══');
{
  const items = Array.from({ length: 10 }, (_, i) => ({ rel: i, tag: 'R' + i }));
  const b = groupOnly(items, 0), f = groupFixed(items, 0);
  console.log('  输入顺序      : ' + items.map((x) => x.tag).join(' '));
  console.log('  现状输出      : ' + b.order.map((x) => x.tag).join(' '));
  console.log('  现状分组编号  : ' + b.buggyG.join(' '));
  console.log('  修复后输出    : ' + f.order.map((x) => x.tag).join(' '));
  const ok = b.order.map((x) => x.tag).join() === items.map((x) => x.tag).join();
  console.log('  ⇒ 现状' + (ok ? '一致' : '**打乱了**（第 2 名 ' + b.order.map((x) => x.tag)[8] + ' 被推到第 9 位）'));
}

console.log('\n══ ② rankTie=2（产品 OR 路径的现状）══');
{
  const items = Array.from({ length: 10 }, (_, i) => ({ rel: i, tag: 'R' + i }));
  const b = groupOnly(items, 2), f = groupFixed(items, 2);
  console.log('  输入顺序      : ' + items.map((x) => x.tag).join(' '));
  console.log('  现状输出      : ' + b.order.map((x) => x.tag).join(' '));
  console.log('  现状分组编号  : ' + b.buggyG.join(' '));
  console.log('  修复后输出    : ' + f.order.map((x) => x.tag).join(' '));
  console.log('  修复后分组    : ' + f.g.join(' '));
}

console.log('\n══ ③ 真实库：OR 查询里「覆盖率第 2 名」最终排第几 ══');
{
  /* 用 ck._internal.search 拿真实返回，再反查它的候选池名次。
   * 这里只做粗判：如果现状真的把第 2 名踢走，那返回的 top5 里
   * 会出现「池里名次 1、3、4、5、6」这种跳号。 */
  const S = ck._internal.search;
  let checked = 0, jumped = 0;
  for (const c of ALL) {
    if ((c.gold || []).length === 0) continue;
    if (c.cat !== 'numeric' && c.cat !== 'temporal') continue;
    const r = S(c.sid, c.q, c.k);
    if (r.via !== 'OR') continue;
    checked++;
    const seqs = (r.hits || []).map((h) => h.seq);
    const goldRank = c.gold.map((g) => { const i = seqs.indexOf(g); return i < 0 ? 0 : i + 1; })
      .filter((x) => x > 0)[0];
    if (goldRank && goldRank > 2) jumped++;
    if (checked <= 8) {
      console.log('  ' + c.id.padEnd(5) + ' via=OR cand=' + String(r.candidates).padStart(4)
        + ' gold=' + c.gold.join(',') + ' 返回前5=' + seqs.slice(0, 5).join(','));
    }
  }
  console.log('  OR 路径检查 ' + checked + ' 题，其中 gold 排在 3 名及以后 ' + jumped + ' 题');
}
