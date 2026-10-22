/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Provenance and copyright.
 *
 * Two things are being protected, and they pull against each other, which is
 * why this suite exists rather than a comment saying it was considered.
 *
 * **Every artefact must carry its origin.** Silently losing the mark on one
 * format is exactly how attribution disappears — nobody notices the file that
 * has none until it is the one being argued about.
 *
 * **No mark may damage the artefact it marks.** A screenshot must be a byte-
 * for-byte record of what the screen showed; a Playwright spec must still run;
 * a CSV must not gain a column; a JSON export must still parse. A watermark
 * that corrupts evidence has destroyed the thing it was protecting.
 */
import assert from 'node:assert/strict';
import { PRODUCT } from '../core/product.js';

/* The library is written for a browser; give it the two globals it uses. */
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const P = await import('../core/provenance.js');
const { MAKER, GLYPH, copyright, stamp, token, readToken, provenance, embed, readPng } = P;
const { stampPng, htmlWatermark } = await import('../core/provenance-stamp.js');

const SESSION = { id: 's_abc123', startedAt: Date.parse('2026-08-31T09:00:00Z') };
const OPTS = { session: SESSION, version: '1.11.0', kind: 'bug-report' };

console.log('provenance.js — the mark a person sees');

await test('the short mark is a glyph and a name, and nothing else', () => {
  assert.equal(P.SHORT, `${GLYPH} ${MAKER.product}`);
  // "No long texts, no bold attractions" — so it has a ceiling.
  assert.ok(P.SHORT.length <= 16, `${P.SHORT.length} characters is a sentence, not a mark`);
});

await test('the copyright names the holder once', () => {
  const c = copyright(Date.parse('2026-06-01'));
  assert.equal(c, `© 2026 ${MAKER.owner}. Released under the MIT licence.`);
  // The rights holder is the owner named in brand/brand.json (Nader, 2026-10-14), read through core/product.js.
  assert.equal(c, `© 2026 ${PRODUCT.maker}. Released under the MIT licence.`);
});

await test('the colophon carries the one thing that is useful later', () => {
  const line = stamp(OPTS);
  // Six months on, the product name is not what ties a loose file to its run.
  assert.match(line, /s_abc123/, 'the session id is the point of the line');
  assert.match(line, /1\.11\.0/);
  assert.ok(line.split('\n').length === 1, 'a colophon is one line');
});

console.log('\nprovenance.js — the token a machine reads');

