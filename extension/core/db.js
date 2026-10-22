/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * IndexedDB persistence for UQA.
 *
 * MV3 service workers terminate whenever they go idle, so nothing may live in
 * memory between two events. Every event is written here the moment it arrives.
 */

import { failFlag } from './events.js';

const DB_NAME = 'uqa';
const DB_VERSION = 5;

let dbPromise = null;

/**
 * Opening at a new version BLOCKS while an older connection is open, and a blocked open never fires
 * onsuccess: an unhandled one hangs every awaiting call ("nothing works"). Three defences:
 *   1. onversionchange on every connection closes it, so this context never blocks an upgrade elsewhere.
 *   2. onblocked surfaces the block instead of hanging.
 *   3. a watchdog fails loudly if the open neither succeeds, errors nor reports blocked.
 */
const OPEN_TIMEOUT_MS = 8000;
/** D-1010-105: codes DB_SLOW, DB_BLOCKED, DB_BROKEN, DB_NEWER; the texts stay verbatim. */
const withCode = (e, code) => Object.defineProperty(e, 'code', { value: code, configurable: true });

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(value);
    };

    const watchdog = setTimeout(() => {
      dbPromise = null; // let the next call try again
      finish(reject, withCode(new Error(
        `The QA Wrap database did not open within ${OPEN_TIMEOUT_MS}ms. ` +
        'Close other QA Wrap tabs and DevTools panels, then try again.'
      ), 'DB_SLOW'));
    }, OPEN_TIMEOUT_MS);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onblocked = () => {
      dbPromise = null;
      finish(reject, withCode(new Error(
        'The QA Wrap database is held open by another QA Wrap page at an older version. ' +
        'Close any other tabs with the QA Wrap panel open and retry.'
      ), 'DB_BLOCKED'));
    };

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt');
      }

      const events = db.objectStoreNames.contains('events')
        ? req.transaction.objectStore('events')
        : db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });

      if (!events.indexNames.contains('sessionId')) events.createIndex('sessionId', 'sessionId');
      if (!events.indexNames.contains('bySessionTs')) events.createIndex('bySessionTs', ['sessionId', 'ts']);

      // v2: index the failure flag so counting problems is a key-range count
      // rather than a full read-and-filter of the session.
      if (!events.indexNames.contains('bySessionFail')) {
        events.createIndex('bySessionFail', ['sessionId', 'fail']);
        // Backfill: rows written under v1 have no flag.
        events.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          if (cursor.value.fail === undefined) {
            cursor.update({ ...cursor.value, fail: failFlag(cursor.value) });
          }
          cursor.continue();
        };
      }

      if (!db.objectStoreNames.contains('captures')) {
        // Screenshots are kept apart so timeline reads stay cheap.
        db.createObjectStore('captures', { keyPath: 'id' });
      }

      // v3: recordings. A screen capture is megabytes, not kilobytes, so it is
      // stored as a Blob in its own store — IndexedDB keeps Blobs on disk
      // rather than in the record, so a session listing never pays for them.
      if (!db.objectStoreNames.contains('media')) {
        const m = db.createObjectStore('media', { keyPath: 'id' });
        m.createIndex('sessionId', 'sessionId');
      }

      /*
       * v4: a clip is written to disk as it is recorded, so a crash or reload no longer takes the whole recording.
       * `mediaParts` holds the chunks keyed `[id, seq]`; `mediaPending` holds the one row saying a clip is in progress.
       * Additive: no existing row is read or rewritten.
       */
      if (!db.objectStoreNames.contains('mediaParts')) {
        db.createObjectStore('mediaParts', { keyPath: ['id', 'seq'] });
      }
      if (!db.objectStoreNames.contains('mediaPending')) {
        db.createObjectStore('mediaPending', { keyPath: 'id' });
      }

      /*
       * v5: session replay.
       *
       * The DOM as it was, and every change to it, on the session's own clock.
       * Its own store for the same reason `media` has one: a replay log is
       * hundreds of kilobytes and a session listing must not pay for it. Keyed
       * `[sessionId, seq]` so the chunks come back in the order they were
       * written, with an index on `sessionId` for reading and deleting a
       * session's whole log in one range.
       *
       * Additive, like v4: two stores are created and nothing already on disk
       * is read or rewritten, so a profile with history upgrades by opening.
       */
      if (!db.objectStoreNames.contains('replay')) {
        const r = db.createObjectStore('replay', { keyPath: ['sessionId', 'seq'] });
        r.createIndex('sessionId', 'sessionId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 06-5: the watchdog or onblocked already rejected this open; a connection that arrives late would
      // be held for the life of the worker and block the next upgrade, so close it instead of leaking it.
      if (settled) { db.close(); return; }
      // If another context ever needs to upgrade, step aside rather than block it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null; // forced closed — reopen on next use
      };
      finish(resolve, db);
    };

    req.onerror = () => {
      dbPromise = null;
      finish(reject, req.error?.name === 'VersionError' // D-207: a newer database than this code
        ? withCode(new Error('This QA Wrap database was saved by a newer version. Update the extension, or erase all data to start again.'), 'DB_NEWER')
        : withCode(req.error || new Error('The QA Wrap database failed to open.'), 'DB_BROKEN'));
    };
  });
  return dbPromise;
}

