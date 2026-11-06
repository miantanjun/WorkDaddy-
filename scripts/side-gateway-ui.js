/**
 * 侧车统一网关 —— 面板插件（前端 / 纯外挂 / **轻量版**）
 *
 * ── 2026-11-03 改版 ①：从「内置管理界面」改为「几个功能按键」────────────────
 * 旧版把账号池 / 模型表 / 日志 / 启停全画在面板里 ⇒ 面板要承担一份完整管理界面。
 * 新版按用户要求对齐 wb2api 的做法：**面板只放按键，控制台在网页里**。
 *   · 只负责：状态灯 + 打开控制台 + 启停/探活/重载
 *   · 管理界面全部搬到网关自带的 http://127.0.0.1:7866/panel/
 *
 * ── 2026-11-03 改版 ②：不再自建「网关」标签页，改为**嵌入「模型」页顶部** ──
 * 用户反馈「相近功能放到了不同的地方」：原先面板里「模型」和「网关」是两个相邻的
 * 一级标签，而它们做的是同一件事（哪些模型能用、把哪个模型注册进 WorkBuddy）。
 * 现在：
 *   · 不新建 tab —— 面板标签数从 9 回到 8
 *   · 网关状态卡插在 `[data-pane="models"]` 的**最前面**，作为该页的第一块
 *   · 卸载/剥离时只删这张卡，不留空标签
 *
 * ── 卡顿修复（关键）────────────────────────────────────────────────────
 * 旧版用一个 MutationObserver 监听 **documentElement + subtree + attributes**：
 *   面板是动态挂载的，所以它必须守着；但 `subtree` 意味着**整个页面的任何 DOM 变动**
 *   都会触发回调 —— 聊天流式输出时每个 token 都在响一次，白烧主线程。
 * 新版：
 *   ① 观察范围收窄到 `document.body` 的 childList（不监听 attributes）
 *   ② 回调里先做「是否已挂载」的廉价判断，已挂载就直接 return（不 scheduleMount）
 *   ③ 挂载成功后**立刻 disconnect** —— 只在「面板还没出现」这个窗口期守着
 *   ④ 用 requestIdleCallback（无则 setTimeout）把探测放到空闲时段
 *   ⑤ 卡片消失后的重插，用**极轻量的定时检查**（只在模型页可见时跑），
 *      不再为它常开 observer
 *
 * ── 剥离 ─────────────────────────────────────────────────────────────
 * 删本文件 + scripts/side-gateway.js + daemon.js 的 11 行挂载 ⇒ 卡片自然消失。
 */
