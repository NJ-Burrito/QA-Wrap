/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * No em dash in anything a tester reads.
 *
 * An em dash between two clauses is the single loudest tell that a sentence was
 * generated rather than written, and this product's whole voice is a person
 * explaining a tool to another person. `research/22-vibecoded-audit.md` rewrote
 * two hundred and twenty-eight of them by hand; this is what stops the two
 * hundred and twenty-ninth being typed next week.
 *
 * **Copy only.** Comments keep their em dashes — they are prose for whoever
 * reads the file, and half the comments in this codebase are arguing a point
 * that needs one. So both file kinds are tokenised rather than grepped:
 *
 * - `.js`: string literals, template literals and the text parts of templates.
 *   Line and block comments are skipped, and so are regex literals, which
 *   matter only because a `/.../` containing a quote would otherwise open a
 *   string that never closes and swallow the rest of the file.
 * - `.html`: text nodes and the `title`, `aria-label`, `placeholder`, `alt` and
 *   `value` attributes. `<!-- … -->` is skipped for the same reason, and so is
 *   the body of `<script>` and `<style>`, which is not HTML copy. Every one of
 *   these pages loads its script from `src`, so nothing is lost there.
 * - `.md`: the prose, with fenced and indented code blocks and inline code
 *   spans taken out. A `.md` file is nothing but copy, so there is no comment
 *   syntax to respect and no code to skip beyond those three.
 *
 * Escapes are decoded before the check, because `—` is the same dash to
 * a tester and a slightly better hiding place from a grep. HTML entities are
 * decoded for the same reason: `&mdash;` and `&#8212;` render as the character.
 *
 * The one exemption is the bare `'—'` standing in for a value that is
 * missing — a cell in a table, a field with nothing in it. That is an en-rule,
 * not prose, and the audit ruled it stays. A literal that is exactly one em
 * dash is therefore allowed; an em dash anywhere else in a literal is not —
 * including `" — "` between two `${}` slots, which is the label join the audit
 * replaced with a colon, and which trims down to the same character.
 *
 * **Two shapes the exemption does not cover**, both found on screen by the film
 * critic on 6 September and neither catchable by the literal-by-literal rule
 * above, because in both the literal really is exactly one em dash:
 *
 * 1. `LCP ${m.lcp — — '—'}ms` renders as **"—ms"**. A no-value glyph welded
 *    to a unit is not a cell standing empty, it is a sentence with a hole in it.
 * 2. `el('span', 'metric-v', x == null ? '—' : ...)` draws the glyph as a
 *    value in the interface — in the Quality tab's INP tile it was a long
 *    horizontal line at 17px, which on a projector reads as a broken tool
 *    rather than as an absent measurement.
 *
 * Both are matched against the source rather than against a literal, because
 * what makes them wrong is their surroundings. Exports keep their table cells:
 * `| Start URL | ${session.startUrl || '—'} |` is untouched by either shape,
 * and there are sixty-odd of those.
 *
 * The file list is walked, not typed. Every `.js` under `extension/` outside
 * `vendor/`, `tools/`, `node_modules/`, `dist/` and the dot-directories (the
 * throwaway Chrome profiles the headed suites leave behind), and every `.html`
 * outside `vendor/` and `tutorials/`. A file added next week is covered the day
 * it lands, which is the only version of this test worth having.
 *
 * The Markdown list is not walked, and deliberately: most `.md` in this tree is
 * a working note, and a note is prose for whoever works on the file, exactly
 * like a comment. The ones that ship are already enumerated once, in
 * `SHIPPING_DOCS` in `tools/lib-ship.mjs`, which is what the packagers read to
 * decide what a user receives. This reads the same list rather than a second
 * copy of it, so a document added to a package is scanned the day it is added.
 * `research/27-final-verification.md` found twenty-five em dashes across
 * SECURITY.md, CHANGELOG.md and RELEASE.md that were out of scope until now.
 *
 *   node tools/test-copy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPING_DOCS } from './lib-ship.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EM = '—';

/** Not product code: third-party bundles, the test harness itself, build output. */
const SKIP_DIRS = new Set(['vendor', 'tools', 'node_modules', 'dist', '.checkpoints']);
/** `tutorials/` ships its pages from a generator, so its HTML is not hand-written copy. */
const HTML_SKIP_DIRS = new Set(['tutorials']);

