/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * White-box testing (CTFL 4.3): statement and function coverage of the page's own JavaScript.
 *
 * The one feature that needs a permission: V8's instrumentation is reachable from an extension only through `chrome.debugger`
 * and the `Profiler` domain. Chrome does not allow `debugger` to be optional, so it is in `permissions` and the listing says
 * what it is for (T-006, owner decision Q-02). The debugger stays detached until Measure is pressed, the debugging banner is
 * explained before it appears, and the run ALWAYS detaches, even when it throws: a debugger left attached blocks DevTools.
 *
 * V8 reports ranges executed, per function, with call counts. Function coverage (functions entered / present) is reliable.
 * Statement coverage is bytes executed / total bytes, reported as an approximation. Branch coverage is NOT reported: an
 * unexecuted range is not a branch, and a number that is nearly branch coverage will be quoted as branch coverage.
 * 100% statement coverage means every line ran, not that every line is right (CTFL 1.3, principle 1).
 */

const DEBUGGEE_VERSION = '1.3';

/**
 * Declared up front: Chrome silently drops `debugger` from the request-later list, and
 * a later request fails forever. The listing and PRIVACY.md say what it is for. Holding it is not using it:
 * the debugger attaches only on Measure and `stopCoverage()` detaches in a `finally`, even when the run throws.
 */
export async function hasPermission() {
  return chrome.permissions.contains({ permissions: ['debugger'] });
}

/** Nothing to ask for: it is declared. Kept so the popup's ask-then-act flow reads the same. */
export async function requestPermission() {
  return hasPermission();
}

/** A required permission cannot be given back; said plainly, not pretended. */
export async function dropPermission() {
  return false;
}

import { assertPolicy } from '../platform/settings.js';

/** Raw Chrome refusals to code and catalog key, or null. Chrome 154+ gives chrome.debugger no Profiler domain: a sentence, not JSON (H1). */
export const policyRefusal = (message) =>
  /Host access is restricted by policy/i.test(message)
    ? { code: 'POLICY_HOSTS', key: 'common.worker.policy.hosts', en: 'Turned off by your organisation: Chrome policy blocks QA Wrap on this site.' }
    : /Screenshot capture is restricted by policy/i.test(message)
      ? { code: 'POLICY_SCREENSHOT', key: 'common.worker.policy.screenshot', en: 'Turned off by your organisation: Chrome policy blocks screenshots here.' }
      : /^\{"code":-?\d+,"message"/.test(message)
        ? /'Profiler\./.test(message)
          ? { code: 'COVERAGE_UNAVAILABLE', key: 'common.worker.coverage.unavailable', en: 'This Chrome blocks code coverage.' }
          : { code: 'DEBUGGER_REFUSED', key: 'common.worker.debugger.refused', en: 'Chrome refused the debugger.' }
        : null;

const send = (target, method, params) =>
  new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(result);
    });
  });

// T-068 last line: debuggerToolsAllowed, asked where the debugger is actually attached.
const attach = async (target) => {
  await assertPolicy('debugger');
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGEE_VERSION, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
};

const detach = (target) =>
  new Promise((resolve) => chrome.debugger.detach(target, () => (void chrome.runtime.lastError, resolve())));

/**
 * Wait for the page to finish loading again, or give up and carry on.
 *
 * `Page.reload` returns as soon as the command is accepted, not when the page
 * is up, so measuring straight afterwards measures a blank document. There is
 * no promise-shaped "loaded" in `chrome.debugger`; the event arrives on
 * `onEvent`, so the listener is attached, awaited, and always removed.
 *
 * The deadline is not a nicety. A page that never fires `loadEventFired` — a
 * long poll, a service worker that stalls, a site that is simply down — would
 * otherwise leave the tester looking at a debugger banner over a page nobody
 * is measuring, with no way to stop it.
 */
