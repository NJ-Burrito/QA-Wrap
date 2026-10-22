/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unit tests for core/formats.js — the ticket formats.
 *
 *   node tools/test-formats.mjs
 *
 * These are pure text transforms, so they are cheap to test properly, and they
 * are the last thing a report passes through before a person reads it in Jira.
 * Two classes of defect matter here and both are silent:
 *
 *   - markup that is *nearly* right — a CSV a spreadsheet splits in the wrong
 *     place, an ADF document Jira answers 400 to — fails at the tracker, long
 *     after the tester has moved on;
 *   - a secret that survives the transform. The product's whole claim is that
 *     passwords and cookie values are never recorded, and a format is the one
 *     place that claim can quietly break.
 */
import assert from 'node:assert/strict';
import { toJira, title, wikiEsc } from '../core/formats.js';
import { toMarkdownIssue, toCsv } from '../core/formats-export.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_TYPES, VIDEO_TYPES, TEXT_TYPES, byId } from '../core/file-types.js';
import { FORMATS } from '../core/filing.js';
import { marked } from 'marked';
import { wavBytes } from '../offscreen/wav.js';

/* `wavBytes` is the encoder without the Blob wrapper, so every assertion below
   is synchronous: `test()` here does not await, and an async body would report a
   pass before its first expectation had run. */
const view = (audio) => new DataView(wavBytes(audio));
const ascii = (data, at, len) =>
  String.fromCharCode(...Array.from({ length: len }, (_, i) => data.getUint8(at + i)));

/* A silent buffer of a given shape, standing in for what `decodeAudioData`
   returns. Only the four members `encodeWav` reads are provided, on purpose: a
   stub that mimicked the whole AudioBuffer would be testing the stub. */
const tone = ({ channels, frames, rate }) => ({
  numberOfChannels: channels,
  length: frames,
  sampleRate: rate,
  getChannelData: () => new Float32Array(frames),
});

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_700_000_000_000;

const session = {
  id: 's_fmt',
  charter: 'Submit an application with an expired document',
  startedAt: T0,
  endedAt: T0 + 12_000,
  startUrl: 'https://example.gov/apply',
  env: { viewport: '1920×1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'en-US' },
  status: 'stopped',
};

const PASSWORD_FIELD = 'كلمة المرور';
const SUBMIT = 'إرسال';

const events = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'https://example.gov/apply' },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader', label: 'اسم المستخدم',
    locator: "getByLabel('اسم المستخدم')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'input' },
  { kind: 'dom', ts: T0 + 2400, action: 'input', value: '••••••••', masked: true, label: PASSWORD_FIELD,
    locator: `getByLabel('${PASSWORD_FIELD}')`, framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: SUBMIT,
    locator: `getByRole('button', { name: '${SUBMIT}', exact: true })`, framePrefix: '',
    frameUrl: 'https://example.gov/apply', tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380,
    error: false, responsePreview: '{"error":"NullPointerException"}', frameUrl: 'https://example.gov/apply' },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500', frameUrl: 'https://example.gov/apply' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'Reproduced three times, always on "Submit".' },
  { kind: 'a11y', ts: T0 + 5000, total: 3, violations: [
      { id: 'label', impact: 'critical', count: 2, help: 'Form elements must have labels' },
      { id: 'color-contrast', impact: 'serious', count: 1, help: 'Contrast must meet AA' }] },
  { kind: 'perf', ts: T0 + 6000,
    metrics: { lcp: 3400, cls: 0.02, inp: 180, fcp: 1200, ttfb: 640 },
    ratings: { lcp: 'needs work', cls: 'good', inp: 'good', fcp: 'good', ttfb: 'needs work' },
    resources: { count: 41, bytes: 1_800_000, cachedCount: 12,
                 slowest: [{ url: '/api/applications', ms: 380, bytes: 900, cached: false }] },
    longTasks: { count: 2, longestMs: 210 } },
];

