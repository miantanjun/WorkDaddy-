'use strict';
/*
 * api-gateway.js —— WorkBuddy 账号 → OpenAI 兼容 API 的「sidecar 网关」集成层。
 *
 * 背景（决策与实证见技能 workdaddy-maintain 与其 2026-09-30 记录）：
 *   第三方项目 `linguo2625469/workbuddy2api-panel`（MIT）把 WorkBuddy 账号包装成
 *   `/v1/chat/completions`。它是 **Go 写的**（核心协议层约 1 MB 源码），移植进本仓不划算
 *   ⇒ 采用 **sidecar**：官方二进制当引擎，本模块只做「下载校验 / 凭证桥 / 配置生成 / 状态」，
 *   进程启停交给 daemon（本模块不 spawn，保持可单测）。
 *
 * ⭐ 本模块存在的**唯一理由**是「凭证桥」：官方二进制要求用户走一遍 OAuth 设备授权才能拿到
 *   `auths/*.json`；而本仓**已经持有**同一批账号的凭证（`<dataDir>/accounts/*.info`，
 *   5.6+ 起 accessToken/refreshToken 是 `$wbEncrypted` 信封，需解密）——于是可以**免登录**直接把
 *   3 个账号喂过去。解密器由调用方注入（daemon 传 lib.js 的 wdCompatDecryptAuthJson），
 *   本模块**不自己实现解密**，避免同一份帧格式出现两个实现。
 *
 * 纪律：
 *   · 本模块**不 require daemon.js**（daemon 会起 HTTP 服务，不能反向依赖）；
 *   · 不 spawn 任何进程（下载走注入的 fetchImpl，解压用 Node 自带 zlib 自解 zip）⇒ 全模块可脱机单测；
 *   · **绝不把 api_key / token 写进日志**（只回长度或指纹）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/** 与本仓 2026-09-30 POC 实证过的那一版对齐（换版本要重跑 POC：协议与配置项都可能变）。 */
const GATEWAY_VERSION = 'v1.11.9';
const GATEWAY_REPO = 'linguo2625469/workbuddy2api-panel';
/** 发布资产名（Windows；mac/Linux 有对应 tar.gz，本模块当前只处理 Windows 部署路径）。 */
const ASSET_NAME = 'wb2api-panel-' + GATEWAY_VERSION + '-windows-amd64.zip';
const CHECKSUMS_NAME = 'checksums.txt';

/** 默认端口：官方默认 7863；与 WorkDaddy 自己的 UI 端口（47832 起）不冲突。 */
const DEFAULT_PORT = 7863;
/** 网关二进制的硬上限，避免被超大/伪造资产撑爆内存（POC 实测 3.4 MB）。 */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
/** 解压后的单文件上限（POC 实测 exe 8.46 MB）。 */
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

/**
 * 目录布局（全部落在 WorkDaddy 自己的数据目录下，不污染 WorkBuddy 数据根）：
 *   <dataDir>/gateway/
 *     ├─ wb2api.exe         官方二进制
 *     ├─ config.example.json 官方样例（仅作字段模板来源）
 *     ├─ config.json        WorkDaddy 生成的实际配置
 *     ├─ auths/             凭证（由本模块写出）
 *     ├─ data/              网关自己的状态文件
 *     ├─ gateway.json       WorkDaddy 侧状态（版本/端口/启用开关；**不含 api_key 明文**）
 *     └─ wb2api.log         网关 stdout/stderr
 */
function gatewayPaths(dataDir) {
  const root = path.join(String(dataDir || ''), 'gateway');
  return {
    root: root,
    exe: path.join(root, process.platform === 'win32' ? 'wb2api.exe' : 'wb2api'),
    configExample: path.join(root, 'config.example.json'),
    config: path.join(root, 'config.json'),
    authDir: path.join(root, 'auths'),
    stateDir: path.join(root, 'data'),
    stateFile: path.join(root, 'gateway.json'),
    apiKeyFile: path.join(root, '.api_key'),
    logFile: path.join(root, 'wb2api.log'),
    stagingDir: path.join(root, '.staging'),
  };
}

function assertSafeRelativePath(relative) {
  const rel = String(relative || '');
  if (!rel || rel.includes('\0') || rel.startsWith('/') || rel.startsWith('\\')) throw new Error('压缩包包含非法路径');
  const parts = rel.split(/[\\/]+/);
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new Error('压缩包包含非法路径（越界）');
  }
  return parts.join('/');
}

/** 从 checksums.txt（`<sha256>  <文件名>` 每行一条）里取指定资产的期望摘要（小写；取不到返回 ''）。 */
function parseChecksums(text, assetName) {
  const wanted = String(assetName || '').trim();
  if (!wanted) return '';
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (!m) continue;
    if (m[2] === wanted) return m[1].toLowerCase();
  }
  return '';
}

