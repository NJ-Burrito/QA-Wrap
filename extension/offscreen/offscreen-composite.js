/* QA Wrap — offscreen document: pointer drawing, frame compositing, webcam companion recorder, display stream (split from offscreen.js). */
import { putMediaPart, putMediaPending } from '../core/db.js';
import { VIDEO_TYPES, byId } from '../core/file-types.js';
import { lockFrame, fitRect } from '../core/file-probe.js';
import { partWriter } from './part-writer.js';
import { pickMime, warnDisk } from './offscreen-base.js';

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
const setPointer = (v) => { pointer = v; };

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

/**
 * The frame sizes a tab capture may settle on (see startRecording); the clip locks at the size delivered.
 * Pure: tools/test-recording-frame-lock.mjs lifts it.
 *
 * A tab capture delivers the tab's shape either fitted up to the capture edge or 1:1 at its monitor scale, and Chrome
 * picks one per capture and holds it from the first frame (3.8.3, live: the same 1100x900 window gave 1358x1008 in
 * one run and 1920x1424 in the next, never stepping). Either locks as delivered (sharp; the size never changes
 * within a clip). DevTools device mode (the page's shape is not the tab's): the capture is the page's shape at a scale
 * nobody can predict (390x844 at DPR 3 gave 854x1846 against 888x1920 computed), so it matches by shape (`shape`), and locks as delivered.
 */
function lockTargets(view, edge, ownDpr) {
  if (!(view?.w > 0 && view?.h > 0)) return null;
  const [pw, ph] = view.px || [];
  const dsf = pw > 0 ? pw / view.w : ownDpr || 1;
  const fit = (w, h, k) => ({ w: Math.round(w * k), h: Math.round(h * k) });
  const up = fit(view.w, view.h, edge / Math.max(view.w, view.h));
  const out = /** @type {any[]} */ ([up, fit(view.w, view.h, Math.min(dsf, edge / view.w, edge / view.h))]);
  if (pw > 0 && ph > 0 && Math.abs((pw / ph) / (view.w / view.h) - 1) > 0.02) {
    const page = fit(pw, ph, edge / Math.max(pw, ph));
    out.push({ ...page, shape: true });
  }
  return out;
}

