/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The pre-send secret scan: shapes found, placeholders skipped, offsets exact,
 * redaction leaves no value, findings never carry one.
 *
 *   node tools/test-secret-scan.mjs
 */
import assert from 'node:assert/strict';
import { scanText, redactText, scanFields, adfText, redactAdf, REDACTION } from '../core/secret-scan.js';
import { maskBodyKeys, scanOutbound } from '../core/secret-scan-text.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
// Built from parts so this file holds no secret-shaped literal.
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fw'].join('.');
const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const kinds = (t, known) => scanText(t, known).map((h) => h.kind);

console.log('secret scan - shapes');
test('a JWT is found with exact offsets', () => {
  const t = `x ${JWT} y`;
  const [h] = scanText(t);
  assert.equal(h.kind, 'jwt');
  assert.equal(t.slice(h.start, h.end), JWT);
});
test('Authorization header values, bearer and basic', () => {
  assert.deepEqual(kinds('Authorization: Bearer abcdef1234567890'), ['authorization']);
  assert.deepEqual(kinds('{"authorization":"Basic dXNlcjpwYXNzd29yZA=="}'), ['authorization']);
});
test('cookie header values', () => assert.deepEqual(kinds('Cookie: sid=abc123def456; theme=dark'), ['cookie']));
test('vendor tokens', () => assert.deepEqual(kinds(`token in log ${GH}`).includes('vendor-token'), true));
test('password pairs in JSON and form encodings', () => {
  assert.deepEqual(kinds('{"password":"hunter2hunter2"}'), ['password']);
  assert.deepEqual(kinds('user=a&client_secret=zzzzzzzz&x=1'), ['password']);
});
test('URL credentials and private key blocks', () => {
  assert.deepEqual(kinds('https://bob:s3cretpw@host.test/x'), ['url-credentials']);
  assert.deepEqual(kinds('-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----'), ['private-key']);
});
test('capture-time placeholders and ordinary prose are not secrets', () => {
  assert.deepEqual(scanText('authorization: «redacted»'), []);
  assert.deepEqual(scanText('password: ••••••••'), []);
  assert.deepEqual(scanText('Cookie: [REDACTED]'), []);
  assert.deepEqual(scanText('The login page shows the word password and a token field is empty.'), []);
  assert.deepEqual(scanText('token: true'), []);
});
test('the vault\'s own token is found by exact match wherever it is, short values ignored', () => {
  const vault = 'CANARY/jira+TOKEN=7f3a91xq';
  const t = `see ${vault} and again ${vault} end`;
  const hits = scanText(t, [vault, 'short']);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.kind === 'saved-token' && t.slice(h.start, h.end) === vault));
  assert.deepEqual(scanText('short short', ['short']), []);
});
test('overlapping hits merge into one range', () => {
  const t = `Authorization: Bearer ${JWT}`;
  assert.equal(scanText(t).length, 1);
});

console.log('\nsecret scan - redaction and findings');
test('redactText replaces every range and leaves no value behind', () => {
  const t = `a ${JWT} b ${GH} c`;
  const out = redactText(t, scanText(t));
  assert.equal(out, `a ${REDACTION} b ${REDACTION} c`);
});
test('scanFields: findings carry field, kind and offsets but never the value', () => {
  const r = scanFields({ summary: 'ok', description: `x ${GH}` });
  assert.equal(r.findings.length, 1);
  assert.deepEqual(Object.keys(r.findings[0]).sort(), ['end', 'field', 'kind', 'length', 'start']);
  assert.ok(!JSON.stringify(r.findings).includes(GH));
  assert.ok(!r.redacted.description.includes(GH));
  assert.equal(r.redacted.summary, 'ok');
});
test('ADF: text is flattened per block and redaction keeps the structure', () => {
  const doc = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
    { type: 'paragraph', content: [{ type: 'text', text: `key ${GH}`, marks: [{ type: 'code' }] }] },
  ] };
  assert.equal(adfText(doc), `one\nkey ${GH}\n`);
  const clean = redactAdf(doc);
  assert.equal(clean.content[1].content[0].text, `key ${REDACTION}`);
  assert.deepEqual(clean.content[1].content[0].marks, [{ type: 'code' }]);
  assert.ok(JSON.stringify(doc).includes(GH), 'the original is not mutated');
});

