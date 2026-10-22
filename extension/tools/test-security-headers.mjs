/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The six response headers a session keeps, and the six thousand it does not.
 *
 *   node tools/test-security-headers.mjs
 *
 * ── what this is defending ────────────────────────────────────────────────
 *
 * Decision 33 turned three MANUAL rows of tool 18 into measured ones by
 * capturing response headers per request. Two things about that can go wrong
 * quietly and both are worse than the rows staying MANUAL.
 *
 * The first is **keeping too much**. A response carries `set-cookie`,
 * `authorization` echoes, signed URLs and session identifiers, and every one of
 * them would end up in an exported Markdown document handed to a developer, or
 * a Jira issue, or a chat channel. So the capture is an allow-list of six names
 * and this suite asserts that nothing else survives it — including the obvious
 * near-misses, because `content-security-policy-report-only` looks like a match
 * and is not one.
 *
 * The second is **size**. This runs on every response of every page under test,
 * and a Content-Security-Policy on a large application is a couple of kilobytes
 * on its own. A per-request record that grows without bound is a session that
 * fills a tester's disk, so the budget is asserted rather than assumed: under
 * one kilobyte of growth per request, with every one of the six present and
 * every one of them oversized.
 *
 * Pure functions and plain objects; no Chrome, no browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECURITY_HEADERS, VALUE_MAX, TRUNCATED, pickSecurityHeaders,
} from '../background/security-headers.js';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const header = (name, value) => ({ name, value });

console.log('\nsecurity-headers.js — the allow-list');

test('the list is exactly the six that were decided, lower-cased', () => {
  assert.deepEqual([...SECURITY_HEADERS].sort(), [
    'access-control-allow-origin',
    'content-security-policy',
    'permissions-policy',
    'referrer-policy',
    'strict-transport-security',
    'x-frame-options',
  ], 'decision 33 names six; adding a seventh is a decision, not a tidy-up');
  for (const name of SECURITY_HEADERS) {
    assert.equal(name, name.toLowerCase(), 'header names are matched lower-cased');
  }
});

test('the six are kept, whatever case they arrive in', () => {
  const out = pickSecurityHeaders([
    header('Content-Security-Policy', "default-src 'self'"),
    header('STRICT-TRANSPORT-SECURITY', 'max-age=31536000'),
    header('x-frame-options', 'DENY'),
    header('Referrer-Policy', 'strict-origin-when-cross-origin'),
    header('Access-Control-Allow-Origin', '*'),
    header('Permissions-Policy', 'camera=()'),
  ]);
  assert.equal(Object.keys(out).length, 6);
  assert.equal(out['content-security-policy'], "default-src 'self'");
  assert.equal(out['strict-transport-security'], 'max-age=31536000');
  assert.equal(out['x-frame-options'], 'DENY');
});

