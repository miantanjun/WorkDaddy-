'use strict';
/*
 * test-session-sync-cache-a3.js —— 上游 1.2.5 邻接吸纳 / A3（**文件级**指纹缓存）的落地守卫。
 *
 * 被守的东西：
 *   sessionSync.readSnapshot 的第 5 参 `cache`（relative path → {size,mtimeMs,ctimeMs,hash,
 *   semantic,aliases,records}）。它与 auto-copy-judge 的**快照级 memo** 是两层不同粒度的缓存：
 *     memo 命中   → 0 次读盘（整份快照复用）
 *     memo 未命中 + A3 命中 → 只重读真正变化的那几个文件
 *   守它必须证明三件事，缺一件这套 A3 就是「加了但没用」或「加了但会读错」：
 *     ① 真的省 io —— 用 readFileSync 计数证明，不是靠文本匹配；
 *     ② 真的不改结论 —— 带缓存与不带缓存读出的快照判定必须等价；
 *     ③ 真的会失效 —— 同长度改写（size 不变）也要靠 mtime/ctime 失效，否则等于读旧内容。
 *
 * ⚠️ 本套件在 os.tmpdir() 沙箱里跑，不碰真机数据；对 daemon 只做静态切片守卫（daemon.js
 *    会起服务，不能被 require）。
 * 跑法：node .wd-analysis/test-session-sync-cache-a3.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const sessionSync = require(path.join(ROOT, 'scripts', 'session-sync.js'));
const judge = require(path.join(ROOT, 'scripts', 'auto-copy-judge.js'));
const leader = require(path.join(ROOT, 'scripts', 'auto-copy-leader.js'));

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

/* ---------------- readFileSync 计数闸门 ---------------- */
// session-sync.js 是 `const fs = require('node:fs')`，调用点走**属性访问**，
// 所以在这里替换 fs.readFileSync 就能真的拦到它的读盘。
const realReadFileSync = fs.readFileSync;
let readPaths = [];
fs.readFileSync = function counted(target) {
  const resolved = typeof target === 'string' ? path.resolve(target) : '';
  if (resolved) readPaths.push(resolved);
  return realReadFileSync.apply(this, arguments);
};
function takeReads(sandboxRoot) {
  const hits = readPaths.filter((p) => p.indexOf(path.resolve(sandboxRoot)) === 0);
  readPaths = [];
  return hits;
}

/* ==================================================================== */
section('[A] session-sync.readSnapshot 第 5 参：文件级指纹缓存的语义');
/* ==================================================================== */

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-a3-sbx-'));
const PROJ = path.join(SANDBOX, 'projects', 'p-one');
fs.mkdirSync(PROJ, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'artifact-index'), { recursive: true });

const IDS = ['S', 'T'];
const body = (tag) => ['message', 'message'].map((t, i) => JSON.stringify({ type: t, uuid: tag + '-' + i, text: tag + '-' + i })).join('\n') + '\n';
function write(id, text) { fs.writeFileSync(path.join(PROJ, id + '.jsonl'), text || body('SAME')); }
write('S'); write('T');
// 附属文件：tasks/ 不在排除域内，应当进缓存；workspace/sessions/ 在排除域内，不该进缓存。
for (const id of ['S', 'T']) {
  fs.mkdirSync(path.join(SANDBOX, 'tasks', id), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'tasks', id, 'job.json'), '{"k":1}');
  const wsDir = path.join(SANDBOX, 'workspace', 'sessions', id);
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'payload.bin'), 'AAA');
}
const SKIP = { skipPrefixes: ['workspace/sessions'] };

takeReads(SANDBOX);
const cacheA = new Map();
const snapCold = sessionSync.readSnapshot(SANDBOX, 'S', IDS, SKIP, cacheA);
const coldReads = takeReads(SANDBOX);

