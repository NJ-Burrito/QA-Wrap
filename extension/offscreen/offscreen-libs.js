/* QA Wrap — offscreen document: lazily loaded export libraries and their message handlers (split from offscreen.js). */
import { stampDocument, withSha256 } from '../core/provenance-stamp.js';
import { captureHashes } from '../core/integrity.js';

/* ── messaging ─────────────────────────────────────────────────────────── */

/**
 * Filing, moved here from the worker for one reason: `import()`.
 *
 * `background/trackers.js` is 23 KB of adapters that matter for a few seconds,
 * twice a week, when somebody presses File. In the service worker it was parsed
 * on **every cold start** instead, because a worker's module graph must be
 * knowable at registration and `import()` throws there
 * (`tools/test-worker-imports.mjs` has the whole finding). This document is an
 * ordinary page, so it can load the adapters at the moment they are needed and
 * never before.
 *
 * Nothing else moved. The credentials are still read by the worker from
 * `chrome.storage` and passed in; the egress rule is still the adapter's own,
 * asserted in `tools/test-trackers.mjs`; the public message names the popup and
 * the report use are untouched. This page only owns the load.
 */
/**
 * Every document the product hands over is built here, for the same reason.
 *
 * `background/export-build.js` reaches for twenty modules — the exporters, the
 * ISO 29119 documents, the workbooks, the flow diagram — and none of them is
 * needed to record a session. In the worker they were parsed on every cold
 * start; here they are loaded the moment somebody presses Export and never
 * before. The module reads IndexedDB itself rather than having megabytes of
 * screenshots passed to it field by field.
 */
/**
 * Jira, loaded when somebody files and never before.
 *
 * Nineteen KB of client that the service worker parsed on every cold start.
 * `background/jira-door.js` keeps the worker's call sites reading as they did;
 * this is where the calls actually land.
 *
 * `fileIssue` and `fileSuite` are the ones that could not be simple forwards:
 * the evidence (screenshots out of IndexedDB, the text exports) is built here,
 * next to the database and the builder, and handed to them as `io.buildFiles`.
 * A Blob does not survive `chrome.runtime.sendMessage`.
 */
let jiraMod = null;
const jiraLib = async () => (jiraMod ||= await import('../background/jira.js'));
let dbMod = null;
const dbLib = async () => (dbMod ||= await import('../core/db.js'));

/**
 * The evidence set, read once and shared by every tracker.
 *
 * Split out on 8 September 2026 so that Jira and the
 * other trackers cannot attach two different things. Shortcut and YouTrack grew
 * an `attach()` of their own in `background/trackers.js`, and a second copy of
 * "which screenshots count, in what order, named how" is exactly the kind of
 * near-duplicate that drifts and is only noticed on a ticket somebody else is
 * reading.
 *
 * `failed` comes back beside the files rather than thrown: an export format
 * that could not be built is worth reporting on the ticket's result, and it is
 * not a reason to file nothing.
 */
