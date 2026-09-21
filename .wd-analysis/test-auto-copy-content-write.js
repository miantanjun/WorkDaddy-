'use strict';
/*
 * test-auto-copy-content-write.js —— 方案 D / **D2 事务写入**的回归套件。
 *
 * 背景（见 SKILL §41.6、§42.8 的遗留②）：
 *   content 模式的 fan-out 原本仍走 `copySessionFiles`（**整目录 cp**），有两个固有缺陷：
 *     ① 不删目标侧多出来的文件 ⇒ `repair` 场景「目标多出来的文件」永远清不干净；
 *     ② 写盘中途失败会留下**半截状态**，没有回滚。
 *   D2 把它换成上游 `applySnapshot`：差异集 → 先备份目标旧字节 → 原子 rename 发布 → 发布后复检，
 *   失败按 journal 回滚。
 *
 * ⚠️ 本套件守的是**新分支**；`judge='mtime'`（默认值）那条路必须**逐字节不动**（见 [F] 组）。
 *    这是把「发版不可逆」变回「可回退」的根据：开关一关行为零变化。
 *
 * 分段：
 *   [A] 缝合件契约（pruneSessionSyncBackups 导出 + applySnapshot 透传）
 *   [B] pruneSessionSyncBackups 行为（真目录；按 mtime 而不是按名字；识别不出就保留）
 *   [C] content 模式真写盘：内容落地 / owner 改写 / 多余文件清理 / 产物域不动 / 备份+journal
 *   [D] 负向：slim 快照拿去写盘必须**显式报错**（不许静默写坏）
 *   [E] daemon 接线静态守卫（CRLF 先归一化再匹配，否则多行片段命中 0 次 ⇒ 假红）
 *   [F] 默认 mtime 路径逐字节未变（含 `status` 列仍然不在 UPDATE 里 —— 不变量 I-1）
 *
 * 全部在 os.tmpdir() 沙箱里跑，不碰真机数据。
 * 跑法：node .wd-analysis/test-auto-copy-content-write.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const judge = require(path.join(ROOT, 'scripts', 'auto-copy-judge.js'));
const sync = require(path.join(ROOT, 'scripts', 'session-sync.js'));

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
section('[A] 缝合件契约');
/* ==================================================================== */

ok(typeof judge.pruneSessionSyncBackups === 'function', 'A1 缝合件导出 pruneSessionSyncBackups');
ok(typeof judge.SYNC_BACKUP_KEEP === 'number' && judge.SYNC_BACKUP_KEEP >= 1,
  'A2 保留份数是显式常量且 ≥1（不是魔法数字散在 daemon 里）', judge.SYNC_BACKUP_KEEP);
ok(typeof judge.applySnapshot === 'function' && judge.applySnapshot === sync.applySnapshot,
  'A3 applySnapshot 仍是上游原函数的**直通**（daemon 只 require 缝合件一处）');
ok(typeof judge.readWritableSnapshot === 'function' && typeof judge.assertWritable === 'function',
  'A4 写盘用读入口 + 硬护栏都在');

/* ==================================================================== */
section('[B] pruneSessionSyncBackups：按 mtime 保留，识别不出就不碰');
/* ==================================================================== */

const PRUNE = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-prune-'));

ok(JSON.stringify(judge.pruneSessionSyncBackups(path.join(PRUNE, 'nope'))) ===
  JSON.stringify({ kept: 0, removed: 0, failed: 0, skipped: true }),
  'B1 目录不存在 ⇒ skipped，不抛错（daemon 每次切号都调它）');
ok(judge.pruneSessionSyncBackups('').skipped === true, 'B2 空路径 ⇒ skipped（别把空串当根去递归删）');

// 造条目：1 个真备份 + 「名字像但多了一位」+ 「没有 sync- 前缀」+ 1 个普通文件
// ⚠️ 年龄**故意反直觉**：真备份最新，冒牌货更老 —— 这样 keep=1 时冒牌货会被判出局，
//    「名字过滤是否精确」才真的被考到（年龄同向的话，放宽过滤也看不出来）。
fs.mkdirSync(path.join(PRUNE, 'sync-aaaaaa'), { recursive: true });
fs.mkdirSync(path.join(PRUNE, 'sync-toolongname'), { recursive: true });
fs.mkdirSync(path.join(PRUNE, 'not-a-backup'), { recursive: true });
fs.writeFileSync(path.join(PRUNE, 'random.txt'), 'x');
const pBase = Date.now() / 1000 - 7200;
fs.utimesSync(path.join(PRUNE, 'sync-aaaaaa'), pBase + 3600, pBase + 3600);       // 真备份、最新
fs.utimesSync(path.join(PRUNE, 'sync-toolongname'), pBase, pBase);                // 冒牌、最老
const kept1 = judge.pruneSessionSyncBackups(PRUNE, 1);
ok(kept1.kept === 1 && kept1.removed === 0 && kept1.failed === 0,
  'B3 keep=1 时只数出 1 份真备份、一份都不删（冒牌货不参与计数）', kept1);
