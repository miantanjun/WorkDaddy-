#!/usr/bin/env node
/**
 * 「中文思考」开关（全局自定义指令注入）回归套件
 *
 * 背景：插件把「思考链用简体中文」写进 WorkBuddy 官方「全局自定义指令」
 * （settings.personalization.customPrompt → 渲染进 <user_custom_instructions>）。
 * 这条通道**会改用户的核心配置文件**，所以安全性必须由测试守住：
 * 只碰自己那一段、用户原有内容一字不动、重复开启幂等、与「决策弹窗」段互不干扰。
 *
 * 做法：daemon.js 是主程序（require 会起服务），故这里把纯函数源码抽出来在 vm 里**真跑**，
 * 而不是只对源码做形态断言 —— 仓里 test-upstream-127 的 Linux 三段也是这个路子。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DAEMON = path.join(ROOT, 'scripts', 'daemon.js');
const INJECT = path.join(ROOT, 'scripts', 'inject.js');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return; }
  failures.push(label);
  console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const daemonSrc = fs.readFileSync(DAEMON, 'utf8').replace(/\r\n/g, '\n');
const injectSrc = fs.readFileSync(INJECT, 'utf8').replace(/\r\n/g, '\n');

/** 从源码里按大括号配平抽出一个函数体 */
function grabFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('未找到函数 ' + name);
  const out = [];
  let depth = 0, started = false;
  for (const line of src.slice(at).split('\n')) {
    out.push(line);
    for (const ch of line) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
  return out.join('\n');
}
/** 抽一行 const 定义 */
function grabConst(src, name) {
  const m = src.match(new RegExp('^const ' + name + ' = .*$', 'm'));
  if (!m) throw new Error('未找到常量 ' + name);
  return m[0];
}

console.log('[中文思考开关] 全局自定义指令注入');

/* ============ A. 纯函数真跑（vm） ============ */
// ⚠️ 这几段在 daemon.js 里是**连续**的（常量 → buildZhReasoningBlock → stripZhReasoning →
//    getZhReasoningState）。直接按位置切片，比逐行解析可靠 —— ZH_REASONING_RULE 是多行数组，
//    正则只抓一行会切出半截源码（第一版就踩了这个，vm 报 Unexpected token 'function'）。
const sandbox = {
  console,
  readWorkbuddySettings: () => ({}),
  writeWorkbuddySettings: () => {},
  PROFILE: { kind: 'workbuddy' },
  log: () => {},
};
sandbox.global = sandbox;
vm.createContext(sandbox);

let fnSrc = '';
try {
  const startAt = daemonSrc.indexOf('const ZH_REASONING_TAG_START');
  const endAt = daemonSrc.indexOf('function getZhReasoningState');
  if (startAt < 0 || endAt < 0 || endAt <= startAt) throw new Error('未能在 daemon.js 中定位纯函数区段');
  fnSrc = daemonSrc.slice(startAt, endAt);
  // ⚠️ vm 里顶层 const/function 不会自动挂到 context 对象上 ⇒ 必须显式导出
  vm.runInContext(
    fnSrc + '\n\n;globalThis.__zh = { buildZhReasoningBlock, stripZhReasoning, ZH_REASONING_TAG_START, ZH_REASONING_TAG_END, ZH_REASONING_RULE };',
    sandbox,
    { filename: 'zh-reasoning-fns.js' }
  );
} catch (e) {
  console.log('  FAIL A0 抽出的纯函数无法在 vm 中执行: ' + e.message);
  failures.push('A0');
}

const EX = sandbox.__zh || {};
const build = EX.buildZhReasoningBlock;
const strip = EX.stripZhReasoning;
const T_START = EX.ZH_REASONING_TAG_START;
const T_END = EX.ZH_REASONING_TAG_END;

ok(typeof build === 'function' && typeof strip === 'function',
  'A1 build / strip 两个纯函数可独立执行（真跑，非形态断言）', { build: typeof build, strip: typeof strip });
if (typeof build !== 'function' || typeof strip !== 'function') {
  console.log('');
  console.log('==== ' + pass + ' passed, ' + (failures.length || 1) + ' failed ====');
  process.exit(1);
}

const BLOCK = build();
ok(BLOCK.startsWith(T_START) && BLOCK.endsWith(T_END),
  'A2 块以起止标记精确包裹（开关时才能精确定位）', { head: BLOCK.slice(0, 30), tail: BLOCK.slice(-30) });
ok(/^Think in Simplified Chinese\.$/m.test(BLOCK),
  'A3 ⭐ 含「直接思考模式指令」首句（Issue #1255 实测：输出层锚定约 1600 行后漂移，直接思考指令 2000+ 行零漂移）');
ok(BLOCK.includes('思考链') && BLOCK.includes('简体中文'),
  'A4 细则说明约束的对象是「思考链」本身（思考语言 ≠ 输出语言，是两个独立操作）');
ok(/代码|shell|文件路径|变量名|API/.test(BLOCK) && BLOCK.includes('原样保留'),
  'A5 ⭐ 明确豁免代码/命令/路径/变量名/API —— 那些直接影响正确率的部分不翻译');
