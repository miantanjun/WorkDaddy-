'use strict';
/*
 * test-session-sync-124.js —— 上游会话同步模块（content-snapshot 判据）的落地守卫。
 *
 * 背景（见 WorkDaddy-上游1.2.4影响面实测报告.md）：
 *   上游 1.2.4 把「会话同步判据」从**文件时间**换成**内容快照哈希** ——
 *   readSnapshot 给每个文件算 sha256（会话 id 归一化后），compareSnapshots 据此给出
 *   equal / left-extends / right-extends / conflict / repair 五态，selectTargetSnapshot
 *   按内容选目标（**永不按 mtime 选赢家**），applySnapshot 负责落盘 + 备份 + 可回滚。
 *
 * 2026-09-21（上游 1.2.5 吸纳批，见 WorkDaddy-OpenViking吸纳评估与功能进度总览.md §2.1）：
 *   基线 fixture 从 1.2.4 升到 **1.2.5**。本套件同步升级：
 *     · [A] 的 provenance 锁锚到 fixtures/session-sync.upstream-1.2.5.js；导出面 4 → **5**（新增 readSessionSizes）
 *     · [C] 从「上限适配」反转为「**上限已取消**」：上游 1.2.5 删掉 MAX_BYTES/MAX_FILES 与闸门，
 *       本地 delta-1 随之退休 ⇒ 改为守「无上限 + attachBytes 惰性读 + 原有防线仍在」
 *     · 新增 [F] readSessionSizes 的功能性守卫（A4 吸纳）
 *   文件名叫 …-124 是历史遗留（这轮延续改名成本 > 收益，改名会牵动 SUITES 与多处文档引用）。
 *
 * 2026-09-24（上游 1.2.6 吸纳批，见 WorkDaddy-上游1.2.6吸纳建议报告-2026-09-24.md §4 批次 2）：
 *   基线 fixture 从 1.2.5 升到 **1.2.6**（session-sync.js 从 427 行扩到 937 行）。本套件同步升级：
 *     · [A] provenance 锁锚到 fixtures/session-sync.upstream-1.2.6.js；导出面 5 → **9**
 *     · [C] C7 反转为「遍历内**跳过** symlink 条目、写入路径 safePath 仍直接抛错」
 *       （上游 1.2.129 的刻意变更：会话内符号链接不再让整次同步失败）
 *     · 新增 [G]：守「1.2.6 免费继承项」＋「本地 4 条 skip 域 delta 没被上游重写冲掉」
 *   注意：本地 delta 从 1.2.5 的 7 条**一条没少**，只是 delta-2b/2d 需要限定作用域
 *   （1.2.6 新增了异步孪生，同形代码各出现两次）。
 *
 * 本套件守七件事：
 *   [A] 契约 + 「上游原文 fixture + delta 表 == 工作副本」的逐字节 provenance 锁（保证可长期与上游 diff）
 *   [B] 判据是「内容」不是「时间」
 *   [C] 上限已取消（A1）+ 惰性读（A2）+ 原有防线仍在
 *   [D] 五态判定 + 安全选主（equal 优先；多分支互相冲突时返回 null 而不是猜）
 *   [E] applySnapshot 真写：字节一致、journal=committed、ownerConversationId 改写、
 *       missingOnly 语义、多余文件清理、guard 抛错时零写入
 *   [F] readSessionSizes：轻量按会话计字节（A4），非法 id 不拖垮整批
 *
 * 全部在 os.tmpdir() 沙箱里跑，不碰真机数据。
 * 跑法：node .wd-analysis/test-session-sync-124.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'scripts', 'session-sync.js');
const SOURCE = fs.readFileSync(MODULE, 'utf8');

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
function slice(from, to) {
  const i = SOURCE.indexOf(from);
  if (i < 0) return '';
  const j = to ? SOURCE.indexOf(to, i) : SOURCE.length;
  return SOURCE.slice(i, j < 0 ? SOURCE.length : j);
}

/* ==================================================================== */
section('[A] 契约 + 上游原文 fixture/delta 表的 provenance 锁');
/* ==================================================================== */

