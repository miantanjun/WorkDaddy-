/**
 * 上游 1.2.11 吸纳守卫（2026-10-02 立档）
 *
 * 守的是本轮从上游 1.2.11 **选择性吸纳**的两处改动，以及**明确保持不动**的几项
 * （防止以后有人"顺手"把它们照搬进来）。
 *
 * ⚠️ 本套件只做**静态断言**（读源码字符串），不写任何文件、不启动进程。
 *
 * 结果：N 通过 / M 失败
 */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const normalize = (t) => String(t || '').replace(/\r\n/g, '\n');
const inject = normalize(fs.readFileSync(path.join(repo, 'scripts', 'inject.js'), 'utf8'));
const daemon = normalize(fs.readFileSync(path.join(repo, 'scripts', 'daemon.js'), 'utf8'));

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); return true; }
  const d = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  console.log('  FAIL ' + label + d);
  failures.push(label + d);
  return false;
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

/**
 * 剥掉注释再检查 —— 否则「我在注释里写了某个函数名」会被误判成「已引入该函数」。
 * （C1 就是这么误报的：daemon 注释里为防漏更而点名了 reloadIdeWorkbenchWindows。）
 */
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** 极简 semver 比较（只处理 x.y.z 三段数字）。a >= b ⇒ true */
function semverGte(a, b) {
  const pa = String(a || '').split('.').map((x) => Number(x) || 0);
  const pb = String(b || '').split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true;
}

/* ============ A. 吸纳项：行内「同步到其他账号」按钮 ============ */
section('A. 吸纳：会话列表行内同步按钮（上游 1.2.11）');

