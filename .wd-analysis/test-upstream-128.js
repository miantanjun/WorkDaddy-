'use strict';
/*
 * test-upstream-128.js —— 上游 1.2.8 吸纳（全部 5 批）的守卫。
 *
 * 1.2.8 是本仓吸纳史上最大一版（45 文件 / +3485 行 / 9 块功能 / 符号级新增 69 删除 4）。
 * 产品面 14 个文件里 **6 个本地与 1.2.7 逐字节一致**（整份套用），其余 8 个走三方合并；
 * `daemon.js` / `inject.js` 分别有 7 / 25 个冲突，全部逐块判定解决。
 *
 * 本套件守七组：
 *   [A] 主题三件套**同批**：`theme-patches.js`（+patch-105/106，**−patch-41**）、
 *       `theme-vars.js`（nebula 透明变量）、`builtin/nebula/theme.json`。
 *       ⚠️ 上游删 patch-41 的前提是变量接管已到位 ⇒ 只套一个就是「暂存按钮毛玻璃丢失」。
 *   [B] 会话同步备份生命周期（上游原生）：导出面含 prune/inspect、SYNC_BACKUP_DIR 约定、
 *       changedTargetFiles 只为「会被覆盖/删除」的文件做副本。
 *   [C] 模型限流表（行为级）：save → list 往返、UPSERT 覆盖、**过期行自动清**、
 *       resetAt=null 的语义（只记不删）。
 *   [D] `lib.setAccountNote`（行为级）：uid 白名单 / 原型污染串拒绝 / 2000 字上限 /
 *       账号不存在拒绝 / 写入后 `listAccounts` 带出 note。
 *   [E] daemon 接线：6 条新路由各 1 次；`sessionSync` **直连 require**（否则新路由 ReferenceError）；
 *       启动清理；model-rate-limit 只收 code 6004。
 *   [F] 本地红线与自研内容**未被上游冲掉**（这是本版最大的风险面）：
 *       A5 区（无 firstTargetCopy / mappingTargetLifecycleRevisionMatches）、
 *       inject 已按上游删除 4 个旧主题函数、本地自研类名与启动挂载仍在。
 *   [G] 行尾纪律：scripts/*.js 纯 CRLF（`session-sync.js` 例外，是 LF 产物）。
 *
 * 跑法：node .wd-analysis/test-upstream-128.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DAEMON_SRC = read('scripts/daemon.js');
const INJECT_SRC = read('scripts/inject.js');
const LIB_SRC = read('scripts/lib.js');
const patches = require(path.join(ROOT, 'scripts', 'theme-patches.js'));
const themeVars = require(path.join(ROOT, 'scripts', 'theme-vars.js'));
const nebulaTheme = require(path.join(ROOT, 'scripts', 'builtin', 'nebula', 'theme.json'));
const sync = require(path.join(ROOT, 'scripts', 'session-sync.js'));
const lib = require(path.join(ROOT, 'scripts', 'lib.js'));

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

(async () => {

/* ==================================================================== */
section('[A] 主题三件套必须同批（拆批 = 暂存按钮毛玻璃丢失）');
/* ==================================================================== */

const byId = new Map(patches.map((p) => [p && p.id, p]));
ok(Array.isArray(patches) && patches.length === 100, 'A1 theme-patches 条目数 = 100', Array.isArray(patches) ? patches.length : typeof patches);
ok(!byId.has('patch-41'), 'A2 ⭐ patch-41 已按上游删除（.wbs-stash-inline 毛玻璃改由变量接管，不许回填）');
const p105 = byId.get('patch-105');
const p106 = byId.get('patch-106');
ok(!!p105 && p105.themeId === 'nebula' && /cr-send-button__icon/.test(p105.css || ''),
  'A3 patch-105 在且限定 nebula：发送按钮 SVG 复合路径只保留箭头子路径');
ok(!!p106 && p106.themeId === 'nebula' && /cr-clickable-path-tooltip-anchor/.test(p106.css || ''),
  'A4 patch-106 在且限定 nebula：文件链接/复制控件透明');

