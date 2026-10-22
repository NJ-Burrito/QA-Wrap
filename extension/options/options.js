/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
import {
  DEFAULTS,
  DOWNLOAD_FOLDER_HELP,
  RANGES,
  ACTIONS,
  bindingFromEvent,
  formatBinding,
  isUsableBinding,
  conflictsWith, hasSidePanel,
} from '../platform/settings.js';
// The settings page says which Jira it is about to sign in to. It works that
// out with the same module the client uses, so the sentence on screen and the
// header on the wire cannot disagree.
import { wireVault } from './vault-ui.js';
import { normaliseArabic } from '../core/fingerprint.js'; // r3-10-3: the settings search folds spelling variants
import { erasedText } from '../core/store-registry.js'; // T-054: the confirm sentences come from the registry, not a hand list
import { wireIntegrations } from './integrations.js';
import { managedStatus, paintPolicy } from './policy-panel.js';
import { wireEgress } from './egress-panel.js';
import { POLICY_DEFAULTS as DEFAULTS_POLICY } from '../platform/policy.js';
import { resolveAuthMode, detectAuthMode, isAutoMode } from '../core/jira-auth.js';
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

/*
 * A language change repaints this page. It does not reload it.
 *
 * A settings page that reloads loses the folder somebody was half way through
 * typing, and the tester who has just discovered the language control is
 * exactly the tester in the middle of filling this form in. So the static text
 * is filled in again from the table and every function that writes words by
 * hand is called a second time; nothing reads a form field back or writes one.
 * `booted` keeps the very first change - the one `chrome.storage.sync` can
 * announce a few milliseconds after load, from another machine - from painting
 * a page whose controls do not exist yet; boot paints it correctly anyway.
 */
let booted = false;
QAWi18n.onChange(() => {
  QAWi18n.apply();
  paintWords();
});

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

let settings = { ...DEFAULTS };
let policyStatus = 'default';
managedStatus().then((s) => { policyStatus = s; if (booted) paintAll(); });
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

/**
 * Writes are coalesced: dragging a slider fires dozens of input events, and
 * every one of them would otherwise be a storage round-trip.
 */
/**
 * One debounce, and it used to eat whatever was waiting in it.
 *
 * `clearTimeout(saveTimer)` cancelled the pending commit and the next call sent
 * only *its own* patch, so a patch that was still waiting was dropped on the
 * floor. Typing a folder into "Save into" and then ticking "Ask where to save"
 * within a quarter of a second lost the folder every time; measured, with the
 * settings object read back out of `chrome.storage.sync` afterwards. The same
 * hole swallowed a half-typed `maskExtraPattern`.
 *
 * So the pending patch accumulates rather than being replaced, and whichever
 * commit runs first sends all of it. Nested objects merge the way `settings`
 * merges them, or two keymap patches in the same quarter-second would lose the
 * first binding.
 *
 * `pagehide` flushes what is still waiting. A settings page is closed the
 * moment somebody has finished changing something, which is exactly when a
 * quarter-second debounce is still holding their last edit.
 */
let integ = { repaint() {} };
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
  settings = { ...settings, ...patch, ...nested(settings) };
  pending = { ...pending, ...patch, ...nested(pending) };
  clearTimeout(saveTimer);
  const commit = async () => {
    const body = pending;
    pending = {};
    const res = await send({ type: 'UQA_SET_SETTINGS', patch: body });
    if (res.ok) {
      settings = adopt(res.result);
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

/**
 * The Permissions section: three rows, three grants, three live dots.
 *
 * Why this page and no other can do it is written above the section in
 * options.html. What is worth saying here is what each row actually asks for,
 * because they are three different kinds of permission:
 *
 *   **Microphone and camera** are browser permissions on this extension's
 *   origin, obtained by opening a stream and stopping it again at once. What
 *   is wanted is the grant, not the media. Asked separately, and each answer
 *   reported by name: one combined request means a refused microphone also
 *   costs the camera, with a single opaque error covering both.
 *
 *   **Screen recording** is `desktopCapture`, an optional extension
 *   permission, so it is `chrome.permissions.request` and needs the click
 *   that is calling it. Granting it does not remove Chrome's own source
 *   picker and cannot: nothing may choose a screen on the user's behalf, and
 *   the row says so rather than implying otherwise.
 *
 * The dots repaint on `navigator.permissions` change events, so revoking a
 * grant in Chrome's own site settings is reflected here without a reload.
 */
const PERMISSION_ROWS = [
  { key: 'microphone', button: 'grant-mic', dot: 'dot-mic', state: 'state-mic', label: 'Microphone', constraints: { audio: true } },
  { key: 'camera', button: 'grant-cam', dot: 'dot-cam', state: 'state-cam', label: 'Camera', constraints: { video: true } },
];

async function devicePermission(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    // Firefox has no camera/microphone descriptor. Unknown is not denied.
    return 'unknown';
  }
}

function paintPermission(row, state) {
  const dot = $(row.dot);
  const say = $(row.state);
  if (dot) dot.dataset.state = state;
  if (!say) return;
  say.textContent =
    state === 'granted'
      ? t('options.permissions.deviceAllowed')
      : state === 'denied'
        ? t('options.permissions.deviceBlocked')
        : t('options.permissions.deviceUnasked');
  say.className = state === 'granted' ? 'range-note ready' : 'range-note';
}

function wireMediaGrant() {
  if (!$('grant-mic')) return;

  const paintDevices = async () => {
    for (const row of PERMISSION_ROWS) paintPermission(row, await devicePermission(row.key));
  };

  for (const row of PERMISSION_ROWS) {
    const button = $(row.button);
    if (!button) continue;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia(row.constraints);
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        const say = $(row.state);
        if (say) {
          say.textContent =
            err.name === 'NotAllowedError'
              ? t('options.permissions.deviceRefused')
              : t('options.permissions.deviceFailed', { message: err.message });
          say.className = 'range-note';
        }
      }
      button.disabled = false;
      await paintDevices();
    });
  }

  // Repaint when the grant changes anywhere else, including Chrome's own
  // settings. Without this a tester who blocks the mic in the site settings
  // comes back to a green dot that is lying.
  for (const row of PERMISSION_ROWS) {
    navigator.permissions
      ?.query({ name: row.key })
      .then((status) => { status.onchange = () => paintPermission(row, status.state); })
      .catch(() => {});
  }

  const screenButton = $('grant-screen');
  const screenState = $('state-screen');
  const screenDot = $('dot-screen');

  const paintScreen = async () => {
    const held = await chrome.permissions.contains({ permissions: ['desktopCapture'] }).catch(() => false);
    if (screenDot) screenDot.dataset.state = held ? 'granted' : 'unknown';
    if (screenButton) screenButton.textContent = held ? t('options.permissions.screenAllowedButton') : t('options.permissions.grantScreen');
    if (screenButton) screenButton.disabled = held;
    if (!screenState) return;
    screenState.textContent = held
      ? t('options.permissions.screenAllowed')
      : t('options.permissions.screenUnasked');
    screenState.className = held ? 'range-note ready' : 'range-note';
  };

  screenButton?.addEventListener('click', async () => {
    try {
      // Directly on the click: `permissions.request` is refused without a live
      // user gesture, and an await before it spends one.
      await chrome.permissions.request({ permissions: ['desktopCapture'] });
    } catch (err) {
      if (screenState) screenState.textContent = t('options.permissions.chromeRefused', { message: err.message });
    }
    await paintScreen();
  });

  /*
   * Site access: the fourth row, and the only one that is a list rather than a
   * yes or a no.
   *
   * Chrome hands back the origins as match patterns (`https://shop.example/*`),
   * which is what `permissions.remove` wants back, so they are kept verbatim
   * and only tidied for reading. `<all_urls>` is shown as itself rather than
   * translated, because an administrator's grant, or one made before the all-sites option was removed,
   * should be recognisable as the thing they are about to take away.
   *
   * Removal is per origin and there is no confirmation on it. Taking a site
   * away is reversible with one press of Wake on that site, and a dialog in
   * front of a reversible, privacy-increasing action is a dialog that teaches
   * people to click through dialogs.
   */
  const sitesDot = $('dot-sites');
  const sitesState = $('state-sites');
  const sitesList = $('site-list');

  const paintSites = async () => {
    const all = await chrome.permissions.getAll().catch(() => null);
    const origins = all?.origins || [];
    const everywhere = origins.includes('<all_urls>');
    if (sitesDot) sitesDot.dataset.state = origins.length ? 'granted' : 'unknown';
    if (sitesState) {
      sitesState.textContent = everywhere
        ? t('options.permissions.sitesEverywhere')
        : origins.length
          ? t(origins.length === 1 ? 'options.permissions.sitesOne' : 'options.permissions.sitesMany', { n: origins.length })
          : t('options.permissions.sitesNone');
      sitesState.className = origins.length ? 'range-note ready' : 'range-note';
    }
    const revoke = $('revoke-sites');
    if (revoke) revoke.disabled = !origins.length;
    if (!sitesList) return;
    sitesList.textContent = '';
    for (const origin of origins) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = origin === '<all_urls>' ? t('options.permissions.everySite') : origin;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'btn btn-xs btn-quiet';
      drop.textContent = t('options.permissions.remove');
      drop.addEventListener('click', async () => {
        await chrome.permissions.remove({ origins: [origin] }).catch(() => {});
        await paintSites();
      });
      row.append(name, drop);
      sitesList.append(row);
    }
  };

  $('revoke-sites')?.addEventListener('click', async () => {
    const all = await chrome.permissions.getAll().catch(() => null);
    const origins = all?.origins || [];
    if (origins.length) await chrome.permissions.remove({ origins }).catch(() => {});
    await paintSites();
  });

  // The worker owns the registered content scripts and reacts to
  // `permissions.onAdded`/`onRemoved` itself; this listener is only so that
  // this page repaints when the change was made somewhere else, including in
  // Chrome's own extension settings.
  chrome.permissions?.onAdded?.addListener(() => paintSites());
  chrome.permissions?.onRemoved?.addListener(() => paintSites());

  paintDevices();
  paintScreen();
  paintSites();

  // The four rows again, in the new language. Their words are written by JS, so
  // `QAWi18n.apply()` cannot reach them; they are repainted after it instead.
  wireMediaGrant.repaint = () => { paintDevices(); paintScreen(); paintSites(); };

  /*
   * The guided run, started by the popup.
   *
   * Three prompts one after another, in the order they make sense: microphone,
   * camera, then the screen-capture permission. Sequential and not parallel,
   * because Chrome queues permission bubbles and a tester faced with three at
   * once cannot tell which answer belongs to which device.
   *
   * The section is scrolled to and each row repaints as its answer lands, so
   * the dots turn green under the cursor rather than after a reload. A refusal
   * does not stop the run: refusing the camera is a legitimate choice and it is
   * no reason to skip asking about the screen.
   */
  const guided = async () => {
    // A marker the harness can read: a guided run that silently did not start is
    // indistinguishable from one that ran and changed nothing.
    window.__uqaGuided = { started: Date.now(), asked: [] };
    document.getElementById('sec-permissions')?.scrollIntoView({ block: 'start' });
    for (const row of PERMISSION_ROWS) {
      const state = await devicePermission(row.key);
      if (state !== 'granted') $(row.button)?.click();
      window.__uqaGuided.asked.push(row.key);
      // Wait for the answer before asking the next one. The click above resolves
      // when the button handler returns, which is after `getUserMedia` settles.
      await new Promise((r) => setTimeout(r, TIMING.permissionStep));
    }
    const held = await chrome.permissions.contains({ permissions: ['desktopCapture'] }).catch(() => false);
    if (!held) $('grant-screen')?.click();
    window.__uqaGuided.asked.push('desktopCapture');
    window.__uqaGuided.finished = Date.now();
  };

  if (new URLSearchParams(location.search).get('guide') === 'permissions') {
    // After paint, so the rows the sequence clicks are the ones on screen.
    setTimeout(guided, TIMING.guidedStart);
  }
}

