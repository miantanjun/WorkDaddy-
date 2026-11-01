'use strict';
// 两件事，两个时代：
//   1) 上游 1.2.16 / issue #424 —— 官方 Windows updater 会在检查 feed 之前恢复缓存的
//      Setup.exe，所以必须给客户端独立 TEMP，让它看不见旧安装包。
//   2) 2026-10-28 —— 光隔离 TEMP 不够：实测它照常查到 5.9.3 并自动下完 450MB，因为
//      「钉官方更新域」只是防串域，并不防更新。现在把 WORKBUDDY_UPDATE_URL 指到本机
//      的 /v2/update（永远 204），并关掉开机静默装，才算真的被动不更新。
// 本套件守：A 隔离语义 · B 静音与 204 端点 · C 两条启动路径的接线 · D 打包白名单
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

// ===== B. 更新源静音 =====
// 旧断言是「钉到官方域」，那是错的：钉官方域等于让它照常问官方有没有新版。
// 实测 2026-10-28 02:21 它就靠这条拿到了 5.9.3 并自动下完 450MB。
test('B1 CN 更新源被静音到 loopback（不再指向官方域）', () => {
  const url = getWorkBuddyLaunchEnv(CN, tmpDir(), 'win32', {}).WORKBUDDY_UPDATE_URL;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(url.includes('workbuddy'), false);
});

test('B2 intl 同样静音（两个 profile 都不能漏）', () => {
  const url = getWorkBuddyLaunchEnv(AI, tmpDir(), 'win32', {}).WORKBUDDY_UPDATE_URL;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(url.includes('workbuddy'), false);
});

test('B2b 静音端点用 daemon 的实际端口（读 ui-port.json）', () => {
  const dataDir = tmpDir();
  fs.writeFileSync(path.join(dataDir, 'ui-port.json'), JSON.stringify({ profileId: 'workbuddy-cn', port: 47832 }), 'utf8');
  assert.equal(getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL, 'http://127.0.0.1:47832');
});

test('B2c ui-port.json 缺失/损坏时退到兜底端口，不能放任它去官方源', () => {
  const dataDir = tmpDir();
  fs.writeFileSync(path.join(dataDir, 'ui-port.json'), '{not json', 'utf8');
  assert.equal(getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL, 'http://127.0.0.1:9');
});

test('B2d 关掉开机静默装：写 app-config.json 的 startupForceAutoUpdate=false', () => {
  const dataRoot = tmpDir();
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  const cfgPath = path.join(dataRoot, 'app', 'app-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ locale: 'zh-CN', disableAgentTeams: false }), 'utf8');
  getWorkBuddyLaunchEnv({ ...CN, dataRoot }, tmpDir(), 'win32', {});
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.startupForceAutoUpdate, false);
  assert.equal(cfg.locale, 'zh-CN', '其它键必须原样保留');
  assert.equal(cfg.disableAgentTeams, false);
});

