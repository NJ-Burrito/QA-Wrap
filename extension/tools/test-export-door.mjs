/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-066: what the offscreen export door does to a built export (stamp, compress, hash).
 *
 *   node tools/test-export-door.mjs
 *
 * Runs the real `offExport` from `offscreen/offscreen.js` (its source is cut out and loaded with a stub
 * builder and a stub database, the way `test-draft-door.mjs` does for `offDraft`), so the wiring is
 * what is checked, not a test's own copy of it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readZipBuffer } from './lib-zip.mjs';
import { buildBundleZip } from '../core/presets.js';
import { buildMarkdown } from '../core/artifact-docs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'offscreen/offscreen.js'), 'utf8');
const start = src.indexOf('async function offExport');
const end = src.indexOf('\nlet trackersMod', start);
assert.ok(start > 0 && end > start, 'offExport and shotHashes are not where this test cuts them');
const core = `${pathToFileURL(path.join(root, 'core')).href}/`;
const body = src.slice(start, end).replaceAll("'../core/", `'${core}`);
const tmp = path.join(os.tmpdir(), `uqa-offexport-${process.pid}.mjs`);
fs.writeFileSync(tmp, [
  `import { stampDocument, withSha256 } from '${core}provenance-stamp.js';`,
  `import { captureHashes } from '${core}integrity.js';`,
  'const exportLib = async () => globalThis.__lib;',
  'const dbLib = async () => globalThis.__db;',
  'const offDraft = async () => "draft";',
  body,
  'export { offExport };',
].join('\n'));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const HEX = sha('shot one');
const BLOB = new Blob(['shot two']);
const BLOB_HEX = sha('shot two');
let built = {};
globalThis.__lib = { buildExport: async (req) => built[req.format] };
globalThis.__db = {
  getEvents: async () => [{ kind: 'screenshot', captureId: 'c_1' }, { kind: 'screenshot', captureId: 'c_2' }, { kind: 'screenshot' }, { kind: 'note' }],
  getCaptures: async (ids) => { assert.deepEqual(ids, ['c_1', 'c_2']); return { c_1: { sha256: HEX }, c_2: { blob: BLOB } }; },
};
const { offExport } = await import(pathToFileURL(tmp).href);

let n = 0;
const ok = (name) => { n++; console.log(`  ok  ${name}`); };

built = { markdown: { filename: 'a.md', mime: 'text/markdown', content: '# Report\n\nbody\n' } };
for (const op of ['session', 'build']) {
  const out = await offExport({ op, request: { format: 'markdown', sessionId: 's' } });
  assert.ok(out.content.endsWith(`\n\nSHA-256 checksums: c_1 ${HEX} · c_2 ${BLOB_HEX}\n`), op);
  assert.equal(out.sha256, sha(out.content));
}
ok('Markdown ends with both screenshots in full hex (one stored hash, one hashed from a legacy blob), for save and for attach');

built = { json: { filename: 'a.json', mime: 'application/json', content: JSON.stringify({ session: { id: 's' }, events: [] }, null, 2) } };
let out = await offExport({ op: 'session', request: { format: 'json', sessionId: 's' } });
assert.deepEqual(JSON.parse(out.content).checksums, { c_1: HEX, c_2: BLOB_HEX });
assert.equal(out.sha256, sha(out.content));
ok('the session JSON lists the checksums and names its own SHA-256');

built = { json: { filename: 'big.json', mime: 'application/json', content: JSON.stringify({ events: 'x'.repeat(300_000) }) } };
out = await offExport({ op: 'session', request: { format: 'json', sessionId: 's' } });
assert.equal(out.gzipped, true); assert.equal(out.filename, 'big.json.gz');
const bytes = Buffer.from(out.content, 'base64');
assert.deepEqual(JSON.parse(gunzipSync(bytes).toString()).checksums, { c_1: HEX, c_2: BLOB_HEX });
assert.equal(out.sha256, sha(bytes));
ok('a big JSON is stamped before it is compressed, and the hash is of the gzip that is saved');
out = await offExport({ op: 'build', request: { format: 'json', sessionId: 's' } });
assert.equal(out.gzipped, undefined); assert.ok(JSON.parse(out.content).checksums);
ok('an attachment (build) stays raw text');

built = { har: { filename: 'a.har', mime: 'application/json', content: '{"log":{}}' } };
out = await offExport({ op: 'session', request: { format: 'har', sessionId: 's' } });
assert.equal(out.content, '{"log":{}}'); assert.equal(out.sha256, sha('{"log":{}}'));
ok('a format with no footer keeps its bytes and still names its SHA-256');

const xlsx = Buffer.from('PK-fake-workbook');
built = { 'timeline-xlsx': { filename: 'a.xlsx', mime: 'x', encoding: 'base64', content: xlsx.toString('base64') } };
out = await offExport({ op: 'session', request: { format: 'timeline-xlsx', sessionId: 's' } });
assert.equal(out.content, xlsx.toString('base64')); assert.equal(out.sha256, sha(xlsx));
ok('a workbook is passed through and names the SHA-256 of its decoded bytes');

