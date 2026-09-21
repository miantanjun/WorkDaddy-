'use strict';

/**
 * growth-tasks.js — 成长任务「一键完成」。
 *
 * 移植来源（模式级移植，非代码移植）：
 *   wb2api-panel/internal/panel/autotask.go        —— 19 项任务动作表 + runAutoAll + acceptWithVerify
 *   wb2api-panel/internal/upstream/desktop.go      —— 桌面指纹事件序列（/v2/report）
 *   wb2api-panel/internal/upstream/report.go       —— 成长域活跃上报（chat_request_send）
 *   wb2api-panel/internal/upstream/school.go       —— 小程序口径事件（X-Client-Platform）
 *   wb2api-panel/internal/upstream/tasks.go        —— 任务列表 / accept / 领奖
 *   wb2api-panel/internal/upstream/blackcat.go     —— 夜猫子窗口判据
 *
 * 分层（刻意分离，便于零网络回归）：
 *   L1 纯函数：指纹 / 事件序列构造 / 任务表 / 计划（planAutoRun）—— 零依赖
 *   L2 客户端：reportDesktopEvent / reportWebEvent / reportMPEvent / realChat / 专家列表
 *   L3 编排：acceptWithVerify / findTask / findTaskWaiting / claimReward / runTaskAction / runAutoRun
 *
 * ⚠️ 档位（tier）是本模块的核心安全设计，改档位前先读 §tier 注释：
 *   tier 1 = 判据需**真实痕迹**（真对话 / 真实专家 id / 服务端 requestId）⇒ 默认开
 *   tier 2 = 判据是事件，但本地有对应真实功能可先执行        ⇒ 默认开
 *   tier 3 = 判据是事件且**服务端不校验真实性**（纯上报即得积分）⇒ **默认关**
 *   tier 3 等于向官方声明「我做了某操作」而实际没做，属条款/风控判断，
 *   必须由用户显式打开（includeTier3）。上游注释原文可查：
 *     「template_id 服务端不校验真实性」「服务端不校验真实授权」
 *     「chat_3_times：3 条 chat_request_send 即 3/3，无需真实沙箱会话」
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 档位：判据需真实痕迹（真对话 / 真实专家 id / 服务端 requestId）。 */
const TIER_REAL = 1;
/** 档位：判据是事件，但本地有对应真实功能可先执行。 */
const TIER_SAFE = 2;
/** 档位：判据是事件、服务端不校验真实性 —— 默认关闭。 */
const TIER_EVENT = 3;

/**
 * 连续上报之间的间隔。对齐上游脚本实测的 1.05s 口径（避免风控）。
 * ⚠️ 调小会显著提高被判为上报风暴的概率，不建议改。
 */
const REPORT_GAP_MS = 1050;

/** 单次 HTTP 超时。 */
const REQUEST_TIMEOUT_MS = 12000;

/** 真实对话超时（含 SSE 首帧等待）。 */
const CHAT_TIMEOUT_MS = 45000;

/**
 * 达标回读的有界轮询预算。上游实测：行为事件上报后进度要**数秒**才刷新
 * （Model_chat 对话完成后立即回读仍是 0/1，约 5-8 秒后才变 1/1）。
 * 一次性回读会误判「未达标」从而跳过自动领奖 ⇒ 必须轮询。
 */
const CLAIM_POLL_ATTEMPTS = 4;
const CLAIM_POLL_GAP_MS = 3000;

/** accept 回读验证的尝试次数。上游实测存在「200+OK 但 accept 未登记」形态。 */
const ACCEPT_VERIFY_ATTEMPTS = 2;

/** 默认模型（与上游默认口径一致）。 */
const MODEL_DEFAULT = 'deepseek-v4-flash';
const MODEL_DEFAULT_NAME = 'DeepSeek V4 Flash';
const MODEL_FAST = 'fast-model';
const MODEL_GLM52 = 'glm-5.2';

/** 桌面端 UA（上游实测抓包口径：5.5.6 内嵌 CLI 2.137.1）。 */
const DESKTOP_UA = 'WorkBuddy/5.5.6 WorkBuddy/5.5.6 CLI/2.137.1';
/** Web 端 UA（浏览器形状，仅 web 域事件用）。 */
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** 服务端 requestId 形状（expert_actual_use 等 JOIN 事件只认这个，自造 UUID 不计数）。 */
const REAL_REQUEST_ID_PATTERN = /^(cmb-)?[0-9a-f]{32}$/;

/** 任务码白名单形状（与 growth-daily.js 同口径）。 */
const TASK_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,96}$/;

/** 夜猫子窗口（本地时区 23:00–08:00）。 */
const BLACKCAT_START_HOUR = 23;
const BLACKCAT_END_HOUR = 8;

/** 小程序口径任务码：默认（无 mp 头）列表不出现，accept/claim 全链路要求 mp 头。 */
const MP_TASK_CODES = new Set(['school_season', 'Sequential_Tasks_1']);

/**
 * CN 口径的四条通道基址（对齐上游抓包实测，不是随手取的常量）：
 *   - chat   copilot.tencent.com —— 桌面指纹 /v2/report、/v2/chat/completions、任务列表与 accept
 *   - web    www.workbuddy.cn    —— 浏览器指纹 /v2/report（Library_read 等页面行为）
 *   - billing www.codebuddy.cn   —— 活跃上报（chat_request_send）、小程序口径 /v2/report
 *   - mp     同 billing          —— 小程序事件头 X-Platform: wechatmp
 * 三条域均已实测可用同一 token 返回成长任务列表（code 0），互不冲突；
 * 但**指纹形状与域是配对的**（桌面指纹发到 web 域会被判为异常来源），故不可合并成一个 base。
 */
const CN_BASES = Object.freeze({
  chatBase: 'https://copilot.tencent.com',
  webBase: 'https://www.workbuddy.cn',
  billingBase: 'https://www.codebuddy.cn',
  mpBase: 'https://www.codebuddy.cn',
});

function isMpTaskCode(code) {
  return MP_TASK_CODES.has(String(code || '').trim());
}

// ---------------------------------------------------------------------------
// L1-a 小工具（纯函数）
// ---------------------------------------------------------------------------

function boundedText(input, maxLength) {
  return typeof input === 'string' ? input.trim().slice(0, maxLength) : '';
}

function nonNegativeInt(input, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** 32 位 hex 随机串（替代上游 crypto/rand 的 NewMessageID 形态）。 */
function randomHex32() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto === 'object' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * 由 uid 稳定派生 36 位 hex 设备标识（上游 deriveID 同口径：sha256(salt:uid)[:18]）。
 * 语义：同一账号每次得到同一值 ⇒ 模拟「固定设备」。上游对 machineId/sessionId
 * 就是这么造的（注释原文「模拟固定设备」），并非真实设备号。
 *
 * 注意：本模块**不**尝试读真实设备标识。理由是上报侧的 machineId 只作指纹一致性用，
 * 上游已用派生值在三账号实测通过；引入真实设备号反而多一条「把本机标识发给上游」
 * 的隐私路径。若要改，先读 §tier 注释确认收益。
 */
function deriveId(uid, salt, hashImpl) {
  const input = `${salt}:${uid}`;
  if (typeof hashImpl === 'function') return String(hashImpl(input));
  // ⚠️ 必须**确定性**：早期实现回落 randomHex32()，每次上报 machineId 都变 ——
  // 违反上游「模拟固定设备，勿每次随机」的口径，且服务端可据此判定伪造。
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 36);
}

// ---------------------------------------------------------------------------
// L1-b 指纹（纯函数）
// ---------------------------------------------------------------------------

/**
 * 桌面端公共指纹。注入到每个事件的**公共字段**（业务字段优先，可覆盖同名）。
 *
 * ⚠️ userId 是必填：上游实测「事件缺失 userId 则服务端 200 但**静默丢弃**」。
 * 这是最容易踩的一条——上报成功 ≠ 计分。isFingerprintComplete 就是守它的。
 */
function desktopFingerprint(account, nowMs, hashImpl) {
  const uid = boundedText(account && account.uid, 128);
  const nickname = boundedText(account && account.nickname, 128);
  const now = nonNegativeInt(nowMs, Date.now());
  return {
    timezone: 'Asia/Shanghai',
    reportDelay: 2000,
    userId: uid,
    username: nickname,
    userNickname: nickname,
    product: 'SaaS',
    releaseDate: 1789036585355,
    commit: '5f9692923c93033111c51ad7b003eb80204a9b75',
    ideName: 'WorkBuddy',
    ideType: 'WorkBuddy',
    ideVersion: '5.5.6',
    machineId: deriveId(uid, 'machine', hashImpl),
    sessionId: deriveId(uid, 'session', hashImpl),
    extName: 'workbuddy-desktop',
    extVersion: '5.5.6',
    os: 'win32',
    arch: 'x64',
    osVersion: '10.0.26220',
    cpuCores: 20,
    memorySize: 24,
    timestamp: now,
    presentAt: now,
  };
}

/** Web 端指纹（浏览器形状，仅 web 域页面行为类任务用）。 */
function webFingerprint(account, nowMs, hashImpl) {
  const uid = boundedText(account && account.uid, 128);
  return {
    timestamp: nonNegativeInt(nowMs, Date.now()),
    reportDelay: 0,
    os: 'Win32',
    arch: '',
    osVersion: '10.0',
    userAgent: WEB_UA,
    machineId: deriveId(uid, 'webmachine', hashImpl),
    userId: uid,
    userNickname: boundedText(account && account.nickname, 128),
    enterpriseId: boundedText(account && account.enterpriseId, 128),
  };
}

