/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-067: a contract test over the retained formats, on one hostile session, judged by parsers that
 * share no code with the writers: a strict XML reader (tools/lib-xml-strict.mjs), JSON.parse, the
 * HAR 1.2 and Postman v2.1 required keys, an unzip that reads the central directory, and the
 * TypeScript compiler for the Playwright spec.   node tools/test-formats-contract.mjs
 *
 * T-049 closes the three that had no independent reader: Markdown and GitHub Markdown go through
 * `marked` (a dev-only CommonMark/GFM parser, devDependency, never shipped), and every Jira ADF
 * document the product can build goes through tools/lib-adf-strict.mjs, which holds Atlassian's
 * node-type list.
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { marked } from 'marked';
import { parseXml } from './lib-xml-strict.mjs';
import { validateAdf } from './lib-adf-strict.mjs';
import { readZipBuffer } from './lib-zip.mjs';
import { buildText, buildHtml, buildJunit, buildHar, buildYaml, yamlValue, GZIP_FORMATS, shouldGzipExport, gzipText, stripControl } from '../core/exporters.js';
import { buildMarkdown, buildJson, buildSessionSheet } from '../core/artifact-docs.js';
import { buildPlaywrightSpec, reproSteps } from '../core/artifact.js';
import { scanOutbound } from '../core/secret-scan-text.js';
import { toJira } from '../core/formats.js';
import { textToAdf } from '../core/adf.js';
import { defectToAdf, testCaseToAdf, defectToMarkdown, testCaseToMarkdown } from '../core/istqb-render.js';
import { buildDefectReport, buildTestCase } from '../core/istqb.js';
import { toMarkdownIssue } from '../core/formats-export.js';
import { buildTestSuite, suiteToMarkdown } from '../core/suite.js';
import { buildPostmanCollection, buildPostmanEnvironment } from '../core/postman.js';
import { buildSessionWorkbook } from '../core/sheets.js';
import { PRODUCT } from '../core/product.js';
import { buildSeedSpec } from '../core/locatorplan.js';
import { loadDocFonts, fenceFor, oneLine, mdEsc } from '../core/docshell.js';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { FORMATS, KEEP_FORMATS } from '../core/filing.js';
import { PRESETS, presetFormats, buildBundleZip, exportSlug } from '../core/presets.js';

await loadDocFonts();
let failed = 0, passed = 0;
const test = async (n, f) => { try { await f(); passed++; console.log(`  ok  ${n}`); } catch (e) { failed++; console.log(`  FAIL ${n}\n       ${e.message}`); } };

const T0 = 1_700_000_000_000;
const ESC = '\u001b', NUL = '\u0000';
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const URL0 = 'https://example.gov/apply';
const session = {
  id: 's_contract', startedAt: T0, endedAt: T0 + 20_000, startUrl: URL0, status: 'stopped',
  charter: `Hostile $& charter <b>&"quote"${ESC} با اسم عربي`,
  env: { viewport: '1280x800', userAgent: 'Mozilla/5.0 Chrome/126.0.0.0', platform: 'Win32', language: 'ar-JO' },
};
const click = { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Send | "now" <x>', locator: "getByRole('button', { name: 'Send \"now\" \\\\ it\\'s', exact: true })", framePrefix: '', frameUrl: URL0, tag: 'button' };
const events = [
  { kind: 'nav', ts: T0 + 100, url: URL0, frameUrl: URL0 },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'a|b <i>&', label: 'اسم المستخدم', locator: "getByLabel('اسم المستخدم')", framePrefix: '', frameUrl: URL0, tag: 'input' },
  click,
  { kind: 'net', ts: T0 + 3300, method: 'POST', url: '/api/login?access_token=abc123SECRETxyz', status: 500, durationMs: 300, error: false, responsePreview: `{"e":"x${NUL}y"}`, frameUrl: URL0 },
  { kind: 'net', ts: T0 + 3400, method: 'GET', url: '/api/profile', status: 503, durationMs: 120, error: false, responsePreview: 'down', frameUrl: URL0 },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: `Boom ${ESC}[31mred${ESC}[0m`, frameUrl: URL0 },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'ملاحظة: يفشل الإرسال دائماً' },
];
const captures = {};
// An Arabic-majority session: the exported documents follow their content (T-053), so this one must come out rtl.
const arSession = { ...session, charter: 'اختبار تقديم الطلب بوثيقة منتهية الصلاحية في بوابة الخدمات الحكومية' };
const arEvents = [
  { kind: 'nav', ts: T0 + 100, url: URL0, frameUrl: URL0 },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'محمد', label: 'اسم المستخدم', locator: "getByLabel('اسم المستخدم')", framePrefix: '', frameUrl: URL0, tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'إرسال الطلب', locator: "getByRole('button', { name: 'إرسال الطلب' })", framePrefix: '', frameUrl: URL0, tag: 'button' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'ملاحظة: يفشل الإرسال دائماً عند رفع الوثيقة المنتهية الصلاحية ولا تظهر رسالة خطأ للمستخدم' },
  { kind: 'note', ts: T0 + 4500, tag: 'bug', text: 'تتكرر المشكلة في كل مرة يضغط فيها المستخدم على زر الإرسال بعد تعبئة النموذج كاملاً' },
];

await test('JUnit is well-formed XML 1.0 (no control characters, no bare ampersands)', () => {
  const els = parseXml(buildJunit(session, events));
  assert.equal(els[0].name, 'testsuites');
});
await test('JUnit keeps every failure: the failures attribute equals the failing test cases, and the body names each chain', () => {
  const xml = buildJunit(session, events);
  const els = parseXml(xml);
  const cases = els.filter((e) => e.name === 'testcase');
  const failing = cases.filter((c) => els.some((f) => f.name === 'failure' && els[f.parent] === c));
  const suite = els.find((e) => e.name === 'testsuite');
  assert.equal(+suite.attrs.tests, cases.length);
  assert.equal(+suite.attrs.failures, failing.length);
  const text = els.filter((e) => e.name === 'failure').map((f) => `${f.attrs.message} ${f.text}`).join('\n');
  for (const needle of ['POST /api/login', 'GET /api/profile', 'Boom']) assert.ok(text.includes(needle), `JUnit lost "${needle}"`);
  assert.ok(!C0.test(xml), 'a control character survived into the XML');
});

await test('HAR carries the HAR 1.2 required keys and parses', () => {
  const har = JSON.parse(buildHar(session, events));
  assert.equal(har.log.version, '1.2');
  assert.ok(har.log.creator.name && har.log.creator.version !== undefined);
  assert.ok(har.log.entries.length >= 2);
  for (const e of har.log.entries) {
    for (const k of ['startedDateTime', 'time', 'request', 'response', 'cache', 'timings']) assert.ok(k in e, `entry lacks ${k}`);
    for (const k of ['method', 'url', 'httpVersion', 'cookies', 'headers', 'queryString', 'headersSize', 'bodySize']) assert.ok(k in e.request, `request lacks ${k}`);
    for (const k of ['status', 'statusText', 'httpVersion', 'cookies', 'headers', 'content', 'redirectURL', 'headersSize', 'bodySize']) assert.ok(k in e.response, `response lacks ${k}`);
    assert.ok(Number.isFinite(Date.parse(e.startedDateTime)));
    for (const k of ['send', 'wait', 'receive']) assert.ok(k in e.timings, `timings lacks ${k}`);
  }
});

await test('the HTML report of an Arabic session is rtl, lang ar, and the hostile text is escaped', () => {
  const html = buildHtml(arSession, arEvents, captures, {});
  assert.match(html, /<html lang="ar" dir="rtl"/);
  assert.ok(!html.includes('<b>&"quote"'), 'the charter markup reached the page raw');
  assert.ok(!/<(?:script|img)[^>]*onerror/i.test(html));
  assert.ok(!C0.test(html), 'a control character survived into the HTML');
});

await test('Raw JSON parses and holds the Arabic note intact', () => {
  const doc = JSON.parse(buildJson(session, events, captures));
  assert.ok(JSON.stringify(doc).includes('يفشل الإرسال'));
});

