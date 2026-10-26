#!/usr/bin/env node
/**
 * API 网关控制台守卫（2026-10-15 重做）
 *
 * A 集成层行为（真跑 api-gateway.js 的纯函数）—— 重点是新加的 `preserve`（升级不丢用户配置）
 * B daemon 侧（4 条新路由 / 5 个新函数 / install 的三处硬化）
 * C 面板卡片（状态机 / 账号池 / 用法 / 日志 / 无旧哑按钮写法）
 *
 * 汇总行格式：结果：N 通过 / M 失败
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const gw = require(path.join(ROOT, 'scripts/api-gateway.js'));
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts/daemon.js'), 'utf8');
const injectSrc = fs.readFileSync(path.join(ROOT, 'scripts/inject.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('✓ ' + label); }
  else { fail += 1; console.log('✗ ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

// ── A. 集成层：版本 + preserve（升级不丢配置）──
ok(gw.GATEWAY_VERSION === 'v1.13.0', 'A1 钉死版本 = v1.13.0（v1.11.9 → v1.13.0）', gw.GATEWAY_VERSION);
ok(gw.ASSET_NAME === 'wb2api-panel-v1.13.0-windows-amd64.zip', 'A2 资产名自动跟随版本', gw.ASSET_NAME);

const TEMPLATE = {
  listen: ':7863',
  api_key: '',
  auth_dir: '',
  state_file: '',
  server: { read_timeout: '300s' },
  panel: { package_detail_limit: 5 },
  logging: { request_archive_enabled: true, request_retention_days: 7, request_archive_max_mb: 100 },
  cooldown: { soft_rate: '600s', soft_rate_max: '2h' },
  schedule: {
    checkin_hours: [9, 21], growth_hours: [1],
    checkin_enabled: true, growth_enabled: true, travel_enabled: true,
    activity_enabled: true, keepalive_enabled: true, blackcat_enabled: true,
    balance_refresh_enabled: true, include_disabled_in_tasks: false,
  },
  global: { enabled: true },
  upstream: { timeout_seconds: 120, header_timeout_seconds: 120 },
  features: { sanitize_blacklist_fingerprints: true },
  prompt: { mode: 'custom', file: '' },
  upstash: { url: '', token: '' },
  pool: { max_in_flight: 3, credit_floor: 100, max_in_flight_global: 2 },
  session_sticky: { enabled: true, ttl: '30m' },
};

const base = gw.buildGatewayConfig({
  template: TEMPLATE, port: 7863, apiKey: 'K1', authDir: 'D:/a', stateFile: 'D:/s.json',
});
ok(base.listen === '127.0.0.1:7863', 'A3 listen 锁回环（安全默认 ①）');
ok(base.prompt.mode === 'passthrough', 'A4 prompt 强制 passthrough');
ok(base.logging.request_archive_enabled === false, 'A5 归档强制关闭（不落请求正文）');
ok(Object.keys(base.schedule).filter((k) => /_enabled$/.test(k)).every((k) => base.schedule[k] === false), 'A6 定时任务全部强制关闭（安全默认 ③）');
ok(base.schedule.include_disabled_in_tasks === false, 'A7 新键 include_disabled_in_tasks 随模板保留默认');

// 升级场景：旧配置里用户改过的值
const OLD = JSON.parse(JSON.stringify(base));
OLD.pool.max_in_flight = 7;                 // 用户改过 → 应保留
OLD.upstream.timeout_seconds = 240;         // 用户改过 → 应保留
OLD.upstream.header_timeout_seconds = 60;   // 用户改过 → 应保留
OLD.upstream.idle_timeout_seconds = 999;    // 新模板没这个键 → 应丢弃
OLD.server.max_body_mb = 8;                 // 上游已废弃的键（模板没有）→ 应丢弃
OLD.schedule.checkin_hours = [7, 19];       // 时间表 → 应保留
OLD.schedule.checkin_enabled = true;        // 开关 → 不得生效（仍强制关）
OLD.prompt.mode = 'custom';                 // → 不得生效（仍 passthrough）
OLD.listen = ':9999';                       // 管理键 → 不得生效
OLD.api_key = 'OLD_KEY';                    // 管理键 → 不得生效

const upgraded = gw.buildGatewayConfig({
  template: TEMPLATE, preserve: OLD, port: 7863, apiKey: 'K2', authDir: 'D:/a', stateFile: 'D:/s.json',
});
ok(upgraded.pool.max_in_flight === 7, 'A8 preserve：用户改过的 pool.max_in_flight 被保留', upgraded.pool.max_in_flight);
ok(upgraded.pool.credit_floor === 100, 'A9 preserve：新版本新增键仍取模板默认', upgraded.pool.credit_floor);
ok(upgraded.upstream.timeout_seconds === 240 && upgraded.upstream.header_timeout_seconds === 60, 'A10 preserve：upstream 嵌套键逐个合并');
ok(upgraded.upstream.idle_timeout_seconds === undefined, 'A11 preserve：新模板没有的键被丢弃（不带回旧值）', upgraded.upstream.idle_timeout_seconds);
ok(upgraded.server.max_body_mb === undefined, 'A12 preserve：上游已废弃键（server.max_body_mb）不被带回');
ok(JSON.stringify(upgraded.schedule.checkin_hours) === '[7,19]', 'A13 preserve：schedule 的时间表保留');
ok(upgraded.schedule.checkin_enabled === false, 'A14 preserve：schedule 的 *_enabled 仍被强制关（用户旧值不生效）');
ok(upgraded.prompt.mode === 'passthrough', 'A15 preserve：prompt.mode 不参与保留（仍强制 passthrough）');
ok(upgraded.listen === '127.0.0.1:7863' && upgraded.api_key === 'K2', 'A16 preserve：管理键（listen/api_key）不被旧值污染');
ok(base.pool.max_in_flight === 3, 'A17 不传 preserve 时行为与旧版一致（零回归）');
ok(gw.buildGatewayConfig({ template: TEMPLATE, preserve: null, port: 1, apiKey: 'x', authDir: 'a', stateFile: 'b' }).listen === '127.0.0.1:1', 'A18 preserve 传 null 安全');
ok(JSON.stringify(TEMPLATE.schedule.checkin_hours) === '[9,21]', 'A19 buildGatewayConfig 不改动入参模板（无副作用）');

// ── B. daemon 侧 ──
['/api/gateway/pool', '/api/gateway/log', '/api/gateway/set-enabled', '/api/gateway/probe'].forEach((r, i) => {
  ok(daemonSrc.includes("p === '" + r + "'"), 'B1.' + (i + 1) + ' 路由 ' + r);
});
['gatewayHealthSnapshot', 'normalizeGatewayHealth', 'gatewayPoolSnapshot', 'gatewayFetchJson', 'gatewayLogTail'].forEach((f, i) => {
  ok(daemonSrc.includes('function ' + f + '('), 'B2.' + (i + 1) + ' 函数 ' + f);
});
ok(daemonSrc.includes("gatewayProbeHealth(snapshot.port, false)") === false, 'B3 /api/gateway 不再直接探活（改走缓存）');
ok(daemonSrc.includes('gatewayHealthSnapshot(snapshot.port, false)'), 'B3b /api/gateway 走缓存快照');
ok(daemonSrc.includes('healthyAccounts: Number(info.healthy) || 0'), 'B4 healthz 的 healthy（可用账号数）被正确归一，不当布尔用');
ok(daemonSrc.includes('autoStart: gatewayReadEnabled()'), 'B5 status 透出「自动拉起」意图');
ok(daemonSrc.includes('versionDrift:'), 'B6 status 透出版本漂移（供面板提示升级）');
ok(daemonSrc.includes('registeredModelCount:'), 'B7 status 透出已注册模型数');
ok(daemonSrc.includes('// ⭐ 升级前必须先停'), 'B8 install 覆盖 exe 前先停进程（Windows 文件占用）');
ok(daemonSrc.includes('// ⭐ 复用既有密钥'), 'B9 install 复用既有 api_key（换密钥会让已注册模型全部 401）');
ok(daemonSrc.includes('preserve: previous'), 'B10 install 把旧 config 传给 buildGatewayConfig（升级不丢配置）');
ok(daemonSrc.includes('restarted: wasRunning'), 'B11 install 装完把原本在跑的进程拉回来');
ok(daemonSrc.includes('gatewayHealthCache = { at: 0, info: null };'), 'B12 install 后作废探活缓存');
ok(/gatewayPoolSnapshot[\s\S]{0,2200}?uid:[\s\S]{0,200}?nickname:/.test(daemonSrc), 'B13 池快照是**白名单**映射（逐字段挑，不整份透传）');
ok(!/json\(res, 200, \{ ok: true, pool: payload \}\)/.test(daemonSrc), 'B14 绝不把网关 /status 原始 payload 直接回给前端');
// —— 外部实例（daemon 重启后网关仍在跑）——
ok(daemonSrc.includes('function gatewayFindPidByPort('), 'B15 有「按端口反查 pid」（外部实例停止/升级要用）');
ok(daemonSrc.includes('const running = ownRunning || !!gatewayHealthCache.info;'), 'B16 status 的 running 用探活兜底（不谎报未运行）');
ok(daemonSrc.includes('ownsProcess: ownRunning'), 'B17 status 区分「本进程持有句柄」');
ok(daemonSrc.includes("return { stopped: true, pid: pid, mode: 'external' };"), 'B18 停止支持外部实例（taskkill 按 pid）');
ok(daemonSrc.includes("log('[gateway] 检测到已在运行的实例，跳过拉起');"), 'B19 启动时先探活，已有实例不重复拉起');
ok(/gatewayProbeHealth\(port, 1500\)\.then\(\(alive\) =>/.test(daemonSrc), 'B20 探活在拉起之前（异步判定）');
ok(daemonSrc.includes("if (IS_WIN) spawnSync('taskkill', ['/PID', String(pid), '/F']"), 'B21 Windows 用 taskkill /F 结束外部实例');

// ── C. 面板卡片 ──
['wbs-gw-meta', 'wbs-gw-pool', 'wbs-gw-actions', 'wbs-gw-usage', 'wbs-gw-log', 'wbs-gw-auto', 'wbs-gw-alert'].forEach((t, i) => {
  ok(injectSrc.includes(t), 'C1.' + (i + 1) + ' 卡片含 ' + t);
});
['gwRenderPool', 'gwFetchPool', 'gwCopyUsage', 'gwToggleLog', 'gwArm'].forEach((f, i) => {
  ok(injectSrc.includes('function ' + f + '('), 'C2.' + (i + 1) + ' 前端函数 ' + f);
});
ok(injectSrc.includes("el('button', 'wbs-mini-btn'"), 'C3 按钮改用通用 mini-btn 样式类');
ok(injectSrc.includes('.wbs-mini-btn:disabled'), 'C3b 有禁用态样式');
ok(injectSrc.includes('if (enabled === false) b.disabled = true;'), 'C4 按钮按状态禁用（消除「没装也能点启动」）');
ok(injectSrc.includes("mk('启动', 'start', '', '', installed && !running)") && injectSrc.includes("mk('停止', 'stop', '', '', installed && running)"), 'C4b 启动/停止互斥可用');
ok(injectSrc.includes(": '注册模型', 'models', '',", ) && injectSrc.includes('installed && running)'), 'C5 注册模型要求「已装且运行中」（按钮文案随面板开合切换）');
ok(injectSrc.includes("'/api/gateway/set-enabled'"), 'C6 面板接了显式「自动拉起」开关');
ok(injectSrc.includes("'/api/gateway/log?lines=60'"), 'C7 面板接了日志尾部');
ok(injectSrc.includes("'/api/gateway/pool'"), 'C8 面板接了账号池');
ok(injectSrc.includes('data-wbs-i18n-skip'), 'C9 动态数据标记 i18n-skip');
ok(!injectSrc.includes('wbs-gw-info') && !injectSrc.includes("id=\"wbs-gw-open\""), 'C10 初版的哑按钮写法已清除');
ok(injectSrc.includes('gwState.logShown'), 'C11 日志展开态自管（不写 localStorage）');

// ── D 组：外部实例（daemon 重启后失联、网关仍在监听）必须被识别 ──
ok(daemonSrc.includes('const externalPid = ownRunning ? 0 : gatewayFindPidByPort(installPort);'),
  'D1 升级前按端口兜底判定外部实例（只认 gatewayChild 会在覆盖热 exe 时 EBUSY）');
ok(daemonSrc.includes('const wasRunning = ownRunning || !!externalPid;'), 'D1b wasRunning 合并 own 与 external');
ok(daemonSrc.includes("reason: 'already-running-external'"),
  'D2 启动前探测外部实例（否则端口冲突、留下起不来的僵尸子进程）');

// ── H 组：「注册模型」自选面板（2026-10-15）──
ok(injectSrc.includes('id="wbs-gw-models"'), 'H1 卡片含注册模型选择面板容器');
['gwOpenModels', 'gwRenderModels', 'gwModelsTool', 'gwApplyModels', 'gwCreditsNum', 'gwUpdateModelsDiff', 'gwSyncModelsChecks', 'gwCloseModels', 'gwModelBadges'].forEach((f, i) => {
  ok(injectSrc.includes('function ' + f + '('), 'H2.' + (i + 1) + ' 前端函数 ' + f);
});
ok(injectSrc.includes("'data-gwmid'"), 'H3 每行带 data-gwmid（勾选态可回填）');
ok(injectSrc.includes('data-gw="mk-apply"') && injectSrc.includes('data-gw="mk-all"')
  && injectSrc.includes('data-gw="mk-none"') && injectSrc.includes('data-gw="mk-cheap"'),
  'H4 工具条：全选 / 全不选 / 只选便宜 / 应用');
ok(injectSrc.includes('body: JSON.stringify({ selected: ids })'),
  'H5 提交的是选中集合（声明式：名单之外的本网关条目会被摘掉）');
ok(injectSrc.includes("m.registration !== 'absent'"),
  'H6 ⭐ 打开即回填：models.json 里已有的一律勾上（含手工配的同源条目）');
ok(injectSrc.includes("'/api/gateway/models-available'"), 'H7 面板接了可选清单接口');
ok(daemonSrc.includes("p === '/api/gateway/models-available'"), 'H8 daemon 有该路由');
ok(daemonSrc.includes('function gatewayFetchModels(') && daemonSrc.includes('function gatewayModelsOverview(')
  && daemonSrc.includes('function readWorkbuddyModels('), 'H9 daemon 侧三个新函数齐备');
ok(daemonSrc.includes('apiGateway.gatewayModelState(existing, rawId, { baseUrl: fetched.baseUrl, registeredIds: registeredIds })'),
  'H10 ⭐ 用「同源」判据算注册状态，并把 registeredIds 一起传下去（认领过的手工条目要显示「已注册」，否则接线后 5 条全变 absent）');
ok(daemonSrc.includes('apiGateway.mergeGatewayModels(doc.list, entries, { baseUrl: fetched.baseUrl })'),
  'H11 daemon 不再传 overwrite（认领即接管）');
ok(daemonSrc.includes('modelsBackup: backup'), 'H12 写前备份路径入库（可追溯）');
ok(!daemonSrc.includes('registeredModelIds: body && body.remove === true ? [] : registeredIds'),
  'H13 旧的「全有或全无」写入逻辑已移除');
ok(injectSrc.includes('wbs-gw-models-list') && injectSrc.includes('.wbs-gw-mrow{'), 'H14 列表与行样式齐备');
ok(injectSrc.includes('function gwApplyModels(') && injectSrc.includes('if (gwState.modelsShown) gwOpenModels();'),
  'H15 应用成功后刷新状态并重开面板（勾选态不丢）');

// ── I 折叠行 + 大浮层（2026-10-15：平时折叠一行，用时放大成面板级控制台） ──
ok(injectSrc.includes('<div class="wbs-pcard collapsed" id="wbs-gw-card">')
  && injectSrc.includes('id="wbs-gw-expand"') && injectSrc.includes('wbs-fold-chevron'),
  'I1 网关卡默认折叠成一行（pcard collapsed + fold-head + chevron）');
ok(injectSrc.includes("panel.insertAdjacentHTML('beforeend'") && injectSrc.includes('id="wbs-gw-dock" hidden>'),
  'I2 控制台浮层挂在 .wbs-panel 上（挂 pane 会被 .wbs-body 的 overflow 裁切）');
ok(injectSrc.includes('function gwDockEl()') && injectSrc.includes('function gwEl(id) { var d = gwDockEl();'),
  'I3 所有 gw* 取元素改从浮层查（否则内容搬走后 gwRender 全部失效）');
ok(injectSrc.includes("gwDockRoot.addEventListener('change'") && injectSrc.includes("gwDockRoot.addEventListener('click'"),
  'I4 事件委托改绑到浮层（仍绑卡片则浮层里的按钮全哑）');
ok(injectSrc.includes('function gwSetDock(open)')
  && /gwState\.logShown = false;[\s\S]{0,320}gwState\.modelsShown = false;/.test(injectSrc),
  'I5 开/关都把日志与模型面板复位（不残留上次展开态）');
ok(injectSrc.includes("e.key !== 'Escape'") && injectSrc.includes('function gwBindDockKey()')
  && injectSrc.includes('if (gwDockKeyBound) return;'),
  'I6 Esc 收起，且 document 级监听只绑一次');
ok(injectSrc.includes('#wbs-gw-expand[aria-expanded="true"] > .wbs-fold-chevron'),
  'I7 展开时 chevron 旋转（语义挂在 aria-expanded 上，不依赖 collapsed 类）');
ok(injectSrc.includes('.wbs-gw-dock{position:absolute') && injectSrc.includes('.wbs-gw-dock[hidden]{display:none}')
  && injectSrc.includes('html[data-theme="dark"] .wbs-gw-dock'),
  'I8 浮层样式齐备（面板内绝对定位 + 隐藏态 + 暗色适配）');
ok(injectSrc.includes('.wbs-gw-dock .wbs-gw-models-list{max-height:none}')
  && injectSrc.includes('.wbs-gw-dock .wbs-gw-log{max-height:360px}'),
  'I9 浮层内空间更大（模型列表不限高、日志更高）');
ok(!/setupFoldCard\([^)]*wbs-gw-card/.test(injectSrc)
  && !injectSrc.includes("workdaddy.ui.fold.' + PROFILE_ID + '.wbs-gw-card"),
  'I10 折叠态不持久化（未对网关卡调 setupFoldCard ⇒ 每次进面板都是折叠）');
// 内容搬进浮层后，同一 id 在文档里只能出现一次（重复会让 gwEl 取到折叠行里的空节点）
[['wbs-gw-meta'], ['wbs-gw-pool'], ['wbs-gw-actions'], ['wbs-gw-usage'],
 ['wbs-gw-log'], ['wbs-gw-models'], ['wbs-gw-auto'], ['wbs-gw-sub']].forEach(([id]) => {
  const n = (injectSrc.match(new RegExp('id="' + id + '"', 'g')) || []).length;
  ok(n === 1, 'I11 元素 id 唯一：' + id + ' 出现 ' + n + ' 次');
});
ok(injectSrc.includes("var sub = gwCardEl() && gwCardEl().querySelector('#wbs-gw-sub')"),
  'I12 折叠行摘要用卡片查（#wbs-gw-sub 在浮层之外，gwEl 只查浮层 ⇒ 否则摘要永远停在「读取中…」）');

// ── J 用户视角的两件事（2026-10-15 二轮）：浮层铺满 + 「从自定义模型里移除」讲清楚 ──
ok(injectSrc.includes('top:10px;bottom:10px;') && !injectSrc.includes('bottom:auto;min-height:min(560px'),
  'J1 控制台浮层铺满整个面板（不再 bottom:auto 导致下方空半截）');
ok(injectSrc.includes('wbs-gw-models-hint') && injectSrc.includes('取消勾选后点「应用」= 从 WorkBuddy 里移除'),
  'J2 模型面板写明「取消勾选 + 应用 = 从 WorkBuddy 移除」（用户找不到的就是这条）');
ok(injectSrc.includes('data-gw="mk-cancel" title="只关闭这个面板，不改动 models.json">关闭<'),
  'J3 底部「取消」改名「关闭」并标明不改配置（原名易被读成「取消注册」）');
ok(injectSrc.includes("apply.textContent = changed ? ('应用（' + changed + ' 项改动）') : '应用';")
  && injectSrc.includes('apply.disabled = !changed;'),
  'J4 「应用」随改动动态显示数量；无改动时禁用（避免无意义重写 models.json）');
ok(injectSrc.includes("box.classList.toggle('warn', del > 0)") && injectSrc.includes('.wbs-gw-models-diff.warn{'),
  'J5 有「移除」时差异预览标警示色');
ok(injectSrc.includes('取消勾选 → 点「应用」，即可把它从 WorkBuddy 里移除'),
  'J6 「已注册」行 hover 提示写明移除路径');
ok(injectSrc.includes("if (d.rewritten) msg += ' · 更新 ' + d.rewritten;"),
  'J7 toast 区分「更新（原地认领）」与「移除」（否则重写被报成删除，数字虚高吓人）');
ok(daemonSrc.includes('rewritten: result.rewritten') && daemonSrc.includes('rewritten: result.rewritten, skipped: result.skipped.length'),
  'J8 daemon 透传 rewritten（响应体 + 日志）');
// ⭐ 真值验证：这两条就是用户问的「能不能在自定义模型里去掉某个」
const jEntry = gw.toWorkbuddyModelEntry({ id: 'cn:jtest', name: 'J' }, { baseUrl: 'http://127.0.0.1:7863', apiKey: 'K' });
const jRewrite = gw.mergeGatewayModels([{ id: 'gateway:cn:jtest', name: 'old' }], [jEntry], {});
ok(jRewrite.rewritten === 1 && jRewrite.removed === 0 && jRewrite.models.length === 1,
  'J9 同 id 重写 ⇒ rewritten=1 / removed=0（净数量不变就不该报「移除」）', { rewritten: jRewrite.rewritten, removed: jRewrite.removed });
const jDrop = gw.mergeGatewayModels([{ id: 'gateway:cn:jtest' }, { id: 'gateway:cn:jother' }], [jEntry], {});
ok(jDrop.removed === 1 && jDrop.models.length === 1 && jDrop.models[0].id === 'gateway:cn:jtest',
  'J10 ⭐ 取消勾选一个 ⇒ 它真的从 models.json 消失（「从自定义模型里去掉」= 取消勾选 → 应用）',
  { removed: jDrop.removed, left: jDrop.models.map((m) => m.id) });
const jClear = gw.mergeGatewayModels([{ id: 'gateway:cn:a' }, { id: 'gateway:cn:b' }], [], {});
ok(jClear.removed === 2 && jClear.rewritten === 0 && jClear.models.length === 0,
  'J11 全不选 ⇒ 本插件条目全移除（removed 计数正确）', { removed: jClear.removed });

// ── K 打开即回填 + 认领语义（2026-10-15 三轮）──
ok(injectSrc.includes("gwState.models.forEach(function (m) { sel[m.id] = m.registration !== 'absent'; });"),
  'K1 ⭐ 打开面板即回填当前真实状态（本插件写的 + 手工配的同源条目都勾上）');
ok(injectSrc.includes('gwState.modelsBase = Object.assign({}, sel);'),
  'K2 ⭐ diff 以「打开时的快照」为基准（只是打开、没动过 ⇒ 显示无改动）');
ok(injectSrc.includes('var base = gwState.modelsBase || {};') && injectSrc.includes('var now = !!sel[m.id], was = !!base[m.id];'),
  'K3 diff 按「当前勾选 vs 打开时」算新增 / 移除');
ok(injectSrc.includes('打开时已按 <b>当前实际状态</b> 勾好'),
  'K4 面板头说明写明「打开时已按当前实际状态勾好」');
ok(injectSrc.includes('勾选会就地更新它（id 不变）'),
  'K5 「已存在」行的说明改为「就地更新、id 不变」（不再说会顶掉）');
// ⭐ 真值验证：认领保留 id 与名字、只刷新能力字段；取消勾选则真删
const kEntry = gw.toWorkbuddyModelEntry({ id: 'cn:ktest', name: 'KT', context_length: 192000 },
  { baseUrl: 'http://127.0.0.1:7863', apiKey: 'K' });
const kAdopt = gw.mergeGatewayModels(
  [{ id: 'cn:ktest', name: '我的名字', url: 'http://127.0.0.1:7863/v1/chat/completions', maxInputTokens: 1 }],
  [kEntry], { baseUrl: 'http://127.0.0.1:7863' });
ok(kAdopt.models.length === 1 && kAdopt.models[0].id === 'cn:ktest' && kAdopt.models[0].name === '我的名字'
  && kAdopt.models[0].maxInputTokens === 192000 && kAdopt.rewritten === 1 && kAdopt.added === 0,
  'K6 ⭐ 认领：保留 id 与用户起的名字，只把能力字段刷新到网关最新', kAdopt.models[0]);
const kDrop = gw.mergeGatewayModels(kAdopt.models, [], { baseUrl: 'http://127.0.0.1:7863' });
ok(kDrop.models.length === 0 && kDrop.removed === 1,
  'K7 ⭐ 取消勾选（不在名单里）⇒ 真的从 models.json 消失（用户要的「取消」）', kDrop.removed);
const kKeep = gw.mergeGatewayModels(
  [{ id: 'x-other', url: 'http://elsewhere:1/v1/chat/completions' }], [], { baseUrl: 'http://127.0.0.1:7863' });
ok(kKeep.models.length === 1 && kKeep.removed === 0, 'K8 ⭐ 非本网关的模型永不被清理');
const kDup = gw.mergeGatewayModels(
  [{ id: 'gateway:cn:k', url: 'http://127.0.0.1:7863/v1/chat/completions' },
   { id: 'cn:k', url: 'http://127.0.0.1:7863/v1/chat/completions' }],
  [gw.toWorkbuddyModelEntry({ id: 'cn:k' }, { baseUrl: 'http://127.0.0.1:7863' })],
  { baseUrl: 'http://127.0.0.1:7863' });
ok(kDup.models.length === 1, 'K9 ⭐ 历史遗留的「前缀 + 裸 id」重复条目会被去重成一条', kDup.models.map((m) => m.id));

/* ===== [N] 上下文档位调节（2026-10-19）=====
 * 为什么要有：网关注册的条目一律写 maxInputTokens = 网关声明的 context_length（常见 1M），
 * 而 WorkBuddy 没有选上下文的入口 ⇒ 客户端以为窗口无限、迟迟不自己压缩，
 * 历史越堆越长，最后触发客户端裁头（历史头部被整段丢弃）。
 * 这套断言锁三件事：① 只改 maxInputTokens 一个字段；② 0 表示删字段；③ 前端不给未注册行画下拉。
 */
