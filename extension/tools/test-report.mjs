/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The report page: its charts, its window-sizes section, and two rules about
 * what must never end up in a file.
 *
 *   node tools/test-report.mjs
 *
 * The page itself needs a browser, so what is checked here is everything that
 * does not: the chart arithmetic, which lives in `core/chart-model.js` precisely
 * so a test can reach it; the export-size and credential rules, which are pure;
 * and a short list of structural facts about `report/` that a source read can
 * settle and a person cannot be relied on to notice.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bucketise, barRows, meterFor, VITAL_BOUNDS, runRow, describeRun, joinWords, tableFor, relative,
} from '../core/chart-model.js';
import { inlinePlan, describeOmitted, INLINE_BUDGET, INLINE_IMAGE_MAX } from '../core/artifact.js';
// The document builders moved out of the worker's boot graph on 8 Sept 2026.
import { buildMarkdown } from '../core/artifact-docs.js';
import { problemCounts, agreeWithProblems } from '../core/finding-count.js';
import { headline } from '../core/artifact-docs.js';
import { countFindings, findingTotals, foldFinding, BLANK_FINDINGS } from '../core/sessions.js';
import { VERSION } from '../core/exporters.js';
import { summaryMarkdown, checkUrl } from '../platform/chat-mattermost.js';
import { buildDefectReport } from '../core/istqb.js';
import { buildPostmanCollection, buildPostmanEnvironment } from '../core/postman.js';
import { defectToMarkdown } from '../core/istqb-render.js';
import { workerSrc } from './lib-worker-src.mjs';

import { surfaceSource } from './lib-src.mjs';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('the report page');

/* ── the session on one clock ────────────────────────────────────────────── */

const T = 1_757_000_000_000;
const bad = (e) => e.kind === 'pageerror';

test('events land in the bucket their timestamp belongs to', () => {
  const built = bucketise(
    [{ ts: T, kind: 'dom' }, { ts: T + 5000, kind: 'dom' }, { ts: T + 9999, kind: 'pageerror' }],
    { start: T, end: T + 10_000, buckets: 10, isFailure: bad }
  );
  assert.equal(built.buckets.length, 10);
  assert.equal(built.buckets[0].n, 1);
  assert.equal(built.buckets[5].n, 1);
  assert.equal(built.buckets[9].n, 1, 'the last event belongs in the last bucket, not past the end');
  assert.equal(built.buckets[9].fail, 1);
  assert.equal(built.peak, 1);
});

test('an event on the end boundary is not dropped off the chart', () => {
  const built = bucketise([{ ts: T + 10_000, kind: 'dom' }], { start: T, end: T + 10_000, buckets: 10 });
  assert.equal(built.buckets[9].n, 1, 'an event at exactly the end must be clamped into the last bucket');
});

test('a session recorded in a blink still divides', () => {
  const built = bucketise([{ ts: T, kind: 'dom' }, { ts: T, kind: 'dom' }], { start: T, end: T, buckets: 10 });
  assert.equal(built.span, 1000, 'the span has a floor, so nothing divides by zero');
  assert.equal(built.buckets[0].n, 2);
});

/*
 * A session with events in it must never draw nothing.
 *
 * The clock came only from the session record. A session read back without a
 * usable `startedAt` — an export, a run still going when the report was
 * opened — made every index `NaN`, `list[NaN]` is `undefined`, and the first
 * event threw on `.n++`: the chart drew nothing at all for a session that
 * plainly had events in it, which is the one thing an activity chart must not
 * do. The events carry the same clock, so they are the fallback.
 */
test('a session with no usable start still charts, off its own events', () => {
  const built = bucketise(
    [{ ts: T, kind: 'dom' }, { ts: T + 10_000, kind: 'pageerror' }],
    { start: undefined, end: undefined, buckets: 10, isFailure: bad }
  );
  assert.equal(built.start, T, 'the first event is the start when the session cannot say');
  assert.equal(built.buckets.reduce((n, b) => n + b.n, 0), 2, 'the events fell off the chart');
  assert.equal(built.buckets[9].fail, 1);
});

test('an event with no readable timestamp is counted, not dropped and not fatal', () => {
  const built = bucketise(
    [{ ts: T, kind: 'dom' }, { kind: 'dom' }, { ts: 'later', kind: 'dom' }],
    { start: T, end: T + 10_000, buckets: 10 }
  );
  assert.equal(built.buckets.reduce((n, b) => n + b.n, 0), 3, 'an unreadable timestamp lost the event');
  assert.equal(built.buckets[0].n, 3, 'it belongs at the start of the run, not at an undefined index');
});

test('one event is still a chart, because one failure is the run people read', () => {
  const charts = read('report/charts.js');
  const fn = charts.slice(charts.indexOf('async function activity('), charts.indexOf('/* ── magnitude'));
  assert.ok(!/events\.length < 2/.test(fn), 'a single-event session is told there is nothing to draw');
  assert.ok(/if \(!events\.length\)/.test(fn), 'only an empty session has nothing to chart');
});

/* ── magnitude across named things ───────────────────────────────────────── */

test('bars are longest first and widths are a share of the longest', () => {
  const { rows, max, total } = barRows([
    { label: 'Request', value: 4 },
    { label: 'Action', value: 10 },
    { label: 'Note', value: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ['Action', 'Request', 'Note']);
  assert.equal(max, 10);
  assert.equal(total, 15);
  assert.equal(rows[0].width, 100);
  assert.equal(rows[1].width, 40);
});

test('a row worth nothing is not drawn as a bar of nothing', () => {
  const { rows } = barRows([{ label: 'Action', value: 3 }, { label: 'Nothing', value: 0 }]);
  assert.deepEqual(rows.map((r) => r.label), ['Action']);
});

test('the ninth kind folds into one row rather than becoming a ninth colour', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `k${i}`, value: 12 - i }));
  const { rows } = barRows(many, { top: 8 });
  assert.equal(rows.length, 9, 'eight rows and one fold');
  const fold = rows[8];
  assert.ok(fold.folded.length === 4, 'the fold names what it stands for');
  assert.equal(fold.value, many.slice(8).reduce((n, r) => n + r.value, 0), 'nothing is silently dropped');
});

test('the table twin lists every kind, including the folded ones', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `k${i}`, value: 12 - i }));
  const table = tableFor('bars', barRows(many, { top: 8 }));
  const text = table.rows.map((r) => r[0]).join(' ');
  for (const row of many) assert.ok(text.includes(row.label), `${row.label} is missing from the table view`);
});

/* ── one measurement against its threshold ───────────────────────────────── */

test('the vitals boundaries are the ones the measurement was rated against', () => {
  // Two copies exist on purpose: one in a content script that runs inside a
  // stranger's page, one here. They must be the same two numbers.
  const src = read('content/vitals.js');
  const block = src.slice(src.indexOf('const RATE'), src.indexOf('const rate ='));
  for (const [key, [good, poor]] of Object.entries(VITAL_BOUNDS)) {
    assert.ok(
      new RegExp(`${key}:\\s*\\[${good},\\s*${poor}\\]`).test(block),
      `${key} is [${good}, ${poor}] in the chart model and something else in content/vitals.js`
    );
  }
});

