(function () {
  var out = {};
  out.url = location.href.slice(0, 90);
  out.readyState = document.readyState;
  out.hasWbsRoot = !!document.getElementById('wbs-root');
  out.rootCount = document.querySelectorAll('#wbs-root, .wbs-root').length;
  out.fabCount = document.querySelectorAll('.wbs-fab').length;
  out.panelCount = document.querySelectorAll('.wbs-panel').length;
  out.customEvents = Object.keys(window).filter(function (k) { return /^__wbs|^__wd/i.test(k); }).slice(0, 40);
  var el = document.getElementById('wbs-root');
  out.rootHTMLHead = el ? el.outerHTML.slice(0, 300) : null;
  return out;
})()
