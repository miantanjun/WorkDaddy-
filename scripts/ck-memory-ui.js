/**
 * 记忆插件 —— 面板（前端 / 纯外挂 / 可剥离）
 * =====================================================================
 * 干什么：在设置面板里加一个「记忆」标签页，能看索引状态、搜历史原话、
 *   看时间线，也能开关 / 重建 / 清空。作用是把这套外置记忆从「命令行里
 *   的黑科技」变成看得见、管得着的一等功能。
 *
 * 为什么要自建标签页（而不是插卡片条）：
 *   记忆的管理内容不少（状态、搜索、结果列表、时间线、开关、危险操作），
 *   塞进一张卡片会挤成一团。标签页能放得开。
 *
 * ⚠️⚠️ 三个必须遵守的宿主约定（都是实测踩过的坑，改动前先读）：
 *   1. 官方给 .wbs-tab 绑 click 是在面板构建时**一次性**遍历绑定的
 *      （inject.js switchTab 附近），**后来插入的标签没有监听器 ⇒ 点不动**。
 *      所以本文件必须自己绑 click、自己切 .active。
 *   2. inject.js 是**全量重建式热更**：旧实例若没有 teardown 就还活着。
 *      所以文件开头先 teardown 旧实例，并用 data-ckm-rev 表版本，
 *      非本版节点一律清掉（只判「节点存在」会让面板永远停在旧 UI）。
 *   3. 官方面板会重建（切语言 / 重建 pane），我的 tab/pane 被拔掉后
 *      必须能自己补挂，否则会永久消失。
 *
 * 交互约束：transcript 原文是**不可信输入**，一律 textContent 渲染，
 *   任何地方都不许把正文拼进 innerHTML。
 */
