/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Rule 5 (REQ-P2-2, REQ-P2-3): interrupted work is shown, not hidden, and a session can be kept.
 * A classic deferred script like done-card.js (popup.js is at its line ratchet): it uses the globals `$`, `t`, `send`, `state`.
 *   - After a crash the worker leaves `interrupted` in storage.local (id, saved event count, time; no content). The first popup open
 *     shows ONE card with the charter and the count; Open report, Keep and Dismiss are its only buttons, none of them primary.
 *   - Keep is `session.keep` through UQA_KEEP; the 30-day cleanup skips a kept session (core/sessions.js purgePlan).
 */

/** The one card's content: the newest interrupted session that still exists, and the saved events over all of them. */
function interruptedModel(rows, sessions) {
  const live = new Map((sessions || []).map((s) => [s.id, s]));
  const mine = (rows || []).filter((r) => r && live.has(r.id));
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  return { id: last.id, charter: live.get(last.id).charter || '', count: mine.length, events: mine.reduce((n, r) => n + (Number(r.n) || 0), 0), kept: live.get(last.id).keep === true };
}

async function paintInterruptedCard() {
  const card = document.getElementById('interrupted-card');
  if (!card) return null;
  const { interrupted } = await chrome.storage.local.get('interrupted');
  if (!Array.isArray(interrupted) || !interrupted.length) return null;
  const list = await send({ type: 'UQA_LIST_SESSIONS' });
  const model = interruptedModel(interrupted, list?.result);
  if (!model) { await chrome.storage.local.remove('interrupted'); return null; }
  document.getElementById('interrupted-line').textContent = model.count > 1
    ? t('popup.interrupted.many', { count: model.count, n: model.events })
    : t('popup.interrupted.line', { charter: model.charter, n: model.events });
  const keep = document.getElementById('interrupted-keep');
  keep.disabled = model.kept;
  keep.textContent = t(model.kept ? 'popup.keep.kept' : 'popup.keep.on');
  card.hidden = false;
  const close = async () => { card.hidden = true; await chrome.storage.local.remove('interrupted'); };
  document.getElementById('interrupted-open').onclick = async () => { await send({ type: 'UQA_OPEN_REPORT', sessionId: model.id, format: 'markdown' }); await close(); };
  document.getElementById('interrupted-dismiss').onclick = close;
  keep.onclick = async () => { if ((await send({ type: 'UQA_KEEP', sessionId: model.id, keep: true }))?.ok) { keep.disabled = true; keep.textContent = t('popup.keep.kept'); } };
  return model;
}

/** The Keep switch under "More" on the finished-session card; its state is read when the disclosure opens. */
function bindKeepSwitch() {
  const box = document.getElementById('keep-session');
  const more = document.getElementById('done-more');
  if (!box || !more) return;
  more.addEventListener('toggle', async () => {
    const target = exportableSession();
    if (!more.open || !target) return;
    const row = ((await send({ type: 'UQA_LIST_SESSIONS' }))?.result || []).find((s) => s.id === target.id);
    box.checked = row?.keep === true;
  });
  box.addEventListener('change', async () => {
    const target = exportableSession();
    if (!target) return;
    const res = await send({ type: 'UQA_KEEP', sessionId: target.id, keep: box.checked });
    if (!res?.ok) box.checked = !box.checked;
  });
}

paintInterruptedCard().catch(() => { /* the card is a courtesy; the sessions are still on disk */ });
bindKeepSwitch();
