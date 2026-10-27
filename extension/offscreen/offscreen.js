/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The media worker: screen recording, image transcoding, GIF assembly.
 *
 * Everything here needs a DOM — a MediaRecorder, a `<video>` to pull frames
 * from, a canvas to re-encode through — and an MV3 service worker has none. So
 * this document exists purely to own those, and the worker drives it by message.
 *
 * One design decision worth stating: **the finished Blob is written to
 * IndexedDB from here, not sent back to the worker.** `chrome.runtime`
 * messaging serialises through JSON, so a Blob crossing it arrives as `{}` —
 * silently, with no error. A ten-minute recording is also hundreds of megabytes,
 * which is not something to base64 through a message port. This document shares
 * the extension's origin, so it can open the same database and put the Blob
 * straight in; the worker only ever hears an id.
 */

import {
  putMedia, getMedia, putMediaPart, putMediaPending, mediaParts, assembleMedia, clearMediaParts,
} from '../core/db.js';
import { encodeGifAsync, buildPalette } from '../core/gif.js';
import { IMAGE_TYPES, VIDEO_TYPES, byId } from '../core/file-types.js';
import { probeFormats, videoMime, tabVideo, videoBitrate, CAPTURE_EDGE, lockFrame, fitRect } from '../core/file-probe.js';
import { stampPng, stampDocument, withSha256 } from '../core/provenance-stamp.js';
import { sha256Hex, captureHashes } from '../core/integrity.js';

/** T-066: every stored artifact carries its SHA-256, computed here with crypto.subtle. */
const withHash = async (record) => ({ ...record, sha256: await sha256Hex(record.blob) });
import { encodeWav, decodeFailure, MAX_DECODE_BYTES } from './wav.js';
import { partWriter } from './part-writer.js';

/* ── what this Chrome can actually encode ──────────────────────────────────
   Asked, never assumed. MediaRecorder support for MP4 arrived in Chrome 126 and
   is not present in every Chromium build a tester might be on; offering a format
   the browser will refuse produces a zero-byte file and no explanation. */

const pickMime = (format) => videoMime(format);
let rollMod = null; // offscreen/rolling.js, loaded on first use (cap1022)

/**
 * Which formats this browser can really write, image and video both.
 *
 * The catalogue lives in core/file-types.js; what is asked here is which entries
 * survive contact with this particular build. Offering one that does not is how
 * a tester ends up with a `.avif` that is really a PNG.
 */
export function supportedFormats() {
  const { images, videos } = probeFormats();
  return {
    images,
    videos,
    imageTypes: IMAGE_TYPES.map((t) => ({ ...t, available: !!images[t.id] })),
    videoTypes: VIDEO_TYPES.map((t) => ({ ...t, available: !!videos[t.id], candidates: undefined })),
  };
}

/* ── recording ─────────────────────────────────────────────────────────── */

/**
 * The one truth about "is a clip running", and it is claimed synchronously.
 *
 * It used to be assigned at the very end of `startRecording`, after
 * `getUserMedia`, after the extra sources (which can sit on a permission
 * prompt) and after `camEl.play()` — and cleared at the top of `stopRecording`,
 * before the encoder had flushed and before the blob was stored. Every guard in
 * three processes reads it: `if (active) throw` here, `refuseIfRecording()` in
 * the worker, `UQA_OFF_STATE` for the popup. So there were two multi-second
 * windows per clip in which every surface agreed, wrongly, that nothing was
 * recording — which is how a second press started a second capture, how a
 * second Stop began a brand-new clip, and how the button label went stale.
 *
 * Now the claim is made before the first `await` and released only after the
 * bytes are stored, and it carries the phase it is in so the guards can say
 * something true while a clip is starting or finishing.
 */
let active = null;

/**
 * A clip that was recorded but could not be stored (R11).
 *
 * A failed `putMedia` at stop used to throw with the Blob still in a local, and
 * the local went out of scope with the function — every recorded minute gone
 * because the disk was full for one second. The Blob is parked here instead so
 * `UQA_OFF_RESCUE` can still write it out. It is never sent to the popup: a
 * Blob crossing `chrome.runtime` messaging arrives as `{}`, silently.
 */
let pendingBlob = null;

/**
 * A disk write failed: say so now, while the tester can still act on it.
 * The worker shows it (badge and notification); the clip carries on from RAM,
 * bounded by the cap in `part-writer.js`, and the warning is repeated at Stop.
 */
function warnDisk(err) {
  chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', reason: 'disk-warn', error: String(err?.message || err) }).catch(() => {});
}

/** Put the shared media elements back, so the next clip starts from nothing. */
function releaseElements() {
  for (const id of ['feed', 'cam', 'echo']) {
    const node = document.getElementById(id);
    if (node) node.srcObject = null;
  }
}

/**
 * Ask the browser for the extra sources the tester ticked.
 *
 * Each is requested separately and each failure is reported by name. Asking for
 * mic and webcam in one `getUserMedia` call means a refused microphone also
 * costs you the camera, with one opaque error covering both — and a tester who
 * ticked two boxes and got neither has no idea which one to fix.
 *
 * **The permission is checked before it is asked for.** An offscreen document
 * is never rendered, so Chrome has nowhere to draw a permission bubble in it:
 * `getUserMedia` here does not prompt, it fails — and it failed with
 * `NotAllowedError`, which reads as "you refused" to somebody who was never
 * asked. Querying first is what lets the refusal name the one place that *can*
 * ask, which is the Settings page, because it opens in a tab.
 */
async function permissionState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    // Firefox has no `camera`/`microphone` permission descriptor. Unknown is
    // not "denied" — fall through and let getUserMedia answer.
    return 'unknown';
  }
}

const GRANT_ROUTE =
  'open QA Wrap Settings and press "Allow the microphone and camera": an offscreen ' +
  'recorder cannot show the browser’s permission prompt itself';

/**
 * What the browser says about the microphone and the camera, right now.
 *
 * Read here because this is the only context of ours with
 * `navigator.permissions` and `navigator.mediaDevices` that is not a page the
 * tester has to have open. A service worker has neither.
 */
async function devicePermissions() {
  const [microphone, camera] = await Promise.all([
    permissionState('microphone'),
    permissionState('camera'),
  ]);
  return { microphone, camera };
}

/**
 * The audio of a stored clip, on its own, as a WAV.
 *
 * Asked for because a recording with narration on it is often wanted as
 * narration — a defect described out loud, attached to a ticket, without a
 * hundred megabytes of video around it.
 *
 * Decoded and re-encoded rather than remuxed. Pulling the AAC or Opus track out
 * of the container without re-encoding would be smaller and would need a
 * demuxer this product does not have; `decodeAudioData` is in the platform,
 * gives PCM, and WAV is the one audio container that needs no encoder at all.
 * That is also why it is WAV and not MP3: no browser can write an MP3, and a
 * file named `.mp3` that is not one is the exact failure `file-types.js` exists
 * to prevent.
 *
 * A clip with no audio track is an error and not an empty file, because a
 * zero-length WAV is indistinguishable from a bug when somebody opens it.
 */
async function extractAudio({ id }) {
  const record = await getMedia(id);
  if (!record?.blob) throw new Error('That recording is no longer stored.');

  if (record.blob.size > MAX_DECODE_BYTES) {
    throw new Error(
      `This clip is ${Math.round(record.blob.size / 1024 / 1024)} MB, too large to decode for sound in one piece ` +
        `(limit ${Math.round(MAX_DECODE_BYTES / 1024 / 1024)} MB). Download the video and extract the sound from it instead.`
    );
  }
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await record.blob.arrayBuffer());
  } catch (err) {
    throw decodeFailure(err);
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!decoded.length || !decoded.numberOfChannels) {
    throw new Error('That clip has no sound to export.');
  }

  const wav = encodeWav(decoded);
  return {
    id,
    bytes: wav.size,
    type: 'audio/wav',
    durationMs: Math.round(decoded.duration * 1000),
    channels: decoded.numberOfChannels,
    sampleRate: decoded.sampleRate,
    // The Blob goes back through the worker as an object URL, never as bytes on
    // the message port. See the D2 note in background/service-worker.js.
    url: URL.createObjectURL(wav),
    filename: `${(record.label || 'Recording').replace(/[^\w -]+/g, '')}.wav`,
  };
}

