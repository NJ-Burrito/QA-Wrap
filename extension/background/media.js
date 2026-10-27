/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Screen recording and stills, from the worker's side.
 *
 * The worker owns the *decision* — which tab, which format, which session — and
 * the offscreen document owns the *machinery*, because a service worker has no
 * DOM and therefore no MediaRecorder and no canvas. This file is the seam.
 *
 * On limits: no cap on how long a recording runs. The disk is the real limit, so
 * that is reported, before and during the recording.
 */

import { withDeadline } from '../platform/deadline.js';
import { policy, MIC_BLOCKED } from '../platform/settings.js';
import { assertPolicy, getSettings } from '../platform/settings.js';
import { armedWindows } from './armed.js';
import { trackerUrl } from '../core/tracker-specs.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';

/**
 * The microphone, once, in front of both capture paths.
 *
 * Decision 9 of `research/56-decisions-2026-09-07.md`: an administrator can
 * take the microphone away for a whole installation through
 * `chrome.storage.managed`. Hiding the tick is not enough — a saved setting, a
 * keyboard shortcut, the right-click menu and the context-menu recorder all
 * reach a start without going past the popup — so the refusal lives here,
 * where every recording that could open a microphone passes.
 *
 * It drops the microphone rather than failing the recording. A tester in a
 * managed office pressing Record wants a clip; what they must not get is a
 * clip with a voice in it and no warning, or a refusal that stops them
 * recording anything at all. So the mic comes off, the reason joins `refused`,
 * and the popup prints it in the sentence it already prints for a device the
 * browser turned down.
 */
async function micAllowed() {
  return (await policy()).microphoneAllowed !== false;
}

/** Which window a running clip belongs to, kept where a worker teardown cannot lose it. */
const CLIP_WINDOW = 'recordingWindowId';

async function offscreenExists() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return existing.length > 0;
}

/**
 * Create the offscreen document if it is not already there — once, however many
 * callers ask at the same moment.
 *
 * Chrome allows exactly one per extension, and `createDocument` throws if one
 * exists — including one Chrome kept alive from a previous worker lifetime, so
 * "I have not created it yet" is not the same as "it does not exist". Ask.
 *
 * Asking was not enough: two messages arriving together (the popup polling
 * `UQA_RECORD_STATE` while the tester presses Record) both saw no document, both
 * called `createDocument`, and the second failed with "Only a single offscreen
 * document may be created", surfacing as the *recording* failing.
 *
 * Two defences, and both are needed. The single-flight memo serialises the
 * callers this worker knows about. The benign-rejection fallback covers the one
 * it cannot: a document created by a worker lifetime that has since ended, or
 * by a race Chrome resolves on its own side — if a re-check finds a document
 * alive, "there is already one" is the answer we wanted, not a failure.
 */
let creating = null;

async function ensureOffscreen() {
  if (creating) return creating;
  const mine = (creating = withDeadline(ensureOffscreenOnce(), 'offscreen', undefined, () => { if (creating === mine) creating = null; }));
  mine.then(() => { if (creating === mine) creating = null; }, () => { if (creating === mine) creating = null; });
  return mine;
}

async function ensureOffscreenOnce() {
  return (async () => {
    if (await offscreenExists()) return;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        // DISPLAY_MEDIA is what lets this document call `getDisplayMedia`, which
        // is how a screen recording is captured — see `displayStream` in
        // offscreen/offscreen.js for why it cannot be captured any other way.
        reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS', 'CLIPBOARD'],
        justification:
          'Records the tab under test or a screen the tester chooses, re-encodes '
          + 'screenshots, loads the issue-tracker adapters on demand, copies a '
          + 'locator when the page under test is not allowed to, and plays the result '
          + 'sound the tester turned on while the window is in the background: none of '
          + 'the five is something a service worker can do.',
      });
    } catch (err) {
      if (/single offscreen document/i.test(String(err?.message || err)) && (await offscreenExists())) return;
      throw err;
    }
  })();
}

