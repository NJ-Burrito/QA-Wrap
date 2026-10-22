/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Compression, checked against an oracle that is not itself.
 *
 * Two places compress: exports over 256 KB (`core/exporters.js`, applied by the
 * worker's `exportSession`) and request/response bodies over 8 KB on their way
 * into the store (`core/db.js`). Both use the platform's own
 * `CompressionStream('gzip')` — no dependency, and the same API in Chrome and
 * in Node 18+.
 *
 * The point of this file is that it does NOT check our compressor against our
 * decompressor. A round trip through one buggy pair proves nothing: an
 * implementation that XORed every byte would pass it. Node's `zlib` is a
 * separate implementation of RFC 1952, so every claim below is checked both
 * ways — what we write, `zlib` reads; what `zlib` writes, we read. If those two
 * ever disagree, the bytes on a tester's disk are not gzip and the `.gz` on the
 * filename is a lie.
 *
 * Runs in plain Node. No Chrome, no IndexedDB: `deflateEvent`/`inflateEvent`
 * are pure functions of an event object, which is why they are exported.
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  gzipText, gunzipText, gzName, shouldGzipExport, byteLength,
  GZIP_THRESHOLD, GZIP_FORMATS, GZIP_MIME,
} from '../core/exporters.js';
import { deflateEvent, inflateEvent, BODY_GZ_THRESHOLD } from '../core/db.js';
import { exportPath, gzPath } from '../core/filing.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** A payload that looks like what actually gets compressed: repeated JSON keys. */
const jsonish = (n) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({
    id: i,
    url: `https://api.example.test/v2/orders/${i}`,
    status: 200,
    message: 'the request completed normally',
  })));

console.log('compression — gzip, checked against node:zlib');

/* ── the compressor itself ──────────────────────────────────────────────── */

await test('what we gzip, zlib ungzips — byte for byte', async () => {
  const text = jsonish(500);
  const ours = await gzipText(text);
  assert.equal(zlib.gunzipSync(Buffer.from(ours)).toString('utf8'), text);
});

await test('what zlib gzips, we ungzip — byte for byte', async () => {
  const text = jsonish(500);
  const theirs = zlib.gzipSync(Buffer.from(text, 'utf8'));
  assert.equal(await gunzipText(new Uint8Array(theirs)), text);
});

await test('the output really is gzip, not deflate — the magic number says so', () => {
  // 0x1f 0x8b is the RFC 1952 header. A `deflate-raw` stream would round-trip
  // through our own pair perfectly and be unreadable by every archiver on the
  // tester's machine, which is exactly the failure this catches.
  return gzipText('hello').then((bytes) => {
    assert.equal(bytes[0], 0x1f);
    assert.equal(bytes[1], 0x8b);
  });
});

await test('Arabic survives the round trip, in both directions', async () => {
  // UTF-8 and gzip are independent, but a compressor that decoded to Latin-1
  // somewhere in the middle would pass every ASCII test above and destroy every
  // Arabic session report. Checked in both implementations.
  const text = 'فشل الطلب: لم يستجب الخادم خلال المهلة المحددة. '.repeat(400);
  assert.equal(zlib.gunzipSync(Buffer.from(await gzipText(text))).toString('utf8'), text);
  assert.equal(await gunzipText(new Uint8Array(zlib.gzipSync(Buffer.from(text, 'utf8')))), text);
});

await test('compression actually saves something on a real export shape', async () => {
  const text = jsonish(4000);
  const bytes = await gzipText(text);
  assert.ok(bytes.length < byteLength(text) / 4,
    `expected better than 4:1 on repeated JSON, got ${byteLength(text)} → ${bytes.length}`);
});

/* ── which exports get compressed ───────────────────────────────────────── */

await test('the JSON family over the threshold is compressed', () => {
  const big = 'x'.repeat(GZIP_THRESHOLD + 1);
  for (const format of GZIP_FORMATS) {
    assert.equal(shouldGzipExport(format, big), true, `${format} should compress`);
  }
});

await test('the same formats under the threshold are left plain', () => {
  const small = 'x'.repeat(GZIP_THRESHOLD);
  for (const format of GZIP_FORMATS) {
    assert.equal(shouldGzipExport(format, small), false, `${format} at exactly the threshold stays plain`);
  }
});