// r2-06-3: core/ cannot import platform/, so the worker binds withDeadline(p, 'tx') here: reads and deleteMedia reject SLOW instead of hanging.
let bound = (p) => p;
export const bindTxDeadline = (fn) => { bound = typeof fn === 'function' ? fn : (p) => p; };
const bounded = (p, mode) => (mode === 'readonly' ? bound(p) : p);

function tx(store, mode, fn) {
  return bounded(openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        let result;
        try { result = fn(t.objectStore(store)); } catch (e) { try { t.abort(); } catch { /* already finished */ } throw e; }
        t.oncomplete = () => {
          // A box is told by its shape, not by holding a value: testing `__value !== undefined` resolved a miss to the
          // truthy box itself, so `getSession()` of a deleted id never threw (found by a field test, 31 Aug 2026).
          const boxed = result && typeof result === 'object' && '__value' in result;
          resolve(boxed ? result.__value ?? null : result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  ), mode);
}

/**
 * The same, over more than one store.
 *
 * IndexedDB will only span stores if they are named on the transaction when it
 * is opened, so this is the only way to make a write to `sessions` and a write
 * to `events` atomic with each other. `fn` is handed the transaction rather
 * than an object store, because with several stores there is no single one to
 * hand it.
 */
function txMulti(stores, mode, fn) {
  return bounded(openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result;
        try { result = fn(t); } catch (e) { try { t.abort(); } catch { /* already finished */ } throw e; } // never commit half of it
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  ), mode);
}

function reqValue(request) {
  const box = { __value: undefined };
  request.onsuccess = () => {
    box.__value = request.result;
  };
  return box;
}

/* ------------------------------------------------------------------ sessions */

export async function putSession(session) {
  await tx('sessions', 'readwrite', (s) => s.put(session));
  return session;
}

/**
 * The session row and its last events, written together or not at all: two transactions leave a window where the row says
 * "stopped" and the in-flight tail is not there yet. Compression and the failure flag are resolved first (an await inside a
 * transaction lets it auto-commit).
 */
export async function putSessionWithEvents(session, batch = []) {
  const list = (Array.isArray(batch) ? batch : [batch]).filter(Boolean);
  const records = [];
  for (const event of list) records.push(await deflateEvent({ ...event, fail: failFlag(event) }));
  await txMulti(['sessions', 'events'], 'readwrite', (t) => {
    t.objectStore('sessions').put(session);
    const events = t.objectStore('events');
    for (const record of records) events.add(record);
  });
  return { session, events: records };
}

export function getSession(id) {
  /*
   * A missing id is "no session", not an exception.
   *
   * `store.get(undefined)` throws "Failed to execute 'get' on
   * 'IDBObjectStore': No key or key range specified" — a message that names
   * IndexedDB and says nothing about what the caller did. Chasing it once cost
   * an hour: three separate features looked broken, and all any of them had
   * done was pass on a session id that was never set. Every caller here already
   * handles null by saying "unknown session", which is the honest answer.
   */
  if (id == null || id === '') return Promise.resolve(null);
  return tx('sessions', 'readonly', (s) => reqValue(s.get(id)));
}

export function listSessions() {
  return tx('sessions', 'readonly', (s) => reqValue(s.getAll())).then((rows) =>
    (rows || []).sort((a, b) => b.startedAt - a.startedAt)
  );
}

/**
 * Everything, in one pass: the tester asked for a clean machine. Store by store, each in its own
 * transaction (a deleteDatabase() blocks on any other tab holding a connection, and an old profile may
 * lack a store); only a database that will not open is deleted whole.
 */
