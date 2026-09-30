/**
 * test-switch-presync.js —— 切号「预同步 + 进度弹窗」（2026-09-30）回归套件
 *
 * 覆盖四组：
 *   A  core 顺序重排（预同步必须在 switchAccount **之前**；失败必须**中止整轮**而不是被
 *      per-round catch 吞掉；可选端口守卫保证既有 5 个切片套件逐字等价）
 *   B  弹窗阶段状态机（syncing/switching/resuming/done/failed/cancelled + 惰性过期 + 取消）
 *   C  等同步落定的判据（**只等 meta 阶段**，不等整个任务；分叉不算失败）
 *   D  静态守卫（两个新路由 + UI 侧接线 + 热更定时器清理 + i18n 整块 skip）
 *
 * 跑法：node .wd-analysis/test-switch-presync.js
 * 依赖：无需 daemon 实例；纯读源码 + `new Function` 切片。
 */
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
// ⚠️ 必须把 CRLF 归一化成 LF 再切片：`scripts/*.js` 是纯 CRLF，锚点里的 `\n` 会匹配不上
// （踩过：所有 indexOf 返回 -1，断言集体假红/假绿）。切片出的代码用 LF 传给 new Function 无碍。
const normalize = (text) => String(text).replace(/\r\n/g, '\n');
const daemonSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'daemon.js'), 'utf8'));
const injectSrc = normalize(fs.readFileSync(path.join(repo, 'scripts', 'inject.js'), 'utf8'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(title) { console.log('\n--- ' + title + ' ---'); }
function sliceBetween(startAnchor, endAnchor, label) {
  const s = daemonSrc.indexOf(startAnchor);
  if (s < 0) { failures.push('切片锚点缺失(起): ' + label); return ''; }
  const e = daemonSrc.indexOf(endAnchor, s);
  if (e < 0) { failures.push('切片锚点缺失(止): ' + label); return ''; }
  return daemonSrc.slice(s, e);
}
/** 剥掉注释后再做「标识符泄漏」检测 —— 注释里提到函数名是说明性的，不是沙箱引用。 */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

/* ====================================================================
 * A. core 顺序重排（静态语义断言）
 * ================================================================== */
section('A. core：预同步必须先于切号，且失败要中止整轮');

const coreBlock = sliceBetween(
  'async function runLimitFailoverCore(detail, ports) {',
  '\n/**\n * `runLimitFailoverCore` 的端口装配',
  'core',
);
ok(coreBlock.length > 1000, 'A0 成功切出 runLimitFailoverCore 函数体', coreBlock.length);

const iPre = coreBlock.indexOf('await ports.preSyncTo(liveUid, target.uid');
const iSwitch = coreBlock.indexOf('await ports.switchAccount(target)');
const iAfter = coreBlock.indexOf('ports.afterAccountSwitch(liveUid, target.uid)');
ok(iPre > 0, 'A1 切出了预同步调用点', iPre);
ok(iSwitch > 0, 'A2 切出了切号调用点', iSwitch);
ok(iPre > 0 && iSwitch > 0 && iPre < iSwitch,
  'A3 ⭐ 预同步的调用位置在 switchAccount **之前**（「先同步、再切号」的落点）', { iPre, iSwitch });
ok(iAfter > 0 && iPre < iAfter,
  'A4 afterAccountSwitch 仍在（位置在预同步之后，作兜底）', { iPre, iAfter });

ok(/typeof ports\.preSyncTo === 'function'/.test(coreBlock),
  'A5 可选端口守卫：未注入 ⇒ 整块跳过（既有 5 个切片套件因此逐字等价，一条断言都不用改）');
ok(coreBlock.indexOf('!preSynced && typeof ports.afterAccountSwitch') > 0,
  'A6 ⭐ 已预同步则**显式跳过**切号后那次复制（不靠「复制本身幂等」蒙混）');
ok(coreBlock.indexOf("reason: 'presync-failed'") > 0,
  'A7 预同步失败有专属 reason=presync-failed（供调用方/日志区分）');
ok(coreBlock.indexOf('try { pre = await ports.preSyncTo') > 0,
  'A8 preSyncTo 调用自带 try/catch（防异常冒到 per-round catch）');

// ⭐ 最关键的一条：失败分支**不能**走 per-round catch 那条路 —— 那会 markAccountBlocked(target,'error')
// 把一个原本健康的账号写进限流窗口（硬事实，整个窗口都不会再被选为接管方）。
const iFail = coreBlock.indexOf("reason: 'presync-failed'");
const failBranch = stripComments(coreBlock.slice(Math.max(0, iFail - 1200), iFail));
ok(!/limitFailover\.markAccountBlocked/.test(failBranch),
  'A9 ⭐⭐ 预同步失败分支里**没有** markAccountBlocked（不误伤一个健康账号）');

const guardCount = (coreBlock.match(/typeof ports\.flowPhase === 'function'/g) || []).length;
const phaseCallCount = (coreBlock.match(/ports\.flowPhase\('/g) || []).length;
ok(guardCount >= 5 && phaseCallCount >= 5,
  'A10 阶段置位全部走可选端口 flowPhase（每处调用前都有 typeof 守卫）', { guardCount, phaseCallCount });
ok(coreBlock.indexOf("ports.flowPhase('switching'") > 0
  && coreBlock.indexOf("ports.flowPhase('switching'") < iSwitch,
  'A11 「切号中」在真正切号**之前**落位（先落状态、再动副作用 ⇒ reload 后渲染层才读得对）');
ok(coreBlock.indexOf("ports.flowPhase('resuming'") > 0 && coreBlock.indexOf("ports.flowPhase('done'") > 0,
  'A12 三阶段齐备：syncing（在预同步内）→ switching → resuming → done');

// 切片沙箱红线：core 内不得出现新的模块级标识符（**剥掉注释后**再查）
const codeOnly = stripComments(coreBlock);
const leaked = ['preSyncBeforeSwitch', 'setSwitchFlowPhase', 'switchFlowState', 'SWITCH_FLOW_TTL_MS', 'PRE_SYNC_WAIT_MAX_MS']
  .filter((name) => new RegExp('(?<![.\\w])' + name + '(?![\\w])').test(codeOnly));
ok(leaked.length === 0,
  'A13 ⭐ 切片沙箱红线：core 内（除注释外）未引用任何模块级新标识符 —— 否则 ReferenceError 会被 try/catch 吞成静默业务失败', leaked);

// 端口装配侧：两个新端口确实挂上了
const portsBlock = sliceBetween(
  'function buildLimitFailoverPorts(ctx) {',
  '\n/* ---------------- 续跑结束后自动切回主账号',
  'ports',
);
ok(portsBlock.indexOf('preSyncTo:') > 0 && portsBlock.indexOf('flowPhase:') > 0,
  'A14 buildLimitFailoverPorts 挂上了 preSyncTo / flowPhase 两个端口（切片外构造）');

/* ====================================================================
 * B. 弹窗阶段状态机（切片纯函数，动态跑）
 * ================================================================== */
section('B. 弹窗阶段状态机');

const flowBlock = sliceBetween(
  'let switchFlowState = null;',
  '\n/**\n * 等「会话正文同步完成」。',
  'flow',
);
ok(flowBlock.length > 500, 'B0 成功切出状态域代码块', flowBlock.length);

const flowFactory = new Function(
  'log', 'autoCopyJobs',
  flowBlock + '\nreturn { setSwitchFlowPhase, readSwitchFlowState, requestSwitchFlowCancel, SWITCH_FLOW_TTL_MS, PRE_SYNC_WAIT_MAX_MS };',
);
const noLog = () => {};
const jobsMap = new Map();
const F = flowFactory(noLog, jobsMap);

ok(F.readSwitchFlowState() === null, 'B1 初始无流程 ⇒ 状态为 null');
const s1 = F.setSwitchFlowPhase('syncing', { sourceUid: 'A', targetUid: 'B' });
ok(s1 && s1.active === true && s1.phase === 'syncing', 'B2 syncing ⇒ active=true（渲染层据此亮起弹窗）', s1 && s1.phase);
const s2 = F.setSwitchFlowPhase('switching', { targetUid: 'B' });
ok(s2.phase === 'switching' && s2.active === true && s2.startedAt === s1.startedAt,
  'B3 阶段推进时 active 保持 true 且 startedAt 不重置（弹窗不重建、进度不跳）', s2.startedAt);
const s3 = F.setSwitchFlowPhase('resuming', { conversationId: 'c1' });
ok(s3.phase === 'resuming' && s3.active === true && s3.conversationId === 'c1',
  'B4 resuming（用户明确要求把「续发中」也显示出来）', s3.phase);
const s4 = F.setSwitchFlowPhase('done', {});
ok(s4.active === false && s4.phase === 'done', 'B5 done ⇒ active=false（弹窗自动消失的条件）');
ok(F.readSwitchFlowState() !== null, 'B6 终态在 TTL 内仍可读（供 reload 后侥幸读到的渲染层收尾）');
// 惰性过期：直接改同一个引用（readSwitchFlowState 返回的就是它）
s4.finishedAt = Date.now() - (F.SWITCH_FLOW_TTL_MS + 1000);
ok(F.readSwitchFlowState() === null, 'B7 终态超过 TTL ⇒ 惰性清理返回 null（不起定时器）');

// 干净的实例：验证「没活跃过 ⇒ 一个 failed 不会凭空造弹窗」
const F2 = flowFactory(noLog, jobsMap);
const s5 = F2.setSwitchFlowPhase('failed', { error: 'x' });
ok(s5.active === false, 'B8 ⭐ 流程从未活跃过时，一个 failed 不会造出弹窗（active 仍 false）');
ok(F2.requestSwitchFlowCancel().ok === false, 'B9 无活跃流程时 cancel 明确拒绝（不静默成功）');

// 取消：复用既有中止机制（置 job.cancelRequested），不是硬停
const jobs2 = new Map();
const liveJob = { id: 'job-x', status: 'running', cancelRequested: false };
jobs2.set('job-x', liveJob);
const F3 = flowFactory(noLog, jobs2);
F3.setSwitchFlowPhase('syncing', { jobId: 'job-x', sourceUid: 'A', targetUid: 'B' });
const cancelResult = F3.requestSwitchFlowCancel();
ok(cancelResult.ok === true && liveJob.cancelRequested === true,
  'B10 ⭐ 取消会置 job.cancelRequested（复用既有中止机制；worker 在检查点收尾，不是硬停）', cancelResult);
ok(typeof cancelResult.note === 'string' && cancelResult.note.length > 0,
  'B11 取消返回 note（如实告知哪些停不掉，供前端改文案）', cancelResult.note);
ok(F3.readSwitchFlowState().cancelled === true, 'B12 取消标记会反映到状态上（渲染层据此收尾）');

/* ====================================================================
 * C + D（需要 await，包一层 async IIFE）
 * ================================================================== */
(async () => {
  section('C. 等同步落定：只等 meta 阶段');

  const waitBlock = sliceBetween(
    'async function waitPreSyncSettled(job, options) {',
    '\n/**\n * ⭐ **切号前的会话预同步**',
    'wait',
  );
  ok(waitBlock.length > 300, 'C0 成功切出 waitPreSyncSettled', waitBlock.length);

  const waitFactory = new Function(
    'log', 'autoCopyJobs', 'isAutoCopyJobSettled', 'sleep', 'PRE_SYNC_WAIT_MAX_MS', 'PRE_SYNC_STALL_MS',
    waitBlock + '\nreturn { waitPreSyncSettled };',
  );
  const W = waitFactory(noLog, new Map(),
    (status) => !['queued', 'running'].includes(String(status || '')),
    () => Promise.resolve(),
    60 * 1000,
    2 * 60 * 1000);

  const makeJob = (over) => Object.assign({
    id: 'j', status: 'running', phase: 'meta',
    total: 5, processed: 5, skipped: 0, failed: 0, failedItems: 0, partial: 0, conflicts: 0,
    cancelRequested: false,
  }, over || {});

  const c1 = await W.waitPreSyncSettled(makeJob({ phase: 'payload' }), {});
  ok(c1 && c1.ok === true,
    'C1 ⭐ phase=payload 即放行 —— **只等会话正文（meta）**，产物搬运让它后台继续（否则用户要等几分钟）', c1);
  const c2 = await W.waitPreSyncSettled(makeJob({ status: 'error', phase: 'meta', processed: 2, failed: 1 }), {});
  ok(c2.ok === false, 'C2 任务已落定但正文阶段没走完 ⇒ 判失败', c2);
  const c3 = await W.waitPreSyncSettled(makeJob({ status: 'done', phase: 'done', failed: 2 }), {});
  ok(c3.ok === false && /2 个会话/.test(String(c3.error)),
    'C3 有 2 个会话同步失败 ⇒ 不放行（弹窗转错误态，不切号）', c3);
  const c4 = await W.waitPreSyncSettled(makeJob({ cancelRequested: true }), {});
  ok(c4.ok === false && c4.error === '已取消', 'C4 取消标记 ⇒ 立刻返回「已取消」（用户关闭弹窗即停）', c4);
  const c5 = await W.waitPreSyncSettled(makeJob({ status: 'done', phase: 'done', conflicts: 2 }), {});
  ok(c5.ok === true,
    'C5 ⭐ 分叉(conflicts)不算失败 —— 那是保护性行为（两边各自保留、一份都不覆盖），与「内容没搬过去」不同', c5);
  const c6 = await W.waitPreSyncSettled(makeJob({ phase: 'payload', partial: 1 }), {});
  ok(c6.ok === false, 'C6 partial>0 同样不放行（部分失败也算没搬全）', c6);

  // ⚠️ C7–C12 的**定论**（2026-09-30 第四次修订，连错三次后的真相）：
  //    前三次都把「切号卡 60~220 秒」当成「planning 很慢」，于是依次加了总时限、停滞阈值、
  //    planning 豁免 —— **三次全错**。实测对照：空闲时用**同一 job 路径**复制同样的
  //    42 条 / 1.3 GB，规划阶段只用 **1 秒**（分段计时：让步等待 1ms、取计划+排序 641ms）。
  //    真凶 = `/api/switch` 在处理器**开头**就占了 `rendererReloadPriorityPromise`，
  //    而复制任务的第一步 `yieldAutoCopyToRenderer()` 要 await 它
  //    ⇒ **死锁**（切号等预同步、预同步等切号）。下面既有兜底断言，也有 C13 的死锁守卫。
  ok(/PRE_SYNC_STALL_MS/.test(waitBlock) && /lastSignalAt/.test(waitBlock),
    'C7 ⭐ 有独立的「停滞」判据（与总时限分开：payload 阶段合法长跑几分钟不能被误杀，卡死要能识别）');
  ok(/PRE_SYNC_WAIT_MAX_MS = 10 \* 60 \* 1000/.test(daemonSrc),
    'C8 总时限 10 分钟（最后的兜底；正常 planning 是秒级，真死锁靠停滞判据 2 分钟兜住）');
  ok(/PRE_SYNC_STALL_MS = 2 \* 60 \* 1000/.test(daemonSrc),
    'C9 停滞阈值 = 2 分钟（实测 planning 仅 ~1 秒 ⇒ 180 倍余量，不会误报）');
  ok(!/job\.phase !== 'planning'/.test(waitBlock),
    'C10 ⭐⭐ planning 阶段**不再豁免**停滞判定 —— 豁免只会让将来同类死锁无声无息挂死（用户只能手动取消）');
  ok(/skipSizeMeasure: true/.test(daemonSrc),
    'C11 预同步仍跳过全量体积测量（省一次全盘递归；注意它**不是**卡顿元凶 —— 实测仅 ~0.7 秒）');
  ok(/if \(job\.skipSizeMeasure\)/.test(daemonSrc) && /job\.totalBytes = null/.test(daemonSrc),
    'C12 该开关在 worker 里真的生效，且缺数给 null（不拿 0 冒充，否则面板读成「真的同步了 0 字节」）');
  // ⭐⭐ C13 **死锁守卫**（本次真正根因，必须钉死）：
  //    `/api/switch` 里 `beginRendererReloadPriority()` 必须出现在 `preSyncBeforeSwitch(` **之后**。
  //    出现在之前 ⇒ 预同步（本身是一个复制任务）被它自己的 reload 优先权拦住 ⇒ 闭环死锁。
  {
    const swStart = daemonSrc.indexOf("p === '/api/switch'");
    const iPre = daemonSrc.indexOf('await preSyncBeforeSwitch(', swStart);
    // 只匹配**真实调用形态**，不匹配注释里的函数名（否则会被上面的说明文字误伤）。
    const iReload = daemonSrc.indexOf('= body.reload ? beginRendererReloadPriority() : null', swStart);
    ok(swStart > 0 && iPre > swStart && iReload > iPre,
      'C13 ⭐⭐ /api/switch 的 reload 优先权在预同步**之后**才占（在之前 = 与复制任务让步等待死锁，实测永不返回）',
      { swStart, iPre, iReload });
  }

  section('D. 静态守卫（路由与 UI 接线）');

  ok(daemonSrc.indexOf("p === '/api/switch-flow'") > 0,
    'D1 新增 GET /api/switch-flow（弹窗阶段数据源）');
  ok(daemonSrc.indexOf("p === '/api/switch-flow/cancel'") > 0,
    'D2 新增 POST /api/switch-flow/cancel（关闭弹窗 = 请求中止）');
  ok(daemonSrc.indexOf("if (req.method === 'GET' && p === '/api/switch-flow')") > 0,
    'D3 /api/switch-flow 是 GET（渲染层只读，不写状态）');

  // 手动切号：预同步必须在 switchTo 之前。
  // ⚠️ 两个"位置"都必须在 **/api/switch 路由起点之后**搜 —— 该路由很长（固定窗口切片会截断），
  //    而 `switchTo(DATA_DIR, uid, log)` 这个串在文件更早处也出现过（全局 indexOf 会命中错位置）。
  const iSwitchRoute = daemonSrc.indexOf("if (req.method === 'POST' && p === '/api/switch')");
  const iPreCall = daemonSrc.indexOf('await preSyncBeforeSwitch(sourceUid, uid', iSwitchRoute);
  const iSwitchTo = daemonSrc.indexOf('const acct = switchTo(DATA_DIR, uid, log)', iSwitchRoute);
  ok(iPreCall > 0 && iSwitchTo > 0 && iPreCall < iSwitchTo,
    'D4 ⭐ 手动切号：preSyncBeforeSwitch 在 switchTo **之前**（与限流路同序）', { iPreCall, iSwitchTo });
  ok(daemonSrc.indexOf('preSyncedOnce ? null : autoCopyAfterAccountSwitch') > 0,
    'D5 手动切号：预同步过则跳过切号后那次复制（与 core 同一处理）');
  ok(daemonSrc.indexOf("p === '/api/switch'") > 0
    && daemonSrc.slice(iPreCall, iPreCall + 900).indexOf('conflict.statusCode = 409') > 0,
    'D6 预同步失败折成 409（面板能区分「稍后重试」与真正的服务端错误）');
  ok(daemonSrc.indexOf('async function preSyncBeforeSwitch(fromUid, toUid, meta)') > 0
    && daemonSrc.indexOf('preSyncTo: (fromUid, toUid, meta) => preSyncBeforeSwitch') > 0,
    'D7 ⭐ 两条路共用**同一个** preSyncBeforeSwitch（不分主动/被动，只一套做法）');

  // 闸门：预同步内部自己占/放，避免「同步在跑 ⇒ 禁止切号」的自锁
  const iPreSyncFn = daemonSrc.indexOf('async function preSyncBeforeSwitch(fromUid, toUid, meta)');
  const preSyncFn = daemonSrc.slice(iPreSyncFn, iPreSyncFn + 5200);
  const iGate = preSyncFn.indexOf('assertAccountSwitchIdle()');
  const iGateRelease = preSyncFn.indexOf('if (releaseGate)');
  ok(iGate > 0 && iGateRelease > iGate,
    'D8 ⭐⭐ 预同步内部先占闸门、后释放（否则「同步跑完 → 就切号」必然被自己的 A11 闸门拒掉）');
  ok(preSyncFn.indexOf('已有会话同步在进行，暂不能切号') > 0,
    'D9 闸门失败时**改写**了原因文案（原文「账号正在切换，请稍后重试」在此刻会误导用户以为号已经在切）');

  // UI 侧接线
  ok(injectSrc.indexOf('wbs-switch-flow-mask') > 0, 'D10 inject.js 有弹窗遮罩 id');
  ok(injectSrc.indexOf("api('/api/switch-flow')") > 0, 'D11 inject.js 轮询 GET /api/switch-flow');
  ok(injectSrc.indexOf("api('/api/switch-flow/cancel', { method: 'POST' })") > 0,
    'D12 关闭按钮调 POST /api/switch-flow/cancel');
  ok(injectSrc.indexOf("'/api/sessions/auto-copy/active'") > 0 && injectSrc.indexOf('copyJob.currentLabel') > 0,
    'D13 进度明细复用 auto-copy/active 的 currentLabel（不重复造字段）');
  ok(injectSrc.indexOf("mask.setAttribute('data-wbs-i18n-skip', '')") > 0,
    'D14 弹窗整块标 data-wbs-i18n-skip（里面绝大多数是动态数据，按本仓约定当数据子树）');
  ok(/switchFlowTimer\) clearTimeout\(switchFlowTimer\)/.test(injectSrc),
    'D15 ⭐ 定时器注册了 disposer（防热更副本定时器堆叠 —— 本仓明载铁律）');
  ok(injectSrc.indexOf('closeBtn.disabled = true') > 0 && injectSrc.indexOf('切号已开始，无法中止') > 0,
    'D16 ⭐ switching 阶段关闭按钮置灰 + 如实文案（Page.reload 不可撤销，写成「已中止」是假的）');
  ok(injectSrc.indexOf('不再等待响应') > 0,
    'D17 resuming 阶段文案是「不再等待响应」而非「停止任务」（续发已发出时插件停不掉模型）');

  section('E. 状态机收敛守卫（2026-09-30 真实故障：切号失败、弹窗永久关不掉）');

  // ⭐⭐ 故障复盘（用户实测「几秒显示同步完成 → 随后切号失败 → 点关闭无反应 → 只能重启 daemon」）：
  //    ① 预同步只等「正文（meta）」就返回，它起的 job 可能**还在收尾** ⇒ 队列非空；
  //    ② /api/switch 紧接着又调 assertAccountSwitchIdle() ⇒ 被**自己刚起的 job** 拒掉 ⇒ 抛 409；
  //    ③ 那次失败发生在「预同步成功之后」，而旧代码的 catch **只回错误、不落终态**
  //       ⇒ switchFlow 永久停在 active=true（弹窗一直在）；
  //    ④ cancel 只**置标记**，靠流程消费 —— 流程已经退出 ⇒ 标记永远没人消费 ⇒ 点关闭毫无反应。
  //    下面 E1–E7 把这条链上每一环都钉住。
  ok(daemonSrc.indexOf('if (!releaseAccountSwitch) {') > 0
    && daemonSrc.indexOf('releaseAccountSwitch = pre.releaseGate || null;') > 0,
    'E1 ⭐⭐ 预同步已占闸门时**不再重占**（重占必被自己刚起的 job 拒掉 ⇒ 切号失败）');
  ok(daemonSrc.indexOf('holdGate: true') > 0
    && /async function preSyncBeforeSwitch\(fromUid, toUid, meta\)[\s\S]{0,7000}?extra\.holdGate/.test(daemonSrc),
    'E2 ⭐ 闸门移交 holdGate：成功时把 releaseGate 交给调用方，切号结束后才释放');
  ok(/if \(gateHandedOff\) releaseGate = null;/.test(daemonSrc),
    'E3 ⭐ 移交后预同步**不得**再释放（否则闸门形同虚设）；未移交时照旧释放');
  {
    const iRoute = daemonSrc.indexOf("if (req.method === 'POST' && p === '/api/switch')");
    const iCatchTerminal = daemonSrc.indexOf("setSwitchFlowPhase(asCancelled ? 'cancelled' : 'failed',");
    ok(iRoute > 0 && iCatchTerminal > iRoute,
      'E4 ⭐⭐ /api/switch 的失败出口**必须落终态**（否则弹窗永久 active=true、关闭按钮无反应）',
      { iRoute, iCatchTerminal });
  }
  ok(/const status = Number\(e && e\.statusCode\) \|\| 500;/.test(daemonSrc),
    'E5 失败响应尊重 statusCode（409 = 环境暂不允许，面板据此提示「稍后重试」）');
  ok(/const guard = setTimeout\(\(\) => \{/.test(daemonSrc) && daemonSrc.indexOf('兜底强制取消') > 0,
    'E6 ⭐⭐ cancel 有 1.2 秒兜底：置标记后仍无人消费（流程已异常退出）⇒ 强制落 cancelled，按钮一定有反应');
  ok(/if \(body\.reload && !\(cdp && cdp\.connected\)\)/.test(daemonSrc),
    'E7 ⭐ CDP 前置检查：客户端没带调试端口启动时立刻给出可操作错误，而不是让某个 await 挂死');

  section('F. 弹窗收敛守卫（2026-09-30 用户实测：切号成功但弹窗不消失、等待时间累积）');

  // ⭐⭐ 故障：手动切号（/api/switch）**从头到尾没有阶段推进、也没有成功终态** ⇒ 状态永远停在
  //    `syncing/active=true` ⇒ 弹窗一直写「正在同步会话 · 请勿操作」（用户：切号其实早就成功）；
  //    而下一轮切号 `startedAt` 沿用了上一轮的（`setSwitchFlowPhase` 只写 `prev.startedAt || now`）
  //    ⇒ 「已等待 N 秒」把上一次的耗时也累加进去（用户：切回 186 时显示的是 186→177 那次的时长）。
  ok(/const prevActive = !!\(prev && prev\.active\);/.test(daemonSrc)
    && /next\.startedAt = explicitStart \|\| \(\(prevActive && prev\.startedAt\) \|\| now\);/.test(daemonSrc),
    'F1 ⭐⭐ startedAt 只在「上一状态也是活跃态」（同一流程内推进）时才沿用；新流程一律重置 ⇒ 修「等待时间累积」');
  ok(/const explicitStart = Number\(extra\.startedAt\) \|\| 0;/.test(daemonSrc)
    && daemonSrc.indexOf('startedAt,') > 0,
    'F2 ⭐ 新流程第一个 syncing 显式带 startedAt（双保险，不怕上一轮没落终态）');
  {
    const iSwitchPhase = daemonSrc.indexOf("setSwitchFlowPhase('switching'", iSwitchRoute);
    ok(iSwitchPhase > 0 && iSwitchPhase < iSwitchTo,
      'F3 ⭐⭐ 手动切号补上 switching 阶段（且在 switchTo 之前 ⇒ reload 后新页面重建弹窗读到「切号中」而非退回「同步中」）',
      { iSwitchPhase, iSwitchTo });
  }
  {
    const iDone = daemonSrc.indexOf("setSwitchFlowPhase('done'", iSwitchRoute);
    // 锚点用「成功返回」本身（`uid: acct.uid,` 在 done 语句里也会出现，会命中错位置）。
    const iOkReturn = daemonSrc.indexOf('return json(res, 200,', iSwitchRoute);
    ok(iDone > 0 && iOkReturn > 0 && iDone < iOkReturn,
      'F4 ⭐⭐ 手动切号成功**必须**落 done（否则弹窗永久 active=true，用户只能手点「终止」）',
      { iDone, iOkReturn });
  }
  ok(daemonSrc.indexOf('let switchFlowRunners = 0;') > 0
    && daemonSrc.indexOf('function enterSwitchFlowRunner()') > 0
    && (daemonSrc.match(/enterSwitchFlowRunner\(\)/g) || []).length >= 3,
    'F5 ⭐ 活跃流程计数（/api/switch 与 preSyncBeforeSwitch 各一处，幂等退出）');
  ok(daemonSrc.indexOf('if (switchFlowRunners === 0) {') > 0,
    'F6 ⭐⭐ cancel 时若无活跃流程（已异常退出/已成功但没落终态）⇒ **立刻**收尾，不让用户干等 1.2 秒兜底');
  ok(/switchFlowCancelTimer = setTimeout\(function \(\)/.test(injectSrc)
    && /if \(switchFlowCancelTimer\) clearTimeout\(switchFlowCancelTimer\);/.test(injectSrc),
    'F7 ⭐ 渲染层：取消请求 3 秒未收尾则解禁按钮并改文案「再点一次强制关闭」（定时器也进了 disposer）');

  /* ==================================================================== */
  console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
})();
