(function () {
  var out = { ok: true };
  // 1. 面板是否存在 / 是否展开
  var root = document.getElementById('wbs-root') || document.querySelector('.wbs-root');
  var host = root || document.body;
  var panel = host.querySelector('.wbs-panel');
  var fab = host.querySelector('.wbs-fab');
  out.rootId = root ? (root.id || root.className) : null;
  out.hasPanel = !!panel;
  out.panelShown = panel ? panel.classList.contains('show') : false;
  out.hasFab = !!fab;
  // 2. 账号卡片数量与当前账号高亮
  var list = host.querySelector('.wbs-acct-list');
  out.hasAcctList = !!list;
  if (list) {
    var cards = list.querySelectorAll('.wbs-card');
    out.cardCount = cards.length;
    out.cards = Array.prototype.map.call(cards, function (c) {
      var r = c.getBoundingClientRect();
      return {
        uid: (c.getAttribute('data-uid') || '').slice(0, 8),
        cls: c.className,
        isCur: c.classList.contains('cur'),
        name: (c.querySelector('.wbs-name') || {}).textContent || '',
        bg: getComputedStyle(c).backgroundColor,
        shadow: getComputedStyle(c).boxShadow,
      };
    });
    var cur = list.querySelectorAll('.wbs-card.cur');
    out.curCount = cur.length;
  }
  // 3. 关键 CSS 变量是否真的存在（决定用 accent 还是 fallback）
  var cs = getComputedStyle(document.documentElement);
  out.vars = {};
  ['--wb-accent-blue', '--wb-bg-hover', '--wb-color-text-primary', '--wb-bg-popover', '--wb-border-subtle']
    .forEach(function (k) { out.vars[k] = cs.getPropertyValue(k).trim() || null; });
  out.dark = {
    cbDark: document.documentElement.classList.contains('cb-dark'),
    dataTheme: document.documentElement.getAttribute('data-theme'),
    vscodeTheme: document.body.getAttribute('data-vscode-theme-name'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  };
  return out;
})()
