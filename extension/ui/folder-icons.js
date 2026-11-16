/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Folder icons (Windows): QA Wrap's own icons on its download folders, in Explorer.
 *
 * A browser cannot do this: Explorer reads a folder's icon from a hidden desktop.ini and only when the folder carries a flag, and no
 * web or extension API writes either. The updater host can (updater/host.ps1, op "icons"), so this is one message to it. The host
 * finds the folders itself: a folder named "QA Wrap" with a category folder in it, inside Downloads or at a path read here from
 * this extension's own downloads. Folders only; no file is touched.
 *
 *   folderIcons(action)  'apply' | 'reset' | 'refresh' | 'status'  ->  the host's answer, or { ok: false, code }
 *   refreshSoon()        after a save: a few seconds later, dress the folders that save made (on by default; off after Restore plain folders)
 *
 * Codes: NO_HELPER (the host is not installed, or nativeMessaging is not granted), OLD_HELPER (installed before this op existed:
 * run updater\install.cmd again), FAILED (the host's own error text is in `error`).
 */
import { HOST } from './update-lib.js';

const KEY = 'folderIcons'; // chrome.storage.local: on unless false ("Restore plain folders" writes false, "Apply folder icons" true)
const ROOT = /^(.*[\\/]QA Wrap)[\\/]/i;

/** The QA Wrap folders this extension's own downloads went into, as absolute paths (the only place a path can be learned). */
async function ownRoots(api) {
  const items = await Promise.resolve(api.downloads?.search?.({ limit: 40, orderBy: ['-startTime'] })).catch(() => []);
  const roots = new Set();
  for (const d of items || []) {
    const m = d.byExtensionId === api.runtime.id ? ROOT.exec(d.filename || '') : null;
    if (m) roots.add(m[1]);
  }
  return [...roots];
}

export async function folderIcons(action, api = globalThis.chrome) {
  const granted = await Promise.resolve(api.permissions?.contains?.({ permissions: ['nativeMessaging'] })).catch(() => false);
  if (!granted || !api.runtime?.sendNativeMessage) return { ok: false, code: 'NO_HELPER' };
  const roots = action === 'apply' || action === 'refresh' ? await ownRoots(api) : [];
  const res = await new Promise((resolve) => {
    try { api.runtime.sendNativeMessage(HOST, { op: 'icons', action, roots }, (r) => resolve(api.runtime.lastError ? null : r)); } catch { resolve(null); }
  });
  if (!res) return { ok: false, code: 'NO_HELPER' };
  if (!res.ok) return { ok: false, code: /unknown op/i.test(res.error || '') ? 'OLD_HELPER' : 'FAILED', error: res.error };
  if (action === 'apply' || action === 'reset') await api.storage.local.set({ [KEY]: action === 'apply' }).catch(() => {});
  return res;
}

let timer = null;
/** Several saves in a row are one refresh, after the last of them has had time to land. */
export function refreshSoon(api = globalThis.chrome, ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const on = (await api.storage.local.get(KEY).catch(() => ({})))[KEY] !== false;
    if (on) folderIcons('refresh', api).catch(() => {});
  }, ms);
}
