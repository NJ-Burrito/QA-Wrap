/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The dependency direction, enforced rather than described.
 *
 *   node tools/test-layers.mjs
 *
 * ── why a script and not dependency-cruiser ────────────────────────────────
 *
 * `dependency-cruiser` is the standard answer and research/51c names it. It
 * also brings a dependency, a config file and a resolver that would have to be
 * taught about `importScripts` and about HTML `<script src>` — and half this
 * extension's edges are HTML, because four surfaces are classic scripts. A
 * repo with no build step, no linter and no CI is better served by one file it
 * can read in ten minutes, in the shape `test-worker-imports.mjs` already
 * established.
 *
 * ── the layers ────────────────────────────────────────────────────────────
 *
 * An import may point at its own rank or a lower one, never up:
 *
 *   0  assets     icons/ brand/ vendor/     leaves; nothing imports out of them
 *   1  core       core/                     pure logic, zero chrome.*
 *   2  platform   platform/                 the shared chrome.* adapters
 *   3  ui         ui/                       tokens, fonts, the surface globals
 *   4  entries    background/ offscreen/ content/ and the twelve pages
 *
 * Plus one rule ranks cannot express: **an entry may not import another
 * entry.** `background/` and `offscreen/` are one group and the only
 * exception, because the offscreen document is the worker's own DOM — the
 * doors (`jira-door.js`, `istqb-render-door.js`, `postman-door.js`) exist so
 * that `offscreen/offscreen.js` can lazily import `background/jira.js`. That
 * is the mechanism, not a leak.
 *
 * ── why `chrome.*` and not "no browser globals" ───────────────────────────
 *
 * Five files in `core/` name a DOM global inside a function: `db.js`
 * (`indexedDB`), `docshell.js` and `fine-print.js` (`document`),
 * `file-types.js` (`MediaRecorder`), `capabilities.js` (`navigator`). Making
 * "zero DOM" the boundary would push `docshell.js` into `platform/`, and
 * `docs.js`, `exporters.js` and `links-report.js` all import it — so the rule
 * would be broken on the day it was written. `chrome.*` is the line that is
 * true today, and a true invariant is worth more than an aspirational one.
 *
 * The scan strips comments and string literals first. Seven files in the old
 * `lib/` matched a raw `grep -l "chrome\."` only because they *document* that
 * they do not call it — `correlate.js:42` says "no `chrome.*`" in so many
 * words. A rule that punishes a file for explaining itself gets ignored.
 *
 * ── known exceptions cannot rot ───────────────────────────────────────────
 *
 * Each row in `KNOWN` carries a reason. The gate fails on an unlisted
 * violation *and* on a listed exception that is no longer a violation, so the
 * list can only shrink. That is the same discipline `test-worker-imports.mjs`
 * applies to its ceilings: a raise is recorded with its debt, never quietly
 * absorbed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** rank, lowest first. An edge may not point at a higher rank. */
const RANK = { assets: 0, core: 1, platform: 2, ui: 3, entry: 4 };

/** Which layer each shipped top-level folder is in. */
const LAYER = {
  icons: 'assets', brand: 'assets', vendor: 'assets',
  core: 'core',
  jira: 'entry', // ui-1019: the Jira page scripts (content scripts); the pure code is core/jira-helper-core.js and core/jira-notifier.js
  platform: 'platform',
  ui: 'ui',
  background: 'entry', offscreen: 'entry', content: 'entry',
  popup: 'entry', options: 'entry', report: 'entry', devtools: 'entry',
  annotate: 'entry', api: 'entry', diagram: 'entry', replay: 'entry',
  reporter: 'entry', sidepanel: 'entry', tutorials: 'entry', welcome: 'entry',
};

/**
 * Entries that are one unit. Everything else is its own group.
 *
 * The worker and its offscreen document are two folders and one program: the
 * worker opens the document, the document imports the worker's door
 * implementations, and neither is reachable without the other.
 */
const GROUP = { background: 'worker', offscreen: 'worker' };
const groupOf = (dir) => GROUP[dir] ?? dir;

/**
 * Edges that are allowed to break a rule, each with the reason it exists.
 *
 * An entry with no matching edge in the tree is a failure, not a pass: a stale
 * exemption is how a rule stops meaning anything.
 */
const KNOWN = [
  {
    from: 'report/report.js',
    to: 'background/notify.js',
    why: 'report.js lazily imports summarise() to build a chat summary. notify.js '
      + 'calls chrome.notifications, so it cannot move to core/, and lifting the '
      + 'pure summarise() out of it is a code change rather than a move. This is '
      + 'the last entry-to-entry edge in the tree.',
  },
];

