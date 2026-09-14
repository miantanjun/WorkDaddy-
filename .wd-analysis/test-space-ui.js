'use strict';
/*
 * test-space-ui.js —— 空间占用页（Phase 4）的**源码级**结构与红线断言。
 *
 * 为什么要有这一层：真图验证（CDP）能证明「渲染出来是对的」，但没法证明
 * 「代码里根本没有删除入口」这类**否定性**约束 —— 那要在源码上断言。
 * 另外有一条更省事的理由：注入到页面里的代码不以 <script> 文本形式存在，
 * 从 DOM 里读注入源码只能读到 406 字节，靠不住。
 *
 * 只读 scripts/inject.js，不启动任何进程、不碰数据。
 * 跑法：node .wd-analysis/test-space-ui.js
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'inject.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}

/** 从源码里按锚点取一个函数的函数体（大括号配平）。锚点自身含 `()`，先跳过参数括号组。 */
function functionBody(source, anchor) {
  const at = source.indexOf(anchor);
  if (at < 0) return '';
  let i = source.indexOf('(', at);
  let depth = 0;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  const open = source.indexOf('{', i);
  if (open < 0) return '';
  depth = 0;
  for (let j = open; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open, j + 1); }
  }
  return '';
}

/** 取一行 CSS 规则（数组里是 '...' 单引号字符串，按整行匹配）。 */
function cssHas(fragment) { return SRC.indexOf(fragment) >= 0; }

const PANE = functionBody(SRC, 'function buildSpacesPane()');
const EMPTY = functionBody(SRC, 'function renderSpaceEmpty()');
const RESULT = functionBody(SRC, 'function renderSpaceResult(result, meta)');
const SUB = functionBody(SRC, 'function spaceJobSub(job)');
const BOX = functionBody(SRC, 'function setSpaceScanBox(state, icon, label, count, sub)');
const POLL = functionBody(SRC, 'function pollSpaceScan()');
const START = functionBody(SRC, 'function startSpaceScan()');
const CANCEL = functionBody(SRC, 'function cancelSpaceScan()');
const REFRESH = functionBody(SRC, 'function refreshSpaceScan()');

console.log('[A] Tab 与面板接线');
ok(SRC.indexOf('data-tab="spaces"') >= 0, 'A1 有「空间」tab 按钮');
ok(/data-tab="spaces"[\s\S]{0,400}<span>空间<\/span>/.test(SRC), 'A2 tab 文案是「空间」');
ok(SRC.indexOf("'<div class=\"wbs-pane\" data-pane=\"spaces\"></div>'") >= 0, 'A3 有 spaces 面板容器');
ok(SRC.indexOf("root.querySelector('[data-pane=\"spaces\"]')") >= 0, 'A4 面板元素已取引用');
ok(SRC.indexOf("if (name === 'spaces' && spacesPane && !spacesPane.dataset.built) buildSpacesPane();") >= 0,
  'A5 switchTab 懒构建空间页');
ok(SRC.indexOf("if (name === 'spaces') { try { refreshSpaceScan(); } catch (e) {} }") >= 0,
  'A6 switchTab 每次进入都刷新（缓存秒出 / 接管在跑的任务）');
ok(PANE.length > 500, 'A7 buildSpacesPane 函数体已抽出', PANE.length);

console.log('\n[B] 只读红线（否定性约束，只能查源码）');
const buttons = (PANE.match(/'<button[\s\S]*?<\/button>'/g) || []);
ok(buttons.length === 2, 'B1 空间页只有 2 个按钮（重新扫描 / 中断扫描）', buttons.length);
const danger = ['删除', '清空', '移除', '释放空间'];
const dangerous = buttons.filter((b) => danger.some((w) => b.indexOf(w) >= 0));
ok(dangerous.length === 0, 'B2 空间页没有任何删除/清空类按钮', dangerous);
ok(EMPTY.indexOf('开始扫描') >= 0 && EMPTY.indexOf('wbs-space-start') >= 0, 'B3 空态提供「开始扫描」入口');
ok(RESULT.indexOf('本页只读，不提供删除入口') >= 0, 'B4 页面上写明只读、不给删除入口');
ok(RESULT.indexOf('请到「会话」页操作') >= 0, 'B5 指明清理要走会话页（那里有 lineage 级联保护）');
ok(EMPTY.indexOf('els.rescan.hidden = !spaceWatch.attempted') >= 0,
  'B6 从没扫过时只给「开始扫描」，不并排出现两个语义重复的按钮');
ok(BOX.indexOf('els.rescan.hidden = busy') >= 0,
  'B7 跑动中收掉工具栏按钮（此时的动作是中断）');

