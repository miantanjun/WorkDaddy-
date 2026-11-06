/* 评测前的「信号复位」守卫
 *
 * 为什么必须有它：
 *   产品 search() 会回写 last_hit_ts = now（ck-memory.js:2027）。这是生产环境的
 *   正确设计，但评测是**反复检索同一批题**，于是：
 *     第一轮跑完 ⇒ 被测 gold 的 last_hit_ts 全变成"刚刚"
 *     第二轮开始 ⇒ 所有 gold 的新鲜度都≈1.000，换位依赖的信号被自己抹平
 *   实测：跑完 run-eval2 后 98/107 条 gold 的 recency>0.999，
 *         而它们的真实 ts 中位数是 15.3 天前（本该 recency≈0.70）。
 *
 * ⇒ 任何「涉及新鲜度/换位」的评测，都必须在**读取之前**复位。
 *   复位后梯度才真实：p10=0.378 / p50=0.700 / p90=0.976。
 *
 * ⚠️ 只作用于 .wd-tmp/evaldata 下的副本库，有硬闸拦着，不会碰生产库。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');

function guard() {
  if (DATA.indexOf(path.join('.wd-tmp', 'evaldata')) < 0) {
    throw new Error('拒绝执行：dataDir 不是评测副本库 (' + DATA + ')');
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(DATA, 'ck-memory', 'ck.db'));
  const n = db.prepare('SELECT COUNT(*) c FROM seg WHERE COALESCE(last_hit_ts,0) > 0').get().c;
  if (n) db.exec('UPDATE seg SET last_hit_ts = 0, hit_n = 0');
  db.close();
  return n;
}

module.exports = { guard, DATA };

if (require.main === module) {
  const n = guard();
  console.log('已复位 ' + n + ' 行的 last_hit_ts（评测信号复位）');
}
