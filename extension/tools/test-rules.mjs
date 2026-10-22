/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unit tests for the request-rule engine.
 *
 *   node tools/test-rules.mjs
 *
 * The matcher and the two transforms are pure, so they are extracted from
 * content/page-hooks.js and exercised directly. That file runs in the page's
 * MAIN world and cannot be imported, so the functions are re-declared here from
 * the same source text — the parse below fails loudly if they are renamed or
 * moved, which is the only way this stays honest rather than testing a copy
 * that has quietly diverged.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { lift as liftSource } from './lib-lift.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'content', 'page-hooks.js'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/**
 * Lift a function declaration out of the content script by name.
 *
 * The brace counter this used to do by hand could not see that a `{` inside a
 * string literal is not a block, so lifting anything containing `startsWith('{')`
 * ran past the end of the function and failed with a syntax error that named
 * the wrong line. `lib-lift.mjs` skips strings, templates, regexes and comments.
 */
const lift = (name) => liftSource(SOURCE, name);

/** Rebuild the engine with a given rule set. The lifted source sees `rules` as
    its own module-scope binding, exactly as it does in the page. */
const build = new Function(
  'rulesRef',
  'awakeRef',
  `const rules = rulesRef;
   // page-hooks.js gates every match on the master switch. The harness has to
   // supply it, and a test below proves the gate is load-bearing rather than
   // decorative.
   const awake = awakeRef;
   ${lift('ruleHits')}
   ${lift('matchRules')}
   ${lift('redirectUrl')}
   ${lift('editHeaders')}
   return { ruleHits, matchRules, redirectUrl, editHeaders };`
);

/** Awake by default; the sleeping case is tested explicitly. */
const engine = (rules, awake = true) => build(rules, awake);

const rule = (over = {}) => ({ enabled: true, method: 'ANY', pattern: '', ...over });

console.log('page-hooks.js — the master switch');

test('no rule matches while the extension is asleep', () => {
  const { matchRules } = engine([rule({ action: 'fail' })], false);
  assert.equal(matchRules('/api/x', 'GET').all.length, 0, 'a sleeping extension must not touch a request');
});

test('the same rule matches once it is awake', () => {
  const { matchRules } = engine([rule({ action: 'fail' })], true);
  assert.equal(matchRules('/api/x', 'GET').all.length, 1);
});

console.log('page-hooks.js — matching');

test('a disabled rule never matches', () => {
  const { matchRules } = engine([rule({ enabled: false, action: 'fail' })]);
  assert.equal(matchRules('/api/x', 'GET').all.length, 0);
});

test('an exhausted rule never matches', () => {
  const { matchRules } = engine([rule({ action: 'fail', remaining: 0 })]);
  assert.equal(matchRules('/api/x', 'GET').all.length, 0);
});

test('method narrows the match', () => {
  const { matchRules } = engine([rule({ action: 'fail', method: 'POST' })]);
  assert.equal(matchRules('/api/x', 'GET').all.length, 0);
  assert.equal(matchRules('/api/x', 'POST').all.length, 1);
});

test('an empty pattern matches every request', () => {
  const { matchRules } = engine([rule({ action: 'fail' })]);
  assert.equal(matchRules('https://anything/at/all', 'GET').all.length, 1);
});

test('a broken regex matches nothing instead of throwing', () => {
  const { matchRules } = engine([rule({ action: 'fail', isRegex: true, pattern: '([' })]);
  assert.doesNotThrow(() => matchRules('/api/x', 'GET'));
  assert.equal(matchRules('/api/x', 'GET').all.length, 0);
});

console.log('\npage-hooks.js — composing');

test('every matching rule is returned, not only the first', () => {
  const { matchRules } = engine([
    rule({ pattern: '/api', headers: { 'X-A': '1' } }),
    rule({ pattern: '/api', delayMs: 100 }),
    rule({ pattern: '/api', action: 'status', status: 503 }),
  ]);
  assert.equal(matchRules('/api/x', 'GET').all.length, 3);
});

test('the terminal action is the one that replaces the response', () => {
  const { matchRules } = engine([
    rule({ pattern: '/api', headers: { 'X-A': '1' } }),
    rule({ pattern: '/api', action: 'status', status: 503 }),
  ]);
  assert.equal(matchRules('/api/x', 'GET').terminal.status, 503);
});

