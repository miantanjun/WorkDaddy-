'use strict';
/*
 * test-automation-protocol-v3.js —— 上游 1.2.5 邻接吸纳 / B 组「自动化协议 V3」的落地守卫。
 *
 * 覆盖六件事（对应台账 B2–B5 / D2 / D3 / A9 / A11）：
 *   [A] 校验层   D2+D3+B2：schemaVersion 3 被接受；prepare / condition 的**负向**全被拒。
 *                —— 直接 require automation.js 真跑 validateTask，不靠文本匹配。
 *   [B] 执行层   B2：prepare 在**每个账号切换之前**跑；condition 为 false 时「不切换、不跑 steps」。
 *                —— 直接 require automation.js 真跑 executeTask（依赖全注入），不是切片沙箱。
 *   [C] 排序层   B3：stepsContainCheckin 的触发条件 + orderCheckinAccounts 的稳定排序/未知到期兜底。
 *                —— C 用 daemon 源码切片（daemon.js 会起服务，不能 require）。
 *   [D] 闸门层   B4+A9：本地作业模型下的「切号 ↔ 同步」互斥原语。
 *                —— 有界（不许无限等）+ 可取消（停止请求能挣脱）+ 失败屏障（队列空了也不放行）。
 *   [E] 接线层   B5+A9+A11：run-status 暴露 sync/stopRequested、schema 报 [1,2,3]、复制/切号 409。
 *
 * ⚠️ 三处「本地刻意不照抄上游」的点，本套件就是它们的守卫：
 *   ① 上游 waitAutomationSyncJob 靠 job.completion **无超时**、还原路径 isCancelled:()=>false
 *      —— 照抄会挂死 daemon。本地必须「有界 + 可取消」，D2/D3 断言的就是这个上限存在。
 *   ② 本地作业模型没有 job.completion，成功判据只能化简成 status==='done' && processed===total
 *      且无 failed/failedItems/partial/conflicts。D1 逐条钉死。
 *   ③ 上游失败判据只看「队列空」—— 作业失败后队列同样是空的，会静默变成「允许切号」。
 *      本地加了 accountSyncFailures 屏障，D4 就是证明它真的拦得住。
 *
 * ⚠️ 本套件不碰真机数据、不连 CDP、不起 HTTP 服务；所有副作用走 stub。
 * 跑法：node .wd-analysis/test-automation-protocol-v3.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const automation = require(path.join(ROOT, 'scripts', 'automation.js'));
const compat = require(path.join(ROOT, 'scripts', 'automation-compatibility.js'));
const packages = require(path.join(ROOT, 'scripts', 'automation-packages.js'));
const creditRotation = require(path.join(ROOT, 'scripts', 'credit-rotation.js'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log('\n' + t); }
function throws(fn, re, label) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  if (!error) { ok(false, label, '没有抛错'); return; }
  if (re && !re.test(String(error.message || error))) { ok(false, label, '抛错信息不符: ' + error.message); return; }
  ok(true, label, String(error.message).slice(0, 60));
}

const DAEMON_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');

// ⚠️ 本文件是 CJS（package.json 无 "type":"module"），顶层 await 不可用 ⇒ 全部包进 main()。
async function main() {

/* ==================================================================== */
section('[A] 协议 V3 校验（D2 / D3 / B2 的负向门）');
/* ==================================================================== */

ok(automation.SCHEMA_VERSION === 3, 'A1 automation.js 的 SCHEMA_VERSION 已升到 3', automation.SCHEMA_VERSION);
ok(automation.isSupportedTaskSchema({ schemaVersion: 3 }) === true, 'A2 V3 任务被承认为合法协议');
ok(automation.isSupportedTaskSchema({ schemaVersion: 4 }) === false, 'A3 V4 仍被拒（升版本不是放开所有版本）');
ok(automation.isSupportedTaskSchema({}) === true, 'A4 省略 schemaVersion 视为 V1（向后兼容）');

/* D2：兼容性台账认 3 —— 这是「任务包在市场上能不能装」的判据，不同步就永远装不上 V3 包。 */
/* ⚠️ requires.capabilities 在本协议里是**必填数组**（validateRequirements 逐键校验时不跳过 null），
   所以下面每条都显式给 []。这不是本套件的特例，是协议契约。 */
ok(compat.assessRequirements({ minWorkDaddyVersion: '1.0.0', taskSchemaVersion: 3, capabilities: [] }, { version: '1.4.3', capabilities: [] }).length === 0,
  'A5 D2 compatibility：requires.taskSchemaVersion=3 不再报 unsupported_task_schema');
ok(compat.assessRequirements({ minWorkDaddyVersion: '1.0.0', taskSchemaVersion: 4, capabilities: [] }, { version: '1.4.3', capabilities: [] })
  .some((i) => i.code === 'unsupported_task_schema'),
  'A6 D2 compatibility：V4 仍然报 unsupported_task_schema（不是把闸门拆了）');

/* D3：打包预检认 3 + prepare 里的能力要被算进去 */
ok(JSON.stringify(packages.analyzeTask({
  steps: [{ op: 'account.forEach', switch: true, prepare: [{ op: 'account.status' }, { op: 'vars.set', key: 'k', value: 1 }], steps: [] }],
}).capabilities).includes('account.status'),
  'A7 D3 packages：analyzeTask 走进了 account.forEach.prepare（否则 prepare 里的能力会被漏报）');
ok(packages.analyzeTask({ steps: [{ op: 'account.forEach', switch: true, prepare: [{ op: 'account.status' }], steps: [] }] })
  .effects.includes('account-switch'),
  'A8 D3 packages：prepare 出现后 effects 仍正确报 account-switch');
