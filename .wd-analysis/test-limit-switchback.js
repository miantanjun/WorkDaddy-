'use strict';
/*
 * test-limit-switchback.js —— 「限流切号续跑结束后自动切回主账号」+「桌面大白话日志」的回归测试。
 *
 * 两段：
 *   【H】日志模块 scripts/limit-failover-log.js —— 可以直接 require（不依赖 daemon）。
 *   【W】daemon.js 里的切回编排 —— 从源码切片 + new Function 注入 stub。
 *       严禁真的切号 / 发消息 / 写真实桌面：currentAccount / automationSwitchAccount / listAccounts
 *       全部是 stub，桌面目录用 process.env.USERPROFILE 指向临时目录。
 *
 * 跑法：node .wd-analysis/test-limit-switchback.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const logMod = require(path.join(ROOT, 'scripts', 'account-switch-log.js'));
const limitFailover = require(path.join(ROOT, 'scripts', 'limit-failover.js'));

let pass = 0;
const failures = [];
// 模块级持有：沙箱会把 Date.now 换成「假时钟」，任何异常路径都必须能还原
const realNow = Date.now;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function section(title) { console.log('\n' + title); }

// ⚠️ Node 22：一个 .js 里同时出现 require() 和顶层 await 会被判为「模块格式不明」直接报错，
// 所以整段跑在 async main() 里，别把 await 提到顶层。
async function main() {

/* ==================================================================== */
/* 【H】日志模块                                                         */
/* ==================================================================== */

section('[H] 桌面大白话日志模块');

const f1 = logMod.formatClock(new Date(2026, 8, 14, 19, 3, 7).getTime());
ok(f1 === '2026-09-14 19:03:07', 'H1 formatClock 本地时区 + 补零', f1);
ok(logMod.formatDuration(42000) === '42 秒', 'H2a formatDuration 秒', logMod.formatDuration(42000));
ok(logMod.formatDuration(532000) === '8 分 52 秒', 'H2b formatDuration 分秒', logMod.formatDuration(532000));
ok(logMod.formatDuration(3780000) === '1 小时 3 分', 'H2c formatDuration 小时', logMod.formatDuration(3780000));
ok(logMod.formatDuration(600000) === '10 分钟', 'H2d formatDuration 整分钟不啰嗦成「10 分 0 秒」', logMod.formatDuration(600000));
ok(logMod.formatDuration(300094) === '5 分钟', 'H2e 5 分 0 秒 → 5 分钟（真实的 5 分钟闲置就是这样）', logMod.formatDuration(300094));

const snip = logMod.snippet('第一行\n\n第二行   带空格 ' + 'x'.repeat(200), 20);
ok(snip.length === 21 && snip.endsWith('…'), 'H3a snippet 截断加省略号', snip);
ok(!/\s\s|\n/.test(snip), 'H3b snippet 塌掉换行与连续空白', JSON.stringify(snip));
ok(logMod.snippet('   ', 10) === '', 'H3c 全空白 → 空串');

ok(logMod.accountLabel('1d80c722-dff7-4bb7', '面瘫君') === '面瘫君（1d80c722）', 'H4a 账号标签 = 昵称 + uid 前 8 位', logMod.accountLabel('1d80c722-dff7-4bb7', '面瘫君'));
ok(logMod.accountLabel('', '面瘫君') === '面瘫君', 'H4b 没 uid 时只有昵称');
ok(logMod.accountLabel('1d80c722-dff7-4bb7', '') === '账号 1d80c722', 'H4c 没昵称时用 uid 前 8 位');
ok(logMod.accountLabel('', '') === '未知账号', 'H4d 都没有 → 未知账号');

const ts = new Date(2026, 8, 14, 19, 32, 11).getTime();
ok(logMod.logFileName(ts) === 'WorkDaddy-账号切换日志-2026-09-14.txt', 'H5 文件名按天', logMod.logFileName(ts));

const cands = logMod.desktopCandidates({ USERPROFILE: 'C:\\Users\\Lyon', OneDrive: 'C:\\Users\\Lyon\\OneDrive' });
ok(cands[0] === path.join('C:\\Users\\Lyon', 'Desktop'), 'H6a 首选 %USERPROFILE%\\Desktop', cands[0]);
ok(cands.indexOf(path.join('C:\\Users\\Lyon', 'OneDrive', 'Desktop')) >= 0, 'H6b 覆盖 OneDrive 接管桌面的情况', cands);

