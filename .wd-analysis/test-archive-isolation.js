'use strict';
/*
 * 归档跨账号隔离（daemon 1.3.8）回归测试。
 *
 * 被测语义：`sessions.status='archived'` 是**主账号专属**状态。
 *   ① syncAutoCopyLineage 不再回写 status
 *   ② buildAutoCopyPlan 的源行是 archived 时不进复制计划
 *   ③ 其他账号上的归档副本在「该账号为当前登录账号」时被清掉
 * 不变量 I-1：全表 archived 行只允许属于主账号。
 *
 * 四组：
 *   A 纯函数（lib.pickArchivedCrossAccountTargets，真跑）
 *   B 源码接线（daemon.js / lib.js 文本断言 + 行尾）
 *   C 切片沙箱（把 sweepArchivedCopies 切出来，注入 stub 真跑判定链）
 *   D HTTP 干跑（打真 daemon，只读分支）
 */
const fs = require('fs');
const path = require('path');

const DAEMON = 'D:/WorkDaddy/scripts/daemon.js';
const LIB = 'D:/WorkDaddy/scripts/lib.js';
const API = 'http://127.0.0.1:47832';

let pass = 0;
let fail = 0;
function check(label, cond, info) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { fail += 1; console.log('  FAIL ' + label + (info === undefined ? '' : '  → ' + info)); }
}

const daemonSrc = fs.readFileSync(DAEMON, 'utf8').replace(/\r\n/g, '\n');
const libSrc = fs.readFileSync(LIB, 'utf8').replace(/\r\n/g, '\n');
const lib = require(LIB);

