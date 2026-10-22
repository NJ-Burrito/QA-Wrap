/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Report page, autopilot wave (lane REP): header order (P1-13), the tab label, one problem number (P0-3, report side),
 * the report's own title, and the receipt of an auto screenshot / a «Not a bug» mark (AUTO-5, report side).
 *
 *   node tools/test-report-header-1011.mjs
 *
 * The page needs a browser, so this reads the markup and runs the pure functions of report/bugfirst.js. The Markdown text
 * itself (title, no empty rows) is core's and is pinned by tools/test-copy-report.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dupeKey, groupChains } from '../core/dupes.js';
import { correlate } from '../core/correlate.js';
import * as BF from '../report/bugfirst.js';
import { SESSION, click, net, logline, T0 } from './lib-r-fixture.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
let passed = 0;
const failures = [];
function test(name, fn) {
  const done = () => { passed++; console.log(`  ok  ${name}`); };
  const bad = (err) => { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); };
  try { const r = fn(); return r && r.then ? r.then(done, bad) : done(); } catch (err) { return bad(err); }
}

const html = read('report/report.html');
const js = read('report/report.js');
const t = (k, p = {}) => ({ 'popup.session.untitled': 'Untitled session', 'report.hero.untitled': 'QA session', 'report.ev.networkError': 'network error' }[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => p[n]);
const el = (tag, cls, text) => ({ tag, cls, text });

console.log('\nreport header, title, one number, receipts (lane REP)');

const header = html.slice(html.indexOf('<header class="app-bar">'), html.indexOf('</header>'));

await test('P1-13: header order is picker, Save, Copy, a separator, Delete; Delete is two controls away from Save', () => {
  const at = BF.HEADER_ORDER.map((id) => header.indexOf(`id="${id}"`));
  assert.ok(at.every((i) => i > -1), `every header control exists: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'DOM order matches HEADER_ORDER');
  assert.match(header, /id="bar-sep"[^>]*role="separator"/, 'the separator is exposed as one');
  assert.ok(BF.HEADER_ORDER.indexOf('session-delete') - BF.HEADER_ORDER.indexOf('save-all') >= 3, 'at least one control and the separator between Save and Delete');
});

await test('P1-13: the header Copy is switched on and off with the other session-only controls, and wired to the bugfirst module', () => {
  assert.match(js, /\$\('copy-report'\)\.disabled/);
  assert.match(js, /\$\('copy-report'\)\.addEventListener\('click', \(\) => BF\.headerCopy\(/);
  assert.match(read('report/report.css'), /\.bar-sep \{[^}]*margin-inline/, 'the gap uses logical properties so Arabic mirrors it');
});

await test('P1-13: the Jira tab reads «File a ticket» before the language file loads, no tab is hidden, Arabic is «قدّم تذكرة»', () => {
  assert.match(html, /id="tab-file"[^>]*data-i18n="report\.tabs\.file">File a ticket</);
  const tabs = [...html.matchAll(/<button class="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 11);
  assert.deepEqual(tabs.filter((b) => /\shidden/.test(b)).map((b) => /data-tab="(\w+)"/.exec(b)[1]), ['selectors'], 'only the pre-existing hidden Selectors tab');
  const ar = JSON.parse(read('tools/fixtures/i18n/REP.ar.json'));
  const en = JSON.parse(read('platform/i18n/en.json'));
  assert.equal(ar.__override['report.tabs.file'], 'قدّم تذكرة');
  assert.equal(en['report.tabs.file'], 'File a ticket');
  const enFrag = JSON.parse(read('tools/fixtures/i18n/REP.en.json'));
  assert.deepEqual(Object.keys(enFrag).filter((k) => k !== '__override').sort(), Object.keys(ar).filter((k) => k !== '__override').sort(), 'the fragments are a pair');
});

await test('P0-3: the headline, the verdict card and the Findings tab all take the same number from problemCounts(...).groups', () => {
  assert.equal((js.match(/BF\.problemCounts\(shownEvents\(events\)\)\.groups/g) || []).length, 3);
  assert.doesNotMatch(js, /BF\.groups\(chains, shownEvents\(events\)\)\.length/, 'no second counter left');
  assert.match(js, /const num = BF\.problemCounts\(/);
  if (typeof BF.problemCounts === 'function') {
    const ev = [click(0), net(300), click(1000), net(1300), click(2000), logline(2300)];
    const pc = BF.problemCounts(ev);
    assert.equal(pc.groups, 2, 'two kinds of failure, one repeated');
    assert.ok(pc.events >= 3);
  }
});

await test('title: a charter wins; the popup placeholder is not a title; first Bug note, then the lead failure, then the host', () => {
  const ev = [click(0), net(300, { url: 'https://app.test/api/orders/9?token=abc' }), { kind: 'note', tag: 'bug', text: '  Order button does nothing\nsecond line ', ts: T0 + 400 }];
  const title = (session, events) => BF.heroTitle({ session, events, t, summarise: (e) => e.text });
  assert.equal(title({ ...SESSION, charter: 'Apply for a licence' }, ev), 'Apply for a licence');
  assert.equal(title({ ...SESSION, charter: 'Untitled session' }, ev), 'Order button does nothing second line');
  assert.equal(title({ ...SESSION, charter: '' }, [click(0), net(300, { url: 'https://app.test/api/orders/9?token=abc' })]), 'POST /api/orders/9 500', 'METHOD /path STATUS, query stripped');
  assert.equal(title({ ...SESSION, charter: '' }, [logline(5)]), 'TypeError: x is undefined');
  assert.equal(title({ ...SESSION, charter: '' }, [click(0)]), 'app.test');
  assert.equal(title({ charter: '' }, []), 'QA session');
  for (const s of [{ ...SESSION, charter: 'Untitled session' }, { ...SESSION, charter: '' }, { charter: '' }]) assert.doesNotMatch(title(s, []), /untitled/i);
  assert.ok(title({ ...SESSION, charter: 'x'.repeat(300) }, []).length <= 120);
});

await test('title: both report.js call sites use it (hero and the filing title); the old fallback is gone', () => {
  assert.equal((js.match(/BF\.heroTitle\(\{ session, events, t, summarise \}\)/g) || []).length, 3); // 3rd: the filing useTitle hook
  assert.doesNotMatch(js, /session\.charter \|\| t\('report\.hero\.untitled'\)/);
});

const sessionEvents = () => {
  const ev = [click(0), net(300), click(1000), logline(1300, { text: 'TypeError: y is undefined' })];
  const groups = groupChains(correlate(ev), ev);
  return { ev, groups };
};

await test('AUTO-5: «Not a bug» on the page marks exactly that group; the count does not change', () => {
  const { ev, groups } = sessionEvents();
  assert.equal(groups.length, 2);
  const key = dupeKey(groups[0].chain.failure);
  const marked = [...ev, { kind: 'expected', forKey: key, ts: T0 + 2000 }];
  assert.equal(BF.isExpected(marked, groups[0]), true);
  assert.equal(BF.isExpected(marked, groups[1]), false);
  assert.equal(BF.isExpected(ev, groups[0]), false, 'nothing marked, nothing flagged');
  assert.equal(BF.isExpected(marked, { ...groups[1], expected: true }), true, 'core may flag the group itself');
  assert.equal(groupChains(correlate(marked), marked).length, 2, 'the mark is not a third problem');
  assert.equal(BF.flags(el, t, marked, groups[0]).length, 1);
  assert.equal(BF.flags(el, t, marked, groups[0])[0].text, 'report.dup.expected');
  assert.deepEqual(BF.flags(el, t, marked, groups[1]), []);
});

await test('AUTO-5: forKey is capped at 200 on the way in, so a long key still matches its group', () => {
  const long = { key: 'net|POST|' + 'a'.repeat(300) + '|500' };
  assert.equal(BF.isExpected([{ kind: 'expected', forKey: long.key.slice(0, 200) }], long), true);
  assert.equal(BF.isExpected([{ kind: 'expected', forKey: 'other' }], long), false);
});

await test('AUTO-5: the auto screenshot with the same forKey is the group\'s picture; a manual one or another key is not', () => {
  const { ev, groups } = sessionEvents();
  const k0 = dupeKey(groups[0].chain.failure);
  const auto = { kind: 'screenshot', auto: true, forKey: k0, mediaId: 'm-1', ts: T0 + 350 };
  const withShots = [...ev, { kind: 'screenshot', mediaId: 'm-manual', forKey: k0, ts: T0 + 360 }, { kind: 'screenshot', auto: true, forKey: 'x', mediaId: 'm-2', ts: T0 + 370 }, auto];
  assert.equal(BF.groupShot(withShots, groups[0]), auto);
  assert.equal(BF.groupShot(withShots, groups[1]), null);
  assert.equal(BF.groupShot(ev, groups[0]), null);
  assert.equal(BF.groupShot([{ ...auto, mediaId: undefined }], groups[0]), null, 'no saved media, no picture');
  assert.match(js, /BF\.groupShot\(events, groups\[pickChain\]\) \|\| nearestScreenshot\(f\.ts\)/, 'it wins over the nearest-in-time shot');
  assert.match(js, /\.\.\.BF\.flags\(el, t, events, g\)/);
  assert.match(js, /case 'expected': return t\('report\.ev\.expected'\)/, 'the mark is a readable timeline row, not the raw word');
});

await test('header Copy puts the worker\'s Markdown on the clipboard, inline images folded; an empty result says so and copies nothing', async () => {
  const saved = [];
  const said = [];
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (s) => { saved.push(s); } } }, configurable: true });
  const say = (m, kind) => said.push([m, kind || '']);
  await BF.headerCopy({ ctx: { markdown: async () => '# Order button does nothing\n![shot](data:image/png;base64,AAAA)\nPOST /api/orders 500' }, t, say });
  assert.equal(saved.length, 1);
  assert.match(saved[0], /^# Order button does nothing\n/);
  assert.doesNotMatch(saved[0], /data:image/);
  assert.deepEqual(said.at(-1), ['report.v.copiedMarkdown', 'ok']);
  await BF.headerCopy({ ctx: { markdown: async () => '' }, t, say });
  await BF.headerCopy({ ctx: undefined, t, say });
  assert.equal(saved.length, 1);
  assert.deepEqual(said.at(-1), ['report.v.copyMarkdownEmpty', 'err']);
  await BF.headerCopy({ ctx: { markdown: async () => { throw new Error('x'); } }, t, say });
  assert.deepEqual(said.at(-1), ['report.raw.copyFallback', 'err']);
});

await test('line ceiling: report.js stays within tools/line-ratchet.json', () => {
  const ratchet = JSON.parse(read('tools/line-ratchet.json'));
  const lines = js.split('\n').length - (js.endsWith('\n') ? 1 : 0);
  assert.ok(lines <= ratchet.lines['report/report.js'], `${lines} lines > ${ratchet.lines['report/report.js']}`);
});

console.log(failures.length ? `\n${failures.length} FAILED, ${passed} passed` : `\nall ${passed} passed`);
if (failures.length) process.exit(1);