/** 小程序端指纹（appservice 形状）。 */
function mpFingerprint(account, nowMs) {
  const uid = boundedText(account && account.uid, 128);
  return {
    timestamp: nonNegativeInt(nowMs, Date.now()),
    ideType: 'WorkBuddy_MP',
    ideVersion: '2.4.0',
    extName: 'workbuddy-mp',
    extVersion: '2.4.0',
    product: 'SaaS',
    ideName: 'wx_app_cloud',
    platform: 'mini_program',
    os: 'windows',
    osVersion: '11',
    arch: 'x64',
    machineId: '0655736a-607f-4d9d-b430-58176ee9a090',
    timezone: 'Asia/Shanghai',
    userId: uid,
    userNickname: boundedText(account && account.nickname, 128),
  };
}

/**
 * 上报前自检：指纹完整性（userId 缺失 ⇒ 服务端静默丢弃，必须拦在发请求之前）。
 * 返回 null 表示通过，否则返回失败原因（供上层报错，不静默）。
 */
function assertFingerprintComplete(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'object') return '指纹为空';
  if (!boundedText(fingerprint.userId, 128)) return '缺少 userId（服务端会静默丢弃）';
  return null;
}

// ---------------------------------------------------------------------------
// L1-c 事件构造器（纯函数，与上游逐字段对齐）
// ---------------------------------------------------------------------------

function desktopEvent(eventCode, extra) {
  const ev = { eventCode: eventCode };
  if (extra && typeof extra === 'object') {
    for (const key of Object.keys(extra)) ev[key] = extra[key];
  }
  return ev;
}

/**
 * 一次「桌面端成功对话」的完整事件链（6 事件）。
 * 实测该链点亮 RichMeow_Chat；也是 template_5 / playbook_prompt / create_canvas /
 * skill_1 / Expert_lighthouse 的 JOIN 底座。
 */
function desktopChatSequence(conversationId, requestId, messageId, modelId, modelName, nowMs) {
  const now = nonNegativeInt(nowMs, Date.now());
  const mid = messageId + '-assistant';
  const join = { traceId: requestId, rootRequestId: requestId, parentConversationId: conversationId };
  const chatJoin = {
    'codebuddy.session_id': conversationId,
    'codebuddy.conversation_request_id': requestId,
  };
  return [
    desktopEvent('agent_task_created', Object.assign({
      source: 'LOCAL', name: 'working', task_target: 'local', mode: 'craft',
      requestModelId: modelId, requestModelName: modelName,
      has_repo: false, repo_type: 'none', workspace_type: 'empty',
      has_connector: false, connector_types: [],
      has_mention: false, mention_types: [],
      has_template: false, action: '', template_name: '',
      has_expert: false, expert_id: '', expert_name: '', expert_industry_id: '',
      has_skill: false, skill_names: [],
      conversationId: conversationId, messageId: messageId,
      buddyId: '', buddyName: '',
    })),
    desktopEvent('chat_message_send', Object.assign({
      messageId: mid, historyCount: 0,
      isContextTruncated: false, currentStepCount: 1,
      agentName: 'cli', agentType: 'main',
    }, join)),
    desktopEvent('chat_request_send', Object.assign({
      inputLength: 24, isPlan: false, isAutoExecuteTerminal: false,
      isAutoModify: false, codebaseEnable: false, maxToken: 0,
      maxSteps: 500, temperature: 0, maxRetries: 0,
      mentionContexts: [], knowledgeId: [], knowledgeName: [],
      codebaseId: '', mentionContextCount: 0, command: '',
      recommendId: '', skillId: '', skillCount: 0, totalCount: 0,
      agentName: 'cli', agentType: 'main',
    }, join, chatJoin)),
    desktopEvent('chat_message_response', Object.assign({
      messageId: mid, responseModelId: modelId,
      inputToken: 120, outputToken: 80, totalToken: 200,
      cachedTokens: 0, cachedWriteTokens: 0, cachedMissTokens: 0,
      isSuccessful: true, messageErrorCode: '', finishReason: 'stop',
      firstTokenAt: now,
      conversationId: conversationId,
      agentName: 'cli', agentType: 'main',
    }, join, chatJoin)),
    desktopEvent('chat_message_status', Object.assign({
      messageId: mid, messageErrorCode: '0',
      agentName: 'cli', agentType: 'main',
    }, join)),
    desktopEvent('chat_request_response', Object.assign({
      mode: 'craft', toolCallCount: 0,
      inputToken: 120, outputToken: 80, totalToken: 200,
      cachedTokens: 0, cachedWriteTokens: 0, cachedMissTokens: 0,
      isSuccessful: true, messageErrorCode: '', finishReason: 'stop',
    }, join)),
  ];
}

/**
 * 「进入 Buddy 应用」五连事件（点亮 Buddy_App 与 Buddy_App_QQ）。
 * 载体固定用企鹅教师助手（Buddy_App_QQ 的判据应用），同时满足 Buddy_App
 * 「进入任一应用」。
 */
const BUDDY_APP_CARRIER = { id: 'cb_y5Dy46tPQGGWtueMxXbe', name: '企鹅教师助手' };

function desktopBuddyAppSequence(buddyId, buddyName) {
  const id = boundedText(buddyId, 128) || BUDDY_APP_CARRIER.id;
  const name = boundedText(buddyName, 64) || BUDDY_APP_CARRIER.name;
  const mk = (code, extra) => desktopEvent(code, Object.assign({
    mode: 'LOCAL', buddyId: id, buddyName: name,
  }, extra || {}));
  return [
    mk('buddyapp_discover_click'),
    mk('buddyapp_show', { elementId: id, elementName: name, position: 2 }),
    mk('buddyapp_enter_click', { elementId: id, elementName: name, position: 2, isFirstPage: '1' }),
    mk('buddyapp_auth_confirm_click', { elementId: id, elementName: name }),
    mk('buddyapp_bindaccount_skip_click', { elementId: id, elementName: name }),
  ];
}

/** 「定时任务创建成功」单事件。 */
function automationCreateEvent(name) {
  return desktopEvent('automated_task_create_suc', {
    name: boundedText(name, 80) || 'WorkDaddy 自动化',
    source: 'manually', modelId: MODEL_FAST, modelIsThinking: true,
    connectorCount: 0, skills: '', skillCount: 0,
    scheduleType: 'once', mode: 'LOCAL',
  });
}

/** 「使用模板创建任务」事件组（template_5 计数）。 */
function desktopTemplateUseSequence(conversationId, requestId, templateId, templateName) {
  const events = desktopChatSequence(conversationId, requestId, 'msg-' + templateId, MODEL_FAST, MODEL_FAST);
  events.push(
    desktopEvent('agent_task_created_with_template', {
      mode: 'working', isCustomModel: false,
      id: templateId, name: templateName, requestId: requestId,
    }),
    desktopEvent('template_used', { template_id: templateId, task_mode: 'working' })
  );
  return events;
}

/** 「灵感案例做同款」事件组（playbook_prompt 计数）。 */
function desktopPlaybookPromptSequence(conversationId, requestId, caseId, caseName) {
  const events = desktopChatSequence(conversationId, requestId, 'msg-pb', MODEL_FAST, MODEL_FAST);
  const payload = {
    id: caseId, name: caseName, type: 'document',
    categoryId: '', categoryName: '',
  };
  events.push(
    desktopEvent('web_element_click', {
      pageName: 'playbook_detail', elementId: 'playbook_ctaClick',
      elementName: caseName, source: 'discover',
    }),
    desktopEvent('playbook_cta_click', Object.assign({ source: 'discover', position: 0 }, payload)),
    desktopEvent('playbook_prompt_send', Object.assign({
      conversationId: conversationId, requestId: requestId,
    }, payload))
  );
  return events;
}

/** 「设计创意画布」事件组（create_canvas 计数，+300 分）。 */
function desktopDesignCanvasSequence(conversationId, requestId) {
  const events = desktopChatSequence(conversationId, requestId, 'msg-canvas', MODEL_FAST, MODEL_FAST);
  const tail = requestId.slice(-8);
  events.push(
    desktopEvent('wbx_design_canvas_task_create', {
      conversationId: conversationId, requestId: requestId,
      source: 'summon_keyword', cost: 12000, isSuccessful: true,
    }),
    desktopEvent('wbx_design_canvas_open', {
      conversationId: conversationId, requestId: requestId,
      id: 'ardot-file-' + tail,
      source: 'summon_keyword', type: 'page', cost: 13000, isSuccessful: true,
    })
  );
  return events;
}

/** 专家市场条目的最小形状。 */
function normalizeExpert(input) {
  const src = input && typeof input === 'object' ? input : {};
  const version = boundedText(src.version, 32) || '1.0.0';
  const categories = Array.isArray(src.categories) ? src.categories : [];
  let category = 'expert-all';
  if (categories.length && typeof categories[0] === 'string') category = categories[0];
  return {
    expertId: boundedText(src.expert_id || src.expertId, 128),
    expertType: boundedText(src.expert_type || src.expertType, 32) || 'agent',
    displayNameZh: boundedText(src.display_name_zh || src.displayNameZh || src.name, 80),
    professionZh: boundedText(src.profession_zh || src.professionZh, 80),
    version: version,
    category: category,
  };
}