ok(fs.existsSync(path.join(PRUNE, 'sync-toolongname')), 'B4 名字多一位（sync-toolongname）**不被删**');
ok(fs.existsSync(path.join(PRUNE, 'not-a-backup')) && fs.existsSync(path.join(PRUNE, 'random.txt')),
  'B5 没有 sync- 前缀的目录、以及普通文件**一律保留**（安全边界：只删自己建的 sync-XXXXXX）');
ok(fs.existsSync(path.join(PRUNE, 'sync-aaaaaa')), 'B6 真备份本来就在保留额度内，仍在');

// ⚠️ 关键一条：mkdtemp 的后缀是**随机串**，字典序与时间无关 ⇒ 必须按 mtime 保最新。
//    这里故意让「名字字典序最小」的那份**最老**，按名排序就会删错。
const R = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-prune-order-'));
const names = ['sync-zzzzzz', 'sync-mmmmmm', 'sync-aaaaaa'];
names.forEach((n) => fs.mkdirSync(path.join(R, n), { recursive: true }));
const base = Date.now() / 1000 - 3600;
// ⚠️ 年龄与名字**故意反向**：名字最小的最老、名字最大的最新。这样「按名排序」与「按 mtime 排序」
//    会留下不同的那一份 —— 断言才有鉴别力（两者同向的话，改坏了也看不出来）。
fs.utimesSync(path.join(R, 'sync-aaaaaa'), base, base);                    // 名字最小、**最老**
fs.utimesSync(path.join(R, 'sync-mmmmmm'), base + 600, base + 600);
fs.utimesSync(path.join(R, 'sync-zzzzzz'), base + 1200, base + 1200);      // 名字最大、**最新**
const keptOrder = judge.pruneSessionSyncBackups(R, 1);
ok(keptOrder.kept === 1 && keptOrder.removed === 2, 'B7 keep=1 ⇒ 留 1 删 2', keptOrder);
ok(fs.existsSync(path.join(R, 'sync-zzzzzz')), 'B8 留下的是 **mtime 最新**的那份（名字最大，正好反直觉）');
ok(!fs.existsSync(path.join(R, 'sync-aaaaaa')), 'B9 反证：名字最小但最老的那份被删 —— 若按名字排序会正好相反');
ok(judge.pruneSessionSyncBackups(R, 0).removed === 1 && !fs.existsSync(path.join(R, 'sync-zzzzzz')),
  'B10 keep=0 ⇒ 全删（调用方可以显式要求清空）');

/* ==================================================================== */
section('[C] content 模式真写盘：applySnapshot 的接线语义');
/* ==================================================================== */

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-d2-write-'));
const PROJ = path.join(SB, 'projects', 'p-one');
const PROJ2 = path.join(SB, 'projects', 'p-two');
fs.mkdirSync(PROJ, { recursive: true });
fs.mkdirSync(PROJ2, { recursive: true });
fs.mkdirSync(path.join(SB, 'artifact-index'), { recursive: true });