ok(BLOCK.includes('例外'), 'A6 留了「用户明确要求换语言」的出口（避免全局锁死）');
ok(BLOCK.split(T_START).length - 1 === 1 && BLOCK.split(T_END).length - 1 === 1,
  'A7 单个块内起止标记各恰好一次');

/* ---- strip 的安全性 ---- */
ok(strip('') === '' && strip(null) === '' && strip(undefined) === '',
  'A8 strip 对空/非字符串输入安全（不抛错）', { e: strip(''), n: strip(null), u: strip(undefined) });
ok(strip('用户手写的指令') === '用户手写的指令',
  'A9 ⭐ 不含本插件块时，用户内容原样返回（一字不改）');

const USER = '我是一名外贸业务员，回复请简洁。';
const withBlock = strip(USER) + '\n\n' + BLOCK;
ok(strip(withBlock) === USER,
  'A10 ⭐⭐ 开→关 往返：用户内容逐字节恢复（这是本功能最重要的安全属性）', { got: strip(withBlock) });

ok(strip(BLOCK) === '', 'A11 只有插件块时，移除后为空串');

const twice = strip(strip(withBlock) + '\n\n' + BLOCK);
ok(twice === USER, 'A12 幂等：对「已被 strip 过又重建」的文本再 strip，结果不变', { got: twice });
ok((strip(USER) + '\n\n' + BLOCK).split(T_START).length - 1 === 1,
  'A13 幂等：重建后只有一个块（重复开启不会叠加）');

// 与「决策弹窗」段共存
const ASK_START = '<!-- wbs-ask-mode:start -->';
const ASK_END = '<!-- wbs-ask-mode:end -->';
const askBlock = ASK_START + '\nASK RULE\n' + ASK_END;
const both = [USER, askBlock, BLOCK].join('\n\n');
const onlyAsk = strip(both);
ok(onlyAsk.includes(ASK_START) && onlyAsk.includes(ASK_END),
  'A14 ⭐ 两条规则共存：移除本插件段时，decide-弹窗段必须完好（互不干扰）');
ok(onlyAsk === USER + '\n\n' + askBlock,
  'A15 ⭐ 共存往返逐字节一致', { got: onlyAsk });

// 边界：起止标记残缺（用户手改坏了）
ok(strip(USER + '\n' + T_START + '\n半截') === (USER + '\n' + T_START + '\n半截').trim(),
  'A16 标记残缺（只有 start 没 end）时不误删用户内容 —— 宁可不动也不毁数据');

/* ============ B. daemon 侧接线 ============ */
console.log('');
console.log('[接线检查]');
for (const [label, needle, min] of [
  ['B1 GET 路由 /api/zh-reasoning', "p === '/api/zh-reasoning'", 1],
  ['B2 POST 路由 /api/zh-reasoning-set', "p === '/api/zh-reasoning-set'", 1],
  ['B3 写的是官方「全局自定义指令」settings.personalization.customPrompt', "settings.personalization.customPrompt", 3],
  ['B4 启动时刷新规则到最新版（调用点）', 'refreshZhReasoningIfEnabled();', 1],
  ['B5 走 writeWorkbuddySettings（与其它设置同一条写路径）', 'writeWorkbuddySettings(settings);', 1],
]) {
  ok(daemonSrc.split(needle).length - 1 >= min, label, { found: daemonSrc.split(needle).length - 1, need: min });
}

ok(daemonSrc.includes('function refreshZhReasoningIfEnabled()'),
  'B6 有独立的「启动刷新」函数定义（改了规则文本后，已开启的用户也能拿到新版）');
ok(daemonSrc.indexOf("delete settings.personalization.customPrompt") > 0,
  'B7 ⭐ 关闭时若用户本无自定义指令，连键一起摘掉 ⇒「开→关」字节级回到原状');

/* ============ C. inject 侧接线 ============ */
for (const [label, needle, min] of [
  ['C1 面板开关控件 #wbs-sess-zh-reasoning', 'wbs-sess-zh-reasoning', 2],
  ['C2 读状态走 GET /api/zh-reasoning', "'/api/zh-reasoning'", 1],
  ['C3 写状态走 POST /api/zh-reasoning-set', "'/api/zh-reasoning-set'", 1],
  ['C4 失败时回滚 UI 勾选态（不留假状态）', 'el.checked = !enabled;', 1],
]) {
  ok(injectSrc.split(needle).length - 1 >= min, label, { found: injectSrc.split(needle).length - 1, need: min });
}
ok(/id="wbs-sess-zh-reasoning"/.test(injectSrc),
  'C5 开关是真实可点的 checkbox（用户能在面板上操作）');
ok(!/wbs-zh-reasoning[^\n]{0,80}display:none/.test(injectSrc),
  'C6 开关所在行不是隐藏卡片（ask 那张 wbs-ask-card 是 display:none 且无人解除 ⇒ 不能照抄）');

/* ============ 汇总 ============ */
console.log('');
console.log('==== ' + pass + ' passed, ' + failures.length + ' failed ====');
process.exit(failures.length ? 1 : 0);
