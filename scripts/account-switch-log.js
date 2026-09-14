'use strict';
/**
 * 账号切换的桌面大白话日志（限流切号 + 闲置切回共用一份）。
 *
 * 用户诉求：
 *   1) 2026-09-14：每次触发「模型限流 → 自动换账号续跑」都要在桌面留一份**人话**报告；
 *   2) 2026-09-14 追加：非主账号闲置超阈值自动切回主账号时，也写进同一份日志。
 *
 * 设计要点：
 *   · 一天一个文件：`WorkDaddy-账号切换日志-YYYY-MM-DD.txt`，**只追加**，绝不覆盖
 *   · 首次创建时带 UTF-8 BOM + 一段说明头，记事本打开中文不乱码
 *   · 桌面是明文：账号只写「昵称（uid 前 8 位）」，任务内容只写前 N 字摘要
 *   · 文本一律 LF 内部表示，落盘时统一转 CRLF（记事本友好）
 *   · 全是纯函数 / 可注入 fs，方便单测（见 .wd-analysis/test-limit-switchback.js）
 */

const fsDefault = require('node:fs');
const path = require('node:path');

const LOG_PREFIX = 'WorkDaddy-账号切换日志-';
const LOG_SUFFIX = '.txt';
const SNIPPET_CHARS = 60;
const RULE = '────────────────────────────────────────';

const FILE_HEADER = [
  'WorkDaddy 账号切换日志',
  '自动切换账号时都会在下面追加一段记录（只追加不覆盖），两种来源：',
  '  ① 模型限流 → 自动换账号续跑；② 非主账号闲置超时 → 自动切回主账号。',
  '任务内容只记前 ' + SNIPPET_CHARS + ' 字摘要；账号只写昵称和 uid 前 8 位。',
  '只记「真的动了账号」的结果，纯粹的「条件不满足所以没动」不写（避免刷屏）。',
].join('\n');   // 末尾刻意不加分隔线：每段报告自带一条，否则会出现连续两条

function pad2(value) {
  return String(Math.abs(Math.trunc(Number(value) || 0))).padStart(2, '0');
}

/** 2026-09-14 19:32:11（本地时区） */
function formatClock(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (Number.isNaN(d.getTime())) return '时间未知';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/** 8 分 52 秒 / 42 秒 / 5 分钟（整分钟不啰嗦成「5 分 0 秒」）/ 1 小时 3 分 */
function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total < 60) return total + ' 秒';
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? minutes + ' 分钟' : minutes + ' 分 ' + seconds + ' 秒';
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (restMinutes === 0) return seconds === 0 ? hours + ' 小时' : hours + ' 小时 ' + seconds + ' 秒';
  return hours + ' 小时 ' + restMinutes + ' 分';
}

/** 把任务内容压成一行摘要：塌掉空白 + 截断，避免把整段提示词倒进桌面明文 */
function snippet(text, limit) {
  const cap = Math.max(1, Number(limit) || SNIPPET_CHARS);
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > cap ? flat.slice(0, cap) + '…' : flat;
}

/** 面瘫君（1d80c722）—— 昵称优先，uid 只留前 8 位 */
function accountLabel(uid, nickname) {
  const id = String(uid || '').trim();
  const name = String(nickname || '').trim();
  const shortId = id ? id.slice(0, 8) : '';
  if (name && shortId) return name + '（' + shortId + '）';
  if (name) return name;
  if (shortId) return '账号 ' + shortId;
  return '未知账号';
}

function logFileName(ts) {
  const d = new Date(Number(ts) || Date.now());
  const date = Number.isNaN(d.getTime())
    ? 'unknown'
    : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  return LOG_PREFIX + date + LOG_SUFFIX;
}

/**
 * 桌面目录候选（按出现概率排序）。Windows 上桌面可能被 OneDrive 接管，
 * 所以不能只写 `%USERPROFILE%\Desktop`。
 */
