'use strict';
/*
 * test-structured-error.js —— F2 第二期（渲染层结构化错误）+ A3（模型级冷却参与选号）。
 *
 * 背景：官方云请求由**主进程**发出（渲染层走 IPC），渲染进程看不到原始响应。
 * 可用观测点实测只剩一个正规通道：
 *   `provider.api.onSessionEvent(cb)` → `client.on('session:event', cb)`
 * （频道名出自 asar `/preload/index.js` 的 `SESSION_RPC_CHANNELS.EVENT`）。
 * 本套件锁四件事：
 *   [A] `scanStructuredError` 形状无关扫描（多字段容错 / 不误报 / 循环与深度安全）
 *   [B] `observationFrom` 合成观测 —— 尤其是「无结构化信号时与 F2 之前**逐字相同**」
 *   [C] CDP 表达式**自包含**（不得 require、不得引用模块级标识符）且在伪页面里真跑
 *   [D] A3：`isUsableForFailover` 第 4 参 modelId（不传 ⇒ 零行为变化）+ 选号接线
 *
 * 设计约束：
 *   1. 不 require daemon.js（它 require 即起 HTTP 服务）—— 用静态源码断言；
 *   2. structured-error.js / account-health.js / limit-failover.js 无副作用 ⇒ 直接 require 真跑；
 *   3. daemon.js 是 CRLF，断言前归一化为 LF；
 *   4. 时刻/uid 全部固定，断言不依赖真实时钟与网络。
 *
 * 跑法：node .wd-analysis/test-structured-error.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else {
    failures.push(label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const SE = require(path.join(ROOT, 'scripts', 'structured-error.js'));
const AH = require(path.join(ROOT, 'scripts', 'account-health.js'));
const LF = require(path.join(ROOT, 'scripts', 'limit-failover.js'));

const DAEMON_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8').replace(/\r\n/g, '\n');
const T0 = 1758499200000; // 固定基准时刻（2025-09-22T00:00:00Z）

/* ==================================================================== */
console.log('\n== A. scanStructuredError：形状无关扫描 ==');

