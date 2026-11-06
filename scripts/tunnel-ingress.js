/**
 * 公网入口分发器（2026-11-03）—— 让 17443 一个端口同时对外提供两个网关。
 *
 * ── 为什么要这一层 ─────────────────────────────────────────────────────
 * 老叶的需求：在 OpenWrt 上能自由切「150 号统一网关(7866)」和「自己的反代网关(7863)」。
 * 但家宽 frps 只放行 17443 一个端口（不能新开），而 frp 的 `https2http` 插件
 * **只做 TLS 终结、不具备路由能力**（它是 tcp 代理 + 插件，把所有请求原样转给
 * 一个 localAddr）。⇒ 路径分流只能在本机做。
 *
 * ── 链路 ───────────────────────────────────────────────────────────────
 *   公网 https://api.lyonn.fun:17443/uni/v1/...   → 本层 → 127.0.0.1:7866
 *   公网 https://api.lyonn.fun:17443/v1/...       → 本层 → 127.0.0.1:7863（原样）
 *
 * ── ⚠️⚠️ 安全（这层存在的第二个理由）──────────────────────────────────
 * 7866 的控制台 `/panel/` 是**完全免口令**的（本机单人自用），里面有 150 个账号的
 * uid/积分/状态明细和 api_key 明文，而且它的 `panelOriginOk()` 对**无 Origin 头
 * 的请求直接放行** —— 公网 curl 正好不带 Origin。
 * ⇒ 7866 直接上 frp = 把 150 个号挂在公网上。
 * 所以本层做两件事：
 *   ① 公网一律不许碰 `/panel/*`、`/admin/*`、`/healthz`（只放 /v1/*）
 *   ② 主动盖 `x-workdaddy-tunnel: 1` 标记头（和 7863 的 tunnelGuard 同一个约定），
 *      7866 里也加了同样的守卫 ⇒ **两层都拒绝**，即使有人绕过本层也进不去。
 *
 * ── 为什么不用 frp 的 HTTP 型 proxy 按 host/path 分 ────────────────────
 * frp 的 http 型代理需要在 frps 上开 vhost 端口（vhostHTTPPort），家宽那边同样
 * 要新开端口 ⇒ 和"只能复用 17443"的前提冲突。本层是唯一不需要动路由器的做法。
 *
 * ── 可剥离 ─────────────────────────────────────────────────────────────
 * 删本文件 + 把 frpc 的 localAddr 改回 127.0.0.1:7863 + 删 daemon 里那几行挂载。
 * 与 7863 / 7866 都只靠 HTTP 相连，不共享状态。
 */

const http = require('http');
const log = (...a) => console.log(new Date().toISOString(), '[ingress]', ...a);

/**
 * @param {object} opt
 *   port        本层监听端口（只回环）
 *   mainTarget  默认上游（7863）  { host, port }
 *   uniTarget   路径前缀 /uni 的上游（7866） { host, port }
 *   uniPrefix   统一网关的路径前缀，默认 '/uni'
 */
