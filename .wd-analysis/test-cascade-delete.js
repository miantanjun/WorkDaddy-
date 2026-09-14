'use strict';
/*
 * test-cascade-delete.js —— 单向级联删除的方向判定与抑制登记测试。
 *
 * 需求（用户定义，唯一权威）：
 *   · 在主账号中删除会话 → 所有其他账号中对应的同一会话一并删除（向下级联）
 *   · 在任意非主账号中删除会话 → 主账号中的对应会话必须保留、不受任何影响
 *   · 不能出现反向删除或误删
 *
 * 被测对象都在 lib.js 里，可以直接 require（不像 daemon.js 那样 require 即起服务）：
 *   resolveSessionDeletePlan / collectLineageMembersForDelete /
 *   setAutoCopySuppression / clearAutoCopySuppression / clearLineageSuppressions /
 *   isAutoCopySuppressed / isAutoCopySuppressedForTarget / getSuppressedLineagesForTarget /
 *   ensureAutoCopyMeta（经 readAutoCopyConfig 间接验证）
 *
 * 全部在 fs.mkdtempSync 的临时 dataDir 上跑，不碰真实 meta.json。
 *
 * 跑法：node .wd-analysis/test-cascade-delete.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const lib = require(path.join(__dirname, '..', 'scripts', 'lib.js'));

/* ---------------- 夹具 ---------------- */
const P = 'uid-primary';   // 主账号
const N1 = 'uid-n1';       // 非主账号
const N2 = 'uid-n2';       // 非主账号

const L1 = 'lin-1';        // P + N1 + N2 三账号共享（会话 sP / sN1 / sN2）
const L2 = 'lin-2';        // 只有 N1（原始版本落在非主账号里）
const L3 = 'lin-3';        // 只有 P

const sP = 'sess-p';
const sN1 = 'sess-n1';
const sN2 = 'sess-n2';
const sOnlyN1 = 'sess-only-n1';
const sOnlyP = 'sess-only-p';

function buildMeta() {
  return {
    accounts: {},
    autoCopy: {
      version: 2,
      allSessions: false,
      sessions: {
        [L1]: { enabled: true, members: [{ uid: P, id: sP }, { uid: N1, id: sN1 }, { uid: N2, id: sN2 }], createdAt: 1 },
        [L2]: { enabled: true, members: [{ uid: N1, id: sOnlyN1 }], createdAt: 2 },
        [L3]: { enabled: true, members: [{ uid: P, id: sOnlyP }], createdAt: 3 },
      },
      sessionIndex: {
        [P]: { [sP]: L1, [sOnlyP]: L3 },
        [N1]: { [sN1]: L1, [sOnlyN1]: L2 },
        [N2]: { [sN2]: L1 },
      },
      workspaces: {},
      copies: {
        [JSON.stringify([L1, N1])]: { targetId: sN1, status: 'copied' },
        [JSON.stringify([L1, N2])]: { targetId: sN2, status: 'copied' },
      },
      suppressed: {},
    },
  };
}

let dataDir = null;
function resetDataDir(metaOverride) {
  if (dataDir) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cascade-'));
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(metaOverride || buildMeta(), null, 2));
  return dataDir;
}
const readRawMeta = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
const row = (id, uid) => ({ id, user_id: uid });

/* ---------------- 脚手架 ---------------- */
let pass = 0;
const failures = [];
function check(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}
const sorted = (list) => (Array.isArray(list) ? list.slice().sort() : list);

