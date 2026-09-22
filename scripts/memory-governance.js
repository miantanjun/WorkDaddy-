'use strict';

/**
 * 记忆治理巡检（memory-governance）——把「哪条记忆该留在哪一层」变成可测量、可执行的清单。
 *
 * 为什么需要它：WorkDaddy 的记忆分三层，其中**三层的文件在每个新会话开始时被注入，
 * 并且此后每一轮都随整段历史重发一次**。也就是说常驻记忆的每一 KB 都要乘上「轮次」。
 * 实测（2026-09-22 本机，55 项总账那次复核的同时）：
 *   云端档案 28,367 B + 用户级 MEMORY.md 8,881 B + 工作区 MEMORY.md 12,004 B
 *   + 身份三件套 4,822 B ≈ **54 KB 常驻** —— 这是每个新会话都要先交的固定入场费。
 *
 * 本模块只做两件事，全部是**本地只读测量 + 给出动作**：
 *   ① 量：每层的体积；层与层的错位（项目细节写进了跨项目层，反之亦然）；
 *      残留的 .bak 副本；日档是否到了该蒸馏的时候；跨文件重复的条目；失效的路径引用。
 *   ② 提醒：每条 finding 只给「复制指令」（`fix.kind === 'paste'`），
 *      **刻意不提供任何自动改写动作** —— 记忆是语义资产，机器猜错会把结论改坏。
 *      本模块不写盘、不发网络、不调用模型。
 *
 * 分层判据（与系统提示里的三层记忆一一对应，别记错，传错路径只会静默全零）：
 *   cloud   云端档案   `<home>/memory/*_memory.md`          跨项目  常驻注入  只读（服务端管理）
 *   user    用户级记忆  `<home>/MEMORY.md`                    跨项目  常驻注入  可写
 *   project 工作区记忆  `<ws>/.workbuddy/memory/MEMORY.md`     本项目  常驻注入  可写
 *   daily   工作区日档  `<ws>/.workbuddy/memory/YYYY-MM-DD.md` 本项目  按需读取（不进上下文）
 *
 * ⚠️ 这里 `home` 一律指 **WorkBuddy 数据根**（`PROFILE.dataRoot`，即 `<用户主目录>/.workbuddy`），
 *    不是用户主目录 —— 与本仓库 `context-audit.js` 的 `home` 语义一致，
 *    与 `context-fix.js` 的 `home`（用户主目录）**相反**。路由一律传 `dataRoot`。
 *
 * 唯一真相：常驻层只放**「不看会做错」的判据**（红线 / 判据 / 唯一路径 / 陷阱）；
 * 过程性细节（怎么试的、试了几次、当时输出什么）属于日档与 skill 的 `references/`。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 阈值的依据（都是「硬限额优先、经验值兜底」）：
//   - 用户级 / 工作区记忆：系统提示里写死了 `4,000 chars/session` 与 `3,000 chars/session`，
//     这是**真正的硬限额**，超了意味着后半段有被截掉的风险 ⇒ crit 就压在限额上。
//   - 云端档案：服务端生成、本地只读，8 KB 是「信息密度够用」的经验线。
//   - 日档：不进上下文，只影响「读它的那一次」的成本；80 KB 说明当天过程细节全堆进去了。
const THRESHOLDS = {
  cloudProfileBytes: { warn: 8 * 1024, crit: 16 * 1024 },
  userMemoryChars: { warn: 3000, crit: 4000 },
  projectMemoryChars: { warn: 2400, crit: 3000 },
  identityBytes: { warn: 8 * 1024, crit: 16 * 1024 },
  dailyLogBytes: { warn: 40 * 1024, crit: 80 * 1024 },
  staleDailyDays: 30,
  deadPointerLimit: 5,
  duplicateLineLimit: 8,
};

const LAYERS = {
  cloud: { id: 'cloud', name: '云端档案', scope: 'cross-project', injected: true, writable: false },
  user: { id: 'user', name: '用户级记忆', scope: 'cross-project', injected: true, writable: true },
  project: { id: 'project', name: '工作区记忆', scope: 'project', injected: true, writable: true },
  daily: { id: 'daily', name: '工作区日档', scope: 'project', injected: false, writable: true },
};

/**
 * POSIX 绝对路径的「根段白名单」—— 只有落在这里面的才算文件系统目录。
 *
 * 为什么必须有它：记忆正文里到处都是 **HTTP 路由**（`/api/context-audit`、
 * `/api/account-health`），形态与 POSIX 绝对路径完全一致。不加白名单就会把路由当成
 * 「别的项目目录」报出来（实测假阳性），也会把路由当文件去校验存在性（必然失败）。
 * Windows 侧不需要白名单 —— 盘符本身就不可能是路由。
 */
