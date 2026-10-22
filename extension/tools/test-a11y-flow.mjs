/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The same violation on three pages of one wizard, counted once.
 *
 *   node tools/test-a11y-flow.mjs
 *
 * The fixture is the shape this exists for: a three-page application flow whose
 * header carries one bad contrast link on every page, plus a problem that is
 * genuinely new on page two and one that is only on page three. A report that
 * says "nine violations" of that is unreadable; the honest answer is three
 * findings, one of which is on every page and is therefore a component problem.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOCUS_PROBE, ringVisible } from './lib-focus-ring.mjs';
import {
  foldFindings, byComponent, describeFinding, foldedMarkdown, selectorShape, componentOf, pageKey,
} from '../core/a11y-flow.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_800_000_000_000;

/** The same header link, as three scans of three pages would report it. */
const headerLink = (step) => ({
  id: 'color-contrast',
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  helpUrl: 'https://example.test/rules/color-contrast',
  count: 1,
  nodes: [{
    target: `#step-${step} > header.site > nav > a:nth-child(3)`,
    html: '<a class="help" href="/help">Help</a>',
    summary: 'Fix any of the following: Element has insufficient color contrast of 2.4:1',
  }],
});

const scan = (step, url, extra = []) => ({
  kind: 'a11y',
  ts: T0 + step * 1000,
  url,
  total: 1 + extra.length,
  violations: [headerLink(step), ...extra],
});

const flow = [
  scan(1, 'https://apply.example.gov/step-1'),
  scan(2, 'https://apply.example.gov/step-2', [{
    id: 'label',
    impact: 'critical',
    help: 'Form elements must have labels',
    count: 1,
    nodes: [{ target: '#step-2 > main > form > input:nth-child(2)', html: '<input name="iban">', summary: 'Fix any of the following: Form element does not have an implicit label' }],
  }]),
  scan(3, 'https://apply.example.gov/step-3', [{
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternative text',
    count: 1,
    nodes: [{ target: '#step-3 > main > img', html: '<img src="stamp.png">', summary: 'Fix any of the following: Element does not have an alt attribute' }],
  }]),
];

/* ── the shape, which is what makes the fold possible ──────────────────── */

test('two pages of one wizard produce the same selector shape', () => {
  const a = selectorShape('#step-2 > header.site > nav > a:nth-child(3)');
  const b = selectorShape('#step-4 > header.site > nav > a:nth-child(3)');
  assert.equal(a, b, 'the step number must not make one link into two problems');
  assert.match(a, /header\.site/, 'the structure has to survive the flattening');
  // Two genuinely different links still differ.
  assert.notEqual(a, selectorShape('#step-2 > footer > nav > a:nth-child(3)'));
  assert.notEqual(a, selectorShape('#step-2 > header.site > nav > button:nth-child(3)'));
});

test('the nearest landmark stands in for a component, and the copy admits it', () => {
  assert.equal(componentOf('#step-2 > header.site > nav > a:nth-child(3)'), 'header.site');
  assert.equal(componentOf('#step-2 > main > form > input'), 'main');
  assert.equal(componentOf('div.wrapper > span'), 'outside any landmark');
  assert.match(foldedMarkdown(foldFindings(flow)), /first approximation of a component boundary/);
});

test('a page is named the way a person would name it', () => {
  assert.equal(pageKey('https://apply.example.gov/step-1?token=abc'), 'apply.example.gov/step-1');
  assert.equal(pageKey('https://apply.example.gov/'), 'apply.example.gov');
  assert.equal(pageKey('not a url'), 'not a url');
});

/* ── the fold ──────────────────────────────────────────────────────────── */

test('one header violation on three pages is one finding, not three', () => {
  const folded = foldFindings(flow);
  assert.equal(folded.counts.unique, 3, 'three unique findings from five raw violations');
  assert.equal(folded.counts.pages, 3);
  assert.equal(folded.counts.raw, 5);

  const header = folded.findings.find((f) => f.rule === 'color-contrast');
  assert.equal(header.occurrences, 3, 'it was seen three times');
  assert.deepEqual(header.pages, ['apply.example.gov/step-1', 'apply.example.gov/step-2', 'apply.example.gov/step-3']);
  assert.equal(header.everywhere, true, 'on every page walked makes it a component problem');
  assert.equal(header.firstSeenOn, 'apply.example.gov/step-1', 'the page a tester should start from');
  assert.equal(folded.counts.everywhere, 1);
});

