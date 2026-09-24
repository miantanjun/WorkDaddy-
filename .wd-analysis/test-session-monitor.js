'use strict';
/*
 * test-session-monitor.js —— 「会话监控中断判据」的守卫（上游 1.2.6 吸纳 · 批次 4 第 4 项 / A7）。
 *
 * 为什么需要它（上游 1.2.130「异常中断任务更容易继续」的判据层）：
 *   本地原本只有 `isSessionMonitorInProgress`（判「还在跑」）。一个**已经停下**但判定层
 *   本来愿意续跑的会话（错误 UI / 网络类错误 / 结构化未终局 / 明确未终局），在**绑定阶段**
 *   就被当成历史会话丢掉 ⇒ 判定层一次都走不到；它又不会再产生新回复，于是
 *   「等新回复」的 baseline 门控成了一条**死等待**（关掉再打开开关也无效）。
 *
 * 本套件守四件事：
 *   [A] `isSessionMonitorInterrupted` 与判定层**结论完全一致**（上游的核心契约：
 *       「允许绑定的会话」必须等于「会被续跑的会话」）—— 用真函数跑，不看源码。
 *   [B] 两条绑定路径（单会话 acBindController / 多会话 acMultiBindController）
 *       都真的接纳了已中断会话，且判定与绑定**共用同一份映射**（源码级）。
 *   [C] 抽函数后的**静默退化陷阱**：`acControllerSnapshot` 必须自带 `completionMarker`，
 *       否则只有「正文尾部完成标记」能证明完成的会话会被误判成中断。
 *   [D] 会话资源归一化必须带出 `protocolStatus` / `state` / `queueRevision` 等
 *       （否则「陈旧的 working」会遮住「更新的 completed 协议状态」）。
 *
 * 跑法：node .wd-analysis/test-session-monitor.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INJECT_FILE = path.join(ROOT, 'scripts', 'inject.js');
const inject = require(INJECT_FILE);
const SRC = fs.readFileSync(INJECT_FILE, 'utf8');

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

/* ==================================================================== */
section('[A] 中断判据 ≡ 判定层结论（可执行的契约，不是注释）');
/* ==================================================================== */

ok(typeof inject.isSessionMonitorInterrupted === 'function', 'A1 已导出 isSessionMonitorInterrupted');
ok(typeof inject.controllerAutoContinueDecision === 'function', 'A2 已导出 controllerAutoContinueDecision（判定与绑定共用的唯一映射）');
ok(typeof inject.isSessionMonitorInProgress === 'function', 'A3 isSessionMonitorInProgress 仍在（旧判据不许被替换掉）');

const decision = inject.controllerAutoContinueDecision;
const interrupted = inject.isSessionMonitorInterrupted;

if (typeof interrupted === 'function' && typeof decision === 'function') {
  // 上游规格书里那两组样本，逐条要求在本地实现上成立
  const continuable = [
    { assistantId: 'req-a-assistant', error: true, reason: '错误 UI' },
    { assistantId: 'req-a-assistant', networkFailure: true, reason: '网络类错误' },
    { assistantId: 'req-a-assistant', complete: false, terminal: false, reason: '结构化中断（无错误 UI 也常见）' },
    { assistantId: 'req-a-assistant', terminalKnown: true, terminal: false, complete: true, reason: '明确未终局（新版 isRequestTerminal=false）' },
  ];
  continuable.forEach((snapshot, i) => {
    const d = decision(snapshot);
    ok(d.trigger === true, 'A4.' + (i + 1) + ' 判定层愿意续跑：' + snapshot.reason, d);
    ok(interrupted(snapshot) === true, 'A5.' + (i + 1) + ' 绑定闸门同时放行：' + snapshot.reason, interrupted(snapshot));
  });

  const finished = [
    { assistantId: 'a', manualStop: true, error: true, reason: '用户主动取消' },
    { assistantId: 'a', complete: true, terminal: true, reason: '结构化完成' },
    { assistantId: 'a', terminalKnown: true, terminal: true, complete: true, reason: '明确终局' },
    { assistantId: 'a', complete: true, reason: '旧版无 terminal 字段' },
    { assistantId: 'a', completionMarker: true, complete: false, terminal: false, reason: '正文尾部完成标记' },
    { assistantId: '', error: true, reason: '没有助手回复' },
    null,
  ];
  finished.forEach((snapshot, i) => {
    const tag = (snapshot && snapshot.reason) || '空快照';
    const d = decision(snapshot);
    ok(d.trigger === false, 'A6.' + (i + 1) + ' 判定层不续跑：' + tag, d);
    ok(interrupted(snapshot) === false, 'A7.' + (i + 1) + ' 绑定闸门也不放行（避免对正常历史回复多发一次续跑）：' + tag, interrupted(snapshot));
  });

  // 仍在运行 / 等决策 / 恢复中：交给 in-progress 分支，不重复绑定
  ['busy', 'blocked', 'hydrating'].forEach((field) => {
    const snap = { assistantId: 'a', error: true };
    snap[field] = true;
    ok(interrupted(snap) === false, 'A8 仍 ' + field + ' ⇒ 中断判据为假（否则同一会话会被两条路径各绑一次）', interrupted(snap));
  });

  ok(interrupted(undefined) === false && interrupted({}) === false,
    'A9 空快照不抛错、判为「非中断」（保守）');
}

