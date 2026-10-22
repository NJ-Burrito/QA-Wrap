/* QA Wrap — one bounded wait. A promise that never settles must not wedge the worker (work/sw-hang-1004). */
// @ts-nocheck
import { ring } from '../core/on.js';
/** Milliseconds per stage. Tests shrink these; nothing else writes them. */
export const DEADLINES = { deviceKey: 5000, sync: 1500, write: 8000, tab: 1500, offscreen: 5000, tx: 8000 };

/** The error every deadline throws: code SLOW (calm, "try again"), plus the stage that was stuck. */
export const slow = (stage, ms) => Object.assign(new Error(`${stage} did not answer within ${ms} ms`), { code: 'SLOW', stage });

/** ui-1019 evidence for "breaks after a while": a fired deadline is a handler-ring row (stage, ms, uptime, live contexts); local, masked, shown in the support bundle. */
export async function noteSlow(stage, ms) {
  let ctx = '';
  try {
    const n = {};
    for (const c of await chrome.runtime.getContexts({})) n[c.contextType] = (n[c.contextType] || 0) + 1;
    ctx = ` ctx ${Object.entries(n).map(([k, v]) => `${k}:${v}`).join(',')}`;
  } catch { /* contexts are a hint */ }
  return ring(`deadline:${stage}`, `${ms} ms, up ${Math.round(performance.now() / 1000)} s${ctx}`);
}

/**
 * Race `p` against the stage's deadline. On timeout: one `[uqa] deadline` warning, `onTimeout()` (so the
 * abandoned work can stop itself), and a SLOW rejection. `p` itself is left running; it is never cancelled.
 */
export function withDeadline(p, stage, ms = DEADLINES[stage], onTimeout) {
  let t;
  const clock = new Promise((_, no) => {
    t = setTimeout(() => {
      console.warn('[uqa] deadline', stage, ms);
      noteSlow(stage, ms).catch(() => {});
      try { onTimeout?.(); } catch { /* best effort */ }
      no(slow(stage, ms));
    }, ms);
  });
  return Promise.race([Promise.resolve(p), clock]).finally(() => clearTimeout(t));
}
