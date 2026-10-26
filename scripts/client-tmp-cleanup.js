'use strict';

/**
 * client-tmp 清理（配合 1.2.16 的 TEMP 隔离）。
 *
 * 背景：`workbuddy-launch-env.js` 把客户端的 TEMP/TMP 指到
 * `<dataDir>/client-tmp/<profileId>`，让官方 updater 看不见旧安装包 ——
 * 代价是这个目录会把客户端所有临时文件都收进来（安装包、解压残留、Electron 缓存），
 * 而且上游没做回收。本模块负责按「超龄」回收，既不碰新鲜文件，
 * 也不碰 client-tmp 之外的任何路径。
 */

const fs = require('fs');
const path = require('path');

/** 默认保留 7 天：下载/解压到 TEMP 的东西，超过一周基本没有复用价值。 */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 单轮最多看这么多顶层条目，避免异常目录把 daemon 拖住。 */
const DEFAULT_MAX_ENTRIES = 2000;
/** 统计目录体积时的递归深度上限。 */
const MAX_SIZE_DEPTH = 4;

function clientTmpRoot(dataDir) {
  return path.join(String(dataDir || ''), 'client-tmp');
}

/** 目标必须严格位于 root 之内：防止手改配置或链接把清理带出目录树。 */
function isInside(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 统计体积；不跟随符号链接，超过预算就停（宁可少报，不做无界遍历）。 */
function sizeOf(target, depth, budget) {
  if (budget.left <= 0 || depth > MAX_SIZE_DEPTH) return 0;
  budget.left -= 1;
  let stat;
  try { stat = fs.lstatSync(target); } catch (_) { return 0; }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let names;
  try { names = fs.readdirSync(target); } catch (_) { return 0; }
  let total = 0;
  for (const name of names) total += sizeOf(path.join(target, name), depth + 1, budget);
  return total;
}

/**
 * 只读盘点：返回本轮打算删哪些、合计多少字节，不做任何写操作。
 * 顶层条目按自身 mtime 判龄 —— 目录内部变动会更新目录 mtime，正在用的目录不会被误判。
 */
function planClientTmpCleanup(options = {}) {
  const root = String(options.root || '');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs >= 0
    ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const plan = { root, exists: false, remove: [], kept: 0, bytes: 0, truncated: false };
  if (!root || !path.isAbsolute(root)) return plan;
  if (!fs.existsSync(root)) return plan;
  plan.exists = true;

  let names;
  try { names = fs.readdirSync(root); } catch (_) { return plan; }
  if (names.length > maxEntries) {
    names = names.slice(0, maxEntries);
    plan.truncated = true;
  }

  const budget = { left: maxEntries * 8 };
  for (const name of names) {
    const target = path.join(root, name);
    if (!isInside(root, target)) continue;
    let stat;
    try { stat = fs.lstatSync(target); } catch (_) { continue; }
    if (now - stat.mtimeMs < maxAgeMs) { plan.kept += 1; continue; }
    const isDirectory = stat.isDirectory();
    const bytes = isDirectory ? sizeOf(target, 0, budget) : stat.size;
    plan.remove.push({ path: target, bytes, isDirectory, isLink: stat.isSymbolicLink() });
    plan.bytes += bytes;
  }
  return plan;
}

/**
 * 执行清理。删除失败（典型是客户端正占着文件 → EBUSY）不计为异常：
 * 这一轮跳过，下一轮再收。dryRun 只盘点不动盘。
 */
function runClientTmpCleanup(options = {}) {
  const plan = planClientTmpCleanup(options);
  const result = { ...plan, removed: 0, failed: 0 };
  if (options.dryRun === true) return result;
  const rm = typeof options.rm === 'function'
    ? options.rm
    : (target, opts) => fs.rmSync(target, opts);
  for (const item of plan.remove) {
    try {
      // 符号链接只删链接本身，绝不跟进目标（否则可能删到树外）。
      rm(item.path, item.isLink ? { force: true } : { recursive: true, force: true, maxRetries: 2 });
      result.removed += 1;
    } catch (_) {
      result.failed += 1;
    }
  }
  return result;
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  clientTmpRoot,
  isInside,
  planClientTmpCleanup,
  runClientTmpCleanup,
};
