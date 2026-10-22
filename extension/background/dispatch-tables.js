/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tables the message seam consults, and nothing that acts on them.
 *
 * Six lookups keyed by message name — is this window allowed, which ability
 * does it need, what does it count as, how long may it take, what to say when
 * it overruns, and whose `tabId` means something else. They lived in
 * `background/service-worker.js` beside the code that reads them, which read
 * well and tested badly: a typo in a key is a silent no-op there, because a
 * message name that matches nothing simply never fires. Nothing imports them
 * but the worker, so this file exists to be *imported by a test* —
 * `tools/test-handlers.mjs` checks every key against the real handler list,
 * which is the only thing that can catch `UQA_COOKIE_PROIFLE_SAVE`.
 *
 * Data only. No chrome.* call, no import, nothing to run: that is what lets a
 * unit test load it in plain Node.
 */

/**
 * Every message gets an answer.
 *
 * A handler that hangs used to leave the port open until it closed itself, and
 * the caller saw only "the message port closed before a response was received" —
 * with no clue which call died or why. A timeout turns that silence into a
 * message the user can act on.
 */
export const HANDLER_TIMEOUT_MS = 10_000;

/**
 * Handlers that wait on a person (a picker, a share dialog) or on the network, and how long that may take.
 * The 10 s default answered "failed" while the capture was in fact starting, so the tester pressed again.
 * None exceeds 270 s: Chrome kills a pending reply at 300 s (D-1010-181).
 */
export const WAITS_FOR_A_PERSON = {
  UQA_RECORD_SCREEN: 270_000,
  // Stop scales with the clip (flushing a ten-minute recording outran 10 s and the failure text said "reload", which destroys the clip);
  // not "no deadline": a hung handler must still answer. No UQA_RECORD_START entry: a start is fast, and UQA_RECORD_SCREEN has its own.
  UQA_RECORD_STOP: 270_000,
  UQA_SOURCE_ENDED: 270_000,
  // Polled by the popup while it paints; a slow answer here is better than a
  // wrong one, and this is the message that reports a stop still in progress.
  UQA_RECORD_STATE: 60_000,
  UQA_RECORD_RESCUE: 270_000,
  UQA_COVERAGE_START: 60_000,
  UQA_CAPTURE_FULL: 2 * 60_000,
  // Not a person, but the network and a large page: the field test on a
  // 585-link portal hit the ten-second default and reported a broken tool.
  UQA_CHECK_LINKS: 3 * 60_000,
  UQA_HARVEST: 30_000,
  UQA_SCAN_A11Y: 60_000,
  UQA_AUTOFILL: 30_000,
  UQA_EXPORT: 60_000,
  UQA_JIRA_FILE: 2 * 60_000,
  UQA_JIRA_QUICK: 2 * 60_000,
  UQA_JIRA_SCAN: 2 * 60_000,
  UQA_JIRA_DUPES: 2 * 60_000,
  // fetchT waits 20 s by default and 60 s for an upload; the 10 s default answered "failed" while the issue was filed, and a retry duplicated it (council-1009 13-1).
  UQA_TRACKER_FILE: 2 * 60_000,
  UQA_NOTIFY: 2 * 60_000,
  UQA_NOTIFY_TEST: 2 * 60_000,
  UQA_SUITE_FILE: 270_000,
  // r2-01-1: network fetches; a 10 s failure answer while the send went through invited a duplicate.
  UQA_REPORTER_FILE: 2 * 60_000,
  UQA_JIRA_SYNC: 2 * 60_000,
  UQA_JIRA_TEST: 60_000,
  UQA_JIRA_PROJECTS: 60_000,
  UQA_JIRA_TYPES: 60_000,
  UQA_JIRA_TARGETS: 60_000,
  UQA_JIRA_LINK_TYPES: 60_000,
  UQA_TRACKER_TEST: 60_000,
  UQA_TRACKER_TARGETS: 60_000,
};

/** What a handler that overran its deadline should tell the tester to do. */
export const TIMEOUT_ADVICE = {
  UQA_RECORD_STOP: 'Still finishing the clip. Leave this open; it will appear in the report on its own.',
  UQA_SOURCE_ENDED: 'Still finishing the clip. Leave this open; it will appear in the report on its own.',
  UQA_RECORD_RESCUE: 'Still writing the clip out. Leave this open until the download appears.',
};

/**
 * Handlers where `tabId` does not mean "the page under test", so the hint
 * below must leave them alone.
 */
export const TAB_ID_MEANS_SOMETHING_ELSE = new Set(['UQA_COVERAGE_STOP']);

/**
 * Refuse anything aimed at a sleeping window.
 *
 * Applied at the seam rather than inside each feature: a capability that forgets
 * to check is a capability that runs while the extension is supposed to be
 * asleep, and that is exactly the failure this switch exists to make impossible.
 */
