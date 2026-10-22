/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The API panel's two pure parts: variable substitution, and the pre-request
 * sandbox's limits.
 *
 *   node tools/test-api.mjs
 *
 * The sandbox is the interesting half. Every other API client on the market
 * runs a pre-request script as JavaScript; this one cannot, because
 * `script-src 'self'` means `eval` and `new Function` throw in every page the
 * extension owns. So the script is a command language, and the tests below are
 * one per claim the panel makes about it: it cannot reach a global, cannot make
 * a request, cannot loop, and cannot grow without bound. A claim in a comment
 * that no test holds is a claim that quietly stops being true.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  substitute, substituteRequest, runPreScript, parseCollection,
  MAX_SCRIPT_LINES, MAX_VALUE_LENGTH,
} from '../api/sandbox.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('api — {{variable}} substitution');

test('a name in braces is replaced by its value', () => {
  assert.equal(substitute('https://{{host}}/x', { host: 'staging.example' }).text, 'https://staging.example/x');
});

test('whitespace inside the braces is allowed, because people type it', () => {
  assert.equal(substitute('{{ host }}', { host: 'a' }).text, 'a');
});

test('an unknown name is left standing and reported, never blanked', () => {
  // A URL that silently becomes `https:///users` is a request sent to the wrong
  // place. One that still reads `https://{{host}}/users` is a visible mistake.
  const out = substitute('https://{{host}}/users', {});
  assert.equal(out.text, 'https://{{host}}/users');
  assert.deepEqual(out.missing, ['host']);
});

test('a value that itself looks like a template is not expanded again', () => {
  // `{{a}}` = `{{a}}` would otherwise never terminate, and a value pasted out of
  // a response body would start being interpreted as a template.
  assert.equal(substitute('{{a}}', { a: '{{a}}' }).text, '{{a}}');
  assert.equal(substitute('{{a}}', { a: '{{b}}', b: 'deep' }).text, '{{b}}');
});

test('an empty value is an empty string, not the name left behind', () => {
  assert.equal(substitute('x{{a}}y', { a: '' }).text, 'xy');
});

test('a whole request is substituted, and every missing name named once', () => {
  const out = substituteRequest(
    {
      method: 'POST',
      url: 'https://{{host}}/a/{{id}}',
      headers: [{ name: 'X-{{who}}', value: '{{token}}' }],
      body: '{"id":"{{id}}"}',
    },
    { host: 'h', id: '7' }
  );
  assert.equal(out.url, 'https://h/a/7');
  assert.equal(out.body, '{"id":"7"}');
  assert.deepEqual(out.missing.sort(), ['token', 'who']);
});

console.log('\napi — the pre-request sandbox');

test('set defines a variable, and later lines can use it', () => {
  const out = runPreScript('set host = staging.example\nset base = https://{{host}}');
  assert.deepEqual(out.errors, []);
  assert.equal(out.vars.base, 'https://staging.example');
});

test('header adds a header without touching the variables', () => {
  const out = runPreScript('set t = abc\nheader Authorization: Bearer {{t}}');
  assert.deepEqual(out.headers, [{ name: 'Authorization', value: 'Bearer abc' }]);
});

test('uuid, now and random produce values of the right shape', () => {
  const out = runPreScript('uuid a\nnow b iso\nnow c ms\nrandom d 5 5', { clock: () => 1_700_000_000_000 });
  assert.deepEqual(out.errors, []);
  assert.match(out.vars.a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(out.vars.b, '2023-11-14T22:13:20.000Z');
  assert.equal(out.vars.c, '1700000000000');
  assert.equal(out.vars.d, '5');
});

test('base64 encodes Arabic, which btoa alone cannot', () => {
  // `btoa` is per character and throws above U+00FF. A tester's own name is the
  // ordinary case here, so the encoder goes through UTF-8 first.
  const out = runPreScript('base64 a = ليلى');
  assert.deepEqual(out.errors, []);
  assert.equal(Buffer.from(out.vars.a, 'base64').toString('utf8'), 'ليلى');
});

test('a comment and a blank line do nothing at all', () => {
  const out = runPreScript('# just a note\n\nset a = 1');
  assert.deepEqual(out.errors, []);
  assert.deepEqual(Object.keys(out.vars), ['a']);
});

console.log('\napi — what the sandbox refuses');

test('JavaScript is not a script here, and says so by line', () => {
  const out = runPreScript("const x = 1;\nfetch('https://evil.example')");
  assert.equal(out.errors.length, 2);
  assert.equal(out.errors[0].line, 1);
  assert.match(out.errors[0].message, /not one of the commands/);
});

test('there is no verb that reaches a global, a fetch or the DOM', () => {
  for (const line of [
    'eval alert(1)',
    'require fs',
    'import x from "y"',
    'chrome.tabs.query({})',
    'fetch https://evil.example',
    'document.cookie',
    'globalThis.x = 1',
    'while (true) {}',
  ]) {
    const out = runPreScript(line);
    assert.equal(out.errors.length, 1, `"${line}" was not refused`);
    assert.match(out.errors[0].message, /not one of the commands/);
  }
});

test('one bad line does not stop the good ones', () => {
  // A script that stops at the first mistake makes the tester find them one at
  // a time, which on a four-line script is three more round trips than needed.
  const out = runPreScript('set a = 1\nnonsense\nset b = 2');
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].line, 2);
  assert.equal(out.vars.a, '1');
  assert.equal(out.vars.b, '2');
});