/* ------------------------------- A 组 ------------------------------- */
console.log('\n[A] pickArchivedCrossAccountTargets 纯函数');
{
  const A = 'primary-uid';
  const B = 'other-uid';
  const C = 'third-uid';
  const rows = [
    { id: 'a1', uid: A, title: '主账号这份', updatedAt: 11 },
    { id: 'b1', uid: B, title: 'B 的副本', updatedAt: 12 },
    { id: 'c1', uid: C, title: 'C 的副本', updatedAt: 13 },
  ];
  const lineageBySession = { a1: 'L1', b1: 'L1', c1: 'L1' };
  const membersByLineage = { L1: [{ uid: A, id: 'a1' }, { uid: B, id: 'b1' }, { uid: C, id: 'c1' }] };
  const r = lib.pickArchivedCrossAccountTargets({ rows, lineageBySession, membersByLineage, primaryUid: A });
  check('A1 空入参不抛且返回三个空数组', (() => {
    const e = lib.pickArchivedCrossAccountTargets();
    return Array.isArray(e.keep) && !e.keep.length && Array.isArray(e.targets) && !e.targets.length
      && Array.isArray(e.orphanArchived) && !e.orphanArchived.length;
  })());
  check('A2 主账号那份进 keep', r.keep.length === 1 && r.keep[0].id === 'a1');
  check('A3 另两份进 targets（三账号各一份 → keep 1 / targets 2）', r.targets.length === 2
    && r.targets.map((t) => t.id).sort().join(',') === 'b1,c1');
  check('A4 targets 元素带 lineageId/primaryId（删除前的存在性证据）',
    r.targets.every((t) => t.lineageId === 'L1' && t.primaryId === 'a1'));
  check('A5 targets 元素字段完整（id/uid/title/updatedAt）',
    r.targets.every((t) => t.id && t.uid && typeof t.title === 'string' && typeof t.updatedAt === 'number'));
  check('A6 keep 与 targets 互斥', !r.targets.some((t) => r.keep.some((k) => k.id === t.id)));
  check('A7 没有 orphan', r.orphanArchived.length === 0);

  // 主账号那份不是 archived（不在 rows 里）→ 其他账号那份不能删
  const noPrimary = lib.pickArchivedCrossAccountTargets({
    rows: rows.filter((x) => x.id !== 'a1'), lineageBySession, membersByLineage, primaryUid: A,
  });
  check('A8 主账号不在归档态 → 他账号那份降级为 orphan（不误删）',
    noPrimary.targets.length === 0 && noPrimary.orphanArchived.length === 2
    && noPrimary.orphanArchived.every((o) => o.reason === 'primary-not-archived'));

  // 没有 lineage 登记
  const noLineage = lib.pickArchivedCrossAccountTargets({
    rows: [{ id: 'b9', uid: B }], lineageBySession: {}, membersByLineage: {}, primaryUid: A,
  });
  check('A9 无血缘登记 → orphan(no-lineage)，不删', noLineage.targets.length === 0
    && noLineage.orphanArchived.length === 1 && noLineage.orphanArchived[0].reason === 'no-lineage');

  // 没设主账号
  const noPrimaryUid = lib.pickArchivedCrossAccountTargets({ rows, lineageBySession, membersByLineage, primaryUid: '' });
  check('A10 未设主账号 → keep/targets 皆空，全进 orphan(no-primary)',
    noPrimaryUid.keep.length === 0 && noPrimaryUid.targets.length === 0
    && noPrimaryUid.orphanArchived.length === 3
    && noPrimaryUid.orphanArchived.every((o) => o.reason === 'no-primary'));

  // 归属未知的行
  const noOwner = lib.pickArchivedCrossAccountTargets({
    rows: [{ id: 'x1', uid: '' }], lineageBySession: { x1: 'L1' }, membersByLineage, primaryUid: A,
  });
  check('A11 归属账号为空 → orphan(no-owner)，绝不删', noOwner.targets.length === 0
    && noOwner.orphanArchived[0].reason === 'no-owner');

  // 重复行去重
  const dup = lib.pickArchivedCrossAccountTargets({
    rows: [rows[0], rows[1], rows[1], rows[1]], lineageBySession, membersByLineage, primaryUid: A,
  });
  check('A12 同 id 重复行只产出一次', dup.targets.length === 1 && dup.keep.length === 1,
    'targets=' + dup.targets.length + ' keep=' + dup.keep.length);

  // 主账号有两个成员都 archived（历史脏数据）→ 仍能判定
  const twoPrimary = lib.pickArchivedCrossAccountTargets({
    rows: [{ id: 'a1', uid: A }, { id: 'a2', uid: A }, { id: 'b1', uid: B }],
    lineageBySession: { a1: 'L1', a2: 'L1', b1: 'L1' },
    membersByLineage: { L1: [{ uid: A, id: 'a1' }, { uid: A, id: 'a2' }, { uid: B, id: 'b1' }] },
    primaryUid: A,
  });
  check('A13 主账号多份归档时 keep 2 / targets 1', twoPrimary.keep.length === 2 && twoPrimary.targets.length === 1);

  // 空 rows
  const emptyRows = lib.pickArchivedCrossAccountTargets({ rows: [], lineageBySession: {}, membersByLineage: {}, primaryUid: A });
  check('A14 rows 为空不抛且全空', !emptyRows.keep.length && !emptyRows.targets.length && !emptyRows.orphanArchived.length);

  // rows 里的非对象项被忽略
  const junk = lib.pickArchivedCrossAccountTargets({
    rows: [null, { id: '' }, rows[0], rows[1]], lineageBySession, membersByLineage, primaryUid: A,
  });
  check('A15 非法行被忽略（null / 空 id 不计入任何一组）',
    junk.keep.length === 1 && junk.targets.length === 1 && junk.orphanArchived.length === 0,
    'keep=' + junk.keep.length + ' targets=' + junk.targets.length + ' orphan=' + junk.orphanArchived.length);
}

