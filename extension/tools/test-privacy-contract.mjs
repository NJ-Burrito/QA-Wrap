/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-012 + T-013: one corpus, one verdict at every entry point.
 *
 *   node tools/test-privacy-contract.mjs
 *
 * The same fixture goes through capture (core/privacy.js), export, chat, Reporter and .eml (the offscreen
 * text scan, scanOutbound) and filing (scanFields). A leak must be gone everywhere; a keep must come back
 * byte for byte. Also: the secret-name list is one JSON file generated into the two content scripts, and the
 * name matcher is whole-token, not substring.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { redact, fold, isSecretHeader } from '../core/privacy.js';
import { scanOutbound, CONFIRMED, SECRET_HEADER } from '../core/secret-scan-text.js';
import { scanFields } from '../core/secret-scan.js';
import { lift } from './lib-lift.mjs';
import { sync, block } from './gen-privacy-names.mjs';
import { LEAKS, KEEPS, NAMES } from './fixtures/privacy-corpus.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

const ENTRIES = {
  capture: (t) => redact(t).text,
  export: (t) => scanOutbound({ content: t }).redacted.content,
  chat: (t) => scanOutbound({ title: t }, { extra: ['email', 'phone'] }).redacted.title, // R-04: the chat post also masks people's contact details
  reporter: (t) => scanOutbound({ body: t }).redacted.body,
  eml: (t) => scanOutbound({ 'text/plain': t }).redacted['text/plain'],
};
// Filing has its own gate (secrets only: cards and IBANs are not tracker credentials).
const filing = (t) => scanFields({ d: t }).redacted.d;
const PII = /^(card|iban)-/;

console.log('privacy contract: one corpus through every entry point');

test(`the corpus is about 60 fixtures (${LEAKS.length} leaks, ${KEEPS.length} keeps)`, () => {
  assert.ok(LEAKS.length + KEEPS.length >= 60);
});

test('PRIVACY.md and the HAR comment no longer admit what the redaction now covers (r2-03-3, r2-11-5)', () => {
  const doc = read('PRIVACY.md');
  assert.ok(!/a token in the query string of a recorded URL, or in a response preview,\s+reaches/i.test(doc), 'the stale sentence is back');
  for (const f of ['responsePreview', 'resBody', 'redirectedTo', 'stack', 'graphqlError', 'frameUrl', 'tabTitle', 'xpath']) assert.ok(doc.includes('`' + f + '`'), `PRIVACY.md does not name ${f}`);
  assert.ok(/opaque token/.test(doc), 'the remaining admission must be named');
  assert.ok(!/A token carried in a URL query is kept as the page/.test(read('core/exporters.js')), 'the stale HAR sentence is back');
});

test('SECURITY.md Exports row agrees with PRIVACY.md: recognisable secrets are replaced, only an opaque token survives (r3-14-1)', () => {
  const doc = read('SECURITY.md');
  const row = doc.split(String.fromCharCode(10)).find((l) => l.startsWith('| Exports |')) || '';
  assert.ok(row, 'SECURITY.md has no Exports row');
  assert.ok(!/stays in HAR, YAML and Postman exactly as the page sent it/.test(doc), 'the stale SECURITY.md sentence is back');
  assert.ok(!/A token in a recorded URL query, or in a response preview, stays/i.test(doc), 'the stale SECURITY.md sentence is back');
  assert.ok(/recognisable shape/.test(row) && /replaced before it is written/.test(row), 'the Exports row must say recognisable secrets are replaced');
  assert.ok(/opaque token/.test(row) && /HAR, YAML and Postman/.test(row), 'the Exports row must name the one admission, as PRIVACY.md does');
});

test('every leak is gone at every entry point, and every entry point gives the same text', () => {
  for (const [id, text, secret] of LEAKS) {
    const outs = Object.entries(ENTRIES).map(([name, fn]) => [name, fn(text)]);
    for (const [name, out] of outs) assert.ok(!out.includes(secret), `${id}: leaks through ${name}`);
    assert.ok(!fold(outs[0][1]).includes(fold(secret)), `${id}: folded leak`);
    if (!PII.test(id)) assert.ok(!filing(text).includes(secret), `${id}: leaks through filing`);
  }
});

test('every keep comes back byte for byte at every entry point', () => {
  for (const [id, text] of KEEPS) {
    for (const [name, fn] of Object.entries(ENTRIES)) if (!(name === 'chat' && id === 'email-default')) assert.equal(fn(text), text, `${id}: changed by ${name}`); // the chat post masks an email by design (R-04)
  }
});

