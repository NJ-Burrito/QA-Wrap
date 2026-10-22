/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * AUTO-2 (worker half): auto-start on a ticked site, and the 30-minute idle stop.
 *
 *   node tools/test-autostart.mjs
 *
 * Plain Node: `background/remember.js` runs against a small chrome stub. The on-page dot is the other lane's
 * (tools/test-page-indicator.mjs); here the worker's order gate is asserted: the power stays off unless
 * `content/autopilot.js` is in SITE_SCRIPTS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as remember from '../background/remember.js';
import * as realSite from '../background/site-access.js';
import { lift } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const URL_OK = 'https://shop.example.com/cart';
const PATTERN = 'https://shop.example.com/*';
const nav = { frameId: 0, tabId: 1, url: URL_OK };

/** One world: storage, alarms, a window map and the call log. */
function rig({ startSites, remembered, paused, woke, started, armedNow = true, allowed = true, consent = true, live = null, dot = true, pageIndicator, settingsDot, lang, startMs = 0, startFails = 0 } = {}) {
  const local = { autoStartSites: startSites, rememberedSites: remembered, pageIndicator };
  const session = { autoPauseUntil: paused, autoWoke: woke, autoStarted: started };
  const calls = { start: [], put: [], alarm: [], cleared: [], done: [] };
  const pick = (store, k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => store[x] !== undefined).map((x) => [x, store[x]]));
  globalThis.chrome = {
    storage: {
      local: { get: async (k) => pick(local, k), set: async (v) => Object.assign(local, v) },
      session: { get: async (k) => pick(session, k), set: async (v) => Object.assign(session, v) },
    },
    // tabs 1 and 2 share window 5; tab 3 is in window 6
    tabs: { get: async (id) => ({ windowId: id === 3 ? 6 : 5 }) },
    ...(lang ? { i18n: { getUILanguage: () => 'en-US' } } : {}),
    alarms: { create: async (n, o) => { calls.alarm.push([n, o]); }, clear: async (n) => { calls.cleared.push(n); } },
  };
  const site = {
    SITE_SCRIPTS: dot ? realSite.SITE_SCRIPTS : [{ id: 'x', js: ['content/keymap.js'] }],
    originPattern: realSite.originPattern,
    hasSiteAccess: async () => allowed,
  };
  const deps = {
    site,
    armed: { consentCurrent: async () => consent, isArmedWindow: async () => armedNow },
    live: async (w) => live ?? (calls.done.includes(w) ? 'S-started' : null),
    start: async (m) => {
      calls.start.push({ ...m, win: m.tabId === 3 ? 6 : 5 });
      if (startMs) await new Promise((r) => setTimeout(r, startMs));
      if (calls.start.length <= startFails) throw new Error('start failed');
      calls.done.push(m.tabId === 3 ? 6 : 5);
      return { id: `S${calls.start.length}`, startedAt: 1234, status: 'recording' };
    },
    putSession: async (s) => { calls.put.push({ ...s }); },
    ...(settingsDot === undefined ? {} : { dotOn: async () => settingsDot }),
  };
  if (lang) globalThis.chrome.storage.sync = { get: async () => ({ qawLanguage: lang }) };
  return { run: (d = nav) => remember.autoStart(d, deps), calls, session, local };
}

console.log('auto-start (AUTO-2)');

await test('(a) a fresh profile starts nothing', async () => {
  for (const startSites of [undefined, []]) {
    const r = rig({ startSites });
    await r.run();
    assert.equal(r.calls.start.length, 0);
  }
});

await test('(b) the opt-in site starts once: charter host + date, autoStarted recorded, idle alarm set', async () => {
  const r = rig({ startSites: [PATTERN] });
  await r.run();
  assert.equal(r.calls.start.length, 1);
  const m = r.calls.start[0];
  assert.match(m.charter, /^shop\.example\.com \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/);
  assert.equal(m.tabId, 1);
  assert.equal(m.startUrl, URL_OK);
  assert.equal(r.calls.put[0].autoStarted, true, 'the session record says it started by itself (C4)');
  assert.deepEqual(r.session.autoStarted, { S1: 1234 });
  assert.equal(r.calls.put[0].id, 'S1');
  assert.deepEqual(r.session.autoWoke, [5]);
  assert.equal(r.calls.alarm[0][0], 'qaw-autoidle');
  assert.equal(r.calls.alarm[0][1].periodInMinutes, 5);
});