test('a metric is rated on the same boundaries it is drawn against', () => {
  assert.equal(meterFor('lcp', 2500).rating, 'good', 'the boundary itself is still good');
  assert.equal(meterFor('lcp', 2501).rating, 'needs work');
  assert.equal(meterFor('lcp', 4001).rating, 'poor');
  const m = meterFor('lcp', 2500);
  assert.equal(m.goodAt, (2500 / 6000) * 100);
  assert.ok(m.valueAt === m.goodAt, 'the marker sits on the boundary it equals');
});

test('a value past the end of the scale is clamped and says so', () => {
  const m = meterFor('lcp', 99_999);
  assert.equal(m.valueAt, 100);
  assert.equal(m.beyond, true, 'the caller has to be able to explain why the marker stopped');
});

test('a metric nobody measured is not a zero', () => {
  assert.equal(meterFor('inp', null), null);
  assert.equal(meterFor('inp', undefined), null);
  const table = tableFor('meters', [{ label: 'INP', unit: 'ms', meter: meterFor('inp', null) }]);
  assert.equal(table.rows[0][1], 'not measured', 'the table twin must not print 0 for an absent measurement');
});

/* ── window sizes, to the contract in research/55 ────────────────────────── */

const RUN = {
  runId: 'vr_l8x2k9_1a',
  viewport: { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
  measured: { w: 390, h: 800 },
  openedAt: T,
  closedAt: T + 60_000,
  durationMs: 60_000,
  inherited: { video: false, mask: true, mic: false, tabAudio: false },
  refused: ['video', 'webcam'],
};

test('the gap between the size asked for and the size given is computed', () => {
  const row = runRow(RUN);
  assert.deepEqual(row.shortBy, { w: 0, h: 44 }, 'the 44px the frame ate is where a breakpoint hides');
});

test('a run that never closed is still a row', () => {
  const row = runRow({ runId: 'x', openedAt: T, viewport: RUN.viewport });
  assert.equal(row.closedAt, null, 'still open is null, never a zero duration');
  assert.equal(row.durationMs, null);
  assert.deepEqual(row.refused, []);
});

test('what a run carried over is read from the run, never re-derived', () => {
  const line = describeRun(runRow(RUN));
  assert.match(line, /Carried over: masking\./);
  assert.match(line, /Not carried: video and webcam\./);
  const nothing = describeRun(runRow({ runId: 'y', openedAt: T, inherited: {} }));
  assert.match(nothing, /Nothing was carried over/);
});

test('joinWords reads as a sentence at one, two and three', () => {
  assert.equal(joinWords(['a']), 'a');
  assert.equal(joinWords(['a', 'b']), 'a and b');
  assert.equal(joinWords(['a', 'b', 'c']), 'a, b and c');
});

test('the report reads the worker fold rather than folding the events again', () => {
  const src = surfaceSource('report/report.js');
  assert.ok(src.includes('UQA_VIEWPORT_RUNS'), 'section 8 of the contract: read the handler G built');
  assert.ok(
    !/kind\s*===\s*'viewport'/.test(src),
    'the report must not walk the viewport events itself; that is a second fold that can disagree'
  );
});

test('one clip, one home: a media record with a runId is not in the gallery', () => {
  const src = surfaceSource('report/report.js');
  assert.ok(/const ownMedia = \(\) => media\.filter\(\(m\) => !m\.runId\);/.test(src));
  assert.ok(/const runMedia = \(runId\) => media\.filter\(\(m\) => m\.runId === runId\);/.test(src));
  // The gallery and its save button both have to read the filtered list, or the
  // count and the files disagree.
  const at = src.indexOf('function renderGallery');
  const gallery = src.slice(at, src.indexOf('async function lightbox', at));
  assert.ok(/for \(const item of mine\)/.test(gallery), 'the gallery draws ownMedia, not every record');
  assert.ok(/const mine = ownMedia\(\);/.test(gallery), 'and reads it once at the top');
});

test('the Window sizes tab exists, is named, and has a count', () => {
  const html = read('report/report.html');
  assert.ok(html.includes('data-tab="sizes"'), 'the contract fixes the tab id as sizes');
  assert.ok(html.includes('id="count-sizes"'), 'the contract fixes the count element as count-sizes');
  assert.ok(html.includes('Window sizes'), 'the contract fixes the section name');
  assert.ok(surfaceSource('report/report.js').includes("'sizes'"), 'the tab is in the TABS list');
});

/* ── the diagram is a tab, not a button in the corner (F2) ───────────────── */

test('the diagram is one of the views, not one of the actions', () => {
  const html = read('report/report.html');
  assert.ok(html.includes('data-tab="diagram"'), 'the diagram has a tab');
  assert.ok(html.includes('id="panel-diagram"'), 'and a panel to draw into');
  const bar = html.slice(html.indexOf('bar-actions'), html.indexOf('</header>'));
  assert.ok(!/id="diagram"/.test(bar), 'and is no longer a button in the action bar');
});

test('the diagram is parsed as data, never as markup', () => {
  const src = surfaceSource('report/report.js');
  const fn = src.slice(src.indexOf('async function renderDiagram'), src.indexOf('$(\'diagram-open\')'));
  assert.ok(fn.includes('DOMParser'), 'the SVG carries labels from a stranger\'s page');
  assert.ok(!fn.includes('innerHTML'), 'innerHTML on session-derived text is the bug this must not have');
});

/* ── the charts fetch nothing, and invent no palette ─────────────────────── */

test('no chart library, from a CDN or anywhere else', () => {
  const html = read('report/report.html');
  assert.ok(!/src="https?:\/\//.test(html), 'the page loads nothing over the network');
  const charts = read('report/charts.js');
  assert.ok(!/\bfetch\s*\(/.test(charts), 'a chart must not fetch');
  assert.ok(!/import\(['"]https?:/.test(charts), 'and must not import from a URL');
});

/*
 * The mark the headed suite counts is the mark the page draws.
 *
 * `tools/diagnose.mjs` asserted "the activity chart drew nothing" by counting
 * `#sparkline .spark-bar` — the hand-rolled sparkline `report.js` used to
 * paint. The chart moved into `report/charts.js` as an SVG of `.chart-bar`
 * rects in `#chart-activity`, neither the old id nor the old class exists in
 * `report.html` any more, and the count could only ever answer zero. A stale
 * selector in a headed suite is the most expensive kind of failure: it reads
 * as a broken feature and it is a broken question, and this is the assertion
 * that keeps the two names tied together in Node.
 */
test('the headed suite counts the mark the chart actually draws', () => {
  const html = read('report/report.html');
  const charts = read('report/charts.js');
  const diagnose = read('tools/diagnose.mjs');
  assert.ok(html.includes('id="chart-activity"'), 'report.html has no host for the activity chart');
  assert.ok(charts.includes("'chart-bar is-bad' : 'chart-bar'"), 'the painter no longer marks the bars chart-bar');
  assert.ok(
    diagnose.includes('#chart-activity .chart-bar'),
    'tools/diagnose.mjs is counting a mark this page does not draw'
  );
  assert.ok(!/#sparkline|\.spark-bar/.test(html + charts), 'the retired sparkline is still drawn by the page');
  assert.ok(
    !/querySelectorAll\('#sparkline/.test(diagnose),
    'the headed suite is still querying the retired sparkline'
  );
});

/*
 * The chart must not arrive after the page it is part of.
 *
 * `charts.js` is a classic script and the arithmetic is a module, so the only
 * way across is `import()` — and it was started by the first chart that needed
 * it, which put a module fetch on the critical path of the overview's own
 * chart. The hero, the cards and the timeline painted; the chart under them
 * landed a beat later into a box that was empty until it did. Measured: four
 * opens in ten were caught mid-gap.
 */
test('the chart model is fetched when the page loads, not when the first chart draws', () => {
  const charts = read('report/charts.js');
  assert.ok(!/\|\|= await import\(/.test(charts), 'the first chart still pays for the module fetch');
  assert.match(charts, /const modelReady = import\('\.\.\/core\/chart-model\.js'\);/);
  assert.match(charts, /modelReady\.catch\(/, 'a failed import would be an unhandled rejection at load');
});

test('the headed suite waits for the chart it is about to count', () => {
  const diagnose = read('tools/diagnose.mjs');
  const step = diagnose.slice(
    diagnose.indexOf('the report opens on something you can read at a glance'),
    diagnose.indexOf('const shape = await view.evaluate')
  );
  assert.ok(
    /waitForFunction\([\s\S]*chart-activity/.test(step),
    'it counts the bars without waiting for them, so a slow open reads as a broken chart'
  );
});

/*
 * MANUAL is not DECLARED wearing a different word.
 *
 * The fine-print block's tone ladder ended `: 'sev-minor'`, which caught
 * DECLARED and MANUAL together — so a row the browser could not measure was
 * painted exactly like a row that passed. That turns "nobody checked" into
 * "fine", which is the one thing this block exists not to do.
 */
test('the fine print gives MANUAL a mark of its own', () => {
  const report = surfaceSource('report/report.js');
  assert.ok(/check\.status === 'MANUAL'/.test(report), 'MANUAL falls through to the pass tone');
  assert.ok(/sev-unknown/.test(report), 'MANUAL has no class of its own');
  assert.ok(/\.sev-unknown\s*\{[^}]*dashed/.test(read('report/report.css')), 'sev-unknown is not drawn, or reads as a pass');
  assert.ok(/c\.unmeasured/.test(report), 'the headline counts declared, observed and gaps but not the unmeasured');
});

test('the charts are drawn from the palette, not from literals', () => {
  const charts = read('report/charts.js');
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(charts), 'a colour in the painter escapes the theme');
});

test('every chart ships a table twin', () => {
  const charts = read('report/charts.js');
  for (const kind of ['activity', 'bars', 'meters']) {
    const at = charts.indexOf(`async function ${kind}(`);
    assert.ok(at > 0, `${kind} is missing`);
    assert.ok(
      charts.slice(at, at + 3000).includes('tableFor('),
      `${kind} draws no table view, so its values are reachable only by hovering`
    );
  }
});

/* ── the export-size rule (research/54, finding 12) ──────────────────────── */

const bigImage = `data:image/png;base64,${'A'.repeat(700 * 1024)}`;
const smallImage = `data:image/png;base64,${'A'.repeat(40 * 1024)}`;

test('an image bigger than the per-image cap is never embedded', () => {
  const plan = inlinePlan([{ captureId: 'a' }], { a: { dataUrl: bigImage } });
  assert.equal(plan.get('a').inline, false);
  assert.ok(bigImage.length > INLINE_IMAGE_MAX);
});

test('a document stops embedding once its budget is spent, and says which', () => {
  const shots = Array.from({ length: 120 }, (_, i) => ({ captureId: `c${i}` }));
  const captures = Object.fromEntries(shots.map((s) => [s.captureId, { dataUrl: smallImage }]));
  const plan = inlinePlan(shots, captures);
  const inlined = shots.filter((s) => plan.get(s.captureId).inline);
  const spent = inlined.length * smallImage.length;
  assert.ok(spent <= INLINE_BUDGET, 'the budget was overspent');
  assert.ok(inlined.length > 0, 'the budget must still buy some pictures');
  assert.ok(inlined.length < shots.length, 'this fixture is meant to exceed the budget');
  // In order: the first pictures taken are the ones the reader wants.
  assert.equal(plan.get('c0').inline, true);
  assert.equal(plan.get('c119').inline, false);
});

test('a picture the document does not carry is named, not dropped', () => {
  const plan = inlinePlan([{ captureId: 'a' }], { a: { dataUrl: bigImage } });
  const line = describeOmitted(plan.get('a'), 1);
  assert.match(line, /Screenshot 1/);
  assert.match(line, /saved beside this document/);
  assert.ok(!line.includes('undefined'));
});

test('the bug report is a file a person can open', () => {
  const session = { id: 's1', charter: 'A walk', startedAt: T, endedAt: T + 1000, env: {} };
  const shots = Array.from({ length: 60 }, (_, i) => ({ kind: 'screenshot', ts: T + i, captureId: `c${i}` }));
  const captures = Object.fromEntries(shots.map((s) => [s.captureId, { dataUrl: smallImage }]));
  const md = buildMarkdown(session, shots, captures);
  // research/54 measured the old one at 13.7 MB on a real session.
  assert.ok(md.length < 3 * 1024 * 1024, `the report is ${Math.round(md.length / 1024 / 1024)} MB`);
  assert.match(md, /are embedded below/, 'and it says which of its pictures it is carrying');
});

/* ── nothing quotes a build that does not exist ──────────────────────────── */

test('the version stamped on every export is read, not typed', () => {
  const src = read('core/exporters.js');
  assert.ok(
    /export const VERSION = globalThis\.chrome\?\.runtime\?\.getManifest/.test(src),
    'a constant somebody has to remember to bump is a constant that will be wrong'
  );
  // In Node there is no manifest, and the fallback must be obviously not a
  // release: research/54 found every artefact in a real folder stamped 1.10.0
  // while the manifest said 3.1.0, and 1.10.0 looked like a fact.
  assert.equal(VERSION, '0.0.0-dev');
  const manifest = JSON.parse(read('manifest.json'));
  assert.notEqual(VERSION, manifest.version, 'the fallback must not be mistakable for the real build');
});

/* ── a credential never reaches a file (research/51d, section 7) ─────────── */

/** The settings keys that hold a secret, as `platform/settings.js` itself lists them. */
const CREDENTIAL_FIELDS = /\b(jira|slack|trackers|webhooks|mattermost)\s*[.[]|\bapiKey\b|authHeader/;

test('no export builder can read a credential, so none can write one out', () => {
  // The regression research/51d asks for, made structural rather than a single
  // string search. An export builder is handed a session and its events and
  // nothing else; if none of them can even name a credential field, no export
  // can leak one however the builders change next year.
  //
  // `core/postman.js` is not in this list and is checked separately below: it is
  // the one builder that has to *name* the Authorization header, because its
  // whole job there is to replace the value with an empty variable.
  for (const file of ['core/exporters.js', 'core/artifact.js', 'core/docs.js', 'core/istqb.js', 'core/istqb-render.js', 'core/suite.js']) {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!CREDENTIAL_FIELDS.test(src), `${file} reads something credential-shaped`);
  }
});

test('the Postman export declares the token and ships it empty', () => {
  const session = { id: 's1', charter: 'A walk', startedAt: T, startUrl: 'https://app.test/', env: {} };
  const events = [
    {
      kind: 'net',
      ts: T + 10,
      method: 'GET',
      url: 'https://app.test/api/thing',
      status: 200,
      durationMs: 5,
      requestHeaders: { authorization: 'Bearer sk-live-DO-NOT-SHIP-THIS', cookie: 'sid=abc123' },
    },
  ];
  for (const build of [buildPostmanCollection, buildPostmanEnvironment]) {
    const text = build(session, events, { build: '9.9.9' });
    const json = typeof text === 'string' ? text : JSON.stringify(text);
    assert.ok(!json.includes('sk-live-DO-NOT-SHIP-THIS'), `${build.name} shipped a bearer token`);
    assert.ok(!json.includes('sid=abc123'), `${build.name} shipped a cookie value`);
  }
});

test('the Mattermost token is held locally and never logged', () => {
  const src = read('platform/chat-mattermost.js');
  assert.ok(!/console\.(log|warn|error|info)/.test(src), 'nothing here may print, and a token is in scope throughout');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(code.includes('chrome.storage.local'), 'local, so it stays in the profile that typed it');
  assert.ok(!/storage\.sync/.test(code), 'a synced secret is a copy on every signed-in machine');
  // The error path is the easy place to leak one: a message built from the
  // request would carry the Authorization header into a status line.
  const call = src.slice(src.indexOf('async function call('), src.indexOf('export async function whoAmI'));
  assert.ok(!/headers/.test(call.slice(call.indexOf('if (!res.ok)'))), 'the refusal path must not touch the headers');
});

test('a summary posted to a channel carries the facts and no credential', () => {
  const md = summaryMarkdown(
    { title: 'Submit fails', where: 'https://app.test/apply', severity: 'critical', priority: 'highest', counts: { failures: 2, events: 40, steps: 12 } },
    { 'Open the report': 'chrome-extension://x/report/report.html' }
  );
  assert.match(md, /Submit fails/);
  assert.match(md, /2 problems in 40 events/);
  assert.ok(!/Bearer|token/i.test(md));
});

test('a Mattermost server address must be https, or this machine', () => {
  assert.equal(checkUrl('https://mm.example.test/'), 'https://mm.example.test');
  assert.equal(checkUrl('http://127.0.0.1:8065'), 'http://127.0.0.1:8065');
  assert.throws(() => checkUrl('http://mm.example.test'), /https/);
  assert.throws(() => checkUrl(''), /server/);
});

/* ── the trademark rule (research/51d, sections 6 and 8) ─────────────────── */

test('Jira and Mattermost are named in words, never shown as a mark', () => {
  const html = read('report/report.html');
  for (const name of ['Jira', 'Mattermost']) {
    assert.ok(html.includes(name), `${name} should be named in words`);
  }
  // Nominative use of a name is defensible; a logo is not, and Mattermost asks
  // for written approval before any use of its marks.
  assert.ok(!/<img[^>]+(jira|mattermost|atlassian)/i.test(html), 'no third-party mark is displayed');
});

/* ── the ISTQB defect report carries what the syllabus names (F6) ────────── */

test('a filed defect says who found it, when, and at what level', () => {
  const session = {
    id: 's_abcd',
    charter: 'Submit an application',
    startedAt: T,
    startUrl: 'https://app.test/apply',
    env: { userAgent: 'Chrome/126', viewport: '1920x1080', platform: 'Win32', language: 'en' },
  };
  const events = [
    { kind: 'dom', ts: T + 1000, action: 'click', label: 'Submit', frameUrl: 'https://app.test/apply' },
    { kind: 'net', ts: T + 1400, method: 'POST', url: 'https://app.test/api/x', status: 500, durationMs: 20, frameUrl: 'https://app.test/apply' },
  ];
  const d = buildDefectReport(session, events, { level: 'System', type: 'Functional', tester: 'Nader' });
  assert.equal(d.testLevel, 'System');
  assert.equal(d.testType, 'Functional');
  assert.equal(d.reportedBy, 'Nader');

  const md = defectToMarkdown(d);
  assert.match(md, /\| Reported \|/, 'the date of reporting is one of the named contents');
  assert.match(md, /\| Reported by \| Nader \|/);
  assert.match(md, /\| Test level \| System \|/);
  assert.match(md, /\| Test type \| Functional \|/);
  // And the fields it already had must still be there.
  assert.match(md, /## Expected vs actual/);
  assert.match(md, /## Steps to reproduce/);
  assert.match(md, /## Environment/);
});

/* ── the clock reads the same everywhere ─────────────────────────────────── */

test('relative time is the same clock the timeline prints', () => {
  assert.equal(relative(T + 12_300, T), '+12.30s');
});


/* ── one number, three surfaces ─────────────────────────────────────────── */

/*
 * The report's headline, the popup's live line and the Markdown export each
 * print "how many problems did this run find", and each used to work it out its
 * own way: first-party failures, every failure including an ad blocker's, and a
 * bracketed count in a table row. On the session in research/58 the first of
 * those said **0** while the timeline held four clipped elements, 83
 * accessibility violations, two broken links and five fine-print gaps.
 *
 * The fix is one function in `core/sessions.js`. What is asserted here is that
 * all three actually call it, and that the number they end up with is the same
 * one, computed by whichever route that surface can afford: the report and the
 * export fold the whole session, and the worker advances a running tally an
 * event at a time because the popup asks every couple of seconds.
 */

const A0 = 1_757_200_000_000;
const findingSession = {
  id: 's_find',
  charter: 'Acme site mock-up',
  startedAt: A0,
  endedAt: A0 + 81_600,
  startUrl: 'https://portal.test/',
  status: 'stopped',
};
const findingEvents = [
  { kind: 'nav', url: 'https://portal.test/', ts: A0 + 10, frameUrl: 'https://portal.test/' },
  { kind: 'net', url: 'https://beacon.ads-co.test/x', status: 503, ts: A0 + 20, frameUrl: 'https://portal.test/' },
  { kind: 'a11y', total: 83, byImpact: { critical: 0, serious: 17, moderate: 66, minor: 0 }, violations: [], ts: A0 + 30, frameUrl: 'https://portal.test/' },
  { kind: 'links', broken: [{ href: 'https://portal.test/#privacy' }, { href: 'https://portal.test/#legal' }], redirected: [], slow: [], ts: A0 + 40, frameUrl: 'https://portal.test/' },
  { kind: 'rtl', enabled: true, overflowCount: 2, ts: A0 + 50, frameUrl: 'https://portal.test/' },
  { kind: 'rtl', enabled: true, overflowCount: 2, ts: A0 + 60, frameUrl: 'https://frame.other/' },
  { kind: 'fineprint', counts: { gaps: 5, declared: 13, manual: 18, total: 22 }, checks: [], ts: A0 + 70, frameUrl: 'https://portal.test/' },
];

test('the report headline, the popup count and the export agree', () => {
  const expected = countFindings(findingEvents, { session: findingSession });
  assert.equal(expected.total, 94, 'the run in research/58, counted honestly');

  // 1. the report page. It cannot be executed here, so what is checked is that
  //    it reads the shared function rather than reaching for `own.length`.
  const reportSrc = surfaceSource('report/report.js');
  assert.match(reportSrc, /import\('\.\.\/core\/sessions\.js'\)/,
    'report/report.js must load the shared count');
  assert.match(reportSrc, /sessionsLib\.countFindings\(events, \{ session \}\)/,
    'the headline must come from countFindings');
  assert.match(reportSrc, /el\('span', 'verdict-num', String\(found\.total\)\)/,
    'the number painted in the verdict chip must be that total');

  // 2. the worker, which is what the popup paints. It folds one event at a time.
  let tally = foldFinding(BLANK_FINDINGS, { kind: 'nav', url: findingSession.startUrl, ts: findingSession.startedAt });
  for (const e of findingEvents) tally = foldFinding(tally, e);
  assert.equal(findingTotals(tally).total, expected.total,
    'the running tally the popup reads must land on the same number as the batch fold');
  const wsrc = workerSrc();
  assert.match(wsrc, /findingCount: findingTotals\(state\.findings\)\.total/,
    'UQA_GET_STATE must answer with the shared count');
  assert.match(surfaceSource('popup/popup.js'), /findingCount/,
    'the popup must paint the finding count, not only the failure count');

  // 3. the Markdown export, which a person reads on its own.
  const md = buildMarkdown(findingSession, findingEvents, {});
  // ui-1016 L: the Findings row is the tool findings plus the same problem groups the Problems row and the headline sentence print (here 94 + 1 third-party warning group).
  const findingsRow = agreeWithProblems(expected, findingEvents).total;
  assert.equal(findingsRow, 95);
  assert.ok(md.includes(`| Findings | ${findingsRow} |`),
    `the Markdown export must print ${findingsRow}; it printed:\n${md.split('\n').filter((l) => l.startsWith('| ')).join('\n')}`);
  assert.ok(md.includes('| Events | 7 |'),
    'Events is the raw count only: a "(N failures)" beside the Problems row read as a second, contradicting number (ui-1016 K3)');

  // 4. the headline (spec s7): problems after the noise rules (the third-party 503 is one Warning) plus the 94 tool findings.
  const h = headline(findingEvents, findingSession);
  assert.equal(h.problems, 1, 'the beacon 503 is one third-party Warning');
  assert.equal(h.tool, 94, 'a11y 83 + broken links 2 + layout 4 + fine print 5');
  assert.equal(h.total, 95, 'the number every surface and export states');
  // 1011 P0-3 (Lead decision): the Markdown Problems row prints distinct problems (core/finding-count.js), the same unit as the popup and the report; the 94 tool findings are the Findings row above.
  assert.ok(md.includes(`| Problems | ${problemCounts(findingEvents).groups} |`), 'the Markdown export states the distinct problem count in its Problems row');
  assert.match(reportSrc, /found.total = num;/, 'the chip prints problems plus tool findings');
  assert.match(reportSrc, /sg.num/, 'the report reads the signal headline');
  assert.match(surfaceSource('popup/popup.js'), /sg.num/, 'the popup reads the same headline');
});

test('a session where nothing failed but tools found things is not reported as clean', () => {
  const quiet = findingEvents.filter((e) => e.kind !== 'net');
  const t = countFindings(quiet, { session: findingSession });
  assert.equal(t.failures, 0);
  assert.equal(t.total, 94);
  assert.equal(headline(quiet, findingSession).total, 94, 'no network problem, 94 tool findings: not clean');
  assert.ok(buildMarkdown(findingSession, quiet, {}).includes('| Findings | 94 |') && buildMarkdown(findingSession, quiet, {}).includes('| Problems | 0 |'),
    'this is the exact shape of research/58: 0 failures, 94 findings: the Findings row says 94, so the export is not read as clean');
});

/* ── the selectors a tester copied ───────────────────────────────────────── */

/**
 * "Add selector copy in the report that holds all the copied selectors with an
 * element preview on the right of each one and a timeline info so I know when I
 * took it." Four facts a source read can settle, and a person cannot be relied
 * on to notice going wrong.
 */
const SELCOPY_HTML = read('report/report.html');
const SELCOPY_JS = surfaceSource('report/report.js');
const SELCOPY_CSS = read('report/report.css');
const EN_I18N = JSON.parse(read('platform/i18n/en.json'));
const AR_I18N = JSON.parse(read('platform/i18n/ar.json'));

test('the report has a Selector copy section, named in both languages', () => {
  assert.ok(/id="selcopy-block"/.test(SELCOPY_HTML), 'no section in report.html');
  assert.ok(/data-i18n="report.selcopy.title"/.test(SELCOPY_HTML), 'the heading is not translated');
  assert.equal(EN_I18N['report.selcopy.title'], 'Selector copy');
  assert.ok(AR_I18N['report.selcopy.title'], 'no Arabic heading');
  assert.notEqual(AR_I18N['report.selcopy.title'], EN_I18N['report.selcopy.title']);
});

test('a copy is listed once: the timeline skips the kind that has its own section', () => {
  assert.ok(/OWN_SECTION = new Set\(\['selectorcopy'\]\)/.test(SELCOPY_JS),
    'nothing declares which kinds have a section of their own');
  assert.ok(/present = \[\.\.\.new Set\(events\.map\(\(e\) => e\.kind\)\)\]\.filter\(\(k\) => !OWN_SECTION\.has\(k\)\)/.test(SELCOPY_JS),
    'the filter chips still offer a kind the list does not draw');
  assert.ok(/const listed = events\.filter\(\(e\) => !OWN_SECTION\.has\(e\.kind\)\)/.test(SELCOPY_JS),
    'the timeline list still draws the row twice');
});

test('the copy section renders page-derived strings as text, never as markup', () => {
  const from = SELCOPY_JS.indexOf('function renderSelectorCopies');
  assert.ok(from > 0, 'no renderer');
  const body = SELCOPY_JS.slice(from, SELCOPY_JS.indexOf('\n}', from));
  assert.ok(!/innerHTML/.test(body),
    'a selector and its element came out of the page under test: textContent, always');
  assert.ok(/report\.selcopy\.empty/.test(body), 'no empty state');
  assert.ok(/jumpTo\(ev\.ts\)/.test(body), 'no anchor into the timeline row for the same copy');
});

test('the preview sits at the inline end, so Arabic needs no second rule', () => {
  const from = SELCOPY_CSS.indexOf('.selcopy-row {');
  assert.ok(from > 0, 'no row rule');
  const rule = SELCOPY_CSS.slice(from, SELCOPY_CSS.indexOf('}', from));
  assert.ok(/grid-template-columns/.test(rule), 'the row is not a two-column grid');
  const block = SELCOPY_CSS.slice(SELCOPY_CSS.indexOf('selector copy'), SELCOPY_CSS.indexOf('@media (max-width: 480px)'));
  assert.ok(!/\b(margin-left|margin-right|padding-left|padding-right|left:|right:)/.test(block),
    'a physical offset in a section whose whole point is that it flips');
});

/**
 * "An element preview on the right of each one" — a picture, not a paragraph.
 *
 * The crop itself is made in `content/picker.js` (its own suite pins that); what
 * this settles is that the report draws it, that it draws it only when the
 * string is inline image data, and that the outline is still there underneath
 * as the caption and the alt text rather than being replaced by the picture.
 */
test('the element cell draws the picture when there is one, the reason when there is not', () => {
  const from = SELCOPY_JS.indexOf('function renderSelectorCopies');
  const body = SELCOPY_JS.slice(from, SELCOPY_JS.indexOf('\n}', from));
  assert.ok(/selcopy-shot/.test(body), 'the renderer never makes an image');
  assert.ok(/ev\.preview\.startsWith\('data:image\/'\)/.test(body),
    'an img.src straight out of a session file: a remote address would make opening ' +
    'the report a request to whoever wrote it');
  assert.ok(/img\.alt = outline\.textContent/.test(body),
    'the outline has to be the alt text, or a reader who cannot see the crop gets nothing');
  assert.ok(/if \(!shot\) outline\.append\(el\('span', 'selcopy-why', whyNoPicture/.test(body),
    'the cell should only explain the missing picture when the picture is missing');
  assert.ok(/\.selcopy-shot \{/.test(SELCOPY_CSS), 'no rule for the image');
});

test('selectors have a tab of their own, shown only when the tool was used', () => {
  const html = read('report/report.html');
  const js = surfaceSource('report/report.js');
  assert.ok(html.includes('data-tab="selectors"'), 'no tab');
  assert.ok(html.includes('id="panel-selectors"'), 'no panel');
  assert.ok(html.indexOf('id="panel-selectors"') < html.indexOf('id="selcopy-block"')
    && html.indexOf('id="selcopy-block"') < html.indexOf('id="panel-media"'),
    'the section is not inside the Selectors panel');
  assert.ok(js.includes("'timeline', 'selectors', 'overview', 'media'"), 'the tab is not in the TABS list, so showTab never reaches it');
  assert.ok(js.includes('tab.hidden = !copies.length'), 'an unused tool still gets a tab');
  // The jump goes to another tab now, so it has to open it.
  assert.ok(js.includes("if ($('panel-timeline').hidden) showTab('timeline');"),
    'Show in timeline scrolls a panel nobody can see');
});

test('a card per purpose, in reading order, and an old session still lands somewhere', () => {
  const js = surfaceSource('report/report.js');
  assert.ok(js.includes("const SELCOPY_PURPOSE_ORDER = ['step', 'element', 'sensitive', 'any'];"), 'the card order moved');
  assert.ok(js.includes("SELCOPY_PURPOSE_ORDER.includes(ev.purpose) ? ev.purpose : 'any'"),
    'a pick recorded before purposes existed falls out of every card');
  assert.ok(js.includes("el('section', 'selcopy-card')"), 'no card');
  assert.ok(js.includes("if (ev.label) outline.append(el('p', 'selcopy-el-label', ev.label));"),
    'the label is not shown beside the selector');
  for (const lang of [EN_I18N, AR_I18N]) {
    for (const id of ['step', 'element', 'sensitive', 'any']) {
      assert.ok(lang['report.selcopy.purpose.' + id], 'a purpose has no heading in one language');
      assert.ok(lang['report.selcopy.purposeNote.' + id], 'a purpose has no note in one language');
    }
  }
});

/* ── r1-02-6: one link rule for every href built from data ─────────────────── */

/** The real safeHref, lifted out of report/filing.js (a classic script inside an IIFE, so it cannot be imported). */
function liftSafeHref() {
  const src = read('report/filing.js');
  const at = src.indexOf('function safeHref(');
  assert.ok(at > 0, 'filing.js must define safeHref');
  const end = src.indexOf('\n  }', at);
  return new Function(`${src.slice(at, end + 4)}; return safeHref;`)();
}

test('safeHref keeps http, https, mailto and tel (any case, leading space) and drops everything else to plain text', () => {
  const safeHref = liftSafeHref();
  for (const ok of ['https://example.test/a?b=1', 'http://example.test', '  https://example.test/x', 'HTTPS://EXAMPLE.TEST/', 'mailto:qa@example.test', 'MailTo:qa@example.test', 'tel:+9625551234']) {
    assert.match(safeHref(ok), /^(https?|mailto|tel):/i, ok);
  }
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
    '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'DATA:text/html;base64,AAAA', 'vbscript:msgbox(1)', 'file:///c:/windows/win.ini',
    'blob:https://example.test/1', 'chrome-extension://abc/report.html', '//example.test/x', '/relative', '#', '', null, undefined, 42,
  ]) {
    assert.equal(safeHref(bad), '', String(bad));
  }
});

test('every href the report builds from data goes through safeHref (no raw url left in an anchor)', () => {
  const filing = read('report/filing.js');
  const report = surfaceSource('report/report.js');
  assert.ok(!filing.includes('href="${esc(r.url)}"'), 'filing.js still puts a raw r.url in an href');
  assert.ok(!filing.includes("esc(x.url || '#')"), 'the filed-status chip still falls back to #');
  assert.ok(!/\.href = (r\.href|v\.helpUrl|run\.url)/.test(report), 'report.js still assigns a raw url to an href');
  assert.ok(filing.includes('window.UQAFiling = { safeHref,'));
  assert.ok(report.includes('const safeHref = (u) => window.UQAFiling.safeHref(u)'));
  for (const site of ['safeLink(r.href,', 'safeLink(v.helpUrl,', 'safeLink(run.url,']) assert.ok(report.includes(site), site);
  for (const site of ['anchor(r.url, ltr(r.key))', 'safeHref(x.url)']) assert.ok(filing.includes(site), site);
});

test('r1-03-1: the Mattermost post in the report page goes through postSummary, not the bare post', () => {
  const report = surfaceSource('report/report.js');
  assert.ok(report.includes('lib.postSummary(cfg, channel.value, summary, reportLinks())'));
  assert.ok(!report.includes('lib.post(cfg'), 'the page must not call the ungated post');
});

test('r2-02-2: no report page script sets an href from a record address unfiltered (filing.js is L2\'s)', () => {
  for (const f of fs.readdirSync(path.join(EXT, 'report')).filter((n) => n.endsWith('.js') && n !== 'filing.js')) {
    const src = read('report/' + f);
    for (const m of src.matchAll(/\.href\s*=\s*([^;\n]+);/g)) {
      assert.ok(/^(?:ok|href)$/.test(m[1].trim()), f + ': .href = ' + m[1] + ' is not a value the link rule returned');
    }
  }
  const istqb = read('report/istqb.js');
  assert.ok(istqb.includes('window.UQAFiling?.safeHref(last.url)') && istqb.includes('window.UQAFiling?.safeHref(result.url)'), 'the filed-record links go through safeHref');
});

test('r2-08-1 / r2-08-3: evidence thumbnails are real buttons with a labelled opener, and the lightbox keeps the alt and the focus', () => {
  const report = surfaceSource('report/report.js');
  const css = read('report/report.css');
  assert.ok(report.includes('function evidenceOpener('), 'the opener helper exists');
  assert.equal((report.match(/evidenceOpener\(img,/g) || []).length, 2, 'both timeline thumbnails use it');
  assert.ok(report.includes("const stage = el('button', 'shot-stage');"), 'the gallery stage is a button');
  assert.equal((report.match(/report\.ev\.openLarge/g) || []).length, 3, 'every opener carries the EN+AR aria-label');
  assert.ok(!/img\.addEventListener\('click', \(\) => lightbox/.test(report), 'no bare image listens for a click');
  assert.ok(report.includes("img.alt = alt || t('report.ev.screenshot');"), 'the lightbox image takes the opener alt');
  assert.ok(!/img\.src = url;\s*img\.alt = '';/.test(report), 'the lightbox image is no longer decorative');
  assert.ok(report.includes('if (back?.isConnected) back.focus?.();'), 'closing returns focus to the opener');
  assert.ok(/\.ev-open:focus-visible/.test(css) && /\.shot-stage:focus-visible/.test(css), 'the opener shows a focus ring');
});

test('r2-08-2: the diagram frame is a focusable, named region with a focus ring', () => {
  const html = read('report/report.html');
  assert.match(html, /<div class="diagram-frame" id="diagram-frame" tabindex="0" role="region" aria-labelledby="tab-diagram">/);
  assert.match(read('report/report.css'), /\.diagram-frame:focus-visible \{ outline:/);
});

test('r2-08-6: report and settings read a failure through the shared localizer', () => {
  const report = surfaceSource('report/report.js');
  const options = read('options/options.js');
  assert.ok(report.includes("import('../platform/worker-errors.js')") && options.includes("import('../platform/worker-errors.js')"));
  assert.ok((report.match(/werr\(/g) || []).length >= 20, 'the failure sinks go through werr');
  assert.ok(options.includes("res.code === 'VAULT_LOCKED' ? werr(res)"));
  assert.ok(read('platform/settings.js').includes("{ code: 'VAULT_LOCKED' }"), 'the settings write names its code');
});

test('r2-10-4: report numbers use the shared Latin-digit tag', () => {
  const report = surfaceSource('report/report.js');
  assert.equal((report.match(/toLocaleString\(QAWi18n\.numTag\(\)\)/g) || []).length, 3);
  assert.ok(read('platform/i18n.js').includes('const numTag ='));
});

console.log('\nround 3: capture losses and the closed vault are shown (D-1010-45, D-1010-46)');

test('r3-06-1: the report has a gap banner, filled from the capture-gap notes, and the popup a loss line from both counters', () => {
  const html = read('report/report.html');
  assert.match(html, /id="gap-banner"[^>]*role="status"[^>]*hidden/, 'the banner exists, hidden until a gap is found');
  const report = surfaceSource('report/report.js');
  assert.match(report, /paintGapBanner\(events\)/);
  assert.match(report, /captureGap\(events\)/, 'D-1010-108: report.js asks the one reader in core/formats-export.js');
  assert.match(report, /import\('\.\.\/core\/formats-export\.js'\)/);
  assert.doesNotMatch(report, /\/confirmed\/\.test\(e\.text\)/, 'and no longer keeps a regex copy of the note text');
  assert.match(report, /t\('report\.gap\.banner', \{ lost, unconfirmed \}\)/);
  const popup = surfaceSource('popup/popup.js');
  assert.match(popup, /captureLost/);
  assert.match(popup, /unconfirmed/);
  assert.match(popup, /t\('popup\.live\.captureLost', \{ lost, unconfirmed: unc \}\)/);
  assert.equal((popup.match(/paintLoss\(/g) || []).length, 3, 'defined once and painted by the first paint and by the poll');
  const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const k of ['report.gap.banner', 'report.gap.coverageDetached', 'report.gap.recordingOrphaned', 'report.gap.other', 'popup.live.captureLost']) assert.ok(en[k] && ar[k] && en[k] !== ar[k], `${k} is a pair`);
  assert.match(report, /'coverage-detached': 'report\.gap\.coverageDetached'/, 'one banner sentence per code');
});

test('r3-09-1: a closed vault says so with a way to unlock, disables posting, and is checked before the confirm', () => {
  const report = surfaceSource('report/report.js');
  assert.match(report, /t\('report\.mm\.locked'\)/);
  assert.match(report, /options\.html#sec-integrations/, 'the sentence links to the options page');
  assert.match(report, /\$\('mm-post'\)\.disabled = true;\s*\n\s*\}/, 'post is disabled on a locked start');
  const post = report.slice(report.indexOf("$('mm-post').addEventListener('click'"));
  assert.ok(post.indexOf('cfg.locked') > -1 && post.indexOf('cfg.locked') < post.indexOf('confirm('), 'cfg.locked is read before confirm()');
  assert.doesNotMatch(post.slice(0, post.indexOf("$('mm-forget')")), /report\.f\.locked/, 'the filing string is not used for Mattermost any more');
  assert.match(report, /\$\('mm-forget'\)\.hidden = !saved\.url;/, 'forget shows whenever a server is saved');
  const forget = report.slice(report.indexOf("$('mm-forget').addEventListener('click'"), report.indexOf('/* ── theme'));
  assert.match(forget, /werr\(err\)/, 'forget errors go through localizeError');
  assert.doesNotMatch(post.slice(0, post.indexOf("$('mm-forget')")), /mmSay\(err\.message/, 'post errors go through localizeError');
  const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const k of ['report.mm.locked', 'report.mm.unlockLink']) assert.ok(en[k] && ar[k] && en[k] !== ar[k], `${k} is a pair`);
});

test('r3-04-1: a fill records the applied id as a technique note through the existing note message, and the designed list once per field', () => {
  const popup = surfaceSource('popup/popup.js');
  assert.match(popup, /send\(\{ type: 'UQA_NOTE', text, tag: 'technique' \}\)/);
  assert.match(popup, /`Technique: applied \$\{techId\}`/);
  assert.match(popup, /`Technique: designed \$\{designedIds\(\)\.join\(' '\)\}`/);
  assert.match(popup, /t\('popup\.partitions\.coverage', \{ covered, total: all\.size, n: fields \}\)/);
  assert.match(popup, /e\.tag !== 'technique'/, 'technique notes are not shown as tester notes');
});

test('r3-04-3: a truncated row shows its note in the popup', () => {
  const popup = surfaceSource('popup/popup.js');
  assert.equal((popup.match(/\.truncated\) row\.append\(el\('em', 'part-cut'/g) || []).length, 2, 'partition rows and boundary rows');
});

test('r3-06-1 / D-1010-38: exports carry the gap line and use Latin digits for the dates', () => {
  const ex = read('core/exporters.js');
  assert.match(ex, /captureGapLine\(events, ar\)/);
  assert.match(ex, /ar-JO-u-nu-latn-ca-gregory/, 'D-1010-112: the report date rule, Latin digits');
  assert.doesNotMatch(ex, /toLocaleString\(/);
});

test('D-1010-142: the lightbox video autoplays and loops only when motion is not reduced', () => {
  const r = surfaceSource('report/report.js');
  assert.ok(r.includes('v.autoplay = !prefersReduced();'), 'autoplay ignores prefers-reduced-motion');
  assert.ok(r.includes('v.loop = !prefersReduced();'), 'loop ignores prefers-reduced-motion');
  assert.ok(!r.includes('v.autoplay = true;'), 'autoplay is switched on unconditionally again');
});

test('D-1010-130: the report maps the three storage gap codes to their sentences', () => {
  const r = surfaceSource('report/report.js');
  for (const [code, key] of [['session-cap', 'report.gap.sessionCap'], ['body-cap', 'report.gap.bodyCap'], ['low-disk', 'report.gap.lowDisk']]) {
    assert.ok(r.includes(`'${code}': '${key}'`), `GAP_KEYS has no row for ${code}`);
  }
});

test('D-1010-140: the report folder picker shows a keyed failure, with the raw message in the title only', () => {
  const r = surfaceSource('report/report.js');
  assert.ok(r.includes("showFailure($('save-status'), err)"),'the save-folder failure no longer goes through showFailure');
  assert.ok(!r.includes("$('save-status').textContent = err.message"), 'the raw message is visible text again');
});

test('D-1010-157: a filed tracker issue is a link beside the key, never a window.open after the await', () => {
  const r = surfaceSource('report/report.js');
  assert.ok(!/window\.open\(out\.result\.url/.test(r), 'window.open of the filed issue is back (a popup blocker eats it)');
  assert.ok(r.includes("safeLink(out.result.url, 'tracker-open', t('report.trackers.open'))"), 'the filed-issue link is missing');
  for (const lang of ['en', 'ar']) {
    const tbl = JSON.parse(read(`platform/i18n/${lang}.json`));
    assert.ok(tbl['report.trackers.open'], `${lang} report.trackers.open`);
  }
  assert.equal(JSON.parse(read('platform/i18n/en.json'))['report.trackers.open'], 'Open the filed issue');
});

test('r10-10-5 (D-240): the saved table and the file card say their formats in the language on screen, not the English FORMATS label', async () => {
  const { FORMATS } = await import('../core/filing.js');
  const html = read('report/report.html');
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  const en = JSON.parse(read('platform/i18n/en.json'));
  const picker = /<select id="format"[\s\S]*?<\/select>/.exec(html)[0];
  let checked = 0;
  for (const m of picker.matchAll(/<option value="([^"]+)" data-i18n="(report\.raw\.fmt[A-Za-z]+)"/g)) {
    const [, format, key] = m;
    if (!FORMATS[format]) continue;
    checked++;
    assert.ok(ar[key] && ar[key] !== FORMATS[format].label, `${format}: the Arabic saved-table label "${ar[key]}" is the English-only FORMATS value`);
    assert.ok(/[؀-ۿ]/.test(ar[key]) || /^(?:YAML|Postman|HAR|JSON|CSV|SRS)/i.test(en[key]), `${format}: the Arabic label has no Arabic letter`);
  }
  assert.ok(checked >= 20, `only ${checked} formats checked`);
  const r = surfaceSource('report/report.js');
  assert.ok(!r.includes("label: 'Session card'"), 'the hard English Session card label is back');
  assert.ok(r.includes("'report.part.sessionCard'") && r.includes('formatLabelKey(e.format)'), 'the saved table does not map the format to its key');
  assert.notEqual(ar['report.part.sessionCard'], 'Session card');
  assert.ok(picker.includes('<option value="suite-csv" data-i18n="report.raw.fmtSuiteCsv">'), 'suite-csv is not in the picker (r10-10-1)');
  assert.equal(ar['report.links.skipSecret'], 'لم يُطلب: يحمل الرابط معاملًا باسم سرّي.');
  assert.equal(en['report.links.skipSecret'], 'Not requested: the link carries a secret-named parameter.');
  assert.ok(r.includes("r.reason === 'secret-query'") && r.includes("t('report.links.skipSecret')"), 'a secret-query link row is not rendered through report.links.skipSecret');
});

test('closeout C1: renderJudgement with vocab still null hides the panel instead of reading null.severity', () => {
  const src = read('report/istqb.js');
  const i = src.indexOf('function renderJudgement(defect) {');
  const j = src.indexOf('function picker(', i);
  assert.ok(i > 0 && j > i, 'renderJudgement not found');
  const body = src.slice(i, j);
  const host = { hidden: false, replaceChildren() {}, append() {} };
  const mk = (vocab, defect) => new Function('$', 'el', 'current', 'vocab', 't', 'picker', 'QAWi18n', 'document', body + '; return renderJudgement;')(
    () => host, () => ({ append() {} }), { kind: 'defect' }, vocab, (k) => k, () => ({}), { lang: () => 'en' },
    { createElement: () => ({ append() {} }) }
  )(defect);
  // the vocabulary has not arrived (or failed): used to throw "Cannot read properties of null (reading 'severity')"
  assert.doesNotThrow(() => mk(null, { severity: 'major', priority: 'high' }));
  assert.equal(host.hidden, true);
  // once it has, the panel is built
  mk({ severity: [], priority: [] }, { severity: 'major', priority: 'high' });
  assert.equal(host.hidden, false);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