{
  // 官方错误对象真实形状（活体探针取得）：{code,name,data,httpStatus}
  const r = SE.scanStructuredError({ code: '4002', name: 'X', data: { a: 1 }, httpStatus: 500 });
  ok(r.found === true, 'A1 官方扁平错误对象被识别', r);
  ok(r.code === '4002', 'A2 code 取出', r.code);
  ok(r.httpStatus === 500, 'A3 httpStatus 取出（5xx 走熔断那一层）', r.httpStatus);
  ok(r.keys.indexOf('code') >= 0 && r.keys.indexOf('httpStatus') >= 0, 'A4 keys 回带原始键名（诊断用）', r.keys);
  ok(r.paths.indexOf('.httpStatus') >= 0, 'A5 paths 记录命中位置', r.paths);
}
{
  const r = SE.scanStructuredError({ type: 'taskUpdate', update: { error: { code: '429' } } });
  ok(r.found === true && r.code === '429', 'A6 嵌套 update.error.code 也能挖到', r);
  const r2 = SE.scanStructuredError({ type: 'taskUpdate', update: { stopReason: 'rate_limit' } });
  ok(r2.stopReason === 'rate_limit', 'A7 stopReason 命中', r2);
  const r3 = SE.scanStructuredError({ sessionId: 's', update: { message: 'too many requests', serverDetail: 'detail-x' } });
  ok(r3.message === 'too many requests' && r3.detail === 'detail-x', 'A8 message / serverDetail 采集', r3);
}
{
  const r = SE.scanStructuredError({ state: 'running', status: 200, mode: 'agent' });
  ok(r.found === false, 'A9 status:200 不算错误信号（不是 HTTP 错误码表里的值）', r);
  const r2 = SE.scanStructuredError({ state: 'running', status: 429 });
  ok(r2.httpStatus === 429, 'A10 status:429 认（在码表里）', r2);
  const r3 = SE.scanStructuredError({ status: 'running' });
  ok(r3.httpStatus === 0 && r3.found === false, 'A11 status 是字符串 "running" ⇒ 不误报', r3);
}
{
  const r = SE.scanStructuredError({ Code: '4002', HttpStatus: 500 });
  ok(r.found === false, 'A12 大小写不符的键不命中（避免误报）', r);
  const r2 = SE.scanStructuredError({ code: 0 });
  ok(r2.found === false, 'A13 code:0 不当信号（占位值）', r2);
  const r3 = SE.scanStructuredError({ errorCode: 11102 });
  ok(r3.code === '11102', 'A14 数字型 errorCode 转字符串', r3);
}
{
  ok(SE.scanStructuredError(null).found === false, 'A15 null 安全');
  ok(SE.scanStructuredError(undefined).found === false, 'A16 undefined 安全');
  ok(SE.scanStructuredError('boom').found === false, 'A17 字符串安全');
  ok(SE.scanStructuredError({}).found === false, 'A18 空对象安全');
  ok(SE.scanStructuredError({ a: 1 }).found === false, 'A19 无信号对象 found=false', SE.scanStructuredError({ a: 1 }));
}
{
  const cyc = { code: '429' };
  cyc.self = cyc;
  let threw = false;
  let r = null;
  try { r = SE.scanStructuredError(cyc); } catch (e) { threw = true; }
  ok(!threw && r && r.code === '429', 'A20 循环引用不炸且仍能取到信号', r);
}
{
  // 深度上限：信号藏在 maxDepth 之外就不该挖到（防止把整棵会话树扫穿）
  const shallowTree = { child: { child: { code: '429' } } };   // 信号在 depth 2
  let deepTree = { code: '429' };                              // 信号在 depth 12
  for (let i = 0; i < 12; i += 1) deepTree = { child: deepTree };
  ok(SE.scanStructuredError(shallowTree, { maxDepth: 1 }).found === false,
    'A21 maxDepth=1 时 depth 2 的信号挖不到（上限生效）');
  ok(SE.scanStructuredError(shallowTree, { maxDepth: 3 }).found === true,
    'A22 maxDepth=3 时 depth 2 的信号能挖到');
  ok(SE.scanStructuredError(deepTree).found === false,
    'A23 默认 maxDepth=6 ⇒ depth 12 不挖（不会把整棵会话树扫穿）',
    SE.scanStructuredError(deepTree).paths);
}
{
  const r = SE.scanStructuredError({ bizCode: '6004', code: '9999' });
  ok(r.bizCode === '6004', 'A24 bizCode 与 code 并存时各自归位', r);
  ok(r.code === '9999', 'A25 code 也照样取出', r.code);
  ok(r.score >= 100, 'A26 bizCode 权重最高（多参竞争时优先）', r.score);
}

/* ==================================================================== */
console.log('\n== B. observationFrom：合成观测（零行为变化是硬约束） ==');

{
  const hits = [{ sel: '.cb-input-banner--error', text: '请求过于频繁' }];
  const legacy = { source: 'dom-banner', hits: hits, modelId: 'm1', text: '请求过于频繁' };
  ok(eq(SE.observationFrom(null, { hits: hits, modelId: 'm1' }), legacy),
    'B1 【硬约束】无结构化信号 ⇒ 与 F2 之前逐字相同', SE.observationFrom(null, { hits: hits, modelId: 'm1' }));
  ok(eq(SE.observationFrom({ found: false }, { hits: hits, modelId: 'm1' }), legacy),
    'B2 found:false 同样走老路（形状不对就当没有）');
  ok(eq(SE.observationFrom(null, {}), { source: 'dom-banner', hits: [], modelId: '', text: '' }),
    'B3 空参也安全');
}
{
  const o = SE.observationFrom({ found: true, code: '4002', httpStatus: 500, stopReason: 'server_error', message: 'boom', detail: 'd' },
    { hits: [{ text: '横幅' }], modelId: 'm2' });
  ok(o.source === 'structured-acp', 'B4 有结构化信号 ⇒ source 切到 structured-acp', o.source);
  ok(o.httpStatus === 500, 'B5 httpStatus 透出（classifyObservation 直接用）', o.httpStatus);
  ok(o.modelId === 'm2' && o.hits.length === 1, 'B6 hits / modelId 原样保留');
  ok(o.text.indexOf('横幅') === 0 && o.text.indexOf('stopReason=server_error') > 0 && o.text.indexOf('boom') > 0,
    'B7 text = 横幅 + stopReason + message（让既有文案层兜底）', o.text);
  ok(o.bizCode === undefined, 'B8 code=4002 不是业务码形状 ⇒ 不塞进 bizCode', o.bizCode);
}
{
  ok(SE.observationFrom({ found: true, code: '6004' }, {}).bizCode === '6004', 'B9 code=6004 当业务码（模型日额度那一层）');
  ok(SE.observationFrom({ found: true, code: '11102' }, {}).bizCode === '11102', 'B10 code=11102 当业务码（上游模型额度码）');
  ok(SE.observationFrom({ found: true, code: '14012' }, {}).bizCode === '14012', 'B11 code=14012 当业务码（额度码）');
  const r429 = SE.observationFrom({ found: true, code: '429' }, {});
  ok(r429.bizCode === undefined && r429.text.indexOf('code=429') >= 0,
    'B12 code=429 不当业务码，但进 text（HTTP 码留给自己那一层判）', r429);
  const rabc = SE.observationFrom({ found: true, code: 'ABC-1' }, {});
  ok(rabc.text.indexOf('code=') < 0, 'B13 非纯数字 code 不进 text（避免污染文案正则）', rabc.text);
  ok(SE.observationFrom({ found: true, bizCode: '6004', code: '6004' }, {}).text.indexOf('code=') < 0,
    'B14 bizCode 与 code 相同时不重复写 text');
}