await test('Markdown, GitHub and Jira text, through the export cut, hold no control character and keep the Arabic note', () => {
  assert.ok(readFileSync(new URL('../background/export-build.js', import.meta.url), 'utf8').includes('stripControl(out.content)'), 'buildExport no longer cuts control characters');
  for (const [n, t] of [['markdown', stripControl(buildMarkdown(session, events, captures))], ['github', stripControl(toMarkdownIssue(session, events))], ['jira', stripControl(toJira(session, events))]]) {
    assert.ok(!C0.test(t), `${n} carries a control character`);
    assert.ok(t.includes('يفشل الإرسال'), `${n} lost the Arabic note`);
  }
  const gh = toMarkdownIssue(session, events);
  assert.equal((gh.match(/^```/gm) || []).length % 2, 0, 'GitHub issue has an unbalanced code fence');
});

await test('the Playwright spec compiles (TypeScript parser, no syntax error)', () => {
  const out = ts.transpileModule(buildPlaywrightSpec(session, events), { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const bad = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  assert.deepEqual(bad, []);
});

await test('Postman: collection variables use the schema enum, the id is a stable UUID, the environment marks the secret', () => {
  const withAuth = [...events, { kind: 'net', ts: T0 + 3500, method: 'GET', url: '/api/me', status: 200, durationMs: 50, error: false, reqHeaders: { Authorization: '«redacted»' }, frameUrl: URL0 }];
  const a = buildPostmanCollection({ ...session, version: '3.4.0' }, withAuth);
  const b = buildPostmanCollection({ ...session, version: '3.4.0' }, withAuth);
  assert.match(a.info.schema, /v2\.1\.0/);
  assert.ok(a.variable.length >= 1);
  for (const v of a.variable) assert.ok(['string', 'boolean', 'any', 'number'].includes(v.type), `variable ${v.key} has type ${v.type}`);
  assert.match(a.info._postman_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a.info._postman_id, b.info._postman_id);
  JSON.parse(JSON.stringify(a));
  const env = buildPostmanEnvironment({ ...session, version: '3.4.0' }, withAuth);
  assert.ok(env.values.every((v) => ['default', 'secret'].includes(v.type)));
  assert.ok(env.values.some((v) => v.key === 'token' && v.type === 'secret'), 'the token is not marked secret in the environment');
});

await test('the session workbook unzips, every part is well-formed XML, and an Arabic session opens right-to-left', () => {
  const zip = readZipBuffer(buildSessionWorkbook(arSession, arEvents));
  const names = [...zip.entries.keys()];
  for (const must of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) assert.ok(names.includes(must), `no ${must}`);
  for (const n of names.filter((x) => /\.(xml|rels)$/.test(x))) parseXml(zip.entries.get(n).data().toString('utf8'));
  assert.ok(zip.entries.get('xl/worksheets/sheet1.xml').data().toString('utf8').includes('rightToLeft="1"'));
});

await test('gzip is never applied to what is dragged straight into a tool (HAR, Postman, agent brief)', () => {
  for (const id of ['har', 'postman', 'postman-env', 'agent']) assert.ok(!GZIP_FORMATS.includes(id), `${id} must stay plain`);
  assert.equal(shouldGzipExport('har', 'x'.repeat(300_000)), false);
  assert.equal(shouldGzipExport('json', 'x'.repeat(300_000)), true);
});
await test('a gzipped export is a real gzip (Node zlib reads it back)', async () => {
  const text = JSON.stringify({ a: 'ع'.repeat(5000) });
  assert.equal(zlib.gunzipSync(Buffer.from(await gzipText(text))).toString('utf8'), text);
});

await test('five presets, each naming only kept formats, each with an English and an Arabic name', () => {
  assert.equal(Object.keys(PRESETS).length, 5);
  const en = JSON.parse(readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  for (const id of Object.keys(PRESETS)) {
    assert.ok(presetFormats(id).length >= 1, id);
    for (const f of presetFormats(id)) { assert.ok(FORMATS[f], `${id}: ${f} is not a format`); assert.ok(KEEP_FORMATS.includes(f), `${id}: ${f} is not retained`); }
    for (const k of [`report.preset.${id}`, `report.preset.${id}.hint`]) { assert.ok(en[k], `en lacks ${k}`); assert.ok(ar[k], `ar lacks ${k}`); }
  }
});

await test('the bundle is a zip of exactly the parts and screenshots given, text intact, names unique', () => {
  const parts = [
    { filename: 'report.md', content: buildMarkdown(session, events, {}) },
    { filename: 'session.json', content: buildJson(session, events, {}) },
    { filename: 'sheet.xlsx', encoding: 'base64', content: Buffer.from(buildSessionWorkbook(session, events)).toString('base64') },
    { filename: 'report.md', content: 'same name twice' },
  ];
  const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64');
  const zip = readZipBuffer(buildBundleZip({ parts, screenshots: [{ name: 'shot-1.png', dataUrl: png }, { name: 'bad', dataUrl: null }] }));
  const names = [...zip.entries.keys()].sort();
  assert.deepEqual(names, ['Screenshots/shot-1.png', 'report (2).md', 'report.md', 'session.json', 'sheet.xlsx']);
  assert.equal(zip.entries.get('report.md').data().toString('utf8'), parts[0].content);
  assert.deepEqual([...zip.entries.get('Screenshots/shot-1.png').data()], [137, 80, 78, 71]);
  readZipBuffer(zip.entries.get('sheet.xlsx').data()); // a workbook inside a bundle is still a zip
});

await test('a bundle always carries the checksummed session card, never itself, and an Arabic title still gets a clean file name (T-067 fault 11)', async () => {
  const { bundleIds, bundleFilename } = await import('../core/presets.js');
  assert.deepEqual(bundleIds(['markdown', 'bundle', 'markdown']), ['markdown', 'json', 'session-manifest']);
  assert.ok(bundleIds([]).includes('session-manifest') && bundleIds(undefined).includes('json'));
  const at = Date.UTC(2026, 8, 30, 12, 0, 0);
  assert.equal(bundleFilename('Login smoke', at), 'qaw-bundle-login-smoke-2026-09-30T12-00-00.zip');
  assert.equal(bundleFilename('فحص تسجيل الدخول', at), 'qaw-bundle-فحص-تسجيل-الدخول-2026-09-30T12-00-00.zip', 'D-122: an Arabic charter keeps its name');
  assert.equal(bundleFilename('!!! ???', at, 's_ab12cd34ef'), 'qaw-bundle-sab12cd3-2026-09-30T12-00-00.zip', 'D-122: nothing left falls back to the short session id');
  assert.equal(exportSlug('A  --  B', 's1'), 'a-b', 'D-122: runs collapse to one hyphen');
  assert.ok(!bundleFilename('', at).includes('--'));
  const src = readFileSync(new URL('../background/export-build.js', import.meta.url), 'utf8');
  assert.match(src, /bundleIds\(parts\)/);
  assert.match(src, /filename: bundleFilename\(session\.charter, session\.startedAt, session\.id\)/);
});

/* ── T-049: the three formats that had no independent parser ─────────────── */

const walkTokens = (toks, f) => {
  for (const t of toks) {
    f(t);
    if (t.tokens) walkTokens(t.tokens, f);
    if (t.items) walkTokens(t.items, f);
    if (t.type === 'table') { for (const c of t.header) walkTokens(c.tokens, f); for (const r of t.rows) for (const c of r) walkTokens(c.tokens, f); }
  }
};
// the tags the hostile fixture itself carries, read from the fixture, not typed (R16)
const fixtureTags = new Set(JSON.stringify([session, events]).match(/<\/?[a-z][^<>]*>/gi) || []);
const STAMP = /^<!-- qaw1:[^>]*-->\s*$/;

await test('Markdown and GitHub Markdown parse in an independent GFM parser: headings and lists found, every table square, no fence left open, the Arabic note kept', () => {
  assert.ok(fixtureTags.size >= 2, 'the fixture lost its hostile tags, so this test no longer looks at them');
  for (const [n, md, heads] of [['markdown', buildMarkdown(session, events, captures), 5], ['github', toMarkdownIssue(session, events), 3]]) {
    const toks = marked.lexer(md, { gfm: true });
    const kinds = {};
    walkTokens(toks, (t) => { kinds[t.type] = (kinds[t.type] || 0) + 1; });
    assert.ok((kinds.heading || 0) >= heads, `${n}: ${kinds.heading || 0} headings, wanted ${heads}`);
    assert.ok(kinds.list >= 1 && kinds.table >= 1, `${n}: no list or no table was parsed (${JSON.stringify(kinds)})`);
    for (const t of toks.filter((x) => x.type === 'table')) {
      for (const r of t.rows) assert.equal(r.length, t.header.length, `${n}: a table row has ${r.length} cells under a ${t.header.length}-cell header (an unescaped pipe)`);
    }
    const html = marked.parse(md, { gfm: true });
    assert.ok(!html.includes('```'), `${n}: a code fence was left open and printed literally`);
    assert.ok(html.replace(/<[^>]+>/g, '').includes('يفشل الإرسال'), `${n}: the Arabic note did not reach the rendered text`);
    // nothing active: the parser may see markup from the fixture (counted below), never a script or an event handler
    assert.ok(!/<script|\son\w+\s*=/i.test(md), `${n}: active markup in the output`);
  }
});

await test("Markdown and GitHub Markdown: raw HTML reaches the parser only as the provenance stamp or as the fixture's own tags (counted, not hidden)", () => {
  const seen = {};
  for (const [n, md] of [['markdown', buildMarkdown(session, events, captures)], ['github', toMarkdownIssue(session, events)]]) {
    const own = [];
    walkTokens(marked.lexer(md, { gfm: true }), (t) => {
      if (t.type !== 'html') return;
      const raw = t.raw.trim();
      if (STAMP.test(raw)) return;
      if (fixtureTags.has(raw)) { own.push(raw); return; }
      assert.fail(`${n}: raw HTML the fixture did not carry: ${raw.slice(0, 60)}`);
    });
    seen[n] = own.length;
  }
  console.log(`       known (T-049 log): the fixture's own tags are passed through unescaped: ${JSON.stringify(seen)}`);
});

// A document Jira would refuse, one fault per line: the reader has to find each, or it proves nothing (R15).
await test('the ADF reader finds the faults Jira refuses (a known-bad document is flagged, a known-good one is not)', () => {
  const para = (...c) => ({ type: 'paragraph', content: c });
  const good = { type: 'doc', version: 1, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] }, para({ type: 'text', text: 'x', marks: [{ type: 'strong' }] }), { type: 'bulletList', content: [{ type: 'listItem', content: [para({ type: 'text', text: 'i' })] }] }] };
  assert.deepEqual(validateAdf(good), []);
  const broken = { type: 'doc', version: 1, content: [
    { type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'h' }] },
    para({ type: 'text', text: '' }),
    para({ type: 'text', text: 'c', marks: [{ type: 'code' }, { type: 'strong' }] }),
    { type: 'listItem', content: [para({ type: 'text', text: 'loose' })] },
    { type: 'bulletList', content: [] },
    { type: 'sparkle', content: [] },
    para({ type: 'text', text: `bell${String.fromCharCode(7)}` }),
  ] };
  const found = validateAdf(broken).join('\n');
  for (const re of [/heading level 9/, /empty text node/, /code mark beside another/, /listItem is not a top-level/, /bulletList needs at least 1/, /unknown node type "sparkle"/, /control character/]) assert.match(found, re);
});

// Completion review 6: the four ADF faults the reader found are fixed, so the table is empty; a new known fault is a fault.
const KNOWN_ADF = {};

await test('every Jira ADF document the product builds from the hostile session passes the strict reader (known faults counted against a ceiling)', () => {
  // the product feeds textToAdf the export-cut text (background/export-build.js stripControl), so the test does too
  const md = stripControl(buildMarkdown(session, events, captures));
  const docs = {
    'textToAdf(Markdown)': textToAdf(md),
    'textToAdf(GitHub)': textToAdf(stripControl(toMarkdownIssue(session, events))),
    'defectToAdf': defectToAdf(buildDefectReport(session, events)),
    'testCaseToAdf': testCaseToAdf(buildTestCase(session, events)),
  };
  const kinds = new Set();
  const collect = (n) => { kinds.add(n.type); (n.content || []).forEach(collect); };
  Object.values(docs).forEach(collect);
  for (const k of ['paragraph', 'heading', 'table', 'tableHeader', 'tableCell', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'panel']) assert.ok(kinds.has(k), `the documents no longer contain a ${k}, so the reader never looked at one`);
  for (const [name, doc] of Object.entries(docs)) {
    const known = KNOWN_ADF[name];
    const faults = validateAdf(doc);
    const expected = known ? faults.filter((f) => known.re.test(f)) : [];
    const rest = faults.filter((f) => !expected.includes(f));
    assert.deepEqual(rest, [], `${name}: ${rest.slice(0, 3).join(' | ')}`);
    if (known) {
      assert.ok(expected.length <= known.max, `${name}: ${expected.length} known faults, ceiling ${known.max}`);
      console.log(`       known (T-049 log): ${name} has ${expected.length} x ${known.re.source}: ${known.why}`);
    }
  }
});

const specBody = (src) => src.split('\n').filter((l) => !/^import\s/.test(l)).join('\n').replace(/^export\s+/gm, '');

await test('11-1 spec: a newline in a charter, a fill value or a console text cannot break or inject code', () => {
  const LS = String.fromCharCode(0x2028);
  const hostile = {
    ...session,
    charter: `First line\nsecond 'line'\rthird${LS}fourth`,
  };
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: URL0 },
    { kind: 'dom', ts: T0 + 2000, action: 'input', value: `line one\nline two${LS}end`, label: 'Notes', locator: "getByLabel('Notes')", framePrefix: '', tag: 'textarea' },
    { kind: 'dom', ts: T0 + 2500, action: 'click', label: `bad\nlabel`, locatorMatches: 0, tag: 'button' },
    { kind: 'console', ts: T0 + 3000, level: 'error', text: 'boom\nawait page.evaluate(()=>1);', frameUrl: URL0 },
  ];
  const src = buildPlaywrightSpec(hostile, evs);
  // The spec is TypeScript/ESM; vm.Script parses it once the import line is gone.
  assert.doesNotThrow(() => new vm.Script(`(async()=>{ ${specBody(src).replace(/^test\(/m, 'void (')}`.replace(/\}\);\s*$/, '}); })'), { filename: 'spec.js' }), 'the spec does not parse');
  assert.ok(!src.includes(LS), 'a raw U+2028 reached the spec');
  const live = src.split('\n').filter((l) => !/^\s*\/\//.test(l));
  assert.ok(!live.some((l) => l.includes('await page.evaluate(()=>1);')), 'a console text became a live line');
  const comment = src.split('\n').find((l) => l.includes('boom'));
  assert.ok(/^\s*\/\//.test(comment), 'the console text is not on a comment line');
});

