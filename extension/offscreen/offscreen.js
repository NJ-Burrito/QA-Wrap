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

import { putMedia, putMediaPart, putMediaPending, mediaParts, assembleMedia, clearMediaParts } from '../core/db.js';
import { tabVideo, videoBitrate, CAPTURE_EDGE } from '../core/file-probe.js';
import { sha256Hex } from '../core/integrity.js';
import { partWriter } from './part-writer.js';
import { cancelled, devicePermissions, extraSources, extractAudio, pickMime, releaseElements, supportedFormats, warnDisk, withHash, within } from './offscreen-base.js';
import { companionRecord, composite, displayStream, extForMime, lockTargets, mixAudio, pointer, setPointer, startCamRecorder } from './offscreen-composite.js';
import { startGifCapture } from './offscreen-gif.js';
import { markImage, saveImage, stitchTiles } from './offscreen-image.js';
import { copyToClipboard, finePrintLib, offCookieFmt, offExport, offJira, offPostman, offPure, offRender, offTracker, srsLib, trackerCatalogue } from './offscreen-libs.js';

let rollMod = null; // offscreen/rolling.js, loaded on first use (cap1022)
// The rolling buffer's start while it is still opening its tab capture. A Record that lands in that window waits for it (the
// buffer sees `active` and lets go), then stops it: before 3.8.3 the buffer won the tab and the Record failed (recording.mjs step 10).
let rollBusy = null;
let rollCancel = false;
// One lifecycle, idle -> starting -> recording -> finishing -> idle (3.8.3). A worker Stop that lands before its start
// reached this document sets `cancelNext` (UQA_OFF_CANCEL); one that lands during `starting` sets `claim.cancel`.
// The start checks it after every wait and ends in a coded refusal, so a Stop never leaves a phantom recording.
let cancelNext = false;

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

