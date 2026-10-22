/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
import { withDeadline } from './deadline.js';
import { readVault, writeVault, forgetVault, UNREADABLE } from './vault.js';
import { RING_KEY } from '../core/on.js';
import { REGISTRY } from '../core/store-registry.js';
import { useLedgerArea, useRedirectGuard } from '../core/egress.js';
import { POLICY_DEFAULTS, normalisePolicy, allows, policyError, capRetention, LOCKED_FAMILIES } from './policy.js';
/**
 * User settings.
 *
 * Stored in chrome.storage.sync so they follow the tester between machines, with
 * a local fallback if sync is unavailable (enterprise policy sometimes disables
 * it). Every surface reads through here so defaults exist in exactly one place.
 *
 * Content scripts cannot import this — they receive a snapshot from the bridge.
 */

/**
 * Where the webcam inset sits in the frame.
 *
 * The four corners, in one list, because three surfaces have to agree on them:
 * the popup's control, the Settings default, and the compositor in
 * `offscreen/offscreen.js`, which reads the string for the words `left` and
 * `top` rather than matching it against a table. A fifth corner is not a thing;
 * a *centre* would be, and is deliberately absent — an inset over the middle of
 * the picture covers the thing being filmed.
 */
export const WEBCAM_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const SOUND_SCOPES = ['core', 'all'];

export const RANGES = {
  expandPercent: { min: 0, max: 200, step: 10, unit: '%' },
  causalWindowMs: { min: 500, max: 20000, step: 500, unit: 'ms' },
  inputDebounceMs: { min: 100, max: 2000, step: 50, unit: 'ms' },
  breakDelayMs: { min: 0, max: 30000, step: 250, unit: 'ms' },
  breakRepeat: { min: 0, max: 25, step: 1, unit: '×' }, // 0 = until turned off
  // How many rows the PANEL draws at once — a display budget, not a recording
  // limit. Nothing is ever dropped from the session because of it.
  maxTimelineRows: { min: 100, max: 20000, step: 100, unit: 'rows' },
  maxStressNodes: { min: 200, max: 20000, step: 200, unit: 'nodes' },
  screenshotWidth: { min: 120, max: 600, step: 20, unit: 'px' },
  imageQuality: { min: 40, max: 100, step: 1, unit: '%' },
  videoFps: { min: 5, max: 30, step: 1, unit: 'fps' },
  webcamSize: { min: 10, max: 40, step: 1, unit: '%' },
  soundVolume: { min: 0, max: 100, step: 5, unit: '%' },
  // 0 reads as "forever" rather than "immediately" — see the label in options.js.
  retentionDays: { min: 0, max: 365, step: 1, unit: 'days' },
};

/**
 * The two routes a file can take out of here, wherever they are shown.
 *
 * One string, so the Settings page and the report's Save sheet cannot drift
 * apart on a limitation that has to be stated exactly once and exactly right.
 * Two sentences, because there are two routes and a tester picking between
 * them needs to know which one they are looking at.
 */
export const DOWNLOAD_FOLDER_HELP =
  'Choose a folder and QA Wrap writes into it directly, anywhere on your disk, with the '
  + 'category tree above laid out inside it. Files written that way do not appear in the '
  + 'browser’s download list, because the browser is not the one writing them: QA Wrap '
  + 'names the folder and the files in the message it shows you instead. Without a folder, '
  + 'files go through the browser itself and are listed in its downloads, '
  + 'where Chrome does not let an extension read the folder you pick in its Save dialog, or '
  + 'choose one for you: all it can do is name a subfolder inside Downloads, which is what '
  + '"Save into" is. Leave that empty and files go to Downloads/QA Wrap.';

/** Jira priority names by QA Wrap severity; `jira.priorityMap` overrides per key. */
export const DEFAULT_PRIORITY_MAP = Object.freeze({ critical: 'Highest', major: 'High', moderate: 'Medium', minor: 'Low' });

