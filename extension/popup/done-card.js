/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The finished-session card (REQ-P1-5).
 *   - The number is `problemCounts(events).groups` from core/finding-count.js (contract C5), loaded with import() because this is
 */
function doneModel({ groups, time }) {
  const clean = !(groups > 0);
  return { clean, copyKey: 'popup.done.copyReport', cleanKey: clean ? 'popup.done.noProblems' : null, time };
}

async function countGroups(events, fallback) {
  try {
    const mod = await import('../core/finding-count.js');
    return mod.problemCounts(events).groups;
  } catch {
    return fallback;
  }
}

/**
 * ONE duration for the whole card: the summary line, the Duration tile and the "no problems" line all read this, floored like the
 * live clock (a session that ran 5.7 s said "00:05" while it recorded, so it says "00:05" when it is done).
 */
function doneTime(finished) {
  return fmtDuration(Math.max(0, (finished.endedAt || Date.now()) - finished.startedAt));
}

/** The session's name, one fallback chain for popup, report and export (core/artifact-docs.js reportTitle), cached by session id so a repaint never flickers. */
const doneTitles = new Map();
function titleNow(finished) {
  const cached = doneTitles.get(finished.id);
  if (cached) return cached;
  const set = String(finished.charter || '').trim();
  if (set && set !== t('popup.session.untitled')) return set;
  try {
    const u = new URL(String(finished.startUrl));
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.host || t('popup.session.untitled');
    return /\/practice\//.test(u.pathname) && /-extension:$/.test(u.protocol) ? t('welcome.practice.title') : t('popup.session.untitled'); // an extension page's host is the extension id
  } catch { return t('popup.session.untitled'); }
}
/** The "{name}: {time} recorded." line. */
function doneLine(finished) {
  return t('popup.done.summary', { charter: iso(titleNow(finished)), time: doneTime(finished) });
}

/** Painted after the review pane has counted; `fallback` is the number it printed. */
async function paintDoneCard(finished, events, fallback) {
  const groups = await countGroups(events, fallback);
  const time = doneTime(finished);
  try { const ttl = (await import('../core/artifact-docs.js')).reportTitle(finished, events); doneTitles.set(finished.id, ttl === 'Practice page' ? t('welcome.practice.title') : ttl); } catch { /* the host fallback stands */ }
  const model = doneModel({ groups, time });
  try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } // the first-run pointer goes after the first real session
  $('pointer')?.classList.remove('is-on');
  const tile = $('stat-problems');
  if (tile) tile.textContent = String(groups);
  if ($('stat-duration')) $('stat-duration').textContent = time;
  const summary = $('done-summary');
  if (summary && !$('step-done').hidden && summary.textContent !== t('popup.done.saving')) summary.textContent = doneLine(finished);
  const line = $('done-clean');
  if (line) {
    line.hidden = !model.clean;
    line.textContent = model.clean ? t(model.cleanKey, { time }) : '';
  }
  return model;
}

async function copyReport() {
  const target = exportableSession();
  if (!target) return say(t('popup.err.noSessionExport'), 'err');
  const btn = $('copy-report');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const res = await send({ type: 'UQA_EXPORT', sessionId: target.id, format: 'markdown' });
    if (!res.ok) return say(res.error, 'err');
    await navigator.clipboard.writeText(res.result.content);
    say(t('popup.done.copied'), 'ok');
  } catch (err) {
    say(t('popup.export.failed', { error: err?.message || String(err) }), 'err');
  } finally {
    btn.disabled = false;
  }
}
$('copy-report')?.addEventListener('click', copyReport);
