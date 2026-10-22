/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The fine print, on a fixture site with and without its policies.
 *
 *   node tools/test-fine-print.mjs
 *
 * Every check here is pure: it reads a link set, a request stream, a form model
 * and a consent timestamp — all of which the extension already captures — and
 * answers DECLARED, OBSERVED or GAP. So the whole of it is testable in Node
 * against two fixtures: a site that has its policies and asks before it writes,
 * and one that has neither.
 *
 * The one that matters most is the ordering: a consent banner shown *after* the
 * third-party cookie is set is the commonest failure on this list and the one
 * only a `document_start` recorder can see. It is asserted in both directions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finePrint, finePrintMarkdown, policyChecks, consentChecks, formChecks,
  trackingChecks, businessChecks, accessibilityPointer, classifyHost, flatten,
  policyContentChecks, hygieneChecks, securityChecks,
  POLICIES, POLICY_DISCLOSURES, MANUAL_CHECKS,
} from '../core/fine-print.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(EXT, 'core', 'tracker-hosts.json'), 'utf8'));

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_800_000_000_000;
const HOST = 'https://shop.example.jo/';

/** A site that does it properly, in Arabic. */
const good = {
  url: HOST,
  firstPartyHost: HOST,
  commerce: true,
  links: [
    { text: 'سياسة الخصوصية', href: 'https://shop.example.jo/Ar/Pages/privacy.aspx', status: 200 },
    { text: 'الشروط والأحكام', href: 'https://shop.example.jo/terms', status: 200 },
    { text: 'ملفات الارتباط', href: 'https://shop.example.jo/cookies', status: 200 },
    { text: 'سياسة الاسترجاع', href: 'https://shop.example.jo/refund', status: 200 },
  ],
  consentSeenAt: T0 + 500,
  events: [
    { kind: 'cookie', ts: T0 + 1200, name: '_ga', url: 'https://google-analytics.com/', thirdParty: true },
  ],
  forms: [
    {
      name: 'Contact us',
      consentText: '',
      fields: [
        { label: 'Full name', name: 'name', type: 'text' },
        { label: 'Email address', name: 'email', type: 'email' },
        { label: 'I agree to the privacy policy', name: 'consent', type: 'checkbox', checked: false },
      ],
    },
  ],
  requests: [
    { url: 'https://shop.example.jo/api/items' },
    { url: 'https://js.stripe.com/v3/' },
  ],
  frames: [],
  text: 'Registered office: Amman, Jordan. Company registration 12345. Contact us: hello@example.jo',
  catalogue,
};

/** The same shop with none of it. */
const bad = {
  url: HOST,
  firstPartyHost: HOST,
  commerce: true,
  links: [{ text: 'Home', href: 'https://shop.example.jo/', status: 200 }],
  consentSeenAt: null,
  events: [
    { kind: 'cookie', ts: T0 + 100, name: '_ga', url: 'https://google-analytics.com/', thirdParty: true },
    { kind: 'storage', ts: T0 + 150, key: 'fbp', url: 'https://connect.facebook.net/', thirdParty: true },
  ],
  forms: [
    {
      name: 'Sign up',
      consentText: '',
      fields: [
        { label: 'Email', name: 'email', type: 'email' },
        { label: 'National ID number', name: 'nid', type: 'text' },
        { label: 'Date of birth', name: 'dob', type: 'date' },
      ],
    },
  ],
  requests: [
    { url: 'https://www.google-analytics.com/collect' },
    { url: 'https://connect.facebook.net/en_US/fbevents.js' },
    { url: 'https://shop.example.jo/api/items' },
  ],
  frames: [{ url: 'https://www.youtube.com/embed/x' }],
  text: 'Welcome to the shop.',
  catalogue,
};

/**
 * The page pass, as `content/spec-reader.js` reports it.
 *
 * Two fixtures rather than one, for the same reason the site fixtures come in
 * pairs: a check that only ever sees a broken page passes when it stops working
 * and nobody notices for a month.
 */
const PAGE_BAD = {
  hygiene: {
    title: 'Vite + React',
    titleEmpty: false,
    titleStarter: true,
    metaDescription: '',
    favicon: { declared: false, href: '', rel: '' },
    overflow: {
      scrollWidth: 1280,
      clientWidth: 390,
      viewport: 390,
      over: true,
      offenders: [{ tag: 'section', id: 'hero', cls: 'hero', right: 910, overhang: 520, clips: true }],
    },
    deadLinks: [{ text: 'Careers', href: '#', why: 'href="#", which goes nowhere', inFooter: true, inNav: false }],
    logo: { found: true, inHeader: true, linked: false, href: '', home: false, clickHandlerOnly: true },
    contacts: {
      tel: 1,
      mailto: 1,
      plainPhones: ['+962 6 555 0100'],
      plainMails: [],
      mismatched: [{ shown: 'sales@example.jo', href: 'mailto:leads@tracker.example', kind: 'email' }],
    },
    copyright: { found: true, text: '© 2019', start: 2019, last: 2019, now: new Date().getFullYear() },
    placeholders: ['Lorem ipsum'],
    security: {
      https: true,
      secrets: [{ id: 'google-api', why: 'a Google API key' }],
      insecureForms: [{ action: 'http://forms.example.net/post', name: 'signup' }],
      postForms: 2,
      tokenedForms: 0,
      passwordOverHttp: false,
    },
  },
};

