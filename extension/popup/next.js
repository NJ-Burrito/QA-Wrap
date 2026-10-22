/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one filled button (REQ-P1-1) and the one clock (REQ-P0-4).
 * by tools/test-next-primary.mjs.
 */
const NEXT_STEP = {
  asleep: { key: 'popup.onboard.testSite', id: 'start' },
  idle: { key: 'popup.session.start', id: 'start' },
  recording: { key: 'popup.live.stop', id: 'stop' },
  done: { key: 'popup.done.copyReport', id: 'copy-report' },
};

function next(state) {
  const name = typeof state === 'string' ? state : state?.done ? 'done' : state?.recording ? 'recording' : state?.awake ? 'idle' : 'asleep';
  return { ...(NEXT_STEP[name] || NEXT_STEP.asleep) };
}

function fmtElapsed(startedAt) {
  const s = Math.max(0, Math.floor((Date.now() - (Number(startedAt) || Date.now())) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function paintPrimary() {
  const live = !document.getElementById('step-live')?.hidden;
  const done = !document.getElementById('step-done')?.hidden;
  const want = next({ recording: live, done: done && !live, awake: typeof awake !== 'undefined' && awake });
  for (const id of ['start', 'stop', 'copy-report']) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.classList.toggle('btn-primary', id === want.id);
    if (id === want.id) btn.dataset.primary = want.key; else delete btn.dataset.primary;
  }
}
