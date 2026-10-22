/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unit tests for platform/settings.js — the key-binding and range logic.
 *
 *   node tools/test-settings.mjs
 *
 * Storage-backed functions need chrome.*; a minimal stub stands in for it so the
 * clamping and merge behaviour is covered without a browser.
 */
import assert from 'node:assert/strict';
import { installIdbStub } from './lib-idb-stub.mjs';

installIdbStub(); // the vault keeps its key in IndexedDB

/* A just-enough chrome.storage stub, installed before the module loads. */
const store = {};
const local = {};
const area = (bag) => ({
  get: async (key) => (key === null ? { ...bag } : { [key]: bag[key] }),
  set: async (obj) => Object.assign(bag, obj),
  remove: async (key) => delete bag[key],
});
// Two areas, because settings.js keeps preferences in sync and credentials in
// local; a stub with one bag would hide a credential leaking into sync.
/**
 * The administrator's area, which the tester cannot write to.
 *
 * `chrome.storage.managed` is read-only by contract, so the stub gives it a
 * `get` and nothing else: a test that could write to it would be testing a
 * shape the browser does not offer. Empty by default, which is what an
 * unmanaged machine reports.
 */
const managed = {};
globalThis.chrome = {
  storage: {
    sync: area(store),
    local: area(local),
    managed: {
      get: async (keys) => {
        const wanted = keys === null || keys === undefined ? Object.keys(managed) : [].concat(keys);
        return Object.fromEntries(wanted.filter((k) => k in managed).map((k) => [k, managed[k]]));
      },
    },
  },
};
// Node 22 defines navigator as a getter-only global, so it cannot be assigned.
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
}

const {
  DEFAULTS,
  RANGES,
  ACTIONS,
  getSettings,
  setSettings,
  resetSettings,
  bindingFromEvent,
  matchesBinding,
  formatBinding,
  isUsableBinding,
  conflictsWith,
  resolveRetentionDays,
  policy,
  POLICY_DEFAULTS,
  WEBCAM_POSITIONS,
} = await import('../platform/settings.js');

/** What is actually on disk under the settings key, for the leak assertions. */
const stored = () => store.settings;

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

async function atest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const key = (over = {}) => ({
  ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'KeyS', ...over,
});

console.log('settings.js — bindings');

test('a binding is modifiers plus the physical key code', () => {
  assert.equal(bindingFromEvent(key({ altKey: true })), 'Alt+KeyS');
  assert.equal(bindingFromEvent(key({ ctrlKey: true, shiftKey: true, code: 'KeyE' })), 'Ctrl+Shift+KeyE');
  assert.equal(bindingFromEvent(key({ metaKey: true, code: 'Digit1' })), 'Meta+Digit1');
});

test('a lone modifier is not a binding', () => {
  assert.equal(bindingFromEvent(key({ altKey: true, code: 'AltLeft' })), null);
  assert.equal(bindingFromEvent(key({ shiftKey: true, code: 'ShiftRight' })), null);
  assert.equal(bindingFromEvent(key({ ctrlKey: true, code: 'ControlLeft' })), null);
});

test('codes are used, not key values — an Arabic layout must not break shortcuts', () => {
  // Same physical key, different `key` character on an Arabic layout. Because we
  // read `code`, the binding is identical either way.
  const latin = bindingFromEvent(key({ altKey: true, code: 'KeyS', key: 's' }));
  const arabic = bindingFromEvent(key({ altKey: true, code: 'KeyS', key: 'س' }));
  assert.equal(latin, arabic);
  assert.equal(latin, 'Alt+KeyS');
});

test('matchesBinding compares the whole combination', () => {
  assert.equal(matchesBinding(key({ altKey: true }), 'Alt+KeyS'), true);
  assert.equal(matchesBinding(key({ altKey: true, shiftKey: true }), 'Alt+KeyS'), false);
  assert.equal(matchesBinding(key({ altKey: true }), ''), false);
});

