'use strict';
/*
 * test-growth-tasks.js —— 成长任务「一键完成」的回归套件（零网络：fetch 全部注入）。
 *
 * 为什么必须这么细：这一块的失败**几乎都是静默的**。
 *   ① 事件形状对但 userId 缺 → 服务端 200 且**静默丢弃**，表现为「跑了但没分」；
 *   ② accept 返回 200+code0 却没真正登记 → 后续事件全部不归账，任务永远点不亮；
 *   ③ 计分是**异步**的，上报后立刻回读还是旧值 → 误判「未达标」⇒ 跳过自动领奖；
 *   ④ 领奖路径写错（tasks/reward/claim）→ 404，且被吞成「领奖失败」；
 *   ⑤ 计划器只认一种行形状 → run 为空 ⇒ 整个功能变成空操作且不报错。
 * 以上五条各有专属断言组，改这块前先看清哪条会红。
 *
 * 分段：
 *   [A] 指纹与设备派生（稳定性 / 必填字段 / 小程序口径）
 *   [B] 事件构造器形状（桌面 6 连 / 活跃上报 / 小程序 / 专家 ID 真实性）
 *   [C] 上报客户端：目标域 + 头部 + 「缺 userId 不发请求」
 *   [D] 领奖路径与降级（chat 主域 → web 备域；非 400 不降级）
 *   [E] accept 回读验证（200 不等于登记）
 *   [F] 档位门控与幂等跳过（planAutoRun 是**唯一**闸门）
 *   [G] 行形状兼容（原始行 / 归一化行必须等价）
 *   [H] runAutoRun 端到端（stub 计分异步 + 自动领奖 + 单项失败不阻塞）
 *   [I] 面板与 daemon 接线静态守卫 + i18n（CRLF 先归一化再匹配）
 *
 * 跑法：node .wd-analysis/test-growth-tasks.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const gt = require(path.join(ROOT, 'scripts', 'growth-tasks.js'));

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

const NOW = 1789000000000;
const ACCOUNT = { uid: 'uid-0123456789abcdef', nickname: '测试号' };

/**
 * 从 inject.js 里抽出「词典 + 最长匹配扫描器」，返回 wbsTranslateString。
 * 这是 i18n 守卫的**唯一真相**——不要在测试里另写一份匹配逻辑。
 */
function loadInjectTranslator() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').split(/\r?\n/);
  const idxOf = (re, from) => { for (let i = from || 0; i < src.length; i++) if (re.test(src[i])) return i; return -1; };
  const dS = idxOf(/var WBS_I18N_EN = \{/);
  const dE = idxOf(/^\s*\};\s*$/, dS + 1);
  const mS = idxOf(/var wbsI18nMatchers = null;/);
  const mE = idxOf(/function wbsIsBuiltinAutomation/, mS);
  if (dS < 0 || dE <= dS || mS <= 0 || mE <= mS) throw new Error('无法从 inject.js 抽出词典/匹配器');
  // eslint-disable-next-line no-new-func
  return new Function(
    src.slice(dS, dE + 1).join('\n') + '\n' +
    src.slice(mS, mE).join('\n') + '\n' +
    'return wbsTranslateString;'
  )();
}

/**
 * 抽取 JS 源码里的**字符串字面量**（先剥注释；模板串里的 ${...} 用 0 占位）。
 * 用于「所有会渲染给用户看的中文串都必须能翻成英文」这类结构断言。
 */
function extractStringLiterals(source) {
  // 剥注释：状态机，避免把注释里的中文当成文案
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c === "'" ? 'sq' : (c === '"' ? 'dq' : 'tpl'); out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; continue; } if (c === '\n') out += c; i += 1; continue; }
    if (c === '\\') { out += c + (n === undefined ? '' : n); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) { state = 'code'; out += c; i += 1; continue; }
    if (c === '\n' && state !== 'tpl') { state = 'code'; out += '\\n'; i += 1; continue; }
    out += c; i += 1;
  }
  const code = out;
  const list = [];
  let j = 0;
  while (j < code.length) {
    const c = code[j];
    if (c === "'" || c === '"' || c === '`') {
      let k = j + 1;
      let lit = '';
      while (k < code.length) {
        if (code[k] === '\\') { lit += code[k] + code[k + 1]; k += 2; continue; }
        if (code[k] === c) break;
        lit += code[k]; k += 1;
      }
      list.push(lit.replace(/\$\{[^}]*\}/g, '0'));
      j = k + 1; continue;
    }
    j += 1;
  }
  return list;
}

/** 记录调用并按需应答的 fetch 桩。 */
function makeFetch(responder) {
  const calls = [];
  const impl = (url, init) => {
    const call = { url: String(url), method: String((init && init.method) || 'GET'), init: init || {}, headers: (init && init.headers) || {} };
    try { call.body = init && init.body ? JSON.parse(init.body) : null; } catch (_) { call.body = init && init.body; }
    calls.push(call);
    const result = (typeof responder === 'function' ? responder(call, calls.length) : null) || {};
    const raw = typeof result.body === 'string' ? result.body : JSON.stringify(result.body === undefined ? { code: 0, data: {} } : result.body);
    return Promise.resolve({
      ok: result.ok !== false,
      status: Number(result.status) || 200,
      headers: { get: () => result.contentType || 'application/json' },
      text: () => Promise.resolve(raw),
    });
  };
  return { impl, calls };
}