(function () {
  'use strict';
  // 热更新协议：inject.js 是全量重建式热更，必须先把旧实例拆干净再重建
  if (window.__wsg && typeof window.__wsg.teardown === 'function') {
    try { window.__wsg.teardown(); } catch (_) { }
  }

  var API_BASE = '__WBS_API__';
  var API_TOKEN = '__WBS_API_TOKEN__';
  /** 目标页：网关卡片挂在「模型」页里（不再是自己的一级标签）。 */
  var HOST_PANE = 'models';
  /** ⚠️⚠️ 真正的落点不是 pane 本身，而是 pane 里的 **.wbs-model-card**。
   *  实测踩坑：`.wbs-pane` 是 `display:flex` 且**默认横向**，往里插一个块级卡片会让
   *  官方的模型卡（flex:1 1 0%）被横向挤掉 ⇒ 用户看到「模型页一片空白」。
   *  `.wbs-model-card` 是列向 flex（末尾 .wbs-model-list 才是 flex:1 的滚动容器），
   *  插在它最前面只占用固定高度，下面的列表自己滚 —— 不会再挤坏布局。 */
  var HOST_CARD = '.wbs-model-card';
  /** 卡片节点标记（用 data 属性而不是 id：同一页可能被重复挂载，用 querySelectorAll 更好清）。 */
  var SLOT_ATTR = 'data-wsg-slot';
  /** 插件协议版本：改动 UI 结构时 +1。
   *  ⚠️ 热更时必须靠它判断「面板里那份是不是我这个版本」——
   *     只看节点存不存在是不够的：inject.js 是全量重建式热更，
   *     上一版留下的节点还在，新版若认为「已挂载」就会直接退出，
   *     面板就永远停在旧 UI 上（本轮实测踩过）。 */
  var UI_REV = '5';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'X-WorkDaddy-Token': API_TOKEN }, cache: 'no-store' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API_BASE + path, init).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /** 状态：挂在 window 上（闭包会被热更换掉，状态不能丢） */
  var S = window.__wsgState = window.__wsgState || {
    st: null, health: null, lastAt: 0, busy: '', err: '', consoleOpen: false,
  };

  var STYLE_ID = 'wsg-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = [
      /* 宿主节点：放在 .wbs-model-card 里（列向 flex）的最前面。
         ⚠️ 必须 flex:none + min-width:0 —— 模型卡是 flex 容器，不给就会参与拉伸。 */
      '.wsg-host{flex:0 0 auto;min-width:0}',
      /* 一条式网关条：刻意压到 ~38px，高度直接吃掉模型列表的可见区域 */
      '.wsg-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin:0 0 9px;border-radius:10px;border:1px solid var(--wb-border-subtle,#eee);background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 40%,transparent);font-size:11.5px;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.wsg-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:#bbb}',
      '.wsg-dot.on{background:#22c55e;box-shadow:0 0 0 3px color-mix(in srgb,#22c55e 20%,transparent)}',
      '.wsg-dot.warn{background:#f59e0b;box-shadow:0 0 0 3px color-mix(in srgb,#f59e0b 20%,transparent)}',
      '.wsg-name{font-weight:700;font-size:12px}',
      '.wsg-meta{font-size:11px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums}',
      '.wsg-meta b{color:var(--wb-color-text-primary,#1f1f1f);font-weight:650}',
      '.wsg-state{font-size:10.5px;color:var(--wb-icon-tertiary,#999)}',
      '.wsg-grow{flex:1 1 auto}',
      '.wsg-btn{appearance:none;border:1px solid var(--wb-border-subtle,#e5e5e5);background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 40%,transparent);color:inherit;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:border-color .13s,opacity .13s;flex:0 0 auto}',
      '.wsg-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--wb-color-text-primary,#1f1f1f) 24%,transparent)}',
      '.wsg-btn:disabled{opacity:.42;cursor:default}',
      '.wsg-btn.pri{background:color-mix(in srgb,#3b82f6 15%,transparent);border-color:color-mix(in srgb,#3b82f6 42%,transparent);color:#2563eb}',
      '.wsg-btn.danger{background:color-mix(in srgb,#ef4444 12%,transparent);border-color:color-mix(in srgb,#ef4444 34%,transparent);color:#dc2626}',
      '.wsg-err{padding:6px 10px;margin:0 0 9px;border-radius:9px;background:color-mix(in srgb,#ef4444 10%,transparent);color:#b91c1c;font-size:11px;flex:0 0 auto}',
      '#wsg-flash{font-size:11px;margin-left:6px}',
    ].join('\n');
    document.head.appendChild(el);
  }

  var paneEl = null;

  function view() {
    var gw = (S.st && S.st.gateways && S.st.gateways[0]) || null;
    var running = !!(gw && gw.running);
    var h = S.health;
    var alive = h ? Number(h.alive || 0) : 0;
    var total = h ? Number(h.total || 0) : 0;
    var port = (gw && gw.port) || '—';
    var panelUrl = 'http://127.0.0.1:' + port + '/panel/';

    // ⚠️ 刻意做成**一条**（不是原来的大卡片）：它挂在模型页顶部，高度直接吃掉
    //    模型列表的可见区域。整条约 40px，出错时才多一行。
    var o = [];
    o.push('<div class="wsg-strip">');
    o.push('<span class="wsg-dot' + (running ? (h ? ' on' : ' warn') : '') + '"></span>');
    o.push('<b class="wsg-name">统一网关</b>');
    o.push('<span class="wsg-meta">'
      + '<b>' + (total || '—') + '</b> 号池 · '
      + '<b>' + (total ? alive : '—') + '</b> 可用 · '
      + '<b>' + (h && h.models ? h.models : '—') + '</b> 模型</span>');
    o.push('<span class="wsg-state">' + (running ? (h ? '运行中' : '无响应') : '已停止') + '</span>');
    o.push('<span class="wsg-grow"></span>');
    o.push('<button class="wsg-btn pri" data-wsg="console" title="用系统浏览器打开 ' + esc(panelUrl) + '">控制台</button>');
    o.push('<button class="wsg-btn" data-wsg="refresh"' + (S.busy === 'load' ? ' disabled' : '') + '>刷新</button>');
    if (running) {
      o.push('<button class="wsg-btn" data-wsg="restart"' + (S.busy ? ' disabled' : '') + '>重启</button>');
      o.push('<button class="wsg-btn danger" data-wsg="stop"' + (S.busy ? ' disabled' : '') + '>停止</button>');
    } else {
      o.push('<button class="wsg-btn pri" data-wsg="start"' + (S.busy ? ' disabled' : '') + '>启动</button>');
    }
    o.push('</div>');

    if (S.err) o.push('<div class="wsg-err">' + esc(S.err) + '</div>');
    return o.join('');
  }

  function repaint() {
    if (!paneEl || !paneEl.isConnected) return;
    // ⚠️ 归属校验：paneEl 必须是「我这一版」建的。
    //   旧版实例残留时它会往自己那个 pane 写；若我们共用同一个节点，
    //   双方会互相覆盖（实测：旧实例的异步 load 回调在我 repaint 之后又把旧 markup 写回）。
    if (paneEl.getAttribute('data-wsg-rev') !== UI_REV) return;
    paneEl.innerHTML = view();
  }

  function load(force) {
    if (!force && S.lastAt && Date.now() - S.lastAt < 20000) return Promise.resolve();
    if (S.busy === 'load') return Promise.resolve();
    S.busy = 'load'; repaint();
    return api('/api/side-gateway/status').then(function (r) {
      S.st = r; S.health = r.health || null; S.err = ''; S.lastAt = Date.now();
    }, function (e) {
      S.err = String((e && e.message) || e);
    }).then(function () { S.busy = ''; repaint(); });
  }

  function act(name) {
    if (S.busy) return;
    S.busy = name; repaint();
    var call = name === 'probe'
      ? api('/api/side-gateway/probe', { method: 'POST', body: {} })
      : api('/api/side-gateway/action', { method: 'POST', body: { action: name } });
    call.then(function () { S.busy = ''; return load(true); }, function (e) {
      S.busy = ''; S.err = String((e && e.message) || e); repaint();
    });
  }

  function openConsole() {
    var gw = (S.st && S.st.gateways && S.st.gateways[0]) || null;
    var port = (gw && gw.port) || 0;
    if (!port) { S.err = '拿不到网关端口，先点「刷新」或「启动」'; repaint(); return; }
    var url = 'http://127.0.0.1:' + port + '/panel/';
    // 走 daemon 的 /api/open-url 用系统浏览器打开（Electron 里 window.open 不可靠）
    api('/api/open-url', { method: 'POST', body: { url: url } }).then(function () {
      // 打开成功（控制台本机免口令，打开就能用）
      S.err = '';
      repaint();
      toast('已用浏览器打开控制台');
    }, function () {
      // daemon 不支持/失败 ⇒ 退回 window.open
      try { window.open(url, '_blank'); } catch (_) { S.err = '打不开浏览器，手动访问 ' + url; repaint(); }
    });
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = document.getElementById('wsg-flash');
    // 提示条按需创建：repaint 会重建 innerHTML，所以每次找不到就地在条目尾部补一个
    if (!el && paneEl && paneEl.isConnected) {
      el = document.createElement('span');
      el.id = 'wsg-flash';
      el.style.transition = 'opacity .3s';
      var host = paneEl.querySelector('.wsg-strip') || paneEl;
      host.appendChild(el);
    }
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.color = bad ? '#dc2626' : '#16a34a';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 1900);
  }

  var bound = false;
  function bindPane(el) {
    if (bound) return;
    bound = true;
    el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var b = t.closest('[data-wsg]');
      if (!b) return;
      ev.preventDefault();
      var name = b.getAttribute('data-wsg');
      if (name === 'console') return openConsole();
      if (name === 'refresh') { S.lastAt = 0; return load(true); }
      act(name);
    });
  }

  var ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>';

  /** 面板里那份是不是**本版本**挂的（廉价判断，供 observer 提前退出与 disconnect 用）。
   *  ⚠️ 必须比对 UI_REV，不能只看存在性 —— 旧版留下的节点也「存在」。
   *  ⚠️ 每次改 UI 结构都要 +1：否则热更后新旧实例会共用同一个节点互相覆盖
   *     （旧实例没有 teardown，它的异步 load 回调会把旧 markup 写回来）。 */
  function mounted() {
    var mine = document.querySelector('[' + SLOT_ATTR + '][data-wsg-rev="' + UI_REV + '"]');
    // ⚠️ 三个条件缺一不可：节点存在 + 仍连着 DOM + 真的挂在 .wbs-model-card 里
    //    （官方重渲染会把卡片连根拔掉；只判断「存在」会留下一个游离节点自欺欺人）
    return !!(mine && mine.isConnected && mine.closest(HOST_CARD));
  }

  /**
   * 挂载 / 接管「模型」页顶部的网关卡片。
   *
   * ── 为什么不新建标签页 ───────────────────────────────────────────────
   * 原先网关是独立的一级标签，跟「模型」页相邻且职能重叠（都回答"哪个模型能用"），
   * 用户明确反馈"相近功能放到了不同的地方"。现在合成一页：网关卡是该页第一块。
   *
   * ── ⚠️⚠️ 「隔离旧节点」而不是「删掉重建」────────────────────────────
   * 上一版插件（引入 UI_REV 之前）**没有 teardown 钩子**，热更后它的闭包与
   * MutationObserver 都还活着，并且持有当时那个节点的引用。实测结果：
   *   · 把节点删了 → 旧实例的 mount() 立刻再造一个，两个实例抢同一位置
   *   · 复用同一个节点 → 旧实例的 repaint() 会把我画好的内容覆盖回旧版
   * 所以：**给旧实例留一个它自己的节点，但把它藏起来**。
   *   · 旧节点加 inline `display:none` ⇒ 永久不可见
   *   · 我新建自己的卡片（带 `data-wsg-rev` + slot 标记）
   *   · 旧实例的 selector 找的是它自己那个 ⇒ 永远找不到我的
   * ⇒ 一次性重启客户端后旧实例彻底消失。
   *
   * ── 旧版遗留的「网关」标签页要顺手清掉 ─────────────────────────────
   * 上一版自建过 `.wbs-tab[data-tab="sideapi"]` 和对应 pane，本版不再使用。
   * 不清理的话面板上会永远多一个点不动的空标签。
   */
  function mount() {
    ensureStyle();
    var panel = document.querySelector('.wbs-panel');
    if (!panel) return false;
    var body = panel.querySelector('.wbs-body');
    if (!body) return false;
    var pane = body.querySelector('.wbs-pane[data-pane="' + HOST_PANE + '"]');
    if (!pane) return false;        // 模型页还没建出来
    var host = pane.querySelector(HOST_CARD);
    if (!host) return false;        // 模型卡还没渲染出来（列向 flex 容器，见 HOST_CARD 注释）

    // ① 清理上一版自建的「网关」标签与它的 pane（本版不再需要）
    var oldTab = panel.querySelector('.wbs-tab[data-tab="sideapi"]');
    if (oldTab && oldTab.parentNode) {
      try { oldTab.parentNode.removeChild(oldTab); } catch (_) { }
    }
    var oldPanes = body.querySelectorAll('.wbs-pane[data-pane="sideapi"]');
    for (var q = 0; q < oldPanes.length; q++) {
      try { oldPanes[q].parentNode.removeChild(oldPanes[q]); } catch (_) { }
    }

    // ② 旧版卡片**直接删掉**（不是藏起来）。
    //    第 4 版把它们插在 `.wbs-pane`（横向 flex）里，即使 display:none 也还占着
    //    flex 的计算位置，模型卡仍可能被挤；而且它们已经是错误结构，没有保留价值。
    var stale = document.querySelectorAll('[' + SLOT_ATTR + ']');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].getAttribute('data-wsg-rev') !== UI_REV) {
        try { stale[i].parentNode.removeChild(stale[i]); } catch (_) { }
      }
    }

    // ③ 我的卡片：只认「带本版 rev」的那一个，永远排在模型卡最前面
    var card = host.querySelector('[' + SLOT_ATTR + '][data-wsg-rev="' + UI_REV + '"]');
    if (!card) {
      card = document.createElement('div');
      card.className = 'wsg-host';
      card.setAttribute(SLOT_ATTR, '1');
      card.setAttribute('data-wsg-rev', UI_REV);
    }
    if (host.firstChild !== card) host.insertBefore(card, host.firstChild);
    paneEl = card;
    bindPane(card);

    // 官方随时可能重渲染模型卡 ⇒ 挂上「补挂」观察者（只在 pane / 卡片上，不碰 body 子树）
    watchHost(pane, host);

    // 首次进入拉一次；之后交给 20 秒过期判定（见 poke）
    if (!S.st && !S.busy) load();
    // 立刻画一次：先画再拉数据，是「打开就有内容」的关键
    repaint();
    return true;
  }

  /* ── 补挂观察者 ──────────────────────────────────────────────────────
     面板里有多处会整体重建模型卡（切语言、重建 pane、刷新模型列表）。
     卡片被连根拔掉后，若没人补挂就永久消失（本轮实测：用户打开面板一看，
     模型页顶部空了）。
     ⚠️ 只观察 **pane 和模型卡的 childList**，不观察 body 子树、不监听 attributes
        ⇒ 聊天流式输出不会触发（那是旧版卡顿的真凶）。
     回调里先 mounted()：已挂载直接返回，不给自己的插入动作制造循环。 */
  var moPane = null, moPaneTarget = null;
  var moHost = null, moHostTarget = null;
  function watchHost(pane, host) {
    if (pane && pane !== moPaneTarget) {
      try { if (moPane) moPane.disconnect(); } catch (_) { }
      moPaneTarget = pane;
      try {
        moPane = new MutationObserver(function () { if (!mounted()) scheduleProbe(); });
        moPane.observe(pane, { childList: true });
      } catch (_) { }
    }
    if (host && host !== moHostTarget) {
      try { if (moHost) moHost.disconnect(); } catch (_) { }
      moHostTarget = host;
      try {
        moHost = new MutationObserver(function () { if (!mounted()) scheduleProbe(); });
        moHost.observe(host, { childList: true });
      } catch (_) { }
    }
  }

  /** 进入「模型」页时的轻量刷新（替代原来的 activate）。
   *  池状态是活的：超过 20 秒没有新数据才重拉，否则只重画。
   *  ⚠️ 不再接管 tab/pane 的 active 状态 —— 网关卡不再是独立标签，
   *     可见性完全由它所在的「模型」页决定，这里只管数据新鲜度。 */
  function poke() {
    if (!mounted()) { probe(); return; }
    if (!S.busy && (!S.lastAt || Date.now() - S.lastAt > 20000)) load();
    else repaint();
  }

  window.__wsg = { state: S, mount: mount, poke: poke, activate: poke };

  // ══════════════════════════════════════════════════════════════════
  // 挂载探测 —— 卡顿修复的核心就在这里
  //
  // 旧版：MutationObserver(documentElement, {subtree:true, attributes:true})
  //       ⇒ 聊天流式输出的每个 token 都触发回调，每次都排一次 mount 探测
  // 新版三条纪律：
  //   ① 只观察 body 的 childList（面板是 body 里新增的子树），不监听 attributes
  //   ② 回调里第一件事就是 mounted()：已挂载 → 立即 disconnect，永不回调
  //   ③ 探测本身放 requestIdleCallback，不跟渲染抢主线程
  // ══════════════════════════════════════════════════════════════════
  var mo = null;
  var moTimer = null;

  function idle(fn) {
    if (typeof window.requestIdleCallback === 'function') {
      try { return window.requestIdleCallback(fn, { timeout: 1200 }); } catch (_) { }
    }
    return setTimeout(fn, 200);
  }

  function probe() {
    moTimer = null;
    var ok = false;
    try { ok = mount(); } catch (_) { }
    if (ok) {
      // 已挂载：立刻停止观察，从此不再有任何回调开销
      try { if (mo) { mo.disconnect(); mo = null; } } catch (_) { }
      return true;
    }
    return false;
  }

  function scheduleProbe() {
    if (moTimer) return;
    moTimer = idle(probe);
  }

  // 首屏 + 几次兜底（面板打开较慢时）
  probe();
  setTimeout(function () { if (!mounted()) probe(); }, 1200);
  setTimeout(function () { if (!mounted()) probe(); }, 4000);

  try {
    mo = new MutationObserver(function () {
      // ② 已挂载就直接收摊 —— 这是与旧版最大的区别
      if (mounted()) {
        try { mo.disconnect(); mo = null; } catch (_) { }
        return;
      }
      scheduleProbe();
    });
    mo.observe(document.body, { childList: true });
  } catch (_) { }

  /* ── 卡片被面板重建后要补挂 ─────────────────────────────────────────
     面板里有几处会整体重建 `[data-pane="models"]` 的内容（切语言、改布局、
     重建 pane）。卡片跟着被销毁后，若没人补挂就永久消失。
     ⚠️ 绝不再为它常开 MutationObserver（那就是旧版卡顿的来源）。
     改为**只在模型页可见时**做一次极轻量检查：
       · 每 600ms 一次，且只在 `document.visibilityState === 'visible'` 时跑
       · 模型页不可见（`.wbs-pane[data-pane="models"]` 没有 active 或面板关闭）
         就直接跳过，零成本
       · 连续 40 次（约 24 秒）都没找到面板就自动停，不长期占定时器
     代价：可见且已挂载时，每次只是一次 querySelector，微秒级。 */
  var recheckTimer = null;
  var recheckLeft = 40;
  function recheckTick() {
    recheckTimer = null;
    if (document.visibilityState === 'hidden') { scheduleRecheck(); return; }
    var host = document.querySelector('.wbs-pane[data-pane="' + HOST_PANE + '"]');
    var visible = host && host.classList.contains('active');
    if (visible && !mounted()) {
      try { mount(); } catch (_) { }
    }
    if (visible && mounted()) { recheckLeft = 40; }   // 还在就重置计数，继续守着
    else if (--recheckLeft <= 0) { return; }           // 长期没机会 ⇒ 停
    scheduleRecheck();
  }
  function scheduleRecheck() {
    if (recheckTimer) return;
    recheckTimer = setTimeout(recheckTick, 600);
  }
  scheduleRecheck();

  /* ── 点标签即重新武装探测（2026-11-03 修「150 号池卡片经常消失」）──────────
     原逻辑：不在模型页就倒计时，40 次 × 600ms ≈ **24 秒后永久停摆**。
     典型场景正是用户实际遇到的：注入完成时人在别的页 ⇒ 24 秒后没人守着 ⇒
     之后每次点开模型页都没有卡片（「偶尔出现」= 恰好在那个窗口期内点开过）。
     现在用事件委托补一个「点击即重新武装」：一次点击一次，零常驻开销。 */
  var tabHook = function (ev) {
    var t = ev.target;
    while (t && t !== document && !(t.classList && t.classList.contains('wbs-tab'))) t = t.parentNode;
    if (!t || !t.classList || !t.classList.contains('wbs-tab')) return;
    if (t.getAttribute('data-tab') !== HOST_PANE) return;
    recheckLeft = 20;
    scheduleRecheck();
  };
  try { document.addEventListener('click', tabHook, true); } catch (_) { }

  /** 拆掉本实例（热更时由下一次注入调用）。 */
  function teardown() {
    try { if (mo) { mo.disconnect(); mo = null; } } catch (_) { }
    try { document.removeEventListener('click', tabHook, true); } catch (_) { }
    try { if (moTimer) { clearTimeout(moTimer); moTimer = null; } } catch (_) { }
    try { if (recheckTimer) { clearTimeout(recheckTimer); recheckTimer = null; } } catch (_) { }
    try { if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; } } catch (_) { }
    try {
      // 只删「我这一版」的卡片 + 上一版遗留的 sideapi 标签/pane
      var mine = document.querySelectorAll('[' + SLOT_ATTR + '="1"]');
      for (var i = 0; i < mine.length; i++) {
        if (mine[i].parentNode) mine[i].parentNode.removeChild(mine[i]);
      }
      var t = document.querySelector('.wbs-tab[data-tab="sideapi"]');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      var old = document.querySelectorAll('.wbs-pane[data-pane="sideapi"]');
      for (var j = 0; j < old.length; j++) {
        if (old[j].parentNode) old[j].parentNode.removeChild(old[j]);
      }
      var s = document.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (_) { }
    paneEl = null;
    bound = false;
    try { S.st = null; S.health = null; S.err = ''; S.busy = ''; S.lastAt = 0; } catch (_) { }
    window.__wsgUi = false;
  }
  window.__wsg.teardown = teardown;
  window.__wsgUi = true;
})();
