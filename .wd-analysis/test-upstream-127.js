'use strict';
/*
 * test-upstream-127.js —— 上游 1.2.7 吸纳 · 批次 1 的守卫。
 *
 * 1.2.7 的产品面真增量只有 5 个文件（新增 2 / 删除 0 / 改动 13，产品面 0 个新模块），
 * 其中 **3 个文件本机与 1.2.6 逐字节一致 ⇒ 整份套用**，另 1 个（inject.js）做定点摘取。
 *
 * 本套件守五组：
 *   [A] `theme-patches.js`（P1 主体）：96 → 99 条，新增 patch-102/103/104；
 *       逐条 assert 关键 CSS 片段（口径照抄上游 `test/theme-patches.test.js`），
 *       并确认老条目 patch-83 / patch-99 仍在（整份套用不许把旧条目弄丢）。
 *   [B] `credit-request-usage.js`（P4）：`modelText` / `usageModel` 的**行为级**测试
 *       —— 账单接口的模型元数据变过多种形状，旧代码 `safeText(row.model)` 对**对象**
 *       只会得到 `[object Object]`。这里喂四种真实形状（字符串 / 对象 / 嵌套对象 / 数字）。
 *   [C] `credit-history-sync.js`（P5）：`CREDIT_HISTORY_CACHE_VERSION = 2`，
 *       读写两侧都用常量（不许再有硬编码 `1`）；**行为级**：v1 旧缓存必须被忽略（冷启动重拉）、
 *       v2 缓存必须被采纳（cacheHit）。⚠️ 这条与 [B] 是**一对** —— 版本号抬升的唯一目的
 *       就是丢弃「按旧口径归一化的 models{} 键」，只做一个都会出事。
 *   [D] `inject.js` 六处定点（P6 维度跳过 / P7 关闭按钮与面板高度 / P1 尾 nebula 底色 /
 *       P10 删除按钮 loading / P11 toast 第四参）：10 个落点各恰好 1 次 + 4 处旧形态已消失。
 *   [E] `toast()` 第四参**向后兼容**：不传 level 时 `isErr` 仍然生效（旧 3 参调用语义不变）。
 *
 * ⚠️ 为什么 [B][C] 要做行为级而不是文本匹配：这两处是「**写错了不报错**」的语义
 * （模型名静默变 `[object Object]`、缓存静默读旧口径），文本匹配证明不了它们真的对。
 *
 * 跑法：node .wd-analysis/test-upstream-127.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rt = require(path.join(ROOT, 'scripts', 'credit-request-usage.js'));
const hist = require(path.join(ROOT, 'scripts', 'credit-history-sync.js'));
const patches = require(path.join(ROOT, 'scripts', 'theme-patches.js'));
const INJECT_FILE = path.join(ROOT, 'scripts', 'inject.js');
const INJECT_SRC = fs.readFileSync(INJECT_FILE, 'utf8');

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

/* ==================================================================== */
section('[A] theme-patches.js —— P1 主体：3 条新补丁登记 + 旧条目未丢');
/* ==================================================================== */

ok(Array.isArray(patches) && patches.length === 99,
  'A1 条目数 = 99（1.2.6 的 96 + patch-102/103/104）', Array.isArray(patches) ? patches.length : typeof patches);

const byId = new Map(patches.map((p) => [p && p.id, p]));
ok(byId.has('patch-83') && byId.has('patch-99') && byId.has('patch-101'),
  'A2 ⭐ 整份套用未丢老条目（patch-83 / patch-99 / patch-101 仍在）');

