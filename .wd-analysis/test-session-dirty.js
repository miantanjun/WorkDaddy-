'use strict';
/*
 * test-session-dirty.js —— 上游 1.2.6 `scripts/session-dirty.js`（脏标记索引）的落地守卫。
 *
 * 背景（见 WorkDaddy-上游1.2.6吸纳建议报告-2026-09-24.md §3 A1 / §4 批次 1）：
 *   这是「会话同步更快」的骨架模块 —— 纯函数判据层，零业务耦合。批次 1 只**引入**，
 *   尚未接线（批次 3 才接 daemon/inject），所以本套件同时承担「模块本身正确」和
 *   「接线前的行为基线」两件事：接线时若把 fail-open 语义改坏，这里必须红。
 *
 * 本套件守五件事：
 *   [A] 模块契约 + 落地纪律（CRLF / mac 白名单两处）
 *   [B] ⚠️ **fail-open 语义**：没建立基线的账号一律当「脏」。
 *       搞错这一条的后果不是变慢，是**漏同步** —— 未初始化就返回 false 会静默跳过复制。
 *   [C] 标记与清除（含 `clear(expectedAt)` 的防竞态：陈旧通知不许抹掉新标记）
 *   [D] 脏数据净化（落盘 JSON 被人改坏、旧版本残留、类型错位）
 *   [E] prune：只清不在集合里的，且不许碰 initialized
 *
 * 跑法：node .wd-analysis/test-session-dirty.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'scripts', 'session-dirty.js');
const MAC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-mac-dmg.sh'), 'utf8');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

const dirty = require(MODULE);

/* ==================================================================== */
section('[A] 模块契约 + 落地纪律');
/* ==================================================================== */

ok(fs.existsSync(MODULE), 'A1 scripts/session-dirty.js 存在');
ok(typeof dirty.createDirtyIndex === 'function', 'A2 createDirtyIndex 是函数');
ok(dirty.VERSION === 1, 'A3 VERSION === 1（与上游一致，落盘版本号）', dirty.VERSION);
ok(Object.keys(dirty).sort().join(',') === 'VERSION,createDirtyIndex',
  'A4 导出面恰好两个（纯函数模块，不夹带副作用）', Object.keys(dirty).sort());

// 红线 2：scripts/*.js 必须纯 CRLF（注意 session-sync.js 是 fixture 产物、纯 LF，属例外）
const RAW = fs.readFileSync(MODULE);
const rawS = RAW.toString('latin1');
const crlf = (rawS.match(/\r\n/g) || []).length;
const totalN = (rawS.match(/\n/g) || []).length;
ok(crlf > 0 && totalN - crlf === 0, 'A5 纯 CRLF（裸 LF 必须为 0）', { crlf, bareLf: totalN - crlf });
ok(!RAW.toString('utf8').startsWith('\uFEFF'), 'A6 无 BOM');

// 红线 7：新增 scripts/*.js 必须同时进 mac DMG 白名单**两处**（for f in 列表 + chmod 列表）
const macHits = MAC.split('session-dirty.js').length - 1;
ok(macHits === 2, 'A7 已进 build-mac-dmg.sh 白名单两处（for f in + chmod）', macHits);
ok(/for f in [^\n]*session-sync\.js session-dirty\.js/.test(MAC),
  'A8 for f in 列表里紧跟 session-sync.js（与上游同位，且没整段照抄上游那行）');

/* ==================================================================== */
section('[B] ⚠️ fail-open：没建立基线就一律当脏（错了会漏同步）');
/* ==================================================================== */

{
  const idx = dirty.createDirtyIndex(null);

  ok(idx.shouldSync('uid-unseen', 's1') === true,
    'B1 完全没见过的账号 → true（fail-open；返回 false 会静默漏同步）');
  ok(idx.isInitialized('uid-unseen') === false, 'B2 没见过的账号 isInitialized=false');

  // 只 mark、没 baseline：最容易被写成「有标记 ⇒ 已初始化」，这是个陷阱
  idx.mark('uid-unseen', 's1', 'sessionUpdated');
  ok(idx.isInitialized('uid-unseen') === false,
    'B3 只 mark 不 markBaseline ⇒ initialized 仍是 false（标记 ≠ 基线）');
  ok(idx.shouldSync('uid-unseen', 's2') === true,
    'B4 未初始化账号即使已有一条标记，其他会话仍 → true（fail-open 不因标记而收口）');

  const changed1 = idx.markBaseline('uid-unseen');
  ok(changed1 === true, 'B5 markBaseline 首次返回 changed=true（调用方靠它决定是否落盘）');
  const changed2 = idx.markBaseline('uid-unseen');
  ok(changed2 === false, 'B6 markBaseline 再次返回 changed=false（幂等，不重复落盘）');
  ok(idx.isInitialized('uid-unseen') === true, 'B7 markBaseline 后 isInitialized=true');

  ok(idx.shouldSync('uid-unseen', 's1') === true,
    'B8 已基线 + **有**标记的会话 → true（该同步）');
  ok(idx.shouldSync('uid-unseen', 's2') === false,
    'B9 已基线 + **无**标记的会话 → false（这才是快路径的收益点）');
  ok(idx.shouldSync('uid-unseen', '') === false,
    'B10 已基线账号 + 空 id → false（account() 收掉空 uid，但空会话 id 不该被当脏）');
  ok(idx.shouldSync('', 's1') === true,
    'B11 空 uid → true（拿不到账号上下文时宁可全同步，不许猜）');
}

/* ==================================================================== */
section('[C] 标记与清除（含 clear(expectedAt) 防竞态）');
/* ==================================================================== */