const bodyNebula = (themeVars.body || []).filter((b) => b && b.themeId === 'nebula');
const scopedNebula = (themeVars.scoped || []).filter((s) => s && s.themeId === 'nebula');
ok(bodyNebula.length >= 1 && bodyNebula[0].includeRoot === true,
  'A5 theme-vars.body 有 nebula 条目且 includeRoot=true（变量要同时落在 html 与 body 作用域）', bodyNebula.map((b) => Object.keys(b.vars || {})));
ok(bodyNebula.some((b) => (b.vars || {})['--wb-button-primary-bg'] === 'transparent !important'),
  'A6 body 侧把 --wb-button-primary-bg 置为 transparent（这是 patch-41 退休的前提）');
ok(scopedNebula.some((s) => (s.vars || {})['--wb-button-primary-bg'] === 'transparent !important'),
  'A7 scoped 侧同值重定向（官方主题容器直接定义同名变量，必须同作用域覆盖）',
  scopedNebula.map((s) => s.sel));

const nc = nebulaTheme.colors || {};
ok(nc['--wb-button-primary-bg'] === 'transparent',
  'A8 builtin/nebula/theme.json 的按钮底色 = transparent（不再是 rgba 白）', nc['--wb-button-primary-bg']);
ok(nc['--wb-button-primary-fg'] === 'var(--wb-color-text-primary)',
  'A9 前景改走主题文字色变量（深色图标不再失去对比）', nc['--wb-button-primary-fg']);
ok(nc['--wb-bg-secondary'] === 'transparent', 'A10 --wb-bg-secondary = transparent');

/* ==================================================================== */
section('[B] 会话同步回滚备份的生命周期（上游 1.2.8 原生能力）');
/* ==================================================================== */

ok(typeof sync.pruneSyncBackups === 'function' && typeof sync.inspectSyncBackups === 'function',
  'B1 导出面含 pruneSyncBackups / inspectSyncBackups', Object.keys(sync).sort());
ok(Object.keys(sync).length === 11, 'B2 导出面共 11 个（1.2.6 的 9 个 + 这 2 个）', Object.keys(sync).length);
const SYNC_SRC = read('scripts/session-sync.js');
ok(/const SYNC_BACKUP_DIR = \/\^sync-\[A-Za-z0-9_-\]\+\$\//.test(SYNC_SRC),
  'B3 SYNC_BACKUP_DIR 只认 sync-<安全字符> 目录（别的目录一律不碰）');
ok(/const DEFAULT_SYNC_BACKUP_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000/.test(SYNC_SRC),
  'B4 崩溃残留默认 30 天后才收');
ok(/recovery-needed/.test(SYNC_SRC) && /result\.retainedRecovery\+\+/.test(SYNC_SRC),
  'B5 recovery-needed 走「保留」分支而不是删除分支');
const changedIdx = SYNC_SRC.indexOf('function changedTargetFiles(');
ok(changedIdx >= 0 && /if \(file\) entries\.push\(\[change\.key, file\]\)/.test(SYNC_SRC.slice(changedIdx, changedIdx + 900)),
  'B6 changedTargetFiles 只为「目标已有旧字节」的文件做回滚副本（新文件没有旧字节可还原）');
ok((SYNC_SRC.split('changedTargetFiles(changes, target)').length - 1) === 3,
  'B7 定义 1 处 + 同步/异步两条 applySnapshot 各 1 处调用（漏一边 = 那条路径仍全量备份）',
  SYNC_SRC.split('changedTargetFiles(changes, target)').length - 1);
ok(SYNC_SRC.indexOf('\r') === -1, 'B8 session-sync.js 仍是纯 LF（regen 产物，不许被编辑器改成 CRLF）');
const deltas = require('./fixtures/session-sync.deltas.js');
ok(deltas.UPSTREAM_VERSION === '1.2.8', 'B9 delta 表登记的基线 = 1.2.8', deltas.UPSTREAM_VERSION);
ok(deltas.DELTAS.length === 7, 'B10 delta 仍是 7 条（1.2.8 全是上游原生能力，本地零新增 delta）', deltas.DELTAS.length);