const p102 = byId.get('patch-102');
ok(!!p102 && p102.themeId === 'nebula', 'A3 patch-102 存在且 themeId=nebula');
ok(!!p102 && /\.teams-container\s*>\s*\.teams-grid-scroll-content(?:,|\{)/.test(p102.css),
  'A4 patch-102 命中新版 teams 滚动容器', p102 && p102.css.slice(0, 80));
ok(!!p102 && /background:transparent !important/.test(p102.css)
  && /background-color:transparent !important/.test(p102.css)
  && /backdrop-filter:none !important/.test(p102.css),
  'A5 patch-102 三件套齐全（background / background-color / backdrop-filter:none）');
ok(!!p102 && !/\.teams-container\.is-mac/.test(p102.css),
  'A6 patch-102 未误伤 mac 分支（.teams-container.is-mac 不许出现）');

const p103 = byId.get('patch-103');
ok(!!p103 && p103.themeId === 'nebula'
  && /\.teams-container \.cr-input-toolbar__send>span\.cr-send-button__tooltip-wrapper/.test(p103.css),
  'A7 patch-103 去掉发送按钮 tooltip 包装层背景');
ok(!!p103 && /background:transparent !important/.test(p103.css) && !/\.is-mac/.test(p103.css),
  'A8 patch-103 透明化且未误伤 mac');

const p104 = byId.get('patch-104');
ok(!!p104 && p104.themeId === 'nebula', 'A9 patch-104 存在且 themeId=nebula');
ok(!!p104 && /\.industry-template-switcher__host>button\.wb-button\.wb-button--secondary/.test(p104.css)
  && /\.cr-code-like-box__header>span\.cr-code-block__copy-tooltip/.test(p104.css),
  'A10 patch-104 同时覆盖模板切换器与代码块复制提示');
ok(!!p104 && /box-shadow:none !important/.test(p104.css),
  'A11 patch-104 额外压掉 box-shadow（不只是透明）');

ok(patches.every((p) => p && typeof p.id === 'string' && typeof p.css === 'string'),
  'A12 全表形状完好（每条都有 id + css 字符串）');
ok(patches.every((p) => !/WBS_PROFILE|workbuddy-ai/.test(p.css || '')),
  'A13 主题补丁里不掺 profile 判断（照上游口径）');

/* ==================================================================== */
section('[B] credit-request-usage.js —— P4：模型名识别（行为级，四种真实形状）');
/* ==================================================================== */

ok(typeof rt.usageModel === 'function', 'B1 已导出 usageModel');
ok(typeof rt.modelText === 'function' || typeof rt.usageModel === 'function',
  'B2 modelText / usageModel 至少用例可达');

ok(rt.usageModel({ model: 'gpt-4o' }) === 'gpt-4o',
  'B3 字符串直通（旧行为不变，必须逐字等价）', rt.usageModel({ model: 'gpt-4o' }));
ok(rt.usageModel({ model: { name: 'Alpha' } }) === 'Alpha',
  'B4 ⭐ 对象形状取 name（旧代码这里是 [object Object]）', rt.usageModel({ model: { name: 'Alpha' } }));
ok(rt.usageModel({ modelInfo: { model_name: 'Deep 3' } }) === 'Deep 3',
  'B5 嵌套一层 modelInfo.model_name', rt.usageModel({ modelInfo: { model_name: 'Deep 3' } }));
ok(rt.usageModel({ model_name: 'snake_case' }) === 'snake_case',
  'B6 顶层 model_name 键', rt.usageModel({ model_name: 'snake_case' }));
ok(rt.usageModel({ modelId: 123 }) === '123',
  'B7 数字形状转字符串', rt.usageModel({ modelId: 123 }));
ok(rt.usageModel({ model_info: { slug: 'wb-flash' } }) === 'wb-flash',
  'B8 model_info.slug 兜底键', rt.usageModel({ model_info: { slug: 'wb-flash' } }));
ok(rt.usageModel({ model: { name: 0, modelName: 'Second' } }) === '0',
  '⚠️ B9 有意语义偏差登记（照上游）：数字 0 会被 String(0) 变成 "0" 并采用 —— '
  + '`modelText` 先 `typeof number` 直通，字符串化后 "0" 是 truthy ⇒ 不会继续找 modelName。'
  + '本地照抄 = 语义一致；但**若将来账单真的返回 0 当占位符**，这里会显示 "0" 而不是真名',
  rt.usageModel({ model: { name: 0, modelName: 'Second' } }));
ok(rt.usageModel({}) === '',
  'B10 空对象返回空串（不是 [object Object]、不是 undefined）',
  rt.usageModel({}));
// ⚠️ 边界登记（本轮实测发现，非缺陷）：usageModel(null) / usageModel(undefined) 都会抛 —— 上游未做入参守卫。
//    生产路径**不可达**：normalizeUsageRow 在调用前已 `if (!row || typeof row !== 'object') throw`。
//    ⇒ 本地**照抄上游不动**（零偏差，便于日后合并），仅把契约钉在这里。
let nullThrew = false, undefThrew = false;
try { rt.usageModel(null); } catch (e) { nullThrew = e instanceof TypeError; }
try { rt.usageModel(undefined); } catch (e) { undefThrew = e instanceof TypeError; }
ok(nullThrew && undefThrew,
  '⚠️ B10b 契约登记：usageModel(null / undefined) 抛 TypeError（上游未守卫；调用方必须先保证是对象 ⇒ 生产路径不可达）',
  { nullThrew, undefThrew });
ok(rt.usageModel({ model: { name: { deep: { deeper: 'x' } } } }) === '',
  'B11 深度上限生效（>2 层不再下钻，避免深递归）',
  rt.usageModel({ model: { name: { deep: { deeper: 'x' } } } }));

// normalizeUsageRow 真的走了新路径
const row = rt.normalizeUsageRow({
  requestId: 'req-1', requestTime: '2026-09-26T10:00:00+08:00', credit: 0.25,
  model: { name: 'Alpha' }, client: 'codebuddy',
});
ok(row.model === 'Alpha', 'B12 ⭐ normalizeUsageRow 的 model 字段已走 usageModel', row.model);
ok(!/\[object Object\]/.test(JSON.stringify(row)), 'B13 归一化结果里不含 [object Object]');
const rowPlain = rt.normalizeUsageRow({
  requestId: 'req-2', requestTime: '2026-09-26T10:00:00+08:00', credit: 0.1, model: 'plain',
});
ok(rowPlain.model === 'plain', 'B14 字符串路径仍逐字等价（零行为变化）', rowPlain.model);

/* ==================================================================== */
section('[C] credit-history-sync.js —— P5：缓存版本 1 → 2（源码 + 行为）');
/* ==================================================================== */

const HIST_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'credit-history-sync.js'), 'utf8');
ok(/const CREDIT_HISTORY_CACHE_VERSION = 2;/.test(HIST_SRC), 'C1 常量定义为 2');
ok((HIST_SRC.split('CREDIT_HISTORY_CACHE_VERSION').length - 1) === 3,
  'C2 常量被引用 3 处（定义 + 读校验 + 写盘）', HIST_SRC.split('CREDIT_HISTORY_CACHE_VERSION').length - 1);
