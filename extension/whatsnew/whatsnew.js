/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Update page. `?update=<version>`: ask the native host (com.njburrito.qawrap.updater) to swap the folder in place, then reload.
 * The host missing or failing is not an error for the tester: the zip downloads and three short steps show instead.
 * No query: "What's new in vX", the release notes as text (QAWUpdateCard.notesBlocks drops markup; textContent only, never innerHTML).
 * The page lives in a tab, not the popup, so closing the popup cannot cut the update off.
 */
(async function () {
  const HOST = 'com.njburrito.qawrap.updater';
  await globalThis.QAWi18n?.ready?.();
  const tr = (k, v) => QAWi18n.t(k, v);
  const $ = (id) => document.getElementById(id);
  const mk = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
  const cur = chrome.runtime.getManifest().version;
  const { qawPendingNotes: p, qawUpdateToken: token } = await chrome.storage.local.get(['qawPendingNotes', 'qawUpdateToken']);
  const want = new URLSearchParams(location.search).get('update');

  function notes(rel) {
    const box = $('wn-notes');
    let ul = null;
    for (const b of QAWUpdateCard.notesBlocks(rel.notes)) {
      if (b.tag !== 'li') { ul = null; box.append(mk(b.tag, b.text)); continue; }
      if (!ul) { ul = document.createElement('ul'); box.append(ul); }
      ul.append(mk('li', b.text));
    }
    if (rel.url && /^https:\/\/github\.com\//.test(rel.url)) { const a = $('wn-link'); a.href = rel.url; a.textContent = tr('update.upd1022.releasePage'); a.hidden = false; }
  }

  function fallback(rel) { // host missing: the zip downloads, three steps show
    $('wn-status').textContent = tr('update.upd1022.manual');
    for (const k of ['update.step1', 'update.step2', 'update.step3']) $('wn-steps').append(mk('li', tr(k)));
    $('wn-steps').hidden = false;
    chrome.downloads.download({ url: rel.zip, filename: `qa-wrap-${rel.version}.zip`, conflictAction: 'uniquify' }).catch(() => {});
  }

  if (want && p && p.version === want) { // update mode
    $('wn-title').textContent = tr('update.upd1022.updating', { version: want });
    notes(p);
    const msg = { op: 'update', version: want, zip: p.zip, zipApi: p.zipApi, sha256: p.sha256, token: token || '' };
    chrome.runtime.sendNativeMessage(HOST, msg, (r) => {
      if (chrome.runtime.lastError || !r) return fallback(p); // host not installed
      if (!r.ok) { $('wn-status').textContent = tr('update.upd1022.failed'); return; } // the host rolled back; nothing changed
      $('wn-status').textContent = tr('update.upd1022.done');
      setTimeout(() => chrome.runtime.reload(), 400);
    });
  } else { // what's new
    $('wn-title').textContent = tr('update.upd1022.whatsNewIn', { version: cur });
    if (p && p.version === cur) notes(p);
    else { $('wn-status').textContent = tr('update.noNotes'); $('wn-link').href = `https://github.com/NJ-Burrito/QA-Wrap/releases/tag/v${cur}`; $('wn-link').textContent = tr('update.upd1022.releasePage'); $('wn-link').hidden = false; }
  }
})();
