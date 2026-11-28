/* QA Wrap — settings page: the save pipeline and shared helpers (split from options.js). */
import { setSettings, settings } from './options-state.js';

const TIMING = { savedFlash: 1600, saveDebounce: 250, permissionStep: 600, guidedStart: 400, reloadAfterReset: 900 }; // waits and display times in ms

/*
 * The words, before anything writes any.
 *
 * `platform/i18n.js` is a parser-blocking classic script in the head, so `QAWi18n`
 * is on the window by the time this module is evaluated; the top-level await
 * holds every statement below until the active table and the English fallback
 * are both in. This file paints on load - `$('open-shortcuts')` binds, the
 * boot IIFE runs, `paintFootprint()` fires at the end - so waiting here is the
 * only place that covers all of them at once.
 */
await QAWi18n.ready();

/** The words for a key. Short, because it is called about a hundred times. */
const t = (k, v) => QAWi18n.t(k, v);

/**
 * The names in "Still needs: a, b, c" joined the way the language joins them.
 *
 * Punctuation, so it is written here rather than as a table entry: a key whose
 * whole value is a comma and a space reads as a mistake in a translator's file
 * and is the first thing to get tidied away.
 */
const listOf = (parts) => parts.join(QAWi18n.lang() === 'ar' ? '، ' : ', ');

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      if (res && res.ok === false && (res.code === 'SLOW' || res.timedOut || /UQA_[A-Z_]+/.test(String(res.error)))) {
        res = { ...res, error: t('options.msg.slow') }; // never a raw message name on screen
      }
      resolve(res || { ok: false, error: t('options.msg.workerSilent') });
    });
  });
}

let saveTimer = null;

function flashSaved(text = t('options.save.saved')) {
  const el = $('save-state');
  el.textContent = text;
  // One element, written over and over, so no CSS rule can ever replay on it:
  // it has been matching since the page loaded. ui/motion.js restarts the
  // slide by hand — the same mechanism, and the same reason, as the popup's
  // status line.
  window.UQAMotion?.notice(el);
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => (el.textContent = ''), TIMING.savedFlash);
}

/** A save that was not acknowledged stays on screen until it succeeds. */
function saveFailed(reason) {
  const el = $('save-state');
  clearTimeout(/** @type {any} */ (flashSaved).timer);
  el.textContent = `${t('options.save.failed', { reason: reason || '' })} `;
  el.style.color = 'var(--danger)';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = t('options.save.retry');
  retry.addEventListener('click', () => { el.style.color = ''; el.textContent = ''; save({}, { immediate: true }); });
  el.append(retry);
}

/* A snapshot the worker took between its two writes (open record, then vault) has no `webhooks` and no
   `trackers` at all (both hold secrets); an absent key is never "the list is empty" (that arrives as [] or {}),
   so keep what the page has. Without `trackers` here a saved token flipped its screen back to "Not set up". */
const adopt = (next) => {
  if (!next || next.vaultLocked) return next;
  let out = next;
  for (const k of ['webhooks', 'trackers', 'jira', 'slack']) if (!(k in out) && settings?.[k]) out = { ...out, [k]: settings[k] };
  return out;
};
let pending = {};
function flushSave() {
  if (!Object.keys(pending).length) return;
  clearTimeout(saveTimer);
  const body = pending;
  pending = {};
  send({ type: 'UQA_SET_SETTINGS', patch: body });
}
window.addEventListener('pagehide', flushSave);

/* Nested settings merge key by key, so two patches inside the debounce (two Jira fields) both survive. */
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const NESTED = ['keymap', 'jira', 'slack', 'trackers'];
const mergeDeep = (a, b) => {
  const r = { ...a };
  for (const k of Object.keys(b || {})) r[k] = isObj(b[k]) && isObj(a?.[k]) ? mergeDeep(a[k], b[k]) : b[k];
  return r;
};
function save(patch, { immediate = false } = {}) {
  const nested = (base) => Object.fromEntries(NESTED.filter((k) => patch[k]).map((k) => [k, mergeDeep(base[k] || {}, patch[k])]));
  setSettings({ ...settings, ...patch, ...nested(settings) });
  pending = { ...pending, ...patch, ...nested(pending) };
  clearTimeout(saveTimer);
  const commit = async () => {
    const body = pending;
    pending = {};
    const res = await send({ type: 'UQA_SET_SETTINGS', patch: body });
    if (res.ok) {
      setSettings(adopt(res.result));
      flashSaved();
    } else {
      // T-016: not acknowledged, so the change is still owed. Put it back (newer edits win), say so, offer retry.
      pending = mergeDeep(body, pending);
      saveFailed(res.code === 'VAULT_LOCKED' ? werr(res) : res.code === 'VAULT_UNREADABLE' ? t('options.vault.unreadable') : res.error);
    }
  };
  if (immediate) commit();
  else saveTimer = setTimeout(commit, TIMING.saveDebounce);
}