function createIngress(opt) {
  const CFG = Object.assign({
    port: 7867,
    mainTarget: { host: '127.0.0.1', port: 7863 },
    uniTarget: { host: '127.0.0.1', port: 7866 },
    uniPrefix: '/uni',
  }, opt || {});

  let srv = null;
  let stats = { req: 0, toUni: 0, toMain: 0, blocked: 0, err: 0, startedAt: 0 };

  /** 公网禁止访问的路径：控制台 / 管理面。
   *  ⚠️ 这条是**主闸**。7866 自己也有一条（读 x-workdaddy-tunnel），
   *     两层都拦 —— 单点绕过不至于把 150 个号漏出去。
   *
   *  ⚠️⚠️ `/healthz` **必须放行**，别再拦回来（2026-11-03 踩过）：
   *     路由器上的「WorkDaddy 网关」面板就是靠 `https://127.0.0.1:17443/healthz`
   *     探活的（`gwCode === 200 && healthy > 0` 才算在线）。一刀切拦掉之后，
   *     面板立刻显示「网关离线」，看起来像我把公网搞坏了。
   *     健康检查只回 `{status, providers:{pool,alive,...}, total, alive, models}`，
   *     **没有** uid / 账号明细 / api_key，公网可见无风险。
   *     真正要藏的是 /panel（150 个账号明细）和 /admin（管理面）。 */
  function isForbidden(p) {
    return (
      p === '/panel' || p.indexOf('/panel/') === 0 ||
      p === '/admin' || p.indexOf('/admin/') === 0
    );
  }

  /** 路径归一：/uni/v1/xxx → /v1/xxx；容忍 /uni 与 /uni/ 两种写法。 */
  function stripPrefix(p) {
    if (p === CFG.uniPrefix) return '/';
    if (p.indexOf(CFG.uniPrefix + '/') === 0) return p.slice(CFG.uniPrefix.length);
    return p;
  }

  function handler(req, res) {
    stats.req++;
    /* 本机排障口：GET /ingress/status 看分流计数 + 两个上游是否活着。
     * ⚠️⚠️ 不能靠 remoteAddress 判"是不是本机" —— frpc 在本机跑，
     *    所以**公网流量到达本层时 remoteAddress 同样是 127.0.0.1**。
     *    唯一可靠的判据是 `x-workdaddy-tunnel: 1`（frpc 按 frpc.toml 的
     *    requestHeaders.set 覆盖写上去的，外部客户端自带的同名头会被改写）。
     *    这也是 7863/7866 控制台守卫用同一个头的根本原因。 */
    if ((req.url || '').split('?')[0] === '/ingress/status') {
      const from = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const isLoop = from === '127.0.0.1' || from === '::1';
      if (!isLoop || String(req.headers['x-workdaddy-tunnel'] || '') === '1') {
        stats.blocked++;
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: { message: 'local only' } }));
      }
      const probe = (t) => new Promise((resolve) => {
        const rq = http.request({ host: t.host, port: t.port, path: '/healthz', method: 'GET', timeout: 1500 }, (rr) => {
          rr.resume(); resolve(rr.statusCode || 0);
        });
        rq.on('error', () => resolve(0));
        rq.on('timeout', () => { rq.destroy(); resolve(0); });
        rq.end();
      });
      Promise.all([probe(CFG.mainTarget), probe(CFG.uniTarget)]).then(([m, u]) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(Object.assign(status(), { upstream: { main: m, uni: u } })));
      });
      return;
    }
    const rawUrl = req.url || '/';
    const qIdx = rawUrl.indexOf('?');
    const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
    const query = qIdx >= 0 ? rawUrl.slice(qIdx) : '';

    // ① 先按**原始路径**判断是不是统一网关的流量，再做前缀剥离
    const isUni = rawPath === CFG.uniPrefix || rawPath.indexOf(CFG.uniPrefix + '/') === 0;
    const target = isUni ? CFG.uniTarget : CFG.mainTarget;
    const path = isUni ? stripPrefix(rawPath) : rawPath;

    // ② 公网一律不给控制台/管理面。注意这里判的是**剥离前缀之后**的路径：
    //    /uni/panel/ → /panel/ 也要拦（有人会试着用前缀绕）。
    if (isForbidden(path)) {
      stats.blocked++;
      log('blocked', req.method, rawPath, '→', path, 'from', req.headers['x-forwarded-for'] || req.socket.remoteAddress);
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        error: {
          message: 'panel/admin 不对外网开放（只在本机 127.0.0.1 访问）',
          type: 'forbidden',
        },
      }));
    }

    // ③ 转发
    const headers = Object.assign({}, req.headers);
    // ⚠️ 覆盖写而不是"有则跳过"：外部客户端自带同名头也必须被改写，否则绕得过去。
    headers['x-workdaddy-tunnel'] = '1';
    // host 改成上游自己的，避免上游做 Host 校验/拼绝对 URL 时出错
    headers['host'] = target.host + ':' + target.port;
    // 记原始路径，便于上游日志区分「从公网来的」还是「本机直连」
    headers['x-forwarded-prefix'] = isUni ? CFG.uniPrefix : '';
    if (!headers['x-forwarded-for']) {
      headers['x-forwarded-for'] = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    }

    const up = http.request({
      host: target.host,
      port: target.port,
      method: req.method,
      path: path + query,
      headers: headers,
    }, (ur) => {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
    });

    up.on('error', (e) => {
      stats.err++;
      log('upstream error', (isUni ? 'uni:' : 'main:') + target.port, e.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: {
            message: '上游 ' + target.port + ' 不可达：' + e.message +
              (isUni ? '（统一网关没启动？本机 curl 127.0.0.1:' + target.port + '/healthz 看）' : ''),
            type: 'bad_gateway',
          },
        }));
      } else {
        try { res.end(); } catch (_) { }
      }
    });

    // 流式（SSE）关键：请求体直接管道过去，不缓冲
    req.pipe(up);
    if (isUni) stats.toUni++; else stats.toMain++;

    // 客户端提前断开时，把上游请求也断掉，别让上游白白跑完
    res.on('close', () => { try { up.destroy(); } catch (_) { } });
  }

  function start() {
    if (srv) return Promise.resolve();
    return new Promise((resolve, reject) => {
      srv = http.createServer(handler);
      // SSE/长连接不能被 Node 默认超时掐掉
      srv.timeout = 0;
      srv.keepAliveTimeout = 65000;
      srv.on('error', (e) => { log('listen error', e.message); reject(e); });
      srv.listen(CFG.port, '127.0.0.1', () => {
        stats.startedAt = Date.now();
        log('listening 127.0.0.1:' + CFG.port,
          '→ main 7863 / uni 7866 @ ' + CFG.uniPrefix);
        resolve();
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!srv) return resolve();
      const s = srv; srv = null;
      try { s.close(() => resolve()); } catch (_) { resolve(); }
      // 兜底：close 在长连接存在时可能迟迟不回调
      setTimeout(resolve, 800);
    });
  }

  function status() {
    return {
      running: !!srv,
      port: CFG.port,
      uniPrefix: CFG.uniPrefix,
      main: CFG.mainTarget.port,
      uni: CFG.uniTarget.port,
      uptimeS: srv && stats.startedAt ? Math.round((Date.now() - stats.startedAt) / 1000) : 0,
      stats: { req: stats.req, toMain: stats.toMain, toUni: stats.toUni, blocked: stats.blocked, err: stats.err },
    };
  }

  return { start, stop, status, config: CFG };
}

module.exports = { createIngress };
