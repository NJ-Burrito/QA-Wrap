/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Sleep means shutdown, and this is the proof.
 *
 *   node tools/test-sleep.mjs
 *
 * The claim on the store listing, in `background/armed.js` and in the brief
 * (G1) is absolute: **when asleep the extension cannot see, modify or work in
 * any way — no content script active, no listener, no hook, no storage write.**
 * Until now the strongest thing the product could show for that was a boolean:
 * `content/page-hooks.js` was declared in the manifest, so `fetch` and
 * `XMLHttpRequest` were replaced in every frame of every page anybody opened,
 * and the wrappers checked a flag before reporting anything.
 *
 * That is "inert", and inert is not absent. A wrapped `fetch` is a hook whose
 * behaviour a page can detect, whose cost a page pays at `document_start`, and
 * whose presence a store reviewer reads as instrumentation of every site. So
 * the hooks are now registered when the first window wakes and unregistered
 * when the last one sleeps, and this file holds the three things that can go
 * wrong with that:
 *
 *   1. **The manifest quietly declares them again** — the refcount is then
 *      irrelevant, because Chrome puts the script in whatever `armed.js` says.
 *   2. **The refcount is a toggle** — one of two armed windows sleeps and the
 *      other loses its hooks, or the last one sleeps and the hooks stay.
 *   3. **The wrappers report while asleep** — the belt behind the braces. Even
 *      with the hooks absent, a page that had them injected before the tester
 *      pressed Sleep is still running them until it navigates, so the flag must
 *      still hold. This is the "arm the hooks, sleep, assert nothing fires"
 *      test the brief asks for, run against the real file in a fake page.
 *
 * Plain Node, no browser: `content/page-hooks.js` is an IIFE over `window`,
 * `console` and `performance`, so a fake page is enough to run the real code —
 * and a test that needs no browser is a test that runs on every commit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

/**
 * One case at a time, deliberately.
 *
 * Half of these swap `globalThis.chrome` for a fake of their own, and a suite
 * that starts every case at once would have them reading each other's fake —
 * which is a failure in the test and looks exactly like a failure in the
 * product. `queue` keeps the tail; nothing here is slow enough for the
 * serialisation to cost anything.
 */
let queue = Promise.resolve();

