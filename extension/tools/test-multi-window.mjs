/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Two windows recording at once, and the window-size runs opened from them.
 *
 *   node tools/test-multi-window.mjs
 *
 * ── the collision this file exists to keep closed (G3) ────────────────────
 *
 * `startSession()` opened with `if (existing) await stopSession()`. One
 * session per extension, so pressing Start in a second browser window silently
 * ended the run going in the first. The report for the first was written, so
 * nothing was destroyed — but nothing said it had happened either, and the
 * tester carried on believing both were recording while half the evidence
 * simply stopped arriving. A collision that looks like success is the worst
 * kind, and it is the one a test has to hold shut.
 *
 * Separate *profiles* were never at risk: a profile is a separate extension
 * instance with its own IndexedDB and its own `chrome.storage`, so there is
 * nothing between them to collide. Windows share one worker, and that is where
 * the work was.
 *
 * ── what is tested here, and what is tested in a browser ──────────────────
 *
 * The two things that can actually go wrong are arithmetic, so they are tested
 * as arithmetic:
 *
 *   · **session state is keyed by session** (`background/session-state.js`),
 *     so window B's rules, tool counts and layout-stress flag cannot land on
 *     window A's record. Run against a fake `chrome.storage.session`.
 *   · **the run fold** (`core/sessions.js viewportRuns`), which is what the
 *     report reads and what `UQA_VIEWPORT_RUNS` answers with.
 *
 * The rest is the worker's wiring, and it is asserted against the source —
 * the same technique `tools/test-handlers.mjs` uses, and for the same reason:
 * the worker imports 36 modules and calls `chrome.*` at load, so Node cannot
 * import it, and a rename that quietly reintroduces the collision would
 * otherwise be caught only by a person opening two windows.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewportRuns } from '../core/sessions.js';
import { lift, endOfBlock } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = workerSrc();

let passed = 0;
const failures = [];
let queue = Promise.resolve();

function test(name, fn) {
  queue = queue.then(() =>
    Promise.resolve()
      .then(fn)
      .then(() => { passed++; console.log(`  ok  ${name}`); })
      .catch((err) => { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); })
  );
}

/* ── session state, keyed by session ───────────────────────────────────── */

function fakeSessionStorage() {
  const store = new Map();
  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => {
          if (key === null || key === undefined) return Object.fromEntries(store);
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((k) => [k, store.get(k)]));
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        remove: async (key) => {
          for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
        },
      },
    },
  };
  return store;
}

console.log('two windows — one session’s state cannot land on another’s');

test('two sessions keep separate rules', async () => {
  const store = fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.resetFor('s_b');
  await st.addRule('s_a', { label: 'fail login', pattern: '/login', action: 'fail', enabled: true });
  await st.addRule('s_b', { label: '500 on submit', pattern: '/submit', action: 'status', enabled: true });

  const a = await st.getRules('s_a');
  const b = await st.getRules('s_b');
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].label, 'fail login');
  assert.equal(b[0].label, '500 on submit');
  // Two keys, not one. This is the whole fix, stated as the shape on disk.
  assert.ok([...store.keys()].includes('sessionState:s_a'));
  assert.ok([...store.keys()].includes('sessionState:s_b'));
});

test('two sessions keep separate tool counts', async () => {
  fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.resetFor('s_b');
  await st.noteUse('s_a', 'shot');
  await st.noteUse('s_a', 'shot');
  await st.noteUse('s_b', 'a11y');
  assert.equal((await st.getUsed('s_a')).shot.count, 2);
  assert.equal((await st.getUsed('s_a')).a11y, undefined);
  assert.equal((await st.getUsed('s_b')).a11y.count, 1);
});

test('clearing one session leaves the other intact', async () => {
  fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.resetFor('s_b');
  await st.setState('s_a', { rtl: true });
  await st.setState('s_b', { rtl: true });
  await st.clearState('s_a');
  assert.equal((await st.getState('s_a')).rtl, false, 'cleared');
  assert.equal((await st.getState('s_b')).rtl, true, 'untouched');
});

test('a rule countdown is spent against its own session', async () => {
  fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.resetFor('s_b');
  await st.addRule('s_a', { id: 'r1', remaining: 2, enabled: true });
  await st.addRule('s_b', { id: 'r1', remaining: 2, enabled: true });
  await st.consumeRule('s_a', 'r1');
  assert.equal((await st.getRules('s_a'))[0].remaining, 1);
  assert.equal((await st.getRules('s_b'))[0].remaining, 2, "window B's budget is not spent by window A's traffic");
});