console.log('\n[N] 上下文档位调节');
{
  const injectCode = injectSrc.replace(/\r\n/g, '\n');
  const daemonCode = daemonSrc.replace(/\r\n/g, '\n');

  ok(daemonCode.includes("p === '/api/gateway/set-model-context'"),
    'N1 后端有 set-model-context 路由');
  ok(/function findGatewayModelEntry\(list, rawId, baseUrl, registeredIds\)/.test(daemonCode),
    'N2 有 findGatewayModelEntry（与 gatewayModelState 同一套判据）');
  ok(/function sameGatewayOrigin\(url, baseUrl\)/.test(daemonCode)
    && /apiGateway\.unwrapProxyUrl/.test(daemonCode),
    'N3 ⭐ 同源比较先剥 bili 包裹层（否则接线后永远不同源）');
  // 只改一个字段：出现 entry.maxInputTokens = next，且没有整体重写条目的写法
  const routeIdx = daemonCode.indexOf("p === '/api/gateway/set-model-context'");
  const routeSlice = routeIdx > 0 ? daemonCode.slice(routeIdx, routeIdx + 4800) : '';
  ok(/entry\.maxInputTokens = next/.test(routeSlice), 'N4 写入只赋值 maxInputTokens');
  ok(/delete entry\.maxInputTokens/.test(routeSlice), 'N5 ⭐ maxInputTokens=0 ⇒ 删字段（回落到客户端默认）');
  ok(/fs\.copyFileSync\(modelsFile, backup\)/.test(routeSlice), 'N6 写前备份 models.json');
  ok(/next < 4096/.test(routeSlice), 'N7 过小值被拒（防止手滑写成 100）');
  ok(/还没有注册进 models.json/.test(routeSlice), 'N8 未注册条目返回明确错误');
  ok(/currentMaxInput/.test(daemonCode), 'N9 ⭐ overview 回传条目**当前实际**的 maxInputTokens');

  // 前端
  ok(/GW_CTX_PRESETS/.test(injectCode) && /1000000/.test(injectCode) && /64000/.test(injectCode),
    'N10 前端有档位表（1M/400K/200K/128K/64K）');
  ok(/data-gwctx/.test(injectCode), 'N11 每行有上下文下拉');
  ok(/wbs-gw-ctx-bulk/.test(injectCode) && /function gwSetAllContexts/.test(injectCode),
    'N12 ⭐ 支持批量：一次把档位应用到全部已注册模型');
  ok(/gwSetAllContexts/.test(injectCode) && /failed \+= 1/.test(injectCode),
    'N13 批量有失败计数（不静默吞错）');
  // ⚠️ 行容器必须是 div：行内有 select，label 会把「点下拉」当成「切换勾选」
  ok(/var row = el\('div', 'wbs-gw-mrow'\)/.test(injectCode),
    'N14 ⭐ 行容器是 div 而非 label（否则点下拉会误切勾选）');
  ok(/var pick = el\('label', 'wbs-gw-mpick'\)/.test(injectCode),
    'N15 checkbox 仍包在 label 里（点名字能勾选）');
  // 未注册行不画下拉
  ok(/m\.registration === 'absent'[\s\S]{0,400}wbs-gw-mctx-off/.test(injectCode),
    'N16 ⭐ 未注册的行不画下拉（画成灰下拉会让人以为能点）');
  ok(/set-model-context/.test(injectCode), 'N17 前端接的是 set-model-context 接口');
  ok(/只对新建会话生效/.test(injectCode), 'N18 提示文案说明生效时机与范围（已有会话不回溯）');

  // ⭐⭐ 「应用」不得把手动档位冲回网关默认 —— 实测踩过：
  //   13:32 在面板设 200K 成功，13:33 点了两次「注册模型 → 应用」，models.json 变回 1000000，
  //   用户看到的就是「我明明调了 200K，客户端还是按 1M 算」。
  const regIdx = daemonCode.indexOf("p === '/api/gateway/register-models'");
  const regSlice = regIdx > 0 ? daemonCode.slice(regIdx, regIdx + 6000) : '';
  ok(/const keepCtx = new Map\(\)/.test(regSlice),
    'N19 ⭐ register-models 建立 keepCtx（先记住 models.json 里已有的手动值）');
  ok(/const kept = keepCtx\.get\(e\.id\) \|\| keepCtx\.get\(raw\)/.test(regSlice),
    'N20 ⭐⭐ 「应用」把手动 maxInputTokens 搬回去（兼容 gateway: 前缀与裸 id 两种写法）');
  const keepIdx = regSlice.indexOf('const keepCtx');
  const mergeIdx = regSlice.indexOf('apiGateway.mergeGatewayModels');
  ok(keepIdx > 0 && mergeIdx > 0 && keepIdx < mergeIdx,
    'N21 ⭐ 搬回必须发生在 mergeGatewayModels 之前（顺序反了等于没搬）');
  const keepBlock = keepIdx > 0 ? regSlice.slice(keepIdx, keepIdx + 1350) : '';
  ok(!!keepBlock && !/\.url\s*=/.test(keepBlock) && /e\.contextWindow = kept\.cw/.test(keepBlock),
    'N22 搬回只碰 maxInputTokens + contextWindow（url 由后面的包裹逻辑单独处理）');

  /* ⭐⭐⭐ 2026-10-19 追加：只写 maxInputTokens 是**无效**的
   * 客户端 resolveEffectiveContextBudget() 优先级：
   *   overrideContextWindow > contextWindow.defaultLength > supportedLengths[0] > maxInputTokens
   * 而官方目录给 deepseek-v4.1-flash / glm-5.3 预置了
   *   contextWindow:{defaultLength:300000, supportedLengths:[300000,600000,1000000]}
   * ⇒ 面板设 200K，客户端仍按 300K 跑（实测 sessions.context_window 恒 300000）。
   * 所以必须把 contextWindow 一起写进条目，并保证 supportedLengths ≥2 且含目标值。
   */
  ok(/entry\.contextWindow = \{ defaultLength: next, supportedLengths: ladder \}/.test(routeSlice),
    'N23 ⭐⭐ set-model-context 同时写 contextWindow（否则被目录的 defaultLength=300K 盖住）');
  ok(/const ladder = buildContextTiers\(next\)/.test(routeSlice)
    && /const below = CTX_LADDER\.filter\(\(v\) => v < target\)\.slice\(-2\)/.test(routeSlice),
    'N24 ⭐ 目标值必须并入 supportedLengths（且按客户端只认 2~3 档的约束裁剪）');
  ok(/delete entry\.contextWindow/.test(routeSlice),
    'N25 清空档位时两个字段一起删（回落到模型自带默认）');
  ok(/contextWindow && Number\(hit\.contextWindow\.defaultLength\)|hit\.contextWindow\.defaultLength/.test(daemonCode),
    'N26 ⭐ 面板 currentMaxInput 优先报 defaultLength（否则面板说 200K、客户端跑 300K）');

  /* 2026-10-20：档位换成 100K/200K/300K/600K/1M，并支持自定义 64K–1000K。
   * ⚠️ N28 是这次改造的核心教训：Electron/Chromium 不实现 window.prompt（静默返回 null），
   *    所以「自定义…」以前的实现等于点了没反应 —— 必须走卡片内联输入。 */
  ok(/var GW_CTX_PRESETS = \[[\s\S]{0,400}?\{ v: 1000000, label: '1M' \}[\s\S]{0,200}?\{ v: 600000, label: '600K' \}[\s\S]{0,200}?\{ v: 300000, label: '300K' \}[\s\S]{0,200}?\{ v: 200000, label: '200K' \}[\s\S]{0,200}?\{ v: 100000, label: '100K' \}/.test(injectCode),
    'N27 上下文档位 = 1M / 600K / 300K / 200K / 100K（+ 模型默认）');
  ok(/function gwCtxInlineEdit\s*\(/.test(injectCode) && /wbs-gw-ctx-input/.test(injectCode),
    'N28 ⭐ 自定义输入走卡片内联输入（window.prompt 在 Electron 里静默返回 null）');
  ok(!/window\.prompt\(/.test(injectCode),
    'N29 上下文面板里不得再用 window.prompt');
  ok(/GW_CTX_MIN_K = 64/.test(injectCode) && /GW_CTX_MAX_K = 1000/.test(injectCode)
    && /k < GW_CTX_MIN_K \|\| k > GW_CTX_MAX_K/.test(injectCode),
    'N30 自定义范围硬限制 64K–1000K（越界不写盘）');
  ok(/<option value="-1">自定义…<\/option>/.test(injectCode) && /gwCtxInlineEdit\(bulk/.test(injectCode),
    'N31 批量下拉也支持自定义');
  ok(/const CTX_LADDER = \[64000, 100000, 200000, 300000, 600000, 1000000\]/.test(routeSlice),
    'N32 daemon 的 supportedLengths 梯子与面板档位对齐');
  // ⚠️⚠️ 2026-10-20 实测踩坑：客户端官方「上下文档位」控件
  //   resolveContextUsageWindowTiers() 会把 supportedLengths 按 maxInputTokens 过滤，
  //   然后**只认 length === 2 或 length === 3**，其它一律 return undefined ⇒ 控件整块不渲染。
  //   写进 models.json 的必须是「过滤后恰好 2~3 档」，不能把整条梯子直接塞进去。
  ok(/const buildContextTiers = /.test(daemonCode),
    'N33 ⭐ supportedLengths 由 buildContextTiers 生成（保证客户端过滤后只剩 2~3 档）');
  ok(!/new Set\(CTX_LADDER\.concat\(\[next\]\)\)/.test(daemonCode),
    'N34 ⭐ 禁止把整条档位梯子直接写进 supportedLengths（4 档会让官方档位控件消失）');
  ok(/tiers\.length < 2/.test(daemonCode) && /\.filter\(\(v\) => v < target\)\.slice\(-2\)/.test(daemonCode),
    'N35 buildContextTiers 的「最多取 2 个更小档 + 目标值」规则未被改回');
}

console.log('');
console.log('── O. 账号快照写回 gateway.json（修「安装时写一次，之后再也不更新」）──');
{
  const syncFn = daemonSrc.slice(
    daemonSrc.indexOf('function gatewaySyncAccounts(options)'),
    daemonSrc.indexOf('function gatewaySyncAccountsQuiet')
  );
  ok(syncFn.length > 0, 'O1 能切到 gatewaySyncAccounts 函数体');
  ok(/apiGateway\.writeGatewayState\(paths\.stateFile/.test(syncFn),
    'O2 ⭐ 同步后把账号快照写回 gateway.json（否则面板/诊断会一直显示少一个号）');
  ok(/prev\.installed === true && prev\.versionTag/.test(syncFn),
    'O3 ⭐⭐ 只在状态文件完整时才写：readGatewayState 对缺失/损坏文件返回 fallback，照抄会把 versionTag/port 冲掉');
  ok(/key\(prev\.accounts\) !== key\(next\)/.test(syncFn),
    'O4 只在账号真的变了才写盘（本函数挂在每次账号备份之后，高频调用）');
  ok(/状态写失败不影响账号同步本身/.test(syncFn),
    'O5 状态写失败不得影响账号同步本身（账号池是主目标，状态是附属）');
}
console.log('');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
