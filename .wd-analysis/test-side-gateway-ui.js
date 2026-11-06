/**
 * 侧车网关 · 面板插件的真实 DOM 测试（需要无头 Edge，跑约 20s）。
 *
 * ⚠️ 不进 run-regression-all 默认列表（依赖浏览器、慢）。改 side-gateway-ui.js 后手动跑：
 *     node .wd-analysis/test-side-gateway-ui.js
 *
 * 做法：起一个本地 mock 服务（模拟 daemon 的 /api/side-gateway/*）+ 一份与 inject.js 同构的
 * 面板骨架（.wbs-panel > .wbs-tabs + .wbs-body），把插件原样内联进去，用无头 Edge + CDP 断言。
 * mock 数据是内置 fixture，不依赖网关进程是否在跑。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UI_PATH = path.join(ROOT, 'scripts', 'side-gateway-ui.js');
const LAB = path.join(ROOT, '.wd-tmp', 'wsg-lab-run');
const PORT = 7911;
const CDP = 9333;

// ── 内置 fixture（结构照抄真实响应，数值无所谓） ──
const FIXTURE = {
  status: {
    ok: true,
    gateways: [{ id: 'unified', installed: true, running: true, ownsProcess: true, pid: 4242, port: 7866, autostart: true, root: 'C:\\lab\\unified', startedAt: Date.now() - 60000 }],
    health: {
      status: 'ok',
      providers: {
        raccoon: { pool: 50, alive: 41, cooling: 9, dead: 9 },
        loomy: { pool: 100, alive: 55, cooling: 0, dead: 0, funded: 55, points_total: 797239 },
      },
      total: 150, alive: 96, models: 15, index_age_s: 42,
    },
    healthError: null,
  },
  detail: {
    ok: true,
    detail: {
      providers: {
        raccoon: {
          name: '小浣熊 xiaohuanxiong', pool: 50, alive: 41, cooling: 9, dead: 9,
          accounts: [
            { uid: 'pu-01a1365c-aa', state: 'alive', pts: 0, inflight: 0, fails: 0, lastErr: '' },
            { uid: 'pu-01a18e2a-bb', state: 'cooling', pts: 0, inflight: 1, fails: 2, lastErr: '401 authorization_verify_error', coolLeftS: 21600 },
            { uid: 'pu-01a1999c-cc', state: 'dead', pts: 0, inflight: 0, fails: 5, lastErr: 'dead' },
          ],
        },
        loomy: {
          name: '讯飞星火 Loomy', pool: 100, alive: 55, cooling: 0, dead: 0, funded: 55, points_total: 797239,
          accounts: [
            { uid: 'loomy-10001', state: 'alive', pts: 21493, inflight: 0, fails: 0, lastErr: '' },
            { uid: 'loomy-10002', state: 'alive', pts: 5000, inflight: 0, fails: 0, lastErr: '' },
          ],
        },
      },
      conflicts: [],
    },
  },
  models: {
    ok: true,
    models: [
      { id: 'spark-x2.6', provider: 'loomy', context_length: 1000000, max_output_tokens: 131072 },
      { id: 'GLM-5.3-Flash', provider: 'loomy', context_length: 200000, max_output_tokens: 65536 },
      { id: 'DeepSeek-V4.1-Flash', provider: 'loomy', context_length: 1000000, max_output_tokens: 384000 },
      { id: 'sn-deepseek-v4-1-flash-1017', provider: 'raccoon', context_length: 1000000, max_output_tokens: 65536 },
      { id: 'sn-glm-5-3-flash', provider: 'raccoon', context_length: 200000, max_output_tokens: 65536 },
    ],
  },
  cred: { ok: true, baseUrl: 'http://127.0.0.1:7866/v1', apiKey: 'uni-0123456789abcdef0123456789abcdef01234567', extraKeys: 2, autoRetry: true },
  log: { ok: true, text: '[chat] raccoon/sn-glm-5-3-flash 1200ms ok\n[chat] loomy/spark-x2.6 900ms ok\n[cool] loomy-10009 1800s insufficient_points', file: 'C:\\lab\\unified\\gateway.log' },
};

const SKELETON = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>panel lab</title>
<style>
body{margin:0;font-family:system-ui;background:#fff}
.wbs-panel{width:560px;height:640px;display:flex;flex-direction:column;border:1px solid #ddd}
.wbs-tabs{display:flex;gap:6px;padding:10px 14px 0;overflow-x:auto}
.wbs-tab{border:0;background:transparent;padding:6px 10px;font-size:12px;cursor:pointer;opacity:.6;display:inline-flex;align-items:center;gap:4px}
.wbs-tab.active{opacity:1;font-weight:700;border-bottom:2px solid #3b82f6}
.wbs-body{flex:1;overflow:auto;padding:8px 12px}
.wbs-pane{display:none}
.wbs-pane.active{display:block}
</style></head><body>
<div class="wbs-panel">
  <div class="wbs-tabs">
    <button class="wbs-tab active" type="button" data-tab="account"><span>账号</span></button>
    <button class="wbs-tab" type="button" data-tab="theme"><span>主题</span></button>
    <button class="wbs-tab" type="button" data-tab="sessions"><span>会话</span></button>
    <button class="wbs-tab" type="button" data-tab="spaces"><span>空间</span></button>
    <button class="wbs-tab" type="button" data-tab="models"><span>模型</span></button>
    <button class="wbs-tab" type="button" data-tab="enhance"><span>增强</span></button>
    <button class="wbs-tab" type="button" data-tab="automations"><span>自动化</span></button>
    <button class="wbs-tab" type="button" data-tab="pc"><span>电脑</span></button>
    <button class="wbs-tab" type="button" data-tab="about"><span>关于</span></button>
  </div>
  <div class="wbs-body">
    <div class="wbs-pane active" data-pane="account"></div>
    <div class="wbs-pane" data-pane="theme"></div>
    <div class="wbs-pane" data-pane="sessions"></div>
    <div class="wbs-pane" data-pane="spaces"></div>
    <div class="wbs-pane" data-pane="models"></div>
    <div class="wbs-pane" data-pane="enhance"></div>
    <div class="wbs-pane" data-pane="automations"></div>
    <div class="wbs-pane" data-pane="pc"></div>
    <div class="wbs-pane" data-pane="about"></div>
  </div>
</div>
<script>window.__LAB_ERRORS__=[];window.addEventListener('error',function(e){window.__LAB_ERRORS__.push(String(e.message||e))});
window.addEventListener('unhandledrejection',function(e){window.__LAB_ERRORS__.push('rejection: '+String(e.reason))});</script>
<script>
// 模拟 inject.js 的真实行为：**初始化时**给当时存在的 tab 绑 switchTab，
// 遍历所有 .wbs-tab / .wbs-pane 按名字 toggle active（后来插入的 tab 因此没有点击监听）。
function switchTab(name){
  var tabs=document.querySelectorAll('.wbs-tab');
  for(var i=0;i<tabs.length;i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab')===name);
  var panes=document.querySelectorAll('.wbs-pane');
  for(var j=0;j<panes.length;j++) panes[j].classList.toggle('active', panes[j].getAttribute('data-pane')===name);
}
Array.prototype.forEach.call(document.querySelectorAll('.wbs-tab'), function(b){
  b.addEventListener('click', function(){ switchTab(b.getAttribute('data-tab')); });
});
window.__LAB_switchTab = switchTab;
</script>
<script>__UI__</script>
</body></html>`;

function buildHtml() {
  let ui = fs.readFileSync(UI_PATH, 'utf8');
  ui = ui.replace(/__WBS_API__/g, 'http://127.0.0.1:' + PORT).replace(/__WBS_API_TOKEN__/g, 'lab-token');
  return SKELETON.replace('__UI__', () => ui);
}

const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(buildHtml());
  }
  const m = /^\/api\/side-gateway\/(\w+)/.exec(u);
  if (m) {
    const key = m[1];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    if (req.method === 'POST') return res.end(JSON.stringify({ ok: true, result: {} }));
    if (FIXTURE[key]) return res.end(JSON.stringify(FIXTURE[key]));
    return res.end('{"ok":false,"error":"nope"}');
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"ok":false,"error":"404"}');
});

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const PROFILE = path.join(LAB, 'edge-profile');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function cdpSend(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++cdpSend.seq;
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => reject(new Error('cdp timeout ' + method)), 25000);
  });
}
cdpSend.seq = 0;

async function evalJs(ws, expr) {
  const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 25000 });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 260))); }
}

(async () => {
  const edgePath = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edgePath) { console.log('跳过：没找到 msedge.exe'); process.exit(0); }
  try { fs.mkdirSync(LAB, { recursive: true }); } catch (_) {}

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('mock 服务 :' + PORT);

  async function probeCdp() {
    try { return await (await fetch('http://[::1]:' + CDP + '/json')).json(); } catch (_) { return null; }
  }
  let list = await probeCdp();
  if (!list) {
    console.log('启动无头 Edge…');
    spawn(edgePath, [
      '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--remote-allow-origins=*',
      '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 30; i++) { await sleep(500); list = await probeCdp(); if (list) break; }
  }
  if (!list) throw new Error('连不上无头 Edge 的 CDP（' + CDP + '）');

  let target = list.find((t) => t.type === 'page');
  if (!target) target = await (await fetch('http://[::1]:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await cdpSend(ws, 'Runtime.enable');
  await cdpSend(ws, 'Page.enable');
  await cdpSend(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(2600);

  console.log('\n== 注入 ==');
  ok(await evalJs(ws, '!!window.__wsgUi'), '插件执行（window.__wsgUi）');
  ok(await evalJs(ws, '!!document.querySelector(\'.wbs-tab[data-tab="sideapi"]\')'), '标签按钮已插入');
  ok(await evalJs(ws, '!!document.querySelector(\'.wbs-pane[data-pane="sideapi"]\')'), 'pane 已插入');
  const tabs = await evalJs(ws, 'JSON.stringify(Array.from(document.querySelectorAll(".wbs-tab")).map(b=>b.getAttribute("data-tab")))');
  ok(/enhance.*automations.*sideapi.*pc/.test(tabs), '位置在 automations 与 pc 之间', tabs);
  const label = await evalJs(ws, '(document.querySelector(\'.wbs-tab[data-tab="sideapi"]\')||{}).textContent');
  ok(/网关|Gateway/.test(label || ''), '按钮文案「网关」', label);
  ok(await evalJs(ws, '!!document.getElementById("wsg-style")') === true, '样式已注入');

  console.log('\n== 切换 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-tab[data-tab="sideapi"]\').click()');
  await sleep(1300);
  const cr = JSON.parse(await evalJs(ws, `JSON.stringify({
    mine: document.querySelector('.wbs-tab[data-tab="sideapi"]').classList.contains('active'),
    pane: document.querySelector('.wbs-pane[data-pane="sideapi"]').classList.contains('active'),
    other: document.querySelector('.wbs-tab[data-tab="account"]').classList.contains('active')
  })`));
  ok(cr.mine && cr.pane, '自己的 tab/pane 变 active');
  ok(cr.other === false, '官方页失焦');

  console.log('\n== 账号池视图 ==');
  const t1 = await evalJs(ws, '(document.querySelector(\'.wbs-pane[data-pane="sideapi"]\')||{}).textContent || ""');
  ok(/统一网关/.test(t1), '标题');
  ok(/150/.test(t1) && /96/.test(t1), '池 150 / 可用 96');
  ok(/小浣熊/.test(t1) && /Loomy/.test(t1), '两个上游分组');
  ok(/立即探活/.test(t1), '探活按钮');
  ok(await evalJs(ws, 'document.querySelectorAll(\'.wbs-pane[data-pane="sideapi"] .wsg-stat\').length') === 4, '四个数字卡');

  console.log('\n== 明细展开 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-pane[data-pane="sideapi"] [data-wsg-expand="raccoon"]\').click()');
  await sleep(600);
  const t2 = await evalJs(ws, 'document.querySelectorAll(\'.wbs-pane[data-pane="sideapi"] .wsg-table tbody tr\').length');
  ok(t2 >= 3, '明细表出现账号行', t2);

  console.log('\n== 模型视图 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-pane[data-pane="sideapi"] [data-wsg-tab="models"]\').click()');
  await sleep(500);
  const t3 = await evalJs(ws, '(document.querySelector(\'.wbs-pane[data-pane="sideapi"]\')||{}).textContent || ""');
  ok(/spark-x2\.6/.test(t3) && /sn-deepseek-v4-1-flash-1017/.test(t3), '模型表有内容');
  ok(/reasoning|思考/.test(t3), '有 reasoning 提示');

  console.log('\n== 接入视图 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-pane[data-pane="sideapi"] [data-wsg-tab="access"]\').click()');
  await sleep(600);
  const t4 = await evalJs(ws, '(document.querySelector(\'.wbs-pane[data-pane="sideapi"]\')||{}).textContent || ""');
  ok(/127\.0\.0\.1:7866\/v1/.test(t4), 'base_url');
  ok(/models\.json/.test(t4), 'models.json 片段');
  ok(/••••/.test(t4), 'api_key 默认打码');

  console.log('\n== 日志视图 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-pane[data-pane="sideapi"] [data-wsg-tab="log"]\').click()');
  await sleep(900);
  const t5 = await evalJs(ws, '(document.querySelector(\'.wbs-pane[data-pane="sideapi"]\')||{}).textContent || ""');
  ok(t5.length > 40, '日志有内容', t5.length);

  console.log('\n== 与官方 tab 共存 ==');
  await evalJs(ws, 'document.querySelector(\'.wbs-tab[data-tab="models"]\').click()');
  await sleep(400);
  const bk = JSON.parse(await evalJs(ws, `JSON.stringify({
    mine: document.querySelector('.wbs-tab[data-tab="sideapi"]').classList.contains('active'),
    pane: document.querySelector('.wbs-pane[data-pane="sideapi"]').classList.contains('active'),
    count: document.querySelectorAll('.wbs-tab').length
  })`));
  ok(bk.mine === false && bk.pane === false, '点官方 tab 后自己失焦');
  ok(bk.count === 10, '共 10 个 tab（9 官方 + 1 插件）', bk.count);

  console.log('\n== 幂等 / 热更 ==');
  await evalJs(ws, 'for(var i=0;i<3;i++){try{window.__wsg.mount()}catch(e){}}');
  await sleep(300);
  const dp = JSON.parse(await evalJs(ws, `JSON.stringify({
    tabs: document.querySelectorAll('.wbs-tab[data-tab="sideapi"]').length,
    panes: document.querySelectorAll('.wbs-pane[data-pane="sideapi"]').length
  })`));
  ok(dp.tabs === 1 && dp.panes === 1, '重复 mount 不重复插', dp);
  // teardown → 再 mount 应能干净重建（模拟 daemon 重新注入）
  await evalJs(ws, 'window.__wsg.teardown()');
  await sleep(300);
  const td = JSON.parse(await evalJs(ws, `JSON.stringify({
    tabs: document.querySelectorAll('.wbs-tab[data-tab="sideapi"]').length,
    panes: document.querySelectorAll('.wbs-pane[data-pane="sideapi"]').length,
    style: !!document.getElementById('wsg-style')
  })`));
  ok(td.tabs === 0 && td.panes === 0 && td.style === false, 'teardown 清干净', td);
  await evalJs(ws, 'window.__wsg.mount()');
  await sleep(900);
  const re = await evalJs(ws, 'document.querySelectorAll(\'.wbs-tab[data-tab="sideapi"]\').length');
  ok(re === 1, 'teardown 后可重新挂载', re);

  console.log('\n== 异常 ==');
  const errs = await evalJs(ws, 'JSON.stringify(window.__LAB_ERRORS__)');
  ok(errs === '[]', '无 JS 异常', errs);

  ws.close();
  await sleep(300);
  server.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FATAL ' + (e && e.message));
  try { server.close(); } catch (_) {}
  process.exit(2);
});