export async function eraseEverything(stores) {
  const done = [];
  const failed = [];
  try { await openDb(); } catch { // D-1010-105: a database that will not open is deleted whole
    dbPromise = null;
    const r = indexedDB.deleteDatabase(DB_NAME);
    const ok = await new Promise((res) => { r.onsuccess = () => res(true); r.onerror = r.onblocked = () => res(false); });
    return ok ? { cleared: [...stores], failed } : { cleared: done, failed: ['database: could not be deleted'] };
  }
  for (const store of stores) {
    try {
      await bound(tx(store, 'readwrite', (s) => s.clear())); // r10-06-4: no retry on SLOW, the clear may still commit
      done.push(store);
    } catch (err) {
      failed.push(`${store}: ${err?.code === 'SLOW' ? 'did not answer in time' : String(err?.message || err)}`);
    }
  }
  return { cleared: done, failed };
}

export async function deleteSession(id) {
  // Replay first: a failure half-way leaves a session that can be deleted again, never an unlistable replay.
  await deleteReplay(id);
  // Clips (companions too: this bypasses deleteMedia's cascade) go with their mediaParts and mediaPending (r2-06-1).
  const clips = await listMedia(id, { companions: true });
  if (clips.length) {
    await txMulti(['media', 'mediaParts', 'mediaPending'], 'readwrite', (t) => {
      for (const m of clips) {
        t.objectStore('media').delete(m.id);
        t.objectStore('mediaParts').delete(IDBKeyRange.bound([m.id, -Infinity], [m.id, Infinity]));
        t.objectStore('mediaPending').delete(m.id);
      }
    });
  }
  for (const row of await listMediaPending()) if (row.sessionId === id) await clearMediaParts(row.id);
  // r2-06-1: events, captures and the row in ONE transaction, last: a failure leaves a session that can be deleted again.
  await txMulti(['events', 'captures', 'sessions'], 'readwrite', (t) => {
    const ev = t.objectStore('events');
    const cur = ev.index('sessionId').openCursor(IDBKeyRange.only(id)); // r10-06-3: captures go as the cursor passes, no pre-read
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      if (c.value.kind === 'screenshot' && c.value.captureId != null) t.objectStore('captures').delete(c.value.captureId);
      ev.delete(c.primaryKey);
      c.continue();
    };
    t.objectStore('sessions').delete(id);
  });
}

/** r2-06-1: remove events, captures and replay chunks no session owns (a late write). Live ids are re-read in the same transaction. */
export async function sweepOrphanRows(liveIds) {
  const live = new Set(liveIds instanceof Set ? liveIds : liveIds || []);
  const out = { events: 0, captures: 0, replay: 0 };
  await txMulti(['sessions', 'events', 'captures', 'replay'], 'readwrite', (t) => {
    const keys = t.objectStore('sessions').getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) live.add(k);
      const ev = t.objectStore('events');
      const cur = ev.index('sessionId').openKeyCursor();
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        if (!live.has(c.key)) { ev.delete(c.primaryKey); out.events += 1; }
        c.continue();
      };
      const rp = t.objectStore('replay');
      const rc = rp.index('sessionId').openKeyCursor(); // r4-06-3: a late replay chunk for a deleted session
      rc.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        if (!live.has(c.key)) { rp.delete(c.primaryKey); out.replay += 1; }
        c.continue();
      };
      const cs = t.objectStore('captures');
      const cc = cs.openCursor();
      cc.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        const sid = c.value?.sessionId;
        if (sid && !live.has(sid)) { cs.delete(c.primaryKey); out.captures += 1; }
        c.continue();
      };
    };
  });
  return out;
}

/* -------------------------------------------------------------------- events */

/* ── large bodies, stored compressed ─────────────────────────────────────── */

/**
 * How big a request or response body has to be before it is worth compressing.
 *
 * Below this the gzip header and the CompressionStream round trip cost more —
 * in bytes and in time — than they save; a 200-byte JSON payload can come out
 * *larger* gzipped. Above it the saving is the whole point: a session against a
 * chatty API is mostly response text, and the same text repeated across a
 * hundred requests deflates to a fraction of what it was.
 *
 * 8 KB, because that is roughly where a real API response stops being a status
 * envelope and starts being a payload.
 */
