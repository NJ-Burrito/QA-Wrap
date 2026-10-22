/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Page performance — Core Web Vitals and network timing.
 *
 * This is NOT Lighthouse. Lighthouse drives its own page load in a controlled
 * environment and scores it; that cannot run inside an extension. What this
 * does is read the metrics Lighthouse reports, from the page the tester is
 * actually on, in the state they actually put it in — which for QA is often
 * more useful: a logged-in screen, mid-flow, on the real network.
 *
 * Everything comes from the platform's own Performance APIs, so there is no
 * measurement overhead beyond reading them.
 */
(() => {
  if (window.__UQA_VITALS__) return;
  window.__UQA_VITALS__ = true;

  /* ── running collectors ────────────────────────────────────────────────
     LCP and CLS only settle over time, so they are observed continuously and
     read on demand rather than started when the tester asks. */

  let lcp = 0;
  let cls = 0;
  let longTasks = [];
  let slowestEvent = 0;

  // Asleep reads nothing (6 Oct 2026, Sleep is a full stop): `false` is the
  // bridge's decision, `undefined` is "not asked yet".
  const asleep = () => window.UQAAwake === false;
  let observers = [];

  const observe = (type, fn, extra = {}) => {
    try {
      const o = new PerformanceObserver(fn);
      o.observe({ type, buffered: true, ...extra });
      observers.push(o);
    } catch {
      /* the browser does not support this entry type */
    }
  };

  function startObservers() {
    if (observers.length || asleep()) return;
    observe('largest-contentful-paint', (list) => {
      for (const e of list.getEntries()) lcp = e.startTime;
    });

    observe('layout-shift', (list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
    });

    observe('longtask', (list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration);
      if (longTasks.length > 500) longTasks = longTasks.slice(-500);
    });

    // Interaction to Next Paint, approximated by the worst interaction so far.
    observe('event', (list) => {
      for (const e of list.getEntries()) {
        if (e.duration > slowestEvent) slowestEvent = e.duration;
      }
    }, { durationThreshold: 40 });
  }

  function stopObservers() {
    for (const o of observers) { try { o.disconnect(); } catch { /* gone */ } }
    observers = [];
    lcp = 0; cls = 0; longTasks = []; slowestEvent = 0;
  }

  startObservers();
  addEventListener('pageshow', () => { if (asleep()) stopObservers(); });

  /* ── thresholds ────────────────────────────────────────────────────────
     web.dev's published good / needs-improvement boundaries. Reported as a
     rating, never as a single invented "score" — a score would imply a
     Lighthouse run that did not happen. */
  const RATE = {
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    inp: [200, 500],
    fcp: [1800, 3000],
    ttfb: [800, 1800],
  };

  const rate = (key, value) => {
    const [good, poor] = RATE[key] || [];
    if (good == null || value == null) return 'n/a';
    return value <= good ? 'good' : value <= poor ? 'needs work' : 'poor';
  };

  function navigation() {
    const [nav] = performance.getEntriesByType('navigation');
    if (!nav) return null;
    return {
      type: nav.type,
      ttfb: Math.round(nav.responseStart),
      dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
      tcp: Math.round(nav.connectEnd - nav.connectStart),
      tls: nav.secureConnectionStart ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
      request: Math.round(nav.responseStart - nav.requestStart),
      response: Math.round(nav.responseEnd - nav.responseStart),
      domInteractive: Math.round(nav.domInteractive),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      transferSize: nav.transferSize || 0,
    };
  }

  function resources() {
    const all = performance.getEntriesByType('resource');
    const byType = {};
    let bytes = 0;
    let uncompressed = 0;

    for (const r of all) {
      const kind = r.initiatorType || 'other';
      byType[kind] = byType[kind] || { count: 0, bytes: 0, ms: 0 };
      byType[kind].count += 1;
      byType[kind].bytes += r.transferSize || 0;
      byType[kind].ms += r.duration;
      bytes += r.transferSize || 0;
      uncompressed += r.decodedBodySize || 0;
    }

    const slowest = [...all]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 8)
      .map((r) => ({
        url: r.name.length > 110 ? `${r.name.slice(0, 110)}…` : r.name,
        type: r.initiatorType || 'other',
        ms: Math.round(r.duration),
        bytes: r.transferSize || 0,
        cached: (r.transferSize || 0) === 0 && (r.decodedBodySize || 0) > 0,
      }));

    // A request that arrived uncompressed and is big enough to matter.
    const uncompressedBig = all
      .filter((r) => (r.transferSize || 0) > 40_000 && r.transferSize >= (r.decodedBodySize || 0))
      .map((r) => ({ url: r.name.slice(0, 110), bytes: r.transferSize }));

    return {
      count: all.length,
      bytes,
      uncompressed,
      byType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, { ...v, ms: Math.round(v.ms) }])
      ),
      slowest,
      uncompressedBig: uncompressedBig.slice(0, 5),
      cachedCount: all.filter((r) => (r.transferSize || 0) === 0 && (r.decodedBodySize || 0) > 0).length,
    };
  }

  function collect() {
    const paint = Object.fromEntries(
      performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)])
    );
    const nav = navigation();
    const res = resources();

    const metrics = {
      lcp: Math.round(lcp) || null,
      cls: +cls.toFixed(3),
      inp: Math.round(slowestEvent) || null,
      fcp: paint['first-contentful-paint'] ?? null,
      ttfb: nav?.ttfb ?? null,
    };

    const ratings = Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, rate(k, v)])
    );

    return {
      url: location.href,
      collectedAt: Date.now(),
      metrics,
      ratings,
      navigation: nav,
      resources: res,
      longTasks: {
        count: longTasks.length,
        totalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
        longestMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
      },
      memory: performance.memory
        ? {
            usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
            limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
          }
        : null,
      // Honest about what this is and is not.
      note: 'Read from the live page via the Performance API. Not a Lighthouse run.',
    };
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
      if (msg.armed === false) { window.UQAAwake = false; stopObservers(); }
      else startObservers();
      return false;
    }
    if (msg?.type === 'UQA_COLLECT_VITALS') {
      if (asleep()) {
        sendResponse({ error: 'asleep' });
        return true;
      }
      try {
        sendResponse(collect());
      } catch (err) {
        sendResponse({ error: String(err?.message || err) });
      }
      return true;
    }
    return false;
  });

  window.UQAVitals = { collect, asleep };
})();
