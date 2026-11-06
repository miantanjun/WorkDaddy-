/* 把评测库的「命中回写」清零 —— 让评测可重复
 *
 * 为什么必须这么做：
 *   产品 `search()` 在返回结果后会回写 `last_hit_ts = now`（ck-memory.js:2027），
 *   这是**生产环境的正确设计**（时间衰减的基准就是「上次被检索」）。
 *   但对评测是致命的：跑一次评测，被测的 gold 行就全变成「刚刚被检索过」，
 *   新鲜度一律被刷成 1.000 ⇒ 换位机制依赖的那个信号被评测自己抹平了。
 *
 * 实测后果：109 题里 106 题的 gold recency ∈ (0.85, 1.01]，而 gold 行的 ts 中位数
 *   是 15.3 天前（本该对应 recency≈0.7）。也就是说评测集从第二次跑起就测不到新鲜度差异。
 *
 * 清零后 recency 退回「按 ts 算」，这是库最原始的状态，也是可重复的基线。
 * ⚠️ 只在**评测副本库**上跑，绝不可对生产库执行。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, '.wd-tmp', 'evaldata', 'WorkDaddy');

/* 安全闸：只允许在 .wd-tmp/evaldata 下的副本库上操作 */
if (DATA.indexOf(path.join('.wd-tmp', 'evaldata')) < 0) {
  console.error('❌ 拒绝执行：dataDir 不是评测副本库 (' + DATA + ')');
  process.exit(2);
}

const { DatabaseSync } = require('node:sqlite');
const f = path.join(DATA, 'ck-memory', 'ck.db');
const db = new DatabaseSync(f);
const before = db.prepare('SELECT COUNT(*) c FROM seg WHERE COALESCE(last_hit_ts,0) > 0').get().c;
const beforeHits = db.prepare('SELECT COALESCE(SUM(COALESCE(hit_n,0)),0) s FROM seg').get().s;
db.exec('UPDATE seg SET last_hit_ts = 0, hit_n = 0');
const after = db.prepare('SELECT COUNT(*) c FROM seg WHERE COALESCE(last_hit_ts,0) > 0').get().c;
console.log('重置 last_hit_ts：' + before + ' 行有值 → ' + after + ' 行');
console.log('清掉 hit_n 总计 ' + beforeHits + ' 次');
db.close();