/* ==================================================================== */
console.log('\n== C. CDP 表达式：自包含 + 伪页面真跑 ==');

const EXPR = SE.structuredErrorProbeExpression();
{
  ok(EXPR.indexOf('require(') < 0, 'C1 表达式不含 require（页面里没有 CommonJS）');
  ok(EXPR.indexOf('function scanStructuredError') > 0, 'C2 扫描函数被内联进表达式');
  ok(EXPR.indexOf('onSessionEvent') > 0, 'C3 走正规订阅入口 api.onSessionEvent');
  ok(EXPR.indexOf(SE.RENDERER_SLOT) > 0, 'C4 槽位名 ' + SE.RENDERER_SLOT + ' 出现');
  ok(SE.structuredErrorUninstallExpression().indexOf('session:event') > 0
    && SE.structuredErrorUninstallExpression().indexOf(SE.SESSION_EVENT_CHANNEL) > 0,
    'C5 频道常量（' + SE.SESSION_EVENT_CHANNEL + '）落在卸载表达式里');
  const open = (EXPR.match(/\(/g) || []).length;
  const close = (EXPR.match(/\)/g) || []).length;
  ok(open === close, 'C6 圆括号配平', [open, close]);
  ok(EXPR.length < 24000, 'C7 表达式长度有界（<24KB，CDP 报文不吃紧）', EXPR.length);
  ok(SE.structuredErrorUninstallExpression().indexOf('delete window') > 0, 'C8 卸载表达式存在（排障用）');
}

/** 在伪 window/document 里跑一次表达式。 */
function runExpr(win, doc) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'return ' + EXPR);
  return fn(win, doc);
}
function makePage(withApi) {
  const api = {
    calls: 0,
    sinks: [],
    onSessionEvent(cb) { this.calls += 1; this.sinks.push(cb); },
  };
  const host = {
    daemonClient: { cloudAgentDeleteConversation() {} },
    client: { provider: { api: withApi === false ? {} : api } },
  };
  const fiber = { memoizedProps: { adapter: host }, return: null };
  const el = { __reactFiber$1: fiber };
  return { win: {}, doc: { querySelectorAll: () => (withApi === false ? [] : [el]) }, api: api };
}