const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-switchback-home-'));
fs.mkdirSync(path.join(homeA, 'Desktop'), { recursive: true });
ok(logMod.resolveLogDir({ env: { USERPROFILE: homeA }, existsSync: fs.existsSync, fallbackDir: 'FALLBACK' }) === path.join(homeA, 'Desktop'),
  'H7a 命中第一个真实存在的桌面目录');
ok(logMod.resolveLogDir({ env: { USERPROFILE: 'C:\\NoSuchUser\\x' }, existsSync: () => false, fallbackDir: 'FALLBACK' }) === 'FALLBACK',
  'H7b 都不存在时回落调用方给的目录（不硬写桌面）');

const logDir = path.join(homeA, 'Desktop');
const w1 = logMod.appendReport({ dir: logDir, at: ts, text: logMod.buildTriggerReport({ at: ts, fromUid: 'a', fromNickname: 'A', toUid: 'b', toNickname: 'B', modelId: 'm1', taskSource: 'lastUserMessage', taskText: '任务', triedCount: 1 }) });
ok(w1.ok === true && w1.created === true, 'H8a 首次创建成功', w1);
const first = fs.readFileSync(w1.file, 'utf8');
ok(first.charCodeAt(0) === 0xFEFF, 'H8b 首写带 UTF-8 BOM（记事本不乱码）');
ok(first.indexOf('WorkDaddy 账号切换日志') >= 0 && first.indexOf('\r\n') >= 0, 'H8c 带说明头且落盘是 CRLF');
const w2 = logMod.appendReport({ dir: logDir, at: ts, text: logMod.buildFailureReport({ at: ts, fromUid: 'a', fromNickname: 'A', reason: 'no-task-text' }) });
const second = fs.readFileSync(w2.file, 'utf8');
ok(w2.created === false, 'H8d 二次追加不新建文件');
ok(second.charCodeAt(0) === 0xFEFF && second.split('账号切换日志').length === 2, 'H8e 追加不重复写 BOM/说明头');
ok(second.indexOf('自动换账号续跑') >= 0 && second.indexOf('没能自动换账号续跑') >= 0, 'H8f 追加不覆盖前一段');
ok(fs.readdirSync(logDir).filter((n) => n.indexOf('账号切换日志') >= 0).length === 1, 'H8g 一天一个文件');
ok(logMod.appendReport({ dir: '', at: ts, text: 'x' }).ok === false, 'H8h 没有目录时不抛异常，返回 ok:false');

const trig = logMod.buildTriggerReport({
  at: ts, fromUid: '1d80c722-dff7', fromNickname: '账号甲', toUid: '827977d7-77ca', toNickname: '账号乙',
  modelId: 'claude-sonnet-4-5', taskSource: 'lastUserMessage', taskText: '帮我看看这份合同的付款条款' + '啊'.repeat(100), triedCount: 2,
});
ok(trig.indexOf('什么情况') >= 0 && trig.indexOf('怎么处理') >= 0 && trig.indexOf('结果') >= 0 && trig.indexOf('接下来') >= 0,
  'H9a 触发段含四要素（什么情况/怎么处理/结果/接下来）');
ok(trig.indexOf('账号甲（1d80c722）') >= 0 && trig.indexOf('账号乙（827977d7）') >= 0, 'H9b 用昵称 + uid 前 8 位，不暴露全 uid');
ok(trig.indexOf('1d80c722-dff7') < 0, 'H9c 正文里不出现完整 uid');
ok(trig.indexOf('自动把账号切回主账号') >= 0, 'H9d 明说「接下来会自动切回主账号」');
ok(trig.indexOf('试了 2 个账号才成功') >= 0, 'H9e 多次尝试要写出来');
ok(trig.indexOf('…') > 0 && trig.indexOf('啊'.repeat(100)) < 0, 'H9f 任务内容只留摘要（不留全文）');

const fail1 = logMod.buildFailureReport({ at: ts, fromUid: 'a', fromNickname: 'A', reason: 'no-task-text' });
ok(fail1.indexOf('没有可以重发的用户消息') >= 0, 'H10a 失败段给出大白话原因（no-task-text）');
const fail2 = logMod.buildFailureReport({ at: ts, fromUid: 'a', fromNickname: 'A', reason: 'no-usable-target', triedLabels: ['账号B（b）', '账号C（c）'] });
ok(fail2.indexOf('试过的账号') >= 0 && fail2.indexOf('账号C（c）') >= 0, 'H10b 失败段列出试过的账号');
ok(fail2.indexOf('建议手动换个账号') >= 0, 'H10c 失败段给出下一步建议');

