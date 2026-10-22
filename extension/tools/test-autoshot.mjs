/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * AUTO-4 (worker half): the screenshot on the first error of each kind. The page only asks (UQA_SHOT_AUTO);
 * `remember.autoShot` re-checks everything, and the capture itself asks again right before Chrome photographs and
 * again before the picture is kept (D2, tested on the real captureScreenshot lifted from the worker).
 *
 *   node tools/test-autoshot.mjs
 *
 * Plain Node against a chrome stub. Also holds the key parity: the content script's `kindKey` mirror and
 * `core/dupes.js` `dupeKey` give the same key for the same events.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as remember from '../background/remember.js';
import * as realSite from '../background/site-access.js';
import { dupeKey } from '../core/dupes.js';
import { lift } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const PATTERN = 'https://shop.example.com/*';
const KEY = 'net|POST|shop.example.com/api/orders|500';

/**
 * Two windows: A (id 1, tab 10, the sender) and B (id 2, tab 20, a decoy). `focusedWin` is the focused window.
 * Everything the worker re-checks is a knob.
 */
function rig(o = {}) {
  const { shotSites = [PATTERN], armedNow = true, allowed = true, consent = true, live = 'S1', active = true, focusedWin = 1, state, dot = true, pageIndicator, settingsDot } = o;
  const session = { autoShotState: state };
  const calls = { shots: [], set: [] };
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({ autoShotSites: shotSites, ...(pageIndicator === undefined ? {} : { pageIndicator }) }) },
      session: {
        get: async (k) => (session[k] === undefined ? {} : { [k]: session[k] }),
        set: async (v) => { calls.set.push(v); Object.assign(session, v); },
      },
    },
    tabs: { get: async (id) => ({ id, windowId: id === 10 ? 1 : 2, url: 'https://shop.example.com/cart', active }) },
    windows: { get: async (id) => ({ id, focused: id === focusedWin }) },
  };
  const deps = {
    site: { SITE_SCRIPTS: dot ? realSite.SITE_SCRIPTS : [], originPattern: realSite.originPattern, hasSiteAccess: async () => allowed },
    armed: { consentCurrent: async () => consent, isArmedWindow: async () => armedNow },
    live: async (w) => (w === 1 ? live : null),
    shot: async (tab, key) => { calls.shots.push({ tab: tab.id, windowId: tab.windowId, key }); return { captureId: 'm1' }; },
    ...(settingsDot === undefined ? {} : { dotOn: async () => settingsDot }),
  };
  const ask = (key = KEY, sender = { tab: { id: 10 }, frameId: 0 }) => remember.autoShot({ type: 'UQA_SHOT_AUTO', key, what: 'POST /api/orders 500' }, sender, deps);
  return { ask, calls, session };
}

console.log('auto-screenshot (AUTO-4)');

await test('(a) off by default: an empty or missing list never captures', async () => {
  for (const shotSites of [null, []]) {
    const r = rig({ shotSites });
    assert.deepEqual(await r.ask(), { ok: false, reason: 'off' });
    assert.equal(r.calls.shots.length, 0);
  }
});

await test('(b) the active, focused, allowed tab: exactly one capture, none for the same kind again', async () => {
  const r = rig();
  assert.deepEqual(await r.ask(), { ok: true });
  assert.deepEqual(r.calls.shots, [{ tab: 10, windowId: 1, key: KEY }]);
  const second = await r.ask(KEY);
  assert.equal(second.ok, false);
  assert.equal(r.calls.shots.length, 1);
});

await test('(c) decoy: the focus asked about is the sender tab\'s own window, so a focused window B never lends its pixels', async () => {
  const r = rig({ focusedWin: 2 });
  assert.deepEqual(await r.ask(), { ok: false, reason: 'unfocused' });
  assert.equal(r.calls.shots.length, 0);
});

await test('(c) the capture is aimed at the sender\'s tab and window, never at another', async () => {
  const r = rig();
  await r.ask();
  assert.equal(r.calls.shots[0].tab, 10);
  assert.equal(r.calls.shots[0].windowId, 1);
});

await test('(d) a background tab, no live session, a sleeping window, no access, no consent, a sub-frame: none', async () => {
  const cases = [
    [{ active: false }, 'inactive'],
    [{ live: null }, 'inactive'],
    [{ armedNow: false }, 'asleep'],
    [{ allowed: false }, 'off'],
    [{ consent: false }, 'off'],
    [{ dot: false }, 'off'],
    [{ pageIndicator: false }, 'off'], // D3: the dot switched off in Settings (the local key)
    [{ settingsDot: false }, 'off'], // D3: the same switch in the settings object
    [{ shotSites: ['https://other.example.com/*'] }, 'off'],
  ];
  for (const [o, reason] of cases) {
    const r = rig(o);
    assert.deepEqual(await r.ask(), { ok: false, reason }, JSON.stringify(o));
    assert.equal(r.calls.shots.length, 0);
  }
  const sub = rig();
  assert.equal((await sub.ask(KEY, { tab: { id: 10 }, frameId: 4 })).ok, false);
  assert.equal((await sub.ask(KEY, {})).ok, false);
  assert.equal((await sub.ask('x'.repeat(201))).ok, false);
  assert.equal(sub.calls.shots.length, 0);
});

