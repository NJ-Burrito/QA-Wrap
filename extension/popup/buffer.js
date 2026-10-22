/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/*
 * The 2-minute replay buffer, popup side (features-1010, decision 4). A classic deferred script that runs after popup.js and
 * shares its top-level names ($, t, say, awake, resolveCtx), so popup.js stays under its line ceiling.
 *
 *   - One tick per site, off by default: the list of origins is `bufferSites` in chrome.storage.local, and the page script
 *     (content/replay-buffer.js) reads it. Nothing is kept until a site is ticked, and only on a woken window.
 *   - «Save last 2 minutes»: asks the page to freeze what it holds, then presses the ordinary Start. The page hands the frozen
 *     events over as pre-roll when the session begins; a plain Start takes nothing from the buffer.
 */

const bufferOrigin = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };

async function paintBuffer() {
  const row = $('buffer-row');
  if (!row) return;
  const tab = await resolveCtx();
  const origin = bufferOrigin(tab?.url);
  row.hidden = !awake || !origin;
  if (row.hidden) return;
  const { bufferSites: list = [] } = /** @type {{ bufferSites?: string[] }} */ (await chrome.storage.local.get('bufferSites'));
  const on = list.includes(origin);
  $('buffer-site').checked = on;
  $('buffer-state').textContent = t(on ? 'buffer.popup.on' : 'buffer.popup.off');
  $('buffer-save').hidden = !on;
}

$('buffer-site')?.addEventListener('change', async (e) => {
  const origin = bufferOrigin((await resolveCtx())?.url);
  if (!origin) return;
  const { bufferSites: list = [] } = /** @type {{ bufferSites?: string[] }} */ (await chrome.storage.local.get('bufferSites'));
  const next = new Set(list);
  if (e.target.checked) next.add(origin); else next.delete(origin);
  await chrome.storage.local.set({ bufferSites: [...next] });
  chrome.tabs.sendMessage((await resolveCtx()).id, { type: 'UQA_BUFFER_REFRESH' }, { frameId: 0 }).catch(() => {}); // the page asks the worker again
  paintBuffer();
});

$('buffer-save')?.addEventListener('click', async () => {
  const tab = await resolveCtx();
  let count = 0;
  try { count = (await chrome.tabs.sendMessage(tab.id, { type: 'UQA_BUFFER_FREEZE' }, { frameId: 0 }))?.count || 0; } catch { /* the page has no buffer script */ }
  if (!count) { say(t('buffer.empty'), 'err'); return; }
  $('charter').value = t('buffer.charter');
  $('start').click();
});

/*
 * «Save last 1 minute» (cap1022). A button, not a toggle: while a session runs the worker keeps a rolling 60 s of this tab's video in the
 * media document's memory (core/rolling-buffer.js); the press files that minute as a recording. Nothing is kept outside a session,
 * nothing is written until the press, nothing leaves the machine. The popup asks the worker to start the buffer when the live card appears.
 */
const rollBtn = $('roll-save');
async function paintRoll() {
  if (!rollBtn) return;
  const live = !$('step-live').hidden;
  rollBtn.hidden = !live;
  if (!live) return;
  const tab = await resolveCtx();
  const sessionId = state?.session?.id;
  if (tab?.id == null || !sessionId) return;
  let streamId;
  try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); } catch { return; } // no grant for this tab: no buffer, the button then says so
  send({ type: 'UQA_ROLL', op: 'start', streamId, sessionId, tabId: tab.id });
}
if (rollBtn) {
  new MutationObserver(paintRoll).observe($('step-live'), { attributes: true, attributeFilter: ['hidden'] });
  paintRoll();
}
rollBtn?.addEventListener('click', async () => {
  rollBtn.disabled = true;
  const res = await send({ type: 'UQA_ROLL', op: 'save' });
  rollBtn.disabled = false;
  if (res.ok) say(t('popup.cap1022.rollSaved'));
  else if (/Nothing is buffered/.test(res.error || '')) say(t('popup.cap1022.rollEmpty'), 'err');
  else say(t('popup.cap1022.rollFailed'), 'err');
});