export const BODY_GZ_THRESHOLD = 8192;

/**
 * The fields on a `net` event that hold a body: the only ones big enough to be worth compressing.
 * `responsePreview` is a string and `reqBody` an object (`{ kind, text }` or `{ kind, note }`); both go through JSON,
 * so the shape comes back as it went in. Headers stay plain: the timeline filters on them.
 * Dormant today: `content/page-hooks.js` caps both at 2000 characters, below the threshold. The threshold is exported.
 */
const BODY_FIELDS = ['reqBody', 'responsePreview'];

/** How big one body field is, as it will actually be stored. */
const fieldSize = (v) => {
  if (v == null || v === '') return 0;
  return typeof v === 'string' ? v.length : JSON.stringify(v).length;
};

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function gunzip(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Move an event's large bodies into one gzipped `bodyGz` blob.
 *
 * One field and not one per body, because the two are almost always sent
 * together and gzip does better on their concatenation than on either alone —
 * a request and its echoed response share most of their vocabulary.
 *
 * Returns the event untouched when there is nothing worth compressing, so every
 * caller can run it unconditionally. A compression that fails returns the event
 * unchanged too: storing an event plainly is always better than not storing it.
 */
export async function deflateEvent(event) {
  if (!event || event.kind !== 'net' || event.bodyGz) return event;
  const present = BODY_FIELDS.filter((f) => event[f] != null && event[f] !== '');
  if (!present.length) return event;
  const size = present.reduce((n, f) => n + fieldSize(event[f]), 0);
  if (size <= BODY_GZ_THRESHOLD) return event;

  const bodies = {};
  for (const f of present) bodies[f] = event[f];
  try {
    const bodyGz = await gzip(JSON.stringify(bodies));
    const out = { ...event, bodyGz, bodyGzFields: present };
    for (const f of present) delete out[f];
    return out;
  } catch {
    return event;
  }
}

/**
 * Put the bodies back, so no reader in this codebase has to know they left.
 *
 * A `bodyGz` that will not inflate is not allowed to take the rest of the event
 * down with it — the status, the URL and the timing are still the evidence — so
 * the failure is recorded on the event as `bodyGzError` and the row is returned
 * without its bodies rather than thrown away.
 */
export async function inflateEvent(event) {
  if (!event?.bodyGz) return event;
  const out = { ...event };
  delete out.bodyGz;
  delete out.bodyGzFields;
  try {
    Object.assign(out, JSON.parse(await gunzip(event.bodyGz)));
  } catch (err) {
    out.bodyGzError = String(err?.message || err);
  }
  return out;
}

const inflateAll = (rows) => Promise.all((rows || []).map(inflateEvent));

/* -------------------------------------------------------------- appending */

export async function appendEvent(event) {
  const [record] = await appendEvents([event]);
  return record;
}

/**
 * A batch of events in ONE transaction, in the order given, all or nothing (one commit instead of one per event).
 * The failure flag and the body compression are resolved BEFORE the transaction opens: an `await` inside one lets
 * the transaction auto-commit and would drop every event after the first.
 */
export async function appendEvents(batch) {
  const list = (Array.isArray(batch) ? batch : [batch]).filter(Boolean);
  if (!list.length) return [];
  // The flag is derived here, once, so every reader agrees and the index is sound.
  const records = [];
  for (const event of list) records.push(await deflateEvent({ ...event, fail: failFlag(event) }));
  await tx('events', 'readwrite', (s) => {
    for (const record of records) s.add(record);
  });
  return records;
}

/** The rows exactly as stored — bodies still compressed. For callers that only
 *  need keys and kinds, such as the delete sweep, and must not pay to inflate. */
function rawEvents(sessionId) {
  return tx('events', 'readonly', (s) =>
    reqValue(s.index('sessionId').getAll(IDBKeyRange.only(sessionId)))
  ).then((rows) => (rows || []).sort((a, b) => a.ts - b.ts || a.seq - b.seq));
}

export function getEvents(sessionId) {
  return rawEvents(sessionId).then(inflateAll);
}

/** r10-07-3: a raw cursor; only rows of `kinds` are inflated and returned, in getEvents order. */
export function getEventsByKind(sessionId, kinds) {
  return tx('events', 'readonly', (s) => {
    const box = { __value: [] };
    const req = s.index('sessionId').openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (kinds.includes(c.value.kind)) box.__value.push(c.value);
      c.continue();
    };
    return box;
  }).then((rows) => inflateAll(rows.sort((a, b) => a.ts - b.ts || a.seq - b.seq)));
}

