'use strict';
// 「定时发送预输入命令」回归测试（纯 Node，不需要 WorkBuddy / CDP）。
//
// 为什么这么测：
//   A 组 —— scheduled-send.js 是纯函数模块，直接 require 真跑；编译出的任务还要交给
//           **真正的引擎**（automation.js 的 executeTask）跑一遍，验证：切到指定账号、
//           session.open → model.set → session.send 的顺序、以及正文含 {{...}} 时逐字节送达。
//   B 组 —— daemon.js 不能 require（require 即起 HTTP 服务），接线用源码切片断言。
//   C 组 —— inject.js 的翻译器是「按位置最长匹配」扫描器：新长句必须整句入典，
//           翻完不能残留 CJK；同时守住「没给裸『日期』/『星期』加词条」这条红线。
//
// 用法: node D:\WorkDaddy\.wd-analysis\test-scheduled-send.js
// 报告（UTF-8）: 同目录 test-scheduled-send.report.txt

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const ss = require(path.join(SCRIPTS, 'scheduled-send.js'));
const auto = require(path.join(SCRIPTS, 'automation.js'));

const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8').replace(/\r\n/g, '\n');
const DAEMON_SRC = read('daemon.js');
const AUTO_SRC = read('automation.js');
const INJECT_SRC = read('inject.js');

const lines = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; lines.push('ok   ' + name); };
const bad = (name, detail) => { fail++; lines.push('FAIL ' + name + (detail ? '  :: ' + detail : '')); };
const check = (name, cond, detail) => { cond ? ok(name) : bad(name, detail); };
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  a === b ? ok(name) : bad(name, 'got=' + a + '  expect=' + b);
};
const throws = (name, fn, part) => {
  try { fn(); bad(name, 'expected a throw'); }
  catch (e) {
    const msg = String((e && e.message) || e);
    if (part && msg.indexOf(part) < 0) bad(name, 'msg=' + JSON.stringify(msg));
    else ok(name);
  }
};
const noThrow = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, String((e && e.message) || e)); } };

const NOW = new Date(2026, 8, 14, 21, 30, 0).getTime();
const AT = '2026-09-15T02:00';
// 正文里刻意放 {{占位符}} 与 {{vars.item}}：引擎的 resolveValue 会把它们当模板替换，
// 这正是「正文必须走 variables 引用」这条设计的靶子。
const MSG = '请把这篇长文改成 800 字摘要。\n保留 {{占位符}} 与 {{vars.item}} 原样。\n结尾署名。';
const UID = 'uid_a1';
const CONV = 'conv_9';

const existingReq = {
  message: MSG, accountUid: UID, accountNickname: '甲', conversationId: CONV,
  conversationTitle: '长文初稿', modelId: 'm-1', schedule: { type: 'once', at: AT },
};
const existing = ss.buildTask(existingReq, { now: NOW });