export const DEFAULTS = {
  /* session */
  // Kept only so sessions recorded before the control was removed still read
  // correctly. Nothing sets these any more: a session runs until it is stopped.
  timeboxMinutes: null,
  timeboxEnabled: false,

  /* layout stress */
  expandPercent: 40,
  maxStressNodes: 4000,
  rtlMirror: true,
  rtlAccent: false,
  rtlBidi: false,

  /* correlation + capture */
  causalWindowMs: 5000,
  inputDebounceMs: 400,

  /* break-a-request defaults */
  breakDelayMs: 5000,
  breakRepeat: 1,

  /* panel */
  maxTimelineRows: 1000,
  screenshotWidth: 300,
  liveRefreshMs: 1000,

  /* in-page keymap — fully customisable, handled by the content script.
     Chrome's own command shortcuts are separate and live in chrome://extensions/shortcuts. */
  keymap: {
    pick: 'Alt+KeyS',
    inject: 'Alt+KeyE',
    rtl: 'Alt+KeyD',
    note: 'Alt+KeyN',
    shot: 'Alt+KeyC',
    a11y: 'Alt+KeyA',
    bar: 'Alt+KeyB',
  },
  keymapEnabled: true,

  /* privacy */
  maskExtraPattern: '',
  /** Opt-in: an awake tab keeps its last minute in memory so a session started after a bug can include it. Off by default. */
  preRollBuffer: false,
  /** The recording dot on pages while a session records; Settings > Permissions switches it off. On by default. */
  pageIndicator: true,

  /* integrations — off unless the tester fills these in. The only feature in
     the product that sends anything off the machine. */
  /**
   * `authMode` is which Jira this is: `auto`, `cloud` or `server`.
   *
   * There are two of them and they sign a request differently. Atlassian's
   * hosted Jira takes an email and an API token as HTTP Basic; a self-hosted
   * Data Center site takes a personal access token as a Bearer header and
   * refuses the Basic pair with a bare 401 that reads as a wrong token. `auto`
   * reads the host, which is right for almost everybody, and the two named
   * values are the override for the rest. See `core/jira-auth.js`.
   */
  jira: { baseUrl: '', email: '', token: '', project: '', issueType: 'Bug', authMode: 'auto' },
  slack: { webhookUrl: '', mention: '' },

  /* output — how artefacts are written, and what they are called */
  imageFormat: 'png',      // png | jpeg | webp
  imageQuality: 92,        // ignored for png, which is lossless
  /*
   * MP4 first, WebM only when the browser cannot write MP4: WebM is a download link in Jira, refused inline by Teams
   * and unplayable on iPhone. `minimum_chrome_version` stays 116 because offscreen.js falls back to WebM when no MP4
   * candidate answers isTypeSupported. The winner is written onto the media record (`type`) and the event (`mediaType`).
   */
  videoFormat: 'mp4',      // mp4 | webm | gif — probed at runtime, never assumed
  videoFps: 15,
  videoQuality: 'medium',  // low | medium | high
  clock: '24',             // 24 | 12 — how the time reads in a filename

  /**
   * Where saved files land. An extension cannot read the browser's Save-dialog folder or set the download directory
   * (`downloads.download()` takes a path relative to Downloads), so "remember the folder" is a subfolder name under
   * Downloads, per profile. Empty means `Downloads/QA Wrap/…`. `saveAs` (open the browser's dialog at all) is ours to remember.
   */
  downloadFolder: '',
  saveAs: false,

  /**
   * File the defect report into Jira the moment a session stops. Off by default: it is the one setting that sends a
   * document off the machine without a press for that document. On, it uses the "Auto-submit" path and does nothing
   * when Jira is not configured.
   */
  autoSubmitDefect: false,

  /* ---- privacy: on by default (GDPR Art. 25, ISO/IEC 27701 cl. 7.4); a control to be found and switched on protects nobody. */
  /** Take card numbers, IBANs, tokens and private keys out of every event before it is stored. */
  redact: true,
  /**
   * The ambiguous families, off unless asked for: `nationalId`, `email`.
   * A ten-digit national number and a ten-digit order reference are the same
   * shape, and a tester testing order references needs to read them.
   */
  redactExtra: [],
  /**
   * Days a finished session is kept before it is deleted. 0 keeps them forever.
   * GDPR Article 5(1)(e): held no longer than the purpose needs — and the
   * purpose of a bug report ends when the bug is closed.
   *
   * This is the default for a **fresh install**, and only that. A profile that
   * already existed before the setting did resolves to 0 instead — see
   * `resolveRetentionDays()` below for why 30 as a fallback was a bug rather
   * than a default.
   */
  retentionDays: 30,

  /**
   * Has the tester been told about the retention window yet? False on an upgraded profile means nobody has chosen and
   * everything is kept until they do; Settings shows the choice once and writes this true whichever way they answer
   * (asserted by tools/test-options-save.mjs).
   */
  retentionNoticeSeen: false,

  /* what goes into a recording, besides the tab */
  /**
   * Credentials for the trackers that are not Jira.
   *
   * `{ github: { token, repo }, linear: { token, team }, … }` — shape declared
   * by each adapter in background/trackers.js rather than duplicated here, so
   * adding a tracker is one file rather than three.
   *
   * Personal tokens, never OAuth. An extension cannot keep a client secret:
   * anything in the bundle is readable by anyone who installs it.
   */
  trackers: {},

  /** What the toolbar icon opens: a floating window, or the side panel. */
  launchSurface: 'float',   // float | panel

  /**
   * The team workspace this machine has joined, if any.
   *
   * `{ name, role, importedAt, … }` — see core/workspace.js. Null for the common
   * case of one person with no team, who must not have to grant themselves
   * permission to use their own tool.
   */
  workspace: null,

  /**
   * Provenance is automatic and invisible, so there is nothing to configure.
   *
   * The settings that used to live here — position, opacity, scale — belonged
   * to a version that painted a plate of text onto every screenshot. Nothing is
   * painted any more: a PNG gets `tEXt` chunks and not one pixel moves, so
   * there is no placement to choose and no reason to make anybody choose it.
   */


  /* sound. On, every sound, every click (Nader, 4 Oct 2026: "make it by default
     to have all sounds of every click"). Was off / 'core' until then. Only the
     default moved: a value a tester saved, true or false, is spread over this
     and stays, and the switch and the scope in Options still turn it down. */
  soundEnabled: true,
  soundVolume: 70,          // %
  soundScope: 'all',        // SOUND_SCOPES
  vfxEnabled: true,         // motion: transform and opacity only, ≤ 500 ms, off with reduced-motion

  /*
   * Desktop notifications for the four things that happen out of sight (recording started, stopped and filed, session
   * saved, extension asleep). On by default, unlike sound: they answer "it did something and told me nothing".
   * One key, not four.
   */
  systemNotifications: true,

  recordMic: false,
  recordTabAudio: false,
  recordWebcam: false,
  /*
   * The pointer in a recording; on by default (8 Sept 2026) because a walkthrough
   * without one shows fields filling themselves. A tick, since a layout clip or a
   * shared screen is better off without a mouse. Both kinds honour it:
   *   tab     `tabCapture` has no pointer, so it is drawn from the page's pointer
   *           events when ticked (`offscreen/offscreen.js` drawPointer).
   *   screen  `getDisplayMedia` takes the OS cursor; the `cursor` constraint is
   *           'always' or 'never' (unticked used to be ignored here).
   */
  recordCursor: true,
  /** Which corner the webcam inset starts in. One of WEBCAM_POSITIONS. */
  webcamPosition: 'bottom-right',
  webcamSize: 22,          // % of frame height
  fileTree: true,          // lay down the category folders, or write flat
  saveFolderName: '',      // the folder the tester granted, for display only
  testerName: '',          // on the session card a shared folder shows; never sent anywhere
};

