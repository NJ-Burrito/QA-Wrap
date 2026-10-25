/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R6 (worker side): the toolbar badge says one thing at a time while a session runs, and the card timer and the
 * header chip read one clock. Plus P1-14: a shortcut either wakes an allowed site or lands one press from success.
 *
 *   node tools/test-recording-indicator.mjs
 *
 * Plain Node. `paintBadge` is lifted from the shipped worker and run against stubs, so the test cannot drift from
 * the code; the page dot is tools/test-page-indicator.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { badgeFor, BADGE_DOT, BADGE } from '../background/action-icon.js';
import * as remember from '../background/remember.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = workerSrc();
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('badge (P1-6)');

await test('badgeFor: low disk first (amber "!"), then the count, then the recording dot, then empty', () => {
  assert.deepEqual(badgeFor({ disk: true, live: true, problems: 3, errors: 1 }), { text: '!', color: '#B7791F' });
  assert.deepEqual(badgeFor({ live: true, problems: 3, errors: 1 }), { text: '3', color: '#B5321F' });
  assert.deepEqual(badgeFor({ live: true, problems: 120, errors: 0 }), { text: '99+', color: '#B7791F' });
  assert.deepEqual(badgeFor({ live: true }), { text: BADGE_DOT, color: '#6B7280' });
  assert.deepEqual(badgeFor({}), { text: '', color: null });
  assert.equal(badgeFor({ live: true, mark: 'T' }).text, 'T', 'the finished mark outranks the dot, not a count');
});

/** The shipped paintBadge, run against a stubbed browser. */
function badgeRig({ id = null, problems = 0, errors = 0, disk = false, done = false, title = '', awake = false } = {}) {
  const start = sw.indexOf('async function paintBadge(hint) {');
  const end = sw.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start, 'paintBadge moved');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const written = { text: null, color: null, title: null };
  const chrome = {
    storage: { session: { get: async () => ({ 'uqa.doneJob': done ? 1 : undefined, 'uqa.diskWarn': disk ? true : undefined }) } },
    action: {
      setBadgeText: async ({ text }) => { written.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { written.color = color; },
      getTitle: async () => title,
      setTitle: async ({ title: t }) => { written.title = t; },
    },
  };
  const names = ['activeSessionId', 'DONE_KEY', 'DISK_WARN', 'chrome', 'tw', 'flushEvents', 'noteChain', 'findingTotals', 'sessionState', 'badgeFor', 'armed'];
  const fn = new AsyncFunction(...names, `${sw.slice(start, end + 2)}\nreturn paintBadge;`);
  return fn(async () => id, 'uqa.doneJob', 'uqa.diskWarn', chrome, async (_k, en) => en, async () => {}, Promise.resolve(),
    () => ({ problems, errors }), { getState: async () => ({ findings: {} }) }, badgeFor, { armedWindows: async () => (awake ? [1] : []) }).then((paint) => ({ paint: () => paint(), written }));
}

await test('a running session with nothing found shows the dot (never empty while it runs)', async () => {
  const r = await badgeRig({ id: 'S1' });
  await r.paint();
  assert.equal(r.written.text, BADGE_DOT);
});
await test('a running session with problems shows their count', async () => {
  const r = await badgeRig({ id: 'S1', problems: 4, errors: 2 });
  await r.paint();
  assert.equal(r.written.text, '4');
  assert.equal(r.written.color, '#B5321F');
});
await test('low disk wins over everything, in amber', async () => {
  const r = await badgeRig({ id: 'S1', problems: 4, errors: 2, disk: true });
  await r.paint();
  assert.equal(r.written.text, '!');
  assert.equal(r.written.color, '#B7791F');
});
await test('Stop clears it: no session, no flag, no text', async () => {
  const r = await badgeRig({ id: null });
  await r.paint();
  assert.equal(r.written.text, '');
  assert.equal(r.written.color, null, 'the colour is left alone when there is nothing to say');
});
await test('awake shows the accent dot, asleep shows nothing, and a session or the disk flag outrank it', async () => {
  let r = await badgeRig({ awake: true });
  await r.paint();
  assert.deepEqual([r.written.text, r.written.color], [BADGE_DOT, BADGE], 'awake and idle: the accent dot');
  r = await badgeRig({ awake: false });
  await r.paint();
  assert.equal(r.written.text, '', 'asleep: empty badge');
  r = await badgeRig({ awake: true, id: 'S1', problems: 2, errors: 0 });
  await r.paint();
  assert.equal(r.written.text, '2', 'recording with problems: the count, not the awake dot');
  r = await badgeRig({ awake: true, id: 'S1', disk: true });
  await r.paint();
  assert.equal(r.written.text, '!', 'low disk still first');
  assert.deepEqual(badgeFor({ awake: true, live: true }), { text: BADGE_DOT, color: '#6B7280' }, 'a running session keeps its own dot');
  assert.match(sw, /'armedWindows' in c\) paintBadge\(\)/, 'wake/sleep no longer repaints the badge');
});
await test('the disk flag is dropped when the clip ends, and the badge repaints', () => {
  assert.match(sw, /if \(!st\.recording\) await stopRecordingIcon\(\);\s*if \(!st\.recording\) await chrome\.storage\.session\.remove\(DISK_WARN\)[^\n]*\n\s*if \(!st\.recording\) paintBadge\(\)/);
  assert.match(sw, /\[DISK_WARN\]: true \}\)[^\n]*\n\s*await paintBadge\(\)/);
  assert.ok(!/setBadgeText\(\{ text: '!' \}\)/.test(sw), 'the "!" is painted in one place');
});