test('modifiers alone produce no terminal action, so the real request still runs', () => {
  const { matchRules } = engine([rule({ pattern: '/api', headers: { 'X-A': '1' } })]);
  const { all, terminal } = matchRules('/api/x', 'GET');
  assert.equal(all.length, 1);
  assert.equal(terminal, null, 'a header edit must not swallow the request');
});

test('the first terminal action wins — two do not stack', () => {
  const { matchRules } = engine([
    rule({ pattern: '/api', action: 'status', status: 500 }),
    rule({ pattern: '/api', action: 'fail' }),
  ]);
  assert.equal(matchRules('/api/x', 'GET').terminal.status, 500);
});

console.log('\npage-hooks.js — redirect');

test('a plain pattern swaps that substring, leaving the rest of the URL alone', () => {
  const { redirectUrl } = engine([]);
  assert.equal(
    redirectUrl({ pattern: 'https://api.live.example', redirectTo: 'http://localhost:3000' },
      'https://api.live.example/v2/users?page=2'),
    'http://localhost:3000/v2/users?page=2'
  );
});

test('a regex redirect substitutes its capture groups', () => {
  const { redirectUrl } = engine([]);
  assert.equal(
    redirectUrl({ isRegex: true, pattern: '^https://cdn\\.example/(.*)$', redirectTo: 'http://localhost:8080/$1' },
      'https://cdn.example/app/bundle.js'),
    'http://localhost:8080/app/bundle.js'
  );
});

test('a rule with no destination leaves the URL untouched', () => {
  const { redirectUrl } = engine([]);
  assert.equal(redirectUrl({ pattern: '/api' }, '/api/x'), '/api/x');
});

test('a broken regex leaves the URL untouched rather than throwing', () => {
  const { redirectUrl } = engine([]);
  assert.equal(redirectUrl({ isRegex: true, pattern: '([', redirectTo: 'x' }, '/api/y'), '/api/y');
});

console.log('\npage-hooks.js — headers');

test('a header is added', () => {
  const { editHeaders } = engine([]);
  assert.deepEqual(editHeaders({ accept: 'json' }, { 'X-Tenant': 'acme' }), { accept: 'json', 'X-Tenant': 'acme' });
});

test('an existing header is replaced whatever its casing', () => {
  const { editHeaders } = engine([]);
  assert.deepEqual(
    editHeaders({ 'Content-Type': 'text/plain' }, { 'content-type': 'application/json' }),
    { 'Content-Type': 'application/json' },
    'a second entry differing only in case would send two headers'
  );
});

test('null removes a header — the point of the Authorization preset', () => {
  const { editHeaders } = engine([]);
  assert.deepEqual(editHeaders({ Authorization: 'Bearer x', accept: 'json' }, { authorization: null }), { accept: 'json' });
});

test('an empty string removes too, since a form field cannot produce null', () => {
  const { editHeaders } = engine([]);
  assert.deepEqual(editHeaders({ 'X-A': '1' }, { 'X-A': '' }), {});
});

test('the original object is not mutated', () => {
  const { editHeaders } = engine([]);
  const base = { accept: 'json' };
  editHeaders(base, { 'X-A': '1' });
  assert.deepEqual(base, { accept: 'json' });
});

console.log('page-hooks.js — a <form> submit is a navigation (H1)');

