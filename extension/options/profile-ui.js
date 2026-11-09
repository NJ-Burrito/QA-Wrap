/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The Profile block on the Settings page (Sessions card): the optional picture and the Verify file action.
 * The name is the existing "Your name" field (`testerName`); core/profile.js reads it, with this picture, for every export.
 *
 * Verify file reads a sealed timeline the person chooses and shows intact or altered, who signed it, the key's
 * fingerprint, and whether that key is this install's. It never uploads anything: the file is read here and checked here.
 */
import { verifyMarkdown, shortFingerprint } from '../core/seal.js';
import { cleanPicture } from '../core/profile.js';
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

  const paint = () => {
    const pic = cleanPicture(getSettings()?.profilePicture);
    preview.hidden = !pic;
    if (pic) preview.src = pic; else preview.removeAttribute('src');
    remove.hidden = !pic;
    pick.textContent = t(pic ? 'profile.pictureChange' : 'profile.pictureChoose');
  };

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