const findings = (calls, host) => calls.filter((c) => c.url.indexOf(host) === 0);

/* ==================================================================== */
section('[A] 指纹与设备派生：必须稳定、必带 userId');
/* ==================================================================== */

{
  const a = gt.deriveId(ACCOUNT.uid, 'machine');
  const b = gt.deriveId(ACCOUNT.uid, 'machine');
  ok(a === b, 'A1 machineId 同账号两次派生必须相同（服务端可据此判伪造，勿每次随机）', [a, b]);
  ok(/^[0-9a-f]{36}$/.test(a), 'A2 派生值是 36 位 hex（与上游 deriveID 同口径）', a);
  ok(gt.deriveId(ACCOUNT.uid, 'machine') !== gt.deriveId(ACCOUNT.uid, 'session'),
    'A3 不同盐（machine/session）不得同值（否则设备与会话标识撞成一个）');
  ok(gt.deriveId('other-uid', 'machine') !== a, 'A4 不同账号不得同值（跨账号设备隔离）');
  ok(gt.deriveId(ACCOUNT.uid, 'machine', () => 'STUB') === 'STUB', 'A5 hashImpl 可注入（回归零依赖）');

  const desktop = gt.desktopFingerprint(ACCOUNT, NOW);
  ok(desktop.userId === ACCOUNT.uid, 'A6 桌面指纹带 userId（缺了服务端静默丢弃）');
  ok(desktop.extName === 'workbuddy-desktop' && desktop.ideType === 'WorkBuddy',
    'A7 桌面指纹的端标识是 workbuddy-desktop（决定「需电脑端」类任务）。任务是否归账看这个', { extName: desktop.extName });
  ok(gt.assertFingerprintComplete(desktop) === null, 'A8 完整指纹自检通过');
  ok(typeof gt.assertFingerprintComplete({}) === 'string', 'A9 空 userId 的自检必须返回失败原因（不许静默放行）');

  const web = gt.webFingerprint(ACCOUNT, NOW);
  ok(web.userAgent && /Mozilla/.test(web.userAgent), 'A10 web 指纹是浏览器形状（页面行为类任务用）');
  ok(web.userId === ACCOUNT.uid, 'A11 web 指纹同样必带 userId');

  const mp = gt.mpFingerprint(ACCOUNT, NOW);
  ok(mp.platform === 'mini_program' && mp.extName === 'workbuddy-mp',
    'A12 小程序指纹 platform=mini_program / extName=workbuddy-mp（服务端按此关联 mini 来源）');
  ok(mp.machineId === '0655736a-607f-4d9d-b430-58176ee9a090',
    'A13 小程序 machineId 用上游抓包实测值（不是按 uid 现造）');
}

/* ==================================================================== */
section('[B] 事件构造器形状');
/* ==================================================================== */

{
  const conv = 'wd-conv-1';
  const req = 'a'.repeat(32);
  const events = gt.desktopChatSequence(conv, req, 'msg-1', 'fast-model', 'fast-model', NOW);
  ok(events.length === 6, 'B1 桌面成功对话是 6 连事件链', events.length);
  ok(events[0].eventCode === 'agent_task_created' && events[events.length - 1].eventCode === 'chat_request_response',
    'B2 链首 agent_task_created / 链尾 chat_request_response（顺序承载语义）');
  ok(events.filter((e) => e.eventCode === 'chat_request_send').length === 1, 'B3 链里恰好一条 chat_request_send');
  const response = events.filter((e) => e.eventCode === 'chat_message_response')[0];
  ok(response && response.isSuccessful === true, 'B4 必须有成功回执（RichMeow 类任务只认成功消息）');
  // ⚠️ 上游 DesktopChatSequence 的形状：codebuddy.session_id 只挂在**需要 JOIN 会话**的两条事件上
  // （chat_request_send / chat_message_response），其余事件只带 join 三元组。断言「每个事件都带」
  // 会与上游形状不符 —— 这里断言的是「挂载位置正确」，不是「到处都有」。
  const carriers = events.filter((e) => e['codebuddy.session_id'] !== undefined);
  ok(carriers.length === 2
    && carriers.every((e) => e['codebuddy.session_id'] === conv)
    && carriers.every((e) => e.eventCode === 'chat_request_send' || e.eventCode === 'chat_message_response'),
    'B5 codebuddy.session_id 只挂在 JOIN 事件（chat_request_send / chat_message_response）且等于会话 id',
    carriers.map((e) => e.eventCode));
  // join 三元组从**链首之后**开始带：agent_task_created 是「任务创建」事件，只带 conversationId/messageId
  // （与上游 DesktopChatSequence 一致）。断言「全链都有」会把上游形状判成错的。
  const joinedCount = events.filter((e) => e.traceId === req && e.rootRequestId === req && e.parentConversationId === conv).length;
  ok(joinedCount === 5 && events[0].eventCode === 'agent_task_created' && events[0].traceId === undefined,
    'B5b join 三元组从 chat_message_send 起全链携带（链首 agent_task_created 只带 conversationId）',
    { joinedCount, headTraceId: events[0].traceId });
  ok(events.filter((e) => e['codebuddy.conversation_request_id'] !== undefined).length === 2,
    'B5c codebuddy.conversation_request_id 与 session_id 同挂载点（成对出现）');
  ok(events[2].rootRequestId === req && events[2].traceId === req, 'B6 上报链的 JOIN 键用调用方给的 requestId');

  const activity = gt.chatRequestSendEvent(conv, req, 'glm-5.2', 'GLM-5.2', NOW);
  ok(activity.eventCode === 'chat_request_send', 'B7 活跃上报是 chat_request_send');
  ok(activity.userId === undefined || activity.userId === '',
    'B8 事件构造器本身不带 userId（由上报层按账号补，避免串号）', activity.userId);

  const mpEvent = gt.mpChatRequestSendEvent(conv);
  ok(mpEvent.agentName === 'mp' && mpEvent.agentType === 'main', 'B9 小程序口径 agentName=mp');
  const schoolEvent = gt.mpSchoolSeasonChatEvent(conv);
  ok(schoolEvent.activityId === gt.SCHOOL_OPEN_DAY_ACTIVITY_ID,
    'B10 校园日必须带 activityId（无 activityId 不点亮）');
  ok(gt.mpChatRequestSendEvent(conv).activityId === undefined,
    'B11 小程序首对话**不得**带 activityId（两个判据靠它区分）');

  ok(gt.REAL_REQUEST_ID_PATTERN.test('a'.repeat(32)) && gt.REAL_REQUEST_ID_PATTERN.test('cmb-' + 'b'.repeat(32)),
    'B12 服务端 requestId 两种形态都被认');
  ok(!gt.REAL_REQUEST_ID_PATTERN.test('11111111-2222-3333-4444-555555555555'),
    'B13 自造 UUID v4 **不**算服务端 requestId（专家/技能类 JOIN 只认真的）');

  const extracted = gt.extractRealRequestId('data: {"type":"start","id":"' + 'c'.repeat(32) + '","x":1}\n');
  ok(extracted === 'c'.repeat(32), 'B14 能从 SSE 里抽出服务端 requestId', extracted);
}

