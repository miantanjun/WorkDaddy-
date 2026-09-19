'use strict';
/*
 * test-idle-switchback.js —— 「非主账号闲置超阈值自动切回主账号」的回归测试。
 *
 * 三段：
 *   【I】纯模块 scripts/idle-switchback.js（配置归一 / 活动指纹 / 决策矩阵）—— 可直接 require。
 *   【J】daemon.js 里的拍子与切号动作 —— 源码切片 + new Function 注入 stub，
 *        严禁真的切号：automationSwitchAccount / currentAccount / 账号表全是 stub，
 *        桌面日志由 stub 接住，不落真实桌面。
 *   【K】前端接线（账号页卡片 / i18n / CSS / switchTab 刷新）+ 限流任务内置化的源码断言
 *        —— 纯文本断言，不启动 WorkBuddy。
 *
 * 跑法：node .wd-analysis/test-idle-switchback.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const idle = require(path.join(ROOT, 'scripts', 'idle-switchback.js'));

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function section(title) { console.log('\n' + title); }

async function main() {

/* ==================================================================== */
/* 【I】配置 / 指纹 / 决策                                               */
/* ==================================================================== */

section('[I] 闲置切回：配置与决策（纯函数）');

ok(idle.DEFAULTS.minutes === 30 && idle.DEFAULTS.enabled === true, 'I1a 默认 30 分钟、默认开启', idle.DEFAULTS);
ok(idle.normalizeConfig({}).minutes === 30, 'I1b 空配置 → 默认 30');
ok(idle.normalizeConfig({ minutes: 1 }).minutes === 5, 'I1c 低于下限夹到 5', idle.normalizeConfig({ minutes: 1 }));
ok(idle.normalizeConfig({ minutes: 99999 }).minutes === 1440, 'I1d 高于上限夹到 1440', idle.normalizeConfig({ minutes: 99999 }));
ok(idle.normalizeConfig({ minutes: 45.6 }).minutes === 46, 'I1e 取整');
ok(idle.normalizeConfig({ minutes: 'abc' }).minutes === 30, 'I1f 非法值回落默认');
ok(idle.normalizeConfig({ enabled: 0 }).enabled === false, 'I1g enabled 归一为布尔');
ok(idle.normalizeConfig(null).enabled === true, 'I1h null → 默认开启');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-idle-'));
const store = idle.createIdleSwitchbackStore(tmpDir, fs);
ok(store.get().minutes === 30, 'I2a 首次读取（文件不存在）给默认值');
store.set({ minutes: 20 });
ok(store.get().minutes === 20 && store.get().enabled === true, 'I2b 落盘后可读回', store.get());
store.set({ enabled: false });
ok(store.get().minutes === 20 && store.get().enabled === false, 'I2c 只改一个字段不覆盖另一个', store.get());
const rawCfg = JSON.parse(fs.readFileSync(store.file, 'utf8'));
ok(rawCfg.minutes === 20 && rawCfg.enabled === false, 'I2d 落盘内容是干净的 JSON', rawCfg);
ok(fs.readdirSync(tmpDir).filter((n) => n.indexOf('.tmp-') >= 0).length === 0, 'I2e 没有残留临时文件（原子写）');

const stateStore = idle.createIdleSwitchbackStateStore(tmpDir, fs);
ok(stateStore.get().uid === '' && stateStore.get().lastActivityAt === 0, 'I3a 状态缺失 → 空状态');
stateStore.set({ uid: 'B', lastActivityAt: 123, fingerprint: 'f', fingerprintAt: 1, lastReason: 'changed' });
ok(stateStore.get().uid === 'B' && stateStore.get().lastActivityAt === 123, 'I3b 状态可读回');
fs.writeFileSync(stateStore.file, 'not json');
ok(stateStore.get().uid === '' , 'I3c 状态文件坏了也不抛，回落空状态');