function desktopCandidates(env) {
  const e = env || {};
  const list = [];
  const home = String(e.USERPROFILE || '').trim();
  if (home) {
    list.push(path.join(home, 'Desktop'));
    list.push(path.join(home, 'OneDrive', 'Desktop'));
  }
  const oneDrive = String(e.OneDrive || '').trim();
  if (oneDrive) list.push(path.join(oneDrive, 'Desktop'));
  if (home) list.push(path.join(home, 'OneDrive - Personal', 'Desktop'));
  return list;
}

/** 返回第一个真实存在的候选目录；都不存在时回落 fallbackDir（调用方传 DATA_DIR） */
function resolveLogDir(options) {
  const opts = options || {};
  const existsSync = typeof opts.existsSync === 'function' ? opts.existsSync : () => false;
  const candidates = desktopCandidates(opts.env);
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      if (existsSync(candidates[i])) return candidates[i];
    } catch (_) { /* 单个候选探测失败就继续下一个 */ }
  }
  return String(opts.fallbackDir || '').trim();
}

function line(label, text) {
  return '· ' + label + '：' + text;
}

// 切号完成后一定会顺带做的事：把**源账号**里开了「自动复制」的会话同步到新账号。
// 两种情况都要写清楚 —— 用户会问「切完为什么数据没动」，答案要么是「同步了 N 个」，要么是「本来就没有」。
function autoCopyLine(outcome, fromLabel) {
  const copy = outcome && outcome.autoCopy;
  if (copy && Number(copy.total) > 0) {
    return line('顺带做了', '把账号「' + fromLabel + '」里开启了「自动复制」的会话同步到主账号，共 ' +
      Number(copy.total) + ' 个（后台排队复制，可在「会话」页看进度）。');
  }
  return line('顺带做了', '账号「' + fromLabel + '」没有开启「自动复制」的会话，没有需要同步的内容。');
}

/**
 * 触发段（交接成功）。
 * @param {object} t {at, fromUid, fromNickname, toUid, toNickname, modelId, taskSource, taskText, triedCount}
 */
/** 降级原因 → 人话（副本续跑没走成时，日志里要说明白为什么） */
const SURFACE_REASONS = {
  'no-source-session': '读不到被限流的那条会话',
  'no-lineage': '那条会话没有开启「自动复制」',
  'no-target': '没找到可接管的账号',
  'same-account': '接管的就是原账号',
  'sync-timeout': '等会话同步超时了',
  'copy-settled-without-copy': '同步任务结束了，但没等到这份会话的副本',
  'open-failed': '没能在界面上打开那份会话副本',
  'cdp-offline': '界面暂时连不上',
  'prepare-error': '准备过程中出错',
  'bad-surface': '准备过程中出错',
  'unavailable': '副本还没就绪',
};

/** 触发段（交接成功）。surface = 副本续跑的结果（existing=在原会话里继续 / new=降级新建任务） */
function buildTriggerReport(t) {
  const d = t || {};
  const out = [RULE, '【' + formatClock(d.at) + '】模型限流 → 自动换账号续跑', ''];
  const surface = d.surface && typeof d.surface === 'object' ? d.surface : null;
  const existing = !!surface && surface.mode === 'existing';
  out.push(line('什么情况', '账号「' + accountLabel(d.fromUid, d.fromNickname) + '」被限流了 —— WorkBuddy 在输入框上方弹出了限流提示。'));
  out.push(line('怎么处理', '自动切到账号「' + accountLabel(d.toUid, d.toNickname) + '」' +
    (d.modelId ? '，模型保持不变（' + d.modelId + '）' : '（模型沿用切换前的）') + '。'));
  const brief = snippet(d.taskText, SNIPPET_CHARS);
  if (brief) {
    out.push(line('任务内容', (d.taskSource === 'prompt' ? '任务变量里指定的内容 —— ' : '上一条消息 —— ') + '“' + brief + '”'));
  }
  if (existing) {
    out.push(line('续跑方式', '先等会话同步过去，再在原会话的副本里继续（等了 ' +
      formatDuration(Number(surface.waitedMs) || 0) + '）—— 上下文都在，没有开新任务。'));
  } else {
    const reason = String(surface && surface.reason || '');
    out.push(line('续跑方式', '新建了一个任务把内容重发一遍（原会话的副本没就绪：' +
      (SURFACE_REASONS[reason] || reason || '未知') + '）—— 上下文带不过去，这条任务的名字会和原来那条不一样。'));
  }
  const tried = Number(d.triedCount) || 1;
  out.push(line('结果', '新账号已经接手，任务在那边继续跑' + (tried > 1 ? '（试了 ' + tried + ' 个账号才成功）' : '') + '。'));
  out.push(line('接下来', '等这次续跑跑完，会自动把账号切回主账号。'));
  return out.join('\n') + '\n';
}