/** 「召唤平台专家」三连事件。 */
function desktopExpertSummonSequence(expertInput) {
  const e = normalizeExpert(expertInput);
  return [
    desktopEvent('web_element_click', {
      source: e.expertId, type: e.category, version: e.version,
      elementId: 'expert_summon_click', elementName: '立即召唤',
      pageURL: '/C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html',
    }),
    desktopEvent('expert_summon_click', {
      id: e.expertId, name: e.displayNameZh, expertTitle: e.professionZh,
      type: 'expert-all', position: 0, expertType: e.expertType,
      version: e.version, mode: 'LOCAL',
    }),
    desktopEvent('expert_summoned', {
      id: e.expertId, name: e.displayNameZh, expertTitle: e.professionZh, type: 'expert-all',
    }),
  ];
}

/**
 * 「专家真实使用」事件的公共载荷。
 * mode: 'craft' ⇒ expert_5 / Expert_team_use_3 判据；'LOCAL' ⇒ Expert_lighthouse 判据
 * （真实样本：轻量云专家 mode=LOCAL、type 为空、cost=0）。
 */
function desktopExpertActualUseEvent(expertInput, conversationId, requestId, mode) {
  const e = normalizeExpert(expertInput);
  return desktopEvent('expert_actual_use', {
    id: e.expertId, name: e.displayNameZh, expertTitle: e.professionZh,
    type: e.category, expertType: e.expertType, source: 'builtin', version: e.version,
    cost: 9000, characterCount: 14,
    conversationId: conversationId, requestId: requestId,
    messageId: 'msg-' + requestId.slice(-8),
    requestModelId: MODEL_FAST, requestModelName: MODEL_FAST,
    mode: mode === 'LOCAL' ? 'LOCAL' : 'craft',
  });
}

/** skill_1 判据事件（skill_info，需 JOIN 真实会话的服务端 requestId）。 */
function desktopSkillInfoEvent(conversationId, requestId) {
  return desktopEvent('skill_info', {
    id: '润泽小馆·日报撰写',
    skillId: 'skill_2097350077599879168',
    skillVersion: '1.0.0',
    toolStatus: 'success',
    fileCount: 56,
    source: 'workbuddy-desktop',
    conversationId: conversationId, requestId: requestId,
    messageId: 'msg-' + requestId.slice(-8),
    requestModelId: MODEL_FAST, requestModelName: MODEL_FAST,
    traceId: requestId,
  });
}

/**
 * 成长域活跃上报事件（chat_request_send 完整形状）。
 * ⚠️ 上游明确要求「勿用最小 3 字段，防上游后续加严」——字段必须齐。
 */
function chatRequestSendEvent(conversationId, requestId, modelId, modelName, nowMs) {
  const now = nonNegativeInt(nowMs, Date.now());
  const rid = requestId || conversationId;
  return {
    eventCode: 'chat_request_send',
    timestamp: now,
    reportDelay: 0,
    mode: 'craft',
    conversationId: conversationId,
    requestId: rid,
    inputLength: 12,
    requestModelId: modelId || MODEL_DEFAULT,
    requestModelName: modelName || (modelId || MODEL_DEFAULT),
    isPlan: false,
    isAutoExecuteTerminal: false,
    isAutoModify: false,
    codebaseEnable: false,
    maxToken: 0,
    maxSteps: 0,
    temperature: 0,
    maxRetries: 0,
    mentionContexts: [],
    knowledgeId: [],
    knowledgeName: [],
    codebaseId: '',
    mentionContextCount: 0,
    command: '',
    expertId: '',
    recommendId: '',
    skillId: '',
    skillCount: 0,
    totalCount: 0,
    fileUri: '',
    presentAt: now,
    traceId: '',
    rootRequestId: rid,
    parentConversationId: conversationId,
    agentName: 'default',
    agentType: 'conversation',
    userId: '', // 由 reportChatActivity 填入 account.uid
  };
}

/** 小程序口径 chat_request_send（school 域 chat_3_times / Sequential_Tasks_1 判据）。 */
function mpChatRequestSendEvent(conversationId) {
  const rid = 'wd-' + randomHex32();
  return {
    eventCode: 'chat_request_send',
    inputLength: 14, isPlan: false, isAutoExecuteTerminal: false,
    isAutoModify: false, codebaseEnable: false, maxToken: 0,
    maxSteps: 500, temperature: 0, maxRetries: 0,
    mentionContexts: [], knowledgeId: [], knowledgeName: [],
    codebaseId: '', mentionContextCount: 0, command: '',
    recommendId: '', skillId: '', skillCount: 0, totalCount: 0,
    traceId: rid, rootRequestId: rid,
    parentConversationId: conversationId, conversationId: conversationId,
    messageId: 'msg-' + rid.slice(-8),
    agentName: 'mp', agentType: 'main',
    'codebuddy.session_id': conversationId,
    'codebuddy.conversation_request_id': rid,
  };
}

/** 校园日活动 id（school_season 判据必须带，否则不点亮）。 */
const SCHOOL_OPEN_DAY_ACTIVITY_ID = 'school_open_day_2026';

/** school_season 判据事件：mp chat_request_send + activityId。 */
function mpSchoolSeasonChatEvent(conversationId) {
  const ev = mpChatRequestSendEvent(conversationId);
  ev.activityId = SCHOOL_OPEN_DAY_ACTIVITY_ID;
  return ev;
}

/** 资料库介绍文档 URL（Library_read 判据页面）。 */
const LIBRARY_DOC_URL = 'https://www.workbuddy.cn/space/d/o0KWYeynteVv06UnAZqIFm';

// ---------------------------------------------------------------------------
// L1-d 任务动作表
// ---------------------------------------------------------------------------

/**
 * 19 项任务动作表。顺序即执行顺序（先解锁依赖项：first_buddy 依赖活跃上报解锁）。
 *
 * 每个动作 run(ctx) 返回一段人类可读的结果文本（失败用 throw，由编排层兜。
 * ctx 见 createRunner 的构造）。
 *
 * 幂等：编排层在调用前已按任务状态跳过已完成项，动作本身不必再判。
 */
