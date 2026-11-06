/**
 * 侧车统一网关 —— 可整体剥离的插件模块（后端）
 *
 * 它管的是**跟我们自己账号无关的第三方试用号**（小浣熊 xiaohuanxiong + 讯飞 Loomy），
 * 在 <dataDir>/unified 下跑一个独立 OpenAI 兼容反代（默认 7866），与 wb2api 主网关（7863）
 * 零耦合：独立目录 / 端口 / api_key / 账号目录，不读写 gateway\ 也不碰 auths\。
 *
 * ── 为什么要做成「可剥离」 ────────────────────────────────────────────────
 * 这批号是外部给的试用号，随时可能被收走或失效。所以本模块的约束是：
 *   · daemon.js 里只有 5 处挂载点、共 11 行（全部带 sideGateway 前缀，grep 一遍就能逐行删）
 *   · 前端同号挂在 side-gateway-ui.js，inject.js **一行都不改**（纯外挂标签页）
 *   · 数据全在 <dataDir>/unified，删目录即彻底消失
 * 剥离步骤：
 *   1. 删 scripts/side-gateway.js + scripts/side-gateway-ui.js
 *   2. daemon.js 里 grep sideGateway，把这 11 行删掉
 *   3. 删 <dataDir>/unified 整个目录
 *   4. 面板的「网关」标签页随之消失（它由 UI 脚本自插，没有静态残留）
 *
 * ── 生命周期 ──────────────────────────────────────────────────────────────
 * 随 daemon 启动 → 退出后退避重拉（2s→4s→…→60s）→ daemon 收摊时一起收。
 * ⚠️ daemon 重启会丢子进程句柄，但端口上还有监听 ⇒ 先按端口反查，别重复 spawn
 *    （重复 spawn 会 EADDRINUSE 立刻退出，日志里刷一堆「启动失败」）。
 * ⚠️ 60s 看门狗只补一种漏：「已布署 + 应自启 + 端口无人监听」。
 *    因为 daemon 重启后抓到的是外部实例，拿不到子进程句柄，它真死了 exit 事件不会响。
 * ⚠️ 旧的 xhx\ 与 loomy\ 目录只作为账号仓库存在，**不要再单独起它们的 server.js**，
 *    否则两个进程各持同一批账号的冷却状态，会互相踩。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
/** 要托管的侧车网关 id（各自对应 <dataDir>/<id>/ 目录）。多实例时往这里加。 */
const IDS = ['unified'];
const RESTART_CAP_MS = 60000;
/** 管理面默认超时：探活要跑全池，给足 10 分钟。 */
const PROBE_TIMEOUT_MS = 600000;

const state = {};
let logger = null;

/** daemon 启动时注入自己的 log，让侧车日志混进主日志（不注入就静默）。 */
function configure(options) {
  if (options && typeof options.log === 'function') logger = options.log;
}

function log(msg) {
  if (!logger) return;
  try { logger('[sgw] ' + msg); } catch (_) {}
}

/** 数据根：优先沿用 daemon 的 lib（同进程 require 缓存命中，零额外开销）。 */
let cachedRoot = '';
function dataRoot() {
  if (cachedRoot) return cachedRoot;
  try {
    const v = require('./lib').defaultDataDir();
    if (v) { cachedRoot = v; return cachedRoot; }
  } catch (_) { /* lib 不可用 ⇒ 走下面的平台惯例兜底 */ }
  if (process.env.WBSWITCH_DATA_DIR) { cachedRoot = process.env.WBSWITCH_DATA_DIR; return cachedRoot; }
  if (IS_WIN) cachedRoot = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WorkDaddy');
  else if (process.platform === 'darwin') cachedRoot = path.join(os.homedir(), 'Library', 'Application Support', 'WorkDaddy');
  else cachedRoot = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'WorkDaddy');
  return cachedRoot;
}

