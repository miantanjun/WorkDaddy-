'use strict';
/*
 * copy-manifest.js —— 「空间占用扫描」与「会话自动复制排队」之间的桥。
 *
 * 解决的问题
 * ----------
 * 自动复制在真正开跑前要给计划里的每条会话排序（小的先跑、巨型排最后，避免一条 400MB
 * 的会话把串行队列堵在队首十几分钟）。排到哪一位取决于**体积与文件数**，而这两个数字
 * 原来是靠 `sessionContentSize()` 现场遍历整棵目录树拿的：
 *   · 单账号 24~29 条会话 ≈ 300ms（本机实测，SSD、2.2GB 数据）
 *   · 全部走同步 IO（lstatSync/readdirSync），这 300ms 里 daemon 的事件循环是**卡住**的
 *   · 会话数线性增长：几百条以后就是几秒级
 * 而同样的数字空间扫描**已经算过一遍**，只是没被复制这边用上。
 *
 * 做法
 * ----
 * 扫描完成后把结果派生成一份「简洁清单」（只有排序需要的字段 + 让人看得懂的标题），
 * 之后排序优先查清单；查不到、或者那个会话在扫描之后又被写过，才回落到现场测量。
 * 现场测出来的结果会被回写进清单，于是**第二次复制起就能命中**。
 *
 * 三条硬约束（都来自实测，别绕过）
 * --------------------------------
 * 1) 只信「扫描完成」的结果。扫描被用户中断时 `cancelled=true`，那份数字是半截的
 *    （漏掉的目录按 0 计），拿它排序会把巨型会话误判成小会话 → 反而堵队首。
 *    `complete=false` 的清单**不覆盖**已有的完整清单。
 * 2) 清单的数字会过期。判据不是「时间过了多久」而是「那个会话自扫描后有没有被写过」——
 *    每条清单项记下当时的 `mtimeAt`（产物目录 + 正文 jsonl 的 mtime 最大值），
 *    用的时候重新 stat 一遍这 2 个路径对比（本机实测：单账号 3~4ms，比全树遍历便宜两个数量级）。
 *    另外还有 `freshMs` 兜底，防止长期不刷新。
 * 3) 产物口径与总量口径是**两个数**，不能混。复制关心的是「要搬多少活」= 产物目录
 *    （payload*）；侧栏里显示的「实际占用」是全量（bytes）。清单两个都存。
 *    扫描器版本 < 4 时拿不到产物拆分，此时降级用全量并在条目上标 `payloadSplit=false`，
 *    排序仍成立（只是精度差一点），绝不假装有数据。
 *
 * 本模块不依赖 daemon.js（daemon 会起 HTTP 服务，不能 require），可单独跑测试。
 * 跑法：node .wd-analysis/test-copy-manifest.js
 */

const fs = require('fs');
const path = require('path');

const { replaceFileWithRetry } = require('./atomic-file-write.js');
const { spaceSlug } = require('./space-scan.js');

// 清单结构版本。改字段/改语义就 +1，旧清单会被当不存在（重新派生，不报错）。
const MANIFEST_VERSION = 1;
const MANIFEST_FILE = 'copy-manifest.json';

// 兜底时效：即使 mtime 探测说「没变」，超过这个时长也不再信。
// 取 24h 是因为排序只依赖**档位**（见 tierOf），档位跨档要体积/文件数变化 8 倍以上，
// 已完成的会话不会隔夜自己涨 8 倍；真正会因为隔夜变化的，mtime 探测那一关就拦住了。
const DEFAULT_FRESH_MS = 24 * 60 * 60 * 1000;