function test(name, fn) {
  queue = queue.then(() =>
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  ok  ${name}`);
      })
      .catch((err) => {
        failures.push(name);
        console.log(`  FAIL  ${name}\n        ${err.message}`);
      })
  );
}

/* ─────────────────────────────────────────────── 1. the manifest ───────── */

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const declaredScripts = new Set((manifest.content_scripts || []).flatMap((c) => c.js || []));

console.log('sleep — the MAIN-world hooks are not in the manifest');

test('content/page-hooks.js is not a declared content script', () => {
  assert.ok(
    !declaredScripts.has('content/page-hooks.js'),
    'declaring it patches fetch and XHR in every frame of every page while the extension is asleep. ' +
      'background/armed.js registers it at wake and unregisters it at sleep instead.'
  );
});

test('no declared content script runs in the MAIN world', () => {
  // The ISOLATED ones are cheap and see nothing the page can hide; a MAIN-world
  // script shares the page's context and is visible to the page and to every
  // other extension in the tab (research/51a §7).
  const main = (manifest.content_scripts || []).filter((c) => c.world === 'MAIN');
  assert.deepEqual(main, [], 'a MAIN-world content script must be registered at wake time, not declared');
});

test('the file it registers is in the package', () => {
  assert.ok(fs.existsSync(path.join(EXT, 'content/page-hooks.js')));
});

test('nothing may connect to this extension from outside it', () => {
  // Another extension's sendMessage/connect lands only on onMessageExternal /
  // onConnectExternal, never on the handler table (research/51d §7). So the
  // guarantee is "no external listener", not a manifest key: an empty
  // `externally_connectable` is a warning on the card in Chrome ("specifies
  // neither 'matches' nor 'ids'"), and any id or match would open a door.
  const ec = manifest.externally_connectable;
  assert.ok(!ec || (!(ec.ids || []).length && !(ec.matches || []).length), 'externally_connectable must open nothing');
  const src = (d) => fs.readdirSync(path.join(EXT, d), { recursive: true })
    .filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(EXT, d, f), 'utf8')).join('\n');
  assert.doesNotMatch(src('background') + src('core'), /on(Message|Connect)External/, 'no external listener');
});

/* ─────────────────────────────────── 2. the refcount in armed.js ───────── */

/**
 * `background/armed.js` against a fake `chrome`.
 *
 * Loaded fresh per case so the module's in-memory `goingToSleep` set does not
 * leak between them, and imported with a cache-busting query for the same
 * reason.
 */
/**
 * @param {string[]} [origins] what the tester has allowed this extension into.
 *   Defaults to everything, which is the state every case below was written in
 *   and, since decision 8, the state a tester reaches by pressing "All sites"
 *   rather than the one they install into. The empty case has a case of its own
 *   at the end of this group, because it is the new one.
 */
async function loadArmed(origins = ['<all_urls>']) {
  const session = new Map();
  const calls = { register: [], unregister: [], executed: [], update: [] };
  let registered = [];

  /*
   * `onChanged` is part of the stub because it is part of the contract.
   *
   * `background/armed.js` caches the armed set and invalidates it on
   * `chrome.storage.session.onChanged`, which a real browser fires for every
   * write from every context. A stub that stored without announcing would make
   * the cache look stale in a test and correct in the product, which is the
   * wrong way round for a stub to be wrong.
   */
  const changeListeners = [];
  const announce = (obj) => {
    const changes = Object.fromEntries(Object.keys(obj).map((k) => [k, { newValue: obj[k] }]));
    for (const fn of changeListeners) fn(changes, 'session');
  };

  globalThis.chrome = {
    runtime: { id: 'qawrap-test', getURL: (p) => `chrome-extension://qawrap-test/${p}` },
    storage: {
      session: {
        get: async (key) => ({ [key]: session.get(key) }),
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) session.set(k, v);
          announce(obj);
        },
        remove: async (key) => { session.delete(key); announce({ [key]: undefined }); },
        onChanged: { addListener: (fn) => changeListeners.push(fn) },
      },
    },
    tabs: {
      get: async () => null,
      query: async () => [],
      onRemoved: { addListener() {} },
      onAttached: { addListener() {} },
      onDetached: { addListener() {} },
      onReplaced: { addListener() {} },
    },
    windows: { onRemoved: { addListener() {} } },
    /*
     * Part of the stub since 8 September 2026, because it is part of the
     * contract.
     *
     * `<all_urls>` is an optional host permission now (decision 8), and
     * `chrome.scripting.registerContentScripts` refuses any match pattern
     * outside the granted set. So `background/armed.js` asks
     * `background/site-access.js` what it may register on, and a stub with no
     * `permissions` at all would make the hooks look unregisterable in a test
     * and registrable in the product.
     */
    permissions: {
      getAll: async () => ({ permissions: [], origins: [...origins] }),
      contains: async ({ origins: wanted = [] }) =>
        wanted.every((o) => origins.includes(o) || origins.includes('<all_urls>')),
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => registered.filter((s) => ids.includes(s.id)),
      registerContentScripts: async (specs) => {
        calls.register.push(specs);
        registered = [...registered, ...specs];
      },
      updateContentScripts: async (specs) => {
        calls.update.push(specs);
        registered = registered.map((s) => specs.find((n) => n.id === s.id) || s);
      },
      unregisterContentScripts: async ({ ids }) => {
        calls.unregister.push(ids);
        registered = registered.filter((s) => !ids.includes(s.id));
      },
      executeScript: async (opts) => { calls.executed.push(opts); return []; },
    },
  };

  const mod = await import(`../background/armed.js?sleep=${Math.random()}`);
  // The worker calls this once at the top level; it is what registers the two
  // cache invalidations as well as the window watcher.
  mod.watchWindows();
  return { armed: mod, calls, isRegistered: () => registered.length > 0 };
}