const PAGE_GOOD = {
  hygiene: {
    title: 'Order tracking · Example Shop',
    titleEmpty: false,
    titleStarter: false,
    metaDescription: 'Track an order placed with Example Shop.',
    favicon: { declared: true, href: 'https://shop.example.jo/favicon.svg', rel: 'icon' },
    overflow: { scrollWidth: 390, clientWidth: 390, viewport: 390, over: false, offenders: [] },
    deadLinks: [],
    logo: { found: true, inHeader: true, linked: true, href: 'https://shop.example.jo/', home: true, clickHandlerOnly: false },
    contacts: { tel: 1, mailto: 1, plainPhones: [], plainMails: [], mismatched: [] },
    copyright: { found: true, text: `© ${new Date().getFullYear()}`, start: 2019, last: new Date().getFullYear(), now: new Date().getFullYear() },
    placeholders: [],
    security: { https: true, secrets: [], insecureForms: [], postForms: 1, tokenedForms: 1, passwordOverHttp: false },
  },
};

/* ── the policy pages, in both languages ───────────────────────────────── */

test('an Arabic policy link is found where an English matcher would miss it', () => {
  const checks = policyChecks(good);
  const privacy = checks.find((c) => c.id === 'policy-privacy');
  assert.equal(privacy.status, 'DECLARED');
  assert.match(privacy.detail, /سياسة الخصوصية/);
  assert.equal(checks.find((c) => c.id === 'policy-terms').status, 'DECLARED');
  assert.equal(checks.find((c) => c.id === 'policy-refund').status, 'DECLARED', 'a shop needs its refund policy');
});

test('a missing policy is a GAP that says which one and why', () => {
  const checks = policyChecks(bad);
  assert.ok(checks.every((c) => c.status === 'GAP'), 'nothing is linked, so nothing can be declared');
  assert.match(checks[0].detail, /in English or Arabic/);
  assert.match(checks[0].detail, /Most jurisdictions require one/);
});

test('a policy that is linked but answers 404 is a GAP, with its reason', () => {
  // The page declares a policy and the site does not have one: that
  // disagreement is exactly what GAP means, and it is the commonest single
  // finding on this list because footers outlive the pages they point at.
  const checks = policyChecks({ links: [{ text: 'Privacy', href: '/privacy', status: 404 }] });
  const privacy = checks.find((c) => c.id === 'policy-privacy');
  assert.equal(privacy.status, 'GAP');
  assert.match(privacy.detail, /answered 404/);
  assert.match(privacy.detail, /A policy nobody can open is not a policy/);
});

test('the refund policy is only asked for where money changes hands', () => {
  assert.ok(!policyChecks({ links: [], commerce: false }).some((c) => c.id === 'policy-refund'));
  assert.ok(policyChecks({ links: [], commerce: true }).some((c) => c.id === 'policy-refund'));
  assert.equal(POLICIES.filter((p) => p.required).length, 2, 'privacy and terms are the two that are never optional');
});

/* ── the ordering only this extension can see ──────────────────────────── */

test('consent after the cookie is the finding, and it names what was written first', () => {
  const [check] = consentChecks({ ...bad, consentSeenAt: T0 + 5000 });
  assert.equal(check.status, 'OBSERVED');
  assert.match(check.detail, /2 non-essential writes happened before the consent banner appeared/);
  assert.match(check.detail, /_ga/);
  assert.match(check.detail, /Consent asked after the fact is not consent/);
});

test('consent before the cookie passes, and says so plainly', () => {
  const [check] = consentChecks(good);
  assert.equal(check.status, 'DECLARED');
  assert.match(check.detail, /appeared before anything non-essential was written/);
});

test('no banner at all with tracking present is reported, not skipped', () => {
  const [check] = consentChecks(bad);
  assert.equal(check.status, 'OBSERVED');
  assert.match(check.detail, /no consent banner was seen in this session/);
  // And a quiet page with no banner is a GAP, not a failure: nothing was
  // written, so there is nothing to have consented to yet.
  const [quiet] = consentChecks({ events: [], consentSeenAt: null });
  assert.equal(quiet.status, 'GAP');
  assert.match(quiet.detail, /Walk the page again with cookies cleared/);
});

/* ── the form: consent, and only what it needs ─────────────────────────── */