/* ==================================================================== */
section('[C] 模型限流表（行为级：save → list 往返 + 过期自动清）');
/* ==================================================================== */

const { createCreditUsageStore } = require(path.join(ROOT, 'scripts', 'credit-usage-store.js'));
const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-ratelimit-'));
const store = createCreditUsageStore({ dbPath: path.join(sb, 'credit.db'), profileId: 'p-test' });
const UID = 'u-test';
const MODEL = 'claude-sonnet-4';
const NOW = Date.now();

await store.saveModelRateLimit({ uid: UID, modelId: MODEL, modelName: 'Sonnet 4', resetAt: NOW + 3600000, observedAt: NOW, source: 'renderer-error', reasonCode: 6004 });
let listed = await store.listModelRateLimits([UID], NOW);
ok(Array.isArray(listed[UID]) && listed[UID].length === 1 && listed[UID][0].modelId === MODEL,
  'C1 存进去能读出来（profile+uid+model 主键）', listed);
ok(listed[UID][0].reasonCode === 6004 && listed[UID][0].source === 'renderer-error',
  'C2 reasonCode / source 原样带回（面板要能区分信号来源）', listed[UID][0]);

// UPSERT：同一 (uid, model) 再写一次要覆盖，不是插两条
await store.saveModelRateLimit({ uid: UID, modelId: MODEL, modelName: 'Sonnet 4.5', resetAt: NOW + 7200000, observedAt: NOW + 1, source: 'renderer-error', reasonCode: 6004 });
listed = await store.listModelRateLimits([UID], NOW);
ok(listed[UID].length === 1 && listed[UID][0].modelName === 'Sonnet 4.5' && listed[UID][0].resetAt === NOW + 7200000,
  'C3 同键二次写入是 UPSERT（不产生重复行，resetAt 被覆盖）', listed[UID]);

// 过期行在 list 时被顺手清掉
const beforeExpire = await store.listModelRateLimits([UID], NOW + 8000000);
ok((beforeExpire[UID] || []).length === 0,
  'C4 resetAt 已过的行在 list 时被清掉且不返回（面板不会显示「早就解封了」的假限流）', beforeExpire);
const afterExpire = await store.listModelRateLimits([UID], NOW);
ok((afterExpire[UID] || []).length === 0,
  'C5 再查一次确认那条真的从库里删了（不是只过滤返回）', afterExpire);

// resetAt=null：时间未知 ⇒ 只记不删
await store.saveModelRateLimit({ uid: UID, modelId: 'm-null', modelName: '', resetAt: null, observedAt: NOW, source: 'renderer-error', reasonCode: 6004 });
const nullCase = await store.listModelRateLimits([UID], NOW + 400 * 24 * 3600 * 1000);
ok((nullCase[UID] || []).length === 1 && nullCase[UID][0].resetAt === null,
  'C6 resetAt=null（时间未知）的行**不会**被当成「已过期」清掉', nullCase);

// 参数校验
let badReset = false;
try { await store.saveModelRateLimit({ uid: UID, modelId: 'm', resetAt: 'x', observedAt: NOW }); } catch (_) { badReset = true; }
ok(badReset, 'C7 非法 resetAt 抛错（不静默写入 NaN）');
let badObs = false;
try { await store.saveModelRateLimit({ uid: UID, modelId: 'm', resetAt: null, observedAt: -1 }); } catch (_) { badObs = true; }
ok(badObs, 'C8 非法 observedAt 抛错');
const empty = await store.listModelRateLimits([], NOW);
ok(empty && Object.keys(empty).length === 0, 'C9 空 uid 列表直接返回 {}（不查库）');
fs.rmSync(sb, { recursive: true, force: true });

/* ==================================================================== */
section('[D] 账号备注 lib.setAccountNote（行为级）');
/* ==================================================================== */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-note-'));
fs.mkdirSync(path.join(dataDir, 'accounts'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'accounts', 'u-ok.info'), '{}');
fs.writeFileSync(path.join(dataDir, 'accounts', 'u-ok2.info'), '{}');