const POSIX_ROOTS = new Set([
  'users', 'home', 'mnt', 'media', 'volumes', 'opt', 'srv', 'data', 'var', 'usr',
  'private', 'applications', 'library', 'tmp', 'etc', 'root', 'workspace', 'projects',
]);

/** 段数组是否像一个真实文件系统路径（Windows 看盘符，POSIX 看根白名单）。 */
function looksLikeFsPath(parts, isWindows) {
  if (isWindows) return parts.length >= 1;
  if (!parts.length) return false;
  return POSIX_ROOTS.has(String(parts[0]).toLowerCase());
}

function levelOf(value, threshold) {
  const number = Number(value) || 0;
  if (!threshold) return 'ok';
  if (number >= threshold.crit) return 'crit';
  if (number >= threshold.warn) return 'warn';
  return 'ok';
}

function safeStat(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch (_) {
    return null;
  }
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

function safeList(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
}

/**
 * 报告里一律用正斜杠路径。
 * 理由：这些路径会进 finding 的 key（回归按 key 断言）、进面板、进「可复制的指令」，
 * 混着 `\` 与 `/` 会让 key 在不同调用方之间对不上（本模块第一版的 key 是 `\`，
 * 回归用 `/` 拼 → 全部 findByKey 返 null）。
 * ⚠️ 只用于**展示与键**；所有 fs 调用仍在归一化之前完成。
 */
function displayPath(file) {
  return String(file || '').replace(/\\/g, '/');
}

/** 纯字符数（不含 BOM 之外的任何归一化）。记忆限额是按字符算的，别用字节。 */
function charCount(text) {
  return String(text == null ? '' : text).replace(/^\uFEFF/, '').length;
}

/**
 * 从正文里抽出「绝对路径前缀」并按出现次数排序。
 *
 * 这是「错层判定」的核心手段：如果**跨项目层**（user）里反复出现某个具体项目目录的路径，
 * 那就是把项目细节写在了跨项目层；反之在**项目层**（project）里出现工作区之外的路径，
 * 就是记了别的项目的事。比关键词猜测精确得多，而且在 fixture 里可复现。
 *
 * 前缀口径 = 盘符 + 前两段目录（`D:/WorkDaddy`、`C:/Users/Lyon`），这样同一项目的多处引用会合并。
 * ⚠️ 默认会忽略 `<home>` 及其父目录 —— 记忆系统自身的家、以及操作系统用户主目录，
 *   它们在**任何**工作区里出现都是正常的，不构成错层（这是本模块第一版的假阳性来源）。
 *
 * ⚠️ 三个必须排除的形态（全是实测踩出来的假阳性）：
 *   ① `*.js` / `?` / `{}` 这类通配或占位符 ⇒ 不是真路径；
 *   ② 中缀路径：`foo/bar.js` 里的 `/bar.js`。**必须用负向后顾**断言 `/` 之前不是路径字符，
 *      否则正文里每一处相对路径都会贡献一个假的「根目录」；
 *   ③ `..` / `...`（相对上级、或记忆里常见的省略号写法）。
 */
function pathPrefixes(text, options) {
  const opts = options || {};
  const ignore = opts.ignorePrefixes || [];
  const counter = new Map();
  // ⚠️ 盘符必须**在捕获组里**：第一版把 `D:` 留在组外，于是 `C:/Users/x` 被切成
  //    ['Users','x']、被判成 POSIX 路径 —— 所有 Windows 路径都丢了盘符（回归 [B] 抓出来的）。
  const re = /(?<![A-Za-z0-9._-])((?:[A-Za-z]:[\\/]|\/)[^\s`'"()<>[\]{},;:*?{}|]+)/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) {
    const body = match[1];
    if (!body || body.indexOf('..') >= 0) continue;
    const parts = body.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) continue;
    const isWindows = /^[A-Za-z]:$/.test(parts[0]);
    const drive = isWindows ? parts.shift() : '';
    if (!looksLikeFsPath(parts, isWindows)) continue; // 排掉 `/api/xxx` 这类路由
    // ⚠️ 前缀深度必须**固定**：第一版按「末段带不带扩展名」决定切到第几层，
    //    于是 `D:/P/src/a.js` → `D:/P/src`、`D:/P/README.md` → `D:/P`，
    //    同一个项目被拆成两个前缀、计数被稀释（回归 B1 抓出来的）。
    //    Windows 取「盘符 + 1 段目录」，POSIX 取「前 2 段」，口径统一。
    const depth = isWindows ? 1 : 2;
    if (parts.length < depth) continue;
    const prefix = (drive ? drive + '/' : '/') + parts.slice(0, depth).join('/');
    if (!prefix || prefix.length < 4) continue;
    let skip = false;
    for (const item of ignore) {
      if (prefix.toLowerCase().indexOf(String(item).toLowerCase()) === 0) { skip = true; break; }
    }
    if (skip) continue;
    counter.set(prefix, (counter.get(prefix) || 0) + 1);
  }
  return Array.from(counter.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/**
 * 抽正文里被反引号包住的绝对路径（只有这种「明确写成路径」的才做存在性校验，避免误报）。
 * ⚠️ 必须排除**示意性写法**：`D:/...`、`D:\WorkBuddy date\<会话>\`、`/d/...`
 *   —— 它们是文档里的占位符，不是真引用。判据：含 `<` `>` 或 `..`，或含通配符，一律跳过。
 */
function backtickPaths(text) {
  const out = [];
  const seen = new Set();
  const re = /`([A-Za-z]:[\\/][^`\r\n]+|\/[A-Za-z0-9._~-][^`\r\n]*)`/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) {
    const candidate = match[1].replace(/[\\/]+$/, '').trim();
    if (candidate.length < 6 || candidate.length > 240) continue;
    if (/\s/.test(candidate)) continue; // 含空格 ⇒ 反引号里是句子，不是路径
    if (/[*?{}<>]/.test(candidate)) continue; // 通配 / 占位符
    if (candidate.indexOf('..') >= 0) continue; // 省略号 / 相对上级
    if (!/^[A-Za-z]:/.test(candidate)) {
      // POSIX 形态：必须是文件系统根（排掉 `/api/...` 这类 HTTP 路由）
      const parts = candidate.split('/').filter(Boolean);
      if (!looksLikeFsPath(parts, false)) continue;
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** 把记忆正文拆成「可比对的事实行」：去前缀符号、压空白、去掉行尾标点。 */
function factLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s*/, '')
      .replace(/\s+/g, ' ')
      .replace(/[，。；、！？：,.;:!?]+$/g, '')
      .trim();
    if (line.length < 24) continue;
    if (/^\|/.test(line)) continue; // 表格分隔行噪声大
    out.push(line);
  }
  return out;
}

/** 收集某一层目录里的残留副本（.bak / .bak-xxx / ~ / .old / .orig）。 */
function listBackups(dir) {
  const out = [];
  for (const entry of safeList(dir)) {
    if (entry.isDirectory()) continue;
    if (!/\.(bak|old|orig|tmp)([-.].*)?$|~$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const stat = safeStat(full);
    out.push({ file: displayPath(full), name: entry.name, bytes: stat ? stat.size : 0 });
  }
  out.sort((a, b) => b.bytes - a.bytes);
  return out;
}

function readLayerFile(file, label, layer) {
  const stat = safeStat(file);
  if (!stat) return { label, layer, path: file, bytes: 0, chars: 0, present: false, mtime: 0, text: null };
  const text = safeRead(file);
  return {
    label,
    layer,
    path: displayPath(file),
    bytes: stat.size,
    chars: charCount(text),
    present: true,
    mtime: stat.mtimeMs,
    text,
  };
}

/**
 * 主入口。所有路径与阈值可注入，方便回归里造 fixture；不给参数时读真实机器。
 *
 * @param {object} [options]
 * @param {string} [options.home]       WorkBuddy 数据根（默认 `~/.workbuddy`）
 * @param {string} [options.workspace]  工作区目录（给了才算 project/daily 两层）
 * @param {number} [options.now]        当前时刻（测试用，默认 Date.now()）
 * @param {boolean}[options.checkPaths] 是否校验反引号路径的存在性（默认 true）
 */
function auditMemoryGovernance(options) {
  const opts = options || {};
  const home = opts.home || path.join(os.homedir(), '.workbuddy');
  const workspace = opts.workspace || null;
  const now = Number(opts.now) || Date.now();
  const checkPaths = opts.checkPaths !== false;

  const findings = [];
  const push = (severity, key, layer, title, detail, action, paste) =>
    findings.push({
      severity,
      key,
      layer,
      title,
      detail,
      action,
      // B2 的铁律：**只提醒不自动改写** ⇒ 这里永远只产 paste，绝不产 auto。
      fix: { kind: 'paste', prompt: paste },
    });

  // ---------- 1. 采集三层（+ 日档）----------
  const cloudDir = path.join(home, 'memory');
  const cloudFiles = [];
  for (const entry of safeList(cloudDir)) {
    if (entry.isDirectory()) continue;
    if (!/_memory\.md$/i.test(entry.name)) continue; // 明确排除 *.bak（不以 _memory.md 结尾）
    const full = path.join(cloudDir, entry.name);
    const stat = safeStat(full);
    if (!stat) continue;
    cloudFiles.push({
      label: entry.name.replace(/_memory\.md$/i, '').slice(0, 8),
      layer: 'cloud',
      path: displayPath(full),
      bytes: stat.size,
      chars: 0, // 云端档案只量体积，不读正文（服务端产物，读了也没法改）
      present: true,
      mtime: stat.mtimeMs,
      text: null,
    });
  }
  cloudFiles.sort((a, b) => b.bytes - a.bytes);

  const userFile = readLayerFile(path.join(home, 'MEMORY.md'), '用户级长期记忆', 'user');
  const identityFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md']
    .map((name) => readLayerFile(path.join(home, name), name.replace(/\.md$/, ''), 'user'));

  const projectDir = workspace ? path.join(workspace, '.workbuddy', 'memory') : null;
  const projectFile = projectDir
    ? readLayerFile(path.join(projectDir, 'MEMORY.md'), '工作区长期记忆', 'project')
    : null;

  const dailyFiles = [];
  if (projectDir) {
    for (const entry of safeList(projectDir)) {
      if (entry.isDirectory()) continue;
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) continue;
      const full = path.join(projectDir, entry.name);
      const stat = safeStat(full);
      if (!stat) continue;
      dailyFiles.push({
        label: entry.name,
        layer: 'daily',
        path: displayPath(full),
        bytes: stat.size,
        chars: 0,
        present: true,
        mtime: stat.mtimeMs,
        text: null,
        ageDays: Math.floor((now - stat.mtimeMs) / 86400000),
      });
    }
    dailyFiles.sort((a, b) => String(b.label).localeCompare(String(a.label)));
  }

  // ---------- 2. 体积（常驻层是「每轮都付」的成本）----------
  const injected = [
    ...cloudFiles,
    ...(userFile.present ? [userFile] : []),
    ...(projectFile && projectFile.present ? [projectFile] : []),
  ];
  const injectedBytes = injected.reduce((sum, item) => sum + (item.bytes || 0), 0);
  const identityBytes = identityFiles.reduce((sum, item) => sum + (item.bytes || 0), 0);
  // 粗估口径：混合中英的常驻记忆，经验上 1 token ≈ 2 字符。**是粗估，别当精确值用。**
  const roughTokens = Math.round((injectedBytes + identityBytes) / 2 / 2);

  for (const item of cloudFiles) {
    const level = levelOf(item.bytes, THRESHOLDS.cloudProfileBytes);
    if (level === 'ok') continue;
    push(level, 'cloud:' + item.path, 'cloud',
      '云端档案偏大：' + item.label,
      `${item.bytes} bytes。这个文件**由服务端生成、每次会话开始注入**，且本地写会被下一次覆盖。`,
      '本地改不了 —— 要瘦身只能从「源头」下手：把项目细节从用户级记忆里挪走（服务端档案是它的产物），并从工作区记忆里删掉已经过期的结论。',
      '云端档案（' + item.path + '）有 ' + item.bytes + ' bytes，且它是用户级记忆的产物、本地改不了。请帮我把来源整理一遍：把项目专属事实从用户级记忆 `' + path.join(home, 'MEMORY.md') + '` 下沉到工作区记忆，让它下次生成时自然变小。先给方案，确认后再改。');
  }

  if (userFile.present) {
    const level = levelOf(userFile.chars, THRESHOLDS.userMemoryChars);
    if (level !== 'ok') {
      push(level, 'user:' + userFile.path, 'user',
        level === 'crit' ? '用户级记忆超出硬限额' : '用户级记忆接近硬限额',
        `${userFile.chars} 字符（系统提示写死 4,000 chars/session，warn ≥ ${THRESHOLDS.userMemoryChars.warn}）。` +
        '这是**跨项目常驻**文件，超限意味着后半段有被截掉的风险。',
        '只留「不看会做错」的跨项目硬约束（环境陷阱、通用红线）；项目专属结论下沉到工作区记忆。',
        '把 ' + userFile.path + ' 精简到 3000 字符以内：只保留跨项目的硬约束（沙箱限制、通用铁律、协作偏好），把项目专属的结论挪到对应工作区的 `.workbuddy/memory/MEMORY.md`。先给我精简方案与「哪几条要搬去哪」，确认后再动手。');
    }
  }

  if (projectFile && projectFile.present) {
    const level = levelOf(projectFile.chars, THRESHOLDS.projectMemoryChars);
    if (level !== 'ok') {
      push(level, 'project:' + projectFile.path, 'project',
        level === 'crit' ? '工作区记忆超出硬限额' : '工作区记忆接近硬限额',
        `${projectFile.chars} 字符（系统提示写死 3,000 chars/session，warn ≥ ${THRESHOLDS.projectMemoryChars.warn}）。`,
        '这是**本项目每轮都重发**的文件。按「红线判据 + 指针」重写：细节下沉到日档或 skill 的 references/。',
        '把 ' + projectFile.path + ' 重写成「红线判据 + 指针」式：只留不看会做错的判据与唯一路径，过程性细节下沉到工作区日档或 skill 的 references/，并保留一份「旧章节 → 新位置」的映射。先给方案，确认后再改。');
    }
  }

  const identityLevel = levelOf(identityBytes, THRESHOLDS.identityBytes);
  if (identityLevel !== 'ok') {
    push(identityLevel, 'identity', 'user',
      '身份文件合计偏大',
      `SOUL.md / IDENTITY.md / USER.md 合计 ${identityBytes} bytes，同样是**每次会话常驻**。`,
      '身份文件保持「一页纸」：画像、偏好、硬约束。长清单（工具用法、代码片段）挪进 skill。',
      '把 ' + path.join(home, 'SOUL.md') + ' / IDENTITY.md / USER.md 三份合计压到 4KB 以内：只留画像、协作偏好、跨项目硬约束；工具用法与代码片段挪进对应 skill。先给方案。');
  }

  // ---------- 3. 错层：项目细节写在跨项目层 ----------
  const homePrefix = path.join(home).replace(/\\/g, '/');
  const workspacePrefix = workspace ? path.join(workspace).replace(/\\/g, '/') : null;
  // ⚠️ 必须把「记忆系统自己的家」和「操作系统用户主目录」排掉，否则 `<home>/MEMORY.md` 里
  //    随便提一句 `C:/Users/<user>` 就会被判成「项目细节写进了跨项目层」（第一版的假阳性）。
  //    ⚠️ 前缀深度是「盘符 + 1 段目录」，所以这里必须写 `C:/Users` 而不是 `C:/Users/<user>`。
  const osHome = path.join(os.homedir()).replace(/\\/g, '/');
  const ignorePrefixes = [
    homePrefix,
    osHome,
    'C:/Users', 'C:/Windows', 'C:/Program',
    '/Users', '/home',
    '/tmp', '/var', '/usr', '/private', '/opt', '/Applications',
  ];

  if (userFile.present && userFile.text) {
    const prefixes = pathPrefixes(userFile.text, { ignorePrefixes });
    // 只报「出现 ≥2 次」的：单次引用多半只是举例，反复出现才是把项目细节当家住了
    const offenders = prefixes.filter((item) => item.count >= 2 && item.prefix.length > 5).slice(0, 3);
    if (offenders.length) {
      const list = offenders.map((item) => item.prefix + '（' + item.count + ' 次）').join('、');
      push('warn', 'misfit:user', 'user',
        '项目细节写进了跨项目层',
        `用户级记忆里反复出现这些具体项目目录：${list}。它们只对某一个工作区成立，` +
        '但会被注入到**所有项目**的会话里。',
        '把这几条搬到对应工作区的 `.workbuddy/memory/MEMORY.md`，用户级只留跨项目判据。',
        '用户级记忆 `' + userFile.path + '` 里反复出现这些项目目录：' + list + '。请逐条判断哪些是项目专属事实，把它们搬进对应工作区的 `.workbuddy/memory/MEMORY.md`（保留跨项目才成立的部分）。列出「要搬的条目 → 目标文件」，确认后再改。');
    }
  }

  // ---------- 4. 错层：记了别的项目的事 ----------
  if (projectFile && projectFile.present && projectFile.text && workspacePrefix) {
    const prefixes = pathPrefixes(projectFile.text, { ignorePrefixes });
    const foreign = prefixes
      .filter((item) => item.prefix.toLowerCase().indexOf(workspacePrefix.toLowerCase()) !== 0)
      .filter((item) => item.count >= 2)
      .slice(0, 3);
    if (foreign.length) {
      const list = foreign.map((item) => item.prefix + '（' + item.count + ' 次）').join('、');
      push('warn', 'misfit:project', 'project',
        '工作区记忆里记了别的项目',
        `工作区记忆里反复出现本工作区之外的目录：${list}。这些内容会随本项目每一轮重发，但只在另一个工作区成立。`,
        '搬到那个项目的 `.workbuddy/memory/MEMORY.md`；若确实与本项目有关联，就改成一行指针。',
        '工作区记忆 `' + projectFile.path + '` 里反复出现本工作区之外的目录：' + list + '。请把属于其他项目的条目搬过去，只在本项目留一行指针。列出「要搬的条目 → 目标文件」，确认后再改。');
    }
  }

  // ---------- 5. 残留副本 ----------
  const backupDirs = [];
  if (cloudDir) backupDirs.push({ dir: cloudDir, layer: 'cloud' });
  backupDirs.push({ dir: home, layer: 'user' });
  if (projectDir) backupDirs.push({ dir: projectDir, layer: 'project' });
  const backups = [];
  for (const item of backupDirs) {
    for (const backup of listBackups(item.dir)) {
      backups.push({ ...backup, layer: item.layer, dir: item.dir });
    }
  }
  if (backups.length) {
    const totalBytes = backups.reduce((sum, item) => sum + item.bytes, 0);
    const shown = backups.slice(0, 6).map((item) => item.name).join('、');
    push('warn', 'backups', backups[0].layer,
      '记忆目录里有 ' + backups.length + ' 个残留副本',
      `${shown}${backups.length > 6 ? ' 等' : ''}，合计 ${totalBytes} bytes。` +
      '它们**不占 token**（不在注入清单里），但会让「哪份是当前版本」变模糊 —— 改错文件是本项目踩过的坑。',
      '归拢到一个备份目录（只移动、不删除），或确认无误后自行删除。',
      '记忆目录下有这些残留副本：' + backups.map((item) => item.file).join('、') + '。请确认当前版本是哪一个（不要改错文件），然后把这批副本归拢到一个备份目录，我来决定是否删除。');
  }

  // ---------- 6. 日档：该蒸馏了吗 ----------
  const staleDailies = dailyFiles.filter((item) => item.ageDays >= THRESHOLDS.staleDailyDays);
  const fatDailies = dailyFiles.filter((item) => levelOf(item.bytes, THRESHOLDS.dailyLogBytes) !== 'ok');
  if (staleDailies.length) {
    const names = staleDailies.slice(0, 6).map((item) => item.label + '（' + item.ageDays + ' 天）').join('、');
    push('warn', 'daily:stale', 'daily',
      staleDailies.length + ' 份日档已过蒸馏期',
      `${names}。分层规则是「>30 天的日档蒸馏进工作区记忆后删除」—— 还没做。`,
      '按主题蒸馏进 `.workbuddy/memory/MEMORY.md`（只留判据与结论），再删掉过期日档。',
      '这些日档超过 30 天未蒸馏：' + names + '。请按主题把它们蒸馏进工作区 `.workbuddy/memory/MEMORY.md`（只保留仍然成立的判据与结论，过程细节丢弃），列出「日档 → 蒸馏进哪一节」，确认后我再删原文件。');
  }
  if (fatDailies.length) {
    const totalBytes = fatDailies.reduce((sum, item) => sum + item.bytes, 0);
    push('warn', 'daily:fat', 'daily',
      fatDailies.length + ' 份日档偏大',
      `合计 ${totalBytes} bytes，最大的是 ${fatDailies[0].label}（${fatDailies[0].bytes} bytes）。` +
      '日档**不进上下文**，但过期蒸馏时会一次读进整个文件；体积主要影响「读它的那一次」。',
      '保持「只记有用信息」：别把工具原始输出整段贴进日档。',
      '日档偏大（合计 ' + totalBytes + ' bytes，最大 ' + fatDailies[0].label + '）。请只处理仍在蒸馏窗口内的最近几份：删掉重复的过程性描述，保留判据与结论。先列出「要删的段落 → 理由」，确认后再改。');
  }

  // ---------- 7. 跨文件重复的条目 ----------
  const duplicates = [];
  if (projectFile && projectFile.present && projectFile.text) {
    const projectLines = new Map(factLines(projectFile.text).map((line) => [line, true]));
    const seenInProject = new Set();
    for (const line of factLines(projectFile.text)) {
      // 同一文件内部重复
      if (seenInProject.has(line)) duplicates.push({ text: line, where: '工作区记忆内部' });
      seenInProject.add(line);
    }
    if (userFile.present && userFile.text) {
      for (const line of factLines(userFile.text)) {
        if (projectLines.has(line)) duplicates.push({ text: line, where: '用户级 + 工作区' });
      }
    }
  }
  const duplicateList = duplicates.slice(0, THRESHOLDS.duplicateLineLimit);
  if (duplicateList.length) {
    push('warn', 'duplicate', 'project',
      '有 ' + duplicates.length + ' 条事实被重复记录',
      duplicateList.slice(0, 3).map((item) => '「' + item.text.slice(0, 40) + '…」（' + item.where + '）').join('；') +
      '。重复的条目会被**多付一次**上下文体量，且日后两处不同步。',
      '保留离作用域更近的那一份，另一份删掉或改成指针。',
      '记忆里有重复条目（' + duplicates.length + ' 条）。第 1 条示例：「' + (duplicateList[0] ? duplicateList[0].text.slice(0, 60) : '') + '」。请逐条判断保留哪一份（原则：保留作用域更近的那份），列出「删哪条 / 留在哪」，确认后再改。');
  }

  // ---------- 8. 失效路径引用 ----------
  if (checkPaths) {
    const dead = [];
    for (const item of [userFile, projectFile]) {
      if (!item || !item.present || !item.text) continue;
      for (const candidate of backtickPaths(item.text)) {
        if (dead.length >= THRESHOLDS.deadPointerLimit) break;
        if (fs.existsSync(candidate)) continue;
        dead.push({ file: item.path, target: candidate, layer: item.layer });
      }
    }
    if (dead.length) {
      push('warn', 'dead-pointer', dead[0].layer,
        '有 ' + dead.length + ' 处路径引用已失效',
        dead.slice(0, 3).map((item) => '`' + item.target + '`').join('、') + ' 已不存在（记忆里写着它还在）。',
        '改成现有路径，或把这行删掉 —— 留着会让下个会话照着一个不存在的路径干活。',
        '记忆里有失效路径引用：' + dead.map((item) => item.target + '（见 ' + item.file + '）').join('、') + '。请确认是否已改名/移动，把引用改成现在正确的路径；确认不存在的就删掉那一行。先列方案再改。');
    }
  }

  // ---------- 9. 汇总 ----------
  const order = { crit: 0, warn: 1, ok: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    ok: true,
    generatedAt: now,
    home,
    workspace,
    layers: {
      cloud: { files: cloudFiles, bytes: cloudFiles.reduce((sum, item) => sum + item.bytes, 0), locked: true },
      // ⚠️ identity 必须**单独一层**：第一版把身份三件套并进 `user.bytes`，
      //    于是「各层之和 == injected.totalBytes」这条恒等式被破了（身份被算了两次，回归 F6 抓出来的）。
      user: { files: userFile.present ? [userFile] : [], bytes: userFile.present ? userFile.bytes : 0 },
      identity: { files: identityFiles, bytes: identityBytes },
      project: { files: projectFile && projectFile.present ? [projectFile] : [], bytes: projectFile && projectFile.present ? projectFile.bytes : 0 },
      daily: { files: dailyFiles, bytes: dailyFiles.reduce((sum, item) => sum + item.bytes, 0) },
    },
    injected: {
      bytes: injectedBytes,
      identityBytes,
      totalBytes: injectedBytes + identityBytes,
      roughTokens,
      note: '常驻注入体积 —— 每个新会话都会先付一次，之后每轮随历史重发。',
      count: injected.length + identityFiles.length,
    },
    backups,
    findings,
    counts: {
      crit: findings.filter((item) => item.severity === 'crit').length,
      warn: findings.filter((item) => item.severity === 'warn').length,
      // 本模块**不产** auto 修复，这个字段恒为 0 —— 钉住「只提醒不自动改写」。
      autoFixable: 0,
    },
  };
}

/**
 * 把巡检结果拼成一段可直接读/可粘的 markdown（**纯函数**，不写盘不发网络）。
 * 用途：定期任务的提醒正文 —— 让「提醒」不依赖任何界面。
 */
function formatMemoryGovernance(report) {
  const r = report || {};
  const injected = r.injected || {};
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const out = [];
  out.push('# 记忆治理巡检（自动生成）', '');
  out.push('> 生成时间：' + new Date(r.generatedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19));
  out.push('> 本巡检**只提醒、不自动改写**。每条问题都附了可复制的指令。', '');
  out.push('## 一、常驻成本');
  out.push('');
  out.push('- 常驻注入合计：**' + Math.round((injected.totalBytes || 0) / 1024 * 10) / 10 + ' KB**'
    + '（粗估 ' + (injected.roughTokens || 0) + ' token / 会话，混合中英按 1 token ≈ 2 字符折算）');
  const kb = (bytes) => Math.round((Number(bytes) || 0) / 1024 * 10) / 10 + ' KB';
  out.push('- 其中：云端档案 ' + kb(r.layers && r.layers.cloud && r.layers.cloud.bytes)
    + ' / 用户级 ' + kb(r.layers && r.layers.user && r.layers.user.bytes)
    + ' / 工作区 ' + kb(r.layers && r.layers.project && r.layers.project.bytes)
    + ' / 身份 ' + kb(r.layers && r.layers.identity && r.layers.identity.bytes));
  out.push('- 这些体量**每轮都会随历史重发一次**，实际开销 ≈ 常驻体积 × 轮次。');
  out.push('');
  out.push('## 二、发现（' + findings.length + ' 条：严重 ' + ((r.counts && r.counts.crit) || 0)
    + ' / 警告 ' + ((r.counts && r.counts.warn) || 0) + '）');
  out.push('');
  if (!findings.length) out.push('- 无。分层清晰、体积达标。');
  for (const item of findings.slice(0, 10)) {
    out.push('- **[' + (item.severity === 'crit' ? '严重' : '警告') + '] ' + item.title + '**');
    if (item.detail) out.push('  - 现状：' + item.detail);
    if (item.action) out.push('  - 建议：' + item.action);
  }
  out.push('');
  out.push('## 三、下一步');
  out.push('');
  out.push('把上面任意一条的「现状」发给我，我按它的建议先出方案、你确认后再改 —— 记忆不会被自动改写。');
  out.push('');
  return out.join('\n');
}

module.exports = {
  auditMemoryGovernance,
  formatMemoryGovernance,
  pathPrefixes,
  backtickPaths,
  factLines,
  listBackups,
  levelOf,
  THRESHOLDS,
  LAYERS,
};

// CLI：`node scripts/memory-governance.js [--json] [--workspace <dir>]`
// 定期任务（automation）直接调它，不依赖 daemon 是否在跑。
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? (argv[index + 1] || '') : '';
  };
  const asJson = argv.includes('--json');
  const report = auditMemoryGovernance({
    workspace: flag('--workspace') || process.cwd(),
    home: flag('--home') || undefined,
  });
  process.stdout.write(asJson ? JSON.stringify(report, null, 2) : formatMemoryGovernance(report));
  process.stdout.write('\n');
}
