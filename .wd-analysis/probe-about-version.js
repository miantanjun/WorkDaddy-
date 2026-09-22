(async function () {
  // 只读核验：面板「关于」页真渲染出的两个版本号（#wbs-self-ver / #wbs-upstream-ver）。
  // 关于页是懒构建（点 tab 才 buildAboutPane），所以本探针会短暂切页，读完**复原原 tab 与面板开合**。
  var out = { ok: true };
  var root = document.querySelector('.wbs-root') || document.getElementById('wbs-root');
  out.rootFound = !!root;
  if (!root) return JSON.stringify(out);

  var panel = root.querySelector('.wbs-panel') || document.querySelector('.wbs-panel');
  var fab = root.querySelector('.wbs-fab') || document.querySelector('.wbs-fab');
  out.panelShownBefore = panel ? panel.classList.contains('show') : null;

  var actives = root.querySelectorAll('.wbs-pane.active');
  out.activePaneBefore = actives.length ? (actives[0].getAttribute('data-pane') || '') : '';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var didOpen = false;
  if (panel && !panel.classList.contains('show') && fab) {
    fab.click();
    didOpen = true;
    await sleep(400);
  }

  var aboutTab = root.querySelector('.wbs-tab[data-tab="about"]');
  out.aboutTabFound = !!aboutTab;
  if (aboutTab) {
    aboutTab.click();
    for (var i = 0; i < 30; i++) {
      await sleep(150);
      var probe = root.querySelector('#wbs-upstream-ver');
      if (probe && probe.textContent && probe.textContent !== '—') break;
    }
  }

  var up = root.querySelector('#wbs-upstream-ver');
  var self = root.querySelector('#wbs-self-ver');
  out.upstreamText = up ? up.textContent : null;
  out.selfText = self ? self.textContent : null;

  var about = root.querySelector('[data-pane="about"]');
  out.aboutPaneBuilt = about ? !!about.dataset.built : null;
  if (about) {
    var txt = about.textContent || '';
    var m = /本修改版基线为 v([0-9][0-9.]*)/.exec(txt);
    out.footerBaseline = m ? m[1] : null;
    out.aboutTextHas123 = /v1\.2\.3(?!\d)/.test(txt);
    out.aboutTextHas125 = /v1\.2\.5(?!\d)/.test(txt);
  }

  // ---- 复原 ----
  // ⚠️ `.wbs-fab` 只负责「开」（inject.js 里是 setOpen(true)），拿它当 toggle 会关不掉。
  //    关闭走 [data-act="close"]，或程序化开合事件桥 workdaddy:panel-open。
  if (out.activePaneBefore) {
    var back = root.querySelector('.wbs-tab[data-tab="' + out.activePaneBefore + '"]');
    if (back) back.click();
  }
  await sleep(150);
  if (didOpen) {
    try {
      window.dispatchEvent(new CustomEvent('workdaddy:panel-open', { detail: { open: false } }));
    } catch (e) { out.restoreEventError = String((e && e.message) || e); }
    for (var k = 0; k < 6; k++) {
      if (!panel.classList.contains('show')) break;
      await sleep(200);
    }
  }
  out.restored = true;
  out.panelShownAfter = panel ? panel.classList.contains('show') : null;
  return JSON.stringify(out);
})();
