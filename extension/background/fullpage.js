/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Full-page screenshots.
 *
 * Chrome's `captureVisibleTab` does what its name says and nothing more: it
 * hands back the viewport. Everything below the fold — which on a long form is
 * most of the evidence — is simply not in the file. There are two ways past
 * that and only one of them is acceptable here:
 *
 *   - **`chrome.debugger` + `Page.captureScreenshot`** with
 *     `captureBeyondViewport`. One call, pixel-perfect, and it attaches a
 *     debugger to the tester's tab: Chrome then shows "QA Wrap is debugging
 *     this browser" across the top of the window, which changes the layout of
 *     the page being photographed and alarms anyone watching over a shoulder.
 *     Rejected. A tool that documents a page must not alter it.
 *
 *   - **Scroll and stitch.** Photograph the viewport, scroll, photograph again,
 *     and draw the tiles onto one canvas. No extra permission, no banner, works
 *     on every page the extension can already see. It has two well-known
 *     artefacts, and both are handled below rather than shipped.
 *
 * The artefacts, and what is done about them:
 *
 * **Sticky headers repeat.** A `position: fixed` navigation bar is in every
 * tile, so the naive stitch shows it five times down the page. Fixed and sticky
 * elements are therefore hidden after the first tile and put back at the end —
 * the header appears once, where it belongs.
 *
 * **The last tile overlaps.** The final scroll position is clamped by the
 * document, so the last viewport repeats part of the one before. Each tile is
 * drawn at its *real* scroll offset rather than at `index × height`, which
 * makes the overlap paint over itself correctly instead of duplicating a strip.
 *
 * And one quota worth knowing about: `captureVisibleTab` is rate-limited, and
 * over the limit it rejects rather than blocking. A twelve-tile page hits that
 * every time, so captures are paced and a rejection is retried rather than
 * dropped — a full-page shot that silently loses tile 7 is worse than one that
 * takes an extra second.
 */

const MAX_TILES = 40;
const MAX_PIXELS = 96_000_000; // ~ a 6000 × 16000 page. Beyond this a canvas fails.

/** The page's own measurements, taken in the page. */
const METRICS = () => {
  const doc = document.documentElement;
  const body = document.body;
  return {
    scrollHeight: Math.max(
      doc.scrollHeight, doc.offsetHeight, doc.clientHeight,
      body?.scrollHeight || 0, body?.offsetHeight || 0
    ),
    scrollWidth: Math.max(doc.scrollWidth, doc.clientWidth, body?.scrollWidth || 0),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
  };
};

/**
 * Put the page into a state that can be photographed, and remember how to undo
 * it. Everything is stashed on the window so a second call cannot lose the
 * original values, and so the restore works even if this script is injected
 * again in between.
 */
const FREEZE = () => {
  const doc = document.documentElement;
  window.__njbFullPage = {
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    scrollBehavior: doc.style.scrollBehavior,
    overflowAnchor: doc.style.overflowAnchor,
  };
  // A smooth-scrolling page is still moving when the photograph is taken.
  doc.style.scrollBehavior = 'auto';
  // Scroll anchoring silently shifts the page under us between tiles.
  doc.style.overflowAnchor = 'none';
  return true;
};

/**
 * Hide the elements that would otherwise appear in every tile.
 *
 * Computed position, not a class name or an attribute: a sticky bar built with
 * a utility framework has no name worth matching on, and the only reliable
 * signal is what the browser resolved it to.
 */
const HIDE_STUCK = () => {
  const hidden = [];
  for (const node of document.body?.querySelectorAll('*') || []) {
    const pos = getComputedStyle(node).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    hidden.push([node, node.style.visibility]);
    node.style.visibility = 'hidden';
  }
  window.__njbHidden = hidden;
  return hidden.length;
};

const SHOW_STUCK = () => {
  for (const [node, previous] of window.__njbHidden || []) node.style.visibility = previous;
  delete window.__njbHidden;
  return true;
};

const RESTORE = () => {
  const saved = window.__njbFullPage;
  const doc = document.documentElement;
  if (saved) {
    doc.style.scrollBehavior = saved.scrollBehavior;
    doc.style.overflowAnchor = saved.overflowAnchor;
    window.scrollTo(saved.scrollX, saved.scrollY);
    delete window.__njbFullPage;
  }
  return true;
};

