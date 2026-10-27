/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The webcam is a track, not pixels.
 *
 *   node tools/test-webcam-track.mjs
 *
 * ── what this exists for ──────────────────────────────────────────────────
 *
 * Until 17 September 2026 a webcam inset was drawn onto the tab canvas and the
 * canvas was recorded, so the tester's face *was* the picture. Nader's verdict
 * on the first attempt to make it movable afterwards: "No — record them
 * separately then merge them in the report, that's how you can move them." He
 * is right, and the lift-and-patch that preceded it could only ever guess.
 *
 * `research/106-webcam-track-and-formats-2026-09-17.md` §1 is the contract, and
 * it is a contract because three separate places read it: the recorder writes
 * the companion, the editor moves it, the report lays it over the picture. So
 * the shape is checked here rather than trusted, and so are the four rules that
 * a companion which is nobody's card depends on:
 *
 *   1. it is never its own card, count or row — one clip shows as one clip;
 *   2. deleting a parent deletes it;
 *   3. the orphan sweep reaches one whose parent is gone, which is the one kind
 *      of recording that would otherwise be permanent by construction: filed
 *      under a live session, so no session purge visits it, and filtered out of
 *      every listing, so nobody can see it to delete it;
 *   4. neither recorder can take the other down — a missing companion is a clip
 *      without a face, not a lost clip.
 *
 * No browser: the two functions that decide all of it are pure and are lifted
 * out of the shipped files by name, so a test cannot pass against a copy of
 * logic that has since diverged. The rest is read off the source, because the
 * properties are one word each and a refactor would not notice losing them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift, liftAll } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

const OFF = read('offscreen/offscreen.js');
const DB = read('core/db.js');
const WORKER = workerSrc();
const HTML = read('offscreen/offscreen.html');

const companionRecord = new Function(`${lift(OFF, 'companionRecord')}\nreturn companionRecord;`)();
const orphansOf = new Function(
  `${liftAll(DB, ['isCompanion', 'orphansOf'])}\nreturn orphansOf;`
)();

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('webcam track — the face is a companion clip, not pixels in the picture');

/* ── the companion record ─────────────────────────────────────────────────── */

const parent = {
  id: 'm_abc', sessionId: 's1', runId: 'r1', label: 'Checkout fails',
  webcam: { position: 'top-left', size: 30 },
  startedAt: 1_000, firstChunkAt: 3_000,
};
const camHandle = {
  id: 'm_abc_cam', type: 'video/mp4;codecs=avc1', ext: 'mp4',
  startedAt: 1_020, firstChunkAt: 3_180, stoppedAt: 61_020,
};

test('the companion record is the shape research/106 §1 fixed', () => {
  const rec = companionRecord(parent, camHandle);
  assert.equal(rec.id, 'm_abc_cam', 'the id is the parent id plus _cam, which is how the pair is found');
  assert.equal(rec.parentId, 'm_abc');
  assert.equal(rec.role, 'webcam', 'role is the one field every reader filters on');
  assert.equal(rec.kind, 'recording');
  assert.equal(rec.sessionId, 's1', 'copied from the parent, never re-derived — that is what keeps it un-orphaned');
  assert.equal(rec.runId, 'r1');
  assert.equal(rec.type, 'video/mp4', 'the container, never the codec string: filing.js names the file from it');
  assert.equal(rec.durationMs, 60_000);
  assert.equal(rec.startedAt, 1_020);
  assert.deepEqual(rec.geometry, { position: 'top-left', size: 30 });
  assert.equal(rec.label, 'Checkout fails: webcam');
});

test('offsetMs is measured between the two encoders, not between the two intentions', () => {
  // The two recorders are started one statement apart, and the encoders do not
  // agree to the millisecond. A face half a second out of step with the voice
  // is worse than no face, so the offset is the difference between the first
  // chunk each one produced.
  assert.equal(companionRecord(parent, camHandle).offsetMs, 180);
});

test('with no chunk from either, the offset falls back to the start times', () => {
  // A clip short enough to hold no complete timeslice still has to play in
  // step. `0` would be a guess dressed as a measurement.
  const rec = companionRecord(
    { ...parent, firstChunkAt: null },
    { ...camHandle, firstChunkAt: null }
  );
  assert.equal(rec.offsetMs, 20);
});

