/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * "Check another size", when the session is being recorded.
 *
 *   node tools/test-viewport-resize.mjs
 *
 * ── what this is for ──────────────────────────────────────────────────────
 *
 * The brief asked that a window-size run record like the main session: video if
 * the parent records video, masking if masked. Group G shipped it on 7 Sep with
 * `video` refused for *every* run, because `chrome.tabCapture` will not film a
 * window the extension opened itself. That is true and it was the wrong
 * conclusion: the way to record the run is not to open a window at all.
 *
 * So there are two routes now, and this file is about both of them.
 *
 *   **recording** → the session's own window is resized in place. The capture
 *   already running goes on filming the same tab through the resize, so the run
 *   is a stretch of the clip the tester already has, stamped with the run's id
 *   and viewport on the two `viewport` events. The original bounds go back when
 *   the run closes.
 *
 *   **not recording** → a new window, as before.
 *
 * ── and the arithmetic that was wrong ─────────────────────────────────────
 *
 * The size correction was `spec.width + (spec.width - inner.w)`: the *asked-for*
 * size corrected by the frame, which is only the same as correcting the *actual
 * outer* size when the browser gave exactly what was asked for — the one case
 * needing no correction. Measured in the field: 390 asked, 1426 reported,
 * `390 + (390 - 1426)` = **-646**, thrown straight back at the tester as a
 * Chrome API error; and 768 asked gave 110, which Chrome clamped to about 502
 * while the tool returned `ok: true` with `measured {w:1426}` still attached.
 *
 * The functions are lifted out of the worker rather than reimplemented, because
 * arithmetic copied into a test is arithmetic the test goes on passing about
 * after the shipped code changes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { viewportRuns } from '../core/sessions.js';
import { workerSrc } from './lib-worker-src.mjs';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

const WORKER = workerSrc();
const REPORT = surfaceSource('report/report.js');
/**
 * The English half of the language tables.
 *
 * Two assertions below used to read their sentence out of `report.js`. The
 * sentences are the same and are still said; since the interface became
 * bilingual they live here and the page reaches them by key, so the assertions
 * check the key at the call site and the words at the other end of it.
 */
const EN_TABLE = JSON.parse(read('platform/i18n/en.json'));
const SESSIONS = read('core/sessions.js');
const CONTRACT_PATH = path.join(EXT, 'docs', 'window-sizes-contract.md');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ------------------------------------------------------------- the sandbox */

const LIFTED = [
  'clampWindowSize', 'innerSizeOf', 'fitWindowTo', 'restoreWindowBounds',
  'newRunId', 'inheritanceFor', 'openViewportRun', 'closeViewportRuns',
];

/**
 * The worker's window-size half, run against a browser made of objects.
 *
 * `lift` starts at `function <name>(`, so an `async` in front of the
 * declaration is left behind and has to be put back. `setTimeout` is shadowed
 * with an immediate call: these functions wait for a window to lay out, and
 * this suite is about what they compute and in what order, not about waiting.
 */
/** The two constants the sizing uses, taken from the worker rather than retyped. */
const CONSTS = ['MIN_WINDOW', 'SIZE_TOLERANCE']
  .map((name) => new RegExp(`^const ${name} = .+;$`, 'm').exec(WORKER)?.[0])
  .join('\n');

