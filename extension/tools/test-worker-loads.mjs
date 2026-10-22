/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Every file the browser loads at start must at least load (test pipeline P5, 12 Oct 2026).
 *
 *   node tools/test-worker-loads.mjs
 *
 * Why: 28aaaf4 fixed a service worker that did not load at all, because one name was imported twice
 * ("Identifier 'withDeadline' has already been declared"). A worker that fails to parse registers nothing, so every
 * suite that talks to it just times out. This suite finds that class in a second, with no browser.
 *
 *   1. The closure. Start at the files Chrome loads on its own (the manifest's service worker and every module script
 *      of the pages the manifest names, plus the report, welcome and offscreen pages) and follow `import`, `export …
 *      from`, `import()` and `importScripts()`. A load that points at a file that is not there is a failure.
 *   2. `node --check` on every file of that closure (parse and early errors: duplicate bindings, bad syntax).
 *   3. What `node --check` cannot see: `import { name }` where the target does not export `name`, and a default import
 *      from a module with no default (rehearsal R11's blind spot; `importProblems` in lib-worker-live.mjs).
 *   4. Proof the gate goes red: a temp copy with a duplicate binding, a missing export, a missing default and a missing
 *      file must each be caught, and the clean copy must be green. A check that cannot fail is not run as a pass.
 *
 * No browser, no network. The engine column reads `none` (the parse is node's, printed with its version).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { EXT } from './lib-paths.mjs';
import { deriveClosure, importProblems, entriesFromManifest } from './lib-worker-live.mjs';

const ENGINE = `none (node ${process.version}, parse only)`;
import { TRASH } from './lib-trash.mjs';
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  [engine=${ENGINE}] ${name}`); }
  else { failures.push(name); console.log(`  FAIL  [engine=${ENGINE}] ${name}${detail ? `\n        ${detail}` : ''}`); }
};

/** `node --check` over many files, `jobs` at a time. Resolves to `[{file, err}]` for the red ones. */
async function checkAll(files, jobs = 6) {
  const red = [];
  let next = 0;
  const one = (f) => new Promise((resolve) => {
    const p = spawn(process.execPath, ['--check', f], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) red.push({ file: f, err: err.split(/\r?\n/).find((l) => /Error/.test(l)) || err.trim().split(/\r?\n/)[0] });
      resolve();
    });
  });
  await Promise.all(Array.from({ length: jobs }, async () => { while (next < files.length) await one(files[next++]); }));
  return red;
}

console.log(`worker-loads: engine=${ENGINE}`);

/* ── 1-3: the real tree ──────────────────────────────────────────────────── */
const { entries, pages, worker } = entriesFromManifest(EXT);
const t0 = Date.now();
const closure = deriveClosure(EXT, entries);
const rel = (f) => path.relative(EXT, f).split(path.sep).join('/');
console.log(`  closure: ${closure.files.length} files from ${entries.length} entries (${pages.length} pages), ${closure.dynamicOnly.length} reached only lazily, derived in ${Date.now() - t0} ms`);

check(!!worker && closure.files.some((f) => rel(f) === worker), `the closure starts at the manifest service worker (${worker})`);
check(closure.files.length >= 40, `the closure is not vacuous (${closure.files.length} files, at least 40 expected)`);
check(closure.missing.length === 0, 'every import in the closure points at a file that exists',
  closure.missing.slice(0, 5).map((m) => `${m.from} -> ${m.spec}`).join('; '));

const t1 = Date.now();
const red = await checkAll(closure.files);
check(red.length === 0, `node --check: all ${closure.files.length} files parse (${Date.now() - t1} ms)`,
  red.slice(0, 5).map((r) => `${rel(r.file)}: ${r.err}`).join('\n        '));

const problems = importProblems(EXT, closure.files, []);
check(problems.checked >= 200, `the export check compared real names (${problems.checked} named imports, at least 200 expected)`);
check(problems.length === 0, 'every named and default import is exported by its target',
  problems.slice(0, 8).map((p) => `${p.kind} ${p.from} -> ${p.spec}${p.name ? ` { ${p.name} }` : ''}`).join('\n        '));

/* ── 4: the gate goes red on a broken copy ───────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-worker-loads-'));
const put = (name, body) => { const f = path.join(tmp, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
try {
  put('package.json', '{"type":"module"}\n');
  put('lib/a.js', 'export const foo = 1;\nexport function bar() {}\nexport { foo as baz };\nexport default 7;\n');
  put('lib/nodef.js', 'export const only = 1;\n');
  put('lib/star.js', "export * from './a.js';\n");

  // Clean copy: every import form the real tree uses, all resolvable.
  put('clean/w.js', "import def, { foo, bar as b } from '../lib/a.js';\nimport { baz } from '../lib/star.js';\nimport * as ns from '../lib/a.js';\nconsole.log(def, foo, b, baz, ns);\n");
  let c = deriveClosure(tmp, ['clean/w.js']);
  check(c.files.length === 3 && c.missing.length === 0 && importProblems(tmp, c.files, c.missing).length === 0 && (await checkAll(c.files)).length === 0,
    'control: a clean copy (default, aliased, re-exported and namespace imports) is green');

  // Duplicate binding: the 28aaaf4 defect, node --check territory.
  put('dup/w.js', "import { foo } from '../lib/a.js';\nfunction foo() {}\nexport { foo };\n");
  const dupRed = await checkAll([path.join(tmp, 'dup/w.js')]);
  check(dupRed.length === 1 && /already been declared/.test(dupRed[0].err), 'control: a duplicate import binding goes red under node --check', dupRed[0]?.err);

  // The blind spot: node --check passes this one, importProblems must not.
  put('miss/w.js', "import { foo, nope } from '../lib/a.js';\nconsole.log(foo, nope);\n");
  c = deriveClosure(tmp, ['miss/w.js']);
  const parseRed = await checkAll(c.files);
  const mp = importProblems(tmp, c.files, c.missing);
  check(parseRed.length === 0 && mp.length === 1 && mp[0].kind === 'missing-export' && mp[0].name === 'nope',
    'control: an import of a name the target does not export passes node --check and is caught by the export check', JSON.stringify({ parseRed: parseRed.length, mp }));

  put('miss/d.js', "import thing from '../lib/nodef.js';\nconsole.log(thing);\n");
  c = deriveClosure(tmp, ['miss/d.js']);
  check(importProblems(tmp, c.files, c.missing).some((p) => p.kind === 'missing-default'), 'control: a default import from a module with no default is caught');

  put('miss/f.js', "import { x } from './not-there.js';\nconsole.log(x);\n");
  c = deriveClosure(tmp, ['miss/f.js']);
  check(c.missing.length === 1 && c.missing[0].spec === './not-there.js', 'control: an import of a file that does not exist is reported as missing');

  // A name in a comment or a string is not an export.
  put('lib/ghost.js', "// export const ghost = 1;\n/*\n * export const ghost2 = 2;\n */\nexport const real = 1;\nconst s = 'export const ghost3 = 3;';\n");
  put('miss/g.js', "import { ghost } from '../lib/ghost.js';\nconsole.log(ghost);\n");
  c = deriveClosure(tmp, ['miss/g.js']);
  check(importProblems(tmp, c.files, c.missing).some((p) => p.name === 'ghost'), 'control: an export that exists only in a comment does not count');
} finally {
  try { execFileSync('python', [TRASH, tmp], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { console.log(`note: could not recycle ${tmp}`); }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