test('nothing else survives, including the things that would hurt most', () => {
  const out = pickSecurityHeaders([
    header('Set-Cookie', 'session=abc123def456; Path=/; HttpOnly'),
    header('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
    header('X-Amz-Security-Token', 'FQoGZXIvYXdzEJr'),
    header('Proxy-Authenticate', 'Basic realm="internal"'),
    header('Server', 'nginx/1.24.0'),
    header('X-Powered-By', 'Express'),
    header('Content-Type', 'text/html; charset=utf-8'),
    header('Content-Security-Policy', "default-src 'self'"),
  ]);
  assert.deepEqual(Object.keys(out), ['content-security-policy'],
    'only the allow-listed name may be kept; everything else must be dropped before it is ever written');
  const text = JSON.stringify(out);
  for (const secret of ['session=abc123', 'Bearer', 'FQoGZXIv', 'nginx', 'Express']) {
    assert.ok(!text.includes(secret), `${secret} reached the record`);
  }
});

test('a near-miss name is not a match', () => {
  const out = pickSecurityHeaders([
    header('Content-Security-Policy-Report-Only', "default-src 'none'"),
    header('X-Frame-Options-Legacy', 'DENY'),
    header('X-Permissions-Policy', 'camera=()'),
  ]);
  assert.equal(out, null,
    'the match is on the whole name; a report-only policy is a different header and is not the one the row is about');
});

test('a response with none of them stores nothing at all', () => {
  assert.equal(pickSecurityHeaders([header('Content-Type', 'image/png')]), null,
    'an image must not add an empty object to every request record');
  assert.equal(pickSecurityHeaders(null), null);
  assert.equal(pickSecurityHeaders(undefined), null);
  assert.equal(pickSecurityHeaders([]), null);
});

test('a repeated header is kept once', () => {
  const out = pickSecurityHeaders([
    header('Content-Security-Policy', "default-src 'self'"),
    header('Content-Security-Policy', "script-src 'none'"),
  ]);
  assert.equal(out['content-security-policy'], "default-src 'self'",
    'the browser intersects two policies; the record says what it saw and does not pretend to');
});

console.log('\nsecurity-headers.js — the storage budget');

test('a value is cut at 512 characters and says that it was', () => {
  const long = `default-src 'self'; ${'script-src https://cdn.example.test '.repeat(200)}`;
  const out = pickSecurityHeaders([header('Content-Security-Policy', long)]);
  const kept = out['content-security-policy'];
  assert.equal(kept.length, VALUE_MAX + TRUNCATED.length);
  assert.ok(kept.endsWith(TRUNCATED), 'nobody may read a truncated policy as a whole one');
  assert.ok(kept.startsWith("default-src 'self'"), 'the directives that matter are at the front');
});

test('the worst case a request record can grow by is under 1 KB', () => {
  /*
   * Every one of the six present, every one of them far over the limit. This is
   * the number that decides whether a long session on a heavy application fills
   * a disk, so it is measured on the bytes that would actually be stored rather
   * than reasoned about.
   */
  const fat = 'x'.repeat(4000);
  const worst = pickSecurityHeaders(SECURITY_HEADERS.map((name) => header(name, fat)));
  assert.equal(Object.keys(worst).length, 6);
  const bytes = new TextEncoder().encode(JSON.stringify({ secHeaders: worst })).length;
  assert.ok(bytes < 1024,
    `a request record grows by ${bytes} bytes in the worst case; the budget is 1024. ` +
    'Lower VALUE_MAX or shorten the allow-list.');
  // And the ordinary case, which is what a real session pays.
  const real = pickSecurityHeaders([
    header('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:"),
    header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload'),
    header('x-frame-options', 'SAMEORIGIN'),
    header('referrer-policy', 'strict-origin-when-cross-origin'),
  ]);
  const realBytes = new TextEncoder().encode(JSON.stringify({ secHeaders: real })).length;
  assert.ok(realBytes < 320, `an ordinary response costs ${realBytes} bytes, which is more than expected`);
});

console.log('\nsecurity-headers.js — armed only while recording');

const src = fs.readFileSync(path.join(EXT, 'background', 'security-headers.js'), 'utf8');
const worker = workerSrc();

test('the listener observes and never blocks', () => {
  assert.ok(!/'blocking'/.test(src), 'a blocking listener would sit between the tester and every response');
  assert.match(src, /\['responseHeaders'\]/, 'it must ask for the headers it reads, and nothing else');
});

test('it is armed at session start and dropped when the last session ends', () => {
  assert.match(worker, /secHeaders\.arm\(windowId\)/,
    'armed for the window the session covers, not for the whole browser');
  assert.match(worker, /if \(!\(await liveSessionIds\(\)\)\.length\) secHeaders\.disarm\(\)/,
    'a second window still recording must not be blinded by the first one stopping');
});

test('the permission is declared, and the documents say what it is for', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('webRequest'),
    'the listener cannot attach without it');
  for (const doc of ['PRIVACY.md', 'store/LISTING.md']) {
    const text = fs.readFileSync(path.join(EXT, doc), 'utf8');
    assert.match(text, /webRequest/,
      `${doc} must say what webRequest is used for; an undeclared permission is a store rejection and a broken promise`);
  }
});

