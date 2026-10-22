/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * content/recorder.js, behaviourally, with no browser.
 *
 *   node tools/test-recorder-dom.mjs
 *
 * The recorder is an IIFE that talks to `document`, `window.UQABridge` and
 * `window.UQASelector`. This suite runs the real file in a `node:vm` context
 * with a hand-rolled document (listeners kept in registration order), a bridge
 * stub that logs every call, a selector stub and fake timers, then fires events
 * at it. It proves what a source grep cannot: what is emitted, with which
 * timestamp, and in which order relative to the act-epoch bump.
 *
 * Real-page behaviour (shadow DOM retargeting by Chrome, real focus/blur) is
 * the owner's headed run; here `composedPath` is faked to the shape Chrome gives.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { correlate } from '../core/correlate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'content', 'recorder.js'), 'utf8');
const BRIDGE_SRC = fs.readFileSync(path.join(HERE, '..', 'content', 'bridge.js'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** A fresh recorder in a fresh context. */
function boot({ recording = true } = {}) {
  let clock = 1_000_000;
  let nextId = 1;
  const timers = [];
  const listeners = {};
  const log = [];
  const emitted = [];
  const state = { recording };
  class FakeDate extends Date { static now() { return clock; } }

  const document = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const bridge = {
    isRecording: () => state.recording,
    beginAct() { log.push('bump'); return true; },
    emit(ev) { log.push('emit'); emitted.push(ev); return Promise.resolve(null); },
    send: () => Promise.resolve(null),
  };
  const sandbox = {
    document,
    Date: FakeDate,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.push({ id, at: clock + ms, fn }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    console,
  };
  sandbox.window = sandbox;
  sandbox.UQABridge = bridge;
  sandbox.UQASelector = {
    describe: (e) => ({ name: e.name || 'field', role: 'textbox', css: `#${e.id || 'x'}`, locator: `page.locator('#${e.id || 'x'}')`, matches: 1 }),
    accessibleName: () => '',
  };
  const winListeners = {};
  sandbox.addEventListener = (type, fn) => { (winListeners[type] ||= []).push(fn); };
  sandbox.innerWidth = 1280;
  sandbox.innerHeight = 800;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'content/recorder.js' });

  return {
    log, emitted, sandbox, state, listeners, bridge,
    fireWindow(type, e) { for (const fn of winListeners[type] || []) fn(e); },
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
    now: () => clock,
  };
}

const el = (tagName, extra = {}) => ({
  nodeType: 1, tagName, type: '', value: '', id: '', name: '',
  closest() { return this; },
  getAttribute() { return null; },
  ...extra,
});

console.log('\nrecorder.js — behaviour in a fake document');

test('listeners are registered for the events the recorder needs', () => {
  const r = boot();
  for (const t of ['click', 'input', 'change', 'submit', 'keydown', 'blur']) assert.ok(r.listeners[t]?.length, `${t} listener`);
});

test('click: starts from composedPath()[0] when the target is a shadow host (05-2)', () => {
  const r = boot();
  const host = el('DIV', { id: 'host' });
  const inner = el('BUTTON', { id: 'inner' });
  r.fire('click', { target: host, composedPath: () => [inner, {}, host], button: 0, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].tag, 'button', 'the inner button, not the host div');
  assert.equal(r.emitted[0].selector, '#inner');
});

test('click: without composedPath the target is used', () => {
  const r = boot();
  r.fire('click', { target: el('A', { id: 'link' }), button: 0 });
  r.tick(0);
  assert.equal(r.emitted[0].tag, 'a');
});

test('submit and keydown also start from the composed path (05-2)', () => {
  const r = boot();
  const host = el('DIV');
  const form = el('FORM', { id: 'f' });
  const field = el('INPUT', { id: 'q' });
  r.fire('submit', { target: host, composedPath: () => [form, host] });
  r.fire('keydown', { target: host, key: 'Enter', composedPath: () => [field, host] });
  r.tick(0);
  assert.deepEqual(r.emitted.map((e) => e.tag), ['form', 'input']);
});

test('input and change start from the composed path (05-2)', () => {
  const r = boot();
  const host = el('DIV');
  const field = el('INPUT', { id: 'q', type: 'text', value: 'abc' });
  r.fire('change', { target: host, composedPath: () => [field, host] });
  r.tick(0);
  assert.equal(r.emitted[0].action, 'input');
  assert.equal(r.emitted[0].value, 'abc');
  const r2 = boot();
  const f2 = el('INPUT', { id: 'q2', type: 'text', value: 'xyz' });
  r2.fire('input', { target: host, composedPath: () => [f2, host] });
  r2.tick(400); r2.tick(0);
  assert.equal(r2.emitted[0].value, 'xyz', 'the input listener reads the inner field, not the host');
});

test('the act epoch is bumped synchronously, before the page and before the timer (05-8)', () => {
  const r = boot();
  r.fire('click', { target: el('BUTTON'), button: 0 });
  assert.deepEqual(r.log, ['bump'], 'bumped inside the capture listener, nothing emitted yet');
  r.tick(0);
  assert.deepEqual(r.log, ['bump', 'emit'], 'emit follows the macrotask');
});

test('bridge.js: emit does not bump twice for a pre-bumped action (05-8)', () => {
  assert.match(BRIDGE_SRC, /function beginAct\(\)/, 'bridge defines beginAct');
  assert.match(BRIDGE_SRC, /preBumped--/, 'emit consumes the pre-bump');
  assert.match(BRIDGE_SRC, /\n {4}beginAct,/, 'and beginAct is exported on UQABridge');
});

test('a debounced input keeps the last keystroke time as its ts (05-4)', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'a' });
  const t0 = r.now();
  r.fire('input', { target: f });
  r.tick(100);
  f.value = 'ab';
  r.fire('input', { target: f });
  r.tick(399);
  assert.equal(r.emitted.length, 0, 'still debouncing');
  r.tick(1);
  r.tick(0);
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].value, 'ab');
  assert.equal(r.emitted[0].ts, t0 + 100, 'ts is the last keystroke, not the end of the debounce');
});