/** 文件/缓冲区的 sha256（十六进制小写）。 */
function sha256(input) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.isBuffer(input) ? input : fs.readFileSync(String(input)));
  return h.digest('hex');
}

/**
 * 极简 zip 解析：只做「列出条目 + 解压」两件事，够用且**零外部依赖**（跨平台一致）。
 * 支持 stored(0) 与 deflate(8)；显式拒绝 zip64 / 加密 / 不支持的压缩法（给清晰错误而不是解出错数据）。
 * ⚠️ 安全：条目路径过 assertSafeRelativePath（防 zip slip）。
 * @returns {Array<{name:string, method:number, compressedSize:number, size:number, offset:number}>}
 */
function listZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // EOCD 签名 0x06054b50，位于末尾最多 64KB + 22 字节内
  const minPos = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录）');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) {
    throw new Error('暂不支持 zip64 压缩包');
  }
  if (cdOffset + cdSize > buf.length) throw new Error('zip 中央目录越界');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目录条目损坏');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (flags & 0x1) throw new Error('压缩包已加密，无法解压');
    if (method !== 0 && method !== 8) throw new Error('压缩包使用了不支持的压缩算法: ' + method);
    if (size > MAX_UNPACKED_BYTES) throw new Error('压缩包内单文件过大: ' + name);
    if (!/\/$/.test(name)) {
      entries.push({ name: assertSafeRelativePath(name), method: method, compressedSize: compressedSize, size: size, offset: localOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 解压单个条目为 Buffer（数据偏移以**本地头**为准：本地头的 extra 长度可能与中央目录不同）。 */
function readZipEntry(buffer, entry) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const p = entry.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error('zip 本地头损坏: ' + entry.name);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new Error('zip 数据越界: ' + entry.name);
  const raw = buf.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  const out = zlib.inflateRawSync(raw);
  if (out.length !== entry.size) throw new Error('zip 解压后长度不符: ' + entry.name);
  return out;
}

/**
 * 解压到目录（只写需要的文件，其它条目跳过）。返回写出的文件名列表。
 * @param {Buffer} buffer
 * @param {string} destDir
 * @param {{pick?:function(string):boolean}} [options] pick 为白名单谓词（缺省：解压全部文件）
 */
function extractZipToDir(buffer, destDir, options) {
  const opt = options || {};
  const pick = typeof opt.pick === 'function' ? opt.pick : () => true;
  // ⚠️ 必须先校验原始输入：`path.resolve('')` 返回的是**当前工作目录**（不是空串），
  //    先 resolve 再判空会漏掉「调用方忘了传目录」，然后把文件解到 cwd 里去。
  const rawDir = String(destDir === null || destDir === undefined ? '' : destDir).trim();
  if (!rawDir) throw new Error('缺少解压目标目录');
  const dir = path.resolve(rawDir);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const entry of listZipEntries(buffer)) {
    if (!pick(entry.name)) continue;
    const parts = entry.name.split('/');
    const target = path.join(dir, ...parts);
    const rel = path.relative(dir, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('解压路径越界: ' + entry.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, readZipEntry(buffer, entry));
    written.push(entry.name);
  }
  return written;
}

/**
 * 凭证桥（**纯函数**）：把本仓的账号对象转成官方二进制要的 auth 文件内容（嵌套形）。
 *
 * ⚠️ 两个坑（POC 实测）：
 *   ① `expiresAt` 本仓存的是**毫秒**，而官方 `auth.Auth.ExpiresAt` 是 **Unix 秒** ⇒ 必须 /1000；
 *   ② `realm` 本仓没有，由 domain 推（`.workbuddy.ai` ⇒ global，否则 cn）。
 *
 * @param {{uid:string, nickname?:string, accessToken:string, refreshToken?:string,
 *          expiresAt?:number, domain?:string, enterpriseId?:string}} input 已解密的账号
 * @returns {object|null} null = 缺关键字段，调用方应跳过该账号
 */
function buildAuthDocument(input) {
  const src = input && typeof input === 'object' ? input : {};
  const uid = String(src.uid || '').trim();
  const accessToken = typeof src.accessToken === 'string' ? src.accessToken.trim() : '';
  if (!uid || !accessToken) return null;
  const domain = String(src.domain || 'www.workbuddy.cn').trim() || 'www.workbuddy.cn';
  const rawExpires = Number(src.expiresAt);
  const hasExpires = Number.isFinite(rawExpires) && rawExpires > 0;
  const expiresAt = hasExpires ? Math.floor(rawExpires > 1e11 ? rawExpires / 1000 : rawExpires) : 0;
  const realm = /(^|\.)workbuddy\.ai$/i.test(domain) ? 'global' : 'cn';
  return {
    auth: {
      accessToken: accessToken,
      refreshToken: typeof src.refreshToken === 'string' ? src.refreshToken.trim() : '',
      expiresAt: expiresAt,
      domain: domain,
      realm: realm,
    },
    account: {
      uid: uid,
      enterpriseId: String(src.enterpriseId || ''),
      nickname: String(src.nickname || ''),
    },
  };
}

/** 写出 auths/<prefix>-<uid>.json（文件名必须匹配官方 `workbuddy*.json` 的扫描规则）。 */
function writeAuthDocuments(authDir, documents, options) {
  const opt = options || {};
  const dir = String(authDir || '');
  if (!dir) throw new Error('缺少 auths 目录');
  fs.mkdirSync(dir, { recursive: true });
  const prefix = String(opt.filePrefix || 'workbuddy');
  const written = [];
  for (const doc of (Array.isArray(documents) ? documents : [])) {
    if (!doc || !doc.account || !doc.account.uid) continue;
    const safeUid = String(doc.account.uid).replace(/[^A-Za-z0-9_-]/g, '_');
    if (!safeUid) continue;
    const file = path.join(dir, prefix + '-' + safeUid + '.json');
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), { mode: 0o600 });
    written.push({ uid: doc.account.uid, nickname: doc.account.nickname || '', file: file });
  }
  return written;
}

