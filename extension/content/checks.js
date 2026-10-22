/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Passive checks while a session records (sdlc-1014c): the faults a tester sees with their eyes and the page never reports.
 *
 *   Dead click   a click on a button, link or [role=button] that is not disabled, and then, for 1.5 s: no change in a visible part of
 *                the page, no request, no navigation, no focus move, no dialog, no page error. "Click did nothing: <label>".
 *   Overflow     text cut off by a clipping box (overflow hidden/clip, an ellipsis) or running out of its box onto a neighbour.
 *   Contrast     visible text under WCAG AA (4.5:1, 3:1 for large text).
 *
 * Why it lives in the recorder's content set and not in the scan tools: the scan tools are pressed by the tester, run through
 * chrome.scripting, and so never run where Chrome refuses to script (an extension page, the Web Store) and never run unless asked.
 * These run in the page the recorder is already in, only while recording, and put each finding in the session as a console error
 * (`check` names which), so they reach the problem count, the done card and the copied report by the same road as any other failure.
 *
 * Cost: a dead click costs one MutationObserver for 1.5 s after a click and nothing between clicks. A layout scan runs at most
 * once per 3 s, after the page loads / the session starts and after each interaction settles, reads at most 2,500 text elements
 * in 8 ms slices, never while the tab is hidden, at most 40 times per session, and reports at most 8 findings per session.
 * Nothing leaves the page: findings go through the bridge like every other event, and the text of an element is cut to 40 characters
 * and skipped for form fields and masked elements.
 */
