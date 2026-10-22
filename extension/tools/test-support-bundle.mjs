/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-063: the support bundle carries no origin, token or free text, shows the ring's last 30,
 * and the options page builds it without any network call.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBundle } from '../core/support-bundle.js';
import { workerSrc } from './lib-worker-src.mjs';

let passed = 0; const failures = [];
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); } };

const SECRETS = ['https://shop.acme-internal.com/orders?id=991', 'acme-internal.com', 'ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF', 'Bearer abcdefghijklmnopqrstuvwx1234', '4111 1111 1111 1111', 'my-private-charter', 'jira.corp.example.org'];
const x = {
  version: '3.3.0', build: 'QAW (v3.3.0)', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150', capabilities: { offscreen: true, debugger: true },
  originCount: 3,
  defaults: { redact: true, retentionDays: 30, jira: { host: '' }, saveFolderName: '', charterNote: '' },
  settings: { redact: false, retentionDays: 7, jira: { host: 'jira.corp.example.org' }, saveFolderName: 'my-private-charter', charterNote: 'acme-internal.com' },
  ring: [{ t: 1, name: 'action.onClicked', msg: `fetch ${SECRETS[0]} failed token ${SECRETS[2]} ${SECRETS[3]} card ${SECRETS[4]}` }],
};
const text = buildBundle(x);

