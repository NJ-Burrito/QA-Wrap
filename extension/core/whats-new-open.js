/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** After an update (runtime.onInstalled, reason 'update'): open "What's new in vX" once. Lazy; the worker imports it on that event only. Writes nothing but the key it clears. */
export async function open(details, chromeApi = globalThis.chrome) {
  const v = chromeApi.runtime.getManifest().version;
  /** @type {any} */ const { qawPendingNotes: p } = await chromeApi.storage.local.get('qawPendingNotes');
  if (!(p && p.version === v) && details?.previousVersion === v) return false; // a plain reload, not an update
  await chromeApi.tabs.create({ url: chromeApi.runtime.getURL('whatsnew/whatsnew.html') });
  return true;
}
