/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What this browser can do, and what the build does about it.
 *
 * Two things are being protected here.
 *
 * **Detection must be a fact, not a claim.** Every check reads the API object.
 * A user-agent test would be a claim about identity, and identity and capability
 * disagree constantly — Edge says Chrome, every fork says something, and a
 * Chromium build can be compiled without a feature entirely.
 *
 * **The per-browser manifests must stay in step with the capability list.** They
 * live in one file for exactly this reason: a permission dropped from the
 * Firefox manifest but still assumed by the code produces a package that
 * installs and then cannot do what it asked permission for.
 */
import assert from 'node:assert/strict';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const { CAPABILITIES, detect, whyNot, browserName } = await import('../core/capabilities.js');
const { TARGETS } = await import('./targets.mjs');

/**
 * Stand in for a browser with exactly these APIs.
 *
 * `navigator` is a read-only accessor on globalThis in Node, so it has to be
 * redefined rather than assigned — plain assignment throws, and the throw looks
 * like a failure of the thing under test rather than of the harness.
 */
function pretend(surface, ua) {
  globalThis.chrome = surface;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua || 'Mozilla/5.0 (X11) Chrome/140.0' },
    configurable: true,
    writable: true,
  });
}

const CHROMIUM = {
  offscreen: { createDocument() {} },
  tabCapture: { getMediaStreamId() {} },
  desktopCapture: { chooseDesktopMedia() {} },
  debugger: { attach() {} },
  cookies: { getAll() {} },
  downloads: { download() {} },
  contextMenus: { create() {} },
  commands: { getAll() {} },
};

/* Firefox's MV3 surface: no offscreen, no tab or desktop capture, no debugger. */
const GECKO = {
  cookies: { getAll() {} },
  downloads: { download() {} },
  contextMenus: { create() {} },
  commands: { getAll() {} },
};

console.log('capabilities.js — detection');

test('a complete Chromium reports everything present', () => {
  pretend(CHROMIUM);
  const state = detect();
  assert.equal(state.complete, true, JSON.stringify(state.missing.map((m) => m.id)));
  assert.equal(state.disabled.length, 0);
});

test('Firefox reports exactly the four it does not implement', () => {
  pretend(GECKO, 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/141.0');
  const state = detect();
  assert.equal(state.browser, 'Firefox');
  assert.deepEqual(
    state.missing.map((m) => m.id).sort(),
    ['debugger', 'desktopCapture', 'offscreen', 'tabCapture']
  );
});

test('capability is read from the API, never from the user-agent', () => {
  // A browser claiming to be Chrome while lacking the APIs must still be
  // treated as lacking them. This is the whole argument for feature detection.
  pretend(GECKO, 'Mozilla/5.0 (Windows) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36');
  const state = detect();
  assert.equal(state.browser, 'Chrome', 'it says Chrome…');
  assert.equal(state.caps.offscreen, false, '…and it still cannot do offscreen');
});

test('an API object that throws when touched counts as absent', () => {
  pretend({
    ...GECKO,
    get offscreen() {
      throw new Error('blocked by policy');
    },
  });
  const state = detect();
  assert.equal(state.caps.offscreen, false, 'a throwing getter must not take the whole detect() down');
});

test('no chrome object at all is survivable', () => {
  globalThis.chrome = undefined;
  globalThis.browser = undefined;
  const state = detect();
  assert.equal(state.complete, false);
  assert.ok(state.missing.length, 'everything is missing, and nothing threw');
});

test('Edge and Safari are named correctly, for the message only', () => {
  pretend(CHROMIUM, 'Mozilla/5.0 (Windows) Chrome/140.0.0.0 Safari/537.36 Edg/140.0');
  assert.equal(browserName(), 'Edge');
  pretend({}, 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15');
  assert.equal(browserName(), 'Safari');
});

console.log('\ncapabilities.js — what the tester is told');

test('a blocked feature comes back with the browser named and a real alternative', () => {
  pretend(GECKO, 'Mozilla/5.0 Firefox/141.0');
  const why = whyNot('record');
  assert.ok(why, 'recording needs tabCapture, which Firefox does not have');
  assert.match(why.message, /Firefox/, 'not naming the browser reads as a fault in the extension');
  assert.ok(why.message.length > 60, 'and it has to say what to do instead');
});

test('a feature that works returns null, so the happy path costs nothing', () => {
  pretend(CHROMIUM);
  assert.equal(whyNot('record'), null);
  assert.equal(whyNot('whitebox'), null);
});

test('every capability names at least one feature and an alternative', () => {
  for (const cap of CAPABILITIES) {
    assert.ok(cap.powers.length, `${cap.id} gates nothing — why is it listed?`);
    assert.ok(cap.instead && cap.instead.length > 40, `${cap.id} has no usable alternative`);
    assert.ok(cap.label, `${cap.id} has no human name`);
  }
});

test('Firefox disables recording and coverage, and keeps everything else', () => {
  pretend(GECKO, 'Mozilla/5.0 Firefox/141.0');
  const state = detect();
  for (const gone of ['record', 'whitebox', 'gif', 'fullpage']) {
    assert.ok(state.disabled.includes(gone), `${gone} should be disabled`);
  }
  for (const kept of ['storage', 'filing', 'contextMenu']) {
    assert.ok(!state.disabled.includes(kept), `${kept} should still work`);
  }
});

console.log('\ncapabilities.js — the build targets');

test('T-046: TARGETS lives in the build, not in the worker-loaded capabilities module', async () => {
  const mod = await import('../core/capabilities.js');
  assert.equal('TARGETS' in mod, false);
});

test('every target says what it is and what it drops', () => {
  for (const [id, spec] of Object.entries(TARGETS)) {
    assert.ok(spec.label, `${id} has no label`);
    assert.ok(spec.engine, `${id} names no engine`);
    assert.ok(Array.isArray(spec.drop), `${id} has no drop list`);
    assert.ok(spec.note && spec.note.length > 40, `${id} does not explain itself`);
  }
});

test('Chromium targets drop nothing', () => {
  assert.deepEqual(TARGETS.chrome.drop, []);
  assert.deepEqual(TARGETS.edge.drop, []);
});

test('what a target drops is exactly what that engine cannot do', () => {
  // The two lists live in one file so they cannot drift. This asserts they
  // have not: a permission dropped from the manifest but still assumed by the
  // code is a package that installs and then cannot do what it asked for.
  pretend(GECKO, 'Firefox/141.0');
  const cannot = detect().missing.map((m) => m.id).sort();
  assert.deepEqual([...TARGETS.firefox.drop].sort(), cannot);
  assert.deepEqual([...TARGETS.safari.drop].sort(), cannot);
});

test('Firefox is declared as an event page and given a gecko id', () => {
  assert.equal(TARGETS.firefox.background, 'scripts', 'Gecko MV3 does not take a service_worker');
  assert.ok(TARGETS.firefox.gecko?.id, 'Firefox refuses to install without one');
});

test('Safari says plainly that it needs a build step this project cannot run', () => {
  assert.match(TARGETS.safari.note, /Xcode|converter/i);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
