/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The folder contract, pinned.
 *
 *   node tools/test-filing.mjs
 *
 * Every assertion here failed on 7 September 2026 against a real session Nader
 * recorded on YouTube and handed over as evidence
 * (`research/54-real-session-review.md`). The folder on his disk had:
 *
 *   - a `QA Wrap/QA Wrap/` nest, because the root is prepended whether or not
 *     the folder it is going into is already the root;
 *   - `Accessibility/` and `Recordings/` standing empty in a session that had
 *     neither, because the tree was laid down before anything was written;
 *   - a 12 KB `Requirements specification-…(2).md` that is not a requirements
 *     specification at all, because two other documents were saved under that
 *     format's filename;
 *   - and thirty-eight files that the browser had no record of.
 *
 * `core/filing.js` is pure, so five of the six rules are testable here with no
 * browser at all. The sixth — the download list — is a `chrome.downloads` call
 * shape, and is checked by reading the source of the two files that make it,
 * which is worth doing because the property that guarantees it is one word that
 * a refactor would not miss.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ROOT, CATEGORIES, FORMATS, withFolder, pathInside, exportPath, evidencePath,
  ensureTree, writeToDirectory, destination, describeDestination, describeSaved, splitExtension,
} from '../core/filing.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* The session as it was: the stamp below is a fixture, so a failure here reads
   against a recorded folder layout. */
const session = { id: 's_fixture01', charter: 'test one fixture', startedAt: Date.UTC(2026, 8, 7, 11, 51, 0) };
const clock = '24';

/* ── an in-memory FileSystemDirectoryHandle ─────────────────────────────────
 *
 * Enough of the real interface for `ensureTree` and `writeToDirectory`: named
 * directories that remember their children, file handles with a writable
 * stream, and a `getFileHandle` that throws when the file is not there, which
 * is what `exists()` is reading. Node's own `fs` would test Node's `fs`; the
 * bug being guarded is in how the *handle's* name is used.
 */
function dirHandle(name) {
  const dirs = new Map();
  const files = new Map();
  return {
    kind: 'directory',
    name,
    dirs,
    files,
    async getDirectoryHandle(child, { create = false } = {}) {
      if (!dirs.has(child)) {
        if (!create) throw Object.assign(new Error(`no ${child}`), { name: 'NotFoundError' });
        dirs.set(child, dirHandle(child));
      }
      return dirs.get(child);
    },
    async getFileHandle(child, { create = false } = {}) {
      if (!files.has(child)) {
        if (!create) throw Object.assign(new Error(`no ${child}`), { name: 'NotFoundError' });
        files.set(child, { data: null });
      }
      const entry = files.get(child);
      return { async createWritable() { return { async write(d) { entry.data = d; }, async close() {} }; } };
    },
  };
}

/** Every file path in a tree, so a whole layout can be asserted at once. */
function walk(handle, prefix = '') {
  const out = [];
  for (const name of handle.files.keys()) out.push(`${prefix}${name}`);
  for (const [name, child] of handle.dirs) out.push(...walk(child, `${prefix}${name}/`));
  return out.sort();
}
/** Every directory in a tree, including the empty ones. That is the point. */
function walkDirs(handle, prefix = '') {
  const out = [];
  for (const [name, child] of handle.dirs) {
    out.push(`${prefix}${name}`);
    out.push(...walkDirs(child, `${prefix}${name}/`));
  }
  return out.sort();
}

/* ── rule 1: QA Wrap appears exactly once ───────────────────────────────── */

console.log('\nRule 1 — one root per path');

test('a folder called QA Wrap does not double the root', () => {
  assert.equal(
    exportPath('markdown', session, { clock, folder: 'QA Wrap' }),
    `${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md`
  );
});

test('however it was typed', () => {
  for (const typed of ['qa wrap', 'QA WRAP', '  QA Wrap  ']) {
    assert.equal(withFolder(`${ROOT}/Reports/x.md`, typed), `${ROOT}/Reports/x.md`, typed);
  }
});

test('a real folder is still prefixed', () => {
  assert.equal(withFolder(`${ROOT}/Reports/x.md`, 'Clients/ACME'), `Clients/ACME/${ROOT}/Reports/x.md`);
});

test('the root is dropped only where it is the whole segment', () => {
  assert.equal(withFolder(`${ROOT}/Reports/x.md`, 'QA Wrap archive'), `QA Wrap archive/${ROOT}/Reports/x.md`);
});

test('a granted folder already called QA Wrap absorbs the root', () => {
  assert.equal(pathInside('QA Wrap', `${ROOT}/Reports/x.md`), 'Reports/x.md');
});