const planSample = { toUid: 'b', toNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' };
const REPORTS = {
  switched: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'switched', primaryUid: 'a', primaryNickname: '主账号A', elapsedMs: 532000 } }),
  waited: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'waited', primaryUid: 'a', primaryNickname: '主账号A', waitedMs: 130000, elapsedMs: 532000 } }),
  'no-need': logMod.buildSwitchBackReport({ at: ts, plan: { toUid: 'a', toNickname: '主账号A' }, outcome: { status: 'no-need', primaryUid: 'a' } }),
  already: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'already', primaryUid: 'a', primaryNickname: '主账号A' } }),
  'no-primary': logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'no-primary' } }),
  unavailable: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'unavailable', primaryUid: 'a', primaryNickname: '主账号A' } }),
  blocked: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'blocked', primaryUid: 'a', primaryNickname: '主账号A', blockedUntil: ts + 900000 } }),
  unsure: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'unsure', startWaitMs: 90000 } }),
  timeout: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'timeout', maxWaitMs: 2700000 } }),
  superseded: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'superseded' } }),
  failed: logMod.buildSwitchBackReport({ at: ts, plan: planSample, outcome: { status: 'failed', error: 'CDP 断开' } }),
};
Object.keys(REPORTS).forEach((key) => {
  const text = REPORTS[key];
  ok(typeof text === 'string' && text.indexOf('【') >= 0 && text.length > 60, 'H11-' + key + ' 段落可渲染且有内容', typeof text);
});
ok(/已切回主账号/.test(REPORTS.switched) && /页面会自动刷新/.test(REPORTS.switched), 'H12a switched 写明已切回 + 会刷新页面');
ok(/等它过去之后才切回/.test(REPORTS.waited) && /2 分 10 秒/.test(REPORTS.waited), 'H12b waited 说明为什么等 + 等了多久');
ok(/不需要切回/.test(REPORTS['no-need']), 'H12c no-need 说明不用切');
ok(/你已经手动切回/.test(REPORTS.already), 'H12d already 不重复动手');
ok(/找不到主账号/.test(REPORTS['no-primary']) && /指定主账号/.test(REPORTS['no-primary']), 'H12e no-primary 教用户怎么设主账号');
ok(/不在账号列表里/.test(REPORTS.unavailable), 'H12f unavailable 说明主账号不可用');
ok(/还在限流窗口内/.test(REPORTS.blocked) && /稍后手动切回/.test(REPORTS.blocked), 'H12g blocked 说明仍在限流且给了退路');
ok(/没能确认续跑真的跑起来/.test(REPORTS.unsure) && /保持不动/.test(REPORTS.unsure), 'H12h unsure 说明保守不动账号');
ok(/还没跑完/.test(REPORTS.timeout) && /掐死/.test(REPORTS.timeout), 'H12i timeout 说明为什么不能切');
ok(/又变了/.test(REPORTS.superseded) && /交给新一轮/.test(REPORTS.superseded), 'H12j superseded 说明交给新一轮');
ok(/切回主账号失败/.test(REPORTS.failed) && /CDP 断开/.test(REPORTS.failed), 'H12k failed 带底层报错');
Object.keys(REPORTS).forEach((key) => {
  ok(REPORTS[key].indexOf('\r\n') < 0, 'H13-' + key + ' 段落内部用 LF（落盘时才转 CRLF）');
});

