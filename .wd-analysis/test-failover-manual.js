'use strict';
/*
 * test-failover-manual.js —— F5：限流时「换号并续跑」的**手动入口**。
 *
 * 为什么要有这个套件（改之前先读）：
 *   以前只有自动化任务里的 account.failoverContinue 步骤能触发换号续跑，
 *   POST /api/limit-failover/trigger 在没有这种任务时直接 404 —— 没配自动化的用户
 *   在限流时完全无路可走。F5 补的是这条出口，外加两件必须同时守住的事：
 *
 *   ① **不许把健康的号写进限流窗口**。手动换号未必因为限流；`markAccountBlocked`
 *      写的是「谁在窗口内」这个**给选号器看的硬事实**，误写会让一个完全正常的号
 *      在之后一整个窗口里不被选中。所以 core 支持 `detail.markBlocked === false`，
 *      且**缺省必须保持原行为**（自动路径零变化）。
 *   ② **面板文案不许串词**。applyI18n 是「最长优先匹配」扫描：一段没登记的文本里
 *      只要出现词典的短 key，短 key 就会被就地替换成英文，句子变成中英混合
 *      （F2 踩过这个坑）。所以每行文字都必须是**整句登记的词条**，动态部分走 {x} 模板。
 *
 * 做法（照抄 test-limit-failover.js 的既有做法）：
 *   1. 不 require daemon.js（require 即起 HTTP 服务）——从源码**切片** + new Function 注入。
 *   2. 所有副作用都走 ports stub，**不碰真实账号 / 不切号 / 不发消息**。
 *   3. daemon.js / inject.js 是 CRLF，切片前统一归一化为 LF。
 *
 * 跑法：node .wd-analysis/test-failover-manual.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DAEMON_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
const INJECT_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const failures = [];
function fail(msg) { failures.push(msg); throw new Error('TEST-ABORT: ' + msg); }
function check(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

/* ==================================================================== */
section('[A] core：markBlocked 缺省保持原行为 / 显式 false 不写限流窗口');
/* ==================================================================== */

/* ---------- 从 daemon.js 切出「模型限流自动切号续跑」整块 ---------- */
const START = '/* ---------------- 模型限流自动切号续跑 ---------------- */';
const startIdx = DAEMON_SRC.indexOf(START);
if (startIdx < 0) fail('daemon.js 里找不到限流切号代码块的起始注释锚点');

const anchor = 'async function runLimitFailoverCore(detail, ports) {';
const aIdx = DAEMON_SRC.indexOf(anchor, startIdx);
if (aIdx < 0) fail('daemon.js 里找不到 runLimitFailoverCore 定义');

let depth = 0, coreEnd = -1;
for (let i = DAEMON_SRC.indexOf('{', aIdx); i < DAEMON_SRC.length; i += 1) {
  const ch = DAEMON_SRC[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') { depth -= 1; if (depth === 0) { coreEnd = i + 1; break; } }
}
if (coreEnd < 0) fail('runLimitFailoverCore 大括号配平失败');
const block = DAEMON_SRC.slice(startIdx, coreEnd);

for (const needed of ['waitLimitVerdict', 'findLimitFailoverTask', 'LIMIT_FAILOVER_VERIFY_MS', 'limitFailoverInFlight']) {
  if (!block.includes(needed)) fail('切出的代码块缺少 ' + needed + '，锚点可能已失效');
}

const limitFailover = require(path.join(ROOT, 'scripts', 'limit-failover.js'));

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-failover-manual-'));
const logs = [];
const world = {
  current: { uid: 'A', nickname: '账号A' },
  accounts: [
    { uid: 'A', nickname: '账号A' },
    { uid: 'B', nickname: '账号B' },
    { uid: 'C', nickname: '账号C' },
  ],
};

const factory = new Function(
  'path', 'DATA_DIR', 'fs', 'log',
  'cachedCreditRotationAccounts', 'listAccounts',
  'limitFailover', 'currentAccount', 'sleep',
  'readAutomations', 'automationRuns', 'automationPublicRun',
  block + '\nreturn { runLimitFailoverCore: runLimitFailoverCore, STATE_FILE: LIMIT_FAILOVER_STATE_FILE };'
);

const core = factory(
  path,
  stateDir,
  fs,
  (m) => logs.push(m),
  () => [],
  () => world.accounts,
  limitFailover,
  () => world.current,
  () => Promise.resolve(),
  () => [{ id: 't1', name: '限流切号续跑', enabled: true, steps: [{ op: 'account.failoverContinue' }] }],
  new Map(),
  (r) => r
);

const STATE_FILE = core.STATE_FILE;
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } };
function reset() {
  try { fs.unlinkSync(STATE_FILE); } catch (_) { /* 不存在就算了 */ }
  world.current = { uid: 'A', nickname: '账号A' };
  world.accounts = [
    { uid: 'A', nickname: '账号A' },
    { uid: 'B', nickname: '账号B' },
    { uid: 'C', nickname: '账号C' },
  ];
  logs.length = 0;
}