ok(!/stored\.version === 1/.test(HIST_SRC) && !/version: 1,/.test(HIST_SRC),
  'C3 已无硬编码的 version 1（读/写两侧都换成常量）');
ok(typeof hist.createCreditHistorySync === 'function' && typeof hist.historyRange === 'function',
  'C4 导出面未变（createCreditHistorySync / historyRange）');

// 行为级：构造 v1 / v2 缓存，看是否被采纳
// ⚠️ 日期必须用**本地**口径（与模块内 dateString 一致）—— 用 toISOString() 在 +08:00 下会差一天
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-up127-'));
const now = new Date('2026-09-26T12:00:00+08:00');
const range = hist.historyRange(7, now);
const localDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0');
const days = [];
for (let d = new Date(range.startTime); d <= range.endTime; d.setDate(d.getDate() + 1)) days.push(localDate(d));
ok(days.length === 7 && days[6] === range.to && days[0] === range.from,
  'C4b 测试用日期区间与模块口径一致（本地日期，7 天，末位 = range.to）',
  { first: days[0], last: days[6], from: range.from, to: range.to });
const mkRows = () => days.map((day) => ({
  uid: 'acct-1', date: day, used: 1.5, count: 2,
  models: { 'gpt-4o': { used: 1.5, count: 2 } },
  queriedAt: range.endTime.getTime(), final: day < range.to,
}));