/**
 * Close the offscreen document when nothing needs it any more.
 *
 * Nothing ever called this, so a document created for one screenshot lived for
 * the whole browser session — and with it anything that escaped a teardown: a
 * camera track, a microphone track, an AudioContext. "Asleep" is supposed to
 * mean asleep at process level too, and a hidden document that survives the
 * master switch is the one thing that makes that untrue.
 *
 * Refused while a clip is running, obviously: closing the document mid-capture
 * would destroy the recording it holds.
 */
export async function closeOffscreen() {
  if (!(await offscreenExists())) return { closed: false, reason: 'none' };
  const state = await offscreen('UQA_OFF_STATE').catch(() => null);
  if (state?.recording || state?.starting || state?.rolling) return { closed: false, reason: 'recording' };
  if (state?.rescuable) return { closed: false, reason: 'unsaved-clip' };
  await chrome.offscreen.closeDocument().catch(() => {});
  await chrome.storage.session.remove(CLIP_WINDOW);
  return { closed: true };
}

/**
 * The clipboard, from a worker that has none.
 *
 * A service worker has no DOM, so no `document.execCommand`, and its
 * `navigator.clipboard` is never focused and refuses. The offscreen document is
 * an ordinary page of this extension, which is why `CLIPBOARD` is among the
 * reasons it is created with above.
 *
 * The second door, never the first: `UQA_COPY_TEXT` in the worker tries the
 * tab's own top frame before this, because a copy the tester can see land in
 * their page is better than one that happens somewhere they cannot look. This
 * is what is left when the top frame is a PDF, a `chrome://` page, or has no
 * content script at all.
 */
export async function copyToClipboard(text) {
  return offscreen('UQA_OFF_COPY', { text });
}

const QUICK_OFF = new Set(['UQA_OFF_STATE', 'UQA_OFF_COPY', 'UQA_OFF_PERMISSIONS', 'UQA_OFF_CUE', 'UQA_OFF_FORMATS']);
/** A stuck recorder is "slow, try again", never "reload the extension": its own code. */
const mediaSlow = (e) => { throw e?.code === 'SLOW' ? Object.assign(e, { code: 'MEDIA_SLOW', message: 'The recorder is taking longer than usual. Try again in a moment.' }) : e; };

/** Talk to the offscreen document, and turn its refusals into readable errors. */
async function offscreen(type, payload = {}) {
  await ensureOffscreen().catch(mediaSlow);
  const send = chrome.runtime.sendMessage({ ...payload, type });
  // Only the quick calls get a deadline: start/stop/export wait on a person or on real encoding work.
  const res = await (QUICK_OFF.has(type) ? withDeadline(send, 'offscreen') : send).catch(mediaSlow);
  if (!res) throw Object.assign(new Error('The media worker did not answer. Reload the extension and try again.'), { code: 'STALE' });
  if (!res.ok) throw Object.assign(new Error(res.error), res.code ? { code: res.code } : {});
  return res.result;
}

/* ── what the recorder is allowed to do ────────────────────────────────── */

/**
 * The three permissions a recording can need, and whether they are held.
 *
 * Asked so that Settings can show a live status and the popup can grey out an
 * option that would refuse, rather than letting a tester tick "Mic", record for
 * ten minutes, and find out on playback. Each of the three is a different kind
 * of permission and only one of them is this extension's to grant:
 *
 *   **microphone / camera** — a browser permission on this extension's origin.
 *   Only a rendered page of ours can ask for it, which is why the button lives
 *   in Settings (`options.html` is `open_in_tab`) and not in the popup, which
 *   closes the moment the permission bubble takes focus.
 *
 *   **desktopCapture** — an optional extension permission. `permissions.request`
 *   can be called from Settings on a click, and once held the source picker
 *   opens without a second approval. Chrome still shows that picker every time;
 *   nothing may choose a screen on the user's behalf, and this does not try.
 *
 * `navigator.permissions` and `getUserMedia` do not exist in a service worker,
 * so device state is read where it can be read — the offscreen document — and
 * only if one already exists. Creating one to answer a status poll would leave
 * a hidden document alive for the life of the browser, which is the thing
 * `closeOffscreen()` was written to stop.
 */