async function extraSources({ mic, webcam }) {
  const out = { micStream: null, camStream: null, refused: [] };

  if (mic) {
    if ((await permissionState('microphone')) === 'denied') {
      out.refused.push(`microphone (not granted: ${GRANT_ROUTE})`);
    } else {
      try {
        out.micStream = await navigator.mediaDevices.getUserMedia({
          // Voice-over narration, not a music recording: the browser's own
          // cleanup is exactly what is wanted here.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        out.refused.push(
          `microphone (${err.name === 'NotAllowedError' ? `not granted: ${GRANT_ROUTE}` : err.message})`
        );
      }
    }
  }

  if (webcam) {
    if ((await permissionState('camera')) === 'denied') {
      out.refused.push(`camera (not granted: ${GRANT_ROUTE})`);
    } else {
      try {
        out.camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
      } catch (err) {
        out.refused.push(
          `camera (${err.name === 'NotAllowedError' ? `not granted: ${GRANT_ROUTE}` : err.message})`
        );
      }
    }
  }

  return out;
}

/**
 * Paint the picture onto a canvas and record that, for the one thing that has
 * to be painted: a drawn cursor.
 *
 * **The webcam is no longer painted here.** It used to be: a MediaRecorder
 * takes exactly one video track, so a picture-in-picture inset looked like
 * something that had to be burned into the frames. The cost of that is that it
 * cannot ever be moved — the tester who put the circle over the thing they were
 * demonstrating had no recourse, because by the time anyone saw the clip the
 * face was pixels. It is recorded as its own companion clip instead (see
 * `startCamRecorder`), and the editor and the report lay it over the picture at
 * playback. `research/106-webcam-track-and-formats-2026-09-17.md` §1 is the
 * contract.
 *
 * So this runs for the cursor and only for the cursor. A GIF still composites
 * inline, for a reason that is not a preference — see `startGifCapture`.
 *
 * **Driven by `setInterval`, not `requestAnimationFrame`.** This document is
 * never rendered — that is the whole point of an offscreen document — and
 * Chrome does not run animation frames for a page it is not painting. The rAF
 * loop therefore produced one frame, or none: a webcam composite was a still
 * picture of whatever the first paint caught, for the whole clip. Measured 46
 * real frames against 1. The GIF path already knew this and used a timer.
 *
 * The stream is created **before** the first paint, and the first paints are
 * skipped until the source reports a size, because `captureStream` on a canvas
 * that has already been drawn at the default 300x150 locks the track to those
 * dimensions.
 */
/* ── the pointer, for a tab capture that has been asked to show it ──────── */

/**
 * The last position the page reported, and nothing else.
 *
 * One object, overwritten. It is deliberately not a trail and deliberately not
 * stored: this is the position for the length of one video frame, and a
 * recording feature that quietly accumulated a log of everywhere the tester
 * moved their mouse would be exactly the kind of collection this product
 * exists not to do. It is dropped when the clip stops.
 *
 * `w`/`h` are the page's own viewport at the moment of the report, so the
 * mapping into video coordinates survives the window being resized mid-clip.
 */
let pointer = null;

/**
 * Draw a cursor at the reported position, in video coordinates.
 *
 * A real arrow, not a dot. A ring reads as a highlight effect and a dot reads
 * as a laser pointer; a person watching a walkthrough needs to see *the mouse*,
 * in the shape their own operating system draws it, or the recording does not
 * look like a recording of somebody using the software.
 *
 * White fill, dark outline, and a soft shadow, because the one thing a drawn
 * cursor must survive is being over a white form field and over a dark header
 * in the same clip.
 *
 * The click ring is the other half of the problem: a click is invisible in a
 * screen recording even when the pointer is drawn, so the moment a button is
 * pressed there is nothing on film that says it was pressed.
 */
function drawPointer(ctx, r) {
  if (!pointer || !pointer.w || !pointer.h) return;
  const x = (pointer.x / pointer.w) * r.w;
  const y = (pointer.y / pointer.h) * r.h;
  // Off the top or the left is a stale report from a page that has scrolled
  // out from under the mouse; off the bottom or the right is the same. Drawing
  // it clamped would put a cursor in a corner nobody's mouse is in.
  if (x < 0 || y < 0 || x > r.w || y > r.h) return;

  // Sized against the picture so the cursor is the same apparent size in a 720p
  // clip and a 1440p one.
  const k = Math.max(1, r.h / 900);

  ctx.save();
  ctx.translate(r.x + x, r.y + y);

  if (pointer.down) {
    ctx.beginPath();
    ctx.arc(0, 0, 18 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(181, 67, 43, 0.28)'; /* literal: Petra at low alpha; an offscreen document has no stylesheet to read a token from */
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = 'rgba(181, 67, 43, 0.9)';
    ctx.stroke();
  }

  // The arrow, in the proportions every desktop draws it: a point at the
  // origin, a tail down-right, and a notch.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17 * k);
  ctx.lineTo(4.2 * k, 13.2 * k);
  ctx.lineTo(7.2 * k, 19.6 * k);
  ctx.lineTo(10.2 * k, 18.2 * k);
  ctx.lineTo(7.3 * k, 11.9 * k);
  ctx.lineTo(12.4 * k, 11.6 * k);
  ctx.closePath();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 3 * k;
  ctx.shadowOffsetY = 1 * k;
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4 * k;
  ctx.strokeStyle = '#1A1A1A';
  ctx.stroke();

  ctx.restore();
}

function composite({ feed, fps, cursor = false }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let timer = null;
  let stopped = false;
  let locked = null;
  let seen = null;
  let ready;
  const settled = new Promise((res) => { ready = res; });

  const draw = () => {
    if (stopped) return;
    // Nothing to draw yet. Painting a 1280x720 grey rectangle here is what put
    // a guessed geometry into the recording before the real one arrived.
    if (!feed.videoWidth) return;
    // Sized ONCE and never again (rec-resize-1027): a canvas that followed the
    // feed handed the encoder a new size whenever the tab changed shape, and
    // the MP4 kept the first size's SPS, so every later frame was undecodable
    // smear. The size is taken once it holds for 3 frames (1 s at most): the
    // first frame of a tab capture can be a passing size. Later shapes are
    // fitted inside, centred. `ready` gates recorder.start().
    if (!locked) {
      const now = Date.now();
      if (!seen || seen.w !== feed.videoWidth || seen.h !== feed.videoHeight) {
        seen = { w: feed.videoWidth, h: feed.videoHeight, n: 0, t0: seen ? seen.t0 : now };
      }
      if (++seen.n < 3 && now - seen.t0 < 1000) return;
      locked = lockFrame(feed.videoWidth, feed.videoHeight);
      canvas.width = locked.w;
      canvas.height = locked.h;
      ready(locked);
    }
    const r = fitRect(feed.videoWidth, feed.videoHeight, locked.w, locked.h);
    if (r.w !== locked.w || r.h !== locked.h) ctx.fillRect(0, 0, locked.w, locked.h);
    ctx.drawImage(feed, r.x, r.y, r.w, r.h);

    // The picture, and then the pointer over it. Nothing else is drawn: the
    // webcam is its own clip now, laid over this one at playback.
    if (cursor) drawPointer(ctx, r);
  };

  const stream = canvas.captureStream(fps);
  timer = setInterval(draw, Math.max(1, Math.round(1000 / (fps || 15))));

  return {
    stream,
    ready: settled,
    stop: () => {
      stopped = true;
      ready(null);
      clearInterval(timer);
      // End the track, not just the paint loop. A stopped timer leaves the
      // canvas track live and showing whatever frame it stopped on, so a
      // composite recording whose source went away kept encoding a frozen
      // picture instead of finishing. Ending it lets MediaRecorder see that its
      // last track is gone, which is what stops the clip.
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/**
 * The extension of the container that actually won, never of the one asked for.
 *
 * With MP4 the default, a Chrome older than 126 falls back to WebM — and naming
 * that file `.mp4` would produce a clip that opens in nothing, which is a worse
 * bug than the one the default was changed to fix. So the MIME string decides,
 * and the requested format is only the tie-breaker when the catalogue has never
 * heard of what came back.
 */
function extForMime(mime, format) {
  const container = String(mime || '').split(';')[0].trim().toLowerCase();
  return (
    VIDEO_TYPES.find((t) => (t.candidates || []).some((c) => c.split(';')[0] === container))?.ext
    || byId(VIDEO_TYPES, format)?.ext
    || 'webm'
  );
}

/**
 * The companion record, in the one shape every reader agrees on.
 *
 * Pure, and pure on purpose: `tools/test-webcam-track.mjs` lifts this function
 * out of the file and checks the shape, because the shape is a contract between
 * the recorder, the editor and the report and three places cannot each hold
 * their own idea of it. It is written down in
 * `research/106-webcam-track-and-formats-2026-09-17.md` §1.
 *
 * `role: 'webcam'` is the one field every reader filters on. `sessionId` and
 * `runId` are copied from the parent rather than re-derived, so a companion is
 * never orphaned by a stamp landing on one row and not the other. `offsetMs` is
 * the cam's first chunk minus the clip's first chunk: the two recorders are
 * started one statement apart but the encoders do not agree to the millisecond,
 * and a face half a second out of step with the voice is worse than no face.
 *
 * `geometry` is what the tester ticked. It is a starting point and not a truth —
 * the whole reason for the second track is that the inset can be moved after
 * the fact — so nothing downstream may treat it as where the face *is*.
 */
function companionRecord(parent, cam) {
  const offsetMs =
    cam.firstChunkAt && parent.firstChunkAt
      ? Math.round(cam.firstChunkAt - parent.firstChunkAt)
      : Math.round((cam.startedAt || 0) - (parent.startedAt || 0));
  return {
    id: `${parent.id}_cam`,
    parentId: parent.id,
    role: 'webcam',
    kind: 'recording',
    sessionId: parent.sessionId,
    ...(parent.runId ? { runId: parent.runId } : {}),
    type: String(cam.type || 'video/webm').split(';')[0],
    ext: cam.ext || 'webm',
    durationMs: Math.max(0, (cam.stoppedAt || cam.startedAt || 0) - (cam.startedAt || 0)),
    startedAt: cam.startedAt,
    // The gallery and the retention sweep sort and cut on `ts`, so a companion
    // that lacks one sorts to the front of a session it does not belong at the
    // front of, and never ages out.
    ts: cam.startedAt,
    offsetMs,
    geometry: {
      position: parent.webcam?.position || 'bottom-right',
      size: parent.webcam?.size ?? 22,
    },
    label: `${parent.label || 'Screen recording'}: webcam`,
  };
}

/**
 * The webcam, recorded as its own clip beside the picture.
 *
 * Video only. The audio mix stays on the main clip and is not touched here: the
 * microphone is one source, and two recorders writing it would put the
 * narration into the evidence twice, a few milliseconds apart, which beats
 * audibly the moment both are played.
 *
 * Its chunks go to `mediaParts` under `${id}_cam` by exactly the path the main
 * clip's take, and it gets its own `mediaPending` marker, so a document that
 * dies mid-clip leaves a recoverable companion rather than bytes nobody can
 * reach — the same promise v4 of the database made for the picture.
 *
 * **It is allowed to fail alone.** Every failure below is reported and none of
 * them throws into the caller: a missing cam companion is a clip without a
 * face, not a lost clip, and the tester who has just recorded four minutes of a
 * defect must not lose them because a camera track ended early.
 */
function startCamRecorder({ id, sessionId, camStream, quality, label, geometry, startedAt }) {
  const track = camStream.getVideoTracks()[0];
  if (!track) throw new Error('the camera stream carries no video track');
  const mime = pickMime('mp4') || pickMime('webm');
  if (!mime) throw new Error('this browser has no encoder that could write it');

  const camId = `${id}_cam`;
  const ext = extForMime(mime, 'mp4');
  const recorder = new MediaRecorder(new MediaStream([track]), {
    mimeType: mime,
    /*
     * A 480p face, not a second screen capture.
     *
     * The inset is a fraction of the frame however it is placed, so paying the
     * picture's bitrate for it would roughly double what a clip with the webcam
     * on costs on disk and add no detail anybody can see. It still follows the
     * tester's quality choice, because "low" is chosen by people recording on a
     * laptop with no room left.
     */
    videoBitsPerSecond: { low: 300_000, medium: 700_000, high: 1_200_000 }[quality] ?? 700_000,
  });

  let seq = 0;
  let firstChunkAt = null;
  let failed = null;
  let stoppedAt = null;
  const parts = partWriter({ put: (at, blob) => putMediaPart(camId, at, blob), onFail: warnDisk });

  recorder.ondataavailable = (e) => {
    if (!e.data?.size) return;
    firstChunkAt ??= Date.now();
    parts.add(e.data, seq++);
  };

  let settle = () => {};
  const done = new Promise((resolve) => {
    let settled = false;
    settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });
  recorder.onstop = () => settle({ ok: true });
  recorder.onerror = (e) => {
    failed = String(e?.error?.message || e?.error || 'The webcam recorder stopped with an error.');
    stoppedAt ??= Date.now();
    // Nothing is broadcast. The worker's `UQA_SOURCE_ENDED` stops the whole
    // clip, and a dead camera is not a reason to end a recording of the defect.
    settle({ ok: false, error: failed });
  };
  // The same timeslice as the picture, so the two are chunked on the same
  // rhythm and `offsetMs` is a real measurement rather than an artefact of one
  // encoder flushing on a different schedule from the other.
  recorder.start(2000);

  putMediaPending({
    id: camId,
    parentId: id,
    role: 'webcam',
    sessionId,
    startedAt,
    label: `${label || 'Screen recording'}: webcam`,
    type: mime.split(';')[0],
    ext,
    sources: { webcam: true },
    webcam: geometry,
  }).catch(() => {
    /* No marker is a companion that cannot be recovered from a crash, not one
       that cannot be recorded. */
  });

  return {
    id: camId,
    type: mime.split(';')[0],
    ext,
    startedAt,
    get firstChunkAt() { return firstChunkAt; },
    get stoppedAt() { return stoppedAt; },
    get failed() { return failed; },
    partsProblem: () => parts.error,
    flushed: () => parts.chain,
    tailChunks: () => parts.chunks,
    stop: () => {
      stoppedAt ??= Date.now();
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { settle({ ok: false, error: 'already inactive' }); }
      } else settle({ ok: true });
      return done;
    },
  };
}

/**
 * One audio track for the recorder, from however many sources there are.
 *
 * MediaRecorder records the *first* audio track of the stream it is given and
 * silently drops the rest, so handing it both the tab's sound and the
 * microphone produced a clip with one of them — usually the tab's, because it
 * was pushed first — and a narrator who could not hear themselves back.
 *
 * The mix is never connected to `audioCtx.destination`. Playing the microphone
 * out of the speakers next to that microphone is a feedback loop, and the
 * destination adds nothing: `createMediaStreamDestination` is what the recorder
 * reads from.
 */
function mixAudio(tracks) {
  if (!tracks.length) return { track: null, ctx: null };
  if (tracks.length === 1) return { track: tracks[0], ctx: null };

  const ctx = new AudioContext();
  const out = ctx.createMediaStreamDestination();
  for (const track of tracks) {
    ctx.createMediaStreamSource(new MediaStream([track])).connect(out);
  }
  return { track: out.stream.getAudioTracks()[0], ctx };
}

/**
 * Chrome's own source picker, asked for **here**, in the document that will
 * open the stream.
 *
 * ── the defect this exists for ────────────────────────────────────────────
 *
 * Screen recording had never once worked. Every press ended in
 * `AbortError: Error starting tab capture`, which names a capture nobody asked
 * for and a reason that is not the reason.
 *
 * A `desktopCapture` stream id is bound to the **render frame that asked for
 * it**, and to nothing else. Measured, on Chrome 141, three ways:
 *
 *   picked for the popup tab, opened in the popup tab      → screen:0:0
 *   picked for the popup tab, opened in the options tab    → Error starting tab capture
 *   picked in a page with no targetTab, opened elsewhere   → Error starting tab capture
 *
 * The last one matters most, because the documentation says otherwise: "if not
 * specified then the resulting stream can be used only by the calling
 * extension" reads as extension-wide and is not — the registry keys on
 * `render_process_id` and `render_frame_id`. Same origin is not enough. The
 * same tab after a reload is not enough.
 *
 * So the worker could never hand a usable id to this document: whichever tab it
 * gave the picker, this document was a different frame. The one arrangement
 * that works is the one below — the frame that picks is the frame that
 * records — and an offscreen document is allowed to call the picker, with no
 * `targetTab`, because it is an extension context with no tab of its own.
 *
 * Returns `{ streamId, options }`, or `{ cancelled: true }` when the tester
 * closed the picker, which is a decision and not a fault.
 */
/**
 * The screen, a window, or another tab — asked for **here**, in the document
 * that will record it.
 *
 * ── the defect this replaced ──────────────────────────────────────────────
 *
 * Screen recording had never once worked, on any platform. Every press ended in
 *
 *   AbortError: Error starting tab capture
 *
 * which names a capture nobody asked for and a reason that is not the reason.
 *
 * A `chrome.desktopCapture` stream id is bound to the **render frame that asked
 * for it**. Not to the extension, not to the origin, not to the same tab after
 * a reload — to the frame. Measured three ways on Chrome 141:
 *
 *   picked for the popup tab, opened in the popup tab       → screen:0:0
 *   picked for the popup tab, opened in the options tab     → Error starting tab capture
 *   picked with no targetTab, opened in another own page    → Error starting tab capture
 *
 * The last one is the one the documentation contradicts: "if not specified then
 * the resulting stream can be used only by the calling extension" reads as
 * extension-wide and is not.
 *
 * The worker has no frame of its own, so whichever tab it named, this document
 * was a different frame and Chrome refused. And this document cannot call the
 * picker either: `chrome.desktopCapture` is simply not exposed to an offscreen
 * document — `chrome.desktopCapture?.chooseDesktopMedia` is `undefined` here.
 *
 * `getDisplayMedia` is the way out, and it is the modern one. It shows Chrome's
 * own picker — screen, window or tab, with the sound checkbox where the source
 * allows it — it hands back the stream rather than a token that has to survive
 * a journey between frames, and it works from an offscreen document created
 * with the `DISPLAY_MEDIA` reason without a user gesture. Verified both ways:
 * with `--auto-select-desktop-capture-source` it returns `screen:0:0`; without
 * it, the real picker opens and waits for the tester.
 *
 * Nothing chooses a source on the tester's behalf. It cannot, and it does not
 * try — Chrome's picker is always shown, which is the point of the API.
 */
async function displayStream({ wantsAudio, cap, fps, cursor = true }) {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      audio: !!wantsAudio,
      video: {
        width: { max: cap[0] },
        height: { max: cap[1] },
        frameRate: { max: fps || 15 },
        /*
         * The one place a screen recording's pointer is decided.
         *
         * `cursor` is a `getDisplayMedia`-only video constraint and it is not a
         * hint: Chrome composites the operating system's cursor into the frames
         * it hands over, and `'never'` is the only way to keep it out of them.
         * Nothing downstream can undo it — by the time a frame reaches the
         * canvas the pointer is already painted into the pixels.
         *
         * This used to be absent, which is `'always'` by default, so the
         * tester's "Cursor" tick did nothing at all on a screen or window
         * capture and every clip had a mouse in it.
         */
        cursor: cursor ? 'always' : 'never',
      },
    });
  } catch (err) {
    /*
     * Closing the picker is a decision, not a fault.
     *
     * Chrome raises `NotAllowedError` for both "the tester pressed Cancel" and
     * "the operating system will not allow screen recording at all" — macOS
     * Screen Recording in Privacy & Security is the second one, and it says
     * "by system". They must not read the same: one deserves silence, the other
     * is a wall the tester has to be told about.
     */
    if (err?.name === 'NotAllowedError' && !/system/i.test(err.message || '')) {
      throw new Error('CANCELLED');
    }
    if (err?.name === 'NotAllowedError') {
      throw new Error(
        'This computer will not let Chrome record the screen. Allow screen recording for ' +
          'Chrome in the operating system’s privacy settings, then press Record again.'
      );
    }
    throw err;
  }
}

async function startRecording({
  streamId, sessionId, format, fps, quality, mic, tabAudio, webcam, webcamPosition, webcamSize,
  desktop = false, systemAudio = false, cursor = false, label,
}) {
  if (active) throw new Error('Already recording. Stop the current clip first.');

  /*
   * The claim, before the first await.
   *
   * Everything below this line yields — `getUserMedia`, the extra sources, the
   * camera element's `play()` — and every yield used to be a window in which a
   * second Record press found `active === null` and started a whole second
   * capture on top of the first. Claiming here closes them: from this
   * statement on, `UQA_OFF_STATE` answers `recording: true` and both this
   * function and `stopRecording` refuse.
   */
  const startedAt = Date.now();
  const id = `m_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const claim = { kind: 'starting', id, sessionId, startedAt, stoppedAt: null, mime: null, sources: { tab: !desktop, screen: desktop } };
  active = claim;

  // Declared out here so the catch below can reach them. A throw between
  // opening a capture stream and owning it used to orphan every track it had
  // already opened — a camera light left on for the rest of the browser
  // session, with no surface anywhere that could turn it off.
  let stream = null;
  let micStream = null;
  let camStream = null;
  let mixer = null;
  let camEl = null;
  let camRecorder = null;
  let audioCtx = null;

  const abort = () => {
    try { mixer?.stop(); } catch { /* already gone */ }
    // The companion first: a second recorder left running on a camera track
    // this function is about to stop keeps the camera light on and goes on
    // writing parts for a clip that no longer exists.
    try { camRecorder?.stop(); } catch { /* already gone */ }
    if (camRecorder) clearMediaParts(camRecorder.id).catch(() => {});
    for (const s of [stream, micStream, camStream]) {
      try { s?.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
    }
    try { audioCtx?.close(); } catch { /* already closed */ }
    releaseElements();
    if (active === claim || active?.id === id) active = null;
    pointer = null;
  };

  try {
    // Two sources, two ways of opening them, one code path from here down.
    //
    // A **tab** capture is a one-shot `streamId` minted by the worker, which is
    // the only thing `chrome.tabCapture` hands out, and it is opened with the
    // `chromeMediaSource: 'tab'` constraint.
    //
    // A **screen** capture is `getDisplayMedia`, asked for here. It used to be
    // a `chrome.desktopCapture` id minted by the worker and opened here with
    // the desktop media-source constraint, and that could never work: such an
    // id is bound to the frame that asked for it, and the frame that asked was
    // never this one. See `displayStream` above for the measurements.
    const wantsAudio = desktop ? systemAudio : tabAudio;

    const edge = CAPTURE_EDGE[quality] || CAPTURE_EDGE.medium;
    const cap = [edge, edge];
    stream = desktop
      ? await displayStream({ wantsAudio, cap, fps, cursor: !!cursor })
      : await navigator.mediaDevices.getUserMedia({
          // Tab audio comes through the same constraint object as the video.
          // Asking for it and then not playing it back would mute the tab for
          // the tester, so the stream is echoed to an audio element below.
          audio: wantsAudio
            ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
            : false,
          video: tabVideo(streamId, quality, fps),
        });

    /*
     * What was actually captured, not what was asked for.
     *
     * This used to be `tabAudio = wantsAudio` — the request, recorded as though
     * it were the result. Two consequences, and the second is the loud one.
     * A desktop picker that refuses the audio checkbox still returns a stream,
     * so `sources.tabAudio` claimed sound the clip does not contain. And the
     * echo element below was gated on the same flag, so a *screen* recording
     * with system audio was played back out of the speakers while it was being
     * captured — a feedback loop that howls. Only a tab capture is muted by
     * Chrome while it is being captured, so only a tab capture needs the echo.
     */
    const gotAudio = !!wantsAudio && stream.getAudioTracks().length > 0;

    // The preview element is a decode-and-paint of every frame, at full size.
    // It is only needed when frames are drawn from it — a webcam composite or a
    // GIF — so it is attached lazily, below, and never for a plain recording.
    const feed = document.getElementById('feed');
    const attachFeed = async () => {
      if (feed.srcObject !== stream) {
        feed.srcObject = stream;
        await feed.play().catch(() => {});
      }
    };

    // Capturing a tab's audio silences it for the person watching unless it is
    // played back. This is the line that stops "recording muted my video call"
    // — and it is deliberately not run for a desktop capture, which is not
    // muted and would echo.
    if (gotAudio && !desktop) {
      const echo = document.getElementById('echo');
      echo.srcObject = stream;
      echo.play().catch(() => {});
    }

    const { micStream: gotMic, camStream: gotCam, refused } = await extraSources({ mic, webcam });
    micStream = gotMic;
    camStream = gotCam;

    /*
     * The `<video>` for the camera, only where something draws from it.
     *
     * That is now the GIF path alone. A video clip records the camera track
     * itself, and an element playing it would be a full-rate decode of a frame
     * nobody paints — on the one thread this document has, next to an encoder.
     */
    if (camStream && format === 'gif') {
      camEl = document.getElementById('cam');
      camEl.srcObject = camStream;
      await camEl.play().catch(() => {});
    }

    /*
     * The watchdog on the SOURCE track, and above the GIF branch.
     *
     * Chrome puts its own "Stop sharing" bar on a desktop capture, and pressing
     * it ends the track without going anywhere near this extension. The old
     * listener sat on `videoTrack`, which is the *canvas* track whenever a
     * webcam composite exists — a canvas track never ends on its own, so a
     * webcam recording never noticed the share had stopped. And it was attached
     * after the `format === 'gif'` early return, so no GIF ever noticed either.
     * One listener, on the track that can actually end, before either branch.
     */
    const sourceTrack = stream.getVideoTracks()[0];
    sourceTrack.addEventListener(
      'ended',
      () => {
        // Still ours? A stream from an aborted start can outlive its clip by a
        // few milliseconds, and stamping the *next* clip's stop time would make
        // it claim a duration it does not have.
        if (active?.id !== id) return;
        // When the source ended is when the recording ended. Stamped now,
        // because by the time the worker has been woken, asked the offscreen
        // document to stop and had the encoder flush, `Date.now()` is seconds
        // later and the clip's stated duration would exceed the clip.
        active.stoppedAt = Date.now();
        // A composite draws the page onto a canvas and records THAT, so the
        // canvas track is still live even though the page track has ended.
        active.mixer?.stop();
        active.gifStop?.();
        chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', id }).catch(() => {});
      },
      { once: true }
    );

    if (format === 'gif') {
      await attachFeed();
      // A GIF has no audio track at all, so mic and tab audio are meaningless
      // here — said plainly rather than silently dropped.
      micStream?.getTracks().forEach((t) => t.stop());
      micStream = null;
      const gif = startGifCapture({
        id, sessionId, stream, feed, cam: camEl,
        fps: Math.min(fps || 10, 15), startedAt, webcamPosition, webcamSize,
      });
      /*
       * `camStream` on the session, so the camera is released.
       *
       * The GIF session used to carry no camera stream at all, so the teardown
       * in `stopRecording` had nothing to stop and the camera light stayed on
       * until the browser was closed. `sources` for the same reason on the
       * other side: the worker reads `started.sources` to log what went in, and
       * a GIF answered `undefined` there.
       */
      active = {
        ...gif,
        camStream,
        stoppedAt: claim.stoppedAt,
        ext: 'gif',
        label,
        sources: { tab: !desktop, screen: desktop, tabAudio: false, mic: false, webcam: !!camStream },
      };
      return {
        id, format, mime: 'image/gif', via: 'frames', sources: active.sources,
        refused: [...refused, ...(mic || tabAudio ? ['audio (a GIF cannot carry sound)'] : [])],
      };
    }

    /*
     * MP4 first, WebM only if this build cannot write MP4.
     *
     * `pickMime` walks the container's candidate list in `core/file-types.js` —
     * for MP4 that is `video/mp4;codecs=avc1.42E01E,mp4a.40.2` first and bare
     * `video/mp4` last — and answers with the first string `isTypeSupported`
     * accepts. The default format is now `mp4` (see `platform/settings.js`), so the
     * common path probes MP4 and stops. A tester who deliberately chose WebM or
     * Matroska still gets what they chose; the fallback chain below only runs
     * when their choice is unavailable, and MP4 is tried before WebM there too,
     * because a clip nobody can open is not evidence.
     */
    const mime = pickMime(format) || pickMime('mp4') || pickMime('webm');
    if (!mime) {
      // Every stream, not only the tab's. This branch used to stop `stream`
      // alone and walk away from the microphone and the camera it had just
      // opened — the same orphaning the catch below exists to prevent.
      throw new Error('This browser cannot record video at all: no supported encoder.');
    }

    /*
     * One video track, however many sources went into it.
     *
     * The compositor decodes every frame into a canvas and captures the
     * canvas. Since rec-resize-1027 every clip takes it, because it is the only
     * place the frame size is locked (see `composite`). The webcam is recorded
     * beside the picture instead of into it.
     *
     * `drawnCursor` is deliberately not `cursor`. A screen or window capture
     * already contains the real pointer, drawn by the operating system, and
     * painting a second one over it would give the clip two mice. Only a tab
     * capture is missing it, and only a tab capture gets one drawn.
     *
     * The tick still reaches a screen capture — it is the `cursor` constraint
     * in `displayStream()` above, which is what keeps the real pointer out of
     * the frames when it is off. So one tick, two mechanisms, and neither of
     * them draws a second mouse.
     */
    const drawnCursor = !!cursor && !desktop;
    // Every clip goes through the compositor, cursor or not (rec-resize-1027):
    // it is the one place the frame size is locked, and a raw tab or window
    // track changes size with the tab or window. Never hand the encoder
    // `sourceTrack` itself.
    await attachFeed();
    mixer = composite({ feed, fps: fps || 15, cursor: drawnCursor });
    // The encoder starts only on a locked frame: a canvas sized after start is
    // the defect itself, so no picture in 5 s is a refusal, not a clip.
    const frame = await Promise.race([mixer.ready, new Promise((res) => setTimeout(res, 5000, null))]);
    if (!frame) throw new Error('The tab sent no picture to record. Nothing was recorded; try Record again.');
    const videoTrack = mixer.stream.getVideoTracks()[0];

    // One audio track, mixed if there are two. See mixAudio.
    const audioSources = [
      ...(gotAudio ? stream.getAudioTracks() : []),
      ...(micStream ? micStream.getAudioTracks() : []),
    ];
    const mixed = mixAudio(audioSources);
    audioCtx = mixed.ctx;

    const recorded = new MediaStream([videoTrack, ...(mixed.track ? [mixed.track] : [])]);

    const recorder = new MediaRecorder(recorded, {
      mimeType: mime,
      videoBitsPerSecond: videoBitrate(quality, sourceTrack.getSettings?.().width, sourceTrack.getSettings?.().height),
      audioBitsPerSecond: 128_000,
    });

    /*
     * Every chunk goes to disk as it arrives.
     *
     * A whole clip used to live in this array until Stop, so anything that
     * ended this document — a crash, an extension reload, Chrome reclaiming an
     * idle offscreen page — took every recorded minute with it, with nothing on
     * disk to recover. Each `ondataavailable` Blob is now written into the
     * `mediaParts` store under `[id, seq]` and assembled in order at stop.
     *
     * `chunks` is the fallback, not the plan: if a part cannot be written the
     * clip stays in memory from that point rather than being abandoned, and the
     * reason is reported. Everything is routed through one serial promise so
     * the order on disk is the order the encoder produced, whichever path a
     * given chunk took.
     */
    let partSeq = 0;
    // When the picture's encoder handed over its first bytes — the zero the
    // companion's `offsetMs` is measured against. Only the first one matters.
    let firstChunkAt = null;
    const parts = partWriter({
      put: (at, blob) => putMediaPart(id, at, blob),
      onFail: warnDisk,
      // Stop cleanly at the cap: the recorder flushes its last chunk and the
      // clip is filed from what is held, with the warning attached.
      onCap: () => {
        chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', id, reason: 'ram-cap' }).catch(() => {});
      },
    });
    recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      firstChunkAt ??= Date.now();
      parts.add(e.data, partSeq++);
    };

    /**
     * The settle promise, built HERE and not inside `stop()`.
     *
     * Chrome ends a desktop capture on its own — the "Stop sharing" bar, the
     * shared tab closing, the shared window closing — and an ended source
     * auto-stops the MediaRecorder. `onstop` used to be assigned inside
     * `active.stop()`, so that automatic `stop` event fired at a handler that
     * did not exist yet; nothing resolved, nothing was assigned, and the worker
     * then called `stop()` on a recorder already `inactive`, which throws.
     *
     * It **resolves** on an encoder error rather than rejecting, because by
     * then the parts are already on disk: a partial clip filed and labelled is
     * worth more than a clean rejection that throws away the recording. The
     * failure travels on the result and is stamped on the record.
     */
    let settle = () => {};
    const done = new Promise((resolve) => {
      let settled = false;
      settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
    });
    recorder.onstop = () => settle({ ok: true });
    /*
     * `onerror`, which did not exist at all.
     *
     * A MediaRecorder that dies mid-clip — the encoder falling over, the source
     * changing shape under it — fires `error` and then never fires `stop`. With
     * no handler the clip simply stopped growing while every surface went on
     * reporting `recording: true`, and the tester found out at Stop, when the
     * chunks were discarded.
     */
    recorder.onerror = (e) => {
      const err = e?.error || new Error('The recorder stopped with an error and the clip is incomplete.');
      const message = String(err.message || err);
      if (active?.id === id) {
        active.failed = message;
        active.stoppedAt ??= Date.now();
      }
      // Tell the worker, which stops and files what there is. Without this the
      // toolbar goes on breathing over a recorder that is already dead.
      chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', id, failed: message }).catch(() => {});
      settle({ ok: false, error: message });
    };

    // A timeslice means chunks arrive as we go. Without it the whole recording
    // sits in the encoder until stop(), and a crash loses all of it.
    recorder.start(2000);

    /*
     * The second recorder, started after the first and never before it.
     *
     * Order matters for one reason: `offsetMs` is measured from the picture, so
     * the picture has to be the thing that is already running. A companion that
     * started first would carry a negative offset, which every reader would
     * then have to special-case.
     *
     * The whole start is in a try: a camera that will not record is a refusal
     * to report, not a reason to abandon a recording of the defect.
     */
    const camGeometry = camStream ? { position: webcamPosition, size: webcamSize } : null;
    if (camStream) {
      try {
        camRecorder = startCamRecorder({
          id, sessionId, camStream, quality, label,
          geometry: camGeometry, startedAt: Date.now(),
        });
      } catch (err) {
        camRecorder = null;
        refused.push(`webcam track (${String(err?.message || err)}); the clip has no face on it`);
      }
    }

    // The marker that says this clip exists, written before a byte of it does,
    // so a crash leaves something the next start can find and recover.
    const ext = extForMime(mime, format);
    await putMediaPending({
      id, sessionId, startedAt, label: label || 'Screen recording',
      type: mime.split(';')[0], ext,
      sources: {
        tab: !desktop, screen: desktop,
        tabAudio: gotAudio, mic: !!micStream, webcam: !!camStream,
        // What is in the picture, not what was asked for: a screen capture
        // carries the operating system's own cursor — and only while the
        // `cursor` constraint asked for it — where a tab capture carries the
        // drawn one, and both are true "the cursor is in this clip".
        cursor: drawnCursor || (desktop && !!cursor),
      },
      // The inset square's own geometry, so the editor can find and move it
      // exactly instead of guessing from whatever Settings holds today —
      // Settings can change after the clip is recorded, the clip cannot.
      ...(camGeometry ? { webcam: camGeometry } : {}),
      // Which companion holds the face, named on the marker too, so a crash
      // recovery can put the pair back together rather than filing two clips
      // that have forgotten about each other.
      webcamTrackId: camRecorder?.id || null,
    }).catch(() => {
      /* No marker is a clip that cannot be recovered, not a clip that cannot
         be recorded. Recording matters more; the failure shows at stop. */
    });

    active = {
      kind: 'recorder',
      id,
      sessionId,
      stream,
      micStream,
      camStream,
      mixer,
      audioCtx,
      startedAt,
      // Same geometry, carried on the in-memory record too — `filing.js` and
      // anything else that reads `active` mid-recording sees the same shape
      // `putMediaPending` already wrote, rather than needing to re-derive it.
      ...(camGeometry ? { webcam: camGeometry } : {}),
      // The second recorder, so `stopRecording` can stop it, flush it and file
      // it beside the picture. Null whenever there is no camera, or when
      // starting it failed — which is reported and survivable.
      camRecorder,
      // Read by `companionRecord()` for `offsetMs`. A getter and not a value:
      // the first chunk has not arrived yet at the moment this object is built.
      get firstChunkAt() { return firstChunkAt; },
      // Filled in by whichever ends the recording first — Chrome's own "Stop
      // sharing", the encoder failing, or the tester's Stop — and read for the
      // clip's duration.
      stoppedAt: claim.stoppedAt,
      failed: null,
      mime,
      /*
       * The extension, from the catalogue, decided here.
       *
       * The record used to store `blob.type`, which for a MediaRecorder is the
       * full codec string — `video/webm;codecs=vp8,opus`. `filing.js` split it
       * on `/` and took what followed, so every clip was saved as
       * `something.webm;codecs=vp8,opus`, a filename no operating system will
       * open. Naming the extension at the source removes the guess.
       */
      ext,
      label,
      sources: {
        tab: !desktop,
        screen: desktop,
        tabAudio: gotAudio,
        mic: !!micStream,
        webcam: !!camStream,
        cursor: drawnCursor || (desktop && !!cursor),
      },
      // What the assembly at stop needs, so `stopRecording` does not reach into
      // this closure by other means.
      settled: () => done,
      tailChunks: () => parts.chunks,
      flushed: () => parts.chain,
      partsProblem: () => parts.error,
      // Idempotent, because it is genuinely called twice: once by Chrome ending
      // the source and once by the tester (or the worker) asking to stop.
      // Calling `stop()` on an inactive recorder throws InvalidStateError;
      // asking for the settle that is already on its way does not.
      stop: () => {
        if (recorder.state !== 'inactive') recorder.stop();
        return done;
      },
    };
    return { id, format, mime, via: 'MediaRecorder', sources: active.sources, refused };
  } catch (err) {
    abort();
    throw err;
  }
}

/**
 * GIF has no encoder in the browser, so frames are grabbed by hand.
 *
 * **Quantised at grab time, and bounded by bytes.** Holding raw RGBA meant a
 * 900-frame cap at 1280x720 retained about 1.3 GB before a single byte was
 * encoded, on the one thread this document has — the tab froze, then the whole
 * encode ran synchronously and the worker's handler deadline expired while it
 * was still working. A palette is seeded from the first few frames and every
 * frame after that is stored as one byte per pixel instead of four, the total
 * retained is capped in bytes rather than in frames (a frame at 'high' quality
 * is not the same size as one at 'low'), and the encode itself hands the thread
 * back every few frames.
 *
 * Geometry is locked at the first grab. A tab resized mid-capture used to
 * change the canvas under a single global palette and a single logical screen
 * size, which decodes as garbage from the resize onwards.
 *
 * **The webcam is still composited inline here, and that is not an oversight.**
 * The picture path stopped burning it in (see `composite`) because a video clip
 * can carry a second track that the editor moves afterwards. A GIF cannot: it
 * is one indexed image stream, one palette, one frame after another, with no
 * layer to put anything on and no container to put a second stream in. So for a
 * GIF the choice is the inset painted where the tester put it, or no face at
 * all — and `paint()` below paints it.
 */
const GIF_MAX_BYTES = 192 * 1024 * 1024;
const GIF_SEED_FRAMES = 4;
const GIF_MAX_WIDTH = 800;

function startGifCapture({ id, sessionId, stream, feed, cam, fps, startedAt, webcamPosition = 'bottom-right', webcamSize = 22 }) {
  // Its own canvas, not the shared `#scratch`. This is the only writer that
  // runs on a timer, so it is the one that could be halfway through a frame
  // when a transcode or a full-page stitch resized the same element underneath
  // it — which decodes as a torn frame, or throws.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const seeds = [];
  const interval = Math.round(1000 / fps);

  let palette = null;
  let map = null;
  let bytes = 0;
  let width = 0;
  let height = 0;
  let lastGrab = 0;
  let timer = null;
  let full = false;

  const paint = () => {
    ctx.drawImage(feed, 0, 0, width, height);
    if (cam && cam.videoWidth) {
      const side = Math.round((height * webcamSize) / 100);
      const margin = Math.round(side * 0.18);
      const x = webcamPosition.includes('left') ? margin : width - side - margin;
      const y = webcamPosition.includes('top') ? margin : height - side - margin;
      const crop = Math.min(cam.videoWidth, cam.videoHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + side / 2, y + side / 2, side / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(cam, (cam.videoWidth - crop) / 2, (cam.videoHeight - crop) / 2, crop, crop, x, y, side, side);
      ctx.restore();
    }
  };

  const seal = () => {
    // Seed the palette from the first few frames rather than from one: the
    // opening frame of a capture is often a blank page, and a palette built
    // from it has nothing to say about the colours that follow.
    ({ palette, map } = buildPalette(seeds, 256));
    for (const seed of seeds) {
      const indices = new Uint8Array(seed.data.length / 4);
      for (let i = 0, j = 0; i < seed.data.length; i += 4, j++) {
        indices[j] = map(seed.data[i], seed.data[i + 1], seed.data[i + 2]);
      }
      frames.push({ indices, width: seed.width, height: seed.height, delayMs: seed.delayMs });
      bytes += indices.length;
    }
    seeds.length = 0;
  };

  const stopCapturing = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  const grab = () => {
    if (full || !feed.videoWidth) return;

    if (!width) {
      // Locked once, at the first frame that has a size.
      const scale = Math.min(1, GIF_MAX_WIDTH / feed.videoWidth);
      width = Math.max(2, Math.round(feed.videoWidth * scale));
      height = Math.max(2, Math.round(feed.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
    }

    const now = Date.now();
    // The real gap, not the nominal one. A timer that slips — and one on a
    // never-rendered document slips constantly — produced a GIF whose stated
    // delays did not match the moments the frames were taken, so playback ran
    // at a speed nobody chose.
    const delayMs = lastGrab ? Math.min(2000, now - lastGrab) : interval;
    lastGrab = now;

    paint();
    const rgba = ctx.getImageData(0, 0, width, height).data;

    if (!palette) {
      seeds.push({ data: rgba, width, height, delayMs });
      if (seeds.length >= GIF_SEED_FRAMES) seal();
      return;
    }

    const indices = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) indices[j] = map(rgba[i], rgba[i + 1], rgba[i + 2]);
    frames.push({ indices, width, height, delayMs });
    bytes += indices.length;

    if (bytes >= GIF_MAX_BYTES) {
      // The cap is reached, so stop capturing AND say so. It used to stop
      // silently while every surface went on counting the seconds up, so the
      // tester believed they were recording a minute they were not.
      full = true;
      stopCapturing();
      chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', id, reason: 'gif-full' }).catch(() => {});
    }
  };

  timer = setInterval(grab, interval);

  return {
    kind: 'gif',
    id,
    sessionId,
    stream,
    startedAt,
    mime: 'image/gif',
    frameCount: () => frames.length + seeds.length,
    gifStop: stopCapturing,
    settled: () => Promise.resolve({ ok: true }),
    tailChunks: () => [],
    flushed: () => Promise.resolve(),
    partsProblem: () => null,
    stop: async () => {
      stopCapturing();
      if (seeds.length && !palette) seal();
      if (!frames.length) throw new Error('Nothing was captured. The tab produced no frames.');
      // Chunked, so this document can still answer a message while it encodes.
      const out = await encodeGifAsync(frames, { loop: 0, palette });
      return new Blob([out], { type: 'image/gif' });
    },
  };
}

/**
 * Stop, assemble, store — and stay claimed until the bytes are actually down.
 *
 * `active = null` used to be the second statement of this function, before the
 * encoder had flushed and before `putMedia` had resolved. In that window every
 * guard read "nothing is recording": a second Stop walked past `if (!active)`,
 * called `recorder.stop()` on an inactive recorder and installed an `onstop`
 * that would never fire, and a Record press started a fresh clip whose elements
 * this teardown then pulled out from under it. The claim is now moved to
 * `finishing` instead of cleared, `UQA_OFF_STATE` reports that, and both
 * entry points refuse it.
 */
async function stopRecording({ label } = {}) {
  if (!active) throw new Error('Nothing is being recorded.');
  if (active.kind === 'starting') {
    throw new Error('That clip is still starting. Give it a moment, then press Stop.');
  }
  if (active.kind === 'finishing') {
    throw new Error('That clip is already being saved. It will appear in the report on its own.');
  }

  const session = active;
  active = { ...session, kind: 'finishing' };

  // Now, not after the encoder has flushed — and not at all if the source
  // already ended or the recorder failed, because those moments are the honest
  // ones and they have already been stamped.
  session.stoppedAt ??= Date.now();

  let outcome = { ok: true };
  let tail = null;
  try {
    // A GIF's stop() answers with the finished Blob; a recorder's answers with
    // whether the encoder got to the end.
    const result = await session.stop();
    if (result instanceof Blob) tail = result;
    else outcome = result || { ok: true };
  } catch (err) {
    // A stop that throws must still release the hardware and must still file
    // whatever reached the disk. The clip is not the encoder's to destroy.
    outcome = { ok: false, error: String(err?.message || err) };
  } finally {
    // Awaited here and not only on the happy path: chunks still on their way to
    // disk when the encoder fell over are chunks of a real recording, and
    // assembling before they land would silently truncate it.
    /*
     * The companion, stopped and flushed alongside the picture.
     *
     * In its own try because it must not be able to stop the picture from being
     * filed: everything below this line releases hardware and writes evidence,
     * and a webcam recorder that throws on the way down would skip all of it.
     */
    try { session.camRecorder?.stop(); } catch { /* already inactive */ }
    await Promise.resolve(session.camRecorder?.flushed?.()).catch(() => {});

    await session.flushed?.().catch(() => {});
    const rest = session.tailChunks?.() || [];
    if (rest.length) tail = new Blob(rest, { type: (session.mime || '').split(';')[0] });
    // Always release every source, even if encoding failed. A capture indicator
    // left burning on a tab nobody is recording — or worse, a camera light left
    // on — is its own bug report.
    session.mixer?.stop();
    session.gifStop?.();
    session.stream?.getTracks().forEach((t) => t.stop());
    session.micStream?.getTracks().forEach((t) => t.stop());
    session.camStream?.getTracks().forEach((t) => t.stop());
    try { session.audioCtx?.close(); } catch { /* already closed */ }
    /*
     * Conditional teardown.
     *
     * `#feed`, `#cam` and `#echo` are shared by every clip, so blanking them
     * unconditionally at the end of one stop tore the elements out from under a
     * clip that had started in the meantime — a picture-in-picture that went
     * black, or a GIF that grabbed nothing. Only blank them if nothing else has
     * claimed them since.
     */
    if (!active || active.id === session.id) releaseElements();
  }

  return fileClip(session, { label, tail, outcome });
}

/** A GIF's `stop()` answers with the finished Blob; a recorder's does not. */
async function fileClip(session, { label, tail, outcome }) {
  const mime = (session.mime || 'video/webm').split(';')[0];
  const gifBlob = session.kind === 'gif' ? tail : null;

  const record = {
    id: session.id,
    sessionId: session.sessionId,
    kind: 'recording',
    label: label || session.label || 'Screen recording',
    // The container, never the codec string. See `ext` on the session.
    type: session.kind === 'gif' ? 'image/gif' : mime,
    ext: session.ext || (session.kind === 'gif' ? 'gif' : 'webm'),
    // When it stopped minus when it started. `Date.now()` here counted the
    // encoder's flush and, on the auto-stop path, the whole round trip through
    // the worker — so a clip that ended the moment the tester pressed "Stop
    // sharing" claimed several seconds it does not contain.
    durationMs: Math.max(0, (session.stoppedAt || Date.now()) - session.startedAt),
    ts: session.startedAt,
    sources: session.sources || { tab: true },
    // Said out loud on the record rather than swallowed: a clip whose encoder
    // died is still evidence, and the report should say it is short.
    incomplete: outcome?.ok === false ? outcome.error || session.failed || 'The recorder stopped early.' : null,
  };

  /*
   * The companion is filed FIRST, and the picture is told what it got.
   *
   * First, because the parent record carries `webcamTrackId` and a record is
   * written once: filing the picture and then coming back to stamp it would
   * leave a window in which the gallery has a clip that does not know where its
   * face is, and that window is exactly when the report is opened.
   *
   * Every failure here is recorded on the parent and swallowed. A companion
   * that would not assemble is a clip without a face; it is not a lost clip,
   * and the four minutes of defect in the picture are what the tester came for.
   */
  let webcamTrackId = null;
  let webcamProblem = null;
  const cam = session.camRecorder;
  if (cam) {
    const companionId = cam.id;
    try {
      const companion = companionRecord(
        // The parent's own facts, not Settings': the geometry and the label
        // belong to the clip that was recorded, and both can change afterwards.
        { ...record, webcam: session.webcam, startedAt: session.startedAt, firstChunkAt: session.firstChunkAt },
        cam
      );
      const camTail = new Blob(cam.tailChunks() || [], { type: companion.type });
      const storedCam = await assembleMedia({ ...companion, blob: camTail.size ? camTail : null }, sha256Hex);
      if (storedCam.bytes) webcamTrackId = companion.id;
      else {
        await clearMediaParts(companionId).catch(() => {});
        webcamProblem = 'the camera produced nothing';
      }
    } catch (err) {
      await clearMediaParts(companionId).catch(() => {});
      webcamProblem = String(err?.message || err);
    }
    if (cam.failed) webcamProblem ||= cam.failed;
  }
  // `null` and not absent: the editor reads a missing field as "this clip was
  // recorded before the webcam had its own track, so the face is baked in", and
  // a clip recorded today is not that clip whatever happened to its camera.
  record.webcamTrackId = webcamTrackId;
  if (webcamProblem) record.webcamProblem = webcamProblem;

  let stored;
  try {
    stored = gifBlob
      ? await putMedia(await withHash({ ...record, blob: gifBlob, bytes: gifBlob.size })).then(() => ({ ...record, bytes: gifBlob.size }))
      : await assembleMedia({ ...record, blob: tail }, sha256Hex);
  } catch (err) {
    /*
     * The store refused it — and the clip is not gone.
     *
     * This used to throw with the Blob in a local that went out of scope with
     * the function: a full disk for one second destroyed every recorded minute,
     * with nothing anywhere that could write it out. It is parked in
     * `pendingBlob` instead, and `UQA_OFF_RESCUE` saves it through the
     * downloads API. Returned rather than thrown, so the worker's teardown —
     * the icon, the broadcast — still runs; a throw skipped all of it and left
     * the toolbar breathing over a recording that had already ended.
     */
    const parts = await mediaParts(session.id).catch(() => []);
    const rescue = new Blob([...parts, ...(tail ? [tail] : [])], { type: record.type });
    pendingBlob = rescue.size ? { id: session.id, blob: rescue, meta: record } : null;
    if (active?.id === session.id) {
      active = null;
      // The pointer belongs to the clip, not to the document. Dropped with it,
      // so nothing of where the tester's mouse was outlives the recording.
      pointer = null;
    }
    return {
      ...record,
      stored: false,
      bytes: rescue.size,
      error:
        `The clip was recorded but could not be stored: ${String(err?.message || err)}. ` +
        (rescue.size
          ? 'It is still in memory. Press "Rescue the clip" to write it to your downloads before closing the browser.'
          : 'Nothing of it survived.'),
    };
  } finally {
    if (active?.id === session.id) {
      active = null;
      // The pointer belongs to the clip, not to the document. Dropped with it,
      // so nothing of where the tester's mouse was outlives the recording.
      pointer = null;
    }
  }

  // A zero-byte clip is a failure with a filename. Reported as a result and not
  // as a throw, so the worker's finally still reconciles every surface.
  if (!stored.bytes) {
    await clearMediaParts(session.id).catch(() => {});
    return { ...record, stored: false, bytes: 0, error: 'The recording came out empty. Nothing was encoded.' };
  }

  const partsProblem = session.partsProblem?.();
  const { blob: _omit, ...meta } = stored;
  return {
    ...meta,
    stored: true,
    ...(partsProblem ? { warning: `Part of this clip could not be written to disk: ${partsProblem.message || partsProblem}` } : {}),
  };
}

/**
 * Write a clip the database refused out through the downloads API.
 *
 * Never by sending the Blob anywhere: a Blob crossing `chrome.runtime`
 * messaging arrives as `{}`, with no error at all.
 */
async function rescuePending({ filename } = {}) {
  if (!pendingBlob) throw new Error('There is no unsaved clip waiting to be rescued.');
  const { id, blob, meta } = pendingBlob;
  const name = filename || `qa-wrap-rescued-${id}.${meta.ext || 'webm'}`;
  const url = URL.createObjectURL(blob);
  if (chrome.downloads?.download) {
    /*
     * `uniquify`, never the default.
     *
     * `chrome.downloads.download` defaults to `conflictAction: 'uniquify'` on
     * paper and to the browser's download setting in practice, and a rescue is
     * the one write that must never lose to a name collision: the clip it is
     * writing out is the copy the database has already refused, so an
     * `overwrite` here destroys evidence that exists nowhere else. Named
     * explicitly, and it matches rule 4 of the filing contract Group D holds
     * (`research/54-real-session-review.md`, finding 19): every copy of the
     * same thing lands side by side, never over.
     */
    const downloadId = await chrome.downloads.download({
      url, filename: name, saveAs: true, conflictAction: 'uniquify',
    });
    pendingBlob = null;
    return { rescued: true, downloadId, filename: name, bytes: blob.size };
  }
  // An offscreen document is not guaranteed the downloads API. Hand the worker
  // a same-origin object URL it can download from instead — the bytes never
  // cross the message port either way.
  return { rescued: false, url, filename: name, bytes: blob.size };
}

/* ── stills ────────────────────────────────────────────────────────────── */

/**
 * Chrome's captureVisibleTab only ever returns PNG or JPEG. Anything else — and
 * a JPEG at a chosen quality rather than Chrome's default — has to be re-encoded
 * through a canvas, which is why this lives here rather than in the worker.
 */
async function transcodeImage({ dataUrl, format, quality }) {
  const target = byId(IMAGE_TYPES, format === 'jpg' ? 'jpeg' : format)?.mime || 'image/png';

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // Its own canvas. `#scratch` was shared with the GIF capture, which writes on
  // a timer: a screenshot taken during a GIF recording resized the element
  // between that timer's `drawImage` and its `getImageData`, so one path got a
  // torn frame and the other got a picture of the wrong size.
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha; without a ground, transparent regions come out black.
  if (target === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const lossless = target === 'image/png' || target === 'image/bmp';
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, target, lossless ? undefined : (quality ?? 92) / 100)
  );
  if (!blob) throw new Error(`This browser cannot encode ${format}.`);

  // Confirm the browser produced what was asked for. canvas.toBlob silently
  // falls back to PNG for a type it does not support, which would otherwise
  // ship a .webp file that is really a PNG.
  if (blob.type !== target) {
    throw new Error(`Asked for ${target}, got ${blob.type}. This browser cannot encode ${format}.`);
  }
  return blob;
}

/**
 * Draw the tiles of a full-page capture onto one image.
 *
 * The two things that make this correct rather than merely working:
 *
 * **Tiles are placed at their real scroll offset**, which the worker measured
 * from the page rather than assuming. The last tile is always clamped — the
 * document will not scroll past its own end — so placing it at `index × height`
 * repeats a strip of the page, and the repeat lands exactly where the footer
 * is, which is where anyone checking the screenshot looks first.
 *
 * **The canvas is in device pixels.** The worker reports CSS pixels because
 * that is what the page thinks in, but `captureVisibleTab` returns the physical
 * bitmap — on a 2× display that is twice the size. Building the canvas from the
 * CSS numbers throws away half the resolution of every screenshot taken on a
 * laptop, which is most of them.
 */
async function stitchTiles({ tiles, width, height, dpr, format, quality, sessionId, label, url, session, version }) {
  if (!tiles?.length) throw new Error('Nothing was captured.');

  /*
   * An `OffscreenCanvas` of its own, not the shared `#scratch` element.
   *
   * Two reasons, and the second is why it is this class and not another
   * `<canvas>`. A full-page stitch is the largest bitmap this document ever
   * builds — a tall page on a 2x display is easily 2000x20000 device pixels —
   * and holding it in an element in the DOM keeps it resident for the life of
   * the document. `convertToBlob` also settles the type honestly, where
   * `toBlob` on an element hands back a PNG for a type it cannot encode with no
   * error at all, which is how a `.webp` that was really a PNG used to ship.
   */
  const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr));
  const ctx = canvas.getContext('2d');

  const target = byId(IMAGE_TYPES, format === 'jpg' ? 'jpeg' : format)?.mime || 'image/png';
  if (target === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const tile of tiles) {
    const bitmap = await createImageBitmap(await (await fetch(tile.dataUrl)).blob());
    ctx.drawImage(bitmap, 0, Math.round(tile.y * dpr));
    bitmap.close();
  }

  const lossless = target === 'image/png' || target === 'image/bmp';
  const blob = await canvas
    .convertToBlob({ type: target, ...(lossless ? {} : { quality: (quality ?? 92) / 100 }) })
    .catch(() => null);
  if (!blob) throw new Error(`This browser cannot encode ${format}.`);
  if (blob.type !== target) {
    throw new Error(`Asked for ${target}, got ${blob.type}. This browser cannot encode ${format}.`);
  }

  // Free it now rather than leaving a full-page bitmap resident in a document
  // that Chrome keeps alive for the next recording. (The 1x1 trick that used to
  // stand here existed because the canvas was a shared element; this one is a
  // local, so shrinking it is all that is needed before it is collected.)
  canvas.width = 1;
  canvas.height = 1;

  // The stitched page carries the same invisible mark as a single frame.
  const marked = blob.type === 'image/png'
    ? await stampPng(blob, { session, version, kind: 'screenshot', label: label || 'Full page' })
    : blob;

  const record = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    kind: 'screenshot',
    label: label || 'Full page',
    blob: marked,
    type: marked.type,
    bytes: marked.size,
    url,
    ts: Date.now(),
    fullPage: true,
    tiles: tiles.length,
    provenance: marked !== blob,
  };
  record.sha256 = await sha256Hex(record.blob);
  await putMedia(record);
  const { blob: _omit, ...meta } = record;
  return meta;
}




