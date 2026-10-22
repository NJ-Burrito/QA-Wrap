/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The toolbar icon while a clip is recording: eight frames rendered once at Chrome's three sizes, cycled every 220 ms.
 * MV3 can kill the worker mid-frame, so `stop` restores the manifest icon from paths and the startup handler always calls it.
 * Geometry is ported from identity/tools/marks.mjs; 24 px and under uses the heavier ring variant.
 */

/** The mark, on a 64 grid. identity/tools/marks.mjs is the source of truth. */
export const G = {
  cx: 30,
  cy: 30,
  r: 17,
  stroke: 7,
  seam: 45,
  half: 28,
  check: [[36, 36], [42.5, 44], [55, 20]],
  nudge: [-2, 1],
  grid: 64,
  tileRadius: 14,
};

/**
 * The artwork, as the manifest icons carry it: variant A, the light plate with a dark ring and a terracotta check
 * (identity/icons/app-icon-small.svg, which icons/icon*.png are rendered from). One object, so a later recolour is one edit and
 * tools/test-action-icon-art.mjs holds it equal to the identity files. An earlier cut painted a terracotta tile with
 * limestone strokes here, and the toolbar swapped to that older mark the moment a session started.
 * A worker has no stylesheet to read a token from, hence literals.
 */
export const ART = Object.freeze({ plate: '#F1EFE9', ring: '#1D2024', check: '#B5432B' });
/** The limestone edge of the state badge is the plate colour. */
export const PAPER = ART.plate;
export const BADGE = '#8E5A10'; /* literal: --live's light value (D4, red=FAIL only). */

/** The sizes Chrome asks an action icon for. */
export const SIZES = [16, 32, 48];

/** Eight frames at 220 ms is a 1.76 s breath — the popup's 1.8 s, near enough. */
export const FRAMES = 8;
export const STEP_MS = 220;

/** The dot that says "recording" in the corner of the icon. */
export const BADGE_DOT = '●';

/** What the toolbar badge says, one meaning at a time: low disk (amber "!"), then the problem count, then the recording dot, then `mark`, then "NEW" (an update is waiting); empty (color null) when none applies. */
export function badgeFor({ disk = false, live = false, problems = 0, errors = 0, mark = '', update = false } = {}) {
  if (disk) return { text: '!', color: '#B7791F' };
  if (problems) return { text: problems > 99 ? '99+' : String(problems), color: errors ? '#B5321F' : '#B7791F' };
  if (live) return { text: mark || BADGE_DOT, color: '#6B7280' };
  return !mark && update ? { text: 'NEW', color: '#2F5D8A' } : { text: mark, color: null };
}

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * The check's opacity, frame by frame: 1 → 0.55 → 1, on a cosine so the turn
 * at each end is soft. A linear ramp reads as a blink; this reads as breath.
 */
export function frameOpacities(n = FRAMES) {
  const mid = (1 + 0.55) / 2;
  const amp = (1 - 0.55) / 2;
  return Array.from({ length: n }, (_, i) => Number((mid + amp * Math.cos((2 * Math.PI * i) / n)).toFixed(4)));
}

/**
 * Which variant a given size gets. The identity ships a heavier mark for
 * 16–24 px (icons/app-icon-small.svg); this is the same decision in code.
 */
export function variantFor(size) {
  return size <= 24 ? { weight: 8.5, r: 16, scale: 0.94 } : { weight: G.stroke, r: G.r, scale: 1 };
}

/** How much of the circle the ring actually draws — see marks.mjs `ringSweep`. */
export function ringSweep() {
  const a = -(G.half - G.seam) - 2 * G.seam + G.seam;
  const b = -(G.seam + G.half);
  return { startDeg: a, endDeg: b, sweep: 360 - ((((a - b) % 360) + 360) % 360) };
}

/** The check's three points, scaled about the ring's centre. */
export function checkPoints(scale = 1) {
  return G.check.map(([x, y]) => [G.cx + (x - G.cx) * scale, G.cy + (y - G.cy) * scale]);
}

/**
 * Paint one frame. Everything is in grid units and the context is scaled once,
 * so 16 px and 48 px are the same drawing rather than two of them.
 */