console.log('\nsecurity-headers.js — one listener while armed and a host origin is held, windows and entries survive sleep (01-1, D-1010-01)');

const settle = () => new Promise((r) => setTimeout(r, 0));

async function asyncTest(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

await asyncTest('arm w1 then w2 keeps w1; a cache-busted re-import restores both and registers the listener after the restore, not at import', async () => {
  const store = new Map();
  const added = [];
  const removed = [];
  const tabs = new Map([[10, 1], [20, 2], [30, 3]]);
  globalThis.chrome = {
    storage: { session: {
      async get(keys) { const o = {}; for (const k of [].concat(keys)) if (store.has(k)) o[k] = structuredClone(store.get(k)); return o; },
      async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
    } },
    webRequest: { onHeadersReceived: {
      addListener(fn, filter, extra) { added.push({ fn, filter, extra }); },
      removeListener(fn) { removed.push(fn); },
    } },
    tabs: { async get(id) { if (!tabs.has(id)) throw new Error('no tab'); return { windowId: tabs.get(id) }; } },
    permissions: { async getAll() { return { origins: ['https://x.test/*'] }; }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  const res = (tabId, requestId) => ({ tabId, requestId, url: `https://x.test/${requestId}`, type: 'main_frame', responseHeaders: [header('x-frame-options', 'DENY'), header('set-cookie', 'a=1')] });

  const a = await import('../background/security-headers.js?a');
  assert.equal(added.length, 0, 'no listener at import (D-1010-01)');
  await a.restored;
  assert.equal(added.length, 0, 'nothing armed after the read: still none');
  assert.equal(a.isArmed(), false);

  assert.equal(a.arm(1), true);
  await settle();
  assert.equal(added.length, 1, 'arm registers the single listener (an origin is held)');
  assert.deepEqual(added[0].filter.urls, ['http://*/*', 'https://*/*']);
  assert.ok(!added[0].extra.includes('blocking'));
  a.arm(2);
  await settle();
  assert.equal(added.length, 1, 'a second window must not stack a second listener');
  const fire = added[0].fn;
  await fire(res(10, 'r1'));
  await fire(res(20, 'r2'));
  await fire(res(30, 'r3'));
  await fire({ ...res(10, 'r4'), responseHeaders: [header('set-cookie', 'a=1')] });
  assert.deepEqual(a.snapshot().map((e) => e.url).sort(), ['https://x.test/r1', 'https://x.test/r2'], 'w1 kept after w2 armed; an unarmed window and a header-less response are ignored');
  assert.ok(!JSON.stringify(a.snapshot()).includes('set-cookie'));

  await a.flushPersist();
  const b = await import('../background/security-headers.js?b');
  await b.restored;
  assert.equal(added.length, 2, 'armed windows were restored with an origin held: the listener is registered');
  assert.equal(removed.length, 0, 'and nothing was removed');
  assert.equal(b.isArmed(), true);
  assert.deepEqual(b.snapshot().map((e) => e.url).sort(), ['https://x.test/r1', 'https://x.test/r2'], 'entries restored after the sleep');

  b.disarm(1);
  assert.deepEqual(b.snapshot().map((e) => e.url), ['https://x.test/r2'], 'disarm(w1) forgets only w1');
  assert.equal(b.isArmed(), true);
  b.disarm();
  assert.equal(b.snapshot().length, 0);
  assert.equal(b.isArmed(), false);
  assert.equal(removed.length, 1, 'the last disarm removes the listener');
  await b.flushPersist();

  const c = await import('../background/security-headers.js?c');
  await c.restored;
  assert.equal(c.snapshot().length, 0, 'a disarmed worker restores nothing');
  assert.equal(added.length, 2, 'and registers nothing');

  // The map stays bounded.
  c.arm(null);
  await settle();
  const fireC = added[added.length - 1].fn;
  for (let i = 0; i < 450; i++) await fireC({ ...res(-1, `n${i}`), tabId: -1 });
  assert.ok(c.snapshot().length <= 400 && c.snapshot().length > 0, `seen map bounded (${c.snapshot().length})`);
  c.disarm();
  delete globalThis.chrome;
});

await asyncTest('D-1010-01: the listener follows the grants (none at import or restore without origins; arm; onAdded; onRemoved)', async () => {
  let origins = [];
  const added = [];
  const removed = [];
  const perm = {};
  globalThis.chrome = {
    storage: { session: {
      async get() { return { 'uqa.secHeaders.windows': [3] }; },
      async set() {},
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { added.push(fn); }, removeListener(fn) { removed.push(fn); } } },
    tabs: { async get() { return { windowId: 3 }; } },
    permissions: {
      async getAll() { return { permissions: [], origins: [...origins] }; },
      onAdded: { addListener(fn) { perm.added = fn; } },
      onRemoved: { addListener(fn) { perm.removed = fn; } },
    },
  };
  const m = await import('../background/security-headers.js?perm');
  assert.equal(added.length, 0, 'case 1: no addListener at import');
  await m.restored;
  assert.equal(m.isArmed(), true, 'a persisted window was restored');
  assert.equal(added.length, 0, 'case 1: none after restore when getAll has no origins');
  assert.equal(typeof perm.added, 'function', 'permissions.onAdded is registered at import');
  assert.equal(typeof perm.removed, 'function', 'permissions.onRemoved is registered at import');

  origins = ['https://x.test/*'];
  perm.added();
  await settle();
  assert.equal(added.length, 1, 'case 3: registered after onAdded while a window is armed');
  perm.added();
  await settle();
  assert.equal(added.length, 1, 'onAdded again does not stack a second listener');

  origins = [];
  perm.removed();
  await settle();
  assert.equal(removed.length, 1, 'case 4: dropped after onRemoved with no origin left');
  m.disarm();

  // case 2: arm with origins; and onAdded with nothing armed does nothing
  origins = ['https://y.test/*'];
  perm.added();
  await settle();
  assert.equal(added.length, 1, 'onAdded with nothing armed registers nothing');
  assert.equal(m.arm(5), true);
  await settle();
  assert.equal(added.length, 2, 'case 2: registered after arm once an origin is held');

  // arm with no origin registers nothing
  origins = [];
  m.disarm();
  assert.equal(m.arm(6), true);
  await settle();
  assert.equal(added.length, 2, 'arm without any origin registers nothing');
  m.disarm();
  delete globalThis.chrome;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

await asyncTest('200 responses with an unchanged window set write the windows key at most once (r2-07-1)', async () => {
  const writes = [];
  const added = [];
  globalThis.chrome = {
    storage: { session: {
      async get() { return {}; },
      async set(o) { writes.push(...Object.keys(o)); },
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { added.push(fn); }, removeListener() {} } },
    tabs: { async get() { return { windowId: 7 }; } },
    permissions: { async getAll() { return { origins: ['https://x.test/*'] }; }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  const m = await import('../background/security-headers.js?d');
  await m.restored;
  m.arm(7); await tick(); // arm() registers the listener after the grants are read
  const winWrites = () => writes.filter((k) => k === 'uqa.secHeaders.windows').length;
  assert.equal(winWrites(), 1, 'arm writes the windows key once');
  const fire = added[added.length - 1];
  for (let i = 0; i < 200; i++) {
    await fire({ tabId: 5, requestId: `q${i}`, url: `https://x.test/${i}`, type: 'main_frame', responseHeaders: [header('x-frame-options', 'DENY')] });
  }
  assert.equal(m.snapshot().length, 200, 'the responses were recorded');
  assert.equal(winWrites(), 1, '200 responses did not write the windows key again');
  await m.flushPersist();
  assert.equal(winWrites(), 2, 'flushPersist still writes it');
  assert.ok(writes.includes('uqa.secHeaders.seen'), 'the seen map is saved');
  m.disarm();
  delete globalThis.chrome;
});

/** A chrome stub with tab events captured, an optional gate on storage.session.get, and every write logged. */
function stubChrome({ stored = {}, gate = null, tabWin = new Map() } = {}) {
  const added = [];
  const tabEvents = {};
  const writes = [];
  const filters = [];
  const ev = (name) => ({ addListener(fn) { (tabEvents[name] ||= []).push(fn); } });
  globalThis.chrome = {
    storage: { session: {
      async get(keys) { if (gate) await gate; const o = {}; for (const k of [].concat(keys)) if (k in stored) o[k] = structuredClone(stored[k]); return o; },
      async set(o) { writes.push(structuredClone(o)); },
    } },
    webRequest: { onHeadersReceived: { addListener(fn, filter) { added.push(fn); filters.push(filter); }, removeListener() {} } },
    permissions: { async getAll() { return { origins: ['https://x.test/*'] }; }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
    tabs: { async get(id) { if (!tabWin.has(id)) throw new Error('no tab'); return { windowId: tabWin.get(id) }; }, onAttached: ev('onAttached'), onDetached: ev('onDetached'), onRemoved: ev('onRemoved') },
  };
  /** Like the browser: the newest listener only hears the request types its registered filter names. */
  const deliver = async (details) => {
    const f = filters[filters.length - 1];
    if (f?.types && !f.types.includes(details.type)) return;
    await added[added.length - 1](details);
  };
  return { added, filters, deliver, tabEvents, writes, tabWin };
}
const doc = (tabId, requestId, url = `https://x.test/${requestId}`, type = 'main_frame') => ({ tabId, requestId, url, type, responseHeaders: [header('x-frame-options', 'DENY')] });

await asyncTest('r4-02-4: tab events drop the cached window, registered at import; a moved tab is attributed to its new window', async () => {
  const s = stubChrome({ tabWin: new Map([[10, 1]]) });
  const m = await import('../background/security-headers.js?e');
  for (const name of ['onAttached', 'onDetached', 'onRemoved']) assert.equal(s.tabEvents[name]?.length, 1, `${name} is registered at import`);
  await m.restored;
  m.arm(2); await tick(); // arm() registers the listener after the grants are read
  const fire = s.added[s.added.length - 1];
  await fire(doc(10, 'a1'));
  assert.equal(m.snapshot().length, 0, 'tab 10 is in window 1, which is not armed');
  s.tabWin.set(10, 2); // the tab moved to the armed window
  await fire(doc(10, 'a2'));
  assert.equal(m.snapshot().length, 0, 'the stale cache still answers window 1');
  s.tabEvents.onAttached[0](10, { newWindowId: 2 });
  await fire(doc(10, 'a3'));
  assert.deepEqual(m.snapshot().map((e) => e.url), ['https://x.test/a3'], 'after onAttached the new window is read');
  s.tabWin.set(10, 1);
  s.tabEvents.onRemoved[0](10, {});
  await fire(doc(10, 'a4'));
  assert.equal(m.snapshot().length, 1, 'onRemoved dropped it too: window 1 is read again and ignored');
  m.disarm();
  delete globalThis.chrome;
});

await asyncTest('r4-06-4: a restore that resolves after a disarm does not bring the windows back', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = stubChrome({ gate, stored: { 'uqa.secHeaders.windows': [3], 'uqa.secHeaders.seen': [['r1', { url: 'https://x.test/r1', headers: {}, ts: 1, type: 'main_frame', w: 3 }]] } });
  const m = await import('../background/security-headers.js?f');
  m.disarm(); // the session ended before the read came back
  release();
  await m.restored;
  assert.equal(m.isArmed(), false, 'window 3 stays disarmed');
  assert.equal(m.snapshot().length, 0, 'and its entries stay gone');
  assert.equal(s.added.length, 0, 'a disarmed restore registers no listener');
  delete globalThis.chrome;
});

await asyncTest('r3-03-4: a secret in the query string is redacted before it is kept', async () => {
  const s = stubChrome();
  const m = await import('../background/security-headers.js?g');
  await m.restored;
  m.arm(null); await tick(); // arm() registers the listener after the grants are read
  await s.added[s.added.length - 1](doc(-1, 'k1', 'https://x.test/cb?access_token=abcdef1234567890abcdef&x=1'));
  const url = m.snapshot()[0].url;
  assert.ok(!url.includes('abcdef1234567890'), url);
  assert.match(url, /x=1/);
  m.disarm();
  delete globalThis.chrome;
});

await asyncTest('r3-07-5: a busy page of subresources never rewrites the seen map; documents do, capped', async () => {
  const s = stubChrome();
  const m = await import('../background/security-headers.js?h');
  await m.restored;
  m.arm(null); await tick(); // arm() registers the listener after the grants are read
  const fire = s.added[s.added.length - 1];
  await new Promise((r) => setTimeout(r, 900)); // arm's own scheduled save, and timers left by the earlier modules, run out first
  s.writes.length = 0;
  for (let i = 0; i < 300; i++) await fire(doc(-1, `s${i}`, `https://x.test/s${i}.js`, 'script'));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(s.writes.filter((o) => 'uqa.secHeaders.seen' in o).length, 0, 'no seen write for subresources');
  for (let i = 0; i < 80; i++) await fire(doc(-1, `d${i}`));
  await m.flushPersist();
  const saved = s.writes.filter((o) => 'uqa.secHeaders.seen' in o).pop()['uqa.secHeaders.seen'];
  assert.equal(saved.length, 50, 'the newest 50 documents');
  assert.ok(saved.every(([, v]) => v.type === 'main_frame'));
  assert.equal(saved[49][0], 'd79');
  m.disarm();
  delete globalThis.chrome;
});

await asyncTest('r5-07-1: the listener asks only for documents, and 500 image responses cannot evict the main_frame row', async () => {
  const s = stubChrome();
  const m = await import('../background/security-headers.js?i');
  await m.restored;
  m.arm(null); await tick(); // arm() registers the listener after the grants are read
  const filter = s.filters[s.filters.length - 1];
  assert.deepEqual(filter.types, ['main_frame', 'sub_frame'], 'the filter names the document types');
  assert.deepEqual(filter.urls, ['http://*/*', 'https://*/*']);
  await s.deliver(doc(-1, 'page', 'https://x.test/page', 'main_frame'));
  for (let i = 0; i < 500; i++) await s.deliver(doc(-1, `img${i}`, `https://x.test/i${i}.png`, 'image'));
  assert.deepEqual(m.snapshot().map((e) => e.url), ['https://x.test/page'], 'the document row survived the images');
  m.disarm();
  delete globalThis.chrome;
});

await asyncTest('r4: disarm(w) while the restore is reading drops only w; a full disarm() still discards everything', async () => {
  const row = (id, w) => [id, { url: `https://x.test/${id}`, headers: {}, ts: 1, type: 'main_frame', w }];
  const stored = { 'uqa.secHeaders.windows': [3, 4], 'uqa.secHeaders.seen': [row('r3', 3), row('r4', 4)] };
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = stubChrome({ gate, stored });
  const m = await import('../background/security-headers.js?j');
  m.disarm(3); // window 3's session ended before the read came back
  release();
  await m.restored;
  assert.equal(m.isArmed(), true, 'window 4 is still watched');
  assert.deepEqual(m.snapshot().map((e) => e.url), ['https://x.test/r4'], 'only window 3 and its entries are gone');
  const last = s.writes.filter((o) => 'uqa.secHeaders.windows' in o).pop();
  assert.deepEqual(last['uqa.secHeaders.windows'], [4], 'the surviving set is what gets saved');
  m.disarm();
  delete globalThis.chrome;

  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  stubChrome({ gate: gate2, stored });
  const n = await import('../background/security-headers.js?k');
  n.disarm(); // everything ended
  release2();
  await n.restored;
  assert.equal(n.isArmed(), false, 'a full disarm still discards the restore');
  assert.equal(n.snapshot().length, 0);
  delete globalThis.chrome;
});

await asyncTest('r2-12-5 / D-1010-34: with no permissions.getAll the module fails closed (arm and a restored window add no listener)', async () => {
  const added = [];
  globalThis.chrome = {
    storage: { session: {
      async get() { return { 'uqa.secHeaders.windows': [5] }; },
      async set() {},
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { added.push(fn); }, removeListener() {} } },
    tabs: { async get() { return { windowId: 5 }; } },
  };
  const m = await import('../background/security-headers.js?failclosed');
  await m.restored;
  assert.equal(m.isArmed(), true, 'the persisted window was restored');
  assert.equal(added.length, 0, 'restored(): no getAll, no listener');
  assert.equal(m.arm(6), true, 'arm still records the window');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(added.length, 0, 'arm(): no getAll, no listener');
  m.disarm();
  delete globalThis.chrome;
});
await asyncTest('D-1010-135: a getAll that rejects fails closed (no listener); arm and a restored window stay recorded', async () => {
  const added = [];
  globalThis.chrome = {
    storage: { session: {
      async get() { return { 'uqa.secHeaders.windows': [7] }; },
      async set() {},
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { added.push(fn); }, removeListener() {} } },
    tabs: { async get() { return { windowId: 7 }; } },
    permissions: { async getAll() { throw new Error('boom'); }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  const m = await import('../background/security-headers.js?getallreject');
  await m.restored;
  assert.equal(m.isArmed(), true, 'the persisted window was restored');
  assert.equal(added.length, 0, 'restored(): getAll rejected, no listener');
  assert.equal(m.arm(8), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(added.length, 0, 'arm(): getAll rejected, no listener');
  m.disarm();
  delete globalThis.chrome;
});

await asyncTest('D-1010-135: overlapping syncs are serialised and the last permission state wins', async () => {
  const added = [];
  const removed = [];
  const perm = {};
  const gates = [];
  let calls = 0;
  globalThis.chrome = {
    storage: { session: {
      async get() { return { 'uqa.secHeaders.windows': [9] }; },
      async set() {},
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { added.push(fn); }, removeListener(fn) { removed.push(fn); } } },
    tabs: { async get() { return { windowId: 9 }; } },
    permissions: {
      // call 1 (restore) is immediate and empty; later calls resolve in the order the test releases them.
      getAll() {
        calls++;
        if (calls === 1) return Promise.resolve({ origins: [] });
        return new Promise((resolve) => gates.push(resolve));
      },
      onAdded: { addListener(fn) { perm.added = fn; } },
      onRemoved: { addListener(fn) { perm.removed = fn; } },
    },
  };
  const m = await import('../background/security-headers.js?staggered');
  await m.restored;
  assert.equal(added.length, 0, 'no origins at restore, no listener');
  perm.added();                       // sync A starts, getAll #2 pending
  await new Promise((r) => setTimeout(r, 5));
  perm.removed();                     // sync B arrives mid-flight: only marks dirty
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2, 'the second sync does not start a parallel getAll');
  gates[0]({ origins: ['https://x.test/*'] });   // A finishes with "held"
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 3, 'the dirty flag re-runs the sync once A is done');
  gates[1]({ origins: [] });                      // the rerun sees the grant gone
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(m.isArmed(), true);
  assert.equal(added.length, removed.length, 'the last state (no grant) wins: whatever was added is removed again');
  m.disarm();
  delete globalThis.chrome;
});


console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