/* ============================ A 组：纯函数 ============================ */
lines.push('== A1 normalizeRequest 校验 ==');
throws('空正文被拒', () => ss.normalizeRequest({ accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }), '命令内容不能为空');
throws('纯空白正文被拒', () => ss.normalizeRequest({ message: '   \n  ', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }), '命令内容不能为空');
throws('缺账号被拒', () => ss.normalizeRequest({ message: 'x', conversationId: CONV, schedule: { type: 'once', at: AT } }), '请选择账号');
throws('缺对话被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, schedule: { type: 'once', at: AT } }), '对话');
throws('非法定时方式被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'hourly' } }), '触发方式只支持');
throws('once 时间格式非法被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: '2026/09/15 02:00' } }), '请选择有效的执行日期和时间');
throws('once 时间不存在被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: '2026-02-31T02:00' } }), '请选择有效的执行日期和时间');
throws('daily 缺时刻被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'daily' } }), '请选择有效的执行时间');
throws('weekly 无星期被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'weekly', time: '02:00', days: [] } }), '每周至少选择一个星期');
throws('monthly 日期越界被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'monthly', time: '02:00', day: 32 } }), '1–31');
throws('非法任务 id 被拒', () => ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT }, id: 'bad id!' }), '任务标识无效');
throws('正文超长被拒', () => ss.normalizeRequest({ message: 'a'.repeat(ss.MAX_MESSAGE + 1), accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }), '过长');

const crlf = ss.normalizeRequest({ message: '行一\r\n行二', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } });
eq('CRLF 归一为 LF', crlf.message, '行一\n行二');
eq('正文首尾空白保留不 trim', ss.normalizeRequest({ message: '  x  ', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }).message, '  x  ');
check('名称按首行自动生成', ss.normalizeRequest({ message: '第一行\n第二行', accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }).name === '定时发送 · 第一行');
check('名称上限 120 字', ss.normalizeRequest({ message: 'x', name: 'n'.repeat(200), accountUid: UID, conversationId: CONV, schedule: { type: 'once', at: AT } }).name.length === 120);
eq('weekly days 去重排序', ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'weekly', time: '02:00', days: [5, 1, 5, 9, -1] } }).schedule.days, [1, 5]);
eq('interval 归一', ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'interval', minutes: 90 } }).schedule, { type: 'interval', minutes: 90 });
eq('新建对话标记原样保留', ss.normalizeRequest({ message: 'x', accountUid: UID, conversationId: 'new', schedule: { type: 'once', at: AT } }).conversationId, 'new');
check('normalizeRequest 幂等', JSON.stringify(ss.normalizeRequest(ss.normalizeRequest(existingReq))) === JSON.stringify(ss.normalizeRequest(existingReq)));

lines.push('== A2 buildTask（已有对话）==');
eq('schemaVersion', existing.schemaVersion, 1);
eq('只有一环 account.forEach', existing.steps.length, 1);
eq('外层算子', existing.steps[0].op, 'account.forEach');
eq('账号恰好一个', existing.steps[0].accounts, [UID]);
eq('switch 为 true（真实切号）', existing.steps[0].switch, true);
eq('内层算子顺序', existing.steps[0].steps.map((s) => s.op), ['session.open', 'logic.delay', 'model.set', 'session.send']);
eq('session.open 的会话', existing.steps[0].steps[0].conversationId, CONV);
check('open 后有沉降等待', Number(existing.steps[0].steps[1].ms) > 0);
eq('model.set 的模型', existing.steps[0].steps[2].modelId, 'm-1');
eq('session.send 的会话与 open 一致', existing.steps[0].steps[3].conversationId, existing.steps[0].steps[0].conversationId);
eq('发送步骤引用变量而非明文', existing.steps[0].steps[3].message, ss.MESSAGE_REF);
eq('正文逐字节落进 variables', existing.variables[ss.MESSAGE_VAR], MSG);
eq('meta 标记存在', existing.meta[ss.MARKER_KEY], 1);
check('meta.request 已保存', !!existing.meta.request);
eq('trigger 为手动', existing.trigger.type, 'manual');
eq('schedule 原样透传', existing.schedule, { type: 'once', at: AT });
eq('enabled', existing.enabled, true);
check('自动生成 id 前缀', /^task_sched_/.test(existing.id));
eq('updatedAt 用注入的 now', existing.updatedAt, NOW);
check('description 是可读摘要', /单次 2026-09-15 02:00/.test(existing.description) && existing.description.indexOf('m-1') > 0);
noThrow('编译结果能过 validateTask', () => auto.validateTask(JSON.parse(JSON.stringify(existing))));

const noModel = ss.buildTask({ message: 'x', accountUid: UID, conversationId: CONV, schedule: { type: 'daily', time: '02:00' } }, { now: NOW });
eq('未选模型 → 无 model.set', noModel.steps[0].steps.map((s) => s.op), ['session.open', 'logic.delay', 'session.send']);
const keepId = ss.buildTask(Object.assign({}, existingReq, { id: 'task_keep_me' }), { now: NOW });
eq('显式 id 被尊重', keepId.id, 'task_keep_me');