/* ==================================================================== */
section('[B] 两条绑定路径都真的接纳已中断会话，且与判定同源');
/* ==================================================================== */

ok(/if \(!existing && !isSessionMonitorInProgress\(initialSnapshot\) && !isSessionMonitorInterrupted\(initialSnapshot\)\) return null;/.test(SRC),
  'B1 多会话绑定闸门 = in-progress **或** interrupted（只按 in-progress 过滤就是本条缺陷的原形）');

ok(/session\.awaitingNewReply = false;[\s\S]{0,140}session\.baselineAssistantKey = '';/.test(SRC),
  'B2 已中断会话不建「等新回复」baseline（否则 acMultiCheckSession 立刻注销它，一次判定都走不到）');

ok(/c\.awaitingNewReply = preserve[\s\S]{0,110}!!carry\.awaitingNewReply && !isSessionMonitorInterrupted\(snap\)[\s\S]{0,60}: !isSessionMonitorInterrupted\(snap\);/.test(SRC),
  'B3 单会话绑定闸门同样按 interrupted 收口（保留态与新建态都收）');

ok(/isSessionMonitorInProgress\(initialSnapshot\) \|\| isSessionMonitorInterrupted\(initialSnapshot\) \|\| !session\.resourceActive/.test(SRC),
  'B4 绑定后立即检查的条件同步放宽（否则中断会话要等下一次心跳才被看到）');

ok(/acLog\('baseline-established', \{ via: 'controller', awaitingNewReply: c\.awaitingNewReply \}\);/.test(SRC),
  'B5 日志如实记录闸门真值（恒记 true 会让排障时日志说谎）');

ok(/var decision = controllerAutoContinueDecision\(snap\);/.test(SRC),
  'B6 单会话判定走共用映射（不再内联一份）');
ok(/var decision = controllerAutoContinueDecision\(snapshot\);/.test(SRC),
  'B7 多会话判定走共用映射');
