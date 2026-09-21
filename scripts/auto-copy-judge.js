'use strict';
/*
 * auto-copy-judge.js —— 方案 D 的**本地层**：叠在上游 session-sync.js 之上，只做三件事。
 *
 * 分层的理由（见 .workbuddy/memory/2026-09-20.md §L、SKILL §41.7）：
 *   session-sync.js 是**无状态判据 + 事务写入器**（不认血缘、不做 fan-out），可以当地基。
 *   本地那套编排（多账号 fan-out、产物二阶段、归档隔离 I-1）叠在它上面。
 *   本模块就是两者的**缝合件**，不改上游语义。
 *
 * 本模块负责：
 *   ① 快照域切分 —— 把 workspace/sessions/<id>/ 排除在内容快照之外。
 *      它体积可达数百 MB（本机最大单条约 709MB），留在快照里等于把整个目录读进内存，
 *      会把「产物走第二阶段」这个既有收益全吐回去。且 v1.4.1 已裁定「产物分歧不参与冲突判定」，
 *      由 copySessionWorkspacePayload 的「目标侧不落后才跳过」兜底 —— 排除是**延续该裁决**。
 *   ② 指纹 memo —— 成员的文件元数据指纹没变，就整份复用上次的快照，跳过读盘与 sha256。
 *      实测读一份 435MB 会话约 1.24s；21 条血缘 × N 成员每次切号全量哈希，代价不可接受。
 *   ③ 统一的读入口 + 一个「slim 快照不许拿去写盘」的硬护栏。
 *   ④ 事务写入的**备份清理**（pruneSessionSyncBackups）—— 见下。
 *
 * ⚠️⚠️ mtime 在这里再次出现，但**用途被严格限定**：
 *   它只回答「要不要重算这份快照」，**绝不回答「两份内容谁赢」**。
 *   —— 这正是上游那句 `File times are only race detectors; they never choose a winning conversation.`
 *   的同一条哲学，只是用途从「探测竞态」扩到「避免重复哈希」。
 *   信任依据：任何普通写入都会更新 ctime（显式改 mtime 也会），所以
 *   (size, mtimeMs, ctimeMs) 三元组一致 ⇒ 内容极不可能变化。再加 TTL 兜底，失效窗口可自愈。
 *   ⚠️ 反过来说：**指纹遍历只允许多收，不允许少收** —— 少收一个文件就会误命中缓存、
 *   把「内容已变」误判成「没变」。所以遍历范围必须与 sessionSync.readSnapshot 的访问集**完全一致**。
 *
 * ⚠️ slim 快照只有 hash/semantic，**没有 bytes**，只能喂给 compareSnapshots / selectTargetSnapshot。
 *   applySnapshot 写盘时要 `file.bytes`（还要给目标做备份），必须用 readWritableSnapshot 重新读。
 *   传错会有静默写坏的风险，所以 assertWritable() 把它变成显式报错。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sessionSync = require('./session-sync.js');

/** 排除在内容快照之外的根。产物体积最大，且按既有裁决不参与冲突判定。 */
const JUDGE_SKIP_PREFIXES = Object.freeze(['workspace/sessions']);

/** 指纹走查的安全阀：拒绝被病态目录拖死（真机现最大 7294 个文件）。 */
const MAX_WALK_FILES = 200000;

/** 缓存 TTL：即便元数据指纹没变，超过这个时长也强制重算一次，作为失效窗口的自愈兜底。 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const digest = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** key = root\u0000id\u0000aliasKey  →  { fingerprint, at, slim } */
const cache = new Map();
const stats = { hits: 0, misses: 0, walks: 0, walkFailures: 0, reads: 0 };

function judgeSkipPrefixes() {
  return [...JUDGE_SKIP_PREFIXES];
}

function assertSessionId(id) {
  if (!id || /[/\\\x00]/.test(id) || id === '.' || id === '..') throw new Error('无效的会话标识');
}

/**
 * 只做元数据遍历（不读内容），算出一个能把「文件集合 + 每个文件的大小/两个时间戳」压成一行的指纹。
 * 访问集必须与 sessionSync.readSnapshot 一致（含 projects/<proj>/<id>.jsonl 与 <id>/、artifact-index/<id>.json）。
 * @returns {{fingerprint: string, files: number}|null} null 表示超出安全阀（此时放弃缓存，直接全量读）
 */