await test('11-2 spec: checkbox, radio and select steps use check/uncheck/selectOption, never fill', () => {
  const dom = (extra) => ({ kind: 'dom', ts: T0 + 1000, framePrefix: '', locator: "getByRole('x')", ...extra });
  const evs = [
    dom({ action: 'change', value: 'checked', tag: 'input', control: 'checkbox' }),
    dom({ action: 'change', value: 'unchecked', tag: 'input', control: 'checkbox' }),
    dom({ action: 'change', value: 'checked', tag: 'input', control: 'radio' }),
    dom({ action: 'change', value: 'Opt A', tag: 'select', control: 'select' }),
    // Old sessions carry no control: it is inferred.
    dom({ action: 'change', value: 'checked', tag: 'input' }),
    dom({ action: 'change', value: 'Opt B', tag: 'select' }),
    dom({ action: 'input', value: 'hello', tag: 'input' }),
  ];
  const lines = buildPlaywrightSpec(session, evs).split('\n').filter((l) => /^\s*await /.test(l));
  assert.equal(lines.filter((l) => l.includes('.fill(')).length, 1, 'only the text input may use fill()');
  assert.ok(lines.some((l) => l.includes('.uncheck()')));
  assert.equal(lines.filter((l) => l.includes('.check()')).length, 3);
  assert.equal(lines.filter((l) => l.includes(".selectOption({ label: ")).length, 2);
});

await test('r10-05-1 spec: a recorded modifier replays as press("Shift+Enter") and click({ modifiers })', () => {
  const dom = (extra) => ({ kind: 'dom', ts: T0 + 1000, framePrefix: '', locator: "getByRole('x')", tag: 'button', ...extra });
  const evs = [
    dom({ action: 'keydown', key: 'Shift+Enter', tag: 'textarea' }),
    dom({ action: 'click', button: 0, mods: ['Shift'] }),
    dom({ action: 'click', button: 2, mods: ['Control', 'Meta'] }),
    dom({ action: 'dblclick', button: 0, mods: ['Alt', "x'); evil()"] }),
    dom({ action: 'click', button: 0, mods: [] }),
  ];
  const src = buildPlaywrightSpec(session, evs);
  const lines = src.split('\n').filter((l) => /^\s*await /.test(l));
  assert.ok(lines.some((l) => l.includes(".press('Shift+Enter')")));
  assert.ok(lines.some((l) => l.includes(".click({ modifiers: ['Shift'] })")));
  assert.ok(lines.some((l) => l.includes(".click({ button: 'right', modifiers: ['Control', 'Meta'] })")));
  assert.ok(lines.some((l) => l.includes(".dblclick({ modifiers: ['Alt'] })")), 'only the four known modifier names survive');
  assert.ok(!src.includes('evil()'));
  assert.ok(lines.some((l) => l.endsWith('.click();')), 'a plain click has no options');
  assert.equal(ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).diagnostics.length, 0);
  assert.ok(buildMarkdown(session, evs).includes('Shift+Click'), 'the document step names the modifier');
});

await test('11-5 Markdown: a body containing a closing fence plus markdown stays inside one code block', () => {
  assert.equal(fenceFor('x'), '```');
  assert.equal(fenceFor('a ``` b'), '````');
  assert.equal(fenceFor('``````'), '```````');
  const payload = '[y](http://evil.example)';
  const body = '{"a":1}\n```\n# x ' + payload + '\n';
  const evs = [
    { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'Go', locator: "getByRole('button')", framePrefix: '', tag: 'button' },
    { kind: 'net', ts: T0 + 1300, method: 'POST', url: '/api/x', status: 500, durationMs: 10, error: false, responsePreview: body, stack: 'at a\n```\n# s ' + payload },
  ];
  for (const [name, md] of [['defect report', defectToMarkdown(buildDefectReport(session, evs))], ['session report', buildMarkdown(session, evs, {})]]) {
    const toks = marked.lexer(md);
    const code = toks.filter((t) => t.type === 'code').map((t) => t.text).join('\n');
    assert.ok(code.includes(payload), `${name}: the payload did not stay in a code block`);
    const hrefs = [];
    marked.walkTokens(toks.filter((t) => t.type !== 'code'), (t) => { if (t.type === 'link' && t.href) hrefs.push(t.href); });
    assert.ok(!hrefs.some((h) => h.includes('evil.example')), `${name}: the payload became a live link`);
  }
});

await test('r3-11-1 a hand-sent (via:api) event is a normal HAR entry: Content-Type key, postData.text, response content', () => {
  const apiEvent = {
    kind: 'net', via: 'api', ts: T0 + 500, method: 'POST', url: 'https://example.test/api/echo', status: 200, ok: true, durationMs: 12,
    reqHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Trace', value: '1' }],
    reqBody: '{"a":1}',
    resHeaders: [{ name: 'content-type', value: 'application/json' }],
    resBody: '{"ok":true}',
  };
  const e = JSON.parse(buildHar(session, [apiEvent])).log.entries[0];
  assert.ok(e.request.headers.some((h) => h.name === 'Content-Type' && h.value === 'application/json'), `request headers: ${JSON.stringify(e.request.headers)}`);
  assert.ok(!e.request.headers.concat(e.response.headers).some((h) => /^\d+$/.test(h.name) || h.value === '[object Object]'), 'no array-index header names');
  assert.equal(e.request.postData?.text, '{"a":1}', 'raw JSON body in postData.text');
  assert.equal(e.request.postData?.mimeType, 'application/json');
  assert.equal(e.response.content.text, '{"ok":true}', 'resBody becomes the response content');
  assert.equal(e.response.content.mimeType, 'application/json');
});

await test('r3-11-6 selector-engine q() writes LF, CR, U+2028 and U+2029 as \\uXXXX escapes (source slice run in node:vm)', () => {
  const src = readFileSync(new URL('../content/selector-engine.js', import.meta.url), 'utf8');
  const decl = (re, what) => { const m = src.match(re); assert.ok(m, `selector-engine.js: ${what} not found`); return m[0]; };
  const code = [
    decl(/^ {2}const INVISIBLE = .*$/m, 'INVISIBLE'),
    decl(/^ {2}const INVISIBLE_G = .*$/m, 'INVISIBLE_G'),
    decl(/^ {2}const LINE_BREAK_G = .*$/m, 'LINE_BREAK_G'),
    decl(/^ {2}function q\(s\) \{[\s\S]*?\n {2}\}\n/m, 'q()'),
    'q',
  ].join('\n');
  const q = vm.runInNewContext(code);
  const out = q('a\nb\rc' + String.fromCharCode(0x2028) + 'd' + String.fromCharCode(0x2029) + "e'f");
  assert.equal(out, "'a\\u000ab\\u000dc\\u2028d\\u2029e\\'f'");
  assert.ok(![10, 13, 0x2028, 0x2029].some((c) => out.includes(String.fromCharCode(c))), 'a raw line terminator is left');
  assert.equal(q('plain'), "'plain'");
});

/* ── r5-11-1: a YAML list of mappings keeps every key of an item in one column ── */

/** The block under a top-level key, as lines. */
const yamlBlock = (text, key) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(at >= 0, `no ${key}: block`);
  const out = [];
  for (let i = at + 1; i < lines.length && /^ /.test(lines[i]); i++) out.push(lines[i]);
  return out;
};
/** A tiny indentation parser for exactly the shape the exporter writes: `  - k: v` items whose later keys sit two columns in. */
const parseItems = (lines) => {
  const items = [];
  for (const l of lines) {
    const first = /^ {2}- (\w+): (.*)$/.exec(l);
    const more = /^ {4}(\w+): (.*)$/.exec(l);
    if (first) items.push({ [first[1]]: first[2] });
    else if (more && items.length) items.at(-1)[more[1]] = more[2];
    else assert.fail(`line is not at the item column: ${JSON.stringify(l)}`);
  }
  return items;
};
await test('YAML problems and notes: every key of a list item starts in the same column and the block parses', () => {
  const yaml = buildYaml(session, events);
  const problems = parseItems(yamlBlock(yaml, 'problems'));
  assert.ok(problems.length >= 1, 'the hostile session has failing requests');
  for (const p of problems) assert.deepEqual(Object.keys(p), ['what', 'causedBy', 'gapMs', 'confidence', 'locator'], 'an item lost or reordered a key');
  const notes = parseItems(yamlBlock(yaml, 'notes'));
  assert.equal(notes.length, 1);
  assert.deepEqual(Object.keys(notes[0]), ['tag', 'text', 'at']);
  assert.match(notes[0].text, /يفشل الإرسال/);
});
await test('yamlValue: a list of mappings and a list of lists align their keys at indent + 2', () => {
  assert.equal(yamlValue([{ a: 1, b: 'foo' }, { a: 2, b: 'bar' }], 2), '\n  - a: 1\n    b: foo\n  - a: 2\n    b: bar');
  assert.equal(yamlValue([['p', 'q']], 0), '\n- - p\n  - q');
});

/* ── r4-11-6: the HAR entry starts when the request started, not when it ended ── */
await test('HAR startedDateTime is ts minus the duration (clamped to 0..120000), and a missing ts never throws', () => {
  const at = (extra) => JSON.parse(buildHar(session, [{ kind: 'net', method: 'GET', url: '/a', status: 200, frameUrl: URL0, ...extra }])).log.entries[0].startedDateTime;
  assert.equal(at({ ts: 10000, durationMs: 400 }), new Date(9600).toISOString());
  assert.equal(at({ ts: 10000, durationMs: -5 }), new Date(10000).toISOString());
  assert.equal(at({ ts: 1e7, durationMs: 1e9 }), new Date(1e7 - 120000).toISOString());
  assert.ok(Number.isFinite(Date.parse(at({ durationMs: 400 }))), 'no ts: still a valid date');
});

/* ── r4-11-5: the seed spec escapes startUrl as the other specs do ── */
await test('seed spec parses and goes to the exact startUrl even with a backslash, a quote and U+2028 in it', () => {
  const startUrl = `https://e.test/a\\b'c${String.fromCharCode(0x2028)}d`;
  const src = buildSeedSpec({ startUrl }).replace(/^import .*\n/m, '');
  let got = null;
  const script = new vm.Script(src, { filename: 'seed.spec.js' });
  script.runInNewContext({ test: (_n, fn) => fn({ page: { goto: (u) => { got = u; } } }) });
  assert.equal(got, startUrl);
});