console.log('\nsleep — the hooks follow the arming, refcounted');

test('waking the first window registers the hooks', async () => {
  const { armed, calls, isRegistered } = await loadArmed();
  assert.equal(isRegistered(), false, 'nothing is registered before anybody wakes');
  await armed.arm(1);
  assert.equal(calls.register.length, 1);
  assert.equal(isRegistered(), true);
});

test('the registration is MAIN world, document_start, all frames', async () => {
  const { armed, calls } = await loadArmed();
  await armed.arm(1);
  const [spec] = calls.register[0];
  assert.equal(spec.world, 'MAIN');
  assert.equal(spec.runAt, 'document_start');
  assert.equal(spec.allFrames, true);
  assert.deepEqual(spec.js, ['content/page-hooks.js']);
});

test('the registration does not survive a browser restart', async () => {
  // Arming lives in chrome.storage.session, which the browser wipes on close.
  // A registration that persisted would hook every page on the next launch
  // with the switch reading "Asleep".
  const { armed, calls } = await loadArmed();
  await armed.arm(1);
  assert.equal(calls.register[0][0].persistAcrossSessions, false);
});

test('waking a second window registers nothing new', async () => {
  const { armed, calls } = await loadArmed();
  await armed.arm(1);
  await armed.arm(2);
  assert.equal(calls.register.length, 1, 'one registration serves every armed window');
});

test('sleeping one of two windows leaves the hooks alone', async () => {
  const { armed, calls, isRegistered } = await loadArmed();
  await armed.arm(1);
  await armed.arm(2);
  await armed.disarm(1);
  assert.deepEqual(calls.unregister, [], 'window 2 is still awake and still needs them');
  assert.equal(isRegistered(), true);
});

test('sleeping the last window unregisters them', async () => {
  const { armed, calls, isRegistered } = await loadArmed();
  await armed.arm(1);
  await armed.arm(2);
  await armed.disarm(1);
  await armed.disarm(2);
  assert.deepEqual(calls.unregister, [['uqa-page-hooks', 'uqa-site-start-heavy', 'uqa-site-idle-heavy']]); // T-075: heavy page scripts leave with the hooks
  assert.equal(isRegistered(), false, 'asleep everywhere means nothing of ours is in any page');
});

test('disarmAll unregisters them', async () => {
  const { armed, isRegistered } = await loadArmed();
  await armed.arm(7);
  await armed.disarmAll();
  assert.equal(isRegistered(), false);
});

test('waking injects into the tabs already open in that window', async () => {
  const { armed, calls } = await loadArmed();
  chrome.tabs.query = async ({ windowId }) =>
    windowId === 4 ? [{ id: 11, url: 'https://app.test/' }, { id: 12, url: 'chrome://settings' }] : [];
  await armed.arm(4);
  // Registration only reaches the next navigation, so the page the tester is
  // looking at has to be injected by hand — and a chrome:// tab must not be,
  // because Chrome refuses it and the refusal is noise, not news.
  const main = calls.executed.filter((x) => x.world === 'MAIN'); // T-075: the heavy ISOLATED files go in too
  assert.equal(main.length, 1);
  assert.equal(main[0].target.tabId, 11);
  assert.ok(calls.executed.every((x) => x.target.tabId === 11), 'only the open https tab is injected');
});

test('waking on a machine that has allowed nothing registers nothing', async () => {
  // The install state since decision 8. `registerContentScripts` would throw on
  // a pattern outside the granted set, and the refusal a tester needs is
  // `NOT_ALLOWED` from the tool they press, not a failed wake.
  const { armed, calls, isRegistered } = await loadArmed([]);
  await armed.arm(1);
  assert.equal(calls.register.length, 0);
  assert.equal(isRegistered(), false);
});