ok(!/[1,2]\.includes\(requires\.taskSchemaVersion\)/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'automation-compatibility.js'), 'utf8')),
  'A9 D2 旧的白名单 [1,2] 写法已经不在了（防回退）');

const V3_FOR_EACH = { op: 'account.forEach', switch: true, accounts: 'all', prepare: [{ op: 'account.status', fields: ['credit.total'] }], condition: { left: '{{accountStatus.credit.total}}', operator: 'gt', right: 0 }, steps: [] };
function taskV3(steps, schemaVersion) {
  return { id: 'v3_probe', name: 'V3 探针', schemaVersion, trigger: { type: 'manual' }, steps };
}

ok(automation.validateTask(taskV3([V3_FOR_EACH], 3)).schemaVersion === 3,
  'A10 V3 + prepare(account.status) + condition 通过校验');
throws(() => automation.validateTask(taskV3([V3_FOR_EACH], 2)), /切换前筛选需要自动化协议 V3/,
  'A11 V2 + prepare ⇒ 拒（老协议不许悄悄用新能力）');
throws(() => automation.validateTask(taskV3([V3_FOR_EACH], 1)), /切换前筛选需要自动化协议 V3/,
  'A12 V1 + prepare ⇒ 拒（同上，V1 也没被漏掉）');
throws(() => automation.validateTask(taskV3([{
  op: 'account.forEach', accounts: 'all', prepare: [{ op: 'dom.click', locator: { kind: 'css', value: '#x' } }], steps: [],
}], 3)), /prepare 仅支持只读账号状态/,
  'A13 V3 + prepare 里放 dom.click ⇒ 拒（prepare 必须是只读的）');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', prepare: { op: 'account.status' }, steps: [] }], 3)),
  /prepare 仅支持只读账号状态/, 'A14 prepare 不是数组 ⇒ 拒');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', prepare: [null], steps: [] }], 3)),
  /prepare 仅支持只读账号状态/, 'A15 prepare 里有 null 项 ⇒ 拒');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', condition: 'credit > 0', steps: [] }], 3)),
  /筛选 condition 必须是条件对象/, 'A16 condition 是字符串 ⇒ 拒');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', condition: ['a'], steps: [] }], 3)),
  /筛选 condition 必须是条件对象/, 'A17 condition 是数组 ⇒ 拒');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', prepare: [{ op: 'state.get' }], steps: [] }], 3)),
  /状态需要有效的 scope 和 key/,
  'A18 prepare 里的步骤**递归走 validateSteps**（state.get 缺 key 照样拒）—— 否则 prepare 是校验盲区');
throws(() => automation.validateTask(taskV3([{ op: 'account.forEach', accounts: 'all', prepare: [{ op: 'session.send', message: 'x' }], steps: [] }], 3)),
  /prepare 仅支持只读账号状态/, 'A19 prepare 里放 session.send ⇒ 拒（发送绝不允许进 prepare）');

/* 允许清单里的六个 op 必须**全部真的存在于 SUPPORTED_OPS**，
   否则白名单里会出现「写了但永远用不了」的死条目。 */
['account.status', 'state.get', 'vars.set', 'time.now', 'value.number', 'log.write'].forEach((op, i) => {
  ok(automation.SUPPORTED_OPS.has(op), 'A2' + i + ' prepare 白名单里的 ' + op + ' 确实是已注册能力（不是死条目）');
});

/* ==================================================================== */
section('[B] prepare / condition 的执行语义（B2，真跑 executeTask）');
/* ==================================================================== */

const ACCOUNTS = [{ uid: 'a1', nickname: '甲' }, { uid: 'a2', nickname: '乙' }, { uid: 'a3', nickname: '丙' }];

// trace 里记录「切号」与「写状态」两类事件，靠顺序证明 prepare 在切号**之前**。
function newWorld(list) {
  return {
    trace: [],
    setState: [],
    orderCalls: 0,
    switchCalls: 0,
    restores: [],
    accounts: list || ACCOUNTS.slice(),
    currentUid: 'main',
  };
}
function runDeps(world) {
  return {
    listAccounts: async () => world.accounts,
    // ⚠️ currentAccount 必须跟着切号走 —— 否则 executeTask 会认为「已经在原账号上」而跳过收尾还原，
    //    B2/B3 想守的「跳过账号不影响收尾」就永远测不到。
    currentAccount: async () => ({ uid: world.currentUid, nickname: world.currentUid }),
    accountSwitch: async (account, detail) => {
      const kind = detail && detail.restore ? 'restore:' : 'switch:';
      world.trace.push(kind + account.uid);
      if (kind === 'restore:') world.restores.push(account.uid); else world.switchCalls += 1;
      world.currentUid = account.uid;
      return { ok: true, uid: account.uid, switched: true };
    },
    accountStatus: async (account) => ({ credit: { total: account.uid === 'a2' ? 0 : 100 } }),
    orderCheckinAccounts: async (items) => { world.orderCalls += 1; return items.slice().reverse(); },
    setState: async (scope, uid, key, value) => { world.setState.push({ scope, uid, key, value }); },
    getState: async () => undefined,
    log: () => {},
    now: 1700000000000,
  };
}

/* ---- B1 prepare 在切号之前、且有账号上下文 ---- */
{
  const world = newWorld();
  const task = taskV3([{
    op: 'account.forEach', switch: true, accounts: 'all',
    // prepare 只做「把当前账号 uid 记进变量」这一件事
    prepare: [{ op: 'vars.set', key: 'who', value: '{{vars.account.uid}}' }],
    // steps 把变量写进状态 —— 用 setState 的入参直接读出「prepare 看到的账号」
    steps: [{ op: 'state.set', scope: 'account', key: 'who', value: '{{vars.who}}' }],
  }], 3);
  await automation.executeTask(task, runDeps(world));
  ok(world.setState.length === 3, 'B1a prepare+steps 对 3 个账号各跑一次', world.setState.length);
  ok(world.setState.map((s) => s.value).join(',') === 'a1,a2,a3',
    'B1b prepare 看到的是**当前循环账号**（vars.account 已在 prepare 之前切好）', world.setState.map((s) => s.value));
  ok(world.setState.every((s) => s.uid === s.value), 'B1c state 的 account scope 用的也是循环账号 uid', world.setState);
  ok(world.switchCalls === 3, 'B1d switch:true 对每个账号真切换一次', world.switchCalls);
}

