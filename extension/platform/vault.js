/* QA Wrap — at-rest vault: AES-GCM ciphertext only; limits in work/round3/VAULT-detail.md */
// @ts-nocheck
import { withDeadline, slow, DEADLINES } from './deadline.js';
const REC = 'qw0';
const AES = { name: 'AES-GCM' };
const b64 = (u) => { const a = new Uint8Array(u); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); }; // r8-13-1: 8 KB slices, not one spread
const unb = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const req = (r) => new Promise((ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error))));
const imp = (raw) => crypto.subtle.importKey('raw', unb(raw), AES, false, ['encrypt', 'decrypt']);
const dec = async (rec, key) => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ ...AES, iv: unb(rec.iv) }, key, unb(rec.ct))));
const sess = { get: (k) => chrome.storage.session.get(k), set: (v) => chrome.storage.session.set(v), remove: (k) => chrome.storage.session?.remove(k) };
export const LOCKED = 'Unlock QA Wrap to file';
export const UNREADABLE = 'Saved credentials could not be read on this profile; nothing was overwritten.';
const unreadable = () => Object.assign(new Error(UNREADABLE), { code: 'VAULT_UNREADABLE' });
let dk;
export const dropKeyCache = () => { dk = null; }; // tests

// device key: non-extractable, made once, kept in this origin's IndexedDB; `mint: false` never makes one
// A stalled open REJECTS (and clears the memo so the next call retries); it never makes or replaces a key.
const deviceKey = (mint = true) => {
  if (dk) return dk;
  let dead = false;
  const mine = (async () => {
    const o = indexedDB.open('qw');
    o.onupgradeneeded = () => o.result.createObjectStore('k');
    const blocked = new Promise((_, no) => { o.onblocked = () => no(slow('deviceKey-blocked', DEADLINES.deviceKey)); });
    const db = await Promise.race([req(o), blocked]);
    if (dead) { db.close(); throw slow('deviceKey', DEADLINES.deviceKey); }
    let k = await req(db.transaction('k').objectStore('k').get(0));
    if (!k && !mint) { db.close(); dk = null; return null; }
    if (!k) {
      if (dead) { db.close(); throw slow('deviceKey', DEADLINES.deviceKey); }
      k = await crypto.subtle.generateKey({ ...AES, length: 256 }, false, ['encrypt', 'decrypt']);
      if (dead) { db.close(); throw slow('deviceKey', DEADLINES.deviceKey); }
      const t = db.transaction('k', 'readwrite');
      t.objectStore('k').put(k, 0);
      await new Promise((ok, no) => ((t.oncomplete = ok), (t.onerror = () => no(t.error))));
    }
    db.close();
    return k;
  })();
  mine.catch(() => {});
  const guarded = withDeadline(mine, 'deviceKey', DEADLINES.deviceKey, () => { dead = true; });
  dk = guarded.catch((e) => { if (dk === guarded2) dk = null; return Promise.reject(e); });
  const guarded2 = dk;
  return dk;
};

// D-210: the alarm fires the idle lock even when nothing reads the vault
const idleAlarm = (r) => chrome.alarms?.create?.('qaw-vault-idle', { delayInMinutes: Math.max(1, r.idle || 30) });

// null while a passphrase lock is closed or idled out
async function activeKey(r) {
  if (r.m !== 'p') return deviceKey(false);
  const { qwk } = await sess.get('qwk');
  if (!qwk || Date.now() - qwk.t > (r.idle || 30) * 6e4) return void (await sess.remove('qwk'));
  if (Date.now() - qwk.t > 6e4) { sess.set({ qwk: { ...qwk, t: Date.now() } }); idleAlarm(r); }
  return imp(qwk.k);
}

export async function readVault() {
  const { [REC]: rec } = await chrome.storage.local.get(REC);
  if (!rec) return { none: true };
  const key = await activeKey(rec);
  if (!key) return rec.m === 'p' ? { locked: true, rec } : { unreadable: true, rec };
  try {
    return { data: await dec(rec, key), rec };
  } catch {
    return { unreadable: true, rec }; // key gone or replaced: never read as "empty"
  }
}

const loc = async (k) => (await chrome.storage.local.get(k))[k];
const seal = async (v, key) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ ...AES, iv }, key, new TextEncoder().encode(JSON.stringify(v)))) }; };

export async function writeVault(data, opt = {}) {
  const old = await loc(REC);
  const key = opt.key || (old ? await activeKey(old) : await deviceKey());
  if (!key) throw old?.m === 'p' ? new Error(LOCKED) : unreadable();
  // never overwrite a blob this profile cannot open (T-011)
  if (old && !opt.key && !(await dec(old, key).then(() => true, () => false))) throw unreadable();
  const { m, s, i, idle } = old || {};
  await chrome.storage.local.set({ ...opt.also, [REC]: { v: 1, ...(opt.extra || (m === 'p' ? { m, s, i, idle } : {})), ...(await seal(data, key)) } });
}

