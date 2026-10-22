/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The administrator's switch, and the two places it has to hold.
 *
 *   node tools/test-policy.mjs
 *
 * Decision 9 of `research/56-decisions-2026-09-07.md`: a company can take the
 * microphone away from every tester on a managed machine, through
 * `chrome.storage.managed`. The reason is in
 * `research/51d-legal-privacy-licensing.md` §5, and it is not a preference:
 * eleven US states require every party's consent to record a voice, Germany's
 * §201 StGB reaches three years for recording non-public spoken words, and
 * attaching that recording to a ticket is a separate offence there. A control
 * that can be overridden by a tick in a popup is not a control.
 *
 * `tools/test-settings.mjs` proves the *reading* — default true, fails open,
 * never written back, only a literal `false` restricts. This file proves the
 * two things reading it correctly is not enough for:
 *
 *   1. **Chrome must accept the area at all.** `chrome.storage.managed` is
 *      refused outright unless the package ships a schema and the manifest
 *      names it. Without those two lines the policy is unsettable and every
 *      read answers the default for ever — which looks exactly like a working
 *      feature nobody has switched on.
 *   2. **The refusal is in front of every capture path**, not on the popup.
 *      A saved setting, a keyboard shortcut and the right-click recorder all
 *      reach a start without going past a popup.
 *
 * The mic-live indicator is here too, for the same reason: Apple's App Review
 * 2.5.14 asks for a clear indication *while* a record of user activity is
 * being made, and a message at the start is not that.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

/* ── the area exists at all ────────────────────────────────────────────── */

const manifest = JSON.parse(read('manifest.json'));

console.log('policy — the managed area Chrome will actually serve');

test('the manifest names a managed schema', () => {
  assert.equal(manifest.storage?.managed_schema, 'managed-schema.json');
});

test('the schema is in the package', () => {
  assert.ok(fs.existsSync(path.join(EXT, 'managed-schema.json')));
});

test('the schema declares microphoneAllowed as a boolean', () => {
  const schema = JSON.parse(read('managed-schema.json'));
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.microphoneAllowed.type, 'boolean');
});

test('the schema stays inside the subset Chrome will load', () => {
  /*
   * This is not a style rule. `"additionalProperties": false` — ordinary JSON
   * Schema, and the first thing anybody writes to lock a schema down — is
   * outside Chrome's policy-schema reader, which expects a schema *object*
   * there. Chrome does not warn and does not disable the feature: it refuses to
   * load the entire extension, with "Invalid type for attribute
   * 'additionalProperties'", as a modal dialog on every reload. It shipped for
   * seven minutes on 7 September 2026 with every suite green.
   *
   * `tools/manifest-check.mjs` is the full validator and the one that names the
   * subset; this is the same trap, asserted where the schema is read, so the
   * unit suite catches it without launching a browser.
   */
  const schema = JSON.parse(read('managed-schema.json'));
  const walk = (node, where) => {
    if (!node || typeof node !== 'object') return;
    assert.ok(
      !('additionalProperties' in node) || typeof node.additionalProperties === 'object',
      `${where}: additionalProperties must be a schema object, not ${JSON.stringify(node.additionalProperties)}. ` +
        'A boolean stops Chrome loading the extension at all.'
    );
    for (const banned of ['required', '$ref', 'allOf', 'anyOf', 'oneOf', 'definitions']) {
      assert.ok(!(banned in node), `${where}: "${banned}" is outside Chrome's policy-schema subset`);
    }
    for (const [name, child] of Object.entries(node.properties || {})) walk(child, `${where} > ${name}`);
  };
  walk(schema, 'root');
});

test('the schema says what the switch does, in a sentence an administrator reads', () => {
  const schema = JSON.parse(read('managed-schema.json'));
  const help = schema.properties.microphoneAllowed.description;
  assert.match(help, /false/, 'it must say which value restricts');
  assert.match(help, /screen|tab/, 'and which recording is unaffected');
});

/* ── the refusal is in front of every path ─────────────────────────────── */

const media = read('background/media.js');

