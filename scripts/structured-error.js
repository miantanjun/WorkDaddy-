'use strict';
/**
 * F2 第二期（信号源）· 渲染层结构化错误采集 —— **纯逻辑 + 自包含 CDP 表达式**。
 *
 * 背景（详见 skill `workdaddy-maintain` references/05 §52 + F2 前置关口报告）：
 *   官方云请求由**主进程**发出，渲染进程只看得到「归类后的结果」；
 *   渲染侧因此没有原始响应可旁听。可用的正规观测点实测只剩一个：
 *     `provider.api.onSessionEvent(cb)` → `client.on('session:event', cb)`
 *   （频道名来自 asar `/preload/index.js` 的 `SESSION_RPC_CHANNELS.EVENT === 'session:event'`）。
 *
 * 本模块只做三件事，**全部是纯函数 / 纯字符串**，不碰网络、不改官方请求：
 *   1. `scanStructuredError(value)` —— 形状无关地在任意嵌套对象里找结构化错误字段；
 *   2. `observationFrom(...)`        —— 把「横幅 hits + 结构化信号」合成一条 health 观测；
 *   3. `structuredErrorProbeExpression()` —— 生成「幂等安装监听 + 回读最近一次信号」的 CDP 表达式。
 *
 * ⚠️ 纪律：
 *   · 官方字段形状会变 ⇒ 一律**多字段容错**，找不到就 `found:false`，调用方静默退回横幅；
 *   · 表达式里的一切必须自包含（不能引用本模块的其它标识符），因为它会被 `toString()` 后送进页面。
 */

/** 会话事件频道（asar `SESSION_RPC_CHANNELS.EVENT`）。 */
const SESSION_EVENT_CHANNEL = 'session:event';

/** 渲染层槽位名 + 环形缓冲上限（诊断用，只保留最近 20 条）。 */
const RENDERER_SLOT = '__wbsStructuredError';
const RING_MAX = 20;

/**
 * 形状无关扫描。**自包含**（不得引用模块级常量）—— 会被内联进页面执行。
 *
 * 认得的键（大小写敏感，按可信度排序）：
 *   · 业务码：bizCode / biz_code / errorCode / errCode / code
 *   · HTTP  ：httpStatus / http_status / status（仅当值落在已知 HTTP 码表里才认，避免撞 task state）
 *   · 停止因：stopReason / stop_reason / finishReason / finish_reason
 *   · 文案  ：message / serverDetail / server_detail / detail / errorMessage
 */
function scanStructuredError(value, options) {
  var opt = (options && typeof options === 'object') ? options : {};
  var maxDepth = Number(opt.maxDepth) > 0 ? Number(opt.maxDepth) : 6;
  var maxNodes = Number(opt.maxNodes) > 0 ? Number(opt.maxNodes) : 400;
  var HTTP = [400, 401, 402, 403, 404, 405, 406, 408, 409, 412, 413, 415, 422, 425, 428, 429, 500, 501, 502, 503, 504, 505, 507, 529];
  var out = {
    found: false, score: 0,
    bizCode: '', code: '', httpStatus: 0,
    stopReason: '', message: '', detail: '',
    keys: [], paths: [],
  };
  var seen = 0;
  var visited = [];

  function isPlain(o) {
    if (!o || typeof o !== 'object') return false;
    for (var i = 0; i < visited.length; i++) { if (visited[i] === o) return false; }
    return true;
  }
  function asText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }
  function asHttp(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    if (HTTP.indexOf(n) >= 0) return n;
    if (n >= 500 && n <= 599) return n;
    return 0;
  }

  function walk(node, depth, path) {
    if (!node || typeof node !== 'object') return;
    if (depth > maxDepth || seen > maxNodes) return;
    if (!isPlain(node)) return;
    visited.push(node);
    seen += 1;
    var keys = [];
    try { keys = Object.keys(node); } catch (e) { keys = []; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = null;
      try { v = node[k]; } catch (e) { continue; }
      var t = asText(v);
      if (/^(bizCode|biz_code)$/.test(k) && t) {
        if (!out.bizCode) { out.bizCode = t; out.paths.push(path + '.' + k); out.found = true; out.score += 100; }
      } else if (/^(errorCode|errCode)$/.test(k) && t) {
        if (!out.code) { out.code = t; out.paths.push(path + '.' + k); out.found = true; out.score += 80; }
      } else if (k === 'code' && t && !/^0$/.test(t)) {
        if (!out.code) { out.code = t; out.paths.push(path + '.' + k); out.found = true; out.score += 70; }
      } else if (/^(httpStatus|http_status)$/.test(k)) {
        var hs = asHttp(v);
        if (hs && !out.httpStatus) { out.httpStatus = hs; out.paths.push(path + '.' + k); out.found = true; out.score += 90; }
      } else if (k === 'status') {
        var hs2 = asHttp(v);
        if (hs2 && !out.httpStatus) { out.httpStatus = hs2; out.paths.push(path + '.' + k); out.found = true; out.score += 60; }
      } else if (/^(stopReason|stop_reason|finishReason|finish_reason)$/.test(k) && t) {
        if (!out.stopReason) { out.stopReason = t; out.paths.push(path + '.' + k); out.found = true; out.score += 50; }
      } else if (/^(message|errorMessage)$/.test(k) && t) {
        if (!out.message) { out.message = t; out.paths.push(path + '.' + k); out.score += 10; }
      } else if (/^(serverDetail|server_detail|detail)$/.test(k) && t) {
        if (!out.detail) { out.detail = t; out.paths.push(path + '.' + k); out.score += 10; }
      }
      if (v && typeof v === 'object') walk(v, depth + 1, path + '.' + k);
    }
  }
  walk(value, 0, '');

  out.bizCode = out.bizCode.slice(0, 32);
  out.code = out.code.slice(0, 32);
  out.stopReason = out.stopReason.slice(0, 64);
  out.message = out.message.slice(0, 300);
  out.detail = out.detail.slice(0, 300);
  out.keys = Object.keys(value && typeof value === 'object' ? value : {}).slice(0, 16);
  out.paths = out.paths.slice(0, 6);
  return out;
}