// 全成功路径的 ports：不做真实副作用，只记录「真的换了号、真的发了续跑指令」
function makePorts(overrides) {
  const calls = { switched: [], sent: [], notified: [] };
  const ports = {
    readBanner: async () => ({ ok: true, hit: false, count: 0, hits: [] }),
    replyStarted: async () => true,
    readModel: async () => ({ ok: true, model: 'deepseek-v4.1-flash', conversationId: 'conv-1' }),
    setModel: async () => ({ ok: true, changed: false }),
    readTaskText: async () => ({ ok: true, text: '把这段合同的关键条款列出来' }),
    switchAccount: async (acct) => { calls.switched.push(acct.uid); world.current = acct; return { ok: true }; },
    afterAccountSwitch: () => null,
    prepareContinuation: async () => ({ mode: 'new', reason: 'stub' }),
    ensureNewTask: async () => ({ ok: true }),
    sendPhrase: async (t) => { calls.sent.push(t); return { ok: true }; },
    guard: async () => {},
    log: (m) => logs.push(m),
    notify: async (lvl, msg) => { calls.notified.push([lvl, msg]); },
    setPanelOpen: async () => true,
    wasPanelOpen: false,
  };
  Object.assign(ports, overrides || {});
  ports.calls = calls;
  return ports;
}

