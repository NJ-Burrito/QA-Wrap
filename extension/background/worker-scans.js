/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Page tools that read a tab and write the result as events: screenshots, accessibility, performance, harvest, the reporter, fine print, spec, links and autofill. Moved out of service-worker.js (OF-18), unchanged. */

import { getSettings, policy } from '../platform/settings.js';
import { captureImage, stitchFullPage, finePrintOp, specOp } from './media.js';
import { deleteMedia, getSession } from '../core/db.js';
import { capturePageTiles } from './fullpage.js';
import { liteProblem } from '../core/events.js';
import { countFindings } from '../core/sessions.js';
import * as secHeaders from './security-headers.js';
import { checkable as linkCheckable, checkAll as checkLinksAll, summariseLinks } from '../core/links.js';
import { recordEgress, ledgerRow } from '../core/egress.js';
import { QAConsole, activeSessionId, coded, isInternalUrl } from './worker-base.js';
import {
  MAX_SCAN_FRAMES, ensureScript, exclusiveOnTab, sendToFeature, sendToTab, testableFrames, testableTabId,
  withoutOverlays,
} from './worker-tabs.js';
import { appendEvent, getEvents, paintBadge, startSession, stopSession } from './worker-session.js';
import { notifyAll } from './worker-filing.js';

/** @param {{ text?: string, tabId?: number, format?: string, extra?: object, guard?: () => Promise<boolean> }} o */
export async function captureScreenshot({ text, tabId, format, extra, guard }) {
  const sessionId = await activeSessionId({ tabId });
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) throw new Error('No active tab to capture.');

  const settings = await getSettings();
  const chosen = format || settings.imageFormat || 'png';

  // A Blob in the media store, not a base64 data URI in the record. `guard` (auto-screenshot): asked after the overlays are hidden and just before Chrome photographs, and again before the picture is kept; a "no" keeps nothing.
  const meta = await withoutOverlays(tab.id, async () => {
    if (guard && !(await guard())) return null;
    const m = await captureImage({
      tabId: tab.id,
      windowId: tab.windowId,
      sessionId,
      format: chosen,
      quality: settings.imageQuality ?? 92,
      label: text || 'Screenshot',
      url: tab.url,
    });
    if (guard && !(await guard())) { await deleteMedia(m.id).catch((err) => QAConsole.warn('the dropped auto screenshot could not be removed:', err)); return null; }
    return m;
  });
  if (!meta) return null;

  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'screenshot',
      ts: Date.now(),
      captureId: meta.id,
      mediaId: meta.id,
      imageType: meta.type,
      bytes: meta.bytes,
      text: text || '',
      frameUrl: tab.url,
      tabId: tab.id,
      ...extra,
    });
    paintBadge();
  }
  return { captureId: meta.id, mediaId: meta.id, type: meta.type, bytes: meta.bytes };
}

/**
 * The whole page, not just the part on screen.
 *
 * Two hops on purpose: the worker does the scrolling and the photographing
 * because only it can reach `chrome.tabs`, and the offscreen document does the
 * stitching because only it has a canvas. Sending the tiles across is the seam.
 */
export async function captureFullPage({ text, tabId, format }) {
  const sessionId = await activeSessionId({ tabId });
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('Open the page you want to photograph first.');
  const tab = await chrome.tabs.get(id);
  if (isInternalUrl(tab.url)) throw new Error('Chrome will not photograph its own pages.');

  const settings = await getSettings();
  const chosen = format || settings.imageFormat || 'png';

  const shot = await exclusiveOnTab(id, 'A full-page capture', () =>
    withoutOverlays(id, () => capturePageTiles({
      tabId: id,
      windowId: tab.windowId,
      // The tiles are photographed losslessly whatever the target is: re-encoding
      // a JPEG tile into a JPEG page compounds the artefacts at every seam.
      format: 'png',
      quality: settings.imageQuality ?? 92,
    })));

  const meta = await stitchFullPage({
    ...shot,
    format: chosen,
    quality: settings.imageQuality ?? 92,
    sessionId,
    label: text || `Full page: ${shot.tileCount} screen${shot.tileCount === 1 ? '' : 's'}`,
    url: tab.url,
  });

  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'screenshot',
      ts: Date.now(),
      captureId: meta.id,
      mediaId: meta.id,
      imageType: meta.type,
      bytes: meta.bytes,
      fullPage: true,
      tiles: shot.tileCount,
      text: meta.label,
      frameUrl: tab.url,
      tabId: id,
    });
    paintBadge();
  }
  return { ...meta, tiles: shot.tileCount, hiddenStuck: shot.hiddenStuck };
}