/** Filing goes through the offscreen document, and this is the door (it lives here because `offscreen()` and `ensureOffscreen()` do). */
export async function trackerOp(op, { tracker, cfg, payload } = {}) {
  await assertPolicy('integrations', trackerUrl(tracker, cfg)); // T-068 last line (with the host list)
  return offscreen('UQA_OFF_TRACKER', { op, tracker, cfg, payload });
}

/** The specification builder, behind the same door: its module has no business in the worker's boot graph. */
export async function specOp(payload) {
  return offscreen('UQA_OFF_SPEC', payload);
}

/** And the fine print, which loads a catalogue of its own beside its module. */
export async function finePrintOp(input) {
  return offscreen('UQA_OFF_FINE_PRINT', { input });
}

/** The ISO 29119 renderers, behind the same door. JSON in, JSON out. */
export async function renderOp(fn, args) {
  return offscreen('UQA_OFF_RENDER', { fn, args });
}

/** And Postman, for the same reason and through the same door. */
export async function postmanOp(fn, args) {
  return offscreen('UQA_OFF_POSTMAN', { fn, args });
}

/**
 * Finish cue for a job that ended with no page to play it; returns why it stayed silent. `forwarded`: a hidden tab.
 * @param {any} name @param {any} [o]
 */
const CUE = /^(record\.stop|links\.(clean|broken)|harvest\.done|save\.done|export\.done|jira\.filed)$/;

export async function cueOp(name, { startedAt, forwarded, minMs = 5000, deps: d = /** @type {any} */ ({}) } = /** @type {any} */ ({})) {
  try {
    if (!CUE.test(name)) return 'name';
    const s = await (d.settings || getSettings)();
    if (!s.soundEnabled || !(s.soundVolume > 0)) return 'off';
    if (!(await (d.awake || (async () => (await armedWindows()).length))())) return 'asleep';
    const ctx = d.contexts || ((o) => chrome.runtime.getContexts(o));
    if (!forwarded) {
      if ((await ctx({ contextTypes: ['POPUP', 'SIDE_PANEL'] })).length) return 'page-open';
      if (Date.now() - startedAt < minMs) return 'short';
    }
    const st = await (d.state || (() => offscreen('UQA_OFF_STATE')))().catch(() => null);
    if (!st || st.recording) return 'recording';
    await (d.ensure || ensureOffscreen)();
    await (d.send || ((m) => offscreen('UQA_OFF_CUE', m)))({ name, on: true, level: s.soundVolume / 100, scope: s.soundScope });
    return 'played';
  } catch {
    return 'error';
  }
}

/** Black-box design, the suite builder and the cross-browser project: pure modules, same door. */
const pureCall = (type) => (fn) => (...args) => offscreen(type, { fn, args });
const bb = pureCall('UQA_OFF_BLACKBOX');
const st = pureCall('UQA_OFF_SUITE');
const cb = pureCall('UQA_OFF_CROSSBROWSER');
export const problemCounts = pureCall('UQA_OFF_PROBLEMS')('problemCounts');
// Written out, not proxied, so a typo fails at the call site. Wrappers live here
// and not in three door files: each extra module in the worker graph is a parse.
export const partitions = bb('partitions');
export const boundaries = bb('boundaries');
/** `outcomes` is the bit-pattern map, not a function: a function cannot cross the channel. */
export const decisionTable = bb('decisionTable');
export const stateTransitions = bb('stateTransitions');
export const buildTestSuite = st('buildTestSuite');
export const suiteToMarkdown = st('suiteToMarkdown');
export const filingPlan = st('filingPlan');
export const addRelation = st('addRelation');
export const suiteRelations = st('relations');
export const viewports = cb('viewports');
export const viewportById = cb('viewportById');
export const crossBrowserProject = cb('crossBrowserProject');
export const runCommand = cb('runCommand');
// T-012 text secret scan; the engine stays offscreen
export const scanOutbound = pureCall('UQA_OFF_SCAN')('scanOutbound');