/* ==================================================================== */
section('[C] 上报客户端：目标域 / 头部 / 缺 userId 不发请求');
/* ==================================================================== */

(async () => {
  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: {} } }));
    const options = { fetchImpl: impl, now: () => NOW, apiHost: 'https://WRONG.example' };
    await gt.reportDesktopEvent('token', ACCOUNT, gt.CN_BASES.chatBase,
      gt.desktopChatSequence('wd-1', 'd'.repeat(32), 'msg-1', 'fast-model', 'fast-model', NOW), options);
    ok(calls.length === 1, 'C1 桌面事件一次 POST 上报（批量在 body 里，不是多次请求）', calls.length);
    ok(calls[0].url === gt.CN_BASES.chatBase + '/v2/report',
      'C2 桌面事件发到 chatBase/v2/report', calls[0].url);
    ok(calls[0].headers['x-domain'] === gt.CN_BASES.chatBase,
      'C3 x-domain 头必须是域本身（曾误写成 UA 串 —— 这一条专门守着它）', calls[0].headers['x-domain']);
    ok(Array.isArray(calls[0].body) && calls[0].body.length === 6, 'C4 body 是事件数组');
    ok(calls[0].body.every((e) => e.userId === ACCOUNT.uid), 'C5 每个事件都注入了 userId');
    ok(calls[0].headers['x-user-id'] === ACCOUNT.uid, 'C6 头部带 x-user-id');
    ok(options.apiHost === 'https://WRONG.example' && calls[0].url.indexOf('WRONG.example') < 0,
      'C7 显式通道基址优先于 options.apiHost（否则四条通道会塌到同一个域）');
  }

  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: {} } }));
    let threw = null;
    try {
      await gt.reportDesktopEvent('token', { uid: '', nickname: '' }, gt.CN_BASES.chatBase,
        gt.desktopChatSequence('wd-1', 'e'.repeat(32), 'msg-1', 'fast-model', 'fast-model', NOW),
        { fetchImpl: impl, now: () => NOW });
    } catch (error) { threw = error; }
    ok(!!threw, 'C8 缺 userId 时**必须抛错**（服务端会静默丢弃，不能让它无声溜走）');
    ok(calls.length === 0, 'C9 缺 userId 时**一个请求都不许发**（事先拦，不是事后补救）', calls.length);
  }

  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: {} } }));
    await gt.reportWebEvent('token', ACCOUNT, gt.CN_BASES.webBase, 'library_doc_intro_click',
      'https://www.workbuddy.cn/space/d/x', 'library-doc', '资料库', { fetchImpl: impl, now: () => NOW });
    ok(calls[0].url === gt.CN_BASES.webBase + '/v2/report', 'C10 web 行为事件发到 webBase/v2/report', calls[0].url);
    ok(calls[0].headers['x-client-platform'] === 'web', 'C11 web 事件带 x-client-platform: web');
    ok(/Mozilla/.test(calls[0].headers['user-agent']), 'C12 web 事件用浏览器 UA');
    ok(calls[0].body[0].elementId === 'library-doc', 'C13 web 事件把 elementId/elementName 带进 body');
  }

  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: {} } }));
    await gt.reportMpEvent('token', ACCOUNT, gt.CN_BASES.mpBase, [gt.mpChatRequestSendEvent('wd-mp-1')],
      { fetchImpl: impl, now: () => NOW });
    ok(calls[0].url === gt.CN_BASES.mpBase + '/v2/report', 'C14 小程序事件发到 mpBase（codebuddy 域）/v2/report', calls[0].url);
    ok(calls[0].headers['x-client-platform'] === 'mp-weixin' && calls[0].headers['x-platform'] === 'wechatmp',
      'C15 小程序口径的端头必须齐全（缺头 accept 返回 task not found）');
    ok(calls[0].body[0].platform === 'mini_program', 'C16 小程序事件自带 mini_program 指纹');
  }

  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: {} } }));
    await gt.reportChatActivity('token', ACCOUNT, gt.CN_BASES.billingBase, 'wd-conv-2', 'f'.repeat(32), 'glm-5.2', 'GLM-5.2',
      { fetchImpl: impl, now: () => NOW });
    ok(calls[0].url === gt.CN_BASES.billingBase + '/v2/report', 'C17 活跃上报发到 billingBase/v2/report', calls[0].url);
    ok(calls[0].body[0].userId === ACCOUNT.uid, 'C18 活跃上报的 userId 在事件体内（缺了静默丢弃）');
  }