console.log('\npolicy — the microphone refusal sits where recordings start');

test('media.js reads the policy rather than trusting the settings', () => {
  assert.match(media, /import \{ policy, MIC_BLOCKED \} from '\.\.\/platform\/settings\.js';/);
  assert.match(media, /async function micAllowed\(\)/);
  assert.match(media, /\(await policy\(\)\)\.microphoneAllowed !== false/);
});

test('both capture paths drop the microphone before opening anything', () => {
  // Tab capture and desktop capture are two functions and two starts, and a
  // check in one of them is a hole in the other.
  const guards = media.match(/const blockedMic = mic && !\(await micAllowed\(\)\);\s*\n\s*if \(blockedMic\) mic = false;/g) || [];
  assert.equal(guards.length, 2, 'startRecording and startScreenRecording must both refuse');
});

test('a blocked microphone is said out loud, not silently dropped', () => {
  // The whole failure this guards against is a tester recording a narration
  // that is not there and finding out on playback.
  assert.equal((media.match(/blockedMic \? \[MIC_BLOCKED\] : \[\]/g) || []).length, 2);
});

test('the recording is not refused, only the microphone', () => {
  // A refusal that stops the clip would leave a managed office unable to
  // record at all, which is not what the policy says.
  assert.ok(
    !/if \(blockedMic\) throw/.test(media),
    'the policy removes the microphone; it does not cancel the recording'
  );
});

test('Settings is told, so it cannot offer a grant nothing may use', () => {
  assert.match(media, /microphone: micBlocked \? 'blocked' : microphone/);
  assert.match(media, /micBlockedReason: micBlocked \? MIC_BLOCKED : null/);
});

test('the sentence names who decided and what still works', () => {
  const settings = read('platform/settings.js');
  const line = /export const MIC_BLOCKED =\s*\n\s*'([^']+)' \+\s*\n\s*'([^']+)';/.exec(settings);
  assert.ok(line, 'MIC_BLOCKED must be one exported sentence, so every surface says the same thing');
  const text = line[1] + line[2];
  assert.match(text, /manages this computer/, 'a tester must know this is not a fault');
  assert.match(text, /Everything else about recording still works/);
});

/* ── the user-level default, and the live indicator ────────────────────── */

console.log('\npolicy — off by default, and visible while it is on');

test('the microphone is off in the shipped defaults', () => {
  assert.match(read('platform/settings.js'), /recordMic: false,/);
});

test('the toolbar says MICROPHONE LIVE for as long as one is open', () => {
  const icon = read('background/action-icon.js');
  assert.match(icon, /MICROPHONE LIVE/);
  assert.match(icon, /export async function setMicLive\(live\)/);
  // Set from what was actually captured, never from the tick that was sent: a
  // microphone the browser refused must not light an indicator saying one is
  // live, and one it opened must light it even if the tick was a default.
  const worker = workerSrc();
  assert.equal(
    (worker.match(/startRecordingIcon\(\{ mic: !!started\.sources\?\.mic \}\)/g) || []).length,
    2
  );
});

test('the indicator comes back after the worker is torn down mid-clip', () => {
  // An MV3 worker dies every thirty idle seconds and takes the title with it.
  // The resync at module scope is the only thing that puts it back.
  assert.match(
    workerSrc(),
    /syncRecordingIcon\(!!state\?\.recording, \{ mic: !!state\?\.sources\?\.mic \}\)/
  );
});