ok(idle.activityFingerprint({ ok: false }) === 'unreadable', 'I4a 读不到页面 → unreadable');
ok(idle.activityFingerprint({ ok: true, hasConversation: false }) === 'no-conversation', 'I4b 没有会话 → no-conversation');
const baseProbe = { ok: true, hasConversation: true, conversationId: 'c1', messageCount: 3, lastId: 'm3', streaming: false, draft: 0 };
const fBase = idle.activityFingerprint(baseProbe);
ok(fBase !== idle.activityFingerprint(Object.assign({}, baseProbe, { messageCount: 4 })), 'I4c 新消息 → 指纹变');
ok(fBase !== idle.activityFingerprint(Object.assign({}, baseProbe, { lastId: 'm4' })), 'I4d 末条变化 → 指纹变');
ok(fBase !== idle.activityFingerprint(Object.assign({}, baseProbe, { streaming: true })), 'I4e 开始生成 → 指纹变');
ok(fBase !== idle.activityFingerprint(Object.assign({}, baseProbe, { conversationId: 'c2' })), 'I4f 换会话 → 指纹变');
ok(fBase !== idle.activityFingerprint(Object.assign({}, baseProbe, { draft: 1 })), 'I4g 输入框出现草稿 → 指纹变');
ok(idle.activityFingerprint(Object.assign({}, baseProbe, { draft: 1 })) === idle.activityFingerprint(Object.assign({}, baseProbe, { draft: 5 })),
  'I4h 草稿分桶：1 个字和 5 个字算同一桶（不会每敲一个字都算一次活动）');

const NOW = 1800000000000;
function decide(over) {
  return idle.decideIdleSwitchBack(Object.assign({
    config: { enabled: true, minutes: 30 },
    now: NOW,
    current: { uid: 'B', nickname: '账号B' },
    primaryUid: 'A',
    primaryUsable: true,
    blockedUntil: 0,
    busy: false,
    probe: Object.assign({}, baseProbe, { fingerprint: undefined }),
    state: { uid: 'B', lastActivityAt: NOW - 31 * 60000, fingerprint: idle.activityFingerprint(baseProbe), fingerprintAt: NOW - 31 * 60000, lastReason: 'idle' },
  }, over || {}));
}

ok(decide({ config: { enabled: false, minutes: 30 } }).action === 'none', 'I5a 关闭 → 不动作');
ok(decide({ config: { enabled: true, minutes: 0 } }).action === 'none', 'I5b 阈值 0 → 不动作');
ok(decide({ primaryUid: '' }).reason === 'no-primary', 'I5c 没设主账号 → no-primary');
ok(decide({ current: { uid: 'A', nickname: '主账号A' } }).reason === 'already-primary', 'I5d 已在主账号 → already-primary');
ok(decide({ current: { uid: '', nickname: '' } }).reason === 'no-current', 'I5e 读不到当前账号 → no-current');

let d = decide({ state: { uid: 'B', lastActivityAt: NOW - 29 * 60000, fingerprint: idle.activityFingerprint(baseProbe) } });
ok(d.action === 'idle' && d.reason === 'below-threshold', 'I5f 未到阈值 → 什么都不做', d);
ok(d.idleMs === 29 * 60000, 'I5g 报出已闲置时长（29 分钟）', d.idleMs);

d = decide({ probe: Object.assign({}, baseProbe, { streaming: true }) });
ok(d.action === 'idle' && d.nextState.lastActivityAt === NOW && d.nextState.lastReason === 'streaming',
  'I5h 正在生成回复 → 计时归零且不切（否则会掐死任务）', d.nextState);

d = decide({ probe: Object.assign({}, baseProbe, { draft: 2 }) });
ok(d.nextState.lastActivityAt === NOW && d.nextState.lastReason === 'draft', 'I5i 输入框里有草稿 → 算活动', d.nextState);

d = decide({ probe: Object.assign({}, baseProbe, { messageCount: 9, lastId: 'm9' }) });
ok(d.nextState.lastActivityAt === NOW && d.nextState.lastReason === 'changed', 'I5j 消息指纹变了 → 算活动', d.nextState);

d = decide({ busy: true });
ok(d.nextState.lastActivityAt === NOW && d.nextState.lastReason === 'busy', 'I5k 有任务/切号在跑 → 视为活动，让位', d.nextState);