const FAILURE_REASONS = {
  'no-task-text': '当前会话里没有可以重发的用户消息（可能是刚新建的空会话）。',
  'no-usable-target': '其他账号都没能顶上来 —— 要么也在限流窗口里，要么 20 秒内没看到正常回复。',
};

/**
 * 失败段（触发了一次，但没换成号）。reason 见 FAILURE_REASONS，未收录的原样展示。
 * @param {object} f {at, fromUid, fromNickname, reason, error, triedLabels, noTaskText}
 */
function buildFailureReport(f) {
  const d = f || {};
  const out = [RULE, '【' + formatClock(d.at) + '】模型限流，但没能自动换账号续跑', ''];
  out.push(line('什么情况', '账号「' + accountLabel(d.fromUid, d.fromNickname) + '」被限流了。'));
  const reason = String(d.reason || '');
  const why = FAILURE_REASONS[reason] ||
    (reason === 'no-task-text' && d.noTaskText ? String(d.noTaskText) : (reason || '没有可用的备用账号。'));
  out.push(line('卡在哪', why));
  const tried = Array.isArray(d.triedLabels) ? d.triedLabels.filter(Boolean) : [];
  if (tried.length) out.push(line('试过的账号', tried.join('、')));
  if (d.error) out.push(line('底层报错', String(d.error).slice(0, 200)));
  out.push(line('现在的状态', '还停在账号「' + accountLabel(d.fromUid, d.fromNickname) + '」。建议手动换个账号，或者稍后再发一次。'));
  return out.join('\n') + '\n';
}

/**
 * 收尾段（续跑结束后对账号做了什么）。
 * outcome.status 取值：
 *   switched   已切回（不需要等限流窗口）
 *   waited     等主账号限流窗口过去之后才切回（outcome.waitedMs 有值）
 *   no-need    本轮续跑本来就在主账号上，无需切回
 *   already    用户已经手动切回主账号
 *   no-primary 没设主账号 / 主账号备份不存在
 *   unavailable 主账号不在账号列表里（被删或凭据失效）
 *   blocked    主账号仍在限流窗口内且超过等待上限
 *   unsure     没能确认续跑跑起来
 *   superseded 等待期间账号又变了（新一轮切号 / 手动切换）
 *   failed     切回动作本身失败（outcome.error）
 * @param {object} p {at, plan, outcome}
 */
