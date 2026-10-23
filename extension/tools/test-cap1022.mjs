/**
 * cap1022: quieter detection, the one-minute rolling buffer, the 60/40 side panel, the EN+AR keys.
 *   node tools/test-cap1022.mjs   (from extension/)
 * Detection runs on the real content/page-hooks.js in a vm. The buffer runs on the real core/rolling-buffer.js, driven second by second.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { WINDOW_MS, SLOTS, dueRestarts, pickSave, reconcileDuration } from '../core/rolling-buffer.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const src = read('content', 'page-hooks.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

function mkEnv() {
  const posted = [];
  const handlers = {};
  const win = { addEventListener(type, fn) { (handlers[type] ||= []).push(fn); }, postMessage(m) { posted.push(m); }, setTimeout, console };
  win.window = win;
  win.fetch = (...a) => win.next(...a); // page-hooks wraps the fetch present at load; tests swap `next`
  const ctx = vm.createContext({
    window: win, console: { ...console }, performance, URL, TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError,
    JSON, RegExp, WeakMap, Symbol, location: { href: 'https://site.test/', origin: 'https://site.test' },
    document: { addEventListener() {}, readyState: 'complete' }, navigator: {}, setTimeout, clearTimeout, FormData, URLSearchParams,
  });
  vm.runInContext(src, ctx);
  const fire = (d) => { for (const h of handlers.message || []) h({ source: win, data: d }); };
  fire({ source: 'uqa-awake', awake: true });
  const ev = (k) => posted.filter((m) => m.event?.kind === k).map((m) => m.event);
  return { win, ctx, fire, ev, act: (n) => fire({ source: 'uqa-act', act: n }), handlers };
}
const answer = async (env, status) => {
  env.win.next = () => Promise.resolve(new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
  await env.win.fetch('/api/x');
  await new Promise((r) => setTimeout(r, 300));
};

await test('a 5xx is always recorded, even with no tester action', async () => {
  const env = mkEnv();
  await answer(env, 503);
  assert.equal(env.ev('net').length, 1);
  assert.equal(env.ev('net')[0].status, 503);
});

await test('a 4xx nobody caused (no tester action) is not recorded', async () => {
  const env = mkEnv();
  await answer(env, 404);
  assert.equal(env.ev('net').length, 0);
});

await test('a 4xx right after a tester action is recorded', async () => {
  const env = mkEnv();
  env.act(1);
  await answer(env, 404);
  assert.equal(env.ev('net').length, 1);
});

await test('a logged console.error is a warning line, not a failure; an uncaught error still is', async () => {
  const env = mkEnv();
  env.ctx.console.error('Warning: noisy library');
  const c = env.ev('console');
  assert.equal(c.length, 1);
  assert.equal(c[0].level, 'warn');
  assert.ok(!(await import('../core/events.js')).isFailure(c[0]));
  for (const h of env.handlers.error || []) h({ message: 'boom', filename: 'https://site.test/a.js', lineno: 1, colno: 2, error: new Error('boom'), target: env.win });
  assert.equal(env.ev('pageerror').length, 1);
});

await test('repeats group into one row with a count: 40 identical 5xx are a few rows plus one counted row', async () => {
  const env = mkEnv();
  env.win.next = () => Promise.resolve(new Response('x', { status: 500 }));
  for (let i = 0; i < 40; i++) await env.win.fetch('/api/same');
  await new Promise((r) => setTimeout(r, 1300));
  const rows = [...env.ev('net'), ...env.ev('rep')];
  assert.ok(rows.length <= 8, `${rows.length} rows for one repeating failure`);
  assert.ok(env.ev('rep').reduce((n, r) => n + (r.n || 0), 0) >= 30, 'the rest is counted on a rep row');
});

await test('the layout checks no longer run by themselves; the deep scan is on demand', () => {
  const c = read('content', 'checks.js');
  assert.ok(!/schedule\(/.test(c), 'a live scan is still scheduled');
  assert.match(c, /UQA_DEEP_SCAN/);
  assert.match(read('background', 'worker-scans.js'), /UQA_DEEP_SCAN/);
  assert.match(read('background', 'handlers-session.js'), /UQA_ROLL/);
});

await test('rolling buffer: no slot is ever older than 60 s, and once warm the oldest holds 40 to 60 s of the last minute', () => {
  const slots = Array(SLOTS).fill(null);
  const t0 = 1_000_000;
  let worst = 0;
  for (let now = t0; now <= t0 + 10 * 60_000; now += 1000) {
    for (const i of dueRestarts(slots, now, t0)) slots[i] = { startedAt: now };
    const i = pickSave(slots);
    assert.ok(i >= 0);
    const age = now - slots[i].startedAt;
    worst = Math.max(worst, age);
    assert.ok(age <= WINDOW_MS, `age ${age} at +${now - t0}`);
    if (now - t0 >= WINDOW_MS) assert.ok(age >= WINDOW_MS * (1 - 1 / SLOTS) - 1000, `only ${age} ms buffered at +${now - t0}`);
  }
  assert.ok(worst >= WINDOW_MS - 1000, 'a slot should reach the full minute');
});

await test('rolling buffer: the slots start staggered, not all at once, and nothing exists before the first tick', () => {
  const slots = Array(SLOTS).fill(null);
  const t0 = 5000;
  assert.deepEqual(dueRestarts(slots, t0, t0), [0]);
  slots[0] = { startedAt: t0 };
  assert.deepEqual(dueRestarts(slots, t0 + 10_000, t0), []);
  assert.deepEqual(dueRestarts(slots, t0 + WINDOW_MS / SLOTS, t0), [1]);
  assert.equal(pickSave(Array(SLOTS).fill(null)), -1);
});

await test('«Save last 1 minute» is a button, in a session only, with EN and AR text; rule 12 stays: no buffer site is ever turned on by it', () => {
  const html = read('popup', 'popup.html');
  assert.match(html, /<button id="roll-save"[^>]*\bhidden\b/);
  assert.ok(!/id="roll-save"[^>]*role="switch"/.test(html) && !/id="roll-save"[^>]*type="checkbox"/.test(html));
  const en = JSON.parse(read('platform', 'i18n', 'en.json'));
  const ar = JSON.parse(read('platform', 'i18n', 'ar.json'));
  const keys = Object.keys(en).filter((k) => k.startsWith('popup.cap1022.'));
  assert.ok(keys.length >= 4);
  for (const k of keys) assert.ok(ar[k] && ar[k] !== en[k], `${k} missing in Arabic`);
  assert.equal(en['popup.cap1022.rollSave'], 'Save last 1 minute');
  assert.ok(!/bufferSites/.test(read('offscreen', 'rolling.js')));
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(read('offscreen', 'rolling.js')), 'the buffer makes no network request');
});

await test('«Save last 1 minute»: rollOp reaches the media worker as UQA_OFF_ROLL, the payload cannot replace the type', async () => {
  const sent = [];
  globalThis.chrome = {
    runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, result: { rolling: true } }; }, getContexts: async () => [{}], onMessage: { addListener() {} }, getURL: (x) => x, id: 'x' },
    offscreen: { createDocument: async () => {}, hasDocument: async () => true },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }, tabs: {}, downloads: {},
  };
  const media = await import('../background/media.js');
  await media.rollOp({ type: 'UQA_ROLL', op: 'save' });
  assert.equal(sent.at(-1).type, 'UQA_OFF_ROLL');
  assert.equal(sent.at(-1).op, 'save');
});

await test('the saved clip\'s duration metadata is what the media decodes to (within 1 s), never the wall time of a mostly still tab', () => {
  assert.ok(Math.abs(reconcileDuration(56_500, 21_421) - 21_421) <= 1000, 'metadata must follow the decoded length');
  assert.equal(reconcileDuration(56_500, null), 56_500, 'no decode: wall time');
  assert.equal(reconcileDuration(90_000, 80_000), WINDOW_MS, 'never past the window');
  const r = read('offscreen', 'rolling.js');
  assert.match(r, /reconcileDuration\(Date\.now\(\) - slot\.startedAt, await decodedMs\(blob\)\)/, 'save() stores the decoded length');
});

await test('quiet detection: a 404 loop (beacon) yields 0 findings with no click, and still 0 after a click that did not cause it; a 404 right after a click is 1', async () => {
  const beacon = async (env) => { env.win.next = () => Promise.resolve(new Response('', { status: 404 })); await env.win.fetch('/analytics/beacon', { method: 'POST' }); };
  const loop = mkEnv();
  for (let i = 0; i < 4; i++) await beacon(loop);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(loop.ev('net').length, 0, 'no click: nothing');
  loop.act(1); // a tester click lands in the middle of the loop
  for (let i = 0; i < 4; i++) await beacon(loop);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(loop.ev('net').length, 0, 'the loop was failing before the click: background');
  const caused = mkEnv();
  caused.act(1);
  await answer(caused, 404);
  assert.equal(caused.ev('net').length, 1);
});

await test('Settings > About links LinkedIn, EN and AR', () => {
  assert.match(read('options', 'options.html'), /id="about-linkedin" href="https:\/\/www\.linkedin\.com\/in\/nader-alzghoul"/);
  assert.match(read('options', 'e1022.js'), /'about-linkedin'/);
  for (const l of ['en', 'ar']) assert.ok(JSON.parse(read('platform', 'i18n', `${l}.json`))['options.e1022.aboutLinkedin']);
});

await test('side panel: tools take 3 parts of 5, the rest 2 (60/40); the island toolbar is untouched', () => {
  const css = read('popup', 'popup.css');
  assert.match(css, /data-surface='panel'\] \.app-grid \{ grid-template-rows: var\(--header-h\) minmax\(0, 2fr\) auto minmax\(0, 3fr\) auto/);
  assert.match(css, /data-surface='panel'\] \.app \.tools \{ flex: 3 1 0/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
