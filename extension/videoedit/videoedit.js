/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Editing a recorded clip.
 *
 * A screen recording arrives with the wrong first eight seconds, a customer's
 * name in the sidebar, and nothing pointing at the thing that went wrong. Until
 * now the only answer was "record it again", which in practice means the bug is
 * filed with the raw clip and whoever opens the ticket watches ninety seconds
 * to find the four that matter.
 *
 * Three decisions worth stating up front.
 *
 * **Nothing is painted until export.** Cuts, crop, shapes and the webcam patch
 * are one JSON edit list held in memory; the stage draws it over a plain
 * `<video>`. So undo is dropping the last entry, an edit costs nothing until it
 * is asked for, and the stored clip is untouched while the tester works.
 *
 * **The export is real time.** An extension has `MediaRecorder` and a canvas,
 * not a frame-accurate encoder: the kept segments are played once, each frame
 * is drawn through the crop and the overlays, and the canvas stream is
 * recorded. An export therefore takes about as long as the kept video lasts,
 * which the page says out loud rather than letting a tester wonder.
 *
 * **Moving the webcam inset is a patch, and it says so.** The inset is burned
 * into the pixels by `offscreen.js composite()` at record time; there is no
 * second layer to move. So the square is lifted, redrawn at the corner asked
 * for, and the space it came from is blurred. One honest line in the interface
 * beats a feature that pretends.
 *
 * Bytes go straight to IndexedDB, in both directions: `chrome.runtime`
 * messaging cannot carry a Blob, and a clip turned into an array of numbers is
 * three copies of a video for nothing.
 */

import { getMedia, putMedia, appendEvent } from '../core/db.js';
import * as Shapes from '../core/shapes.js';
import * as Obj from '../core/objects.js';
import { VIDEO_TYPES, byId } from '../core/file-types.js';
import { probeFormats, videoMime } from '../core/file-probe.js';
import { encodeGifAsync } from '../core/gif.js';

const $ = (id) => document.getElementById(id);
const t = (k, v) => QAWi18n.t(k, v);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: 'Background worker is not responding.' });
    });
  });
}

function say(text, tone = '') {
  $('status').textContent = text;
  $('status').removeAttribute('title');
  $('status').className = `status ${tone}`;
}

/** D-1010-140: a caught failure as the keyed sentence; the raw message is the tooltip only. */
async function sayFailure(err) {
  let d;
  try { d = (await import('../platform/worker-errors.js')).describeError(err, t); }
  catch { d = { text: t('common.err.unknown'), title: String(err?.message ?? '') }; }
  say(d.text, 'err');
  (await import('../platform/worker-errors.js')).attachDetails($('status'), d, t);
}

/* ── edit maths ────────────────────────────────────────────────────────────
   Everything above the next header is pure: numbers in, numbers out, no DOM
   and no editor state. `tools/test-videoedit.mjs` lifts this section out of
   the file and runs it for real, which is the only way the arithmetic under a
   canvas gets tested without a browser. Anything that reaches for an element
   does not belong here and would fail there loudly. */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Milliseconds as a clock a person reads: 0:07, 1:04, 12:30. */
function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** How much video survives the cuts. */
function keptDuration(segments) {
  return segments.reduce((sum, s) => sum + Math.max(0, s.to - s.from), 0);
}

/** The kept segment a source time falls in, or null if it was cut away. */
function segmentAt(segments, at) {
  return segments.find((s) => at >= s.from && at < s.to) || null;
}

/**
 * Split the segment a time falls inside, keeping both halves.
 *
 * A split is not an edit anybody can see — it is the thing a cut is made out
 * of, and it is separate so that "cut from here to here" is one removal rather
 * than two special cases at the ends.
 */