/**
 * 生成网关 config.json（**纯函数**，便于单测）。
 *
 * 三条**安全默认**（POC 里逐条实证过必要性，集成时必须锁死）：
 *   ① listen 收到**回环**（官方默认 `:7863` 等于 0.0.0.0，会暴露到局域网）；
 *   ② api_key **强制非空**（官方语义：空 = 不鉴权直接放行）；
 *   ③ schedule 的定时任务**全部关闭**（签到/旅行/活跃/保活与 WorkDaddy 已有能力重复）。
 *
 * @param {object} input { template, port, apiKey, authDir, stateFile, host, enableSchedules }
 */
function buildGatewayConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const template = src.template && typeof src.template === 'object' ? JSON.parse(JSON.stringify(src.template)) : {};
  const port = Number(src.port) > 0 ? Math.floor(Number(src.port)) : DEFAULT_PORT;
  const host = String(src.host || '127.0.0.1');
  const apiKey = String(src.apiKey || '').trim();
  if (!apiKey) throw new Error('api_key 不能为空（官方语义：空值 = 不鉴权放行）');
  const authDir = String(src.authDir || '');
  const stateFile = String(src.stateFile || '');
  if (!authDir || !stateFile) throw new Error('缺少 authDir / stateFile');
  const on = src.enableSchedules === true;

  template.listen = host + ':' + port;
  template.api_key = apiKey;
  template.auth_dir = authDir.replace(/\\/g, '/');
  template.state_file = stateFile.replace(/\\/g, '/');

  const schedule = Object.assign({}, template.schedule || {});
  for (const key of ['checkin_enabled', 'growth_enabled', 'travel_enabled', 'activity_enabled',
    'keepalive_enabled', 'blackcat_enabled', 'balance_refresh_enabled']) {
    schedule[key] = on;
  }
  template.schedule = schedule;

  // 提示词透传：网关有自己的系统提示词体系，默认替换会改变上游看到的内容 —— 保持透明。
  template.prompt = Object.assign({}, template.prompt || {}, { mode: 'passthrough' });
  // 不落盘请求正文（含对话内容），只在需要排障时由用户手动打开。
  template.logging = Object.assign({}, template.logging || {}, { request_archive_enabled: false });
  return template;
}

/** 读 WorkDaddy 侧状态（缺失/损坏一律给出「未安装」的默认值，不抛错）。 */
function readGatewayState(stateFile) {
  const fallback = { version: 0, installed: false, enabled: false, versionTag: '', gatewayVersion: '', port: DEFAULT_PORT, apiKeyHint: '', installedAt: 0, accounts: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(String(stateFile || ''), 'utf8'));
    if (!raw || typeof raw !== 'object') return fallback;
    return Object.assign({}, fallback, raw);
  } catch (_) { return fallback; }
}

