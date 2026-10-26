'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWorkBuddyTarget } = require('./workbuddy-target.js');

// 注意：此处用 plat 而非 platform，避免与 getProfile 内部的 platform 字符串参数混淆
const plat = require('./platform.js');

const home = plat.home;
const IS_WIN = plat.IS_WIN;
const IS_LINUX = plat.IS_LINUX;
// 应用支持根：macOS ~/Library/Application Support / Windows %APPDATA% / Linux $XDG_CONFIG_HOME(~/.config)
const appSupport = plat.appSupport;
// 扩展数据根：登录凭据就落在 <localSupport>/CodeBuddyExtension/Data/Public/auth 下，
// 三平台同构，仅根不同（macOS 与 appSupport 相同；Windows 用 %LOCALAPPDATA%；Linux 用 $XDG_DATA_HOME）
const localSupport = plat.localSupport;
const extensionAuth = plat.extensionAuth;

// Linux 没有 .app 包，官方包把 Electron 主程序直接铺在安装目录（实测 5.5.4：
// /opt/WorkBuddy/workbuddy）。海外版常见做法是复制应用副本到 XDG 数据目录。
const LINUX_APP_KIND = {
  'WorkBuddy': 'workbuddy',
  'WorkBuddy AI': 'workbuddy-ai',
  'CodeBuddy CN': 'codebuddy-cn',
  'CodeBuddy': 'codebuddy',
};

// Windows 可执行名与安装目录名不完全一致（AI 国际版 exe 为 WorkBuddyAI.exe，无空格；
// win-launcher 进程枚举与 PR#8 实机已确认）。winExec 缺省时用安装目录同名 .exe，找不到时
// win-launcher 仍有进程/注册表兜底。
const appPath = (name, winExec, winDir) =>
  IS_WIN
    ? path.join(localSupport, 'Programs', winDir || name, winExec || `${winDir || name}.exe`)
    : IS_LINUX
      ? plat.linuxAppBinary(LINUX_APP_KIND[name] || 'workbuddy')
      : `/Applications/${name}.app`;

// CodeBuddy 的 CN 与国际版共用安装目录名，exe 名也不稳定（旧版 CN 用 CodeBuddy.exe），
// 只用 product.json 的 applicationName 才能可靠区分，避免误停另一个产品。
function isCodeBuddyBinary(binary, profileId) {
  if (!['codebuddy-cn', 'codebuddy-intl'].includes(profileId)) return false;
  try {
    const name = path.basename(binary).toLowerCase();
    const validName = profileId === 'codebuddy-cn'
      ? name === 'codebuddy cn.exe' || name === 'codebuddy.exe'
      : name === 'codebuddy.exe';
    if (!validName) return false;
    const product = JSON.parse(fs.readFileSync(path.join(path.dirname(binary), 'resources', 'app', 'product.json'), 'utf8'));
    return product.applicationName === (profileId === 'codebuddy-cn' ? 'buddycn' : 'buddy');
  } catch (_) {
    return false;
  }
}

function sharedDataDir() {
  return path.join(appSupport, 'WorkDaddy');
}