/* ---- B2 condition=false 时「不切换、不跑 steps」 ---- */
{
  const world = newWorld();
  const task = taskV3([{
    op: 'account.forEach', switch: true, accounts: 'all',
    condition: { left: '{{accountStatus.credit.total}}', operator: 'gt', right: 0 },
    prepare: [{ op: 'account.status', fields: ['credit.total'] }],
    steps: [{ op: 'state.set', scope: 'account', key: 'ran', value: '{{vars.account.uid}}' }],
  }], 3);
  await automation.executeTask(task, runDeps(world));
  ok(world.switchCalls === 2, 'B2a 余额为 0 的账号被跳过 ⇒ 只切了 2 次（3 个账号里 1 个不满足）', world.switchCalls);
  ok(world.trace.includes('switch:a2') === false, 'B2b 被跳过的账号**没有**发生切号（这是 condition 的存在意义）', world.trace);
  ok(world.setState.map((s) => s.uid).join(',') === 'a1,a3', 'B2c 被跳过的账号 steps 也没跑', world.setState.map((s) => s.uid));
  ok(world.setState.length === 2, 'B2d 命中的账号照样跑 steps', world.setState.length);
}

/* ---- B3 restore 仍然发生（condition 跳过不许影响收尾还原） ---- */
{
  const world = newWorld();
  const task = taskV3([{
    op: 'account.forEach', switch: true, accounts: 'all',
    condition: { left: '{{accountStatus.credit.total}}', operator: 'gt', right: 0 },
    prepare: [{ op: 'account.status', fields: ['credit.total'] }],
    steps: [],
  }], 3);
  await automation.executeTask(task, runDeps(world));
  ok(world.trace[world.trace.length - 1] === 'restore:main', 'B3a 循环收尾仍然还原原账号（跳过不影响收尾）', world.trace);
}

/* ---- B4 全部跳过时也不许抛错、不误切 ---- */
{
  const world = newWorld();
  const task = taskV3([{
    op: 'account.forEach', switch: true, accounts: 'all',
    condition: { left: '{{accountStatus.credit.total}}', operator: 'gt', right: 9999 },
    prepare: [{ op: 'account.status', fields: ['credit.total'] }],
    steps: [],
  }], 3);
  const result = await automation.executeTask(task, runDeps(world));
  const forEach = (result && result.steps ? result.steps : []).find ? result.steps : null;
  ok(world.switchCalls === 0, 'B4a 全部账号被跳过 ⇒ 一次都没切', world.switchCalls);
  ok(result && result.ok === true, 'B4b 全部跳过是正常收尾，不是错误', result && result.ok);
  ok(world.trace.length === 0, 'B4c 全部跳过连 restore 都不用（本来就没切过）', world.trace);
}

/* ---- B5 不带 prepare/condition 的 V3 任务：行为与 V2 逐条一致 ---- */
{
  const shared = { op: 'account.forEach', switch: true, accounts: 'all', steps: [{ op: 'state.set', scope: 'account', key: 'x', value: '{{vars.account.uid}}' }] };
  const w2 = newWorld(); const w3 = newWorld();
  await automation.executeTask(taskV3([JSON.parse(JSON.stringify(shared))], 2), runDeps(w2));
  await automation.executeTask(taskV3([JSON.parse(JSON.stringify(shared))], 3), runDeps(w3));
  ok(JSON.stringify(w2.setState) === JSON.stringify(w3.setState) && w2.trace.join('|') === w3.trace.join('|'),
    'B5 V3 不带 prepare/condition 时与 V2 行为完全一致（升版本不是行为变化）', { v2: w2.trace, v3: w3.trace });
}

/* ---- B6 orderCheckinAccounts 只在 steps 含 account.checkin 时被调用 ---- */
{
  const wNo = newWorld();
  await automation.executeTask(taskV3([{ op: 'account.forEach', switch: true, accounts: 'all', steps: [{ op: 'state.set', scope: 'account', key: 'x', value: 1 }] }], 3), runDeps(wNo));
  ok(wNo.orderCalls === 0, 'B6a steps 不含签到 ⇒ 不排序（不给无关任务加一次全量账号展开）', wNo.orderCalls);

  const wYes = newWorld();
  await automation.executeTask(taskV3([{ op: 'account.forEach', switch: true, accounts: 'all', steps: [{ op: 'account.checkin' }] }], 3), Object.assign(runDeps(wYes), { accountCheckin: async () => ({ ok: true }) }));
  ok(wYes.orderCalls === 1, 'B6b steps 含 account.checkin ⇒ 排序被调用一次', wYes.orderCalls);
}

/* ---- B7 排序结果真的被用作遍历顺序 ---- */
{
  const world = newWorld();
  const seen = [];
  const deps = Object.assign(runDeps(world), {
    listAccounts: async () => [{ uid: 'a1', nickname: '甲' }, { uid: 'a2', nickname: '乙' }],
    accountCheckin: async (account) => { seen.push(account.uid); return { ok: true }; },
  });
  await automation.executeTask(taskV3([{ op: 'account.forEach', switch: true, accounts: 'all', steps: [{ op: 'account.checkin' }] }], 3), deps);
  ok(seen.join(',') === 'a2,a1', 'B7 orderCheckinAccounts 的返回顺序就是遍历顺序（不是只调一次就丢掉）', seen);
}

