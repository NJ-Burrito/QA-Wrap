/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The rolling one-minute video buffer, as plain arithmetic (cap1022). A MediaRecorder cannot drop its oldest seconds and stay playable,
 * so SLOTS recorders run on one tab stream, each restarted when it is WINDOW_MS old and started STAGGER_MS apart. «Save last 1 minute»
 * saves the oldest one: never more than WINDOW_MS, and (once warm) at least WINDOW_MS - STAGGER_MS of the minute that just happened.
 * Nothing here touches a stream or a clock; offscreen/rolling.js feeds it times and does what it answers.
 */
export const WINDOW_MS = 60_000;
export const SLOTS = 3;
export const STAGGER_MS = WINDOW_MS / SLOTS;

/** @param {({startedAt:number}|null)[]} slots @param {number} now @param {number} t0 when rolling began @returns {number[]} slots to (re)start now */
export function dueRestarts(slots, now, t0, windowMs = WINDOW_MS, stagger = STAGGER_MS) {
  const due = [];
  slots.forEach((s, i) => {
    if (s ? now - s.startedAt >= windowMs : now >= t0 + i * stagger) due.push(i);
  });
  return due;
}

/** The slot holding the most of the last minute: the oldest running one, or -1 when none runs. */
export function pickSave(slots) {
  let best = -1;
  slots.forEach((s, i) => { if (s && (best < 0 || s.startedAt < slots[best].startedAt)) best = i; });
  return best;
}

/** The duration to store for a saved clip: what the media decodes to when that is known (a MediaRecorder file can hold far less than the wall time, because a still tab emits few frames), else the wall time, never past the window. */
export function reconcileDuration(wallMs, decodedMs, windowMs = WINDOW_MS) {
  const ok = Number.isFinite(decodedMs) && decodedMs > 0;
  return Math.min(windowMs, Math.round(ok ? decodedMs : wallMs));
}