/**
 * Provenance goes into the file, never onto the picture.
 *
 * This replaces a function that painted a plate of text into the corner of every
 * screenshot. That was the wrong instinct twice over: it was ugly, and a QA tool
 * exists to record what a screen showed — drawing on that record is the same
 * contamination the shadow-root work removed from the other direction.
 *
 * PNG `tEXt` chunks carry it instead. Invisible, standard, read by ImageMagick,
 * ExifTool, Pillow and any model with an image-metadata step, and they survive
 * the file being copied, emailed and attached to a ticket. Not one pixel moves.
 */
async function markImage({ id, session, version, label }) {
  const original = await getMedia(id);
  if (!original) throw new Error('That image is no longer stored.');
  if (original.type !== 'image/png') {
    // Only PNG has a text chunk. Saying so beats silently doing nothing, and
    // beats re-encoding somebody's JPEG evidence to add a comment to it.
    throw new Error('Only PNG evidence carries embedded provenance. This image is ' + original.type + '.');
  }

  const blob = await stampPng(original.blob, { session, version, kind: 'screenshot', label: label || original.label });

  // Replaces in place: no pixel changed, so there is no unmarked original to
  // preserve. That is the difference from the version this replaces.
  await putMedia(await withHash({ ...original, blob, bytes: blob.size, provenance: true }));
  return { id: original.id, bytes: blob.size, embedded: true };
}