/** r10-06-2: capture-gap codes and a body-byte estimate from a session's newest `limit` rows (bodyGz counts compressed). */
export function seedStats(sessionId, limit = 50000) {
  return tx('events', 'readonly', (s) => {
    const box = { __value: { gaps: [], bytes: 0 } };
    let n = 0;
    const req = s.index('sessionId').openCursor(IDBKeyRange.only(sessionId), 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c || ++n > limit) return;
      const v = c.value;
      const st = box.__value;
      if (v.tag === 'capture-gap' && v.gap && !st.gaps.includes(v.gap)) st.gaps.push(v.gap);
      st.bytes += (v.bodyGz?.byteLength || 0) + fieldSize(v.reqBody) + fieldSize(v.responsePreview);
      c.continue();
    };
    return box;
  });
}

export function countEvents(sessionId) {
  return tx('events', 'readonly', (s) =>
    reqValue(s.index('sessionId').count(IDBKeyRange.only(sessionId)))
  );
}

/** O(log n) via the index — no reading the session's events. */
export function countFailures(sessionId) {
  return tx('events', 'readonly', (s) =>
    reqValue(s.index('bySessionFail').count(IDBKeyRange.only([sessionId, 1])))
  );
}

/**
 * Events added since a known sequence number.
 *
 * `seq` is the auto-incrementing primary key, so a lower-bound range on the
 * store itself walks only the new records — it never touches the ones already
 * on screen. The panel polls twice a second while recording; re-reading the
 * whole session each time is what made a long run crawl.
 */
export function getEventsSince(sessionId, sinceSeq = 0) {
  if (!sinceSeq) return getEvents(sessionId);
  // r3-07-4: this session's index, newest first, stopping at the first row already seen; other sessions are never read.
  return tx('events', 'readonly', (s) => {
    const box = { __value: [] };
    const req = s.index('sessionId').openCursor(IDBKeyRange.only(sessionId), 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (c && c.value.seq > sinceSeq) { box.__value.push(c.value); c.continue(); }
    };
    return box;
  })
    .then((rows) => rows.sort((a, b) => a.ts - b.ts || a.seq - b.seq))
    .then(inflateAll);
}

/**
 * When a session last recorded anything, or null if it never did.
 *
 * One record, not the whole session: this is asked at startup for every session
 * a crash stranded (see `reconcileInterrupted()` in the worker), and reading
 * every event of every one of them to look at the last `ts` would put the
 * entire history through memory on a cold start. A reverse cursor over the
 * `sessionId` index stops at the first hit, which is the highest primary key —
 * `seq` — and therefore the last event appended.
 */
export function lastEventTs(sessionId) {
  if (sessionId == null || sessionId === '') return Promise.resolve(null);
  return tx('events', 'readonly', (s) => {
    const box = { __value: null };
    const request = s.index('sessionId').openCursor(IDBKeyRange.only(sessionId), 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) box.__value = cursor.value?.ts ?? null;
    };
    return box;
  });
}

/* ------------------------------------------------------------------ captures */

/* ------------------------------------------------------------------- media */

export async function putMedia(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').put(record);
    tx.oncomplete = () => resolve(record.id);
    tx.onerror = () => reject(tx.error);
    // A quota failure on a multi-megabyte recording must be reported, not
    // swallowed — the tester needs to know the video is not there.
    tx.onabort = () => reject(tx.error || new Error('The recording could not be stored (disk quota).'));
  });
}