console.log('\n[C] 四个接口与轮询');
ok(START.indexOf("api('/api/space/scan/start'") >= 0 && START.indexOf("method: 'POST'") >= 0, 'C1 启动走 POST /api/space/scan/start');
ok(CANCEL.indexOf("api('/api/space/scan/cancel'") >= 0 && CANCEL.indexOf('jobId: spaceWatch.jobId') >= 0, 'C2 中断带上 jobId');
ok(REFRESH.indexOf("api('/api/space/scan/status')") >= 0, 'C3 读状态');
ok(REFRESH.indexOf("api('/api/space/scan/result')") >= 0, 'C4 读结果');
ok(POLL.indexOf("api('/api/space/scan/status')") >= 0, 'C5 轮询状态');
ok(POLL.indexOf("api('/api/space/scan/result')") >= 0, 'C6 done 之后才拉结果');
ok(POLL.indexOf('spaceWatch.misses >= 5') >= 0, 'C7 连续失败有上限，不无限打日志');
ok(SRC.indexOf('function scheduleSpacePoll(') >= 0 && /spaceWatch\.timer = setBuildTimeout\(/.test(SRC),
  'C8 用可回收的 setBuildTimeout，不用 setInterval');
ok(SRC.indexOf('function stopSpacePolling()') >= 0 && /clearTimeout\(spaceWatch\.timer\)/.test(SRC),
  'C9 有统一的停止轮询入口');
ok(/job\.status === 'cancelled'/.test(SRC) && /job\.status === 'error'/.test(SRC) && /job\.status === 'done'/.test(SRC),
  'C10 收尾三态都处理了（done / cancelled / error）');

console.log('\n[D] 进度展示不伪造百分比');
ok(BOX.indexOf('wbs-space-indet') >= 0, 'D1 跑动中挂「不确定进度条」类');
ok(!/running[\s\S]{0,200}fill\.style\.width = '\d/.test(BOX), 'D2 跑动中不写死百分比宽度');
ok(/els\.fill\.style\.width = busy \? '' : '100%'/.test(BOX), 'D3 只有收尾时才把条填满');
ok(cssHas('.wbs-space-indet .wbs-sess-progress-fill{width:55%!important') && cssHas('@keyframes wbs-space-slide'),
  'D4 不确定进度条的动画规则在 CSS 里');
ok(SRC.indexOf("'.wbs-sess-progress{") >= 0 && PANE.indexOf('wbs-sess-progress-fill') >= 0,
  'D5 复用会话页的进度条样式，不另造一套');

console.log('\n[E] 口径说明（不做就会让人以为「各账号之和 ≠ 总数」是 bug）');
ok(RESULT.indexOf('互相重叠') >= 0 && RESULT.indexOf('不能相加') >= 0, 'E1 说明账号/空间两种切法重叠、不能相加');
ok(RESULT.indexOf('设备号, inode') >= 0, 'E2 说明去重口径与资源管理器一致');
ok(/totals\.dedupedFiles[\s\S]{0,200}fmtBytes\(totals\.dedupedBytes\)/.test(RESULT), 'E3 展示本次去重了多少');
ok(RESULT.indexOf('wbs-space-note warn') >= 0 && RESULT.indexOf('略小') >= 0, 'E4 有读不到的条目时提示实际占用会偏小');
ok(RESULT.indexOf('其它占用（不属于任何账号或空间）') >= 0, 'E5 给出总量总览（否则「账号加起来 < 总占用」无法解释）');
ok(RESULT.indexOf('去重前（含重复）') >= 0, 'E6 同时给出去重前的大小');

console.log('\n[F] 隐私：界面与进度都不含文件名');
ok(SUB.indexOf("job.current") >= 0, 'F1 副标题只取目录路径');
ok(!/job\.current(File|Name)|currentPath|filePath|item\.name\b/.test(SUB), 'F2 副标题不引用任何文件名字段', SUB.slice(0, 200));
ok(!/resp\w*\.name/.test(RESULT), 'F3 结果渲染里没有文件名字段');
// shared[].name / spaces[].cwd 是 dataRoot 的直接子项或目录路径，属于设计内暴露
ok(RESULT.indexOf('spaceBaseName(space.cwd') >= 0, 'F4 空间行只显示目录基名 + 完整目录路径');

console.log('\n[G] i18n 与样式落地');
ok(SRC.indexOf("'空间': 'Workspace'") >= 0, 'G1 tab 有英文');
['实际占用（去重后）', '文件数', '目录数', '重新扫描', '中断扫描', '开始扫描', '扫描已中断', '扫描完成'].forEach(function (key, i) {
  ok(SRC.indexOf("'" + key + "':") >= 0, 'G' + (2 + i) + ' i18n 词典含「' + key + '」');
});
ok(cssHas('.wbs-space-hero{') && cssHas('.wbs-space-row{') && cssHas('.wbs-space-note{') && cssHas('.wbs-space-empty{'),
  'G10 主要样式类都已定义');
ok(cssHas('.wbs-body:has(>[data-pane="spaces"].active){max-height:none;overflow:hidden}'),
  'G11 空间页自己滚，不让整页跟着滚');
ok(cssHas('.wbs-space-sec-head,.wbs-space-row{display:grid;grid-template-columns:minmax(0,1fr) auto 62px'),
  'G12 三列网格对齐（名称/体积/文件）');
// 空间页两个按钮都用 el.hidden 控制显隐，但 .wbs-sess-bbtn{display:inline-flex} 会盖掉
// UA 的 [hidden]{display:none}，于是「隐藏」不生效（真机截图抓到：空态下「重新扫描」和
// 「开始扫描」并排）。这条全局守卫规则不能删。
ok(cssHas('.wbs-root [hidden]{display:none !important}'),
  'G13 [hidden] 守卫规则在（类里写了 display 的元素也能真正藏住）');

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