{
  const idx = dirty.createDirtyIndex(null);
  idx.markBaseline('u1');

  const m = idx.mark('u1', 's1', 'sessionUpdated', 1000);
  ok(m && m.at === 1000 && m.event === 'sessionUpdated', 'C1 mark 返回写入的 marker', m);
  ok(idx.get('u1', 's1') && idx.get('u1', 's1').at === 1000, 'C2 get 按 uid+id 读回');
  ok(idx.get('u1', 'nope') === null, 'C3 get 不存在的会话 → null（不伪造）');

  // 幂等：同 at 再 mark 应回报「原有的那个」，让调用方知道没变化
  const again = idx.mark('u1', 's1', 'sessionUpdated', 1000);
  ok(again && again.at === 1000 && again.event === 'sessionUpdated',
    'C4 同 at 重复 mark → 返回原 marker（幂等，调用方可据此跳过落盘）');

  // 关键防竞态：标记已被新事件推进后，带旧 at 的 clear 必须**拒绝**
  idx.mark('u1', 's1', 'sessionUpdated', 2000);
  ok(idx.clear('u1', 's1', 1000) === false,
    'C5 clear 带陈旧 expectedAt → false（旧通知不许抹掉已推进的新标记）');
  ok(idx.get('u1', 's1') && idx.get('u1', 's1').at === 2000,
    'C6 被判陈旧后标记仍在（拒绝是真拒绝，不是删了又写回）');
  ok(idx.clear('u1', 's1', 2000) === true, 'C7 clear 带匹配 expectedAt → true');
  ok(idx.get('u1', 's1') === null, 'C8 clear 之后确实没了');
  ok(idx.clear('u1', 's1') === false, 'C9 重复 clear → false（不抛错）');
  ok(idx.shouldSync('u1', 's1') === false,
    'C10 清掉标记后回到「不脏」（这正是复制成功后该做的事）');
}

/* ==================================================================== */
section('[D] 脏数据净化（落盘 JSON 被改坏 / 旧版本残留 / 类型错位）');
/* ==================================================================== */

{
  const idx = dirty.createDirtyIndex({
    version: 99,
    accounts: {
      good: { initialized: true, sessions: { s1: { at: 5, event: 'e' } } },
      bad1: { initialized: 'yes', sessions: { s1: { at: 0 } } },        // at 非法
      bad2: { initialized: false, sessions: { s1: 'nope', s2: { at: 7 } } }, // marker 非对象
      bad3: 'not-an-object',
      bad4: { initialized: true, sessions: [1, 2, 3] },                  // sessions 是数组
    },
  });

  ok(idx.isInitialized('good') === true && idx.get('good', 's1').at === 5,
    'D1 合法数据原样读回');
  ok(idx.isInitialized('bad1') === false && idx.get('bad1', 's1') === null,
    'D2 at 非正数的标记被丢弃（坏行不许保留成「脏」）');
  ok(idx.get('bad2', 's1') === null && idx.get('bad2', 's2').at === 7,
    'D3 marker 非对象丢弃，同账号的合法标记保留（逐条净化，不整块放弃）');
  ok(idx.get('bad3', 's1') === null && idx.isInitialized('bad3') === false,
    'D4 账号值不是对象 → 直接跳过');
  ok(idx.get('bad4', 's1') === null && idx.isInitialized('bad4') === true,
    'D5 sessions 是数组 → 视为空容器，但 initialized 位照旧认');

  // 旧版本号不该让整份状态失效 —— 但它也**不**因此就把账号当已初始化
  ok(idx.isInitialized('good') === true, 'D6 version 字段为陌生值时仍按内容解析（不整份丢弃）');

  // 落盘往返：JSON 序列化再重建，语义必须一致
  const round = dirty.createDirtyIndex(JSON.parse(JSON.stringify(idx.state)));
  ok(round.isInitialized('good') === true
    && round.get('good', 's1').at === 5
    && round.shouldSync('good', 's2') === false,
    'D7 state 经 JSON 往返后语义一致（落盘读回不丢基线）');

  // event 截断：上游 slice(0,40)，防事件名被拿来当数据通道
  const long = dirty.createDirtyIndex(null);
  const mk = long.mark('u', 's', 'x'.repeat(200), 1);
  ok(mk.event.length === 40, 'D8 event 截断到 40 字符', mk.event.length);
}

/* ==================================================================== */
section('[E] prune：只清不在有效集合里的，且不碰 initialized');
/* ==================================================================== */

{
  const idx = dirty.createDirtyIndex(null);
  idx.markBaseline('u');
  idx.mark('u', 'keep', 'sessionUpdated', 1);
  idx.mark('u', 'drop', 'sessionUpdated', 2);

  const changed = idx.prune('u', new Set(['keep']));
  ok(changed === true, 'E1 有会话被清掉 → changed=true');
  ok(idx.get('u', 'keep') && idx.get('u', 'drop') === null, 'E2 只清不在有效集合里的');
  ok(idx.isInitialized('u') === true, 'E3 prune 不许把 initialized 带走（清了基线就退化成全量同步）');
  ok(idx.prune('u', new Set(['keep'])) === false, 'E4 无可清对象 → false（不谎报变化）');
  ok(idx.prune('u', null) === false && idx.get('u', 'keep') !== null,
    'E5 validIds 形状不对 → false 且一个都不删（宁可留脏，不许误清）');
  ok(idx.prune('never-seen', new Set([])) === false, 'E6 未知账号 → false（不创建空账号）');
}

console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
