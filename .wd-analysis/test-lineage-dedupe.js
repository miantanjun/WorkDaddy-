'use strict';
/*
 * test-lineage-dedupe.js —— 「切号复制产生重复副本」的回归测试。
 *
 * 事故（2026-09-15）：normalizeAutoCopyLineages 把「同一账号在同一 lineage 里出现两个成员」
 * 拆成一条**新 lineage** 并改写 sessionIndex → 源账号那份会话变成孤立 lineage →
 * 下次切号复制时目标账号看不到对应成员 → copySessionRecord **新建**副本 →
 * 主账号里 28 个会话全部出现第二份。
 *
 * 四段：
 *   【A】lib.normalizeAutoCopyLineages —— 只检测、绝不拆 lineage / 绝不改写 index
 *   【B】lib.mergeAutoCopyLineages —— 成员/index/copies 三处一起搬，再删旧 lineage
 *   【C】daemon.adoptExistingCopyTarget —— 「同 uid + 同 created_at」的已登记副本也要认领并合血缘
 *   【D】daemon /api/sessions/purge-copy —— 只删这一份、不级联、不写抑制（源码 + 真机校验分支）
 *
 * 跑法：node .wd-analysis/test-lineage-dedupe.js
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

/* ==================================================================== */
/* 【A】normalize：只检测，不拆                                          */
/* ==================================================================== */

section('[A] normalizeAutoCopyLineages 只检测、不拆 lineage');

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-lineage-'));
  // ⚠️ 必须写成 version:2 的完整结构：ensureAutoCopyMeta 的守卫要求 version===2 且四个表齐全，
  // 否则会走 v1→v2 迁移，把测试数据当成旧版 rule 结构去解析（第一批断言就是这么挂的）。
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    accounts: {},
    autoCopy: { version: 2, allSessions: false, sessions: {}, sessionIndex: {}, workspaces: {}, copies: {}, suppressed: {} },
  }, null, 2));
  return dir;
}
function readMeta(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); }
function writeMeta(dir, meta) { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2)); }

const dirA = freshDataDir();
const metaA = readMeta(dirA);
metaA.autoCopy.sessions.L1 = { enabled: true, createdAt: 1, members: [{ uid: 'UA', id: 's1' }, { uid: 'UB', id: 't1' }, { uid: 'UA', id: 's1dup' }] };
metaA.autoCopy.sessionIndex = { UA: { s1: 'L1', s1dup: 'L1' }, UB: { t1: 'L1' } };
metaA.autoCopy.copies = {};
writeMeta(dirA, metaA);

const detected = lib.normalizeAutoCopyLineages(dirA);
const metaA2 = readMeta(dirA);
ok(Object.keys(metaA2.autoCopy.sessions).length === 1, 'A1 没有新建任何 lineage（老实现会拆出一条新的）', Object.keys(metaA2.autoCopy.sessions));
ok(metaA2.autoCopy.sessionIndex.UA.s1 === 'L1' && metaA2.autoCopy.sessionIndex.UA.s1dup === 'L1',
  'A2 index 一条都不改写（老实现会把重复那条指向新 lineage，这才是重复复制的起点）', metaA2.autoCopy.sessionIndex.UA);
ok(Array.isArray(metaA2.autoCopy.duplicates) && metaA2.autoCopy.duplicates.length === 1 &&
  metaA2.autoCopy.duplicates[0].uid === 'UA' && metaA2.autoCopy.duplicates[0].id === 's1dup',
  'A3 把「同账号多成员」记进 duplicates 供告警/清理', metaA2.autoCopy.duplicates);
ok(detected === true, 'A4 检测到异常时返回 true');

const again = lib.normalizeAutoCopyLineages(dirA);
ok(again === false, 'A5 重复调用是幂等的（内容没变就不写盘）');

const dirClean = freshDataDir();
const metaClean = readMeta(dirClean);
metaClean.autoCopy.sessions.L2 = { enabled: true, createdAt: 1, members: [{ uid: 'UA', id: 'x1' }, { uid: 'UB', id: 'y1' }] };
writeMeta(dirClean, metaClean);
ok(lib.normalizeAutoCopyLineages(dirClean) === false, 'A6 干净的登记表不动它（返回 false）');

/* ==================================================================== */
/* 【B】merge：三处一起搬                                               */
/* ==================================================================== */

