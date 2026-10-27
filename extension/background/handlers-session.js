/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Message handlers for sessions, recording and the library: starting and stopping, state, media, screen recording, timeline and the session list. Moved out of service-worker.js (OF-18), unchanged. */

import {
  recordingState, storageHeadroom, startRecording, stopRecording, cancelStart, rescueRecording, startScreenRecording, videoFormats,
  mediaPermissions, exportAudio, markImage, exportOp, copyToClipboard, rollOp,
} from './media.js';
import {
  getSession, putSession, getMedia, deleteMedia, putMedia, listMedia, getCaptures, listSessions, deleteSession,
} from '../core/db.js';
import * as sessionState from './session-state.js';
import { findingTotals, eraseKeys, viewportRuns } from '../core/sessions.js';
import { withDeadline as bounded } from '../platform/deadline.js';
import * as armed from './armed.js';
import * as remember from './remember.js';
import * as draftDoor from './draft-door.js';
import { getSettings, hasSidePanel } from '../platform/settings.js';
import { startRecordingIcon, stopRecordingIcon } from './action-icon.js';
import * as chat from './notify.js';
import { TEXT_TYPES } from '../core/file-types.js';
import { readPng, provenance, MAKER, readToken } from '../core/provenance.js';
import { dataSessionKeys } from '../core/store-registry.js';
import * as site from './site-access.js';
import {
  DISK_WARN, DISMISSED, LAST, activeSessionId, announceL, currentWindowId, handlers, hintFor, liveSessionIds, own,
  sessionIn, sessionsByWindow, tw, windowOf,
} from './worker-base.js';
import { broadcast, frameChain, openOwnPage, sendToFeature, sendToTab, testableTabId, withoutOverlays } from './worker-tabs.js';
import {
  addNote, appendEvent, captureLost, countEvents, countFailures, flushEvents, forgetSession, getEvents, getEventsSince,
  getRules, ingest, mustSession, noteUse, paintBadge, rememberSession, startSession, stopSession, viewportEvents,
} from './worker-session.js';
import { captureFullPage, captureScreenshot } from './worker-scans.js';
import { floatWindow, grantedTabs, openFloat } from './worker-lifecycle.js';

/* ------------------------------------------------------------------- captures */

/** Refuse a second recording before anything irreversible happens. */
/** A start that has been asked for but has not answered yet. */
let recordStartInFlight = null;

function claimRecordStart(promise) {
  recordStartInFlight = promise.finally(() => {
    recordStartInFlight = null;
  });
  return recordStartInFlight;
}

async function refuseIfRecording() {
  if (recordStartInFlight) {
    // Wait for it rather than guess. If it fails, this press is allowed to be
    // the one that works; if it succeeds, the check below refuses on real state.
    await recordStartInFlight.catch(() => {});
  }
  const state = await recordingState().catch(() => null);
  if (!state?.recording && !state?.starting) return;
  if (state.finishing) {
    throw new Error(
      'The last clip is still being saved. It will appear in the report on its own. ' +
        'Give it a moment before starting another.'
    );
  }
  if (state.starting) {
    throw new Error('A recording is already starting. Give it a moment rather than pressing again.');
  }
  const scope = state.sources?.screen ? 'screen' : 'tab';
  throw new Error(
    `Already recording ${scope === 'screen' ? 'the screen' : 'a tab'}. ` +
      'Stop the current clip first. A recording cannot change what it is filming half way through.'
  );
}

/**
 * The most a stored item may weigh before `UQA_MEDIA_BLOB` refuses it.
 *
 * Sized for the largest thing that route legitimately carries: a full-page PNG
 * of a very tall page, which lands in single-digit megabytes. Every recording
 * is above it by an order of magnitude, which is the point — see the handler.
 */
const MEDIA_BLOB_MAX = 16 * 1024 * 1024;

// In-page bar (S8): top frame only; face and strings read at call time.
const BAR_FILES = ['ui/icons.js', 'ui/tone.js', 'ui/live.js', 'content/bar.js'];

const OVERLAY_KEYS = /^(overlay\.|buffer\.pill$|popup\.pick\.(head|any|step|element|sensitive)$|popup\.live\.(stop|noLocator|copyAgain)$|options\.sound\.ui\.copy$|options\.actions\.shot\.label$|popup\.note\.add$)/;

let overlayFaces = null;

let overlayCss = null; // sent by message like the face: overlay.css is not web-accessible

