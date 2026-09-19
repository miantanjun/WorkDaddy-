'use strict';
/*
 * test-autocopy-conflict-baseline.js —— 会话同步「假冲突 + 自锁」的回归测试（v1.4.1）。
 *
 * 事故（2026-09-19 用户报障「切号后复制同步会话的任务报错」）：
 *   syncAutoCopyLineage 把内容写给**全部**成员，却只给**当前 targetUid** 记 copies 基线
 *   ⇒ 其余成员的基线天然滞后于它们磁盘上的内容 ⇒ 下一次以它们为目标时，
 *   「有几个成员比基线新」（changedSinceBaseline.length >= 2）会把早已同步齐的成员
 *   全部数进去 ⇒ 假冲突；又因冲突分支在写盘之前 return，基线永不前进 ⇒ **永久自锁**。
 *
 *   实测样本（真机）：SubBoost 那条 lineage 三个副本的 jsonl/artifact-index mtime 完全相同、
 *   sha256 也完全相同（b4603d13fb1dc5f4，均 5,779,636 B），却被判冲突；
 *   daemon.log 里 23:00/23:01/23:03 连续 4 次 conflicts=2。
 *
 * 修法（两步，都在 v1.4.1）：
 *   ① 判据的标尺从「当前目标的 copies 基线」改为**血缘级「最近共同快照」时刻**
 *      （lib.js getAutoCopyLineageSyncedAt / setAutoCopyLineageSyncedAt，
 *      成功 fan-out 后由 daemon.js syncAutoCopyLineage 写入）。
 *   ② 判据取的 mtime 从 sessionContentMtime（6 条路径取最大，含 agent 侧
 *      `workspace/sessions/<id>/` 备份/产物）收窄为 sessionBodyMtime（**只看对话正文**
 *      `projects/<proj>/<id>.jsonl`）。真机上第二处假冲突就是这么来的：
 *      某副本 jsonl 仍停在 22:58:44，却因为当场创建测试文件时 WorkBuddy 记的
 *      一个 modify 备份（23:15:05）被判成「这一侧也改过」。
 *
 * 三段：
 *   【A】lib.getAutoCopyLineageSyncedAt / setAutoCopyLineageSyncedAt —— 真实模块 + 临时目录
 *   【B】daemon.syncAutoCopyLineage 切片沙箱 —— 判据行为（不冲突 / 冲突 / 零写入 / 推进标尺）
 *   【C】daemon.sessionBodyMtime —— 正文口径收窄（产物目录被顶到现在不应算「对话变了」）
 *
 * 跑法：node .wd-analysis/test-autocopy-conflict-baseline.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, 'scripts', 'lib.js'));

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function section(t) { console.log('\n' + t); }

const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-conflict-'));
  // ⚠️ 必须写成 version:2 的完整结构：ensureAutoCopyMeta 的守卫要求 version===2 且四个表齐全，
  // 否则会走 v1→v2 迁移，把测试数据当成旧版 rule 结构去解析。
  // ⚠️ 这里**刻意不写 syncedAt** —— 既模拟存量数据，也顺带守住「守卫不被新字段破坏」。
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    accounts: {},
    autoCopy: { version: 2, allSessions: false, sessions: {}, sessionIndex: {}, workspaces: {}, copies: {}, suppressed: {} },
  }, null, 2));
  return dir;
}
function readMeta(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); }
function writeMeta(dir, meta) { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2)); }
const copyKey = (lineageId, uid) => JSON.stringify([lineageId, uid]);

/* ==================================================================== */
/* 【A】lib 层：血缘级 watermark 读写                                    */
/* ==================================================================== */

section('[A] lib.getAutoCopyLineageSyncedAt / setAutoCopyLineageSyncedAt');