/* ------------------------------------------------------- accessibility (7) */

/**
 * Runs the vendored axe-core in the page's ISOLATED world — same DOM, no page
 * globals touched, no network. Rebuilding axe would have been the wrong call:
 * it is the de-facto engine and it is the one thing in this extension we should
 * not have opinions about.
 */
/**
 * The rule catalogue axe will run, so a tester can choose.
 *
 * "Scan everything" answers "is this page compliant". It does not answer "does
 * this dialog trap focus" or "does this table have real headers", which is what
 * someone auditing a screen is usually asking. Listing the rules turns the scan
 * from a verdict into an instrument.
 */
export async function a11yRules({ tabId }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No active tab.');

  await chrome.scripting.executeScript({ target: { tabId: id }, files: ['vendor/axe.min.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: id },
    func: () => {
      if (typeof window.axe === 'undefined') return { error: 'axe failed to load' };
      return {
        rules: window.axe.getRules().map((r) => ({
          id: r.ruleId,
          description: r.description,
          help: r.help,
          helpUrl: r.helpUrl,
          tags: r.tags || [],
        })),
        version: window.axe.version,
      };
    },
  });
  if (result?.error) throw new Error(result.error);
  return result;
}

/** The checks axe cannot make. */
export const GUIDED_CHECKS = [
  { id: 'keyboard-only', wcag: '2.1.1', title: 'Everything works with the keyboard alone',
    how: 'Put the mouse down. Tab through the whole screen: reach every control, operate every one, open and close every menu and dialog.' },
  { id: 'focus-visible', wcag: '2.4.7', title: 'You can always see where focus is',
    how: 'Tab through again watching only for the focus ring. A control you cannot locate is a failure even when it is reachable.' },
  { id: 'focus-order', wcag: '2.4.3', title: 'Focus order matches reading order',
    how: 'Tab order should follow the visual order. Watch especially where the layout is built with grid or float.' },
  { id: 'focus-trap', wcag: '2.1.2', title: 'Nothing traps the keyboard',
    how: 'Open each dialog, date picker and embedded widget. Confirm you can Tab out or press Escape.' },
  { id: 'alt-meaning', wcag: '1.1.1', title: 'Alt text says what the image means',
    how: 'axe checks that alt exists. Read each one: does it carry the information the image carries? A decorative image should have empty alt.' },
  { id: 'headings', wcag: '1.3.1', title: 'Headings describe structure, not styling',
    how: 'Read the headings alone. They should outline the page. Watch for a level chosen because it was the right size.' },
  { id: 'link-purpose', wcag: '2.4.4', title: 'Link text makes sense on its own',
    how: 'Read each link out of context. "Read more" and "here" fail; a screen-reader user navigates by a list of links.' },
  { id: 'error-help', wcag: '3.3.3', title: 'Errors say how to fix the problem',
    how: 'Submit each form wrong. The message must name the field and what would be accepted, not merely that something is invalid.' },
  { id: 'zoom-400', wcag: '1.4.10', title: 'Usable at 400% zoom with no sideways scrolling',
    how: 'Set the window to 1280px wide and zoom to 400%. Content should reflow to one column and stay operable.' },
  { id: 'motion', wcag: '2.3.3', title: 'Motion respects prefers-reduced-motion',
    how: 'Turn on reduced motion in the OS. Animation that conveys nothing should stop.' },
  { id: 'lang-direction', wcag: '3.1.2', title: 'Language and direction are declared and correct',
    how: 'Check lang on the document and on any passage in another language. On a bilingual portal, check dir flips with it.' },
  { id: 'timeout', wcag: '2.2.1', title: 'Time limits can be extended or turned off',
    how: 'Find any session timeout or auto-advancing carousel. The user must be able to extend, pause or dismiss it.' },
];

export async function scanAccessibility({ tabId, ruleIds }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No active tab to scan.');

  /*
   * Every frame, not only the top one.
   */
  const frames = await testableFrames(id);
  await chrome.scripting
    .executeScript({ target: { tabId: id, allFrames: true }, files: ['vendor/axe.min.js'] })
    .catch(() => chrome.scripting.executeScript({ target: { tabId: id }, files: ['vendor/axe.min.js'] }));

  // The scan audits the page, not the instrument. Before ui-host.js the palette
  // was inside the document, so an open palette changed the violation count.
  const perFrame = await withoutOverlays(id, () => Promise.all(frames.map(async (frame) => {
    const answered = await chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [frame.frameId] },
    args: [Array.isArray(ruleIds) && ruleIds.length ? ruleIds : null],
    func: async (only) => {
      if (typeof window.axe === 'undefined') return { error: 'axe failed to load' };
      const run = await window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: only
          ? { type: 'rule', values: only }
          : { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      });
      return {
        violations: run.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          count: v.nodes.length,
          nodes: v.nodes.slice(0, 8).map((n) => ({
            target: n.target.join(' '),
            html: (n.html || '').slice(0, 240),
            summary: (n.failureSummary || '').slice(0, 400),
          })),
        })),
        url: location.href,
        testedAt: Date.now(),
      };
    },
    }).catch(() => null);
    // A frame that would not answer is named, not silently dropped: "we could
    // not read this one" and "this one was clean" are different results.
    return { frame, result: answered?.[0]?.result || null };
  })));

  const top = perFrame[0]?.result;
  if (top?.error) throw new Error(top.error);

  /*
   * One result, with every finding stamped with the document it came from.
   *
   * The counts keep the meaning they had: `total` is failing nodes, `rules` is
   * distinct rules, `byImpact` is nodes by severity. On a page with one frame
   * every number below is exactly what it was before this existed, which is the
   * property `tools/test-frames.mjs` pins.
   */
  const scanned = perFrame.filter((f) => f.result && !f.result.error);
  const refused = perFrame.filter((f) => !f.result || f.result.error).map((f) => f.frame.url);
  const result = {
    violations: scanned.flatMap(({ frame, result: r }) =>
      r.violations.map((v) => ({ ...v, frameUrl: r.url || frame.url, frameDepth: frame.depth }))),
    url: top?.url || frames[0]?.url || '',
    testedAt: top?.testedAt || Date.now(),
    frames: scanned.map(({ frame, result: r }) => ({
      url: r.url || frame.url,
      depth: frame.depth,
      total: r.violations.reduce((n, v) => n + v.count, 0),
    })),
    frameCount: scanned.length,
    framesRefused: refused,
    framesLimited: frames.length >= MAX_SCAN_FRAMES,
  };

  /**
   * The count is part of the result, not just part of the event.
   *
   * It was computed only for the timeline entry, so the returned object had no `total`; the right-click menu read
   * `r.total`, got `undefined` and announced **"No accessibility violations found"** on a page with five rules violated.
   * A false clean bill of health is the worst output an accessibility tool has. Counted once here; every surface reads it.
   */
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  result.violations.forEach((v) => {
    if (byImpact[v.impact] != null) byImpact[v.impact] += v.count;
  });
  result.total = result.violations.reduce((n, v) => n + v.count, 0);
  /*
   * Distinct rules, not rows.
   *
   * With one frame these are the same number and always were. With two, the
   * same rule broken in both is one rule broken in two places, and counting the
   * rows would have said "10 rules" for a page that violates five. The headline
   * reads "83 across 5 rules"; the 5 has to stay the number of rules.
   */
  result.rules = new Set(result.violations.map((v) => v.id)).size;
  result.byImpact = byImpact;

  const sessionId = await activeSessionId({ tabId: id });
  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'a11y',
      ts: Date.now(),
      url: result.url,
      total: result.total,
      byImpact,
      violations: result.violations,
      frameUrl: result.url,
      frames: result.frames,
      frameCount: result.frameCount,
      framesRefused: result.framesRefused,
      tabId: id,
    });
    // cap1022: layout checks run here, not while recording.
    const deep = await chrome.tabs.sendMessage(id, { type: 'UQA_DEEP_SCAN' }, { frameId: 0 }).catch(() => null);
    for (const f of (deep?.findings || []).slice(0, 120)) await appendEvent({ sessionId, kind: 'console', level: 'error', text: f.text, check: f.check, ts: Date.now() });
    result.layoutFindings = deep?.findings?.length || 0;
    paintBadge();
  }

  return result;
}