await test('(b) order gate: the power is off unless content/autopilot.js is registered', async () => {
  assert.ok(realSite.SITE_SCRIPTS.find((s) => s.id === 'uqa-site-idle').js.includes('content/autopilot.js'), 'the dot ships in the idle set');
  const r = rig({ startSites: [PATTERN], dot: false });
  await r.run();
  assert.equal(r.calls.start.length, 0);
});

await test('(c) a site that is only remembered does not start; a sub-frame does not start', async () => {
  const r = rig({ remembered: [PATTERN] });
  await r.run();
  assert.equal(r.calls.start.length, 0);
  const f = rig({ startSites: [PATTERN] });
  await f.run({ ...nav, frameId: 3 });
  assert.equal(f.calls.start.length, 0);
});

await test('(c) a different origin in the list does not start this one', async () => {
  const r = rig({ startSites: ['https://other.example.com/*'] });
  await r.run();
  assert.equal(r.calls.start.length, 0);
});

await test('(d) once per window per run, and never over a live session', async () => {
  const again = rig({ startSites: [PATTERN], woke: [5] });
  await again.run();
  assert.equal(again.calls.start.length, 0);
  const liveOne = rig({ startSites: [PATTERN], live: 'S-live' });
  await liveOne.run();
  assert.equal(liveOne.calls.start.length, 0);
  const twice = rig({ startSites: [PATTERN] });
  await twice.run();
  await twice.run();
  assert.equal(twice.calls.start.length, 1);
});

await test('(d) a sleeping window is not woken by it, and no permission is asked', async () => {
  const r = rig({ startSites: [PATTERN], armedNow: false });
  await r.run();
  assert.equal(r.calls.start.length, 0);
  assert.equal(r.session.autoWoke, undefined);
  const noAccess = rig({ startSites: [PATTERN], allowed: false });
  await noAccess.run();
  assert.equal(noAccess.calls.start.length, 0);
});

await test('(e) a revised consent stops it', async () => {
  const r = rig({ startSites: [PATTERN], consent: false });
  await r.run();
  assert.equal(r.calls.start.length, 0);
});

await test('pause for 1 hour: nothing starts until the timestamp passes', async () => {
  const held = rig({ startSites: [PATTERN], paused: Date.now() + 3600e3 });
  await held.run();
  assert.equal(held.calls.start.length, 0);
  const over = rig({ startSites: [PATTERN], paused: Date.now() - 1 });
  await over.run();
  assert.equal(over.calls.start.length, 1);
});

/* ── D3: the dot's own switch is part of the gate ── */
await test('D3: the dot switched off in Settings (local key or settings object) keeps auto-start off; on, it starts', async () => {
  for (const o of [{ pageIndicator: false }, { settingsDot: false }, { pageIndicator: false, settingsDot: true }]) {
    const r = rig({ startSites: [PATTERN], ...o });
    await r.run();
    assert.equal(r.calls.start.length, 0, JSON.stringify(o));
    assert.equal(r.session.autoWoke, undefined, 'the window keeps its one attempt');
  }
  const on = rig({ startSites: [PATTERN], settingsDot: true });
  await on.run();
  assert.equal(on.calls.start.length, 1);
});

