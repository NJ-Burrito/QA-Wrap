/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The cookie-format round trip through the offscreen door, without a browser.
 *
 *   node tools/test-cookie-offscreen.mjs [--root <dir>]
 *
 * ── the fault this closes ─────────────────────────────────────────────────
 *
 * `core/cookie-formats.js` moved out of the service worker and behind the
 * offscreen document: the worker sends `UQA_OFF_COOKIEFMT`, the offscreen
 * document imports the module and answers. Three files must agree on one
 * string and one argument shape, and nothing tested that. Rename the op in one
 * of them and the worker still builds, still loads, and the cookie editor's
 * format list and paste-detection quietly return nothing.
 *
 * This suite pins the wiring statically (the op string in all three places,
 * read from `background/media.js` rather than hard-coded here, so a rename in
 * ONE file turns it red), then runs the offscreen handler itself, the real
 * source text of `offCookieFmt`, against the real module: `detectFormat` answers,
 * `FORMATS` survives `structuredClone` (the message channel's copy), and an
 * unknown function name is refused rather than answered with `undefined`.
 *
 * `--root <dir>` points it at another copy of the tree; the red-path check
 * (rename the op in a scratch copy and expect a failure) uses that.
 * Read-only on every source file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const media = read('background/media.js');
const worker = workerSrc();
const offscreen = read('offscreen/offscreen.js');

// The op string, taken from the sender. A rename anywhere else must not match it.
const opMatch = media.match(/export const cookieFormatsOp\s*=\s*\(fn, args = \[\]\)\s*=>\s*offscreen\('([A-Z_]+)'/);
const OP = opMatch?.[1];

console.log('\ncookie formats through the offscreen door');

await test('background/media.js exports cookieFormatsOp and sends one op string', () => {
  assert.ok(OP, 'cookieFormatsOp(fn, args) => offscreen(<OP>, ...) not found in background/media.js');
  assert.equal(OP, 'UQA_OFF_COOKIEFMT', 'the op string is the documented one');
});

await test('the offscreen document handles that exact op string', () => {
  const re = new RegExp(`case '${OP}':\\s*return offCookieFmt\\(msg\\);`);
  assert.match(offscreen, re, `offscreen/offscreen.js has no "case '${OP}': return offCookieFmt(msg)"`);
});

await test('the service worker imports cookieFormatsOp and answers both messages through it', () => {
  assert.match(worker, /\bcookieFormatsOp\b[^;]*from '\.\/media\.js'|import \{[^}]*\bcookieFormatsOp\b[^}]*\} from '\.\/media\.js'/s, 'service-worker.js imports cookieFormatsOp from ./media.js');
  assert.match(worker, /UQA_COOKIE_FORMATS:\s*\(\)\s*=>\s*cookieFormatsOp\('FORMATS'\)/);
  assert.match(worker, /UQA_COOKIE_DETECT:\s*\(msg\)\s*=>\s*cookieFormatsOp\('detectFormat',\s*\[msg\.text\]\)/);
});

await test('the offscreen handler takes { fn, args } and loads core/cookie-formats.js', () => {
  assert.match(offscreen, /async function offCookieFmt\(\{ fn, args = \[\] \}\)/);
  assert.match(offscreen, /import\('\.\.\/core\/cookie-formats\.js'\)/);
});

// The real handler text, lifted out of the offscreen file and run against the real module.
function loadHandler() {
  const from = offscreen.indexOf('let cookieFmtMod = null;');
  const sig = offscreen.indexOf('async function offCookieFmt', from);
  assert.ok(from >= 0 && sig > from, 'offCookieFmt not found in offscreen/offscreen.js');
  // the function ends at the first line that is exactly "}" after its signature
  const end = offscreen.indexOf('\n}\n', sig);
  assert.ok(end > sig, 'end of offCookieFmt not found');
  const body = offscreen.slice(from, end + 3).replace(/\bimport\(/g, '__imp(');
  // eslint-disable-next-line no-new-func
  const factory = new Function('__imp', `${body}\nreturn offCookieFmt;`);
  return factory((rel) => import(pathToFileURL(path.resolve(ROOT, 'offscreen', rel)).href));
}

await test('detectFormat works through the handler (all four formats)', async () => {
  const h = loadHandler();
  assert.equal(await h({ fn: 'detectFormat', args: ['[{"name":"a","value":"b"}]'] }), 'json');
  assert.equal(await h({ fn: 'detectFormat', args: ['# Netscape HTTP Cookie File\n'] }), 'netscape');
  assert.equal(await h({ fn: 'detectFormat', args: ['Set-Cookie: a=b; Path=/'] }), 'setcookie');
  assert.equal(await h({ fn: 'detectFormat', args: ['a=b; c=d'] }), 'header');
  assert.equal(await h({ fn: 'detectFormat', args: [''] }), null);
});

await test('FORMATS crosses the message channel (structuredClone) intact', async () => {
  const h = loadHandler();
  const formats = await h({ fn: 'FORMATS' });
  const copy = structuredClone(formats);
  assert.deepEqual(copy, formats);
  assert.deepEqual(copy.map((f) => f.id), ['json', 'netscape', 'header', 'setcookie']);
  for (const f of copy) assert.ok(f.label && f.ext && f.mime, `${f.id} carries label, ext and mime`);
});

await test('an unknown function name is refused, not answered with undefined', async () => {
  const h = loadHandler();
  await assert.rejects(() => h({ fn: 'rm -rf', args: [] }), /cookie-formats has no/);
  await assert.rejects(() => h({ fn: 'noSuchFunction' }), /cookie-formats has no/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
