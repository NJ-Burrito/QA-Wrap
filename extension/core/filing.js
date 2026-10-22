/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Where a report goes when you save it, and what it is called.
 *
 * The old behaviour was one flat file per download, dropped wherever Chrome
 * drops things, named after the session. Twenty sessions in, that is twenty
 * unrelated files in Downloads and no way to find the one from Tuesday.
 *
 * This lays down a category tree once, then only ever adds to it:
 *
 *   <chosen folder>/
 *     QA Wrap/
 *       Reports/          the readable artefact — Markdown, JSON
 *       Tickets/          Jira, GitHub, CSV — the hand-over formats
 *       Tests/            the runnable Playwright spec
 *       Session sheets/   the SBTM record
 *       Screenshots/      stills, in whichever image format was chosen
 *       Recordings/       screen capture, mp4 / webm / gif
 *       Accessibility/    audit output kept apart, because it is read by a
 *                         different person than the bug report
 *
 * Two things are worth knowing before reading further.
 *
 * **Colons are not allowed in filenames.** Not on Windows, and not in Chrome's
 * download API on any platform. The requested `hh:mm` is therefore written
 * `hh-mm`, which is the closest legal thing and still sorts correctly. Slashes
 * in the date would create folders, so `dd/mm/yy` is written `dd-mm-yy`.
 *
 * **An extension cannot write to an arbitrary folder by path.** There are two
 * ways to reach the disk and they have different powers:
 *
 *   - `showDirectoryPicker()` — the tester grants one folder, once, and from
 *     then on the tree is created and written inside it. This is the mode that
 *     does what was asked. It needs a real user gesture, so it is offered from
 *     the settings page, and the handle is kept in IndexedDB.
 *   - `chrome.downloads` — no picker, but the path is relative to the Downloads
 *     folder and Chrome creates missing directories itself. This is the
 *     fallback, and it still produces the same tree, just always under
 *     Downloads.
 *
 * The fallback is not a degraded mode to be embarrassed about — it is the one
 * that needs no permission at all, so it is the default.
 *
 * ── the folder contract ───────────────────────────────────────────────────
 *
 * Six rules. All six were broken at once in the session at
 * `research/54-real-session-review.md`, which is what they are written down
 * for.
 *
 * **1. `QA Wrap` appears exactly once in a path.** The root is prepended by
 * `filePath()`, and the tester's own folder is prepended in front of that by
 * `withFolder()`. Either one can already be called `QA Wrap` — a granted folder
 * usually is, because the most natural folder to grant is the one the extension
 * made last time — and the answer is never `QA Wrap/QA Wrap/`. `withFolder()`
 * drops a folder segment that is the root, and `pathInside()` drops the root
 * from a path being written into a handle that already carries it.
 *
 * **2. Folders are created, never replaced.** `getDirectoryHandle(name,
 * { create: true })` is "open it, or make it", so every write lays down its own
 * parents and an existing tree is added to. Nothing here deletes or truncates a
 * directory.
 *
 * **3. Only the categories being written are created.** A category folder that
 * exists and is empty is a promise of output that was never produced. The tree
 * is laid down by the files that go in it, not up front.
 *
 * **4. Files are never overwritten.** Both routes uniquify. The
 * `showDirectoryPicker` route counts from `(2)` in `writeToDirectory()`; the
 * `chrome.downloads` route counts from `(1)`, and its callers state
 * `conflictAction: 'uniquify'` rather than relying on it being the default.
 * Saving the same session twice leaves both copies side by side.
 *
 * **5. One document, one filename.** Two different documents must never share a
 * `FORMATS` entry. When they did, the fine print and the specification read
 * back from a page were both written as `Requirements specification-<stamp>.md`
 * and the collision rename quietly turned one of them into `… (2).md`, with
 * nothing on disk saying which document it was.
 *
 * **6. A save the browser cannot see must say so.** `chrome.downloads` puts an
 * entry in the browser's download history; `showDirectoryPicker` cannot, ever,
 * because no download happens. That is not a bug to hide — it is a fact the
 * confirmation has to carry, which is why `describeSaved()` lives here beside
 * the paths rather than being written out at each call site.
 */

// The one catalogue of what this product can write, so an extension is looked
// up rather than guessed at from a MIME string. See evidenceExt().
import { IMAGE_TYPES, VIDEO_TYPES } from './file-types.js';

