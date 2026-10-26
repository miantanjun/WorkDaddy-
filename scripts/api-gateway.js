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

/**
 * 钉死的上游版本。换版本前**必须**先对比新旧 `config.example.json`（见 2026-10-15 记录）：
 * v1.11.9 → v1.13.0 是**纯增量**（新增 server.read_timeout / logging.* 三项 / schedule.include_disabled_in_tasks /
 * pool.credit_floor，**零删除**）⇒ 模板驱动的 buildGatewayConfig 无需改逻辑。
 */
const GATEWAY_VERSION = 'v1.13.0';
const GATEWAY_REPO = 'linguo2625469/workbuddy2api-panel';
/** 发布资产名（Windows；mac/Linux 有对应 tar.gz，本模块当前只处理 Windows 部署路径）。 */
const ASSET_NAME = 'wb2api-panel-' + GATEWAY_VERSION + '-windows-amd64.zip';
const CHECKSUMS_NAME = 'checksums.txt';

/** 默认端口：官方默认 7863；与 WorkDaddy 自己的 UI 端口（47832 起）不冲突。 */
const DEFAULT_PORT = 7863;
/** 网关二进制的硬上限，避免被超大/伪造资产撑爆内存（POC 实测 3.4 MB）。 */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
/** 解压后的单文件上限（v1.13.0 实测 exe 8.71 MB）。 */
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
 * 把 auths/ 同步成 `documents` 描述的那批账号（**增量**，2026-10-16 新增）。
 *
 * 与 `writeAuthDocuments` 的区别（后者是「全量重写」，只在安装网关时用一次）：
 *   · 缺的 ⇒ 写；内容变了（token 刷新 / 昵称变化）⇒ 重写；
 *     内容一模一样 ⇒ **一个字都不写**（避免每轮把无关账号的 mtime 一起刷新）；
 *   · 本插件写得出的、但**不在 documents 里**的 ⇒ **删**（账号已被移除；留着只会让网关拿它反复撞 401）。
 *
 * ⚠️ 为什么必须增量：本函数挂在「账号备份之后」——每次登录 / 切号 / auth 目录文件变动都会触发。
 *    全量重写会把所有账号的 mtime 刷新一遍，网关侧可能因此反复重载账号池。
 * ⚠️ 删除只认文件名形如 `<prefix>-<uid>.json` 的文件，auths 目录里的其它文件一概不碰。
 *
 * @param {string} authDir
 * @param {Array} documents buildAuthDocument 的产物
 * @param {{filePrefix?:string}} [options]
 * @returns {{added:string[], updated:string[], removed:string[], unchanged:number, total:number}}
 */
function syncAuthDocuments(authDir, documents, options) {
  const opt = options && typeof options === 'object' ? options : {};
  const dir = String(authDir || '');
  if (!dir) throw new Error('缺少 auths 目录');
  fs.mkdirSync(dir, { recursive: true });
  const prefix = String(opt.filePrefix || 'workbuddy');
  const pattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-[A-Za-z0-9_-]+\\.json$');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { names = []; }
  const stale = new Set(names.filter((name) => pattern.test(name)));
  const added = [];
  const updated = [];
  const removed = [];
  let unchanged = 0;
  for (const doc of (Array.isArray(documents) ? documents : [])) {
    if (!doc || !doc.account || !doc.account.uid) continue;
    const safeUid = String(doc.account.uid).replace(/[^A-Za-z0-9_-]/g, '_');
    if (!safeUid) continue;
    const name = prefix + '-' + safeUid + '.json';
    const file = path.join(dir, name);
    const body = JSON.stringify(doc, null, 2);
    const exists = stale.has(name);
    stale.delete(name);
    if (exists) {
      let prev = '';
      try { prev = fs.readFileSync(file, 'utf8'); } catch (_) { prev = ''; }
      if (prev === body) { unchanged += 1; continue; }
      fs.writeFileSync(file, body, { mode: 0o600 });
      updated.push(name);
    } else {
      fs.writeFileSync(file, body, { mode: 0o600 });
      added.push(name);
    }
  }
  for (const name of stale) {
    const file = path.join(dir, name);
    const uid = name.slice(prefix.length + 1, -'.json'.length);
    try {
      // ⚠️ 删除前再确认一次「这确实是本插件写得出的账号文件」：能解析成 auth 文档、且
      //    文件里的 account.uid 与文件名里的 uid 一致。否则（用户手工丢进来的无关 json）一律保留。
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const docUid = String((doc && doc.account && doc.account.uid) || '');
      if (!docUid || docUid.replace(/[^A-Za-z0-9_-]/g, '_') !== uid) continue;
      fs.unlinkSync(file);
      removed.push(name);
    } catch (_) { /* 解析不了 ⇒ 不是账号文件，保留 */ }
  }
  return { added: added, updated: updated, removed: removed, unchanged: unchanged, total: added.length + updated.length + unchanged };
}