test('a binding without a modifier is rejected — it would fire while typing', () => {
  assert.equal(isUsableBinding('KeyS'), false);
  assert.equal(isUsableBinding('Alt+KeyS'), true);
  assert.equal(isUsableBinding('Ctrl+Shift+KeyS'), true);
  assert.equal(isUsableBinding(''), false);
});

test('formatBinding is readable', () => {
  assert.equal(formatBinding('Alt+KeyS'), 'Alt + S');
  assert.equal(formatBinding('Ctrl+Shift+Digit4'), 'Ctrl + Shift + 4');
  assert.equal(formatBinding(''), 'Not set');
});

test('conflictsWith names every other action holding the binding', () => {
  const keymap = { pick: 'Alt+KeyS', inject: 'Alt+KeyS', rtl: 'Alt+KeyD' };
  assert.deepEqual(conflictsWith(keymap, 'pick', 'Alt+KeyS'), ['inject']);
  assert.deepEqual(conflictsWith(keymap, 'rtl', 'Alt+KeyD'), []);
});

test('every action has a default binding and a label', () => {
  for (const action of Object.keys(ACTIONS)) {
    assert.ok(DEFAULTS.keymap[action], `${action} has no default binding`);
    assert.ok(isUsableBinding(DEFAULTS.keymap[action]), `${action}'s default has no modifier`);
    assert.ok(ACTIONS[action].label, `${action} has no label`);
  }
});

test('no two default bindings collide', () => {
  const values = Object.values(DEFAULTS.keymap);
  assert.equal(new Set(values).size, values.length, 'two actions share a default shortcut');
});

console.log('\nsettings.js — ranges and storage');

test('every range has a default that sits inside it', () => {
  for (const [name, range] of Object.entries(RANGES)) {
    const value = DEFAULTS[name];
    assert.ok(value != null, `${name} has no default`);
    assert.ok(value >= range.min && value <= range.max, `${name} default ${value} is outside its range`);
    assert.equal((value - range.min) % range.step, 0, `${name} default is not on a step boundary`);
  }
});

test('the recording defaults are the ones the tester asked for', () => {
  /*
   * 8 September 2026, both halves of one request.
   *
   * "Make sure that the cursor doesn't show unless I check it and it comes
   * pre-checked" is a default, not a behaviour: the tick has to start on. It
   * used to start off, which is why a tab walkthrough showed fields filling
   * themselves with no pointer to say who was doing it.
   *
   * And the webcam's corner has to be one of the four the two controls offer,
   * or the select that shows it opens on nothing.
   */
  assert.equal(DEFAULTS.recordCursor, true, 'the cursor tick no longer comes pre-checked');
  assert.ok(
    WEBCAM_POSITIONS.includes(DEFAULTS.webcamPosition),
    `the default webcam corner ${DEFAULTS.webcamPosition} is not one of the four offered`
  );
  assert.equal(WEBCAM_POSITIONS.length, 4, 'the corners are the four corners');
  for (const corner of WEBCAM_POSITIONS) {
    assert.match(corner, /^(top|bottom)-(left|right)$/, `${corner} is not a corner the compositor can read`);
  }
});

await atest('settings fall back to defaults when nothing is stored', async () => {
  const s = await getSettings();
  assert.equal(s.timeboxMinutes, DEFAULTS.timeboxMinutes);
  assert.equal(s.timeboxMinutes, null, 'a session must start with no time limit at all');
  assert.deepEqual(s.keymap, DEFAULTS.keymap);
});

await atest('a patch merges rather than replaces', async () => {
  await setSettings({ expandPercent: 45 });
  const s = await getSettings();
  assert.equal(s.expandPercent, 45);
  assert.equal(s.maxTimelineRows, DEFAULTS.maxTimelineRows, 'an untouched setting was lost');
  assert.deepEqual(s.keymap, DEFAULTS.keymap, 'the keymap was lost');
});

