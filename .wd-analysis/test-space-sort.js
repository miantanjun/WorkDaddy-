'use strict';
/*
 * test-space-sort.js —— 空间占用页「点列头排序」的回归测试（纯 Node，不需要 WorkBuddy / CDP）。
 *
 * 分三层：
 *   [A] 结构断言 —— 四个分组都换成了可点列头、事件委托只绑一次、未归属不参与排序；
 *   [B] 行为断言 —— 把 spaceSortClick / spaceSortList 从源码切出来，用夹具**真跑**，
 *       断言「第一下从大到小」「再点反过来」「换列重置方向」「分组互不干扰」「不原地重排」；
 *   [C] 样式 / i18n / 「没走改扫描器那条路」的证据。
 *
 * 为什么 [B] 必须真跑而不是看源码：排序方向、并列时的次序、以及「有没有偷偷把原数组排掉」
 * 这三类错误从源码里看不出来，只能跑。
 *
 * 跑法: node D:\WorkDaddy\.wd-analysis\test-space-sort.js
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'scripts', 'inject.js'), 'utf8').replace(/\r\n/g, '\n');
const SCAN = fs.readFileSync(path.join(REPO, 'scripts', 'space-scan.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
const count = (s, needle) => s.split(needle).length - 1;

/** 从源码里按 `function xxx(a)` 锚点取**完整声明**（含 function 关键字，到大括号配平处）。 */
function declBody(source, anchor) {
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
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  return '';
}
/** 取一整行（按行首锚点定位）。 */
function lineWith(source, anchor) {
  const at = source.indexOf(anchor);
  if (at < 0) return '';
  return source.slice(at, source.indexOf('\n', at));
}

const RESULT = declBody(SRC, 'function renderSpaceResult(result, meta)');
const PANE = declBody(SRC, 'function buildSpacesPane()');

// =====================================================================
console.log('[A] 结构：四个分组换成可点列头');
ok(SRC.indexOf('function spaceSortHeadHtml(sec, label)') >= 0, 'A1 列头构造函数在');
ok(SRC.indexOf('function spaceSortList(list, sec)') >= 0, 'A2 排序函数在');
ok(SRC.indexOf('function spaceSortClick(sec, key)') >= 0, 'A3 点击改状态函数在');
ok(count(RESULT, 'spaceSortHeadHtml(') === 4, 'A4 四个分组（账号/空间/任务对话/其它占用）各调一次',
  count(RESULT, 'spaceSortHeadHtml('));
['accounts', 'spaces', 'conversations', 'shared'].forEach(function (sec, i) {
  ok(RESULT.indexOf("spaceSortHeadHtml('" + sec + "'") >= 0, 'A' + (5 + i) + ' 分组 ' + sec + ' 用了可点列头');
});
ok(count(RESULT, 'spaceSortList(') === 4, 'A9 四个分组的数据都过了一遍排序', count(RESULT, 'spaceSortList('));
// 否定性断言：除「未归属」（单行、没有排序意义）外，不该再有写死的表头
ok(count(RESULT, '<span>实际占用</span>') === 1, 'A10 只剩「未归属」一个写死的表头',
  count(RESULT, '<span>实际占用</span>'));
ok(RESULT.indexOf('<span>未归属</span><span>实际占用</span><span>文件数</span>') >= 0,
  'A11 未归属表头第三列改用「文件数」（已在词典里，英文模式下不再是中文）');
ok(RESULT.indexOf('<span>文件</span>') < 0, 'A12 不再有裸的「文件」表头（裸词条会把长句撕成中英混合，故意不入典）');
// 汇总行必须跟着「排序后的数组」走，否则总数会对不上
ok(/for \(i = top\.length; i < spaceRows\.length; i\+\+\)/.test(RESULT), 'A13 「其余空间」按排序后的尾部聚合');
ok(/for \(i = topConv\.length; i < convRows\.length; i\+\+\)/.test(RESULT), 'A14 「其余对话」按排序后的尾部聚合');
ok(/for \(i = topShared\.length; i < sharedRows\.length; i\+\+\)/.test(RESULT), 'A15 「其余共享项」按排序后的尾部聚合');
ok(/var top = spaceRows\.slice\(0, 15\)/.test(RESULT) && /var topConv = convRows\.slice\(0, 15\)/.test(RESULT)
  && /var topShared = sharedRows\.slice\(0, 12\)/.test(RESULT),
  'A16 展示条数仍是 15/15/12（排序只换顺序，不改口径）');
ok(RESULT.indexOf('spaceWatch.result = result') >= 0, 'A17 记住最近一次结果，点排序时不再打 daemon');
ok(PANE.indexOf("els.body.addEventListener('click', onSpaceSortClick)") >= 0,
  'A18 事件委托只在容器上绑一次（渲染换 innerHTML 也不会丢）');