/**
 * 生成网关 config.json（**纯函数**，便于单测）。
 *
 * 三条**安全默认**（POC 里逐条实证过必要性，集成时必须锁死）：
 *   ① listen 收到**回环**（官方默认 `:7863` 等于 0.0.0.0，会暴露到局域网）；
 *   ② api_key **强制非空**（官方语义：空 = 不鉴权直接放行）；
 *   ③ schedule 的定时任务**全部关闭**（签到/旅行/活跃/保活与 WorkDaddy 已有能力重复）。
 *
 * ⭐ 升级路径：`preserve` 传**上一版 config.json**，则先把它里面的用户改动搬回来（新模板有该键才搬，
 *   且不搬 WorkDaddy 强制管理的键）—— 这样「重装/升级」不会把用户在网关面板里调过的参数冲掉。
 *
 * @param {object} input { template, preserve?, port, apiKey, authDir, stateFile, host, enableSchedules }
 */
function buildGatewayConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const template = src.template && typeof src.template === 'object' ? JSON.parse(JSON.stringify(src.template)) : {};
  // ⭐ 保留用户配置：以**新模板**为底，旧配置里同名键的值覆盖回来。
  //    · 新模板没有该键 ⇒ 丢弃（避免把上游已废弃的键带回，如 v1.11.0 删掉的 server.max_body_mb）；
  //    · 管理键（listen/api_key/auth_dir/state_file）与安全默认（schedule/prompt/logging）**不参与**，后面统一强制。
  const preserve = src.preserve && typeof src.preserve === 'object' && !Array.isArray(src.preserve) ? src.preserve : null;
  if (preserve) {
    const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    const merge = (base, over) => {
      const out = Object.assign({}, base);
      for (const k of Object.keys(over)) {
        if (!(k in base)) continue;
        out[k] = (isObj(base[k]) && isObj(over[k])) ? merge(base[k], over[k]) : over[k];
      }
      return out;
    };
    for (const k of ['panel', 'client', 'cooldown', 'global', 'upstream', 'features', 'upstash', 'pool', 'session_sticky', 'server']) {
      if (isObj(template[k]) && isObj(preserve[k])) template[k] = merge(template[k], preserve[k]);
    }
    // schedule 只搬**时间表**（*_enabled 由安全默认统一关）；prompt/logging 完全由下面强制。
    if (isObj(template.schedule) && isObj(preserve.schedule)) {
      for (const k of Object.keys(preserve.schedule)) {
        if (/_enabled$/.test(k)) continue;
        if (k in template.schedule) template.schedule[k] = preserve.schedule[k];
      }
    }
  }
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
 * WorkBuddy 认的思考档位全集（据客户端 5.8.2 asar：EXTENDED_THINKING_LEVELS）。
 * 其中 `xhigh` / `max` 额外要求顶层 thinkingLevelMap 显式给值，故只在网关明确列出时才透传。
 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** 归一化一个思考档位；非法值返回 ''（**不猜、不编造**）。 */
function normalizeThinkingLevel(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return THINKING_LEVELS.indexOf(v) >= 0 ? v : '';
}

/**
 * 两个 URL 是否指向同一个服务（比 origin = 协议+主机+端口）。
 * 用途：判断「models.json 里那条同名条目」到底是不是**指向本网关**——只有指向本网关才算重复。
 * 解析失败一律判 false（宁可放行，也不误删用户的条目）。
 */
/**
 * 剥掉中间层代理的 url 包裹前缀，返回内层真实 url（不是包裹形态的原样返回）。
 *   http://127.0.0.1:8790/bili/http://127.0.0.1:7863/v1/...  ⇒  http://127.0.0.1:7863/v1/...
 * ⚠️ 只认「路径段以 http:// 或 https:// 开头」这一种形态（中间代理把上游 URL 编码进 path 时就是这种），
 *    别的代理格式不猜 —— 猜错会把用户的 url 认成另一个模型。
 * ⚠️ 支持嵌套（两级包裹）；上限 3 层，防畸形字符串把自己剥成空。
 */
