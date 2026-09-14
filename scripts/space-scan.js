'use strict';
/*
 * space-scan.js —— WorkBuddy 数据根目录的「空间占用」扫描引擎。
 *
 * 目标：回答「哪个账号 / 哪个空间占了多少磁盘、多少个文件」，并支持
 *   ① 异步 + 可中断（外部置标志，扫描器在检查点收尾并返回部分结果）
 *   ② 进度上报（扫描条目数 / 文件数 / 字节数 / 当前路径），允许跑超 2 分钟
 *   ③ 硬链接去重：同 (dev, ino) 只算一份 —— 自动复制对冻结文件建硬链接，
 *      不去重的话「N 个账号的同一份产物」会被算成 N 份，体积虚高
 *   ④ 默认不含文件名（只回聚合数字 + 顶层目录名，不回具体文件路径）
 *
 * 归属规则（见 KEYED_TOPS）来自对真实 dataRoot 的探查（2026-09-14）：
 *   · storage/user-<uid>[-suffix]/        直接就是账号目录
 *   · memory/<uid>_memory.md              账号级文件
 *   · projects/<cwd-slug>/                「空间」目录，里面的 <uuid>.jsonl 是该空间的会话
 *   · workspace/sessions/<uuid>/          按会话 uuid → 账号 + 空间
 *   · file-history | tasks | changes-detail / <uuid>/
 *   · changes-index | file-tree-manifests | artifact-index / <uuid>.json
 *   其余（blobs / logs / binaries / traces / shell-snapshots / sessions/<数字>.json …）
 *   无法可靠归属到某个账号或空间 → 计入 shared，按顶层目录给出明细，绝不硬猜。
 *
 * **重叠口径（重要）**：`accounts` 与 `spaces` 是**同一批字节的两种切法**，不是互斥分区，
 * 所以不能相加当总体积（`overlapping: true` 就是给调用方的显式提醒）。
 * 总体积只看 `totals`：每个文件恰好累加一次。
 *
 * 本模块**不依赖 daemon.js**，可以单独 require 做测试（daemon 会起 HTTP 服务，不能 require）。
 * 会话/空间/账号的映射由调用方通过 resolve* 回调注入，扫描器自己不认识 SQLite。
 *
 * 跑法（测试）：node .wd-analysis/test-space-scan.js
 */

const fs = require('fs');
const path = require('path');

// 结果结构的版本号。改动**归属口径 / 键规则**时必须递增：daemon 读缓存时对不上版本就丢弃重扫，
// 否则旧的错结果会一直显示。v2 = spaceSlug 修正（盘符小写 + `:\` 合并）。
const SPACE_SCAN_VERSION = 2;

// 相对 dataRoot 的顶层路径 → 子项键的解析方式。
//   session-dir   子项是目录，目录名 = 会话 uuid
//   session-file  子项是文件，文件名去 ext 后 = 会话 uuid
//   account-dir   子项是目录，名字形如 user-<uid> 或 user-<uid>-<suffix>
//   account-file  子项是文件，名字形如 <uid>_<name>.md（uuid 内不含 `_`，取第一个 `_` 之前）
//   space-dir     子项是目录，目录名是 cwd 的 slug；其内部的 <uuid>.jsonl 仍按会话归属
const KEYED_TOPS = [
  { rel: 'workspace/sessions', key: 'session-dir' },
  { rel: 'file-history', key: 'session-dir' },
  { rel: 'tasks', key: 'session-dir' },
  { rel: 'changes-detail', key: 'session-dir' },
  { rel: 'changes-index', key: 'session-file', ext: '.json' },
  { rel: 'file-tree-manifests', key: 'session-file', ext: '.json' },
  { rel: 'artifact-index', key: 'session-file', ext: '.json' },
  { rel: 'projects', key: 'space-dir', sessionExt: '.jsonl' },
  { rel: 'storage', key: 'account-dir' },
  { rel: 'memory', key: 'account-file' },
];

const KEYED_BY_REL = new Map(KEYED_TOPS.map((entry) => [entry.rel, entry]));

/**
 * cwd → WorkBuddy 的 projects 目录名。
 *
 * 实测规则（2026-09-14 用 sessions 表里 77 个真实 cwd 去对 projects/ 目录名反推，
 * 命中 76/77，唯一未命中的那条是 projects 目录本身已不存在）：
 *   ① 盘符字母转小写（**只转盘符**，路径其余部分大小写照原）；
 *   ② 紧跟盘符的 `:` + `\`　合并成**一个** `-`；
 *   ③ 其余 `\` 与 `/` 各换一个 `-`；空格、点、中文等一律原样保留。
 *
 * 例：`D:\WorkBuddy date\2026-08-11-17-57-19` → `d-WorkBuddy date-2026-08-11-17-57-19`
 *     `C:\Users\Lyon\WorkBuddy\2026-08-11-14-13-10` → `c-Users-Lyon-WorkBuddy-2026-08-11-14-13-10`
 *
 * ⚠️ 早期写成 `replace(/[:\\/]/g, '-')` 是**错的**：会把 `D:\` 变成 `D--`，于是
 * projects/ 下每一个目录都解析不出 cwd（全部落到 resolved:false），空间归属静默失效。
 */
