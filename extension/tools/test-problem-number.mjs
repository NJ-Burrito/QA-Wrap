/* ui-1016 lane H2, node-only checks.
 *   1. One problem number: the popup chip, the done card, the toast and the report print the same figure for the same session.
 *   2. Paragraph text (ADHD rule 10): the tool statuses, the API page, the diagram page and the Welcome page stay short, EN and AR together.
 *   node tools/test-problem-number.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { problemCounts } from '../core/finding-count.js';
import { visibleProblems } from '../core/signal.js';
import { countFindings } from '../core/sessions.js';
import { buildMarkdown, buildJson } from '../core/artifact-docs.js';

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ext, f), 'utf8');
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const T0 = 1_791_724_838_000, U = 'https://app.test/';
const net = (at, url, over = {}) => ({ kind: 'net', method: 'GET', url: `${U}${url}`, status: 500, ts: T0 + at, frameUrl: U, durationMs: 20, ...over });
// 4 distinct failures from 11 raw failure events, plus tool findings that used to inflate the chip (the 31 / 4 / 11 audit).
const events = [
  { kind: 'dom', action: 'click', label: 'Login', ts: T0, frameUrl: U },
  ...Array.from({ length: 5 }, (_, i) => net(10 + i, 'api/a')), ...Array.from({ length: 3 }, (_, i) => net(30 + i, 'api/b')),
  net(50, 'api/c', { status: 404 }), net(60, 'api/d', { status: 403 }), net(70, 'api/d', { status: 403 }),
  { kind: 'a11y', total: 11, violations: [], ts: T0 + 80, frameUrl: U }, { kind: 'links', broken: [1, 2, 3], ts: T0 + 90, frameUrl: U },
];
const session = { id: 's1', charter: 'Login', startedAt: T0 - 1000, endedAt: T0 + 5000, startUrl: U, env: {} };
const want = 4;

// the real sgView of each surface, lifted from its source the way test-signal-surfaces does
const lift = (file) => {
  const src = read(file), a = src.indexOf('function sgView(');
  assert.ok(a >= 0, `${file} defines sgView`);
  return new Function('SIG', 'SESS', 'FC', 'sgLevel', 'sgPromoted', `${src.slice(a, src.indexOf('\n}\n', a) + 3)}; return sgView;`)({ visibleProblems }, { countFindings }, { problemCounts }, () => 'problems', () => new Set());
};

test('sample: 4 distinct failures from 11 raw failure events, plus tool findings', () => {
  assert.equal(problemCounts(events).groups, want);
  assert.equal(problemCounts(events).events, 11);
  assert.ok(countFindings(events).total > 11, 'findings count the tools too');
});
test('the popup chip (sgView) prints the number', () => assert.equal(lift('popup/popup.js')(events, 's1').num, want));
test('the report headline (sgView) prints the number', () => assert.equal(lift('report/report.js')(events, 's1').num, want));
test('the DevTools panel prints the number', () => assert.equal(lift('devtools/panel.js')(events, 's1').num, want));
test('the done card tile is problemCounts().groups', () => assert.match(read('popup/done-card.js'), /problemCounts\(events\)\.groups/));
test('the report text and session.json print it; "Findings" stays the separate, larger count', () => {
  const md = buildMarkdown(session, events);
  assert.match(md, new RegExp(`\\| Problems \\| ${want} \\|`));
  assert.match(md, /\| Findings \| (\d+) \|/);
  assert.equal(JSON.parse(buildJson(session, events)).problems, want);
});
test('the toast counts through the same function, behind the offscreen door, not the raw failure index', () => {
  const w = read('background/worker-session.js');
  assert.match(w, /failures: \(await problemCounts\(rows\)\)\.groups/);
  assert.doesNotMatch(w.slice(w.indexOf('The session is over, said where')), /countFailures\(/);
  assert.match(read('background/media.js'), /problemCounts = pureCall\('UQA_OFF_PROBLEMS'\)\('problemCounts'\)/);
  assert.match(read('offscreen/offscreen.js'), /problems: \(\) => import\('\.\.\/core\/finding-count\.js'\)/);
  assert.match(read('offscreen/offscreen.js'), /case 'UQA_OFF_PROBLEMS':\s+return offPure\('problems', msg\)/);
});

/* ---- 2. paragraph text ---- */
const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
const words = (v) => String(v).replace(/\{[^}]*\}/g, 'x').trim().split(/\s+/).filter(Boolean).length;
// What the audit named: each is one line of 8 words or fewer, in both languages (a status is the sum of its parts).
const ONE_LINE = ['api.primer.body', 'api.primer.step2', 'api.primer.step3', 'api.primer.step4', 'api.req.note', 'api.env.note', 'api.session.note',
  'diagram.page.hint', 'overlay.mask.tip', 'popup.pick.on', 'popup.fineprint.stored'];