/** What each in-page action is, in the words the options page shows. */
export const ACTIONS = {
  pick: { label: 'Copy a locator', hint: 'Click an element, get a Playwright locator' },
  inject: { label: 'Try nasty values', hint: 'Open edge cases for a field' },
  rtl: { label: 'Stress the layout', hint: 'Flip to RTL and grow the text' },
  note: { label: 'Quick note', hint: 'Jot something into the session' },
  shot: { label: 'Screenshot', hint: 'Capture the visible page' },
  a11y: { label: 'Accessibility scan', hint: 'Run axe-core on this page' },
  bar: { label: 'Go to the bar', hint: 'Move keyboard focus to the in-page bar' },
};

const KEY = 'settings';
/** D-1010-58: storage.local holds everything the registry does not list as synced: the tester's name, the workspace, the save-folder name and any key a newer build adds. */
export const LOCAL_KEY = 'settingsLocal';
/** The allow-list: only these keys of the settings record go to storage.sync (core/store-registry.js row sync:settings). */
const SYNCS = new Set(/** @type {string[]} */ (/** @type {any} */ (REGISTRY.find((r) => r.id === 'sync:settings')).syncs));
let localMove = false;

/**
 * How long to keep sessions, for a profile that has never said.
 *
 * `retentionDays: 30` sits in `DEFAULTS` under whatever is stored, so a profile that predates the setting read 30 and
 * the first `purgeExpired()` after the update deleted every session older than thirty days, unasked and with no undo.
 * A stored record with no explicit `retentionDays` is a person who never chose: it resolves to 0 (keep everything) and
 * Settings asks once (`retentionNoticeSeen`). No stored record at all is a fresh install with no history to lose, so it
 * keeps the 30-day default.
 *
 * @param {object|null|undefined} saved  the stored settings record, as stored
 */