/** The session itself: what the popup paints, start and stop, notes and plain captures. */
export const sessionHandlers = {
  UQA_PING: async () => ({
    build: globalThis.__UQA_BUILD || null,
    manifest: chrome.runtime.getManifest().version,
  }),

  /**
   * `msg.windowId` or the sender, so a page in window B is told about window
   * B's session. With one session running the hint changes nothing; with two
   * it is the difference between a popup that paints its own window and one
   * that paints whichever session started last.
   */
  UQA_GET_STATE: async (msg, sender) => {
    const id = await activeSessionId(hintFor(msg, sender));
    // Asked for by the page's top frame only: any clip, so the in-page layer is not drawn into it.
    const video = msg?.video ? !!(await recordingState().catch(() => null))?.recording : undefined;
    if (!id) {
      const { [LAST]: lastId, [DISMISSED]: gone } = await chrome.storage.session.get([LAST, DISMISSED]);
      let last = lastId && lastId !== gone ? await getSession(lastId) : null;
      const win = await windowOf(hintFor(msg, sender));
      if (win != null && last?.windowId != null && last.windowId !== win) last = null;
      return {
        recording: false,
        video,
        session: null,
        lastSession: last,
        eventCount: 0,
        failureCount: 0,
        // Nothing has been used, because there is nothing to have used it in.
        used: {},
      };
    }
    // Both counts come from indexes. The popup ticker calls this every second,
    // and reading the whole session each time made a long run crawl.
    const [session, eventCount, failureCount, state] = await Promise.all([
      getSession(id),
      countEvents(id),
      countFailures(id),
      sessionState.getState(id),
    ]);
    /*
     * Two numbers, and they answer different questions.
     */
    return {
      recording: true,
      video,
      session,
      lastSession: null,
      eventCount,
      failureCount,
      captureLost: captureLost.get(id) || state.captureLost || 0,
      unconfirmed: state.unconfirmed || 0,
      findingCount: findingTotals(state.findings).total,
      problems: findingTotals(state.findings).problems,
      problemsTone: findingTotals(state.findings).errors ? 'error' : 'warning',
      used: state.used,
    };
  },

  /**
   * Everything the popup needs to paint itself, in one message.
   *
   * One concurrent fetch, every part failing soft: a gone tab costs a chip, not the paint. The branches that can be
   * absent (rtl, rules, headroom) wait 400 ms and fall back to a default (r8-07-2); the rest keep 3 s.
   */
  UQA_POPUP_STATE: async (msg, sender) => {
    const soft = (p, fallback, ms = 3000) => bounded(p, 'tab', ms).then((v) => v ?? fallback, () => fallback);
    const tabId = msg.tabId ?? (await testableTabId(sender));
    const windowId =
      tabId != null
        ? (await chrome.tabs.get(tabId).catch(() => null))?.windowId
        : await currentWindowId(sender);

    // Every part is asked about this window, not "the session" (two windows can record).
    const [state, rtl, rules, recording, room, isArmed, usedNow] = await Promise.all([
      handlers.UQA_GET_STATE({ windowId }),
      soft(sendToTab(tabId, { type: 'UQA_RTL_STATE' }), null, 400),
      soft(getRules(windowId), [], 400),
      soft(recordingState(), { recording: false }, 400),
      soft(storageHeadroom(), null, 400),
      soft(armed.isArmedWindow(windowId), null, 400), // null, not Asleep
      soft(activeSessionId(windowId).then((id) => (id ? sessionState.getUsed(id) : {})), {}, 400),
    ]);

    return {
      ...state,
      used: state.used ?? usedNow,
      rtl,
      rules,
      recording: state.recording,
      capture: recording,
      storage: room,
      armed: { windowId, armed: isArmed },
    };
  },

  /**
   * The tab a page-scoped tool should act on.
   *
   * The popup answered with `chrome.tabs.query({ active: true, currentWindow: true })`, right only for a real browser-action
   * popup (not a tab). Opened as a tab (debugging, the click-through harness) the active tab *is* the popup, and every
   * page-scoped tool refused with "needs a normal web page". The worker already solves this for DevTools and the report.
   */
  /** Move the workbench from the floating window into the side panel. */
  /**
   * The tidy-up after the popup has opened the side panel.
   *
   * The `open()` call itself cannot live here: Chrome requires a live user
   * gesture, a worker has none, and a gesture cannot be forwarded in a message.
   * The popup opens the panel and then sends this so the floating window it
   * replaces is closed.
   */
  UQA_DOCKED: async (msg, sender) => {
    const windowId = msg.windowId ?? (await currentWindowId(sender));
    const open = await floatWindow();
    if (open) {
      await chrome.windows.remove(open.id).catch(() => {});
      await chrome.storage.session.remove('floatWindowId');
    }
    return { docked: true, windowId };
  },

  UQA_DOCK: async (msg, sender) => {
    const windowId = msg.windowId ?? (await currentWindowId(sender));
    if (windowId == null) throw new Error('No window to dock to.');
    if (!hasSidePanel()) throw new Error('This browser has no side panel.');
    // Kept for the context menu and the keyboard command, which reach the
    // worker with a gesture Chrome does accept.
    await chrome.sidePanel.open({ windowId });
    const open = await floatWindow();
    if (open) {
      await chrome.windows.remove(open.id).catch(() => {});
      await chrome.storage.session.remove('floatWindowId');
    }
    return { docked: true, windowId };
  },

  UQA_TARGET_TAB: async (_msg, sender) => {
    const id = await testableTabId(sender);
    return id == null ? null : (await chrome.tabs.get(id).catch(() => null));
  },

  UQA_START: (msg) => startSession(msg),
  UQA_RENAME: (msg) => remember.renameSession(msg, { getSession, putSession, rememberSession }),
  UQA_KEEP: (msg) => remember.keepSession(msg, { getSession, putSession, rememberSession }), // rule 5: the pin the retention cleanup honours
  UQA_BRIDGE_SYNC: (msg) => draftDoor.bridgeSync(msg.wait),
  UQA_BUFFER_ON: (msg, sender) => draftDoor.bufferOn(sender?.url),
  // `here`: the in-page bar's Stop ends the session of the window it sits in.
  UQA_STOP: (msg, sender) => stopSession(msg?.here ? sender : undefined),
  UQA_OVERLAY_ASSETS: async () => {
    overlayFaces ??= own('ui/fonts.css').then((r) => r.text()).then(
      (css) => [400, 500].map((w) => css.match(new RegExp(`'Thmanyah Sans';[^}]*?weight: ${w};[^}]*?base64,([^')]+)`))?.[1] || null),
      () => (overlayFaces = null)
    );
    const { qawLanguage: pick } = await chrome.storage.sync.get('qawLanguage');
    const lang = pick === 'en' || pick === 'ar' ? pick : /^ar/i.test(chrome.i18n.getUILanguage()) ? 'ar' : 'en';
    const [en, mine] = await Promise.all(['en', lang].map((c) => own(`platform/i18n/${c}.json`).then((r) => r.json())));
    const strings = {};
    for (const k of Object.keys(en)) if (OVERLAY_KEYS.test(k)) strings[k] = mine[k] || en[k];
    const { qawTheme: theme } = await chrome.storage.local.get('qawTheme');
    overlayCss ??= Promise.all(['content/overlay.css', 'ui/live.css'].map((f) => own(f).then((r) => r.text()))).then((a) => a.join('\n')).catch(() => (overlayCss = null));
    return { faces: (await overlayFaces) || [], css: (await overlayCss) || '', strings, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', theme };
  },
  UQA_BAR: async (msg, sender) => {
    const tabId = msg.tabId ?? sender?.tab?.id;
    if (tabId == null) return false;
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: BAR_FILES });
    return true;
  },
  UQA_OPEN_FLOAT: async (msg, sender) => {
    const open = await floatWindow();
    if (open) await chrome.windows.update(open.id, { focused: true });
    else await openFloat(sender?.tab?.windowId);
    return true;
  },
  UQA_EVENT: (msg, sender) => ingest(msg.event, sender, msg.preRoll === true),
  /**
   * One request the tester sent by hand, into the session.
   */
  UQA_API_RECORD: async (msg, sender) => {
    const sessionId = await activeSessionId(hintFor(msg, sender));
    if (!sessionId) return { stored: false, reason: 'no-session' };
    const sent = msg.sent || {};
    const got = msg.received || {};
    await appendEvent({
      sessionId,
      kind: 'net',
      via: 'api',
      ts: sent.startedAt || Date.now(),
      method: sent.method || 'GET',
      url: sent.url || '',
      status: got.status ?? 0,
      ok: !!got.ok,
      error: got.error || null,
      durationMs: got.ms ?? 0,
      reqHeaders: sent.headers || [],
      reqBody: sent.body || null,
      resHeaders: got.headers || [],
      resBody: got.body || null,
      bytes: got.bytes ?? 0,
      text: `Sent ${sent.method || 'GET'} ${sent.url || ''} by hand`,
    });
    paintBadge();
    return { stored: true, sessionId };
  },
  /** The panel, opened on the session whose traffic it can import. */
  UQA_OPEN_API: async (msg, sender) => {
    const { [LAST]: last } = await chrome.storage.session.get(LAST);
    const sessionId = msg.sessionId || (await activeSessionId(hintFor(msg, sender))) || last || null;
    const { tabId } = await openOwnPage(`api/api.html${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''}`);
    return { tabId, sessionId };
  },
  UQA_NOTE: (msg, sender) => addNote(msg.text, msg.tag, sender).then((r) => (/^(issue|question|note)$/.test(msg.tag) && noteUse('notetype', undefined, sender), r)), // a typed note (not the default Bug): a count for the Bug Hunt page
  UQA_SET_BREAKDOWN: async (msg) => {
    const id = msg.sessionId || (await activeSessionId());
    const session = await mustSession(id);
    session.breakdown = msg.breakdown;
    await putSession(session);
    rememberSession(session);
    return session;
  },
  UQA_CAPTURE: (msg) => captureScreenshot(msg),
  UQA_CAPTURE_FULL: (msg) => captureFullPage(msg),
  UQA_SHOT_AUTO: (msg, sender) => remember.autoShot(msg, sender, autopilot),
  /*
   * One photograph of the screen, overlays hidden, for the frame to cut up.
   *
   * The worker's whole share of the selector preview; `content/picker.js` crops
   * it in the page, because the boot graph has no room — research/71. Active tab
   * only: `captureVisibleTab` photographs whatever is on screen, so a
   * background tab would be handed a picture of somebody else's page.
   */
  UQA_SHOT_URL: (msg, sender) =>
    sender?.tab?.active
      ? withoutOverlays(sender.tab.id, () =>
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 70 }))
      : null,
};

