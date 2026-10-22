/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Getting a generated file onto disk, reliably.
 *
 * The obvious approach — build a blob URL and click an <a download> — is exactly
 * what did not work. In a browser-action popup the document is torn down the
 * moment focus moves, and Chrome cancels a download whose initiating document
 * has gone. The click "succeeds", no file appears, and nothing is logged.
 *
 * chrome.downloads.download() hands the URL to the browser's download manager,
 * which owns it from that point, so the popup closing no longer matters. If the
 * API is unavailable or refuses, fall back to the anchor, and if that fails too,
 * say so rather than pretending a file was written.
 *
 * `conflictAction: 'uniquify'` is stated rather than assumed. It is Chrome's
 * default today, and rule 4 of the folder contract in `core/filing.js` — never
 * overwrite, every copy side by side — is too important to rest on a default
 * that a future Chrome, or an enterprise policy, is free to change. Saying it
 * costs one property and makes the guarantee testable.
 *
 * Shared by the popup and the DevTools panel as a classic script.
 */
(() => {
  if (window.UQADownload) return;

  function anchorFallback(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  }

  /**
   * @returns {Promise<{ok: boolean, how: string, id?: number, error?: string}>}
   */
  async function downloadText(content, filename, mime = 'text/plain', { saveAs = false } = {}) {
    let url;
    try {
      url = URL.createObjectURL(new Blob([content], { type: mime }));
    } catch (err) {
      return { ok: false, how: 'blob', error: String(err?.message || err) };
    }

    const revokeLater = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);

    if (chrome.downloads?.download) {
      try {
        const id = await new Promise((resolve, reject) => {
          chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' }, (downloadId) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (downloadId === undefined) return reject(new Error('the download was not started'));
            resolve(downloadId);
          });
        });
        revokeLater();
        return { ok: true, how: 'downloads', id };
      } catch (err) {
        // Fall through to the anchor rather than losing the export.
        try {
          anchorFallback(url, filename);
          revokeLater();
          return { ok: true, how: 'anchor', error: String(err?.message || err) };
        } catch (err2) {
          revokeLater();
          return { ok: false, how: 'anchor', error: String(err2?.message || err2) };
        }
      }
    }

    try {
      anchorFallback(url, filename);
      revokeLater();
      return { ok: true, how: 'anchor' };
    } catch (err) {
      revokeLater();
      return { ok: false, how: 'anchor', error: String(err?.message || err) };
    }
  }

  /** Where a finished download actually landed, for telling the user. */
  async function whereIsIt(id) {
    if (id == null || !chrome.downloads?.search) return null;
    for (let i = 0; i < 20; i++) {
      const [item] = await new Promise((r) => chrome.downloads.search({ id }, r));
      if (item?.state === 'complete') return item.filename;
      if (item?.state === 'interrupted') return null;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  /** The same path, for bytes that are already a Blob (a recording, an image). */
  async function downloadBlob(blob, filename, { saveAs = false } = {}) {
    let url;
    try {
      url = URL.createObjectURL(blob);
    } catch (err) {
      return { ok: false, how: 'blob', error: String(err?.message || err) };
    }
    const revokeLater = () => setTimeout(() => URL.revokeObjectURL(url), 120_000);

    if (chrome.downloads?.download) {
      try {
        const id = await new Promise((resolve, reject) => {
          chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' }, (downloadId) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (downloadId === undefined) return reject(new Error('the download was not started'));
            resolve(downloadId);
          });
        });
        revokeLater();
        return { ok: true, how: 'downloads', id };
      } catch (err) {
        try {
          anchorFallback(url, filename);
          revokeLater();
          return { ok: true, how: 'anchor', error: String(err?.message || err) };
        } catch (err2) {
          revokeLater();
          return { ok: false, how: 'anchor', error: String(err2?.message || err2) };
        }
      }
    }
    try {
      anchorFallback(url, filename);
      revokeLater();
      return { ok: true, how: 'anchor' };
    } catch (err) {
      revokeLater();
      return { ok: false, how: 'anchor', error: String(err?.message || err) };
    }
  }

  /**
   * Save into the category tree.
   *
   * Two destinations, same tree. If the tester granted a folder it is written
   * there directly, which is the only way to reach anywhere outside Downloads.
   * Otherwise `chrome.downloads` takes a relative path and creates the missing
   * directories itself — same layout, always under Downloads.
   */
  /*
   * `saveAs` is the tester's standing preference, not a per-press decision.
   *
   * Chrome will not tell an extension which folder a person picked in its own
   * dialog, and will not let one choose a folder — so the only half of "remember
   * where I save" that can be honoured is whether the dialog opens at all. That
   * is a real choice: a tester filing into a client folder wants it every time,
   * and a tester capturing forty screenshots never wants to see it. It is
   * carried here rather than read here, because this file has no settings.
   */
  async function saveFiled(data, relativePath, mime, { saveAs = false } = {}) {
    /*
     * A gzipped artefact is named `.gz`, wherever it came from.
     *
     * The worker decides whether an export is compressed — it is the only side
     * that has seen the bytes — but the path is built on this side, by three
     * different surfaces, from `exportPath()`. Rather than teach each of them
     * the rule, it is applied at the one point every one of them passes
     * through: if what is being written is gzip, the name says so. A file whose
     * extension lies about its contents is the kind of bug a tester only finds
     * a week later, when the file will not open.
     */
    const type = mime || (data instanceof Blob ? data.type : '');
    if (type === 'application/gzip' && !String(relativePath).endsWith('.gz')) {
      relativePath = `${relativePath}.gz`;
    }

    const handle = await window.UQAFolder?.usable({ prompt: true });
    if (handle) {
      try {
        const { writeToDirectory } = await import('../core/filing.js');
        /*
         * `ensureTree(handle)` used to run here, once per file.
         *
         * `writeToDirectory()` creates every parent it needs, so all the tree
         * call added was the seven categories this file was not going into.
         * Run 2 of the real session ended with `Accessibility/` and
         * `Recordings/` standing empty in a session that had neither, which
         * reads as evidence that went missing. Rule 3 of the contract in
         * `core/filing.js`: only the categories being written are created.
         */
        const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain' });
        const written = await writeToDirectory(handle, relativePath, blob);
        // Named from the folder the tester actually picked, not from the root:
        // "it went into QA Wrap/Reports" is no help to somebody who has three
        // client folders. `writeToDirectory` answers relative to the handle.
        return { ok: true, how: 'folder', path: `${handle.name}/${written}`, folder: handle.name };
      } catch (err) {
        // Fall through to Downloads rather than losing the artefact — but say
        // which one happened, because the tester is looking in a folder.
        const fallback = data instanceof Blob
          ? await downloadBlob(data, relativePath)
          : await downloadText(data, relativePath, mime);
        return { ...fallback, how: 'downloads-fallback', error: String(err?.message || err) };
      }
    }
    return data instanceof Blob
      ? await downloadBlob(data, relativePath, { saveAs })
      : await downloadText(data, relativePath, mime, { saveAs });
  }

  /**
   * A system notification when a save finishes.
   *
   * The thing Nader asked for after the session where thirty-eight files
   * appeared on disk and nothing anywhere said so: "a system notification on
   * save complete, with the folder". It matters most on the granted-folder
   * route, which by construction cannot put anything in the browser's download
   * list — there, this is the only signal outside the page itself.
   *
   * Guarded on `chrome.notifications` rather than on a permission check,
   * because the API object simply does not exist without the permission. It is
   * declared in the manifest, which Group G owns; until it is, this is a no-op
   * and the in-page confirmation carries the whole job on its own. That is the
   * right failure: a missing permission must never cost a saved file.
   *
   * `requireInteraction` is deliberately off. A notification that will not go
   * away is a notification people turn off, and then the one that mattered is
   * off too.
   */
  async function announce(title, message) {
    try {
      if (!chrome.notifications?.create) return { ok: false, error: 'no notifications permission' };
      const id = await new Promise((resolve) => {
        chrome.notifications.create('', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title,
          message,
          silent: false,
        }, resolve);
      });
      // Swallowed on purpose: `lastError` here means the notification did not
      // appear, which is not a reason to tell anyone their files did not save.
      void chrome.runtime.lastError;
      return { ok: !!id, id };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  window.UQADownload = { downloadText, downloadBlob, saveFiled, whereIsIt, announce };
})();
