'use strict';
/*
 * test-cloud-ghosts.js —— 「云端残留（幽灵会话）」检测与清理的行为/结构测试。
 *
 * 背景（2026-09-16 实测结论，见 scripts/cloud-cleanup.js 顶部）：
 *   桌面删除只删本地，而手机端/其它电脑读的是**云端那份**；删除不会通知云端。
 *   云侧 `cloudAgentDeleteConversation` / `cloudAgentGetConversationDetail` 都**按当前登录账号**鉴权：
 *     · 删自己的           → 正常
 *     · 删别的账号的       → `conversation access denied`（**这是"存在"的证据**）
 *     · 问不存在的 id      → `conversation not found`
 *   所以：access denied 必须判成 exists，且跨账号残留只能切号清理。
 *
 * 覆盖：
 *   A. 纯逻辑（require scripts/cloud-cleanup.js）：通道解析 / 错误分类 / 探测判定 /
 *      分组计划 / 计数 / 清单归一 / 结果小结 / 跨设备提示。
 *   B. daemon 源码断言：两个路由、删除后挂钩、CDP 表达式自包含、切号清理必切回。
 *   C. inject 源码断言：卡片 DOM（折叠）、按钮语义、删除确认的跨设备提示、i18n 词条。
 *   D. HTTP 集成（**只用不存在的 id**，不会删掉任何真实数据）：
 *        D1 ghost 检测形状；D2 uid 过滤；D3 purge 空选择 → 400；
 *        D4 purge 不存在的 id → 云端回 not found → 记 skip 而不是失败；
 *        D5 purge 指定非当前账号 → other-account 拦下，**根本不碰云端**。
 *
 * 跑法：node .wd-analysis/test-cloud-ghosts.js
 *      D 段需要本机 daemon 在 127.0.0.1:47832 跑着；不在就自动跳过（不判失败）。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');
const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'inject.js'), 'utf8');
const cleanup = require(path.join(ROOT, 'scripts', 'cloud-cleanup.js'));

let pass = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
}
function section(title) { console.log('\n' + title); }

/* ==================================================================== */
/* A. 纯逻辑                                                             */
/* ==================================================================== */

section('[A] cloud-cleanup.js 纯逻辑');

ok(typeof cleanup.parseCloudChannel('convmsg:abc-123') === 'string' &&
  cleanup.parseCloudChannel('convmsg:abc-123') === 'abc-123',
  'A1 convmsg:<uid> 能解析出归属账号', cleanup.parseCloudChannel('convmsg:abc-123'));
ok(cleanup.parseCloudChannel('msg:abc') === '', 'A2 非法前缀返回空串（调用方据此判"账号未知"）');
ok(cleanup.parseCloudChannel(null) === '' && cleanup.parseCloudChannel(undefined) === '',
  'A3 null/undefined 不抛异常');
ok(cleanup.parseCloudChannel('  convmsg: x  ') === 'x', 'A4 去掉两侧空白');

ok(cleanup.classifyCloudError({ code: '4002', message: 'conversation access denied' }).kind === 'denied',
  'A5 access denied → denied');
ok(cleanup.classifyCloudError({ message: 'conversation not found' }).kind === 'missing',
  'A6 not found → missing');
ok(cleanup.classifyCloudError({ message: 'conversation 2a616066 not found for user 827977d7' }).kind === 'missing',
  'A7 带 user 的 not found → missing');
ok(cleanup.classifyCloudError({ message: 'Request failed with status code 429' }).kind === 'rate-limited',
  'A8 429 → rate-limited');
ok(cleanup.classifyCloudError({ message: 'WorkBuddy 未连接，无法读取页面状态' }).kind === 'offline',
  'A9 CDP 断连 → offline');
ok(cleanup.classifyCloudError({ message: 'boom' }).kind === 'error', 'A10 其它 → error');
ok(cleanup.classifyCloudError(null).kind === 'error', 'A11 null 输入不抛');
ok(cleanup.classifyCloudError({ message: 'ACCESS DENIED' }).kind === 'denied', 'A12 大小写不敏感');

