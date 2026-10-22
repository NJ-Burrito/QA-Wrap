/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Causal chains: which action most plausibly caused which failure.
 *
 * Its own file because report/report.js and devtools/panel.js (classic scripts, no static import) each carried a copy of the rule.
 * Now they `import()` this once before the first render (as report/charts.js does); the file has one dependency (./events.js), so a
 * page need not load provenance.js. core/artifact.js re-exports everything here.
 */

import { isFailure, liteFp } from './events.js';

/**
 * A network or console failure is attributed to the last DOM action within this window. The window is a setting
 * (`settings.causalWindowMs`), taken as data so this module stays pure and safe in the worker's boot graph:
 * `correlate(events, windowMs)` takes it per call, `setCausalWindowMs(ms)` sets the default for callers with no settings object
 * (the exporters, the ISTQB builders). The default equals `platform/settings.js` DEFAULTS.causalWindowMs, 5000 ms.
 */
export const DEFAULT_CAUSAL_WINDOW_MS = 5000;

let causalWindow = DEFAULT_CAUSAL_WINDOW_MS;

/** The window every `correlate()` that is given none will use. */
export const causalWindowMs = () => causalWindow;

/**
 * Prime the default from a settings snapshot.
 *
 * Out-of-range and non-numeric values are ignored rather than clamped: a
 * surface that hands over rubbish gets the documented default, not a silently
 * invented number. The bounds are `RANGES.causalWindowMs` in `platform/settings.js`.
 */
export function setCausalWindowMs(ms) {
  const n = Number(ms);
  causalWindow = Number.isFinite(n) && n >= 500 && n <= 20000 ? n : DEFAULT_CAUSAL_WINDOW_MS;
  return causalWindow;
}

/** D-1010-127: browser frameId when both carry one; else origin + path of the frame URL; no URL on either side = same frame; one-sided = different. */
const frameKey = (u) => { try { const x = new URL(`${u}`); return x.origin + x.pathname; } catch { return `${u}`.split(/[?#]/)[0]; } };
const isFid = (n) => Number.isInteger(n) && n >= 0;
const sameFrame = (a, b) => {
  if (isFid(a.frameId) && isFid(b.frameId)) return a.frameId === b.frameId;
  if (a.frameUrl && b.frameUrl) return frameKey(a.frameUrl) === frameKey(b.frameUrl);
  return !a.frameUrl && !b.frameUrl;
};

/**
 * Build causal chains: each failure is linked back to the DOM action that most
 * plausibly triggered it (same frame preferred, most recent, within the window).
 */
export function correlate(events, windowMs = causalWindow) {
  const span = Number.isFinite(Number(windowMs)) ? Number(windowMs) : DEFAULT_CAUSAL_WINDOW_MS;
  const chains = [];
  // Scanned newest-first below, so the order must be by time. A settled input
  // keeps its last keystroke's ts and is emitted later than a click that came
  // after it: arrival order is not time order (r2-05-2). Stable, seq as the
  // tie-break, and an event without a numeric ts keeps its place.
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const domEvents = events
    .filter((e) => e.kind === 'dom' || e.kind === 'nav')
    .map((e, i) => ({ e, i }))
    .sort((x, y) => {
      const a = num(x.e.ts);
      const b = num(y.e.ts);
      if (a !== null && b !== null && a !== b) return a - b;
      const sa = num(x.e.seq);
      const sb = num(y.e.seq);
      if (sa !== null && sb !== null && sa !== sb) return sa - sb;
      return x.i - y.i;
    })
    .map((x) => x.e);

  for (const failure of events.filter(isFailure)) {
    let trigger = null;
    // A net event is stamped when the response arrives, so a slow request is
    // compared by when it STARTED: ts - durationMs (guarded: finite, 0..120 s).
    const dur = failure.kind === 'net' ? Number(failure.durationMs) : 0;
    const startTs = Number.isFinite(dur) && dur > 0 && dur <= 120000 ? failure.ts - dur : failure.ts;
    for (let i = failure.check === 'overflow' || failure.check === 'contrast' ? -1 : domEvents.length - 1; i >= 0; i--) { // a layout check finds what is on the page, not what a click did
      const d = domEvents[i];
      if (d.ts > startTs) continue;
      if (startTs - d.ts > span) break;
      if (Number.isInteger(d.tabId) && Number.isInteger(failure.tabId) && d.tabId !== failure.tabId) continue;
      if (!trigger) trigger = d;
      // A same-frame action beats a more recent one from another frame.
      if (d.frameUrl && failure.frameUrl && sameFrame(d, failure)) {
        trigger = d;
        break;
      }
    }

    // Failures that share a trigger and fire together are one incident, not
    // several. The first one becomes the chain; the rest ride along as siblings.
    const existing = chains.find(
      (c) => c.trigger === trigger && Math.abs(c.failure.ts - failure.ts) <= 250
    );
    if (existing) {
      existing.siblings.push(failure);
      continue;
    }

    chains.push({
      fp: '',
      count: 1,
      repeatOf: /** @type {any} */ (null),
      trigger,
      failure,
      siblings: [],
      // gapMs stays the elapsed time to the failure's own timestamp: every
      // surface words it "N ms earlier", and test.mjs pins it. The distance to
      // the request START, which selection and confidence use, is startGapMs.
      gapMs: trigger ? failure.ts - trigger.ts : null,
      startGapMs: trigger ? startTs - trigger.ts : null,
      confidence: !trigger
        ? 'none'
        : sameFrame(trigger, failure) && startTs - trigger.ts < 1500
          ? 'high'
          : 'low',
    });
  }

  // Repeats fold: every chain says how often its fingerprint fired (occurrences
  // plus the hook's `rep` counts) and later ones point at the first.
  const reps = {};
  for (const e of events) if (e.kind === 'rep') reps[liteFp(e)] = (reps[liteFp(e)] || 0) + (Number(e.n) || 0);
  const firstOf = new Map();
  for (const c of chains) {
    c.fp = liteFp(c.failure);
    if (!firstOf.has(c.fp)) firstOf.set(c.fp, c);
    else c.repeatOf = firstOf.get(c.fp) || null;
  }
  for (const c of chains) {
    const first = c.repeatOf || c;
    c.count = c === first
      ? 1 + c.siblings.length + (reps[c.fp] || 0)
      : 1 + c.siblings.length;
    if (c !== first) first.count += c.count;
  }
  return chains;
}

export { isFailure };