export async function getMedia(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('media', 'readonly').objectStore('media').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * A record that is a layer of another clip rather than a clip of its own.
 *
 * Today that is the webcam companion written beside a screen recording
 * (`research/106-webcam-track-and-formats-2026-09-17.md` §1). `role` is the one
 * field every reader filters on, and it is checked in this one function so that
 * the gallery, the counts, the timeline, the parts picker and every exporter
 * cannot each arrive at their own answer.
 */
export function isCompanion(record) {
  return !!record && record.role === 'webcam';
}

/**
 * Everything recorded in a session, without the payloads.
 *
 * The gallery needs names, sizes and durations to draw its cards; pulling the
 * Blobs too would move hundreds of megabytes to render a grid of thumbnails.
 *
 * **Companions are left out by default.** A webcam companion is a layer of its
 * parent, not a second recording, so a session with one clip in it must show
 * one card, count one clip and put one row in the timeline — anything else
 * tells the tester they recorded twice. Pass `{ companions: true }` where the
 * question really is "what is on disk under this session": the footprint the
 * Settings page offers to clear, and the erase that has to reach every byte.
 */
export async function listMedia(sessionId, { companions = false } = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db
      .transaction('media', 'readonly')
      .objectStore('media')
      .index('sessionId')
      .openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(out.sort((a, b) => a.ts - b.ts));
      const { blob, ...meta } = cursor.value;
      if (companions || !isCompanion(meta)) {
        out.push({ ...meta, bytes: blob?.size ?? meta.bytes ?? 0, type: blob?.type ?? meta.type });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a stored item, wherever it lives, and say whether it existed.
 * The transaction spans `media` and `captures` (a legacy screenshot lives in the latter, and deleting an absent key
 * succeeds), `count(id)` runs first in the same transaction so the answer is what was actually removed, and
 * `onabort` is handled as well as `onerror` so an aborted delete settles instead of hanging its callers.
 */
export async function deleteMedia(id) {
  /* A parent takes its companions with it (found before the transaction; `id` first, so the answer is about the clip asked for). */
  const ids = [id, ...(await companionIds(id).catch(() => []))];
  const db = await openDb();
  return bound(new Promise((resolve, reject) => {
    const stores = ['media', 'captures', 'mediaParts', 'mediaPending'].filter((name) =>
      db.objectStoreNames.contains(name)
    );
    const t = db.transaction(stores, 'readwrite');
    let hit = 0;
    for (const name of ['media', 'captures']) {
      if (!stores.includes(name)) continue;
      const store = t.objectStore(name);
      // Only the clip the caller named decides the answer; a companion that was
      // already gone must not make a real delete report "was never there", and
      // a companion that was there must not make a missing parent report a hit.
      const counted = store.count(id);
      counted.onsuccess = () => {
        if (counted.result > 0) hit += counted.result;
      };
      for (const each of ids) store.delete(each);
    }
    // Any half-written parts go with it. A clip deleted mid-write must not
    // leave its chunks behind for the boot-time recovery to resurrect.
    for (const each of ids) {
      if (stores.includes('mediaParts')) {
        t.objectStore('mediaParts').delete(IDBKeyRange.bound([each, -Infinity], [each, Infinity]));
      }
      if (stores.includes('mediaPending')) t.objectStore('mediaPending').delete(each);
    }
    t.oncomplete = () => resolve(hit > 0);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The delete was abandoned by the browser.'));
  }));
}

/* ------------------------------------------------- clips written as they run */

/** One chunk of a clip, on disk the moment MediaRecorder hands it over. */
export async function putMediaPart(id, seq, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('mediaParts', 'readwrite');
    t.objectStore('mediaParts').put({ id, seq, blob });
    t.oncomplete = () => resolve(seq);
    t.onerror = () => reject(t.error);
    t.onabort = () =>
      reject(t.error || new Error('A piece of the recording could not be stored (disk quota).'));
  });
}

/** The marker that says a clip is in progress, and what it is. */
export async function putMediaPending(meta) {
  await tx('mediaPending', 'readwrite', (s) => s.put(meta));
  return meta;
}

export function listMediaPending() {
  return tx('mediaPending', 'readonly', (s) => reqValue(s.getAll())).then((rows) => rows || []);
}

/** Every chunk of one clip, in the order it was written. */
export function mediaParts(id) {
  return tx('mediaParts', 'readonly', (s) =>
    reqValue(s.getAll(IDBKeyRange.bound([id, -Infinity], [id, Infinity])))
  ).then((rows) => (rows || []).sort((a, b) => a.seq - b.seq).map((r) => r.blob));
}

/**
 * Assemble a clip from its parts, store it, and drop the parts.
 *
 * `record.blob`, when present, is whatever the encoder flushed after the last
 * timeslice - the tail that never became a part - so it goes on the end.
 */
export async function assembleMedia(record, hash) {
  const parts = await mediaParts(record.id);
  const pieces = [...parts, ...(record.blob ? [record.blob] : [])];
  if (!pieces.length) throw Object.assign(new Error('Nothing of that recording was written to disk.'), { code: 'EMPTY' });
  const blob = new Blob(pieces, { type: record.type });
  const stored = { ...record, blob, type: blob.type || record.type, bytes: blob.size };
  if (hash) stored.sha256 = await hash(blob);
  await putMedia(stored);
  await clearMediaParts(record.id);
  return stored;
}

export async function clearMediaParts(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['mediaParts', 'mediaPending'], 'readwrite');
    t.objectStore('mediaParts').delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    t.objectStore('mediaPending').delete(id);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The recording parts could not be cleared.'));
  });
}