/* ---- H14 闲置切回段落（与限流切回共用同一个桌面文件） ---- */
const idleSwitched = logMod.buildIdleSwitchBackReport({
  at: ts,
  plan: { idleMs: 1920000, minutes: 30, fromUid: 'b', fromNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' },
  outcome: { status: 'switched', primaryUid: 'a', primaryNickname: '主账号A' },
});
ok(/闲置自动切回主账号/.test(idleSwitched) && /32 分钟/.test(idleSwitched), 'H14a 闲置切回段写明结果 + 闲置时长', idleSwitched.slice(0, 60));
ok(/超过 30 分钟就切回/.test(idleSwitched) && /「账号」页调整/.test(idleSwitched), 'H14b 写清判定口径与去哪改阈值');
ok(/页面会自动刷新/.test(idleSwitched), 'H14c 提示会刷新页面');
const idleFailed = logMod.buildIdleSwitchBackReport({
  at: ts,
  plan: { idleMs: 600000, minutes: 10, fromUid: 'b', fromNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' },
  outcome: { status: 'failed', error: 'CDP 未连接', primaryUid: 'a' },
});
ok(/切回失败/.test(idleFailed) && /CDP 未连接/.test(idleFailed), 'H14d 失败也说清楚原因');
ok(logMod.FILE_HEADER.indexOf('闲置') >= 0, 'H14e 说明头写明了两种来源（限流切号 / 闲置切回）');

/* ==================================================================== */
/* 【W】daemon.js 切回编排（源码切片 + stub）                             */
/* ==================================================================== */

section('\n[W] 切回主账号编排（源码切片沙箱）');

const rawDaemon = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const src = rawDaemon.replace(/\r\n/g, '\n');

const START = '/* ---------------- 续跑结束后自动切回主账号 + 桌面大白话日志 ---------------- */';
// 结束锚点要落在**下一个代码块的起始注释**上，而不是 `function automationSwitchAccount`：
// 闲置切回那一块插在同一位，用函数名当锚点会把两块一起切进来（引用了别的模块 → 直接炸）。
const END = '/* ---------------- 非主账号闲置超时 → 自动切回主账号 ---------------- */';
const sIdx = src.indexOf(START);
const eIdx = src.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) { console.log('  FAIL W0 找不到切回编排代码块的锚点'); process.exit(1); }
const block = src.slice(sIdx, eIdx);
['LIMIT_FAILOVER_SWITCHBACK_ENABLED', 'LIMIT_FAILOVER_REPLY_SETTLE_MS', 'LIMIT_FAILOVER_REPLY_STABLE_ROUNDS',
  'scheduleLimitFailoverSwitchBack', 'handleLimitFailoverOutcome', 'runLimitFailoverSwitchBack',
  'waitLimitFailoverChunks', 'limitFailoverLiveRole', 'cancelLimitFailoverSwitchBack', 'writeAccountSwitchDesktopLog']
  .forEach((need) => { if (block.indexOf(need) < 0) { console.log('  FAIL W0 切出的代码块缺少 ' + need); process.exit(1); } });
ok(true, 'W0 切出切回编排代码块（' + block.split('\n').length + ' 行）');

/* ---- 沙箱：时间由 sleep 推进（否则等窗口的循环永远不结束）---- */
let clockOffset = 0;
let sleepCount = 0;
Date.now = () => realNow() + clockOffset;

const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-switchback-'));
const desktopDir = path.join(homeRoot, 'Desktop');
fs.mkdirSync(desktopDir, { recursive: true });
const savedUserProfile = process.env.USERPROFILE;
const savedOneDrive = process.env.OneDrive;
const savedSwitchbackEnv = process.env.WBSWITCH_LIMIT_FAILOVER_SWITCHBACK;
process.env.USERPROFILE = homeRoot;   // 桌面日志落到临时目录，绝不碰真实桌面
delete process.env.OneDrive;

function makeSandbox(options) {
  // 每个场景把假时钟归零：它跨场景累加，而 blockedAt / blockedUntil 都是绝对时间戳，
  // 不清零会出现「上一个场景等掉的 9 分钟把这次的限流窗口提前吃掉」这种鬼结果。
  clockOffset = 0;
  const o = options || {};
  const state = {
    current: o.current || { uid: 'B', nickname: '账号B' },
    accounts: o.accounts || [{ uid: 'A', nickname: '主账号A' }, { uid: 'B', nickname: '账号B' }, { uid: 'C', nickname: '账号C' }],
    primary: o.primary === undefined ? 'A' : o.primary,
    failoverState: o.failoverState || {},
    failoverStateSeq: o.failoverStateSeq || null,
    inFlight: o.inFlight || null,
    banner: o.banner || { ok: true, hit: false, count: 0 },
    idleQueue: o.idle || [{ ok: true, idle: false, why: 'streaming' }, { ok: true, idle: true, why: 'assistant-done' }],
    switchError: o.switchError || null,
    switchCalls: [],
    autoCopyCalls: [],
  };
  const idleOf = () => (state.idleQueue.length > 1 ? state.idleQueue.shift() : state.idleQueue[0]);
  const factory = new Function(
    'path', 'DATA_DIR', 'fs', 'log', 'cdp', 'createAutomationNotifier', 'automationNotifyToast',
    'currentAccount', 'listAccounts', 'primaryAccountStore', 'readLimitFailoverState', 'limitFailoverInFlight',
    'limitFailover', 'accountSwitchLog', 'sleep', 'automationSwitchAccount', 'readLimitBanner', 'runCdpExpression',
    'autoCopyAfterAccountSwitch',
    block + '\nreturn { scheduleLimitFailoverSwitchBack: scheduleLimitFailoverSwitchBack, handleLimitFailoverOutcome: handleLimitFailoverOutcome, getPending: function(){return limitFailoverSwitchBack;}, getLast: function(){return limitFailoverSwitchBackLast;}, getLogFile: function(){return accountSwitchLogFile;}, C: { settle: LIMIT_FAILOVER_REPLY_SETTLE_MS, stable: LIMIT_FAILOVER_REPLY_STABLE_ROUNDS, startWait: LIMIT_FAILOVER_REPLY_START_WAIT_MS, unblockMax: LIMIT_FAILOVER_UNBLOCK_MAX_MS, enabled: LIMIT_FAILOVER_SWITCHBACK_ENABLED } };'  );
  const api = factory(
    path,
    path.join(homeRoot, 'data'),
    fs,
    () => {},
    { connected: false },                       // 不真的发前端通知
    () => ({ show: async () => ({ ok: true }), dismiss: async () => ({ ok: true }), cleanup: async () => ({}) }),
    async () => ({ ok: true }),
    () => state.current,
    () => state.accounts,
    { get: () => state.primary, set: () => state.primary },
    () => {
      if (state.failoverStateSeq) return state.failoverStateSeq.length > 1 ? state.failoverStateSeq.shift() : state.failoverStateSeq[0];
      return state.failoverState;
    },
    state.inFlight,
    limitFailover,
    logMod,
    async (ms) => { sleepCount += 1; if (sleepCount > 20000) throw new Error('sleep 次数异常，疑似死循环'); clockOffset += Number(ms) || 0; },
    async (account) => {
      state.switchCalls.push(String(account && account.uid || ''));
      if (state.switchError) throw new Error(state.switchError);
      state.current = { uid: String(account && account.uid || ''), nickname: '切回来的账号' };
      return { ok: true, uid: state.current.uid, switched: true };
    },
    async () => state.banner,
    async (expression, opts) => {
      if (String(expression).indexOf('messageStore') >= 0 || String(expression).indexOf('assistant-done') >= 0) return idleOf();
      return { ok: true };
    },
    // 切号完成后的自动复制：这里只记录调用，不真的复制
    (sourceUid, targetUid, reason) => {
      state.autoCopyCalls.push({ sourceUid: String(sourceUid), targetUid: String(targetUid), reason: String(reason || '') });
      return { id: 'copy-' + state.autoCopyCalls.length, total: 2 };
    },
    state
  );
  api.state = state;   // 测试需要直接看「当前账号 / 切号调用记录」
  Object.defineProperty(api, 'current', { get: () => state.current });
  Object.defineProperty(api, 'switchCalls', { get: () => state.switchCalls });
  Object.defineProperty(api, 'autoCopyCalls', { get: () => state.autoCopyCalls });
  return api;
}
const sandbox = makeSandbox({});
const SUCCESS = { ok: true, fromUid: 'A', toUid: 'B', toNickname: '账号B', modelId: 'm1', taskSource: 'lastUserMessage', tried: ['B'], verdict: { hit: false } };

function logText() {
  const files = fs.readdirSync(desktopDir).filter((n) => n.indexOf('账号切换日志') >= 0);
  if (!files.length) return '';
  return fs.readFileSync(path.join(desktopDir, files[files.length - 1]), 'utf8');
}
function clearLogs() { fs.readdirSync(desktopDir).forEach((n) => fs.unlinkSync(path.join(desktopDir, n))); }
async function waitLast(sb, timeoutMs) {
  const end = realNow() + (timeoutMs || 5000);
  while (realNow() < end) {
    const last = sb.getLast();
    if (last && last.outcome) return last;
    await new Promise((r) => setTimeout(r, 20));
  }
  return sb.getLast();
}

/* ---- W1 正常路径：等跑完 → 沉降 → 切回 ---- */
clearLogs(); clockOffset = 0;
{
  const sb = makeSandbox({ idle: [{ ok: true, idle: false, why: 'streaming' }, { ok: true, idle: true, why: 'assistant-done' }] });
  sb.handleLimitFailoverOutcome(SUCCESS, { taskText: '帮我看看这份合同的付款条款', fromNickname: '主账号A' });
  ok(!!sb.getPending(), 'W1a 交接成功后立刻排定了切回计划', sb.getPending() && sb.getPending().plan);
  const pending = sb.getPending().plan;
  ok(pending.primaryUid === 'A' && pending.toUid === 'B', 'W1b 计划里记下了「从 B 切回主账号 A」', { primary: pending.primaryUid, to: pending.toUid });
  ok(sb.getLast() === null, 'W1c 此刻还没切号（必须等续跑跑完）');
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'switched', 'W1d 续跑跑完后状态=switched', last && last.outcome);
  ok(sb.current.uid === 'A', 'W1e 当前账号已切回主账号 A', sb.current.uid);
  ok(sb.switchCalls.length === 1 && sb.switchCalls[0] === 'A', 'W1f 只切了一次，且切的是主账号', sb.switchCalls);
  ok(sb.autoCopyCalls.length === 1, 'W1f2 切号完成后触发了一次「切号复制同步会话」', sb.autoCopyCalls);
  ok(sb.autoCopyCalls[0].sourceUid === 'B' && sb.autoCopyCalls[0].targetUid === 'A',
    'W1f3 同步方向：离开的续跑账号 B → 主账号 A', sb.autoCopyCalls[0]);
  ok(sb.autoCopyCalls[0].reason === 'limit-failover-switchback', 'W1f4 带上来路标记（便于回溯是哪条路径触发的）', sb.autoCopyCalls[0]);
  ok(sb.getPending() === null, 'W1g 收尾后清掉 pending');
  const text = logText();
  ok(text.indexOf('自动换账号续跑') >= 0, 'W1h 触发段已写桌面日志');
  ok(text.indexOf('账号已切回主账号') >= 0, 'W1i 收尾段已追加到同一个文件');
  ok(text.indexOf('顺带做了') >= 0 && text.indexOf('共 2 个') >= 0, 'W1j 桌面日志写明顺带同步了几个会话');
}