lines.push('== A3 buildTask（新建对话）==');
const fresh = ss.buildTask({ message: MSG, accountUid: 'uid_b2', conversationId: 'new', modelId: 'm-2', schedule: { type: 'once', at: AT } }, { now: NOW });
eq('内层只有一步', fresh.steps[0].steps.map((s) => s.op), ['session.create']);
eq('create 带 modelId（发送前设模型）', fresh.steps[0].steps[0].modelId, 'm-2');
eq('create 引用变量', fresh.steps[0].steps[0].message, ss.MESSAGE_REF);
eq('create 正文落 variables', fresh.variables[ss.MESSAGE_VAR], MSG);
eq('create 的会话 id 就是 new', fresh.meta.request.conversationId, 'new');
noThrow('新建形态也能过 validateTask', () => auto.validateTask(JSON.parse(JSON.stringify(fresh))));
const freshNoModel = ss.buildTask({ message: 'x', accountUid: 'uid_b2', conversationId: 'new', schedule: { type: 'once', at: AT } }, { now: NOW });
check('未选模型时 create 不带 modelId 字段', !('modelId' in freshNoModel.steps[0].steps[0]));

lines.push('== A4/A5 识别与反编译 ==');
check('识别自己生成的任务', ss.isScheduledSendTask(existing) === true);
check('普通任务不被误判', ss.isScheduledSendTask({ steps: [] }) === false);
check('null 安全', ss.isScheduledSendTask(null) === false);
check('标记值不为 1 时不认', ss.isScheduledSendTask({ meta: { workdaddyScheduledSend: 2 } }) === false);
const back = ss.extractTask(existing);
eq('反编译 正文一致', back.message, MSG);
eq('反编译 账号一致', back.accountUid, UID);
eq('反编译 会话一致', back.conversationId, CONV);
eq('反编译 模型一致', back.modelId, 'm-1');
eq('反编译 定时一致', back.schedule, { type: 'once', at: AT });
const backFresh = ss.extractTask(fresh);
eq('反编译 新建对话', backFresh.conversationId, 'new');
eq('反编译 新建对话的模型', backFresh.modelId, 'm-2');
const stripped = Object.assign({}, existing, { meta: undefined });
const backStruct = ss.extractTask(stripped);
eq('meta 丢失时从步骤反读正文', backStruct && backStruct.message, MSG);
eq('meta 丢失时从步骤反读账号', backStruct && backStruct.accountUid, UID);
const renamed = Object.assign({}, existing, { id: 'task_copied', name: '副本' });
eq('顶层 id 优先于 meta.request 里的旧 id', ss.extractTask(renamed).id, 'task_copied');
check('非任务对象返回 null', ss.extractTask({ nope: 1 }) === null);
const scheduleEdited = Object.assign({}, existing, { schedule: { type: 'daily', time: '03:00' } });
eq('顶层 schedule 覆盖 meta 里的旧值', ss.extractTask(scheduleEdited).schedule, { type: 'daily', time: '03:00' });

lines.push('== A6 摘要文案 ==');
eq('单次', ss.describeSchedule({ type: 'once', at: AT }), '单次 2026-09-15 02:00');
eq('每天', ss.describeSchedule({ type: 'daily', time: '02:00' }), '每天 02:00');
eq('每周', ss.describeSchedule({ type: 'weekly', time: '02:00', days: [1, 3] }), '周一、周三 02:00');
eq('每月', ss.describeSchedule({ type: 'monthly', time: '02:00', day: 15 }), '每月 15 日 02:00');
eq('按间隔', ss.describeSchedule({ type: 'interval', minutes: 30 }), '每 30 分钟');
eq('未知回落', ss.describeSchedule(null), '未设定时');
const desc = ss.describeRequest(existing.meta.request);
check('摘要含定时', desc.indexOf('单次 2026-09-15 02:00') === 0);
check('摘要含对话标题', desc.indexOf('长文初稿') > 0);
check('摘要含账号', desc.indexOf('甲') > 0);
check('摘要含模型', desc.indexOf('m-1') > 0);
check('摘要在未选模型时写明保持当前', ss.describeRequest(freshNoModel.meta.request).indexOf('模型保持当前') > 0);
check('摘要在新建对话时写明', ss.describeRequest(fresh.meta.request).indexOf('新建对话') > 0);