await atest('one changed shortcut does not wipe the rest', async () => {
  await setSettings({ keymap: { pick: 'Ctrl+Shift+KeyP' } });
  const s = await getSettings();
  assert.equal(s.keymap.pick, 'Ctrl+Shift+KeyP');
  assert.equal(s.keymap.rtl, DEFAULTS.keymap.rtl, 'another binding was cleared');
});

await atest('out-of-range values are clamped, not stored raw', async () => {
  await setSettings({ maxTimelineRows: 999999, expandPercent: -50 });
  const s = await getSettings();
  assert.equal(s.maxTimelineRows, RANGES.maxTimelineRows.max);
  assert.equal(s.expandPercent, RANGES.expandPercent.min);
});

await atest('a non-numeric value falls back to the default instead of poisoning storage', async () => {
  await setSettings({ causalWindowMs: 'soon' });
  const s = await getSettings();
  assert.equal(s.causalWindowMs, DEFAULTS.causalWindowMs);
});

await atest('reset restores every default', async () => {
  await setSettings({ expandPercent: 50, keymap: { pick: 'Ctrl+KeyZ' } });
  await resetSettings();
  const s = await getSettings();
  // `policy` is read from chrome.storage.managed alongside the settings and is
  // not one of them: it is whoever manages the machine's answer, it is never
  // written back, and reset has nothing to restore it to. See POLICY_DEFAULTS.
  assert.deepEqual(s, { ...DEFAULTS, policy: { ...POLICY_DEFAULTS }, keymap: { ...DEFAULTS.keymap } });
});

console.log('\nsettings.js — the administrator’s microphone switch');

await atest('with no policy at all, the microphone is allowed', async () => {
  // Nearly every machine. A QA tool that disabled half its recorder because a
  // storage area was empty would be broken for everybody to protect a few.
  assert.equal((await policy()).microphoneAllowed, true);
  assert.equal((await getSettings()).policy.microphoneAllowed, true);
});

await atest('a managed false takes the microphone away', async () => {
  managed.microphoneAllowed = false;
  try {
    assert.equal((await policy()).microphoneAllowed, false);
    const s = await getSettings();
    assert.equal(s.policy.microphoneAllowed, false);
    // And the tick reads off, whatever the profile had saved. A surface that
    // showed it on would light a live indicator for a device that cannot open.
    assert.equal(s.recordMic, false);
  } finally {
    delete managed.microphoneAllowed;
  }
});

await atest('a profile that had the mic on cannot override the policy', async () => {
  await setSettings({ recordMic: true });
  assert.equal((await getSettings()).recordMic, true, 'allowed while nothing is managed');
  managed.microphoneAllowed = false;
  try {
    assert.equal((await getSettings()).recordMic, false);
  } finally {
    delete managed.microphoneAllowed;
    await setSettings({ recordMic: false });
  }
});

await atest('anything but a literal false is not a prohibition', async () => {
  // An administrator who typed "false" into a text field, or a key left null,
  // must not silently disable a feature with no reason a tester can see.
  for (const value of ['false', 0, null, 'no']) {
    managed.microphoneAllowed = value;
    assert.equal((await policy()).microphoneAllowed, true, `for ${JSON.stringify(value)}`);
  }
  delete managed.microphoneAllowed;
});

await atest('the policy is never written into the tester’s own record', async () => {
  managed.microphoneAllowed = false;
  try {
    await setSettings({ expandPercent: 30 });
  } finally {
    delete managed.microphoneAllowed;
  }
  // The policy is withdrawn; nothing may be left behind that outlives it.
  assert.equal((await getSettings()).policy.microphoneAllowed, true);
  assert.equal(stored()?.policy, undefined, 'policy was written into the settings record');
});

console.log('\nsettings.js — credentials never reach the synced record');

