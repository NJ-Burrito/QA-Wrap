/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The finish cue (`cueOp` in background/media.js): who may play, and when it
 * must stay silent. Runs the real function with the worker-side probes faked,
 * and the real `getContexts` contract is checked by the boot smoke / probe.
 *
 * Exactly one player per state: an open popup or side panel plays its own cue,
 * so the worker is silent; with none open the worker plays; a hidden tab page
 * forwards and the worker plays; a recording, an off setting, a sleeping
 * extension, a short job and a touch-tier name are all silent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.chrome = { runtime: { getURL: (p) => p, id: 'x' }, storage: { local: {}, session: {}, sync: {}, managed: {} } };
const { cueOp } = await import('../background/media.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** A world: every probe recorded. `open` is what getContexts answers. */
function world({ on = true, vol = 70, awake = true, open = [], states = [{ recording: false }] } = {}) {
  const w = { created: 0, sent: [], asked: [] };
  let i = 0;
  w.deps = {
    settings: async () => ({ soundEnabled: on, soundVolume: vol, soundScope: 'core' }),
    awake: async () => awake,
    contexts: async (o) => { w.asked.push(o.contextTypes.join('+')); return open; },
    state: async () => states[Math.min(i++, states.length - 1)],
    ensure: async () => { w.created++; },
    send: async (m) => { w.sent.push(m); },
  };
  return w;
}
const cue = (w, name, o = {}) => cueOp(name, { deps: w.deps, ...o });
const LONG = Date.now() - 60_000;

console.log('cue-door: one player, never in a recording');

await test('a known-true sample: no page open, long job, awake, on => one cue with the setting values', async () => {
  const w = world();
  assert.equal(await cue(w, 'links.broken', { startedAt: LONG }), 'played');
  assert.deepEqual(w.sent, [{ name: 'links.broken', on: true, level: 0.7, scope: 'core' }]);
  assert.deepEqual(w.asked, ['POPUP+SIDE_PANEL'], 'both page types asked in one call');
});

await test('setting off, or volume 0, sends nothing', async () => {
  for (const w of [world({ on: false }), world({ vol: 0 })]) {
    assert.equal(await cue(w, 'record.stop'), 'off');
    assert.equal(w.sent.length + w.created, 0);
  }
});

await test('asleep creates nothing, not even a document', async () => {
  const w = world({ awake: false });
  assert.equal(await cue(w, 'record.stop'), 'asleep');
  assert.equal(w.created + w.sent.length, 0);
});

await test('a recording sends nothing; the stop cue sent after the flip sends', async () => {
  const w = world({ states: [{ recording: true }] });
  assert.equal(await cue(w, 'record.stop'), 'recording');
  assert.equal(w.sent.length, 0);
  const w2 = world({ states: [{ recording: true }, { recording: false }] });
  assert.equal(await cue(w2, 'record.stop'), 'recording', 'while still recording');
  assert.equal(await cue(w2, 'record.stop'), 'played', 'after stop resolved');
});

await test('a popup or a side panel open: the worker is silent (that page plays its own)', async () => {
  for (const open of [[{ contextType: 'POPUP' }], [{ contextType: 'SIDE_PANEL' }]]) {
    const w = world({ open });
    assert.equal(await cue(w, 'harvest.done', { startedAt: LONG }), 'page-open');
    assert.equal(w.sent.length + w.created, 0);
  }
});

await test('a job under 5 s sends nothing; 5 s and over sends', async () => {
  assert.equal(await cue(world(), 'harvest.done', { startedAt: Date.now() - 1000 }), 'short');
  assert.equal(await cue(world(), 'harvest.done', { startedAt: Date.now() - 5000 }), 'played');
});

await test('touch-tier and unknown names are never sent', async () => {
  for (const name of ['ui.tap', 'ui.primary', 'capture.shot', 'record.start', 'session.start', 'tap', '', undefined]) {
    const w = world();
    assert.equal(await cue(w, name, { startedAt: LONG }), 'name', String(name));
    assert.equal(w.sent.length + w.created, 0);
  }
});

await test('D1: exactly one player in each of four states', async () => {
  // page plays iff it is open and visible; the worker plays iff the rules above let it.
  const players = async (state) => {
    const w = world({ open: state.open ? [{}] : [] });
    const worker = (await cue(w, 'links.clean', { startedAt: LONG, forwarded: state.hiddenTab })) === 'played' ? 1 : 0;
    const page = state.open || state.visibleTab ? 1 : 0;
    return worker + page;
  };
  assert.equal(await players({ open: true }), 1, 'popup open');
  assert.equal(await players({ open: true, panel: true }), 1, 'panel open');
  assert.equal(await players({}), 1, 'neither open: the worker');
  assert.equal(await players({ hiddenTab: true }), 1, 'tab hidden: forwarded, worker plays');
});

await test('a forwarded cue skips the page and time checks but not asleep or recording', async () => {
  const w = world({ open: [{}] });
  assert.equal(await cue(w, 'save.done', { forwarded: true }), 'played');
  assert.equal(w.asked.length, 0);
  assert.equal(await cue(world({ awake: false }), 'save.done', { forwarded: true }), 'asleep');
  assert.equal(await cue(world({ states: [{ recording: true }] }), 'save.done', { forwarded: true }), 'recording');
});

await test('the real caller: the worker wires the handler and the three finish cues', () => {
  const sw = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../background/service-worker.js'), 'utf8');
  assert.match(sw, /UQA_CUE: async \(msg\) => \{ const why = await cueOp\(msg\?\.name, \{ forwarded: true \}\)/);
  for (const t of ['UQA_RECORD_STOP', 'UQA_CHECK_LINKS', 'UQA_HARVEST']) assert.ok(sw.includes(`['${t}'`), t);
});

await test('the offscreen document plays it, and the justification says so', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const off = fs.readFileSync(path.join(root, 'offscreen/offscreen.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'offscreen/offscreen.html'), 'utf8');
  const media = fs.readFileSync(path.join(root, 'background/media.js'), 'utf8');
  assert.match(off, /case 'UQA_OFF_CUE'/);
  assert.ok(html.indexOf('ui/sound.js') > 0 && html.indexOf('ui/sound.js') < html.indexOf('offscreen.js'), 'sound.js before offscreen.js');
  assert.match(media, /result\s*'\s*\n?\s*\+ 'sound the tester turned on/);
  assert.match(media, /reasons: \['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS', 'CLIPBOARD'\]/, 'no new reason');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
