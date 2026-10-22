/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/** T-026 T-001 T-003 T-033: site names only Chrome and Edge, key record matches, licence/security text present. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (r) => fs.readFileSync(path.join(REPO, r), 'utf8');
let passed = 0;
const have = (r) => fs.existsSync(path.join(REPO, r)); // keys/ and work/ are git-ignored: absent on a clone
const unverified = [];
const skip = (what) => { unverified.push(what); console.log(`  NOT VERIFIED: ${what} is git-ignored and absent on this checkout`); };
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '-', e.message); process.exitCode = 1; } };

for (const p of ['index', 'privacy', 'support', 'terms']) {
  t(`site/${p}.html names no other browser as working`, () => {
    const h = read(`site/${p}.html`);
    assert.ok(!/<th scope="row">(Firefox|Safari|Brave|Opera|DuckDuckGo)/.test(h), 'browser table row');
    assert.ok(!/AMO|data_collection_permissions/.test(h), 'AMO section');
    assert.ok(!/(Firefox|Safari)[^<]{0,40}(supported|build|publish)/i.test(h), 'Firefox/Safari claimed');
  });
}
t('site font CSS is linked and swaps', () => {
  assert.match(read('site/assets/thmanyah.css'), /font-display:\s*swap/);
  assert.match(read('site/index.html'), /assets\/thmanyah\.css/);
});
t('T-026 the generated font header (generator and both outputs) carries no licence caveat', () => {
  const gen = read('extension/tools/build-fonts.mjs');
  const at = gen.indexOf('const header = `');
  const heads = { 'build-fonts.mjs': gen.slice(0, gen.indexOf('import fs')) + gen.slice(at, gen.indexOf('`;', at)) };
  for (const r of ['extension/ui/fonts.css', 'site/assets/thmanyah.css']) { const c = read(r); heads[r] = c.slice(0, c.indexOf('@font-face')); }
  for (const [name, h] of Object.entries(heads)) {
    assert.ok(h.length > 200, name + ': header found');
    assert.ok(!/licen[cs]|standalone font|forbid|permits|Cairo/i.test(h), name + ': caveat sentence present');
  }
});
t('README says Chrome and Edge only', () => {
  assert.ok(!/Safari|xcrun/.test(read('README.md')));
  assert.match(read('README.md'), /Chrome and Edge/);
});
t('checklist has the manual publish-the-site step', () => assert.match(read('extension/store/CHECKLIST.md'), /Publish the site by hand/));

t('keys/README.md fingerprint and ID match the public key and manifest', () => {
  if (!have('keys/README.md')) return skip('keys/README.md (T-003 fingerprint)');
  const b64 = read('keys/nj-burrito-public.spki.b64').trim();
  const der = Buffer.from(b64, 'base64');
  const fp = crypto.createHash('sha256').update(der).digest('hex');
  const id = [...fp.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const readme = read('keys/README.md');
  assert.ok(readme.includes(fp), 'fingerprint');
  assert.ok(readme.includes(id) && read('keys/EXTENSION-ID.txt').trim() === id, 'id');
  assert.equal(JSON.parse(read('extension/manifest.json')).key, b64);
});
t('decision file is dated and names an owner', () => {
  if (!have('work/decisions/qa-wrap-purpose.md')) return skip('work/decisions/qa-wrap-purpose.md (T-001 purpose)');
  const d = read('work/decisions/qa-wrap-purpose.md');
  assert.match(d, /Date: \d+ \w+ 20\d\d/);
  assert.match(d, /Nader/);
});
t('LICENSE has the deployment clause and keeps the qaw1 token', () => {
  const l = read('extension/LICENSE');
  assert.match(l, /2A\. ORGANISATIONAL DEPLOYMENT/);
  assert.match(l, /never the\s+`qaw1:`/);
  assert.match(read('extension/TERMS.md'), /qaw1:/);
  assert.match(read('extension/NOTICE'), /ORGANISATIONAL DEPLOYMENT/);
});
t('SECURITY names a private way to report, with times; security.txt names a contact; SLA has continuity', () => {
  const s = read('extension/SECURITY.md');
  assert.match(s, /Write privately to naderalzghoulbusiness@gmail.com/);
  assert.match(s, /3 working days/);
  assert.match(s, /30 days/);
  assert.match(read('site/.well-known/security.txt'), /^Contact: https:\/\/chromewebstore\.google\.com\//m);
  assert.match(read('extension/SLA.md'), /If Nader Alzghoul stops maintaining it/);
});
t('NOTICE claims only font checks that release-check makes (14-8): a loose-font rule, not a licence-text rule', () => {
  const notice = read('extension/NOTICE');
  assert.doesNotMatch(notice, /font ships without its licence text/);
  assert.match(notice, /loose font file ships under ui\/fonts\//);
});
console.log(`${passed} passed, ${unverified.length} NOT VERIFIED${unverified.length ? ` (${unverified.join('; ')})` : ''}`);
// A clone with the evidence missing is not a pass: the owner's checkout has the files, CI must say so out loud.
if (unverified.length && process.env.CI) process.exitCode = 1;
