/**
 * 侧车统一网关 · 管理 API（可剥离插件后端）的静态 + 行为回归。
 *
 * 特点：**不依赖网关进程是否在跑**。网关没起时只跳过"有数据"类断言，
 * 结构类断言（路由是否存在、鉴权形态、白名单、剥离边界）照样验。
 *
 * 另一份 test-side-gateway-ui.js 是面板插件的真实 DOM 测试（需要无头 Edge，
 * 跑得慢，不进默认回归，改前端时手动跑）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sg = require(path.join(ROOT, 'scripts', 'side-gateway.js'));
sg.configure({ log: () => {} });

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 240))); }
}

function call(method, url, body) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = {
      method, url, headers: { host: '127.0.0.1' },
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      destroy() {},
    };
    const res = {
      statusCode: 0, body: '',
      writeHead(code) { this.statusCode = code; },
      end(b) { this.body = String(b || ''); },
    };
    const finish = () => {
      let json = null;
      try { json = JSON.parse(res.body); } catch (_) {}
      resolve({ status: res.statusCode, json });
    };
    const p = sg.handleApi(req, res, url.split('?')[0]);
    setTimeout(() => {
      if (body !== undefined) {
        const buf = Buffer.from(JSON.stringify(body), 'utf8');
        (listeners.data || []).forEach((f) => f(buf));
      }
      (listeners.end || []).forEach((f) => f());
    }, 5);
    Promise.resolve(p).then(() => setTimeout(finish, 40), () => setTimeout(finish, 40));
  });
}

function readSrc(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; }
}

(async () => {
  const base = '/api/side-gateway/';

  // ── A. 模块契约（静态） ──
  console.log('\n[A] 模块契约');
  const exportsNeeded = ['configure', 'startAll', 'stopAll', 'start', 'stop', 'restart', 'status', 'handleApi', 'uiSource'];
  ok(exportsNeeded.every((k) => typeof sg[k] === 'function'), '导出齐全（9 个函数）',
    exportsNeeded.filter((k) => typeof sg[k] !== 'function'));
  const st0 = sg.status('unified');
  ok(st0 && st0.id === 'unified' && st0.port === 7866, 'status 给出 id/port', st0);
  ok(typeof st0.running === 'boolean' && typeof st0.installed === 'boolean', 'status 有 running/installed 布尔');
  ok(typeof st0.root === 'string' && /unified$/.test(st0.root), '数据目录指向 <dataDir>/unified', st0.root);

  // ── B. 路由行为 ──
  console.log('\n[B] 路由行为');
  let r = await call('GET', base + 'status');
  ok(r.status === 200 && r.json && r.json.ok === true, 'GET status → 200 ok');
  ok(Array.isArray(r.json.gateways) && r.json.gateways.length === 1, 'gateways 是长度 1 的数组');
  const gw = r.json.gateways[0];
  ok(gw.installed === true, 'installed=true（数据目录有 server.js + config.json）');
  const running = !!gw.running;
  ok(typeof gw.ownsProcess === 'boolean', 'ownsProcess 有值（区分子进程 / 外部实例）');
  if (running) {
    ok(!!r.json.health, '网关在跑 ⇒ health 有内容');
    ok(Object.keys((r.json.health || {}).providers || {}).length === 2, '两个上游 provider');
    ok(Number(r.json.health.total) === 150, '池总数 150', r.json.health.total);
    ok(Number(r.json.health.alive) > 0 && Number(r.json.health.alive) <= 150, 'alive 在 (0,150]', r.json.health.alive);
  } else {
    console.log('  --   网关未运行，跳过 health 断言');
  }

  r = await call('GET', base + 'credential');
  ok(r.status === 200 && r.json.ok === true, 'GET credential → 200');
  ok(/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(r.json.baseUrl || ''), 'baseUrl 形态正确', r.json.baseUrl);
  ok(typeof r.json.apiKey === 'string' && r.json.apiKey.length >= 24, 'apiKey 长度 ≥24');
  ok(r.json.apiKey !== 'undefined', 'apiKey 不是字符串 "undefined"');

  r = await call('GET', base + 'config');
  ok(r.status === 200 && typeof r.json.autostart === 'boolean', 'GET config → autostart 布尔');
  const before = r.json.autostart;
  r = await call('POST', base + 'config', { autostart: !before });
  ok(r.json.ok === true && r.json.autostart === !before, 'POST config 翻转生效');
  r = await call('POST', base + 'config', { autostart: before });
  ok(r.json.ok === true && r.json.autostart === before, 'POST config 复原成功');

  // 白名单：config 只允许改 autostart，不能借它改端口/密钥（改了会把托管打乱）
  const cfgBefore = JSON.parse(readSrc('../AppData/Roaming/WorkDaddy/unified/config.json') || 'null');
  r = await call('POST', base + 'config', { autostart: before, port: 19999, api_key: 'hacked' });
  const cfgFile = (() => {
    try {
      const p = path.join(require('os').homedir(), 'AppData', 'Roaming', 'WorkDaddy', 'unified', 'config.json');
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { return null; }
  })();
  if (cfgFile) {
    ok(Number(cfgFile.port) === 7866, 'config 拒绝改 port（白名单）', cfgFile.port);
    ok(cfgFile.api_key !== 'hacked', 'config 拒绝改 api_key（白名单）');
  } else {
    console.log('  --   读不到 config.json，跳白白名单断言');
  }

  r = await call('GET', base + 'log?lines=5');
  ok(r.status === 200 && typeof r.json.text === 'string', 'GET log 返回 text 字符串');

  if (running) {
    r = await call('GET', base + 'detail');
    ok(r.status === 200 && r.json.ok === true, 'GET detail → 200');
    const provs = (r.json.detail && r.json.detail.providers) || {};
    ok(Object.keys(provs).length === 2, 'detail 含两个 provider');
    const anyAcct = Object.values(provs).some((p) => Array.isArray(p.accounts) && p.accounts.length > 0);
    ok(anyAcct, '至少一个 provider 有账号明细');

    r = await call('GET', base + 'models');
    ok(r.status === 200 && Array.isArray(r.json.models) && r.json.models.length >= 10, 'GET models ≥10 条',
      r.json.models && r.json.models.length);
  } else {
    console.log('  --   网关未运行，跳过 detail/models 断言');
  }

  r = await call('POST', base + 'action', { action: 'nuke' });
  ok(r.status === 400 && r.json.ok === false, '非法 action → 400');

  r = await call('GET', base + 'whatever');
  ok(r.status === 404 && r.json.ok === false, '未知子路由 → 404');

  // ── C. 剥离边界（静态） ──
  console.log('\n[C] 可剥离边界');
  const daemonSrc = readSrc('scripts/daemon.js');
  ok(daemonSrc.length > 0, 'daemon.js 可读');
  const lines = daemonSrc.split('\r\n');
  const hit = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => /sideGateway/.test(x.l) && !/^\s*\/\//.test(x.l));
  ok(hit.length <= 12, 'daemon.js 里 sideGateway 挂载点 ≤12 行（grep 一遍可逐行删干净）', hit.map((x) => x.n + ': ' + x.l.trim().slice(0, 50)));
  ok(hit.some((x) => /require\('\.\/side-gateway'\)/.test(x.l)), '有一处 require');
  ok(hit.some((x) => /handleApi/.test(x.l)), '有一处路由分发');
  ok(hit.some((x) => /startAll/.test(x.l)), '有一处启动钩子');
  ok(hit.filter((x) => /stopAll/.test(x.l)).length >= 2, '至少两处退出钩子（SIGTERM/SIGINT/exit）');
  ok(hit.some((x) => /uiSource/.test(x.l)), '有一处前端拼接');

  const injectSrc = readSrc('scripts/inject.js');
  ok(injectSrc.indexOf('sideapi') < 0 && injectSrc.indexOf('__wsgUi') < 0,
    'inject.js 里零残留（插件不改主面板）');

  const uiSrc = sg.uiSource();
  ok(typeof uiSrc === 'string' && uiSrc.length > 4000, 'uiSource 读得到前端文件', uiSrc.length);
  ok(/data-wsg=/.test(uiSrc), '前端含自己命名空间的事件属性');
  ok(/__WBS_API__/.test(uiSrc) && /__WBS_API_TOKEN__/.test(uiSrc), '前端用 daemon 的占位符注入地址与 token');
  ok(/teardown/.test(uiSrc), '前端带 teardown（注入热更时能换新逻辑）');
  ok(uiSrc.indexOf("'use strict'") >= 0, '前端有严格模式');

  // ⭐ 卡顿守卫（2026-11-03 实测：旧版 observer 监听 documentElement+subtree+attributes，
  //    聊天流式输出的每个 token 都会触发回调 ⇒ 白烧主线程）。
  ok(/mo\.observe\(document\.body, \{ childList: true \}\)/.test(uiSrc),
    '⚠️ 卡顿守卫①：observer 只观察 body 的 childList（不监听 documentElement/subtree/attributes）');
  // ⚠️ 必须先剥注释再判：本文件头注释里就写着旧版用了 `attributes: true`
  //    （描述修复背景），直接正则命中注释会误报 —— 与 K2 断言同一个坑。
  const uiCode = uiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
  ok(!/attributes:\s*true/.test(uiCode),
    '⚠️ 卡顿守卫②：不监听 attributes（attribute 变动在流式渲染里最频繁）');
  ok(/if\s*\(mounted\(\)\)\s*\{[\s\S]{0,140}?mo\.disconnect\(\)/.test(uiSrc),
    '⚠️ 卡顿守卫③：回调里检测到已挂载立即 disconnect（挂载后零回调开销）');
  ok(/requestIdleCallback/.test(uiSrc),
    '⚠️ 卡顿守卫④：挂载探测走 requestIdleCallback，不跟渲染抢主线程');

  // ⭐ 轻量化守卫（管理界面必须搬去网页控制台，面板只留按键）
  ok(/打开控制台|openConsole/.test(uiSrc), '面板提供「打开控制台」入口');
  ok(!/wsg-table|wsg-scroll/.test(uiSrc), '面板不再内嵌账号表 / 日志框（管理界面已搬到网页）');
  ok(/\/api\/side-gateway\/status/.test(uiSrc) || /side-gateway/.test(uiSrc), '面板仍通过 daemon 代理读状态');

  // 端口隔离：侧车网关不能和 wb2api 主网关、面板 API 撞端口
  const cfg = cfgFile || {};
  ok(Number(cfg.port) !== 7863 && Number(cfg.port) !== 47832, '端口与 wb2api(7863)/daemon 不冲突', cfg.port);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FATAL ' + (e && e.message));
  process.exit(2);
});