/* ---- W2 主账号仍在限流窗口 → 等窗口过去再切 ---- */
{
  const sb = makeSandbox({ idle: [{ ok: true, idle: true, why: 'assistant-done' }], failoverState: { A: { blockedAt: realNow() - 60000, reason: 'detected' } } });
  const plan = sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'waited', 'W2a 主账号在限流窗口内 → 等到窗口结束（waited）', last && last.outcome);
  ok(last.outcome.waitedMs > 0, 'W2b 记下了等待时长', last.outcome.waitedMs);
  ok(sb.current.uid === 'A', 'W2c 窗口过后仍然切回了主账号', sb.current.uid);
  ok(logText().indexOf('等它过去之后才切回') >= 0, 'W2d 日志解释了为什么要等');
}

/* ---- W3 等完之后窗口又被刷新 → 放弃切回（blocked）---- */
{
  const blockedAt = realNow();
  const sb = makeSandbox({
    idle: [{ ok: true, idle: true, why: 'assistant-done' }],
    // 第一次读：窗口还剩 9 分钟（够走完「等回复 + 沉降」）；
    // 等完再读：主账号又被判了一次限流（blockedAt 刷新到更晚）→ 必须放弃，不能再等第二轮
    failoverStateSeq: [{ A: { blockedAt: blockedAt - 60000 } }, { A: { blockedAt: blockedAt + 500000 } }],
  });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'blocked', 'W3a 窗口刷新后放弃切回（blocked，不来回横跳）', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W3b 一次都没切', sb.switchCalls);
  ok(logText().indexOf('还在限流窗口内') >= 0, 'W3c 日志写明原因');
}

