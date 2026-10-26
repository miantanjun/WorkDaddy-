/*
 * test-codebuddy-daemon-wiring.js —— 阶段② 数据层接缝的静态守卫。
 *
 * 为什么是静态：CodeBuddy 的会话记录只有经官方主进程（CDP）才读得到，
 * 本套件不能拉一个真客户端起来，所以只能锁「接线是否正确」这一层；
 * 真正的读写语义由 test-codebuddy-session-store.js / test-codebuddy-files.js 覆盖。
 *
 * 这里守的是四件容易被后来者改回去的事：
 *   ① sessionSync 必须是 let —— CodeBuddy 要用历史树版本顶替它；
 *   ② 会话库读写必须走 CODEBUDDY_SESSIONS，不能退回手工正则嗅探 SQL；
 *   ③ 写之前必须先问官方会话是否还在运行（运行中改归属会丢正文）；
 *   ④ Token 统计必须带上历史树文件清单，否则 CodeBuddy 页永远空白。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');

// 剥注释：`.` 不匹配 `\r`，所以上面先归一化；否则 `//.*$` 在 CRLF 上会静默失效。
// ⚠️ 必须走单遍扫描，不能用 `/\/\*[\s\S]*?\*\//` + `//` 两条正则：
//    daemon.js 的注释里写了 `traces/*/trace_*.json`，那对 `/*` 会被当成块注释开头，
//    一路吞到下一个 `*/`，把后面上千行的真实代码一起删掉（本套件第一版就这么假红过）。
function codeOnly(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += ch; i++;
  }
  return out;
}
const code = codeOnly(raw);

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ══════════ A. 模块装配 ══════════ */
section('A. 模块装配');
ok(/^let sessionSync = require\('\.\/session-sync\.js'\);$/m.test(code),
  'A1 sessionSync 用 let 声明（历史树版本要能顶替它）');
ok(/^const \{ createCodeBuddyFiles \} = require\('\.\/codebuddy-files\.js'\);$/m.test(code)
  && /^const \{ createCodeBuddyNative \} = require\('\.\/codebuddy-native\.js'\);$/m.test(code)
  && /^const \{ createCodeBuddySessionStore \} = require\('\.\/codebuddy-session-store\.js'\);$/m.test(code),
  'A2 三个 CodeBuddy 模块都已 require');
ok(/codeBuddyFiles = PROFILE\.kind === 'codebuddy' \? createCodeBuddyFiles\(\{ root: PROFILE\.historyRoot, sync: sessionSync \}\)/.test(code),
  'A3 codeBuddyFiles 绑定到 PROFILE.historyRoot 与既有 sessionSync');
ok(/if \(codeBuddyFiles\) sessionSync = codeBuddyFiles\.sync;/.test(code),
  'A4 codeBuddyFiles 生效后顶替 sessionSync（归档/备份词汇共用）');
ok(/codeBuddyNative = PROFILE\.kind === 'codebuddy' \? createCodeBuddyNative\(\{ profile: PROFILE, WebSocketCtor \}\)/.test(code),
  'A5 codeBuddyNative 只在 codebuddy profile 下构造');

/* ══════════ B. 会话库读写路径 ══════════ */
section('B. 会话库读写路径');
ok(/const CODEBUDDY_SESSIONS = PROFILE\.kind === 'codebuddy' \? createCodeBuddySessionStore\(\{/.test(code),
  'B1 CODEBUDDY_SESSIONS 由虚拟 sessions 表构造');
ok(/return \(CODEBUDDY_SESSIONS \|\| SESSION_DB\)\.run\(sql, params\);/.test(code),
  'B2 sqliteRun 委托给 CODEBUDDY_SESSIONS || SESSION_DB');
ok(/const rows = await \(CODEBUDDY_SESSIONS \|\| SESSION_DB\)\.all\(sql, params\);/.test(code),
  'B3 sqliteQuery 委托给 CODEBUDDY_SESSIONS || SESSION_DB');
ok(!/codeBuddySessionRows/.test(code) && !/sqlParamAt/.test(code) && !/会话库暂只支持读取/.test(code),
  'B4 旧的手工正则嗅探 SQL 已删除（它只认三种谓词，遇 ORDER BY / LIMIT 会静默返回全表）');
ok(/writeChanges: async \(changes\) => \{\s*\n\s*await assertCodeBuddySessionsIdle\(changes\.map\(\(change\) => change\.id\)\);/.test(code)
  && /return codeBuddyFiles\.commit\(changes, \(\) => codeBuddyNative\.writeSessions\(changes\)\);/.test(code),
  'B5 写入前先判会话空闲，文件事务包住原生写入');
ok(/async function assertCodeBuddySessionsIdle\(sessionIds = \[\]\) \{/.test(code)
  && /'Working', 'Planning'/.test(code),
  'B6 assertCodeBuddySessionsIdle 认官方 Working / Planning 两个运行态');

/* ══════════ C. Token / 思考统计 ══════════ */
section('C. Token / 思考统计');
ok(/if \(PROFILE\.kind !== 'workbuddy' && PROFILE\.kind !== 'codebuddy'\) return json\(res, 400, \{ ok: false, error: '当前客户端不支持 Token 统计' \}\);/.test(code),
  'C1 /api/token-stats 放行 CodeBuddy');
ok(/const cbTokenOptions = PROFILE\.kind === 'codebuddy'[\s\S]{0,320}codeBuddyFiles\.tokenOptions\(\{ excludeOwners: codeBuddyForeignOwnerIds\(\) \}\)/.test(code),
  'C2 Token 统计带历史树文件清单 + 兄弟 profile 账号隔离');
ok(/cacheFile: path\.join\(DATA_DIR, 'token-stats-codebuddy-cache\.json'\)/.test(code),
  'C3 统计缓存落 WorkDaddy 自己的目录，不污染客户端数据目录');
ok(/\.\.\.cbTokenOptions,\s*\n\s*sessionAccounts,/.test(code),
  'C4 会话归属映射覆盖历史树文件名清单（DB 归属优先）');
ok(/if \(PROFILE\.kind !== 'workbuddy'\) return json\(res, 400, \{ ok: false, error: '当前客户端不支持思考效率统计' \}\);/.test(code),
  'C5 ⛔ 思考效率页保持关闭（思考秒数来自 WorkBuddy 的 traces/*，CodeBuddy 没有这份数据，放行只会渲染半空页面）');

/* ══════════ D. 注入层（阶段③-a）══════════ */
section('D. 注入层');
const targetsSrc = fs.readFileSync(path.join(root, 'scripts', 'cdp-targets.js'), 'utf8').replace(/\r\n/g, '\n');
const targetsCode = codeOnly(targetsSrc);
ok(/module\.exports = \{[^}]*selectIdeTargets \};/.test(targetsCode),
  'D1 cdp-targets 导出 selectIdeTargets（IDE 各窗口独立连接）');
ok(/if \(profile\.kind !== 'codebuddy'\) return true;\s*\n\s*return \/\\\/agentManager\\\.html/.test(targetsCode),
  'D2 主连接对 codebuddy 只认 agentManager.html（否则先开的 IDE 会占住单 target 主连接）');
ok(/&& \/\\\/workbench\\\.html\(\?:\[\?#\]\|\$\)\/i\.test\(String\(target\.url \|\| ''\)\)/.test(targetsCode),
  'D3 selectIdeTargets 只收 workbench.html 页面');
ok(/const \{ BINDING, createRendererApiBridge, rendererBridgeSource \} = require\('\.\/renderer-api-bridge\.js'\);/.test(code),
  'D4 daemon 接上 renderer bridge 三件套');
ok(/case 'Runtime\.bindingCalled': \{[\s\S]{0,220}if \(PROFILE\.kind === 'codebuddy'\) handleRendererApiBinding\(params\)\.catch\(\(\) => \{\}\);/.test(code),
  'D5 onCdpEvent 只在 codebuddy 下应答 binding');
ok(/if \(PROFILE\.kind === 'codebuddy'\) await cdpSend\('Runtime\.addBinding', \{ name: BINDING \}\);/.test(code),
  'D6 注入前先注册 binding（脚本落地即发首帧请求）');
ok(/^async function injectWidget\(reason, executionContextId\) \{$/m.test(code),
  'D7 injectWidget 是 async（await 不能落进非 async 函数 —— 这正是上次 delta 踩过的坑）');
ok(/const trustedTypesBootstrap = PROFILE\.kind === 'codebuddy' \?/.test(code)
  && /trustedTypes\.createPolicy\('notebookChatEditController'/.test(code),
  'D8 TrustedTypes bootstrap 复用官方策略名造 policy');
ok(/\.replace\(\/\\\.innerHTML\\b\/g, '\.__wbsHTML'\)[\s\S]{0,320}\.replace\(\/\\\.insertAdjacentHTML\\b\/g, '\.__wbsInsertAdjacentHTML'\);/.test(code),
  'D9 四处 HTML 写入点全部重写（innerHTML / 对象键 / outerHTML / insertAdjacentHTML）');
ok(/return \(trustedTypesBootstrap \+ markdownScript \+ '\\n' \+ source\)/.test(code),
  'D10 bootstrap 与 markdown 渲染器在重写之外（渲染器自带可选 policy 引用）');
ok(/let source = \(PROFILE\.kind === 'codebuddy' \? rendererBridgeSource\(\) : ''\) \+ toastScript/.test(code),
  'D11 桥源码只在 codebuddy 下拼进面板脚本');

/* ============ E. inject 侧：CodeBuddy 面板适配（阶段③-b） ============ */
const injectSrc = fs.readFileSync(path.join(root, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
const inject = codeOnly(injectSrc);
const profiles = codeOnly(fs.readFileSync(path.join(root, 'scripts', 'profiles.js'), 'utf8').replace(/\r\n/g, '\n'));

ok(/function mountPersistentOverlay\(node\) \{[\s\S]{0,200}setAttribute\('data-wbs-panel-overlay', ''\)/.test(inject),
  'E1 浮层统一走 mountPersistentOverlay（CodeBuddy 重写 body 后要能被抢回来）');
ok(/dispose\.keep = function \(node\) \{/.test(inject),
  'E2 preserveNativePanelMount 暴露 keep()：portal 到 body 的浮层也要一起保活');
ok(/nativePanelMount = preserveNativePanelMount\(document, root, MutationObserver\);\s*\n\s*registerDisposer\(nativePanelMount\);/.test(inject),
  'E3 面板挂载后立刻接上保活，且注册到 disposer（热更时不能留野 observer）');
ok(/if \(CAPS\.panelAppearance === 'light'\) root\.classList\.add\('wbs-panel-light'\);/.test(inject)
  && /\.wbs-root\.wbs-panel-light,\[data-wbs-appearance="light"\]\{/.test(inject),
  'E4 浅色外观：root 上挂 class，且配套变量组在 CSS 里');
ok(/var WBS_PANEL_TITLE = CAPS\.apiTransport === 'cdp' \? 'WorkDaddy' : WBS_BRAND;/.test(inject),
  'E5 面板标题独立于客户端品牌（同一插件在 agents/IDE 两处叫同一个名）');
ok(/themeTakeover: CAPS\.themeTakeover !== false,/.test(inject)
  && /sessState\.themeTakeover = CAPS\.themeTakeover !== false && d\.themeTakeoverEnabled !== false;/.test(inject),
  'E6 主题接管受 CAPS.themeTakeover 门控（CodeBuddy 没有 --wb-* 变量，接管会破配色）');
ok(/CAPS\.apiTransport === 'cdp' \? window\.__wbsApiFetch\(path, request, WBS_API_TOKEN\) : fetch\(API \+ path, request\)/.test(inject),
  'E7 CodeBuddy 的 API 走 CDP binding 桥（渲染进程 CSP 拦住直连 fetch）');
ok(/stashBtn\.className = 'wbs-stash-inline' \+ \(CAPS\.nativeComposer \? ' wbs-composer-native' : ''\)/.test(inject)
  && /exploreBtn\.className = 'wbs-stash-inline wbs-explore-inline' \+ \(CAPS\.nativeComposer \? ' wbs-composer-native' : ''\)/.test(inject),
  'E8 原生 composer 下两个按钮都挂 wbs-composer-native');
ok(/\.wbs-stash-inline\.wbs-composer-native:not\(\.wbs-explore-inline\):hover\{width:calc\(39px \+ var\(--wbs-stash-text-width/.test(inject),
  'E9 原生按钮 24px 方形，暂存按钮按实测文本宽度展开（否则「暂存提示词」被截断）');
ok((inject.match(/CAPS\.enhance === false/g) || []).length >= 8,
  'E10 增强关闭时全链短路（同步/监听/队列快照/弹层都要停，不能只关按钮）',
  'CAPS.enhance === false 命中 ' + (inject.match(/CAPS\.enhance === false/g) || []).length + ' 处');
ok(/if \(WBS_PROFILE_IS_AI \|\| CAPS\.checkin === false\) return '';/.test(inject),
  'E11 无签到能力的客户端（CodeBuddy 国际版）整块不渲染');
ok(/var NATIVE_STASH_SVG =/.test(inject) && /var NATIVE_EXPLORE_SVG =/.test(inject),
  'E12 原生 composer 用细线图标，不用实心版');
ok(/function syncNativeStashLabelWidth\(\) \{[\s\S]{0,260}--wbs-stash-text-width/.test(inject),
  'E13 展开宽度按真实文本量出来写进 CSS 变量');
ok(/var bg = CAPS\.nativeComposer \? 'var\(--cb-button-primary\)' : 'var\(--wb-button-primary-bg\)';/.test(inject),
  'E14 原生 composer 用 --cb-* 主按钮色（--wb-* 在 CodeBuddy 里不存在，会变透明）');
ok(/var WBS_BRAND = \(CAPS\.apiTransport === 'cdp' && CAPS\.appName\)/.test(inject),
  'E15 ⭐ CAPS.appName 必须以 apiTransport === "cdp" 为前置条件 —— 本地 WorkBuddy 两个 profile 也带 appName，'
  + '直接取会把国际版品牌从「WorkBuddy 助手 AI」降级');
ok(/if \(PROFILE_ID === 'codebuddy-cn' \|\| PROFILE_ID === 'codebuddy-intl'\) \{[\s\S]{0,400}WBS_COMPAT\.findQueueAdapter\(document\)/.test(inject),
  'E16 CodeBuddy 没有 wb SDK ⇒ 直接读挂载着的官方 adapter 取会话 id（只读不缓存）');
ok(/id: 'codebuddy-cn'[\s\S]{0,1200}?nativeComposer: true, theme: true, themeTakeover: false, enhance: false,[\s\S]{0,200}?apiTransport: 'cdp'/.test(profiles),
  'E17 codebuddy profile 的能力位齐全（enhance/nativeComposer/themeTakeover/apiTransport 缺一个就退化成 WorkBuddy 行为）');

// ── [E18–E21] daemon 侧「把消息发进 CodeBuddy 会话」的发送路径 ───────────────────
// 这段只在 PROFILE.kind === 'codebuddy' 下拼进 sendExpr（WorkBuddy 拼空串，行为不变）。
const branchAt = code.indexOf('const codeBuddySendBranch');
const sendExprAt = code.indexOf('const sendExpr = `');
ok(branchAt > 0 && sendExprAt > 0 && branchAt < sendExprAt,
  'E18 ⭐ codeBuddySendBranch 必须声明在 sendExpr **之前** —— 插进模板字符串内部会变成浏览器侧求值，'
  + 'PROFILE 在渲染进程不存在 ⇒ 整个 sendExpr 抛 ReferenceError（第一次落地就是这么错的）');