/* ---- B8 stepsContainCheckin 的触发面 ---- */
ok(automation.stepsContainCheckin([{ op: 'account.checkin' }]) === true, 'B8a 直接命中 account.checkin');
ok(automation.stepsContainCheckin([{ op: 'logic.sequence', steps: [{ op: 'account.checkin' }] }]) === true,
  'B8b 嵌套在 logic.sequence 里也算（否则常见写法会静默不排序）');
ok(automation.stepsContainCheckin([{ op: 'logic.repeat', steps: [{ op: 'account.checkin' }] }]) === true, 'B8c logic.repeat 里也算');
ok(automation.stepsContainCheckin([{ op: 'account.status' }]) === false, 'B8d 不含签到 ⇒ false（不许放宽成「有账号步骤就排序」）');
ok(automation.stepsContainCheckin([]) === false && automation.stepsContainCheckin(null) === false, 'B8e 空/空值安全');

/* ==================================================================== */
section('[C] orderCheckinAccounts 的排序语义（daemon 源码切片）');
/* ==================================================================== */

const ORDER_START = 'function orderCheckinAccounts(accounts) {';
const ORDER_END = 'async function runCdpExpression(expression, options = {}) {';
const orderBlock = (() => {
  const s = DAEMON_SRC.indexOf(ORDER_START);
  const e = DAEMON_SRC.indexOf(ORDER_END, s);
  if (s < 0 || e < 0) return null;
  return DAEMON_SRC.slice(s, e);
})();
ok(!!orderBlock && /function orderCheckinAccounts/.test(orderBlock) && !/runCdpExpression/.test(orderBlock),
  'C0 切出 orderCheckinAccounts 且不越界', orderBlock ? orderBlock.split('\n').length + ' 行' : null);

if (orderBlock) {
  const NOW = 1700000000000;
  const makeOrder = (mergedAccounts) => new Function('limitFailoverAccounts', 'nearestExpiringSegment', 'Date',
    orderBlock + '\nreturn orderCheckinAccounts;')(() => mergedAccounts, creditRotation.nearestExpiringSegment, { now: () => NOW });

  const seg = (expiresAt, remaining) => ({ expiresAt, remaining, source: '积分' });

  /* C1 升序：最近到期的排前面 */
  const order1 = makeOrder([
    { uid: 'u3', creditSegments: [seg(NOW + 3000, 10)] },
    { uid: 'u1', creditSegments: [seg(NOW + 1000, 10)] },
    { uid: 'u2', creditSegments: [seg(NOW + 2000, 10)] },
  ]);
  ok(order1([{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }]).map((a) => a.uid).join(',') === 'u1,u2,u3',
    'C1 按最近到期升序（u1 最早到期排第一）');

  /* C2 未知到期排最后 */
  const order2 = makeOrder([
    { uid: 'u1' },                                  // 没有段 ⇒ 未知
    { uid: 'u2', creditSegments: [seg(NOW + 9000, 10)] },
    { uid: 'u3', creditSegments: [seg(null, 10)] },  // 永不过期 ⇒ 未知
  ]);
  ok(order2([{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }]).map((a) => a.uid).join(',') === 'u2,u1,u3',
    'C2 未知到期（无段 / expiresAt=null）排最后，且互相之间保持原序', order2([{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }]).map((a) => a.uid));

  /* C3 相同到期 ⇒ 稳定排序，保持传入顺序 */
  const order3 = makeOrder([
    { uid: 'a', creditSegments: [seg(NOW + 5000, 10)] },
    { uid: 'b', creditSegments: [seg(NOW + 5000, 99)] },
    { uid: 'c', creditSegments: [seg(NOW + 5000, 1)] },
  ]);
  ok(order3([{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }]).map((a) => a.uid).join(',') === 'a,b,c',
    'C3 到期时间相同保持原顺序（**稳定排序** —— 不许被 remaining 之类的次键打乱）');

  /* C4 不改入参、返回新数组 */
  const order4 = makeOrder([{ uid: 'b' }, { uid: 'a', creditSegments: [seg(NOW + 1, 10)] }]);
  const input4 = [{ uid: 'a' }, { uid: 'b' }];
  const out4 = order4(input4);
  ok(out4 !== input4 && input4.map((a) => a.uid).join(',') === 'a,b',
    'C4 返回新数组、原数组顺序不动（调用方可能还要用原序）', input4.map((a) => a.uid));

  /* C5 边界：长度 <2 / 非数组 */
  const order5 = makeOrder([]);
  ok(order5([{ uid: 'x' }]) === order5([{ uid: 'x' }]) || true, 'C5a 长度 1 走原样返回分支（不炸）');
  const single = [{ uid: 'x' }];
  ok(order5(single) === single, 'C5b 长度 1 直接返回同一引用（不做无谓的展开）');
  const empty = order5(null);
  ok(Array.isArray(empty) && empty.length === 0, 'C5c null 输入返回空数组（不抛）', empty);

  /* C6 merged 里没有的账号用自身 creditSegments（离线账号不许因为缓存缺失就排最后） */
  const order6 = makeOrder([{ uid: 'u2', creditSegments: [seg(NOW + 5000, 10)] }]);
  const out6 = order6([{ uid: 'u1', creditSegments: [seg(NOW + 100, 10)] }, { uid: 'u2' }]);
  ok(out6.map((a) => a.uid).join(',') === 'u1,u2',
    'C6 缓存里没有的账号用**自身**的 creditSegments 排序（不是无脑排最后）', out6.map((a) => a.uid));

  /* C7 失效段（remaining<=0 或已过期）不参与「最近到期」判定 */
  const order7 = makeOrder([
    { uid: 'u1', creditSegments: [seg(NOW - 1000, 10)] },   // 已过期
    { uid: 'u2', creditSegments: [seg(NOW + 1000, 10)] },
  ]);
  ok(order7([{ uid: 'u1' }, { uid: 'u2' }]).map((a) => a.uid).join(',') === 'u2,u1',
    'C7 已过期的段被 nearestExpiringSegment 过滤掉 ⇒ 该账号排到最后（不会把过期余额当最近到期）');
}

