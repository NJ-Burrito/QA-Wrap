/* QA Wrap — settings page: permission, keymap, Jira and output panels (split from options.js). */
import { RANGES, ACTIONS, bindingFromEvent, formatBinding, isUsableBinding, conflictsWith, hasSidePanel } from '../platform/settings.js';
import { resolveAuthMode, detectAuthMode, isAutoMode } from '../core/jira-auth.js';
import { settings } from './options-state.js';
import { $, FORMATTERS, NOTES, TIMING, flashSaved, listOf, save, send, t } from './options-base.js';

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

  for (const name of ['imageFormat', 'videoFormat', 'videoQuality', 'webcamPosition', 'clock', 'launchSurface']) {
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

export { JIRA_FIELDS, paintImageQuality, paintStorage, recording, renderCommands, renderKeymap, secretView, wireJira, wireMediaGrant, wireOutput, wireRange, wireSwitch };