test('stopping takes the indicator down', () => {
  assert.match(read('background/action-icon.js'), /export async function stopRecordingIcon\(\) \{\s*\n\s*await setMicLive\(false\);/);
});

/* ── decision 6, which travels with this one ───────────────────────────── */

console.log('\npolicy — "Reset masks on this tab" (decision 6)');

test('the message is routed, and gated like everything that touches a page', async () => {
  const { NEEDS_ARMING } = await import('../background/dispatch-tables.js');
  assert.ok(NEEDS_ARMING.has('UQA_CLEAR_MASKS'));
  assert.match(workerSrc(), /UQA_CLEAR_MASKS: async \(msg, sender\) => \{/);
});

test('it uncovers one tab and leaves the session holding the list', () => {
  // Distinct from UQA_MASK_CLEAR, which empties the list for every tab. Two
  // buttons that both say "reset" and mean different things is the confusion
  // this pair has to avoid.
  const mask = read('content/mask.js');
  assert.match(mask, /if \(msg\?\.type === 'UQA_CLEAR_MASKS'\) \{\s*\n\s*sendResponse\(\{ uncovered: resetThisPage\(\), kept: masks\.length \}\);/);
  assert.match(mask, /if \(msg\?\.type === 'UQA_MASK_CLEAR'\)/, 'the browser-wide clear must still exist');
});

test('it calls the same function the in-page bar calls', () => {
  // Two implementations of "reset" is how the bar and the popup come to mean
  // different things.
  const mask = read('content/mask.js');
  assert.equal((mask.match(/function resetThisPage\(\)/g) || []).length, 1);
});

test('a tab with nothing of ours in it is told so, not reported as reset', () => {
  assert.match(
    workerSrc(),
    /That tab has nothing of ours in it to uncover/
  );
});

/* ── the read that hung the whole product ──────────────────────────────── */

/**
 * `chrome.storage.managed.get` never answers on a clean profile.
 *
 * Measured headed on 8 September 2026: the call is made and the promise never
 * settles. `getSettings()` awaited it inside a `Promise.all`, so `getSettings()`
 * never settled either — and it is the first line of nearly every handler in
 * the worker. `UQA_RECORD_START` and `UQA_RECORD_SCREEN` both ran out their
 * deadline and answered "did not finish within 10s. Reload the extension at
 * chrome://extensions and try again", which is what the tester's report that
 * "the screen recording keeps erroring on starting the record" actually was.
 *
 * `research/12-resume-2026-09-04.md` had already measured 1.8 s here and filed
 * it as "round 2: cache the policy at boot". It was not slow. It was infinite.
 *
 * These four assertions are the ones that would have caught it: a read a person
 * waits on must have a deadline, the answer must be cached where a worker
 * teardown cannot lose it, a timeout must not be cached as though it were an
 * answer, and an administrator's change must still land at once — which is what
 * "never cached" was protecting and what the listener protects better.
 */
console.log('\nthe policy read, which must never be a wait a person can feel');

const settings = read('platform/settings.js');

test('the managed read a person is waiting on has a deadline', () => {
  assert.match(settings, /POLICY_DEADLINE_MS/, 'there is no deadline on the managed area again');
  assert.match(
    settings,
    /Promise\.race\(\[\s*\n\s*readManaged\(\),/,
    'policy() awaits the managed area directly again — that read can never settle'
  );
});

test('the answer is cached where a worker teardown cannot lose it', () => {
  assert.match(settings, /chrome\.storage\.session\?\.set\?\.\(\{ \[POLICY_CACHE\]: fresh \}\)/);
  assert.ok(
    !/^let cachedPolicyValue/m.test(settings),
    'a module variable would be gone by the next worker lifetime, which is seconds'
  );
});

test('a timeout is not cached as though it were an answer', () => {
  const at = settings.indexOf('export async function policy()');
  const body = settings.slice(at, settings.indexOf('export async function warmPolicy', at));
  assert.match(body, /if \(!fresh\) return \{ \.\.\.POLICY_DEFAULTS \};/);
  const cacheAt = body.indexOf('rememberPolicy(fresh)');
  assert.ok(cacheAt > body.indexOf('if (!fresh)'), 'the timeout branch is caching a guess');
});

test('an administrator changing the policy still lands at once', () => {
  assert.match(
    settings,
    /if \(area === 'managed'\) warmPolicy\(\);/,
    'nothing re-reads the policy when Chrome says it changed, so a revocation would wait for a restart'
  );
  assert.match(
    workerSrc(),
    /^watchPolicy\(\);$/m,
    'the worker no longer warms the policy at boot, so the first read pays the deadline every time'
  );
});

const done = Promise.resolve();
await done;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