test('an input can be the trigger of a failure 250 ms after the last key (05-4 + correlate)', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'a' });
  r.fire('input', { target: f });
  const keyAt = r.now();
  r.tick(400);
  r.tick(0);
  const dom = { ...r.emitted[0], kind: 'dom', frameUrl: 'https://app.test/' };
  const failure = { kind: 'net', method: 'GET', url: '/suggest', status: 500, ts: keyAt + 250, frameUrl: 'https://app.test/' };
  const [chain] = correlate([dom, failure]);
  assert.equal(chain.trigger?.action, 'input', 'the typing is blamed, not nothing');
  assert.equal(chain.gapMs, 250);
});

test('a password field is masked in the debounced record', () => {
  const r = boot();
  const f = el('INPUT', { id: 'pw', type: 'password', value: 'hunter2' });
  r.fire('input', { target: f });
  r.tick(400); r.tick(0);
  assert.equal(r.emitted[0].masked, true);
  assert.ok(!JSON.stringify(r.emitted[0]).includes('hunter2'), 'the secret never reaches the emitted event');
});

test('contenteditable edits are recorded as input actions (05-5)', () => {
  const r = boot();
  const d = el('DIV', { id: 'editor', isContentEditable: true, textContent: 'hello world' });
  r.fire('input', { target: d });
  r.tick(400); r.tick(0);
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].action, 'input');
  assert.equal(r.emitted[0].tag, 'div');
  assert.equal(r.emitted[0].value, 'hello world');
});

test('contenteditable: blur flushes the pending edit without waiting (05-5)', () => {
  const r = boot();
  const d = el('DIV', { id: 'editor', isContentEditable: true, textContent: 'draft' });
  r.fire('input', { target: d });
  r.tick(50);
  r.fire('blur', { target: d });
  r.tick(0);
  assert.equal(r.emitted.length, 1, 'recorded on blur');
  r.tick(1000);
  assert.equal(r.emitted.length, 1, 'and not a second time when the debounce would have fired');
});

test('contenteditable: a secret-named editor is masked (05-5)', () => {
  const r = boot();
  const d = el('DIV', { id: 'token', isContentEditable: true, textContent: 'abc123' });
  r.fire('input', { target: d });
  r.tick(400); r.tick(0);
  assert.equal(r.emitted[0].masked, true);
  assert.ok(!JSON.stringify(r.emitted[0]).includes('abc123'));
});

test('a plain div that is not editable is ignored', () => {
  const r = boot();
  r.fire('input', { target: el('DIV', { isContentEditable: false, textContent: 'x' }) });
  r.tick(1000);
  assert.equal(r.emitted.length, 0);
});

test('change events carry the field control (11-2 recorder side)', () => {
  const r = boot();
  r.fire('change', { target: el('INPUT', { type: 'checkbox', checked: true, id: 'c' }) });
  r.fire('change', { target: el('INPUT', { type: 'radio', checked: false, id: 'r' }) });
  r.fire('change', { target: el('SELECT', { id: 's', options: [{ text: 'Amman' }], selectedIndex: 0, value: 'amm' }) });
  r.tick(0);
  const [c, ra, s] = r.emitted;
  assert.deepEqual([c.action, c.control, c.value], ['change', 'checkbox', 'checked']);
  assert.deepEqual([ra.action, ra.control, ra.value], ['change', 'radio', 'unchecked']);
  assert.deepEqual([s.action, s.control, s.value], ['change', 'select', 'Amman']);
});