/** The cookie file formats (core/cookie-formats.js), behind the same door. JSON in, JSON out; `fn` may name FORMATS. */
export const cookieFormatsOp = (fn, args = []) => offscreen('UQA_OFF_COOKIEFMT', { fn, args });

/** Jira, behind the same door. `fn` and `args` are JSON; attachments do not come this way (see background/jira-door.js). */
export async function jiraOp(fn, args) {
  await assertPolicy('integrations', (await getSettings()).jira?.baseUrl); // T-068 last line (with the host list)
  return offscreen('UQA_OFF_JIRA', { fn, args });
}

/** Exports and documents, built behind the same door. */
export async function exportOp(op, request) {
  // The build number travels with the request: getManifest() is not available in the offscreen document.
  return offscreen('UQA_OFF_EXPORT', {
    op,
    request: { ...request, version: chrome.runtime.getManifest().version },
  });
}

export async function mediaPermissions() {
  const desktopCapture = await chrome.permissions
    .contains({ permissions: ['desktopCapture'] })
    .catch(() => false);

  let microphone = 'unknown';
  let camera = 'unknown';
  if (await offscreenExists()) {
    const devices = await offscreen('UQA_OFF_PERMISSIONS').catch(() => null);
    if (devices) ({ microphone = 'unknown', camera = 'unknown' } = devices);
  }
  // The administrator's answer outranks the browser's: `micBlocked` hides the grant button; `microphone: 'blocked'` is a fourth state.
  const micBlocked = !(await micAllowed());
  return {
    microphone: micBlocked ? 'blocked' : microphone,
    camera,
    desktopCapture,
    micBlocked,
    micBlockedReason: micBlocked ? MIC_BLOCKED : null,
  };
}

/* ── how much room is left ─────────────────────────────────────────────── */

/**
 * What the browser will let this extension store.
 *
 * `unlimitedStorage` is in the manifest, so the quota is the disk rather than a
 * per-origin slice — but "the disk" still runs out, and a recording that dies
 * silently at 100% is the worst possible failure for something you cannot
 * repeat. Roughly 6MB per minute at the default bitrate, which is the number
 * used to turn bytes into the only unit that matters: minutes.
 */
const BYTES_PER_MINUTE = 6 * 1024 * 1024;

/**
 * Where the answer to "have we asked for persistent storage" is kept.
 *
 * `chrome.storage.local`, not `session`: the question is asked once per profile
 * and the answer outlives every browser restart. Asking again on each start
 * would be a permission prompt in some browsers and a wasted round trip in the
 * rest.
 */
const PERSIST_KEY = 'storagePersistence';

/**
 * Ask the browser not to throw this extension's data away, once.
 *
 * ── why it has to be asked for ──────────────────────────────────────────
 *
 * `unlimitedStorage` is in the manifest, so there is no per-origin quota to run
 * into. It does **not** make the data durable: without a persistence grant the
 * bucket is "best effort", and Chrome may evict the whole origin when the disk
 * comes under pressure. PRIVACY.md promises a tester that a session is theirs
 * for thirty days and that deleting it is their decision; an eviction is the
 * browser deleting it instead, silently, and the first sign of it is a report
 * that opens on an empty timeline.
 *
 * ── once, at the first session start, and never again ───────────────────
 *
 * Not at install: the answer depends on how the extension is used, and Chrome
 * grants persistence on engagement rather than on asking nicely, so asking
 * before anything has happened is asking at the worst possible moment. Not on
 * every start either: a browser that refused once will refuse again, and a
 * question the tester cannot see is still work the worker has to wake up to do.
 *
 * The answer is stored either way, refusal included, because "we asked and were
 * told no" and "nobody has asked" are different states and Settings says which.
 *
 * @returns {Promise<{persisted: boolean, asked: boolean, askedAt: number|null,
 *   supported: boolean}>}
 */