/* ------------------------------- B 组 ------------------------------- */
console.log('\n[B] 源码接线');
{
  check('B1 buildAutoCopyPlan 过滤 archived 源行', /\.filter\(\(row\) => String\(row\.status \|\| ''\) !== 'archived'\);/.test(daemonSrc));
  const planBlock = daemonSrc.slice(daemonSrc.indexOf('async function buildAutoCopyPlan'));
  check('B2 过滤挂在 selectedRows 链上（suppressed 过滤之后）',
    planBlock.indexOf('suppressedLineages.has(') < planBlock.indexOf("!== 'archived'"));
  check('B3 syncAutoCopyLineage 的 UPDATE 不再含 status = ?', !/status = \?/.test(daemonSrc));
  check('B4 syncAutoCopyLineage 的 UPDATE 仍写 title/custom_title/updated_at',
    /UPDATE sessions SET title = \?, custom_title = \?, updated_at = \?, last_activity_at = \? WHERE id = \?/.test(daemonSrc));
  check('B5 基线传播整块已删除（含 resolvePropagatedStatus / readStatusBaseline / ARCHIVE_INTENT_FILE）',
    !/resolvePropagatedStatus|readStatusBaseline|saveStatusBaseline|ARCHIVE_INTENT_FILE/.test(daemonSrc));
  check('B6 daemon import 了 readAutoCopyConfig', /^\s+readAutoCopyConfig,$/m.test(daemonSrc));
  check('B7 daemon import 了 pickArchivedCrossAccountTargets', /^\s+pickArchivedCrossAccountTargets,$/m.test(daemonSrc));
  check('B8 lib 导出了 pickArchivedCrossAccountTargets', typeof lib.pickArchivedCrossAccountTargets === 'function');
  check('B9 路由 GET /api/sessions/archived-copies 在位', daemonSrc.includes("p === '/api/sessions/archived-copies'"));
  check('B10 路由 POST /api/sessions/archived-copies/purge 在位', daemonSrc.includes("p === '/api/sessions/archived-copies/purge'"));
  check('B11 拍子 sweepArchivedCopies 存在', /async function sweepArchivedCopies\(\)/.test(daemonSrc));
  check('B12 拍子已 setInterval 接线且 unref', /archiveIsolationTimer = setInterval\(\(\) => \{ sweepArchivedCopies\(\)/.test(daemonSrc)
    && /archiveIsolationTimer\.unref && archiveIsolationTimer\.unref\(\)/.test(daemonSrc));
  check('B13 拍子间隔 20s 与上限常量在位',
    /ARCHIVE_ISOLATION_INTERVAL_MS = 20000;/.test(daemonSrc) && /ARCHIVE_ISOLATION_MAX_PER_RUN = 10;/.test(daemonSrc));
  check('B14 开关 WBSWITCH_ARCHIVE_ISOLATION 在位', /WBSWITCH_ARCHIVE_ISOLATION/.test(daemonSrc));
  check('B15 无待处理项时也要推进 lastRunAt（在 pending 判定之前）',
    daemonSrc.indexOf('archiveIsolation.lastRunAt = Date.now();') < daemonSrc.indexOf('const mine = picked.targets.filter'));
  check('B16 purge-copy 端点已退化为 core 薄封装（两处共用同一实现）',
    (daemonSrc.match(/purgeLocalSessionCopyCore\(/g) || []).length >= 4
    && /POST' && p === '\/api\/sessions\/purge-copy'/.test(daemonSrc));
  check('B17 purgeLocalSessionCopyCore 不写抑制、不级联（隔离语义 = 只删这一份）', (() => {
    const start = daemonSrc.indexOf('async function purgeLocalSessionCopyCore');
    const body = daemonSrc.slice(start, daemonSrc.indexOf('\n}\n', start));
    return !/setAutoCopySuppression|resolveSessionDeletePlan/.test(body);
  })());
  // ⚠️ 不要写死 1.3.8：本套件验的是「归档隔离这套语义还在」，不是「版本号恒等于 1.3.8」。
  // 后续任何一次改动都会把 DAEMON_VERSION 往前推，写死就等于每次都被误报成回归。
  // 改成版本下限 + buildId 与版本号自洽，仍然能抓住「忘了升版本」和「buildId 没同步」。
  check('B18 版本号不低于 1.3.8（归档隔离落地版）', (() => {
    const m = daemonSrc.match(/DAEMON_VERSION = '(\d+)\.(\d+)\.(\d+)';/);
    if (!m) return false;
    const cur = [Number(m[1]), Number(m[2]), Number(m[3])];
    const floor = [1, 3, 8];
    for (let i = 0; i < 3; i++) { if (cur[i] !== floor[i]) return cur[i] > floor[i]; }
    return true;
  })());
  check('B19 buildId 与 DAEMON_VERSION 自洽（格式 release-<版本>-<日期>-<slug>）', (() => {
    const v = (daemonSrc.match(/DAEMON_VERSION = '([^']+)';/) || [])[1];
    const b = (daemonSrc.match(/DAEMON_BUILD_ID = '([^']+)';/) || [])[1];
    if (!v || !b) return false;
    if (b.indexOf('release-' + v + '-') !== 0) return false;
    return /^release-\d+\.\d+\.\d+-\d{8}-[a-z0-9-]+$/.test(b);
  })());
  const dcrlf = fs.readFileSync(DAEMON, 'utf8');
  const lcrlf = fs.readFileSync(LIB, 'utf8');
  check('B20 daemon.js 仍是纯 CRLF（无裸 LF）',
    ((dcrlf.match(/\n/g) || []).length - (dcrlf.match(/\r\n/g) || []).length) === 0);
  check('B21 lib.js 仍是纯 CRLF（无裸 LF）',
    ((lcrlf.match(/\n/g) || []).length - (lcrlf.match(/\r\n/g) || []).length) === 0);
  check('B22 拍子删前有「当前账号 ≠ 主账号」门槛', (() => {
    const start = daemonSrc.indexOf('async function sweepArchivedCopies');
    const body = daemonSrc.slice(start, daemonSrc.indexOf('\n}\n', start));
    return /currentUid === primaryUid/.test(body) && /item\.uid === currentUid/.test(body);
  })());
  check('B23 拍子状态文件与只读报告都能看到 lastRunAt',
    daemonSrc.includes('archive-isolation.json') && /lastRunAt: Number\(archiveIsolation\.lastRunAt\)/.test(daemonSrc));
}

/* ------------------------------- C 组 ------------------------------- */
console.log('\n[C] sweepArchivedCopies 切片沙箱真跑');
// ⚠️ 必须包在 async 函数里：顶层同时出现 require() 与顶层 await 会报 ERR_AMBIGUOUS_MODULE_SYNTAX
async function groupC() {
  const src = (() => {
    const header = 'async function sweepArchivedCopies()';
    const start = daemonSrc.indexOf(header);
    if (start < 0) return null;
    const rest = daemonSrc.slice(start);
    const m = /\n\}\n/.exec(rest);
    return m ? rest.slice(0, m.index + 3) : null;
  })();
  check('C0 切片成功', !!src && src.length > 500);

  const makeFactory = () => new Function(
    'archiveIsolation', 'archiveIsolationInFlight', 'archiveIsolationEnabled', 'primaryAccountStore', 'currentAccount',
    'collectArchivedCopyState', 'pickArchivedCrossAccountTargets', 'ARCHIVE_ISOLATION_MAX_PER_RUN',
    'purgeLocalSessionCopyCore', 'saveArchiveIsolation', 'log',
    src + '\nreturn sweepArchivedCopies;'
  );

  const PRIMARY = 'primary-uid';
  const OTHER = 'other-uid';
  const lineageBySession = { a1: 'L1', b1: 'L1' };
  const membersByLineage = { L1: [{ uid: PRIMARY, id: 'a1' }, { uid: OTHER, id: 'b1' }] };
  const stateWith = (rows) => async () => ({ rows, lineageBySession, membersByLineage });

  async function run(opts) {
    const state = Object.assign({
      createdAt: 1, lastRunAt: 0, lastSeenUid: '', lastPurged: 0, totalPurged: 0,
      errors: 0, lastError: '', pendingForCurrent: 0, orphanCount: 0, skipped: '',
    }, opts.state || {});
    const calls = [];
    const saves = [];
    const logs = [];
    const fn = makeFactory()(
      state,
      opts.inFlight === true,
      () => opts.enabled !== false,
      { get: () => (opts.primary === undefined ? PRIMARY : opts.primary) },
      () => (opts.current === undefined ? { uid: OTHER } : (opts.current ? { uid: opts.current } : null)),
      opts.collectState || stateWith([{ id: 'a1', uid: PRIMARY, title: 'A', updatedAt: 1 }, { id: 'b1', uid: OTHER, title: 'B', updatedAt: 2 }]),
      lib.pickArchivedCrossAccountTargets,
      10,
      async (input) => { calls.push(input); return opts.purgeResult || { ok: true, id: input.id, uid: input.uid, filesRemoved: 0 }; },
      (s) => { saves.push(JSON.parse(JSON.stringify(s))); },
      (m) => { logs.push(String(m)); }
    );
    const result = await fn();
    return { result, state, calls, saves, logs };
  }

  const c1 = await run({});
  check('C1 非主账号 + 该账号有归档副本 → 清掉 1 份', c1.result.purged === 1 && c1.calls.length === 1
    && c1.calls[0].id === 'b1' && c1.calls[0].expectUid === OTHER, JSON.stringify(c1.result));
  check('C2 清理用的 by=archive-isolation（日志可归因）', c1.calls[0].by === 'archive-isolation');
  check('C3 落盘里 totalPurged/lastPurged 已推进',
    c1.state.totalPurged === 1 && c1.state.lastPurged === 1 && c1.state.pendingForCurrent === 0);

  const c2 = await run({ current: PRIMARY });
  check('C4 当前是主账号 → 不动作（skipped=on-primary，purge 0 次）',
    c2.result.skipped === 'on-primary' && c2.calls.length === 0, JSON.stringify(c2.result));
  check('C5 主账号上 lastRunAt 仍推进（能看出拍子活着）', c2.state.lastRunAt > 0 && c2.saves.length >= 1);

  const c3 = await run({ primary: '' });
  check('C6 未设主账号 → skipped=no-primary 且不删', c3.result.skipped === 'no-primary' && c3.calls.length === 0);

  const c4 = await run({ inFlight: true });
  check('C7 上一拍还在跑 → skipped=in-flight 且不删', c4.result.skipped === 'in-flight' && c4.calls.length === 0);

  const c5 = await run({ enabled: false });
  check('C8 开关关闭 → skipped=disabled 且不删', c5.result.skipped === 'disabled' && c5.calls.length === 0);

  const c6 = await run({ purgeResult: { ok: false, status: 400, error: 'boom' } });
  check('C9 清理失败 → errors 累加且不谎报成功',
    c6.result.purged === 0 && c6.state.errors === 1 && c6.state.lastError === 'boom'
    && c6.state.pendingForCurrent === 1);

  const c7 = await run({ collectState: async () => ({ rows: [], lineageBySession: {}, membersByLineage: {} }) });
  check('C10 没有归档行 → 不删且 lastRunAt 推进',
    c7.calls.length === 0 && c7.result.purged === 0 && c7.state.lastRunAt > 0);
  check('C11 没有归档行也要落盘（否则「在跑」不可观测）', c7.saves.length >= 1);

  const c8 = await run({ current: 'third-uid' });
  check('C12 当前账号没有归档副本 → 不误删别人的（该账号这份不在此次清单里）',
    c8.calls.length === 0 && c8.result.purged === 0);
}

/* ------------------------------- D 组 ------------------------------- */
(async () => {
  await groupC();
  console.log('\n[D] HTTP 干跑（真 daemon，只读）');
  const tokenFile = path.join(process.env.APPDATA, 'WorkDaddy', '.api-token');
  let token = '';
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch (_) { token = ''; }
  async function call(method, p, body, withToken = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (withToken && token) headers['X-WorkDaddy-Token'] = token;
    const res = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let parsed = null;
    try { parsed = await res.json(); } catch (_) { parsed = null; }
    return { status: res.status, body: parsed };
  }

  const probe = await call('GET', '/api/status').catch(() => null);
  if (!probe || probe.status !== 200) {
    console.log('  skip  daemon 未在 127.0.0.1:47832 运行，跳过 HTTP 集成断言');
  } else {
    const live = probe.body && probe.body.buildId;
    const srcBuild = (daemonSrc.match(/DAEMON_BUILD_ID = '([^']+)';/) || [])[1];
    console.log('  info  daemon buildId = ' + live + '  源码 buildId = ' + srcBuild);
    // 同样别写死 build id：这条断言要抓的是「跑着的 daemon 是不是你刚改的这份代码」，
    // 所以拿它跟**源码里的 DAEMON_BUILD_ID** 比 —— 比写死某个阶段的 slug 更强也更耐用。
    check('D0 daemon 已加载当前源码这一版（buildId 与源码一致，即「改完记得重启」）',
      !!srcBuild && String(live) === srcBuild, 'live=' + live + ' src=' + srcBuild);

    const report = await call('GET', '/api/sessions/archived-copies');
    check('D1 GET /api/sessions/archived-copies → 200 且结构完整', report.status === 200 && report.body && report.body.ok === true
      && Array.isArray(report.body.keep) && Array.isArray(report.body.targets) && Array.isArray(report.body.orphanArchived));
    if (report.status === 200 && report.body) {
      const b = report.body;
      check('D2 keep 全属主账号', b.keep.every((k) => k.uid === b.primaryUid));
      check('D3 targets 全非主账号', b.targets.every((t) => t.uid && t.uid !== b.primaryUid));
      check('D4 targets 每条都带 lineageId/primaryId 且不等于自己', b.targets.every((t) => t.lineageId && t.primaryId && t.primaryId !== t.id));
      check('D5 keep / targets / orphan 三者互斥', (() => {
        const ids = new Set([...b.keep, ...b.targets].map((x) => x.id));
        return ids.size === b.keep.length + b.targets.length
          && !b.orphanArchived.some((o) => ids.has(o.id));
      })());
      check('D6 拍子状态字段在位（lastRunAt/pendingForCurrent/inFlight）',
        b.sweep && typeof b.sweep.lastRunAt === 'number' && typeof b.sweep.pendingForCurrent === 'number'
        && typeof b.sweep.inFlight === 'boolean');
      check('D7 拍子真的在跑（lastRunAt 距 now < 60s）', Date.now() - Number(b.sweep.lastRunAt) < 60000,
        'lastRunAt=' + b.sweep.lastRunAt);

      const before = b.keep.length + b.targets.length + b.orphanArchived.length;
      const dry = await call('POST', '/api/sessions/archived-copies/purge', { dryRun: true });
      check('D8 POST purge {dryRun:true} → 200 且 deleted=0', dry.status === 200 && dry.body && dry.body.dryRun === true && dry.body.deleted === 0);
      const after = await call('GET', '/api/sessions/archived-copies');
      const afterCount = after.body.keep.length + after.body.targets.length + after.body.orphanArchived.length;
      check('D9 干跑没改动任何数据', afterCount === before, before + ' → ' + afterCount);
      check('D10 干跑给出 plan 与 needsSwitch（跨账号要切号）',
        Array.isArray(dry.body.plan) && Array.isArray(dry.body.needsSwitch));
    }

    const noToken = await call('GET', '/api/sessions/archived-copies', null, false);
    check('D11 不带 token → 401（鉴权守卫在位）', noToken.status === 401, 'status=' + noToken.status);
  }

  console.log('\n===== test-archive-isolation: ' + pass + ' pass / ' + fail + ' fail =====');
  process.exit(fail ? 1 : 0);
})();