test('a text change is an input action without a control', () => {
  const r = boot();
  r.fire('change', { target: el('INPUT', { type: 'text', id: 't', value: 'v' }) });
  r.tick(0);
  assert.equal(r.emitted[0].action, 'input');
  assert.equal(r.emitted[0].control, undefined);
});

test('nothing is recorded, or bumped, when no session records', () => {
  const r = boot({ recording: false });
  r.fire('click', { target: el('BUTTON') });
  r.tick(1000);
  assert.deepEqual(r.log, []);
});

test('nothing is recorded while the master switch is off', () => {
  const r = boot();
  r.sandbox.UQAAwake = false;
  r.fire('click', { target: el('BUTTON') });
  r.tick(1000);
  assert.deepEqual(r.log, []);
});

test('keydown after typing: the pending input is emitted first, then the key (r2-05-1)', () => {
  for (const key of ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']) {
    const r = boot();
    const f = el('INPUT', { id: 'q', type: 'text', value: 'abc' });
    r.fire('input', { target: f });
    r.tick(50);
    r.fire('keydown', { target: f, key });
    r.tick(1000);
    assert.deepEqual(r.emitted.map((e) => e.action), ['input', 'keydown'], key);
    assert.equal(r.emitted[0].value, 'abc');
    assert.equal(r.emitted[1].key, key);
  }
});

test('keydown with nothing pending emits only the key; Tab is ignored (r2-05-1)', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text' });
  r.fire('keydown', { target: f, key: 'Enter' });
  r.fire('keydown', { target: f, key: 'Tab' });
  r.tick(1000);
  assert.deepEqual(r.emitted.map((e) => e.action), ['keydown']);
});

test('pagehide with a pending input emits it synchronously, for every field (r2-05-3)', () => {
  const r = boot();
  const a = el('INPUT', { id: 'a', type: 'text', value: 'one' });
  const b = el('TEXTAREA', { id: 'b', value: 'two' });
  r.fire('input', { target: a });
  r.fire('input', { target: b });
  r.fireWindow('pagehide', {});
  assert.deepEqual(r.emitted.map((e) => e.value), ['one', 'two'], 'no timer tick needed');
  r.tick(1000);
  assert.equal(r.emitted.length, 2, 'the debounce timers were cleared, nothing is emitted twice');
});

test('beforeRecordingOff flushes while the flag is still on (r2-05-3)', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'typed' });
  r.fire('input', { target: f });
  assert.equal(typeof r.bridge.beforeRecordingOff, 'function');
  r.bridge.beforeRecordingOff();
  r.state.recording = false;
  r.tick(1000);
  assert.deepEqual(r.emitted.map((e) => e.value), ['typed']);
});

test('a change settles the pending entry: no second flush on pagehide (r2-05-3)', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'x' });
  r.fire('input', { target: f });
  r.fire('change', { target: f });
  r.fireWindow('pagehide', {});
  r.tick(1000);
  assert.equal(r.emitted.length, 1);
});

test('r3-05-2: the locator is snapshotted in the capture phase, before the page handler removes the element', () => {
  const r = boot();
  r.sandbox.UQASelector.describe = (e) => (e.gone ? null : { name: 'Close', role: 'button', css: '#close', locator: "getByRole('button', { name: 'Close' })", matches: 1 });
  const btn = el('BUTTON', { id: 'close' });
  r.fire('click', { target: btn, button: 0 });
  btn.gone = true; // the page's own handler removes the control before the timer ticks
  r.tick(0);
  assert.equal(r.emitted.length, 1, 'the action is still emitted');
  assert.equal(r.emitted[0].locator, "getByRole('button', { name: 'Close' })", 'with the locator it had when pressed');
  assert.equal(r.emitted[0].selector, '#close');
  assert.equal(r.emitted[0].label, 'Close');
});

// Chrome reports a picked file as a fake Windows path; built from pieces so no drive-letter literal sits in a test:ci suite.
const FAKE = String.fromCharCode(67, 58, 92) + 'fakepath' + String.fromCharCode(92);

test('r3-05-4: a file input records an upload by file name only, never the fake path', () => {
  const r = boot();
  const f = el('INPUT', { id: 'cv', type: 'file', value: FAKE + 'resume.pdf', files: [{ name: 'resume.pdf' }] });
  r.fire('input', { target: f });
  r.fire('change', { target: f });
  r.tick(1000);
  assert.equal(r.emitted.length, 1, 'one event: the debounce does not record a second one');
  assert.equal(r.emitted[0].action, 'upload');
  assert.equal(r.emitted[0].value, 'resume.pdf');
  assert.ok(!/fakepath/i.test(JSON.stringify(r.emitted)), 'no fakepath anywhere in the record');
  const r2 = boot();
  const g = el('INPUT', { id: 'cv2', type: 'file', value: FAKE + 'scan.png' });
  r2.fire('change', { target: g });
  r2.tick(0);
  assert.equal(r2.emitted[0].value, 'scan.png', 'with no files list, the last path segment is the name');
});