test('chat fields and step arrays are scanned like any other text', () => {
  const r = scanOutbound({ title: 'ok', 0: `clone ${LEAKS.find((l) => l[0] === 'github-pat-bare')[2]}` }).redacted;
  assert.ok(!/ghp_/.test(r[0]) && r.title === 'ok');
});

test('observe mode: an unconfirmed finding is recorded but not cut; a confirmed one is cut', () => {
  // r4-03-4: capture-time redact() now masks a `cookie:` value of 4+ unbroken characters on every path, so the unconfirmed example is one it cannot see (spaces split it).
  const soft = 'Cookie: s i d 1 2 3 4';
  const a = scanOutbound({ x: soft });
  assert.equal(a.redacted.x, soft, 'text unchanged in observe mode');
  assert.ok(a.findings.some((f) => f.kind === 'cookie' && f.redacted === false), 'finding recorded');
  assert.equal(scanOutbound({ x: soft }, { mode: 'enforce' }).redacted.x.includes('s i d 1 2 3 4'), false, 'enforce cuts it');
  assert.ok(CONFIRMED.has('vendor-token') && CONFIRMED.has('jwt') && CONFIRMED.has('private-key') && !CONFIRMED.has('cookie'));
});

test('findings never carry the value', () => {
  const { findings } = scanOutbound({ x: 'token ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 and 4111111111111111' });
  assert.ok(findings.length >= 2);
  assert.ok(!JSON.stringify(findings).includes('ghp_a1B2') && !JSON.stringify(findings).includes('4111'));
});

test('redactBareDigits switches the loose digit family on', () => {
  const s = 'national number 9871023456 not found';
  assert.equal(redact(s).text, s);
  assert.ok(!redact(s, { redactBareDigits: true }).text.includes('9871023456'));
});

test('digits are folded: Arabic-Indic, Persian and fullwidth cards go, the surrounding Arabic digits stay', () => {
  assert.equal(redact('الصفحة ٣ من ١٢').text, 'الصفحة ٣ من ١٢');
  assert.ok(!redact('٤١١١ ١١١١ ١١١١ ١١١١').text.includes('٤١١١'));
});