/** 原子写状态（tmp + rename）。**不写 api_key 明文**，只写指纹与长度。 */
function writeGatewayState(stateFile, state, deps) {
  const file = String(stateFile || '');
  if (!file) throw new Error('缺少状态文件路径');
  const writeText = deps && typeof deps.writeText === 'function'
    ? deps.writeText
    : (f, text) => fs.writeFileSync(f, text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = Object.assign({}, state || {});
  delete payload.apiKey;
  writeText(file, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

/**
 * 把一个网关模型条目转成 WorkBuddy `models.json` 的形状（**纯函数**）。
 *
 * ⚠️ 设计取舍：**不在条目里塞自定义标记字段** —— `models.json` 是用户核心配置，官方解析器
 * 对未知字段的行为不可控；改为把「本次写入了哪些 id」记在 gateway 状态文件里，撤销时按名单删。
 * ⚠️ `id` 必须加前缀：网关的 id 形如 `cn:hy3-x`，与用户自己加的模型同处一个命名空间，
 * 加前缀既能一眼看出出处，也让「只删自己写的那批」有可靠的判据。
 *
 * @param {object} model 网关 /v1/models 的一条
 * @param {{baseUrl:string, apiKey:string, idPrefix?:string, namePrefix?:string}} options
 */
function toWorkbuddyModelEntry(model, options) {
  const src = model && typeof model === 'object' ? model : {};
  const opt = options && typeof options === 'object' ? options : {};
  const id = String(src.id || '').trim();
  const baseUrl = String(opt.baseUrl || '').replace(/\/+$/, '');
  if (!id || !baseUrl) return null;
  const contextLength = Number(src.context_length);
  const entry = {
    id: String(opt.idPrefix || 'gateway:') + id,
    name: String(opt.namePrefix || '[网关] ') + String(src.name || id),
    vendor: 'Custom',
    url: baseUrl + '/v1/chat/completions',
    apiKey: String(opt.apiKey || ''),
    useCustomProtocol: false,
    supportsToolCall: src.supports_tool_call === true,
  };
  if (Number.isFinite(contextLength) && contextLength > 0) entry.maxInputTokens = Math.floor(contextLength);
  return entry;
}

/**
 * 把网关条目并进现有 models.json（**纯函数**，用于单测）。
 * 语义：**只增删带自己前缀的条目，用户原有的一个都不动**（含同 id 冲突时以用户原有为准）。
 *
 * @param {Array} existing 现有 models.json 内容
 * @param {Array} gatewayEntries toWorkbuddyModelEntry 的产物
 * @param {{idPrefix?:string}} [options]
 * @returns {{models:Array, added:number, removed:number, ids:string[]}}
 */
function mergeGatewayModels(existing, gatewayEntries, options) {
  const opt = options && typeof options === 'object' ? options : {};
  const idPrefix = String(opt.idPrefix || 'gateway:');
  const list = Array.isArray(existing) ? existing.slice() : [];
  const incoming = (Array.isArray(gatewayEntries) ? gatewayEntries : []).filter(Boolean);
  // ① 先摘掉上一次注册的（按前缀识别），避免重复叠加
  const kept = list.filter((m) => !(m && typeof m.id === 'string' && m.id.startsWith(idPrefix)));
  const removed = list.length - kept.length;
  // ② 再追加本次的；与用户已有 id 撞车时**让用户原有条目胜出**（不覆盖用户配置）
  const occupied = new Set(kept.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter(Boolean));
  const appended = incoming.filter((e) => e && !occupied.has(e.id));
  return {
    models: kept.concat(appended),
    added: appended.length,
    removed: removed,
    ids: appended.map((e) => e.id),
  };
}

/** 撤销：按名单把本插件写入的条目摘掉（**纯函数**；名单来自 gateway 状态文件）。 */
function unmergeGatewayModels(existing, idsToRemove) {
  const wanted = new Set((Array.isArray(idsToRemove) ? idsToRemove : []).map(String).filter(Boolean));
  const list = Array.isArray(existing) ? existing : [];
  const models = list.filter((m) => !(m && typeof m.id === 'string' && wanted.has(m.id)));
  return { models: models, removed: list.length - models.length };
}

/** api_key 的展示用指纹（只回前 6 位 + 长度，够确认是不是同一把，又不泄漏）。 */
function apiKeyHint(apiKey) {
  const key = String(apiKey || '');
  if (!key) return '';
  return key.slice(0, 6) + '…(' + key.length + ')';
}

/** 生成本地 api_key（32 字节 base64url，约 43 字符）。 */
function generateApiKey(randomBytes) {
  const fn = typeof randomBytes === 'function' ? randomBytes : (n) => crypto.randomBytes(n);
  return Buffer.from(fn(32)).toString('base64url');
}

module.exports = {
  GATEWAY_VERSION,
  GATEWAY_REPO,
  ASSET_NAME,
  CHECKSUMS_NAME,
  DEFAULT_PORT,
  gatewayPaths,
  parseChecksums,
  sha256,
  listZipEntries,
  readZipEntry,
  extractZipToDir,
  buildAuthDocument,
  writeAuthDocuments,
  buildGatewayConfig,
  toWorkbuddyModelEntry,
  mergeGatewayModels,
  unmergeGatewayModels,
  readGatewayState,
  writeGatewayState,
  apiKeyHint,
  generateApiKey,
};