/* ── r1-11-1: page-derived text cannot plant a token in any of the four Markdown documents ── */
await test('r1-11-1 Markdown: hostile label, console text, note, URL and locator add no image, link, html, heading or code token to the defect, suite, session report and test case', () => {
  const mk = (h) => {
    const sess = { id: 's_md', startedAt: T0, endedAt: T0 + 20_000, startUrl: h.url, status: 'stopped', charter: 'Check the login', env: { viewport: '1280x800', userAgent: 'Chrome', platform: 'Win32', language: 'en' } };
    const evs = [
      { kind: 'nav', ts: T0 + 100, url: h.url, frameUrl: h.url },
      { kind: 'dom', ts: T0 + 2000, action: 'input', value: h.label, label: h.label, locator: h.locator, framePrefix: '', frameUrl: h.url, tag: 'input' },
      { kind: 'dom', ts: T0 + 3000, action: 'click', label: h.label, locator: h.locator, framePrefix: '', frameUrl: h.url, tag: 'button' },
      { kind: 'net', ts: T0 + 3300, method: 'POST', url: h.url, status: 500, durationMs: 30, error: false, responsePreview: 'down', frameUrl: h.url },
      { kind: 'console', ts: T0 + 3450, level: 'error', text: h.console, frameUrl: h.url },
      { kind: 'note', ts: T0 + 4000, tag: 'bug', text: h.note },
    ];
    return [sess, evs];
  };
  const hostile = {
    label: '#123 owner/repo#5 # h Go ![pwn](http://evil.example/p.png) [click](http://evil.example/l) <img src=x onerror=1>\n# Injected heading\n```js\nalert(1)\n```',
    console: 'boom [x](http://evil.example/c) ![i](http://evil.example/i.png) <script>1</script>\n## Second heading http://evil.example/auto www.evil.example a@evil.example',
    note: 'note [n](http://evil.example/n) ![n](http://evil.example/ni.png)\n---\n<b>bold</b>',
    url: 'https://example.gov/a)[u](http://evil.example/u)![i](http://evil.example/ui)\n# Url heading',
    locator: "getByRole('button', { name: 'x`y``z' })\n# Locator heading | cell",
  };
  const benign = { label: 'Go', console: 'boom', note: 'note', url: 'https://example.gov/a', locator: "getByRole('button', { name: 'x' })" };
  const docs = (h) => {
    const [sess, evs] = mk(h);
    return {
      defect: defectToMarkdown(buildDefectReport(sess, evs)),
      suite: suiteToMarkdown(buildTestSuite(sess, evs)),
      report: buildMarkdown(sess, evs, {}),
      sheet: buildSessionSheet(sess, evs),
      testcase: testCaseToMarkdown(buildTestCase(sess, evs)),
    };
  };
  const census = (md) => {
    const c = {}, links = [];
    walkTokens(marked.lexer(md, { gfm: true }), (t) => {
      if (['heading', 'code', 'image', 'html', 'hr', 'blockquote', 'table'].includes(t.type)) c[t.type] = (c[t.type] || 0) + 1;
      if (t.type === 'link' && t.href) links.push(t.href);
    });
    return { c, links };
  };
  const bad = docs(hostile), good = docs(benign);
  for (const name of Object.keys(bad)) {
    const b = census(bad[name]), g = census(good[name]);
    assert.equal(b.c.image || 0, 0, `${name}: an image token was planted`);
    // the page's own URL may stay clickable (escaped, it still points at the page); no other link may exist
    const own = (h) => h.startsWith('https://example.gov/') || (PRODUCT.homepage && h === PRODUCT.homepage); // the page's own URL and the footer's maker link
    assert.ok(b.links.every(own), `${name}: a link that is not the page's own URL is live: ${b.links.filter((h) => !own(h))}`);
    assert.deepEqual(b.c, g.c, `${name}: the hostile text changed the block structure (headings, code, html, rules, quotes, tables)`);
    // html reaches the parser only as the provenance stamp or the test case's own <br> between action and locator
    walkTokens(marked.lexer(bad[name], { gfm: true }), (t) => { if (t.type === 'html') assert.ok(STAMP.test(t.raw.trim()) || t.raw === '<br>', `${name}: raw html ${t.raw.slice(0, 50)}`); });
  }
});

await test('r10-11-1 mdEsc: #123, owner/repo#5, "# h" and a leading + - = or "1." make no heading, list, rule or link, and no bare #', () => {
  for (const s of ['#123', 'see #123 and owner/repo#5', '# h', '## h', '+ item', '- item', '---', '=== x', '1. item', '12) item', '  - indented', 'GH-9 # Heading + item']) {
    const e = mdEsc(s);
    assert.ok(!/(^|[^\\])#/.test(e), `a bare # survived in ${JSON.stringify(e)}`);
    // line-start (the worst case: nothing before it) and inside a list item and a bold span, the way the builders embed it
    for (const md of [e, `- ${e}`, `1. Click **${e}**`, `> ${e}`]) {
      const types = new Set();
      walkTokens(marked.lexer(md, { gfm: true }), (t) => { if (['heading', 'hr', 'link', 'image', 'code', 'html'].includes(t.type)) types.add(t.type); });
      assert.deepEqual([...types], [], `${JSON.stringify(s)} became ${[...types]} in ${JSON.stringify(md)}`);
    }
    const lead = marked.lexer(e, { gfm: true });
    assert.ok(lead.every((t) => t.type === 'paragraph' || t.type === 'space'), `${JSON.stringify(s)} as a line is not one plain paragraph: ${lead.map((t) => t.type)}`);
  }
  assert.equal(mdEsc('see #123'), 'see \\#123');
  assert.equal(mdEsc('1. item'), '1\\. item');
  assert.equal(mdEsc('mid - dash and a=b and 3.5'), 'mid - dash and a=b and 3.5', 'only a line-start marker is escaped');
});

/* ── r1-11-2 / r1-11-3 / r1-11-4: the Playwright spec is truthful ── */
const specParses = (src) => assert.doesNotThrow(() => new vm.Script(`(async()=>{ ${specBody(src).replace(/^test\(/m, 'void (')}`.replace(/\}\);\s*$/, '}); })'), { filename: 'spec.js' }), 'the spec does not parse');

await test('r1-11-2 spec: no goto after a click-caused or route navigation; goBack and reload replay as themselves', () => {
  const A = 'https://app.test/a', B = 'https://app.test/b';
  const dom = (ts, action, extra = {}) => ({ kind: 'dom', ts: T0 + ts, action, locator: "getByRole('link', { name: 'Next' })", framePrefix: '', tag: 'a', ...extra });
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: A, transition: 'typed' },
    dom(1000, 'click'),
    { kind: 'nav', ts: T0 + 1100, url: B, transition: 'link' },
    { kind: 'nav', ts: T0 + 1200, url: B + '#x', transition: 'link', route: true },
    dom(2000, 'click'),
    { kind: 'nav', ts: T0 + 2100, url: B + '/done', transition: 'link', qualifiers: ['server_redirect'] },
    { kind: 'nav', ts: T0 + 3000, url: A, transition: 'link', qualifiers: ['forward_back'] },
    { kind: 'nav', ts: T0 + 4000, url: A, transition: 'reload' },
    dom(5000, 'submit'),
    { kind: 'nav', ts: T0 + 5100, url: B, transition: 'form_submit' },
    { kind: 'nav', ts: T0 + 6000, url: 'https://app.test/typed', transition: 'typed' },
  ];
  const src = buildPlaywrightSpec(session, evs);
  const gotos = src.split('\n').filter((l) => l.includes('page.goto('));
  assert.deepEqual(gotos.map((l) => l.trim()), [`await page.goto('${A}');`, "await page.goto('https://app.test/typed');"], 'only the typed navigations may be goto');
  assert.ok(src.includes('await page.goBack();'), 'forward_back is not replayed as goBack');
  assert.ok(src.includes('await page.reload();'), 'a reload is not replayed as reload');
  specParses(src);
});

await test('r1-11-3 spec: an assert pick emits expect(locator); no pick keeps a no-assertions comment', () => {
  const dom = { kind: 'dom', ts: T0 + 1000, action: 'click', locator: "getByRole('button', { name: 'Save' })", framePrefix: '', tag: 'button' };
  const pick = (extra) => ({ kind: 'selectorcopy', ts: T0 + 2000, intent: 'assert', copied: "page.getByRole('heading', { name: 'Saved' })", expected: { visible: true, text: 'Saved' }, ...extra });
  const withText = buildPlaywrightSpec(session, [dom, pick({})]);
  assert.ok(withText.includes("await expect(page.getByRole('heading', { name: 'Saved' })).toHaveText('Saved');"), 'text pick');
  assert.ok(!/No assertions/.test(withText));
  const visibleOnly = buildPlaywrightSpec(session, [dom, pick({ expected: { visible: true, text: '' } })]);
  assert.ok(visibleOnly.includes('.toBeVisible();'), 'visible pick');
  const masked = buildPlaywrightSpec(session, [dom, pick({ maskedSource: true })]);
  assert.ok(!masked.includes('toHaveText'), 'a masked element must not assert its words');
  const plainCopy = buildPlaywrightSpec(session, [dom, pick({ intent: 'act' })]);
  assert.ok(!plainCopy.includes('expect('.concat('page')) && /No assertions/.test(plainCopy), 'an act-intent copy is not an assertion');
  const hostileCopy = buildPlaywrightSpec(session, [dom, pick({ copied: "page.locator('a')\nawait page.evaluate(()=>1)" })]);
  assert.ok(!hostileCopy.includes('page.evaluate'), 'a multi-line copied locator reached the spec');
  for (const src of [withText, visibleOnly, masked, plainCopy, hostileCopy]) specParses(src);
});

await test('r1-11-4 spec: each masked field gets its own QAW_SECRET_<LABEL>, numbered on collision, UQA_SECRET as the fallback', () => {
  const secret = (ts, label, locator) => ({ kind: 'dom', ts: T0 + ts, action: 'input', masked: true, label, locator, framePrefix: '', tag: 'input' });
  const evs = [
    secret(1000, 'Password', "getByLabel('Password')"),
    secret(2000, 'Confirm password', "getByLabel('Confirm password')"),
    secret(3000, 'Password', "locator('#pw2')"),
    secret(4000, 'كلمة المرور', "locator('#ar')"),
  ];
  const src = buildPlaywrightSpec(session, evs);
  for (const v of ['QAW_SECRET_PASSWORD', 'QAW_SECRET_CONFIRM_PASSWORD', 'QAW_SECRET_PASSWORD_2', 'QAW_SECRET_FIELD']) {
    assert.ok(src.includes(`process.env.${v} ?? process.env.UQA_SECRET ?? ''`), `${v} missing`);
  }
  assert.equal(new Set(src.match(/process\.env\.QAW_SECRET_\w+/g)).size, 4, 'two masked fields must not share one variable');
  specParses(src);
});



/* ── council-1010 r2: forged locators, URL-query secrets, double submits, a quadratic oneLine ── */

await test('r2-02-1 spec: a hostile locator, framePrefix or copied writes SKIPPED, parses, and carries no require/import(/process.', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: URL0 },
    { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'a', tag: 'button', locator: "getByText('x'); require('fs').readFileSync('/etc/passwd'); //", framePrefix: '' },
    { kind: 'dom', ts: T0 + 2000, action: 'click', label: 'b', tag: 'button', locator: "getByText('y')", framePrefix: "frameLocator('f'); process.exit(1); //." },
    { kind: 'dom', ts: T0 + 3000, action: 'input', label: 'c', tag: 'input', value: 'v', locator: 'getByLabel(`${process.env.HOME}`)', framePrefix: '' },
    { kind: 'selectorcopy', ts: T0 + 4000, intent: 'assert', copied: "page.getByText('z'); import('node:fs'); //", expected: { visible: true } },
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.equal(src.split('\n').filter((l) => l.includes('// SKIPPED: unsafe locator')).length, 4);
  assert.ok(!/require\(|import\(|process\./.test(src), 'hostile code reached the spec');
  specParses(src);
});