/* ------------------------------------------------- page performance (11) */

/**
 * Core Web Vitals and network timing from the live page.
 *
 * Deliberately not a Lighthouse run — Lighthouse drives its own page load in a
 * controlled environment, which an extension cannot do. This reads the same
 * metrics from the page the tester is actually on, in the state they put it in.
 * That is usually more useful for QA: a logged-in screen, mid-flow, real network.
 */
export async function scanPerformance({ tabId }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to measure.');

  const result = await sendToTab(id, { type: 'UQA_COLLECT_VITALS' });
  if (!result) throw coded('Reload the tab first. QA Wrap only attaches when a page loads.', 'TAB_RELOAD');
  if (result.error) throw new Error(result.error);

  const sessionId = await activeSessionId({ tabId: id });
  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'perf',
      ts: Date.now(),
      ...result,
      frameUrl: result.url,
      tabId: id,
    });
    paintBadge();
  }
  return result;
}

/* ----------------------------------------- harvest, links, autofill (E) */

/**
 * Every interactive element with a verified locator, kept as an event so the
 * page map, the page object and the brief can be exported from the report.
 */
export async function harvestPage({ tabId }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to map.');
  const result = await sendToFeature(id, 'harvester', { type: 'UQA_HARVEST_PAGE' });
  if (!result) throw coded('Reload the tab first. QA Wrap only attaches when a page loads.', 'TAB_RELOAD');
  if (result.error) throw new Error(result.error);

  const sessionId = await activeSessionId({ tabId: id });
  if (sessionId) {
    await appendEvent({ sessionId, kind: 'harvest', ts: Date.now(), tabId: id, ...result, frameUrl: result.url });
    paintBadge();
  }
  return { counts: result.counts, forms: result.forms.length, truncated: result.truncated, ms: result.ms, stored: !!sessionId };
}