function wireRange(name) {
  const input = $(name);
  const out = $(`${name}-out`);
  const note = $(`${name}-note`);
  if (!input) return;

  const range = RANGES[name];
  input.min = range.min;
  input.max = range.max;
  input.step = range.step;
  input.setAttribute('aria-valuemin', range.min);
  input.setAttribute('aria-valuemax', range.max);

  const paint = () => {
    const v = Number(input.value);
    out.textContent = (FORMATTERS[name] || ((x) => `${x}${range.unit}`))(v);
    input.setAttribute('aria-valuenow', v);
    input.setAttribute('aria-valuetext', out.textContent);
    // Fill the track up to the thumb.
    //
    // The track is one gradient and a gradient line is physical: CSS has no
    // `to inline-end`, so `to right` is the only way to write it. Chrome
    // mirrors the slider itself under `dir="rtl"` - minimum on the right - so
    // what is mirrored here is which end of that gradient is the filled one,
    // rather than adding a `[dir="rtl"]` rule to the stylesheet.
    const pct = ((v - range.min) / (range.max - range.min)) * 100;
    const rtl = QAWi18n.dir() === 'rtl';
    input.style.setProperty('--fill', `${rtl ? 100 - pct : pct}%`);
    input.style.setProperty('--fill-from', rtl ? 'var(--border)' : 'var(--accent)');
    input.style.setProperty('--fill-to', rtl ? 'var(--accent)' : 'var(--border)');
    if (note && NOTES[name]) note.textContent = NOTES[name](v);
  };

  input.addEventListener('input', () => {
    paint();
    save({ [name]: Number(input.value) });
  });

  input.__paint = paint;
}

function wireSwitch(name) {
  const input = $(name);
  if (!input) return;
  input.addEventListener('change', () => save({ [name]: input.checked }, { immediate: true }));
}

/* ------------------------------------------------------------------- keymap */

let recording = null; // action currently capturing a keystroke

/**
 * What an action is called, in the reader's language.
 *
 * `ACTIONS` lives in `platform/settings.js`, which this round does not touch, so the
 * English there stays the source of record and the key is resolved beside it at
 * render time. A table with no entry for an action falls back to the imported
 * English rather than to the key, so a new action added to `platform/settings.js`
 * reads correctly the day it lands and before anybody has translated it.
 */
const actionLabel = (id) =>
  (QAWi18n.has(`options.actions.${id}.label`) ? t(`options.actions.${id}.label`) : ACTIONS[id]?.label || id);
const actionHint = (id) =>
  (QAWi18n.has(`options.actions.${id}.hint`) ? t(`options.actions.${id}.hint`) : ACTIONS[id]?.hint || '');