(() => {
  if (window.__UQA_CHECKS__) return;
  window.__UQA_CHECKS__ = true;
  const B = window.UQABridge;
  if (!B) return;

  const WAIT_MS = 1500;
  const MAX_SCANS = 40;
  const MAX_NODES = 2500;
  const SLICE_MS = 8;
  const DEEP_CAP = 120; // the deep scan's sensitivity: far above the live caps below
  const CAP = { total: 8, dead: 6, overflow: 3, contrast: 3 };

  const on = () => window.UQAAwake !== false && !!B.isRecording?.();
  const topFrame = window.top === window;
  const ours = (n) => { const el = n && n.nodeType === 1 ? n : n?.parentElement; return !!el && (el.tagName === 'QAW-UI' || !!el.closest?.('qaw-ui')); };
  const cut = (s, n = 40) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const nameOf = (el) => {
    let n = '';
    try { n = window.UQASelector?.accessibleName?.(el) || ''; } catch { /* the selector engine is optional */ }
    if (!n) n = el.getAttribute('aria-label') || el.getAttribute('title') || el.value || el.textContent || '';
    n = cut(n);
    return n || `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
  };

  /* ── what has been reported, per session ─────────────────────────────── */
  let found = { total: 0, dead: 0, overflow: 0, contrast: 0 };
  let seen = new Set();
  let scans = 0;
  const dseen = new Set();
  let deep = null; // cap1022: while a Tools deep scan runs, findings are collected here instead of being put in the live session
  function report(kind, key, text, ts) {
    if (deep) { if (deep.length >= DEEP_CAP || dseen.has(`${kind}|${key}`)) return false; dseen.add(`${kind}|${key}`); deep.push({ check: kind, text }); return true; }
    if (!on() || found.total >= CAP.total || found[kind] >= CAP[kind] || seen.has(`${kind}|${key}`)) return false;
    seen.add(`${kind}|${key}`);
    found.total++; found[kind]++;
    B.emit({ kind: 'console', level: 'error', text, check: kind === 'dead' ? 'dead-click' : kind, ...(ts ? { ts } : null) }); // a dead click is stamped with the click, so the report places it after the step it belongs to
    return true;
  }

  /* ── dead click ──────────────────────────────────────────────────────── */
  const CLICK_TARGET = 'button, a, [role=button], input[type=button], input[type=submit], input[type=reset], input[type=image]';
  /* A press whose result is not on the page's own DOM: the label says so (a clipboard, a download, a player). */
  const SILENT_BY_DESIGN = /\b(copy|share|download|print|play|pause|mute|unmute|volume|like|favou?rite|bookmark|save as)\b|نسخ|مشاركة|تحميل|طباعة|تشغيل|إيقاف/i;
  const visibleBox = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };

  function candidate(e) {
    if (!e.isTrusted || e.button !== 0) return null;
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    const el = t?.closest?.(CLICK_TARGET);
    if (!el || ours(el) || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || !visibleBox(el)) return null;
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    if (href && !/^(#|javascript:)/i.test(href.trim())) return null; // a real link navigates
    if (el.tagName === 'A' && el.hasAttribute('download')) return null;
    if (el.matches('input[type=submit], input[type=image], button:not([type]), button[type=submit]') && el.closest('form')) return null; // a form submit navigates or reloads
    return el;
  }

  function watchClick(el) {
    const startUrl = location.href;
    const started = Date.now();
    let active = false;
    const mark = () => { active = true; };
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        const nodes = [m.target, ...m.addedNodes, ...m.removedNodes];
        if (nodes.every(ours)) continue;
        const host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        // A change counts when it is in a visible part of the page; a removal counts when its parent is visible.
        if (host && !ours(host) && (visibleBox(host) || m.removedNodes.length)) { active = true; return; }
      }
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const tap = B.tap?.((ev) => { if (ev && !ev.check && ev.kind !== 'dom' && ev.kind !== 'rep') active = true; }); // a request, a console line or an error the click caused
    /** @type {[string, (ev: any) => void, boolean][]} */
    const own = [
      ['focusin', (ev) => { if (ev.target !== el && !el.contains(ev.target)) active = true; }, true],
      ['submit', mark, true], ['copy', mark, true], ['cut', mark, true], ['play', mark, true], ['pause', mark, true],
      ['scroll', mark, true], ['hashchange', mark, false], ['popstate', mark, false], ['beforeunload', mark, false], ['pagehide', mark, false],
      ['blur', mark, false], ['visibilitychange', mark, false], ['fullscreenchange', mark, true], ['toggle', mark, true],
    ];
    for (const [n, fn, c] of own) addEventListener(n, fn, c);
    const nav = window.navigation;
    nav?.addEventListener?.('navigate', mark);
    const po = (() => { try { const o = new PerformanceObserver(() => { active = true; }); o.observe({ type: 'resource' }); return o; } catch { return null; } })();
    setTimeout(() => {
      mo.disconnect(); po?.disconnect(); tap?.();
      for (const [n, fn, c] of own) removeEventListener(n, fn, c);
      nav?.removeEventListener?.('navigate', mark);
      const late = Date.now() - started > WAIT_MS + 700; // a timer that ran this late was held by a dialog or a hidden tab
      if (active || late || document.hidden || location.href !== startUrl || !el.isConnected || !on()) return;
      report('dead', nameOf(el) + (el.id ? `#${el.id}` : ''), `Click did nothing: “${nameOf(el)}” (${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}): no change on the page, no request, no navigation and no dialog within ${WAIT_MS / 1000} s`, started + 1);
    }, WAIT_MS);
  }

  let inFlight = 0;
  document.addEventListener('click', (e) => {
    if (!on() || window.UQAPicker?.isActive?.() || found.dead >= CAP.dead || inFlight >= 3) return;
    let el = null;
    try { el = candidate(e); } catch { /* a page that breaks closest() */ }
    if (!el || SILENT_BY_DESIGN.test(nameOf(el))) return;
    inFlight++;
    setTimeout(() => { inFlight--; }, WAIT_MS + 50);
    try { watchClick(el); } catch { inFlight = Math.max(0, inFlight - 1); }
  }, true);

  /* ── overflow and contrast ───────────────────────────────────────────── */
  let canvasCtx = null;
  const colourCache = new Map();
  /* Any CSS colour (rgb, hex, color(), oklch) to [r,g,b,a] by letting the canvas parse it. */
  function rgba(css) {
    if (colourCache.has(css)) return colourCache.get(css);
    let out = null;
    try {
      canvasCtx = canvasCtx || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      canvasCtx.canvas.width = canvasCtx.canvas.height = 1;
      canvasCtx.clearRect(0, 0, 1, 1);
      canvasCtx.fillStyle = '#000';
      canvasCtx.fillStyle = css;
      canvasCtx.fillRect(0, 0, 1, 1);
      const d = canvasCtx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    } catch { /* no canvas: contrast is skipped */ }
    colourCache.set(css, out);
    return out;
  }
  const over = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
  const lum = ([r, g, b]) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  /** The colour behind an element: the first opaque background up the tree, blended; null when an image or gradient sits behind it. */
  function backdrop(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1 && o > 0; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

  function overflowOf(el, cs, r) {
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return null;
    const x = el.scrollWidth > el.clientWidth + 1;
    const y = el.scrollHeight > el.clientHeight + 1;
    if (!x && !y) return null;
    const clipX = /hidden|clip/.test(cs.overflowX);
    const clipY = /hidden|clip/.test(cs.overflowY);
    if ((x && clipX) || (y && clipY)) return { how: 'cut', detail: x && clipX ? `${el.scrollWidth} px of text in ${el.clientWidth} px` : `${el.scrollHeight} px of text in ${el.clientHeight} px` };
    if (x && cs.overflowX === 'visible') {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rr = range.getBoundingClientRect();
      if (rr.right <= r.right + 1 && rr.left >= r.left - 1) return null;
      for (const sib of el.parentElement?.children || []) {
        if (sib === el || ours(sib) || !sib.textContent.trim()) continue;
        const s = sib.getBoundingClientRect();
        if (s.width > 0 && s.height > 0 && rr.left < s.right && rr.right > s.left && rr.top < s.bottom && rr.bottom > s.top) return { how: 'over', detail: `${Math.round(rr.width)} px of text in ${Math.round(r.width)} px, over “${cut(sib.textContent, 20)}”` };
      }
    }
    return null;
  }

  function contrastOf(el, cs) {
    if (el.matches(':disabled, [aria-disabled=true], [disabled]') || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') return null;
    const fg = rgba(cs.color);
    const bg = backdrop(el);
    if (!fg || !bg || fg[3] === 0) return null;
    const a = fg[3] * opacityOf(el);
    const text = over([fg[0], fg[1], fg[2], a], bg);
    const px = parseFloat(cs.fontSize) || 16;
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(text, bg);
    return r < (large ? 3 : 4.5) - 0.01 ? { r, large, fg: hex(text), bg: hex(bg), px } : null;
  }

  let scanning = false;
  const tick = () => new Promise((res) => setTimeout(res, 0));
  async function scan() {
    if (scanning || (!deep && (!on() || document.hidden || scans >= MAX_SCANS || found.total >= CAP.total)) || !topFrame || !document.body) return;
    scanning = true;
    scans++;
    try {
      const parents = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let slice = performance.now();
      let n = 0;
      for (let t = walker.nextNode(); t && n < MAX_NODES; t = walker.nextNode()) {
        const p = t.parentElement;
        if (!p || parents.has(p) || !/[\p{L}\p{N}]/u.test(t.nodeValue) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|OPTION)$/.test(p.tagName) || ours(p)) continue;
        parents.add(p); n++;
      }
      let i = 0;
      for (const el of parents) {
        if (deep ? deep.length >= DEEP_CAP : !on() || found.total >= CAP.total) break;
        if (performance.now() - slice > SLICE_MS) { await tick(); slice = performance.now(); if (!el.isConnected) continue; }
        i++;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const field = /^(INPUT|SELECT)$/.test(el.tagName) || el.isContentEditable || window.UQAMask?.isMasked?.(el);
        const label = field ? '' : cut(el.textContent);
        const ov = overflowOf(el, cs, r);
        if (ov && label) report('overflow', `${el.tagName}|${label}`, `Text ${ov.how === 'cut' ? 'is cut off' : 'overflows its box'}: “${label}” (${ov.detail}) in ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`);
        if (label && (deep || found.contrast < CAP.contrast)) {
          const c = contrastOf(el, cs);
          if (c) report('contrast', `${c.fg}|${c.bg}|${c.large}`, `Low contrast ${c.r.toFixed(1)}:1 (needs ${c.large ? 3 : 4.5}:1): ${c.fg} text on ${c.bg}, ${Math.round(c.px)} px: “${label}”`);
        }
      }
    } catch { /* a layout check must never break the page under test */ } finally { scanning = false; }
  }

  /* cap1022: no layout scan runs by itself while a session records (400+ rows in five minutes). The Tools page asks for one, at full sensitivity. */
  addEventListener('uqa:recording', () => { found = { total: 0, dead: 0, overflow: 0, contrast: 0 }; seen = new Set(); scans = 0; });
  async function deepScan() {
    deep = [];
    dseen.clear();
    try { await scan(); return deep; } catch { return deep || []; } finally { deep = null; }
  }
  globalThis.chrome?.runtime?.onMessage?.addListener((msg, _s, reply) => {
    if (msg?.type !== 'UQA_DEEP_SCAN' || !topFrame) return false;
    deepScan().then((findings) => reply({ findings }));
    return true;
  });

  window.UQAChecks = { deep: deepScan, found: () => ({ ...found }), WAIT_MS };
})();
