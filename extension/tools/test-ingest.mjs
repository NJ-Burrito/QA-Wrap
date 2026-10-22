/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The allow-list that stands between a web page and the session record.
 *
 * `ingest()` stores what a content script sends, and a content script relays
 * what the page's own hooks post — so the object reaching the store is written
 * by the site under test. It used to be spread in whole. These are the four
 * things that made that a hole, each tested for the refusal and, where it
 * matters, for what must still get through: a redactor that eats everything is
 * as useless as one that eats nothing, and the same is true here.
 *
 * Runs in plain Node with no Chrome: `sanitiseEvent` takes the sender's URL and
 * the receipt time as arguments precisely so it can be tested without one.
 */
import { isTesterRow } from '../background/write-queue.js';
import assert from 'node:assert/strict';
import { sanitiseEvent, EVENT_FIELDS, TS_SKEW_MS } from '../core/events.js';

let passed = 0;
const failures = [];
// Queued and awaited: an async test body that rejects must count as a failure, not vanish after the summary.
let queue = Promise.resolve();
function test(name, fn) {
  queue = queue.then(async () => {
    try { await fn(); passed++; console.log(`  ok  ${name}`); }
    catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
  });
}

const NOW = 1_760_000_000_000;
const SENDER = 'https://app.example.test/checkout';
const clean = (raw, opts) => sanitiseEvent(raw, { frameUrl: SENDER, now: NOW, ...opts });

console.log('events.js — what a page under test may put in the record');

/* ── the kind ───────────────────────────────────────────────────────────── */

test('every kind a content script actually emits is accepted', () => {
  // The producers, named so this list fails loudly if one is renamed rather
  // than silently dropping its events on the floor.
  for (const kind of ['net', 'console', 'pageerror', 'dom', 'note', 'rtl', 'inject']) {
    assert.ok(clean({ kind }), `${kind} must be storable — a content script emits it`);
  }
});

test('an unknown kind is rejected outright, not stored empty', () => {
  for (const kind of ['exfiltrate', 'session', 'recording', '', null, undefined, '__proto__']) {
    assert.equal(clean({ kind }), null, `${JSON.stringify(kind)} should not be storable`);
  }
});

test('a non-object is rejected without throwing', () => {
  for (const raw of [null, undefined, 'dom', 42, true]) {
    assert.equal(sanitiseEvent(raw, { frameUrl: SENDER, now: NOW }), null);
  }
});

/* ── the fields ─────────────────────────────────────────────────────────── */

test('a field nobody renders is dropped, however innocent it looks', () => {
  const out = clean({
    kind: 'dom',
    action: 'click',
    label: 'Submit application',
    // Not on the list. The first three are the interesting ones: a page that
    // could set them could file its events against another session, hide its
    // own failures from the report, or point the timeline at another tab.
    sessionId: 's_someone_elses',
    fail: 0,
    tabId: 99,
    tabTitle: 'not ours to say',
    padding: 'x'.repeat(1024),
  });
  assert.deepEqual(Object.keys(out).sort(), ['action', 'frameUrl', 'kind', 'label', 'ts']);
});

test('the fields a report is built from survive intact, falsy ones included', () => {
  const out = clean({
    kind: 'dom',
    action: 'click',
    label: 'Submit application',
    locator: "getByRole('button', { name: 'Submit application' })",
    locatorMatches: 1,
    // `false` is the value the smoke suite asserts on; a truthiness filter
    // would have dropped it and made an unambiguous locator look ambiguous.
    locatorAmbiguous: false,
    masked: false,
    ts: NOW,
  });
  assert.equal(out.locatorAmbiguous, false);
  assert.equal(out.masked, false);
  assert.equal(out.locatorMatches, 1);
  assert.match(out.locator, /getByRole/);
});

test('a net event keeps what the network panel and the HAR export need', () => {
  const out = clean({
    kind: 'net', via: 'fetch', method: 'POST', url: '/api/apply', status: 500,
    ok: false, durationMs: 12, error: false, responsePreview: 'NullPointerException',
    reqHeaders: { 'content-type': 'application/json' }, resHeaders: {}, reqBody: '{}',
    overridden: true, ruleLabel: 'break /api/apply', ts: NOW,
  });
  assert.equal(out.status, 500);
  assert.equal(out.method, 'POST');
  assert.equal(out.responsePreview, 'NullPointerException');
  assert.equal(out.ruleLabel, 'break /api/apply');
});

test('a field allowed on one kind is not allowed on another', () => {
  // `level` is a console field. On a note it is noise, and on anything else it
  // would colour the timeline by a value no producer sets.
  assert.equal(clean({ kind: 'note', text: 'looked wrong', level: 'error' }).level, undefined);
  assert.equal(clean({ kind: 'console', level: 'error', text: 'boom' }).level, 'error');
});

