#!/usr/bin/env node
/**
 * 更新器护栏自检（纯只读，不碰任何数据，可随时跑）
 *
 *   node tools/updater-guard.js
 *
 * 背景：本仓库是 babygoton/WorkDaddy 的 fork，改名与自建发行都只做了「浅改」。
 * 一旦同步上游时把本地补丁覆盖掉，更新器会**静默失效**（不报错、永远显示「已是最新」），
 * 现场极难发现。这个脚本用源码级断言把这类回归卡在提交前。
 *
 * 注意：放在仓库根目录的 tools/ 下，**不要**挪进 scripts/ —— build-win-zip.sh 会整目录
 * 打包 scripts/，测试文件会被塞进用户的安装包。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(id, desc, fn) {
  try {
    const detail = fn();
    results.push({ id, desc, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ id, desc, ok: false, detail: e.message });
  }
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function pick(source, re, label) {
  const m = source.match(re);
  must(m, `未匹配到 ${label}：${re}`);
  return m;
}
const is3Seg = (v) => /^\d+\.\d+\.\d+$/.test(v);
function cmp3(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

const daemon = read('scripts/daemon.js');
const inject = read('scripts/inject.js');
const profiles = read('scripts/profiles.js');
const installer = read('scripts/build-win-installer.ps1');
const workflow = read('.github/workflows/build-win.yml');

// ---------- A. 更新器的资产名正则（改名/换包名后最先失效的地方） ----------
check('A1', 'daemon.js 仍保留 CN 安装包资产正则', () => {
  must(/\/\^WorkDaddy-Setup-\\d\+\\\.\\d\+\\\.\\d\+\\\.exe\$\/i/.test(daemon), 'CN Setup.exe 正则缺失或被改写');
  must(/\/\^WorkDaddy-\\d\+\\\.\\d\+\\\.\\d\+-win64\\\.zip\$\/i/.test(daemon), 'CN ZIP 正则缺失或被改写');
  return 'CN exe/zip 正则在位';
});
check('A2', 'daemon.js 仍保留 AI 安装包资产正则', () => {
  must(/\/\^WorkDaddy-AI-Setup-\\d\+\\\.\\d\+\\\.\\d\+\\\.exe\$\/i/.test(daemon), 'AI Setup.exe 正则缺失或被改写');
  must(/\/\^WorkDaddy-AI-\\d\+\\\.\\d\+\\\.\\d\+-win64\\\.zip\$\/i/.test(daemon), 'AI ZIP 正则缺失或被改写');
  return 'AI exe/zip 正则在位';
});

// ---------- B. 真的产物名能被真的正则匹配（唯一能自动发现「改名忘改正则」的手段） ----------
check('B1', 'build-win-installer.ps1 的 $packageName 仍为 WorkDaddy / WorkDaddy-AI（有意保留）', () => {
  const m = installer.match(
    /\$packageName\s*=\s*if\s*\(\s*\$Profile\s*-eq\s*'workbuddy-ai'\s*\)\s*\{\s*'([^']+)'\s*\}\s*else\s*\{\s*'([^']+)'\s*\}/
  );
  must(m, '未按预期解析到 $packageName（安装器脚本结构变了，本测试需同步）');
  must(m[1] === 'WorkDaddy-AI' && m[2] === 'WorkDaddy', `$packageName 变成 ${m[2]} / ${m[1]}，会让更新器正则匹配不到产物`);
  return `$packageName = ${m[2]} (CN) / ${m[1]} (AI)`;
});
check('B3', 'build-win-installer.ps1 的 $productName 仍是「WorkBuddy 助手」显示名', () => {
  const m = installer.match(
    /\$productName\s*=\s*if\s*\(\s*\$Profile\s*-eq\s*'workbuddy-ai'\s*\)\s*\{\s*'([^']+)'\s*\}\s*else\s*\{\s*'([^']+)'\s*\}/
  );
  must(m, '未解析到 $productName');
  must(/WorkBuddy 助手 AI/.test(m[1]) && /WorkBuddy 助手/.test(m[2]), `$productName 变回 ${m[2]} / ${m[1]}`);
  return `$productName = ${m[2]} / ${m[1]}`;
});
check('B2', '由 packageName + DAEMON_VERSION 推导出的产物名能被更新器正则匹配', () => {
  const ver = pick(daemon, /const DAEMON_VERSION = '([^']+)'/, 'DAEMON_VERSION')[1];
  must(is3Seg(ver), `DAEMON_VERSION=${ver} 不是 3 段版本号（更新器正则只认 x.y.z）`);
  const cases = [
    [`WorkDaddy-Setup-${ver}.exe`, /^WorkDaddy-Setup-\d+\.\d+\.\d+\.exe$/i],
    [`WorkDaddy-AI-Setup-${ver}.exe`, /^WorkDaddy-AI-Setup-\d+\.\d+\.\d+\.exe$/i],
    [`WorkDaddy-${ver}-win64.zip`, /^WorkDaddy-\d+\.\d+\.\d+-win64\.zip$/i],
    [`WorkDaddy-AI-${ver}-win64.zip`, /^WorkDaddy-AI-\d+\.\d+\.\d+-win64\.zip$/i],
  ];
  for (const [name, re] of cases) must(re.test(name), `${name} 无法被更新器正则识别`);
  return `4 条产物名（版本 ${ver}）全部匹配`;
});

// ---------- C. 更新源 / 上游源 ----------
check('C1', 'UPDATE_REPO 指向自己的仓库且形如 owner/repo', () => {
  const m = pick(daemon, /const UPDATE_REPO = process\.env\.WBSWITCH_UPDATE_REPO \|\| '([^']+)'/, 'UPDATE_REPO');
  must(/^[\w.-]+\/[\w.-]+$/.test(m[1]), `UPDATE_REPO=${m[1]} 不是 owner/repo`);
  must(m[1] !== 'babygoton/WorkDaddy', 'UPDATE_REPO 被改回上游，等于放弃自建发行');
  return m[1];
});
check('C2', 'UPSTREAM_REPO 指向原作者仓库', () => {
  const m = pick(daemon, /const UPSTREAM_REPO = process\.env\.WBSWITCH_UPSTREAM_REPO \|\| '([^']+)'/, 'UPSTREAM_REPO');
  must(/^[\w.-]+\/[\w.-]+$/.test(m[1]), `UPSTREAM_REPO=${m[1]} 不是 owner/repo`);
  return m[1];
});

// ---------- D. 双版本语义 ----------
check('D1', 'DAEMON_VERSION / UPSTREAM_VERSION 均为 3 段且 上游 <= 修改版', () => {
  const self = pick(daemon, /const DAEMON_VERSION = '([^']+)'/, 'DAEMON_VERSION')[1];
  const up = pick(daemon, /const UPSTREAM_VERSION = '([^']+)'/, 'UPSTREAM_VERSION')[1];
  must(is3Seg(self), `DAEMON_VERSION=${self} 不是 3 段`);
  must(is3Seg(up), `UPSTREAM_VERSION=${up} 不是 3 段`);
  must(cmp3(self, up) >= 0, `修改版 ${self} 低于上游基线 ${up}，更新比较会错乱`);
  return `修改版 ${self} / 上游基线 ${up}`;
});
check('D2', '/api/about 返回双版本字段', () => {
  for (const key of ['selfVersion', 'upstreamVersion', 'upstreamRepo']) {
    must(new RegExp(key + ':').test(daemon), `/api/about 缺少 ${key}`);
  }
  return 'selfVersion / upstreamVersion / upstreamRepo 齐全';
});
check('D3', '/api/update-check 返回双源结果与可安装判定', () => {
  for (const key of ['anyUpdate', 'checkedVia', 'installable', 'selfReleaseMissing']) {
    must(new RegExp(key + ':').test(daemon), `versionCheckPayload 缺少 ${key}`);
  }
  must(/checkUpdateBoth\(/.test(daemon), '缺少 checkUpdateBoth（双源检查入口）');
  return 'anyUpdate / checkedVia / installable / selfReleaseMissing 齐全';
});
check('D4', '「关于」页有检查更新按钮与两个版本元素', () => {
  for (const id of ['wbs-check-update', 'wbs-self-ver', 'wbs-upstream-ver', 'wbs-ver-status', 'wbs-upstream-tip']) {
    must(inject.includes(`id="${id}"`), `inject.js 缺少 #${id}`);
  }
  return '5 个 DOM 锚点齐全';
});

// ---------- E. SHA-256 解析：多资产必须按文件名取 ----------
check('E1', 'parseSha256 支持 `SHA256 (文件名): <hex>` 多资产写法', () => {
  must(/function parseSha256\(body, assetName\)/.test(daemon), 'parseSha256 签名未带 assetName');
  const callers = daemon.match(/parseSha256\([^)]*\)/g) || [];
  const withoutName = callers.filter((c) => !/,/.test(c) && !/assetName/.test(c));
  must(withoutName.length === 0, `仍有未按文件名匹配的调用：${withoutName.join(' / ')}`);
  must(/SHA256 \(\$\(\$_\.Name\)\)/.test(workflow), 'CI 未按 `SHA256 (文件名):` 格式写入 Release 说明');
  return `${callers.length} 处调用全部按文件名匹配，CI 说明格式一致`;
});

// ---------- F. CI 与自建发行 ----------
check('F1', 'CI 在打包前把 .cmd 规范化为 CRLF，并用字节校验（不依赖 grep）', () => {
  must(/换行规范化|纯 CRLF/.test(workflow), 'CI 缺少换行规范化/CRLF 步骤（曾导致构建在第 4 步失败）');
  must(/ls-files[^\n]*\*\.cmd/.test(workflow), "CI 未覆盖全部受跟踪 .cmd（只扫 scripts/*.cmd 会漏掉 scripts/win/probe/…）");
  must(/b'\\r\\n'/.test(workflow), '规范化步骤未按字节把换行重写为 CRLF');
  must(/shell:\s*python/.test(workflow), '换行步骤未用 python：Git Bash 的 grep 在 Windows 上可能把 CRLF 读成 LF，产生误报');
  must(!/grep -q/.test(workflow), '换行校验又用回了 grep（Windows 上不可靠，会把 CRLF 判成 LF）');
  return '规范化 + 逐文件字节校验到位，且不依赖 grep';
});
check('F2', 'CI 发布到 GitHub Release（更新器只认 Release）', () => {
  must(/softprops\/action-gh-release/.test(workflow), 'CI 未发布 Release，更新器收不到新版本');
  return 'action-gh-release 在位';
});

// ---------- G. 显示名（浅改名只允许改这三处） ----------
check('G1', '三处显示名均未被改回 WorkDaddy', () => {
  const m = pick(profiles, /appName: '([^']+)'/, "profiles.js appName");
  must(/WorkBuddy 助手/.test(m[1]), `profiles.js appName 变回 ${m[1]}`);
  must(/var WBS_BRAND = WBS_PROFILE_IS_AI \? 'WorkBuddy 助手 AI' : 'WorkBuddy 助手';/.test(inject), 'inject.js WBS_BRAND 被改回');
  must(/WORKDADDY_DISPLAY_NAME = PROFILE\.id === 'workbuddy-ai' \? 'WorkBuddy 助手 AI' : 'WorkBuddy 助手'/.test(daemon), 'daemon.js WORKDADDY_DISPLAY_NAME 被改回');
  return `appName=${m[1]}，inject/daemon 显示名一致`;
});
check('G2', '安装路径与数据目录名仍为 WorkDaddy（不可改名）', () => {
  must(/WORKDADDY_INSTALL_NAME = PROFILE\.id === 'workbuddy-ai' \? 'WorkDaddy AI' : 'WorkDaddy'/.test(daemon), 'WORKDADDY_INSTALL_NAME 被改名（会破坏更新替换路径）');
  must(/DATA_DIR/.test(daemon) && !/DATA_DIR[^\n]*WorkBuddy 助手/.test(daemon), 'DATA_DIR 疑似被改名');
  return 'WORKDADDY_INSTALL_NAME / DATA_DIR 保持 WorkDaddy';
});

// ---------- 输出 ----------
let failed = 0;
console.log('WorkDaddy 更新器护栏自检  (' + new Date().toISOString().slice(0, 19) + ')');
console.log('仓库: ' + ROOT);
console.log('');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  [${r.id}] ${r.desc}`);
  if (r.detail) console.log(`        ${r.detail}`);
}
console.log('');
console.log(`${results.length - failed}/${results.length} 通过` + (failed ? `，${failed} 项失败 —— 更新会静默失效，必须修` : ''));
process.exit(failed ? 1 : 0);