function renderKeymap() {
  const host = $('keymap');
  host.innerHTML = '';

  for (const action of Object.keys(ACTIONS)) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const label = document.createElement('div');
    label.className = 'key-label';
    const strong = document.createElement('strong');
    strong.textContent = actionLabel(action);
    const em = document.createElement('em');
    em.textContent = actionHint(action);
    label.append(strong, em);

    const binding = settings.keymap?.[action] || '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-btn';
    btn.textContent = recording === action ? t('options.keymap.pressKeys') : formatBinding(binding);
    btn.dataset.recording = String(recording === action);
    btn.setAttribute('aria-label', t('options.keymap.buttonAria', { action: actionLabel(action), binding: formatBinding(binding) }));
    if (binding && conflictsWith(settings.keymap, action, binding).length) {
      btn.dataset.conflict = 'true';
      btn.title = t('options.keymap.conflict');
    }
    btn.addEventListener('click', () => {
      recording = recording === action ? null : action;
      renderKeymap();
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'key-clear';
    clear.textContent = t('options.keymap.clear');
    clear.addEventListener('click', () => {
      save({ keymap: { [action]: '' } }, { immediate: true });
      recording = null;
      renderKeymap();
    });

    row.append(label, btn, clear);
    host.append(row);
  }
}

// Capture phase, so the keystroke never reaches the page while recording.
document.addEventListener(
  'keydown',
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      recording = null;
      return renderKeymap();
    }

    const binding = bindingFromEvent(e);
    if (!binding) return; // a lone modifier — keep waiting

    if (!isUsableBinding(binding)) {
      flashSaved(t('options.keymap.needsModifier'));
      return;
    }

    const clash = conflictsWith(settings.keymap, recording, binding);
    const action = recording;
    recording = null;

    if (clash.length) {
      // Take the binding and free the other action, rather than silently
      // creating a duplicate that fires two things at once.
      const freed = Object.fromEntries(clash.map((name) => [name, '']));
      save({ keymap: { ...freed, [action]: binding } }, { immediate: true });
      flashSaved(t('options.keymap.clearedFrom', { names: listOf(clash.map(actionLabel)) }));
    } else {
      save({ keymap: { [action]: binding } }, { immediate: true });
    }
    renderKeymap();
  },
  true
);

/* ---------------------------------------------------------- chrome commands */

async function renderCommands() {
  const res = await send({ type: 'UQA_COMMANDS' });
  const host = $('commands');
  host.innerHTML = '';
  const commands = (res.ok ? res.result : []) || [];

  for (const cmd of commands) {
    if (cmd.name === '_execute_action') continue;
    const row = document.createElement('div');
    row.className = 'command-row';
    const desc = document.createElement('span');
    desc.textContent = cmd.description || cmd.name;
    if (cmd.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.textContent = cmd.shortcut;
      row.append(desc, kbd);
    } else {
      const unset = document.createElement('span');
      unset.className = 'unset';
      unset.textContent = t('options.commands.unassigned');
      row.append(desc, unset);
    }
    host.append(row);
  }
}

$('open-shortcuts').addEventListener('click', () => send({ type: 'UQA_OPEN_SHORTCUTS' }));

/* ------------------------------------------------------------------ privacy */

/* ── Jira ─────────────────────────────────────────────────────────────── */

const JIRA_FIELDS = ['baseUrl', 'authMode', 'email', 'token', 'project', 'issueType', 'testIssueType'];
/**
 * What each of those is called out loud.
 *
 * `JIRA_FIELDS` are DOM id suffixes, and "Still needs: baseUrl, email, token,
 * project" printed them straight at the reader. These are the labels already
 * above each input, so the sentence names the fields the way the form does.
 */
const JIRA_LABELS = {
  baseUrl: 'options.jira.fieldBaseUrl', email: 'options.jira.fieldEmail',
  token: 'options.jira.fieldToken', project: 'options.jira.fieldProject',
  issueType: 'options.jira.fieldIssueType', testIssueType: 'options.jira.fieldTestIssueType',
};

/*
 * Write-only secrets (F3, research-integrations). A saved token or webhook URL
 * is never put back into an input: the field shows "saved ••• last4", typing
 * replaces it, Forget clears it. The value stays in this page's memory only.
 */
const secretText = (input) => input.value.trim() || (input.dataset.saved === '1' ? input._last || '' : '');
function syncSecret(input) {
  const saved = input.dataset.saved === '1';
  input.placeholder = saved ? t('options.secret.saved', { last: String(input._last || '').slice(-4) }) : input.dataset.base || '';
  const forget = input.nextElementSibling;
  if (forget?.classList.contains('secret-forget')) forget.hidden = !saved;
}
function secretView(input, stored, commit, after = () => {}) {
  if (input.dataset.base === undefined) input.dataset.base = input.placeholder;
  let forget = input.nextElementSibling;
  if (!forget?.classList.contains('secret-forget')) {
    forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'btn btn-sm secret-forget';
    forget.textContent = t('options.secret.forget');
    input.after(forget);
  }
  input.value = '';
  input.autocomplete = 'off';
  input.disabled = !!settings.vaultLocked; // locked vault: unlock first (Token vault card)
  input.dataset.saved = stored ? '1' : '';
  input._last = stored || '';
  input.oninput = () => {
    const v = input.value.trim();
    if (!v) return; // emptying a box is not "forget"; the button is
    input.dataset.saved = '1';
    input._last = v;
    commit(v);
    syncSecret(input);
    after();
  };
  forget.onclick = () => {
    input.value = '';
    input.dataset.saved = '';
    input._last = '';
    commit('');
    syncSecret(input);
    after();
  };
  syncSecret(input);
}

/**
 * What the sign-in choice means, in the two forms it takes.
 *
 * The whole reason this control exists is that Data Center refuses the Cloud
 * credential with a 401 nobody can read, so the page has to say which of the
 * two it is about to use and what that one wants pasted into it. `auto` names
 * the mode it detected rather than saying "detected": a person who has just
 * typed their company URL wants to see the answer, not the mechanism.
 */
const JIRA_AUTH_HELP = {
  cloud: 'options.jira.helpCloud',
  server: 'options.jira.helpServer',
  'server-basic': 'options.jira.helpServerBasic',
};

function wireJira() {
  const paint = () => {
    // The mode in force, worked out the same way the client works it out. The
    // page never guesses separately: `core/jira-auth.js` is the one answer.
    const cfg = { baseUrl: $('jira-baseUrl').value.trim(), authMode: $('jira-authMode').value };
    const mode = resolveAuthMode(cfg);
    const server = mode === 'server';

    $('jira-token-label').textContent = t(server ? 'options.jira.tokenPat' : 'options.jira.tokenApi');
    $('jira-token').dataset.base = t(server
      ? 'options.jira.tokenPlaceholderPat'
      : mode === 'server-basic' ? 'options.jira.tokenPlaceholderPassword' : 'options.jira.tokenPlaceholderApi');
    syncSecret($('jira-token'));
    // Data Center has no use for the email, so the field is not asked for.
    $('jira-email-field').hidden = server;
    // The detected kind and the explanation are two sentences joined by a
    // space, not one string with a space glued to its end: a trailing space in
    // a translation table is invisible and the first thing a translator eats.
    $('jira-auth-help').textContent = isAutoMode(cfg)
      ? `${t(detectAuthMode(cfg.baseUrl) === 'server' ? 'options.jira.looksServer' : 'options.jira.looksCloud')} ${t(JIRA_AUTH_HELP[mode])}`
      : t(JIRA_AUTH_HELP[mode]);

    const asked = server
      ? ['baseUrl', 'token', 'project']
      : ['baseUrl', 'email', 'token', 'project'];
    const val = (f) => (f === 'token' ? secretText($('jira-token')) : $(`jira-${f}`).value.trim());
    const filled = JIRA_FIELDS.filter((f) => f !== 'authMode' && val(f));
    const missing = asked.filter((f) => !val(f))
      .map((f) => (f === 'token' && server ? t('options.jira.fieldPat') : JIRA_LABELS[f] ? t(JIRA_LABELS[f]) : f));
    const state = $('jira-state');
    if (!filled.length) {
      state.textContent = t('options.jira.stateNone');
      state.className = 'range-note';
    } else if (missing.length) {
      state.textContent = t('options.jira.stateMissing', { fields: listOf(missing) });
      state.className = 'range-note armed';
    } else {
      state.textContent = t('options.jira.stateReady');
      state.className = 'range-note ready';
    }
  };

  for (const f of JIRA_FIELDS) {
    const input = $(`jira-${f}`);
    if (!input || f === 'token') continue; // the token is write-only: see secretView
    // A select fires `change`, a text input fires `input`; both are listened
    // for so the one control that is a dropdown saves like all the others.
    for (const evt of input.tagName === 'SELECT' ? ['change'] : ['input']) {
      input.addEventListener(evt, () => {
        paint();
        save({ jira: { [f]: input.value.trim() } });
      });
    }
  }
  wireJira.paint = paint;
}

