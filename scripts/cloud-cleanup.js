'use strict';

/**
 * 云端会话残留（下称「幽灵会话」）的检测与清理 —— 纯逻辑，不含任何 IO。
 *
 * ## 问题
 * 桌面端删会话时只删本地（WorkDaddy 更是直接操作 sqlite + 文件，不走官方 delete），
 * 而会话在**其它设备（手机端）看到的那一份来自云端**。本地删除不会通知云端，
 * 于是「桌面删掉了、手机端还在」。
 *
 * ## 云侧的鉴权事实（2026-09-16 实测）
 * `cloudAgentDeleteConversation({ conversationId })` 与 `cloudAgentGetConversationDetail`
 * 都**按当前登录账号**鉴权：
 *   · 删当前账号的会话           → 正常
 *   · 删别的账号的会话           → `conversation access denied`（存在，但不归你）
 *   · 问一个不存在的 id          → `conversation not found`
 *   · 且错误里会带 `for user <uid>`
 * 因此「access denied」是**存在性证据**，而跨账号残留必须切到那个账号才能清。
 *
 * ## 本模块职责
 * 把上面这些判断固化成可单测的纯函数，供 daemon 的
 * `GET /api/cloud/ghosts`（检测）与 `POST /api/cloud/ghosts/purge`（清理）使用。
 */

/** 云侧删除 / 查询用的 daemon 客户端方法名（与 app.asar 里的 CHANNEL_MAP 对齐）。 */
const CLOUD_DELETE_METHOD = 'cloudAgentDeleteConversation';
const CLOUD_DETAIL_METHOD = 'cloudAgentGetConversationDetail';
/** 只读探针：切号后用它确认「渲染层已挂载、daemon 客户端已就绪」。 */
const CLOUD_LIST_METHOD = 'cloudAgentListUserConversations';

/** 单次清理上限：既是防误点，也避免刷爆云接口。 */
const MAX_PURGE_BATCH = 200;

/** 云侧边缘同步用的消息通道前缀：`convmsg:<账号 uid>`。 */
const CLOUD_CHANNEL_PREFIX = 'convmsg:';

/**
 * 从 `edge_sync_mapping.msg_channel` 解析归属账号 uid。
 * 不是 `convmsg:` 形态（例如空通道）返回空串 —— 调用方据此把该条归为「账号未知」。
 */
function parseCloudChannel(channel) {
  const text = String(channel == null ? '' : channel).trim();
  if (!text.startsWith(CLOUD_CHANNEL_PREFIX)) return '';
  return text.slice(CLOUD_CHANNEL_PREFIX.length).trim();
}

/**
 * 把云侧异常归一成可判断的种类。
 * 输入可以是 Error（带 code/message）、或已经拆好的 {code,message}。
 */
function classifyCloudError(error) {
  const source = error && typeof error === 'object' ? error : {};
  const code = String(source.code == null ? '' : source.code).trim();
  const message = String(source.message == null ? (error == null ? '' : error) : source.message).trim();
  const lower = message.toLowerCase();
  if (/\baccess denied\b/.test(lower)) return { kind: 'denied', code, message };
  if (/\bnot found\b/.test(lower)) return { kind: 'missing', code, message };
  if (/status code 429|too many requests|rate.?limit|请求过于频繁/.test(lower)) return { kind: 'rate-limited', code, message };
  if (/未连接|not connected|cdp|页面执行失败/.test(lower)) return { kind: 'offline', code, message };
  return { kind: 'error', code, message };
}

/**
 * 一条「问云端这条会话还在不在」的结果 → 存在性判定。
 *   · 抛 access denied  → 'exists'（存在，只是不归当前账号）
 *   · 抛 not found      → 'missing'
 *   · 抛别的（含 429）   → 'unknown'（不改数据前不允许当不存在处理）
 *   · 有返回体           → 'exists'
 *
 * @param {{ok:boolean,value?:*,error?:object}} result daemon 侧 CDP 调用的归一结果
 */
function interpretProbe(result) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.ok === true) return r.value ? 'exists' : 'exists';   // 有对象返回即存在（空对象也算"查到了"）
  const classified = classifyCloudError(r.error);
  if (classified.kind === 'denied') return 'exists';
  if (classified.kind === 'missing') return 'missing';
  return 'unknown';
}