ok(/function sessSyncButton\(s\) \{/.test(inject),
  'A1 sessSyncButton 已就位');
ok(/class="wbs-sess-sync"/.test(inject) && /data-id="' \+ escAttr\(s\.id\)/.test(inject),
  'A2 ⭐ 按钮用 escAttr(s.id) 转义 id（不裸拼，避免属性注入）');
ok(/title="同步到其他账号"/.test(inject) && /aria-label="同步到其他账号"/.test(inject),
  'A3 有 title 与 aria-label（可访问性 + 悬停释义）');
ok(/<svg viewBox="0 0 24 24"/.test(inject) && /stroke="currentColor"/.test(inject),
  'A4 ⭐ SVG **内联**且用 currentColor —— 上游注释：测试 VM 按源码切片执行，闭包外变量不可见，'
  + '所以不能抽成外部常量，也不能用外部色值');

// 两处渲染行
ok((inject.split("sessSyncButton(s) + autoCopyButton('session'").length - 1) === 2,
  'A5 ⭐ 两处会话行都插入了按钮（漏一处 = 某个分组下没有这个按钮）',
  inject.split("sessSyncButton(s) + autoCopyButton('session'").length - 1);

// 事件绑定
// ⚠️ 不要用「到某个缩进的 }」做收尾 —— 缩进容易变。取函数头之后 1500 字符足够覆盖全部判定分支。
const clickStart = inject.indexOf('listEl.onclick = function (e) {');
const clickHandler = clickStart >= 0 ? inject.slice(clickStart, clickStart + 1500) : '';
ok(/closest\('\.wbs-sess-sync'\)/.test(clickHandler),
  'A6 ⭐ 点击事件里拦截 .wbs-sess-sync');
ok(clickHandler.indexOf("closest('.wbs-sess-sync')") < clickHandler.indexOf("closest('.wbs-sess-auto')"),
  'A7 ⭐⭐ 同步按钮的判定**必须早于**自动同步开关 —— 两者是相邻兄弟节点，'
  + '顺序反了会把「点同步」当成「点开关」');
ok(/e\.preventDefault\(\)/.test(clickHandler) && /e\.stopPropagation\(\)/.test(clickHandler),
  'A8 阻止默认行为与冒泡（否则会触发行的选中/展开）');
ok(/openCopyModal\(\[syncBtn\.getAttribute\('data-id'\)\]\)/.test(clickHandler),
  'A9 ⭐ 复用既有 openCopyModal（不新写一套弹窗），且传**单元素数组**');

// CSS
ok(/\.wbs-sess-sync\{/.test(inject) && /\.wbs-sess-sync:hover\{/.test(inject) && /\.wbs-sess-sync:focus-visible\{/.test(inject),
  'A10 CSS 三态齐（默认 / hover / 键盘聚焦）');

// i18n
ok(/'同步到其他账号': 'Sync to another account'/.test(inject),
  'A11 新增文案已登记英文（i18n 覆盖套件要求全部 UI 文案可翻译）');

/* ============ B. 吸纳项：切换提示文案 ============ */
section('B. 吸纳：切换提示文案修正（上游 1.2.11）');

ok(/const hint = '登录文件已切换，请刷新窗口使新账号生效';/.test(daemon),
  'B1 ⭐ 文案已由「请重启 WorkBuddy」改为「请刷新窗口」—— 实际只需刷新，说「重启」会让用户多做无用动作');
ok(!/请重启 WorkBuddy 使新账号生效/.test(daemon),
  'B2 旧文案已彻底移除（不留双份）');
ok(/hint: reloaded \? '已切换并触发窗口刷新' : hint/.test(daemon),
  'B3 ⭐ 两态用法保持：reloaded=true 说「已触发刷新」；false（CDP 刷新失败）才让用户手动刷新');

/* ============ C. 保持不动项（防误吸纳） ============ */
section('C. 保持不动（上游 1.2.11 有，本地**明确不吸纳**）');

ok(!/reloadIdeWorkbenchWindows/.test(codeOnly(daemon)),
  'C1 ⭐ 未吸纳 reloadIdeWorkbenchWindows —— 它依赖本地不存在的 IDE 浮层管理器（idePages），'
  + '且整个分支有 codebuddy 守卫，对本机是死代码'
  + '（⚠️ 用 codeOnly 检查：注释里点名它是为了防漏更，不算引入）');
ok(!/idePages\s*=\s*new Map\(\)/.test(codeOnly(daemon)),
  'C2 ⭐ 未引入 IDE 浮层管理器（上一轮已判定保持不动，勿重复评估）');
ok(!/wbs-ide-menu-dedupe-style/.test(codeOnly(inject)),
  'C3 未引入 IDE 账号菜单去重样式（codebuddy workbench 专用，本机无该页面）');
ok(!/PREVENT_DUP|preventDuplicateSessions/.test(codeOnly(daemon)),
  'C4 未吸纳「防重复会话」的 reloadWorkBuddyPage 改造 —— 本地该函数本来就是简化版、'
  + '没有那段「重载后主动刷新列表」逻辑 ⇒ 那个 bug 在本地不存在');

/* ============ D. 基线登记 ============ */
section('D. 基线登记');

ok(daemon.indexOf("const DAEMON_VERSION = '") > 0,
  'D1 daemon 版本号常量在位');
const v = (/const DAEMON_VERSION = '([^']+)';/.exec(daemon) || [])[1];
ok(/^\d+\.\d+\.\d+$/.test(v || ''), 'D2 版本号是三段式', v);

/* ============ E. ⭐⭐ 上游基线版本号（这个漏更过一次，必须锁死） ============ */
section('E. 上游基线版本号（v1.9.5 / v1.9.6 连续两次漏更）');

const up = (/const UPSTREAM_VERSION = '([^']+)';/.exec(daemon) || [])[1];
ok(!!up, 'E1 UPSTREAM_VERSION 常量可提取', up);
ok(/^\d+\.\d+\.\d+$/.test(up || ''), 'E2 上游基线是三段式', up);

// ⭐ 核心断言：已吸纳的上游版本必须**等于**我们实际同步到的版本。
//    v1.9.5 吸纳了 1.2.10、v1.9.6 吸纳了 1.2.11，但两次都忘了改这个常量，
//    于是 semverCompare(latest, 1.2.8) 恒 > 0 ⇒ 面板永远误报「上游有新版」。
ok(up === '1.2.11',
  'E3 ⭐⭐ 上游基线 = 1.2.11（与已吸纳的 1.2.10 / 1.2.11 对齐）', up);

// 防止倒退：基线不该低于本轮实际吸纳的版本
ok(semverGte(up, '1.2.11'),
  'E4 ⭐ 上游基线不得低于 1.2.11（不许倒退）', up);

// 提醒：常量附近的注释必须写清「每次吸纳都要改这里」
const around = daemon.slice(Math.max(0, daemon.indexOf("const UPSTREAM_VERSION = '") - 2600),
  daemon.indexOf("const UPSTREAM_VERSION = '"));
ok(/必须同时改这里|每次吸纳上游新版/.test(around),
  'E5 ⭐ 常量旁留有「每次吸纳都要同步改这里」的提醒注释（防止第三次漏更）');
ok(/session-sync\.js.*fixture.*1\.2\.8|fixture.*基线.*1\.2\.8/.test(around),
  'E6 ⭐ 注释里区分了「发布版本基线」与「session-sync fixture 基线」是两件事');

console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