/* ==================================================================== */
section('[D] 领奖：chat 主域 → web 备域降级，非 400 不降级');
/* ==================================================================== */

  {
    const { impl, calls } = makeFetch(() => ({ body: { code: 0, data: { credit: 300, energy: 5 } } }));
    const reward = await gt.claimReward('token', ACCOUNT, gt.CN_BASES.webBase, 'create_canvas', { fetchImpl: impl });
    ok(calls.length === 1 && calls[0].url === gt.CN_BASES.chatBase + '/activity/growth/tasks/create_canvas/claim',
      'D1 领奖主域是 chatBase 且路径不带 /v2（旧 /v2/activity/growth/tasks/reward/claim 是 404 错端点）', calls[0] && calls[0].url);
    ok(calls[0].url.indexOf('reward/claim') < 0, 'D2 路径里不得出现 reward/claim');
    ok(reward.credit === 300 && reward.energy === 5 && reward.alreadyClaimed === false, 'D3 领奖结果解析正确', reward);
  }

  {
    const { impl, calls } = makeFetch((call) => (
      call.url.indexOf(gt.CN_BASES.chatBase) === 0
        ? { ok: false, status: 400, body: { code: 400, msg: 'bad request' } }
        : { body: { code: 0, data: { credit: 100, energy: 5 } } }
    ));
    const reward = await gt.claimReward('token', ACCOUNT, gt.CN_BASES.webBase, 'Hp_Appearance', { fetchImpl: impl });
    ok(calls.length === 2, 'D4 chat 域 400 时才降级（共 2 次请求）', calls.length);
    ok(calls[1].url === gt.CN_BASES.webBase + '/activity/growth/tasks/Hp_Appearance/claim',
      'D5 降级后打的是 web 域同一个路径', calls[1] && calls[1].url);
    ok(reward.credit === 100, 'D6 降级成功后正常返回奖励', reward);
  }

  {
    const { impl, calls } = makeFetch(() => ({ ok: false, status: 500, body: { code: 500, msg: 'boom' } }));
    let threw = null;
    try { await gt.claimReward('token', ACCOUNT, gt.CN_BASES.webBase, 'skill_1', { fetchImpl: impl }); }
    catch (error) { threw = error; }
    ok(!!threw && calls.length === 1,
      'D7 非 400（真实故障）**不降级**：别把「主域挂了」伪装成「备域成功」', { threw: !!threw, n: calls.length });
  }

  {
    const { impl } = makeFetch(() => ({ body: { code: 0, data: { already_claimed: true } } }));
    const reward = await gt.claimReward('token', ACCOUNT, gt.CN_BASES.webBase, 'chat_5', { fetchImpl: impl });
    ok(reward.credit === 0 && reward.energy === 0 && reward.alreadyClaimed === true,
      'D8 已领过返回 0/0 且标记 alreadyClaimed（幂等，不重复入账）', reward);
  }

/* ==================================================================== */
section('[E] accept 回读验证：200 + code 0 ≠ 已登记');
/* ==================================================================== */

  {
    let accepted = 0;
    let readBack = 0;
    const deps = {
      acceptTasks: () => { accepted += 1; return Promise.resolve({}); },
      acceptTasksMp: () => { accepted += 1; return Promise.resolve({}); },
      findTask: () => { readBack += 1; return Promise.resolve({ acceptStatus: 'accepted' }); },
      sleep: () => Promise.resolve(),
      log: () => {},
    };
    const result = await gt.acceptWithVerify(deps, 'skill_1', false);
    ok(result === true && accepted === 1 && readBack === 1, 'E1 回读已登记 ⇒ 一次成功', { result, accepted, readBack });
  }

  {
    let accepted = 0;
    const deps = {
      acceptTasks: () => { accepted += 1; return Promise.resolve({}); },
      acceptTasksMp: () => Promise.resolve({}),
      findTask: () => Promise.resolve({ acceptStatus: accepted >= 2 ? 'accepted' : 'not_accepted' }),
      sleep: () => Promise.resolve(),
      log: () => {},
    };
    const result = await gt.acceptWithVerify(deps, 'chat_5', false);
    ok(result === true && accepted === 2, 'E2 首次未登记 ⇒ 重试一次并成功', { result, accepted });
  }

  {
    let accepted = 0;
    const deps = {
      acceptTasks: () => { accepted += 1; return Promise.resolve({}); },
      acceptTasksMp: () => Promise.resolve({}),
      findTask: () => Promise.resolve({ acceptStatus: 'not_accepted' }),
      sleep: () => Promise.resolve(),
      log: () => {},
    };
    const result = await gt.acceptWithVerify(deps, 'template_5', false);
    ok(result === false && accepted === gt.ACCEPT_VERIFY_ATTEMPTS,
      'E3 一直未登记 ⇒ 返回 false 且重试次数有上界（不无限打上游）', { result, accepted });
  }

  {
    let accepted = 0;
    const deps = {
      acceptTasks: () => { accepted += 1; return Promise.resolve({}); },
      acceptTasksMp: () => Promise.resolve({}),
      findTask: () => Promise.resolve(null),
      sleep: () => Promise.resolve(),
      log: () => {},
    };
    const result = await gt.acceptWithVerify(deps, 'black_cat', false);
    ok(result === false && accepted === gt.ACCEPT_VERIFY_ATTEMPTS,
      'E4 回读查不到任务时按「未登记」处理（空 accept_status 与查不到同口径）');
  }