/* ── output: folder, formats, clock ───────────────────────────────────── */

async function wireOutput() {
  // Which video formats exist is a property of this browser, not a guess. A
  // format the encoder will refuse produces a zero-byte file and no explanation,
  // so only what actually works is offered.
  const res = await send({ type: 'UQA_VIDEO_FORMATS' });
  const probe = res.ok ? res.result : null;

  // The catalogue carries the label and the note; the probe only says which
  // entries this browser can actually write. Listing one it cannot produces a
  // file with the right extension and the wrong contents.
  const fill = (select, types, fallback) => {
    select.replaceChildren();
    for (const type of types || []) {
      if (!type.available) continue;
      const option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.note ? `${type.label}: ${type.note}` : type.label;
      select.append(option);
    }
    if (!select.options.length) {
      const option = document.createElement('option');
      option.value = fallback;
      option.textContent = fallback.toUpperCase();
      select.append(option);
    }
  };

  if (!hasSidePanel()) $('launchSurface')?.querySelector('option[value="panel"]')?.remove(); // no side panel (no API, or Opera where the API exists and fails): do not offer it
  fill($('videoFormat'), probe?.videoTypes, 'mp4'); fill($('imageFormat'), probe?.imageTypes, 'png');

  for (const name of ['imageFormat', 'videoFormat', 'videoQuality', 'webcamPosition', 'clock', 'launchSurface', 'testerName']) {
    const input = $(name);
    if (input) input.addEventListener('change', () => {
      save({ [name]: input.value }, { immediate: true });
      if (name === 'imageFormat') paintImageQuality();
    });
  }

  const room = await send({ type: 'UQA_STORAGE' });
  // Kept, so a language change can rewrite the sentence without asking the
  // worker how much disk is free a second time.
  paintStorage.room = room;
  paintStorage();
}

/** How much room is left, in words. Repainted on a language change. */
function paintStorage() {
  const room = paintStorage.room;
  const state = $('storage-state');
  if (!room || !state) return;
  if (room.ok && room.result.knows) {
    const r = room.result;
    state.textContent = t('options.storage.room', {
      gb: Math.round(r.free / 1024 / 1024 / 1024 * 10) / 10,
      span: spanOf(r.minutesOfVideo),
    });
    state.className = r.low ? 'range-note armed' : 'range-note';
  } else {
    state.textContent = t('options.storage.unknown');
  }
}

/**
 * Minutes, in a unit somebody can picture.
 *
 * The card read "room for roughly 42318 minutes of video", which is a number a
 * reader has to do arithmetic on before it means anything, and no thousands
 * separator to help. A quarter of a terabyte is weeks of video; say weeks.
 */
function spanOf(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 90) return t('options.span.minutes', { n: m });
  const hours = m / 60;
  if (hours < 48) return t('options.span.hours', { n: Math.round(hours) });
  const days = Math.round(hours / 24);
  return t('options.span.days', { n: days });
}

/** PNG is lossless, so a quality slider on it would be a control that does nothing. */
function paintImageQuality() {
  const field = $('imageQuality-field');
  if (field) field.hidden = $('imageFormat').value === 'png';
}

/**
 * Where files go, said as a path, and what the browser will know about it.
 *
 * Both sentences come from `core/filing.js` — `describeDestination()` for the
 * prose and `destination()` for the resolved path — because this page, the
 * report's Save sheet and the line printed after a save all have to agree, and
 * before that they each built the path from `ROOT` and a folder name. Two of
 * the three would still have promised `QA Wrap/QA Wrap/` for a folder called
 * `QA Wrap`.
 */
let filingMod = null;
const filingLib = async () => (filingMod ||= await import('../core/filing.js'));

async function paintFolder() {
  const { describeDestination, destination } = await filingLib();
  const handle = await window.UQAFolder?.get();
  const usable = await window.UQAFolder?.usable();
  const folder = (settings.downloadFolder || '').trim();
  const state = $('folder-state');
  const preview = $('downloadFolder-preview');

  if (handle && !usable) {
    // Permission does not survive a browser restart; saying so beats a silent
    // fall back to Downloads that looks like the setting was forgotten.
    state.textContent = t('options.files.folderNeedsPermission', { name: handle.name });
    state.className = 'range-note armed';
  } else {
    state.textContent = describeDestination({ folderName: handle ? handle.name : '', folder });
    state.className = handle ? 'range-note ready' : 'range-note';
  }

  // The exact path a file will be at, worked out by the same code that builds
  // it. A tester should not have to press Save to find out what a setting did.
  if (preview) {
    const where = destination({ folderName: handle && usable ? handle.name : '', folder });
    preview.textContent = t('options.files.previewPath', { where });
  }
}

function wireFolder() {
  $('pick-folder').addEventListener('click', async () => {
    try {
      const handle = await window.UQAFolder.choose();
      save({ saveFolderName: handle.name }, { immediate: true });
      flashSaved(t('options.files.folderChosen'));
    } catch (err) {
      if (err?.name === 'AbortError') return; // the tester closed the picker
      const d = WERR ? WERR.describeError(err, t) : { text: t('common.err.unknown'), title: String(err?.message ?? '') };
      $('folder-state').textContent = d.text; // the keyed sentence; an unknown failure carries a visible Copy details button, never a tooltip
      WERR?.attachDetails($('folder-state'), d, t);
      $('folder-state').className = 'range-note armed';
      return;
    }
    paintFolder();
  });

  $('clear-folder').addEventListener('click', async () => {
    await window.UQAFolder.clear();
    save({ saveFolderName: '' }, { immediate: true });
    paintFolder();
    flashSaved(t('options.files.backToDownloads'));
  });
}


/* ── sound ─────────────────────────────────────────────────────────────── */

/**
 * Let the tester hear them before deciding.
 *
 * A volume slider with nothing to listen to is a control operated blind, and
 * "make a sound when something happens" is a promise nobody can evaluate from
 * the sentence. So the settings page plays the actual files, in the two groups
 * the setting "Which sounds" chooses between, and the buttons are inert while
 * sound is off, which also demonstrates the off state honestly.
 *
 * The English in the table below is the source of record, like `ACTIONS` in
 * platform/settings.js: a sound added to `ui/sound.js` reads as English here on
 * the day it lands. The keys are `options.sound.name.<sound name>`.
 */
const SOUND_NAMES = {
  wake: 'Wake up', sleep: 'Sleep', start: 'Recording starts', stop: 'Recording stops',
  shot: 'Screenshot taken', done: 'Job finished', notice: 'Worth a look', error: 'It failed',
  tap: 'Press', on: 'Toggle on', off: 'Toggle off', open: 'Panel opens', close: 'Panel closes',
  remove: 'Removed', copy: 'Copied or inserted',
};

/** The name of one sound, from the table if it is in it, else the English above. */
const soundLabel = (id) => (QAWi18n.has(`options.sound.name.${id}`) ? t(`options.sound.name.${id}`) : SOUND_NAMES[id] || id);

