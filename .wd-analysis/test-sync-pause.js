'use strict';
/*
 * test-sync-pause.js —— 「暂停同步 / 继续同步」与「立即同步」的行为与结构测试。
 *
 * 为什么不能直接 require daemon.js：它在模块末尾无条件 startServer() + cdpLoop()，
 * require 就等于起第二个 daemon（并抢 .daemon.lock）。所以这里用「源码切片 + new Function」
 * 把 startAutoCopyJob 那一族函数抽出来，注入桩件后在沙箱里跑（与 test-limit-failover.js 同法）。
 *
 * 覆盖：
 *   A. 结构断言：暂停收尾、三处检查点、哨兵异常、端点、公开字段是否都还在。
 *   B. 行为断言（切片沙箱）：
 *        B1 不取消 → 正常跑完 done；
 *        B2 会话中途取消 → paused，processed 停在中间，不再继续搬；
 *        B3 排队中取消 → 一进 worker 就 paused，一个会话都没复制（「停整条流水线」）；
 *        B4 产物阶段取消 → onFile 抛哨兵 → paused，且不被记成 payloadFailed；
 *        B5 paused 任务的 publicAutoCopyJob 暴露 sourceUid/targetUid/cancelRequested/pausedAt。
 *   C. 真实遍历断言：transferWorkspaceTree 的 onFile 抛异常必须**立即**穿出目录递归
 *      （这是「单个产物目录 32 万文件也能秒停」的前提），不能被内部吞掉。
 *   D. HTTP 集成（只打不发数据的只读/校验分支，绝不触发真实复制）：
 *        D1 active 接口形状；D2 cancel 未知 jobId → 404；D3 cancel 无参 → 200 且 cancelled 是数组；
 *        D4 sync-now 缺 targetUid → 400；D5 sync-now 目标不存在 → 404；
 *        D6 sync-now 显式源=目标 → 400；D7 sync-now 显式源不存在 → 400。
 *        ⚠️ 绝不能打「留空 sourceUid」那条路 —— 现在留空 = 除目标外所有账号，会真的开始复制。
 *
 * 跑法：node .wd-analysis/test-sync-pause.js
 *      HTTP 部分需要本机 daemon 在 127.0.0.1:47832 跑着；不在就自动跳过（不判失败）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const DAEMON = path.join(__dirname, '..', 'scripts', 'daemon.js');
const INJECT = path.join(__dirname, '..', 'scripts', 'inject.js');
const daemonSrc = fs.readFileSync(DAEMON, 'utf8');
const injectSrc = fs.readFileSync(INJECT, 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}

/* ================= 源码切片工具 ================= */

// 从 header 起点按花括号配平切出完整块；字符串/注释里的括号会干扰，这里足够用。
// 注意：header 自身可能含 `{}`（如 `options = {}`），所以先跳过配平的参数括号组，
// 再找函数体/类体的第一个 `{`，否则会切出一个语法不完整的片段。
function sliceBlock(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('找不到源码块: ' + header);
  let cursor = start + header.length;
  const paren = src.indexOf('(', start);
  if (paren >= 0 && paren < src.indexOf('\n', start)) {
    let depthP = 0;
    let j = paren;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '(') depthP++;
      else if (ch === ')') { depthP--; if (depthP === 0) break; }
    }
    cursor = j + 1;
  }
  let i = src.indexOf('{', cursor);
  if (i < 0) throw new Error('源码块无花括号: ' + header);
  let depth = 0;
  let inS = null;
  let inLine = false;
  let inBlock = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inS) {
      if (ch === '\\') { i++; continue; }
      if (ch === inS) inS = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('源码块未闭合: ' + header);
}

/* ================= A. 结构断言 ================= */

console.log('\n[A] 结构断言');

ok(/class AutoCopyPausedError extends Error/.test(daemonSrc), 'A1 定义 AutoCopyPausedError');
ok(/this\.autoCopyPaused = true;/.test(daemonSrc), 'A2 哨兵带 autoCopyPaused 标记');
ok(/function isAutoCopyPausedError\(error\)/.test(daemonSrc), 'A3 定义 isAutoCopyPausedError');