/** The real bridge.js and recorder.js in one context: announceRecording is the shipped code. */
async function bootReal() {
  const sent = [];
  const acts = [];
  const docListeners = {};
  const sandbox = {
    console,
    chrome: {
      runtime: {
        id: 'ext', lastError: null,
        sendMessage(msg, cb) { sent.push(msg); cb?.(null); },
        onMessage: { addListener() {} },
      },
    },
    location: { href: 'https://app.test/' },
    document: {
      visibilityState: 'visible', querySelectorAll: () => [], baseURI: 'https://app.test/',
      addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout, clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    postMessage(m) { if (m?.source === 'uqa-act') acts.push(m.act); },
    dispatchEvent() { return true; },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SRC, sandbox, { filename: 'content/bridge.js' });
  sandbox.UQASelector = { describe: () => ({ name: 'q', role: 'textbox', css: '#q', locator: "locator('#q')", matches: 1 }), accessibleName: () => '' };
  for (let i = 0; i < 10; i++) await Promise.resolve(); // let the startup state round trips settle
  sandbox.UQAAwake = true; // the stub worker answered "not armed"; the master switch is on for this test
  sandbox.UQABridge.setRecording(true);
  vm.runInContext(SRC, sandbox, { filename: 'content/recorder.js' });
  return { sandbox, sent, docListeners, acts };
}

try {
  const real = await bootReal();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'last words' });
  for (const fn of real.docListeners.input || []) fn({ target: f });
  const events = () => real.sent.filter((m) => m.type === 'UQA_EVENT').map((m) => m.event);
  assert.equal(events().length, 0, 'still debouncing');
  real.sandbox.UQABridge.setRecording(false); // the real announceRecording(false)
  assert.deepEqual(events().map((e) => e.value), ['last words'], 'the pending input is emitted before the flag flips (r3-05-1)');
  assert.equal(real.sandbox.UQABridge.isRecording(), false);
  passed++; console.log('  ok  r3-05-1: the real announceRecording(false) emits the pending input before the flag flips');
} catch (err) {
  failures.push('r3-05-1 real announceRecording'); console.log('  FAIL r3-05-1 real announceRecording\n       ' + err.message);
}

try {
  const real = await bootReal();
  const btn = el('BUTTON', { id: 'b' });
  for (const fn of real.docListeners.click || []) fn({ target: btn, button: 0 });
  assert.deepEqual(real.acts, [1], 'the recorder advanced the epoch in the capture phase');
  real.sandbox.UQABridge.emit({ kind: 'dom', action: 'click', tag: 'div' }); // a foreign dom emit before the recorder's own
  assert.deepEqual(real.acts, [1, 2], 'the foreign emit bumps for itself and leaves the recorder pre-bump alone');
  await new Promise((r) => setTimeout(r, 10));
  const doms = real.sent.filter((m) => m.type === 'UQA_EVENT' && m.event.kind === 'dom');
  assert.equal(doms.length, 2);
  assert.deepEqual(real.acts, [1, 2], 'and the recorder emit then adds no second bump: one bump per action');
  assert.ok(doms.every((m) => !('preBumped' in m.event)), 'the internal marker never leaves the page');
  passed++; console.log('  ok  r4-05-2: a foreign dom emit does not consume the recorder pre-bump');
} catch (err) {
  failures.push('r4-05-2 foreign emit'); console.log('  FAIL r4-05-2 foreign emit\n       ' + err.message);
}

test('r4-05-1: input, settle, then change with the same value records once; a different value records twice', () => {
  const r = boot();
  const f = el('INPUT', { id: 'q', type: 'text', value: 'abc' });
  r.fire('input', { target: f });
  r.tick(500);
  r.fire('change', { target: f });
  r.tick(0);
  assert.equal(r.emitted.length, 1, 'the change adds nothing: the settled value was already recorded');
  const r2 = boot();
  const g = el('INPUT', { id: 'q', type: 'text', value: 'abc' });
  r2.fire('input', { target: g });
  r2.tick(500);
  g.value = 'abcd';
  r2.fire('change', { target: g });
  r2.tick(0);
  assert.deepEqual(r2.emitted.map((e) => e.value), ['abc', 'abcd']);
  const r3 = boot(); // a password: the masked text is identical, the values are not
  const p = el('INPUT', { id: 'pw', type: 'password', value: 'one' });
  r3.fire('input', { target: p });
  r3.tick(500);
  p.value = 'two';
  r3.fire('change', { target: p });
  r3.tick(0);
  assert.equal(r3.emitted.length, 2, 'a changed secret is still recorded (compared raw, not masked)');
});

