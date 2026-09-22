'use strict';
/**
 * context-fix.js —— 上下文体检的「执行侧」。
 *
 * 与 context-audit.js 的分工（刻意拆成两个模块）：
 *   · context-audit.js  **只测量**（不写盘、不发网络），产出 findings；
 *   · 本模块            **只执行**，把 findings 里标了 fix.kind='auto' 的动作做掉。
 * 拆开的理由：只读契约不能被破坏 —— 回归 G 组有「切片里不得出现
 * writeFileSync / automationSwitchAccount / fs.renameSync」的只读性守卫，
 * 而修复必然要动文件系统。两条职责混在一个模块里，那个守卫就只能拆掉。
 *
 * 安全铁律（每一条都有过踩坑代价）：
 *   1. **只移动，不删除** —— 一律 rename 到备份目录，用户整目录移回即可还原。
 *   2. **同盘移动** —— 备份目录默认落在 ~/.workbuddy 下（与 plugins/cache 同盘），
 *      否则 rename 会退化成跨盘复制，慢且可能半途失败。
 *   3. **认状态文件，不猜** —— 保留 installed_plugins.json 里 installPath 指向的
 *      版本；只有状态文件缺记录时才回退到「目录名排序取最大」。
 *   4. **分批 + 逐项校验** —— 每批 <= 10，每项立即验「源已消失 + 目标已存在」，
 *      任一失败立即停止，不做「尽力而为」。
 *   5. **dryRun 可先跑** —— 路由支持只列清单不落地。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BATCH_SIZE = 10;

function dateStamp(now) {
  const d = now ? new Date(now) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

function dirSize(target) {
  let st;
  try { st = fs.statSync(target); } catch (_) { return 0; }
  if (st.isFile()) return st.size;
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch (_) { return 0; }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    total += entry.isDirectory() ? dirSize(child) : (() => {
      try { return fs.statSync(child).size; } catch (_) { return 0; }
    })();
  }
  return total;
}

function readActiveVersions(stateFile) {
  // installed_plugins.json: { plugins: { "name@vendor": [ { version, installPath, ... } ] } }
  const active = Object.create(null);
  let raw;
  try { raw = fs.readFileSync(stateFile, 'utf8'); } catch (_) { return active; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return active; }
  const plugins = (parsed && parsed.plugins) || {};
  for (const key of Object.keys(plugins)) {
    const list = plugins[key];
    if (!Array.isArray(list) || !list.length) continue;
    const name = String(key).split('@')[0];
    const first = list[0] || {};
    // version 优先；缺了就从 installPath 末段取
    let version = first.version ? String(first.version) : '';
    if (!version && first.installPath) version = path.basename(String(first.installPath));
    if (version) active[name] = version;
  }
  return active;
}

/**
 * 列出「非激活版本」的插件目录 —— 纯查询，不碰文件系统。
 * 返回 { ok, cacheRoot, backupRoot, items:[{vendor,plugin,version,from,to,bytes}], totalBytes, scanErrors }
 */