function splitAt(segments, at) {
  const out = [];
  for (const s of segments) {
    if (at > s.from && at < s.to) {
      out.push({ from: s.from, to: at }, { from: at, to: s.to });
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Drop a range of source time from the keep list.
 *
 * Every case falls out of one rule — keep the part of each segment that is
 * outside the range — so a cut that spans three segments, one that lands
 * inside a single segment and one that overhangs the end of the clip are the
 * same arithmetic. Zero-length remainders are dropped rather than kept as
 * empty blocks nobody can see or select.
 */
function removeRange(segments, from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out = [];
  for (const s of segments) {
    if (hi <= s.from || lo >= s.to) { out.push({ ...s }); continue; }
    if (lo > s.from) out.push({ from: s.from, to: lo });
    if (hi < s.to) out.push({ from: hi, to: s.to });
  }
  return out.filter((s) => s.to - s.from > 0);
}

/** Where the kept clip starts and ends: the two trim handles' positions. */
function trimBounds(segments, whole) {
  if (!segments.length) return { start: 0, end: whole };
  return { start: segments[0].from, end: segments[segments.length - 1].to };
}

/**
 * Move the clip's start and end handles (the keyboard route to a trim, 2.5.7).
 *
 * A handle moved inward removes what it passes over; moved outward it gives
 * back the edge, so a handle is always where the kept clip begins or ends and
 * cuts in the middle stay as they were. Anything under 1 ms wide is refused.
 */
function trimEdges(segments, start, end, whole) {
  const lo = clamp(Math.round(Math.min(start, end)), 0, whole);
  const hi = clamp(Math.round(Math.max(start, end)), 0, whole);
  let out = segments.map((s) => ({ ...s }));
  if (hi - lo < 1) return out;
  if (out.length && lo < out[0].from) out[0].from = lo;
  else out = removeRange(out, 0, lo);
  if (!out.length) return [{ from: lo, to: hi }];
  if (hi > out[out.length - 1].to) out[out.length - 1].to = hi;
  else out = removeRange(out, hi, whole);
  return out.length ? out : [{ from: lo, to: hi }];
}

/** The overlays whose [from, to) window covers a source time. */
function overlaysAt(overlays, at) {
  return overlays.filter((o) => at >= o.from && at < o.to);
}

/**
 * The crop, in whole source pixels, clamped to the frame.
 *
 * A canvas sized from a fractional drag is a canvas one pixel narrower than
 * the frames drawn into it, and `MediaRecorder` will not say so — it encodes a
 * stream whose first frame is a hair off and lets the container disagree with
 * the picture. Rounding here is what keeps the export honest, and an empty or
 * absent crop is the whole frame rather than a special case downstream.
 */
function cropRect(crop, w, h) {
  if (!crop) return { x: 0, y: 0, w, h };
  const x = clamp(Math.round(Math.min(crop.x, crop.x + crop.w)), 0, w);
  const y = clamp(Math.round(Math.min(crop.y, crop.y + crop.h)), 0, h);
  const cw = clamp(Math.round(Math.abs(crop.w)), 0, w - x);
  const ch = clamp(Math.round(Math.abs(crop.h)), 0, h - y);
  if (cw < 2 || ch < 2) return { x: 0, y: 0, w, h };
  return { x, y, w: cw, h: ch };
}

/**
 * Where the lifted webcam square lands, in the coordinates of the cropped
 * frame, for each corner the picker offers.
 *
 * One table and one clamp: a square bigger than the frame it is being put into
 * ends up at the origin rather than off the edge, which is what a tester who
 * cropped hard enough would otherwise get.
 */
function webcamTarget(corner, frame, box, margin = 16) {
  const right = frame.w - box.w - margin;
  const bottom = frame.h - box.h - margin;
  const at = {
    'top-left': { x: margin, y: margin },
    'top-right': { x: right, y: margin },
    'bottom-left': { x: margin, y: bottom },
    'bottom-right': { x: right, y: bottom },
  }[corner];
  if (!at) return null;
  return { x: clamp(Math.round(at.x), 0, Math.max(0, frame.w - box.w)), y: clamp(Math.round(at.y), 0, Math.max(0, frame.h - box.h)) };
}

/**
 * Where the webcam layer sits, in the coordinates of the cropped frame.
 *
 * A layer, unlike the patch below it, is a rectangle the tester dragged, so the
 * only arithmetic it needs is the one the patch also needed: a rectangle that
 * cannot leave the picture. Whole pixels for the same reason the crop is whole
 * pixels, and `null` when it is hidden, so every caller has one question to
 * ask instead of two.
 */
function camRect(layer, frame) {
  if (!layer || layer.hidden) return null;
  const w = clamp(Math.round(layer.w), 8, frame.w);
  const h = clamp(Math.round(layer.h), 8, frame.h);
  return {
    x: clamp(Math.round(layer.x), 0, Math.max(0, frame.w - w)),
    y: clamp(Math.round(layer.y), 0, Math.max(0, frame.h - h)),
    w,
    h,
    round: !!layer.round,
  };
}

/**
 * The layer the recorder's `geometry` asks for, as pixels in this frame.
 *
 * `geometry` is what was ticked in Settings, and the contract in research/106
 * calls it "a starting point, not a truth" — so it is turned into a rectangle
 * once, here, and from then on the tester's drag is the only truth. The
 * proportions are the frame's, not the camera's, because the layer is drawn
 * with `object-fit: cover` and a cam that disagrees is cropped rather than
 * stretched.
 */
function camLayerFrom(geometry, frame, margin = 16) {
  const size = clamp(Number(geometry?.size) || 22, 5, 60) / 100;
  const w = Math.max(8, Math.round(frame.w * size));
  const h = Math.max(8, Math.round((w * frame.h) / frame.w));
  const at = webcamTarget(geometry?.position || 'bottom-right', frame, { w, h }, margin)
    || { x: margin, y: margin };
  return { x: at.x, y: at.y, w, h, round: false, hidden: false };
}

/**
 * The time in the cam video that lines up with a time in the clip.
 *
 * `offsetMs` is the cam recorder's first chunk minus the main recorder's, so a
 * cam that started later is behind by exactly that much. Negative is clamped
 * away rather than passed on: `currentTime = -0.2` is silently ignored by every
 * browser, and a clip that starts by showing the wrong face is worse than one
 * that starts by showing the first frame twice.
 */
function camTimeFor(sourceMs, offsetMs) {
  return Math.max(0, sourceMs - (offsetMs || 0)) / 1000;
}

/**
 * The caps a GIF carries, from the catalogue's own note: 60 s, 800 px, silent.
 *
 * Stated as numbers here, and shown to the tester before the export starts,
 * because a GIF is the one format that cannot simply do what was asked: a
 * ninety-second 1440p clip is a 400 MB file no ticket system will take. So the
 * plan is computed up front and said out loud.
 */
const GIF_CAPS = { maxMs: 60000, maxWidth: 800, fps: 10 };

function gifPlan(frame, keptMs, caps = GIF_CAPS) {
  const scale = frame.w > caps.maxWidth ? caps.maxWidth / frame.w : 1;
  const ms = Math.min(Math.max(0, keptMs), caps.maxMs);
  return {
    w: Math.max(2, Math.round(frame.w * scale)),
    h: Math.max(2, Math.round(frame.h * scale)),
    ms,
    truncated: keptMs > caps.maxMs,
    fps: caps.fps,
    delayMs: Math.round(1000 / caps.fps),
    silent: true,
  };
}

/** The container to record in: the clip's own, when the browser will take it. */
function pickMime(type) {
  const wanted = String(type || '').split(';')[0];
  const tries = [wanted && `${wanted};codecs=vp9,opus`, wanted, 'video/webm;codecs=vp9,opus', 'video/webm'].filter(Boolean);
  for (const candidate of tries) {
    if (typeof MediaRecorder === 'undefined') break;
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return 'video/webm';
}

/** A stored MediaRecorder clip reports `video.duration === Infinity`; the length the recorder stored is the truth then (T-036). */
function clipDurationMs(videoSeconds, storedMs) {
  if (Number.isFinite(videoSeconds) && videoSeconds > 0) return Math.round(videoSeconds * 1000);
  return Number.isFinite(storedMs) && storedMs > 0 ? Math.round(storedMs) : 0;
}

/* ── editor state ─────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
const mediaId = params.get('id');

const video = $('video');
const camVideo = $('cam');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

let record = null;
let camRecord = null; // the companion, when the recorder gave the cam a track
let duration = 0; // ms
let cutFrom = null; // where "cut from here" was pressed
let formats = { images: {}, videos: {} }; // what this browser can really write

/** D-1010-160: an edit (crop, marks, trims) that is not saved yet. Closing the tab with this set asks first; a save clears it. */
let dirty = false;
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/** The whole edit, and the only thing an export reads. */
let edit = { crop: null, segments: [], overlays: [], webcam: null, camLayer: null, mute: false, format: 'webm' };

/** Snapshots, newest last. Undo is a pop, the same rule as the markup editor. */
const history = [];
/** What undo took off, newest last; any new edit ends this branch (T-072). */
const redoStack = [];
/** Consecutive nudges or trim steps on one thing are one undo, not forty. */
let run = { key: '', at: 0 };
const RUN_MS = 800;
const MIN_KEEP_MS = 100; // the trim handles never close the gap below this

let tool = 'arrow';
let shape = 'rect';
let colour = '#E2AE38';
let width = 4;
let fontSize = 24;
let blurStrength = 12;
let stepCounter = 0;
let drawing = null;
let selectedObj = -1; // index into edit.overlays of the picked object (ann1022)
let objDrag = null; // { last } while a picked object is dragged
let camDrag = null; // { mode: 'move'|'size', dx, dy }
let exporting = null; // { recorder, cancelled }

/** The shapes the picker offers: the shared engine's list, minus the modes. */
const MODES = new Set(['arrow', 'pen', 'highlight', 'text', 'step', 'redact', 'blur']);
const PICKABLE = Shapes.SHAPE_IDS.filter((id) => !MODES.has(id));

function remember() {
  dirty = true;
  history.push(JSON.stringify(edit));
  redoStack.length = 0;
  $('undo').disabled = false;
  $('redo').disabled = true;
}

/** remember() once per run of the same keyboard gesture. */
function rememberRun(key) {
  const now = performance.now();
  if (run.key !== key || now - run.at > RUN_MS) remember();
  run = { key, at: now };
}

function restore(json) {
  dirty = true;
  edit = JSON.parse(json);
  selectedObj = -1;
  run = { key: '', at: 0 };
  $('undo').disabled = !history.length;
  $('redo').disabled = !redoStack.length;
  syncControls();
  drawTimeline();
  render();
}

function undo() {
  const last = history.pop();
  if (!last) return;
  redoStack.push(JSON.stringify(edit));
  restore(last);
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  history.push(JSON.stringify(edit));
  restore(next);
}

/**
 * Move the newest mark (or the webcam layer, when its tool is armed) with the
 * arrow keys: the keyboard alternative to dragging (WCAG 2.5.7). One pixel;
 * Shift ten. One undo covers a run of presses.
 */
function nudge(dx, dy) {
  const target = tool === 'webcam' && edit.camLayer ? edit.camLayer : edit.overlays[selectedObj >= 0 ? selectedObj : edit.overlays.length - 1];
  if (!target) return false;
  const probe = JSON.parse(JSON.stringify(target));
  if (!Shapes.nudgeShape(probe, dx, dy, overlay.width, overlay.height)) return true; // at the edge: nothing to undo
  rememberRun(`nudge:${edit.overlays.indexOf(target)}`);
  Shapes.nudgeShape(target, dx, dy, overlay.width, overlay.height);
  say(t('videoedit.status.nudged', { x: Math.round(target.x ?? target.points[0].x), y: Math.round(target.y ?? target.points[0].y) }));
  render();
  return true;
}

/** The two trim handles. Their values are the edit list's own edges, in ms. */
function trim(which, value) {
  const { start, end } = trimBounds(edit.segments, duration);
  const next = which === 'start' ? [Math.min(value, end - MIN_KEEP_MS), end] : [start, Math.max(value, start + MIN_KEEP_MS)];
  const segments = trimEdges(edit.segments, next[0], next[1], duration);
  if (JSON.stringify(segments) === JSON.stringify(edit.segments)) return syncTrim();
  rememberRun(`trim:${which}`);
  edit.segments = segments;
  say(t('videoedit.status.trimmed', { from: fmtClock(next[0]), to: fmtClock(next[1]) }));
  drawTimeline();
  render();
}

function syncTrim() {
  const { start, end } = trimBounds(edit.segments, duration);
  for (const [id, v] of [['trim-start', start], ['trim-end', end]]) {
    const input = $(id);
    input.max = String(duration);
    input.value = String(v);
    input.setAttribute('aria-valuetext', fmtClock(v));
    $(`${id}-out`).textContent = fmtClock(v);
  }
}

/* ── the stage ────────────────────────────────────────────────────────────── */

/**
 * The overlay canvas, redrawn from the edit list.
 *
 * The video paints itself underneath; this is a sheet of glass over it. So the
 * preview never touches a frame, and a blur is drawn here as a marked box
 * rather than an actual blur: the canvas has no pixels of its own to destroy,
 * and the promise about blur is a promise about the exported file.
 */
function render(preview = null) {
  if (!video.videoWidth) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  octx.clearRect(0, 0, overlay.width, overlay.height);

  const at = video.currentTime * 1000;
  for (const o of overlaysAt(edit.overlays, at)) paint(Obj.resolveAt(o, at));
  const sel = edit.overlays[selectedObj];
  if (sel && at >= sel.from && at < sel.to) paintPick(Obj.resolveAt(sel, at));
  if (preview) paint(preview);
  if (edit.crop) paintCropOverlay(edit.crop);
  if (edit.webcam) paintWebcamMarker(edit.webcam.from);
  if (hasCamTrack() && tool === 'webcam') {
    const box = camRect(edit.camLayer, { w: overlay.width, h: overlay.height });
    if (box) paintWebcamMarker(box);
  }
  layoutCam();
  syncObjects();
}

/** The picked object's dashed box: preview only, never drawn by the export. */
function paintPick(s) {
  const b = Obj.extent(s);
  octx.save();
  octx.setLineDash([8, 6]);
  octx.strokeStyle = '#E2AE38';
  octx.lineWidth = 2;
  octx.strokeRect(b.x, b.y, b.w, b.h);
  octx.restore();
}

function paint(s) {
  Shapes.drawShape(octx, s, { blurRegion: markBlur });
}

/** A blur, shown rather than performed. The export is where it bites. */
function markBlur(s) {
  const b = Shapes.bounds(s);
  octx.save();
  octx.fillStyle = 'rgba(29, 32, 36, 0.55)'; /* literal: a scrim over the frame, not a themed surface */
  octx.fillRect(b.x, b.y, b.w, b.h);
  octx.setLineDash([8, 6]);
  octx.strokeStyle = s.colour;
  octx.lineWidth = 2;
  octx.strokeRect(b.x, b.y, b.w, b.h);
  octx.restore();
}

function paintCropOverlay(crop) {
  const r = Shapes.bounds(crop);
  octx.save();
  octx.fillStyle = 'rgba(0, 0, 0, 0.5)'; /* literal: the discarded edges of the frame */
  octx.beginPath();
  octx.rect(0, 0, overlay.width, overlay.height);
  octx.rect(r.x, r.y, r.w, r.h);
  octx.fill('evenodd');
  octx.strokeStyle = '#E2AE38'; /* literal: corn, over a frame that has no palette */
  octx.lineWidth = 2;
  octx.strokeRect(r.x, r.y, r.w, r.h);
  octx.restore();
}

function paintWebcamMarker(box) {
  octx.save();
  octx.setLineDash([6, 4]);
  octx.strokeStyle = '#2A7A3B'; /* literal: guac, over a frame that has no palette */
  octx.lineWidth = 2;
  octx.strokeRect(box.x, box.y, box.w, box.h);
  octx.restore();
}

/* ── the webcam layer ─────────────────────────────────────────────────────── */

/** True when the recorder handed the webcam its own track. */
const hasCamTrack = () => !!(camRecord?.blob && edit.camLayer);

/**
 * Which of the two clips this is, in one line.
 *
 * The two are not variations of one feature, they are different products: a
 * clip whose recorder gave the webcam its own track has a layer that can be
 * moved, and a clip recorded before that has a face in its pixels and can only
 * be patched. A tester who is not told which one they are holding will try the
 * wrong gesture and conclude the feature is broken, so the page says it before
 * they touch anything, and the panel that cannot apply is not on screen.
 */
function describeMode() {
  const layer = !!camRecord?.blob;
  $('webcam-layer-panel').hidden = !layer;
  $('webcam-patch-panel').hidden = layer;
  const note = $('mode-note');
  if (layer) note.textContent = t('videoedit.mode.layer');
  else if (record?.webcam?.position || record?.sources?.webcam) note.textContent = t('videoedit.mode.baked');
  else note.textContent = '';
}

/**
 * Put the cam element where the edit says, in the video's own rendered box.
 *
 * Against the video's box and not the stage's: the stage is as wide as the
 * column and a letterboxed clip is not, so a layer laid out in percentages of
 * the stage would sit where the export never draws it. The overlay canvas is
 * exactly the video's box, so it is the ruler.
 */
function layoutCam() {
  if (!camRecord?.blob) { camVideo.hidden = true; return; }
  const box = camRect(edit.camLayer, { w: overlay.width || 1, h: overlay.height || 1 });
  camVideo.hidden = !box;
  if (!box) return;
  const shown = overlay.getBoundingClientRect();
  const frame = $('stage').getBoundingClientRect();
  const sx = shown.width / (overlay.width || 1);
  const sy = shown.height / (overlay.height || 1);
  camVideo.style.left = `${shown.left - frame.left + box.x * sx}px`;
  camVideo.style.top = `${shown.top - frame.top + box.y * sy}px`;
  camVideo.style.width = `${box.w * sx}px`;
  camVideo.style.height = `${box.h * sy}px`;
  camVideo.classList.toggle('is-round', !!box.round);
}

/** The cam follows the clip, never the other way round. */
function syncCam() {
  if (!camRecord?.blob) return;
  const want = camTimeFor(video.currentTime * 1000, camRecord.offsetMs);
  if (Math.abs(camVideo.currentTime - want) > 0.2) camVideo.currentTime = want;
  if (video.paused && !camVideo.paused) camVideo.pause();
  if (!video.paused && camVideo.paused) camVideo.play().catch(() => {});
}

/**
 * Is this press on the cam layer, and is it a move or a resize.
 *
 * The bottom-inline-end quarter of the rectangle resizes and the rest moves,
 * which is the whole gesture vocabulary a layer needs and the one every tester
 * already has from dragging a window.
 */
function camGrab(p) {
  const box = camRect(edit.camLayer, { w: overlay.width, h: overlay.height });
  if (!box) return null;
  if (p.x < box.x || p.y < box.y || p.x > box.x + box.w || p.y > box.y + box.h) return null;
  const corner = Math.min(40, box.w / 3, box.h / 3);
  const sizing = p.x > box.x + box.w - corner && p.y > box.y + box.h - corner;
  return { mode: sizing ? 'size' : 'move', dx: p.x - box.x, dy: p.y - box.y };
}

/** Source pixels, not CSS pixels — the video is displayed scaled to fit. */
function at(e) {
  const box = overlay.getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) / box.width) * overlay.width,
    y: ((e.clientY - box.top) / box.height) * overlay.height,
  };
}

/** A new overlay's window: from the playhead to the end of the clip. */
function windowNow() {
  return { from: Math.round(video.currentTime * 1000), to: duration };
}

const MARKS = new Set(['tick', 'cross', 'question', 'exclaim', 'dot']);

/** The tools that stamp where they are put (text, step, marks), by a press or by Enter. True when `p` was taken by one. */
function stampAt(p) {
  if (tool === 'text') { placeText(p); return true; }
  if (tool === 'step') {
    remember();
    stepCounter += 1;
    edit.overlays.push({ tool: 'step', x: p.x, y: p.y, n: stepCounter, colour, width, fontSize, ...windowNow() });
    render();
    return true;
  }
  if (tool === 'shape' && MARKS.has(shape)) {
    remember();
    edit.overlays.push({ tool: shape, x: p.x, y: p.y, colour, width, fontSize, ...windowNow() });
    render();
    return true;
  }
  return false;
}

/** A finished drag, or the box a key press places (T-060): the crop, the webcam box, or one more overlay. */
function finishDrawn(done) {
  const b = Shapes.bounds(done);
  if (tool === 'crop') {
    if (b.w > 8 && b.h > 8) { remember(); edit.crop = { x: b.x, y: b.y, w: b.w, h: b.h }; }
  } else if (tool === 'webcam') {
    if (b.w > 8 && b.h > 8) {
      remember();
      edit.webcam = { from: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }, to: $('webcam-corner').value || null, patch: 'blur' };
      say(t('videoedit.status.webcamBox'));
    }
  } else if (Math.abs(done.w) > 3 || Math.abs(done.h) > 3) {
    remember();
    edit.overlays.push(done);
  }
  render();
}

