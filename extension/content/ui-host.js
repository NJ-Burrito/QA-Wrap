/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The single place this tool is allowed to draw on somebody else's page.
 *
 * ── a QA tool must not appear in its own evidence ─────────────────────────
 *
 * Everything the extension drew used to go straight into the document under
 * test. An independent field test measured it: with the nasty-values palette
 * open, `document.querySelectorAll('[class*="uqa"]').length` was **52** — fifty
 * two of the tool's own nodes sitting inside the page it was there to examine.
 *
 * That is not cosmetic. It has four concrete consequences, and every one of
 * them corrupts an artefact somebody is going to rely on:
 *
 *   an **axe-core scan** audits the tool's markup alongside the page's, so the
 *   violation count is partly about us;
 *   a **screenshot** photographs the tool, so the evidence shows the
 *   instrument;
 *   the **locator picker** can offer a locator for the tool's own button;
 *   and the CSS leaks **both ways** — a `.palette` class on either side
 *   collides with a `.palette` class on the other.
 *
 * ── one closed shadow root ────────────────────────────────────────────────
 *
 * A shadow root ends all four at once. Style cannot cross it in either
 * direction, `querySelectorAll` on the document cannot see into it, and axe
 * does not audit it.
 *
 * `mode: 'closed'` rather than open, deliberately: an open root is still
 * reachable by the page's own scripts, and the page is the thing we are hiding
 * from. The cost is that the extension's own Playwright tests cannot pierce it
 * with a plain selector either — they go through `window.UQAUiHost.probe()`
 * below, which exists for exactly that and returns counts, never nodes.
 *
 * ── what deliberately stays in the light DOM ──────────────────────────────
 *
 * `html.uqa-rtl` and the layout-stress stylesheet. **Restyling the page is the
 * feature**, so moving it behind a shadow root would move the feature out of
 * the page it applies to. The same goes for `html.uqa-picking`, which only
 * changes a cursor. What moves is the tool's own furniture: the palette, the
 * picker's box and tip, the toasts, the overflow markers.
 */