/**
 * The page, read back as a specification.
 *
 * The DOM says what the software *asks for*; the session, when running, says what it *did*. Together a draft
 * specification. Built in the offscreen document (`UQA_OFF_SPEC`), never here (`srs-reverse.js` pulls `artifact.js`; the
 * boot graph is tight). It comes back as Markdown and is filed as an event, so every exporter writes it too.
 */
/**
 * The legal and privacy surface of the page, from what the session already has.
 *
 * Nothing new is captured: links from the link check, requests from the MAIN-world patch, forms from the page map, cookie
 * and storage writes from the recorder, consent timing from when a banner was seen. The reading runs in the offscreen
 * document (two-language matchers, tracker catalogue) and returns a result plus Markdown, filed as an event.
 */
/* ── reporter mode ─────────────────────────────────────────────────────── */

/** Everything a developer will ask for, gathered before the reporter is asked. */
const REPORTER_SHOT = 'qawReporterShot';

/** Photograph the buggy tab before the reporter tab covers it. Best effort: no picture beats a wrong one. */
export async function shootBeforeReporter() {
  const id = await testableTabId();
  const tab = id == null ? null : await chrome.tabs.get(id).catch(() => null);
  let entry = null;
  if (tab?.active) {
    const settings = await getSettings();
    const meta = await withoutOverlays(tab.id, () =>
      captureImage({
        tabId: tab.id, windowId: tab.windowId, sessionId: null, format: settings.imageFormat || 'png',
        quality: settings.imageQuality ?? 92, label: 'Report screenshot', url: tab.url,
      })
    ).catch(() => null);
    if (meta) entry = { tabId: tab.id, id: meta.id, type: meta.type, bytes: meta.bytes };
  }
  await chrome.storage.session.set({ [REPORTER_SHOT]: entry }).catch(() => {});
}

