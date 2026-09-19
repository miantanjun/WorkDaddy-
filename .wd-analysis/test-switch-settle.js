'use strict';
/*
 * test-switch-settle.js —— v1.3.17「切号闸门：还原前先等在飞的回合跑完」的回归测试。
 *
 * 被修的 bug（2026-09-18 21:08，daemon.log 实测）：
 *   定时发送任务在目标账号上 session.send 成功（223 字）后 **91ms** 就被切回主账号。
 *   那一次切号是 account.forEach{switch:true} 的**收尾还原**，不是用户要的动作；
 *   而切号 = switchTo + reloadWorkBuddyPage（整页重载）⇒ 正在生成的回合当场夭折。
 *
 * 三段：
 *   【S】daemon.js 源码切片 + new Function 注入 stub —— 严禁真切号、真发消息、真连 CDP。
 *   【T】接线断言（定时任务的切号确实走闸门、显式切号不受影响）。
 *   【U】防回退断言（判据里不许出现 busy；不许改 automationSwitchAccount 的签名，
 *        否则 test-idle-switchback.js 的切片锚点会当场断掉）。
 *
 * 跑法：node .wd-analysis/test-switch-settle.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { probeSessionReceipt } = require(path.join(ROOT, 'scripts', 'automation-runtime.js'));

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function section(title) { console.log('\n' + title); }

async function main() {

/* ==================================================================== */
/* 【S】切号闸门（源码切片沙箱）                                          */
/* ==================================================================== */

section('[S] 切号闸门（源码切片沙箱）');

const rawDaemon = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const src = rawDaemon.replace(/\r\n/g, '\n');
const START = '/* ---------------- 切号闸门：还原前先等「在飞的回合」跑完（v1.3.17） ---------------- */';
const END = 'function startAutomationRun(task, event = null) {';
const sIdx = src.indexOf(START);
const eIdx = src.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) { console.log('  FAIL S0 找不到切号闸门代码块的锚点'); process.exit(1); }
const block = src.slice(sIdx, eIdx);
['SWITCH_SETTLE_RESTORE_MAX_MS', 'SWITCH_SETTLE_POLL_MS', 'readAutomationTurnState',
  'waitForAutomationReplySettle', 'automationAccountSwitchGuarded']
  .forEach((need) => { if (block.indexOf(need) < 0) { console.log('  FAIL S0 切出的代码块缺少 ' + need); process.exit(1); } });
ok(true, 'S0 切出切号闸门代码块（' + block.split('\n').length + ' 行）');

/* ---- 假时钟：时间只由 sleep 推进，否则「等不到预算」的循环永远不结束 ---- */
const realNow = Date.now;
let clock = 1700000000000;
Date.now = () => clock;

const world = {
  connected: true,
  probe: { ok: true, streaming: false, turnActive: false, hydrating: false, conversationId: 'C1' },
  probeQueue: null,
  probeError: '',
  probeCalls: 0,
  sleepCalls: 0,
  lastExpression: '',
  current: { uid: 'B', nickname: '账号B' },
  switchCalls: [],
  switchError: '',
  notify: [],
  logs: [],
};

function nextProbe() {
  const q = world.probeQueue;
  if (Array.isArray(q) && q.length) return q.length > 1 ? q.shift() : q[0];
  return world.probe;
}

const factory = new Function(
  'cdp', 'cdpSend', 'probeSessionReceipt', 'sleep', 'log', 'currentAccount',
  'automationSwitchAccount', 'limitFailoverNotify',
  block + '\nreturn { guard: automationAccountSwitchGuarded, settle: waitForAutomationReplySettle, ' +
  'read: readAutomationTurnState, C: { restore: SWITCH_SETTLE_RESTORE_MAX_MS, poll: SWITCH_SETTLE_POLL_MS } };'
);
const api = factory(
  { get connected() { return world.connected; } },
  async (method, params) => {
    world.probeCalls += 1;
    world.lastExpression = String((params && params.expression) || '');
    if (world.probeError) throw new Error(world.probeError);
    return { result: { value: nextProbe() } };
  },
  probeSessionReceipt,
  (ms) => { world.sleepCalls += 1; clock += Math.max(0, Number(ms) || 0); return Promise.resolve(); },
  (m) => { world.logs.push(String(m)); },
  () => world.current,
  async (account) => {
    const uid = String((account && account.uid) || '');
    world.switchCalls.push(uid);
    if (world.switchError) throw new Error(world.switchError);
    world.current = { uid, nickname: '切过去的' };
    return { ok: true, uid, switched: true };
  },
  (level, message) => { world.notify.push({ level: String(level), message: String(message) }); }
);

