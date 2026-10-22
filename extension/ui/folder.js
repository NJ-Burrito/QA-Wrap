/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The folder the tester granted, remembered between sessions.
 *
 * `showDirectoryPicker()` hands back a live handle, not a path — an extension
 * never learns where the folder actually is on disk, which is the whole point of
 * the permission model. The handle is structured-cloneable, so IndexedDB can
 * keep it; a plain string in chrome.storage cannot.
 *
 * Permission does not survive a browser restart. `queryPermission` says whether
 * it still holds, and `requestPermission` can ask again — but only from a real
 * user gesture, which is why every call here is reached from a button.
 *
 * Classic script, shared by the settings page and the report page.
 */
(() => {
  if (window.UQAFolder) return;

  const DB = 'uqa-folder';
  const STORE = 'handles';
  const KEY = 'output';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get() {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function set(handle) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clear() {
    const db = await open();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  /** Ask for a folder. Must be called from a click. */
  async function choose() {
    if (typeof showDirectoryPicker !== 'function') {
      throw Object.assign(
        new Error('This browser cannot grant a folder. Files will go to your Downloads folder, in the same category tree.'),
        { code: 'NO_FOLDER_API' }
      );
    }
    const handle = await showDirectoryPicker({ id: 'qaw-output', mode: 'readwrite' });
    await set(handle);
    return handle;
  }

  /**
   * The granted handle, if it is still usable.
   *
   * `{ prompt: true }` re-asks when permission has lapsed, which is normal after
   * a browser restart. Called outside a gesture it simply returns null, and the
   * caller falls back to Downloads rather than failing.
   */
  async function usable({ prompt = false } = {}) {
    const handle = await get();
    if (!handle) return null;
    try {
      let state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'prompt' && prompt) state = await handle.requestPermission({ mode: 'readwrite' });
      return state === 'granted' ? handle : null;
    } catch {
      return null;
    }
  }

  window.UQAFolder = { choose, usable, get, clear, set };
})();
