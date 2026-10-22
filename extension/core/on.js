/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Register an async listener that cannot poison the worker.
 *
 * `chrome.x.onY.addListener(async () => …)` looks harmless and is not: the
 * returned promise belongs to nobody, so a throw becomes an unhandled
 * rejection, and Chrome puts every one of those on the extension's card as an
 * error the tester has to clear by hand. On a listener that fires per
 * navigation, one bad page is enough to make a working extension look broken.
 *
 * The failure still matters — it is logged with the event that caused it, which
 * is more than the badge ever said.
 *
 * It lives in its own file because three registrars need it — the worker,
 * `background/armed.js` and `background/context-menus.js` — and the two modules
 * that could not reach the worker's copy simply went without, which is how
 * `armed.js`'s window listener and the whole context menu ended up unwrapped.
 * A second copy would have drifted; an import cannot.
 */
import { redact } from './privacy.js';

export function on(event, name, fn) {
  event?.addListener((...args) => {
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => {
        console.warn(`[QA Wrap] ${name} failed:`, err?.message || err);
        ring(name, err);
      });
  });
}

/**
 * The test oracle (T-055): boot-smoke and the truth harness fail when a page or
 * worker console carries this line. One regexp, so the warning and its reader
 * cannot drift apart (tools/test-on-oracle.mjs).
 */
export const ON_FAILED = /^\[QA Wrap\] .+ failed:/;

/** Last handler failures, newest last, for the opt-in support bundle (T-063). Local, never sent. */
export const RING_KEY = 'handlerRing';
export const RING_MAX = 50;
/** A handler that throws on every event must not write storage on every event: the same failure inside this window is not stored again. */
export const RING_REPEAT_MS = 5000;
let chain = Promise.resolve();
let lastSig = '';
let lastAt = 0;
// Serialised: two failures a tick apart used to read the same old array and one row was lost.
// D-1010-57 / r3-03-3: a failure message can quote a typed value, a page address or a host. It is masked and stripped
// before it is written, so what rests on disk is already clean (the support bundle and Erase all both see only that).
const URLISH = /\b[a-z][\w+.-]*:\/\/[^\s"'<>)]+|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b|\b(?:[\w-]+\.)+(?:com|net|org|io|dev|app|co|gov|edu|local|test|internal|example|sa|ae|eg|uk|de|fr)\b(?::\d+)?/gi;
export const cleanMessage = (m) => redact(String(m ?? '')).text.replace(URLISH, '[url]');
export function ring(name, err) {
  const row = { t: Date.now(), name: String(name).slice(0, 60), msg: cleanMessage(err?.message || err).slice(0, 160) };
  const sig = `${row.name}
${row.msg}`;
  if (sig === lastSig && row.t - lastAt < RING_REPEAT_MS) return chain;
  lastSig = sig; lastAt = row.t;
  chain = chain.then(async () => {
    try {
      const store = globalThis.chrome?.storage?.local;
      if (!store) return;
      const { [RING_KEY]: old } = await store.get(RING_KEY);
      await store.set({ [RING_KEY]: [...(Array.isArray(old) ? old : []), row].slice(-RING_MAX) });
    } catch { /* the ring must never turn one failure into two */ }
  });
  return chain;
}