{
  const p = makePage(true);
  const r = runExpr(p.win, p.doc);
  ok(r && r.ok === true, 'C9 找到 api ⇒ ok:true', r);
  ok(r.installed === true, 'C10 首次运行完成安装', r);
  ok(p.api.calls === 1, 'C11 只注册一个监听器', p.api.calls);
  ok(Object.keys(p.win).length === 1 && p.win[SE.RENDERER_SLOT], 'C12 只往 window 上加一个槽位（不污染全局）', Object.keys(p.win));

  const r2 = runExpr(p.win, p.doc);
  ok(r2.installed === true && p.api.calls === 1, 'C13 【幂等】重复运行不重复注册监听器', p.api.calls);

  p.api.sinks[0]({ type: 'taskUpdate', update: { error: { code: '6004' } } });
  const r3 = runExpr(p.win, p.doc);
  ok(r3.seq === 1 && r3.eventCount === 1, 'C14 收到事件后 seq/eventCount 递增', [r3.seq, r3.eventCount]);
  ok(r3.last && r3.last.code === '6004', 'C15 最近一条信号可回读', r3.last);
  ok(r3.last.ts > 0, 'C16 信号带时间戳（daemon 可判新鲜度）');

  p.api.sinks[0]({ type: 'taskUpdate', update: { message: 'nothing to see' } });
  const r4 = runExpr(p.win, p.doc);
  ok(r4.eventCount === 1, 'C17 无信号事件不入环（不刷屏）', r4.eventCount);

  let threw = false;
  try { p.api.sinks[0](); p.api.sinks[0](null, undefined, 'x'); } catch (e) { threw = true; }
  ok(!threw, 'C18 【关键】sink 内部异常永不外抛（否则会打断宿主的事件分发）');

  p.api.sinks[0]({ stopReason: 'rate_limit' }, { httpStatus: 429 });
  const r5 = runExpr(p.win, p.doc);
  ok(r5.last && r5.last.httpStatus === 429, 'C19 多参数时取权重最高的那条', r5.last);

  for (let i = 0; i < 30; i += 1) p.api.sinks[0]({ code: String(6000 + (i % 4)) });
  const r6 = runExpr(p.win, p.doc);
  ok(r6.eventCount <= SE.RING_MAX, 'C20 环形缓冲有上限（' + SE.RING_MAX + '）', r6.eventCount);
  ok(p.api.calls === 1, 'C21 全程只注册一次监听器', p.api.calls);
}
{
  const p = makePage(false);
  const r = runExpr(p.win, p.doc);
  ok(r && r.ok === false && r.reason === 'no-api', 'C22 页面取不到 api ⇒ ok:false（调用方静默退回横幅）', r);
  ok(Object.keys(p.win).length === 0, 'C23 取不到 api 时不写 window');
}
{
  // adapter 重建（切号后 reload / 新对象）⇒ 槽位里记的 api 不同，必须重装
  const p = makePage(true);
  runExpr(p.win, p.doc);
  p.api.sinks.length = 0;
  const host2 = {
    daemonClient: { cloudAgentDeleteConversation() {} },
    client: { provider: { api: { calls: 0, sinks: [], onSessionEvent(cb) { this.calls += 1; this.sinks.push(cb); } } } },
  };
  const fiber2 = { memoizedProps: { adapter: host2 }, return: null };
  const doc2 = { querySelectorAll: () => [{ __reactFiber$1: fiber2 }] };
  const r = runExpr(p.win, doc2);
  ok(r.ok === true && r.installed === true && host2.client.provider.api.calls === 1,
    'C24 【抗重建】换了 adapter ⇒ 槽位认新 api 并重装监听', [r.installed, host2.client.provider.api.calls]);
}

/* ==================================================================== */
console.log('\n== D. A3：模型级冷却参与选号 ==');

