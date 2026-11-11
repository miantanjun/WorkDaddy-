'use strict';
/**
 * 真机验证 v2 —— 只读探针。
 * v1 的错误：想从 <script> 标签拿注入源码，但 inject.js 是「执行代码」不是「脚本标签」。
 * v2 改从真正的证据面取证：
 *   1) #wbs-style 注入样式表的文本（批次 D 的 CSS 就在这里）
 *   2) window.__wbsBuilds[0] 的实例字段（含版本/代际）
 *   3) 真实 DOM 结构（若面板开着）
 *
 * ⚠️ 取面板版本号**必须按 #id 精确取**，不能对 .wbs-root 整棵文本跑
 *    /v(\d+\.\d+\.\d+)/ —— 那样第一个命中的往往是记忆库里的无关键（实测曾把一条
 *    「Blender 插件 v3.0.6」的事实文本报成面板版本，属探针匹配面过宽，非面板缺陷）。
 */
const http = require('http');
const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: CDP_HOST, port: CDP_PORT, path, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON 解析失败: ' + e.message)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('CDP 连接超时')); });
    req.on('error', reject);
  });
}

let SEQ = 0;
function evaluate(ws, expression) {
  const id = ++SEQ;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('evaluate 超时')), 15000);
    const onMessage = (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch (_) { return; }
      if (!msg || msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) return reject(new Error('CDP error: ' + JSON.stringify(msg.error)));
      const r = msg.result || {};
      if (r.exceptionDetails) {
        return reject(new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)));
      }
      resolve(r.result ? r.result.value : undefined);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: false } }));
  });
}

const PROBES = [
  ['注入器代际', 'window.__wbsGeneration 存在（注入器本次执行过）', `String(window.__wbsGeneration || '')`],
  ['build 实例数', 'window.__wbsBuilds.length', `(window.__wbsBuilds || []).length`],
  ['build 字段', 'build 实例的键名', `(() => { const b = (window.__wbsBuilds || [])[0]; return b ? Object.keys(b).slice(0, 40) : null; })()`],
  ['build 版本', 'build.version / WBS_VERSION 真值', `(() => { const b = (window.__wbsBuilds || [])[0]; if (!b) return null; const out = {}; for (const k of Object.keys(b)) { const v = b[k]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v; } return out; })()`],
  ['插件面板版本号', '面板头部 #wbs-about-ver / #wbs-self-ver', `(() => { const g = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim() : null; }; return { about: g('#wbs-about-ver'), self: g('#wbs-self-ver'), upstream: g('#wbs-upstream-ver') }; })()`],
  ['#wbs-style 存在', '注入样式表节点', `!!document.querySelector('#wbs-style')`],
  ['#wbs-style 体积', '样式文本字节数', `(() => { const el = document.querySelector('#wbs-style'); return el ? (el.textContent || '').length : -1; })()`],
  ['批次D-CSS 拖动手柄', '.wbs-qp-drag 在 #wbs-style 内', `(() => { const el = document.querySelector('#wbs-style'); return el ? (el.textContent || '').indexOf('.wbs-qp-drag') >= 0 : false; })()`],
  ['批次D-CSS 拖动中态', '.wbs-qp-dragging 在 #wbs-style 内', `(() => { const el = document.querySelector('#wbs-style'); return el ? (el.textContent || '').indexOf('wbs-qp-dragging') >= 0 : false; })()`],
  ['批次D-CSS 仅插入', '.wbs-explore-ins 在 #wbs-style 内', `(() => { const el = document.querySelector('#wbs-style'); return el ? (el.textContent || '').indexOf('.wbs-explore-ins') >= 0 : false; })()`],
  ['批次D-CSS 忙态', 'aria-busy 在 #wbs-style 内', `(() => { const el = document.querySelector('#wbs-style'); return el ? (el.textContent || '').indexOf('aria-busy') >= 0 : false; })()`],
  ['导航项', '插件导航 tab 列表', `(() => { return Array.from(document.querySelectorAll('.wbs-root [data-tab], .wbs-root .wbs-tab')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 20); })()`],
];

(async () => {
  const list = await getJson('/json/list');
  const page = (list || []).find((t) => t.type === 'page' && /WorkBuddy/i.test(t.title || '')) || (list || [])[0];
  if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到可调试页面目标');
  console.log('目标页面: ' + page.title + '  (' + page.id + ')\n');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });

  let pass = 0; let fail = 0;
  for (const [label, expect, expr] of PROBES) {
    let value;
    try { value = await evaluate(ws, expr); }
    catch (e) { value = 'ERR: ' + e.message; }
    const shown = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
    const bad = typeof value === 'string' && value.indexOf('ERR:') === 0;
    if (bad) fail++; else pass++;
    console.log((bad ? '[FAIL] ' : '[info] ') + label.padEnd(20, ' ') + ' = ' + shown + '   // ' + expect);
  }

  console.log('\n(info 为观测项，非断言；FAIL = 探针本身出错)');
  console.log('=== ' + pass + ' 项已观测 / ' + fail + ' 项探针错误 ===');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('探针失败: ' + e.message); process.exit(2); });