function paintSound() {
  const on = !!settings.soundEnabled;
  window.UQASound?.configure({ on, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQASound?.wire(document); // every click on this page, once (wire() is idempotent)

  const field = $('soundVolume-field');
  if (field) field.hidden = !on;
  const scopeField = $('soundScope-field');
  if (scopeField) {
    scopeField.hidden = !on;
    for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (scopeField.querySelectorAll('input[name="soundScope"]'))) r.checked = r.value === (settings.soundScope || 'all');
  }

  // The sentence above the chips counts what is actually loaded.
  const count = $('sound-count');
  const catalogue = window.UQASound?.catalogue() || [];
  if (count && catalogue.length) {
    const core = catalogue.filter((s) => s.scope === 'core').length;
    count.textContent = t('options.sound.count', { count: catalogue.length, core, touch: catalogue.length - core });
  }

  const host = $('sound-try');
  if (!host) return;

  if (!host.childElementCount) {
    for (const group of ['core', 'touch']) {
      const sounds = catalogue.filter((s) => s.scope === group);
      if (!sounds.length) continue;
      const box = document.createElement('div');
      box.className = 'sound-family';

      const head = document.createElement('h4');
      head.className = 'sound-family-name';
      head.dataset.group = group;
      head.textContent = t(group === 'core' ? 'options.sound.scope.core' : 'options.sound.scope.all');

      const what = document.createElement('p');
      what.className = 'sound-family-what';
      what.dataset.group = group;
      what.textContent = t(`options.sound.group.${group}.what`);

      const row = document.createElement('div');
      row.className = 'sound-row';
      for (const sound of sounds) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm sound-chip';
        btn.dataset.sound = 'none'; // played below, not by the delegated wiring, or a preview would also fire the generic press
        btn.dataset.id = sound.id;
        const label = document.createElement('span');
        label.className = 'sound-chip-label';
        label.textContent = soundLabel(sound.id);
        btn.append(label);
        btn.title = `${sound.id}: ${sound.events.join(', ')}`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.UQASound?.play(sound.id, { force: true });
        });
        row.append(btn);
      }

      box.append(head, what, row);
      host.append(box);
    }
  }
  for (const el of host.querySelectorAll('[data-group]')) {
    const g = el.dataset.group;
    el.textContent = el.tagName === 'H4'
      ? t(g === 'core' ? 'options.sound.scope.core' : 'options.sound.scope.all')
      : t(`options.sound.group.${g}.what`);
  }
  for (const btn of host.querySelectorAll('.sound-chip')) {
    if (btn.dataset.id) btn.querySelector('.sound-chip-label').textContent = soundLabel(btn.dataset.id);
  }
  host.querySelectorAll('button').forEach((b) => (b.disabled = !on));
  host.classList.toggle('is-off', !on);
}

/**
 * "Save into", the one control the download work shipped without.
 *
 * `platform/settings.js` has carried `downloadFolder` and `saveAs` since F2 wired
 * the folder end to end, `core/filing.js` sanitises and applies the folder, and
 * the report's Save sheet shows it — but nothing on this page could set it, so
 * the only way to change it was the Save sheet or the storage inspector.
 *
 * The help text is not written here. `DOWNLOAD_FOLDER_HELP` states a Chrome
 * limitation that has to be stated exactly once and exactly right, and this
 * page and the Save sheet both read that one string.
 */
let folderDirty = false;

/**
 * The Chrome limitation, in the reader's language, from the one place it is
 * worded.
 *
 * `DOWNLOAD_FOLDER_HELP` in platform/settings.js is still the English of record and
 * the Save sheet reads the same constant; it is written in first so this
 * paragraph is right even with no table at all, and the key replaces it when
 * the table has one. The same treatment as `ACTIONS`, for the same reason.
 */
function paintDownloadHelp() {
  const help = $('downloadFolder-help');
  if (!help) return;
  help.textContent = DOWNLOAD_FOLDER_HELP;
  if (QAWi18n.has('options.download.folderHelp')) help.textContent = t('options.download.folderHelp');
}

/**
 * "Save into", written from here rather than marked up.
 *
 * `tools/test-options-save.mjs` pins `<span>Save into</span>` character for
 * character, so the label cannot carry a `data-i18n` attribute; it is the input
 * that identifies it instead.
 */
function paintSaveIntoLabel() {
  const span = $('downloadFolder')?.previousElementSibling;
  if (span && span.tagName === 'SPAN') span.textContent = t('options.files.saveIntoLabel');
}

function wireDownloadFolder() {
  paintDownloadHelp();
  paintSaveIntoLabel();
  const input = $('downloadFolder');
  if (!input) return;
  // Saved as typed and sanitised on the way out by `core/filing.js`, which is
  // the one place that knows what a folder name may contain on each platform.
  //
  // `folderDirty` is not decoration. `save()` is debounced and `paintAll()`
  // runs on every settings change, including one another control made a
  // moment later — so typing a folder and then ticking "Ask where to save"
  // repainted this field from the value the typing had not yet written, and
  // the folder was silently lost. Measured, before the flag existed.
  input.addEventListener('input', async () => {
    folderDirty = true;
    save({ downloadFolder: input.value.trim() });
    // Painted from the field, not from `settings`: `save()` is debounced, and
    // a preview that lags the typing by 250 ms reads as a broken control. It
    // still goes through `destination()`, so "QA Wrap" typed here previews the
    // one folder it now produces rather than the two it used to.
    const { destination } = await filingLib();
    $('downloadFolder-preview').textContent =
      t('options.files.previewPath', { where: destination({ folder: input.value.trim() }) });
  });
  // Deliberately no `change` handler committing immediately. It would put a
  // second write in flight beside the debounced one, and `setSettings()` is a
  // read-modify-write: two overlapping commits both read the state from before
  // either of them, and the second overwrites the first. Measured, typing a
  // folder and ticking the box with no pause between: the folder was written
  // and then lost. One debounce, one commit, and `pagehide` for the close.
}

/**
 * D-1010-92: the compile check for the extra mask pattern. An invalid value is refused (never saved) with the keyed inline error,
 * and the field says so to assistive tech. The same check runs on a pattern that arrived already stored (sync, an old profile), so
 * the tester sees why every text field is masked instead of finding out by accident.
 */
function checkMaskPattern(value, { save: doSave = false } = {}) {
  const input = $('maskExtraPattern');
  const state = $('mask-state');
  if (!input || !state) return true;
  if (!value) {
    state.textContent = '';
    input.removeAttribute('aria-invalid');
    if (doSave) save({ maskExtraPattern: '' });
    return true;
  }
  try {
    new RegExp(value, 'i');
    state.textContent = doSave ? t('options.privacy.maskValid') : '';
    state.style.color = 'var(--ok)';
    input.removeAttribute('aria-invalid');
    if (doSave) save({ maskExtraPattern: value });
    return true;
  } catch (err) {
    // Never store a broken pattern: the recorder would mask every text field until it is fixed.
    state.textContent = t('options.privacy.maskInvalid', { message: err.message });
    state.style.color = 'var(--danger)';
    input.setAttribute('aria-invalid', 'true');
    return false;
  }
}

function wireMaskPattern() {
  const input = $('maskExtraPattern');
  input.addEventListener('input', () => checkMaskPattern(input.value.trim(), { save: true }));
}

/* --------------------------------------------------------------------- boot */

function paintAll() {
  for (const name of Object.keys(RANGES)) {
    const input = $(name);
    if (!input) continue;
    input.value = settings[name] ?? DEFAULTS[name];
    input.__paint?.();
  }
  for (const name of ['keymapEnabled', 'rtlMirror', 'rtlAccent', 'rtlBidi', 'soundEnabled', 'vfxEnabled', 'redact', 'preRollBuffer', 'saveAs', 'autoSubmitDefect']) {
    const input = $(name);
    if (input) input.checked = !!settings[name];
  }
  paintSound();
  $('maskExtraPattern').value = settings.maskExtraPattern || '';
  if (settings.maskExtraPattern) checkMaskPattern(settings.maskExtraPattern);
  // Not repainted while it is being typed into, for the same reason the tracker
  // forms are not rebuilt: paintAll() runs on the save this field just made.
  const folder = $('downloadFolder');
  const stored = settings.downloadFolder || '';
  if (folder && document.activeElement !== folder && (!folderDirty || folder.value.trim() === stored)) {
    folder.value = stored;
    folderDirty = false;
  }
  // The two ambiguous redaction families, as chips: a checkbox each would read
  // as "more privacy is better", and for these two it is a trade the tester has
  // to make against what they are testing.
  const extra = Array.isArray(settings.redactExtra) ? settings.redactExtra : [];
  for (const chip of document.querySelectorAll('#redactExtra button')) {
    chip.setAttribute('aria-pressed', String(extra.includes(chip.dataset.family)));
  }
  // Zero is "keep everything", not "delete immediately", and the number alone
  // cannot say which.
  paintRetentionOut();
  paintRetentionNotice(settings);
  for (const f of JIRA_FIELDS) {
    const input = $(`jira-${f}`);
    // Same rule as the folder field: never repaint (or blank, for the token) the box being typed in.
    if (!input || document.activeElement === input) continue;
    // The sign-in dropdown has no empty option, so a profile saved before this
    // setting existed falls back to the default rather than to a blank select.
    if (f === 'token') {
      secretView(input, settings.jira?.token, (v) => save({ jira: { token: v } }), () => wireJira.paint?.());
      continue;
    }
    input.value = settings.jira?.[f] || (f === 'authMode' ? DEFAULTS.jira.authMode : '');
  }
  for (const name of ['imageFormat', 'videoFormat', 'videoQuality', 'webcamPosition', 'clock', 'launchSurface', 'testerName']) {
    const input = $(name);
    if (input && settings[name]) input.value = settings[name];
  }
  paintImageQuality();
  wireJira.paint?.();
  integ.repaint();
  renderKeymap();
  paintPolicy(document, { ...DEFAULTS_POLICY, ...settings.policy }, policyStatus, t); // T-068
}