/**
 * Clips whose session no longer exists.
 *
 * Deleting a session deletes the clips it knows about, but a clip can be filed
 * *after* that - `UQA_OFF_STOP` can still be in flight when Delete lands - and
 * a clip recorded with no session at all carried `sessionId: null`, which
 * IndexedDB does not index, so `listMedia` could never find it. Either way the
 * bytes stayed on disk for ever under `unlimitedStorage`, reachable by nothing
 * and deletable by nobody. The retention sweep uses this to find them.
 */
/** The ids of every record filed as a layer of `parentId`. */
export async function companionIds(parentId) {
  if (parentId == null || parentId === '') return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    // A cursor and not an index: `parentId` is carried by a handful of records
    // out of everything a profile holds, and an index for it would be paid for
    // by a database version bump on every tester's disk to save a walk that
    // only ever runs when something is deleted.
    const req = db.transaction('media', 'readonly').objectStore('media').openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(out);
      if (cursor.value?.parentId === parentId) out.push(cursor.value.id);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listOrphanMedia(liveSessionIds) {
  const live = liveSessionIds instanceof Set ? liveSessionIds : new Set(liveSessionIds || []);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const rows = [];
    const req = db.transaction('media', 'readonly').objectStore('media').openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(orphansOf(rows, live));
      const { blob, ...meta } = cursor.value;
      rows.push({ ...meta, bytes: blob?.size ?? meta.bytes ?? 0 });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Which of those rows nothing can reach any more — pure, so it is testable.
 *
 * Two ways to be unreachable. A clip whose session is gone, which is what this
 * has always found. And, since §1 of `research/106`, a **companion whose parent
 * is gone**: it is filed under a live session, so no session sweep will ever
 * visit it, and it is filtered out of every listing by design, so nothing shows
 * it to anybody either. Without this it would be the one kind of recording that
 * is permanent by construction.
 */
export function orphansOf(rows, liveSessionIds) {
  const live = liveSessionIds instanceof Set ? liveSessionIds : new Set(liveSessionIds || []);
  const present = new Set((rows || []).map((r) => r.id));
  return (rows || []).filter(
    (r) => !r.sessionId || !live.has(r.sessionId) || (isCompanion(r) && !present.has(r.parentId))
  );
}

export async function putCapture(capture) {
  await tx('captures', 'readwrite', (s) => s.put(capture));
  return capture;
}

export function getCapture(id) {
  return tx('captures', 'readonly', (s) => reqValue(s.get(id)));
}

/**
 * Screenshots by id, wherever they live.
 *
 * They are written by `putMedia()` into the `media` store. The `captures` store
 * predates it and **nothing has written to it since** — `putCapture()` has a
 * definition and an import and no call site anywhere. So every export that
 * asked for images read an empty store and got none.
 *
 * A screenshot event carries `captureId` and `mediaId` holding the same value,
 * so one id finds the record in either place. The legacy lookup stays as a
 * fallback: a profile recorded before the media store existed still exports.
 */
export async function getCaptures(ids) {
  const out = {};
  for (const id of ids) {
    /*
     * Skip a missing id rather than handing it to IndexedDB.
     *
     * `store.get(undefined)` does not return null — it throws "No key or key
     * range specified", which rejects this whole function and takes the export
     * that called it with it. A stress run lost every one of twenty thousand
     * events to a single screenshot whose blob never landed. One absent
     * thumbnail may cost that thumbnail; it may not cost the session.
     */
    if (id == null || id === '') continue;
    const c = (await getMedia(id)) || (await getCapture(id));
    if (c) out[id] = c;
  }
  return out;
}

/* ── session replay ───────────────────────────────────────────────────────
 *
 * The log is written in chunks as the page produces them (a log held in a content script is lost to the first navigation),
 * each gzipped like the large event bodies. `gz` holds the bytes; `count` and `bytes` stay uncompressed beside it so the
 * report can size a replay without inflating it.
 */

/**
 * The next chunk number for a session, one counter for every page and frame.
 *
 * Each page's recorder numbers its own chunks from 0, and the store's key is
 * [sessionId, seq], so a second page (or tab, or iframe) overwrote the first
 * one's chunks. The worker is the only place that sees them all, so it numbers
 * them: seeded from the highest stored seq (a worker restart), then in-memory.
 */
const replaySeqs = new Map();
const settledSeqs = new WeakSet(); // OF-5: bounded, settled entries re-seed from the store
export const REPLAY_SEQ_MAX = 64;
export const replaySeqCount = () => replaySeqs.size;
function nextReplaySeq(sessionId) {
  // r8-06-5: the highest stored seq is one key at the end of the [sessionId, seq] range, not every chunk read and sorted.
  const prev = replaySeqs.get(sessionId) || (sessionId == null || sessionId === '' ? Promise.resolve(-1) : tx('replay', 'readonly', (s) => {
    const box = { __value: -1 };
    const c = s.openKeyCursor(IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]), 'prev');
    c.onsuccess = () => { if (c.result) box.__value = c.result.key[1]; };
    return box;
  }));
  const next = prev.then((n) => n + 1);
  replaySeqs.set(sessionId, next);
  next.then(() => { settledSeqs.add(next); for (const [k, p] of replaySeqs) if (replaySeqs.size > REPLAY_SEQ_MAX && settledSeqs.has(p)) replaySeqs.delete(k); }, () => {});
  // r4-06-3: a failed seed is not cached (it would restart at 0 over stored chunks); the caller sees the error and the next call re-reads.
  next.catch(() => { if (replaySeqs.get(sessionId) === next) replaySeqs.delete(sessionId); });
  return next;
}