function paths(id) {
  const root = path.join(dataRoot(), id);
  return {
    root: root,
    server: path.join(root, 'server.js'),
    config: path.join(root, 'config.json'),
    log: path.join(root, 'gateway.log'),
  };
}

function readConfig(id) {
  try { return JSON.parse(fs.readFileSync(paths(id).config, 'utf8')); } catch (_) { return null; }
}

/** 只改白名单字段写回，绝不整份覆盖（避免把用户在别处改的 provider 配置冲掉）。 */
function patchConfig(id, patch) {
  const cfg = readConfig(id);
  if (!cfg) return null;
  for (const k of Object.keys(patch)) {
    if (k === 'autostart') cfg.autostart = patch[k] !== false;
  }
  try {
    fs.writeFileSync(paths(id).config, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  } catch (e) {
    log('写 config 失败: ' + String((e && e.message) || e));
    return null;
  }
}

function port(id) { const c = readConfig(id); return Number(c && c.port) || 0; }
function apiKey(id) { const c = readConfig(id); return String((c && c.api_key) || ''); }
function installed(id) { const p = paths(id); return fs.existsSync(p.server) && fs.existsSync(p.config); }
function autostart(id) { const c = readConfig(id); return !(c && c.autostart === false); }

/** 按端口反查监听进程（Windows 用 netstat，*nix 用 lsof）。 */
function pidByPort(p) {
  const n = Number(p) || 0;
  if (!n) return 0;
  try {
    if (IS_WIN) {
      const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
      const m = new RegExp(':' + n + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'i').exec(String((r && r.stdout) || ''));
      return m ? Number(m[1]) : 0;
    }
    const r = spawnSync('lsof', ['-ti', 'tcp:' + n, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 6000 });
    const pid = parseInt(String((r && r.stdout) || '').trim(), 10);
    return Number.isFinite(pid) ? pid : 0;
  } catch (_) { return 0; }
}

/** 找受管 node（Electron 自带的那份不能直接当 node 用，要配 ELECTRON_RUN_AS_NODE）。 */
function findNodeExe() {
  const base = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  let best = null;
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, IS_WIN ? 'node.exe' : 'bin/node');
      if (fs.existsSync(p) && (!best || d > best.d)) best = { d, p };
    }
  } catch (_) { /* 没有受管 node ⇒ 回退自身 */ }
  return (best && best.p) || process.execPath;
}

function slot(id) {
  if (!state[id]) state[id] = { child: null, delay: 0, timer: null, stopping: false, startedAt: 0 };
  return state[id];
}

/** 状态快照。不探活（启动路径上不做网络请求），只看进程/端口。 */
function status(id) {
  const st = slot(id);
  const ownRunning = !!(st.child && st.child.pid && st.child.exitCode === null);
  const p = port(id);
  const extPid = ownRunning || !p ? 0 : pidByPort(p);
  return {
    id: id,
    installed: installed(id),
    running: ownRunning || !!extPid,
    ownsProcess: ownRunning,
    pid: ownRunning ? st.child.pid : extPid,
    port: p,
    autostart: autostart(id),
    root: paths(id).root,
    startedAt: ownRunning ? st.startedAt : 0,
  };
}

