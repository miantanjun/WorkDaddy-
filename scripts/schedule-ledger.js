'use strict';
/**
 * 定时任务的「到底发出去没有」核验台账（2026-09-17）。
 *
 * 用户诉求（老叶 2026-09-17）：
 *   任务到点之后，隔一段时间去核验一次「这次到底触发了没有」，别再静默失败。
 *
 * 背景（为什么需要它，详见工作区《WorkDaddy-定时任务核验机制-设计与实现方案.md》）：
 *   现有 4 类静默失败 —— ① 派发后某步失败（本次事故）② 到点时 WorkBuddy 没开 ③ 到点时上一轮还在跑
 *   （代码顺序是「先烧 marks 再判 isRunning」⇒ 槽位白烧）④ 跑到一半进程没了。
 *   这 4 类都只留一行 daemon.log，而运行记录是**内存态**、只留 last-50 且会被每分钟的兜底任务挤掉，
 *   事后根本查不到。所以核验必须**落盘**。
 *
 * ⛔ 本模块最重要的一条约束（防重复触发）：
 *   **台账纯只读，绝不参与「这一轮该不该跑」的判断**。去重仍然只由 automation.js 里那份
 *   `automation-schedule-state.json`（marks）决定。核验不会调用任何发送路径、不会改写 marks。
 *   ⇒ 结构上不可能因为核验而重复触发。
 *
 * 判据（来自 daemon.js 的真实语义，不是猜的）：
 *   · ok        —— run 成功且拿到 userMessageId 回执（daemon.js:4570-4582 对「成功」的定义很严）
 *   · failed    —— run 失败；maybeSent=false 表示失败点在「点发送」之前（确定没发出去）
 *   · failed(maybeSent=true) —— 失败点在「已点发送、没等到回执」之后 ⇒ **结果不确定，绝不能重发**
 *                  （daemon.js:4570 原文：Do not retry an unconfirmed send）
 *   · pending   —— 登记了 expected 但进程没回填结果（跑到一半没了）
 *   · busy      —— 到点时上一次还在跑，槽位被跳过（没派发）
 *
 * 全部纯函数 + 注入 fs，可直接单测（见 .wd-analysis/test-schedule-verify.js）。
 */

const path = require('node:path');
const accountSwitchLog = require('./account-switch-log.js');

const LEDGER_VERSION = 1;
const LEDGER_FILE = 'automation-schedule-ledger.json';
/** 桌面报告：一天一个文件，只追加 */
const REPORT_PREFIX = 'WorkDaddy-定时任务核验-';
const REPORT_HEADER = [
  'WorkDaddy 定时任务核验日志',
  '任务到点之后会核验一次「到底发出去没有」，凡是「该发而没发成」的都在下面追加一段记录（只追加不覆盖）。',
  '只有「确实发出去了」的情况不写 —— 也就是：这里出现的每一条，都是需要你处理一次的。',
  '任务内容只记前 60 字摘要；一条任务的一个触发时刻只记一次，不会重复刷屏。',
].join('\n');

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 台账保留 7 天
const DEFAULT_MAX_SLOTS = 400;                        // 最多 400 个槽位
const MAX_OFFLINE_SCAN_MS = 24 * 60 * 60 * 1000;      // 离线补扫最多回溯 24 小时
const MAX_OFFLINE_ITERATIONS = 1500;                  // 24h × 60 = 1440，留点余量
const MIN_OFFLINE_GAP_MS = 90 * 1000;                 // 间隔小于 90 秒的「假离线」（重启抖动）不扫
const HEARTBEAT_WRITE_MS = 60 * 1000;                 // 心跳最多每分钟落盘一次
const NAME_LIMIT = 80;
const BODY_SNIPPET_CHARS = accountSwitchLog.SNIPPET_CHARS;

const NON_INTERVAL_TYPES = ['once', 'daily', 'weekly', 'monthly'];

function pad2(value) {
  return String(Math.abs(Math.trunc(Number(value) || 0))).padStart(2, '0');
}

