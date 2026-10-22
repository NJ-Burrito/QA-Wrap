/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// The Harvester's three outputs, and the link check against a stub fetch.
import { buildPageMap, buildPageObject, buildHarvestBrief, className, withKeys, transliterate } from '../core/harvest.js';
import { checkUrl, checkAll, classify, summariseLinks, checkable } from '../core/links.js';
// The renderer moved to its own module so the worker's boot graph stops
// re-parsing a document shell it can never use. See core/links-report.js.
import { buildLinksReport } from '../core/links-report.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ── the harvest ──────────────────────────────────────────────────────── */
const harvest = {
  url: 'https://portal.example.test/apply/new',
  title: 'New application — Portal',
  lang: 'en',
  dir: 'ltr',
  at: 1_750_000_000_000,
  elements: [
    { n: 0, kind: 'link', tag: 'a', role: 'link', name: 'Home', text: 'Home', href: 'https://portal.example.test/', playwright: "page.getByRole('link', { name: 'Home', exact: true })", strategy: 'role', unique: true, matches: 1, region: 'nav', form: null },
    { n: 1, kind: 'field', tag: 'input', label: 'Applicant name', name: 'Applicant name', type: 'text', required: true, playwright: "page.getByLabel('Applicant name', { exact: true })", strategy: 'label', unique: true, matches: 1, region: 'main', form: 0 },
    { n: 2, kind: 'field', tag: 'input', label: 'Email', type: 'email', playwright: "page.getByLabel('Email', { exact: true })", strategy: 'label', unique: true, matches: 1, region: 'main', form: 0 },
    { n: 3, kind: 'select', tag: 'select', label: 'Governorate', playwright: "page.getByLabel('Governorate', { exact: true })", strategy: 'label', unique: true, matches: 1, region: 'main', form: 0 },
    { n: 4, kind: 'checkbox', tag: 'input', label: 'I agree to the terms', type: 'checkbox', playwright: "page.getByLabel('I agree to the terms')", strategy: 'label', unique: true, matches: 1, region: 'main', form: 0 },
    { n: 5, kind: 'button', tag: 'button', role: 'button', name: 'Submit application', text: 'Submit application', playwright: "page.getByRole('button', { name: 'Submit application', exact: true })", strategy: 'role', unique: true, matches: 1, region: 'main', form: 0 },
    { n: 6, kind: 'button', tag: 'button', role: 'button', name: 'Edit', text: 'Edit', playwright: "page.getByRole('button', { name: 'Edit', exact: true }).first()", strategy: 'role', unique: false, matches: 3, region: 'main', form: null },
    { n: 7, kind: 'button', tag: 'button', role: 'button', name: 'Edit', text: 'Edit', playwright: "page.locator('#row-2 button')", strategy: 'css', unique: true, matches: 1, region: 'main', form: null },
    { n: 8, kind: 'field', tag: 'input', label: '', type: 'search', placeholder: 'Search', playwright: "page.getByPlaceholder('Search')", strategy: 'placeholder', unique: true, matches: 1, region: 'header', form: null },
  ],
  forms: [{ n: 0, name: 'Application form', fields: [1, 2, 3, 4], submit: 5 }],
  counts: { elements: 9, unique: 8, ambiguous: 1, forms: 1, candidates: 9, byKind: { link: 1, field: 3, select: 1, checkbox: 1, button: 3 } },
  truncated: false,
};
const session = { id: 's1', charter: 'Apply for a permit', version: '3.0.0' };

{
  check('class name from title', className(harvest) === 'NewApplicationPortalPage', className(harvest));
  check('class name from path when no title', className({ url: 'https://x.test/user-settings' }) === 'UserSettingsPage', className({ url: 'https://x.test/user-settings' }));
  check('class name fallback', className({ url: 'not a url' }) === 'HarvestedPage', className({ url: 'not a url' }));

  const keyed = withKeys(harvest.elements);
  const keys = keyed.map((e) => e.key);
  check('keys: label-based camelCase + kind', keys[1] === 'applicantNameField', keys[1]);
  check('keys: button suffix', keys[5] === 'submitApplicationButton', keys[5]);
  check('keys: duplicates numbered', keys[6] === 'editButton' && keys[7] === 'editButton2', `${keys[6]},${keys[7]}`);
  check('keys: placeholder when no label', keys[8] === 'searchField', keys[8]);
  check('keys: link suffix', keys[0] === 'homeLink', keys[0]);
  check('keys: all unique', new Set(keys).size === keys.length);

  // Arabic labels: a readable key, not a tag name with a number.
  check('transliterate', transliterate('الخدمات') === 'alkhdmat' && transliterate('إرسال الطلب') === 'arsal altlb', transliterate('إرسال الطلب'));
  const ar = withKeys([
    { n: 0, kind: 'link', label: 'الخدمات الإلكترونية', tag: 'a' },
    { n: 1, kind: 'field', label: 'الرقم الوطني', tag: 'input' },
    { n: 2, kind: 'button', name: 'إرسال', tag: 'button' },
  ]).map((e) => e.key);
  check('arabic keys are readable and distinct', ar[0] === 'alkhdmatAlalktrwnyaLink' && ar[1] === 'alrqmAlwtnyField' && ar[2] === 'arsalButton', ar.join(','));
  check('arabic title gives a class name', className({ title: 'الصفحة الرئيسية - المؤسسة' }) === 'AlsfhaAlryysyaAlmwssaPage', className({ title: 'الصفحة الرئيسية - المؤسسة' }));
}

