/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R5: the sealed timeline and Verify file.
 *
 *   node tools/test-seal.mjs
 *
 * The seal is tamper-evidence, so the suite is built around the one way it can fail silently: a verifier that says
 * "intact" to a file that was changed. Rule R15 (a green gate must prove it looked): the first test hands the verifier a file
 * known to be altered and requires "altered"; only after that do the untouched cases count. Then every single-character
 * edit of the text and of every seal field is tried, and each must be refused. The honest limit is tested too: a file edited
 * and sealed again with someone else's key verifies as intact but with a different fingerprint, and Verify says so.
 * The wiring goes through the real caller (R14): background/export-build.js builds, seals and Verify reads the saved bytes.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 8).join('\n       ')}`); }
}

const bag = { sync: {}, local: {} };
const area = (b) => ({ get: async (k) => (k === null ? { ...b } : { [k]: b[k] }), set: async (o) => { Object.assign(b, o); }, remove: async (k) => { for (const x of [].concat(k)) delete b[x]; } });
globalThis.chrome = { storage: { sync: area(bag.sync), local: area(bag.local), session: area({}), managed: { get: async () => ({}) } }, runtime: { getManifest: () => ({ version: '3.8.4' }), id: 'test' } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });

const { generateSealKey, sealMarkdown, verifyMarkdown, fingerprintOf, shortFingerprint, normaliseBody } = await import('../core/seal.js');

const BODY = '# Timeline: Checkout\n\n## Profile\n\n- Name: Layla Haddad\n\n| # | When | Kind | What happened |\n|---|---|---|---|\n| 1 | +0.10s | Navigation | Opened https://shop.example.test/cart |\n| 2 | +0.90s | Action | Clicked Pay now |\n\nPrepared by Layla Haddad · 2026-11-09 · QA Wrap 3.8.4\n';
const key = await generateSealKey();
const fp = await fingerprintOf(key.publicJwk);
const other = await generateSealKey();
const sealed = await sealMarkdown(BODY, { key, name: 'Layla Haddad', version: '3.8.4', when: Date.UTC(2026, 10, 9, 12) });
const flip = (s, at) => s.slice(0, at) + (s[at] === 'x' ? 'y' : 'x') + s.slice(at + 1);

/* R15: one known-altered sample must fail before anything counts as green. */
await test('R15 first: a file with ONE character changed is reported altered (the verifier can see a change at all)', async () => {
  const known = flip(sealed, sealed.indexOf('Pay now') + 1);
  const v = await verifyMarkdown(known, { ownFingerprint: fp });
  assert.equal(v.status, 'altered');
  assert.deepEqual(v.reasons, ['text-changed']);
});

await test('an untouched sealed file is intact, names the signer, the date and the tool, and says the key is this install\'s', async () => {
  const v = await verifyMarkdown(sealed, { ownFingerprint: fp });
  assert.equal(v.status, 'intact');
  assert.deepEqual(v.reasons, []);
  assert.equal(v.signer, 'Layla Haddad');
  assert.equal(v.date, '2026-11-09T12:00:00.000Z');
  assert.equal(v.tool, 'QA Wrap 3.8.4');
  assert.equal(v.fingerprint, fp);
  assert.equal(v.sameInstall, true);
  assert.equal(shortFingerprint(fp).length, 19);
});

await test('the text stays readable above the seal; the seal block is a plain fenced block', () => {
  assert.ok(sealed.startsWith(BODY), 'the document is unchanged above the seal');
  assert.match(sealed, /\n<!-- qaw-seal -->\n## Seal · الختم\n/);
  assert.match(sealed, /```text\nQA-WRAP-SEAL v1\nSigned by: Layla Haddad\n/);
});

await test('another install\'s key: same file is intact, sameInstall is false; with no own key sameInstall is null', async () => {
  assert.equal((await verifyMarkdown(sealed, { ownFingerprint: await fingerprintOf(other.publicJwk) })).sameInstall, false);
  assert.equal((await verifyMarkdown(sealed)).sameInstall, null);
});

await test('every single-character edit of the readable text is detected (all positions)', async () => {
  const end = sealed.indexOf('<!-- qaw-seal -->');
  let checked = 0;
  for (let i = 0; i < end; i++) {
    if (sealed[i] === '\r') continue;
    const v = await verifyMarkdown(flip(sealed, i), { ownFingerprint: fp });
    assert.notEqual(v.status, 'intact', `an edit at ${i} (${JSON.stringify(sealed[i])}) went unnoticed`);
    checked++;
  }
  assert.ok(checked > 250, `only ${checked} positions tried`);
});

