/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The pre-send secret scan: shapes found, placeholders skipped, offsets exact,
 * redaction leaves no value, findings never carry one.
 *
 *   node tools/test-secret-scan.mjs
 */
import assert from 'node:assert/strict';
import { scanText, redactText, scanFields, adfText, redactAdf, REDACTION } from '../core/secret-scan.js';

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

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