export const ROOT = 'QA Wrap';

/** Is this folder name the product's own root, however it was typed? */
const isRoot = (name) => String(name ?? '').trim().toLowerCase() === ROOT.toLowerCase();

/**
 * The tester's own folder, in front of everything this extension writes.
 *
 * Chrome hands `chrome.downloads.download()` a path relative to Downloads and
 * gives nothing back about the folder a person chose in its dialog, so the only
 * "remember where I save" that can exist is this: a name the tester types once,
 * kept in settings (`downloadFolder`), prefixed onto every path built here.
 *
 * Sanitised with the same `safeName()` the filenames use, and slashes are kept
 * so `Clients/Acme` nests the way it reads. An empty or unusable name changes
 * nothing at all, which is the behaviour every profile had before this existed.
 *
 * A segment called `QA Wrap` is dropped. The field's placeholder used to read
 * `QA Wrap`, a placeholder spelling out a real value reads as the current
 * setting, and a tester who types what it shows got
 * `QA Wrap/QA Wrap/Reports/…`. Rule 1 of the contract above: the root appears
 * once. Typing the product's own folder name is a way of saying "the usual
 * place", so that is what it now means.
 */
export function withFolder(path, folder) {
  const parts = String(folder ?? '')
    .split(/[\\/]+/)
    .map((part) => safeName(part, 60))
    .filter((part) => part && part !== 'untitled' && !isRoot(part));
  return parts.length ? `${parts.join('/')}/${path}` : path;
}


/**
 * The path to write, relative to a granted directory handle.
 *
 * `showDirectoryPicker()` hands back a folder the tester chose, and the folder
 * they choose is very often the `QA Wrap` the extension made for them last
 * time, sitting in Downloads. Prepending the root regardless put run 2 of the
 * real session in `QA Wrap/QA Wrap/Reports/`, which is Nader's "it creates a
 * separate folder named QA Wrap, not the one I picked": a folder that is
 * already the root is the root, and the path drops its own copy.
 *
 * Only the leading segment is considered. A tester with `Clients/QA Wrap/2026`
 * granted has not said anything about where the tree goes inside it.
 */
export function pathInside(folderName, path) {
  const text = String(path ?? '');
  return isRoot(folderName) && text.startsWith(`${ROOT}/`) ? text.slice(ROOT.length + 1) : text;
}

/** Category per artefact kind. The tree is created from this, so it is the one list. */
export const CATEGORIES = {
  report: 'Reports',
  ticket: 'Tickets',
  test: 'Tests',
  sheet: 'Session sheets',
  screenshot: 'Screenshots',
  recording: 'Recordings',
  accessibility: 'Accessibility',
  docs: 'Documents',
  sessions: 'Sessions',
};

/**
 * Which category each export format files itself under, and what it is called.
 *
 * One table for both, because they were two and they drifted: five formats were
 * added to the worker and to neither of these, so a JUnit report saved as
 * `.txt` into Reports — an XML file with the wrong extension, in the folder
 * nobody looks for test results in.
 */
/**
 * `order` is the file's number inside its shelf — the order a reader would
 * open them in — and `part` is what the file is called. Two formats that are
 * the same document in two shapes (Markdown and page) share a number, so
 * `07 Requirements specification.md` sits beside `07 Requirements specification.html`.
 */
