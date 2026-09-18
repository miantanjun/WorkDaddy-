'use strict';
/*
 * 2026-09-18（v1.3.12）：定时发送「字填进输入框了，但没发出去」的修复。
 *
 * 现场（2026-09-18 12:05，任务 task_sched_mu699jz0r781b，账号 186 / 会话 882c357a）：
 *   daemon.log 04:05:10.688  `composer:finish {"ok":true,"result":{"sent":true,"textLen":204}}`
 *   —— 可用户打开会话一看：那 204 字**还躺在输入框里**，会话消息里根本没有它。
 *   随后 automation:finish 只给出「未确认会话发送回执」⇒ 台账写成「结果不确定（可能已发出）」，
 *   既不敢重发，又要用户自己回来核对。
 *
 * 真因是**结构性的**：旧的 sendStashToComposer 在 cdpMouseClick 之后**无条件** return sent:true，
 * 从来不回头看这次点击有没有生效。于是三种结局（受理了 / 点了等于没点 / 受理但被业务拒绝）
 * 在 daemon 眼里长得一模一样，能拿到的最强信号只剩外层 12 秒回执轮询的「超时」。
 *
 * 判据来自 WorkBuddy renderer 自己（lib-chat-ui 的 executeSend）：
 *   点击被受理 → 先 dispatch(clear-draft) 再 await onSend；
 *   handleClick 的 semanticDisabled 早退、executeSend 的 empty / not-wired 早退 → **草稿原样留着**；
 *   handleSend 返回后也只有 reason==='before-send-rejected' 一种情况会把草稿放回。
 * ⇒「点击之后草稿还在」= 这次点击被静默吞掉 = **确定没发出去**，可以安全重试。
 *
 * 本套件分两段：
 *   A 段 —— 把 composerDraftExpr / composerDraftConsumed **从 daemon.js 切片出来真跑**
 *           （假 DOM 替身 + 真执行注入表达式，与 test-session-open.js 同一手法）。
 *   B 段 —— 源码接线断言：两条点击路径、核验必须先于宣布成功、吞掉要打 notSent 而不是 maybeSent。
 */
const fs = require('fs');