/* ---- W4 没设主账号 ---- */
{
  const sb = makeSandbox({ primary: '' });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'no-primary', 'W4a 没设主账号 → 不切回', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W4b 不切号');
  ok(logText().indexOf('指定主账号') >= 0, 'W4c 日志告诉用户怎么设主账号');
}

/* ---- W5 主账号备份不存在 ---- */
{
  const sb = makeSandbox({ accounts: [{ uid: 'B', nickname: '账号B' }, { uid: 'C', nickname: '账号C' }], primary: 'A' });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'unavailable', 'W5a 主账号不在账号列表 → 不切回', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W5b 不切号');
}

/* ---- W6 已经是主账号 / 已被手动切回 ---- */
{
  const sb = makeSandbox({ current: { uid: 'A', nickname: '主账号A' } });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'already', 'W6a 当前已是主账号 → 不动作（already）', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W6b 不做多余切号');
}
{
  const sb = makeSandbox({ current: { uid: 'A', nickname: '主账号A' }, primary: 'A' });
  const last = await (async () => { sb.scheduleLimitFailoverSwitchBack(Object.assign({}, SUCCESS, { toUid: 'A', toNickname: '主账号A' }), {}); return waitLast(sb); })();
  ok(last && last.outcome.status === 'no-need', 'W6c 续跑本来就在主账号上 → 无需切回（no-need）', last && last.outcome);
}

