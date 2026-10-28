/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Screen recording: the frame that picks the source is the frame that records.
 *
 * ── the defect these assertions exist for ─────────────────────────────────
 *
 * "The screen recording for windows keeps erroring on starting the record."
 * Every press of Record with the screen scope ended in
 *
 *   AbortError: Error starting tab capture
 *
 * which names a capture nobody asked for and a reason that is not the reason.
 * The feature had never worked, on any platform, and the wrong-API wording is
 * why it survived so long: everybody reading it went looking at `tabCapture`.
 *
 * The cause is a platform rule that no amount of reading the documentation
 * would have given you. A `chrome.desktopCapture` stream id is bound to the
 * **render frame that asked for it**. Measured, headed, on Chrome 141:
 *
 *   picked for the popup tab, opened in the popup tab    → screen:0:0
 *   picked for the popup tab, opened in the options tab  → Error starting tab capture
 *   picked with no targetTab, opened in another own page → Error starting tab capture
 *   picked for a tab, opened in it after a reload        → Error starting tab capture
 *
 * The third contradicts the documentation, which says an id with no `targetTab`
 * "can be used only by the calling extension" — that reads as extension-wide
 * and is not; the registry keys on the process and the frame. So the service
 * worker, which has no frame at all, could never mint an id that the offscreen
 * document was allowed to open. And the offscreen document could not mint one
 * either: `chrome.desktopCapture` is not exposed to it.
 *
 * `getDisplayMedia`, called in the offscreen document, needs no id to travel
 * between frames. That is the fix, and these are the assertions that would have
 * caught the original: not "did it record" — a unit test cannot know that — but
 * "is the picker in the same document as the recorder", which is the one
 * property the platform demands and the old code broke.
 *
 * The end-to-end proof is in `tools/recording.mjs`, which records a real screen
 * clip and checks its bytes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';
import { tabVideo, videoBitrate, CAPTURE_EDGE } from '../core/file-probe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

const MEDIA = read('background/media.js');
const OFF = read('offscreen/offscreen.js');
const WORKER = workerSrc();

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('screen recording — the picker and the recorder are one document');

test('the worker never mints a desktop stream id it cannot open', () => {
  // The regression, exactly: a `chooseDesktopMedia` call anywhere in the
  // worker's half produces an id bound to a frame that is not the recorder's.
  assert.ok(
    !/chooseDesktopMedia\s*\(/.test(MEDIA),
    'background/media.js is picking a desktop source again; the id it gets back can only be ' +
      'opened by the frame that asked, and that is never the offscreen document'
  );
  assert.ok(
    !/chooseDesktopMedia\s*\(/.test(WORKER),
    'the service worker is picking a desktop source; it has no frame, so nothing can open it'
  );
});

test('a screen capture is asked for with getDisplayMedia, in the recording document', () => {
  assert.ok(
    /navigator\.mediaDevices\.getDisplayMedia\(/.test(OFF),
    'offscreen/offscreen.js no longer opens the screen itself'
  );
  const at = OFF.indexOf('async function startRecording(');
  assert.ok(at > -1, 'startRecording is gone from the offscreen document');
  const body = OFF.slice(at, at + 4000);
  assert.match(
    body,
    /desktop\s*\n?\s*\?\s*await displayStream\(/,
    'the desktop branch of startRecording no longer goes through displayStream()'
  );
});

test('the offscreen document is created with the reason that permits it', () => {
  const reasons = /reasons:\s*\[([^\]]*)\]/.exec(MEDIA);
  assert.ok(reasons, 'the offscreen document is created with no reasons at all');
  assert.match(reasons[1], /'DISPLAY_MEDIA'/, 'DISPLAY_MEDIA is what allows getDisplayMedia here');
  assert.match(reasons[1], /'USER_MEDIA'/, 'USER_MEDIA is still needed for the microphone and the camera');
});

test('no streamId is sent for a screen capture, and one still is for a tab', () => {
  const at = MEDIA.indexOf('export async function startScreenRecording(');
  assert.ok(at > -1, 'startScreenRecording is gone');
  const body = MEDIA.slice(at, MEDIA.indexOf('/* ── stills', at));
  assert.match(body, /desktop:\s*true/, 'the offscreen document is not told this is a screen capture');
  assert.ok(
    !/streamId/.test(body),
    'a streamId is being sent for a screen capture again — that is the id that cannot cross frames'
  );

  const tabAt = MEDIA.indexOf('export async function startRecording(');
  const tabBody = MEDIA.slice(tabAt, MEDIA.indexOf('export async function stopRecording', tabAt));
  assert.match(
    tabBody,
    /chrome\.tabCapture\.getMediaStreamId\(/,
    'a tab capture still needs the worker to mint its id — only the worker may'
  );
  assert.match(tabBody, /streamId,/, 'and it still travels to the offscreen document');
});

test('the tab path opens its stream with the tab constraint and nothing else', () => {
  // The two ids are not interchangeable, and the old code chose the constraint
  // from a `desktop` flag that could disagree with where the id came from.
  assert.match(OFF, /chromeMediaSource: 'tab'/, 'the tab capture constraint is gone');
  assert.ok(
    !/chromeMediaSource: 'desktop'/.test(OFF),
    "a 'desktop' constraint is back; a getDisplayMedia stream needs none, and an id that would " +
      'need one cannot reach this document'
  );
});

console.log('\nwhat the tester is told');

// `displayStream` is lifted rather than re-implemented: a refusal branch that
// is copied into a test is a branch the test goes on passing about after the
// shipped one changes.
// `lift` starts at `function <name>(`, so the `async` in front of the
// declaration is left behind and has to be put back or the body will not parse.
const displayStream = new Function(`async ${lift(OFF, 'displayStream')}\nreturn displayStream;`)();

// Node 22 has a real `navigator` and it is read-only, so it is redefined rather
// than assigned to.
const fakeMediaDevices = (err) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getDisplayMedia: async () => { throw err; } } },
  });
};
const said = async () => {
  try {
    await displayStream({ wantsAudio: false, cap: [1280, 720], fps: 15 });
    return null;
  } catch (err) { return err.message; }
};