/** The picture taken at open time for this tab, once; null when there is none or it is for another tab. */
async function takeReporterShot(tabId) {
  const got = (await chrome.storage.session.get(REPORTER_SHOT).catch(() => ({})))[REPORTER_SHOT];
  await chrome.storage.session.remove(REPORTER_SHOT).catch(() => {});
  return got && got.tabId === tabId ? got : null;
}

export async function reporterContext() {
  const id = await testableTabId();
  const tab = id == null ? null : await chrome.tabs.get(id).catch(() => null);
  const sessionId = await activeSessionId({ tabId: id });
  const events = sessionId ? await getEvents(sessionId) : [];
  const recent = events.slice(-400);
  const errors = recent.filter((e) => e.kind === 'console' && e.level === 'error' && liteProblem(e)).slice(-3);
  const pageErrors = recent.filter((e) => e.kind === 'pageerror' && liteProblem(e)).slice(-2);
  const failed = [...recent].reverse().find((e) => e.kind === 'net' && e.status >= 400 && liteProblem(e));

  const context = {
    url: tab?.url || '',
    title: tab?.title || '',
    when: new Date().toISOString(),
    env: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.userAgentData?.platform || '',
      viewport: tab?.width && tab?.height ? `${tab.width}x${tab.height}` : '',
    },
    errors: [...errors, ...pageErrors].map((e) => (e.text || '').slice(0, 300)),
    problems: countFindings(events).problems,
    failedRequest: failed ? { method: failed.method, url: failed.url, status: failed.status } : null,
  };
  // The number the page shows: what a person will see attached on their behalf.
  context.details = context.errors.length + (context.failedRequest ? 1 : 0) + Object.values(context.env).filter(Boolean).length;
  return context;
}

/**
 * The report itself: one screenshot, the words, and everything above.
 *
 * Filed into the running session when there is one and into a session of its
 * own when there is not — a person reporting a problem should never be told to
 * start something first. `how` decides only whether it also goes to the
 * configured tracker or chat; saving is always what happens.
 */
export async function reporterFile({ how = 'save', words = '', lang = 'en' }) {
  const said = String(words || '').trim();
  if (!said) throw new Error('Nothing was written to report.');

  const context = await reporterContext();
  const id = await testableTabId();
  const tab = id == null ? null : await chrome.tabs.get(id).catch(() => null);

  let sessionId = await activeSessionId({ tabId: id });
  let ownSession = false;
  if (!sessionId) {
    const started = await startSession({
      charter: said.slice(0, 80),
      tabId: tab?.id,
      startUrl: context.url,
      env: context.env,
    });
    sessionId = started.id;
    ownSession = true;
  }

  // One picture, taken for them. A report with no screenshot is the second
  // commonest reason a developer cannot reproduce anything. It was taken when
  // the reporter opened: now the reporter is the visible tab, and
  // captureVisibleTab would photograph the form instead of the bug.
  const early = await takeReporterShot(tab?.id);
  if (early) {
    await appendEvent({
      sessionId,
      kind: 'screenshot',
      ts: Date.now(),
      captureId: early.id,
      mediaId: early.id,
      imageType: early.type,
      bytes: early.bytes,
      text: said.slice(0, 120),
      frameUrl: context.url,
      tabId: tab.id,
    });
  }
  const shot = early
    ? { captureId: early.id }
    : null;

  await appendEvent({
    sessionId,
    kind: 'note',
    ts: Date.now(),
    tag: 'bug',
    text: said,
    frameUrl: context.url,
    reporter: { lang, ...context, screenshot: !!shot },
  });
  paintBadge();

  let posted = null;
  if (how === 'send') {
    // Whatever is configured: a tracker, a chat destination, or neither, in
    // which case the report is saved and the person is told that plainly.
    posted = await notifyAll({
      sessionId,
      links: {},
      defectOptions: { summary: said.slice(0, 120) },
    }).catch((err) => ({ error: err.message }));
  }
  if (ownSession) await stopSession().catch(() => {});

  return { sessionId, screenshot: !!shot, details: context.details, posted };
}