export const FORMATS = {
  markdown: { category: 'report', ext: 'md', label: 'Bug report (Markdown)', audience: 'human', order: 1, part: 'Bug report' },
  html: { category: 'report', ext: 'html', label: 'Illustrated report (HTML)', audience: 'human', order: 2, part: 'Illustrated report' },
  text: { category: 'report', ext: 'txt', label: 'Plain text', audience: 'human', order: 3, part: 'Bug report, plain text' },
  links: { category: 'report', ext: 'md', label: 'Link check', audience: 'human', order: 4, part: 'Link check' },
  'links-html': { category: 'report', ext: 'html', label: 'Link check (page)', audience: 'human', order: 4, part: 'Link check' },
  sbtm: { category: 'sheet', ext: 'md', label: 'Session sheet (SBTM)', audience: 'human', order: 5, part: 'Session sheet' },
  'sheet-xlsx': { category: 'sheet', ext: 'xlsx', label: 'Session sheet (Excel)', audience: 'human', order: 5, part: 'Session sheet' },
  'timeline-xlsx': { category: 'sheet', ext: 'xlsx', label: 'Timeline (Excel)', audience: 'human', order: 6, part: 'Timeline' },
  suite: { category: 'test', ext: 'md', label: 'Test suite (parent + sub-cases)', audience: 'human', order: 7, part: 'Test suite' },
  'suite-csv': { category: 'test', ext: 'csv', label: 'Test suite (CSV)', audience: 'human', order: 7, part: 'Test suite, CSV' },
  jira: { category: 'ticket', ext: 'txt', label: 'Jira ticket (wiki markup)', audience: 'human', order: 8, part: 'Jira ticket' },
  github: { category: 'ticket', ext: 'md', label: 'GitHub / Linear issue', audience: 'human', order: 9, part: 'Issue' },
  srs: { category: 'docs', ext: 'md', label: 'Requirements specification (SRS)', audience: 'human', order: 10, part: 'Requirements specification' },
  'srs-html': { category: 'docs', ext: 'html', label: 'Requirements specification (page)', audience: 'human', order: 10, part: 'Requirements specification' },
  manual: { category: 'docs', ext: 'md', label: 'User manual', audience: 'human', order: 11, part: 'User manual' },
  'manual-html': { category: 'docs', ext: 'html', label: 'User manual (page)', audience: 'human', order: 11, part: 'User manual' },
  'storyboard-html': { category: 'docs', ext: 'html', label: 'Video storyboard (review)', audience: 'human', order: 12, part: 'Video storyboard' },
  'flow-svg': { category: 'docs', ext: 'svg', label: 'Workflow diagram (SVG, A4)', audience: 'human', order: 13, part: 'Workflow diagram' },
  'flow-png': { category: 'docs', ext: 'png', label: 'Workflow diagram (PNG, A4)', audience: 'human', order: 13, part: 'Workflow diagram' },

  /*
   * Two documents that used to be saved as `srs`, because that is the format
   * whose Markdown they resemble.
   *
   * They are not it. The specification read back from a page (tool 17) and the
   * fine print (tool 18) are different documents about different things, and
   * filing all three under `Requirements specification-<stamp>.md` meant the
   * collision rename decided which was which. Nader's own folder has a 12 KB
   * `Requirements specification-07-09-26-14-51 (2).md` whose first line is
   * "Specification read back from www.youtube.com" — rule 5 of the contract,
   * found the only way these things are found.
   *
   * They are still built by the `srs` exporter; only the shelf label and the
   * filename are their own.
   */
  'spec-reverse': { category: 'docs', ext: 'md', label: 'Specification read back from the page', audience: 'human', order: 10, part: 'Specification read from the page' },
  'fine-print': { category: 'report', ext: 'md', label: 'The fine print', audience: 'human', order: 4, part: 'Fine print' },

  json: { category: 'report', ext: 'json', label: 'Raw JSON', audience: 'ai', order: 1, part: 'Session' },
  'session-json': { category: 'report', ext: 'json', label: 'session.json (for an AI or a script)', audience: 'ai', order: 2, part: 'Session for AI' },
  agent: { category: 'report', ext: 'json', label: 'Agent brief (for an AI)', audience: 'ai', order: 2, part: 'Agent brief' },
  yaml: { category: 'report', ext: 'yaml', label: 'YAML', audience: 'ai', order: 3, part: 'Session' },
  har: { category: 'report', ext: 'har', label: 'Network HAR', audience: 'ai', order: 4, part: 'Network' },
  a11y: { category: 'accessibility', ext: 'json', label: 'Accessibility findings', audience: 'ai', order: 5, part: 'Accessibility findings' },
  csv: { category: 'ticket', ext: 'csv', label: 'Timeline CSV (TestRail, Xray)', audience: 'ai', order: 6, part: 'Timeline' },
  playwright: { category: 'test', ext: 'spec.ts', label: 'Playwright spec', audience: 'ai', order: 7, part: 'Re-test' },
  junit: { category: 'test', ext: 'xml', label: 'JUnit XML (CI)', audience: 'ai', order: 8, part: 'JUnit' },
  /*
   * The picked-locator basket, three ways, all under `test`: they are what an
   * automation script is written from, and an agent pointed at that folder
   * should find the plan, the reference sheet and the parser's copy together.
   */
  'locator-set': { category: 'test', ext: 'json', label: 'Locator set (for an AI)', audience: 'ai', order: 9, part: 'Locator set' },
  'test-plan': { category: 'test', ext: 'plan.md', label: 'Test plan (Playwright agent)', audience: 'ai', order: 10, part: 'Test plan' },
  'locator-sheet': { category: 'test', ext: 'locators.md', label: 'Locators by purpose (for an AI)', audience: 'ai', order: 11, part: 'Locators by purpose' },
  'harvest-map': { category: 'test', ext: 'json', label: 'Page map (JSON)', audience: 'ai', order: 9, part: 'Page map' },
  'harvest-pom': { category: 'test', ext: 'ts', label: 'Page object (Playwright)', audience: 'ai', order: 10, part: 'Page object' },
  'harvest-brief': { category: 'test', ext: 'md', label: 'Page brief (for an AI)', audience: 'ai', order: 11, part: 'Page brief' },
  postman: { category: 'test', ext: 'postman_collection.json', label: 'Postman collection', audience: 'ai', order: 12, part: 'Postman collection' },
  'postman-env': { category: 'test', ext: 'postman_environment.json', label: 'Postman environment', audience: 'ai', order: 13, part: 'Postman environment' },
  storyboard: { category: 'docs', ext: 'json', label: 'Video storyboard (for a generator)', audience: 'ai', order: 14, part: 'Video storyboard' },
  'flow-json': { category: 'docs', ext: 'json', label: 'Workflow diagram (model)', audience: 'ai', order: 15, part: 'Workflow diagram' },

  'session-manifest': { category: 'sessions', ext: 'json', label: 'Session card (for the team folder)' },
  // T-067: the one zip (report, session JSON, screenshots). Built by background/export-build.js, never listed as a shelf item.
  bundle: { category: 'sessions', ext: 'zip', label: 'Session bundle (one zip)', part: 'Session bundle' },
};