export function resolveRetentionDays(saved) {
  if (saved == null || typeof saved !== 'object') return DEFAULTS.retentionDays;
  if (!Object.prototype.hasOwnProperty.call(saved, 'retentionDays')) return 0;
  const days = Number(saved.retentionDays);
  // A stored value that is not a number is not a choice either. Keeping
  // everything is the recoverable way to be wrong; deleting is not.
  return Number.isFinite(days) ? days : 0;
}

function clampNumbers(patch) {
  const out = { ...patch };
  for (const [name, range] of Object.entries(RANGES)) {
    if (out[name] == null) continue;
    const n = Number(out[name]);
    out[name] = Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, n)) : DEFAULTS[name];
  }
  if (typeof out.maskExtraPattern === 'string') out.maskExtraPattern = out.maskExtraPattern.slice(0, 2000); // r4-06-1: syncs, so it stays small
  return out;
}

async function area() {
  // storage.sync can be disabled by policy; fall back rather than throw.
  try {
    await withDeadline(chrome.storage.sync.get(null), 'sync');
    return chrome.storage.sync;
  } catch (e) {
    if (e?.code === 'SLOW') throw e; // a slow read is not a disabled one: never fall back and write to the wrong area
    return chrome.storage.local;
  }
}

/**
 * What never syncs: credentials stay in this profile (a synced secret is a copy on Google's servers and
 * every signed-in machine). They live in the vault (platform/vault.js) and are merged back at read.
 */
const SECRET_KEY = 'secrets'; // the pre-vault plaintext record: read once, migrated, removed
const SECRET_FIELDS = ['jira', 'slack', 'trackers', 'webhooks'];

/** What content scripts may hold: no credentials (a page could read them). */
export function publicSettings(settings) {
  const open = { ...(settings || {}) };
  for (const k of SECRET_FIELDS) delete open[k];
  delete open.vaultLocked;
  delete open.vaultUnreadable;
  return open;
}

/* Extension pages see "••••last4" where a secret is; a masked value sent back means "unchanged". */
const DOTS = '••••';
const hide = (v, _old, url) => {
  if (!v || typeof v !== 'string' || v.includes(DOTS)) return v;
  let o = '';
  if (url) try { o = new URL(v).origin + '/'; } catch { /* not a URL */ }
  return o + DOTS + v.slice(-4);
};
const keep = (v, old) => (typeof v === 'string' && v.includes(DOTS) ? old || '' : v);
const on = (o, k, f) => (o && k in o ? { ...o, [k]: f(o[k]) } : o);
function eachSecret(s, f, cur = {}) {
  const r = { ...s };
  if (r.jira) r.jira = on(r.jira, 'token', (v) => f(v, cur.jira?.token));
  if (r.slack) r.slack = on(r.slack, 'webhookUrl', (v) => f(v, cur.slack?.webhookUrl, 1));
  if (r.trackers) r.trackers = Object.fromEntries(Object.entries(r.trackers).map(([k, c]) => [k, on(c, 'token', (v) => f(v, cur.trackers?.[k]?.token))]));
  if (Array.isArray(r.webhooks)) r.webhooks = r.webhooks.map((d) => { const o = (cur.webhooks || []).find((x) => x.id === d.id); return on(on(d, 'url', (v) => f(v, o?.url, 1)), 'token', (v) => f(v, o?.token)); });
  return r;
}
export const redact = (s) => (s && typeof s === 'object' ? eachSecret(s, hide) : s);
export const unmask = (p, cur) => eachSecret(p, keep, cur);

