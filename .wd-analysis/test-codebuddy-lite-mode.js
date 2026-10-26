#!/usr/bin/env node
/**
 * CodeBuddy 轻量版 + 注入健壮性守卫
 *
 * 覆盖 2026-10-22 的五处改动，每一条都对应一次**实际观测到的故障**：
 *
 *   A  daemon 漏导入 selectIdeTargets ⇒ 每次 ideSyncScan 都抛 ReferenceError，
 *      CodeBuddy 的 IDE 主窗口（workbench.html）从来没被注入过，用户只看到
 *      agentManager 里的那一个机器人，于是判定「功能很不完整」。
 *      实测日志：`[cdp-ide] IDE 扫描异常: selectIdeTargets is not defined`（8 次/40 秒）。
 *
 *   B  全局错误钩子无节流 ⇒ CodeBuddy 的 AutomationBridge 网络失败会以毫秒级
 *      无限重试，13 秒内 2870 条 unhandledrejection（约 250 条/秒），daemon.log
 *      被灌到 3.7MB，主线程同步 console.error 还在拖慢渲染进程。
 *
 *   C  CodeBuddy 定位为「轻量版」：面板只留 账号/会话/空间/模型/关于，摘掉
 *      主题/自动化/电脑；daemon 侧不再安装/调度内置自动化任务（那些任务全是
 *      给 WorkBuddy 聊天窗写的，在 IDE 里每分钟刷一条失败日志）。
 *
 *   D  行尾纪律与语法。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// 必须先归一化行尾：JS 的 `.` 不匹配 \r，CRLF 上 `//.*$` 之类的剥离会静默失败。
function codeOnly(raw) {
  return raw.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const PROFILES = read('scripts/profiles.js');
const DAEMON = read('scripts/daemon.js');
const INJECT = read('scripts/inject.js');
const CDPT = read('scripts/cdp-targets.js');

const daemonCode = codeOnly(DAEMON);
const injectCode = codeOnly(INJECT);
const profilesCode = codeOnly(PROFILES);

console.log('\n=== A. daemon 必须导入 selectIdeTargets ===');

ok('A1 daemon 从 cdp-targets 解构出 selectIdeTargets',
  /const\s*\{[^}]*\bselectIdeTargets\b[^}]*\}\s*=\s*require\('\.\/cdp-targets\.js'\)/.test(daemonCode));

ok('A2 cdp-targets.js 确实导出 selectIdeTargets',
  /function\s+selectIdeTargets\s*\(/.test(codeOnly(CDPT))
  && /module\.exports\s*=\s*\{[^}]*\bselectIdeTargets\b/.test(codeOnly(CDPT)));

ok('A3 ideSyncScan 里真的在用（不是死导入）',
  /const\s+targets\s*=\s*selectIdeTargets\(list,\s*PROFILE\)/.test(daemonCode));

ok('A4 ideSyncScan 只在 codebuddy profile 下执行',
  /async function ideSyncScan\(\)\s*\{\s*\n\s*if\s*\(PROFILE\.kind\s*!==\s*'codebuddy'[^)]*\)\s*return;/.test(daemonCode));

ok('A5 IDE 注入目标只认 workbench.html（agentManager 归主连接）',
  /\\\/workbench\\\.html/.test(CDPT) || /workbench\\\.html/.test(CDPT));

console.log('\n=== B. 全局错误钩子必须有同类节流 ===');

ok('B1 节流窗口常量 = 60000ms',
  /var\s+WBS_ERR_THROTTLE_MS\s*=\s*60000;/.test(injectCode));

ok('B2 每窗口最多记 3 条',
  /var\s+WBS_ERR_THROTTLE_MAX\s*=\s*3;/.test(injectCode));

ok('B3 wbsErrGate 定义在 wbsReportErr 之前',
  injectCode.indexOf('function wbsErrGate(') > 0
  && injectCode.indexOf('function wbsErrGate(') < injectCode.indexOf('function wbsReportErr('));

ok('B4 签名 = kind + 消息前 160 字（同类错误才能合并）',
  /var\s+sig\s*=\s*kind\s*\+\s*'\|'\s*\+\s*String\(msg\s*\|\|\s*''\)\.slice\(0,\s*160\)/.test(injectCode));

ok('B5 被抑制时直接 return，不进 console',
  /if\s*\(!gate\.log\)\s*return;/.test(injectCode));

ok('B6 窗口翻转时补一条「已抑制 N 次」汇总',
  /上周期同类错误已抑制/.test(injectCode)
  && /gate\.mutedPrev/.test(injectCode));

ok('B7 窗口翻转时把 n 与 muted 一起归零',
  /rec\.t\s*=\s*now;\s*rec\.n\s*=\s*1;\s*rec\.muted\s*=\s*0;/.test(injectCode));

ok('B8 被抑制的错误不再发诊断上报（cdp 传输直接跳过裸 fetch）',
  /if\s*\(WBS_DIAGNOSTICS_ENABLED\s*&&\s*CAPS\.apiTransport\s*!==\s*'cdp'\)/.test(injectCode));

ok('B9 检查顺序：先 gate 再 console.error（gate 必须在前）',
  injectCode.indexOf('var gate;') > 0
  && injectCode.indexOf('var gate;') < injectCode.indexOf("try { console.error(line); } catch (_) {}"));

console.log('\n=== C. CodeBuddy 轻量版 ===');

function profileSlice(id) {
  const start = profilesCode.indexOf("'" + id + "': {");
  if (start < 0) return '';
  const rest = profilesCode.slice(start + 1);
  const next = rest.indexOf("\n  '");
  return next < 0 ? rest : rest.slice(0, next);
}

const cbCN = profileSlice('codebuddy-cn');
const cbIntl = profileSlice('codebuddy-intl');
const wbCN = profileSlice('workbuddy-cn');
const wbAI = profileSlice('workbuddy-ai');

ok('C1 codebuddy-cn 声明 lite: true', /\blite:\s*true\b/.test(cbCN), cbCN.slice(0, 60));
ok('C2 codebuddy-intl 声明 lite: true', /\blite:\s*true\b/.test(cbIntl), cbIntl.slice(0, 60));
ok('C3 workbuddy-cn 不得被标成 lite（主力客户端全功能）', wbCN.length > 0 && !/\blite:\s*true\b/.test(wbCN));
ok('C4 workbuddy-ai 不得被标成 lite', wbAI.length > 0 && !/\blite:\s*true\b/.test(wbAI));

ok('C5 inject 在 lite 下只摘 theme/automations/pc 三个页签',
  /var liteTabs = \['theme', 'automations', 'pc'\];/.test(injectCode));

ok('C6 摘页签不得碰 pane 容器（提前 remove 会让后续初始化拿到 null）',
  /if\s*\(CAPS\.lite\)\s*\{[\s\S]{0,400}?\n    \}/.test(injectCode)
  && !/if\s*\(CAPS\.lite\)\s*\{[\s\S]{0,400}?data-pane[\s\S]{0,200}?\.remove\(\)/.test(injectCode));

ok('C7 lite 下不安装任何内置自动化任务',
  /PROFILE\.capabilities\.lite\s*\?\s*\[\]\s*:/.test(daemonCode));

ok('C8 限流切号任务在 lite 下不安装',
  /PROFILE\.capabilities\.accounts\s*&&\s*!PROFILE\.capabilities\.lite/.test(daemonCode));

ok('C9 runAutomationSchedules 首行 lite 短路',
  /function runAutomationSchedules\(\)\s*\{[\s\S]{0,300}?if\s*\(PROFILE\.capabilities\.lite\)\s*return;/.test(daemonCode));

ok('C10 短路必须在 readAutomationsTolerant 之前（否则照样读盘照样失败）',
  daemonCode.indexOf('if (PROFILE.capabilities.lite) return;') < daemonCode.indexOf('const tasks = readAutomationsTolerant(\'定时调度\')'));

console.log('\n=== E. IDE 目标筛选与注入重试预算 ===');

ok('E1 CodeBuddy 的注入重试预算放宽（WorkBuddy 仍是 6）',
  /const INJECT_MAX_ATTEMPTS = PROFILE\.kind === 'codebuddy' \? \d+ : 6;/.test(codeOnly(read('scripts/win-launcher.js'))));

// 真实调用：光有静态断言挡不住「导入了但过滤条件写错」这类回归。
const { selectIdeTargets } = require(path.join(ROOT, 'scripts', 'cdp-targets.js'));
const cbProfile = { id: 'codebuddy-cn', kind: 'codebuddy', targetHints: ['codebuddy cn'] };
const mkTarget = (id, url) => ({ id, type: 'page', url, title: 'CodeBuddy CN' });
const IDE_LIST = [
  mkTarget('agent', 'vscode-file://vscode-app/d:/CodeBuddy%20CN/resources/app/out/vs/code/electron-browser/workbench/agentManager.html'),
  mkTarget('work', 'vscode-file://vscode-app/d:/CodeBuddy%20CN/resources/app/out/vs/code/electron-browser/workbench/workbench.html'),
  mkTarget('devt', 'devtools://devtools/bundled/inspector.html'),
];

let idePicked = [];
try { idePicked = selectIdeTargets(IDE_LIST, cbProfile).map((t) => t.id); } catch (_) { idePicked = ['<throw>']; }
ok('E2 selectIdeTargets 只选 workbench.html（agentManager 归主连接、devtools 排除）',
  idePicked.length === 1 && idePicked[0] === 'work', '实际=' + JSON.stringify(idePicked));

ok('E3 非 codebuddy profile 返回空数组（不能把 IDE 注入扩散到 WorkBuddy）',
  Array.isArray(selectIdeTargets(IDE_LIST, { id: 'workbuddy-cn', kind: 'workbuddy', targetHints: ['workbuddy'] }))
  && selectIdeTargets(IDE_LIST, { id: 'workbuddy-cn', kind: 'workbuddy', targetHints: ['workbuddy'] }).length === 0);

ok('E4 空入参不抛异常（/json/list 失败时返回 null 的路径）', (() => {
  try { return Array.isArray(selectIdeTargets(null, cbProfile)) && selectIdeTargets(null, cbProfile).length === 0; }
  catch (_) { return false; }
})());

console.log('\n=== D. 行尾与语法 ===');

for (const rel of ['scripts/profiles.js', 'scripts/daemon.js', 'scripts/inject.js']) {
  const raw = read(rel);
  const lfOnly = (raw.match(/(^|[^\r])\n/g) || []).length;
  ok('D ' + rel + ' 纯 CRLF（LF-only 行数 = 0）', lfOnly === 0, 'lfOnly=' + lfOnly);
}

ok('D4 三个文件都能通过语法检查', (() => {
  try {
    const vm = require('vm');
    for (const rel of ['scripts/profiles.js', 'scripts/daemon.js', 'scripts/inject.js']) {
      const src = read(rel);
      // inject.js 依赖 __WBS_* 占位符，只能做语法解析不能执行；用 vm.Script 只编译不跑。
      new vm.Script(src, { filename: rel });
    }
    return true;
  } catch (e) { return false; }
})());

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed === 0 ? 0 : 1);
