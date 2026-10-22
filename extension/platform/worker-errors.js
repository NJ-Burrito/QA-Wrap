/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The words of the worker's own errors, in the tester's language (r1-09-1, D-1010-04).
 *
 * The service worker throws plain English sentences and ships to every surface as they are. Translating
 * them at the throw would add bytes to the worker graph (751 of 755 KB), so the translation sits on the
 * UI side instead: this module is loaded by the popup only, maps the EXACT sentence a worker handler throws
 * to a `common.worker.err.*` key, and fills any hole the sentence has from the sentence itself.
 *
 * It matches whole sentences, never fragments, so rewording a throw in the worker leaves it untranslated
 * (and `tools/test-i18n.mjs` fails, because it scans every `throw new Error(` literal in
 * background/service-worker.js and requires each to be keyed here or named in INTERNAL below).
 * English is never rewritten: the sentence is already English, and `translateWorkerError` answers null.
 */

const PREFIX = 'common.worker.err.';

/** Whole sentence to key suffix. */
export const EXACT = new Map([
  ["QA Wrap is not allowed on this site yet. Wake up here to allow it.", 'notAllowed'],
  ["The last clip is still being saved. It will appear in the report on its own. Give it a moment before starting another.", 'clipSaving'],
  ["A recording is already starting. Give it a moment rather than pressing again.", 'recStarting'],
  ["No active tab to capture.", 'noTabCapture'],
  ["Open the page you want to photograph first.", 'openToPhotograph'],
  ["Chrome will not photograph its own pages.", 'noPhotographInternal'],
  ["No active tab.", 'noActiveTab'],
  ["No active tab to scan.", 'noTabScan'],
  ["No tab to measure.", 'noTabMeasure'],
  ["No tab to map.", 'noTabHarvest'],
  ["Nothing was written to report.", 'nothingToReport'],
  ["No tab to check.", 'noTabCheck'],
  ["No tab to read.", 'noTabRead'],
  ["No tab to fill.", 'noTabFill'],
  ["Build the suite first.", 'buildSuiteFirst'],
  ["No Jira project chosen.", 'noJiraProject'],
  ["Jira is not configured, so there is nothing to ask. Open Settings › Integrations.", 'jiraNotConfigured'],
  ["No Jira project chosen. Open Settings › Integrations, or pick one in the report.", 'noJiraProjectOrPick'],
  ["No Jira credentials saved. Settings › Integrations.", 'noJiraCredentials'],
  ["No default Jira project saved. Settings › Integrations, or use the form below.", 'noDefaultJiraProject'],
  ["Jira returned a login page: check the address and the sign-in type.", 'jiraLoginPage'],
  ["That destination is no longer configured.", 'destinationGone'],
  ["No chat destination is configured. Open Settings › Integrations and add one.", 'noChatDestination'],
  ["No tab to work on.", 'noTabWork'],
  ["That tab has no address to scope cookies to.", 'noCookieAddress'],
  ["Cookies can only be read on a normal http or https page.", 'cookiesNormalPage'],
  ["No window to dock to.", 'noWindowDock'],
  ["This browser has no side panel.", 'noSidePanel'],
  ["Open the page you want to record first.", 'openToRecord'],
  ["That item is no longer stored.", 'itemGone'],
  ["That image is no longer stored.", 'imageGone'],
  ["The original is no longer stored.", 'originalGone'],
  ["No session was named.", 'noSessionNamed'],
  ["That session is still running. Stop it first, then delete it.", 'sessionStillRunning'],
  ["A recording is still being filed into that session. Stop the clip first.", 'recordingFiling'],
  ["Nothing to keep.", 'nothingToKeep'],
  ["Open the page you want to uncover first.", 'openToUncover'],
  ["That tab has nothing of ours in it to uncover. Open a normal web page.", 'nothingToUncover'],
  ["A session is still running. Stop it first, then erase.", 'sessionRunningErase'],
  ["A recording is still running. Stop the clip first, then erase.", 'recordingRunningErase'],
  ["No window to wake up.", 'noWindowWake'],
  ["No window to put to sleep.", 'noWindowSleep'],
  ["No tab to highlight in.", 'noTabHighlight'],
  ["Team workspaces are switched off in this version.", 'workspacesOff'],
  ["Pick a field first. There is nothing to derive partitions from.", 'pickFieldFirst'],
  ["Open the page you want to measure first.", 'openToMeasure'],
  ["Nothing is being measured.", 'nothingMeasured'],
  ["Open the page you want to check first.", 'openToCheck'],
  ["Coverage stopped because the debugger was detached. Start it again to measure.", 'coverageDetached'],
  // D-1010-105: core/db.js (the words stay verbatim there; the code names the cause). 8000 is OPEN_TIMEOUT_MS; test-i18n pins it.
  ["The QA Wrap database did not open within 8000ms. Close other QA Wrap tabs and DevTools panels, then try again.", 'dbSlow'],
  ["The QA Wrap database is held open by another QA Wrap page at an older version. Close any other tabs with the QA Wrap panel open and retry.", 'dbBlocked'],
  ["The QA Wrap database failed to open.", 'dbBroken'],
  ["This QA Wrap database was saved by a newer version. Update the extension, or erase all data to start again.", 'dbNewer'],
  ["This cookie profile was saved for another site. Open that site to restore it.", 'cookieOtherSite'],
  ["That name cannot be used for a cookie profile.", 'cookieBadName'],
  // D-235: the stop reply carries this sentence beside saved:false when the last events could not be written (background/service-worker.js).
  ["The session was stopped, but its last events could not be saved.", 'stopNotSaved'],
  // F3 (finish-1020): per-tracker "nothing chosen" throws in background/trackers.js.
  ["No Trello list chosen.", 'noTrelloList'],
  ["No ClickUp list chosen.", 'noClickUpList'],
  ["No Asana project chosen.", 'noAsanaProject'],
  ["No Shortcut project, team or workflow state chosen.", 'noShortcutTarget'],
  // F4 (finish-1020): the remaining plain throws in background/trackers.js.
  ["No Linear team you can file into.", 'noLinearTeam'],
  ["Linear accepted the request but did not create the issue.", 'linearNoIssue'],
  ["Linear gave no upload address.", 'linearNoUpload'],
  ["Linear did not link the file to the issue.", 'linearNoLink'],
  ["GitLab gave no link for the upload.", 'gitlabNoLink'],
  ["Azure DevOps gave no address for the upload.", 'azureNoAddress'],
  ["No YouTrack project short name given.", 'ytNoShortName'],
  ["An issue needs a title.", 'issueNeedsTitle'],
]);

