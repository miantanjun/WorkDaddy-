'use strict';
/*
 * session-sync.deltas.js —— 本地对上游 scripts/session-sync.js 的**全部**差异登记表。
 *
 * 为什么要有这张表：
 *   我们与上游的差异必须可机器校验，否则「唯一差异」这类注释会随时间说谎。
 *   本表是唯一真相：`fixtures/session-sync.upstream-1.2.8.js` + 依次应用本表 == `scripts/session-sync.js`。
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
 * 2026-09-24 基线从上游 1.2.5 → **1.2.6**（第二轮吸纳批，见
 *   WorkDaddy-上游1.2.6吸纳建议报告-2026-09-24.md §4 批次 2）：
 *   上游 1.2.6 把 session-sync.js 从 427 行扩到 937 行（22 030 → 46 826 B）。本地两件事**原样保留**：
 *     ① `options.skipPrefixes` 快照域（delta-2）② `applySnapshot` 发布后复检沿用同域（delta-3）。
 *   **免费继承**（不需要新 delta，本地原本根本没有这些概念）：
 *     · `session-meta` 生命周期记录排除（4 处：canonical / visit / 快照 / 复制前过滤）—— WorkBuddy
 *       每次打开或恢复会话都会追加该类记录，本地以前把它当「正文变了」⇒ **已经在发生的假阳性**；
 *     · `SKIP_LOCAL_DIR`：只把 `modify_backup` / `.modify_backup_meta` 排除出快照域（比本地整段排除
 *       `workspace/sessions` 更精细，两者互补不冲突）；
 *     · 异步读取族 `readSnapshotAsync` / `unchangedAsync` / `targetBytesAsync` / `applySnapshotAsync`
 *       ＋ `safePathAsync` / `hashFileAsync` / `readStableBytesAsync` / `readTranscriptAsync`；
 *     · `selectTargetSnapshot` 瞬态冲突延迟重读（5.6 投影抖动不再一次采样就判分叉）。
 *   1.2.5 那份 fixture（sha256 `e93ea36390515d40…`）已退休，副本留在
 *   `_backup/scripts-20260924-151509/session-sync.upstream-1.2.5.js`。
 *
 * 2026-09-27 基线从上游 1.2.6 → **1.2.8**（见 WorkDaddy-上游1.2.8吸纳建议报告-2026-09-27.md §4 批 2）：
 *   上游 1.2.8 把 session-sync.js 从 46 826 B 扩到 51 098 B（937 → 1 037 行），新增：
 *     · `SYNC_BACKUP_DIR`（`/^sync-[A-Za-z0-9_-]+$/`）与 `DEFAULT_SYNC_BACKUP_MAX_AGE_MS`（30 天）
 *     · `pruneSyncBackups(root, { now, maxAgeMs })` —— `committed`/`rolled-back` 立即删、
 *       `recovery-needed` **永久保留**、`prepared`/无状态超期清；daemon 启动时跑一次 + 两个新路由
 *     · `inspectSyncBackups(root)` —— 只读目录项 + stat 元数据，**绝不回内容**（占用摘要给面板）
 *     · `changedTargetFiles(changes, target)` —— 回滚副本**只为会被覆盖/删除的文件**做，
 *       新文件没有旧字节可还原（`applySnapshot` / `applySnapshotAsync` 两侧都改用它）
 *     · `applySnapshot*` 成功/完整回滚后 `removeSyncBackup*` 立即清理临时快照目录
 *   这五项**全部是上游原生能力**，本地**零定制** ⇒ 无新 delta，7 条旧 delta 逐条仍恰好命中 1 次。
 * ⚠️ 1.2.6 那份 fixture（sha256 `d8274ce4eb91f0ad…`）已退休，副本留在 `_backup/scripts-20260927160903/`。
 *
 * ⚠️ 已知边界（有意为之，不是遗漏）：delta-2 系列**只加在同步版 `readSnapshot` 上**。
 *   1.2.6 新增的异步孪生 `readSnapshotAsync` 没有 skipPrefixes 支持。本地 daemon 目前只用同步版
 *   （D2 事务写入器 + 快照域），故无行为差异；**将来若切到异步版必须先补这组 delta**，否则产物会被
 *   算进内容快照（既慢又可能顶破集合尺寸，症状见 delta-3 的 note）。
 *
 * 2026-10-01 追加 **delta-5a..5l**（吸纳上游 1.2.9 + 1.2.10 的 session-sync 改动，共 12 条）：
 *   ⚠️ 核查发现本地 fixture 停在 1.2.8，**1.2.8→1.2.9 的钩子从未吸纳**，而 1.2.10 的重绑又依赖它
 *   ⇒ 先补钩子（5a..5e，本地无调用方、零行为变化）再补重绑（5f..5l，真修复）。
 *   核心：会话复制时重写 transcript 的 sessionId，避免 steer/权限事件路由回原会话。
 *
 * 当前 7 条旧 delta 属于三类：
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

const UPSTREAM_VERSION = '1.2.8';
const UPSTREAM_SHA256 = '19d3262f23fb3e55f541e48c7f951e55947a4528999f6690ffdc76c05eeae46d';

const DELTAS = [
  {
    id: 'delta-0',
    note: '文件头「本文件是产物」的本地说明（改行为请改本表，不要直接改工作副本）',
    from: '\'use strict\';\n\n// Account copies share a logical session, but may have independent continuations.\n',
    to: [
      '\'use strict\';',
      '',
      '// ⚠️ 本文件是**产物**，由 .wd-analysis/fixtures/session-sync.upstream-1.2.8.js + session-sync.deltas.js',
      '//   经 regen-session-sync.js 生成。要改行为 ⇒ **先改 deltas 表再重生成**；直接改本文件会让',
      '//   test-session-sync-124.js 的 [A] 组「上游原文 + delta 表 == 工作副本」逐字节锁立刻翻红。',
      '//   本地与上游的**全部**差异都在 deltas 表里登记，其余逐字节一致，便于日后 diff 上游 1.2.8+。',
      '//   （1.2.6 的 `session-meta` 排除、`SKIP_LOCAL_DIR`、异步读取族都是**上游原生**能力，不是本地 delta。）',
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
    note: '解析 skipPrefixes 集合。⚠️ 1.2.6 起 `knownIds` 这行在 readSnapshot 与 readSnapshotAsync 里'
      + '各出现一次 ⇒ 必须带上一行 lstat 校验做作用域限定，只改同步版。',
    from: "  if (fs.lstatSync(root).isSymbolicLink()) throw Error('会话目录包含符号链接，未同步');\n  const knownIds = Array.from(new Set([id, ...aliases]));",
    to: "  if (fs.lstatSync(root).isSymbolicLink()) throw Error('会话目录包含符号链接，未同步');\n  const knownIds = Array.from(new Set([id, ...aliases]));\n  const skipPrefixes = new Set((options && options.skipPrefixes) || []);",
  },
  {
    id: 'delta-2c',
    note: '遍历附属根时跳过被排除的前缀',
    from: "  for (const prefix of ['workspace/sessions', 'tasks', 'file-history']) visit(prefix + '/' + id, prefix + '/__session__');",
    to: "  for (const prefix of ['workspace/sessions', 'tasks', 'file-history']) {\n    if (skipPrefixes.has(prefix)) continue;\n    visit(prefix + '/' + id, prefix + '/__session__');\n  }",
  },
  {
    id: 'delta-2d',
    note: '快照对象带回 skipPrefixes，供竞态复检沿用同一域（totalBytes / cache 是上游 1.2.5 的字段，保留）。'
      + '⚠️ 1.2.6 起同形 return 在异步版也出现一次 ⇒ 带上前面两行右花括号限定作用域，只改同步版。',
    from: '    }\n  }\n  return { root, id, aliases: knownIds, files, records, transcriptKey, totalBytes: total, cache };',
    to: '    }\n  }\n  return { root, id, aliases: knownIds, files, records, transcriptKey, totalBytes: total, cache, skipPrefixes: [...skipPrefixes] };',
  },
  {
    id: 'delta-2e',
    note: 'unchanged() 复检必须用同一 skip 域，否则会把产物算进来（既慢又可能触顶）；cache 原样透传',
    from: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, snapshot.cache || null);',
    to: '  const now = readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, { skipPrefixes: snapshot.skipPrefixes }, snapshot.cache || null);',
  },
  // ===== [2026-10-01 吸纳上游 1.2.9 + 1.2.10] =====
  // ⚠️ 背景：fixture 逐字节等于上游 **1.2.8** 原文；本地已吸纳过 1.2.9，但**该文件当时漏了 4 处**
  //   （核查方式：fixture 与 1.2.9 原文 diff 只有这 4 行，不含页面其他改动）。
  //   而 1.2.10 的 transcript 身份重绑**依赖**其中的 `source.rewriteBytes`
  //   （`const rebind = !source.rewriteBytes && ...`）⇒ 必须一起补。
  //   ⇒ 5a..5e 是**补录 1.2.9 遗漏**（本地无调用方、零行为变化），5f..5l 是 1.2.10 的新修复。
  {
    id: 'delta-5a',
    note: '1.2.9：unchangedAsync 支持 snapshot.reread() 钩子（调用方可用自定义重读取代直接 readSnapshotAsync）。本地无调用方 ⇒ 不传时与原来完全等价。',
    from: 'async function unchangedAsync(snapshot) {\n'
      + '  const now = await readSnapshotAsync(snapshot.root, snapshot.id, snapshot.aliases, snapshot.cache || null);\n'
      + '  return now.files.size === snapshot.files.size &&',
    to: 'async function unchangedAsync(snapshot) {\n'
      + '  const now = snapshot.reread ? await snapshot.reread() : await readSnapshotAsync(snapshot.root, snapshot.id, snapshot.aliases, snapshot.cache || null);\n'
      + '  return now.files.size === snapshot.files.size &&',
  },
  {
    id: 'delta-5b',
    note: '1.2.9：targetBytesAsync 支持 source.rewriteBytes(key, file, target) 钩子。⚠️ 这是 1.2.10 重绑的前置 —— 重绑逻辑用 `!source.rewriteBytes` 避开钩子已处理的 key。',
    from: 'async function targetBytesAsync(key, file, source, target) {\n'
      + "  if (key !== 'artifact-index/__session__.json') return null;",
    to: 'async function targetBytesAsync(key, file, source, target) {\n'
      + '  if (source.rewriteBytes) return source.rewriteBytes(key, file, target);\n'
      + "  if (key !== 'artifact-index/__session__.json') return null;",
  },
  {
    id: 'delta-5c',
    note: '1.2.9：applySnapshotAsync 的相对路径解析支持 target.resolveRelative(key) 钩子（默认仍走 targetRelative）。',
    from: '      key, relative: targetRelative(key, target.id), bytes, sourceFile: file,\n'
      + '      hash, size: bytes ? bytes.length : file.size, mode: file.mode, mtimeMs: file.mtimeMs,',
    to: '      key, relative: target.resolveRelative ? target.resolveRelative(key) : targetRelative(key, target.id), bytes, sourceFile: file,\n'
      + '      hash, size: bytes ? bytes.length : file.size, mode: file.mode, mtimeMs: file.mtimeMs,',
  },
  {
    id: 'delta-5d',
    note: '1.2.9：verifyPublished 里的目标重读也走 target.reread() 钩子。⚠️ 与 5a 同形但在不同函数内 ⇒ 带上后一行做作用域限定。',
    from: '    const now = await readSnapshotAsync(target.root, target.id, target.aliases, target.cache || null);\n'
      + '    if (now.files.size !== expected.size || [...expected].some(([key, hash]) => now.files.get(key)?.hash !== hash)) {',
    to: '    const now = target.reread ? await target.reread() : await readSnapshotAsync(target.root, target.id, target.aliases, target.cache || null);\n'
      + '    if (now.files.size !== expected.size || [...expected].some(([key, hash]) => now.files.get(key)?.hash !== hash)) {',
  },
  {
    id: 'delta-5e',
    note: '1.2.9：新增 node:stream 的 Readable 与 pipeline 导入 —— 1.2.10 的 rebind 流式写盘要用。',
    from: "const { StringDecoder } = require('node:string_decoder');\n",
    to: "const { StringDecoder } = require('node:string_decoder');\n"
      + "const { Readable } = require('node:stream');\n"
      + "const { pipeline } = require('node:stream/promises');\n",
  },
  {
    id: 'delta-5f',
    note: '1.2.10：新增 RUNTIME_IDENTITY_REPAIR 运行时标记（供 applySnapshotAsync 的「只修身份」模式识别）。',
    from: 'const DEFAULT_SYNC_BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;\n',
    to: 'const DEFAULT_SYNC_BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;\n'
      + "const RUNTIME_IDENTITY_REPAIR = Symbol('runtime-identity-repair');\n",
  },
  {
    id: 'delta-5g',
    note: '1.2.10 ⭐ 核心修复：会话复制时必须重写 transcript 记录里的 sessionId。CLI 从记录内容（不是文件名）恢复运行身份，留着源 id 会把 steer / 权限事件路由回原会话。只改记录外壳（record.sessionId），绝不全局替换 —— 工具参数/结果/消息 id/用户原文都可能合法含同一串。',
    from: 'function targetBytes(key, file, source, target) {',
    to: [
      '// The CLI restores its runtime identity from transcript records, not the',
      "// filename. Leaving A's sessionId in B's copy routes steer and permission",
      '// events to A. Only rewrite the record envelope: tool arguments, results,',
      '// message IDs and user text can legitimately contain the same string.',
      'function rebindTranscriptLine(line, aliases, id) {',
      '  if (!line.trim()) return line;',
      '  let record;',
      "  try { record = JSON.parse(line); } catch (_) { throw Error('会话消息文件未写完或已损坏，未同步'); }",
      "  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.type !== 'string') {",
      "    throw Error('会话消息格式不受支持，未同步');",
      '  }',
      '  if (record.sessionId === id || !aliases.includes(record.sessionId)) return line;',
      '  record.sessionId = id;',
      "  return JSON.stringify(record) + (line.endsWith('\\r') ? '\\r' : '');",
      '}',
      '',
      'async function* reboundTranscript(file, aliases, id) {',
      "  let pending = '';",
      '  // Keep the async copy path streaming even for very large conversations.',
      "  for await (const chunk of fs.createReadStream(file.sourcePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 })) {",
      '    const text = pending + chunk;',
      '    let start = 0;',
      '    const output = [];',
      '    for (;;) {',
      "      const newline = text.indexOf('\\n', start);",
      '      if (newline < 0) break;',
      "      output.push(rebindTranscriptLine(text.slice(start, newline), aliases, id) + '\\n');",
      '      start = newline + 1;',
      '    }',
      '    pending = text.slice(start);',
      "    if (output.length) yield output.join('');",
      '  }',
      '  if (pending) yield rebindTranscriptLine(pending, aliases, id);',
      '}',
      '',
      'async function reboundTranscriptInfo(file, aliases, id) {',
      "  const hash = crypto.createHash('sha256');",
      '  let size = 0;',
      '  for await (const chunk of reboundTranscript(file, aliases, id)) {',
      '    hash.update(chunk);',
      '    size += Buffer.byteLength(chunk);',
      '  }',
      "  return { hash: hash.digest('hex'), size };",
      '}',
      '',
      'function targetBytes(key, file, source, target) {',
    ].join('\n'),
  },
  {
    id: 'delta-5h',
    note: '1.2.10：同步版 targetBytes 支持 rewriteBytes 钩子；且对 transcript 直接做重绑（同步路径）。',
    from: 'function targetBytes(key, file, source, target) {\n'
      + "  if (key !== 'artifact-index/__session__.json') return file.bytes;",
    to: 'function targetBytes(key, file, source, target) {\n'
      + '  if (source.rewriteBytes) return source.rewriteBytes(key, file, target);\n'
      + '  if (/^projects\\/[^/]+\\/__session__\\.jsonl$/.test(key)) {\n'
      + "    return Buffer.from(file.bytes.toString('utf8').split('\\n')\n"
      + "      .map(line => rebindTranscriptLine(line, source.aliases, target.id)).join('\\n'));\n"
      + '  }\n'
      + "  if (key !== 'artifact-index/__session__.json') return file.bytes;",
  },
  {
    id: 'delta-5i',
    note: '1.2.10：applySnapshotAsync 支持「只修身份」模式（source === target、只处理 transcriptKey）。',
    from: 'async function applySnapshotAsync(source, target, options) {\n'
      + '  const { backupRoot, commit = async () => {}, guard = async () => {}, missingOnly = false,\n'
      + '    onProgress = () => {} } = options;\n'
      + "  if (source.root !== target.root || source.id === target.id) throw Error('无效的会话同步目标');\n"
      + '  const changes = [];\n'
      + '  for (const [key, file] of source.files) {\n'
      + '    if (missingOnly && target.files.has(key)) continue;',
    to: 'async function applySnapshotAsync(source, target, options) {\n'
      + '  const { backupRoot, commit = async () => {}, guard = async () => {}, missingOnly = false,\n'
      + '    onProgress = () => {} } = options;\n'
      + '  const repairIdentityOnly = options[RUNTIME_IDENTITY_REPAIR] === true && source === target;\n'
      + "  if (source.root !== target.root || (source.id === target.id && !repairIdentityOnly)) throw Error('无效的会话同步目标');\n"
      + '  const changes = [];\n'
      + '  for (const [key, file] of source.files) {\n'
      + '    if (repairIdentityOnly && key !== source.transcriptKey) continue;\n'
      + '    if (missingOnly && target.files.has(key)) continue;',
  },
  {
    id: 'delta-5j',
    note: '1.2.10：applySnapshotAsync 计算 hash/size 时走流式重绑（避免大文件整份进内存）。',
    from: '    const bytes = await targetBytesAsync(key, file, source, target);\n'
      + '    const hash = bytes ? digest(bytes) : file.hash;\n'
      + '    if (target.files.get(key)?.hash === hash) continue;\n'
      + '    changes.push({\n'
      + '      key, relative: target.resolveRelative ? target.resolveRelative(key) : targetRelative(key, target.id), bytes, sourceFile: file,\n'
      + '      hash, size: bytes ? bytes.length : file.size, mode: file.mode, mtimeMs: file.mtimeMs,\n'
      + '    });',
    to: '    const bytes = await targetBytesAsync(key, file, source, target);\n'
      + '    const rebind = !source.rewriteBytes && /^projects\\/[^/]+\\/__session__\\.jsonl$/.test(key);\n'
      + '    const rewritten = rebind ? await reboundTranscriptInfo(file, source.aliases, target.id) : null;\n'
      + '    const hash = rewritten ? rewritten.hash : bytes ? digest(bytes) : file.hash;\n'
      + '    if (target.files.get(key)?.hash === hash) continue;\n'
      + '    changes.push({\n'
      + '      key, relative: target.resolveRelative ? target.resolveRelative(key) : targetRelative(key, target.id), bytes, sourceFile: file,\n'
      + '      rebind, hash, size: rewritten ? rewritten.size : bytes ? bytes.length : file.size, mode: file.mode, mtimeMs: file.mtimeMs,\n'
      + '    });',
  },
  {
    id: 'delta-5k',
    note: '1.2.10：「只修身份」模式若无变更则提前返回（避免走完整备份/提交流程）。',
    from: '  if (!missingOnly) for (const [key, file] of target.files) {\n'
      + '    if (!source.files.has(key)) changes.push({ key, relative: file.relative, bytes: null, sourceFile: null, hash: null, size: 0 });\n'
      + '  }\n'
      + '  const backupEntries = changedTargetFiles(changes, target);',
    to: '  if (!missingOnly) for (const [key, file] of target.files) {\n'
      + '    if (!source.files.has(key)) changes.push({ key, relative: file.relative, bytes: null, sourceFile: null, hash: null, size: 0 });\n'
      + '  }\n'
      + '  if (repairIdentityOnly && !changes.length) return { copied: 0, copiedBytes: 0, totalBytes: target.totalBytes };\n'
      + '  const backupEntries = changedTargetFiles(changes, target);',
  },
  {
    id: 'delta-5l',
    note: '1.2.10：异步写盘时走流式重绑（pipeline + Readable.from），确保大会话不整份进内存。',
    from: '        try {\n'
      + "          if (change.bytes) await fs.promises.writeFile(staged, change.bytes, { mode: change.mode || 0o600, flag: 'wx' });",
    to: '        try {\n'
      + '          if (change.rebind) await pipeline(\n'
      + '            Readable.from(reboundTranscript(change.sourceFile, source.aliases, target.id)),\n'
      + "            fs.createWriteStream(staged, { mode: change.mode || 0o600, flags: 'wx' })\n"
      + '          );\n'
      + "          else if (change.bytes) await fs.promises.writeFile(staged, change.bytes, { mode: change.mode || 0o600, flag: 'wx' });",
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