/* ---- W7 中途被切到第三账号 ---- */
{
  const sb = makeSandbox({ current: { uid: 'C', nickname: '账号C' } });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'superseded', 'W7a 账号被换走 → 放弃（superseded）', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W7b 不跟新一轮抢账号');
}

/* ---- W8 新一轮切号开始时取消上一轮的切回 ---- */
{
  clearLogs();
  const sb = makeSandbox({ idle: [{ ok: true, idle: true, why: 'assistant-done' }] });
  const plan1 = sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: '第一轮' });
  const plan2 = sb.scheduleLimitFailoverSwitchBack(Object.assign({}, SUCCESS, { toUid: 'C', toNickname: '账号C' }), { taskText: '第二轮' });
  ok(plan1 && plan2 && plan1.toUid === 'B' && plan2.toUid === 'C', 'W8a 第二轮计划覆盖第一轮', { p1: plan1.toUid, p2: plan2.toUid });
  await waitLast(sb);
  await new Promise((r) => setTimeout(r, 60));
  const text = logText();
  ok(text.indexOf('交给新一轮处理') >= 0, 'W8b 第一轮写成 superseded', text.slice(0, 20));
}

/* ---- W9 没法确认续跑跑起来 → 不动账号 ---- */
{
  const sb = makeSandbox({ idle: [{ ok: true, idle: false, why: 'last-is-user' }] });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'unsure', 'W9a 90 秒内没看到回复开始生成 → 不动账号', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W9b 不切号');
}

/* ---- W10 一直没跑完（超上限）---- */
{
  const sb = makeSandbox({ idle: [{ ok: true, idle: false, why: 'streaming' }] });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb, 15000);
  ok(last && last.outcome.status === 'timeout', 'W10a 超过等待上限 → 不切（timeout）', last && last.outcome);
  ok(sb.switchCalls.length === 0, 'W10b 续跑还在跑时绝不切号（否则把任务掐死）');
}

/* ---- W11 切号本身失败 ---- */
{
  const sb = makeSandbox({ switchError: 'CDP 未连接，无法自动刷新窗口' });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'failed', 'W11a 切号抛错 → failed 而不是崩掉', last && last.outcome);
  ok(String(last.outcome.error).indexOf('CDP') >= 0, 'W11b 报错原文留在结果里', last.outcome.error);
  ok(sb.getPending() === null, 'W11c 失败也要清 pending，不能卡住后续流程');
  ok(sb.autoCopyCalls.length === 0, 'W11d 切号失败 → 不触发同步（账号根本没切过去）');
}

/* ---- W12 并发在跑 / 有横幅时不抢账号 ---- */
{
  const sb = makeSandbox({ inFlight: Promise.resolve() });
  sb.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last = await waitLast(sb);
  ok(last && last.outcome.status === 'superseded', 'W12a 已有切号在跑 → 不抢', last && last.outcome);
  const sb2 = makeSandbox({ idle: [{ ok: true, idle: true, why: 'assistant-done' }], banner: { ok: true, hit: true, count: 1 } });
  sb2.scheduleLimitFailoverSwitchBack(SUCCESS, { taskText: 'x' });
  const last2 = await waitLast(sb2);
  ok(last2 && last2.outcome.status === 'superseded' && last2.outcome.reason === 'banner', 'W12b 出现限流横幅 → 让位给新一轮', last2 && last2.outcome);
  ok(sb2.switchCalls.length === 0, 'W12c 不切号');
}

/* ---- W13 不写日志的情形：skip 不算触发 ---- */
{
  clearLogs();
  const sb = makeSandbox({});
  sb.handleLimitFailoverOutcome({ ok: false, skipped: true, reason: '已有一次切号续跑正在进行' }, {});
  ok(logText() === '', 'W13a skip 不写桌面日志（不算一次触发）');
  ok(sb.getPending() === null, 'W13b skip 不排切回');
}

/* ---- W14 失败触发照样写日志 ---- */
{
  clearLogs();
  const sb = makeSandbox({ current: { uid: 'A', nickname: '主账号A' }, accounts: [{ uid: 'A', nickname: '主账号A' }] });
  sb.handleLimitFailoverOutcome({ ok: false, reason: 'no-usable-target', fromUid: 'A', tried: ['B', 'C'], error: '两个都超时' }, { fromNickname: '主账号A' });
  const text = logText();
  ok(text.indexOf('没能自动换账号续跑') >= 0, 'W14a 失败也写桌面日志');
  ok(text.indexOf('试过的账号') >= 0, 'W14b 列出试过的账号');
  ok(sb.getPending() === null, 'W14c 没换成号 → 不排切回');
}