await test('r2-11-1 HAR: query values named token, api_key, password, sig or an Arabic secret name are redacted in url and queryString; ?q= is kept', () => {
  const url = '/api/x?q=hello&token=abcDEF123456&api_key=KKKK1234&password=hunter22&sig=Zm9vYmFy&' + encodeURIComponent('كلمة المرور') + '=sirr1234';
  const text = buildHar(session, [{ kind: 'net', method: 'GET', url, status: 200, ts: T0 + 500, frameUrl: URL0 }]);
  const { redacted } = scanOutbound({ har: text });
  for (const v of ['abcDEF123456', 'KKKK1234', 'hunter22', 'Zm9vYmFy', 'sirr1234']) assert.ok(!redacted.har.includes(v) && !text.includes(v), `${v} leaked`);
  const req = JSON.parse(text).log.entries[0].request;
  assert.ok(req.url.includes('q=hello'), req.url);
  assert.ok(req.url.includes('token=' + encodeURIComponent('[REDACTED]')), req.url);
  const qs = Object.fromEntries(req.queryString.map((p) => [p.name, p.value]));
  assert.equal(qs.q, 'hello');
  assert.equal(qs.token, '[REDACTED]');
  assert.equal(qs.api_key, '[REDACTED]');
  assert.equal(qs['كلمة المرور'], '[REDACTED]');
  const plain = JSON.parse(buildHar(session, [{ kind: 'net', method: 'GET', url: '/s?q=a+b&page=2', status: 200, ts: T0 + 500, frameUrl: URL0 }])).log.entries[0].request;
  assert.ok(plain.url.endsWith('/s?q=a+b&page=2'), plain.url);
});

await test('r2-11-1 Postman: the same names become {{name}} in url.raw and url.query, with an empty collection variable', () => {
  const url = 'https://example.gov/api/x?q=hello&token=abcDEF123456&sig=Zm9vYmFy';
  const col = buildPostmanCollection(session, [{ kind: 'net', method: 'GET', url, status: 200, ts: T0 + 500, frameUrl: URL0 }]);
  const text = JSON.stringify(col);
  assert.ok(!text.includes('abcDEF123456') && !text.includes('Zm9vYmFy'), 'a query secret reached the collection');
  assert.ok(col.item[0].request.url.raw.includes('q=hello') && col.item[0].request.url.raw.includes('token={{token}}'), col.item[0].request.url.raw);
  assert.ok(col.variable.some((v) => v.key === 'sig' && v.value === ''));
});

const dsDom = (ts, extra) => ({ kind: 'dom', ts: T0 + ts, label: 'Login', tag: 'button', locator: "getByRole('button', { name: 'Login' })", framePrefix: '', ...extra });
const dsNav = { kind: 'nav', ts: T0 + 100, url: URL0 };
const doing = (src) => src.split('\n').filter((l) => /^\s*await page\..*\.(click|press|fill)\(/.test(l));

await test('r2-05-2 double submit: click+submit, keydown Enter+submit and Enter+click each give one statement and one repro step', () => {
  const submit = dsDom(1100, { action: 'submit', tag: 'form', locator: "locator('form')" });
  const cases = {
    'click + submit': [dsNav, dsDom(1000, { action: 'click' }), submit],
    'keydown Enter + submit': [dsNav, dsDom(1000, { action: 'keydown', key: 'Enter', tag: 'input' }), submit],
    'keydown Enter + click on the same element': [dsNav, dsDom(1000, { action: 'keydown', key: 'Enter' }), dsDom(1100, { action: 'click' })],
  };
  for (const [name, evs] of Object.entries(cases)) {
    const src = buildPlaywrightSpec(session, evs);
    assert.equal(doing(src).length, 1, `${name}: ${doing(src).join(' | ')}`);
    specParses(src);
    assert.equal(reproSteps(evs).length, 2, `${name}: ${reproSteps(evs).join(' | ')}`);
  }
  const apart = [dsNav, dsDom(1000, { action: 'click' }), dsDom(2000, { action: 'submit', tag: 'form', locator: "locator('form')" })];
  assert.equal(doing(buildPlaywrightSpec(session, apart)).length, 2, 'a submit two seconds later is a second action');
  assert.equal(reproSteps(apart).length, 3);
});

await test('r2-07-1 oneLine: 200k spaces and an x take under 50 ms, and normal input comes out as before', () => {
  const t0 = performance.now();
  oneLine(' '.repeat(200000) + 'x');
  assert.ok(performance.now() - t0 < 50, `took ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(oneLine('a  \n  b\r\n\r\nc  d\te'), 'a b c  d\te');
  assert.equal(oneLine('  \n x'), ' x');
  assert.equal(oneLine(null), '');
});

await test('r2-05-8 selector-engine: a test-id value with " or \\ is CSS-escaped before it is quoted for JavaScript (source slice run in node:vm)', () => {
  const src = readFileSync(new URL('../content/selector-engine.js', import.meta.url), 'utf8');
  const decl = (re, what) => { const m = src.match(re); assert.ok(m, `selector-engine.js: ${what} not found`); return m[0]; };
  const line = decl(/^ *: `locator\(.*$/m, 'the data-* test-id expression');
  const expr = line.replace(/^ *: /, '').replace(/,\s*\/\/.*$/, '');
  const code = [
    decl(/^ {2}const INVISIBLE = .*$/m, 'INVISIBLE'),
    decl(/^ {2}const INVISIBLE_G = .*$/m, 'INVISIBLE_G'),
    decl(/^ {2}const LINE_BREAK_G = .*$/m, 'LINE_BREAK_G'),
    decl(/^ {2}function q\(s\) \{[\s\S]*?\n {2}\}\n/m, 'q()'),
    `((attr, v) => ${expr})`,
  ].join('\n');
  const build = vm.runInNewContext(code);
  const hostile = 'a"] , body { x:1 } [b="\\';
  const out = build('data-qa', hostile);
  const css = vm.runInNewContext(out.slice('locator('.length, -1));
  assert.equal(css, '[data-qa="a\\"] , body { x:1 } [b=\\"\\\\"]', 'both the quote and the backslash are escaped inside the CSS string');
  assert.equal(vm.runInNewContext(build('data-qa', 'plain').slice('locator('.length, -1)), '[data-qa="plain"]');
});

/* ── r3-11-1 / D-1010-47 / D-1010-50 / r3-05-7: tabs, scripted steps, extra click kinds, multi-select ── */
const tdom = (ts, action, name, extra = {}) => ({ kind: 'dom', ts: T0 + ts, action, locator: `getByRole('button', { name: '${name}' })`, framePrefix: '', tag: 'button', label: name, ...extra });

await test('r3-11-1 spec: a click that opens a tab becomes waitForEvent("page") and the new tab gets its own page variable; the spec parses', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: 'https://app.test/a', transition: 'typed', tabId: 1 },
    tdom(1000, 'click', 'Open report', { tabId: 1 }),
    { kind: 'nav', ts: T0 + 1100, url: 'https://app.test/r', transition: 'link', tabId: 2 },
    tdom(2000, 'click', 'Print', { tabId: 2 }),
    tdom(3000, 'click', 'Back to list', { tabId: 1 }),
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.match(src, /async \(\{ page, context \}\) =>/, 'the test receives the context');
  assert.match(src, /const \[page2\] = await Promise\.all\(\[context\.waitForEvent\('page'\), page\.getByRole\('button', \{ name: 'Open report' \}\)\.click\(\)\]\);/);
  assert.ok(src.includes("await page2.getByRole('button', { name: 'Print' }).click();"), 'the second tab acts on page2');
  assert.ok(src.includes('await page.bringToFront();') && src.includes("await page.getByRole('button', { name: 'Back to list' }).click();"), 'back to the first tab');
  assert.ok(!src.includes('page2.goto'), 'the tab opened by the click loads by itself');
  specParses(src);
});

await test('r3-11-1 spec: a second tab with no recorded opener is a FIXME and its steps are skipped; a one-tab spec keeps ({ page })', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: 'https://app.test/a', transition: 'typed', tabId: 1 },
    tdom(1000, 'click', 'One', { tabId: 1 }),
    { kind: 'note', ts: T0 + 1500, tag: 'bug', text: 'x' },
    tdom(2000, 'click', 'Two', { tabId: 7 }),
    tdom(3000, 'click', 'Three', { tabId: 7 }),
  ];
  // the opener is the click on 'One' only when nothing else was written after it; a FIXME line breaks that, so add a gap line first
  const src = buildPlaywrightSpec(session, [evs[0], evs[1], { ...tdom(1500, 'upload', 'File', { tabId: 1, value: 'a.pdf', control: 'file' }) }, evs[3], evs[4]]);
  assert.equal(src.split('\n').filter((l) => l.includes('FIXME: actions in a second tab')).length, 1, 'one FIXME per tab');
  assert.ok(!/name: 'Two'|name: 'Three'/.test(src), 'its steps are not replayed against the wrong page');
  assert.ok(!src.includes('waitForEvent'), 'no opener: no waitForEvent');
  specParses(src);
  const one = buildPlaywrightSpec(session, [evs[0], evs[1]]);
  assert.ok(one.includes('async ({ page }) =>') && !one.includes('context'), 'a single-tab spec is unchanged');
});

await test('D-1010-47: a step the page performed by script (trusted false) is not in the spec or the double-submit logic, and is labelled in the repro list', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: 'https://app.test/a', transition: 'typed' },
    tdom(1000, 'click', 'Real', { trusted: true }),
    tdom(1100, 'click', 'Carousel next', { trusted: false }),
    tdom(1200, 'submit', 'Form', { trusted: true, tag: 'form' }),
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.ok(!src.includes('Carousel next'), 'the scripted click is not replayed');
  assert.match(src, /1 step the page performed by its own script was left out/);
  assert.ok(src.includes("name: 'Real'"), 'the real click stays');
  const steps = reproSteps(evs);
  assert.ok(steps.some((x) => x.includes('Carousel next') && x.endsWith('(by the page)')), steps.join(' | '));
  assert.ok(!steps.find((x) => x.includes('Real')).includes('(by the page)'));
  // a scripted click right before a submit is not the click that caused it, so the submit stays its own step
  const mid = [tdom(1000, 'click', 'Pay', { trusted: false }), tdom(1100, 'submit', 'Form', { trusted: true, tag: 'form' })];
  assert.equal(reproSteps(mid).length, 2, 'a scripted click is not the click that caused the submit');
  assert.equal(reproSteps(evs, '(AR)').filter((x) => x.includes('(AR)')).length, 1, 'the label is a parameter (DOC_LABELS.byPage)');
  specParses(src);
});

await test('D-1010-50 / r3-05-7: dblclick replaces its two clicks; right and middle click and a multi-select replay as themselves', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: 'https://app.test/a', transition: 'typed' },
    tdom(1000, 'click', 'Row', { button: 0 }),
    { kind: 'net', ts: T0 + 1050, method: 'GET', url: '/api/x', status: 200 },
    tdom(1100, 'click', 'Row', { button: 0 }),
    tdom(1150, 'dblclick', 'Row', { button: 0 }),
    tdom(3000, 'click', 'Menu', { button: 2 }),
    tdom(4000, 'click', 'Tab', { button: 1 }),
    tdom(5000, 'click', 'Row', { button: 0 }),
    tdom(6000, 'change', 'Colours', { tag: 'select', control: 'select-multiple', value: 'Red\nBlue' }),
  ];
  const src = buildPlaywrightSpec(session, evs);
  const body = src.split('\n').filter((l) => /^\s*(const \[\w+\] = )?await /.test(l));
  assert.equal(body.filter((l) => l.includes("name: 'Row'")).length, 2, 'dblclick once, then one later plain click: ' + body.join(' | '));
  assert.ok(src.includes("name: 'Row' }).dblclick();"));
  assert.ok(src.includes("name: 'Menu' }).click({ button: 'right' });") && src.includes("name: 'Tab' }).click({ button: 'middle' });"));
  assert.ok(src.includes("name: 'Colours' }).selectOption([{ label: 'Red' }, { label: 'Blue' }]);"));
  const steps = reproSteps(evs).join(String.fromCharCode(10));
  assert.match(steps, /Double-click Row/);
  assert.match(steps, /Right-click Menu/);
  assert.match(steps, /Middle-click Tab/);
  assert.match(steps, /Set Colours to `Red, Blue`/);
  assert.equal((steps.match(/Click Row/g) || []).length, 1, 'the two folded clicks are gone from the repro list too');
  specParses(src);
});