(async () => {
  // A1–A2：缺省（不传 markBlocked）⇒ 与加这个功能之前逐字等价：记「源账号被限流」
  {
    reset();
    const ports = makePorts();
    const result = await core.runLimitFailoverCore({}, ports);
    const st = readState();
    check(result && result.ok === true, 'A1a 缺省时换号续跑成功（stub 全绿）', result);
    check(!!(st.A && st.A.blockedUntil), 'A1b 【原行为】缺省时源账号被记入限流窗口，且带绝对到期时刻', st.A);
    check(st.A && st.A.reason === 'detected', 'A2 缺省时 reason 仍是 detected（调用方什么都不用改）', st.A);
  }

  // A3–A6：显式 false ⇒ 一个字节都不写；但换号续跑本身照常跑完
  {
    reset();
    const ports = makePorts();
    const result = await core.runLimitFailoverCore({ markBlocked: false }, ports);
    const st = readState();
    check(Object.keys(st).length === 0, 'A3 【铁律】markBlocked:false 时**完全不写**状态文件（健康的号不进限流窗口）', st);
    check(result && result.ok === true && result.toUid === 'B', 'A4 markBlocked 只影响记账，不影响选号与换号', result && { ok: result.ok, toUid: result.toUid });
    check(ports.calls.switched.length === 1 && ports.calls.switched[0] === 'B', 'A5 markBlocked:false 时换号照常发生', ports.calls.switched);
    check(ports.calls.sent.length === 1, 'A6 markBlocked:false 时续跑指令照常发出', ports.calls.sent);
  }

  // A7：显式 true ⇒ 与缺省同效（手动入口在「已被判定限流」时会走这条路）
  {
    reset();
    const ports = makePorts();
    await core.runLimitFailoverCore({ markBlocked: true }, ports);
    const st = readState();
    check(!!(st.A && st.A.blockedUntil), 'A7 markBlocked:true 与缺省同效（显式表态不改变语义）', st.A);
  }

  /* ==================================================================== */
  section('\n[B] ports 装配：与 core 分居两处，且覆盖 core 用到的每一个端口');
  /* ==================================================================== */

  const builderDef = 'function buildLimitFailoverPorts(ctx) {';
  const bIdx = DAEMON_SRC.indexOf(builderDef);
  check(bIdx > 0, 'B1 daemon.js 里有 buildLimitFailoverPorts（自动与手动共用同一份装配）');
  check(bIdx > coreEnd, 'B2 【硬要求】装配函数落在 core 的花括号**之外** —— 切片沙箱里出现模块级新标识符 = ReferenceError 被吞成静默业务失败');
  check(block.indexOf('buildLimitFailoverPorts(') < 0, 'B3 【反向守卫】core 切片内不出现 buildLimitFailoverPorts（core 只认 ports 上的名字）');
  check(block.indexOf('accountHealth.') < 0, 'B4 【反向守卫】core 切片内不出现 accountHealth 模块级标识符');

  // core 里用到的每一个 ports.X，builder 都必须提供 —— 漏一个就是运行期 TypeError
  {
    const used = [...new Set([...block.matchAll(/ports\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]))].sort();
    const bEnd = (() => {
      let d = 0;
      for (let i = DAEMON_SRC.indexOf('{', bIdx); i < DAEMON_SRC.length; i += 1) {
        const ch = DAEMON_SRC[i];
        if (ch === '{') d += 1;
        else if (ch === '}') { d -= 1; if (d === 0) return i + 1; }
      }
      return -1;
    })();
    const builder = bEnd > 0 ? DAEMON_SRC.slice(bIdx, bEnd) : '';
    const missing = used.filter((name) => !new RegExp('(^|[\\s{,])' + name + '\\s*:', 'm').test(builder));
    check(used.length >= 15, 'B5 core 用到的 ports 名字提取正常（' + used.length + ' 个）', used);
    check(missing.length === 0, 'B6 装配函数覆盖 core 用到的每一个端口（漏一个就是运行期 TypeError）', missing);

    // 装配函数里**调用的函数**必须真在 daemon.js 里存在。切片沙箱抓不到这类错：
    // 它只从源码里读端口名，打错一个模块级名字要等真触发才会炸，而且那时代价是一次真切号。
    const BUILTIN = ['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'async', 'await',
      'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Promise', 'JSON', 'Math'];
    const calls = [...new Set([...builder.matchAll(/(?:^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]))]
      .filter((n) => BUILTIN.indexOf(n) < 0);
    const undef = calls.filter((n) => !new RegExp('(function\\s+' + n + '\\b|(?:const|let|var)\\s+' + n + '\\b|[,{\\s]' + n + '\\s*[,}]|\\b' + n + '\\s*=)').test(DAEMON_SRC));
    check(calls.length >= 10 && undef.length === 0,
      'B11 装配函数里调用的每个函数都在 daemon.js 里有定义（' + calls.length + ' 个，防打错模块级名字）', undef);

    // 直接当值传的那些（`readBanner: readLimitBanner,` 这种）不会以 `(` 出现，单独点名核一遍 ——
    // 打错名字的形态是 ReferenceError，而它发生在「真触发切号」那一刻。
    const bare = ['readLimitBanner', 'limitReplyStarted', 'readLiveModel', 'setLiveModel', 'readLastUserTaskText',
      'automationSwitchAccount', 'autoCopyAfterAccountSwitch', 'prepareFailoverContinuation', 'ensureAutomationNewTask',
      'acSendPhrase', 'automationPanelSetOpen', 'readFailoverSnapshot', 'buildFailoverHealthFilter',
      'recordAccountHealth', 'writeAccountHealth', 'readAccountHealth'];
    const gone = bare.filter((n) => builder.indexOf(n) < 0);
    const bareUndef = bare.filter((n) => !new RegExp('(function\\s+' + n + '\\b|(?:const|let|var)\\s+' + n + '\\b|[,{\\s]' + n + '\\s*[,}]|\\b' + n + '\\s*=)').test(DAEMON_SRC));
    check(gone.length === 0 && bareUndef.length === 0,
      'B12 装配里当值引用的模块级函数全部在位（' + bare.length + ' 个）', { gone, bareUndef });
  }

  // 自动路径已改用装配函数，且 ctx 五件套齐全
  {
    const callIdx = DAEMON_SRC.indexOf('const result = await runLimitFailoverCore(detail, buildLimitFailoverPorts({');
    check(callIdx > 0, 'B7 自动路径（自动化任务）已改用同一份装配，行为不会与手动入口分叉');
    const call = callIdx > 0 ? DAEMON_SRC.slice(callIdx, callIdx + 520) : '';
    for (const key of ['isCancelled', 'log', 'notify', 'captureTaskText', 'wasPanelOpen']) {
      if (!new RegExp('(^|[\\s{])' + key + ':').test(call)) fail('自动路径装配缺少 ctx 参数 ' + key);
    }
    check(true, 'B8 自动路径把 ctx 五件套全部传进装配（isCancelled/log/notify/captureTaskText/wasPanelOpen）');
    check(call.includes("id: 'rl-failover'"), 'B9 【原行为】自动路径的 toast 仍是 id=rl-failover（同名位可被后续覆盖，不是新弹一条）');
    check(DAEMON_SRC.indexOf('readBanner: readLimitBanner,') > bIdx && DAEMON_SRC.indexOf('readBanner: readLimitBanner,') < bIdx + 900,
      'B10 装配函数里挂的是模块级 readLimitBanner（不再由调用方各写一遍）');
  }

  /* ==================================================================== */
  section('\n[C] 手动路由：两个前置刻意不要求 + 立即 202 + 不写错限流窗口');
  /* ==================================================================== */

  // 切片一律按**行锚**取，不靠「掩掉字符串再配平花括号」——
  // 后者会被正则字面量里的引号带偏（`/[^']/` 会让扫描器误入字符串状态），
  // 而且偏了不报错、只是安静地多切几千行。行锚错了当场就红。
  function sliceRoute(src, needle) {
    const all = src.split('\n');
    const i = all.findIndex((l) => l.includes(needle));
    if (i < 0) return '';
    // 路由都是顶格 `  if (req.method ...) {` 开头的块，遇到下一个就是本块结束
    for (let j = i + 1; j < all.length; j += 1) if (/^  if \(req\.method ===/.test(all[j])) return all.slice(i, j).join('\n');
    return all.slice(i).join('\n');
  }
  function sliceFn(src, header, closer) {
    const all = src.split('\n');
    const i = all.findIndex((l) => l === header);
    if (i < 0) return '';
    for (let j = i + 1; j < all.length; j += 1) if (all[j] === closer) return all.slice(i, j + 1).join('\n');
    return '';
  }

  const ROUTE_NEEDLE = "if (req.method === 'POST' && p === '/api/limit-failover/manual') {";
  const route = sliceRoute(DAEMON_SRC, ROUTE_NEEDLE);
  check(route.length > 500 && route.length < 12000, 'C1 手动路由存在且能完整切出（行锚切片，不会多切）', route.length);
  check(DAEMON_SRC.indexOf(ROUTE_NEEDLE) === DAEMON_SRC.lastIndexOf(ROUTE_NEEDLE), 'C2 手动路由只注册一次，且钉死 POST');
  check(route.indexOf('findLimitFailoverTask') < 0,
    'C3 【F5 的洞】路由**不**要求存在启用中的续跑任务（trigger 没任务直接 404，那正是要补的缺口）');
  check(route.indexOf('readLimitBanner') < 0 && route.indexOf('banner.hit') < 0,
    'C4 路由**不**要求页面此刻真挂着限流横幅（这是人按的，不是侦测到的）');
  check(route.indexOf('json(res, 202') > 0,
    'C5 立即返回 202 —— 切号会整页 reload，面板里那个 fetch 必被掐断，只能靠轮询读结果');
  check(route.indexOf('if (!cdp.connected)') > 0, 'C6 前置门①：WorkBuddy 未连接则明确拒绝，不半途抛错');
  check(route.indexOf('const current = currentAccount();') > 0, 'C6b 前置门②：读不到当前账号则拒绝（否则不知道该从哪个号切走）');
  check(route.indexOf('if (!others.length)') > 0, 'C6c 前置门③：只有当前一个账号时明确拒绝，不去跑一轮注定失败的流程');
  check(!/await\s+runLimitFailoverCore\(/.test(route),
    'C7 路由**不 await** 核心：整段含切号 + 会话同步，等不完也不该占住这条连接');

  // markBlocked 三态：显式 boolean 优先，否则取 account-health 的落盘状态
  check(route.indexOf("typeof body.markBlocked === 'boolean'") > 0, 'C8 markBlocked 允许显式表态（供自测与特殊场景覆盖）');
  check(route.indexOf('accountHealth.HEALTH_STATES.RATE_LIMITED') > 0,
    'C9 【铁律】没显式表态时，只有**已被判定限流**的账号才写进限流窗口（判据取自 account-health，不重写分类规则）');
  check(route.indexOf('markBlocked: markBlocked,') > 0, 'C10 markBlocked 真的传进了 detail，否则 core 收不到');
  check(route.indexOf('handleLimitFailoverOutcome(result, {') > 0, 'C11 结果走同一套收尾（桌面大白话日志 + 成功时排定切回主账号）');
  check(route.indexOf('job.running = false;') > 0 && route.indexOf('job.finishedAt = Date.now();') > 0,
    'C12 结束（成功或抛错）都要落 running=false + finishedAt，否则面板会一直转圈');

  // 路由用到的模块级标识符必须都真存在。这类名字打错**加载时不报错**，
  // 只在这条请求进来那一刻炸 —— 而那一刻已经准备真切号了。
  {
    const needed = ['readBody', 'json', 'log', 'cdp', 'currentAccount', 'listAccounts', 'DATA_DIR',
      'readAccountHealth', 'accountHealth', 'automationPanelIsOpen', 'limitFailoverNotify',
      'handleLimitFailoverOutcome', 'buildLimitFailoverPorts', 'runLimitFailoverCore',
      'limitFailoverInFlight', 'limitFailoverManual', 'limitFailoverManualPublic'];
    const unused = needed.filter((n) => !new RegExp('\\b' + n + '\\b').test(route));
    const undef2 = needed.filter((n) => !new RegExp('(function\\s+' + n + '\\b|(?:const|let|var)\\s+' + n + '\\b|[,{\\s]' + n + '\\s*[,}]|\\b' + n + '\\s*=)').test(DAEMON_SRC));
    check(unused.length === 0, 'C13 路由确实用到了清单里的每一个标识符（清单没写错/没漏）', unused);
    check(undef2.length === 0, 'C14 路由用到的每个模块级标识符都在 daemon.js 里有定义（打错名字只在请求时炸）', undef2);
  }

  /* ==================================================================== */
  section('\n[D] 结果槽位与 status 透出：不带正文');
  /* ==================================================================== */

  check(DAEMON_SRC.indexOf('let limitFailoverManual = null;') > 0, 'D1 槽位在（跑完也留着，供面板显示上次结论）');
  check(/inFlight: !!limitFailoverInFlight,\n\s*manual: limitFailoverManualPublic\(\),/.test(DAEMON_SRC),
    'D2 GET /api/limit-failover/status 透出 manual（面板只看这一个端点就够）');

  const proj = sliceFn(DAEMON_SRC, 'function limitFailoverManualPublic() {', '}');
  check(proj.length > 200, 'D3 投影函数存在且能切出');
  {
    // 只允许投影出「结论」这类元数据；正文一律不进 API（与 runLimitFailoverCore 返回值同口径）
    const banned = ['text', 'taskText', 'prompt', 'continueText', 'length'];
    const leaked = banned.filter((k) => new RegExp('(^|[\\s{,])' + k + '\\s*:', 'm').test(proj));
    check(leaked.length === 0, 'D4 投影里没有任何正文键（正文只写桌面日志，不透明出）', leaked);
    for (const key of ['running', 'ok', 'reason', 'fromNickname', 'toNickname', 'markBlocked', 'earliestRecovery']) {
      if (!new RegExp('(^|[\\s{,])' + key + '\\s*:').test(proj)) fail('投影缺字段 ' + key);
    }
    check(true, 'D5 投影字段齐（running/ok/reason/from*Nickname/to*Nickname/markBlocked/earliestRecovery）');
  }

  /* ==================================================================== */
  section('\n[E] 面板接线（inject.js）：卡片 / 轮询 / 整句文案');
  /* ==================================================================== */

  const hasI = (needle) => INJECT_SRC.includes(needle);
  check(hasI("'<div class=\"wbs-pcard wbs-failover-card collapsed\" id=\"wbs-failover-card\">' +"), 'E1 卡片容器在位（复用 pcard 外观，默认折叠不挤占账号列表）');
  check(hasI("'<button class=\"wbs-failover-go\" type=\"button\" id=\"wbs-failover-go\">换号并续跑</button>' +"), 'E2 手动按钮在位且带中文标签（整句进词典）');
  check(hasI('.wbs-failover-go{') && hasI('.wbs-failover-go:disabled{') && hasI('.wbs-failover-go:focus-visible{'),
    'E3 按钮样式齐（含 :disabled 与 :focus-visible）');
  check(hasI('function renderFailoverCard(status) {') && hasI('function refreshFailoverCard() {'), 'E4 渲染与刷新函数都在位');

  // 每行一个文本节点：这是 i18n 不串词的结构前提
  const renderFn = sliceFn(INJECT_SRC, '    function renderFailoverCard(status) {', '    }');
  check(renderFn.indexOf("note.innerHTML = '';") > 0 && renderFn.indexOf("document.createElement('div')") > 0
    && renderFn.indexOf('row.textContent = rows[i];') > 0,
    'E5 【防串词】说明区**每行一个文本节点**（拼成一个节点会被词典里的短词就地替换成中英混合）');
  check(renderFn.indexOf('join(') < 0,
    'E6 【防串词】卡片逻辑里不把多行 join 成一个字符串（join 出来的整段必然不在词典里）');
  check(renderFn.indexOf('applyI18n(failoverCard);') > 0,
    'E7 每次重绘后补一次翻译（否则换语言前建的卡片一直是中文）');

  check(hasI("try { refreshFailoverCard(); } catch (e) {}"), 'E8 账号列表到手后一并刷新（与 idle 卡同拍）');
  check(hasI("if (name === 'account') { try { refreshFailoverCard(); } catch (e) {} }"), 'E9 进账号页时一并刷新');
  check(hasI("api('/api/limit-failover/manual', { method: 'POST', body: JSON.stringify({}) })"),
    'E10 按钮打的是手动端点（POST 空 body ⇒ 续跑当前会话里最后一条用户消息）');
  check(hasI('if (failoverCard && failoverCard.isConnected && data && (data.inFlight'),
    'E11 【切号会整页 reload】轮询只在卡片还挂在 DOM 里时接着排，重建后由刷新点重新拉起来');
  check(hasI('goBtn.disabled = running;'), 'E12 换号在飞时按钮禁用（不给第二次点击）');
  check(hasI("if (key === 'no-task-text') return '会话里没有可续跑的消息';")
    && hasI("if (key === 'all-unhealthy') return '其他账号需要先重新登录';"),
    'E13 后端 reason 映射到**整句**中文（半句不命中词典，会被短词撕开）');

  check(hasI('function failoverDataRow(label, data) {'), 'E14 数据行拆成「标签 + 数据」两个元素（标签走词典、数据走 i18n-skip）');

  /* ==================================================================== */
  section('\n[F] i18n：整句登记 + 数据不参与翻译（镜像 inject.js 的匹配算法做交叉验证）');
  /* ==================================================================== */

  // ---- 词典抽取 ----
  const dictStart = INJECT_SRC.indexOf('var WBS_I18N_EN = {');
  if (dictStart < 0) fail('找不到 WBS_I18N_EN');
  const dictEnd = (() => {
    let d = 0, quote = '';
    for (let i = INJECT_SRC.indexOf('{', dictStart); i < INJECT_SRC.length; i += 1) {
      const ch = INJECT_SRC[i];
      if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = ''; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '{') d += 1;
      else if (ch === '}') { d -= 1; if (d === 0) return i + 1; }
    }
    return -1;
  })();
  if (dictEnd < 0) fail('词典字面量没有闭合');
  const dictLiteral = INJECT_SRC.slice(INJECT_SRC.indexOf('{', dictStart), dictEnd);
  const DICT = eval('(' + dictLiteral + ')');

  // 词条「恰好一次」用字面量里的 key 出现次数判定：重复定义会被静默丢弃（留首次）
  const keyOccurrences = (key) => {
    const re = new RegExp("(?:^|[,{\\s])'" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\s*:", 'g');
    return (dictLiteral.match(re) || []).length;
  };

  const EXPECT = {
    '限流时换号并续跑': 'Switch and resume on rate limit',
    '换号并续跑': 'Switch and resume',
    '自动接管': 'Auto take-over',
    '仅手动': 'Manual only',
    '检测到限流横幅会自动换号并接着做。': 'It switches account and carries on automatically once a rate-limit banner appears.',
    '没有启用中的限流续跑任务：只能手动点按钮换号。': 'No rate-limit resume task is enabled — use the button to switch manually.',
    '正在换号续跑…': 'Switching account and resuming…',
    '上次换号续跑成功': 'Last switch-and-resume succeeded',
    '上次换号续跑失败': 'Last switch-and-resume failed',
    '限流窗口内：': 'Inside the rate-limit window: ',
    '最早可重试：': 'Earliest retry: ',
    '会话里没有可续跑的消息': 'No message to resume in this conversation',
    '其他账号都在限流窗口内': 'Every other account is inside the rate-limit window',
    '没有别的账号可以接管': 'No other account can take over',
    '其他账号需要先重新登录': 'The other accounts need to sign in again first',
    '其他账号都无法接管': 'None of the other accounts could take over',
    '换号续跑没有成功': 'The switch-and-resume did not succeed',
  };

  let keyBad = 0;
  for (const key of Object.keys(EXPECT)) {
    const n = keyOccurrences(key);
    const okValue = DICT[key] === EXPECT[key];
    if (n !== 1 || !okValue) { keyBad += 1; check(false, 'F 词条 ' + JSON.stringify(key) + '（出现 ' + n + ' 次，译文 ' + JSON.stringify(DICT[key]) + '）'); }
  }
  check(keyBad === 0, 'F1 新增 ' + Object.keys(EXPECT).length + ' 条词条各出现恰好一次，且英文符合预期');

  // 新译文不得含任何**其它**中文词条 —— 否则翻译结果会被二次替换
  {
    const allKeys = Object.keys(DICT);
    const dirty = [];
    for (const key of Object.keys(EXPECT)) {
      const en = DICT[key] || '';
      for (const other of allKeys) if (en.indexOf(other) >= 0) dirty.push(key + ' ← ' + other);
    }
    check(dirty.length === 0, 'F2 新词条的英文译文里不含任何中文词条（不会被二次替换）', dirty);
  }

  // ---- 镜像 inject.js 的 wbsTranslateString：左→右、每个位置取最长优先匹配 ----
  const MATCHERS = (() => {
    const out = []; const seen = {};
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const key of Object.keys(DICT)) {
      const normKey = key.replace(/：/g, ':').replace(/\s+$/, '');
      if (seen[normKey]) continue;
      seen[normKey] = true;
      const names = []; let reSource = '', cursor = 0, token = null, hasPlaceholder = false;
      const tokenRe = /\{([a-zA-Z0-9_]+)\}/g;
      while ((token = tokenRe.exec(normKey)) !== null) {
        hasPlaceholder = true;
        reSource += esc(normKey.slice(cursor, token.index)) + '([\\s\\S]*?)';
        names.push(token[1]); cursor = token.index + token[0].length;
      }
      reSource += esc(normKey.slice(cursor));
      out.push({ normKey, hasPlaceholder, re: hasPlaceholder ? new RegExp(reSource) : null, translation: DICT[key], names });
    }
    out.sort((a, b) => b.normKey.length - a.normKey.length);
    return out;
  })();
  function translate(value) {
    const source = String(value == null ? '' : value);
    if (!/[\u4e00-\u9fff]/.test(source)) return source;
    const nsource = source.replace(/：/g, ':');
    let out = '', pos = 0;
    while (pos < source.length) {
      const ch = nsource.charAt(pos);
      let best = null;
      for (const entry of MATCHERS) {
        if (entry.normKey.charAt(0) !== ch) continue;
        if (!entry.hasPlaceholder) { if (nsource.indexOf(entry.normKey, pos) === pos) { best = entry; break; } continue; }
        entry.re.lastIndex = 0;
        const m = entry.re.exec(nsource.slice(pos));
        if (m && m.index === 0) { best = entry; best.capture = m; break; }
      }
      if (best) {
        if (best.hasPlaceholder) {
          const args = best.capture.slice(1);
          out += best.translation.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
            const idx = best.names.indexOf(name);
            return idx >= 0 && args[idx] !== undefined ? args[idx] : '';
          });
          pos += best.capture[0].length;
        } else {
          out += best.translation;
          let advance = best.normKey.length;
          if (nsource.charAt(pos + advance) === ' ') advance += 1;
          pos += advance;
        }
      } else { out += ch; pos += 1; }
    }
    return out;
  }
  const isMixed = (s) => /[\u4e00-\u9fff]/.test(s) && /[A-Za-z]/.test(s);

  {
    const bad = [];
    for (const key of Object.keys(EXPECT)) {
      const out = translate(key);
      if (out !== EXPECT[key]) bad.push(key + ' -> ' + out);
    }
    check(bad.length === 0, 'F3 ' + Object.keys(EXPECT).length + ' 条整句经词典扫描后**逐字**等于登记的英文（不串词、无中英混合）', bad);
  }
  {
    // 数据行：标签与数据**必须分两个元素**。这里用反向对照把「为什么必须拆」钉住。
    const joined = translate('限流窗口内：账号B、账号C');
    check(joined !== 'Inside the rate-limit window: 账号B、账号C' && joined.indexOf('账号') < 0,
      'F4 【反向对照】标签与数据拼进同一个文本节点时，账号名里的「账号」会被词典翻掉（AccountB）—— 这就是必须拆元素的原因', joined);
    check(translate('限流窗口内：') === 'Inside the rate-limit window: '
      && translate('最早可重试：') === 'Earliest retry: ',
      'F5 两条数据行标签各自是整句词条（作为独立元素时逐字命中词典）');
    check(hasI("value.setAttribute('data-wbs-i18n-skip', '1');") && hasI('value.textContent = data;'),
      'F6 数据（账号名 / 时刻）挂在 data-wbs-i18n-skip 子树里 —— applyI18n 的 isSkipped 会明确跳过');
    check(hasI("out.push({ label: '限流窗口内：', data: names.join('、') })")
      && hasI("out.push({ label: '最早可重试：', data: failoverClock(earliest) })"),
      'F7 面板确实把「标签 / 数据」配对交给 failoverDataRow（不是拼成一句）');
  }

  /* ==================================================================== */
  console.log('');
  console.log('==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
  if (failures.length) { for (const f of failures) console.log('  · ' + f); process.exit(1); }
})().catch((e) => {
  console.log('');
  console.log('==== 结果：' + pass + ' 通过 / ' + (failures.length + 1) + ' 失败 ====');
  console.log('  异常中止：' + (e && e.message));
  process.exit(1);
});
