/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Settings, Files: "Apply folder icons" and "Restore plain folders" (Windows only; the block stays hidden elsewhere).
 * The work is the updater host's (ui/folder-icons.js); this file is the two presses and the line that says what happened.
 */
import { folderIcons } from '../ui/folder-icons.js';
import { detectOS } from '../ui/update-lib.js';

const tr = (k, v) => globalThis.QAWi18n.t(k, v);

async function mount(doc) {
  const box = doc.getElementById('folder-icons');
  if (!box || detectOS() !== 'win') return;
  await globalThis.QAWi18n.ready();
  box.hidden = false;
  const state = doc.getElementById('folder-icons-state');
  const say = (res, done) => {
    state.textContent = res.ok ? tr(done, { n: res.folders ?? 0 })
      : tr(res.code === 'OLD_HELPER' ? 'options.files.iconsOldHelper' : res.code === 'NO_HELPER' ? 'options.files.iconsNoHelper' : 'options.files.iconsFailed', { error: res.error || '' });
  };
  const press = (id, action, done) => doc.getElementById(id).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await Promise.resolve(chrome.permissions?.request?.({ permissions: ['nativeMessaging'] })).catch(() => false); // inside the press
    btn.disabled = true;
    state.textContent = tr('options.files.iconsWorking');
    try {
      const res = await folderIcons(action);
      say(res, res.ok && action === 'apply' && !res.roots ? 'options.files.iconsNone' : done);
    } finally { btn.disabled = false; }
  });
  press('folder-icons-apply', 'apply', 'options.files.iconsApplied');
  press('folder-icons-reset', 'reset', 'options.files.iconsReset');
  const on = (/** @type {any} */ (await chrome.storage.local.get('folderIcons').catch(() => ({})))).folderIcons !== false; // on by default
  if (on) state.textContent = tr('options.files.iconsOn');
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) mount(document).catch(() => {});