function cacheHitWith(version) {
  const cacheFile = path.join(tmp, 'cache-v' + version + '.json');
  fs.writeFileSync(cacheFile, JSON.stringify({ version, daily: mkRows() }), 'utf8');
  const sync = hist.createCreditHistorySync({
    cacheFile, now: () => now,
    getAccessToken: async () => 'tok',
    fetchUsage: async () => ({ records: [] }),
  });
  const job = sync.start({ accounts: [{ uid: 'acct-1', nickname: 'A' }], days: 7 });
  if (sync.wait) sync.wait();
  return job;
}

const v2job = cacheHitWith(2);
ok(v2job.cacheHit === true && v2job.hasCachedData === true,
  'C5 ⭐ v2 缓存被采纳（cacheHit=true，无需重拉）', { cacheHit: v2job.cacheHit, has: v2job.hasCachedData });
const v1job = cacheHitWith(1);
ok(v1job.hasCachedData === false,
  'C6 ⭐⚠️ v1 旧缓存被**忽略**（hasCachedData=false ⇒ 必须重新向官方 API 拉）',
  { has: v1job.hasCachedData, cacheHit: v1job.cacheHit });
ok(v1job.cacheHit === false,
  'C7 v1 旧缓存不构成 cacheHit ⇒ 走真实拉取（模型名归一化变了，旧 models{} 键不可信）',
  v1job.cacheHit);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
ok(!/CREDIT_HISTORY_CACHE_VERSION\s*=\s*1/.test(HIST_SRC),
  'C8 常量不是 1（防回退：谁改回 1 就永远读不到新缓存口径）');

/* ==================================================================== */
section('[D] inject.js —— 六处定点（10 个落点 + 4 处旧形态必须消失）');
/* ==================================================================== */

const SPOTS = [
  ['D1  P6 积分趋势跳过非本维度行', 'if (!Object.prototype.hasOwnProperty.call(row, dimension)) return;', 1],
  ['D2  P7 .wbs-btn-close 加 position/z-index', "'.wbs-btn-close{position:relative;z-index:1;", 1],
  ['D3  P7 .wbs-panel 高度上限', 'max-height:calc(100vh - 110px)', 1],
  ['D4  P1 nebula explore-card 底色', 'html[data-wbs-theme-id="nebula"] .wbs-explore-card', 1],
  ['D5  P1 nebula explore-tip 底色', 'html[data-wbs-theme-id="nebula"] .wbs-explore-tip', 1],
  ['D6  P10 .wbs-modal-btn.is-loading', '.wbs-modal-btn.is-loading{display:inline-flex', 1],
  ['D7  P10 转圈 keyframes', '@keyframes wbs-modal-btn-spin', 1],
  ['D8  P10 删除按钮进入 loading', "okBtn.textContent = '删除中…';", 1],
  ['D9  P10 删除按钮还原 label', 'okBtn.textContent = pendingLabel;', 1],
  ['D10 P11 toast 第四参缺省兼容', "level: level || (isErr ? 'error' : 'info')", 1],
];
for (const [label, needle, want] of SPOTS) {
  const n = INJECT_SRC.split(needle).length - 1;
  ok(n === want, label + '（× ' + n + '，期望 ' + want + '）');
}

const GONE = [
  ['D11 旧 .wbs-btn-close（无 z-index）', "'.wbs-btn-close{border:none"],
  ['D12 旧面板 max-height:650px', 'max-height:650px'],
  ['D13 旧 toast 三参签名', 'function toast(msg, isErr, targetRoot) {'],
  ['D14 旧「删除完成后直接 enabled」写法', 'if (okBtn.onclick === submit) okBtn.disabled = false;'],
];
for (const [label, needle] of GONE) {
  const n = INJECT_SRC.split(needle).length - 1;
  ok(n === 0, label + ' 已消失（× ' + n + '，期望 0）');
}