/**
 * Everything on this page whose words are written by JavaScript.
 *
 * `QAWi18n.apply()` covers the markup; this covers the rest. It repaints and
 * never re-reads: no `paintAll()`, because that writes stored values back into
 * the inputs and would take a half-typed Jira token or folder name away from
 * whoever is typing it. Values are already on screen and already correct; only
 * the words around them have changed.
 */
function paintWords() {
  if (!booted) return;
  QAWi18n.apply();
  paintDownloadHelp();
  paintSaveIntoLabel();
  for (const name of Object.keys(RANGES)) $(name)?.__paint?.();
  paintRetentionOut();
  paintImageQuality();
  paintSound();
  renderKeymap();
  renderCommands();
  integ.repaint();
  wireJira.paint?.();
  wireMediaGrant.repaint?.();
  wireWelcome.paint?.();
  paintFolder();
  paintStorage();
  paintFootprint();
  paintAbout();
  paintFilms();
  paintTheme();
  paintLanguage();
}

/**
 * The language control, and why it is a `<select>` at the top of the page.
 *
 * Three named choices, the way "Time in the filename" and "Detail" are three
 * named choices: this page has one pattern for a small enumerated setting and
 * a second pattern for the same shape of question would be a second thing to
 * learn. `setLang` writes the choice, re-stamps `<html lang>` and `dir`,
 * reloads the table and announces; the announcement is what repaints this page
 * and every other open surface, so nothing here does it by hand.
 */
function paintLanguage() {
  const select = $('language');
  if (select) select.value = QAWi18n.setting();
}

function wireLanguage() {
  const select = $('language');
  if (!select) return;
  paintLanguage();
  select.addEventListener('change', () => QAWi18n.setLang(select.value));
}

/** Zero reads as "keep everything", which the number alone cannot say. */
function paintRetentionOut() {
  const days = Number(settings.retentionDays ?? DEFAULTS.retentionDays);
  const out = $('retentionDays-out');
  if (out) out.textContent = days === 0 ? t('options.privacy.retentionNever') : t('options.privacy.retentionDays', { days });
}

function paintTheme() {
  const btn = $('theme');
  if (!btn || !window.UQATheme) return;
  const state = window.UQATheme.describe();
  // The words come from the shared table, keyed by the mode `ui/theme.js`
  // reports, because that file answers in English for every surface.
  const mode = window.UQATheme.read?.() || 'system';
  const { label, next } = window.UQADom.themeWords(mode, state);
  const glyph = { light: 'theme-light', dark: 'theme-dark' }[mode] || 'theme-system';
  btn.innerHTML = window.UQAIcon ? window.UQAIcon(glyph, { size: 16 }) : '';
  btn.append(document.createTextNode(label));
  btn.title = next;
}

$('theme')?.addEventListener('click', () => {
  window.UQATheme.cycle();
  paintTheme();
});

$('reset').addEventListener('click', async () => {
  if (!confirm(erasedText(t, 'reset'))) return;
  const res = await send({ type: 'UQA_RESET_SETTINGS' });
  if (res.ok) {
    settings = res.result;
    paintAll();
    flashSaved(t('options.save.reset'));
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * Nothing is declared externally connectable, so a web page cannot reach this
   * at all and another extension's message would carry that extension's id.
   * `sender.id` is stamped by the browser rather than claimed by the sender,
   * which is what makes it the thing to check; `sender.url` is not, and is
   * never checked here (research/51d §7).
   */
  if (sender?.id !== chrome.runtime.id) return;
  // Another surface changed something — stay in step.
  if (msg?.type === 'UQA_SETTINGS_CHANGED' && !recording) {
    settings = adopt(msg.settings);
    paintAll();
  }
});

/**
 * The first-run notice, and the way back to it.
 *
 * The date is shown rather than only a tick, because "you accepted this" is a
 * claim about a person and a claim about a person should say when. It is read
 * from `chrome.storage.local` through the worker, which is the one place that
 * writes it.
 */
async function wireWelcome() {
  const state = $('consent-state');
  const paint = async () => {
    if (!state) return;
    const res = await send({ type: 'UQA_CONSENT' });
    const at = res?.ok ? res.result.consentedAt : null;
    // Western digits in Arabic as well, and the day-month-year order a Jordanian
    // reader expects; the English path keeps the browser's own format, unchanged.
    state.textContent = at
      ? t('options.privacy.consentAt', { date: new Date(at).toLocaleDateString(QAWi18n.numTag()) })
      : t('options.privacy.consentNone');
    state.className = at ? 'range-note ready' : 'range-note';
  };
  $('show-welcome')?.addEventListener('click', () => send({ type: 'UQA_OPEN_WELCOME' }));
  wireWelcome.paint = paint;
  await paint();
}

(async function boot() {
  Object.keys(RANGES).forEach(wireRange);
  wireLanguage();
  wireRetentionNotice();
  wireMediaGrant();
  wireWelcome();
  ['keymapEnabled', 'rtlMirror', 'rtlAccent', 'rtlBidi', 'vfxEnabled', 'redact', 'preRollBuffer', 'saveAs', 'autoSubmitDefect'].forEach(wireSwitch);
  wireDownloadFolder();

  // The two ambiguous redaction families.
  for (const chip of document.querySelectorAll('#redactExtra button')) {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      const chosen = [...document.querySelectorAll('#redactExtra button')]
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => c.dataset.family);
      save({ redactExtra: chosen }, { immediate: true });
    });
  }

  // Retention, run on demand, so a person can see it work rather than trust it.
  $('purge-now')?.addEventListener('click', async () => {
    const note = $('purge-state');
    if (note) note.textContent = t('options.privacy.purgeLooking');
    const res = await send({ type: 'UQA_PURGE_NOW' });
    if (!note) return;
    if (!res?.ok) { note.textContent = werr(res) || t('options.privacy.purgeFailed'); return; }
    const { purged, keptForever, days } = res.result || {};
    note.textContent = keptForever
      ? t('options.privacy.purgeNever')
      : purged
        ? t(purged === 1 ? 'options.privacy.purgedOne' : 'options.privacy.purgedMany', { n: purged, days })
        : t('options.privacy.purgedNone', { days });
    paintPinned();
  });
  /* r2-03-4: beside "Run it now", how many sessions are pinned by hand and so never deleted whatever their age. */
  const paintPinned = async () => {
    const host = $('purge-state');
    if (!host) return;
    let el = $('purge-pinned');
    if (!el) {
      el = document.createElement('span');
      el.id = 'purge-pinned';
      el.className = 'range-note';
      host.after(el);
    }
    const res = await send({ type: 'UQA_LIST_SESSIONS' });
    const n = res?.ok && Array.isArray(res.result) ? res.result.filter((s) => s && s.keep).length : 0;
    el.textContent = res?.ok ? t('options.privacy.pinned', { n: group(n) }) : '';
  };
  paintPinned();
  QAWi18n.onChange(paintPinned);
  paintTheme();
  wireMaskPattern();
  wireJira();
  wireFolder();
  integ = wireIntegrations({ $, t, send, save, getSettings: () => settings, repaintAll: paintAll });
  window.dispatchEvent(new Event('hashchange')); // now that the services exist, open #sec-integrations/<service>

  $('soundEnabled')?.addEventListener('change', (e) => {
    save({ soundEnabled: e.target.checked }, { immediate: true });
    paintSound();
    // Played straight away, because the answer to "what does that sound like"
    // should not require finding a second button.
    if (e.target.checked) window.UQASound?.play('switch.wake');
  });
  for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="soundScope"]'))) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      save({ soundScope: r.value }, { immediate: true });
      /** @type {any} */ (window).UQASound?.configure({ scope: r.value });
    });
  }
  $('soundVolume')?.addEventListener('input', (e) => {
    settings.soundVolume = Number(e.target.value);
    window.UQASound?.configure({ level: settings.soundVolume / 100, scope: settings.soundScope });
  });
  // Only on release: a preview on every pixel of the slider is a siren.
  $('soundVolume')?.addEventListener('change', () => window.UQASound?.play('tap', { force: true }));

  const res = await send({ type: 'UQA_GET_SETTINGS' });
  if (res.ok) settings = res.result;
  wireVault({
    send, t, werr, // r10-02-2: VAULT_BACKOFF and VAULT_REKEY are worded by code in platform/worker-errors.js
    unreadable: () => !!/** @type {any} */ (settings).vaultUnreadable, // T-011: say so, do not let a save fail in English
    changed: async () => {
      const r = await send({ type: 'UQA_GET_SETTINGS' });
      if (r.ok) { settings = r.result; paintAll(); }
    },
  });
  wireEgress(document, t); // T-070
  paintAll();
  renderCommands();
  await wireOutput();
  paintAll();       // repaint: the format list only existed after wireOutput
  paintFolder();
  booted = true;
})();