test('the hooks are registered on the granted origins, not on every site', async () => {
  const { armed, calls } = await loadArmed(['https://app.test/*']);
  await armed.arm(1);
  const [spec] = calls.register[0];
  assert.deepEqual(spec.matches, ['https://app.test/*']);
});

test('a grant widened while a window is awake carries the hooks to it', async () => {
  const { armed, calls } = await loadArmed(['https://app.test/*']);
  await armed.arm(1);
  // "All sites", pressed on the second application of the day. The hooks are
  // already registered, so this is an update rather than a second registration.
  chrome.permissions.getAll = async () => ({ permissions: [], origins: ['<all_urls>'] });
  await armed.syncHooks();
  assert.equal(calls.register.length, 1, 'a second registration would be a duplicate id');
  assert.deepEqual(calls.update.at(-1)[0].matches, ['<all_urls>']);
});

test('syncHooks repairs a worker that died between the write and the register', async () => {
  const { armed, isRegistered } = await loadArmed();
  // Storage says awake; nothing is registered. This is exactly the state an
  // MV3 teardown mid-arm leaves behind, and every worker start repairs it.
  await chrome.storage.session.set({ armedWindows: [3] });
  await armed.syncHooks();
  assert.equal(isRegistered(), true);
});

test('syncHooks tears down a registration nobody is awake for', async () => {
  const { armed, isRegistered } = await loadArmed();
  await armed.arm(1);
  await chrome.storage.session.set({ armedWindows: [] });
  await armed.syncHooks();
  assert.equal(isRegistered(), false);
});

/* ──────────────────────── 3. the hooks themselves, in a fake page ──────── */

/**
 * A page just real enough to run `content/page-hooks.js`.
 *
 * `window.fetch` and `window.XMLHttpRequest` are the two things the file
 * replaces, and `window.postMessage` is the only way anything it observes
 * leaves the page — so a page that records its own postMessages is a complete
 * account of what the hooks reported.
 */
function fakePage() {
  const posted = [];
  const listeners = new Map();

  const nativeFetch = async () => ({
    ok: true, status: 200, statusText: 'OK', url: 'https://app.test/api',
    headers: { get: () => null, forEach: () => {} },
    clone() { return this; },
    async text() { return '{}'; },
  });

  class FakeXhr {
    constructor() { this.readyState = 0; }
    open() {}
    send() {}
    addEventListener() {}
    dispatchEvent() {}
    setRequestHeader() {}
  }

  const win = {
    postMessage: (data) => posted.push(data),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: () => {},
    fetch: nativeFetch,
    XMLHttpRequest: FakeXhr,
    location: { href: 'https://app.test/page', origin: 'https://app.test' },
  };
  win.window = win;
  win.self = win;

  const sandbox = {
    window: win,
    self: win,
    location: win.location,
    console: { error() {}, warn() {}, assert() {}, log() {} },
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    URL,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Array,
    Promise,
    Error,
    RegExp,
    Headers: class { get() { return null; } forEach() {} },
    // Just enough Response for the override rules: they answer with
    // `new Response(body, { status })`, and the status is the whole assertion.
    Response: class { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.ok = this.status < 400; } },
    Request: class {},
    XMLHttpRequest: FakeXhr,
    fetch: nativeFetch,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'content/page-hooks.js'), 'utf8'), context, {
    filename: 'page-hooks.js',
  });

  /** What `content/bridge.js` posts when the worker says the window is awake. */
  const say = (data) => {
    for (const fn of listeners.get('message') || []) fn({ source: win, data });
  };

  return {
    win,
    posted,
    say,
    events: () => posted.filter((p) => p?.source === 'uqa-page').map((p) => p.event),
  };
}

console.log('\nsleep — a page that was hooked before the switch moved');

test('the hooks install but report nothing until they are told they are awake', async () => {
  const page = fakePage();
  assert.equal(page.win.__UQA_HOOKED__, true, 'the file ran');
  await page.win.fetch('https://app.test/api');
  assert.deepEqual(page.events(), [], 'asleep by default: a request is not reported');
});

