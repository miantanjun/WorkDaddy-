'use strict';
/*
 * session-sync.deltas.js —— 本地对上游 scripts/session-sync.js 的**全部**差异登记表。
 *
 * 为什么要有这张表：
 *   我们与上游的差异必须可机器校验，否则「唯一差异」这类注释会随时间说谎。
 *   本表是唯一真相：`fixtures/session-sync.upstream-1.2.4.js` + 依次应用本表 == `scripts/session-sync.js`。
 *   test-session-sync-124.js 的 [A] 段就在校验这个等式。
 *
 * 维护方式：改 scripts/session-sync.js 时，**先改本表再重生成**（不要直接改工作副本），
 *   否则等式立刻翻红 —— 这正是我们要的。
 *   重生成：node .wd-analysis/fixtures/regen-session-sync.js
 *
 * 当前 7 条 delta 属于三类：
 *   delta-1          上限常量适配（上游 64MiB/20000 挡不住真机 435.6MiB 的会话）
 *   delta-2a..2e     readSnapshot 支持 options.skipPrefixes（把数百 MB 的 workspace 产物排除在快照外）
 *   delta-3          applySnapshot 的**发布后复检**沿用同一 skip 域（D2 事务写入的前置）
 */

const UPSTREAM_VERSION = '1.2.4';
const UPSTREAM_SHA256 = 'c991419a40f76720bb3fda635fc954f4213c2fded3a0ff8c38f89a4d7df6187d';

const DELTAS = [
  {
    id: 'delta-1',
    note: '上限常量：64MiB/20000 → 1GiB/200000（真机最大会话 435.6MiB，正文单项就超 64MiB）',
    from: 'const MAX_BYTES = 64 * 1024 * 1024;\nconst MAX_FILES = 20000;\n',
    to: [
      '// ⚠️ 本地 delta：与上游 1.2.4 的**全部**差异都在此登记，其余逐字节一致，便于日后 diff 上游。',
      '//   [delta-1] 两个上限常量。上游为 64 MiB / 20000。真机实测（21 条血缘 / 55 个成员）有 3 条血缘、',
      '//     9 个成员超 64 MiB，最大单会话 435.6 MiB，且**正文 .jsonl 单项就已超过 64 MiB** ⇒ 照搬会把它们',
      '//     永久挡在同步之外（每次切号都抛「会话文件过大，未自动同步」）。抬到 1 GiB + 20 万文件；',
      '//     仍保留上限是因为本实现会把整个会话的 bytes 驻留内存，必须挡住病态目录。',
      '//   [delta-2] readSnapshot 第 4 参 options.skipPrefixes：允许调用方把体积可达数百 MB 的',
      '//     workspace/sessions/<id>/ 排除在内容快照之外（交回 daemon 的产物二阶段推进）。不传 ⇒ 与上游等价。',
      '//   两处 delta 由 .wd-analysis/test-session-sync-124.js 的 delta 表机器校验，上游原文见 .wd-analysis/fixtures/。',
      '// 依据：WorkDaddy-上游1.2.4影响面实测报告.md、.workbuddy/memory/2026-09-20.md §L',
      'const MAX_BYTES = 1024 * 1024 * 1024;',
      'const MAX_FILES = 200000;',
      '',
    ].join('\n'),
  },
  {
    id: 'delta-2a',
    note: 'readSnapshot 接受第 4 参 options（默认 {} ⇒ 与上游等价）',
    from: 'function readSnapshot(root, id, aliases = []) {',
    to: 'function readSnapshot(root, id, aliases = [], options = {}) {',
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
    note: '快照对象带回 skipPrefixes，供竞态复检沿用同一域',
    from: '  return { root, id, aliases: knownIds, files, records, transcriptKey };',
    to: '  return { root, id, aliases: knownIds, files, records, transcriptKey, skipPrefixes: [...skipPrefixes] };',
  },
  {
    id: 'delta-2e',
    note: 'unchanged() 复检必须用同一 skip 域，否则会把产物算进来（既慢又可能触顶）',
    from: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases);',
    to: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, { skipPrefixes: snapshot.skipPrefixes });',
  },
  {
    id: 'delta-3',
    note: 'applySnapshot 的**发布后复检**也要用同一 skip 域：verifyPublished 拿源快照的 files 当期望集（已排除产物），'
      + '却用「未排除」的目标快照去比 ⇒ 目标多出来的产物会把集合尺寸顶破，每次都抛「目标会话正在变化，已停止同步」。'
      + 'D2 把写盘换成事务写入器之前必须先补这一条。',
    from: '    const now = readSnapshot(target.root, target.id, target.aliases);',
    to: '    const now = readSnapshot(target.root, target.id, target.aliases, { skipPrefixes: target.skipPrefixes });',
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
