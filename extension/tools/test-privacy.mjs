/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Redaction, tested from both directions.
 *
 * A redactor is judged twice and fails differently each time. Miss a card
 * number and it goes into a ticket attachment. Eat every order reference and
 * the tester turns it off, after which it misses everything. So each family is
 * tested for what it must catch *and* for what it must leave alone, and the
 * second list is the longer one on purpose.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, luhnValid, ibanValid, REDACTED, FAMILIES, isSecretParam } from '../core/privacy.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const gone = (s, opts) => !redact(s, opts).text.includes(s.trim());
const kept = (s, opts) => redact(s, opts).text === s;

console.log('privacy.js — what must go, and what must stay');

/* ── the checksums, which are what stop this eating ordinary data ───────── */

test('Luhn accepts real card numbers and rejects lookalikes', () => {
  for (const good of ['4111111111111111', '5500005555555559', '340000000000009']) {
    assert.ok(luhnValid(good), `${good} should pass Luhn`);
  }
  for (const bad of ['4111111111111112', '1234567890123456', '2026090412345678']) {
    assert.ok(!luhnValid(bad), `${bad} should fail Luhn`);
  }
});

test('IBAN mod-97 accepts real accounts and rejects a wrong check digit', () => {
  assert.ok(ibanValid('GB82 WEST 1234 5698 7654 32'));
  assert.ok(ibanValid('DE89370400440532013000'));
  assert.ok(!ibanValid('GB83 WEST 1234 5698 7654 32'));
  assert.ok(!ibanValid('XX00 NOPE'));
});

/* ── what must never survive ───────────────────────────────────────────── */

test('a payment card is removed wherever it appears', () => {
  const { text, found } = redact('paid with 4111 1111 1111 1111 on the third try');
  assert.ok(!text.includes('4111'), text);
  assert.ok(text.includes(REDACTED));
  assert.equal(found[0].id, 'card');
});

test('the digits after a decimal point are a fraction, never a card (SVG and JSON exports)', () => {
  // 4111111111111111 is Luhn-valid: as a fraction it must survive, as a bare number it must not.
  const svg = '<text x="1078.4111111111111111" y="358.5">a</text>';
  assert.equal(redact(svg).text, svg);
  assert.ok(!redact('pan 4111111111111111').text.includes('4111'));
});

test('an IBAN is removed', () => assert.ok(gone('GB82 WEST 1234 5698 7654 32')));

test('a JWT is removed whole, not in pieces', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const { text } = redact(`Authorization: ${jwt}`);
  assert.ok(!text.includes('eyJ'), text);
  assert.equal(text.split(REDACTED).length - 1, 1, 'one replacement, not three');
});

test('a bearer token and an api key are removed', () => {
  assert.ok(!redact('Bearer sk_live_51H8xQ2eZvKYlo2C0abcdef').text.includes('sk_live'));
  assert.ok(!redact('api_key=AKIAIOSFODNN7EXAMPLE').text.includes('AKIAIOSFODNN7'));
});

test('URL credentials after ? & # or ; are removed, and ordinary params are kept (r2-03-2)', () => {
  for (const s of ['https://a.test/cb#access_token=abc123def456&state=x', 'https://a.test/x?password=hunter2hunter2', 'https://a.test/x?a=1&token=abcd1234efgh', 'https://a.test/x;secret=abcd1234efgh', 'https://a.test/x?client_secret=abcd1234efgh', 'https://a.test/cb?code=4/0AbCdEfGhIjKlMnOp']) {
    const { text } = redact(s);
    assert.ok(!/abc123def456|hunter2|abcd1234efgh|4\/0AbCdEf/.test(text), `${s} -> ${text}`);
  }
  for (const s of ['https://a.test/x?page=2', 'https://a.test/x?code=SUMMER26', 'https://a.test/x?key=name', 'https://a.test/x?session_state=abcdefgh']) {
    assert.equal(redact(s).text, s, `${s} must be untouched`);
  }
});

test('a private key block is removed entirely', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
  const { text } = redact(`here it is:\n${key}`);
  assert.ok(!text.includes('MIIEow'), text);
  assert.ok(!text.includes('BEGIN RSA'), text);
});

/* ── what must be left alone, which is the harder half ─────────────────── */