function start(id, reason) {
  const st = slot(id);
  if (!installed(id)) return { started: false, reason: 'not-installed' };
  if (st.child && st.child.exitCode === null) return { started: false, reason: 'already-running', pid: st.child.pid };
  const p = port(id);
  if (p) {
    const ext = pidByPort(p);
    if (ext) {
      log('[' + id + '] 检测到外部实例已在运行 pid=' + ext + '，跳过启动');
      return { started: false, reason: 'already-running-external', pid: ext };
    }
  }
  const ps = paths(id);
  st.stopping = false;
  let out = null;
  try { out = fs.openSync(ps.log, 'a'); } catch (_) { out = null; }
  const child = spawn(findNodeExe(), [ps.server], {
    cwd: ps.root,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
  });
  st.child = child;
  st.startedAt = Date.now();
  if (out !== null) {
    child.stdout.on('data', (b) => { try { fs.writeSync(out, b); } catch (_) {} });
    child.stderr.on('data', (b) => { try { fs.writeSync(out, b); } catch (_) {} });
  }
  child.on('exit', (code) => {
    if (out !== null) { try { fs.closeSync(out); } catch (_) {} }
    if (st.child === child) st.child = null;
    log('[' + id + '] 进程退出 code=' + code);
    if (!st.stopping) scheduleRestart(id, code);
  });
  child.on('error', (e) => { log('[' + id + '] 启动失败: ' + String((e && e.message) || e)); });
  st.delay = 0;
  log('[' + id + '] 已启动 pid=' + child.pid + ' port=' + p + (reason ? ' (' + reason + ')' : ''));
  return { started: true, pid: child.pid };
}

/** 指数退避重拉。端口被外部实例占着就不重拉（那是用户手动起的）。 */
function scheduleRestart(id, code) {
  const st = slot(id);
  if (st.timer) return;
  if (!autostart(id) || !installed(id)) return;
  const p = port(id);
  if (p && pidByPort(p)) return;
  st.delay = Math.min(st.delay ? st.delay * 2 : 2000, RESTART_CAP_MS);
  log('[' + id + '] ' + Math.round(st.delay / 1000) + 's 后重拉（上次 code=' + code + '）');
  st.timer = setTimeout(() => {
    st.timer = null;
    try { start(id, '自动重拉'); } catch (e) { log('[' + id + '] 重拉失败: ' + String((e && e.message) || e)); }
  }, st.delay);
  if (st.timer.unref) st.timer.unref();
}

function stop(id) {
  const st = slot(id);
  st.stopping = true;
  if (st.timer) { clearTimeout(st.timer); st.timer = null; }
  const child = st.child;
  if (!child || child.exitCode !== null) {
    // 外部实例：只按端口反查后杀掉，避免「停止」按钮对孤儿实例无效
    const p = port(id);
    const ext = p ? pidByPort(p) : 0;
    if (!ext) return { stopped: false, reason: 'not-running' };
    try {
      if (IS_WIN) spawnSync('taskkill', ['/PID', String(ext), '/T', '/F'], { timeout: 8000, windowsHide: true });
      else process.kill(ext);
      log('[' + id + '] 已停止外部实例 pid=' + ext);
      return { stopped: true, pid: ext, external: true };
    } catch (e) {
      return { stopped: false, reason: String((e && e.message) || e) };
    }
  }
  try {
    if (IS_WIN && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 8000, windowsHide: true });
    else child.kill();
    log('[' + id + '] 已停止 pid=' + child.pid);
    return { stopped: true, pid: child.pid };
  } catch (e) {
    return { stopped: false, reason: String((e && e.message) || e) };
  }
}

function restart(id) {
  const r = stop(id);
  // 停止是异步落地（taskkill 返回后端口可能还没释放）：稍等再起，别硬撞 EADDRINUSE。
  return new Promise((resolve) => {
    setTimeout(() => {
      let s;
      try { s = start(id, '手动重启'); } catch (e) { s = { started: false, reason: String((e && e.message) || e) }; }
      resolve({ stopped: r, started: s });
    }, 1200);
  });
}

/** daemon 启动钩子。 */
function startAll() {
  for (const id of IDS) {
    if (!installed(id)) continue;
    if (!autostart(id)) { log('[' + id + '] 已布署但 autostart=false，跳过'); continue; }
    try { start(id, 'daemon 启动'); } catch (e) { log('[' + id + '] 启动失败: ' + String((e && e.message) || e)); }
  }
}

function stopAll() {
  for (const id of IDS) {
    try { stop(id); } catch (_) {}
  }
}