/**
 * 幽灵分组。
 *
 * @param {object} input
 * @param {Array<{id:string,uid:string,state?:string,title?:string}>} input.candidates
 *        候选（一般来自本地 edge-sync 映射表；`state` 是云侧探测结论，缺省 unknown）
 * @param {Array<string>} input.localIds 本地**仍然存在**的会话 id（这些不算残留）
 * @param {string} input.currentUid 当前登录账号 uid
 * @returns {{current:Array,other:Array,missing:Array,unknown:Array}}
 *   current = 归当前账号、可立即删；other = 归别的账号、需切号；missing = 云端已无；
 *   unknown = 探测没结论（限流/离线），不参与清理
 */
function planCloudGhosts(input) {
  const source = input && typeof input === 'object' ? input : {};
  const localIds = new Set((Array.isArray(source.localIds) ? source.localIds : []).map((x) => String(x || '')).filter(Boolean));
  const currentUid = String(source.currentUid == null ? '' : source.currentUid).trim();
  const groups = { current: [], other: [], missing: [], unknown: [] };
  const seen = new Set();
  for (const raw of Array.isArray(source.candidates) ? source.candidates : []) {
    const id = String((raw && raw.id) || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (localIds.has(id)) continue;                       // 本地还在：不是残留
    const uid = String((raw && raw.uid) || '').trim();
    const state = String((raw && raw.state) || 'unknown').trim();
    const item = { id, uid, title: String((raw && raw.title) || '') };
    if (state === 'missing') { groups.missing.push(item); continue; }
    if (state !== 'exists') { groups.unknown.push(item); continue; }
    // 账号未知（通道名不合约定）时保守地归入 other：宁可要求切号确认，也不误删
    if (currentUid && uid && uid === currentUid) groups.current.push(item);
    else groups.other.push(item);
  }
  return groups;
}

/** 分组计数（给前端与日志用，字段名固定）。 */
function summarizeGhostPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const n = (key) => (Array.isArray(p[key]) ? p[key].length : 0);
  return {
    deletable: n('current'),
    needsSwitch: n('other'),
    alreadyGone: n('missing'),
    unknown: n('unknown'),
    total: n('current') + n('other') + n('missing') + n('unknown'),
  };
}

/**
 * 清理清单归一：去重、剔非法、限批。
 * @returns {{ids:string[], dropped:number, truncated:number}}
 */
function normalizePurgeSelection(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const out = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of list) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    // 会话 id 是 uuid 形态；长度上限与 session-db 的批次约束保持一致
    if (!id || id.length > 200 || !/^[0-9a-zA-Z_-]+$/.test(id)) { dropped += 1; continue; }
    if (seen.has(id)) { dropped += 1; continue; }
    seen.add(id);
    out.push(id);
  }
  const truncated = Math.max(0, out.length - MAX_PURGE_BATCH);
  return { ids: out.slice(0, MAX_PURGE_BATCH), dropped, truncated };
}

/**
 * 单次清理的可读小结（写 daemon.log 与返回给前端）。
 * @param {{requested:number,deleted:number,failed:Array<{id:string,reason:string}>,skipped?:number}} r
 */
function summarizePurgeRun(r) {
  const d = r && typeof r === 'object' ? r : {};
  const failed = Array.isArray(d.failed) ? d.failed : [];
  const reasons = {};
  for (const f of failed) {
    const key = String((f && f.reason) || 'error');
    reasons[key] = (reasons[key] || 0) + 1;
  }
  return {
    requested: Number(d.requested) || 0,
    deleted: Number(d.deleted) || 0,
    failed: failed.length,
    skipped: Number(d.skipped) || 0,
    reasons,
  };
}

/** 给「删除确认」用的补充说明：让用户知道删了本地不等于删了所有设备。 */
function deleteCrossDeviceNotice() {
  return '本机删除不会同步到其它设备：手机端/其它电脑上仍可能看到这些会话，需要时在「会话」页用「云端残留」清理。';
}

module.exports = {
  CLOUD_DELETE_METHOD,
  CLOUD_DETAIL_METHOD,
  CLOUD_LIST_METHOD,
  CLOUD_CHANNEL_PREFIX,
  MAX_PURGE_BATCH,
  parseCloudChannel,
  classifyCloudError,
  interpretProbe,
  planCloudGhosts,
  summarizeGhostPlan,
  normalizePurgeSelection,
  summarizePurgeRun,
  deleteCrossDeviceNotice,
};
