/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R3: the profile and the fine-print trace line on every export.
 *
 *   node tools/test-profile.mjs
 *
 * Two halves. The pieces (name and picture cleaning, the trace line in both languages, where a format can carry it) are
 * tested directly. The wiring is tested through the real caller (rule R14): Settings stores the name, `loadProfile()` reads
 * it back through platform/profile-source.js, and `buildExport()` from background/export-build.js, run against a session in
 * a real (fake-indexeddb) database, must put the line into EVERY format its switch builds. The format list is read from the
 * switch's own source, so a format added later without a trace line fails here.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

/* a just-enough chrome: storage areas and the manifest version */
const bag = { sync: {}, local: {} };
const area = (b) => ({ get: async (k) => (k === null ? { ...b } : { [k]: b[k] }), set: async (o) => { Object.assign(b, o); }, remove: async (k) => { for (const x of [].concat(k)) delete b[x]; } });
globalThis.chrome = {
  storage: { sync: area(bag.sync), local: area(bag.local), session: area({}), managed: { get: async () => ({}) } },
  runtime: { getManifest: () => ({ version: '3.8.4' }), id: 'test' }, // no getURL: the document faces are read from disk under Node, and the lockup falls back to type
};
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });

const P = await import('../core/profile.js');
const { withTrace } = await import('../core/trace-export.js');
const { setSettings } = await import('../platform/settings.js');

const PIC = `data:image/png;base64,${Buffer.from('not really a png but a data url').toString('base64')}`;
const NOON = Date.UTC(2026, 10, 9, 12);
const day = P.dayOf(NOON);

await test('cleanName: one line, no control or bidi override characters, capped at 60', () => {
  assert.equal(P.cleanName('  Layla \u202E Haddad\n\t'), 'Layla Haddad');
  assert.equal(P.cleanName('A\u2066B\u2069C\u200F'), 'A B C');
  assert.equal(P.cleanName('x'.repeat(200)).length, P.NAME_MAX);
  assert.equal(P.cleanName(null), '');
});