await test('it announces itself in its first four characters', () => {
  assert.match(token(OPTS), /^qaw1:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
});

await test('it round-trips, with everything an attribution needs', () => {
  const back = readToken(`some text ${token(OPTS)} more text`);
  assert.equal(back.intact, true);
  assert.equal(back.product, MAKER.product);
  assert.equal(back.owner, MAKER.owner);
  assert.equal(back.version, '1.11.0');
  assert.equal(back.session, 's_abc123');
  assert.equal(back.kind, 'bug-report');
});

await test('an edited payload stops verifying, and says so', () => {
  // The property that makes this worth anything: not that it cannot be removed,
  // but that it cannot be quietly *changed* into somebody else's name.
  const real = token(OPTS);
  const forged = real.replace(/qaw1:./, 'qaw1:X');
  const back = readToken(forged);
  assert.equal(back.intact, false);
  assert.equal(back.tampered, true);
});

await test('text with no token returns null rather than guessing', () =>
  assert.equal(readToken('an ordinary paragraph with no mark in it'), null));

await test('it survives a URL, a CSV cell and a shell argument unescaped', () => {
  const t = token(OPTS);
  assert.equal(encodeURIComponent(t).replace(/%3A/g, ':'), t, 'base64url should need no escaping but the colon');
  assert.equal(t.includes(','), false, 'a comma would split a CSV cell');
  assert.equal(t.includes('"'), false, 'a quote would break an XML attribute');
  assert.equal(/\s/.test(t), false, 'whitespace would split a shell argument');
});

console.log('\nprovenance.js — every format, in its own channel');

await test('each format uses a channel its own parsers already ignore', () => {
  assert.match(embed.markdown(OPTS), /^<!--.*-->$/s);
  assert.match(embed.yaml(OPTS), /^#/m);
  assert.match(embed.xml(OPTS), /^<!--.*-->$/s);
  assert.match(embed.csv(OPTS), /^#/);
  assert.match(embed.code(OPTS), /^\/\//);
  assert.match(embed.html(OPTS), /<meta name="qaw-provenance"/);
});

await test('every embedded form carries a verifiable token', () => {
  for (const [name, text] of Object.entries({
    markdown: embed.markdown(OPTS),
    yaml: embed.yaml(OPTS),
    xml: embed.xml(OPTS),
    csv: embed.csv(OPTS),
    code: embed.code(OPTS),
    html: embed.html(OPTS),
    json: JSON.stringify(embed.json({ a: 1 }, OPTS)),
  })) {
    const back = readToken(text);
    assert.ok(back, `${name} carries no token`);
    assert.equal(back.intact, true, `${name} carries a broken token`);
  }
});

await test('the JSON form is metadata beside the data, not mixed into it', () => {
  const out = embed.json({ charter: 'x', events: [1, 2] }, OPTS);
  assert.equal(out.charter, 'x', 'the payload must be untouched');
  assert.deepEqual(out.events, [1, 2]);
  assert.ok(out._provenance.token, 'and the mark sits under one underscore-prefixed key');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)), 'it must still be valid JSON');
});

await test('the HTML form speaks three machine conventions at once', () => {
  const html = embed.html(OPTS);
  assert.match(html, /<meta name="generator"/);
  assert.match(html, /<meta name="copyright"/);
  assert.match(html, /application\/ld\+json/);
  const ld = JSON.parse(html.match(/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld['@type'], 'CreativeWork');
  assert.equal(ld.creator.name, MAKER.owner);
  assert.equal(ld.copyrightHolder.name, MAKER.owner);
});

await test('nothing is smuggled in as invisible characters', () => {
  // Zero-width steganography is the obvious trick and the wrong one: hidden
  // characters break a diff, corrupt a paste into a ticket, and turn a
  // generated spec into something that will not parse.
  const all = [
    embed.markdown(OPTS), embed.yaml(OPTS), embed.xml(OPTS),
    embed.csv(OPTS), embed.code(OPTS), stamp(OPTS), copyright(),
  ].join('');
  assert.equal(/[​-‏⁠-⁯﻿]/.test(all), false, 'invisible characters found');
});

await test('the notice is written for a machine to quote correctly', () => {
  const p = provenance(OPTS);
  assert.match(p.notice, new RegExp(MAKER.owner));
  assert.match(p.notice, /Released under the MIT licence/);
  assert.match(p.license, /MIT/);
});

console.log('\nprovenance.js — a screenshot is not painted on');

/** The smallest valid PNG: signature, IHDR, IDAT, IEND. */
function tinyPng() {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = new Blob([tinyPng()], { type: 'image/png' });

await test('the mark goes in the file, and not one pixel moves', async () => {
  const before = new Uint8Array(await png.arrayBuffer());
  const marked = await stampPng(png, OPTS);
  const after = new Uint8Array(await marked.arrayBuffer());

  // Everything up to IEND is byte-identical: the image data is untouched.
  const iendBefore = before.length - 12;
  assert.deepEqual(
    [...after.subarray(0, iendBefore)],
    [...before.subarray(0, iendBefore)],
    'the image data was altered'
  );
  assert.ok(after.length > before.length, 'nothing was added');
});

await test('the chunks are standard ones every image tool already reads', async () => {
  const back = await readPng(await stampPng(png, OPTS));
  assert.equal(back.Author, MAKER.owner);
  assert.match(back.Software, /QA Wrap/);
  assert.match(back.Copyright, /Released under the MIT licence/);
  assert.ok(back.Comment, 'a sentence a machine can quote');
});

await test('the token survives the round trip through the file', async () => {
  const back = await readPng(await stampPng(png, OPTS));
  assert.equal(back.provenance.intact, true);
  assert.equal(back.provenance.session, 's_abc123');
  assert.equal(back.provenance.owner, MAKER.owner);
});

await test('the chunks go before IEND, where a reader looks for them', async () => {
  const bytes = new Uint8Array(await (await stampPng(png, OPTS)).arrayBuffer());
  const tail = Buffer.from(bytes.subarray(bytes.length - 12)).toString('latin1');
  assert.match(tail, /IEND/, 'IEND must still terminate the file');
});

await test('something that is not a PNG comes back untouched, not corrupted', async () => {
  const jpeg = new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });
  const out = await stampPng(jpeg, OPTS);
  assert.equal(out, jpeg, 'a non-PNG must be returned as-is rather than damaged');
});

await test('a PNG with no IEND is refused rather than mangled', async () => {
  const broken = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])]);
  assert.equal(await stampPng(broken, OPTS), broken);
});