function unwrapProxyUrl(url) {
  let cur = String(url || '');
  for (let i = 0; i < 3; i += 1) {
    const m = /^https?:\/\/[^/]+\/(?:[^/]+\/)+(https?:\/\/.+)$/i.exec(cur);
    if (!m) break;
    cur = m[1];
  }
  return cur;
}

/**
 * 两个 url 是否**指向同一后端**。
 * ⭐ 必须先剥代理包裹层再比 —— 接了中间代理后 url 外层是代理端口，
 *    直接比 origin 会把「同一个网关的条目」判成不相关（见文件头 patch 说明）。
 */
function gatewaySameOrigin(url, baseUrl) {
  try {
    const a = new URL(unwrapProxyUrl(url)).origin;
    const b = new URL(unwrapProxyUrl(baseUrl)).origin;
    return a === b;
  } catch (_) { return false; }
}

/**
 * 把一个网关模型条目转成 WorkBuddy `models.json` 的形状（**纯函数**）。
 *
 * ⭐ 覆盖 models.json 支持的**字段全集**（据客户端 5.8.2 的 asar 校验器确认）：
 *   string  : name / vendor / url / apiKey
 *   number  : maxInputTokens / maxOutputTokens / temperature
 *   boolean : supportsToolCall / supportsImages / supportsReasoning / onlyReasoning / useCustomProtocol
 *   object  : reasoning { supportedEfforts / defaultEffort / canDisableThinking / summary }
 * ⚠️ **上下文档位不存在**：`supportedContextWindows` / `defaultContextWindow` 在 asar 里 **0 引用**
 *    （对比 maxInputTokens 25 次），写了不生效 ⇒ 本函数刻意**不产出**，免得给用户一个「选了也没用」的下拉框。
 * ⚠️ 设计取舍：**不在条目里塞自定义标记字段** —— `models.json` 是用户核心配置，官方解析器
 *    对未知字段的行为不可控；改为把「本次写入了哪些 id」记在 gateway 状态文件里，撤销时按名单删。
 * ⚠️ `id` 必须加前缀：网关的 id 形如 `cn:hy3-x`，与用户自己加的模型同处一个命名空间，
 *    加前缀既能一眼看出出处，也让「只删自己写的那批」有可靠的判据。
 *
 * @param {object} model 网关 /v1/models 的一条
 * @param {{baseUrl:string, apiKey:string, idPrefix?:string, namePrefix?:string, showCredits?:boolean}} options
 */
function toWorkbuddyModelEntry(model, options) {
  const src = model && typeof model === 'object' ? model : {};
  const opt = options && typeof options === 'object' ? options : {};
  const id = String(src.id || '').trim();
  const baseUrl = String(opt.baseUrl || '').replace(/\/+$/, '');
  if (!id || !baseUrl) return null;
  const idPrefix = String(opt.idPrefix == null ? 'gateway:' : opt.idPrefix);
  const namePrefix = String(opt.namePrefix == null ? '[网关] ' : opt.namePrefix);
  const credits = String(src.credits || '').trim();
  const entry = {
    id: idPrefix + id,
    name: namePrefix + String(src.name || id) + (credits && opt.showCredits !== false ? ' · ' + credits : ''),
    vendor: 'Custom',
    url: baseUrl + '/v1/chat/completions',
    apiKey: String(opt.apiKey || ''),
    useCustomProtocol: false,
    supportsToolCall: src.supports_tool_call === true,
  };
  const contextLength = Number(src.context_length);
  if (Number.isFinite(contextLength) && contextLength > 0) entry.maxInputTokens = Math.floor(contextLength);
  const maxOutput = Number(src.max_output_tokens);
  if (Number.isFinite(maxOutput) && maxOutput > 0) entry.maxOutputTokens = Math.floor(maxOutput);
  if (src.supports_images === true) entry.supportsImages = true;
  if (src.supports_reasoning === true) {
    entry.supportsReasoning = true;
    const onlyReasoning = src.only_reasoning === true;
    if (onlyReasoning) entry.onlyReasoning = true;
    const reasoning = {};
    const efforts = Array.isArray(src.reasoning_supported_efforts)
      ? Array.from(new Set(src.reasoning_supported_efforts.map(normalizeThinkingLevel).filter((x) => x && x !== 'off')))
      : [];
    if (efforts.length) reasoning.supportedEfforts = efforts;
    const def = normalizeThinkingLevel(src.reasoning_default_effort);
    if (def && def !== 'off') reasoning.defaultEffort = def;
    // 与官方判据对齐：canAutomationModelDisableThinking = onlyReasoning!==true && reasoning.canDisableThinking!==false
    reasoning.canDisableThinking = !onlyReasoning;
    const summary = String(src.reasoning_summary || '').trim();
    if (summary) reasoning.summary = summary;
    entry.reasoning = reasoning;
  }
  return entry;
}