test('no kind quietly allows the fields the worker owns', () => {
  // `fail` is the indexed 1/0 core/db.js derives; the rest identify the event
  // and the tab it came from. All four are the worker's to say, not a page's.
  const owned = ['sessionId', 'tabId', 'tabTitle', 'fail', 'seq', 'id'];
  for (const [kind, fields] of Object.entries(EVENT_FIELDS)) {
    for (const field of owned) {
      assert.ok(!fields.includes(field), `${kind} must not let a page set "${field}"`);
    }
  }
});

/* ── the clock ──────────────────────────────────────────────────────────── */

test('a timestamp within the skew window is believed', () => {
  // The page stamps the event when it happens; we stamp it when it arrives.
  // That small gap IS the ordering a click-to-request correlation reads.
  assert.equal(clean({ kind: 'dom', ts: NOW - 250 }).ts, NOW - 250);
  assert.equal(clean({ kind: 'dom', ts: NOW + 400 }).ts, NOW + 400);
  assert.equal(clean({ kind: 'dom', ts: NOW - TS_SKEW_MS }).ts, NOW - TS_SKEW_MS);
});

test('a timestamp from next year is replaced by the receipt time', () => {
  const nextYear = NOW + 365 * 24 * 60 * 60 * 1000;
  assert.equal(clean({ kind: 'net', ts: nextYear }).ts, NOW, 'a far-future ts must not survive');
  assert.equal(clean({ kind: 'net', ts: 0 }).ts, NOW, 'the epoch would sort above every real event');
  assert.equal(clean({ kind: 'net', ts: NOW - 60_000 }).ts, NOW, 'a minute of drift is not clock skew');
});

test('a timestamp that is not a number at all falls back to receipt', () => {
  for (const ts of [undefined, null, 'now', NaN, Infinity, {}]) {
    assert.equal(clean({ kind: 'console', ts }).ts, NOW, `ts ${String(ts)} should not survive`);
  }
});

/* ── the origin ─────────────────────────────────────────────────────────── */

test('frameUrl comes from the sender, never from the page', () => {
  const out = clean({ kind: 'pageerror', text: 'boom', frameUrl: 'https://bank.example/transfer' });
  assert.equal(out.frameUrl, SENDER, 'the page must not be able to name its own origin');
});

test('frameUrl is null rather than invented when the sender has none', () => {
  const out = sanitiseEvent({ kind: 'note', text: 'hi', frameUrl: 'https://elsewhere.test/' }, { now: NOW });
  assert.equal(out.frameUrl, null);
});

test('every event carries a kind, a ts and a frameUrl, always', () => {
  for (const kind of Object.keys(EVENT_FIELDS)) {
    const out = clean({ kind });
    assert.equal(out.kind, kind);
    assert.equal(typeof out.ts, 'number');
    assert.ok('frameUrl' in out, 'frameUrl must be present even when it is null');
  }
});

/* ── 03-1 / 03-6: the worker's scrub() reads every field that can carry a secret ─── */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { redact, isSecretHeader } from '../core/privacy.js';
import { workerSrc as allWorkerSrc } from './lib-worker-src.mjs';

