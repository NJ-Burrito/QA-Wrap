/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The AI-writing key (S-09). On the real chrome.storage.local it lives in the encrypted vault (platform/vault.js saveSealed and
 * loadSealed), so it obeys the passphrase lock and the idle lock like every other credential; a plaintext key left by an older build
 * is sealed on its first read. Any other storage-shaped object (a test double) keeps a plain read and write.
 */
import { saveSealed, loadSealed } from './vault.js';

/** The same name the AI core file calls AI_KEY_KEY (its test checks they agree); not imported, so no platform module reaches the model caller. */
const AI_KEY_KEY = 'aiWritingKey';

const real = (storage) => !!globalThis.chrome?.storage?.local && storage === globalThis.chrome.storage.local;

/** The stored key, or '' when there is none, the vault is locked or it cannot be read: never a throw. */
export async function readKey(storage) {
  if (real(storage)) return loadSealed(AI_KEY_KEY).then((v) => (typeof v === 'string' ? v : ''), () => '');
  const got = (await storage.get(AI_KEY_KEY)) || {};
  return typeof got[AI_KEY_KEY] === 'string' ? got[AI_KEY_KEY] : '';
}

export async function saveKey(storage, key) {
  if (real(storage)) return saveSealed(AI_KEY_KEY, String(key || '').trim());
  await storage.set({ [AI_KEY_KEY]: String(key || '').trim() });
}