d = decide({ state: idle.emptyState('') });
ok(d.action === 'idle' && d.nextState.lastActivityAt === NOW, 'I5l 第一次观察（无历史状态）→ 从现在开始计时，不立刻切');

d = decide({ state: { uid: 'C', lastActivityAt: NOW - 999 * 60000, fingerprint: 'x' } });
ok(d.action === 'idle' && d.nextState.lastActivityAt === NOW, 'I5m 账号被换过 → 闲置计时重算（不沿用别的账号的计时）');

d = decide({});
ok(d.action === 'switch' && d.reason === 'idle-threshold', 'I5n 到阈值 + 主账号可用 + 不在限流窗口 → 该切', d);
ok(d.idleMs >= 31 * 60000, 'I5o 切的时候带上已闲置时长', d.idleMs);

d = decide({ primaryUsable: false });
ok(d.action === 'hold' && d.reason === 'primary-unavailable', 'I5p 主账号不可用 → 不切（hold）', d);
d = decide({ blockedUntil: NOW + 5 * 60000 });
ok(d.action === 'hold' && d.reason === 'primary-limited' && d.blockedUntil === NOW + 5 * 60000, 'I5q 主账号还在限流窗口 → 这一拍不切', d);
ok(d.nextState.lastActivityAt === NOW - 31 * 60000, 'I5r 限流窗口只是「这一拍不切」，闲置计时继续攒', d.nextState);

const activityExpr = idle.sessionActivityExpression();
ok(/contenteditable/.test(activityExpr) && /streamingRequestId/.test(activityExpr), 'I6a 活动探针含输入框与流式判定');
ok(/messageCount/.test(activityExpr) && /conversationId/.test(activityExpr), 'I6b 活动探针含消息数与会话 id');
ok(/wbs-root/.test(activityExpr), 'I6c 探针排除 WorkDaddy 自己面板里的输入框');
ok(activityExpr.indexOf('token') < 0 && activityExpr.indexOf('auth') < 0, 'I6d 探针不碰任何凭据字段');

/* ==================================================================== */
/* 【J】daemon 拍子与切号动作（源码切片 + stub）                          */
/* ==================================================================== */

section('\n[J] daemon 拍子（源码切片沙箱）');

const rawDaemon = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const src = rawDaemon.replace(/\r\n/g, '\n');
const START = '/* ---------------- 非主账号闲置超时 → 自动切回主账号 ---------------- */';
const END = 'function automationSwitchAccount(account) {';
const sIdx = src.indexOf(START);
const eIdx = src.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) { console.log('  FAIL J0 找不到闲置切回代码块锚点'); process.exit(1); }
const block = src.slice(sIdx, eIdx);
['IDLE_SWITCHBACK_TICK_MS', 'idleSwitchbackTick', 'runIdleSwitchBack', 'idleSwitchbackPublicState', 'startIdleSwitchbackTicker']
  .forEach((need) => { if (block.indexOf(need) < 0) { console.log('  FAIL J0 切出的代码块缺少 ' + need); process.exit(1); } });
ok(true, 'J0 切出闲置切回代码块（' + block.split('\n').length + ' 行）');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-idle-daemon-'));
const world = {
  current: { uid: 'B', nickname: '账号B' },
  primaryUid: 'A',
  accounts: [{ uid: 'A', nickname: '主账号A' }, { uid: 'B', nickname: '账号B' }],
  blockedUntil: 0,
  connected: true,
  probe: Object.assign({}, baseProbe),
  switchError: '',
  switchCalls: [],
  autoCopyCalls: [],
  runs: [],
  banner: { ok: true, hit: false },
  logs: [],
  desktopLogs: [],
};