test('ordinary numbers a tester is testing are left alone', () => {
  for (const ordinary of [
    'order 38202600015 was rejected',        // an order number
    'HTTP 500 on /api/applications',
    'quantity 250, price 19.99',
    'version 3.1.0 build 20260904',
    'the page took 1250ms to settle',
  ]) {
    assert.ok(kept(ordinary), `should be untouched: ${ordinary}\n       got: ${redact(ordinary).text}`);
  }
});

test('a long digit run is kept unless national ids are switched on', () => {
  const s = 'national number 9871023456 was not found';
  assert.ok(kept(s), 'off by default');
  assert.ok(!redact(s, { extra: ['nationalId'] }).text.includes('9871023456'), 'removed when asked for');
});

test('an email is kept unless emails are switched on', () => {
  const s = 'signed in as layla@example.com';
  assert.ok(kept(s));
  assert.ok(!redact(s, { extra: ['email'] }).text.includes('layla@'));
});

test('Arabic text is untouched and not corrupted', () => {
  const s = 'الرقم الوطني غير صحيح — أعد المحاولة';
  assert.equal(redact(s).text, s);
});

test('empty and odd input does not throw', () => {
  for (const v of ['', null, undefined, 0, {}, []]) {
    assert.doesNotThrow(() => redact(v));
  }
  assert.equal(redact('').text, '');
});

/* ── the shape of the thing ────────────────────────────────────────────── */

test('every family says what it is, and the loose ones are off by default', () => {
  for (const f of FAMILIES) {
    assert.ok(f.id && f.label, 'a family without a label cannot be explained to a user');
    assert.equal(typeof f.find, 'function');
  }
  const off = FAMILIES.filter((f) => !f.always).map((f) => f.id);
  assert.deepEqual(off.sort(), ['email', 'nationalId', 'phone'], 'only the ambiguous families are opt-in');
});

test('what was removed is reported, but never the value itself', () => {
  const { found } = redact('card 4111111111111111 and token Bearer abcdef0123456789');
  const blob = JSON.stringify(found);
  assert.ok(!blob.includes('4111'), 'the report of a redaction must not carry the redacted value');
  assert.ok(blob.includes('Payment card'));
});

/* ── r3: key/value secrets, the single pass, the 13-digit guard ──────────── */

test('r3-02-1: the value under a password-like key is masked in JSON, form text and truncated JSON', () => {
  for (const [text, secret] of [
    ['{"access_token":"abcdef0123"}', 'abcdef0123'],
    ['{"refresh_token":"abcdefghijklmnop"}', 'abcdefghijklmnop'],
    ['{"password":"hunter2abc"}', 'hunter2abc'],
    ['password=hunter2abc&user=a', 'hunter2abc'],
    ['{"client_secret":"s3cr3tvalue"}', 's3cr3tvalue'],
    ['{"api_key":"k_live_abc"}', 'k_live_abc'],
    ['{"otp":"123456"}', '123456'],
    ['{"user":"a","session_id":"9f8e7d6c5b4a"}', '9f8e7d6c5b4a'],
    ['{"name":"a","pin":"4821","cvv":"913"}', '4821'],
    ['{"id":7,"data":{"token":"q1w2e3r4t5y6', 'q1w2e3r4t5y6'], // cut before the JSON closes: no parse is possible
    ["{'passwd': 'single-quoted-1'}", 'single-quoted-1'],
    ['{"password":"two words here","x":1}', 'two words here'],
  ]) {
    const out = redact(text);
    assert.ok(!out.text.includes(secret), `${text} -> ${out.text}`);
    assert.ok(out.text.includes(REDACTED), text);
    assert.ok(out.found.length, text);
  }
  // The key and the rest of the text stay readable.
  assert.equal(redact('{"user":"a","password":"hunter2abc"}').text, `{"user":"a","password":"${REDACTED}"}`);
  assert.equal(redact('password=hunter2abc&user=a').text, `password=${REDACTED}&user=a`);
});

test('r3-02-1: prose, short numbers, placeholders and look-alike keys are left alone', () => {
  for (const s of [
    'The login page shows the word password and a token field is empty.',
    'Reset your password: see the help page',
    '{"tokenCount": 5, "pinned": true, "shipping": "standard"}',
    '{"password":"","token":null,"secret":true,"pin":"12"}',
    '{"password":"••••••••"}',
    'token: [REDACTED]',
    '{ "token": "qaw1:eyJwIjoiUUEgV3JhcCJ9.227d669b" }',
    'spinner: absolute; mapping: grid',
  ]) assert.equal(redact(s).text, s, s);
});

