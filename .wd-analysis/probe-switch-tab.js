(async function () {
  var host = document.querySelector('.wbs-root');
  var panel = host.querySelector('.wbs-panel');
  if (!panel.classList.contains('show')) host.querySelector('.wbs-fab').click();
  await new Promise(function (r) { setTimeout(r, 400); });
  var tab = panel.querySelector('.wbs-tab[data-tab="{{TARGET_TAB}}"]');
  if (!tab) return { ok: false, error: 'tab not found: {{TARGET_TAB}}' };
  tab.click();
  await new Promise(function (r) { setTimeout(r, 1200); });
  var body = panel.querySelector('.wbs-body');
  return {
    ok: true,
    activeTab: (panel.querySelector('.wbs-tab.active') || {}).getAttribute('data-tab'),
    bodyFirstChild: body.firstElementChild ? body.firstElementChild.className : null,
    bodyText: (body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500),
  };
})()