export function drawFrame(ctx, size, alpha) {
  const v = variantFor(size);
  const { startDeg, endDeg } = ringSweep();

  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.scale(size / G.grid, size / G.grid);

  ctx.fillStyle = ART.plate;
  ctx.beginPath();
  ctx.roundRect(0, 0, G.grid, G.grid, G.tileRadius);
  ctx.fill();

  ctx.translate(G.nudge[0], G.nudge[1]);
  ctx.lineWidth = v.weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The ring, drawn the long way round: `on()` in marks.mjs negates its angle
  // to get from the construction sheet's convention to the screen's, and the
  // arc is anticlockwise, which is what the SVG's sweep flag of 0 means.
  ctx.strokeStyle = ART.ring;
  ctx.beginPath();
  ctx.arc(G.cx, G.cy, v.r, rad(-startDeg), rad(-endDeg), true);
  ctx.stroke();

  // The check, and only the check, carries the breath. Like the small plate in the identity it sits in a plate-coloured
  // trench so it never touches the ring; the trench is opaque, the check breathes.
  const [s, m, e] = checkPoints(v.scale);
  const check = () => {
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(m[0], m[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
  };
  ctx.strokeStyle = ART.plate;
  ctx.lineWidth = v.weight * 2.3;
  check();
  ctx.strokeStyle = ART.check;
  ctx.lineWidth = v.weight;
  ctx.globalAlpha = alpha;
  check();
  ctx.globalAlpha = 1;

  ctx.restore();
  return ctx;
}

/**
 * A small state badge in the corner, with a 1 px contrasting edge so it
 * reads on both light and dark toolbars at 16 px. `dot` = recording,
 * `dash` = asleep, `triangle` = a problem occurred.
 */
export function drawBadge(ctx, size, kind = 'dot') {
  const r = size * 0.2, cx = size - r - 1, cy = size - r - 1;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PAPER;
  ctx.fillStyle = BADGE;
  if (kind === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.lineTo(cx - r, cy + r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'dash') {
    ctx.fillRect(cx - r, cy - r * 0.35, r * 2, r * 0.7);
    ctx.strokeRect(cx - r, cy - r * 0.35, r * 2, r * 0.7);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A real canvas, in a worker. Injectable so the frame maths can be tested. */
const offscreen = (size) => new OffscreenCanvas(size, size);

/**
 * Render the whole cycle: an array of `frames` entries, each one the
 * `{16, 32, 48}` shape chrome.action.setIcon wants.
 *
 * `make` exists so tools/test-motion.mjs can count and measure the frames on
 * Node, which has no OffscreenCanvas. Nothing else passes it.
 */
export function buildFrames({ make = offscreen, sizes = SIZES, frames = FRAMES } = {}) {
  return frameOpacities(frames).map((alpha) => {
    const set = {};
    for (const size of sizes) {
      const ctx = make(size).getContext('2d');
      drawFrame(ctx, size, alpha);
      drawBadge(ctx, size, 'dot');
      set[size] = ctx.getImageData(0, 0, size, size);
    }
    return set;
  });
}

/* ── the animation itself ─────────────────────────────────────────────────── */

let timer = null;
let cycle = null;
/** What the badge said before we borrowed it, so stopping gives it back. */
let borrowedBadge = null;

/** The manifest's own icon, read rather than repeated, so it cannot drift. */
function manifestIcon() {
  return chrome.runtime.getManifest()?.action?.default_icon || null;
}

/**
 * The microphone, said in words on the toolbar for as long as it is open.
 *
 * A breathing icon says "recording", not *what*. The mic is the source with
 * criminal exposure attached (eleven US states require every party's
 * consent; Germany's §201 StGB), and Apple's App Review 2.5.14 wants a
 * persistent indicator, not a one-time message. The title survives the
 * popup closing and the worker dying, and resets from the manifest at stop.
 */
const MIC_TITLE = 'QA Wrap: recording, MICROPHONE LIVE';

export async function setMicLive(live) {
  const title = live
    ? MIC_TITLE
    : chrome.runtime.getManifest().action?.default_title || 'QA Wrap';
  await chrome.action.setTitle({ title }).catch(() => {});
  return title;
}

export async function startRecordingIcon({ mic = false } = {}) {
  // Outside the idempotence guard on purpose: `syncRecordingIcon` runs on every
  // worker start over a clip that is already going, and the title is exactly
  // the thing a torn-down worker forgot.
  await setMicLive(mic);
  if (timer) return false;

  // Rendered once and kept. Eight frames across three sizes is ~13 KB of
  // pixels; re-rendering them every 220 ms would be the one expensive thing
  // in here.
  if (!cycle) cycle = buildFrames();

  let i = 0;
  const paint = () => {
    const imageData = cycle[i++ % cycle.length];
    // A setIcon that loses the race with the worker dying is not an error the
    // tester needs to hear about.
    chrome.action.setIcon({ imageData }).catch(() => {});
  };
  paint();
  timer = setInterval(paint, STEP_MS);

  borrowedBadge = await chrome.action.getBadgeText({}).catch(() => '');
  await chrome.action.setBadgeBackgroundColor({ color: BADGE }).catch(() => {});
  await chrome.action.setBadgeText({ text: BADGE_DOT }).catch(() => {});
  return true;
}

/** Stop, and put the toolbar back the way it was. Safe when nothing was started (runtime.onStartup calls it). */
export async function stopRecordingIcon() {
  await setMicLive(false);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const path = manifestIcon();
  if (path) await chrome.action.setIcon({ path }).catch(() => {});

  // Give the badge back only if it is still ours. paintBadge() writes the
  // event count there, and a stop that landed after it would otherwise erase a
  // number the tester is reading.
  const now = await chrome.action.getBadgeText({}).catch(() => '');
  if (now === BADGE_DOT) await chrome.action.setBadgeText({ text: borrowedBadge || '' }).catch(() => {});
  borrowedBadge = null;
  return true;
}

/** Put the toolbar in step with what is recording, on every worker start (the interval dies with the worker). */
export async function syncRecordingIcon(recording, { mic = false } = {}) {
  return recording ? startRecordingIcon({ mic }) : stopRecordingIcon();
}