// 分档阈值。排序主键 = max(体积档, 文件档)：
//   · 体积档按**产物**（payloadBytes）算 —— 正文 jsonl 与索引通常只有几十 KB，
//     混进总量会把「产物巨大的会话」稀释掉
//   · 文件档按**产物文件数**算 —— 这是原实现（只按体积升序）的真实盲点：
//     一个 2MB / 80000 文件的会话字节很小，会被排到队首，但它要跑 8 万次文件操作，
//     照样能把队列堵住十几分钟。实机注释里记过「单条会话产物可达 32 万文件」。
// 阈值取自本机真实扫描数据（77 条会话）：体积 p75=5MB / p90=53MB / max=436MB；
// 文件数 p75=196 / p90=1709 / max=4119。取 8MB / 64MB / 512MB 与 500 / 5000 / 50000，
// 保证「绝大多数普通会话落在 0 档」（不被无谓地重排），只有明显异常大的才升档。
const BYTE_TIERS = [8 * 1024 * 1024, 64 * 1024 * 1024, 512 * 1024 * 1024];
const FILE_TIERS = [500, 5000, 50000];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function entryKey(uid, id) {
  return String(uid || '') + '\u0000' + String(id || '');
}

function manifestPath(dataDir) {
  return path.join(String(dataDir || ''), MANIFEST_FILE);
}

/** 单个路径的 mtime（毫秒）。不存在 / 读不到一律 0 —— 0 是一个合法的「当时也没有」记号。 */
function statMtime(target) {
  try {
    const st = fs.statSync(target);
    return num(st.mtimeMs) || num(st.mtime);
  } catch (_) {
    return 0;
  }
}

/**
 * 一条会话的「变化指纹」：产物目录 + 正文 jsonl 的 mtime 最大值。
 *
 * 只探这 2 个路径是刻意的：
 *   · 产物目录（workspace/sessions/<id>/）是体积与文件数的绝对大头，也是复制里真正慢的地方；
 *   · 正文 jsonl 在 projects/<slug>/<id>.jsonl，slug 由清单里存的 cwd 反算（`spaceSlug`），
 *     **不需要 readdir 整个 projects/** —— 实测量过：每会话一次 readdir 会让这一步从 14ms
 *     涨到 186ms，纯粹白花。
 * 这是近似判据：深层子目录里新增文件不一定刷新顶层目录的 mtime。但排序只依赖档位，
 * 且失败方向是「以为没变 → 用旧数字」，最多让一条会话的档位偏一档，不会算错数据。
 */
function probeMtime(wbHome, entry) {
  const home = String(wbHome || '');
  if (!home) return 0;
  const id = String((entry && entry.id) || '');
  if (!id) return 0;
  let max = statMtime(path.join(home, 'workspace', 'sessions', id));
  const slug = spaceSlug((entry && entry.cwd) || '');
  if (slug) max = Math.max(max, statMtime(path.join(home, 'projects', slug, id + '.jsonl')));
  return max;
}

/** 扫描结果 → 简洁清单。纯派生，不产生任何额外遍历（mtime 探测除外，见 probeMtime）。 */
function buildManifest(scanResult, options = {}) {
  const src = scanResult && typeof scanResult === 'object' ? scanResult : {};
  const scannedAt = num(src.finishedAt) || Date.now();
  const root = String(src.root || options.wbHome || '');
  // v4 起才有产物拆分。拿不到就降级用全量，并在条目上如实标记，排序侧据此知道精度。
  const payloadSplit = num(src.version) >= 4;

  const entries = (Array.isArray(src.sessions) ? src.sessions : [])
    .map((row) => {
      const item = {
        id: String((row && row.id) || ''),
        uid: String((row && row.uid) || ''),
        title: String((row && row.title) || ''),
        cwd: String((row && row.cwd) || ''),
        bytes: num(row && row.bytes),
        rawBytes: num(row && row.rawBytes),
        files: num(row && row.files),
        payloadBytes: payloadSplit ? num(row && row.payloadBytes) : num(row && row.bytes),
        payloadRawBytes: payloadSplit ? num(row && row.payloadRawBytes) : num(row && row.rawBytes),
        payloadFiles: payloadSplit ? num(row && row.payloadFiles) : num(row && row.files),
        payloadSplit,
        measuredAt: scannedAt,
        mtimeAt: 0,
      };
      return item;
    })
    .filter((item) => item.id);

  // 人读层：按「任务对话」聚合（与侧栏显示的分组一致），便于直接打开清单文件核对。
  const conversations = (Array.isArray(src.conversations) ? src.conversations : []).map((c) => ({
    title: String((c && c.title) || '(未命名对话)'),
    cwd: String((c && c.cwd) || ''),
    sessions: num(c && c.sessions),
    bytes: num(c && c.bytes),
    files: num(c && c.files),
    payloadBytes: payloadSplit ? num(c && c.payloadBytes) : num(c && c.bytes),
    payloadFiles: payloadSplit ? num(c && c.payloadFiles) : num(c && c.files),
  }));

  if (root && options.probe !== false) {
    for (const item of entries) item.mtimeAt = probeMtime(root, item);
  }

  return {
    version: MANIFEST_VERSION,
    scanVersion: num(src.version),
    payloadSplit,
    root,
    scannedAt,
    mergedAt: scannedAt,
    // 中断的扫描不算「完整」。读取侧据此拒绝让它覆盖完整清单。
    complete: src.cancelled !== true,
    entries,
    conversations,
  };
}

