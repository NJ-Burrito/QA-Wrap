/* QA Wrap — settings page: folder, sound, language and theme painting (split from options.js). */
import { DEFAULTS, DOWNLOAD_FOLDER_HELP, RANGES } from '../platform/settings.js';
import { managedStatus, paintPolicy } from './policy-panel.js';
import { POLICY_DEFAULTS as DEFAULTS_POLICY } from '../platform/policy.js';
import { booted, integ, policyStatus, profileUi, setPolicyStatus, settings } from './options-state.js';
import { $, WERR, flashSaved, paintRetentionNotice, save, send, t } from './options-base.js';
import { JIRA_FIELDS, paintImageQuality, paintStorage, renderCommands, renderKeymap, secretView, wireJira, wireMediaGrant } from './options-panels.js';

QAWi18n.onChange(() => {
  QAWi18n.apply();
  paintWords();
});

managedStatus().then((s) => { setPolicyStatus(s); if (booted) paintAll(); });

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

function paintAll() {
  profileUi.paint();
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
  for (const name of ['imageFormat', 'videoFormat', 'videoQuality', 'webcamPosition', 'clock', 'launchSurface']) {
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
  profileUi.paint();
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

async function paintFootprint() {
  const line = document.getElementById('footprint');
  if (!line) return;
  const res = await send({ type: 'UQA_SESSION_FOOTPRINT' });
  const { describeFootprint } = await import('../core/sessions.js');
  line.textContent = res?.ok ? describeFootprint(res.result, t) : t('options.safe.footprintFailed');
  const erase = document.getElementById('erase-all');
  if (erase) erase.disabled = !!res?.ok && !res.result.sessions;
}

export { paintAbout, paintAll, paintFilms, paintFolder, paintFootprint, paintSound, paintTheme, wireDownloadFolder, wireFolder, wireLanguage, wireMaskPattern, wireWelcome };