/**
 * Sentences with a hole in them. `pick` receives the regex match and answers `{ id, vars }`, or null when
 * the hole holds something this table has no sentence for. `sample` is what test-i18n fills the holes with.
 */
export const PATTERNS = [
  {
    re: /^Already recording (.+)\. Stop the current clip first\. A recording cannot change what it is filming half way through\.$/,
    pick: (m) => (m[1] === 'the screen' ? { id: 'alreadyScreen' } : m[1] === 'a tab' ? { id: 'alreadyTab' } : null),
  },
  {
    re: /^(.+) is still running on this tab\. Wait for it to finish, then try again: two of these at once would move the page under each other and spoil both\.$/,
    pick: (m) => (m[1] === 'A full-page capture' ? { id: 'pageBusyCapture' } : { id: 'pageBusy', vars: { what: m[1] } }),
  },
  {
    re: /^That item is (\d+)MB, which is too large to pass through a message\. Open it from the report page, which reads it straight from local storage\.$/,
    pick: (m) => ({ id: 'itemTooLarge', vars: { mb: m[1] } }),
  },
  {
    re: /^Nothing on the page matches "(.*)" any more\.$/,
    pick: (m) => ({ id: 'noMatch', vars: { selector: m[1] } }),
  },
  // F1 (finish-1020): the nine trackers' sentences from background/trackers.js (request, FIX, netReason, plain, vendorMessage).
  // The tracker name and the vendor's own words stay as data; `sub` names a key whose sentence fills that hole.
  {
    re: /^Could not reach (.+?)\. (.+?)( It may have gone through: check before filing again\.)? Check the host address and your network\.$/,
    pick: (m) => {
      const secs = /^No answer after (\d+) s\.$/.exec(m[2])?.[1];
      const reason = secs ? 'trNetTimeout' : NET[m[2]];
      return reason ? { id: m[3] ? 'trUnreachableMaybe' : 'trUnreachable', vars: { svc: m[1], secs }, sub: { reason } } : null;
    },
  },
  {
    re: /^(.+?) refused this \((\d+)\): (.*)$/,
    pick: (m) => {
      const vars = { svc: m[1], code: m[2] };
      const lim = /^(.*)\. Rate-limited(?:; try again in (\d+) s)?; nothing was created twice\.$/.exec(m[3]);
      if (lim) return said({ id: lim[2] ? 'trLimitedWait' : 'trLimited', vars: { ...vars, secs: lim[2] } }, lim[1]);
      const fix = Object.keys(FIX).find((f) => m[3].endsWith(`. ${f}`));
      if (fix) return said({ id: 'trRefusedFix', vars, sub: { fix: FIX[fix] } }, m[3].slice(0, -fix.length - 2));
      return m[3].endsWith('.') ? said({ id: 'trRefused', vars }, m[3].slice(0, -1)) : null;
    },
  },
  {
    re: /^(.+?) sent back a web page instead of data\. Check the host address; a sign-in page means the server is behind a company login\.$/,
    pick: (m) => ({ id: 'trWebPage', vars: { svc: m[1] } }),
  },
  { re: /^Linear refused this: (.*)$/, pick: (m) => ({ id: 'trLinearRefused', vars: { msg: m[1] } }) }, // F3: Linear's GraphQL errors, the vendor's words as data
  { re: /^You can read (.+) but not file issues on it\.$/, pick: (m) => ({ id: 'trReadOnly', vars: { repo: m[1] } }) }, // F4
  { re: /^upload refused \((\d+)\)$/, pick: (m) => ({ id: 'trUploadRefused', vars: { code: m[1] } }) }, // F4
  { re: /^That token reaches (.+?) but not the project "(.*)"\.$/, pick: (m) => ({ id: 'trNoProject', vars: { org: m[1], project: m[2] } }) }, // F4
  { re: /^No project "(.*)" on (.+)\.$/, pick: (m) => ({ id: 'ytNoProject', vars: { project: m[1], base: m[2] } }) }, // F4
  { re: /^([^.]+?) needs ([^.]+)\.$/, pick: (m) => ({ id: 'trNeeds', vars: { svc: m[1], what: m[2] } }) }, // F4
  {
    re: /^The (.+?) token contains characters a token cannot have; paste it again\.$/,
    pick: (m) => ({ id: 'trBadToken', vars: { svc: m[1] } }),
  },
  {
    re: /^(.+?) answered, but not with what QA Wrap expected\.(.*)$/,
    pick: (m) => (m[2] === ' Check the host address and the token.' ? { id: 'trOdd', vars: { svc: m[1] } }
      : m[2] === ` Check in ${m[1]} whether the issue was created before filing again.` ? { id: 'trOddFiling', vars: { svc: m[1] } } : null),
  },
];