/* A deliberately dumb, correct CSV reader. The point is to assert the outcome —
   what a spreadsheet will parse back — rather than the mechanism we used to
   write it. A quoting bug that round-trips is not a bug; one that does not, is. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // what Excel does: the BOM is not part of the first header cell
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

console.log('formats.js — title');

test('the title names the failure and the action that caused it', () => {
  const t = title(session, events);
  assert.match(t, /POST \/api\/applications returns 500/);
  assert.ok(t.includes(`after clicked ${SUBMIT}`), `title did not name the trigger: ${t}`);
});

test('a session with no failure falls back to the charter, not to an empty string', () => {
  assert.equal(title(session, [events[0]]), session.charter);
});

test('the title stays inside what a tracker will show', () => {
  assert.ok(title({ ...session, charter: 'x'.repeat(600) }, []).length <= 240);
});

console.log('\nformats.js — Jira wiki markup');

const jira = toJira(session, events);

test('it is Jira markup, not Markdown', () => {
  assert.match(jira, /^h2\. What happened/m, 'Jira headings are "h2."');
  assert.match(jira, /\|\|Field\|\|Value\|\|/, 'Jira table headers are doubled pipes');
  assert.ok(jira.includes('{code}'), 'Jira code blocks are {code}');
  assert.doesNotMatch(jira, /^## /m, 'a Markdown heading would render literally in Jira');
  assert.doesNotMatch(jira, /^\|---/m, 'a Markdown table rule would render literally in Jira');
});

test('it carries the cause, the steps, the environment and the locators', () => {
  assert.ok(jira.includes('NullPointerException'), 'the response body is the actionable part');
  assert.ok(jira.includes(`Caused by: Clicked ${SUBMIT}`));
  assert.ok(jira.includes('high confidence'));
  assert.match(jira, /h2\. Steps to reproduce/);
  assert.match(jira, /h2\. Environment/);
  assert.ok(jira.includes('1920×1080'));
  assert.match(jira, /h2\. Verified locators/);
  assert.ok(jira.includes(`page.getByRole('button', { name: '${SUBMIT}', exact: true })`));
});

test('the accessibility and performance findings ride along', () => {
  assert.match(jira, /h2\. Accessibility/);
  assert.ok(jira.includes('|critical|label|2|'));
  assert.match(jira, /h2\. Performance/);
  assert.ok(jira.includes('|LCP|3400|needs work|'));
});

test('a tester note keeps its tag', () => {
  assert.ok(jira.includes('*BUG* Reproduced three times'));
});

console.log('\nformats.js — Markdown issue');

const md = toMarkdownIssue(session, events);

test('it is Markdown, not Jira markup', () => {
  assert.match(md, /^## What happened/m);
  assert.match(md, /^\| Field \| Value \|$/m);
  assert.match(md, /^\|---\|---\|$/m);
  assert.doesNotMatch(md, /^h2\. /m);
  assert.ok(!md.includes('{code}'));
});

test('it carries the same facts as the Jira version', () => {
  for (const fact of ['NullPointerException', `Caused by: Clicked ${SUBMIT}`, '1920×1080', 'LCP', 'label']) {
    assert.ok(md.includes(fact), `the Markdown issue lost "${fact}"`);
  }
});

test('the locator block is fenced as JavaScript, so a reviewer gets highlighting', () => {
  const fence = md.slice(md.indexOf('## Verified locators'));
  assert.ok(fence.includes('```js'), 'the locator fence is not tagged js');
  assert.ok(fence.includes('page.getByLabel'), 'the fence does not hold the locators');
});

test('a locator holding a code fence cannot break out of the block (11-4)', () => {
  const evil = [{ kind: 'dom', ts: T0 + 10, action: 'click', label: 'x', locator: "getByText('```\n![x](https://evil.test/p.png)')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'button' }];
  const out = toMarkdownIssue(session, evil);
  const tail = out.slice(out.indexOf('## Verified locators'));
  const toks = marked.lexer(tail, { gfm: true });
  const code = toks.filter((t) => t.type === 'code');
  assert.equal(code.length, 1, 'the locators are one code token');
  const walk = (ts) => ts.some((t) => t.type === 'image' || (t.tokens && walk(t.tokens)));
  assert.ok(!walk(toks), 'no image token escaped the fence');
});

console.log('\nformats.js — CSV');

const csv = toCsv(session, events);
const rows = parseCsv(csv);

test('one header row plus one record per event', () => {
  assert.equal(csv.charCodeAt(0), 0xfeff, 'the CSV starts with a BOM (r3-10-1)');
  assert.equal(csv.slice(1).split('\n')[0], 'at,kind,summary,locator,failure');
  assert.equal(rows.length, events.length + 1);
});

test('a cell holding a comma and quotes survives the round trip', () => {
  const note = rows.find((r) => r[1] === 'note');
  assert.equal(note[2], 'Reproduced three times, always on "Submit".');
});

test('a newline inside a cell survives the round trip', () => {
  const nasty = [{ kind: 'note', ts: T0 + 10, tag: 'bug', text: 'line one\nline two, "quoted"' }];
  assert.equal(parseCsv(toCsv(session, nasty))[1][2], 'line one\nline two, "quoted"');
});

test('a cell a spreadsheet would run as a formula is prefixed with an apostrophe (r2-11-1)', () => {
  const cell = (text) => parseCsv(toCsv(session, [{ kind: 'note', ts: T0 + 10, tag: 'bug', text }]))[1][2];
  for (const lead of ['=', '+', '@', '\t', '-']) {
    const t = `${lead}SUM(A1)`;
    assert.equal(cell(t), `'${t}`, `leading ${JSON.stringify(lead)} not neutralised`);
  }
  assert.equal(cell('\rcmd'), "'\rcmd", 'a leading CR is neutralised and the cell is quoted');
  assert.equal(cell('-5'), '-5', 'a plain negative number stays numeric');
  assert.equal(cell('-12.5'), '-12.5', 'a plain negative decimal stays numeric');
  assert.equal(cell('a=b'), 'a=b', 'a mid-cell = is data');
  assert.equal(cell('plain'), 'plain');
});

test('a CR inside a cell forces quoting (r2-11-1)', () => {
  assert.ok(toCsv(session, [{ kind: 'note', ts: T0 + 10, tag: 'bug', text: 'a\rb' }]).includes('"a\rb"'));
});

test('a failure detail holding a code fence stays inside one fence, read by a Markdown lexer (r2-11-3)', () => {
  const nasty = 'line\n```\nescaped?\n```\nafter ```` four';
  const evs = events.map((e) => (e.kind === 'net' && e.status === 500 ? { ...e, responsePreview: nasty } : e));
  const out = toMarkdownIssue(session, evs);
  const code = marked.lexer(out).filter((t) => t.type === 'code');
  assert.ok(code.some((t) => t.text === nasty), 'the whole detail must be one code block, byte for byte');
  assert.ok(!out.includes('\n```\n' + nasty + '\n```\n'), 'a three-backtick fence would be closed early');
});

test('failures are marked, so a spreadsheet can filter down to them', () => {
  assert.deepEqual(rows.filter((r) => r[4] === 'yes').map((r) => r[1]), ['net', 'console']);
});

test('every row is stamped with when it happened, relative to the session start', () => {
  for (const r of rows.slice(1)) assert.match(r[0], /^\+\d+\.\d\ds$/, `bad timestamp: ${r[0]}`);
});

console.log('\nformats.js — r3-11-3 hostile page text, r3-10-1 BOM');

const PROBE = 'boom !http://evil.test/p.png! [x|http://evil.test] {code} {panel} ![i](http://evil.test/i.png) [l](http://evil.test) <img src=x onerror=1>';
const probeEvents = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'https://example.gov/apply' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: PROBE, locator: "getByText('page text')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380, error: false,
    responsePreview: 'before {code} {noformat} {code:java} after', frameUrl: 'https://example.gov/apply' },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: PROBE, frameUrl: 'https://example.gov/apply' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: PROBE },
];

test('r3-11-3 Jira wiki: page text yields no live image, link, macro or early {code}', () => {
  const j = toJira(session, probeEvents);
  assert.doesNotMatch(j, /(^|[^\\])!http/, 'a live !http image');
  assert.doesNotMatch(j, /(^|[^\\])\[x\|/, 'a live [x| link');
  assert.doesNotMatch(j, /(^|[^\\])\{panel\}/, 'a live {panel} macro');
  // outside the deliberate blocks, every {code} / {noformat} is one of ours: count the unescaped openers and closers
  const macros = j.match(/(^|[^\\])\{(?:code|noformat)\b[^}]*\}/g) || [];
  const blocks = (j.match(/^\{code\}$/gm) || []).length + (j.match(/^\{code:javascript\}$/gm) || []).length;
  assert.equal(macros.length, blocks, `unexpected macros: ${JSON.stringify(macros)}`);
  const open = j.indexOf('{code}\n') + 7;
  const detail = j.slice(open, j.indexOf('\n{code}', open));
  assert.ok(detail.includes('before { code} { noformat} { code:java} after'), `the detail keeps its text with the macros broken: ${detail}`);
});

test('r3-11-3 Jira wiki: ordinary words keep their hyphens, queries and URLs; markup characters are escaped', () => {
  assert.equal(wikiEsc('my-page?x=1 and e-mail'), 'my-page?x=1 and e-mail');
  assert.equal(wikiEsc('a*b* -x- {y} [z]'), 'a\\*b\\* \\-x\\- \\{y\\} \\[z\\]');
  assert.equal(wikiEsc(['line one', 'line two', 'three'].join(String.fromCharCode(13, 10, 0x2028))), 'line one line two three');
  assert.ok(toJira(session, events).includes('|URL|https://example.gov/apply|'), 'a URL cell stays clickable');
});

test('r3-11-3 Markdown issue: the lexer finds no image or link token from page text', () => {
  const out = toMarkdownIssue(session, probeEvents);
  const walk = (tokens, bad = []) => {
    for (const t of tokens || []) {
      if (t.type === 'image' || t.type === 'link' || (t.type === 'html' && !t.raw.startsWith('<!-- qaw'))) bad.push(t);
      walk(t.tokens, bad);
      walk(t.items, bad);
      if (t.type === 'table') for (const row of [t.header, ...t.rows]) for (const cell of row) walk(cell.tokens, bad);
    }
    return bad;
  };
  const tokens = marked.lexer(out);
  // the Environment table holds the start URL, which is allowed to autolink: judge everything above it
  const head = marked.lexer(out.slice(0, out.indexOf('## Environment')));
  const bad = walk(head);
  assert.deepEqual(bad.map((t) => `${t.type}:${t.raw}`), [], 'image / link / html token from page text');
  assert.ok(tokens.length > 0);
});

test('r3-10-1 toCsv starts with U+FEFF and round-trips after the BOM is stripped', () => {
  const ar = [{ kind: 'note', ts: T0 + 10, tag: 'bug', text: 'عنوان الصفحة، "اختبار"' }];
  const out = toCsv(session, ar);
  assert.equal(out.charCodeAt(0), 0xfeff, 'no BOM');
  assert.equal(out.charCodeAt(1), 'a'.charCodeAt(0), 'the header follows the BOM directly');
  assert.equal(out.indexOf(String.fromCharCode(0xfeff), 1), -1, 'one BOM only');
  const back = parseCsv(out);
  assert.deepEqual(back[0], ['at', 'kind', 'summary', 'locator', 'failure']);
  assert.ok(back[1][2].includes('عنوان الصفحة، "اختبار"'), `Arabic cell: ${back[1][2]}`);
});

console.log('\nformats.js — the privacy promise');

test('a masked field stays masked in every format', () => {
  for (const [name, out] of [['jira', jira], ['markdown', md], ['csv', csv]]) {
    assert.ok(out.includes('••••••••'), `${name} dropped the mask instead of carrying it`);
  }
});

test('no format invents a value for a field it was never given', () => {
  const bare = { id: 's', charter: 'c', startedAt: T0, startUrl: '', env: {} };
  for (const out of [toJira(bare, []), toMarkdownIssue(bare, []), toCsv(bare, [])]) {
    assert.doesNotMatch(out, /undefined|\[object Object\]|NaN/);
  }
});

/* -- the file types a recording and a screenshot can become -------------- */