const factory = new Function(
  'path', 'DATA_DIR', 'fs', 'log', 'cdp',
  'currentAccount', 'limitFailoverPrimaryUid', 'limitFailoverAccountByUid', 'limitFailoverBlockedUntil',
  'limitFailoverInFlight', 'limitFailoverSwitchBack', 'automationRuns', 'automationSwitchAccount',
  'readLimitBanner', 'runCdpExpression', 'limitFailoverNotify', 'writeAccountSwitchDesktopLog',
  'accountSwitchLog', 'accountSwitchLogFile', 'limitFailoverDesktopLogDir', 'autoCopyAfterAccountSwitch', 'idleSwitchback',
  block + '\nreturn { idleSwitchbackTick: idleSwitchbackTick, runIdleSwitchBack: runIdleSwitchBack, idleSwitchbackPublicState: idleSwitchbackPublicState, idleSwitchbackBusy: idleSwitchbackBusy, startIdleSwitchbackTicker: startIdleSwitchbackTicker, getDecision: function(){ return idleSwitchbackLastDecision; }, CONFIG_FILE: idleSwitchbackStore.file, STATE_FILE: idleSwitchbackStateStore.file };'
);
const accountSwitchLog = require(path.join(ROOT, 'scripts', 'account-switch-log.js'));
const api = factory(
  path, dataDir, fs, (m) => world.logs.push(String(m)), { get connected() { return world.connected; } },
  () => world.current,
  () => world.primaryUid,
  (uid) => world.accounts.find((a) => a.uid === String(uid)) || null,
  () => world.blockedUntil,
  null,
  null,
  new Map(),
  async (account) => {
    world.switchCalls.push(String(account && account.uid || ''));
    if (world.switchError) throw new Error(world.switchError);
    world.current = { uid: String(account.uid), nickname: '切回来的' };
    return { ok: true, uid: String(account.uid), switched: true };
  },
  async () => world.banner,
  async () => world.probe,
  () => {},
  (text, at) => { world.desktopLogs.push({ text: String(text || ''), at }); return { ok: true, file: 'stub.txt' }; },
  accountSwitchLog,
  '',
  () => path.join(dataDir, 'desktop-stub'),
  (sourceUid, targetUid, reason) => {
    world.autoCopyCalls.push({ sourceUid: String(sourceUid), targetUid: String(targetUid), reason: String(reason || '') });
    return { id: 'copy-' + world.autoCopyCalls.length, total: 4 };
  },
  idle
);

function resetWorld(over) {
  world.current = { uid: 'B', nickname: '账号B' };
  world.primaryUid = 'A';
  // ⚠️ 账号表也要复位：J6 会把主账号从列表里摘掉，漏了这行后面几个场景会「因为主账号不可用」
  // 而静默走 hold 分支 —— 断言照样通过，但测的根本不是那条路径。
  world.accounts = [{ uid: 'A', nickname: '主账号A' }, { uid: 'B', nickname: '账号B' }];
  world.blockedUntil = 0;
  world.connected = true;
  world.probe = Object.assign({}, baseProbe);
  world.switchError = '';
  world.switchCalls = [];
  world.autoCopyCalls = [];
  world.logs = [];
  world.desktopLogs = [];
  Object.assign(world, over || {});
  // 每个场景从「已经闲置很久」开始：直接写状态文件，绕开 30 分钟的等待
  fs.writeFileSync(api.STATE_FILE, JSON.stringify({
    uid: world.current.uid,
    lastActivityAt: Date.now() - 31 * 60000,
    fingerprint: idle.activityFingerprint(world.probe),
    fingerprintAt: Date.now() - 31 * 60000,
    lastReason: 'idle',
  }));
}
function writeConfig(cfg) { fs.writeFileSync(api.CONFIG_FILE, JSON.stringify(cfg)); }

writeConfig({ enabled: true, minutes: 30 });
const enabledConfig = JSON.parse(fs.readFileSync(api.CONFIG_FILE, 'utf8'));
ok(enabledConfig.minutes === 30 && enabledConfig.enabled === true, 'J1 配置已写入临时数据目录（不碰真实 %APPDATA%）');

/* ---- J2 正常路径 ---- */
resetWorld();
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 1 && world.switchCalls[0] === 'A', 'J2a 闲置到点 → 切回主账号 A', world.switchCalls);
ok(world.current.uid === 'A', 'J2b 切完后当前账号是主账号', world.current.uid);
ok(world.desktopLogs.length === 1 && /闲置自动切回主账号/.test(world.desktopLogs[0].text), 'J2c 写了一份桌面大白话日志', world.desktopLogs.length);
ok(world.autoCopyCalls.length === 1, 'J2c2 切号完成后触发了「切号复制同步会话」', world.autoCopyCalls);
ok(world.autoCopyCalls[0].sourceUid === 'B' && world.autoCopyCalls[0].targetUid === 'A',
  'J2c3 同步方向：离开的账号 B → 主账号 A', world.autoCopyCalls[0]);