test('field names: whole-token match, not substring (the twelve false positives pass)', () => {
  const block = read('content/page-hooks.js').match(/\/\* privacy-names:begin[^*]*\*\/\n([\s\S]*?)\/\* privacy-names:end \*\//)[1];
  const isSecretName = new Function(`${block}\nreturn isSecretName;`)();
  for (const [name, secret] of NAMES) assert.equal(isSecretName(name), secret, `${name} should be ${secret ? 'secret' : 'plain'}`);
  assert.equal(isSecretName('رقم سري'), true);
  assert.equal(NAMES.filter((n) => !n[1]).length, 12);
});

test('one list: core/privacy-names.json is generated into page-hooks, recorder and replay-recorder, no drift', () => {
  assert.deepEqual(sync({ check: true }), []);
  // D-1010-88: every copy (and core/privacy.js) carries exactly the words in privacy-names.json
  const source = JSON.parse(read('core/privacy-names.json')).names.slice().sort();
  for (const f of ['content/page-hooks.js', 'content/recorder.js', 'content/replay-recorder.js', 'core/privacy.js']) {
    const m = read(f).match(/const SECRET_NAMES = new Set\((\[.*?\])\)/);
    assert.ok(m, `${f}: SECRET_NAMES not found`);
    assert.deepEqual(JSON.parse(m[1]).sort(), source, `${f}: secret-name words differ from core/privacy-names.json`);
  }
  assert.ok(!/const SECRET = \/pass/.test(read('content/page-hooks.js')), 'the old substring regex is gone');
  assert.ok(!/const SECRET_NAME = \//.test(read('content/recorder.js')));
});

test('wiring: the worker never imports the engine; chat, Reporter and export go through the door', () => {
  const sw = workerSrc();
  assert.ok(/scanOutbound\(\{ \.\.\.flds/.test(sw), 'chat post is scanned');
  assert.ok(/UQA_SCAN: \(msg\) => scanOutbound\(msg\.fields\)/.test(sw), 'Reporter and .eml ask the worker');
  assert.ok(/type: 'UQA_SCAN'/.test(read('report/filing.js')), 'the page really sends UQA_SCAN (behaviour: tools/test-now-fixes.mjs)');
  assert.ok(!/secret-scan/.test(sw), 'no inline import of the scanner in the worker');
  assert.ok(/UQA_OFF_SCAN/.test(read('background/media.js')) && /case 'UQA_OFF_SCAN'/.test(read('offscreen/offscreen.js')));
  assert.ok(/scanOutbound\(\{ content: out\.content \}\)/.test(read('background/export-build.js')), 'every text export is scanned');
});

test('generated isSecretName keeps its regex escapes (a template literal once cooked backslash-d into d)', () => {
  const bs = String.fromCharCode(92);
  for (const f of ['content/page-hooks.js', 'content/recorder.js']) assert.ok(read(f).includes(`[a-z${bs}d]`) && read(f).includes(`a-z${bs}d${bs}u0600`), f);
});

/* The .eml through the real caller: report/filing.js download() asks the worker (UQA_SCAN) and builds the draft with
   report/eml.js. The eml.js builder stays pure; the scan is the caller's step, so this runs the real download(). */
async function emlThroughDownload() {
  let blob = null;
  const sandbox = {
    window: {}, location: { href: 'chrome-extension://x/report/report.html' },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ click() {}, remove() {} }), body: { append() {} } },
    QAWi18n: { t: (k) => k }, URL: { createObjectURL: (b) => { blob = b; return 'blob:x'; }, revokeObjectURL() {} }, Blob, TextEncoder, btoa, setTimeout: () => 0, console, chrome: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('ui/dom.js'), sandbox);
  vm.runInContext(read('report/eml.js'), sandbox);
  vm.runInContext(read('report/filing.js'), sandbox);
  const ctx = {
    title: 'T', line: '', steps: [],
    send: async (m) => (m.type === 'UQA_SCAN' ? { ok: true, result: scanOutbound(m.fields) } : { ok: true, result: m.type === 'UQA_TRACKER_STATE' ? [] : {} }),
    say() {}, markdown: async () => '', screens: async () => [],
  };
  await sandbox.window.UQAFiling.integrations(ctx);
  return async (line) => {
    ctx.line = line; blob = null;
    await sandbox.window.UQAFiling.download();
    assert.ok(blob, 'a draft was written');
    const eml = await blob.text();
    const b64 = eml.match(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--=_qaw_/)[1];
    const body = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8');
    const m = body.match(/^T\r\n\r\n([\s\S]*)\r\n\r\nreport\.f\.emlSteps/);
    assert.ok(m, 'R15: the body was decoded and the line found in it');
    return m[1];
  };
}
{
  const emlDraft = await emlThroughDownload();
  for (const [id, text] of [...LEAKS, ...KEEPS]) assert.equal(await emlDraft(text), ENTRIES.eml(text), `${id}: the real .eml draft differs from the shared verdict`);
  for (const [id, text, secret] of LEAKS) assert.ok(!(await emlDraft(text)).includes(secret), `${id}: leaks into the .eml draft`);
  passed++; console.log(`  ok  the real .eml draft (filing.js download + eml.js) gives the shared verdict for all ${LEAKS.length + KEEPS.length} fixtures`);
}

test('every manifest permission, required and optional, has a row in the PRIVACY.md permissions table (03-4)', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const privacy = read('PRIVACY.md');
  const section = privacy.slice(privacy.indexOf('## Permissions, and why each one is there'));
  const rows = section.split('\n').filter((l) => l.startsWith('|'));
  const missing = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]
    .filter((p) => !rows.some((r) => r.includes('`' + p + '`')));
  assert.deepEqual(missing, [], 'permissions with no PRIVACY.md row');
});

