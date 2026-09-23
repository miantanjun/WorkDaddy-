/**
 * 打包白名单守卫（共用 helper）。
 *
 * mac DMG（build-mac-dmg.sh）走的是**显式白名单**，Windows 走 `cp -R` 整目录 ——
 * 所以漏登记一个模块，Windows 上毫无症状，mac 上 daemon 启动即崩。
 *
 * ⚠️ 必须是**传递闭包**：只查 daemon.js 的直接 require 会漏掉二级依赖
 * （如 daemon.js → token-stats.js → stats-discipline.js），那正是 SKILL §40.11
 * 记的既有缺口 —— 2026-09-23 加 thinking-stats.js / stats-discipline.js 时复发过一次。
 */
const fs = require('fs');
const path = require('path');

/** 抓出源码里 `require('./x.js')` 的 x.js（相对路径，即自建模块写法）。 */
function selfRequires(source) {
  return [...new Set(
    [...String(source).matchAll(/require\('\.\/([A-Za-z0-9._-]+\.js)'\)/g)].map((m) => m[1])
  )];
}

/**
 * 从入口模块出发收集**可达**的自建模块（限 scripts/ 下真实存在者）。
 * 存在但未登记 ⇒ 由 macWhitelistMissing 报出来；不存在（第三方 / 可选）⇒ 跳过。
 */
function reachableModules(root, entry = 'daemon.js') {
  const scriptsDir = path.join(root, 'scripts');
  const seen = new Set();
  const queue = selfRequires(fs.readFileSync(path.join(scriptsDir, entry), 'utf8').replace(/\r\n/g, '\n'));
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const abs = path.join(scriptsDir, name);
    if (!fs.existsSync(abs)) continue;
    seen.add(name);
    // ⚠️ 源码是 CRLF，正则不含换行所以其实无所谓；仍归一化，免得以后加了多行匹配踩坑。
    const src = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    selfRequires(src).forEach((next) => { if (!seen.has(next)) queue.push(next); });
  }
  return [...seen].sort();
}

/** 返回「可达但不在 mac 白名单里」的模块名；空数组 = 通过。 */
function macWhitelistMissing(root, entry = 'daemon.js') {
  const mac = fs.readFileSync(path.join(root, 'scripts', 'build-mac-dmg.sh'), 'utf8');
  return reachableModules(root, entry)
    .filter((name) => !new RegExp('(^|[\\s"])' + name.replace(/[.]/g, '\\.') + '($|[\\s;])', 'm').test(mac));
}

module.exports = { selfRequires, reachableModules, macWhitelistMissing };

// CLI：`node .wd-analysis/packaging-whitelist.js [--root=D:/WorkDaddy] [--entry=daemon.js]`
// 供技能手册/CI 直接自查「mac 白名单是否漏了可达模块」。全部登记 ⇒ exit 0，漏了 ⇒ exit 1。
if (require.main === module) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
  };
  const root = arg('root', path.resolve(__dirname, '..'));
  const entry = arg('entry', 'daemon.js');
  const reachable = reachableModules(root, entry);
  const missing = macWhitelistMissing(root, entry);
  console.log('入口 %s  可达自建模块 %d 个', entry, reachable.length);
  if (missing.length) {
    console.log('mac 白名单缺失（必须补 build-mac-dmg.sh 的两处）：');
    missing.forEach((name) => console.log('  - %s', name));
    process.exit(1);
  }
  console.log('mac 白名单 0 缺失 ✓');
  process.exit(0);
}