await test('every single-character edit of every seal field is detected (name, date, tool, hash, fingerprint, key, signature)', async () => {
  const start = sealed.indexOf('```text\n');
  const fields = ['Signed by: ', 'Date: ', 'Tool: ', 'Body SHA-256: ', 'Key fingerprint: ', 'Public key: ', 'Signature: '];
  for (const f of fields) {
    const at = sealed.indexOf(f, start) + f.length;
    const len = sealed.indexOf('\n', at) - at;
    for (let k = 0; k < len; k++) {
      const v = await verifyMarkdown(flip(sealed, at + k), { ownFingerprint: fp });
      assert.notEqual(v.status, 'intact', `an edit of "${f}" at +${k} went unnoticed`);
    }
  }
});

await test('removing the seal says unsealed; text after it, text before it, a cut seal and a swapped heading are all refused', async () => {
  assert.equal((await verifyMarkdown(BODY)).status, 'unsealed');
  assert.equal((await verifyMarkdown(sealed.slice(0, sealed.indexOf('<!-- qaw-seal -->')))).status, 'unsealed');
  assert.deepEqual((await verifyMarkdown(`${sealed}\nA line added at the end.\n`)).reasons, ['after-seal']);
  assert.notEqual((await verifyMarkdown(`Extra line.\n${sealed}`)).status, 'intact');
  assert.notEqual((await verifyMarkdown(sealed.slice(0, -40))).status, 'intact');
  assert.notEqual((await verifyMarkdown(sealed.replace('## Seal · الختم', '## Seal'))).status, 'intact', 'the seal section itself is covered');
  assert.notEqual((await verifyMarkdown(sealed.replace('Tamper-evidence, not secrecy', 'Proof of identity'))).status, 'intact', 'the honest note cannot be rewritten');
});

await test('an editor that saves with CRLF line endings, or a BOM, does not make an untouched file "altered"', async () => {
  assert.equal((await verifyMarkdown(sealed.replace(/\n/g, '\r\n'))).status, 'intact');
  assert.equal((await verifyMarkdown(`\uFEFF${sealed}`)).status, 'intact');
  assert.equal(normaliseBody('a\r\nb  \n\n'), 'a\nb\n');
});

await test('the honest limit: edited and sealed again with another key, the file verifies as intact but with a different fingerprint, which Verify reports', async () => {
  const forged = await sealMarkdown(BODY.replace('Pay now', 'Cancel'), { key: other, name: 'Layla Haddad', version: '3.8.4', when: Date.UTC(2026, 10, 9, 12) });
  const v = await verifyMarkdown(forged, { ownFingerprint: fp });
  assert.equal(v.status, 'intact');
  assert.notEqual(v.fingerprint, fp);
  assert.equal(v.sameInstall, false);
});

await test('a seal whose stated fingerprint belongs to a different key is refused (fingerprint cannot be swapped for the signer\'s)', async () => {
  const otherFp = await fingerprintOf(other.publicJwk);
  const v = await verifyMarkdown(sealed.replace(fp, otherFp), { ownFingerprint: fp });
  assert.equal(v.status, 'altered');
});

await test('an empty or odd input is "unsealed", never a crash or an intact', async () => {
  for (const x of ['', null, undefined, '```text\nQA-WRAP-SEAL v1\n```']) assert.notEqual((await verifyMarkdown(x)).status, 'intact');
});

/* ── the key ─────────────────────────────────────────────────────────────── */

const SK = await import('../platform/seal-key.js');

await test('the install key: nothing is made until something is sealed; then one key, never extractable', async () => {
  assert.equal(await SK.getSealKey({ mint: false }), null);
  assert.equal(await SK.ownFingerprint(), '');
  const a = await SK.getSealKey();
  const b = await SK.getSealKey();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', a.privateKey), 'the private key must not be exportable');
  assert.equal(await SK.ownFingerprint(), a.fingerprint);
  assert.equal(a.publicJwk.d, undefined, 'no private member in the stored public JWK');
});

/* ── through the real caller ─────────────────────────────────────────────── */