export async function checkFinePrint({ tabId, commerce = false }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to check.');

  const sessionId = await activeSessionId({ tabId: id });
  const events = sessionId ? await getEvents(sessionId) : [];
  const last = (kind) => [...events].reverse().find((e) => e.kind === kind) || null;
  const links = last('links');
  const harvest = last('harvest');
  const spec = last('spec');
  const a11y = last('a11y');

  /** The page's own words, from every frame it is made of. */
  await ensureScript(id, 'specReader');
  const frames = await testableFrames(id);
  const read = await Promise.all(frames.map(async (frame) => ({
    frame,
    doc: await sendToTab(id, { type: 'UQA_READ_SPEC' }, { frameId: frame.frameId }).catch(() => null),
  })));
  const documents = read.filter((r) => r.doc && !r.doc.error);
  const page = documents[0]?.doc || null;
  const tab = await chrome.tabs.get(id).catch(() => null);

  /** One entry per frame that answered, in the shape core/fine-print.js reads. */
  const frameDocs = documents.map(({ frame, doc }) => ({
    frameId: frame.frameId,
    url: doc.url || frame.url,
    depth: frame.depth,
    page: doc,
  }));
  /** Where a link, a form or a phrase was found, for a row that has to say so. */
  const foundIn = (doc) => (doc.url === page?.url ? null : doc.url);

  /*
   * A row from the link check, told which document it came from.
   *
   * The check folds a link found in several frames into one row and keeps the
   * documents it saw it in. A row that was never in the top document is a link
   * only the embedded page offers, and the fine print has to say so: "there is
   * a privacy policy" and "there is a privacy policy inside the payment widget"
   * are different facts about a site.
   */
  const fromLinkCheck = (row) => {
    const where = Array.isArray(row?.frames) ? row.frames : null;
    if (!where || !page?.url || where.includes(page.url)) return row;
    return { ...row, frameUrl: where[0] };
  };

  const input = {
    page,
    url: page?.url || tab?.url || '',
    firstPartyHost: page?.url || tab?.url || '',
    commerce,
    links: [
      /** `ok` is a COUNT on this event, not a list, and spreading it threw. */
      ...(links?.broken || []).map((l) => ({ ...fromLinkCheck(l), status: l.status || 404 })),
      ...(links?.rows || []).filter((r) => r.state !== 'broken').map(fromLinkCheck),
      // Every frame's links, each carrying the document it was found in. A
      // privacy policy in the footer of an embedded page is still a privacy
      // policy the visitor can reach.
      ...documents.flatMap(({ doc }) =>
        (doc.links || []).map((l) => ({ text: l.label, href: l.href, frameUrl: foundIn(doc) }))),
    ],
    /** Every document this check covered, outermost first. */
    scannedFrames: frameDocs.map((f) => ({ url: f.url, depth: f.depth })),
    frameCount: frameDocs.length,
    consentSeenAt: consentSeenAtFor(events),
    events: events.filter((e) => e.kind === 'cookie' || e.kind === 'storage'),
    forms: (documents.flatMap(({ doc }) => (doc.forms || []).map((f) => ({ ...f, frameUrl: foundIn(doc) })))
      .concat(documents.length ? [] : (harvest?.forms || [])))
      .map((f) => ({
        name: f.name,
        consentText: f.consentText || '',
        frameUrl: f.frameUrl || null,
        fields: (f.fields || []).map((x) => (typeof x === 'number' ? {} : x)),
      })),
    requests: events.filter((e) => e.kind === 'net').map((e) => ({ url: e.url })),
    /*
     * What the server actually sent back, for the six headers on the allow-list.
     *
     * Decision 33. The CSP, HSTS and CORS rows were MANUAL because nothing in
     * the session captured a response header, and the row said so in its own
     * words. These come from `background/security-headers.js`, which watches
     * only while a session is running and keeps only those six, truncated.
     */
    responses: (await secHeaders.restored, secHeaders.snapshot()),
    /*
     * The frames the *session* touched, which is what the third-party embed row
     * has always been about and what `trackingChecks` reads. Deliberately not
     * the same list as `scannedFrames` above: that one is the documents this
     * check just read, and conflating them would turn "the page embeds a
     * tracker" into "the page has frames".
     */
    frames: [...new Set(events.map((e) => e.frameUrl).filter(Boolean))].map((url) => ({ url })),
    text: [
      ...documents.flatMap(({ doc }) => [doc.title, ...(doc.headings || []).map((h) => h.text)]),
      spec?.markdown || '',
    ].filter(Boolean).join(' '),
    a11y: a11y ? { total: a11y.total, violations: a11y.violations } : null,
  };

  const result = await finePrintOp(input);

  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'fineprint',
      ts: Date.now(),
      tabId: id,
      url: input.url,
      counts: result.counts,
      checks: result.checks,
      manual: result.manual,
      markdown: result.markdown,
      frameUrl: input.url,
      frames: input.scannedFrames,
      frameCount: input.frameCount,
    });
    paintBadge();
  }
  return {
    url: input.url,
    counts: result.counts,
    checks: result.checks,
    frames: input.scannedFrames,
    frameCount: input.frameCount,
    stored: !!sessionId,
  };
}