/* ================= A7 交给真正的引擎跑（executeTask） ================= */
function harness(list) {
  const state = { current: 'uid_origin' };
  const events = [];
  const accountOf = (uid) => (list.filter((a) => a.uid === uid)[0]) || { uid: uid, nickname: uid };
  return {
    events,
    deps: {
      listAccounts: async () => list,
      currentAccount: async () => accountOf(state.current),
      accountSwitch: async (account, detail) => {
        events.push('switch:' + account.uid + (detail && detail.restore ? ':restore' : ''));
        state.current = account.uid;
      },
      sessionAction: async (op, detail) => {
        events.push(op + ':' + String(detail && (detail.message != null ? detail.message : detail.conversationId) || ''));
        if (op === 'session.open') return { ok: true, conversationId: String(detail.conversationId) };
        return { ok: true, accountUid: state.current, conversationId: String(detail.conversationId || 'conv_new'), userMessageId: 'u1', requestId: 'r1' };
      },
      modelSet: async (modelId) => { events.push('model.set:' + modelId); return { ok: true, model: modelId }; },
      modelGet: async () => ({ ok: true, model: 'm-0' }),
      log: () => {},
      isCancelled: () => false,
    },
  };
}
const opLog = (events) => events.filter((e) => /^(session\.|model\.set)/.test(e)).map((e) => e.split(':')[0]);

