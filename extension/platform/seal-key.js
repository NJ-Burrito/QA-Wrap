/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * This install's signing key for the seal (core/seal.js).
 *
 * One ECDSA P-256 key pair per install, made the first time something is sealed. The private half is a non-extractable
 * WebCrypto key: it lives in this origin's IndexedDB (database `qw`, store `k`, the one the credential vault already
 * keeps its device key in, record `seal`), and no script, including ours, can read its bytes; it can only be asked to
 * sign. The public half is stored beside it as a JWK, so the fingerprint can be shown without touching the private key.
 *
 * Consequences, stated once: removing the extension, or clearing this browser profile's site data, removes the key, so
 * files sealed before that still verify (the public key travels inside each file) but are no longer "this install's".
 * "Erase all" does not delete the key: it holds no content, and deleting it would orphan every file already sealed.
 */
import { generateSealKey, fingerprintOf } from '../core/seal.js';

const DB = 'qw';
const STORE = 'k';
const KEY_ID = 'seal';
const OPEN_MS = 8000;

const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

function open() {
  const o = indexedDB.open(DB);
  o.onupgradeneeded = () => { if (!o.result.objectStoreNames.contains(STORE)) o.result.createObjectStore(STORE); };
  return Promise.race([
    req(o),
    new Promise((_, no) => { o.onblocked = () => no(new Error('The key store is held open by another page.')); }),
    new Promise((_, no) => setTimeout(() => no(new Error('The key store did not open.')), OPEN_MS)),
  ]);
}

/** @type {Promise<{ privateKey: CryptoKey, publicJwk: any, fingerprint: string }> | null} */
let cached = null;

/**
 * The install's key, made on first use. Two pages asking at once end up with the same key: the write is a
 * read-then-put inside one transaction, and whoever loses the race adopts the winner's record.
 * @param {{ mint?: boolean }} [o]  `mint: false` returns null instead of making a key (Verify never needs to make one)
 */
export function getSealKey({ mint = true } = {}) {
  if (cached) return cached;
  const run = (async () => {
    const db = await open();
    try {
      let rec = await req(db.transaction(STORE).objectStore(STORE).get(KEY_ID));
      if (!rec) {
        if (!mint) return null;
        const fresh = await generateSealKey();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        rec = await req(store.get(KEY_ID));
        if (!rec) { rec = { privateKey: fresh.privateKey, publicJwk: fresh.publicJwk, createdAt: Date.now() }; store.put(rec, KEY_ID); }
        await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = () => no(tx.error); tx.onabort = () => no(tx.error); });
      }
      return { privateKey: rec.privateKey, publicJwk: rec.publicJwk, fingerprint: await fingerprintOf(rec.publicJwk) };
    } finally { db.close(); }
  })();
  cached = /** @type {any} */ (run);
  run.then((v) => { if (!v) cached = null; }, () => { cached = null; });
  return /** @type {any} */ (run);
}

/** This install's key fingerprint, or '' if no key has been made yet (nothing was ever sealed here). */
export async function ownFingerprint() {
  try { return (await getSealKey({ mint: false }))?.fingerprint || ''; } catch { return ''; }
}