function buildTaskActions() {
  return [
    // ---------------- tier 3：判据是事件、服务端不校验（默认关） ----------------
    {
      code: 'chat_5', tier: TIER_EVENT,
      desc: '上报 5 条对话活跃事件（自动补足差额）',
      run: async (ctx) => {
        const t = await ctx.findTask('chat_5');
        if (!t) return '该账号无此任务';
        const target = t.target > 0 ? t.target : 5;
        const need = target - t.current;
        if (need <= 0) return '进度已达标，无需上报';
        let done = 0;
        for (let i = 0; i < need; i++) {
          await ctx.reportChatActivity(ctx.mkConvId('chat5', i), '');
          done++;
          if (i < need - 1) await ctx.sleep(REPORT_GAP_MS);
        }
        // ⚠️ 文案约定：变量放**句尾/标点之后**，这样面板词典只需登记静态前缀
        // （前缀是整句 ⇒ 不会被 '账号'/'任务' 这类短词条撕成中英混合）。
        return `已补报对话事件 · ${done}`;
      },
    },
    {
      code: 'Model_chat_GLM5.2', tier: TIER_REAL,
      desc: '接受任务 → glm-5.2 真实对话一次 → 对齐模型上报',
      run: async (ctx) => {
        try { await ctx.acceptTasks(['Model_chat_GLM5.2']); } catch (_) { /* accept 失败不阻塞 */ }
        await ctx.sleep(REPORT_GAP_MS);
        await ctx.realChat({ model: MODEL_GLM52, prompt: 'hi，请回复一句话' });
        await ctx.sleep(REPORT_GAP_MS);
        await ctx.reportChatActivity(ctx.mkConvId('glm52'), '', MODEL_GLM52, 'GLM-5.2');
        return '已完成 glm-5.2 对话并上报';
      },
    },
    {
      code: 'RichMeow_Chat', tier: TIER_EVENT,
      desc: '桌面指纹事件链上报（6 事件，含成功回执）',
      run: async (ctx) => {
        const conv = ctx.mkConvId('rm');
        await ctx.reportDesktopEvent(desktopChatSequence(conv, conv + '-req', 'msg-' + conv.slice(-6), MODEL_FAST, MODEL_FAST, ctx.now()));
        return '已上报桌面端完整对话事件链';
      },
    },
    {
      code: 'Buddy_App', tier: TIER_EVENT,
      desc: '上报「进入 Buddy 应用」五连事件',
      run: async (ctx) => {
        await ctx.reportDesktopEvent(desktopBuddyAppSequence(BUDDY_APP_CARRIER.id, BUDDY_APP_CARRIER.name));
        return '已上报 buddyapp 进入五连事件';
      },
    },
    {
      code: 'Buddy_App_QQ', tier: TIER_EVENT,
      desc: '上报「进入企鹅教师助手」五连事件',
      run: async (ctx) => {
        await ctx.reportDesktopEvent(desktopBuddyAppSequence(BUDDY_APP_CARRIER.id, BUDDY_APP_CARRIER.name));
        return '已上报 buddyapp 进入五连事件（与 Buddy_App 共用载体）';
      },
    },
    {
      code: 'automation_1', tier: TIER_SAFE,
      desc: '上报「定时任务创建成功」事件',
      run: async (ctx) => {
        await ctx.reportDesktopEvent([automationCreateEvent('WorkDaddy 自动化')]);
        return '已上报定时任务创建事件';
      },
    },
    {
      code: 'Library_read', tier: TIER_EVENT,
      desc: '上报「读资料库介绍」页面点击事件',
      run: async (ctx) => {
        await ctx.reportWebEvent('web_element_click', LIBRARY_DOC_URL, 'library_doc_intro_click', 'WorkBuddy资料库介绍');
        return '已上报资料库介绍阅读事件';
      },
    },
    {
      code: 'template_5', tier: TIER_EVENT,
      desc: '上报「使用模板创建任务」事件组 ×5',
      run: async (ctx) => {
        const templates = [
          ['1', '深度研究'], ['2', '周报生成'], ['3', '竞品分析'],
          ['4', '活动策划'], ['5', '代码评审'],
        ];
        let done = 0;
        for (let i = 0; i < templates.length; i++) {
          const conv = ctx.mkConvId('tpl' + i);
          await ctx.reportDesktopEvent(desktopTemplateUseSequence(conv, conv + '-req', templates[i][0], templates[i][1]));
          done++;
          if (i < templates.length - 1) await ctx.sleep(300);
        }
        return `已上报 template_used ×${done}`;
      },
    },
    {
      code: 'playbook_prompt', tier: TIER_EVENT,
      desc: '上报「灵感案例做同款」事件组',
      run: async (ctx) => {
        const conv = ctx.mkConvId('pb');
        await ctx.reportDesktopEvent(desktopPlaybookPromptSequence(conv, conv + '-req', 'pm-gtm-launch-plan', '新产品上市 GTM 发布计划一页纸'));
        return '已上报 playbook_cta_click + playbook_prompt_send';
      },
    },
    {
      code: 'create_canvas', tier: TIER_EVENT,
      desc: '上报「设计创意画布创建」事件组',
      run: async (ctx) => {
        const conv = ctx.mkConvId('canvas');
        await ctx.reportDesktopEvent(desktopDesignCanvasSequence(conv, conv + '-req'));
        return '已上报 wbx_design_canvas_task_create/open';
      },
    },
    // ---------------- tier 1：判据需真实痕迹（默认开） ----------------
    {
      code: 'first_buddy', tier: TIER_REAL,
      desc: '上报解锁 → 同意协议 → 领取第一只 Buddy',
      run: async (ctx) => {
        await ctx.reportChatActivity(ctx.mkConvId('adopt'), '');
        await ctx.sleep(REPORT_GAP_MS);
        await ctx.buddyAgreement();
        try {
          await ctx.buddyFirst();
        } catch (error) {
          const message = String((error && error.message) || error);
          if (/incomplete|未完成|门槛/i.test(message)) {
            return '前置已上报，但领养门槛未过（需当日活跃），请稍后重试';
          }
          throw error;
        }
        return '已领取 Buddy';
      },
    },
    {
      code: 'expert_5', tier: TIER_REAL,
      desc: '真实专家召唤+使用链 ×5（专家市场真实 id + 真实对话）',
      run: (ctx) => ctx.runExpertBatch('agent', 5),
    },
    {
      code: 'Expert_team_use_3', tier: TIER_REAL,
      desc: '真实专家团召唤+使用链 ×3',
      run: (ctx) => ctx.runExpertBatch('team', 3),
    },
    {
      code: 'Expert_lighthouse', tier: TIER_REAL,
      desc: '真实轻量云专家召唤+使用链',
      run: (ctx) => ctx.runExpertBatch('agent', 1, { requireId: 'ex_2cvvUZQhDyeJ', mode: 'LOCAL' }),
    },
    {
      code: 'skill_1', tier: TIER_REAL,
      desc: '真实对话 + skill_info 技能加载事件',
      run: async (ctx) => {
        const chat = await ctx.realChat({ model: MODEL_FAST, prompt: '1+1等于几？直接回答。' });
        const events = desktopChatSequence(chat.conversationId, chat.requestId, 'msg-' + chat.requestId.slice(-8), MODEL_FAST, MODEL_FAST, ctx.now());
        for (const ev of events) {
          if (ev.eventCode === 'chat_message_response') ev.finishReason = 'tool_calls';
        }
        events.push(desktopSkillInfoEvent(chat.conversationId, chat.requestId));
        await ctx.reportDesktopEvent(events);
        return '已上报真实对话 + skill_info 技能加载事件';
      },
    },
    {
      code: 'black_cat', tier: TIER_REAL,
      desc: '夜猫子：夜间窗口内 glm-5.2 对话补足（窗口外跳过）',
      attempt: true,
      run: async (ctx) => {
        if (!inNightWindow(ctx.now())) {
          return '当前不在 23:00–08:00 计数窗口，行为不计分';
        }
        const t = await ctx.findTask('black_cat');
        if (!t) return '该账号无此任务';
        const need = t.target > 0 ? t.target - t.current : 0;
        if (need <= 0) return '进度已达标，无需补足';
        let ok = 0;
        for (let i = 0; i < need; i++) {
          await ctx.realChat({ model: MODEL_GLM52, prompt: '1+1等于几？直接回答。' });
          await ctx.reportChatActivity(ctx.mkConvId('night' + i), '', MODEL_GLM52, 'GLM-5.2');
          ok++;
          if (i < need - 1) await ctx.sleep(4000);
        }
        return `已完成夜间对话并上报 · ${ok}`;
      },
    },
    // ---------------- tier 2：本地有真实功能可先执行 ----------------
    {
      code: 'Hp_Appearance', tier: TIER_SAFE,
      desc: '设置官方主题 API + 皮肤生效事件',
      run: async (ctx) => {
        await ctx.setAppearanceTheme(HP_APPEARANCE_THEME_KEY);
        await ctx.sleep(2000);
        await ctx.reportDesktopEvent([desktopEvent('appearance_skin_apply', {
          action: 'apply', source: 'settings_close',
          id: HP_APPEARANCE_THEME_KEY, vipLevel: 0, series: '', type: 'unknown',
        })]);
        return '已设置主题并上报皮肤生效事件';
      },
    },
    // ---------------- 小程序口径（档位随活动，归 tier 3） ----------------
    {
      code: 'school_season', tier: TIER_EVENT,
      desc: '校园日：mp chat + activityId 上报 → 领奖',
      run: (ctx) => ctx.runMpMiniChat('school_season', true),
    },
    {
      code: 'Sequential_Tasks_1', tier: TIER_EVENT,
      desc: '小程序首对话：mp chat 上报 → 领奖',
      run: (ctx) => ctx.runMpMiniChat('Sequential_Tasks_1', false),
    },
  ];
}

/** Hp_Appearance 判据主题（和平精英激战金秋）。 */
const HP_APPEARANCE_THEME_KEY = 'theme-tkmw7j';

/** 夜猫子计数窗口判定（本地时区 23:00–08:00）。 */
function inNightWindow(nowMs) {
  const d = new Date(nonNegativeInt(nowMs, Date.now()));
  const h = d.getHours();
  return h >= BLACKCAT_START_HOUR || h < BLACKCAT_END_HOUR;
}

// ---------------------------------------------------------------------------
// L1-e 计划（纯函数）—— 档位门控与幂等跳过的**唯一权威**
// ---------------------------------------------------------------------------

/** 任务在动作表中的下标（依赖序；未知返回大值）。 */
function taskActionIndex(actions, code) {
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].code === code) return i;
  }
  return 1 << 20;
}

/**
 * 决定本次要执行哪些任务。**纯函数**，不发任何请求 —— 这是回归测试的主要靶点，
 * 也是 tier 3 默认关闭的唯一实现点（改这里就能改行为，别在别处再判一次）。
 *
 * @param {Array} tasks      上游任务列表（{task_code, progress:{current,target}, accept_status, ...}）
 * @param {Object} options   { includeTier3, actions, onlyCodes, actionIndex }
 * @returns {Object}         { run: [...], skip: [{code, reason}], unknown: [...] }
 */
function planAutoRun(tasks, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const actions = Array.isArray(opts.actions) ? opts.actions : buildTaskActions();
  const includeTier3 = opts.includeTier3 === true;
  const onlyCodes = Array.isArray(opts.onlyCodes) && opts.onlyCodes.length
    ? new Set(opts.onlyCodes.map((c) => String(c || '').trim()))
    : null;

  const byCode = new Map();
  const list = Array.isArray(tasks) ? tasks : [];
  for (const task of list) {
    if (!task || typeof task !== 'object') continue;
    const state = readTaskState(task);
    if (!state.code) continue;
    byCode.set(state.code, state);
  }

  const run = [];
  const skip = [];
  const unknown = [];
  const covered = new Set();

  for (const action of actions) {
    covered.add(action.code);
    if (onlyCodes && !onlyCodes.has(action.code)) continue;
    const state = byCode.get(action.code);
    if (!state) {
      unknown.push(action.code);
      continue;
    }
    // 档位门控：tier 3 默认不发（见文件头 §tier）。
    if (action.tier === TIER_EVENT && !includeTier3) {
      skip.push({ code: action.code, reason: 'tier3-disabled' });
      continue;
    }
    // 幂等：已领 / 已达标 ⇒ 直接跳过，不重复消耗上游配额。
    if (state.claimed) {
      skip.push({ code: action.code, reason: 'claimed' });
      continue;
    }
    if (state.target > 0 && state.current >= state.target) {
      skip.push({ code: action.code, reason: 'completed' });
      continue;
    }
    run.push({
      code: action.code, tier: action.tier, desc: action.desc,
      attempt: action.attempt === true, current: state.current, target: state.target,
    });
  }

  // 线上有、动作表没有的任务 —— 只能人工处理（如 Expert_Philanthropy 需真实捐款，
  // 服务端领奖时校验捐赠回执，上游实测无法绕过）。必须**显式回传**，否则面板会
  // 把「没做」当成「已完成」，用户看不到还差什么。
  const manual = [];
  for (const state of byCode.values()) {
    if (covered.has(state.code)) continue;
    if (state.claimed) continue;
    manual.push({ code: state.code, title: state.title, current: state.current, target: state.target });
  }

  run.sort((a, b) => taskActionIndex(actions, a.code) - taskActionIndex(actions, b.code));
  return { run: run, skip: skip, unknown: unknown, manual: manual, includeTier3: includeTier3 };
}