function resetWorld() {
  world.connected = true;
  world.probe = { ok: true, streaming: false, turnActive: false, hydrating: false, conversationId: 'C1' };
  world.probeQueue = null;
  world.probeError = '';
  world.probeCalls = 0;
  world.sleepCalls = 0;
  world.lastExpression = '';
  world.current = { uid: 'B', nickname: '账号B' };
  world.switchCalls = [];
  world.switchError = '';
  world.notify = [];
  world.logs = [];
  clock = 1700000000000;
}

/* ---- S1 显式切号：原样透传，一次探针都不打 ---- */
resetWorld();
let r = await api.guard({ uid: 'A' });
ok(world.switchCalls.length === 1 && world.switchCalls[0] === 'A', 'S1a 显式切号（无 restore）照切', world.switchCalls);
ok(world.probeCalls === 0, 'S1b 显式切号不做任何探测（不给正常流程加等待）', world.probeCalls);
ok(world.sleepCalls === 0, 'S1c 显式切号不等待', world.sleepCalls);
ok(r && r.switched === true, 'S1d 显式切号返回 switched:true', r);

/* ---- S2 还原 + 会话空闲：直接切，零等待 ---- */
resetWorld();
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.switchCalls.length === 1 && world.switchCalls[0] === 'A', 'S2a 空闲时还原照切', world.switchCalls);
ok(world.probeCalls === 1 && world.sleepCalls === 0, 'S2b 空闲时只探一次、不等待', { p: world.probeCalls, s: world.sleepCalls });
ok(r && r.switched === true && !r.deferred, 'S2c 空闲时不打 deferred 标记', r);

/* ---- S3 还原 + 一直生成：等满预算后**不切**（这就是 bug 的修复点） ---- */
resetWorld();
world.probe = { ok: true, streaming: true, turnActive: true, hydrating: false, conversationId: 'C1' };
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.switchCalls.length === 0, 'S3a 会话在生成时**绝不还原切号**（核心断言）', world.switchCalls);
ok(r && r.deferred === true && r.switched === false, 'S3b 返回 deferred/switched:false', r);
ok(r && r.reason === 'still-generating', 'S3c 原因是 still-generating', r && r.reason);
const expectPolls = Math.ceil(api.C.restore / api.C.poll);
ok(world.sleepCalls === expectPolls, 'S3d 等待次数 = 预算/轮询间隔（' + expectPolls + '）', world.sleepCalls);
ok(r && r.waitedMs >= api.C.restore, 'S3e 等满预算才放弃', r && r.waitedMs);
ok(world.notify.length === 1 && world.notify[0].level === 'warning', 'S3f 给用户一条 warning 提示（不是静默延后）', world.notify);
ok(/延后还原账号/.test(world.logs.join('\n')), 'S3g 日志里能一眼看出「延后还原」', world.logs.slice(-1));
ok(world.current.uid === 'B', 'S3h 账号留在目标账号上（交给闲置自动切回收回）', world.current);

/* ---- S4 还原 + 先流式后落定：骑过生成，再切 ---- */
resetWorld();
world.probeQueue = [
  { ok: true, streaming: true, turnActive: false, conversationId: 'C1' },
  { ok: true, streaming: true, turnActive: false, conversationId: 'C1' },
  { ok: true, streaming: false, turnActive: false, conversationId: 'C1' },
];
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.switchCalls.length === 1 && world.switchCalls[0] === 'A', 'S4a 生成结束后照常还原切号', world.switchCalls);
ok(world.sleepCalls === 2, 'S4b 只等了「还在生成」的那两拍', world.sleepCalls);
ok(r && r.switched === true && !r.deferred, 'S4c 最终是切了，不是延后', r);

/* ---- S5 turnActive（没有 streamingRequestId 但回合在跑）也要等 ---- */
resetWorld();
world.probe = { ok: true, streaming: false, turnActive: true, conversationId: 'C1' };
world.probeQueue = [Object.assign({}, world.probe), { ok: true, streaming: false, turnActive: false, conversationId: 'C1' }];
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.sleepCalls === 1 && world.switchCalls.length === 1, 'S5a turnActive 也算「在飞」，会被等', { s: world.sleepCalls, c: world.switchCalls });
ok(world.probeCalls === 2, 'S5b 探了两拍才落定', world.probeCalls);

/* ---- S6 hydration 不算「在飞」：历史加载中可以切（v1.3.16 的教训） ---- */
resetWorld();
world.probe = { ok: true, streaming: false, turnActive: false, hydrating: true, conversationId: 'C1' };
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.sleepCalls === 0 && world.switchCalls.length === 1, 'S6a hydrating 不拦路（不把「加载历史」当「在跑」）', { s: world.sleepCalls, c: world.switchCalls });