function buildSwitchBackReport(p) {
  const d = p || {};
  const plan = d.plan || {};
  const outcome = d.outcome || {};
  const status = String(outcome.status || '');
  const toLabel = accountLabel(plan.toUid, plan.toNickname);
  const primaryLabel = accountLabel(outcome.primaryUid || plan.primaryUid, outcome.primaryNickname);
  const elapsed = Number(outcome.elapsedMs) || 0;
  const head = (status === 'switched' || status === 'waited')
    ? '续跑结束，账号已切回主账号'
    : (status === 'no-need' || status === 'already')
      ? '续跑结束：不需要切号'
      : '续跑结束：账号这次保持不动';
  const out = [RULE, '【' + formatClock(d.at) + '】' + head, ''];

  if (status === 'switched' || status === 'waited') {
    if (elapsed) out.push(line('续跑时长', '这次的续跑在账号「' + toLabel + '」上跑了 ' + formatDuration(elapsed) + '，已经跑完。'));
    if (status === 'waited') {
      out.push(line('为什么等了会儿', '主账号「' + primaryLabel + '」当时还在限流窗口里，等它过去之后才切回 —— 否则切回去马上又会被限流，来回横跳。'));
      if (Number(outcome.waitedMs) > 0) out.push(line('等待时长', formatDuration(outcome.waitedMs)));
    } else {
      out.push(line('主账号状态', '限流窗口已经过去，可以正常用了。'));
    }
    out.push(line('现在界面上的账号', primaryLabel + ' —— 页面会自动刷新一次，这是切换账号的正常动作。'));
    out.push(autoCopyLine(outcome, toLabel));
    return out.join('\n') + '\n';
  }

  if (status === 'no-need') {
    out.push(line('说明', '这次续跑本来就在主账号「' + accountLabel(plan.toUid, plan.toNickname) + '」上跑的，不需要切回。'));
    return out.join('\n') + '\n';
  }
  if (status === 'already') {
    out.push(line('说明', '你已经手动切回主账号「' + primaryLabel + '」了，这里什么都不用做。'));
    return out.join('\n') + '\n';
  }
  if (status === 'no-primary') {
    out.push(line('⚠️ 没有自动切回', '找不到主账号 —— 你还没指定主账号，或者主账号的备份已经被删了。'));
    out.push(line('现在停在', '账号「' + toLabel + '」。'));
    out.push(line('怎么让它以后自动切回', '在 WorkDaddy 面板的「账号」页把主账号指定上即可。'));
    return out.join('\n') + '\n';
  }
  if (status === 'unavailable') {
    out.push(line('⚠️ 没有自动切回', '主账号「' + primaryLabel + '」不在账号列表里（可能已被删除或凭据失效）。'));
    out.push(line('现在停在', '账号「' + toLabel + '」。'));
    return out.join('\n') + '\n';
  }
  if (status === 'blocked') {
    if (outcome.blockedUntil) out.push(line('⚠️ 没有自动切回', '主账号「' + primaryLabel + '」还在限流窗口内（预计 ' + formatClock(outcome.blockedUntil) + ' 之后才恢复），超过了本次的等待上限。'));
    else out.push(line('⚠️ 没有自动切回', '主账号「' + primaryLabel + '」仍在限流窗口内，超过了本次的等待上限。'));
    out.push(line('现在停在', '账号「' + toLabel + '」，你可以稍后手动切回。'));
    return out.join('\n') + '\n';
  }
  if (status === 'unsure') {
    out.push(line('⚠️ 没有自动切回', '没能确认续跑真的跑起来了（交接后 ' + formatDuration(outcome.startWaitMs) + '内没看到新回复开始生成）。'));
    out.push(line('为什么保守处理', '账号切换会让页面刷新，状态不明时乱动账号风险更大，所以这次保持不动。'));
    out.push(line('现在停在', '账号「' + toLabel + '」。'));
    return out.join('\n') + '\n';
  }
  if (status === 'timeout') {
    out.push(line('⚠️ 没有自动切回', '等到上限（' + formatDuration(outcome.maxWaitMs) + '）这次的续跑还没跑完 —— 可能任务很长，也可能卡住了。'));
    out.push(line('为什么不动账号', '续跑还在跑，切账号会把页面刷新、当场把任务掐死，所以保持不动。'));
    out.push(line('现在停在', '账号「' + toLabel + '」，跑完之后你可以手动切回。'));
    return out.join('\n') + '\n';
  }
  if (status === 'superseded') {
    out.push(line('⚠️ 没有自动切回', '等待期间账号又变了（可能又触发了一次限流切号，或者你手动切了账号），这次交给新一轮处理，避免两个流程抢账号。'));
    out.push(line('说明', '本次切号记录到此为止，后续请看新的那一段记录。'));
    return out.join('\n') + '\n';
  }
  if (status === 'failed') {
    out.push(line('⚠️ 切回主账号失败', String(outcome.error || '未知原因').slice(0, 200)));
    out.push(line('现在停在', '账号「' + toLabel + '」，你可以手动切回。'));
    return out.join('\n') + '\n';
  }
  out.push(line('说明', '续跑已结束，账号处理结果：' + (status || '未知') + '。'));
  return out.join('\n') + '\n';
}