/** Enter on the focused stage: the current tool, placed at the centre without a pointer (WCAG 2.1.1, 2.5.7). Arrows move it, + and - size it. */
function keyPlace() {
  if (!video.videoWidth || exporting || (tool === 'webcam' && hasCamTrack())) return;
  const c = Shapes.keyboardBox(overlay.width, overlay.height);
  if (stampAt({ x: c.x + c.w / 2, y: c.y + c.h / 2 })) return;
  const geometry = tool === 'shape' ? shape : tool;
  finishDrawn({ tool: geometry, x: c.x, y: c.y, w: c.w, h: c.h, colour, width, fontSize, strength: blurStrength, ...windowNow() });
}

function keySize(factor) {
  const target = edit.overlays[edit.overlays.length - 1];
  if (!target) return false;
  const probe = JSON.parse(JSON.stringify(target));
  if (!Shapes.resizeShape(probe, factor, overlay.width, overlay.height)) return true; // at the edge, or a mark: nothing to undo
  rememberRun(`size:${edit.overlays.indexOf(target)}`);
  Shapes.resizeShape(target, factor, overlay.width, overlay.height);
  say(t('videoedit.status.sized'));
  render();
  return true;
}

overlay.addEventListener('pointerdown', (e) => {
  if (!video.videoWidth || exporting) return;
  const p = at(e);

  if (tool === 'select' || tool === 'erase') {
    const now = video.currentTime * 1000;
    const view = edit.overlays.map((o) => Obj.resolveAt(o, now));
    const i = Obj.hitTest(view, p, (_o, k) => now >= edit.overlays[k].from && now < edit.overlays[k].to);
    if (tool === 'erase') { if (i >= 0) removeObject(i); return; }
    selectedObj = i;
    if (i >= 0) { remember(); overlay.setPointerCapture(e.pointerId); objDrag = { last: p }; }
    render();
    return;
  }

  // A real layer is moved, not drawn: the webcam tool over a clip with its own
  // cam track grabs the rectangle instead of starting a new one.
  if (tool === 'webcam' && hasCamTrack()) {
    const grab = camGrab(p);
    if (grab) {
      remember();
      overlay.setPointerCapture(e.pointerId);
      camDrag = grab;
      return;
    }
  }

  // The press is taken from the canvas entirely for the text tool, the same fix as the markup
  // editor: its default action moves focus off the input the tick the input
  // is given focus, and the blur handler then commits an empty label.
  if (tool === 'text') e.preventDefault();
  if (stampAt(p)) return;

  overlay.setPointerCapture(e.pointerId);
  const geometry = tool === 'shape' ? shape : tool;
  drawing = { tool: geometry, x: p.x, y: p.y, w: 0, h: 0, colour, width, fontSize, strength: blurStrength, ...windowNow() };
});