try {
  console.log('单向级联删除测试\n');

  /* ---------- T1 主账号删除 → 向下级联 ---------- */
  console.log('T1 主账号删除 → 级联到所有账号');
  resetDataDir();
  let plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sP], rows: [row(sP, P)], primaryUid: P });
  check(plan.mode === 'cascade', 'T1a mode=cascade', plan.mode);
  check(plan.reason === 'requested-includes-primary', 'T1b reason=requested-includes-primary', plan.reason);
  check(JSON.stringify(sorted(plan.deleteIds)) === JSON.stringify(sorted([sP, sN1, sN2])),
    'T1c 删除集合 = 三账号的三份副本', sorted(plan.deleteIds));
  check(plan.suppressions.length === 0, 'T1d 级联路径不登记抑制（整条 lineage 都没了）', plan.suppressions);
  check(plan.lineageIds.includes(L1), 'T1e 带出涉及的 lineageId（供清理抑制）', plan.lineageIds);

  /* ---------- T2 非主账号删除 → 只删自己，主账号保留 ---------- */
  console.log('T2 非主账号删除 → 主账号不受影响');
  resetDataDir();
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sN1], rows: [row(sN1, N1)], primaryUid: P });
  check(plan.mode === 'local', 'T2a mode=local', plan.mode);
  check(plan.reason === 'requested-not-primary', 'T2b reason=requested-not-primary', plan.reason);
  check(JSON.stringify(plan.deleteIds) === JSON.stringify([sN1]), 'T2c 只删请求的那一份', plan.deleteIds);
  check(!plan.deleteIds.includes(sP), 'T2d ★ 主账号会话 sP 不在删除集合里', plan.deleteIds);
  check(!plan.deleteIds.includes(sN2), 'T2e 其它账号 sN2 也不受影响', plan.deleteIds);
  check(plan.suppressions.length === 1 && plan.suppressions[0].lineageId === L1 && plan.suppressions[0].uid === N1,
    'T2f 登记一个抑制 (L1, N1)', plan.suppressions);

  /* ---------- T3 未设置主账号 → 保守按 local ---------- */
  console.log('T3 未设置主账号');
  resetDataDir();
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sP], rows: [row(sP, P)], primaryUid: '' });
  check(plan.mode === 'local', 'T3a mode=local（宁可少删，绝不误删）', plan.mode);
  check(plan.reason === 'no-primary-account', 'T3b reason=no-primary-account', plan.reason);
  check(JSON.stringify(plan.deleteIds) === JSON.stringify([sP]), 'T3c 只删请求的那一份', plan.deleteIds);

  /* ---------- T4 混合选择（含主账号）→ 级联 ---------- */
  console.log('T4 选择里含主账号会话');
  resetDataDir();
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sN1, sP], rows: [row(sN1, N1), row(sP, P)], primaryUid: P });
  check(plan.mode === 'cascade', 'T4a 只要命中主账号就走级联', plan.mode);
  check(plan.deleteIds.indexOf(sN2) >= 0, 'T4b 级联集合包含 sN2', plan.deleteIds);

  /* ---------- T5 显式 mode 覆盖 ---------- */
  console.log('T5 显式 mode 覆盖');
  resetDataDir();
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sP], rows: [row(sP, P)], primaryUid: P, mode: 'local' });
  check(plan.mode === 'local' && plan.reason === 'forced-local', 'T5a mode=local 时主账号删除也不级联', plan.reason);
  check(JSON.stringify(plan.deleteIds) === JSON.stringify([sP]), 'T5b 只删 sP', plan.deleteIds);
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: [sN1], rows: [row(sN1, N1)], primaryUid: P, mode: 'cascade' });
  check(plan.mode === 'cascade' && plan.reason === 'forced-cascade', 'T5c mode=cascade 时非主账号删除也级联', plan.reason);
  check(plan.deleteIds.indexOf(sP) >= 0, 'T5d 强制级联会带上主账号会话', plan.deleteIds);

  /* ---------- T6 无 lineage 的脏行 ---------- */
  console.log('T6 没有 lineage 的会话');
  resetDataDir();
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: ['sess-orphan'], rows: [row('sess-orphan', P)], primaryUid: P });
  check(plan.mode === 'cascade' && JSON.stringify(plan.deleteIds) === JSON.stringify(['sess-orphan']),
    'T6a 主账号下无 lineage → 只删它自己', plan.deleteIds);
  check(plan.lineageIds.length === 0, 'T6b 没有涉及 lineage', plan.lineageIds);
  plan = lib.resolveSessionDeletePlan(dataDir, { ids: ['sess-orphan'], rows: [row('sess-orphan', N1)], primaryUid: P });
  check(plan.mode === 'local' && plan.suppressions.length === 0, 'T6c 非主账号下无 lineage → local 且不登记抑制', plan.suppressions);

  /* ---------- T7 抑制表读写与落盘 ---------- */
  console.log('T7 抑制登记');
  resetDataDir();
  check(lib.setAutoCopySuppression(dataDir, L1, N1, { reason: 'local-delete', by: 'test' }) === true, 'T7a 登记成功');
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N1) === true, 'T7b 读回为已抑制');
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N2) === false, 'T7c 只影响该账号，N2 不受影响');
  check(lib.isAutoCopySuppressedForTarget(dataDir, L2, N1) === false, 'T7d 只影响该 lineage，L2 不受影响');
  let raw = readRawMeta();
  check(raw.autoCopy.suppressed[JSON.stringify([L1, N1])] && raw.autoCopy.suppressed[JSON.stringify([L1, N1])].reason === 'local-delete',
    'T7e 已落盘到 meta.json', Object.keys(raw.autoCopy.suppressed));
  check(JSON.stringify(lib.getSuppressedLineagesForTarget(dataDir, N1)) === JSON.stringify([L1]),
    'T7f getSuppressedLineagesForTarget(N1)=[L1]', lib.getSuppressedLineagesForTarget(dataDir, N1));
  check(lib.getSuppressedLineagesForTarget(dataDir, N2).length === 0, 'T7g N2 无抑制');
  check(lib.setAutoCopySuppression(dataDir, 'lin-does-not-exist', N1) === false, 'T7h 不存在的 lineage 拒绝登记（不留无主键）');
  check(lib.clearAutoCopySuppression(dataDir, L1, N1) === true, 'T7i 清除成功');
  check(lib.clearAutoCopySuppression(dataDir, L1, N1) === false, 'T7j 重复清除返回 false');
  check(raw.autoCopy.version === 2, 'T7k 写抑制没有动 version');

  /* ---------- T8 lineage 消亡时抑制键被一起清理 ---------- */
  console.log('T8 lineage 消亡 → 抑制键清理');
  resetDataDir();
  lib.setAutoCopySuppression(dataDir, L1, N1, { reason: 'local-delete' });
  lib.removeAutoCopySession(dataDir, P, sP);
  let mid = readRawMeta();
  check(!!mid.autoCopy.sessions[L1], 'T8a 还有成员时 lineage 保留');
  lib.removeAutoCopySession(dataDir, N1, sN1);
  lib.removeAutoCopySession(dataDir, N2, sN2);
  raw = readRawMeta();
  check(!raw.autoCopy.sessions[L1], 'T8b lineage 清空后被删除');
  check(Object.keys(raw.autoCopy.suppressed).filter((k) => JSON.parse(k)[0] === L1).length === 0,
    'T8c 针对它的抑制键被一起清掉（无主垃圾键）', Object.keys(raw.autoCopy.suppressed));
  check(!!raw.autoCopy.sessions[L2] && !!raw.autoCopy.sessions[L3], 'T8d 其它 lineage 未受影响');

  /* ---------- T9 用户显式重开自动复制 → 清掉抑制 ---------- */
  console.log('T9 显式重开自动复制覆盖抑制');
  resetDataDir();
  lib.setAutoCopySuppression(dataDir, L1, N1, { reason: 'local-delete' });
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N1) === true, 'T9a 抑制已存在');
  lib.setAutoCopyRule(dataDir, { uid: N1, kind: 'session', key: sN1, enabled: true });
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N1) === false, 'T9b 重开后抑制被清掉');
  // 但重开会顺带清掉的是「这个账号这条 lineage」，别的账号不受影响
  resetDataDir();
  lib.setAutoCopySuppression(dataDir, L1, N2, { reason: 'local-delete' });
  lib.setAutoCopyRule(dataDir, { uid: N1, kind: 'session', key: sN1, enabled: true });
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N2) === true, 'T9c 重开 N1 不影响 N2 的抑制');

  /* ---------- T10 回归：不得破坏既有 v2 结构（最容易踩的坑） ---------- */
  console.log('T10 老 meta 缺 suppressed 时的兼容性');
  resetDataDir();
  // 故意把 suppressed 摘掉，模拟升级前的 meta.json
  raw = readRawMeta();
  delete raw.autoCopy.suppressed;
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(raw, null, 2));
  const cfg = lib.readAutoCopyConfig(dataDir);
  check(Object.keys(cfg.sessions).length === 3, 'T10a 三条 lineage 全在，没有被重建', Object.keys(cfg.sessions));
  check(!cfg.sessions.enabled && !cfg.sessions.members, 'T10b ★ 没有凭空造出 sessionId 为 enabled/members 的伪 lineage', Object.keys(cfg.sessions));
  check(JSON.stringify(Object.keys(cfg.sessionIndex[P] || {}).sort()) === JSON.stringify([sOnlyP, sP].sort()),
    'T10c sessionIndex 未被打乱', cfg.sessionIndex[P]);
  check(cfg.copies[JSON.stringify([L1, N1])] && cfg.copies[JSON.stringify([L1, N1])].targetId === sN1,
    'T10d copies 映射保留', cfg.copies);
  check(cfg.suppressed && Object.keys(cfg.suppressed).length === 0, 'T10e suppressed 被就地补成空表', cfg.suppressed);
  check(readRawMeta().autoCopy.version === 2, 'T10f version 仍是 2');

  /* ---------- T11 方向矩阵：穷举每个账号 × 每个会话，断言绝不反向 ---------- */
  console.log('T11 方向矩阵（穷举 · 绝不反向）');
  const primarySessions = new Set([sP, sOnlyP]);
  const cases = [
    { uid: P, id: sP, expect: 'cascade' },
    { uid: P, id: sOnlyP, expect: 'cascade' },
    { uid: N1, id: sN1, expect: 'local' },
    { uid: N1, id: sOnlyN1, expect: 'local' },
    { uid: N2, id: sN2, expect: 'local' },
  ];
  for (const item of cases) {
    resetDataDir();
    const result = lib.resolveSessionDeletePlan(dataDir, { ids: [item.id], rows: [row(item.id, item.uid)], primaryUid: P });
    const isPrimary = item.uid === P;
    check(result.mode === item.expect, 'T11 ' + (isPrimary ? '主账号' : '非主账号') + '/' + item.id + ' → ' + item.expect, result.mode);
    if (isPrimary) {
      check(result.deleteIds.length >= 1, 'T11 ' + item.id + ' 级联集合非空', result.deleteIds);
    } else {
      const leaked = result.deleteIds.filter((id) => primarySessions.has(id));
      check(leaked.length === 0, 'T11 ★ ' + item.id + ' 未波及任何主账号会话', leaked);
    }
  }

  /* ---------- T12 真实调用序列：非主账号删除后主账号仍在 ---------- */
  console.log('T12 非主账号删除的执行序列');
  resetDataDir();
  const localPlan = lib.resolveSessionDeletePlan(dataDir, { ids: [sN1], rows: [row(sN1, N1)], primaryUid: P });
  for (const item of localPlan.suppressions) {
    lib.setAutoCopySuppression(dataDir, item.lineageId, item.uid, { reason: localPlan.reason });
  }
  for (const id of localPlan.deleteIds) {
    const uid = id === sN1 ? N1 : (id === sN2 ? N2 : P);
    lib.removeAutoCopySession(dataDir, uid, id);
  }
  raw = readRawMeta();
  check(!!raw.autoCopy.sessions[L1], 'T12a lineage 仍存在（主账号那份还在）');
  check(raw.autoCopy.sessions[L1].members.some((m) => m.uid === P && m.id === sP), 'T12b ★ 主账号成员 sP 仍在 lineage 里',
    raw.autoCopy.sessions[L1].members);
  check(raw.autoCopy.sessions[L1].members.some((m) => m.uid === N2 && m.id === sN2), 'T12c 其它账号成员也还在');
  check(!raw.autoCopy.sessions[L1].members.some((m) => m.id === sN1), 'T12d 只有被删的 sN1 被摘掉');
  check(lib.isAutoCopySuppressedForTarget(dataDir, L1, N1) === true, 'T12e (L1, N1) 已登记抑制 → auto-copy 不会再复制回来');

  /* ---------- T13 主账号删除的执行序列：整条 lineage 消失 ---------- */
  console.log('T13 主账号删除的执行序列');
  resetDataDir();
  const cascadePlan = lib.resolveSessionDeletePlan(dataDir, { ids: [sP], rows: [row(sP, P)], primaryUid: P });
  lib.setAutoCopySuppression(dataDir, L1, N1, { reason: 'stale-local-delete' }); // 预先留一个抑制
  for (const id of cascadePlan.deleteIds) {
    const uid = id === sN1 ? N1 : (id === sN2 ? N2 : P);
    lib.removeAutoCopySession(dataDir, uid, id);
  }
  for (const lineageId of cascadePlan.lineageIds) lib.clearLineageSuppressions(dataDir, lineageId);
  raw = readRawMeta();
  check(!raw.autoCopy.sessions[L1], 'T13a 整条 lineage 被删除');
  check(!raw.autoCopy.copies[JSON.stringify([L1, N1])] && !raw.autoCopy.copies[JSON.stringify([L1, N2])],
    'T13b copies 映射被清理', raw.autoCopy.copies);
  check(Object.keys(raw.autoCopy.suppressed).length === 0, 'T13c 抑制标记被清理', raw.autoCopy.suppressed);
  check(!!raw.autoCopy.sessions[L2] && !!raw.autoCopy.sessions[L3], 'T13d 其它 lineage 未受影响');
} catch (error) {
  failures.push('测试中断: ' + (error && error.message));
  console.error('\n测试中断:', error && error.stack);
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) { failures.forEach((f) => console.log('  FAIL ' + f)); process.exitCode = 1; }