/* ── council-1010 round 4, lane 3: exports (r4-04-1, r4-05-2, r4-11-2..6) ── */
const machineNotes = [
  { kind: 'note', ts: T0 + 4100, tag: 'technique', text: 'Technique: designed price#p:valid-in-range price#b:min' },
  { kind: 'note', ts: T0 + 4200, tag: 'capture-gap', text: 'Capture gap: events that could not be stored' },
  { kind: 'note', ts: T0 + 4300, tag: 'split', text: 'Split here' },
  { kind: 'note', ts: T0 + 4400, tag: 'dropped', text: 'MACHINE-DROPPED-NOTE' },
];
const withMachine = [...events, ...machineNotes];

await test('r4-04-1: isTesterNote keeps a tester note (any tag, or none) and drops every machine note', async () => {
  const { isTesterNote } = await import('../core/events.js');
  assert.ok(isTesterNote({ kind: 'note', tag: 'bug', text: 'x' }) && isTesterNote({ kind: 'note', tag: null, text: 'x' }) && isTesterNote({ kind: 'note', text: 'x' }));
  for (const n of machineNotes) assert.ok(!isTesterNote(n), n.tag);
  assert.ok(!isTesterNote({ kind: 'dom' }) && !isTesterNote(null));
});

await test('r4-04-1: no machine note reaches the defect, YAML or session sheet (the raw JSON and the Markdown timeline keep every event by design)', () => {
  const outs = {
    defect: JSON.stringify(buildDefectReport(session, withMachine)),
    yaml: buildYaml(session, withMachine),
    sheet: buildSessionSheet(session, withMachine),
  };
  for (const [n, t] of Object.entries(outs)) {
    assert.ok(!/price#p|MACHINE-DROPPED|Split here|could not be stored/.test(t), `${n} carries a machine note`);
    assert.ok(t.includes('يفشل الإرسال'), `${n} lost the tester's own note`);
  }
});

await test('r4-05-2: an Arabic document labels a page-scripted step in Arabic, an English one in English', () => {
  const scripted = [...arEvents, { kind: 'dom', ts: T0 + 3500, action: 'click', label: 'التالي', locator: "getByRole('button', { name: 'التالي' })", framePrefix: '', frameUrl: URL0, tag: 'button', trusted: false }];
  const ar = buildDefectReport(arSession, scripted).steps.join('\n');
  assert.ok(ar.includes('(نفذته الصفحة)') && !ar.includes('(by the page)'), ar);
  const en = buildDefectReport({ ...session, env: { language: 'en-US' }, charter: 'Apply' }, [{ ...scripted[1], label: 'Go', value: 'x' }, { ...scripted[2], label: 'Next', trusted: false }]).steps.join('\n');
  assert.ok(en.includes('(by the page)'), en);
});

await test('r4-11-6: the CSS-selector fallback for a locator that matched nothing keeps the frame prefix, and the spec parses', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: 'https://app.test/a', transition: 'typed' },
    { ...tdom(1000, 'click', 'Pay'), framePrefix: "frameLocator('#pay').", locatorMatches: 0, selector: '#go' },
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.ok(src.includes("page.frameLocator('#pay').locator('#go')"), src);
  specParses(src);
});