overlay.addEventListener('pointermove', (e) => {
  if (objDrag) {
    const p = at(e);
    Obj.dragAt(edit.overlays[selectedObj], video.currentTime * 1000, p.x - objDrag.last.x, p.y - objDrag.last.y);
    objDrag.last = p;
    render();
    return;
  }
  if (camDrag) {
    const p = at(e);
    const layer = edit.camLayer;
    if (camDrag.mode === 'move') {
      layer.x = p.x - camDrag.dx;
      layer.y = p.y - camDrag.dy;
    } else {
      layer.w = Math.max(8, p.x - layer.x);
      layer.h = Math.max(8, p.y - layer.y);
    }
    render();
    return;
  }
  if (!drawing) return;
  const p = at(e);
  drawing.w = p.x - drawing.x;
  drawing.h = p.y - drawing.y;
  if (tool === 'crop' || tool === 'webcam') render();
  else render(drawing);
  if (tool === 'crop') paintCropOverlay(drawing);
  if (tool === 'webcam') paintWebcamMarker(Shapes.bounds(drawing));
});

overlay.addEventListener('pointerup', () => {
  if (objDrag) { objDrag = null; return; }
  if (camDrag) {
    camDrag = null;
    edit.camLayer = camRect(edit.camLayer, { w: overlay.width, h: overlay.height }) || edit.camLayer;
    $('cam-size').value = String(Math.round((edit.camLayer.w / overlay.width) * 100));
    $('cam-size-out').textContent = t('videoedit.camLayer.percent', { pct: $('cam-size').value });
    say(t('videoedit.status.camMoved'));
    render();
    return;
  }
  if (!drawing) return;
  const done = drawing;
  drawing = null;
  finishDrawn(done);
});