// completion review 3: the bundle's own parts carry the footer / `checksums` (the real shotHashes + buildBundle, cut from export-build.js).
{
  const bs = fs.readFileSync(path.join(root, 'background/export-build.js'), 'utf8');
  const a = bs.indexOf('/** `{captureId: sha256}`'), b = bs.indexOf('\n/**\n * Every text export passes', a);
  assert.ok(a > 0 && b > a, 'shotHashes and buildBundle are not where this test cuts them');
  const t2 = path.join(os.tmpdir(), `uqa-bundle-${process.pid}.mjs`);
  fs.writeFileSync(t2, [
    `import { stampDocument } from '${core}provenance-stamp.js';`,
    `import { captureHashes } from '${core}integrity.js';`,
    `import { bundleIds, bundleFilename, BUNDLE_SHOTS } from '${core}presets.js';`,
    'const loadSession = async () => globalThis.__ls; const getCaptures = async () => globalThis.__caps;',
    'const buildExport = async (r) => { (globalThis.__req ||= []).push(r); const p = globalThis.__parts[r.format]; return typeof p === "function" ? p(r) : p; }; const blobToDataUrl = async () => null;',
    'const toBase64 = (u) => Buffer.from(u).toString("base64");',
    'const buildBundleZip = (a) => { globalThis.__zipArgs = a; return new TextEncoder().encode(JSON.stringify(a.parts)); };',
    bs.slice(a, b), 'export { buildBundle };',
  ].join('\n'));
  globalThis.__ls = { session: { charter: 'c', startedAt: 0 }, events: [{ kind: 'screenshot', captureId: 'c_1' }] };
  globalThis.__caps = { c_1: { sha256: HEX, dataUrl: 'data:image/png;base64,AA==' } };
  globalThis.__parts = {
    markdown: { filename: 'a.md', content: '# R\n' }, json: { filename: 'a.json', content: '{"session":{}}' },
    'session-manifest': { filename: 'm.json', content: '{}' }, har: { filename: 'a.har', content: '{"log":{}}' },
  };
  const { buildBundle } = await import(pathToFileURL(t2).href);
  const zip = await buildBundle({ sessionId: 's', parts: ['markdown', 'har'] });
  const parts = JSON.parse(Buffer.from(zip.content, 'base64').toString());
  const by = Object.fromEntries(parts.map((p) => [p.filename, p.content]));
  assert.ok(by['a.md'].endsWith(`SHA-256 checksums: c_1 ${HEX}\n`), 'the Markdown part ends with the checksum line');
  assert.deepEqual(JSON.parse(by['a.json']).checksums, { c_1: HEX });
  assert.equal(by['a.har'], '{"log":{}}');
  // r10-11-2: the names are fixed before the documents are built, an omitted picture links to its zip entry, and the zip holds it.
  const BIG = 'data:image/png;base64,' + 'A'.repeat(600 * 1024);
  globalThis.__ls = { session: { id: 's', charter: 'c', startedAt: 0, endedAt: 1000, status: 'stopped', env: {} }, events: [{ kind: 'screenshot', captureId: 'c_1', ts: 500, text: 'big' }] };
  globalThis.__caps = { c_1: { sha256: HEX, dataUrl: BIG } };
  globalThis.__req = [];
  globalThis.__parts = { json: { filename: 'a.json', content: '{"session":{}}' }, 'session-manifest': { filename: 'm.json', content: '{}' }, markdown: (r) => ({ filename: 'a.md', content: buildMarkdown(globalThis.__ls.session, globalThis.__ls.events, { c_1: { ...globalThis.__caps.c_1, path: r.shotPaths?.c_1 } }) }) };
  await buildBundle({ sessionId: 's', parts: ['markdown'] });
  assert.ok(globalThis.__req.length >= 1 && globalThis.__req.every((r) => r.shotPaths?.c_1 === 'Screenshots/c_1.png'), 'the paths reach every buildExport call');
  const md = globalThis.__zipArgs.parts[0].content;
  assert.ok(md.includes('](Screenshots/c_1.png)'), 'the omitted picture is a working relative link in the bundle Markdown');
  const zipNames = [...readZipBuffer(buildBundleZip(globalThis.__zipArgs)).entries.keys()];
  assert.ok(zipNames.includes('Screenshots/c_1.png'), 'the zip holds that entry: ' + zipNames);
  fs.rmSync(t2, { force: true });
  ok('r10-11-2: a bundle links an omitted picture to Screenshots/<id>.png and the zip holds that entry');
  ok('a bundle stamps its Markdown and JSON parts with the screenshots SHA-256 and leaves the others alone');
}

fs.rmSync(tmp, { force: true });
console.log(`${n} passed, 0 failed`);