const DAEMON = 'D:/WorkDaddy/scripts/daemon.js';
const LEDGER = 'D:/WorkDaddy/scripts/schedule-ledger.js';
const norm = (s) => String(s).replace(/\r\n/g, '\n');
const SRC = norm(fs.readFileSync(DAEMON, 'utf8'));
const LSRC = norm(fs.readFileSync(LEDGER, 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { fail += 1; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};
const eq = (label, got, want) => ok(JSON.stringify(got) === JSON.stringify(want), label,
  'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));

/** 从 daemon.js 里切出一个顶层函数（到第一个顶格的 '}' 为止） */
const sliceFn = (src, name) => {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error('找不到 ' + name + ' 的结尾');
  return src.slice(start, end + 2);
};

/* ============================ 假 DOM 替身 ============================ */
// composerDraftExpr 只用到：'.voice-mic-wrap' 的父链、[contenteditable="true"]、
// cloneNode + querySelectorAll（剔除占位符/零宽）、innerText/textContent、[data-contentblock]、rect。
class FakeNode {
  constructor(tag, attrs = {}, text = '', children = []) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = attrs;
    this.text = text;
    this.children = children;
    this.parentElement = null;
    for (const c of children) c.parentElement = this;
  }
  get innerText() { return this.text + this.children.map((c) => c.innerText).join(''); }
  get textContent() { return this.innerText; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  _match(sel) {
    return String(sel).split(',').map((s) => s.trim()).some((p) => {
      const eqm = p.match(/^\[([^=\]]+)="([^"]*)"\]$/);
      if (eqm) return this.getAttribute(eqm[1]) === eqm[2];
      const hasm = p.match(/^\[([^=\]]+)\]$/);
      if (hasm) return this.getAttribute(hasm[1]) !== null;   // 属性存在即匹配（[data-contentblock]）
      return this.tagName === p.toUpperCase();
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c._match(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  cloneNode() {
    const copy = new FakeNode(this.tagName.toLowerCase(), { ...this.attrs }, this.text,
      this.children.map((c) => c.cloneNode()));
    return copy;
  }
  remove() {
    const p = this.parentElement;
    if (p) p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, width: 200, height: 30, bottom: 30 }; }
  focus() { return true; }
  scrollIntoView() { return undefined; }
  closest() { return null; }
}

/** 造一个「文档」，参数决定编辑器里有什么 */
function makeFakeDocument(opts = {}) {
  const { text = '', placeholder = null, zeroWidth = false, hasBlocks = false, withMic = true, noEditor = false } = opts;
  let editor = null;
  if (!noEditor) {
    const kids = [];
    if (placeholder !== null) kids.push(new FakeNode('span', { 'data-slate-placeholder': 'true' }, placeholder));
    if (zeroWidth) kids.push(new FakeNode('span', { 'data-slate-zero-width': 'true' }, '\uFEFF\u200B'));
    if (hasBlocks) kids.push(new FakeNode('div', { 'data-contentblock': 'true' }, ''));
    editor = new FakeNode('div', { contenteditable: 'true' }, text, kids);
  }
  const mic = new FakeNode('div', { class: 'voice-mic-wrap' });
  const holder = new FakeNode('div');
  if (editor) holder.children.push(editor);
  if (withMic) { mic.children.push(holder); }
  const root = new FakeNode('body', {}, '', withMic ? [mic] : (editor ? [editor] : []));
  root.querySelector = (sel) => {
    if (sel === '.voice-mic-wrap') return withMic ? root.querySelectorAll('.voice-mic-wrap')[0] || null : null;
    return FakeNode.prototype.querySelector.call(root, sel);
  };
  return {
    document: {
      querySelector: (sel) => (sel === '.voice-mic-wrap' ? (withMic ? mic : null) : root.querySelectorAll(sel)[0] || null),
      querySelectorAll: (sel) => root.querySelectorAll(sel),
      createElement: () => new FakeNode('div'),
    },
    editor,
  };
}

const draftFnFactory = new Function(sliceFn(SRC, 'composerDraftExpr') + '\nreturn composerDraftExpr;');
const buildDraftExpr = draftFnFactory();
const consumedFn = new Function(sliceFn(SRC, 'composerDraftConsumed') + '\nreturn composerDraftConsumed;')();

function runDraftExpr(opts) {
  const { document: doc } = makeFakeDocument(opts);
  const expr = buildDraftExpr();
  const fn = new Function('document', 'return ' + expr + ';');
  return fn(doc);
}

/* ============================ A 段：真跑探针 ============================ */
console.log('== A 组 composerDraftExpr（真执行注入表达式 + 假 DOM） ==');
eq('A1 空编辑器（只有占位符）读成 0 字', runDraftExpr({ placeholder: '今天帮你做些什么？' }), { ok: true, len: 0, hasBlocks: false });
eq('A2 真文字长度准确（25 字）', runDraftExpr({ text: 'WBS-PROBE-0918-abcdefghij' }), { ok: true, len: 25, hasBlocks: false });
eq('A3 占位符不计入长度', runDraftExpr({ text: 'hello', placeholder: '今天帮你做些什么？' }),
  { ok: true, len: 5, hasBlocks: false });
eq('A4 零宽字符被剔除（\\uFEFF\\u200B\\u00A0 都不算字）', runDraftExpr({ text: '\uFEFF\u200Babc\u00A0\u200B' }),
  { ok: true, len: 3, hasBlocks: false });
eq('A5 首尾空白与换行 trim 掉', runDraftExpr({ text: '\n\n  204字的内容  \n' }), { ok: true, len: 7, hasBlocks: false });
eq('A6 hasBlocks 反映 [data-contentblock] 存在', runDraftExpr({ text: 'x', hasBlocks: true }),
  { ok: true, len: 1, hasBlocks: true });
eq('A7 没有 .voice-mic-wrap 也能退回全量 contenteditable 找到编辑器', runDraftExpr({ text: 'abcdef', withMic: false }),
  { ok: true, len: 6, hasBlocks: false });
eq('A8 找不到编辑器时明确返回 ok:false（不伪造成 0）', runDraftExpr({ noEditor: true, withMic: false }),
  { ok: false, error: 'no editor' });

// 脱敏约定：探针只准暴露长度，不准把输入框里的字带回来（与 probeSessionReceipt 一致）。
const probeKeys = Object.keys(runDraftExpr({ text: 'SECRET-CONTENT-42' })).sort();
eq('A9 返回值只暴露 ok/len/hasBlocks（绝不回传文本）', probeKeys, ['hasBlocks', 'len', 'ok']);
ok(/len: text\.trim\(\)\.length/.test(sliceFn(SRC, 'composerDraftExpr'))
  && !/len:\s*text(?![.\w])/.test(sliceFn(SRC, 'composerDraftExpr')),
  'A10 探针源码里没有任何「原样回传文本」的写法');

/* ==================== B 段：composerDraftConsumed 真跑 ==================== */
console.log('== B 组 composerDraftConsumed（真跑判据函数） ==');
const T204 = 204;
ok(consumedFn({ ok: true, len: 0 }, T204) === true, 'B1 草稿归零 → 受理（点击生效）');
ok(consumedFn({ ok: true, len: T204 }, T204) === false, 'B2 **本轮 bug 的形态**：草稿原样 204 字 → 没受理');
ok(consumedFn({ ok: true, len: 200 }, T204) === false, 'B3 只掉一点点（200/204）不算受理');
ok(consumedFn({ ok: true, len: 100 }, T204) === true, 'B4 掉到一半以下（100/204）算受理');
ok(consumedFn(null, T204) === false, 'B5 探针读不到（null）绝不当作已发出');
ok(consumedFn({ ok: false, error: 'no editor' }, T204) === false, 'B6 探针返回 ok:false 也绝不当作已发出');
ok(consumedFn({ ok: true, len: 0 }, null) === true, 'B7 点击前读不到长度时，归零仍算受理');
ok(consumedFn({ ok: true, len: 5 }, null) === false, 'B8 点击前读不到长度时，非空一律不算受理（不猜）');
ok(consumedFn({ ok: true, len: 0 }, 2) === true, 'B9 极短内容（2 字）清了就是清了');
ok(consumedFn({ ok: true, len: 2 }, 2) === false, 'B10 极短内容留着就是留着');

/* ========================= C 段：源码接线 ========================= */
console.log('== C 组 源码接线（两条点击路径 + 核验先于宣布成功） ==');
const sendSrc = sliceFn(SRC, 'sendStashToComposer');
const mouseSrc = sliceFn(SRC, 'cdpMouseClick');
const at = (h, n) => h.indexOf(n);

const attemptsDecl = SRC.match(/const SEND_CLICK_ATTEMPTS = (\d+);/);
ok(!!attemptsDecl && Number(attemptsDecl[1]) >= 2 && Number(attemptsDecl[1]) <= 5,
  'C1 定义了 SEND_CLICK_ATTEMPTS 且 ≥2', 'got=' + (attemptsDecl && attemptsDecl[1]));

ok(/attempt === 1\s*\?\s*\{ skipMove: true \}/.test(sendSrc), 'C2 第 1 次点击走免悬停路径（skipMove）');
ok(/remeasure: async \(\) => \{/.test(sendSrc), 'C3 第 2 次起改回带悬停 + 按下前重测坐标（remeasure）');
ok(at(sendSrc, 'const sv = await probeSendButton();') > -1
  && at(sendSrc, 'const sv = await probeSendButton();') < at(sendSrc, 'await cdpMouseClick(\'automation:sendPhrase\''),
  'C4 点击坐标在**发起点击之前**才测量');

ok(/composer:click-verify/.test(sendSrc) && /preLen:/.test(sendSrc) && /afterLen:/.test(sendSrc),
  'C5 每次点击后都记一条 composer:click-verify（带 preLen/afterLen 以便事后自证）');
ok(at(sendSrc, 'composer:click-verify') > -1 && at(sendSrc, 'composer:click-verify') < at(sendSrc, 'composer:finish'),
  'C6 核验发生在宣布成功之前（composer:click-verify 早于 composer:finish）');
ok(at(sendSrc, 'const result = { sent: true') > at(sendSrc, 'composer:click-verify'),
  'C7 宣布 sent:true 必须晚于核验循环（不再点完就 return）');
ok(/swallowedLen !== null/.test(sendSrc) && /notSent: true/.test(sendSrc) && /确认未发出/.test(sendSrc),
  'C8 循环次数用满仍被吞 → 抛 notSent 的确定失败');
// 只看那个 throw 语句本身：notSent 必须是**唯一**被挂上的标记（注释里提到 maybeSent 不算）。
const swallowBranch = sendSrc.slice(at(sendSrc, 'if (swallowedLen !== null) {'),
  at(sendSrc, 'if (swallowedLen !== null) {') + 900);
ok(/notSent: true/.test(swallowBranch) && !/maybeSent:/.test(swallowBranch),
  'C9 这条失败**不**打 maybeSent（台账据此写「没有发出去」而不是「结果不确定」）',
  'branch=' + JSON.stringify(swallowBranch.slice(0, 160)));
ok((sendSrc.match(/cdpMouseClick\(/g) || []).length === 1,
  'C10 判定失败后不在函数内自行补发（判定权交回调度侧）');

ok(/options\.remeasure/.test(mouseSrc), 'C11 cdpMouseClick 支持 remeasure');
ok(at(mouseSrc, 'options.remeasure') > at(mouseSrc, "type: 'mouseMoved'")
  && at(mouseSrc, 'options.remeasure') < at(mouseSrc, "type: 'mousePressed'"),
  'C12 remeasure 在 mouseMoved 之后、mousePressed 之前执行');
ok(at(mouseSrc, 'options.remeasure') > at(mouseSrc, 'if (!options.skipMove) {'),
  'C13 remeasure 只在带悬停的那条路径里生效（skipMove 时不该等着重测）');
ok(/x = fresh\.x; y = fresh\.y;/.test(mouseSrc), 'C14 坐标重测真的换了 x/y（不是只记日志）');

console.log('== D 组 与核验台账对齐 ==');
ok(/run\.maybeSent = error && error\.maybeSent === true;/.test(SRC),
  'D1 run.maybeSent 仍只看 error.maybeSent（notSent 错误天然是 false）');
ok(/maybeSent === true \? 'unknown' : 'not-sent'/.test(LSRC), 'D2 台账把 maybeSent=false 判成 not-sent');
ok(/'not-sent': '定时任务没有发出去'/.test(LSRC) && /要补发/.test(LSRC),
  'D3 not-sent 的文案是「定时任务没有发出去」并给出补发指引');
ok(/结果不确定/.test(LSRC) && /可能已经发出去了/.test(LSRC),
  'D4 maybeSent=true 的文案仍保留「不确定，先看会话」');

console.log('\n===== test-send-verify: ' + pass + ' pass / ' + fail + ' fail =====');
process.exit(fail ? 1 : 0);