function sandbox({ chrome, deps }) {
  const source = LIFTED.map(
    (name) => `${WORKER.includes(`async function ${name}(`) ? 'async ' : ''}${lift(WORKER, name)}`
  ).join('\n\n');
  const make = new Function(
    'chrome',
    'deps',
    'viewportRuns',
    `
    const setTimeout = (fn) => fn();
    const {
      maskKey, recordingState, getSession, putSession, rememberSession,
      appendEvent, paintBadge, broadcast, getEvents, viewportEvents, listMedia, lastMediaForRun,
    } = deps;
    ${CONSTS}
    ${source}
    return { ${LIFTED.join(', ')} };
    `
  );
  return make(chrome, deps, viewportRuns);
}

/**
 * A browser with one window, one page, and a memory of what it was asked.
 *
 * `minWidth` is Chrome's own floor, which is about 500 CSS pixels wide on
 * Windows and is the reason a 390-wide phone viewport cannot be had in a real
 * window at all. `frame` is what the chrome around the page eats.
 */
function fakeBrowser({ width = 1200, height = 800, left = 20, top = 30, state = 'normal',
  frame = { w: 16, h: 88 }, minWidth = 0, minHeight = 0, screen = { w: 1920, h: 1080 },
  reportsInner = null } = {}) {
  const win = { id: 7, left, top, width, height, state };
  const updates = [];
  const created = [];
  return {
    win,
    updates,
    created,
    chrome: {
      windows: {
        get: async () => ({ ...win }),
        update: async (id, changes) => {
          updates.push({ id, ...changes });
          if (changes.width != null) win.width = Math.max(minWidth, changes.width);
          if (changes.height != null) win.height = Math.max(minHeight, changes.height);
          if (changes.left != null) win.left = changes.left;
          if (changes.top != null) win.top = changes.top;
          if (changes.state != null) win.state = changes.state;
          return { ...win };
        },
        create: async (opts) => {
          created.push(opts);
          win.width = Math.max(minWidth, opts.width);
          win.height = Math.max(minHeight, opts.height);
          return { ...win, tabs: [{ id: 99 }] };
        },
      },
      scripting: {
        executeScript: async () => [
          {
            result: reportsInner || {
              w: win.width - frame.w,
              h: win.height - frame.h,
              sw: screen.w,
              sh: screen.h,
            },
          },
        ],
      },
    },
  };
}

/** The worker's own dependencies, as objects that remember what they were told. */
function fakeDeps({ masks = [], clip = null, events = [], media = [] } = {}) {
  const session = { id: 's_1', windowIds: [7] };
  const appended = [...events];
  const broadcasts = [];
  return {
    session,
    appended,
    broadcasts,
    deps: {
      maskKey: (id) => `masks:${id}`,
      recordingState: async () => clip,
      getSession: async () => session,
      putSession: async (s) => { Object.assign(session, s); },
      rememberSession: () => {},
      appendEvent: async (e) => { appended.push(e); },
      paintBadge: () => {},
      broadcast: async (b) => { broadcasts.push(b); },
      getEvents: async () => appended,
      viewportEvents: async () => appended, // r10-07-3: the worker reads viewport rows only
      listMedia: async () => media,
      lastMediaForRun: async (_sid, runId) => media.filter((m) => m.runId === runId).at(-1)?.id || null,
    },
    storage: { [`masks:s_1`]: masks },
  };
}

function withStorage(chrome, storage) {
  return {
    ...chrome,
    storage: { session: { get: async (key) => ({ [key]: storage[key] }) } },
  };
}

const SPEC = { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 };
const LAPTOP = { id: 'laptop', label: 'Laptop', width: 768, height: 900 };

/* -------------------------------------------------------------- the sizing */

console.log('the size a window is actually given');

await test('a correction can never send a negative or sub-minimum width to Chrome', async () => {
  const { clampWindowSize } = sandbox({ chrome: {}, deps: {} });
  // The field failure, exactly: 390 asked, 1426 reported, 390 + (390 - 1426).
  assert.deepEqual(clampWindowSize(-646, -200, null), { width: 50, height: 50 });
  assert.deepEqual(clampWindowSize(0, 0, null), { width: 50, height: 50 });
  assert.deepEqual(clampWindowSize(NaN, NaN, null), { width: 50, height: 50 });
  // And never larger than the screen it has to fit on.
  assert.deepEqual(clampWindowSize(9000, 9000, { w: 1920, h: 1080 }), { width: 1920, height: 1080 });
  assert.deepEqual(clampWindowSize(390.4, 844.6, { w: 1920, h: 1080 }), { width: 390, height: 845 });
});

await test('the correction is computed from the real outer size, and lands exactly', async () => {
  const browser = fakeBrowser({ width: 1200, height: 800 });
  const { fitWindowTo } = sandbox({ chrome: browser.chrome, deps: {} });
  const got = await fitWindowTo(7, 99, SPEC);
  assert.deepEqual(got.measured, { w: 390, h: 844 }, 'the page did not end up at the size asked for');
  assert.equal(got.exact, true);
  // Asked once, corrected once. A second correction would be a loop nobody can
  // reason about when a window manager disagrees.
  assert.equal(browser.updates.length, 2, `sent ${browser.updates.length} resizes`);
  assert.deepEqual(
    browser.updates.map((u) => u.width),
    [390, 406],
    'the correction is outer + (asked - inner), not asked + (asked - inner)'
  );
});

await test('a size the browser refuses is reported as the size it gave, not as success', async () => {
  // Chrome will not make a window narrower than about 500 CSS px on Windows.
  const browser = fakeBrowser({ minWidth: 500 });
  const { fitWindowTo } = sandbox({ chrome: browser.chrome, deps: {} });
  const got = await fitWindowTo(7, 99, SPEC);
  assert.equal(got.exact, false, 'a clamped window reported itself as the size that was asked for');
  assert.deepEqual(got.measured, { w: 484, h: 844 }, 'the measurement is not the size Chrome actually gave');
  for (const u of browser.updates) {
    assert.ok(u.width >= 50, `a width of ${u.width} reached windows.update`);
    assert.ok(u.height >= 50, `a height of ${u.height} reached windows.update`);
  }
});

await test('768 lands, and never through the 110 that Chrome clamped to 502', async () => {
  const browser = fakeBrowser({ minWidth: 500 });
  const { fitWindowTo } = sandbox({ chrome: browser.chrome, deps: {} });
  const got = await fitWindowTo(7, 99, LAPTOP);
  assert.deepEqual(got.measured, { w: 768, h: 900 });
  assert.equal(got.exact, true);
  assert.ok(!browser.updates.some((u) => u.width === 110), 'the old arithmetic is back');
});

await test('a measurement larger than the window holding it is thrown away, not corrected from', async () => {
  /*
   * This is where the -646 came from. A page reporting 1426 inside a 390-wide
   * window is not a measurement of that window; correcting from it produced a
   * negative width, and Chrome threw a raw API error at the tester.
   */
  const browser = fakeBrowser({ reportsInner: { w: 1426, h: 700, sw: 1920, sh: 1080 } });
  const { fitWindowTo } = sandbox({ chrome: browser.chrome, deps: {} });
  const got = await fitWindowTo(7, 99, SPEC);
  assert.equal(got.measured, null, 'a measurement of somewhere else was reported as this window');
  assert.equal(got.exact, false, 'an unmeasurable window must not claim the size it asked for');
  assert.equal(browser.updates.length, 1, 'a correction was computed from an untrustworthy reading');
  for (const u of browser.updates) assert.ok(u.width > 0, `${u.width} reached windows.update`);
});

/* --------------------------------------------------------- what is inherited */

console.log('\nwhat a run copies from the session it belongs to');

await test('a resize-in-place run inherits the clip it is happening inside, and refuses nothing', async () => {
  const parts = fakeDeps({ masks: [{ selector: '.pan' }] });
  const { inheritanceFor } = sandbox({
    chrome: withStorage({}, parts.storage),
    deps: parts.deps,
  });
  const got = await inheritanceFor('s_1', {
    mode: 'resized',
    sources: { mic: true, tabAudio: false, webcam: true },
  });
  assert.equal(got.inherited.video, true, 'the run is inside the clip and must say so');
  assert.equal(got.inherited.mask, true, 'masking must inherit on this route too');
  assert.equal(got.inherited.mic, true);
  assert.equal(got.inherited.tabAudio, false);
  assert.deepEqual(got.refused, [], 'nothing was opened twice, so nothing can be refused');
});

await test('a new-window run with a clip running elsewhere still refuses video, by name', async () => {
  const parts = fakeDeps({
    masks: [{ selector: '.pan' }],
    clip: { recording: true, finishing: false, windowId: 42, sources: { webcam: true, mic: true } },
  });
  const { inheritanceFor } = sandbox({ chrome: withStorage({}, parts.storage), deps: parts.deps });
  const got = await inheritanceFor('s_1');
  assert.equal(got.inherited.video, false);
  assert.equal(got.inherited.mask, true, 'masking inherits on this route too');
  assert.deepEqual(got.refused, ['video', 'webcam'], 'the closed set of words, unchanged');
});

await test('a run with no session at all says the mask list is what it could not take', async () => {
  const parts = fakeDeps();
  const { inheritanceFor } = sandbox({ chrome: withStorage({}, parts.storage), deps: parts.deps });
  const got = await inheritanceFor(null);
  assert.deepEqual(got.refused, ['mask']);
  assert.equal(got.inherited.video, false);
});

/* ------------------------------------------------------------ the two events */

console.log('\nwhat the run leaves on the session');

const CLIP = { mediaId: 'm_parent', startedAt: 1_000_000 };
const RESTORE = { left: 20, top: 30, width: 1200, height: 800, state: 'normal' };

async function openResized(extra = {}) {
  const parts = fakeDeps({ masks: [{ selector: '.pan' }], ...extra });
  const browser = fakeBrowser();
  const api = sandbox({ chrome: withStorage(browser.chrome, parts.storage), deps: parts.deps });
  const run = await api.openViewportRun({
    sessionId: 's_1', windowId: 7, tabId: 99, url: 'https://app.test/apply',
    viewport: SPEC, measured: { w: 390, h: 844 }, exact: true,
    mode: 'resized', clip: CLIP, restore: RESTORE,
    sources: { mic: false, tabAudio: true },
  });
  return { api, parts, browser, run };
}

await test('a resized run stamps the runId, the viewport and the place in the clip', async () => {
  const { parts, run } = await openResized();
  const opened = parts.appended.find((e) => e.kind === 'viewport' && e.phase === 'opened');
  assert.ok(opened, 'no opened event was written');
  assert.match(run.id, /^vr_[a-z0-9]+_[a-z0-9]{1,2}$/, '§3 of the contract fixes the runId shape');
  assert.equal(opened.runId, run.id);
  assert.deepEqual(opened.viewport, { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 });
  assert.equal(opened.mode, 'resized');
  assert.equal(opened.exact, true);
  assert.equal(opened.clip.mediaId, 'm_parent');
  assert.equal(opened.clip.offsetMs, opened.ts - CLIP.startedAt, 'the offset into the clip is wrong');
  assert.deepEqual(opened.restore, RESTORE, 'nothing knows what to put the window back to');
  assert.equal(opened.inherited.video, true);
  assert.equal(opened.inherited.mask, true);
});

await test('the run travels through the fold the report reads', async () => {
  const { parts, run } = await openResized();
  const [folded] = viewportRuns(parts.appended);
  assert.equal(folded.runId, run.id);
  assert.equal(folded.mode, 'resized');
  assert.equal(folded.exact, true);
  assert.equal(folded.clip.mediaId, 'm_parent');
  assert.equal(folded.closedAt, null);
});

await test('closing a resized run puts the window back and says where the clip ended', async () => {
  const { api, parts, browser } = await openResized();
  browser.win.width = 406;
  browser.win.height = 932;
  const closed = await api.closeViewportRuns({ sessionId: 's_1', windowId: 7, reason: 'closed' });
  assert.equal(closed, 1);
  assert.deepEqual(
    browser.updates.at(-1),
    { id: 7, left: 20, top: 30, width: 1200, height: 800 },
    'the window was not put back the way the tester had it'
  );
  const ev = parts.appended.find((e) => e.kind === 'viewport' && e.phase === 'closed');
  assert.equal(ev.mode, 'resized');
  assert.equal(ev.mediaId, null, "the session's own clip must not be claimed by the run");
  assert.equal(ev.clip.endOffsetMs, ev.ts - CLIP.startedAt);
  const [folded] = viewportRuns(parts.appended);
  assert.ok(folded.closedAt, 'the fold still shows the run as open');
  assert.equal(folded.clip.mediaId, 'm_parent', 'the close erased where the run was in the clip');
});

await test('a second size on the same window replaces the first and keeps the original bounds', async () => {
  const { api, parts, browser } = await openResized();
  const first = parts.appended.filter((e) => e.phase === 'opened').length;
  await api.openViewportRun({
    sessionId: 's_1', windowId: 7, tabId: 99, url: 'https://app.test/apply',
    viewport: LAPTOP, measured: { w: 768, h: 900 }, exact: true,
    mode: 'resized', clip: CLIP,
    // A second run knows only the bounds it found, which are the first run's.
    restore: { left: 20, top: 30, width: 406, height: 932, state: 'normal' },
    sources: {},
  });
  const opens = parts.appended.filter((e) => e.phase === 'opened');
  const closes = parts.appended.filter((e) => e.phase === 'closed');
  assert.equal(opens.length, first + 1);
  assert.equal(closes.length, 1, 'the earlier run was left open on the same window');
  assert.deepEqual(
    opens.at(-1).restore,
    RESTORE,
    'checking three sizes in a row would restore to the second one'
  );
  assert.ok(
    !browser.updates.some((u) => u.width === 1200),
    'the window was bounced back through the original size on the way to the next one'
  );
  const open = viewportRuns(parts.appended).filter((r) => !r.closedAt);
  assert.equal(open.length, 1, 'two runs are open on one window');
});

await test('a run that opened its own window has nothing to restore', async () => {
  const parts = fakeDeps({ masks: [] });
  const browser = fakeBrowser();
  const api = sandbox({ chrome: withStorage(browser.chrome, parts.storage), deps: parts.deps });
  await api.openViewportRun({
    sessionId: 's_1', windowId: 12, tabId: 99, url: 'https://app.test/',
    viewport: SPEC, measured: { w: 390, h: 844 }, exact: true, mode: 'window',
  });
  const before = browser.updates.length;
  await api.closeViewportRuns({ sessionId: 's_1', windowId: 12, reason: 'closed' });
  assert.equal(browser.updates.length, before, 'a window that is already gone was resized');
  const ev = parts.appended.find((e) => e.phase === 'closed');
  assert.equal(ev.mode, 'window');
  assert.equal(ev.clip, null);
});

await test('the session is widened to cover the run, or nothing in it is recorded', async () => {
  const { parts } = await openResized();
  assert.ok(parts.session.windowIds.includes(7));
});

/* ------------------------------------------------- the route, and the report */

console.log('\nthe two routes, and where the evidence lands');

await test('the worker resizes in place only while a clip is filming this window', async () => {
  const at = WORKER.indexOf('UQA_OPEN_VIEWPORT: async (msg) => {');
  assert.ok(at > -1, 'the handler is gone');
  const body = WORKER.slice(at, WORKER.indexOf('UQA_RESTORE_WINDOW_SIZE', at));
  assert.match(
    body,
    /clip\.windowId === tab\.windowId/,
    'the route is chosen without checking that the clip is filming this window'
  );
  assert.match(body, /if \(resizeInPlace\) \{/, 'there is no resize route');
  const createAt = body.indexOf('chrome.windows.create(');
  assert.ok(createAt > body.indexOf('if (resizeInPlace)'), 'a window is created before the route is chosen');
  assert.match(body, /mode: 'resized'/);
  assert.match(body, /mode: 'window'/);
});

await test('both routes go through the one measuring function', async () => {
  const at = WORKER.indexOf('UQA_OPEN_VIEWPORT: async (msg) => {');
  const body = WORKER.slice(at, WORKER.indexOf('UQA_RESTORE_WINDOW_SIZE', at));
  assert.equal(
    (body.match(/await fitWindowTo\(/g) || []).length,
    2,
    'one of the two routes measures its own way, so they can disagree'
  );
  const fit = WORKER.slice(WORKER.indexOf('async function fitWindowTo('), WORKER.indexOf('const browserHandlers'));
  assert.match(
    fit,
    /outer\.width \+ \(spec\.width - inner\.w\)/,
    'the correction is not computed from the window that actually exists'
  );
  // The old line, as code rather than as the note above it that explains it.
  assert.ok(
    !/^\s*spec\.width \+ \(spec\.width - inner\.w\),?$/m.test(fit),
    'the arithmetic that produced -646 is back'
  );
});

await test('a window this extension opened is never allowed to claim a resized run', async () => {
  const at = WORKER.indexOf('async function runForWindow(');
  const body = WORKER.slice(at, WORKER.indexOf('function newRunId(', at));
  assert.match(
    body,
    /\(r\.mode \|\| 'window'\) === 'window'/,
    "a clip started in the session's own window would be moved out of Screens & video"
  );
});

await test('the report points into the session clip rather than claiming it', async () => {
  // The sentence moved into platform/i18n/en.json when the interface became
  // bilingual; the report now reaches it by key. Both halves are asserted, so
  // neither the key nor the words can quietly go.
  assert.match(REPORT, /t\('report\.sizes\.inClip/, 'the report no longer reaches for the in-clip sentence');
  assert.match(EN_TABLE['report.sizes.inClipTo'] || '', /^Recorded in the session clip, from \{from\}/);
  assert.match(REPORT, /lightbox\(clip\.id, clip\.type \|\| 'video\/webm', \{ seekMs: run\.clip\.offsetMs \|\| 0 \}\)/);
  // One clip, one home: the gallery still filters on runId, and a resized run
  // never stamps one onto the session's own clip.
  assert.match(REPORT, /const ownMedia = \(\) => media\.filter\(\(m\) => !m\.runId\);/);
  assert.match(REPORT, /const runMedia = \(runId\) => media\.filter\(\(m\) => m\.runId === runId\);/);
});

await test('the report says so when the browser would not give the size', async () => {
  assert.match(REPORT, /run\.exact === false/);
  assert.match(REPORT, /t\('report\.sizes\.notExact'/, 'the report no longer reaches for the refused-size sentence');
  assert.match(EN_TABLE['report.sizes.notExact'] || '', /This was not tested at that size\./);
});

await test('the popup says which window it is talking about, and what size it really got', async () => {
  const POPUP = surfaceSource('popup/popup.js');
  assert.match(POPUP, /This window is now \$\{v\.label\}/, 'a resize is still announced as a new window');
  assert.match(POPUP, /function sizeNote\(result\)/);
  assert.match(POPUP, /Browser gave \$\{got\.w\}×\$\{got\.h\}, not \$\{asked\}/);
  assert.match(POPUP, /out\?\.exact === false \? 'err' : 'ok'/, 'a refused size is painted as a success');
  assert.match(POPUP, /UQA_RESTORE_WINDOW_SIZE/, 'there is no way back out of a resized window');
});

await test('the fold carries the new fields, and treats an old event as a window', async () => {
  assert.match(SESSIONS, /mode: e\.mode \|\| 'window'/);
  assert.match(SESSIONS, /exact: e\.exact !== false/, 'a run from before this existed must not read as a failure');
  const [old] = viewportRuns([
    { kind: 'viewport', phase: 'opened', ts: 5, runId: 'vr_old_1a', windowId: 3, viewport: SPEC },
  ]);
  assert.equal(old.mode, 'window');
  assert.equal(old.exact, true);
  assert.equal(old.clip, null);
});

await test('the contract records the rule the code follows', async () => {
  const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
  assert.match(contract, /8 September 2026/, '§11 does not record the amendment');
  assert.match(contract, /resize/i, "§5's video row still says a run can never be recorded");
  // The closed set of refusal words is unchanged.
  for (const word of ['webcam', 'mic', 'video', 'mask']) {
    assert.ok(contract.includes(`\`${word}\``), `${word} left the closed set`);
  }
});

await test('ui-1016 L: a new window the extension has no host grant for is still measured (tab width and height), so a refused 390 says what it got', () => {
  const fn = WORKER.slice(WORKER.indexOf('async function innerSizeOf'), WORKER.indexOf('async function fitWindowTo'));
  assert.match(fn, /chrome\.scripting[\s\S]*\.catch\(\(\) => null\)[\s\S]*chrome\.tabs\.get\(tabId\)\.then\(\(t\) => \(\{ w: t\.width, h: t\.height/,
    'innerSizeOf falls back to chrome.tabs.get width/height, which need no host permission');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