/**
 * The text tool's box.
 *
 * Lifted from the markup editor with its bug fixes intact: the guard flag that
 * stops the opening click committing an empty label, the deferred focus, and
 * the idempotent finish so Enter does not commit twice.
 */
function placeText(p) {
  const input = $('text-input');
  const box = overlay.getBoundingClientRect();
  input.value = '';
  input.hidden = false;
  input.style.left = `${(p.x / overlay.width) * box.width + overlay.offsetLeft}px`;
  input.style.top = `${(p.y / overlay.height) * box.height + overlay.offsetTop}px`;

  let focused = false;
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    input.hidden = true;
    if (keep && text) {
      remember();
      edit.overlays.push({ tool: 'text', x: p.x, y: p.y, text, colour, width, fontSize, ...windowNow() });
      render();
    }
  };
  input.onfocus = () => { focused = true; };
  input.onblur = () => { if (focused) finish(true); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) finish(true);
    if (e.key === 'Escape') finish(false);
  };
  requestAnimationFrame(() => { if (!done) input.focus(); });
}

/* ── objects: pick, erase, window, keyframes (ann1022) ─────────────────────── */

const nowMs = () => Math.round(video.currentTime * 1000);

function removeObject(i) {
  remember();
  edit.overlays.splice(i, 1);
  selectedObj = -1;
  say(t('videoedit.obj.erased'));
  render();
}

function objLabel(o) {
  if (o.tool === 'text') return `"${o.text}"`;
  const k = `annotate.shapes.${o.tool}.label`;
  const l = t(k);
  return l && l !== k ? l : o.tool;
}

/** The object list under the timeline and the panel for the picked one. Rebuilt only when what it shows changed. */
let objSig = '';
function syncObjects() {
  const sel = edit.overlays[selectedObj];
  $('obj-panel').hidden = !sel;
  const sig = JSON.stringify([edit.overlays.map((o) => [o.tool, o.text, o.from, o.to, o.keys && o.keys.map((k) => k.t)]), selectedObj, duration]);
  if (sig !== objSig) {
    objSig = sig;
    const track = $('obj-track');
    track.textContent = '';
    edit.overlays.forEach((o, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'obj-row';
      row.setAttribute('aria-pressed', String(i === selectedObj));
      const name = document.createElement('span');
      name.className = 'obj-name';
      name.textContent = objLabel(o);
      const lane = document.createElement('span');
      lane.className = 'obj-lane';
      const bar = document.createElement('span');
      bar.className = 'obj-span';
      bar.style.insetInlineStart = `${(o.from / (duration || 1)) * 100}%`;
      bar.style.width = `${((o.to - o.from) / (duration || 1)) * 100}%`;
      lane.append(bar);
      for (const k of o.keys || []) {
        const tick = document.createElement('span');
        tick.className = 'obj-key';
        tick.style.insetInlineStart = `${(k.t / (duration || 1)) * 100}%`;
        lane.append(tick);
      }
      row.append(name, lane);
      row.addEventListener('click', () => { selectedObj = i; objSig = ''; render(); });
      track.append(row);
    });
  }
  if (sel && sel.tool === 'text') {
    $('obj-text-row').hidden = false;
    const input = $('obj-text');
    if (document.activeElement !== input) input.value = Obj.resolveAt(sel, nowMs()).text ?? '';
  } else $('obj-text-row').hidden = true;
}

function wireObjects() {
  const sel = () => edit.overlays[selectedObj];
  const setEdge = (which) => () => {
    const o = sel(); if (!o) return;
    remember();
    if (which === 'from') o.from = Math.min(nowMs(), o.to - 100); else o.to = Math.max(nowMs(), o.from + 100);
    say(t('videoedit.obj.window', { from: fmtClock(o.from), to: fmtClock(o.to) }));
    objSig = ''; render();
  };
  $('obj-start').addEventListener('click', setEdge('from'));
  $('obj-end').addEventListener('click', setEdge('to'));
  const key = (text) => {
    const o = sel(); if (!o) return;
    const now = nowMs();
    if (now < o.from || now >= o.to) return say(t('videoedit.obj.outside'), 'err');
    remember();
    const cur = Obj.resolveAt(o, now), a = Obj.anchor(cur);
    Obj.setKey(o, now, { x: a.x, y: a.y, text: text ?? cur.text });
    say(t('videoedit.obj.keyed', { at: fmtClock(now) }));
    objSig = ''; render();
  };
  $('obj-key').addEventListener('click', () => key());
  $('obj-remove').addEventListener('click', () => { if (sel()) removeObject(selectedObj); });
  $('obj-text').addEventListener('change', (e) => key(e.target.value));
}

/* ── the timeline ─────────────────────────────────────────────────────────── */

function drawTimeline() {
  const strip = $('timeline');
  strip.textContent = '';
  if (!duration) return;
  for (const s of edit.segments) {
    const block = document.createElement('span');
    block.className = 'timeline-block';
    block.style.insetInlineStart = `${(s.from / duration) * 100}%`;
    block.style.width = `${((s.to - s.from) / duration) * 100}%`;
    strip.append(block);
  }
  const head = document.createElement('span');
  head.className = 'timeline-head';
  head.style.insetInlineStart = `${((video.currentTime * 1000) / duration) * 100}%`;
  strip.append(head);

  $('kept-note').textContent = t('videoedit.timeline.kept', {
    kept: fmtClock(keptDuration(edit.segments)),
    whole: fmtClock(duration),
  });
  syncTrim();
}

function syncControls() {
  $('mute').checked = !!edit.mute;
  $('webcam-corner').value = edit.webcam?.to || '';
  $('times').textContent = t('videoedit.times.window', { from: fmtClock(windowNow().from), to: fmtClock(duration) });
}

/* ── the export ───────────────────────────────────────────────────────────── */

/** One number, in one place, so all three exports report progress alike. */
function progress(pct) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  $('progress').value = clamped;
  $('progress-out').textContent = t('videoedit.progress.percent', { pct: clamped });
}

/**
 * One frame, through the whole edit, into a canvas.
 *
 * Shared by all three exports on purpose: a GIF that showed different overlays
 * from the MP4 of the same edit would be a second renderer to keep in step,
 * and the still is the one frame the tester is looking at or it is worth
 * nothing.
 */