test('r4-02-2: PRIVACY.md has the API-tool egress row and SECURITY.md item 1 names the API tool (no stale "only the configured" promise)', () => {
  const privacy = read('PRIVACY.md');
  const row = privacy.split('\n').find((l) => /^\|\s*The API tool/.test(l));
  assert.ok(row, 'PRIVACY.md has no API-tool row in the egress table');
  assert.ok(/URL box/.test(row) && /cookies/.test(row) && /policy/.test(row), 'the row must name the host typed, the cookies and the managed policy');
  const sec = read('SECURITY.md').replace(/\s+/g, ' ');
  assert.ok(/the host you typed into the API tool/.test(sec), 'SECURITY.md item 1 does not name the API tool');
  assert.ok(/request you compose in the API tool, to the host you typed, with that profile's cookies when site access is granted/.test(sec), 'SECURITY.md item 1 lacks the amended outbound sentence');
  assert.ok(!/worker/i.test(read('core/api-send.js').split('\n').slice(0, 12).join('\n')), 'api-send.js still says it runs in the worker');
});

test('r2-05-7: page-hooks redact() truncates below depth 6 instead of passing the raw subtree', () => {
  const src = read('content/page-hooks.js');
  const grab = (re, what) => { const m = src.match(re); assert.ok(m, `page-hooks.js: ${what} not found`); return m[0]; };
  const code = [
    grab(/\/\* privacy-names:begin[^*]*\*\/\n[\s\S]*?\/\* privacy-names:end \*\//, 'names block'),
    grab(/^ {2}const SECRET = .*$/m, 'SECRET'),
    grab(/^ {2}const REDACTED = .*$/m, 'REDACTED'),
    grab(/^ {2}function redact\(value, depth = 0\) \{[\s\S]*?\n {2}\}\n/m, 'redact()'),
    'redact',
  ].join('\n');
  const redactFn = vm.runInNewContext(code);
  let deep = { password: 'hunter22', token: 'tok-9999' };
  for (let i = 0; i < 9; i += 1) deep = { child: deep, list: [deep] };
  const out = JSON.stringify(redactFn(deep));
  assert.ok(!out.includes('hunter22') && !out.includes('tok-9999'), 'a secret in a nine-level tree survived');
  assert.ok(out.includes('[truncated]'));
  assert.equal(JSON.stringify(redactFn({ a: { b: { password: 'x1' } } })), JSON.stringify({ a: { b: { password: '«redacted»' } } }), 'shallow trees are scrubbed as before');
});

test('D-97 / r5-05-1: the worker scrub cleans FormData part values (file parts and names untouched)', () => {
  const src = workerSrc();
  const scrubWith = new Function('redact', `
  const TEXT_FIELDS = [], SCRUB_EXTRA_TEXT = [], SCRUB_MAPS = [], SCRUB_BODIES = ['reqBody', 'resBody'], SCRUB_NESTED = {}, SCRUB_DEEP = [];
  const DEEP_SKIP = new Set(), SECRET_HEADER = /^$/;
  ${lift(src, 'scrubWith')}
  return scrubWith;`)(redact);
  const file = { name: 'a.png', type: 'image/png', size: 3 };
  const out = scrubWith({ kind: 'net', reqBody: { kind: 'FormData', parts: [{ name: 'notes', value: 'pay 4111 1111 1111 1111 now' }, { name: 'plain', value: 'hello' }, { name: 'up', file }] } }, { on: true, extra: [] });
  const [notes, plain, up] = out.reqBody.parts;
  assert.ok(!notes.value.includes('4111') && notes.value.includes('••••'), `FormData card survived: ${notes.value}`);
  assert.equal(notes.name, 'notes');
  assert.equal(plain.value, 'hello');
  assert.deepEqual(up, { name: 'up', file });
  assert.ok(out.redacted.length, 'the family is counted');
});

test('r2-11-1 / r3-03-2: the secret-name block now lives in core/privacy.js and is the generated one (no drift from core/privacy-names.json); secret-scan-text.js re-exports it', () => {
  assert.ok(read('core/privacy.js').includes(block('')), 'privacy.js privacy-names block differs from gen-privacy-names block()');
  assert.ok(!read('core/secret-scan-text.js').includes('privacy-names:begin'), 'one copy only in core/');
  assert.match(read('core/secret-scan-text.js'), /export \{ isSecretParam, isSecretHeader \}/);
});

test('r7-05-7: two sends on one XHR (open, send, open, send) give exactly two rows with the right URLs', () => {
  const posted = [];
  const winL = {};
  class FakeXHR {
    constructor() { this.l = {}; this.status = 200; this.responseType = ''; this.responseText = ''; }
    open() {}
    send() {}
    setRequestHeader() {}
    addEventListener(t, fn) { (this.l[t] ||= []).push(fn); }
    getAllResponseHeaders() { return ''; }
    fire(t) { for (const fn of this.l[t] || []) fn(); }
  }
  const win = {
    XMLHttpRequest: FakeXHR,
    addEventListener(t, fn) { (winL[t] ||= []).push(fn); },
    postMessage(m) { posted.push(m); },
  };
  win.window = win;
  const sandbox = { window: win, location: { href: 'https://app.test/', origin: 'https://app.test' }, URL, console, performance, Date, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('content/page-hooks.js'), sandbox, { filename: 'content/page-hooks.js' });
  for (const fn of winL.message || []) fn({ source: win, data: { source: 'uqa-awake', awake: true } });
  const x = new win.XMLHttpRequest();
  x.open('GET', '/a'); x.send(); x.fire('load');
  x.open('GET', '/b'); x.send(); x.fire('load');
  const rows = posted.filter((m) => m?.source === 'uqa-page' && m.event?.via === 'xhr');
  assert.deepEqual(rows.map((m) => m.event.url), ['/a', '/b'], `rows: ${JSON.stringify(rows.map((m) => m.event.url))}`);
});

/* ── round 8 (council-1010): one header rule, card and IBAN separators, vendor token shapes ── */

test('D-1010-173: isSecretHeader masks the 11 legacy names and ten custom credential headers, and leaves benign headers alone', () => {
  for (const h of ['authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'X-Api-Key', 'api-key', 'apikey', 'X-Auth-Token', 'X-Access-Token', 'X-CSRF-Token', 'X-XSRF-Token']) {
    assert.ok(SECRET_HEADER.test(h) && isSecretHeader(h), `${h}: the legacy name is still a secret header`);
  }
  const custom = ['Private-Token', 'X-Shopify-Access-Token', 'X-Goog-Api-Key', 'X-Amz-Security-Token', 'X-Vault-Token', 'X-Auth-Key', 'Ocp-Apim-Subscription-Key', 'X-Api-Secret', 'X-Functions-Key', 'X-Gitlab-Token'];
  for (const h of custom) assert.ok(isSecretHeader(h), `${h} must be masked`);
  for (const h of ['Content-Type', 'Accept', 'User-Agent', 'X-Request-Id', 'Cache-Control', 'Accept-Language', 'X-Forwarded-For', 'Content-Length']) assert.ok(!isSecretHeader(h), `${h} is benign`);
  assert.ok(isSecretHeader('  Private-Token '), 'a padded name is trimmed first');
});

const SEPS = { space: ' ', hyphen: '-', nbsp: String.fromCharCode(0xa0), nnbsp: String.fromCharCode(0x202f), thin: String.fromCharCode(0x2009), zwsp: String.fromCharCode(0x200b), rlm: String.fromCharCode(0x200f), dot: '.', slash: '/' };

test('r8-03-1: a Luhn-valid card is redacted whatever separates its digit groups', () => {
  for (const [name, sep] of Object.entries(SEPS)) {
    const r = redact('card ' + ['4012', '8888', '8888', '1881'].join(sep) + ' end');
    assert.ok(r.found.some((f) => f.id === 'card'), `${name}: not found`);
    assert.ok(!/1881/.test(r.text), `${name}: digits survived`);
  }
});

test('r8-03-1: an IBAN is redacted whatever separates its groups', () => {
  for (const [name, sep] of Object.entries(SEPS)) {
    const r = redact('pay ' + ['GB82', 'WEST', '1234', '5698', '7654', '32'].join(sep) + ' now');
    assert.ok(r.found.some((f) => f.id === 'iban'), `${name}: not found`);
  }
});

test('r8-03-1: a dotted version number and a Luhn-failing run are kept', () => {
  assert.deepEqual(redact('build 10.0.19045.3693.8.1.2.3.5 ok').found, [], 'version number');
  assert.deepEqual(redact('card 4012 8888 8888 1882 x').found, [], 'Luhn fails');
  assert.deepEqual(redact('card 4012.8888.8888.1882 x').found, [], 'Luhn fails, dotted');
  assert.deepEqual(redact('pay GB83 WEST 1234 5698 7654 32 now').found, [], 'IBAN check digits fail');
});

test('D-1010-191: a dotted or slashed card still hits, in fixed groups only', () => {
  for (const c of ['4111.1111.1111.1111', '4111/1111/1111/1111', '4012.8888.8888.1881', '3787.344936.71000', '3787/344936/71000']) {
    const r = redact('pan ' + c + ' end');
    assert.ok(r.found.some((f) => f.id === 'card'), `${c}: not found`);
  }
  assert.deepEqual(redact('pan 4111.1111/1111.1111 end').found, [], 'mixed separators are no card');
});

test('D-1010-191: 20,000 seeded decimal SVG attributes give 0 card and 0 IBAN hits', () => {
  let seed = 0x1010a9;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const num = () => (rnd() < 0.5 ? '-' : '') + Math.floor(rnd() * 4000) + '.' + String(Math.floor(rnd() * 1e9)).padStart(1 + Math.floor(rnd() * 9), '0');
  const nums = (n, sep) => Array.from({ length: n }, num).join(sep);
  let bad = 0;
  for (let i = 0; i < 20000; i += 1) {
    const kind = i % 5;
    const attr = kind === 0 ? `x="${num()}" y="${num()}"`
      : kind === 1 ? `width="${num()}" height="${num()}"`
        : kind === 2 ? `transform="translate(${num()} ${num()}) scale(${num()})"`
          : kind === 3 ? `d="M${nums(2, ' ')} L${nums(2, ',')} C${nums(6, ' ')} Z"`
            : `viewBox="${nums(4, ' ')}" points="${nums(8, ',')}"`;
    const r = redact(`<path ${attr}/>`);
    if (r.found.some((f) => f.id === 'card' || f.id === 'iban')) { bad += 1; if (bad < 4) console.log('    hit:', attr); }
  }
  assert.equal(bad, 0, `${bad} of 20000 decimal attributes were taken for a card or an IBAN`);
});

const rep = (c, n) => c.repeat(n);
const VENDOR = [
  ['Slack webhook URL', `https://hooks.slack.com/services/T${rep('A', 9)}/B${rep('B', 9)}/${rep('c', 24)}`, `https://hooks.slack.com/services/T123/B123/${rep('c', 24)}`],
  ['Discord webhook URL', `https://discord.com/api/webhooks/${rep('1', 18)}/${rep('a', 68)}`, `https://discord.com/api/webhooks/${rep('1', 18)}/${rep('a', 20)}`],
  ['Telegram bot token', `${rep('1', 9)}:AA${rep('a', 33)}`, `${rep('1', 9)}:AB${rep('a', 33)}`],
  ['xapp-', `xapp-1-A${rep('0', 9)}-${rep('1', 12)}-${rep('a', 40)}`, 'xapp-1-A0-1-abc'],
  ['shpat_', `shpat_${rep('a', 32)}`, `shpat_${rep('a', 31)}`],
  ['pypi-', `pypi-${rep('A', 60)}`, 'pypi-short'],
  ['dckr_pat_', `dckr_pat_${rep('a', 27)}`, 'dckr_pat_abc'],
  ['lin_api_', `lin_api_${rep('a', 40)}`, `lin_api_${rep('a', 39)}`],
  ['glsa_', `glsa_${rep('A', 32)}_${rep('a', 8)}`, `glsa_${rep('A', 32)}`],
  ['whsec_', `whsec_${rep('a', 30)}`, 'whsec_abc'],
  ['Twilio SK', `SK${rep('a', 32)}`, `SK${rep('g', 32)}`],
  ['sntrys_', `sntrys_${rep('A', 50)}`, 'sntrys_abc'],
  ['sbp_', `sbp_${rep('a', 40)}`, `sbp_${rep('a', 39)}`],
];
test('r8-03-3: each new vendor token shape has a positive and a near miss', () => {
  for (const [name, hit, miss] of VENDOR) {
    const r = redact(`value ${hit} end`);
    assert.ok(r.found.some((f) => f.id === 'token'), `${name}: positive not found`);
    assert.ok(!r.text.includes(hit.slice(-12)), `${name}: the tail survived`);
    assert.deepEqual(redact(`value ${miss} end`).found, [], `${name}: near miss was redacted`);
  }
});

test('S2: the AI-writing sender is one more entry point on the same corpus: every leak is gone from the body that is sent', () => {
  const w = read('core/ai-write.js');
  assert.match(w, /import \{ maskOutbound \} from '\.\/ai-brief\.js'/, 'it uses the same maskOutbound as the exports');
  assert.match(w, /outboundText = \(block\) => maskOutbound\(/);
  assert.match(w, /buildRequest\(provider, model \|\| p\.defaultModel, key, text\)/, 'the request is built from the masked text only');
  for (const [, hit] of VENDOR) assert.ok(!scanOutbound({ content: hit }).redacted.content.includes(hit.slice(-12)));
});

test('R-02: the phone family keeps ISO dates, dotted dates and IPv4 addresses, and still masks a phone', () => {
  const mask = (t) => scanOutbound({ x: t }, { extra: ['email', 'nationalId', 'phone'] }).redacted.x;
  for (const t of ['Failed on 2026-10-14 in checkout', 'Due 14.10.2026 reached', 'connect ECONNREFUSED 192.168.100.200:8080']) assert.equal(mask(t), t, t);
  assert.ok(!mask('call +966 50 123 4567 now').includes('4567'), 'a plus-number is still masked');
  assert.ok(!mask('call 050-123-4567 now').includes('4567'), 'a dashed national number is still masked');
});

console.log(`\n${passed} passed, 0 failed`);