/* ==================================================================== */
section('[F] 档位门控与幂等跳过：planAutoRun 是唯一闸门');
/* ==================================================================== */

  {
    const actions = gt.buildTaskActions();
    const codes = actions.map((a) => a.code);
    ok(actions.length === 19, 'F1 动作表 19 项（与线上 19 个任务码 + 2 个 mp 专属码对齐）', actions.length);
    ok(new Set(codes).size === codes.length, 'F2 动作码无重复');
    const tiers = actions.reduce((acc, a) => { acc[a.tier] = (acc[a.tier] || 0) + 1; return acc; }, {});
    ok(tiers[gt.TIER_REAL] === 7 && tiers[gt.TIER_SAFE] === 2 && tiers[gt.TIER_EVENT] === 10,
      'F3 档位分布 T1=7 / T2=2 / T3=10（改档位必须同步改这条断言）', tiers);
    ok(actions.every((a) => typeof a.run === 'function'), 'F4 每项都有可执行动作');
    ok(codes.indexOf('Expert_Philanthropy') < 0,
      'F5 需真实捐款的任务**不在**动作表里（服务端校验捐赠回执，上游实测无法绕过）');
  }

  const rawTasks = [
    { task_code: 'chat_5', accept_status: 'not_accepted', progress: null },
    { task_code: 'expert_5', accept_status: 'accepted', progress: { current: 2, target: 5 } },
    { task_code: 'first_buddy', accept_status: 'claimed', progress: { current: 1, target: 1 } },
    { task_code: 'automation_1', accept_status: 'accepted', progress: { current: 1, target: 1 } },
    { task_code: 'Expert_Philanthropy', accept_status: 'not_accepted', progress: null },
  ];

  {
    const plan = gt.planAutoRun(rawTasks, { includeTier3: false });
    const skipped = plan.skip.reduce((acc, s) => { acc[s.code] = s.reason; return acc; }, {});
    ok(plan.run.every((r) => r.tier !== gt.TIER_EVENT),
      'F6 默认（includeTier3=false）run 里**一个 tier3 都没有**（纯上报类默认关）', plan.run.map((r) => r.code));
    ok(skipped.chat_5 === 'tier3-disabled', 'F7 tier3 被跳过时的原因是 tier3-disabled（可解释，不是静默消失）', skipped);
    ok(skipped.first_buddy === 'claimed', 'F8 已领取的任务跳过（幂等，不浪费上游调用）');
    ok(skipped.automation_1 === 'completed', 'F9 已达标未领的跳过动作、留给领奖阶段');
    ok(plan.run.some((r) => r.code === 'expert_5'), 'F10 进行中的 tier1 任务照常执行');
    ok(plan.manual.some((m) => m.code === 'Expert_Philanthropy'),
      'F11 线上有、动作表没有的任务进 manual（必须显式回传，否则面板把它当成「做完了」）', plan.manual);
  }

  {
    const plan = gt.planAutoRun(rawTasks, { includeTier3: true });
    ok(plan.run.some((r) => r.code === 'chat_5'), 'F12 显式打开后 tier3 才进 run');
    ok(plan.run.filter((r) => r.tier === gt.TIER_EVENT).length === 1, 'F13 打开后 tier3 只进这一项（其余都不是 tier3）');
  }

  {
    const plan = gt.planAutoRun(rawTasks, { includeTier3: false, onlyCodes: ['chat_5'] });
    ok(plan.run.length === 0,
      'F14 ⚠️ 只指定 tier3 任务但开关没开 ⇒ 仍不执行（onlyCodes 不能绕过档位门控）', plan.run);
  }

  {
    const plan = gt.planAutoRun([], { includeTier3: true });
    ok(plan.run.length === 0 && plan.unknown.length === 19,
      'F15 线上一个任务都没有时 run 必须为空（不许凭空造动作）', { run: plan.run.length, unknown: plan.unknown.length });
  }