/* ── About: the identity a support thread quotes ───────────────────────── */
/** The identity, and the one sentence about it that is words rather than data. */
function paintAbout() {
  const d = paintAbout.described;
  const $$ = (id) => document.getElementById(id);
  if (!d || !$$('about-code')) return;
  $$('about-code').textContent = `${d.code} (v${d.version})`;
  $$('about-id').textContent = d.extensionId;
  // The address, from `PRODUCT.supportEmail`, so the card and the documents
  // cannot name two different mailboxes.
  const mail = $$('about-support');
  if (mail && d.supportEmail) {
    mail.textContent = d.supportEmail;
    mail.href = `mailto:${d.supportEmail}`;
    const rep = $$('bundle-report');
    if (rep) rep.href = `mailto:${d.supportEmail}?subject=${encodeURIComponent(`${d.name} ${d.version}`)}`;
  } else if (!d.supportEmail) { // no mailbox in brand.json: hide the rows that need one
    mail?.closest('dd')?.previousElementSibling?.setAttribute('hidden', '');
    mail?.closest('dd')?.setAttribute('hidden', '');
    $$('bundle-report')?.setAttribute('hidden', '');
  }
  $$('about-note').textContent = t(d.idMatchesKey ? 'options.about.publishedId' : 'options.about.unpackedId');
  $$('about-note').className = d.idMatchesKey ? 'range-note ready' : 'range-note armed';
}

/* ── T-063: support details, previewed, copied by the tester, never sent ── */
$('bundle-open')?.addEventListener('click', async () => {
  const [{ buildBundle }, { detect }, { RING_KEY }, { describe }] = await Promise.all([
    import('../core/support-bundle.js'), import('../core/capabilities.js'), import('../core/on.js'), import('../core/product.js'),
  ]);
  const local = /** @type {any} */ (await chrome.storage.local.get([RING_KEY, 'firstReportOpenedAt', 'bootMs', 'toolUseTicks']));
  const perms = await chrome.permissions.getAll().catch(() => ({ origins: [] }));
  const d = describe();
  $('bundle-text').value = buildBundle({
    name: d.name, build: `${d.code} (v${d.version})`, version: chrome.runtime.getManifest().version, ua: navigator.userAgent,
    capabilities: detect().caps, originCount: (perms.origins || []).length, settings, defaults: DEFAULTS,
    ring: local[RING_KEY], firstReportOpenedAt: local.firstReportOpenedAt, bootMs: local.bootMs, toolUseTicks: local.toolUseTicks,
  });
  $('bundle-dialog').showModal();
});
$('bundle-copy')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('bundle-text').value); flashSaved(t('options.about.bundleCopied')); } catch { $('bundle-text').select(); }
});
$('bundle-close')?.addEventListener('click', () => $('bundle-dialog').close());

(async () => {
  try {
    const { describe } = await import('../core/product.js');
    paintAbout.described = describe();
    paintAbout();
  } catch { /* the card is decorative if the module cannot load */ }
})();

/* ── a passive rating link, never after a session, hidden under any managed policy (T-050) ── */
(async () => {
  const link = document.getElementById('about-rate');
  if (!link) return;
  try {
    const { rateUrl } = await import('../core/rate-links.js');
    link.href = rateUrl();
    const managed = await chrome.storage.managed?.get?.(null);
    if (managed && Object.keys(managed).length) throw new Error('managed');
  } catch {
    document.getElementById('about-rate-dt')?.setAttribute('hidden', '');
    document.getElementById('about-rate-dd')?.setAttribute('hidden', '');
  }
})();

/* ── the tutorials, one line pointing at their own page ───────────────── */
/**
 * The count, and nothing else.
 *
 * This was a card of six posters at the top of the settings page. Nader's
 * words: "stacked in settings it will annoy anyone who wants to navigate the
 * settings" — a set of films is watched once and scrolled past for ever after.
 * So the page keeps one row in About, and the films have `tutorials.html` to
 * themselves.
 *
 * The number is read from the same `lessons.json` the page itself reads, so it
 * cannot claim a film that was never recorded.
 */
function paintFilms() {
  const link = document.getElementById('about-tutorials');
  if (link && paintFilms.count) link.textContent = t('options.about.filmsCount', { n: paintFilms.count });
}

(async () => {
  if (!document.getElementById('about-tutorials')) return;
  try {
    const lessons = await (await fetch(chrome.runtime.getURL('tutorials/lessons.json'))).json();
    if (Array.isArray(lessons) && lessons.length) paintFilms.count = lessons.length;
    paintFilms();
  } catch { /* "Short films" is in the markup and is already true */ }
})();

/**
 * Seven tabs over the page's cards (round 3, Nader approved the prototype).
 *
 * Every card keeps its id, so a bookmark or in-page link such as `#sec-permissions`
 * (or `#sec-integrations/slack`) still lands where it did: `ownerOf` maps any id on
 * the page to its card and `GROUPS` maps the card to its tab. Controls are still
 * looked up by `getElementById`, so hiding the other cards changes nothing that is
 * saved. The search box filters the rail (a count per tab) and the rows.
 */