export async function requestPersistence({ force = false } = {}) {
  const stored = (await chrome.storage.local.get(PERSIST_KEY))[PERSIST_KEY] || null;
  if (stored && !force) return stored;

  const api = globalThis.navigator?.storage;
  if (!api?.persist || !api?.persisted) {
    const answer = { persisted: false, asked: false, askedAt: null, supported: false };
    await chrome.storage.local.set({ [PERSIST_KEY]: answer });
    return answer;
  }

  let persisted = false;
  try {
    // Already granted is the common case on a profile that has been used, and
    // `persist()` on an already-persistent bucket is a needless call.
    persisted = await api.persisted();
    if (!persisted) persisted = await api.persist();
  } catch {
    /* an unsupported or blocked bucket answers as "not persisted", not as an error */
  }
  const answer = { persisted: !!persisted, asked: true, askedAt: Date.now(), supported: true };
  await chrome.storage.local.set({ [PERSIST_KEY]: answer });
  return answer;
}

/** What was decided last time, without asking the browser anything. */
export async function storagePersistence() {
  return (
    (await chrome.storage.local.get(PERSIST_KEY))[PERSIST_KEY] ||
    { persisted: false, asked: false, askedAt: null, supported: true }
  );
}

export async function storageHeadroom() {
  let quota = 0;
  let usage = 0;
  try {
    ({ quota = 0, usage = 0 } = await navigator.storage.estimate());
  } catch {
    /* not available — reported as unknown rather than guessed at */
  }
  const free = Math.max(0, quota - usage);
  return {
    quota,
    usage,
    free,
    knows: quota > 0,
    minutesOfVideo: quota > 0 ? Math.floor(free / BYTES_PER_MINUTE) : null,
    // Below this, a long recording is a bad idea and the UI says so rather than
    // letting the tester find out at the end.
    low: quota > 0 && free < 500 * 1024 * 1024,
  };
}

/* ── recording ─────────────────────────────────────────────────────────── */

/**
 * `getMediaStreamId` must be called from the worker, and it needs the tab to be
 * the one the user just acted on — the id it returns is a one-shot token tied to
 * that tab. It is consumed by the offscreen document, which is what actually
 * opens the stream.
 */
export async function startRecording({
  tabId, sessionId, format = 'webm', fps = 15, quality = 'medium', label,
  mic = false, tabAudio = false, webcam = false, webcamPosition = 'bottom-right', webcamSize = 22,
  cursor = false,
}) {
  const headroom = await storageHeadroom();
  if (headroom.knows && headroom.free < 50 * 1024 * 1024) {
    throw new Error(
      `Only ${Math.round(headroom.free / 1024 / 1024)}MB of storage left. Not enough to record. ` +
        'Delete some old sessions first.'
    );
  }

  const blockedMic = mic && !(await micAllowed());
  if (blockedMic) mic = false;

  // The rolling buffer lets go of the tab first (3.8.3, offscreen.js rollBusy).
  await rollOp({ op: 'stop' }).catch(() => {});
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    // Chrome lets an extension capture only a tab it was just invoked on (icon,
    // menu, shortcut). Not routed around: say what to do, not Chrome's wording.
    if (/activeTab|has not been invoked/i.test(err.message)) {
      const commands = await chrome.commands?.getAll?.().catch(() => []);
      const shortcut =
        (commands || []).find((c) => c.name === 'record-tab')?.shortcut ||
        chrome.runtime.getManifest().commands?.['record-tab']?.suggested_key?.default ||
        '';
      throw Object.assign(new Error(
        'Chrome drops permission to record a tab as soon as it navigates. ' +
          (shortcut
            ? `Press ${shortcut} on the page, or right-click it and choose QA Wrap › Record a video of this tab.`
            : 'Right-click the page and choose QA Wrap › Record a video of this tab.')
      ), { code: 'NEEDS_INVOKE' });
    }
    if (/Chrome pages cannot be captured/i.test(err.message)) {
      throw new Error('Chrome will not record its own pages. Open the site you are testing first.');
    }
    throw err;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  // Frame lock target: the tab's pixels at its monitor's DPR (3.8.3), 400 ms at most.
  const [px] = await Promise.race([chrome.scripting.executeScript({ target: { tabId }, func: () => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio] }), new Promise((r) => setTimeout(r, 400, []))]).catch(() => []);
  const started = await offscreen('UQA_OFF_START', {
    streamId, sessionId, format, fps, quality, label, view: tab && { w: tab.width, h: tab.height, px: px?.result },
    mic, tabAudio, webcam, webcamPosition, webcamSize,
    // Tab capture has no pointer: the offscreen document draws one (content/recorder.js reportCursor).
    cursor,
  });
  // Which window this clip is filming, so putting *that* window to sleep can
  // stop it without touching a clip running in another one.
  await noteRecordingWindow(tab?.windowId);
  return {
    ...started,
    headroom,
    windowId: tab?.windowId ?? null,
    refused: [...(started.refused || []), ...(blockedMic ? [MIC_BLOCKED] : [])],
  };
}

