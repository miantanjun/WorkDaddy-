'use strict';
/*
 * test-switch-sync.js —— 「切号后自动复制同步会话」+「立即同步：目标默认当前账号 / 源可留空」的回归测试。
 *
 * 三段：
 *   【A】resolveSyncNowSources —— 源账号解析（纯函数，切片沙箱）
 *   【B】autoCopyAfterAccountSwitch —— 手动切号 / 限流收尾切回 / 闲置切回 共用的一份实现（切片沙箱 + stub，
 *        绝不真的复制、不切号）
 *   【C】接线与前端源码断言（/api/switch、两个切回路径、同步弹窗、折叠卡片、桌面日志）
 *
 * 跑法：node .wd-analysis/test-switch-sync.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const logMod = require(path.join(ROOT, 'scripts', 'account-switch-log.js'));

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function section(title) { console.log('\n' + title); }

const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');

/* ---------- 切片：切号后自动复制 + 源账号解析 ---------- */
const START = '/* ---------------- 切号后自动复制同步会话（共用一个入口） ---------------- */';
// 锚点只认函数名：签名是随功能演进的（1.4.0 起多了 labels 参数），写死签名会一升级就翻红。
const END = 'function startAutoCopyJob(';
const sIdx = daemonSrc.indexOf(START);
const eIdx = daemonSrc.indexOf(END, sIdx);
if (sIdx < 0 || eIdx < 0) { console.log('  FAIL A0 找不到切片锚点'); process.exit(1); }
const block = daemonSrc.slice(sIdx, eIdx);
['autoCopyAfterAccountSwitch', 'resolveSyncNowSources'].forEach((need) => {
  if (block.indexOf(need) < 0) { console.log('  FAIL A0 切出的代码块缺少 ' + need); process.exit(1); }
});
console.log('[A0] 切片 OK（' + block.split('\n').length + ' 行）');

const world = {
  rules: {},
  pending: {},
  jobs: [],
  logs: [],
  failStart: false,
};
const factory = new Function(
  'DATA_DIR', 'log', 'getAutoCopyRules', 'hasPendingAutoCopyTo', 'startAutoCopyJob',
  block + '\nreturn { autoCopyAfterAccountSwitch: autoCopyAfterAccountSwitch, resolveSyncNowSources: resolveSyncNowSources };'
);
const api = factory(
  'C:/fake-data-dir',
  (m) => world.logs.push(String(m)),
  (dir, uid) => world.rules[uid] || { allSessions: false, sessionIds: [], workspaces: [] },
  (uid) => world.pending[uid] === true,
  (sourceUid, targetUid, plan) => {
    if (world.failStart) throw new Error('模拟起任务失败');
    const job = { id: 'job-' + (world.jobs.length + 1), sourceUid, targetUid, total: 3, plan };
    world.jobs.push(job);
    return job;
  }
);

/* ==================================================================== */
/* 【A】源账号解析                                                        */
/* ==================================================================== */

section('[A] 立即同步：源账号解析（留空 = 除目标外所有账号）');

const ALL = ['A', 'B', 'C'];
let r = api.resolveSyncNowSources(ALL, 'B', '');
ok(r.error === '' && r.explicit === false, 'A1 留空 → 不报错且标记为非显式', r);
ok(r.sources.join(',') === 'A,C', 'A2 留空 → 除目标外的所有账号（A,C）', r.sources);
r = api.resolveSyncNowSources(ALL, 'B', 'C');
ok(r.error === '' && r.sources.join(',') === 'C', 'A3 显式指定 → 只同步那一个', r);
r = api.resolveSyncNowSources(ALL, 'B', 'B');
ok(r.error === '源账号与目标账号相同' && r.sources.length === 0, 'A4 显式源=目标 → 报错且不起任务', r);
r = api.resolveSyncNowSources(ALL, 'B', 'ZZZ');
ok(r.error === '源账号不存在', 'A5 显式源不存在 → 报错', r);
r = api.resolveSyncNowSources(['B'], 'B', '');
ok(r.error !== '' && r.sources.length === 0, 'A6 只有一个账号且它就是目标 → 报错（没有源可用）', r);
r = api.resolveSyncNowSources(['B', 'A'], 'B', '');
ok(r.sources.join(',') === 'A', 'A7 目标在列表中 → 只排除目标自己', r.sources);
r = api.resolveSyncNowSources(ALL, '', '');
ok(r.sources.join(',') === 'A,B,C', 'A8 目标为空 → 不排除任何账号（调用方会先校验目标必填）', r.sources);
r = api.resolveSyncNowSources([], 'B', '');
ok(r.error !== '' && r.sources.length === 0, 'A9 没有任何账号 → 报错', r);
r = api.resolveSyncNowSources(['A', ' A ', '', 'B'], 'B', 'A');
ok(r.sources.join(',') === 'A', 'A10 去空白 / 去空值后仍能命中', r.sources);
r = api.resolveSyncNowSources(null, 'B', '');
ok(Array.isArray(r.sources) && r.error !== '', 'A11 传 null 不抛异常', r);