/** 看门狗：只补「已布署 + 应自启 + 端口无人监听」这一种漏。 */
function watchdogOnce() {
  for (const id of IDS) {
    try {
      if (!installed(id) || !autostart(id)) continue;
      const st = slot(id);
      if (st.child && st.child.exitCode === null) continue;
      const p = port(id);
      if (!p || pidByPort(p)) continue;
      log('[' + id + '] 看门狗发现端口 ' + p + ' 无监听，补拉');
      start(id, '看门狗');
    } catch (e) {
      log('[' + id + '] 看门狗补拉失败: ' + String((e && e.message) || e));
    }
  }
}

// 注：定时器在这里创建（daemon require 本模块即生效），unref 保证不挡进程退出。
const watchdogTimer = setInterval(watchdogOnce, 60000);
if (watchdogTimer.unref) watchdogTimer.unref();

// ═════════════════════════ 网关内部接口调用 ═════════════════════════
// 面板不直接连 7866：key 只存在于 config.json，由 daemon 代发（前端永远拿不到
// 明文 key 的请求路径，除非用户主动点「显示」走 /credential）。
function callGateway(id, method, apiPath, body, timeoutMs) {
  return new Promise((resolve) => {
    const cfg = readConfig(id);
    const p = Number(cfg && cfg.port) || 0;
    if (!p) return resolve({ status: 0, error: '未配置端口' });
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = { Accept: 'application/json' };
    const key = String((cfg && cfg.api_key) || '');
    if (key) headers.Authorization = 'Bearer ' + key;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.request(
      { host: '127.0.0.1', port: p, method, path: apiPath, headers, timeout: timeoutMs || 15000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try { data = JSON.parse(text); } catch (_) { data = text.slice(0, 4000); }
          finish({ status: res.statusCode, data });
        });
        res.on('error', (e) => finish({ status: 0, error: String((e && e.message) || e) }));
      }
    );
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (_) {} finish({ status: 0, error: '请求超时' }); });
    req.on('error', (e) => finish({ status: 0, error: String((e && e.message) || e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

function sendJson(res, code, obj) {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  } catch (_) {}
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1 << 20) { try { req.destroy(); } catch (_) {} resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/** 读文件尾部 N 行（按字节窗口，避免把几十 MB 日志整份读进内存）。 */
function tailFile(file, lines, maxBytes) {
  try {
    const st = fs.statSync(file);
    const from = Math.max(0, st.size - (maxBytes || 256 * 1024));
    const len = st.size - from;
    if (!len) return '';
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    fs.closeSync(fd);
    const arr = buf.toString('utf8').split('\n');
    return arr.slice(Math.max(0, arr.length - (Number(lines) || 200))).join('\n');
  } catch (_) { return ''; }
}

// ═════════════════════════ 管理 API（/api/side-gateway/*） ═════════════════════════
// 鉴权由 daemon 的 isApiRequestAuthorized 统一把关（前缀 /api/ 全部要 token），
// 本模块不再做二次校验 —— 但它只监听 127.0.0.1，且不对外暴露网关 key 之外的任何东西。
async function handleApi(req, res, p) {
  const tail = p.slice('/api/side-gateway/'.length);
  const url = new URL(req.url, 'http://127.0.0.1');
  const id = url.searchParams.get('id') || IDS[0];
  if (!IDS.includes(id)) return sendJson(res, 404, { ok: false, error: '未知网关 id' });

  try {
    if (req.method === 'GET' && (tail === 'status' || tail === '')) {
      const list = IDS.map((x) => status(x));
      const health = list.filter((x) => x.running).length
        ? await callGateway(id, 'GET', '/healthz', null, 8000)
        : { status: 0, error: '未运行' };
      return sendJson(res, 200, { ok: true, gateways: list, health: health.data || null, healthError: health.error || null });
    }

    if (req.method === 'POST' && tail === 'action') {
      const body = await readJsonBody(req);
      const act = String(body.action || '');
      let result;
      if (act === 'start') result = start(id, '面板手动');
      else if (act === 'stop') result = stop(id);
      else if (act === 'restart') result = await restart(id);
      else return sendJson(res, 400, { ok: false, error: 'action 只支持 start / stop / restart' });
      return sendJson(res, 200, { ok: true, action: act, result: result, status: status(id) });
    }

    if (req.method === 'GET' && tail === 'detail') {
      const r = await callGateway(id, 'GET', '/admin/status', null, 20000);
      if (!r || r.status !== 200) return sendJson(res, 200, { ok: false, error: (r && r.error) || ('网关返回 ' + (r && r.status)) });
      return sendJson(res, 200, { ok: true, detail: r.data });
    }

    // 全量探活 + 刷积分：跑全池，按 id 各自 60s 上限放宽到 10 分钟。
    if (req.method === 'POST' && tail === 'probe') {
      const r = await callGateway(id, 'POST', '/admin/probe', {}, PROBE_TIMEOUT_MS);
      if (!r || (r.status !== 200 && r.status !== 201)) {
        return sendJson(res, 200, { ok: false, error: (r && r.error) || ('网关返回 ' + (r && r.status)) });
      }
      return sendJson(res, 200, { ok: true, probe: r.data });
    }

    if (req.method === 'GET' && tail === 'models') {
      const r = await callGateway(id, 'GET', '/v1/models', null, 20000);
      if (!r || r.status !== 200) return sendJson(res, 200, { ok: false, error: (r && r.error) || ('网关返回 ' + (r && r.status)) });
      return sendJson(res, 200, { ok: true, models: (r.data && r.data.data) || [] });
    }

    // 连接凭据：默认不返回，用户点「显示」才取（减少 key 在内存/日志里的停留）。
    if (req.method === 'GET' && tail === 'credential') {
      const cfg = readConfig(id);
      if (!cfg) return sendJson(res, 200, { ok: false, error: '未布署' });
      const p2 = Number(cfg.port) || 0;
      return sendJson(res, 200, {
        ok: true,
        baseUrl: 'http://127.0.0.1:' + p2 + '/v1',
        apiKey: String(cfg.api_key || ''),
        extraKeys: Array.isArray(cfg.extra_api_keys) ? cfg.extra_api_keys.length : 0,
        autoRetry: cfg.auto_retry_on_empty !== false,
      });
    }

    if (req.method === 'GET' && tail === 'log') {
      const lines = Number(url.searchParams.get('lines')) || 200;
      const text = tailFile(paths(id).log, lines, 512 * 1024);
      return sendJson(res, 200, { ok: true, text: text, file: paths(id).log });
    }

    if (tail === 'config') {
      if (req.method === 'GET') {
        const cfg = readConfig(id);
        if (!cfg) return sendJson(res, 200, { ok: false, error: '未布署' });
        return sendJson(res, 200, { ok: true, autostart: cfg.autostart !== false, port: Number(cfg.port) || 0 });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const cfg = patchConfig(id, { autostart: body.autostart });
        if (!cfg) return sendJson(res, 200, { ok: false, error: '写配置失败' });
        return sendJson(res, 200, { ok: true, autostart: cfg.autostart !== false });
      }
    }

    return sendJson(res, 404, { ok: false, error: '未知接口: ' + tail });
  } catch (e) {
    log('API 异常(' + tail + '): ' + String((e && e.message) || e));
    return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}

/** 前端插件源码（同目录 side-gateway-ui.js）。缺失即返回空串 ⇒ 面板不出现标签页。 */
function uiSource() {
  try { return fs.readFileSync(path.join(__dirname, 'side-gateway-ui.js'), 'utf8'); } catch (_) { return ''; }
}

module.exports = {
  configure,
  startAll,
  stopAll,
  start,
  stop,
  restart,
  status,
  watchdogOnce,
  handleApi,
  uiSource,
};