export const cancelStart = (clear = false) => offscreen('UQA_OFF_CANCEL', { clear }).catch(() => {});

export async function stopRecording({ label } = {}) {
  const meta = await offscreen('UQA_OFF_STOP', { label });
  await chrome.storage.session.remove(CLIP_WINDOW);
  return meta;
}

/** Write out a clip the database refused, through the downloads API. */
export async function rescueRecording({ filename } = {}) {
  const out = await offscreen('UQA_OFF_RESCUE', { filename });
  if (out.rescued || !out.url) return out;
  // The offscreen document has no downloads API in every build. The object URL
  // is same-origin, so the worker can download from it; the bytes never cross
  // the message port either way.
  // `saveAs` stays true here and only here: a rescue is the database having
  // refused a clip, and the tester should be looking at the dialog that saves
  // it rather than trusting it to a folder they have not been shown.
  // `conflictAction` is stated for rule 4 of the contract in core/filing.js.
  const downloadId = await chrome.downloads.download({
    url: out.url, filename: out.filename, saveAs: true, conflictAction: 'uniquify',
  });
  return { ...out, rescued: true, downloadId };
}

/** Which window a clip films, so sleeping that window stops it and no other (session storage: the worker is torn down between events). */
export async function noteRecordingWindow(windowId) {
  if (windowId == null) return;
  await chrome.storage.session.set({ [CLIP_WINDOW]: windowId });
}

export async function recordingState() {
  // No offscreen document means nothing is recording — and creating one just to
  // ask would leave a document alive for every state poll.
  if (!(await offscreenExists())) return { recording: false };
  const state = await offscreen('UQA_OFF_STATE');
  if (!state?.recording) return state;
  const store = await chrome.storage.session.get(CLIP_WINDOW);
  // `undefined` and not `null`: "we do not know which window" is a third
  // answer, and sleep treats it as "possibly this one" rather than assuming.
  return { ...state, windowId: store[CLIP_WINDOW] ?? undefined };
}

/**
 * The sound of a stored clip, written out as a WAV.
 *
 * The bytes never cross the message port: the offscreen document makes an
 * object URL, and the worker hands that straight to `chrome.downloads`, which
 * can read a same-origin blob URL. The same rule as `rescueRecording` above,
 * and for the same reason as D2.
 */
export async function exportAudio({ id, filename, saveAs = false }) {
  const out = await offscreen('UQA_OFF_AUDIO', { id });
  /*
   * `saveAs` was hard-coded true, and it should never have been.
   *
   * `filename` arrives as a full category path built by `evidencePath()` —
   * `QA Wrap/Recordings/01 Screen recording-…wav` — precisely so the wav lands
   * beside the clip it came from. A Save dialog throws that away and asks the
   * tester to place it by hand, once per clip, in the middle of a "Save
   * everything" that is placing thirty other files without asking. It follows
   * the standing preference like every other export now.
   */
  const downloadId = await chrome.downloads.download({
    url: out.url,
    filename: filename || out.filename,
    saveAs: !!saveAs,
    conflictAction: 'uniquify',
  });
  return { ...out, url: undefined, downloadId, path: filename || out.filename };
}