(() => {
  if (window.UQAUiHost) return;

  const HOST_TAG = 'qaw-ui';
  let host = null;
  let root = null;

  /**
   * The stylesheet, inlined.
   *
   * Inside the shadow root the stylesheet applies to the tool's nodes and
   * nothing else, which is the whole point. `content/overlay.css` is not
   * web-accessible: the worker sends its text with the face, once, at first use.
   */
  let cssText = null;
  let cssPending = null;

  /**
   * Thmanyah in the page, without a fetchable font file (UI rework round 2, S8).
   *
   * Chrome ignores `@font-face` inside a shadow tree (measured, see git
   * history), and the licence forbids the face being a file any page could
   * fetch, so `overlay.css` cannot carry it. The worker reads the Sans 400 and
   * 500 faces out of `ui/fonts.css` and sends the bytes, with the overlay's
   * strings in the tester's language, in one `UQA_OVERLAY_ASSETS` reply. They
   * are registered on the page's own FontFaceSet under a private family name,
   * so a site that uses "Thmanyah Sans" itself is never re-rendered by us.
   *
   * Lazily, and once per frame: the first layer this frame draws asks. A frame
   * that never shows anything never asks, and until the bytes land the system
   * stack behind the private name draws.
   */
  const FAMILY = 'QAW Thmanyah Sans';
  let assets = null;
  let assetRequests = 0;
  let strings = {};

  function overlayAssets() {
    if (assets) return assets;
    assetRequests++;
    assets = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'UQA_OVERLAY_ASSETS' }, (res) => {
          void chrome.runtime.lastError;
          resolve(res?.ok ? res.result : null);
        });
      } catch {
        resolve(null);
      }
    }).then((a) => {
      if (!a) return null;
      (a.faces || []).forEach((b64, i) => {
        if (!b64) return;
        try {
          const face = new FontFace(FAMILY, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { weight: i ? '500' : '400' });
          document.fonts.add(face);
          face.load().catch(() => {});
        } catch {
          /* a page that replaced FontFace keeps the system stack */
        }
      });
      strings = a.strings || {};
      theme = a.theme ?? null;
      paintTheme();
      if (host) {
        host.lang = a.lang || 'en';
        host.dir = a.dir || 'ltr';
      }
      return a;
    });
    return assets;
  }

  /** One string in the tester's language, or the English the caller carries until it arrives. */
  const t = (key, fallback = key) => strings[key] || fallback;

  /**
   * The theme the tester chose, on the host, so the `:host([data-theme])`
   * blocks the generated tokens carry pick it; "system" leaves the attribute
   * off and the media query decides.
   *
   * `ui/theme.js` mirrors the choice into `chrome.storage.local.qawTheme`, and
   * the worker closes `local` to content scripts (`setAccessLevel
   * TRUSTED_CONTEXTS`), so this never reads storage: the worker sends the value
   * with the face (`UQA_OVERLAY_ASSETS`) and again on every change
   * (`UQA_THEME`).
   */
  let theme = null;
  function paintTheme() {
    if (!host) return;
    if (theme === 'light' || theme === 'dark') host.setAttribute('data-theme', theme);
    else host.removeAttribute('data-theme');
  }

  /**
   * Nothing is drawn while a video is being filmed (Nader, research/56:193).
   *
   * A screenshot can hide the layer around the capture (`withUiHidden`), but a
   * tab or screen recording is a stream, and the browser has no way to leave
   * one element out of it. So "hidden from recordings" means not drawn: the
   * host is `display: none` for as long as any clip runs, and the float
   * carries Stop. The state comes from `content/bridge.js`.
   */
  let filming = false;
  function setFilming(on) {
    filming = !!on;
    if (host) host.style.display = filming ? 'none' : '';
  }
  window.UQABridge?.watch?.((st) => { if (!!st.video !== filming) setFilming(st.video); });

  function loadCss() {
    if (cssText != null || cssPending) return cssPending;
    // From the worker, not fetch(): the file is not web-accessible, so no page can read it either.
    cssPending = overlayAssets()
      .then((a) => (a ? a.css || '' : ''))
      .then((text) => {
        cssText = text;
        // Any root built before the CSS arrived gets it now.
        if (root) {
          const style = root.querySelector('style');
          if (style) style.textContent = cssText;
        }
        return text;
      })
      .catch(() => {
        // A failed hand-over still gets a working, if unstyled, overlay.
        // Refusing to draw at all would be worse.
        cssText = '';
        return '';
      });
    return cssPending;
  }

  /*
   * T-041: the browser's top layer. A z-index cannot beat a `showModal()` dialog, a `[popover]` or a fullscreen
   * element, and a modal also makes everything outside it inert, so the host goes inside the innermost one while it
   * is open and back to the body after. Under a `transform` ancestor the fixed host docks inside that dialog
   * (accepted, T-041). Fullscreen of a replaced element (a bare <video>) has no room for children: that residual stays.
   */
  const NO_CHILDREN = /^(VIDEO|AUDIO|IMG|IFRAME|EMBED|OBJECT|CANVAS|INPUT|SELECT|TEXTAREA)$/;
  function topLayerParent() {
    const last = (sel) => { try { return [...document.querySelectorAll(sel)].pop() || null; } catch { return null; } };
    const fs = document.fullscreenElement;
    if (fs && fs !== document.documentElement && !NO_CHILDREN.test(fs.tagName)) return fs;
    return last('dialog:modal') || last(':popover-open') || document.body || document.documentElement;
  }
  function followTopLayer() {
    if (!host) return;
    const want = topLayerParent();
    if (host.parentNode !== want) want.appendChild(host);
  }
  /** One observer on the two attributes a layer opens and closes by, plus the events that carry the rest; kept for the life of the host. */
  let layerWatch = false;
  function watchTopLayer() {
    if (layerWatch) return;
    layerWatch = true;
    new MutationObserver(followTopLayer).observe(document, { subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
    // `toggle` and `close` do not bubble, so the capture phase on the document is what hears them.
    for (const type of ['toggle', 'close', 'cancel', 'fullscreenchange']) document.addEventListener(type, followTopLayer, true);
  }

  /** The shadow root everything is drawn into. Created once, lazily. */
  function uiRoot() {
    if (root && host?.isConnected) { followTopLayer(); return root; }

    host = document.createElement(HOST_TAG);
    // `all: initial` first, so nothing the page declares for unknown elements
    // or for `*` reaches the host box.
    host.style.cssText =
      'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    // T-060 (G15): no aria-hidden on the host. Hiding it hid the bar, the note box and the toasts from
    // the people who need them; uiLayer() hides each purely visual layer on its own instead.
    (topLayerParent() || document.body || document.documentElement).appendChild(host);
    watchTopLayer();
    if (filming) host.style.display = 'none';
    if (assets) assets.then((a) => { if (a && host) { host.lang = a.lang || 'en'; host.dir = a.dir || 'ltr'; } });
    paintTheme();

    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = cssText ?? '';
    root.appendChild(style);
    loadCss();
    liveEl = null;
    liveRegion(); // D-1010-111: the polite region is in the tree, empty, before any text is announced
    return root;
  }

  /**
   * D-1010-111: one polite live region per host. It is created empty with the root and survives clearUi(); code only
   * clears it and sets text a frame later, because a region created already filled is often skipped by screen readers.
   * The visual toast is aria-hidden, so the message is read once, from here.
   */
  let liveEl = null;
  function liveRegion() {
    if (liveEl && liveEl.isConnected) return liveEl;
    liveEl = uiLayer('uqa-vh');
    liveEl.setAttribute('role', 'status');
    liveEl.setAttribute('aria-live', 'polite');
    liveEl.setAttribute('aria-atomic', 'true');
    return liveEl;
  }
  function announce(text) {
    const region = liveRegion();
    region.textContent = '';
    const set = () => { region.textContent = String(text ?? ''); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set); else setTimeout(set, 0);
  }

  /**
   * A layer to draw one thing into.
   *
   * The host is `pointer-events: none` so it never intercepts a click meant for
   * the page; each layer turns them back on for itself, so the tool's own
   * controls remain clickable.
   */
  const REACHABLE = /\buqa-(bar|bar-tip|vh|quicknote|toast|credname|copy-fallback|palette|field-bar)\b/;
  function uiLayer(className) {
    const layer = document.createElement('div');
    if (className) layer.className = className;
    layer.style.pointerEvents = 'auto';
    // Rings, highlights, chips and mask boxes are drawings, not controls; the layers a person can use are not hidden.
    if (!REACHABLE.test(className || '')) layer.setAttribute('aria-hidden', 'true');
    uiRoot().appendChild(layer);
    overlayAssets();
    return layer;
  }

  /**
   * What is drawn right now: every child of the root except its stylesheet.
   *
   * `root.children`, not `root.querySelectorAll(':scope > …')`. A ShadowRoot
   * is a fragment, not an element, so `:scope` has nothing to match and that
   * query answered an empty list for as long as it existed — `probe()`
   * reported no layers with the palette open, and `clearUi()` cleared nothing.
   */
  const drawnLayers = () => (root ? [...root.children].filter((n) => n.tagName !== 'STYLE' && n !== liveEl) : []);

  /** Take everything down. Used before a capture or a scan. */
  function clearUi() {
    const drawn = drawnLayers();
    drawn.forEach((node) => node.remove());
    return drawn.length;
  }

  /**
   * Hide without destroying, for the moment a screenshot or a scan is taken.
   *
   * Different from `clearUi()` on purpose: a tester who opens the palette,
   * takes a screenshot and expects the palette still to be there afterwards is
   * right to expect that. The evidence is captured with the tool out of the
   * frame, and then the tool comes back.
   */
  function withUiHidden(fn) {
    if (!host) return fn();
    const was = host.style.display;
    host.style.display = 'none';
    try {
      return fn();
    } finally {
      host.style.display = filming ? 'none' : was;
    }
  }

  async function hideWhile(promise) {
    if (!host) return promise;
    const was = host.style.display;
    host.style.display = 'none';
    try {
      return await promise;
    } finally {
      host.style.display = filming ? 'none' : was;
    }
  }

  /**
   * What a test can ask, since a closed root admits no selector.
   *
   * Counts and class names only — never a node. A probe that handed back
   * elements would be an open root with extra steps.
   */
  function probe() {
    return {
      mounted: !!host?.isConnected,
      hidden: host?.style.display === 'none',
      layers: drawnLayers().map((n) => n.className),
      // The number the field test measured. It must stay at zero.
      inLightDom: document.querySelectorAll('[class*="uqa-"]:not(html):not(body)').length,
      assetRequests,
      filming,
      theme: host?.getAttribute('data-theme') || null,
      dir: host?.dir || null,
      bar: window.UQABar?.probe?.() || null,
    };
  }

  /**
   * What the in-page harness measures, since only this world can see inside
   * the closed root: the smallest text and target drawn, the bar, the rings
   * and the chip, and whether the private face is ready. Asked for by
   * `UQA_UI_HIDE` with `measure: true` only (tools/inpage-shots.mjs).
   */
  function measure() {
    if (!root) return { measured: false };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    let minText = Infinity;
    let minTarget = Infinity;
    const faces = new Set();
    for (const el of root.querySelectorAll('*')) {
      if (!el.getClientRects().length || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText && !el.closest('.uqa-vh')) {
        minText = Math.min(minText, parseFloat(cs.fontSize));
        faces.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      }
      if (el.tagName === 'BUTTON') {
        const r = el.getBoundingClientRect();
        minTarget = Math.min(minTarget, r.width, r.height);
      }
    }
    const one = (sel) => {
      const el = root.querySelector(sel);
      return el && el.getClientRects().length ? box(el) : null;
    };
    return {
      measured: true,
      minText: Number.isFinite(minText) ? minText : null,
      minTarget: Number.isFinite(minTarget) ? minTarget : null,
      faces: [...faces],
      fontReady: !!document.fonts?.check?.(`13px "${FAMILY}"`),
      bar: one('.uqa-bar:not([hidden])') || one('.uqa-pill:not([hidden])'),
      rings: [...root.querySelectorAll('.uqa-ring.is-locked')].map(box),
      hoverRing: one('.uqa-ring.is-visible:not(.is-locked)'),
      chip: one('.uqa-chip.is-visible'),
      panels: ['uqa-palette', 'uqa-quicknote', 'uqa-field-bar', 'uqa-mask-tip'].filter((c) => one(`.${c}`)),
      // The bar's controls by name, so a harness can press one with a real click.
      controls: [...root.querySelectorAll('.uqa-bar button[aria-label], .uqa-pill')]
        .filter((b) => b.getClientRects().length)
        .map((b) => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), ...box(b) })),
      // The idle pill's mark, stroke by stroke: the brand's two tones, never one
      // grey. Read whenever the pill is drawn — a live pill swaps the mark for
      // its timer, but the colours it would show are the same.
      mark: one('.uqa-pill:not([hidden])') ? [...root.querySelectorAll('.uqa-pill-mark path')].map((n) => getComputedStyle(n).stroke) : null,
      probe: window.UQABar?.probe?.() || null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }

  /** Is this node the host or anything drawn inside it? Tools use it to look past their own layers. */
  function isOurs(node) {
    if (!node) return false;
    if (node === host) return true;
    const r = node.getRootNode?.();
    return !!root && r === root;
  }

  /** The first page element under a point that is not one of ours. */
  function pageElementAt(x, y) {
    return document.elementsFromPoint(x, y).find((n) => !isOurs(n)) || null;
  }

  /**
   * One crosshair at a time.
   *
   * E11: "features must not collide with or deny each other (mask + record +
   * values + nasty + locator on one page)". Most of them genuinely do not: a
   * mask is data, a recording is a stream, layout stress is a stylesheet, and
   * all of those can be true at once and should be.
   *
   * The exception is the four tools that take over the pointer. `mask.js`, the
   * locator in `picker.js` and the field picker in `data-injector.js` each add
   * a capture-phase `click` listener that calls `preventDefault()` and
   * `stopImmediatePropagation()`, and each sets its own cursor on `<html>`. Two
   * of them armed at once is not a degraded experience, it is a page where one
   * tool eats the other's click: whichever listener was added first wins, the
   * loser looks broken, and which one that is depends on the order the tester
   * happened to press two buttons in.
   *
   * So the rule is stated in one place instead of being enforced by three
   * scripts that would each have to know about the other two. A tool that takes
   * the pointer claims it and hands over the way to give it back; claiming it
   * stops whoever had it. Nothing about masking, recording or layout stress
   * passes through here, because none of them takes the pointer.
   */
  const pointerModes = new Map();

  function claimPointer(name, stop) {
    for (const [other, release] of [...pointerModes]) {
      if (other === name) continue;
      pointerModes.delete(other);
      try {
        release();
      } catch (err) {
        console.warn('[QA Wrap] a pointer tool refused to stand down:', other, err);
      }
    }
    pointerModes.set(name, stop);
  }

  function releasePointer(name) {
    pointerModes.delete(name);
  }

  /** Which tool holds the pointer, for a test and for the sleep sweep. */
  const pointerHolder = () => [...pointerModes.keys()][0] || null;

  /**
   * One line of text to the tester, over the page, gone on its own.
   *
   * Lived in `picker.js` until that file stopped being declared in the
   * manifest, which made every other tool's confirmation depend on the picker
   * being present. It draws into this file's shadow root and always did.
   */
  let toast = null;

  function clearToasts() {
    toast?.remove();
    toast = null;
  }

  function flash(message, kind = 'ok') {
    // Only ever one toast: the "click a field" prompt used to sit there long
    // after the palette had opened, contradicting what was on screen.
    clearToasts();
    const el = uiLayer(kind === 'err' ? 'uqa-toast uqa-toast-err' : 'uqa-toast');
    el.setAttribute('aria-hidden', 'true'); // D-1010-111: read once, from the persistent live region
    announce(message);
    // Most tool sentences are English; `auto` keeps their full stop at the end on an Arabic host.
    el.dir = 'auto';
    el.textContent = message;
    toast = el;
    // 8px beside the bar when there is one, so a toast never lands on it (DESIGN-SPEC §5.6).
    const bar = window.UQABar?.rect?.();
    if (bar) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
      const vertical = bar.height > bar.width;
      const x = vertical
        ? (bar.left > innerWidth / 2 ? bar.left - w - 8 : bar.right + 8)
        : clamp(bar.left + bar.width / 2 - w / 2, 8, innerWidth - 8 - w);
      const y = vertical
        ? clamp(bar.top + bar.height / 2 - h / 2, 8, innerHeight - 8 - h)
        : (bar.top > innerHeight / 2 ? bar.top - h - 8 : bar.bottom + 8);
      el.classList.add('is-anchored');
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
    // Bad news needs longer on screen than good news — it usually has to be read.
    setTimeout(() => {
      el.remove();
      if (toast === el) toast = null;
    }, kind === 'err' ? 5200 : 2600);
  }

  /**
   * The element the tester last right-clicked.
   *
   * Chrome's `contextMenus.onClicked` carries the page, the link and the
   * selection, and never the element. Something has to have been watching
   * before the menu opened, and it has to be a script the manifest declares:
   * `picker.js`, which used to hold this, is now injected on demand, and by the
   * time a menu entry runs the right-click is long over.
   *
   * Capture phase, because a page that stops propagation on contextmenu (any
   * app with its own right-click menu) would otherwise hide the target
   * entirely. Composed path first, so a click landing on a shadow-DOM control
   * resolves to the real inner element rather than its host.
   */
  let contextTarget = null;
  addEventListener(
    'contextmenu',
    (e) => {
      contextTarget = e.composedPath?.()[0] || e.target;
    },
    true
  );

  /**
   * The locator for the element that was last right-clicked.
   *
   * Answered here rather than in `picker.js`, and the rule behind that is worth
   * stating because breaking it cost a diagnose gate: **a message the
   * right-click menu depends on has to be answerable without an injection.**
   * The right-click is over by the time anybody asks, so a handler in a file
   * the worker injects on demand can only ever answer about a memory it was
   * not there to take. It is not enough for the *memory* to live in a declared
   * script; the *answer* has to as well, because callers reach a tab directly
   * (`chrome.tabs.sendMessage`) and not only through `context-menus.js`.
   *
   * Everything it needs is already declared at `document_start`: the memory
   * above, and `window.UQASelector` from `content/selector-engine.js`.
   */
  function describeContextTarget() {
    // A text node is what you get from right-clicking a paragraph; the element
    // around it is what anyone actually meant.
    let el = contextTarget;
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || !el.isConnected) return { locator: null };
    const S = window.UQASelector;
    if (!S) return { locator: null, error: 'The selector engine is not loaded in this frame.' };
    try {
      const desc = S.describe(el);
      /*
       * The masking rule reaches the right-click menu too.
       *
       * "Copy a locator" from the menu goes through this function and never
       * through `picker.js`, so the guard that stops a covered name reaching
       * the clipboard had to be here as well or the second door stayed open.
       * An alternative that carries none of the covered text is offered where
       * one exists; where none does, the menu refuses in a sentence rather
       * than handing over the value the tester had just covered.
       */
      const M = window.UQAMask;
      const leaks = (text) => !!M?.leaks?.(text);
      const built = `page.${desc.framePrefix || ''}${desc.locator}`;
      /*
       * What the element is, and where it is on screen.
       *
       * The right-click path used to answer with a locator, a strategy and a
       * match count and nothing else, so its row in the report's Selector copy
       * section said "the element was not described" where the picker's rows
       * carried a tag, an id, the visible words and a picture. The same
       * fields, from the same masking rule: a covered element says its
       * placeholder and never its own words, and the rectangle is what
       * `content/picker.js` crops the thumbnail out of.
       */
      const trim = (value, n) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const box = el.getBoundingClientRect();
      const about = {
        tag: el.tagName.toLowerCase(),
        elementId: trim(el.id, 60) || null,
        classes: trim(typeof el.className === 'string' ? el.className : '', 90) || null,
        role: desc.role || null,
        text: M?.isMasked?.(el) ? (M.placeholder?.() || '') : trim(el.textContent, 80),
        rect: {
          left: box.left, top: box.top, right: box.right, bottom: box.bottom,
          width: box.width, height: box.height,
        },
      };
      if (M?.isMasked?.(el) || leaks(built)) {
        const clean = (desc.alternatives || []).find((alt) => !leaks(alt.expr));
        if (!clean) {
          return {
            locator: null,
            error: 'That element is covered by the masking tool, so no locator built from its words is copied.',
          };
        }
        return {
          locator: clean.expr,
          unique: !!clean.unique,
          matches: clean.matches,
          strategy: clean.strategy,
          maskedSource: true,
          ...about,
        };
      }
      return {
        locator: built,
        unique: !desc.ambiguous,
        matches: desc.matches,
        strategy: desc.strategy,
        warnCodes: desc.warnCodes,
        ...about,
      };
    } catch (err) {
      return { locator: null, error: err.message };
    }
  }

  /**
   * Take the tool out of the frame while evidence is captured.
   *
   * A screenshot or an accessibility scan must record the page, not the
   * instrument. Hidden rather than destroyed: a tester who opens the palette,
   * photographs the page and expects the palette still to be there afterwards
   * is right to expect that.
   *
   * This listener used to live in `picker.js`, which was the wrong owner even
   * before that file stopped being declared in the manifest. The host element
   * belongs to this file, and everything drawn inside it -- a mask's cover, the
   * quick-note composer, a picker's crosshair -- has to come out of the frame
   * whether or not the picker is the tool that happens to be running.
   */
  const HIDE_WATCHDOG_MS = 30000;
  let hideWatchdog = 0;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /*
     * This extension's own worker, and nothing else.
     *
     * `sender.id` is stamped by the browser and cannot be forged: a message from
     * another extension carries that extension's id, and one from a web page
     * carries no id at all. `sender.tab` is refused as well, because every
     * message this listener is meant to hear comes from the service worker,
     * which is not a tab; anything arriving with a tab on it came from somewhere
     * that has no business driving a tool inside the page under test.
     *
     * The model is `content/bridge.js`, and the rule is research/51d §7:
     * authorise on `sender.id`, never on `sender.url`.
     */
    if (sender?.id !== chrome.runtime.id || sender?.tab) return false;
    if (msg?.type === 'UQA_FLASH') {
      // Here and not in `picker.js`, so that the worker saying "QA Wrap is
      // asleep in this window" does not have to inject a picker into the tab
      // to say it.
      flash(msg.text, msg.kind);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'UQA_DESCRIBE_CONTEXT_TARGET') {
      /*
       * Frames that saw nothing stay quiet.
       *
       * `chrome.tabs.sendMessage` with no `frameId` reaches every frame and
       * delivers whichever answers first, and this script is declared in all of
       * them. A frame the tester did not right-click in has no memory to report,
       * so answering `{locator: null}` from it would be a race to hand back the
       * wrong answer. Returning false leaves the reply to the frame that has one.
       */
      if (!contextTarget) return false;
      sendResponse(describeContextTarget());
      return true;
    }
    if (msg?.type === 'UQA_THEME') {
      theme = msg.theme ?? null;
      paintTheme();
      return false;
    }
    if (msg?.type !== 'UQA_UI_HIDE') return false;
    uiRoot();
    if (host) host.style.display = msg.hidden || filming ? 'none' : '';
    // D-1010-86 (r4-01-2): if the worker dies mid-capture nobody sends the un-hide. Every hide arms (re-arms) a restore, every un-hide clears it.
    clearTimeout(hideWatchdog);
    hideWatchdog = msg.hidden ? setTimeout(() => { hideWatchdog = 0; if (host) host.style.display = filming ? 'none' : ''; }, HIDE_WATCHDOG_MS) : 0;
    const reply = () => sendResponse({ hidden: !!msg.hidden, ...probe(), ...(msg.measure ? measure() : {}) });
    /*
     * A hide is only done once it is on screen. The worker photographs the tab
     * the moment this answers, and captureVisibleTab copies the last frame the
     * compositor produced — which, straight after a style change, can still be
     * the frame with the bar in it (inpage-shots light-en: the whole bar in the
     * first screenshot of a run). Two animation frames is one painted frame;
     * the timeout answers anyway in a tab that is not painting (rAF never runs
     * in a hidden tab, and there is nothing to photograph there either).
     */
    if (msg.hidden && host && !document.hidden) {
      let sent = false;
      const once = () => { if (!sent) { sent = true; reply(); } };
      requestAnimationFrame(() => requestAnimationFrame(once));
      setTimeout(once, 120);
    } else reply();
    return true;
  });

  window.UQAUiHost = {
    uiRoot, uiLayer, clearUi, withUiHidden, hideWhile, probe, isOurs, pageElementAt,
    flash, clearToasts, announce,
    claimPointer, releasePointer, pointerHolder,
    assets: overlayAssets, t, family: FAMILY,
    // Kept for bar.js: the host is no longer aria-hidden (T-060), so there is nothing left to lift.
    expose: () => host?.removeAttribute('aria-hidden'),
  };
})();