/** netReason() in background/trackers.js, sentence to key suffix (the timeout one has a number and is matched above). */
const NET = {
  'That host name does not exist.': 'trNetDns',
  'Nothing answered at that address.': 'trNetRefused',
  'Its security certificate is not trusted.': 'trNetCert',
  'The connection failed.': 'trNetFailed',
};
/** FIX in background/trackers.js, sentence to key suffix. */
const FIX = {
  'Check the token, or paste a new one.': 'trFixToken',
  'The token works but is not allowed to do this: give it access to this project, or use one that has it.': 'trFixAccess',
  'Check the host, organisation and project names; a token that cannot see a project gets this too.': 'trFixNames',
  'The service failed on its side; try again in a few minutes.': 'trFixLater',
};
/** The vendor's words as data, except vendorMessage()'s own two fallbacks, which are ours to translate. */
function said(hit, msg) {
  const own = msg === 'it sent a web page, not an error message' ? 'trMsgPage' : msg === 'no reason given' ? 'trMsgNone' : '';
  return own ? { ...hit, sub: { ...hit.sub, msg: own } } : { ...hit, vars: { ...hit.vars, msg } };
}

/** A hit from workerErrorKey() in the tester's language: holes named in `sub` are filled with their own keyed sentence first. */
export function fillHit(hit, t) {
  const vars = { ...hit.vars };
  for (const [name, id] of Object.entries(hit.sub || {})) vars[name] = t(PREFIX + id, hit.vars);
  return t(hit.key, vars);
}