{
  const pom = buildPageObject(harvest);
  check('pom: imports playwright test', pom.startsWith("import { type Locator, type Page, expect } from '@playwright/test';"));
  check('pom: class declared', pom.includes('export class NewApplicationPortalPage {'));
  check('pom: field typed as Locator', pom.includes('readonly applicantNameField: Locator;'));
  check('pom: constructor assigns the verified locator', pom.includes("this.applicantNameField = page.getByLabel('Applicant name', { exact: true });"));
  check('pom: ambiguous locator flagged', /this\.editButton = .*\/\/ ⚠ matched 3/.test(pom));
  check('pom: goto uses the url', pom.includes("await this.page.goto('https://portal.example.test/apply/new');"));
  check('pom: fill method per form', pom.includes('async fillApplicationForm(data: {'));
  check('pom: select uses selectOption', pom.includes('await this.governorateSelect.selectOption(data.governorateSelect);'));
  check('pom: checkbox uses setChecked', pom.includes('await this.iAgreeToTheTermsCheckbox.setChecked(data.iAgreeToTheTermsCheckbox);'));
  check('pom: checkbox typed boolean', pom.includes('iAgreeToTheTermsCheckbox?: boolean;'));
  check('pom: submit method', pom.includes('async submitApplicationForm() {') && pom.includes('await this.submitApplicationButton.click();'));
  check('pom: expectLoaded on a unique element', pom.includes('await expect(this.homeLink).toBeVisible();'));
  check('pom: no page.page. doubling', !pom.includes('page.page.'));
}

{
  const map = JSON.parse(buildPageMap(harvest, session));
  // See tools/test-docs.mjs: the $schema host was never stood up, so the field is gone.
  check('map: no dead $schema', map.$schema === undefined);
  check('map: generator names the product', /QA Wrap 3\.0\.0/.test(map.generator));
  check('map: page facts', map.page.url === harvest.url && map.page.title === harvest.title);
  check('map: elements carry key and locator', map.elements[1].key === 'applicantNameField' && map.elements[1].locator.unique === true);
  check('map: ambiguous recorded', map.elements[6].locator.unique === false && map.elements[6].locator.matches === 3);
  check('map: forms', map.forms[0].fields.length === 4 && map.forms[0].submit === 5);
  check('map: session', map.session.charter === 'Apply for a permit');
}

{
  const brief = buildHarvestBrief(harvest, session);
  check('brief: title', brief.startsWith('# Page brief for a test writer: New application — Portal'));
  check('brief: counts', brief.includes('9 interactive elements, 8 with a locator verified'));
  check('brief: rule about verbatim locators', brief.includes('**verbatim**'));
  check('brief: names the page object', brief.includes('`NewApplicationPortalPage`'));
  check('brief: table row with locator', brief.includes("| 1 | field | Applicant name | main | `page.getByLabel('Applicant name', { exact: true })` | yes |"));
  check('brief: ambiguous marked', brief.includes('| ⚠ 3 |'));
  check('brief: form listed with required', brief.includes('**Application form**') && brief.includes('applicantNameField (required)'));
  check('brief: scenarios from the form', brief.includes('Fill "Application form" with valid values') && brief.includes('with applicantNameField empty'));
  check('brief: keyboard scenario', brief.includes('Keyboard only'));
}