test('any other granted folder keeps it', () => {
  assert.equal(pathInside('Portal QA', `${ROOT}/Reports/x.md`), `${ROOT}/Reports/x.md`);
  assert.equal(pathInside('', `${ROOT}/Reports/x.md`), `${ROOT}/Reports/x.md`);
});

test('only the leading root is absorbed', () => {
  assert.equal(pathInside('QA Wrap', `${ROOT}/Reports/${ROOT} notes.md`), `Reports/${ROOT} notes.md`);
});

/* ── rule 2 and 3: folders created, never replaced; only what is used ───── */

console.log('\nRules 2 and 3 — folders added to, and only the ones being used');

await testAsync('writing into a folder called QA Wrap makes one level, not two', async () => {
  const root = dirHandle('QA Wrap');
  await writeToDirectory(root, exportPath('markdown', session, { clock }), 'x');
  assert.deepEqual(walk(root), ['Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md']);
});

await testAsync('writing into any other folder keeps the root', async () => {
  const root = dirHandle('Portal QA');
  await writeToDirectory(root, exportPath('markdown', session, { clock }), 'x');
  assert.deepEqual(walk(root), [`${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md`]);
});

await testAsync('a save creates no category it is not writing into', async () => {
  const root = dirHandle('Portal QA');
  await writeToDirectory(root, exportPath('markdown', session, { clock }), 'x');
  await writeToDirectory(root, exportPath('jira', session, { clock }), 'x');
  // Nader's run 2 had nine, seven of them empty.
  assert.deepEqual(walkDirs(root), [ROOT, `${ROOT}/Reports`, `${ROOT}/Reports/test one fixture 2026-09-07`, `${ROOT}/Tickets`, `${ROOT}/Tickets/test one fixture 2026-09-07`]);
});

await testAsync('an existing tree is added to, never replaced', async () => {
  const root = dirHandle('Portal QA');
  const qaw = await root.getDirectoryHandle(ROOT, { create: true });
  const reports = await qaw.getDirectoryHandle('Reports', { create: true });
  await (await reports.getFileHandle('Yesterday.md', { create: true })).createWritable();
  await writeToDirectory(root, exportPath('markdown', session, { clock }), 'x');
  assert.deepEqual(walk(root), [
    `${ROOT}/Reports/Yesterday.md`,
    `${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md`,
  ]);
});

await testAsync('ensureTree makes only the categories it is asked for', async () => {
  const root = dirHandle('Portal QA');
  const made = await ensureTree(root, [CATEGORIES.report]);
  assert.deepEqual(made, [`${ROOT}/Reports`]);
  assert.deepEqual(walkDirs(root), [ROOT, `${ROOT}/Reports`]);
});

await testAsync('ensureTree does not nest inside a folder that is the root', async () => {
  const root = dirHandle('QA Wrap');
  await ensureTree(root, [CATEGORIES.report]);
  assert.deepEqual(walkDirs(root), ['Reports']);
});

/* ── rule 4: never overwrite, every copy side by side ───────────────────── */

console.log('\nRule 4 — no overwrite, copies side by side');

await testAsync('saving the same session three times leaves three files', async () => {
  const root = dirHandle('Portal QA');
  const path = exportPath('markdown', session, { clock });
  const written = [];
  for (const body of ['first', 'second', 'third']) written.push(await writeToDirectory(root, path, body));
  assert.equal(new Set(written).size, 3, `three saves produced ${new Set(written).size} names`);
  assert.deepEqual(walk(root), [
    `${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07 (2).md`,
    `${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07 (3).md`,
    `${ROOT}/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md`,
  ]);
});

await testAsync('the suffix goes before a compound extension, so the file still opens', async () => {
  // Five formats in this product have two-part extensions. Numbering at the
  // last dot gives `Session-<stamp>.json (2).gz`, which nothing unzips.
  const root = dirHandle('Portal QA');
  for (const [format, ext] of [
    ['playwright', '.spec.ts'],
    ['postman', '.postman_collection.json'],
    ['postman-env', '.postman_environment.json'],
  ]) {
    const path = exportPath(format, session, { clock });
    await writeToDirectory(root, path, 'a');
    const second = await writeToDirectory(root, path, 'b');
    assert.ok(second.endsWith(ext), `${format}: ${second}`);
    assert.ok(second.includes('(2)'), `${format}: ${second}`);
  }
  const gz = exportPath('json', session, { clock, gz: true });
  await writeToDirectory(root, gz, 'a');
  const secondGz = await writeToDirectory(root, gz, 'b');
  assert.ok(secondGz.endsWith('.json.gz'), secondGz);
});