test('r3-07-1: a 13-digit run that does not start with 4 is not a card; a 13-digit Visa still is', () => {
  const ms = '1760000000008'; // Luhn-valid, looks like a millisecond cache-buster
  assert.ok(luhnValid(ms) && !ms.startsWith('4'));
  assert.equal(redact(`https://cdn.test/a.js?_=${ms}`).text, `https://cdn.test/a.js?_=${ms}`);
  const visa13 = '4222222222222';
  assert.ok(luhnValid(visa13));
  assert.ok(!redact(`pan ${visa13}`).text.includes(visa13));
});

test('r3-07-1: single pass: many hits, adjacent hits, overlaps and folded digits come out right', () => {
  const card = '4539 1488 0343 6467';
  const t = `a ${card} b ${card}, ${card.replace(/ /g, '')} c`;
  const out = redact(t);
  assert.equal(out.text, `a ${REDACTED}b ${REDACTED}, ${REDACTED}c`);
  assert.equal(out.found.find((f) => f.id === 'card').count, 3);
  // Arabic-Indic digits: found on the folded copy, cut from the original, offsets intact
  const ar = '٤٥٣٩ ١٤٨٨ ٠٣٤٣ ٦٤٦٧';
  assert.equal(redact(`رقم ${ar} تم`).text, `رقم ${REDACTED} تم`);
  // A JWT under a "token" key is one finding and one mask, not three
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
  const both = redact(`{"token":"${jwt}"}`);
  assert.equal(both.text, `{"token":"${REDACTED}"}`);
  assert.deepEqual(both.found.map((f) => f.id), ['jwt']);
  // Redacting twice changes nothing more
  assert.equal(redact(both.text).text, both.text);
});

const { scanText } = await import('../core/secret-scan-text.js');
test('r3-02-1: the secret-scan text scanner agrees on the kind for the shapes both know', () => {
  for (const s of ['{"password":"hunter2hunter2"}', 'client_secret=zzzzzzzz&x=1', '{"access_token":"abcdef0123456"}']) {
    const hits = scanText(s);
    assert.ok(hits.length && hits.every((h) => ['password', 'url-param'].includes(h.kind)), s);
    assert.ok(redact(s).found.length, s);
  }
});

test('r4-03-4: authorization/cookie/credential/passphrase/private_key/bearer keys and URL userinfo are masked; "author" is not', () => {
  for (const s of [
    '{"authorization":"Token abc123def456ghi789"}',
    'https://u:pw123@host.com/a',
    'set-cookie: sid=abcdef1234567890abcdef',
    '{"credential":"c-1234567890","passphrase":"correct horse battery","private_key":"MIIEvQIBADAN","bearer":"zzzzzzzzzzzz1"}',
  ]) {
    const out = redact(s).text;
    assert.notEqual(out, s, `${s} was left as it was`);
    for (const secret of ['abc123def456ghi789', 'pw123', 'sid=abcdef', 'c-1234567890', 'correct horse', 'MIIEvQIBADAN', 'zzzzzzzzzzzz1']) assert.ok(!out.includes(secret), `${secret} survived in ${out}`);
  }
  assert.ok(redact('https://u:pw123@host.com/a').text.endsWith('@host.com/a'));
  for (const keep of ['author: Jane Doe', '{"author":"Jane Doe","authorName":"Jane"}', 'https://host:8080/a@b', 'mailto:x@y.com']) assert.ok(kept(keep), `${keep} must not change`);
});

test('card family: a 13-digit millisecond cache-buster in a URL parameter is kept (r1 risk)', () => {
  for (const url of ['https://cdn.test/a.js?_=1728561234567', 'https://cdn.test/a.js?v=1760000000008&x=1']) assert.ok(kept(url), `${url} was masked`);
});