const { setSettings } = await import('../platform/settings.js');
const { putSession, appendEvents } = await import('../core/db.js');
const { buildExport } = await import('../background/export-build.js');
const PIC = `data:image/png;base64,${Buffer.from('tiny picture').toString('base64')}`;
await setSettings({ testerName: 'Layla Haddad', profilePicture: PIC });

const T = 1_800_000_000_000;
const events = [
  { kind: 'nav', ts: T + 100, url: 'https://shop.example.test/cart' },
  { kind: 'dom', ts: T + 900, action: 'click', label: 'Pay now | now', tag: 'button' },
  { kind: 'net', ts: T + 1200, method: 'POST', url: 'https://shop.example.test/api/pay', status: 500, durationMs: 120 },
  { kind: 'console', ts: T + 1300, level: 'error', text: 'Payment failed' },
  { kind: 'note', ts: T + 2000, tag: 'bug', text: 'Pay now returns a 500\n# not a heading' },
];
await putSession({ id: 'qaw-seal-en', charter: 'Checkout', startedAt: T, endedAt: T + 60_000, startUrl: 'https://shop.example.test/', status: 'stopped', env: { language: 'en' } });
await appendEvents(events.map((e) => ({ ...e, sessionId: 'qaw-seal-en' })));
await putSession({ id: 'qaw-seal-ar', charter: 'اختبار الدفع', startedAt: T, endedAt: T + 60_000, status: 'stopped', env: { language: 'ar' } });
await appendEvents(events.map((e) => ({ ...e, sessionId: 'qaw-seal-ar' })));

await test('timeline-md through buildExport: the whole timeline, the profile and picture, the trace line, then the seal; Verify says intact', async () => {
  const out = await buildExport({ sessionId: 'qaw-seal-en', format: 'timeline-md', version: '3.8.4' });
  assert.match(out.filename, /^qaw-timeline-.*\.md$/);
  assert.equal(out.mime, 'text/markdown');
  const c = out.content;
  assert.match(c, /- Name: Layla Haddad/);
  assert.ok(c.includes('![Layla Haddad][qaw-profile-picture]') && c.includes(`[qaw-profile-picture]: ${PIC}`), 'the picture is embedded');
  for (const needle of ['Opened https://shop.example.test/cart', 'Clicked Pay now', 'POST https://shop.example.test/api/pay', 'console.error: Payment failed', '| 5 |']) assert.ok(c.includes(needle), `row missing: ${needle}`);
  assert.equal((c.match(/^\| \d+ \|/gm) || []).length, events.length, 'one row per recorded event');
  assert.equal(c.includes('\n# not a heading'), false, 'page text cannot add a heading');
  const trace = c.indexOf('Prepared by Layla Haddad · ');
  assert.ok(trace > 0 && trace < c.indexOf('<!-- qaw-seal -->'), 'the trace line sits above the seal, so the seal covers it');
  const v = await verifyMarkdown(c, { ownFingerprint: await SK.ownFingerprint() });
  assert.equal(v.status, 'intact');
  assert.equal(v.signer, 'Layla Haddad');
  assert.equal(v.sameInstall, true);
  assert.equal(c.endsWith('```\n'), true, 'the seal block is the last thing in the file');
});

await test('timeline-md: editing one cell of the saved file (a bug downgraded to nothing) is reported altered', async () => {
  const c = (await buildExport({ sessionId: 'qaw-seal-en', format: 'timeline-md', version: '3.8.4' })).content;
  const edited = c.replace('returns a 500', 'returns a 200');
  assert.notEqual(edited, c);
  const v = await verifyMarkdown(edited, { ownFingerprint: await SK.ownFingerprint() });
  assert.equal(v.status, 'altered');
  assert.deepEqual(v.reasons, ['text-changed']);
});