await test('(e) rate: a second kind inside 20 s is refused, after 20 s it is taken', async () => {
  const r = rig({ state: { S1: { n: 1, lastAt: Date.now() - 5e3, keys: [KEY] } } });
  assert.deepEqual(await r.ask('net|GET|shop.example.com/api/cart|404'), { ok: false, reason: 'rate' });
  const later = rig({ state: { S1: { n: 1, lastAt: Date.now() - 21e3, keys: [KEY] } } });
  assert.deepEqual(await later.ask('net|GET|shop.example.com/api/cart|404'), { ok: true });
});

await test('(e) cap: the 11th image of a session is refused', async () => {
  const r = rig({ state: { S1: { n: 10, lastAt: Date.now() - 60e3, keys: Array.from({ length: 10 }, (_, i) => `k${i}`) } } });
  assert.deepEqual(await r.ask('fresh'), { ok: false, reason: 'cap' });
  assert.equal(r.calls.shots.length, 0);
});

await test('two asks at once take one capture (the checks and the count are serial)', async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.ask(KEY), r.ask('net|GET|shop.example.com/api/cart|404')]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(r.calls.shots.length, 1);
});

await test('the state kept per session is { n, lastAt, keys }; keys holds a short hash, never the page-built key (D9)', async () => {
  const r = rig();
  await r.ask();
  const st = r.session.autoShotState.S1;
  assert.equal(st.n, 1);
  assert.equal(st.keys.length, 1);
  assert.match(st.keys[0], /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(r.session).includes('shop.example.com/api'), 'the raw key is not in session storage');
  assert.ok(Date.now() - st.lastAt < 5e3);
});

await test('D9: a key carrying a token is stored masked, and the same kind is still recognised after the rate window', async () => {
  const secret = 'console|error|bearer eyJhbGciOiJIUzI1NiJ9.SECRETPART';
  const r = rig();
  assert.deepEqual(await r.ask(secret), { ok: true });
  assert.ok(!JSON.stringify(r.session).includes('SECRETPART'));
  r.session.autoShotState.S1.lastAt = Date.now() - 60e3;
  assert.deepEqual(await r.ask(secret), { ok: false, reason: 'rate' });
  assert.equal(r.calls.shots.length, 1);
});

/* ── D2: the real captureScreenshot + withoutOverlays lifted from the worker, driven by the real remember.autoShot ── */
const sw = workerSrc();
/**
 * `hooks.onHide` runs while the page's overlays are being hidden (the slow round trip); `hooks.onCapture` runs inside the
 * photograph itself. Each changes the tab, the window focus or the url, the way a tester would.
 */