const PROFILES = {
  'workbuddy-cn': {
    id: 'workbuddy-cn', name: 'WorkBuddy', appName: 'WorkBuddy 助手', region: 'cn', kind: 'workbuddy', mode: 'agents',
    appPath: appPath('WorkBuddy'),
    dataRoot: path.join(home, '.workbuddy'),
    authFile: path.join(extensionAuth, 'workbuddy-desktop.info'),
    sessionDb: path.join(home, '.workbuddy', 'workbuddy.db'),
    modelsFile: path.join(home, '.workbuddy', 'models.json'),
    // billing/积分/签到/无感登录 API host（与 auth.domain 一致；国际版为 www.workbuddy.ai）
    apiHost: 'https://www.codebuddy.cn',
    capabilities: { accounts: true, sessions: true, models: true, stashPrompt: true, theme: true, checkin: true, growthDaily: true },
    targetHints: ['workbuddy'],
  },
  'workbuddy-ai': {
    id: 'workbuddy-ai', name: 'WorkBuddy AI', appName: 'WorkBuddy 助手 AI', region: 'intl', kind: 'workbuddy', mode: 'agents',
    // Windows 安装目录无空格：%LOCALAPPDATA%\Programs\WorkBuddyAI\WorkBuddyAI.exe（PR#8 实机确认）
    appPath: appPath('WorkBuddy AI', 'WorkBuddyAI.exe', 'WorkBuddyAI'),
    dataRoot: path.join(home, '.workbuddy-ai'),
    authFile: path.join(extensionAuth, 'workbuddy-desktop-ai.info'),
    sessionDb: path.join(home, '.workbuddy-ai', 'workbuddy.db'),
    // 模型配置文件：国际版用 ~/.workbuddy-ai/models.json，国内版用 ~/.workbuddy/models.json，
    // 两者独立（勿改共用）。“从 XX 导入”即把另一端文件中的模型合并进本端文件。
    modelsFile: path.join(home, '.workbuddy-ai', 'models.json'),
    apiHost: 'https://www.workbuddy.ai',
    capabilities: { accounts: true, sessions: true, models: true, stashPrompt: true, theme: true, checkin: true, growthDaily: false },
    targetHints: ['workbuddy ai', 'workbuddy'],
  },
  'codebuddy-cn': {
    id: 'codebuddy-cn', name: 'CodeBuddy CN', appName: 'WorkDaddy', region: 'cn', kind: 'codebuddy', mode: 'auto',
    // IDE 形态：主程序是 VS Code fork，注入走 CDP（apiTransport: 'cdp'），不走 renderer 脚本直注。
    appPath: appPath('CodeBuddy CN', 'CodeBuddy CN.exe'),
    binaryNames: ['CodeBuddy CN.exe', 'CodeBuddy.exe'],
    nativeDebugPort: 9244,
    oauthPlatform: 'ide',
    authApiHost: 'https://copilot.tencent.com',
    // historyRoot 是 CodeBuddyExtension 的上级目录：会话历史/计划任务/检查点/文件树四棵树都挂在这下面。
    historyRoot: path.dirname(path.dirname(extensionAuth)),
    userDataRoot: path.join(appSupport, 'CodeBuddy CN'),
    dataRoot: path.join(home, '.codebuddy'),
    // 原生登录态由 CodeBuddy 主进程用 Electron 加密服务持久化，账号备份落在我们自己的目录。
    authFile: path.join(sharedDataDir(), 'profiles', 'codebuddy-cn', 'native-current.info'),
    sessionDb: path.join(appSupport, 'CodeBuddy CN', 'codebuddy-sessions.vscdb'),
    // 自定义模型配置由 Electron 主进程写到用户目录；state.vscdb 只是 VS Code 状态，不是模型配置。
    modelsFile: path.join(home, '.codebuddy', 'models.json'),
    apiHost: 'https://www.codebuddy.cn',
    capabilities: {
      accounts: true, sessions: true, models: true, stashPrompt: false,
      nativeComposer: true, theme: true, themeTakeover: false, enhance: false,
      panelAppearance: 'light', robotStyle: 'black', apiTransport: 'cdp',
      checkin: true, growthDaily: true,
      // 2026-10-22 轻量版：CodeBuddy 不是主力（只用来把编程任务分流过去），
      // 面板只保留 账号/会话/空间/模型/关于 五个页签，摘掉 主题/自动化/电脑；
      // daemon 侧同时停掉整套自动化调度与内置任务安装（否则每分钟刷一条失败日志）。
      lite: true,
    },
    targetHints: ['codebuddy cn'],
  },
  'codebuddy-intl': {
    id: 'codebuddy-intl', name: 'CodeBuddy', appName: 'WorkDaddy', region: 'intl', kind: 'codebuddy', mode: 'auto',
    appPath: appPath('CodeBuddy', 'CodeBuddy.exe'),
    binaryNames: ['CodeBuddy.exe'],
    nativeDebugPort: 9245,
    oauthPlatform: 'ide',
    authApiHost: 'https://www.codebuddy.ai',
    historyRoot: path.dirname(path.dirname(extensionAuth)),
    userDataRoot: path.join(appSupport, 'CodeBuddy'),
    dataRoot: path.join(home, '.codebuddy'),
    authFile: path.join(sharedDataDir(), 'profiles', 'codebuddy-intl', 'native-current.info'),
    sessionDb: path.join(appSupport, 'CodeBuddy', 'codebuddy-sessions.vscdb'),
    modelsFile: path.join(home, '.codebuddy', 'models.json'),
    apiHost: 'https://www.codebuddy.ai',
    capabilities: {
      accounts: true, sessions: true, models: true, stashPrompt: false,
      nativeComposer: true, theme: true, themeTakeover: false, enhance: false,
      panelAppearance: 'light', robotStyle: 'black', apiTransport: 'cdp',
      checkin: false, builtinAutomations: false, lite: true,
    },
    targetHints: ['codebuddy'],
  },
};