section('\n[B] mergeAutoCopyLineages 合并血缘');

const dirB = freshDataDir();
const metaB = readMeta(dirB);
metaB.autoCopy.sessions = {
  KEEP: { enabled: true, createdAt: 1, members: [{ uid: 'U1', id: 'k1' }] },
  FROM: { enabled: true, createdAt: 2, members: [{ uid: 'U1', id: 'dup1' }, { uid: 'U2', id: 'f2' }, { uid: 'U3', id: 'f3' }] },
};
metaB.autoCopy.sessionIndex = { U1: { k1: 'KEEP', dup1: 'FROM' }, U2: { f2: 'FROM' }, U3: { f3: 'FROM' } };
metaB.autoCopy.copies = {
  [JSON.stringify(['KEEP', 'U1'])]: { targetId: 'k1', status: 'copied' },
  [JSON.stringify(['FROM', 'U2'])]: { targetId: 'f2', status: 'copied' },
  [JSON.stringify(['FROM', 'U1'])]: { targetId: 'dup1', status: 'copied' },
};
writeMeta(dirB, metaB);

const merged = lib.mergeAutoCopyLineages(dirB, 'FROM', 'KEEP');
const metaB2 = readMeta(dirB);
ok(merged.ok === true, 'B1 合并成功', merged);
ok(metaB2.autoCopy.sessions.FROM === undefined, 'B2 FROM 已删除');
ok(metaB2.autoCopy.sessions.KEEP.members.length === 3, 'B3 U2/U3 并进来（共 3 个成员），U1 的重复成员被跳过', metaB2.autoCopy.sessions.KEEP.members);
ok(metaB2.autoCopy.sessions.KEEP.members.some((m) => m.uid === 'U2' && m.id === 'f2'), 'B4 U2 的成员已并入');
ok(merged.skippedMembers === 1 && merged.movedMembers === 2, 'B5 跳过 1 个（U1 已有成员）、搬入 2 个', merged);
ok(metaB2.autoCopy.sessionIndex.U2.f2 === 'KEEP' && metaB2.autoCopy.sessionIndex.U3.f3 === 'KEEP' && metaB2.autoCopy.sessionIndex.U1.dup1 === 'KEEP',
  'B6 指向 FROM 的 index 全部改指 KEEP（否则 index 悬空 → 下次复制又新建）', metaB2.autoCopy.sessionIndex);
ok(metaB2.autoCopy.copies[JSON.stringify(['KEEP', 'U2'])].targetId === 'f2', 'B7 copies 登记跟着搬过来');
ok(metaB2.autoCopy.copies[JSON.stringify(['FROM', 'U2'])] === undefined, 'B8 FROM 的旧登记已清掉');
ok(metaB2.autoCopy.copies[JSON.stringify(['KEEP', 'U1'])].targetId === 'k1',
  'B9 KEEP 已有同账号登记时保留 KEEP 的（不被 FROM 的覆盖）', metaB2.autoCopy.copies[JSON.stringify(['KEEP', 'U1'])]);

const bad = lib.mergeAutoCopyLineages(dirB, 'NOPE', 'KEEP');
ok(bad.ok === false, 'B10 源 lineage 不存在 → 不报错、返回 ok:false', bad);

/* ==================================================================== */
/* 【C】daemon 认领：已登记在另一条 lineage 的副本也要认领               */
/* ==================================================================== */

// ⚠️ C/D 段有顶层 await → 必须包进 async 函数：CommonJS 里 require + 顶层 await 会报
// ERR_AMBIGUOUS_MODULE_SYNTAX（本文件第 19 行就栽过）
async function main() {
section('\n[C] adoptExistingCopyTarget（切片沙箱）');

const START = 'async function adoptExistingCopyTarget';
const END = 'async function copySessionRecord';
const sIdx = daemonSrc.indexOf(START);
const eIdx = daemonSrc.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) { console.log('  FAIL C0 找不到切片锚点'); process.exit(1); }
const block = daemonSrc.slice(sIdx, eIdx);
ok(block.indexOf('merge-lineage') >= 0, 'C0 切出认领代码块（' + block.split('\n').length + ' 行）');

