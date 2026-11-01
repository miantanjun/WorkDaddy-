'use strict';

const fs = require('fs');
const path = require('path');

// 客户端更新策略：增强页「彻底静音」开关读写这个文件。
//
// 背景（2026-10-28）：`WORKBUDDY_UPDATE_URL` 是客户端 buildUpdateFeedUrl() 的唯一入口
// （`process.env.WORKBUDDY_UPDATE_URL || provider || copilot.tencent.com`）。钉官方域
// 等于「让它照常去问官方有没有新版本」——实测 5.9.3 被发现后 45 秒自动下完 429MB 并
// 挂出「重启更新」横幅。钉 URL ≠ 禁止更新。
//
// 所以开关做成两条腿：
//   静音开 → WORKBUDDY_UPDATE_URL 指本机 daemon 的 /v2/update（永远 204），外加把
//            app-config.json 的 startupForceAutoUpdate 关掉；
//   静音关 → 还原官方域，客户端恢复官方更新行为（每小时检查、自动下载、提示重启）。
const UPDATE_POLICY_FILENAME = 'client-update-policy.json';

// 缺文件/坏文件时的默认值：静音。理由是不静音可能直接装机，静音最多是"没发现有新版"，
// 两种失败模式的代价不对称 —— 宁可漏更新，不可被动升级。
const DEFAULT_UPDATE_MUTE = true;

const OFFICIAL_UPDATE_ORIGINS = Object.freeze({
  'workbuddy-cn': 'https://www.workbuddy.cn',
  'workbuddy-ai': 'https://www.workbuddy.ai',
});

// 本策略只对这两个客户端 profile 生效（codebuddy 系不在范围内）。
const SUPPORTED_PROFILE_IDS = Object.freeze(['workbuddy-cn', 'workbuddy-ai']);

// daemon 没起来时退到这里：连接必然被拒 ⇒ 检查抛错 ⇒ 同样不会下载。
const MUTED_UPDATE_FALLBACK_ORIGIN = 'http://127.0.0.1:9';

function updatePolicyPath(dataDir) {
  return path.join(String(dataDir || ''), UPDATE_POLICY_FILENAME);
}

/** 读策略。任何异常都退回 DEFAULT_UPDATE_MUTE（见上面「失败模式不对称」）。 */
function readUpdatePolicy(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(updatePolicyPath(dataDir), 'utf8'));
    if (raw && typeof raw.mute === 'boolean') {
      return { mute: raw.mute, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, source: 'file' };
    }
  } catch (_) {
    // 落到默认
  }
  return { mute: DEFAULT_UPDATE_MUTE, updatedAt: null, source: 'default' };
}

function readUpdateMute(dataDir) {
  return readUpdatePolicy(dataDir).mute;
}

/** 写策略。原子替换：先写临时文件再 rename，避免面板读到半截 JSON。 */
function writeUpdateMute(dataDir, mute) {
  const payload = { mute: !!mute, updatedAt: new Date().toISOString() };
  const file = updatePolicyPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return payload;
}

/**
 * 按策略调整「开窗前静默装已下载的包」。
 *
 * asar 里 resolveEarlyStartupForceAutoEnabled() 读 app-config.json 的
 * startupForceAutoUpdate，优先级 userSetting > remoteFeature > systemDefault >
 * productBase，官方 productBase=true。只要磁盘上躺着一个 ready 包，重启就有被
 * quitAndInstallForStartup() 装掉的风险。
 *
 * 静音 → 写 false；不静音 → 把键删掉，让它回落到官方默认（不留下"关过一次就永久关"的暗坑）。
 * 尽力而为：写不进去也不能挡住启动，静音主要靠 feed 204。
 */
function applyStartupForceAutoUpdate(dataRoot, mute) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) return;
  // 只改真实存在的数据目录：测试里传的是假路径，不该在盘上凭空造出 app/ 目录。
  if (!fs.existsSync(dataRoot)) return;
  const file = path.join(dataRoot, 'app', 'app-config.json');
  try {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      raw = {};
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    if (mute) {
      if (raw.startupForceAutoUpdate === false) return;
      raw.startupForceAutoUpdate = false;
    } else {
      if (!Object.hasOwn(raw, 'startupForceAutoUpdate')) return;
      delete raw.startupForceAutoUpdate;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  } catch (_) {
    // 忽略：拿不到写权限时仍然可以靠静音的 feed 阻断下载。
  }
}

/** 本机静音端点：优先用 daemon 实际端口（ui-port.json），拿不到就用兜底端口。 */
function resolveMutedUpdateOrigin(dataDir) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dataDir, 'ui-port.json'), 'utf8'));
    const port = Number(info && info.port);
    if (Number.isInteger(port) && port > 0 && port < 65536) return 'http://127.0.0.1:' + port;
  } catch (_) {
    // 落到兜底
  }
  return MUTED_UPDATE_FALLBACK_ORIGIN;
}

function getWorkBuddyLaunchEnv(profile, dataDir, platform = process.platform, env = process.env) {
  const childEnv = { ...env };
  if (platform !== 'win32' || profile.customTarget || !SUPPORTED_PROFILE_IDS.includes(profile.id)) return childEnv;
  if (!profile.dataRoot || !path.isAbsolute(profile.dataRoot) || !dataDir || !path.isAbsolute(dataDir)) {
    throw new Error('无法隔离 WorkBuddy 更新：客户端或 WorkDaddy 数据目录不是绝对路径');
  }

  // #424: the official Windows updater restores cached Setup.exe files before
  // checking its feed. Pinning the URL alone cannot exclude a sibling installer.
  // A stable profile-specific TEMP isolates the cache without deleting any files.
  // Use DATA_DIR rather than inherited TEMP so child restarts cannot nest paths.
  const tempDir = path.join(dataDir, 'client-tmp', profile.id);
  try {
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new Error('无法创建 WorkBuddy 独立临时目录，请检查 WorkDaddy 数据目录的写入权限', { cause: error });
  }
  const mute = readUpdateMute(dataDir);
  applyStartupForceAutoUpdate(profile.dataRoot, mute);

  const overrides = {
    WORKBUDDY_UPDATE_URL: mute ? resolveMutedUpdateOrigin(dataDir) : OFFICIAL_UPDATE_ORIGINS[profile.id],
    WORKBUDDY_CONFIG_DIR: profile.dataRoot,
    CODEBUDDY_CONFIG_DIR: profile.dataRoot,
    WORKBUDDY_DATA_FOLDER_NAME: path.basename(profile.dataRoot),
    TEMP: tempDir,
    TMP: tempDir,
  };
  // Windows keys are case-insensitive. Remove aliases before adding canonical
  // names; Node otherwise passes only the first case variant to the child.
  for (const key of Object.keys(childEnv)) {
    if (Object.hasOwn(overrides, key.toUpperCase())) delete childEnv[key];
  }
  return Object.assign(childEnv, overrides);
}

module.exports = {
  getWorkBuddyLaunchEnv,
  readUpdatePolicy,
  readUpdateMute,
  writeUpdateMute,
  applyStartupForceAutoUpdate,
  resolveMutedUpdateOrigin,
  updatePolicyPath,
  DEFAULT_UPDATE_MUTE,
  OFFICIAL_UPDATE_ORIGINS,
  SUPPORTED_PROFILE_IDS,
  UPDATE_POLICY_FILENAME,
};