test('B2e 上面那条是幂等的（重复启动不反复改盘）', () => {
  const dataRoot = tmpDir();
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  const cfgPath = path.join(dataRoot, 'app', 'app-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ startupForceAutoUpdate: false }), 'utf8');
  const before = fs.statSync(cfgPath).mtimeMs;
  getWorkBuddyLaunchEnv({ ...CN, dataRoot }, tmpDir(), 'win32', {});
  assert.equal(fs.statSync(cfgPath).mtimeMs, before, '已经是 false 就不该再写一次');
});

test('B2f daemon 真的提供 /v2/update 204 端点（否则静音等于把更新检查打死成报错）', () => {
  const src = codeOnly(read('scripts/daemon.js'));
  // 源码里是转义过的正则字面量 /^\/v2\/update(\?|$)/，所以要按转义后的文本找。
  const anchor = '/^\\/v2\\/update';
  const idx = src.indexOf(anchor);
  assert.notEqual(idx, -1, '/v2/update 路由必须在');
  const slice = src.slice(idx, idx + 260);
  assert.match(slice, /writeHead\(204/, '必须回 204（官方语义 = 没有新版本）');
  assert.match(slice, /req\.method === 'GET'/, '只处理 GET，别把其他动词吞掉');
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

// ===== G. 策略开关（增强页「彻底静音」）=====
// 2026-10-28 追加：静音从硬编码改成可切换策略，默认静音。开关写
// <dataDir>/client-update-policy.json，客户端启动时由本模块读它决定更新源。
const { writeUpdateMute, readUpdatePolicy, UPDATE_POLICY_FILENAME } = require('../scripts/workbuddy-launch-env.js');

test('G1 策略文件缺省 = 静音（失败模式不对称：宁可漏更新，不可被动升级）', () => {
  const dataDir = tmpDir();
  assert.equal(getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL.startsWith('http://127.0.0.1:'), true);
  assert.equal(readUpdatePolicy(dataDir).mute, true);
  assert.equal(readUpdatePolicy(dataDir).source, 'default');
});

test('G2 关掉静音 → 恢复官方域（CN / AI 各自正确，不能互相串）', () => {
  const dataDir = tmpDir();
  writeUpdateMute(dataDir, false);
  assert.equal(getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL, 'https://www.workbuddy.cn');
  assert.equal(getWorkBuddyLaunchEnv(AI, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL, 'https://www.workbuddy.ai');
  assert.equal(readUpdatePolicy(dataDir).source, 'file');
});

test('G3 策略文件损坏 → 退回静音而不是退回官方源', () => {
  const dataDir = tmpDir();
  fs.writeFileSync(path.join(dataDir, UPDATE_POLICY_FILENAME), '{ broken', 'utf8');
  assert.equal(readUpdatePolicy(dataDir).mute, true);
  assert.equal(getWorkBuddyLaunchEnv(CN, dataDir, 'win32', {}).WORKBUDDY_UPDATE_URL.startsWith('http://127.0.0.1:'), true);
});

test('G4 mute 字段不是布尔也不认（避免字符串 "false" 被当真）', () => {
  const dataDir = tmpDir();
  fs.writeFileSync(path.join(dataDir, UPDATE_POLICY_FILENAME), JSON.stringify({ mute: 'false' }), 'utf8');
  assert.equal(readUpdatePolicy(dataDir).mute, true);
});

test('G5 关掉静音要把 app-config 的键删掉（不留「关过一次就永久关」的暗坑）', () => {
  const dataRoot = tmpDir();
  fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
  const cfgPath = path.join(dataRoot, 'app', 'app-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ locale: 'zh-CN' }), 'utf8');
  const dataDir = tmpDir();
  getWorkBuddyLaunchEnv({ ...CN, dataRoot }, dataDir, 'win32', {});
  assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).startupForceAutoUpdate, false, '静音档应写 false');
  writeUpdateMute(dataDir, false);
  getWorkBuddyLaunchEnv({ ...CN, dataRoot }, dataDir, 'win32', {});
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(Object.hasOwn(after, 'startupForceAutoUpdate'), false, '恢复更新时该键必须删掉');
  assert.equal(after.locale, 'zh-CN');
});

test('G6 writeUpdateMute 形状固定且带时间戳（面板要显示上次改动）', () => {
  const dataDir = tmpDir();
  const saved = writeUpdateMute(dataDir, true);
  assert.equal(saved.mute, true);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, UPDATE_POLICY_FILENAME), 'utf8'));
  assert.deepEqual(Object.keys(onDisk).sort(), ['mute', 'updatedAt']);
});

test('G7 daemon 暴露策略读写接口，并在启动时套用', () => {
  const src = codeOnly(read('scripts/daemon.js'));
  assert.match(src, /'\/api\/client-update-policy'/, 'GET 策略接口缺了');
  assert.match(src, /'\/api\/client-update-policy-set'/, 'POST 设置接口缺了');
  assert.match(src, /applyStartupForceAutoUpdate\(PROFILE\.dataRoot, readUpdatePolicy\(DATA_DIR\)\.mute\)/, '启动期必须套用策略，否则用户在客户端里改过就漂了');
});

test('G7b daemon 用到的每个导出真的存在（漏导出 ⇒ GET 500，只能靠手测发现）', () => {
  const mod = require('../scripts/workbuddy-launch-env.js');
  for (const name of ['readUpdatePolicy', 'writeUpdateMute', 'applyStartupForceAutoUpdate', 'SUPPORTED_PROFILE_IDS']) {
    assert.ok(mod[name] !== undefined, '模块漏导出 ' + name);
  }
  assert.ok(Array.isArray(mod.SUPPORTED_PROFILE_IDS));
});

test('G8 增强页有开关 + 重启入口（只有开关没有重启，改了等于没改）', () => {
  const src = codeOnly(read('scripts/inject.js'));
  assert.match(src, /id="wbs-update-card"/, '卡片缺了');
  assert.match(src, /id="wbs-update-mute"/, '开关缺了');
  assert.match(src, /wireUpdatePolicy\(\)/, '接线缺了');
  assert.match(src, /'\/api\/client-update-policy-set'/, '开关必须写策略');
  assert.match(src, /'\/api\/client\/relaunch'/, '必须给「重启生效」入口');
});

test('G9 开关不用 window.confirm（Electron 不实现，confirm 静默返回 false ⇒ 按钮点不动）', () => {
  const src = codeOnly(read('scripts/inject.js'));
  const idx = src.indexOf('function wireUpdatePolicy');
  assert.notEqual(idx, -1);
  const body = src.slice(idx, src.indexOf('function wireEnhancePane', idx));
  assert.ok(!body.includes('confirm('), '必须自绘两步确认，不能依赖原生 confirm');
  assert.match(body, /armed/, '两步确认的 armed 状态缺了');
});