ok((SRC.match(/classifyAutoContinueControllerSnapshot\(\{/g) || []).length === 1,
  'B8 内联映射恰好只剩 1 处 = controllerAutoContinueDecision 内部（判定与绑定不可能再错位）',
  (SRC.match(/classifyAutoContinueControllerSnapshot\(\{/g) || []).length);
ok(/function controllerAutoContinueDecision\(snapshot\) \{[\s\S]{0,420}return classifyAutoContinueControllerSnapshot\(\{/.test(SRC),
  'B9 controllerAutoContinueDecision 的确就是那份唯一映射');
ok(/return controllerAutoContinueDecision\(s\)\.trigger === true;/.test(SRC),
  'B10 中断判据直接用**判定层的输出**，不自己另写一套「算不算中断」的规则');

ok(/Controller\/store 快照 → 判定证据的\*\*唯一\*\*映射/.test(SRC) && /判定与绑定必须共用同一份映射/.test(SRC),
  'B11 代码里写明「为什么必须同源」（下一个改的人不必再踩一次）');

/* ==================================================================== */
section('[C] 抽函数后的静默退化陷阱：快照必须自带完成标记');
/* ==================================================================== */

ok(/text: text,\r?\n\s+completionMarker: acHasMarker\(text\),/.test(SRC),
  'C1 ⭐ acControllerSnapshot 自带 completionMarker（抽走内联块后判定改读 snap.completionMarker；'
  + '不补此字段 ⇒ 该字段变 undefined ⇒ 只有「正文尾部完成标记」能证明完成的会话会被误判成中断）');

// 行为级复核：同一份快照，带与不带 completionMarker 的结论必须不同 —— 证明这个字段真的在起作用
if (typeof decision === 'function') {
  const withMarker = { assistantId: 'a', completionMarker: true, complete: false, terminal: false };
  const withoutMarker = { assistantId: 'a', completionMarker: false, complete: false, terminal: false };
  ok(decision(withMarker).trigger === false && decision(withoutMarker).trigger === true,
    'C2 ⭐ 该字段确实决定结论（带标记=不续跑 / 不带标记=续跑）⇒ 丢了它就是一个真实的行为回退',
    { withMarker: decision(withMarker), withoutMarker: decision(withoutMarker) });
  ok(inject.isSessionMonitorInterrupted(withMarker) === false && inject.isSessionMonitorInterrupted(withoutMarker) === true,
    'C3 绑定闸门也依赖该字段（与判定层一致）');
}

/* ==================================================================== */
section('[D] 会话资源归一化：终端状态跨 protocolStatus / status / state 取真');
/* ==================================================================== */

const normalize = inject.normalizeSessionMonitorResourceRecord;
ok(typeof normalize === 'function', 'D0 已导出 normalizeSessionMonitorResourceRecord');

if (typeof normalize === 'function') {
  const r = normalize({ id: 'task-b', status: 'working', protocolStatus: 'completed', name: '任务 B' }, 'sessionUpdated');
  ok(JSON.stringify(r) === JSON.stringify({
    id: 'task-b', title: '任务 B', status: 'completed', pendingInputKind: '',
    protocolStatus: 'completed', state: '', activePromptStartedAt: 0, queueRevision: null,
    updatedAt: 0, lastActivityAt: 0, active: false, terminal: true, event: 'sessionUpdated',
  }), 'D1 ⭐ 陈旧的 status=working 被更新的 protocolStatus=completed 覆盖（并判终局）', r);

  ok(normalize({ id: 'task-b', status: 'model_streaming' }, 'sessionUpdated').active === true,
    'D2 model_streaming 仍算「活跃」');
  ok(normalize({ id: 'task-b', status: 'pending' }, 'sessionUpdated').active === true,
    'D3 官方侧栏「待确认」= status pending ⇒ 活跃待批准信号');
  ok(normalize({ id: 'task-b', status: 'pending', activePromptStartedAt: 123 }, 'sessionUpdated').active === true,
    'D4 有活跃提问时间戳 ⇒ 活跃');
  ok(normalize({ id: 'task-b', status: 'pending', pendingInputKind: 'permission' }, 'sessionUpdated').active === true,
    'D5 显式 pendingInputKind=permission ⇒ 活跃');
  ok(normalize({ id: 'task-b', status: 'pending', messageQueueRuntime: { pendingItemCount: 1, paused: false } }, 'sessionUpdated').active === true,
    'D6 队列里有待发送项 ⇒ 活跃');

  const revision = normalize({
    id: 'task-b', status: 'running', updated_at: 10, last_activity_at: 9,
    messageQueueRuntime: { inflightItemId: 'q1', pendingItemCount: 2, paused: false },
  });
  ok(JSON.stringify([revision.updatedAt, revision.lastActivityAt, revision.queueRevision]) === JSON.stringify([10, 9, ['q1', 2, 0, false]]),
    'D7 修订号三元组齐全（updated_at / last_activity_at / 队列修订）', [revision.updatedAt, revision.lastActivityAt, revision.queueRevision]);

  // 兼容性：老 payload 不带新字段时必须是「空值而不是 undefined」，否则下游比较会得到 NaN/undefined 噪声
  const legacy = normalize({ id: 'task-b', status: 'completed' }, 'sessionUpdated');
  ok(legacy.protocolStatus === '' && legacy.state === '' && legacy.activePromptStartedAt === 0
    && legacy.queueRevision === null && legacy.updatedAt === 0 && legacy.lastActivityAt === 0,
    'D8 老 payload 的新字段取「显式空值」（不是 undefined）', legacy);
}

/* ==================================================================== */
section('[E] 不许把旧判据改坏：in-progress 的语义未被顺手改写');
/* ==================================================================== */

ok(/function isSessionMonitorInProgress\(snapshot\) \{\r?\n\s+return !!\(snapshot && \(snapshot\.busy \|\| snapshot\.blocked \|\| snapshot\.hydrating\)\);\r?\n\}/.test(SRC),
  'E1 isSessionMonitorInProgress 仍是「busy || blocked || hydrating」，一字未改');
ok(inject.isSessionMonitorInProgress({ busy: true }) === true
  && inject.isSessionMonitorInProgress({ complete: true, busy: false }) === false,
  'E2 in-progress 行为与上游规格书一致（busy 真 / 已完成假）');
ok(inject.sessionMonitorLifecycleAction({ id: 'task-b', active: false, terminal: true }, true) === 'remove'
  && inject.sessionMonitorLifecycleAction({ id: 'task-b', active: false, terminal: false }, false) === 'ignore',
  'E3 生命周期动作未变（终局移除 / 非活跃忽略）');

/* ==================================================================== */
console.log('');
console.log('结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