(function () {
  'use strict';

  // ⚠️ 改这里必须 +1：热重注入靠版本戳区分新旧 pane，不 +1 会复用到旧的、面板停在旧逻辑上
  //   rev 4：多会话（会话下拉 / 跟踪 / 删除单会话索引）
  // ⚠️⚠️⚠️ 改 UI 结构必须 +1：热重注入时旧 pane 靠这个版本号隔离，
  //   不 +1 会出现「新旧两套按钮叠在一起」或「点了没反应」（旧 DOM 没被拆）。
  //   33：新增「事实」入口与事实卡片视图（阶段 4）
  //   42：2026-11-05 记忆页重构 —— 状态条改大字摘要 + 详情折叠表、
  //       三个开关收成「启用」总开关 + 高级折叠区、默认视图改为事实、底栏换管理入口
  var UI_REV = '44';   // 44: 高级里新增「自动清理临时文件」一行（回收 WorkBuddy 临时根里的历史浏览器 profile）
  var TAB = 'ckmemory';
  var PANE = 'ckmemory';
  var SLOT = 'data-ckm-slot';
  var API_BASE = '__WBS_API__';
  var API_TOKEN = '__WBS_API_TOKEN__';

  /* ── 拆掉上一版（热更时旧实例还在） ───────────────────────────────── */
  try { if (window.__ckm && typeof window.__ckm.teardown === 'function') window.__ckm.teardown(); } catch (_) {}

  // ⚠️⚠️ 旧版的 teardown 不一定会清定时器（REV≤2 就漏了 setInterval），
  //    所以这里再兜一刀：把上一代登记过的定时器全部杀掉，一个不留。
  try {
    (window.__ckmTimers || []).forEach(function (t) {
      try { clearInterval(t); } catch (_) {}
      try { clearTimeout(t); } catch (_) {}
    });
  } catch (_) {}
  window.__ckmTimers = [];
  function track(t) { window.__ckmTimers.push(t); return t; }

  // 状态挂 window：闭包会被热更换掉，状态不能跟着丢
  var S = window.__ckmState = window.__ckmState || {
    stat: null, mode: 'facts', q: '', hits: [], items: [], note: '',
    tlTotal: 0, busy: '', err: '', lastAt: 0,
    // 多会话：selSid 为空字符串 = 跟随「当前会话」（自动认最新写入的那条）
    sessions: [], list: null, selSid: '',
    // 搜索是否连「过程话（我的碎碎念 + 工具输出）」一起查。
    // 默认关：有效记忆已足够回答「当时怎么定的」；只有要找「到底跑过哪条命令 / 读过哪个文件」
    // 才需要打开 —— 那时过程话才是答案本身。
    deep: false,
    // 上一次搜索走的是哪条路径（AND / OR / LIKE）。
    // 后端按「AND 精确 → OR 放宽 → LIKE 字面兜底」三层回退，三者的可信度不一样，
    // 面板必须把它显示出来，否则「走兜底凑出来的 3 条」会被当成「搜得挺准」。
    via: '',
    // 拒答理由：判 ENG-MISS / ID-MISS 时后端会带上是哪几个词整库查无。
    // 空结果页必须靠它区分「库里没这个话题」和「关键词不匹配」——
    // 前者该放弃或换会话，后者该换个词。两句话都写「没找到」等于什么都没说。
    miss: [],
    // 记忆管理视图：true 时结果区换成「有记忆的会话清单 + 勾选删除」。
    // 为什么不放独立标签页：它是低频操作（清理用），做成标签会又占一格；
    // 但必须能一眼看到「哪些会话建了记忆、各占多少」，所以要有独立视图而不是藏在菜单里。
    mgr: false,
    picked: {},   // sid -> true，管理页里勾选待删的

    // ── 两个折叠区（2026-11-05 重构）──
    // adv    展开「高级」：三个子开关 + 运维三连
    // detail 展开「详情」：技术指标表
    //   ⚠️ 两者互斥（展开一个自动收起另一个）：面板最小 340px 高，
    //     两个都开着会把结果区压到 0 —— 那正是旧版「什么都看不见」的成因。
    adv: false, detail: false,

    // ── 临时文件清理（2026-11-09 新增）──
    // tsw    最近一次清理结果（后端 tempsweep.json 的回读：时间 / 删了几个目录 / 回收多少）
    // tswCfg 开关与天数
    // tswBusy 后端此刻正在跑清理（GET /tempsweep 的 busy 字段）
    //   ⚠️ 为什么要显示「上次清了什么」：这个功能一旦静默失效（比如临时根换路径、
    //     权限变了），表现跟「最近没垃圾」完全一样。没有这个数字就没法区分。
    tsw: null, tswCfg: null, tswBusy: false,

    // ── 自动注入（阶段 2）──
    // inj    最近一次注入的记录（后端 lastInject 的回读）
    // injCfg 注入相关配置（开关 / 条数 / 预算）
    // injOpen 是否展开「上次塞了什么」详情
    //   ⚠️ 为什么要有 inj：这个功能最典型的故障是「静默不生效」——
    //     用户在面板上打开了开关，但 hook 没挂上 / 会话没识别出来，表现跟「正常」完全一样。
    //     必须能看见最近一次的真实结果与原因码，否则没法排查。
    inj: null, injCfg: null, injOpen: false,

    // ── 事实层（阶段 4）──
    // facts  事实列表（当前会话或全局）
    // fstat  事实层统计（总数 / 有效 / 失效 / 今天新增 / 各类占比）
    // fq     事实页的搜索词（与原文搜索分开，两边口径不一样）
    // fexp   事实页是否显示「已失效」的（默认不显示 —— 那才是「现在为真」的口径）
    // flast  最近一次抽取的结果（成功与否、抽了几条、耗时）—— 这是排查「点了没反应」的唯一窗口
    facts: [], fstat: null, fq: '', fexp: false, flast: null,
    // ── 实体索引（阶段 5）──
    // fent      事实页是否切到「按实体」视图
    // ents      实体清单（原样 + 归一化 + 关联条数）
    // entPick   当前展开的是哪个实体（存 norm，不是原样 —— 归一化才是键）
    // entFacts  展开那个实体关联的事实
    // entLoading 加载中（清单与展开共用这一个标记：它们不会同时需要加载态）
    fent: false, ents: null, entPick: '', entFacts: [], entLoading: false,

    // ── 后台整理（阶段 6 后半段 · sleeptime）──
    // fcons    事实页是否切到「整理」视图
    // consCand 同义候选清单（**只读**，程序不改库，人点才合）
    // consHist 整理历史（每轮一个 runId，可回滚）
    // consOpen 展开的 runId（看那一轮改了哪几条）
    // consDet  那一轮的明细
    // consBusy 操作中
    fcons: false, consCand: null, consHist: null, consOpen: '', consDet: null, consBusy: '',
  };
  if (!S.sessions) S.sessions = [];
  if (S.selSid == null) S.selSid = '';
  // ⚠️⚠️⚠️ 热更时 S 是复用的（挂在 window.__ckmState 上），新增字段不会自动出现。
  //   上一次踩过的等价坑：新增 S.deep / S.fexp 时没兜底，
  //   结果是 `!S.deep` 恰好等于「默认关」、看起来碰巧正常，
  //   但 `S.deep = !S.deep` 会把 undefined 变成 true，第二次点击才回到预期 ——
  //   这种「碰巧能跑」最容易被误判成没问题。所以新增状态一律显式初始化。
  if (S.adv == null) S.adv = false;
  if (S.detail == null) S.detail = false;
  // ⚠️ mode 的兜底要单独想：热更前用户可能停在 timeline / search / recent。
  //   我们**不强行改回 facts**（那会把用户正在看的视图冲掉），
  //   只在「完全没有视图」时才落到 facts。
  if (!S.mode) S.mode = 'facts';

  var STYLE_ID = 'ckm-style';
  var paneEl = null;
  var built = false;
  var builtRev = '';   // 已搭好壳的版本；与 UI_REV 不同就整壳重建（事件处理器不能跨版本复用）

  /* ── 小工具 ─────────────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function num(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n);
  }
  function mb(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'X-WorkDaddy-Token': API_TOKEN }, cache: 'no-store' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API_BASE + path, init).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /* ── 样式 ───────────────────────────────────────────────────────── */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      // ⚠️⚠️⚠️ 外层 wrap 绝不能自己滚动。实测双层滚动（wrap 与 list 都是 overflow-y:auto）
      //   的问题：面板高度 ≤420px 时（面板可拖拽，最小 340px），wrap 内容高 313 而可视只有 256，
      //   底部「重建 / 清空」被挤出可视区 19px，必须滚整个 wrap 才找得到 —— 而用户看到的滚动条
      //   是 list 那条，根本不知道下面还藏着东西。
      //   正确结构：wrap 只做纵向排布且 overflow:hidden，唯一滚动容器是最下面的 .ckm-list。
      '.ckm-wrap{display:flex;flex-direction:column;height:100%;min-height:0;gap:8px;padding:2px 2px 0;overflow:hidden}',
      '.ckm-card{border:1px solid var(--wb-border-subtle,#eee);border-radius:12px;background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 40%,transparent)}',
      /* 状态条 */
      // ⚠️ 2026-11-05 重构：状态条从「横排一行塞两行小字」改成**纵向三段**。
      //    旧结构的问题（用户原话「我根本看不懂也不知道怎么用」）：
      //      行 1 一行 11px 灰字挤着「AI 在 xxx · 有效 653 条」，
      //      行 2 一行 10px 更灰的字排着 5 个内部实现指标；
      //      用户扫一眼分不清哪个数字是「记住了多少」、哪个是「废话有多少」。
      //    新结构：① 标题 + 总开关 + 详情（一行）
      //            ② 一句话摘要「已记住 7/79 个会话 · 1440 条有效记忆」
      //            ③ AI 在跟谁（真正影响 AI 行为的隐性状态）
      '.ckm-stat{display:flex;flex-direction:column;align-items:stretch;gap:3px;padding:7px 10px;flex:0 0 auto}',
      // 紧凑模式：面板高度 < 480px 时由 JS 给 .ckm-wrap 打 compact 标记，
      // 压缩各条带内边距，把像素让给结果列表（实测 340px 高时列表只剩 100px）
      '.ckm-wrap.compact{gap:6px}',
      // ⚠️⚠️ 面板最小高度是 340px，而「状态条 48 + 会话行 58 + 搜索行 47 + 底栏 33」= 186px 是固定成本，
      //   留给结果列表的只剩 26px —— 搜索出来一条都看不见。所以再设一档 tiny（<420px）：
      //   把会话行收起（当前会话是谁已经写在状态条第一行了），只保留搜索 + 结果 + 底栏。
      //   需要切会话时把面板拉高即可，不会丢功能。
      '.ckm-wrap.tiny{gap:3px}',
      '.ckm-wrap.tiny .ckm-srow{display:none}',
      // ⚠️⚠️⚠️ 340px 是面板**最小**高度，而宿主自己的标题 + 标签栏就吃掉 163px，
      //   留给 .ckm-wrap 的实测只有 177px。下面是逐项实测后的固定成本（700x340）：
      //     状态条 33 + 开关行 28 + 搜索行 39 + 底栏 27 + 间距 16 = 143 ⇒ 结果区只剩 34px。
      //   所以 tiny 档必须**逐项压到最小可辨认高度**，而不是只调一两个 padding：
      //     · 状态条藏掉「管理 / 索引一次」两个按钮（21px 的行高就是它们撑的），
      //       信息不受损 —— meta1 那一行「AI 在跟谁」还在，按钮拉高面板就回来。
      //     · 搜索框与按钮各降 1px padding、字号降到 10.5px。
      //     · 底栏上下 padding 归零。
      //   目标：340px 下结果区 ≥ 60px（够露出一张事实卡的标题 + 首行）。
      '.ckm-wrap.tiny .ckm-stat{padding:3px 8px}',
      '.ckm-wrap.tiny .ckm-stat .ckm-title{display:none}',
      /**
       * ⚠️⚠️⚠️ tiny 档藏按钮要**排除**「高级 / 详情」这两个。
       *
       * 旧规则是无条件 `.ckm-wrap.tiny .ckm-stat .ckm-btn{display:none}`，
       * 当年藏的是「管理 / 索引一次」—— 都是低频运维，藏掉不痛。
       * 但 2026-11-05 重构后，状态条里这两个按钮变成了**通往三个核心开关的唯一入口**：
       *   · 「高级」里是 自动带入记忆 / 自动提炼事实 / 索引一次 / 重建 / 清空；
       *   · 「详情」里是 11 项技术指标。
       * 一起藏掉的话，用户在最小高度下**永远关不掉「自动提炼事实」**——
       * 而那恰好是唯一会花额度的功能。实测 340px 截图确认这两个按钮消失了。
       *
       * ⚠️ 藏掉它们也省不了高度：它们和「启用」在同一行（stat-h），
       *   行高由 21px 的按钮撑着，藏掉一个按钮行高不会变，
       *   反而空出右边一大片。所以这里改为「只藏除它们以外的按钮」。
       */
      '.ckm-wrap.tiny .ckm-stat .ckm-btn:not([data-adv]):not([data-detail]){display:none}',
      '.ckm-wrap.tiny .ckm-bar{padding:3px 5px;gap:4px}',
      '.ckm-wrap.tiny .ckm-input{padding:3px 6px;font-size:10.5px}',
      '.ckm-wrap.tiny .ckm-bar .ckm-btn{padding:2px 5px;font-size:10px}',
      '.ckm-wrap.tiny .ckm-seg{gap:3px}',
      // ⭐⭐ tiny 档底栏**整条让出**（实测省 24~27px，结果区 48 → 75px）。
      //   底栏三样东西都不丢信息：
      //     · 「自动索引」→ 状态条圆点已经表达（绿=正常 / 黄=已暂停，title 有原因）；
      //     · 「重建 / 清空」→ 低频运维，而且「清空」放在一个 177px 高、要滚动的小区域里
      //       误触风险最高。面板拉高到 ≥420px 立刻回来，不是永久消失。
      '.ckm-wrap.tiny .ckm-foot{display:none}',
      // ⚠️ 事实页的统计条同理让位：它回答的是「一共多少条」，而 340px 下
      //   用户要的是「搜出来那条在哪」。条数在状态条 meta 里仍可见（factLive）。
      '.ckm-wrap.tiny .ckm-fact-head{display:none}',
      '.ckm-wrap.tiny .ckm-fact-ops{padding:0 2px 2px;gap:4px}',
      // 事实页自己的搜索框在 tiny 档让位：顶部那条搜索行已经在了，
      //   两个输入框在 177px 里会挤掉全部结果。需要搜事实时把面板拉高即可。
      '.ckm-wrap.tiny .ckm-fact-q{display:none}',
      '.ckm-wrap.tiny .ckm-chk{font-size:10px}',
      '.ckm-wrap.tiny .ckm-empty{padding:8px 8px}',
      '.ckm-wrap.compact .ckm-stat{padding:5px 8px}',
      // ⚠️ tiny 档的「大字摘要」必须压一点字号：
      //   12px + 一行「AI 正在用 xxx」= 73px，而整条状态条在 177px 里只该占 45~50px。
      //   压缩后 340px 下结果区能多出约 10px（实测 60 → 70）。
      //   ⚠️ 只压字号与行高，**不藏**第 3 行「AI 正在用谁」—— 那是最不能省的隐性状态。
      '.ckm-wrap.tiny .ckm-big{font-size:11px;line-height:1.35}',
      '.ckm-wrap.tiny .ckm-big>b{font-size:12px}',
      '.ckm-wrap.tiny .ckm-meta1{font-size:10px;line-height:1.35}',
      '.ckm-wrap.tiny .ckm-stat-h{gap:5px}',
      '.ckm-wrap.compact .ckm-srow{padding:6px 8px}',
      '.ckm-wrap.compact .ckm-bar{padding:6px 8px}',
      '.ckm-wrap.compact .ckm-foot{padding:5px 2px 0}',
      '.ckm-wrap.compact .ckm-empty{padding:14px 10px}',
      /* ── 超矮面板（<470px）下的压缩规则 ──
       * ⚠️ 2026-11-05 重构后，原来的「两行开关卡」结构没了（已收进「高级」折叠区），
       *   所以旧的 .ckm-inj-row / .ckm-fx-row / .ckm-sw 那一整套规则全部删除。
       *   新结构在矮面板下靠**折叠区本身**省空间：
       *     · 「高级」「详情」默认都收起 ⇒ 少 3~4 行；
       *     · 真要展开时结果区被压是预期内的（用户主动要求看数字），
       *       但仍要保证结果区至少留一行，所以这里只压内边距、不藏内容。
       *   ⚠️ 旧的 `.ckm-sw{display:contents}` 一定要删：新结构里没有 .ckm-sw，
       *     留着是死代码；更糟的是如果有人把新卡片塞进 .ckm-sw，
       *     display:contents 会让它的 .ckm-card 边框样式整个消失。
       */
      '.ckm-wrap.compact .ckm-fact-head{padding:0 2px 3px}',
      '.ckm-wrap.compact .ckm-fact-sub{display:none}',
      '.ckm-wrap.compact .ckm-fact-ops{padding:0 2px 5px}',
      '.ckm-wrap.compact .ckm-fact{padding:5px 8px;margin-bottom:4px}',
      '.ckm-wrap.compact .ckm-adv-row{padding:4px 8px}',
      '.ckm-wrap.compact .ckm-detail{padding-top:3px}',
      '.ckm-wrap.tiny .ckm-mgr-s{display:none}',
      '.ckm-stat-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
      /* ── 2026-11-05 重构：状态条的三段式 ──
       *   第 1 行 stat-h：圆点 + 标题 + 总开关 + 详情按钮
       *   第 2 行 big   ：一句话说清「记住了多少」（全页最重要的一句）
       *   第 3 行 meta1 ：AI 正在用哪条会话
       *   第 4 行 detail：技术指标（默认收起，点「详情」才展开）
       */
      '.ckm-stat-h{display:flex;align-items:center;gap:7px;min-width:0;flex:0 0 auto}',
      // 总开关必须是**开关的样子**，不能是普通 checkbox 标签 —— 它是这一页的主控。
      '.ckm-en{flex:0 0 auto;font-size:11px;font-weight:650;padding:2px 7px 2px 4px;border-radius:7px;border:1px solid color-mix(in srgb,var(--wb-border-subtle,#e5e5e5) 100%,transparent);cursor:pointer}',
      '.ckm-en:hover{border-color:color-mix(in srgb,#22c55e 42%,transparent)}',
      '.ckm-en input{margin:0}',
      // 大字摘要：整页的「结论」。数字用主色加粗，量词用灰细字。
      // ⚠️ 允许换行（white-space:normal）—— 面板最窄 340px 时「已记住 7/79 个会话 · 1440 条有效记忆」
      //   单行要 300px，加上两侧 padding 与按钮就溢出，截断后只剩「已记住 7/79 个会话 · 14…」，
      //   正好把最关键的条数截掉。换行占两行也比截掉强。
      '.ckm-big{font-size:12px;font-weight:650;color:var(--wb-icon-secondary,#666);font-variant-numeric:tabular-nums;line-height:1.45;word-break:break-word}',
      '.ckm-big>b{font-size:13.5px;font-weight:750;color:#1d4ed8}',
      '.ckm-big i{font-style:normal;color:var(--wb-icon-tertiary,#999);font-weight:500}',
      // 新增的「另有 N 条…」说明行：必须**独占一行**，否则会和上面的条数挤成一段。
      // ⚠️ 它是 <i>（.ckm-big i 已有样式），这里只负责换行 + 再压小一号 ——
      //   用户在 main 数字下面瞄一眼的解释，不该和主数字抢字号。
      '.ckm-big .ckm-note{display:block;font-size:10.5px;color:var(--wb-icon-tertiary,#8a8a8a);font-weight:500;margin-top:1px;line-height:1.4}',
      // tiny 档（面板矮于 420px）：主数字已经缩到 11px，说明行再缩就糊了 —— 保持 10px 并限两行。
      '.ckm-wrap.tiny .ckm-big .ckm-note{font-size:10px}',
      // ── 详情折叠区：技术指标。键 / 值 / 大白话 三列，展开才占地方 ──
      '.ckm-detail{display:grid;grid-template-columns:auto auto 1fr;gap:1px 8px;align-items:baseline;padding-top:5px;margin-top:2px;border-top:1px dashed color-mix(in srgb,var(--wb-border-subtle,#e5e5e5) 90%,transparent);flex:0 0 auto}',
      '.ckm-detail[hidden]{display:none}',
      '.ckm-dk{font-size:10px;color:var(--wb-icon-tertiary,#999);white-space:nowrap}',
      '.ckm-dv{font-size:10.5px;font-weight:700;color:var(--wb-color-text-primary,#1f1f1f);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}',
      // 大白话：**直接写在行里**，不用 hover 才看得见。
      // ⚠️ 用户明确要求「展开后鼠标移动上去后显示大白话解释」，但实测只靠 title
      //   有个硬伤：触屏 / 初次使用者根本不会去 hover。所以两件都做 ——
      //   行内给一句最短的定性（10px 灰字），title 里再给完整版（含例外与注意）。
      '.ckm-dw{font-size:10px;color:var(--wb-icon-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help}',
      '.ckm-dw:hover{color:var(--wb-icon-secondary,#666)}',
      // ── 高级设置折叠区：两个子开关 + 索引一次 ──
      // ⚠️⚠️⚠️ 这条只能定义**一次**。这里曾经写了两份（一份只管布局、
      //   一份补 overflow:visible），靠书写顺序叠加。后果：
      //   ① 单测用正则抓这条规则的声明块时只抓到第一份，看不到 overflow，
      //      于是「注入框不能被裁」这条守卫**假失败** —— 其实是它抓错了规则
      //      （连注释里写的字面量都会被regexp 抓到，所以注释里也别照抄选择器）；
      //   ② 更要紧的是合并时只要顺序颠倒一次，overflow:visible 就会被吃掉，
      //      而 CSS 是静默的，不会报任何错。所以合成一条，把关键属性写在一起。
      '.ckm-adv{display:flex;flex-direction:column;gap:0;padding:0;flex:0 0 auto;overflow:visible}',
      '.ckm-adv[hidden]{display:none}',
      '.ckm-adv-row{display:flex;align-items:center;gap:6px;padding:6px 8px;min-width:0;border-top:1px dashed color-mix(in srgb,var(--wb-border-subtle,#e5e5e5) 70%,transparent)}',
      '.ckm-adv-row:first-child{border-top:0}',
      '.ckm-adv-meta{font-size:10px;color:var(--wb-icon-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}',
      // 第一行：AI 在跟谁（主信息，单行省略但字号略大）
      '.ckm-meta1{font-size:11px;color:var(--wb-icon-secondary,#666);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px;min-width:0}',
      '.ckm-meta1>b{flex:0 0 auto}',
      // 第二行：AI 正在用哪条会话（次级信息，更淡）
      // ⚠️ `.ckm-meta2` 已废弃（2026-11-05 重构）：那 5 个内部指标徽标全搬进「详情」折叠表了。
      //   保留这条定义只是为了热更时旧 DOM 不塌，新代码不再创建它。
      '.ckm-meta2{font-size:10px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:4px 9px;flex-wrap:wrap;min-width:0}',
      '.ckm-meta2>span{flex:0 0 auto}',
      // 状态条里的小徽标：重复合并 / 忽略续跑 / 跟踪 / 面板在看
      '.ckm-chip{flex:0 0 auto;white-space:nowrap;font-size:9.5px;font-weight:600;padding:0 5px;border-radius:5px;line-height:15px;background:color-mix(in srgb,var(--wb-icon-tertiary,#999) 12%,transparent);color:var(--wb-icon-secondary,#666)}',
      // ── 自动注入区块（阶段 2）──
      // ⚠️ 2026-11-05：`.ckm-inj` / `.ckm-fx` / `.ckm-inj-row` / `.ckm-fx-row` 已废弃。
      //   两张独立开关卡合并进「高级」折叠区后，行容器统一用 `.ckm-adv-row`。
      //   下面只保留「上次带了什么」展开框与徽标所需的样式。
      //   ⚠️ 但 `.ckm-inj` 那条 `overflow:visible` 的结论必须继承下来：
      //     展开框 `.ckm-inj-box` 现在挂在 `.ckm-adv` 里，而 `.ckm-adv` 也不能 overflow:hidden，
      //     否则上一版那个「三条记录被整块裁掉、只剩一行标题」的坑会原地复活。
      // ⚠️⚠️⚠️ `.ckm-adv` 的 overflow 已并入上面那条唯一定义（见「高级设置折叠区」注释）。
      //   这里绝对不能重复声明同一条规则 —— CSS 不报错，但单测的正则会抓错，
      //   而且真正的 overflow:visible 会被后写的一条悄悄覆盖掉。
      '.ckm-inj-box{border-top:1px solid color-mix(in srgb,var(--wb-border-subtle,#e5e5e5) 70%,transparent);padding:6px 8px;max-height:190px;overflow-y:auto;font-size:10.5px;line-height:1.5}',
      '.ckm-inj-head{color:var(--wb-icon-secondary,#666);margin-bottom:4px;word-break:break-all}',
      '.ckm-inj-empty{color:var(--wb-icon-tertiary,#999);padding:2px 0}',
      '.ckm-inj-item{display:flex;gap:5px;padding:3px 0;align-items:flex-start;border-top:1px dashed color-mix(in srgb,var(--wb-border-subtle,#e5e5e5) 55%,transparent)}',
      '.ckm-inj-item:first-of-type{border-top:0}',
      '.ckm-inj-tag{flex:0 0 auto;font-size:9px;font-weight:700;padding:0 4px;border-radius:4px;line-height:14px;background:color-mix(in srgb,#3b82f6 14%,transparent);color:#2563eb;white-space:nowrap}',
      '.ckm-inj-txt{flex:1 1 auto;min-width:0;color:var(--wb-color-text-primary,#1f1f1f);word-break:break-word}',
      '.ckm-chip-warn{background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}',
      // ⚠️ 面板最窄 340~400px 时，标题 + 两个按钮就吃掉 116px，正文只剩 ~180px。
      //   窄档让正文允许换行（宁可占两行高，也不要截掉数字），
      //   同时藏掉「记忆」两字标题（圆点 + 总开关本身已能说明这是什么）。
      '.ckm-stat .ckm-btn{padding:4px 7px}',
      '.ckm-narrow .ckm-title{display:none}',
      '.ckm-narrow .ckm-meta1{white-space:normal;line-height:1.45;flex-wrap:wrap;gap:3px}',
      '.ckm-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:#bbb}',
      '.ckm-dot.on{background:#22c55e;box-shadow:0 0 0 3px color-mix(in srgb,#22c55e 20%,transparent)}',
      '.ckm-dot.off{background:#f59e0b;box-shadow:0 0 0 3px color-mix(in srgb,#f59e0b 20%,transparent)}',
      '.ckm-title{font-weight:700;font-size:12.5px;flex:0 0 auto}',
      /* ⚠️ 状态条必须单行省略：面板被拖矮时（实测 380×340）多行状态会挤掉整个结果区，
         表现为「搜索有结果但一条都看不见」。全文放在 title 里。 */
      // 旧单行 meta 只在极旧热更残留里会用，保留兼容但不再由本版创建
      '.ckm-meta{font-size:11px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ckm-meta b{color:var(--wb-color-text-primary,#1f1f1f);font-weight:650}',
      '.ckm-grow{flex:1 1 auto}',
      // ⚠️⚠️⚠️ 这条旧规则必须删掉：`.ckm-stat .ckm-grow{display:none}`。
      //   它是为「状态条是一行横排、标题后面不需要撑开」写的。
      //   2026-11-05 重构后状态条第一行是 `圆点 标题 [grow] 高级 详情`，
      //   grow 的作用就是把两个按钮推到右边；一旦 display:none，
      //   两个按钮会紧贴「启用」开关，右侧留一大片空白 —— 实测截图确认。
      //   这就是「旧 CSS 覆盖新结构」的典型案例：样式不报错、布局就是不对。
      /* 按钮 */
      '.ckm-btn{appearance:none;border:1px solid var(--wb-border-subtle,#e5e5e5);background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 40%,transparent);color:inherit;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;flex:0 0 auto}',
      '.ckm-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--wb-color-text-primary,#1f1f1f) 24%,transparent)}',
      '.ckm-btn:disabled{opacity:.42;cursor:default}',
      '.ckm-btn.pri{background:color-mix(in srgb,#3b82f6 15%,transparent);border-color:color-mix(in srgb,#3b82f6 42%,transparent);color:#2563eb}',
      '.ckm-btn.danger{background:color-mix(in srgb,#ef4444 10%,transparent);border-color:color-mix(in srgb,#ef4444 32%,transparent);color:#dc2626}',
      /* 搜索行 */
      '.ckm-bar{display:flex;align-items:center;gap:7px;padding:8px 10px;flex:0 0 auto}',
      '.ckm-input{flex:1 1 auto;min-width:0;border:1px solid var(--wb-border-default,#e5e5e5);background:var(--wb-bg-input,#fff);color:inherit;border-radius:8px;padding:6px 9px;font-size:11.5px;font-family:inherit;outline:none}',
      '.ckm-input:focus{border-color:color-mix(in srgb,#3b82f6 55%,transparent)}',
      /* 会话选择行 */
      '.ckm-srow{display:flex;align-items:center;gap:7px;padding:8px 10px;flex:0 0 auto}',
      '.ckm-sel{flex:1 1 auto;min-width:0;border:1px solid var(--wb-border-default,#e5e5e5);background:var(--wb-bg-input,#fff);color:inherit;border-radius:8px;padding:5px 7px;font-size:11.5px;font-family:inherit;outline:none;cursor:pointer}',
      '.ckm-sel:focus{border-color:color-mix(in srgb,#3b82f6 55%,transparent)}',
      // 会话选择器：搜索输入 + 结果列表（替代原生 <select>）
      // ⚠️ 原生 select 在 100+ 条会话、标题又长的情况下完全没法用：
      //    不能搜、看不出大小、选项挤成一行。这里改成「点开 → 输入框 + 列表」。
      '.ckm-pick{position:relative;flex:1 1 auto;min-width:0}',
      // 触发器用两行：第一行标题（可省略），第二行元信息。单行塞不下「标题+大小+条数」
      '.ckm-trig{width:100%;display:flex;flex-direction:column;gap:1px;text-align:left;border:1px solid var(--wb-border-default,#e5e5e5);background:var(--wb-bg-input,#fff);color:inherit;border-radius:8px;padding:5px 26px 5px 8px;font-size:11.5px;font-family:inherit;cursor:pointer;outline:none;position:relative}',
      // ⭐ 2026-11-05：右侧加一个下拉箭头。
      //   ⚠️ 这是「它到底能不能点」的核心视觉线索。旧版触发器长得和普通卡片标题一模一样
      //   （同一个圆角 + 同样的灰色边框 + 同样的两行字），用户的原话是
      //   「这个『整理画册 96f77df6 · 57.63MB』看起来像个标题，我不知道能点」。
      //   用 ::after 而不是塞一个 SVG 节点：不占布局、不会被 syncSessionBar 重写文字时冲掉。
      '.ckm-trig::after{content:"";position:absolute;right:9px;top:50%;width:6px;height:6px;margin-top:-5px;border-right:1.6px solid var(--wb-icon-tertiary,#999);border-bottom:1.6px solid var(--wb-icon-tertiary,#999);transform:rotate(45deg);pointer-events:none}',
      '.ckm-trig:hover{border-color:color-mix(in srgb,#3b82f6 40%,transparent)}',
      '.ckm-trig:hover::after{border-color:#3b82f6}',
      '.ckm-trig-t{display:block;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
      '.ckm-trig-s{display:block;font-size:9.5px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // ⚠️⚠️⚠️ 弹层必须是 fixed 定位、且挂在 document.body 上，不能用 absolute 挂在 pane 里。
      //   实测：pane 只有 185px 高且自身 overflow 裁切，absolute 弹层再高也会被切成一条缝，
      //   用户根本看不到列表（截图证实只露出一行）。fixed 用视口坐标，彻底绕开祖先裁剪。
      // ⚠️⚠️⚠️ 颜色必须显式成对给（背景 + 前景），不能只给背景靠继承。
      //   实测：弹层挂到 body 后脱离了面板的 --wb-* 变量作用域，
      //   --wb-bg-elevated 拿不到 ⇒ 退化成 rgb(60,60,60) 深灰背景，
      //   而文字继承来的是 rgb(59,59,59) ⇒ 灰底灰字，标题整个看不见。
      '.ckm-pop{position:fixed;z-index:9999;border:1px solid #d9d9d9;border-radius:10px;background:#fff;color:#1f1f1f;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:6px;display:flex;flex-direction:column;gap:5px;max-height:280px}',
      '.ckm-pop[hidden]{display:none}',
      '.ckm-pop-q{width:100%;box-sizing:border-box;border:1px solid #e3e3e3;background:#fff;color:#1f1f1f;border-radius:7px;padding:5px 8px;font-size:11.5px;font-family:inherit;outline:none}',
      '.ckm-pop-q:focus{border-color:color-mix(in srgb,#3b82f6 55%,transparent)}',
      '.ckm-pop-list{overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:1px}',
      '.ckm-opt{display:flex;flex-direction:column;gap:1px;padding:5px 7px;border-radius:7px;cursor:pointer;border:1px solid transparent;color:#1f1f1f}',
      '.ckm-opt:hover{background:#eef4ff}',
      '.ckm-opt.cur{border-color:#86c99b;background:#eefaf1}',
      '.ckm-opt-t{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden}',
      '.ckm-opt-n{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.ckm-opt-s{font-size:9.5px;color:#8a8a8a;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ckm-opt-b{font-size:9px;font-weight:700;padding:0 4px;border-radius:4px;flex:0 0 auto}',
      '.ckm-opt-b.f{background:#dcf5e4;color:#15803d}',
      '.ckm-opt-b.n{background:#fdf0d8;color:#b45309}',
      '.ckm-pop-empty{padding:12px;text-align:center;font-size:11px;color:#8a8a8a}',
      // ── 记忆管理视图 ──
      // ⚠️ 这里的颜色一律走 var(--wb-*)，因为管理页挂在 pane 内部（不是 body 上的弹层），
      //   主题变量在作用域内是可用的；写成硬编码会在浅色主题下变成黑底黑字。
      '.ckm-mgr-head{display:flex;align-items:baseline;gap:8px;padding:2px 2px 6px;flex:0 0 auto}',
      '.ckm-mgr-title{font-size:11.5px;font-weight:650;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.ckm-mgr-sel{font-size:10px;font-weight:700;color:#15803d;background:#dcf5e4;border-radius:5px;padding:0 5px;line-height:15px}',
      '.ckm-mgr-ops{display:flex;gap:6px;padding:0 2px 7px;flex:0 0 auto;flex-wrap:wrap}',
      '.ckm-mgr-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid var(--wb-border-default,#e5e5e5);background:var(--wb-bg-input,#fff);margin-bottom:5px;flex:0 0 auto}',
      '.ckm-mgr-row.on{border-color:color-mix(in srgb,#3b82f6 45%,transparent);background:color-mix(in srgb,#3b82f6 6%,transparent)}',
      '.ckm-mgr-cb{flex:0 0 auto;margin:0;cursor:pointer}',
      '.ckm-mgr-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.ckm-mgr-t{font-size:11.5px;font-weight:600;color:var(--wb-color-text-primary,#1f1f1f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ckm-mgr-s{font-size:9.5px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ckm-mgr-row .ckm-btn{flex:0 0 auto;padding:3px 7px;font-size:10.5px}',
      '.ckm-pop-empty{padding:12px;text-align:center;font-size:11px;color:#8a8a8a}',
      '.ckm-pop-foot{display:flex;align-items:center;gap:6px;padding-top:5px;border-top:1px solid #eee;flex:0 0 auto}',
      '.ckm-pop-foot .ckm-hint{margin-left:auto}',
      '.ckm-hint{font-size:10px;color:var(--wb-icon-tertiary,#999);flex:0 0 auto}',
      '.ckm-btn.on{background:color-mix(in srgb,#22c55e 14%,transparent);border-color:color-mix(in srgb,#22c55e 40%,transparent);color:#15803d}',
      '.ckm-seg{display:flex;gap:4px;flex:0 0 auto}',
      '.ckm-seg .ckm-btn.on{background:color-mix(in srgb,var(--wb-color-text-primary,#1f1f1f) 10%,transparent);border-color:color-mix(in srgb,var(--wb-color-text-primary,#1f1f1f) 26%,transparent)}',
      /* 结果区 */
      // min-height 从 100px 改为 0：100px 在矮面板里会顶住 wrap，把底部按钮挤出去。
      // 太矮时由 .ckm-list 自身滚动承担，不会挤压兄弟节点。
      '.ckm-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 4px;overscroll-behavior:contain}',
      '.ckm-hit{border:1px solid var(--wb-border-subtle,#f0f0f0);border-radius:10px;padding:8px 10px;margin-bottom:7px;background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 30%,transparent)}',
      '.ckm-hit-top{display:flex;align-items:center;gap:6px;margin-bottom:4px}',
      '.ckm-tag{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,#3b82f6 12%,transparent);color:#2563eb;flex:0 0 auto}',
      '.ckm-tag.tool{background:color-mix(in srgb,#8b5cf6 12%,transparent);color:#7c3aed}',
      '.ckm-tag.user{background:color-mix(in srgb,#22c55e 14%,transparent);color:#15803d}',
      '.ckm-time{font-size:10px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums}',
      /* 「同一句话说过 N 次」的徽标：折叠后只剩一行，信息不能丢 */
      '.ckm-dup{font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309;flex:0 0 auto}',
      // 阶段 3：命中项的「多久没被用到」。中性灰，不抢正文注意力；
      // ⚠️ 显式 hex，因为面板可能挂在 body 之外拿不到 --wb-* 变量（踩过灰底灰字）。
      '.ckm-hitn{font-size:9.5px;font-weight:600;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,#64748b 12%,transparent);color:#475569;flex:0 0 auto;white-space:nowrap}',
      /* ── 事实层（阶段 4）──
       * ⚠️ 这些卡片挂在 pane 内部（不是 body 弹层），所以 var(--wb-*) 可用；
       *   但前景色一律写显式 hex —— 面板主题切换时 var 拿不到值会变成灰底灰字。
       */
      '.ckm-fact-head{padding:2px 2px 5px;flex:0 0 auto}',
      '.ckm-fact-h{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}',
      '.ckm-fact-n{font-size:17px;font-weight:700;color:#1d4ed8;font-variant-numeric:tabular-nums;line-height:1.1}',
      '.ckm-fact-l{font-size:11px;font-weight:600;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.ckm-fact-s{font-size:9.5px;font-weight:600;color:#b45309;background:color-mix(in srgb,#f59e0b 13%,transparent);border-radius:5px;padding:1px 5px;cursor:help}',
      '.ckm-fact-sub{font-size:9.5px;color:var(--wb-icon-tertiary,#999);margin-top:2px;font-variant-numeric:tabular-nums}',
      '.ckm-fact-ops{display:flex;align-items:center;gap:5px;padding:0 2px 7px;flex:0 0 auto}',
      '.ckm-fact-q{flex:1 1 auto;min-width:0;font-size:11px;padding:3px 7px;border-radius:6px;' +
        'border:1px solid var(--wb-border-default,#ddd);background:var(--wb-bg-input,#fff);' +
        'color:var(--wb-color-text-primary,#1f1f1f);outline:none}',
      '.ckm-fact{border:1px solid var(--wb-border-subtle,#f0f0f0);border-radius:10px;padding:7px 9px;margin-bottom:6px;background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 30%,transparent)}',
      '.ckm-fact.off{opacity:.55;border-style:dashed}',
      '.ckm-fact-top{display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap}',
      '.ckm-fact-k{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;flex:0 0 auto;white-space:nowrap}',
      '.ckm-fact-k.k-order{background:color-mix(in srgb,#3b82f6 14%,transparent);color:#1d4ed8}',
      '.ckm-fact-k.k-money{background:color-mix(in srgb,#22c55e 15%,transparent);color:#15803d}',
      '.ckm-fact-k.k-shipment{background:color-mix(in srgb,#06b6d4 15%,transparent);color:#0e7490}',
      '.ckm-fact-k.k-party{background:color-mix(in srgb,#a855f7 14%,transparent);color:#7e22ce}',
      '.ckm-fact-k.k-tech{background:color-mix(in srgb,#64748b 14%,transparent);color:#475569}',
      '.ckm-fact-k.k-decision{background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}',
      '.ckm-fact-k.k-contact{background:color-mix(in srgb,#ec4899 13%,transparent);color:#be185d}',
      '.ckm-fact-k.k-other{background:color-mix(in srgb,#94a3b8 14%,transparent);color:#475569}',
      '.ckm-fact-t{font-size:9.5px;color:var(--wb-icon-tertiary,#999);font-variant-numeric:tabular-nums;flex:0 0 auto}',
      '.ckm-fact-bad{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,#ef4444 12%,transparent);color:#b91c1c;flex:0 0 auto;white-space:nowrap}',
      '.ckm-fact-ex{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,#0ea5e9 15%,transparent);color:#0369a1;flex:0 0 auto;white-space:nowrap}',
      '.ckm-fact-text{font-size:11.5px;line-height:1.55;word-break:break-word;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.ckm-fact-foot{display:flex;align-items:center;gap:4px;margin-top:5px;padding-top:4px;border-top:1px dashed var(--wb-border-subtle,#eee)}',
      '.ckm-fact-src{font-size:9.5px;padding:1px 6px;border-radius:5px;cursor:pointer;flex:0 0 auto;' +
        'border:1px solid var(--wb-border-default,#ddd);background:transparent;color:var(--wb-icon-secondary,#666)}',
      '.ckm-fact-src:hover{color:#1d4ed8;border-color:color-mix(in srgb,#3b82f6 40%,transparent)}',
      '.ckm-fact-m{font-size:9px;color:var(--wb-icon-tertiary,#999);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ckm-fact-sp{flex:1 1 auto;min-width:0}',
      /* ── 实体视图（阶段 5）──
       * ⚠️ 实体清单是**按钮列表**而不是流式标签：每个实体要同时显示名字和关联条数，
       *   流式标签在 340~700px 宽度里会把名字截断（单号被截一半就认不出来了）。
       *   竖排一行一个，宽度够，名字能完整显示。
       */
      '.ckm-ent-list{display:flex;flex-direction:column;gap:3px;padding:0 2px}',
      '.ckm-ent{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;' +
        'padding:4px 8px;border-radius:7px;cursor:pointer;text-align:left;font-family:inherit;' +
        'border:1px solid var(--wb-border-subtle,#eee);' +
        'background:color-mix(in srgb,var(--wb-bg-secondary,#fff) 30%,transparent);color:inherit}',
      '.ckm-ent:hover{border-color:color-mix(in srgb,#3b82f6 35%,transparent)}',
      '.ckm-ent.on{background:color-mix(in srgb,#3b82f6 11%,transparent);border-color:color-mix(in srgb,#3b82f6 42%,transparent)}',
      // ⚠️ 实体名必须允许任意位置断行：长单号（YKW-SU-260713-REV2）在窄面板里
      //   不加 word-break 会直接溢出容器，右侧的条数徽标被推出可视区。
      '.ckm-ent-t{flex:1 1 auto;min-width:0;font-size:11px;font-family:ui-monospace,Consolas,monospace;' +
        'word-break:break-all;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.ckm-ent-n{flex:0 0 auto;font-size:9.5px;font-weight:700;padding:0 5px;border-radius:5px;' +
        'line-height:15px;background:color-mix(in srgb,#64748b 14%,transparent);color:#475569;' +
        'font-variant-numeric:tabular-nums}',
      // 展开区：左侧一条竖线表示「属于上面那个实体」，避免看成平级新列表
      '.ckm-ent-box{margin:2px 0 6px 10px;padding-left:8px;border-left:2px solid color-mix(in srgb,#3b82f6 25%,transparent)}',
      '.ckm-btn.tiny{padding:2px 6px;font-size:9.5px}',

      /* ── 后台整理（阶段 6 后半段）──
       * ⚠️⚠️ 所有颜色都写死具体值，不用 var(--wb-*) 系列去「猜」主题：
       *   面板挂在 body 上（pane 太窄会裁），已脱离 --wb-* 的作用域，
       *   未定义的变量会让**整条声明作废**且不报错 —— 表现是「样式看不出问题但就是不生效」。
       *   要跟随主题的话只能用带 fallback 的写法（见上面的 .ckm-fact-text）。
       */
      '.ckm-cons-why{font-size:10px;line-height:1.6;white-space:pre-wrap;padding:6px 8px;margin:0 2px 8px;' +
        'border-radius:7px;background:color-mix(in srgb,#64748b 8%,transparent);color:#475569}',
      '.ckm-cons-h{display:flex;align-items:baseline;gap:5px;padding:8px 2px 5px;flex:0 0 auto}',
      '.ckm-cons-hn{font-size:15px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}',
      '.ckm-cons-hl{font-size:10.5px;font-weight:600;color:#64748b}',
      '.ckm-cons-card{border:1px solid color-mix(in srgb,#3b82f6 22%,transparent);border-radius:8px;' +
        'padding:7px 8px;margin:0 2px 7px;background:color-mix(in srgb,#3b82f6 4%,transparent)}',
      '.ckm-cons-card.blocked{border-color:color-mix(in srgb,#94a3b8 22%,transparent);' +
        'background:color-mix(in srgb,#94a3b8 5%,transparent);opacity:.82}',
      '.ckm-cons-top{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:nowrap}',
      '.ckm-cons-j{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:5px;flex:0 0 auto;' +
        'background:color-mix(in srgb,#64748b 14%,transparent);color:#475569;font-variant-numeric:tabular-nums}',
      '.ckm-cons-ok{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;flex:0 0 auto;' +
        'background:color-mix(in srgb,#3b82f6 13%,transparent);color:#1d4ed8;white-space:nowrap}',
      '.ckm-cons-pair{display:flex;flex-direction:column;gap:4px}',
      '.ckm-cons-row{display:flex;align-items:flex-start;gap:5px;padding:4px 5px;border-radius:6px;' +
        'background:color-mix(in srgb,#94a3b8 7%,transparent)}',
      '.ckm-cons-row.keep{background:color-mix(in srgb,#22c55e 9%,transparent)}',
      '.ckm-cons-tag{flex:0 0 auto;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;' +
        'line-height:14px;white-space:nowrap;background:color-mix(in srgb,#64748b 16%,transparent);color:#475569}',
      '.ckm-cons-row.keep .ckm-cons-tag{background:color-mix(in srgb,#22c55e 20%,transparent);color:#15803d}',
      // ⚠️ min-width:0 + word-break 必须都给：flex 子项默认 min-width:auto，
      //   长中文句子会把卡片撑破、右侧 id 被挤出可视区（与 .ckm-ent-t 同一个坑）。
      '.ckm-cons-tx{flex:1 1 auto;min-width:0;font-size:11px;line-height:1.5;word-break:break-word;color:#1f1f1f}',
      '.ckm-cons-id{flex:0 0 auto;font-size:9px;color:#94a3b8;font-family:ui-monospace,Consolas,monospace}',
      '.ckm-cons-reasons,.ckm-cons-blockers{font-size:10px;line-height:1.55;margin-top:5px;' +
        'word-break:break-word;color:#475569}',
      '.ckm-cons-blockers{color:#b91c1c}',
      '.ckm-cons-lb{font-weight:700;margin-right:3px}',
      '.ckm-cons-act{display:flex;justify-content:flex-end;margin-top:6px}',
      '.ckm-cons-hist{display:flex;flex-direction:column;gap:2px;padding:0 2px 8px}',
      '.ckm-cons-hrow{display:flex;align-items:center;gap:4px}',
      '.ckm-cons-hbtn{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;gap:6px;text-align:left;' +
        'padding:4px 6px;border-radius:6px;border:1px solid transparent;background:transparent;cursor:pointer;' +
        'font-family:inherit;color:inherit}',
      '.ckm-cons-hbtn:hover{background:color-mix(in srgb,#94a3b8 10%,transparent)}',
      '.ckm-cons-hrow.on .ckm-cons-hbtn{background:color-mix(in srgb,#3b82f6 9%,transparent);' +
        'border-color:color-mix(in srgb,#3b82f6 22%,transparent)}',
      '.ckm-cons-htime{flex:0 0 auto;font-size:9.5px;color:#94a3b8;font-variant-numeric:tabular-nums}',
      '.ckm-cons-hsum{flex:1 1 auto;min-width:0;font-size:10.5px;color:#475569;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap}',
      '.ckm-cons-hund{flex:0 0 auto;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;' +
        'background:color-mix(in srgb,#94a3b8 16%,transparent);color:#64748b}',
      '.ckm-cons-undo{flex:0 0 auto;padding:2px 7px;font-size:9.5px}',
      '.ckm-cons-det{margin:2px 0 6px 12px;padding-left:8px;' +
        'border-left:2px solid color-mix(in srgb,#3b82f6 25%,transparent)}',
      '.ckm-cons-drow{display:flex;align-items:baseline;gap:5px;font-size:10px;line-height:1.65;padding:1px 0}',
      '.ckm-cons-drow.off{opacity:.55}',
      '.ckm-cons-dop{flex:0 0 auto;font-weight:700;color:#1d4ed8}',
      '.ckm-cons-did{flex:0 0 auto;color:#94a3b8;font-family:ui-monospace,Consolas,monospace}',
      '.ckm-cons-dwhy{flex:1 1 auto;min-width:0;color:#475569;word-break:break-word}',

      '.ckm-note{font-size:10px;color:var(--wb-icon-tertiary,#999);padding:2px 2px 6px;flex:0 0 auto}',
      '.ckm-text{font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--wb-color-text-primary,#1f1f1f)}',
      '.ckm-ctx{margin-top:5px;padding-top:5px;border-top:1px dashed var(--wb-border-subtle,#eee);font-size:10.5px;line-height:1.5;color:var(--wb-icon-tertiary,#999);white-space:pre-wrap;word-break:break-word}',
      '.ckm-empty{padding:26px 12px;text-align:center;font-size:11.5px;color:var(--wb-icon-tertiary,#999)}',
      '.ckm-err{padding:7px 11px;border-radius:9px;background:color-mix(in srgb,#ef4444 10%,transparent);color:#b91c1c;font-size:11px;flex:0 0 auto}',
      /* 底部 */
      '.ckm-foot{display:flex;align-items:center;gap:8px;padding:7px 2px 0;flex:0 0 auto;border-top:1px solid var(--wb-border-subtle,#f0f0f0)}',
      '.ckm-chk{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--wb-icon-secondary,#666);cursor:pointer;flex:0 0 auto}',
      '.ckm-chk input{cursor:pointer}',
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── 渲染 ───────────────────────────────────────────────────────── */
  /**
   * 面板尺寸决定布局密度：
   *   · 矮（<470px）⇒ compact：压缩条带内边距，把像素让给结果列表
   *   · 窄（<460px）⇒ narrow：状态条允许换行，别把数字用省略号吃掉
   * ⚠️ 不能只在 render() 里算 —— render 的触发点（加载完 / 搜索完）与「用户拖面板」不同步，
   *   实测拖到 380px 后类名还是空的，正文只剩 186px 被截。
   *   这里单独挂 ResizeObserver，尺寸一变就更新。
   */
  function syncDensity() {
    if (!paneEl) return;
    var wrap = paneEl.querySelector('.ckm-wrap');
    if (!wrap) return;
    try {
      var rr = paneEl.getBoundingClientRect();
      wrap.classList.toggle('compact', rr.height > 0 && rr.height < 470);
      wrap.classList.toggle('tiny', rr.height > 0 && rr.height < 420);
      wrap.classList.toggle('ckm-narrow', rr.width > 0 && rr.width < 460);
    } catch (_) {}
  }
  var densityRO = null;

  /**
   * 重绘状态条四行（圆点/标题/总开关 + 大字摘要 + AI 在跟谁 + 详情表）。
   *
   * ⚠️⚠️⚠️ 为什么必须单独拆出来（2026-11-05 实测问题）：
   *   面板原来**没有任何状态轮询** —— loadStatus() 只在「动作之后」或「切页时」调用。
   *   后果：面板开着不动，状态条永远冻结在打开那一刻。实测同一分钟对比：
   *     面板显示「全库 3/79 会话 · 152.0MB · 事实 23 条 · 上次注入 21 小时前」
   *     服务端真值是「7/79 · 162.9MB · 67 条 · 几分钟前」
   *   用户看到的是「开关都开了，怎么一点反应都没有」，实际索引器跑得很正常。
   *   ⇒ 加一个低频轮询，但**只能刷状态条**：整块 render() 会 while(list.firstChild)
   *     removeChild 清空结果区，轮询那么干等于每 8 秒把用户的滚动位置和正在看的内容冲掉。
   *
   * ⚠️ 为什么不用 loadStatus()：它内部调的是 render()（整块重绘），
   *   正是上面说要避免的。这里只做「取数 → 重绘状态条」。
   *
   * ── 2026-11-05 重构的排版原则 ──
   *   从上到下依次回答用户心里真正会问的四个问题：
   *     ① 这东西现在开没开？        → 圆点 + 总开关
   *     ② 你到底记住我多少东西？    → 大字摘要（12/13.5px，加粗主色）
   *     ③ 你现在正在用哪条？        → meta1（会影响 AI 行为，不能省）
   *     ④ 细节数字怎么样？          → 详情（默认收起，每行配大白话）
   *   旧版把 ①②③④ 全挤在两行 10px 灰字里，且顺序是 ③②④①，正好倒过来。
   */
  function renderStatusBar() {
    if (!paneEl) return;
    var wrap = paneEl.querySelector('.ckm-wrap');
    if (!wrap) return;
    var st = S.stat || {};
    var act = st.active || null;

    // ── 第 1 行：圆点 + 总开关 + 两个折叠按钮的状态 ──
    var dot = wrap.querySelector('.ckm-dot');
    if (dot) {
      dot.className = 'ckm-dot ' + (st.enabled === false ? 'off' : (st.segments ? 'on' : ''));
      dot.title = st.enabled === false
        ? '记忆总开关已关：不索引新对话、不往回答里带记忆、不提炼事实'
        : (st.segments ? '记忆正常工作' : '还没有数据');
    }
    var enChk = wrap.querySelector('[data-enabled]');
    if (enChk) enChk.checked = st.enabled !== false;

    var bAdv = wrap.querySelector('[data-adv]');
    if (bAdv) bAdv.classList.toggle('on', !!S.adv);
    var bDet = wrap.querySelector('[data-detail]');
    if (bDet) bDet.classList.toggle('on', !!S.detail);

    var advBox = wrap.querySelector('[data-adv-box]');
    if (advBox) advBox.hidden = !S.adv;
    var detBox = wrap.querySelector('[data-detail-box]');
    if (detBox) detBox.hidden = !S.detail;

    // ── 第 2 行：一句话结论 ──
    // ⚠️⚠️ 这一行是整个面板的主数字，措辞反复推敲过：
    //   · 「已记住 7/79 个会话」比「全库 7/79 会话」好读 —— 前者是用户的视角。
    //   · 有效记忆条数才是「记住了多少」的口径。用总记录数会虚高 10 倍
    //     （14689 条里只有 1247 条有效，其余全是我的过程话）。
    //   · 「条有效记忆」后面那个括号「你 12345」要保留：它回答「其中有多少是我说的话」，
    //     是用户判断「记的是不是我想让它记的」的唯一依据。
    var big = wrap.querySelector('.ckm-big');
    if (big) {
      while (big.firstChild) big.removeChild(big.firstChild);
      if (!st.available) {
        big.appendChild(document.createTextNode('当前运行时没有 SQLite，记忆功能不可用'));
      } else if (!st.sessions) {
        big.appendChild(document.createTextNode('还没开始记 —— 打开一次对话就会自动索引'));
      } else {
        // ⚠️⚠️⚠️ 不再写「29/73」这种分数（2026-11-06 用户实测误读）——
        //   分数天然被读成「进度条卡在 40%」或「我只让它记了 4 个，它记了 29 个」。
        //   实际口径是：**磁盘上够格（≥1MB）的会话一个没漏全进来了**，
        //   剩下 44 条全是 0.01~0.95MB 的短会话（合计才 12.7MB）。
        //   ⇒ 主数字只报「记住几个」，分母挪到下一行小字解释原因，详情表里再给全量拆解。
        big.appendChild(document.createTextNode('已记住 '));
        big.appendChild(el('b', null, num(st.sessions)));
        big.appendChild(document.createTextNode(' 个会话 · '));
        big.appendChild(el('b', null, num(st.validMem || st.talk)));
        big.appendChild(document.createTextNode(' 条有效记忆'));
        if (st.userTalk) {
          big.appendChild(el('i', null, '（其中你说的话 ' + num(st.userTalk) + ' 条）'));
        }
        // 事实层是「结论」而不是「原话」，与上面的条数不是一回事，单独一句更清楚
        if (st.factLive) {
          big.appendChild(document.createTextNode(' · 提炼出 '));
          big.appendChild(el('b', null, num(st.factLive)));
          big.appendChild(document.createTextNode(' 条事实'));
        }
        // ── 补一句「为什么总共 73 条、只记住 29 条」──
        // ⚠️ 用户看到 29/73 的第一反应是「是不是只给我指定的 4 个建了记忆」——
        //   这句就是回答它：不够格的是「太短」，不是「被漏掉」。
        //   pending（够格但后台还没补上）与 tooSmall 是两件事，必须分开报，
        //   否则后台正常运行时会显示成「有 44 条在排队」，反而更像卡住了。
        var _onDisk = Number(st.onDisk) || 0;
        var _idx = Number(st.sessions) || 0;
        var _rest = Math.max(0, _onDisk - _idx);
        var _pend = Math.min(_rest, Number(st.pending) || 0);
        var _small = Math.max(0, _rest - _pend);
        if (_rest > 0) {
          var _note = [];
          if (_pend > 0) _note.push(_pend + ' 条正在后台补');
          // ⚠️ 不能写死「不到 1MB」：_small 是「未索引 − 够格待补」的**余数**，
          //   里面还可能有子代理临时会话、同尺寸重复会话。本机实测恰好 0 个，
          //   但换台机器就不成立了 ⇒ 主线只说「内容太少」，hover 里再列全三种。
          if (_small > 0) _note.push(_small + ' 条内容太少，没收录');
          var _noteEl = el('i', 'ckm-note', '另有 ' + _note.join('、'));
          // hover 里给完整算式，主线上只留最短一句
          _noteEl.title = '磁盘上共 ' + _onDisk + ' 条会话，已索引 ' + _idx + ' 条。'
            + ('其中你手动指定 ' + (Number(st.followed) || 0) + ' 条，其余 ≥1MB 的自动收录。')
            // ⚠️ 这里不写死体积区间（「0.01~0.95MB」是 2026-11-06 本机实测值）：
            //   换台机器 / 过几个月这个区间就错了，而 hover 里的具体数字更容易被当真。
            + (_small > 0 ? ('剩下 ' + _small + ' 条是「不值得索引」的：不到 1MB 的短会话（打开就问一两句就关掉，索引了也只有空行）、AI 内部派活的子代理临时会话、以及内容完全重复的会话。') : '')
            + (_pend > 0 ? ('还有 ' + _pend + ' 条够格但尚未同步，后台每 30 秒补 12 条。') : '');
          big.appendChild(_noteEl);
        }
      }
    }

    // ── 第 3 行：AI 正在用哪条会话 ──
    // ⚠️⚠️⚠️ 这是面板里**唯一会影响 AI 行为的隐性状态** —— 不显示的话，
    //   「为什么它记不起刚才那条会话」永远查不出来。
    //   旧版这一行还兼着报条数（有效 N 条（你 M）），现在条数归大字摘要了，
    //   这里只留「是谁」，避免同一类信息出现两处、口径还不一致。
    var meta = wrap.querySelector('.ckm-meta1');
    if (meta) {
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      if (!st.available) {
        // 上面大字已经说了不可用，这里不重复
      } else {
        var bound = (S.list && S.list.activeSid) || (act ? act.sid : '');
        var boundItem = null;
        for (var bi = 0; bi < (S.sessions || []).length; bi++) {
          if (S.sessions[bi].sid === bound) { boundItem = S.sessions[bi]; break; }
        }
        if (bound) {
          meta.appendChild(document.createTextNode('AI 正在用 '));
          meta.appendChild(el('b', null, String(bound).slice(0, 8)));
          var bTitle = boundItem && boundItem.title ? String(boundItem.title) : (act && act.title ? String(act.title) : '');
          if (bTitle) meta.appendChild(document.createTextNode(' · ' + cut(bTitle, 18)));
          if (act && act.indexed) {
            meta.appendChild(document.createTextNode(' · 有效 ' + num(boundItem ? boundItem.valid : act.n) + ' 条'));
          } else {
            meta.appendChild(document.createTextNode(' · 尚未索引'));
          }
          // 「面板正在看」与「AI 在用」不是同一条时必须点明，否则会被误读成同一个
          var cur = selItem();
          if (cur && cur.sid !== bound) {
            // ⚠️⚠️ 前面那个空格不能省：徽标是独立 flex 项，而前面是文本节点 ——
            //   文本节点不吃父容器的 gap，不加空格会渲染成「有效 550 条面板在看 96f77df6」。
            //   （上一版 meta2 踩过完全一样的坑，注释里都写了，这次换了容器又犯一遍。）
            meta.appendChild(document.createTextNode(' '));
            var diff = el('span', 'ckm-chip ckm-chip-warn', '面板在看 ' + cur.short);
            diff.title = '面板里查的是「' + (cur.title || cur.short) + '」，AI 实际查的是「' + (bTitle || String(bound).slice(0, 8)) + '」';
            meta.appendChild(diff);
          }
          meta.title = 'AI 回答时会检索这条会话的记忆。\n'
            + '它跟着你在客户端里**实际打开的那条会话**走 —— 切换会话不会写文件，靠面板每 2 秒上报一次。\n'
            + '在下面的会话下拉里手动指定别的会话，只会改「面板里查哪条」，不改「AI 用哪条」。';
        } else {
          meta.appendChild(document.createTextNode('还没定位到会话文件 —— 打开一次对话即可'));
        }
      }
    }

    // ── 第 4 行：详情表（技术指标）──
    // ⚠️ 这里每一行都必须带大白话，这是用户明确提的要求：
    //   「只留索引了多少，其他折叠但是展开后鼠标移动上去后显示大白话解释」。
    //   实现上不止给 title —— 行内也写一句最短的定性，因为 title 要靠 hover 才出现，
    //   而触屏 / 第一次用的人根本不会去 hover。title 里放完整版（含例外与注意）。
    if (detBox && S.detail) {
      while (detBox.firstChild) detBox.removeChild(detBox.firstChild);
      var rows = [
        ['已索引会话', num(st.sessions) + ' / ' + num(st.onDisk),
          '磁盘上一共有 ' + num(st.onDisk) + ' 条会话，已经吃进索引的有 ' + num(st.sessions) + ' 条'
            + ('（其中你手动指定 ' + (Number(st.followed) || 0) + ' 条，其余是体积达标的自动收录）。')
            + '没收进来的基本都是不到 1MB 的短会话 —— 打开就问一句、没几轮就关掉的那种，'
            + '索引了也只有空行。体积达标的会由后台自己补：每 30 秒一轮，一轮最多 12 条，'
            + '几分钟就补齐，不用手动点。',
          '短会话不索引，不是漏了'],
        ['有效记忆', num(st.validMem || 0),
          '你说的话 + 我每回合的结论，共 ' + num(st.validMem || 0) + ' 条。这是检索真正会用到的那部分。',
          '真正会被搜到的'],
        ['其中你说的话', num(st.userTalk || 0),
          '记忆里标记为「用户发言」的有 ' + num(st.userTalk || 0) + ' 条。其余是我的结论。',
          '你的原话条数'],
        ['提炼的事实', num(st.factLive || 0),
          '后台把对话蒸馏成的一句话结论，共 ' + num(st.factLive || 0) + ' 条有效'
            + (st.factTotal && st.factTotal > st.factLive ? '（另有 ' + num(st.factTotal - st.factLive) + ' 条已被新结论取代，只标失效不删除）' : '') + '。',
          '换个说法也能查到'],
        ['过程话', num(st.procMem || 0),
          '我的碎碎念与工具输出，共 ' + num(st.procMem || 0) + ' 条。默认不参与检索，但一条没删 ——'
            + ' 想找「当时跑过哪条命令」时，搜索勾上「含过程话」就能翻到。',
          '默认不搜，但留着'],
        ['总记录', num(st.segments || 0),
          '索引里的全部行数：' + num(st.segments || 0) + ' 条 = 有效 ' + num(st.validMem || 0)
            + ' + 过程话 ' + num(st.procMem || 0) + '。',
          '含过程话的总量'],
        ['重复合并', num(st.folded || 0),
          '同一句话只存一份，被合并掉的重复次数累计 ' + num(st.folded || 0) + ' 次。'
            + '这个数大说明对话里有大量重复（比如反复贴同一份日志），不是错误。',
          '省了多少重复'],
        ['忽略续跑', num(st.noise || 0),
          '「请继续执行任务」这类客户端自动指令出现过 ' + num(st.noise || 0) + ' 次，'
            + '它们不是你说的话，所以不进时间线、不参与检索。',
          '自动续跑不算对话'],
        ['库占用', mb(st.dbBytes || 0),
          '记忆数据库占磁盘 ' + mb(st.dbBytes || 0) + '（含尚未合并的 WAL）。'
            + '它与聊天原文是两套数据：删索引不影响原文，删原文也不会自动删索引。',
          '索引库本身的大小'],
        ['用过', num(st.hitRows || 0) + (st.hitTotal ? ' / ' + num(st.hitTotal) + ' 次' : ''),
          '有 ' + num(st.hitRows || 0) + ' 条记忆被检索命中过，累计 ' + num(st.hitTotal || 0) + ' 次。'
            + (st.hitLast ? '最近一次：' + timeLabel(st.hitLast) + '。' : '')
            + '常用旧记忆会据此更抗衰退 —— 新鲜度按「上次被使用」算，不按创建时间。',
          '排序靠它判新鲜度'],
        ['待补索引', num(st.pending || 0),
          '磁盘上还有 ' + num(st.pending || 0) + ' 条会话没进索引（或比磁盘落后）。'
            + '它们在补齐之前是**搜不到的**。后台每 30 秒自动补一批（最多 12 条、约 1.5 秒），'
            + '几十条的大库几分钟就补齐，不用手动点。'
            + '⚠️ 注意「条」指的是**会话**不是记录：一条 300MB 的会话本身就有一两万条记录。',
          '还没进索引的会话数'],
      ];
      if (st.hitErrors) {
        rows.push(['回写失败', num(st.hitErrors),
          '检索命中后写 last_hit_ts 失败过 ' + num(st.hitErrors) + ' 次（一般是客户端正在写文件、抢不到写锁）。'
            + '失败是静默的：不影响检索结果，只影响「上次被使用」的统计精度。',
          '不影响用，只影响统计']);
      }
      if (act) {
        /**
         * ⚠️⚠️⚠️ 标签必须写「AI 用的会话」，不能写「当前会话」。
         *
         * 实测踩到（2026-11-05 截图核对）：
         *   详情表显示「当前会话 2.8 万条 / 318.4MB」，
         *   而正上方会话行显示「查看：整理画册 96f77df6 · 57.63 MB · 有效 147 条」。
         *   `act` 取的是 `st.active`，即**AI 正在用的那条**（8f92c3fc，318MB），
         *   与会话行里**面板正在看的那条**（96f77df6，57MB）根本不是同一条。
         *   体积差 5 倍、条数差 190 倍，用户只会得出「这面板的数字全是编的」。
         *   ⇒ 标签点明「AI 用的」，并在两边确实不同时把会话号写出来。
         */
        var actSidShort = String(act.sid || '').slice(0, 8);
        var panelSid = S.selSid || '';
        var differs = !!panelSid && panelSid !== act.sid;
        rows.push([
          'AI 用的会话' + (differs ? ' ' + actSidShort : ''),
          num(act.n) + ' 条 / ' + (act.sizeMB || 0) + 'MB',
          'AI 回答时检索的是这条会话（' + actSidShort + '）：索引了 ' + num(act.n) + ' 条记录，源文件 ' + (act.sizeMB || 0) + 'MB。'
            + (differs
              ? '\n⚠️ 它与上面会话行里「面板在看」的 ' + panelSid.slice(0, 8) + ' 不是同一条 —— '
                + '「面板在看」只影响这一页显示什么，不影响 AI 检索哪条。'
              : ''),
          differs ? '不是会话行那条' : '单条会话的规模']);
      }
      for (var ri = 0; ri < rows.length; ri++) {
        var r = rows[ri];
        var k = el('span', 'ckm-dk', r[0]);
        var v = el('span', 'ckm-dv', r[1]);
        var w = el('span', 'ckm-dw', r[3]);
        // 完整解释挂 title（同一份文字，不另写一套，避免两处口径不一致）
        w.title = r[2];
        k.title = r[2];
        detBox.appendChild(k);
        detBox.appendChild(v);
        detBox.appendChild(w);
      }
    }
  }

  function render() {
    if (!paneEl) return;
    var wrap = paneEl.querySelector('.ckm-wrap');
    if (!wrap) return;
    syncDensity();

    renderStatusBar();

    syncSessionBar();

    // 错误条
    var errBox = wrap.querySelector('.ckm-err');
    if (errBox) {
      if (S.err) { errBox.textContent = S.err; errBox.hidden = false; }
      else errBox.hidden = true;
    }

    // 分段按钮高亮
    var segs = wrap.querySelectorAll('.ckm-seg .ckm-btn');
    for (var i = 0; i < segs.length; i++) {
      var dm = segs[i].getAttribute('data-mode');
      if (segs[i].getAttribute('data-deep')) segs[i].classList.toggle('on', !!S.deep);
      else segs[i].classList.toggle('on', !S.mgr && dm === S.mode);
    }
    // 「管理」按钮同样要显示开合状态，否则点进去看不出自己已经在管理页
    var bM = wrap.querySelector('[data-mgr]');
    if (bM) bM.classList.toggle('on', !!S.mgr);

    // ⚠️ 总开关的勾选态已由 renderStatusBar() 负责（它按 st.enabled 同步）。
    //   旧代码在这里写的是 `wrap.querySelector('.ckm-chk input')` —— 那是个**位置耦合**：
    //   全页第一个 .ckm-chk 一旦不是总开关（本次重构就把它挪了位置），
    //   这行就会去改「自动带入记忆」的勾选。改成按属性精确取。

    // 自动注入区块（自成一个渲染单元，避免它失败影响整个面板）
    try { renderInject(); } catch (_) {}

    // 临时文件清理区块（同理自成单元）。
    //   ⚠️ 只在「高级」展开时才真去写 DOM —— 折叠状态下那几个节点根本没建，
    //      renderTempSweep() 自己会 querySelector 到 null 然后直接 return，
    //      但每帧多一次无谓的查询也没意义，所以这里先判 S.adv。
    try { if (S.adv) renderTempSweep(); } catch (_) {}

    // 结果区
    var list = wrap.querySelector('.ckm-list');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    // 记忆管理视图接管结果区（优先级最高：它是个独立视图，不看 mode）
    if (S.mgr) { renderMgr(list); return; }
    // 事实视图同理（阶段 4）：它是一个完全不同的数据源，不参与 mode 的分支
    if (S.mode === 'facts' && S.fcons) { renderConsol(list); return; }
    if (S.mode === 'facts') { renderFacts(list); return; }

    if (S.busy) {
      list.appendChild(el('div', 'ckm-empty', S.busy === 'search' ? '搜索中…' : '处理中…'));
      return;
    }

    // 时间线只取最近 120 条：不写清楚会被误读成「这个会话只提过这么点要求」
    if (S.mode === 'timeline' && S.tlTotal > (S.items || []).length) {
      list.appendChild(el('div', 'ckm-note',
        '共 ' + num(S.tlTotal) + ' 条发言，这里是最新的 ' + num((S.items || []).length) + ' 条'));
    }

    // 搜索走的是哪条路，要说出来。
    // ⚠️ 这条对排查很关键：via=AND 是「整句精确命中」，via=OR 是「放宽后按相关度排」，
    //   via=LIKE 是「字面兜底」（单字、索引里没有的词）。
    //   同样是 3 条结果，走兜底拿到的往往不如 AND 精准 —— 不显示就会被误读成「搜得挺准」。
    if (S.mode === 'search' && S.via && (S.hits || []).length) {
      var viaMap = {
        AND: '整句精确命中',
        OR: '没有完全匹配，按相关度排序',
        LIKE: '字面包含（单字 / 词表外）'
      };
      var viaTips = {
        AND: '',
        OR: '库里没有同时包含全部关键词的原话，所以放宽了匹配。排序按「命中了多少关键信息」加权，越靠前越相关。',
        LIKE: '索引按两字一段建立，单字或生僻写法查不到，已退回全文逐字比对。结果按时间倒序，不是按相关度。'
      };
      var viaNote = el('div', 'ckm-note',
        '匹配方式：' + (viaMap[S.via] || S.via) + (viaTips[S.via] ? '　（' + viaTips[S.via] + '）' : ''));
      if (S.via !== 'AND') viaNote.style.opacity = '0.8';
      list.appendChild(viaNote);
    }

    var rows = S.mode === 'timeline' ? S.items : (S.mode === 'search' ? S.hits : S.items);
    if (!rows || !rows.length) {
      // ⚠️ 空结果必须说清「为什么空」：选中一条未建索引的会话时，
      //    「没有记录」会被读成「这条会话没说过话」，实际是「还没索引」。
      var cur = selItem();
      var tip;
      if (S.mode === 'search') {
        // ⚠️⚠️ 拒答和「搜不到」是两件事，必须分开说：
        //   拒答 = 库里确实没有这个话题（判据是确定性字面，见 ck-memory.js 的 latinMiss），
        //   「没有命中」= 可能有，只是关键词不匹配。
        //   混在一句话里，用户无法判断该换个词还是该放弃 —— 而这两件事的动作完全不同。
        if (S.miss && S.miss.length) {
          tip = '这条记忆里没出现过 ' + S.miss.map(function (x) { return '「' + x + '」'; }).join('、')
            + '，所以没给结果。\n没有拿相似的东西凑数 —— 凑出来的答案比「没有」更误事。';
        } else {
          tip = '没有命中「' + (S.q || '') + '」' + (S.note ? '（' + S.note + '）' : '');
        }
        // ⚠️ 分层之后「搜不到」有两种完全不同的原因，必须分开说：
        //   ① 真的没说过；② 只在过程话里说过 —— 后者要让用户知道怎么翻。
        if (!S.deep) tip += '\n默认只搜有效记忆（你说的话 + 每回合结论）。\n若想连我的过程话与命令回显一起搜，点「含过程话」再搜一次。';
        if (cur && !cur.indexed) tip += '\n这条会话还没建索引，点右上「建记忆」会自动补。';
      } else if (cur && !cur.indexed) {
        tip = '这条会话还没建索引。\n打开过它的话通常是几秒内自动开始，稍等再刷新；\n也可以点右上「建记忆」，或点「索引一次」立刻灌入。';
      } else {
        tip = S.mode === 'timeline' ? '还没有记录到你说过的话' : '这个时间段内没有对话';
      }
      var emptyEl = el('div', 'ckm-empty', tip);
      emptyEl.style.whiteSpace = 'pre-wrap';
      emptyEl.style.lineHeight = '1.7';
      list.appendChild(emptyEl);
      return;
    }

    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      var hit = el('div', 'ckm-hit');

      var top = el('div', 'ckm-hit-top');
      var role = String(r.role || '').toLowerCase();
      var tagText = role === 'user' ? '你' : (role === 'assistant' ? '助手' : (role === 'tool' ? (r.tool || '工具') : (role || '记录')));
      var tag = el('span', 'ckm-tag' + (role === 'tool' ? ' tool' : (role === 'user' ? ' user' : '')), tagText);
      top.appendChild(tag);
      top.appendChild(el('span', 'ckm-time', r.time || ''));
      if (r.dup > 1) {
        var dupEl = el('span', 'ckm-dup', '×' + r.dup);
        dupEl.title = '这段内容在会话里出现过 ' + r.dup + ' 次（只存一份，次数合并）';
        top.appendChild(dupEl);
      }
      if (S.mode === 'search' && r.seq != null) top.appendChild(el('span', 'ckm-time', '#' + r.seq));
      // ⭐ 阶段 3：把「上一次被检索是什么时候」显示出来。
      //   这个数字是排序口径的依据，看不见就没法解释「为什么这条排前面」。
      //   ⚠️ 0 = 从来没被检索命中过（老数据都是 0，属于正常，不是错误）。
      if (S.mode === 'search' && r.lastHit !== undefined) {
        var idle = r.idleDays;
        var hitEl = el('span', 'ckm-hitn',
          idle === null || idle === undefined ? '未用过' : (idle <= 0 ? '今天用过' : idle + ' 天未用'));
        hitEl.title = r.lastHit
          ? '上次被检索命中：' + timeLabel(r.lastHit) + '\n常用旧记忆会因此更抗衰退（按「上次被使用」算新鲜度）'
          : '这条从入库起还没被检索命中过';
        top.appendChild(hitEl);
      }
      hit.appendChild(top);

      // ⚠️ 正文一律 textContent —— transcript 是不可信输入
      hit.appendChild(el('div', 'ckm-text', cut(r.text, 600)));

      // 搜索命中带前后文
      if (r.context && r.context.length) {
        for (var c = 0; c < r.context.length; c++) {
          if (r.context[c].self) continue;
          var ctx = el('div', 'ckm-ctx');
          ctx.appendChild(el('span', 'ckm-time', (r.context[c].role === 'user' ? '你' : r.context[c].role) + ' · ' + (r.context[c].time || '')));
          ctx.appendChild(document.createTextNode('　' + cut(r.context[c].text, 160)));
          hit.appendChild(ctx);
        }
      }
      list.appendChild(hit);
    }
  }

  function cut(t, n) {
    var s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* ── 多会话 ─────────────────────────────────────────────────────── */
  function selItem() {
    if (!S.selSid) return null;
    var arr = S.sessions || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].sid === S.selSid) return arr[i];
    return null;
  }

  /** 下拉里当前真正在查哪条：选了具体会话就是它，否则是「当前会话」。 */
  function targetSid() {
    if (S.selSid) return S.selSid;
    return (S.list && S.list.activeSid) || (S.stat && S.stat.active ? S.stat.active.sid : '');
  }

  function followedOf(sid) {
    var arr = S.sessions || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].sid === sid) return !!arr[i].followed;
    return false;
  }

  /* ── 会话选择器（触发器 + 搜索浮层） ───────────────────────────── */

  /**
   * 弹层该挂在哪：`.wbs-root` 里，而不是 `body`。
   *
   * ⚠️⚠️⚠️ 2026-11-05 实测：老叶报「点『查看：整理画册』没有下拉框」。
   *   查下去发现弹层**确实打开了**（hidden=false、display:flex、587×280px，
   *   位置也算得对），但 `document.elementFromPoint(弹层中心)` 命中的是
   *   `INPUT.ckm-input` —— 被面板整个盖住了。
   *
   *   根因是宿主的两层层叠上下文打架：
   *     · `.wbs-root`  = position:fixed + **z-index:2147483647**（int32 上限）
   *     · 弹层挂 body = position:fixed + z-index:9999
   *   fixed 元素各自成层，z 再大也只在**自己的父层叠上下文**里比；
   *   挂在 body 上的 9999 属于根层叠上下文，而 `.wbs-root` 的 2147483647
   *   同样在根上下文里 ⇒ **面板永远压在弹层上面**，z-index 调到多大都没用
   *   （上限已经用掉了）。
   *
   *   所以只能把弹层挪进 `.wbs-root` 内部、和 `.wbs-panel` 当兄弟，
   *   让两者在**同一个**层叠上下文里按 z-index 比大小（弹层 9999 > 面板 auto）。
   *
   *   ⚠️ 为什么不挂 `.wbs-pane` / `.ckm-pick` 里：那两层有 overflow 裁剪，
   *     弹层会被裁到只剩一行（这个坑 2026-11-04 踩过，才改成挂 body）。
   *   `.wbs-root` 实测 `overflow:visible`、`transform:none`、`contain:none`，
   *     不会建立新的包含块，fixed 坐标仍然按视口算 ⇒ placePop() 不用改。
   */
  function popHost() {
    var root = document.querySelector('.wbs-root');
    return root || document.body;
  }

  /**
   * 给弹层定位：贴住触发器，下方放不下就往上翻，高度钳到视口内。
   *
   * ⚠️⚠️ 弹层用 fixed 坐标，所以这里只能按**视口**算，
   *   不能按 pane 算（实测按 pane 算会得出「下方有 500px」的假结论，
   *   而实际上弹层被 pane 的 overflow 裁到只剩一行）。
   *   ⚠️ 挂载点从 body 移到 `.wbs-root` 时专门验过：`.wbs-root` 的
   *     `overflow:visible` / `transform:none` / `contain:none` 三项都不建立
   *     包含块（它自身虽有 top/left 偏移，但 fixed 子元素仍按视口定位），
   *     实测弹层 left/top 与触发器**逐像素对齐**，所以这里的算法不用改。
   */
  function placePop() {
    if (!paneEl) return;
    var pop = document.querySelector('.ckm-pop');
    var pick = paneEl.querySelector('.ckm-pick');
    if (!pop || !pick || pop.hidden) return;
    var tr = pick.getBoundingClientRect();
    var vh = window.innerHeight || 900;
    var below = vh - tr.bottom - 12;
    var above = tr.top - 12;
    var up = below < 190 && above > below;
    var avail = Math.max(140, Math.min(280, up ? above : below));
    pop.style.maxHeight = avail + 'px';
    pop.style.width = Math.max(240, Math.round(tr.width)) + 'px';
    pop.style.left = Math.round(tr.left) + 'px';
    if (up) {
      pop.style.top = 'auto';
      pop.style.bottom = Math.round(vh - tr.top + 4) + 'px';
    } else {
      pop.style.bottom = 'auto';
      pop.style.top = Math.round(tr.bottom + 4) + 'px';
    }
  }

  function togglePop(force) {
    if (!paneEl) return;
    var pop = document.querySelector('.ckm-pop');
    var pq = document.querySelector('.ckm-pop-q');
    if (!pop) return;
    var want = (force === undefined) ? pop.hidden : !!force;
    pop.hidden = !want;
    if (want) {
      if (pq) { pq.value = ''; }
      // 先把定位算好再显示：否则会先在错误位置闪一下
      placePop();
      renderPop('');
      if (pq) { try { pq.focus(); } catch (_) {} }
    }
  }

  function closePop() {
    var pop = document.querySelector('.ckm-pop');
    if (pop) pop.hidden = true;
  }

  /** 浮层列表：第一项恒为「跟随当前会话」，其余按关键词过滤。 */
  function renderPop(q) {
    var popList = document.querySelector('.ckm-pop-list');
    if (!popList) return;
    while (popList.firstChild) popList.removeChild(popList.firstChild);
    // ⚠️ foot 是弹层第二个子节点，每次 render 都会重建 ⇒ 先删旧的，否则越叠越多
    var oldFoot = document.querySelector('.ckm-pop-foot');
    if (oldFoot && oldFoot.parentNode) oldFoot.parentNode.removeChild(oldFoot);
    var actSid = (S.list && S.list.activeSid) || '';
    var key = String(q || '').trim().toLowerCase();

    function hit(s) {
      if (!key) return true;
      var hay = (String(s.title || '') + ' ' + s.sid + ' ' + String(s.proj || '')).toLowerCase();
      var terms = key.split(/\s+/);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
      return true;
    }

    // 第一项：跟随当前会话（= 老行为，永远排第一，不需要搜）
    if (!key) {
      var o0 = el('div', 'ckm-opt' + (S.selSid ? '' : ' cur'));
      o0.setAttribute('data-sid', '');
      o0.appendChild(el('div', 'ckm-opt-t', '● 跟随当前会话'));
      var s0 = el('div', 'ckm-opt-s', actSid ? ('现在指向 ' + String(actSid).slice(0, 8)) : '还没定位到会话');
      o0.appendChild(s0);
      o0.onclick = function () { pickSession(''); togglePop(false); };
      popList.appendChild(o0);
    }

    var arr = (S.sessions || []).filter(hit);
    var shown = 0;
    for (var i = 0; i < arr.length && shown < 60; i++) {
      var s = arr[i];
      var cur = !!S.selSid && S.selSid === s.sid;
      var o = el('div', 'ckm-opt' + (cur ? ' cur' : ''));
      o.setAttribute('data-sid', s.sid);
      var t = el('div', 'ckm-opt-t');
      // 标题可省略，徽标不能被挤掉：徽标放右侧固定，标题自己 ellipsis
      t.appendChild(el('span', 'ckm-opt-n', s.title ? String(s.title) : '（无标题）'));
      // 徽标要回答「这条有记忆吗、建到哪了」，不是只给一个是/否。
      // 实测一条 158MB 的会话补齐要几分钟，中间状态必须可见，否则用户以为没生效。
      var lag = Math.max(0, Number(s.lag) || 0);
      var pct = Math.round(100 * (1 - Math.min(1, lag / Math.max(1, Number(s.size) || 1))));
      if (s.followed) {
        if (s.indexed && pct >= 100) t.appendChild(el('span', 'ckm-opt-b f', '已建好'));
        else t.appendChild(el('span', 'ckm-opt-b n', '建设中 ' + pct + '%'));
      } else if (!s.indexed) {
        t.appendChild(el('span', 'ckm-opt-b n', '未建'));
      }
      o.appendChild(t);
      var sub = s.short + ' · ' + (s.sizeMB >= 1024 ? (s.sizeMB / 1024).toFixed(1) + ' GB' : s.sizeMB + ' MB')
        + ' · 有效 ' + num(s.valid != null ? s.valid : s.rows) + ' 条 · ' + String(s.mtime || '').slice(5, 16);
      o.appendChild(el('div', 'ckm-opt-s', sub));
      o.onclick = (function (sid) {
        return function () { pickSession(sid); togglePop(false); };
      })(s.sid);
      popList.appendChild(o);
      shown++;
    }
    if (!shown && key) {
      popList.appendChild(el('div', 'ckm-pop-empty', '没有匹配「' + q + '」的会话'));
    }

    /**
     * 底部快捷操作：把体积最大的 N 条会话一次性加入跟踪。
     * ⚠️ 为什么需要它：用户真正的需求是「我还有几条长会话要加进来」，
     *   而长会话 = 文件大。让他一条条搜、一条条点「加入跟踪」是反人性的。
     *   这里直接按体积取前几条，一次批量提交。
     */
    var foot = el('div', 'ckm-pop-foot');
    // ⚠️ 按「最近打开」挑，不按体积挑。老叶的原话是「我切到某个长会话，
    //   不知道该怎么给它建记忆」——用户脑子里想的是「我最近在弄的那几条」，
    //   不是「磁盘上最大的那几条」。体积排序是机器视角。
    var big = (S.sessions || [])
      .filter(function (s) { return !s.followed && s.sizeMB >= 0.3; })
      .sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); })
      .slice(0, 5);
    if (big.length) {
      var lab = '把最近 ' + big.length + ' 条都建上';
      var bb = el('button', 'ckm-btn', lab);
      bb.title = big.map(function (s) {
        return (s.title || s.short) + '（' + s.sizeMB + ' MB）';
      }).join('\n');
      bb.onclick = function (e) {
        e.stopPropagation();
        followMany(big.map(function (s) { return s.sid; }));
      };
      foot.appendChild(bb);
    }
    var hintF = el('span', 'ckm-hint', '点标题切换 · 回车选第一条');
    foot.appendChild(hintF);
    popList.parentNode.appendChild(foot);
  }

  /**
   * 会话触发器与两个按钮的状态同步。
   * ⚠️ 触发器文字只在「内容签名」变化时重写：每次 render 都改会把用户
   *    正在打字的浮层搜索框焦点弄丢（实测每 3 秒 tick 一次就会丢）。
   */
  function syncSessionBar() {
    if (!paneEl) return;
    var wrap = paneEl.querySelector('.ckm-wrap');
    if (!wrap) return;

    var actSid = (S.list && S.list.activeSid) || '';
    var it = selItem();
    var tT = wrap.querySelector('.ckm-trig-t');
    var tS = wrap.querySelector('.ckm-trig-s');
    if (tT && tS) {
      var act = S.stat && S.stat.active ? S.stat.active : null;
      var sig = S.selSid + '|' + actSid + '|' + (it ? (it.title + it.rows + it.followed) : '');
      // ⚠️⚠️⚠️ 跟随模式的副标题必须用 **actSid**，不能拿 stat.active 当数据源。
      //   实测踩过：状态条已经显示「AI 在 e567d9db」，触发器副标题却还留着更早一次的
      //   8f92c3fc —— 因为 sig 里有 actSid，sig 变了但 stat.active 还没跟上，
      //   于是分支进去却渲染了旧值，两边打架，用户不知道到底跟的是哪条。
      //   actSid 就是 sessionList 的权威结果，直接截前 8 位，其余信息按需查 sessions。
      if (tT.getAttribute('data-sig') !== sig) {
        tT.setAttribute('data-sig', sig);
        if (it) {
          /**
           * ⚠️ 2026-11-05：加「查看」前缀。
           *
           * 用户原话：「整理画册 96f77df6 · 57.63MB · 有效 147 条」看起来像一张卡片标题，
           * 完全不知道点它能干嘛。实测截图确实如此 —— 它就是个按钮，
           * 但长得像「当前内容的标题」。加两个字就够，加太多了宽 460px 的面板放不下。
           */
          tT.textContent = '查看：' + (it.title || ('（无标题）' + it.short));
          var bits = [it.short, it.sizeMB + ' MB', '有效 ' + num(it.valid != null ? it.valid : it.rows) + ' 条'];
          if (it.followed) bits.push('已跟踪');
          if (!it.indexed) bits.push('未建索引');
          tS.textContent = bits.join(' · ');
        } else {
          // 跟随模式：写清「现在跟着谁」，否则用户不知道点了会话到底生效没有
          tT.textContent = '● 跟随当前会话';
          if (actSid) {
            var boundItem = null;
            for (var bi2 = 0; bi2 < (S.sessions || []).length; bi2++) {
              if (S.sessions[bi2].sid === actSid) { boundItem = S.sessions[bi2]; break; }
            }
            var sub = String(actSid).slice(0, 8);
            if (boundItem) sub += ' · ' + num(boundItem.rows) + ' 条' + (boundItem.indexed ? '' : ' · 尚未索引');
            tS.textContent = sub;
          } else {
            tS.textContent = '还没定位到会话';
          }
        }
      }
    }

    var sid = targetSid();
    var on = it ? it.followed : followedOf(sid);
    var bTr = wrap.querySelector('.ckm-track');
    if (bTr) {
      // ⚠️ 文案从「加入跟踪」改成「建记忆」：老叶原话是「我点开了那条长会话，
      //   但记忆没跟过去」—— 说明「跟踪」这个词完全没传达出「这是建记忆的开关」。
      //   现在默认「打开会话即自动建」，这个按钮只用于「手动补一条没打开过的」。
      // ⚠️⚠️ 不能只认 it（用户在下拉里显式选中的那条）：
      //   默认是「跟随当前会话」，此时 it 恒为 null ⇒ pct 恒为 0 ⇒
      //   明明已经建好的会话，按钮还写「补记忆中 0%」，看着像卡死了。
      //   跟随模式下要拿 activeSid 对应的那条来算。
      var pItem = it;
      if (!pItem && actSid) {
        for (var pi2 = 0; pi2 < (S.sessions || []).length; pi2++) {
          if (S.sessions[pi2].sid === actSid) { pItem = S.sessions[pi2]; break; }
        }
      }
      var pct = pItem ? Math.round(100 * (1 - Math.min(1, (pItem.lag || 0) / Math.max(1, pItem.size || 1)))) : 0;
      bTr.textContent = on ? (pct >= 100 ? '已建好' : '补记忆中 ' + pct + '%') : '建记忆';
      bTr.classList.toggle('on', on);
      bTr.disabled = !sid;
      bTr.title = on
        ? '这条会话已排进索引队列' + (pct >= 100 ? '，且已补齐' : '，正在后台补（当前 ' + pct + '%）') + '\n点一下可以停止补索引（已建好的部分保留）'
        : '把这条会话的记忆建起来 —— 索引器每 30 秒补一段，长会话也能慢慢补齐。\n（打开过这条会话的话，通常已经自动建了）';
    }
    var bDrop = wrap.querySelector('.ckm-drop');
    if (bDrop) {
      var has = it ? it.indexed : !!(S.stat && S.stat.active && S.stat.active.indexed);
      bDrop.disabled = !has;
      bDrop.textContent = has ? '忘掉' : '未记住';
      bDrop.title = has
        ? '让 AI 忘掉这条会话 —— 只删这条会话的记忆索引，聊天原文一个字都不动。\n随时可以再点「建记忆」重建。'
        : '这条会话还没有记忆，没有可删的。';
    }
  }

  /**
   * 把「面板现在打开的是哪条会话」上报给后端。
   *
   * ⚠️⚠️⚠️ 这是本次修的根因：点开会话**不会写 .jsonl**，mtime 一动不动，
   *   后端只看 mtime 就永远认为你还停在旧会话上 —— 也就是「点了不过去」。
   *   渲染进程能看到侧栏的 `_selected_` 选中态，这是唯一准确的信号源。
   *   读不到（官方改类名）就什么都不做，后端自然回落 mtime，不会更糟。
   */
  function readOpenSid() {
    try {
      // ① 官方侧栏的选中卡片（实测 class 含 `_selected_`）
      var sel = document.querySelector('[data-conversation-id][class*="_selected_"]')
        || document.querySelector('[data-conversation-id][class*="selected"]')
        || document.querySelector('[data-conversation-id][aria-selected="true"]');
      if (sel) {
        var id = String(sel.getAttribute('data-conversation-id') || '').trim();
        if (/^[A-Za-z0-9_-]{6,64}$/.test(id)) return id;
      }
      // ② 兼容层（不同客户端版本导出名可能不同）
      if (window.__WBS_COMPAT && typeof window.__WBS_COMPAT.getSelectedConversationId === 'function') {
        var v = window.__WBS_COMPAT.getSelectedConversationId(document);
        if (v && /^[A-Za-z0-9_-]{6,64}$/.test(String(v))) return String(v);
      }
    } catch (_) {}
    return '';
  }

  var _lastBind = '';
  var _lastBindAt = 0;
  function reportBind() {
    var sid = readOpenSid();
    if (!sid) return;
    var now = Date.now();
    // ⚠️⚠️⚠️ 不能只在「sid 变了」时才上报，必须**周期性续约**。
    //   后端 BIND_TTL 只有 120 秒，到期就作废回落 mtime —— 那时你明明还坐在这条
    //   会话里，AI 却可能因为别的窗口在写文件而认到另一条去。
    //   实测踩过：改成「变了才发」之后 ageMs 一路涨到 120 秒，绑定直接失效。
    if (sid === _lastBind && now - _lastBindAt < 5000) return;
    var changed = sid !== _lastBind;
    _lastBind = sid;
    _lastBindAt = now;
    api('/api/ck-memory/bind', { method: 'POST', body: { sid: sid } })
      .then(function (j) {
        // 后端认了才更新本地视图：绑定变了 ⇒ 跟随模式下的目标也变了，立刻重拉
        if (j && j.accepted && changed) {
          if (S.list) S.list.activeSid = sid;
          // ⚠️ 与 pickSession 同理：默认视图是「事实」时不能在后台把视图悄悄换成原话列表。
          //   这里只清空缓存，让当前视图自己决定拉什么。
          if (!S.selSid) {
            S.hits = []; S.items = [];
            loadSessions().then(loadStatus).then(function () {
              if (S.mode === 'facts') return loadFacts();
              return loadRecent();
            });
          }
        }
      })
      .catch(function () { /* 静默：上报失败就继续用 mtime 兜底 */ });
  }

  function loadSessions() {
    return api('/api/ck-memory/sessions').then(function (j) {
      S.list = {
        activeSid: j.activeSid || '',
        followed: j.followed || [],
        onDisk: j.onDisk || 0,
        bind: j.bind || null,
      };
      S.sessions = j.items || [];
      if (S.selSid && !selItem()) S.selSid = '';
      render();
    }).catch(function (e) {
      S.err = '读取会话列表失败：' + e.message;
      render();
    });
  }

  function pickSession(sid) {
    S.selSid = String(sid || '');
    S.hits = [];
    S.items = [];
    S.q = '';
    /**
     * ⚠️ 2026-11-05：切会话后**保持当前视图类型**。
     *
     * 旧逻辑是「切到别的会话就强制 loadRecent / loadTimeline」，在默认视图是
     * 「最近」的年代没问题（切会话本来就是想看看那条说了什么）。
     * 但现在默认视图是「记住了什么」（事实），用户在事实页切换会话，
     * 期望是「看那条会话记住了什么」，不是被弹回原话列表 —— 实测会觉得「切一下就跳走了」。
     * 所以：事实视图下切会话 → 重新拉那条会话的事实；其余视图沿用旧行为。
     */
    if (S.mode === 'facts') {
      S.fcons = false; S.fent = false;
      render();
      return loadFacts();
    }
    // 历史会话用「最近 6 小时」必然是空的（它今天压根没说话）⇒ 直接给时间线，
    // 否则用户切过去只看到一句「这个时间段内没有对话」，以为索引坏了。
    var isAct = !sid || (S.list && S.list.activeSid === sid);
    if (isAct) loadRecent(); else loadTimeline();
  }
  /** 批量加入跟踪：面板里「把最大的几条都加上」走这条。 */
  function followMany(sids) {
    if (!sids || !sids.length) return;
    S.busy = 'follow'; S.err = ''; render();
    api('/api/ck-memory/follow', { method: 'POST', body: { sids: sids, on: true } })
      .then(function (j) {
        S.note = '已加入 ' + (j.changed || sids.length) + ' 条，正在后台慢慢补索引';
        return loadSessions();
      })
      .then(function () { return loadStatus(); })
      .catch(function (e) { S.err = '批量加入失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function toggleFollow() {
    var sid = targetSid();
    if (!sid) return;
    var on = followedOf(sid);
    S.busy = 'follow'; S.err = ''; render();
    api('/api/ck-memory/follow', { method: 'POST', body: { sid: sid, on: !on } })
      .then(function () {
        S.note = on ? '已停止跟踪（已有索引保留）' : '已加入跟踪，正在补索引…';
        if (on) return null;
        // 刚加入就立刻索引一次，不用等 30 秒那轮
        return api('/api/ck-memory/index', { method: 'POST', body: { sid: sid } }).then(function (j) {
          S.note = '已加入跟踪 · 本次补了 ' + (j.added || 0) + ' 条';
        }).catch(function () { /* 索引失败不影响跟踪状态 */ });
      })
      .then(function () { return loadSessions(); })
      .then(function () { return loadStatus(); })
      .catch(function (e) { S.err = '操作失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  /**
   * 事实视图（阶段 4）：把「提炼出来的事实」按时间倒序列出来。
   *
   * 与「时间线」的区别要说清楚，否则用户会以为是同一个东西：
   *   时间线 = 我说过什么（原文，逐条）
   *   事实   = 提炼出来的结论（一句话，跨说法可检索）
   *
   * ⚠️ 默认只显示**仍有效**的事实。「已失效」不是被删掉，而是被更新的事实取代了；
   *   勾上「含失效」能看到完整的时间演化，这正是双时间设计要保的东西。
   */
  /**
   * 实体视图渲染（阶段 5）。
   *
   * 交互刻意做成「点一下就地展开关联事实」，而不是「点一下跳到搜索框」：
   *   跳到搜索框等于把精确查询又变成一次模糊搜索（用户还得看结果猜对不对）；
   *   实体命中的语义是**等值**，展开给的就是确定的那些条，不需要再排相关性。
   */
  function renderEnts(list) {
    var items = S.ents || [];
    var picked = S.entPick || '';

    // 顶部：回退到事实列表
    var ops = el('div', 'ckm-fact-ops');
    var bBack = el('button', 'ckm-btn', '← 事实列表');
    bBack.onclick = function () { S.fent = false; S.entPick = ''; render(); };
    ops.appendChild(bBack);
    ops.appendChild(el('span', 'ckm-fact-s', items.length ? (num(items.length) + ' 个标识符') : ''));
    ops.appendChild(el('span', 'ckm-grow'));
    var bRf = el('button', 'ckm-btn', '刷新');
    bRf.onclick = function () { loadEnts(); };
    ops.appendChild(bRf);
    list.appendChild(ops);

    if (!items.length) {
      var em = el('div', 'ckm-empty');
      em.textContent = S.entLoading
        ? '读取中…'
        : '这个会话里还没有可精确检索的标识符。\n\n' +
          '「标识符」指单号 / 税号 / 版本号 / 端口 / 文件名这类**唯一**的串。\n' +
          '它们来自已提炼的事实 —— 事实里没提到具体编号时，这里自然是空的。';
      list.appendChild(em);
      return;
    }

    // 清单：点一个 → 就地展开它关联的事实
    var wrap = el('div', 'ckm-ent-list');
    for (var i = 0; i < items.length; i++) {
      (function (it) {
        var on = picked && picked === it.norm;
        var row = el('button', 'ckm-ent' + (on ? ' on' : ''));
        row.title = '点一下看它关联的 ' + num(it.n) + ' 条事实\n' +
          '归一化后是：' + it.norm + '\n' +
          '（大小写 / 空格 / 连字符的差异都算同一个）';
        row.appendChild(el('span', 'ckm-ent-t', it.ent));
        row.appendChild(el('span', 'ckm-ent-n', num(it.n)));
        row.onclick = function () {
          S.entPick = on ? '' : it.norm;
          S.entFacts = [];
          render();
          if (S.entPick) loadEntFacts(S.entPick);
        };
        wrap.appendChild(row);

        if (on) {
          var box = el('div', 'ckm-ent-box');
          var listF = S.entFacts || [];
          if (S.entLoading) {
            box.appendChild(el('div', 'ckm-note', '读取中…'));
          } else if (!listF.length) {
            box.appendChild(el('div', 'ckm-note', '这个标识符没有关联到事实（可能都被标失效了）'));
          } else {
            for (var j = 0; j < listF.length; j++) {
              var f = listF[j];
              var card = el('div', 'ckm-fact' + (f.expired ? ' off' : ''));
              var top = el('div', 'ckm-fact-top');
              top.appendChild(el('span', 'ckm-fact-k k-' + (f.kind || 'other'), kindLabel(f.kind)));
              top.appendChild(el('span', 'ckm-fact-t', factTime(f.validFrom)));
              if (f.expired) {
                var eb = el('span', 'ckm-fact-bad', '已失效');
                eb.title = '被后来的事实取代了。数据还在（没删）。';
                top.appendChild(eb);
              }
              card.appendChild(top);
              card.appendChild(el('div', 'ckm-fact-text', f.text));
              box.appendChild(card);
            }
          }
          wrap.appendChild(box);
        }
      })(items[i]);
    }
    list.appendChild(wrap);
  }

  function renderFacts(list) {
    var st = S.fstat || {};
    var arr = S.facts || [];

    /**
     * 实体视图（阶段 5）：把「可精确检索的键」列出来，点一个就取关联事实。
     * ⚠️ 它画在事实页的同一个 list 里（不是新开一页）：两者回答的是同一类问题
     *   （「我现在知道什么」），来回切页会让用户丢掉上下文。
     */
    if (S.fent) { renderEnts(list); return; }

    // ── 顶部统计条 ──
    var head = el('div', 'ckm-fact-head');
    var hMain = el('div', 'ckm-fact-h');
    hMain.appendChild(el('span', 'ckm-fact-n', num(st.live || 0)));
    hMain.appendChild(el('span', 'ckm-fact-l', '条有效事实'));
    if (st.expired) {
      var bExp = el('span', 'ckm-fact-s', '另有 ' + num(st.expired) + ' 条已失效');
      bExp.title = '失效 ≠ 删除。旧结论被新结论取代时会标上失效时间，' +
        '一行都不删 —— 这样「之前是不是说过…」这类时序问题才答得出来。\n勾选下方「含失效」可以看完整演化。';
      hMain.appendChild(bExp);
    }
    head.appendChild(hMain);

    var sub = el('div', 'ckm-fact-sub');
    var bits = [];
    if (st.today) bits.push('今天新增 ' + num(st.today));
    if (st.calls) bits.push('调用 ' + num(st.calls) + ' 次');
    if (st.got) bits.push('共抽出 ' + num(st.got) + ' 条');
    if ((st.kinds || []).length) {
      bits.push(st.kinds.slice(0, 4).map(function (k) { return kindLabel(k.kind) + ' ' + num(k.n); }).join(' · '));
    }
    sub.appendChild(document.createTextNode(bits.length ? bits.join('　') : '还没有提炼过事实'));
    head.appendChild(sub);
    list.appendChild(head);

    // ── 操作条 ──
    var ops = el('div', 'ckm-fact-ops');

    var bX = el('button', 'ckm-btn', S.busy === 'fact' ? '提炼中…' : '立即提炼');
    bX.disabled = !!S.busy;
    bX.title = '把当前会话最近这段对话送给模型，提炼成一句话事实。\n' +
      '平时是后台自动做的（攒够 ' + '若干' + ' 回合或等超时就抽），这个按钮是「现在就要」。\n' +
      '⚠️ 一次调用约 10 秒、消耗模型额度。';
    bX.onclick = function () { extractNow(); };
    ops.appendChild(bX);

    var bU = el('button', 'ckm-btn' + (S.fexp ? ' on' : ''), S.fexp ? '含失效' : '只看有效');
    bU.title = '「已失效」是被新结论取代的旧事实，不是删除。\n时序类提问（「之前说未付吗」）要用到它。';
    bU.onclick = function () { S.fexp = !S.fexp; loadFacts(); };
    ops.appendChild(bU);

    /**
     * 实体视图（阶段 5）。
     *
     * 为什么要有这个入口：实体是**唯一能精确列的维度**。
     * 搜「尾款」是让人猜词，搜「YKW-SU-260713」是给一个确定的键 ——
     * 但用户不可能记得住库里有哪些单号 / 端口 / 版本号。
     * 把清单摊开，等于告诉他「这几个键可以精确查」。
     */
    var bE = el('button', 'ckm-btn' + (S.fent ? ' on' : ''), '按实体');
    bE.title = '看这个会话里出现过哪些「强标识符」（单号 / 税号 / 版本号 / 端口 / 文件名）。\n' +
      '这些是能**精确**查的键 —— 点一个就列出关联的全部事实，不用猜词。';
    bE.onclick = function () {
      S.fent = !S.fent;
      if (S.fent) loadEnts();
      else render();
    };
    ops.appendChild(bE);

    /**
     * 后台整理入口（阶段 6 后半段）。
     *
     * ⚠️ 为什么放在事实页的按钮条上、而不是新开一个标签：
     *   整理的对象就是「事实」，用户看到「这条事实和那条像是重复的」时，
     *   顺手就能去处理；另开一页会让两个视角断开。
     */
    var bC = el('button', 'ckm-btn' + (S.fcons ? ' on' : ''), '整理');
    bC.title = '清理事实层：补实体链接 / 找出重复表述 / 检查误标失效。\n' +
      '⚠️ 合并**不会自动做** —— 程序只列出可疑的并说明理由，你点确认才改，改错可回滚。';
    bC.onclick = function () {
      S.fcons = !S.fcons;
      if (S.fcons) { loadConsHist(); if (!S.consCand) loadConsCand(); }
      else render();
    };
    ops.appendChild(bC);

    // 搜索框（事实层自己的，与原文搜索分开 —— 两边口径不同，共用一个输入框会互相干扰）
    var q = document.createElement('input');
    q.className = 'ckm-fact-q';
    q.type = 'search';
    q.placeholder = '搜事实…';
    q.value = S.fq || '';
    var tq = null;
    q.oninput = function () {
      var v = this.value;
      if (tq) clearTimeout(tq);
      tq = track(setTimeout(function () { S.fq = v; loadFacts(); }, 350));
    };
    ops.appendChild(q);
    list.appendChild(ops);

    // 最近一次抽取出错：必须显示原因（这是排查「点了没反应」的唯一窗口）
    if (st.err) {
      var e1 = el('div', 'ckm-err', '上次抽取失败：' + st.err);
      list.appendChild(e1);
    }
    if (S.flast && S.flast.why && S.flast.why !== 'nothing-new' && S.flast.why.indexOf('wait-turns') !== 0 && S.flast.added === 0) {
      list.appendChild(el('div', 'ckm-note', '上次提炼未产出：' + S.flast.why));
    }

    // ── 列表 ──
    if (!arr.length) {
      /**
       * ⚠️⚠️ 空态必须说清「是哪条会话没有事实」。
       *   踩过：在 A 会话触发提炼、面板看的是 B 会话 ⇒ 显示「还没有事实」，
       *   用户会以为功能坏了。事实是按会话隔离的，绝大多数困惑都来自这一点。
       */
      var curName = '当前会话';
      if (S.selSid && S.sessions) {
        for (var si = 0; si < S.sessions.length; si++) {
          if (S.sessions[si].sid === S.selSid) {
            curName = '「' + (S.sessions[si].title || S.sessions[si].short) + '」';
            break;
          }
        }
      }
      var empty = el('div', 'ckm-empty');
      if (S.fq) {
        empty.textContent = curName + '里没有匹配的事实。\n\n试试换个说法，或勾上「含失效」。';
      } else {
        empty.textContent = curName + '还没有提炼出事实。\n\n' +
          '事实是从对话里提炼出的一句话结论（比如「某某订单尾款 USD 230,000 未付」），\n' +
          '好处是换个说法也能查到，不必命中当时的原话。\n\n' +
          '后台攒够几个回合会自动提炼，也可以点上面的「立即提炼」。\n' +
          '⚠️ 事实按会话分开存 —— 别的会话里的事实不会出现在这里，\n' +
          '要看得在会话下拉里切到那条会话。';
      }
      list.appendChild(empty);
      return;
    }

    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      var card = el('div', 'ckm-fact' + (f.expired ? ' off' : ''));

      var top = el('div', 'ckm-fact-top');
      var kb = el('span', 'ckm-fact-k k-' + (f.kind || 'other'), kindLabel(f.kind));
      kb.title = '事实类型：' + (f.kind || 'other');
      top.appendChild(kb);
      var tb = el('span', 'ckm-fact-t', factTime(f.validFrom));
      tb.title = '这条事实从什么时候开始为真' + (f.expired ? '\n已于 ' + factTime(f.validTo) + ' 失效' : '');
      top.appendChild(tb);
      if (f.expired) {
        var eb = el('span', 'ckm-fact-bad', '已失效');
        eb.title = '被后来的事实取代了。数据还在（没删），勾「含失效」才看得到。';
        top.appendChild(eb);
      }
      if (f.exact) {
        var xb = el('span', 'ckm-fact-ex', '精确');
        xb.title = '查询里带了具体编号 / 版本号，这条是字面命中（比词法相似更可信）';
        top.appendChild(xb);
      }
      if (f.hits) {
        var hb = el('span', 'ckm-hitn', '用过 ' + num(f.hits) + ' 次');
        top.appendChild(hb);
      }
      card.appendChild(top);

      var t = el('div', 'ckm-fact-text', f.text);
      card.appendChild(t);

      // 底部：溯源 + 操作
      var foot = el('div', 'ckm-fact-foot');
      if (f.srcSegId) {
        var src = el('button', 'ckm-fact-src', '看原话');
        src.title = '跳到这条事实所依据的那段原文（seq ' + f.srcSegId + '）';
        src.onclick = (function (seq) {
          return function () {
            // 复用原文搜索：按事实文本里的强标识符找，比按 seq 找更稳
            //（seq 是 seg.id，原文视图按 seq 展示，两者不通用）
            S.mode = 'search'; S.q = S.fq || '';
            var ids = (f.text.match(/[A-Za-z]{2,}[-_#]?\d{2,}|\d{5,}|\bv?\d+\.\d+\.\d+|\S+\.[A-Za-z]{2,5}/g) || []);
            if (ids.length) { S.q = ids[0]; if (q) q.value = S.q; loadSearch(); }
            else { S.q = f.text.slice(0, 20); if (q) q.value = S.q; loadSearch(); }
          };
        })(f.srcSegId);
        foot.appendChild(src);
      }
      var fModel = f.model ? el('span', 'ckm-fact-m', f.model) : null;
      if (fModel) { fModel.title = '抽取这条事实所用的模型'; foot.appendChild(fModel); }

      var sp = el('div', 'ckm-fact-sp');
      foot.appendChild(sp);

      if (f.expired) {
        var bR = el('button', 'ckm-btn tiny', '恢复');
        bR.title = '把失效标记去掉（这条事实重新算作有效）';
        bR.onclick = (function (id) { return function () { markFact(id, 'restore'); }; })(f.id);
        foot.appendChild(bR);
      } else {
        var bE = el('button', 'ckm-btn tiny', '标失效');
        bE.title = '不删除，只标记「这条已经不成立了」\n时序类提问还要用它，所以不提供直接删掉的说法';
        bE.onclick = (function (id) { return function () { markFact(id, 'expire'); }; })(f.id);
        foot.appendChild(bE);
      }
      var bD = el('button', 'ckm-btn tiny danger', '删除');
      bD.title = '真的删掉这一行（不可恢复）。\n⚠️ 只删这条事实，聊天原文一个字不动。';
      bD.onclick = (function (id) { return function () { markFact(id, 'delete'); }; })(f.id);
      foot.appendChild(bD);

      card.appendChild(foot);
      list.appendChild(card);
    }
  }

  /** 事实类型的中文名（面板上直接显示英文 kind 会很难读）。 */
  function kindLabel(k) {
    var map = {
      order: '订单', money: '金额', shipment: '船期', party: '客户',
      tech: '技术', decision: '决定', contact: '联系人', other: '其他',
    };
    return map[k] || '其他';
  }

  /** 事实时间：只到「日」，事实粒度不需要秒。 */
  function factTime(ms) {
    if (!ms) return '';
    try {
      var d = new Date(Number(ms));
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } catch (_) { return ''; }
  }

  /**
   * 记忆管理视图：列出「已经建了记忆的会话」，可勾选删除。
   *
   * 为什么要有这个视图：单条删除按钮（「删索引」）只在**已经选中那条会话**时才可用，
   * 用户想清理时得先在几十条会话里一条条点过去 —— 等于没有批量能力。
   * 这里把所有「已建记忆」的会话排成一张表，直接看到占用大小、有效记忆数，
   * 勾选后一次删掉；顺带给一个「清空全部」的兜底入口。
   *
   * ⚠️ 删除永远只删记忆索引（seg + seg_fts + sessions 行），聊天原文 .jsonl 一个字不动。
   */
  function renderMgr(list) {
    var arr = (S.sessions || []).filter(function (x) { return x.indexed; });
    arr.sort(function (a, b) { return (b.valid || 0) - (a.valid || 0); });

    var head = el('div', 'ckm-mgr-head');
    var cnt = Object.keys(S.picked || {}).filter(function (k) { return S.picked[k]; }).length;
    head.appendChild(el('div', 'ckm-mgr-title',
      arr.length ? ('已建记忆的会话 ' + arr.length + ' 条') : '还没有任何会话建过记忆'));
    if (cnt) head.appendChild(el('div', 'ckm-mgr-sel', '已选 ' + cnt + ' 条'));
    list.appendChild(head);

    if (!arr.length) {
      list.appendChild(el('div', 'ckm-empty', '打开任意一条会话，几秒内就会自动开始建记忆。'));
      return;
    }

    // 顶部操作条：全选 / 删除选中 / 清空全部
    var ops = el('div', 'ckm-mgr-ops');
    var bAll = el('button', 'ckm-btn', cnt === arr.length ? '取消全选' : '全选');
    bAll.onclick = function () {
      var on = cnt !== arr.length;
      S.picked = {};
      if (on) for (var i = 0; i < arr.length; i++) S.picked[arr[i].sid] = true;
      render();
    };
    ops.appendChild(bAll);

    var bDel = el('button', 'ckm-btn danger', '删除选中' + (cnt ? '（' + cnt + '）' : ''));
    bDel.disabled = !cnt;
    bDel.onclick = function () {
      var sids = Object.keys(S.picked).filter(function (k) { return S.picked[k]; });
      dropMany(sids);
    };
    ops.appendChild(bDel);

    var bAll2 = el('button', 'ckm-btn', '全部删除');
    bAll2.onclick = function () {
      dropMany(arr.map(function (x) { return x.sid; }), true);
    };
    ops.appendChild(bAll2);
    list.appendChild(ops);

    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      var row = el('div', 'ckm-mgr-row' + (S.picked[it.sid] ? ' on' : ''));
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ckm-mgr-cb';
      cb.checked = !!S.picked[it.sid];
      cb.onchange = (function (sid) {
        return function () {
          if (this.checked) S.picked[sid] = true; else delete S.picked[sid];
          render();
        };
      })(it.sid);
      row.appendChild(cb);

      var main = el('div', 'ckm-mgr-main');
      var tLine = el('div', 'ckm-mgr-t');
      tLine.appendChild(document.createTextNode(it.title || ('（无标题）' + it.short)));
      if (S.list && S.list.activeSid === it.sid) {
        var curB = el('span', 'ckm-opt-b f', '当前');
        curB.style.marginLeft = '5px';
        curB.title = 'AI 现在查的就是这条';
        tLine.appendChild(curB);
      }
      main.appendChild(tLine);
      var sub = el('div', 'ckm-mgr-s');
      sub.appendChild(document.createTextNode(
        it.short + ' · ' + it.sizeMB + ' MB · 有效记忆 ' + num(it.valid || 0) +
        ' 条（你说的话 ' + num(it.userRows || 0) + '） · ' + (it.indexedAt || '')));
      main.appendChild(sub);
      row.appendChild(main);

      // 单条「打开」：切到这条会话的记忆（不是切客户端的会话，只是面板里查看它）
      var bOpen = el('button', 'ckm-btn', '查看');
      bOpen.onclick = (function (sid) {
        return function (e) {
          e.stopPropagation();
          S.mgr = false;
          S.picked = {};
          pickSession(sid);
          render();
        };
      })(it.sid);
      row.appendChild(bOpen);

      var bOne = el('button', 'ckm-btn danger', '删除');
      bOne.onclick = (function (sid, title) {
        return function (e) {
          e.stopPropagation();
          if (!window.confirm('删除这条会话的记忆？\n\n' + (title || sid.slice(0, 8)) +
            '\n\n只删记忆索引（' + num(it.valid || 0) + ' 条有效记忆），聊天原文一个字都不动。\n以后重新打开这条会话会自动重建。\n\n继续？')) return;
          dropMany([sid]);
        };
      })(it.sid, it.title);
      row.appendChild(bOne);

      list.appendChild(row);
    }
  }

  /** 批量删除记忆索引（只删索引，不动 .jsonl 原文）。 */
  function dropMany(sids, all) {
    sids = sids || [];
    if (!sids.length) return;
    if (all) {
      if (!window.confirm('删除全部 ' + sids.length + ' 条会话的记忆？\n\n' +
        '只删记忆索引，聊天原文一个字都不动。\n删完这些会话的记忆就查不到了，重新打开会自动重建。\n\n确定继续？')) return;
    }
    S.busy = 'drop'; S.err = ''; render();
    api('/api/ck-memory/dropMany', { method: 'POST', body: { sids: sids } })
      .then(function (j) {
        S.note = '已删除 ' + (j.dropped || 0) + ' 条会话的记忆（共 ' + num(j.removed || 0) + ' 行索引）';
        S.picked = {};
        S.hits = []; S.items = [];
        return loadSessions();
      })
      .then(loadStatus)
      .catch(function (e) { S.err = '删除失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function dropSelected() {
    var sid = targetSid();
    if (!sid) return;
    if (!window.confirm('删除这条会话的记忆索引？\n\n只删索引，聊天原文一个字都不动，随时可以重新索引。\n\n继续？')) return;
    S.busy = 'drop'; S.err = ''; render();
    api('/api/ck-memory/drop', { method: 'POST', body: { sid: sid } })
      .then(function (j) {
        S.hits = []; S.items = []; S.note = '已删除索引（' + num(j.removed || 0) + ' 条）';
        return loadSessions();
      })
      .then(loadStatus)
      .catch(function (e) { S.err = '删除失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  /* ── 实体索引（阶段 5）─────────────────────────────────────────── */

  /**
   * 拉实体清单。
   *
   * ⚠️ 只做「列清单」这一件事，不在同一个请求里带事实正文：
   *   一个会话可能有几十个标识符，全带正文会让首屏变慢几百毫秒，
   *   而用户通常只点其中一两个 —— 展开时再取（loadEntFacts）更划算。
   */
  function loadEnts() {
    S.entLoading = true;
    if (!S.ents) S.ents = [];
    render();
    var qs = ['limit=120'];
    if (S.selSid) qs.push('sid=' + encodeURIComponent(S.selSid));
    return api('/api/ck-memory/entities?' + qs.join('&')).then(function (j) {
      S.ents = j.items || [];
      S.entLoading = false;
      S.err = '';
      render();
    }).catch(function (e) {
      S.entLoading = false;
      S.err = '读取实体失败：' + e.message;
      render();
    });
  }

  /** 拉某个实体关联的事实（点开才拉）。 */
  function loadEntFacts(norm) {
    S.entLoading = true;
    S.entFacts = [];
    render();
    var qs = ['ent=' + encodeURIComponent(norm)];
    if (S.selSid) qs.push('sid=' + encodeURIComponent(S.selSid));
    return api('/api/ck-memory/ent-facts?' + qs.join('&')).then(function (j) {
      // 用户可能在请求飞回来之前又点了别的实体 ⇒ 只认最后一次点击的结果
      if (S.entPick !== norm) return;
      S.entFacts = j.items || [];
      S.entLoading = false;
      render();
    }).catch(function (e) {
      if (S.entPick !== norm) return;
      S.entLoading = false;
      S.err = '读取实体事实失败：' + e.message;
      render();
    });
  }

  /**
   * 后台整理视图（阶段 6 后半段 · sleeptime）。
   *
   * ⚠️⚠️⚠️ 这一页的设计核心是「**程序只列、人来定**」，所以它长成
   *   「候选清单（带正面理由 + 一票否决项）」而不是「一键整理」按钮：
   *
   *   实测证据（8 组同义表述 × 每组 3 种说法，jaccard 分布 0.409 ~ 0.818）：
   *     必须拒绝的对照组「已装运 vs 未装运」= 0.733、「AB-260713 vs CD-260713」= 0.750
   *   ⇒ 同义组的最低值**低于**对照组。任何单一阈值都不可能既不误合又合得动。
   *
   *   误合的后果：那条结论从检索里消失，**而用户不知道自己被丢了什么**。
   *   漏合的后果：检索结果里多几条相似的话，一眼就能看出来，自己决定要不要处理。
   *   两者不对称 ⇒ 宁可漏合。所以这里只有「标记可疑」和「人点确认」两个动作。
   *
   *   能不能自动化的是「补实体」（纯本地重算、无判断成份）和「回滚」（纯反操作）。
   */
  function renderConsol(list) {
    var cands = S.consCand || [];
    var hist = S.consHist || [];

    // ── 顶部操作条 ──
    var ops = el('div', 'ckm-fact-ops');
    var bBack = el('button', 'ckm-btn', '← 事实列表');
    bBack.onclick = function () { S.fcons = false; S.consOpen = ''; render(); };
    ops.appendChild(bBack);

    var bScan = el('button', 'ckm-btn', S.consBusy === 'scan' ? '扫描中…' : '扫描候选');
    bScan.disabled = !!S.consBusy;
    bScan.title = '在当前会话里找「可能是同一件事的两种说法」的事实对。\n' +
      '⚠️ 只列出来，一条都不改 —— 改不改由你点。\n' +
      '（自动合并的判据在实测数据上做不到既不误合又合得动，见下方说明）';
    bScan.onclick = function () { loadConsCand(); };
    ops.appendChild(bScan);

    var bEnt = el('button', 'ckm-btn', S.consBusy === 'ent' ? '整理中…' : '补实体链接');
    bEnt.disabled = !!S.consBusy;
    bEnt.title = '重新扫一遍所有事实，把漏掉的标识符（单号 / 版本号 / 端口 / 文件名）补进实体索引。\n' +
      '这一步是纯本地重算，没有判断成份，可以放心自动跑（后台每 6 小时也会做）。\n' +
      '补上之后，「按实体」查能命中更多条。';
    bEnt.onclick = function () { runConsol('ent'); };
    ops.appendChild(bEnt);

    var bRv = el('button', 'ckm-btn', S.consBusy === 'revive' ? '检查中…' : '检查误标失效');
    bRv.disabled = !!S.consBusy;
    bRv.title = '找「当时判冲突、但顶掉它的那条后来自己也失效了」的孤儿条目 —— 那多半是连环误判。\n' +
      '⚠️ 只处理**程序自动标的**（conflict），你在面板上手动标失效的（manual）一条都不会碰。\n' +
      '默认不自动跑：翻案要谨慎，恢复错了比少一条更让人困惑。';
    bRv.onclick = function () { runConsol('revive'); };
    ops.appendChild(bRv);

    ops.appendChild(el('span', 'ckm-grow'));
    var bRf = el('button', 'ckm-btn', '刷新');
    bRf.onclick = function () { loadConsHist(); if (S.consCand) loadConsCand(); };
    ops.appendChild(bRf);
    list.appendChild(ops);

    // ── 说明块（为什么不能一键自动合并）──
    var why = el('div', 'ckm-note ckm-cons-why');
    why.textContent =
      '为什么没有「一键自动合并」：\n' +
      '实测 8 组同义表述，"同一件事的不同说法"重合度只有 0.41~0.82；' +
      '而"两件不同的事"比如「已装运 / 未装运」重合度高达 0.73、' +
      '「AB-260713 / CD-260713」0.75 —— **比同义表述还像**。\n' +
      '所以自动合并一定会误合，而误合等于让一条结论凭空消失（你还不知道丢了什么）。' +
      '这里改成：程序把可疑的挑出来并说明理由，你点确认才改；改错了随时能回滚。';
    list.appendChild(why);

    // ── 候选清单 ──
    if (S.consCand) {
      var risky = 0, blocked = 0;
      for (var i = 0; i < cands.length; i++) { if ((cands[i].blockers || []).length) blocked++; else risky++; }

      var h = el('div', 'ckm-cons-h');
      h.appendChild(el('span', 'ckm-cons-hn', String(risky)));
      h.appendChild(el('span', 'ckm-cons-hl', '对可疑（无否决项）'));
      if (blocked) h.appendChild(el('span', 'ckm-fact-s', '另有 ' + blocked + ' 对是否决项，已折叠'));
      list.appendChild(h);

      if (!cands.length) {
        list.appendChild(el('div', 'ckm-empty',
          '没有找到可疑的重复。\n\n要么事实本来就各不相同，要么这个会话的事实还太少。'));
      }

      for (var k = 0; k < cands.length; k++) {
        (function (c) {
          var isBlocked = (c.blockers || []).length > 0;
          var card = el('div', 'ckm-cons-card' + (isBlocked ? ' blocked' : ''));

          var top = el('div', 'ckm-cons-top');
          top.appendChild(el('span', 'ckm-cons-j', '重合 ' + Math.round(c.jac * 100) + '%'));
          if (isBlocked) {
            var bb = el('span', 'ckm-fact-bad', '不建议合并');
            bb.title = '命中了下面这些「一票否决」条件，程序判定它们不是同一件事。';
            top.appendChild(bb);
          } else {
            var gb = el('span', 'ckm-cons-ok', '可能是同一件事');
            top.appendChild(gb);
          }
          card.appendChild(top);

          // 两条正文，标出建议保留哪条
          var pair = el('div', 'ckm-cons-pair');
          var rows = [
            { f: c.a, keep: c.keep === c.a.id },
            { f: c.b, keep: c.keep === c.b.id },
          ];
          for (var r = 0; r < rows.length; r++) {
            var row = el('div', 'ckm-cons-row' + (rows[r].keep ? ' keep' : ''));
            var tag = el('span', 'ckm-cons-tag', rows[r].keep ? '保留' : '合并掉');
            tag.title = rows[r].keep
              ? '建议保留这条：它出现得更早（先说的那条是原始陈述，后说的往往是复述）。\n合并只会把另一条标失效，正文一行都不删。'
              : '确认后这条会被标上失效时间（不是删除）。随时可以从下方「整理历史」回滚。';
            row.appendChild(tag);
            row.appendChild(el('span', 'ckm-cons-tx', rows[r].f.text));
            row.appendChild(el('span', 'ckm-cons-id', '#' + rows[r].f.id));
            pair.appendChild(row);
          }
          card.appendChild(pair);

          // 正面理由
          if ((c.reasons || []).length) {
            var rb = el('div', 'ckm-cons-reasons');
            rb.appendChild(el('span', 'ckm-cons-lb', '为什么像：'));
            rb.appendChild(document.createTextNode((c.reasons || []).join('；')));
            card.appendChild(rb);
          }
          // 否决项
          if (isBlocked) {
            var bl = el('div', 'ckm-cons-blockers');
            bl.appendChild(el('span', 'ckm-cons-lb', '不能合：'));
            bl.appendChild(document.createTextNode((c.blockers || []).join('；')));
            card.appendChild(bl);
          }

          // 确认按钮（否决项也允许点 —— 但点了服务端会重新校验并拒绝，
          // 这样用户能亲眼看到「为什么拒」，而不是被灰掉的按钮糊弄过去）
          var act = el('div', 'ckm-cons-act');
          var bGo = el('button', 'ckm-btn' + (isBlocked ? '' : ' on'), '合并这两条');
          bGo.disabled = !!S.consBusy;
          bGo.onclick = function () {
            if (S.consBusy) return;
            S.consBusy = 'merge';
            render();
            api('/api/ck-memory/consolidate-merge', {
              method: 'POST', body: { keep: c.keep, drop: c.keep === c.a.id ? c.b.id : c.a.id },
            }).then(function (j) {
              S.consBusy = '';
              if (j.ok) {
                S.err = '';
                S.note = '已合并 #' + j.dropped + ' → 保留 #' + j.kept + '（可在整理历史里回滚）';
              } else {
                S.err = '没有合并：' + (j.why || '未知原因');
              }
              loadConsCand();
              loadConsHist();
              loadFacts();
            }).catch(function (e) {
              S.consBusy = '';
              S.err = '合并失败：' + e.message;
              render();
            });
          };
          act.appendChild(bGo);
          card.appendChild(act);

          list.appendChild(card);
        })(cands[k]);
      }
    }

    // ── 整理历史（可回滚）──
    var hh = el('div', 'ckm-cons-h');
    hh.appendChild(el('span', 'ckm-cons-hl', '整理历史（可回滚）'));
    list.appendChild(hh);

    if (!hist.length) {
      list.appendChild(el('div', 'ckm-note',
        '还没有整理记录。补实体是自动跑的（后台每 6 小时一次），合并需要你自己确认。'));
      return;
    }

    var hl = el('div', 'ckm-cons-hist');
    for (var m = 0; m < hist.length; m++) {
      (function (it) {
        var open = S.consOpen === it.runId;
        var row = el('div', 'ckm-cons-hrow' + (open ? ' on' : ''));
        var btn = el('button', 'ckm-cons-hbtn');
        btn.title = '点开看这一轮具体改了哪几条';
        var t = el('span', 'ckm-cons-htime', timeLabel(it.at));
        btn.appendChild(t);
        var parts = [];
        if (it.ent) parts.push('补实体 ' + it.ent);
        if (it.merge) parts.push('合并 ' + it.merge);
        if (it.revive) parts.push('恢复 ' + it.revive);
        btn.appendChild(el('span', 'ckm-cons-hsum', parts.length ? parts.join(' · ') : (it.n + ' 条')));
        if (it.undone) btn.appendChild(el('span', 'ckm-cons-hund', '已回滚'));
        btn.onclick = function () {
          S.consOpen = open ? '' : it.runId;
          S.consDet = null;
          render();
          if (S.consOpen) loadConsDet(S.consOpen);
        };
        row.appendChild(btn);

        if (it.open > 0) {
          var bUndo = el('button', 'ckm-btn ckm-cons-undo', '回滚');
          bUndo.title = '把这一轮的改动全部撤回（' + it.open + ' 条）—— 一条都不会丢，只是把当时的快照写回去。';
          bUndo.disabled = !!S.consBusy;
          bUndo.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (S.consBusy) return;
            S.consBusy = 'undo';
            render();
            api('/api/ck-memory/consolidate', { method: 'POST', body: { rollback: it.runId } })
              .then(function (j) {
                S.consBusy = '';
                if (j.ok) S.note = '已回滚 ' + j.reverted + ' 条（' + it.runId + '）';
                else S.err = '回滚失败：' + (j.why || j.error || '未知原因');
                loadConsHist();
                loadFacts();
              }).catch(function (e) {
                S.consBusy = '';
                S.err = '回滚失败：' + e.message;
                render();
              });
          };
          row.appendChild(bUndo);
        }
        hl.appendChild(row);

        if (open) {
          var det = S.consDet || [];
          var box = el('div', 'ckm-cons-det');
          if (!det.length) box.appendChild(el('div', 'ckm-note', '读取中…'));
          for (var d = 0; d < det.length; d++) {
            var x = det[d];
            var dr = el('div', 'ckm-cons-drow' + (x.undone ? ' off' : ''));
            dr.appendChild(el('span', 'ckm-cons-dop', consolOpLabel(x.op)));
            dr.appendChild(el('span', 'ckm-cons-did', '#' + x.factId));
            dr.appendChild(el('span', 'ckm-cons-dwhy', x.why));
            if (x.undone) dr.appendChild(el('span', 'ckm-fact-bad', '已回滚'));
            box.appendChild(dr);
          }
          hl.appendChild(box);
        }
      })(hist[m]);
    }
    list.appendChild(hl);
  }

  function consolOpLabel(op) {
    if (op === 'ent-fill') return '补实体';
    if (op === 'merge') return '合并';
    if (op === 'revive') return '恢复';
    return String(op || '');
  }

  /* ── 整理：数据加载与动作 ───────────────────────────────────────── */

  function loadConsCand() {
    if (S.consBusy) return;
    S.consBusy = 'scan';
    S.err = '';
    render();
    var qs = 'limit=40' + (S.selSid ? '&sid=' + encodeURIComponent(S.selSid) : '');
    return api('/api/ck-memory/consolidate-candidates?' + qs).then(function (j) {
      S.consBusy = '';
      S.consCand = j.items || [];
      if (!S.consCand.length) S.note = '扫了 ' + (j.scanned || 0) + ' 条事实，没找到可疑的重复。';
      render();
    }).catch(function (e) {
      S.consBusy = '';
      S.err = '扫描候选失败：' + e.message;
      render();
    });
  }

  function loadConsHist() {
    return api('/api/ck-memory/consolidate-history?limit=15').then(function (j) {
      S.consHist = j.items || [];
      S.consConf = j.conf || null;
      render();
    }).catch(function (e) {
      S.err = '读取整理历史失败：' + e.message;
      render();
    });
  }

  function loadConsDet(runId) {
    return api('/api/ck-memory/consolidate-detail?run=' + encodeURIComponent(runId))
      .then(function (j) {
        if (S.consOpen !== runId) return;   // 用户已经切走了，别覆盖当前视图
        S.consDet = j.items || [];
        render();
      }).catch(function (e) {
        S.err = '读取整理明细失败：' + e.message;
        render();
      });
  }

  /**
   * 跑一个整理动作。
   * ⚠️ force 一律 true：用户按了按钮就是「现在要」，不该被「6 小时内跑过」的节流拦住。
   */
  function runConsol(op) {
    if (S.consBusy) return;
    S.consBusy = op;
    S.err = '';
    render();
    return api('/api/ck-memory/consolidate', { method: 'POST', body: { force: true, ops: [op] } })
      .then(function (j) {
        S.consBusy = '';
        var k = op === 'ent' ? 'ent' : (op === 'merge' ? 'merge' : 'revive');
        var r = j && j[k];
        var n = r ? (k === 'ent' ? (r.changed || 0) : (k === 'merge' ? (r.merged || 0) : (r.revived || 0))) : 0;
        if (j && j.error) S.err = '整理失败：' + j.error;
        else if (r && r.error) S.err = '整理失败：' + r.error;
        else S.note = (op === 'ent' ? '补实体：' : op === 'merge' ? '合并：' : '恢复：') + n + ' 条改动' +
          (j.ms != null ? '（' + j.ms + 'ms）' : '') + (n ? '，可在下方历史里回滚' : '');
        loadConsHist();
        loadFacts();
        if (S.consCand) loadConsCand();
      }).catch(function (e) {
        S.consBusy = '';
        S.err = '整理失败：' + e.message;
        render();
      });
  }

  /* ── 数据加载 ───────────────────────────────────────────────────── */
  function loadStatus() {
    return api('/api/ck-memory/status').then(function (j) {
      S.stat = j.stats || null;
      S.err = '';
      S.lastAt = Date.now();
      // ⚠️ 必须同步签名：否则轮询拿到的 sig 与这里不一致，会立刻多刷一次。
      statPollSig = statSig(S.stat);
      render();
    }).catch(function (e) {
      S.err = '读取状态失败：' + e.message;
      render();
    });
  }

  /**
   * 状态轮询的「脏值签名」：只挑会显示在状态条上的字段。
   *
   * ⚠️ 用签名而不是「每次都重绘」：索引器每 30 秒才动一次，
   *   8 秒轮询里有 3/4 的轮次数据完全没变。无脑重绘会让 meta1/meta2
   *   反复 removeChild + appendChild —— 用户正在 hover 看 title 时会被闪断。
   */
  function statSig(st) {
    if (!st) return '';
    var a = st.active || {};
    return [
      st.enabled, st.segments, st.sessions, st.onDisk, st.validMem, st.procMem,
      st.folded, st.noise, st.hitRows, st.hitTotal, st.followed, st.dbBytes,
      st.factLive, st.factTotal, st.hitErrors,
      // ⚠️ userTalk 必须进签名：2026-11-05 重构后大字摘要里会显示
      //   「（其中你说的话 N 条）」，它变了而签名不变 ⇒ 轮询不会重绘 ⇒ 数字冻结。
      st.userTalk,
      // ⚠️ pending 同理：回填是后台自己跑的，这个数每轮都会降。
      //   不进签名的话，用户看着面板不动会以为「一直没补」。
      st.pending,
      // ⚠️ followed 必须进签名：2026-11-06 起大字摘要下面那行小字会报
      //   「其中你手动指定 N 条」，用户点一下跟踪按钮数字就变，不重绘会显示旧值。
      st.followed,
      st.available,
      a.sid, a.n, a.indexed, a.sizeMB,
    ].join('|');
  }

  /**
   * 低频轮询状态条（默认 8 秒）。
   *
   * ⚠️⚠️⚠️ 这是「面板看起来没反应」的正面修复，触发条件必须严格：
   *   ① 面板 pane 还在 DOM 里（用户切到别的 tab 就别打请求）
   *   ② 面板是可见的（getBoundingClientRect 有高度 —— hidden 时高度为 0）
   *   ③ 没有正在进行的操作（S.busy 非空时请求会打架，用户点了「索引一次」正在等结果）
   *   ④ 用 statSig 比对，没变就不重绘
   * ⚠️ 为什么不把 loadSessions 一起轮询：会话清单只影响下拉选择器，
   *   代价是全量重排列表；状态条需要的 boundItem.title 在 S.sessions 里已经有了，
   *   索引器补完某条会话时 sessions 的变化会由用户下次打开面板/切页带进来，够用。
   */
  var statPollSig = '';
  var statPollBusy = false;
  function pollStatus() {
    if (statPollBusy) return;
    if (!paneEl || !document.body.contains(paneEl)) return;
    var rr;
    try { rr = paneEl.getBoundingClientRect(); } catch (_) { return; }
    if (!(rr.height > 0 && rr.width > 0)) return;   // 面板没展开（切到别的 tab / 收起来了）
    if (S.busy) return;                              // 有操作在跑，别插队
    statPollBusy = true;
    api('/api/ck-memory/status').then(function (j) {
      var next = j && j.stats ? j.stats : null;
      var sig = statSig(next);
      if (sig === statPollSig) return;               // 数据没变，一个像素都不动
      statPollSig = sig;
      S.stat = next;
      S.lastAt = Date.now();
      try { renderStatusBar(); } catch (_) {}
      // 事实数变了就顺手刷一下那一行的旁注（它读的是 S.stat.factLive）
      try { renderInject(); } catch (_) {}
    }).catch(function () {
      // 轮询失败保持静默：面板是只读展示，网络抖动不该在界面上弹错误条
    }).then(function () { statPollBusy = false; });
  }

  /**
   * 「上次注入」那一行的低频刷新（与状态轮询同轮，但**独立判定**）。
   *
   * ⚠️⚠️ 为什么不能省：那一行的文案是「21 小时前 没带：没有可锚定的信息」。
   *   渲染那一刻它是**准确的** —— 用户确实 21 小时没发带标识符的消息了。
   *   但面板不刷新时它就永远停在那句上，用户刚发完一条消息再回头看，
   *   还是「21 小时前」，于是以为「这个功能根本没工作」。
   *   实测：他 15:39 发消息后文件已更新为 15:39:53，面板仍显示 21 小时前。
   * ⚠️ 只在文案真的要变时才重绘（比对 at + reason + n），避免无谓的 DOM 抖动。
   */
  var injPollSig = '';
  function pollInjectLast() {
    if (!paneEl || !document.body.contains(paneEl)) return;
    var rr;
    try { rr = paneEl.getBoundingClientRect(); } catch (_) { return; }
    if (!(rr.height > 0 && rr.width > 0)) return;
    if (S.busy) return;
    api('/api/ck-memory/inject-last').then(function (j) {
      var last = (j && j.last) || null;
      var sig = last ? [last.at, last.reason, last.n, last.chars, (last.ids || []).join(',')].join('|') : '';
      if (sig === injPollSig) return;
      injPollSig = sig;
      S.inj = last;
      S.injCfg = (j && j.config) || {};
      try { renderInject(); } catch (_) {}
    }).catch(function () {});
  }

  /* ── 事实层（阶段 4）───────────────────────────────────────────── */

  /**
   * 拉事实列表。
   *
   * ⚠️ 默认只看「有效」的（valid_to IS NULL）—— 那才是「现在为真」的口径。
   *   「已失效」不是垃圾，是历史，需要时用 S.fexp 打开看（时序类提问要用到）。
   */
  function loadFacts() {
    var qs = [];
    if (S.selSid) qs.push('sid=' + encodeURIComponent(S.selSid));
    if (S.fq) qs.push('q=' + encodeURIComponent(S.fq));
    if (S.fexp) qs.push('expired=1');
    qs.push('limit=200');
    return api('/api/ck-memory/facts?' + qs.join('&')).then(function (j) {
      S.facts = j.items || [];
      S.fstat = j.stats || null;
      S.flast = j.last || null;
      render();
    }).catch(function (e) {
      S.err = '读取事实失败：' + e.message;
      render();
    });
  }

  /** 手动触发提炼（force：不等攒够回合，用户按了就是现在要）。 */
  function extractNow() {
    if (S.busy) return;
    S.busy = 'fact';
    S.err = '';
    render();
    api('/api/ck-memory/fact-extract', { method: 'POST', body: { sid: S.selSid || '' } })
      .then(function (j) {
        S.flast = { at: Date.now(), added: j.added || 0, n: j.n || 0, why: j.why || '', ms: j.ms || 0, model: j.model || '' };
        if (j.ok === false) S.err = '提炼未完成：' + (j.why || j.error || '未知原因');
        /**
         * ⚠️⚠️⚠️ 抽完之后必须**把面板切到「事实所属的那条会话」**，否则用户会以为提炼失败了。
         *
         * 实测踩到：当前界面绑的是「整理画册」，我在「workbuddy助手」上触发提炼，
         * 抽出 8 条；面板随即去拉事实列表，但拉的是**当前绑定会话**的事实 ⇒ 0 条。
         * 用户看到的就是「点了立即提炼，转了一圈，还是空的」。
         * 后端返回体里带 sid（真实抽的那条），这里据此把 selSid 对齐过去。
         */
        if (j.sid && (!S.selSid || S.selSid !== j.sid)) {
          S.selSid = j.sid;
          // 会话下拉的选中态也要跟着刷新，否则上面显示的还是旧会话
          if (S.list && S.list.activeSid !== j.sid) {
            try { pickSession(j.sid); } catch (_) {}
          }
        }
        return loadFacts();
      })
      .catch(function (e) {
        S.err = '提炼失败：' + e.message;
      })
      .then(function () { S.busy = ''; render(); });
  }

  /** 对一条事实做 expire / restore / delete。 */
  function markFact(id, action) {
    return api('/api/ck-memory/fact-mark', { method: 'POST', body: { id: id, action: action } })
      .then(function () { return loadFacts(); })
      .catch(function (e) { S.err = '操作失败：' + e.message; render(); });
  }

  function loadRecent() {
    // 用户点了「最近 / 时间线 / 搜」= 想离开管理页，必须重置，
    // 否则管理视图会一直盖住结果区，看着像「点了没反应」。
    S.mgr = false; S.picked = {};    // 选中的是历史会话时，「最近 6 小时」必然为空（它今天没说话）⇒ 改看时间线。
    // 面板重建 / 切回标签都会走到这里，所以规则放在函数入口，而不是只放在点选处。
    if (S.selSid && S.list && S.list.activeSid && S.selSid !== S.list.activeSid) return loadTimeline();
    S.busy = 'recent'; render();
    return api('/api/ck-memory/recent', { method: 'POST', body: { hours: 6, limit: 40, sid: S.selSid || undefined } })
      .then(function (j) { S.items = j.items || []; S.note = j.note || ''; S.mode = 'recent'; })
      .catch(function (e) { S.err = '读取最近记录失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function loadTimeline() {
    S.busy = 'timeline'; render();
    return api('/api/ck-memory/timeline', { method: 'POST', body: { limit: 120, sid: S.selSid || undefined } })
      .then(function (j) { S.items = j.items || []; S.tlTotal = j.total || 0; S.note = j.note || ''; S.mode = 'timeline'; })
      .catch(function (e) { S.err = '读取时间线失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function doSearch(q) {
    q = String(q || '').trim();
    S.mgr = false; S.picked = {};
    if (!q) { loadRecent(); return; }
    S.q = q; S.mode = 'search'; S.busy = 'search'; S.note = ''; S.err = ''; S.miss = []; render();
    return api('/api/ck-memory/search', { method: 'POST', body: { q: q, limit: 12, sid: S.selSid || undefined, deep: !!S.deep } })
      .then(function (j) {
        S.hits = j.hits || []; S.note = j.note || ''; S.deep = !!j.deep; S.via = j.via || '';
        // `miss` = 拒答时具体哪个词查无。必须存下来，空结果页要靠它区分
        // 「库里没这个话题」和「关键词不匹配」—— 两者该采取的动作完全不同。
        S.miss = j.miss || [];
      })
      .catch(function (e) { S.hits = []; S.err = '搜索失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function actIndex() {
    S.busy = 'index'; S.err = ''; render();
    api('/api/ck-memory/index', { method: 'POST', body: { sid: S.selSid || undefined } })
      .then(function (j) { S.note = '本次新增 ' + (j.added || 0) + ' 条'; return loadStatus(); })
      .catch(function (e) { S.err = '索引失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function actRebuild() {
    var one = !!S.selSid;
    var msg = one
      ? '重建这条会话的索引？\n只重建选中的那一条，其它会话不受影响。\n\n继续？'
      : '重建会清空索引，并重新扫描「当前会话 + 所有已跟踪的会话」。\n对话原文不会受影响，只是索引重做。\n\n继续？';
    if (!window.confirm(msg)) return;
    S.busy = 'rebuild'; S.err = ''; render();
    api('/api/ck-memory/rebuild', { method: 'POST', body: one ? { sid: S.selSid } : {} })
      .then(function (j) {
        S.note = one ? ('重建完成，' + (j.total || 0) + ' 条') : ('重建完成，' + (j.sessions || 0) + ' 条会话 / ' + (j.total || 0) + ' 条记录');
        return loadSessions();
      })
      .then(function () { return loadStatus(); })
      .then(loadRecent)
      .catch(function (e) { S.err = '重建失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function actClear() {
    if (!window.confirm('确定清空记忆索引？\n索引会清空，但历史对话原文仍在，可随时重建。')) return;
    S.busy = 'clear'; S.err = ''; render();
    api('/api/ck-memory/clear', { method: 'POST', body: {} })
      .then(function () { S.hits = []; S.items = []; S.note = '已清空'; return loadStatus(); })
      .catch(function (e) { S.err = '清空失败：' + e.message; })
      .then(function () { S.busy = ''; render(); });
  }

  function toggleEnabled(on) {
    api('/api/ck-memory/config', { method: 'POST', body: { enabled: !!on } })
      .then(function () { return loadStatus(); })
      .catch(function (e) { S.err = '切换失败：' + e.message; render(); });
  }

  /* ── 自动注入（阶段 2）──────────────────────────────────────────── */

  function toggleInject(on) {
    api('/api/ck-memory/config', { method: 'POST', body: { autoInject: !!on } })
      .then(function () { return loadInjectLast(); })
      .catch(function (e) { S.err = '切换失败：' + e.message; render(); });
  }

  /**
   * 开关「自动提炼事实」。
   * ⚠️ 关掉之后**已有的**事实不会消失（只是不再新增），这点要在提示里说清，
   *   否则用户会以为关开关 = 清空记忆。
   */
  function toggleFactExtract(on) {
    api('/api/ck-memory/config', { method: 'POST', body: { factExtract: !!on } })
      .then(function () { return loadStatus(); })
      .catch(function (e) { S.err = '切换失败：' + e.message; render(); });
  }

  /* ── 临时文件清理（2026-11-09）────────────────────────────────────
   *
   * 背景：WorkBuddy 把子进程的 TMP 指到 <Roaming>\WorkDaddy\client-tmp\workbuddy-cn，
   *   历史截图脚本每次在那里留一个完整浏览器配置目录（800MB~1.2GB），实测攒到 37 GB。
   *   后端见 ck-memory.js「临时文件清理」小节（四道安全闸门都写在那里）。
   */

  function setTswMeta(text) {
    var m = paneEl.querySelector('[data-tsw-meta]');
    if (m) m.textContent = text;
  }

  function toggleTempSweep(on) {
    api('/api/ck-memory/tempsweep', { method: 'POST', body: { tempSweep: !!on } })
      .then(function (j) { S.tswCfg = (j && j.config) || S.tswCfg; return loadTempSweep(); })
      .catch(function (e) { S.err = '切换失败：' + e.message; render(); });
  }

  /**
   * 手动清一次。
   * ⚠️ 删盘要几十秒，期间必须给「清理中」的反馈：后端有 tempSweepBusy 兜着不会重复删，
   *   但界面上毫无变化等于让人以为按钮坏了，然后反复点。
   */
  function actTempSweep() {
    setTswMeta('清理中…（大目录要几十秒）');
    api('/api/ck-memory/tempsweep', { method: 'POST', body: { run: true } })
      .then(function (j) {
        if (j && j.busy) { setTswMeta('已经在清理了，稍等'); return; }
        if (j && j.ok === false) { setTswMeta('清理失败：' + (j.error || '未知错误')); return; }
        S.tsw = (j && j.last) || S.tsw;
        renderTempSweep();
      })
      .catch(function (e) { setTswMeta('清理失败：' + e.message); });
  }

  /**
   * 读清理状态。
   * ⚠️ 不用 .then(render) 串行：这个请求失败不该让整个面板不可用，所以自己兜住错误。
   */
  function loadTempSweep() {
    return api('/api/ck-memory/tempsweep')
      .then(function (j) {
        S.tsw = (j && j.last) || null;
        S.tswCfg = (j && j.config) || null;
        S.tswBusy = !!(j && j.busy);
        renderTempSweep();
      })
      .catch(function () { renderTempSweep(); });
  }

  function renderTempSweep() {
    var chk = paneEl.querySelector('[data-tsw]');
    var m = paneEl.querySelector('[data-tsw-meta]');
    // 状态还没读回来（S.tswCfg 为 null）时按「默认开启」显示：
    //   后端 DEFAULT_CONF.tempSweep 就是 true，这里如果默认画成未勾选，
    //   会让人以为功能是关的，实际上它正跑着。
    if (chk) chk.checked = !S.tswCfg || S.tswCfg.tempSweep !== false;
    if (!m) return;
    // 正在跑的时候不要把刚才那句「清理中…」盖掉
    if (S.tswBusy) { m.textContent = '正在清理…'; return; }
    var l = S.tsw;
    if (!l || !l.at) { m.textContent = '还没清理过'; return; }
    var days = (S.tswCfg && S.tswCfg.tempSweepDays) || 7;
    var when = timeLabel(l.at);
    if (!l.removed) { m.textContent = when + ' 查过，没有 ' + days + ' 天以上的'; return; }
    // 删了但空间没回来：必须单独说，否则「清了 12 个」看着是好消息，
    // 实际 C 盘一个字节都没多。2026-11-09 真遇到过（删除被改道进回收站）。
    if (l.recycled) {
      m.textContent = when + ' 清了 ' + l.removed + ' 个 · 空间未回收（疑似进了回收站）';
      return;
    }
    var b = Number(l.bytes) || 0;
    var size = b >= 1073741824
      ? (Math.round(b / 1073741824 * 10) / 10) + ' GB'
      : Math.round(b / 1048576) + ' MB';
    m.textContent = when + ' 清了 ' + l.removed + ' 个 · 回收 ' + size;
  }

  /**
   * 读「上次注入」。
   * ⚠️ 不用 .then(render) 串行：这个请求失败不该影响整个面板可用性，
   *   所以自身兜住错误，只更新自己那一块。
   */
  function loadInjectLast() {
    api('/api/ck-memory/inject-last')
      .then(function (j) {
        S.inj = (j && j.last) || null;
        S.injCfg = (j && j.config) || {};
        renderInject();
      })
      .catch(function () { renderInject(); });
  }

  /**
   * 注入原因码 → 大白话。两份展示（状态条一行 + 展开详情头）共用同一张表，
   * 免得两处说法不一致（实测第一版就是详情里漏了这个映射，显示成「结论 ok」）。
   */
  var INJ_WHY = {
    ok: '命中',
    off: '已关',
    'no-db': '库不可用',
    'too-short': '话太短',
    'too-long': '话太长',
    'no-signal': '没有可锚定的信息',
    'id-miss': '标识符在库里没查到',
    'no-useful-term': '没有可用关键词',
    exception: '出错了（已忽略）',
  };

  function renderInject() {
    if (!paneEl) return;
    var chk = paneEl.querySelector('[data-inject]');
    if (chk) chk.checked = !!(S.injCfg && S.injCfg.autoInject);

    /**
     * 事实层开关与旁注（阶段 4）。
     *
     * ⚠️ 开关状态从**服务端 config** 读（S.stat.factExtract），不从 localStorage：
     *   开关是 daemon 在用的，面板只是显示。localStorage 按 origin 隔离，
     *   浏览器预览和桌面端拿到的值不一样，会造成「界面上开着、其实没开」。
     */
    var fchk = paneEl.querySelector('[data-fact]');
    var fmeta = paneEl.querySelector('[data-fact-meta]');
    if (fchk) fchk.checked = S.stat ? S.stat.factExtract !== false : true;
    if (fmeta) {
      var fs = S.fstat || null;
      // 只在事实页或状态里已经知道数量时给数字，否则给一句形态说明
      if (S.stat && S.stat.factLive !== undefined) {
        fmeta.textContent = S.stat.factLive ? ('已有 ' + num(S.stat.factLive) + ' 条') : '还没抽出事实';
      } else if (fs && fs.live !== undefined) {
        fmeta.textContent = fs.live ? ('已有 ' + num(fs.live) + ' 条') : '还没抽出事实';
      } else {
        fmeta.textContent = '';
      }
      if (S.stat && S.stat.factExtract === false) fmeta.textContent = '已关闭，不再新增';
    }

    var meta = paneEl.querySelector('[data-inject-meta]');
    var box = paneEl.querySelector('[data-inject-box]');
    if (!meta || !box) return;

    var last = S.inj || null;
    if (!last || !last.at) {
      meta.textContent = '还没触发过';
    } else {
      var when = timeLabel(last.at);
      if (last.reason === 'ok') {
        meta.textContent = when + ' 带了 ' + (last.n || 0) + ' 条 / ' + (last.chars || 0) + ' 字';
      } else {
        // 把「为什么没带」如实说出来：这个功能最容易让人怀疑「开了没用」，
        // 不给原因就没法判断是没命中还是坏了。
        meta.textContent = when + ' 没带：' + (INJ_WHY[last.reason] || last.reason);
      }
    }

    box.hidden = !S.injOpen;
    if (!S.injOpen) return;
    box.textContent = '';
    if (!last || !last.at) {
      box.appendChild(el('div', 'ckm-inj-empty', '还没有记录。发一条带单号 / 文件名 / 地址的消息就会触发。'));
      return;
    }
    var head = el('div', 'ckm-inj-head');
    /**
     * ⚠️ 这里不能直接显示 reason 的机器码（ok / id-miss / no-signal）。
     *   第一版显示成「结论 ok」，用户看不懂「ok 是什么的 ok」——
     *   面板上面那行已经说了「带了 3 条」，这里要回答的是**凭什么带的**。
     */
    var whyText = INJ_WHY[last.reason] || last.reason;
    head.textContent = '上次：' + timeLabel(last.at)
      + ' · ' + whyText
      + (last.ids && last.ids.length ? ' · 锚定 ' + last.ids.join(' ') : '')
      + (last.dropped && last.dropped.length ? ' · 剔除泛化 ' + last.dropped.join(' ') : '');
    box.appendChild(head);
    var items = (last.items || []);
    if (!items.length) {
      box.appendChild(el('div', 'ckm-inj-empty', '这次没有往上下文里塞任何内容。'));
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var row = el('div', 'ckm-inj-item');
      var tag = el('span', 'ckm-inj-tag', (it.other ? '其他会话' : '本会话') + '·' + (it.why === 'id' ? '标识符' : '相关'));
      row.appendChild(tag);
      row.appendChild(el('span', 'ckm-inj-txt', (it.time || '') + ' ' + (it.head || '')));
      box.appendChild(row);
    }
  }

  /** 毫秒时间戳 → 「3 分钟前」这种好读的说法。 */
  function timeLabel(ms) {
    var d = Date.now() - Number(ms || 0);
    if (!(d >= 0)) return '';
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  /* ── 构建 pane 内容 ─────────────────────────────────────────────── */
  function build() {
    if (!paneEl) return;
    // ⚠️ 必须幂等：mount() 会被定时器 / 观察者重复调用，如果每次都 appendChild，
    //    面板里会出现两套、三套按钮（实测 BTN 数量翻倍）。
    //
    // ⚠️⚠️ 但「幂等」不等于「复用旧 DOM」。热更后新实例拿到的是上一版搭的 .ckm-wrap，
    //   里面的 onclick / addEventListener 全属于旧闭包（有些实例已经被 teardown 掉了）⇒
    //   实测表现是「状态条渲染成新格式、但搜索框输入回车毫无反应」。
    //   因此：同一版内复用（只重画），换版则整壳重建。builtRev 是闭包变量，
    //   新实例初值为空 ⇒ 首次 build 必然重建，正是我们要的。
    var oldWrap = paneEl.querySelector('.ckm-wrap');
    if (oldWrap && builtRev === UI_REV) {
      built = true;
      render();
      return;
    }
    if (oldWrap && oldWrap.parentNode) oldWrap.parentNode.removeChild(oldWrap);
    builtRev = UI_REV;
    built = true;
    paneEl.appendChild(el('div', 'ckm-wrap'));

    var wrap = paneEl.querySelector('.ckm-wrap');

    /**
     * ① 状态条（2026-11-05 重构为纵向三段式）
     *
     * 旧结构为什么必须拆：两行 10~11px 的灰字横排塞了 7 个数字、5 个内部指标徽标，
     * 用户的原话是「我根本看不懂也不知道怎么用」。逐条复盘：
     *   · 「重复合并 9979」「忽略续跑 3229」「用过 189」「过程话 6.2 万」「跟踪 6」
     *     —— 全是我实现里的概念，不是用户关心的「AI 记住了什么」；
     *   · 真正该被一眼看到的「记住了多少」被埋在长句尾部，窄面板还直接被省略号截掉；
     *   · 三个功能开关平铺成三行，谁主谁次完全看不出来，最关键的「自动索引」
     *     反而藏在最底部（面板一矮就整条被 CSS 让位）。
     *
     * 新结构（四行，重要程度从高到低）：
     *   1) 圆点 + 「记忆」+ 启用总开关 + 高级 + 详情
     *   2) 一句话结论：已记住 N/M 个会话 · K 条有效记忆
     *   3) AI 正在用哪条会话（唯一会影响 AI 行为的隐性状态，不能省）
     *   4) 详情（折叠）：9 个技术指标，每行都带一句大白话
     */
    var stat = el('div', 'ckm-card ckm-stat');
    var statH = el('div', 'ckm-stat-h');
    statH.appendChild(el('span', 'ckm-dot'));
    statH.appendChild(el('span', 'ckm-title', '记忆'));

    // 总开关：把「自动索引 / 自动带入记忆 / 自动提炼事实」三件事收成一个语义 ——
    // 「这个插件要不要干活」。任何一个子开关想单独调，去「高级」。
    var enLab = el('label', 'ckm-chk ckm-en');
    var enChk = document.createElement('input');
    enChk.type = 'checkbox';
    enChk.setAttribute('data-enabled', '1');
    enChk.onchange = function () { toggleEnabled(enChk.checked); };
    enLab.appendChild(enChk);
    enLab.appendChild(document.createTextNode('启用'));
    enLab.title = '记忆总开关。\n'
      + '关掉之后：不再索引新对话、不再往我的回答里带入旧记忆、不再后台提炼事实。\n'
      + '已经存下的记忆一条都不会删，重新打开就自动接上。\n'
      + '—— 想单独关某一项（比如只想省额度、不提炼事实），点右边的「高级」。';
    statH.appendChild(enLab);
    statH.appendChild(el('span', 'ckm-grow'));

    // 「高级」与「详情」分成两个按钮，因为它们回答两个不同的问题：
    //   高级 = 我要调功能（开关 / 运维）
    //   详情 = 我要看数字（索引规模 / 质量）
    var bAdv = el('button', 'ckm-btn', '高级');
    bAdv.setAttribute('data-adv', '1');
    bAdv.title = '展开功能开关与运维操作：\n'
      + '· 自动带入记忆 —— 每次提问前自动把相关旧记录附进上下文\n'
      + '· 自动提炼事实 —— 后台把对话蒸馏成一句话结论（唯一花额度的功能）\n'
      + '· 索引一次 / 重建 / 清空 —— 手动干预索引';
    bAdv.onclick = function () {
      S.adv = !S.adv;
      // 展开高级时顺手把「详情」收起：两个折叠区同时开着，结果区就没地方了
      if (S.adv) S.detail = false;
      render();
    };
    statH.appendChild(bAdv);

    var bDet = el('button', 'ckm-btn', '详情');
    bDet.setAttribute('data-detail', '1');
    bDet.title = '看索引规模与技术指标：总记录 / 过程话 / 待补索引 / 库占用 / 重复合并 / 忽略续跑 / 命中情况。\n每项都附一句大白话说明。';
    bDet.onclick = function () {
      S.detail = !S.detail;
      if (S.detail) S.adv = false;
      render();
    };
    statH.appendChild(bDet);
    stat.appendChild(statH);

    // 第 2 行：这一页的「结论」。数字加粗上色，量词用灰细字。
    stat.appendChild(el('div', 'ckm-big', '读取中…'));
    // 第 3 行：AI 正在用哪条会话
    stat.appendChild(el('div', 'ckm-meta ckm-meta1'));
    // 第 4 行：技术指标（折叠）
    var detBox = el('div', 'ckm-detail');
    detBox.setAttribute('data-detail-box', '1');
    detBox.hidden = true;
    stat.appendChild(detBox);
    wrap.appendChild(stat);

    /**
     * ② 高级设置（折叠卡）：三个子开关 + 运维按钮。
     *
     * ⚠️ 为什么还是把「自动带入记忆」和「自动提炼事实」保留成独立开关、
     *   而不是彻底塞进总开关：它们出问题时的表现完全不同，用户必须能单独掐掉。
     *   · 自动带入 —— 出问题的表现是「我莫名其妙引用了一段旧内容」；
     *   · 自动提炼 —— 是**唯一花额度**的功能（一次模型调用约 10 秒、数千 token）。
     *   但这两件事的频率远低于「看记住了什么」，所以默认收起，不占首屏。
     */
    var adv = el('div', 'ckm-card ckm-adv');
    adv.setAttribute('data-adv-box', '1');
    adv.hidden = !S.adv;

    // ②a 自动带入记忆
    var injRow = el('div', 'ckm-adv-row');
    var injLab = el('label', 'ckm-chk');
    var injChk = document.createElement('input');
    injChk.type = 'checkbox';
    injChk.setAttribute('data-inject', '1');
    injChk.onchange = function () { toggleInject(injChk.checked); };
    injLab.appendChild(injChk);
    injLab.appendChild(document.createTextNode('自动带入记忆'));
    injLab.title = '每次你发消息前，自动检索记忆库并把相关的旧记录附进我的上下文。\n'
      + '只认「强标识符」（单号 / 税号 / 域名 / 端口 / 文件名 / 版本号），\n'
      + '普通口头问题不会乱塞内容 —— 这是实测后的取舍，不是没做完。';
    injRow.appendChild(injLab);
    var injMeta = el('span', 'ckm-adv-meta', '');
    injMeta.setAttribute('data-inject-meta', '1');
    injRow.appendChild(injMeta);
    injRow.appendChild(el('span', 'ckm-grow'));
    var injLast = el('button', 'ckm-btn', '上次');
    injLast.title = '看上一次发消息时到底往上下文里塞了什么';
    injLast.onclick = function () {
      S.injOpen = !S.injOpen;
      /**
       * ⚠️⚠️ 开合后**必须走 render()**，不能只调 loadInjectLast()。
       *   loadInjectLast 是异步的，它回来时只动了 S 与自己的子块，
       *   而 `box.hidden` 是由 render → renderInject 那条链路负责的 ⇒
       *   实测点了「上次」按钮毫无反应（box.hidden 一直是 true，高度 0）。
       */
      if (S.injOpen) loadInjectLast();
      render();
    };
    injRow.appendChild(injLast);
    adv.appendChild(injRow);
    var injBox = el('div', 'ckm-inj-box');
    injBox.setAttribute('data-inject-box', '1');
    injBox.hidden = true;
    adv.appendChild(injBox);

    // ②b 自动提炼事实
    var fxRow = el('div', 'ckm-adv-row');
    var fxLab = el('label', 'ckm-chk');
    var fxChk = document.createElement('input');
    fxChk.type = 'checkbox';
    fxChk.setAttribute('data-fact', '1');
    fxChk.onchange = function () { toggleFactExtract(fxChk.checked); };
    fxLab.appendChild(fxChk);
    fxLab.appendChild(document.createTextNode('自动提炼事实'));
    fxLab.title = '后台把对话蒸馏成「一句话结论」存起来（语义记忆）。\n'
      + '好处：换个说法也能查到，不必恰好命中当时的用词。\n'
      + '⚠️ 这是本插件唯一会调用模型的功能：每次约 10 秒、数千 token。\n'
      + '关掉只是不再新增，已抽出的事实一条都不会删。';
    fxRow.appendChild(fxLab);
    var fxMeta = el('span', 'ckm-adv-meta', '');
    fxMeta.setAttribute('data-fact-meta', '1');
    fxRow.appendChild(fxMeta);
    fxRow.appendChild(el('span', 'ckm-grow'));
    var fxGo = el('button', 'ckm-btn', '去事实');
    fxGo.title = '查看已提炼的事实';
    fxGo.onclick = function () {
      S.mgr = false; S.mode = 'facts'; S.fq = ''; S.fcons = false; S.fent = false;
      S.adv = false;
      render();
      loadFacts();
    };
    fxRow.appendChild(fxGo);
    adv.appendChild(fxRow);

    // ②c 运维三连（原底栏，搬进高级设置）
    //   ⚠️ 「清空」从常驻底栏挪进来是有意的：它原来就在一个会被压到 177px、
    //      需要滚动的小区域里，是最容易误触的按钮。低频 + 危险 = 该藏一层。
    var opRow = el('div', 'ckm-adv-row');
    var bIdx = el('button', 'ckm-btn', '索引一次');
    bIdx.title = '立刻把当前会话/选定会话重新灌进索引。\n平时是后台自动做的（每 30 秒补一条会话），这个按钮是「现在就要」。';
    bIdx.onclick = actIndex;
    opRow.appendChild(bIdx);
    var bRe = el('button', 'ckm-btn', '重建');
    bRe.title = '清空索引后重新扫描全部会话。对话原文不受影响，只是索引重做 —— 大库可能要跑几分钟。';
    bRe.onclick = actRebuild;
    opRow.appendChild(bRe);
    opRow.appendChild(el('span', 'ckm-grow'));
    var bCl = el('button', 'ckm-btn danger', '清空');
    bCl.title = '删掉全部记忆索引。历史对话原文仍在磁盘上，可以随时重建。';
    bCl.onclick = actClear;
    opRow.appendChild(bCl);
    adv.appendChild(opRow);

    // ②d 自动清理临时文件（2026-11-09）
    //   ⚠️ 为什么放在「高级」而不是首屏：它属于维护动作，正常情况下一周自动跑一次，
    //      用户一辈子不用点。但它必须可见 —— 「C 盘莫名少了 30G」正是靠这里解释的。
    var tsRow = el('div', 'ckm-adv-row');
    var tsLab = el('label', 'ckm-chk');
    var tsChk = document.createElement('input');
    tsChk.type = 'checkbox';
    tsChk.setAttribute('data-tsw', '1');
    tsChk.onchange = function () { toggleTempSweep(tsChk.checked); };
    tsLab.appendChild(tsChk);
    tsLab.appendChild(document.createTextNode('清理临时文件'));
    tsLab.title = 'WorkBuddy 把自己的临时目录指到了\n'
      + '%APPDATA%\\WorkDaddy\\client-tmp\\<profile>（本机是 workbuddy-cn）。\n'
      + '以前的截图/探测脚本每次都会在那里留一个完整的浏览器配置目录\n'
      + '（每个 800MB~1.2GB，跑完不删）。实测攒到过 37 GB。\n'
      + '开着的话每周自动扫一次，只删「7 天以上 + 确认是浏览器配置」的目录。\n'
      + '你的办公文件（xlsx/docx）、交付截图、项目副本都在白名单里，永远不会碰。';
    tsRow.appendChild(tsLab);
    var tsMeta = el('span', 'ckm-adv-meta', '');
    tsMeta.setAttribute('data-tsw-meta', '1');
    tsRow.appendChild(tsMeta);
    tsRow.appendChild(el('span', 'ckm-grow'));
    var tsGo = el('button', 'ckm-btn', '立即清理');
    tsGo.title = '现在扫一次。\n'
      + '⚠️ 只跳过「一周一次」的间隔限制，安全判据一条都不放宽：\n'
      + '仍然只删 7 天以上、且确认为浏览器配置目录的。\n'
      + '删的时候不会卡面板（走异步），大目录要几十秒。';
    tsGo.onclick = actTempSweep;
    tsRow.appendChild(tsGo);
    adv.appendChild(tsRow);

    wrap.appendChild(adv);

    // ①b 会话行：查哪一条 / 要不要长期跟踪
    //     原来的原生 <select> 换成「触发器 + 搜索浮层」：上百条会话时原生下拉
    //     既不能搜也看不见大小，找一条长会话全靠滚，实际不可用。
    var srow = el('div', 'ckm-srow ckm-card');
    var pick = el('div', 'ckm-pick');
    var trig = el('button', 'ckm-trig');
    trig.type = 'button';
    var trigT = el('span', 'ckm-trig-t', '跟随当前会话');
    var trigS = el('span', 'ckm-trig-s', '');
    trig.appendChild(trigT);
    trig.appendChild(trigS);
    trig.onclick = function (e) {
      e.stopPropagation();
      togglePop();
    };
    pick.appendChild(trig);

    var pop = el('div', 'ckm-pop');
    pop.hidden = true;
    var pq = el('input', 'ckm-pop-q');
    pq.type = 'text';
    pq.placeholder = '搜标题 / 会话号 / 项目名…';
    pq.oninput = function () { renderPop(pq.value); };
    pq.onkeydown = function (e) {
      // Esc 关掉；Enter 选第一条 —— 搜完直接回车是最顺的手势
      if (e.key === 'Escape') { e.stopPropagation(); togglePop(false); }
      if (e.key === 'Enter') {
        var first = pop.querySelector('.ckm-opt');
        if (first) { pickSession(first.getAttribute('data-sid') || ''); togglePop(false); }
      }
      e.stopPropagation();
    };
    pop.appendChild(pq);
    var popList = el('div', 'ckm-pop-list');
    pop.appendChild(popList);
    popHost().appendChild(pop);
    srow.appendChild(pick);

    // 两个会话级动作（2026-11-05 重构：按钮从「什么是它」改成「点了会发生什么」）
    // ⚠️ 原文案是「加入跟踪 / 删索引」，用户完全不知道这两个词是什么意思 ——
    //   「跟踪」在实现里是「排进索引队列」，和「记忆」根本不是一个词；
    //   「删索引」看不出删的是记忆还是聊天记录。
    //   ⚠️ 它们的**动态文案**由 syncSessionBar() 负责覆盖（见那里的注释），
    //     这里只是初始值，千万别把逻辑写在这里。
    var bTr = el('button', 'ckm-btn ckm-track', '建记忆');
    bTr.onclick = toggleFollow;
    srow.appendChild(bTr);
    var bDrop = el('button', 'ckm-btn ckm-drop', '忘掉');
    bDrop.onclick = dropSelected;
    srow.appendChild(bDrop);
    wrap.appendChild(srow);

    // ② 搜索行
    //
    // ⚠️ 2026-11-05 重构：默认视图从「最近」改成「事实」，并把入口顺序重排。
    //   原来默认是时间线 —— 一屏全是「记录 2026-10-14 15:45」的原话复制品，
    //   用户打开面板想看的是「你现在记住我什么了」，却要先自己找到第三个 tab
    //   「事实」才看得到，而那个 tab 连自己是什么都没解释。
    //   现在：第一入口「记住了什么」（事实）、第二入口「搜原话」、第三「时间线」。
    var bar = el('div', 'ckm-bar ckm-card');
    var input = el('input', 'ckm-input');
    input.type = 'text';
    input.placeholder = '搜历史原话：尾款 / trigram / 文件名…';
    input.onkeydown = function (e) { if (e.key === 'Enter') doSearch(input.value); };
    bar.appendChild(input);

    var seg = el('div', 'ckm-seg');

    // 「记住了什么」= 事实页。这是本页的主视图。
    var bFt = el('button', 'ckm-btn', '记住了什么');
    bFt.setAttribute('data-mode', 'facts');
    bFt.title = '从对话里提炼出来的**一句话结论**（语义记忆）——\n'
      + '比如「某订单尾款 USD 230,000 未付」「某端口是 8118」。\n'
      + '与「时间线」的区别：时间线是原话逐条，这里是结论。\n'
      + '好处是换个说法也能查到，不用恰好命中当时的用词。';
    bFt.onclick = function () {
      input.value = '';
      S.mgr = false; S.mode = 'facts'; S.fq = ''; S.fcons = false; S.fent = false;
      render();
      loadFacts();
    };
    seg.appendChild(bFt);

    var bRecent = el('button', 'ckm-btn', '最近');
    bRecent.setAttribute('data-mode', 'recent');
    bRecent.title = '最近 6 小时里说过的话（原话逐条，不提炼）';
    bRecent.onclick = function () { input.value = ''; loadRecent(); };
    var bTl = el('button', 'ckm-btn', '时间线');
    bTl.setAttribute('data-mode', 'timeline');
    bTl.title = '这条会话里你说过的全部发言，按时间倒序。\n用来回答「我当时到底是怎么说的」。';
    bTl.onclick = function () { input.value = ''; loadTimeline(); };
    seg.appendChild(bRecent);
    seg.appendChild(bTl);

    // 「含过程话」开关：默认关（只搜有效记忆）。做成按钮而不是下拉，
    // 因为它只有两态，多一层点击不值得。
    var bDeep = el('button', 'ckm-btn', '含过程话');
    bDeep.setAttribute('data-deep', '1');
    bDeep.title = '默认只搜有效记忆（你说的话 + 每回合的结论）。\n打开后连我的过程话与工具输出一起搜 —— 找「当时跑过哪条命令」时用。';
    bDeep.onclick = function () {
      S.deep = !S.deep;
      render();
      if (S.q) doSearch(S.q);
    };
    seg.appendChild(bDeep);

    var bGo = el('button', 'ckm-btn pri', '搜');
    bGo.onclick = function () { doSearch(input.value); };
    seg.appendChild(bGo);
    bar.appendChild(seg);
    wrap.appendChild(bar);

    // ③ 错误条
    var errBox = el('div', 'ckm-err');
    errBox.hidden = true;
    wrap.appendChild(errBox);

    // ④ 结果区
    wrap.appendChild(el('div', 'ckm-list'));
    wrap.querySelector('.ckm-list').appendChild(el('div', 'ckm-empty', '读取中…'));

    // ⑤ 底栏（2026-11-05 重构）
    //   「自动索引」已并入总开关；「重建 / 清空」已搬进「高级」。
    //   这里只留一句**当前库的定性** + 记忆管理入口 —— 底栏是最常驻的位置，
    //   应该放「这条会话建了没 / 要不要清」这类会话级动作，而不是全局运维。
    var foot = el('div', 'ckm-foot');
    var bMgr = el('button', 'ckm-btn', '管理哪些会话有记忆');
    bMgr.setAttribute('data-mgr', '1');
    bMgr.title = '列出所有已建记忆的会话，各占多少条、多少 MB，可勾选删除。\n只删记忆索引，聊天原文一个字都不动。';
    bMgr.onclick = function () {
      S.mgr = !S.mgr;
      S.picked = {};
      render();
    };
    foot.appendChild(bMgr);
    foot.appendChild(el('span', 'ckm-grow'));
    wrap.appendChild(foot);

    render();
    // 面板尺寸是用户可拖的：拖一下就得重算密度，不能等下一次 render
    try {
      if (densityRO) { densityRO.disconnect(); densityRO = null; }
      if (typeof ResizeObserver === 'function' && paneEl) {
        densityRO = new ResizeObserver(function () { syncDensity(); });
        densityRO.observe(paneEl);
      }
    } catch (_) {}
    /**
     * ⚠️⚠️ 首屏加载顺序不能乱，也不能并行。
     *
     * ① loadSessions 先 —— 状态条要拿会话清单比对「AI 在用哪条」的标题，
     *    事实页也要拿它显示会话名；
     * ② 再 loadStatus —— 大字摘要与后台轮询的签名基准都靠它；
     * ③ 最后才拉默认视图数据。
     *
     * ⚠️ 默认视图改成「事实」后，第 ③ 步必须跟着改成 loadFacts()：
     *   原来调的是 loadRecent()，它内部会把 S.mode 覆盖成 'recent'，
     *   于是「默认显示事实」这条改动会被首屏加载自己撤销掉 ——
     *   表现是打开面板先闪一下事实、随即变成原话列表。
     */
    loadSessions()
      .then(loadStatus)
      .then(function () {
        if (S.mode === 'facts') return loadFacts();
        return loadRecent();
      });
    loadInjectLast();
    // 临时清理状态：跟自动注入同批拉，但它不进主链。
    //   ⚠️ 不能用 .then 串进去 —— 首屏主链一旦被它拖慢（临时根下有 20 万文件时
    //      statfs/readdir 都可能慢），整个面板首屏就跟着卡。它只是「高级」里一行灰字，
    //      晚几百毫秒到位完全无所谓，所以独立发、失败也不影响任何东西。
    loadTempSweep();
  }

  /* ── 挂载 ───────────────────────────────────────────────────────── */
  function panelRoot() { return document.querySelector('.wbs-panel'); }

  function myTab(root) {
    return root.querySelector('.wbs-tab[data-tab="' + TAB + '"]');
  }
  function myPane(root) {
    return root.querySelector('.wbs-pane[data-pane="' + PANE + '"]');
  }

  function mounted() {
    var root = panelRoot();
    if (!root) return false;
    var t = myTab(root);
    var p = myPane(root);
    return !!(t && p && t.getAttribute('data-ckm-rev') === UI_REV && p.getAttribute('data-ckm-rev') === UI_REV);
  }

  function activate() {
    var root = panelRoot();
    if (!root) return;
    // ⚠️ 本插件的 tab 是自己绑 click 的（官方只给构建时已存在的 tab 绑监听），
    //    所以切页也不会走 inject.js 的 switchTab —— 标签记忆得在这里自己补一次。
    try { if (typeof window.__wbsRememberTab === 'function') window.__wbsRememberTab(TAB); } catch (_) {}
    var tabs = root.querySelectorAll('.wbs-tab');
    var panes = root.querySelectorAll('.wbs-pane');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === TAB);
    for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('active', panes[j].getAttribute('data-pane') === PANE);
    // ⚠️ 每次切回本页都重新拉会话清单与状态：索引可能在后台补了别的会话，
    //    只拉「最近」会看到一个过期数字（实测切换后仍显示「全库 1 条」）。
    loadSessions().then(loadStatus);
    // 事实页不自动切成「最近」（它有自己的数据源）；其余模式沿用原行为。
    // ⚠️ 但状态/统计要一并刷新 —— 后台抽取是异步的，用户切回来时数字可能已经变了。
    // ⚠️ 整理视图下不能调 loadFacts()：它会覆盖 S.facts 并重渲染，
    //    把用户正在看的候选清单冲掉（用户会以为「切出去再回来，候选没了」）。
    if (S.mode === 'facts' && S.fcons) { loadConsHist(); if (S.consCand) loadConsCand(); }
    else if (S.mode === 'facts') loadFacts();
    else if (!S.items.length && !S.hits.length) loadRecent();
  }

  /** 切到别的页时，官方自己的 tab 有点击监听器，会正常处理；这里不用管。 */
  function mount() {
    ensureStyle();
    var root = panelRoot();
    if (!root) return false;
    var tabsBox = root.querySelector('.wbs-tabs');
    var bodyBox = root.querySelector('.wbs-body');
    if (!tabsBox || !bodyBox) return false;

    // ① 清掉非本版节点（热更遗留 / 旧结构）
    var stale = root.querySelectorAll('[' + SLOT + ']');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].getAttribute('data-ckm-rev') !== UI_REV) {
        try { stale[i].parentNode.removeChild(stale[i]); } catch (_) {}
      }
    }

    // ② 标签页
    var tab = myTab(root);
    if (!tab) {
      tab = el('button', 'wbs-tab');
      tab.type = 'button';
      tab.setAttribute('data-tab', TAB);
      tab.setAttribute(SLOT, '1');
      tab.setAttribute('data-ckm-rev', UI_REV);
      // 与官方其余标签保持同一套视觉：15px stroke SVG（原为 emoji 🧠，字重与基线都对不齐）
      var ico = el('span', 'wbs-tab-ico');
      ico.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 0 0-3 3v1a2 2 0 0 0 0 4v1a3 3 0 0 0 6 0v-1a2 2 0 0 0 0-4V8a3 3 0 0 0-3-3z"/><path d="M9 9H7a2 2 0 0 0-2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 0 2 2"/><path d="M15 9h2a2 2 0 0 1 2 2v1a2 2 0 0 1 0 4v1a2 2 0 0 1-2 2"/></svg>';
      tab.appendChild(ico);
      tab.appendChild(el('span', null, '记忆'));
      // ⚠️ 官方只给构建时已存在的 tab 绑 click ⇒ 必须自己绑，否则点不动
      tab.addEventListener('click', function () { try { activate(); } catch (_) {} });
    }
    if (tab.getAttribute('data-ckm-rev') !== UI_REV) tab.setAttribute('data-ckm-rev', UI_REV);
    if (tab.parentNode !== tabsBox) tabsBox.appendChild(tab);

    // ③ 内容页
    var pane = myPane(root);
    if (!pane) {
      pane = el('div', 'wbs-pane');
      pane.setAttribute('data-pane', PANE);
      pane.setAttribute(SLOT, '1');
      pane.setAttribute('data-ckm-rev', UI_REV);
    }
    if (pane.getAttribute('data-ckm-rev') !== UI_REV) pane.setAttribute('data-ckm-rev', UI_REV);
    if (pane.parentNode !== bodyBox) bodyBox.appendChild(pane);

    paneEl = pane;
    build();

    watch(root);
    return true;
  }

  /* ── 补挂观察者 ──────────────────────────────────────────────────
   * 官方面板会整体重建（切语言 / 重建 pane / 刷新），tab 与 pane 会被连根拔掉。
   * ⚠️ 只观察 childList，**不观察 subtree / attributes** —— 观察 documentElement
   *   子树会在每个流式 token 上触发（实测把页面卡死）。
   * 回调里先 mounted()：已挂载就直接退出，不给自己的插入动作制造循环。
   *
   * ⚠️⚠️ 必须**三级观察**。只挂 tabs/body 两个节点是不够的：官方重建时可能把
   *   .wbs-tabs / .wbs-body 这两个节点**本身**替换掉，那样旧节点脱离文档，
   *   挂在它上面的观察者永远收不到通知 ⇒ tab 永久消失（实测踩过）。
   *   所以再加一层 panel 的 childList（tabs/body 都是 panel 的直接子节点），
   *   节点被换掉时 panel 会先通知，mount() 里再按新节点重挂。
   */
  var moPanel = null, moTabs = null, moBody = null;
  var moPanelTarget = null, moTabsTarget = null, moBodyTarget = null;
  var probeTimer = null;
  var observedRoot = null;

  function watch(root) {
    var tabsBox = root.querySelector('.wbs-tabs');
    var bodyBox = root.querySelector('.wbs-body');
    if (root !== moPanelTarget) {
      if (moPanel) { try { moPanel.disconnect(); } catch (_) {} }
      moPanelTarget = root;
      moPanel = new MutationObserver(function () { if (!mounted()) schedule(); });
      moPanel.observe(root, { childList: true });
    }
    if (tabsBox && tabsBox !== moTabsTarget) {
      if (moTabs) { try { moTabs.disconnect(); } catch (_) {} }
      moTabsTarget = tabsBox;
      moTabs = new MutationObserver(function () { if (!mounted()) schedule(); });
      moTabs.observe(tabsBox, { childList: true });
    }
    if (bodyBox && bodyBox !== moBodyTarget) {
      if (moBody) { try { moBody.disconnect(); } catch (_) {} }
      moBodyTarget = bodyBox;
      moBody = new MutationObserver(function () { if (!mounted()) schedule(); });
      moBody.observe(bodyBox, { childList: true });
    }
    observedRoot = root;
  }

  function schedule() {
    if (probeTimer) return;
    probeTimer = track(setTimeout(function () {
      probeTimer = null;
      try { mount(); } catch (_) {}
    }, 240));
  }

  function teardown() {
    try { if (moPanel) moPanel.disconnect(); } catch (_) {}
    try { if (moTabs) moTabs.disconnect(); } catch (_) {}
    try { if (moBody) moBody.disconnect(); } catch (_) {}
    moPanel = moTabs = moBody = null;
    moPanelTarget = moTabsTarget = moBodyTarget = null;
    if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
    try {
      (window.__ckmTimers || []).forEach(function (t) {
        try { clearInterval(t); } catch (_) {}
        try { clearTimeout(t); } catch (_) {}
      });
      window.__ckmTimers = [];
    } catch (_) {}
    try {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    } catch (_) {}
    // 弹层挂在 .wbs-root（不是 pane 里）—— 不主动删就会随每次热更叠一份。
    // ⚠️ 用全文件 querySelectorAll 而不是 paneEl 里查：弹层本来就在 pane 之外，
    //   挂载点从 body 换成 .wbs-root 后这一条依然有效（两种位置都能扫到）。
    try {
      var pops = document.querySelectorAll('.ckm-pop');
      for (var i = 0; i < pops.length; i++) {
        if (pops[i].parentNode) pops[i].parentNode.removeChild(pops[i]);
      }
    } catch (_) {}
    try { if (densityRO) { densityRO.disconnect(); } } catch (_) {}
    densityRO = null;
    paneEl = null; built = false; observedRoot = null;
  }

  /* ── 启动 ───────────────────────────────────────────────────────── */
  window.__ckm = {
    state: S, mount: mount, teardown: teardown, activate: activate,
    search: doSearch, recent: loadRecent, timeline: loadTimeline,
    status: loadStatus, indexNow: actIndex,
    sessions: loadSessions, pick: pickSession, follow: toggleFollow, drop: dropSelected,
    bind: reportBind, openSid: readOpenSid, followMany: followMany,
    // ⚠️ 导出 render 是给**截图与自动化验证**用的：
    //   线上库事实少的时候，「候选卡片长什么样」用真实数据永远看不到，
    //   而排版问题（撑破容器 / 长句挤掉 id）恰恰是最需要眼睛看的一类缺陷。
    //   有了这个入口就能在浏览器里塞假数据渲染后截图，**完全不碰数据库**。
    render: render,
  };

  // 面板可能还没渲染出来：先在 1.2s / 4s 各探一次，之后交给观察者
  function boot() { try { mount(); } catch (_) {} }
  track(setTimeout(boot, 1200));
  track(setTimeout(boot, 4000));

  // 兜底：万一宿主把 .wbs-panel 整个换掉，观察者会失效，低频补一次
  // ⚠️ 间隔别拉长：面板重建后用户 1 秒内就会去看，等 5 秒等于「标签页消失」。
  //    成本只有一次 querySelector，1.5 秒一次可忽略。
  track(setInterval(function () {
    if (!document.querySelector('.wbs-panel')) return;
    if (!mounted()) { try { mount(); } catch (_) {} }
  }, 1500));

  /**
   * 绑定心跳：每 2 秒看一眼侧栏选中的是哪条会话，变了就上报。
   *
   * ⚠️⚠️⚠️ 为什么必须是独立定时器，而不是挂在面板打开时：
   *   用户在侧栏点开会话时，设置面板**根本没开着**。如果只在面板可见时上报，
   *   「点了不过去」照旧。所以这个心跳与面板是否展开无关，注入脚本活着就一直在跑。
   * ⚠️ 为什么 2 秒：点开会话到打开设置面板去看，人手至少 1~2 秒；
   *   后端 BIND_TTL 是 120 秒，2 秒一次的成本只是一次 querySelector。
   */
  track(setInterval(function () { try { reportBind(); } catch (_) {} }, 2000));
  // 启动后立刻报一次，别等第一个 2 秒
  track(setTimeout(function () { try { reportBind(); } catch (_) {} }, 600));

  /**
   * 事实页低频刷新（12 秒一次，**只在事实页可见时**）。
   *
   * ⚠️ 为什么需要它：事实抽取是后台异步的（一次模型调用 10 秒左右），
   *   用户点开面板看事实时，抽取很可能还在跑。没有轮询的话，
   *   面板会一直停在他打开那一刻的快照，看起来像「提炼了但没写进来」。
   * ⚠️ 为什么 12 秒：抽取本身 10 秒级，更密没有意义；而且只在事实页才发请求，
   *   不会给 daemon 添无谓负担。
   */
  track(setInterval(function () {
    try {
      if (!paneEl || !document.body.contains(paneEl)) return;
      if (S.mode !== 'facts' || S.busy) return;
      if (typeof S.fq === 'string' && S.fq) return;   // 用户正在搜，别打断
      loadFacts();
    } catch (_) {}
  }, 12000));

  /**
   * 状态条轮询（8 秒一次，只在面板可见时发）。
   *
   * ⚠️⚠️⚠️ 为什么需要它 —— 修的是「开关都开了怎么一点反应都没有」这个误判：
   *   面板原先只有 3 个定时器（1.5s 挂载守护 / 2s 绑定上报 / 12s 事实页），
   *   **状态条压根没有轮询**。loadStatus() 的调用点全是「动作之后」或「切页时」，
   *   于是面板开着不动时，数字永远冻结在打开那一刻。实测同一分钟：
   *     面板「3/79 会话 · 152.0MB · 事实 23 条 · 上次注入 21 小时前」
   *     真值「7/79 · 162.9MB · 67 条 · 几分钟前」
   *   最容易被误读成「功能坏了」，实际索引器跑得很正常。
   * ⚠️ 为什么 8 秒：索引器 intervalMs 是 30 秒，8 秒能保证「最多晚一轮的 1/4」看见，
   *   又不至于给 daemon 添负担（一个本地 HTTP GET，走的是同一进程）。
   * ⚠️ 为什么只刷状态条不调 render()：render() 会清空结果区，
   *   轮询那么干等于每 8 秒把用户的滚动位置冲掉。详见 renderStatusBar 的注释。
   */
  track(setInterval(function () {
    try { pollStatus(); } catch (_) {}
  }, 8000));

  /**
   * 「上次注入」行同频刷新（8 秒，共用上面的可见性判断）。
   * ⚠️ 与状态轮询分开成两个请求：inject-last 是另一个端点，
   *   合并请求后端就得改接口，这里不改后端。
   */
  track(setInterval(function () {
    try { pollInjectLast(); } catch (_) {}
  }, 8000));

  // 点浮层外面关掉：否则它会一直盖在结果区上
  try {
    document.addEventListener('click', function (e) {
      var pick = paneEl && paneEl.querySelector('.ckm-pick');
      if (!pick) return;
      // ⚠️⚠️ 不能只判 pick：弹层里还有搜索框和选项列表，它们**不在** pick 里。
      //   实测漏了这条的后果 —— 在弹层搜索框里点一下（只想聚焦打字），
      //   捕获阶段先跑这里、判定「落在 pick 外」⇒ 立刻 closePop()，
      //   弹层当场消失，等于搜索框完全不能用。必须把弹层自身也算进「内部」。
      var popEl = document.querySelector('.ckm-pop');
      var inside = pick.contains(e.target) || (popEl && popEl.contains(e.target));
      if (!inside) closePop();
    }, true);
  } catch (_) {}
})();