test('02-4: a forged or oversized rule id leaves the session state byte-identical', async () => {
  fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.addRule('s_a', { id: 'r1', remaining: 2, enabled: true });
  const before = JSON.stringify(await st.getState('s_a'));
  for (const bad of ['forged', 'x'.repeat(65), '', 42, null, undefined, { id: 'r1' }, ['r1'], '__proto__']) {
    assert.equal(await st.consumeRule('s_a', bad), null, `${JSON.stringify(bad)} names no rule`);
  }
  assert.equal(JSON.stringify(await st.getState('s_a')), before, 'no write for an id that is not in state.rules');
  assert.equal((await st.consumeRule('s_a', 'r1')).remaining, 1, 'a real id still counts down');
});

test('knownSessions lists exactly the sessions that have state', async () => {
  fakeSessionStorage();
  const st = await import('../background/session-state.js');
  await st.resetFor('s_a');
  await st.resetFor('s_b');
  await st.clearState('s_a');
  assert.deepEqual(await st.knownSessions(), ['s_b']);
});

/* ── the worker's wiring ───────────────────────────────────────────────── */

console.log('\ntwo windows — the worker keeps them apart');

test('starting in one window does not stop a session in another', () => {
  // The line this replaced was `const existing = await activeSessionId(); if
  // (existing) await stopSession();` — unconditional, and the whole bug.
  assert.ok(
    !/const existing = await activeSessionId\(\);\s*\n\s*if \(existing\) await stopSession\(\);/.test(worker),
    'startSession() stops whatever session is running, whichever window it is in'
  );
  assert.match(worker, /const here = map\[windowId \?\? 'none'\];\s*\n\s*if \(here\) await runStop\(here\);/);
});

test('the active session is a map keyed by window', () => {
  assert.match(worker, /const BY_WINDOW = 'activeSessionsByWindow';/);
  assert.match(worker, /async function sessionsByWindow\(\)/);
  assert.match(worker, /map\[session\.windowId \?\? 'none'\] = session\.id;/);
});

test('a tabId is never mistaken for a windowId', () => {
  // Both are bare numbers, and `windowOf()` reads a bare number as a window.
  // A tabId passed where a window is expected resolves the wrong session in
  // exactly the situation the whole mechanism exists for, so no call site
  // builds a hint by hand.
  assert.match(worker, /function hintFor\(msg, sender\) \{/);
  assert.match(worker, /if \(msg\?\.tabId != null\) return \{ tabId: msg\.tabId \};/);
  const bare = worker.match(/activeSessionId\((?:msg\?\.)?tabId\)/g) || [];
  assert.deepEqual(bare, [], 'a bare tabId is being passed as a window hint');
  const bareUse = worker.match(/noteUse\([^)]*,\s*tabId\)/g) || [];
  assert.deepEqual(bareUse, [], 'a bare tabId is being passed as a window hint to noteUse');
});

test('one session still answers every caller that has no window', () => {
  // The compatibility rule, and the reason 238 existing assertions did not
  // have to learn about windows: with one session live, every hint resolves
  // to it.
  assert.match(worker, /if \(ids\.length === 1\) return ids\[0\];/);
});

test('stopping one session does not tell the other window to stop recording', () => {
  // `broadcast({ recording: false })` is taken straight off the message by
  // content/bridge.js, so a flat false silenced every page in every window.
  assert.match(worker, /recording: \(await liveSessionIds\(\)\)\.length > 0/);
});

test('rules are pushed to one window, not to every armed tab in the browser', () => {
  assert.match(worker, /async function pushRulesToPages\(sessionId, windowId = null\)/);
  assert.match(worker, /chrome\.tabs\.query\(windowId != null \? \{ windowId \} : \{\}\)/);
});

/* ── arming a broken request, in a window that has no run yet ───────────── */

/**
 * The four rule functions, lifted, over stubs for everything they reach for.
 *
 * Per-window sessions made "which session does this rule belong to?" a real
 * question, and the first answer was to refuse: *Start a session first: a
 * broken request belongs to a run, and there is no run to put it in.* True
 * about where the rule is stored, wrong as a thing to say to somebody who has
 * just pressed **break the next request** — and it made the tool unreachable
 * from the popup on a fresh window. `reporterFile()` settled the same argument
 * the other way and this now matches it: arming makes the run, in the window
 * that asked, which is exactly the per-window design rather than a retreat
 * from it. Taking rules off still creates nothing.
 */