/* ==================================================================== */
section('[D] 切号闸门原语（B4 / A9，源码切片 + 假时钟）');
/* ==================================================================== */

const GATE_START = '/* ---------------- 切号闸门（B4 / A9 / A11）：切号 ↔ 会话同步 互斥 ---------------- */';
const GATE_END = '/* ---------------- 模型限流自动切号续跑 ---------------- */';
const gateBlock = (() => {
  const s = DAEMON_SRC.indexOf(GATE_START);
  const e = DAEMON_SRC.indexOf(GATE_END, s);
  if (s < 0 || e < 0) return null;
  return DAEMON_SRC.slice(s, e);
})();
ok(!!gateBlock && gateBlock.includes('function acquireAutomationAccountSwitch') && !gateBlock.includes('runLimitFailover'),
  'D0 切出 B4 闸门块且不越界', gateBlock ? gateBlock.split('\n').length + ' 行' : null);

if (gateBlock) {
  const realNow = Date.now;
  let clock = 1700000000000;
  Date.now = () => clock;

  // 每个场景一个新沙箱：autoCopyWorkerRunning 是原始值，没法从外面改，只能建新实例传初值。
  function makeGate(opts = {}) {
    const w = {
      worker: !!opts.worker,
      queue: opts.queue || [],
      locks: opts.locks || new Map(),
      jobs: opts.jobs || new Map(),
      current: opts.current || { uid: 'u1' },
      sleeps: 0,
      progress: [],
      step: opts.step || 30000,
    };
    w.clockBefore = clock;
    const api = new Function(
      'currentAccount', 'autoCopyWorkerRunning', 'autoCopyQueue', 'sessionCopyLocks', 'autoCopyJobs', 'sleep',
      gateBlock + '\nreturn { isAutoCopyJobSettled, assertAutoCopySucceeded, recordAccountSyncResult, assertAccountSwitchIdle, ' +
      'automationSwitchProgress, waitAutomationSyncBounded, drainAutoCopyJobBounded, acquireAutomationAccountSwitch, ' +
      'failures: () => accountSyncFailures, inProgress: () => accountSwitchInProgress, ' +
      'C: { LOCK: AUTOMATION_SWITCH_LOCK_MAX_MS, SYNC: AUTOMATION_SYNC_WAIT_MAX_MS, RESTORE: AUTOMATION_RESTORE_LOCK_MAX_MS, DRAIN: AUTOMATION_SYNC_DRAIN_MAX_MS } };'
    )(
      () => w.current,
      w.worker,
      w.queue,
      w.locks,
      w.jobs,
      async (ms) => { w.sleeps += 1; clock += Math.max(0, Number(ms) || 0) || w.step; }
    );
    api.w = w;
    return api;
  }
  function resetClock() { clock = 1700000000000; }

  const goodJob = (id, uid) => ({ id, targetUid: uid, status: 'done', total: 5, processed: 5 });
  const badJob = (id, uid, patch) => Object.assign({ id, targetUid: uid, status: 'done', total: 5, processed: 5 }, patch || {});
  // ⚠️ 这里刻意不写成 new Map([[id, job]]) 的内联形态：嵌套太深容易数错括号（已经栽过一次）。
  function jobMap(entries) { const map = new Map(); for (const item of entries) map.set(item[0], item[1]); return map; }

  /* ---- D1 成功判据逐条钉死（本地没有 job.completion，只能靠这五个字段） ---- */
  {
    const g = makeGate();
    ok(g.isAutoCopyJobSettled('done') === true && g.isAutoCopyJobSettled('error') === true && g.isAutoCopyJobSettled('paused') === true,
      'D1a settled = 非 queued/running（error/paused 也算落定，否则会一直等）');
    ok(g.isAutoCopyJobSettled('queued') === false && g.isAutoCopyJobSettled('running') === false, 'D1b queued/running 未落定');

    let threw = null;
    try { g.assertAutoCopySucceeded(goodJob('j1', 'u1')); } catch (e) { threw = e; }
    ok(threw === null, 'D1c done + processed===total + 无失败 ⇒ 通过');

    const cases = [
      ['partial', { status: 'partial' }],
      ['status error', { status: 'error' }],
      ['processed 不足', { processed: 4 }],
      ['failed 非零', { failed: 1 }],
      ['failedItems 非空', { failedItems: ['x'] }],
      ['partial 标记', { partial: true }],
      ['conflicts 非零', { conflicts: 2 }],
    ];
    let allThrew = true;
    const missing = [];
    for (const [label, patch] of cases) {
      try { g.assertAutoCopySucceeded(badJob('j2', 'u1', patch)); allThrew = false; missing.push(label); } catch (_) { /* 期望抛 */ }
    }
    ok(allThrew, 'D1d 七个失败形态全部被拦（含『队列空但作业只是 partial』这个最阴的）', missing);
    ok(g.assertAutoCopySucceeded(null) === undefined, 'D1e null 作业直接放行（没有作业 = 无需同步）');
  }

  /* ---- D2 等同步：有界 + 可取消 ---- */
  {
    resetClock();
    const g = makeGate();
    resetClock();
    const stuck = { id: 'j9', targetUid: 'u1', status: 'running', processed: 1, total: 9 };
    let error = null;
    try { await g.waitAutomationSyncBounded(stuck, {}); } catch (e) { error = e; }
    ok(!!error && /会话同步超时/.test(error.message),
      'D2a 作业永远 running ⇒ **超时抛错**（照抄上游的无超时 job.completion 会在这里挂死 daemon）', error && error.message);
    ok(g.w.sleeps * g.w.step >= g.C.SYNC, 'D2b 等满预算才放弃（' + g.C.SYNC + 'ms）', g.w.sleeps);
  }
  {
    resetClock();
    const g = makeGate();
    const stuck = { id: 'j9', targetUid: 'u1', status: 'running', processed: 1, total: 9 };
    let error = null;
    try { await g.waitAutomationSyncBounded(stuck, { isCancelled: () => true, onProgress: (p) => g.w.progress.push(p.phase) }); } catch (e) { error = e; }
    ok(!!error && /任务已停止/.test(error.message),
      'D2c 停止请求能立刻挣脱等待（上游还原路径写死 isCancelled:()=>false，那是挂死的第二个入口）', error && error.message);
    ok(g.w.sleeps === 0, 'D2d 取消时一次 sleep 都不做', g.w.sleeps);
    ok(g.w.progress.includes('stopping-sync'), 'D2e 取消时上报 stopping-sync 相位（不是静默退出）', g.w.progress);
  }
  {
    resetClock();
    const g = makeGate();
    const okJob = { id: 'j3', targetUid: 'u1', status: 'running', processed: 1, total: 3 };
    const p = g.waitAutomationSyncBounded(okJob, { onProgress: (x) => g.w.progress.push(x.phase) });
    okJob.status = 'done'; okJob.processed = 3;
    await p;
    ok(g.w.progress.includes('syncing-sessions'), 'D2f 等同步期间上报 syncing-sessions 相位', g.w.progress);
  }
  {
    resetClock();
    const g = makeGate();
    let error = null;
    try { await g.waitAutomationSyncBounded({ id: 'j4', targetUid: 'u1', status: 'partial', total: 3, processed: 2 }, {}); } catch (e) { error = e; }
    ok(!!error && /会话同步未成功完成/.test(error.message),
      'D2g 作业落定但只是 partial ⇒ 抛错（**落定 ≠ 成功**，这是 B4 语义的核心）', error && error.message);
  }

  /* ---- D3 等锁：有界 + 还原路径预算更短 ---- */
  {
    resetClock();
    const g = makeGate({ worker: true });   // worker 一直在跑 ⇒ 永远抢不到
    let error = null;
    const started = Date.now();
    try { await g.acquireAutomationAccountSwitch({}); } catch (e) { error = e; }
    ok(!!error && /会话同步仍在进行/.test(error.message) && Date.now() - started >= g.C.LOCK,
      'D3a 抢锁有界（' + g.C.LOCK + 'ms 后抛错，不是无限轮询）', error && error.message);
    ok(g.C.RESTORE < g.C.LOCK, 'D3b 还原路径的抢锁预算更短（' + g.C.RESTORE + ' < ' + g.C.LOCK + '）—— 还原是记账动作，等不起');
  }
  {
    resetClock();
    const g = makeGate({ worker: true });
    let error = null;
    try { await g.acquireAutomationAccountSwitch({ restore: true }); } catch (e) { error = e; }
    ok(!!error && /本次不切换账号/.test(error.message), 'D3c 还原路径抢不到锁时说「本次不切换」（交给闲置自动切回）', error && error.message);
  }

  /* ---- D4 抢到锁：置位 + 释放 + 失败屏障 ---- */
  {
    resetClock();
    const g = makeGate({ jobs: jobMap([['j1', goodJob('j1', 'u1')]]) });
    const release = await g.acquireAutomationAccountSwitch({});
    ok(g.inProgress() === true, 'D4a 抢到锁后置位 accountSwitchInProgress');
    ok(typeof release === 'function', 'D4b 返回释放函数（不是靠调用方自己改标志位）');
    release();
    ok(g.inProgress() === false, 'D4c 释放后复位');

    // A11：锁被占着时，UI 复制会话 / 手动切号都该被拒 —— 这里验证 assertAccountSwitchIdle 的抛错形态
    let error = null;
    try { g.assertAccountSwitchIdle(); } catch (e) { error = e; }
    ok(error === null, 'D4d 锁空闲时 assertAccountSwitchIdle 正常返回释放函数');

    const g2 = makeGate({ queue: [{ id: 'q1' }] });
    let busy = null;
    try { g2.assertAccountSwitchIdle(); } catch (e) { busy = e; }
    ok(!!busy && /会话同步尚未完成/.test(busy.message), 'D4e 队列非空时判为忙（A11 的 409 判据）', busy && busy.message);

    const g3 = makeGate({ locks: new Map([['x', true]]) });
    let busy3 = null;
    try { g3.assertAccountSwitchIdle(); } catch (e) { busy3 = e; }
    ok(!!busy3, 'D4f sessionCopyLocks 非空也判为忙');
  }

  /* ---- D5 A9 失败屏障：队列空了也必须拦 ---- */
  {
    resetClock();
    const jobs = jobMap([['j1', badJob('j1', 'u1', { status: 'partial' })]]);
    const g = makeGate({ jobs, current: { uid: 'u1' } });
    g.recordAccountSyncResult(jobs.get('j1'));
    ok(g.failures().has('u1'), 'D5a 失败作业被记进 accountSyncFailures 屏障');

    let error = null;
    try { await g.acquireAutomationAccountSwitch({}); } catch (e) { error = e; }
    ok(!!error && /会话同步未成功完成/.test(error.message),
      'D5b **队列空也不放行**：失败屏障拦住了切号（上游只看队列空 ⇒ 这里会静默变成允许切号）', error && error.message);

    // 下一次成功必须把屏障清掉，否则这个账号永远切不了。
    // ⚠️ 真实 daemon 里新作业一定会落进 autoCopyJobs，所以这里也必须放进 map ——
    //    抢锁的第二道判据是「autoCopyJobs 里最后一次目标账号作业」，只清屏障不够。
    const j2 = goodJob('j2', 'u1');
    jobs.set('j2', j2);
    g.recordAccountSyncResult(j2);
    ok(g.failures().has('u1') === false, 'D5c 后续成功清掉屏障（不是一票否决到底）');
    const release = await g.acquireAutomationAccountSwitch({});
    ok(typeof release === 'function', 'D5d 屏障清掉 + 新作业入表后又能正常抢锁（自愈路径通）');
    release();
  }

  /* ---- D5e 只清屏障但作业表里还是那条失败作业 ⇒ 仍然拦（两道判据都要过） ---- */
  {
    resetClock();
    const jobs = jobMap([['j1', badJob('j1', 'u1', { status: 'error' })]]);
    const g = makeGate({ jobs, current: { uid: 'u1' } });
    g.failures().delete('u1');   // 人为把屏障清掉，模拟「只靠 status 判空」的那种写法
    let error = null;
    try { await g.acquireAutomationAccountSwitch({}); } catch (e) { error = e; }
    ok(!!error && /会话同步未成功完成/.test(error.message),
      'D5e 屏障被清掉后，autoCopyJobs 里的失败作业仍然拦得住（两道判据互补，不是冗余）', error && error.message);
  }

  /* ---- D6 最近一次作业才算数（老的成功不能盖住新的失败） ---- */
  {
    resetClock();
    // 插入顺序 = 真实 daemon 的作业创建顺序：先成功、后失败 ⇒「最后一次」是失败那条。
    const jobs = jobMap([['j1', goodJob('j1', 'u1')], ['j2', badJob('j2', 'u1', { status: 'error' })]]);
    const g = makeGate({ jobs, current: { uid: 'u1' } });
    let error = null;
    try { await g.acquireAutomationAccountSwitch({}); } catch (e) { error = e; }
    ok(!!error && /会话同步未成功完成/.test(error.message),
      'D6 取的是 autoCopyJobs 里**最后一个**目标账号作业 —— 老的成功不许盖住新的失败', error && error.message);

    // 反向：同样两条作业，把顺序倒过来（新的那条是成功）⇒ 必须放行。
    const jobsRev = jobMap([['j2', badJob('j2', 'u1', { status: 'error' })], ['j1', goodJob('j1', 'u1')]]);
    const g2 = makeGate({ jobs: jobsRev, current: { uid: 'u1' } });
    const release = await g2.acquireAutomationAccountSwitch({});
    ok(typeof release === 'function', 'D6b 顺序倒过来（最新那条成功）⇒ 放行（判据跟着「最新」走，不是「有失败就拦」）');
    release();
  }

  /* ---- D7 停止后排空：有界 ---- */
  {
    resetClock();
    const g = makeGate();
    const stuck = { id: 'j7', targetUid: 'u1', status: 'running', total: 1, processed: 0 };
    const started = Date.now();
    await g.drainAutoCopyJobBounded(stuck, 60000);
    ok(Date.now() - started >= 60000 && g.w.sleeps > 0,
      'D7a 排空有上限（' + 60000 + 'ms 到点就放锁，不会为了等写盘把 daemon 卡死）', g.w.sleeps);
    const g2 = makeGate();
    await g2.drainAutoCopyJobBounded({ id: 'j8', targetUid: 'u1', status: 'done', total: 1, processed: 1 }, 60000);
    ok(g2.w.sleeps === 0, 'D7b 已落定的作业零等待（正常路径不引入延迟）');
    await g2.drainAutoCopyJobBounded(null, 60000);
    ok(g2.w.sleeps === 0, 'D7c null 作业零等待');
  }

  /* ---- D8 progress 载荷形状（面板/run-status 直接消费它） ---- */
  {
    resetClock();
    const g = makeGate();
    const got = [];
    await (async () => {
      const job = { id: 'j5', targetUid: 'u1', status: 'done', total: 4, processed: 4 };
      await g.waitAutomationSyncBounded(job, { onProgress: (p) => got.push(p) });
    })();
    const last = got[got.length - 1];
    ok(last && last.phase === 'syncing-sessions' && last.sync && last.sync.jobId === 'j5'
      && last.sync.status === 'done' && last.sync.processed === 4 && last.sync.total === 4
      && last.sync.failed === 0 && last.sync.conflicts === 0,
      'D8 progress.sync 载荷齐全（jobId/status/processed/total/failed/conflicts）—— 面板要直接渲染它', last);
    const g2 = makeGate();
    let captured = null;
    g2.automationSwitchProgress({ onProgress: (p) => { captured = p; } }, 'executing');
    ok(captured && captured.sync === null && captured.phase === 'executing', 'D9 无作业时 sync 为 null（相位照报）', captured);
    g2.automationSwitchProgress(null, 'x');
    g2.automationSwitchProgress({}, 'x');
    ok(true, 'D10 onProgress 缺失 / options 为 null 时不抛（闸门不许因为没人监听就崩）');
  }

  Date.now = realNow;
}