const world = { rows: [], allLineages: {}, merges: [], logs: [] };
const factory = new Function(
  'sqliteQuery', 'getAutoCopyRules', 'mergeAutoCopyLineages', 'log', 'DATA_DIR',
  block + '\nreturn { adoptExistingCopyTarget };'
);
const adopt = factory(
  async () => world.rows,
  () => ({ allLineages: world.allLineages }),
  (_dir, from, into) => { world.merges.push([from, into]); return { ok: true, movedMembers: 1, movedIndex: 1, movedCopies: 1 }; },
  (m) => world.logs.push(String(m)),
  '/fake'
).adoptExistingCopyTarget;

const SRC = { id: 'src1', created_at: 1789000000000 };

world.rows = []; world.allLineages = {}; world.merges = [];
ok((await adopt(SRC, 'UB', 'L_new')) === null, 'C1 目标账号里没有同源会话 → 返回 null（照常新建）');

world.rows = [{ id: 'orphan1' }]; world.allLineages = {};
let r = await adopt(SRC, 'UB', 'L_new');
ok(r && r.targetId === 'orphan1' && r.adopted === 'orphan', 'C2 未登记的同源副本 → 直接认领', r);

world.rows = [{ id: 'claimed1' }]; world.allLineages = { claimed1: 'L_old' }; world.merges = [];
r = await adopt(SRC, 'UB', 'L_new');
ok(r && r.targetId === 'claimed1' && r.adopted === 'merge-lineage', 'C3 已登记在另一条 lineage → 认领并合血缘（老实现这一步直接漏掉，才会新建副本）', r);
ok(world.merges.length === 1 && world.merges[0][0] === 'L_new' && world.merges[0][1] === 'L_old',
  'C4 合并方向：把「当前这条」并进「已存在的那条」（不是反过来）', world.merges);
ok(r.lineageId === 'L_old', 'C5 返回生效的 lineage 是合并后的那条（调用方据此写登记）', r.lineageId);

world.rows = [{ id: 'src1' }]; world.allLineages = { src1: 'L_old' };
ok((await adopt(SRC, 'UB', 'L_new')) === null, 'C6 只匹配到源会话自己 → 不算（id 相同跳过）');

world.rows = [{ id: 'claimed1' }]; world.allLineages = { claimed1: 'L_new' }; world.merges = [];
r = await adopt(SRC, 'UB', 'L_new');
ok(r === null, 'C7 登记就在当前 lineage 上 → 交给前面的成员分支处理，这里不重复认领', r);

world.rows = [{ id: 'claimed1' }]; world.allLineages = { claimed1: 'L_old' };
r = await adopt({ id: 'src1', created_at: 0 }, 'UB', 'L_new');
ok(r === null, 'C8 源会话没有 created_at（拿不到指纹）→ 不认领，走新建', r);

/* ==================================================================== */
/* 【D】purge-copy：只删这一份                                          */
/* ==================================================================== */

section('\n[D] /api/sessions/purge-copy 端点');

const ep = (() => {
  const i = daemonSrc.indexOf("p === '/api/sessions/purge-copy'");
  const j = daemonSrc.indexOf("p === '/api/sessions/delete'", i);
  return i >= 0 && j > i ? daemonSrc.slice(i, j) : '';
})();
ok(ep.length > 0, 'D1 端点存在');
ok(ep.indexOf('deleteSessionFiles(PROFILE.dataRoot, id)') >= 0, 'D2 复用官方 deleteSessionFiles（含 app/sessions.json 应用缓存）');
ok(ep.indexOf('DELETE FROM sessions WHERE id = ?') >= 0, 'D3 删掉那一行');
ok(ep.indexOf('resolveSessionDeletePlan') < 0, 'D4 **不走**级联删除计划 —— 主账号上的重复副本绝不能级联（会连源会话一起删）');
ok(ep.indexOf('setAutoCopySuppression') < 0, 'D5 不写抑制标记（同 lineage 的保留副本还要继续同步）');
ok(ep.indexOf('removeAutoCopySessionMember(DATA_DIR, lineageId, ownerUid, id)') >= 0, 'D6 只摘掉这一份的成员登记');
ok(ep.indexOf("expectUid && ownerUid !== expectUid") >= 0, 'D7 归属账号不匹配时拒绝（防误删）');

// 真机校验分支（带令牌打 daemon）在 test-sync-pause.js 的 D 段（那边有 apiCall + 令牌）

console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
failures.forEach((name) => console.log('  未通过: ' + name));
process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