/**
 * T-049: the default keep-list. Everything else is "More", unticked in the Save sheet, listed last and
 * labelled not maintained. The ISTQB defect and test case are built in report/istqb.js, not here.
 * The cohort (T-051) may move two of these.
 */
export const KEEP_FORMATS = ['markdown', 'html', 'json', 'har', 'jira', 'github', 'junit', 'playwright', 'sheet-xlsx', 'postman'];
// features-1010 R5: session.json is the owner-requested AI file, a picker entry of its own: not the keep-list ten, and not "More (not maintained)" either.
export const isMoreFormat = (id) => id in FORMATS && id !== 'session-manifest' && id !== 'bundle' && id !== 'session-json' && !KEEP_FORMATS.includes(id);

/**
 * Characters no filesystem or download API will take, plus the ones that are
 * legal but reliably ruin a filename: leading dots (hidden files), trailing
 * dots and spaces (silently stripped by Windows, so two files collide).
 */
export function safeName(text, max = 80) {
  return (
    String(text ?? '')
      // Illegal characters and control codes only. Hyphens stay: a charter
      // often contains one, and rewriting the tester's own words is worse
      // than the small ambiguity with the " - " separating title from stamp.
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
      .slice(0, max)
      .trim() || 'untitled'
  );
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * `dd-mm-yy hh-mm`, in local time, in the clock the tester chose.
 *
 * Local, not UTC: a tester looking for "the run I did after lunch" is thinking
 * in the clock on their wall, and a UTC stamp sends them to the wrong file.
 */
export function stamp(when = Date.now(), { clock = '24' } = {}) {
  const d = new Date(when);
  const date = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${pad(d.getFullYear() % 100)}`;

  if (clock === '12') {
    const h = d.getHours();
    const hour12 = h % 12 || 12;
    return `${date} ${pad(hour12)}-${pad(d.getMinutes())}${h < 12 ? 'am' : 'pm'}`;
  }
  return `${date} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/**
 * The full relative path for one artefact.
 *
 *   QA Wrap/Reports/Expired document rejected - 27-08-26 14-32.md
 *
 * Title first, because that is what the eye scans for; the stamp second so a
 * directory listing sorted by name groups every run of the same test together.
 */
/** The stamp as a filename wants it: one separator, no spaces. */
const fileStamp = (when, clock) => stamp(when, { clock }).replace(' ', '-');

/*
 * exp1022: per type, then per test. The folder and every file name carry the test's title and the day it started:
 *   QA Wrap/Screenshots/<title> 2026-10-22/01 Error shown - <title> 2026-10-22.png
 * `useTitle()` lets the report page say which title its header shows; other surfaces fall back to the charter.
 */
let titleFn = null;
/** @param {((session: any) => string) | null} fn */
export const useTitle = (fn) => { titleFn = fn; };
const UNTITLED = /^\s*(untitled session|جلسة بلا عنوان|qa session)?\s*$/i;
export function sessionTitle(session) {
  let text = '';
  try { text = String((titleFn && titleFn(session)) || ''); } catch { /* fall back to the charter */ }
  if (UNTITLED.test(text)) text = String(session?.charter ?? '');
  return UNTITLED.test(text) ? 'QA session' : safeName(text, 40);
}
/** `YYYY-MM-DD`, local time. */
export function dayStamp(when) {
  const d = new Date(Number.isFinite(when) ? when : Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** `<title> <YYYY-MM-DD>`: the per-test folder name and the tail of every file name in it. */
export const testFolder = (session) => `${sessionTitle(session)} ${dayStamp(session?.startedAt)}`;
/** `QA Wrap/<Category>/<test folder>/<name> - <test folder>[ (n)].<ext>` */
const inTest = (category, session, name, ext, suffix = '') => {
  const f = testFolder(session);
  return `${ROOT}/${category}/${f}/${name} - ${f}${suffix}.${ext}`;
};

/**
 * @param {{title?: string, kind: string, ext: string, when?: number, clock?: string, index?: number, part?: string, session?: any}} args
 */
export function filePath({ title, kind, ext, when, clock, index, part, session }) {
  const category = CATEGORIES[kind] || CATEGORIES.report;
  const suffix = index != null ? ` (${index})` : '';
  if (session) return inTest(category, session, safeName(part || title, 40), ext, suffix);
  return `${ROOT}/${category}/${safeName(part || title)}-${fileStamp(when, clock)}${suffix}.${ext}`;
}

/**
 * `.gz` appended, never substituted.
 *
 * `Session-2026-09-05.json.gz` says both what the bytes are now and what they
 * will be once unzipped, so an archiver gives back a file with the right
 * extension and nobody has to rename anything. Idempotent, because the path can
 * reach here from a caller that has already been told.
 */
export const gzPath = (path) => (String(path).endsWith('.gz') ? String(path) : `${path}.gz`);

/**
 * The path of one export, from its format: the shelf, the category, the number, the name.
 *
 * `gz` is set when the worker compressed the export — see `GZIP_THRESHOLD` in
 * `core/exporters.js`. It is an option and not a guess from the content, because
 * the decision belongs to whoever produced the bytes; a path builder that
 * sniffed would eventually disagree with the file it was naming.
 */
/**
 * @param {string} format
 * @param {{startedAt?: number, charter?: string}} [session]
 * @param {{clock?: string, gz?: boolean, folder?: string}} [options]
 */
export function exportPath(format, session, { clock, gz = false, folder = '' } = {}) {
  const f = FORMATS[format] || { category: 'report', ext: 'txt', part: format };
  const when = session?.startedAt;
  const path = format === 'session-manifest'
    ? inTest(CATEGORIES.sessions, session, 'Session card', 'json')
    : filePath({ kind: f.category, ext: f.ext, part: f.part, title: f.part, when, clock, session: session || {} });
  return withFolder(gz ? gzPath(path) : path, folder);
}

/**
 * The extension a stored item should be saved with.
 *
 * Three layers, in the order they can be trusted.
 *
 * **What the recorder decided.** A clip now stores `ext` from the catalogue at
 * the moment it was created, which is the only place that actually knows.
 *
 * **The catalogue, looked up by MIME.** For rows written before that existed.
 * A lookup and not a string operation, because `type.split('/')[1]` on a
 * Matroska clip yields `x-matroska`, and `something.x-matroska` is a filename
 * no player opens.
 *
 * **The last segment of the MIME type**, for anything the catalogue has never
 * heard of, with the two long-standing special cases kept.
 *
 * The bug this replaces was in the first layer's absence: a MediaRecorder blob
 * carries the full codec string as its type — `video/webm;codecs=vp8,opus` —
 * and splitting that on `/` produced clips saved as
 * `Recording-2026-09-05.webm;codecs=vp8,opus`, which Windows will not open,
 * Jira will not accept and nobody could rename back without knowing what it was.
 */
export function evidenceExt(item) {
  if (item?.ext) return item.ext;
  const mime = (item?.type || '').split(';')[0].trim().toLowerCase();
  const known = [...IMAGE_TYPES, ...VIDEO_TYPES].find((t) => t.mime === mime);
  if (known) return known.ext;
  // The catalogue has no `mime` on video entries — it carries codec candidates
  // — so match a video container by the head of its first candidate too.
  const video = VIDEO_TYPES.find((t) => (t.candidates || []).some((c) => c.split(';')[0] === mime));
  if (video) return video.ext;
  return mime.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg') || 'bin';
}

/**
 * The path of a screenshot or a clip: numbered in the order it was taken,
 * then the clock time, then the tester's label — so the folder reads as the
 * session's story from top to bottom.
 */
/**
 * @param {{kind?: string, label?: string, ts?: number, ext?: string, type?: string}} item
 * @param {number} [ordinal]
 * @param {any} [session]
 * @param {{clock?: string, folder?: string}} [options]
 */
export function evidencePath(item, ordinal, session, { clock, folder = '' } = {}) {
  const ext = evidenceExt(item);
  const kind = item.kind === 'recording' ? 'recording' : 'screenshot';
  const label = item.label || (kind === 'recording' ? 'Recording' : 'Screenshot');
  const n = ordinal != null ? `${String(ordinal).padStart(2, '0')} ` : '';
  return withFolder(inTest(CATEGORIES[kind], session || {}, `${n}${safeName(label, 30)}`, ext), folder);
}

/** Where the notes file goes: `QA Wrap/Documents/<title> <date>/<title> <date> notes.<ext>` (.docx and .md). */
export function notesPath(session, ext, { folder = '' } = {}) {
  const f = testFolder(session);
  return withFolder(`${ROOT}/${CATEGORIES.docs}/${f}/${f} notes.${ext}`, folder);
}

/** Every folder the tree needs, parents before children. */
export function treePaths() {
  return [ROOT, ...Object.values(CATEGORIES).map((c) => `${ROOT}/${c}`)];
}

/**
 * Lay the tree down inside a granted folder, on request.
 *
 * `getDirectoryHandle(name, { create: true })` is already "open it, or make
 * it" — so this both *checks* and *creates* in one pass: if QA Wrap and its
 * categories are there, nothing happens; if they are not, they are made.
 *
 * **Not called before a save any more.** `writeToDirectory()` creates its own
 * parents, so running this per file only ever added folders nobody was going to
 * write into. Run 2 of the real session left `Accessibility/` and `Recordings/`
 * standing empty inside a folder that had no accessibility scan and no
 * recording, which reads as output that went missing. Rule 3 of the contract:
 * the tree is laid down by the files that go in it.
 *
 * It stays exported, and takes the categories to make, because "show me the
 * shape before I commit a folder to it" is a reasonable thing for the Settings
 * page to offer. It just is not the write path.
 */
export async function ensureTree(root, categories = Object.values(CATEGORIES)) {
  const made = [];
  // A folder already called QA Wrap *is* the root: see pathInside().
  const qaw = isRoot(root?.name) ? root : await root.getDirectoryHandle(ROOT, { create: true });
  for (const category of categories) {
    let dir = qaw;
    for (const part of String(category).split('/')) {
      const before = await has(dir, part);
      dir = await dir.getDirectoryHandle(part, { create: true });
      if (!before) made.push(`${ROOT}/${category}`);
    }
  }
  return made;
}

async function has(dir, name) {
  try { await dir.getDirectoryHandle(name); return true; } catch { return false; }
}

/* ── writing, when the tester has granted a folder ─────────────────────── */

/**
 * Create the tree inside a granted directory handle, then write one file.
 *
 * `getDirectoryHandle(name, { create: true })` is already "make it if it is not
 * there, otherwise open it", so laying the tree down every time costs one
 * lookup per level and needs no "does it exist" check — which is exactly the
 * behaviour asked for: create the categories when missing, add to them when not.
 */
export async function writeToDirectory(root, relativePath, data, { onCollision = 'rename' } = {}) {
  // Rule 1: a folder the tester granted that is already called QA Wrap is the
  // root, not a place to put another one inside.
  const parts = pathInside(root?.name, relativePath).split('/');
  const name = parts.pop();

  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });

  let finalName = name;
  if (onCollision === 'rename') {
    // Two runs of the same test inside one minute would otherwise overwrite
    // each other, and the second one is usually the interesting one.
    const [base, ext] = splitExtension(name);
    let n = 2;
    while (await exists(dir, finalName)) finalName = `${base} (${n++})${ext}`;
  }

  const handle = await dir.getFileHandle(finalName, { create: true });
  const stream = await handle.createWritable();
  await stream.write(data);
  await stream.close();
  return `${parts.join('/')}/${finalName}`;
}

/**
 * A filename split into the part to number and the part that must stay last.
 *
 * `lastIndexOf('.')` is wrong here, and this product has five formats that
 * prove it: `.spec.ts`, `.postman_collection.json`, `.postman_environment.json`,
 * `.json.gz` and `.har.gz`. Numbering at the last dot turns a second copy into
 * `Session-<stamp>.json (2).gz`, which no archiver will unzip and no tool will
 * recognise, and `Postman collection-<stamp>.postman_collection (2).json`,
 * which Postman will not import. Rule 4 of the contract is only worth having if
 * the second copy is as usable as the first.
 *
 * The extension is the whole run of trailing dot-segments that look like
 * extensions: letters, digits and underscores, nothing else. That stops at the
 * first segment containing a space or a hyphen, so a charter called `v1.2 login`
 * keeps its dot and the stamp — which is all hyphens — can never be eaten.
 */
export function splitExtension(name) {
  const m = /^(.*?)((?:\.[A-Za-z0-9_]+)+)$/.exec(String(name));
  return m && m[1] ? [m[1], m[2]] : [String(name), ''];
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * A one-line description of where files are going, for the settings page.
 * Saying it plainly beats a tester discovering the tree by accident.
 */
/**
 * Where files land, as a path a person can walk to.
 *
 * The Settings page, the report's Save sheet and the confirmation after a save
 * all have to say this, and before this existed all three built the sentence
 * themselves from `ROOT` and the folder name. They disagreed the moment the
 * root stopped being unconditional: two of them would still have promised
 * `QA Wrap/QA Wrap/` for a folder called `QA Wrap`. One function, one answer.
 *
 * `folderName` is a granted directory handle's name and wins outright, because
 * a granted folder is the destination. `folder` is the `downloadFolder`
 * setting, which only ever names a subfolder of Downloads.
 */
export function destination({ folderName = '', folder = '' } = {}) {
  if (folderName) return isRoot(folderName) ? `${folderName}/` : `${folderName}/${ROOT}/`;
  return `Downloads/${withFolder(`${ROOT}/`, folder)}`;
}

export function describeDestination({ folderName, folder = '' }) {
  const where = destination({ folderName, folder });
  return folderName
    ? `Saving straight into ${where} One folder per kind of output. The folders are checked and created as each file is written. Files written this way do not appear in the browser's download list, because the browser is not the one writing them.`
    : `Saving into ${where} One folder per kind of output, and every file appears in the browser's download list. Pick a folder to put it somewhere else.`;
}

/**
 * What just happened, in one sentence, after files have been written.
 *
 * Nader's words: "the saving files button saved the items without notifying the
 * user, no downloaded items in the download history; it will send the user into
 * a panic." Both halves of that are answered here, and here rather than at each
 * call site so the report page, the popup and the system notification cannot
 * end up telling him three different stories.
 *
 * `how` is what `saveFiled()` returned: `downloads` (the browser wrote it, so
 * it is in the download list), `folder` (the extension wrote it into the
 * granted folder, so it is not), or `downloads-fallback` (the folder was meant
 * to be used and could not be, which the tester genuinely needs to hear,
 * because they are about to go and look in it).
 *
 * @param {{count:number, where:string, how:string, failed?:number}} what
 */
export function describeSaved({ count, where, how, failed = 0 }) {
  const files = `${count} file${count === 1 ? '' : 's'}`;
  const place = where ? ` into ${where}` : '';
  const head = failed
    ? `Saved ${files}${place}. ${failed} could not be written.`
    : `Saved ${files}${place}, filed by category.`;

  if (how === 'folder') {
    return `${head} These went straight to your folder, so they are not in the browser's download list. Open the folder to see them.`;
  }
  if (how === 'downloads-fallback') {
    return `${head} Your chosen folder could not be written to, so they went to Downloads instead, where the browser lists them.`;
  }
  return `${head} They are in the browser's download list, under Downloads.`;
}
