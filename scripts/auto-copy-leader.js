'use strict';
/*
 * auto-copy-leader.js —— 方案 D 的 D1：**内容定源（判主偏序）**。
 *
 * 要解决的问题（旧实现的结构性缺陷）：
 *   旧的 `syncAutoCopyLineage` 用 `selectLatestAutoCopyMember`（比 contentMtime，再比 updatedAt）
 *   挑「最新那份」去覆盖其他成员。这是**用时间定源**，而时间只能说明「谁最后被写过」，
 *   不能说明「谁的内容包含了谁」。两个后果：
 *     ① 一个只在末尾被 shell 动过、内容其实更短的副本会赢，把更完整的对话覆盖掉；
 *     ② 「两侧都改过」被当成冲突（保护性跳过），而实际上两段内容往往呈**祖先/后代**关系，
 *        完全可以直接判出领导者，不必打扰用户。
 *
 * 本模块改成**用内容定源**：给一组快照做两两比较（上游 session-sync.js 的 compareSnapshots），
 * 找出「左扩展/等价于所有其他成员」的那一份 —— 它在偏序里就是**唯一的内容领导者**。
 *   · 存在唯一领导者 ⇒ 以它为源 fan-out（这才是「最新且最全」的严格版本）。
 *   · 全部等价      ⇒ 任取一份即可（优先当前目标成员，保证结果稳定）。
 *   · 不存在领导者  ⇒ 真的分叉（siblings），**一份都不覆盖**，把双方都保留下来交给用户裁决。
 *
 * ⚠️ 铁律（与上游同一哲学）：**mtime 绝不参与定源**。这里只读快照的 records / files.semantic。
 *   mtime 只在 auto-copy-judge 里回答「要不要重算快照」，不回答「谁赢」。
 *
 * ⚠️ 不可比（读不出来 / compareSnapshots 抛错 / 双方各有对方没有的文件）**一律算 div**，
 *   绝不放行成 eq —— 否则一份读坏的副本会被判成「等价」而被当作领导者写出去。
 */

const judge = require('./auto-copy-judge.js');

/** compareSnapshots 的 kind → 偏序关系。gt=左含右，lt=右含左，eq=等价，div=双方各有取舍 */
const REL_GT = 'gt';
const REL_LT = 'lt';
const REL_EQ = 'eq';
const REL_DIV = 'div';

/**
 * 把上游 compareSnapshots 的结论翻成偏序关系。**纯函数**，可脱机单测。
 *
 * compareSnapshots 的 kind 语义（读上游源码得到，别凭名字猜）：
 *   left-extends  : 右是左的前缀 ⇒ 左含右
 *   right-extends : 左是右的前缀 ⇒ 右含左
 *   equal         : 正文与附属文件集合都一致
 *   repair        : 正文一致，但**文件集合有差**。差向要看 missingRight/missingLeft：
 *                   missingRight=true 表示「左有、右没有」⇒ 左多东西；
 *                   missingLeft=true 表示「右有、左没有」⇒ 右多东西。
 *                   两个都真 = 双方各有对方没有的文件 ⇒ 谁也不是谁的超集 ⇒ div。
 *   conflict      : 正文在同一位置分叉（或同一逻辑文件内容不同）⇒ div
 */
function relationOf(comparison) {
  if (!comparison || typeof comparison.kind !== 'string') return REL_DIV;
  switch (comparison.kind) {
    case 'left-extends': return REL_GT;
    case 'right-extends': return REL_LT;
    case 'equal': return REL_EQ;
    case 'repair': {
      const extraLeft = comparison.missingRight === true;
      const extraRight = comparison.missingLeft === true;
      if (extraLeft && !extraRight) return REL_GT;
      if (extraRight && !extraLeft) return REL_LT;
      if (!extraLeft && !extraRight) return REL_EQ;
      return REL_DIV;
    }
    default: return REL_DIV;
  }
}

/** 两两比较（含异常兜底）。异常=不可比=div，绝不静默放行。 */
function comparePair(left, right) {
  try {
    const comparison = judge.compareSnapshots(left, right);
    return { rel: relationOf(comparison), kind: comparison.kind, comparison, error: null };
  } catch (error) {
    return { rel: REL_DIV, kind: 'unreadable', comparison: null, error: String((error && error.message) || error) };
  }
}

/**
 * 判主。**纯函数**：喂进去的是已经读好的快照，不碰磁盘。
 *
 * @param {Array<{uid?:string,id:string,snapshot?:object,error?:any}>} entries
 * @param {{preferredId?:string}} [options] preferredId 只在「全部等价」时用来定一个稳定的代表，
 *         **不参与分叉裁决** —— 上游明写「stored mapping must never decide which branch replaces that source」。
 * @returns {{
 *   kind:'leader'|'all-equal'|'divergent'|'insufficient',
 *   leaderId:string|null, candidates:string[], readable:number,
 *   members:Array<{uid:string,id:string,status:string,error:string|null}>,
 *   pairs:Array<{a:string,b:string,kind:string,rel:string,error:string|null}>,
 *   reason:string
 * }}
 */