/**
 * The catalogue, and the one media encoder the product writes itself.
 *
 * The rule these protect: **offer nothing the browser cannot actually write.**
 * `canvas.toBlob('image/avif')` hands back a PNG on a build with no encoder and
 * says nothing, so a menu that lists a format because the format exists writes a
 * file with the wrong bytes in it, discovered by whoever opens it. The image and
 * video entries are probed at runtime for that reason; the WAV is not, because
 * it needs no encoder at all, which is exactly why it is the audio format on
 * offer and MP3 is not.
 */
test('screenshots offer PNG, JPEG and WebP, each with a real extension and MIME', () => {
  for (const id of ['png', 'jpeg', 'webp']) {
    const t = byId(IMAGE_TYPES, id);
    assert.ok(t, `${id} is not in IMAGE_TYPES`);
    assert.match(t.mime, new RegExp(String.raw`^image/`));
    assert.ok(t.ext && !t.ext.startsWith('.'), `${id} has a bad extension: ${t.ext}`);
  }
  // JPEG has no alpha and the note has to say so: a screenshot of a page with a
  // transparent header comes back flattened, and that surprises people.
  assert.match(byId(IMAGE_TYPES, 'jpeg').note, /transparency/i);
  assert.match(byId(IMAGE_TYPES, 'png').note, /Lossless/);
});