/**
 * 合成一条 health 观测（纯函数，daemon 与测试共用同一份判据）。
 *
 * **零行为变化保证**：`structured` 为空（当前常态）时，返回对象与 F2 之前**逐字相同**
 * ——`{source:'dom-banner', hits, modelId, text}`。
 *
 * @param {object|null} structured `scanStructuredError` 的结果（可含 `ts`）
 * @param {object} [options] { hits, modelId }
 */
function observationFrom(structured, options) {
  const opt = options && typeof options === 'object' ? options : {};
  const hits = Array.isArray(opt.hits) ? opt.hits : [];
  const modelId = String(opt.modelId || '').trim();
  const bannerText = hits.map((hit) => String((hit && hit.text) || '')).filter(Boolean).join(' | ');
  const s = structured && structured.found === true ? structured : null;
  const rawBiz = s ? String(s.bizCode || '').trim() : '';
  const rawCode = s ? String(s.code || '').trim() : '';
  // `code` 里只有「业务码形状」的才允许当 bizCode 用（6004 / 11102 / 14012 这类）；
  // HTTP 码（429/401）留给自己那一层判，别混进业务码通道。
  const codeAsBiz = (!rawBiz && /^(?:6\d{3}|1[14]\d{3})$/.test(rawCode)) ? rawCode : '';
  const bizCode = rawBiz || codeAsBiz;
  const httpStatus = s ? Number(s.httpStatus) || 0 : 0;

  // 结构化信号顺带把 stopReason / message / detail / code 拼进 text ——
  // 这样 account-health 既有的「文案层」也能吃到它，等于多一层免费兜底。
  const parts = [];
  if (bannerText) parts.push(bannerText);
  if (s) {
    if (bizCode) parts.push('bizCode=' + bizCode);
    if (/^\d+$/.test(rawCode) && rawCode !== bizCode) parts.push('code=' + rawCode);
    if (s.stopReason) parts.push('stopReason=' + s.stopReason);
    if (s.message) parts.push(s.message);
    if (s.detail) parts.push(s.detail);
  }
  const observation = {
    source: s ? 'structured-acp' : 'dom-banner',
    hits: hits,
    modelId: modelId,
    text: parts.join(' | '),
  };
  if (bizCode) observation.bizCode = bizCode;
  if (httpStatus) observation.httpStatus = httpStatus;
  return observation;
}

