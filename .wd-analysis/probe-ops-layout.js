(function () {
  var out = {};
  var root = document.querySelector('.wbs-root') || document.getElementById('wbs-root') || document.body;
  var panel = root.querySelector('.wbs-panel');
  var pane = root.querySelector('[data-pane="account"]');
  var list = root.querySelector('.wbs-acct-list');
  var opsBtn = root.querySelector('[data-act="ops"]');
  var pop = root.querySelector('#wbs-ops-popover');
  var handle = root.querySelector('#wbs-panel-resize');

  // 面板没开就先打开（只为了拿到真实几何；跑完恢复）
  var iOpened = false;
  if (panel && !panel.classList.contains('show')) { panel.classList.add('show'); iOpened = true; }

  out.hasPanel = !!panel;
  out.hasAccountPane = !!pane;
  out.hasOpsBtn = !!opsBtn;
  out.hasResizeHandle = !!handle;
  out.popoverIsPanelChild = !!(pop && panel && pop.parentElement === panel); // 期望 true（避开 .wbs-body 的 overflow:hidden）
  out.popoverHiddenInitially = pop ? pop.hidden : null;                      // 期望 true
  out.cardsInAccountPane = pane ? pane.querySelectorAll('.wbs-pcard').length : -1;  // 期望 0
  out.cardsInPopover = pop ? pop.querySelectorAll('.wbs-pcard').length : -1;        // 期望 3
  out.idleCardInPopover = !!(pop && pop.querySelector('#wbs-idle-card'));
  out.failoverCardInPopover = !!(pop && pop.querySelector('#wbs-failover-card'));
  out.caCardInPopover = !!(pop && pop.querySelector('#wbs-ca-card'));
  out.cardsAfterList = (function () {  // 账号列表之后不该再有常驻卡片
    if (!list || !pane) return -1;
    var n = 0, el = list.nextElementSibling;
    while (el) { if (el.classList.contains('wbs-pcard')) n++; el = el.nextElementSibling; }
    return n;                          // 期望 0
  }());

  if (list && pane) {
    var lr = list.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    out.listHeight = Math.round(lr.height);
    out.paneHeight = Math.round(pr.height);
    out.listShareOfPane = pr.height ? Math.round(lr.height / pr.height * 100) + '%' : null;
  }

  if (opsBtn && pop && panel) {
    opsBtn.click();                                   // 开
    out.afterClickHidden = pop.hidden;                // 期望 false
    var pb = pop.getBoundingClientRect();
    var bb = opsBtn.getBoundingClientRect();
    var pan = panel.getBoundingClientRect();
    out.popRect = [Math.round(pb.left), Math.round(pb.top), Math.round(pb.width), Math.round(pb.height)];
    out.popHasSize = pb.width > 0 && pb.height > 0;
    out.popAnchoredUnderButton = pb.top >= bb.bottom - 2;
    out.popInsidePanel = pb.left >= pan.left - 1 && pb.right <= pan.right + 1 && pb.bottom <= pan.bottom + 1;
    out.popTitleText = (pop.querySelector('.wbs-ops-title') || {}).textContent || '';
    out.popTitleSkipped = false; // 标题走词典，应当**不带** skip
    var skipRoots = pop.querySelectorAll('[data-wbs-i18n-skip]');
    out.popSkipSubtrees = skipRoots.length;
    // 英文模式渲染抽样（不动全局语言，只对弹出层跑一次翻译）
    out.dotHiddenAfterOpen = (root.querySelector('#wbs-ops-dot') || {}).hidden;
    opsBtn.click();                                   // 关回去
    out.afterSecondClickHidden = pop.hidden;          // 期望 true
  }

  if (panel) {
    var st = panel.getAttribute('style') || '';
    out.panelInlineStyle = st;
    out.panelSize = [panel.offsetWidth, panel.offsetHeight];
    out.hasResizingClass = panel.classList.contains('wbs-panel-resizing');
  }

  if (iOpened && panel) panel.classList.remove('show');
  out.restored = panel ? !panel.classList.contains('show') : null;
  return out;
})()