/**
 * 闲置自动切回段落。outcome.status 取值：
 *   switched   已切回主账号（成功）
 *   failed     切回动作本身失败（outcome.error）
 * ⚠️ 只有「真的动了账号」才会走到这里；「没设主账号 / 主账号在限流窗口 / 有任务在跑」这类
 *    条件不满足的情况不写桌面日志（否则每 30 秒刷一条），只在面板状态行里显示。
 * @param {object} p {at, plan:{idleMs, minutes, fromUid, fromNickname, toUid, toNickname}, outcome}
 */
function buildIdleSwitchBackReport(p) {
  const d = p || {};
  const plan = d.plan || {};
  const outcome = d.outcome || {};
  const status = String(outcome.status || '');
  const fromLabel = accountLabel(plan.fromUid, plan.fromNickname);
  const toLabel = accountLabel(outcome.primaryUid || plan.primaryUid, outcome.primaryNickname || plan.primaryNickname);
  const out = [RULE, '【' + formatClock(d.at) + '】' + (status === 'switched' ? '闲置自动切回主账号' : '闲置自动切回主账号（失败）'), ''];

  if (status === 'switched') {
    out.push(line('为什么切', '账号「' + fromLabel + '」已经连续 ' + formatDuration(plan.idleMs) +
      '没有任何动作（没有新消息、没有正在生成的回复、输入框里也没有草稿）。'));
    out.push(line('做了什么', '切回主账号「' + toLabel + '」—— 页面会自动刷新一次，这是切换账号的正常动作。'));
    out.push(line('判定口径', '闲置时间从「最后一次有新消息 / 正在生成 / 输入框有草稿」算起，超过 ' +
      (Number(plan.minutes) || 0) + ' 分钟就切回；这个阈值可以在面板「账号」页调整，也可以关掉。'));
    out.push(autoCopyLine(outcome, fromLabel));
    return out.join('\n') + '\n';
  }
  if (status === 'failed') {
    out.push(line('为什么切', '账号「' + fromLabel + '」已经连续 ' + formatDuration(plan.idleMs) + ' 没动作。'));
    out.push(line('⚠️ 切回失败', String(outcome.error || '未知原因').slice(0, 200)));
    out.push(line('现在停在', '账号「' + fromLabel + '」，你可以手动切回主账号。'));
    return out.join('\n') + '\n';
  }
  out.push(line('说明', '闲置切回的结果：' + (status || '未知') + '。'));
  return out.join('\n') + '\n';
}

/**
 * 追加一段报告。首次创建文件时写 BOM + 说明头。
 * @returns {{ok:boolean, file:string, created?:boolean, bytes?:number, error?:string}}
 */
function appendReport(options) {
  const opts = options || {};
  const dir = String(opts.dir || '').trim();
  const file = dir ? path.join(dir, logFileName(opts.at)) : '';
  if (!dir) return { ok: false, file: '', error: '没有可写的日志目录' };
  const io = opts.fsImpl || fsDefault;
  const body = String(opts.text == null ? '' : opts.text)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\r\n');
  try {
    io.mkdirSync(dir, { recursive: true });
    const exists = typeof io.existsSync === 'function' ? io.existsSync(file) : false;
    const chunk = (exists ? '' : '\uFEFF' + FILE_HEADER.replace(/\n/g, '\r\n') + '\r\n') + body;
    io.appendFileSync(file, chunk, { encoding: 'utf8' });
    return { ok: true, file, created: !exists, bytes: Buffer.byteLength(chunk, 'utf8') };
  } catch (error) {
    return { ok: false, file, error: String((error && error.message) || error) };
  }
}

module.exports = {
  LOG_PREFIX,
  LOG_SUFFIX,
  SNIPPET_CHARS,
  FILE_HEADER,
  formatClock,
  formatDuration,
  snippet,
  accountLabel,
  logFileName,
  desktopCandidates,
  resolveLogDir,
  buildTriggerReport,
  buildFailureReport,
  buildSwitchBackReport,
  buildIdleSwitchBackReport,
  appendReport,
};