async function saveImage({ dataUrl, format, quality, sessionId, label, url, session, version }) {
  const raw = await transcodeImage({ dataUrl, format, quality });
  /*
   * Marked on the way in, not as a separate action.
   *
   * It costs nothing — a few hundred bytes of `tEXt` and no re-encode — and it
   * is invisible, so there is no reason to make somebody ask for it. Every
   * screenshot therefore carries its origin from the moment it exists, which is
   * the only version of this that actually protects anything: a mark you have
   * to remember to apply is a mark that is missing from the file that mattered.
   */
  const blob = raw.type === 'image/png'
    ? await stampPng(raw, { session, version, kind: 'screenshot', label })
    : raw;
  const record = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    kind: 'screenshot',
    label: label || 'Screenshot',
    blob,
    type: blob.type,
    bytes: blob.size,
    url,
    ts: Date.now(),
    provenance: blob !== raw,
  };
  record.sha256 = await sha256Hex(record.blob);
  await putMedia(record);
  const { blob: _omit, ...meta } = record;
  return meta;
}

/* ── messaging ─────────────────────────────────────────────────────────── */

/**
 * Filing, moved here from the worker for one reason: `import()`.
 *
 * `background/trackers.js` is 23 KB of adapters that matter for a few seconds,
 * twice a week, when somebody presses File. In the service worker it was parsed
 * on **every cold start** instead, because a worker's module graph must be
 * knowable at registration and `import()` throws there
 * (`tools/test-worker-imports.mjs` has the whole finding). This document is an
 * ordinary page, so it can load the adapters at the moment they are needed and
 * never before.
 *
 * Nothing else moved. The credentials are still read by the worker from
 * `chrome.storage` and passed in; the egress rule is still the adapter's own,
 * asserted in `tools/test-trackers.mjs`; the public message names the popup and
 * the report use are untouched. This page only owns the load.
 */
