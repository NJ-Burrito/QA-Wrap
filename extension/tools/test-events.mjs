/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * r4-02-1: a page-controlled nested value cannot make one event huge.
 *
 *   node tools/test-events.mjs
 */
import assert from 'node:assert/strict';
import { sanitiseEvent, safeLocator, safePrefix, isFailure, liteFp } from '../core/events.js';
import { buildPlaywrightSpec } from '../core/artifact.js';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const NOW = 1_700_000_000_000;
const san = (raw) => sanitiseEvent(raw, { frameUrl: 'https://app.example/', now: NOW });
const big = 'x'.repeat(3 * 1024 * 1024);
/** A tree that is deep, wide and heavy at once. */
const nest = (d) => (d === 0 ? big : { a: nest(d - 1), b: [nest(d - 1), big], c: big });
const wide = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, big]));

test('3 MB nested rtl, selectorcopy and net values stay under 200000 serialised chars', () => {
  for (const [kind, field] of [['rtl', 'overflow'], ['rtl', 'timings'], ['selectorcopy', 'flavours'], ['selectorcopy', 'classes'], ['net', 'reqBody'], ['net', 'graphqlError'], ['net', 'operation']]) {
    for (const value of [nest(6), wide, Array.from({ length: 5000 }, () => big)]) {
      const out = san({ kind, [field]: value });
      assert.ok(JSON.stringify(out).length < 200000, `${kind}.${field}: ${JSON.stringify(out).length}`);
    }
  }
});
test('header maps keep their own caps (100 x 8 KB, r3-07-1) and stay bounded even with nested junk values', () => {
  const out = san({ kind: 'net', reqHeaders: nest(6), resHeaders: wide });
  assert.ok(JSON.stringify(out).length < 1_500_000, String(JSON.stringify(out).length));
});
test('every allowed field at once cannot pass the cap either', () => {
  const raw = { kind: 'rtl', enabled: wide, expandPercent: wide, options: nest(6), overflowCount: wide, cappedNodes: wide, timings: nest(6), overflow: nest(6) };
  assert.ok(JSON.stringify(san(raw)).length < 200000);
});
test('nesting beyond depth 4 is dropped, not kept', () => {
  const out = san({ kind: 'rtl', options: { a: { b: { c: { d: { e: 1 } } } } } });
  assert.equal(out.options.a.b.c.d, null);
});
test('legitimate events come out unchanged', () => {
  const rtl = { kind: 'rtl', enabled: true, expandPercent: 40, options: { mode: 'x', depth: 2 }, overflowCount: 2, cappedNodes: 0, timings: { scan: 12, total: 40 }, overflow: [{ tag: 'DIV', text: 'مرحبا', w: 120 }, { tag: 'SPAN', text: 'hello', w: 90 }] };
  const sc = { kind: 'selectorcopy', copied: 'css', flavours: ['css', 'xpath', 'playwright'], strategy: 'id', matches: 1, ambiguous: false, tag: 'BUTTON', classes: ['btn', 'btn-primary'], role: 'button', text: 'Save', width: 80, height: 32, warnCodes: ['bidi'] };
  const net = { kind: 'net', via: 'fetch', method: 'POST', url: 'https://api.example/x', status: 500, reqHeaders: [{ name: 'a', value: 'b' }], reqBody: { user: 'u', items: [1, 2, 3] }, resHeaders: { 'content-type': 'application/json' }, responsePreview: '{"e":1}', act: 3 };
  for (const raw of [rtl, sc, net]) {
    const out = san({ ...raw, ts: NOW });
    assert.deepEqual(out, { ...raw, ts: NOW, frameUrl: 'https://app.example/' });
  }
});
test('a body with 100 keys and a header list of 100 survive the wider cap', () => {
  const reqBody = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}`, 'v']));
  const reqHeaders = Array.from({ length: 100 }, (_, i) => ({ name: `h${i}`, value: 'v' }));
  const out = san({ kind: 'net', reqBody, reqHeaders });
  assert.equal(Object.keys(out.reqBody).length, 100);
  assert.equal(out.reqHeaders.length, 100);
});
test('r4-02-1: a 5e6-char header map is clamped to a 1e6-char budget, and 100 x 8192 still fits whole', () => {
  // 100 keys x 10 strings x 8192 = 8.2e6 chars, all within the per-value and per-key caps: only the map budget can clamp it.
  const five = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`h${i}`, Array.from({ length: 10 }, () => 'y'.repeat(8192))]));
  const out = san({ kind: 'net', reqHeaders: five });
  const kept = Object.values(out.reqHeaders).flat().filter((v) => typeof v === 'string');
  const chars = kept.reduce((n, v) => n + v.length, 0);
  assert.ok(chars <= 1e6, `a map of 8e6 chars kept ${chars} chars`);
  assert.ok(kept.length < 1000, 'the budget never ran out, so nothing was clamped');
  const fits = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`h${i}`, 'z'.repeat(8192)]));
  const whole = san({ kind: 'net', resHeaders: fits });
  assert.equal(Object.values(whole.resHeaders).filter((v) => v === 'z'.repeat(8192)).length, 100, '100 x 8192 must survive whole');
});

/* ── council-1010 r2-02-1: a locator is source code, so ingest and output both check it ── */

const HOSTILE = [
  "getByText('x'); require('fs')",
  "getByText('x').then(() => 1)",
  'getByText(`a`)',
  "getByText('x')\n.click()",
  "getByText('a' + process.exit())",
  "getByText(x)",
  "evaluate('1')",
  "locator(import('node:fs'))",
  "getByText('${process.exit()}')",
  "getByText('" + String.fromCharCode(0x2028) + "')",
];
const GOOD = [
  "getByRole('button', { name: 'Save; now', exact: true })",
  'getByTestId("a").first()',
  "frameLocator('iframe >> nth=0').getByText('process')",
  "locator('[data-qa=\"x\"]').nth(2)",
  "getByLabel('Name').filter({ hasText: 'x' }).last()",
];

test('r2-02-1: safeLocator accepts the engine grammar and rejects ; => backtick ${ newline U+2028 require import( process', () => {
  for (const g of GOOD) assert.equal(safeLocator(g), true, g);
  for (const h of HOSTILE) assert.equal(safeLocator(h), false, h);
  assert.equal(safeLocator(null), false);
  assert.equal(safePrefix(''), true);
  assert.equal(safePrefix("frameLocator('a')."), true);
  assert.equal(safePrefix("frameLocator('a')"), false, 'a prefix must end in a dot');
  assert.equal(safePrefix("frameLocator('a'); process.exit(1); //."), false);
});

test('r2-02-1: safeLocator is linear on an unterminated 100 KB string', () => {
  const t0 = Date.now();
  assert.equal(safeLocator("getByText('" + 'a\\\\'.repeat(50000)), false);
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});

test('r2-02-1: ingest clears a hostile locator, framePrefix and copied; the CSS selector and a safe copied stay', () => {
  const out = san({ kind: 'dom', action: 'click', locator: HOSTILE[0], framePrefix: "frameLocator('a'); process.exit(1); //.", selector: '#ok', label: 'L' });
  assert.equal(out.locator, undefined);
  assert.equal(out.framePrefix, undefined);
  assert.equal(out.selector, '#ok');
  const bad = san({ kind: 'selectorcopy', copied: "page.getByText('z'); import('node:fs'); //", expected: { visible: true } });
  assert.equal(bad.copied, undefined);
  const objects = san({ kind: 'dom', action: 'click', locator: { a: 1 }, framePrefix: ['x'] });
  assert.equal(objects.locator, undefined);
  assert.equal(objects.framePrefix, undefined);
  const good = san({ kind: 'dom', action: 'click', locator: GOOD[0], framePrefix: "frameLocator('f').", selector: '#ok' });
  assert.equal(good.locator, GOOD[0]);
  assert.equal(good.framePrefix, "frameLocator('f').");
  assert.equal(san({ kind: 'selectorcopy', copied: "page.getByRole('button')" }).copied, "page.getByRole('button')");
});

test('r2-02-1: an imported session never met ingest, so the spec builder re-checks: hostile locator, framePrefix and copied give SKIPPED lines, the spec parses, no require/import(/process.', () => {
  const T = 1_700_000_000_000;
  const session = { id: 's_x', charter: 'imported', startedAt: T, startUrl: 'https://app.example/' };
  const evs = [
    { kind: 'nav', ts: T + 10, url: 'https://app.example/' },
    { kind: 'dom', ts: T + 1000, action: 'click', label: 'a', tag: 'button', locator: "getByText('x'); require('fs').readFileSync('/etc/passwd'); //", framePrefix: '' },
    { kind: 'dom', ts: T + 2000, action: 'click', label: 'b', tag: 'button', locator: "getByText('y')", framePrefix: "frameLocator('f'); process.exit(1); //." },
    { kind: 'dom', ts: T + 3000, action: 'click', label: 'c', tag: 'button', locator: "getByRole('button')", framePrefix: '' },
    { kind: 'selectorcopy', ts: T + 4000, intent: 'assert', copied: "page.getByText('z'); import('node:fs'); //", expected: { visible: true } },
  ];
  const src = buildPlaywrightSpec(session, evs);
  assert.equal(src.split('\n').filter((l) => l.includes('// SKIPPED: unsafe locator')).length, 3, src);
  assert.ok(src.includes("await page.getByRole('button').click();"), 'the safe locator still clicks');
  assert.ok(!/require\(|import\(|process\./.test(src), 'hostile code reached the spec');
  const body = src.split('\n').filter((l) => !/^import\s/.test(l)).join('\n');
  assert.doesNotThrow(() => new vm.Script(`(async()=>{ ${body.replace(/^test\(/m, 'void (')}`.replace(/\}\);\s*$/, '}); })'), { filename: 'spec.js' }), 'the spec does not parse');
  // Through ingest instead, the hostile locator is gone and the CSS selector answers.
  const cleaned = san({ kind: 'dom', ts: NOW, action: 'click', label: 'a', tag: 'button', locator: HOSTILE[0], selector: '#go' });
  const viaIngest = buildPlaywrightSpec(session, [{ ...cleaned }]);
  assert.ok(viaIngest.includes("await page.locator('#go').click();"), viaIngest);
});

/* ── round 3 (council-1010): recorder behaviour, isFailure, ingest of the new fields ── */
const RECORDER_SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'recorder.js'), 'utf8');

/** content/recorder.js in a vm with a fake document, a logging bridge and a manual clock. */
function bootRecorder() {
  let clock = 1_000_000;
  let nextId = 1;
  const timers = [];
  const listeners = {};
  const log = [];
  const emitted = [];
  class FakeDate extends Date { static now() { return clock; } }
  const sandbox = {
    document: { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } },
    Date: FakeDate,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.push({ id, at: clock + ms, fn }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    console,
    addEventListener() {},
    innerWidth: 1280,
    innerHeight: 800,
  };
  sandbox.window = sandbox;
  sandbox.UQABridge = {
    isRecording: () => true,
    beginAct() { log.push('bump'); return true; },
    emit(ev) { log.push('emit'); emitted.push(ev); return Promise.resolve(null); },
    send: () => Promise.resolve(null),
  };
  sandbox.UQASelector = {
    describe: (e) => ({ name: e.name || 'field', role: 'textbox', css: `#${e.id || 'x'}`, locator: `getByLabel('${e.name || 'field'}')`, matches: 1 }),
    accessibleName: () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(RECORDER_SRC, sandbox, { filename: 'content/recorder.js' });
  return {
    log, emitted,
    fire(type, e) { for (const fn of listeners[type] || []) fn(e); },
    tick(ms) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const due = timers.find((t) => t.at <= end);
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        clock = Math.max(clock, due.at);
        due.fn();
      }
      clock = end;
    },
  };
}
const fakeEl = (tagName, extra = {}) => {
  const e = { nodeType: 1, tagName, type: '', value: '', id: 'f', name: 'Field', closest() { return this; }, getAttribute() { return null; }, ...extra };
  return e;
};
const domEv = (target, extra = {}) => ({ target, isTrusted: true, composedPath: () => [target], ...extra });

test('r3-05-1: a typing burst begins ONE act at its first keystroke and the settled input does not bump a second time', () => {
  const r = bootRecorder();
  const input = fakeEl('INPUT', { type: 'text' });
  input.value = 'a';
  r.fire('input', domEv(input));
  assert.deepEqual(r.log, ['bump'], 'the act began at the first keystroke');
  input.value = 'ab';
  r.fire('input', domEv(input));
  input.value = 'abc';
  r.fire('input', domEv(input));
  assert.deepEqual(r.log, ['bump'], 'one bump for the whole burst');
  r.tick(500);
  assert.deepEqual(r.log, ['bump', 'emit'], 'the settled value is emitted without a second bump');
  assert.equal(r.emitted[0].value, 'abc');
  assert.equal(r.emitted[0].preBumped, true, 'it consumes the pre-bump');
  assert.equal(r.emitted[0].trusted, true);
});

test('D-1010-47: every recorded action carries trusted from its event; a scripted one says false', () => {
  const r = bootRecorder();
  const btn = fakeEl('BUTTON', { name: 'Go' });
  r.fire('click', domEv(btn, { button: 0 }));
  r.fire('click', domEv(btn, { button: 0, isTrusted: false }));
  r.fire('keydown', domEv(btn, { key: 'Enter', isTrusted: false }));
  r.fire('submit', domEv(fakeEl('FORM'), { isTrusted: false }));
  const box = fakeEl('INPUT', { type: 'checkbox', checked: true });
  r.fire('change', domEv(box, { isTrusted: false }));
  const typed = fakeEl('INPUT', { type: 'text', value: 'x' });
  r.fire('input', domEv(typed, { isTrusted: false }));
  r.tick(500);
  assert.deepEqual(r.emitted.map((e) => [e.action, e.trusted]), [
    ['click', true], ['click', false], ['keydown', false], ['submit', false], ['change', false], ['input', false],
  ]);
  const calls = RECORDER_SRC.split('\n').filter((l) => /\brecord\(/.test(l) && /action: '/.test(l));
  assert.ok(calls.length >= 9 && calls.every((l) => l.includes('trusted')), 'every record() call site names trusted: ' + calls.filter((l) => !l.includes('trusted')).join(' | '));
});

test('D-1010-50 / r3-05-7: dblclick, contextmenu and middle auxclick are recorded; a right auxclick is not doubled; a multi-select records every option', () => {
  const r = bootRecorder();
  const btn = fakeEl('BUTTON', { name: 'Row' });
  r.fire('dblclick', domEv(btn, { button: 0 }));
  r.fire('contextmenu', domEv(btn, { button: 2, defaultPrevented: true })); // r7-05-4 (D-1010-154): only the page's own menu is a step
  r.fire('auxclick', domEv(btn, { button: 1 }));
  r.fire('auxclick', domEv(btn, { button: 2 }));
  const sel = fakeEl('SELECT', { multiple: true, selectedOptions: Array.from({ length: 25 }, (_, i) => ({ text: ` Opt ${i} ` })) });
  r.fire('change', domEv(sel));
  r.tick(10);
  assert.deepEqual(r.emitted.slice(0, 3).map((e) => [e.action, e.button]), [['dblclick', 0], ['click', 2], ['click', 1]]);
  assert.equal(r.emitted.length, 4, 'the right-button auxclick adds nothing: the contextmenu already did');
  const m = r.emitted[3];
  assert.equal(m.control, 'select-multiple');
  assert.equal(m.value.split(String.fromCharCode(10)).length, 20, 'capped at 20');
  assert.equal(m.value.split(String.fromCharCode(10))[0], 'Opt 0');
});

test('r3-05-2 / D-1010-48: isFailure counts a GraphQL answer with errors, not a clean one, not an aborted XHR; a timeout still counts', () => {
  assert.equal(isFailure({ kind: 'net', status: 200, error: false, ev: 'gql' }), true);
  assert.equal(isFailure({ kind: 'net', status: 200, error: false }), false);
  assert.equal(isFailure({ kind: 'net', status: 0, error: false, ev: 'abort' }), false);
  assert.equal(isFailure({ kind: 'net', status: 0, error: true, ev: 'timeout' }), true);
  assert.notEqual(liteFp({ kind: 'net', url: 'https://a.test/graphql', method: 'POST', status: 200, ev: 'gql', operation: 'A' }), liteFp({ kind: 'net', url: 'https://a.test/graphql', method: 'POST', status: 200, ev: 'gql', operation: 'B' }));
  const o = san({ kind: 'net', via: 'ws', url: 'wss://a.test/x', ev: 'close', text: 'WebSocket closed: 1006', error: true, operation: 'Pay', forged: 1 });
  assert.equal(o.operation, 'Pay');
  assert.equal('forged' in o, false);
  assert.equal(san({ kind: 'rep', ofKind: 'net', ev: 'gql', operation: 'Pay', n: 3 }).operation, 'Pay', 'a folded repeat keeps the GraphQL facts');
});

await (async () => {
  const name = 'D-1010-183 / r8-05-1: a failed top-level load is a net event (status 0, error, Chrome\'s reason); aborts, unarmed tabs and error pages are not (a sub-frame is, as via subframe, r9-05-2)';
  try {
    const { lift, endOfBlock } = await import('./lib-lift.mjs');
    const sw = workerSrc();
    const at = sw.indexOf("'webNavigation.onErrorOccurred'");
    assert.ok(at > 0, 'the listener is registered');
    const from = sw.indexOf('async (details)', at);
    const cb = sw.slice(from, endOfBlock(sw, sw.indexOf('{', from)) + 1);
    const isInternalUrl = new Function(`${lift(sw, 'isInternalUrl')}; return isInternalUrl;`)();
    assert.equal(isInternalUrl('chrome-error://chromewebdata/'), true, 'the error page itself is internal');
    assert.equal(isInternalUrl('https://app.test/'), false);
    const run = async (details, { session = 's1', armed = true, belongs = true } = {}) => {
      const out = [];
      await new Function('activeSessionId', 'armed', 'isInternalUrl', 'belongsToSession', 'appendEvent', 'paintBadge', `return (${cb})`)(
        async () => session, { isArmedTab: async () => armed }, isInternalUrl, async () => belongs, async (e) => { out.push(e); }, () => {}
      )(details);
      return out;
    };
    const base = { frameId: 0, tabId: 7, url: 'https://down.test/', error: 'net::ERR_CONNECTION_REFUSED' };
    const [e] = await run(base);
    assert.deepEqual([e.kind, e.via, e.status, e.error, e.ok, e.text, e.url, e.sessionId, e.tabId], ['net', 'document', 0, true, false, 'net::ERR_CONNECTION_REFUSED', 'https://down.test/', 's1', 7]);
    assert.equal(isFailure(e), true, 'the existing definition of a failure picks it up');
    assert.equal((await run({ ...base, error: 'net::ERR_ABORTED' })).length, 0, 'the tester moved on');
    const [f] = await run({ ...base, frameId: 2 });
    assert.deepEqual([f.via, f.frameId, f.status, f.error], ['subframe', 2, 0, true], 'r9-05-2: an iframe that failed to load is a net row naming the frame');
    assert.equal((await run({ ...base, frameId: 2, error: 'net::ERR_ABORTED' })).length, 0, 'a sub-frame abort is the tester moving on');
    assert.equal(e.frameId, undefined, 'a top-level row carries no frameId');
    assert.equal((await run(base, { armed: false })).length, 0, 'a sleeping tab');
    assert.equal((await run(base, { session: null })).length, 0, 'no session');
    assert.equal((await run(base, { belongs: false })).length, 0, 'a tab outside the session');
    assert.equal((await run({ ...base, url: 'chrome-error://chromewebdata/' })).length, 0, 'the error page is not a finding');
    passed++; console.log(`  ok  ${name}`);
  } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
