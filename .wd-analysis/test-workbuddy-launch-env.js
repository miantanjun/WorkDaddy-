'use strict';
// 上游 1.2.16 / issue #424：客户端「一重启就自动升级且不装完不让开窗」的根因是
// 官方 Windows updater 会在检查 feed 之前恢复缓存的 Setup.exe。只钉更新 URL 拦不住，
// 必须给客户端一个独立的 TEMP，让它看不见旧安装包。
// 本套件守：A 纯函数语义（隔离/钉源/边界/幂等）· B 两条启动路径的接线 · C 打包白名单
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getWorkBuddyLaunchEnv } = require('../scripts/workbuddy-launch-env.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// 静态断言必须剥注释：注释里写着 windowsHide / 旧写法时不该误判
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-launch-env-'));
const CN = { id: 'workbuddy-cn', dataRoot: 'C:\\Users\\x\\.workbuddy', customTarget: false };
const AI = { id: 'workbuddy-ai', dataRoot: 'C:\\Users\\x\\.workbuddy-ai', customTarget: false };

// ===== A. 隔离语义 =====
test('A1 TEMP 指向 <dataDir>/client-tmp/<profileId>', () => {
  const dataDir = tmpDir();
  const env = getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {});
  assert.equal(env.TEMP, path.join(dataDir, 'client-tmp', 'workbuddy-cn'));
});

test('A2 TMP 与 TEMP 同址', () => {
  const dataDir = tmpDir();
  const env = getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {});
  assert.equal(env.TMP, env.TEMP);
});

test('A3 隔离目录真的被建出来', () => {
  const dataDir = tmpDir();
  const env = getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {});
  assert.equal(fs.existsSync(env.TEMP), true);
});

test('A4 不同 profile 用不同临时目录（不能共用一个缓存）', () => {
  const dataDir = tmpDir();
  assert.notEqual(
    getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).TEMP,
    getWorkBuddyLaunchEnv(AI, dataDir, 'win32', {}).TEMP,
  );
});

test('A5 用传入的 dataDir 而不是继承的 TEMP（重启不套娃）', () => {
  const dataDir = tmpDir();
  const env = getWorkBuddyLaunchEnv(CN, dataDir, 'win32', { TEMP: 'C:\\some\\nested\\client-tmp\\workbuddy-cn' });
  assert.equal(env.TEMP, path.join(dataDir, 'client-tmp', 'workbuddy-cn'));
});