/* ==================================================================== */
section('[G] 行形状兼容：原始行与归一化行必须等价');
/* ==================================================================== */

  {
    const normalized = rawTasks.map(gt.normalizeTaskRow);
    ok(normalized[1].taskCode === 'expert_5' && normalized[1].current === 2 && normalized[1].target === 5,
      'G1 归一化行读得出 taskCode/current/target', normalized[1]);
    ok(normalized[2].claimed === true, 'G2 accept_status=claimed ⇒ claimed=true');
    const state = gt.readTaskState({ task_code: 'x', accept_status: 'accepted', progress: { current: 1, target: 2 } });
    ok(state.code === 'x' && state.current === 1 && state.target === 2, 'G3 readTaskState 认原始行');
    const state2 = gt.readTaskState({ taskCode: 'y', acceptStatus: 'accepted', current: 1, target: 2 });
    ok(state2.code === 'y' && state2.current === 1 && state2.target === 2, 'G4 readTaskState 也认归一化行');

    const pRaw = gt.planAutoRun(rawTasks, { includeTier3: true });
    const pNorm = gt.planAutoRun(normalized, { includeTier3: true });
    ok(JSON.stringify(pRaw.run) === JSON.stringify(pNorm.run)
      && JSON.stringify(pRaw.skip) === JSON.stringify(pNorm.skip)
      && JSON.stringify(pRaw.manual) === JSON.stringify(pNorm.manual),
      'G5 ⚠️ 两种行形状喂同一计划器必须给出同一结果（只认一种 ⇒ run 为空 ⇒ 整个功能变空操作且不报错）',
      { raw: pRaw.run.length, norm: pNorm.run.length });
  }

/* ==================================================================== */
section('[H] runAutoRun 端到端（stub 计分异步 + 自动领奖 + 单项失败不阻塞）');
/* ==================================================================== */

  {
    // 计分异步模拟：上报前 progress 是 0/1，上报后才变 1/1。
    let reported = false;
    let accepted = false;
    const { impl, calls } = makeFetch((call) => {
      if (call.method === 'POST' && call.url.indexOf('/v2/activity/growth/tasks/accept') > 0) {
        accepted = true;
        return { body: { code: 0, data: {} } };
      }
      if (call.method === 'POST' && call.url.indexOf('/v2/report') > 0) {
        reported = true;
        return { body: { code: 0, data: {} } };
      }
      if (call.method === 'POST' && call.url.indexOf('/claim') > 0) {
        return { body: { code: 0, data: { credit: 100, energy: 5 } } };
      }
      // GET 任务列表
      return {
        body: {
          code: 0,
          data: {
            tasks: [{
              task_code: 'automation_1',
              title: '创建定时任务',
              accept_status: accepted ? 'accepted' : 'not_accepted',
              progress: { current: reported ? 1 : 0, target: 1 },
            }],
          },
        },
      };
    });

    const result = await gt.runAutoRun({
      token: 'token',
      account: ACCOUNT,
      chatBase: gt.CN_BASES.chatBase,
      webBase: gt.CN_BASES.webBase,
      billingBase: gt.CN_BASES.billingBase,
      mpBase: gt.CN_BASES.mpBase,
      onlyCodes: ['automation_1'],
      options: { fetchImpl: impl, now: () => NOW, sleep: () => Promise.resolve() },
      log: () => {},
    });

    ok(accepted, 'H1 执行前对未接取任务做了 accept（进度由行为事件点亮，accept 是「报名」）');
    ok(reported, 'H2 真的上报了行为事件');
    const item = result.results.filter((r) => r.taskCode === 'automation_1')[0];
    ok(item && item.status === 'done', 'H3 单项结果为 done', item);
    ok(item && item.claimed === true && item.credit === 100,
      'H4 异步计分被轮询等到并**自动领奖**（一次性回读会误判未达标 ⇒ 跳过领奖）', item);
    ok(result.summary.planned === 1 && result.summary.claimed === 1 && result.summary.credit === 100,
      'H5 汇总口径正确', result.summary);
    ok(result.plan.run.length === 1 && result.plan.run[0].code === 'automation_1',
      'H6 onlyCodes 生效，其余 18 项没被顺带跑掉', result.plan.run);
    ok(calls.filter((c) => c.method === 'POST' && c.url.indexOf('/v2/report') > 0).length >= 1, 'H7 上报请求确实发出');
  }

  {
    // 单项抛错（动作里打一个必然失败的请求）不应带崩整轮。
    const { impl } = makeFetch((call) => {
      if (call.method === 'POST' && call.url.indexOf('/v2/report') > 0) {
        return { ok: false, status: 500, body: { code: 500, msg: 'report down' } };
      }
      if (call.method === 'POST' && call.url.indexOf('/claim') > 0) return { body: { code: 0, data: { credit: 0, energy: 0 } } };
      return {
        body: {
          code: 0,
          data: {
            tasks: [
              { task_code: 'automation_1', accept_status: 'accepted', progress: { current: 0, target: 1 } },
              { task_code: 'richmeow_unknown_code', accept_status: 'not_accepted', progress: null },
            ],
          },
        },
      };
    });
    const result = await gt.runAutoRun({
      token: 'token', account: ACCOUNT,
      chatBase: gt.CN_BASES.chatBase, webBase: gt.CN_BASES.webBase,
      billingBase: gt.CN_BASES.billingBase, mpBase: gt.CN_BASES.mpBase,
      onlyCodes: ['automation_1'],
      options: { fetchImpl: impl, now: () => NOW, sleep: () => Promise.resolve() },
      log: () => {},
    });
    const item = result.results.filter((r) => r.taskCode === 'automation_1')[0];
    ok(item && item.status === 'error' && typeof item.message === 'string',
      'H8 单项失败只影响该项（返回 status=error 而不是抛出去带崩整轮）', item);
    ok(result.summary.failed === 1 && result.summary.done === 0, 'H9 汇总如实反映失败数', result.summary);
  }

  {
    // 任务码在线上有、动作表没有 ⇒ 既不是 error 也不执行。
    const { impl, calls } = makeFetch(() => ({
      body: {
        code: 0,
        data: { tasks: [{ task_code: 'Unknown_Task_X', accept_status: 'not_accepted', progress: null }] },
      },
    }));
    const result = await gt.runAutoRun({
      token: 'token', account: ACCOUNT,
      chatBase: gt.CN_BASES.chatBase, webBase: gt.CN_BASES.webBase,
      billingBase: gt.CN_BASES.billingBase, mpBase: gt.CN_BASES.mpBase,
      options: { fetchImpl: impl, now: () => NOW, sleep: () => Promise.resolve() },
      log: () => {},
    });
    ok(result.results.length === 0 && calls.filter((c) => c.method === 'POST').length === 0,
      'H10 未知任务码不执行任何动作、也不报错', { results: result.results.length, posts: calls.filter((c) => c.method === 'POST').length });
    ok(result.plan.manual.some((m) => m.code === 'Unknown_Task_X'), 'H11 未知任务码进 manual 供面板提示人工处理');
  }

