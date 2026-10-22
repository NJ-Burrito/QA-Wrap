/* T-066: a flipped byte in a stored screenshot reads "content changed"; the card and footer carry the checksum. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
const { stampPng } = await import('../core/provenance-stamp.js');
const { originCheck, sha256Hex, checksumLine, captureHashes } = await import('../core/integrity.js');
const { buildSessionManifest } = await import('../core/docs.js');

// a real 1x1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const blob = await stampPng(new Blob([png], { type: 'image/png' }), { version: '3.3.0', kind: 'screenshot' });
const bytes = new Uint8Array(await blob.arrayBuffer());
let n = 0; const ok = (name) => { n++; console.log(`  ok  ${name}`); };

assert.equal(await sha256Hex(Buffer.from('abc')), createHash('sha256').update('abc').digest('hex')); ok('sha256Hex matches node:crypto');
assert.equal((await originCheck(bytes)).status, 'intact'); ok('a stamped PNG is intact');
const flipped = bytes.slice(); flipped[flipped.indexOf(0x78) + 3] ^= 1; // inside the IDAT zlib stream
assert.equal((await originCheck(flipped)).status, 'content changed'); ok('one flipped byte reads "content changed"');
const first = bytes.slice(); first[20] ^= 1; // IHDR
assert.equal((await originCheck(first)).status, 'content changed'); ok('a flipped header byte reads "content changed"');
assert.equal((await originCheck(new Uint8Array([1, 2, 3]))).status, 'no checksum'); ok('no checksum is said, not guessed');
const hex = await sha256Hex(Buffer.from('log'));
assert.equal((await originCheck(Buffer.from('log'), { sha256: hex })).status, 'intact');
assert.equal((await originCheck(Buffer.from('log!'), { sha256: hex })).status, 'content changed'); ok('non-PNG artifact checked against the card hash');

assert.match(checksumLine({ c_1: hex }), /^SHA-256 checksums: c_1 [0-9a-f]{16}$/); ok('footer line names the algorithm and the id');
assert.deepEqual(await captureHashes({ a: { sha256: 'x' }, b: { blob: new Blob(['log']) } }), { a: 'x', b: hex }); ok('legacy records are hashed from the blob');
const card = JSON.parse(buildSessionManifest({ id: 's', startedAt: 0 }, [], { checksums: { c_1: hex } }));
assert.equal(card.checksums.c_1, hex); ok('session card carries the checksums');
const sec = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8');
assert.match(sec, /not a signature/); assert.match(sec, /content changed/); ok('SECURITY.md says checksum, not signature, and the forgery limit');
const ex = readFileSync(new URL('../core/exporters.js', import.meta.url), 'utf8');
assert.match(ex, /checksumFooter/); ok('the report footer prints the checksums');

// T-066: documents carry the checksum in full, JSON lists it, every result names the hash of its own bytes.
const { stampDocument, withSha256, checksumFooter } = await import('../core/provenance-stamp.js');
const full = { c_1: hex, c_2: '' };
assert.equal(checksumFooter(full), `SHA-256 checksums: c_1 ${hex}`); assert.equal(hex.length, 64); ok('footer prints the full 64-character hash and skips an empty one');
assert.equal(checksumFooter({}), ''); ok('no screenshots, no footer');
assert.match(checksumFooter(full, 'ar', true), /المجاميع الاختبارية SHA-256: c_1 <bdi>[0-9a-f]{64}<\/bdi>/); ok('Arabic document footer is Arabic with the hex isolated');
const md = await stampDocument({ content: '# Report\n\nbody\n\n', mime: 'text/markdown' }, { format: 'markdown', hashes: full });
assert.ok(md.content.endsWith(`\n\nSHA-256 checksums: c_1 ${hex}\n`)); ok('Markdown ends with the checksum line');
const js = await stampDocument({ content: JSON.stringify({ a: 1 }) }, { format: 'json', hashes: full });
assert.deepEqual(JSON.parse(js.content), { a: 1, checksums: { c_1: hex } }); ok('the session JSON lists the screenshot checksums');
const same = { content: 'x', mime: 'text/plain' };
assert.equal(await stampDocument(same, { format: 'har', hashes: full }), same); ok('a format with no footer is untouched');
assert.equal((await stampDocument({ content: '{broken' }, { format: 'json', hashes: full })).content, '{broken'); ok('JSON that does not parse is passed on, not lost');
assert.equal(await stampDocument(md, { format: 'markdown', hashes: {} }), md); ok('no hashes, nothing appended');
assert.equal((await withSha256({ content: 'abc' })).sha256, createHash('sha256').update('abc').digest('hex')); ok('every text result names the SHA-256 of its bytes');
assert.equal((await withSha256({ content: Buffer.from('abc').toString('base64'), encoding: 'base64' })).sha256, createHash('sha256').update('abc').digest('hex')); ok('a workbook or gzip result names the hash of the decoded bytes');
const off = readFileSync(new URL('../offscreen/offscreen.js', import.meta.url), 'utf8');
assert.match(off, /stampDocument\(out, \{ format: request\.format/); assert.match(off, /return withSha256\(out\)/); ok('the offscreen export door stamps before it compresses and hashes what it returns');
// T-066: the Origin button in the report runs the same check on the stored bytes and says it in words, en and ar.
const rep = readFileSync(new URL('../report/report.js', import.meta.url), 'utf8');
assert.match(rep, /import\('\.\.\/core\/integrity\.js'\)\)\.originCheck\(await got\.blob\.arrayBuffer\(\)\)/); assert.match(rep, /'content changed': 'report\.media\.contentChanged'/); ok('the report Origin button hashes the stored bytes with originCheck');
const words = { en: JSON.parse(readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8')), ar: JSON.parse(readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8')) };
assert.match(words.en['report.media.contentChanged'], /content changed/); assert.match(words.ar['report.media.contentChanged'], /المحتوى تغيّر/);
assert.ok(words.en['report.media.contentIntact'] && words.ar['report.media.contentIntact'] && words.en['report.media.noChecksum'] && words.ar['report.media.noChecksum']); ok('the three Origin answers are worded in en and ar');
const stored = new Blob([flipped], { type: 'image/png' }); // what getMedia hands the report after one byte went bad
assert.equal((await originCheck(await stored.arrayBuffer())).status, 'content changed'); ok('a stored blob with one flipped byte reaches the report as "content changed"');
console.log(`${n} passed, 0 failed`);