test('a dot in the tester’s own words is not mistaken for an extension', () => {
  assert.deepEqual(splitExtension('v1.2 login-07-09-26-14-51.md'), ['v1.2 login-07-09-26-14-51', '.md']);
  assert.deepEqual(splitExtension('Re-test-07-09-26-14-51.spec.ts'), ['Re-test-07-09-26-14-51', '.spec.ts']);
  assert.deepEqual(splitExtension('noextension'), ['noextension', '']);
});

await testAsync('the first copy is not touched by the second', async () => {
  const root = dirHandle('Portal QA');
  const path = exportPath('markdown', session, { clock });
  await writeToDirectory(root, path, 'first');
  await writeToDirectory(root, path, 'second');
  const reports = root.dirs.get(ROOT).dirs.get('Reports').dirs.get('test one fixture 2026-09-07');
  assert.equal(reports.files.get('Bug report - test one fixture 2026-09-07.md').data, 'first');
  assert.equal(reports.files.get('Bug report - test one fixture 2026-09-07 (2).md').data, 'second');
});

test('both download call sites say conflictAction uniquify', () => {
  // One word, and rule 4 on the Downloads route rests entirely on it. Chrome's
  // default is uniquify today; a default is not a guarantee.
  const download = read('ui/download.js');
  const calls = download.match(/chrome\.downloads\.download\(\{[^}]*\}/g) || [];
  assert.equal(calls.length, 2, `expected two download calls in ui/download.js, found ${calls.length}`);
  for (const call of calls) assert.match(call, /conflictAction: 'uniquify'/, call);
});