/**
 * Throws that need no translation, each with the reason. test-i18n holds this list to the throws that
 * exist: an entry nothing throws any more fails the test.
 */
export const INTERNAL = [
  { text: /^Unknown (?:session|check|tracker|viewport)\b/, why: 'a malformed message from our own code: the popup sends only ids it was given' },
  { text: /^That request cannot be made from a web page\.$/, why: 'refuses a web page; no extension surface sends this message from one' },
  { text: /^Settings can only be changed from the QA Wrap settings page\.$/, why: 'refuses a web page; the settings page is the only sender and never sees it' },
  { expr: /^(?:result|top|model|first)\.error$/, why: 'forwards the text a content script or the offscreen document already wrote' },
  { expr: /^vendorMessage\(/, why: "the vendor's own words (or vendorMessage()'s two fallbacks, keyed above as trMsgPage and trMsgNone) inside a sentence the refusal pattern keys" },
];

/** Error codes that name their own sentence (r2-08-6): the code is read before any text is. */
const LOCKED_FILE = 'Unlock QA Wrap to file';

/**
 * Whatever a failure arrives as (an Error, a worker reply `{ ok: false, error, code }`, or plain text), in the
 * tester's language. The code is read first, then the exact-sentence table; anything unknown is handed back
 * as it came, and nothing at all gives ''. English is never rewritten except where a code names the sentence.
 * @param {any} src
 * @param {(key: string, vars?: object) => string} t
 * @param {string} lang
 */
export function localizeError(src, t, lang) {
  const text = typeof src === 'string' ? src : String(src?.error ?? src?.message ?? '');
  const code = src && typeof src === 'object' ? src.code : '';
  if (code === 'VAULT_LOCKED') return t(PREFIX + (text === LOCKED_FILE ? 'vaultLockedFile' : 'vaultLockedChange'));
  if (code === 'VAULT_UNREADABLE') return t('options.vault.unreadable');
  // r10-02-2: the worker throws 'Wrong passphrase.' with retryMs while a lock-out runs, and a REKEY sentence when the record is too weak.
  // The reply may carry the wait as retryMs or inside data; without a number the sentence says "a moment".
  if (code === 'VAULT_BACKOFF') {
    const ms = Number(src.retryMs ?? src.data?.retryMs);
    return Number.isFinite(ms) && ms > 0
      ? t(PREFIX + 'vaultBackoff', { secs: Math.max(1, Math.ceil(ms / 1000)) })
      : t(PREFIX + 'vaultBackoffSoon');
  }
  if (code === 'VAULT_REKEY') return t(PREFIX + 'vaultRekey');
  // D-1010-151: L2 throws the coded error; the sentence lives here, in both languages, and states no cause it cannot know.
  if (code === 'DEBUGGER_MISSING') return t('common.err.debuggerMissing');
  return translateWorkerError(text, t, lang) ?? text;
}

/** The key and variables for a worker sentence, or null when it is not one this table knows. */
export function workerErrorKey(text) {
  const s = String(text ?? '');
  const id = EXACT.get(s);
  if (id) return { key: PREFIX + id, vars: {} };
  for (const { re, pick } of PATTERNS) {
    const m = re.exec(s);
    const hit = m && pick(m);
    if (hit) return { key: PREFIX + hit.id, vars: hit.vars || {}, sub: hit.sub };
  }
  return null;
}

/**
 * The sentence in the tester's language, or null to leave the text alone (English, or not a known sentence).
 * @param {string} text
 * @param {(key: string, vars?: object) => string} t
 * @param {string} lang
 */
export function translateWorkerError(text, t, lang) {
  // The browser's own refusal to script a page it may not touch (an extension page, the Web Store, a PDF viewer): said as a sentence with its
  // way out, in every language, because the raw words ("Extension manifest must request permission") also read as a permission to grant.
  if (/Cannot access (contents of )?(the )?(url|page)|Extension manifest must request permission to access this host|The extensions gallery cannot be scripted/i.test(String(text))) return t('common.err.cannotScan');
  if (lang === 'en') return null;
  const hit = workerErrorKey(text);
  return hit ? fillHit(hit, t) : null;
}

/**
 * D-1010-140: a failure that reaches the screen, as a keyed sentence plus the raw detail for a tooltip.
 * UI side only (0 worker bytes): the browser's own words ("The user aborted a request.", a DOMException text)
 * never become visible text. `text` is the sentence in the tester's language; `title` is the raw message,
 * for the element's title attribute and nowhere else. A worker sentence this module knows is translated too.
 * `localizeError` above answers worker replies; this answers anything a `catch` holds.
 * @param {any} err
 * @param {(key: string, vars?: object) => string} t
 * @returns {{ text: string, title: string }}
 */
export function describeError(err, t) {
  const raw = typeof err === 'string' ? err : String(err?.message ?? err?.error ?? '');
  const code = err && typeof err === 'object' ? err.code : '';
  const name = err && typeof err === 'object' ? err.name : '';
  if (code === 'NO_FOLDER_API') return { text: t('common.err.noFolderApi'), title: raw };
  if (code === 'DEBUGGER_MISSING') return { text: t('common.err.debuggerMissing'), title: raw };
  if (name === 'AbortError') return { text: t('common.err.aborted'), title: raw };
  if (name === 'NotAllowedError') return { text: t('common.err.notAllowed'), title: raw };
  if (name === 'SecurityError') return { text: t('common.err.security'), title: raw };
  const hit = workerErrorKey(raw);
  if (hit) return { text: fillHit(hit, t), title: raw };
  return { text: t('common.err.unknown'), title: raw };
}

/**
 * An error never sends the tester to a tooltip (rule 10): the fix is a button. For a failure this module has no sentence for, the
 * button is "Copy details", which puts the raw message on the clipboard so it can be pasted into a bug report. Known sentences
 * name their own fix and get no button. `node` is the element that holds the sentence.
 * @param {HTMLElement} node @param {{ text: string, title: string }} d @param {(key: string, vars?: object) => string} t
 */
export function attachDetails(node, d, t) {
  node.removeAttribute('title');
  if (d.text !== t('common.err.unknown') || !d.title) return;
  const b = node.ownerDocument.createElement('button');
  b.type = 'button';
  b.className = 'status-fix';
  b.textContent = t('common.err.copyDetails');
  b.addEventListener('click', () => { node.ownerDocument.defaultView?.navigator.clipboard?.writeText(d.title).then(() => { b.textContent = t('common.err.detailsCopied'); }, () => {}); });
  node.append(' ', b);
}