const sync = require(MODULE);

ok(fs.existsSync(MODULE), 'A1 scripts/session-sync.js 存在');
ok(typeof sync.readSnapshot === 'function', 'A2 readSnapshot 是函数');
ok(typeof sync.compareSnapshots === 'function', 'A3 compareSnapshots 是函数');
ok(typeof sync.selectTargetSnapshot === 'function', 'A4 selectTargetSnapshot 是函数');
ok(typeof sync.applySnapshot === 'function', 'A5 applySnapshot 是函数');
ok(Object.keys(sync).sort().join(',') === 'applySnapshot,applySnapshotAsync,compareSnapshots,readSessionFingerprintAsync,readSessionQuickFingerprintAsync,readSessionSizes,readSnapshot,readSnapshotAsync,selectTargetSnapshot',
  'A6 导出面与上游 1.2.6 一致（9 个：1.2.5 的 5 个 + 异步孪生 applySnapshotAsync/readSnapshotAsync + 两个指纹助手）', Object.keys(sync).sort());

ok(SOURCE.indexOf('\r') === -1, 'A7 纯 LF（与上游逐字节可 diff）');
ok(!SOURCE.startsWith('\uFEFF'), 'A8 无 BOM');

// 「本地 delta」锁：上游原文（fixtures/）+ delta 表 == 我们的工作副本，**逐字节**。
// 这样既能长期与上游 diff，又保证「差异只有登记过的那几条」——
// 任何人绕过 delta 表直接改工作副本，这条立刻翻红。
// （2026-09-20 从「正则还原两个常量」升级而来：那时差异只有常量，现在有多处，
//   硬编码还原式已经不可维护，改由 fixtures/session-sync.deltas.js 作唯一真相。）
const FIXTURE = path.join(ROOT, '.wd-analysis', 'fixtures', 'session-sync.upstream-1.2.6.js');
const deltas = require('./fixtures/session-sync.deltas.js');
ok(fs.existsSync(FIXTURE), 'A9 上游原文 fixture 存在（可随时 diff 上游）');
const fixtureText = fs.readFileSync(FIXTURE, 'utf8');
ok(crypto.createHash('sha256').update(fixtureText, 'utf8').digest('hex') === deltas.UPSTREAM_SHA256,
  'A10 fixture 指纹 == 登记的 1.2.5 指纹（防 fixture 本身被改）', deltas.UPSTREAM_SHA256.slice(0, 12));
ok(fixtureText.indexOf('\r') === -1, 'A11 fixture 纯 LF');
const drifted = deltas.DELTAS.filter((d) => fixtureText.split(d.from).length - 1 !== 1).map((d) => d.id);
ok(drifted.length === 0, 'A12 每条 delta 在上游原文里恰好命中 1 次（防原地漂移）', drifted);
const rebuilt = deltas.applyDeltas(fixtureText);
ok(rebuilt.problems.length === 0 && rebuilt.text === SOURCE,
  'A13 上游原文 + delta 表 == 工作副本（逐字节 provenance 锁）', rebuilt.problems);

/* ==================================================================== */
section('[B] 判据是「内容」不是「时间」');
/* ==================================================================== */