test('D-1010-87: a paste is one masked input step; the pasted text is never recorded and no second step follows', () => {
  const r = boot();
  const f = el('INPUT', { id: 'notes', type: 'text', value: 'Pasted: 4111 1111 1111 1111' });
  r.fire('input', { target: f, inputType: 'insertFromPaste', isTrusted: true });
  r.tick(1000);
  r.fire('change', { target: f }); // blur after the paste: the value is the same one, so it adds nothing
  r.tick(0);
  assert.equal(r.emitted.length, 1, 'one step');
  assert.equal(r.emitted[0].action, 'input');
  assert.equal(r.emitted[0].masked, true);
  assert.equal(r.emitted[0].control, 'paste');
  assert.ok(!JSON.stringify(r.emitted).includes('4111'), 'the pasted text is nowhere in the record');
  assert.equal(r.log.filter((x) => x === 'bump').length, 1, 'the paste is one act');
  // typing that is still debouncing when the paste lands holds the pasted text too, so only the masked paste step is recorded
  const r2 = boot();
  const g = el('INPUT', { id: 'q', type: 'text', value: 'abc' });
  r2.fire('input', { target: g, inputType: 'insertText' });
  g.value = 'abcPASTED-SECRET';
  r2.fire('input', { target: g, inputType: 'insertFromPaste' });
  r2.tick(1000);
  assert.deepEqual(r2.emitted.map((e) => e.control || e.action), ['paste'], 'the paste step only');
  g.value = 'abcPASTED-SECRETdef'; // later typing in the same field is masked as well
  r2.fire('input', { target: g, inputType: 'insertText' });
  r2.tick(1000);
  assert.equal(r2.emitted.length, 2);
  assert.equal(r2.emitted[1].masked, true);
  assert.ok(!JSON.stringify(r2.emitted).includes('PASTED-SECRET'), 'the pasted text is nowhere in the record');
});

test('D-1010-87: a file drop is one upload step by file name only; a drop on a file input and a plain text drop add nothing', () => {
  const r = boot();
  const zone = el('DIV', { id: 'zone' });
  r.fire('drop', { target: zone, isTrusted: true, dataTransfer: { files: [{ name: 'cv.pdf' }, { name: 'scan.png' }] } });
  r.tick(0);
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].action, 'upload');
  assert.equal(r.emitted[0].control, 'drop');
  assert.equal(r.emitted[0].value, 'cv.pdf, scan.png');
  const r2 = boot();
  r2.fire('drop', { target: el('INPUT', { type: 'file' }), dataTransfer: { files: [{ name: 'a.txt' }] } });
  r2.fire('drop', { target: zone, dataTransfer: { files: [] } });
  r2.fire('drop', { target: zone });
  r2.tick(0);
  assert.equal(r2.emitted.length, 0, 'the file input records its own change; a drop without files is not an upload');
});