const dirA = freshDataDir();
const metaA = readMeta(dirA);
metaA.autoCopy.sessions.L1 = { enabled: true, createdAt: 1, members: [{ uid: 'UA', id: 's1' }] };
metaA.autoCopy.sessionIndex = { UA: { s1: 'L1' } };
metaA.autoCopy.copies = { [copyKey('L1', 'UZ')]: { targetId: 'tz', status: 'copied', updatedAt: 1000 } };
metaA.autoCopy.suppressed = { [copyKey('L1', 'UZ')]: { reason: 'local-delete' } };
writeMeta(dirA, metaA);

ok(lib.getAutoCopyLineageSyncedAt(dirA, 'L1') === 1000,
  'A1 无显式 watermark 时回退到该血缘 copies 基线（存量数据）', lib.getAutoCopyLineageSyncedAt(dirA, 'L1'));
ok(lib.getAutoCopyLineageSyncedAt(dirA, 'NOPE') === 0, 'A2 未知 lineage → 0（不抛）');

const wrote = lib.setAutoCopyLineageSyncedAt(dirA, 'L1', 123456789);
ok(wrote === 123456789 && lib.getAutoCopyLineageSyncedAt(dirA, 'L1') === 123456789,
  'A3 set 后可原值读回', { wrote, back: lib.getAutoCopyLineageSyncedAt(dirA, 'L1') });

const metaA2 = readMeta(dirA);
ok(metaA2.autoCopy.sessions.L1 && metaA2.autoCopy.sessionIndex.UA.s1 === 'L1',
  'A4 写 watermark 不动 sessions / sessionIndex', Object.keys(metaA2.autoCopy.sessions));
ok(metaA2.autoCopy.copies[copyKey('L1', 'UZ')] && metaA2.autoCopy.copies[copyKey('L1', 'UZ')].updatedAt === 1000,
  'A5 写 watermark 不动 copies 基线');
ok(metaA2.autoCopy.suppressed[copyKey('L1', 'UZ')],
  'A6 写 watermark 不动 suppressed 抑制表');

const beforeSkip = fs.readFileSync(path.join(dirA, 'meta.json'), 'utf8');
const skipped = lib.setAutoCopyLineageSyncedAt(dirA, '', 999);
ok(skipped === 0 && fs.readFileSync(path.join(dirA, 'meta.json'), 'utf8') === beforeSkip,
  'A7 lineageId 为空 → 返回 0 且**不改盘**');

const t0 = Date.now();
const auto = lib.setAutoCopyLineageSyncedAt(dirA, 'L2');
ok(auto > 0 && auto >= t0 - 5000 && auto <= Date.now() + 5000,
  'A8 省略 at → 用当前时刻（不是 0）', auto);

const dirB = freshDataDir();
const metaB = readMeta(dirB);
metaB.autoCopy.sessions.L1 = { enabled: true, createdAt: 1, members: [{ uid: 'UA', id: 's1' }] };
metaB.autoCopy.sessionIndex = { UA: { s1: 'L1' } };
metaB.autoCopy.copies = {
  [copyKey('L1', 'UZ')]: { targetId: 'tz', status: 'copied', updatedAt: 1000 },
  [copyKey('L1', 'UX')]: { targetId: 'tx', status: 'copied', updatedAt: 6000 },
  [copyKey('L9', 'UZ')]: { targetId: 't9', status: 'copied', updatedAt: 99999 },
};
writeMeta(dirB, metaB);
ok(lib.getAutoCopyLineageSyncedAt(dirB, 'L1') === 6000,
  'A9 回退取**本血缘所有目标**里最近的 updatedAt（不是当前目标那个、也不含别的血缘）',
  lib.getAutoCopyLineageSyncedAt(dirB, 'L1'));

lib.setAutoCopyLineageSyncedAt(dirB, 'L1', 12345);
ok(lib.getAutoCopyLineageSyncedAt(dirB, 'L1') === 12345,
  'A10 显式 watermark 优先于 copies 基线（即使基线更大也不覆盖它）',
  lib.getAutoCopyLineageSyncedAt(dirB, 'L1'));