const workerSrc = allWorkerSrc();
/** The one-line field tables next to scrub(), read from the real file so this cannot drift from it. */
const table = (name) => {
  const m = workerSrc.match(new RegExp('^const ' + name + ' = (\\[.*\\]);$', 'm'));
  assert.ok(m, `service-worker.js no longer declares ${name} on one line`);
  return JSON.parse(m[1].replace(/'/g, '"'));
};
const SCANNED = [...table('TEXT_FIELDS'), ...table('SCRUB_EXTRA_TEXT'), ...table('SCRUB_MAPS'), ...table('SCRUB_BODIES')];
const STRUCTURAL = table('SCRUB_STRUCTURAL');
/** SCRUB_NESTED: { field: [string leaves scanned one level down] }, read from the worker the same way. */
const NESTED = (() => {
  const m = workerSrc.match(/^const SCRUB_NESTED = (\{.*\});$/m);
  assert.ok(m, 'service-worker.js no longer declares SCRUB_NESTED on one line');
  return new Function(`return ${m[1]}`)();
})();
const line = (re, what) => { const m = workerSrc.match(re); assert.ok(m, `service-worker.js no longer declares ${what}`); return m[0]; };
/** The real scrub, its cache and its pure core, rebuilt from the worker's source around a counting settings stub. */
const makeKit = (settings = {}) => {
  const kit = { reads: 0, settings };
  const cacheBlock = workerSrc.slice(workerSrc.indexOf('let scrubCfg = null;'), workerSrc.indexOf('/** Pure and synchronous'));
  const fn = new Function('getSettings', 'redact', 'isSecretHeader', `
  const TEXT_FIELDS = ${JSON.stringify(table('TEXT_FIELDS'))};
  const SCRUB_EXTRA_TEXT = ${JSON.stringify(table('SCRUB_EXTRA_TEXT'))};
  const SCRUB_MAPS = ${JSON.stringify(table('SCRUB_MAPS'))};
  const SCRUB_BODIES = ${JSON.stringify(table('SCRUB_BODIES'))};
  const SCRUB_NESTED = ${JSON.stringify(NESTED)};
  const SCRUB_DEEP = ${JSON.stringify(table('SCRUB_DEEP'))};
  ${line(/^const DEEP_SKIP = .*;$/m, 'DEEP_SKIP')}
  ${cacheBlock}
  ${lift(workerSrc, 'scrubWith')}
  ${line(/^const scrub = .*;$/m, 'const scrub')}
  return { scrub, dropScrubCfg, cfg: () => scrubCfg };`)(async () => { kit.reads++; const snap = kit.settings; await (kit.gate || Promise.resolve()); return snap; }, redact, isSecretHeader);
  return Object.assign(kit, fn);
};
const makeScrub = (settings = {}) => makeKit(settings).scrub;

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
const CARD = '4539 1488 0343 6467'; // Luhn-valid, not a published test number
const BEARER = 'Bearer abcdefghijklmnop1234567890';

for (const [name, event, read] of [
  ['a JWT in responsePreview', { kind: 'net', responsePreview: `{"token":"${JWT}"}` }, (e) => e.responsePreview],
  ['a Luhn card number in reqBody.text', { kind: 'net', reqBody: { kind: 'text', text: `pan=${CARD}&x=1` } }, (e) => e.reqBody.text],
  ['a ?sig= token in url', { kind: 'net', url: 'https://cdn.example.test/f.png?sig=0123456789abcdef0123' }, (e) => e.url],
  ['a bearer token in a request header value', { kind: 'net', reqHeaders: { 'x-forward': BEARER, accept: '*/*' } }, (e) => e.reqHeaders['x-forward']],
  ['a bearer token in a response header value', { kind: 'net', resHeaders: { link: BEARER } }, (e) => e.resHeaders.link],
  ['a JWT in a stack', { kind: 'console', stack: `Error at fetch(${JWT})` }, (e) => e.stack],
]) {
  test(`scrub redacts ${name}`, async () => {
    const out = await makeScrub()({ ...event });
    const text = read(out);
    assert.ok(text.includes('••••'), `not redacted: ${text}`);
    assert.ok(!/eyJhbGci|4539 1488|0123456789abcdef|abcdefghijklmnop/.test(text), `the secret is still there: ${text}`);
    assert.ok(Array.isArray(out.redacted) && out.redacted.length, 'the families are counted onto the event');
    assert.ok(!JSON.stringify(out.redacted).includes(JWT), 'only the family label is kept, never the value');
  });
}

test('scrub leaves structural fields and header names untouched, and an event with nothing to hide unchanged', async () => {
  const ev = { kind: 'net', method: 'POST', status: 200, durationMs: 123456789012345, url: 'https://a.test/x?page=2', reqHeaders: { accept: 'application/json' }, reqBody: { kind: 'json', text: '{"a":1}' } };
  const out = await makeScrub()(structuredClone(ev));
  assert.deepEqual(out, ev);
  assert.equal(out.redacted, undefined);
});

test('scrub does nothing when redaction is switched off', async () => {
  const ev = { kind: 'net', responsePreview: JWT };
  assert.deepEqual(await makeScrub({ redact: false })({ ...ev }), ev);
});

test('every EVENT_FIELDS entry is declared scanned or structural (a new field must choose)', () => {
  const declared = new Set([...SCANNED, ...STRUCTURAL]);
  const owned = new Set(['kind']);
  for (const [kind, fields] of Object.entries(EVENT_FIELDS)) {
    for (const field of fields) {
      assert.ok(declared.has(field) || owned.has(field), `${kind}.${field} is in neither the scanned lists nor SCRUB_STRUCTURAL in service-worker.js`);
    }
  }
  for (const field of STRUCTURAL) assert.ok(!SCANNED.includes(field), `${field} is declared both scanned and structural`);
});

/* ── r2: the worker's own events are scrubbed too, in every shape they arrive in ─ */

const SECRETS = /eyJhbGci|4539 1488|0123456789abcdef|abcdefghijklmnop|abcd1234efgh|tok_live_0123456789abcdef/;

test('r2-13-1: a UQA_API_RECORD-shaped event is cleaned (array headers, resBody, string reqBody, ?sig= url)', async () => {
  const ev = {
    kind: 'net', via: 'api', method: 'POST', status: 200,
    url: 'https://api.example.test/pay?sig=0123456789abcdef0123&page=2',
    reqHeaders: [{ name: 'Authorization', value: BEARER }, { name: 'Accept', value: '*/*' }, { name: 'X-Trace', value: BEARER }],
    reqBody: `pan=${CARD}&x=1`,
    resHeaders: [{ name: 'Set-Cookie', value: 'sid=plainvalue; HttpOnly' }, { name: 'Content-Type', value: 'application/json' }],
    resBody: `{"token":"${JWT}"}`,
    text: 'Sent POST by hand',
  };
  const out = await makeScrub()(structuredClone(ev));
  assert.ok(!SECRETS.test(JSON.stringify(out)), `a secret survived: ${JSON.stringify(out)}`);
  assert.equal(out.reqHeaders[0].value, '••••••••', 'a secret header is masked whole');
  assert.equal(out.resHeaders[0].value, '••••••••', 'Set-Cookie is masked whole, even when the value has no secret shape');
  assert.equal(out.reqHeaders[1].value, '*/*', 'an ordinary header value is untouched');
  assert.ok(out.reqHeaders[2].value.includes('••••') && !out.reqHeaders[2].value.includes('abcdefghijklmnop'), 'an ordinary header holding a bearer is cleaned');
  assert.equal(out.reqHeaders[0].name, 'Authorization', 'names are never touched');
  assert.equal(out.resHeaders[1].value, 'application/json');
  assert.ok(out.url.includes('page=2'), 'the rest of the url survives');
  assert.ok(Array.isArray(out.redacted) && out.redacted.length);
});

test('r2-13-1: a header MAP naming a secret header is masked whole too', async () => {
  const out = await makeScrub()({ kind: 'net', reqHeaders: { cookie: 'a=b', 'x-api-key': 'k_123', accept: 'text/html' } });
  assert.deepEqual(out.reqHeaders, { cookie: '••••••••', 'x-api-key': '••••••••', accept: 'text/html' });
});

test('r2-13-1: nav url, note text, frameUrl and tabTitle are cleaned', async () => {
  const sc = makeScrub();
  const nav = await sc({ kind: 'nav', url: 'https://app.example.test/cb?sig=0123456789abcdef0123' });
  assert.ok(!SECRETS.test(nav.url) && nav.url.includes('••••'), nav.url);
  const note = await sc({ kind: 'note', tag: 'issue', text: `card ${CARD} declined` });
  assert.ok(!SECRETS.test(note.text), note.text);
  const sender = await sc({ kind: 'click', frameUrl: 'https://app.example.test/p?access_token=tok_live_0123456789abcdef', tabTitle: `Pay ${CARD}` });
  assert.ok(!SECRETS.test(JSON.stringify(sender)), JSON.stringify(sender));
});

test('r2-13-1: appendEvent scrubs before the event is counted or stored (every kind)', async () => {
  const stored = []; const counted = [];
  const kit = makeKit();
  const src = lift(workerSrc, 'appendEvent');
  assert.match(src, /event = await scrub\(event\)/, 'appendEvent no longer calls scrub');
  const appendEvent = new Function('flushEvents', 'scrub', 'noteFinding', 'appendEventNow', 'isTesterRow', 'writeQueue', `async ${src}; return appendEvent;`)(
    async () => {}, kit.scrub, async (_id, e) => { counted.push(e); }, async (e) => { stored.push(e); },
    isTesterRow, { pushTester: async (e) => { stored.push(e); return e; } }); // rule 4: a tester row goes through the queue's tester lane, a machine row straight to the store
  for (const e of [{ kind: 'note', text: `card ${CARD}` }, { kind: 'nav', url: 'https://a.test/?sig=0123456789abcdef0123' }, { kind: 'perf', frameUrl: 'https://a.test/?sig=0123456789abcdef0123' }]) await appendEvent({ sessionId: 's1', ts: 1, ...e });
  assert.equal(stored.length, 3);
  assert.ok(!SECRETS.test(JSON.stringify(stored)) && !SECRETS.test(JSON.stringify(counted)), 'stored or counted event still holds a secret');
});

test('r2-13-1: the ingest site still scrubs (it writes through writeQueue.push, not appendEvent)', () => {
  assert.match(workerSrc, /writeQueue\.push\(await scrub\(\{/);
});

test('r2-03-4: a locator holding a signed href is cleaned, a plain CSS selector is not', async () => {
  const sc = makeScrub();
  const bad = await sc({ kind: 'click', selector: 'a[href="/r?sig=abcd1234efgh5678ijkl"]', locator: 'a[href="/r?sig=abcd1234efgh5678ijkl"]', xpath: '//a[@href="/r?sig=abcd1234efgh5678ijkl"]' });
  assert.ok(!/abcd1234efgh/.test(JSON.stringify(bad)), JSON.stringify(bad));
  const plain = { kind: 'click', selector: 'form#checkout > button.primary:nth-child(2)', locator: "getByRole('button', { name: 'Pay' })", xpath: '//form[@id="checkout"]/button[2]' };
  assert.deepEqual(await sc({ ...plain }), plain);
  assert.ok(!STRUCTURAL.some((f) => ['locator', 'selector', 'xpath'].includes(f)));
  assert.ok(['locator', 'selector', 'xpath'].every((f) => SCANNED.includes(f)));
});

test('r2-01-1: the settings are read a small constant number of times over 1000 events, and the push order is arrival order', async () => {
  const kit = makeKit({ redact: true, redactExtra: [] });
  const pushed = [];
  const one = async (i) => { const r = kit.scrub({ kind: 'note', seq: i, text: `n ${i}` }); pushed.push((await r).seq); };
  // cold burst: every call shares the one read
  await Promise.all(Array.from({ length: 500 }, (_, i) => one(i)));
  // warm: synchronous, no promise at all
  const warm = kit.scrub({ kind: 'note', text: 'x' });
  assert.ok(!(warm instanceof Promise), 'a warm scrub is synchronous');
  await Promise.all(Array.from({ length: 500 }, (_, i) => one(500 + i)));
  assert.ok(kit.reads <= 2, `settings were read ${kit.reads} times for 1000 events`);
  assert.deepEqual(pushed, Array.from({ length: 1000 }, (_, i) => i), 'events were queued out of arrival order');
});

test('r2-01-1: a settings change drops the cache, and the next event sees the new setting', async () => {
  const kit = makeKit({ redact: true, redactExtra: [] });
  await kit.scrub({ kind: 'note', text: 'warm up' });
  assert.ok(kit.cfg());
  kit.settings = { redact: false, redactExtra: [] };
  assert.equal((await kit.scrub({ kind: 'note', text: `card ${CARD}` })).text.includes('4539'), false, 'until the listener fires the cached (safe) setting applies');
  kit.dropScrubCfg();
  assert.equal(kit.cfg(), null);
  const after = await kit.scrub({ kind: 'note', text: `card ${CARD}` });
  assert.ok(after.text.includes('4539'), 'after the drop the new setting (off) applies');
  assert.equal(kit.reads, 2);
});

test('r2-01-1: the existing storage.onChanged listener drops the cache on a settings or managed change', () => {
  assert.match(workerSrc, /if \(area === 'managed' \|\| 'settings' in c\) dropScrubCfg\(\);/);
});

/* ── r3: nested page text, a stale settings read, worker-written events, key/value secrets ─ */

test('r3-03-3: expected.text and overflow[].text are scanned, and counted on event.redacted', async () => {
  const sc = makeScrub();
  const picked = await sc({ kind: 'selectorcopy', tag: 'p', expected: { kind: 'text', text: CARD, tag: 'p' } });
  assert.ok(!picked.expected.text.includes('4539'), picked.expected.text);
  assert.ok(picked.expected.text.includes('••••'));
  assert.equal(picked.expected.kind, 'text', 'the rest of the object is untouched');
  assert.ok(picked.redacted.includes('Payment card numbers'));
  const rtl = await sc({ kind: 'rtl', overflow: [{ selector: 'div.a', text: `jwt ${JWT}` }, { selector: 'div.b', text: 'fine' }] });
  assert.ok(!JSON.stringify(rtl).includes('eyJhbGci'), JSON.stringify(rtl));
  assert.equal(rtl.overflow[1].text, 'fine');
  assert.equal(rtl.overflow[0].selector, 'div.a');
  assert.ok(rtl.redacted.includes('JSON web tokens'));
  const clean = { kind: 'selectorcopy', expected: { text: 'Pay now' } };
  assert.deepEqual(await sc(structuredClone(clean)), clean);
});

test('r3-03-3: the nested table names its fields, each a declared structural field with a text leaf', () => {
  assert.deepEqual(Object.keys(NESTED).sort(), ['expected', 'overflow']);
  for (const [field, leaves] of Object.entries(NESTED)) {
    assert.ok(STRUCTURAL.includes(field), `${field} is not declared`);
    assert.ok(leaves.includes('text'), `${field}.text is page text and must be listed`);
    assert.ok(Object.values(EVENT_FIELDS).some((f) => f.includes(field)), `${field} is not an event field`);
  }
});

test('carry-over: dom.control is an event field and a declared structural field, together', () => {
  assert.ok(EVENT_FIELDS.dom.includes('control'));
  assert.ok(STRUCTURAL.includes('control'));
  const ev = sanitiseEvent({ kind: 'dom', action: 'change', value: 'checked', control: 'checkbox' }, {});
  assert.equal(ev.control, 'checkbox', 'sanitiseEvent no longer drops it');
});

test('r3-03-2: a settings change that lands mid-read leaves the cache cold, and the next event sees the new setting', async () => {
  const kit = makeKit({ redact: true, redactExtra: [] });
  let release;
  kit.gate = new Promise((r) => { release = r; });
  const inFlight = kit.scrub({ kind: 'note', text: `card ${CARD}` }); // the read starts with redaction on
  kit.settings = { redact: false, redactExtra: [] };
  kit.dropScrubCfg(); // storage.onChanged fires while the read is open
  kit.gate = null;
  release();
  await inFlight;
  assert.equal(kit.cfg(), null, 'the pre-change settings were cached');
  const after = await kit.scrub({ kind: 'note', text: `card ${CARD}` });
  assert.ok(after.text.includes('4539'), 'the next event must be scrubbed by the new (off) setting');
  assert.equal(kit.reads, 2);
});

test('r3-02-2: markdown (the fine-print event) is scanned', async () => {
  assert.ok(table('SCRUB_EXTRA_TEXT').includes('markdown'));
  const out = await makeScrub()({ kind: 'fineprint', markdown: '- GET https://a.test/cb?access_token=abcd1234efgh5678 had no HSTS\n- plain line', checks: [], manual: [] });
  assert.ok(!out.markdown.includes('abcd1234efgh'), out.markdown);
  assert.ok(out.markdown.includes('plain line'));
  assert.ok(out.redacted.length);
});

test('r3-02-1: a key/value secret in a truncated responsePreview and in a request body is masked by the worker scrub', async () => {
  const sc = makeScrub();
  const cut = await sc({ kind: 'net', responsePreview: '{"user":{"id":7},"access_token":"q1w2e3r4t5y6u7i8' });
  assert.ok(!cut.responsePreview.includes('q1w2e3r4t5y6'), cut.responsePreview);
  assert.ok(cut.responsePreview.startsWith('{"user":{"id":7},"access_token":"'));
  const form = await sc({ kind: 'net', reqBody: { kind: 'text', text: 'user=a&password=hunter2abc&remember=1' } });
  assert.equal(form.reqBody.text, 'user=a&password=••••••••&remember=1');
  const prose = { kind: 'net', responsePreview: '{"tokenCount":5,"message":"Enter your password"}' };
  assert.deepEqual(await sc({ ...prose }), prose);
});

/* ── council-1009 r4, lane L2: the worker's own records ───────────────────── */

test('r4-03-1: startSession stores startUrl masked, and no startUrl assignment skips redact', () => {
  const storedUrl = new Function('redact', `${lift(workerSrc, 'storedUrl')}; return storedUrl;`)(redact);
  const on = { on: true, extra: [] };
  const masked = storedUrl('https://a.test/cb?access_token=abcdefgh12345678&page=2', on);
  assert.ok(!masked.includes('abcdefgh12345678'), masked);
  assert.ok(masked.includes('page=2') && masked.startsWith('https://a.test/cb'));
  assert.equal(storedUrl('https://a.test/cb?access_token=abcdefgh12345678', { on: false, extra: [] }).includes('abcdefgh12345678'), true, 'redaction off is the tester\'s choice');
  assert.equal(storedUrl(null, on), null);
  const start = workerSrc.indexOf('async function runStart(');
  const body = workerSrc.slice(start, workerSrc.indexOf('\n}\n', start));
  const assigns = body.split('\n').filter((l) => /^\s+startUrl: /.test(l));
  assert.ok(assigns.length >= 1 && assigns.every((l) => l.includes('storedUrl(')), `a startUrl in startSession is stored raw: ${assigns}`);
  assert.ok(lift(workerSrc, 'storedUrl').includes('redact('));
  assert.match(workerSrc, /safeCookies\(rawStartUrl\.get\(id\) \?\? session\.startUrl\)/, 'the cookie read keeps the raw URL from memory');
});

test('r4-03-2 / r3-02-2: nested a11y and perf leaves are scrubbed, counted, and the structure is kept', async () => {
  const sc = makeScrub();
  const a11y = await sc({
    kind: 'a11y', total: 2, byImpact: { critical: 1 },
    violations: [{ id: 'link-name', impact: 'critical', count: 1, nodes: [{ html: '<a href="/reset?sig=0123456789abcdef0123">x</a>', target: ['a'] }] }],
    frames: [{ url: 'https://f.test/?sig=0123456789abcdef0123', count: 3 }],
  });
  assert.ok(!JSON.stringify(a11y).includes('0123456789abcdef'), JSON.stringify(a11y));
  assert.equal(a11y.violations[0].id, 'link-name');
  assert.equal(a11y.violations[0].impact, 'critical');
  assert.equal(a11y.violations[0].count, 1);
  assert.ok(a11y.redacted.length);
  const perf = await sc({ kind: 'perf', resources: { count: 4, slowest: [{ url: 'https://c.test/a.js?X-Amz-Signature=0123456789abcdef0123', ms: 900 }], uncompressedBig: [{ url: 'https://c.test/b.js?X-Amz-Signature=0123456789abcdef0123', bytes: 99 }] } });
  assert.ok(!JSON.stringify(perf).includes('0123456789abcdef'), JSON.stringify(perf));
  assert.equal(perf.resources.slowest[0].ms, 900);
  assert.ok(perf.redacted.length);
  const fine = await sc({ kind: 'fineprint', checks: [{ id: 'hsts', note: 'GET https://a.test/cb?access_token=abcd1234efgh5678' }], manual: ['see https://a.test/?sig=0123456789abcdef0123'] });
  assert.ok(!JSON.stringify(fine).includes('abcd1234efgh') && !JSON.stringify(fine).includes('0123456789abcdef'), JSON.stringify(fine));
  const clean = { kind: 'a11y', violations: [{ id: 'x', nodes: [{ html: '<b>hi</b>' }] }] };
  assert.deepEqual(await sc(structuredClone(clean)), clean, 'nothing to hide, nothing changed');
  // bounded: a hostile depth is left alone, not walked into the ground
  let deep = 'tail?sig=0123456789abcdef0123';
  for (let i = 0; i < 40; i++) deep = { n: deep };
  await sc({ kind: 'a11y', violations: [deep] });
});

test('r4-03-2: every field the worker writes on its own kinds is scanned, deep-scanned, structural or a number', () => {
  const declared = new Set([...SCANNED, ...STRUCTURAL, ...table('SCRUB_DEEP'), ...Object.keys(NESTED)]);
  const numeric = new Set(['ts', 'sessionId', 'tabId', 'total', 'byImpact', 'frameCount', 'framesRefused', 'metrics', 'rules', 'seq']);
  const written = { a11y: ['url', 'total', 'byImpact', 'violations', 'frameUrl', 'frames', 'frameCount', 'framesRefused'], perf: ['url', 'metrics', 'resources', 'frameUrl'], fineprint: ['markdown', 'checks', 'manual'], nav: ['url'], selectorcopy: ['locator', 'expected'] };
  for (const [kind, fields] of Object.entries(written)) for (const f of fields) assert.ok(declared.has(f) || numeric.has(f), `${kind}.${f} is not declared in the scrub tables`);
  assert.deepEqual(table('SCRUB_DEEP'), ['violations', 'frames', 'resources', 'checks', 'manual']);
});

test('r4-01-2: a vault-locked read is not kept as a promise; the next call reads again and applies the extras', async () => {
  const nid = 'id 9871023456 here';
  const kit = makeKit({ vaultLocked: true, redact: true, redactExtra: [] });
  const first = await kit.scrub({ kind: 'note', text: nid });
  assert.equal(first.text, nid, 'the fallback has no extras');
  kit.settings = { redact: true, redactExtra: ['nationalId'] };
  const second = await kit.scrub({ kind: 'note', text: nid });
  assert.ok(!second.text.includes('9871023456'), `the second call still used the fallback: ${second.text}`);
  assert.equal(kit.reads, 2);
});

test('r4-03-6: the pending-clip sweep clears old rows, keeps new ones and the live clip', async () => {
  const cleared = [];
  const rows = [{ id: 'old', startedAt: 100 }, { id: 'new', startedAt: 10_000 }, { id: 'live', startedAt: 100 }, { id: 'nostamp' }];
  const sweep = new Function('listMediaPending', 'clearMediaParts', `${'async ' + lift(workerSrc, 'sweepPendingMedia')}; return sweepPendingMedia;`)(async () => rows, async (id) => { cleared.push(id); });
  await sweep(5000, { recording: true, id: 'live' });
  assert.deepEqual(cleared, ['old']);
  const purge = workerSrc.slice(workerSrc.indexOf('async function purgeExpired()'));
  assert.match(purge, /await sweepPendingMedia\(cutoff, await recordingState\(\)\.catch\(\(\) => null\), new Set\(liveIds\)\)/, 'purgeExpired calls it');
  assert.ok(purge.indexOf('await sweepPendingMedia(') < purge.indexOf('keptForever: true'), 'D-1010-106: before the retention guard');
  cleared.length = 0; // D-1010-106: rows of a deleted session go whatever the window (cutoff -1 = keep forever); a live or unfiled session stays
  const rows2 = [{ id: 'gone', sessionId: 'dead', startedAt: 100 }, { id: 'kept', sessionId: 'alive', startedAt: 100 }, { id: 'unf', sessionId: 'unfiled', startedAt: 100 }];
  await new Function('listMediaPending', 'clearMediaParts', `${'async ' + lift(workerSrc, 'sweepPendingMedia')}; return sweepPendingMedia;`)(async () => rows2, async (id) => { cleared.push(id); })(-1, null, new Set(['alive']));
  assert.deepEqual(cleared, ['gone']);
});

test('carry-timebox-legacy: startup and install clear the bare timebox alarm', () => {
  const clears = workerSrc.match(/chrome\.alarms\.clear\('timebox'\)/g) || [];
  assert.equal(clears.length, 2, 'both onStartup and onInstalled');
  assert.ok(!/alarms\.create\('timebox'/.test(workerSrc), 'nothing creates the bare alarm any more');
});

test('D-1010-99 / r5-05-5: a route nav equal to the tab\'s last route nav is skipped; a document nav resets it; other tabs are independent', async () => {
  const events = [];
  const recordNav = new Function('lastRouteUrl', 'forgetInvoked', 'activeSessionId', 'armed', 'isInternalUrl', 'belongsToSession', 'appendEvent', 'paintBadge', `async ${lift(workerSrc, 'recordNav')}; return recordNav;`)(
    new Map(), async () => {}, async () => 's1', { isArmedTab: async () => true }, () => false, async () => true, async (e) => { events.push(e); }, () => {});
  const nav = (url, route, tabId = 1) => recordNav({ frameId: 0, tabId, url, transitionType: 'link' }, route);
  await nav('https://a.test/x', true); await nav('https://a.test/x', true); await nav('https://a.test/x', true);
  assert.equal(events.length, 1, 'three equal route navs make one row');
  await nav('https://a.test/y', true);
  assert.equal(events.length, 2);
  await nav('https://a.test/x', true);
  assert.equal(events.length, 3, 'a different url in between is a real change');
  await nav('https://a.test/x', false);
  await nav('https://a.test/x', true);
  assert.equal(events.length, 5, 'a document nav resets the memory');
  await nav('https://a.test/x', true, 2);
  assert.equal(events.length, 6, 'another tab is independent');
});

test('r5-13-1: syncSiteScripts without chrome.scripting returns { matches: [], changed: false }, the same shape as every other path', async () => {
  globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}) }, onChanged: { addListener() {} } }, runtime: { getManifest: () => ({}) } };
  const site = await import('../background/site-access.js?nostub');
  assert.deepEqual(await site.syncSiteScripts(), { matches: [], changed: false });
});

test('D-1010-108 writer half: the two zero-count capture-gap notes carry gap codes', () => {
  assert.match(workerSrc, /tag: 'capture-gap', gap: 'coverage-detached'/);
  assert.match(workerSrc, /tag: 'capture-gap', gap: 'recording-orphaned'/);
});

test('r6-05-2 (D-1010-128): two frames with one frameUrl keep their own frameId, and the page cannot name one', () => {
  const a = clean({ kind: 'pageerror', text: 'boom', frameId: 99 }, { frameId: 0 });
  const b = clean({ kind: 'pageerror', text: 'boom', frameId: 99 }, { frameId: 7 });
  assert.equal(a.frameUrl, b.frameUrl, 'the same frameUrl');
  assert.deepEqual([a.frameId, b.frameId], [0, 7], 'the sender frameId wins over anything the page claims');
  assert.ok(!('frameId' in clean({ kind: 'pageerror', text: 'boom', frameId: 99 })), 'no sender frameId, no frameId stored');
});

test('r6-05-2 (D-1010-128): the real ingest() hands the sender frameId to sanitiseEvent', () => {
  assert.match(workerSrc, /sanitiseEvent\(event, .*\{ frameUrl: sender\?\.url \?\? null, frameId: sender\?\.frameId,/);
  // Limit, written down: worker-side network events (webRequest) are not stamped with a frameId.
});

await queue;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