test('video offers MP4 and WebM, and MP4 is asked for by codec, not by container', () => {
  const mp4 = byId(VIDEO_TYPES, 'mp4');
  const webm = byId(VIDEO_TYPES, 'webm');
  assert.ok(mp4 && webm);
  // `video/mp4` alone is refused by builds that accept
  // `video/mp4;codecs=avc1...`, so the codec strings come first and the bare
  // container is the last resort rather than the first ask.
  assert.ok(mp4.candidates.length > 1, 'MP4 must offer more than one codec string');
  assert.match(mp4.candidates[0], /codecs=/);
  assert.equal(mp4.candidates.at(-1), 'video/mp4');
  assert.match(webm.candidates[0], /vp8/, 'VP8 before VP9: VP9 stutters the browser it is recording');
});

test('a WAV is a RIFF/WAVE file with a correct 44-byte header', () => {
  const wav = view(tone({ channels: 1, frames: 8, rate: 44100 }));
  assert.equal(ascii(wav, 0, 4), 'RIFF');
  assert.equal(ascii(wav, 8, 4), 'WAVE');
  assert.equal(ascii(wav, 12, 4), 'fmt ');
  assert.equal(ascii(wav, 36, 4), 'data');
  assert.equal(wav.getUint32(16, true), 16, 'PCM header must be 16 bytes');
  assert.equal(wav.getUint16(20, true), 1, 'format must be 1 (uncompressed PCM)');
  assert.equal(wav.getUint16(34, true), 16, 'must be 16 bits per sample');
});