// r4-02-2 (D-1010-71): cookie profiles and API variables are sealed blobs under their own keys, same key as qw0,
// so Erase all drops them without an unlock; an older build's plaintext is replaced once the blob reads back.
const SEALED = ['cookieProfiles', 'apiEnvironments'];
const isSealed = (b) => b?.qws === 1;
async function sealKey(rec, mint) {
  const k = rec ? await activeKey(rec) : await deviceKey(mint);
  if (!k) throw rec?.m === 'p' ? Object.assign(new Error(LOCKED), { code: 'VAULT_LOCKED' }) : unreadable();
  return k;
}
export async function saveSealed(name, value) {
  const cur = await loc(name);
  const key = await sealKey(await loc(REC), true);
  if (isSealed(cur) && !(await dec(cur, key).then(() => true, () => false))) throw unreadable();
  await chrome.storage.local.set({ [name]: { qws: 1, ...(await seal(value, key)) } });
  const back = await loc(name);
  if (!isSealed(back) || JSON.stringify(await dec(back, key).catch(() => 0)) !== JSON.stringify(value)) {
    await (cur === undefined ? chrome.storage.local.remove(name) : chrome.storage.local.set({ [name]: cur })); // the old copy stays
    throw new Error('Could not save to the encrypted vault.');
  }
}
export async function loadSealed(name) {
  const raw = await loc(name);
  if (isSealed(raw)) return dec(raw, await sealKey(await loc(REC), false)).catch(() => { throw unreadable(); });
  if (raw !== undefined) await saveSealed(name, raw).catch((e) => { if (e.code === 'VAULT_LOCKED') throw e; }); // plaintext stays unless sealed
  return raw;
}

export const lockVault = () => sess.remove('qwk');
export const forgetVault = () => Promise.all([chrome.storage.local.remove(REC), lockVault()]);

// D-1010-56: the floor holds where the key is stored, not only on the page that derives it.
export const PBKDF2_FLOOR = 600000;
const bytesOf = (v) => { try { return typeof v === 'string' && v ? unb(v).length : -1; } catch { return -1; } };
const refuse = (field, why) => Object.assign(new Error(`Passphrase refused: ${field} ${why}.`), { code: 'VAULT_PASS_INVALID', field });
function checkPass(raw, s, i, idle) {
  if (bytesOf(raw) !== 32) throw refuse('key', 'must be 32 bytes');
  if (bytesOf(s) < 16) throw refuse('salt', 'must be at least 16 bytes');
  if (!Number.isInteger(i) || i < PBKDF2_FLOOR) throw refuse('iters', `must be a whole number of ${PBKDF2_FLOOR} or more`);
  if (idle != null && !(Number.isInteger(idle) && idle >= 1 && idle <= 240)) throw refuse('idle', 'must be 1 to 240 minutes');
}

const wait = { n: 0, until: 0 }; // D-210: after 5 wrong tries, 2 s doubling to 30 s (kept in memory, so a worker restart clears it)
// raw = key the page derived (PBKDF2); refused unless it opens the record
export async function unlockVault(raw) {
  const { [REC]: rec } = await chrome.storage.local.get(REC);
  if (rec?.m !== 'p') return;
  if (wait.until > Date.now()) throw Object.assign(new Error('Wrong passphrase.'), { code: 'VAULT_BACKOFF', retryMs: wait.until - Date.now() });
  await dec(rec, await imp(raw)).catch(() => {
    if (++wait.n >= 5) wait.until = Date.now() + Math.min(30000, 2000 * 2 ** (wait.n - 5));
    throw new Error('Wrong passphrase.');
  });
  wait.n = wait.until = 0;
  await sess.set({ qwk: { k: raw, t: Date.now() } });
  idleAlarm(rec);
  // Opened (so the tester can reach setPass), but a record made below the floor asks for a new passphrase.
  if (!(rec.i >= PBKDF2_FLOOR)) throw Object.assign(new Error('This passphrase was set with too few key-derivation rounds. Set a new passphrase.'), { code: 'VAULT_REKEY' });
}

// set/change the passphrase, or remove it (raw null); needs the vault unlocked
export async function setPass(raw, s, i, idle) {
  const v = await readVault();
  if (v.locked) throw new Error(LOCKED);
  if (v.unreadable) throw unreadable();
  if (raw) checkPass(raw, s, i, idle); // before any write: a refused call changes nothing
  const nk = raw ? await imp(raw) : await deviceKey();
  const also = {};
  for (const n of SEALED) { const b = await loc(n); if (isSealed(b)) try { also[n] = { qws: 1, ...(await seal(await dec(b, await sealKey(v.rec, false)), nk)) }; } catch { /* unreadable stays */ } } // one set: no blob is left under the old key
  await writeVault(v.data || {}, { key: nk, also, extra: raw ? { m: 'p', s, i, idle: idle || 30 } : {} });
  await (raw ? sess.set({ qwk: { k: raw, t: Date.now() } }) : lockVault());
}

export async function vaultState() {
  const { rec, locked } = await readVault();
  return { pass: rec?.m === 'p', locked: !!locked, salt: rec?.s, iters: rec?.i, idle: rec?.idle || 30 };
}