/** Every file in scope, `.js` and `.html`, in a stable order. */
function walk(dir, rel = '') {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const at = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // A leading dot is a Chrome profile or a checkpoint, never a source tree.
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      out.push(...walk(path.join(dir, entry.name), at));
      continue;
    }
    if (entry.name.endsWith('.js')) out.push(at);
    else if (entry.name.endsWith('.html') && !at.split('/').some((s) => HTML_SKIP_DIRS.has(s))) out.push(at);
  }
  return out;
}

/**
 * The documents a package actually contains, in the order they are listed.
 *
 * `SHIPPING_DOCS` holds `LICENSE` and `NOTICE` too, which have no extension and
 * no Markdown to strip; they are legal text and not this test's business.
 */
const shippedDocs = () =>
  [...SHIPPING_DOCS]
    .filter((name) => name.endsWith('.md'))
    .filter((name) => fs.existsSync(path.join(EXT, name)))
    .sort((a, b) => a.localeCompare(b));

/** Offset to 1-based line, so no scanner has to keep a running count correct. */
function lineFinder(src) {
  const nl = [];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') nl.push(k);
  return (off) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/** Words that cannot end an expression, so a `/` after one opens a regex. */
const NOT_AN_OPERAND = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * The string literals in one JS file, as `{ line, text }`.
 *
 * A hand-rolled scanner rather than a parser dependency: these are plain
 * scripts and modules, the states are few, and a `node_modules` entry for one
 * test is exactly the kind of thing this codebase does not do.
 *
 * The usual heuristic settles `/`: it is a regex when the last meaningful thing
 * before it cannot end an expression. The last *character* is not enough for
 * that, because `return /[",\n]/.test(s)` ends in `n` and would read as
 * division; `formats.js:241` is the line that proves it. So the scanner keeps
 * the last word as well, and a keyword that cannot end an expression counts the
 * same as a comma.
 *
 * The one shape worth naming is `${…}`. Its contents are code, not text, and
 * code can hold anything the file can hold: another template, an object
 * literal, a comment, a regex. `selector-engine.js:439` is the case that proves
 * it, `` `'${String(s).replace(/'/g, "\\'")}'` ``, where a lone quote lives
 * inside a regex inside an expression inside a template. So an expression is
 * not skipped by a private inner loop; the scanner pushes a frame and keeps
 * reading in code mode, counting braces until the one that closes it. Everything
 * the top level understands is understood in there too.
 */
function literals(src) {
  const found = [];
  let line = 1;
  let i = 0;
  let prev = ''; // the last significant character seen in code
  let prevWord = ''; // and the whole word it belongs to, when it is one
  const push = (start, end, at) => found.push({ line: at, text: src.slice(start, end) });
  // One frame per open template. `inText` says which half we are in; `depth`
  // counts the braces of the expression we are inside while we are in code.
  const tpl = [];

  while (i < src.length) {
    const top = tpl.length ? tpl[tpl.length - 1] : null;
    const c = src[i];
    const next = src[i + 1];

    if (top && top.inText) {
      if (c === '\\') { if (next === '\n') line++; i += 2; continue; }
      if (c === '\n') { line++; i++; continue; }
      if (c === '$' && next === '{') {
        push(top.start, i, top.at);
        top.inText = false;
        top.depth = 0;
        prev = ''; // an expression opens with nothing behind it, so `/` is a regex
        prevWord = '';
        i += 2;
        continue;
      }
      if (c === '`') { push(top.start, i, top.at); tpl.pop(); i++; prev = '`'; prevWord = ''; continue; }
      i++;
      continue;
    }

    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '/' && (!/[\w$)\]]/.test(prev) || NOT_AN_OPERAND.has(prevWord))) {
      // A regex literal. Skipped whole, character classes included, because a
      // `/` inside `[...]` does not end it.
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        else if (src[i] === '\n') { line++; break; } // not a regex after all
        i++;
      }
      prev = '/';
      prevWord = '';
      continue;
    }
    if (c === "'" || c === '"') {
      const at = line;
      const start = ++i;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { if (src[i + 1] === '\n') line++; i++; }
        else if (src[i] === '\n') line++;
        i++;
      }
      push(start, i, at);
      i++;
      prev = c;
      prevWord = '';
      continue;
    }
    if (c === '`') { tpl.push({ inText: true, depth: 0, start: i + 1, at: line }); i++; continue; }
    if (top && c === '{') { top.depth++; i++; prev = c; prevWord = ''; continue; }
    if (top && c === '}') {
      if (top.depth === 0) { top.inText = true; top.start = i + 1; top.at = line; i++; continue; }
      top.depth--;
      i++;
      prev = c;
      prevWord = '';
      continue;
    }
    if (/[\w$]/.test(c)) {
      // A whole word at a time, so `return` is not mistaken for its last letter.
      const wordStart = i;
      while (i < src.length && /[\w$]/.test(src[i])) i++;
      prevWord = src.slice(wordStart, i);
      prev = src[i - 1];
      continue;
    }
    if (!/\s/.test(c)) { prev = c; prevWord = ''; }
    i++;
  }
  return found;
}

