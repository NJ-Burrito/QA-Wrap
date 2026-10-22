/* QA Wrap Bug Hunt - hard trials "Check your tools" (lane T1; design s4). The card's bonfire: a calm page, no timers, no deaths.
 * Six ticks light from real signals; each names the exact QA Wrap control. It is a tool check, not a hint: it says which control, never when.
 *
 *   createAttune(opts) -> { start(snap), step(t, snap) -> events, allowNoShortcut(), view() }
 *   snap = { state, counts } (the same snapshot the trial reads). Events: { type:'step', step, ok } | { type:'warn', step, key } |
 *   { type:'offer', key } | { type:'done' }.
 *
 *   1 awake: qawState 'ready'                    2 Save last 2 minutes: qawBuffer rises
 *   3 Stop (state 'stopped'), then the shortcut: qawShortcut rises (two starts without it -> offer "nokey")
 *   4 Not a bug on the toast: qawExpected rises  (a shot rise in this step -> warn "autoshot": auto-screenshot is on)
 *   5 screenshot and note: qawShots and qawNotes both rise     6 Stop: state 'stopped' */
import { makeObserver, LAG_SLOW, TOL } from '../trial.js';

export const STEPS = 6;
export const NOKEY_AFTER = 2;

export function createAttune() {
  const obs = makeObserver();
  const done = [false, false, false, false, false, false];
  let cur = 1;
  let sub = 0;                 // step 3: 0 = waiting for Stop, 1 = waiting for the shortcut
  let seen = { shots: false, notes: false };
  let startedAt = null;        // a session started in step 3 and not yet matched by a shortcut rise
  let fails = 0;
  let warned = false;
  let offered = false;
  let noKey = false;
  let fin = false;

  const view = () => ({ step: cur, done: [...done], sub, fails, warn: warned ? 'autoshot' : null, offer: offered ? 'nokey' : null, noShortcut: noKey, finished: fin });
  const start = (snap) => { obs.prime(snap); };

  const finish = (k, out) => { done[k - 1] = true; cur = k + 1; out.push({ type: 'step', step: k, ok: true }); };

  const step = (t, snap) => {
    const out = [];
    if (fin) return out;
    const d = obs.read(snap);
    const has = (sig) => d.rises.some((r) => r.sig === sig);
    const to = (s) => d.changes.some((c) => c.to === s);
    if (cur === 1 && snap.state === 'ready') finish(1, out);
    if (cur === 2 && has('buffer')) finish(2, out);
    if (cur === 3) {
      if (noKey) { finish(3, out); }
      else if (sub === 0 && to('stopped')) sub = 1;
      else if (sub === 1) {
        if (has('shortcut')) { startedAt = null; finish(3, out); }
        else {
          if (to('recording')) startedAt = t;
          if (startedAt !== null && t > startedAt + LAG_SLOW + TOL) {
            startedAt = null; fails += 1;
            if (fails >= NOKEY_AFTER && !offered) { offered = true; out.push({ type: 'offer', key: 'nokey' }); }
          }
        }
      }
    }
    if (cur === 4) {
      if (has('expected')) finish(4, out);
      else if (has('shots') && !warned) { warned = true; out.push({ type: 'warn', step: 4, key: 'autoshot' }); }
    }
    if (cur === 5) {
      if (has('shots')) seen.shots = true;
      if (has('notes')) seen.notes = true;
      if (seen.shots && seen.notes) { seen = { shots: false, notes: false }; finish(5, out); }
    }
    if (cur === 6 && to('stopped')) { finish(6, out); fin = true; out.push({ type: 'done' }); }
    return out;
  };
  /** "Allow starting without the shortcut": the check stops asking for it. */
  const allowNoShortcut = () => { noKey = true; };
  return { start, step, allowNoShortcut, view };
}

export default { createAttune, STEPS };