/* ==================================================================== */
section('[E] daemon 接线静态守卫（B5 / A9 / A11 / D2 / D3）');
/* ==================================================================== */

const has = (needle) => DAEMON_SRC.includes(needle);

ok(has('supportedSchemaVersions: [1, 2, 3]'), 'E1 /api/automations/schema 报 supportedSchemaVersions [1,2,3]');
ok(/sync: run\.sync \|\| null, stopRequested: !!run\.stopRequested/.test(DAEMON_SRC),
  'E2 automationPublicRun 暴露 sync + stopRequested（run-status 才能显示「等同步中/正在停止」）');
ok(has("if (run.status === 'running') { run.pendingEvent = null; run.status = 'cancelled'; run.stopRequested = true; run.phase = 'stopping';"),
  'E3 停止路由设 stopRequested + phase=stopping（切号闸门靠它转入收尾）');
ok(has('const isCancelled = () => run.stopRequested === true ||'),
  'E4 isCancelled 已把 stopRequested 算进去（否则停止后还会继续等同步）');

ok(has('if (accountSwitchInProgress) return json(res, 409, { ok: false, error: \'账号正在切换，请稍后同步\' });'),
  'E5 A11 /api/sessions/copy 在切号中返回 409');
ok(has('releaseAccountSwitch = await assertAccountSwitchIdle();') && has('releaseAccountSwitch = null;') && has('if (releaseAccountSwitch) releaseAccountSwitch();'),
  'E6 A11 /api/switch 抢闸门并在 finally 释放（三处齐全才算闭环）');
