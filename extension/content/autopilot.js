/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Autopilot, page half (DESIGN-1011 AUTO-1, AUTO-4 trigger, AUTO-5 receipt).
 */
(() => {
  if (window.__UQA_AUTOPILOT__) return;
  window.__UQA_AUTOPILOT__ = true;
  const B = window.UQABridge;
  if (!B?.tap) return;
  const top = window.top === window;
  const UI = () => window.UQAUiHost;
  const t = (key, fallback) => UI()?.t?.(key, fallback) ?? fallback;

  /* Mirror of core/dupes.js dupeKey and core/events.js isFailure (core is an ES module). Parity: tools/test-autoshot.mjs. */
  const ID = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|(?=.*\d)[\w-]{16,})$/i;
  function urlPattern(url, frameUrl) {
    try {
      const base = (() => { try { return new URL(String(frameUrl)).href; } catch { return undefined; } })();
      const u = new URL(String(url), base);
      const q = [...new Set(u.searchParams.keys())].sort().join('&');
      return `${u.host}${u.pathname.split('/').map((x) => (ID.test(x) ? ':id' : x)).join('/')}${q ? `?${q}` : ''}`;
    } catch {
      return String(url || '').split(/[?#]/)[0];
    }
  }
  function messageShape(text) {
    return String(text || '').toLowerCase()
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{8,}/g, '<h>').replace(/\d+/g, '#')
      .replace(/"[^"]{41,}"/g, '"..."').replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  function whereFrom(ev) {
    const m = /(?:\(|\bat\s+|@)\s*((?:https?|chrome-extension|file):[^\s)]+?):(\d+)(?::\d+)?\)?/.exec(String(ev.stack || ''));
    if (m) return `${urlPattern(m[1])}:${m[2]}`;
    return ev.src ? String(ev.src).replace(/:\d+$/, '') : '';
  }
  function kindKey(ev) {
    const kind = ev.kind === 'rep' ? ev.ofKind : ev.kind;
    if (kind === 'net') {
      const what = ev.status >= 400 ? ev.status : ev.ev === 'gql' ? `gql:${ev.operation || ''}` : ev.en || ev.ev || 'err';
      return `net|${String(ev.method || 'GET').toUpperCase()}|${urlPattern(ev.url, ev.frameUrl)}|${what}`;
    }
    return `${kind}|${messageShape(ev.text)}|${whereFrom(ev)}`;
  }
  function isFailure(ev) {
    if (!ev) return false;
    if (ev.kind === 'net') return ev.error === true || (ev.status >= 400 && ev.status < 600) || ev.ev === 'gql';
    if (ev.kind === 'console') return ev.level === 'error' || ev.level === 'assert';
    return ev.kind === 'pageerror';
  }

  /** `METHOD /path STATUS`, query and fragment stripped; a console line is cut short with its URLs' queries stripped. */
  function describe(ev) {
    if (ev.kind !== 'net') return String(ev.text || ev.kind).replace(/\?\S*/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    let path = String(ev.url || '').split(/[?#]/)[0];
    try { path = new URL(String(ev.url), ev.frameUrl || location.href).pathname; } catch { /* keep the cut string */ }
    return `${String(ev.method || 'GET').toUpperCase()} ${path.slice(0, 60)} ${ev.status >= 400 ? ev.status : 'failed'}`;
  }

  const LAYER = 'position:fixed;z-index:2147483646;inset-inline-end:10px;padding:3px 8px;border-radius:var(--uqa-r-md);' +
    'background:var(--uqa-surface-inverse);color:var(--uqa-text-inverse);font:12px/1.4 "QAW Thmanyah Sans",system-ui,sans-serif;pointer-events:none;';
  let dot = null;
  let label = null;
  let toast = null;
  let toastTimer = 0;
  let ticker = 0;
  let seen = new Set();
  let toasts = 0;
  let sessionAt = 0;
  let asked = false;
  let ready = window.UQASettings !== undefined;

  /** On by default; only the Settings switch turns it off. Fails visible: an unreadable setting leaves the dot on. */
  const indicatorOn = () => window.UQASettings?.pageIndicator !== false;

  function sync() {
    const st = B.state();
    if (st.startedAt !== sessionAt) { sessionAt = st.startedAt; seen = new Set(); toasts = 0; }
    const show = top && st.recording && !st.dead && st.awake !== false;
    if (show && !ready) { // the Settings answer first, so a tester who switched the dot off never sees it flash
      if (!asked) { asked = true; B.refreshSettings().finally(() => { ready = true; sync(); }); }
      return;
    }
    if (!show || !indicatorOn() || !UI()) {
      dot?.remove(); dot = null;
      if (!show) { toast?.remove(); toast = null; }
      clearInterval(ticker); ticker = 0;
      return;
    }
    if (!dot?.isConnected) {
      dot = UI().uiLayer('uqa-ap-dot');
      dot.removeAttribute('aria-hidden'); // a status line with text, not a decoration
      dot.setAttribute('role', 'status');
      dot.setAttribute('aria-live', 'off'); // read when found, not announced every minute
      dot.style.cssText = `${LAYER}top:10px;display:flex;align-items:center;gap:6px;`;
      const mark = document.createElement('span');
      mark.style.cssText = 'inline-size:10px;block-size:10px;border-radius:50%;background:var(--uqa-live,currentColor);';
      label = document.createElement('span');
      dot.append(mark, label);
    }
    const n = Math.max(0, Math.floor((Date.now() - st.startedAt) / 60000));
    const text = st.autoStarted ? t('overlay.autopilot.dotAuto', 'Auto-recording · {n} min') : t('overlay.autopilot.dot', 'Recording · {n} min');
    label.textContent = text.replace('{n}', String(n));
    if (!ticker) ticker = setInterval(sync, 10000); // a data-live text; 10 s also repaints after anything took the layer down
  }

  function showToast(what, key) {
    clearTimeout(toastTimer);
    toast?.remove();
    toast = UI().uiLayer('uqa-ap-toast');
    toast.removeAttribute('aria-hidden');
    toast.setAttribute('role', 'status');
    toast.style.cssText = `${LAYER}top:44px;max-inline-size:min(40ch,calc(100vw - 32px));display:flex;flex-direction:column;gap:4px;`;
    const line = document.createElement('div');
    line.dir = 'auto';
    line.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    line.textContent = t('overlay.autopilot.caught', 'Caught: {what}').replace('{what}', what);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('overlay.autopilot.notBug', 'Not a bug');
    btn.style.cssText = 'align-self:flex-start;pointer-events:auto;cursor:pointer;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:var(--uqa-r-md);padding:2px 8px;';
    btn.addEventListener('click', (e) => {
      if (!e.isTrusted) return; // a page script cannot press it
      B.emit({ kind: 'expected', forKey: key });
      toast?.remove(); toast = null;
      UI()?.flash?.(t('overlay.autopilot.marked', 'Marked as expected'));
    });
    toast.append(line, btn);
    toastTimer = setTimeout(() => { toast?.remove(); toast = null; }, 15000);
  }

  B.tap((ev) => {
    if (!isFailure(ev)) return;
    const key = kindKey(ev).slice(0, 200);
    if (seen.has(key) || seen.size >= 50) return;
    seen.add(key);
    const what = describe(ev);
    if (top && indicatorOn() && toasts < 10 && UI()) { toasts++; showToast(what, key); }
    // The page only asks (C2); the worker re-checks site, consent, focus, rate and cap. A subframe cannot know the tab's focus.
    if (document.visibilityState === 'visible' && (!top || document.hasFocus())) B.send({ type: 'UQA_SHOT_AUTO', key, what });
  });

  B.watch(sync);
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender?.id !== chrome.runtime.id || sender?.tab) return;
    if (msg?.type === 'UQA_SETTINGS_CHANGED') sync();
  });

  window.UQAAutopilot = { kindKey, probe: () => ({ dot: dot?.isConnected ? 1 : 0, toast: toast?.isConnected ? 1 : 0 }) };
  if (typeof (/** @type {any} */ (globalThis)).module === 'object') window.__qawKindKey = kindKey; // the key-parity test reads it through a vm sandbox
})();