test('r3-03-1: one corpus row per vendor token shape (Stripe, npm, SendGrid, Google OAuth, Hugging Face, DigitalOcean, Azure storage) is masked', () => {
  const a = (n, c = 'a') => c.repeat(n);
  const corpus = [
    `sk_${'live'}_${a(24)}`, `rk_${'test'}_${a(24)}`, `npm_${a(36)}`, `SG.${a(22)}.${a(22, 'b')}`,
    `ya29.${a(40)}`, `hf_${a(34)}`, `dop_v1_${a(64, '1')}`, `AccountKey=${a(86, 'Q')}==`,
  ];
  for (const tok of corpus) {
    const out = redact(`see ${tok} here`);
    assert.ok(!out.text.includes(tok.slice(-12)), `${tok.slice(0, 8)} survived: ${out.text}`);
    assert.ok(out.found.some((f) => f.id === 'token'), `${tok.slice(0, 8)} was not found by the token family`);
  }
  for (const keep of ['npm_install is the command', 'hf_short', 'SG.short.x', 'sk_live_', 'the AccountKey= field is empty']) assert.ok(kept(keep), `${keep} must not change`);
});

test('r3-03-2: a secret-named pair is masked in a query string, a form body and a JSON pair; bare pass/session stay readable in JSON', () => {
  for (const [s, secret] of [
    ['https://a.test/p?phpsessid=abcdef123456&b=1', 'abcdef123456'],
    ['a=1&JSESSIONID=0123456789ABCDEF&b=2', '0123456789ABCDEF'],
    ['x=1;aspsessionid=zzzzzzzz1', 'zzzzzzzz1'],
    ['pass=hunter2hunter2&next=%2F', 'hunter2hunter2'],
    ['{"sid":"abcdefghi","csrf":"tok-1234567"}', 'abcdefghi'],
    ['{"phpsessid":"abcdef123456"}', 'abcdef123456'],
  ]) assert.ok(!redact(s).text.includes(secret), `${secret} survived: ${redact(s).text}`);
  // Why bare pass/session are skipped in the JSON case only: `"pass": "failed-run"` and `"session": "recording"` are
  // test-result and state fields, not credentials; in a query or form body the same names do carry one.
  for (const keep of ['{"pass":"failed-run","session":"recording"}', '{"pass":"passed-all","session":"abcdef123456"}']) assert.ok(kept(keep), `${keep} must not change`);
  for (const keep of ['https://a.test/?page=2&order=ABC123456', 'pass=short', 'session=null', 'phpsessid=•••••••• ok', 'https://host:8080/a', '{"author":"Jane Doe"}', 'https://a.test/x?session_state=abcdefgh']) assert.ok(kept(keep), `${keep} must not change`);
});

test('r7-03-1: access_key and subscription-key URL parameters are masked; key-style secret field names are secret, look-alikes are not', () => {
  const v = 'k9Zq81xLmP02vTa4';
  for (const s of [`https://a.test/p?access_key=${v}&b=1`, `https://a.test/p?b=1&subscription-key=${v}`, `https://a.test/p?Subscription_Key=${v}`]) {
    assert.ok(!redact(s).text.includes(v), `${s} survived`);
  }
  for (const keep of ['https://a.test/p?access=1&key=2', 'https://a.test/p?keyboard=us']) assert.ok(kept(keep), `${keep} must not change`);
  const names = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'privacy-names.json'), 'utf8')).names;
  for (const n of ['accesskey', 'subscriptionkey', 'functionskey', 'secretkey', 'signingkey', 'licensekey', 'dpop']) assert.ok(names.includes(n), `${n} is in the names list`);
  assert.equal(isSecretParam('x-functions-key'), true);
  assert.equal(isSecretParam('Ocp-Apim-Subscription-Key'), true);
  assert.equal(isSecretParam('DPoP'), true);
  assert.equal(isSecretParam('license_key'), true);
  assert.equal(isSecretParam('keyboard'), false);
  assert.equal(isSecretParam('monkey'), false);
});

test('S-12: the redactor stays linear on a long unbroken run of credential-looking words (100 KB under 250 ms)', () => {
  for (const unit of ['token', 'password-', 'a', 'secret_']) {
    const big = unit.repeat(Math.ceil(100_000 / unit.length));
    const t0 = performance.now();
    redact(big);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `${unit} x N took ${Math.round(ms)} ms`);
  }
});

test('S-02: the phone family finds separated numbers only, and is off unless asked for', () => {
  const text = 'call +962 79 123 4567 or (06) 512-3456, order 20261014 stays';
  assert.equal(redact(text).text, text);
  const r = redact(text, { extra: ['phone'] });
  assert.ok(!r.text.includes('123 4567') && !r.text.includes('512-3456'), r.text);
  assert.ok(r.text.includes('20261014'), 'an order number is not a phone');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