test('a companion carries a ts, or it never ages out and sorts wrong', () => {
  // `listMedia` sorts on `ts` and the retention sweep cuts on it. A row without
  // one sorts to the front of a session it is not at the front of, and is
  // younger than every cutoff for ever.
  assert.equal(companionRecord(parent, camHandle).ts, camHandle.startedAt);
});

test('a parent with no geometry still gets a starting point, not undefined', () => {
  const rec = companionRecord({ ...parent, webcam: null }, camHandle);
  assert.deepEqual(rec.geometry, { position: 'bottom-right', size: 22 });
});

/* ── nobody's card, nobody's count, nobody's row ─────────────────────────── */

test('listMedia leaves companions out unless a caller asks for bytes', () => {
  assert.match(
    DB,
    /export async function listMedia\(sessionId, \{ companions = false \} = \{\}\)/,
    'listMedia no longer filters companions: one recorded clip would show as two cards'
  );
  assert.match(
    DB,
    /if \(companions \|\| !isCompanion\(meta\)\)/,
    'the filter is gone from the cursor, so every listing counts the webcam as a second clip'
  );
  // The two questions that are about bytes rather than about clips must opt in,
  // or the figure the tester is offered to clear is short of the webcam's
  // megabytes.
  assert.equal(
    (WORKER.match(/listMedia\(x\.id, \{ companions: true \}\)/g) || []).length,
    2,
    'the footprint and the erase are no longer counting companion bytes'
  );
});