test('the QA Wrap provenance stamp in a HAR is not a finding; a real token beside it still is', () => {
  const har = `{ "generated": "2026", "token": "qaw1:eyJwIjoiUUEgV3JhcCJ9.227d669b", "x": 1 }`;
  assert.deepEqual(scanText(har), []);
  assert.equal(scanText(`${har}
token: hunter2hunter2`).length, 1);
});

test('r4-03-4: the four probe strings, mirrored from core/privacy.js, are found; "author: Jane Doe" is not', () => {
  assert.deepEqual(kinds('{"authorization":"Token abc123def456ghi789"}'), ['authorization']);
  assert.deepEqual(kinds('https://u:pw123@host.com/a'), ['url-credentials']);
  assert.deepEqual(kinds('set-cookie: sid=abcdef1234567890abcdef'), ['cookie']);
  const body = '{"credential":"c-1234567890","passphrase":"correct-horse-battery","private_key":"MIIEvQIBADAN","bearer":"zzzzzzzzzzzz1"}';
  assert.deepEqual(kinds(body), ['password', 'password', 'password', 'password']);
  assert.deepEqual(scanText('author: Jane Doe'), []);
  assert.deepEqual(scanText('{"author":"Jane Doe","authorName":"Jane Doe"}'), []);
});

test('r3-03-1 / r3-03-2: every new vendor shape is a vendor-token finding; a secret-named pair is a finding in text too; bare pass/session in JSON are not', () => {
  const a = (n, c = 'a') => c.repeat(n);
  for (const tok of [`sk_${'live'}_${a(24)}`, `rk_${'test'}_${a(24)}`, `npm_${a(36)}`, `SG.${a(22)}.${a(22, 'b')}`, `ya29.${a(40)}`, `hf_${a(34)}`, `dop_v1_${a(64, '1')}`, `AccountKey=${a(86, 'Q')}==`]) {
    assert.deepEqual(kinds(`k ${tok} z`), ['vendor-token'], tok.slice(0, 8));
  }
  assert.deepEqual(kinds('https://a.test/p?phpsessid=abcdef123456&b=1'), ['password']);
  assert.deepEqual(kinds('{"pass":"failed-run","session":"recording"}'), []);
});