await atest('a tracker token is written to local, and the synced record never carries it', async () => {
  await setSettings({ trackers: { github: { token: 'ghp_secret', repo: 'a/b' } }, jira: { token: 'jira_secret', baseUrl: 'https://x.atlassian.net' } });
  const synced = JSON.stringify(store);
  assert.ok(!synced.includes('ghp_secret') && !synced.includes('jira_secret'), 'a credential reached chrome.storage.sync');
  assert.ok(!JSON.stringify(local).includes('ghp_secret'), 'the credential sits in chrome.storage.local as plaintext');
  assert.ok(local.qw0 && local.qw0.ct, 'the credential was not written to the vault');
  const back = await getSettings();
  assert.equal(back.trackers.github.token, 'ghp_secret');
  assert.equal(back.jira.baseUrl, 'https://x.atlassian.net');
  await resetSettings();
});

console.log('\nsettings.js — retention is resolved, never inherited');

/* Upgrading to 3.1.0 used to delete every finished session older than thirty
   days on a profile that had never been asked. `retentionDays` is a default in
   DEFAULTS, DEFAULTS is spread under whatever is stored, and a profile from
   before the setting existed has no key of its own — so it read 30, and the
   purge that runs on onStartup and onInstalled both did the rest. */

test('a profile that never chose keeps everything, rather than inheriting 30 days', () => {
  assert.equal(resolveRetentionDays({ expandPercent: 45, soundEnabled: true }), 0);
});

test('a fresh install — no stored record at all — keeps the documented default', () => {
  assert.equal(resolveRetentionDays(undefined), DEFAULTS.retentionDays);
  assert.equal(resolveRetentionDays(null), DEFAULTS.retentionDays);
});

test('an explicit choice is honoured, including the explicit choice of never', () => {
  assert.equal(resolveRetentionDays({ retentionDays: 90 }), 90);
  assert.equal(resolveRetentionDays({ retentionDays: 0 }), 0);
  assert.equal(resolveRetentionDays({ retentionDays: 1 }), 1);
});

test('a stored value that is not a number is not a choice either', () => {
  // Keeping everything is the recoverable way to be wrong; deleting is not.
  assert.equal(resolveRetentionDays({ retentionDays: 'thirty' }), 0);
  assert.equal(resolveRetentionDays({ retentionDays: null }), 0);
});

await atest('an upgraded profile reads as never through getSettings, not as 30', async () => {
  await resetSettings();
  // A record written by a version that had no retention setting at all.
  await chrome.storage.sync.set({ settings: { expandPercent: 45, soundEnabled: true } });
  const s = await getSettings();
  assert.equal(s.retentionDays, 0, 'an update would have deleted this profile history');
  assert.equal(s.expandPercent, 45, 'the rest of the record still merges normally');
  assert.equal(s.retentionNoticeSeen, false, 'Settings has to be able to ask once');
  await resetSettings();
});

await atest('once a window is chosen it survives the next read', async () => {
  await resetSettings();
  await chrome.storage.sync.set({ settings: { expandPercent: 45 } });
  await setSettings({ retentionDays: 14, retentionNoticeSeen: true });
  const s = await getSettings();
  assert.equal(s.retentionDays, 14);
  assert.equal(s.retentionNoticeSeen, true, 'the prompt must not come back');
  await resetSettings();
});

console.log('\nsettings.js: sound defaults');

await atest('sound is on, every click, when nothing is saved; a saved false stays false', async () => {
  await resetSettings();
  let s = await getSettings();
  assert.equal(s.soundEnabled, true, 'default: sound on');
  assert.equal(s.soundScope, 'all', 'default: every click');
  assert.equal(s.soundVolume, 70);
  // An explicit false (the tester turned it off) is never overridden by the new default.
  await chrome.storage.sync.set({ settings: { soundEnabled: false } });
  s = await getSettings();
  assert.equal(s.soundEnabled, false, 'a stored false must stay false');
  await chrome.storage.sync.set({ settings: { soundEnabled: true, soundScope: 'core' } });
  s = await getSettings();
  assert.equal(s.soundScope, 'core', 'a stored scope must stay');
  await resetSettings();
});