function walkFingerprint(root, id, skipPrefixes) {
  const parts = [];
  let files = 0;
  let overflow = false;
  const visit = (relative) => {
    if (overflow) return;
    const abs = path.join(root, relative);
    let st;
    try { st = fs.lstatSync(abs); } catch (_) { return; }
    if (st.isSymbolicLink()) { parts.push(relative + '|L|' + st.mtimeMs); return; }
    if (st.isFile()) {
      files += 1;
      if (files > MAX_WALK_FILES) { overflow = true; return; }
      parts.push(relative + '|F|' + st.size + '|' + st.mtimeMs + '|' + st.ctimeMs);
      return;
    }
    if (!st.isDirectory()) { parts.push(relative + '|O|' + st.mtimeMs); return; }
    let entries;
    try { entries = fs.readdirSync(abs).sort(); } catch (_) { return; }
    for (const name of entries) visit(relative + '/' + name);
  };

  const projectNames = [];
  try {
    for (const entry of fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) projectNames.push(entry.name);
    }
  } catch (_) {}
  projectNames.sort();
  for (const name of projectNames) {
    visit('projects/' + name + '/' + id + '.jsonl');
    visit('projects/' + name + '/' + id);
  }
  for (const prefix of ['workspace/sessions', 'tasks', 'file-history']) {
    if (skipPrefixes.has(prefix)) continue;
    visit(prefix + '/' + id);
  }
  visit('artifact-index/' + id + '.json');

  return overflow ? null : { fingerprint: digest(parts.join('\n')), files };
}

function slimOf(snapshot) {
  return {
    root: snapshot.root,
    id: snapshot.id,
    aliases: snapshot.aliases,
    files: new Map([...snapshot.files].map(([key, file]) => [key, {
      relative: file.relative, hash: file.hash, semantic: file.semantic, mode: file.mode, mtimeMs: file.mtimeMs,
    }])),
    records: snapshot.records,
    transcriptKey: snapshot.transcriptKey,
    skipPrefixes: snapshot.skipPrefixes,
    slim: true,
  };
}

function cacheKey(root, id, aliases) {
  const aliasKey = [...new Set([id, ...(aliases || []).map(String)])].sort().join(',');
  return root + '\u0000' + id + '\u0000' + aliasKey;
}

function remember(root, id, aliases, walked, slim) {
  if (!walked) return slim;
  cache.set(cacheKey(root, id, aliases), { fingerprint: walked.fingerprint, at: Date.now(), slim });
  return slim;
}

/**
 * 判定用快照（slim，不含 bytes）。命中缓存时不做任何文件读取，也不做 sha256。
 * ⚠️ 只能喂给 compareSnapshots / selectTargetSnapshot，**不能**喂给 applySnapshot。
 */
function readJudgedSnapshot(root, id, aliases = []) {
  const resolved = path.resolve(root);
  assertSessionId(id);
  const skip = new Set(JUDGE_SKIP_PREFIXES);
  const walked = walkFingerprint(resolved, id, skip);
  if (walked) {
    stats.walks += 1;
    const hit = cache.get(cacheKey(resolved, id, aliases));
    if (hit && hit.fingerprint === walked.fingerprint && (Date.now() - hit.at) < CACHE_TTL_MS) {
      stats.hits += 1;
      return hit.slim;
    }
  } else {
    stats.walkFailures += 1;
  }
  stats.misses += 1;
  stats.reads += 1;
  const full = sessionSync.readSnapshot(resolved, id, aliases, { skipPrefixes: judgeSkipPrefixes() });
  // 只构造一次 slim：存进缓存的那份与返回给调用方的**必须是同一个对象**，
  // 否则「命中即复用」名不副实，而且每次 miss 都白白多分配一份 Map。
  return remember(resolved, id, aliases, walked, slimOf(full));
}

/** 写盘用快照（含 bytes）。总是重新读 —— 不能拿缓存去写盘。 */
function readWritableSnapshot(root, id, aliases = []) {
  const resolved = path.resolve(root);
  assertSessionId(id);
  const skip = new Set(JUDGE_SKIP_PREFIXES);
  const walked = walkFingerprint(resolved, id, skip);
  stats.reads += 1;
  const full = sessionSync.readSnapshot(resolved, id, aliases, { skipPrefixes: judgeSkipPrefixes() });
  remember(resolved, id, aliases, walked, slimOf(full));
  return full;
}

/**
 * 硬护栏：把「拿 slim 快照去写盘」这种会静默写坏的用法变成显式报错。
 * 在把快照交给 sessionSync.applySnapshot 之前调用。
 */