/* ==================================================================== */
section('[I] 接线静态守卫 + i18n');
/* ==================================================================== */

  {
    const daemonLf = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
    ok(/require\('\.\/growth-tasks\.js'\)/.test(daemonLf), 'I1 daemon 已 require growth-tasks.js');
    ok(daemonLf.indexOf("'/api/growth/tasks-auto-all'") >= 0, 'I2 daemon 有一键完成入口路由');
    ok(daemonLf.indexOf("'/api/growth/tasks-auto-status'") >= 0, 'I3 daemon 有作业状态路由（面板轮询用）');
    ok(daemonLf.indexOf("'/api/growth/task-actions'") >= 0, 'I4 daemon 有动作表只读路由');
    ok(/includeTier3: includeTier3 === true/.test(daemonLf) || /includeTier3 === true/.test(daemonLf),
      'I5 daemon 侧 includeTier3 默认 false（必须显式 true 才开 tier3）');
    ok(/growthAutoInFlight\.has\(uid\)/.test(daemonLf), 'I6 同账号互斥（真实对话不允许并发重跑）');
    ok(/GROWTH_AUTO_TIMEOUT_MS/.test(daemonLf), 'I7 有作业超时上界（防挂死把账号锁永久占住）');

    const mac = fs.readFileSync(path.join(ROOT, 'scripts', 'build-mac-dmg.sh'), 'utf8');
    ok(/(^|[\s"])growth-tasks\.js($|[\s;])/m.test(mac), 'I8 growth-tasks.js 在 mac 打包白名单里（漏了 daemon 启动即崩）');

    const injectLf = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
    ok(injectLf.indexOf('data-wbs-growth-auto') >= 0, 'I9 面板有单项「一键完成」按钮');
    ok(injectLf.indexOf('data-wbs-growth-auto-all') >= 0, 'I10 面板有「一键完成全部」按钮');
    ok(injectLf.indexOf('data-wbs-growth-tier3') >= 0, 'I11 面板有档位开关（tier3 默认关）');
    ok(/hasAttribute\('data-wbs-growth-auto'\)[\s\S]{0,600}?startGrowthAuto\(uid, codes\)/.test(injectLf),
      'I12 点击「一键完成」直接调 startGrowthAuto');
    // 反向守卫：一键完成**不能**被「请先切换账号」拦下（它走备份 token，与当前登录无关）
    const autoBranch = injectLf.slice(injectLf.indexOf("hasAttribute('data-wbs-growth-auto')"));
    ok(autoBranch.indexOf('confirmCurrentGrowthAccount') < 0
      || autoBranch.indexOf('confirmCurrentGrowthAccount') > autoBranch.indexOf('data-wbs-growth-tier-hint'),
      'I13 ⚠️「一键完成」分支里不得调用 confirmCurrentGrowthAccount（套了就会「明明能跑却提示请先切号」）');
  }

  {
    // i18n：新增长句必须整句入典，翻完零 CJK 残留（词典按位置最长匹配，短词会撕句子）。
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').split(/\r?\n/);
    const idx = (re, from) => { for (let i = from || 0; i < src.length; i++) if (re.test(src[i])) return i; return -1; };
    const dictStart = idx(/var WBS_I18N_EN = \{/);
    const dictEnd = idx(/^\s*\};\s*$/, dictStart + 1);
    const matcherStart = idx(/var wbsI18nMatchers = null;/);
    const matcherEnd = idx(/function wbsIsBuiltinAutomation/, matcherStart);
    ok(dictStart >= 0 && dictEnd > dictStart && matcherStart > 0 && matcherEnd > matcherStart,
      'I14 能从 inject.js 抽出词典与匹配器', { dictStart, dictEnd, matcherStart, matcherEnd });
    // eslint-disable-next-line no-new-func
    const translate = new Function(
      src.slice(dictStart, dictEnd + 1).join('\n') + '\n' +
      src.slice(matcherStart, matcherEnd).join('\n') + '\n' +
      'return wbsTranslateString;'
    )();
    // 含全角标点：中文界面里 '（' / '，' 这些也是「没翻干净」的证据。
    const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
    const strings = [
      '一键完成', '一键完成全部', '一键完成中', '完成中…',
      '包含纯上报任务（服务端不校验真实性）',
      '纯上报任务会直接向官方声明「已完成」，属于风险自担范围，默认关闭',
      '一键完成已结束', '一键完成失败', '一键完成进度',
      '该任务属于「纯上报」类：勾选下方开关后才会执行',
      '该任务需要人工在官方客户端完成',
      '可自动项数 · ', '一键完成已结束：成功 ', ' 项，领取 ', ' 项（+', ' 积分 +', ' 能量）',
    ];
    let bad = [];
    strings.forEach((s) => { if (CJK.test(translate(s, 'en'))) bad.push(s); });
    ok(bad.length === 0, 'I15 一键完成相关新文案在英文下零 CJK 残留（整句入典）', bad);
    // 拼接检查要按**运行期的真实拼法**来：面板是把静态前缀和数字直接接起来的。
    const toastText = '一键完成已结束：成功 3 项，领取 2 项（+10 积分 +5 能量）';
    const joined = translate(toastText, 'en');
    ok(!CJK.test(joined), 'I16 面板真实拼出的结束 toast 整句零 CJK 残留（短词条不会撕坏新句子）', joined);
    const statusText = translate('可自动项数 · 3', 'en');
    ok(!CJK.test(statusText), 'I16b 「可自动项数 · N」这类动态状态行零 CJK 残留', statusText);
  }

/* ==================================================================== */
section('[J] growth-tasks.js 中文字面量全量 i18n 守卫');
/* ==================================================================== */

{
  // 为什么要有这一组：daemon 的逐项结果（results[].message）**会直接渲染进面板结果行**，
  // 而词典是按「最长匹配」扫描的——只要有一句没整句入典，就会被 '账号' / '任务' / '已领取'
  // 这类短条撕成中英混合（例如「该账号无此任务」→「该Account无此Task」）。这种半成品
  // 在中文环境下**完全看不出来**，只有英文环境才暴露，所以必须靠结构断言守。
  const translate = loadInjectTranslator();
  const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

  // ① 送到官方的**载荷数据**：人名 / 模板名 / 提示词 / 活动 id。从不渲染到 DOM，不参与翻译。
  const PAYLOAD_ALLOWLIST = [
    '企鹅教师助手', '润泽小馆·日报撰写', '新产品上市 GTM 发布计划一页纸',
    '深度研究', '周报生成', '竞品分析', '活动策划', '代码评审',
    '腾讯轻量云专家', '立即召唤', 'WorkDaddy 自动化', 'hi，请回复一句话', '1+1等于几？直接回答。',
    '日报撰写', 'pm-gtm-launch-plan', 'WorkBuddy资料库介绍', 'library_doc_intro_click',
  ];
  // ② 只写进 daemon 日志、不渲染面板的开发者诊断（acceptWithVerify 的两条 log）。
  const LOG_ALLOWLIST = ['尝试', '未登记生效（回读='];

  const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'growth-tasks.js'), 'utf8');
  const literals = extractStringLiterals(raw).filter((s) => /[\u4e00-\u9fff]/.test(s));
  ok(literals.length > 50, 'J1 能抽出中文字面量（抽不出说明抽取器坏了）', literals.length);

  const leaked = new Set();
  let payloadCount = 0;
  let logCount = 0;
  let checked = 0;
  for (const lit of literals) {
    if (PAYLOAD_ALLOWLIST.some((p) => lit.indexOf(p) >= 0)) { payloadCount += 1; continue; }
    if (LOG_ALLOWLIST.some((p) => lit.indexOf(p) >= 0)) { logCount += 1; continue; }
    checked += 1;
    if (CJK.test(translate(lit, 'en'))) leaked.add(lit);
  }
  ok(checked > 40, 'J2 实际纳入翻译校验的字面量数量合理（白名单没有滥用到吞掉全部）', checked);
  ok(leaked.size === 0,
    'J3 growth-tasks.js 面向用户的中文串全部可翻成零 CJK（新文案必须整句入典）',
    Array.from(leaked).slice(0, 8));
  ok(payloadCount >= 10 && logCount >= 2,
    'J4 载荷/日志白名单没有失效（这两类本来就不该翻译）', { payloadCount, logCount });

  // 反向守卫：面板里**不允许**再出现 '可自动 N 项' 这种会产生两字片段（' 项'）的写法。
  const injectLf = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(!/可自动 ' \+ autoEligible/.test(injectLf),
    "J5 面板不再用「可自动 N 项」拼法（' 项' 两字片段会污染词典里其它句子）");
  ok(injectLf.indexOf("可自动项数 · ") >= 0, 'J6 面板改用带标点的静态前缀「可自动项数 · 」');
}

/* ==================================================================== */
  const total = pass + failures.length;
  console.log('');
  console.log('===== test-growth-tasks: ' + pass + ' pass / ' + failures.length + ' fail =====');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failures.length ? 1 : 0);
})();