ok(cacheA.size > 0, 'A1 冷读后缓存被填充', cacheA.size);
// ⚠️ 缓存键是**物理相对路径**（`entry.relative`），不是快照里的逻辑键 `projects/<p>/__session__.jsonl`。
//    键必须是物理路径 —— 决定失效的是这个文件自己的 size/mtime/ctime。
const tKey = 'projects/p-one/S.jsonl';
const tEntry = cacheA.get(tKey);
ok(!!tEntry && typeof tEntry.hash === 'string' && tEntry.hash
  && Number.isFinite(tEntry.size) && Number.isFinite(tEntry.mtimeMs) && Number.isFinite(tEntry.ctimeMs)
  && Array.isArray(tEntry.records) && typeof tEntry.semantic === 'string',
  'A2 缓存条目字段齐全（hash/size/mtimeMs/ctimeMs/semantic/records）—— 缺 records 就等于还要重读正文',
  tEntry && Object.keys(tEntry));
ok(coldReads.length > 0, 'A3 冷读确实真读了盘（对照组，证明下面不是空动作）', coldReads.length);

const snapWarm = sessionSync.readSnapshot(SANDBOX, 'S', IDS, SKIP, cacheA);
const warmReads = takeReads(SANDBOX);
ok(warmReads.length === 0, 'A4 命中缓存再读：**零 readFileSync**（真的省了 io 与 sha256）', warmReads.length);

const direct = sessionSync.readSnapshot(SANDBOX, 'S', IDS, SKIP, null);
ok(sessionSync.compareSnapshots(snapWarm, direct).kind === 'equal',
  'A5 带缓存读出的快照与逐字节直读的快照判定等价（缓存不改变结论）');
ok(snapWarm.totalBytes === snapCold.totalBytes,
  'A6 totalBytes 在缓存命中路径上仍然正确（走的是 stat.size，不是缓存里的可疑字段）',
  { warm: snapWarm.totalBytes, cold: snapCold.totalBytes });

