/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The profile chip in the top bar: the person's picture beside their name, in the interface language.
 *
 * Every element marked `data-profile-chip` gets one. It reads the Settings record through the worker (the picture stays
 * local: no network, no remote image), repaints when Settings change or the language changes, and shows
 *   - a profile:      the picture (else an initials avatar) and the name for the interface language (the other one if
 *                     that one is empty); hover or keyboard focus lifts a card with the larger picture, both names and
 *                     "Edit profile";
 *   - no profile:     a quiet "Set up profile" chip.
 * Both open the Profile tab in Settings.
 *
 * `data-profile-ready="1"` is set on the slot once it has painted, so a test can wait for it instead of guessing.
 */
import { normaliseProfile, pickName, initials } from '../core/profile.js';

const I18N = () => /** @type {any} */ (globalThis).QAWi18n;
const t = (/** @type {string} */ k) => I18N()?.t?.(k) ?? k;
const lang = () => String(I18N()?.lang?.() || document.documentElement.lang || 'en').slice(0, 2);
const ICON_USER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>';
const CLOSE_DELAY = 140;
let serial = 0;

/**
 * @param {string} tag
 * @param {string} cls
 * @param {string} [text]
 */
function make(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Open Settings at the Profile tab. An open Settings tab is asked (BroadcastChannel) to show it and come forward; if
 * nothing answers in time, a new Settings tab is opened there. No worker round trip, no new message type.
 */
function openProfile() {
  const hash = '#sec-profile';
  const url = chrome.runtime.getURL(`options/options.html${hash}`);
  let answered = false;
  let bc = null;
  try {
    bc = new BroadcastChannel('qaw-open-section');
    bc.onmessage = (e) => { if (e.data?.ack) answered = true; };
    bc.postMessage({ hash });
  } catch { /* no channel: open the tab */ }
  window.setTimeout(() => {
    bc?.close();
    if (!answered) chrome.tabs.create({ url }).catch(() => {});
  }, 350);
}

/**
 * Draw the chip into `slot` from a settings record.
 * @param {HTMLElement} slot
 * @param {any} settings
 */
export function paintChip(slot, settings) {
  const p = normaliseProfile({ name: settings?.testerName, nameAr: settings?.profileNameAr, nameEn: settings?.profileNameEn, picture: settings?.profilePicture });
  const l = lang();
  const shown = pickName(p, l);
  slot.replaceChildren();

  if (!p.named && !p.picture) {
    const btn = /** @type {HTMLButtonElement} */ (make('button', 'pchip pchip-empty'));
    btn.type = 'button';
    btn.insertAdjacentHTML('afterbegin', ICON_USER);
    btn.append(make('span', 'pchip-name', t('profile.chipSetup')));
    btn.setAttribute('aria-label', t('profile.chipSetup'));
    btn.title = t('profile.chipSetup');
    btn.dataset.state = 'empty';
    btn.addEventListener('click', openProfile);
    slot.append(btn);
    slot.dataset.profileReady = '1';
    return;
  }

  const wrap = make('span', 'pchip-wrap');
  const id = `pcard-${++serial}`;
  const avatar = (/** @type {string} */ cls) => {
    const av = make('span', cls);
    if (p.picture) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = p.picture;
      img.decoding = 'async';
      av.append(img);
    } else av.textContent = initials(shown) || '·';
    return av;
  };
  const chip = /** @type {HTMLButtonElement} */ (make('button', 'pchip'));
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', id);
  chip.setAttribute('aria-label', shown ? `${t('profile.chipLabel')}: ${shown}` : t('profile.chipLabel'));
  chip.dataset.state = p.picture ? 'picture' : 'initials';
  chip.append(avatar('pchip-av'));
  const name = make('span', 'pchip-name', shown);
  name.dir = 'auto';
  chip.append(name);

  const card = make('div', 'pcard');
  card.id = id;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', t('profile.chipLabel'));
  card.append(avatar('pcard-av'));
  const names = make('div', 'pcard-names');
  // both names, the interface language's first; a name that is not set is not shown
  const rows = l === 'ar' ? [['ar', p.nameAr], ['en', p.nameEn]] : [['en', p.nameEn], ['ar', p.nameAr]];
  for (const [code, value] of rows) {
    if (!value) continue;
    const row = make('span', '', value);
    row.lang = code;
    row.dir = code === 'ar' ? 'rtl' : 'ltr';
    row.dataset.nameLang = code;
    names.append(row);
  }
  if (!names.childElementCount) names.append(make('span', '', shown));
  card.append(names);
  const edit = /** @type {HTMLButtonElement} */ (make('button', 'btn btn-sm pcard-edit', t('profile.edit')));
  edit.type = 'button';
  edit.addEventListener('click', openProfile);
  card.append(edit);
  wrap.append(chip, card);
  slot.append(wrap);

  /* open on hover and on focus; close on leave, on focus leaving, on Escape and on a press elsewhere */
  let timer = 0;
  const open = () => { clearTimeout(timer); wrap.classList.add('is-open'); chip.setAttribute('aria-expanded', 'true'); };
  const close = () => { clearTimeout(timer); wrap.classList.remove('is-open'); chip.setAttribute('aria-expanded', 'false'); };
  const later = () => { clearTimeout(timer); timer = window.setTimeout(close, CLOSE_DELAY); };
  wrap.addEventListener('mouseenter', open);
  wrap.addEventListener('mouseleave', later);
  let quiet = false; // true while Escape hands focus back to the chip, so that focus does not reopen the card
  wrap.addEventListener('focusin', () => { if (!quiet) open(); });
  wrap.addEventListener('focusout', (e) => { if (!wrap.contains(/** @type {Node|null} */ (e.relatedTarget))) later(); });
  chip.addEventListener('click', open);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrap.classList.contains('is-open')) { e.stopPropagation(); close(); quiet = true; chip.focus(); quiet = false; }
  });
  slot.dataset.profileReady = '1';
}

/* a press anywhere outside an open card closes it (one listener for every chip on the page) */
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    for (const w of document.querySelectorAll('.pchip-wrap.is-open')) {
      if (w.contains(/** @type {Node} */ (e.target))) continue;
      w.classList.remove('is-open');
      w.querySelector('.pchip')?.setAttribute('aria-expanded', 'false');
    }
  }, { capture: true });
}

async function readSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' });
    return res?.ok ? res.result : {};
  } catch { return {}; }
}

async function boot() {
  const slots = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-profile-chip]')]);
  if (!slots.length) return;
  try { await I18N()?.ready; } catch { /* the words fall back to English */ }
  let settings = await readSettings();
  const paint = () => { for (const s of slots) paintChip(s, settings); };
  paint();
  I18N()?.onChange?.(paint);
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender?.id !== chrome.runtime.id || msg?.type !== 'UQA_SETTINGS_CHANGED' || !msg.settings) return;
    settings = msg.settings;
    paint();
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) boot();
