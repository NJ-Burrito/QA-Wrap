/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * The message table: every name it answers, and the tables the seam looks
 * those names up in.
 *
 *   node tools/test-handlers.mjs
 *
 * `background/service-worker.js` used to hold one object literal of 162
 * entries over 1530 lines. It is now seventeen named group objects spread
 * into one table, which reads better and, on its own, is a change nothing
 * could have caught going wrong. Two things could:
 *
 *   1. A message name is the wire between the worker and the popup, the side
 *      panel, the options page, the DevTools panel and the content scripts.
 *      Renaming one is silent: the sender goes on sending, the worker answers
 *      nothing, and it shows up as a dead button, in a browser, later. So the
 *      full list of 162 is frozen here. Adding a name means adding it here on
 *      purpose; changing one fails this suite.
 *   2. Spreading seventeen objects into one lets a name appear twice, and the
 *      last spread wins in silence - the same fault a single literal had,
 *      carried into the new shape. Checked below across every pair.
 *
 * The dispatch tables get the check that could not exist while they lived
 * inside the worker: a key that names no handler is dead weight at best and an
 * ungated capability at worst, and a typo looks like neither.
 *
 * Static where it has to be - the worker imports 36 modules and calls
 * `chrome.*` at load, so Node cannot import it - and live where it can be:
 * `background/dispatch-tables.js` is data with no imports, so it is loaded for
 * real, and `openOwnPage()` is lifted out of the worker and run against a stub.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift, endOfBlock } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';
import { featureOf } from '../platform/policy.js';
import {
  HANDLER_TIMEOUT_MS,
  WAITS_FOR_A_PERSON,
  TIMEOUT_ADVICE,
  TAB_ID_MEANS_SOMETHING_ELSE,
  NEEDS_ARMING,
  COUNTS_AS,
  NEEDS_ABILITY,
  RECORDING_DOORS,
} from '../background/dispatch-tables.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = workerSrc(); // the entry and the OF-18 modules, as one text
const lines = src.split('\n');

let passed = 0;
const failures = [];
const pending = [];