test('a script longer than the cap is refused whole, not run half way', () => {
  const out = runPreScript(Array.from({ length: MAX_SCRIPT_LINES + 1 }, (_, i) => `set a${i} = 1`).join('\n'));
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].message, new RegExp(String(MAX_SCRIPT_LINES)));
  // Nothing ran: the refusal is about the script, not about a line in it.
  assert.deepEqual(Object.keys(out.vars), []);
});

test('a value cannot grow past the cap, so a script cannot build a payload', () => {
  const out = runPreScript(`set a = ${'x'.repeat(MAX_VALUE_LENGTH + 1)}`);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].message, /at most/);
  assert.equal(out.vars.a, undefined);
});

test('the variables it is given are not mutated in place', () => {
  // The panel keeps the environment; a script that could edit it would change
  // what the *next* request sends, invisibly.
  const env = { a: '1' };
  const out = runPreScript('set a = 2', { vars: env });
  assert.equal(env.a, '1');
  assert.equal(out.vars.a, '2');
});

console.log('\napi — importing a Postman collection');

const COLLECTION = {
  info: { name: 'Session', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'https://staging.example' }],
  item: [
    {
      name: 'Applications',
      item: [
        {
          name: 'POST /applications',
          request: {
            method: 'POST',
            header: [
              { key: 'Content-Type', value: 'application/json' },
              { key: 'X-Off', value: 'no', disabled: true },
            ],
            url: { raw: '{{baseUrl}}/applications', protocol: 'https', host: ['staging', 'example'], path: ['applications'] },
            body: { mode: 'raw', raw: '{"a":1}' },
          },
        },
      ],
    },
    { name: 'A folder with nothing in it', item: [] },
  ],
};

test('requests are found at whatever depth they sit', () => {
  const out = parseCollection(COLLECTION);
  assert.equal(out.name, 'Session');
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].method, 'POST');
  assert.equal(out.requests[0].url, '{{baseUrl}}/applications');
  assert.equal(out.requests[0].name, 'Applications / POST /applications');
});