/** The attributes a tester reads. `value` is on it because a button's face is its value. */
const COPY_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'value']);
/** Raw text: the body is JS or CSS, not HTML copy. */
const RAW_TEXT = new Set(['script', 'style']);

/** And `&mdash;` is the same character again, which is why HTML is decoded before it is read. */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };
const decodeEntities = (text) =>
  text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => (name in NAMED ? NAMED[name] : m));

/**
 * The copy in one HTML file, as `{ line, text }`: text nodes and the five
 * attributes above. Entities are decoded on the way out, which is safe because
 * none of them is a newline, so the line arithmetic still holds.
 */
function htmlCopy(src) {
  const found = [];
  const lineAt = lineFinder(src);
  const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
  const push = (text, at) => { if (text.trim()) found.push({ line: lineAt(at), text }); };
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { push(decodeEntities(src.slice(i)), i); break; }
    if (lt > i) push(decodeEntities(src.slice(i, lt)), i);

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    let j = lt + 1;
    const nameStart = j;
    while (j < src.length && !isSpace(src[j]) && src[j] !== '>' && src[j] !== '/') j++;
    const tag = src.slice(nameStart, j).toLowerCase();

    while (j < src.length && src[j] !== '>') {
      if (isSpace(src[j]) || src[j] === '/') { j++; continue; }
      const aStart = j;
      while (j < src.length && !isSpace(src[j]) && src[j] !== '=' && src[j] !== '>' && src[j] !== '/') j++;
      const attr = src.slice(aStart, j).toLowerCase();
      while (j < src.length && isSpace(src[j])) j++;
      if (src[j] !== '=') continue; // a bare attribute, so the next loop reads the one after it
      j++;
      while (j < src.length && isSpace(src[j])) j++;
      let value = '';
      let valueAt = j;
      if (src[j] === '"' || src[j] === "'") {
        const quote = src[j];
        valueAt = ++j;
        while (j < src.length && src[j] !== quote) j++;
        value = src.slice(valueAt, j);
        j++;
      } else {
        while (j < src.length && !isSpace(src[j]) && src[j] !== '>') j++;
        value = src.slice(valueAt, j);
      }
      if (COPY_ATTRS.has(attr)) push(decodeEntities(value), valueAt);
    }
    i = j + 1;

    if (RAW_TEXT.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, i);
      i = close === -1 ? src.length : close;
    }
  }
  return found;
}

/**
 * The prose in one Markdown file, as `{ line, text }`.
 *
 * Line by line, because that is how Markdown is written and how a failure has
 * to be reported. Three things are not prose and come out first:
 *
 * - a fenced block, ``` or ~~~, whose body is a command or a snippet. An em
 *   dash inside one would be a bug in the command, not in the voice.
 * - an indented code block, four spaces or a tab, which is the same thing
 *   written the old way. A list continuation is indented too, so this counts
 *   only when the line before it was blank.
 * - an inline `code span`, for the same reason at the scale of a word.
 *
 * A table cell holding nothing but `—` is the no-value glyph the audit ruled
 * stays, exactly as in HTML, so the caller splits on the pipe before judging.
 */
