/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Opt-in pre-roll buffer (devil point 16).   node tools/test-devil-a3.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULTS } from '../platform/settings.js';
import { workerSrc } from './lib-worker-src.mjs';

const bridgeSrc = fs.readFileSync(new URL('../content/bridge.js', import.meta.url), 'utf8');
const worker = workerSrc();
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

/** The real bridge.js in a vm; the worker answers "not recording" and "awake". */
async function load(settings) {
  const sent = [];
  const listeners = [];
  const win = {
    UQASettings: settings, top: null, addEventListener() {}, dispatchEvent() {}, postMessage() {},
    location: { href: 'https://x.test/' },
  };
  win.top = win;
  const chrome = {
    runtime: {
      id: 'me', lastError: null, onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: (m, cb) => {
        sent.push(m);
        const res = m.type === 'UQA_ARMED' ? { result: { armed: true } } : m.type === 'UQA_GET_STATE' ? { result: { recording: false } }
          : m.type === 'UQA_GET_SETTINGS' ? { ok: true, result: settings } : null;
        cb(res);
      },
    },
  };
  const ctx = vm.createContext({ window: win, chrome, document: { visibilityState: 'hidden', addEventListener() {} }, location: win.location, CustomEvent: class {}, Promise, Date, setInterval() {} });
  vm.runInContext(bridgeSrc, ctx);
  await new Promise((r) => setTimeout(r, 20));
  const tell = (msg) => listeners.forEach((f) => f(msg, { id: 'me' }, () => {}));
  return { win, sent, tell, B: win.UQABridge };
}

await test('off by default: nothing is buffered', async () => {
  assert.equal(DEFAULTS.preRollBuffer, false);
  const { B } = await load({ preRollBuffer: false });
  B.emit({ kind: 'note', text: 'a' });
  assert.equal(B.preRollSize(), 0);
});

await test('on: ring is bounded by count (300) and by age (60 s)', async () => {
  const { B, win } = await load({ preRollBuffer: true });
  win.UQAAwake = true;
  for (let i = 0; i < 350; i++) B.emit({ kind: 'note', text: String(i) });
  assert.equal(B.preRollSize(), 300);
  B.emit({ kind: 'note', text: 'old', ts: Date.now() - 61000 });
  B.emit({ kind: 'note', text: 'new' });
  assert.equal(B.preRollSize(), 300, 'the stale event was trimmed on the next push');
});

await test('flush on start: sent flagged preRoll, before live events, ring emptied', async () => {
  const { B, win, sent, tell } = await load({ preRollBuffer: true });
  win.UQAAwake = true;
  B.emit({ kind: 'note', text: 'before' });
  sent.length = 0;
  tell({ type: 'UQA_STATE_CHANGED', recording: true });
  const ev = sent.filter((m) => m.type === 'UQA_EVENT');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].preRoll, true);
  assert.equal(ev[0].event.text, 'before');
  assert.equal(B.preRollSize(), 0);
});

await test('discarded when the setting is turned off or the window sleeps', async () => {
  const { B, win, tell } = await load({ preRollBuffer: true });
  win.UQAAwake = true;
  B.emit({ kind: 'note', text: 'a' });
  tell({ type: 'UQA_SETTINGS_CHANGED', settings: { preRollBuffer: false } });
  assert.equal(B.preRollSize(), 0);
  win.UQASettings = { preRollBuffer: true }; win.UQAAwake = true;
  B.emit({ kind: 'note', text: 'b' });
  tell({ type: 'UQA_ARMED_CHANGED', armed: false });
  assert.equal(B.preRollSize(), 0);
});

await test('worker: preRoll flag is set by the worker, with a widened skew, through the same scrub', async () => {
  assert.match(worker, /UQA_EVENT: \(msg, sender\) => ingest\(msg\.event, sender, msg\.preRoll === true\)/);
  assert.match(worker, /skewMs: PREROLL_SKEW_MS/);
  const i = worker.indexOf('async function ingest');
  const body = worker.slice(i, worker.indexOf('async function addNote', i));
  assert.ok(body.indexOf('preRoll: true') < body.indexOf('scrub(') + 200 && /writeQueue\.push\(await scrub\(\{[\s\S]*preRoll: true/.test(body));
});

console.log(`\n${n} passed, 0 failed`);