function spaceSlug(cwd) {
  const raw = String(cwd == null ? '' : cwd);
  if (!raw) return '';
  return (raw[0].toLowerCase() + raw.slice(1))
    .replace(/:[\\/]/, '-')
    .replace(/[\\/]/g, '-');
}

function makeBucket() {
  return { bytes: 0, rawBytes: 0, files: 0, dirs: 0, sessions: 0 };
}

function finalizeBucket(bucket) {
  return {
    bytes: bucket.bytes,
    rawBytes: bucket.rawBytes,
    files: bucket.files,
    dirs: bucket.dirs,
    sessions: bucket.sessions,
  };
}

/** 从 `1d80c722-....-591236f90c70_memory.md` 里取 uid */
function accountFileUid(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  return base.split('_')[0] || '';
}

/**
 * 扫描 dataRoot。
 *
 * @param {string} root  数据根目录（daemon 传 PROFILE.dataRoot）
 * @param {object} [options]
 *   resolveSession(key) -> {uid, cwd} | null     会话 uuid → 归属
 *   resolveAccountName(name) -> uid | null       storage/ 下的目录名 / 文件名 → uid
 *   resolveSpaceSlug(slug) -> cwd | null         projects/ 下的 slug → cwd
 *   onProgress(info) -> void
 *   shouldCancel() -> boolean
 *   progressEvery {number}  每 N 个条目上报一次进度（默认 200）
 *   maxEntries {number}     最多处理 N 个条目，测试用（默认 Infinity）
 *   yieldEvery {number}     每 N 个条目让出一次事件循环（默认 200）
 * @returns {Promise<object>} 结果快照（不写盘，落盘由调用方决定）
 */