await test('cleanPicture keeps a small image data URL and refuses scripts, other types and giants', () => {
  assert.equal(P.cleanPicture(PIC), PIC);
  assert.equal(P.cleanPicture('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(P.cleanPicture('https://example.com/a.png'), '');
  assert.equal(P.cleanPicture(`data:image/png;base64,${'A'.repeat(P.PICTURE_MAX)}`), '');
  assert.equal(P.cleanPicture('data:image/svg+xml;base64,PHN2Zz4='), '', 'svg can carry script');
});

await test('traceLine: name, date and tool version, in English', () => {
  assert.equal(P.traceLine({ lang: 'en', date: NOON, version: '3.8.4', name: 'Layla Haddad' }), `Prepared by Layla Haddad · ${day} · QA Wrap 3.8.4`);
});

await test('traceLine: Arabic words, with name, date and tool each in a bidi isolate; no vowel marks', () => {
  const line = P.traceLine({ lang: 'ar', date: NOON, version: '3.8.4', name: 'ليلى حداد' });
  assert.match(line, /^إعداد: \u2068ليلى حداد\u2069 · \u2068\d{4}-\d{2}-\d{2}\u2069 · \u2068QA Wrap 3\.8\.4\u2069$/);
  assert.equal(/[ً-ْ]/.test(line), false, 'a visible tashkeel');
});

await test('traceLine: no name set drops the name, never invents one; either language', () => {
  assert.equal(P.traceLine({ lang: 'en', date: NOON, version: '3.8.4', name: '' }), `Prepared with QA Wrap 3.8.4 · ${day}`);
  assert.match(P.traceLine({ lang: 'ar', date: NOON, version: '3.8.4', name: '' }), /^تم الإعداد بواسطة /);
});

await test('traceLine: a hostile name cannot add a line or flip the line', () => {
  const line = P.traceLine({ lang: 'en', date: NOON, version: '1', name: 'Eve\n# injected\u202E' });
  assert.equal(line.includes('\n'), false);
  assert.equal(line.includes('\u202E'), false);
});

await test('loadProfile reads the name and picture Settings stored, through the real source (platform/profile-source.js)', async () => {
  await setSettings({ testerName: '  Layla Haddad ', profilePicture: PIC });
  const p = await P.loadProfile();
  assert.deepEqual(p, { name: 'Layla Haddad', picture: PIC, named: true });
  assert.equal(bag.local.settingsLocal.profilePicture, PIC, 'the picture is stored on this machine only (settingsLocal), never in sync');
  assert.equal(JSON.stringify(bag.sync).includes('base64'), false);
});

await test('loadProfile never throws: a source that fails keeps the last good profile', async () => {
  P.setProfileSource(async () => { throw new Error('storage down'); });
  assert.equal((await P.loadProfile()).name, 'Layla Haddad');
  P.setProfileSource(null);
});

await test('withTrace per format: md, txt, html, json, har, csv, yaml, ts, xml, svg; binary and unknown are left alone', () => {
  const L = 'Prepared by A · 2026-11-09 · QA Wrap 3.8.4';
  assert.ok(withTrace({ filename: 'a.md', content: '# x\n' }, L).content.endsWith(`\n\n${L}\n`));
  assert.ok(withTrace({ filename: 'a.txt', content: 'x' }, L).content.endsWith(`${L}\n`));
  assert.match(withTrace({ filename: 'a.html', content: '<html><body><p>x</p></body></html>' }, L).content, /<p class="qaw-trace"[^>]*>Prepared by A[^<]*<\/p>\n<\/body>/);
  assert.equal(JSON.parse(withTrace({ filename: 'a.json', content: '{"a":1}' }, L).content)._trace, L);
  assert.equal(JSON.parse(withTrace({ filename: 'a.har', content: '{"log":{"version":"1.2"}}' }, L).content).log.comment, L);
  assert.ok(withTrace({ filename: 'a.csv', content: 'a,b\n1,2\n' }, L).content.endsWith(`# ${L}\n`));
  assert.ok(withTrace({ filename: 'a.yaml', content: 'a: 1\n' }, L).content.endsWith(`# ${L}\n`));
  assert.ok(withTrace({ filename: 'a.spec.ts', content: 'test()\n' }, L).content.endsWith(`// ${L}\n`));
  assert.ok(withTrace({ filename: 'a.xml', content: '<r/>' }, L).content.endsWith(`<!-- ${L} -->\n`));
  assert.ok(withTrace({ filename: 'a.svg', content: '<svg/>' }, L).content.endsWith(' -->\n'));
  assert.ok(withTrace({ filename: 'a.xml', content: '<r/>' }, 'a -- b').content.includes('a - - b'), 'a double hyphen cannot end an XML comment early');
  const bin = { filename: 'a.xlsx', content: 'AAAA', encoding: 'base64' };
  assert.equal(withTrace(bin, L), bin);
  const odd = { filename: 'a.bin', content: 'x' };
  assert.equal(withTrace(odd, L), odd);
  assert.equal(withTrace({ filename: 'a.json', content: 'not json' }, L).content, 'not json');
});

/* ── through the real caller ─────────────────────────────────────────────── */

const { putSession, appendEvents } = await import('../core/db.js');
const { loadDocFonts } = await import('../core/docshell.js');
await loadDocFonts(); // the HTML documents refuse to build without the faces (the offscreen door primes them the same way)
const { buildExport } = await import('../background/export-build.js');
const { readZipBuffer } = await import('./lib-zip.mjs');

const T = 1_800_000_000_000;
const SID = 'qaw-profile-test';
await putSession({ id: SID, charter: 'Checkout flow', startedAt: T, endedAt: T + 60_000, startUrl: 'https://shop.example.test/', status: 'stopped', env: { language: 'en', viewport: '1280x720', platform: 'Win32', userAgent: 'test' } });
await appendEvents([
  { sessionId: SID, kind: 'nav', ts: T + 100, url: 'https://shop.example.test/cart' },
  { sessionId: SID, kind: 'dom', ts: T + 900, action: 'click', label: 'Pay now', tag: 'button', locator: "getByRole('button', { name: 'Pay now' })" },
  { sessionId: SID, kind: 'net', ts: T + 1200, method: 'POST', url: 'https://shop.example.test/api/pay', status: 500, durationMs: 120 },
  { sessionId: SID, kind: 'console', ts: T + 1300, level: 'error', text: 'Payment failed' },
  { sessionId: SID, kind: 'note', ts: T + 2000, tag: 'bug', text: 'Pay now returns a 500' },
  { sessionId: SID, kind: 'links', ts: T + 3000, total: 5, checked: 5, broken: [], redirected: [], slow: [] },
  { sessionId: SID, kind: 'harvest', ts: T + 4000, url: 'https://shop.example.test/checkout', title: 'Checkout', dir: 'ltr', elements: [{ n: 0, kind: 'field', label: 'Name', required: true, tag: 'input', type: 'text', key: 'name', playwright: "page.getByLabel('Name')", unique: true, matches: 1 }, { n: 1, kind: 'button', name: 'Submit', tag: 'button', key: 'submit', playwright: "page.getByRole('button', { name: 'Submit' })", unique: true, matches: 1 }], forms: [{ n: 0, name: 'Form', fields: [0], submit: 1 }] },
  { sessionId: SID, kind: 'a11y', ts: T + 5000, total: 1, byImpact: { serious: 1 }, violations: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', nodes: [{ target: ['button'], html: '<button>' }] }] },
  { sessionId: SID, kind: 'fineprint', ts: T + 6000, markdown: '# Fine print\n\nnothing\n' },
]);

const src = fs.readFileSync(path.join(EXT, 'background/export-build.js'), 'utf8');
const SWITCH = [...new Set([...src.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map((m) => m[1]))];
const text = (out) => (out.encoding === 'base64' ? Buffer.from(out.content, 'base64').toString('utf8') : out.content);
const NAME = 'Layla Haddad';

/** An xlsx is a zip of XML; the trace line is a cell, so it is looked up in the unzipped sheets. */
function xlsxText(out) {
  const { entries } = readZipBuffer(Buffer.from(out.content, 'base64'));
  return [...entries].filter(([name]) => /\.xml$/.test(name)).map(([, e]) => e.data().toString('utf8')).join('\n');
}

await test('the switch has formats to check (so an empty list cannot pass)', () => {
  assert.ok(SWITCH.length > 30, `only ${SWITCH.length} formats found in export-build.js`);
  assert.ok(SWITCH.includes('timeline-md') && SWITCH.includes('markdown') && SWITCH.includes('html'));
});

const GAP = { bundle: 'a zip whose documents are checked in the next test' };
for (const format of SWITCH) {
  if (GAP[format]) continue;
  await test(`${format}: the export carries "Prepared by ${NAME} · date · QA Wrap 3.8.4"`, async () => {
    let out;
    try { out = await buildExport({ sessionId: SID, format, version: '3.8.4' }); } catch (e) {
      if (/No (page map|link check|accessibility scan|fine-print check)/.test(e.message)) return; // a session without that tool run has nothing to export
      throw e;
    }
    const body = format.endsWith('xlsx') ? xlsxText(out) : text(out);
    assert.ok(body.includes(`Prepared by ${NAME} · `) && body.includes('QA Wrap 3.8.4'), `no trace line in ${out.filename}`);
  });
}

await test('a bundle (zip): every document inside carries the trace line', async () => {
  const out = await buildExport({ sessionId: SID, format: 'bundle', parts: ['markdown', 'github'], version: '3.8.4' });
  const { entries } = readZipBuffer(Buffer.from(out.content, 'base64'));
  const docs = [...entries].filter(([name]) => /\.(md|json)$/.test(name) && !name.startsWith('Screenshots/'));
  assert.ok(docs.length >= 3, `${docs.length} documents in the zip (markdown, github issue, session json)`);
  for (const [name, e] of docs) assert.ok(e.data().toString('utf8').includes(`Prepared by ${NAME}`), `${name} has no trace line`);
});

await test('the Arabic session gets the Arabic line (language follows the session)', async () => {
  await putSession({ id: 'qaw-ar', charter: 'اختبار الدفع', startedAt: T, endedAt: T + 1000, status: 'stopped', env: { language: 'ar' } });
  const out = await buildExport({ sessionId: 'qaw-ar', format: 'markdown', version: '3.8.4' });
  assert.ok(out.content.includes(`إعداد: \u2068${NAME}\u2069`), 'Arabic line missing');
});

await test('the line is added after the secret scan, so a name that looks like a secret is not redacted from it', async () => {
  await setSettings({ testerName: 'Layla Haddad' });
  const out = await buildExport({ sessionId: SID, format: 'text', version: '3.8.4' });
  assert.ok(text(out).trimEnd().endsWith('QA Wrap 3.8.4'));
});

await test('the offscreen path: the worker sends the profile with the request and the build never touches chrome.storage (the offscreen document has none)', async () => {
  const media = fs.readFileSync(path.join(EXT, 'background/media.js'), 'utf8');
  assert.match(media, /profile: { name: s.testerName, picture: s.profilePicture }/, 'exportOp must send the profile');
  const real = globalThis.chrome;
  globalThis.chrome = { runtime: real.runtime }; // what an offscreen document has
  try {
    const out = await buildExport({ sessionId: SID, format: 'markdown', version: '3.8.4', profile: { name: 'Omar Saleh', picture: '' } });
    assert.ok(out.content.includes('Prepared by Omar Saleh · '), 'the name the worker sent is used');
    const card = await buildExport({ sessionId: SID, format: 'session-manifest', version: '3.8.4', profile: { name: 'Omar Saleh' } });
    assert.equal(JSON.parse(card.content).tester, 'Omar Saleh', 'the session card names the same person');
  } finally { globalThis.chrome = real; }
});

await test('with no name set the export still says when and with what, and never an invented name', async () => {
  await setSettings({ testerName: '' });
  const out = await buildExport({ sessionId: SID, format: 'markdown', version: '3.8.4' });
  assert.ok(out.content.includes('Prepared with QA Wrap 3.8.4 · '));
  await setSettings({ testerName: NAME });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