// 存量 meta（v2 结构、无 syncedAt）：ensureAutoCopyMeta 必须只补字段、不能被守卫挡下去走 v1→v2 迁移
const dirC = freshDataDir();
const metaC = readMeta(dirC);
metaC.autoCopy.sessions.L1 = { enabled: true, createdAt: 1, members: [{ uid: 'UA', id: 's1' }] };
metaC.autoCopy.sessionIndex = { UA: { s1: 'L1' } };
writeMeta(dirC, metaC);
let threw = '';
let gotC = -1;
try { gotC = lib.getAutoCopyLineageSyncedAt(dirC, 'L1'); } catch (e) { threw = String(e && e.message); }
const cfgC = lib.readAutoCopyConfig(dirC);
ok(!threw && gotC === 0, 'A11 存量 meta 缺 syncedAt → 不抛错、当作 0', { threw, gotC });
ok(cfgC.sessions.L1 && cfgC.sessionIndex.UA.s1 === 'L1',
  'A12 守卫没被新字段破坏：v2 结构未被当成 v1 迁移（没造出 sessionId="enabled" 的伪 lineage）',
  Object.keys(cfgC.sessions));
ok(cfgC.syncedAt && typeof cfgC.syncedAt === 'object' && !Array.isArray(cfgC.syncedAt),
  'A13 readAutoCopyConfig 的投影里有 syncedAt（否则 daemon 取不到）', cfgC.syncedAt);
ok(typeof lib.getAutoCopyLineageSyncedAt === 'function' && typeof lib.setAutoCopyLineageSyncedAt === 'function',
  'A14 两个函数都已导出');

/* ==================================================================== */
/* 【B】daemon.syncAutoCopyLineage 切片沙箱                              */
/* ==================================================================== */

section('\n[B] syncAutoCopyLineage 的冲突判据（切片沙箱真跑）');

const START = 'async function syncAutoCopyLineage';
const END = '/* ---------------- 会话删除的唯一实现';
const sIdx = daemonSrc.indexOf(START);
const eIdx = daemonSrc.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) {
  console.log('  FAIL B0 找不到切片锚点（syncAutoCopyLineage 或会话删除注释）');
  process.exit(1);
}
const SLICE = daemonSrc.slice(sIdx, eIdx);
ok(SLICE.indexOf('getAutoCopyLineageSyncedAt(') >= 0 && SLICE.indexOf('setAutoCopyLineageSyncedAt(') >= 0,
  'B0 切出片段且含血缘级 watermark 的读写（' + SLICE.split('\n').length + ' 行）');
ok(daemonSrc.indexOf('const baselineAt = Number(targetMapping && targetMapping.updatedAt) || 0;') < 0,
  'B1 旧标尺（直接用当前目标的 copies 基线）已不再作为唯一判据');

/**
 * cfg = { watermark, copies:[{uid,updatedAt}], members:[{uid,id,mtime}], failedFiles }
 * members 必须含一个 uid === targetUid 的成员，否则走的是「目标不在血缘里」的另分支。
 */