const results = {};
{
  const err = new Error('Permission denied'); err.name = 'NotAllowedError';
  fakeMediaDevices(err);
  results.cancelled = await said();

  const sys = new Error('Permission denied by system'); sys.name = 'NotAllowedError';
  fakeMediaDevices(sys);
  results.system = await said();

  const other = new Error('Requested device not found'); other.name = 'NotFoundError';
  fakeMediaDevices(other);
  results.other = await said();
}

test('a cancelled picker reads as CANCELLED and reaches the popup as silence', () => {
  assert.equal(results.cancelled, 'CANCELLED');
  // The worker's half of the same fact: CANCELLED is answered, never thrown.
  assert.match(
    WORKER,
    /if \(err\.message === 'CANCELLED'\) return \{ cancelled: true \};/,
    'a cancelled picker would surface as an error with a stack trace'
  );
});

test('an operating system that forbids screen recording says so instead', () => {
  assert.notEqual(results.system, 'CANCELLED', 'a wall the tester cannot pass must not read as their own Cancel');
  assert.match(results.system, /will not let Chrome record the screen/);
  assert.match(results.system, /privacy settings/, 'the message names no next step');
});

test('any other failure travels unchanged rather than being renamed', () => {
  assert.equal(results.other, 'Requested device not found');
});

test('the sound the source could not share is read from the stream, not the request', () => {
  const at = MEDIA.indexOf('export async function startScreenRecording(');
  const body = MEDIA.slice(at, MEDIA.indexOf('/* ── stills', at));
  assert.match(
    body,
    /systemAudio && !started\.sources\?\.tabAudio/,
    'the refusal is being derived from what was asked for again — a window cannot carry sound, ' +
      'and the tester used to find that out on playback'
  );
});

test('the permission the tester grants is still the only gate before the picker', () => {
  const at = MEDIA.indexOf('export async function startScreenRecording(');
  const body = MEDIA.slice(at, MEDIA.indexOf('/* ── stills', at));
  assert.match(body, /permissions\.contains\(\{ permissions: \['desktopCapture'\] \}\)/);
  assert.match(body, /needsPermission: 'desktopCapture'/, 'the refusal no longer opens Settings for them');
});

/*
 * The tester's Cursor tick, on the screen path. 8 September 2026.
 *
 * "Make sure that the cursor doesn't show unless I check it." It could not:
 * the tick reached `startScreenRecording` and was passed to the offscreen
 * document, which then ignored it on this path — a drawn pointer is only ever
 * right for a tab capture, and nobody had noticed that the *real* pointer was
 * therefore in every screen clip whatever the tick said.
 *
 * There is exactly one mechanism that can keep it out, and it is a constraint
 * on the `getDisplayMedia` request: by the time a frame arrives, the operating
 * system's cursor is already in its pixels. So the assertion is on the
 * constraint, which is the only place the behaviour can live.
 */