ok(SRC.indexOf("target.closest('.wbs-space-sort')") >= 0, 'A19 委托按 .wbs-space-sort 命中，不依赖具体位置');
ok(SRC.indexOf("' data-space-dir=\"' + (on ? state.dir : '')") >= 0 && SRC.indexOf("' aria-pressed=\"' + (on ? 'true' : 'false')") >= 0,
  'A20 列头带 data-space-dir + aria-pressed（状态读得出来，无障碍也过得去）');
ok(SRC.indexOf('SPACE_SORT_KEYS = { bytes: 1, files: 1 }') >= 0, 'A21 只认 bytes / files 两个键，别的字段一律拒');
ok(RESULT.indexOf("if (!result || !result.totals) { spaceWatch.result = null;") >= 0,
  'A22 没有结果时把缓存的引用一并清掉（避免点排序拿到上一轮的结果）');

// =====================================================================
console.log('\n[B] 行为：把排序函数切出来真跑');
const SANDBOX = [
  lineWith(SRC, '    var spaceWatch = {'),
  lineWith(SRC, '    var SPACE_SORT_KEYS ='),
  declBody(SRC, 'function spaceSortOf(sec)'),
  declBody(SRC, 'function spaceSortClick(sec, key)'),
  declBody(SRC, 'function spaceSortName(item)'),
  declBody(SRC, 'function spaceSortList(list, sec)'),
].join('\n');
ok(SANDBOX.indexOf('function spaceSortList(list, sec)') >= 0 && SANDBOX.indexOf('var spaceWatch') >= 0,
  'B0 四个函数体 + 状态对象都切出来了', SANDBOX.length);

// eslint-disable-next-line no-new-func
const sb = new Function(SANDBOX + '\nreturn { watch: spaceWatch, click: spaceSortClick, list: spaceSortList, of: spaceSortOf };')();

const FIX = [
  { cwd: 'D:\\a', bytes: 300, files: 5 },
  { cwd: 'D:\\b', bytes: 900, files: 1 },
  { cwd: 'D:\\c', bytes: 100, files: 40 },
  { cwd: 'D:\\d', bytes: 900, files: 9 },
];
const names = (rows) => rows.map((r) => r.cwd.slice(-1)).join('');
const filesOf = (rows) => rows.map((r) => r.files);

ok(names(sb.list(FIX, 'spaces')) === 'abcd', 'B1 没点过列头时保持原顺序（服务端已按占用排好）');
ok(sb.list(FIX, 'spaces') === FIX, 'B2 没排序时原样返回，不做无意义的复制');

sb.click('spaces', 'bytes');
ok(names(sb.list(FIX, 'spaces')) === 'bdac',
  'B3 第一下点「实际占用」= 从大到小（并列时按名称定序，次序确定不抖）', names(sb.list(FIX, 'spaces')));
const desc = sb.list(FIX, 'spaces');
ok(desc[0].bytes >= desc[1].bytes && desc[1].bytes >= desc[2].bytes && desc[2].bytes >= desc[3].bytes,
  'B3b 相邻两行确实非递增');

sb.click('spaces', 'bytes');
ok(names(sb.list(FIX, 'spaces')) === 'cabd', 'B4 再点同一列 = 反过来（从小到大）', names(sb.list(FIX, 'spaces')));

sb.click('spaces', 'files');
ok(names(sb.list(FIX, 'spaces')) === 'cdab',
  'B5 点「文件数」= 从多到少，且方向重置（不会继承上一次的升序）', names(sb.list(FIX, 'spaces')));
ok(filesOf(sb.list(FIX, 'spaces')).join(',') === '40,9,5,1', 'B5b 文件数确实非递增', filesOf(sb.list(FIX, 'spaces')));

sb.click('spaces', 'files');
ok(filesOf(sb.list(FIX, 'spaces')).join(',') === '1,5,9,40', 'B6 再点 = 从少到多');

const BEFORE = names(FIX);
sb.list(FIX, 'spaces');
ok(names(FIX) === BEFORE, 'B7 排序不原地改数组（result 会被重复渲染，改了就再也回不到默认顺序）', names(FIX));

const ACC = [{ nickname: 'x', bytes: 1, files: 9 }, { nickname: 'y', bytes: 2, files: 1 }];
ok(sb.list(ACC, 'accounts').map((r) => r.nickname).join('') === 'xy',
  'B8 分组互不干扰：spaces 排过之后 accounts 仍是原顺序');
ok(sb.click('spaces', 'cwd') === false, 'B9 非法列名被拒（不会把 key 设成任意字段）');
ok(sb.of('spaces').key === 'files' && sb.of('spaces').dir === 'asc', 'B10 拒绝后状态没被弄脏',
  { key: sb.of('spaces').key, dir: sb.of('spaces').dir });
ok(sb.of('accounts').key === '' && sb.of('accounts').dir === 'desc', 'B11 未点过的分组默认是「无排序 + 降序」');

