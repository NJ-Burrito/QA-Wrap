/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Every `chrome.runtime.onMessage` listener outside the worker checks who sent
 * the message.
 *
 *   node tools/test-sender-checks.mjs
 *
 * ── the fault this closes ─────────────────────────────────────────────────
 *
 * `content/bridge.js` has always checked `sender.id`, and its comment says
 * exactly why: everything behind that listener is a capability, `sender.id` is
 * stamped by the browser and cannot be spoofed, and without the check any other
 * extension installed beside QA Wrap could arm the fetch/XHR patch on every
 * page in a window the tester had put to sleep. `offscreen/offscreen.js` checks
 * it twice over, because the hidden document holds the camera, the microphone
 * and every recorded byte.
 *
 * The other fifteen listeners did not check anything at all. Between them they
 * would read the page's whole DOM back (`spec-reader`, `harvester`), fill every
 * field on it (`autofill`, `data-injector`), unmask a value the tester had
 * covered by hand (`mask`), rewrite the layout (`rtl-stress`), draw over the
 * page (`ui-host`), and hand back the session's settings (`options`, `popup`,
 * `report`, `panel`). None of it is reachable from a web page today, because
 * `externally_connectable.ids` is empty and a content script cannot message a
 * content script; all of it is reachable from any other extension the tester
 * has installed.
 *
 * ── why this is a source check and not a behavioural one ──────────────────
 *
 * The failure mode is a *missing* line. A behavioural test would have to stand
 * up a second extension to send the hostile message, and would then only cover
 * the listeners somebody remembered to write a case for. Reading the source
 * covers every listener that exists, including the one added next month, and
 * says which file is missing the guard.
 *
 * The worker's own listener is checked here too, separately: it guards on
 * `sender.id` only when there is one, because it is also the destination for
 * its own `chrome.runtime.sendMessage` calls.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** Every product file, ignoring the vendored library, node_modules and the tools. */
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', 'tools', 'dist', 'work', '.git'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const WORKER = 'background/service-worker.js';
const rel = (abs) => path.relative(EXT, abs).split(path.sep).join('/');

/**
 * Each `onMessage.addListener` in the tree, with the first 40 lines of its body.
 *
 * Forty, not the whole body: the guard has to be at the top or it is not a
 * guard. A check three branches deep would let the first branch run.
 */
function listeners() {
  const found = [];
  for (const abs of sources(EXT)) {
    const src = fs.readFileSync(abs, 'utf8');
    const re = /chrome\.runtime\.onMessage\.addListener\(/g;
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split('\n').length;
      const head = src.slice(m.index, m.index + 2400).split('\n').slice(0, 40).join('\n');
      found.push({ file: rel(abs), line, head });
    }
  }
  return found;
}

const all = listeners();
const outside = all.filter((l) => l.file !== WORKER);

console.log('\nonMessage listeners — who is allowed to talk to them');

test('every listener outside the worker is found and accounted for', () => {
  assert.ok(all.length >= 16, `only ${all.length} listeners found; the scan is not reaching the tree`);
  assert.equal(
    all.filter((l) => l.file === WORKER).length, 1,
    'the worker should have exactly one listener; every handler goes through the dispatch table'
  );
  // Named so that a listener appearing in a new surface is a visible change to
  // this list rather than a silent addition.
  assert.ok(outside.length >= 15, `expected at least 15 listeners outside the worker, found ${outside.length}`);
});

/** The guard, in either of the two shapes the product uses. */
const GUARDED = /sender\?\.id !== chrome\.runtime\.id/;
/** The stricter shape, for a listener that may only ever hear the worker. */
const REFUSES_TABS = /sender\?\.id !== chrome\.runtime\.id \|\| sender\?\.tab/;

for (const l of outside) {
  test(`${l.file}:${l.line} checks sender.id before it acts`, () => {
    assert.match(l.head, GUARDED,
      `${l.file}:${l.line} acts on a message without checking who sent it. ` +
      'Copy content/bridge.js: `if (sender?.id !== chrome.runtime.id || sender?.tab) return;` ' +
      'for a content script, and the same without the tab clause for an extension page.');
  });
}

test('every content script refuses a message that came from a tab', () => {
  const loose = outside
    .filter((l) => l.file.startsWith('content/'))
    .filter((l) => !REFUSES_TABS.test(l.head));
  assert.deepEqual(loose.map((l) => `${l.file}:${l.line}`), [],
    'a content script only ever hears the service worker, which is not a tab. ' +
    'A message arriving with sender.tab set came from somewhere with no business ' +
    'driving a tool inside the page under test.');
});

test('nothing authorises on sender.url', () => {
  const offenders = [];
  for (const l of all) {
    if (/sender\??\.url\s*[=!]==/.test(l.head)) offenders.push(`${l.file}:${l.line}`);
  }
  assert.deepEqual(offenders, [],
    'sender.url is a claim about a document, not an identity. research/51d §7.');
});

test('the worker still guards its own dispatch table', () => {
  const worker = all.find((l) => l.file === WORKER);
  assert.match(worker.head, /sender\?\.id && sender\.id !== chrome\.runtime\.id/,
    'background/service-worker.js must refuse another extension before it looks up a handler');
});

test('nothing is declared externally connectable', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.externally_connectable?.ids ?? [], [],
    'an externally connectable id would put every listener above in reach of a web page');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