/**
 * Every document the product hands over is built here, for the same reason.
 *
 * `background/export-build.js` reaches for twenty modules — the exporters, the
 * ISO 29119 documents, the workbooks, the flow diagram — and none of them is
 * needed to record a session. In the worker they were parsed on every cold
 * start; here they are loaded the moment somebody presses Export and never
 * before. The module reads IndexedDB itself rather than having megabytes of
 * screenshots passed to it field by field.
 */
/**
 * Jira, loaded when somebody files and never before.
 *
 * Nineteen KB of client that the service worker parsed on every cold start.
 * `background/jira-door.js` keeps the worker's call sites reading as they did;
 * this is where the calls actually land.
 *
 * `fileIssue` and `fileSuite` are the ones that could not be simple forwards:
 * the evidence (screenshots out of IndexedDB, the text exports) is built here,
 * next to the database and the builder, and handed to them as `io.buildFiles`.
 * A Blob does not survive `chrome.runtime.sendMessage`.
 */
let jiraMod = null;
const jiraLib = async () => (jiraMod ||= await import('../background/jira.js'));
let dbMod = null;
const dbLib = async () => (dbMod ||= await import('../core/db.js'));

/**
 * The evidence set, read once and shared by every tracker.
 *
 * Split out on 8 September 2026 so that Jira and the
 * other trackers cannot attach two different things. Shortcut and YouTrack grew
 * an `attach()` of their own in `background/trackers.js`, and a second copy of
 * "which screenshots count, in what order, named how" is exactly the kind of
 * near-duplicate that drifts and is only noticed on a ticket somebody else is
 * reading.
 *
 * `failed` comes back beside the files rather than thrown: an export format
 * that could not be built is worth reporting on the ticket's result, and it is
 * not a reason to file nothing.
 */
