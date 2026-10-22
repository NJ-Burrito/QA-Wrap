/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * T-054: the one list of what the extension holds (erase-all, footprint, PRIVACY.md's table, tests).
 * A store missing here fails tools/test-store-registry.mjs.
 * erasedBy: 'eraseAll' | 'reset' | 'KEEP' (survives both). says: the word the confirm sentence
 * uses (options.reset.erases.*), null = left out; every non-KEEP row declares it.
 */
const idb = (store, holds, says) => ({ id: `idb:${store}`, kind: 'idb', store, holds, erasedBy: 'eraseAll', retention: 'retention days', syncs: false, shownIn: 'footprint', session: true, says });
const loc = (key, holds, erasedBy = 'KEEP', retention = 'until removed', says) => ({ id: `local:${key}`, kind: 'local', key, holds, erasedBy, retention, syncs: false, shownIn: erasedBy === 'KEEP' ? '-' : 'footprint', says });

const ses = (key, holds, shownIn = '-') => ({ id: `session:${key}`, kind: 'session', key, holds, erasedBy: 'eraseAll', retention: 'browser session', syncs: false, shownIn, says: null });
// r2-03-3: a runtime pointer, never your content: Erase all leaves it, closing the browser drops it.
const tmp = (key, holds) => ({ ...ses(key, holds), erasedBy: 'browser', transient: true });

/** D-1010-58: the allow-list platform/settings.js enforces. Not here on purpose: the tester's name, the workspace and the save-folder name (storage.local), and every credential (the vault). */
export const SYNCED_SETTINGS = Object.freeze(["timeboxMinutes", "timeboxEnabled", "expandPercent", "maxStressNodes", "rtlMirror", "rtlAccent", "rtlBidi", "causalWindowMs", "inputDebounceMs", "breakDelayMs", "breakRepeat", "maxTimelineRows", "screenshotWidth", "liveRefreshMs", "keymap", "keymapEnabled", "maskExtraPattern", "preRollBuffer", "imageFormat", "imageQuality", "videoFormat", "videoFps", "videoQuality", "clock", "downloadFolder", "saveAs", "autoSubmitDefect", "redact", "redactExtra", "retentionDays", "retentionNoticeSeen", "launchSurface", "soundEnabled", "soundVolume", "soundScope", "vfxEnabled", "systemNotifications", "recordMic", "recordTabAudio", "recordWebcam", "recordCursor", "webcamPosition", "webcamSize", "fileTree"]);

export const REGISTRY = Object.freeze([
  idb('sessions', 'session records', 'sessions'),
  idb('events', 'clicks, typing, requests, console (secrets masked)', 'events'),
  idb('captures', 'screenshots', 'screenshots'),
  idb('media', 'screen and webcam recordings', 'recordings'),
  idb('mediaParts', 'recording parts while a clip is written', 'recordings'),
  idb('mediaPending', 'clips interrupted mid-write', 'recordings'),
  idb('replay', 'typed values for replay', 'replay'),
  loc('cookieProfiles', 'saved cookie profiles, values included (encrypted)', 'eraseAll', undefined, 'cookies'),
  loc('interrupted', 'sessions a crash closed: id, saved event count and time, no content, shown once on the next popup open and removed when you dismiss it', 'eraseAll', undefined, null),
  loc('lastPurgeAt', 'time of the last retention sweep', 'eraseAll', undefined, null),
  loc('purgeLog', 'count of sessions the sweep removed', 'eraseAll', undefined, null),
  ses('lastSessionId', 'id of the last session'),
  { ...ses('masks:', 'hand-masked regions per session'), id: 'session:masks', prefix: true },
  // data = also removed with a deleted session
  { ...ses('sessionState:', 'per-session tool state: rules, tools used, lost-event count, raw start URL (memory only)', 'privacy'), id: 'session:sessionState', prefix: true },
  { ...ses('suiteDraft', 'the test-suite draft you are building', 'privacy'), data: true },
  { ...ses('qawReporterShot', 'which screenshot the reporter will attach', 'privacy'), data: true },
  // Auto-start bookkeeping: ids, times and short error-kind keys, no page text. Transient so that deleting or erasing one session never wipes the others' entries (the idle sweep and remember.forget prune them).
  ...[['autoStarted', 'which sessions started by themselves, and when'], ['autoShotState', 'per session: how many automatic screenshots were taken, and a short key per error kind already shot'], ['autoPauseUntil', 'the time until which starting by itself is paused']].map(([k, h]) => tmp(k, h)),
  ...['activeSessionId', 'activeSessionsByWindow', 'dismissedSessionId', 'uqa.doneJob', 'uqa.diskWarn', 'uqa.updateNew', 'qawUpdateDismissed', 'recordingViewportRun', 'recordableTabs', 'armedWindows', 'recordingWindowId', 'coverageTab', 'coverageMode', 'floatWindowId', 'managedPolicy', 'qwk', 'rememberWoke', 'autoWoke'].map((k) => tmp(k, 'runtime pointer or flag')),
  { ...ses('popupDraft', 'the note or charter you typed and did not send yet, masked, at most 2 KB per field; gone when the browser closes, the session is deleted or the text is sent', 'privacy'), data: true },
  ses('uqa.secHeaders.windows', 'windows watched for security headers', 'privacy'),
  ses('uqa.secHeaders.seen', 'security headers seen per page', 'privacy'),
  { id: 'sync:settings', kind: 'sync', key: 'settings', holds: 'your settings, except name, workspace and folder name (local if sync is off); the download folder, the extra mask pattern and the extra redaction words sync too, so keep secrets and client names out of them', erasedBy: 'reset', retention: 'until reset', syncs: SYNCED_SETTINGS, shownIn: 'options', says: 'settings' },
  loc('settingsLocal', 'settings kept on this machine only: your name, the workspace you joined, the save-folder name, the recording-dot switch', 'reset', undefined, null),
  loc('secrets', 'tracker credential, encrypted', 'reset', undefined, 'credentials'),
  loc('qw0', 'vault record for the credential passphrase', 'reset', undefined, 'passphrase'),
  loc('handlerRing', 'last 50 handler failures (name and short message, addresses and hosts stripped), read only by the support bundle', 'eraseAll', undefined, 'diagnostics'),
  { ...loc('bootMs', 'the last 5 times the background worker took to start, in milliseconds, read only by the support bundle', 'reset', undefined, 'diagnostics'), shownIn: 'support bundle' },
  { ...loc('toolUseTicks', 'a count of tool uses on this machine, a number with no detail, read only by the support bundle', 'reset', undefined, 'diagnostics'), shownIn: 'support bundle' },
  loc('apiEnvironments', 'API variables, tokens included (encrypted)', 'eraseAll', undefined, 'credentials'),
  loc('egressLedger', 'what left this machine: time, kind, host and size of the last 200 sends, with no content', 'eraseAll', undefined, 'egress'),
  loc('mattermost', 'your Mattermost account: server address and chosen channel (the access token is kept in the encrypted vault)', 'reset', undefined, 'credentials'),
  loc('sessionSeq', 'session counter'),
  loc('consentedAt', 'when you accepted the first-run notice'),
  loc('consentVersion', 'which notice you accepted'),
  loc('consentRevision', 'which consent revision you accepted'),
  loc('firstReportOpenedAt', 'when a report was first opened, local only, read only by the support bundle'),
  loc('bufferSites', 'the sites where you switched the 2-minute replay buffer on (address only, off until you tick it), listed and removable in Settings', 'reset', undefined, null),
  loc('agentBridge', 'whether you switched the agent bridge on (a yes or no)', 'reset', undefined, null),
  loc('rememberedSites', 'the sites you chose to wake up on by itself (address only, off until you tick it), listed and removable in Settings', 'reset', undefined, null),
  loc('autoStartSites', 'the sites where you chose to start recording by itself (address only, off until you tick it), listed and removable in Settings', 'reset', undefined, null),
  loc('autoShotSites', 'the sites where you chose an automatic screenshot on the first error of each kind (address only, off until you tick it), listed and removable in Settings', 'reset', undefined, null),
  loc('pageIndicator', 'whether the recording dot shows on pages (a yes or no, on until you switch it off in Settings)', 'reset', undefined, null),
  loc('toolsOpen', 'whether the tools list in the popup is open (a yes or no)', 'reset', undefined, null),
  loc('noteType', 'the last note type you chose (bug, issue, question or note)', 'reset', undefined, null),
  loc('aiWriting', 'AI writing choice, no key', 'reset', undefined, null),
  loc('aiWritingKey', 'your AI key, local only', 'reset', undefined, 'credentials'),
  loc('qawJira', 'Jira helper switches: your Jira address, project keys, labels and what to be notified about, no password', 'reset', undefined, null),
  loc('qawJiraDir', 'Jira helper: the page direction (RTL or LTR) you chose for each Jira address, kept until Chrome closes', 'reset', undefined, null),
  loc('qawJiraPos', 'Jira helper: where you dragged the RTL or LTR tab along the top edge, for each Jira address (pixels from the nearer side)', 'reset', undefined, null),
  loc('qawJiraSeen', 'Jira helper: the Jira addresses you opened and the API version each one speaks, for the notifications and the Settings list (no page content)', 'reset', undefined, null),
  loc('floatBounds','position of the floating window'),
  loc('floatBoundsV', 'version of that position'),
  loc('storagePersistence', 'the browser answer to "keep my data"'),
  loc('qawTheme', 'light or dark choice'),
  { id: 'sync:qawLanguage', kind: 'sync', key: 'qawLanguage', holds: 'interface language', erasedBy: 'KEEP', retention: 'until removed', syncs: ['qawLanguage'], shownIn: '-' },
]);

const by = (f) => REGISTRY.filter(f);
export const eraseStores = () => by((r) => r.kind === 'idb' && r.erasedBy === 'eraseAll').map((r) => r.store);
export const eraseLocalKeys = () => by((r) => r.kind === 'local' && r.erasedBy === 'eraseAll').map((r) => r.key);
/** Local keys Settings reset removes (T-063: the worker clears these beside resetSettings()). */
export const resetLocalKeys = () => by((r) => r.kind === 'local' && r.erasedBy === 'reset').map((r) => r.key);
export const eraseSessionKeys = () => by((r) => r.kind === 'session' && !r.prefix && r.erasedBy === 'eraseAll').map((r) => r.key);
const prefixOf = (id) => by((r) => r.id === id)[0].key;
export const maskPrefix = () => prefixOf('session:masks');
export const statePrefix = () => prefixOf('session:sessionState');
/** r2-03-3: the session keys that hold your content, so deleting one session removes them too. */
export const dataSessionKeys = () => by((r) => r.data).map((r) => r.key);
export const sessionStores = () => by((r) => r.session).map((r) => r.store);

/** The table PRIVACY.md carries between its markers. Every registry row appears: the ones the footprint shows get a line each, the rest are grouped as small internal values (r3-03-8). */
export function privacyTable() {
  const area = (r) => ['chrome', 'storage', r.kind].join('.'); // built, not spelled: core/ names no chrome.* call
  const where = (r) => (r.kind === 'idb' ? 'IndexedDB' : area(r));
  const gone = (r) => (r.erasedBy === 'KEEP' ? 'kept' : r.erasedBy === 'reset' ? 'Settings reset' : r.erasedBy === 'browser' ? 'closing the browser' : 'Erase all');
  const shown = REGISTRY.filter((r) => r.shownIn !== '-' || r.kind === 'sync');
  const rows = shown.map((r) => `| ${r.holds} | ${where(r)} \`${r.store || r.key}\` | ${r.retention} | ${gone(r)} | ${r.syncs ? 'yes' : 'no'} |`);
  const groups = new Map();
  for (const r of REGISTRY) {
    if (shown.includes(r)) continue;
    const k = `${r.kind}|${gone(r)}|${r.retention}|${r.syncs ? 'yes' : 'no'}`;
    if (!groups.has(k)) groups.set(k, { r, keys: [] });
    groups.get(k).keys.push(r.store || r.key);
  }
  for (const { r, keys } of groups.values()) {
    rows.push(`| small internal values (flags, counters, pointers, timestamps): ${keys.map((x) => `\`${x}\``).join(', ')} | ${area(r)} | ${r.retention} | ${gone(r)} | ${r.syncs ? 'yes' : 'no'} |`);
  }
  return ['| Holds | Where | Kept | Removed by | Syncs |', '| --- | --- | --- | --- | --- |', ...rows].join(String.fromCharCode(10));
}

/** An 80 percent quota warning from navigator.storage.estimate(). */
export function quotaWarn(est) {
  const { usage = 0, quota = 0 } = est || {};
  return quota > 0 && usage / quota >= 0.8;
}

/** What a confirm sentence names for `mode` ('reset' | 'eraseAll'): each row's `says`, once, in registry order. `reg` is a parameter so a test can add a scratch row. */
export const erasedSays = (mode, reg = REGISTRY) => [...new Set(reg.filter((r) => r.erasedBy === mode && r.says).map((r) => r.says))];

/**
 * The confirm sentence (and, with `gone`, the post-erase line) for `mode`, built from the registry
 * and the page's translator; '' when the registry names nothing. Words live in options.reset.erases*.
 */
export function erasedText(t, mode, { reg = REGISTRY, gone = false } = {}) {
  const says = erasedSays(mode, reg);
  if (!says.length) return '';
  const list = says.map((k) => t(`options.reset.erases.${k}`)).join(t('options.reset.erasesJoin'));
  return t(gone ? 'options.reset.erasesGone' : mode === 'reset' ? 'options.reset.erasesIntro' : 'options.reset.erasesAllIntro', { list });
}