/** Store one chunk of a session's replay log. `seq` is assigned here unless given. */
export async function putReplayChunk({ sessionId, seq, entries }) {
  if (!Number.isFinite(seq)) seq = await nextReplaySeq(sessionId);
  const json = JSON.stringify(entries || []);
  const record = {
    sessionId,
    seq,
    at: Date.now(),
    count: (entries || []).length,
    bytes: json.length,
  };
  try {
    record.gz = await gzip(json);
  } catch {
    // Storing it plainly beats not storing it: the replay is evidence.
    record.json = json;
  }
  await tx('replay', 'readwrite', (s) => s.put(record));
  return { seq, count: record.count, bytes: record.bytes, stored: record.gz ? record.gz.byteLength : json.length };
}

/** Every chunk of a session's log, in order, still compressed. */
function rawReplay(sessionId) {
  if (sessionId == null || sessionId === '') return Promise.resolve([]);
  return tx('replay', 'readonly', (s) =>
    reqValue(s.index('sessionId').getAll(IDBKeyRange.only(sessionId)))
  ).then((rows) => (rows || []).sort((a, b) => a.seq - b.seq));
}

/**
 * The whole log, inflated and concatenated.
 *
 * A chunk that will not inflate is skipped and counted rather than thrown: the
 * rest of the replay is still watchable, and a replay that refuses to open
 * because one chunk is corrupt is worse than one with a gap in it.
 */
export async function getReplay(sessionId) {
  const rows = await rawReplay(sessionId);
  const entries = [];
  let unreadable = 0;
  let stored = 0;
  for (const row of rows) {
    stored += row.gz ? row.gz.byteLength : (row.json?.length || 0);
    try {
      const text = row.gz ? await gunzip(row.gz) : row.json;
      const part = JSON.parse(text);
      if (Array.isArray(part)) entries.push(...part);
    } catch {
      unreadable++;
    }
  }
  return { entries, chunks: rows.length, unreadable, stored };
}

/** How big a session's replay is, without inflating a byte of it. */
export async function replaySize(sessionId) {
  const rows = await rawReplay(sessionId);
  return {
    chunks: rows.length,
    entries: rows.reduce((n, r) => n + (r.count || 0), 0),
    raw: rows.reduce((n, r) => n + (r.bytes || 0), 0),
    stored: rows.reduce((n, r) => n + (r.gz ? r.gz.byteLength : r.json?.length || 0), 0),
  };
}

/** Drop a session's replay. Called when its session is deleted or purged. */
export function deleteReplay(sessionId) {
  replaySeqs.delete(sessionId);
  return tx('replay', 'readwrite', (s) => {
    const req = s.index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      s.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}