ok(cleanup.interpretProbe({ ok: true, value: { id: 'x' } }) === 'exists', 'A13 有返回体 → exists');
ok(cleanup.interpretProbe({ ok: false, error: { message: 'conversation access denied' } }) === 'exists',
  'A14 **access denied 判成 exists**（存在但不归当前账号）');
ok(cleanup.interpretProbe({ ok: false, error: { message: 'conversation abc not found' } }) === 'missing',
  'A15 not found → missing');
ok(cleanup.interpretProbe({ ok: false, error: { message: 'status code 429' } }) === 'unknown',
  'A16 限流 → unknown（不能当"不存在"处理）');
ok(cleanup.interpretProbe(null) === 'unknown', 'A17 空结果 → unknown');

const plan = cleanup.planCloudGhosts({
  currentUid: 'AAA',
  localIds: ['keep-local'],
  candidates: [
    { id: 'c1', uid: 'AAA', state: 'exists' },
    { id: 'c2', uid: 'BBB', state: 'exists' },
    { id: 'c3', uid: 'AAA', state: 'missing' },
    { id: 'c4', uid: 'AAA', state: 'unknown' },
    { id: 'keep-local', uid: 'AAA', state: 'exists' },
    { id: 'c6', uid: '', state: 'exists' },
    { id: 'c1', uid: 'AAA', state: 'exists' },
  ],
});
ok(plan.current.length === 1 && plan.current[0].id === 'c1', 'A18 归当前账号 → current（可直删）', plan.current);
ok(plan.other.length === 2 && plan.other.map((x) => x.id).sort().join() === 'c2,c6',
  'A19 归别账号 + **账号未知** → other（保守：宁可要切号也不误删）', plan.other);
ok(plan.missing.length === 1 && plan.missing[0].id === 'c3', 'A20 云端已无 → missing', plan.missing);
ok(plan.unknown.length === 1 && plan.unknown[0].id === 'c4', 'A21 探测无结论 → unknown', plan.unknown);
ok(!plan.current.concat(plan.other, plan.missing, plan.unknown).some((x) => x.id === 'keep-local'),
  'A22 本地仍存在的会话不算残留');
ok(plan.current.length + plan.other.length + plan.missing.length + plan.unknown.length === 5,
  'A23 重复候选去重（7 条输入 → 去重 6 条 → 扣掉本地仍在的 1 条 = 入组 5 条）',
  plan.current.length + plan.other.length + plan.missing.length + plan.unknown.length);

const sum = cleanup.summarizeGhostPlan(plan);
ok(sum.deletable === 1 && sum.needsSwitch === 2 && sum.alreadyGone === 1 && sum.unknown === 1 && sum.total === 5,
  'A24 summarizeGhostPlan 字段固定', sum);
ok(cleanup.summarizeGhostPlan(null).total === 0, 'A25 summarizeGhostPlan 空输入安全');

const sel = cleanup.normalizePurgeSelection(['a-1', 'a-1', '', 'bad id!', 'b_2', null, 'x'.repeat(300)]);
ok(sel.ids.join() === 'a-1,b_2', 'A26 清单归一：去重 + 剔非法', sel.ids);
ok(sel.dropped === 5, 'A27 统计被丢弃的条数', sel.dropped);
ok(cleanup.normalizePurgeSelection(Array.from({ length: 260 }, (_, i) => 'id' + i)).ids.length === cleanup.MAX_PURGE_BATCH,
  'A28 超批上限被截断');
ok(cleanup.normalizePurgeSelection(Array.from({ length: 260 }, (_, i) => 'id' + i)).truncated === 60,
  'A29 报告截断条数');
ok(cleanup.normalizePurgeSelection(null).ids.length === 0, 'A30 非数组输入安全');

const run = cleanup.summarizePurgeRun({
  requested: 5, deleted: 3, skipped: 1,
  failed: [{ id: 'x', reason: 'denied' }, { id: 'y', reason: 'denied' }, { id: 'z', reason: 'rate-limited' }],
});
ok(run.requested === 5 && run.deleted === 3 && run.failed === 3 && run.skipped === 1,
  'A31 summarizePurgeRun 计数', run);
ok(run.reasons.denied === 2 && run.reasons['rate-limited'] === 1, 'A32 失败原因分类汇总', run.reasons);