test('a disabled header is not imported as an enabled one', () => {
  const out = parseCollection(COLLECTION);
  assert.deepEqual(out.requests[0].headers, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('the collection variables come across as environment variables', () => {
  assert.deepEqual(parseCollection(COLLECTION).variables, { baseUrl: 'https://staging.example' });
});

test('a URL given as parts rather than raw is still readable', () => {
  const out = parseCollection({
    info: { name: 'x' },
    item: [{ name: 'g', request: { method: 'GET', url: { protocol: 'https', host: ['a', 'b'], path: ['c', 'd'] } } }],
  });
  assert.equal(out.requests[0].url, 'https://a.b/c/d');
});

test('a collection read from text is the same as one read from an object', () => {
  assert.deepEqual(parseCollection(JSON.stringify(COLLECTION)), parseCollection(COLLECTION));
});

console.log('\napi page — accessibility wiring (r2-08-1, r2-08-2), read from the source');

const apiJs = fs.readFileSync(new URL('../api/api.js', import.meta.url), 'utf8');
const apiHtml = fs.readFileSync(new URL('../api/api.html', import.meta.url), 'utf8');
const fnBody = (name) => {
  const at = apiJs.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  const next = apiJs.indexOf('\nfunction ', at + 10);
  const nextAsync = apiJs.indexOf('\nasync function ', at + 10);
  return apiJs.slice(at, Math.min(...[next, nextAsync, apiJs.length].filter((n) => n > at)));
};

test('r2-08-1 the two textareas are named by their headings', () => {
  for (const [id, head] of [['body', 'body-head'], ['prescript', 'before-head']]) {
    assert.match(apiHtml, new RegExp(`<textarea id="${id}"[^>]*aria-labelledby="${head}"`), `${id} points at ${head}`);
    assert.match(apiHtml, new RegExp(`<h3[^>]*id="${head}"`), `${head} exists`);
  }
});

test('r2-08-1 every dynamic row input and Remove button has an accessible name', () => {
  for (const row of ['varRow', 'headerRow']) {
    const body = fnBody(row);
    assert.equal((body.match(/setAttribute\('aria-label'/g) || []).length, 2, `${row}: name and value inputs carry aria-label`);
    assert.match(body, /nameRemove\(drop, key\)/, `${row}: the Remove button is named after its row`);
  }
  assert.match(fnBody('nameRemove'), /t\('api\.removeNamed', \{ name:/, 'the Remove name carries the row name');
  assert.match(apiHtml, /id="env-name"[^>]*aria-label=/, 'the environment name input has a label, not only a placeholder');
});

test('r2-08-1 api.removeNamed exists as a pair with {name} on both sides', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(fs.readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  assert.match(en['api.removeNamed'], /\{name\}/);
  assert.match(ar['api.removeNamed'], /\{name\}/);
  assert.match(ar['api.removeNamed'], /[ء-ي]/, 'the Arabic side is Arabic');
});

test('r2-08-2 focus moves to Confirm when the preview opens and returns to Send after cancel or confirm', () => {
  assert.match(fnBody('drawPreview'), /\$\('confirm'\)\.focus\(\)/, 'preview focuses Confirm');
  assert.match(fnBody('reallySend'), /hidden = true;\s*\n\s*\$\('send'\)\.focus\(\)/, 'confirm: focus returns to Send as the card hides');
  assert.match(apiJs, /\$\('cancel'\)\.addEventListener\('click', \(\) => \{[^}]*\$\('send'\)\.focus\(\)/, 'cancel: focus returns to Send');
});

test('r2-08-2 the response summary and the script errors are announced', () => {
  assert.match(apiHtml, /id="res-summary"[^>]*role="status"|role="status"[^>]*id="res-summary"/, 'res-summary is a status');
  assert.match(apiHtml, /id="script-errors"[^>]*role="alert"|role="alert"[^>]*id="script-errors"/, 'script-errors is an alert');
});

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}
       ${err.message}`);
  }
}

await testAsync('r2-10-2 api-send and sandbox failure messages go through t() with en/ar pairs and keep English without a page translator', async () => {
  const dir = new URL('../', import.meta.url);
  const sendSrc = fs.readFileSync(new URL('core/api-send.js', dir), 'utf8');
  const sandboxSrc = fs.readFileSync(new URL('api/sandbox.js', dir), 'utf8');
  const en = JSON.parse(fs.readFileSync(new URL('platform/i18n/en.json', dir), 'utf8'));
  const ar = JSON.parse(fs.readFileSync(new URL('platform/i18n/ar.json', dir), 'utf8'));
  const keys = [...(sendSrc + sandboxSrc).matchAll(/\bt\('(api\.err\.[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(new Set(keys).size >= 10, 'ten message keys are in use: ' + keys.length);
  for (const k of new Set(keys)) {
    assert.ok(en[k] && ar[k], k + ' exists in en and ar');
    const ph = (s) => (s.match(/\{(?!\{)\w+\}(?!\})/g) || []).sort().join();
    assert.equal(ph(en[k]), ph(ar[k]), k + ': same placeholders in both languages');
  }
  assert.ok(!/throw new Error\(`/.test(sendSrc), 'no template-literal English thrown from api-send.js');
  assert.ok(!/throw new Error\(`/.test(sandboxSrc), 'no template-literal English thrown from sandbox.js');
  const { sendApiRequest } = await import('../core/api-send.js');
  await assert.rejects(() => sendApiRequest({ url: 'not a url' }), /is not a URL/);
  // with a translator present the Arabic comes out
  globalThis.QAWi18n = { t: (k, v) => (ar[k] || k).replace(/\{(\w+)\}/g, (w, n) => (v && n in v ? v[n] : w)) };
  try {
    await assert.rejects(() => sendApiRequest({ url: 'ftp://x.test' }), /http وhttps/);
    assert.match(runPreScript('bogus').errors[0].message, /[ء-ي]/, 'script errors come out in Arabic');
  } finally {
    delete globalThis.QAWi18n;
  }
});

await testAsync('r4-02-2: a host the managed policy refuses is refused before fetch, in the page language; an allowed one goes through', async () => {
  const { sendApiRequest } = await import('../core/api-send.js');
  const { normalisePolicy, allows } = await import('../platform/policy.js');
  const gateOf = (p) => async (url) => allows(p, 'integrations', url);
  const en = JSON.parse(fs.readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(fs.readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  assert.ok(en['api.err.policy'] && ar['api.err.policy'] && en['api.err.policy'] !== ar['api.err.policy'], 'api.err.policy is an en/ar pair');
  assert.match(fs.readFileSync(new URL('../api/api.js', import.meta.url), 'utf8'), /sendApiRequest\(\{ \.\.\.request, gate: async \(url\) => allows\(org, 'integrations', url\), guardRedirects: Boolean\(org\.integrationHosts\?\.length\) \}\)/, 'api.js must hand the managed policy to the sender as its gate');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('ok', { status: 200 }); };
  try {
    const off = normalisePolicy({ integrationsAllowed: false });
    await assert.rejects(() => sendApiRequest({ url: 'https://staging.example/a', gate: gateOf(off) }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'integrationsAllowed' && /Turned off by your organisation/.test(e.message));
    const hosts = normalisePolicy({ integrationHosts: ['jira.corp.example'] });
    await assert.rejects(() => sendApiRequest({ url: 'https://evil.example/a', gate: gateOf(hosts) }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'integrationHosts');
    assert.equal(calls, 0, 'fetch must not be called for a refused host');
    globalThis.QAWi18n = { t: (k, v) => (ar[k] || k).replace(/\{(\w+)\}/g, (w, n) => (v && n in v ? v[n] : w)) };
    try {
      await assert.rejects(() => sendApiRequest({ url: 'https://evil.example/a', gate: gateOf(hosts) }), /من جهة عملك/);
    } finally { delete globalThis.QAWi18n; }
    assert.equal(calls, 0);
    const r = await sendApiRequest({ url: 'https://api.jira.corp.example/a', gate: gateOf(hosts) });
    assert.equal(r.status, 200); assert.equal(calls, 1, 'an allowed host is sent');
    await sendApiRequest({ url: 'https://anything.example/a', gate: gateOf(normalisePolicy({})) });
    await sendApiRequest({ url: 'https://anything.example/b' });
    assert.equal(calls, 3, 'no policy, or a default one, restricts nothing');
  } finally { globalThis.fetch = realFetch; }
});

await testAsync('r5-03-1: under a policy gate a redirect is not followed; a followed one to a blocked host throws with no body; no gate is unchanged', async () => {
  const { sendApiRequest } = await import('../core/api-send.js');
  const { normalisePolicy, allows } = await import('../platform/policy.js');
  const en = JSON.parse(fs.readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(fs.readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  assert.ok(en['api.err.redirect'] && ar['api.err.redirect'] && en['api.err.redirect'] !== ar['api.err.redirect'], 'api.err.redirect is an en/ar pair');
  const hosts = normalisePolicy({ integrationHosts: ['jira.corp.example'] });
  const gate = async (url) => allows(hosts, 'integrations', url);
  const realFetch = globalThis.fetch;
  const seen = [];
  const reply = (extra) => { const r = new Response('SECRET-BODY', { status: 200, headers: { 'x-leak': '1' } }); for (const [k, v] of Object.entries(extra)) Object.defineProperty(r, k, { value: v }); return r; };
  try {
    globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ type: 'opaqueredirect', status: 0 }); };
    await assert.rejects(() => sendApiRequest({ url: 'https://api.jira.corp.example/a', gate }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'redirect' && /redirect/i.test(e.message));
    assert.deepEqual(seen, ['manual'], 'one fetch, with redirect: manual');
    globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ redirected: true, url: 'https://evil.example/landed' }); };
    let thrown = null; let value = null;
    try { value = await sendApiRequest({ url: 'https://api.jira.corp.example/a', gate, guardRedirects: false }); } catch (e) { thrown = e; }
    assert.equal(value, null, 'no body or headers come back from a blocked landing host');
    assert.ok(thrown && thrown.code === 'POLICY_BLOCKED' && thrown.key === 'integrationHosts', 'the landing host is asked, and refused');
    assert.equal(seen.at(-1), 'follow', 'guardRedirects:false (no host list) keeps follow');
    seen.length = 0;
    globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ redirected: true, url: 'https://x.jira.corp.example/landed' }); };
    const ok = await sendApiRequest({ url: 'https://api.jira.corp.example/a', gate, guardRedirects: false });
    assert.equal(ok.redirected, true); assert.equal(ok.body, 'SECRET-BODY');
    seen.length = 0;
    globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ redirected: true, url: 'https://elsewhere.example/landed' }); };
    const free = await sendApiRequest({ url: 'https://anything.example/a' });
    assert.deepEqual(seen, ['follow'], 'no gate: redirects are followed as before');
    assert.equal(free.redirected, true);
  } finally { globalThis.fetch = realFetch; }
});

await testAsync('r4-02-3 (D-1010-72): a request with Authorization or X-API-Key does not follow a 302 (no policy needed, refused with api.err.redirect); a header-less GET still follows', async () => {
  const { sendApiRequest } = await import('../core/api-send.js');
  const realFetch = globalThis.fetch;
  const seen = [];
  const reply = (extra) => { const r = new Response('BODY', { status: 200 }); for (const [k, v] of Object.entries(extra)) Object.defineProperty(r, k, { value: v }); return r; };
  try {
    for (const name of ['Authorization', 'X-API-Key']) {
      seen.length = 0;
      globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ type: 'opaqueredirect', status: 0 }); };
      await assert.rejects(() => sendApiRequest({ url: 'https://api.example/a', headers: [{ name, value: 'Bearer SECRET' }] }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'redirect' && /redirect/i.test(e.message), name);
      assert.deepEqual(seen, ['manual'], `${name}: one fetch, redirect: manual`);
    }
    seen.length = 0;
    globalThis.fetch = async (u, init) => { seen.push(init.redirect); return reply({ redirected: true, url: 'https://other.example/landed' }); };
    const free = await sendApiRequest({ url: 'https://api.example/a', headers: [{ name: 'Accept', value: 'application/json' }] });
    assert.deepEqual(seen, ['follow'], 'a header-less (non-credential) request follows as before');
    assert.equal(free.redirected, true);
  } finally { globalThis.fetch = realFetch; }
});

await testAsync('r4-02-2 (D-1010-71): API variables are sealed through the vault; an older plaintext record migrates, and stays when the vault write fails', async () => {
  const { installIdbStub } = await import('./lib-idb-stub.mjs');
  installIdbStub();
  const local = {}; const session = {};
  const area = (bag) => ({ get: async (k) => ({ [k]: bag[k] }), set: async (o) => { if (area.fail && 'apiEnvironments' in o && bag === local) throw new Error('disk full'); Object.assign(bag, o); }, remove: async (k) => delete bag[k] });
  const keepChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: area(local), session: area(session) } };
  try {
    const { loadSealed, saveSealed } = await import('../platform/vault.js');
    const envs = { active: 'Default', list: { Default: { apiToken: 'TOKEN-IN-ENV-77' } } };
    local.apiEnvironments = structuredClone(envs);
    area.fail = true;
    assert.deepEqual(await loadSealed('apiEnvironments'), envs);
    area.fail = false;
    assert.deepEqual(local.apiEnvironments, envs, 'vault write failed: the plaintext stays');
    assert.deepEqual(await loadSealed('apiEnvironments'), envs);
    assert.equal(local.apiEnvironments.qws, 1, 'sealed on the next read');
    assert.ok(!JSON.stringify(local).includes('TOKEN-IN-ENV-77'));
    await saveSealed('apiEnvironments', { ...envs, active: 'Staging' });
    assert.equal((await loadSealed('apiEnvironments')).active, 'Staging');
  } finally { globalThis.chrome = keepChrome; }
  const src = fs.readFileSync(new URL('../api/api.js', import.meta.url), 'utf8');
  assert.match(src, /const STORE = 'apiEnvironments';/);
  assert.match(src, /loadSealed\(STORE\)/); assert.match(src, /saveSealed\(STORE, envs\)/);
  assert.doesNotMatch(src, /chrome\.storage\.local\.(get|set)\(STORE/, 'the plaintext path is gone');
  assert.match(src, /SECRET_VAR\.test\(key\.value\)/);
  assert.match(src, /'password'/);
  const en = JSON.parse(fs.readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(fs.readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  for (const k of ['api.var.show', 'api.var.hide']) assert.ok(en[k] && ar[k] && en[k] !== ar[k], `${k} is an en/ar pair`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