test('deleting a clip deletes its companion', () => {
  assert.match(
    DB,
    /const ids = \[id, \.\.\.\(await companionIds\(id\)/,
    'deleteMedia() no longer gathers the companions, so a deleted clip leaves its webcam track ' +
      'on disk with nothing able to list, count or reach it'
  );
  assert.match(
    DB,
    /for \(const each of ids\) store\.delete\(each\)/,
    'the delete is back to a single id'
  );
  // And the one route that deletes rows by id rather than through deleteMedia().
  assert.match(
    DB,
    /listMedia\(id, \{ companions: true \}\)/,
    'deleteSession() is filtering companions out of the very list it deletes from'
  );
});

test('the orphan sweep takes a companion whose parent is gone', () => {
  const live = new Set(['s1']);
  const rows = [
    { id: 'm1', sessionId: 's1' },
    { id: 'm1_cam', sessionId: 's1', role: 'webcam', parentId: 'm1' },
    { id: 'm2_cam', sessionId: 's1', role: 'webcam', parentId: 'm2' },
    { id: 'm3', sessionId: 'gone' },
    { id: 'm4', sessionId: null },
  ];
  const ids = orphansOf(rows, live).map((r) => r.id).sort();
  assert.deepEqual(
    ids,
    ['m2_cam', 'm3', 'm4'],
    'either a companion under a live session is now immortal, or a companion with a live parent ' +
      'is being swept out from under the clip that needs it'
  );
});

/* ── the compositor, and the one thing left that needs it ────────────────── */

test('the compositor draws the picture and the cursor, never the camera', () => {
  assert.match(
    OFF,
    /function composite\(\{ feed, fps, cursor = false, hint = null \}\)/,
    'composite() has taken a camera back; a screen capture composited for a webcam is a frame ' +
      'the editor can never move the face out of'
  );
  assert.ok(
    !/ctx\.drawImage\(cam,/.test(lift(OFF, 'composite')),
    'the webcam is being painted into the picture again'
  );
  // rec-resize-1027: every clip now takes the compositor, because it is the one
  // place the frame size is locked (a raw tab track changes size with the tab,
  // and the MP4 keeps the first size only). The cursor is still drawn only for
  // a tab capture. tools/test-recording-frame-lock.mjs holds the lock itself.
  assert.match(
    OFF,
    /mixer = composite\(\{ feed, fps: fps \|\| 15, cursor: drawnCursor, hint \}\)/,
    'the cursor is drawn for something other than a tab capture, or the compositor is optional again'
  );
});

test('the reason a screen capture must not get a second mouse is still written down', () => {
  // `drawnCursor` is deliberately not `cursor`: a screen or window capture
  // already contains the operating system's pointer, and drawing over it gives
  // the clip two mice. Removing the webcam from the compositor must not have
  // taken that reasoning with it.
  assert.match(
    OFF,
    /const drawnCursor = !!cursor && !desktop;/,
    'drawnCursor is gone; a screen capture is about to get a second, drawn mouse'
  );
  assert.match(
    OFF,
    /would give the clip two mice/,
    'the note explaining why a screen capture draws no cursor has been deleted'
  );
});

test('a GIF still composites the face inline, and says why', () => {
  // A GIF is one indexed image stream. There is no second layer and no second
  // stream, so for a GIF the choice is the inset where the tester put it or no
  // face at all.
  assert.ok(
    /ctx\.drawImage\(cam,/.test(lift(OFF, 'startGifCapture')),
    'the GIF path has stopped drawing the webcam, so a GIF with the camera ticked has no face in it'
  );
  assert.match(
    OFF,
    /one indexed image stream/,
    'the comment that explains why the GIF path is different from the video path is gone, which is ' +
      'how somebody "fixes" it next'
  );
});

/* ── two recorders, and neither one owns the other ───────────────────────── */

test('the cam recorder is video only — the audio mix stays on the main clip', () => {
  const body = lift(OFF, 'startCamRecorder');
  assert.match(
    body,
    /new MediaRecorder\(new MediaStream\(\[track\]\)/,
    'the webcam recorder is being handed more than the camera video track'
  );
  assert.ok(
    !/mixAudio|getAudioTracks|audioBitsPerSecond/.test(body),
    'the companion has grown an audio track: the microphone is one source, and two recorders ' +
      'writing it put the narration into the evidence twice, a few milliseconds apart'
  );
  assert.match(
    body,
    /getVideoTracks\(\)\[0\]/,
    'the companion no longer records the camera video track itself'
  );
});

test('a webcam that cannot record does not cost the tester the clip', () => {
  assert.match(
    OFF,
    /refused\.push\(`webcam track \(/,
    'starting the companion is no longer a reported refusal; either it throws into a start that ' +
      'has already opened a screen capture, or it fails silently'
  );
  assert.match(
    OFF,
    /try \{ session\.camRecorder\?\.stop\(\); \} catch \{ \/\* already inactive \*\/ \}/,
    'the companion stop is unguarded in the teardown, so a webcam recorder that throws on the way ' +
      'down skips every release and every write below it'
  );
  assert.match(
    OFF,
    /webcamProblem = String\(err\?\.message \|\| err\)/,
    'a companion that would not assemble is no longer recorded on the parent — the report would ' +
      'promise a face that is not there'
  );
});

test('the companion is filed before the parent, so a card never lacks its reference', () => {
  const at = OFF.indexOf('async function fileClip(');
  assert.ok(at > 0, 'fileClip() is gone');
  const body = OFF.slice(at);
  assert.ok(
    body.indexOf('companionRecord(') < body.indexOf('await assembleMedia({ ...record'),
    'the picture is being written before its companion, which leaves a window — exactly the one ' +
      'in which the report is opened — where a clip does not know where its face is'
  );
  assert.match(
    body,
    /record\.webcamTrackId = webcamTrackId;/,
    'the parent no longer carries webcamTrackId, so every clip reads as one recorded before the ' +
      'webcam had its own track, and the editor will patch a picture that was never baked'
  );
});

test('the pair survives a crash and a late stamp', () => {
  assert.match(
    OFF,
    /webcamTrackId: camRecorder\?\.id \|\| null/,
    'the mediaPending marker no longer names the companion, so a crash files two clips that have ' +
      'forgotten about each other'
  );
  assert.match(
    OFF,
    /putMediaPending\(\{\s*id: camId,\s*parentId: id,\s*role: 'webcam',/,
    'the companion has no pending marker of its own: a document that dies mid-clip leaves its ' +
      'chunks on disk with nothing able to assemble them'
  );
  assert.equal(
    (WORKER.match(/restampCompanion\(meta\.webcamTrackId/g) || []).length,
    3,
    'the companion is not being re-stamped everywhere the parent is — sessionId resolved late, the ' +
      'window-size run, and the session deleted mid-save are three separate putMedia calls on the ' +
      'parent, and a companion that misses one points at a session or a run the parent is not in'
  );
  assert.match(
    WORKER,
    /\.\.\.\(row\.role \? \{ role: row\.role, parentId: row\.parentId \|\| null \} : \{\}\)/,
    'a recovered companion is being filed as a clip of its own: one crashed recording would come ' +
      'back as two cards, the second a mysterious close-up of the tester’s face'
  );
});

test('the offscreen document says what its cam element is now for', () => {
  // The old comment said the webcam is "never recorded as a track of its own".
  assert.ok(
    !/never\s+recorded as a track of its own/.test(HTML),
    'offscreen.html still tells the next reader the opposite of what the recorder now does'
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