/* ---- W15 关闭开关 ---- */
{
  process.env.WBSWITCH_LIMIT_FAILOVER_SWITCHBACK = '0';
  const sb = makeSandbox({});
  ok(sb.C.enabled === false, 'W15a 环境变量 WBSWITCH_LIMIT_FAILOVER_SWITCHBACK=0 可关闭', sb.C.enabled);
  ok(sb.scheduleLimitFailoverSwitchBack(SUCCESS, {}) === null, 'W15b 关闭后不排切回（日志仍写）');
  if (savedSwitchbackEnv === undefined) delete process.env.WBSWITCH_LIMIT_FAILOVER_SWITCHBACK;
  else process.env.WBSWITCH_LIMIT_FAILOVER_SWITCHBACK = savedSwitchbackEnv;
}

/* ---- W16 常量与顺序（源码级回归锁）---- */
{
  ok(/const LIMIT_FAILOVER_REPLY_SETTLE_MS = 6000;/.test(block), 'W16a 沉降 6 秒');
  ok(/const LIMIT_FAILOVER_REPLY_STABLE_ROUNDS = 3;/.test(block), 'W16b 连续 3 轮 idle 才算跑完');
  ok(/const LIMIT_FAILOVER_REPLY_START_WAIT_MS = 90 \* 1000;/.test(block), 'W16c 90 秒内必须看到续跑开始');
  ok(/limitFailover\.LIMIT_FAILOVER_WINDOW_MS/.test(block), 'W16d 限流窗口复用 limit-failover.js 的常量（不复制一份）');
  const waitIdx = block.indexOf('if (!finished)');
  const switchIdx = block.indexOf('await automationSwitchAccount({ uid: primaryUid });');
  ok(waitIdx > 0 && switchIdx > waitIdx, 'W16e ⚠️ 顺序锁：「等续跑跑完」必须在「切号」之前');
  ok(block.indexOf('readLimitBanner()') > waitIdx, 'W16f 切号前还要再查一次限流横幅');
  const core = src.slice(src.indexOf('/* ---------------- 模型限流自动切号续跑 ---------------- */'), src.indexOf(START));
  ok(core.indexOf('captureTaskText') >= 0, 'W16g core 通过回调把续跑正文交给调用方（不进返回值/API）');
  ok(!/return \{ ok: true,[^}]*taskText:/.test(core), 'W16h 返回值里不带任务正文');
  const wrapper = src.slice(src.indexOf('limitFailover: (detail) => withInput'), src.indexOf('limitFailover: (detail) => withInput') + 2600);
  ok(wrapper.indexOf('handleLimitFailoverOutcome(result') >= 0, 'W16i 自动化依赖里接上了收尾处理');
  ok(wrapper.indexOf('accountBeforeFailover = currentAccount()') >= 0, 'W16j 切号前的账号在 core 之前抓（切完后 currentAccount 已变）');
  ok(src.indexOf("p === '/api/limit-failover/switchback'") >= 0, 'W16k 只读状态端点 /api/limit-failover/switchback 在位');
  ok(/switchBack: \{[\s\S]{0,400}?logDir: limitFailoverDesktopLogDir\(\)/.test(src), 'W16l /api/limit-failover/status 透出切回状态与日志路径');
  ok(src.indexOf("require('./account-switch-log.js')") >= 0, 'W16m daemon 已加载日志模块');
  // 别钉死具体后缀（每落地一个阶段都要回来改一次）：只要求「本轮之后的自建构建」。
  // 命名约定 2026-09-14 起回归上游的 release-x.y.z-…（打包脚本校验这个格式），selfhost- 系列已弃用。
  const buildId = (src.match(/const DAEMON_BUILD_ID = '([^']+)'/) || [])[1] || '';
  ok(/^(selfhost|release)-1\.3\.0-\d{8}-/.test(buildId) && buildId.indexOf('space-scan-slug-fix') < 0,
    'W16n DAEMON_BUILD_ID 已提升（不提升改了也不生效）', buildId);
}

/* ---- 还原 ---- */
Date.now = realNow;
if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
if (savedOneDrive !== undefined) process.env.OneDrive = savedOneDrive;
try { fs.rmSync(homeRoot, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(homeA, { recursive: true, force: true }); } catch (_) {}

}

main().then(() => {
  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}).catch((error) => {
  Date.now = realNow;
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