/** 读清单。结构版本不符 / 文件坏了 → null（当没有，回落现场测量，不报错）。 */
function readManifest(dataDir, options = {}) {
  try {
    const file = manifestPath(dataDir);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.version !== MANIFEST_VERSION || !Array.isArray(raw.entries)) return null;
    if (options.requireComplete && raw.complete === false) return null;
    return raw;
  } catch (_) {
    return null;
  }
}

/**
 * 从扫描结果派生并落盘清单。
 * 中断（complete=false）时**不覆盖**已有的完整清单 —— 半截的数字比旧数字更危险。
 * @returns {{manifest:object|null, written:boolean, reason:string}}
 */
function writeManifest(dataDir, scanResult, options = {}) {
  const manifest = buildManifest(scanResult, options);
  if (!manifest.complete) {
    return { manifest: null, written: false, reason: '扫描被中断，保留原清单' };
  }
  const previous = readManifest(dataDir);
  if (previous && num(previous.scannedAt) > manifest.scannedAt && options.force !== true) {
    // 并发场景兜底：晚完成的旧扫描不覆盖早完成的新扫描。
    return { manifest: previous, written: false, reason: '已有更新的清单，跳过' };
  }
  replaceFileWithRetry(manifestPath(dataDir), JSON.stringify(manifest));
  return { manifest, written: true, reason: 'ok' };
}

/** uid + 会话 id → 清单项索引。 */
function indexManifest(manifest) {
  const index = new Map();
  for (const item of ((manifest && manifest.entries) || [])) {
    if (item && item.id) index.set(entryKey(item.uid, item.id), item);
  }
  return index;
}

function lookupEntry(index, uid, id) {
  if (!index || !id) return null;
  return index.get(entryKey(uid, id)) || null;
}

/**
 * 清单项现在还能不能信。
 *   · 必须有 measuredAt，且不能比 freshMs 更老
 *   · 会话自那次测量后没被写过（mtime 指纹一致）—— 探测成本 ~0.1ms/条
 * wbHome 为空或条目没有指纹时跳过探测，只受 freshMs 约束。
 */
function isEntryTrusted(entry, wbHome, now, options = {}) {
  if (!entry) return false;
  const measuredAt = num(entry.measuredAt);
  if (!measuredAt) return false;
  const freshMs = Number.isFinite(options.freshMs) ? options.freshMs : DEFAULT_FRESH_MS;
  const age = now - measuredAt;
  if (age < 0 || age > freshMs) return false;
  if (options.probe === false) return true;
  if (!wbHome || !num(entry.mtimeAt)) return true;
  return probeMtime(wbHome, entry) === num(entry.mtimeAt);
}

/**
 * 排序档位。0 = 轻，3 = 重中之重的尾巴。
 * 取「体积档」与「文件档」的较大值：两者任一超标都要往后排。
 */
function tierOf(entry) {
  const source = entry || {};
  const bytes = num(source.payloadBytes) || num(source.bytes);
  const files = num(source.payloadFiles) || num(source.files);
  let byteTier = 0;
  while (byteTier < BYTE_TIERS.length && bytes >= BYTE_TIERS[byteTier]) byteTier += 1;
  let fileTier = 0;
  while (fileTier < FILE_TIERS.length && files >= FILE_TIERS[fileTier]) fileTier += 1;
  return Math.max(byteTier, fileTier);
}