async function sessionFiles(sessionId, attach) {
  const [db, exp] = await Promise.all([dbLib(), exportLib()]);
  const files = [];
  const failed = [];

  if (attach.screenshots) {
    const images = (await db.listMedia(sessionId)).filter((m) => String(m.type || '').startsWith('image/'));
    for (const m of images.slice(0, 30)) {
      const rec = await db.getMedia(m.id).catch(() => null);
      if (!rec?.blob) continue;
      const ext = (rec.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const base = String(rec.label || rec.name || `screenshot-${m.id}`).replace(/[^\w.-]+/g, '-').slice(0, 60);
      files.push({ filename: /\.\w{3,4}$/.test(base) ? base : `${base}.${ext}`, blob: rec.blob });
    }
  }

  for (const format of attach.formats || []) {
    try {
      // Raw, never gzipped: an attachment is opened by a person in a browser,
      // and a `.json.gz` on a ticket is a file nobody clicks.
      const out = await exp.buildExport({ sessionId, format, withImages: false, version: attach.version });
      files.push({ filename: out.filename, blob: new Blob([out.content], { type: out.mime }) });
    } catch (err) {
      failed.push({ name: format, ok: false, error: err.message });
    }
  }

  return { files, failed };
}

let renderMod = null;
const renderLib = async () => (renderMod ||= await import('../core/istqb-render.js'));

async function offRender({ fn, args = [] }) {
  const lib = await renderLib();
  if (typeof lib[fn] !== 'function') throw new Error(`istqb-render has no ${fn}()`);
  return lib[fn](...args);
}

/**
 * Postman, behind the same door, and for one caller.
 *
 * `core/postman.js` is 13 KB and the offscreen document has always loaded it,
 * through `background/export-build.js`, to write the collection and the
 * environment. The service worker loaded it as well — for `summarisePostman()`
 * alone, the one function that answers "how many requests would this export
 * contain" before the export is made — and because `summarisePostman()` builds
 * the whole collection to count it, none of the module could be split away.
 *
 * So the count is made where the collection is already made. 13 KB left the
 * worker's boot graph on 8 September 2026 to pay for `background/site-access.js`,
 * which is the module the optional-host-permission work needed there instead.
 */
let postmanMod = null;
const postmanLib = async () => (postmanMod ||= await import('../core/postman.js'));

async function offPostman({ fn, args = [] }) {
  const lib = await postmanLib();
  if (typeof lib[fn] !== 'function') throw new Error(`postman has no ${fn}()`);
  return lib[fn](...args);
}

/**
 * Three more pure modules behind the door: black-box design, the suite builder
 * and the cross-browser project. ~47 KB left the worker's boot graph with them.
 * `fn` may name a constant (VIEWPORTS, RUN_COMMAND) as well as a function.
 */
const pureMods = {};
const pureLoaders = {
  blackbox: () => import('../core/blackbox.js'),
  suite: () => import('../core/suite.js'),
  crossbrowser: () => import('../core/crossbrowser.js'),
  scan: () => import('../core/secret-scan-text.js'),
  problems: () => import('../core/finding-count.js'),
};
const pureAlias = { relations: 'RELATIONS', viewports: 'VIEWPORTS', runCommand: 'RUN_COMMAND' };

async function offPure(name, { fn, args = [] }) {
  const lib = (pureMods[name] ||= await pureLoaders[name]());
  const key = pureAlias[fn] || fn;
  if (!(key in lib)) throw new Error(`${name} has no ${fn}()`);
  if (name === 'blackbox' && fn === 'decisionTable' && args[1] && typeof args[1] === 'object') {
    // A function cannot cross the channel: the outcomes arrive as a map keyed by the rule's bit pattern.
    const map = args[1];
    args = [args[0], (assignment) => map[Object.values(assignment).map((v) => (v ? 1 : 0)).join('')] ?? null];
  }
  if (name === 'blackbox' && fn === 'decisionTable' && args[1] == null) args = [args[0]];
  return typeof lib[key] === 'function' ? lib[key](...args) : lib[key];
}

let cookieFmtMod = null;
async function offCookieFmt({ fn, args = [] }) {
  const lib = (cookieFmtMod ||= await import('../core/cookie-formats.js'));
  if (!(fn in lib)) throw new Error(`cookie-formats has no ${fn}`);
  return typeof lib[fn] === 'function' ? lib[fn](...args) : lib[fn];
}

async function offJira({ fn, args = [] }) {
  // The filing paths are handed the file builder: evidence is built where the data lives.
  if (fn === 'fileIssue' || fn === 'fileSuite') {
    return (await jiraLib())[fn](args[0], args[1], { buildFiles: (attach) => sessionFiles(args[1].sessionId, attach) });
  }
  if (fn === 'poll') return (await import('../core/jira-notifier.js')).poll(...args); // the Jira helper's notifications, off the worker's boot graph
  const lib = await jiraLib();
  if (typeof lib[fn] !== 'function') throw new Error(`Jira has no ${fn}()`);
  return lib[fn](...args);
}

let exportMod = null;
const exportLib = async () => (exportMod ||= await import('../background/export-build.js'));

/**
 * The ticket draft, the Playwright spec, the title and the repro steps (T-075 bytes).
 *
 * `core/artifact.js`, `core/formats.js` and `core/jira-templates.js` left the
 * worker's boot graph for this: they load here on demand, and the events are
 * read from IndexedDB here, so only the session id crosses the message. The
 * worker flushes its write queue before it asks. Exported for the Node test,
 * which hands it the same fixture the core functions get directly.
 *
 * @param {{ fn: string, args?: any }} request
 * @param {{ db?: any, libs?: any[] }} [deps]
 */
export async function offDraft({ fn, args = {} }, deps = {}) {
  const db = deps.db || await dbLib();
  const [art, fmt, jt, ev] = deps.libs || await Promise.all([
    import('../core/artifact.js'), import('../core/formats.js'), import('../core/jira-templates.js'), import('../core/events.js'),
  ]);
  if (fn === 'pickIssueType') return jt.pickIssueType(args.kind, args.types) ?? null;
  const session = await db.getSession(args.sessionId);
  if (!session) {
    if (fn === 'ticketTitle') return null;
    throw new Error(`Unknown session ${args.sessionId}`);
  }
  const events = await db.getEvents(args.sessionId);
  switch (fn) {
    case 'playwrightSpec': return art.buildPlaywrightSpec(session, events);
    case 'ticketTitle': return fmt.title(session, events);
    case 'draftIssue': return jt.draft(args.kind, session, args.problemsOnly ? ev.problemEvents(events) : events);
    default: throw new Error(`draft has no ${fn}()`);
  }
}

async function offExport({ op, request }) {
  if (op === 'draft') return offDraft(request);
  if (op === 'bridge') return (await import('./agent-bridge.js')).answer(request);
  if (op === 'update') return (await import('../core/update-check.js')).run(request);
  const lib = await exportLib();
  // `session` is the whole thing including the gzip decision; `build` is the
  // raw bytes, which is what attaching to a Jira issue wants.
  let out = await lib.buildExport(request);
  // T-066: Markdown documents end with the checksum line, the session JSON lists them, and every result carries
  // the SHA-256 of the exact bytes handed over. The stamp comes before the gzip so it is inside what is compressed.
  if (STAMPED.has(request.format)) out = await stampDocument(out, { format: request.format, hashes: await shotHashes(request.sessionId) });
  if (op !== 'build') out = await (await import('../core/exporters.js')).gzipExport(out, request.format);
  return withSha256(out);
}

const STAMPED = new Set(['markdown', 'manual', 'srs', 'sbtm', 'json']);
/** `{captureId: sha256}` for the session's stored screenshots (hashed at write; a legacy record is hashed from its blob). */
async function shotHashes(sessionId) {
  const db = await dbLib();
  const ids = (await db.getEvents(sessionId)).filter((e) => e.kind === 'screenshot' && e.captureId).map((e) => e.captureId);
  return captureHashes(await db.getCaptures(ids));
}

let trackersMod = null;
const trackersLib = async () => (trackersMod ||= await import('../background/trackers.js'));

/**
 * The reverse-engineered specification, built here rather than in the worker.
 *
 * Same reason as the trackers above it: the worker's boot graph is at 794.8 KB
 * of an 800 KB cap, and `core/srs-reverse.js` pulls `artifact.js` and
 * `provenance.js` behind it. None of that is needed to wake up, answer a click
 * or file an event, and a module that is only wanted when a button is pressed
 * has no business being parsed at every service-worker start. The worker passes
 * a model and gets Markdown back; nothing else crosses.
 */
let srsMod = null;
const srsLib = async () => (srsMod ||= await import('../core/srs-reverse.js'));

/**
 * The fine print, loaded here for the same reason as the two above it.
 *
 * `core/fine-print.js` carries the policy matchers in two languages, the
 * sensitive-field patterns and the manual questions, and it fetches a tracker
 * host catalogue beside it. None of that is needed to wake up or file an event,
 * and the worker's boot graph is a few kilobytes from its ceiling.
 */
let finePrintMod = null;
let trackerHosts = null;
const finePrintLib = async () => (finePrintMod ||= await import('../core/fine-print.js'));
const trackerCatalogue = async () => (trackerHosts ||= await (await fetch(chrome.runtime.getURL('core/tracker-hosts.json'))).json());

async function offTracker({ op, tracker, cfg = {}, payload = {} }) {
  const lib = await trackersLib();
  switch (op) {
    case 'catalogue':
      return lib.trackerCatalogue();
    case 'state':
      // The catalogue plus "is this one filled in enough to try", which only the
      // adapter knows, because only it knows which of its fields are optional.
      return lib.trackerCatalogue().map((t) => ({
        ...t,
        configured: lib.isConfigured(t.id, payload?.cfgs?.[t.id] || {}),
      }));
    case 'test':
      return lib.testConnection(tracker, cfg);
    case 'targets':
      return lib.listTargets(tracker, cfg);
    case 'file': {
      /*
       * The evidence is assembled here, for the same reason Jira's is.
       *
       * `fileIssue()` hands `attachments` to an adapter's `attach()` as
       * `{ filename, blob }`, and a Blob cannot cross `chrome.runtime.sendMessage`
       * — it serialises as `{}`, silently. So the worker sends a *plan*
       * (`payload.attach`, the same shape Jira's `QUICK_ATTACH` uses) and the
       * files are read from IndexedDB on this side, where the database is.
       *
       * Only Shortcut and YouTrack declare `attach()` today; `fileIssue()`
       * ignores `attachments` for every other adapter, so sending them costs a
       * database read on a tracker that cannot use them. That is why the plan
       * is asked for rather than assumed: a caller that wants no attachments
       * sends none and nothing is read.
       */
      const plan = payload?.attach;
      const attachments = plan && payload.sessionId
        ? (await sessionFiles(payload.sessionId, plan)).files
        : undefined;
      return lib.fileIssue(tracker, cfg, { ...payload, attachments });
    }
    default:
      throw new Error(`Unknown tracker operation: ${op}`);
  }
}

/**
 * Text onto the clipboard, from the one page of this extension that can.
 *
 * `navigator.clipboard.writeText` wants a focused document and this one is
 * never focused — it is not rendered anywhere and cannot be. So it is a
 * textarea and `execCommand`, which is the route that still works from a
 * document nobody is looking at, and the reason `CLIPBOARD` is one of the
 * reasons this document is created with.
 *
 * It throws rather than answering `false`, because the caller's whole job is
 * to try the next door, and because the picker may only tell a tester
 * "copied ✓" when the text is really there.
 */
function copyToClipboard(text) {
  const field = document.createElement('textarea');
  field.value = String(text ?? '');
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    field.remove();
  }
  if (!copied) throw new Error('The clipboard refused the copy.');
  return { copied: true };
}

