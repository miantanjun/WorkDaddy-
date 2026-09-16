(async function () {
  var host = document.querySelector('.wbs-root');
  var body = host.querySelector('#wbs-space-body');
  if (!body) return { ok: false, error: 'no #wbs-space-body' };
  // 先滚到「任务对话」分组（按文本定位），再截图
  var secs = body.querySelectorAll('.wbs-space-sec');
  var target = null;
  secs.forEach(function (s) {
    var head = s.querySelector('.wbs-space-sec-head');
    if (head && head.textContent.indexOf('任务对话') >= 0) target = s;
  });
  if (!target) return { ok: false, error: 'conversation section not found', sections: secs.length };
  target.scrollIntoView({ block: 'start' });
  await new Promise(function (r) { setTimeout(r, 500); });
  var rows = target.querySelectorAll('.wbs-space-row');
  return {
    ok: true,
    scrollTop: body.scrollTop,
    sectionRows: rows.length,
    rows: Array.prototype.map.call(rows, function (row) {
      var name = row.querySelector('.wbs-space-name>b');
      var sub = row.querySelector('.wbs-space-name>i');
      var size = row.querySelector('.wbs-space-size>b');
      var files = row.querySelector('.wbs-space-files');
      return {
        title: name ? name.textContent : '',
        tip: name ? name.getAttribute('title') : '',
        sub: sub ? sub.textContent : '',
        size: size ? size.textContent : '',
        files: files ? files.textContent.trim() : '',
      };
    }),
  };
})()