/* ── links ────────────────────────────────────────────────────────────── */
{
  check('checkable http(s) only', checkable('https://a.test/x') && checkable('http://a.test') && !checkable('mailto:a@b') && !checkable('javascript:void(0)') && !checkable(''));

  const calls = [];
  const stub = (behaviour) => async (url, init) => {
    calls.push({ url, method: init.method });
    const b = behaviour(url, init.method);
    if (b === 'abort') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (b === 'fail') throw new TypeError('Failed to fetch');
    const headers = { get: (k) => (k.toLowerCase() === 'location' ? b.location || null : null) };
    return { status: b.status, url: b.url || url, type: b.type || 'basic', headers };
  };

  const ok = await checkUrl('https://a.test/page', { fetchImpl: stub(() => ({ status: 200 })), timeoutMs: 1000 });
  check('checkUrl: HEAD 200 is ok', ok.ok && ok.status === 200 && ok.method === 'HEAD' && !ok.redirected);

  calls.length = 0;
  const get = await checkUrl('https://a.test/nohead', { fetchImpl: stub((_, m) => (m === 'HEAD' ? { status: 405 } : { status: 200 })), timeoutMs: 1000 });
  check('checkUrl: 405 on HEAD retries with GET', get.ok && get.method === 'GET' && calls.map((c) => c.method).join() === 'HEAD,GET');

  const redir = await checkUrl('https://a.test/old', { fetchImpl: stub((u) => (u === 'https://a.test/old' ? { status: 301, location: '/new' } : { status: 200 })), timeoutMs: 1000 });
  check('checkUrl: redirect reported with the landing url', redir.ok && redir.redirected && redir.finalUrl === 'https://a.test/new');

  // MV3 extension fetch with redirect:'manual' answers an opaqueredirect with no Location: reported as redirected, not followed.
  const opaque = await checkUrl('https://a.test/o', { fetchImpl: stub(() => ({ status: 0, type: 'opaqueredirect' })), timeoutMs: 1000 });
  check('checkUrl: opaqueredirect is ok and redirected', opaque.ok && opaque.redirected === true);

  const slash = await checkUrl('https://a.test', { fetchImpl: stub(() => ({ status: 200, url: 'https://a.test/' })), timeoutMs: 1000 });
  check('checkUrl: a trailing slash is not a redirect', !slash.redirected);

  const broken = await checkUrl('https://a.test/gone', { fetchImpl: stub(() => ({ status: 404 })), timeoutMs: 1000 });
  check('checkUrl: 404 is broken', !broken.ok && broken.status === 404);

  const dead = await checkUrl('https://a.test/dead', { fetchImpl: stub(() => 'fail'), timeoutMs: 1000 });
  check('checkUrl: network failure on both tries → broken with a reason', !dead.ok && dead.status === 0 && dead.error === 'network error');

  const slow = await checkUrl('https://a.test/hang', { fetchImpl: stub(() => 'abort'), timeoutMs: 1000 });
  check('checkUrl: abort reads as no answer', !slow.ok && /no answer in 1s/.test(slow.error));

  const many = await checkAll(['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], { fetchImpl: stub((u) => ({ status: u.endsWith('2') ? 500 : 200 })), concurrency: 2, timeoutMs: 1000 });
  check('checkAll keeps order', many.map((r) => r.status).join() === '200,500,200');

  check('classify', classify({ ok: false }) === 'broken' && classify({ ok: true, redirected: true }) === 'redirect' && classify({ ok: true, ms: 5000 }) === 'slow' && classify({ ok: true, ms: 10 }) === 'ok' && classify(undefined) === 'skipped');

  const links = [
    { href: 'https://a.test/1', text: 'One', internal: true },
    { href: 'https://a.test/2', text: 'Two', internal: true },
    { href: 'mailto:x@y', text: 'Mail', internal: false },
    { href: 'https://b.test/', text: 'Other', internal: false },
  ];
  const results = [{ ok: true, ms: 12, status: 200 }, { ok: false, status: 404 }, undefined, { ok: true, ms: 3200, status: 200 }];
  const s = summariseLinks(links, results);
  check('summary counts', s.total === 4 && s.checked === 3 && s.ok === 1 && s.broken.length === 1 && s.slow.length === 1 && s.skipped.length === 1);
  check('summary rows keep the text', s.broken[0].text === 'Two' && s.broken[0].state === 'broken');

  const report = buildLinksReport({ url: 'https://a.test/', title: 'A', ts: 1_750_000_000_000, total: 4, checked: 3, ok: 1, broken: s.broken, redirected: s.redirected, slow: s.slow, skipped: 1, rows: s.rows });
  check('report: heading and counts', report.startsWith('# Link check: A') && report.includes('**1 broken**'));
  check('report: broken table', report.includes('## Broken (1)') && report.includes('| https://a.test/2 | Two | 404 |'));
  check('report: every link table', report.includes('## Every link') && report.includes('| mailto:x@y | Mail | skipped |'));
}

console.log(`test-harvest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