const splitSecrets = (obj) => {
  const open = { ...obj };
  const secret = {};
  for (const k of SECRET_FIELDS) {
    if (k in open) {
      secret[k] = open[k];
      delete open[k];
    }
  }
  return { open, secret };
};

/* ── what the machine's administrator has decided ──────────────────────── */

/**
 * Policy, set by whoever manages the machine, not by whoever uses it (`chrome.storage.managed`;
 * schema `managed-schema.json`, named in the manifest or Chrome refuses the area). Keys: platform/policy.js.
 *
 * Fails open: an unmanaged machine has no policy, and every failure path returns the defaults.
 *
 * `managed.get` can fail to answer (measured 8 Sept 2026: it never settles on a clean profile, so Record hit its
 * 10 s deadline). Hence: (1) a read a person waits on has a deadline, POLICY_DEADLINE_MS, and past it the defaults
 * answer; (2) the last answer is cached in session storage, which survives a worker teardown a variable would not;
 * (3) watchPolicy() re-reads on the `managed` onChanged, so a revocation lands at once.
 */
// The registry (keys, defaults, normalising) is platform/policy.js; this file reads it, caches it and applies it.
export { POLICY_DEFAULTS };
if (typeof chrome !== 'undefined') useLedgerArea(chrome.storage?.local); // T-070: where the egress ledger lives
useRedirectGuard(async () => ((await policy()).integrationHosts || []).length > 0); // D-1010-54: a host allow-list is set, so sends do not follow redirects

/** Where the last known-good answer lives, so a hung read cannot be felt twice. */
const POLICY_CACHE = 'managedPolicy';

/**
 * How long the managed area may keep a person waiting.
 *
 * Long enough that a merely slow provider still answers with the truth, short
 * enough that a tester pressing Record does not notice. A provider that is
 * slower than this is caught by `warmPolicy()` a moment later and cached, so
 * the delay is paid at most once.
 */
const POLICY_DEADLINE_MS = 400;

/** The managed area, read and normalised. May never settle; callers must race it. */
async function readManaged() {
  // Throws on a build with no manifest entry and answers `{}` with no policy set: both mean nothing is restricted.
  return normalisePolicy(await chrome.storage.managed?.get?.(Object.keys(POLICY_DEFAULTS)));
}

/*
 * The cache is a convenience, never a dependency.
 *
 * `chrome.storage.session` is missing in a unit test's stub and can be absent
 * or refused in a context that has not been granted it, and neither of those is
 * a reason to answer the wrong thing about a microphone. Both halves swallow
 * their own failure and the caller reads through to the managed area.
 */
async function cachedPolicy() {
  try {
    const store = await chrome.storage.session?.get?.(POLICY_CACHE);
    const held = store?.[POLICY_CACHE];
    return held ? normalisePolicy(held) : null; // also fills keys a cache written by an older build lacks
  } catch {
    return null;
  }
}

async function rememberPolicy(fresh) {
  try {
    await chrome.storage.session?.set?.({ [POLICY_CACHE]: fresh });
  } catch {
    /* nowhere to keep it: the read simply happens again next time */
  }
}

export async function policy() {
  const held = await cachedPolicy();
  if (held) return held;

  let fresh = null;
  try {
    fresh = await Promise.race([
      readManaged(),
      new Promise((resolve) => setTimeout(() => resolve(null), POLICY_DEADLINE_MS)),
    ]);
  } catch {
    fresh = null;
  }
  // A timeout is not an answer and must not be cached as one: `warmPolicy()` is
  // still waiting on the same read and will cache the truth when it arrives.
  if (!fresh) return { ...POLICY_DEFAULTS };
  await rememberPolicy(fresh);
  return fresh;
}