/* ── the tree ──────────────────────────────────────────────────────────── */

const SCANNED = /\.(js|mjs|html|css)$/;

function walk(rel) {
  const abs = path.join(EXT, rel);
  if (!fs.existsSync(abs)) return [];
  const key = rel.split(path.sep).join('/');
  if (fs.statSync(abs).isFile()) return SCANNED.test(key) ? [key] : [];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}

const files = Object.keys(LAYER).flatMap((d) => walk(d)).sort();
const source = new Map(files.map((f) => [f, fs.readFileSync(path.join(EXT, f), 'utf8')]));

/* ── every way one file names another ──────────────────────────────────── */

/**
 * `<a href>` is deliberately absent. `popup/popup.html` links to
 * `../options/options.html` and that is navigation, not a dependency; only
 * `<link>` and `<script src>` load code or styles.
 */
const SPECS = [
  { re: /\bimport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, kind: 'import' },
  /* `import './x.js';` for its side effects, which has no `from`. */
  { re: /\bimport\s*['"]([^'"]+)['"]/g, kind: 'side-effect import' },
  { re: /\bexport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, kind: 'export from' },
  { re: /(^|[^.\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: 'import()', group: 2 },
  { re: /\bimportScripts\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: 'importScripts' },
  { re: /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi, kind: 'script src' },
  { re: /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi, kind: 'link href' },
  { re: /@import\s+(?:url\()?\s*["']([^"']+)["']/g, kind: 'css @import' },
];

/**
 * Strip comments, keep strings.
 *
 * The specifier *is* a string, so the edge scan cannot blank string literals
 * the way `test-worker-imports.mjs` does — it would erase every path it is
 * looking for. Comments are enough: what this has to ignore is a note that
 * names a module in prose, and `core/links-report.js` has three of those.
 */
function noComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Strip comments and string literals, for the `chrome.*` scan. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every internal edge in the tree: from file, to file, how, and where. */
const edges = [];
for (const [file, raw] of source) {
  // JavaScript is read with comments stripped so a `//` note naming a module is
  // not an edge; HTML is read whole, because an HTML comment around a <script>
  // is rare and a commented-out tag still tells you what the page expects.
  const text = file.endsWith('.html') ? raw : noComments(raw);
  for (const { re, kind, group } of SPECS) {
    for (const m of text.matchAll(re)) {
      const spec = m[group ?? 1];
      if (!spec || !spec.startsWith('.')) continue;
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.split(/[?#]/)[0]));
      edges.push({ from: file, to, kind, spec, line: lineOf(raw, m.index) });
    }
  }
}

const dirOf = (file) => file.split('/')[0];
const layerOf = (file) => LAYER[dirOf(file)];

/* ── the checks ────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const used = new Set();
const excuse = (e) => KNOWN.findIndex((k) => k.from === e.from && k.to === e.to);

/** Report an edge as `report/report.js:2688 -> background/notify.js (import())`. */
const show = (e) => `${e.from}:${e.line} -> ${e.to} (${e.kind})`;

console.log('layers — the dependency direction');
console.log(`  (${files.length} files, ${edges.length} internal edges)`);

test('every internal reference points at a file that exists', () => {
  const missing = edges
    .filter((e) => !fs.existsSync(path.join(EXT, e.to)))
    .map((e) => `${e.from}:${e.line} names ${e.spec}`);
  assert.deepEqual(missing, [], `dangling references:\n       ${missing.join('\n       ')}`);
});

test('every reference stays inside a known layer', () => {
  const stray = edges.filter((e) => !layerOf(e.to)).map(show);
  assert.deepEqual(stray, [],
    `these point outside the shipped folders; add the folder to LAYER or fix the path:\n       ${stray.join('\n       ')}`);
});

test('no import points at a higher layer', () => {
  const up = [];
  for (const e of edges) {
    const from = layerOf(e.from);
    const to = layerOf(e.to);
    if (!to || RANK[to] <= RANK[from]) continue;
    const known = excuse(e);
    if (known >= 0) { used.add(known); continue; }
    up.push(`${show(e)}   ${from} -> ${to}`);
  }
  assert.deepEqual(up, [],
    `an import may point at its own layer or lower, never up:\n       ${up.join('\n       ')}`);
});

test('no entry imports another entry', () => {
  const across = [];
  for (const e of edges) {
    if (layerOf(e.from) !== 'entry' || layerOf(e.to) !== 'entry') continue;
    if (groupOf(dirOf(e.from)) === groupOf(dirOf(e.to))) continue;
    const known = excuse(e);
    if (known >= 0) { used.add(known); continue; }
    across.push(show(e));
  }
  assert.deepEqual(across, [],
    `entries talk through messages, not imports; shared code belongs in core/ or platform/:\n       ${across.join('\n       ')}`);
});

test('core/ never touches chrome.*', () => {
  const offenders = [];
  for (const [file, raw] of source) {
    if (layerOf(file) !== 'core' || !file.endsWith('.js')) continue;
    for (const m of codeOnly(raw).matchAll(/\bchrome\s*\.\s*\w+/g)) {
      offenders.push(`${file}:${lineOf(raw, m.index)}  ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    `core/ is the layer the Node suites can run; a chrome.* call belongs in platform/ or at an entry:\n       ${offenders.join('\n       ')}`);
});

test('no import cycles', () => {
  const out = new Map();
  for (const e of edges) {
    if (!/\.(js|mjs)$/.test(e.from) || !/\.(js|mjs)$/.test(e.to)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const state = new Map();
  const cycles = [];
  const visit = (node, stack) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'open') {
      cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '));
      return;
    }
    state.set(node, 'open');
    for (const next of out.get(node) ?? []) visit(next, [...stack, next]);
    state.set(node, 'done');
  };
  for (const node of out.keys()) visit(node, [node]);
  assert.deepEqual([...new Set(cycles)], [],
    `a cycle means neither module can be read on its own:\n       ${[...new Set(cycles)].join('\n       ')}`);
});

test('every known exception is still a real edge', () => {
  const stale = KNOWN.filter((_, i) => !used.has(i)).map((k) => `${k.from} -> ${k.to}`);
  assert.deepEqual(stale, [],
    `these are listed in KNOWN but no longer break a rule. Delete the row:\n       ${stale.join('\n       ')}`);
});

/* ── r9-13-2 / r9-13-4: growth and dead code, ratcheted ───────────────── */

// r10-13-3 (D-242): --tighten rewrites the ceilings to lines = actual + 10 and swallows = actual, and never raises one (--ratchet=<file> points it at a copy).
const RATCHET_FILE = (process.argv.find((a) => a.startsWith('--ratchet=')) || '').slice(10) || path.join(EXT, 'tools/line-ratchet.json');
const RATCHET = JSON.parse(fs.readFileSync(RATCHET_FILE, 'utf8'));
const SWALLOW = /\.catch\(\(\) *=> *\{? *\}?\)/g;
if (process.argv.includes('--tighten')) {
  for (const f of Object.keys(RATCHET.lines)) {
    const text = fs.readFileSync(path.join(EXT, f), 'utf8');
    const n = text.split('\n').length, sw = (text.match(SWALLOW) || []).length;
    const was = [RATCHET.lines[f], RATCHET.swallows[f]];
    RATCHET.lines[f] = Math.min(RATCHET.lines[f], n + 10);
    RATCHET.swallows[f] = Math.min(RATCHET.swallows[f] ?? Infinity, sw);
    console.log(`  tighten ${f}: lines ${was[0]} -> ${RATCHET.lines[f]} (actual ${n}), swallows ${was[1]} -> ${RATCHET.swallows[f]}`);
  }
  fs.writeFileSync(RATCHET_FILE, `${JSON.stringify(RATCHET, null, 2)}\n`);
}

test('the four big files stay under their line ceilings and their swallowed-catch ceilings', () => {
  const over = [];
  for (const [f, max] of Object.entries(RATCHET.lines)) {
    const text = fs.readFileSync(path.join(EXT, f), 'utf8');
    const n = text.split('\n').length;
    if (n > max) over.push(`${f}: ${n} lines, ceiling ${max}`);
    const sw = (text.match(SWALLOW) || []).length;
    if (sw > (RATCHET.swallows[f] ?? Infinity)) over.push(`${f}: ${sw} swallowed .catch(() => {}), ceiling ${RATCHET.swallows[f]}`);
  }
  assert.deepEqual(over, [], `these files grew past tools/line-ratchet.json (split the new code out, or handle the rejection):\n       ${over.join('\n       ')}`);
});

/* ── r10-13-4 (D-242): no new escaper; r10-12-1: no untracked file at the extension root ───────────── */

/** Definitions of an HTML/XML escaper, per file. The copies on the allow-list are the ones that exist; a new one fails (use escHtml from core/docshell.js where the layer allows). */
const ESCAPER_NAMES = /\b(?:function|const|let|var)\s+(esc|escHtml|escapeHtml|escAttr|xmlEsc)\b/g;
const ESCAPER_ALLOW = {
  'background/trackers.js:esc': 1, 'content/bar.js:esc': 1, 'content/picker.js:esc': 1, 'content/selector-engine.js:esc': 1,
  'core/artifact.js:esc': 1, 'core/docshell.js:escHtml': 1, 'core/docshell.js:esc': 1, 'core/exporters.js:esc': 1,
  'core/replay.js:escAttr': 1, 'core/xlsx.js:esc': 1, 'devtools/panel.js:esc': 1,
};

test('no new esc / escHtml / escapeHtml / escAttr / xmlEsc definition beyond the allow-list', () => {
  const found = {};
  for (const [f, text] of source) {
    if (f.startsWith('vendor/')) continue;
    for (const m of codeOnly(text).matchAll(ESCAPER_NAMES)) found[`${f}:${m[1]}`] = (found[`${f}:${m[1]}`] || 0) + 1;
  }
  const extra = Object.entries(found).filter(([k, n]) => n > (ESCAPER_ALLOW[k] || 0)).map(([k, n]) => `${k} x${n} (allowed ${ESCAPER_ALLOW[k] || 0})`);
  assert.deepEqual(extra, [], `a new escaper was defined. Import escHtml from core/docshell.js instead of writing another:\n       ${extra.join('\n       ')}`);
  const gone = Object.keys(ESCAPER_ALLOW).filter((k) => !found[k]);
  assert.deepEqual(gone, [], `on the allow-list but no longer defined. Delete the row:\n       ${gone.join('\n       ')}`);
});

const ROOT_ALLOW = ['.DS_Store', 'Thumbs.db'];
test('extension/ root holds no untracked file outside a short allow-list (a stray one-off script is how _ed9.mjs broke the boot smoke)', () => {
  let out;
  try { out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', '.'], { cwd: EXT, encoding: 'utf8' }); } catch { console.log('       (git not available here: root check skipped)'); return; }
  const stray = out.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('/') && !ROOT_ALLOW.includes(l));
  assert.deepEqual(stray, [], `untracked at the extension root. Commit it, move it out, or delete it:\n       ${stray.join('\n       ')}`);
});

/** Every word in every shipped or test source file, with the files that hold it and how often. */
const ALL_SRC = (() => {
  const out = [];
  const go = (rel) => {
    const abs = path.join(EXT, rel);
    if (fs.statSync(abs).isDirectory()) {
      if (/^(node_modules|dist|\.git|coverage|test-results)$/.test(path.basename(abs))) return;
      fs.readdirSync(abs).forEach((n) => go(path.join(rel, n)));
    } else if (/\.(js|mjs|cjs|html|json)$/.test(rel)) out.push(rel.split(path.sep).join('/'));
  };
  go('.');
  return out;
})();
const WORDS = new Map();
for (const f of ALL_SRC) {
  const text = fs.readFileSync(path.join(EXT, f), 'utf8');
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    let per = WORDS.get(m[0]);
    if (!per) WORDS.set(m[0], (per = new Map()));
    per.set(f, (per.get(f) || 0) + 1);
  }
}

/** The names a source file exports (declarations and `export { a, b as c }` lists, not `export ... from`). */
function exportsOf(text) {
  const names = [];
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return names;
}

test('every export is referenced somewhere (zero-reference exports are dead code)', () => {
  const allow = new Set(RATCHET.deadExportAllowlist);
  const dead = [];
  const used = new Set();
  for (const f of ALL_SRC.filter((x) => /\.(js|mjs)$/.test(x) && !x.startsWith('tools/') && !x.startsWith('vendor/'))) {
    for (const name of exportsOf(fs.readFileSync(path.join(EXT, f), 'utf8'))) {
      const per = WORDS.get(name) || new Map();
      const elsewhere = [...per].filter(([g]) => g !== f).reduce((n, [, c]) => n + c, 0);
      const key = `${f}:${name}`;
      if (elsewhere === 0 && (per.get(f) || 0) <= 1) {
        if (allow.has(key)) used.add(key); else dead.push(key);
      }
    }
  }
  assert.deepEqual(dead, [], `exported and referenced nowhere. Delete the export, or list it in deadExportAllowlist in tools/line-ratchet.json with a reason:\n       ${dead.join('\n       ')}`);
  const stale = [...allow].filter((k) => !used.has(k));
  assert.deepEqual(stale, [], `listed in deadExportAllowlist but referenced now (or gone). Delete the row:\n       ${stale.join('\n       ')}`);
});

if (KNOWN.length) {
  console.log(`\n  ${KNOWN.length} known exception${KNOWN.length === 1 ? '' : 's'}, each with its reason in this file:`);
  for (const k of KNOWN) console.log(`    ${k.from} -> ${k.to}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