export const NEEDS_ARMING = new Set([
  // `UQA_PICK_OFF` is deliberately absent, and `UQA_PICK` is deliberately here:
  // starting a crosshair is a capability, ending one is how a tester gets their
  // page back, and a sleeping window must never refuse that. `UQA_DOCKED` is
  // absent for the same reason: it only closes the float the side panel has
  // just replaced, and refusing it on a sleeping window left both surfaces open.
  'UQA_START', 'UQA_PICK', 'UQA_FRAME_CHAIN', 'UQA_COPY_TEXT',
  'UQA_MASK_PICK', 'UQA_MASK_SET', 'UQA_MASK_GET', 'UQA_MASK_CLEAR',
  'UQA_CLEAR_MASKS',
  'UQA_INJECT', 'UQA_CAPTURE', 'UQA_CAPTURE_TAB',
  'UQA_SCAN_A11Y', 'UQA_SCAN_PERF', 'UQA_A11Y_RULES', 'UQA_TOGGLE_RTL',
  'UQA_RECORD_START', 'UQA_RECORD_SCREEN', 'UQA_CAPTURE_FULL',
  'UQA_ADD_RULE', 'UQA_SET_RULES', 'UQA_PARTITIONS', 'UQA_CLEAR_FIELD', 'UQA_COVERAGE_START',
  'UQA_OPEN_VIEWPORT', 'UQA_INJECT_VALUE',
  'UQA_HARVEST', 'UQA_CHECK_LINKS', 'UQA_AUTOFILL',
  'UQA_COOKIES', 'UQA_COOKIE_SET', 'UQA_COOKIE_DELETE', 'UQA_COOKIES_CLEAR',
  'UQA_COOKIES_IMPORT', 'UQA_COOKIES_EXPORT', 'UQA_COOKIE_PROFILE_SAVE',
  'UQA_COOKIE_PROFILE_RESTORE', 'UQA_WEBSTORAGE', 'UQA_WEBSTORAGE_SET',
  'UQA_WEBSTORAGE_DELETE', 'UQA_WEBSTORAGE_CLEAR', 'UQA_HIGHLIGHT',
  // A content script writes a session's replay through this one (T-010).
  'UQA_REPLAY_CHUNK',
]);

/**
 * Which tool each message counts as, for this session's usage log.
 *
 * One table beside the guard, for the same reason the guard is one table: a
 * capability that forgets to log is a capability the popup will report as
 * unused, and a tester who is told they have not checked accessibility when
 * they have will check it twice — or, worse, trust the tick next time.
 *
 * `record` and `rtl` are deliberately absent. Both are toggles, and both need
 * to log something the envelope cannot see — which sources went into the clip,
 * and whether the press turned stress *on* or off — so they log at the feature.
 */
export const COUNTS_AS = {
  UQA_CAPTURE: 'shot',
  UQA_CAPTURE_TAB: 'shot',
  UQA_CAPTURE_FULL: 'shot',
  UQA_PARTITIONS: 'blackbox',
  UQA_OPEN_VIEWPORT: 'viewport',
  UQA_CROSS_BROWSER: 'crossbrowser',
  UQA_DECISION_TABLE: 'blackbox',
  UQA_STATE_MODEL: 'blackbox',
  UQA_COVERAGE_STOP: 'whitebox',
  UQA_SCAN_A11Y: 'a11y',
  UQA_A11Y_RULES: 'a11y',
  UQA_A11Y_GUIDED_RESULT: 'a11y',
  UQA_SCAN_PERF: 'perf',
  UQA_HARVEST: 'harvest',
  UQA_CHECK_LINKS: 'links',
  UQA_READ_SPEC: 'spec',
  UQA_FINE_PRINT: 'fineprint',
  UQA_AUTOFILL: 'autofill',
  UQA_PICK: 'pick',
  UQA_MASK_PICK: 'mask',
  UQA_INJECT: 'inject',
  UQA_NOTE: 'note',
  UQA_MEDIA_SAVE_EDIT: 'markup',
  UQA_ADD_RULE: 'break',
  UQA_SET_RULES: 'break',
  UQA_COOKIES: 'storage',
  UQA_COOKIE_SET: 'storage',
  UQA_COOKIE_DELETE: 'storage',
  UQA_COOKIES_CLEAR: 'storage',
  UQA_COOKIES_IMPORT: 'storage',
  UQA_COOKIES_EXPORT: 'storage',
  UQA_COOKIE_PROFILE_SAVE: 'storage',
  UQA_COOKIE_PROFILE_RESTORE: 'storage',
  UQA_WEBSTORAGE: 'storage',
  UQA_WEBSTORAGE_SET: 'storage',
  UQA_WEBSTORAGE_DELETE: 'storage',
  UQA_WEBSTORAGE_CLEAR: 'storage',
  UQA_TEST_CASE: 'testcase',
  UQA_TEST_SUITE: 'testcase',
  UQA_SUITE_FILE: 'file',
  UQA_DEFECT: 'defect',
  UQA_JIRA_FILE: 'file',
  UQA_JIRA_QUICK: 'file',
  UQA_JIRA_QUICK_PLAN: 'file',
  UQA_JIRA_SYNC: 'file',
  UQA_TRACKER_FILE: 'file',
  UQA_NOTIFY: 'tell',
  UQA_EXPORT: 'export',
};

/**
 * Which workspace ability each message needs.
 *
 * Checked at the same seam as the master switch, for the same reason: an
 * ability enforced inside one feature protects one feature. Only the two that
 * are visible to other people are gated — recording and exporting are local and
 * nobody needs protecting from them.
 */
export const NEEDS_ABILITY = {
  UQA_JIRA_FILE: 'file',
  UQA_JIRA_QUICK: 'file',
  UQA_JIRA_QUICK_PLAN: 'file',
  UQA_JIRA_SCAN: 'file',
  UQA_JIRA_DUPES: 'file',
  UQA_SUITE_FILE: 'file',
  UQA_TRACKER_FILE: 'file',
  UQA_NOTIFY: 'notify',
  UQA_NOTIFY_TEST: 'notify',
  UQA_SET_SETTINGS: 'configure',
  UQA_RESET_SETTINGS: 'configure',
  UQA_ERASE_ALL: 'configure',
};

/**
 * The doors a web page can use to write into a session (T-042). `assertMayRecord`
 * runs in front of each; UQA_EVENT and UQA_REPLAY_CHUNK are listed so a new
 * door has to be added here on purpose, and both call it themselves.
 */
export const RECORDING_DOORS = new Set(['UQA_EVENT', 'UQA_NOTE', 'UQA_REPLAY_CHUNK', 'UQA_RULE_FIRED']);