/**
 * When the visitor was asked, if they were.
 *
 * A consent banner is a DOM element nobody labels consistently, so the moment is
 * taken from what the session recorded: the tester dismissing one is a click on
 * a control whose words say what it is. No banner in the walk means no moment,
 * which the check reports as its own kind of finding rather than as a pass.
 */
function consentSeenAtFor(events) {
  const CONSENT = /accept|agree|allow|consent|cookies|got it|أوافق|موافق|قبول|الكوكيز|الارتباط/i;
  const hit = events.find((e) => e.kind === 'dom' && CONSENT.test(`${e.label || ''} ${e.text || ''}`));
  return hit ? hit.ts : null;
}

export async function reverseSpec({ tabId, format = 'markdown' }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to read.');
  // T-043 (G05): every frame asked by id, in parallel, one 6 s budget in all (the first answer to a broadcast
  // was whichever frame replied first). Top frame is the model; the others ride in `frames`; a silent one is a GAP.
  await ensureScript(id, 'specReader');
  const listed = await testableFrames(id);
  const asked = listed.slice(0, 8);
  const reads = await Promise.all(asked.map((f) => Promise.race([
    sendToTab(id, { type: 'UQA_READ_SPEC' }, { frameId: f.frameId }).catch((e) => ({ error: String(e?.message || e) })),
    new Promise((r) => setTimeout(() => r({ error: 'no answer in 6 s' }), 6000)),
  ])));
  const model = reads[0];
  if (!model) throw coded('Reload the tab first. QA Wrap only attaches when a page loads.', 'TAB_RELOAD');
  if (model.error) throw new Error(model.error);
  model.frames = reads.slice(1).map((m, i) => ({ url: asked[i + 1].url, model: m && !m.error ? m : null, why: m?.error || 'no answer' }));
  model.framesCapped = listed.length - asked.length;

  const sessionId = await activeSessionId({ tabId: id });
  const session = sessionId ? await getSession(sessionId) : null;
  const events = sessionId ? await getEvents(sessionId) : [];

  const markdown = await specOp({ model, session, events });

  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'spec',
      ts: Date.now(),
      tabId: id,
      url: model.url,
      title: model.title,
      counts: model.counts,
      format,
      markdown,
      frameUrl: model.url,
    });
    paintBadge();
  }
  return { url: model.url, title: model.title, counts: model.counts, chars: markdown.length, stored: !!sessionId, markdown };
}

/**
 * The page lists its links; this checks them, six at a time, from the worker
 * — the one place that can HEAD a foreign origin. Kept as an event with every
 * row, so the report can show what broke and the export can list it all.
 */