const CMP = slice('function compareSnapshots(left, right) {', '\n// Legacy copies can leave');
const READ = slice('function readSnapshot(root, id, aliases = [], options = {}, cache = null) {', '\nfunction compareSnapshots');
ok(CMP.length > 0, 'B1 取到 compareSnapshots 函数体');
ok(!/mtime/i.test(CMP), 'B2 compareSnapshots 不出现 mtime（不用文件时间判谁赢）');
ok(!/Date\.now|Date\.parse|new Date\(\)/.test(CMP), 'B3 compareSnapshots 不读墙钟');
ok(!/Date\.now|new Date\(\)/.test(READ), 'B4 readSnapshot 不用墙钟做判据');
ok(/createHash\('sha256'\)/.test(SOURCE), 'B5 用 sha256 做内容指纹');
ok(/function canonical\(/.test(SOURCE), 'B6 有会话 id 归一化（否则复制本身会改变内容哈希）');

/* ==================================================================== */
section('[C] 上限已取消（A1）+ 惰性读（A2）+ 防线仍在');
/* ==================================================================== */

ok(!/const MAX_BYTES/.test(SOURCE), 'C1 已无 MAX_BYTES 上限常量（上游 1.2.5 取消 ⇒ 本地 delta-1 退休）');
ok(!/const MAX_FILES/.test(SOURCE), 'C2 已无 MAX_FILES 上限常量');
ok(!/会话文件过大，未自动同步/.test(SOURCE), 'C3 旧「过大未同步」闸门与文案彻底消失（上限没了，这句话就不该存在）');
ok(/function attachBytes\(entry\) \{/.test(SOURCE) && /Object\.defineProperty\(entry, 'bytes'/.test(SOURCE),
  'C4 attachBytes 惰性字节加载在（bytes 是 getter，不再常驻内存）—— 这是「无上限」的安全前提');
ok(/now\.size !== entry\.size \|\| now\.mtimeMs !== entry\.mtimeMs \|\| now\.ctimeMs !== entry\.ctimeMs/.test(SOURCE),
  'C5 惰性读之前校验 size/mtimeMs/ctimeMs 三元组（防读到半写状态）');
ok(/const trustedComponents = new Map\(\)/.test(SOURCE) && /function safePathFast\(relative\) \{/.test(SOURCE),
  'C6 safePathFast 在：快照内目录组件只验一次（A6，减重复 lstat）');
ok(/if \(stat\.isSymbolicLink\(\)\) return;/.test(SOURCE)
  && /if \(fs\.lstatSync\(target\)\.isSymbolicLink\(\)\) throw Error\('会话文件包含符号链接，未同步'\)/.test(SOURCE),
  'C7 但**每个文件仍单独查 symlink**（1.2.6 起：快照遍历内跳过 symlink 条目，写入路径 safePath 仍直接抛错）');
ok(/无效的会话标识/.test(SOURCE), 'C8 会话 id 校验仍在（路径注入防线）');
ok(/无效的会话文件路径/.test(SOURCE), 'C9 相对路径校验仍在');
ok(/isSymbolicLink\(\)/.test(SOURCE), 'C10 符号链接拒绝仍在');
ok(/正在变化，请稍后重试/.test(SOURCE), 'C11 读写竞态检测仍在');
ok(/会话消息文件不唯一，未同步/.test(SOURCE), 'C12 多项目目录歧义时拒绝同步');

/* ==================================================================== */
section('[D] 沙箱：五态判定');
/* ==================================================================== */

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-sync-124-'));
const PROJ = path.join(SANDBOX, 'projects', 'p-one');
fs.mkdirSync(PROJ, { recursive: true });

const IDS = ['SRC', 'T-EQUAL', 'T-EXTENDS', 'T-SHORT', 'T-CONFLICT', 'T-REPAIR'];
// ⚠️ 关键：同一会话在各账号的副本，除「身份字段」外必须逐字节相同 —— 真实复制只改写
// ownerConversationId 这类身份键，`uuid`/正文差异意味着**内容真的分叉了**，那本就该判 conflict。
// 所以这里所有副本都用同一个 marker 生成，只在需要的地方（更长/更短/首条不同）人为造差异。
function transcript(types, marker) {
  return types.map((t, i) => JSON.stringify({ type: t, uuid: marker + '-' + i, text: marker + '-' + i })).join('\n') + '\n';
}
function writeTranscript(id, types, marker) {
  fs.writeFileSync(path.join(PROJ, id + '.jsonl'), transcript(types, marker || 'SAME'));
}
function writeIndex(id, owner) {
  fs.mkdirSync(path.join(SANDBOX, 'artifact-index'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'artifact-index', id + '.json'),
    JSON.stringify({ artifacts: [{ name: 'a.txt', _meta: { ownerConversationId: owner } }] }));
}

writeTranscript('SRC', ['message', 'message']);
writeTranscript('T-EQUAL', ['message', 'message']);
writeTranscript('T-EXTENDS', ['message', 'message', 'message']);
writeTranscript('T-SHORT', ['message']);
writeTranscript('T-CONFLICT', ['message', 'message']);
writeTranscript('T-REPAIR', ['message', 'message']);
for (const id of ['SRC', 'T-EQUAL', 'T-EXTENDS', 'T-SHORT', 'T-REPAIR']) writeIndex(id, id);
// 让 T-CONFLICT 的首条记录与 SRC 不同
const cf = JSON.parse(fs.readFileSync(path.join(PROJ, 'T-CONFLICT.jsonl'), 'utf8').trim().split('\n')[0]);
cf.text = 'DIFFERENT';
const cfLines = fs.readFileSync(path.join(PROJ, 'T-CONFLICT.jsonl'), 'utf8').trim().split('\n');
cfLines[0] = JSON.stringify(cf);
fs.writeFileSync(path.join(PROJ, 'T-CONFLICT.jsonl'), cfLines.join('\n') + '\n');
fs.rmSync(path.join(SANDBOX, 'artifact-index', 'T-REPAIR.json'));

const read = (id) => sync.readSnapshot(SANDBOX, id, IDS);
const src = read('SRC');
ok(src.records && src.records.length === 2, 'D1 读到 2 条记录');
ok(src.transcriptKey === 'projects/p-one/__session__.jsonl', 'D2 transcriptKey = 项目目录 + 归一化名', src.transcriptKey);

const kindOf = (id) => sync.compareSnapshots(src, read(id));
ok(kindOf('T-EQUAL').kind === 'equal', 'D3 完全一致 → equal');
ok(kindOf('T-EXTENDS').kind === 'right-extends', 'D4 目标更长且前缀一致 → right-extends');
ok(kindOf('T-SHORT').kind === 'left-extends', 'D5 目标更短且前缀一致 → left-extends');
ok(kindOf('T-CONFLICT').kind === 'conflict', 'D6 前缀出现差异 → conflict');
const rep = kindOf('T-REPAIR');
ok(rep.kind === 'repair' && rep.missingRight === true, 'D7 记录一致但缺附属文件 → repair(missingRight)', rep);

// 同一会话落在不同项目目录 ⇒ transcriptKey 不同 ⇒ 必须判冲突，不许硬合
const PROJ2 = path.join(SANDBOX, 'projects', 'p-two');
fs.mkdirSync(PROJ2, { recursive: true });
fs.copyFileSync(path.join(PROJ, 'SRC.jsonl'), path.join(PROJ2, 'SRC2.jsonl'));
const cross = sync.readSnapshot(SANDBOX, 'SRC2', IDS);
ok(sync.compareSnapshots(src, cross).kind === 'conflict', 'D8 落在不同项目目录 → conflict（不跨目录硬合）');

// 两个同名 .jsonl ⇒ 上游拒绝（避免"哪份才是会话"的歧义）
fs.copyFileSync(path.join(PROJ, 'SRC.jsonl'), path.join(PROJ2, 'SRC.jsonl'));
let dupErr = null;
try { sync.readSnapshot(SANDBOX, 'SRC', IDS); } catch (e) { dupErr = e.message; }
ok(dupErr === '会话消息文件不唯一，未同步', 'D9 同名消息文件出现两次 → 拒绝同步', dupErr);
fs.rmSync(path.join(PROJ2, 'SRC.jsonl'));

/* ==================================================================== */
section('[E] 沙箱：选主 + applySnapshot 真写');
/* ==================================================================== */

(async function () {
  const equalPick = await sync.selectTargetSnapshot(src, ['T-CONFLICT', 'T-EQUAL'], read);
  ok(equalPick.targetId === 'T-EQUAL', 'E1 存在 equal 时优先取它', equalPick.targetId);

  const prefPick = await sync.selectTargetSnapshot(src, ['T-EQUAL', 'T-EXTENDS'], read, 'T-EXTENDS');
  ok(prefPick.targetId === 'T-EQUAL', 'E2 preferredId 不推翻 equal（已一致就不做多余写入）', prefPick.targetId);

  const descPick = await sync.selectTargetSnapshot(src, ['T-SHORT', 'T-EXTENDS'], read);
  ok(descPick.targetId === 'T-EXTENDS', 'E3 只有"目标更长"时取最长的那份', descPick.targetId);

  const repairPick = await sync.selectTargetSnapshot(src, ['T-REPAIR', 'T-EXTENDS'], read);
  ok(repairPick.targetId === 'T-REPAIR', 'E4 repair 优先于 extends（补缺比重写安全）', repairPick.targetId);

  // 合成的两个后代：各自都是"目标更长"，但彼此冲突 ⇒ 必须返回 null（交上层派生新会话）
  const K = 'projects/p-one/__session__.jsonl';
  const syntheticSrc = { root: SANDBOX, id: 'S', aliases: IDS, records: ['r1'], transcriptKey: K,
    files: new Map([[K, { semantic: 'S' }]]) };
  const branchA = { root: SANDBOX, id: 'BR-A', aliases: IDS, records: ['r1', 'rA'], transcriptKey: K,
    files: new Map([[K, { semantic: 'S' }], ['side', { semantic: 'A' }]]) };
  const branchB = { root: SANDBOX, id: 'BR-B', aliases: IDS, records: ['r1', 'rB'], transcriptKey: K,
    files: new Map([[K, { semantic: 'S' }], ['side', { semantic: 'B' }]]) };
  ok(sync.compareSnapshots(syntheticSrc, branchA).kind === 'right-extends', 'E5 前置：两个后代各自都是 right-extends');
  const fakeRead = (id) => (id === 'BR-A' ? branchA : branchB);
  const conflictPick = await sync.selectTargetSnapshot(syntheticSrc, ['BR-A', 'BR-B'], fakeRead);
  ok(conflictPick.targetId === null && conflictPick.comparison.kind === 'conflict',
    'E6 多个后代互相冲突 → 返回 null（不覆盖任何一方）', conflictPick.targetId);

  let threw = null;
  try { await sync.selectTargetSnapshot(src, ['Z1', 'Z2'], () => { throw new Error('目标不可读'); }); }
  catch (e) { threw = e.message; }
  ok(threw === '目标不可读', 'E7 候选全不可读时抛真实错误，不静默当"没候选"', threw);

  /* -------------------- applySnapshot 真写 -------------------- */
  const backupRoot = path.join(SANDBOX, 'backups');
  const beforeShort = fs.readFileSync(path.join(PROJ, 'T-SHORT.jsonl'));
  let commitCalls = 0;
  const result = await sync.applySnapshot(src, read('T-SHORT'), {
    backupRoot, metadata: { note: 'test' }, commit: async () => { commitCalls += 1; },
  });
  ok(fs.readFileSync(path.join(PROJ, 'SRC.jsonl')).equals(fs.readFileSync(path.join(PROJ, 'T-SHORT.jsonl'))),
    'E8 目标正文与源逐字节一致');
  ok(sync.compareSnapshots(src, read('T-SHORT')).kind === 'equal', 'E9 复制后判定为 equal');
  ok(result.copied >= 1, 'E10 报告了写入条数', result.copied);
  ok(commitCalls === 1, 'E11 commit 回调恰好一次（DB 侧在文件发布后再提交）', commitCalls);
  ok(fs.existsSync(path.join(result.backup, 'journal.json')), 'E12 生成 journal.json');
  const journal = JSON.parse(fs.readFileSync(path.join(result.backup, 'journal.json'), 'utf8'));
  ok(journal.status === 'committed', 'E13 journal.status = committed', journal.status);
  ok(journal.metadata && journal.metadata.note === 'test', 'E14 journal 记录了 metadata');
  const bakFiles = [];
  (function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) walk(q); else bakFiles.push(q); } })(path.join(result.backup, 'files'));
  ok(bakFiles.some((f) => fs.readFileSync(f).equals(beforeShort)),
    'E15 备份里保存了被覆盖前的原始字节（可回滚）', bakFiles.length);
  const idx = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'artifact-index', 'T-SHORT.json'), 'utf8'));
  ok(idx.artifacts[0]._meta.ownerConversationId === 'T-SHORT',
    'E16 产物索引 ownerConversationId 改写为目标 id', idx.artifacts[0]._meta.ownerConversationId);

  // missingOnly：目标已有该文件 ⇒ 不覆盖
  const keep = transcript(['message', 'message'], 'KEEP-ME');
  fs.writeFileSync(path.join(PROJ, 'T-EXTENDS.jsonl'), keep);
  await sync.applySnapshot(src, read('T-EXTENDS'), { backupRoot, missingOnly: true, commit: async () => {} });
  ok(fs.readFileSync(path.join(PROJ, 'T-EXTENDS.jsonl'), 'utf8') === keep, 'E17 missingOnly=true 不覆盖目标已有文件');

  // 源独有的附属文件 ⇒ 补齐（F12/F13 合并）
  fs.mkdirSync(path.join(PROJ, 'SRC'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'SRC', 'side.txt'), 'side-payload');
  const src2 = read('SRC');
  await sync.applySnapshot(src2, read('T-REPAIR'), { backupRoot, commit: async () => {} });
  ok(fs.readFileSync(path.join(PROJ, 'T-REPAIR', 'side.txt'), 'utf8') === 'side-payload',
    'E18 源独有附属文件被补齐且逐字节一致');

  // 目标多余的附属文件 ⇒ 清理（双向一致）
  fs.writeFileSync(path.join(PROJ, 'T-REPAIR', 'stale.txt'), 'stale');
  await sync.applySnapshot(src2, read('T-REPAIR'), { backupRoot, commit: async () => {} });
  ok(!fs.existsSync(path.join(PROJ, 'T-REPAIR', 'stale.txt')), 'E19 目标多余附属文件被清理（双向一致）');

  // guard 抛错 ⇒ 零写入 + 原错误上抛
  const before = fs.readFileSync(path.join(PROJ, 'T-SHORT.jsonl'));
  let guardErr = null;
  try {
    await sync.applySnapshot(src2, read('T-SHORT'),
      { backupRoot, guard: async () => { throw new Error('renderer busy'); }, commit: async () => {} });
  } catch (e) { guardErr = e.message; }
  ok(guardErr === 'renderer busy', 'E20 guard 抛错时原错误冒出来', guardErr);
  ok(fs.readFileSync(path.join(PROJ, 'T-SHORT.jsonl')).equals(before), 'E21 guard 抛错后目标零改动');

  // 源与目标同 id ⇒ 拒绝（防自杀式同步）
  let selfErr = null;
  try { await sync.applySnapshot(src, src, { backupRoot, commit: async () => {} }); }
  catch (e) { selfErr = e.message; }
  ok(selfErr === '无效的会话同步目标', 'E22 源与目标相同 → 拒绝', selfErr);

  /* ==================================================================== */
  section('[F] readSessionSizes：轻量按会话计字节（A4）');
  /* ==================================================================== */

  const sizes = await sync.readSessionSizes(SANDBOX, ['SRC', 'NOPE', '../evil']);
  ok(sizes instanceof Map && Number(sizes.get('SRC')) > 0,
    'F1 正常会话返回累计字节数（只 lstat 累加 size，不解析消息、不读 payload）', sizes instanceof Map && sizes.get('SRC'));
  ok(sizes.get('NOPE') === 0, 'F2 合法但不存在的 id → 0（不是 null、也不抛）', sizes.get('NOPE'));
  ok(sizes.get('../evil') === null, 'F3 非法 id → null：单个失败不拖垮整批', sizes.get('../evil'));

  /* ==================================================================== */
  section('[G] 1.2.6 免费继承项 + 本地 skip 域未被冲掉（批次 2 重定基的产出）');
  /* ==================================================================== */

  // 「免费继承」的定义：上游 1.2.6 原生做到、本地以前根本没这些概念 ⇒ 重定基后自动到手。
  // 其中 G1 修的是一条**已经在发生的假阳性**：WorkBuddy 每次打开/恢复会话都会追加
  // session-meta 生命周期记录，本地旧版把它当「正文变了」⇒ 误判需同步、严重时误报分叉。
  const META_SITES = SOURCE.split("record.type === 'session-meta'").length - 1;
  ok(META_SITES >= 3,
    'G1 session-meta 排除在 ≥3 处生效（canonical 归一化 / 快照过滤 / 复制前过滤）', META_SITES);
  ok(SOURCE.includes('const SKIP_LOCAL_DIR = /^workspace')
    && SOURCE.includes('modify_backup|\\.modify_backup_meta'),
    'G2 SKIP_LOCAL_DIR 只排回滚副本与回滚元数据（比本地整段排除 workspace/sessions 更精细，两者互补）');
  ok((SOURCE.split('SKIP_LOCAL_DIR.test(').length - 1) >= 3,
    'G3 SKIP_LOCAL_DIR 在计字节与快照遍历等多处生效', SOURCE.split('SKIP_LOCAL_DIR.test(').length - 1);
  ok(typeof sync.readSnapshotAsync === 'function' && typeof sync.applySnapshotAsync === 'function',
    'G4 异步读取族已就位（readSnapshotAsync / applySnapshotAsync）');

  // ⚠️ 真正要守的是「本地那 4 条 delta 没有被上游的重写冲掉」—— 冲掉了就静默丢产物排除域。
  ok(SOURCE.includes('const skipPrefixes = new Set((options && options.skipPrefixes) || []);'),
    'G5 delta-2b 仍在：readSnapshot 解析 options.skipPrefixes');
  ok(SOURCE.includes('cache, skipPrefixes: [...skipPrefixes] };'),
    'G6 delta-2d 仍在：快照对象带回 skipPrefixes');
  ok(SOURCE.includes('readSnapshot(snapshot.root, snapshot.id, snapshot.aliases, { skipPrefixes: snapshot.skipPrefixes }'),
    'G7 delta-2e 仍在：unchanged 复检沿用同一 skip 域');
  ok(SOURCE.includes('readSnapshot(target.root, target.id, target.aliases, { skipPrefixes: target.skipPrefixes }'),
    'G8 delta-3 仍在：applySnapshot 发布后复检沿用同一 skip 域');

  // 已知边界（有意为之，不是漏改）：异步孪生没有 skipPrefixes 支持。
  // 本地 daemon 目前只用同步版（D2 事务写入器 + 快照域）⇒ 无行为差异；
  // 将来若把 daemon 切到异步版，必须先给 readSnapshotAsync 补这组 delta。
  ok(/async function readSnapshotAsync\(root, id, aliases = \[\], cache = null\) \{/.test(SOURCE),
    'G9 边界已登记：readSnapshotAsync 不带 options.skipPrefixes（切异步前必须补 delta）');

  fs.rmSync(SANDBOX, { recursive: true, force: true });

  console.log('\n结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
  if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => {
  console.log('\n结果：' + pass + ' 通过 / ' + (failures.length + 1) + ' 失败');
  console.log('  - 未捕获异常: ' + (e && e.stack || e));
  process.exit(1);
});