console.log('\nprovenance.js — the visible mark stays out of the way');

await test('the page mark is a glyph and a name, and cannot be clicked', () => {
  const html = htmlWatermark(OPTS);
  assert.match(html, /pointer-events: none/, 'it must never intercept a click');
  assert.match(html, /aria-hidden="true"/, 'and never be read out as content');
  assert.match(html, /@media print/, 'and not float over page four when printed');
  // The visible text is the glyph and the product name. Nothing else.
  const visible = html.match(/aria-hidden="true">(.*?)<\/div>/s)[1].replace(/<[^>]+>/g, '');
  assert.ok(visible.length <= 16, `the visible mark is ${visible.length} characters`);
});

await test('the full colophon is on hover, not on the page', () => {
  const html = htmlWatermark(OPTS);
  assert.match(html, /title="[^"]*s_abc123/, 'the detail belongs in the tooltip');
});

console.log('\nprovenance.js — every export a real session produces');

/**
 * The check that actually matters, and the one that was missing.
 *
 * Every test above proves the library can mark something. None of them proved
 * that the exporters *call* it — and a live UAT run found six formats shipping
 * with no mark at all, months of unit tests notwithstanding. So this section
 * builds every artefact the product can hand a person, from one session, and
 * asserts each one carries a token that verifies.
 *
 * It is written as an exhaustive list on purpose: a format added later that
 * nobody marked fails here, at the cost of one line, instead of being noticed
 * whenever somebody next reads the output by hand.
 */
const { buildHtml, buildText, buildJunit, buildHar, buildYaml } = await import('../core/exporters.js');
const { toJira } = await import('../core/formats.js');
const { textToAdf } = await import('../core/adf.js');
const { toMarkdownIssue, toCsv } = await import('../core/formats-export.js');
const { buildPlaywrightSpec } = await import('../core/artifact.js');
// buildMarkdown, buildSessionSheet and buildJson moved to core/artifact-docs.js:
// they only ever run in the offscreen document, and the worker was re-parsing
// them on every cold start. See the note at the top of that file.
const { buildMarkdown, buildSessionSheet, buildJson } = await import('../core/artifact-docs.js');
const { buildPostmanCollection, buildPostmanEnvironment } = await import('../core/postman.js');

/*
 * Every real caller reaches `shell()` (inside buildHtml) through
 * `background/export-build.js`'s `brandAssets()`, which always awaits
 * `loadDocFonts()` first — `shell()` throws otherwise (core/docshell.js).
 * This file calls buildHtml directly, bypassing that wrapper, so it does the
 * same thing here, once, before the EXPORTS loop builds anything (S9-detail
 * CHALLENGE: this file is outside S9's write-set, routed to S10 per §0.1).
 */