(async () => {
  const list = [{ uid: UID, nickname: '甲' }, { uid: 'uid_b2', nickname: '乙' }];

  const h1 = harness(list);
  const r1 = await auto.executeTask(JSON.parse(JSON.stringify(existing)), h1.deps);
  eq('引擎：真的切到了指定账号', h1.events[0], 'switch:' + UID);
  eq('引擎：算子顺序 open → setModel → send', opLog(h1.events), ['session.open', 'model.set', 'session.send']);
  eq('引擎：session.open 用目标会话', h1.events[1], 'session.open:' + CONV);
  const sendEvent = h1.events.filter((e) => e.indexOf('session.send:') === 0)[0];
  eq('引擎：正文逐字节送达（{{ 未被插值吃掉）', sendEvent.slice('session.send:'.length), MSG);
  eq('引擎：变量里也保留原文', r1.context.vars[ss.MESSAGE_VAR], MSG);
  eq('引擎：结束后切回原账号', h1.events[h1.events.length - 1], 'switch:uid_origin:restore');
  eq('引擎：账号切换只发生两次（去 + 回）', h1.events.filter((e) => e.indexOf('switch:') === 0).length, 2);
  check('引擎：任务会拿到独占渲染器租约（面板自动收起）', auto.taskNeedsPanelClosed(JSON.parse(JSON.stringify(existing))) === true);

  const h2 = harness(list);
  const r2 = await auto.executeTask(JSON.parse(JSON.stringify(fresh)), h2.deps);
  eq('引擎（新建）：只调 session.create', opLog(h2.events), ['session.create']);
  eq('引擎（新建）：切到指定账号', h2.events[0], 'switch:uid_b2');
  const createEvent = h2.events.filter((e) => e.indexOf('session.create:') === 0)[0];
  eq('引擎（新建）：正文逐字节送达', createEvent.slice('session.create:'.length), MSG);
  eq('引擎（新建）：结束后切回原账号', h2.events[h2.events.length - 1], 'switch:uid_origin:restore');
  check('引擎（新建）：执行成功', r1.ok === true && r2.ok === true);

  /* ===================== B 组：源码接线 ===================== */
  lines.push('== B1 automation.js ==');
  check('注册了 session.open 能力', auto.SUPPORTED_OPS.has('session.open'));
  check('session.open 有中英能力说明', auto.CAPABILITIES.some((c) => c.id === 'session.open' && c.zh === '打开指定会话' && /点开指定会话/.test(c.descriptionZh || '') && /Open a given conversation/.test(c.descriptionEn || '')));
  check('session.create 说明提到 modelId', auto.CAPABILITIES.some((c) => c.id === 'session.create' && /modelId/.test(c.descriptionZh || '')));
  check('runStep 分发 session.open', /op === 'session\.open'/.test(AUTO_SRC));
  check('session.open 不写入 vars.session', /if \(op === 'session\.open'\) return outcome;/.test(AUTO_SRC));
  check('model.set 说明写明作用在「当前选中的会话」', /作用对象是「当前选中的会话控制器」/.test(AUTO_SRC));

  lines.push('== B2 daemon.js ==');
  check('require 了 scheduled-send.js', /require\('\.\/scheduled-send\.js'\)/.test(DAEMON_SRC));
  check('sessionAction 有 session.open 分支', /if \(op === 'session\.open'\) \{/.test(DAEMON_SRC));
  check('session.open 复用 openConversationById', /openConversationById\(target,/.test(DAEMON_SRC));
  check('open 后校验账号/运行状态未变', /打开会话后账号或运行状态已变化/.test(DAEMON_SRC));
  check('create 分支读取 detail.modelId', /const wantedModel = String\(detail\.modelId \|\| ''\)\.trim\(\);/.test(DAEMON_SRC));
  check('create 走 setLiveModel', /setLiveModel\(wantedModel\)/.test(DAEMON_SRC));
  const createIdx = DAEMON_SRC.indexOf("if (op === 'session.create') {");
  const ensureIdx = createIdx < 0 ? -1 : DAEMON_SRC.indexOf('ensureAutomationNewTask', createIdx);
  const setModelIdx = createIdx < 0 ? -1 : DAEMON_SRC.indexOf('setLiveModel(wantedModel)', createIdx);
  const sendIdx = createIdx < 0 ? -1 : DAEMON_SRC.indexOf('acSendPhrase', createIdx);
  check('顺序：落新建页 → 设模型 → 发送（与限流续跑一致）', ensureIdx > -1 && setModelIdx > ensureIdx && sendIdx > setModelIdx, 'ensure=' + ensureIdx + ' setModel=' + setModelIdx + ' send=' + sendIdx);
  check('有 POST /api/scheduled-send 路由', /p === '\/api\/scheduled-send'/.test(DAEMON_SRC));
  check('路由用 normalizeRequest 先校验', /scheduledSend\.normalizeRequest\(/.test(DAEMON_SRC));
  check('路由用 buildTask 编译并经 validateTask', /validateTask\(scheduledSend\.buildTask\(/.test(DAEMON_SRC));
  check('路由按 id upsert（可重编辑）', /tasks\[index\] = task; else tasks\.unshift\(task\);/.test(DAEMON_SRC));
  check('build id 已递增（新代码才会被加载）', /DAEMON_BUILD_ID = '[^']*scheduled-send'/.test(DAEMON_SRC));

  lines.push('== B3 inject.js ==');
  check('工具栏新增「定时发送」按钮', /id="wbs-auto-sched"/.test(INJECT_SRC));
  check('按钮绑定向导', /querySelector\('#wbs-auto-sched'\)\.addEventListener/.test(INJECT_SRC));
  check('向导函数存在', /function showScheduledSend\(task\) \{/.test(INJECT_SRC));
  check('标记常量一致', /var SCHED_MARKER = 'workdaddyScheduledSend';/.test(INJECT_SRC));
  check('向导提交到 /api/scheduled-send', /api\('\/api\/scheduled-send'/.test(INJECT_SRC));
  check('编辑定时发送任务走向导而非 JSON 编辑器', /isScheduledSendTaskUI\(task\)\) showScheduledSend\(task\); else showEditor\(task\)/.test(INJECT_SRC));
  check('副本会清掉定时发送标记（避免回写原任务）', /delete copy\.meta\[SCHED_MARKER\]/.test(INJECT_SRC));
  check('五个输入项齐全', ['message', 'account', 'model', 'conversation', 'scheduleType'].every((f) => INJECT_SRC.indexOf('data-sched-field="' + f + '"') > 0));
  check('新建对话分支存在', /data-sched-target="new"/.test(INJECT_SRC));
  check('动态摘要不进翻译器', /data-sched-field="summary" data-wbs-i18n-skip="1"/.test(INJECT_SRC));
  check('动态对话提示不进翻译器', /data-sched-field="convHint" data-wbs-i18n-skip="1"/.test(INJECT_SRC));
  check('账号/对话/模型选项标了 i18n-skip（用户数据不翻译）', (INJECT_SRC.match(/data-wbs-i18n-skip="1">' \+ esc\(/g) || []).length >= 3);
  check('向导 CSS 已注册', /\.wbs-modal\.wbs-sched-modal\{/.test(INJECT_SRC));

  /* ===================== C 组：i18n ===================== */
  lines.push('== C1 词典与翻译器 ==');
  const srcLines = fs.readFileSync(path.join(SCRIPTS, 'inject.js'), 'utf8').split(/\r?\n/);
  const find = (re, from) => { for (let i = from || 0; i < srcLines.length; i++) if (re.test(srcLines[i])) return i; return -1; };
  const dictStart = find(/var WBS_I18N_EN = \{/);
  const dictEnd = find(/^\s*\};\s*$/, dictStart + 1);
  const mStart = find(/var wbsI18nMatchers = null;/);
  const mEnd = find(/function wbsIsBuiltinAutomation/, mStart);
  check('能抽出词典与翻译器', dictStart > -1 && dictEnd > dictStart && mStart > -1 && mEnd > mStart);
  const dictSrc = srcLines.slice(dictStart, dictEnd + 1).join('\n');
  // eslint-disable-next-line no-new-func
  const translate = new Function(
    dictSrc + '\n' + srcLines.slice(mStart, mEnd).join('\n') + '\nreturn wbsTranslateString;'
  )();
  const CJK = /[\u4e00-\u9fff]/;
  const t = (name, zh, expect) => {
    const got = translate(zh, 'en');
    if (CJK.test(got)) bad(name, 'still CJK: ' + JSON.stringify(got));
    else if (expect !== undefined && got !== expect) bad(name, 'got=' + JSON.stringify(got) + ' expect=' + JSON.stringify(expect));
    else ok(name);
  };

  t('标题/按钮', '定时发送', 'Scheduled send');
  t('命令内容', '命令内容', 'Command text');
  t('发送账号', '发送账号', 'Send as account');
  t('使用模型', '使用模型', 'Model');
  t('发送到', '发送到', 'Send to');
  t('已有对话', '已有对话', 'Existing conversation');
  t('新建对话', '新建对话', 'New conversation');
  t('选择对话', '选择对话', 'Choose a conversation');
  t('触发时间', '触发时间', 'Trigger time');
  // '指定时间一次' / '每周' / '每月' / '执行时间' 原本就在词典后半段（双引号那一块），
  // 同名键后者胜 —— 这里只断言它能干净翻译，不重复登记。
  t('指定时间一次（沿用既有词条）', '指定时间一次', 'Once');
  t('每周', '每周', 'Weekly');
  t('每月', '每月', 'Monthly');
  t('执行时间（不被『执行』+『时间』撕开）', '执行时间', 'Run time');
  t('每月日期（刻意不用裸『日期』）', '每月日期', 'Day of month');
  t('保存并排定', '保存并排定', 'Save and schedule');
  t('保持当前模型', '保持当前模型', 'Keep current model');
  t('无可用账号占位', '（无可用账号）', '(No account available)');
  t('对话标题筛选占位', '输入关键词筛选对话标题', 'Filter conversations by title');
  t('命令占位', '到点后原样发送这条命令', 'This command is sent verbatim at the scheduled time');
  t('命名占位', '留空则按命令首行自动命名', 'Leave blank to name it after the first line of the command');
  t('请先选择账号', '请先选择账号', 'Choose an account first');
  t('无对话提示', '该账号下暂无可选对话，改用「新建对话」即可', 'No conversations for this account yet — choose “New conversation” instead');
  t('对话加载失败提示', '对话加载失败，可改用「新建对话」', 'Could not load conversations — choose “New conversation” instead');
  t('对话加载失败前缀', '对话加载失败：', 'Could not load conversations: ');
  t('已排定', '已排定定时发送', 'Scheduled send saved');
  t('排定失败', '排定失败', 'Could not schedule the send');
  t('加载失败', '加载账号或模型失败', 'Could not load accounts or models');
  t('非本向导任务的提示', '这条任务不是由「定时发送」创建的，请用任务编辑修改', 'This task was not created by Scheduled send — edit it with the task editor instead');
  const hint = '到点后插件会自动切到该账号、打开目标对话、切到所选模型并发送。WorkBuddy 未运行或输入框已有草稿时当次跳过，绝不覆盖草稿、不重复发送。';
  t('向导长提示整句命中', hint, 'At the scheduled time WorkDaddy switches to that account, opens the target conversation, switches to the chosen model and sends. If WorkBuddy is not running, or the composer already holds a draft, this run is skipped: drafts are never overwritten and messages are never sent twice.');

  lines.push('== C2 红线：没给裸短词加词条 / 没改写既有词条 ==');
  // 词典里原本就有 "日期": "Date"（双引号那一块，排在新增块之后）。若我重复登记，
  // 一旦英文写得不一样就会以为自己改成功了 —— 所以这里断言全词典只定义一次。
  const dateKeyCount = (dictSrc.match(/['"]日期['"]\s*:/g) || []).length;
  check('词典里「日期」只有一处定义（我没重复登记）', dateKeyCount === 1, 'count=' + dateKeyCount);
  const weekKeyCount = (dictSrc.match(/['"]星期['"]\s*:/g) || []).length;
  check('词典里没有裸「星期」词条（靠它才不会被撕坏句子）', weekKeyCount === 0, 'count=' + weekKeyCount);
  t('裸「日期」词条未被改写', '日期', 'Date');
  t('星期标签未被影响', '周一', 'Mon');
  t('星期标签未被影响（周六）', '周六', 'Sat');
  t('既有句「请选择有效的执行日期和时间」未被撕开', '请选择有效的执行日期和时间', 'Choose a valid date and time');
  t('既有句「请选择有效的执行时间」未被撕开', '请选择有效的执行时间', 'Choose a valid run time');
  t('既有句「请至少选择一个星期」整句命中', '请至少选择一个星期', 'Select at least one weekday');
  t('既有排期下拉「每天」仍命中', '每天', 'Daily');

  lines.push('');
  lines.push('结果: ' + pass + ' pass / ' + fail + ' fail');
  fs.writeFileSync(path.join(__dirname, 'test-scheduled-send.report.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('scheduled-send: ' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  lines.push('FATAL ' + String((error && error.stack) || error));
  fs.writeFileSync(path.join(__dirname, 'test-scheduled-send.report.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('scheduled-send: FATAL');
  process.exit(1);
});