ok(world.autoCopyCalls[0].reason === 'idle-switchback', 'J2c4 带上来路标记', world.autoCopyCalls[0]);
ok(/顺带做了/.test(world.desktopLogs[0].text) && /共 4 个/.test(world.desktopLogs[0].text), 'J2c5 日志写明顺带同步了几个会话');
ok(/32 分|31 分|30 分/.test(world.desktopLogs[0].text), 'J2d 日志里写明了闲置多久', world.desktopLogs[0].text.slice(0, 80));
ok(JSON.parse(fs.readFileSync(api.STATE_FILE, 'utf8')).uid === 'A', 'J2e 切完后闲置计时归到主账号（不会立刻又触发）');

/* ---- J3 未到阈值 ---- */
resetWorld({ current: { uid: 'B', nickname: '账号B' } });
fs.writeFileSync(api.STATE_FILE, JSON.stringify({ uid: 'B', lastActivityAt: Date.now() - 5 * 60000, fingerprint: idle.activityFingerprint(world.probe), fingerprintAt: Date.now(), lastReason: 'idle' }));
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0, 'J3 只闲置 5 分钟 → 不切', world.switchCalls);

/* ---- J4 正在生成 / 有草稿 → 不切且计时归零 ---- */
for (const [label, probe] of [['正在生成', { streaming: true }], ['输入框有草稿', { draft: 3, lastId: 'm3' }]]) {
  resetWorld({ probe: Object.assign({}, baseProbe, probe) });
  await api.idleSwitchbackTick();
  ok(world.switchCalls.length === 0, 'J4-' + label + ' → 不切号');
  const st = JSON.parse(fs.readFileSync(api.STATE_FILE, 'utf8'));
  ok(Date.now() - st.lastActivityAt < 5000, 'J4-' + label + ' → 闲置计时归零', Date.now() - st.lastActivityAt);
}

/* ---- J5 已有任务在跑 / 切号在飞 → 让位 ---- */
resetWorld();
new Map([['r1', { status: 'running' }]]);
const apiBusy = factory(
  path, dataDir, fs, () => {}, { get connected() { return world.connected; } },
  () => world.current, () => world.primaryUid, (uid) => world.accounts.find((a) => a.uid === String(uid)) || null,
  () => world.blockedUntil, null, null, new Map([['r1', { status: 'running' }]]),
  async (account) => { world.switchCalls.push(String(account.uid)); return { ok: true }; },
    async () => world.banner, async () => world.probe, () => {},
    (text) => { world.desktopLogs.push({ text: String(text || '') }); return { ok: true }; },
    accountSwitchLog, '', () => path.join(dataDir, 'desktop-stub'),
    (sourceUid, targetUid, reason) => {
      world.autoCopyCalls.push({ sourceUid: String(sourceUid), targetUid: String(targetUid), reason: String(reason || '') });
      return { id: 'copy-busy', total: 4 };
    },
    idle
  );
resetWorld();
fs.writeFileSync(apiBusy.STATE_FILE, JSON.stringify({ uid: 'B', lastActivityAt: Date.now() - 31 * 60000, fingerprint: idle.activityFingerprint(world.probe) }));
await apiBusy.idleSwitchbackTick();
ok(world.switchCalls.length === 0, 'J5a 有自动化任务在跑 → 不抢账号');
ok(apiBusy.idleSwitchbackPublicState().busy === true, 'J5b 状态里报 busy=true');

/* ---- J6 主账号不可用 ---- */
resetWorld({ accounts: [{ uid: 'B', nickname: '账号B' }] });
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0, 'J6a 主账号备份不在列表 → 不切');
ok(api.idleSwitchbackPublicState().primaryUsable === false, 'J6b 状态里报 primaryUsable=false');
ok(world.desktopLogs.length === 0, 'J6c 纯「条件不满足」不写桌面日志（避免刷屏）');