/* ==================================================================== */
/* 【B】切号后自动复制                                                     */
/* ==================================================================== */

section('\n[B] 切号后自动复制同步会话');

ok(api.autoCopyAfterAccountSwitch('A', 'B', 'test') === null, 'B1 源账号没有自动复制规则 → 不起任务');
ok(world.jobs.length === 0, 'B2 也确实没有起任何任务', world.jobs.length);
ok(world.logs.some((m) => /无需同步/.test(m)), 'B3 说明为什么没同步（日志里看得见）', world.logs.slice(-1));

world.rules.A = { allSessions: true, sessionIds: [], workspaces: [] };
let job = api.autoCopyAfterAccountSwitch('A', 'B', 'switch-api');
ok(job && world.jobs.length === 1, 'B4 allSessions 规则 → 起一个复制任务', world.jobs.length);
ok(job.sourceUid === 'A' && job.targetUid === 'B', 'B5 方向正确：源 A → 目标 B', job);
ok(world.logs.some((m) => /切号后已触发会话同步/.test(m) && /switch-api/.test(m)), 'B6 日志带上原因，便于回溯是哪条路径触发', world.logs.slice(-1));

world.rules.A = { allSessions: false, sessionIds: ['s1'], workspaces: [] };
job = api.autoCopyAfterAccountSwitch('A', 'B', 'idle-switchback');
ok(world.jobs.length === 2 && world.logs.some((m) => /idle-switchback/.test(m)), 'B7 只勾了单个会话的规则也算数', world.jobs.length);

world.rules.A = { allSessions: false, sessionIds: [], workspaces: [{ path: 'x' }] };
job = api.autoCopyAfterAccountSwitch('A', 'B', 'limit-failover-switchback');
ok(world.jobs.length === 3 && world.logs.some((m) => /limit-failover-switchback/.test(m)), 'B8 只勾了空间规则也算数', world.jobs.length);

world.rules.A = { allSessions: false, sessionIds: [], workspaces: [] };
world.pending.B = true;
job = api.autoCopyAfterAccountSwitch('B', 'A', 'idle-switchback');
ok(world.jobs.length === 4 && job.sourceUid === 'B', 'B9 没有规则但有「待复制」队列 → 也要起任务（否则排队的复制永远不执行）', world.jobs.length);
world.pending.B = false;

const before = world.jobs.length;
ok(api.autoCopyAfterAccountSwitch('A', 'A', 'test') === null && world.jobs.length === before, 'B10 源=目标 → 不起任务（防呆）');
ok(api.autoCopyAfterAccountSwitch('', 'B', 'test') === null, 'B11 源为空 → 不起任务');
ok(api.autoCopyAfterAccountSwitch('A', '', 'test') === null, 'B12 目标为空 → 不起任务');

world.rules.A = { allSessions: true, sessionIds: [], workspaces: [] };
world.failStart = true;
ok(api.autoCopyAfterAccountSwitch('A', 'B', 'test') === null, 'B13 起任务抛错 → 返回 null 不冒泡（切号本身不能因此失败）');
ok(world.logs.some((m) => /触发同步失败/.test(m)), 'B14 记下失败原因', world.logs.slice(-1));
world.failStart = false;

/* ==================================================================== */
/* 【C】接线与前端                                                        */
/* ==================================================================== */

section('\n[C] 接线与前端源码断言');

// 三个调用点
ok(/const autoCopyJob = autoCopyAfterAccountSwitch\(sourceUid, uid, 'switch-api'\);/.test(daemonSrc),
  'C1 手动切号 /api/switch 改走共享实现');