/* ==================================================================== */
section('[E] toast 第四参向后兼容 + 跨文件一致性');
/* ==================================================================== */

ok(/function toast\(msg, isErr, targetRoot, level\)/.test(INJECT_SRC),
  'E1 toast 已接第四参 level');
ok(/level: level \|\| \(isErr \? 'error' : 'info'\)/.test(INJECT_SRC),
  'E2 level 缺省时回落到 isErr ⇒ 旧 3 参调用语义逐字不变');
ok((INJECT_SRC.split("'success'").length - 1) >= 0 && !/label\.textContent = '已复制'/.test(INJECT_SRC),
  'E3 未引入「改按钮文字表示成功」的写法（成功一律走 toast，避免按钮文字被永久污染）');
ok(!/wbs-session-usage-copy/.test(INJECT_SRC),
  'E4 边界如实登记：1.2.7 的「复制整个会话」宿主模块本地仍不存在 ⇒ 本批**未引入**任何 wbs-session-usage-* 片段'
  + '（该能力走批次 2 自研，不搬上游 30 个函数）');

/* ==================================================================== */
section('[F] 批次 3 · Linux 三段（IS_LINUX 守卫 ⇒ Windows 零影响）+ 上游 open-url 行为规范');
/* ==================================================================== */

const vm = require('vm');
const { EventEmitter } = require('events');
const DAEMON_FILE = path.join(ROOT, 'scripts', 'daemon.js');
const DAEMON_SRC = fs.readFileSync(DAEMON_FILE, 'utf8');

// —— 源码级：11 个落点 + 旧形态消失 ——
const LX = [
  ['F1  sleepInhibit 声明', 'let sleepInhibit = null; // Linux: systemd-inhibit 持有 sleep/idle inhibitor', 1],
  ['F2  stopCaffeinate Linux 整组结束', "process.kill(-c.pid, 'SIGTERM')", 1],
  ['F3  startCaffeinate systemd-inhibit', "spawn('systemd-inhibit', [", 1],
  ['F4  systemd-inhibit 参数形状', "'--who=WorkDaddy', '--why=WorkDaddy 正在运行任务', 'sleep', 'infinity',", 1],
  ['F5  applySleepMode 并入 Linux', '  if (preventing) {' + '\r\n' + '    if (IS_WIN || IS_LINUX) {', 1],
  ['F6  sleepNow systemctl suspend', "spawn('systemctl', ['suspend'], { stdio: 'ignore' })", 1],
  ['F7  sleep-mode active 纳入 sleepInhibit', 'IS_WIN ? sleepPowershell : IS_LINUX ? sleepInhibit : sleepCaffeinate', 1],
  ['F8  解除判断纳入 sleepInhibit', 'if (!sleepCaffeinate && !sleepPowershell && !sleepInhibit && !sleepUserActivityTimer) return true;', 1],
  ['F9  /api/open-url xdg-open 分支', "spawn('xdg-open', [u], { detached: true, stdio: 'ignore' })", 1],
  ['F10 open-url 不回流 URL 的失败文案', "error: '无法启动系统浏览器，请确认已安装 xdg-utils'", 1],
  ['F11 防锁屏对 Linux 早退', 'if (IS_WIN || IS_LINUX) return; // 防锁屏由系统/桌面策略控制，不运行 macOS 用户活动断言', 1],
];
for (const [label, needle, want] of LX) {
  const n = DAEMON_SRC.split(needle).length - 1;
  ok(n === want, label + '（× ' + n + '，期望 ' + want + '）');
}
ok(DAEMON_SRC.split('// ===== 电脑休眠控制（三模式：allow/keep/until-done + 显示器开关 + 立即休眠 pmset sleepnow）=====').length - 1 === 0,
  'F12 休眠区注释已去掉 macOS 专属的 pmset sleepnow');
ok(DAEMON_SRC.split('if (IS_WIN) return; // Windows 无 caffeinate -u 等价；防锁屏由系统电源策略控制').length - 1 === 0,
  'F13 旧的「只对 Windows 早退」写法已消失（Linux 现在也早退）');