/**
 * 判定一个网关模型当前在 models.json 里的注册状态（**纯函数**）。
 *   'registered' —— 本插件写过（id === idPrefix + rawId）
 *   'external'   —— 已存在同名条目但**不是**本插件写的（例如用户手工配的 `cn:xxx`）
 *   'absent'     —— 完全没有
 */
function gatewayModelState(existing, rawId, options) {
  const opt = options && typeof options === 'object' ? options : {};
  const list = Array.isArray(existing) ? existing : [];
  const prefix = String(opt.idPrefix == null ? 'gateway:' : opt.idPrefix);
  const baseUrl = String(opt.baseUrl || '');
  const raw = String(rawId || '');
  if (!raw) return 'absent';
  for (const m of list) if (m && m.id === prefix + raw) return 'registered';
  // ⭐ 认领过的手工条目：id 没有前缀，但 gateway 状态文件里记着「这是本插件写的」
  //    （mergeGatewayModels 会认领同源的手工 cn:xxx 并保留原 id）⇒ 应显示「已注册」。
  const own = Array.isArray(opt.registeredIds) ? opt.registeredIds.map(String) : [];
  if (own.indexOf(raw) >= 0) {
    // ⚠️ 仍要同源校验：用户可能事后把这条 url 改指到别处，那时它已不是本插件的模型
    for (const m of list) {
      if (m && m.id === raw && (!baseUrl || gatewaySameOrigin(m.url, baseUrl))) return 'registered';
    }
  }
  for (const m of list) {
    if (m && m.id === raw && (!baseUrl || gatewaySameOrigin(m.url, baseUrl))) return 'external';
  }
  return 'absent';
}

/**
 * 把网关条目并进现有 models.json（**纯函数**，用于单测）。
 * 语义：**只增删带自己前缀的条目，用户原有的一个都不动**。
 *   · `gatewayEntries` = **本次期望存在的全部网关条目**（声明式：不在其中的本插件旧条目会被摘掉）。
 *   · 与外部已有条目（id 恰好等于网关原始 id）撞车时**跳过**，避免同一模型出现两份；
 *     只有列进 `options.overwrite` 的才会顶掉外部条目（用户显式要求）。
 *
 * @param {Array} existing 现有 models.json 内容
 * @param {Array} gatewayEntries toWorkbuddyModelEntry 的产物
 * @param {{idPrefix?:string, overwrite?:string[]}} [options]
 * @returns {{models:Array, added:number, removed:number, rewritten:number, skipped:string[], ids:string[]}}
 *   · `removed` 只数**真正消失**的条目（声明式移除 + 顶掉外部条目）；同 id 覆盖重写记在 `rewritten`。
 */
/**
 * 把网关条目并进现有 models.json（**纯函数**，用于单测）。
 * 语义：**只碰「本网关的」条目，其它模型一个不动**。
 *   · `gatewayEntries` = 本次**期望存在**的全部网关条目（声明式：不在其中的会被摘掉）。
 *   · 「本网关的条目」= ① 本插件写的（id 带 `idPrefix` 前缀）；② **指向同一个网关**的条目
 *     （例如手工配的 `cn:glm-5.3`，url 也是这个网关）—— 两种都归本函数管。
 *   · 落位时优先**认领**已有的那条（原地更新字段、**保留它原来的 id**），
 *     所以手工配的 `cn:xxx` 不会被平白多出一条 `gateway:cn:xxx`，models.json 保持干净。
 *   · `options.overwrite` 已废弃：认领本身就是「接管」，不再需要显式顶掉。
 *
 * @param {Array} existing 现有 models.json 内容
 * @param {Array} gatewayEntries toWorkbuddyModelEntry 的产物
 * @param {{idPrefix?:string, baseUrl?:string}} [options]
 * @returns {{models:Array, added:number, removed:number, rewritten:number, skipped:string[], ids:string[]}}
 *   · `removed` 只数**真正消失**的条目；原地更新（含认领手工条目）记在 `rewritten`。
 *   · `ids` = 本次操作后**本插件管理的全部条目 id**（含认领的），撤销 / 卸载按它删。
 */
