/* 修 bug 的最小验证：合成数据 + 三条不变量
 *
 * 三条不变量（源码注释里写明的）：
 *   ① 第 1 名独占 0 组 —— 不许被换位换掉
 *   ② 组内跨度 ≤ tie —— 跨了才另起一组
 *   ③ 组间严格按相关性，组内按 rankKey
 * 修 bug 只应影响②在「第 2 名」上的归属，不应破坏①和③。
 */
'use strict';
const RANK_TIE = 2;

function build(items, fixGroup, tie) {
  const arr = items.map((x, i) => ({ x, i, g: 0 }));
  arr.sort((a, b) => a.x.rel - b.x.rel || a.i - b.i);
  const trulyTied = arr.length > 1 && arr[1].x.rel === arr[0].x.rel;
  arr[0].g = 0;
  let g = trulyTied ? 0 : 1;
  let anchor = arr.length > 1 ? arr[1].x.rel : arr[0].x.rel;
  if (fixGroup) {
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : 1;
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
  } else {
    for (let k = 2; k < arr.length; k++) {
      if (arr[k].x.rel - anchor > tie) { g += 1; anchor = arr[k].x.rel; }
      arr[k].g = g;
    }
    if (arr.length > 1) arr[1].g = trulyTied ? 0 : g;
  }
  return arr;
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ❌ ' + msg); } };

/* 用例 1：名次制 rel=0..9，tie=2，rk 递增（让换位真的会重排） */
{
  const items = [];
  for (let i = 0; i < 10; i++) items.push({ rel: i, rk: 10 - i });   // rk 与 rel 反向
  const b = build(items, false, RANK_TIE);
  const f = build(items, true, RANK_TIE);
  console.log('用例1 名次制 0..9 / tie=2 / rk 反向');
  console.log('  现状分组 : ' + b.map((x) => x.g).join(' '));
  console.log('  修后分组 : ' + f.map((x) => x.g).join(' '));
  /* rel 0,1,2 一组（1-0=1<=2, 2-0=2<=2）；rel 3 与 anchor=1 差 2 <=2 仍进 1 组…
     直到某个 k 与 anchor 差 >2 才换组。anchor 是组的起点，注意这点。 */
  ok(f[0].g === 0, '不变量①：第 1 名必须在 0 组');
  ok(f[1].g <= 1, '修后第 2 名组号必须 ≤1，实际 ' + f[1].g);
  ok(f.every((x, i) => i === 0 || x.g >= f[i - 1].g), '组号必须单调不减');
  /* 组内跨度检查 */
  const byG = new Map();
  for (const x of f) { if (!byG.has(x.g)) byG.set(x.g, []); byG.get(x.g).push(x.x.rel); }
  let spanOk = true;
  for (const [k, v] of byG) {
    if (k === 0) continue;                       // 0 组是第 1 名独占（或真并列）
    const sp = Math.max(...v) - Math.min(...v);
    if (sp > RANK_TIE) { spanOk = false; console.log('    组 ' + k + ' 跨度 ' + sp + ' > tie'); }
  }
  ok(spanOk, '不变量②：非 0 组的跨度必须 ≤ tie');
  console.log('  现状把第 2 名放到第 ' + (b.map((x) => x.g).join(',') ? b.findIndex((x) => x.i === 1) + 1 : '?')
    + ' 组边界的 ' + b[1].g + ' 组（应为 1 组）');
}

/* 用例 2：真并列 —— 第 2 名与第 1 名分数完全相同，应进 0 组可被换位 */
{
  const items = [{ rel: 5, rk: 1 }, { rel: 5, rk: 9 }, { rel: 5, rk: 2 }, { rel: 9, rk: 3 }];
  const f = build(items, true, 2);
  console.log('\n用例2 真并列（前三条 rel 全 5）');
  console.log('  修后分组 : ' + f.map((x) => x.g).join(' '));
  ok(f[0].g === 0 && f[1].g === 0 && f[2].g === 0, '真并列时前三条都应进 0 组');
  ok(f[3].g === 1, '第 4 条（rel=9）应进 1 组，实际 ' + f[3].g);
}

/* 用例 3：单条 / 两条 边界 */
{
  const one = build([{ rel: 1, rk: 1 }], true, 2);
  ok(one.length === 1 && one[0].g === 0, '单条时 g=0');
  const two = build([{ rel: 1, rk: 1 }, { rel: 4, rk: 9 }], true, 2);
  console.log('\n用例3 两条（rel 1 / 4，差 3 > tie 2）');
  console.log('  修后分组 : ' + two.map((x) => x.g).join(' '));
  ok(two[0].g === 0 && two[1].g === 1, '两条不并列时 0 / 1');
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