/**
 * Fill the cache off the critical path.
 *
 * Called at boot, and again whenever Chrome says the managed area changed. It
 * has no deadline of its own — nobody is waiting on it — so a provider that
 * takes four seconds to come up still ends with the right answer cached, and
 * every read after that is instant and true.
 */
export async function warmPolicy() {
  try {
    const fresh = await readManaged();
    await rememberPolicy(fresh);
    return fresh;
  } catch {
    return { ...POLICY_DEFAULTS };
  }
}

/**
 * Keep the cache true for the life of the browser.
 *
 * This is the half that lets the cache exist at all. An administrator pushing a
 * policy — or taking one away — reaches `chrome.storage.onChanged` for the
 * `managed` area, and the cache is rebuilt from the change itself, so the
 * revocation is honoured on the next read rather than after a restart.
 */
export function watchPolicy() {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'managed') warmPolicy();
  });
  return warmPolicy();
}

/** The seam and the last line: throws a coded `POLICY` error naming the key, or returns. `url` is matched against integrationHosts. */
export async function assertPolicy(feature, url) {
  const hit = allows(await policy(), feature, url);
  if (hit) throw policyError(hit);
}

/** The sentence every surface says when the microphone has been taken away. */
export const MIC_BLOCKED =
  'The microphone is switched off for this installation by whoever manages this computer. ' +
  'Everything else about recording still works.';

// Secrets come from the vault; older plaintext is encrypted on first read and removed only once it reads back identical.
let moving = null;
async function loadSecrets(store, saved) {
  const v = await readVault();
  if (v.locked) return { secrets: {}, locked: true };
  if (v.unreadable) return { secrets: {}, locked: false, unreadable: true };
  const { [SECRET_KEY]: old } = await chrome.storage.local.get(SECRET_KEY);
  const legacy = { ...splitSecrets(saved || {}).secret, ...(/** @type {any} */ (old) || {}) };
  if (!Object.keys(legacy).length) return { secrets: v.data || {}, locked: false };
  const all = { ...(v.data || {}), ...legacy };
  moving ||= (async () => {
    try {
      await writeVault(all);
      if (JSON.stringify((await readVault()).data) !== JSON.stringify(all)) throw new Error('verify');
      await chrome.storage.local.remove(SECRET_KEY);
      if (saved && Object.keys(splitSecrets(saved).secret).length) await store.set({ [KEY]: splitSecrets(saved).open });
    } catch { /* plaintext stays until the next read tries again */ }
    moving = null;
  })();
  try {
    await withDeadline(moving, 'write', undefined, () => { moving = null; });
  } catch (e) {
    if (e?.code === 'SLOW') throw e;
  }
  return { secrets: all, locked: false };
}

/** Is there a side panel here? Opera ships the API (the manifest asks for it) and `open()` fails there, so: API present AND not Opera. popup/guards.js holds the same two tests (classic script). */
export const hasSidePanel = () => typeof chrome !== 'undefined' && typeof chrome.sidePanel?.open === 'function'
  && !/\bOPR\//.test(globalThis.navigator?.userAgent || '') && !(/** @type {any} */ (globalThis.navigator)?.userAgentData?.brands?.some((/** @type {{ brand: string }} */ b) => /opera/i.test(b.brand)));

/** The last read that completed. A timed-out read may serve this; a save never builds on it. */
let lastGood = null;

export async function getSettings() {
  try {
    return await readSettings();
  } catch (e) {
    if (e?.code === 'SLOW' && lastGood) return structuredClone(lastGood);
    return { ...DEFAULTS, vaultLocked: true, policy: { ...POLICY_DEFAULTS }, keymap: { ...DEFAULTS.keymap }, jira: { ...DEFAULTS.jira }, slack: { ...DEFAULTS.slack }, trackers: {} };
  }
}