async function scanSpace(root, options = {}) {
  const startedAt = Date.now();
  const resolveSession = typeof options.resolveSession === 'function' ? options.resolveSession : () => null;
  const resolveAccountName = typeof options.resolveAccountName === 'function' ? options.resolveAccountName : null;
  const resolveSpaceSlug = typeof options.resolveSpaceSlug === 'function' ? options.resolveSpaceSlug : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
  const progressEvery = Number.isFinite(options.progressEvery) ? options.progressEvery : 200;
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : Infinity;
  const yieldEvery = Number.isFinite(options.yieldEvery) ? options.yieldEvery : 200;

  const totals = {
    bytes: 0, rawBytes: 0, files: 0, dirs: 0,
    unreadable: 0, skippedLinks: 0, dedupedFiles: 0, dedupedBytes: 0,
  };
  const accounts = new Map();   // uid -> bucket
  const spaces = new Map();     // cwd | slug -> bucket（带 cwd/resolved 元信息）
  const shared = new Map();     // 顶层名 -> bucket
  const unattributed = makeBucket();
  const accountSessions = new Map();  // uid -> Set(sessionKey)
  const spaceSessions = new Map();    // cwd -> Set(sessionKey)
  const seenLinks = new Set();        // 只登记 nlink>1 的 (dev,ino)

  let processed = 0;
  let cancelled = false;
  let currentPath = '';
  const stack = [];

  const bucketFor = (map, key, extra) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = Object.assign(makeBucket(), extra || {});
      map.set(key, bucket);
    }
    return bucket;
  };

  // 会话键 → 归属。返回 {buckets, resolved}：
  //   resolved=false 时 buckets 里没有账号视图（要么归未归属、要么只保住父级空间视图）。
  const sessionBuckets = (key) => {
    const info = resolveSession(key);
    if (!info || !info.uid) return { buckets: [], resolved: false };
    const list = [];
    const acct = bucketFor(accounts, info.uid);
    list.push(acct);
    if (!accountSessions.has(info.uid)) accountSessions.set(info.uid, new Set());
    accountSessions.get(info.uid).add(key);
    if (info.cwd) {
      const space = bucketFor(spaces, info.cwd, { cwd: info.cwd, resolved: true });
      list.push(space);
      if (!spaceSessions.has(info.cwd)) spaceSessions.set(info.cwd, new Set());
      spaceSessions.get(info.cwd).add(key);
    }
    return { buckets: list, resolved: true };
  };

  const accountNameBuckets = (name) => {
    const uid = resolveAccountName ? resolveAccountName(name) : null;
    return [uid ? bucketFor(accounts, uid) : unattributed];
  };

  const spaceDirBuckets = (slug) => {
    const cwd = resolveSpaceSlug ? resolveSpaceSlug(slug) : null;
    return [bucketFor(spaces, cwd || slug, cwd ? { cwd, resolved: true } : { cwd: slug, slug, resolved: false })];
  };

  // 处理一个文件：去重判定 → 记入 totals（恰好一次）+ 每个归属 bucket
  const handleFile = async (filePath, buckets) => {
    let lstat = null;
    try { lstat = await fs.promises.lstat(filePath); }
    catch (_) {
      totals.unreadable += 1;
      for (const b of buckets) { b.files += 1; }
      return;
    }
    if (lstat.isSymbolicLink()) {
      totals.skippedLinks += 1;
      for (const b of buckets) { b.files += 1; }
      return;
    }
    const size = Number(lstat.size) || 0;
    const links = Number(lstat.nlink || 1);
    let counted = true;
    if (links > 1) {
      const id = String(lstat.dev) + ':' + String(lstat.ino);
      if (seenLinks.has(id)) {
        counted = false;
        totals.dedupedFiles += 1;
        totals.dedupedBytes += size;
      } else {
        seenLinks.add(id);
      }
    }
    totals.files += 1;
    totals.rawBytes += size;
    if (counted) totals.bytes += size;
    for (const b of buckets) {
      b.files += 1;
      b.rawBytes += size;
      if (counted) b.bytes += size;
    }
  };

  const addDir = (buckets) => {
    totals.dirs += 1;
    for (const b of buckets) b.dirs += 1;
  };

  const report = (final) => {
    if (!onProgress) return;
    onProgress({
      processed,
      files: totals.files,
      bytes: totals.bytes,
      rawBytes: totals.rawBytes,
      dirs: totals.dirs,
      dedupedFiles: totals.dedupedFiles,
      dedupedBytes: totals.dedupedBytes,
      unreadable: totals.unreadable,
      current: currentPath,
      final: !!final,
    });
  };
  // 递归一个目录。keyEntry 决定「子项」怎么归属；innerBuckets 是父级已经定好的归属，
  // 会作为「整棵子树」的默认归属往下传（会话目录 / 空间目录 / 账号目录都靠它）。
  // 两者都为空的顶层子树落到 shared[顶层名]。
  const walk = async (rel, topName, keyEntry, innerBuckets) => {
    currentPath = rel;
    const dir = path.join(root, rel);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { totals.unreadable += 1; return; }

    for (const entry of entries) {
      if (cancelled || processed >= maxEntries) return;
      const childRel = rel + '/' + entry.name;
      const childPath = path.join(root, childRel);
      let buckets;
      let childKeyEntry = null;
      let childInner = null;

      if (!keyEntry) {
        // 目录内部的归属沿用父级；没有父级归属就落到 shared[顶层名]。
        // ⚠️ 必须把 buckets 继续作为 childInner 往下传 —— 漏了这一步，
        // 会话目录里**再嵌一层目录**（真实数据就是 workspace/sessions/<uuid>/<子目录>/<文件>）
        // 就会在这一层丢掉归属，整棵子树静默落进 shared。
        buckets = innerBuckets || [bucketFor(shared, topName)];
        childInner = buckets;
      } else if (keyEntry.key === 'session-dir') {
        // 会话目录：目录本身没有字节，真正要归属的是它里面的文件，
        // 所以把会话的 buckets 作为 innerBuckets 传下去。
        if (entry.isDirectory()) {
          const result = sessionBuckets(entry.name);
          childInner = result.resolved ? result.buckets : (innerBuckets || [unattributed]);
          buckets = childInner;
        } else {
          buckets = [unattributed];
        }
      } else if (keyEntry.key === 'session-file') {
        const ext = keyEntry.ext || '';
        const key = ext && entry.name.endsWith(ext) ? entry.name.slice(0, -ext.length) : entry.name;
        if (entry.isFile()) {
          const result = sessionBuckets(key);
          // bucketFor 对同一个 cwd 返回同一个 bucket 对象，所以按引用去重就够了；
          // 父级空间视图（projects/<slug>/）与会话自带的 cwd 视图通常是同一个。
          const list = result.resolved ? result.buckets.slice() : [];
          for (const b of (innerBuckets || [])) if (list.indexOf(b) < 0) list.push(b);
          buckets = list.length ? list : [unattributed];
        } else {
          buckets = innerBuckets || [unattributed];
          childInner = buckets;
        }
      } else if (keyEntry.key === 'account-dir') {
        buckets = accountNameBuckets(entry.name);
        if (entry.isDirectory()) childInner = buckets;
      } else if (keyEntry.key === 'account-file') {
        // storage/ 与 memory/ 下都是文件；万一是目录，按同类继续往下走
        buckets = entry.isDirectory() ? (innerBuckets || [unattributed]) : accountNameBuckets(accountFileUid(entry.name));
        if (entry.isDirectory()) childInner = buckets;
      } else if (keyEntry.key === 'space-dir') {
        buckets = spaceDirBuckets(entry.name);
        if (entry.isDirectory()) {
          childInner = buckets;
          // projects/<slug>/<uuid>.jsonl 是该空间的会话：文件字节同时计入该空间，
          // 因此把空间视图作为 innerBuckets 传下去，会话解析不出来也不会丢归属。
          if (keyEntry.sessionExt) childKeyEntry = { key: 'session-file', ext: keyEntry.sessionExt };
        }
      } else {
        buckets = [unattributed];
      }

      if (entry.isDirectory()) {
        addDir(buckets);
        // 子**路径**本身就是登记过的归属规则（如 workspace 是空的、真正要按会话走的是
        // workspace/sessions）→ 从这一层起换成对应规则，并把继承来的归属**清掉**：
        // 否则「解析不出来的会话」会退到父级的 shared 桶，而不是老老实实落到「未归属」。
        // 放在这里就天然支持任意深度。
        if (!childKeyEntry) {
          const direct = KEYED_BY_REL.get(childRel);
          if (direct) { childKeyEntry = direct; childInner = null; }
        }
        stack.push({ rel: childRel, topName, keyEntry: childKeyEntry, inner: childInner });
      } else if (entry.isFile()) {
        await handleFile(childPath, buckets);
      } else {
        totals.skippedLinks += 1;
      }

      processed += 1;
      // 进度里只报「正在遍历的目录」（相对路径），**不带文件名** —— 与结果同样遵守
      // 「默认不含文件名」。目录名本身已经通过 spaces[].cwd / shared[].name 暴露。
      currentPath = rel;
      if (processed % progressEvery === 0) {
        report(false);
        if (shouldCancel()) { cancelled = true; return; }
        if (processed % yieldEvery === 0) await new Promise((r) => setImmediate(r));
      }
    }
  };

  let topEntries = [];
  try { topEntries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch (error) { throw new Error('无法读取数据根目录: ' + ((error && error.message) || error)); }

  for (const entry of topEntries) {
    if (cancelled) break;
    const topName = entry.name;
    const topPath = path.join(root, topName);
    if (!entry.isDirectory()) {
      await handleFile(topPath, [bucketFor(shared, topName)]);
      processed += 1;
      continue;
    }
    const keyEntry = KEYED_BY_REL.get(topName) || null;
    addDir(keyEntry ? [unattributed] : [bucketFor(shared, topName)]);
    stack.push({ rel: topName, topName, keyEntry });
  }

  // 深度优先遍历（显式栈，避免深目录递归爆栈）
  while (stack.length && !cancelled && processed < maxEntries) {
    const job = stack.pop();
    await walk(job.rel, job.topName, job.keyEntry, job.inner || null);
  }

  const finishedAt = Date.now();
  for (const [uid, set] of accountSessions) {
    const bucket = accounts.get(uid);
    if (bucket) bucket.sessions = set.size;
  }
  for (const [cwd, set] of spaceSessions) {
    const bucket = spaces.get(cwd);
    if (bucket) bucket.sessions = set.size;
  }

  const accountsOut = Array.from(accounts.entries())
    .map(([uid, bucket]) => Object.assign({ uid }, finalizeBucket(bucket)))
    .sort((a, b) => b.rawBytes - a.rawBytes);
  const spacesOut = Array.from(spaces.entries())
    .map(([key, bucket]) => {
      const out = finalizeBucket(bucket);
      out.cwd = bucket.cwd || key;
      out.resolved = bucket.resolved !== false;
      if (bucket.slug) out.slug = bucket.slug;
      return out;
    })
    .sort((a, b) => b.rawBytes - a.rawBytes);
  const sharedOut = Array.from(shared.entries())
    .map(([name, bucket]) => Object.assign({ name }, finalizeBucket(bucket)))
    .sort((a, b) => b.rawBytes - a.rawBytes);

  report(true);

  return {
    version: SPACE_SCAN_VERSION,
    root,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    cancelled,
    processed,
    // accounts / spaces 是同一批字节的两种切法，会互相重叠，不能相加
    overlapping: true,
    totals: Object.assign({}, totals),
    accounts: accountsOut,
    spaces: spacesOut,
    shared: sharedOut,
    unattributed: finalizeBucket(unattributed),
  };
}

module.exports = {
  SPACE_SCAN_VERSION,
  KEYED_TOPS,
  spaceSlug,
  accountFileUid,
  scanSpace,
};