function drawFrameInto(ctx, frame, ms, scratch) {
  ctx.drawImage(video, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  patchWebcam(ctx, frame, scratch);
  drawCamLayer(ctx, frame);
  for (const o of overlaysAt(edit.overlays, ms)) {
    Shapes.drawShape(ctx, shiftToCrop(Obj.resolveAt(o, ms), frame), {
      blurRegion: (sh) => Shapes.downscaleBlur(ctx, shiftToCrop(sh, frame), ctx.canvas, scratch),
    });
  }
}

/**
 * The webcam, drawn from its own video.
 *
 * `cover` and not a stretch: a camera's aspect ratio is its own, and a face
 * squashed into a rectangle the tester happened to drag is the kind of output
 * that gets the whole feature turned off. The rectangle is cropped to instead,
 * from the middle, which is where a face is.
 */
function drawCamLayer(ctx, frame) {
  if (!hasCamTrack() || !camVideo.videoWidth) return;
  const box = camRect(
    { ...edit.camLayer, x: edit.camLayer.x - frame.x, y: edit.camLayer.y - frame.y },
    { w: frame.w, h: frame.h }
  );
  if (!box) return;
  const sw = camVideo.videoWidth;
  const sh = camVideo.videoHeight;
  const scale = Math.max(box.w / sw, box.h / sh);
  const cw = box.w / scale;
  const ch = box.h / scale;
  ctx.save();
  if (box.round) {
    ctx.beginPath();
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(camVideo, (sw - cw) / 2, (sh - ch) / 2, cw, ch, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** The canvas every export draws into, at the crop's size. */
function exportCanvas(frame) {
  const out = document.createElement('canvas');
  out.width = frame.w;
  out.height = frame.h;
  return out;
}

/** Whichever export the format picker is on. */
function runExport() {
  const frame = cropRect(edit.crop, video.videoWidth, video.videoHeight);
  if (edit.format === 'png') return exportStill(frame);
  if (edit.format === 'gif') return exportGif(frame);
  return exportVideo(frame);
}

/**
 * The frame on screen, as a PNG. One canvas, one `toBlob`, no re-encode.
 *
 * It is here because half of "put it in the ticket" means a picture, and
 * making somebody re-encode ninety seconds of video to get one is the kind of
 * tax that sends them back to the Snipping Tool.
 */
function exportStill(frame) {
  const out = exportCanvas(frame);
  drawFrameInto(out.getContext('2d'), frame, video.currentTime * 1000, () => document.createElement('canvas'));
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('videoedit.status.stillFailed')))), 'image/png');
  });
}

/**
 * Play what is kept, draw every frame through the edit, record the canvas.
 *
 * The recorder is paused across a seek rather than left running: a seek takes
 * whatever it takes, and a running recorder would encode that pause as frozen
 * video in the middle of the clip. Resuming only once `seeked` has fired is
 * what makes a three-cut export land seam to seam.
 */
async function exportVideo(frame) {
  const out = exportCanvas(frame);
  const ctx = out.getContext('2d');
  const scratch = () => document.createElement('canvas');

  const stream = out.captureStream(30);
  let audio = null;
  if (!edit.mute) {
    try {
      audio = new AudioContext();
      const dest = audio.createMediaStreamDestination();
      audio.createMediaElementSource(video).connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    } catch {
      // A clip with no audio track at all: recording the picture is still the
      // edit the tester asked for, so this is not a failure.
      audio = null;
    }
  }

  // The chosen container's codec string, and the clip's own only as a floor:
  // the picker never offers a format this browser answered no to, so falling
  // through here is a browser that changed its mind mid-session.
  const mime = videoMime(edit.format) || pickMime(record.type);
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  exporting = { recorder, cancelled: false, stop: false };
  const whole = keptDuration(edit.segments) || 1;
  let drawn = 0;

  video.muted = true; // the page stays quiet; the recorder takes the audio
  recorder.start(1000);

  for (const segment of edit.segments) {
    if (exporting.cancelled) break;
    await seekTo(segment.from / 1000);
    if (recorder.state === 'paused') recorder.resume();
    await playThrough(segment, (ms) => {
      drawFrameInto(ctx, frame, ms, scratch);
      drawn += 1000 / 30;
      progress((drawn / whole) * 100);
    });
    if (recorder.state === 'recording' && !exporting.cancelled) recorder.pause();
  }

  if (recorder.state !== 'inactive') recorder.stop();
  await stopped;
  if (audio) await audio.close().catch(() => {});
  video.muted = false;

  const cancelled = exporting.cancelled;
  exporting = null;
  if (cancelled) return null;
  return new Blob(chunks, { type: mime });
}

/**
 * The same playback, sampled into a GIF by `core/gif.js`.
 *
 * No browser writes a GIF, so there is no recorder here and no audio: the
 * frames are taken at ten a second off the same export canvas, scaled to the
 * cap, and encoded afterwards. The caps are computed before a frame is taken
 * and shown by the picker, because a GIF is the one format that cannot simply
 * do what was asked.
 */
async function exportGif(frame) {
  const out = exportCanvas(frame);
  const ctx = out.getContext('2d');
  const scratch = () => document.createElement('canvas');
  const plan = gifPlan(frame, keptDuration(edit.segments));

  const small = exportCanvas({ w: plan.w, h: plan.h });
  const sctx = small.getContext('2d');
  const frames = [];

  exporting = { recorder: null, cancelled: false, stop: false };
  video.muted = true;
  let taken = 0; // ms of kept video already sampled
  let nextAt = 0;

  for (const segment of edit.segments) {
    if (exporting.cancelled || exporting.stop) break;
    await seekTo(segment.from / 1000);
    const base = taken;
    await playThrough(segment, (ms) => {
      const elapsed = base + (ms - segment.from);
      if (elapsed < nextAt) return;
      nextAt = elapsed + plan.delayMs;
      drawFrameInto(ctx, frame, ms, scratch);
      sctx.drawImage(out, 0, 0, plan.w, plan.h);
      frames.push({
        data: sctx.getImageData(0, 0, plan.w, plan.h).data,
        width: plan.w,
        height: plan.h,
        delayMs: plan.delayMs,
      });
      progress((elapsed / (plan.ms || 1)) * 100);
      // The cap stops the playback and not only the sampling: a five minute
      // clip would otherwise play out in full to produce sixty seconds of GIF.
      if (elapsed >= plan.ms && exporting) exporting.stop = true;
    });
    taken = base + Math.max(0, segment.to - segment.from);
  }

  video.muted = false;
  const cancelled = exporting?.cancelled;
  exporting = null;
  if (cancelled) return null;
  if (!frames.length) throw new Error(t('videoedit.status.noFrames'));
  say(t('videoedit.status.encodingGif', { n: frames.length }));
  const bytes = await encodeGifAsync(frames, { loop: 0 });
  return new Blob([bytes], { type: 'image/gif' });
}

/** An overlay's geometry in the cropped frame's coordinates. */
function shiftToCrop(o, frame) {
  const moved = { ...o, x: o.x - frame.x, y: o.y - frame.y };
  if (o.points) moved.points = o.points.map((p) => ({ x: p.x - frame.x, y: p.y - frame.y }));
  return moved;
}

/**
 * Lift the webcam square and cover the hole.
 *
 * The blur happens first and reads the canvas; the lift reads the video, which
 * no blur has touched. Doing it the other way round would blur the copy.
 */
function patchWebcam(ctx, frame, scratch) {
  const patch = edit.webcam;
  if (!patch?.to) return;
  const box = patch.from;
  const target = webcamTarget(patch.to, { w: frame.w, h: frame.h }, { w: box.w, h: box.h });
  if (!target) return;
  Shapes.downscaleBlur(ctx, { x: box.x - frame.x, y: box.y - frame.y, w: box.w, h: box.h, strength: 14 }, ctx.canvas, scratch);
  ctx.drawImage(video, box.x, box.y, box.w, box.h, target.x, target.y, box.w, box.h);
}

function seekTo(seconds) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - seconds) < 0.001) return resolve();
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = seconds;
  });
}

/** One segment, drawn frame by frame until the playhead passes its end. */
function playThrough(segment, onFrame) {
  return new Promise((resolve) => {
    const step = () => {
      const ms = video.currentTime * 1000;
      if (exporting?.cancelled || exporting?.stop || ms >= segment.to || video.ended) {
        video.pause();
        return resolve();
      }
      onFrame(ms);
      requestAnimationFrame(step);
    };
    video.play().then(step, step);
  });
}