function afterLoad(tabId, ms = 15_000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      resolve(how);
    };
    const listener = (source, method) => {
      if (source?.tabId === tabId && method === 'Page.loadEventFired') finish('loaded');
    };
    const timer = setTimeout(() => finish('timed-out'), ms);
    chrome.debugger.onEvent.addListener(listener);
  });
}

/**
 * Start measuring. `detailed: true` asks V8 for block-level ranges (what makes the executed-bytes figure meaningful);
 * `callCount: true` tells "ran once" from "ran ten thousand times".
 *
 * The reload: precise coverage counts from the moment it is switched on, so a page that is already open has already run its
 * boot, wiring and router, and a Measure without a reload reports a few percent and an "untouched" list that is most of the
 * application. Chrome's Coverage panel reloads for the same reason. The reload happens AFTER `startPreciseCoverage`.
 * `reload: false` is kept for a page that cannot be reloaded (a half-filled form); `mode` travels with the result and the
 * caveats say which question was answered.
 */
export async function startCoverage(tabId, { reload = true } = {}) {
  if (!(await hasPermission())) {
    // r7-02-2: required in the manifest; missing only if a policy removed it. L4 owns the words.
    throw Object.assign(new Error('The debugger permission is missing from this build.'), { code: 'DEBUGGER_MISSING' });
  }
  /*
   * Refuse a page Chrome will not attach to, by name, before attaching.
   *
   * `chrome.debugger.attach` fails on `chrome://`, the Web Store, `devtools://`
   * and a few others with "Cannot attach to this target", which reads as the
   * feature being broken rather than as the page being out of bounds. The
   * popup names this as one of its three refusals before the press; this is
   * the same answer from the engine, for the presses that get past it.
   */
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('That tab has gone. Open the page you want to measure and try again.');
  if (!/^https?:|^file:/.test(tab.url || '')) {
    throw new Error(
      'Chrome does not let anything attach a debugger to its own pages, and coverage needs one. ' +
        'Open the site you are testing and measure there.'
    );
  }

  const target = { tabId };

  try {
    await attach(target);
  } catch (err) {
    if (/already attached/i.test(err.message)) {
      throw new Error('DevTools is open on that tab. Close it, or use a different tab, then try again.');
    }
    if (policyRefusal(err.message)) throw err;
    if (/cannot attach|not allowed|restricted/i.test(err.message)) {
      throw new Error(
        `Chrome will not let a debugger attach to ${tab.url ? new URL(tab.url).host : 'that page'}. ` +
          'It does that for its own pages, the Web Store and a few others. Measure on the site you are testing.'
      );
    }
    throw err;
  }

  let reloaded = false;
  try {
    await send(target, 'Profiler.enable');
    await send(target, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    if (reload) {
      await send(target, 'Page.enable');
      // Issued, then waited for. The cache is not bypassed: coverage is about
      // what ran, not about what was downloaded, and a cached script is
      // compiled and counted exactly like a fetched one.
      const settled = afterLoad(tabId);
      await send(target, 'Page.reload', { ignoreCache: false });
      reloaded = (await settled) === 'loaded';
    }
  } catch (err) {
    // Never leave a debugger attached because the setup failed halfway.
    await detach(target);
    throw err;
  }

  return {
    tabId,
    startedAt: Date.now(),
    reloaded,
    mode: reload ? 'from-reload' : 'from-now',
  };
}

/**
 * Stop, and report.
 *
 * The page's own scripts only. A coverage figure that includes Google
 * Analytics, a chat widget and three polyfills is a figure about somebody
 * else's code, and it is always the same number: low.
 */
export async function stopCoverage(tabId, { origin, mode = 'from-reload' } = {}) {
  const target = { tabId };
  let raw;
  try {
    raw = await send(target, 'Profiler.takePreciseCoverage');
    await send(target, 'Profiler.stopPreciseCoverage');
  } catch (err) {
    // D-1010-70: Chrome took the debugger away; the exact sentence is mapped on the UI side.
    if (/not attached/i.test(String(err?.message))) throw new Error('Coverage stopped because the debugger was detached. Start it again to measure.');
    throw err;
  } finally {
    await detach(target);
  }
  return summariseCoverage(raw, { origin, mode });
}

/* ── the arithmetic, which is the half that was wrong ──────────────────── */

/**
 * Is a script the page's own?
 *
 * The old rule was `url.startsWith(origin)`, which is right for a page that
 * serves its own JavaScript and wrong for most real applications: put the
 * bundle on `static.app.example` or `cdn.app.example`, as nearly everybody
 * does, and every line of the application under test is classified as third
 * party and excluded from the totals. The tester then sees "0 of your scripts"
 * on a page made of nothing but their scripts, which is the shape of the E15
 * complaint.
 *
 * Same origin, or the same registrable-looking domain: the last two labels of
 * the host. It is not the Public Suffix List and it does not pretend to be —
 * `app.co.uk` and `cdn.co.uk` would be read as related — but shipping the
 * whole PSL into a service worker's boot graph to sharpen a *classification*
 * that is shown beside the list it classifies is the wrong trade. Every script
 * is listed either way; this only decides which ones the headline is about.
 */
export function isOwnScript(url, origin) {
  if (!origin) return true;
  if (url.startsWith(origin)) return true;
  try {
    const site = (host) => host.split('.').slice(-2).join('.');
    return site(new URL(url).hostname) === site(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * V8's ranges, turned into "how many bytes never ran".
 *
 * ── the bug this replaces ─────────────────────────────────────────────────
 *
 * V8 reports, per script, one entry per function *plus* one for the script
 * itself, and every one of them carries a list of ranges that nest: the
 * function's whole extent first, then the blocks inside it that ran a
 * different number of times. The old code summed `ranges[0]` of every function
 * as the script's size — so the script's own range was counted once, and then
 * every function inside it was counted again, and a file with fifty functions
 * was measured as several times its own length. The percentage that came out
 * of that is not an approximation of anything.
 *
 * ── what is correct ───────────────────────────────────────────────────────
 *
 * A byte's count is the count of the **innermost** range containing it. So the
 * ranges are a forest, built here by nesting, and a node's own bytes are its
 * extent minus its children's. Uncovered bytes are the own-bytes of every node
 * whose count is zero. Covered is the outermost extent minus that. This is
 * what `v8-to-istanbul` and DevTools' own coverage view compute, and on the
 * fixture in `tools/test-coverage.mjs` it gives the number a person counting
 * the source by hand gives.
 */
export function scriptBytes(script) {
  const ranges = (script.functions || []).flatMap((fn) => fn.ranges || []);
  if (!ranges.length) return { total: 0, covered: 0 };

  // Outermost first, and for equal starts the longer one first, so a parent is
  // always seen before its children.
  const sorted = [...ranges].sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset
  );

  const roots = [];
  const stack = [];
  for (const r of sorted) {
    const node = { start: r.startOffset, end: r.endOffset, count: r.count, children: [] };
    while (stack.length && node.end > stack[stack.length - 1].end) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const uncovered = (node) => {
    const childSpan = node.children.reduce((n, c) => n + (c.end - c.start), 0);
    const own = node.end - node.start - childSpan;
    return (node.count === 0 ? own : 0) + node.children.reduce((n, c) => n + uncovered(c), 0);
  };

  const total = roots.reduce((n, r) => n + (r.end - r.start), 0);
  const missed = roots.reduce((n, r) => n + uncovered(r), 0);
  return { total, covered: Math.max(0, total - missed) };
}

/**
 * The whole report, from one `Profiler.takePreciseCoverage` payload.
 *
 * Pure, and exported, so `tools/test-coverage.mjs` can run it against a real
 * V8 payload in plain Node. The arithmetic is the part that was wrong and the
 * part that cannot be checked by looking at a browser: a percentage is
 * plausible whatever it is.
 */
export function summariseCoverage(raw, { origin, mode = 'from-reload' } = {}) {
  const scripts = [];
  let totalFunctions = 0;
  let coveredFunctions = 0;
  let totalBytes = 0;
  let coveredBytes = 0;

  for (const script of raw?.result || []) {
    const url = script.url || '';
    // Anonymous scripts, extension scripts and `about:` have no source anybody
    // can act on.
    if (!url || /^(chrome|chrome-extension|devtools|about):/.test(url)) continue;
    const own = isOwnScript(url, origin);

    // The script's own top-level entry has an empty `functionName` and is the
    // module body, not a function anybody wrote. Counting it as a function
    // makes every file look as though it has one more function than it has,
    // and it is always covered, which flatters the percentage.
    const named = (script.functions || []).filter((fn) => fn.functionName);
    const fnTotal = named.length;
    const fnCovered = named.filter((fn) => (fn.ranges?.[0]?.count ?? 0) > 0).length;

    const bytes = scriptBytes(script);

    scripts.push({
      url,
      own,
      functions: { total: fnTotal, covered: fnCovered },
      bytes,
      percent: bytes.total ? Math.round((bytes.covered / bytes.total) * 100) : 0,
      // The functions nobody entered, which is the actionable half of a
      // coverage report: a list of names beats a percentage every time.
      untouched: named
        .filter((fn) => (fn.ranges?.[0]?.count ?? 0) === 0)
        .map((fn) => fn.functionName)
        .slice(0, 40),
    });

    if (own) {
      totalFunctions += fnTotal;
      coveredFunctions += fnCovered;
      totalBytes += bytes.total;
      coveredBytes += bytes.covered;
    }
  }

  scripts.sort((a, b) => a.percent - b.percent);
  const ownScripts = scripts.filter((s) => s.own).length;

  return {
    scripts,
    mode,
    own: {
      scripts: ownScripts,
      functionCoverage: totalFunctions ? Math.round((coveredFunctions / totalFunctions) * 100) : null,
      statementCoverage: totalBytes ? Math.round((coveredBytes / totalBytes) * 100) : null,
      functions: { total: totalFunctions, covered: coveredFunctions },
      bytes: { total: totalBytes, covered: coveredBytes },
    },
    thirdParty: scripts.length - ownScripts,
    /*
     * Why there is no number, when there is no number.
     *
     * "Not really working" is what a tester says about a tool that answers
     * with a blank. Every way this can legitimately have nothing to report is
     * named here, in a sentence, so the card can say it where the tester is
     * standing rather than sending them to the timeline to find out.
     */
    nothingToReport: !scripts.length
      ? 'This page ran no JavaScript that Chrome could measure. That is a real answer about a static page, not a failure.'
      : !ownScripts
        ? `Every script on this page came from somewhere else (${scripts.length} of them, listed below). ` +
          'There is nothing of yours here to measure.'
        : null,
    measuredAt: Date.now(),
    // Carried with the numbers rather than left to the UI, so it survives into
    // the report, the export and the ticket.
    caveats: [
      mode === 'from-reload'
        ? 'The page was reloaded when measuring started, so the figures cover the whole run including everything that happens at load.'
        : 'Measuring started on the page as it already was, so nothing that ran before you pressed Measure is counted: module bodies, framework boot and page setup will all read as untouched.',
      'Statement coverage here is executed bytes divided by total bytes, which is V8’s unit. It approximates statement coverage; it is not a line count.',
      'Branch coverage is deliberately not reported: V8 block coverage cannot distinguish an unexecuted else from an unexecuted early return, and a number that is nearly branch coverage will be quoted as branch coverage.',
      'Scripts from the page’s own origin or domain are counted. Anything else is listed separately and excluded from the totals.',
      'CTFL principle 1: coverage says a line ran. It does not say the line is correct.',
    ],
  };
}

/** Make sure nothing is left attached, whatever happened. */
export async function ensureDetached(tabId) {
  await detach({ tabId });
}