ok(!/const hasSourceAutoCopyRules/.test(daemonSrc), 'C2 路由里原来那份内联判定已删除（避免两份实现走样）');
ok(/autoCopyAfterAccountSwitch\(plan\.toUid, primaryUid, 'limit-failover-switchback'\)/.test(daemonSrc),
  'C3 限流续跑收尾切回：源=续跑账号 → 目标=主账号');
ok(/autoCopyAfterAccountSwitch\(report\.fromUid, report\.primaryUid, 'idle-switchback'\)/.test(daemonSrc),
  'C4 闲置切回：源=离开的账号 → 目标=主账号');
ok(/outcome: \{[^}]*autoCopy: autoCopyJob/.test(daemonSrc.replace(/\n\s*/g, ' ')) || /autoCopy: autoCopyJob \? \{ jobId/.test(daemonSrc),
  'C5 两个切回都把同步结果带进 outcome（写进桌面日志）');

// sync-now 路由
ok(/resolveSyncNowSources\(accounts\.map\(\(a\) => a\.uid\), targetUid,/.test(daemonSrc), 'C6 sync-now 用解析函数决定源账号');
ok(/sourceUids: resolved\.sources/.test(daemonSrc) && /allSources: !resolved\.explicit/.test(daemonSrc),
  'C7 响应里透出实际源账号与「是否留空展开」');
ok(/for \(const sourceUid of resolved\.sources\)/.test(daemonSrc) && /reused = true/.test(daemonSrc),
  'C8 逐个源账号起任务 + 已排队的同向任务复用');
ok(/留空表示「除目标账号以外的所有账号」/.test(daemonSrc), 'C9 路由注释写明了留空语义');

// 桌面日志
const copyLine = logMod.__proto__ ? null : null; // 占位，避免误用
const switchedReport = logMod.buildIdleSwitchBackReport({
  at: Date.now(),
  plan: { idleMs: 1900000, minutes: 30, fromUid: 'b', fromNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' },
  outcome: { status: 'switched', primaryUid: 'a', primaryNickname: '主账号A', autoCopy: { jobId: 'j1', total: 7 } },
});
ok(/顺带做了/.test(switchedReport) && /共 7 个/.test(switchedReport), 'C10 闲置切回日志写明同步了多少个会话', switchedReport.slice(0, 200));
const noCopyReport = logMod.buildIdleSwitchBackReport({
  at: Date.now(),
  plan: { idleMs: 1900000, minutes: 30, fromUid: 'b', fromNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' },
  outcome: { status: 'switched', primaryUid: 'a', primaryNickname: '主账号A', autoCopy: null },
});
ok(/没有开启「自动复制」/.test(noCopyReport), 'C11 没同步时也要说明「本来就没有」', noCopyReport.slice(-120));
const limitReport = logMod.buildSwitchBackReport({
  at: Date.now(),
  plan: { toUid: 'b', toNickname: '账号B', primaryUid: 'a', primaryNickname: '主账号A' },
  outcome: { status: 'switched', primaryUid: 'a', primaryNickname: '主账号A', elapsedMs: 1000, autoCopy: { jobId: 'j2', total: 2 } },
});
ok(/共 2 个/.test(limitReport), 'C12 限流切回日志同样写明同步数量');

// 前端：立即同步弹窗
ok(injectSrc.indexOf('id="wbs-sess-sync-source"') >= 0, 'C13 弹窗有「源账号」下拉');
ok(injectSrc.indexOf('留空 = 除目标外的所有账号') >= 0, 'C14 源下拉第一项就是「留空」并写明含义', true);
ok(injectSrc.indexOf('id="wbs-sess-sync-target"') >= 0 && /if \(curUid\) targetSel\.value = curUid;/.test(injectSrc),
  'C15 目标账号默认选中当前账号');
ok(/var sourceUid = String\(\(sourceSel && sourceSel\.value\) \|\| ''\);/.test(injectSrc), 'C16 源账号可以留空（不做非空校验）');
ok(/sourceUid && sourceUid === targetUid/.test(injectSrc) && /源账号与目标账号不能相同/.test(injectSrc),
  'C17 前端也拦一次「源=目标」');
ok(/body: JSON\.stringify\(\{ targetUid: targetUid, sourceUid: sourceUid, force: forceNow \}\)/.test(injectSrc), 'C18 提交时带上 sourceUid 与是否强制覆盖');
ok(/res\.allSources \? '已开始同步：'/.test(injectSrc), 'C19 留空时提示「N 个源账号 → 目标账号」');
ok(/源账号留空<\/b> = 除目标账号以外的每个账号各同步一次/.test(injectSrc), 'C20 弹窗里用大白话说明了留空行为');
ok(/class="wbs-sync-note"/.test(injectSrc) && /\.wbs-sync-note\{/.test(injectSrc),
  'C20b 「留空说明」放在普通说明样式里（提醒才用红色 warn，别整块都是红的）');
ok(!/源账号：' \+ esc\(cur/.test(injectSrc), 'C21 旧的「源账号固定 = 当前账号」那行已去掉');
ok(injectSrc.indexOf('id="wbs-sess-sync-force"') >= 0, 'C22 弹窗有「强制覆盖（以源账号为准）」勾选');
ok(/if \(blank\) blank\.disabled = on;/.test(injectSrc) && /sourceSel\.selectedIndex = 1;/.test(injectSrc),
  'C23 勾上后禁掉源下拉的「留空」项并自动落到第一个具体账号（与服务端同源，不靠 400 兜底）');
ok(/if \(forceNow && !sourceUid\) \{ toast\('强制覆盖必须选择源账号'/.test(injectSrc),
  'C24 前端也拦一次「强制覆盖 + 源留空」');
ok(/resolveSyncNowSources\(accounts\.map\(\(a\) => a\.uid\), targetUid, \(body && body\.sourceUid\) \|\| '', \{ force \}\)/.test(daemonSrc),
  'C25 路由把 force 交给解析函数（由它统一判「必须点名源账号」）');
ok(/&& !!job\.force === force/.test(daemonSrc),
  'C26 同向任务复用必须 force 一致（否则点了强制会接到非强制的在跑任务上，以为覆盖过了其实没动）');
ok(/startAutoCopyJob\(sourceUid, targetUid, \[\], null, \{ force \}\)/.test(daemonSrc),
  'C27 起任务时把 force 带进任务队列（与切号触发的复制共享同一串行语义）');

// 前端：折叠卡片
ok(injectSrc.indexOf('id="wbs-idle-toggle"') >= 0 && injectSrc.indexOf('id="wbs-idle-body"') >= 0,
  'C22 卡片有折叠头 + 可折叠主体');
ok(injectSrc.indexOf('id="wbs-idle-summary"') >= 0, 'C23 收起时用一行摘要交代状态（不是藏起来）');
ok(/var collapsed = info\.collapsed !== false;/.test(injectSrc) && /classList\.toggle\('collapsed', collapsed\)/.test(injectSrc),
  'C24 折叠状态来自后端配置');
ok(/saveIdleCard\(\{ collapsed: next \}\)/.test(injectSrc), 'C25 点折叠头会把状态存回后端（切号刷新页面不丢）');
ok(/\.wbs-idle-card\.collapsed \.wbs-idle-body\{display:none\}/.test(injectSrc), 'C26 收起样式');
ok(/\.wbs-idle-chevron\{/.test(injectSrc) && /\.wbs-idle-card:not\(\.collapsed\) \.wbs-idle-chevron\{transform:rotate\(45deg\)\}/.test(injectSrc),
  'C27 箭头随展开状态旋转');
ok(/function idleSummaryText\(info\)/.test(injectSrc), 'C28 摘要文案函数在位');
const idleMod = fs.readFileSync(path.join(ROOT, 'scripts', 'idle-switchback.js'), 'utf8');
ok(/collapsed: r\.collapsed === undefined \|\| r\.collapsed === null \? DEFAULTS\.collapsed : !!r\.collapsed/.test(idleMod),
  'C29 配置里持久化 collapsed');
ok(/const DEFAULTS = \{ enabled: true, minutes: 30, collapsed: true \};/.test(idleMod), 'C30 默认收起（把版面还给账号列表）');
ok(/if \(body && body\.collapsed !== undefined\) patch\.collapsed = !!body\.collapsed;/.test(daemonSrc),
  'C31 POST /api/idle-switchback 接受 collapsed');

console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
failures.forEach((name) => console.log('  未通过: ' + name));
process.exit(failures.length ? 1 : 0);
