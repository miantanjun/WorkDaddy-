'use strict';

/**
 * 统一用量看板：把 usage-unified.js 的 payload 渲染成**单文件、零依赖、离线可用**的 HTML。
 *
 * 为什么是「生成 HTML」而不是「前端 fetch 接口」：
 *   daemon 只对 `/api/` 前缀做 token 鉴权，iframe 又没法带自定义请求头
 *   ⇒ 静态页里 fetch `/api/...` 必然 401。把数据在生成时内嵌进 HTML，
 *   既绕开鉴权，又让三维筛选变成纯客户端计算（切筛选零延迟、断网可用）。
 *
 * 模板纪律：TPL 内部**不出现反引号、不出现 `${`**，全部用单引号 + 拼接，
 * 这样外层模板字符串永远安全，也省掉一整类转义事故。
 */

const PLACEHOLDER = '/*__PAYLOAD__*/null';

const TPL = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>用量看板 · 统一版</title>
<style>
:root{
  --bg:#f6f7f9; --surface:#fff; --surface2:#fafbfc; --line:#e6e8ec; --line2:#eef0f3;
  --tx:#16181d; --tx2:#5b6472; --tx3:#8b93a1;
  --acc:#2563eb;
  --c-i:#2563eb; --c-o:#f59e0b; --c-cr:#14b8a6; --c-cw:#a855f7; --c-th:#ec4899; --c-credit:#ef4444;
  --warn:#b45309; --warn-bg:#fffbeb; --warn-line:#fde68a;
  --radius:12px; --radius-s:8px;
}
html[data-theme="dark"]{
  --bg:#0f1115; --surface:#171a20; --surface2:#1c2029; --line:#272c36; --line2:#22262f;
  --tx:#e8eaee; --tx2:#a4acba; --tx3:#79818f;
  --acc:#60a5fa;
  --warn:#fbbf24; --warn-bg:#2a2313; --warn-line:#4a3c17;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg); color:var(--tx);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:13px; line-height:1.5; padding:18px 20px 40px;
}
.wrap{max-width:1560px;margin:0 auto}
button{font:inherit;color:inherit}
/* ---------- 顶栏 ---------- */
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.h1{font-size:19px;font-weight:600;letter-spacing:.2px;display:flex;align-items:center;gap:9px;margin:0}
.h1 .sub{font-size:11px;font-weight:500;color:var(--tx3);border:1px solid var(--line);border-radius:999px;padding:1px 8px;background:var(--surface)}
.hmeta{color:var(--tx3);font-size:11px;margin-top:5px;display:flex;gap:14px;flex-wrap:wrap}
.hmeta b{color:var(--tx2);font-weight:500}
.hbtns{display:flex;gap:8px;align-items:center}
.btn{height:30px;padding:0 13px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--surface);color:var(--tx);cursor:pointer;transition:background .13s,border-color .13s}
.btn:hover{background:var(--surface2);border-color:var(--tx3)}
.btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.btn.primary:hover{filter:brightness(1.06)}
/* ---------- 筛选区 ---------- */
.filters{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin-bottom:14px}
.frow{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line2)}
.frow:last-child{border-bottom:0}
.flabel{flex:0 0 42px;color:var(--tx2);font-size:12px;line-height:26px}
.fbody{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius-s);overflow:hidden;background:var(--surface2)}
.seg button{border:0;background:transparent;padding:0 11px;height:26px;cursor:pointer;color:var(--tx2);font-size:12px}
.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:var(--acc);color:#fff}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface2);cursor:pointer;font-size:12px;color:var(--tx2);user-select:none;max-width:280px}
.chip:hover{border-color:var(--tx3)}
.chip.on{background:var(--acc);border-color:var(--acc);color:#fff}
.chip .dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
.chip .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip .tag{font-size:10px;opacity:.75}
.chip.more{cursor:pointer;border-style:dashed}
.dates{display:inline-flex;align-items:center;gap:6px;color:var(--tx3);font-size:12px}
.dates input{height:26px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--surface2);color:var(--tx);padding:0 7px;font:inherit;font-size:12px}
.fsum{margin-top:10px;padding-top:10px;border-top:1px solid var(--line2);color:var(--tx2);font-size:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.fsum .k{color:var(--tx3)}
/* ---------- KPI ---------- */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px}
.kpi .t{color:var(--tx3);font-size:11.5px;display:flex;align-items:center;gap:6px}
.kpi .t .sw{width:8px;height:8px;border-radius:2px}
.kpi .v{font-size:21px;font-weight:600;letter-spacing:-.3px;margin:5px 0 2px;font-variant-numeric:tabular-nums}
.kpi .s{color:var(--tx3);font-size:11px}
/* ---------- 卡片 / 图表 ---------- */
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width:1080px){.grid{grid-template-columns:minmax(0,1fr)}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
.card.span2{grid-column:span 2}
@media (max-width:1080px){.card.span2{grid-column:span 1}}
.chd{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.chd h3{font-size:13px;font-weight:600;margin:0;display:flex;align-items:center;gap:7px}
.chd .hint{color:var(--tx3);font-size:11px;font-weight:400}
.legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--tx2);font-size:11.5px}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
svg.chart{display:block;width:100%;height:auto;overflow:visible}
svg.chart text{fill:var(--tx3);font-size:10px;font-family:inherit}
svg.chart .ax{stroke:var(--line2)}
svg.chart .gl{stroke:var(--line2);stroke-dasharray:3 4}
svg.chart .bar:hover,svg.chart .seg:hover,svg.chart .pt:hover{opacity:.78}
.empty{color:var(--tx3);font-size:12px;padding:26px 0;text-align:center}
/* ---------- 表格 ---------- */
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tblwrap{max-height:460px;overflow:auto;border:1px solid var(--line2);border-radius:var(--radius-s)}
table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line2)}
th:first-child,td:first-child{text-align:left}
thead th{position:sticky;top:0;background:var(--surface2);color:var(--tx2);font-weight:500;cursor:pointer;user-select:none;z-index:1}
thead th:hover{color:var(--tx)}
thead th.on{color:var(--acc)}
tbody tr:hover{background:var(--surface2)}
tbody tr.tot{font-weight:600;background:var(--surface2)}
td .mini{color:var(--tx3);font-size:11px}
/* ---------- 补充 / 警示 ---------- */
.note{margin-top:12px;background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn);border-radius:var(--radius-s);padding:10px 12px;font-size:12px}
.note ul{margin:6px 0 0 18px;padding:0}
.note li{margin:2px 0}
.sec-title{font-size:13px;font-weight:600;margin:20px 0 10px;display:flex;align-items:center;gap:8px}
.sec-title .sub{font-size:11px;font-weight:400;color:var(--tx3)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kv .item{background:var(--surface2);border:1px solid var(--line2);border-radius:var(--radius-s);padding:9px 11px}
.kv .item .k{color:var(--tx3);font-size:11px}
.kv .item .v{font-size:16px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums}
.mini-table{width:100%;font-size:12px;border-collapse:collapse}
.mini-table th,.mini-table td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line2)}
.mini-table th:first-child,.mini-table td:first-child{text-align:left}
.mini-table thead th{color:var(--tx3);font-weight:500;background:transparent}
footer{margin-top:22px;color:var(--tx3);font-size:11px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1 class="h1">用量看板<span class="sub">统一版 · 账号 × 模型 × 日期</span></h1>
      <div class="hmeta" id="hmeta"></div>
    </div>
    <div class="hbtns">
      <button class="btn" id="btn-theme" title="切换明暗">◐ 主题</button>
      <button class="btn" id="btn-reset">重置筛选</button>
      <button class="btn primary" id="btn-csv">导出当前筛选 CSV</button>
    </div>
  </div>

  <div class="filters">
    <div class="frow">
      <div class="flabel">日期</div>
      <div class="fbody">
        <div class="seg" id="seg-days">
          <button data-days="1">今天</button>
          <button data-days="2">昨天</button>
          <button data-days="7" class="on">近 7 天</button>
          <button data-days="30">近 30 天</button>
          <button data-days="90">近 90 天</button>
          <button data-days="0">全部</button>
        </div>
        <span class="dates">
          <input type="date" id="in-from"><span>→</span><input type="date" id="in-to">
        </span>
        <span class="dates" id="range-hint"></span>
      </div>
    </div>
    <div class="frow">
      <div class="flabel">账号</div>
      <div class="fbody" id="chips-account"></div>
    </div>
    <div class="frow">
      <div class="flabel">模型</div>
      <div class="fbody" id="chips-model"></div>
    </div>
    <div class="fsum" id="fsum"></div>
  </div>

  <div class="kpis" id="kpis"></div>

  <div class="grid">
    <div class="card span2">
      <div class="chd">
        <h3>每日趋势 <span class="hint" id="trend-hint"></span></h3>
        <div class="seg" id="seg-metric">
          <button data-metric="tokens" class="on">输入 + 输出</button>
          <button data-metric="cache">缓存读取</button>
          <button data-metric="reason">思维链</button>
          <button data-metric="credit">积分</button>
          <button data-metric="calls">调用次数</button>
          <button data-metric="avg">单次 Token</button>
        </div>
      </div>
      <div id="chart-trend"></div>
    </div>

    <div class="card span2">
      <div class="chd"><h3>Token 构成 <span class="hint">输入 + 输出为主；缓存读取已含在输入内、思维链已含在输出内，不重复计</span></h3></div>
      <div id="chart-mix"></div>
    </div>

    <div class="card span2">
      <div class="chd"><h3>积分效率 <span class="hint">按模型 · 每百万 token 积分（分母 = 输入 + 输出）</span></h3></div>
      <div id="chart-eff"></div>
    </div>

    <div class="card span2">
      <div class="chd"><h3>账号 × 模型 <span class="hint" id="am-hint"></span></h3>
        <div class="seg" id="seg-am">
          <button data-am="tokens" class="on">Token</button>
          <button data-am="credit">积分</button>
          <button data-am="calls">调用次数</button>
        </div>
      </div>
      <div id="chart-accountmodel"></div>
    </div>

    <div class="card span2">
      <div class="chd">
        <h3>明细</h3>
        <div class="tools">
          <div class="seg" id="seg-view">
            <button data-view="day" class="on">按日</button>
            <button data-view="account">按账号</button>
            <button data-view="model">按模型</button>
            <button data-view="full">日×账号×模型</button>
          </div>
          <span class="hint" id="tbl-hint"></span>
        </div>
      </div>
      <div class="tblwrap"><table id="tbl"><thead></thead><tbody></tbody></table></div>
    </div>
  </div>

  <div id="notes"></div>
  <div id="enrich"></div>

  <footer>
    数据全部在本机离线生成与渲染，页面不联网、不上传任何内容 · 生成于 __GENERATED__
  </footer>
</div>
<script>
var P = /*__PAYLOAD__*/null;
(function () {
  'use strict';
  if (!P || !P.buckets) {
    document.body.innerHTML = '<div class="wrap"><div class="empty">看板数据为空：内嵌 payload 缺失。请回到 WorkBuddy 面板点「重新生成」。</div></div>';
    return;
  }
  var MON = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  var TOK = [['i','输入','--c-i'],['o','输出','--c-o'],['cr','缓存读取','--c-cr'],['cw','缓存写入','--c-cw'],['th','思维链','--c-th']];
  var MC = ['#2563eb','#f59e0b','#14b8a6','#a855f7','#ec4899','#ef4444','#0ea5e9','#84cc16','#f97316','#6366f1','#0891b2','#7c3aed'];
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 主题 ---------- */
  var m = String(location.search || '').match(/[?&]theme=(dark|light)/);
  var theme = m ? m[1] : null;
  if (!theme) { try { theme = localStorage.getItem('wbs-ub-theme'); } catch (e) { theme = null; } }
  if (!theme) theme = 'light';
  document.documentElement.setAttribute('data-theme', theme);
  $('btn-theme').addEventListener('click', function () {
    theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('wbs-ub-theme', theme); } catch (e) {}
    draw();
  });

  /* ---------- 工具 ---------- */
  function cssv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n) { return (Number.isFinite(Number(n)) ? Number(n) : 0); }
  function fmt(n) {
    n = num(n);
    var s = n < 0 ? '-' : ''; n = Math.abs(n);
    if (n >= 1e9) return s + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return s + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2) + 'M';
    if (n >= 1e3) return s + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return s + (Math.round(n * 100) / 100);
  }
  function fmtFull(n) { return num(n).toLocaleString('en-US'); }
  function cr2(n) { return (Math.round(num(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  // 积分效率的格子：积分明细覆盖不到的区间没有「分子」，显示破折号；
  // 而不是 0（0 会被读成「效率极高」）。内部用 -1 当「无数据」哨兵，排序时自然沉底。
  function cr2orDash(n) { return num(n) < 0 ? '—' : cr2(n); }
  function pct(n) { return (Math.round(num(n) * 10) / 10) + '%'; }
  function d2s(d) { return d.getFullYear() + '-' + MON[d.getMonth()] + '-' + ('0' + d.getDate()).slice(-2); }
  function s2d(s) { var p = String(s).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function addDays(s, n) { var d = s2d(s); d.setDate(d.getDate() + n); return d2s(d); }
  function daySeq(from, to) {
    var out = [], cur = from, guard = 0;
    while (cur <= to && guard < 4000) { out.push(cur); cur = addDays(cur, 1); guard++; }
    return out;
  }
  function shortDay(s) { return String(s).slice(5).replace('-', '/'); }
  function modelColor(list, name) {
    if (!name) return '#9aa3b2';   // 模型未识别的兜底桶：中性灰，别占用某个模型的颜色
    var i = list.indexOf(name);
    return MC[(i < 0 ? 0 : i) % MC.length];
  }

  /* ---------- 维表 ---------- */
  var allDays = (P.days || []).slice().sort();
  var minDay = allDays[0] || d2s(new Date());
  var maxDay = allDays[allDays.length - 1] || d2s(new Date());
  var nickOf = {};
  (P.meta && P.meta.accountOptions || []).forEach(function (a) { if (a && a.uid) nickOf[a.uid] = a.nickname || ''; });
  var currentUid = (P.meta && P.meta.currentUid) || '';

  var accountKeys = [], modelKeys = [];
  (P.accounts || []).forEach(function (a) { if (accountKeys.indexOf(a.uid) < 0) accountKeys.push(a.uid); });
  // 空模型名（模型没识别出来的那几笔）也要留 chip：否则一笔积分在表里看得到、却筛不到，
  // 属于「数字对不上」的一半来源。它的颜色走中性灰。
  (P.models || []).forEach(function (x) { if (modelKeys.indexOf(x.m) < 0) modelKeys.push(x.m); });
  var modelOrder = modelKeys.slice();

  function acctName(uid) {
    if (!uid) return '未归属账号';
    var n = nickOf[uid];
    return n ? n : uid.slice(0, 8);
  }

  /* ---------- 状态 ---------- */
  var state = { from: '', to: '', accts: {}, models: {}, metric: 'tokens', am: 'tokens', view: 'day', sort: { key: 'v', dir: -1 } };
  function setPreset(days) {
    if (!days) { state.from = minDay; state.to = maxDay; }
    else { state.to = maxDay; state.from = addDays(maxDay, -(days - 1)); if (state.from < minDay) state.from = minDay; }
    $('in-from').value = state.from; $('in-to').value = state.to;
  }

  /* ---------- 筛选 ---------- */
  function selectedKeys(map) { return Object.keys(map).filter(function (k) { return map[k]; }); }
  function filtered() {
    var ak = selectedKeys(state.accts), mk = selectedKeys(state.models);
    return (P.buckets || []).filter(function (b) {
      if (state.from && b.d < state.from) return false;
      if (state.to && b.d > state.to) return false;
      if (ak.length && !state.accts[b.a]) return false;
      if (mk.length && !state.models[b.m]) return false;
      return true;
    });
  }
  function blank() { return { i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 }; }
  function add(into, b) {
    into.i += num(b.i); into.o += num(b.o); into.cr += num(b.cr); into.cw += num(b.cw);
    into.th += num(b.th); into.credit += num(b.credit); into.calls += num(b.calls);
    return into;
  }
  function groupOf(rows, keyFn) {
    var map = {}, order = [];
    rows.forEach(function (b) {
      var k = keyFn(b);
      if (!map[k]) { map[k] = blank(); map[k].k = k; order.push(k); }
      add(map[k], b);
    });
    return { map: map, order: order };
  }
  // ⚠️ 口径更正（2026-09-23）：本机 usage 记录里 input_tokens **已包含** cache_read_input_tokens
  //    （实测 total_tokens = input_tokens + output_tokens，且 cache_read ≤ input），
  //    completion_thinking_tokens 同样**已包含**在 output_tokens 里。
  //    ⇒ 总 token = 输入 + 输出；缓存读取 / 思维链只是**子集**，
  //    任何合计都不能再叠一遍（旧版会把总量虚增近一倍）。
  function tokTotal(r) { return num(r.i) + num(r.o); }
  function perMTok(r) { var t = tokTotal(r); return t > 0 ? (r.credit / (t / 1e6)) : 0; }

  /* ---------- 图表原语（纯字符串拼 SVG） ---------- */
  function svgOpen(w, h) { return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">'; }
  function tip(text) { return '<title>' + esc(text) + '</title>'; }

  // 横向条形图：rows = [{label, value, color, sub}]
  function hbar(rows, opt) {
    opt = opt || {};
    var rowH = opt.rowH || 24, padL = opt.padL || 128, padR = 76, w = 1000;
    var h = Math.max(rowH, rows.length * rowH) + 8;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    var s = svgOpen(w, h), barW = w - padL - padR;
    rows.forEach(function (r, idx) {
      var y = idx * rowH + 4, bh = rowH - 9;
      var len = Math.max(r.value > 0 ? 2 : 0, Math.round(barW * (r.value / maxV)));
      s += '<text x="' + (padL - 9) + '" y="' + (y + bh - 1) + '" text-anchor="end">' + esc(r.label) + '</text>';
      s += '<rect x="' + padL + '" y="' + y + '" width="' + barW + '" height="' + bh + '" rx="3" fill="' + (opt.track || 'rgba(128,132,144,.10)') + '"/>';
      if (len > 0) {
        s += '<rect class="bar" x="' + padL + '" y="' + y + '" width="' + len + '" height="' + bh + '" rx="3" fill="' + r.color + '">' +
          tip(r.label + '：' + (r.tip || fmtFull(r.value))) + '</rect>';
      }
      s += '<text x="' + (padL + barW + 8) + '" y="' + (y + bh - 1) + '">' + esc(r.text || fmt(r.value)) + '</text>';
    });
    return s + '</svg>';
  }

  // 堆叠横条（账号 × 模型）
  function hstack(rows, keys, colorOf, opt) {
    opt = opt || {};
    var rowH = opt.rowH || 30, padL = 128, padR = 92, w = 1000;
    var h = rows.length * rowH + 10, barW = w - padL - padR;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    var s = svgOpen(w, h);
    rows.forEach(function (r, idx) {
      var y = idx * rowH + 5, bh = rowH - 13, x = padL;
      s += '<text x="' + (padL - 9) + '" y="' + (y + bh - 1) + '" text-anchor="end">' + esc(r.label) + '</text>';
      s += '<rect x="' + padL + '" y="' + y + '" width="' + barW + '" height="' + bh + '" rx="3" fill="' + (opt.track || 'rgba(128,132,144,.10)') + '"/>';
      keys.forEach(function (k) {
        var v = num(r.parts[k]);
        if (!(v > 0)) return;
        var len = barW * (v / maxV);
        s += '<rect class="seg" x="' + x + '" y="' + y + '" width="' + Math.max(1, len) + '" height="' + bh + '" fill="' + colorOf(k) + '">' +
          tip(r.label + ' · ' + (k || '(未知)') + '：' + (opt.fmt ? opt.fmt(v) : fmtFull(v))) + '</rect>';
        x += len;
      });
      s += '<text x="' + (padL + barW + 8) + '" y="' + (y + bh - 1) + '">' + esc(opt.fmt ? opt.fmt(r.total) : fmt(r.total)) + '</text>';
    });
    return s + '</svg>';
  }

  // 堆叠柱（每日趋势）
  function stackBars(days, series, opt) {
    opt = opt || {};
    var w = 1000, h = opt.h || 280, padL = 62, padR = 14, padT = 12, padB = 34;
    var iw = w - padL - padR, ih = h - padT - padB;
    var totals = days.map(function (_, i) { return series.reduce(function (s, sr) { return s + num(sr.values[i]); }, 0); });
    var maxV = Math.max.apply(null, totals.concat([1]));
    var step = iw / Math.max(1, days.length);
    var bw = Math.max(2, Math.min(38, step - (days.length > 60 ? 1 : 4)));
    var s = svgOpen(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = padT + ih - (ih * g / 4);
      s += '<line class="gl" x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(opt.fmtAxis ? opt.fmtAxis(maxV * g / 4) : fmt(maxV * g / 4)) + '</text>';
    }
    for (var i = 0; i < days.length; i++) {
      var cx = padL + step * i + (step - bw) / 2;
      var y2 = padT + ih;
      var stack = [];
      for (var j = 0; j < series.length; j++) {
        var v = num(series[j].values[i]);
        if (!(v > 0)) continue;
        var hh = ih * (v / maxV);
        y2 -= hh;
        stack.push({ v: v, y: y2, h: hh, color: series[j].color, name: series[j].name });
      }
      var hover = '<rect x="' + (padL + step * i) + '" y="' + padT + '" width="' + step + '" height="' + ih + '" fill="transparent">' +
        tip(days[i] + '　合计 ' + (opt.fmtTip ? opt.fmtTip(totals[i]) : fmtFull(totals[i])) + '\\n' +
          stack.slice().reverse().map(function (it) { return it.name + ' ' + (opt.fmtTip ? opt.fmtTip(it.v) : fmtFull(it.v)); }).join('\\n')) + '</rect>';
      s += hover;
      stack.forEach(function (it) {
        s += '<rect class="bar" x="' + cx + '" y="' + it.y + '" width="' + bw + '" height="' + Math.max(0.8, it.h) + '" fill="' + it.color + '">' +
          tip(days[i] + ' · ' + it.name + '：' + (opt.fmtTip ? opt.fmtTip(it.v) : fmtFull(it.v))) + '</rect>';
      });
    }
    var every = Math.ceil(days.length / 12);
    for (var t = 0; t < days.length; t += every) {
      s += '<text x="' + (padL + step * t + step / 2) + '" y="' + (h - 12) + '" text-anchor="middle">' + esc(shortDay(days[t])) + '</text>';
    }
    s += '<line class="ax" x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (w - padR) + '" y2="' + (padT + ih) + '"/>';
    return s + '</svg>';
  }

  // 折线 + 可选均线
  function lineChart(days, values, opt) {
    opt = opt || {};
    var w = 1000, h = opt.h || 240, padL = 62, padR = 14, padT = 12, padB = 34;
    var iw = w - padL - padR, ih = h - padT - padB;
    var maxV = Math.max.apply(null, values.concat([1]));
    var step = iw / Math.max(1, days.length - 1 || 1);
    function px(i) { return padL + iw * (days.length > 1 ? i / (days.length - 1) : 0.5); }
    function py(v) { return padT + ih - ih * (v / maxV); }
    var s = svgOpen(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = padT + ih - (ih * g / 4);
      s += '<line class="gl" x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(opt.fmtAxis ? opt.fmtAxis(maxV * g / 4) : fmt(maxV * g / 4)) + '</text>';
    }
    var d = '';
    for (var i = 0; i < days.length; i++) d += (i ? ' L' : 'M') + px(i).toFixed(1) + ' ' + py(values[i]).toFixed(1);
    if (values.length) {
      var areaD = d + ' L' + px(days.length - 1).toFixed(1) + ' ' + (padT + ih) + ' L' + px(0).toFixed(1) + ' ' + (padT + ih) + ' Z';
      s += '<path d="' + areaD + '" fill="' + opt.color + '" opacity=".10"/>';
      s += '<path d="' + d + '" fill="none" stroke="' + opt.color + '" stroke-width="1.8" stroke-linejoin="round"/>';
    }
    for (var k = 0; k < days.length; k++) {
      var v = values[k];
      if (!(v > 0)) continue;
      s += '<circle class="pt" cx="' + px(k).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="' + (days.length > 60 ? 1.8 : 3) + '" fill="' + opt.color + '">' +
        tip(days[k] + '：' + (opt.fmtTip ? opt.fmtTip(v) : fmtFull(v))) + '</circle>';
    }
    if (opt.ma && opt.ma.length) {
      var md = '';
      for (var q = 0; q < days.length; q++) md += (q ? ' L' : 'M') + px(q).toFixed(1) + ' ' + py(opt.ma[q]).toFixed(1);
      s += '<path d="' + md + '" fill="none" stroke="' + (opt.maColor || '#8b93a1') + '" stroke-width="1.3" stroke-dasharray="4 3"/>';
    }
    var every = Math.ceil(days.length / 12);
    for (var t2 = 0; t2 < days.length; t2 += every) {
      s += '<text x="' + px(t2).toFixed(1) + '" y="' + (h - 12) + '" text-anchor="middle">' + esc(shortDay(days[t2])) + '</text>';
    }
    s += '<line class="ax" x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (w - padR) + '" y2="' + (padT + ih) + '"/>';
    return s + '</svg>';
  }

  // 100% 堆叠横条（Token 构成）
  function oneBar(parts) {
    var w = 1000, h = 74, padL = 0, padR = 0;
    var total = parts.reduce(function (s, p) { return s + num(p.value); }, 0);
    var s = svgOpen(w, h);
    var x = 0;
    if (!(total > 0)) return s + '<text x="' + (w / 2) + '" y="38" text-anchor="middle">无数据</text></svg>';
    parts.forEach(function (p) {
      var len = w * (num(p.value) / total);
      if (!(p.value > 0)) return;
      s += '<rect class="seg" x="' + x.toFixed(2) + '" y="6" width="' + len.toFixed(2) + '" height="26" fill="' + p.color + '">' +
        tip(p.name + '：' + fmtFull(p.value) + '（' + pct(num(p.value) / total * 100) + '）') + '</rect>';
      if (len > 54) {
        s += '<text x="' + (x + len / 2).toFixed(2) + '" y="23" text-anchor="middle" fill="#fff" style="font-size:10.5px">' + esc(pct(num(p.value) / total * 100)) + '</text>';
      }
      x += len;
    });
    var lx = 0, ly = 52;
    parts.forEach(function (p) {
      var label = p.name + ' ' + fmt(p.value);
      s += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="9" height="9" rx="2" fill="' + p.color + '"/>';
      s += '<text x="' + (lx + 13) + '" y="' + ly + '">' + esc(label) + '</text>';
      lx += 22 + label.length * 6.6;
      if (lx > w - 90) { lx = 0; ly += 17; }
    });
    return s + '</svg>';
  }

  /* ---------- 渲染：筛选 chips ---------- */
  function chipHtml(kind, key, label, color, note) {
    var on = state[kind === 'account' ? 'accts' : 'models'][key] ? ' on' : '';
    return '<span class="chip' + on + '" data-kind="' + kind + '" data-key="' + esc(key) + '" title="' + esc(label) + '">' +
      (color ? '<i class="dot" style="background:' + color + '"></i>' : '') +
      '<span class="nm">' + esc(label) + '</span>' + (note ? '<span class="tag">' + esc(note) + '</span>' : '') + '</span>';
  }
  function renderChips() {
    var accRows = {};
    filtered().forEach(function (b) { accRows[b.a] = add(accRows[b.a] || blank(), b); });
    var aHtml = '<span class="chip' + (selectedKeys(state.accts).length ? '' : ' on') + '" data-kind="account" data-key="">全部</span>';
    accountKeys.forEach(function (uid) {
      var r = accRows[uid] || { i: 0, o: 0, cr: 0, cw: 0, th: 0, credit: 0, calls: 0 };
      // 当前账号也要带 token 数：原来的写法用「当前」顶掉了数字，看起来像这个账号没用量。
      var note = (uid === currentUid ? '当前 · ' : '') + fmt(r.i + r.o);
      aHtml += chipHtml('account', uid, acctName(uid), null, note);
    });
    $('chips-account').innerHTML = aHtml;

    var mHtml = '<span class="chip' + (selectedKeys(state.models).length ? '' : ' on') + '" data-kind="model" data-key="">全部</span>';
    modelKeys.forEach(function (mk) {
      mHtml += chipHtml('model', mk, mk || '(未知模型)', modelColor(modelOrder, mk), '');
    });
    $('chips-model').innerHTML = mHtml;

    document.querySelectorAll('#chips-account .chip,#chips-model .chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var kind = el.getAttribute('data-kind'), key = el.getAttribute('data-key');
        var map = kind === 'account' ? state.accts : state.models;
        if (!key) { Object.keys(map).forEach(function (k) { delete map[k]; }); }
        else { if (map[key]) delete map[key]; else map[key] = true; }
        draw();
      });
    });
  }

  /* ---------- 渲染：KPI ---------- */
  function renderKpis(rows) {
    var t = rows.reduce(function (acc, b) { return add(acc, b); }, blank());
    var dayCount = Math.max(1, (P.days || []).filter(function (d) { return d >= state.from && d <= state.to; }).length);
    var tok = tokTotal(t);
    var eff = t.calls > 0 ? tok / t.calls : 0;
    // 「今天」必须在当前筛选域内算：筛到历史窗口时它诚实地显示 0。
    var todayStr = d2s(new Date());
    var tToday = rows.filter(function (b) { return b.d === todayStr; }).reduce(function (acc, b) { return add(acc, b); }, blank());
    var ioAll = tok;
    // 积分只有 credit-usage.db 覆盖的那几天有明细（本机从 09-14 起），
    // 「每百万 token 积分」必须在**同一区间**里算，否则分子分母口径不同。
    var cov = (P.meta && P.meta.credit) || {};
    var cfrom = cov.coveredFrom || '';
    var cto = cov.coveredTo || '';
    var tCost = cfrom ? rows.filter(function (b) { return b.d >= cfrom; }).reduce(function (acc, b) { return add(acc, b); }, blank()) : t;
    // 总积分的「日均」分母只能是**有积分明细的那几天**：拿整窗口天数去除会把均值稀释成假的小值。
    var crDays = dayCount;
    if (cfrom) {
      var dm = {};
      rows.forEach(function (b) { if (b.d >= cfrom && (!cto || b.d <= cto)) dm[b.d] = 1; });
      crDays = Math.max(1, Object.keys(dm).length);
    }
    var cards = [
      ['总积分', cr2(t.credit), '今日 ' + cr2(tToday.credit) + ' · 日均 ' + cr2(t.credit / crDays) + (cfrom ? '（明细 ' + cfrom + ' 起 ' + crDays + ' 天）' : ''), '--c-credit'],
      ['调用次数', fmtFull(t.calls), '今日 ' + fmtFull(tToday.calls) + ' 次 · 日均 ' + (Math.round(t.calls / dayCount * 10) / 10) + ' 次', null],
      ['输入 Token', fmt(t.i), '今日 ' + fmt(tToday.i) + ' · 占合计 ' + pct(ioAll ? t.i / ioAll * 100 : 0), '--c-i'],
      ['输出 Token', fmt(t.o), '今日 ' + fmt(tToday.o) + ' · 输出/输入 ' + (t.i ? (t.o / t.i * 100).toFixed(1) : '0') + '%', '--c-o'],
      ['缓存读取', fmt(t.cr), '已含在输入内 · 占输入 ' + pct(t.i ? t.cr / t.i * 100 : 0), '--c-cr'],
      ['思维链 Token', fmt(t.th), '已含在输出内 · 占输出 ' + pct(t.o ? t.th / t.o * 100 : 0), '--c-th'],
      ['每百万 Token 积分', cr2(perMTok(tCost)), '口径：' + (cfrom ? cfrom + ' 起' : '全窗口') + '，分母 = 输入 + 输出', null],
      ['单次调用 Token', fmt(eff), '平均每次调用（输入+输出）', null]
    ];
    $('kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="t">' + (c[3] ? '<i class="sw" style="background:var(' + c[3] + ')"></i>' : '') + esc(c[0]) + '</div>' +
        '<div class="v">' + esc(c[1]) + '</div><div class="s">' + esc(c[2]) + '</div></div>';
    }).join('');
  }

  /* ---------- 渲染：图 ---------- */
  function renderTrend(rows) {
    var days = daySeq(state.from, state.to);
    var byDay = {};
    rows.forEach(function (b) { byDay[b.d] = add(byDay[b.d] || blank(), b); });
    var host = $('chart-trend');
    var mt = state.metric;
    if (mt === 'tokens') {
      // 总 token = 输入 + 输出（缓存读取已含于输入、思维链已含于输出）
      // ⇒ 只堆这两项才不会重复计。
      var series = [
        { name: '输入（含缓存读取）', key: 'i', color: cssv('--c-i') },
        { name: '输出（含思维链）', key: 'o', color: cssv('--c-o') }
      ].map(function (k) {
        return { name: k.name, color: k.color, values: days.map(function (d) { return num((byDay[d] || blank())[k.key]); }) };
      }).filter(function (s2) { return s2.values.some(function (v) { return v > 0; }); });
      host.innerHTML = stackBars(days, series, { fmtTip: fmtFull, fmtAxis: fmt }) +
        '<div class="legend" style="margin-top:6px">' + series.map(function (s2) { return '<span><i style="background:' + s2.color + '"></i>' + esc(s2.name) + '</span>'; }).join('') + '</div>';
      $('trend-hint').textContent = '按日堆叠 · 输入 + 输出（不重复计缓存）';
      return;
    }
    var vals = days.map(function (d) {
      var r = byDay[d] || blank();
      if (mt === 'credit') return num(r.credit);
      if (mt === 'calls') return num(r.calls);
      if (mt === 'cache') return num(r.cr);
      if (mt === 'reason') return num(r.th);
      return r.calls > 0 ? tokTotal(r) / r.calls : 0;
    });
    var ma = [], win = 7;
    for (var i = 0; i < vals.length; i++) {
      var s3 = 0, n = 0;
      for (var j = Math.max(0, i - win + 1); j <= i; j++) { s3 += vals[j]; n++; }
      ma.push(n ? s3 / n : 0);
    }
    var label = mt === 'credit' ? '积分' : (mt === 'calls' ? '调用次数' : (mt === 'cache' ? '缓存读取' : (mt === 'reason' ? '思维链' : '单次 token')));
    var color = mt === 'credit' ? cssv('--c-credit') : (mt === 'calls' ? '#6366f1' : (mt === 'cache' ? cssv('--c-cr') : (mt === 'reason' ? cssv('--c-th') : '#0ea5e9')));
    host.innerHTML = lineChart(days, vals, { color: color, ma: ma, maColor: cssv('--tx3'), fmtTip: mt === 'credit' ? cr2 : fmtFull, fmtAxis: mt === 'credit' ? cr2 : fmt }) +
      '<div class="legend" style="margin-top:6px"><span><i style="background:' + color + '"></i>' + esc(label) + '</span><span><i style="background:' + cssv('--tx3') + '"></i>7 日均线</span></div>';
    $('trend-hint').textContent = '按日 · 单位' + label;
  }

  function renderMix(rows) {
    var t = rows.reduce(function (acc, b) { return add(acc, b); }, blank());
    var io = tokTotal(t);
    // 四根条全部共用同一个比例尺：输入/输出是主体，缓存读取/思维链作为子集对照看，
    // 不再像旧版那样把四项堆成一条 100% 条（会把缓存算两遍）。
    var bars = [
      { label: '输入（含缓存读取）', value: num(t.i), color: cssv('--c-i') },
      { label: '其中缓存读取', value: num(t.cr), color: cssv('--c-cr') },
      { label: '输出（含思维链）', value: num(t.o), color: cssv('--c-o') },
      { label: '其中思维链', value: num(t.th), color: cssv('--c-th') }
    ];
    var kv = '<div class="kv" style="margin-top:10px">' +
      '<div class="item"><div class="k">合计（输入 + 输出）</div><div class="v">' + esc(fmtFull(io)) + '</div></div>' +
      '<div class="item"><div class="k">输出 ÷ 输入</div><div class="v">' + esc(pct(t.i ? t.o / t.i * 100 : 0)) + '</div></div>' +
      '<div class="item"><div class="k">缓存读取 ÷ 输入</div><div class="v">' + esc(pct(t.i ? t.cr / t.i * 100 : 0)) + '</div></div>' +
      '<div class="item"><div class="k">思维链 ÷ 输出</div><div class="v">' + esc(pct(t.o ? t.th / t.o * 100 : 0)) + '</div></div>' +
      '<div class="item"><div class="k">缓存写入</div><div class="v">' + esc(fmtFull(t.cw)) + '</div></div>' +
    '</div>';
    $('chart-mix').innerHTML = hbar(bars, { rowH: 30, padL: 150 }) + kv;
  }

  function renderEfficiency(rows) {
    // 同 renderKpis：只在「积分有明细」的区间里算积分效率，分子分母同口径。
    var cov = (P.meta && P.meta.credit) || {};
    if (cov.coveredFrom) rows = rows.filter(function (b) { return b.d >= cov.coveredFrom; });
    var g = groupOf(rows, function (b) { return b.m; });
    var list = g.order.map(function (k) { var r = g.map[k]; return { m: k, r: r, v: perMTok(r) }; })
      .filter(function (x) { return x.r.credit > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    if (!list.length) { $('chart-eff').innerHTML = '<div class="empty">当前筛选下没有可归属到模型的积分</div>'; return; }
    var maxV = Math.max.apply(null, list.map(function (x) { return x.v; }).concat([1]));
    var rowH = 26, w = 1000, padL = 168, padR = 96, h = list.length * rowH + 8, barW = w - padL - padR;
    var s = svgOpen(w, h);
    list.forEach(function (x, i) {
      var y = i * rowH + 4, bh = rowH - 10;
      var len = Math.max(2, barW * (x.v / maxV));
      s += '<text x="' + (padL - 9) + '" y="' + (y + bh - 1) + '" text-anchor="end">' + esc(x.m || '(未知)') + '</text>';
      s += '<rect class="bar" x="' + padL + '" y="' + y + '" width="' + len + '" height="' + bh + '" rx="3" fill="' + modelColor(modelOrder, x.m) + '">' +
        tip((x.m || '(未知)') + '：每百万 token ' + cr2(x.v) + ' 积分\\n合计积分 ' + cr2(x.r.credit) + ' · token ' + fmtFull(tokTotal(x.r))) + '</rect>';
      s += '<text x="' + (padL + barW + 8) + '" y="' + (y + bh - 1) + '">' + esc(cr2(x.v)) + '</text>';
      // 「条内小字」= 该模型合计积分，按图注就**必须画在条内**（右对齐到条尾）。
      // 旧版画在条尾之后（x = padL + len + 6）：当 len 拉满成 barW 时，这个 x 恰好等于
      // 右侧刻度值那一格（x = padL + barW + 8），两段文字叠在一起 —— 就是用户报的「重叠看不清」。
      // 只有条太短、条内塞不下时才退回条尾之后；此时 x 离右侧刻度还差得很远，不会重叠。
      var subTxt = cr2(x.r.credit);
      var subW = subTxt.length * 6 + 8;          // 10px 字号的经验宽度（含两侧留白）
      var inBar = len >= subW + 10;
      s += '<text x="' + (inBar ? (padL + len - 6) : (padL + len + 6)) + '" y="' + (y + bh - 1) + '"'
        + (inBar
          ? ' text-anchor="end" fill="#fff" opacity=".92" style="font-size:10px;paint-order:stroke;stroke:rgba(0,0,0,.28);stroke-width:2px;stroke-linejoin:round"'
          : ' fill="var(--tx3)" style="font-size:10px"')
        + '>' + esc(subTxt) + '</text>';
    });
    s += '</svg>';
    $('chart-eff').innerHTML = s + '<div style="margin-top:6px;color:var(--tx3);font-size:11px">条长 = 每百万 token 积分；条内小字 = 该模型合计积分</div>';
  }

  function renderAccountModel(rows) {
    var byAcct = {};
    rows.forEach(function (b) {
      var a = byAcct[b.a] || (byAcct[b.a] = { total: 0, parts: {} });
      var v = state.am === 'credit' ? num(b.credit) : (state.am === 'calls' ? num(b.calls) : num(b.i) + num(b.o));
      a.parts[b.m] = num(a.parts[b.m]) + v;
      a.total += v;
    });
    var list = accountKeys.filter(function (k) { return byAcct[k] && byAcct[k].total > 0; })
      .map(function (k) { return { label: acctName(k), total: byAcct[k].total, parts: byAcct[k].parts }; })
      .sort(function (a, b) { return b.total - a.total; });
    if (!list.length) { $('chart-accountmodel').innerHTML = '<div class="empty">无数据</div>'; return; }
    var used = modelKeys.slice();
    var fmtFn = state.am === 'credit' ? cr2 : fmt;
    $('chart-accountmodel').innerHTML = hstack(list, used, function (k) { return modelColor(modelOrder, k); }, { fmt: fmtFn, rowH: 32 }) +
      '<div class="legend" style="margin-top:8px">' + used.map(function (k) {
        return '<span><i style="background:' + modelColor(modelOrder, k) + '"></i>' + esc(k || '(未知模型)') + '</span>';
      }).join('') + '</div>';
    $('am-hint').textContent = state.am === 'credit' ? '单位积分' : (state.am === 'calls' ? '单位次数' : '单位 token（输入+输出）');
  }

  /* ---------- 渲染：明细表 ---------- */
  // 列序（重排）：先看量（输入/输出/合计）→ 子集（缓存读取）→ 计费（次数/积分）→ 效率。
  // 「思维链」列去掉：它已含在输出内，并列容易被误认为可相加；
  // 它现在只在「Token 构成」卡里作为子集对照展示。
  var COLS = [
    { key: 'n', label: '名称', align: 'l' },
    { key: 'i', label: '输入', fmt: fmt, full: fmtFull, note: '含缓存读取' },
    { key: 'o', label: '输出', fmt: fmt, full: fmtFull, note: '含思维链' },
    { key: 'io', label: '合计', fmt: fmt, full: fmtFull, note: '输入+输出' },
    { key: 'cr', label: '缓存读取', fmt: fmt, full: fmtFull, note: '含于输入' },
    { key: 'calls', label: '次数', fmt: fmtFull, full: fmtFull },
    { key: 'credit', label: '积分', fmt: cr2orDash, full: cr2orDash },
    { key: 'v', label: '积分/百万token', fmt: cr2orDash, full: cr2orDash, note: '分母=输入+输出' }
  ];
  function renderTable(rows) {
    var view = state.view;
    var keyFn = view === 'day' ? function (b) { return b.d; }
      : view === 'account' ? function (b) { return b.a; }
        : view === 'model' ? function (b) { return b.m; }
          : function (b) { return b.d + ' | ' + (b.a || '-') + ' | ' + (b.m || '-'); };
    var g = groupOf(rows, keyFn);
    // 积分明细只覆盖 credit-usage.db 同步到的那几天；「积分/百万token」必须分子分母同区间，
    // 否则窗口一大就会把「几天积分 ÷ 整窗口 token」算成偏小的假效率（和 KPI 卡自相矛盾）。
    var covFrom = ((P.meta || {}).credit || {}).coveredFrom || '';
    var covMap = covFrom ? groupOf(rows.filter(function (b) { return b.d >= covFrom; }), keyFn).map : {};
    var list = g.order.map(function (k) {
      var r = g.map[k];
      var label = view === 'account' ? acctName(k) : (view === 'model' ? (k || '(未知模型)') : k);
      if (view === 'full') { var p = k.split(' | '); label = p[0] + ' · ' + (p[1] === '-' ? '未归属' : acctName(p[1])) + ' · ' + (p[2] === '-' ? '(未知模型)' : p[2]); }
      var cv = covFrom ? covMap[k] : r;
      // 日视图里，覆盖区间之前的那些天是「没有积分明细」，不是「积分为 0」——分开显示，避免读成免费。
      var cVal = (view === 'day' && covFrom && k < covFrom) ? -1 : r.credit;
      return { n: label, k: k, i: r.i, o: r.o, io: num(r.i) + num(r.o), cr: r.cr, th: r.th, credit: cVal, calls: r.calls, v: cv ? perMTok(cv) : -1 };
    });
    var sortKey = state.sort.key, dir = state.sort.dir;
    list.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string' || typeof y === 'string') return String(y).localeCompare(String(x)) * -dir;
      return (x - y) * dir;
    });
    var head = COLS.map(function (c) {
      var lb = esc(c.label) + (c.note ? '<span style="display:block;font-weight:400;opacity:.6;font-size:10px;letter-spacing:0">' + esc(c.note) + '</span>' : '');
      return '<th data-sort="' + c.key + '" class="' + (sortKey === c.key ? 'on' : '') + '" style="text-align:' + (c.align === 'l' ? 'left' : 'right') + '">' +
        lb + (sortKey === c.key ? (dir < 0 ? ' ↓' : ' ↑') : '') + '</th>';
    }).join('');
    var body = list.slice(0, 200).map(function (r) {
      return '<tr>' + COLS.map(function (c) {
        var v = r[c.key];
        var text = c.fmt ? c.fmt(v) : esc(v);
        var title = c.full && c.full !== c.fmt ? ' title="' + esc(c.full(v)) + '"' : '';
        return '<td' + title + '>' + esc(text) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tot = rows.reduce(function (acc, b) { return add(acc, b); }, blank());
    var totCov = covFrom ? rows.filter(function (b) { return b.d >= covFrom; }).reduce(function (acc, b) { return add(acc, b); }, blank()) : tot;
    var totRow = { n: '合计（' + list.length + ' 行）', i: tot.i, o: tot.o, io: num(tot.i) + num(tot.o), cr: tot.cr, th: tot.th, credit: tot.credit, calls: tot.calls, v: perMTok(totCov) };
    body += '<tr class="tot">' + COLS.map(function (c) {
      var v = totRow[c.key];
      return '<td>' + esc(c.fmt ? c.fmt(v) : v) + '</td>';
    }).join('') + '</tr>';
    $('tbl').querySelector('thead').innerHTML = '<tr>' + head + '</tr>';
    $('tbl').querySelector('tbody').innerHTML = body || '<tr><td colspan="' + COLS.length + '" style="text-align:center;color:var(--tx3)">无数据</td></tr>';
    $('tbl').querySelectorAll('th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort.key === k) state.sort.dir = -state.sort.dir;
        else { state.sort.key = k; state.sort.dir = k === 'n' ? 1 : -1; }
        draw();
      });
    });
    $('tbl-hint').textContent = (list.length > 200 ? '共 ' + list.length + ' 行，显示前 200 行' : '共 ' + list.length + ' 行') + (covFrom ? ' · 「积分/百万token」只算 ' + covFrom + ' 起' : '');
  }

  /* ---------- 渲染：补充指标 / 提示 ---------- */
  // 会话名的回补来源（服务端 session-titles.js 给出），只用于 tooltip：让用户知道这个名字
  // 是官方库里的原值，还是从副本/正文/日志里接回来的，便于判断可信度。
  var TITLE_SOURCE_LABEL = {
    db: '官方会话库',
    lineage: '副本血缘',
    saved: '标题快照',
    jsonl: '会话正文 aiTitle',
    'client-cache': '客户端缓存快照',
    'first-prompt': '首条提问（已脱敏）',
  };
  function renderEnrich() {
    var e = P.enrich || { available: false };
    var host = $('enrich');
    if (!e.available) {
      host.innerHTML = '<div class="sec-title">补充指标<span class="sub">未启用</span></div>' +
        '<div class="empty">补充指标来自第三方抽取器（workbuddy-usage-status）的产物；本机没有该产物时这一段为空，不影响上面的三维筛选与统计。</div>';
      return;
    }
    var kv = [
      ['请求数', e.totalRequests === null ? '-' : fmtFull(e.totalRequests)],
      ['会话数', e.totalSessions === null ? '-' : fmtFull(e.totalSessions)],
      ['错误数', e.totalErrors === null ? '-' : fmtFull(e.totalErrors)],
      ['缓存命中率', e.cacheRate === null ? '-' : pct(e.cacheRate)],
      ['累计思考时长', e.totalThinkingHours === null ? '-' : cr2(e.totalThinkingHours) + ' 小时'],
      ['单次平均思考', e.avgThinkingSecPerRequest === null ? '-' : cr2(e.avgThinkingSecPerRequest) + ' 秒'],
      ['平均生成速率', e.avgEfficiencyTokPerSec === null ? '-' : cr2(e.avgEfficiencyTokPerSec) + ' tok/s'],
      ['覆盖区间', (e.dateMin || '-') + ' → ' + (e.dateMax || '-')]
    ];
    var html = '<div class="sec-title">补充指标<span class="sub">来自第三方抽取器 · 全窗口口径（不随上面的筛选联动，也不含账号维度）</span></div>';
    html += '<div class="kv">' + kv.map(function (x) {
      return '<div class="item"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>';
    }).join('') + '</div>';

    if (e.cacheModel && e.cacheModel.length) {
      html += '<div class="sec-title" style="margin-top:16px">缓存命中率（按模型）<span class="sub">' + esc(e.cacheCaliber || '') + '</span></div>';
      html += '<table class="mini-table"><thead><tr><th>模型</th><th>请求</th><th>缓存读取</th><th>输入合计</th><th>命中率</th></tr></thead><tbody>' +
        e.cacheModel.map(function (r2) {
          return '<tr><td>' + esc(r2.model || '-') + '</td><td>' + esc(r2.calls === null ? '-' : fmtFull(r2.calls)) + '</td><td>' + esc(fmt(r2.cached)) +
            '</td><td>' + esc(fmt(r2.input)) + '</td><td>' + esc(r2.rate === null ? '-' : pct(r2.rate)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if (e.topErrors && e.topErrors.length) {
      html += '<div class="sec-title" style="margin-top:16px">高频错误<span class="sub">共 ' + esc(e.totalErrors === null ? '-' : fmtFull(e.totalErrors)) + ' 次</span></div>';
      html += '<table class="mini-table"><thead><tr><th>错误信息</th><th>次数</th></tr></thead><tbody>' +
        e.topErrors.map(function (r2) { return '<tr><td>' + esc(r2.message || '-') + '</td><td>' + esc(r2.count === null ? '-' : fmtFull(r2.count)) + '</td></tr>'; }).join('') +
        '</tbody></table>';
    }
    if (e.spikeDays && e.spikeDays.length) {
      html += '<div class="sec-title" style="margin-top:16px">用量高峰日<span class="sub">按 token 排序</span></div>';
      html += '<table class="mini-table"><thead><tr><th>日期</th><th>Token</th><th>积分</th><th>请求</th><th>错误率</th><th>单次最大 token</th></tr></thead><tbody>' +
        e.spikeDays.map(function (r2) {
          return '<tr><td>' + esc(r2.date || '-') + '</td><td>' + esc(fmt(r2.tokens)) + '</td><td>' + esc(cr2(r2.credit)) + '</td><td>' +
            esc(r2.requests === null ? '-' : fmtFull(r2.requests)) + '</td><td>' + esc(r2.errRate === null ? '-' : pct(r2.errRate)) + '</td><td>' +
            esc(fmt(r2.maxRequestTokens)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if (e.topSessions && e.topSessions.length) {
      html += '<div class="sec-title" style="margin-top:16px">会话排行<span class="sub">按 token 前 15 · 会话名取自官方会话库，缺失时依次用副本血缘 / 标题快照 / 正文 aiTitle / 客户端缓存 / 首条提问回补（悬停单条可看来源）</span></div>';
      html += '<table class="mini-table"><thead><tr><th>会话</th><th>模型</th><th>请求</th><th>Token</th><th>积分</th><th>错误</th><th>首日</th></tr></thead><tbody>' +
        e.topSessions.map(function (r2) {
          // 标题缺失时**绝不能回落成裸 UUID**（r2.sessionId）——一串 36 位 id 在表里看起来就是乱码。
          // 会话 id 来自官方 trace（原始 id），而库里存的是切号自动复制出的副本 id，两边对不上；
          // 服务端已用 session-titles 的多源解析把名字接回来（见 scripts/session-titles.js），
          // 真接不回来的才显示占位，并把来源与完整 id 放进 tooltip，既不装假标题也不丢线索。
          var sid = String(r2.sessionId || '');
          var title = String(r2.title || '').trim() || (sid ? '(未命名会话 · ' + sid.slice(0, 8) + ')' : '(未命名会话)');
          var srcLabel = TITLE_SOURCE_LABEL[r2.titleSource] || '';
          var tip = [];
          if (sid) tip.push('会话 ID：' + sid);
          if (srcLabel) tip.push('名称来源：' + srcLabel);
          var idTip = tip.length ? ' title="' + esc(tip.join(' ｜ ')) + '"' : '';
          return '<tr><td' + idTip + '>' + esc(title) + '</td><td>' + esc(r2.model || r2.models || '-') + '</td><td>' +
            esc(r2.requests === null ? '-' : fmtFull(r2.requests)) + '</td><td>' + esc(fmt(r2.tokens)) + '</td><td>' + esc(cr2(r2.credit)) + '</td><td>' +
            esc(r2.errors === null ? '-' : fmtFull(r2.errors)) + '</td><td>' + esc(r2.firstDate || '-') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    host.innerHTML = html;
  }

  function renderNotes() {
    var list = [];
    list.push('Token 口径（2026-09-23 更正）：本机 usage 记录里 input_tokens 已包含 cache_read_input_tokens、completion_thinking_tokens 已包含在 output_tokens 内（实测 total_tokens = input_tokens + output_tokens）。因此本页「合计 token」= 输入 + 输出；缓存读取与思维链仅作子集展示，不再叠加——旧版把它们一起加进去，会把总量虚增近一倍。');
    var cov = (P.meta && P.meta.credit) || {};
    if (cov.source === 'usage-records') {
      list.push('积分口径：' + cov.label + '；覆盖 ' + (cov.coveredFrom || '—') + ' → ' + (cov.coveredTo || '—') +
        '，合计 ' + fmtFull(cov.rows) + ' 个（日期 × 账号 × 模型）组合 / ' + fmtFull(cov.requests) + ' 次请求 / ' + cr2(cov.total) + ' 积分。' +
        '这份记录从 ' + (cov.coveredFrom || '—') + ' 才开始同步，更早的日期没有积分明细（token 数据不受影响，仍是完整窗口）。');
    } else if (cov.source === 'credit-jsonl') {
      list.push('积分口径：' + cov.label + '，覆盖有限，趋势图里的积分仅供参考。');
    } else {
      list.push('积分口径：未找到可用积分数据源（credit-usage.db 与 workbuddy.db 都读不到），本页积分列全为 0；token 数据不受影响。');
    }
    (P.warnings || []).forEach(function (w) { if (w && w.detail) list.push(w.detail); });
    var e = P.enrich || {};
    if (e.available) list.push('补充指标里的积分口径与上面不同（第三方抽取器读的是另一份账单，数值明显偏小且滞后），因此本页只取它的错误率、思考时长、缓存命中与会话排行。');
    (e.warnings || []).forEach(function (w) { if (w && w.detail) list.push('（第三方）' + w.detail); });
    $('notes').innerHTML = '<div class="note"><b>数据口径提示</b><ul>' +
      list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  function renderHead(rows) {
    var cov = (P.meta && P.meta.credit) || {};
    var t = rows.reduce(function (acc, b) { return add(acc, b); }, blank());
    var srcLabel = cov.source === 'usage-records' ? '官方逐请求记录（credit-usage.db）'
      : (cov.source === 'credit-jsonl' ? '兜底口径（会话级 credit_json）' : '无');
    // 口径必须写在数字旁边：积分明细只有 10 天、token 有 90 天，不标清楚两个数字会被当成同一件事。
    var bits = [
      '配置窗口 <b>' + esc(P.meta.days) + '</b> 天',
      '本页命中（随筛选）<b>' + esc(fmtFull(t.calls)) + '</b> 次 / <b>' + esc(cr2(t.credit)) + '</b> 积分',
      '积分来源 <b>' + esc(srcLabel) + '</b>',
      '积分覆盖 <b>' + esc(cov.coveredFrom || '—') + ' → ' + esc(cov.coveredTo || '—') + '</b>',
      'Token 扫描 <b>' + esc(fmtFull(P.meta.files)) + '</b> 文件 / <b>' + esc(fmtFull(P.meta.parsedLines)) + '</b> 行',
      '解析错误 <b>' + esc(fmtFull(P.meta.parseErrors)) + '</b>'
    ];
    $('hmeta').innerHTML = bits.map(function (b) { return '<span>' + b + '</span>'; }).join('') +
      '<span>生成于 <b>' + esc(new Date(P.meta.generatedAt).toLocaleString('zh-CN', { hour12: false })) + '</b></span>';
  }

  /* ---------- 主循环 ---------- */
  function draw() {
    var rows = filtered();
    renderHead(rows);
    renderChips();
    renderKpis(rows);
    renderTrend(rows);
    renderMix(rows);
    renderEfficiency(rows);
    renderAccountModel(rows);
    renderTable(rows);
    renderEnrich();
    renderNotes();

    var ak = selectedKeys(state.accts).length, mk = selectedKeys(state.models).length;
    $('fsum').innerHTML = '<span class="k">当前筛选</span>' +
      '<span>' + esc(state.from) + ' → ' + esc(state.to) + '</span>' +
      '<span>账号 ' + (ak ? esc(ak + ' 个已选') : '全部') + '</span>' +
      '<span>模型 ' + (mk ? esc(mk + ' 个已选') : '全部') + '</span>' +
      '<span>命中 ' + esc(fmtFull(rows.length)) + ' 个 (日×账号×模型) 组合</span>';
    $('range-hint').textContent = '数据可用区间 ' + minDay + ' → ' + maxDay;
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll('#seg-days button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#seg-days button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      setPreset(Number(b.getAttribute('data-days')));
      draw();
    });
  });
  $('in-from').addEventListener('change', function () { state.from = this.value || minDay; draw(); });
  $('in-to').addEventListener('change', function () { state.to = this.value || maxDay; draw(); });
  document.querySelectorAll('#seg-metric button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#seg-metric button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); state.metric = b.getAttribute('data-metric'); draw();
    });
  });
  document.querySelectorAll('#seg-am button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#seg-am button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); state.am = b.getAttribute('data-am'); draw();
    });
  });
  document.querySelectorAll('#seg-view button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#seg-view button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); state.view = b.getAttribute('data-view'); state.sort = { key: 'v', dir: -1 }; draw();
    });
  });
  $('btn-reset').addEventListener('click', function () {
    state.accts = {}; state.models = {};
    document.querySelectorAll('#seg-days button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-days') === '7'); });
    setPreset(7); draw();
  });
  $('btn-csv').addEventListener('click', function () {
    var rows = filtered();
    var head = ['日期', '账号uid', '账号', '模型', '输入', '输出', '缓存读取', '缓存写入', '思维链', '积分', '次数'];
    var lines = [head.join(',')];
    rows.forEach(function (b) {
      lines.push([b.d, b.a, acctName(b.a), b.m, b.i, b.o, b.cr, b.cw, b.th, Math.round(num(b.credit) * 100) / 100, b.calls]
        .map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(','));
    });
    var blob = new Blob(['\\ufeff' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'usage-unified-' + d2s(new Date()).replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  });

  var preset = 7;
  document.querySelectorAll('#seg-days button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-days') === '7'); });
  setPreset(preset);
  draw();
})();
</script>
</body>
</html>
`;

/** payload → 完整 HTML 字符串（原始字符串替换，避免 $ 序列被当成替换指令）。 */
function renderUsageBoardHtml(payload) {
  const parts = TPL.split(PLACEHOLDER);
  if (parts.length !== 2) throw new Error('看板模板占位符数量异常（期望 1 处命中，实得 ' + (parts.length - 1) + '）');
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const generated = new Date(Number(payload && payload.meta && payload.meta.generatedAt) || Date.now())
    .toLocaleString('zh-CN', { hour12: false });
  // __GENERATED__ 只出现在页脚（占位符之前），所以两侧都要过一遍再拼接。
  const head = parts[0].replace(/__GENERATED__/g, () => generated);
  const tail = parts[1].replace(/__GENERATED__/g, () => generated);
  return head + json + tail;
}

module.exports = { renderUsageBoardHtml, TEMPLATE: TPL };