ok(typeof cleanup.deleteCrossDeviceNotice() === 'string' && cleanup.deleteCrossDeviceNotice().indexOf('其它设备') >= 0,
  'A33 跨设备提示文案存在', cleanup.deleteCrossDeviceNotice());
ok(typeof cleanup.CLOUD_DELETE_METHOD === 'string' && cleanup.CLOUD_DELETE_METHOD.indexOf('cloudAgent') === 0,
  'A34 方法名常量是云侧 RPC 名', cleanup.CLOUD_DELETE_METHOD);

/* ==================================================================== */
/* B. daemon 源码断言                                                    */
/* ==================================================================== */

section('[B] daemon 源码结构');

ok(/p === '\/api\/cloud\/ghosts'/.test(daemonSrc), 'B1 有 GET /api/cloud/ghosts 路由');
ok(/p === '\/api\/cloud\/ghosts\/purge'/.test(daemonSrc), 'B2 有 POST /api/cloud/ghosts/purge 路由');
ok(/cloudCleanup = require\('\.\/cloud-cleanup\.js'\)/.test(daemonSrc), 'B3 已引入 cloud-cleanup 模块');

const hookCalls = (daemonSrc.match(/purgeCloudCopiesAfterLocalDelete\(/g) || []).length;
ok(hookCalls === 3, 'B4 删除后挂钩：1 处定义 + 2 处调用（delete / purge-copy）', hookCalls);
ok(/log\('\[sessions-purge\] 已删除单份副本[\s\S]{0,400}?purgeCloudCopiesAfterLocalDelete\(\[id\]/.test(daemonSrc),
  'B5 purge-copy 删完顺带清云端');
ok(/\[sessions-delete\] by=[^\]]*mode=[\s\S]{0,600}?purgeCloudCopiesAfterLocalDelete\(matchedIds/.test(daemonSrc),
  'B6 sessions/delete 删完顺带清云端');

ok(/function pickWorkbuddyDaemonClient\(\)/.test(daemonSrc), 'B7 渲染层取 daemon 客户端的函数存在');
ok(/__reactFiber\$|__reactContainer\$/.test(daemonSrc) && /daemonClient/.test(daemonSrc),
  'B8 走 React fiber 找 .daemonClient');
ok(/dc\.cloudAgentDeleteConversation === 'function'|typeof dc\.cloudAgentDeleteConversation === 'function'/.test(daemonSrc),
  'B9 取客户端时按云删能力判形状（不依赖类名）');
ok(/function cloudAgentCallExpression\(method, params\)/.test(daemonSrc), 'B10 表达式拼装函数存在');
ok(/pickWorkbuddyDaemonClient\.toString\(\)/.test(daemonSrc),
  'B11 表达式**自包含**（注入函数本体，不依赖页面残留缓存 —— 切号 reload 后旧引用会失效）');
ok(/code:"NO-CLIENT"/.test(daemonSrc) && /code:"NO-METHOD"/.test(daemonSrc),
  'B12 取不到客户端/方法时返回结构化错误，不外抛');
ok(/async function cloudAgentCall\(method, params\)[\s\S]{0,400}?cdp\.connected/.test(daemonSrc),
  'B13 未连 CDP 时直接返回 CDP-OFFLINE');

ok(/function edgeSyncMappingDbPath\(dataRoot\)/.test(daemonSrc), 'B14 edge-sync 映射库定位函数存在');
ok(/edge-sync-mapping\(\?:-v\(\\d\+\)\)\?\\\.db/.test(daemonSrc) || /edge-sync-mapping/.test(daemonSrc),
  'B15 按版本后缀取最新映射库（不写死 v4，WorkBuddy 升级后会变）');
ok(/SELECT session_id, conversation_id, msg_channel FROM edge_sync_mapping/.test(daemonSrc),
  'B16 读映射表的 SQL 固定');
ok(/localIds\.has\(id\)[\s\S]{0,80}?continue/.test(daemonSrc),
  'B17 本地仍存在的会话被排除（只把"本地已没"的当残留候选）');

ok(/function purgeCloudGhostsSwitching\(targetUid, options\)/.test(daemonSrc), 'B18 切号清理函数存在');
ok(/finally \{\s*await switchBack\(\);/.test(daemonSrc) || /finally \{[\s\S]{0,200}?switchBack\(\)/.test(daemonSrc),
  'B19 **finally 里切回原账号**（失败也要切回，不能把用户留在别的账号上）');
ok(/other-account/.test(daemonSrc), 'B20 跨账号在未获同意时被拦下并说明原因');
ok(/function waitCloudClientReady\(timeoutMs\)/.test(daemonSrc), 'B21 切号后等渲染层就绪');
ok(/restored = true/.test(daemonSrc), 'B22 回报是否已切回');

/* ==================================================================== */
/* C. inject 源码断言                                                    */
/* ==================================================================== */

section('[C] inject 源码结构');

ok(injectSrc.indexOf('id="wbs-cloud-card"') >= 0, 'C1 卡片 DOM 存在');
ok(injectSrc.indexOf('id="wbs-cloud-head"') >= 0 && injectSrc.indexOf('aria-expanded="false"') >= 0,
  'C2 折叠头 + 默认 aria-expanded=false');
ok(/id="wbs-cloud-body" hidden/.test(injectSrc), 'C3 内容区默认 hidden');
ok(/function wireCloudCard\(\)/.test(injectSrc) && /wireCloudCard\(\);/.test(injectSrc),
  'C4 绑定函数已定义**且被调用**（漏调用会静默失效 —— 本轮真机就是这么抓到的）');
ok(/if \(open && !cloudState\.report && !cloudState\.busy\) checkCloudGhosts\(\);/.test(injectSrc),
  'C5 展开时自动检测一次');
ok(/data-cloud-switch="' \+ \(mine \? '0' : '1'\)/.test(injectSrc), 'C6 按钮按"是否本账号"分流');
ok(/'立即清理' : '切到该账号清理'/.test(injectSrc), 'C7 两种按钮文案');
ok(/cloudState\.armed !== uid/.test(injectSrc), 'C8 跨账号走**两段式确认**（切号会 reload，不能一点就切）');
ok(/switchAccount: isSwitch/.test(injectSrc), 'C9 把是否切号显式传给后端');
ok(/'\/api\/cloud\/ghosts'/.test(injectSrc) && /'\/api\/cloud\/ghosts\/purge'/.test(injectSrc),
  'C10 前端调的正是这两个端点');

ok(injectSrc.indexOf('本机删除不会同步到其它设备') >= 0, 'C11 删除确认里有跨设备提示');
const noticeHits = (injectSrc.match(/wbs-modal-note">本机删除不会同步到其它设备/g) || []).length;
ok(noticeHits === 2, 'C12 级联/非级联两条删除路径**都**加上了提示', noticeHits);
ok(/'本机删除不会同步到其它设备，手机端／其它电脑上仍可能看到这些会话。'/.test(injectSrc),
  'C13 i18n 词条齐全（英文）');
ok(/'云端残留': 'Cloud leftovers'/.test(injectSrc), 'C14 卡片标题可翻译');

ok(/\.wbs-cloud-head\{[^}]*cursor:pointer/.test(injectSrc), 'C15 折叠头有 pointer 光标');
ok(/\.wbs-cloud-btn-armed\{border-color:#e24b4a/.test(injectSrc), 'C16 确认态按钮有红色警示');

/* ==================================================================== */
/* D. HTTP 集成（只用不存在的 id，绝不删真实数据）                        */
/* ==================================================================== */

(async () => {
  section('[D] HTTP 集成（不触碰真实数据）');
  const TOKEN_FILE = path.join(process.env.APPDATA || '', 'WorkDaddy', '.api-token');
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
    const live = String((probe.body && probe.body.buildId) || '');
    console.log('  info  daemon buildId = ' + live);
    // 2026-09-17: 原来写死 1\.3\.0，daemon 升到 1.3.1 后每个阶段都误报。放宽到 1.3.x。
    // 2026-09-19: 1.3.x 也是钉死小版本 —— 融合上游升到 1.4.0 后立刻误报。改成「自建构建前缀 + 日期形态」，
    // 与 test-limit-switchback 的 W16n 同口径：只要求「跑的是自建构建」，不要求某个具体版本。
    ok(/^(selfhost|release)-\d+\.\d+\.\d+-\d{8}-/.test(live), 'D0 跑的是自建构建（别在旧 daemon 上测新代码）', live);

    const g = await apiCall('GET', '/api/cloud/ghosts?probe=0');
    ok(g.status === 200 && g.body && g.body.ok === true, 'D1 ghost 检测返回 200/ok', g.status);
    ok(g.body && typeof g.body.currentUid === 'string', 'D2 带上当前登录账号', g.body && g.body.currentUid);
    ok(g.body && g.body.summary && typeof g.body.summary.total === 'number', 'D3 带 summary 计数', g.body && g.body.summary);
    ok(g.body && Array.isArray(g.body.accounts) && g.body.accounts.length > 0, 'D4 带账号清单（前端要渲染名字）');
    ok(g.body && g.body.plan && Array.isArray(g.body.plan.other), 'D5 带 plan 四分组');
    ok(g.body && typeof g.body.mappingReady === 'boolean', 'D6 暴露映射库是否可读（失败要能看出来）', g.body && g.body.mappingDb);

    const fu = await apiCall('GET', '/api/cloud/ghosts?probe=0&uid=__wd_no_such_uid__');
    ok(fu.status === 200 && fu.body && fu.body.summary && fu.body.summary.total === 0,
      'D7 uid 过滤：不存在的账号 → 0 条候选', fu.body && fu.body.summary);

    const empty = await apiCall('POST', '/api/cloud/ghosts/purge', {});
    ok(empty.status === 400, 'D8 purge 空选择 → 400（不会误清）', empty.status);

    // 2026-09-22 实测（探针 .wd-analysis/probe-cloud-delete-semantics.js，同一伪造 UUID 对照）：
    //   cloudAgentDeleteConversation({conversationId}) → **不抛异常、返回 undefined**（幂等）
    //   cloudAgentGetConversationDetail({conversationId}) → 抛 4002 `conversation not found`
    // 文件头记录的 2026-09-16「问一个不存在的 id → conversation not found」**对 delete 已失效**（对 detail 仍成立）。
    // ⇒ 不能再断言 `deleted === 0`：云端不再回 not found，daemon 只能把「云端接受」记成 deleted。
    // 改为断言**与云端语义无关的守恒式**：这一个 id 要么记 deleted、要么记 skipped，绝不能进 failed。
    const nothing = await apiCall('POST', '/api/cloud/ghosts/purge', { ids: ['__wd_missing_uuid_probe__'] });
    const nb = nothing.body || {};
    const accounted = Number(nb.deleted || 0) + Number(nb.skipped || 0);
    console.log('  info  对不存在的 id：deleted=' + nb.deleted + ' skipped=' + nb.skipped +
      ' failed=' + ((nb.failed || []).length) + '（云端回什么就记什么，二者之和必须为 1）');
    ok(nothing.status === 200 && nb.ok === true,
      'D9 purge 不存在的 id → 200/ok（云端回 not found 或幂等成功都不得报错）', { deleted: nb.deleted, skipped: nb.skipped });
    ok(accounted === 1 && Number(nb.requested || 0) === 1,
      'D10 这一个 id 必须被记账（deleted + skipped === 1，不多不少）', accounted);
    ok(Array.isArray(nb.failed) && nb.failed.length === 0,
      'D11 云端"本来就没有"绝不算失败', nb.failed);

    const guarded = await apiCall('POST', '/api/cloud/ghosts/purge', {
      ids: ['__wd_missing_uuid_probe2__'], uid: '__wd_other_account__',
    });
    ok(guarded.status === 200 && guarded.body && guarded.body.failed && guarded.body.failed.length === 1 &&
      guarded.body.failed[0].reason === 'other-account',
      'D12 指定非当前账号 → other-account 拦下（**根本不碰云端**）', guarded.body && guarded.body.failed);
    ok(guarded.body && guarded.body.deleted === 0, 'D13 被拦下的那条没有产生任何删除', guarded.body && guarded.body.deleted);
  }

  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
})();
