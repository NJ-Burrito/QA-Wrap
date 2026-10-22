/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * e1022: the ⋯ menu "Updates" entry. A known, not-dismissed update reads "Update to vX" and runs the same Update button as the card
 * (ui/update-card.js); otherwise the entry opens Settings on the Updates tab. Nothing is requested here; a press does everything.
 */
(() => {
  const btn = document.getElementById('menu-updates');
  if (!btn || typeof chrome === 'undefined' || !chrome.storage) return;
  const text = document.getElementById('menu-updates-text');
  const tr = (k, v) => (globalThis.QAWi18n ? QAWi18n.t(k, v) : k);
  const pend = async () => {
    const s = { ...(await chrome.storage.local.get('qawUpdate')), ...(await chrome.storage.session.get('qawUpdateDismissed')) };
    return globalThis.QAWUpdateCard?.pending(s.qawUpdate, s.qawUpdateDismissed, chrome.runtime.getManifest().version) || null;
  };
  const paint = async () => {
    const rel = await pend();
    text.textContent = rel ? tr('popup.e1022.updateTo', { version: rel.version }) : tr('popup.e1022.updates');
  };
  btn.addEventListener('click', async () => {
    const go = document.getElementById('update-go');
    if (go && (await pend())) return void go.click();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sec-updates') });
  });
  document.getElementById('more')?.addEventListener('click', paint);
  paint();
})();