await test('a report a person opens is never compressed, however big', () => {
  const huge = 'x'.repeat(GZIP_THRESHOLD * 4);
  // These are the ones somebody double-clicks out of the download bar. A
  // `.md.gz` that will not open is a worse outcome than a large file.
  for (const format of ['markdown', 'html', 'text', 'csv', 'junit', 'yaml', 'srs', 'manual', 'playwright', 'sbtm']) {
    assert.equal(shouldGzipExport(format, huge), false, `${format} must stay readable`);
  }
});

await test('the threshold is bytes, not characters', () => {
  // 'ب' is two bytes in UTF-8. Half the threshold in characters is over it in
  // bytes, and an Arabic session export that counted `length` would be written
  // plain while an identical English one was compressed.
  const arabic = 'ب'.repeat(Math.floor(GZIP_THRESHOLD / 2) + 8);
  assert.ok(arabic.length < GZIP_THRESHOLD, 'the string is under the threshold in characters');
  assert.ok(byteLength(arabic) > GZIP_THRESHOLD, 'and over it in bytes');
  assert.equal(shouldGzipExport('json', arabic), true);
});

await test('a non-string export — a base64 workbook — is never gzipped here', () => {
  assert.equal(shouldGzipExport('json', new Uint8Array(GZIP_THRESHOLD * 2)), false);
  assert.equal(shouldGzipExport('json', null), false);
  assert.equal(shouldGzipExport('json', undefined), false);
});

/* ── the name on disk ───────────────────────────────────────────────────── */

await test('.gz is appended, never substituted', () => {
  assert.equal(gzName('qaw-session.json'), 'qaw-session.json.gz');
  assert.equal(gzPath('QA Wrap/Reports/Session-2026-09-05.json'), 'QA Wrap/Reports/Session-2026-09-05.json.gz');
});

await test('naming a gzipped file twice does not produce .gz.gz', () => {
  assert.equal(gzName(gzName('a.json')), 'a.json.gz');
  assert.equal(gzPath(gzPath('a/b.json')), 'a/b.json.gz');
});

await test('exportPath carries the suffix only when asked', () => {
  const session = { startedAt: Date.UTC(2026, 8, 5, 12, 0, 0), charter: 'Checkout' };
  const plain = exportPath('json', session, { clock: '24' });
  const zipped = exportPath('json', session, { clock: '24', gz: true });
  assert.ok(plain.endsWith('.json'), plain);
  assert.equal(zipped, `${plain}.gz`);
});

await test('the gzip MIME type is the one archivers register', () => {
  assert.equal(GZIP_MIME, 'application/gzip');
});

/* ── bodies on the way into the store ───────────────────────────────────── */

const netEvent = (extra) => ({ kind: 'net', method: 'POST', url: 'https://api.example.test/orders', status: 200, ...extra });

await test('a body over 8 KB is stored as bodyGz and the plain field is gone', async () => {
  const body = jsonish(400);
  assert.ok(byteLength(body) > BODY_GZ_THRESHOLD, 'the fixture must actually be over the threshold');
  const stored = await deflateEvent(netEvent({ reqBody: body }));
  assert.equal(stored.reqBody, undefined, 'the plain body must not also be stored');
  assert.ok(stored.bodyGz instanceof ArrayBuffer, 'bodyGz must be an ArrayBuffer, which IndexedDB stores as bytes');
  assert.deepEqual(stored.bodyGzFields, ['reqBody']);
});

await test('zlib reads what the store wrote — it is real gzip on disk', async () => {
  const body = jsonish(400);
  const stored = await deflateEvent(netEvent({ reqBody: body, responsePreview: 'ok' }));
  const round = JSON.parse(zlib.gunzipSync(Buffer.from(stored.bodyGz)).toString('utf8'));
  assert.equal(round.reqBody, body);
  assert.equal(round.responsePreview, 'ok');
});

await test('the reader puts every body back exactly as it went in', async () => {
  const before = netEvent({ reqBody: jsonish(300), responsePreview: jsonish(300) });
  const after = await inflateEvent(await deflateEvent(before));
  assert.deepEqual(after, before);
});