test('the named paragraphs are 8 words or fewer in EN and in AR', () => {
  for (const k of ONE_LINE) for (const [lang, d] of [['en', en], ['ar', ar]]) assert.ok(d[k] && words(d[k]) <= 8, `${lang} ${k}: ${words(d[k])} words`);
});
test('a status is one short line: a11y, fine print, spec, map and viewport add up to 10 words or fewer', () => {
  const sum = (...ks) => (d) => ks.reduce((n, k) => n + words(d[k].replace(/\{(rules|elements|checks|gaps|forms|fields|links|unique)\}/g, '2 $1')), 0);
  const cases = { a11y: sum('popup.a11y.found'), fineprint: sum('popup.fineprint.counts', 'popup.fineprint.stored'), spec: sum('popup.spec.read'), harvest: sum('popup.harvest.counts'),
    viewport: (d) => words(d['popup.viewport.opened']) + words(d['popup.viewport.leadThere']) + 1, refused: sum('popup.viewport.notExactGot') }; // viewport: opened + lead + one thing kept (masking)
  for (const [name, f] of Object.entries(cases)) for (const [lang, d] of [['en', en], ['ar', ar]]) assert.ok(f(d) <= 10, `${lang} ${name}: ${f(d)} words`);
});
test('every new key exists in both languages and the old long copy is gone', () => {
  for (const k of ['popup.tool.open', 'popup.pick.on', 'popup.pick.done', 'api.env.store', 'api.env.storeTitle']) assert.ok(en[k] && ar[k], k);
  for (const k of ['popup.fineprint.tail', 'popup.fineprint.unmeasured', 'popup.spec.stored', 'popup.harvest.stored']) assert.ok(!(k in en) && !(k in ar), `${k} is dead`);
});
test('the pages carry the same short words as the language file (HTML fallback = EN)', () => {
  const api = read('api/api.html'), dia = read('diagram/diagram.html');
  for (const k of ['api.primer.body', 'api.req.note', 'api.env.note', 'api.session.note', 'api.env.store']) assert.ok(api.replace(/\s+/g, ' ').includes(en[k]), `api.html ${k}`);
  assert.ok(dia.includes(en['diagram.page.hint']), 'diagram.html hint');
  assert.ok(read('content/mask.js').includes(en['overlay.mask.tip']), 'mask.js tip');
});
test('the Welcome page: no "all sites", and no visible paragraph over 25 words outside the disclosure', () => {
  const html = read('welcome/welcome.html');
  assert.doesNotMatch(html, /all sites/i, 'EN still offers "all sites"');
  assert.doesNotMatch(html, /وحده أو كل المواقع/, 'AR still offers "all sites"');
  const open = html.replace(/<details class="all-facts"[\s\S]*?<\/details>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const m of open.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ');
    assert.ok(text.trim().split(/\s+/).length <= 25, `over 25 words: ${text.trim().slice(0, 60)}`);
  }
  assert.match(html, /The Awake switch always means this site/);
});
console.log(`${process.exitCode ? 'FAILED' : 'OK'}  ${passed} passed`);