const S = 'SRC', T = 'TGT';
// ⚠️ 至少一条 `type: 'message'`（readSnapshot 拒绝「只有元数据」的日志），且
//    **正文 jsonl 只能出现在一个 project 目录下** —— 出现两处会被判「消息文件不唯一」而拒绝同步。
const rec = (u, text) => JSON.stringify({ type: 'message', uuid: u, text }) + '\n';
fs.writeFileSync(path.join(PROJ, S + '.jsonl'), rec(S + '-1', 'hello') + rec(S + '-2', 'world'));
fs.writeFileSync(path.join(PROJ, T + '.jsonl'), rec(T + '-1', 'hello'));
// 同一个会话在第二个 project hash 下也会有**附属目录**（jsonl 仍只在 p-one）—— 这些也要跟着对齐
fs.mkdirSync(path.join(PROJ, S), { recursive: true });
fs.mkdirSync(path.join(PROJ, T), { recursive: true });
fs.mkdirSync(path.join(PROJ2, S), { recursive: true });
fs.mkdirSync(path.join(PROJ2, T), { recursive: true });
fs.writeFileSync(path.join(PROJ2, S, 'notes.md'), 'from-source');
// 产物索引：两侧的 owner 都还挂着**源会话 id**（真实形态 —— 副本是从源复制来的）。
// applySnapshot 的 targetBytes 会把「属于本 lineage 的 owner」改写成目标自己的 id。
// ⚠️ 别用不属于 lineage 的假 id 做 owner —— 那样连上游都不改写，测的就不是这条路径了。
const idx = (owner) => JSON.stringify({ artifacts: [{ uri: 'u', _meta: { ownerConversationId: owner } }] });
fs.writeFileSync(path.join(SB, 'artifact-index', S + '.json'), idx(S));
fs.writeFileSync(path.join(SB, 'artifact-index', T + '.json'), idx(S));
// 目标侧多出来的文件：在快照域内（tasks）⇒ 必须被清理；这是 repair 场景的落点
fs.mkdirSync(path.join(SB, 'tasks', T), { recursive: true });
fs.writeFileSync(path.join(SB, 'tasks', T, 'stale.txt'), 'stale');
fs.mkdirSync(path.join(SB, 'tasks', S), { recursive: true });
fs.writeFileSync(path.join(SB, 'tasks', S, 'fresh.txt'), 'fresh');
// 产物目录：**不在**快照域内 ⇒ 无论目标多出什么都不许动
fs.mkdirSync(path.join(SB, 'workspace', 'sessions', T), { recursive: true });
fs.writeFileSync(path.join(SB, 'workspace', 'sessions', T, 'payload.bin'), 'keep-me');

const aliases = [S, T];
const srcSnap = judge.readWritableSnapshot(SB, S, aliases);
const tgtSnap = judge.readWritableSnapshot(SB, T, aliases);
ok(srcSnap.files.size > 0 && tgtSnap.files.size > 0, 'C0 源/目标快照都读到了文件');
ok(srcSnap.files.size > tgtSnap.files.size, 'C1 源比目标多文件（tasks/S/fresh.txt 尚未下发）',
  { src: srcSnap.files.size, tgt: tgtSnap.files.size });
ok([...srcSnap.files.keys()].every((k) => !k.startsWith('workspace/sessions')),
  'C2 内容快照里没有 workspace/sessions（产物体积最大，按既有裁决不参与）');