// 同长度改写正文：size 不变，必须靠 mtime/ctime 失效 —— 否则 A3 变成了「读旧内容」。
const hashBefore = cacheA.get(tKey).hash;
(async function () {
  await new Promise((r) => setTimeout(r, 20));
  write('S', body('SAME').replace(/SAME-0/g, 'DIFF-0'));
  takeReads(SANDBOX);
  const snapChanged = sessionSync.readSnapshot(SANDBOX, 'S', IDS, SKIP, cacheA);
  const afterReads = takeReads(SANDBOX);
  const hashAfter = cacheA.get(tKey).hash;
  ok(afterReads.length === 1, 'A7 同长度改写后**只有正文那一个文件**被重读（其余仍命中缓存）', afterReads.length);
  ok(hashAfter !== hashBefore, 'A8 改写后缓存里的 hash 已更新（不是把旧 hash 又写回去）');
  ok(sessionSync.compareSnapshots(snapChanged, direct).kind !== 'equal',
    'A9 改写后的快照与改写前判定不等价（失效真的生效，没在读旧内容）');
  write('S');

  ok(![...cacheA.keys()].some((k) => k.indexOf('workspace/sessions') === 0),
    'A10 被 skipPrefixes 排除的 workspace 产物**没有进缓存**（A3 不污染排除域）',
    [...cacheA.keys()].filter((k) => k.indexOf('workspace') === 0));
  ok([...cacheA.keys()].some((k) => k.indexOf('tasks/') === 0),
    'A11 未排除的 tasks/ 附属文件进了缓存（不是「什么都没缓存」）');

  /* ==================================================================== */
  section('[B] judge / leader 的第 4 参透传（A3 从 daemon 走到 readSnapshot 的链路）');
  /* ==================================================================== */

  const cacheB = new Map();
  judge.clearJudgeCache();
  takeReads(SANDBOX);
  judge.readJudgedSnapshot(SANDBOX, 'T', IDS, cacheB);
  ok(cacheB.size > 0, 'B1 readJudgedSnapshot(root,id,aliases,fileCache) 把条目写进**传入的**缓存', cacheB.size);
  ok(takeReads(SANDBOX).length > 0, 'B2 判读路径确实经过 readSnapshot（不是绕过它自己算）');

  const cacheC = new Map();
  judge.clearJudgeCache();
  takeReads(SANDBOX);
  const writable = judge.readWritableSnapshot(SANDBOX, 'T', IDS, cacheC);
  ok(cacheC.size > 0 && [...writable.files.values()].every((f) => Buffer.isBuffer(f.bytes)),
    'B3 readWritableSnapshot(root,id,aliases,fileCache) 同样透传，且仍含原始字节（护栏不破）');

  // 向后兼容：省略第 4 参（既有 3 参调用形态）必须照旧工作，且**不留全局状态**。
  const cacheDSizeBefore = cacheC.size;
  judge.clearJudgeCache();
  const legacy = judge.readJudgedSnapshot(SANDBOX, 'T', IDS);
  ok(legacy && legacy.slim === true && cacheDSizeBefore === cacheC.size,
    'B4 省略第 4 参时照旧工作（旧调用形态兼容），且不写任何外部缓存');

  const cacheE = new Map();
  judge.clearJudgeCache();
  const result = leader.resolveContentLeader(SANDBOX, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }],
    { aliases: IDS, cache: cacheE });
  ok(cacheE.size > 0, 'B5 resolveContentLeader 的 options.cache 一路透传到 readSnapshot', cacheE.size);
  ok(!!result && typeof result.kind === 'string', 'B6 判主结论形状不变（透传不扰动定源语义）', result && result.kind);

  const cacheF = new Map();
  judge.clearJudgeCache();
  leader.resolveContentLeader(SANDBOX, [{ uid: 'u1', id: 'S' }, { uid: 'u2', id: 'T' }], { aliases: IDS });
  ok(cacheF.size === 0, 'B7 不传 cache 时零填充（默认路径逐行未变）');

  /* ==================================================================== */
  section('[C] daemon 接线静态守卫（防「改回去也不知道」）');
  /* ==================================================================== */

  const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const has = (needle) => daemonSrc.includes(needle);
  const at = (needle) => daemonSrc.indexOf(needle);

  ok(has('const SESSION_SYNC_CACHE_LIMIT = 100000;'),
    'C1 上限 100000（必须装得下磁盘上全部会话文件，否则活跃会话互相淘汰、缓存永远热不起来）');
  ok(has('function getSessionSyncCache() {') && has('function scheduleSessionSyncCacheSave() {'),
    'C2 getSessionSyncCache / scheduleSessionSyncCacheSave 都在 daemon 侧（缓存由 daemon 持有）');
  ok(has("path.join(DATA_DIR, 'session-sync-cache.json')") && has('atomicWriteText(state.file,'),
    'C3 落盘位置 DATA_DIR/session-sync-cache.json 且走 atomicWriteText（原子写，不是裸 writeFileSync）');
  ok(has("if (typeof state.timer.unref === 'function') state.timer.unref();"),
    'C4 落盘 timer 已 unref（缓存是尽力而为的，不许拖住 daemon 退出）');

  const callCount = (daemonSrc.match(/getSessionSyncCache\(\)/g) || []).length;
  ok(callCount === 4,
    'C5 getSessionSyncCache() 恰好 4 处（1 处定义 + 3 处调用）—— 多一处就是有别的路径偷偷开了缓存', callCount);

  // 三处调用必须都落在 content 分支**之前**（mtime 分支的注释就是分界线）：
  // 默认 judge='mtime' 时一行都不该经过 A3，否则「默认行为零变化」不成立。
  // ⚠️ 必须把**定义本身**（`function getSessionSyncCache()`）排除掉 —— 定义在 L7301，
  //    位于 content 分支之后，不排除的话这条断言永远红。
  const mtimeBranch = at('// ⚠️ 本分支（mtime 路径）刻意');
  const callIndexes = [];
  for (let i = daemonSrc.indexOf('getSessionSyncCache()'); i >= 0; i = daemonSrc.indexOf('getSessionSyncCache()', i + 1)) {
    if (daemonSrc.slice(i - 9, i) === 'function ') continue;
    callIndexes.push(i);
  }
  ok(mtimeBranch > 0 && callIndexes.length === 3 && callIndexes.every((i) => i < mtimeBranch),
    'C6 三处调用全部在 content 区（mtime 分支之前）⇒ 默认 mtime 路径零触碰 A3',
    { mtimeBranch, callIndexes });

  ok(has('const contentSource = autoCopyJudge.readWritableSnapshot(PROFILE.dataRoot, latest.id, ownerIds, getSessionSyncCache());')
    && has('const contentTarget = autoCopyJudge.readWritableSnapshot(PROFILE.dataRoot, target.id, ownerIds, getSessionSyncCache());'),
    'C7 源 / 目标两处写盘快照都透传缓存');
  ok(has(", preferredId: String(targetUid || '').trim(), cache: getSessionSyncCache() }"),
    'C8 判主（resolveContentLeader）也透传缓存');

  const saveCount = (daemonSrc.match(/^\s*scheduleSessionSyncCacheSave\(\);\s*$/gm) || []).length;
  ok(saveCount === 2,
    'C9 两条血缘同步路径（首建副本 / 已有目标）各落盘一次 —— 挂在 await 之后才能覆盖内容分支的 4 个 return', saveCount);

  const dmVersion = (daemonSrc.match(/const DAEMON_VERSION = '([^']+)';/) || [])[1] || '';
  const dmBuild = (daemonSrc.match(/const DAEMON_BUILD_ID = '([^']+)';/) || [])[1] || '';
  ok(/^release-\d+\.\d+\.\d+-\d{8}-[A-Za-z0-9][A-Za-z0-9-]*$/.test(dmBuild) && dmBuild.indexOf('release-' + dmVersion + '-') === 0,
    'C10 改了 daemon.js 就有递增版本 + 自洽 buildId（不递增改了也不生效）', { dmVersion, dmBuild });

  /* ==================================================================== */
  section('[D] A3 缓存本体的行为（把 daemon 里那一段抽出来在沙箱里真跑）');
  /* ==================================================================== */

  // 抽源码而不是 require daemon.js —— 后者会起 HTTP 服务、注册一堆进程级拍子。
  const blockStart = at('// 会话复制指纹缓存（上游 1.2.5 / A3）');
  const blockEnd = at('function isTaskSessionRecord(cwd)');
  ok(blockStart > 0 && blockEnd > blockStart, 'D1 能从 daemon 源码里定位到 A3 块（锚点在位）', { blockStart, blockEnd });
  const blockSrc = daemonSrc.slice(blockStart, blockEnd).replace(/\n+$/, '\n');
  ok(blockSrc.includes('function getSessionSyncCache') && !blockSrc.includes('isTaskSessionRecord'),
    'D2 抽出来的是完整且不越界的 A3 块');

  const A3DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-a3-dir-'));
  let atomicWrites = 0;
  const A3 = new Function('fs', 'path', 'DATA_DIR', 'atomicWriteText',
    blockSrc + '\nreturn { getSessionSyncCache, scheduleSessionSyncCacheSave, LIMIT: SESSION_SYNC_CACHE_LIMIT, state: () => sessionSyncCacheState };'
  )(fs, path, A3DIR, (file, text) => {
    atomicWrites += 1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  });

  ok(A3.LIMIT === 100000, 'D3 LIMIT 常量随块一起抽出', A3.LIMIT);
  ok(A3.state() === null, 'D4 未被调用前 state 为 null ⇒ schedule 是空转（默认 mtime 路径零触碰）');

  let nullStateThrows = null;
  try { A3.scheduleSessionSyncCacheSave(); } catch (e) { nullStateThrows = e.message; }
  ok(nullStateThrows === null, 'D5 state 为 null 时 schedule 立即返回、不抛错（空转就是默认路径的保护）', nullStateThrows);

  const m1 = A3.getSessionSyncCache();
  const m2 = A3.getSessionSyncCache();
  ok(m1 === m2 && m1.size === 0, 'D6 二次调用返回**同一实例**（每次新建等于把缓存写丢）');

  const CACHE_FILE = path.join(A3DIR, 'session-sync-cache.json');
  m1.set('projects/p/x.jsonl', { size: 3, mtimeMs: 1, ctimeMs: 2, hash: 'h', semantic: 'h', aliases: ['x'], records: ['h'] });
  ok(A3.state().dirty === true, 'D7 写条目会置 dirty（否则永远不落盘）');

  // 去抖：连续 schedule 只应排一个 timer、只落一次盘（一次同步会写几千上万个条目，
  // 逐条落盘等于把 io 打满）。
  A3.scheduleSessionSyncCacheSave();
  A3.scheduleSessionSyncCacheSave();
  ok(A3.state().timer !== null, 'D8 dirty 时 schedule 排上了 timer');
  m1.set('projects/p/y.jsonl', { size: 4, mtimeMs: 1, ctimeMs: 2, hash: 'h2' });
  A3.scheduleSessionSyncCacheSave(); // 已有在飞的 timer ⇒ 不该再排一个

  await new Promise((r) => setTimeout(r, 1400));
  ok(fs.existsSync(CACHE_FILE), 'D9 去抖窗口过后自动落盘（文件真的出现在磁盘上）');
  const written = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  ok(written && written.version === 1 && written.entries && written.entries['projects/p/x.jsonl'].hash === 'h'
    && atomicWrites === 1,
    'D10 落盘结构 {version:1, entries} 且**只写一次**（去抖生效，不是每个条目一次 io）',
    { atomicWrites, version: written && written.version });
  ok(A3.state().dirty === false, 'D11 落盘后 dirty 复位');

  // 载入侧校验：脏条目必须被剔除，绝不能把「没有 hash」的条目当成可复用指纹。
  fs.writeFileSync(CACHE_FILE, JSON.stringify({
    version: 1,
    entries: {
      'good.jsonl': { size: 10, mtimeMs: 1, ctimeMs: 1, hash: 'good', semantic: 'good', aliases: null, records: null },
      'no-hash.jsonl': { size: 10, mtimeMs: 1, ctimeMs: 1, hash: '' },
      'bad-size.jsonl': { size: 'x', mtimeMs: 1, ctimeMs: 1, hash: 'x' },
      'not-object.jsonl': 'nope',
    },
  }));
  const A3B = new Function('fs', 'path', 'DATA_DIR', 'atomicWriteText',
    blockSrc + '\nreturn { getSessionSyncCache, state: () => sessionSyncCacheState };'
  )(fs, path, A3DIR, () => {});
  const loaded = A3B.getSessionSyncCache();
  ok(loaded.size === 1 && loaded.has('good.jsonl'),
    'D12 载入时剔除无 hash / 非数字时间戳 / 非对象的脏条目（只留可复用的那条）', [...loaded.keys()]);
  ok(/version\s*===\s*1/.test(blockSrc) && blockSrc.includes('Number.isFinite'),
    'D13 载入同时校验版本号与时间戳有限性（版本不符直接弃用整个文件）');

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.rmSync(A3DIR, { recursive: true, force: true });
  fs.readFileSync = realReadFileSync;

  console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
  if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => {
  fs.readFileSync = realReadFileSync;
  console.log('\n结果：' + pass + ' 通过 / ' + (failures.length + 1) + ' 失败');
  console.log('  - 未捕获异常: ' + (e && e.stack || e));
  process.exit(1);
});