test('told it is awake, the same request is reported', async () => {
  const page = fakePage();
  page.say({ source: 'uqa-awake', awake: true });
  await page.win.fetch('https://app.test/api');
  assert.equal(page.events().length, 1);
  assert.equal(page.events()[0].kind, 'net');
});

test('told it is asleep again, it stops mid-page', async () => {
  const page = fakePage();
  page.say({ source: 'uqa-awake', awake: true });
  await page.win.fetch('https://app.test/api');
  const during = page.events().length;
  page.say({ source: 'uqa-awake', awake: false });
  await page.win.fetch('https://app.test/api');
  await page.win.fetch('https://app.test/api');
  assert.equal(page.events().length, during, 'nothing recorded after the switch moved');
});

test('an override rule armed before the sleep is dropped by it', async () => {
  // The dangerous half. Reporting while asleep is a privacy failure; *acting*
  // while asleep — forcing a 500 on a request the tester is no longer testing —
  // changes what the application does.
  const page = fakePage();
  page.say({ source: 'uqa-awake', awake: true });
  page.say({ source: 'uqa-rules', rules: [{ id: 'r1', enabled: true, action: 'status', status: 500, pattern: '/api' }] });
  const broken = await page.win.fetch('https://app.test/api');
  assert.equal(broken.status, 500, 'the rule is live while awake');

  page.say({ source: 'uqa-awake', awake: false });
  const clean = await page.win.fetch('https://app.test/api');
  assert.equal(clean.status, 200, 'the rule is gone the moment the window sleeps');
});

test('rules pushed while asleep are not obeyed', async () => {
  const page = fakePage();
  page.say({ source: 'uqa-awake', awake: false });
  page.say({ source: 'uqa-rules', rules: [{ id: 'r1', enabled: true, action: 'status', status: 500, pattern: '/api' }] });
  const res = await page.win.fetch('https://app.test/api');
  assert.equal(res.status, 200);
  assert.deepEqual(page.events(), []);
});

/* ───────────────────────────── 4. the recorder, and the worker seam ────── */

console.log('\nsleep — the other two places a sleeping window could still be read');

test('content/recorder.js refuses to record when the page is asleep', () => {
  const src = fs.readFileSync(path.join(EXT, 'content/recorder.js'), 'utf8');
  assert.match(
    src,
    /if \(window\.UQAAwake === false\) return;/,
    'record() must check the master switch before it captures an action'
  );
});

test('ingest() drops anything sent from a sleeping tab', () => {
  const src = workerSrc();
  const ingest = src.slice(src.indexOf('async function ingest('), src.indexOf('async function ingest(') + 1400);
  assert.match(ingest, /armed\.assertMayRecord\(sender/);
  assert.match(ingest, /reason: err.reason/); // the ASLEEP reason comes from assertMayRecord
});

test('the worker refuses every armed-only message from a sleeping window', () => {
  const src = workerSrc();
  const guard = src.slice(src.indexOf('async function guard('), src.indexOf('async function guard(') + 900);
  assert.match(guard, /NEEDS_ARMING\.has\(type\)/);
  assert.match(guard, /throw (?:new Error\(armed\.ASLEEP\)|armed\.asleepError\(\))/);
});

test('sleeping a window ends the clip, the session, the grants and the hidden page', () => {
  // The order is load-bearing and documented at sleepWindow(); what this
  // asserts is that none of the five steps has been dropped.
  const src = workerSrc();
  const body = src.slice(src.indexOf('async function sleepWindow('), src.indexOf('function announceArmed('));
  for (const step of ['armed.beginSleep', 'UQA_RECORD_STOP', 'stopSession()', 'forgetWindowGrants', 'closeOffscreen()', 'flushEvents()']) {
    assert.ok(body.includes(step), `sleepWindow no longer does: ${step}`);
  }
});

await queue;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