test('an unticked cursor is never in a screen clip, because the constraint says so', () => {
  const at = OFF.indexOf('async function displayStream(');
  assert.ok(at > -1, 'displayStream() is gone from the offscreen document');
  const body = OFF.slice(at, OFF.indexOf('async function startRecording(', at));
  assert.match(
    body,
    /cursor:\s*cursor\s*\?\s*'always'\s*:\s*'never'/,
    "the getDisplayMedia video constraints no longer carry `cursor`; without it Chrome " +
      "defaults to 'always' and the tick does nothing at all on a screen or window capture"
  );
  assert.match(
    OFF,
    /displayStream\(\{[^}]*cursor:\s*!!cursor/,
    'the tester’s tick is not reaching displayStream(); the constraint would be a constant'
  );
});

test('what the clip claims about its cursor is what the clip contains', () => {
  assert.ok(
    !/cursor:\s*drawnCursor \|\| desktop,/.test(OFF),
    'a screen clip is claiming a cursor again on the strength of being a screen clip; ' +
      'since the constraint is honoured, `desktop` alone is no longer true'
  );
  assert.match(
    OFF,
    /cursor:\s*drawnCursor \|\| \(desktop && !!cursor\)/,
    'the recorded sources no longer say whether the pointer is really in the picture'
  );
});

/* ── rec-quality-1025: native size, no letterbox, a bitrate that fits the frame ── */

test('a tab capture asks for "any size within limit", not a letterboxed fixed box', () => {
  // Max-only gave a 1920x1080 frame with black bars around a 1200x760 tab; a same-shape min box gave a square
  // letterbox. Measured headed on 2026-10-25: min 4x2 against a square max gives the tab's own shape, no bars.
  for (const q of ['low', 'medium', 'high']) {
    const m = tabVideo('id', q, 15).mandatory;
    assert.equal(m.chromeMediaSource, 'tab');
    assert.equal(m.maxWidth, CAPTURE_EDGE[q], `${q}: max width`);
    assert.equal(m.maxHeight, m.maxWidth, `${q}: only the long edge is capped, never a 16:9 box`);
    assert.ok(m.minWidth > 0 && m.minHeight > 0, `${q}: no min box means Chrome letterboxes`);
    assert.notEqual(m.minWidth / m.minHeight, m.maxWidth / m.maxHeight, `${q}: same-shape min and max boxes letterbox to that shape`);
  }
  assert.ok(CAPTURE_EDGE.medium >= 1920, 'medium is at least 1080p-class on the long edge');
  assert.match(OFF, /video: tabVideo\(streamId, quality, fps\)/, 'the tab recorder no longer uses tabVideo()');
  const ROLL = read('offscreen/rolling.js');
  assert.match(ROLL, /tabVideo\(msg\.streamId/, 'Save last 1 minute no longer uses tabVideo()');
  assert.ok(!/maxWidth: 1920, maxHeight: 1080/.test(ROLL), 'the rolling buffer is back on the letterboxing max-only box');
});

test('the encoder bitrate is sized to the captured frame', () => {
  assert.ok(videoBitrate('medium', 1920, 1080) >= 8_000_000, 'medium at 1080p is under 8 Mbps');
  assert.ok(videoBitrate('high', 2560, 1440) > videoBitrate('medium', 2560, 1440), 'high is not above medium');
  assert.ok(videoBitrate('low', 1280, 720) >= 750_000, 'low at 720p starved');
  assert.ok(videoBitrate('medium', 3840, 2160) <= 16_000_000, 'the 2x ceiling is gone');
  assert.equal(videoBitrate('medium', 0, 0), 8_000_000, 'an unknown frame size falls back to the 1080p rate');
  assert.match(OFF, /const vbps = videoBitrate\(quality, sourceTrack\.getSettings/, 'the recorder is back on a flat bitrate');
  assert.match(OFF, /mimeType: mime, videoBitsPerSecond: vbps/, 'the recorder no longer uses the sized bitrate'); // 3.8.4: shared with the WebM understudy
});

test('a double-click on a save button saves once', () => {
  const REPORT = read('report/report.js');
  assert.match(REPORT, /\$\('save-go'\)\.addEventListener\('click', async \(e\) => \{ if \(e\.detail > 1\) return;/, 'Save selected runs twice on a double-click');
  assert.match(REPORT, /\$\('media-save'\)\.addEventListener\('click', async \(e\) => \{ if \(e\.detail > 1\) return;/, 'Save all media runs twice on a double-click');
  assert.match(REPORT, /save\.addEventListener\('click', \(e\) => e\.detail > 1 \|\| saveOne\(item, save\)\)/, 'a clip Save button runs twice on a double-click');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