export async function checkLinks(msg = {}) {
  const { tabId } = msg;
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to check.');
  await ensureScript(id, 'links');
  const frames = await testableFrames(id);
  const collected = await Promise.all(frames.map(async (frame) => ({
    frame,
    page: await sendToTab(id, { type: 'UQA_COLLECT_LINKS' }, { frameId: frame.frameId }),
  })));
  const answered = collected.filter((c) => c.page && !c.page.error);
  if (!answered.length) {
    const first = collected[0]?.page;
    if (first?.error) throw new Error(first.error);
    throw coded('Reload the tab first. QA Wrap only attaches when a page loads.', 'TAB_RELOAD');
  }
  const page = answered[0].page;

  // One row per distinct URL across the tab, with the frames it was found in.
  const byHref = new Map();
  for (const { frame, page: doc } of answered) {
    for (const link of doc.links || []) {
      const seen = byHref.get(link.href);
      if (seen) {
        if (!seen.frames.includes(doc.url)) seen.frames.push(doc.url);
        continue;
      }
      byHref.set(link.href, { ...link, frames: [doc.url], frameDepth: frame.depth });
    }
  }
  const links = [...byHref.values()];
  const limit = Math.max(10, Number(msg?.limit) || 250);
  const all = links.map((l, i) => [l, i]).filter(([l]) => linkCheckable(l.href) && !l.hashOnly);
  // Internal links first, then external, up to the limit; the result says "of".
  const todo = [...all.filter(([l]) => l.internal), ...all.filter(([l]) => !l.internal)].slice(0, limit);
  const org = (u) => new URL(u).origin + '/*';
  const run = msg.only ? todo.filter(([l]) => msg.only.includes(org(l.href))) : todo; // a re-check after Allow: only the origins just granted
  const checked = await checkLinksAll(run.map(([l]) => l.href), { concurrency: 10, policy: await policy(), tabUrl: page.url, canRead: (u) => chrome.permissions.contains({ origins: [org(u)] }) });
  recordEgress(ledgerRow('link-check', page.url, '', { findingsCount: 0, scanned: false, count: checked.filter((c) => c && !c.skipped).length })); // D-209: one row per run, a count and the page host
  const results = new Array(links.length);
  const prev = new Map((msg.prev || []).map((r) => [r.href, r]));
  todo.forEach(([l, i]) => { results[i] = prev.get(l.href); });
  run.forEach(([, i], k) => { results[i] = checked[k]; });
  const s = summariseLinks(links, results);

  const summary = {
    url: page.url,
    title: page.title,
    frames: answered.map(({ frame, page: doc }) => ({
      url: doc.url,
      depth: frame.depth,
      links: (doc.links || []).length,
    })),
    frameCount: answered.length,
    total: s.total,
    checked: s.checked,
    checkable: all.length,
    limited: all.length > todo.length,
    ok: s.ok,
    broken: s.broken,
    redirected: s.redirected,
    slow: s.slow,
    skipped: s.skipped.length,
    rows: s.rows,
  };
  const sessionId = await activeSessionId({ tabId: id });
  if (sessionId) {
    await appendEvent({ sessionId, kind: 'links', ts: Date.now(), tabId: id, frameUrl: page.url, ...summary });
    paintBadge();
  }
  return { ...summary, stored: !!sessionId };
}

/** Designed values into every field, and what the browser still rejects. */
export async function autofillPage({ tabId, scope }) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to fill.');
  const result = await sendToFeature(id, 'autofill', { type: 'UQA_AUTOFILL_PAGE', scope });
  if (!result) throw coded('Reload the tab first. QA Wrap only attaches when a page loads.', 'TAB_RELOAD');
  if (result.error) throw new Error(result.error);

  const sessionId = await activeSessionId({ tabId: id });
  if (sessionId) {
    await appendEvent({
      sessionId, kind: 'autofill', ts: Date.now(), tabId: id, frameUrl: result.url,
      filled: result.filled.length, fields: result.filled, skipped: result.skipped, invalid: result.invalid,
    });
    paintBadge();
  }
  return result;
}