/* ── D4: one start per window, even when two navigations arrive together ── */
await test('D4: two navigations in one window at once start one session; a second window still starts its own', async () => {
  const r = rig({ startSites: [PATTERN], startMs: 20 });
  await Promise.all([r.run(), r.run({ ...nav, tabId: 2 })]);
  assert.equal(r.calls.start.length, 1, 'one start for window 5');
  assert.deepEqual(r.session.autoWoke, [5]);
  assert.equal(r.calls.put.filter((s) => s.autoStarted).length, 1);
  await Promise.all([r.run({ ...nav, tabId: 3 }), r.run({ ...nav, tabId: 3 })]);
  assert.equal(r.calls.start.length, 2, 'window 6 started once, window 5 not again');
  assert.deepEqual(r.session.autoWoke.slice().sort(), [5, 6]);
});
await test('D4: autoWoke is written only after start resolves; a start that threw keeps the window\'s attempt for the next navigation', async () => {
  const r = rig({ startSites: [PATTERN], startFails: 1 });
  await assert.rejects(r.run(), /start failed/);
  assert.equal(r.session.autoWoke, undefined, 'a failed start burns nothing');
  await r.run();
  assert.equal(r.calls.start.length, 2);
  assert.deepEqual(r.session.autoWoke, [5]);
});
await test('D11: the charter month follows the UI language: Arabic month for the Arabic UI, English month otherwise', async () => {
  const ar = rig({ startSites: [PATTERN], lang: 'ar' });
  await ar.run();
  assert.match(ar.calls.start[0].charter, /^shop\.example\.com \d{1,2} [\u0600-\u06FF ]+ \d\d:\d\d$/);
  const en = rig({ startSites: [PATTERN], lang: 'en' });
  await en.run();
  assert.match(en.calls.start[0].charter, /^shop\.example\.com \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/);
});

/* ── (f) the idle sweep ── */
function sweep({ started, status = 'recording', last }) {
  const r = rig({ started });
  const stopped = [];
  const put = [];
  const sess = { id: 'S1', status };
  const deps = {
    lastEventTs: async () => last,
    stopSession: async (id) => { stopped.push(id); sess.status = 'stopped'; },
    getSession: async (id) => (id === 'S1' ? sess : null),
    putSession: async (s) => { put.push({ ...s }); },
  };
  return { run: () => remember.idleStop(deps), stopped, put, r };
}
await test('(f) 31 minutes without an event: stopped with stopReason idle, forgotten, alarm cleared', async () => {
  const w = sweep({ started: { S1: Date.now() - 40 * 6e4 }, last: Date.now() - 31 * 6e4 });
  await w.run();
  assert.deepEqual(w.stopped, ['S1']);
  assert.equal(w.put[0].stopReason, 'idle');
  assert.deepEqual(w.r.session.autoStarted, {});
  assert.deepEqual(w.r.calls.cleared, ['qaw-autoidle']);
});
await test('(f) 29 minutes: still running, alarm kept', async () => {
  const w = sweep({ started: { S1: Date.now() - 40 * 6e4 }, last: Date.now() - 29 * 6e4 });
  await w.run();
  assert.deepEqual(w.stopped, []);
  assert.deepEqual(Object.keys(w.r.session.autoStarted), ['S1']);
  assert.deepEqual(w.r.calls.cleared, []);
});
await test('(f) no event at all counts from the start time; a session the tester already stopped is dropped', async () => {
  const none = sweep({ started: { S1: Date.now() - 31 * 6e4 }, last: null });
  await none.run();
  assert.deepEqual(none.stopped, ['S1']);
  const done = sweep({ started: { S1: Date.now() - 99 * 6e4 }, status: 'stopped', last: 0 });
  await done.run();
  assert.deepEqual(done.stopped, []);
  assert.deepEqual(done.r.session.autoStarted, {});
  assert.deepEqual(done.r.calls.cleared, ['qaw-autoidle']);
});

await test('deleting a session removes its auto rows and leaves the others', async () => {
  const r = rig({ started: { S1: 1, S2: 2 } });
  r.session.autoShotState = { S1: { n: 1 }, S2: { n: 2 } };
  await remember.forget('S1');
  assert.deepEqual(r.session.autoStarted, { S2: 2 });
  assert.deepEqual(r.session.autoShotState, { S2: { n: 2 } });
});