// Mutation testing (Stryker, 2026-11-24): maskBodyKeys and the merge / known-token / outbound rules had most mutants survive.
test('maskBodyKeys: urlencoded values of credential names are masked, the rest kept byte for byte', () => {
  const R = encodeURIComponent(REDACTION);
  assert.equal(maskBodyKeys({ kind: 'form', text: 'user=ann&password=hunter2xyz&api_key=k1&=x&token' }).text, `user=ann&password=${R}&api_key=${R}&=x&token`);
  assert.equal(maskBodyKeys({ kind: 'form', text: 'pass%77ord=zz' }).text, `pass%77ord=${R}`, 'the key is URL-decoded before it is judged');
  assert.equal(maskBodyKeys({ kind: 'form', text: 'password=a' }, (k) => `<${k}>`).text, 'password=%3Cpassword%3E', 'the replacement comes from rep(key)');
});
test('maskBodyKeys: FormData text parts are masked by name; file parts and other names are untouched', () => {
  const parts = [{ name: 'password', value: 'p1' }, { name: 'token', file: true, value: 'blob' }, { name: 'city', value: 'Amman' }, null];
  assert.deepEqual(maskBodyKeys({ kind: 'FormData', parts }).parts, [{ name: 'password', value: REDACTION }, { name: 'token', file: true, value: 'blob' }, { name: 'city', value: 'Amman' }, null]);
  assert.equal(parts[0].value, 'p1', 'the input is not changed');
});
test('maskBodyKeys: JSON is walked (nested objects and arrays); an object under a secret name goes whole; null and booleans stay', () => {
  const b = { kind: 'json', text: JSON.stringify({ user: 'ann', password: 'p1', nested: { api_key: 'k' }, list: [{ token: 't' }], secret: null, client_secret: { a: 1 }, other: { password: false } }) };
  assert.deepEqual(JSON.parse(maskBodyKeys(b).text), { user: 'ann', password: REDACTION, nested: { api_key: REDACTION }, list: [{ token: REDACTION }], secret: null, client_secret: REDACTION, other: { password: false } });
  assert.deepEqual(JSON.parse(maskBodyKeys({ kind: 'text', text: ' [{"password":"x"}]' }).text), [{ password: REDACTION }], 'a text body that is JSON is treated as JSON');
});
test('maskBodyKeys: a cut-off JSON body is masked by pattern; nothing to mask returns the same object', () => {
  assert.equal(maskBodyKeys({ kind: 'json', text: '{"password": "abc", "user": "ann", "token": 12345, oops' }).text, `{"password": "${REDACTION}", "user": "ann", "token": "${REDACTION}", oops`);
  for (const b of [{ kind: 'json', text: '{"a":1}' }, { kind: 'text', text: 'password=x' }, { kind: 'raw', text: '{"password":"x"}' }, { kind: 'json' }]) assert.equal(maskBodyKeys(b), b, JSON.stringify(b));
  assert.equal(maskBodyKeys(null), null);
});
test('scanText: an empty text, a placeholder and the qaw1 provenance stamp are not findings', () => {
  assert.deepEqual(scanText(''), []);
  assert.deepEqual(scanText(null), []);
  assert.deepEqual(scanText('password: [redacted]'), []);
  assert.deepEqual(scanText('"token": "qaw1:abcdef0123456789"'), []);
});
test('scanText: saved tokens of 8+ characters are found every time they occur; shorter ones never', () => {
  const t = 'id abcdefgh1 and again abcdefgh1; short abc7';
  assert.deepEqual(scanText(t, ['abcdefgh1', 'abc7', '', null]).map((h) => [h.kind, t.slice(h.start, h.end)]), [['saved-token', 'abcdefgh1'], ['saved-token', 'abcdefgh1']]);
  assert.deepEqual(scanText('x 12345678 y', ['12345678']).map((h) => h.kind), ['saved-token'], 'exactly 8 is enough');
  assert.deepEqual(scanText('x 1234567 y', ['1234567']), [], '7 is not');
});
test('scanText: overlapping hits merge into one range, which takes the saved-token kind and the furthest end', () => {
  const tok = 'ghp_' + 'a'.repeat(36);
  const t = `password=${tok}`;
  const h = scanText(t, [tok]);
  assert.equal(h.length, 1);
  assert.equal(h[0].kind, 'saved-token');
  assert.equal(t.slice(h[0].start, h[0].end), tok);
  assert.deepEqual(scanFields({ a: t }, [tok]).findings, [{ field: 'a', kind: 'saved-token', start: 9, end: 9 + tok.length, length: tok.length }]);
});
test('scanOutbound: observe cuts confirmed kinds and saved tokens by scan (a guess is only recorded); enforce cuts every finding', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
  const text = `jwt ${jwt} password=hunter2hunter2`;
  const o = scanOutbound({ body: text });
  assert.ok(!o.redacted.body.includes(jwt) && !o.redacted.body.includes('hunter2hunter2'), o.redacted.body); // the password goes too: the capture redactor masks it after the scan
  assert.deepEqual(o.findings.filter((f) => f.kind === 'jwt' || f.kind === 'password').map((f) => [f.kind, f.redacted]), [['jwt', true], ['password', false]]);
  const e = scanOutbound({ body: text }, { mode: 'enforce' });
  assert.ok(!e.redacted.body.includes('hunter2hunter2') && e.findings.filter((f) => f.kind === 'password').every((f) => f.redacted));
  assert.ok(!scanOutbound({ b: 'saved X9k2mQ7vL4pZ' }, { known: ['X9k2mQ7vL4pZ'] }).redacted.b.includes('X9k2mQ7vL4pZ'), 'a saved token is cut even in observe');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