console.log('\nsettings.js: two writes at once');

await atest('overlapping patches both survive, because writes are serialised', async () => {
  // The bug this exists to stop: `setSettings()` reads the stored record, merges
  // a patch onto it, and writes the whole thing back. Two started together both
  // read the state from before either, and the second write erased the first
  // one's field. Measured in a real profile first: typing a folder into "Save
  // into" and ticking "Ask where to save each file" in the same moment stored
  // the folder and then lost it.
  //
  // Started without awaiting the first, which is how two surfaces do it.
  await resetSettings();
  const a = setSettings({ downloadFolder: 'Portal QA' });
  const b = setSettings({ saveAs: true });
  const [fromA, fromB] = await Promise.all([a, b]);

  const stored = await getSettings();
  assert.equal(stored.downloadFolder, 'Portal QA', 'the first patch was overwritten by the second');
  assert.equal(stored.saveAs, true, 'the second patch never landed');

  // The reply each caller gets is the merged state, so a page repainting from
  // it cannot put a stale value back on screen.
  assert.equal(fromA.downloadFolder, 'Portal QA');
  assert.equal(fromB.downloadFolder, 'Portal QA', 'the later reply must carry the earlier patch');
  assert.equal(fromB.saveAs, true);
  await resetSettings();
});

await atest('a queue of five patches keeps every one of them', async () => {
  await resetSettings();
  await Promise.all([
    setSettings({ downloadFolder: 'Portal QA' }),
    setSettings({ saveAs: true }),
    setSettings({ clock: '12' }),
    setSettings({ expandPercent: 55 }),
    setSettings({ testerName: 'Nader' }),
  ]);
  const s = await getSettings();
  assert.deepEqual(
    { f: s.downloadFolder, a: s.saveAs, c: s.clock, e: s.expandPercent, n: s.testerName },
    { f: 'Portal QA', a: true, c: '12', e: 55, n: 'Nader' },
  );
  await resetSettings();
});

await atest('nested objects merge across overlapping writes as well', async () => {
  // Two keymap rebinds at once used to lose the first binding.
  await resetSettings();
  await Promise.all([
    setSettings({ keymap: { shot: 'Alt+1' } }),
    setSettings({ keymap: { note: 'Alt+2' } }),
  ]);
  const s = await getSettings();
  assert.equal(s.keymap.shot, 'Alt+1', 'the first binding was dropped');
  assert.equal(s.keymap.note, 'Alt+2');
  await resetSettings();
});