function assertWritable(snapshot, label = 'source') {
  if (!snapshot) throw new Error('快照为空，不能用于写盘：' + label);
  if (snapshot.slim) throw new Error('slim 快照（仅判定用，无 bytes）不能用于写盘：' + label + '，请改用 readWritableSnapshot');
  for (const [key, file] of snapshot.files) {
    if (!Buffer.isBuffer(file.bytes)) throw new Error('快照缺少原始字节，不能用于写盘：' + label + '/' + key);
  }
}

/** 目标被写过之后必须清掉它的缓存（applySnapshot 会把 mtime 设回源文件的 mtime，靠 ctime 兜底但别赌）。 */
function evictCache(root, id) {
  const prefix = path.resolve(root) + '\u0000' + String(id) + '\u0000';
  let removed = 0;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) { cache.delete(key); removed += 1; }
  }
  return removed;
}

function clearJudgeCache() {
  const size = cache.size;
  cache.clear();
  return size;
}

function judgeStats() {
  return Object.assign({ size: cache.size, ttlMs: CACHE_TTL_MS }, stats);
}

/* ---------------- 事务写入（applySnapshot）的备份清理 ---------------- */

/**
 * applySnapshot 的备份保留份数。备份是**回滚凭据**，不是历史归档：
 * 回滚发生在 applySnapshot 内部、同步完成（journal 记 rolled-back 后即无用），
 * 留最近几份只为保留 `recovery-needed` 的现场。
 */
const SYNC_BACKUP_KEEP = 8;

/** 备份目录名形态：applySnapshot 用 `fs.mkdtempSync(path.join(backupRoot, 'sync-'))` 生成。 */
const SYNC_BACKUP_NAME = /^sync-[A-Za-z0-9]{6}$/;

/**
 * 把事务备份目录裁剪到最近 keep 份。
 *
 * 为什么必须做：`applySnapshot` 每次写盘都会把**目标会话的全部旧字节**复制一份进 backupRoot。
 * 清理缺位 = 每次切号都在 DATA_DIR 里多堆一份会话全量副本（本机单条正文可达数十 MB）。
 *
 * 为什么按 mtime 排序而不是目录名：`mkdtemp` 的 6 位后缀是**随机串**，字典序与时间无关 ——
 * 按名排序会把最新那份当旧的删掉。
 *
 * ⚠️ 安全边界：只删「名字形如 `sync-XXXXXX` 的**真目录**」，且只在调用方给的 backupRoot 一层内，
 *    不递归进任意路径、不解引用符号链接。识别不出的条目一律保留。
 *
 * @param {string} backupRoot
 * @param {number} [keep]
 * @returns {{kept:number, removed:number, failed:number, skipped:boolean}}
 */
function pruneSessionSyncBackups(backupRoot, keep = SYNC_BACKUP_KEEP) {
  const result = { kept: 0, removed: 0, failed: 0, skipped: false };
  if (!backupRoot) { result.skipped = true; return result; }
  let entries;
  try { entries = fs.readdirSync(backupRoot, { withFileTypes: true }); }
  catch (_) { result.skipped = true; return result; }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!SYNC_BACKUP_NAME.test(entry.name)) continue;
    const full = path.join(backupRoot, entry.name);
    let stat;
    try { stat = fs.lstatSync(full); } catch (_) { continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    dirs.push({ full, at: Number(stat.mtimeMs || 0) });
  }
  dirs.sort((a, b) => b.at - a.at); // 新的在前
  const limit = Math.max(0, Number(keep) || 0);
  for (const dir of dirs) {
    if (result.kept < limit) { result.kept += 1; continue; }
    try { fs.rmSync(dir.full, { recursive: true, force: true }); result.removed += 1; }
    catch (_) { result.failed += 1; }
  }
  return result;
}

module.exports = {
  SYNC_BACKUP_KEEP,
  pruneSessionSyncBackups,
  JUDGE_SKIP_PREFIXES,
  judgeSkipPrefixes,
  readJudgedSnapshot,
  readWritableSnapshot,
  assertWritable,
  evictCache,
  clearJudgeCache,
  judgeStats,
  // 上游判据透传（daemon 只需 require 本模块一处）
  compareSnapshots: sessionSync.compareSnapshots,
  selectTargetSnapshot: sessionSync.selectTargetSnapshot,
  applySnapshot: sessionSync.applySnapshot,
  readSnapshotFull: sessionSync.readSnapshot,
};
