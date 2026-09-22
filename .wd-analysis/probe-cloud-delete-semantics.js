(async function () {
  // 目的：判定「云端删除接口对本就不存在的会话 id」到底回什么。
  // 背景：test-cloud-ghosts.js D9-D11 断言 `deleted === 0`，实测 `deleted === 1`。
  //       若云端现在对不存在 id 也「成功返回」，则 daemon 的 `result.ok === true` 计数就会 +1。
  // 零副作用：id 是伪造的、本来就不存在；detail 作为对照同时问一次。
  var MISSING_ID = '__wd_missing_uuid_probe__';
  var out = { ok: true, missingId: MISSING_ID };

  function pickClient() {
    var found = null;
    function walk(fiber, depth) {
      if (found || !fiber || depth > 40) return;
      var cur = fiber, guard = 0;
      while (cur && guard < 300 && !found) {
        guard += 1;
        try {
          var cands = [];
          if (cur.stateNode) cands.push(cur.stateNode);
          if (cur.memoizedProps) {
            cands.push(cur.memoizedProps.adapter);
            cands.push(cur.memoizedProps.value);
            cands.push(cur.memoizedProps.client);
          }
          for (var i = 0; i < cands.length; i++) {
            var o = cands[i];
            if (!o || typeof o !== 'object') continue;
            var dc = null;
            try { dc = o.daemonClient; } catch (e) {}
            if (dc && typeof dc === 'object' && typeof dc.cloudAgentDeleteConversation === 'function') { found = dc; break; }
          }
        } catch (e) {}
        cur = cur.return;
      }
    }
    var roots = document.querySelectorAll('#root, body > div, .conversation-shell');
    for (var r = 0; r < roots.length && !found; r++) {
      var el = roots[r];
      var keys = Object.keys(el).filter(function (k) { return k.indexOf('__reactFiber') === 0 || k.indexOf('__reactContainer') === 0; });
      for (var k = 0; k < keys.length && !found; k++) {
        walk(el[keys[k]], 0);
      }
    }
    return found;
  }

  var dc = pickClient();
  out.clientFound = !!dc;
  if (!dc) { out.note = '渲染层取不到 daemonClient，无法判定'; return JSON.stringify(out); }
  out.methods = Object.keys(dc).filter(function (m) { return m.indexOf('cloudAgent') === 0; });

  async function probe(label, fn) {
    var rec = { label: label };
    try {
      var v = await fn();
      rec.threw = false;
      rec.valueType = v === undefined ? 'undefined' : (v === null ? 'null' : typeof v);
      try { rec.value = JSON.stringify(v === undefined ? null : v).slice(0, 600); } catch (e) { rec.value = '<unserializable>'; }
    } catch (e) {
      rec.threw = true;
      rec.errCode = String((e && e.code) || '');
      rec.errMessage = String((e && e.message) || e).slice(0, 300);
    }
    return rec;
  }

  // 1) 删除一个不存在的 id —— 这是 D10 走的路径
  out.delMissing = await probe('delete(missing)', function () {
    return dc.cloudAgentDeleteConversation({ conversationId: MISSING_ID });
  });

  // 2) 同一个 id 问详情 —— 对照：这个接口按文档应对不存在 id 抛 not found
  out.detailMissing = await probe('detail(missing)', function () {
    return dc.cloudAgentGetConversationDetail({ conversationId: MISSING_ID });
  });

  return JSON.stringify(out);
})();
