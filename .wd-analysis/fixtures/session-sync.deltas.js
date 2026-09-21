'use strict';
/*
 * session-sync.deltas.js —— 本地对上游 scripts/session-sync.js 的**全部**差异登记表。
 *
 * 为什么要有这张表：
 *   我们与上游的差异必须可机器校验，否则「唯一差异」这类注释会随时间说谎。
 *   本表是唯一真相：`fixtures/session-sync.upstream-1.2.5.js` + 依次应用本表 == `scripts/session-sync.js`。
 *   test-session-sync-124.js 的 [A] 段就在校验这个等式。
 *
 * 维护方式：改 scripts/session-sync.js 时，**先改本表再重生成**（不要直接改工作副本），
 *   否则等式立刻翻红 —— 这正是我们要的。
 *   重生成：node .wd-analysis/fixtures/regen-session-sync.js
 *
 * 2026-09-21 基线从上游 1.2.4 → **1.2.5**（本轮吸纳批，见 WorkDaddy-OpenViking吸纳评估与功能进度总览.md §2.1）：
 *   上游 1.2.5 把 session-sync.js 从 278 行扩到 427 行，新增/取消的东西**大多被本地整段沿用了**：
 *     · A1 取消 `MAX_BYTES = 64MiB` / `MAX_FILES = 20000` 两道上限 ⇒ **本地 delta-1 退休**
 *       （本地原来是「把阈值抬到 1GiB/200000」绕开问题，上游是直接消除问题）
 *     · A2 惰性字节加载 `attachBytes`（bytes 改成 getter，只在真要写盘时才读）——这是 A1 的安全前提，
 *       只有它到位，「无上限」才不致内存无界
 *     · A4 新增导出 `readSessionSizes(root, ids)`（轻量按会话计字节，并发上限 4，不解析消息）
 *     · A6 `safePathFast`（快照内目录组件只验一次，但**每个文件仍单独查 symlink**）
 *     · A3 指纹缓存（`readSnapshot` 第 4 参 `cache`）· A7 快照/事务返回 `totalBytes` / `copiedBytes`
 *   本地**只保留两件事**：①`options.skipPrefixes` 快照域（把数百 MB 的 workspace 产物排除在外）
 *   ②`applySnapshot` 发布后复检沿用同一 skip 域。其余逐字节与上游一致。
 *
 * 当前 7 条 delta 属于三类：
 *   delta-0          文件头「本文件是产物」的本地说明（纯粹为了不让人直接改工作副本）
 *   delta-2a..2e     readSnapshot 支持第 4 参 options.skipPrefixes（cache 顺延为第 5 参）
 *   delta-3          applySnapshot 的**发布后复检**沿用同一 skip 域（D2 事务写入的前置）
 *
 * delta-1 退休记录（别删这条注释，否则下一轮会有人想把它加回来）：
 *   1.2.4 时代本地把上限抬到 `1GiB / 200000`，理由是真机有 3 条血缘 9 个成员超 64 MiB
 *   （最大单会话 435.6 MiB，正文 .jsonl 单项就超 64 MiB）。1.2.5 起上游**取消了上限**，
 *   并配 `attachBytes` 惰性读 ⇒ 本地上限常量连同 `visit()` 里的闸门与
 *   `'会话文件过大，未自动同步'` 文案一并删除。**只删上限不加惰性读 = 内存无界，是真回归。**
 */

const UPSTREAM_VERSION = '1.2.5';
const UPSTREAM_SHA256 = 'e93ea36390515d408a2b2f08e1cd4b4bcf945ffb56e0bad831355e4917c09317';