/** getSettings() without the fallback: throws when a read fails or is slow, so a save can refuse instead of writing defaults. */
async function readSettings() {
  {
    const store = await area();
    /** @type {[{[k: string]: any}, ReturnType<typeof normalisePolicy>, {[k: string]: any}, {[k: string]: any}]} */
    const [{ [KEY]: synced }, managed, { [LOCAL_KEY]: localRec }, { [KEY]: spill }] = await Promise.all([store.get(KEY), policy(), chrome.storage.local.get(LOCAL_KEY), chrome.storage.local.get(KEY)]);
    const saved = spill ?? synced; // spill: the whole record kept here while sync refused a write (D-1010-73)
    const { secrets, locked, unreadable } = await loadSecrets(store, saved);
    const merged = { ...(saved || {}), ...(localRec || {}), ...secrets };
    // An older build synced the whole record: move what is not on the list to storage.local, once, through the serialised writer.
    if (!localMove && synced && Object.keys(synced).some((k) => !SYNCS.has(k) && !SECRET_FIELDS.includes(k))) {
      localMove = true;
      setSettings({}).catch(() => {}).finally(() => { localMove = false; });
    }
    for (const k of SECRET_FIELDS) if (locked || !(k in secrets)) delete merged[k];
    return (lastGood = structuredClone({
      ...DEFAULTS,
      ...merged,
      ...(locked && { vaultLocked: true }),
      ...(unreadable && { vaultUnreadable: true }),
      // Resolved, not defaulted: an upgraded profile must not inherit a
      // deletion policy it never agreed to. See resolveRetentionDays().
      retentionDays: capRetention(resolveRetentionDays(saved), managed.retentionDaysMax),
      soundScope: merged.soundScope ?? (merged.soundEnabled ? 'all' : DEFAULTS.soundScope),
      keymap: { ...DEFAULTS.keymap, ...(merged.keymap || {}) },
      jira: { ...DEFAULTS.jira, ...(merged.jira || {}) },
      slack: { ...DEFAULTS.slack, ...(merged.slack || {}) },
      // Read, never stored: writeSettings() deletes it (an admin's decision must not outlive the policy).
      policy: managed,
      // The mic tick as it is, not as it was left: an admin may have revoked it since.
      recordMic: managed.microphoneAllowed === false ? false : (merged.recordMic ?? DEFAULTS.recordMic),
      // redactionLocked (T-068): redaction on and both ambiguous families on, whatever the synced copy says.
      ...(managed.redactionLocked && { redact: true, redactExtra: [...new Set([...(merged.redactExtra || []), ...LOCKED_FAMILIES])] }),
    }));
  }
}

/**
 * Settings writes run one at a time: `setSettings()` is a read-modify-write, and
 * two overlapping ones lost each other's fields (measured: "Save into" vs "Ask
 * where to save"). A promise chain, kept in this file because the worker's boot
 * graph is at its ceiling. The tail never rejects, so one failed write cannot
 * wedge the rest; the error goes to the caller that owns it.
 */
let writeChain = Promise.resolve();