await test('timeline-md in an Arabic session: Arabic headings and row words, no vowel marks, Latin phrases isolated, intact', async () => {
  const c = (await buildExport({ sessionId: 'qaw-seal-ar', format: 'timeline-md', version: '3.8.4' })).content;
  assert.match(c, /## الملف الشخصي/);
  assert.match(c, /\| الوقت \| النوع \| ما حدث \|/);
  assert.ok(c.includes('نقر على'), 'Arabic action sentence');
  assert.ok(c.includes('إعداد: '), 'Arabic trace line');
  assert.equal(/[ً-ْ]/.test(c.slice(0, c.indexOf('<!-- qaw-seal -->'))), false, 'a visible tashkeel in the document');
  assert.ok(c.includes('\u2068https://shop.example.test/cart\u2069'), 'the URL is one isolate');
  assert.equal((await verifyMarkdown(c)).status, 'intact');
});

await test('timeline-md is also reachable from the bundle (the zip option): one entry, sealed, verifies', async () => {
  const { readZipBuffer } = await import('./lib-zip.mjs');
  const out = await buildExport({ sessionId: 'qaw-seal-en', format: 'bundle', parts: ['timeline-md'], version: '3.8.4' });
  const { entries } = readZipBuffer(Buffer.from(out.content, 'base64'));
  const name = [...entries.keys()].find((n) => /^qaw-timeline-.*\.md$/.test(n));
  assert.ok(name, `no timeline in ${[...entries.keys()]}`);
  assert.equal((await verifyMarkdown(entries.get(name).data().toString('utf8'))).status, 'intact');
});

/* ── both download options and the Verify action are really wired ───────── */

await test('both download options offer it: the popup Export row and the report Save sheet (which also feeds the zip), through the one UQA_EXPORT door', () => {
  assert.match(read('popup/popup.html'), /data-format="timeline-md"/);
  assert.match(read('popup/popup.js'), /type: 'UQA_EXPORT', sessionId: target\.id, format: btn\.dataset\.format/);
  assert.match(read('report/report.js'), /\['timeline-md', t\('seal\.part\.timelineMd'\)/);
  assert.match(read('report/report.js'), /format: 'bundle', parts: formats/);
  assert.match(read('core/filing.js'), /'timeline-md': \{ category: 'sheet', ext: 'md'/);
});

await test('Verify file is on the Settings page and wired: file picker, result region, the verdict words exist in both languages', async () => {
  const html = read('options/options.html');
  for (const id of ['verify-pick', 'verify-file', 'verify-result', 'profile-picture-pick', 'profile-picture-file', 'profile-picture-remove', 'profile-picture-preview']) assert.ok(html.includes(`id="${id}"`), `${id} missing`);
  assert.match(read('options/options.js'), /wireProfile\(\{ \$, t, save, getSettings/);
  const en = JSON.parse(read('platform/i18n/en.json'));
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  const { verdictLines } = await import('../options/profile-ui.js');
  const words = (table) => (k, v = {}) => { assert.ok(k in table, `${k} is missing`); return table[k].replace(/\{(\w+)\}/g, (_, n) => v[n] ?? `{${n}}`); };
  for (const table of [en, ar]) {
    const t = words(table);
    const intact = verdictLines({ status: 'intact', reasons: [], signer: 'Layla', date: 'd', tool: 'QA Wrap', fingerprint: fp, sameInstall: true }, t);
    assert.equal(intact[0][0], 'ok');
    assert.ok(intact.some(([, x]) => x.includes('Layla')) && intact.some(([, x]) => x.includes(shortFingerprint(fp))));
    for (const reason of ['text-changed', 'seal-edited', 'signature', 'fingerprint', 'after-seal']) {
      const lines = verdictLines({ status: 'altered', reasons: [reason], signer: '', date: '', tool: '', fingerprint: fp, sameInstall: false }, t);
      assert.equal(lines[0][0], 'bad');
    }
    for (const status of ['unsealed', 'unreadable']) assert.equal(verdictLines({ status, reasons: [], signer: '', date: '', tool: '', fingerprint: '', sameInstall: null }, t)[0][0], 'bad');
  }
  assert.match(en['verify.intact'], /^Intact/);
  assert.match(en['verify.altered'], /^Altered/);
  assert.ok(!/[ً-ْ]/.test(Object.entries(ar).filter(([k]) => /^(profile|seal|verify)\./.test(k)).map(([, v]) => v).join('')), 'visible tashkeel in the new Arabic strings');
});

await test('the docs say what the seal is and is not (tamper-evidence, not secrecy; re-signing with another key is possible)', () => {
  const doc = `${read('PRIVACY.md')}\n${read('README.md')}`;
  assert.match(doc, /tamper-evidence, not secrecy/i);
  assert.match(doc, /seal(ed)? (it )?again with (their|his or her|a different|another) (own )?key/i);
  assert.match(read('PRIVACY.ar.md'), /الختم/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