await atest('D-1010-58: only the registry list syncs; name, workspace and folder name stay local; every synced key is on the list', async () => {
  const { SYNCED_SETTINGS } = await import('../core/store-registry.js');
  const LOCAL_ONLY = ['testerName', 'workspace', 'saveFolderName', 'pageIndicator']; // pageIndicator: the recording-dot switch stays on this machine
  const SECRET = ['jira', 'slack', 'trackers', 'webhooks'];
  // the list and DEFAULTS agree both ways: nothing synced is missing from the list, nothing on the list is unknown
  const expected = Object.keys(DEFAULTS).filter((k) => !LOCAL_ONLY.includes(k) && !SECRET.includes(k)).sort();
  assert.deepEqual([...SYNCED_SETTINGS].sort(), expected);
  await resetSettings();
  delete local.settingsLocal; delete store.settings;
  await setSettings({ testerName: 'Nader N', workspace: { name: 'Team A' }, saveFolderName: 'Reports', soundVolume: 55, brandNewKey: 'x' });
  const synced = Object.keys(store.settings);
  assert.ok(synced.length > 0 && synced.every((k) => SYNCED_SETTINGS.includes(k)), `unlisted keys reached sync: ${synced.filter((k) => !SYNCED_SETTINGS.includes(k))}`);
  assert.equal(store.settings.soundVolume, 55);
  assert.deepEqual(Object.keys(local.settingsLocal).sort(), ['brandNewKey', 'pageIndicator', 'saveFolderName', 'testerName', 'workspace']);
  const s = await getSettings();
  assert.equal(s.testerName, 'Nader N'); assert.equal(s.workspace.name, 'Team A'); assert.equal(s.saveFolderName, 'Reports'); assert.equal(s.soundVolume, 55);
  // an older profile: the whole record in sync. It reads fine, then moves once, and the keys leave sync only after the local copy matches.
  delete local.settingsLocal;
  store.settings = { soundVolume: 40, testerName: 'Old Name', workspace: { name: 'Old WS' }, saveFolderName: 'OldFolder' };
  const old = await getSettings();
  assert.equal(old.testerName, 'Old Name', 'reads before it moves');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(local.settingsLocal && { t: local.settingsLocal.testerName, w: local.settingsLocal.workspace.name, f: local.settingsLocal.saveFolderName }, { t: 'Old Name', w: 'Old WS', f: 'OldFolder' });
  for (const k of ['testerName', 'workspace', 'saveFolderName']) assert.ok(!(k in store.settings), `${k} left in sync`);
  assert.equal(store.settings.soundVolume, 40);
  assert.equal((await getSettings()).testerName, 'Old Name');
  // a local copy that does not read back leaves sync as it was
  delete local.settingsLocal;
  store.settings = { soundVolume: 41, testerName: 'Keep Me' };
  const realGet = chrome.storage.local.get;
  chrome.storage.local.get = async (k) => (k === 'settingsLocal' ? {} : realGet(k));
  await setSettings({ soundVolume: 42 });
  chrome.storage.local.get = realGet;
  assert.equal(store.settings.testerName, 'Keep Me', 'sync keeps the name when the local read-back fails');
  await resetSettings();
  delete local.settingsLocal; delete store.settings;
});

for (const [label, message] of [['quota', 'QUOTA_BYTES_PER_ITEM quota exceeded'], ['rate', 'MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded']]) {
  await atest(`r4-06-1 (D-1010-73): a sync ${label} rejection keeps the whole record in storage.local, reports success, and reads back`, async () => {
    await resetSettings();
    delete local.settingsLocal; delete store.settings; delete local.settings;
    await setSettings({ soundVolume: 30 });
    const realSet = chrome.storage.sync.set;
    chrome.storage.sync.set = async () => { throw new Error(message); };
    try { await setSettings({ soundVolume: 66, downloadFolder: 'QA' }); } finally { chrome.storage.sync.set = realSet; }
    assert.equal(local.settings.soundVolume, 66, 'the full record is on this machine under the settings key');
    assert.equal(store.settings.soundVolume, 30, 'sync still holds the old value');
    const s = await getSettings();
    assert.equal(s.soundVolume, 66);
    assert.equal(s.downloadFolder, 'QA');
    await setSettings({ soundVolume: 67 }); // sync recovers: the spill is dropped
    assert.equal(store.settings.soundVolume, 67);
    assert.ok(!('settings' in local), 'the local copy is removed once sync took the write');
    assert.equal((await getSettings()).soundVolume, 67);
    await resetSettings();
    delete local.settingsLocal; delete store.settings;
  });
}

await atest('r4-06-1: maskExtraPattern is clamped to 2000 characters and options.html carries maxlength=2000', async () => {
  await resetSettings();
  await setSettings({ maskExtraPattern: 'a'.repeat(5000) });
  assert.equal((await getSettings()).maskExtraPattern.length, 2000);
  const html = (await import('node:fs')).readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
  assert.match(html, /id="maskExtraPattern" maxlength="2000"/);
  await resetSettings();
  delete local.settingsLocal; delete store.settings;
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