async function sessionFiles(sessionId, attach) {
  const [db, exp] = await Promise.all([dbLib(), exportLib()]);
  const files = [];
  const failed = [];

  if (attach.screenshots) {
    const images = (await db.listMedia(sessionId)).filter((m) => String(m.type || '').startsWith('image/'));
    for (const m of images.slice(0, 30)) {
      const rec = await db.getMedia(m.id).catch(() => null);
      if (!rec?.blob) continue;
      const ext = (rec.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const base = String(rec.label || rec.name || `screenshot-${m.id}`).replace(/[^\w.-]+/g, '-').slice(0, 60);
      files.push({ filename: /\.\w{3,4}$/.test(base) ? base : `${base}.${ext}`, blob: rec.blob });
    }
  }

  for (const format of attach.formats || []) {
    try {
      // Raw, never gzipped: an attachment is opened by a person in a browser,
      // and a `.json.gz` on a ticket is a file nobody clicks.
      const out = await exp.buildExport({ sessionId, format, withImages: false, version: attach.version });
      files.push({ filename: out.filename, blob: new Blob([out.content], { type: out.mime }) });
    } catch (err) {
      failed.push({ name: format, ok: false, error: err.message });
    }
  }

  return { files, failed };
}

let renderMod = null;
const renderLib = async () => (renderMod ||= await import('../core/istqb-render.js'));

async function offRender({ fn, args = [] }) {
  const lib = await renderLib();
  if (typeof lib[fn] !== 'function') throw new Error(`istqb-render has no ${fn}()`);
  return lib[fn](...args);
}

/**
 * Postman, behind the same door, and for one caller.
 *
 * `core/postman.js` is 13 KB and the offscreen document has always loaded it,
 * through `background/export-build.js`, to write the collection and the
 * environment. The service worker loaded it as well — for `summarisePostman()`
 * alone, the one function that answers "how many requests would this export
 * contain" before the export is made — and because `summarisePostman()` builds
 * the whole collection to count it, none of the module could be split away.
 *
 * So the count is made where the collection is already made. 13 KB left the
 * worker's boot graph on 8 September 2026 to pay for `background/site-access.js`,
 * which is the module the optional-host-permission work needed there instead.
 */
let postmanMod = null;
const postmanLib = async () => (postmanMod ||= await import('../core/postman.js'));

async function offPostman({ fn, args = [] }) {
  const lib = await postmanLib();
  if (typeof lib[fn] !== 'function') throw new Error(`postman has no ${fn}()`);
  return lib[fn](...args);
}

/**
 * Three more pure modules behind the door: black-box design, the suite builder
 * and the cross-browser project. ~47 KB left the worker's boot graph with them.
 * `fn` may name a constant (VIEWPORTS, RUN_COMMAND) as well as a function.
 */
const pureMods = {};
const pureLoaders = {
  blackbox: () => import('../core/blackbox.js'),
  suite: () => import('../core/suite.js'),
  crossbrowser: () => import('../core/crossbrowser.js'),
  scan: () => import('../core/secret-scan-text.js'),
  problems: () => import('../core/finding-count.js'),
};
const pureAlias = { relations: 'RELATIONS', viewports: 'VIEWPORTS', runCommand: 'RUN_COMMAND' };

async function offPure(name, { fn, args = [] }) {
  const lib = (pureMods[name] ||= await pureLoaders[name]());
  const key = pureAlias[fn] || fn;
  if (!(key in lib)) throw new Error(`${name} has no ${fn}()`);
  if (name === 'blackbox' && fn === 'decisionTable' && args[1] && typeof args[1] === 'object') {
    // A function cannot cross the channel: the outcomes arrive as a map keyed by the rule's bit pattern.
    const map = args[1];
    args = [args[0], (assignment) => map[Object.values(assignment).map((v) => (v ? 1 : 0)).join('')] ?? null];
  }
  if (name === 'blackbox' && fn === 'decisionTable' && args[1] == null) args = [args[0]];
  return typeof lib[key] === 'function' ? lib[key](...args) : lib[key];
}

let cookieFmtMod = null;
async function offCookieFmt({ fn, args = [] }) {
  const lib = (cookieFmtMod ||= await import('../core/cookie-formats.js'));
  if (!(fn in lib)) throw new Error(`cookie-formats has no ${fn}`);
  return typeof lib[fn] === 'function' ? lib[fn](...args) : lib[fn];
}

async function offJira({ fn, args = [] }) {
  // The filing paths are handed the file builder: evidence is built where the data lives.
  if (fn === 'fileIssue' || fn === 'fileSuite') {
    return (await jiraLib())[fn](args[0], args[1], { buildFiles: (attach) => sessionFiles(args[1].sessionId, attach) });
  }
  if (fn === 'poll') return (await import('../core/jira-notifier.js')).poll(...args); // the Jira helper's notifications, off the worker's boot graph
  const lib = await jiraLib();
  if (typeof lib[fn] !== 'function') throw new Error(`Jira has no ${fn}()`);
  return lib[fn](...args);
}

let exportMod = null;
const exportLib = async () => (exportMod ||= await import('../background/export-build.js'));

/**
 * The ticket draft, the Playwright spec, the title and the repro steps (T-075 bytes).
 *
 * `core/artifact.js`, `core/formats.js` and `core/jira-templates.js` left the
 * worker's boot graph for this: they load here on demand, and the events are
 * read from IndexedDB here, so only the session id crosses the message. The
 * worker flushes its write queue before it asks. Exported for the Node test,
 * which hands it the same fixture the core functions get directly.
 *
 * @param {{ fn: string, args?: any }} request
 * @param {{ db?: any, libs?: any[] }} [deps]
 */
export async function offDraft({ fn, args = {} }, deps = {}) {
  const db = deps.db || await dbLib();
  const [art, fmt, jt, ev] = deps.libs || await Promise.all([
    import('../core/artifact.js'), import('../core/formats.js'), import('../core/jira-templates.js'), import('../core/events.js'),
  ]);
  if (fn === 'pickIssueType') return jt.pickIssueType(args.kind, args.types) ?? null;
  const session = await db.getSession(args.sessionId);
  if (!session) {
    if (fn === 'ticketTitle') return null;
    throw new Error(`Unknown session ${args.sessionId}`);
  }
  const events = await db.getEvents(args.sessionId);
  switch (fn) {
    case 'playwrightSpec': return art.buildPlaywrightSpec(session, events);
    case 'ticketTitle': return fmt.title(session, events);
    case 'draftIssue': return jt.draft(args.kind, session, args.problemsOnly ? ev.problemEvents(events) : events);
    default: throw new Error(`draft has no ${fn}()`);
  }
}

async function offExport({ op, request }) {
  if (op === 'draft') return offDraft(request);
  if (op === 'bridge') return (await import('./agent-bridge.js')).answer(request);
  if (op === 'update') return (await import('../core/update-check.js')).run(request);
  const lib = await exportLib();
  // `session` is the whole thing including the gzip decision; `build` is the
  // raw bytes, which is what attaching to a Jira issue wants.
  let out = await lib.buildExport(request);
  // T-066: Markdown documents end with the checksum line, the session JSON lists them, and every result carries
  // the SHA-256 of the exact bytes handed over. The stamp comes before the gzip so it is inside what is compressed.
  if (STAMPED.has(request.format)) out = await stampDocument(out, { format: request.format, hashes: await shotHashes(request.sessionId) });
  if (op !== 'build') out = await (await import('../core/exporters.js')).gzipExport(out, request.format);
  return withSha256(out);
}

const STAMPED = new Set(['markdown', 'manual', 'srs', 'sbtm', 'json']);
/** `{captureId: sha256}` for the session's stored screenshots (hashed at write; a legacy record is hashed from its blob). */
async function shotHashes(sessionId) {
  const db = await dbLib();
  const ids = (await db.getEvents(sessionId)).filter((e) => e.kind === 'screenshot' && e.captureId).map((e) => e.captureId);
  return captureHashes(await db.getCaptures(ids));
}

let trackersMod = null;
const trackersLib = async () => (trackersMod ||= await import('../background/trackers.js'));

/**
 * The reverse-engineered specification, built here rather than in the worker.
 *
 * Same reason as the trackers above it: the worker's boot graph is at 794.8 KB
 * of an 800 KB cap, and `core/srs-reverse.js` pulls `artifact.js` and
 * `provenance.js` behind it. None of that is needed to wake up, answer a click
 * or file an event, and a module that is only wanted when a button is pressed
 * has no business being parsed at every service-worker start. The worker passes
 * a model and gets Markdown back; nothing else crosses.
 */
let srsMod = null;
const srsLib = async () => (srsMod ||= await import('../core/srs-reverse.js'));

/**
 * The fine print, loaded here for the same reason as the two above it.
 *
 * `core/fine-print.js` carries the policy matchers in two languages, the
 * sensitive-field patterns and the manual questions, and it fetches a tracker
 * host catalogue beside it. None of that is needed to wake up or file an event,
 * and the worker's boot graph is a few kilobytes from its ceiling.
 */
let finePrintMod = null;
let trackerHosts = null;
const finePrintLib = async () => (finePrintMod ||= await import('../core/fine-print.js'));
const trackerCatalogue = async () => (trackerHosts ||= await (await fetch(chrome.runtime.getURL('core/tracker-hosts.json'))).json());

async function offTracker({ op, tracker, cfg = {}, payload = {} }) {
  const lib = await trackersLib();
  switch (op) {
    case 'catalogue':
      return lib.trackerCatalogue();
    case 'state':
      // The catalogue plus "is this one filled in enough to try", which only the
      // adapter knows, because only it knows which of its fields are optional.
      return lib.trackerCatalogue().map((t) => ({
        ...t,
        configured: lib.isConfigured(t.id, payload?.cfgs?.[t.id] || {}),
      }));
    case 'test':
      return lib.testConnection(tracker, cfg);
    case 'targets':
      return lib.listTargets(tracker, cfg);
    case 'file': {
      /*
       * The evidence is assembled here, for the same reason Jira's is.
       *
       * `fileIssue()` hands `attachments` to an adapter's `attach()` as
       * `{ filename, blob }`, and a Blob cannot cross `chrome.runtime.sendMessage`
       * — it serialises as `{}`, silently. So the worker sends a *plan*
       * (`payload.attach`, the same shape Jira's `QUICK_ATTACH` uses) and the
       * files are read from IndexedDB on this side, where the database is.
       *
       * Only Shortcut and YouTrack declare `attach()` today; `fileIssue()`
       * ignores `attachments` for every other adapter, so sending them costs a
       * database read on a tracker that cannot use them. That is why the plan
       * is asked for rather than assumed: a caller that wants no attachments
       * sends none and nothing is read.
       */
      const plan = payload?.attach;
      const attachments = plan && payload.sessionId
        ? (await sessionFiles(payload.sessionId, plan)).files
        : undefined;
      return lib.fileIssue(tracker, cfg, { ...payload, attachments });
    }
    default:
      throw new Error(`Unknown tracker operation: ${op}`);
  }
}

/**
 * Text onto the clipboard, from the one page of this extension that can.
 *
 * `navigator.clipboard.writeText` wants a focused document and this one is
 * never focused — it is not rendered anywhere and cannot be. So it is a
 * textarea and `execCommand`, which is the route that still works from a
 * document nobody is looking at, and the reason `CLIPBOARD` is one of the
 * reasons this document is created with.
 *
 * It throws rather than answering `false`, because the caller's whole job is
 * to try the next door, and because the picker may only tell a tester
 * "copied ✓" when the text is really there.
 */
function copyToClipboard(text) {
  const field = document.createElement('textarea');
  field.value = String(text ?? '');
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    field.remove();
  }
  if (!copied) throw new Error('The clipboard refused the copy.');
  return { copied: true };
}

export { copyToClipboard, finePrintLib, offCookieFmt, offExport, offJira, offPostman, offPure, offRender, offTracker, srsLib, trackerCatalogue };