// —— 行为级：真跑 /api/open-url 路由（vm 切片 + 假 spawn），口径照上游 test/open-url.test.js ——
const ROUTE_START = "  if (req.method === 'POST' && p === '/api/open-url')";
const ROUTE_END = "  if (req.method === 'POST' && p === '/api/md-export-html')";
const si = DAEMON_SRC.indexOf(ROUTE_START), ei = DAEMON_SRC.indexOf(ROUTE_END);
ok(si >= 0 && ei > si, 'F14 路由切片锚点可用（起点唯一 / 终点在其后）', { si, ei });

async function runOpenUrl(platform, url, failure) {
  const calls = [];
  const ctx = {
    IS_WIN: platform === 'win32', IS_LINUX: platform === 'linux',
    req: { method: 'POST' }, p: '/api/open-url', res: {},
    readBody: async () => ({ url }),
    json: (_res, status, body) => ({ status, ...body }),
    spawn(command, args, options) {
      const child = new EventEmitter();
      child.unref = () => { child.unreferenced = true; };
      calls.push({ command, args: Array.from(args), options, child });
      queueMicrotask(() => {
        if (failure) child.emit('error', Object.assign(new Error('missing opener'), { code: 'ENOENT' }));
        else child.emit('spawn');
      });
      return child;
    },
  };
  const code = '(function(){' + DAEMON_SRC.slice(si, ei) + '})()';
  const result = await vm.runInNewContext(code, ctx);
  return { calls, result };
}

(async () => {
  const url = 'https://example.invalid/login?state=a%2Bb&next=%2F';
  for (const [platform, command, args] of [
    ['linux', 'xdg-open', [url]],
    ['darwin', 'open', [url]],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', url]],
  ]) {
    const { calls, result } = await runOpenUrl(platform, url);
    ok(result && result.status === 200 && result.ok === true,
      'F15 ' + platform + ' 打开成功返回 200 ok=true', result);
    ok(calls.length === 1 && calls[0].command === command
      && JSON.stringify(calls[0].args) === JSON.stringify(args)
      && calls[0].options.shell === undefined && calls[0].child.unreferenced === true,
      'F16 ⭐ ' + platform + ' 命令/参数/无 shell/unref 全部正确（URL 原样单参传递）',
      calls.map((c) => ({ c: c.command, a: c.args, u: c.child.unreferenced })));
  }

  for (const bad of ['file:///tmp/test', 'javascript:alert(1)', '']) {
    const { calls, result } = await runOpenUrl('linux', bad);
    ok(result && result.status === 400 && calls.length === 0,
      'F17 非 http(s) 在 spawn 之前就被拒（url=' + JSON.stringify(bad) + '）', result);
  }

  const { result: failed } = await runOpenUrl('linux', 'https://example.invalid/?state=private-fixture', true);
  ok(failed && failed.status === 500 && failed.ok === false && !/private-fixture/.test(String(failed.error)),
    'F18 ⭐ 缺 xdg-open 时返回 500 且**错误信息不回流 URL**（授权链接含登录 state）', failed);

/* ==================================================================== */
section('[G] 批次 2 · 自研「复制本会话为 Markdown」（只取上游纯函数，不搬 30 个宿主函数）');
/* ==================================================================== */

const inject = require(INJECT_FILE);
ok(typeof inject.conversationMessagesToMarkdown === 'function',
  'G1 已导出 conversationMessagesToMarkdown');

// ⭐ 上游 test/conversation-usage.test.js 给过的**逐字期望输出**，直接作为基线
const FIXTURE_IN = [
  { id: 'timeline:initial', messageType: 'assistant', content: [{ type: 'text', text: 'hidden' }] },
  { id: 'u-1', messageType: 'user', content: [{ type: 'text', text: '# 需求\n\n请保留 **Markdown**。' }] },
  { id: 'a-1', messageType: 'assistant', content: [{ type: 'markdown', text: '```js\nconst answer = true;\n```\n[wbs-reply-done]: #' }] },
  { id: 'u-2', role: 'user', content: '继续。' },
  { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '第二次回复' }] },
];
const FIXTURE_OUT = '用户：\n\n# 需求\n\n请保留 **Markdown**。\n\n---\n\n助手：\n\n```js\nconst answer = true;\n```\n\n---\n\n用户：\n\n继续。\n\n---\n\n助手：\n\n第二次回复';
ok(inject.conversationMessagesToMarkdown(FIXTURE_IN) === FIXTURE_OUT,
  'G2 ⭐ 与上游给的逐字期望输出完全一致（保留 Markdown / 代码块 / 分隔符）',
  inject.conversationMessagesToMarkdown(FIXTURE_IN));

