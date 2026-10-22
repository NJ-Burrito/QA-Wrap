/* QA Wrap — a just-enough IndexedDB stub for Node tests (open / createObjectStore / get / put). Keeps values by reference, so a non-extractable CryptoKey survives. */
export function installIdbStub() {
  const dbs = new Map();
  const later = (fn) => queueMicrotask(fn);
  const request = (run) => {
    const r = {};
    later(() => { try { r.result = run(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } });
    return r;
  };
  globalThis.indexedDB = {
    _dbs: dbs,
    open(name) {
      const r = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const stores = dbs.get(name);
        const db = {
          createObjectStore: (n) => stores.set(n, new Map()),
          close() {},
          transaction: (n) => {
            const t = {};
            const m = stores.get(n);
            t.objectStore = () => ({
              get: (k) => request(() => m.get(k)),
              put: (v, k) => { const q = request(() => (m.set(k, v), k)); later(() => later(() => t.oncomplete?.())); return q; },
            });
            return t;
          },
        };
        r.result = db;
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return dbs;
}