test('no origin, token, card or free text from the corpus survives', () => {
  for (const s of SECRETS) assert.ok(!text.includes(s), `leaked: ${s}\n${text}`);
});
test('Next-review corpus: internal hosts with ports, bare IPs, API paths, mailboxes and ids are cut', () => {
  const hostile = ['jira.corp.internal:8080/browse/ABC-12', '10.20.30.40:443', '/api/v2/customers/48213', 'ali.hassan@acme', 'C:\\Users\\ali\\secret\\x.json', 'intranet.local', 'localhost:3000', 'fe80:0:0:0:a:b:c:d'];
  const bundle = buildBundle({ ring: hostile.map((h, i) => ({ t: i, name: 'h', msg: `failed at ${h}` })) });
  for (const bad of ['corp.internal', '8080', '10.20.30.40', 'customers', '48213', 'ali.hassan', 'acme', 'Users', 'secret', 'intranet', 'localhost', 'fe80']) assert.ok(!bundle.includes(bad), `leaked ${bad}
${bundle}`);
  assert.match(bundle, /chrome\.storage\.local|\[host\]/);
});
test('code identifiers a developer needs survive: chrome.runtime.sendMessage and file.js', () => {
  const b = buildBundle({ ring: [{ t: 1, name: 'x', msg: 'chrome.runtime.sendMessage failed in worker.js' }] });
  assert.match(b, /chrome\.runtime\.sendMessage failed in worker\.js/);
});
test('it still says what a support thread needs', () => {
  assert.match(text, /manifest: 3\.3\.0/);
  assert.match(text, /granted sites: 3/);
  assert.match(text, /redact: false/);
  assert.match(text, /retentionDays: 7/);
  assert.match(text, /jira: changed/);
  assert.match(text, /action\.onClicked/);
});
test('a thrown handler adds one ring line and only the last 30 are kept', () => {
  const ring = Array.from({ length: 50 }, (_, i) => ({ t: i * 1000, name: `h${i}`, msg: 'm' }));
  const lines = buildBundle({ ring }).split('last handler failures:\n')[1].split('\n');
  assert.equal(lines.length, 30);
  assert.ok(lines[29].includes('h49') && !lines.join().includes('h19'));
});
test('T-063: the bundle prints the last five worker start times and the tool-use count, and only numbers', () => {
  const t = buildBundle({ bootMs: [900, 810, 'https://shop.acme-internal.com/', 700, 650.4, 600, 550], toolUseTicks: 42 });
  assert.match(t, /worker start times \(ms, last 5\): 810, 700, 650, 600, 550/);
  assert.match(t, /tool uses on this machine: 42/);
  assert.ok(!t.includes('acme'));
  const empty = buildBundle({});
  assert.match(empty, /worker start times \(ms, last 5\): none yet/);
  assert.match(empty, /tool uses on this machine: 0/);
  assert.match(buildBundle({ toolUseTicks: 'x' }), /tool uses on this machine: 0/);
});
test('T-063: the worker writes both rows (boot time at the end of boot, a tick after a counted tool) and Reset clears them', () => {
  const sw = workerSrc();
  assert.match(sw, /keepLocal\('bootMs',[^\n]*performance\.now\(\)[^\n]*slice\(-5\)/);
  assert.match(sw, /if \(COUNTS_AS\[msg\.type\]\) \{[^\n]*keepLocal\('toolUseTicks'/);
  assert.match(sw, /const next = await resetSettings\(\);\n\s+await chrome\.storage\.local\.remove\(resetLocalKeys\(\)\)/);
});
test('options builds it from local reads only: no fetch, no XHR, no sendBeacon', () => {
  const s = fs.readFileSync(new URL('../options/options.js', import.meta.url), 'utf8');
  const block = s.slice(s.indexOf("$('bundle-open')"), s.indexOf("$('bundle-close')"));
  assert.ok(block.length > 300);
  assert.doesNotMatch(block, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.match(block, /showModal\(\)/);
});

// completion review 9: the popup's real paintMailLink (cut from popup.js, run with stubs) still shows its link when the log holds an emoji
// that the 160-character line cut splits. Before the fix encodeURIComponent threw on the lone surrogate and the link stayed hidden.
{
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const os = await import('node:os');
  const path = await import('node:path');
  const { RING_KEY } = await import('../core/on.js');
  const src = fs.readFileSync(new URL('../popup/popup.js', import.meta.url), 'utf8');
  const a = src.indexOf('const MAIL_MAX'), b = src.indexOf('/* T-019: accepting happens on the welcome tab', a);
  assert.ok(a > 0 && b > a, 'paintMailLink is not where this test cuts it');
  const base = pathToFileURL(path.resolve(fileURLToPath(import.meta.url), '..', '..')).href;
  const tmp = path.join(os.tmpdir(), `uqa-maillink-${process.pid}.mjs`);
  // brand/brand.json may leave the support mailbox empty (the link then stays hidden), so this test gives the popup a product module with an address.
  const stub = path.join(os.tmpdir(), `uqa-maillink-product-${process.pid}.mjs`);
  fs.writeFileSync(stub, "export const describe = () => ({ name: 'QA Wrap', version: '3.4.0', code: 'QAW-3.4.0', supportEmail: 'help@example.test' });\n");
  fs.writeFileSync(tmp, `const settings = {}; const $ = () => globalThis.__a;\n${src.slice(a, b).replaceAll("'../core/product.js'", `'${pathToFileURL(stub).href}'`).replaceAll("'../", `'${base}/`)}\nexport { paintMailLink };`);
  const { paintMailLink } = await import(pathToFileURL(tmp).href);
  const ring = Array.from({ length: 30 }, (_, i) => ({ t: i, name: 'Err', msg: 'a' + '\u{1F600}'.repeat(100) }));
  globalThis.chrome = {
    storage: { local: { get: async () => ({ [RING_KEY]: ring }) } }, permissions: { getAll: async () => ({ origins: [] }) },
    runtime: { getManifest: () => ({ version: '3.4.0' }) },
  };
  globalThis.__a = { hidden: true, href: '' };
  await paintMailLink();
  assert.equal(globalThis.__a.hidden, false, 'the link is hidden');
  assert.doesNotThrow(() => decodeURIComponent(globalThis.__a.href.split('body=')[1]), 'the body is well-formed');
  fs.rmSync(tmp, { force: true });
  passed++; console.log('  ok  T-063: the mail link survives an emoji split by the log cut');
}

// ui-1019: "breaks after a while" evidence. A deadline that fires leaves a masked row (stage, ms, uptime, live contexts) in the ring the bundle shows.
{
  const { withDeadline, noteSlow } = await import('../platform/deadline.js');
  const db = {};
  globalThis.chrome = {
    storage: { local: { get: async (k) => ({ [k]: db[k] }), set: async (o) => Object.assign(db, o) } },
    runtime: { getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }, { contextType: 'TAB' }, { contextType: 'TAB' }] },
  };
  await noteSlow('offscreen', 5000);
  const row = db.handlerRing?.[0];
  assert.equal(row?.name, 'deadline:offscreen');
  assert.match(row.msg, /^5000 ms, up \d+ s ctx OFFSCREEN_DOCUMENT:1,TAB:2$/);
  const text = buildBundle({ ring: db.handlerRing });
  assert.match(text, /deadline:offscreen: 5000 ms, up \d+ s ctx OFFSCREEN_DOCUMENT:1,TAB:2/);
  const warn = console.warn; console.warn = () => {};
  await withDeadline(new Promise(() => {}), 'tab', 5).catch(() => {});
  console.warn = warn;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(db.handlerRing.some((r) => r.name === 'deadline:tab'), 'a real withDeadline timeout writes its row');
  passed++; console.log('  ok  ui-1019: a deadline that fires leaves a ring row the support bundle shows');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