/** The real page-hooks.js in a vm with just enough window/document to take rules and a submit event. */
function bootHooks() {
  const handlers = {};
  const written = [];
  const posted = [];
  const win = {
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    postMessage(data) { posted.push(data); },
    fetch: async () => ({ status: 200 }),
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} },
    setTimeout, clearTimeout,
  };
  win.window = win;
  const document = { readyState: 'complete', addEventListener() {}, open() { written.length = 0; }, write(h) { written.push(h); }, close() {} };
  const ctx = vm.createContext({
    window: win, document, console, performance, URL, URLSearchParams, FormData: class { constructor(f) { this.f = f; } *[Symbol.iterator]() { yield* Object.entries(this.f.fields); } },
    TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError, JSON, RegExp, WeakMap, Symbol, Response: class {}, Headers: class {},
    setTimeout, clearTimeout, location: { href: 'https://site.test/login', origin: 'https://site.test' }, navigator: {},
  });
  vm.runInContext(SOURCE, ctx, { filename: 'page-hooks.js' });
  const tell = (data) => handlers.message.forEach((fn) => fn({ source: win, data }));
  const submit = (form, extra = {}) => {
    const ev = { target: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    handlers.submit.forEach((fn) => fn(ev));
    return ev;
  };
  return { tell, submit, written, posted };
}
const loginForm = () => ({
  tagName: 'FORM', action: 'https://site.test/authenticate', method: 'post', fields: { username: 'u' },
});
const natives = [];
const formProto = { submit() { natives.push(this.action); } };
const mkForm = () => Object.setPrototypeOf(loginForm(), formProto);
const wake = (h, rules) => { h.tell({ source: 'uqa-awake', awake: true }); h.tell({ source: 'uqa-rules', rules }); };
const later = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function asyncTest(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

await asyncTest('a 500 rule cancels the Login form submit and writes the 500 answer into the page', async () => {
  const h = bootHooks();
  wake(h, [rule({ id: 'a', action: 'status', status: 500, body: '{"error":"Forced by QA Wrap"}', contentType: 'application/json', label: 'Server error (500)' })]);
  const ev = h.submit(mkForm());
  assert.equal(ev.defaultPrevented, true, 'the real navigation is cancelled');
  await later();
  assert.match(h.written.join(''), /<title>500<\/title>.*Forced by QA Wrap/s);
  const net = h.posted.map((m) => m?.event || m).find((e) => e?.kind === 'net');
  assert.ok(!net || (net.via === 'document' && net.status === 500 && net.overridden === true), 'reported as an overridden document 500');
});

await asyncTest('K1: a real click on a plain <button> (no formaction) matches the FORM action, not the document url', async () => {
  const h = bootHooks();
  wake(h, [rule({ id: 'k', action: 'status', status: 500, pattern: '/authenticate' })]);
  // What Chrome gives a trusted click: submitter.formAction is the document url and formMethod "" when the button sets none.
  const submitter = { getAttribute: () => null, formAction: 'https://site.test/login', formMethod: '' };
  const ev = h.submit(mkForm(), { submitter });
  assert.equal(ev.defaultPrevented, true, 'the rule on /authenticate fires although the page is /login');
  await later();
  assert.match(h.written.join(''), /<title>500<\/title>/);
  // A button that does set formaction still wins.
  wake(h, [rule({ id: 'k2', action: 'status', status: 500, pattern: '/other' })]);
  const own = { getAttribute: (n) => (n === 'formaction' ? '/other' : null), formAction: 'https://site.test/other', formMethod: '' };
  assert.equal(h.submit(mkForm(), { submitter: own }).defaultPrevented, true, 'formaction attribute is honoured');
});

await asyncTest('nothing to do leaves the submit alone: no rule, a pattern that misses, asleep, or an app that took it over', async () => {
  const h = bootHooks();
  wake(h, []);
  assert.equal(h.submit(mkForm()).defaultPrevented, false, 'no rules');
  wake(h, [rule({ id: 'b', action: 'status', status: 500, pattern: '/other' })]);
  assert.equal(h.submit(mkForm()).defaultPrevented, false, 'pattern misses');
  wake(h, [rule({ id: 'c', action: 'status', status: 500 })]);
  assert.equal(h.submit(mkForm(), { defaultPrevented: true }).defaultPrevented, true);
  assert.equal(h.written.length, 0, 'an app that handled the submit itself (fetch/XHR) is left to those hooks');
  const asleep = bootHooks();
  asleep.tell({ source: 'uqa-rules', rules: [rule({ id: 'd', action: 'status', status: 500 })] });
  assert.equal(asleep.submit(mkForm()).defaultPrevented, false, 'asleep');
});

await asyncTest('a delay rule holds the submit, then lets it through natively; a failure rule shows an unreachable page', async () => {
  natives.length = 0;
  const h = bootHooks();
  wake(h, [rule({ id: 'e', action: 'delay', delayMs: 20 })]);
  assert.equal(h.submit(mkForm()).defaultPrevented, true);
  assert.equal(natives.length, 0, 'not yet');
  await later(60);
  assert.deepEqual(natives, ['https://site.test/authenticate']);
  const f = bootHooks();
  wake(f, [rule({ id: 'f', action: 'fail' })]);
  f.submit(mkForm());
  await later();
  assert.match(f.written.join(''), /can.t be reached/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