// ===== B. 钉住更新源 =====
test('B1 CN 更新域是 workbuddy.cn', () => {
  assert.equal(getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', {}).WORKBUDDY_UPDATE_URL, 'https://www.workbuddy.cn');
});

test('B2 intl 更新域是 workbuddy.ai', () => {
  assert.equal(getWorkBuddyLaunchEnv(AI, tmpDir(), 'win32', {}).WORKBUDDY_UPDATE_URL, 'https://www.workbuddy.ai');
});

test('B3 配置目录指向 profile.dataRoot', () => {
  const env = getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', {});
  assert.equal(env.WORKBUDDY_CONFIG_DIR, CN.dataRoot);
  assert.equal(env.CODEBUDDY_CONFIG_DIR, CN.dataRoot);
});

test('B4 数据目录名取自 dataRoot 的 basename', () => {
  assert.equal(getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', {}).WORKBUDDY_DATA_FOLDER_NAME, '.workbuddy');
});

// ===== C. 边界 =====
test('C1 非 Windows 原样返回', () => {
  const env = getWorkBuddyLaunchEnv(CN, tmpDir(), 'darwin', { TEMP: '/tmp/x' });
  assert.equal(env.TEMP, '/tmp/x');
  assert.equal(env.WORKBUDDY_UPDATE_URL, undefined);
});

test('C2 codebuddy profile 原样返回（不在更新域白名单里）', () => {
  const env = getWorkBuddyLaunchEnv({ id: 'codebuddy-cn', dataRoot: 'C:\\Users\\x\\.codebuddy', customTarget: false }, tmpDir(), 'win32', {});
  assert.equal(env.WORKBUDDY_UPDATE_URL, undefined);
  assert.equal(env.TEMP, undefined);
});

test('C3 customTarget 原样返回（用户自己指的客户端不吃我们的隔离）', () => {
  const env = getWorkBuddyLaunchEnv({ ...CN, customTarget: true }, tmpDir(), 'win32', {});
  assert.equal(env.TEMP, undefined);
});

test('C4 dataRoot 不是绝对路径时拒绝（宁可不起客户端，也不静默不隔离）', () => {
  assert.throws(() => getWorkBuddyLaunchEnv({ ...CN, dataRoot: 'relative\\path' }, tmpDir(), 'win32', {}), /绝对路径/);
});

test('C5 dataDir 不是绝对路径时拒绝', () => {
  assert.throws(() => getWorkBuddyLaunchEnv(CN, 'relative', 'win32', {}), /绝对路径/);
});

test('C6 dataRoot 缺失时拒绝', () => {
  assert.throws(() => getWorkBuddyLaunchEnv({ id: 'workbuddy-cn', customTarget: false }, tmpDir(), 'win32', {}), /绝对路径/);
});

test('C7 小写 temp 别名被清掉（Windows 键名大小写不敏感，留着会盖掉隔离）', () => {
  const env = getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', { temp: 'C:\\stale', tmp: 'C:\\stale2' });
  assert.equal(env.temp, undefined);
  assert.equal(env.tmp, undefined);
  assert.notEqual(env.TEMP, 'C:\\stale');
});

test('C8 不修改调用方传入的 env 对象', () => {
  const source = { PATH: 'C:\\bin' };
  getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', source);
  assert.deepEqual(source, { PATH: 'C:\\bin' });
});

test('C9 保留无关环境变量', () => {
  const env = getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\x' });
  assert.equal(env.PATH, 'C:\\bin');
  assert.equal(env.USERPROFILE, 'C:\\Users\\x');
});

// ===== D. win-launcher 接线 =====
const wl = codeOnly(read('scripts/win-launcher.js'));

test('D1 win-launcher 引入了 workbuddy-launch-env', () => {
  assert.match(wl, /require\('\.\/workbuddy-launch-env\.js'\)/);
});

test('D2 launchWorkBuddy 走 getWorkBuddyLaunchEnv', () => {
  const body = wl.slice(wl.indexOf('function launchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /getWorkBuddyLaunchEnv\(PROFILE, DATA_DIR, process\.platform, process\.env\)/);
});

test('D3 launchWorkBuddy 不再用「只补 CDP 变量」的内联 env（那样 TEMP 不会被隔离）', () => {
  const body = wl.slice(wl.indexOf('function launchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.ok(!/\{\s*\.\.\.process\.env,\s*WORKBUDDY_REMOTE_DEBUGGING_PORT/.test(fn));
});

test('D4 environment 模式仍保留 WORKBUDDY_REMOTE_DEBUGGING_PORT', () => {
  const body = wl.slice(wl.indexOf('function launchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /if \(environmentMode\) env\.WORKBUDDY_REMOTE_DEBUGGING_PORT = String\(CDP_PORT\)/);
});

// ===== E. daemon 接线 =====
const dm = codeOnly(read('scripts/daemon.js'));

test('E1 daemon 引入了 workbuddy-launch-env', () => {
  assert.match(dm, /require\('\.\/workbuddy-launch-env\.js'\)/);
});

test('E2 relaunchWorkBuddy 走 getWorkBuddyLaunchEnv', () => {
  const body = dm.slice(dm.indexOf('function relaunchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /const childEnv = getWorkBuddyLaunchEnv\(PROFILE, DATA_DIR, process\.platform, process\.env\)/);
});

test('E3 relaunchWorkBuddy 不再用裸 process.env 副本', () => {
  const body = dm.slice(dm.indexOf('function relaunchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.ok(!fn.includes('const childEnv = { ...process.env };'));
});

test('E4 relaunchWorkBuddy 用 windowsHide:false（true 会让重启后只剩托盘）', () => {
  const body = dm.slice(dm.indexOf('function relaunchWorkBuddy'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /windowsHide: false/);
  assert.ok(!/windowsHide: true/.test(fn));
});

// ===== F. 打包与产物 =====
test('F1 mac 打包白名单两处都登记了', () => {
  const sh = read('scripts/build-mac-dmg.sh');
  assert.equal((sh.match(/workbuddy-launch-env\.js/g) || []).length, 2);
});

test('F2 scripts/workbuddy-launch-env.js 是纯 CRLF', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'workbuddy-launch-env.js'), 'utf8');
  assert.ok(raw.includes('\r\n'));
  assert.equal((raw.match(/(^|[^\r])\n/g) || []).length, 0);
});