/* ---- J7 主账号在限流窗口内 ---- */
resetWorld({ blockedUntil: Date.now() + 5 * 60000 });
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0, 'J7a 主账号还在限流窗口 → 这一拍不切');
const blockedState = JSON.parse(fs.readFileSync(api.STATE_FILE, 'utf8'));
ok(Date.now() - blockedState.lastActivityAt >= 30 * 60000, 'J7b 闲置计时继续攒着，窗口一过就能切', Date.now() - blockedState.lastActivityAt);

/* ---- J8 功能关闭 / 已在主账号 / CDP 断开 ---- */
resetWorld();
writeConfig({ enabled: false, minutes: 30 });
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0 && api.getDecision().reason === 'disabled', 'J8a 关掉开关 → 不动', api.getDecision());
writeConfig({ enabled: true, minutes: 30 });

resetWorld({ current: { uid: 'A', nickname: '主账号A' } });
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0 && api.getDecision().reason === 'already-primary', 'J8b 已经在主账号 → 不动', api.getDecision());

resetWorld({ connected: false });
const beforeState = fs.readFileSync(api.STATE_FILE, 'utf8');
await api.idleSwitchbackTick();
ok(world.switchCalls.length === 0 && api.getDecision().reason === 'cdp-offline', 'J8c WorkBuddy 没连上 → 不判定也不切', api.getDecision());
ok(fs.readFileSync(api.STATE_FILE, 'utf8') === beforeState, 'J8d CDP 断开时不推进计时（回来了从原来的时间接着算）');

/* ---- J9 切号动作：世界变了 / 抛错 ---- */
resetWorld();
world.current = { uid: 'C', nickname: '账号C' };   // 等待期间被切到第三个账号
await api.runIdleSwitchBack({ idleMs: 31 * 60000, minutes: 30, current: { uid: 'B', nickname: '账号B' }, primaryUid: 'A', primaryNickname: '主账号A' });
ok(world.switchCalls.length === 0, 'J9a 执行前发现当前账号已变 → 不动手', world.switchCalls);
ok(world.desktopLogs.length === 1 && /切回失败/.test(world.desktopLogs[0].text), 'J9b 记下失败原因', world.desktopLogs[0].text.slice(0, 60));

resetWorld({ switchError: 'CDP 未连接，无法自动刷新窗口' });
await api.idleSwitchbackTick();
ok(world.desktopLogs.length === 1 && /切回失败/.test(world.desktopLogs[0].text) && /CDP 未连接/.test(world.desktopLogs[0].text),
  'J9c 切号抛错 → 写失败日志、不崩', world.desktopLogs[0].text.slice(0, 80));
ok(api.idleSwitchbackPublicState().switching === false, 'J9d 出错后也不卡住（switching 复位）');
ok(world.autoCopyCalls.length === 0, 'J9e 切号失败 → 不触发同步（账号没切过去）');

/* ---- J10 状态接口与启动器 ---- */
resetWorld();
const pub = api.idleSwitchbackPublicState();
ok(pub.enabled === true && pub.minutes === 30 && pub.thresholdMs === 1800000, 'J10a 状态里带配置与毫秒阈值', { m: pub.minutes, t: pub.thresholdMs });
ok(pub.current && pub.current.uid === 'B' && pub.primary && pub.primary.uid === 'A', 'J10b 状态里带当前账号与主账号');
ok(pub.range && pub.range.min === 5 && pub.range.max === 1440 && pub.range.default === 30, 'J10c 状态里带可调范围', pub.range);
ok(pub.onOtherAccount === true, 'J10d 状态里带「是否在非主账号上」');
ok(typeof api.startIdleSwitchbackTicker === 'function', 'J10e 有独立启动器');
ok(/IDLE_SWITCHBACK_TICK_MS = 30000/.test(block), 'J10f 拍子间隔 30 秒');
ok(/IDLE_SWITCHBACK_BOOT_DELAY_MS = 20000/.test(block), 'J10g 启动后先等 20 秒（等 CDP 连上）');
ok(/if \(idleSwitchbackTimer\) return idleSwitchbackTimer;/.test(block), 'J10h 重复启动是幂等的');
ok(/\.unref\(\)/.test(block), 'J10i 定时器 unref（不阻塞进程退出）');