/**
 * The pointer, from the page being recorded.
 *
 * Its own listener, before the `UQA_OFF_` one, because it is the single
 * message here that legitimately comes from a content script — the position of
 * the mouse only exists in the page — and the main listener refuses a sender
 * with a tab for good reasons it should keep refusing for.
 *
 * Everything a content script could do with this is bounded by what it is:
 * three numbers and a boolean, held in one variable, overwritten by the next
 * report, never stored, and read only while a clip that asked for a cursor is
 * being composited. A page that floods it moves a drawn arrow around its own
 * recording, and nothing else.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'UQA_CURSOR') return false;
  if (sender?.id !== chrome.runtime.id) return false;
  // Only while something is being recorded. Outside a clip this is a message
  // with nowhere to go, and holding a position between clips would mean the
  // first frame of the next one carried the last frame of the last one's mouse.
  if (!active || active.kind === 'finishing') return false;
  pointer = {
    x: Number(msg.x) || 0,
    y: Number(msg.y) || 0,
    w: Number(msg.w) || 0,
    h: Number(msg.h) || 0,
    down: !!msg.down,
  };
  return false;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * The hidden document holds the camera, the microphone and every recorded
   * byte before it reaches the database, so it is the last place that should
   * take an instruction on trust. `sender.id` is set by the browser and cannot
   * be forged by the sender; a message from another extension carries that
   * extension's id, and one from a web page carries no `id` at all.
   *
   * `sender.tab` is refused as well: every legitimate caller here is the
   * service worker or one of our own extension pages, none of which is a tab.
   * A content script — which runs inside whatever page the tester is testing —
   * has no business starting a recording or opening a device.
   *
   * See `research/51d-legal-privacy-licensing.md` §7: "validate the sender on
   * every message, including from the extension itself".
   */
  if (sender?.id !== chrome.runtime.id) return false;
  if (sender?.tab) return false;
  if (!msg?.type?.startsWith('UQA_OFF_')) return false;

  const run = async () => {
    switch (msg.type) {
      case 'UQA_OFF_FORMATS':
        return supportedFormats();
      case 'UQA_OFF_PERMISSIONS':
        return devicePermissions();
      case 'UQA_OFF_AUDIO':
        return extractAudio(msg);
      case 'UQA_OFF_ROLL':
        if (active && msg.op === 'start') return { rolling: false, why: 'recording' }; // one tab, one capture
        return (rollMod = await import('./rolling.js')).rollOp(msg);
      case 'UQA_OFF_START':
        rollMod?.stopRoll(); // cap1022: one tab, one capture; a normal Record takes over from the rolling buffer
        return startRecording(msg);
      case 'UQA_OFF_STOP':
        return stopRecording(msg);
      /*
       * Starting and finishing both count as recording.
       *
       * Answering `recording: false` while a clip was opening its streams, or
       * while its bytes were still being written, is what let a second press
       * start a second capture and a second Stop begin a brand-new clip. The
       * phase travels with the answer so a surface can say which it is instead
       * of only that something is happening.
       */
      case 'UQA_OFF_STATE':
        return active
          ? {
              recording: true,
              starting: active.kind === 'starting',
              finishing: active.kind === 'finishing',
              id: active.id,
              mime: active.mime,
              startedAt: active.startedAt,
              frames: active.frameCount?.() ?? null,
              sources: active.sources || { tab: true },
            }
          : { recording: false, rescuable: !!pendingBlob, rolling: !!rollMod?.rolling() };
      case 'UQA_OFF_RESCUE':
        return rescuePending(msg);
      case 'UQA_OFF_IMAGE':
        return saveImage(msg);
      case 'UQA_OFF_STITCH':
        return stitchTiles(msg);
      case 'UQA_OFF_TRACKER':
        return offTracker(msg);
      case 'UQA_OFF_EXPORT':
        return offExport(msg);
      case 'UQA_OFF_COOKIEFMT':
        return offCookieFmt(msg);
      case 'UQA_OFF_JIRA':
        return offJira(msg);
      case 'UQA_OFF_RENDER':
        return offRender(msg);
      case 'UQA_OFF_POSTMAN':
        return offPostman(msg);
      case 'UQA_OFF_CUE':
        // The result sound, for a job that finished with no extension page to play it.
        window.UQASound?.configure({ on: !!msg.on, level: msg.level, scope: msg.scope });
        await window.UQASound?.ready?.().catch(() => {}); // the files are decoded once, on the first cue
        return { played: !!window.UQASound?.play(msg.name) };
      case 'UQA_OFF_PROBLEMS':
        return offPure('problems', msg);
      case 'UQA_OFF_BLACKBOX':
        return offPure('blackbox', msg);
      case 'UQA_OFF_SUITE':
        return offPure('suite', msg);
      case 'UQA_OFF_CROSSBROWSER':
        return offPure('crossbrowser', msg);
      case 'UQA_OFF_SCAN':
        return offPure('scan', msg);
      case 'UQA_OFF_FINE_PRINT': {
        const lib = await finePrintLib();
        const result = lib.finePrint({ ...msg.input, catalogue: await trackerCatalogue() });
        return { ...result, markdown: lib.finePrintMarkdown(result) };
      }
      case 'UQA_OFF_SPEC':
        return (await srsLib()).buildReverseSrs({ model: msg.model, session: msg.session, events: msg.events });
      case 'UQA_OFF_MARK':
        return markImage(msg);
      case 'UQA_OFF_COPY':
        return copyToClipboard(msg.text);
      default:
        throw new Error(`Unknown offscreen message: ${msg.type}`);
    }
  };

  run()
    .then((result) => sendResponse({ ok: true, result }))
    // `mediaId` and `stored` ride along so the worker can tell "the clip was
    // never made" from "the clip exists and could not be filed" — the second
    // has something to offer the tester and the first does not.
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String(err?.message || err),
        ...(err?.mediaId ? { mediaId: err.mediaId } : {}),
        ...(err?.stored === false ? { stored: false } : {}),
      })
    );
  return true; // async
});
