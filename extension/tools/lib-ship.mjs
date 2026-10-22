/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What goes in a package, decided once.
 *
 * Both builders — `package.mjs` for the store zip and `build-browsers.mjs` for
 * the browser matrix — used to answer this separately, and one of them by an
 * allow-list. That list went stale three features running: the side panel, the
 * diagram and the tutorials were all written, shipped in Chrome, and silently
 * left out of Edge and Firefox.
 *
 * The rule is a deny-list on purpose. Forgetting to exclude something puts a
 * stray file in a package, which the release gate catches and a person fixes
 * in a minute. Forgetting to include something ships a product with a button
 * that opens nothing, which nobody notices until a user does.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Never packaged: sources, keys, research, profiles, and the store listing.
 *
 * `docs/` is on the list rather than left to the Markdown rule below. Every file
 * in it is a nested `.md` and would be skipped one by one, but the *folder*
 * would still be created in the package — an empty `docs/adr/` in eight zips,
 * which `release-check.mjs` would then have to explain. A folder of developer
 * documents is excluded as a folder.
 */
export const EXCLUDE = new Set([
  'node_modules', 'tools', 'test', 'tests', 'dist', 'store', 'keys', 'research', 'docs',
  '.gitignore', 'FIX-SPEC.md',
  'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.wide.json', // type-check config: dev only, it shipped by accident
  '.field-profile', '.uat-profile', '.ui-shots-profile', '.uat', '.ui-shots',
  '.tutorials', '.tutorial-profile',
  'Microsoft', // Windows PowerShell's ModuleAnalysisCache lands here as Microsoft/Windows/PowerShell/ when a child powershell.exe cannot resolve LOCALAPPDATA; never product (1015)
]);

/**
 * Documentation that may ship. Any other .md, at any depth, is a working note.
 *
 * `LICENSE.md` is deliberately absent: there is exactly one licence file and it
 * is `LICENSE`. Two of them named two different rights holders, which is the
 * audit blocker this list used to keep alive by allowing both.
 */
export const SHIPPING_DOCS = new Set([
  'README.md', 'LICENSE', 'CHANGELOG.md', 'RELEASE.md',
  'NOTICE', 'NOTICE.md', 'SUPPORT.md', 'SLA.md', // D-1010-138: ROADMAP.md stays in the repo and out of the package (it names pending owner decisions)
  'PRIVACY.md', 'PRIVACY.ar.md', 'SECURITY.md', 'TERMS.md',
]);

/**
 * Is this file a working note that must not reach a user?
 *
 * Asked at every depth rather than only at the top level. `popup/REFACTOR.md` —
 * a refactor's own scratch notes — shipped in all eight packages because the old
 * filter only ever looked at the extension folder's own entries, and a nested
 * Markdown file walked straight past it inside its directory. `ui/SOUNDS.md` and
 * `ui/VFX.md` went out the same way.
 *
 * `SHIPPING_DOCS` is a list of the **package's own** documents, so it is honoured
 * at the top level and nowhere else. A nested Markdown file is a note to whoever
 * works on that folder, whatever it happens to be called: `vendor/README.md` is
 * refresh instructions naming a script that does not exist, and it is a README
 * only by filename. Anything a user has a reason to read belongs in one of the
 * documents at the root.
 *
 * `BROWSER.md` never reaches here: the browser build writes it into the target
 * folder after the copy, which is why it is not on `SHIPPING_DOCS`.
 *
 * @param {string} relPath  the path inside the package, `/`-separated
 */
/** Read by the brand generator at build time, never by the extension: kept out of every package. */
/* game/ ships (it is the practice page, 15 Oct 2026) except what only the localhost dev server and the tests use: the server itself, and the
 * source page practice/practice.html is generated from (tools/build-practice.mjs). */
const BUILD_ONLY = new Set(['brand/brand.json', 'brand/applied.json', 'game/server.mjs', 'game/index.html']);

export function isWorkingNote(relPath) {
  if (BUILD_ONLY.has(relPath)) return true;
  if (!relPath.endsWith('.md')) return false;
  const nested = relPath.includes('/');
  return nested || !SHIPPING_DOCS.has(relPath);
}

/**
 * A top-level name that must never ship (r10-00-1, D-222): any `_`-prefixed
 * entry other than `_locales` (Chrome's i18n folder) and any top-level `.mjs`
 * file (a scratch script such as `_ed9.mjs`, or a tool that wandered in).
 * Nested `.mjs` files are fine; the extension's own are inside folders.
 */
export function isStrayTopLevel(name) {
  if (name.includes('/')) return false;
  if (name.startsWith('_') && name !== '_locales') return true;
  return name.endsWith('.mjs');
}

/**
 * The top-level entries a package contains.
 *
 * @param {string[]} names  everything in the extension folder
 * @param {(name: string) => void} [onSkip]  told about each working note left out
 */
export function shipping(names, onSkip) {
  return names
    .filter((name) => !EXCLUDE.has(name) && !name.startsWith('.') && !isStrayTopLevel(name))
    .filter((name) => {
      if (!isWorkingNote(name)) return true;
      onSkip?.(name);
      return false;
    })
    .sort();
}

/**
 * Copy one shipping entry, and say how many FILES were written.
 *
 * The count is the point. `Compress-Archive` will report success on a zip that
 * is short an entry — a Defender scan holding one freshly-copied file open is
 * enough — and a package missing `vendor/axe.min.js` looks exactly like a
 * package that has it until somebody presses Scan. Counting here gives the zip
 * something to be checked against that was measured, not assumed.
 *
 * Both builders call this so the store zip and the browser zips cannot disagree
 * about what a package contains: `release-check.mjs` asserts their file-name
 * sets are equal, and two copy routines is one rule that will drift.
 *
 * @param {(rel: string) => void} [onSkip]  told about each nested working note
 */
export function copyShipping(from, to, onSkip, relBase = '') {
  const name = path.basename(from);
  const rel = relBase ? `${relBase}/${name}` : name;
  const stat = fs.statSync(from);
  if (!stat.isDirectory()) {
    if (isWorkingNote(rel)) {
      onSkip?.(rel);
      return 0;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return 1;
  }
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from)) {
    n += copyShipping(path.join(from, entry), path.join(to, entry), onSkip, rel);
  }
  return n;
}