function applyWorkBuddyTarget(profile, target) {
  if (!target || !target.configured || !target.binary) return profile;
  if (target.clientType === 'official') {
    return {
      ...profile,
      appPath: target.binary,
      binaryNames: target.processNames || [path.basename(target.binary)],
      cdp: target.cdp || { mode: 'argument' },
      configuredTarget: true,
      customTarget: false,
      targetVersion: target.version || '',
      lockTargetVersion: false,
    };
  }
  return {
    ...profile,
    appPath: target.binary,
    ...(target.dataRoot ? { dataRoot: target.dataRoot } : {}),
    authFile: target.authFile || null,
    ...(target.sessionDb ? { sessionDb: target.sessionDb } : {}),
    ...(target.modelsFile ? { modelsFile: target.modelsFile } : {}),
    apiHost: target.apiHost || '',
    capabilities: { ...profile.capabilities, ...(target.capabilities || {}) },
    targetHints: [...(target.targetHints || [])],
    binaryNames: target.processNames || [target.processName || path.basename(target.binary)],
    cdp: target.cdp || { mode: 'argument' },
    configuredTarget: true,
    customTarget: true,
    targetVersion: target.version || '',
    lockTargetVersion: false,
  };
}

function getProfile(id = process.env.WBSWITCH_PROFILE || 'workbuddy-cn', options = {}) {
  const key = String(id || '').trim().toLowerCase();
  if (PROFILES[key]) {
    const base = PROFILES[key];
    if (base.kind !== 'workbuddy') return base;
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const dataDir = options.dataDir || env.WBSWITCH_DATA_DIR || profileDataDir(base);
    const target = readWorkBuddyTarget({ dataDir, profileId: key, env, platform });
    return applyWorkBuddyTarget(base, target);
  }
  throw new Error(`未知客户端 profile: ${id}`);
}

function listProfiles() { return Object.values(PROFILES).map((p) => ({ ...p, capabilities: { ...p.capabilities }, targetHints: [...p.targetHints] })); }

function listInstalledModelSources(activeId) {
  const active = PROFILES[activeId];
  return ['workbuddy-cn', 'workbuddy-ai']
    .filter((id) => id !== activeId)
    .map((id) => PROFILES[id])
    .map((profile) => {
      const installed = fs.existsSync(profile.appPath);
      const available = fs.existsSync(profile.modelsFile);
      // 防御：仅当两端模型文件实际指向同一路径时才视为共享（正常情况
      // CN/AI 各用各的 models.json，可互相导入；若未来某端路径缺失需容错）
      const shared = !!(active && active.modelsFile && profile.modelsFile &&
        path.resolve(active.modelsFile) === path.resolve(profile.modelsFile));
      return {
        profileId: profile.id,
        name: profile.name,
        modelsFile: profile.modelsFile,
        installed,
        available,
        shared,
      };
    })
    .filter((source) => source.installed || source.available || source.shared);
}

function profileDataDir(profile, configured) {
  if (configured) return configured;
  if (profile.id === 'workbuddy-cn') return sharedDataDir();
  return path.join(sharedDataDir(), 'profiles', profile.id);
}

module.exports = { PROFILES, applyWorkBuddyTarget, getProfile, listProfiles, listInstalledModelSources, profileDataDir, sharedDataDir, isCodeBuddyBinary };