export const rollOp = async (p) => (/^(state|stop)$/.test(p.op) && !(await offscreenExists()) ? { rolling: false } : offscreen('UQA_OFF_ROLL', p)); // cap1022

/** Which video formats this browser can actually produce, asked at runtime. */
export async function videoFormats() {
  return offscreen('UQA_OFF_FORMATS');
}

/**
 * Record the screen, a window, or another tab — not just this one.
 *
 * `tabCapture` can only ever see the tab it was invoked on, which is the right
 * default and the wrong answer for half of what testers actually need to show:
 * a native file-picker dialog, a second window the flow opened, the whole
 * desktop while switching between the app and a spreadsheet.
 *
 * `getDisplayMedia`, asked for inside the offscreen document, is the route that
 * works. It always shows Chrome's own picker — the extension never chooses a
 * source on the user's behalf, and cannot. This function decides *whether* a
 * screen recording may start; the picker and the stream belong to the document
 * that will do the recording, and `displayStream()` in offscreen/offscreen.js
 * says why they cannot be anywhere else.
 */
export async function startScreenRecording({
  sessionId, format = 'webm', fps = 15, quality = 'medium', label,
  mic = false, systemAudio = false, webcam = false,
  webcamPosition = 'bottom-right', webcamSize = 22, cursor = false, sender,
}) {
  const headroom = await storageHeadroom();
  if (headroom.knows && headroom.free < 50 * 1024 * 1024) {
    throw new Error(
      `Only ${Math.round(headroom.free / 1024 / 1024)}MB of storage left. Not enough to record.`
    );
  }

  /*
   * `desktopCapture` is optional, so it can be absent — and absent is not a
   * bug, it is a permission nobody has granted yet.
   *
   * Checked here rather than requested here: `permissions.request` needs a user
   * gesture, and by the time this runs the gesture that opened the popup has
   * been spent. Settings is where the button is, and this names it.
   *
   * Kept after the move to `getDisplayMedia`, deliberately, even though that
   * API needs no extension permission of its own. It is the tester's one
   * explicit "yes, this tool may film my screen", it is what Settings, the
   * popup's greying-out and the store listing all describe, and taking it away
   * would be a change to what the product promises rather than a bug fix. What
   * did change is that it is now the *only* thing between the press and the
   * picker.
   */
  const blockedMic = mic && !(await micAllowed());
  if (blockedMic) mic = false;

  const allowed = await chrome.permissions.contains({ permissions: ['desktopCapture'] }).catch(() => false);
  if (!allowed) {
    /*
     * Not a dead end, and this is the "yellow error" of brief item G2.
     *
     * The refusal was correct and useless: a sentence telling the tester to
     * open Settings, find a section and press a button, in a popup that closes
     * the moment they look away from it. Every press of Record with the screen
     * scope chosen produced it, the tool card went amber for four seconds, and
     * the tester's only move was to press the button that was warning them.
     *
     * `permissions.request` cannot be called from here — it needs a live user
     * gesture and a service worker has none, which is exactly why the button
     * lives in Settings. What the worker CAN do is put them in front of that
     * button. The tag on the error is what tells the handler to.
     */
    throw Object.assign(
      new Error(
        'Chrome needs your permission to record a screen. QA Wrap Settings is opening at ' +
          'the Permissions section: press "Allow screen recording" there, then press Record again.'
      ),
      { needsPermission: 'desktopCapture' }
    );
  }

  /*
   * The picker is asked for in the offscreen document, not here: a desktopCapture stream id is bound to the render frame
   * that asked for it, and the worker has none ("AbortError: Error starting tab capture"). The frame that picks is the
   * frame that records (measurements over `pickDesktopSource` in offscreen/offscreen.js). Shortened 16 Oct 2026 for the boot-graph line.
   */
  const started = await offscreen('UQA_OFF_START', {
    desktop: true,
    systemAudio,
    sessionId, format, fps, quality, label,
    mic, webcam, webcamPosition, webcamSize,
    // Honoured on this path since 8 September 2026, by a different mechanism
    // than a tab capture uses. Nothing is *drawn* here — a screen or window
    // capture already contains the operating system's own pointer, and painting
    // a second one would give the clip two mice — but the tick decides whether
    // that real pointer is in the frames at all: `displayStream()` turns it
    // into `cursor: 'always' | 'never'` on the `getDisplayMedia` video
    // constraints, which is the only thing that can keep it out.
    cursor,
  });
  /*
   * Which window owns a screen recording.
   *
   * None of them, strictly: a screen capture is not a window's to own. But
   * "put this window to sleep" has to be able to stop the clip the tester
   * started, so it is filed against the window they started it from — the
   * surface that sent the message, or the focused window when the surface has
   * no tab of its own, which is the side panel and the DevTools panel.
   */
  const ownerWindowId =
    sender?.tab?.windowId ??
    (await chrome.windows.getLastFocused().then((w) => w?.id ?? null).catch(() => null));
  await noteRecordingWindow(ownerWindowId);
  return {
    ...started,
    headroom,
    scope: 'screen',
    windowId: ownerWindowId ?? null,
    refused: [
      ...(started.refused || []),
      /*
       * Say when the source refused the sound the tester ticked.
       *
       * Read from the stream that came back, never from the request: a tester
       * who ticked the sound and then chose a *window* — windows cannot carry
       * sound — used to get a silent clip and find out on playback. The
       * offscreen document reports what the stream actually contains.
       */
      ...(systemAudio && !started.sources?.tabAudio
        ? ['system audio (the source you chose cannot share sound)']
        : []),
      ...(blockedMic ? [MIC_BLOCKED] : []),
    ],
  };
}