async function startRecording({
  streamId, sessionId, format, fps, quality, mic, tabAudio, webcam, webcamPosition, webcamSize,
  desktop = false, systemAudio = false, cursor = false, label, view = null,
}) {
  if (active) throw new Error('Already recording. Stop the current clip first.');
  if (cancelNext) { cancelNext = false; throw cancelled(); }

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
  const claim = { kind: 'starting', id, sessionId, startedAt, stoppedAt: null, mime: null, sources: { tab: !desktop, screen: desktop }, cancel: false };
  const live = () => { if (claim.cancel) throw cancelled(); };
  // Settles when this start does, either way: a Stop pressed while the clip is starting waits on it (stopRecording).
  let begun = () => {};
  claim.begun = new Promise((res) => { begun = () => res(undefined); });
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
    setPointer(null);
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
    if (rollBusy) { await rollBusy; await rollMod?.stopRoll(); } // a buffer still opening the tab gives it up first
    await rollMod?.stopRoll(); // cap1022: one tab, one capture; a normal Record takes over from the rolling buffer (its encoders released first)
    live();
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
    live();
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
    live();

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
    // The frames a tab capture settles on, from the tab's real current size
    // (view.w/h, DIPs from the tabs API: blind to a stale capture shape and to
    // page emulation): that shape fitted up to the capture's edge, which is
    // what Chrome sends, or 1:1 at the tab's monitor scale (view.px measured in
    // the tab / DIPs; this document's own ratio is the primary monitor's).
    // And the page as it sees itself at Record (view.px, CSS size x its DPR):
    // DevTools device mode, where the capture follows the emulated screen.
    // The lock takes whichever of these the capture actually delivers; a later
    // change (emulation turned off) is a mid-clip resize, fitted inside.
    const hint = desktop ? null : lockTargets(view, edge, devicePixelRatio);
    mixer = composite({ feed, fps: fps || 15, cursor: drawnCursor, hint, urgent: () => claim.cancel });
    // The encoder starts only on a locked frame: a canvas sized after start is
    // the defect itself, so no picture in 5 s is a refusal, not a clip.
    const frame = await Promise.race([mixer.ready, new Promise((res) => setTimeout(res, 5000, null))]);
    if (!frame) throw Object.assign(new Error('The tab or screen sent nothing to record. Nothing was saved; press Record again.'), { code: 'NO_PICTURE' });
    live(); // the last check: from recorder.start() on, a Stop files the clip
    const videoTrack = mixer.stream.getVideoTracks()[0];

    // One audio track, mixed if there are two. See mixAudio.
    const audioSources = [
      ...(gotAudio ? stream.getAudioTracks() : []),
      ...(micStream ? micStream.getAudioTracks() : []),
    ];
    const mixed = mixAudio(audioSources);
    audioCtx = mixed.ctx;

    const recorded = new MediaStream([videoTrack, ...(mixed.track ? [mixed.track] : [])]);

    const vbps = videoBitrate(quality, sourceTrack.getSettings?.().width, sourceTrack.getSettings?.().height);
    const recorder = new MediaRecorder(recorded, { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: 128_000 });

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
      // Test-only seam (3.8.4), as the webcam's: 'rec-mp4-silent' swallows the MP4's chunks, so the understudy runs.
      if (!e.data?.size || (/^video\/mp4/.test(mime) && 'rec-mp4-silent' === globalThis.__qawFault)) return;
      firstChunkAt ??= Date.now();
      parts.add(e.data, partSeq++);
      dropBackup(); // the MP4 is writing: the understudy is not needed
    };

    /*
     * A WebM understudy for the MP4's first seconds (3.8.4, rule 4).
     *
     * Live [V, A5]: while another browser was encoding H.264, Chrome's MP4 recorder took 46 frames in 4 s and wrote
     * nothing (no chunk at 2 s, 0 bytes at stop even after requestData), so the clip was refused as empty and lost;
     * CPU load alone never did it. A second recorder on the same tracks, in WebM (software VP8/9), keeps its chunks
     * in memory and is dropped at the MP4's first bytes. If the MP4 has written nothing by 5 s or by Stop, the
     * understudy becomes the clip (its chunks go to disk, the record says WebM) and the MP4 is stopped.
     */
    const backupMime = /mp4/i.test(mime) ? pickMime('webm') : null;
    let backup = null;
    let backupChunks = [];
    let backupDone = null;
    let promoted = false;
    if (backupMime) {
      try {
        backup = new MediaRecorder(recorded, { mimeType: backupMime, videoBitsPerSecond: vbps, audioBitsPerSecond: 128_000 });
        backupDone = new Promise((res) => { backup.onstop = res; backup.onerror = res; });
        backup.ondataavailable = (e) => {
          if (!e.data?.size) return;
          if (!promoted) return void backupChunks.push(e.data);
          firstChunkAt ??= Date.now();
          parts.add(e.data, partSeq++);
        };
      } catch { backup = null; } // no understudy: the MP4 alone, as before
    }
    function dropBackup() {
      if (!backup || promoted) return;
      const b = backup;
      backup = null;
      backupChunks = [];
      try { b.stop(); } catch { /* already inactive */ }
    }
    const promote = () => {
      if (!backup || promoted) return false;
      promoted = true;
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null; // the MP4 is no longer this clip
      try { recorder.stop(); } catch { /* already inactive */ }
      for (const c of backupChunks) { firstChunkAt ??= Date.now(); parts.add(c, partSeq++); }
      backupChunks = [];
      return true;
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
    try { backup?.start(1000); } catch { backup = null; }
    const watch = backup && setTimeout(() => { if (firstChunkAt == null) promote(); }, 5000);
    // The clip runs from here, not from the press: the frame lock above can
    // take up to 5 s, and a duration counted from the press would claim it.
    const recordingFrom = Date.now();

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
        // A coded item the popup and the notification say in the tester's language (3.8.3); the screen clip goes on.
        console.warn('[QA Wrap] webcam not saved:', String(err?.message || err), 'track', camStream.getVideoTracks()[0]?.readyState);
        refused.push('webcam-not-saved');
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
      startedAt: recordingFrom,
      // Same geometry, carried on the in-memory record too — `filing.js` and
      // anything else that reads `active` mid-recording sees the same shape
      // `putMediaPending` already wrote, rather than needing to re-derive it.
      ...(camGeometry ? { webcam: camGeometry } : {}),
      // The second recorder, so `stopRecording` can stop it, flush it and file
      // it beside the picture. Null whenever there is no camera, or when
      // starting it failed — which is reported and survivable.
      camRecorder,
      lock: frame,
      // Read by `companionRecord()` for `offsetMs`. A getter and not a value:
      // the first chunk has not arrived yet at the moment this object is built.
      get firstChunkAt() { return firstChunkAt; },
      // Filled in by whichever ends the recording first — Chrome's own "Stop
      // sharing", the encoder failing, or the tester's Stop — and read for the
      // clip's duration.
      stoppedAt: claim.stoppedAt,
      failed: null,
      get mime() { return promoted ? backupMime : mime; },
      /*
       * The extension, from the catalogue, decided here.
       *
       * The record used to store `blob.type`, which for a MediaRecorder is the
       * full codec string — `video/webm;codecs=vp8,opus`. `filing.js` split it
       * on `/` and took what followed, so every clip was saved as
       * `something.webm;codecs=vp8,opus`, a filename no operating system will
       * open. Naming the extension at the source removes the guess.
       */
      get ext() { return promoted ? extForMime(backupMime, 'webm') : ext; },
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
      stop: async () => {
        clearTimeout(watch);
        // Nothing from the MP4 yet: ask it for what it holds (requestData first: stopped before its first chunk it
        // writes 0 bytes; never after one, it cuts), and if that is still nothing the understudy is the clip.
        if (backup && !promoted && firstChunkAt == null) {
          if (recorder.state !== 'inactive') {
            try { recorder.requestData(); } catch { /* inactive */ }
            try { recorder.stop(); } catch { /* inactive */ }
            await within(done, 5000);
          }
          if (firstChunkAt == null) promote();
        }
        if (promoted) {
          try { if (backup.state !== 'inactive') backup.stop(); } catch { /* inactive */ }
          await within(backupDone, 5000);
          return { ok: true };
        }
        dropBackup();
        if (recorder.state !== 'inactive') {
          if (firstChunkAt == null) try { recorder.requestData(); } catch { /* inactive */ }
          recorder.stop();
        }
        return done;
      },
    };
    return { id, format, mime, via: 'MediaRecorder', sources: active.sources, refused, lock: frame };
  } catch (err) {
    abort();
    claim.error = err; // a Stop waiting on this start answers with the start's own (coded, translated) refusal
    throw err;
  } finally {
    begun();
  }
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
  /*
   * Stop while the clip is still starting (3.8.3, rule 4). Every surface already shows "recording" from the claim on,
   * so refusing here ("still starting") lost the clip: the start finished afterwards and the tester's Stop was gone
   * (recording.mjs step 5, the mid-clip resize clip never stored). Now the start is told to lock on the frame it has
   * and finish, and this Stop then stops and files it. A start that fails instead had recorded nothing, and says so.
   */
  if (active.kind === 'starting') {
    // Cancels the start (it ends in REC_CANCELLED, nothing recorded); a start already past its last check records,
    // and this Stop then files it like any other.
    const claim = active;
    claim.cancel = true;
    await claim.begun;
    if (active?.id !== claim.id) throw claim.error?.code ? claim.error : cancelled();
  }
  if (active.kind === 'finishing') {
    throw new Error('That clip is already being saved. It will appear in the report on its own.');
  }

  const session = active;
  active = { ...session, kind: 'finishing' };
  // ponytail: a clip stopped the moment it began has no encoded frame yet (B: "Nothing of that recording was written
  // to disk"); 600 ms lets the encoder write some. A frame counter would be exact.
  const young = 600 - (Date.now() - (session.startedAt || 0));
  if (session.kind === 'recorder' && young > 0) await new Promise((res) => setTimeout(res, young));

  // Now, not after the encoder has flushed — and not at all if the source
  // already ended or the recorder failed, because those moments are the honest
  // ones and they have already been stamped.
  session.stoppedAt ??= Date.now();

  let outcome = { ok: true };
  let tail = null;
  try {
    // A GIF's stop() answers with the finished Blob; a recorder's answers with
    // whether the encoder got to the end.
    // Bounded (3.8.3, B: one Stop hung 270 s): an encoder that never answers files what reached the disk.
    const result = await within(session.stop(), 15000, { ok: false, error: 'The encoder did not finish; the clip is saved up to its last written part.' });
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
    // Awaited to its `stop` event (3.8.3): its last `dataavailable` comes after stop() returns, and flushing before it
    // filed the companion without its final chunk (758 bytes of a 5 s face, live).
    await within(Promise.resolve().then(() => session.camRecorder?.stop()).catch(() => {}), 5000);
    await within(Promise.resolve(session.camRecorder?.flushed?.()).catch(() => {}), 10000);

    await within(session.flushed?.()?.catch(() => {}), 10000);
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
      // A camera that failed mid-clip is kept up to the failure and says so on its own record (3.8.3).
      const storedCam = await assembleMedia({ ...companion, ...(cam.failed ? { failed: cam.failed } : {}), blob: camTail.size ? camTail : null }, sha256Hex);
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
    if (!webcamTrackId) console.warn('[QA Wrap] webcam not saved: 0 bytes;', webcamProblem);
  }
  // `null` and not absent: the editor reads a missing field as "this clip was
  // recorded before the webcam had its own track, so the face is baked in", and
  // a clip recorded today is not that clip whatever happened to its camera.
  record.webcamTrackId = webcamTrackId;
  // Coded for the popup (EN/AR): no companion at all is WEBCAM_NOT_SAVED, one cut short by a failure is WEBCAM_SHORT.
  if (webcamProblem) Object.assign(record, { webcamProblem, webcamCode: webcamTrackId ? 'WEBCAM_SHORT' : 'WEBCAM_NOT_SAVED' });

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
      setPointer(null);
    }
    return {
      ...record,
      stored: false,
      bytes: rescue.size,
      error:
        `The clip was recorded but could not be stored: ${String(err?.message || err).replace(/\.$/, '')}. ` +
        (rescue.size
          ? 'It is still in memory. Press "Rescue the clip" to write it to your downloads before closing the browser.'
          : 'Nothing of it survived.'),
    };
  } finally {
    if (active?.id === session.id) {
      active = null;
      // The pointer belongs to the clip, not to the document. Dropped with it,
      // so nothing of where the tester's mouse was outlives the recording.
      setPointer(null);
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
  setPointer({
    x: Number(msg.x) || 0,
    y: Number(msg.y) || 0,
    w: Number(msg.w) || 0,
    h: Number(msg.h) || 0,
    down: !!msg.down,
  });
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
        // 'stop' from the worker comes BEFORE it mints the Record's stream id: an id minted while the buffer's own
        // capture is still opening is invalidated when that capture starts ("Invalid state", recording.mjs step 10).
        if (msg.op === 'stop') { rollCancel = true; await rollBusy; }
        if (msg.op === 'start') rollCancel = false;
        {
          const op = import('./rolling.js').then((m) => (rollMod = m).rollOp(msg, () => !!active || rollCancel));
          if (msg.op === 'start') rollBusy = op.catch(() => {}); // settled stays settled: awaiting it later costs a tick
          return op;
        }
      case 'UQA_OFF_START':
        return startRecording(msg); // claims synchronously: a Stop right behind it finds `starting`
      case 'UQA_OFF_CANCEL':
        if (msg.clear) cancelNext = false;
        else if (!active) cancelNext = true;
        else if (active.kind === 'starting') active.cancel = true;
        return { ok: true };
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
              recording: active.kind !== 'starting', // shown as recording only once it is (3.8.3)
              starting: active.kind === 'starting',
              finishing: active.kind === 'finishing',
              id: active.id,
              mime: active.mime,
              startedAt: active.startedAt,
              frames: active.frameCount?.() ?? null,
              sources: active.sources || { tab: true },
              lock: active.lock || null, // how the frame size locked (by, ms, path): read by the live checks
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
        ...(err?.code ? { code: err.code } : {}),
        ...(err?.mediaId ? { mediaId: err.mediaId } : {}),
        ...(err?.stored === false ? { stored: false } : {}),
      })
    );
  return true; // async
});