console.log('one clock (P0-4)');

await test('the card timer and the header chip both read state.session.startedAt through the one shipped fmtElapsed', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  assert.match(popup, /\$\('live-time'\)\.textContent = fmtElapsed\(state\.session\.startedAt\)/, 'the card');
  assert.match(popup, /paintChip\(true, state\.session\.startedAt\)/, 'the chip is fed the same record field');
  assert.match(popup, /const timer = \$\('chip-timer'\);\s*if \(timer\) timer\.textContent = fmtElapsed\(startedAt\)/, 'and prints it with the same function');
  assert.ok(!/fmtDuration\(Date\.now\(\) - state\.session\.startedAt\)/.test(popup), 'no second formatter for the card');
  // The worker side: the record carries one startedAt, written once at start, never rewritten.
  assert.equal((sw.match(/\.startedAt = /g) || []).length, 0, 'nothing in the worker rewrites startedAt');
});

await test('the shipped fmtElapsed itself: mm:ss since startedAt, one rounding, run on a real clock', () => {
  const sandbox = { Date: class extends Date {}, Math, Number, String };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'popup', 'next.js'), 'utf8') + '\n;this.f = fmtElapsed;', sandbox);
  const at = (ms) => { sandbox.Date.now = () => ms; return sandbox.f(1_000_000); };
  assert.equal(at(1_000_000), '00:00');
  assert.equal(at(1_105_000), '01:45');
  assert.equal(at(1_105_999), '01:45', 'floors, never rounds up');
  assert.equal(at(1_106_000), '01:46');
  assert.equal(at(1_000_000 - 5000), '00:00', 'a clock behind the record never goes negative');
  assert.equal(at(1_000_000 + 3_725_000), '62:05', 'minutes keep counting past an hour');
});

console.log('shortcuts (P1-14)');

function wakeRig({ armedNow = false, allowed = true, popup = 'ok' } = {}) {
  const calls = { arm: [], popup: 0, permission: 0 };
  globalThis.chrome = {
    action: { openPopup: async () => { calls.popup++; if (popup === 'refuse') throw new Error('no gesture'); } },
    permissions: { request: async () => { calls.permission++; return true; } },
  };
  const deps = {
    armed: { isArmedWindow: async () => armedNow },
    site: { hasSiteAccess: async () => allowed },
    arm: async (m) => { calls.arm.push(m.windowId); },
  };
  return { run: () => remember.wakeForShortcut({ id: 7, windowId: 3, url: 'https://shop.example.com/cart' }, deps), calls };
}
await test('an allowed site wakes its window and says woke', async () => {
  const r = wakeRig();
  assert.equal(await r.run(), 'woke');
  assert.deepEqual(r.calls.arm, [3]);
  assert.equal(r.calls.popup, 0);
});
await test('an awake window says woke and does nothing', async () => {
  const r = wakeRig({ armedNow: true });
  assert.equal(await r.run(), 'woke');
  assert.deepEqual(r.calls.arm, []);
});
await test('a site that is not allowed opens the popup, raises no permission prompt, wakes nothing', async () => {
  const r = wakeRig({ allowed: false });
  assert.equal(await r.run(), 'open-popup');
  assert.equal(r.calls.popup, 1);
  assert.equal(r.calls.permission, 0);
  assert.deepEqual(r.calls.arm, []);
});
await test('when the browser refuses to open the popup the answer is false and the spoken message stays the fallback', async () => {
  const r = wakeRig({ allowed: false, popup: 'refuse' });
  assert.equal(await r.run(), false);
  assert.match(sw, /woke \|\| \(await sayLoudly\(/);
});
await test('the toggle shortcut starts nothing after open-popup, and every other command wakes through the same function', () => {
  assert.match(sw, /if \(!woke \|\| woke === 'open-popup'\) return void/);
  assert.match(sw, /const woke = await remember\.wakeForShortcut\(invokedTab \?\?/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
