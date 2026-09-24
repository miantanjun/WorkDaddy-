'use strict';
/*
 * test-build-pin.js —— 发行包内置依赖（ws）的供应链收口守卫（v1.4.1 §9-5）。
 *
 * 守的是三件事：
 *   ① 版本钉住：scripts/package.json + scripts/package-lock.json 随仓库走，ws 钉精确版本；
 *      旧写法 `npm install ws` 的解析结果由「构建当天的 registry」决定 —— 同一次发版
 *      在不同日子构建出来的安装包里跑的可能不是同一份代码，发行物不可复现、不可审计。
 *   ② 构建脚本按锁装：用 `npm ci`（含 integrity 校验）+ `--ignore-scripts`，
 *      缺清单/锁时硬失败，不许静默少带依赖。
 *   ③ **真跑一遍**：把 build-win-zip.sh 里那段 vendoring 原样切出来执行，
 *      验证它确实能按锁把 ws 装出来；再跑第二次验证「已存在则跳过」仍然成立。
 *      另外把内嵌的 Python 块也真跑一遍（它要同时改写 package.json 与
 *      package-lock.json 的版本，且不能碰到 lock 里 ws 自己的版本）。
 *
 * 跑法：node .wd-analysis/test-build-pin.js
 * 依赖：本机 npm 可用（冷缓存时需要能连 registry）；构建脚本本身也依赖 npm/Python，
 *       所以这里判红是真实反馈，不是测试环境噪声。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const BUILD = path.join(SCRIPTS, 'build-win-zip.sh');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log(t); }

/* ==================================================================== */
section('[A] scripts/package.json + scripts/package-lock.json：版本钉住');
/* ==================================================================== */

let manifest = null;
let lock = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'package.json'), 'utf8')); } catch (_) {}
try { lock = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'package-lock.json'), 'utf8')); } catch (_) {}

ok(!!manifest, 'A1 scripts/package.json 存在且可解析');
const pin = manifest && manifest.dependencies && manifest.dependencies.ws;
ok(typeof pin === 'string' && /^\d+\.\d+\.\d+$/.test(pin),
  'A2 ws 钉的是精确版本（不许 ^ / ~ / 范围 / tag —— 那些都等于没钉）', pin);

ok(!!lock && lock.lockfileVersion === 3, 'A3 package-lock.json 存在且 lockfileVersion=3',
  lock && lock.lockfileVersion);
const lockRoot = lock && lock.packages && lock.packages[''];
ok(!!lockRoot && lockRoot.version === manifest.version,
  'A4 lock 的根版本与 manifest 一致（不一致时 npm ci 会直接失败）',
  { lock: lockRoot && lockRoot.version, manifest: manifest.version });
const lockWs = lock && lock.packages && lock.packages['node_modules/ws'];
ok(!!lockWs && lockWs.version === pin, 'A5 lock 里 ws 的版本 === manifest 里钉的版本',
  { lock: lockWs && lockWs.version, manifest: pin });
ok(!!lockWs && /^sha512-/.test(String(lockWs.integrity || '')),
  'A6 lock 里 ws 带 sha512 integrity（npm ci 靠它校验包没被换过）',
  lockWs && lockWs.integrity);
ok(!!lockWs && /^https:\/\/registry\.npmjs\.org\//.test(String(lockWs.resolved || '')),
  'A7 lock 里 ws 的来源是官方 registry（不是本地路径 / 不可信镜像）',
  lockWs && lockWs.resolved);
ok(Object.keys(manifest.dependencies || {}).join(',') === 'ws',
  'A8 manifest 的依赖面恰好只有 ws（要加依赖必须连这份守卫一起改）',
  Object.keys(manifest.dependencies || {}));

/* ==================================================================== */
section('\n[B] build-win-zip.sh：按锁安装 + 失败即停');
/* ==================================================================== */

const buildText = fs.readFileSync(BUILD, 'utf8');
const vendorStart = buildText.indexOf('if [ ! -d scripts/node_modules/ws ]; then');
const vendorEnd = vendorStart < 0 ? -1 : buildText.indexOf('\nfi\n', vendorStart);
const vendorBlock = vendorStart >= 0 && vendorEnd > 0 ? buildText.slice(vendorStart, vendorEnd + 4) : '';
ok(vendorBlock.length > 0, 'B0 切出 ws vendoring 代码块（锚点还在）', vendorBlock.length);

ok(/npm ci\b/.test(vendorBlock), 'B1 用 `npm ci` 按锁安装（而不是 `npm install ws`）');
// 匹配「代码形态」而不是裸标记：补丁注释里会引用被删掉的旧写法（`npm install ws`），
// 用裸串匹配会把注释当代码判红（维护手册 §40 的老坑）。
ok(!/npm init -y/.test(buildText) && !/npm install ws\s+--/.test(buildText),
  'B2 全脚本不再出现无锁的 `npm install ws`（按代码形态判，不看注释）');