function healthWith(observation, uid) {
  const cls = AH.classifyObservation(Object.assign({ now: T0 }, observation));
  return { state: AH.applyObservation(AH.normalizeHealth(null), uid, cls, T0), cls: cls };
}
{
  const h = healthWith({ source: 'structured-acp', bizCode: '6004', modelId: 'm1' }, 'u1').state;
  const entry = AH.normalizeHealth(h).accounts.u1;
  ok(entry && entry.models && entry.models.m1 && entry.models.m1.until > T0,
    'D1 6004 观测真写进 entry.models[modelId]（A3 的记录层本来就有的）', entry && entry.models);

  ok(AH.isUsableForFailover(h, 'u1', T0 + 1, 'm1').usable === false,
    'D2 【A3 核心】传了 modelId 且该模型冷却中 ⇒ 不可用', AH.isUsableForFailover(h, 'u1', T0 + 1, 'm1'));
  ok(String(AH.isUsableForFailover(h, 'u1', T0 + 1, 'm1').reason).indexOf('model-cooling') === 0,
    'D3 原因带 model-cooling 前缀（诊断要分清是号坏还是模型额度）', AH.isUsableForFailover(h, 'u1', T0 + 1, 'm1').reason);
  ok(AH.isUsableForFailover(h, 'u1', T0 + 1, 'm2').usable === true,
    'D4 只排除那一个模型：换别的模型这个号仍可用（不切整号）');
  ok(AH.isUsableForFailover(h, 'u1', T0 + 1).usable === true,
    'D5 【硬约束】不传 modelId ⇒ 与加 A3 之前逐字等价（model_blocked 冷却不影响账号级）');
  ok(AH.isUsableForFailover(h, 'u1', T0 + 1, '').usable === true, 'D6 传空串等价于不传');
  ok(AH.isUsableForFailover(h, 'u1', T0 + 1, '   ').usable === true, 'D7 传空白串等价于不传');
  ok(AH.isUsableForFailover(h, 'u1', entry.models.m1.until + 1, 'm1').usable === true,
    'D8 模型冷却到期后恢复可用');
  ok(AH.isUsableForFailover(h, 'u999', T0, 'm1').usable === true, 'D9 未知账号 ⇒ 可用（与老行为一致）');
}
{
  const h = healthWith({ source: 'structured-acp', httpStatus: 401 }, 'u2').state;
  const v = AH.isUsableForFailover(h, 'u2', T0 + 1, 'm1');
  ok(v.usable === false && v.reason === 'needs_reauth',
    'D10 账号级 needs_reauth 优先 —— 不被模型级理由覆盖', v);
  const h2 = healthWith({ source: 'x', httpStatus: 402 }, 'u3').state;
  const v2 = AH.isUsableForFailover(h2, 'u3', T0 + 1, 'm1');
  ok(v2.usable === false && v2.reason === 'quota_hard', 'D11 账号级 quota_hard 同样优先', v2);
}
{
  ok(AH.isUsableForFailover.length === 4, 'D12 谓词声明 4 个形参（第 4 个是 modelId）', AH.isUsableForFailover.length);
  const h = healthWith({ source: 'structured-acp', bizCode: '6004', modelId: 'm1' }, 'u4').state;
  ok(AH.isUsableForFailover(h, 'u4', T0 + 1, 'm9').usable === true, 'D13 modelId 未命中 models 表 ⇒ 可用（不误杀）');
  const empty = AH.normalizeHealth(null);
  ok(AH.isUsableForFailover(empty, 'u5', T0, 'm1').usable === true, 'D14 空健康表 ⇒ 可用');
}

/* ==================================================================== */
console.log('\n== E. 选号接线（limit-failover）与 daemon 静态守卫 ==');