test('a finding that is only on one page says so, and is not marked everywhere', () => {
  const folded = foldFindings(flow);
  const label = folded.findings.find((f) => f.rule === 'label');
  assert.deepEqual(label.pages, ['apply.example.gov/step-2']);
  assert.equal(label.everywhere, false);
  assert.match(describeFinding(label), /^On apply\.example\.gov\/step-2\.$/);
});

test('new on this page is marked, because that is what a page-by-page report gets right', () => {
  const folded = foldFindings(flow, { currentUrl: 'https://apply.example.gov/step-3' });
  const fresh = folded.findings.find((f) => f.rule === 'image-alt');
  assert.equal(fresh.isNew, true, 'first seen here, and nowhere else');
  const carried = folded.findings.find((f) => f.rule === 'color-contrast');
  assert.equal(carried.isNew, false, 'a problem carried from page one is not new here');
});

test('the worst impact is first, and ties go to the finding on the most pages', () => {
  const folded = foldFindings(flow);
  assert.equal(folded.findings[0].impact, 'critical');
  const serious = folded.findings.filter((f) => f.impact === 'serious');
  assert.equal(serious[0].rule, 'color-contrast');
});

test('grouping by component puts the header problem in the header', () => {
  const groups = byComponent(foldFindings(flow));
  const header = groups.find((g) => g.component === 'header.site');
  assert.equal(header.findings.length, 1);
  assert.equal(header.pages.length, 3, 'the group carries every page its findings were seen on');
  assert.ok(groups.some((g) => g.component === 'main'));
});

test('the same rule on a genuinely different element stays two findings', () => {
  const two = foldFindings([
    scan(1, 'https://x.test/a', [{
      id: 'color-contrast', impact: 'serious', help: 'contrast', count: 1,
      nodes: [{ target: '#a > footer > p', html: '<p>x</p>', summary: 'ratio 2.1:1' }],
    }]),
  ]);
  assert.equal(two.counts.unique, 2, 'a header link and a footer paragraph are two problems');
});

test('a session with no scan folds to nothing, and says nothing', () => {
  const empty = foldFindings([]);
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.counts.unique, 0);
  assert.equal(foldedMarkdown(empty), '', 'an empty block must not be written into a document');
});

test('the document says how many were folded away, and by what rule', () => {
  const md = foldedMarkdown(foldFindings(flow));
  assert.match(md, /3 unique findings across 3 pages, from 5 raw violations/);
  assert.match(md, /1 appear on every page walked, which makes them component problems/);
  assert.match(md, /\| Finding \| Impact \| Where \| Component \|/);
  assert.match(md, /On every page walked \(3\)/);
  assert.ok(!md.includes('—'), 'no em dash in anything a tester reads');
  assert.ok(!/\(s\)/.test(md), 'no bracketed plural either');
});

/* ── T-060: the keyboard-only first run asserts a ring at every stop ───────
 * The run itself is tools/test-first-run-live.mjs (a real browser, in scripts.test). What it means
 * by "a visible ring" is tools/lib-focus-ring.mjs, judged here on made-up reports so the judge is
 * proved before it is trusted (a judge that passes everything has found nothing). */

