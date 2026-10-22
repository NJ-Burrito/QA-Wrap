/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Link collector. The page lists its links; the worker checks them, because a
 * content script cannot HEAD a foreign origin and the worker can.
 *
 * One entry per distinct URL, so a footer repeated on every card is checked
 * once. Anchors, mailto:, tel: and javascript: are listed as skipped rather
 * than dropped — "23 links, 3 not checkable" is an honest count.
 */
(() => {
  if (window.__UQA_LINKS__) return;
  window.__UQA_LINKS__ = true;
  /*
   * This used to be followed by `if (window.top !== window) return;`.
   *
   * The reasoning was that one collector per page is enough, which is true only
   * when the page is one document. On 7 September 2026 the page under test was
   * a cross-origin iframe, the top frame held four words of chrome, and the
   * link check reported "1 link, 0 broken" for a mock-up with 33 links, eight of
   * which went nowhere.
   *
   * Every frame collects its own links now. The worker asks each one by
   * `frameId` and folds the answers, so a footer that appears in two frames is
   * still checked once and the report can say where each link was found.
   */

  const S = window.UQASelector;
  const CAP = 500;

  function collect() {
    const seen = new Map();
    const origin = location.origin;
    for (const a of document.querySelectorAll('a[href], area[href]')) {
      if (a.closest('[data-uqa], .uqa-ui')) continue;
      const raw = a.getAttribute('href') || '';
      let href = '';
      try { href = a.href; } catch { href = raw; }
      if (!href) continue;
      const key = href.replace(/#.*$/, '') || href;
      if (seen.has(key)) continue;
      if (seen.size >= CAP) break;
      let internal = false;
      try { internal = new URL(href).origin === origin; } catch { /* not a URL */ }
      seen.set(key, {
        href: key,
        text: S ? S.normText(a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').slice(0, 80) : (a.textContent || '').trim().slice(0, 80),
        internal,
        newTab: a.target === '_blank',
        region: a.closest('nav, header, footer') ? a.closest('nav, header, footer').tagName.toLowerCase() : 'main',
        hashOnly: raw.startsWith('#'),
      });
    }
    return { url: location.href, title: document.title, links: [...seen.values()] };
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
    if (msg?.type === 'UQA_COLLECT_LINKS') {
      try { sendResponse(collect()); } catch (err) { sendResponse({ error: String(err?.message || err) }); }
      return true;
    }
    return false;
  });

  window.UQALinks = { collect };
})();