test('an unticked consent box beside personal fields is what good looks like', () => {
  const checks = formChecks(good);
  const consent = checks.find((c) => c.id === 'form-consent-1');
  assert.equal(consent.status, 'DECLARED');
  assert.match(consent.detail, /unticked consent box/);
});

test('a pre-ticked box is called out by name and by article', () => {
  const ticked = formChecks({
    forms: [{ name: 'Sign up', fields: [
      { label: 'Email', name: 'email', type: 'email' },
      { label: 'I agree to marketing', name: 'ok', type: 'checkbox', checked: true },
    ] }],
  });
  assert.equal(ticked[0].status, 'OBSERVED');
  assert.match(ticked[0].detail, /Pre-ticked consent is not consent under GDPR Article 7/);
});

test('a form with no consent control at all is a GAP', () => {
  const checks = formChecks(bad);
  const consent = checks.find((c) => c.id === 'form-consent-1');
  assert.equal(consent.status, 'GAP');
  assert.match(consent.detail, /no consent control or statement was found/);
});

test('over-collection is flagged and explicitly not judged', () => {
  const min = formChecks(bad).find((c) => c.id === 'form-minimisation-1');
  assert.equal(min.status, 'GAP');
  assert.match(min.detail, /a national identity number/);
  assert.match(min.detail, /a date of birth/);
  assert.match(min.detail, /Flagged, not judged\./);
  assert.match(min.detail, /Article 5\(1\)\(c\)/);
  // A form that asks only what it needs produces no such line at all.
  assert.ok(!formChecks(good).some((c) => c.id.startsWith('form-minimisation')));
});

/* ── who else the page called ──────────────────────────────────────────── */

test('a tracker host is classified, and its own site is not', () => {
  assert.equal(classifyHost('www.google-analytics.com', catalogue).category, 'analytics');
  assert.equal(classifyHost('connect.facebook.net', catalogue).category, 'advertising');
  assert.equal(classifyHost('js.stripe.com', catalogue).category, 'payments');
  assert.equal(classifyHost('shop.example.jo', catalogue), null);
  assert.equal(classifyHost('', catalogue), null);
});

test('the request stream becomes a sentence a client can read', () => {
  const checks = trackingChecks(bad);
  const tracking = checks.find((c) => c.id === 'tracking');
  assert.equal(tracking.status, 'OBSERVED');
  assert.match(tracking.detail, /2 tracking hosts were called/);
  assert.match(tracking.detail, /google-analytics\.com \(analytics\)/);
  assert.match(tracking.detail, /needs consent before it runs/);

  const third = checks.find((c) => c.id === 'third-party');
  assert.match(third.detail, /embeds 1 frame from elsewhere/);
});

test('a page that calls nobody says that too', () => {
  const checks = trackingChecks({ requests: [{ url: `${HOST}api` }], frames: [], firstPartyHost: HOST, catalogue });
  assert.equal(checks.find((c) => c.id === 'tracking').status, 'DECLARED');
  assert.match(checks.find((c) => c.id === 'third-party').detail, /Everything this page loaded came from its own site/);
});

/* ── who is behind the site ────────────────────────────────────────────── */

test('business details are a presence check, and the check says so', () => {
  assert.equal(businessChecks(good)[0].status, 'DECLARED');
  const missing = businessChecks(bad)[0];
  assert.equal(missing.status, 'GAP');
  assert.match(missing.detail, /Whether the details are \*true\* is not something a page can be asked/);
});