ok(/--ignore-scripts/.test(vendorBlock), 'B3 带 `--ignore-scripts`（ws 是纯 JS 包，不需要安装脚本）');
ok(/--prefer-offline/.test(vendorBlock), 'B4 带 `--prefer-offline`（缓存优先，受限网络也能构建）');
ok(!/--no-audit/.test(buildText), 'B5 不再用 `--no-audit` 把审计静默吞掉');
ok(/缺少 scripts\/package\.json 或 scripts\/package-lock\.json/.test(vendorBlock) && /exit 2/.test(vendorBlock),
  'B6 缺清单/锁 → 硬失败退出（不许静默少带依赖就打包）');
ok(/cp scripts\/package\.json scripts\/package-lock\.json "\$TMPNODE\/"/.test(vendorBlock),
  'B7 vendoring 把 manifest 与 lock 一起拷进临时目录（npm ci 必须能同时看到两者）');
ok(fs.readFileSync(BUILD).indexOf('\r\n') < 0, 'B8 build-win-zip.sh 是纯 LF（.gitattributes 规定 *.sh eol=lf）');
ok(new RegExp("for package_name in \\('package\\.json', 'package-lock\\.json'\\):").test(buildText),
  'B9 staged 版本改写同时覆盖 package.json 与 package-lock.json');

// ── B10：把内嵌的 Python「profile 改写」块真跑一遍 ──────────────────────
// 找 Python 解释器（构建脚本自身也依赖它；找不到就判红，因为那时这段代码根本没被验证过）。
function findPython() {
  const candidates = [];
  if (process.env.WORKDADDY_PYTHON) candidates.push([process.env.WORKDADDY_PYTHON, []]);
  candidates.push(['python3', []], ['python', []], ['py', ['-3']]);
  // 兜底：WorkBuddy 托管的 python（存在才用，不写死版本）
  try {
    const base = path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'versions');
    for (const name of fs.readdirSync(base)) {
      for (const exe of ['python.exe', 'python']) {
        const p = path.join(base, name, exe);
        if (fs.existsSync(p)) candidates.push([p, []]);
      }
    }
  } catch (_) {}
  for (const [bin, prefix] of candidates) {
    try {
      execFileSync(bin, prefix.concat(['-c', 'import sys']), { stdio: 'ignore' });
      return [bin, prefix];
    } catch (_) {}
  }
  return null;
}

const heredocs = [];
{
  const re = /<<'PY'\n([\s\S]*?)\nPY\n/g;
  let m;
  while ((m = re.exec(buildText))) heredocs.push(m[1]);
}
ok(heredocs.length >= 4 && heredocs.every((h) => h.trim().length > 0),
  'B10 构建脚本里的内嵌 Python 块都被完整切出', heredocs.length);

