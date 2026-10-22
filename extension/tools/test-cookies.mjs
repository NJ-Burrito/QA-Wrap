/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Cookie formats.
 *
 * The assertions that matter are the round trips and the three details every
 * implementation gets wrong: expiry units, the leading dot, and the difference
 * between a session cookie and an expired one.
 */
import assert from 'node:assert/strict';
import {
  parse, serialise, detectFormat, whatIsLost,
  parseJson, parseNetscape, parseHeader, parseSetCookie,
  toNetscape, toHeader, toSetCookie, usable, FORMATS,
} from '../core/cookie-formats.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const SOON = Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000);

const RICH = [
  { name: 'session', value: 'abc123', domain: '.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: SOON },
  { name: 'lang', value: 'ar-JO', domain: 'example.test', path: '/app', secure: false, httpOnly: false, sameSite: 'strict' },
];

console.log('cookie-formats.js — detection');

test('each format is recognised from a paste', () => {
  assert.equal(detectFormat('[{"name":"a","value":"1"}]'), 'json');
  assert.equal(detectFormat('# Netscape HTTP Cookie File\n.a.test\tTRUE\t/\tFALSE\t0\tx\ty'), 'netscape');
  assert.equal(detectFormat('Set-Cookie: a=1; Path=/; HttpOnly'), 'setcookie');
  assert.equal(detectFormat('a=1; b=2'), 'header');
});

test('a headerless cookies.txt is still recognised by its shape', () =>
  assert.equal(detectFormat('.a.test\tTRUE\t/\tFALSE\t0\tx\ty'), 'netscape'));

test('an empty paste detects as nothing rather than guessing', () => {
  assert.equal(detectFormat('   '), null);
  assert.throws(() => parse('   '), /Could not tell what format/);
});

console.log('\ncookie-formats.js — the three details everyone gets wrong');

test('expiry is seconds, and milliseconds are caught rather than accepted', () => {
  const ms = parseJson(`[{"name":"a","value":"1","expirationDate":${SOON * 1000}}]`)[0];
  assert.equal(ms.expirationDate, SOON, 'a millisecond timestamp must be corrected, not stored');
  const s = parseJson(`[{"name":"a","value":"1","expirationDate":${SOON}}]`)[0];
  assert.equal(s.expirationDate, SOON, 'seconds must pass through untouched');
});

test('a session cookie has no expiry — which is not an expiry of zero', () => {
  const c = parseJson('[{"name":"a","value":"1"}]')[0];
  assert.equal(c.expirationDate, null, 'zero would delete the cookie');
  assert.equal(c.session, true);
});

test('the leading dot and hostOnly agree, whichever one arrived', () => {
  assert.equal(parseJson('[{"name":"a","value":"1","domain":".x.test"}]')[0].hostOnly, false);
  assert.equal(parseJson('[{"name":"a","value":"1","domain":"x.test"}]')[0].hostOnly, true);
});

console.log('\ncookie-formats.js — round trips');

test('JSON survives a round trip with every attribute intact', () => {
  const back = parseJson(serialise(RICH, 'json'));
  assert.equal(back.length, 2);
  assert.equal(back[0].httpOnly, true);
  assert.equal(back[0].secure, true);
  assert.equal(back[0].sameSite, 'lax');
  assert.equal(back[0].expirationDate, SOON);
  assert.equal(back[1].sameSite, 'strict');
});

test('Netscape survives a round trip, HttpOnly included', () => {
  const text = toNetscape(RICH);
  assert.match(text, /^#HttpOnly_/m, 'HttpOnly has no field in the format and must use the curl prefix');
  const back = parseNetscape(text);
  assert.equal(back.length, 2);
  assert.equal(back[0].httpOnly, true, 'the prefix must be read back');
  assert.equal(back[0].secure, true);
  assert.equal(back[0].domain, '.example.test');
  assert.equal(back[0].expirationDate, SOON);
  assert.equal(back[1].httpOnly, false);
});

test('a Netscape session cookie writes 0 and reads back as no expiry', () => {
  const text = toNetscape([{ name: 's', value: '1', domain: 'x.test', path: '/' }]);
  assert.match(text, /\t0\ts\t1$/m, 'a session cookie is expiry 0 in this format');
  assert.equal(parseNetscape(text)[0].expirationDate, null, 'and must not come back as 1970');
});

test('includeSubdomains and the leading dot stay in agreement', () => {
  const withDot = parseNetscape('.a.test\tTRUE\t/\tFALSE\t0\tx\ty')[0];
  assert.equal(withDot.domain, '.a.test');
  assert.equal(withDot.hostOnly, false);
  // TRUE in the third column means subdomains, so the dot has to be added.
  const noDot = parseNetscape('a.test\tTRUE\t/\tFALSE\t0\tx\ty')[0];
  assert.equal(noDot.domain, '.a.test', 'TRUE means subdomains, which Chrome spells with a dot');
});

test('Set-Cookie survives a round trip', () => {
  const back = parseSetCookie(toSetCookie(RICH));
  assert.equal(back.length, 2);
  assert.equal(back[0].httpOnly, true);
  assert.equal(back[0].secure, true);
  assert.equal(back[0].sameSite, 'lax');
  // A UTC date string, not a number — which is why normalise takes both.
  assert.equal(back[0].expirationDate, SOON);
});

test('Max-Age is read as well as Expires', () => {
  const c = parseSetCookie('Set-Cookie: a=1; Max-Age=3600')[0];
  const expected = Math.floor(Date.now() / 1000) + 3600;
  assert.ok(Math.abs(c.expirationDate - expected) < 5, `${c.expirationDate} is not about an hour away`);
});

test('SameSite=None becomes Chrome’s no_restriction, both ways', () => {
  assert.equal(parseSetCookie('Set-Cookie: a=1; SameSite=None')[0].sameSite, 'no_restriction');
  assert.match(toSetCookie([{ name: 'a', value: '1', sameSite: 'no_restriction' }]), /SameSite=None/);
});

console.log('\ncookie-formats.js — what a lossy format loses');

test('a header carries names and values, and nothing else', () => {
  const text = toHeader(RICH);
  assert.equal(text, 'session=abc123; lang=ar-JO');
  const back = parseHeader(text, { domain: 'example.test' });
  assert.equal(back.length, 2);
  assert.equal(back[0].httpOnly, false, 'a header cannot carry HttpOnly, so it must not claim to');
  assert.equal(back[0].domain, 'example.test', 'the domain has to come from the caller, not be invented');
});

test('a pasted header keeps its "Cookie:" prefix out of the first name', () => {
  const back = parseHeader('Cookie: a=1; b=2');
  assert.deepEqual(back.map((c) => c.name), ['a', 'b']);
});

test('a value containing = survives', () => {
  assert.equal(parseHeader('token=abc=def==')[0].value, 'abc=def==');
});

test('the loss is stated before the format is used', () => {
  const header = whatIsLost('header', RICH);
  assert.match(header, /2 of 2/, 'it should count what will be lost');
  assert.match(whatIsLost('netscape', RICH), /SameSite/);
  assert.equal(whatIsLost('json', RICH), null, 'JSON loses nothing, so it should say nothing');
});

console.log('\ncookie-formats.js — being forgiving about input');

test('a bare object and a { cookies: [...] } wrapper both import', () => {
  assert.equal(parseJson('{"name":"a","value":"1"}').length, 1);
  assert.equal(parseJson('{"cookies":[{"name":"a","value":"1"},{"name":"b","value":"2"}]}').length, 2);
});

test('invalid JSON is refused by name, not by stack trace', () =>
  assert.throws(() => parseJson('{nope'), /That is not valid JSON/));

test('junk lines in a cookies.txt are skipped, not fatal', () => {
  const back = parseNetscape('# a comment\n\nnot enough fields\n.a.test\tTRUE\t/\tFALSE\t0\tx\ty');
  assert.equal(back.length, 1);
});

test('every format declares an extension, a mime type and a hint', () => {
  for (const f of FORMATS) {
    assert.ok(f.ext && f.mime, `${f.id} cannot be saved without both`);
    assert.ok(f.hint && f.hint.length > 25, `${f.id} has no usable hint`);
  }
  assert.equal(FORMATS.length, 4);
});

console.log('\ncookie-formats.js — nothing is silently dropped');

test('a nameless cookie is separated with a reason, not filtered away', () => {
  const parsed = parseJson('[{"name":"a","value":"1"},{"value":"orphan"}]');
  assert.equal(parsed.length, 2, 'both must survive parsing — the caller decides what to do');
  const { ok, refused } = usable(parsed);
  assert.equal(ok.length, 1);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /no name/, 'and it has to say why');
});

test('a header with a bare separator keeps the real cookies', () => {
  // "12 of 13 imported" with no way to find the thirteenth is the failure this
  // whole split guards against.
  const { ok } = usable(parseHeader('a=1; ; b=2'));
  assert.equal(ok.length, 2);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