function composite({ feed, fps, cursor = false, hint = null, urgent = () => false }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let timer = null;
  let stopped = false;
  let locked = null;
  let seen = null;
  const path = []; // the sizes the feed went through before the lock, with when (reported, never read)
  let first = 0;
  let ready;
  const settled = new Promise((res) => { ready = res; });
  // Frames the feed really presented: a draw tick on a still page repeats the
  // last frame and proves nothing about the size settling.
  let frames = 0;
  const onFrame = () => { frames++; if (!stopped) feed.requestVideoFrameCallback(onFrame); };
  if (typeof feed.requestVideoFrameCallback === 'function') feed.requestVideoFrameCallback(onFrame);
  const counted = () => (typeof feed.requestVideoFrameCallback === 'function' ? frames : null);

  const draw = () => {
    if (stopped) return;
    // Nothing to draw yet. Painting a 1280x720 grey rectangle here is what put
    // a guessed geometry into the recording before the real one arrived.
    if (!feed.videoWidth) return;
    // Sized ONCE and never again (rec-resize-1027): a canvas that followed the
    // feed handed the encoder a new size whenever the tab changed shape, and
    // the MP4 kept the first size's SPS, so every later frame was undecodable
    // smear. The size is taken once it holds for 3 NEW frames, or 0.6 s on a
    // still page that sends none, or 4 s after the first frame whatever it is:
    // the first frames of a tab capture can be a passing size (CSS pixels
    // before the HiDPI step). Later shapes are fitted inside, centred.
    // `ready` gates recorder.start().
    //
    // `hint` (3.8.3) is the sizes a tab capture settles on, known before any
    // frame from the tab's real current size: its pixels fitted to the capture
    // edge (Chrome scales tab capture up to it) or 1:1. One of them locks at
    // once; any other size (CSS pixels before the HiDPI step, the shape before
    // a window drag) is stale and is waited out whatever the frame rule says,
    // so a still page whose step comes late (700 ms, 3 s) never locks soft or
    // misshapen. 4 s stays the bound. No hint (a screen, a tab that refused
    // the measurement): the frame rule alone.
    if (!locked) {
      const now = Date.now();
      first ||= now;
      const n = counted();
      if (!seen || seen.w !== feed.videoWidth || seen.h !== feed.videoHeight) {
        seen = { w: feed.videoWidth, h: feed.videoHeight, n: 0, f: n, t: now };
        if (path.length < 8) path.push(`${seen.w}x${seen.h}@${now - first}`);
      }
      seen.n++; // draw ticks: the count where the browser cannot report frames
      const held = n === null ? seen.n : n - seen.f + 1;
      const hit = hint?.find((b) => (b.shape
        ? Math.abs((seen.w / seen.h) / (b.w / b.h) - 1) <= 0.01
        : Math.abs(seen.w - b.w) <= 3 && Math.abs(seen.h - b.h) <= 3));
      const at = !!hit;
      // `urgent`: Stop was pressed while this clip was still starting. Lock on what is here now, so the encoder runs
      // and the clip is filed (rule 4): a fitted, slightly soft clip beats a recording that disappears.
      const hurry = urgent();
      if (!at && !hurry && now - first < 4000 && (hint || (held < 3 && now - seen.t < 600))) return;
      locked = lockFrame(feed.videoWidth, feed.videoHeight); // the size Chrome delivers, 1:1, never resampled up
      canvas.width = locked.w;
      canvas.height = locked.h;
      // How it locked, reported on the start reply: `rvfc` is the count of
      // presented frames (null where requestVideoFrameCallback is missing; 0
      // where it exists but never fires, as in a never-rendered document).
      ready({ ...locked, ms: now - first, by: at ? 'hint' : hurry ? 'stop' : now - first >= 4000 ? 'bound' : held >= 3 ? 'frames' : 'still', rvfc: n, hint, path });
    }
    // The sizes after the lock too (reported on the state, never read): a capture that steps later is fitted inside.
    if (path.length < 8 && (seen.w !== feed.videoWidth || seen.h !== feed.videoHeight)) {
      seen = { w: feed.videoWidth, h: feed.videoHeight };
      path.push(`${seen.w}x${seen.h}@${Date.now() - first}`);
    }
    const r = fitRect(feed.videoWidth, feed.videoHeight, locked.w, locked.h);
    if (r.w < locked.w || r.h < locked.h) ctx.fillRect(0, 0, locked.w, locked.h);
    ctx.drawImage(feed, r.x, r.y, r.w, r.h);

    // The picture, and then the pointer over it. Nothing else is drawn: the
    // webcam is its own clip now, laid over this one at playback.
    if (cursor) drawPointer(ctx, r);
    // One frame per draw, never two closer than 0.9 of a tick (3.8.3): with `captureStream(fps)` Chrome chose when to
    // take a frame, and some clips held two frames closer than one frame period, which a decoder at the clip's rate
    // reads as one timestamp twice (ffmpeg: "non monotonically increasing dts to muxer in stream 0: 128 >= 128").
    const now = Date.now();
    if (now - lastFrame >= gap) { lastFrame = now; track?.requestFrame?.(); }
  };

  const stream = canvas.captureStream(0); // frames only when requested, above
  const track = stream.getVideoTracks()[0];
  const tickMs = Math.max(1, Math.round(1000 / (fps || 15)));
  const gap = tickMs * 0.9;
  let lastFrame = -Infinity;
  timer = setInterval(draw, tickMs);

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
  let mime = pickMime('mp4') || pickMime('webm');
  if (!mime) throw new Error('this browser has no encoder that could write it');

  const camId = `${id}_cam`;
  // Test-only fault seam (3.8.3): nothing in the extension sets `__qawFault`; a live harness sets it in this
  // document over CDP to drive the fallback below ('cam-mp4-start': the MP4 start throws) or the onerror
  // path ('cam-mp4-error': the started MP4 recorder fails at 3 s, after its first chunk; 'cam-mp4-error-early': at
  // 1.5 s, before it wrote a byte, so nothing is kept and the stop result says so). Unset, as in every real run, it does nothing.
  const fault = (m) => /^video\/mp4/.test(m) && globalThis.__qawFault;
  const open = (m) => { if (fault(m) === 'cam-mp4-start') throw new Error('forced cam MP4 start failure (__qawFault)'); const r = new MediaRecorder(new MediaStream([track]), {
    mimeType: m,
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
  }); r.start(2000); const f = fault(m); if (/^cam-mp4-error/.test(f || '')) setTimeout(() => { r.dispatchEvent(new Event('error')); r.stop(); }, f === 'cam-mp4-error' ? 3000 : 1500); return r; }; // as Chrome does: error, then the recorder stops
  // Started here, handlers attached below in the same task (no chunk can arrive before them). A second
  // hardware H.264 encoder beside the picture's can fail to come up (Blink "There was an error starting
  // the MediaRecorder", 1 run in 5 of tools/recording.mjs): the face is then written as WebM instead.
  let recorder;
  try { recorder = open(mime); } catch (err) {
    const alt = pickMime('webm');
    if (!alt || alt === mime) throw err;
    recorder = open((mime = alt));
  }
  const ext = extForMime(mime, 'mp4');

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
  recorder.onstop = () => settle(failed ? { ok: false, error: failed } : { ok: true });
  recorder.onerror = (e) => {
    failed = String(e?.error?.message || e?.error || 'The webcam recorder stopped with an error.');
    stoppedAt ??= Date.now();
    // Keep what it wrote (3.8.3): ask for the frames held before the first 2 s chunk, and settle on `stop`, which
    // follows the error and its last `dataavailable`. Nothing is broadcast: a dead camera does not end the clip.
    try { if (recorder.state === 'recording' && firstChunkAt == null) recorder.requestData(); } catch { /* already inactive */ }
  };
  // The same timeslice as the picture, so the two are chunked on the same
  // rhythm and `offsetMs` is a real measurement rather than an artefact of one
  // encoder flushing on a different schedule from the other.

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
        // requestData first while nothing has arrived [V, live probe]: Chrome's MP4 recorder stopped before its first
        // chunk writes 0 bytes, with it 45 KB. Once a chunk exists a plain stop() writes the rest.
        if (firstChunkAt == null) try { recorder.requestData(); } catch { /* inactive */ }
        try { recorder.stop(); } catch { settle({ ok: false, error: 'already inactive' }); }
      } else settle(failed ? { ok: false, error: failed } : { ok: true });
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

export { companionRecord, composite, displayStream, extForMime, lockTargets, mixAudio, pointer, setPointer, startCamRecorder };