test('the template\'s own words are a GAP, never a pass', () => {
  // A placeholder reads as a real detail to a visitor and to a presence check
  // that only counts matches, which makes it worse than an absence.
  for (const text of [
    'Your Company, 123 Main Street. Contact us: info@example.com',
    'العنوان: عنوان الشركة. اتصل بنا: hello@example.com',
  ]) {
    const check = businessChecks({ text })[0];
    assert.equal(check.status, 'GAP', `"${text}" passed as real details`);
    assert.match(check.detail, /template's own words are still on the page/);
  }
});

test('Arabic business details are read as well as English', () => {
  const ar = businessChecks({ text: 'العنوان: عمّان، الأردن. السجل التجاري 12345. اتصل بنا: hello@example.jo' });
  assert.equal(ar[0].status, 'DECLARED');
  assert.equal(flatten('سياسة الخصوصيّة'), 'سياسه الخصوصيه', 'diacritics and taa marbuta must not decide a match');
});

/* ── the whole thing ───────────────────────────────────────────────────── */

test('the undecidable ones are questions with methods, never ticks', () => {
  // Reel 1's four plus the truth half of the business details, then reel 3's
  // five claims about time and behaviour, reel 4's six that are not properties
  // of the deployed site at all, and reel 2's two judgement tails.
  assert.equal(MANUAL_CHECKS.length, 18);
  const ids = new Set();
  for (const m of MANUAL_CHECKS) {
    assert.ok(m.title && m.how && m.law, `${m.id} is missing its question, method or law`);
    assert.ok(!('status' in m), 'a manual check must not carry a status a surface could render as a result');
    assert.ok(!ids.has(m.id), `${m.id} is listed twice`);
    ids.add(m.id);
  }
  for (const id of ['fake-reviews', 'unsupported-claims', 'image-rights', 'business-truth', 'local-law']) {
    assert.ok(ids.has(id), `${id} from reel 1 must survive`);
  }
  // Reel 3's judgement-only four, plus the cancellation flow's judgement half.
  for (const id of ['deletion-honoured', 'renewal-reminder', 'ai-safety-response', 'cancellation-friction', 'storage-exposure']) {
    assert.ok(ids.has(id), `${id} from reel 3 is missing`);
  }
  // Reel 4's third category, the one that is not MANUAL in the old sense:
  // the crawler was never going to fetch the right thing.
  for (const id of ['secrets-in-history', 'database-rules', 'spend-cap']) {
    const m = MANUAL_CHECKS.find((x) => x.id === id);
    assert.equal(m.group, 'security');
    assert.match(m.law, /Not a law/, 'nothing on reel 4 is a legal exposure and the note must not imply one');
  }
  // The active-testing four are one delegated step, not four rows pretending
  // to be independent checks.
  assert.match(MANUAL_CHECKS.find((m) => m.id === 'active-security-testing').how, /does not send adversarial traffic/);
  assert.match(MANUAL_CHECKS.find((m) => m.id === 'mobile-feel').law, /Not a law/);
});

/* ── reel 3: what the policy actually says ─────────────────────────────── */

test('the three disclosure rows are read from the policy page and nowhere else', () => {
  // Reading the home page's text for "we collect your data" would answer a
  // question nobody asked, and answer it wrong. The check says so instead.
  const off = policyContentChecks({ url: 'https://shop.example.jo/', text: 'Welcome to the shop.' });
  assert.equal(off.length, 1);
  assert.equal(off[0].status, 'MANUAL');
  assert.match(off[0].detail, /Open the privacy policy and press the button again/);

  const on = policyContentChecks({
    url: 'https://shop.example.jo/privacy',
    text: 'The information we collect includes your email. We share it with third parties. We do not use artificial intelligence.',
  });
  assert.equal(on.find((c) => c.id === 'policy-text-collection').status, 'DECLARED');
  assert.equal(on.find((c) => c.id === 'policy-text-ai').status, 'DECLARED');
  assert.equal(on.find((c) => c.id === 'policy-text-third-parties').status, 'DECLARED');
});

test('a policy that says none of it is three gaps that each say what is missing', () => {
  const bare = policyContentChecks({ url: 'https://shop.example.jo/privacy', text: 'We respect you. Contact us any time.' });
  for (const id of ['collection', 'ai', 'third-parties']) {
    const row = bare.find((c) => c.id === `policy-text-${id}`);
    assert.equal(row.status, 'GAP', `${id} passed on a policy that says nothing`);
    assert.match(row.detail, /in English or Arabic/);
  }
  // And the presence of the words is never called sufficient.
  const said = policyContentChecks({ url: '/privacy', text: 'Information we collect is shared with third parties and processed by AI.' });
  assert.match(said.find((c) => c.id === 'policy-text-ai').detail, /a keyword pass is not one/);
});

test('the policy is measured against who the page actually called', () => {
  // The one subtraction on this list, and the only row here that can produce a
  // real GAP rather than a presence check.
  const gap = policyContentChecks({
    url: 'https://shop.example.jo/privacy',
    firstPartyHost: HOST,
    text: 'Information we collect is processed. We use third parties.',
    requests: [{ url: 'https://www.google-analytics.com/collect' }, { url: 'https://connect.facebook.net/x.js' }],
    catalogue,
  });
  const cover = gap.find((c) => c.id === 'policy-text-coverage');
  assert.equal(cover.status, 'GAP');
  assert.match(cover.detail, /2 other hosts contacted and the policy names 0/);
  assert.match(cover.detail, /could not have agreed to/);

  const named = policyContentChecks({
    url: 'https://shop.example.jo/privacy',
    firstPartyHost: HOST,
    text: 'We collect data and share it with third parties including google-analytics.com.',
    requests: [{ url: 'https://www.google-analytics.com/collect' }],
    catalogue,
  });
  assert.equal(named.find((c) => c.id === 'policy-text-coverage').status, 'DECLARED');
});

/* ── reel 2: site hygiene, and none of it a legal matter ───────────────── */

test('a link that never leaves the page is found where a status check sees nothing', () => {
  const checks = hygieneChecks({
    url: 'https://shop.example.jo/',
    links: [
      { text: 'Home', href: 'https://shop.example.jo/' },
      { text: 'Careers', href: '#' },
      { text: 'Press', href: 'javascript:void(0)' },
      { text: 'Blog', href: '' },
    ],
  });
  const dead = checks.find((c) => c.id === 'dead-links');
  assert.equal(dead.status, 'GAP');
  assert.match(dead.detail, /3 links on this page never leave it/);
  assert.match(dead.detail, /never make a request/);
  assert.match(dead.detail, /"Check the links"/, 'the links that do answer are counted elsewhere, not here');
});

test('placeholder text on the hygiene surface is not called a legal exposure', () => {
  const dirty = hygieneChecks({ text: 'Lorem ipsum dolor sit amet. Coming soon.' });
  const ph = dirty.find((c) => c.id === 'placeholder-text');
  assert.equal(ph.status, 'GAP');
  assert.match(ph.detail, /not a site that is breaking a law/);
  assert.equal(hygieneChecks({ text: 'A real page about real things.' }).find((c) => c.id === 'placeholder-text').status, 'DECLARED');
});

test('a stale copyright year is objective, and an absent one is not a failure', () => {
  const stale = hygieneChecks({ text: '© 2019 Example Ltd' }).find((c) => c.id === 'copyright-year');
  assert.equal(stale.status, 'GAP');
  assert.match(stale.detail, /Stale, and objectively so/);
  const none = hygieneChecks({ text: 'No notice here' }).find((c) => c.id === 'copyright-year');
  assert.equal(none.status, 'MANUAL');
  assert.match(none.detail, /Berne Convention/, 'copyright subsists without a notice, and the row must say so');
  const now = new Date().getFullYear();
  assert.equal(hygieneChecks({ text: `© 2018-${now} Example` }).find((c) => c.id === 'copyright-year').status, 'DECLARED');
});

test('an unmeasured page says so instead of reporting nine clean rows', () => {
  // "Not measured" and "measured and clean" are different answers, and a
  // tester who cannot tell them apart is worse off than one with no row.
  const blind = hygieneChecks({ text: '', links: [] });
  const pending = blind.find((c) => c.id === 'hygiene-page-pass');
  assert.equal(pending.status, 'MANUAL');
  assert.equal(pending.pending, true);
  assert.match(pending.detail, /left out rather than shown clean/);
  assert.ok(!blind.some((c) => c.id === 'favicon'), 'no favicon verdict without a favicon measurement');
});

test('the page pass answers favicon, title, overflow, logo and contacts', () => {
  const checks = hygieneChecks({ page: PAGE_BAD, url: 'https://shop.example.jo/' });
  const by = (id) => checks.find((c) => c.id === id);
  assert.equal(by('favicon').status, 'GAP');
  assert.equal(by('page-title').status, 'GAP');
  assert.match(by('page-title').detail, /still the framework's: "Vite \+ React"/);
  assert.equal(by('meta-description').status, 'GAP');
  assert.match(by('meta-description').detail, /no standard requires it/);

  const scroll = by('horizontal-scroll');
  assert.equal(scroll.status, 'GAP');
  assert.match(scroll.detail, /1280px wide inside a 390px viewport/);
  assert.match(scroll.detail, /overhanging 520px/);
  assert.match(scroll.detail, /WCAG 1\.4\.10 Reflow/);

  assert.equal(by('clickable-logo').status, 'GAP');
  assert.match(by('clickable-logo').detail, /fails here and again in the accessibility audit/);

  const contacts = by('clickable-contacts');
  assert.equal(contacts.status, 'GAP');
  assert.match(contacts.detail, /sends the message somewhere the reader never agreed to/, 'a mismatched link outranks a plain one');
});

test('a finished page passes the hygiene rows plainly', () => {
  const checks = hygieneChecks({ page: PAGE_GOOD, url: 'https://shop.example.jo/', text: `© ${new Date().getFullYear()} Example` });
  for (const id of ['favicon', 'page-title', 'meta-description', 'horizontal-scroll', 'clickable-logo', 'clickable-contacts', 'dead-links', 'placeholder-text', 'copyright-year']) {
    assert.equal(checks.find((c) => c.id === id).status, 'DECLARED', `${id} failed on a finished page`);
  }
  assert.match(checks.find((c) => c.id === 'horizontal-scroll').detail, /"Check another size"/, 'the viewport sweep belongs to the other tool');
});

/* ── reel 4: the security a page can answer for itself ─────────────────── */

test('https is checked with the subresources that undo it', () => {
  const clean = securityChecks({ url: 'https://shop.example.jo/', requests: [{ url: 'https://shop.example.jo/api' }] });
  assert.equal(clean.find((c) => c.id === 'https').status, 'DECLARED');

  const mixed = securityChecks({ url: 'https://shop.example.jo/', requests: [{ url: 'http://cdn.example.net/a.js' }] });
  const row = mixed.find((c) => c.id === 'https');
  assert.equal(row.status, 'GAP');
  assert.match(row.detail, /padlock that is not doing anything/);

  const plain = securityChecks({ url: 'http://shop.example.jo/', page: { hygiene: { security: { https: false, passwordOverHttp: true, secrets: [], insecureForms: [], postForms: 0, tokenedForms: 0 } } } });
  assert.match(plain.find((c) => c.id === 'https').detail, /carries a password field/);
});

test('a key in the page or in a query string is observed, never guessed at', () => {
  const found = securityChecks({
    url: 'https://shop.example.jo/',
    page: PAGE_BAD,
    requests: [{ url: 'https://api.example.net/v1?api_key=abcdef0123456789abcdef' }],
  });
  const row = found.find((c) => c.id === 'exposed-secrets');
  assert.equal(row.status, 'OBSERVED');
  assert.match(row.detail, /a Google API key/);
  assert.match(row.detail, /api\.example\.net/);
  assert.match(row.detail, /rotate it/);

  const clean = securityChecks({ url: 'https://shop.example.jo/', page: PAGE_GOOD, requests: [{ url: 'https://shop.example.jo/api?build=deadbeefdeadbeefdeadbeef' }] });
  const ok = clean.find((c) => c.id === 'exposed-secrets');
  assert.equal(ok.status, 'DECLARED');
  assert.match(ok.detail, /cache buster far more often than a secret/);

  // With no page pass, the row says what it did not look at.
  assert.equal(securityChecks({ url: 'https://x.jo/' }).find((c) => c.id === 'exposed-secrets').status, 'MANUAL');
});

test('cookie flags are read from the session, and silence is not a pass', () => {
  const quiet = securityChecks({ url: 'https://x.jo/', events: [] }).find((c) => c.id === 'cookie-flags');
  assert.equal(quiet.status, 'MANUAL');
  assert.match(quiet.detail, /with cookies cleared/);

  const loose = securityChecks({
    url: 'https://x.jo/',
    events: [{ kind: 'cookie', name: 'sid', secure: false, httpOnly: false, sameSite: '' }, { kind: 'cookie', name: 'ok', secure: true, httpOnly: true, sameSite: 'Lax' }],
  }).find((c) => c.id === 'cookie-flags');
  assert.equal(loose.status, 'OBSERVED');
  assert.match(loose.detail, /1 cookie of 2 was written without Secure over https \(sid\)/);
  assert.match(loose.detail, /no SameSite attribute/);
  // HttpOnly is counted and mentioned, never used to accuse: it is wrong for
  // a cookie the page's own scripts must read, and flagging it turned a real
  // front page into "33 of 33", which is a row nobody reads twice.
  assert.match(loose.detail, /a fault only where the script has no business reading them/);
  const legit = securityChecks({
    url: 'https://x.jo/',
    events: [{ kind: 'cookie', name: 'sid', secure: true, httpOnly: false, sameSite: 'None' }],
  }).find((c) => c.id === 'cookie-flags');
  assert.equal(legit.status, 'DECLARED', 'SameSite=None with Secure is a cross-site cookie, not a fault');
});

test('a missing CSRF token is a question, and a form over http is a finding', () => {
  const checks = securityChecks({ url: 'https://shop.example.jo/', page: PAGE_BAD });
  const csrf = checks.find((c) => c.id === 'csrf-token');
  assert.equal(csrf.status, 'MANUAL', 'a DOM walk cannot see a token sent as a header');
  assert.match(csrf.detail, /not proof of a hole/);
  const form = checks.find((c) => c.id === 'form-over-http');
  assert.equal(form.status, 'OBSERVED');
  assert.match(form.detail, /the submission is the part that travels/);
});

test('accessibility is delegated, and the row says where to look', () => {
  // Five of the nineteen points are accessibility and this product already
  // ships all five. A second contrast checker that disagreed with the first
  // would produce an argument rather than a fix.
  const pointer = accessibilityPointer({ a11y: { total: 7, violations: [1, 2, 3] } });
  assert.equal(pointer.delegated, true);
  assert.match(pointer.detail, /7 violations across 3 rules by axe-core/);
  assert.match(pointer.detail, /No rule is re-checked here/);
  const never = accessibilityPointer({});
  assert.match(never.detail, /has not been run on this session yet/);
  assert.ok(finePrint(good).checks.some((c) => c.id === 'accessibility'), 'the block must carry the pointer');
});

test('the good site and the bad one produce opposite documents', () => {
  const clean = finePrint({ ...good, page: PAGE_GOOD });
  const dirty = finePrint({ ...bad, page: PAGE_BAD });
  assert.ok(clean.counts.declared >= 6, `${clean.counts.declared} declared on a site that does it properly`);
  assert.ok(dirty.counts.gaps >= 5, `${dirty.counts.gaps} gaps on a site with nothing`);
  assert.ok(dirty.counts.gaps > clean.counts.gaps, 'the bad site must produce more gaps than the good one');
  assert.equal(clean.counts.manual, 18, 'reel 1 five, reel 3 five, reel 4 six, reel 2 two');
  assert.equal(clean.host, 'shop.example.jo');

  // Three surfaces, counted separately, because reading them as one list is
  // what makes a hygiene finding sound like a legal exposure.
  assert.ok(clean.counts.legal > 0 && clean.counts.hygiene > 0 && clean.counts.security > 0);
  assert.equal(clean.counts.legal + clean.counts.hygiene + clean.counts.security, clean.counts.total);
  for (const c of clean.checks) assert.ok(['legal', 'hygiene', 'security'].includes(c.surface), `${c.id} has no surface`);

  const md = finePrintMarkdown(dirty);
  assert.match(md, /## The fine print/);
  assert.match(md, /### Legal and privacy · القانوني والخصوصية/);
  assert.match(md, /### Site hygiene · الأساسيات التقنية/);
  assert.match(md, /\*\*None of this is a legal matter\.\*\*/);
  assert.match(md, /### Security, as far as a page can say/);
  assert.match(md, /\| Check \| Status \| What was found \|/);
  assert.match(md, /### Questions no scan can answer/);
  assert.match(md, /not a legal opinion, not a security review/);
  assert.match(md, /Nothing here decides whether a site is lawful, finished or secure/);
  assert.ok(!md.includes('—'), 'no em dash in anything a tester reads');
  assert.ok(!/\(s\)/.test(md), 'no bracketed plural either');
});

test('a session with no page pass still produces a document, and says what is missing', () => {
  // The commonest real case until the page reader has run: the tool must not
  // report a clean hygiene surface it never measured.
  const partial = finePrint(bad);
  assert.ok(partial.counts.unmeasured >= 1, 'unmeasured rows are counted as neither pass nor failure');
  assert.ok(partial.checks.some((c) => c.id === 'hygiene-page-pass' && c.pending));
  const md = finePrintMarkdown(partial);
  assert.match(md, /not measured in this session/);
  assert.ok(!md.includes('—'));
  assert.ok(!/\(s\)/.test(md));
});

test('every check carries an id, a title, a status and words a person can act on', () => {
  const all = finePrint({ ...bad, page: PAGE_BAD });
  const ids = new Set();
  for (const c of all.checks) {
    assert.ok(c.id && c.title && c.detail, `${c.id || 'a check'} is incomplete`);
    assert.ok(['DECLARED', 'OBSERVED', 'GAP', 'MANUAL'].includes(c.status), `${c.id} has status ${c.status}`);
    assert.ok(!ids.has(c.id), `${c.id} is emitted twice`);
    ids.add(c.id);
    assert.ok(!c.detail.includes('—'), `${c.id} has an em dash`);
    assert.ok(!/\(s\)/.test(c.detail), `${c.id} has a bracketed plural`);
    assert.ok(!/undefined|NaN|\[object/.test(c.detail), `${c.id} leaked a placeholder value: ${c.detail}`);
  }
  assert.equal(POLICY_DISCLOSURES.length, 3, 'reel 3 items 2, 3 and 4');
});


/* ── the six response headers, measured rather than asked about ─────────── */

/*
 * Decision 33. These three rows were MANUAL, and the row said why in its own
 * words: "this session records requests rather than the headers that came
 * back". The session captures them now (background/security-headers.js), and
 * what has to be defended is the distinction the rows are built on: **not
 * measured**, **absent** and **present** are three answers, and a scan that
 * reports "absent" when it means "I did not look" has told a lie that reads
 * like a finding.
 */

const responsesFor = (headers, url = 'https://shop.example.jo/') => [
  { url, type: 'main_frame', headers },
];
const rowById = (rows, id) => rows.find((r) => r.id === id);

test('with no captured response, every header row says it was not measured', () => {
  const rows = securityChecks({ url: 'https://shop.example.jo/', responses: [] });
  for (const id of ['header-csp', 'header-hsts', 'header-cors', 'header-frame-options', 'header-referrer-policy', 'header-permissions-policy']) {
    const row = rowById(rows, id);
    assert.ok(row, `${id} must exist`);
    assert.equal(row.status, 'MANUAL', `${id} must not claim a header is absent when nothing was read`);
    assert.match(row.detail, /Not measured/, `${id} must say so in words, not only in its status`);
  }
});

test('a response with the headers is read, and each row quotes what it saw', () => {
  const rows = securityChecks({
    url: 'https://shop.example.jo/',
    responses: responsesFor({
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'access-control-allow-origin': 'https://admin.example.jo',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=()',
    }),
  });
  assert.equal(rowById(rows, 'header-csp').status, 'DECLARED');
  assert.match(rowById(rows, 'header-csp').detail, /default-src 'self'/);
  assert.equal(rowById(rows, 'header-hsts').status, 'DECLARED');
  assert.match(rowById(rows, 'header-hsts').detail, /max-age=63072000/);
  assert.equal(rowById(rows, 'header-cors').status, 'DECLARED', 'a named origin is not the open one');
  assert.equal(rowById(rows, 'header-frame-options').status, 'DECLARED');
  assert.equal(rowById(rows, 'header-referrer-policy').status, 'DECLARED');
  assert.equal(rowById(rows, 'header-permissions-policy').status, 'DECLARED');
});

test('a response read with the headers absent is a gap, not a silence', () => {
  const rows = securityChecks({
    url: 'https://shop.example.jo/',
    responses: responsesFor({ 'referrer-policy': 'no-referrer' }),
  });
  assert.equal(rowById(rows, 'header-csp').status, 'GAP');
  assert.match(rowById(rows, 'header-csp').detail, /No Content-Security-Policy/);
  assert.equal(rowById(rows, 'header-hsts').status, 'GAP');
  assert.equal(rowById(rows, 'header-frame-options').status, 'GAP');
  // Two that are deliberately not gaps when absent, because absent is the safe
  // answer for one and "it depends" for the other.
  assert.equal(rowById(rows, 'header-cors').status, 'DECLARED', 'no CORS header means no other site may read it');
  assert.equal(rowById(rows, 'header-permissions-policy').status, 'MANUAL', 'it matters on a page that embeds frames, and not otherwise');
});

test('an open CORS header is observed, and an unsafe policy is named', () => {
  const open = securityChecks({
    url: 'https://shop.example.jo/',
    responses: responsesFor({
      'access-control-allow-origin': '*',
      'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'",
    }),
  });
  assert.equal(rowById(open, 'header-cors').status, 'OBSERVED');
  assert.match(rowById(open, 'header-cors').detail, /any site may read it/);
  assert.match(rowById(open, 'header-csp').detail, /unsafe-inline/,
    'a policy that allows what it exists to stop must be said out loud, not ticked');
});

test('frame-ancestors in the policy counts as framing protection', () => {
  const rows = securityChecks({
    url: 'https://shop.example.jo/',
    responses: responsesFor({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }),
  });
  assert.equal(rowById(rows, 'header-frame-options').status, 'DECLARED',
    'frame-ancestors is the modern spelling of X-Frame-Options and must satisfy the same row');
});

test('HSTS on a plain-http page is the scheme finding, not a header finding', () => {
  const rows = securityChecks({
    url: 'http://shop.example.jo/',
    responses: responsesFor({}, 'http://shop.example.jo/'),
  });
  assert.equal(rowById(rows, 'header-hsts').status, 'GAP');
  assert.match(rowById(rows, 'header-hsts').detail, /nothing for HSTS to enforce/);
});

test('the HTTPS row no longer says the session cannot capture headers', () => {
  const rows = securityChecks({ url: 'https://shop.example.jo/', requests: [] });
  const https = rowById(rows, 'https');
  assert.ok(!/does not capture/.test(https.detail),
    'the sentence was true until decision 33 and would now be a lie in the document');
});

test('r4-01-1: a CORS-only response list leaves CSP and HSTS rows MANUAL (not measured), never a gap', () => {
  const rows = securityChecks({
    url: 'https://shop.example.jo/',
    responses: [
      { url: 'https://api.other.example/v1/x', type: 'xmlhttprequest', headers: { 'access-control-allow-origin': '*' } },
      { url: 'https://other.example/', type: 'main_frame', headers: {} },
    ],
  });
  for (const id of ['header-csp', 'header-hsts', 'header-frame-options', 'header-referrer-policy']) {
    assert.equal(rowById(rows, id).status, 'MANUAL', `${id} was never measured for this document`);
    assert.match(rowById(rows, id).detail, /Not measured/);
  }
});

test('r4-01-1: two navigations on one origin pick the latest main_frame; the hash is ignored on an exact match', () => {
  const responses = [
    { url: 'https://shop.example.jo/old', type: 'main_frame', ts: 1, headers: { 'content-security-policy': "default-src 'none'" } },
    { url: 'https://shop.example.jo/new', type: 'main_frame', ts: 2, headers: { 'content-security-policy': "default-src 'self'" } },
  ];
  const rows = securityChecks({ url: 'https://shop.example.jo/other', responses });
  assert.match(rowById(rows, 'header-csp').detail, /default-src 'self'/, 'the later navigation wins');
  const exact = securityChecks({ url: 'https://shop.example.jo/old#section', responses });
  assert.match(rowById(exact, 'header-csp').detail, /default-src 'none'/, 'an exact URL match, hash stripped, beats the latest frame');
});

test('the manual question that these rows replaced points at them', () => {
  const entry = MANUAL_CHECKS.find((m) => m.id === 'response-headers');
  assert.ok(entry, 'the entry stays: what is left of it is a real question');
  assert.match(entry.how, /measured now and appear as rows above/);
  assert.ok(!/curl -I/.test(entry.how), 'it must stop telling a tester to go and do it by hand');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