/**
 * 按「先分档、档内仍体积升序」给复制计划排序。
 *
 * 与旧实现（严格按体积升序）的关系：档内行为不变，只在**跨档**时才可能换位。
 * 唯一被有意改变的是「文件数多但字节小」那一类 —— 它们在旧序里会排到队首堵住队列。
 *
 * @param {Array} plan   buildAutoCopyPlan 的结果（每行至少要有 id）
 * @param {object} options
 *   uid      {string}   源账号 uid（清单按 uid + id 索引，跨账号副本不能互相顶）
 *   index    {Map}      indexManifest() 的结果
 *   wbHome   {string}   数据根目录，用于 mtime 探测与现场测量
 *   measure  {function} (wbHome, id) => {bytes, files, workspaceBytes, workspaceFiles}
 *   now      {number}   当前时间（测试注入假时钟用）
 *   freshMs  {number}   兜底时效
 *   probe    {boolean}  是否做 mtime 探测（默认做）
 * @returns {{plan:Array, tiers:object, stats:object, measured:Array}}
 *   plan     排好序的行（原行对象上补齐 sizeBytes/workspaceBytes/payloadFiles/tier/sizeSource）
 *   measured 本次现场测出来的条目（供回写清单，形如 measures 参数）
 *   tiers    各档条数，用于日志
 *   stats    {fromList, fromMeasure, listSplit}
 */
function sortPlan(plan, options = {}) {
  const list = Array.isArray(plan) ? plan : [];
  const index = options.index || null;
  const wbHome = String(options.wbHome || '');
  const uid = String(options.uid || '');
  const now = num(options.now) || Date.now();
  const measure = typeof options.measure === 'function' ? options.measure : null;
  const measured = [];
  const tiers = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let fromList = 0;
  let fromMeasure = 0;
  let listSplit = 0;

  const rows = list.map((row, position) => {
    const id = String((row && row.id) || '');
    const out = { id, position, tier: 0, sizeSource: 'measure' };
    const hit = lookupEntry(index, uid, id);
    if (hit && isEntryTrusted(hit, wbHome, now, options)) {
      out.bytes = num(hit.bytes);
      out.files = num(hit.files);
      out.workspaceBytes = num(hit.payloadBytes);
      out.workspaceFiles = num(hit.payloadFiles);
      out.sizeSource = hit.payloadSplit === false ? 'manifest-no-payload' : 'manifest';
      if (hit.payloadSplit !== false) listSplit += 1;
      fromList += 1;
    } else if (measure) {
      const stats = measure(wbHome, id) || {};
      out.bytes = num(stats.bytes);
      out.files = num(stats.files);
      out.workspaceBytes = num(stats.workspaceBytes);
      out.workspaceFiles = num(stats.workspaceFiles);
      out.sizeSource = 'measure';
      fromMeasure += 1;
      measured.push({
        id,
        bytes: out.bytes,
        files: out.files,
        payloadBytes: out.workspaceBytes,
        payloadFiles: out.workspaceFiles,
        payloadSplit: true,
        mtimeAt: probeMtime(wbHome, { id, cwd: (row && row.cwd) || '' }),
        measuredAt: now,
      });
    } else if (hit) {
      // 没有 measure 回调、清单又不可信：退到「清单值但明确标记不可信」，
      // 比直接给 0 强 —— 0 会让它被误排到队首。
      out.bytes = num(hit.bytes);
      out.files = num(hit.files);
      out.workspaceBytes = num(hit.payloadBytes);
      out.workspaceFiles = num(hit.payloadFiles);
      out.sizeSource = 'manifest-stale';
    }
    out.tier = tierOf(out);
    return out;
  });

  for (const row of rows) tiers[row.tier] = (tiers[row.tier] || 0) + 1;

  rows.sort((a, b) =>
    (a.tier - b.tier) ||
    (a.workspaceBytes - b.workspaceBytes) ||
    (a.workspaceFiles - b.workspaceFiles) ||
    (a.bytes - b.bytes) ||
    (a.position - b.position));

  const ordered = rows.map((row) => {
    const source = list[row.position] || {};
    return Object.assign({}, source, {
      sizeBytes: row.bytes,
      sizeFiles: row.files,
      workspaceBytes: row.workspaceBytes,
      workspaceFiles: row.workspaceFiles,
      sizeTier: row.tier,
      sizeSource: row.sizeSource,
    });
  });

  return {
    plan: ordered,
    measured,
    tiers,
    stats: { fromList, fromMeasure, listSplit, total: list.length },
  };
}