/* ── the format picker ────────────────────────────────────────────────────── */

/**
 * The formats this browser can actually write, plus the two it cannot.
 *
 * Built at run time from `core/file-types.js` rather than written into the
 * HTML, because "can this build encode H.264" is a run-time answer and a menu
 * that guesses it produces a file named `.mp4` that is not one, discovered by
 * whoever opens the ticket. A format that answered no stays in the list,
 * disabled, with the reason on it: a tester who cannot see MP4 at all assumes
 * the product forgot it.
 */
function buildFormatPicker() {
  const select = $('format');
  select.textContent = '';
  for (const type of VIDEO_TYPES) {
    const option = document.createElement('option');
    option.value = type.id;
    const available = !!formats.videos[type.id];
    option.textContent = available ? type.label : `${type.label} · ${t('videoedit.format.unavailable')}`;
    option.disabled = !available;
    option.title = available ? type.note : t('videoedit.format.unavailableWhy');
    select.append(option);
  }
  // The still is not in the catalogue: it is not a way of storing this clip,
  // it is a different artefact made from one frame of it.
  const still = document.createElement('option');
  still.value = 'png';
  still.textContent = t('videoedit.format.png');
  still.title = t('videoedit.format.pngNote');
  select.append(still);

  if (![...select.options].some((o) => o.value === edit.format && !o.disabled)) {
    edit.format = [...select.options].find((o) => !o.disabled)?.value || 'webm';
  }
  select.value = edit.format;
  showFormatNote();
}

/**
 * What the chosen format will do, said before the run and not after it.
 *
 * The GIF caps are the reason this exists: sixty seconds, eight hundred pixels
 * and no sound are not failures to report at the end, they are the shape of
 * the file the tester is about to wait for.
 */
function showFormatNote() {
  const note = $('format-note');
  const type = byId(VIDEO_TYPES, edit.format);
  if (edit.format === 'png') {
    note.textContent = t('videoedit.format.pngNote');
  } else if (edit.format === 'gif') {
    const plan = gifPlan(cropRect(edit.crop, video.videoWidth || 2, video.videoHeight || 2), keptDuration(edit.segments));
    note.textContent = `${type.note} ${t('videoedit.format.gifCaps', {
      secs: Math.round(plan.ms / 1000),
      w: plan.w,
      fps: plan.fps,
    })}`;
  } else {
    note.textContent = type?.note || '';
  }
  // A GIF has no audio track to drop, so the control says so rather than
  // sitting there implying a choice that does not exist.
  const silent = edit.format === 'gif' || edit.format === 'png';
  $('mute').disabled = silent;
  $('mute').closest('.check').classList.toggle('is-moot', silent);
}

/* ── saving ───────────────────────────────────────────────────────────────── */

async function save(blob, asCopy) {
  const id = asCopy ? `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` : record.id;
  const label = asCopy ? t('videoedit.save.copyLabel', { label: record.label || '' }) : record.label;
  // A PNG of one frame is a screenshot, and filing it as a recording would put
  // a still into the Recordings folder and the clip count. A GIF stays a
  // recording: it is the whole edit, and the report already knows a recording
  // can be an image.
  const kind = blob.type === 'image/png' ? 'screenshot' : record.kind;
  await putMedia({
    ...record,
    id,
    kind,
    blob,
    type: blob.type,
    bytes: blob.size,
    label,
    // A still has no length, and a companion track is not the still's.
    durationMs: kind === 'screenshot' ? 0 : record.durationMs,
    webcamTrackId: kind === 'screenshot' ? null : record.webcamTrackId,
    edited: true,
    ts: asCopy ? Date.now() : record.ts,
  });

  if (asCopy && record.sessionId) {
    // A copy nobody can see in the timeline is a copy nobody finds again.
    await appendEvent({
      sessionId: record.sessionId,
      kind,
      ts: Date.now(),
      mediaId: id,
      captureId: id,
      imageType: blob.type,
      bytes: blob.size,
      text: label,
      edited: true,
    });
  }
  // Shaped like the worker's own broadcast, so an open report refreshes.
  chrome.runtime.sendMessage({ type: 'UQA_MEDIA_CHANGED' }, () => void chrome.runtime.lastError);
  return id;
}

async function exportAndSave() {
  // A still is one frame, so an edit that kept nothing still has one to give.
  if (!edit.segments.length && edit.format !== 'png') return say(t('videoedit.status.nothingKept'), 'err');
  const asCopy = $('save-copy').checked;
  if (!asCopy && !window.confirm(t('videoedit.save.confirmReplace'))) return;

  $('export').disabled = true;
  $('cancel').hidden = false;
  $('progress-row').hidden = false;
  say(t('videoedit.status.exporting'));
  try {
    const blob = await runExport();
    if (!blob) return say(t('videoedit.status.cancelled'));
    const id = await save(blob, asCopy);
    dirty = false; // stored, so leaving (or the reload below) loses nothing
    say(asCopy ? t('videoedit.status.savedCopy') : t('videoedit.status.savedInPlace'), 'ok');
    if (!asCopy) setTimeout(() => location.replace(`videoedit.html?id=${encodeURIComponent(id)}`), 700);
  } catch (err) {
    sayFailure(err);
  } finally {
    $('export').disabled = false;
    $('cancel').hidden = true;
    $('progress-row').hidden = true;
  }
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

function wireRange(id, set, label) {
  const input = $(id);
  const out = $(`${id}-out`);
  const show = () => { set(Number(input.value)); out.textContent = label(Number(input.value)); };
  input.addEventListener('input', show);
  show();
}

function armTool(next) {
  tool = next;
  if (next !== 'select' && selectedObj >= 0) { selectedObj = -1; render(); }
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === next));
  }
}

function buildShapePicker() {
  const select = $('shape');
  select.textContent = '';
  for (const id of PICKABLE) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = t(`annotate.shapes.${id}.label`);
    select.append(option);
  }
  select.value = shape;
}