function mergeGatewayModels(existing, gatewayEntries, options) {
  const opt = options && typeof options === 'object' ? options : {};
  const idPrefix = String(opt.idPrefix == null ? 'gateway:' : opt.idPrefix);
  const baseUrl = String(opt.baseUrl || '').replace(/\/+$/, '');
  const list = Array.isArray(existing) ? existing.slice() : [];
  const incoming = (Array.isArray(gatewayEntries) ? gatewayEntries : []).filter(Boolean);
  const stripPrefix = (id) => (String(id).startsWith(idPrefix) ? String(id).slice(idPrefix.length) : String(id));
  const same = (url) => !!(baseUrl && gatewaySameOrigin(url, baseUrl));
  const wantedRaw = new Set(incoming.map((e) => stripPrefix((e && e.id) || '')).filter(Boolean));
  // ① 清理：本网关的条目里，本次不再期望存在的全部摘掉（用户取消勾选 = 真的移除）。
  let removed = 0;
  const kept = list.filter((m) => {
    if (!m || typeof m.id !== 'string' || !m.id) return true;
    if (!m.id.startsWith(idPrefix) && !same(m.url)) return true;
    if (wantedRaw.has(stripPrefix(m.id))) return true;
    removed += 1;
    return false;
  });
  // ② 去重：同一模型若同时留着 `gateway:xxx` 与裸 `xxx`（历史遗留），摘掉裸的那条。
  const prefixedRaws = new Set(kept.map((m) => (m && typeof m.id === 'string' && m.id.startsWith(idPrefix)) ? m.id.slice(idPrefix.length) : '').filter(Boolean));
  let base = kept;
  if (prefixedRaws.size) {
    base = kept.filter((m) => {
      if (m && typeof m.id === 'string' && !m.id.startsWith(idPrefix) && prefixedRaws.has(m.id) && same(m.url)) { removed += 1; return false; }
      return true;
    });
  }
  // ③ 落位：认领 > 新建
  //    「认领」= 已有一条同一个模型的条目（本插件写的 `gateway:xxx`，或同源的手工 `xxx`）⇒
  //    原地更新它的能力字段、**保留它原来的 id 与 name**（用户起的名字不动），不新增副本。
  const models = base.slice();
  const taken = new Set(models.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter(Boolean));
  const skipped = [];
  const ids = [];
  let added = 0;
  let rewritten = 0;
  for (const e of incoming) {
    const eid = String((e && e.id) || '');
    if (!eid) continue;
    const raw = stripPrefix(eid);
    const hasPrefix = !!(eid.startsWith(idPrefix) && raw);
    let idx = -1;
    for (let i = 0; i < models.length; i += 1) {
      const m = models[i];
      if (!m || typeof m.id !== 'string' || !m.id) continue;
      // 认领本插件自己写的（前缀即铁证，无需同源校验）
      if (hasPrefix && m.id === eid) { idx = i; break; }
      // 认领手工条目：同名**且**确实指向本网关才算（否则只是撞名，绝不能碰）
      if (!m.id.startsWith(idPrefix) && m.id === raw && same(m.url)) { idx = i; break; }
    }
    if (idx >= 0) {
      const prev = models[idx];
      const patch = { id: prev.id };
      if (prev.name) patch.name = prev.name;
      models[idx] = Object.assign({}, e, patch);
      rewritten += 1;
      ids.push(prev.id);
      continue;
    }
    // 裸 id 已被**别的**（不同源的）模型占着 ⇒ 退回带前缀的 id，绝不覆盖用户自己的东西
    const id = taken.has(raw) ? idPrefix + raw : raw;
    if (taken.has(id)) { skipped.push(raw); continue; }
    taken.add(id);
    models.push(Object.assign({}, e, { id: id }));
    added += 1;
    ids.push(id);
  }
  return { models: models, added: added, removed: removed, rewritten: rewritten, skipped: skipped, ids: ids };
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
  syncAuthDocuments,
  buildGatewayConfig,
  toWorkbuddyModelEntry,
  mergeGatewayModels,
  unmergeGatewayModels,
  gatewayModelState,
  unwrapProxyUrl,
  THINKING_LEVELS,
  normalizeThinkingLevel,
  readGatewayState,
  writeGatewayState,
  apiKeyHint,
  generateApiKey,
};
