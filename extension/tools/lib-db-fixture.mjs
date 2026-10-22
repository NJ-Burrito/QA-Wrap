/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-038: a database exactly as 3.1.x left it (schema v4: no `replay` store),
 * with history in it. One builder, two engines: test-db-upgrade.mjs runs it on
 * fake-indexeddb, test-truth.mjs runs it in real Chromium.
 *
 * `seedV4` must stay self-contained (no imports, no closures): the truth
 * harness ships its source into the page with .toString().
 */
export const V4_EVENTS = 200;

export async function seedV4(idb, name = 'uqa', nEvents = 200) {
  await new Promise((resolve, reject) => {
    const r = idb.deleteDatabase(name);
    r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve;
  });
  const db = await new Promise((resolve, reject) => {
    const r = idb.open(name, 4);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      const ev = d.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
      ev.createIndex('sessionId', 'sessionId');
      ev.createIndex('bySessionTs', ['sessionId', 'ts']);
      ev.createIndex('bySessionFail', ['sessionId', 'fail']);
      d.createObjectStore('captures', { keyPath: 'id' });
      d.createObjectStore('media', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      d.createObjectStore('mediaParts', { keyPath: ['id', 'seq'] });
      d.createObjectStore('mediaPending', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'events', 'media'], 'readwrite');
    tx.objectStore('sessions').put({ id: 's-v4', startedAt: 1000, endedAt: 2000, status: 'stopped', title: 'v4 history' });
    for (let i = 0; i < nEvents; i++) tx.objectStore('events').add({ sessionId: 's-v4', ts: 1000 + i, kind: 'note', text: `n${i}`, fail: 0 });
    tx.objectStore('media').put({ id: 'm-v4', sessionId: 's-v4', ts: 1500, type: 'video/webm', blob: new Blob(['clip']) });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * r6-06-2: a database as schema v1 (sessions and events with only the `sessionId` index; no `fail` flag, no captures,
 * media or replay) or v3 (adds the failure index, captures and media; no mediaParts, mediaPending or replay) left it.
 * Self-contained like seedV4. Every sixth event is a failure, the rest are not: with `nEvents` a multiple of six,
 * half of them fail (v1 rows carry no flag, so the upgrade has to backfill it; v3 rows already carry it).
 */
export const LEGACY_EVENTS = 60;
export const LEGACY_FAILS = 30;

export async function seedLegacy(idb, version, name = 'uqa', nEvents = 60) {
  await new Promise((resolve, reject) => {
    const r = idb.deleteDatabase(name);
    r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve;
  });
  const db = await new Promise((resolve, reject) => {
    const r = idb.open(name, version);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      const ev = d.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
      ev.createIndex('sessionId', 'sessionId');
      if (version >= 3) {
        ev.createIndex('bySessionTs', ['sessionId', 'ts']);
        ev.createIndex('bySessionFail', ['sessionId', 'fail']);
        d.createObjectStore('captures', { keyPath: 'id' });
        d.createObjectStore('media', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const shapes = [
    { kind: 'net', method: 'GET', url: '/a', status: 500 },
    { kind: 'net', method: 'GET', url: '/b', status: 200 },
    { kind: 'console', level: 'error', text: 'boom' },
    { kind: 'console', level: 'log', text: 'hello' },
    { kind: 'pageerror', text: 'uncaught' },
    { kind: 'note', text: 'a note' },
  ];
  const fails = [1, 0, 1, 0, 1, 0];
  const sid = `s-v${version}`;
  const stores = version >= 3 ? ['sessions', 'events', 'captures', 'media'] : ['sessions', 'events'];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('sessions').put({ id: sid, startedAt: 1000, endedAt: 2000, status: 'stopped', title: `v${version} history` });
    for (let i = 0; i < nEvents; i++) tx.objectStore('events').add({ sessionId: sid, ts: 1000 + i, ...shapes[i % 6], ...(version >= 3 ? { fail: fails[i % 6] } : {}) });
    if (version >= 3) {
      tx.objectStore('captures').put({ id: `c-v${version}`, sessionId: sid, ts: 1500, dataUrl: 'data:image/png;base64,AAAA' });
      tx.objectStore('media').put({ id: `m-v${version}`, sessionId: sid, ts: 1500, type: 'video/webm', blob: new Blob(['clip']) });
    }
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