ok(!/hidden/.test(inject.conversationMessagesToMarkdown(FIXTURE_IN)),
  'G3 `timeline:` 开头的合成消息被排除（它不属于用户看到的正文）');
ok(!/wbs-reply-done/.test(inject.conversationMessagesToMarkdown(FIXTURE_IN)),
  'G4 助手尾部的 `[wbs-reply-done]: #` 内部完成标记被剥掉');
ok((inject.conversationMessagesToMarkdown(FIXTURE_IN).split('\n\n---\n\n').length - 1) === 3,
  'G5 四轮之间恰好 3 个分隔符（用户/助手交替，不额外插空行）');

ok(inject.conversationMessagesToMarkdown([{ id: 'u', messageType: 'user', content: '纯字符串' }]) === '用户：\n\n纯字符串',
  'G6 content 是字符串也支持（不止数组）');
ok(inject.conversationMessagesToMarkdown([{ id: 'x', messageType: 'system', content: 'nope' }]) === '',
  'G7 system 之类非用户/助手角色被跳过 ⇒ 返回空串');
ok(inject.conversationMessagesToMarkdown([]) === '' && inject.conversationMessagesToMarkdown(null) === '',
  'G8 空数组 / 非数组入参都不抛，返回空串');
ok(inject.conversationMessagesToMarkdown([{ id: 'a', messageType: 'assistant', content: [{ type: 'tool_use', name: 'x' }] }]) === '',
  'G9 只有工具调用块、没有文本块的助手消息不产生空标题行');

// 接线守卫（源码级）
ok(INJECT_SRC.includes('id="wbs-cost-copy"'),
  'G10 成本卡头部已挂「复制整个会话」按钮');
ok(/function copyCurrentConversation\(\)/.test(INJECT_SRC)
  && /controller\.messageStore\.getState\(\)\.messages/.test(INJECT_SRC),
  'G11 ⭐ 取消息走**官方消息 store**（列表会虚拟化，绝不能读 DOM）');
ok(/acFindConversationController\(\)/.test(INJECT_SRC.slice(INJECT_SRC.indexOf('function copyCurrentConversation()'), INJECT_SRC.indexOf('function copyCurrentConversation()') + 1400)),
  'G12 复用本地既有 acFindConversationController（与成本卡同一套「当前会话」口径）');
ok(/toast\('会话已复制到剪贴板', false, null, 'success'\)/.test(INJECT_SRC),
  'G13 成功用 toast 的 success 级（不是改按钮文字，避免按钮文字被永久污染）');
ok(/copyPlainText\(markdown\)/.test(INJECT_SRC),
  'G14 复用本地既有 copyPlainText（不新增第三份剪贴板实现）');
ok(/if \(!controller \|\| !controller\.messageStore\)/.test(INJECT_SRC)
  && /if \(!markdown\)/.test(INJECT_SRC),
  'G15 两条失败路径都有明确提示（找不到会话 / 没有可复制内容），不静默失败');
ok(!/wbs-session-usage-copy/.test(INJECT_SRC),
  'G16 边界如实登记：**未**引入上游 wbs-session-usage-* 任何片段（宿主模块本地不存在）');

/* ==================================================================== */
console.log('');
console.log('结果：' + pass + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
})();
