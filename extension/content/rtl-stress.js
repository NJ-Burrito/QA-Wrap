/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * RTL / i18n stress mode — the differentiator.
 *
 * No existing QA extension does this. The technique is proven: pseudo-localization
 * catches roughly 80% of text-expansion and RTL-mirroring layout bugs, and Android
 * ships it natively as en-XA (accented + expanded) and ar-XB (bidirectional mirror).
 * On the web it exists only inside paid localization platforms.
 *
 * Modes:
 *   rtl     — force direction: rtl on the document (the ar-XB mirror)
 *   expand  — grow every string ~40% (the en-XA expansion)
 *   accent  — replace latin letters with accented equivalents to expose hardcoded strings
 *   bidi    — wrap strings in BiDi isolate marks to expose isolation bugs
 *
 * Everything is revertible: original text nodes are cached and restored on toggle-off.
 */
(() => {
  if (window.__UQA_RTL__) return;
  window.__UQA_RTL__ = true;

  const B = window.UQABridge;
  const t = (key, fallback) => window.UQAUiHost?.t?.(key, fallback) ?? fallback;

  const STYLE_ID = 'uqa-rtl-style';

  let enabled = false;
  let lastHits = 0; // how many elements clipped on the last stress, for the caller
  let options = { rtl: true, expand: true, accent: false, bidi: false };
  const originals = new Map(); // Text node -> original string
  let priorDir = null;

  /* ------------------------------------------------------------- text mangling */

  const ACCENTS = {
    a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', f: 'ƒ', g: 'ğ', h: 'ĥ', i: 'í', j: 'ĵ',
    k: 'ķ', l: 'ł', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ř', s: 'š', t: 'ŧ',
    u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Đ', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ĥ', I: 'Í', J: 'Ĵ',
    K: 'Ķ', L: 'Ł', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ř', S: 'Š', T: 'Ŧ',
    U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
  };

  const PAD = 'שׁ'; // a wide RTL glyph — expansion you can actually see

  function mangle(text) {
    let out = text;
    if (options.accent) out = out.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] || c);
    if (options.expand) {
      const percent = Number(window.UQASettings?.expandPercent ?? 40) / 100;
      const extra = Math.max(1, Math.ceil(out.trim().length * percent));
      out = `${out}${' '}${PAD.repeat(Math.min(extra, 60))}`;
    }
    if (options.bidi) out = `⁦${out}⁩`; // LRI ... PDI
    if (options.expand || options.accent || options.bidi) out = `⟦${out}⟧`;
    return out;
  }

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);

  function textNodes(root = document.body) {
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.uqa-pick-tip, .uqa-toast, .uqa-overflow-badge')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const out = [];
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  /* ---------------------------------------------------- overflow / clip detection */

  /**
   * Two passes, cheap one first.
   *
   * This used to call getComputedStyle on every element in the document before
   * asking whether it overflowed at all — on a 3,000 element page that is 3,000
   * style resolutions to find the handful that matter. Almost nothing
   * overflows, so measure first and resolve style only for the survivors.
   */
  function findOverflow() {
    const els = document.body ? document.body.querySelectorAll('*') : [];

    // Pass 1: geometry only. The reads all hit one layout, and no styles are
    // resolved, so the vast majority of elements cost almost nothing.
    const overflowing = [];
    for (const el of els) {
      const cw = el.clientWidth;
      if (cw === 0) continue; // not laid out — nothing to lose
      const overflowsX = el.scrollWidth > cw + 1;
      const overflowsY = el.scrollHeight > el.clientHeight + 1;
      if (overflowsX || overflowsY) overflowing.push(el);
    }

    // Pass 2: style, only for the ones that actually overflow.
    const hits = [];
    for (const el of overflowing) {
      if (el.closest('.uqa-pick-tip, .uqa-toast')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const clips =
        style.overflow === 'hidden' || style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
      const scrollable = /(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY);

      // Only flag containers that actually LOSE content: they overflow and clip,
      // and they are not simply scrollable regions doing their job.
      if (clips && !scrollable) {
        hits.push({
          el,
          tag: el.tagName.toLowerCase(),
          overflowX: el.scrollWidth - el.clientWidth,
          overflowY: el.scrollHeight - el.clientHeight,
          // textContent, not innerText: innerText forces another layout, per hit.
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    }
    return hits;
  }

  function markOverflow(hits) {
    hits.forEach((h) => h.el.classList.add('uqa-overflow'));
  }

  function clearOverflow() {
    document.querySelectorAll('.uqa-overflow').forEach((el) => el.classList.remove('uqa-overflow'));
  }

  /* ---------------------------------------------------------------- apply/revert */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.uqa-rtl, html.uqa-rtl body { direction: rtl !important; }
      html.uqa-rtl .uqa-toast, html.uqa-rtl .uqa-pick-tip { direction: ltr !important; }
      .uqa-overflow { outline: 2px dashed #965416 !important; outline-offset: 1px; }
    `;
    document.documentElement.append(style);
  }

  /**
   * A phase marker on <html>, so anything watching knows when a pass is really
   * finished rather than when it has visibly started.
   *
   * This matters more than it looks. Text nodes are rewritten in document
   * order, so the first heading flips within a millisecond while the overflow
   * sweep — a layout read over every element — is still to come. A benchmark
   * that watched the heading recorded that millisecond as the cost of the
   * whole pass, and then billed the sweep to whatever ran next.
   */
  const phase = (value) => {
    document.documentElement.dataset.uqaStress = value;
  };

  function apply() {
    phase('applying');
    // Flipping direction and regrowing every string forces the browser to lay
    // the whole document out again. On a big page that is a second or two of
    // work that is not ours to remove — so say it is happening, rather than let
    // the page look frozen.
    window.UQAUiHost?.flash(t('overlay.rtl.applying', 'Applying layout stress…'));
    injectStyle();

    if (options.rtl) {
      priorDir = document.documentElement.getAttribute('dir');
      document.documentElement.setAttribute('dir', 'rtl');
      document.documentElement.classList.add('uqa-rtl');
    }

    let capped = 0;
    // Three phases, each timed. A pass that takes two seconds should be able to
    // say which second, and "which phase" is the first question anyone asks.
    const timings = { collectMs: 0, rewriteMs: 0, sweepMs: 0, totalMs: 0 };
    const tStart = performance.now();
    if (options.expand || options.accent || options.bidi) {
      // Rewriting every text node on a very large page is the one thing here
      // that scales badly. Bound it, and say so, rather than let the page
      // appear to hang on a slow machine.
      const limit = Number(window.UQASettings?.maxStressNodes ?? 4000);
      const t0 = performance.now();
      const nodes = textNodes();
      timings.collectMs = +(performance.now() - t0).toFixed(1);

      capped = Math.max(0, nodes.length - limit);
      const work = capped ? nodes.slice(0, limit) : nodes;
      const t1 = performance.now();
      for (const node of work) {
        if (!originals.has(node)) originals.set(node, node.nodeValue);
        node.nodeValue = mangle(originals.get(node));
      }
      timings.rewriteMs = +(performance.now() - t1).toFixed(1);
    }

    // Let layout settle before measuring.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t2 = performance.now();
        const hits = findOverflow();
        lastHits = hits.length;
        timings.sweepMs = +(performance.now() - t2).toFixed(1);
        markOverflow(hits);
        const percent = Number(window.UQASettings?.expandPercent ?? 40);
        window.UQAUiHost?.flash(
          t('overlay.rtl.on', 'Layout stress ON (+{p}% text): {n} now clipping content').replace('{p}', percent).replace('{n}', hits.length) +
            (capped ? ' · ' + t('overlay.rtl.capped', '{n} more text nodes left alone (limit)').replace('{n}', capped) : '')
        );
        B?.emit({
          kind: 'rtl',
          enabled: true,
          expandPercent: Number(window.UQASettings?.expandPercent ?? 40),
          options: { ...options },
          overflowCount: hits.length,
          cappedNodes: capped,
          timings,
          overflow: hits.slice(0, 40).map((h) => ({
            tag: h.tag, overflowX: h.overflowX, overflowY: h.overflowY, text: h.text,
          })),
        });
        timings.totalMs = +(performance.now() - tStart).toFixed(1);
        document.documentElement.dataset.uqaStressTimings = JSON.stringify(timings);
        phase('on');
      });
    });
  }

  function revert() {
    phase('reverting');
    clearOverflow();
    for (const [node, value] of originals) {
      if (node.isConnected) node.nodeValue = value;
    }
    originals.clear();

    document.documentElement.classList.remove('uqa-rtl');
    if (priorDir === null) document.documentElement.removeAttribute('dir');
    else document.documentElement.setAttribute('dir', priorDir);
    priorDir = null;
    document.getElementById(STYLE_ID)?.remove();

    B?.emit({ kind: 'rtl', enabled: false, options: { ...options } });
    window.UQAUiHost?.flash(t('overlay.rtl.off', 'RTL stress OFF: page restored'));
    phase('off');
  }

  function toggle(next) {
    if (next) options = { ...options, ...next };
    enabled = !enabled;
    enabled ? apply() : revert();
    return { enabled, options, overflowCount: enabled ? lastHits : 0 };
  }

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
    if (msg?.type === 'UQA_ARMED_CHANGED') {
      if (msg.armed === false) {
        window.UQAAwake = false;
        if (enabled) { enabled = false; revert(); }
      }
      return false;
    }
    if (msg?.type === 'UQA_TOGGLE_RTL') {
      if (window.UQAAwake === false) { sendResponse({ enabled: false, asleep: true }); return true; }
      sendResponse(toggle(msg.options));
      return true;
    }
    if (msg?.type === 'UQA_RTL_STATE') {
      sendResponse({ enabled, options });
      return true;
    }
    // Stopping a session puts the page back. A tester who stops recording and
    // keeps browsing must not be left on a mirrored, expanded page.
    if (msg?.type === 'UQA_RTL_OFF' || msg?.type === 'UQA_SESSION_RESET') {
      if (enabled) {
        enabled = false;
        revert();
      }
      sendResponse({ enabled: false });
      return true;
    }
    return false;
  });

  window.UQARtl = { toggle, state: () => ({ enabled, options }) };
})();