let thrown = '';
try { lib.setAccountNote(dataDir, { uid: '__proto__', note: 'x' }); } catch (e) { thrown = e.message; }
ok(!!thrown, 'D1 拒绝 __proto__（原型污染串不过）', thrown);
thrown = '';
try { lib.setAccountNote(dataDir, { uid: 'a/b', note: 'x' }); } catch (e) { thrown = e.message; }
ok(!!thrown, 'D2 拒绝非白名单 uid（含路径分隔符）', thrown);
thrown = '';
try { lib.setAccountNote(dataDir, { uid: 'u-ok', note: 'x'.repeat(2001) }); } catch (e) { thrown = e.message; }
ok(!!thrown, 'D3 备注超过 2000 字抛错', thrown);
thrown = '';
try { lib.setAccountNote(dataDir, { uid: 'u-missing', note: 'x' }); } catch (e) { thrown = e.message; }
ok(!!thrown, 'D4 账号备份不存在 ⇒ 拒绝（不给幽灵账号写元数据）', thrown);

const wrote = lib.setAccountNote(dataDir, { uid: 'u-ok', note: '这是一条备注' });
ok(wrote && wrote.uid === 'u-ok' && wrote.note === '这是一条备注', 'D5 正常写入返回 {uid, note}', wrote);
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
ok(meta.accounts && meta.accounts['u-ok'] && meta.accounts['u-ok'].note === '这是一条备注',
  'D6 备注落在 meta.json 的 accounts[uid].note（不碰认证备份本体）');
ok(fs.readFileSync(path.join(dataDir, 'accounts', 'u-ok.info'), 'utf8') === '{}',
  'D7 ⭐ 认证备份文件**一字未动**（备注只写元数据）');
// 清空备注
lib.setAccountNote(dataDir, { uid: 'u-ok', note: '' });
const meta2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
ok(meta2.accounts['u-ok'].note === '', 'D8 允许写空串（清空备注）');
fs.rmSync(dataDir, { recursive: true, force: true });

/* ==================================================================== */
section('[E] daemon 接线：新路由 + 直连 require + 启动清理');
/* ==================================================================== */

// 「查进度」是 GET、「发起」是 POST，同一条路径出现 2 次是对的；cancel/open 各 1 次。
const ROUTES = {
  "/api/model-rate-limit": 1,
  "/api/accounts/note": 1,
  "/api/sessions/export": 2,          // GET 查进度 + POST 发起
  "/api/sessions/export/cancel": 1,
  "/api/sessions/export/open": 1,
  "/api/sessions/sync-backups": 1,
};
const routeMiss = Object.entries(ROUTES)
  .filter(([r, n]) => DAEMON_SRC.split("p === '" + r + "'").length - 1 !== n)
  .map(([r, n]) => r + ' 期望' + n + ' 实际' + (DAEMON_SRC.split("p === '" + r + "'").length - 1));
ok(routeMiss.length === 0, 'E1 六条新路由出现次数符合设计（export 主路径 GET+POST 各 1）', routeMiss);
ok(DAEMON_SRC.split('/api/sessions/sync-backups/cleanup').length - 1 === 1,
  'E2 备份清理路由在（带 maxAgeDays 夹在 [1,365]）');
ok(/const sessionSync = require\('\.\/session-sync\.js'\);/.test(DAEMON_SRC),
  'E3 ⭐ daemon **直连** require session-sync（本地原来是经 auto-copy-judge 间接引用；漏了这条新路由会 ReferenceError）');
ok(DAEMON_SRC.split('sessionSync.inspectSyncBackups').length - 1 >= 1 && DAEMON_SRC.split('sessionSync.pruneSyncBackups').length - 1 >= 1,
  'E4 新路由真的调到了 sessionSync 的两个新导出');
const bootIdx = DAEMON_SRC.lastIndexOf('pruneSyncBackups');
ok(bootIdx > DAEMON_SRC.indexOf("process.on('unhandledRejection'"),
  'E5 启动时跑一次 pruneSyncBackups（位置在进程启动段之后，不是模块头部）');