function makeHarness(cfg) {
  const dir = freshDataDir();
  const meta = readMeta(dir);
  for (const c of (cfg.copies || [])) {
    meta.autoCopy.copies[copyKey('L1', c.uid)] = { targetId: 't-' + c.uid, status: 'copied', updatedAt: c.updatedAt };
  }
  if (cfg.watermark) meta.autoCopy.syncedAt = { L1: cfg.watermark };
  writeMeta(dir, meta);

  const world = { copyCalls: [], setSyncedAtCalls: [], setMappingCalls: [], runs: [], logs: [] };
  const rowsById = {};
  const mtimeById = {};
  for (const m of cfg.members) {
    rowsById[m.id] = {
      id: m.id, user_id: m.uid, title: 'T-' + m.id, custom_title: '',
      updated_at: m.mtime, last_activity_at: m.mtime,
    };
    mtimeById[m.id] = m.mtime;
  }

  const factory = new Function(
    'PROFILE', 'DATA_DIR',
    'getAutoCopySessionMemberRecords', 'getAutoCopyMapping',
    'getAutoCopyLineageSyncedAt', 'setAutoCopyLineageSyncedAt',
    'SESSION_COPY_COLUMNS', 'sqliteQuery', 'sessionBodyMtime',
    'selectLatestAutoCopyMember', 'copySessionFiles', 'sqliteRun',
    'setAutoCopyMapping', 'yieldAutoCopyToRenderer', 'log',
    SLICE + '\nreturn { syncAutoCopyLineage };'
  );
  const fn = factory(
    { kind: 'workbuddy', dataRoot: dir },
    dir,
    () => cfg.members.map((m) => ({ uid: m.uid, id: m.id })),
    () => null,
    (d, lid) => lib.getAutoCopyLineageSyncedAt(d, lid),
    (d, lid, at) => { world.setSyncedAtCalls.push([lid, at]); return lib.setAutoCopyLineageSyncedAt(d, lid, at); },
    ['id', 'user_id', 'title', 'custom_title', 'updated_at', 'last_activity_at'],
    async (_sql, params) => (rowsById[params[0]] ? [rowsById[params[0]]] : []),
    (_root, id) => Number(mtimeById[id]) || 0,
    lib.selectLatestAutoCopyMember,
    async (_root, srcId, dstId) => {
      world.copyCalls.push([srcId, dstId]);
      return { copied: 1, failed: cfg.failedFiles || 0, workspacePending: false };
    },
    async () => { world.runs.push(1); },
    (d, lid, tUid, mapping) => { world.setMappingCalls.push([lid, tUid, mapping && mapping.status]); return mapping; },
    async () => {},
    (m) => world.logs.push(String(m))
  ).syncAutoCopyLineage;

  return {
    dir, world,
    run: () => fn('L1', cfg.targetUid),
    watermark: () => lib.getAutoCopyLineageSyncedAt(dir, 'L1'),
  };
}