function listPruneTargets(options) {
  const opts = options || {};
  // 两种入口都收：`dataRoot` = WorkBuddy 数据根（daemon 里即 PROFILE.dataRoot = <home>/.workbuddy）；
  // `home` = 用户主目录（CLI 便利用法，本模块原始约定）。
  // ⚠️ 别把 dataRoot 传成 home —— 会拼出 <dataRoot>/.workbuddy/plugins/cache（不存在），
  //    表现为静默退化成 no-cache-dir，而不是报参数错。
  const dataRoot = opts.dataRoot || path.join(opts.home || os.homedir(), '.workbuddy');
  const cacheRoot = opts.cacheRoot || path.join(dataRoot, 'plugins', 'cache');
  const stateFile = opts.stateFile || path.join(dataRoot, 'plugins', 'installed_plugins.json');
  const backupRoot = opts.backupRoot
    || path.join(dataRoot, '.bak-cache-legacy-' + dateStamp(opts.now));

  const result = { ok: true, cacheRoot, backupRoot, items: [], totalBytes: 0, scanErrors: 0 };
  if (!fs.existsSync(cacheRoot)) { result.ok = false; result.reason = 'no-cache-dir'; return result; }

  const active = readActiveVersions(stateFile);
  let vendors = [];
  try { vendors = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch (_) { result.ok = false; result.reason = 'cache-unreadable'; return result; }

  for (const vendor of vendors) {
    const vendorDir = path.join(cacheRoot, vendor.name);
    let plugins = [];
    try { plugins = fs.readdirSync(vendorDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
    catch (_) { result.scanErrors++; continue; }
    for (const plugin of plugins) {
      const pluginDir = path.join(vendorDir, plugin.name);
      let versions = [];
      try { versions = fs.readdirSync(pluginDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
      catch (_) { result.scanErrors++; continue; }
      if (versions.length < 2) continue;

      let keep = active[plugin.name];
      if (!keep || versions.indexOf(keep) === -1) keep = versions.slice().sort().pop();

      for (const version of versions) {
        if (version === keep) continue;
        const from = path.join(pluginDir, version);
        const bytes = dirSize(from);
        result.items.push({
          vendor: vendor.name,
          plugin: plugin.name,
          version,
          from,
          to: path.join(backupRoot, vendor.name, plugin.name, version),
          bytes,
        });
        result.totalBytes += bytes;
      }
    }
  }
  return result;
}

/**
 * 执行「清理非激活版本目录」。
 * options: { dataRoot | home, cacheRoot, stateFile, backupRoot, now, dryRun, batchSize }
 * 返回 { ok, moved, failed, bytes, backupRoot, error?, plan? }
 */
function pruneSkillDupes(options) {
  const opts = options || {};
  const plan = listPruneTargets(opts);
  if (!plan.ok) return { ok: false, error: plan.reason || 'scan-failed', moved: 0, failed: 0, bytes: 0 };
  if (opts.dryRun) {
    return { ok: true, dryRun: true, moved: 0, failed: 0, bytes: plan.totalBytes, backupRoot: plan.backupRoot, planned: plan.items.length };
  }
  const batch = Math.max(1, Math.min(50, Number(opts.batchSize) || BATCH_SIZE));
  let moved = 0;
  let failed = 0;
  for (let i = 0; i < plan.items.length; i += batch) {
    const slice = plan.items.slice(i, i + batch);
    for (const item of slice) {
      try {
        fs.mkdirSync(path.dirname(item.to), { recursive: true });
        fs.renameSync(item.from, item.to);
        const srcGone = !fs.existsSync(item.from);
        const dstThere = fs.existsSync(item.to);
        if (!srcGone || !dstThere) { failed++; continue; }
        moved++;
      } catch (_) { failed++; }
    }
    // 不做「尽力而为」：一批里出现失败就停，避免留下半移动状态
    if (failed > 0) break;
  }
  return {
    ok: failed === 0,
    moved,
    failed,
    bytes: plan.items.slice(0, moved).reduce((sum, item) => sum + item.bytes, 0),
    backupRoot: plan.backupRoot,
    planned: plan.items.length,
  };
}

// 每个 auto fix 一个实现。前端按钮只传 fixId，不传路径 —— 路径由后端自己算，
// 免得面板传来任意路径变成「任意文件移动」的入口。
const AUTO_FIXES = {
  'prune-skill-dupes': {
    id: 'prune-skill-dupes',
    run: pruneSkillDupes,
  },
};

function applyContextFix(fixId, options) {
  const fix = AUTO_FIXES[String(fixId || '')];
  if (!fix) return { ok: false, error: 'unknown-fix', fixId: String(fixId || '') };
  const result = fix.run(options || {});
  result.fixId = fix.id;
  return result;
}

module.exports = {
  applyContextFix,
  listPruneTargets,
  pruneSkillDupes,
  readActiveVersions,
  dirSize,
  AUTO_FIX_IDS: Object.keys(AUTO_FIXES),
};