const py = findPython();
if (!py) {
  ok(false, 'B11 本机找不到 Python 解释器 —— 构建脚本内嵌的 Python 块完全没被验证过（构建本身也会因缺 Python 失败）');
} else {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-staging-'));
  const stubFiles = {
    'win-launcher.js': "const p = process.env.WBSWITCH_PROFILE || 'workbuddy-cn';\n",
    'daemon.js': "const DAEMON_VERSION = '1.4.1';\nconst DAEMON_BUILD_ID = 'release-1.4.1-stub';\n",
    'install-win.ps1': 'param([string]$Profile = \'__WBS_DEFAULT_PROFILE__\')\n',
    'uninstall-win.ps1': 'param([string]$Profile = \'__WBS_DEFAULT_PROFILE__\')\n',
    'apply-update.ps1': 'param([string]$Profile = \'__WBS_DEFAULT_PROFILE__\')\n',
  };
  for (const [name, text] of Object.entries(stubFiles)) fs.writeFileSync(path.join(staging, name), text, 'utf8');
  fs.copyFileSync(path.join(SCRIPTS, 'package.json'), path.join(staging, 'package.json'));
  fs.copyFileSync(path.join(SCRIPTS, 'package-lock.json'), path.join(staging, 'package-lock.json'));

  // 逐字取「profile 替换」那个 heredoc（就是本次改动的所在）
  const target = heredocs.find((h) => h.indexOf('for package_name in') >= 0);
  // ⚠️ 沙箱兼容：本沙箱里「给子进程建 stdin 管道」的 spawn 会 EBUSY（`python -` + input 正是这一类），
  //    而同一个二进制从 bash 直接跑、或把 stdin 设为 'ignore' 都正常。
  //    ⇒ 把这份 heredoc 原样落成文件再执行，语义等价（仍逐字跑的就是被切出来的那一块）。
  const pyScript = path.join(staging, '__embedded__.py');
  fs.writeFileSync(pyScript, target, 'utf8');
  let ran = null;
  try {
    execFileSync(py[0], py[1].concat([pyScript, staging]), {
      env: { ...process.env, PROFILE: 'workbuddy-cn', BUILD_VERSION: '9.9.9' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ran = 'ok';
  } catch (e) {
    ran = String((e && e.stderr) || (e && e.message) || e).slice(0, 300);
  }
  ok(ran === 'ok', 'B11 内嵌 Python 块真跑通过（语法/逻辑错会在这里现形，而不是等 CI 发版）', ran);

  let stagedPkg = null;
  let stagedLock = null;
  try {
    stagedPkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
    stagedLock = JSON.parse(fs.readFileSync(path.join(staging, 'package-lock.json'), 'utf8'));
  } catch (_) {}
  ok(!!stagedPkg && stagedPkg.version === '9.9.9',
    'B12 staged package.json 的版本被改成构建版本', stagedPkg && stagedPkg.version);
  ok(!!stagedLock && stagedLock.version === '9.9.9' && stagedLock.packages[''].version === '9.9.9',
    'B13 staged package-lock.json 的根版本也被改成构建版本（只改 manifest 会让包内两份文件互相矛盾）',
    stagedLock && { top: stagedLock.version, root: stagedLock.packages[''].version });
  ok(!!stagedLock && stagedLock.packages['node_modules/ws'].version === pin,
    'B14 版本改写只动「根版本」两处，不碰 lock 里 ws 自己的版本（钉版本值才是要紧的）',
    stagedLock && stagedLock.packages['node_modules/ws'].version);

  fs.rmSync(staging, { recursive: true, force: true });
}

/* ==================================================================== */
section('\n[C] 端到端：原样执行 vendoring 代码块');
/* ==================================================================== */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-vendor-'));
fs.mkdirSync(path.join(sandbox, 'scripts'));
fs.copyFileSync(path.join(SCRIPTS, 'package.json'), path.join(sandbox, 'scripts', 'package.json'));
fs.copyFileSync(path.join(SCRIPTS, 'package-lock.json'), path.join(sandbox, 'scripts', 'package-lock.json'));
const vendorScript = path.join(sandbox, 'vendor.sh');
fs.writeFileSync(vendorScript, 'set -e\n' + vendorBlock + '\n', 'utf8');

// 让脚本里的 `npm` 解析到「当前正在跑测试的那个 node」旁边的 npm（与 CI 行为一致）
const nodeDir = path.dirname(process.execPath);
const env = { ...process.env, PATH: nodeDir + path.delimiter + (process.env.PATH || '') };

let vendorLog = '';
let vendorOk = true;
try {
  execFileSync('bash', [vendorScript], { cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  vendorOk = false;
  vendorLog = String((e && e.stderr) || (e && e.message) || e).slice(0, 300);
}
ok(vendorOk, 'C1 vendoring 代码块原样跑通', vendorLog);

const wsDir = path.join(sandbox, 'scripts', 'node_modules', 'ws');
let installedVersion = null;
try { installedVersion = JSON.parse(fs.readFileSync(path.join(wsDir, 'package.json'), 'utf8')).version; } catch (_) {}
ok(installedVersion === pin, 'C2 装出来的 ws 版本 === manifest 钉的版本（lock 生效）',
  { got: installedVersion, want: pin });

let requireOk = false;
try {
  const Ws = require(wsDir);
  requireOk = typeof Ws === 'function' && typeof Ws.Server === 'function';
} catch (_) {}
ok(requireOk, 'C3 装出来的 ws 能 require 起来且带 WebSocketServer（DevTools 代理真正用到的那部分）');

// 再跑一次：必须走「已存在则跳过」，目录内容逐字节不变。
function snapshot(dir) {
  const out = {};
  const walk = (d, base) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.lstatSync(p).isDirectory()) walk(p, base + name + '/');
      else out[base + name] = fs.readFileSync(p).toString('hex');
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}
const before = snapshot(wsDir);
let secondOk = true;
try {
  execFileSync('bash', [vendorScript], { cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { secondOk = false; }
const after = snapshot(wsDir);
ok(secondOk && JSON.stringify(before) === JSON.stringify(after) && Object.keys(after).length > 0,
  'C4 第二次执行走「已存在则跳过」且内容逐字节不变（保住本地/离线构建的快速路径）',
  { ok: secondOk, files: Object.keys(after).length });

fs.rmSync(sandbox, { recursive: true, force: true });

/* ==================================================================== */
console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
