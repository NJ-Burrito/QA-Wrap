/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * No `(s)` plural in anything a tester reads.
 *
 * "1 screenshot(s) and 0 recording(s): 32 KB in total" is a line a presenter
 * reads aloud, and the bracket is the tell that the sentence was assembled
 * rather than written. Twelve of them were rewritten by hand on 5 September;
 * this is what stops the thirteenth being typed next week. The product has the
 * pattern already, in `report/report.js`: `plural(n, 'screenshot')`.
 *
 * Copy only, the way `test-copy.mjs` reads copy: a `(s)` counts when it is
 * inside a string, a template literal or an HTML text node. In code,
 * `String(s)`, `map((s) => …)` and `/[",\n]/.test(s)` are not plurals, so this
 * walks the characters of a line rather than grepping it: what matters is
 * whether the bracket is inside a quote and outside a `${…}`. A `(s)` in a
 * comment is left alone — a comment is prose for whoever reads the file, and
 * the comment explaining this rule has to be able to name it.
 *
 * **The whole product tree.** It was scoped to `report/`, `popup/` and four
 * `core/` modules while the other 46 sites belonged to other people; those
 * landed on 6 September, so `SCOPE` is now every directory a tester's words
 * can come out of. `tools/` is not in it: a build script's console output is
 * for whoever runs the build, and it is not shipped.
 *
 * One thing the character walk has to know about, which the prose above named
 * and the code did not do: a **regex literal**. `/[",\n]/.test(s)` opens a
 * quote as far as a naive walker is concerned, and then `.test(s)` looks like
 * a plural inside a string. Three real lines in `core/exporters.js` and
 * `core/formats.js` were reported that way the moment the scope widened, and
 * none of them is copy. So a `/` that cannot be division is skipped whole,
 * character classes included, exactly as `tools/test-copy.mjs` does it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories and files this guard covers. */
const SCOPE = [
  'annotate', 'background', 'content', 'core', 'devtools', 'diagram',
  'offscreen', 'options', 'platform', 'popup', 'report', 'sidepanel', 'tutorials', 'ui',
];

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const here = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), here));
    else if (/\.(js|mjs|html)$/.test(entry.name)) out.push(here);
  }
  return out;
}

const files = SCOPE.flatMap((entry) => {
  const full = path.join(EXT, entry);
  return fs.statSync(full).isDirectory() ? walk(full, entry) : [entry];
});

/** Line and block comments blanked, keeping every line number where it was. */
const withoutComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * The `(s)` occurrences that sit inside a quote on this line, and outside any
 * `${…}` in it.
 *
 * Naive by choice: a quote opened on one line and closed on the next is rare in
 * copy, and the cost of being wrong about it here is a missed finding, not a
 * false one.
 */
/** Words that cannot end an expression, so a `/` after one opens a regex. */
const NOT_AN_OPERAND = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

function pluralsIn(line, isHtml) {
  const hits = [];
  let quote = null;
  let expr = 0;
  let prev = ''; // the last significant character seen outside a string
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === '`' && expr === 0 && c === '$' && line[i + 1] === '{') { expr = 1; i++; continue; }
    if (expr) {
      if (c === '{') expr++;
      else if (c === '}') expr--;
      continue;
    }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; continue; }
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    } else if (!isHtml && c === '/' && line[i + 1] !== '/' && !/[\w$)\]]/.test(prev)) {
      // A regex literal, skipped whole. `[...]` can hold a `/` that does not
      // end it, and an escape can hold either. What is inside is never copy.
      i++;
      let inClass = false;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === '[') inClass = true;
        else if (line[i] === ']') inClass = false;
        else if (line[i] === '/' && !inClass) break;
        i++;
      }
      prev = '/';
      continue;
    }
    if (!quote && !/\s/.test(c)) {
      // A word is kept whole, so `return` is not read as its last letter.
      if (/[\w$]/.test(c)) {
        const start = i;
        while (i < line.length && /[\w$]/.test(line[i])) i++;
        prev = NOT_AN_OPERAND.has(line.slice(start, i)) ? ',' : line[i - 1];
        i--;
        continue;
      }
      prev = c;
    }
    const inCopy = quote || isHtml;
    if (inCopy && line.startsWith('(s)', i) && /[a-z]/i.test(line[i - 1] || '') && !/[\w$]/.test(line[i + 3] || '')) {
      hits.push(line.slice(Math.max(0, i - 30), i + 3).trim());
    }
  }
  return hits;
}

let fail = 0;
let clean = 0;
for (const rel of files) {
  const isHtml = rel.endsWith('.html');
  const lines = withoutComments(fs.readFileSync(path.join(EXT, rel), 'utf8')).split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    for (const hit of pluralsIn(line, isHtml)) bad.push({ line: i + 1, hit });
  });
  if (!bad.length) { clean++; continue; }
  fail += bad.length;
  for (const b of bad) console.log(`  FAIL  ${rel}:${b.line}\n          …${b.hit}`);
}

console.log(
  fail
    ? `\n${fail} "(s)" plural${fail === 1 ? '' : 's'} in copy across ${clean} clean files: use the count and the word, agreeing\n`
    : `\nno "(s)" plural in any string a tester reads (${clean} files)\n`,
);
process.exit(fail ? 1 : 0);