test('the background download paths say it too', () => {
  const media = read('background/media.js');
  const calls = media.match(/chrome\.downloads\.download\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(calls.length >= 2, `expected the rescue and audio downloads, found ${calls.length}`);
  for (const call of calls) assert.match(call, /conflictAction: 'uniquify'/, call);
});

test('the audio export no longer forces a Save dialog per clip', () => {
  // It arrives with a full category path from evidencePath(); a dialog throws
  // that away and asks the tester to place every clip's wav by hand.
  const media = read('background/media.js');
  const audio = media.slice(media.indexOf('export async function exportAudio'));
  assert.match(audio.slice(0, 1500), /saveAs: !!saveAs/);
});

/* ── rule 5: one document, one filename ─────────────────────────────────── */

console.log('\nRule 5 — one document, one filename');

test('no two formats write the same file', () => {
  const seen = new Map();
  for (const [id, f] of Object.entries(FORMATS)) {
    const key = `${f.category}/${f.part}.${f.ext}`;
    // Two shapes of one document are allowed to share a number and a name only
    // when the extension differs; that is what `srs` and `srs-html` are.
    if (seen.has(key)) {
      throw new Error(`${id} and ${seen.get(key)} both write ${key}`);
    }
    seen.set(key, id);
  }
});

test('the fine print has its own name', () => {
  assert.notEqual(
    exportPath('fine-print', session, { clock }),
    exportPath('srs', session, { clock })
  );
  assert.match(exportPath('fine-print', session, { clock }), /Fine print/);
});

test('the specification read from the page has its own name', () => {
  assert.notEqual(
    exportPath('spec-reverse', session, { clock }),
    exportPath('srs', session, { clock })
  );
  assert.match(exportPath('spec-reverse', session, { clock }), /Specification read from the page/);
});

test('the report saves them under those ids, not under srs', () => {
  const report = read('report/report.js');
  assert.match(report, /saveExport\('fine-print',/);
  assert.match(report, /saveExport\('spec-reverse',/);
  // The regression, exactly: both used to be saveExport('srs', …) with only a
  // label to tell them apart, and a label never reaches the filename.
  assert.ok(
    !/saveExport\('srs', read\.markdown/.test(report),
    'a document is still being filed under the specification’s name'
  );
});

/* ── rule 6: a save the browser cannot see says so ──────────────────────── */

console.log('\nRule 6 — the confirmation names the folder and the route');

test('the destination is one path, from one function', () => {
  assert.equal(destination({}), `Downloads/${ROOT}/`);
  assert.equal(destination({ folder: 'Portal QA' }), `Downloads/Portal QA/${ROOT}/`);
  assert.equal(destination({ folder: 'QA Wrap' }), `Downloads/${ROOT}/`);
  assert.equal(destination({ folderName: 'Portal QA' }), `Portal QA/${ROOT}/`);
  assert.equal(destination({ folderName: 'QA Wrap' }), 'QA Wrap/');
});

test('a granted folder is described as invisible to the download list', () => {
  const text = describeDestination({ folderName: 'Portal QA' });
  assert.match(text, /Portal QA\/QA Wrap\//);
  assert.match(text, /do not appear in the browser's download list/);
});

test('Downloads is described as visible in it', () => {
  assert.match(describeDestination({ folderName: '' }), /appears in the browser's download list/);
});

test('the confirmation names the count, the folder and the route', () => {
  const folder = describeSaved({ count: 38, where: 'Portal QA/QA Wrap/', how: 'folder' });
  assert.match(folder, /38 files/);
  assert.match(folder, /Portal QA\/QA Wrap\//);
  assert.match(folder, /not in the browser's download list/);

  const downloads = describeSaved({ count: 1, where: `Downloads/${ROOT}/`, how: 'downloads' });
  assert.match(downloads, /Saved 1 file into/);
  assert.match(downloads, /in the browser's download list/);
});

test('a fallback to Downloads is said out loud', () => {
  // The tester is about to go and look in a folder that has nothing in it.
  const text = describeSaved({ count: 3, where: '', how: 'downloads-fallback' });
  assert.match(text, /could not be written to/);
  assert.match(text, /Downloads/);
});

test('failures are counted separately from what was written', () => {
  const text = describeSaved({ count: 30, where: `Downloads/${ROOT}/`, how: 'downloads', failed: 8 });
  assert.match(text, /30 files/);
  assert.match(text, /8 could not be written/);
});

test('the report announces a finished save outside the page', () => {
  const report = read('report/report.js');
  assert.match(report, /UQADownload\.announce\(/, 'nothing tells the tester who switched windows');
  const download = read('ui/download.js');
  assert.match(download, /chrome\.notifications\?\.create/, 'the notification is not guarded on the API');
});

/* ── the popover, and the evidence tree it all came from ────────────────── */

console.log('\nThe save sheet, and the shapes the real session produced');

test('the save sheet closes on a click outside it', () => {
  const report = read('report/report.js');
  assert.match(report, /save-dialog'\)\.addEventListener\('click'/, 'no outside-click handler');
  assert.match(report, /e\.target === \$\('save-dialog'\)/, 'the backdrop test is not the identity one');
});

test('the Save into placeholder cannot be mistaken for a value', () => {
  const html = read('options/options.html');
  const field = html.match(/<input type="text" id="downloadFolder"[^>]*>/)[0];
  assert.ok(!/placeholder="QA Wrap"/.test(field), 'the placeholder still spells out the root');
  assert.match(field, /placeholder="[^"]+"/);
});

test('every surface that saves passes the tester’s folder', () => {
  // Four surfaces build a path: the report, the popup, the DevTools panel and
  // the diagram editor. Three of them passed the clock and not the folder, so
  // the same session filed into two different places depending on which button
  // was pressed. Nader: "the download is not consistent."
  for (const [file, pattern] of [
    ['report/report.js', /exportPath\(format, session, \{[^}]*folder:/],
    ['popup/popup.js', /exportPath\(btn\.dataset\.format, target, \{[\s\S]{0,120}?folder:/],
    ['devtools/panel.js', /exportPath\(format, tl\.result\.session, \{[\s\S]{0,120}?folder:/],
    ['diagram/diagram.js', /withFolder\(p, settings\?\.result\?\.downloadFolder/],
  ]) {
    assert.match(read(file), pattern, `${file} builds a path without the folder`);
  }
});

test('every category a format names exists in the tree', () => {
  for (const [id, f] of Object.entries(FORMATS)) {
    assert.ok(CATEGORIES[f.category], `${id} files itself under an unknown category ${f.category}`);
  }
});

test('the real session’s paths still come out the way they are on disk', () => {
  // Read straight off Nader's folder, minus the two faults now fixed.
  assert.equal(exportPath('markdown', session, { clock }), 'QA Wrap/Reports/test one fixture 2026-09-07/Bug report - test one fixture 2026-09-07.md');
  assert.equal(exportPath('a11y', session, { clock }), 'QA Wrap/Accessibility/test one fixture 2026-09-07/Accessibility findings - test one fixture 2026-09-07.json');
  assert.equal(exportPath('har', session, { clock, gz: true }), 'QA Wrap/Reports/test one fixture 2026-09-07/Network - test one fixture 2026-09-07.har.gz');
  assert.equal(exportPath('session-manifest', session, { clock }), 'QA Wrap/Sessions/test one fixture 2026-09-07/Session card - test one fixture 2026-09-07.json');
  assert.equal(
    evidencePath({ kind: 'recording', label: 'Screen recording', ts: Date.UTC(2026, 8, 7, 11, 53, 0), ext: 'mp4' }, 1, session, { clock }),
    'QA Wrap/Recordings/test one fixture 2026-09-07/01 Screen recording - test one fixture 2026-09-07.mp4'
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