// 2026-09-29 BUG4 修复：旧实现只放行 6004，而渲染层会上报 AUTO_CONTINUE_QUOTA_CODES 里的
// 5 个码（14012/14014/14018/14019/6004）⇒ 另外四种全被 400 拒，限流表永远为空、
// 账号页徽标永不显示（用户看到的「功能未生效」）。现在改成与渲染层同一份码表。
ok(/const RATE_LIMIT_CODES = \[14012, 14014, 14018, 14019, 6004\]/.test(DAEMON_SRC),
  'E6 ⭐ model-rate-limit 路由接受与 inject 码表对齐的 5 个限流码（旧实现只收 6004 = 功能未生效）');
ok(/resetAt < Date\.now\(\) - 86400000 \|\| resetAt > Date\.now\(\) \+ 90 \* 86400000/.test(DAEMON_SRC),
  'E7 解封时间窗夹在 [-1d, +90d]（不用离谱时间污染面板）');
ok(/createSessionExportJobs\(\{/.test(DAEMON_SRC) && /exportJobs\.start\(/.test(DAEMON_SRC.replace(/\n/g, ' ')) === false ? true : /sessionExportJobs\.start\(/.test(DAEMON_SRC),
  'E8 导出作业实例化并接线（sessionExportJobs.start 在 /api/sessions/export 里）');
ok(/background === true/.test(DAEMON_SRC), 'E9 旧流式导出保留兼容（background:true 才走后台作业）');

/* ==================================================================== */
section('[F] 本地红线与自研内容未被冲掉（本版最大风险面）');
/* ==================================================================== */

// F-1 A5 红线区：上游 1.2.8 删 firstTargetCopy，但本地**从未有**该符号，且本地 copySessionRecord
//     不走 sessionSync.applySnapshot ⇒ 那 5 个 hunk 对本地不适用。这里把「没被误引入」钉住。
ok(DAEMON_SRC.split('firstTargetCopy').length - 1 === 0,
  'F1 daemon **不含** firstTargetCopy（本地从未有；上游那 5 个 hunk 已判定不适用）');
ok(DAEMON_SRC.split('mappingTargetLifecycleRevisionMatches').length - 1 === 0,
  'F2 daemon **不含** mappingTargetLifecycleRevisionMatches（同属上游指纹快路径，本地用脏标记索引替代）');
ok(DAEMON_SRC.split('isAutoCopyRowCleanByDirty').length - 1 >= 3 && DAEMON_SRC.split('getSessionDirtyIndex').length - 1 >= 6,
  'F3 本地自研的脏标记守卫仍在（isAutoCopyRowCleanByDirty / getSessionDirtyIndex）');
ok(DAEMON_SRC.split('checkin-sync').length - 1 === 0,
  'F4 checkin-sync 路由**没有被回填**（本地无此路由，回流会引入未测路径）');

// F-2 inject：上游 1.2.8 要求删掉 4 个旧主题函数（不删 = 新旧机制互相拉扯）
const GONE = ['function acIsDarkTheme', 'function watchThemeForButtons', 'var syncAccountFade', 'var syncModelFade'];
const stillThere = GONE.filter((g) => INJECT_SRC.includes(g));
ok(stillThere.length === 0,
  'F5 ⭐ 4 个旧主题函数已按上游删除（留着会与 500ms 原生外观同步互相回写）', stillThere);
ok(!/watchThemeForButtons\s*\(/.test(INJECT_SRC), 'F6 且没有任何遗留调用点（不是只删了定义）');

// F-3 inject：新增组件确实接线
const NEW_FNS = [
  'function syncThemeTakeoverVisibility', 'function usagePieData', 'function usagePieHtml', 'function wireUsagePies',
  'function resolveUsageColor', 'function setupAccountNotePopover', 'function setupModelRateLimitPopover',
  'function renderSessionExport', 'function pollSessionExport', 'function acRecordModelRateLimit',
  'function normalizeAutoContinueError', 'function mountExplorePopover',
];
const missingFns = NEW_FNS.filter((f) => !INJECT_SRC.includes(f));
ok(missingFns.length === 0, 'F7 1.2.8 的 12 个新函数都落到了本地', missingFns);
ok(/AUTO_CONTINUE_QUOTA_CODES = \{ 14012: true, 14014: true, 14018: true, 14019: true, 6004: true \}/.test(INJECT_SRC),
  'F8 限流/耗尽码表原样（自动续跑据此停手）');
ok(/'账号备注': 'Account note'/.test(INJECT_SRC) && /'模型限流': 'Model rate limited'/.test(INJECT_SRC) && /'模型用量': 'Model usage'/.test(INJECT_SRC),
  'F9 i18n 英俄表补齐新组件词条（缺了面板会露出中文）');
ok(/class="wbs-account-name" data-uid=/.test(INJECT_SRC) && /wbs-model-rate-limit/.test(INJECT_SRC),
  'F10 账号行同时挂上「备注按钮」与「模型限流徽标」');

// F-4 本地自研内容必须还在（三方合并最容易在这里静默丢东西）
const KEPT = [
  '.wbs-selection-quote-btn',      // 本地独有的「引用选中」按钮类名（冲突 #3 取并集才保住）
  'wbs-health-cell',               // F2 账号健康徽标
  'mdqvInstall',                   // T30 md 快速查看器启动挂载
  'watchAutoCopyProgress',         // 注入完成即恢复进度条/FAB 角标
  'currentBadge',                  // 本地独有：主账号/当前账号角标
];
const lostKept = KEPT.filter((k) => !INJECT_SRC.includes(k));
ok(lostKept.length === 0, 'F11 本地自研内容全部保留（本版 25 个冲突里最容易丢的就是这些）', lostKept);
ok(INJECT_SRC.split('usageTrendChartHtml(\'每日积分趋势\', false)').length - 1 === 1,
  'F12 积分趋势仍是本地口径 hasModels=false（上游是 true，属本地刻意选择，不许被覆盖）');
ok(INJECT_SRC.split('watchThemeForButtons()').length - 1 === 0 && INJECT_SRC.split('applyThemeButtonColors()').length - 1 >= 1,
  'F13 初始化块只摘掉 watchThemeForButtons，applyThemeButtonColors 仍在');

// F-5 lib 接线未被上游改动冲掉
const libEntries = ['function parseAuthFile(', 'function parseAuthJson(', 'function listAccounts('];
ok(libEntries.every((fn) => {
  const i = LIB_SRC.indexOf(fn);
  return i >= 0 && LIB_SRC.slice(i, i + 1600).includes('wdCompatDecryptAuthJson');
}), 'F14 $wbEncrypted 解密仍接在三个读入口上');
ok(/function setAccountNote\(dataDir, value\)/.test(LIB_SRC), 'F15 setAccountNote 在（且带 note 字段校验）');

/* ==================================================================== */
section('[G] 行尾纪律：新增/整份套用的文件不许破坏 CRLF 约定');
/* ==================================================================== */

const EOL_TARGETS = [
  ['scripts/theme-vars.js', 'CRLF'],
  ['scripts/theme-patches.js', 'CRLF'],
  ['scripts/session-transfer.js', 'CRLF'],
  ['scripts/cdp-targets.js', 'CRLF'],
  ['scripts/win-launcher.js', 'CRLF'],
  ['scripts/credit-usage-store.js', 'CRLF'],
  ['scripts/lib.js', 'CRLF'],
  ['scripts/daemon.js', 'CRLF'],
  ['scripts/inject.js', 'CRLF'],
  ['scripts/session-sync.js', 'LF'],
  ['scripts/builtin/nebula/theme.json', 'LF'],
];
const eolBad = [];
for (const [p, want] of EOL_TARGETS) {
  const b = fs.readFileSync(path.join(ROOT, p));
  const s = b.toString('latin1');
  const crlf = (s.match(/\r\n/g) || []).length;
  const bare = (s.match(/(?<!\r)\n/g) || []).length;
  const kind = crlf && bare ? 'MIXED' : crlf ? 'CRLF' : 'LF';
  if (kind !== want) eolBad.push(p + '=' + kind + '(期望 ' + want + ')');
}
ok(eolBad.length === 0, 'G1 11 个关键文件行尾全部符合约定（scripts/*.js CRLF；session-sync.js / theme.json LF）', eolBad);

/* ==================================================================== */
console.log('');
console.log('结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
})();
