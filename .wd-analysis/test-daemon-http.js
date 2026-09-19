'use strict';
/*
 * test-daemon-http.js —— 请求入口层（HTTP）的回归测试。
 *
 * 为什么单独一套：本仓此前 **20 套 1600+ 条断言全在业务逻辑层**，
 * `readBody` / `isApiRequestAuthorized` / `writeAutomations` / `watchdog` / `semverCompare`
 * 在这些套件里 **0 引用**，搜 `http.createServer`/`timingSafeEqual` 零命中
 * ⇒ 整仓没有任何 HTTP/鉴权层测试（2026-09-19 审查报告 §6.2）。这正是那批缺陷能活到 1.4.0 的原因。
 *
 * 本套件覆盖 §9 第 3 项（readBody 统一化）的行为，并静态锁住鉴权层的既有契约。
 *
 * 【E】readBody 真跑（从 daemon.js 切片 → new Function 实例化 → 起临时 HTTP 服务 + 裸 socket 客户端）
 *      三条不变式：一定 settle / 有界 / 空 body 是 {} 而非法 JSON 必须 reject
 * 【E7】对照组：把**旧实现**内联进来跑同一条探针 —— 证明这套探针真能发现缺陷
 * 【E8~E13】事件层边界（error / aborted / close / 恰好 settle 一次 / 超限销毁连接）
 * 【F】鉴权与契约的静态断言（公开集合只读、update-apply 受保护、非法 Origin 403）
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.resolve(__dirname, '..');
const daemonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'daemon.js'), 'utf8');

let pass = 0;
const failures = [];
function check(ok, name) {
  if (ok) { pass++; console.log('  ok   ' + name); return; }
  failures.push(name); console.log('  FAIL ' + name);
}

/** 按大括号配平从源码里切出一个函数（`header` 必须包含到参数列表末尾） */
function sliceFunction(text, header) {
  const at = text.indexOf(header);
  if (at < 0) throw new Error('锚点未找到: ' + header);
  const open = text.indexOf('{', at + header.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(at, i + 1); }
  }
  throw new Error('大括号未配平: ' + header);
}

const HEADER = 'function readBody(req, limit = READ_BODY_LIMIT)';
const LIMIT_LINE = daemonSrc.split(/\r?\n/).find((l) => /^const READ_BODY_LIMIT = /.test(l));
const factory = new Function(LIMIT_LINE + '\n' + sliceFunction(daemonSrc, HEADER) + '\nreturn { readBody, READ_BODY_LIMIT };');
const { readBody, READ_BODY_LIMIT } = factory();

/** 旧实现（改造前的原文）——只用于 E7 对照组，证明探针有效 */
const legacyReadBody = new Function(`
  return function legacyReadBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (_) {
          resolve({});
        }
      });
    });
  };
`)();

function startServer(impl, limit) {
  const state = { settled: 0, pending: 0 };
  const server = http.createServer((req, res) => {
    state.pending++;
    // 显式写 Content-Length：否则 Node 会走 chunked，客户端解析要做去分块（测试里没必要）。
    const reply = (status, obj) => {
      const text = JSON.stringify(obj);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    const settle = (fn) => {
      state.settled++;
      state.pending--;
      try { fn(); } catch (_) {}
    };
    impl(req, limit)
      .then((body) => settle(() => reply(200, { ok: true, body })))
      .catch((error) => settle(() => reply(
        Number(error && error.statusCode) || 500,
        { ok: false, status: Number(error && error.statusCode) || 500, error: String(error && error.message || error) },
      )));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

function send(port, body, contentLength) {
  return new Promise((resolve) => {
    const len = contentLength == null ? Buffer.byteLength(body) : contentLength;
    const head = 'POST /t HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
      'Content-Length: ' + len + '\r\nConnection: close\r\n\r\n';
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(head + body);
      if (!body) socket.end();
    });
    let buf = '';
    const done = () => { try { socket.destroy(); } catch (_) {} resolve(buf); };
    socket.on('data', (d) => { buf += d.toString('utf8'); });
    socket.on('end', done);
    socket.on('error', done);
    socket.setTimeout(6000, done);
  });
}

/** 发半截 body 后硬 RST（resetAndDestroy 才发 RST；destroy() 是优雅关闭） */
function abort(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('POST /t HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
        'Content-Length: 200000\r\n\r\n{"a":"' + 'y'.repeat(2000) + '"');
      setTimeout(() => { try { socket.resetAndDestroy(); } catch (_) { try { socket.destroy(); } catch (__) {} } done(); }, 5);
    });
    socket.on('error', done);
  });
}
function statusOf(res) { const m = res.match(/^HTTP\/1\.1 (\d{3})/); return m ? Number(m[1]) : null; }
function jsonOf(res) { const i = res.indexOf('\r\n\r\n'); try { return JSON.parse(res.slice(i + 4)); } catch (_) { return null; } }
function waitFor(fn, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => { if (fn()) return resolve(true); if (Date.now() > until) return resolve(false); setTimeout(tick, 25); };
    tick();
  });
}
function fakeReq() {
  const req = new EventEmitter();
  req.destroy = () => { req.destroyed = true; };
  req.resume = () => { req.resumed = true; };
  return req;
}
function settles(fn) {
  return new Promise((resolve) => {
    let done = false;
    fn((value) => { if (!done) { done = true; resolve({ kind: 'resolve', value }); } },
      (error) => { if (!done) { done = true; resolve({ kind: 'reject', error }); } });
  });
}