// ---------------------------------------------------------------------------
// L2 客户端（网络层；fetchImpl / now / sleep 全部可注入）
// ---------------------------------------------------------------------------

function resolveFetch(options) {
  const impl = options && options.fetchImpl;
  return typeof impl === 'function' ? impl : globalThis.fetch;
}

/**
 * 解析生效基址。
 * ⚠️ 优先级：**显式通道基址 > options.apiHost > 通道默认**。
 * 早期写成 options.apiHost 优先，会把「桌面走 copilot、web 走 workbuddy.cn」两条通道
 * 一起塌到同一个 host（指纹与域就不再配对），是隐性错配。
 */
function resolveApiHost(options, fallback, defaultBase) {
  const channel = String(fallback || '').trim();
  if (channel) return channel.replace(/\/+$/, '');
  const global = String((options && options.apiHost) || '').trim();
  if (global) return global.replace(/\/+$/, '');
  return String(defaultBase || CN_BASES.chatBase).replace(/\/+$/, '');
}

/** 归一化上游信封：{code,msg,data} ⇒ data；非 0 code 抛错。 */
function unwrapEnvelope(payload, label) {
  if (!payload || typeof payload !== 'object') return {};
  const code = payload.code;
  if (code !== 0 && code !== undefined && code !== null) {
    throw new Error(`${label}: ${payload.msg || ('code=' + code)}`);
  }
  return payload.data && typeof payload.data === 'object' ? payload.data : {};
}

async function postJson(url, headers, body, options, label, timeoutMs) {
  const fetchImpl = resolveFetch(options);
  if (typeof fetchImpl !== 'function') throw new Error(`${label}参数不完整`);
  const controller = new AbortController();
  const budget = Number.isFinite(timeoutMs) ? timeoutMs : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: Object.assign({ 'content-type': 'application/json' }, headers),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { throw new Error(`${label}返回了无法解析的数据`); }
    if (!response.ok) {
      const failure = new Error(`${label} HTTP ${response.status}${payload && payload.msg ? ': ' + payload.msg : ''}`);
      // 带上 status：领奖需要按 400 决定「chat 域 → web 域」降级（见 claimReward）。
      failure.status = response.status;
      throw failure;
    }
    return unwrapEnvelope(payload, label);
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`${label}请求超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, headers, options, label, timeoutMs) {
  const fetchImpl = resolveFetch(options);
  if (typeof fetchImpl !== 'function') throw new Error(`${label}参数不完整`);
  const controller = new AbortController();
  const budget = Number.isFinite(timeoutMs) ? timeoutMs : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: Object.assign({ accept: 'application/json, text/plain, */*' }, headers),
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { throw new Error(`${label}返回了无法解析的数据`); }
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return unwrapEnvelope(payload, label);
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`${label}请求超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function bearerHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/plain, */*',
    'user-agent': DESKTOP_UA,
  };
}

/**
 * 桌面指纹事件上报 → {chatBase}/v2/report。
 * 指纹注入每个事件的公共字段；业务字段优先（可覆盖同名）。
 */
async function reportDesktopEvent(token, account, chatBase, events, options) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) throw new Error('桌面事件上报：事件为空');
  const now = options && typeof options.now === 'function' ? options.now() : Date.now();
  const fingerprint = desktopFingerprint(account, now, options && options.hashImpl);
  const bad = assertFingerprintComplete(fingerprint);
  if (bad) throw new Error(`桌面事件上报：${bad}`);
  const body = list.map((ev) => Object.assign({}, fingerprint, ev));
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  return postJson(`${host}/v2/report`, Object.assign(bearerHeaders(token), {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'x-domain': host,
    'x-product': 'SaaS',
    'x-request-id': randomHex32() + String(Date.now() % 1e6),
    'x-user-id': String((account && account.uid) || ''),
  }), body, options, '桌面事件上报');
}

/** Web 指纹事件上报 → {webBase}/v2/report（页面行为类任务，如 Library_read）。 */
async function reportWebEvent(token, account, webBase, eventCode, pageUrl, elementId, elementName, options) {
  const now = options && typeof options.now === 'function' ? options.now() : Date.now();
  const fingerprint = webFingerprint(account, now, options && options.hashImpl);
  const bad = assertFingerprintComplete(fingerprint);
  if (bad) throw new Error(`Web 事件上报：${bad}`);
  const ev = Object.assign({}, fingerprint, {
    eventCode: eventCode,
    pageURL: pageUrl,
    elementId: elementId,
    elementName: elementName,
  });
  const host = resolveApiHost(options, webBase, CN_BASES.webBase);
  return postJson(`${host}/v2/report`, Object.assign({}, bearerHeaders(token), {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-client-platform': 'web',
    origin: host,
    referer: pageUrl,
    'user-agent': WEB_UA,
    'x-user-id': String((account && account.uid) || ''),
  }), [ev], options, 'Web 事件上报');
}

/** 小程序指纹事件上报 → {codebuddyBase}/v2/report。 */
async function reportMpEvent(token, account, mpBase, events, options) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) throw new Error('小程序事件上报：事件为空');
  const now = options && typeof options.now === 'function' ? options.now() : Date.now();
  const fingerprint = mpFingerprint(account, now);
  const bad = assertFingerprintComplete(fingerprint);
  if (bad) throw new Error(`小程序事件上报：${bad}`);
  const body = list.map((ev) => Object.assign({}, fingerprint, ev));
  const host = resolveApiHost(options, mpBase, CN_BASES.mpBase);
  return postJson(`${host}/v2/report`, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-user-id': String((account && account.uid) || ''),
    'x-client-product': 'workbuddy-mp',
    'x-client-version': '2.4.0',
    'x-client-platform': 'mp-weixin',
    'x-platform': 'wechatmp',
  }, body, options, '小程序事件上报');
}

/** 成长域活跃上报（chat_request_send）→ {billingBase}/v2/report。 */
async function reportChatActivity(token, account, billingBase, conversationId, requestId, modelId, modelName, options) {
  const now = options && typeof options.now === 'function' ? options.now() : Date.now();
  const ev = chatRequestSendEvent(conversationId, requestId, modelId || MODEL_DEFAULT, modelName || MODEL_DEFAULT_NAME, now);
  ev.userId = String((account && account.uid) || ''); // 必填：缺失则服务端静默丢弃
  if (!ev.userId) throw new Error('活跃上报：缺少 userId（服务端会静默丢弃）');
  const host = resolveApiHost(options, billingBase, CN_BASES.billingBase);
  return postJson(`${host}/v2/report`, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json;charset=UTF-8',
    accept: 'application/json, text/plain, */*',
    'x-domain': host,
    'x-product': 'SaaS',
    'x-request-id': randomHex32(),
    'user-agent': DESKTOP_UA,
    'x-user-id': ev.userId,
    origin: host,
    referer: `${host}/profile/growth-center`,
    'x-client-platform': 'web',
  }, [ev], options, '活跃上报');
}

/**
 * 真实对话（桌面指纹 → /v2/chat/completions SSE），返回**服务端** requestId。
 *
 * ⚠️ expert_actual_use / skill_info 等 JOIN 事件的 requestId 必须是这里拿到的
 * 服务端 id —— 自造 UUID 不计数（上游实证）。
 */