const BACKUP_ROOT = path.join(SB, '.backups');
let commitCalls = 0;
let verifyCalls = 0;
(async () => {
  const applied = await judge.applySnapshot(srcSnap, tgtSnap, {
    backupRoot: BACKUP_ROOT,
    guard: async () => {},
    commit: async (verifyPublished) => {
      commitCalls += 1;
      if (typeof verifyPublished === 'function') { verifyPublished(); verifyCalls += 1; }
    },
  });

  ok(applied && applied.copied > 0, 'C3 applySnapshot 报出了写入条数', applied);
  ok(commitCalls === 1 && verifyCalls === 1,
    'C4 commit 回调被调用一次，且拿得到 verifyPublished（DB 写库后要复检）', { commitCalls, verifyCalls });

  const nowSrc = fs.readFileSync(path.join(PROJ, S + '.jsonl'), 'utf8');
  const nowTgt = fs.readFileSync(path.join(PROJ, T + '.jsonl'), 'utf8');
  ok(nowTgt === nowSrc, 'C5 目标正文与源**逐字节一致**');
  ok(nowSrc.indexOf('world') >= 0, 'C6 源内容确实含新增回合（不是空快照凑数）');
  const nowTgt2 = fs.existsSync(path.join(PROJ2, T, 'notes.md'))
    ? fs.readFileSync(path.join(PROJ2, T, 'notes.md'), 'utf8') : '';
  ok(nowTgt2 === 'from-source',
    'C7 第二个 project hash 下的会话附属目录也一起对齐（同会话可能挂在多个项目下）');

  const tgtIdx = JSON.parse(fs.readFileSync(path.join(SB, 'artifact-index', T + '.json'), 'utf8'));
  ok(tgtIdx.artifacts[0]._meta.ownerConversationId === T,
    'C8 目标产物索引的 owner 被改写成**目标 id**（否则官方会过滤掉这些产物）');

  ok(fs.existsSync(path.join(SB, 'tasks', T, 'fresh.txt')),
    'C9 源侧**多出来**的附属文件已下发到目标（repair 正向）');
  ok(!fs.existsSync(path.join(SB, 'tasks', T, 'stale.txt')),
    'C10 目标侧**多出来**的文件已被清理（这正是 copySessionFiles 做不到的）');
  ok(fs.existsSync(path.join(SB, 'workspace', 'sessions', T, 'payload.bin')),
    'C11 产物目录里的文件**一点没动**（快照域外，交二阶段复制）');

  const backups = fs.readdirSync(BACKUP_ROOT).filter((n) => /^sync-[A-Za-z0-9]{6}$/.test(n));
  ok(backups.length === 1, 'C12 产生且只产生一份事务备份（回滚凭据）', backups);
  const journal = JSON.parse(fs.readFileSync(path.join(BACKUP_ROOT, backups[0], 'journal.json'), 'utf8'));
  ok(journal.status === 'committed' && journal.sourceId === S && journal.targetId === T,
    'C13 journal 记 committed 且带源/目标 id（可审计）', { s: journal.status, src: journal.sourceId, tgt: journal.targetId });
  // ⚠️ 备份内路径用的是**逻辑键**（projects/<proj>/__session__.jsonl），不是目标 id ——
  //    与 readSnapshot 的 key 一致，所以这里断言逻辑键。
  ok(fs.existsSync(path.join(BACKUP_ROOT, backups[0], 'files', 'projects', 'p-one', '__session__.jsonl')),
    'C14 备份里存着**目标旧字节**（这是能回滚的前提）');

  // 为什么「源自复制」必须保留 copySessionFiles：applySnapshot 明确拒绝自复制
  let selfRejected = false;
  try { await judge.applySnapshot(srcSnap, judge.readWritableSnapshot(SB, S, aliases), { backupRoot: BACKUP_ROOT }); }
  catch (_) { selfRejected = true; }
  ok(selfRejected, 'C15 反证：applySnapshot 拒绝 source.id === target.id ⇒ 源自身只能靠 copySessionFiles 自复制');

  /* ================================================================== */
  section('[D] 负向：slim 快照拿去写盘必须显式报错');
  /* ================================================================== */

  const slim = judge.readJudgedSnapshot(SB, S, aliases);
  ok(slim.slim === true, 'D0 readJudgedSnapshot 返回的确实是 slim 快照');
  let slimBlocked = false, slimMsg = '';
  try { judge.assertWritable(slim, 'x'); } catch (e) { slimBlocked = true; slimMsg = e.message; }
  ok(slimBlocked && /slim/.test(slimMsg),
    'D1 slim（仅判定用、无 bytes）交给写盘前被**硬护栏**拦下，不是静默写坏', slimMsg);
  let emptyBlocked = false, emptyMsg = '';
  try { judge.assertWritable(null, 'y'); } catch (e) { emptyBlocked = true; emptyMsg = e.message; }
  ok(emptyBlocked && /快照为空/.test(emptyMsg), 'D2 空快照同样被拦下', emptyMsg);
  let missingBytes = false;
  try { judge.assertWritable({ files: new Map([['k', { hash: 'h' }]]) }, 'z'); } catch (_) { missingBytes = true; }
  ok(missingBytes, 'D3 缺 bytes 的快照被拦下（有 hash 不等于能写盘）');

  /* ================================================================== */
  section('[E] daemon 接线静态守卫（防「改回去也不知道」）');
  /* ================================================================== */

  const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
  const has = (needle) => daemonSrc.includes(needle);

  // ⚠️ 锚点必须**唯一到写盘分支**：全文件 `if (judgeMode === 'content') {` 另有两处
  //    （6720 判主出口 / 6896 缓存清理），只匹配那一行的话「把这个分支短路掉」也测不出来。
  //    锚法：以 `let failedFiles = 0;`（全文件唯一）为基准，取它**之后**第一个 content 分支
  //    —— 6720 那处天然被排除；两者之间夹几行无关初始化（例如 A7 新增的 `let copiedBytes = 0;`）
  //    也不会误伤。旧写法把两行字面拼在一起，中间插一行就红（本轮实证）。
  const failedFilesInitAt = daemonSrc.indexOf('  let failedFiles = 0;');
  const writeBranchAt = failedFilesInitAt < 0 ? -1
    : daemonSrc.indexOf("  if (judgeMode === 'content') {", failedFilesInitAt + 1);
  ok(failedFilesInitAt > 0 && writeBranchAt > failedFilesInitAt,
    'E1 daemon 里 content 模式有独立写盘分支（锚定 failedFiles 之后那处，唯一到写盘分支）');
  ok(has('const contentSource = autoCopyJudge.readWritableSnapshot(PROFILE.dataRoot, latest.id, ownerIds, getSessionSyncCache());'),
    'E2 源快照用 readWritableSnapshot（不是判定用的 slim），且**读一次复用**（第 4 参透传 A3 文件级指纹缓存）');
  ok(has("autoCopyJudge.assertWritable(contentSource, 'content-source');")
    && has("autoCopyJudge.assertWritable(contentTarget, 'content-target/' + target.id);"),
    'E3 源与目标在写盘前都过了 assertWritable 硬护栏');
  ok(has('const applied = await autoCopyJudge.applySnapshot(contentSource, contentTarget, {'),
    'E4 目标写盘走 applySnapshot（不再走整目录 cp）');
  ok(has('backupRoot: syncBackupRoot,'), 'E5 显式传 backupRoot（没有备份就没有回滚凭据）');
  ok(has('autoCopyJudge.pruneSessionSyncBackups(syncBackupRoot);'),
    'E6 每次同步前裁剪备份（否则每次切号在 DATA_DIR 堆一份会话全量旧字节）');
  ok(has("path.join(DATA_DIR, 'session-sync-backups')"), 'E7 备份落在 DATA_DIR 下（不是临时目录，重启后仍在）');
  ok(has("const repairedSource = await copySessionFiles(PROFILE.dataRoot, latest.id, latest.id, ownerIds, options);"),
    'E8 源自身仍走自复制（applySnapshot 拒绝自目标，见 C15）');
  ok(has('workspacePending = fs.existsSync(workspaceDir) && directoryStats(workspaceDir).files > 0;'),
    'E9 workspacePending 回传：源侧真有产物才登记第二阶段');
  ok(has('if (workspacePending) trackPayload({ workspacePending: true }, latest.id, target.id);'),
    'E10 回传接到既有的 payloadTargets 通道（不是新造一条）');
  ok(has('commit: async (verifyPublished) => {') && has("if (typeof verifyPublished === 'function') verifyPublished();"),
    'E11 commit 走「先写库、再复检」的上游契约（复检失败即抛错触发回滚）');
  ok(!/status = \?/.test(daemonSrc) && !/SET status/.test(daemonSrc),
    'E12 UPDATE 里**依然没有 status 列**（不变量 I-1：归档态不跨账号传播）');

  /* ================================================================== */
  section('[F] 默认 mtime 路径：开关关上必须零变化');
  /* ================================================================== */

  const ifAt = daemonSrc.indexOf("  if (judgeMode === 'content') {");
  const elseAt = daemonSrc.indexOf('  } else {', ifAt);
  ok(elseAt > 0 && ifAt > 0 && ifAt < elseAt, 'F1 content 分支在前、原 fan-out 完整保留在其后的 else 里');
  const tail = daemonSrc.slice(elseAt);
  ok(tail.includes('const files = await copySessionFiles(PROFILE.dataRoot, latest.id, target.id, ownerIds, options);'),
    'F2 else 分支仍逐目标调 copySessionFiles（旧语义原样）');
  ok(tail.includes('trackPayload(files, latest.id, target.id);') && tail.includes('failedFiles += files.failed;'),
    'F3 else 分支的 trackPayload / 失败计数原样保留');
  ok(tail.includes("'UPDATE sessions SET title = ?, custom_title = ?, updated_at = ?, last_activity_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL;'"),
    'F4 else 分支的 UPDATE 逐字未变（含「不写 status」的注释语境）');
  ok(tail.includes('  if (target.id === latest.id) continue;'), 'F5 else 分支的「跳过源自身」判断仍在');
  ok(failedFilesInitAt > 0 && daemonSrc.split('let failedFiles = 0;').length - 1 === 1,
    'F6 failedFiles 在分支外初始化为 0 且全文件只声明一次（两条路各写各的值，不会重复声明）');
  ok(daemonSrc.split('const repairedSource = await copySessionFiles(').length - 1 === 2,
    'F7 自复制的字面出现**恰好 2 次**（content + mtime 各一次，没有泄露到第三处）');
  ok(daemonSrc.split('copySessionFiles(PROFILE.dataRoot, latest.id, latest.id, ownerIds, options)').length - 1 === 2,
    'F8 反证：自复制**调用**恰好 2 处 —— 多一处就是重复执行源自修复',
    daemonSrc.split('copySessionFiles(PROFILE.dataRoot, latest.id, latest.id, ownerIds, options)').length - 1);

  /* ================================================================== */
  // 收尾
  const bad = failures.length;
  console.log('');
  console.log('==== ' + pass + ' passed, ' + bad + ' failed ====');
  try { fs.rmSync(SB, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(PRUNE, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(R, { recursive: true, force: true }); } catch (_) {}
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.log('');
  console.log('  FAIL 套件异常终止: ' + (e && e.message));
  console.log('==== ' + pass + ' passed, ' + (failures.length + 1) + ' failed ====');
  process.exit(1);
});
