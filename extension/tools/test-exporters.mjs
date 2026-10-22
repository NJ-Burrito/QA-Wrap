/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Tests for core/exporters.js — HTML, plain text, JUnit, HAR and YAML.
 *
 *   node tools/test-exporters.mjs
 *
 * Three of these five are formats another program parses, and a file that is
 * *nearly* valid fails at that program rather than here. So the XML is parsed,
 * the HAR is parsed, and the HTML is handed to a real browser — asserting the
 * output is well formed, not merely that it contains the right substrings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { buildHtml, buildText, buildJunit, buildHar, buildYaml, yamlValue } from '../core/exporters.js';
import { buildLocatorSet } from '../core/locatorset.js';
import { buildTestPlan, buildLocatorSheet } from '../core/locatorplan.js';
import { SHELL_CSS, loadDocFonts } from '../core/docshell.js';
import { buildSrsHtml, buildManualHtml, buildStoryboardHtml } from '../core/docs.js';
import { buildLinksHtml } from '../core/links-report.js';
import { profile } from './lib-paths.mjs';
import { readZipBuffer } from './lib-zip.mjs';
import { buildSessionWorkbook } from '../core/sheets.js';
import { buildPostmanCollection } from '../core/postman.js';

/*
 * Every real caller reaches `shell()` through `background/export-build.js`'s
 * `brandAssets()`, which always awaits `loadDocFonts()` first — `shell()`
 * throws otherwise (`core/docshell.js`). This file calls the builders
 * directly, bypassing that wrapper, so it does the same thing here, once,
 * before any test builds a document.
 */
await loadDocFonts();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_700_000_000_000;
const session = {
  id: 's_exp',
  charter: 'Submit an application with an expired document',
  startedAt: T0,
  endedAt: T0 + 12_000,
  startUrl: 'https://example.gov/apply',
  env: { viewport: '1920×1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'en-US' },
  status: 'stopped',
};

const events = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'https://example.gov/apply' },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader', label: 'اسم المستخدم',
    locator: "getByLabel('اسم المستخدم')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: '<Submit & "go">',
    locator: "getByRole('button')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380,
    error: false, responsePreview: '{"error":"NullPointer & <crash>"}', frameUrl: 'https://example.gov/apply' },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500', frameUrl: 'https://example.gov/apply' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'Reproduced three times, always on "Submit".' },
  { kind: 'net', ts: T0 + 9000, method: 'GET', url: '/api/heartbeat', status: 200, durationMs: 20,
    error: false, frameUrl: 'https://example.gov/apply' },
];

console.log('exporters.js — plain text');