/* ── stills ────────────────────────────────────────────────────────────── */

/**
 * Chrome hands back PNG or JPEG and nothing else, so anything the tester chose
 * beyond that is re-encoded in the offscreen document.
 */
export async function captureImage({ tabId, windowId, sessionId, format = 'png', quality = 92, label, url, session, version }) {
  // Chrome's own capture only ever produces PNG or JPEG. JPEG is asked for
  // when the target is lossy, because starting from a JPEG and re-encoding to
  // another lossy format compounds the artefacts; everything else starts from a
  // lossless PNG.
  const native = format === 'jpeg' || format === 'jpg' ? 'jpeg' : 'png';
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: native,
    ...(native === 'jpeg' ? { quality } : {}),
  }).catch(async (err) => {
    // ui-1016 L: our own page (Bug Hunt) is open without activeTab from the side panel; read it through the debugger for this one call. Anything else keeps Chrome's refusal.
    if (!/activeTab/.test(err?.message) || !String(url).startsWith(chrome.runtime.getURL(''))) throw err;
    const d = { tabId };
    try { await chrome.debugger.attach(d, '1.3'); } catch { throw err; }
    try {
      const r = /** @type {any} */ (await chrome.debugger.sendCommand(d, 'Page.captureScreenshot', { format: native, quality: native === 'jpeg' ? quality : undefined }));
      return `data:image/${native};base64,${r.data}`;
    } finally { await chrome.debugger.detach(d).catch(() => {}); }
  });

  // PNG asked for, PNG received — no re-encode needed, and skipping it avoids a
  // pointless decode/encode round trip on the common path.
  if (format === 'png') {
    return offscreen('UQA_OFF_IMAGE', { dataUrl, format: 'png', sessionId, label, url, session, version });
  }
  return offscreen('UQA_OFF_IMAGE', { dataUrl, format, quality, sessionId, label, url, session, version });
}

/**
 * Embed provenance into a stored PNG.
 *
 * In place, not as a copy — because nothing is painted any more. The pixels are
 * byte-identical; only the file's metadata gains a `tEXt` chunk. There is no
 * unmarked original to preserve, which is exactly the improvement over the
 * version that drew on the picture.
 */
export async function markImage(payload) {
  return offscreen('UQA_OFF_MARK', payload);
}

/** Hand a full page's tiles to the only context that owns a canvas. */
export async function stitchFullPage(payload) {
  return offscreen('UQA_OFF_STITCH', payload);
}