const { loadDocFonts } = await import('../core/docshell.js');
await loadDocFonts();

const T0 = 1_700_000_000_000;
const sess = {
  id: 's_cover',
  charter: 'Submit an application with an expired document',
  startedAt: T0,
  endedAt: T0 + 12_000,
  startUrl: 'https://example.gov/apply',
  env: { viewport: '1920x1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' },
  status: 'stopped',
};
const evs = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'https://example.gov/apply' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Submit',
    locator: "getByRole('button', { name: 'Submit' })", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380,
    error: false, responsePreview: '{"error":"boom"}', frameUrl: 'https://example.gov/apply' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'Reproduced three times.' },
];

const EXPORTS = [
  ['report (HTML)', () => buildHtml(sess, evs, {})],
  ['report (text)', () => buildText(sess, evs)],
  ['JUnit XML', () => buildJunit(sess, evs)],
  ['HAR', () => buildHar(sess, evs)],
  ['timeline YAML', () => buildYaml(sess, evs)],
  ['bug report (Markdown)', () => buildMarkdown(sess, evs, {})],
  ['session sheet', () => buildSessionSheet(sess, evs)],
  ['session JSON', () => JSON.stringify(buildJson(sess, evs))],
  ['Playwright spec', () => buildPlaywrightSpec(sess, evs)],
  ['Jira wiki markup', () => toJira(sess, evs)],
  ['GitHub issue', () => toMarkdownIssue(sess, evs)],
  ['Jira ADF', () => JSON.stringify(textToAdf(toMarkdownIssue(sess, evs)))],
  ['Postman collection', () => JSON.stringify(buildPostmanCollection(sess, evs))],
  ['Postman environment', () => JSON.stringify(buildPostmanEnvironment(sess, evs, {}))],
];

for (const [name, build] of EXPORTS) {
  await test(`${name} carries a mark that verifies`, () => {
    const back = readToken(String(build()));
    assert.ok(back, 'no qaw1: token anywhere in the output');
    assert.equal(back.intact, true, 'the token is present but does not verify');
    assert.equal(back.session, 's_cover', 'the token names a different session');
  });
}

await test('the CSV is the one documented exception, and stays clean', () => {
  // Not an oversight — RFC 4180 has no channel that does not damage the file,
  // and a leading "#" puts the headers on row 2 in Excel. See the note in
  // core/formats.js. Asserted so that "unmarked" stays a decision somebody made.
  const csv = toCsv(sess, evs);
  assert.equal(readToken(csv), null, 'the CSV grew a mark — see the note in toCsv');
  // The BOM stays (Arabic in Excel, r3-10-1): exactly one U+FEFF, then the header.
  assert.equal(csv.split('﻿').length - 1, 1, 'the CSV must carry exactly one BOM');
  assert.ok(csv.startsWith('﻿'), 'the BOM must be the first character');
  assert.equal(csv.slice(1).split('\n')[0], 'at,kind,summary,locator,failure', 'the header must be the first line');
});

await test('no mark ever breaks the format it sits in', () => {
  // A token inside a string that a parser then chokes on would be the worst
  // outcome of all this: evidence destroyed in the act of protecting it.
  assert.doesNotThrow(() => JSON.parse(buildHar(sess, evs)), 'HAR');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(buildJson(sess, evs))), 'session JSON');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(buildPostmanCollection(sess, evs))), 'Postman collection');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(buildPostmanEnvironment(sess, evs, {}))), 'Postman environment');

  const har = JSON.parse(buildHar(sess, evs));
  assert.equal(har.log.version, '1.2', 'the HAR must still declare its own version');
  assert.ok(har.log._qawrap, 'and carry the record under a spec-reserved underscore key');
  assert.ok(Array.isArray(har.log.entries), 'and still have its entries where a reader looks');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