/** Recording, and the media gallery the clips land in. */
export const recordingHandlers = {
  UQA_ROLL: async (msg) => { const m = await rollOp(msg); if (msg.op === 'save') { await appendEvent({ sessionId: m.sessionId, kind: 'recording', ts: m.ts, mediaId: m.id, label: m.label, durationMs: m.durationMs, bytes: m.bytes, mediaType: m.type, sources: m.sources, webcamTrackId: null }); paintBadge(); await broadcast({ type: 'UQA_MEDIA_CHANGED' }); } return m; }, // cap1022: the popup supplies streamId and sessionId; the buffer lives in offscreen/rolling.js
  /* ---- recording and the media gallery ------------------------------- */
  UQA_RECORD_START: async (msg, sender) => {
    await refuseIfRecording();
    const settings = await getSettings();
    const tabId = msg.tabId ?? (await testableTabId());
    if (tabId == null) throw new Error('Open the page you want to record first.');
    const started = await claimRecordStart(startRecording({
      tabId,
      sessionId: await activeSessionId({ tabId }),
      format: msg.format || settings.videoFormat || 'mp4',
      fps: msg.fps ?? settings.videoFps ?? 15,
      quality: msg.quality || settings.videoQuality || 'medium',
      label: msg.label,
      mic: msg.mic ?? settings.recordMic,
      tabAudio: msg.tabAudio ?? settings.recordTabAudio,
      webcam: msg.webcam ?? settings.recordWebcam,
      webcamPosition: msg.webcamPosition || settings.webcamPosition,
      webcamSize: msg.webcamSize ?? settings.webcamSize,
      cursor: msg.cursor ?? settings.recordCursor,
    }));
    // A clip filmed inside a window-size run belongs to that run. Remembered
    // now, because at stop the window this was filming has already been
    // forgotten; see CLIP_RUN.
    const clipRun = await runForWindow(await activeSessionId({ tabId }), started.windowId);
    if (clipRun) await chrome.storage.session.set({ [CLIP_RUN]: clipRun });
    else await chrome.storage.session.remove(CLIP_RUN);

    await noteUse('record', { sources: started.sources }, { tabId });
    await chrome.storage.session.remove(DISK_WARN).catch(() => {});
    await broadcast({ type: 'UQA_RECORDING_CHANGED', recording: true });
    // `started.sources.mic` and not the tick that was sent: a microphone the
    // browser refused must not light the indicator that says one is live.
    startRecordingIcon({ mic: !!started.sources?.mic });
    // Not awaited: a notification that is slow, refused or switched off must
    // not sit between the tester pressing Record and the answer coming back.
    announceL('recording', 'titleRecording', 'QA Wrap is recording', 'recordingStarted', { scope: 'tab', refused: started.refused || [] }).catch(() => {});
    return started;
  },
  /**
   * Stop the clip, file it, and leave every surface telling the truth. A clip with no session is filed under 'unfiled'; the
   * broadcast and icon run in a `finally` and reconcile from `recordingState()`; a clip the store refused answers
   * `stored: false` and becomes an error naming the rescue route, after the teardown.
   */
  UQA_RECORD_STOP: async (msg, sender) => {
    try {
      // A tab start still on its way (3.8.3): cancel it in the offscreen document, wait, and answer coded if it never recorded.
      const pending = startGate;
      if (pending) {
        await cancelStart();
        const began = await pending;
        await cancelStart(true);
        if (!began) throw Object.assign(new Error('Stopped before the recording began. Nothing was recorded.'), { code: 'REC_CANCELLED' });
      }
      const meta = await stopRecording(msg);

      if (meta?.stored === false) {
        throw Object.assign(new Error(meta.error || 'The clip could not be stored.'), {
          code: 'REC_NOT_STORED',
          mediaId: meta.id,
          rescuable: meta.bytes > 0,
        });
      }

      // 'unfiled' is a bucket, not a null. See the note above.
      let sessionId = meta.sessionId || (await activeSessionId(hintFor(msg, sender))) || 'unfiled';
      if (sessionId !== meta.sessionId) {
        // Re-stamp the stored row so the gallery and the retention sweep agree
        // with the event. A row filed under one id and referenced under another
        // is the orphan this whole handler exists to stop making.
        // r4-13-1: the ids move only once the row has; a failed put keeps the old ones and leaves a gap note.
        if (await restampMedia(meta.id, { sessionId })) {
          if (!(await restampCompanion(meta.webcamTrackId, { sessionId }))) await restampGap(sessionId);
          meta.sessionId = sessionId;
        } else {
          await restampGap(sessionId);
          sessionId = meta.sessionId || 'unfiled';
        }
      }

      // The window-size run this clip belongs to: one clip, one home (a `runId` row shows under Window sizes only), on row and event.
      const { [CLIP_RUN]: clipRun } = await chrome.storage.session.get(CLIP_RUN);
      await chrome.storage.session.remove(CLIP_RUN);
      if (clipRun?.runId) {
        const run = { runId: clipRun.runId, viewport: clipRun.viewport };
        if (await restampMedia(meta.id, run)) {
          if (!(await restampCompanion(meta.webcamTrackId, run))) await restampGap(sessionId);
          meta.runId = run.runId;
          meta.viewport = run.viewport;
        } else {
          await restampGap(sessionId);
        }
      }

      // Only a real session gets a timeline entry: inventing one for 'unfiled' lists a session nobody started.
      if (sessionId !== 'unfiled') {
        await appendEvent({
          sessionId,
          kind: 'recording',
          ts: meta.ts,
          mediaId: meta.id,
          label: meta.label,
          durationMs: meta.durationMs,
          bytes: meta.bytes,
          mediaType: meta.type,
          // Which sources went in, so a silent clip is explained in the report
          // rather than discovered on playback.
          sources: meta.sources || { tab: true },
          // Where the face is, on the row itself, so the report's card need not open the media store.
          webcamTrackId: meta.webcamTrackId ?? null,
          ...(meta.runId ? { runId: meta.runId, viewport: meta.viewport } : {}),
        });
        paintBadge();
      }

      // A Delete between Stop and the end of the encode leaves the clip on a row nothing lists: re-filed under 'unfiled', said.
      if (sessionId !== 'unfiled' && !(await getSession(sessionId))) {
        if (await restampMedia(meta.id, { sessionId: 'unfiled' })) {
          await restampCompanion(meta.webcamTrackId, { sessionId: 'unfiled' });
          meta.sessionId = 'unfiled';
          meta.refiled = 'That session was deleted while the clip was being saved, so it is filed under Unfiled.';
        }
      }

      await broadcast({ type: 'UQA_MEDIA_CHANGED' });
      announceL('recording', 'titleSaved', 'Recording saved', 'recordingStopped', {
        bytes: meta.bytes,
        seconds: meta.durationMs ? meta.durationMs / 1000 : null,
      }).catch(() => {});
      return meta;
    } finally {
      // Reconciled from real state, never asserted: a failed stop must not tell every surface the recording ended.
      const st = await recordingState().catch(() => ({ recording: false }));
      await broadcast({ type: 'UQA_RECORDING_CHANGED', recording: !!st.recording });
      if (!st.recording) await stopRecordingIcon();
      if (!st.recording) await chrome.storage.session.remove(DISK_WARN).catch(() => {});
      if (!st.recording) paintBadge().catch(() => {}); // takes the disk-warning "!" off
    }
  },

  /** Write out a clip the database refused, before the browser closes on it. */
  UQA_RECORD_RESCUE: (msg) => rescueRecording(msg || {}),
  /**
   * Record the screen or another window rather than this tab.
   *
   * A cancelled picker is not an error the tester needs an apology for — they
   * pressed Cancel. It comes back as `{ cancelled: true }` so the popup can say
   * nothing at all.
   */
  UQA_RECORD_SCREEN: async (msg, sender) => {
    // Before the picker, not after it. Chrome's source chooser is a modal the
    // tester has to read and answer; opening one only to refuse the answer is
    // the worst order to do these two things in.
    await refuseIfRecording();
    const settings = await getSettings();
    try {
      const started = await claimRecordStart(startScreenRecording({
        // The sender, so the picker can be handed one of the extension's OWN
        // page tabs. Never the tab under test: that would scope the stream to
        // the tested page's origin, and the offscreen document that opens it is
        // a different origin entirely. See startScreenRecording.
        sender,
        sessionId: await activeSessionId(hintFor(msg, sender)),
        format: msg.format || settings.videoFormat || 'mp4',
        fps: msg.fps ?? settings.videoFps ?? 15,
        quality: msg.quality || settings.videoQuality || 'medium',
        label: msg.label,
        mic: msg.mic ?? settings.recordMic,
        systemAudio: msg.systemAudio ?? settings.recordTabAudio,
        webcam: msg.webcam ?? settings.recordWebcam,
        webcamPosition: msg.webcamPosition || settings.webcamPosition,
        webcamSize: msg.webcamSize ?? settings.webcamSize,
        cursor: msg.cursor ?? settings.recordCursor,
      }));
      await noteUse('record', { sources: started.sources, scope: 'screen' });
      await broadcast({ type: 'UQA_RECORDING_CHANGED', recording: true });
      startRecordingIcon({ mic: !!started.sources?.mic });
      // A screen recording is the one that most needs saying out loud: the
      // popup closed the moment Chrome's source picker took focus, so there is
      // no surface left that could tell the tester it actually started.
      announceL('recording', 'titleRecording', 'QA Wrap is recording', 'recordingStarted', { scope: 'screen', refused: started.refused || [] }).catch(() => {});
      return started;
    } catch (err) {
      if (err.message === 'CANCELLED') return { cancelled: true };
      /*
       * A refusal the tester can act on without hunting for the page.
       */
      if (err.needsPermission) {
        await handlers.UQA_OPEN_PERMISSIONS().catch(() => {});
      }
      throw err;
    }
  },
  /**
   * The source went away underneath us.
   *
   * Sent by the offscreen document when a desktop capture's track ends —
   * which is what Chrome's own "Stop sharing" bar does. Finish the clip rather
   * than keep encoding a dead stream, or the recording ends with however many
   * minutes of frozen final frame it took the tester to notice.
   */
  UQA_SOURCE_ENDED: async (msg) => {
    // A failed disk write is a live warning, not the end of the clip: the
    // recorder carries on from memory (capped) and the tester hears it now.
    if (msg?.reason === 'disk-warn') {
      // The popup and side panel read this through UQA_RECORD_STATE; recording carries on.
      await chrome.storage.session.set({ [DISK_WARN]: true }).catch(() => {});
      await paintBadge().catch(() => {}); // the amber "!"
      await broadcast({ type: 'UQA_RECORDING_CHANGED', recording: true }).catch(() => {});
      chat.announce('recording-disk',
        await tw('common.worker.disk.title', 'Recording is not being saved to disk'),
        await tw('common.worker.disk.body', 'A disk write failed. The clip is being kept in memory and will stop by itself at the limit; press Stop soon.')).catch?.(() => {});
      return { warned: true };
    }
    const state = await recordingState().catch(() => null);
    if (!state?.recording || state.finishing) return { stopped: false };
    // Three ways a source can end, and the label says which, because a clip
    // that is short for a reason should say the reason in the report.
    const label = msg?.failed
      ? await tw('common.worker.clip.failed', 'Screen recording (the recorder failed)')
      : msg?.reason === 'ram-cap'
        ? await tw('common.worker.clip.ramCap', 'Screen recording (stopped: disk write failed and memory limit reached)')
      : msg?.reason === 'gif-full'
        ? await tw('common.worker.clip.gifFull', 'Screen recording (GIF reached its size limit)')
        : await tw('common.worker.clip.sharingStopped', 'Screen recording (sharing stopped)');
    return handlers.UQA_RECORD_STOP({ label });
  },
  UQA_RECORD_STATE: async () => {
    const st = await recordingState();
    if (!st?.recording) {
      await chrome.storage.session.remove(DISK_WARN).catch(() => {});
      return st;
    }
    const w = await chrome.storage.session.get(DISK_WARN).catch(() => ({}));
    return w[DISK_WARN] ? { ...st, diskWarn: true } : st;
  },

  /**
   * Can this tab be recorded right now, and if not, what does the tester do?
   *
   * Asked before the Record card is painted, so the answer arrives while there
   * is still something to do about it.
   */
  UQA_CAN_RECORD: async (msg) => {
    const tabId = msg.tabId ?? (await testableTabId());
    if (tabId == null) return { can: false, why: 'no-tab' };
    const tabs = await grantedTabs();
    if (tabs.has(tabId)) return { can: true, tabId };
    // The shortcut the tester has actually bound, not the one in the docs.
    const commands = await chrome.commands?.getAll?.().catch(() => []);
    const shortcut =
      (commands || []).find((c) => c.name === 'record-tab')?.shortcut ||
      chrome.runtime.getManifest().commands?.['record-tab']?.suggested_key?.default ||
      '';
    return { can: false, why: 'not-invoked', tabId, shortcut };
  },
  UQA_VIDEO_FORMATS: () => videoFormats(),
  /** Every format, with what this browser can actually write marked. */
  UQA_FILE_TYPES: async () => {
    const probed = await videoFormats();
    return { text: TEXT_TYPES, ...probed };
  },
  UQA_STORAGE: () => storageHeadroom(),
  /** Microphone, camera and screen-capture permission, for Settings and the popup. */
  UQA_MEDIA_PERMISSIONS: () => mediaPermissions(),
  /**
   * Settings, open at Permissions, walking the tester through the three grants.
   */
  UQA_OPEN_PERMISSIONS: async () => {
    const url = chrome.runtime.getURL('options/options.html?guide=permissions#sec-permissions');
    const [open] = await chrome.tabs
      .query({ url: `${chrome.runtime.getURL('options/options.html')}*` })
      .catch(() => []);
    const tab = open
      ? await chrome.tabs.update(open.id, { url, active: true })
      : await chrome.tabs.create({ url });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return { tabId: tab.id };
  },
  /**
   * Chrome's own site settings for this extension, which is the only place a
   * `denied` microphone or camera can be taken back.
   *
   * A page of ours cannot link to `chrome://` — Chrome blocks the navigation
   * and nothing happens, with no error the user can see — so the worker opens
   * the tab instead. That is the whole reason this handler exists rather than
   * an `<a href>` in the popup.
   */
  UQA_OPEN_SITE_SETTINGS: async () => {
    const site = `chrome-extension://${chrome.runtime.id}`;
    const tab = await chrome.tabs.create({
      url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(site)}`,
    });
    return { tabId: tab.id, site };
  },
  /** The sound of one stored clip, written out as a WAV. */
  UQA_MEDIA_AUDIO: (msg) => exportAudio(msg),

  UQA_MEDIA_LIST: (msg) => mediaListFor(msg),
  /** A stored item's bytes, for the few callers that cannot read the store. */
  UQA_MEDIA_BLOB: async (msg) => {
    const record = await getMedia(msg.id);
    if (!record) throw new Error('That item is no longer stored.');
    const size = record.bytes ?? record.blob?.size ?? 0;
    if (size > MEDIA_BLOB_MAX) {
      throw new Error(
        `That item is ${Math.round(size / 1024 / 1024)}MB, which is too large to pass through a ` +
          'message. Open it from the report page, which reads it straight from local storage.'
      );
    }
    const buffer = await record.blob.arrayBuffer();
    return { id: record.id, type: record.type, bytes: record.bytes, data: [...new Uint8Array(buffer)] };
  },
  UQA_MEDIA_DELETE: async (msg) => {
    // `deleteMedia` now answers whether anything was actually removed. A card
    // that vanished from the list and came back on reload was this: a delete
    // that touched the wrong store reported success and did nothing.
    const gone = await deleteMedia(msg.id);
    if (!gone) throw new Error('That item is no longer stored.');
    return gone;
  },

  /**
   * Stamp a copy of a screenshot with the tool, the owner and the session.
   *
   * Attribution, not a seal — anyone with a crop tool can remove it, and saying
   * otherwise would be a false assurance about the one artefact a bug report
   * depends on. It is useful for what it actually does: telling you six months
   * later which run a loose PNG came out of.
   */
  /**
   * Embed provenance into a stored PNG, and read it back.
   *
   * Nothing is painted. This exists so a tester can confirm the mark is there
   * and see what it says — the claim "your output is attributed" is worth
   * nothing if nobody can check it — and so an older screenshot taken before
   * this existed can be brought up to date.
   */
  UQA_MEDIA_MARK: async (msg) => {
    const media = await getMedia(msg.id);
    if (!media) throw new Error('That image is no longer stored.');
    const session = media.sessionId ? await getSession(media.sessionId) : null;

    const meta = await markImage({
      id: msg.id,
      session,
      version: chrome.runtime.getManifest().version,
      label: media.label,
    });
    await broadcast({ type: 'UQA_MEDIA_CHANGED' });
    return meta;
  },

  /** What is actually embedded in a stored image, read back from its bytes. */
  UQA_MEDIA_PROVENANCE: async (msg) => {
    const media = await getMedia(msg.id);
    if (!media) throw new Error('That image is no longer stored.');
    return readPng(media.blob);
  },

  /**
   * The provenance this build stamps on everything, and how to verify it.
   *
   * Offered as a message so the report, the settings page and any agent asking
   * the extension what it is all read the same answer.
   */
  UQA_PROVENANCE: async (msg) => {
    const session = msg?.sessionId ? await getSession(msg.sessionId) : null;
    return {
      ...provenance({ session, version: chrome.runtime.getManifest().version }),
      maker: MAKER,
      where: [
        'PNG screenshots: tEXt chunks (Software, Author, Copyright, Comment, qaw-provenance)',
        'Markdown, YAML, CSV, XML, code: the format’s own comment channel',
        'JSON and Postman: a _provenance field',
        'HTML: meta tags plus schema.org JSON-LD',
        'Jira and every tracker: a footer line and an issue property',
      ],
      verify: 'Any qaw1:… token can be checked with readToken(); a PNG with readPng().',
      honesty:
        'Attribution, not a seal. The checksum makes tampering detectable but not impossible: ' +
        'an extension cannot hold a key the person running it cannot read.',
    };
  },

  /** Verify a token found anywhere, so an agent can attribute a loose file. */
  UQA_VERIFY: (msg) => readToken(msg.text || ''),
  /** Everything about one item except its payload — for the markup editor's title. */
  UQA_MEDIA_META: async (msg) => {
    const record = await getMedia(msg.id);
    if (!record) throw new Error('That item is no longer stored.');
    const { blob, ...meta } = record;
    return meta;
  },
  /**
   * Store a marked-up image.
   *
   * `asCopy` decides whether the original survives. Replacing is the default
   * because a screenshot with an arrow on it is what the tester meant to take;
   * keeping a copy is there for when the unmarked original is itself evidence.
   */
  UQA_MEDIA_SAVE_EDIT: async (msg) => {
    const original = await getMedia(msg.id);
    if (!original) throw new Error('The original is no longer stored.');

    const blob = new Blob([new Uint8Array(msg.data)], { type: msg.mime });
    const id = msg.asCopy ? `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` : original.id;

    await putMedia({
      ...original,
      id,
      blob,
      type: blob.type,
      bytes: blob.size,
      label: msg.label || original.label,
      annotated: true,
      ts: msg.asCopy ? Date.now() : original.ts,
    });

    if (msg.asCopy && original.sessionId) {
      await appendEvent({
        sessionId: original.sessionId,
        kind: 'screenshot',
        ts: Date.now(),
        captureId: id,
        mediaId: id,
        imageType: blob.type,
        bytes: blob.size,
        text: msg.label || 'Marked-up screenshot',
        annotated: true,
      });
      paintBadge();
    }
    await broadcast({ type: 'UQA_MEDIA_CHANGED' });
    return { id, bytes: blob.size, replaced: !msg.asCopy };
  },
  UQA_OPEN_ANNOTATE: async (msg) => {
    const { tabId } = await openOwnPage(`annotate/annotate.html?id=${encodeURIComponent(msg.id)}`);
    return { tabId };
  },
  UQA_OPEN_VIDEOEDIT: async (msg) => {
    const { tabId } = await openOwnPage(`videoedit/videoedit.html?id=${encodeURIComponent(msg.id)}`);
    return { tabId };
  },

};

/** Media plus pre-media-store screenshots (the old `captures` table), whose scan runs once per session per worker life (r7-07-2). */
const legacyMediaMemo = new Map();

async function mediaListFor(msg) {
  const current = await listMedia(msg.sessionId, { companions: !!msg.companions });
  let legacy = legacyMediaMemo.get(msg.sessionId);
  if (!legacy) {
    const known = new Set(current.map((m) => m.id));
    const events = await getEvents(msg.sessionId);
    const legacyIds = events
      .filter((e) => e.kind === 'screenshot' && e.captureId && !known.has(e.captureId))
      .map((e) => e.captureId);
    const captures = legacyIds.length ? await getCaptures(legacyIds) : {};
    legacy = events
      .filter((e) => e.kind === 'screenshot' && captures[e.captureId])
      .map((e) => ({
        id: e.captureId,
        sessionId: msg.sessionId,
        kind: 'screenshot',
        label: e.text || 'Screenshot',
        bytes: Math.round((captures[e.captureId].dataUrl.length * 3) / 4), // base64
        type: (captures[e.captureId].dataUrl.match(/^data:([^;]+)/) || [])[1] || 'image/png',
        url: captures[e.captureId].url,
        ts: e.ts,
        legacy: true,
      }));
    legacyMediaMemo.set(msg.sessionId, legacy);
  }
  return legacy.length ? [...current, ...legacy].sort((x, y) => x.ts - y.ts) : current;
}

/** One session's timeline. `kinds`: only those event kinds. `sinceSeq`: only what is new; `tail: N` (07-1): the last N events (max 5000). The session row is whole. */
async function timelineFor(msg) {
  const tail = Number.isInteger(msg.tail) && msg.tail > 0 ? Math.min(msg.tail, 5000) : 0;
  let events = msg.sinceSeq
    ? await getEventsSince(msg.sessionId, msg.sinceSeq)
    : await getEvents(msg.sessionId);
  // r7-07-2: `kinds` narrows before the reply
  if (Array.isArray(msg.kinds) && msg.kinds.length) events = events.filter((e) => msg.kinds.includes(e.kind));
  if (tail && events.length > tail) events = events.slice(-tail);
  return {
    session: await getSession(msg.sessionId),
    events,
    incremental: !!msg.sinceSeq,
  };
}

/** Saved sessions: the list, the timeline, deletion and every export. */
// The tab start in flight from its first line (claimRecordStart begins after its awaits): true once it records.
let startGate = null;
const startTab = recordingHandlers.UQA_RECORD_START;
recordingHandlers.UQA_RECORD_START = (msg, sender) => {
  const run = startTab(msg, sender);
  const gate = (startGate = run.then(() => true, () => false));
  gate.then(() => { if (startGate === gate) startGate = null; });
  return run;
};

export const libraryHandlers = {
  UQA_LIST_SESSIONS: () => listSessions(),
  UQA_GET_TIMELINE: (msg) => timelineFor(msg),
  UQA_GET_CAPTURE: async (msg) => (await getCaptures([msg.captureId]))[msg.captureId] || null,
  // Refuse to delete a session still being written to or filed into (a clip): a refusal, not a silent cascade. Stop first.
  UQA_DELETE_SESSION: async (msg) => {
    const id = msg.sessionId;
    if (!id) throw new Error('No session was named.');
    if ((await liveSessionIds()).includes(id)) { // r8-06-1: any window's session, not one of them
      throw new Error('That session is still running. Stop it first, then delete it.');
    }
    const clip = await recordingState().catch(() => null);
    if (clip?.recording && clip.sessionId === id) {
      throw new Error('A recording is still being filed into that session. Stop the clip first.');
    }
    await flushEvents(); // r5-06-4
    await bounded(deleteSession(id), 'tx'); // r10-06-4: a stalled store answers SLOW, not never
    forgetSession(id);
    // The popup offers the last session's exports from this key; leaving it
    // pointing at a deleted row is how "Open the report" opened nothing.
    const { [LAST]: last } = await chrome.storage.session.get(LAST);
    if (last === id) await chrome.storage.session.remove(LAST);
    await chrome.storage.session.remove([...dataSessionKeys(), ...eraseKeys([id])]).catch(() => {}); // r2-03-3, r10-03-3: masks and state go too
    await broadcast({ type: 'UQA_STATE_CHANGED' });
    return { deleted: id };
  },
  UQA_EXPORT: (msg) => exportOp('session', msg),
  // Where a file went, kept with the session: the export history the report
  // shows, and the answer to "did I already save this one".
  // The edited diagram, kept as an event so the report exports it and the
  // editor reopens it as it was left.
  UQA_DIAGRAM_SAVE: async (msg) => {
    if (!msg.sessionId || !msg.flow?.nodes) throw new Error('Nothing to keep.');
    const flow = { ...msg.flow, nodes: msg.flow.nodes.slice(0, 200), edges: (msg.flow.edges || []).slice(0, 400) };
    return appendEvent({ sessionId: msg.sessionId, kind: 'diagram', ts: Date.now(), flow, nodes: flow.nodes.length, edges: flow.edges.length });
  },
  UQA_EXPORT_SAVED: async (msg) => {
    if (!msg.sessionId) return null;
    return appendEvent({
      sessionId: msg.sessionId, kind: 'export', ts: Date.now(),
      format: msg.format, label: msg.label || msg.format, path: msg.path || '', bytes: msg.bytes || 0, how: msg.how || '',
    });
  },

  /** tabId is optional, and when it is absent the tab is resolved with */
  UQA_PICK: async (msg, sender) =>
    sendToFeature(msg.tabId ?? sender?.tab?.id ?? (await testableTabId()), 'picker', {
      type: 'UQA_ACTIVATE_PICKER',
      // What the pick is for (any/step/element/sensitive); validated in the page.
      purpose: msg.purpose,
    }),

  /**
   * Put the crosshair away in every frame of the tab.
   */
  UQA_PICK_OFF: async (msg, sender) => {
    const tabId = msg.tabId ?? sender?.tab?.id ?? (await testableTabId());
    await sendToTab(tabId, { type: 'UQA_ACTIVATE_PICKER', off: true });
    return true;
  },

  /**
   * The frameLocator chain from the top frame down to the frame that asked.
   *
   * `sender.frameId` is the whole question and only the browser can answer it,
   * which is why this lives here and not in the page: a frame behind an origin
   * boundary does not know its own id, its parent, or the element that holds
   * it. See `frameChain()` above for what it does with that.
   */
  UQA_FRAME_CHAIN: async (_msg, sender) => {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    if (tabId == null || frameId == null) {
      return { prefix: '', parts: [], depth: 0, complete: false, reason: 'This did not come from a frame of a tab.' };
    }
    return frameChain(tabId, frameId);
  },

  /** Put text on the clipboard for a frame that is not allowed to. */
  UQA_COPY_TEXT: async (msg, sender) => {
    const tabId = msg.tabId ?? sender?.tab?.id ?? (await testableTabId());
    const text = String(msg.text ?? '');
    if (!text) return { copied: false, how: 'empty' };
    chat.recordCopy(text); // T-070: count and size only
    const inPage = await sendToTab(tabId, { type: 'UQA_COPY', text, quiet: true }, { frameId: 0 });
    if (inPage?.ok) return { copied: true, how: inPage.how };
    const hidden = await copyToClipboard(text).catch(() => null);
    if (hidden?.copied) return { copied: true, how: 'offscreen' };
    return { copied: false, how: 'failed' };
  },

};

/* ------------------------------------------------- window-size runs (G8) */

/**
 * "Check another size", as a thing the session actually contains (contract: `research/55-window-sizes-contract.md`). The
 * worker's half: mint the run, decide what it inherited, append the two events, file the media.
 *
 * Recording: resize the parent's own window in place, so the run lands inside the clip and the original bounds live on the
 * `opened` event (MV3 tears this worker down between). Not recording: open a window. `video` is refused only when a clip
 * runs in a different window from the tab under test.
 */

/**
 * The clip that is being filmed inside a window-size run, remembered across a
 * worker teardown so the stop can stamp it.
 *
 * Session storage rather than a module variable, for the reason everything in
 * this worker uses it: MV3 tears the worker down between the start and the
 * stop as a matter of course.
 */
const CLIP_RUN = 'recordingViewportRun';

/** Which window-size run a window is, if it is one. */
async function runForWindow(sessionId, windowId) {
  if (!sessionId || windowId == null) return null;
  const open = viewportRuns(await viewportEvents(sessionId)).find(
    // Only a run that opened its *own* window. A resize-in-place run's window
    // is the session's own window, and a clip started there is the session's
    // clip: stamping it with a runId would move the session's own recording
    // out of Screens & video, which is the one-clip-one-home rule read
    // backwards.
    (r) => r.windowId === windowId && !r.closedAt && (r.mode || 'window') === 'window'
  );
  return open ? { runId: open.runId, viewport: open.viewport } : null;
}

/**
 * Close every run a window was carrying.
 *
 * Called from `windows.onRemoved` and from `stopSession`, so a run ends when
 * its window closes and also when the session it belongs to ends with the
 * window still open. `reason` says which, because a run that ended because the
 * tester closed it and one that ended because the session did are different
 * facts about the same duration.
 */
/** Re-file a stored clip (or its webcam companion) with the parent's new ids; false when the put failed, never thrown. */
async function restampMedia(id, fields) {
  const stored = await getMedia(id).catch(() => null);
  if (!stored) return true;
  return putMedia({ ...stored, ...fields }).then(() => true, () => false);
}

const restampCompanion = (id, fields) => (id ? restampMedia(id, fields) : true);

const restampGap = (sessionId) => (!sessionId || sessionId === 'unfiled' ? null : appendEvent({
  sessionId, kind: 'note', tag: 'capture-gap', gap: 'recording-orphaned', ts: Date.now(), text: 'Capture gap: a recording could not be re-filed under this session.',
}).catch(() => {}));

// "Remember this site" (opt-in, per site): background/remember.js.
export const autopilot = {
  armed, site, putSession, arm: (m) => handlers.UQA_ARM(m), start: (m) => handlers.UQA_START(m), live: async (w) => sessionIn(await sessionsByWindow(), w),
  shot: (t, key, guard) => captureScreenshot({ text: 'Auto screenshot on first error', tabId: t.id, extra: { auto: true, forKey: key }, guard }),
  dotOn: async () => (await getSettings()).pageIndicator !== false,
};