test('r6-11-2a: a click while the picker is active (an assert pick) records no step; once it ends, clicks record again', () => {
  const r = boot();
  let picking = true;
  r.sandbox.UQAPicker = { isActive: () => picking };
  r.fire('click', { target: el('P', { id: 'saved' }), button: 0, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted.length, 0, 'the assert pick is not a click step');
  picking = false;
  r.fire('click', { target: el('P', { id: 'saved' }), button: 0, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted.length, 1);
});

test('r7-05-4 (D-1010-154): contextmenu is a step only when the page prevented it, checked after the page had its turn', () => {
  const r = boot();
  const plain = { target: el('DIV', { id: 'a' }), isTrusted: true, defaultPrevented: false };
  r.fire('contextmenu', plain);
  r.tick(0);
  assert.equal(r.emitted.length, 0, 'the browser menu opened: nothing to replay');
  const mine = { target: el('DIV', { id: 'b' }), isTrusted: true, defaultPrevented: false };
  r.fire('contextmenu', mine);
  mine.defaultPrevented = true; // the page handler runs after our capture listener and prevents the default
  r.tick(0);
  assert.equal(r.emitted.length, 1, 'the page opened its own menu: one step');
  assert.equal(r.emitted[0].button, 2);
});

test('r7-05-3: the capture-phase describe() gets a time budget of about 40 ms', () => {
  const r = boot();
  let seen = null;
  const base = r.sandbox.UQASelector.describe;
  r.sandbox.UQASelector.describe = (e, o) => { seen = o; return base(e); };
  r.fire('click', { target: el('BUTTON', { id: 'go' }), button: 0, isTrusted: true });
  r.tick(0);
  assert.ok(seen && seen.budgetMs >= 30 && seen.budgetMs <= 50, `budgetMs ${seen?.budgetMs}`);
});

/* selector-engine.js under node:vm with a one-page fake DOM: enough for describe() to rank and resolve candidates. */
function engine(tag, attrs, text, { twin = false, tick = 0 } = {}) {
  const SEL = fs.readFileSync(path.join(HERE, '..', 'content', 'selector-engine.js'), 'utf8');
  const mk = (a, parent) => ({
    nodeType: 1, tagName: tag, id: a.id || '', textContent: text, children: [], childNodes: [], classList: [], parentElement: parent,
    previousElementSibling: null, type: '', shadowRoot: null,
    getAttribute: (n) => a[n] ?? null, hasAttribute: (n) => n in a, closest: () => null, matches: () => false,
  });
  const body = { nodeType: 1, tagName: 'BODY', id: '', textContent: text, children: [], classList: [], parentElement: null, getAttribute: () => null, hasAttribute: () => false, closest: () => null };
  const el = mk(attrs, body);
  const all = twin ? [el, mk(attrs, body)] : [el];
  body.children = all;
  const document = { body, documentElement: body, querySelectorAll: () => all.slice(), querySelector: () => null, getElementById: () => null };
  all.forEach((e) => { e.ownerDocument = document; });
  let t = 0;
  const win = {}; win.parent = win;
  const ctx = { window: win, document, performance: { now: () => (t += tick) }, CSS: { escape: (x) => x }, getComputedStyle: () => ({}), console };
  vm.createContext(ctx);
  vm.runInContext(SEL, ctx, { filename: 'content/selector-engine.js' });
  return { S: win.UQASelector, el };
}

test('r6-11-2b: a role=status element without a label gets a text locator, never getByRole(status, { name })', () => {
  const { S, el: node } = engine('P', { role: 'status' }, 'Saved');
  const d = S.describe(node);
  assert.equal(d.strategy, 'text');
  assert.ok(!/getByRole\('status'/.test(d.locator), d.locator);
  assert.ok(!d.alternatives.some((a) => /getByRole\('status', \{ name/.test(a.expr)), 'no by-name status alternative either');
  const labelled = engine('P', { role: 'status', 'aria-label': 'Save state' }, 'Saved');
  assert.match(labelled.S.describe(labelled.el).locator, /getByRole\('status', \{ name: 'Save state'/, 'a declared name keeps the role locator');
  const button = engine('BUTTON', {}, 'Save');
  assert.match(button.S.describe(button.el).locator, /getByRole\('button', \{ name: 'Save'/, 'a name-from-content role keeps it');
});

test('r7-05-3: describe(el, { budgetMs }) stops resolving, returns the best so far and keeps the no-unique warning', () => {
  const full = engine('DIV', { role: 'status' }, 'Saved', { twin: true });
  const whole = full.S.describe(full.el);
  const cut = engine('DIV', { role: 'status' }, 'Saved', { twin: true, tick: 100 });
  const quick = cut.S.describe(cut.el, { budgetMs: 40 });
  assert.ok(quick && quick.locator, 'a locator comes back');
  assert.ok(quick.alternatives.length < whole.alternatives.length, `${quick.alternatives.length} < ${whole.alternatives.length}`);
  assert.ok(quick.warnings.some((w) => /No candidate resolved to exactly one element/.test(w)), 'the existing warning');
  const none = cut.S.describe(cut.el);
  assert.equal(none.alternatives.length, whole.alternatives.length, 'no budget: the whole list, as before');
});


/** A tiny tree: `closest(sel)` walks self and ancestors against the three kinds the recorder asks for (native, [role], [onclick]). */
function node(tagName, { role = null, onclick = false, parent = null, ...extra } = {}) {
  const n = {
    nodeType: 1, tagName, type: '', value: '', id: '', name: '', parentElement: parent,
    getAttribute: (k) => (k === 'role' ? role : null),
    matches: (sel) => /^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(tagName) || (onclick && /onclick/.test(sel)),
    closest(sel) {
      for (let c = this; c; c = c.parentElement) if (c.matches(sel) || (/\[role\]/.test(sel) && c.getAttribute('role'))) return c;
      return null;
    },
    ...extra,
  };
  return n;
}

test('r8-05-3: a click inside a role=dialog (or any container role) is the inner element\'s step, not the dialog\'s', () => {
  const r = boot();
  const dialog = node('DIV', { role: 'dialog', id: 'dlg' });
  const inner = node('DIV', { id: 'inner', parent: dialog, onclick: true });
  const plain = node('DIV', { id: 'plain', parent: dialog });
  r.fire('click', { target: inner, button: 0, isTrusted: true });
  r.fire('click', { target: plain, button: 0, isTrusted: true });
  r.tick(0);
  assert.deepEqual(r.emitted.map((e) => e.selector), ['#inner', '#plain']);
  for (const role of ['listbox', 'toolbar', 'group', 'region', 'menu', 'tablist', 'grid', 'tree']) {
    const box = node('DIV', { role, id: 'box' });
    r.emitted.length = 0;
    r.fire('click', { target: node('DIV', { id: 'kid', parent: box }), button: 0, isTrusted: true });
    r.tick(0);
    assert.equal(r.emitted[0].selector, '#kid', `role=${role} is a container, not what was clicked`);
  }
});

test('r8-05-3: an interactive role still wins over its children, and a native control inside a container stays itself', () => {
  const r = boot();
  for (const role of ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'checkbox', 'radio', 'switch', 'combobox', 'textbox', 'treeitem', 'slider', 'spinbutton']) {
    const host = node('DIV', { role, id: 'op' });
    r.emitted.length = 0;
    r.fire('click', { target: node('SPAN', { id: 'kid', parent: host }), button: 0, isTrusted: true });
    r.tick(0);
    assert.equal(r.emitted[0].selector, '#op', `role=${role} is operated by a person: the step is on it`);
  }
  const dialog = node('DIV', { role: 'dialog', id: 'dlg' });
  const btn = node('BUTTON', { id: 'ok', parent: dialog });
  r.emitted.length = 0;
  r.fire('click', { target: node('SPAN', { id: 'label', parent: btn }), button: 0, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted[0].selector, '#ok', 'a button inside a dialog is still the button');
  const card = node('A', { id: 'card' });
  const group = node('DIV', { role: 'group', id: 'grp', parent: card });
  r.emitted.length = 0;
  r.fire('click', { target: node('DIV', { id: 'in', parent: group }), button: 0, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted[0].selector, '#card', 'a container role in between does not hide the link that was really clicked');
});

test('r8-05-3: dblclick, contextmenu and auxclick use the same rule as click', () => {
  const r = boot();
  const dialog = node('DIV', { role: 'dialog', id: 'dlg' });
  const kid = node('DIV', { id: 'kid', parent: dialog });
  r.fire('dblclick', { target: kid, button: 0, isTrusted: true });
  r.fire('contextmenu', { target: kid, isTrusted: true, defaultPrevented: true });
  r.fire('auxclick', { target: kid, button: 1, isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted.length, 3);
  assert.deepEqual([...new Set(r.emitted.map((e) => e.selector))], ['#kid']);
  assert.deepEqual(r.emitted.map((e) => e.action), ['dblclick', 'click', 'click']);
});

test('D-1010-174: an input step on type=range or type=color carries control; a text field does not', () => {
  const r = boot();
  r.fire('input', { target: el('INPUT', { type: 'range', value: '7', id: 'vol' }), inputType: 'insertText', isTrusted: true });
  r.fire('input', { target: el('INPUT', { type: 'color', value: '#ff0000', id: 'tint' }), inputType: 'insertText', isTrusted: true });
  r.fire('input', { target: el('INPUT', { type: 'text', value: 'abc', id: 'name' }), inputType: 'insertText', isTrusted: true });
  r.tick(1000);
  const [range, color, text] = r.emitted;
  assert.deepEqual([range.action, range.control, range.value], ['input', 'range', '7']);
  assert.deepEqual([color.action, color.control, color.value], ['input', 'color', '#ff0000']);
  assert.equal(text.control, undefined, 'a text field has no control');
  // the change that follows a settled value adds nothing, and an unsettled change is still tagged
  r.emitted.length = 0;
  r.fire('change', { target: el('INPUT', { type: 'range', value: '9', id: 'vol2' }), isTrusted: true });
  r.tick(0);
  assert.equal(r.emitted[0].control, 'range', 'a range that only fires change is still a range step');
  r.emitted.length = 0;
  r.fire('change', { target: el('INPUT', { type: 'checkbox', checked: true, id: 'c' }) });
  r.tick(0);
  assert.equal(r.emitted[0].control, 'checkbox', 'checkbox is unchanged');
});

console.log('\nr9-05-3: keys that carry intent');

test('r9-05-3: Space is a step on a div[role=button] (no click of its own), not on a text field or a native control; Home and End are steps; Tab is not', () => {
  const r = boot();
  const custom = el('DIV', { id: 'custom', closest: () => null });
  r.fire('keydown', { target: custom, key: ' ' });
  r.fire('keydown', { target: custom, key: 'Home' });
  r.fire('keydown', { target: custom, key: 'End' });
  r.fire('keydown', { target: custom, key: 'Tab' });
  r.fire('keydown', { target: el('INPUT', { type: 'text', id: 'f' }), key: ' ' });
  r.fire('keydown', { target: el('BUTTON', { id: 'b' }), key: ' ' }); // a native button clicks on Space itself
  r.fire('keydown', { target: el('SPAN', { id: 'inner', closest: (sel) => (/button/.test(sel) ? {} : null) }), key: ' ' }); // inside a native button
  r.tick(0);
  assert.deepEqual(r.emitted.map((e) => e.key), ['Space', 'Home', 'End'], 'Space is recorded as the name Playwright presses');
  assert.ok(r.emitted.every((e) => e.action === 'keydown' && e.selector === '#custom'));
});

console.log('\nr10-05-1: modifiers and IME composition');

test('r10-05-1: click and dblclick carry the held modifiers in a fixed order; a plain click carries []', () => {
  const r = boot();
  r.fire('click', { target: el('BUTTON', { id: 'a' }), button: 0, shiftKey: true, ctrlKey: true });
  r.fire('dblclick', { target: el('BUTTON', { id: 'a' }), button: 0, metaKey: true, altKey: true });
  r.fire('click', { target: el('BUTTON', { id: 'a' }), button: 0 });
  r.tick(0);
  assert.equal(JSON.stringify(r.emitted.map((e) => e.mods)), '[["Control","Shift"],["Alt","Meta"],[]]'); // JSON: the arrays come from the vm realm
});

test('r10-05-1: Shift+Enter and Ctrl+Enter keep the modifier in the key name; a bare Enter stays Enter', () => {
  const r = boot();
  const f = el('TEXTAREA', { id: 'note' });
  r.fire('keydown', { target: f, key: 'Enter', shiftKey: true });
  r.fire('keydown', { target: f, key: 'Enter', ctrlKey: true, shiftKey: true });
  r.fire('keydown', { target: f, key: 'Enter' });
  r.tick(0);
  assert.deepEqual(r.emitted.map((e) => e.key), ['Shift+Enter', 'Control+Shift+Enter', 'Enter']);
});

test('r10-05-1: the Enter that commits an IME composition is not a step (isComposing and keyCode 229)', () => {
  const r = boot();
  const f = el('TEXTAREA', { id: 'note' });
  r.fire('keydown', { target: f, key: 'Enter', isComposing: true });
  r.fire('keydown', { target: f, key: 'Process', keyCode: 229 });
  r.fire('keydown', { target: f, key: 'Enter', keyCode: 229 });
  r.tick(0);
  assert.equal(r.emitted.length, 0, 'no step for a composition key');
});

console.log('\nD-197: per-phase marks for the perf row');

test('D-197: with window.__qawRecMarks set, a click and a masked-field change write qaw:rec:selector / sanitise / send / privacy measures; without it, none', () => {
  const marks = [];
  const wire = (r, on) => {
    r.sandbox.performance = { now: () => Number(process.hrtime.bigint()) / 1e6, measure: (name, o) => marks.push([name, o.end - o.start]) };
    if (on) r.sandbox.__qawRecMarks = true;
  };
  const off = boot(); wire(off, false);
  off.fire('click', { target: el('BUTTON', { id: 'a' }), button: 0 }); off.tick(0);
  assert.equal(marks.length, 0, 'no flag, no entries (a long session keeps none)');
  const on = boot(); wire(on, true);
  on.fire('click', { target: el('BUTTON', { id: 'a' }), button: 0 });
  on.fire('change', { target: el('INPUT', { type: 'text', id: 'q', value: 'hello' }) });
  on.tick(0);
  const names = new Set(marks.map(([n]) => n));
  for (const n of ['qaw:rec:selector', 'qaw:rec:sanitise', 'qaw:rec:send', 'qaw:rec:privacy']) assert.ok(names.has(n), `${n} was not measured: ${[...names]}`);
});

test('D-197: micro-benchmark of the recorder-side phases (stub selector, so the selector cost is not measured here)', () => {
  const marks = {};
  const r = boot();
  r.sandbox.performance = { now: () => Number(process.hrtime.bigint()) / 1e6, measure: (name, o) => { (marks[name] ||= []).push(o.end - o.start); } };
  r.sandbox.__qawRecMarks = true;
  const b = el('BUTTON', { id: 'a' });
  for (let i = 0; i < 2000; i++) { r.fire('click', { target: b, button: 0 }); r.tick(0); }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const row = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k.replace('qaw:rec:', ''), +med(v).toFixed(4)]));
  console.log(`       median ms per click over 2000: ${JSON.stringify(row)}`);
  assert.ok(Object.values(row).every((v) => v >= 0 && v < 5), 'no recorder-side phase takes milliseconds in node');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