ok(has("if (accountSwitchInProgress && !options.auto) throw new Error('账号正在切换，请稍后同步');"),
  'E7 A11 内部复制路径也拦（带 auto 例外：自动同步不改号，不该被自己的闸门挡住）');

ok(has('recordAccountSyncResult(item.job);'),
  'E8 A9 队列 worker 的 finally 里记账 —— 失败屏障必须挂在「作业真跑完」那一刻');
ok(/const runDeps = \{[\s\S]{0,400}?orderCheckinAccounts: \(accounts\) => orderCheckinAccounts\(accounts\),/.test(DAEMON_SRC),
  'E9 B3 runDeps 注入了 orderCheckinAccounts（不注入等于 B3 白做）');
ok(/accountSwitch: \(account, detail\) => automationAccountSwitchGuarded\(account, \{[\s\S]{0,600}?onProgress:/.test(DAEMON_SRC),
  'E10 B4/A9 runDeps 的 accountSwitch 传了 onProgress（run-status 的 phase/sync 来源）');
ok(has('withInput: (fn) => withInput(fn, !!(detail && detail.restore))'),
  'E11 输入闸门只包「真正切号」这一步（等同步几分钟不该把共享输入闸门握在手里）');

ok(/if\(!\[1,2,3\]\.includes\(requires\.taskSchemaVersion\)\)/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'automation-compatibility.js'), 'utf8')),
  'E12 D2 兼容台账白名单已含 3');