function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  ok  ${name}`);
      })
      .catch((err) => {
        failures.push([name, err]);
        console.log(`  FAIL  ${name}`);
        console.log(`        ${err.message}`);
      })
  );
}

/* ------------------------------------------------------------- the groups */

/**
 * Read the group objects out of the source.
 *
 * A group starts at `const <name>Handlers = {` in column 0 and ends at the
 * next `};` in column 0. Message names are the only keys at two spaces of
 * indent - handler bodies are indented further, so a `UQA_` string inside one
 * cannot be mistaken for a key.
 */
function readGroups() {
  const groups = [];
  let current = null;
  for (const line of lines) {
    const open = /^(?:export )?const (\w+Handlers) = \{$/.exec(line);
    if (open) {
      current = { name: open[1], keys: [] };
      continue;
    }
    if (!current) continue;
    if (line === '};') {
      groups.push(current);
      current = null;
      continue;
    }
    const key = /^  (UQA_[A-Z_0-9]+):/.exec(line);
    if (key) current.keys.push(key[1]);
  }
  // The table spreads the groups in this order; the modules hold them in file order.
  const spread = [...(/Object\.assign\(handlers, \{\n([\s\S]*?)\n\}\);/.exec(src)?.[1] || '').matchAll(/^\s*\.\.\.(\w+),$/gm)].map((m) => m[1]);
  return groups.sort((a, b) => spread.indexOf(a.name) - spread.indexOf(b.name));
}

const groups = readGroups();
const declared = groups.flatMap((g) => g.keys);

/**
 * Every message name the worker answered on 7 September 2026, in order.
 *
 * A record of the wire, not a wish. The senders that would break silently are
 * popup/popup.js, sidepanel/, options/options.js, devtools/panel.js,
 * report/report.js, replay/, annotate/, api/, reporter/ and content/bridge.js.
 */
const NAMES = [
  'UQA_PING', 'UQA_GET_STATE', 'UQA_POPUP_STATE', 'UQA_DOCKED',
  // `UQA_OVERLAY_ASSETS`, `UQA_BAR` and `UQA_OPEN_FLOAT` were added on 27
  // September 2026 by UI rework round 2 (S8, the in-page layer): the face and
  // strings for the page, the bar's on-demand injection, and its "Open QA Wrap".
  'UQA_DOCK', 'UQA_TARGET_TAB', 'UQA_START',
    'UQA_RENAME', 'UQA_KEEP', 'UQA_BRIDGE_SYNC', 'UQA_BUFFER_ON', 'UQA_STOP', 'UQA_OVERLAY_ASSETS', 'UQA_BAR', 'UQA_OPEN_FLOAT',
  'UQA_EVENT', 'UQA_API_RECORD', 'UQA_OPEN_API', 'UQA_NOTE',
  'UQA_SET_BREAKDOWN', 'UQA_CAPTURE', 'UQA_CAPTURE_FULL', 'UQA_SHOT_AUTO', 'UQA_SHOT_URL',
  'UQA_ROLL', 'UQA_RECORD_START',
  'UQA_RECORD_STOP', 'UQA_RECORD_RESCUE', 'UQA_RECORD_SCREEN', 'UQA_SOURCE_ENDED',
  'UQA_RECORD_STATE', 'UQA_CAN_RECORD', 'UQA_VIDEO_FORMATS', 'UQA_FILE_TYPES',
  'UQA_STORAGE', 'UQA_MEDIA_PERMISSIONS', 'UQA_OPEN_PERMISSIONS', 'UQA_OPEN_SITE_SETTINGS',
  'UQA_MEDIA_AUDIO', 'UQA_MEDIA_LIST', 'UQA_MEDIA_BLOB', 'UQA_MEDIA_DELETE',
  'UQA_MEDIA_MARK', 'UQA_MEDIA_PROVENANCE', 'UQA_PROVENANCE', 'UQA_VERIFY',
  // `UQA_OPEN_VIDEOEDIT` arrived on 17 September 2026 (dc051d0, "A recording can
  // be edited where it is read") without a line here, which kept this suite red
  // until S8 had to touch the list anyway; recorded now, as the real wire.
  'UQA_MEDIA_META', 'UQA_MEDIA_SAVE_EDIT', 'UQA_OPEN_ANNOTATE', 'UQA_OPEN_VIDEOEDIT', 'UQA_LIST_SESSIONS',
  'UQA_GET_TIMELINE', 'UQA_GET_CAPTURE', 'UQA_DELETE_SESSION', 'UQA_EXPORT',
  'UQA_DIAGRAM_SAVE', 'UQA_EXPORT_SAVED', 'UQA_PICK',
  // The three the picker gained on 7 September 2026, when it had to work
  // inside a cross-origin iframe. All three exist because a frame behind an
  // origin boundary cannot see its own <iframe>, cannot reach the clipboard,
  // and cannot hear Escape pressed in another frame; only the worker can.
  'UQA_PICK_OFF', 'UQA_FRAME_CHAIN', 'UQA_COPY_TEXT', 'UQA_MASK_PICK',
  // `UQA_CLEAR_MASKS` was added on 7 September 2026 for decision 6 of
  // research/56: uncover one tab and let the session keep the list. It is
  // not UQA_MASK_CLEAR, which empties the list for every tab.
  'UQA_MASK_SET', 'UQA_MASK_GET', 'UQA_PURGE_NOW', 'UQA_MASK_CLEAR',
  'UQA_CLEAR_MASKS', 'UQA_INJECT', 'UQA_GET_SETTINGS', 'UQA_SET_SETTINGS',
  'UQA_VAULT_STATE', 'UQA_VAULT_PASS', 'UQA_VAULT_UNLOCK', 'UQA_VAULT_LOCK', 'UQA_VAULT_FORGET', 'UQA_RESET_SETTINGS',
  'UQA_ERASE_ALL', 'UQA_SESSION_FOOTPRINT', 'UQA_COMMANDS', 'UQA_OPEN_SHORTCUTS',
  'UQA_OPEN_REPORT', 'UQA_OPEN_OPTIONS', 'UQA_GET_RULES', 'UQA_SET_RULES',
  'UQA_ADD_RULE', 'UQA_DROP_RULE', 'UQA_RULE_FIRED', 'UQA_SESSION_STATE',
  // Five names added on 8 September 2026 with decision 8 of research/56, which
  // moved `<all_urls>` out of `host_permissions`. Two are about where this
  // extension has been let in — `UQA_SITE_ACCESS` is what the popup reads
  // *before* the Wake press, because `chrome.permissions.request` may not be
  // preceded by an await, and `UQA_SITE_GRANTED` is what puts the page scripts
  // into the tab the tester is already looking at. Three are the first-run
  // consent gate the store requires inside the product (research/51d §1): read
  // it, accept it, and open it again from Settings.
  'UQA_USED', 'UQA_ARMED',
  'UQA_SITE_ACCESS', 'UQA_SITE_GRANTED', 'UQA_CONSENT', 'UQA_CONSENT_ACCEPT', 'UQA_OPEN_WELCOME',
  'UQA_ARM', 'UQA_DISARM',
  'UQA_DISARM_ALL', 'UQA_SCAN_A11Y', 'UQA_A11Y_RULES', 'UQA_A11Y_GUIDED',
  'UQA_A11Y_GUIDED_RESULT', 'UQA_HIGHLIGHT', 'UQA_SCAN_PERF', 'UQA_HARVEST',
  'UQA_READ_SPEC', 'UQA_FINE_PRINT', 'UQA_REPORTER_CONTEXT', 'UQA_REPORTER_FILE',
  'UQA_OPEN_REPORTER', 'UQA_CHECK_LINKS', 'UQA_AUTOFILL', 'UQA_MENU_STATE',
  'UQA_REPLAY_CHUNK', 'UQA_REPLAY_GET', 'UQA_REPLAY_INFO', 'UQA_REPLAY_DELETE',
  'UQA_OPEN_REPLAY', 'UQA_COOKIES', 'UQA_COOKIE_SET', 'UQA_COOKIE_DELETE',
  'UQA_COOKIES_CLEAR', 'UQA_COOKIES_IMPORT', 'UQA_COOKIES_EXPORT', 'UQA_COOKIE_FORMATS',
  'UQA_COOKIE_DETECT', 'UQA_COOKIE_PROFILES', 'UQA_COOKIE_PROFILE_SAVE', 'UQA_COOKIE_PROFILE_RESTORE',
  'UQA_COOKIE_PROFILE_DELETE', 'UQA_WEBSTORAGE', 'UQA_WEBSTORAGE_SET', 'UQA_WEBSTORAGE_DELETE',
  'UQA_WEBSTORAGE_CLEAR', 'UQA_TEST_CASE',
  'UQA_DEFECT', 'UQA_ISTQB_VOCAB', 'UQA_TEST_SUITE', 'UQA_SUITE_RELATE',
  'UQA_SUITE_FILE', 'UQA_ISTQB_MODEL', 'UQA_CAPABILITIES', 'UQA_WORKSPACE',
  'UQA_WORKSPACE_EXPORT', 'UQA_WORKSPACE_PREVIEW', 'UQA_WORKSPACE_JOIN', 'UQA_WORKSPACE_LEAVE',
  // `UQA_CLEAR_FIELD` was added on 7 September 2026: the listener already
  // existed in content/data-injector.js and had no route, so the popup rode
  // UQA_PARTITIONS with a sentinel selector. Both sentinels are gone.
  'UQA_COVERAGE', 'UQA_INJECT_VALUE', 'UQA_PARTITIONS', 'UQA_CLEAR_FIELD', 'UQA_DECISION_TABLE',
  'UQA_STATE_MODEL', 'UQA_COVERAGE_PERMISSION', 'UQA_COVERAGE_REQUEST', 'UQA_COVERAGE_DROP',
  'UQA_COVERAGE_START', 'UQA_COVERAGE_STOP', 'UQA_JIRA_TEST', 'UQA_JIRA_PROJECTS',
  'UQA_JIRA_TYPES', 'UQA_JIRA_TARGETS', 'UQA_JIRA_LINK_TYPES', 'UQA_JIRA_FILE',
  'UQA_JIRA_QUICK', 'UQA_JIRA_SCAN', 'UQA_JIRA_DUPES', 'UQA_JIRA_QUICK_PLAN', 'UQA_JIRA_DRAFT', 'UQA_JIRA_CONFIGURED',
  'UQA_JIRA_SYNC', 'UQA_FILED', 'UQA_TRACKERS', 'UQA_TRACKER_STATE',
  'UQA_TRACKER_TEST', 'UQA_TRACKER_TARGETS', 'UQA_TRACKER_FILE', 'UQA_NOTIFY', 'UQA_SCAN',
  'UQA_NOTIFY_PROVIDERS', 'UQA_NOTIFY_TEST', 'UQA_POSTMAN_SUMMARY', 'UQA_VIEWPORTS',
  // `UQA_VIEWPORT_RUNS` was added on 7 September 2026 with the window-size
  // work (brief G8, contract research/55 §8). It is a fold over the two
  // `viewport` events, added deliberately and named here for that reason.
  // `UQA_RESTORE_WINDOW_SIZE` was added on 8 September 2026 with the
  // resize-in-place route (research/55 §11). A run that resized the tester's
  // own window has no window to close, so without this the only ways out were
  // to stop the session or to pick another size.
  'UQA_OPEN_VIEWPORT', 'UQA_RESTORE_WINDOW_SIZE', 'UQA_VIEWPORT_RUNS', 'UQA_CROSS_BROWSER',
  'UQA_TICKET_TITLE', 'UQA_CAPTURE_TAB',
  'UQA_TOGGLE_RTL', 'UQA_RTL_STATE',
];

test('the worker still answers all 191 message names, in the same order', () => {
  assert.equal(NAMES.length, 191);
  assert.deepEqual(declared, NAMES);
});

test('no message name is declared by two groups', () => {
  const seen = new Map();
  const clashes = [];
  for (const g of groups) {
    for (const k of g.keys) {
      if (seen.has(k)) clashes.push(`${k} in both ${seen.get(k)} and ${g.name}`);
      else seen.set(k, g.name);
    }
  }
  assert.deepEqual(clashes, [], `a spread would silently drop one of these: ${clashes.join('; ')}`);
});

test('the table is assembled from every group, and from nothing else', () => {
  const block = /Object\.assign\(handlers, \{\n([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(block, 'the composed handlers table is gone');
  const spread = [...block[1].matchAll(/^\s*\.\.\.(\w+),$/gm)].map((m) => m[1]);
  assert.deepEqual(
    spread,
    groups.map((g) => g.name)
  );
});

test('every group holds at least one message, so none was emptied by accident', () => {
  assert.deepEqual(
    groups.filter((g) => g.keys.length === 0).map((g) => g.name),
    []
  );
});

/* ----------------------------------------------------- the dispatch tables */

const known = new Set(NAMES);
const strays = (keys) => [...keys].filter((k) => !known.has(k));

test('every message NEEDS_ARMING gates is a message that exists', () => {
  assert.deepEqual(strays(NEEDS_ARMING), []);
});

test('every message COUNTS_AS logs is a message that exists', () => {
  assert.deepEqual(strays(Object.keys(COUNTS_AS)), []);
});

test('every message NEEDS_ABILITY gates is a message that exists', () => {
  assert.deepEqual(strays(Object.keys(NEEDS_ABILITY)), []);
});

test('every message given a deadline of its own is a message that exists', () => {
  assert.deepEqual(strays(Object.keys(WAITS_FOR_A_PERSON)), []);
});

test('every message with timeout advice also has a deadline of its own', () => {
  assert.deepEqual(strays(Object.keys(TIMEOUT_ADVICE)), []);
  assert.deepEqual(
    Object.keys(TIMEOUT_ADVICE).filter((k) => !WAITS_FOR_A_PERSON[k]),
    [],
    'advice on a handler that keeps the 10s default is advice nobody reads'
  );
});

test('the one message whose tabId means something else exists', () => {
  assert.deepEqual(strays(TAB_ID_MEANS_SOMETHING_ELSE), []);
});

test('the tables came across the move whole', () => {
  // 40 since UQA_CLEAR_FIELD joined on 7 September 2026: it reaches into a
  // page, so it is gated like every other message that does. 43 since
  // UQA_FRAME_CHAIN and UQA_COPY_TEXT joined it the same day, for the same
  // reason: both are the locator picker reaching into a page it is standing in.
  // 42 since UQA_DOCKED left it on 29 September 2026: it only closes the float
  // the side panel replaced, and refusing it on a sleeping window left both open.
  // 43 since UQA_REPLAY_CHUNK joined it (T-010).
  assert.equal(NEEDS_ARMING.size, 43);
  assert.equal(Object.keys(COUNTS_AS).length, 48); // 47 + UQA_MEDIA_SAVE_EDIT: 'markup' (Bug Hunt signal qawMarks, 12 Oct 2026)
  assert.equal(Object.keys(NEEDS_ABILITY).length, 12);
  assert.equal(Object.keys(WAITS_FOR_A_PERSON).length, 29); // 20 + UQA_REPORTER_FILE, UQA_JIRA_SYNC and the seven read-only integration fetches (r2-01-1); 16 + the five network filers of council-1009 13-1, less the dead Slack post (r4-03-5)
  assert.equal(Object.keys(TIMEOUT_ADVICE).length, 3);
  assert.equal(TAB_ID_MEANS_SOMETHING_ELSE.size, 1);
  assert.equal(HANDLER_TIMEOUT_MS, 10_000);
  // The three that were bought with a real failure, spot-checked by value.
  assert.equal(WAITS_FOR_A_PERSON.UQA_RECORD_STOP, 270_000);
  assert.equal(WAITS_FOR_A_PERSON.UQA_CHECK_LINKS, 3 * 60_000);
  assert.equal(NEEDS_ABILITY.UQA_ERASE_ALL, 'configure');
});

test('every handler that files or notifies over the network waits longer than the 10 s default (13-1)', () => {
  // fetchT waits 20 s by default (core/egress.js TIMEOUT_MS) and 60 s for uploads, so a handler
  // fronting a module that calls it cannot keep the 10 s deadline. The modules that call it are pinned
  // here: a new one is red until its handlers are decided.
  const callers = fs.readdirSync(path.join(EXT, 'background')).filter((f) => f.endsWith('.js') && fs.readFileSync(path.join(EXT, 'background', f), 'utf8').includes('fetchT(')).sort();
  assert.deepEqual(callers, ['jira.js', 'notify.js', 'trackers.js']);
  const NO_NETWORK = new Set(['UQA_JIRA_QUICK_PLAN']); // builds a plan, files nothing [A: falsified if quickFilePlan gains a fetch]
  const missing = Object.entries(NEEDS_ABILITY)
    .filter(([type, ability]) => (ability === 'file' || ability === 'notify') && !NO_NETWORK.has(type))
    .filter(([type]) => !(WAITS_FOR_A_PERSON[type] >= 20_000))
    .map(([type]) => type);
  assert.deepEqual(missing, [], 'these keep the 10 s default but front a 20 s+ fetch');
});

test('every integrations handler and the reporter send wait 60 s or more (r2-01-1)', () => {
  const types = [...src.matchAll(/^  (UQA_[A-Z_]+):/gm)].map((m) => m[1]);
  const fronts = types.filter((t) => featureOf(t) === 'integrations' || t === 'UQA_REPORTER_FILE');
  assert.ok(fronts.includes('UQA_REPORTER_FILE') && fronts.includes('UQA_JIRA_SYNC') && fronts.length >= 12, `found ${fronts.length}`);
  const short = fronts.filter((t) => !(WAITS_FOR_A_PERSON[t] >= 60_000));
  assert.deepEqual(short, [], 'these front a network fetch but keep the 10 s default');
});

test('the worker reads the tables from the module and keeps no copy', () => {
  assert.ok(/from '\.\/dispatch-tables\.js'/.test(src), 'the worker no longer imports the dispatch tables');
  for (const name of ['NEEDS_ARMING', 'COUNTS_AS', 'NEEDS_ABILITY', 'WAITS_FOR_A_PERSON', 'TIMEOUT_ADVICE']) {
    assert.ok(
      !new RegExp(`^const ${name} =`, 'm').test(src),
      `${name} is declared in the worker as well as in dispatch-tables.js`
    );
  }
});

/* ---------------------------------------------------------- openOwnPage() */

/** Run the real `openOwnPage` from the worker against a stubbed chrome. */
async function runOpenOwnPage(packed) {
  const created = [];
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
    tabs: {
      create: async (opts) => {
        created.push(opts);
        return { id: 77 };
      },
    },
  };
  // `lift` finds the declaration at the `function` keyword, so an `async`
  // prefix is left behind and the lifted body would reject on its own `await`.
  assert.ok(/async function openOwnPage\(/.test(src), 'openOwnPage is no longer async');
  const fn = new Function('chrome', `async ${lift(src, 'openOwnPage')}\nreturn openOwnPage;`)(chrome);
  return { result: await fn(packed), created };
}

test('openOwnPage resolves the packed path and opens exactly one tab on it', async () => {
  const { result, created } = await runOpenOwnPage('report/report.html?session=abc');
  assert.deepEqual(created, [{ url: 'chrome-extension://abc/report/report.html?session=abc' }]);
  assert.deepEqual(result, { tabId: 77, url: 'chrome-extension://abc/report/report.html?session=abc' });
});

test('the five pages that open in a tab all go through it', () => {
  for (const name of ['UQA_OPEN_API', 'UQA_OPEN_ANNOTATE', 'UQA_OPEN_REPORT', 'UQA_OPEN_REPORTER', 'UQA_OPEN_REPLAY']) {
    const at = src.indexOf(`  ${name}: `);
    assert.ok(at !== -1, `${name} is gone`);
    const body = src.slice(at, src.indexOf('\n  },', at));
    assert.ok(body.includes('openOwnPage('), `${name} no longer uses openOwnPage()`);
    assert.ok(!body.includes('chrome.tabs.create'), `${name} builds its own tab again`);
  }
});

test('nothing else in the message table opens a tab by hand without a reason', () => {
  const region = ['handlers-session.js', 'handlers-tools.js', 'handlers-app.js'].map((f) => fs.readFileSync(path.join(EXT, 'background', f), 'utf8')).join('\n');
  const sites = [...region.matchAll(/chrome\.tabs\.create\(([\s\S]{0,90})/g)].map((m) => m[1]);
  // Three survivors, each deliberate: the options page reuses a tab it already
  // found, the site-settings tab is opened with extra properties, and
  // chrome://extensions/shortcuts is the browser's page and not one of ours.
  assert.equal(sites.length, 3, `unexpected tab opening in the message table:\n${sites.join('\n---\n')}`);
  assert.ok(sites.some((s) => s.includes('chrome://extensions/shortcuts')));
});

/* T-010: every content-script type that writes into a session is gated, derived from the two tables. */
const handlerBody = (name) => {
  const m = new RegExp(`^  ${name}: ([^\n]*)`, 'm').exec(src);
  if (!m) return '';
  const from = m.index + m[0].length - m[1].length;
  if (!m[1].trimEnd().endsWith('{')) return m[1];
  return src.slice(from, endOfBlock(src, m.index + m[0].length - 1) + 1);
};
const contentTypes = [...src.match(/const CONTENT_SCRIPT_TYPES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'(UQA_\w+)'/g)].map((m) => m[1]);
// A handler that reaches `ingest()` inherits its two guards; the other page write doors are
// RECORDING_DOORS, which guardSender runs through assertMayRecord (T-042).
const WRITES = /(ingest|putReplayChunk|appendEvent|addNote)\(/;
test('every content-script type that writes to a session is in NEEDS_ARMING or goes through ingest()', () => {
  const open = contentTypes.filter((t) => WRITES.test(handlerBody(t)) && !NEEDS_ARMING.has(t) && !RECORDING_DOORS.has(t) && !/ingest\(/.test(handlerBody(t)));
  assert.deepEqual(open, []);
});

test('the replay chunk handler refuses a sleeping tab and a foreign tab, and accepts the armed one', async () => {
  const body = handlerBody('UQA_REPLAY_CHUNK');
  assert.match(body, /armed\.assertMayRecord/);
  assert.match(body, /belongsToSession/);
  const run = async (isArmed, belongs) => {
    const stored = [];
    const handler = new Function('activeSessionId', 'armed', 'belongsToSession', 'putReplayChunk', 'policy',
      `return ${body}`)(
      async () => 's1', { assertMayRecord: async (_s, { belongs: b }) => {
        const no = (reason) => { throw Object.assign(new Error(reason), { reason }); };
        if (!isArmed) no('asleep');
        if (!(await b(7))) no('other-tab');
      } }, async () => belongs,
      async (c) => { stored.push(c); return { chunks: 1 }; }, async () => ({}));
    const res = await handler({ entries: [{ t: 1 }] }, { tab: { id: 7 } });
    return { res, stored };
  };
  const sleeping = await run(false, true);
  assert.equal(sleeping.res.reason, 'asleep');
  assert.equal(sleeping.stored.length, 0);
  const foreign = await run(true, false);
  assert.equal(foreign.res.reason, 'other-tab');
  assert.equal(foreign.stored.length, 0);
  const ok = await run(true, true);
  assert.equal(ok.stored.length, 1);
  assert.equal(ok.res.recording, true);
});

/* ------------------------------------------------- D-1010-181 / D-1010-172 */

test('D-1010-181: every deadline is below Chrome\'s 5-minute kill (270 s at most)', () => {
  const over = Object.entries(WAITS_FOR_A_PERSON).filter(([, ms]) => !(ms <= 270_000) || !(ms < 300_000));
  assert.deepEqual(over, []);
});

test('D-1010-181: constructor, toString and valueOf are unknown message types, in the seam and in the right-click menu', () => {
  const seam = /const handler = (Object\.hasOwn\(handlers, incoming\?\.type\) \? handlers\[incoming\.type\] : undefined);/.exec(src);
  assert.ok(seam, 'the seam looks the type up by own property');
  const menu = /const handler = (Object\.hasOwn\(handlers, tool\.send\) \? handlers\[tool\.send\] : undefined);/.exec(
    fs.readFileSync(path.join(EXT, 'background', 'context-menus.js'), 'utf8'));
  assert.ok(menu, 'the menu looks the tool up by own property');
  const handlers = { UQA_PING: () => 'pong' };
  for (const type of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', undefined]) {
    assert.equal(new Function('handlers', 'incoming', `return ${seam[1]}`)(handlers, { type }), undefined, `seam: ${String(type)}`);
    assert.equal(new Function('handlers', 'tool', `return ${menu[1]}`)(handlers, { send: type }), undefined, `menu: ${String(type)}`);
  }
  assert.equal(new Function('handlers', 'incoming', `return ${seam[1]}`)(handlers, { type: 'UQA_PING' })(), 'pong');
});

test('D-1010-172: a refused site is an error with code NOT_ALLOWED (both throw sites), and the toast says a phrase, not the slug', async () => {
  const site = await import('../background/site-access.js');
  const err = site.notAllowedError();
  assert.equal(err.code, 'NOT_ALLOWED');
  assert.equal(err.message, site.NOT_ALLOWED);
  assert.equal((src.match(/throw site\.notAllowedError\(\);/g) || []).length, 2);
  assert.doesNotMatch(src, /new Error\(site\.NOT_ALLOWED\)/);
  assert.match(lift(src, 'commandLabel'), /common\.worker\.command\.\$\{camel\}/, 'the command toast builds a label from common.worker.command.<camel>');
  assert.doesNotMatch(src, /\.replace\('\{command\}', command\)/, 'the raw slug is no longer substituted');
});

test('D-1010-172 (ar): no Latin command slug and no English refusal reach the Arabic toast', async () => {
  const ar = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'ar.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'en.json'), 'utf8'));
  const labelFor = (command, cat) => new Function('tw', `async ${lift(src, 'commandLabel')}; return commandLabel;`)(async (k, f) => cat[k] || f)(command);
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  for (const command of [...Object.keys(manifest.commands), 'a-command-from-the-future']) {
    const text = await labelFor(command, ar);
    assert.ok(/[\u0600-\u06FF]/.test(text) && !/[A-Za-z]/.test(text), `${command} -> ${text}`);
    assert.notEqual(text, command);
    assert.ok(en[`common.worker.command.${command.replace(/^_/, '').replace(/[-_](.)/g, (_m, c) => c.toUpperCase())}`] || /future/.test(command), `${command} has an English phrase`);
  }
  const refusal = ar['popup.refusal.notAllowed'];
  assert.ok(refusal && refusal !== en['popup.refusal.notAllowed'], 'popup.refusal.notAllowed is translated');
  assert.ok(/[\u0600-\u06FF]/.test(refusal) && !/[A-Za-z]/.test(refusal.replace(/QA Wrap/g, '')), refusal);
});

test('r10-07-4: UQA_POPUP_STATE answers inside 500 ms when the armed-window part never settles', async () => {
  const { withDeadline } = await import('../platform/deadline.js');
  const at = src.indexOf('UQA_POPUP_STATE: async (msg, sender) => {');
  const open = src.indexOf('{', src.indexOf('=>', at));
  const body = src.slice(open, endOfBlock(src, open) + 1);
  assert.match(body, /soft\(armed\.isArmedWindow\(windowId\), false, 400\)/, 'the armed part waits 400 ms like its neighbours');
  const never = () => new Promise(() => {});
  const run = new Function('bounded', 'handlers', 'testableTabId', 'currentWindowId', 'chrome', 'sendToTab', 'getRules', 'recordingState', 'storageHeadroom', 'armed', 'activeSessionId', 'sessionState', `return async (msg, sender) => ${body};`)(
    withDeadline, { UQA_GET_STATE: async () => ({ recording: false }) }, async () => 1, async () => 1,
    { tabs: { get: async () => ({ windowId: 7 }) } }, async () => null, async () => [], async () => ({ recording: false }), async () => null,
    { isArmedWindow: never }, async () => null, { getUsed: async () => ({}) });
  const warn = console.warn; console.warn = () => {};
  const t0 = Date.now();
  let out;
  try { out = await run({}, {}); } finally { console.warn = warn; }
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  assert.deepEqual(out.armed, { windowId: 7, armed: false }, 'the part falls back, the paint goes on');
});

test('H1: UQA_GET_RULES answers the rules to an extension page in a window that is not woken (the float), and still hides them from an unarmed page', async () => {
  const at = src.indexOf('UQA_GET_RULES: async (msg, sender) => {');
  const open = src.indexOf('{', src.indexOf('=>', at));
  const body = src.slice(open, endOfBlock(src, open) + 1);
  const run = new Function('isExtensionPage', 'armed', 'getRules', 'hintFor', `return async (msg, sender) => ${body};`)(
    (s) => String(s?.url).startsWith('chrome-extension://x/'), { isArmedTab: async () => false }, async () => [{ id: 'r1' }], () => null);
  assert.deepEqual(await run({}, { id: 'x', url: 'chrome-extension://x/popup/popup.html', tab: { id: 5 } }), [{ id: 'r1' }], 'the float panel sees the live rules');
  assert.deepEqual(await run({}, { id: 'x', url: 'https://site.test/', tab: { id: 6 } }), [], 'a content script on an unarmed tab still sees none');
});

/* ------------------------------------------------------------------ report */

await Promise.all(pending);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