function realCapture(hooks = {}) {
  const world = { tab: { id: 10, windowId: 1, url: 'https://shop.example.com/cart', active: true }, focused: 1, captured: 0, appended: [], deleted: [], hides: [], state: undefined };
  const chromeStub = {
    storage: {
      local: { get: async () => ({ autoShotSites: [PATTERN] }) },
      session: { get: async (k) => (k === 'autoShotState' && world.state ? { autoShotState: world.state } : {}), set: async (v) => { if (v.autoShotState) world.state = v.autoShotState; } },
    },
    tabs: { get: async () => ({ ...world.tab }) },
    windows: { get: async (id) => ({ id, focused: id === world.focused }) },
  };
  globalThis.chrome = chromeStub;
  const sendToTab = async (_id, msg) => { world.hides.push(msg.hidden); if (msg.hidden) await hooks.onHide?.(world); return null; };
  const captureImage = async () => { world.captured++; await hooks.onCapture?.(world); return { id: `m${world.captured}`, type: 'image/png', bytes: 9 }; };
  const body = `async ${lift(sw, 'withoutOverlays')}\nasync ${lift(sw, 'captureScreenshot')}\nreturn captureScreenshot;`;
  const captureScreenshot = new Function('chrome', 'sendToTab', 'overlayHiders', 'activeSessionId', 'getSettings', 'captureImage', 'appendEvent', 'deleteMedia', 'paintBadge', body)(
    chromeStub, sendToTab, new Map(), async () => 'S1', async () => ({ imageFormat: 'png' }), captureImage,
    async (ev) => { world.appended.push(ev); }, async (id) => { world.deleted.push(id); }, () => {});
  const deps = {
    site: { SITE_SCRIPTS: realSite.SITE_SCRIPTS, originPattern: realSite.originPattern, hasSiteAccess: async (u) => /^https:\/\/shop\.example\.com\//.test(u) },
    armed: { consentCurrent: async () => true, isArmedWindow: async () => true },
    live: async (w) => (w === 1 ? 'S1' : null),
    shot: (t, key, guard) => captureScreenshot({ text: 'Auto screenshot on first error', tabId: t.id, extra: { auto: true, forKey: key }, guard }),
  };
  const ask = () => remember.autoShot({ type: 'UQA_SHOT_AUTO', key: KEY }, { tab: { id: 10 }, frameId: 0 }, deps);
  return { world, ask };
}

await test('D2 real path: nothing moves: one picture is taken and kept, and the overlays come back', async () => {
  const r = realCapture();
  assert.deepEqual(await r.ask(), { ok: true });
  assert.equal(r.world.captured, 1);
  assert.equal(r.world.appended.length, 1);
  assert.equal(r.world.appended[0].auto, true);
  assert.deepEqual(r.world.hides, [true, false]);
});
const flips = {
  'the tester switches to another tab': (w) => { w.tab.active = false; },
  'the tester moves to another window': (w) => { w.focused = 2; },
  'the tab navigates to another site': (w) => { w.tab.url = 'https://bank.example.org/account'; },
  'the tab navigates to a look-alike origin': (w) => { w.tab.url = 'https://shop.example.com.evil.test/cart'; },
  'the tab is dragged into another window': (w) => { w.tab.windowId = 2; },
};
for (const [name, flip] of Object.entries(flips)) {
  await test(`D2 real path: ${name} while the overlays hide: Chrome is never asked to photograph, nothing is stored`, async () => {
    const r = realCapture({ onHide: flip });
    assert.equal((await r.ask()).ok, false);
    assert.equal(r.world.captured, 0, 'captureVisibleTab was not reached');
    assert.equal(r.world.appended.length, 0);
    assert.deepEqual(r.world.hides, [true, false], 'the overlays still come back');
  });
  await test(`D2 real path: ${name} during the capture: the picture is deleted and no event is written`, async () => {
    const r = realCapture({ onCapture: flip });
    assert.equal((await r.ask()).ok, false);
    assert.equal(r.world.captured, 1);
    assert.deepEqual(r.world.deleted, ['m1']);
    assert.equal(r.world.appended.length, 0);
  });
}

/* ── wiring in the worker ── */
await test('wiring: the handler, the content-script allow-list, and the capture reuse captureScreenshot with auto + forKey', () => {
  assert.match(sw, /UQA_SHOT_AUTO: \(msg, sender\) => remember\.autoShot\(msg, sender, autopilot\)/);
  const allow = sw.slice(sw.indexOf('const CONTENT_SCRIPT_TYPES'), sw.indexOf('async function guardSender'));
  assert.match(allow, /'UQA_SHOT_AUTO'/);
  assert.match(sw, /captureScreenshot\(\{ text: 'Auto screenshot on first error', tabId: t\.id, extra: \{ auto: true, forKey: key \}, guard \}\)/);
  assert.match(sw, /dotOn: async \(\) => \(await getSettings\(\)\)\.pageIndicator !== false/, 'the settings-object half of the dot switch reaches the gate (D3)');
  assert.match(sw, /\n      \.\.\.extra,\n/);
});
await test('the screenshot event\'s forKey is scrubbed with the other text fields and auto is structural', () => {
  assert.match(sw, /const SCRUB_EXTRA_TEXT = \[[^\]]*'forKey'\]/);
  assert.match(sw, /const SCRUB_STRUCTURAL = \[[^\]]*'auto'\]/);
});

/* ── key parity: content/autopilot.js kindKey vs core/dupes.js dupeKey ── */
await test('key parity: the page mirror gives the same key as dupeKey for the same events', () => {
  const window = { top: null, UQABridge: { tap() {}, watch() {}, emit() {}, send() {}, state: () => ({}), refreshSettings() {} } };
  window.top = window;
  const sandbox = { window, module: {}, chrome: { runtime: { id: 'x', onMessage: { addListener() {} } } }, document: { visibilityState: 'hidden', hasFocus: () => false, addEventListener() {} }, URL, console, setInterval() {}, setTimeout() {}, clearTimeout() {}, location: { href: 'https://shop.example.com/' } };
  vm.runInNewContext(fs.readFileSync(path.join(EXT, 'content', 'autopilot.js'), 'utf8'), sandbox);
  const kindKey = window.__qawKindKey || window.UQAAutopilot?.kindKey;
  assert.equal(typeof kindKey, 'function', 'the mirror is reachable');
  const events = [
    { kind: 'net', method: 'post', url: 'https://shop.example.com/api/orders/12345?x=1&b=2', frameUrl: 'https://shop.example.com/cart', status: 500 },
    { kind: 'net', method: 'GET', url: 'https://shop.example.com/api/items/3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', frameUrl: 'https://shop.example.com/', status: 404 },
    { kind: 'net', url: 'https://shop.example.com/x', frameUrl: 'https://shop.example.com/', status: 0, error: true, en: 'timeout' },
    { kind: 'console', level: 'error', text: 'Failed to load item 4521 for user 77', src: 'https://shop.example.com/app.js:10' },
    { kind: 'pageerror', text: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at run (https://shop.example.com/app.js:42:13)' },
    { kind: 'pageerror', text: 'Boom' },
  ];
  for (const ev of events) assert.equal(kindKey(ev), dupeKey(ev), JSON.stringify(ev));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
