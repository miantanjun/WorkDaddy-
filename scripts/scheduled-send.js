'use strict';

/*
 * 定时发送预输入命令 —— 「向导请求 → 标准自动化任务」的双向编译。
 *
 * 本模块**只做纯函数编译与校验，不依赖 daemon**，因此可以被测试直接 require。
 * 真正到点执行的调度、并发闸门、面板收起/还原全部复用现成的自动化引擎
 * （automation.js 的 createScheduleTicker + executeTask）。
 *
 * ── 任务形态（已有对话）────────────────────────────────────────────
 *   account.forEach { accounts:[uid], switch:true, steps:[
 *     session.open   { conversationId, timeoutMs }, // 先把目标会话选中（timeoutMs=90000：等加载）
 *     logic.delay    { ms:600 },                  // 等控制器就绪
 *     model.set      { modelId },                 // 可选；必须晚于 open
 *     session.send   { conversationId, message }  // 必须有匹配的 conversationId
 *   ]}
 *
 * ── 任务形态（新建对话）────────────────────────────────────────────
 *   account.forEach { accounts:[uid], switch:true, steps:[
 *     session.create { modelId?, message }        // 先落新建页 → 设模型 → 发送
 *   ]}
 *
 * 顺序不是随便定的：与 daemon.js runLimitFailoverCore 里已验证的
 * 「① 落点 → ② setModel → ③ sendPhrase」一致。原因：
 *   1) setLiveModel 作用在「当前选中的会话控制器」上，必须先选中目标会话；
 *   2) 新建会话必须先设模型再发第一条，否则首条用默认模型发出，选的型号形同虚设；
 *   3) session.send 会校验 detail.conversationId === 发送前读到的当前会话 id，
 *      所以 session.open 必须排在前面，这个校验才过得了。
 *
 * ── 命令正文为什么走 variables ─────────────────────────────────────
 * session.create / session.send 的整个 step 会经过 resolveValue()，其中的
 * message 字段会被当作模板插值：正文里若出现 {{xxx}} 会被替换（未知变量→空串）。
 * 因此正文一律写进 task.variables.__wbsMessage，步骤里只放 '{{vars.__wbsMessage}}'
 * —— resolveValue 命中「整串即一个变量」时直接返回该值，**不再二次解析**，
 * 正文得以逐字节原样送出。
 */

const MESSAGE_VAR = '__wbsMessage';
const MESSAGE_REF = '{{vars.' + MESSAGE_VAR + '}}';
const MARKER_KEY = 'workdaddyScheduledSend';
const NEW_CONVERSATION = 'new';
const MAX_MESSAGE = 50000;
const MAX_NAME = 120;
const MAX_TOKEN = 128;
const MAX_TITLE = 200;
const OPEN_SETTLE_MS = 600;
// session.open 的预算：WorkBuddy 侧「目标会话正在加载」时点击会被静默吞掉，
// 而加载慢时（源码注释：daemon 忙时可达 90s+）15 秒远远不够 —— 取 90 秒。
const OPEN_TIMEOUT_MS = 90000;
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return value == null ? '' : String(value); }
function safeId(value) { const s = text(value).trim(); return /^[A-Za-z0-9_-]{1,80}$/.test(s) ? s : ''; }

function requireToken(value, label) {
  const s = text(value).trim();
  if (!s) throw new Error('请选择' + label);
  if (s.length > MAX_TOKEN) throw new Error(label + '标识过长');
  if (/[\u0000-\u001f]/.test(s)) throw new Error(label + '标识含非法字符');
  return s;
}

