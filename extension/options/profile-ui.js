/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The Profile tab on the Settings page: the optional picture, the name in English and in Arabic, and the Verify file action.
 * The names are `profileNameEn` and `profileNameAr`; `testerName` stays as the single fallback name (English one, else Arabic)
 * and, for a profile that has only that, is migrated into the field matching its script (core/profile.js normaliseProfile).
 * core/profile.js reads all of them, with this picture, for every export and for the top bar.
 *
 * Verify file reads a sealed timeline the person chooses and shows intact or altered, who signed it, the key's
 * fingerprint, and whether that key is this install's. It never uploads anything: the file is read here and checked here.
 */
import { verifyMarkdown, shortFingerprint } from '../core/seal.js';
import { cleanPicture, cleanName, normaliseProfile } from '../core/profile.js';
import { ownFingerprint } from '../platform/seal-key.js';

const AVATAR = 128;
const VERIFY_MAX = 20 * 1024 * 1024;

/** A square, centre-cropped copy of an image file as a small data URL. */
export async function toAvatar(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = c.height = AVATAR;
  const k = Math.max(AVATAR / bmp.width, AVATAR / bmp.height);
  const w = bmp.width * k, h = bmp.height * k;
  c.getContext('2d')?.drawImage(bmp, (AVATAR - w) / 2, (AVATAR - h) / 2, w, h);
  bmp.close?.();
  return c.toDataURL('image/webp', 0.85);
}

/**
 * What Verify file says, as an ordered list of [role, text] lines. Pure: the words come from `t`, so a test can run it.
 * @param {import('../core/seal.js').Verdict} v
 * @param {(key: string, vars?: any) => string} t
 */
export function verdictLines(v, t) {
  const lines = [[v.status === 'intact' ? 'ok' : 'bad', t(`verify.${v.status}`)]];
  if (v.status === 'intact' || v.status === 'altered') {
    for (const r of v.reasons) lines.push(['why', t(`verify.reason.${r}`)]);
    lines.push(['info', t('verify.signer', { name: v.signer || t('verify.noName') })]);
    lines.push(['info', t('verify.date', { date: v.date })]);
    lines.push(['info', t('verify.tool', { tool: v.tool })]);
    lines.push(['info', t('verify.fingerprint', { fp: shortFingerprint(v.fingerprint) })]);
    lines.push(['info', v.sameInstall === true ? t('verify.sameKey') : v.sameInstall === false ? t('verify.otherKey') : t('verify.noOwnKey')]);
  }
  lines.push(['note', t('verify.caveat')]);
  return lines;
}

/**
 * @param {{ $: (id: string) => HTMLElement|null, t: (k: string, v?: any) => string, save: (patch: any, o?: any) => void,
 *   getSettings: () => any }} env
 */
export function wireProfile({ $, t, save, getSettings }) {
  const pick = /** @type {HTMLButtonElement|null} */ ($('profile-picture-pick'));
  if (!pick) return { paint() {} };
  const file = /** @type {HTMLInputElement} */ ($('profile-picture-file'));
  const remove = /** @type {HTMLButtonElement} */ ($('profile-picture-remove'));
  const preview = /** @type {HTMLImageElement} */ ($('profile-picture-preview'));
  const status = /** @type {HTMLElement} */ ($('profile-picture-status'));

  const nameEn = /** @type {HTMLInputElement} */ ($('profileNameEn'));
  const nameAr = /** @type {HTMLInputElement} */ ($('profileNameAr'));

  const paint = () => {
    // The names show what the profile resolves to, so an older single name appears in the field for its script.
    // A field being typed in is never overwritten (a language change repaints the words, not the values).
    const p = normaliseProfile({ name: getSettings()?.testerName, nameAr: getSettings()?.profileNameAr, nameEn: getSettings()?.profileNameEn });
    if (nameEn && document.activeElement !== nameEn) nameEn.value = p.nameEn;
    if (nameAr && document.activeElement !== nameAr) nameAr.value = p.nameAr;
    const pic = cleanPicture(getSettings()?.profilePicture);
    preview.hidden = !pic;
    if (pic) preview.src = pic; else preview.removeAttribute('src');
    remove.hidden = !pic;
    pick.textContent = t(pic ? 'profile.pictureChange' : 'profile.pictureChoose');
  };

  /** Saves both names together, and the single fallback name beside them, so the three never disagree. */
  const saveNames = () => {
    const en = cleanName(nameEn.value), ar = cleanName(nameAr.value);
    save({ profileNameEn: en, profileNameAr: ar, testerName: en || ar }, { immediate: true });
  };
  nameEn?.addEventListener('change', saveNames);
  nameAr?.addEventListener('change', saveNames);

  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const url = cleanPicture(await toAvatar(f));
      if (!url) throw new Error('too big');
      save({ profilePicture: url }, { immediate: true });
      status.textContent = t('profile.pictureSaved');
    } catch { status.textContent = t('profile.pictureBad'); }
    paint();
  });
  remove.addEventListener('click', () => { save({ profilePicture: '' }, { immediate: true }); status.textContent = t('profile.pictureRemoved'); paint(); });

  const vfile = /** @type {HTMLInputElement} */ ($('verify-file'));
  const vpick = $('verify-pick');
  const out = /** @type {HTMLElement} */ ($('verify-result'));
  vpick?.addEventListener('click', () => vfile.click());
  vfile.addEventListener('change', async () => {
    const f = vfile.files?.[0];
    vfile.value = '';
    if (!f) return;
    out.hidden = false;
    out.replaceChildren();
    const say = (role, text) => { const p = document.createElement('p'); p.className = `verify-${role}`; p.style.margin = '2px 0'; if (role === 'ok' || role === 'bad') { p.style.fontWeight = '600'; p.dataset.verdict = role; } p.textContent = text; out.append(p); };
    if (f.size > VERIFY_MAX) { say('bad', t('verify.tooBig')); return; }
    say('info', t('verify.checking'));
    let verdict;
    try { verdict = await verifyMarkdown(await f.text(), { ownFingerprint: await ownFingerprint() }); } catch { out.replaceChildren(); say('bad', t('verify.readFail')); return; }
    out.replaceChildren();
    for (const [role, text] of verdictLines(verdict, t)) say(role, text);
    out.focus();
  });
  return { paint };
}

/**
 * The top bar's profile chip (ui/profile-chip.js) asks an open Settings tab, over a BroadcastChannel, to show a section
 * ("#sec-profile") and come forward; the tab answers so the chip does not open a second one. The tab bar already follows
 * the address, so setting the hash is the whole job.
 */
/** Held for the life of the page: a channel nobody references can be collected, and then it stops listening. */
let openSection = null;
export function wireOpenSection() {
  try {
    const bc = (openSection = new BroadcastChannel('qaw-open-section'));
    bc.onmessage = (e) => {
      const hash = e.data?.hash;
      if (typeof hash !== 'string' || !/^#sec-[a-z-]{1,30}$/.test(hash)) return;
      bc.postMessage({ ack: true });
      if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash;
      chrome.tabs.getCurrent?.((tab) => { if (tab?.id) { chrome.tabs.update(tab.id, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); } });
    };
  } catch { /* no BroadcastChannel: the chip opens a new tab */ }
}
