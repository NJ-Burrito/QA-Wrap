/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The two lines the popup shows about recording that starts by itself (design C6, DESIGN-1011 AUTO-2/AUTO-3).
 * The two lines the popup shows about recording that starts by itself (design C6, DESIGN-1011 AUTO-2/AUTO-3). A classic deferred
 */

const AUTOPILOT_PAUSE_MS = 60 * 60 * 1000;

/** Reads what the banner needs from storage: the pause deadline, if any, and whether this popup's site has an auto power ticked. */
async function autopilotSiteState() {
  const { autoPauseUntil } = await chrome.storage.session.get('autoPauseUntil');
  const here = typeof siteAccess === 'undefined' ? undefined : siteAccess.pattern;
  const lists = here === undefined ? null : await chrome.storage.local.get(['autoStartSites', 'autoShotSites']);
  const onAutoSite = lists ? !!here && [.../** @type {string[]} */ (lists.autoStartSites || []), .../** @type {string[]} */ (lists.autoShotSites || [])].includes(here) : undefined;
  return { pauseUntil: Number(autoPauseUntil) || 0, now: Date.now(), onAutoSite };
}

function autopilotBanner(siteState, session, tr) {
  const say = tr || (typeof t === 'function' ? t : (key) => key);
  const now = Number(siteState?.now) || Date.now();
  const until = Number(siteState?.pauseUntil) || 0;
  const running = !!session && !session.endedAt;
  if (until > now && siteState?.onAutoSite !== false) {
    const time = new Date(until).toLocaleTimeString(globalThis.QAWi18n?.numTag ? QAWi18n.numTag() : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    return { id: 'resume', text: say('popup.auto.paused', { time }), buttonKey: 'popup.auto.resume', action: () => chrome.storage.session.remove('autoPauseUntil') };
  }
  if (running && session.autoStarted) {
    return {
      id: 'pause',
      text: say('popup.auto.running'),
      buttonKey: 'popup.auto.pause',
      action: async () => {
        await chrome.storage.session.set({ autoPauseUntil: Date.now() + AUTOPILOT_PAUSE_MS });
        await chrome.runtime.sendMessage({ type: 'UQA_STOP' });
      },
    };
  }
  if (session && session.endedAt && session.stopReason === 'idle') return { id: 'idle', text: say('popup.auto.idleStopped'), buttonKey: null, action: null };
  return null;
}