const DELTAS = [
  {
    id: 'delta-0',
    note: '文件头「本文件是产物」的本地说明（改行为请改本表，不要直接改工作副本）',
    from: '\'use strict\';\n\n// Account copies share a logical session, but may have independent continuations.\n',
    to: [
      '\'use strict\';',
      '',
      '// ⚠️ 本文件是**产物**，由 .wd-analysis/fixtures/session-sync.upstream-1.2.5.js + session-sync.deltas.js',
      '//   经 regen-session-sync.js 生成。要改行为 ⇒ **先改 deltas 表再重生成**；直接改本文件会让',
      '//   test-session-sync-124.js 的 [A] 组「上游原文 + delta 表 == 工作副本」逐字节锁立刻翻红。',
      '//   本地与上游的**全部**差异都在 deltas 表里登记，其余逐字节一致，便于日后 diff 上游 1.2.5+。',
      '//   [delta-2] readSnapshot 第 4 参 options.skipPrefixes：允许调用方把体积可达数百 MB 的',
      '//     workspace/sessions/<id>/ 排除在内容快照之外（交回 daemon 的产物二阶段推进）。不传 ⇒ 与上游等价；',
      '//     cache（上游第 4 参）本地顺延为第 5 参。',
      '//   [delta-3] applySnapshot 的发布后复检沿用同一 skip 域。',
      '//   依据：WorkDaddy-上游1.2.4影响面实测报告.md、WorkDaddy-OpenViking吸纳评估与功能进度总览.md §2.1。',
      '',
      '// Account copies share a logical session, but may have independent continuations.',
      '',
    ].join('\n'),
  },
  {
    id: 'delta-2a',
    note: 'readSnapshot 第 4 参改为本地 options（默认 {} ⇒ 与上游等价），上游的 cache 顺延为第 5 参',
    from: 'function readSnapshot(root, id, aliases = [], cache = null) {',
    to: 'function readSnapshot(root, id, aliases = [], options = {}, cache = null) {',
  },
  {
    id: 'delta-2b',
    note: '解析 skipPrefixes 集合',
    from: '  const knownIds = Array.from(new Set([id, ...aliases]));',
    to: '  const knownIds = Array.from(new Set([id, ...aliases]));\n  const skipPrefixes = new Set((options && options.skipPrefixes) || []);',
  },
  {
    id: 'delta-2c',
    note: '遍历附属根时跳过被排除的前缀',
    from: "  for (const prefix of ['workspace/sessions', 'tasks', 'file-history']) visit(prefix + '/' + id, prefix + '/__session__');",
    to: "  for (const prefix of ['workspace/sessions', 'tasks', 'file-history']) {\n    if (skipPrefixes.has(prefix)) continue;\n    visit(prefix + '/' + id, prefix + '/__session__');\n  }",
  },
  {
    id: 'delta-2d',
    note: '快照对象带回 skipPrefixes，供竞态复检沿用同一域（totalBytes / cache 是上游 1.2.5 的字段，保留）',
    from: '  return { root, id, aliases: knownIds, files, records, transcriptKey, totalBytes: total, cache };',
    to: '  return { root, id, aliases: knownIds, files, records, transcriptKey, totalBytes: total, cache, skipPrefixes: [...skipPrefixes] };',
  },
  {
    id: 'delta-2e',
    note: 'unchanged() 复检必须用同一 skip 域，否则会把产物算进来（既慢又可能触顶）；cache 原样透传',
    from: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, snapshot.cache || null);',
    to: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, { skipPrefixes: snapshot.skipPrefixes }, snapshot.cache || null);',
  },
  {
    id: 'delta-3',
    note: 'applySnapshot 的**发布后复检**也要用同一 skip 域：verifyPublished 拿源快照的 files 当期望集（已排除产物），'
      + '却用「未排除」的目标快照去比 ⇒ 目标多出来的产物会把集合尺寸顶破，每次都抛「目标会话正在变化，已停止同步」。'
      + 'D2 把写盘换成事务写入器之前必须先补这一条。',
    from: '    const now = readSnapshot(target.root, target.id, target.aliases, target.cache || null);',
    to: '    const now = readSnapshot(target.root, target.id, target.aliases, { skipPrefixes: target.skipPrefixes }, target.cache || null);',
  },
];

/**
 * 把上游原文 + delta 表合成本地工作副本。
 * @param {string} upstreamText 上游 session-sync.js 原文
 * @returns {string} 本地工作副本内容
 */
function applyDeltas(upstreamText) {
  const problems = [];
  let text = upstreamText;
  for (const delta of DELTAS) {
    const hits = text.split(delta.from).length - 1;
    if (hits !== 1) problems.push(delta.id + ' 命中 ' + hits + ' 次（必须恰好 1 次）');
    text = text.replace(delta.from, delta.to);
  }
  return { text, problems };
}

module.exports = { UPSTREAM_VERSION, UPSTREAM_SHA256, DELTAS, applyDeltas };