(() => {
  const GROUPS = {
    appearance: ['sec-appearance'],
    recording: ['sec-sessions', 'sec-timeline'],
    tools: ['sec-shortcuts', 'sec-stress', 'sec-break'],
    files: ['sec-files'],
    integrations: ['sec-integrations'],
    privacy: ['sec-permissions', 'sec-privacy', 'sec-safe'],
    updates: ['sec-updates'],
    about: ['about-card'],
  };
  const tabs = [...document.querySelectorAll('#rail [role="tab"]')];
  const cards = [...document.querySelectorAll('main > .card')];
  if (!tabs.length || !cards.length) return;
  const groupOfCard = new Map(Object.entries(GROUPS).flatMap(([g, ids]) => ids.map((id) => [id, g])));
  const ownerOf = new Map();
  for (const card of cards) {
    ownerOf.set(card.id, card.id);
    for (const el of card.querySelectorAll('[id]')) ownerOf.set(el.id, card.id);
  }
  ownerOf.set('sec-language', 'sec-appearance');
  ownerOf.set('sec-sound', 'sec-appearance');
  let current = 'appearance';

  function activate(group, { focusTab = false, scrollTarget = null } = {}) {
    if (!GROUPS[group]) group = 'appearance';
    current = group;
    for (const card of cards) card.hidden = groupOfCard.get(card.id) !== group;
    for (const tab of tabs) {
      const on = tab.dataset.rail === group;
      tab.classList.toggle('is-here', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    }
    (scrollTarget ? document.getElementById(scrollTarget) : null)?.scrollIntoView({ block: 'start' });
  }

  function route({ focusTab = false } = {}) {
    const [raw, service] = decodeURIComponent(location.hash.slice(1)).split('/');
    const cardId = ownerOf.get(raw);
    if (!raw || !cardId) { activate(current); return; }
    activate(groupOfCard.get(cardId), { focusTab, scrollTarget: raw === cardId ? null : raw });
    if (cardId === 'sec-integrations' && service) integ.openService?.(service);
  }
  window.addEventListener('hashchange', () => route());
  route();

  /* search */
  const ROW = '.switch,.check,.text-field,.field,.range-field,.svc,.callout,.setting-row,.key-row,.kv';
  const q = document.getElementById('q');
  let moved = false;
  const nores = Object.assign(document.createElement('p'), { id: 'nores', className: 'muted', hidden: true });
  document.querySelector('main').prepend(nores);
  const rowsOf = (card) => [...card.querySelectorAll(ROW)].filter((r) => !r.parentElement.closest(ROW));
  function filter() {
    // r3-10-3: term and row text fold the same way, so a search typed with another alef, taa marbuta
    // or digit form still finds the row.
    const fold = (x) => normaliseArabic(String(x).toLowerCase());
    const term = fold(q.value.trim());
    const counts = {};
    for (const card of cards) {
      const g = groupOfCard.get(card.id);
      counts[g] ??= 0;
      for (const r of rowsOf(card)) {
        const hit = !term || fold(`${r.textContent} ${r.dataset.kw || ''}`).includes(term);
        r.classList.toggle('hide', !hit);
        r.classList.toggle('hit', !!term && hit);
        if (hit && term) counts[g]++;
      }
    }
    for (const tab of tabs) {
      const n = counts[tab.dataset.rail] || 0;
      tab.hidden = !!term && !n;
      let badge = tab.querySelector('.n');
      if (!badge) tab.append((badge = Object.assign(document.createElement('span'), { className: 'n' })));
      badge.hidden = !term;
      badge.textContent = n;
    }
    const first = tabs.find((tb) => !tb.hidden && counts[tb.dataset.rail]);
    nores.hidden = !(term && !first);
    nores.textContent = t('options.search.none', { q: q.value.trim() });
    if (term && first && !counts[current]) { moved = true; activate(first.dataset.rail); }
    if (!term && moved) { moved = false; route(); } // clearing the box returns to the tab the address names
  }
  q?.addEventListener('input', filter);
  QAWi18n.onChange(() => q && filter());
  document.addEventListener('uqa-grid', () => q?.value && filter());

  document.getElementById('rail').addEventListener('keydown', (e) => {
    const visible = tabs.filter((tb) => !tb.hidden);
    const from = visible.findIndex((tb) => tb === document.activeElement);
    if (from === -1) return;
    const rtl = document.documentElement.dir === 'rtl';
    const next = e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !rtl) || (e.key === 'ArrowLeft' && rtl);
    const prev = e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !rtl) || (e.key === 'ArrowRight' && rtl);
    const to = next ? (from + 1) % visible.length : prev ? (from - 1 + visible.length) % visible.length : e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    location.hash = visible[to].getAttribute('href').slice(1);
    activate(visible[to].dataset.rail, { focusTab: true });
  });
})();

/* ── the safe route ────────────────────────────────────────────────────── */

/**
 * Two undo buttons, and a confirmation that costs something.
 *
 * A dialog that asks "are you sure?" and takes a click is answered by reflex.
 * Resetting settings is recoverable — everything on this page can be typed
 * again — so it takes a click. Erasing sessions is not: it is the tester's
 * evidence, and it takes a typed word, which is the smallest thing that cannot
 * be pressed by accident.
 *
 * Neither button does the work: the worker does, behind `UQA_RESET_SETTINGS`
 * and `UQA_ERASE_ALL`, which flush the write queue first and broadcast when
 * they are done, so the popup and the report repaint themselves rather than
 * being repainted from here.
 */
function askThen(question, { typed = false, run }) {
  const dlg = document.getElementById('confirm-dialog');
  const word = document.getElementById('confirm-word');
  document.getElementById('confirm-text').textContent = question;
  document.getElementById('confirm-typed').hidden = !typed;
  word.value = '';
  const go = document.getElementById('confirm-go');
  const check = () => { go.disabled = typed && word.value.trim().toUpperCase() !== 'ERASE'; };
  check();
  word.oninput = check;
  go.onclick = async () => {
    if (typed && word.value.trim().toUpperCase() !== 'ERASE') return;
    dlg.close();
    await run();
  };
  document.getElementById('confirm-cancel').onclick = () => dlg.close();
  document.getElementById('confirm-close').onclick = () => dlg.close();
  dlg.showModal();
  (typed ? word : go).focus();
}

async function paintFootprint() {
  const line = document.getElementById('footprint');
  if (!line) return;
  const res = await send({ type: 'UQA_SESSION_FOOTPRINT' });
  const { describeFootprint } = await import('../core/sessions.js');
  line.textContent = res?.ok ? describeFootprint(res.result, t) : t('options.safe.footprintFailed');
  const erase = document.getElementById('erase-all');
  if (erase) erase.disabled = !!res?.ok && !res.result.sessions;
}

document.getElementById('reset-settings')?.addEventListener('click', () => {
  askThen(erasedText(t, 'reset'), {
    run: async () => {
      const state = document.getElementById('reset-state');
      const res = await send({ type: 'UQA_RESET_SETTINGS' });
      if (!res?.ok) { state.textContent = res?.error || t('options.safe.resetFailed'); return; }
      settings = res.result;
      state.textContent = t('options.safe.resetDone');
      paintFootprint();
      // Every control on this page is painted during boot, from one snapshot.
      // Re-reading it is the page's own job and it does it once, so the honest
      // repaint after a reset is the page itself. The line above survives it
      // long enough to be read, and the reloaded page shows the defaults.
      setTimeout(() => location.reload(), TIMING.reloadAfterReset);
    },
  });
});

document.getElementById('erase-all')?.addEventListener('click', () => {
  askThen(erasedText(t, 'eraseAll') || t('options.safe.eraseQuestion'), {
    typed: true,
    run: async () => {
      const state = document.getElementById('erase-state');
      state.textContent = t('options.safe.erasing');
      const res = await send({ type: 'UQA_ERASE_ALL' });
      if (!res?.ok) { state.textContent = res?.error || t('options.safe.eraseFailed'); return; }
      const { sessions = 0, mb = 0, failed = [] } = res.result || {};
      // D-1010-103: a store that would not clear is a privacy fact. Never the done or gone sentence over it.
      if (Array.isArray(failed) && failed.length) {
        state.textContent = t('options.safe.erasePartial', { n: failed.length });
        paintFootprint();
        return;
      }
      state.textContent = sessions
        ? `${t(sessions === 1 ? 'options.safe.eraseDoneOne' : 'options.safe.eraseDoneMany', { n: sessions, mb })} ${erasedText(t, 'eraseAll', { gone: true })}`.trim()
        : t('options.safe.eraseNothing');
      paintFootprint();
    },
  });
});

paintFootprint();