await test('a small body is left alone — gzip would make it bigger', async () => {
  const before = netEvent({ reqBody: '{"ok":true}' });
  const after = await deflateEvent(before);
  assert.equal(after, before, 'the very same object, not a copy');
  assert.equal(after.bodyGz, undefined);
});

await test('an object-shaped reqBody is stored and restored as an object', async () => {
  // `safeBody()` in content/page-hooks.js returns `{ kind, text }`, never a
  // string. An earlier draft of this only compressed strings, so the one field
  // most likely to be large was silently exempt.
  const body = { kind: 'json', text: jsonish(400) };
  const stored = await deflateEvent(netEvent({ reqBody: body }));
  assert.ok(stored.bodyGz, 'an object body over the threshold must compress');
  assert.deepEqual((await inflateEvent(stored)).reqBody, body);
});

await test('the cap in content/page-hooks.js is what keeps this dormant', () => {
  // Stated as a test so the day somebody raises MAX_BODY, this line is the
  // thing that tells them the compression they forgot about has just woken up.
  const MAX_BODY = 2000;   // content/page-hooks.js:18
  assert.ok(MAX_BODY * 2 < BODY_GZ_THRESHOLD,
    'a net event can now exceed the threshold — the storage compression is live, ' +
    'and the measurement in research/20-backend-batch4.md needs redoing');
});

await test('the two bodies are weighed together, not one at a time', async () => {
  // Either alone is under the threshold; together they are over it, and
  // together is how they are stored.
  const half = 'y'.repeat(Math.floor(BODY_GZ_THRESHOLD * 0.6));
  const stored = await deflateEvent(netEvent({ reqBody: half, responsePreview: half }));
  assert.ok(stored.bodyGz, 'the pair is over the threshold');
  assert.deepEqual(stored.bodyGzFields, ['reqBody', 'responsePreview']);
});

await test('only network events are touched', async () => {
  // A console line or a DOM step has no body and must not grow a bodyGz field
  // that every reader would then have to inflate for nothing.
  for (const kind of ['console', 'dom', 'note', 'pageerror', 'rtl', 'inject', 'screenshot', 'recording']) {
    const ev = { kind, text: 'z'.repeat(BODY_GZ_THRESHOLD * 2), reqBody: 'z'.repeat(BODY_GZ_THRESHOLD * 2) };
    assert.equal((await deflateEvent(ev)).bodyGz, undefined, `${kind} must be stored as it is`);
  }
});

await test('an event with no bodies at all is returned untouched', async () => {
  const before = netEvent({});
  assert.equal(await deflateEvent(before), before);
});

await test('the fields the timeline filters on stay readable', async () => {
  // Status, URL, method and duration are what a reader sorts and colours by.
  // If compressing the bodies took those with them, every timeline row would
  // cost an inflate.
  const stored = await deflateEvent(netEvent({ reqBody: jsonish(400), durationMs: 812 }));
  assert.equal(stored.status, 200);
  assert.equal(stored.url, 'https://api.example.test/orders');
  assert.equal(stored.method, 'POST');
  assert.equal(stored.durationMs, 812);
});

await test('deflating twice does not double-compress', async () => {
  const once = await deflateEvent(netEvent({ reqBody: jsonish(400) }));
  const twice = await deflateEvent(once);
  assert.equal(twice, once, 'an already-compressed event is returned as it is');
});

await test('a corrupt bodyGz costs the bodies, not the event', async () => {
  // The status and the URL are still the evidence. A row that threw on read
  // would take the whole session report down with it.
  const broken = { ...netEvent({}), bodyGz: new Uint8Array([1, 2, 3, 4]).buffer, bodyGzFields: ['reqBody'] };
  const out = await inflateEvent(broken);
  assert.equal(out.status, 200);
  assert.equal(out.bodyGz, undefined);
  assert.ok(out.bodyGzError, 'the failure is recorded rather than swallowed');
});

await test('a reader can be run on any event, compressed or not', async () => {
  const plain = netEvent({ reqBody: 'small' });
  assert.equal(await inflateEvent(plain), plain);
  assert.equal(await inflateEvent(null), null);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