export function setSettings(patch) {
  // Bounded: one stalled write rejects (SLOW) and frees the chain; `ctx.dead` makes its late tail skip every store.set.
  const ctx = { dead: false };
  const run = writeChain.then(() => withDeadline(writeSettings(patch, ctx), 'write', undefined, () => { ctx.dead = true; }));
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Write the open record as two: the listed keys to `store` (sync), the rest to storage.local. The sync record is
 * narrowed only after the local copy reads back equal; if it does not, the whole record stays where it was.
 */
async function putOpen(store, open, live) {
  const synced = {};
  const local = {};
  for (const [k, v] of Object.entries(open)) (SYNCS.has(k) ? synced : local)[k] = v;
  live();
  await chrome.storage.local.set({ [LOCAL_KEY]: local });
  const { [LOCAL_KEY]: back } = await chrome.storage.local.get(LOCAL_KEY);
  live();
  const record = { [KEY]: JSON.stringify(back) === JSON.stringify(local) ? synced : open };
  try {
    await store.set(record);
    if (store !== chrome.storage.local) await chrome.storage.local.remove(KEY);
  } catch (e) {
    // r4-06-1 (D-1010-73): sync is over quota or rate-limited. The save is not lost: the full record stays on this machine and is read first.
    if (store === chrome.storage.local) throw e;
    await chrome.storage.local.set({ [KEY]: open });
  }
}

async function writeSettings(patch, ctx = { dead: false }) {
  const current = await readSettings();
  const live = () => { if (ctx.dead) throw Object.assign(new Error('a newer save replaced this one'), { code: 'SLOW', stage: 'write' }); };
  patch = unmask(patch, current);
  const next = {
    ...current,
    ...clampNumbers(patch),
    keymap: { ...current.keymap, ...(patch.keymap || {}) },
    jira: { ...current.jira, ...(patch.jira || {}) },
    slack: { ...current.slack, ...(patch.slack || {}) },
    // One level deeper than the others: a patch names a tracker and the whole
    // of that tracker's config, so typing GitHub's token must not drop Linear.
    trackers: { ...current.trackers, ...(patch.trackers || {}) },
  };
  // Policy and lock state are read, never owned (see getSettings()).
  delete next.policy;
  delete next.vaultLocked;
  delete next.vaultUnreadable;
  const store = await area();
  const { open, secret } = splitSecrets(next);
  if (current.vaultLocked) {
    if (SECRET_FIELDS.some((k) => k in patch)) throw Object.assign(new Error('Unlock QA Wrap to change saved connections'), { code: 'VAULT_LOCKED' });
    await putOpen(store, open, live);
    return next;
  }
  if (current.vaultUnreadable) {
    // unreadable vault: unrelated saves go through, credential saves are refused (T-011)
    if (SECRET_FIELDS.some((k) => k in patch)) throw Object.assign(new Error(UNREADABLE), { code: 'VAULT_UNREADABLE' });
    await putOpen(store, open, live);
    return next;
  }
  // an unrelated save must not rewrite the vault
  const held = await readVault();
  const same = held.none ? !Object.keys(secret).length : JSON.stringify(held.data) === JSON.stringify(secret);
  live();
  await Promise.all([putOpen(store, open, live), same ? null : writeVault(secret)]);
  // The synced record must not keep a stale copy of a credential from before
  // the split; writing `open` above replaced it, which is the whole point.
  return next;
}

export async function resetSettings() {
  const store = await area();
  await Promise.all([store.remove(KEY), chrome.storage.local.remove([SECRET_KEY, RING_KEY, LOCAL_KEY, KEY]), forgetVault()]);
  return { ...DEFAULTS, keymap: { ...DEFAULTS.keymap }, jira: { ...DEFAULTS.jira }, slack: { ...DEFAULTS.slack }, trackers: {} };
}

/* ------------------------------------------------------------- key handling */

/**
 * A binding is modifiers plus a physical key code — `Alt+Shift+KeyS`. Codes,
 * not `key` values, because `key` changes with the keyboard layout and an
 * Arabic layout would otherwise silently break every shortcut.
 */
export function bindingFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  const code = e.code;
  if (!code || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)) return null;
  parts.push(code);
  return parts.join('+');
}

export function matchesBinding(e, binding) {
  if (!binding) return false;
  return bindingFromEvent(e) === binding;
}

/** Human-readable form: `Alt+KeyS` → `Alt + S`. */
export function formatBinding(binding) {
  if (!binding) return 'Not set';
  return binding
    .split('+')
    .map((part) => {
      if (part.startsWith('Key')) return part.slice(3);
      if (part.startsWith('Digit')) return part.slice(5);
      if (part.startsWith('Numpad')) return `Num ${part.slice(6)}`;
      if (part === 'Meta') return navigator.platform?.includes('Mac') ? 'Cmd' : 'Win';
      return part;
    })
    .join(' + ');
}

/** A binding must carry at least one modifier, or it fires while typing. */
export function isUsableBinding(binding) {
  if (!binding) return false;
  const parts = binding.split('+');
  return parts.length >= 2 && parts.some((p) => ['Ctrl', 'Alt', 'Shift', 'Meta'].includes(p));
}

/** Which other actions already use this binding. */
export function conflictsWith(keymap, action, binding) {
  return Object.entries(keymap)
    .filter(([name, value]) => name !== action && value === binding)
    .map(([name]) => name);
}