const jobBlock = sliceBlock(daemonSrc, 'function startAutoCopyJob(sourceUid, targetUid, plan)');
ok(/job\.status = 'paused'/.test(jobBlock), 'A4 finishPaused 置 status=paused');
ok(/job\.pausedAt = Date\.now\(\)/.test(jobBlock), 'A5 finishPaused 记录 pausedAt');
ok(/job\.phase = 'paused'/.test(jobBlock), 'A6 finishPaused 置 phase=paused');

const checkpoints = jobBlock.match(/if \(job\.cancelRequested\) \{ finishPaused\(\); return; \}/g) || [];
ok(checkpoints.length >= 3, 'A7 至少三处暂停检查点（入队/正文/产物）', checkpoints.length);

ok(/onFile: \(counters\) => \{[\s\S]*?if \(job\.cancelRequested\) throw new AutoCopyPausedError\(\);/.test(jobBlock),
  'A8 onFile 内抛哨兵（单个大目录也能立即停）');
ok(/if \(isAutoCopyPausedError\(e\)\) \{ finishPaused\(\); return; \}/.test(jobBlock),
  'A9 产物阶段识别哨兵，不记成失败');
// 暂停不能污染失败计数：payloadFailed++ 必须排在哨兵判断之后。
const catchIdx = jobBlock.indexOf('if (isAutoCopyPausedError(e)) { finishPaused(); return; }');
const payloadFailIdx = jobBlock.lastIndexOf('job.payloadFailed++;');
ok(catchIdx > 0 && payloadFailIdx > catchIdx, 'A10 哨兵判断先于 payloadFailed++');
ok(/cancelRequested: false,/.test(jobBlock), 'A11 job 初始化 cancelRequested');

const pubBlock = sliceBlock(daemonSrc, 'function publicAutoCopyJob(job)');
ok(/sourceUid: job\.sourceUid/.test(pubBlock), 'A12 publicAutoCopyJob 暴露 sourceUid');
ok(/targetUid: job\.targetUid/.test(pubBlock), 'A13 publicAutoCopyJob 暴露 targetUid');
ok(/cancelRequested: !!job\.cancelRequested/.test(pubBlock), 'A14 publicAutoCopyJob 暴露 cancelRequested');
ok(/pausedAt: job\.pausedAt \|\| null/.test(pubBlock), 'A15 publicAutoCopyJob 暴露 pausedAt');
ok(/status: job\.status/.test(pubBlock), 'A16 status 原样透出（paused 能到前端）');

const pruneBlock = sliceBlock(daemonSrc, 'function pruneAutoCopyJobs()');
ok(/job\.status === 'paused'/.test(pruneBlock), 'A17 prune 认识 paused');

ok(/p === '\/api\/sessions\/auto-copy\/cancel'/.test(daemonSrc), 'A18 暂停端点存在');
ok(/p === '\/api\/sessions\/sync-now'/.test(daemonSrc), 'A19 立即同步端点存在');

const cancelEp = sliceBlock(daemonSrc, "if (req.method === 'POST' && p === '/api/sessions/auto-copy/cancel')");
ok(!/\.status = 'paused'/.test(cancelEp), 'A20 端点不直接改 status（只置标记，收尾交给 worker）');
ok(/job\.cancelRequested = true;/.test(cancelEp), 'A21 端点置 cancelRequested');

console.log('\n[A2] 前端（inject.js）');
ok(/id="wbs-sess-progress-btn"/.test(injectSrc), 'A22 进度条里挂了暂停/继续按钮');
ok(/function pauseAutoCopy\(\)/.test(injectSrc), 'A23 定义 pauseAutoCopy');
ok(/function resumeAutoCopy\(\)/.test(injectSrc), 'A24 定义 resumeAutoCopy');
ok(/function openSyncNowModal\(\)/.test(injectSrc), 'A25 定义 openSyncNowModal');
ok(/id="wbs-sess-sync-now"/.test(injectSrc), 'A26 工具栏「立即同步」按钮');
ok(/dataset\.acAction = 'pause'/.test(injectSrc) && /dataset\.acAction = 'resume'/.test(injectSrc),
  'A27 按钮 action 随状态切换');
ok(/\.wbs-sess-progress\.paused \.wbs-sess-progress-fill\{background:#c98a20\}/.test(injectSrc),
  'A29 已暂停配色');
ok(/function shouldShowAutoCopy\(job\) \{[\s\S]*?job\.status === 'paused'[\s\S]*?\n    \}/.test(injectSrc),
  'A30 已暂停任务不受 2 分钟窗口限制');

/* ================= B. 行为断言（切片沙箱） ================= */

console.log('\n[B] 行为断言（切片沙箱）');

function buildSandbox(overrides) {
  overrides = overrides || {};
  const parts = [
    sliceBlock(daemonSrc, 'class AutoCopyPausedError extends Error'),
    sliceBlock(daemonSrc, 'function isAutoCopyPausedError(error)'),
    sliceBlock(daemonSrc, 'function pruneAutoCopyJobs()'),
    sliceBlock(daemonSrc, 'function runAutoCopyQueue()'),
    sliceBlock(daemonSrc, 'function startAutoCopyJob(sourceUid, targetUid, plan)'),
    sliceBlock(daemonSrc, 'function publicAutoCopyJob(job)'),
  ];
  const logs = [];
  const calls = { copy: 0, payload: 0, payloadOnFile: 0 };
  const plan = overrides.plan || [
    { id: 's1', label: 'sess-1', sizeBytes: 10, workspaceBytes: 0, workspaceFiles: 0 },
    { id: 's2', label: 'sess-2', sizeBytes: 10, workspaceBytes: 0, workspaceFiles: 0 },
    { id: 's3', label: 'sess-3', sizeBytes: 10, workspaceBytes: 0, workspaceFiles: 0 },
  ];
  const scope = {
    crypto,
    PROFILE: { dataRoot: os.tmpdir() },
    autoCopyJobs: new Map(),
    autoCopyQueue: [],
    autoCopyWorkerRunning: false,
    log: (m) => logs.push(String(m)),
    formatByteSize: (n) => String(n),
    autoCopySessionLabel: (row) => row.label || String(row.id),
    buildAutoCopyPlan: async () => { if (overrides.planGate) await overrides.planGate.promise; return plan; },
    sortAutoCopyPlanBySize: (list) => list,
    copySessionRecord: async (src, targetUid) => {
      calls.copy++;
      if (overrides.onCopy) overrides.onCopy(src, targetUid, calls);
      return { status: 'copied', targetId: 't-' + src.id, workspacePending: !!src.workspaceFiles };
    },
    syncAutoCopyLineage: async () => ({ members: 1, synced: 0, failedFiles: 0, targetIds: [], targetPresent: false, payloadTargets: [] }),
    copySessionWorkspacePayload: async (wbHome, oldId, newId, options) => {
      calls.payload++;
      const counters = { files: 0, linked: 0, linkedBytes: 0, copied: 0, skipped: 0, failed: 0, kept: 0 };
      const total = overrides.payloadFiles === undefined ? 3 : overrides.payloadFiles;
      for (let i = 0; i < total; i++) {
        counters.files++;
        counters.copied++;
        calls.payloadOnFile++;
        // 与真实实现一致：onFile 在目录递归内部被调用，抛出的异常必须直接穿出去。
        if (options && options.onFile) options.onFile(counters);
        if (overrides.onPayload) overrides.onPayload(calls.payloadOnFile, calls);
        // 真实实现每文件都有 fs await；这里每 50 个让出一次事件循环，否则同步循环会
        // 把事件循环锁死，外部注入的「暂停」根本没机会生效。
        if (i % 50 === 0) await new Promise((r) => setImmediate(r));
      }
      return Object.assign({ outcome: 'copied', linked: 0, linkedBytes: 0 }, counters);
    },
    yieldAutoCopyToRenderer: overrides.yieldFn || (async () => { await new Promise((r) => setTimeout(r, 0)); }),
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, parts.join('\n') + '\nreturn { startAutoCopyJob, publicAutoCopyJob, autoCopyJobs, autoCopyQueue, activeAutoCopyJob: null };');
  const api = fn(...names.map((n) => scope[n]));
  return { api, scope, logs, calls };
}

// 等任务落到终态。注意不能看沙箱里的 autoCopyWorkerRunning —— 它是 new Function 的
// 形参绑定，闭包里的写法只改形参、改不到外面那个 scope 对象，观测它永远是 false。
function waitSettled(jobs, ms) {
  const deadline = Date.now() + (ms || 3000);
  return new Promise((resolve) => {
    const spin = () => {
      const settled = jobs.every((j) => j.status === 'done' || j.status === 'partial' || j.status === 'error' || j.status === 'paused');
      if (settled || Date.now() > deadline) return resolve();
      setTimeout(spin, 5);
    };
    spin();
  });
}

(async function runBehaviour() {
  // B1 不取消 → 正常跑完
  {
    const { api, scope } = buildSandbox();
    const job = api.startAutoCopyJob('u-src', 'u-dst', []);
    await waitSettled([job]);
    const pub = api.publicAutoCopyJob(job);
    ok(job.status === 'done', 'B1a 未取消的任务跑完为 done', job.status);
    ok(pub.processed === 3 && pub.copied === 3, 'B1b 三个会话都复制了', { p: pub.processed, c: pub.copied });
    ok(pub.cancelRequested === false && pub.pausedAt === null, 'B1c 未取消时标记为假');
    ok(pub.sourceUid === 'u-src' && pub.targetUid === 'u-dst', 'B1d 公开字段带源/目标账号');
  }

  // B2 会话中途取消 → 停在中间
  {
    let sandbox;
    sandbox = buildSandbox({
      onCopy: (src, targetUid, calls) => {
        // 复制完第一个会话后立刻请求暂停（模拟用户点「暂停」）
        if (calls.copy === 1) {
          for (const j of sandbox.scope.autoCopyJobs.values()) j.cancelRequested = true;
        }
      },
    });
    const job = sandbox.api.startAutoCopyJob('u-src', 'u-dst', []);
    await waitSettled([job]);
    const pub = sandbox.api.publicAutoCopyJob(job);
    ok(job.status === 'paused', 'B2a 中途取消收尾为 paused', job.status);
    ok(typeof pub.pausedAt === 'number' && pub.pausedAt > 0, 'B2b pausedAt 是时间戳');
    ok(pub.processed === 1, 'B2c 停在第 1 个会话（不再继续搬）', pub.processed);
    ok(sandbox.calls.copy === 1, 'B2d 只复制了 1 个会话', sandbox.calls.copy);
    ok(pub.cancelRequested === true, 'B2e 已暂停任务带 cancelRequested');
  }

  // B3 排队中取消 → 一进 worker 就停，零复制（「停整条流水线」）
  {
    let release;
    const gate = { promise: new Promise((r) => { release = r; }) };
    const sandbox = buildSandbox({ planGate: gate });
    const first = sandbox.api.startAutoCopyJob('u-a', 'u-dst', []);
    // 第一个任务卡在 buildAutoCopyPlan；此时第二个任务只能排队
    await new Promise((r) => setTimeout(r, 10));
    const second = sandbox.api.startAutoCopyJob('u-b', 'u-dst', []);
    ok(second.status === 'queued', 'B3a 第二个任务处于 queued', second.status);
    const copyBefore = sandbox.calls.copy;
    second.cancelRequested = true;
    release();
    await waitSettled([first, second], 3000);
    ok(second.status === 'paused', 'B3b 排队的任务被取消后直接 paused', second.status);
    ok(sandbox.calls.copy === copyBefore + 3, 'B3c 排队任务零复制（只有第一个任务复制了 3 个）',
      { before: copyBefore, after: sandbox.calls.copy });
    ok(second.processed === 0, 'B3d 排队任务 processed 为 0', second.processed);
    ok(first.status === 'done', 'B3e 前一个任务不受影响', first.status);
  }

  // B4 产物阶段取消 → 哨兵 → paused 且不算失败
  {
    let sandbox;
    sandbox = buildSandbox({
      plan: [{ id: 's1', label: 'sess-1', sizeBytes: 10, workspaceBytes: 500, workspaceFiles: 100000 }],
      payloadFiles: 100000,
      // 产物阶段搬到第 50 个文件时请求暂停 —— 命中 onFile 内的检查点，与真实场景一致。
      onPayload: (n) => {
        if (n === 50) {
          for (const j of sandbox.scope.autoCopyJobs.values()) j.cancelRequested = true;
        }
      },
    });
    const job = sandbox.api.startAutoCopyJob('u-src', 'u-dst', []);
    await waitSettled([job], 10000);
    const pub = sandbox.api.publicAutoCopyJob(job);
    ok(job.status === 'paused', 'B4a 产物阶段取消 → paused', job.status);
    ok(pub.payloadFailed === 0, 'B4b 暂停不记成产物失败', pub.payloadFailed);
    ok(pub.payloadFailedFiles === 0, 'B4c 暂停不计失败文件', pub.payloadFailedFiles);
    ok(sandbox.calls.payloadOnFile > 0 && sandbox.calls.payloadOnFile < 100000,
      'B4d 中途即停（未搬完 10 万文件）', sandbox.calls.payloadOnFile);
    ok(sandbox.calls.payloadOnFile <= 120, 'B4e 停得很早（≈第 51 个文件）', sandbox.calls.payloadOnFile);
  }

  console.log('\n[C] transferWorkspaceTree 哨兵穿透');
  {
    const fnSrc = [
      sliceBlock(daemonSrc, 'function emptyWorkspaceCounters()'),
      sliceBlock(daemonSrc, 'async function transferWorkspaceTree(from, to, options = {})'),
    ].join('\n');
    const scope = {
      fs,
      path,
      WORKSPACE_LINK_FREEZE_MS: 10 * 60 * 1000,
      WORKSPACE_LINK_EXCLUDE: /(^|[\\/])(modify_backup|\.modify_backup_meta)([\\/]|$)/,
      workspaceLinkSupport: null,
    };
    const names = Object.keys(scope);
    const fn = new Function(...names, fnSrc + '\nreturn { transferWorkspaceTree };');
    const { transferWorkspaceTree } = fn(...names.map((n) => scope[n]));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-pause-'));
    const from = path.join(tmp, 'from');
    const to = path.join(tmp, 'to');
    fs.mkdirSync(path.join(from, 'a', 'b'), { recursive: true });
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(from, 'a', 'b', 'f' + i + '.bin'), 'x');
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(from, 'g' + i + '.bin'), 'y');

    // C1 正常遍历：80 个文件全部回调
    let n1 = 0;
    const c1 = await transferWorkspaceTree(from, path.join(tmp, 'to1'), { useLink: false, onFile: () => { n1++; } });
    ok(c1.files === 80 && n1 === 80, 'C1 正常遍历回调 80 次', { files: c1.files, cb: n1 });

    // C2 抛哨兵：必须穿出递归、且早停
    const sentinel = new Error('stopped');
    sentinel.autoCopyPaused = true;
    let n2 = 0;
    let caught = null;
    try {
      await transferWorkspaceTree(from, path.join(tmp, 'to2'), {
        useLink: false,
        onFile: () => { n2++; if (n2 === 5) throw sentinel; },
      });
    } catch (e) { caught = e; }
    ok(caught === sentinel, 'C2a 哨兵原样穿出（未被内部吞掉）');
    ok(n2 === 5, 'C2b 立即停在抛出点（不再继续遍历）', n2);

    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  /* ================= D. HTTP 集成（只读/校验分支） ================= */

  console.log('\n[D] HTTP 集成（不触发真实复制）');
  const TOKEN_FILE = 'C:/Users/Lyon/AppData/Roaming/WorkDaddy/.api-token';
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (_) {}

  function apiCall(method, p, body) {
    return new Promise((resolve) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
      const req = http.request({
        host: '127.0.0.1', port: 47832, path: p, method,
        headers: Object.assign({ 'X-WorkDaddy-Token': token }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', (e) => resolve({ status: -1, error: e.message }));
      if (data) req.write(data);
      req.end();
    });
  }

  const probe = await apiCall('GET', '/api/status');
  if (probe.status !== 200) {
    console.log('  skip  daemon 未在 127.0.0.1:47832 运行，跳过 HTTP 集成断言');
  } else {
    const live = probe.body && probe.body.buildId;
    console.log('  info  daemon buildId = ' + live);
    // 这条断言的目的是「别让测试跑在一个还没加载新代码的旧 daemon 上」，而不是钉死某个具体版本。
    // 因此用**名单**：本阶段及其之后（含本阶段改动的）自建构建都算通过。每落地一个新阶段，
    // 把新 buildId 追加进来即可，否则测试会在新阶段误报 D0 失败。
    // 别再往名单里堆具体版本了（堆了三次，每次都要回来改）：只要跑的是「本阶段或更晚的
    // 自建构建」就算通过 —— 前缀 + 日期形态 + 不是引入本功能之前的那个即可。
    // 2026-09-17: 原来的 /^…-1\.3\.0-/ 在 daemon 升到 1.3.1 后就一直误报 D0（存量问题）。
    // 放宽到 1.3.x：只要前缀/日期形态对、且不是「引入本功能之前」的那个构建就算通过。
    const BUILD_RE = /^(selfhost|release)-1\.3\.[0-9]+-\d{8}-/;
    ok(BUILD_RE.test(live) && live !== 'release-1.3.0-20260914-failover-continue',
      'D0 daemon 已加载本阶段（或更晚）的构建', live);

    const a = await apiCall('GET', '/api/sessions/auto-copy/active');
    ok(a.status === 200 && a.body && a.body.ok === true, 'D1a active 接口 200/ok');
    ok(a.body && ('job' in a.body), 'D1b active 返回 job 字段');

    const c1 = await apiCall('POST', '/api/sessions/auto-copy/cancel', { jobId: '__wd_missing_job__' });
    ok(c1.status === 404, 'D2 cancel 未知 jobId → 404', c1.status);

    const c2 = await apiCall('POST', '/api/sessions/auto-copy/cancel', {});
    ok(c2.status === 200 && c2.body && Array.isArray(c2.body.cancelled), 'D3 cancel 无参 → 200 且 cancelled 为数组',
      c2.body && c2.body.cancelled);

    const s1 = await apiCall('POST', '/api/sessions/sync-now', {});
    ok(s1.status === 400, 'D4 sync-now 缺 targetUid → 400', s1.status);

    const s2 = await apiCall('POST', '/api/sessions/sync-now', { targetUid: '__wd_missing_uid__' });
    ok(s2.status === 404, 'D5 sync-now 目标不存在 → 404', s2.status);

    const accounts = await apiCall('GET', '/api/accounts');
    const cur = accounts.body && accounts.body.current && accounts.body.current.uid;
    if (cur) {
      // ⚠️ 语义已改：现在「留空 sourceUid」= 除目标账号以外的**所有账号**各起一个复制任务，
      // 也就是会**真的开始复制**。测试里绝不能这么打 —— 必须显式给出 sourceUid 才走校验分支。
      const s3 = await apiCall('POST', '/api/sessions/sync-now', { targetUid: cur, sourceUid: cur });
      ok(s3.status === 400, 'D6 sync-now 源=目标 → 400', s3.status);
    const s4 = await apiCall('POST', '/api/sessions/sync-now', { targetUid: cur, sourceUid: '__wd_missing_uid__' });
    ok(s4.status === 400, 'D7 sync-now 显式源不存在 → 400', s4.status);
    // purge-copy：只删这一份副本的原语（重复副本清理用）。只打校验分支，绝不删真实会话。
    const p1 = await apiCall('POST', '/api/sessions/purge-copy', {});
    ok(p1.status === 400, 'D8 purge-copy 缺 id → 400', p1.status);
    const p2 = await apiCall('POST', '/api/sessions/purge-copy', { id: '__wd_missing_session__' });
    ok(p2.status === 404, 'D9 purge-copy 不存在的会话 → 404（不会误删）', p2.status);
    } else {
      console.log('  skip  D6/D7 取不到当前账号 uid');
    }
  }

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常: ' + (e && e.stack || e));
  process.exit(2);
});