/** 本地墙钟槽位串，格式与 automation.js 的 localScheduleSlot 完全一致（YYYY-MM-DDTHH:MM） */
function slotOfDate(date) {
  const d = date instanceof Date ? date : new Date(Number(date) || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 槽位串 → 毫秒（无时区后缀 = 本地时间，与 validateSchedule 的解析口径一致） */
function slotToMs(slot) {
  const text = String(slot || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return NaN;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function scheduleIsVerifiable(task) {
  const schedule = task && task.schedule;
  if (!schedule || typeof schedule !== 'object') return false;
  if (!NON_INTERVAL_TYPES.includes(schedule.type)) return false;   // manual / interval 不核验
  if (schedule.type === 'once') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(schedule.at || ''));
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(schedule.time || ''));
}

/**
 * 推算「窗口内本该到点的槽位」。
 * ⚠️ 只能用于**离线补扫**：它按任务**当前**的设定反推，用户中途改过时间时可能多报/漏报，
 *    因此报告文案必须写明「按任务现在的设定推算」。
 * interval 类型不参与（它的槽位是进程内相对时间，重启即重置，按墙钟推算必然误报）。
 */
function slotsBetween(task, fromMs, toMs) {
  if (!scheduleIsVerifiable(task)) return [];
  const from = Number(fromMs), to = Number(toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const schedule = task.schedule;
  if (schedule.type === 'once') {
    const ms = slotToMs(schedule.at);
    if (!Number.isFinite(ms)) return [];
    return ms > from && ms <= to ? [String(schedule.at)] : [];
  }
  const start = Math.max(from, to - MAX_OFFLINE_SCAN_MS);
  const time = String(schedule.time);
  const days = schedule.type === 'weekly' && Array.isArray(schedule.days) ? schedule.days : null;
  const dayOfMonth = schedule.type === 'monthly' ? Number(schedule.day) : null;
  const out = [];
  let cursor = Math.ceil(start / 60000) * 60000;
  for (let i = 0; i < MAX_OFFLINE_ITERATIONS && cursor <= to; i += 1, cursor += 60000) {
    const d = new Date(cursor);
    const slot = slotOfDate(d);
    if (slot.slice(11) !== time) continue;
    if (days && !days.includes(d.getDay())) continue;
    if (dayOfMonth != null && dayOfMonth !== d.getDate()) continue;
    if (cursor <= from) continue;
    out.push(slot);
  }
  return out;
}

/* ------------------------------ 台账结构 ------------------------------ */

function emptyLedger(now) {
  const at = Number(now) || Date.now();
  return { version: LEDGER_VERSION, createdAt: at, lastTickAt: at, lastWriteAt: at, entries: {} };
}

/** 坏数据一律收敛成空台账（绝不抛）——读盘失败不能拖挂 daemon */
function normalizeLedger(raw, now) {
  const at = Number(now) || Date.now();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!src) return emptyLedger(at);
  const entries = {};
  const rawEntries = src.entries && typeof src.entries === 'object' && !Array.isArray(src.entries) ? src.entries : {};
  for (const taskId of Object.keys(rawEntries)) {
    const bySlot = rawEntries[taskId];
    if (!bySlot || typeof bySlot !== 'object' || Array.isArray(bySlot)) continue;
    const kept = {};
    for (const slot of Object.keys(bySlot)) {
      const item = bySlot[slot];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (!Number.isFinite(slotToMs(slot))) continue;
      kept[slot] = {
        slot,
        expectedAt: Number(item.expectedAt) || slotToMs(slot),
        source: String(item.source || ''),
        name: String(item.name || '').slice(0, NAME_LIMIT),
        bodyBrief: String(item.bodyBrief || ''),
        status: LEDGER_STATUSES.includes(item.status) ? item.status : 'pending',
        runId: String(item.runId || ''),
        registeredAt: Number(item.registeredAt) || 0,
        finishedAt: Number(item.finishedAt) || 0,
        durationMs: Number(item.durationMs) || 0,
        error: String(item.error || '').slice(0, 400),
        messageId: String(item.messageId || ''),
        maybeSent: item.maybeSent === true,
        reportedAt: Number(item.reportedAt) || 0,
        reportKind: String(item.reportKind || ''),
      };
    }
    if (Object.keys(kept).length) entries[taskId] = kept;
  }
  return {
    version: LEDGER_VERSION,
    createdAt: Number(src.createdAt) || at,
    lastTickAt: Number(src.lastTickAt) || Number(src.createdAt) || at,
    // ⚠️ 白名单实现：新增字段必须在这里补一行，否则写进去读回来就被丢掉
    // （2026-09-17 实测：lastWriteAt 漏了这一步，心跳判据就永远退化成 lastTickAt）。
    lastWriteAt: Number(src.lastWriteAt) || Number(src.lastTickAt) || Number(src.createdAt) || at,
    entries,
  };
}

function readLedger(dir, options) {
  const opts = options || {};
  const io = opts.fsImpl || require('node:fs');
  const now = Number(opts.now) || Date.now();
  const base = String(dir || '').trim();
  if (!base) return emptyLedger(now);
  try {
    const text = io.readFileSync(path.join(base, LEDGER_FILE), 'utf8');
    return normalizeLedger(JSON.parse(text), now);
  } catch (_) {
    return emptyLedger(now);
  }
}

/** 台账文件在不在（冷启动判断：不在就先落一次盘把 createdAt 锚住，见 daemon 启动段） */
function ledgerFileExists(dir, options) {
  const opts = options || {};
  const io = opts.fsImpl || require('node:fs');
  const base = String(dir || '').trim();
  if (!base) return false;
  try { return io.existsSync(path.join(base, LEDGER_FILE)); } catch (_) { return false; }
}

/**
 * 原子写（调用方传 atomicWriteText；没传就用 writeFileSync 兜底），返回是否成功。
 * **只有这一次真的写成功了才推进 `lastWriteAt`** —— 它是心跳「该不该落盘」的唯一判据
 * （`lastTickAt` 每拍都更新，拿它当判据会让心跳永远到不了阈值，见 heartbeat 注释）。
 * `options.now` 可注入（单测拿合成时钟跑心跳节奏时要和 heartbeat 用同一个时钟）。
 */
function writeLedger(dir, ledger, options) {
  const opts = options || {};
  const io = opts.fsImpl || require('node:fs');
  const base = String(dir || '').trim();
  if (!base) return false;
  const file = path.join(base, LEDGER_FILE);
  const at = Number(opts.now) || Date.now();
  const prevWriteAt = ledger && typeof ledger === 'object' ? ledger.lastWriteAt : 0;
  if (ledger && typeof ledger === 'object') ledger.lastWriteAt = at;
  try {
    const text = JSON.stringify(ledger) + '\n';
    if (typeof opts.atomicWriteText === 'function') opts.atomicWriteText(file, text);
    else io.writeFileSync(file, text, 'utf8');
    return true;
  } catch (_) {
    // 没写成功就别认领这次落盘，否则要白等一个心跳周期才会重试
    if (ledger && typeof ledger === 'object') ledger.lastWriteAt = prevWriteAt;
    return false;
  }
}

function ensureBucket(ledger, taskId) {
  const id = String(taskId || '');
  if (!id) return null;
  if (!ledger.entries[id]) ledger.entries[id] = {};
  return ledger.entries[id];
}

function entryOf(ledger, taskId, slot) {
  const bucket = ledger.entries[String(taskId || '')];
  if (!bucket) return null;
  return bucket[String(slot || '')] || null;
}

/* ------------------------------ 状态机 ------------------------------ */

/**
 * 槽位命中时登记（**必须早于派发**，这样中途没了也能留下痕迹）。
 * 同一个槽位重复登记只补字段、不新增记录（防重复的第一道闸）。
 * @param {object} p {taskId, slot, source, name, bodyBrief, dispatched, runId, now}
 */
function recordExpected(ledger, p) {
  const d = p || {};
  const slot = String(d.slot || '').trim();
  const ms = slotToMs(slot);
  if (!ledger || !d.taskId || !Number.isFinite(ms)) return null;
  const bucket = ensureBucket(ledger, d.taskId);
  if (!bucket) return null;
  const existing = bucket[slot];
  const status = d.dispatched === false ? 'busy' : 'pending';
  if (existing) {
    // 已终态的槽位不再被重复登记改写（一次槽位只有一次结果）
    if (existing.status === 'ok' || existing.status === 'failed') return existing;
    if (d.dispatched !== false) existing.status = 'pending';
    if (d.runId) existing.runId = String(d.runId);
    return existing;
  }
  const entry = {
    slot,
    expectedAt: ms,
    source: String(d.source || ''),
    name: String(d.name || '').slice(0, NAME_LIMIT),
    bodyBrief: String(d.bodyBrief || ''),
    status,
    runId: String(d.runId || ''),
    registeredAt: Number(d.now) || Date.now(),
    finishedAt: 0,
    durationMs: 0,
    error: '',
    messageId: '',
    maybeSent: false,
    reportedAt: 0,
    reportKind: '',
  };
  bucket[slot] = entry;
  return entry;
}

/**
 * 运行结束后回填结果。**只有登记过的槽位才回填**（没登记说明不是本次核验关心的槽位）。
 * @param {object} p {taskId, slot, status:'ok'|'failed', error, messageId, maybeSent, runId, now, startedAt}
 */
function recordOutcome(ledger, p) {
  const d = p || {};
  const entry = entryOf(ledger, d.taskId, d.slot);
  if (!entry) return null;
  if (entry.status === 'ok') return entry;             // 成功是终局证据，不被后来的回填写反
  entry.status = d.status === 'ok' ? 'ok' : 'failed';
  entry.error = String(d.error || '').slice(0, 400);
  entry.messageId = String(d.messageId || '');
  entry.maybeSent = d.maybeSent === true;
  if (d.runId) entry.runId = String(d.runId);
  entry.finishedAt = Number(d.now) || Date.now();
  const started = Number(d.startedAt) || entry.registeredAt;
  entry.durationMs = entry.finishedAt - started > 0 ? entry.finishedAt - started : 0;
  return entry;
}

/**
 * 心跳：返回 true 表示「该落盘了」（最多每分钟一次）。
 *
 * ⚠️ 判据必须是 **`lastWriteAt`**（只在 writeLedger 真的写成功后才推进），
 *    **绝不能拿 `lastTickAt` 当基准** —— 后者每拍都更新，只要拍子周期 < HEARTBEAT_WRITE_MS
 *    就永远够不到阈值，心跳会变成一条死路。
 *    2026-09-17 实测（当时用 lastTickAt）：daemon 的 30s 拍子连调 40 次 → 落盘 **0** 次；
 *    改成 60s 拍子 → 39 次。台账文件因此从来不生成，冷启动的 createdAt 也永远锚不住。
 */
function heartbeat(ledger, now) {
  const at = Number(now) || Date.now();
  if (!ledger) return false;
  const last = Number(ledger.lastWriteAt) || Number(ledger.lastTickAt) || Number(ledger.createdAt) || 0;
  ledger.lastTickAt = at;
  return at - last >= HEARTBEAT_WRITE_MS;
}

/**
 * 待核验条目：状态还没到「成功」，且过了宽限期，且还没上报过。
 * ⚠️ `isRunning(taskId)` 为 true 时不判 —— 任务还在跑，不是「没跑完」。
 * @param {object} options {graceMs, isRunning, now}
 */
function dueEntries(ledger, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const graceMs = Number.isFinite(Number(opts.graceMs)) ? Number(opts.graceMs) : 60000;
  const isRunning = typeof opts.isRunning === 'function' ? opts.isRunning : () => false;
  const out = [];
  if (!ledger || !ledger.entries) return out;
  for (const taskId of Object.keys(ledger.entries)) {
    if (isRunning(taskId)) continue;
    for (const slot of Object.keys(ledger.entries[taskId])) {
      const entry = ledger.entries[taskId][slot];
      if (entry.status === 'ok') continue;
      if (entry.reportedAt) continue;
      if (!(entry.expectedAt + graceMs <= now)) continue;
      out.push({ taskId, ...entry });
    }
  }
  return out.sort((a, b) => a.expectedAt - b.expectedAt);
}

/**
 * 离线补扫：心跳到现在这段窗口里「本该到点但连登记都没有」的槽位（WorkBuddy 当时没开）。
 * ⚠️ 只对「台账建立之后」的槽位负责 ⇒ 功能上线当天不会把历史任务全报一遍。
 * @param {object} options {now, graceMs, scanMs}
 */
function offlineMisses(ledger, tasks, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const graceMs = Number.isFinite(Number(opts.graceMs)) ? Number(opts.graceMs) : 60000;
  const out = [];
  if (!ledger || !Array.isArray(tasks)) return out;
  // fromMs：调用方（daemon 启动那一拍）显式传「上次还活着的时刻」——
  // 不能依赖 ledger.lastTickAt，因为心跳一拍就可能把它覆盖掉。
  const from = Number(opts.fromMs) || Number(ledger.lastTickAt) || Number(ledger.createdAt) || 0;
  if (!from || now - from < MIN_OFFLINE_GAP_MS) return out;
  const horizon = Math.max(from, Number(ledger.createdAt) || 0);
  const until = now - graceMs;
  if (until <= horizon) return out;
  for (const task of tasks) {
    if (!task || !task.id || task.enabled === false) continue;
    if (!scheduleIsVerifiable(task)) continue;
    const bucket = ledger.entries[task.id] || {};
    const slots = slotsBetween(task, horizon, until);
    const missed = slots.filter((slot) => !bucket[slot] && slotToMs(slot) >= horizon);
    if (!missed.length) continue;
    // 一个任务最多列 3 个，其余折成一句话（避免离线一周刷满屏）
    const shown = missed.slice(-3);
    out.push({
      taskId: task.id,
      name: String(task.name || ''),
      bodyBrief: bodySnippetOf(task),
      kind: 'offline',
      status: 'missed',
      offlineFrom: from,
      offlineTo: now,
      slots: shown,
      totalSlots: missed.length,
      expectedAt: slotToMs(shown[0]),
      slot: shown[shown.length - 1],
    });
  }
  return out;
}

/* ------------------------------ 报告文案 ------------------------------ */

function bodySnippetOf(task) {
  try {
    const vars = task && task.variables && typeof task.variables === 'object' ? task.variables : {};
    const raw = vars.__wbsMessage || vars.message || '';
    const brief = accountSwitchLog.snippet(raw, BODY_SNIPPET_CHARS);
    if (brief) return brief;
    const desc = String(task && task.description || '');
    return accountSwitchLog.snippet(desc.replace(/^[^·]*·\s*/, ''), BODY_SNIPPET_CHARS);
  } catch (_) {
    return '';
  }
}

function taskLabel(taskId, name) {
  const id = String(taskId || '');
  const shortId = id.length > 16 ? id.slice(0, 16) + '…' : id;
  const label = String(name || '').trim();
  return label ? label + '（' + shortId + '）' : (shortId || '未知任务');
}

const line = (label, text) => '· ' + label + '：' + text;
const RULE = '────────────────────────────────────────';
const LEDGER_STATUSES = ['pending', 'ok', 'failed', 'busy', 'missing'];

/** 补发指引：带 schedule 的任务在面板里点不了「立即运行」，必须走向导（别写错） */
const RERUN_HINT = '打开 WorkDaddy 面板 → 工具栏「定时发送」→ 按原样再排一次（想马上发就把时间改到最近的整分）。' +
  '注意：带定时的任务不能在面板里点「立即运行」，那是给手动任务用的。';

function describeMiss(item) {
  const d = item || {};
  const kind = String(d.kind || '');
  const out = [];
  if (kind === 'busy') {
    out.push(line('实际结果', '到点的时候，这条任务的上一次还在跑 —— 这一轮被跳过了（不会排队、也不会补跑）。'));
    out.push(line('为什么', '调度器为了保证「同一个时刻只跑一次」，会先把这一分钟标记成已触发，然后才发现上一次没结束。'));
    out.push(line('怎么办', '如果这条命令不能少，把触发时间往后挪开一点，或者缩短上一次的执行时间。'));
    return out;
  }
  if (kind === 'offline') {
    const slots = Array.isArray(d.slots) ? d.slots : [];
    const times = slots.map((s) => String(s).replace('T', ' ')).join('、');
    out.push(line('实际结果', '这些时刻 WorkBuddy 没在运行，任务根本没有触发（错过的时刻不会自动补跑）。'));
    out.push(line('本该到点', times + (Number(d.totalSlots) > slots.length ? '（更早的还有 ' + (Number(d.totalSlots) - slots.length) + ' 次）' : '')));
    if (d.offlineFrom) {
      out.push(line('离线窗口', accountSwitchLog.formatClock(d.offlineFrom) + ' → ' + accountSwitchLog.formatClock(d.offlineTo) +
        '（间隔 ' + accountSwitchLog.formatDuration(d.offlineTo - d.offlineFrom) + '）'));
    }
    out.push(line('说明', '这些时刻是按任务**现在的设定**推算出来的；如果你中途改过时间，可能和当时的设定不完全一致。'));
    out.push(line('要补发', RERUN_HINT));
    return out;
  }
  if (d.status === 'pending') {
    out.push(line('实际结果', '任务启动了，但没跑完 —— WorkBuddy 中途重启或退出了，结果未知。'));
    out.push(line('⚠️ 注意', '这条消息**可能已经发出去了**，也可能完全没发。先打开目标会话看一眼，再决定要不要补发。'));
    return out;
  }
  // failed
  if (d.maybeSent === true) {
    out.push(line('实际结果', '已经点了发送，但没等到会话回执就失败了 —— **结果不确定**。'));
    out.push(line('⚠️ 注意', '这条消息**可能已经发出去了**。先打开目标会话看一眼，确认没发出去再补发，别直接重发。'));
  } else {
    out.push(line('实际结果', '没发出去 —— 失败发生在发送链路的前半段（还没走到点发送那一步）。'));
  }
  if (d.error) out.push(line('卡在哪', String(d.error).slice(0, 200)));
  if (!d.maybeSent) out.push(line('要补发', '先扫一眼目标会话确认没发出去，再' + RERUN_HINT));
  return out;
}

const KIND_TITLE = {
  'not-sent': '定时任务没有发出去',
  unknown: '定时任务结果不确定（可能已发出）',
  interrupted: '定时任务没跑完（结果未知）',
  busy: '定时任务被跳过（上一次还在跑）',
  offline: '定时任务错过了触发时刻（当时没在运行）',
};

function kindOf(item) {
  if (item.kind === 'offline' || item.kind === 'busy') return item.kind;
  if (item.status === 'busy') return 'busy';
  if (item.status === 'pending') return 'interrupted';
  return item.maybeSent === true ? 'unknown' : 'not-sent';
}

/**
 * 把一拍里发现的所有问题渲染成一段桌面人话报告。
 * @param {Array} items dueEntries()/offlineMisses() 的产出
 * @param {object} options {now, taskNameOf(taskId)}
 */
function buildMissReport(items, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const taskNameOf = typeof opts.taskNameOf === 'function' ? opts.taskNameOf : () => '';
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '';
  const blocks = list.map((item) => {
    const kind = kindOf(item);
    const name = taskNameOf(item.taskId) || item.name || '';
    const head = [RULE, '【' + accountSwitchLog.formatClock(item.expectedAt || now) + '】' + (KIND_TITLE[kind] || '定时任务异常'), ''];
    head.push(line('哪条任务', taskLabel(item.taskId, name)));
    const brief = item.bodyBrief || '';
    if (brief) head.push(line('发的是什么', '“' + brief + '”'));
    if (kind === 'offline') {
      head.push(...describeMiss({ ...item, kind: 'offline' }));
    } else {
      const when = item.expectedAt ? accountSwitchLog.formatClock(item.expectedAt) : '未知时刻';
      head.push(line('本来该在', when + (item.source ? '（触发方式：' + item.source + '）' : '')));
      head.push(...describeMiss({ ...item, kind }));
    }
    return head.join('\n') + '\n';
  });
  return blocks.join('');
}

/** 桌面报告落盘（复用账号切换日志那套：一天一个文件、BOM + 说明头、CRLF、只追加） */
function writeReport(options) {
  const opts = options || {};
  return accountSwitchLog.appendNamedReport({
    dir: String(opts.dir || '').trim(),
    at: Number(opts.at) || Date.now(),
    text: String(opts.text || ''),
    fsImpl: opts.fsImpl,
    prefix: REPORT_PREFIX,
    header: REPORT_HEADER,
  });
}

/** 桌面目录（桌面可能被 OneDrive 接管，复用同一份候选逻辑） */
function resolveReportDir(options) {
  const opts = options || {};
  return accountSwitchLog.resolveLogDir({
    env: opts.env || process.env,
    existsSync: typeof opts.existsSync === 'function' ? opts.existsSync : require('node:fs').existsSync,
    fallbackDir: opts.fallbackDir,
  });
}

/** 弹窗文案（一条，几秒）——比桌面报告短，只说「有几条、去看哪个文件」 */
function buildToast(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '';
  const first = list[0];
  const name = String(first.name || first.taskId || '').slice(0, 24);
  const when = first.expectedAt ? String(accountSwitchLog.formatClock(first.expectedAt)).slice(11, 16) : '';
  const tail = list.length > 1 ? '（另有 ' + (list.length - 1) + ' 条）' : '';
  return '定时任务「' + name + '」' + (when ? when + ' ' : '') + '没发出去' + tail +
    '，详见桌面「WorkDaddy-定时任务核验」日志。';
}

/* ------------------------------ 上报与裁剪 ------------------------------ */

/**
 * 标记已上报（第二次闸：同一槽位只报一次，重启也不重报）。
 * @param {Array} items [{taskId, slot, kind}]
 */
function markReported(ledger, items, options) {
  const opts = options || {};
  const at = Number(opts.now) || Date.now();
  const kind = String(opts.kind || 'miss');
  const list = Array.isArray(items) ? items : [];
  let n = 0;
  for (const item of list) {
    if (!item || !item.taskId) continue;
    if (item.kind === 'offline') {
      // 离线错过的槽位当时根本没登记：按「已上报」补一条占位，避免下次启动重报
      for (const slot of (Array.isArray(item.slots) ? item.slots : [])) {
        const bucket = ensureBucket(ledger, item.taskId);
        if (!bucket || bucket[slot]) continue;
        bucket[slot] = {
          slot,
          expectedAt: slotToMs(slot),
          source: 'offline',
          name: String(item.name || '').slice(0, NAME_LIMIT),
          bodyBrief: String(item.bodyBrief || ''),
          status: 'missing',
          runId: '',
          registeredAt: at,
          finishedAt: at,
          durationMs: 0,
          error: '',
          messageId: '',
          maybeSent: false,
          reportedAt: at,
          reportKind: kind,
        };
        n += 1;
      }
      continue;
    }
    const entry = entryOf(ledger, item.taskId, item.slot);
    if (!entry || entry.reportedAt) continue;
    entry.reportedAt = at;
    entry.reportKind = kind;
    n += 1;
  }
  return n;
}

/**
 * 裁旧。两条口径（别搞混）：
 *   · **按时间**：超过 maxAgeMs（默认 7 天）的一律裁掉 —— 包括没上报的。
 *     不这么做的话，任务被删/被停用留下的未上报条目会无限堆积，台账文件只会越来越大。
 *   · **按条数**：超过 maxSlots 时**优先裁最旧的「已上报」条目**，未上报的排最后（尽量让问题先被看到）。
 * @param {object} options {now, maxAgeMs, maxSlots}
 */
function trimLedger(ledger, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const maxAgeMs = Number.isFinite(Number(opts.maxAgeMs)) ? Number(opts.maxAgeMs) : DEFAULT_MAX_AGE_MS;
  const maxSlots = Number.isFinite(Number(opts.maxSlots)) ? Number(opts.maxSlots) : DEFAULT_MAX_SLOTS;
  if (!ledger || !ledger.entries) return 0;
  let removed = 0;
  const flat = [];
  for (const taskId of Object.keys(ledger.entries)) {
    const bucket = ledger.entries[taskId];
    for (const slot of Object.keys(bucket)) {
      const entry = bucket[slot];
      // status 'missing' 是「离线错过」的占位，没有 expected 语义差别，一样按时间裁
      if (entry.expectedAt + maxAgeMs < now) {
        delete bucket[slot];
        removed += 1;
        continue;
      }
      flat.push({ taskId, slot, entry });
    }
    if (!Object.keys(bucket).length) delete ledger.entries[taskId];
  }
  const total = flat.length - removed;
  if (total > maxSlots) {
    const droppable = flat
      .filter((x) => x.entry.reportedAt && (ledger.entries[x.taskId] || {})[x.slot])
      .sort((a, b) => a.entry.expectedAt - b.entry.expectedAt);
    let over = total - maxSlots;
    for (const item of droppable) {
      if (over <= 0) break;
      delete ledger.entries[item.taskId][item.slot];
      if (!Object.keys(ledger.entries[item.taskId]).length) delete ledger.entries[item.taskId];
      over -= 1;
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  LEDGER_VERSION,
  LEDGER_FILE,
  REPORT_PREFIX,
  REPORT_HEADER,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_SLOTS,
  MIN_OFFLINE_GAP_MS,
  HEARTBEAT_WRITE_MS,
  MAX_OFFLINE_SCAN_MS,
  RERUN_HINT,
  pad2,
  slotOfDate,
  slotToMs,
  scheduleIsVerifiable,
  slotsBetween,
  emptyLedger,
  normalizeLedger,
  readLedger,
  ledgerFileExists,
  writeLedger,
  entryOf,
  recordExpected,
  recordOutcome,
  heartbeat,
  dueEntries,
  offlineMisses,
  bodySnippetOf,
  taskLabel,
  kindOf,
  buildMissReport,
  buildToast,
  writeReport,
  resolveReportDir,
  markReported,
  trimLedger,
};
