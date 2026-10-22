/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Zips the extension for the Chrome Web Store, excluding development-only files.
 *
 *   node tools/package.mjs
 *
 * package.json and tools/ exist for the Node test runner. Chrome ignores them,
 * but they have no business in a published build.
 *
 * What ships and what does not is decided in `tools/lib-ship.mjs`, and only
 * there. This file used to carry its own copy of both lists; they drifted, and
 * one of the things the copy here still allowed was a second licence file
 * naming a different rights holder.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipping, isWorkingNote, copyShipping } from './lib-ship.mjs';
import { packVerified } from './lib-zip.mjs';
import { DIST } from './lib-paths.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
/* Repo-root `dist/`, not `extension/dist`: see tools/lib-paths.mjs. */
const outDir = DIST;
const slug = (manifest.short_name || manifest.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outFile = path.join(outDir, `${slug}-${manifest.version}.zip`);

fs.mkdirSync(outDir, { recursive: true });
// The old zip is NOT deleted here. `packVerified` writes beside it and renames
// over the top only once the archive has been read back and counted, so a run
// that cannot write a package leaves the last good one on disk rather than
// leaving nothing.

// A Markdown file that is not on the shipping list is a working note that
// happened to be saved here. Kept out, and named on the way past, so nobody
// has to read a file listing to notice.
const include = shipping(fs.readdirSync(EXT), (name) =>
  console.log(`  - ${name}  (working note, not shipped)`));

console.log(`packaging ${manifest.short_name || manifest.name} ${manifest.version}`);
include.forEach((n) => console.log(`  + ${n}`));

/**
 * Working notes hide below the top level too.
 *
 * `popup/REFACTOR.md` went out in every package for a release: the filter above
 * only ever reads the extension folder's own entries, and a directory is passed
 * to the packer whole. So the tree is walked, and any directory holding a
 * nested note is staged as a filtered copy rather than handed over as it is.
 *
 * The copy is paid only where there is something to leave out — staging the
 * whole tree would double the write, and a freshly-written 9 MB is exactly what
 * Windows Defender holds open while `Compress-Archive` is trying to read it.
 */
function nestedNotes(dir, rel) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const here = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...nestedNotes(path.join(dir, entry.name), here));
    else if (isWorkingNote(here)) found.push(here);
  }
  return found;
}

const stage = path.join(outDir, '.staged');
fs.rmSync(stage, { recursive: true, force: true });

const notes = [];
const paths = include.map((name) => {
  const from = path.join(EXT, name);
  if (!fs.statSync(from).isDirectory()) return from;
  const found = nestedNotes(from, name);
  if (!found.length) return from;
  notes.push(...found);
  const to = path.join(stage, name);
  copyShipping(from, to);
  return to;
});
for (const note of notes) console.log(`  - ${note}  (working note, not shipped)`);

/**
 * How many files are about to be zipped, counted the way the zip is read back:
 * files only, folder markers ignored.
 *
 * Without this number the packer's exit code is the only evidence that the
 * store package is complete, and that evidence has been wrong before — see
 * `tools/lib-zip.mjs`.
 */
function countFiles(p) {
  return fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).reduce((n, entry) => n + countFiles(path.join(p, entry)), 0)
    : 1;
}
const expectedFiles = paths.reduce((n, p) => n + countFiles(p), 0);

/**
 * The store zip, written the same careful way as the seven browser zips.
 *
 * This step is the one that had none of that care. On 5 September 2026
 * `npm run release` exited 1 right here: Windows Defender was still scanning
 * `dist/.staged/popup/popup.js` when `Compress-Archive` came to read it, the
 * zip was never written, this file threw ENOENT on the missing archive, and
 * `release-check.mjs` — the whole point of the release script — never ran. The
 * second run passed, which is what a transient file lock looks like.
 *
 * `build-browsers.mjs` went through both runs untouched, because it had
 * already been taught to retry the compress, count the entries and rename over
 * the top. It is the same lesson, so it is now the same code: `packVerified`
 * in `tools/lib-zip.mjs`, which carries the reasoning for all three.
 */
let result;
try {
  // Compress-Archive ships with Windows PowerShell; zip is the POSIX fallback.
  result = await packVerified({
    zip: outFile,
    expectedFiles,
    pack: (tmp) => {
      if (process.platform === 'win32') {
        const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
        // `$ErrorActionPreference='Stop'` and an explicit `exit 1`: a locked
        // file raises a *non-terminating* error, so without these PowerShell
        // exits 0 and hands back a zip that is short, or no zip at all.
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "$ErrorActionPreference='Stop'; try { " +
              `Compress-Archive -Path ${list} -DestinationPath '${tmp}' -Force` +
              ' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
          ],
          // cwd = the output folder, not the extension: a PowerShell that cannot resolve LOCALAPPDATA writes
          // Microsoft/Windows/PowerShell/ModuleAnalysisCache relative to its cwd, and that once landed in the shipped tree (1015).
          { stdio: ['ignore', 'pipe', 'inherit'], cwd: outDir }
        );
      } else {
        // `zip` can exclude by name, so nothing needs staging on this side.
        execFileSync('zip', ['-r', tmp, ...include, ...(notes.length ? ['-x', ...notes] : [])], {
          cwd: EXT,
          stdio: ['ignore', 'pipe', 'inherit'],
        });
      }
    },
    onRetry: (note) => console.log(`  note  ${path.basename(outFile)} ${note}`),
  });
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

if (!result.ok) {
  // Loud, and fatal. A release that could not write the store package must not
  // print a size and exit 0.
  console.error(`\ncould not write ${path.relative(EXT, outFile)} after ${result.attempts} attempt(s): ${result.error}`);
  process.exit(1);
}
if (result.attempts > 1) console.log(`  note  ${path.basename(outFile)} took ${result.attempts} attempts`);

const { size } = fs.statSync(outFile);
console.log(`\nwrote ${path.relative(EXT, outFile)} (${(size / 1024).toFixed(1)} KB, ${result.entries} files)`);
console.log('Upload at https://chrome.google.com/webstore/devconsole');