test('the header sizes agree with the samples that follow them', () => {
  const wav = view(tone({ channels: 2, frames: 10, rate: 48000 }));
  const bytes = 10 * 2 * 2;
  // A RIFF size that disagrees with the payload is the classic WAV defect: some
  // players read it, some play silence, and none of them say why.
  assert.equal(wav.getUint32(40, true), bytes, 'data chunk size');
  assert.equal(wav.getUint32(4, true), 36 + bytes, 'RIFF size is 36 + data');
  assert.equal(wav.byteLength, 44 + bytes, 'file is header plus samples');
  assert.equal(wav.getUint16(22, true), 2, 'channel count');
  assert.equal(wav.getUint32(24, true), 48000, 'sample rate');
  assert.equal(wav.getUint32(28, true), 48000 * 2 * 2, 'bytes per second');
  assert.equal(wav.getUint16(32, true), 4, 'bytes per frame');
});

test('samples are interleaved, scaled, and clamped rather than wrapped', () => {
  const audio = {
    numberOfChannels: 2,
    length: 3,
    sampleRate: 8000,
    getChannelData: (c) => (c === 0 ? new Float32Array([0, 1, 1.4]) : new Float32Array([0, -1, -1.4])),
  };
  const wav = view(audio);
  assert.equal(wav.getInt16(44, true), 0);
  assert.equal(wav.getInt16(46, true), 0);
  // Left then right, frame by frame. A WAV written channel-by-channel plays as
  // the left channel followed by the right, at double speed, in mono.
  assert.equal(wav.getInt16(48, true), 32767, 'full scale positive');
  assert.equal(wav.getInt16(50, true), -32768, 'full scale negative');
  // Out-of-range input is what `decodeAudioData` genuinely hands back, and not
  // clamping it wraps the peak to the opposite sign, heard as a click.
  assert.equal(wav.getInt16(52, true), 32767, '1.4 must clamp, not wrap');
  assert.equal(wav.getInt16(54, true), -32768, '-1.4 must clamp, not wrap');
});


