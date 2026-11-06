#!/usr/bin/env node
/**
 * 统一网关控制台守卫（2026-11-03）
 *
 * 守护的对象是**部署在 %APPDATA%\WorkDaddy\unified\** 的那套东西（不在本仓里，
 * 但契约必须锁住，否则下次改会悄悄退化）：
 *   · unified/server.js          —— 控制台后端 + auto 兜底 + 模型注册
 *   · unified/panel/app.js       —— 控制台前端（性能纪律）
 *   · unified/panel/app.css
 *   · scripts/side-gateway-ui.js —— WorkBuddy 面板里的轻量插件
 *
 * 覆盖三类回归风险：
 *   A 性能纪律（本轮卡顿修复的根因，最容易退化）
 *   B 安全边界（控制台只在 127.0.0.1；口令 + Origin 双检；CSP 无外链）
 *   C 功能契约（一键加模型 / 改上下文 / auto 兜底 / 模型别名归一化）
 *   D 可剥离边界仍然成立
 *
 * 用法：node .wd-analysis/test-side-gateway-console.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UDIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WorkDaddy', 'unified');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
/** 剥注释：静态断言必须剥，否则会被注释里的关键词误报（本项目踩过多次）。 */
function codeOnly(raw) {
  return String(raw).replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const hasDeploy = fs.existsSync(path.join(UDIR, 'server.js'));
if (!hasDeploy) {
  console.log('\n⊘ 未找到控制台部署（' + UDIR + '）');
  console.log('  注意：控制台属于「可剥离」侧车，摘掉后本套件整体跳过（不算失败）。');
  console.log('\n结果：0 通过 / 0 失败（已跳过）');
  process.exit(0);
}

const srvRaw = read(path.join(UDIR, 'server.js'));
const reqsRaw = read(path.join(UDIR, 'reqs.js'));   // 请求记录模块（2026-11-03 新增）
const cssRaw = read(path.join(UDIR, 'panel', 'app.css'));
const srv = codeOnly(srvRaw);
const reqs = codeOnly(reqsRaw);
const uiRaw = read(path.join(UDIR, 'panel', 'app.js'));
const ui = codeOnly(uiRaw);
const plugRaw = read(path.join(ROOT, 'scripts', 'side-gateway-ui.js'));
const plug = codeOnly(plugRaw);

console.log('\n=== A. 性能纪律（本轮卡顿修复的根因）===');

ok('A1 ⭐ 插件 observer 只观察 body 的 childList',
  /new MutationObserver\(/.test(plug) && /observe\(document\.body,\s*\{\s*childList:\s*true\s*\}\)/.test(plug));

ok('A2 ⭐ 插件不监听 attributes（流式渲染里 attribute 变动最频繁）',
  !/attributes:\s*true/.test(plug));

ok('A3 ⭐ 插件挂载后立即 disconnect（零回调开销）',
  /if\s*\(mounted\(\)\)\s*\{[\s\S]{0,160}?mo\.disconnect\(\)/.test(plug));

ok('A4 插件挂载探测走 requestIdleCallback',
  /requestIdleCallback/.test(plug));

ok('A5 插件带 UI_REV 版本戳（热更时能识别并接管旧 pane）',
  /UI_REV\s*=\s*'?\d+'?/.test(plug) && /data-wsg-rev/.test(plug));

ok('A6 ⭐ 控制台账号池用虚拟滚动（只渲染可视区）',
  /var ROW_H = /.test(ui) && /function paintVirtual\(/.test(ui) && /Math\.floor\(scTop \/ ROW_H\)/.test(ui));

ok('A7 控制台视图各自渲染（不整页重建）',
  /function renderOverview/.test(ui) && /function renderBoost/.test(ui) && /\$\('#main'\)/.test(ui));

ok('A8 控制台页面不可见时暂停轮询',
  /document\.hidden/.test(ui) && /visibilitychange/.test(ui));

ok('A9 账号明细分页拉取（不一次给 150 条）',
  /accounts\?limit=/.test(ui) && srvRaw.indexOf("tail === 'accounts'") >= 0);

console.log('\n=== B. 安全边界 ===');

ok('B1 ⭐ 网关只监听回环（绝不上 0.0.0.0）',
  /server\.listen\(Number\(CFG\.port\),\s*CFG\.host\s*\|\|\s*'127\.0\.0\.1'/.test(srv));

ok('B2 ⭐⭐ 控制台免口令（本机自用：打开就能用，不再要 panel_token / 登录门）',
  !/CFG\.panel_token/.test(srv) && !/function panelAuthOk\(/.test(srv) && !/needLogin:\s*true/.test(srv));

ok('B2b ⭐ 免口令不等于裸奔：仍然禁止把 api_key 注入控制台 HTML',
  !/__WG__=\{[^}]*token/.test(srv));

ok('B3 ⭐ 控制台做 Origin 校验（防本机其它网页跨源偷读）',
  /function panelOriginOk\(/.test(srv) && /panelOriginOk\(req\)/.test(srv));

ok('B4 免口令后不再下发登录 cookie',
  !/wg_panel=/.test(srv) && !/Set-Cookie/.test(srv));

ok('B5 ⭐ CSP 收紧：default-src none + frame-ancestors none',
  /Content-Security-Policy/.test(srv) && /default-src 'none'/.test(srv) && /frame-ancestors 'none'/.test(srv));

ok('B5b ⭐⭐ 控制台 script-src 用 per-request nonce，不含 unsafe-inline（XSS 兜底更硬）',
  /script-src 'nonce-/.test(srv) && !/script-src 'unsafe-inline'/.test(srv));

ok('B5c ⚠️ style-src 必须留 unsafe-inline（虚拟滚动行用了 style= 内联属性）',
  /style-src 'unsafe-inline'/.test(srv));

ok('B5d ⚠️ app.js 注入前转义 </script（防脚本提前闭合 → XSS）',
  /replace\(\/<\\\/script\/gi/.test(srv));

ok('B6 旧口令接口降级为空壳（返回 noAuth，不再 401）',
  /noAuth:\s*true/.test(srv) && !/needLogin:\s*true/.test(srv));

ok('B7 面板插件不自己转发网关 key（一律经 daemon 代理）',
  !/x-gateway-token/.test(plug));

console.log('\n=== C. 功能契约 ===');

ok('C1 模型别名归一化（provider/名 → 精确 → 剥 realm: → 大小写）',
  /function resolveModel\(/.test(srv) &&
  /raw\.indexOf\('\/'\)/.test(srv) && /raw\.indexOf\(':'\)/.test(srv) && /toLowerCase\(\)/.test(srv));

ok('C2 ⭐ 转发前改写 parsed.model（否则上游收到本地别名会 400）',
  /parsed\.model\s*!==\s*target\.model/.test(srv) && /parsed\.model\s*=\s*target\.model/.test(srv));

ok('C3 auto 是虚拟模型（跳过上游模型表校验）',
  /virtual:\s*true/.test(srv) && /isAuto/.test(srv));

ok('C4 auto 兜底：实测两池候选，谁快用谁',
  /function resolveAuto\(/.test(srv) && /function probeModel\(/.test(srv) && /\.sort\(/.test(srv));

ok('C5 auto 挑选结果有缓存（不每次请求都探测）',
  /AUTO_FALLBACK\.at/.test(srv) && /180000/.test(srv));

ok('C6 ⭐ 档位梯子复用面板同规则（客户端只认 2~3 档）',
  /function buildContextTiers\(/.test(srv) && /CTX_LADDER/.test(srv) && /slice\(-2\)/.test(srv));

ok('C7 写 models.json 前先备份',
  /bak-unified-/.test(srv));

ok('C8 写 models.json 走原子替换（tmp + rename）',
  /renameSync\(tmp, file\)/.test(srv));

ok('C9 ⭐ 走 lib 的 buildModelsFileDoc（保证裸数组/对象形态正确）',
  /buildModelsFileDoc/.test(srv) && /readModelsFile/.test(srv));

ok('C10 lib 找不到时报明确错误（不静默写坏注册表）',
  /找不到 WorkDaddy 的 scripts\/lib\.js/.test(srv));

ok('C11 提供测速接口（一键加速用）',
  srvRaw.indexOf("tail === 'speedtest'") >= 0);

ok('C12 测速前预热模型表（否则懒加载导致 0 条结果）',
  /await p\.models\(\)/.test(srv));

ok('C13 前端对用户可控字符串做转义',
  /function esc\(/.test(ui) && /esc\(r\.u\)/.test(ui) && /esc\(mm\.id\)/.test(ui));

ok('C14 前端有「一键加入」入口',
  /一键加入/.test(uiRaw) && /data-qa=/.test(ui));

ok('C15 前端有「一键加速」独立视图',
  /renderBoost/.test(ui) && /id:\s*'boost'/.test(ui));

ok('C16 一键加速页能加 auto（走 register 的 auto 分支）',
  /model:\s*'auto'/.test(ui));

console.log('\n=== E. 请求记录（2026-11-03 新增，对齐 7863）===');

ok('E1 有独立的记录模块 reqs.js（不塞进 server.js）',
  reqsRaw.length > 500 && /module\.exports/.test(reqs));

ok('E2 ⭐⭐ 虚拟模型判定在真实模型匹配**之前**（否则 uni:auto 会被上游同名模型抢走）',
  (function () {
    // 关键回归：loomy 上游自带一个叫 auto 的模型，判定若在「剥前缀」之后，
    // uni:auto 就会被当成真模型转发，"自动优选"永远不生效（实测踩过）。
    const fn = srv.slice(srv.indexOf('function resolveModel'));
    const virtualIdx = fn.indexOf("bare === 'auto'");
    const stripIdx = fn.indexOf('raw = raw.slice(colon + 1)');
    return virtualIdx > 0 && (stripIdx < 0 || virtualIdx < stripIdx);
  })());

ok('E3 记录内含 usage 抽取（prompt/completion/积分）',
  /function usageOf/.test(reqs) && /prompt_tokens/.test(reqs) && /completion_tokens/.test(reqs) && /points_consumed/.test(reqs));

ok('E4 ⭐ 来源 IP 做掩码（不把完整 IP 记进内存）',
  /function maskIp/.test(reqs) && /\.\*\.\*/.test(reqs));

ok('E5 ⭐ 只记账号尾号（tag），不记完整 uid',
  /只记尾号/.test(srvRaw) && /p\.tag\(a\)/.test(srv));

ok('E6 三个维度的聚合都有（模型/账号/上游）',
  /byModel/.test(reqs) && /byAccount/.test(reqs) && /byProvider/.test(reqs) && /function groupBy/.test(reqs));

ok('E7 ⭐⭐ 流式收尾挂 finish（不是只挂 close），否则正常流式会被误判 499',
  /res\.on\('finish', endStream\)/.test(srv) && /res\.on\('close', endStream\)/.test(srv));

ok('E8 ⭐⭐ close 兜底用 writableFinished 区分正常结束与提前断开',
  /res\.writableFinished/.test(srv) && /RH\.fail\(499/.test(srv));

ok('E9 记录只有内存环形缓冲（默认 ≤ 500，不落盘）',
  /RING_MAX\s*=\s*500/.test(reqs) && !/writeFileSync\(.*reqs/.test(reqs));

ok('E10 记录接口有筛选（result / q / limit）',
  /tail === 'requests'/.test(srv) && /result:/.test(srv) && /limit:/.test(srv));

ok('E11 前端有请求记录页 + 导航项',
  /renderReqs/.test(ui) && /id: 'reqs'/.test(ui));

ok('E12 前端对记录字段一律转义（含 UA / note，都是外部输入）',
  /esc\(r\.ua\)/.test(ui) && /esc\(r\.note\)/.test(ui) && /esc\(r\.model\)/.test(ui));

ok('E13 明细表只有一个滚动容器（避免三层嵌套滚动）',
  /\.rq-wrap\{[^}]*overflow:auto/.test(cssRaw) && !/\.rq-aggcard \.body\{[^}]*max-height:28vh/.test(cssRaw));

ok('E14 记录页在桌面端不横向溢出（表设了 min-width + 外层 overflow）',
  /\.rq-wrap table\{min-width:/.test(cssRaw) && /\.rq-wrap\{[^}]*overflow:auto/.test(cssRaw));

console.log('\n=== F. 公网入口分发（17443 一个端口两个网关）===');

const ingressRaw = read(path.join(ROOT, 'scripts', 'tunnel-ingress.js'));
const ingress = codeOnly(ingressRaw);
const frpcToml = read(path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'WorkDaddy', 'tunnel', 'frpc.toml'));

ok('F1 分发器存在且被 daemon 托管',
  ingressRaw.length > 1000 && /tunnelIngress\.start\(\)/.test(srv.length ? codeOnly(read(path.join(ROOT, 'scripts', 'daemon.js'))) : ''));

ok('F2 ⭐ frpc 指向分发器(7867)，不是直连 7863',
  /localAddr\s*=\s*"127\.0\.0\.1:7867"/.test(frpcToml),
  (frpcToml.match(/localAddr\s*=\s*"([^"]+)"/) || [])[1]);

ok('F3 ⭐⭐ 公网禁止 /panel /admin（7866 控制台免口令，内有 150 号明细）',
  /function isForbidden/.test(ingress) &&
  /p === '\/panel'/.test(ingress) &&
  /p\.indexOf\('\/admin\/'\) === 0/.test(ingress));

// ⚠️ 这条是**反向**断言，2026-11-03 加：第一版把 /healthz 也拦了，
//    结果路由器上的「WorkDaddy 网关」面板（靠 /healthz 探活）立刻显示「网关离线」。
//    healthz 只回池子计数与模型数，没有 uid/明细/key ⇒ 必须放行。
ok('F3b ⭐⭐ /healthz 必须放行（路由器面板靠它探活，拦了就显示「网关离线」）',
  !/p === '\/healthz'/.test(ingress) &&
  /healthz.*必须放行/.test(ingressRaw) &&
  !/p === '\/healthz'/.test(srv) &&
  /healthz.*不拦/.test(srvRaw));

ok('F4 ⭐⭐ /uni/panel/ 也要被拦（防止用前缀绕）',
  // 判断必须发生在**剥前缀之后**的 path 上
  /const path = isUni \? stripPrefix\(rawPath\) : rawPath/.test(ingress) &&
  /isForbidden\(path\)/.test(ingress));

ok('F5 ⭐ /uni 前缀剥离正确（/uni/v1/x → /v1/x）',
  /function stripPrefix/.test(ingress) && /slice\(CFG\.uniPrefix\.length\)/.test(ingress));

ok('F6 ⭐⭐ 隧道标记头是**覆盖写**，不是"有则跳过"（否则外部伪造可绕过）',
  /headers\['x-workdaddy-tunnel'\] = '1'/.test(ingress) &&
  !/if\s*\(!headers\['x-workdaddy-tunnel'\]\)/.test(ingress));

ok('F7 ⭐⭐ 7866 自己也有一道隧道守卫（两层都拦，单点绕过不漏号）',
  /function tunnelBlocked/.test(srv) &&
  /if \(tunnelBlocked\(req\)\)/.test(srv));

ok('F8 7866 的 Origin 校验对隧道请求一律不放行',
  /x-workdaddy-tunnel'\] \|\| ''\) === '1'\) return false/.test(srv));

ok('F9 流式不被缓冲（request 直接 pipe，不收集 body）',
  /req\.pipe\(up\)/.test(ingress) && !/Buffer\.concat\(chunks\)/.test(ingress));

ok('F10 客户端断开时同步断开上游（不白跑完）',
  /res\.on\('close', \(\) => \{ try \{ up\.destroy\(\)/.test(ingress));

ok('F11 排障口只给本机：靠隧道头判定（frpc 在本机，remoteAddr 都是 127.0.0.1）',
  /ingress\/status/.test(ingress) &&
  /不能靠 remoteAddress/.test(ingressRaw) &&
  /x-workdaddy-tunnel'\] \|\| ''\) === '1'\)/.test(ingress));

ok('F12 上游不可达时返回可读 502（而不是挂住）',
  /bad_gateway/.test(ingress) && /upstream error/.test(ingress));

console.log('\n=== G. 路由器接入面板（wd-portal）===');

const PORTAL = path.join(ROOT, '.wd-tmp', 'wd-portal');
const p2 = read(path.join(PORTAL, 'src', 'p2.html'));
const p3 = read(path.join(PORTAL, 'src', 'p3.html'));
const cgi = read(path.join(PORTAL, 'cgi', 'wd-portal'));

ok('G1 面板有「150 号池网关」独立分区（4 张卡）',
  /150 号池网关/.test(p2) &&
  ['u-upub', 'u-ulan', 'u-uzt', 'u-ulocal'].every((id) => p2.indexOf('id="' + id + '"') >= 0));

ok('G2 面板地址常量含 /uni 变体',
  p3.indexOf("'https://api.lyonn.fun:17443/uni/v1'") > 0);

ok('G3 ⭐ 两把 key 分开渲染（不共用一把，混用会 401）',
  /keyU/.test(p3) && /function paintKeyU/.test(p3) && /WD_KEY_UNI/.test(cgi));

ok('G4 ⭐ CGI 自测支持 pool=uni（150 号池走 /uni + 自己的 key）',
  cgi.indexOf('pool=uni') >= 0 && cgi.indexOf('PING_PATH="/uni/v1/chat/completions"') >= 0);

ok('G5 ⭐⭐ 面板探活依赖 /healthz —— ingress 必须放行（否则显示「网关离线」）',
  cgi.indexOf('healthz') >= 0 && ingress.indexOf("p === '/healthz'") < 0);

console.log('\n=== D. 可剥离边界仍然成立 ===');

const daemon = codeOnly(read(path.join(ROOT, 'scripts', 'daemon.js')));
const hitLines = daemon.split('\n').filter((l) => /sideGateway/.test(l));
ok('D1 daemon.js 里 sideGateway 挂载点 ≤ 14 行', hitLines.length <= 14, hitLines.length + ' 行');
ok('D2 inject.js 里零残留（插件不改主面板）',
  read(path.join(ROOT, 'scripts', 'inject.js')).indexOf('sideapi') < 0);
ok('D3 插件用占位符通信（不硬编码地址/口令）',
  /__WBS_API__/.test(plugRaw) && /__WBS_API_TOKEN__/.test(plugRaw));
ok('D4 插件带 teardown（热更新协议）',
  /function teardown\(/.test(plug) && /__wsg\.teardown\s*=/.test(plugRaw));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