const TIE = [{ name: 'zzz', bytes: 500, files: 3 }, { name: 'aaa', bytes: 500, files: 3 }];
sb.click('accounts', 'files');
const tie1 = sb.list(TIE, 'accounts').map((r) => r.name).join(',');
const tie2 = sb.list(TIE, 'accounts').map((r) => r.name).join(',');
ok(tie1 === 'aaa,zzz', 'B12 完全并列时按名称定序（可预期，不是随机）', tie1);
ok(tie1 === tie2, 'B13 连续两次排序结果完全一致（确定性，界面不会闪来闪去）');
ok(sb.list([], 'spaces').length === 0 && sb.list(null, 'spaces').length === 0,
  'B14 空数组 / 非数组不会抛（渲染中途 result 缺字段也能扛住）');

// =====================================================================
console.log('\n[C] 样式 / i18n / 「没走改扫描器那条路」');
const CSS_FRAGS = [
  '.wbs-space-sort{', '.wbs-space-sort:hover{', '.wbs-space-sort.on{', '.wbs-space-sort:focus-visible{',
  '.wbs-space-caret{', '.wbs-space-sort:hover .wbs-space-caret{', '.wbs-space-sort.on .wbs-space-caret{',
];
CSS_FRAGS.forEach(function (frag, i) {
  ok(SRC.indexOf(frag) >= 0, 'C' + (1 + i) + ' 样式 ' + frag + ' 在');
});
ok(SRC.indexOf('position:absolute;left:100%;margin-left:2px') >= 0,
  'C8 箭头绝对定位挂在按钮右缘之外（不占宽度 → 列头文字与下方数值保持右对齐）');
ok(/\.wbs-space-sort\{[^}]*cursor:pointer/.test(SRC), 'C9 列头是可点的（cursor:pointer）');
ok(SRC.indexOf('font-style:normal;font-size:9px;line-height:1;opacity:0') >= 0,
  'C10 未排序时箭头隐形但保留宽度（切换时不跳位）');
ok(SRC.indexOf("'点击按实际占用排序': 'Click to sort by on-disk size'") >= 0, 'C11 tooltip 1 整句入典');
ok(SRC.indexOf("'点击按文件数排序': 'Click to sort by file count'") >= 0, 'C12 tooltip 2 整句入典');
// 关键：没改扫描器 → 不必递增 SPACE_SCAN_VERSION → 不需要重扫（本机冷跑约 110 秒）
ok(/^const SPACE_SCAN_VERSION = 3;/m.test(SCAN), 'C13 space-scan.js 未动：版本号仍是 3（旧缓存继续可用，不用重扫）');
ok(SCAN.indexOf('spaceSort') < 0 && SCAN.indexOf('spaceRows') < 0, 'C14 排序逻辑没有渗进扫描器');
ok(count(SCAN, '.sort((a, b) => b.rawBytes - a.rawBytes);') === 4,
  'C15 扫描器仍按 rawBytes 出默认顺序（账号/会话/空间/共享四处，排序只发生在渲染层）',
  count(SCAN, '.sort((a, b) => b.rawBytes - a.rawBytes);'));

// --- i18n：真跑翻译器，断言列头与两条 tooltip 零 CJK 残留 ---
const lines = SRC.split('\n');
const idxOf = (re, from) => { for (let i = from || 0; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
const ds = idxOf(/var WBS_I18N_EN = \{/);
const de = idxOf(/^\s*\};\s*$/, ds + 1);
const ms = idxOf(/var wbsI18nMatchers = null;/);
const me = idxOf(/function wbsIsBuiltinAutomation/, ms);
ok(ds >= 0 && de > ds && ms >= 0 && me > ms, 'C16 i18n 词典与翻译器都抽取成功', { ds, de, ms, me });
// eslint-disable-next-line no-new-func
const translate = new Function(
  lines.slice(ds, de + 1).join('\n') + '\n' + lines.slice(ms, me).join('\n') + '\nreturn wbsTranslateString;'
)();
const CJK = /[\u4e00-\u9fff]/;
const t1 = translate('点击按实际占用排序', 'en');
const t2 = translate('点击按文件数排序', 'en');
ok(!CJK.test(t1) && t1 === 'Click to sort by on-disk size', 'C17 tooltip1 翻完零 CJK 残留', t1);
ok(!CJK.test(t2) && t2 === 'Click to sort by file count', 'C18 tooltip2 翻完零 CJK 残留', t2);
const HEADS = ['实际占用', '文件数', '空间（工作目录）', '其它占用（不属于任何账号或空间）', '未归属', '账号', '任务对话（按占用排序）'];
HEADS.forEach(function (key, i) {
  const out = translate(key, 'en');
  ok(!CJK.test(out), 'C' + (19 + i) + ' 列头「' + key + '」在英文下零 CJK 残留', out);
});
// 交叉验证：整句 tooltip 入典之后，短词条不会把它撕开
const mixed = translate('点击按实际占用排序 点击按文件数排序', 'en');
ok(!CJK.test(mixed), 'C26 两条 tooltip 连着翻也不残留中文', mixed);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