{
  const seen = [];
  LF.pickFailoverTarget([{ uid: 'a' }, { uid: 'b' }], 'a', null, T0, {
    health: (acc, now, modelId) => { seen.push([acc.uid, now, modelId]); return true; },
    modelId: 'm7',
  });
  ok(seen.length === 1 && seen[0][2] === 'm7', 'E1 pickFailoverTarget 把 options.modelId 传给 health 谓词', seen);
  const seen2 = [];
  LF.pickFailoverTarget([{ uid: 'a' }, { uid: 'b' }], 'a', null, T0, {
    health: (acc, now, modelId) => { seen2.push(modelId); return true; },
  });
  ok(seen2.length === 1 && seen2[0] === undefined, 'E2 不传 modelId ⇒ 谓词收到 undefined（老谓词行为不变）', seen2);
  const picked = LF.pickFailoverTarget([{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }], 'a', null, T0, {
    health: (acc, now, modelId) => !(acc.uid === 'b' && modelId === 'm7'),
    modelId: 'm7',
  });
  ok(picked.account && picked.account.uid === 'c', 'E3 模型级排除只影响命中项，仍能在池里选到别的账号', picked.reason);
  const thrown = LF.pickFailoverTarget([{ uid: 'a' }, { uid: 'b' }], 'a', null, T0, {
    health: () => { throw new Error('boom'); }, modelId: 'm7',
  });
  ok(thrown.account && thrown.account.uid === 'b', 'E4 谓词抛错 ⇒ 不排除（沿用老 catch 语义，不因新参数改变）');
  const excluded = LF.pickFailoverTarget([{ uid: 'a' }, { uid: 'b' }], 'a', null, T0, {
    health: () => false, modelId: 'm7',
  });
  ok(excluded.account === null && excluded.reason === 'all-unhealthy', 'E5 全被排除 ⇒ all-unhealthy（老语义不变）', excluded.reason);
}
{
  const expect = (cond, label) => ok(cond, label);
  expect(DAEMON_SRC.indexOf('readStructuredError: readStructuredError,') >= 0,
    'E6 daemon ports 注入了 readStructuredError');
  expect(DAEMON_SRC.indexOf('healthObservation: (payload) => structuredError.observationFrom(') >= 0,
    'E7 daemon ports 注入了 healthObservation（合并判据只有一份）');
  expect(DAEMON_SRC.indexOf('function readStructuredError() {') >= 0
    && DAEMON_SRC.indexOf('structuredError.structuredErrorProbeExpression()') >= 0,
    'E8 readStructuredError 走结构化探针表达式');
  expect(DAEMON_SRC.indexOf("require('./structured-error.js')") >= 0, 'E9 daemon require 了 structured-error');
  expect(DAEMON_SRC.indexOf("healthOptions = typeof ports.healthFilter === 'function' ? { health: ports.healthFilter, modelId: modelId } : {}") >= 0,
    'E10 healthOptions 带上了 modelId（A3 进入选号链的入口）');
  expect(DAEMON_SRC.indexOf('return (account, now, modelId) => {') >= 0,
    'E11 备选池谓词声明三参');
  expect(DAEMON_SRC.indexOf('if (!accountHealth.isUsableView(view).usable) return false;') >= 0,
    'E12 账号级判决仍来自 badges（含 mergeLiveHealth 的档案信号）—— 来源没被换掉');
  expect(DAEMON_SRC.indexOf("source: 'dom-banner',") >= 0 && DAEMON_SRC.indexOf('const structured = typeof ports.readStructuredError') >= 0,
    'E13 dom-banner 兜底分支仍在（端口缺省时逐字回到老观测）');
}
{
  // 切片提取：runLimitFailoverCore 必须**不**引用任何新的模块级标识符
  const anchor = 'async function runLimitFailoverCore(detail, ports) {';
  const start = DAEMON_SRC.indexOf(anchor);
  let core = '';
  if (start >= 0) {
    let depth = 0;
    for (let i = DAEMON_SRC.indexOf('{', start); i < DAEMON_SRC.length; i += 1) {
      if (DAEMON_SRC[i] === '{') depth += 1;
      else if (DAEMON_SRC[i] === '}') { depth -= 1; if (depth === 0) { core = DAEMON_SRC.slice(start, i + 1); break; } }
    }
  }
  ok(core.length > 0, 'E14 能切出 runLimitFailoverCore（锚点未失效）');
  ok(core.indexOf('structuredError.') < 0 && core.indexOf('accountHealth.') < 0,
    'E15 【反向守卫】切片内不引用 structuredError / accountHealth 模块级标识符 —— '
    + '切片沙箱没注入它们，引用即 ReferenceError，被外层 try/catch 吞成静默业务失败');
  ok(core.indexOf('typeof ports.readStructuredError') >= 0 && core.indexOf('typeof ports.healthObservation') >= 0,
    'E16 两个新端口在切片内都是 typeof 守卫（沙箱不注入即整段退回兜底）');
  ok(core.indexOf('ports.healthObservation({ hits: hits, modelId: modelId, structured: structured })') >= 0,
    'E17 合并经 ports 注入，切片内不出现合并判据');
  ok(core.indexOf("source: 'dom-banner',") >= 0, 'E18 切片内保留原地兜底对象（老沙箱测试照旧通过）');
}

/* ==================================================================== */
console.log('\n== F. 打包与纪律 ==');

{
  const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'build-mac-dmg.sh'), 'utf8');
  ok(sh.indexOf('account-health.js structured-error.js') >= 0, 'F1 mac 打包复制白名单含 structured-error.js');
  ok(sh.indexOf('"$APP/Contents/Resources/scripts/structured-error.js" \\') >= 0, 'F2 mac 打包 chmod 列表含 structured-error.js');
}
{
  const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'structured-error.js')).toString('latin1');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length;
  ok(crlf === lf && crlf > 0, 'F3 scripts/structured-error.js 全 CRLF（scripts/*.js 纪律）', [crlf, lf]);
  ok(fs.readFileSync(path.join(ROOT, 'scripts', 'structured-error.js'), 'utf8').indexOf('SESSION_EVENT_CHANNEL') >= 0,
    'F4 频道常量 ' + SE.SESSION_EVENT_CHANNEL + ' 落在模块里（单一来源）');
  ok(SE.SESSION_EVENT_CHANNEL === 'session:event', 'F5 频道名与 asar SESSION_RPC_CHANNELS.EVENT 一致', SE.SESSION_EVENT_CHANNEL);
  ok(SE.RING_MAX === 20 && SE.RENDERER_SLOT === '__wbsStructuredError', 'F6 槽位与环长常量稳定');
}

/* ==================================================================== */
console.log('\n==== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 ====');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