await test('r4-11-4: YAML quotes a string ending in a colon, a bare =, and <<; the document parses (pyyaml via uv, else not run)', async () => {
  for (const v of ['Error:', 'Time:', '=', '<<']) assert.match(yamlValue(v, 0), /^"/, `${v} is not quoted`);
  assert.equal(yamlValue('plain text', 0), 'plain text');
  const { spawnSync } = await import('node:child_process');
  const evs = [...events, { kind: 'note', ts: T0 + 5000, tag: 'bug', text: 'Expected:' }];
  const r = spawnSync('uv', ['run', '--with', 'pyyaml', 'python', '-c', 'import sys,yaml; d=yaml.safe_load(sys.stdin.read()); print(d["notes"][-1]["text"])'], { input: buildYaml(session, evs), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (r.error || r.status === null || /not recognized|not found/i.test(`${r.stderr}`)) { console.log('       not run: uv/pyyaml unavailable'); return; }
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'Expected:');
});

await test('r4-11-5: Postman url.raw percent-encodes non-secret query values when a secret one is hidden', () => {
  const evs = [{ kind: 'net', ts: T0 + 100, method: 'GET', url: '/api/search?q=a%20b%26c&token=SECRETVALUE&n=1%2B1', status: 200, durationMs: 5, frameUrl: URL0 }];
  const col = buildPostmanCollection(session, evs);
  const raw = JSON.stringify(col);
  assert.ok(raw.includes('q=a%20b%26c') && raw.includes('n=1%2B1'), raw.slice(0, 600));
  assert.ok(raw.includes('token={{token}}') && !raw.includes('SECRETVALUE'));
});

const formEvent = {
  kind: 'net', ts: T0 + 100, method: 'POST', url: '/api/upload', status: 200, durationMs: 5, frameUrl: URL0,
  reqBody: { kind: 'FormData', parts: [{ name: 'title', value: 'Q3 report' }, { name: 'pw', value: '«redacted»' }, { name: 'avatar', file: { name: 'me.png', type: 'image/png', size: 12 } }] },
};

await test('r4-11-3 (D-1010-69): Postman emits formdata text entries and file entries with an empty src; HAR emits postData.params', () => {
  const col = buildPostmanCollection(session, [formEvent]);
  const find = (items) => items.flatMap((i) => (i.item ? find(i.item) : [i]));
  const body = find(col.item)[0].request.body;
  assert.equal(body.mode, 'formdata');
  assert.deepEqual(body.formdata.map(({ key, type }) => [key, type]), [['title', 'text'], ['pw', 'text'], ['avatar', 'file']]);
  assert.equal(body.formdata[0].value, 'Q3 report');
  assert.equal(body.formdata[2].src, '');
  const har = JSON.parse(buildHar(session, [formEvent]));
  const pd = har.log.entries[0].request.postData;
  assert.equal(pd.mimeType, 'multipart/form-data');
  assert.deepEqual(pd.params, [{ name: 'title', value: 'Q3 report' }, { name: 'pw', value: '«redacted»' }, { name: 'avatar', fileName: 'me.png', contentType: 'image/png' }]);
  assert.ok(!('text' in pd));
});

await test('r4-11-2: adfToWiki escapes wiki markup in text and link labels, neutralises mentions and embeds, splits code macros and escapes | in cells', async () => {
  const { adfToWiki } = await import('../core/adf.js');
  const P = (...c) => ({ type: 'paragraph', content: c });
  const T = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const wiki = adfToWiki({ type: 'doc', content: [
    P(T('[~admin] !evil.png! {panel} *bold* _it_ h1. x')),
    P(T('Open [x|javascript:alert(1)] now', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
    P(T('a|b]', [{ type: 'link', attrs: { href: 'https://e.test/a b|c' } }])),
    { type: 'codeBlock', content: [T('before {code} mid {noformat} {code:java} after')] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [P(T('x|y'))] }, { type: 'tableCell', content: [{ type: 'codeBlock', content: [T('p|q')] }] }] }] },
  ] });
  assert.ok(!wiki.includes('[~') && wiki.includes('\\['), wiki);
  assert.ok(wiki.includes('\\!evil.png\\!') && wiki.includes('\\{panel\\}') && wiki.includes('\\*bold\\*') && wiki.includes('\\_it\\_'), wiki);
  assert.ok(!/(^|[^\\])\[[^\]]*\|javascript:/i.test(wiki), 'a javascript: link survived');
  assert.ok(wiki.includes('https://e.test/a%20b%7Cc'), wiki);
  const code = wiki.split('{code}').filter((_, i) => i === 1)[0];
  assert.ok(!/\{(code|noformat)/.test(code.replace(/\{​(code|noformat)/g, '')), 'a macro inside the code block can close it');
  assert.ok(wiki.includes('|x\\|y|') && wiki.includes('p\\|q'), wiki);
});

/* D-1010-123 / D-1010-112 additions for test-formats-contract.mjs, inserted before the final summary line. */
/* ── D-1010-123 (r5-11-3): checkers written here, independent of the writers and of lib-xml-strict ── */

/** A small XML 1.0 well-formedness check: char ranges, tag balance, attribute quoting, entities, comments. Returns [] or the faults. */
function xmlFaults(xml) {
  const bad = [];
  const CHAR = /^[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;
  if (!CHAR.test(xml)) bad.push('a character outside the XML 1.0 Char production');
  const stack = [];
  const re = /<!--([\s\S]*?)-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  let at = 0;
  while ((m = re.exec(xml)) !== null) {
    if (m.index !== at) { bad.push(`unparsable markup at ${at}`); break; }
    at = re.lastIndex;
    if (m[1] !== undefined) { if (m[1].includes('--') || m[1].endsWith('-')) bad.push('"--" inside a comment'); continue; }
    if (m[2] !== undefined) { if (stack.pop() !== m[2]) bad.push(`</${m[2]}> does not close the open tag`); continue; }
    if (m[3] !== undefined) {
      const attrNames = [...m[4].matchAll(/\s([^\s=]+)\s*=/g)].map((x) => x[1]);
      if (new Set(attrNames).size !== attrNames.length) bad.push(`duplicate attribute on <${m[3]}>`);
      if (m[5] !== '/') stack.push(m[3]);
      continue;
    }
    if (m[6] !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[6])) bad.push('a bare ampersand in text');
      if (m[6].includes(']]>')) bad.push('"]]>" in text');
    }
  }
  if (at !== xml.length && !bad.length) bad.push(`markup stops at ${at} of ${xml.length}`);
  if (stack.length) bad.push(`unclosed: ${stack.join(',')}`);
  return bad;
}

await test('D-123: JUnit passes an independent XML 1.0 well-formedness check, and the checker rejects the faults it claims to catch', () => {
  for (const [n, ses, evs] of [['hostile', session, events], ['arabic', arSession, arEvents]]) assert.deepEqual(xmlFaults(buildJunit(ses, evs)), [], `${n} JUnit`);
  for (const bad of ['<a><b></a>', '<a x=1/>', '<a>fish & chips</a>', '<a><!-- no -- good --></a>', '<a>\u0001</a>', '<a x="1" x="2"/>', '<a>']) assert.ok(xmlFaults(bad).length, `the checker let through ${JSON.stringify(bad)}`);
});

await test('D-123: JUnit parses with Python xml.etree when uv is present (the line says which checker ran)', () => {
  const probe = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { console.log('       python xml.etree: not run (no uv); the in-test checker above ran'); return; }
  const r = spawnSync('uv', ['run', 'python', '-I', '-c', 'import sys, xml.etree.ElementTree as E; E.fromstring(sys.stdin.buffer.read()); print("ok")'], { input: Buffer.from(buildJunit(session, events), 'utf8'), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(r.status, 0, `xml.etree refused the JUnit: ${r.stderr}`);
  console.log('       python xml.etree: ran (uv run python), JUnit parsed');
});

await test('D-123: HAR 1.2 required-field walk (log, creator, entries, every request and response member, name/value pairs, sizes)', () => {
  const har = JSON.parse(buildHar(session, [...events, { kind: 'net', ts: T0 + 3500, method: 'POST', url: '/api/form?a=1&b=2', status: 200, durationMs: 40, reqHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' }, reqBody: { kind: 'form', text: 'a=1' }, frameUrl: URL0 }]));
  const nv = (arr, where) => { assert.ok(Array.isArray(arr), `${where} is not an array`); for (const x of arr) assert.ok(typeof x.name === 'string' && 'value' in x, `${where} entry lacks name/value`); };
  const num = (v, where) => assert.ok(typeof v === 'number' && Number.isFinite(v) && v >= -1, `${where} is not a number >= -1`);
  assert.deepEqual(Object.keys(har), ['log']);
  assert.ok(typeof har.log.creator.name === 'string' && har.log.creator.version !== undefined, 'creator needs a name and a version');
  assert.ok(Array.isArray(har.log.entries) && har.log.entries.length >= 3);
  for (const e of har.log.entries) {
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(e.startedDateTime), `startedDateTime ${e.startedDateTime} is not ISO 8601`);
    num(e.time, 'time');
    assert.ok(/^[A-Z]+$/.test(e.request.method) && /^https?:\/\//.test(e.request.url), `request ${e.request.method} ${e.request.url}`);
    for (const k of ['headers', 'queryString', 'cookies']) nv(e.request[k], `request.${k}`);
    for (const k of ['headers', 'cookies']) nv(e.response[k], `response.${k}`);
    for (const k of ['headersSize', 'bodySize']) { num(e.request[k], `request.${k}`); num(e.response[k], `response.${k}`); }
    assert.ok(Number.isInteger(e.response.status) && typeof e.response.statusText === 'string' && typeof e.response.redirectURL === 'string');
    assert.ok(typeof e.response.content.mimeType === 'string' && typeof e.response.content.size === 'number');
    if (e.request.postData) assert.ok(typeof e.request.postData.mimeType === 'string', 'postData needs mimeType');
    for (const k of ['send', 'wait', 'receive']) num(e.timings[k], `timings.${k}`);
    assert.ok(e.cache && typeof e.cache === 'object');
  }
  const form = har.log.entries.find((e) => e.request.url.includes('/api/form'));
  assert.deepEqual(form.request.queryString.map((q) => q.name), ['a', 'b']);
});

await test('D-123: Postman v2.1 required-field walk (info, items, request method/url/header, response members)', () => {
  const col = buildPostmanCollection({ ...session, version: '3.4.0' }, events);
  assert.ok(typeof col.info.name === 'string' && col.info.name && /^https:\/\/schema\.getpostman\.com\/json\/collection\/v2\.1\.0\/collection\.json$/.test(col.info.schema));
  assert.ok(Array.isArray(col.item) && col.item.length >= 2);
  const walk = (items) => {
    for (const it of items) {
      assert.ok(typeof it.name === 'string' && it.name, 'an item lacks a name');
      if (Array.isArray(it.item)) { walk(it.item); continue; }
      assert.ok(it.request, `${it.name} lacks a request`);
      const r = it.request;
      assert.match(r.method, /^[A-Z]+$/);
      assert.ok(typeof r.url === 'string' || (typeof r.url?.raw === 'string' && r.url.raw), `${it.name}: url.raw`);
      if (typeof r.url === 'object') {
        if (r.url.host) assert.ok(Array.isArray(r.url.host));
        if (r.url.path) assert.ok(Array.isArray(r.url.path));
        for (const q of r.url.query || []) assert.ok('key' in q && 'value' in q, 'query lacks key/value');
      }
      for (const h of r.header || []) assert.ok(typeof h.key === 'string' && 'value' in h, 'header lacks key/value');
      if (r.body) assert.ok(['raw', 'urlencoded', 'formdata', 'file', 'graphql'].includes(r.body.mode), `body mode ${r.body.mode}`);
      for (const resp of it.response || []) assert.ok(typeof resp.name === 'string' && Number.isInteger(resp.code), `${it.name}: response needs name and integer code`);
    }
  };
  walk(col.item);
});

await test('D-112: the export date is the report rule (en-GB / ar-JO Latin digits, 24-hour) whatever the machine locale; no toLocaleString left', () => {
  const fmt = (tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(T0));
  const enText = buildText({ ...session, charter: 'Plain charter', env: { ...session.env, language: 'en-US' } }, [events[0], events[2], events[3]]);
  assert.ok(enText.includes(`When:     ${fmt('en-GB')}`), `English text export date is not the house format: ${enText.split('\n').find((l) => l.startsWith('When'))}`);
  const html = buildHtml(arSession, arEvents, captures, {});
  assert.ok(html.replace(/<[^>]+>/g, '').includes(fmt('ar-JO-u-nu-latn-ca-gregory')), 'Arabic HTML export date is not the house format (tags stripped: digits sit in bdi runs)');
  assert.ok(!/[\u0660-\u0669]/.test(fmt('ar-JO-u-nu-latn-ca-gregory')), 'the Arabic date must keep Western digits');
  assert.ok(!/toLocale(?:Date|Time)?String/.test(readFileSync(new URL('../core/exporters.js', import.meta.url), 'utf8')), 'core/exporters.js still formats a date by the machine locale');
});

/* ── council-1010 r6 lane 3: D-1010-133 / 130 / 131 / 87 ── */
await test('D-1010-133: HAR with redaction off masks credential headers and body keys, and keeps the rest', () => {
  const H = { kind: 'net', ts: T0 + 100, method: 'POST', url: '/api/login', status: 200, durationMs: 5, frameUrl: URL0 };
  const evs = [
    { ...H, reqHeaders: { authorization: 'Bearer live-bearer-xyz', cookie: 'sid=cookie-val-1', 'x-api-key': 'K-123', 'content-type': 'application/json' },
      resHeaders: { 'set-cookie': 'sid=resp-cookie-9', 'content-type': 'application/json' },
      reqBody: { kind: 'json', text: '{"user":"sara","password":"hunter2","nested":{"client_secret":"S-1"},"list":[{"token":"tok-body"}]}' } },
    { ...H, url: '/api/form', reqBody: { kind: 'form', text: 'a=1&password=hunter2&access_token=tok-body' } },
    { ...H, url: '/api/multi', reqBody: { kind: 'FormData', parts: [{ name: 'client_secret', value: 'SECRET-OAUTH' }, { name: 'note', value: 'plain note' }] } },
    { ...H, url: '/api/cut', reqBody: { kind: 'json', text: '{"name":"x","password":"hunter2","tail":"abc' } },
  ];
  const raw = buildHar(session, evs);
  for (const secret of ['live-bearer-xyz', 'cookie-val-1', 'K-123', 'resp-cookie-9', 'hunter2', 'S-1', 'tok-body', 'SECRET-OAUTH']) assert.ok(!raw.includes(secret), `a credential value reached the HAR: ${secret}`);
  const [login, form, multi, cut] = JSON.parse(raw).log.entries;
  const hv = (e, n) => e.request.headers.find((h) => h.name === n)?.value;
  assert.equal(hv(login, 'authorization'), '[REDACTED]');
  assert.equal(hv(login, 'content-type'), 'application/json', 'a plain header is kept');
  assert.equal(login.response.headers.find((h) => h.name === 'set-cookie').value, '[REDACTED]');
  const body = JSON.parse(login.request.postData.text);
  assert.equal(body.user, 'sara');
  assert.equal(body.password, '[REDACTED]');
  assert.equal(body.nested.client_secret, '[REDACTED]');
  assert.equal(body.list[0].token, '[REDACTED]');
  assert.equal(form.request.postData.text, 'a=1&password=%5BREDACTED%5D&access_token=%5BREDACTED%5D');
  assert.deepEqual(multi.request.postData.params, [{ name: 'client_secret', value: '[REDACTED]' }, { name: 'note', value: 'plain note' }]);
  assert.ok(cut.request.postData.text.includes('[REDACTED]') && !cut.request.postData.text.includes('hunter2'), 'a body cut at the cap is masked by pattern');
  assert.equal(login.request.bodySize, Buffer.byteLength(login.request.postData.text), 'bodySize is the size of what is written');
});

await test('D-1010-130: the three storage gap codes read in both languages, and an unknown code still gets the generic line', async () => {
  const { captureGapLine } = await import('../core/formats-export.js');
  const note = (gap) => ({ kind: 'note', tag: 'capture-gap', gap });
  const en = captureGapLine([note('session-cap'), note('body-cap'), note('low-disk')], false);
  for (const s of ['This session reached its storage limit, so later events were not saved.', 'This session reached its size limit, so later request and response bodies were not saved. Events were kept.', 'Free storage space is low. Save or export this session soon.']) assert.ok(en.includes(s), `EN: ${s}`);
  const ar = captureGapLine([note('session-cap'), note('body-cap'), note('low-disk')], true);
  for (const s of ['بلغت هذه الجلسة حدّ التخزين، فلم تُحفَظ الأحداث اللاحقة.', 'بلغت هذه الجلسة حدّ الحجم، فلم تُحفَظ نصوص الطلبات والاستجابات اللاحقة، وبقيت الأحداث محفوظة.', 'مساحة التخزين المتاحة منخفضة. احفظ هذه الجلسة أو صدّرها قريبًا.']) assert.ok(ar.includes(s), `AR: ${s}`);
  assert.ok(captureGapLine([note('never-heard-of-it')], false).startsWith('Capture gap:'), 'an unknown code keeps the generic sentence');
});

await test('D-1010-131: build and reproducibility render in the issue markdown, CSV, defect markdown and the Jira ADF; empty is "not stated"', async () => {
  const { toCsv } = await import('../core/formats-export.js');
  const evs = [{ kind: 'nav', ts: T0 + 100, url: URL0 }, { kind: 'net', ts: T0 + 500, method: 'GET', url: '/api/x', status: 500, durationMs: 5, frameUrl: URL0 }];
  const en = { ...session, charter: 'Plain charter', env: { ...session.env, language: 'en-US' } };
  const bare = toMarkdownIssue(en, evs);
  assert.ok(bare.includes('| Build | not stated |') && bare.includes('| Reproducibility | unknown |'), 'defaults');
  const set = toMarkdownIssue({ ...en, build: '1.4.2 (rc|1)', reproducibility: 'sometimes' }, evs);
  assert.ok(set.includes('| Build | 1.4.2 (rc\\|1) |') && set.includes('| Reproducibility | sometimes |'), 'set values (a pipe is escaped)');
  const ar = toMarkdownIssue({ ...arSession, build: '', reproducibility: 'always' }, evs);
  assert.ok(ar.includes('| رقم البناء | غير مذكور |') && ar.includes('| قابلية إعادة الإنتاج | في كل مرة |'), 'Arabic pair');
  assert.ok(!toCsv(en, evs).includes('Build'), 'a plain timeline CSV keeps one row per event');
  const rows = toCsv({ ...en, build: '1.4.2', reproducibility: 'once' }, evs).replace(/^﻿/, '').split('\n');
  assert.deepEqual(rows.slice(-2), [',Build,1.4.2,,', ',Reproducibility,once,,'], 'two closing rows when a session states them');
  const d = buildDefectReport(en, evs, { build: ' 7.1 ', reproducibility: 'once' });
  assert.equal(d.build, '7.1');
  assert.equal(buildDefectReport(en, evs, { reproducibility: 'weekly' }).reproducibility, 'unknown', 'a value outside the four falls back to unknown');
  const md = defectToMarkdown(d);
  assert.ok(md.includes('| Build | 7.1 |') && md.includes('| Reproducibility | once |'), 'defect markdown');
  assert.ok(defectToMarkdown(buildDefectReport(en, evs, {})).includes('| Build | not stated |'), 'defect markdown default');
  const adf = defectToAdf(d);
  assert.deepEqual(validateAdf(adf), [], 'the ADF is still valid');
  assert.ok(JSON.stringify(adf).includes('Reproducibility') && JSON.stringify(adf).includes('7.1'), 'Jira body carries both');
});

await test('D-1010-87: a drop-sourced upload is a FIXME comment (never setInputFiles) and a paste is a secret-variable fill; the spec still parses', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 100, url: URL0 },
    { kind: 'dom', ts: T0 + 1000, action: 'upload', control: 'drop', value: 'cv.pdf, scan.png', locator: "getByText('Drop files here')", framePrefix: '', tag: 'div', label: 'Drop files here' },
    { kind: 'dom', ts: T0 + 2000, action: 'upload', control: 'file', value: 'cv.pdf', locator: "getByLabel('CV')", framePrefix: '', tag: 'input', label: 'CV' },
    { kind: 'dom', ts: T0 + 3000, action: 'input', control: 'paste', masked: true, value: '••••••••', locator: "getByLabel('Notes')", framePrefix: '', tag: 'textarea', label: 'Notes' },
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.match(src, /\/\/ FIXME: dropped 'cv\.pdf, scan\.png' onto this element/);
  assert.equal(src.match(/setInputFiles/g).length, 1, 'only the file input is driven by setInputFiles');
  assert.ok(/fill\(process\.env\.QAW_SECRET_\w+/.test(src) && !src.includes('••••'), 'a paste never writes its text');
  specParses(src);
});


await test('D-1010-174 spec: range and color steps set the value and fire input and change; the spec still parses', () => {
  const dom = (extra) => ({ kind: 'dom', ts: T0 + 1000, framePrefix: '', locator: "getByRole('slider')", tag: 'input', ...extra });
  const evs = [
    dom({ action: 'input', value: '40', control: 'range' }),
    dom({ action: 'change', value: '40', control: 'range' }),
    dom({ action: 'input', value: '#ff8800', control: 'color', locator: "getByLabel('Colour')" }),
    dom({ action: 'input', value: 'hello', control: 'text', locator: "getByLabel('Name')" }),
  ];
  const src = buildPlaywrightSpec(session, evs);
  const lines = src.split('\n').filter((l) => /^\s*await /.test(l));
  const evalLine = (v) => `await page.getByRole('slider').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '${v}');`;
  assert.ok(lines.some((l) => l.trim() === evalLine('40')), 'range emits the evaluate line');
  assert.ok(lines.some((l) => l.includes("getByLabel('Colour')") && l.includes(".evaluate((el, v) =>") && l.includes("'#ff8800'")), 'color emits it too');
  assert.ok(!lines.some((l) => l.includes('.fill(') && /slider|Colour/.test(l)), 'neither is filled (Playwright refuses fill on range and color)');
  assert.equal(lines.filter((l) => l.includes('.fill(')).length, 1, 'a text input still uses fill()');
  specParses(src);
});

await test('r8-11-2 / r8-11-3 crossbrowser: same-origin gotos become path+search, cross-origin stay absolute, the README names the secret and upload variables', async () => {
  const { crossBrowserProject } = await import('../core/crossbrowser.js');
  const cb = { ...session, startUrl: 'https://app.test/start?x=1', charter: 'Cross check' };
  const dom = (extra) => ({ kind: 'dom', ts: T0 + 1000, framePrefix: '', tag: 'input', ...extra });
  const evs = [
    { kind: 'nav', ts: T0 + 500, url: 'https://app.test/a/b?q=1#h', transition: 'typed' },
    { kind: 'nav', ts: T0 + 600, url: 'https://other.test/x', transition: 'typed' },
    dom({ action: 'input', masked: true, locator: "getByLabel('Password')", label: 'Password' }),
    dom({ action: 'upload', value: 'cv.pdf', locator: "getByLabel('CV')" }),
  ];
  const spec = buildPlaywrightSpec(cb, evs);
  const files = crossBrowserProject(cb, spec, { title: 'Cross check' });
  const test1 = files.find((f) => f.path.startsWith('tests/')).content;
  assert.ok(test1.includes("page.goto('/a/b?q=1#h')"), 'a same-origin goto keeps path, search and hash');
  assert.ok(test1.includes("page.goto('https://other.test/x')"), 'a cross-origin goto stays absolute');
  assert.ok(spec.includes("page.goto('https://app.test/a/b?q=1#h')"), 'the standalone spec is unchanged');
  const readme = files.find((f) => f.path === 'README.md').content;
  const names = [...new Set(spec.match(/\b(?:QAW_SECRET_\w+|UQA_SECRET|UQA_UPLOAD_FILE)\b/g))];
  assert.ok(names.some((n) => n.startsWith('QAW_SECRET_')) && names.includes('UQA_UPLOAD_FILE') && names.includes('UQA_SECRET'), 'the spec carries the variables: ' + names);
  assert.ok(/## Secrets and files/.test(readme));
  for (const n of names) assert.ok(readme.includes('`' + n + '`'), `${n} is listed in the README`);
  const plain = crossBrowserProject(cb, buildPlaywrightSpec(cb, [dom({ action: 'input', value: 'x', locator: "getByLabel('Name')" })]));
  assert.ok(!/Secrets and files/.test(plain.find((f) => f.path === 'README.md').content), 'no secrets, no section');
  const bare = crossBrowserProject({ ...cb, startUrl: '' }, "await page.goto('https://app.test/a');");
  assert.ok(bare.find((f) => f.path.startsWith('tests/')).content.includes("goto('https://app.test/a')"), 'no origin, nothing rewritten');
});

await test('r9-11-2: crossBrowserProject treats a hostile charter as text and survives a session with no start time', async () => {
  const { crossBrowserProject } = await import('../core/crossbrowser.js');
  const charter = 'Fix $& and $` bug __DATE__ and $\' __TITLE__';
  const files = crossBrowserProject({ ...session, charter, startedAt: undefined, startUrl: 'https://app.test/start' }, "await page.goto('https://app.test/a');");
  const readme = files.find((f) => f.path === 'README.md').content;
  assert.equal(readme.split('\n')[0], `# ${charter}: cross-browser`, 'the title is the charter, character for character');
  assert.ok(/recorded on \d{4}-\d{2}-\d{2}\./.test(readme), 'a missing start falls back to today');
  assert.ok(!/__(BASE_URL|SLUG)__/.test(files.find((f) => f.path === 'playwright.config.ts').content + files.find((f) => f.path === 'package.json').content), 'no placeholder is left in the config or package.json');
  assert.ok(files.find((f) => f.path === 'playwright.config.ts').content.includes("'https://app.test'"), 'baseURL filled');
  assert.doesNotThrow(() => crossBrowserProject({ ...session, startedAt: 'not a date' }, ''), 'an invalid date does not throw');
});

await test('r9-11-6: a screenshot path with spaces, parentheses and Arabic is one working link', async () => {
  const { describeOmitted } = await import('../core/artifact.js');
  const p = 'shots/شاشة (1).png';
  const md = describeOmitted({ path: p, bytes: 4096 }, 1);
  const link = marked.lexer(md).flatMap((t) => t.tokens || []).filter((t) => t.type === 'link');
  assert.equal(link.length, 1, md);
  assert.equal(decodeURIComponent(link[0].href), p, 'the href decodes to the same path');
});

await test('r9-11-5: a session id with a double hyphen keeps the JUnit and the embedded comment well-formed; xlsx cells lose U+FFFF and lone surrogates', async () => {
  const { embed } = await import('../core/provenance.js');
  const { buildXlsx } = await import('../core/xlsx.js');
  const odd = { ...session, id: 's--odd---id-' };
  assert.deepEqual(xmlFaults(buildJunit(odd, events)), [], 'JUnit with a -- in the id');
  assert.deepEqual(xmlFaults(`<a>${embed.xml({ session: odd, kind: 'junit' })}</a>`), [], 'embed.xml with a -- in the id');
  const zip = readZipBuffer(buildXlsx([{ name: 'S', rows: [['x￿y￾z\uD800w', 'ok']] }]));
  const sheet = zip.entries.get('xl/worksheets/sheet1.xml').data().toString('utf8');
  assert.ok(sheet.includes('xyzw') && !/[￾￿\uD800]/.test(sheet), 'U+FFFE, U+FFFF and the lone surrogate are cut');
  parseXml(sheet);
});

await test('r9-05-3: an Enter or Space keydown folds into the click it caused (within 50 ms, same element); a Space on a div[role=button] is a press', () => {
  const loc = "getByRole('button', { name: 'Save' })";
  const nav = { kind: 'nav', ts: T0, url: URL0, transition: 'typed' };
  const base = { kind: 'dom', framePrefix: '', tag: 'div', locator: loc };
  const folded = buildPlaywrightSpec(session, [nav, { ...base, ts: T0 + 100, action: 'keydown', key: 'Enter' }, { ...base, ts: T0 + 120, action: 'click' }]);
  assert.ok(!/\.press\('Enter'\)/.test(folded) && /\.click\(\)/.test(folded), 'the keydown folds, the click stays');
  const apart = buildPlaywrightSpec(session, [nav, { ...base, ts: T0 + 100, action: 'keydown', key: 'Space' }, { ...base, ts: T0 + 400, action: 'click' }]);
  assert.ok(/\.press\('Space'\)/.test(apart) && /\.click\(\)/.test(apart), 'a click 300 ms later is not its effect');
  const alone = buildPlaywrightSpec(session, [nav, { ...base, ts: T0 + 100, action: 'keydown', key: 'Space' }, { ...base, ts: T0 + 200, action: 'keydown', key: 'Home' }]);
  assert.ok(/\.press\('Space'\)/.test(alone) && /\.press\('Home'\)/.test(alone), 'Space and Home replay as key presses');
});

await test('D-206: the replay-cap gap has its sentence in both languages', async () => {
  const { GAP_LABEL, captureGapLine } = await import('../core/formats-export.js');
  const { DOC_LABELS } = await import('../core/doc-labels.js');
  assert.equal(GAP_LABEL['replay-cap'], 'gapReplayCap');
  const note = { kind: 'note', tag: 'capture-gap', gap: 'replay-cap', ts: T0 };
  assert.equal(captureGapLine([note], false), DOC_LABELS.en.gapReplayCap);
  assert.equal(captureGapLine([note], true), DOC_LABELS.ar.gapReplayCap);
  assert.ok(DOC_LABELS.en.gapReplayCap && DOC_LABELS.ar.gapReplayCap && DOC_LABELS.en.gapReplayCap !== DOC_LABELS.ar.gapReplayCap);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