/**
 * 把本次现场测到的条目并回清单并落盘。
 * 合并语义：只覆盖同 (uid, id) 的项，其它项原样保留 —— 于是清单会随每次复制自我保鲜。
 * 如果原本没有清单，则以一个空骨架起步（不报错；下次空间扫描会写进完整版）。
 * @returns {{manifest:object|null, written:boolean, reason:string, added:number}}
 */
function mergeMeasured(dataDir, uid, measured, options = {}) {
  const rows = Array.isArray(measured) ? measured : [];
  if (!rows.length) return { manifest: readManifest(dataDir), written: false, reason: 'no-entries', added: 0 };
  const base = readManifest(dataDir);
  const map = new Map();
  if (base) for (const item of base.entries) if (item && item.id) map.set(entryKey(item.uid, item.id), item);
  const now = num(options.now) || Date.now();
  let added = 0;
  for (const row of rows) {
    if (!row || !row.id) continue;
    const key = entryKey(uid, row.id);
    const prev = map.get(key) || {};
    map.set(key, {
      id: String(row.id),
      uid: String(uid),
      title: String(prev.title || ''),
      cwd: String(prev.cwd || row.cwd || ''),
      bytes: num(row.bytes),
      rawBytes: num(row.bytes),
      files: num(row.files),
      payloadBytes: num(row.payloadBytes),
      payloadRawBytes: num(row.payloadBytes),
      payloadFiles: num(row.payloadFiles),
      payloadSplit: true,
      measuredAt: num(row.measuredAt) || now,
      mtimeAt: num(row.mtimeAt),
    });
    added += 1;
  }
  const manifest = {
    version: MANIFEST_VERSION,
    scanVersion: base ? num(base.scanVersion) : 0,
    payloadSplit: true,
    root: String((base && base.root) || options.wbHome || ''),
    // scannedAt 保留原值（它标记「上一次完整扫描」），合并时间另记，别把两者混成一个。
    scannedAt: base ? num(base.scannedAt) : 0,
    mergedAt: now,
    complete: base ? base.complete !== false : false,
    entries: Array.from(map.values()),
    conversations: (base && Array.isArray(base.conversations)) ? base.conversations : [],
  };
  try {
    replaceFileWithRetry(manifestPath(dataDir), JSON.stringify(manifest));
  } catch (error) {
    return { manifest: base, written: false, reason: (error && error.message) || String(error), added: 0 };
  }
  return { manifest, written: true, reason: 'ok', added };
}

/** 清单的一句话摘要，用于日志。 */
function describeManifest(manifest) {
  if (!manifest) return '清单: 无';
  const heavy = (manifest.entries || []).filter((e) => tierOf(e) >= 2).length;
  return '清单: ' + (manifest.entries || []).length + ' 条（高负载档 ' + heavy + ' 条）'
    + ' 扫描于 ' + new Date(num(manifest.scannedAt) || 0).toISOString()
    + (manifest.payloadSplit ? '' : ' [无产物拆分]');
}

module.exports = {
  MANIFEST_VERSION,
  MANIFEST_FILE,
  DEFAULT_FRESH_MS,
  BYTE_TIERS,
  FILE_TIERS,
  manifestPath,
  probeMtime,
  buildManifest,
  readManifest,
  writeManifest,
  indexManifest,
  lookupEntry,
  isEntryTrusted,
  tierOf,
  sortPlan,
  mergeMeasured,
  describeManifest,
};