/* ── what the page is told ── */
await test('the page sees pageIndicator (settings pass-through) and session.autoStarted (UQA_GET_STATE returns the whole record)', async () => {
  const { publicSettings } = await import('../platform/settings.js');
  assert.equal(publicSettings({ pageIndicator: false, jira: { token: 't' } }).pageIndicator, false);
  const sw0 = workerSrc();
  const get = sw0.slice(sw0.indexOf('UQA_GET_STATE: async'), sw0.indexOf('UQA_POPUP_STATE'));
  assert.match(get, /getSession\(id\),/);
  assert.match(get, /\n\s+session,\n/, 'the record goes out as read, autoStarted included');
});

/* ── wiring in the worker ── */
const sw = workerSrc();
await test('wiring: one navigation listener runs autoWake then autoStart; the alarm runs idleStop; deleting or purging a session forgets', () => {
  assert.match(sw, /remember\.autoWake\(d, autopilot\)\.then\(\(\) => remember\.autoStart\(d, autopilot\)\)/);
  assert.match(sw, /alarm\.name === 'qaw-autoidle'\) return void \(await remember\.idleStop\(/);
  assert.match(sw, /sessionCache\.delete\(sessionId\); remember\.forget\(sessionId\)/);
  assert.equal((sw.match(/onCommitted, 'remember\./g) || []).length, 1, 'no second listener');
});
await test('the charter never comes from the page title', () => {
  const body = fs.readFileSync(path.join(EXT, 'background', 'remember.js'), 'utf8');
  assert.ok(!/\.title/.test(body.slice(body.indexOf('export async function autoStart'), body.indexOf('export async function idleStop'))));
});

/* ── D1: an idle stop never files anything. The real autoSubmitOnStop, lifted out of the worker, behind the real idleStop ── */
function filing({ autoSubmitDefect = true } = {}) {
  const filed = [];
  const autoSubmitOnStop = new Function('getSettings', 'jiraConfig', 'jiraReady', 'quickFileInJira', 'addNote', 'broadcast',
    `async ${lift(sw, 'autoSubmitOnStop')}\nreturn autoSubmitOnStop;`)(
    async () => ({ autoSubmitDefect }), async () => ({ project: 'QAW' }), () => true,
    async (a) => { filed.push(a); return { key: 'QAW-1', url: 'https://x.test/QAW-1' }; }, async () => {}, async () => {});
  return { autoSubmitOnStop, filed };
}
await test('D1: with auto-submit on and Jira ready, a normal stop files, an idle stop does not', async () => {
  const f = filing();
  await f.autoSubmitOnStop({ id: 'S1' });
  assert.equal(f.filed.length, 1, 'a pressed Stop still files (the test has teeth)');
  await f.autoSubmitOnStop({ id: 'S2', stopReason: 'idle' });
  assert.equal(f.filed.length, 1, 'an idle stop files nothing');
});
await test('D1: the real idle sweep -> stop path, auto-submit on, Jira ready: no ticket', async () => {
  const f = filing();
  const store = { S1: { id: 'S1', status: 'recording', autoStarted: true } };
  const r = rig({ started: { S1: Date.now() - 40 * 6e4 } });
  await remember.idleStop({
    lastEventTs: async () => Date.now() - 31 * 6e4,
    getSession: async (id) => store[id],
    putSession: async (s) => { store[s.id] = { ...s }; },
    // what the worker's stopSession does: reads the stored record, marks it stopped, then runs the auto-submit step on it
    stopSession: async (id) => { const s = store[id]; s.status = 'stopped'; await f.autoSubmitOnStop(s); },
  });
  assert.equal(store.S1.stopReason, 'idle');
  assert.equal(f.filed.length, 0, 'nobody pressed Stop, so nothing was filed');
  assert.deepEqual(r.session.autoStarted, {});
});
await test('D1: in the worker, stopSession hands autoSubmitOnStop the stored record (which carries stopReason)', () => {
  const stop = sw.slice(sw.indexOf('async function runStop'), sw.indexOf('async function autoSubmitOnStop'));
  assert.match(stop, /const session = await getSession\(id\);/);
  assert.match(stop, /if \(session\) await autoSubmitOnStop\(session\)/);
  assert.match(sw, /async function autoSubmitOnStop\(session\) \{\n  if \(session\.stopReason === 'idle'\) return null;/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
