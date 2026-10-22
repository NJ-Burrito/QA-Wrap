/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unsent text survives a closed popup (REQ-P1-4).
 * so the unit test runs it in Node with a fake area. Contract C6:
 */
import { redact } from '../core/privacy.js';

export const DRAFT_KEY = 'popupDraft';
export const DRAFT_CAP = 2048;
export const DRAFT_DELAY_MS = 400;
export const DRAFT_FIELDS = ['note', 'charter'];

/** @param {string} text @param {number} cap bytes (UTF-8): Arabic costs two per letter. */
export function capBytes(text, cap) {
  const enc = new TextEncoder();
  let s = String(text ?? '');
  if (enc.encode(s).length <= cap) return s;
  // Cut by code point so a surrogate pair is never split, then walk back to fit.
  const pts = Array.from(s);
  let n = Math.min(pts.length, cap);
  while (n > 0 && enc.encode(pts.slice(0, n).join('')).length > cap) n = Math.floor(n * 0.9) || n - 1;
  while (n < pts.length && enc.encode(pts.slice(0, n + 1).join('')).length <= cap) n++;
  return pts.slice(0, n).join('');
}

/**
 * @param {{ area?: { get(k: string): Promise<any>, set(o: object): Promise<void>, remove(k: string): Promise<void> }, key?: string, cap?: number, delay?: number, mask?: (t: string) => string }} [opts]
 */
export function createDraft({ area, key = DRAFT_KEY, cap = DRAFT_CAP, delay = DRAFT_DELAY_MS, mask } = {}) {
  const store = area ?? globalThis.chrome?.storage?.session;
  const mk = mask ?? ((t) => redact(t).text);
  /** @type {{ note: string, charter: string }} */
  const cur = { note: '', charter: '' };
  /** @type {string | null} */
  let sessionId = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let gen = 0; // bumped by clear(): a write already in flight must not bring the draft back

  /** @type {Array<(ok: boolean) => void>} */
  let waiting = [];
  const empty = () => !cur.note && !cur.charter;

  async function write() {
    timer = null;
    if (!store) return false;
    const mine = gen;
    if (empty()) { await store.remove(key); return true; }
    let note;
    let charter;
    try {
      note = capBytes(mk(cur.note), cap);
      charter = capBytes(mk(cur.charter), cap);
    } catch {
      return false; // a masker that throws stores nothing: failing open would keep the secret
    }
    if (mine !== gen) return false;
    await store.set({ [key]: { sessionId, note, charter, ts: Date.now() } });
    return true;
  }

  /** One write; every save() that was waiting on it gets the answer. */
  async function flushNow() {
    const done = waiting;
    waiting = [];
    let ok = false;
    try { ok = await write(); } catch { ok = false; }
    for (const r of done) r(ok);
    return ok;
  }

  return {
    /** Load this session's draft: `{note, charter, ts}`, or null. A draft of another session is dropped. */
    async restore(id) {
      sessionId = id ?? null;
      if (!store) return null;
      let rec;
      try { rec = (await store.get(key))?.[key]; } catch { return null; }
      if (!rec || typeof rec !== 'object') return null;
      if ((rec.sessionId ?? null) !== sessionId) { await store.remove(key); return null; }
      cur.note = typeof rec.note === 'string' ? rec.note : '';
      cur.charter = typeof rec.charter === 'string' ? rec.charter : '';
      if (empty()) return null;
      return { note: cur.note, charter: cur.charter, ts: Number(rec.ts) || 0 };
    },
    /** Remember `text` for `field`; the write is debounced. Resolves when it has been written. */
    save(text, field = 'note') {
      if (!DRAFT_FIELDS.includes(field)) return Promise.resolve(false);
      cur[field] = String(text ?? '');
      if (timer) clearTimeout(timer);
      return new Promise((resolve) => {
        waiting.push(resolve);
        timer = setTimeout(() => { flushNow(); }, delay);
      });
    },
    /** Write now (popup `pagehide`). */
    async flush() {
      if (timer) clearTimeout(timer);
      return flushNow();
    },
    /** A successful send, or the session was deleted: forget the draft. */
    async clear() {
      gen++;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const r of waiting.splice(0)) r(false);
      cur.note = '';
      cur.charter = '';
      if (store) await store.remove(key);
    },
  };
}