/* ---- J11 daemon 全局接线（源码级） ---- */
ok(src.indexOf("require('./idle-switchback.js')") >= 0, 'J11a daemon 已加载 idle-switchback 模块');
ok(/startIdleSwitchbackTicker\(\);/.test(src), 'J11b 启动流程里调了 startIdleSwitchbackTicker');
ok(src.indexOf("p === '/api/idle-switchback'") >= 0, 'J11c 有 /api/idle-switchback 端点');
ok(/patch\.minutes = minutes;/.test(src) && /MIN_MINUTES/.test(src), 'J11d 端点校验阈值范围');
// 别钉死具体后缀（每落地一个阶段都要回来改一次）：只要求「本轮之后的构建」。
// 命名约定 2026-09-14 起回归上游的 release-x.y.z-…（打包脚本校验这个格式）。
const daemonBuildId = (src.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
// 2026-09-17: 原来写死 1\.3\.0，daemon 升到 1.3.1 后每个阶段都误报。放宽到 1.3.x。
ok(/^(selfhost|release)-\d+\.\d+\.\d+-\d{8}-/.test(daemonBuildId) && daemonBuildId.indexOf('space-scan-slug-fix') < 0,
  'J11e DAEMON_BUILD_ID 已提升', daemonBuildId);

/* ==================================================================== */
/* 【K】前端接线 + 限流任务内置化                                        */
/* ==================================================================== */

section('\n[K] 前端接线与内置化（源码断言）');

// 本地文件是 CRLF：断多行模式前必须先归一化，否则 `...{\n  return` 这类断言永远匹配不到
const inject = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
const automation = fs.readFileSync(path.join(ROOT, 'scripts', 'automation.js'), 'utf8').replace(/\r\n/g, '\n');

ok(inject.indexOf('wbs-idle-card') >= 0 && inject.indexOf('id="wbs-idle-primary"') >= 0, 'K1a 账号页有「账号自动切换」卡片 + 主账号下拉');
ok(inject.indexOf('id="wbs-idle-enabled"') >= 0 && inject.indexOf('id="wbs-idle-minutes"') >= 0, 'K1b 卡片有开关 + 阈值输入框');
ok(inject.indexOf("'<div class=\"wbs-acct-list\"></div>' +\n        // 账号自动切换") >= 0, 'K1c 卡片夹在账号列表与「登录新账号」之间（不抢列表的滚动区）');
ok(inject.indexOf("api('/api/idle-switchback')") >= 0, 'K2a 前端读配置走 /api/idle-switchback');
ok(/api\('\/api\/idle-switchback', \{ method: 'POST'/.test(inject), 'K2b 保存走 POST /api/idle-switchback');
ok(inject.indexOf("api('/api/accounts/primary', { method: 'POST'") >= 0, 'K2c 主账号下拉接上了此前没人调用的 /api/accounts/primary');
ok(/if \(name === 'account'\) \{ try \{ refreshIdleCard\(\); \} catch \(e\) \{\} \}/.test(inject), 'K2d 每次进账号页都刷新卡片');
ok(inject.indexOf('try { refreshIdleCard(); } catch (e) {}') >= 0 && /state\.accounts = mergeAccountSnapshot\(previous/.test(inject),
  'K2e 账号列表回来后再刷一次（下拉需要账号清单）');
ok(inject.indexOf('.wbs-idle-card{') >= 0 && inject.indexOf('.wbs-idle-note{') >= 0, 'K3a 卡片样式已定义');
ok(inject.indexOf('.wbs-idle-card{flex:0 0 auto') >= 0, 'K3b 卡片 flex:0 0 auto（不被列表挤掉）');
ok(inject.indexOf("'闲置后自动切回主账号': 'Switch back to primary when idle'") >= 0, 'K4a i18n 有英文');
ok(inject.indexOf("'闲置多久算不用了': 'Idle threshold'") >= 0 && inject.indexOf("'账号自动切换': 'Account auto-switch'") >= 0, 'K4b i18n 覆盖卡片标题与阈值行');
ok(inject.indexOf('还没指定主账号 —— 指定之后才会自动切回。') >= 0, 'K4c 没设主账号时给出可操作提示');
ok(inject.indexOf('闲置阈值需要在 5 ~ 1440 分钟之间') >= 0, 'K4d 阈值越界有提示');

ok(inject.indexOf("'mu0mg334-rate-limit-auto-switch'") >= 0, 'K5a 限流任务进了「内置」id 名单（会显示内置角标）');
ok(inject.indexOf('"mu0mg334-rate-limit-auto-switch": {') >= 0, 'K5b 内置任务的名称/描述进了默认文案表（英文模式能翻）');
ok(inject.indexOf("'模型限流自动切号续跑': 'Auto switch account on rate limit'") >= 0, 'K5c 内置任务名有英文');
const builtinJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'builtin', 'automations', 'rate-limit-auto-switch.json'), 'utf8'));
ok(builtinJson.id === 'mu0mg334-rate-limit-auto-switch', 'K6a 内置定义沿用同样的 id（不会出现两份重复任务）');
// ⚠️ 别把「当前是第几版」写死：改内置定义必然要提 revision，写死就等于每提一次都误报
// （同 §28.6 的教训）。这里只守「格式 + 下限」：revision 是不小于 2 的整数、哈希表非空。
ok(Number.isInteger(builtinJson.revision) && builtinJson.revision >= 2 &&
  Array.isArray(builtinJson.upgradeFromContentHashes) && builtinJson.upgradeFromContentHashes.length >= 1,
  'K6b 内置定义带 revision 与历史内容哈希（能认领在装的那份并升级）',
  { revision: builtinJson.revision, hashes: (builtinJson.upgradeFromContentHashes || []).length });
// §15.6 的坑：描述进了内置文案表就必须同时在 WBS_I18N_EN 里有英文，否则英文模式下取到 undefined。
ok(inject.indexOf(JSON.stringify(builtinJson.description)) >= 0,
  'K6g 内置描述进了 inject.js 的默认文案表');
ok(inject.indexOf("'" + builtinJson.description + "':") >= 0,
  'K6h 内置描述在 WBS_I18N_EN 里有对应英文');
ok(builtinJson.enabled === true && builtinJson.schedule && builtinJson.schedule.minutes === 1, 'K6c 内置定义保留原触发方式（1 分钟兜底定时）');
ok(JSON.stringify(builtinJson.steps).indexOf('account.failoverContinue') >= 0, 'K6d 内置定义里仍是 failoverContinue 那套步骤');
ok(builtinJson.description.length <= 500, 'K6e 描述不超过 500 字（超了会被 normalizeTask 截断、哈希对不上）', builtinJson.description.length);
const builtinName = path.join(ROOT, 'scripts', 'builtin', 'automations', 'rate-limit-auto-switch.json');
ok(fs.existsSync(builtinName), 'K6f 内置定义落在 scripts/builtin/automations/（构建脚本会打进安装包）');
ok(automation.indexOf('function adoptBuiltinTask') >= 0, 'K7a automation.js 提供 adoptBuiltinTask');
ok(/adoptBuiltinTask,\n/.test(automation), 'K7b adoptBuiltinTask 已导出');
ok(/known\.indexOf\(installedHash\) < 0\) \{\n    return \{ status: 'content-mismatch'/.test(automation),
  'K7c 内容对不上（用户改过）时拒绝认领，绝不覆盖');
ok(/const markerRevision = sameAsBuiltin \? revision : 1;/.test(automation), 'K7d 认领时记的 revision 与在装内容对应');
ok(src.indexOf('adoptBuiltinTask,') >= 0 && src.indexOf('内置任务已认领') >= 0, 'K7e daemon 启动时先认领再安装内置任务');

/* ---- 还原 ---- */
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}

}

main().then(() => {
  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}).catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