/* ── the three tables that describe one export, kept in step ─────────────── */

/*
 * An export format is declared in three places and built in a fourth.
 *
 *   `core/file-types.js`      what a picker offers
 *   `core/filing.js`          what shelf the file lands on and what it is called
 *   `background/export-build.js`  the bytes
 *
 * `fine-print` was in two of the three and in none of the fourth: `core/filing.js`
 * had declared "The fine print" since the tool shipped, the report page saved it
 * by hand out of the event, and `UQA_EXPORT` answered
 * `{"ok":false,"error":"Unknown export format: fine-print"}` to anybody who
 * asked for it by name (research/58, finding 15).
 *
 * A fixture cannot catch that: `buildExport` needs IndexedDB and a session, so
 * it does not run in Node at all. What can be checked here is the thing that
 * actually went wrong, which is that four lists stopped agreeing. So the switch
 * is read as text and its `case` labels are compared with the two tables.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const buildSrc = fs.readFileSync(path.join(EXT, 'background', 'export-build.js'), 'utf8');
const CASES = new Set([...buildSrc.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map((m) => m[1]));

/* Formats a picker never offers and no switch builds: `spec-reverse` is the
   `srs` builder filed under its own name, and the session card is written by
   the filing layer rather than exported. Named here so the check stays a check
   rather than a list of exceptions nobody reviews. */
const NOT_BUILT_BY_SWITCH = new Set(['spec-reverse']);

test('every format a picker offers can actually be built', () => {
  const missing = TEXT_TYPES
    .map((t) => t.id)
    .filter((id) => !NOT_BUILT_BY_SWITCH.has(id) && !CASES.has(id));
  assert.deepEqual(missing, [],
    `core/file-types.js offers ${missing.join(', ')}, and background/export-build.js has no case for it. ` +
    'UQA_EXPORT will answer "Unknown export format".');
});

test('every format the switch builds has somewhere to be filed', () => {
  const unfiled = [...CASES].filter((id) => !FORMATS[id]);
  assert.deepEqual(unfiled, [],
    `background/export-build.js builds ${unfiled.join(', ')}, and core/filing.js has no shelf for it.`);
});

test('the fine print is declared, offered and built', () => {
  assert.ok(FORMATS['fine-print'], 'core/filing.js must declare it');
  assert.equal(FORMATS['fine-print'].ext, 'md');
  const offered = byId(TEXT_TYPES, 'fine-print');
  assert.ok(offered, 'core/file-types.js must offer it');
  assert.equal(offered.mime, 'text/markdown');
  assert.equal(offered.kind, 'report');
  assert.ok(CASES.has('fine-print'), 'background/export-build.js must build it');
  assert.match(buildSrc, /qaw-fine-print-\$\{slug\}-\$\{stamp\}\.md/,
    'the file must be named for what it is, not filed under the specification');
  assert.match(buildSrc, /lastOfKind\(events, 'fineprint', 'fine-print check'\)/,
    'a session that never ran the tool must be told so, not handed an empty file');
});

test('CSV: a negative offset stays a plain "-0.50s" and the guard precedence is explicit (r5-11-2)', () => {
  const rows = parseCsv(toCsv(session, [{ kind: 'note', ts: session.startedAt - 500, tag: 'bug', text: 'before start' }]));
  assert.equal(rows[1][0], '-0.50s', 'column 0 is the offset, unquoted by a formula guard: ' + rows[1][0]);
  const pos = parseCsv(toCsv(session, [{ kind: 'note', ts: session.startedAt + 500, tag: 'bug', text: '=1+1' }]));
  assert.equal(pos[1][0], '+0.50s');
  assert.equal(pos[1][2].startsWith("'"), true, 'a formula in a text column is still guarded: ' + pos[1][2]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