async function main() {
  console.log('=== E 段：readBody 真跑（临时 HTTP 服务）===');
  const small = 1024;
  let s = await startServer(readBody, small);

  const empty = await send(s.port, '');
  check(statusOf(empty) === 200 && JSON.stringify(jsonOf(empty).body) === '{}', 'E1 空 body 仍然解析成 {}（大量路由靠无 body 的 POST 触发）');

  const ok = await send(s.port, JSON.stringify({ a: 1, s: '中文' }));
  check(statusOf(ok) === 200 && jsonOf(ok).body.a === 1 && jsonOf(ok).body.s === '中文', 'E2 合法 JSON 正常解析（含中文）');

  const bad = await send(s.port, '{"a":');
  check(statusOf(bad) === 400 && jsonOf(bad) && jsonOf(bad).ok === false, 'E3 非法 JSON → 400（旧实现会折成 {} 静默继续）');
  check(/不是合法 JSON/.test((jsonOf(bad) || {}).error || ''), 'E4 非法 JSON 的错误消息可读');

  const tooBig = await send(s.port, 'x'.repeat(4096));
  check(statusOf(tooBig) === 413 && /过大/.test((jsonOf(tooBig) || {}).error || ''), 'E5 超过 limit → 413 + 「请求体过大」（有界，不再无限拼接）');

  const before = s.state.settled;
  await abort(s.port);
  const settledInTime = await waitFor(() => s.state.settled > before, 3000);
  check(settledInTime, 'E6 客户端半截 body + RST 时服务端一定 settle（旧实现会永久挂起）');

  // E7 批量：300 次中断后 pending 不增长
  const base = s.state;
  const startSettled = base.settled;
  for (let i = 0; i < 300; i++) await abort(s.port);
  const allSettled = await waitFor(() => base.settled - startSettled === 300, 10000);
  check(allSettled && base.pending === 0, 'E7 300 次「半截 body + RST」后全部 settle，pending 回到 0（不累积挂起帧）');
  s.server.close();

  console.log('=== E7 对照组：旧实现跑同一条探针应当挂起 ===');
  const legacy = await startServer(legacyReadBody, small);
  for (let i = 0; i < 200; i++) await abort(legacy.port);
  const legacyGrew = await waitFor(() => legacy.state.pending >= 200, 3000);
  check(legacyGrew && legacy.state.settled === 0,
    'E8 对照：旧实现 200 次中断后 pending=' + legacy.state.pending + '、settled=' + legacy.state.settled + '（证明探针真能发现缺陷）');
  legacy.server.close();

  console.log('=== E 段补充：事件层边界（假 req）===');
  {
    const req = fakeReq();
    const promise = settles((ok2, no) => readBody(req).then(ok2, no));
    const error = new Error('boom'); error.code = 'ECONNRESET';
    req.emit('error', error);
    const r = await promise;
    check(r.kind === 'reject' && /读取请求体失败/.test(r.error.message) && /ECONNRESET/.test(r.error.message),
      'E9 req 的 error 事件 → reject（带 errno）');
    check(r.kind === 'reject' && r.error.statusCode === 400, 'E10 该 reject 标了 statusCode=400（路由兜底会正确折成 400 而不是 500）');
  }
  {
    const req = fakeReq();
    const promise = settles((ok2, no) => readBody(req).then(ok2, no));
    req.emit('aborted');
    const r = await promise;
    check(r.kind === 'reject' && /中断/.test(r.error.message), 'E11 aborted 事件 → reject（Node 22 中断时只发这个事件）');
  }
  {
    const req = fakeReq();
    const promise = settles((ok2, no) => readBody(req).then(ok2, no));
    req.emit('close');
    const r = await promise;
    check(r.kind === 'reject', 'E12 close 事件兜底（连 aborted 都没发时也不会挂起）');
  }
  {
    const req = fakeReq();
    const promise = settles((ok2, no) => readBody(req).then(ok2, no));
    req.emit('end');
    req.emit('error', new Error('late'));
    req.emit('aborted');
    const r = await promise;
    check(r.kind === 'resolve' && JSON.stringify(r.value) === '{}', 'E13 恰好 settle 一次：先 end 之后再来的事件不改变结果');
  }
  {
    const req = fakeReq();
    const promise = settles((ok2, no) => readBody(req, 8).then(ok2, no));
    req.emit('data', Buffer.from('0123456789'));
    const r = await promise;
    check(r.kind === 'reject' && r.error.statusCode === 413 && req.resumed === true && req.destroyed !== true,
      'E14 超限：reject 413 + resume() 排空丢弃（**不**销毁连接，否则 413 响应发不出去）');
  }

  console.log('=== F 段：鉴权与契约（静态断言）===');
  {
    const publicPaths = (daemonSrc.match(/const PUBLIC_API_PATHS = new Set\(\[[\s\S]*?\]\)/) || [''])[0]
      .split(/\r?\n/).map((l) => (l.match(/'(\/api\/[^']*)'/) || [])[1]).filter(Boolean);
    check(publicPaths.length === 5, 'F1 公开路径集合解析出 5 条（实际 ' + publicPaths.length + '）');
    check(publicPaths.every((p) => !new RegExp("req\\.method === 'POST' && p === '" + p.replace(/[/]/g, '\\/') + "'").test(daemonSrc)),
      'F2 公开路径全部只读：没有任何一条出现在 POST 分支里（否则会变成免鉴权写入口）');
    check(publicPaths.indexOf('/api/update-apply') < 0 && /req\.method === 'POST' && p === '\/api\/update-apply'/.test(daemonSrc),
      'F3 /api/update-apply（会杀 WorkBuddy 再装）不在公开集合里，走 token 鉴权');
    check(/if \(!isApiRequestAuthorized\(req, p\)\) \{[\s\S]{0,120}?json\(res, 401/.test(daemonSrc),
      'F4 未授权返回 401（不是 404 —— 路由存在性不该泄露给未授权者）');
    check(/origin && !isAllowedApiOrigin\(origin\)[\s\S]{0,200}?403/.test(daemonSrc),
      'F5 非法 Origin 的预检请求返回 403');
    check(READ_BODY_LIMIT >= 16 * 1024 * 1024 && /readBody\(req, 256 \* 1024 \* 1024\)/.test(daemonSrc),
      'F6 默认体积上限 ≥16 MiB（图片 dataURL 余量），且旧格式会话导入显式放宽到 256 MiB');
    check(!/resolve\(data \? JSON\.parse\(data\) : \{\}\)/.test(daemonSrc),
      'F7 旧行为「解析失败 resolve({})」已彻底消失（防回退）');
    check((daemonSrc.match(/readBody\(req/g) || []).length >= 80,
      'F8 readBody 仍是 85 条路由共用的唯一入口（实际 ' + (daemonSrc.match(/readBody\(req/g) || []).length + ' 处调用）');
  }

  console.log('\n==== ' + pass + ' passed, ' + failures.length + ' failed ====');
  failures.forEach((name) => console.log('  未通过: ' + name));
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('测试自身崩了: ' + (error && error.stack || error));
  process.exit(1);
});