function mdCopy(src) {
  const found = [];
  const lines = src.split('\n');
  let fence = null;
  let blankBefore = true;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const opener = /^ {0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      continue;
    }
    if (opener) { fence = opener[1]; blankBefore = false; continue; }
    if (blankBefore && /^(?: {4}|\t)\s*\S/.test(line)) continue;
    blankBefore = !line.trim();
    found.push({ line: k + 1, text: line.replace(/`[^`\n]*`/g, ' ') });
  }
  return found;
}

/** `—` is the same character to a tester, so it is the same offence here. */
const decode = (text) =>
  text
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));

/**
 * One record per source line.
 *
 * A template literal or a text node can run for forty lines, and reporting the
 * whole thing against the line it started on sends the reader to the wrong
 * place. Splitting first costs nothing: an em dash is one character and never
 * straddles a newline, and neither does any escape that produces one.
 */
const perLine = (records, dec) => {
  const out = [];
  for (const r of records) {
    const parts = r.text.split('\n');
    for (let k = 0; k < parts.length; k++) {
      const text = dec(parts[k]);
      if (text.trim()) out.push({ line: r.line + k, text });
    }
  }
  return out;
};

/**
 * The two shapes above, as they appear in source. Deliberately narrow: each
 * names the surroundings that make the glyph copy rather than a cell.
 */
const GLUED_TO_A_UNIT = /(?:\?\?|\|\|)[^}\n]*'—'[^}\n]*\}[A-Za-z0-9]/g;
const DRAWN_AS_A_VALUE = /\bel\((?:[^()\n]|\([^()\n]*\))*'—'/g;

/** Where in the file a match landed, as a line number. */
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

let fail = 0;
let clean = 0;
for (const rel of [...walk(EXT), ...shippedDocs()]) {
  const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
  const kind = rel.endsWith('.html') ? 'html' : rel.endsWith('.md') ? 'md' : 'js';
  const copy =
    kind === 'html' ? perLine(htmlCopy(src), (t) => t)
      : kind === 'md' ? perLine(mdCopy(src), (t) => t)
        : perLine(literals(src), decode);
  // Class A, and only Class A. In JS the spaces around the dash are part of the
  // literal, and `" — "` between two `${}` slots is precisely the label join the
  // audit replaced with a colon, so the comparison there is exact. In HTML the
  // same spaces are indentation the browser collapses, so a cell holding a lone
  // `—` is the no-value glyph however it was laid out. Markdown reads like
  // HTML here: a table cell is a cell whether it is written as one or rendered
  // as one, so the line is split on the pipe and each cell judged on its own.
  const classA =
    kind === 'html' ? (t) => t.trim() === EM
      : kind === 'md' ? (t) => t.split('|').every((cell) => !cell.includes(EM) || cell.trim() === EM)
        : (t) => t === EM;
  const bad = copy.filter((l) => l.text.includes(EM) && !classA(l.text));

  /*
   * The two shapes the literal rule cannot see, on `.js` only: they are about
   * the code around the glyph, so there is nothing to tokenise.
   *
   * Scoped, for one morning, to the surfaces this pass owns. The same shape is
   * live in four places whose files belong to other people right now, and each
   * is the same one-line fix, a metric that was not measured saying so:
   *
   *   background/context-menus.js:272    LCP <lcp or dash>ms
   *   background/service-worker.js:1465  *Page speed:* LCP <lcp or dash>ms
   *   devtools/panel.js:195              Page speed: LCP <lcp or dash>ms
   *   devtools/panel.js:367              el(span, v, value == null ? dash : ...)
   *
   * Delete OWNED_BY_THIS_PASS the moment those land: the shapes are the rule,
   * the scope is only the schedule.
   */
  const OWNED_BY_THIS_PASS = /^(report|popup|core|platform)\//;
  if (kind === 'js' && OWNED_BY_THIS_PASS.test(rel)) {
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
    for (const [re, why] of [[GLUED_TO_A_UNIT, 'a no-value glyph welded to a unit renders as "—ms"'], [DRAWN_AS_A_VALUE, 'a bare em dash drawn as a value in the interface']]) {
      re.lastIndex = 0;
      for (const m of noComments.matchAll(re)) {
        bad.push({ line: lineOf(noComments, m.index), text: `${m[0].trim().slice(0, 90)}   <- ${why}` });
      }
    }
  }

  if (!bad.length) { clean++; continue; }
  fail += bad.length;
  for (const b of bad) console.log(`  FAIL  ${rel}:${b.line}\n          ${b.text.trim().slice(0, 120)}`);
}

console.log(
  fail
    ? `\n${fail} em dash(es) in copy, across ${clean} clean file(s), rewrite them: see research/22-vibecoded-audit.md\n`
    : `\nno em dash in any string a tester reads (${clean} files)\n`,
);
process.exit(fail ? 1 : 0);