function localSlot(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 校验并规约定时设置。镜像 automation.js 的 validateSchedule，但给出中文友好报错。 */
function normalizeSchedule(input) {
  const src = isPlainObject(input) ? input : {};
  const type = text(src.type || (text(src.at).trim() ? 'once' : '')).trim();
  if (!['interval', 'daily', 'weekly', 'monthly', 'once'].includes(type)) {
    throw new Error('触发方式只支持：指定时间一次、每天、每周、每月、按间隔');
  }
  const out = { type };
  if (type === 'interval') {
    const minutes = Number(src.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('定时间隔必须是 1–10080 分钟的整数');
    out.minutes = minutes;
  }
  if (type === 'once') {
    const at = text(src.at).trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new Error('请选择有效的执行日期和时间');
    const date = new Date(at);
    if (!Number.isFinite(date.getTime()) || localSlot(date) !== at) throw new Error('请选择有效的执行日期和时间');
    out.at = at;
  }
  if (['daily', 'weekly', 'monthly'].includes(type)) {
    const time = text(src.time).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效的执行时间');
    out.time = time;
  }
  if (type === 'weekly') {
    const days = Array.isArray(src.days)
      ? Array.from(new Set(src.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
      : [];
    if (!days.length) throw new Error('每周至少选择一个星期');
    out.days = days;
  }
  if (type === 'monthly') {
    const day = Number(src.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('每月日期必须是 1–31');
    out.day = day;
  }
  return out;
}

function describeSchedule(schedule) {
  const s = isPlainObject(schedule) ? schedule : {};
  if (s.type === 'interval') return '每 ' + s.minutes + ' 分钟';
  if (s.type === 'daily') return '每天 ' + s.time;
  if (s.type === 'weekly') {
    const days = (Array.isArray(s.days) ? s.days : []).map((d) => WEEK_LABELS[Number(d)] || '').filter(Boolean);
    return (days.length ? days.join('、') + ' ' : '') + s.time;
  }
  if (s.type === 'monthly') return '每月 ' + s.day + ' 日 ' + s.time;
  if (s.type === 'once') return '单次 ' + text(s.at).replace('T', ' ');
  return '未设定时';
}

function defaultName(message) {
  const firstLine = text(message).split('\n').map((line) => line.trim()).find(Boolean) || '';
  const short = firstLine.length > 36 ? firstLine.slice(0, 36) + '…' : firstLine;
  return short ? '定时发送 · ' + short : '定时发送';
}

/** 规约向导请求；任何缺项都以中文明确抛出，不静默兜底。 */
function normalizeRequest(input) {
  const src = isPlainObject(input) ? input : {};

  const message = text(src.message != null ? src.message : src.command).replace(/\r\n/g, '\n');
  if (!message.trim()) throw new Error('命令内容不能为空');
  if (message.length > MAX_MESSAGE) throw new Error('命令内容过长（上限 ' + MAX_MESSAGE + ' 字）');

  const accountUid = requireToken(src.accountUid, '账号');

  const conversationRaw = text(src.conversationId).trim();
  if (!conversationRaw) throw new Error('请选择要发送到的对话，或选择「新建对话」');
  const conversationId = conversationRaw === NEW_CONVERSATION ? NEW_CONVERSATION : requireToken(conversationRaw, '对话');

  const modelId = text(src.modelId).trim();
  if (modelId.length > MAX_TOKEN) throw new Error('模型标识过长，请重新选择模型');

  const idRaw = text(src.id).trim();
  if (idRaw && !safeId(idRaw)) throw new Error('任务标识无效');

  return {
    id: safeId(idRaw),
    name: (text(src.name).trim() || defaultName(message)).slice(0, MAX_NAME),
    message,
    accountUid,
    accountNickname: text(src.accountNickname).trim().slice(0, 80),
    conversationId,
    conversationTitle: text(src.conversationTitle).trim().slice(0, MAX_TITLE),
    modelId,
    schedule: normalizeSchedule(src.schedule),
  };
}

function describeRequest(request) {
  const r = isPlainObject(request) ? request : {};
  const where = r.conversationId === NEW_CONVERSATION
    ? '新建对话'
    : (r.conversationTitle ? '对话「' + r.conversationTitle + '」' : '指定对话');
  const who = r.accountNickname || r.accountUid || '指定账号';
  const model = r.modelId ? '模型 ' + r.modelId : '模型保持当前';
  return [describeSchedule(r.schedule), where, '账号 ' + who, model].join(' · ');
}

/** 把向导请求编译成标准自动化任务（可直接 POST /api/automations 或本地 validateTask）。 */
function buildTask(request, options) {
  const r = normalizeRequest(request);
  const opts = isPlainObject(options) ? options : {};
  const now = Number(opts.now) || Date.now();
  const id = r.id || ('task_sched_' + now.toString(36) + Math.random().toString(36).slice(2, 7));

  const messageStep = { message: MESSAGE_REF, saveAs: 'receipt' };
  const inner = r.conversationId === NEW_CONVERSATION
    ? [Object.assign({ op: 'session.create' }, messageStep, r.modelId ? { modelId: r.modelId } : {})]
    : []
      .concat([{ op: 'session.open', conversationId: r.conversationId, timeoutMs: OPEN_TIMEOUT_MS }])
      .concat([{ op: 'logic.delay', ms: OPEN_SETTLE_MS }])
      .concat(r.modelId ? [{ op: 'model.set', modelId: r.modelId }] : [])
      .concat([Object.assign({ op: 'session.send', conversationId: r.conversationId }, messageStep)]);

  return {
    schemaVersion: 1,
    id,
    name: r.name,
    description: describeRequest(r),
    enabled: true,
    trigger: { type: 'manual', oncePerNavigation: true },
    schedule: r.schedule,
    variables: { [MESSAGE_VAR]: r.message },
    meta: { [MARKER_KEY]: 1, request: Object.assign({}, r, { id }) },
    steps: [{ op: 'account.forEach', accounts: [r.accountUid], switch: true, steps: inner }],
    onSuccess: [],
    onFailure: [],
    updatedAt: now,
  };
}

function isScheduledSendTask(task) {
  return !!(isPlainObject(task) && isPlainObject(task.meta) && Number(task.meta[MARKER_KEY]) === 1);
}

function resolveMessageRef(value, variables) {
  const raw = text(value);
  if (raw === MESSAGE_REF) return text((isPlainObject(variables) ? variables : {})[MESSAGE_VAR]);
  return raw;
}

/** 结构兜底：连 meta.request 都没有（例如被上游同步覆盖过）时，从步骤里反读。 */
function readRequestFromSteps(task) {
  const steps = task && Array.isArray(task.steps) ? task.steps : null;
  if (!steps) return null;
  const loop = steps.find((step) => isPlainObject(step) && step.op === 'account.forEach');
  if (!loop) return null;
  const inner = Array.isArray(loop.steps) ? loop.steps : [];
  const create = inner.find((step) => isPlainObject(step) && step.op === 'session.create');
  const send = inner.find((step) => isPlainObject(step) && step.op === 'session.send');
  const open = inner.find((step) => isPlainObject(step) && step.op === 'session.open');
  const model = inner.find((step) => isPlainObject(step) && step.op === 'model.set');
  const source = create || send;
  if (!source) return null;
  return {
    accountUid: Array.isArray(loop.accounts) && loop.accounts.length === 1 ? text(loop.accounts[0]) : '',
    conversationId: create ? NEW_CONVERSATION : text(open && open.conversationId),
    message: resolveMessageRef(source.message, task.variables),
    modelId: text((create && create.modelId) || (model && model.modelId)),
  };
}

/** buildTask 的逆向：把已保存的任务还原成向导请求（供「重新编辑」用）。 */
function extractTask(task) {
  const src = isPlainObject(task) ? task : null;
  if (!src) return null;
  const meta = isPlainObject(src.meta) ? src.meta : {};
  const draft = isPlainObject(meta.request) ? Object.assign({}, meta.request) : readRequestFromSteps(src);
  if (!draft) return null;
  draft.id = text(src.id) || draft.id || '';
  draft.name = text(src.name) || draft.name || '';
  if (isPlainObject(src.schedule) && src.schedule.type) draft.schedule = src.schedule;
  try { return normalizeRequest(draft); } catch (_) { return null; }
}

module.exports = {
  MESSAGE_VAR,
  MESSAGE_REF,
  MARKER_KEY,
  NEW_CONVERSATION,
  MAX_MESSAGE,
  normalizeSchedule,
  describeSchedule,
  normalizeRequest,
  describeRequest,
  buildTask,
  isScheduledSendTask,
  extractTask,
};
