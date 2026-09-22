(function () {
  var out = {};
  var root = document.querySelector('.wbs-root') || document.body;
  var panel = root.querySelector('.wbs-panel');
  var handle = root.querySelector('#wbs-panel-resize');
  var KEY = 'workdaddy.ui.panelSize';
  if (!panel || !handle) return { ok: false, reason: 'panel or handle missing' };

  var KEY_EXISTED = (function () { try { return localStorage.getItem(KEY); } catch (_) { return null; } }());
  var panelStyleBefore = panel.getAttribute('style') || '';
  var body = panel.querySelector('.wbs-body');
  var bodyStyleBefore = body ? body.getAttribute('style') || '' : '';
  var wasShown = panel.classList.contains('show');
  if (!wasShown) panel.classList.add('show');

  out.sizeBefore = [panel.offsetWidth, panel.offsetHeight];

  function pointer(type, x, y) {
    handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: x, clientY: y
    }));
  }
  var hb = handle.getBoundingClientRect();
  var sx = hb.left + 6, sy = hb.top + 6;
  pointer('pointerdown', sx, sy);
  out.resizingClassDuring = panel.classList.contains('wbs-panel-resizing');
  pointer('pointermove', sx - 120, sy - 90);          // 往左上拖 = 变大（面板锚在右下角）
  out.sizeDuring = [panel.offsetWidth, panel.offsetHeight];
  out.inlineDuring = (panel.getAttribute('style') || '').indexOf('width') >= 0;
  pointer('pointerup', sx - 120, sy - 90);
  out.resizingClassAfter = panel.classList.contains('wbs-panel-resizing');
  out.sizeAfter = [panel.offsetWidth, panel.offsetHeight];
  out.grew = out.sizeAfter[0] > out.sizeBefore[0] && out.sizeAfter[1] > out.sizeBefore[1];
  out.persisted = (function () { try { return localStorage.getItem(KEY); } catch (_) { return null; } }());
  out.bodyMaxHeightCleared = body ? body.style.maxHeight : null;

  // 下界钳制：往右下猛拖应当停在 MIN 尺寸
  var hb2 = handle.getBoundingClientRect();
  pointer('pointerdown', hb2.left + 6, hb2.top + 6);
  pointer('pointermove', hb2.left + 4000, hb2.top + 4000);
  pointer('pointerup', hb2.left + 4000, hb2.top + 4000);
  out.clampedMin = [panel.offsetWidth, panel.offsetHeight];

  // ── 复原（零副作用）
  if (KEY_EXISTED === null) { try { localStorage.removeItem(KEY); } catch (_) {} }
  else { try { localStorage.setItem(KEY, KEY_EXISTED); } catch (_) {} }
  if (panelStyleBefore) panel.setAttribute('style', panelStyleBefore); else panel.removeAttribute('style');
  if (body) { if (bodyStyleBefore) body.setAttribute('style', bodyStyleBefore); else body.removeAttribute('style'); }
  panel.classList.remove('wbs-panel-resizing');
  if (!wasShown) panel.classList.remove('show');
  out.restoredSize = [panel.offsetWidth, panel.offsetHeight];
  out.restoredKey = (function () { try { return localStorage.getItem(KEY); } catch (_) { return null; } }());
  out.restoredKeyMatches = out.restoredKey === KEY_EXISTED;
  return out;
})()