const FOCUSED = { none: false, on: true, focusVisible: true, outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(11, 87, 208)', boxShadow: 'none' };

test('a focus ring counts only when the browser draws one a keyboard user can see', () => {
  assert.equal(ringVisible(FOCUSED), true, 'a 2px solid outline is a ring');
  assert.equal(ringVisible({ ...FOCUSED, outlineStyle: 'none' }), false, 'outline: none and nothing else');
  assert.equal(ringVisible({ ...FOCUSED, outlineColor: 'rgba(0, 0, 0, 0)' }), false, 'a transparent outline is not visible');
  assert.equal(ringVisible({ ...FOCUSED, outlineWidth: '0px' }), false, 'a zero-width outline is not visible');
  assert.equal(ringVisible({ ...FOCUSED, focusVisible: false }), false, 'focus that :focus-visible does not match is a pointer focus');
  assert.equal(ringVisible({ ...FOCUSED, on: false }), false, 'a control with no box');
  assert.equal(ringVisible({ none: true }), false, 'focus on nothing');
  assert.equal(ringVisible({ ...FOCUSED, outlineStyle: 'none', boxShadow: 'rgb(11, 87, 208) 0px 0px 0px 3px' }), true, 'a box-shadow ring stands in for an outline');
  assert.equal(ringVisible({ ...FOCUSED, outlineStyle: 'none', boxShadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 0px' }), false, 'an empty shadow is not a ring');
});

test('the probe follows focus into the bar\'s closed shadow root, which only the content script world can open', () => {
  const inner = { id: 'stop', tagName: 'BUTTON', shadowRoot: null, getAttribute: (k) => (k === 'class' ? 'uqa-stop' : null), textContent: 'Stop', matches: () => true, getBoundingClientRect: () => ({ width: 40, height: 20 }) };
  const host = { id: '', tagName: 'QAW-UI', shadowRoot: null, getAttribute: () => null, textContent: '', matches: () => false, getBoundingClientRect: () => ({ width: 1, height: 1 }) };
  const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, window: globalThis.window };
  try {
    globalThis.document = { activeElement: host, body: {}, documentElement: {} };
    globalThis.getComputedStyle = () => ({ outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(1, 2, 3)', boxShadow: 'none' });
    globalThis.window = { UQAUiHost: { uiRoot: () => ({ activeElement: inner }) } };
    const seen = FOCUS_PROBE();
    assert.equal(seen.id, 'stop', 'it stopped at the host and called that the focused element');
    assert.equal(seen.cls, 'uqa-stop');
    assert.equal(ringVisible(seen), true);
    globalThis.window = {}; // the page's own world has no key to the root
    assert.equal(FOCUS_PROBE().tag, 'qaw-ui', 'without the key the probe can only name the host');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
});

test('the live first run drives the flow by keyboard alone and is part of npm test', () => {
  const live = readFileSync(new URL('./test-first-run-live.mjs', import.meta.url), 'utf8');
  for (const key of ["'Tab'", "'Enter'", "'Space'", "'Escape'", "'Alt+KeyB'"]) assert.ok(live.includes(key), `the keyboard run never presses ${key}`);
  assert.ok(/ringVisible\(/.test(live) && /a visible focus ring at every stop/.test(live), 'the run does not assert a ring at every stop');
  assert.ok(/no keyboard trap/.test(live) && /Tab leaves the bar/.test(live), 'the run does not assert the absence of a trap');
  assert.ok(/#verdict:not\(\[hidden\]\) #btn-file/.test(live), 'the run reads the report before its ready element exists (R15)');
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['test:chain'];
  assert.ok(scripts.includes('node tools/test-first-run-live.mjs'), 'test-first-run-live.mjs is not in scripts.test');
});

/* ── r8-08-1 / D-1010-178: the diagram editor works from the keyboard ────── */
const { A4, MM } = await import('../core/flow.js');
const dk = await import('../diagram/keys.js');
const key = (k, extra = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
const mkFlow = () => ({
  nodes: [
    { id: 'a', kind: 'process', ar: 'أ', en: 'A', x: 8 * dk.STEP, y: 8 * dk.STEP, w: 150, h: 60 },
    { id: 'b', kind: 'decision', ar: 'ب', en: 'B', x: 20 * dk.STEP, y: 8 * dk.STEP, w: 150, h: 72 },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b', kind: 'next' }],
});

test('boxes and arrows are one roving group with exactly one Tab stop', () => {
  const flow = mkFlow();
  assert.deepEqual(dk.stops(flow).map((s) => `${s.type}:${s.id}`), ['node:a', 'node:b', 'edge:e1']);
  assert.deepEqual(dk.restStop(flow, null), { type: 'node', id: 'a' }, 'Tab lands on the first box');
  assert.deepEqual(dk.restStop(flow, { type: 'edge', id: 'e1' }), { type: 'edge', id: 'e1' }, 'the last stop used stays the Tab stop');
  assert.deepEqual(dk.restStop(flow, { type: 'node', id: 'gone' }), { type: 'node', id: 'a' }, 'a deleted stop falls back to the first');
  assert.equal(dk.restStop({ nodes: [], edges: [] }, null), null);
});

test('Tab to a box, then ArrowRight: x changed by one snap step; Shift moves four; the sheet clips it', () => {
  const flow = mkFlow();
  const node = flow.nodes[0];
  const stop = dk.restStop(flow, null); // what Tab lands on
  assert.equal(stop.id, 'a');
  const x0 = node.x;
  const it = dk.intent(key('ArrowRight'), { type: stop.type });
  assert.equal(it.do, 'move');
  assert.equal(dk.nudge(node, it.dx, it.dy), true, 'ArrowRight moved nothing');
  assert.ok(node.x > x0, `x did not change (${x0} -> ${node.x})`);
  assert.ok(Math.abs(node.x - (x0 + dk.STEP)) < 1e-6, `one step expected, moved ${(node.x - x0) / dk.STEP} steps`);
  const x1 = node.x;
  const big = dk.intent(key('ArrowLeft', { shiftKey: true }), { type: 'node' });
  dk.nudge(node, big.dx, big.dy);
  assert.ok(Math.abs(node.x - (x1 - 4 * dk.STEP)) < 1e-6, 'Shift+ArrowLeft is four steps');
  const down = dk.intent(key('ArrowDown'), { type: 'node' });
  const y0 = node.y;
  dk.nudge(node, down.dx, down.dy);
  assert.ok(Math.abs(node.y - (y0 + dk.STEP)) < 1e-6, 'ArrowDown is one step down');
  node.x = 0;
  assert.equal(dk.nudge(node, -dk.STEP, 0), false, 'a box at the left edge does not leave the sheet');
  node.x = A4.w - node.w;
  dk.nudge(node, 40 * dk.STEP, 0);
  assert.ok(node.x <= A4.w - node.w, 'a box never leaves the right edge');
  assert.ok(dk.mm(8 * dk.STEP) === Math.round(8 * dk.STEP / MM), 'positions are spoken in whole millimetres');
});

test('Enter and Space select, C starts an arrow from a box only, Escape cancels, Delete removes', () => {
  assert.deepEqual(dk.intent(key('Enter'), { type: 'node' }), { do: 'select' });
  assert.deepEqual(dk.intent(key(' '), { type: 'edge' }), { do: 'select' });
  assert.deepEqual(dk.intent(key('c'), { type: 'node' }), { do: 'connect' });
  assert.equal(dk.intent(key('c'), { type: 'edge' }), null, 'an arrow cannot start an arrow');
  assert.deepEqual(dk.intent(key('Escape'), { type: 'node' }), { do: 'cancel' });
  assert.deepEqual(dk.intent(key('Delete'), { type: 'edge' }), { do: 'delete' });
  assert.equal(dk.intent(key('z', { ctrlKey: true }), { type: 'node' }), null, 'Ctrl+Z is the page\'s undo, not the group\'s');
  assert.equal(dk.intent(key('c', { ctrlKey: true }), { type: 'node' }), null, 'Ctrl+C is the browser\'s copy');
});

test('PageDown, PageUp, Home and End walk the group without wrapping; arrow keys walk on an arrow line', () => {
  const flow = mkFlow();
  const at = { type: 'node', id: 'a' };
  assert.equal(dk.walk(flow, at, 'next').id, 'b');
  assert.equal(dk.walk(flow, { type: 'node', id: 'b' }, 'next').id, 'e1', 'boxes first, then arrows');
  assert.equal(dk.walk(flow, { type: 'edge', id: 'e1' }, 'next').id, 'e1', 'it does not wrap round');
  assert.equal(dk.walk(flow, at, 'prev').id, 'a');
  assert.equal(dk.walk(flow, at, 'last').id, 'e1');
  assert.equal(dk.walk(flow, { type: 'edge', id: 'e1' }, 'first').id, 'a');
  assert.deepEqual(dk.intent(key('PageDown'), { type: 'node' }), { do: 'walk', how: 'next' });
  assert.deepEqual(dk.intent(key('End'), { type: 'node' }), { do: 'walk', how: 'last' });
  assert.deepEqual(dk.intent(key('ArrowRight'), { type: 'edge' }), { do: 'walk', how: 'next' });
  assert.deepEqual(dk.intent(key('ArrowUp'), { type: 'edge' }), { do: 'walk', how: 'prev' });
});

test('the diagram page wires the group: role, name, one Tab stop, and every change is spoken', () => {
  const src = readFileSync(new URL('../diagram/diagram.js', import.meta.url), 'utf8');
  assert.match(src, /setAttribute\('role', 'button'\)/, 'boxes and arrows are not buttons');
  assert.match(src, /setAttribute\('tabindex', keys\.same\(s, rest\) \? '0' : '-1'\)/, 'no roving tabindex');
  assert.match(src, /setAttribute\('aria-label'/, 'no accessible name');
  assert.match(src, /keys\.intent\(e,/, 'the sheet does not read keys through the model');
  for (const k of ['selected', 'moved', 'edgeOfSheet', 'connectFrom', 'connected', 'connectSame', 'cancelled', 'removed']) {
    assert.match(src, new RegExp(`say\\(t\\('diagram\\.a11y\\.${k}'`), `${k} is not announced through say()`);
  }
  const en = JSON.parse(readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  for (const k of Object.keys(en).filter((x) => x.startsWith('diagram.a11y.'))) assert.ok(ar[k], `${k} has no Arabic`);
  assert.ok(en['diagram.a11y.sheet'] && en['diagram.a11y.node'] && en['diagram.a11y.edge']);
  const css = readFileSync(new URL('../diagram/diagram.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-node\]:focus-visible/, 'a focused box shows no ring');
});

test('D-1010-175 (UI side): link-requirements sits beside link-story, is labelled, and collectOptions returns a clean array', () => {
  const html = readFileSync(new URL('../report/report.html', import.meta.url), 'utf8');
  assert.match(html, /<label class="field"><span data-i18n="report\.file\.requirements">Requirements<\/span><input type="text" id="link-requirements"/, 'the labelled input is missing');
  assert.ok(html.indexOf('id="link-requirements"') > html.indexOf('id="link-story"'), 'it belongs after the story');
  const en = JSON.parse(readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  assert.equal(en['report.file.requirements'], 'Requirements');
  assert.equal(ar['report.file.requirements'], 'المتطلبات');
  const src = readFileSync(new URL('../report/istqb.js', import.meta.url), 'utf8');
  assert.match(src, /requirements: requirementList\(\),/, 'collectOptions does not return o.requirements');
  const line = /const requirementList = (.*);\n/.exec(src);
  assert.ok(line, 'requirementList not found');
  const list = (v) => new Function('$', `return (${line[1]})();`)(() => ({ value: v }));
  assert.deepEqual(list(' REQ-1, REQ-2 ,, REQ-1 ,'), ['REQ-1', 'REQ-2'], 'trimmed, deduplicated, empties dropped');
  assert.deepEqual(list('A، B;C\nD'), ['A', 'B', 'C', 'D'], 'an Arabic comma, a semicolon and a newline separate too');
  assert.deepEqual(list(''), [], 'nothing typed is an empty array');
  assert.deepEqual(new Function('$', `return (${line[1]})();`)(() => null), [], 'no input on the page is an empty array');
});

test('r10-04-1 (D-238): #defect-build and #defect-repro are labelled, repro offers always/sometimes/once/unknown with unknown selected, and both languages hold the words', () => {
  const html = readFileSync(new URL('../report/report.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<label class="field"><span data-i18n="report.file.defectBuild">Build or version</span><input type="text" id="defect-build"'), 'the labelled build input is missing');
  const sel = /<label class="field"><span data-i18n="report\.file\.defectRepro">How often it happens<\/span>\s*<select id="defect-repro">([\s\S]*?)<\/select>/.exec(html);
  assert.ok(sel, 'the labelled repro select is missing');
  const values = [...sel[1].matchAll(/<option value="([a-z]+)"[^>]*?(selected)?>/g)].map((m) => [m[1], !!m[2]]);
  assert.deepEqual(values.map((v) => v[0]), ['always', 'sometimes', 'once', 'unknown']);
  assert.deepEqual(values.filter((v) => v[1]).map((v) => v[0]), ['unknown'], 'unknown is the default');
  assert.ok(html.indexOf('id="defect-build"') > html.indexOf('id="jira-summary"') && html.indexOf('id="defect-build"') < html.indexOf('id="jira-body"'), 'they sit between the summary and the description');
  const en = JSON.parse(readFileSync(new URL('../platform/i18n/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  const want = {
    'report.file.defectBuild': ['Build or version', 'الإصدار أو البناء'], 'report.file.defectRepro': ['How often it happens', 'مدى تكرار الحدوث'],
    'report.file.reproAlways': ['Every time', 'في كل مرة'], 'report.file.reproSometimes': ['Sometimes', 'أحيانًا'],
    'report.file.reproOnce': ['Once', 'مرة واحدة'], 'report.file.reproUnknown': ['Unknown', 'غير معروف'],
  };
  for (const [k, [e, a]] of Object.entries(want)) { assert.equal(en[k], e, k); assert.equal(ar[k], a, k); }
  const src = readFileSync(new URL('../report/istqb.js', import.meta.url), 'utf8');
  assert.ok(src.includes("body: withDefectNotes($('jira-body').value)"), 'the filed body does not carry the two notes');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