function contentLeader(entries, options = {}) {
  const preferredId = String((options && options.preferredId) || '').trim();
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      uid: String((entry && entry.uid) || '').trim(),
      id: String((entry && entry.id) || '').trim(),
      snapshot: entry && entry.snapshot ? entry.snapshot : null,
      error: entry && entry.error ? String((entry.error && entry.error.message) || entry.error) : null,
    }))
    .filter((entry) => entry.id);

  const readable = list.filter((entry) => entry.snapshot);
  const status = new Map();
  for (const entry of list) status.set(entry.id, entry.snapshot ? 'member' : 'excluded');

  const members = () => list.map((entry) => ({ uid: entry.uid, id: entry.id, status: status.get(entry.id), error: entry.error }));

  if (readable.length < 2) {
    return {
      kind: 'insufficient',
      leaderId: null,
      candidates: [],
      readable: readable.length,
      members: members(),
      pairs: [],
      reason: readable.length === 0
        ? '全部成员的内容都读不出来（会话文件为空或损坏）'
        : '可读成员不足两个，无法判主偏序',
    };
  }

  // 谁含谁：beats.get(a) 收集「a 含 b」的那些 b
  const beats = new Map();
  for (const entry of readable) beats.set(entry.id, new Set());
  const pairs = [];
  for (let i = 0; i < readable.length; i++) {
    for (let j = i + 1; j < readable.length; j++) {
      const a = readable[i];
      const b = readable[j];
      const { rel, kind, error } = comparePair(a.snapshot, b.snapshot);
      if (rel === REL_GT || rel === REL_EQ) beats.get(a.id).add(b.id);
      if (rel === REL_LT || rel === REL_EQ) beats.get(b.id).add(a.id);
      if (rel === REL_DIV) pairs.push({ a: a.id, b: b.id, kind, rel, error });
    }
  }

  // 领导者 = 直接含住其他**每一个**可读成员的那一份。
  // 直接比较即可，无需传递闭包：compareSnapshots 比的是「正文前缀 + 附属文件集合」，
  // 这种包含关系本身可传递，因此「直接含住所有人」等价于「在偏序里位于最上」。
  const candidates = readable.filter((entry) => beats.get(entry.id).size === readable.length - 1)
    .map((entry) => entry.id);

  if (candidates.length === 1) {
    status.set(candidates[0], 'leader');
    for (const entry of readable) if (entry.id !== candidates[0] && status.get(entry.id) === 'member') status.set(entry.id, 'same');
    return {
      kind: 'leader', leaderId: candidates[0], candidates, readable: readable.length,
      members: members(), pairs, reason: '存在唯一内容领导者',
    };
  }

  if (candidates.length > 1) {
    // 多个候选 ⇒ 它们两两等价（否则不可能同时含住对方）。
    const leaderId = candidates.includes(preferredId) ? preferredId : candidates[0];
    for (const id of candidates) status.set(id, id === leaderId ? 'leader' : 'same');
    return {
      kind: 'all-equal', leaderId, candidates, readable: readable.length,
      members: members(), pairs, reason: candidates.length + ' 个成员内容等价，任取一份作源',
    };
  }

  for (const entry of readable) status.set(entry.id, 'branch');
  return {
    kind: 'divergent', leaderId: null, candidates: [], readable: readable.length,
    members: members(), pairs,
    reason: '没有成员包含其余全部成员的内容 —— 这是真正的分叉，双方都保留',
  };
}

/**
 * 读盘 + 判主（daemon 入口）。
 *
 * @param {string} root         WorkBuddy 数据根（PROFILE.dataRoot）
 * @param {Array<{uid:string,id:string}>} members
 * @param {object} [options]
 * @param {string[]} [options.aliases]  该血缘的**全部成员 id**。必须传且必须稳定：
 *        ①compareSnapshots 靠它把 sessionId/ownerConversationId 归一化，缺了会把同一份内容的
 *          不同副本判成 conflict；②auto-copy-judge 的缓存键含 alias 集合，传变来变去的集合会频繁 miss。
 * @param {string}   [options.preferredId]
 * @param {Function} [options.readSnapshot] 注入读快照（测试用）；缺省走 auto-copy-judge。
 */
function resolveContentLeader(root, members, options = {}) {
  const aliases = Array.isArray(options.aliases) ? options.aliases.filter(Boolean).map(String) : [];
  const readSnapshot = typeof options.readSnapshot === 'function'
    ? options.readSnapshot
    : (id) => judge.readJudgedSnapshot(root, id, aliases);
  const entries = (Array.isArray(members) ? members : []).map((member) => {
    const id = String((member && member.id) || '').trim();
    const uid = String((member && member.uid) || '').trim();
    if (!id) return { uid, id: '', snapshot: null, error: new Error('缺少会话标识') };
    try {
      return { uid, id, snapshot: readSnapshot(id, aliases), error: null };
    } catch (error) {
      return { uid, id, snapshot: null, error };
    }
  });
  return contentLeader(entries, options);
}

module.exports = {
  relationOf,
  comparePair,
  contentLeader,
  resolveContentLeader,
  REL_GT,
  REL_LT,
  REL_EQ,
  REL_DIV,
};
