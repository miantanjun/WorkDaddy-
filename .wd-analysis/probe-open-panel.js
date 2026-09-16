(function () {
  var host = document.querySelector('.wbs-root');
  var out = { ok: true };
  var fab = host.querySelector('.wbs-fab');
  var panel = host.querySelector('.wbs-panel');
  var wasShown = panel.classList.contains('show');
  if (!wasShown && fab) { fab.click(); }
  out.clickedFab = !wasShown;
  out.panelShownAfter = panel.classList.contains('show');
  // 面板 tab 条
  var tabbar = panel.querySelector('.wbs-tabs') || panel.querySelector('[role="tablist"]');
  out.tabbarClass = tabbar ? tabbar.className : null;
  var tabBtns = tabbar ? tabbar.querySelectorAll('button,nav>div,[data-tab]') : [];
  out.tabs = Array.prototype.map.call(tabBtns, function (t) {
    return { cls: t.className, dataTab: t.getAttribute('data-tab'), text: (t.textContent || '').trim().slice(0, 10) };
  }).slice(0, 20);
  // 面板 HTML 结构概览（只取 tag+class）
  out.panelChildren = Array.prototype.map.call(panel.children, function (c) {
    return c.tagName + '.' + String(c.className).split(' ').join('.');
  });
  return out;
})()