/** 建「幂等安装监听 + 回读最近信号」的 CDP 表达式（自包含，可直接 `runCdpExpression`）。 */
function structuredErrorProbeExpression() {
  const scanSrc = scanStructuredError.toString();
  const payload = JSON.stringify({ slot: RENDERER_SLOT, ring: RING_MAX });
  return '(() => {' + '\n'
    + '  var CFG = ' + payload + ';' + '\n'
    + '  var scanStructuredError = ' + scanSrc + ';' + '\n'
    + '  var out = { ok: false, reason: "", installed: false, seq: 0, eventCount: 0, last: null };' + '\n'
    + '  function pickApi() {' + '\n'
    + '    var found = null;' + '\n'
    + '    function walk(fiber, depth) {' + '\n'
    + '      if (found || !fiber || depth > 40) return;' + '\n'
    + '      var cur = fiber, guard = 0;' + '\n'
    + '      while (cur && guard < 300 && !found) {' + '\n'
    + '        guard += 1;' + '\n'
    + '        try {' + '\n'
    + '          var cands = [];' + '\n'
    + '          if (cur.stateNode) cands.push(cur.stateNode);' + '\n'
    + '          if (cur.memoizedProps) {' + '\n'
    + '            cands.push(cur.memoizedProps.adapter);' + '\n'
    + '            cands.push(cur.memoizedProps.value);' + '\n'
    + '            cands.push(cur.memoizedProps.client);' + '\n'
    + '          }' + '\n'
    + '          for (var i = 0; i < cands.length; i++) {' + '\n'
    + '            var o = cands[i];' + '\n'
    + '            if (!o || typeof o !== "object") continue;' + '\n'
    + '            var dc = null;' + '\n'
    + '            try { dc = o.daemonClient; } catch (e) {}' + '\n'
    + '            if (!dc || typeof dc !== "object") continue;' + '\n'
    + '            if (typeof dc.cloudAgentDeleteConversation !== "function") continue;' + '\n'
    + '            try {' + '\n'
    + '              var p = o.client && o.client.provider;' + '\n'
    + '              if (p && p.api && typeof p.api.onSessionEvent === "function") { found = p.api; break; }' + '\n'
    + '            } catch (e) {}' + '\n'
    + '          }' + '\n'
    + '        } catch (e) {}' + '\n'
    + '        cur = cur.return;' + '\n'
    + '      }' + '\n'
    + '    }' + '\n'
    + '    var roots = document.querySelectorAll("#root, body > div, .conversation-shell");' + '\n'
    + '    for (var r = 0; r < roots.length && !found; r++) {' + '\n'
    + '      var el = roots[r];' + '\n'
    + '      var ks = Object.keys(el).filter(function (k) {' + '\n'
    + '        return k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactContainer$") === 0;' + '\n'
    + '      });' + '\n'
    + '      for (var k = 0; k < ks.length && !found; k++) walk(el[ks[k]], 0);' + '\n'
    + '    }' + '\n'
    + '    return found;' + '\n'
    + '  }' + '\n'
    + '  var api = pickApi();' + '\n'
    + '  if (!api) { out.reason = "no-api"; return out; }' + '\n'
    + '  out.ok = true;' + '\n'
    + '  var slot = window[CFG.slot];' + '\n'
    + '  if (!slot || slot.v !== 1 || slot.api !== api) {' + '\n'
    + '    slot = window[CFG.slot] = { v: 1, api: api, installedAt: Date.now(), seq: 0, last: null, events: [] };' + '\n'
    + '  }' + '\n'
    + '  if (!slot.installed) {' + '\n'
    + '    slot.installed = false;' + '\n'
    + '    var sink = function () {' + '\n'
    + '      try {' + '\n'
    + '        var args = Array.prototype.slice.call(arguments);' + '\n'
    + '        var best = null;' + '\n'
    + '        for (var i = 0; i < args.length; i++) {' + '\n'
    + '          var r = scanStructuredError(args[i], { maxDepth: 6, maxNodes: 400 });' + '\n'
    + '          if (r && r.found && (!best || r.score > best.score)) best = r;' + '\n'
    + '        }' + '\n'
    + '        if (best) {' + '\n'
    + '          slot.seq += 1;' + '\n'
    + '          best.ts = Date.now();' + '\n'
    + '          best.seq = slot.seq;' + '\n'
    + '          slot.last = best;' + '\n'
    + '          slot.events.push(best);' + '\n'
    + '          while (slot.events.length > CFG.ring) slot.events.shift();' + '\n'
    + '        }' + '\n'
    + '      } catch (e) { /* 永不影响宿主 */ }' + '\n'
    + '    };' + '\n'
    + '    try { api.onSessionEvent(sink); slot.sink = sink; slot.installed = true; }' + '\n'
    + '    catch (e) { slot.installError = String((e && e.message) || e); }' + '\n'
    + '  }' + '\n'
    + '  out.installed = !!slot.installed;' + '\n'
    + '  out.seq = Number(slot.seq) || 0;' + '\n'
    + '  out.eventCount = slot.events ? slot.events.length : 0;' + '\n'
    + '  out.last = slot.last || null;' + '\n'
    + '  return out;' + '\n'
    + '})()';
}

/** 卸载表达式（测试 / 排障用；daemon 正常运行不需要）。 */
function structuredErrorUninstallExpression() {
  const payload = JSON.stringify({ slot: RENDERER_SLOT });
  return '(() => {' + '\n'
    + '  var CFG = ' + payload + ';' + '\n'
    + '  var slot = window[CFG.slot];' + '\n'
    + '  if (!slot) return { ok: true, removed: false };' + '\n'
    + '  try { if (slot.api && typeof slot.api.off === "function" && slot.sink) slot.api.off("' + SESSION_EVENT_CHANNEL + '", slot.sink); } catch (e) {}' + '\n'
    + '  try { delete window[CFG.slot]; } catch (e) {}' + '\n'
    + '  return { ok: true, removed: true };' + '\n'
    + '})()';
}

module.exports = {
  SESSION_EVENT_CHANNEL,
  RENDERER_SLOT,
  RING_MAX,
  scanStructuredError,
  observationFrom,
  structuredErrorProbeExpression,
  structuredErrorUninstallExpression,
};