const buildRules = new Function(
  'deps',
  `const { activeSessionId, testableTabId, startSession, getSession,
           sessionState, pushRulesToPages, broadcast, appendEvent, chrome } = deps;
   ${/* lift() finds `function NAME(`, so the `async` in front of it is not part
        of what comes back. All four of these are async; it is put back here
        rather than taught to the lifter, which every other caller relies on. */
      ['rulesSession', 'addRule', 'setRules', 'dropRule'].map((n) => `async ${lift(worker, n)}`).join('\n   ')}
   return { rulesSession, addRule, setRules, dropRule };`
);

function rulesWorld({ live = null } = {}) {
  const state = { session: live, rules: [], started: [], events: [], pushed: [] };
  const api = buildRules({
    activeSessionId: async () => state.session?.id ?? null,
    testableTabId: async () => 7,
    startSession: async (spec) => {
      state.started.push(spec);
      state.session = { id: 's_made', windowId: 3 };
      return state.session;
    },
    getSession: async (id) => (state.session?.id === id ? state.session : null),
    sessionState: {
      addRule: async (_id, rule) => { state.rules.push(rule); return state.rules.slice(); },
      replaceRules: async (_id, rules) => { state.rules = [...rules]; return state.rules.slice(); },
      removeRule: async (_id, id) => { state.rules = state.rules.filter((r) => r.id !== id); return state.rules.slice(); },
    },
    pushRulesToPages: async (id, windowId) => { state.pushed.push([id, windowId]); },
    broadcast: async () => {},
    appendEvent: async (e) => { state.events.push(e); },
    chrome: { tabs: { get: async () => ({ id: 7, url: 'https://example.test/', windowId: 3 }) } },
  });
  return { state, api };
}

test('arming a broken request with no run makes the run for the window that asked', async () => {
  const { state, api } = rulesWorld();
  const rules = await api.addRule({ label: 'First', pattern: '/api/', action: 'fail', remaining: 2 });
  assert.equal(state.started.length, 1, 'arming refused instead of starting the run it needs');
  assert.equal(state.started[0].tabId, 7, 'the run was not placed on the tab that asked');
  assert.equal(rules.length, 1);
  assert.equal(state.events.at(-1).kind, 'rule', 'the rule was not logged on the timeline it now belongs to');
  assert.deepEqual(state.pushed.at(-1), ['s_made', 3], 'the rule was not pushed to that window');
});

test('the refusal is gone from the worker, not merely unreachable', () => {
  assert.ok(
    !/Start a session first: a broken request belongs to a run/.test(worker),
    'the popup can still be told to press something else first'
  );
  assert.match(worker, /await rulesSession\(hint, \{ create: true \}\)/);
});

test('taking rules off with nothing running starts nothing, and says nothing is armed', async () => {
  const cleared = rulesWorld();
  assert.deepEqual(await cleared.api.setRules([]), []);
  assert.equal(cleared.state.started.length, 0, 'Clear all started a session in order to empty it');

  const dropped = rulesWorld();
  assert.deepEqual(await dropped.api.dropRule('r1'), []);
  assert.equal(dropped.state.started.length, 0, 'dropping a rule that cannot exist started a session');
});

test('arming inside a running session uses it, and starts nothing', async () => {
  const { state, api } = rulesWorld({ live: { id: 's_live', windowId: 9 } });
  await api.addRule({ label: 'Second', pattern: '/api/b', action: 'status', remaining: 3 });
  assert.equal(state.started.length, 0, 'a window with a run started a second one');
  assert.deepEqual(state.pushed.at(-1), ['s_live', 9], 'the rule went to the wrong window');
});

test('the session number cannot be taken twice', () => {
  // get-then-set across two awaits: two overlapping starts both read 7 and
  // both write 8, and `seq` is what the filing code stamps into the folder
  // name — so two sessions would land in each other's folders.
  assert.match(worker, /let seqChain = Promise\.resolve\(0\);/);
  assert.match(worker, /const run = seqChain\.then\(async \(\) => \{/);
  assert.match(worker, /seqChain = run\.catch\(/);
  // The read and the write still exist — they have to — but there is exactly
  // one of them and it is inside the chain. Two would mean a second caller
  // reading the counter without queueing behind the first, which is the race.
  assert.equal(
    (worker.match(/chrome\.storage\.local\.get\('sessionSeq'\)/g) || []).length,
    1,
    'the session counter is read in more than one place; only nextSessionSeq() may'
  );
  assert.match(worker, /const seq = await nextSessionSeq\(\);/);
});

test('closing a window ends the session that was running in it', () => {
  assert.match(worker, /const map = await sessionsByWindow\(\);\s*\n\s*if \(map\[id\]\) await stopSession\(map\[id\]\)/);
});

/* ── window-size runs (G8) ─────────────────────────────────────────────── */

console.log('\nwindow sizes — the run, per research/55');

const OPENED = {
  kind: 'viewport', phase: 'opened', ts: 1000, runId: 'vr_x_1a',
  windowId: 42, tabId: 77, url: 'https://app.test/apply',
  viewport: { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
  measured: { w: 390, h: 844 },
  inherited: { video: false, mask: true, mic: false, tabAudio: false },
  refused: ['video'],
};

test('an unclosed run folds to one row with no end', () => {
  const [run] = viewportRuns([OPENED]);
  assert.equal(run.runId, 'vr_x_1a');
  assert.equal(run.closedAt, null);
  assert.equal(run.durationMs, null);
  assert.equal(run.viewport.label, 'iPhone 14');
  assert.deepEqual(run.refused, ['video']);
});

test('the two phases fold to one row with a duration', () => {
  const [run] = viewportRuns([
    OPENED,
    { kind: 'viewport', phase: 'closed', ts: 61000, runId: 'vr_x_1a', durationMs: 60000, mediaId: 'm_1', reason: 'closed' },
  ]);
  assert.equal(run.durationMs, 60000);
  assert.equal(run.mediaId, 'm_1');
  assert.equal(run.reason, 'closed');
});

test('runs come back oldest first, and never null', () => {
  const later = { ...OPENED, ts: 5000, runId: 'vr_y_2b' };
  assert.deepEqual(viewportRuns([later, OPENED]).map((r) => r.runId), ['vr_x_1a', 'vr_y_2b']);
  assert.deepEqual(viewportRuns([]), []);
  assert.deepEqual(viewportRuns(), []);
});

test('a close with no open is ignored rather than inventing a run', () => {
  assert.deepEqual(viewportRuns([{ kind: 'viewport', phase: 'closed', ts: 9, runId: 'ghost' }]), []);
});

test('nothing but a viewport event with a runId reaches the fold', () => {
  assert.deepEqual(viewportRuns([{ kind: 'dom', ts: 1 }, { kind: 'viewport', phase: 'opened', ts: 2 }]), []);
});

test('the runId is the shape the contract fixes', () => {
  // §3: opaque to E and F, non-empty, safe in a DOM id and a filename.
  const mint = new Function(`return ${/function newRunId\(\)[\s\S]*?\n\}/.exec(worker)[0]}; `);
  const id = mint()();
  assert.match(id, /^vr_[a-z0-9]+_[a-z0-9]{1,2}$/);
});

test('a run window joins the session, or nothing in it is recorded', () => {
  // The single most important line of the feature: belongsToSession() matched
  // one window id, so every click and request in the new window was thrown
  // away as "other-tab" at the last gate.
  assert.match(worker, /\(session\.windowIds \|\| \[\]\)\.includes\(tab\.windowId\)/);
  assert.match(worker, /const windowIds = \[\.\.\.new Set\(\[\.\.\.\(session\.windowIds \|\| \[\]\), windowId\]\)\];/);
});

test('the reply carries run, and inherit:false carries null', () => {
  /*
   * Rewritten 8 September 2026, for the resize-in-place route.
   *
   * The guarantee is unchanged and is what is asserted: `inherit: false` is a
   * plain window with no run attached. It is now reached one step earlier —
   * the parent session is only looked up when inheritance was asked for, so a
   * plain window cannot take either route's run, and `openViewportRun` answers
   * null without a session. The reply keeps its old fields and gains `exact`
   * and `mode` after them, per §11 of research/55.
   */
  assert.match(worker, /const sessionId = msg\.inherit === false \? null : await activeSessionId\(\{ tabId \}\);/);
  assert.match(worker, /^async function openViewportRun\(\{[\s\S]{0,400}?\n\s*if \(!sessionId\) return null;/m);
  assert.match(worker, /return \{ windowId, viewport: spec, measured, exact, mode: 'resized', run \};/);
  assert.match(worker, /return \{ windowId: created\.id, viewport: spec, measured, exact, mode: 'window', run \};/);
});

test('both phases are appended and both are broadcast', () => {
  assert.match(worker, /kind: 'viewport',\s*\n\s*phase: 'opened',/);
  assert.match(worker, /kind: 'viewport',\s*\n\s*phase: 'closed',/);
  assert.match(worker, /type: 'UQA_VIEWPORT_CHANGED', runId: run\.id, phase: 'opened', sessionId/);
  assert.match(worker, /type: 'UQA_VIEWPORT_CHANGED', runId: r\.runId, phase: 'closed', sessionId/);
});

test('a run open when the session stops is closed with that reason', () => {
  assert.match(worker, /closeViewportRuns\(\{ sessionId: id, reason: 'session-stopped' \}\)/);
});

test('webcam is never inherited, and video is refused while a clip runs', () => {
  assert.match(worker, /if \(clip\.sources\?\.webcam\) refused\.push\('webcam'\);/);
  assert.match(worker, /refused\.push\('video'\);/);
});

test('a clip recorded inside a run is stamped with the run', () => {
  // The route the video refusal names: the tester presses the record shortcut
  // inside the new window, which IS an invocation, so Chrome grants the
  // stream. F's rule is one clip, one home — the stamp is what puts it there.
  assert.match(worker, /restampMedia\(meta\.id, run\)/);
  assert.match(worker, /const run = \{ runId: clipRun\.runId, viewport: clipRun\.viewport \}/);
  assert.match(worker, /\.\.\.\(meta\.runId \? \{ runId: meta\.runId, viewport: meta\.viewport \} : \{\}\)/);
});

/* ── r2-01-2: one time-box alarm per session ───────────────────────────── */

/** The alarm handler, rebuilt from the real source around stubs, and the alarms it would register. */
function alarmKit({ live }) {
  const start = worker.indexOf("on(chrome.alarms?.onAlarm, 'alarms.onAlarm', async (alarm) => {");
  assert.ok(start > 0, 'the alarm handler moved');
  const end = worker.indexOf('\n});\n', start) + 4;
  const log = { notes: [], broadcasts: [], badges: [], cleared: [], purged: 0 };
  let handler;
  new Function('on', 'chrome', 'purgeExpired', 'liveSessionIds', 'appendEvent', 'broadcast', worker.slice(start, end))(
    (_ev, _name, fn) => { handler = fn; },
    { alarms: { clear: async (n) => { log.cleared.push(n); } }, action: { setBadgeBackgroundColor: async () => log.badges.push('bg'), setBadgeText: async ({ text }) => log.badges.push(text) } },
    async () => { log.purged++; },
    async () => live,
    async (e) => { log.notes.push(e); },
    async (m) => { log.broadcasts.push(m); },
  );
  return { fire: (name) => handler({ name }), log };
}

test('r4-09-2: no time-box alarm is created, read from settings or cleared per session', () => {
  // r4-09-2 (D-1010-85): no time-box alarm is created any more, and a stored timeboxEnabled is never read.
  assert.doesNotMatch(worker, /alarms\.create\(`timebox/, 'a time-box alarm is created again');
  assert.doesNotMatch(worker, /timeboxEnabled/, 'the worker reads timeboxEnabled again');
  // A stored timeboxEnabled: true therefore creates nothing: the only alarms the worker creates are the retention sweep and the daily update check ('qaw-update', 2026-10-20).
  const creates = worker.match(/alarms\??\.create\??\.?\(\s*[^,)]+/g) || [];
  assert.ok(creates.length >= 1 && creates.every((c) => c.includes("'retention'") || c.includes("'qaw-update'")), creates.join(' | '));
  assert.doesNotMatch(worker, /alarms\.create\('timebox'/, 'a shared alarm name is back'); // the bare name is only cleared, at startup (carry-timebox-legacy)
});

test('r4-09-2: a leftover time-box alarm writes nothing and is cleared, even for a live session', async () => {
  const k = alarmKit({ live: ['S-one', 'S-two'] });
  await k.fire('timebox:S-one');
  await k.fire('timebox:S-two');
  assert.deepEqual([k.log.notes.length, k.log.badges.length, k.log.broadcasts.length], [0, 0, 0]);
  assert.deepEqual(k.log.cleared, ['timebox:S-one', 'timebox:S-two']);
});

test('r2-01-2: other alarms are not mistaken for a time-box, and retention still purges', async () => {
  const k = alarmKit({ live: ['S-two'] });
  await k.fire('something-else');
  assert.deepEqual([k.log.notes.length, k.log.badges.length, k.log.broadcasts.length], [0, 0, 0]);
  await k.fire('retention');
  assert.equal(k.log.purged, 1, 'the retention alarm still purges');
});

/* ── r2-01-3: stopping one window's session releases only that window's header watch ── */

test('r2-01-3: stop disarms its own window while another session lives, and everything when none does', () => {
  assert.match(worker, /if \(!\(await liveSessionIds\(\)\)\.length\) secHeaders\.disarm\(\);\s*\n\s*else if \(session\) secHeaders\.disarm\(session\.windowId \?\? null\);/);
});

/** Let syncListener() (async: permissions.getAll) settle after an arm/disarm. */
const tick = () => new Promise((r) => setTimeout(r, 0));

function headerStub(origins) {
  const listeners = new Set();
  globalThis.chrome = {
    webRequest: { onHeadersReceived: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    permissions: { getAll: async () => ({ origins }), onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
    storage: { session: { get: async () => ({}), set: async () => {} } },
    tabs: { get: async () => ({}) },
  };
  return listeners;
}

test('r2-01-3: disarm(windowId) leaves the other window watched; the last one drops the listener', async () => {
  const listeners = headerStub(['https://x.test/*']);
  const sh = await import(`../background/security-headers.js?r2-01-3`);
  await sh.restored;
  sh.arm(1); sh.arm(2);
  await tick();
  assert.equal(listeners.size, 1);
  sh.disarm(1);
  await tick();
  assert.ok(sh.isArmed(), 'window 2 is still watched after window 1 stopped');
  assert.equal(listeners.size, 1, 'the listener stays while a window is watched');
  sh.disarm(2);
  await tick();
  assert.ok(!sh.isArmed());
  assert.equal(listeners.size, 0, 'nothing live: the listener is gone');
});

test('r2-01-3: armed but no host origin held (origins: []) registers no listener (D-1010-34)', async () => {
  const listeners = headerStub([]);
  const sh = await import(`../background/security-headers.js?r2-01-3-empty`);
  await sh.restored;
  sh.arm(1); sh.arm(2);
  await tick();
  assert.equal(listeners.size, 0, 'no grant: the listener fails closed');
  sh.disarm(1); sh.disarm(2);
  await tick();
  assert.equal(listeners.size, 0);
});

/* ── r3-09-1: the shortcut and the right-click Start/Stop act on the window they were pressed in ── */

const menus = fs.readFileSync(path.join(EXT, 'background', 'context-menus.js'), 'utf8');
const sessionInSrc = worker.match(/^const sessionIn = .*;$/m)?.[0];
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** The shipped toggle-recording branch, run against stubs: what did it stop, what did it start? */
async function pressShortcut({ live, tab, active = { id: 90, windowId: 1, url: 'https://a.test/' } }) {
  const from = worker.indexOf("if (command === 'toggle-recording') {");
  const to = worker.indexOf("} else if (command === 'pick-element')", from);
  assert.ok(from > 0 && to > from, 'the toggle-recording branch moved');
  const calls = { stopped: [], started: [], toasts: [], loud: [] };
  const run = new AsyncFunction('tab', 'chrome', 'sessionsByWindow', 'activeSessionId', 'stopSession', 'startSession', 'tw', 'notify', 'tabId', 'TESTABLE', 'isInternalUrl', 'sayLoudly', 'armed', 'site', 'remember', 'handlers',
    `${sessionInSrc}\n${worker.slice(from + "if (command === 'toggle-recording') {".length, to)}`);
  await run(tab, { tabs: { query: async () => [active] } }, async () => live,
    async () => Object.values(live)[0] || null, async (id) => { calls.stopped.push(id); }, async (o) => { calls.started.push(o); },
    async (k, en) => en, async (_t, text) => { calls.toasts.push(text); }, 7,
    /^https?:|^file:/, (u) => /^https?:\/\/(chromewebstore\.google\.com)/.test(u), async (_t, text) => { calls.loud.push(text); },
    {}, {}, { wakeForShortcut: async () => true }, {});
  return calls;
}

test('r3-09-1: Alt+Shift+Q in window 2 starts there and leaves window 1\'s session running', async () => {
  const calls = await pressShortcut({ live: { 1: 'S-one' }, tab: { id: 20, windowId: 2, url: 'https://b.test/' } });
  assert.deepEqual(calls.stopped, [], 'window 1 must keep recording');
  assert.equal(calls.started.length, 1);
  assert.equal(calls.started[0].tabId, 20);
  assert.equal(calls.started[0].startUrl, 'https://b.test/');
});

test('r3-09-1: Alt+Shift+Q in the window that is recording stops that window\'s session, and only it', async () => {
  const calls = await pressShortcut({ live: { 1: 'S-one', 2: 'S-two' }, tab: { id: 20, windowId: 2 } });
  assert.deepEqual(calls.stopped, ['S-two']);
  assert.deepEqual(calls.started, []);
});

test('r3-09-1: with no tab handed over the active tab\'s window decides', async () => {
  const calls = await pressShortcut({ live: { 1: 'S-one' }, tab: undefined, active: { id: 5, windowId: 3, url: 'https://c.test/' } });
  assert.deepEqual(calls.stopped, []);
  assert.equal(calls.started[0].tabId, 5);
});

test('r3-09-1: the right-click Start/Stop asks for the clicked window\'s session, not the global one', async () => {
  const from = menus.indexOf("case 'qaw-record': {");
  const to = menus.indexOf("case 'qaw-api':", from);
  assert.ok(from > 0 && to > from);
  const raw = menus.slice(from + "case 'qaw-record': {".length, to);
  const body = raw.slice(0, raw.lastIndexOf('}'));
  assert.ok(!/UQA_GET_STATE|UQA_STOP/.test(body), 'the global state and the global stop are gone from this case');
  const run = (live, tab) => {
    const calls = { stopped: [], started: [] };
    const run = new AsyncFunction('tab', 'tabId', 'info', 'windowSession', 'stopSession', 'handlers', 'notify', 'T', 'refreshMenus', body);
    return run(tab, tab.id, { pageUrl: 'https://x.test/' }, async (w) => live[w] || null, async (id) => { calls.stopped.push(id); },
      { UQA_START: async (o) => { calls.started.push(o); } }, async () => {}, async (_k, en) => en, async () => 'refreshed').then(() => calls);
  };
  return Promise.all([run({ 1: 'S-one' }, { id: 20, windowId: 2 }), run({ 1: 'S-one' }, { id: 10, windowId: 1 })]).then(([other, same]) => {
    assert.deepEqual(other.stopped, []);
    assert.equal(other.started.length, 1);
    assert.equal(other.started[0].tabId, 20);
    assert.deepEqual(same.stopped, ['S-one']);
    assert.deepEqual(same.started, []);
  });
});

test('r3-09-1: the worker hands the menu a window-scoped lookup and the stop it should call', () => {
  assert.match(worker, /windowSession: async \(windowId\) => sessionIn\(await sessionsByWindow\(\), windowId\),\s*stopSession,/);
  assert.match(menus, /installContextMenus\(\{[^}]*windowSession, stopSession \}\)/);
});

test('r4-09-2: the shortcut says what it did and names the charter from the catalogue', () => {
  const start = worker.indexOf("command === 'toggle-recording'");
  const branch = worker.slice(start, worker.indexOf("command === 'pick-element'", start));
  assert.ok(!/charter: 'Quick session'/.test(worker), 'no bare English charter literal');
  assert.match(branch, /tw\('common\.worker\.quickCharter', 'Quick session'\)/);
  assert.match(branch, /common\.worker\.toast\.recStarted/);
  assert.match(branch, /common\.worker\.toast\.recStopped/);
});

test('r5-09-1: a finished session is shown only in its own window, and a dismissed one is not returned', async () => {
  const at = worker.indexOf('UQA_GET_STATE: async (msg, sender) => {');
  const head = worker.slice(at + 'UQA_GET_STATE: '.length, worker.indexOf('// Both counts come from indexes.', at)) + '}';
  const make = (store, rows) => new Function('LAST', 'DISMISSED', 'activeSessionId', 'hintFor', 'windowOf', 'recordingState', 'chrome', 'getSession', `return ${head};`)(
    'lastSessionId', 'dismissedSessionId', async () => null,
    (m) => m?.windowId ?? null, async (h) => (typeof h === 'number' ? h : null), async () => ({ recording: false }),
    { storage: { session: { get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, store[k]])) } } },
    async (id) => rows[id] ?? null,
  );
  const rows = { 'S-one': { id: 'S-one', windowId: 1 } };
  const store = { lastSessionId: 'S-one' };
  const get = make(store, rows);
  assert.equal((await get({ windowId: 1 })).lastSession?.id, 'S-one', 'its own window sees it');
  assert.equal((await get({ windowId: 2 })).lastSession, null, 'window 2 is not shown window 1\'s session');
  assert.equal((await get({})).lastSession?.id, 'S-one', 'no hint, no filter');
  store.dismissedSessionId = 'S-one';
  assert.equal((await get({ windowId: 1 })).lastSession, null, 'a dismissed id is not returned');
  assert.match(worker, /remove\(DISMISSED\)/, 'cleared when the next session stops');
});

test('r5-09-2: the shortcut on chrome:// says so and starts nothing; a normal page still starts', async () => {
  const bad = await pressShortcut({ live: {}, tab: { id: 20, windowId: 2, url: 'chrome://extensions/' } });
  assert.deepEqual(bad.started, [], 'no empty session on a page that cannot be recorded');
  assert.equal(bad.loud.length, 1);
  assert.match(bad.loud[0], /normal web page/);
  const ok = await pressShortcut({ live: {}, tab: { id: 21, windowId: 2, url: 'https://b.test/' } });
  assert.equal(ok.started.length, 1);
  assert.deepEqual(ok.loud, []);
});

test('r5-09-2: the shortcut refuses a page that cannot be recorded before it starts a session', () => {
  const start = worker.indexOf("command === 'toggle-recording'");
  const branch = worker.slice(start, worker.indexOf("command === 'pick-element'", start));
  const refuse = branch.indexOf("popup.err.needsPage");
  const begin = branch.indexOf('await startSession(');
  assert.ok(refuse > 0 && begin > refuse, 'the refusal sits before startSession');
  assert.match(branch, /!TESTABLE\.test\(here\.url\) \|\| isInternalUrl\(here\.url\)/);
  assert.match(branch, /sayLoudly\(/);
});

test('r7-05-2 / r7-06-1: onCompleted asks for the navigated tab\'s session; reconcile skips every live id', () => {
  const at = worker.indexOf("'webNavigation.onCompleted'");
  const handler = worker.slice(at, at + 700);
  assert.match(handler, /activeSessionId\(\{ tabId: details\.tabId \}\)/, 'a second window load is filed under its own session');
  const rec = worker.slice(worker.indexOf('async function reconcileInterrupted'), worker.indexOf('const reconcileOnce'));
  assert.match(rec, /new Set\(await liveSessionIds\(\)\)/);
  assert.doesNotMatch(rec, /activeSessionId\(/, 'reconcile no longer trusts the single active id');
});

test('r8-06-1: deleting a session that runs in ANY window is refused; a finished one is deleted', async () => {
  const at = worker.indexOf('  UQA_DELETE_SESSION: ');
  assert.ok(at > 0);
  const body = worker.slice(worker.indexOf('async', at), endOfBlock(worker, worker.indexOf('{', worker.indexOf('=>', at))) + 1);
  assert.doesNotMatch(body, /activeSessionId\(/, 'the single active id is one of several');
  const gone = [];
  const run = (id) => new Function('liveSessionIds', 'recordingState', 'flushEvents', 'bounded', 'deleteSession', 'forgetSession', 'chrome', 'LAST', 'dataSessionKeys', 'eraseKeys', 'broadcast', `return (${body})`)(
    async () => ['s_win1', 's_win2'], async () => ({ recording: false }), async () => {}, (p) => p, async (x) => { gone.push(x); }, () => {},
    { storage: { session: { get: async () => ({}), remove: async () => {} } } }, 'last', () => [], () => [], async () => {}
  )({ sessionId: id });
  await assert.rejects(() => run('s_win1'), /still running/, 'the first window session, not the one activeSessionId would name');
  await assert.rejects(() => run('s_win2'), /still running/, 'the second window session');
  assert.deepEqual(gone, [], 'nothing was deleted');
  assert.deepEqual(await run('s_old'), { deleted: 's_old' });
  assert.deepEqual(gone, ['s_old']);
});

await queue;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