const interpAt = code.indexOf('${codeBuddySendBranch}');
const activeAt = code.indexOf('var active = document.activeElement;', sendExprAt);
ok(interpAt > sendExprAt && activeAt > interpAt,
  'E19 插入点必须在通用路径之前（否则 CodeBuddy 会落到 .cr-input-box 上，认不到方形 IconButton）');
ok(/sv\.selector === 'codebuddy-official-send-button'/.test(code) && /expression: codeBuddySubmitExpr\(\)/.test(code),
  'E20 CodeBuddy 命中后必须改派发 click，不能走 CDP 鼠标（该位置 mouse ACK 实测会卡 5 秒，坐标已错位）');
ok(/function codeBuddySubmitExpr\(\)[\s\S]{0,1200}?findCodeBuddySendButton\(document\)[\s\S]{0,800}?button\.click\(\)/.test(code),
  'E21 codeBuddySubmitExpr 必须重新认一次按钮再 click（不复用探针阶段量到的坐标）');
ok(/findCodeBuddySendButton/.test(code) === true && /_inputBox_/.test(
  fs.readFileSync(path.join(root, 'scripts', 'workbuddy-compat.js'), 'utf8')
), 'E22 compat 侧仍按 [_inputBox_*] + onClick 源码契约认按钮（不按形状猜）');

console.log('\n==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
if (failures.length) {
  for (const name of failures) console.log('  - ' + name);
  process.exit(1);
}
