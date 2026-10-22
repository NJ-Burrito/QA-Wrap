/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The shared working / success / failure helper (f1022): one tiny module for the side panel's tool buttons and the in-page island.
 *
 *   UQALive.start(holder)          the holder's icon turns (reduced motion: a static three-dot glyph)
 *   UQALive.end(holder, true)      a check draws in, one pulse        -- success
 *   UQALive.end(holder, false)     a cross, one short shake           -- failure
 *   UQALive.end(holder)            stopped or cancelled: the icon is simply put back
 *
 * `holder` is the element that contains the icon svg (or the svg itself). It gets [data-live] (the layout rule's allowed
 * exception: it moves by itself) and [data-live-state]; the motion lives in ui/live.css. The ending is held for HOLD ms,
 * then the original icon is restored. The two endings differ by shape, so no colour is needed to tell them apart.
 */
(function () {
  if (window.UQALive) return;
  var NS = 'http://www.w3.org/2000/svg';
  var SHAPE = { success: 'M4.5 12.5l5 5L19.5 7', failure: 'M6 6l12 12M18 6L6 18', working: 'M6 12h.01M12 12h.01M18 12h.01' };
  var HOLD = 1600;
  var held = new WeakMap(); // holder -> { icon, shown, glyph, timer }
  var reduced = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var iconOf = function (h) { return h.localName === 'svg' ? h : h.querySelector('svg:not(.live-glyph)'); };

  function glyph(state, like) {
    var size = (like && like.getBoundingClientRect().width) || 16;
    var s = document.createElementNS(NS, 'svg');
    var p = document.createElementNS(NS, 'path');
    s.setAttribute('class', 'live-glyph');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('data-live', '');
    s.setAttribute('data-live-state', state);
    p.setAttribute('d', SHAPE[state]);
    p.setAttribute('pathLength', '1');
    s.appendChild(p);
    return s;
  }

  function clear(h) {
    var r = held.get(h);
    if (!r) return;
    clearTimeout(r.timer);
    if (r.glyph) r.glyph.remove();
    r.icon.style.display = r.shown;
    h.removeAttribute('data-live');
    h.removeAttribute('data-live-state');
    held.delete(h);
  }

  function show(h, state) {
    var r = held.get(h);
    if (!r) {
      var icon = iconOf(h);
      if (!icon) return;
      r = { icon: icon, shown: icon.style.display, glyph: null, timer: 0 };
      held.set(h, r);
    }
    clearTimeout(r.timer);
    if (r.glyph) { r.glyph.remove(); r.glyph = null; }
    h.setAttribute('data-live', '');
    h.setAttribute('data-live-state', state);
    if (state === 'working' && !reduced()) { r.icon.style.display = r.shown; return; } // the icon itself turns
    r.glyph = glyph(state, r.icon);
    r.icon.after(r.glyph);
    r.icon.style.display = 'none';
  }

  window.UQALive = {
    HOLD: HOLD,
    start: function (h) { if (h) show(h, 'working'); },
    end: function (h, ok) {
      if (!h) return;
      if (ok !== true && ok !== false) return clear(h);
      show(h, ok ? 'success' : 'failure');
      var r = held.get(h);
      if (r) r.timer = setTimeout(function () { clear(h); }, HOLD);
    },
    clear: clear,
    state: function (h) { return (h && h.getAttribute('data-live-state')) || ''; },
  };
})();