/* ---- S7 探针读不到 / CDP 断开：没有可保护的对象，按可切处理 ---- */
resetWorld();
world.probe = null;
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.switchCalls.length === 1 && world.sleepCalls === 0, 'S7a 探针返回 null 时照切', world.switchCalls);
ok(r && r.switched === true && !r.deferred, 'S7b null 不走 deferred', r);

resetWorld();
world.connected = false;
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.probeCalls === 0 && world.switchCalls.length === 1, 'S7c CDP 断开时直接探针短路，照切', { p: world.probeCalls, c: world.switchCalls });
world.connected = true;

resetWorld();
world.probeError = '页面执行失败';
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.switchCalls.length === 1, 'S7d 探针抛错不让还原失败（catch 成 null 后照切）', world.switchCalls);

/* ---- S8 已经在目标账号上：不白等 ---- */
resetWorld();
world.current = { uid: 'A', nickname: '账号A' };
r = await api.guard({ uid: 'A' }, { restore: true });
ok(world.probeCalls === 0 && world.sleepCalls === 0, 'S8a 已在目标账号上时不探测、不等待', { p: world.probeCalls, s: world.sleepCalls });

/* ---- S9 探针复用官方「当前会话」选择器，而不是猜控制器顺序 ---- */
resetWorld();
await api.guard({ uid: 'A' }, { restore: true });
ok(/getSelectedConversationId/.test(world.lastExpression), 'S9a 探针复用 compat.getSelectedConversationId（不靠 controllers[0]）', world.lastExpression.slice(0, 60));
ok(/streamingRequestId/.test(world.lastExpression) && /isHydrating/.test(world.lastExpression), 'S9b 探针带 streaming / hydrating 字段');

/* ==================================================================== */
/* 【T】接线断言                                                          */
/* ==================================================================== */

section('[T] daemon 接线');

ok(/accountSwitch: \(account, detail\) => withInput\(\(\) => automationAccountSwitchGuarded\(account, detail\),/.test(src),
  'T1a 定时任务的切号入口确实走了闸门');
ok(!/accountSwitch: \(account, detail\) => withInput\(\(\) => automationSwitchAccount\(account\),/.test(src),
  'T1b 旧的无闸门接线已经不存在（防回退）');
ok(/const SWITCH_SETTLE_RESTORE_MAX_MS = 300000;/.test(src), 'T1c 还原等待预算 5 分钟（与 session.wait 上限一致）');
ok(/limitFailoverNotify\('warning'/.test(block), 'T1d 延后时会给用户提示');

/* 显式切号路径不许被误伤：automationSwitchAccount 本体仍是无条件切 */
ok(/async function automationAccountSwitchGuarded\(account, detail\) \{\n  const target = .*\n  if \(!\(detail && detail\.restore\)\) return automationSwitchAccount\(target\);/.test(block),
  'T1e 非 restore 的分支在第一行就原样透传');

/* ==================================================================== */
/* 【U】防回退断言                                                        */
/* ==================================================================== */

section('[U] 防回退');

ok(!/probe\.busy/.test(block), 'U1a 判据里不许出现 busy —— hydration 会假阳性（v1.3.16 的坑）');
ok(/!probe\.streaming && !probe\.turnActive/.test(block), 'U1b 判据是 streaming/turnActive 两个标志位');
ok(/function automationSwitchAccount\(account\) \{/.test(src),
  'U1c automationSwitchAccount 的签名没被改动（test-idle-switchback.js 拿它当切片结束锚点）');
ok(src.indexOf('automationAccountSwitchGuarded') > src.indexOf('function automationSwitchAccount(account) {'),
  'U1d 闸门定义在 automationSwitchAccount 之后（两个源码切片的边界都不受影响）');
ok(src.indexOf(START) > src.indexOf('function automationSwitchAccount(account) {'),
  'U1e 闸门代码块不在「闲置切回」切片的范围内');

/* 版本自洽：不写死版本号，用下限 + buildId 与 DAEMON_VERSION 自洽 */
const ver = (src.match(/const DAEMON_VERSION = '([^']+)'/) || [])[1] || '';
const build = (src.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
const parts = ver.split('.').map(Number);
ok(parts.length === 3 && parts.every((n) => Number.isInteger(n)) && (parts[0] > 1 || parts[1] > 3 || (parts[1] === 3 && parts[2] >= 17)),
  'U2a DAEMON_VERSION 至少 1.3.17（实际 ' + ver + '）');
ok(new RegExp('^release-' + ver.replace(/\./g, '\\.') + '-\\d{8}-[\\w-]+$').test(build),
  'U2b buildId 与 DAEMON_VERSION 自洽（' + build + '）');
ok(src.indexOf('还原前先等「在飞的回合」跑完') >= 0, 'U2c 修复理由写进了源码注释（不靠 commit message 传承）');

Date.now = realNow;

}

main().then(() => {
  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}).catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