// ⚠️ 下面有顶层 await → 必须包进 async 函数：CommonJS 里 require + 顶层 await 会报
// ERR_AMBIGUOUS_MODULE_SYNTAX（test-lineage-dedupe.js 第 19 行就栽过）。
async function main() {
// ── B2/B3：存量假冲突自愈（真机 SubBoost 的形态）─────────────────────────
// 三份内容完全相同（mtime 全等 4000），当前目标 UZ 的基线停在 1000（旧逻辑必误报），
// 但同一血缘里 UX 的基线是 6000 ⇒ 取 max 后「0 个成员比基线新」⇒ 不再冲突。
const hSelfHeal = makeHarness({
  targetUid: 'UZ',
  copies: [{ uid: 'UZ', updatedAt: 1000 }, { uid: 'UX', updatedAt: 6000 }],
  members: [
    { uid: 'UX', id: 'a1', mtime: 4000 },
    { uid: 'UY', id: 'a2', mtime: 4000 },
    { uid: 'UZ', id: 'a3', mtime: 4000 },
  ],
});
const rSelfHeal = await hSelfHeal.run();
ok(rSelfHeal && rSelfHeal.conflict !== true,
  'B2 三份内容相同 + 当前目标基线滞后 ⇒ **不再假冲突**（旧判据：3 个成员都比 1000 新 ⇒ 冲突）', rSelfHeal);
ok(hSelfHeal.world.copyCalls.length === 0 && rSelfHeal.unchanged === true,
  'B3 且正确走「无需同步」分支（不重复搬一遍）', rSelfHeal);

// ── B4/B5/B6：只有一侧变化 → 正常下发，不当冲突 ──────────────────────────
const hOneSide = makeHarness({
  targetUid: 'UZ',
  watermark: 3000,
  members: [
    { uid: 'UX', id: 'b1', mtime: 5000 },
    { uid: 'UY', id: 'b2', mtime: 2000 },
    { uid: 'UZ', id: 'b3', mtime: 2000 },
  ],
});
const rOneSide = await hOneSide.run();
ok(rOneSide && rOneSide.conflict !== true, 'B4 只有 1 个成员变化 ⇒ 不判冲突', rOneSide);
ok(hOneSide.world.copyCalls.length === 3 && hOneSide.world.copyCalls[0][0] === 'b1' && hOneSide.world.copyCalls[0][1] === 'b1',
  'B5 以「变化的那一份」为源向全部成员 fan-out（含自身修复副本）', hOneSide.world.copyCalls);
ok(hOneSide.world.setSyncedAtCalls.length === 1 && hOneSide.watermark() > 0,
  'B6 fan-out 成功后推进血缘级 watermark（下次判据以它为准）',
  { calls: hOneSide.world.setSyncedAtCalls, watermark: hOneSide.watermark() });

// ── B7/B8/B9：两侧都变化 → 冲突，且零写入、不推进标尺 ─────────────────────
const hConflict = makeHarness({
  targetUid: 'UZ',
  watermark: 3000,
  members: [
    { uid: 'UX', id: 'c1', mtime: 5000 },
    { uid: 'UY', id: 'c2', mtime: 4000 },
    { uid: 'UZ', id: 'c3', mtime: 2000 },
  ],
});
const rConflict = await hConflict.run();
ok(rConflict && rConflict.conflict === true && rConflict.conflicts === 1,
  'B7 两个成员各自都变了 ⇒ 判冲突（这道闸门必须保留，它是防覆盖的保护）', rConflict);
ok(hConflict.world.copyCalls.length === 0,
  'B8 冲突时**零写入**：一次 copySessionFiles 都没发生（两边都不覆盖）', hConflict.world.copyCalls);
ok(hConflict.world.setSyncedAtCalls.length === 0 && hConflict.watermark() === 3000,
  'B9 冲突时不推进 watermark —— 否则下一次判据会偏松（反向守卫）', hConflict.watermark());

// ── B10：有失败文件时不推进标尺（成员并未全部对齐）────────────────────────
const hFail = makeHarness({
  targetUid: 'UZ',
  watermark: 3000,
  failedFiles: 2,
  members: [
    { uid: 'UX', id: 'd1', mtime: 5000 },
    { uid: 'UY', id: 'd2', mtime: 2000 },
    { uid: 'UZ', id: 'd3', mtime: 2000 },
  ],
});
const rFail = await hFail.run();
ok(hFail.world.copyCalls.length === 3 && hFail.world.setSyncedAtCalls.length === 0 && hFail.watermark() === 3000,
  'B10 有失败文件 ⇒ 不推进 watermark（判据不能偏松）',
  { copies: hFail.world.copyCalls.length, pushed: hFail.world.setSyncedAtCalls.length });

/* ==================================================================== */
/* 【C】sessionBodyMtime：判据只看对话正文（A′ 收窄）                    */
/* ==================================================================== */

section('\n[C] sessionBodyMtime 只认 projects/<proj>/<id>.jsonl');

const C_START = 'function sessionBodyMtime';
// ⚠️ END 必须连注释起始一起截，否则片段尾部留下未闭合的 `/**` → new Function 直接 SyntaxError。
const C_END = '/**\n * 统计一个文件/目录的字节数与文件数';
const cIdx = daemonSrc.indexOf(C_START);
const cEnd = daemonSrc.indexOf(C_END, cIdx);
const SLICE2 = cIdx >= 0 && cEnd > cIdx ? daemonSrc.slice(cIdx, cEnd) : '';
ok(SLICE2.indexOf('function sessionContentMtime') > 0,
  'C0 切出 mtime 取值函数（新旧两个都在，便于对照）');
const mtimeFn = new Function('fs', 'path', SLICE2 + '\nreturn { sessionBodyMtime, sessionContentMtime };')(fs, path);

const WB = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-wb-'));
const SID = 'sess-1';
const OLD = 1700000000000;
const NEW = 1700009999000;
fs.mkdirSync(path.join(WB, 'projects', 'projA'), { recursive: true });
fs.writeFileSync(path.join(WB, 'projects', 'projA', SID + '.jsonl'), '{}\n');
fs.utimesSync(path.join(WB, 'projects', 'projA', SID + '.jsonl'), new Date(OLD), new Date(OLD));
// 产物目录比正文新（模拟 WorkBuddy 记 modify 备份 —— 真机上就是这么误报的）
fs.mkdirSync(path.join(WB, 'workspace', 'sessions', SID, '.modify_backup_meta'), { recursive: true });
fs.writeFileSync(path.join(WB, 'workspace', 'sessions', SID, '.modify_backup_meta', 'h1.test.js'), 'x');
fs.utimesSync(path.join(WB, 'workspace', 'sessions', SID, '.modify_backup_meta', 'h1.test.js'), new Date(NEW), new Date(NEW));

ok(mtimeFn.sessionBodyMtime(WB, SID) === OLD,
  'C1 产物目录被顶到现在 ⇒ 正文 mtime **不受影响**（这就是假冲突的来源被切断）',
  mtimeFn.sessionBodyMtime(WB, SID));
ok(mtimeFn.sessionContentMtime(WB, SID) === NEW,
  'C1b 反证：sessionContentMtime 确实会被产物目录顶到 NEW ⇒ 两个函数行为真的不同，收窄不是空操作');

fs.writeFileSync(path.join(WB, 'projects', 'projA', SID + '.jsonl'), '{}\n{}\n');
fs.utimesSync(path.join(WB, 'projects', 'projA', SID + '.jsonl'), new Date(NEW), new Date(NEW));
ok(mtimeFn.sessionBodyMtime(WB, SID) === NEW, 'C2 正文自己变了 ⇒ 照样看得见（没把真变化一起滤掉）');

fs.mkdirSync(path.join(WB, 'projects', 'projB'), { recursive: true });
fs.writeFileSync(path.join(WB, 'projects', 'projB', SID + '.jsonl'), '{}\n');
const NEWEST = NEW + 5000;
fs.utimesSync(path.join(WB, 'projects', 'projB', SID + '.jsonl'), new Date(NEWEST), new Date(NEWEST));
ok(mtimeFn.sessionBodyMtime(WB, SID) === NEWEST,
  'C3 同一会话挂在多个项目目录下 ⇒ 取最新的那份正文', mtimeFn.sessionBodyMtime(WB, SID));

ok(mtimeFn.sessionBodyMtime(WB, 'no-such-session') === 0, 'C4 会话不存在 → 0');
ok(mtimeFn.sessionBodyMtime(WB, '') === 0, 'C5 空 id → 0');
ok(mtimeFn.sessionBodyMtime(path.join(WB, 'nowhere'), SID) === 0, 'C6 工作目录不存在 → 0（不抛）');

const WB2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-wb2-'));
fs.mkdirSync(path.join(WB2, 'projects', 'p', 'sess-2'), { recursive: true });
fs.writeFileSync(path.join(WB2, 'projects', 'p', 'sess-2', 'tool-results.txt'), 'x');
ok(mtimeFn.sessionBodyMtime(WB2, 'sess-2') === 0 && mtimeFn.sessionContentMtime(WB2, 'sess-2') > 0,
  'C7 只有 <id>/ 目录、没有 jsonl ⇒ 正文判据返回 0（旧实现会返回非 0）',
  { body: mtimeFn.sessionBodyMtime(WB2, 'sess-2'), content: mtimeFn.sessionContentMtime(WB2, 'sess-2') });

ok(/contentMtime: sessionBodyMtime\(PROFILE\.dataRoot, member\.id\)/.test(daemonSrc),
  'C8 源码守卫：判据的成员 mtime 确实取自 sessionBodyMtime（防回退到宽信号）');

console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
failures.forEach((name) => console.log('  未通过: ' + name));
process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