(async function boot() {
  await QAWi18n.ready();
  if (!(await Shapes.ensureCanvasFont())) say(t('common.canvasFontMissing'), 'err'); // a system face must not be burned into the image unannounced
  QAWi18n.onChange(() => {
    QAWi18n.apply();
    buildShapePicker();
    buildFormatPicker();
    describeMode();
    drawTimeline();
    syncControls();
  });

  buildShapePicker();
  try {
    formats = probeFormats();
  } catch {
    // No canvas or no MediaRecorder at all: WebM is the floor Chrome always has.
    formats = { images: {}, videos: { webm: true, gif: true } };
  }
  buildFormatPicker();
  $('format').addEventListener('change', (e) => {
    edit.format = e.target.value;
    showFormatNote();
  });

  $('cam-hidden').addEventListener('change', (e) => {
    if (!edit.camLayer) return;
    remember();
    edit.camLayer.hidden = e.target.checked;
    render();
  });
  $('cam-round').addEventListener('change', (e) => {
    if (!edit.camLayer) return;
    remember();
    edit.camLayer.round = e.target.checked;
    render();
  });
  $('cam-size').addEventListener('input', (e) => {
    if (!edit.camLayer) return;
    const pct = Number(e.target.value);
    $('cam-size-out').textContent = t('videoedit.camLayer.percent', { pct });
    // Resized about its own top-left, so a layer parked in a corner stays in it.
    edit.camLayer.w = Math.max(8, Math.round((overlay.width * pct) / 100));
    edit.camLayer.h = Math.max(8, Math.round((edit.camLayer.w * overlay.height) / overlay.width));
    render();
  });

  wireObjects();
  $('shape').addEventListener('change', (e) => { shape = e.target.value; armTool('shape'); });
  $('colour').addEventListener('input', (e) => { colour = e.target.value.toUpperCase(); });
  wireRange('width', (v) => (width = v), (v) => `${v}px`);
  wireRange('fontsize', (v) => (fontSize = v), (v) => `${v}px`);
  wireRange('blur', (v) => (blurStrength = v), (v) => t(v < 8 ? 'videoedit.blurStrength.light' : v < 18 ? 'videoedit.blurStrength.medium' : 'videoedit.blurStrength.heavy'));

  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.addEventListener('click', () => armTool(btn.dataset.tool));
  }

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('trim-start').addEventListener('input', (e) => trim('start', Number(e.target.value)));
  $('trim-end').addEventListener('input', (e) => trim('end', Number(e.target.value)));
  $('reset').addEventListener('click', () => {
    remember();
    edit = {
      crop: null,
      segments: [{ from: 0, to: duration }],
      overlays: [],
      webcam: null,
      // Where the recorder put it, not where the last edit did.
      camLayer: camRecord ? camLayerFrom(camRecord.geometry, { w: overlay.width, h: overlay.height }) : null,
      mute: false,
      format: edit.format,
    };
    stepCounter = 0;
    syncControls();
    drawTimeline();
    render();
    say(t('videoedit.status.reset'));
  });
  $('export').addEventListener('click', exportAndSave);
  $('cancel').addEventListener('click', () => {
    if (!exporting) return;
    exporting.cancelled = true;
    if (exporting.recorder.state !== 'inactive') exporting.recorder.stop();
    say(t('videoedit.status.cancelled'));
  });

  $('mute').addEventListener('change', (e) => { remember(); edit.mute = e.target.checked; });
  $('webcam-corner').addEventListener('change', (e) => {
    if (!edit.webcam) return say(t('videoedit.status.webcamFirst'), 'err');
    remember();
    edit.webcam.to = e.target.value || null;
  });

  $('only-visible').addEventListener('click', () => {
    const block = segmentAt(edit.segments, video.currentTime * 1000);
    const last = edit.overlays[edit.overlays.length - 1];
    if (!block || !last) return say(t('videoedit.status.noMarkYet'), 'err');
    remember();
    last.from = block.from;
    last.to = block.to;
    say(t('videoedit.status.markWindowed', { from: fmtClock(block.from), to: fmtClock(block.to) }));
    render();
  });

  $('play').addEventListener('click', () => {
    if (video.paused) video.play();
    else video.pause();
  });

  $('scrub').addEventListener('input', (e) => {
    video.currentTime = (Number(e.target.value) / 1000) * (duration / 1000);
  });

  $('cut-start').addEventListener('click', () => {
    cutFrom = Math.round(video.currentTime * 1000);
    $('cut-end').disabled = false;
    say(t('videoedit.status.cutFrom', { at: fmtClock(cutFrom) }));
  });

  $('cut-end').addEventListener('click', () => {
    if (cutFrom === null) return;
    const to = Math.round(video.currentTime * 1000);
    remember();
    // Split first, so a cut inside one block leaves two blocks and not a gap
    // the keep list cannot describe.
    edit.segments = removeRange(splitAt(edit.segments, cutFrom), cutFrom, to);
    say(t('videoedit.status.cut', { from: fmtClock(Math.min(cutFrom, to)), to: fmtClock(Math.max(cutFrom, to)) }));
    cutFrom = null;
    $('cut-end').disabled = true;
    drawTimeline();
    render();
  });

  video.addEventListener('timeupdate', () => {
    $('clock').textContent = `${fmtClock(video.currentTime * 1000)} / ${fmtClock(duration)}`;
    $('scrub').value = String(duration ? Math.round((video.currentTime * 1000 * 1000) / duration) : 0);
    if (!exporting) { drawTimeline(); render(); syncControls(); }
    syncCam();
  });

  for (const event of ['play', 'pause', 'seeked']) video.addEventListener(event, syncCam);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && key === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObj >= 0 && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); removeObject(selectedObj); }
    else if (document.activeElement === overlay && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); keyPlace(); }
    else if (document.activeElement === overlay && /^[-+=]$/.test(e.key)) { if (keySize(e.key === '-' ? 0.9 : 1.1)) e.preventDefault(); }
    else if (e.key.startsWith('Arrow') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(document.activeElement?.tagName || '')) { // a focused control keeps its arrow keys
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if ((dx || dy) && nudge(dx, dy)) e.preventDefault();
    }
  });

  if (!mediaId) return say(t('videoedit.status.noMediaId'), 'err');

  record = await getMedia(mediaId);
  if (!record?.blob) return say(t('videoedit.status.notStored'), 'err');

  $('subtitle').textContent = record.label || t('videoedit.subtitle.default');
  document.title = t('common.pageTitle', { name: record.label || t('videoedit.subtitle.default') });

  // The companion track, when there is one. Read by its id off the parent and
  // not by searching for a role, because the parent is the only thing that
  // knows which companion is its own.
  if (record.webcamTrackId) {
    camRecord = await getMedia(record.webcamTrackId);
    if (camRecord?.blob) camVideo.src = URL.createObjectURL(camRecord.blob);
    else camRecord = null;
  }

  // The webcam square, as the recording stored it. New clips carry it; an
  // older one does not, and then the tester draws the box themselves rather
  // than the editor guessing from Settings.
  if (!camRecord && record.webcam?.position) say(t('videoedit.status.webcamKnown'));

  video.src = URL.createObjectURL(record.blob);
  await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  duration = clipDurationMs(video.duration, record.durationMs);
  edit.segments = [{ from: 0, to: duration }];

  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  if (camRecord) {
    edit.camLayer = camLayerFrom(camRecord.geometry, { w: overlay.width, h: overlay.height });
    camVideo.hidden = false;
    $('cam-size').value = String(Math.round((edit.camLayer.w / overlay.width) * 100));
    $('cam-size-out').textContent = t('videoedit.camLayer.percent', { pct: $('cam-size').value });
    await new Promise((resolve) => {
      camVideo.addEventListener('loadedmetadata', resolve, { once: true });
      camVideo.addEventListener('error', resolve, { once: true });
    });
    syncCam();
  }
  // The clip's own container is the default, so an export changes nothing
  // nobody asked to change.
  edit.format = VIDEO_TYPES.find((v) => (record.type || '').includes(v.id) && formats.videos[v.id])?.id || edit.format;
  describeMode();
  buildFormatPicker();
  addEventListener('resize', layoutCam);
  syncControls();
  drawTimeline();
  render();
  say(t('videoedit.status.ready', { w: video.videoWidth, h: video.videoHeight, length: fmtClock(duration) }));

  const settings = await send({ type: 'UQA_GET_SETTINGS' });
  if (settings.ok) {
    window.UQASound?.configure({ on: !!settings.result.soundEnabled, level: (settings.result.soundVolume ?? 70) / 100, scope: settings.result.soundScope });
    window.UQASound?.wire(document);
  }
})();