await test('it carries the cause, the steps and the environment, with no markup', () => {
  const out = buildText(session, events);
  assert.ok(out.includes('WHAT BROKE'));
  assert.ok(out.includes('POST /api/applications'));
  assert.ok(out.includes('Caused by:'));
  assert.ok(out.includes('STEPS TO REPRODUCE'));
  assert.ok(out.includes('1920×1080'));
  // The tester's own data may contain angle brackets — a label really can be
  // "<Submit>". What must not appear is markup *we* added, so look for the
  // structures a renderer produces rather than for a lone bracket.
  assert.doesNotMatch(out, /<\/[a-z]+>/i, 'plain text must not contain closing tags');
  assert.doesNotMatch(out, /^\s*#{1,6}\s|\*\*|^\s*\|.*\|/m, 'plain text must not contain Markdown');
});

console.log('\nexporters.js — YAML');

await test('special characters are quoted so the document still parses', () => {
  const out = buildYaml(session, events);
  // A value starting with a brace, a colon-space, or looking like a number
  // must be quoted or the parser reads something else entirely.
  const risky = out.split('\n').filter((l) => /: \{|: \[|: .*: /.test(l) && !/"/.test(l));
  assert.equal(risky.length, 0, `unquoted risky values:\n${risky.join('\n')}`);
  assert.ok(out.startsWith('#'), 'the provenance comment should lead');
  assert.ok(out.includes('charter:'));
  assert.ok(out.includes('stepsToReproduce:'));
});

await test('it never emits a bare tab, which YAML forbids for indentation', () => {
  const out = buildYaml(session, events);
  assert.doesNotMatch(out, /^\t/m, 'tabs are illegal as YAML indentation');
});

console.log('\nexporters.js — JUnit');

await test('one test case per reproduction step, not one per session', () => {
  const xml = buildJunit(session, events);
  const cases = xml.match(/<testcase /g) || [];
  assert.ok(cases.length > 1, `only ${cases.length} case(s) — a failure would land on nothing specific`);
});

await test('the failure is attached to the step that caused it', () => {
  const xml = buildJunit(session, events);
  assert.ok(xml.includes('<failure '), 'no failure element at all');
  const caseWithFailure = xml.split('<testcase ').find((c) => c.includes('<failure'));
  assert.ok(/Clicked/.test(caseWithFailure), 'the failure is not on the click that triggered it');
});

await test('markup in the data is escaped, not emitted raw', () => {
  const xml = buildJunit(session, events);
  assert.ok(xml.includes('&lt;Submit &amp; &quot;go&quot;&gt;') || xml.includes('&lt;Submit &amp;'),
    'an element label containing < & " was not escaped');
  assert.doesNotMatch(xml, /name="[^"]*<[^"]*"/, 'a raw < inside an attribute');
});

console.log('\nexporters.js — HAR');

await test('it is valid JSON with the shape a HAR reader expects', () => {
  const har = JSON.parse(buildHar(session, events));
  assert.equal(har.log.version, '1.2');
  assert.ok(Array.isArray(har.log.entries));
  assert.ok(Array.isArray(har.log.pages));
  for (const e of har.log.entries) {
    assert.ok(e.request?.method, 'an entry with no method');
    assert.ok(typeof e.response?.status === 'number', 'an entry with no status');
    assert.ok(Array.isArray(e.request.headers), 'headers must be an array, even when empty');
    assert.ok(e.startedDateTime.endsWith('Z'), 'startedDateTime must be ISO');
  }
});

await test('one entry per network event, and nothing else', () => {
  const har = JSON.parse(buildHar(session, events));
  assert.equal(har.log.entries.length, events.filter((e) => e.kind === 'net').length);
});

await test('it says what it does not know rather than inventing it', () => {
  const har = JSON.parse(buildHar(session, events));
  // The limits are real and they changed: headers and bodies ARE recorded now,
  // but the timings still come from wrapping fetch rather than from the network
  // stack, and that is the thing a HAR viewer will otherwise present as fact.
  assert.match(har.log.comment, /not from the network stack/);
  assert.match(har.log.comment, /redacted/);
  // T-008: the retired "redacted at capture time ... arrive here already redacted" promised more than the code does.
  assert.doesNotMatch(har.log.comment, /capture time|already redacted/);
  assert.match(har.log.comment, /scanned again when it is written/);
});

await test('a recorded request carries its headers and its body', () => {
  const har = JSON.parse(
    buildHar(session, [
      {
        kind: 'net', method: 'POST', url: '/api/x?page=2', status: 201, ts: Date.now(), durationMs: 12,
        reqHeaders: { 'content-type': 'application/json' },
        reqBody: { kind: 'json', text: '{"a":1}' },
        resHeaders: { 'content-type': 'application/json' },
      },
    ])
  );
  const entry = har.log.entries[0];
  assert.deepEqual(entry.request.headers, [{ name: 'content-type', value: 'application/json' }]);
  assert.equal(entry.request.postData.text, '{"a":1}');
  assert.equal(entry.request.postData.mimeType, 'application/json');
  // The pairs, not only the string: every HAR viewer reads the pairs, and an
  // empty Params tab on a request that plainly has parameters looks broken.
  assert.deepEqual(entry.request.queryString, [{ name: 'page', value: '2' }]);
  assert.deepEqual(entry.response.headers, [{ name: 'content-type', value: 'application/json' }]);
});

await test('a request with nothing recorded still produces a valid entry', () => {
  const har = JSON.parse(
    buildHar(session, [{ kind: 'net', method: 'GET', url: '/plain', status: 200, ts: Date.now() }])
  );
  const entry = har.log.entries[0];
  assert.deepEqual(entry.request.headers, [], 'no headers is an empty list, not a crash');
  assert.equal('postData' in entry.request, false, 'a GET with no body has no postData at all');
});

console.log('\nexporters.js — HAR and YAML accuracy (council-1009 lane C)');

await test('11-3 HAR: relative request URLs are resolved against the session start URL, every entry parses without a base', () => {
  const har = JSON.parse(buildHar({ ...session, startUrl: 'https://x.test/app' }, [
    { kind: 'net', ts: T0, method: 'GET', url: '/api/a?b=1', status: 200 },
    { kind: 'net', ts: T0, method: 'GET', url: 'https://other.test/z', status: 200 },
    { kind: 'net', ts: T0, method: 'GET', url: 'rel/path', status: 200 },
  ]));
  assert.equal(har.log.entries[0].request.url, 'https://x.test/api/a?b=1');
  for (const e of har.log.entries) assert.doesNotThrow(() => new URL(e.request.url), e.request.url);
  const none = JSON.parse(buildHar({ ...session, startUrl: '' }, [{ kind: 'net', ts: T0, method: 'GET', url: '/plain', status: 200 }]));
  assert.equal(none.log.entries[0].request.url, '/plain', 'no base: the raw value is kept');
});

await test('11-9 HAR: browser.version is Chrome x.y, sizes are bytes not UTF-16 units', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.61 Safari/537.36';
  const har = JSON.parse(buildHar({ ...session, env: { ...session.env, userAgent: ua } }, [
    { kind: 'net', ts: T0, method: 'POST', url: '/a', status: 200, responsePreview: 'مرحبا', reqBody: { kind: 'text', text: 'é€' } },
  ]));
  assert.equal(har.log.browser.version, '126.0.6478.61');
  const e = har.log.entries[0];
  assert.equal(e.response.bodySize, 10, 'five Arabic letters are ten bytes');
  assert.equal(e.response.content.size, 10);
  assert.equal(e.request.bodySize, 5, 'é is 2 bytes, € is 3');
});

await test('11-4 YAML: YAML 1.1 hazards are double-quoted and round-trip through JSON.parse', () => {
  const TAB = String.fromCharCode(9), CR = String.fromCharCode(13), LS = String.fromCharCode(0x2028);
  const hazards = ['no', 'yes', 'on', 'off', 'y', 'n', 'Yes', '2026-10-09', '2026-10-09 12:00:00', '1e3', '0x1F', '+5', '1_000', '.inf', '12:30', `a${TAB}b`, `a${CR}b`, `a${LS}b`, 'true', '007', ''];
  for (const h of hazards) {
    const out = yamlValue(h, 2);
    assert.ok(out.startsWith('"'), `${JSON.stringify(h)} must be quoted, got ${out}`);
    assert.equal(JSON.parse(out), h, `${JSON.stringify(h)} does not round-trip`);
  }
  for (const plain of ['hello world', 'Submit an application', 'v1.2.3-beta', 'نص عربي']) {
    assert.equal(yamlValue(plain, 2), plain, `${plain} should stay a plain scalar`);
  }
});

await test('10-2 text report: an Arabic session gets an Arabic .txt', () => {
  const arS = { ...session, charter: 'اختبار تقديم الطلب بوثيقة منتهية الصلاحية في بوابة الخدمات الحكومية' };
  const arE = [
    { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply' },
    { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'إرسال الطلب', tag: 'button' },
    { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380, error: false, responsePreview: 'boom' },
    { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'ملاحظة: يفشل الإرسال دائماً عند رفع الوثيقة المنتهية الصلاحية' },
  ];
  const out = buildText(arS, arE);
  for (const en of ['Where:', 'problems', 'WHAT BROKE', 'STEPS TO REPRODUCE', 'ENVIRONMENT', 'Nothing failed']) assert.ok(!out.includes(en), `Arabic .txt still says ${en}`);
  assert.ok(out.includes('ما الذي تعطّل') && out.includes('خطوات إعادة الإنتاج'), 'Arabic headings missing');
  const eng = buildText(session, events);
  assert.ok(eng.includes('Where:') && eng.includes('WHAT BROKE'), 'English .txt changed');
});

console.log('\nexporters.js — HTML');

const context = await chromium.launchPersistentContext(profile('.export-profile'), launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
try {
  const page = await context.newPage();

  await test('a real browser parses it, and the content survives', async () => {
    const html = buildHtml(session, events, {});
    await page.setContent(html, { waitUntil: 'load' });
    const shape = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent || '',
      cards: document.querySelectorAll('.card').length,
      chains: document.querySelectorAll('.chain').length,
      steps: document.querySelectorAll('ol li').length,
      // If escaping had failed, the browser would have parsed the label as a
      // tag and this text would simply be gone.
      hasEscapedLabel: document.body.textContent.includes('<Submit & "go">'),
      externalRefs: [...document.querySelectorAll('link,script,img')]
        .map((n) => n.getAttribute('href') || n.getAttribute('src') || '')
        .filter((u) => /^https?:/.test(u)),
    }));

    assert.ok(shape.title.includes('expired document'), 'the title lost the charter');
    assert.equal(shape.h1, session.charter);
    assert.ok(shape.cards >= 5, `only ${shape.cards} summary cards`);
    assert.equal(shape.chains, 1, 'the failure did not become a card');
    assert.ok(shape.steps > 0, 'no reproduction steps rendered');
    assert.ok(shape.hasEscapedLabel, 'a label containing markup was swallowed by the parser');
    // The whole point of this format: it opens anywhere, for ever, offline.
    assert.deepEqual(shape.externalRefs, [], 'the report reaches out to the network');
  });

  await test('an embedded screenshot renders from the file itself', async () => {
    const pixel =
      'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const withShot = [...events, { kind: 'screenshot', ts: T0 + 5000, captureId: 'c1', text: 'The error' }];
    const html = buildHtml(session, withShot, { c1: { dataUrl: pixel } });
    await page.setContent(html, { waitUntil: 'load' });
    const ok = await page.evaluate(() => {
      const img = document.querySelector('img');
      return img ? img.complete && img.naturalWidth > 0 : false;
    });
    assert.ok(ok, 'the embedded screenshot did not decode');
  });

  await test('it renders on a dark ground as well as a light one', async () => {
    // The report is opened by whoever it was sent to, in whatever theme they
    // use. Text the colour of its own background is a broken deliverable.
    const html = buildHtml(session, events, {});
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setContent(html, { waitUntil: 'load' });
      const contrast = await page.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const body = getComputedStyle(document.body);
        const a = lum(body.color);
        const b = lum(body.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      assert.ok(contrast >= 7, `${scheme}: body text contrast is only ${contrast.toFixed(1)}:1`);
    }
  });
  await test('the shared shell names no remote host, so no exported document can', () => {
    // Every document QA Wrap writes is wrapped in this one sheet: the report
    // here, the SRS and the manual in core/docs.js, the link map in core/links.js.
    // Asserting on the sheet rather than on one caller's output covers all of
    // them, including the ones this file does not build.
    const remote = [...SHELL_CSS.matchAll(/https?:\/\/[^\s'")]+/g)].map((m) => m[0]);
    assert.deepEqual(remote, [],
      'an exported document is opened on a machine that is not ours, so a URL ' +
      'in this sheet is that machine telling a third party what it is reading');
    assert.ok(!/@import/.test(SHELL_CSS), 'an @import is a fetch by another name');
  });

  await test('an exported report opened in a browser requests nothing', async () => {
    // The measurement, not the grep: a real browser is given the real file and
    // every request it tries to make is recorded. `googleapis` was the one that
    // used to appear here, from `@import url(fonts.googleapis.com)`.
    const html = buildHtml(session, events, {});
    assert.ok(!/googleapis/.test(html), 'the exported report still names Google Fonts');
    const asked = [];
    const listen = (req) => { if (/^https?:/.test(req.url())) asked.push(req.url()); };
    page.on('request', listen);
    try {
      await page.setContent(html, { waitUntil: 'load' });
      // A webfont is fetched lazily, when a glyph in it is first painted, so
      // the load event alone is not proof. Give the font stack a frame.
      await page.evaluate(() => document.fonts.ready);
    } finally {
      page.off('request', listen);
    }
    assert.deepEqual(asked, [], `the report reached out to: ${asked.join(', ')}`);
  });
  await test('an exported report embeds Thmanyah, and names no Cairo', async () => {
    // The round-2 decision (research/56:167-168,194) supersedes decision 135:
    // every export embeds the product's face rather than falling back to the
    // reader's system stack, so a client with nothing installed still sees
    // the real one. `loadDocFonts()` reads the same base64 cuts `ui/fonts.css`
    // ships for the UI, and `shell()` throws if this was never awaited first
    // — a missed await fails loudly here instead of shipping a font-less file.
    const css = await loadDocFonts();
    assert.ok(/@font-face/.test(css) && /Thmanyah/.test(css), 'loadDocFonts() should return the embedded cuts');

    const html = buildHtml(session, events, {});

    assert.ok([...html.matchAll(/@font-face\s*\{[^}]*\}/g)].length > 0,
      'an export must carry the embedded @font-face rules');
    assert.ok(!/Cairo/.test(html), 'the export names Cairo');
    assert.ok(/Thmanyah/.test(html), 'the export does not name Thmanyah');
    assert.ok(/src:\s*url\(\s*['"]?data:font\//.test(html), 'the font must travel as a data: URI, never a loose file');
    assert.ok(/-apple-system|Segoe UI/.test(html), 'the system stack should still be there as a fallback');

    const asked = [];
    const listen = (req) => { if (/^https?:/.test(req.url())) asked.push(req.url()); };
    page.on('request', listen);
    let loaded;
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      loaded = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`));
    } finally {
      page.off('request', listen);
    }
    // The font is embedded as base64 — that guarantee survives the decision
    // reversal untouched: nothing is ever fetched over the network for it.
    assert.deepEqual(asked, [], `the report reached out to: ${asked.join(', ')}`);
    assert.ok(loaded.some((f) => /Thmanyah/.test(f) && /loaded/.test(f)),
      `Thmanyah did not load in the exported page: ${JSON.stringify(loaded)}`);
  });
  await test('every document-shell entry point embeds the face, not only the report', async () => {
    // core/exporters.js:318, core/docs.js:369/422/441 and core/links-report.js:60
    // are the five `shell()` return points named in the S9 plan. `welcome.js`
    // is named there too, but it never imports `docshell`/`shell` at all — it
    // opens PRIVACY.md as a raw file (welcome/welcome.js:35) — so there is no
    // sixth document to check here.
    const docs = {
      'exporters.js buildHtml': () => buildHtml(session, events, {}),
      'docs.js buildSrsHtml': () => buildSrsHtml(session, events),
      'docs.js buildManualHtml': () => buildManualHtml(session, events, {}),
      'docs.js buildStoryboardHtml': () => buildStoryboardHtml(session, events, {}),
      'links-report.js buildLinksHtml': () => buildLinksHtml({ url: 'https://x.test', title: 'x', total: 1, checked: 1, broken: [], redirected: [], slow: [], skipped: 0, rows: [] }),
    };
    for (const [name, build] of Object.entries(docs)) {
      const out = await build();
      assert.ok(/@font-face/.test(out), `${name} did not embed a face`);
      assert.ok(/Thmanyah/.test(out), `${name} does not name Thmanyah`);
    }
  });
  await test('D-1010-55: every document shell carries the meta CSP right after the charset, and a hostile title cannot add a script', async () => {
    const { DOC_CSP, shell } = await import('../core/docshell.js');
    assert.equal(DOC_CSP, "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'");
    const metas = {
      buildHtml: await buildHtml(session, events, {}),
      buildSrsHtml: await buildSrsHtml(session, events),
      buildManualHtml: await buildManualHtml(session, events, {}),
      buildStoryboardHtml: await buildStoryboardHtml(session, events, {}),
      buildLinksHtml: await buildLinksHtml({ url: 'https://x.test', title: 'x', total: 1, checked: 1, broken: [], redirected: [], slow: [], skipped: 0, rows: [] }),
    };
    for (const [name, out] of Object.entries(metas)) {
      const at = out.indexOf('<meta charset="utf-8">' + String.fromCharCode(10) + '<meta http-equiv="Content-Security-Policy" content="' + DOC_CSP + '">');
      assert.ok(at > 0 && at < out.indexOf('<style>'), `${name}: the CSP meta must follow the charset, before any style`);
      assert.equal(out.split('http-equiv="Content-Security-Policy"').length, 2, `${name}: exactly one CSP meta`);
    }
    const hostile = shell({ title: '</title><script>alert(1)</script><img src=x onerror=alert(2)>', kind: 'k', body: '<p>b</p>' });
    assert.ok(!/<script/i.test(hostile) && !/<img src=x/i.test(hostile), 'an escaped title adds no script or image');
    assert.ok(hostile.indexOf('Content-Security-Policy') < hostile.indexOf('<title>'), 'the policy comes before the title');
  });
  await test('the HTML export carries the selectors that were copied', () => {
    const copied = [
      ...events,
      {
        kind: 'selectorcopy',
        ts: T0 + 6000,
        copied: "page.getByRole('button', { name: 'Submit' })",
        flavours: [
          { name: 'playwright', expr: "page.getByRole('button', { name: 'Submit' })", copied: true, unique: true },
          { name: 'css', expr: '#apply > button.primary' },
        ],
        tag: 'button',
        elementId: 'apply-submit',
        classes: 'primary wide',
        text: 'Submit',
        previewNote: 'nocapture',
      },
    ];
    const html = buildHtml(session, copied, {});
    assert.ok(html.includes('Selector copy'), 'the section is missing from the HTML export');
    assert.ok(html.includes('getByRole'), 'the selector that was copied is not in the file');
    assert.ok(html.includes('#apply-submit'), 'the element is not described');
    assert.ok(html.includes('#apply &gt; button.primary'),
      'the other flavours the picker offered are dropped, and escaped markup is how they must arrive');
    assert.ok(!buildHtml(session, events, {}).includes('Selector copy'),
      'a session where nothing was copied still prints the heading');
  });

  console.log('\nlocatorset.js — Locator set (for an AI)');

  await test('one entry per pick, in walk order, with the fields an AI needs to act', () => {
    const copied = [
      ...events,
      {
        kind: 'selectorcopy', ts: T0 + 5000, frameUrl: 'https://example.gov/apply',
        copied: "page.getByRole('button', { name: 'Submit' })",
        flavours: [
          { name: 'playwright', expr: "page.getByRole('button', { name: 'Submit' })", matches: 1, unique: true },
          { name: 'css', expr: '#apply > button.primary' },
          { name: 'xpath', expr: "//button[@id='apply-submit']" },
        ],
        matches: 1, ambiguous: false, tag: 'button', role: 'button', text: 'Submit',
      },
      {
        kind: 'selectorcopy', ts: T0 + 1000, frameUrl: 'https://example.gov/apply',
        copied: "page.getByLabel('اسم المستخدم')",
        flavours: [{ name: 'playwright', expr: "page.getByLabel('اسم المستخدم')", matches: 2, unique: false }],
        matches: 2, ambiguous: true, tag: 'input', role: 'textbox', text: 'اسم المستخدم',
      },
      // A masked pick must never surface, whatever its flavours claim.
      {
        kind: 'selectorcopy', ts: T0 + 5500, frameUrl: 'https://example.gov/apply',
        copied: "page.getByText('secret-should-not-leak')",
        flavours: [{ name: 'playwright', expr: "page.getByText('secret-should-not-leak')", matches: 1, unique: true }],
        matches: 1, ambiguous: false, tag: 'div', text: '••••••••', maskedSource: true,
      },
    ];
    const out = JSON.parse(buildLocatorSet(session, copied));
    assert.equal(out.schema, 'njb.locator-set/1');
    assert.equal(out.picks.length, 2, 'the masked pick leaked through');
    assert.ok(!JSON.stringify(out).includes('secret-should-not-leak'), 'a masked pick leaked into the export');
    // Walk order, not insertion order: the earlier ts (+1s) sorts before the later (+5s) pick above it in the fixture.
    assert.equal(out.picks[0].n, 1);
    assert.equal(out.picks[0].offset, '+0:01');
    assert.equal(out.picks[0].text, 'اسم المستخدم');
    assert.equal(out.picks[1].offset, '+0:05');
    assert.equal(out.picks[1].playwright, "page.getByRole('button', { name: 'Submit' })");
    assert.equal(out.picks[1].css, '#apply > button.primary');
    assert.equal(out.picks[1].xpath, "//button[@id='apply-submit']");
    assert.equal(out.picks[1].unique, true);
    assert.equal(out.picks[1].frameUrl, 'https://example.gov/apply');
  });

  await test('gap G2 action and gap G5 credential name ride along, and no value ever does', () => {
    const copied = [
      ...events,
      // The `dom` event carries the same `selector` the pick's css flavour
      // does, so gap G2's join finds it.
      { kind: 'dom', ts: T0 + 4500, action: 'input', value: 'secret', label: 'Password',
        locator: "getByLabel('Password')", selector: '#login-password', framePrefix: '',
        frameUrl: 'https://example.gov/apply', tag: 'input' },
      {
        kind: 'selectorcopy', ts: T0 + 4000, frameUrl: 'https://example.gov/apply',
        copied: "page.getByLabel('Password')",
        flavours: [
          { name: 'playwright', expr: "page.getByLabel('Password')", matches: 1, unique: true },
          { name: 'css', expr: '#login-password' },
        ],
        matches: 1, ambiguous: false, tag: 'input', role: 'textbox', text: 'Password',
        category: 'field', credRef: { name: 'LOGIN_PASSWORD' },
      },
    ];
    const out = JSON.parse(buildLocatorSet(session, copied));
    const pick = out.picks.find((p) => p.playwright === "page.getByLabel('Password')");
    assert.deepEqual(pick.action, ['input'], 'the join to the matching dom event did not carry the action');
    assert.deepEqual(pick.credential, { env: 'LOGIN_PASSWORD' }, 'the placeholder name did not travel');
    assert.ok(!JSON.stringify(out).includes('secret'), 'a value leaked where only a name should be');
    assert.ok(out.header.includes('credential.env'), 'the header does not tell the AI how to read the value');
  });

  // r9-11-7: the browser's own parser, not our substring checks. A file that is nearly valid fails in the tool that opens it.
  console.log('\nexporters.js — real parsers (DOMParser in the browser)');
  const parseAll = (docs) => page.evaluate((list) => list.map(({ name, text, type }) => {
    const d = new DOMParser().parseFromString(text, type);
    const err = d.querySelector('parsererror');
    return { name, error: err ? err.textContent.slice(0, 160) : null, root: d.documentElement.localName, testcases: d.querySelectorAll('testcase').length, failures: d.querySelectorAll('failure').length, rows: d.querySelectorAll('row').length };
  }), docs);

  await test('JUnit parses as XML with testsuite > testcase, and the failure sits on a case', async () => {
    const [r] = await parseAll([{ name: 'junit', text: buildJunit(session, events), type: 'application/xml' }]);
    assert.equal(r.error, null, `JUnit is not well-formed XML: ${r.error}`);
    assert.ok(['testsuite', 'testsuites'].includes(r.root), `JUnit root is <${r.root}>`);
    assert.ok(r.testcases > 1 && r.failures >= 1, `testcases ${r.testcases}, failures ${r.failures}`);
    const inCase = await page.evaluate((x) => [...new DOMParser().parseFromString(x, 'application/xml').querySelectorAll('failure')].every((f) => f.parentElement.localName === 'testcase'), buildJunit(session, events));
    assert.ok(inCase, 'a <failure> is not a child of a <testcase>');
  });

  await test('every part of the session workbook (English and Arabic) parses with DOMParser, and each sheet has rows', async () => {
    const arSession = { ...session, locale: 'ar', language: 'ar' };
    for (const [label, sess] of [['en', session], ['ar', arSession]]) {
      const zip = readZipBuffer(buildSessionWorkbook(sess, events));
      const docs = [...zip.entries.keys()].filter((n) => /\.(xml|rels)$/.test(n)).map((n) => ({ name: n, text: zip.entries.get(n).data().toString('utf8'), type: 'application/xml' }));
      assert.ok(docs.some((d) => /worksheets\/sheet\d+\.xml$/.test(d.name)), `${label}: no worksheet part`);
      const parsed = await parseAll(docs);
      for (const r of parsed) assert.equal(r.error, null, `${label} ${r.name}: ${r.error}`);
      for (const r of parsed.filter((x) => /worksheets\/sheet/.test(x.name))) assert.ok(r.rows > 0, `${label} ${r.name} has no rows`);
    }
  });

  await test('Postman collection carries the v2.1 keys a Postman import needs', () => {
    const col = JSON.parse(JSON.stringify(buildPostmanCollection(session, events)));
    assert.match(col.info?.schema || '', /collection\/v2\.1\.0\/collection\.json$/, 'info.schema is not v2.1.0');
    assert.ok(col.info?.name && typeof col.info.name === 'string', 'info.name');
    assert.ok(Array.isArray(col.item), 'item is not an array');
    const leaves = [];
    const walk = (xs) => xs.forEach((i) => (i.item ? walk(i.item) : leaves.push(i)));
    walk(col.item);
    assert.ok(leaves.length > 0, 'no request items');
    for (const it of leaves) {
      assert.ok(it.name, 'an item has no name');
      assert.ok(typeof it.request?.method === 'string' && /^[A-Z]+$/.test(it.request.method), `${it.name}: request.method`);
      assert.ok(typeof it.request?.url === 'string' || it.request?.url?.raw || it.request?.url?.host, `${it.name}: request.url`);
    }
  });

  await test('HAR startedDateTime is a full ISO-8601 UTC time that round-trips through Date', () => {
    const har = JSON.parse(buildHar(session, events));
    const all = [...har.log.entries.map((e) => e.startedDateTime), ...har.log.pages.map((p) => p.startedDateTime)];
    assert.ok(all.length > 0, 'no startedDateTime at all');
    for (const t of all) {
      assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `not ISO: ${t}`);
      assert.equal(new Date(t).toISOString(), t, `does not round-trip: ${t}`);
    }
  });

} finally {
  await context.close(); // only ours

  console.log('\nlocatorplan.js — the test plan a Playwright agent reads');

  await test('the plan is in playwright-cli\'s documented shape, and says what it cannot prove', () => {
    const copied = [
      ...events,
      {
        kind: 'selectorcopy', ts: T0 + 1000, frameUrl: 'https://example.gov/apply',
        copied: "page.getByLabel('User')",
        flavours: [{ name: 'playwright', expr: "page.getByLabel('User')", matches: 1, unique: true }],
        matches: 1, ambiguous: false, tag: 'input', role: 'textbox', text: 'User',
        credRef: { name: 'LOGIN_PASSWORD' },
      },
      {
        kind: 'selectorcopy', ts: T0 + 2000, frameUrl: 'https://example.gov/done',
        copied: "page.getByRole('heading', { name: 'Thanks' })",
        flavours: [{ name: 'playwright', expr: "page.getByRole('heading', { name: 'Thanks' })", matches: 1, unique: true }],
        matches: 1, ambiguous: false, tag: 'h1', role: 'heading', text: 'Thanks',
        intent: 'assert', expected: { visible: true, text: 'Thanks' },
      },
      {
        kind: 'selectorcopy', ts: T0 + 3000, frameUrl: 'https://example.gov/done',
        copied: "page.getByText('secret-should-not-leak')",
        flavours: [{ name: 'playwright', expr: "page.getByText('secret-should-not-leak')", matches: 1, unique: true }],
        matches: 1, tag: 'div', text: '••••••••', maskedSource: true,
      },
    ];
    const md = buildTestPlan({ ...session, masked: 1 }, copied);

    // The four headings the Plan stage looks for.
    assert.ok(md.includes('## Application Overview'), 'no Application Overview');
    assert.ok(md.includes('## Test Scenarios'), 'no Test Scenarios');
    assert.ok(md.includes('**Seed:** `tests/seed.spec.ts`'), 'no seed reference');
    assert.match(md, /\*\*File:\*\* `tests\/[a-z0-9-]+\/[a-z0-9-]+\.spec\.ts`/, 'no scenario file name');
    assert.ok(md.includes('**Steps:**'), 'no steps');

    // An assert pick becomes an expect bullet; that is the entire point.
    assert.ok(md.includes('- expect: '), 'the assert pick produced no expectation');
    assert.ok(md.includes('“Thanks”'), 'the expected text is missing');

    // Two pages walked, two scenario groups, in walk order.
    assert.ok(md.indexOf('### 1. /apply') < md.indexOf('### 2. /done'), 'the walk order was not kept');

    // A credential name travels; a value never exists to travel.
    assert.ok(md.includes('process.env.LOGIN_PASSWORD'), 'the credential name was dropped');

    // The masked pick is absent, and the redaction is stated rather than hidden.
    assert.ok(!md.includes('secret-should-not-leak'), 'a masked pick leaked into the plan');
    assert.ok(md.includes('**Redacted.**'), 'the plan does not say something was withheld');

    // The seed test is runnable as written.
    assert.ok(md.includes("import { test } from '@playwright/test';"), 'no seed test');
  });

  await test('a walk with no assert picks refuses to pretend it is a check', () => {
    const copied = [...events, {
      kind: 'selectorcopy', ts: T0 + 1000, frameUrl: 'https://example.gov/apply',
      copied: "page.getByRole('button')",
      flavours: [{ name: 'playwright', expr: "page.getByRole('button')", matches: 1, unique: true }],
      tag: 'button', role: 'button', text: 'Submit',
    }];
    const md = buildTestPlan(session, copied);
    assert.ok(md.includes('No expected outcomes were recorded'),
      'a plan with nothing to check reads as if it were a test suite');
    assert.ok(!md.includes('- expect: '), 'an expectation was invented that no tester made');
  });

  await test('the locator sheet sorts every pick under what it was picked for, and leaks nothing', () => {
    const pick = (ts, extra) => ({
      kind: 'selectorcopy', ts: T0 + ts, frameUrl: 'https://example.gov/apply',
      flavours: [{ name: 'playwright', expr: extra.copied, copied: true, unique: true, matches: 1 }],
      ...extra,
    });
    const copied = [
      ...events,
      pick(1000, { purpose: 'step', copied: "page.getByLabel('National number')", label: 'National number',
        tag: 'input', role: 'textbox', elementId: 'nid', classes: 'form-control lg' }),
      pick(2000, { purpose: 'sensitive', copied: "page.getByLabel('Password')", label: 'Password',
        tag: 'input', role: 'textbox', text: '••••••', credRef: { name: 'LOGIN_PASSWORD' } }),
      pick(3000, { purpose: 'element', copied: "page.getByRole('heading')", label: 'Thanks', tag: 'h1',
        role: 'heading', text: 'Thanks', intent: 'assert', expected: { visible: true, text: 'Thanks' } }),
      // No purpose at all: a session from before purposes existed.
      pick(4000, { copied: "page.getByRole('link')", label: 'Home', tag: 'a', role: 'link', text: 'Home' }),
      pick(5000, { purpose: 'step', copied: "page.getByText('secret-should-not-leak')", tag: 'td',
        text: '••••••', maskedSource: true }),
    ];
    const md = buildLocatorSheet({ ...session, masked: 1 }, copied);

    // Four headings, in the order a script author reads them.
    const at = (h) => md.indexOf(h);
    assert.ok(at('## Steps of the flow (1)') > 0, 'no Steps heading, or the masked step was counted');
    assert.ok(at('## Steps of the flow') < at('## Elements to account for'), 'purposes out of order');
    assert.ok(at('## Elements to account for') < at('## Sensitive values'), 'purposes out of order');
    assert.ok(at('## Sensitive values') < at('## Uncategorised'), 'a pick with no purpose has no home');

    // What Nader asked for by name: label, id, class.
    assert.ok(md.includes('**Label:** National number'), 'no label');
    assert.ok(md.includes('**ID:** `#nid`'), 'no id');
    assert.ok(md.includes('**Class:** `.form-control .lg`'), 'no class');

    // Walk-order numbers survive the sort: Password was picked second.
    assert.ok(md.includes('### 2. Password'), 'the walk order was lost when the picks were sorted');

    // The purposes that carry something extra carry it.
    assert.ok(md.includes('**Expected:**'), 'an element pick has no expected outcome');
    assert.ok(md.includes('process.env.LOGIN_PASSWORD'), 'a sensitive pick lost its credential name');
    assert.ok(!md.includes('**Text:** •'), 'a withheld text is printed as a row of bullets');

    // Masked: absent, and said to be.
    assert.ok(!md.includes('secret-should-not-leak'), 'a masked pick leaked into the sheet');
    assert.ok(md.includes('**Redacted.**'), 'the sheet does not say something was withheld');
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