/** Scroll to an offset and report where the page *actually* landed. */
const SCROLL_TO = (y) => {
  window.scrollTo(0, y);
  return new Promise((resolve) =>
    // Two frames: one for the scroll to apply, one for anything that repaints
    // in response to it — lazy images, a shadow under a header.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)))
  );
};

async function inPage(tabId, func, args = []) {
  const [out] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return out?.result;
}

/**
 * `captureVisibleTab`, paced and retried.
 *
 * Chrome rejects with "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded"
 * rather than queueing, so a long page fails partway through unless the caller
 * does the pacing itself.
 */
async function captureTile(windowId, format, quality) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
      });
    } catch (err) {
      if (!/quota|exceeded/i.test(err.message) || attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw new Error('Chrome refused to photograph the tab.');
}

/**
 * Photograph the whole page.
 *
 * @returns {Promise<{tiles: Array, width: number, height: number, dpr: number, tileCount: number, hiddenStuck: number}>}
 *   the tiles and the canvas they belong on. Stitching happens in the offscreen
 *   document, because a service worker has no canvas.
 */
export async function capturePageTiles({ tabId, windowId, format = 'png', quality = 92, onProgress }) {
  const metrics = await inPage(tabId, METRICS);
  if (!metrics) throw new Error('Could not measure that page. Reload the tab and try again.');

  const { scrollHeight, viewportHeight, viewportWidth, dpr } = metrics;

  // A page that fits on the screen is one tile, and does not need any of the
  // freezing, hiding or restoring below.
  if (scrollHeight <= viewportHeight + 2) {
    const dataUrl = await captureTile(windowId, format === 'jpeg' ? 'jpeg' : 'png', quality);
    return {
      tiles: [{ dataUrl, y: 0 }],
      width: viewportWidth,
      height: viewportHeight,
      dpr,
      tileCount: 1,
      hiddenStuck: 0,
      wholePage: true,
    };
  }

  const step = Math.max(1, viewportHeight - 2); // 2px of overlap hides seam rounding
  const tileCount = Math.ceil(scrollHeight / step);
  if (tileCount > MAX_TILES) {
    throw new Error(
      `That page is ${Math.round(scrollHeight / 1000)}k pixels tall: ${tileCount} screenshots. ` +
        'Capture the part you need instead, or collapse the long list first.'
    );
  }
  if (scrollHeight * viewportWidth * dpr * dpr > MAX_PIXELS) {
    throw new Error('That page is too large to stitch into one image. Capture the part you need instead.');
  }

  await inPage(tabId, FREEZE);
  const tiles = [];
  let hiddenStuck = 0;

  try {
    for (let i = 0; i < tileCount; i++) {
      // D-86: re-arm the page's 30 s restore
      try { await chrome.tabs.sendMessage(tabId, { type: 'UQA_UI_HIDE', hidden: true }); } catch {}
      const y = await inPage(tabId, SCROLL_TO, [i * step]);

      // The sticky bar belongs in the first tile and nowhere else.
      if (i === 1) hiddenStuck = (await inPage(tabId, HIDE_STUCK)) || 0;

      const dataUrl = await captureTile(windowId, format === 'jpeg' ? 'jpeg' : 'png', quality);
      // The real offset, not the intended one: the last tile is clamped by the
      // document and drawing it at i × step would repeat a strip.
      tiles.push({ dataUrl, y });
      onProgress?.({ done: i + 1, total: tileCount });

      // Pace under Chrome's quota rather than discovering it at tile seven.
      if (i < tileCount - 1) await new Promise((r) => setTimeout(r, 220));

      // The page ran out before the arithmetic did — a footer that shrinks, a
      // lazy list that collapsed. Stop rather than photograph the same view.
      if (y + viewportHeight >= scrollHeight - 1) break;
    }
  } finally {
    // Always put the page back, even if a capture threw. A tester left on a
    // page with its header invisible and its scroll position moved would
    // reasonably file that as a bug in the application.
    await inPage(tabId, SHOW_STUCK).catch(() => {});
    await inPage(tabId, RESTORE).catch(() => {});
  }

  return {
    tiles,
    width: viewportWidth,
    height: scrollHeight,
    dpr,
    tileCount: tiles.length,
    hiddenStuck,
    wholePage: true,
  };
}