/* -------------------------------------------------------------------- ranges */

/** How each range renders its current value, in words a person reads. */
/**
 * Digits stay Western in Arabic, so a count on screen and the same count in an
 * exported report are the same string. `toLocaleString()` with no argument
 * follows the browser's own locale, which on an Arabic profile prints ٤٬٠٠٠;
 * the English path is left on the default so it renders exactly as it did.
 */
/*
 * A failure in the tester's language (r2-08-6): the table the popup and the report read, loaded lazily; until it
 * arrives, or if it cannot, the worker's English stays. A code (the locked or unreadable vault) is read first.
 */
let WERR = null;
import('../platform/worker-errors.js').then((m) => { WERR = m; }).catch(() => { /* English stays on screen */ });
const werr = (x) => (WERR ? WERR.localizeError(x, t, QAWi18n.lang()) : typeof x === 'string' ? x : String(x?.error ?? x?.message ?? ''));

const group = (v) => v.toLocaleString(QAWi18n.numTag());

// r4-10-3: units go through t() so the Arabic UI does not show Latin s/ms.
const secs = (v, d) => t('options.range.seconds', { s: v.toFixed(d) });
const msText = (v) => t('options.range.millis', { ms: v });
const FORMATTERS = {
  expandPercent: (v) => (v === 0 ? t('options.range.noGrowth') : `+${v}%`),
  causalWindowMs: (v) => (v >= 1000 ? secs(v / 1000, v % 1000 ? 1 : 0) : msText(v)),
  inputDebounceMs: (v) => msText(v),
  breakDelayMs: (v) => (v === 0 ? t('options.range.noDelay') : v >= 1000 ? secs(v / 1000, 1) : msText(v)),
  breakRepeat: (v) => (v === 0 ? t('options.range.untilOff') : v === 1 ? t('options.range.justOnce') : t('options.range.requests', { v })),
  maxTimelineRows: (v) => t('options.range.rows', { v }),
  screenshotWidth: (v) => `${v}px`,
  maxStressNodes: (v) => t('options.range.elements', { v: group(v) }),
  webcamSize: (v) => t('options.range.percentOfHeight', { v }),
};

const NOTES = {
  expandPercent: (v) =>
    v === 0 ? t('options.note.expandNone')
    : v <= 30 ? t('options.note.expandGentle')
    : v <= 60 ? t('options.note.expandUsual')
    : t('options.note.expandAggressive'),
  maxStressNodes: (v) =>
    v <= 1000 ? t('options.note.nodesCheap')
    : v <= 8000 ? t('options.note.nodesUsual')
    : t('options.note.nodesEvery'),
  webcamSize: (v) =>
    v <= 15 ? t('options.note.webcamSmall')
    : v <= 28 ? t('options.note.webcamUsual')
    : t('options.note.webcamLarge'),
};

/**
 * The one-time notice about retention, for a profile that predates it.
 *
 * `retentionNoticeSeen` has been in DEFAULTS since the resolver was written and
 * nothing has ever read it — so an upgraded profile was quietly left on "keep
 * everything" with no way to find out that a window existed. Shown only while
 * the flag is false AND the profile is actually on "keep everything", because a
 * profile that has already chosen a window has nothing to be told.
 */
function wireRetentionNotice() {
  const box = $('retention-notice');
  const ok = $('retention-notice-ok');
  if (!box || !ok) return;
  ok.addEventListener('click', () => {
    box.hidden = true;
    save({ retentionNoticeSeen: true }, { immediate: true });
  });
}

/** Called once the settings have arrived, because it depends on their values. */
function paintRetentionNotice(settings) {
  const box = $('retention-notice');
  if (!box) return;
  box.hidden = !!settings?.retentionNoticeSeen || Number(settings?.retentionDays || 0) !== 0;
}

export { $, FORMATTERS, NOTES, TIMING, WERR, adopt, flashSaved, group, listOf, paintRetentionNotice, save, send, t, werr, wireRetentionNotice };