async function realChat(token, account, chatBase, params, options) {
  const p = params && typeof params === 'object' ? params : {};
  const fetchImpl = resolveFetch(options);
  if (typeof fetchImpl !== 'function') throw new Error('真实对话参数不完整');
  const model = boundedText(p.model, 64) || MODEL_GLM52;
  const prompt = boundedText(p.prompt, 400) || '1+1等于几？直接回答。';
  const conversationId = boundedText(p.conversationId, 128) || ('wd-conv-' + Date.now());
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'user-agent': DESKTOP_UA,
    'x-domain': host,
    'x-product': 'SaaS',
    'x-user-id': String((account && account.uid) || ''),
    'x-conversation-id': conversationId,
    'x-request-id': String(Date.now()) + randomHex32().slice(0, 8),
    'x-agent-intent': 'craft',
    'x-agent-type': 'main',
    'x-ide-name': 'WorkBuddy',
    'x-ide-type': 'WorkBuddy',
    'x-ide-version': '5.5.6',
    'x-codebuddy-request': '1',
  };
  if (p.expertId) headers['x-expert-id'] = String(p.expertId);
  const body = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    stream_options: { include_usage: true },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${host}/v2/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`真实对话 HTTP ${response.status}${text ? ': ' + text.slice(0, 160) : ''}`);
    }
    // 从 SSE 里抓第一个符合服务端形状的 id（等价上游 idRegex 口径）。
    let requestId = '';
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          const found = extractRealRequestId(buffer);
          if (found) { requestId = found; break; }
          if (buffer.length > 1 << 20) break;
        }
      } finally {
        reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch (_) { /* 已释放 */ }
      }
    }
    if (!requestId) throw new Error('真实对话：SSE 中未找到服务端 requestId');
    return { conversationId: conversationId, requestId: requestId };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('真实对话请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 SSE 文本里抽第一个服务端 requestId（纯函数，便于回归）。 */
function extractRealRequestId(text) {
  const src = String(text || '');
  const marker = '"id":"';
  let from = 0;
  while (true) {
    const at = src.indexOf(marker, from);
    if (at < 0) return '';
    const rest = src.slice(at + marker.length);
    const end = rest.indexOf('"');
    if (end < 0) return '';
    const candidate = rest.slice(0, end);
    if (REAL_REQUEST_ID_PATTERN.test(candidate)) return candidate;
    from = at + marker.length;
  }
}

/** 拉取专家市场真实列表（expert_actual_use 的 id 必须真实存在，编造不计数）。 */
async function fetchMarketExperts(token, account, chatBase, expertType, options) {
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  const data = await postJson(`${host}/portal/operation-platform/market/expert/list`, Object.assign(bearerHeaders(token), {
    'content-type': 'application/json',
    'x-domain': host,
    'x-product': 'SaaS',
    'x-user-id': String((account && account.uid) || ''),
  }), { page: 1, page_size: 20, sort_by: 'reco_rank', sort_order: 'desc', expert_type: String(expertType || 'agent') },
    options, '专家列表');
  const experts = Array.isArray(data.experts) ? data.experts : [];
  return experts.map(normalizeExpert).filter((e) => e.expertId);
}

/** 设置官方外观主题（Hp_Appearance 前半段）。 */
async function setAppearanceTheme(token, account, chatBase, resourceKey, options) {
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  return postJson(`${host}/v2/user-asset/appearance/set`, Object.assign(bearerHeaders(token), {
    'content-type': 'application/json;charset=UTF-8',
    'x-product': 'SaaS',
    'x-user-id': String((account && account.uid) || ''),
  }), { kind: 'theme', resource_key: String(resourceKey || '') }, options, '设置主题');
}

// ---------------------------------------------------------------------------
// L2-b 任务列表 / accept / 领奖
// ---------------------------------------------------------------------------

/**
 * 统一读取任务状态，**同时兼容两种行形状**：
 *   - 线上原始行：{ task_code, accept_status, progress:{current,target}|null }
 *   - 本模块归一化行：{ taskCode, acceptStatus, current, target, claimed }
 * ⚠️ 这个「两形状兼容」不是洁癖：planAutoRun 的输入在 runAutoRun 里来自 listTasks()
 * （归一化行），而回归测试喂的是原始行。只认一种 ⇒ 另一种静默不匹配 ⇒ run 为空、
 * 整个功能变成空操作且不报错（最难查的一类缺陷）。
 */
function readTaskState(task) {
  const src = task && typeof task === 'object' ? task : {};
  const progress = src.progress && typeof src.progress === 'object' ? src.progress : {};
  const pick = (camel, snake, fallback) => {
    if (src[camel] !== undefined && src[camel] !== null) return src[camel];
    if (src[snake] !== undefined && src[snake] !== null) return src[snake];
    return fallback;
  };
  const acceptStatus = String(pick('acceptStatus', 'accept_status', ''));
  return {
    code: String(pick('taskCode', 'task_code', '')).trim(),
    title: boundedText(src.title || src.task_desc, 80),
    current: Math.max(0, Number(pick('current', 'current', progress.current)) || 0),
    target: Math.max(0, Number(pick('target', 'target', progress.target)) || 0),
    acceptStatus: acceptStatus,
    claimed: pick('claimed', 'claimed', false) === true || acceptStatus === 'claimed',
  };
}

function normalizeTaskRow(task) {
  const state = readTaskState(task);
  return {
    taskCode: state.code,
    title: state.title,
    current: state.current,
    target: state.target,
    acceptStatus: state.acceptStatus,
    claimed: state.claimed,
    claimable: !state.claimed && state.target > 0 && state.current >= state.target,
  };
}

/** 拉取任务列表（默认口径；mp 口径请用 listTasksMp）。 */
async function listTasks(token, account, chatBase, options) {
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  const data = await getJson(`${host}/v2/activity/growth/tasks`, bearerHeaders(token), options, '任务列表');
  const rows = Array.isArray(data.tasks) ? data.tasks : [];
  return rows.map(normalizeTaskRow);
}

/** 拉取小程序口径任务列表（默认列表不含 mp 专属码）。 */
async function listTasksMp(token, account, mpBase, options) {
  const host = resolveApiHost(options, mpBase, CN_BASES.mpBase);
  const data = await getJson(`${host}/v2/activity/growth/tasks`, {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/plain, */*',
    'x-client-platform': 'miniprogram',
    'x-user-id': String((account && account.uid) || ''),
  }, options, '任务列表(mp)');
  const rows = Array.isArray(data.tasks) ? data.tasks : [];
  return rows.map(normalizeTaskRow);
}

/** 批量接受任务（accept 是「报名」，不产生进度，可幂等重放）。 */
async function acceptTasks(token, account, chatBase, codes, options) {
  const list = (Array.isArray(codes) ? codes : []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!list.length) return {};
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  return postJson(`${host}/v2/activity/growth/tasks/accept`, Object.assign(bearerHeaders(token), {
    'content-type': 'application/json',
    'x-user-id': String((account && account.uid) || ''),
  }), { task_codes: list }, options, '接受任务');
}

/** mp 口径批量接受。 */
async function acceptTasksMp(token, account, mpBase, codes, options) {
  const list = (Array.isArray(codes) ? codes : []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!list.length) return {};
  const host = resolveApiHost(options, mpBase, CN_BASES.mpBase);
  return postJson(`${host}/v2/activity/growth/tasks/accept`, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'x-client-platform': 'miniprogram',
    'x-user-id': String((account && account.uid) || ''),
  }, { task_codes: list }, options, '接受任务(mp)');
}

/**
 * 领奖（非 mp）。
 *
 * 端点契约（上游 task_runner M15 实测沉淀，两个域**主备关系**）：
 *   主  POST {chatBase}/activity/growth/tasks/{code}/claim   ← 无 /v2 前缀、无 body
 *   备  POST {webBase}/activity/growth/tasks/{code}/claim    ← chat 域 400 时降级，web 指纹头
 * ⚠️ 路径是「task_code 在 path 上」；上游注释明确记过 `tasks/reward/claim` 这个路径
 * **不存在**（照抄 body 形态会 404）。
 * 幂等：已领返回 {credit:0, energy:0, alreadyClaimed:true}。
 */
async function claimReward(token, account, webBase, taskCode, options) {
  const code = boundedText(taskCode, 96);
  if (!code) throw new Error('领奖：task_code 为空');
  const webHost = resolveApiHost(options, webBase, CN_BASES.webBase);
  // 主域基址由调用方（createRunner）解析后经 options.chatBase 透传，避免本函数自己
  // 再算一次而与 ctx.chatBase 不一致。
  const chatHost = resolveApiHost(options, options && options.chatBase, CN_BASES.chatBase);
  const uid = String((account && account.uid) || '');
  const path = `/activity/growth/tasks/${encodeURIComponent(code)}/claim`;
  const parse = (data) => {
    if (data.already_claimed === true) return { credit: 0, energy: 0, alreadyClaimed: true };
    return {
      credit: nonNegativeInt(data.credit, 0),
      energy: nonNegativeInt(data.energy, 0),
      alreadyClaimed: false,
    };
  };
  try {
    const data = await postJson(`${chatHost}${path}`, Object.assign(bearerHeaders(token), {
      'content-type': 'application/json',
      'x-user-id': uid,
    }), {}, options, '领奖');
    return parse(data);
  } catch (error) {
    // 仅 400 降级（上游实测该形态出现在部分任务/租户）；500/超时等真实故障直接上抛，
    // 不要让「主域挂了」被伪装成「备域成功」。
    if (!error || error.status !== 400) throw error;
  }
  const data = await postJson(`${webHost}${path}`, {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    origin: webHost,
    referer: `${webHost}/profile/growth-center`,
    'x-client-platform': 'web',
    'user-agent': WEB_UA,
    'x-user-id': uid,
  }, {}, options, '领奖(web 降级)');
  return parse(data);
}

/** 领奖（mp 口径）。 */
async function claimRewardMp(token, account, mpBase, taskCode, options) {
  const code = boundedText(taskCode, 96);
  if (!code) throw new Error('领奖(mp)：task_code 为空');
  const host = resolveApiHost(options, mpBase, CN_BASES.mpBase);
  const data = await postJson(`${host}/v2/activity/growth/tasks/${encodeURIComponent(code)}/claim`, {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'x-client-platform': 'miniprogram',
    'x-user-id': String((account && account.uid) || ''),
  }, {}, options, '领奖(mp)');
  if (data.already_claimed === true) return { credit: 0, energy: 0, alreadyClaimed: true };
  return {
    credit: nonNegativeInt(data.credit, 0),
    energy: nonNegativeInt(data.energy, 0),
    alreadyClaimed: false,
  };
}

/** Buddy 协议同意 / 领养（first_buddy 链路）。 */
async function buddyAgreement(token, account, chatBase, options) {
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  return postJson(`${host}/activity/growth/buddy/agreement`, bearerHeaders(token), {}, options, 'Buddy 协议');
}

async function buddyFirst(token, account, chatBase, options) {
  const host = resolveApiHost(options, chatBase, CN_BASES.chatBase);
  return postJson(`${host}/activity/growth/buddy/first`, bearerHeaders(token), {}, options, '领取 Buddy');
}

// ---------------------------------------------------------------------------
// L3 编排
// ---------------------------------------------------------------------------

/**
 * accept 并**回读验证**登记生效。
 *
 * ⚠️ 上游实测存在「HTTP 200 + code 0 但 accept 未真正登记」的形态 —— 此时后续
 * 上报的行为事件**全部不归账**，任务永远点不亮。故判定必须以回读 accept_status 为准，
 * 未生效重试一次。这是本模块最容易被简化掉、但代价最大的一处（会表现为「跑了但没分」）。
 */
async function acceptWithVerify(deps, code, isMp) {
  const target = String(code || '').trim();
  for (let attempt = 1; attempt <= ACCEPT_VERIFY_ATTEMPTS; attempt++) {
    try {
      if (isMp) await deps.acceptTasksMp([target]);
      else await deps.acceptTasks([target]);
    } catch (error) {
      deps.log(`accept ${target} 尝试${attempt}失败: ${String((error && error.message) || error)}`);
      continue;
    }
    await deps.sleep(REPORT_GAP_MS);
    const task = await deps.findTask(target, isMp).catch(() => null);
    // 空 accept_status 视为「未登记」（上游同口径）。
    if (task && task.acceptStatus && task.acceptStatus !== 'not_accepted') return true;
    deps.log(`accept ${target} 尝试${attempt} 未登记生效（回读=${task ? task.acceptStatus || '空' : '查不到'}）`);
  }
  return false;
}

/**
 * 有界轮询等待达标（上游计分是**异步**的：事件上报后进度要数秒才刷新）。
 * 已达标立即返回；预算耗尽返回最后一次结果。
 */
async function findTaskWaiting(deps, code, isMp) {
  let task = await deps.findTask(code, isMp).catch(() => null);
  if (!task || task.claimable || task.claimed) return task;
  for (let i = 1; i < CLAIM_POLL_ATTEMPTS; i++) {
    await deps.sleep(CLAIM_POLL_GAP_MS);
    const next = await deps.findTask(code, isMp).catch(() => null);
    if (!next) continue; // 轮询期间查询失败不覆盖已拿到的结果
    task = next;
    if (task.claimable || task.claimed) return task;
  }
  return task;
}

/**
 * 构造执行上下文（依赖注入）。所有网络/时间/随机能力都可替换 ⇒ 回归测试零网络。
 */
function createRunner(params) {
  const p = params && typeof params === 'object' ? params : {};
  const options = p.options && typeof p.options === 'object' ? p.options : {};
  const token = p.token;
  const account = p.account && typeof p.account === 'object' ? p.account : {};
  const log = typeof p.log === 'function' ? p.log : () => {};
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

  const chatBase = resolveApiHost(options, p.chatBase, CN_BASES.chatBase);
  const webBase = resolveApiHost(options, p.webBase, CN_BASES.webBase);
  const billingBase = resolveApiHost(options, p.billingBase, CN_BASES.billingBase);
  const mpBase = resolveApiHost(options, p.mpBase, CN_BASES.mpBase);

  let convSeq = 0;
  const mkConvId = (tag, index) => {
    convSeq++;
    const suffix = typeof index === 'number' ? '-' + index : '';
    return `wd-${boundedText(tag, 16) || 'g'}-${now()}-${convSeq}${suffix}`;
  };

  const findTask = async (code, isMp) => {
    const rows = isMp ? await listTasksMp(token, account, mpBase, options) : await listTasks(token, account, chatBase, options);
    return rows.find((t) => t.taskCode === String(code || '').trim()) || null;
  };

  const ctx = {
    now: now,
    sleep: sleep,
    log: log,
    mkConvId: mkConvId,
    findTask: findTask,
    // 基址随 ctx 一起回传：编排层（runAutoRun）要直接复用，避免再算一次导致两边不一致。
    chatBase: chatBase,
    webBase: webBase,
    billingBase: billingBase,
    mpBase: mpBase,

    reportDesktopEvent: (events) => reportDesktopEvent(token, account, chatBase, events, options),
    reportWebEvent: (eventCode, pageUrl, elementId, elementName) =>
      reportWebEvent(token, account, webBase, eventCode, pageUrl, elementId, elementName, options),
    reportMpEvent: (events) => reportMpEvent(token, account, mpBase, events, options),
    reportChatActivity: (conv, req, modelId, modelName) =>
      reportChatActivity(token, account, billingBase, conv, req, modelId, modelName, options),
    realChat: (params2) => realChat(token, account, chatBase, params2, options),
    fetchMarketExperts: (type) => fetchMarketExperts(token, account, chatBase, type, options),
    setAppearanceTheme: (key) => setAppearanceTheme(token, account, chatBase, key, options),
    claimReward: (code, isMp) => (isMp
      ? claimRewardMp(token, account, mpBase, code, options)
      : claimReward(token, account, webBase, code, Object.assign({}, options, { chatBase: chatBase }))),
    buddyAgreement: () => buddyAgreement(token, account, chatBase, options),
    buddyFirst: () => buddyFirst(token, account, chatBase, options),
    acceptTasks: (codes) => acceptTasks(token, account, chatBase, codes, options),
    acceptTasksMp: (codes) => acceptTasksMp(token, account, mpBase, codes, options),

    /** 专家召唤+使用批处理（expert_5 / Expert_team_use_3 / Expert_lighthouse 共用）。 */
    runExpertBatch: async (expertType, count, extra) => {
      const opts = extra && typeof extra === 'object' ? extra : {};
      let experts = await fetchMarketExperts(token, account, chatBase, expertType, options);
      if (opts.requireId) {
        const hit = experts.find((e) => e.expertId === opts.requireId);
        experts = hit ? [hit] : [{ expertId: opts.requireId, expertType: 'agent', displayNameZh: '腾讯轻量云专家', professionZh: '腾讯轻量云专家', version: '1.0.2', category: 'expert-all' }];
      }
      if (!experts.length) throw new Error('专家市场列表为空');
      const picked = experts.slice(0, Math.max(1, count));
      let ok = 0;
      const failures = [];
      for (let i = 0; i < picked.length; i++) {
        const expert = picked[i];
        try {
          await reportDesktopEvent(token, account, chatBase, desktopExpertSummonSequence(expert), options);
          const chat = await realChat(token, account, chatBase, {
            model: MODEL_FAST, prompt: '1+1等于几？直接回答。', expertId: expert.expertId,
          }, options);
          const events = desktopChatSequence(chat.conversationId, chat.requestId, 'msg-' + chat.requestId.slice(-8), MODEL_FAST, MODEL_FAST, now());
          for (const ev of events) {
            if (ev.eventCode === 'agent_task_created') {
              ev.has_expert = true;
              ev.expert_id = expert.expertId;
              ev.expert_name = expert.displayNameZh;
              ev.expert_industry_id = '';
            }
          }
          const useEvent = desktopExpertActualUseEvent(expert, chat.conversationId, chat.requestId, opts.mode);
          if (opts.mode === 'LOCAL') { useEvent.type = ''; useEvent.cost = 0; }
          events.push(useEvent);
          await reportDesktopEvent(token, account, chatBase, events, options);
          ok++;
        } catch (error) {
          failures.push(`${expert.expertId}: ${String((error && error.message) || error)}`);
        }
        if (i < picked.length - 1) await sleep(6000); // 真实使用节奏
      }
      const tail = failures.length ? `；失败 ${failures.length} 个，原因 ${failures[0]}` : '';
      return `已完成专家召唤+使用链 ${ok}/${picked.length}${tail}`;
    },

    /** 小程序 mini chat 任务（school_season / Sequential_Tasks_1 共用）。 */
    runMpMiniChat: async (code, withActivityId) => {
      const task = await findTask(code, true);
      if (!task) return 'mp 口径未下发该任务（活动可能已结束）';
      if (task.claimed) return '已领取';
      if (!task.acceptStatus || task.acceptStatus === 'not_accepted') {
        const ok = await acceptWithVerify(
          { acceptTasks: ctx.acceptTasks, acceptTasksMp: ctx.acceptTasksMp, findTask: findTask, sleep: sleep, log: log },
          code, true
        );
        if (!ok) return 'accept 未登记生效（上游 200+OK 但未落账形态），待下次重试';
      }
      const target = task.target > 0 ? task.target : 1;
      if (task.current >= target || task.acceptStatus === 'completed') {
        const reward = await claimRewardMp(token, account, mpBase, code, options);
        return `已领取奖励 · 积分 +${reward.credit} · 能量 +${reward.energy}`;
      }
      const need = target - task.current;
      for (let i = 0; i < need; i++) {
        const conv = mkConvId('mp', i);
        const ev = withActivityId ? mpSchoolSeasonChatEvent(conv) : mpChatRequestSendEvent(conv);
        await reportMpEvent(token, account, mpBase, [ev], options);
        if (i < need - 1) await sleep(REPORT_GAP_MS);
      }
      // mp 口径用紧凑轮询（两轮各隔 CLAIM_POLL_GAP）。
      let after = task;
      for (let i = 0; i < 2; i++) {
        await sleep(CLAIM_POLL_GAP_MS);
        const next = await findTask(code, true).catch(() => null);
        if (!next) continue;
        after = next;
        if (after.claimable || after.claimed || after.current >= target) break;
      }
      if (after.claimed) return '本轮已入账（claimed）';
      if (after.current < target) {
        return `已补报但进度未达 · 次数 ${need} · 当前 ${after.current}/${target} · 异步计分未归账，下次重试`;
      }
      const reward = await claimRewardMp(token, account, mpBase, code, options);
      return `任务点亮并领取奖励 · 积分 +${reward.credit} · 能量 +${reward.energy}`;
    },
  };
  return ctx;
}

/**
 * 执行单个任务动作：幂等前置读取 → 动作 → 回读（有界轮询）→ 达标即自动领奖。
 * 单项失败只影响该项，不抛出（返回 status: 'error'）。
 */
async function runTaskAction(ctx, action, deps) {
  const isMp = isMpTaskCode(action.code);
  const result = { taskCode: action.code, tier: action.tier, desc: action.desc, attempt: action.attempt === true };

  let before = null;
  try {
    before = await ctx.findTask(action.code, isMp);
  } catch (error) {
    result.status = 'error';
    result.message = '查询失败: ' + String((error && error.message) || error);
    return result;
  }
  if (!before) {
    result.status = 'skipped';
    result.message = '该账号无此任务';
    return result;
  }
  if (before.claimed) {
    result.status = 'skipped';
    result.message = '已完成（claimed）';
    return result;
  }
  result.progressBefore = progressText(before);

  let message;
  try {
    message = await action.run(ctx);
  } catch (error) {
    result.status = 'error';
    result.message = String((error && error.message) || error);
    return result;
  }
  result.status = 'done';
  result.message = message;

  let after = null;
  try {
    after = isMp ? await ctx.findTask(action.code, true) : await findTaskWaiting(deps, action.code, false);
  } catch (_) { /* 回读失败不掩盖主流程结果 */ }
  if (!after) return result;
  result.progressAfter = progressText(after);
  result.claimable = after.claimable;

  if (after.claimable) {
    try {
      const reward = await ctx.claimReward(action.code, isMp);
      result.claimed = true;
      result.credit = reward.credit;
      result.energy = reward.energy;
      result.message = reward.credit > 0 || reward.energy > 0
        ? `${message} · 已自动领奖 · 积分 +${reward.credit} · 能量 +${reward.energy}`
        : `${message} · 奖励此前已领取`;
    } catch (error) {
      result.claimError = String((error && error.message) || error);
      result.message = `${message} · 达标但领奖失败（可手动重试）`;
    }
  }
  return result;
}

function progressText(task) {
  if (!task) return '?';
  if (task.target > 0) return `${task.current}/${task.target}`;
  if (task.claimed) return 'claimed';
  return task.acceptStatus || '?';
}

/**
 * 一键完成：扫描任务 → 按档位过滤 → 批量 accept → 逐项执行（单项失败不影响后续）。
 *
 * @param {Object} params { token, account, chatBase, webBase, billingBase, mpBase, options, log, includeTier3, onlyCodes }
 * @returns {Object} { results, plan, summary }
 */
async function runAutoRun(params) {
  const p = params && typeof params === 'object' ? params : {};
  const ctx = createRunner(p);
  const options = p.options && typeof p.options === 'object' ? p.options : {};
  const includeTier3 = p.includeTier3 === true;
  // 进度回调：可选。面板据此显示「3/8 正在跑 expert_5」，而不是一个 3 分钟的转圈。
  // 刻意吞掉回调自身的异常 —— 进度汇报失败不该把整轮任务带崩。
  const emit = (payload) => {
    if (typeof p.onProgress !== 'function') return;
    try { p.onProgress(payload); } catch (_) { /* 进度回调异常不上抛 */ }
  };

  const tasks = await listTasks(p.token, p.account, ctx.chatBase || p.chatBase, options).catch(() => []);
  const plan = planAutoRun(tasks, { includeTier3: includeTier3, onlyCodes: p.onlyCodes });
  const actions = buildTaskActions();
  const byCode = new Map(actions.map((a) => [a.code, a]));
  emit({ phase: 'planned', plan: plan });

  // 阶段 0：批量接受尚未接受的任务（失败不阻塞 —— 行为事件才是进度唯一判据）。
  const acceptCodes = [];
  for (const task of tasks) {
    if (task.claimed) continue;
    if (task.acceptStatus === 'accepted' || task.acceptStatus === 'completed') continue;
    const action = byCode.get(task.taskCode);
    if (!action) continue;
    if (action.tier === TIER_EVENT && !includeTier3) continue;
    if (!plan.run.some((r) => r.code === task.taskCode)) continue;
    acceptCodes.push(task.taskCode);
  }
  const results = [];
  if (acceptCodes.length) {
    try {
      await acceptTasks(p.token, p.account, ctx.chatBase || p.chatBase, acceptCodes, options);
      await ctx.sleep(REPORT_GAP_MS);
      results.push({ taskCode: '(批量接受)', status: 'done', message: `已接受任务 · ${acceptCodes.length}` });
    } catch (error) {
      results.push({ taskCode: '(批量接受)', status: 'error', message: '接受任务失败（不阻塞后续）: ' + String((error && error.message) || error) });
    }
  }

  const deps = {
    acceptTasks: (codes) => acceptTasks(p.token, p.account, ctx.chatBase || p.chatBase, codes, options),
    acceptTasksMp: (codes) => acceptTasksMp(p.token, p.account, ctx.mpBase || p.mpBase, codes, options),
    findTask: ctx.findTask,
    sleep: ctx.sleep,
    log: ctx.log,
  };

  for (const item of plan.run) {
    const action = byCode.get(item.code);
    if (!action) continue;
    emit({ phase: 'running', code: item.code, tier: item.tier, index: results.length + 1, total: plan.run.length });
    const result = await runTaskAction(ctx, action, deps);
    results.push(result);
    emit({ phase: 'item', progress: { index: results.length, total: plan.run.length }, result: result });
    await ctx.sleep(REPORT_GAP_MS); // 项间节流
  }

  const summary = {
    planned: plan.run.length,
    skipped: plan.skip.length,
    unknown: plan.unknown.length,
    manual: plan.manual.length,
    done: results.filter((r) => r.status === 'done').length,
    failed: results.filter((r) => r.status === 'error').length,
    claimed: results.filter((r) => r.claimed).length,
    credit: results.reduce((sum, r) => sum + (Number(r.credit) || 0), 0),
    energy: results.reduce((sum, r) => sum + (Number(r.energy) || 0), 0),
    includeTier3: includeTier3,
  };
  return { results: results, plan: plan, summary: summary };
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  // 档位
  TIER_REAL,
  TIER_SAFE,
  TIER_EVENT,
  // 通道基址（CN 口径，上游抓包实测）
  CN_BASES,
  // 常量（供面板展示与测试断言）
  REPORT_GAP_MS,
  CLAIM_POLL_ATTEMPTS,
  CLAIM_POLL_GAP_MS,
  ACCEPT_VERIFY_ATTEMPTS,
  MP_TASK_CODES,
  SCHOOL_OPEN_DAY_ACTIVITY_ID,
  BUDDY_APP_CARRIER,
  HP_APPEARANCE_THEME_KEY,
  LIBRARY_DOC_URL,
  MODEL_GLM52,
  MODEL_DEFAULT,
  REAL_REQUEST_ID_PATTERN,
  // L1 纯函数
  isMpTaskCode,
  inNightWindow,
  deriveId,
  desktopFingerprint,
  webFingerprint,
  mpFingerprint,
  assertFingerprintComplete,
  desktopChatSequence,
  desktopBuddyAppSequence,
  automationCreateEvent,
  desktopTemplateUseSequence,
  desktopPlaybookPromptSequence,
  desktopDesignCanvasSequence,
  normalizeExpert,
  desktopExpertSummonSequence,
  desktopExpertActualUseEvent,
  desktopSkillInfoEvent,
  chatRequestSendEvent,
  mpChatRequestSendEvent,
  mpSchoolSeasonChatEvent,
  normalizeTaskRow,
  readTaskState,
  extractRealRequestId,
  buildTaskActions,
  planAutoRun,
  taskActionIndex,
  progressText,
  // L2 客户端
  reportDesktopEvent,
  reportWebEvent,
  reportMpEvent,
  reportChatActivity,
  realChat,
  fetchMarketExperts,
  setAppearanceTheme,
  listTasks,
  listTasksMp,
  acceptTasks,
  acceptTasksMp,
  claimReward,
  claimRewardMp,
  buddyAgreement,
  buddyFirst,
  // L3 编排
  createRunner,
  acceptWithVerify,
  findTaskWaiting,
  runTaskAction,
  runAutoRun,
};