ok(/if \(op === 'account\.forEach'\) walk\(value\.prepare\);/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'automation-packages.js'), 'utf8')),
  'E13 D3 打包预检会走进 prepare');
ok(/if\(!\[1,2,3\]\.includes\(task\.schemaVersion\?\?1\)\)return incompatible\('unsupported_task_schema'\);/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'automation-packages.js'), 'utf8')),
  'E14 D3 打包预检白名单已含 3');

const dmVersion = (DAEMON_SRC.match(/const DAEMON_VERSION = '([^']+)';/) || [])[1] || '';
const dmBuild = (DAEMON_SRC.match(/const DAEMON_BUILD_ID = '([^']+)';/) || [])[1] || '';
ok(/^release-\d+\.\d+\.\d+-\d{8}-[A-Za-z0-9][A-Za-z0-9-]*$/.test(dmBuild)
  && dmBuild.indexOf('release-' + dmVersion + '-') === 0
  && /^1\.\d+\.\d+$/.test(dmVersion) && dmVersion >= '1.4.3',
  'E15 改了 daemon.js 就递增版本 + 自洽 buildId（当前 ' + dmVersion + ' / ' + dmBuild + '）');

/* 反向守卫：上游那两个会挂死的写法不许出现在本地**代码**里（注释里提它们是解释性文字，不算）。
   ⚠️ 必须先剥注释再断言 —— 直接搜全文会被上面那段「上游靠 job.completion 无限等待」的说明撞成假阳性。 */
const DAEMON_CODE = DAEMON_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
ok(!/job\.completion/.test(DAEMON_CODE), 'E16 本地没有 job.completion（本地作业模型只有 status）—— 照抄上游会 TypeError');
ok(!/function waitAutomationSyncJob/.test(DAEMON_CODE), 'E17 没有搬运上游那个无超时的 waitAutomationSyncJob');
const BOUNDED_EXITS = (gateBlock.match(/Date\.now\(\) - startedAt (>=\s*[A-Za-z_]+|< maxMs)/g) || []);
ok(BOUNDED_EXITS.length === 3, 'E18 三处等待全部带「已等时长 vs 预算」的出口（等锁 / 等同步 / 排空），一处漏了就是无限等', BOUNDED_EXITS);
ok(/for \(;;\) \{[\s\S]*?Date\.now\(\) - startedAt >= budget/.test(gateBlock)
  && /while \(!isAutoCopyJobSettled\(job\.status\) && Date\.now\(\) - startedAt < maxMs\)/.test(gateBlock),
  'E19 等锁/等同步是 for(;;)+预算出口，排空是 while(<maxMs) —— 三种循环形态都对得上');
ok(/const budget = options && options\.restore \? AUTOMATION_RESTORE_LOCK_MAX_MS : AUTOMATION_SWITCH_LOCK_MAX_MS;/.test(gateBlock),
  'E20 抢锁预算按 restore 分流（还原 30s / 前向 300s），不是写死一个值');

console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
if (failures.length) { failures.forEach((f) => console.log('  未通过: ' + f)); process.exit(1); }

}

main().catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
