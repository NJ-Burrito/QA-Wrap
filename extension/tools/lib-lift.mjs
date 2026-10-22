/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Lift a function out of a content script so a unit test can exercise it.
 *
 * `content/page-hooks.js` runs in the page's MAIN world. It cannot use
 * `chrome.*`, cannot be a module, and therefore cannot be imported — so the
 * only honest way to unit-test its matcher is to take the function out of the
 * real file by name and rebuild it. Copying the logic into the test instead
 * produces a suite that passes forever while the shipped code diverges.
 *
 * ── why this needs a real scanner ─────────────────────────────────────────
 *
 * The first version counted `{` and `}`. That works until a function contains a
 * brace inside a string:
 *
 *     if (body.trim().startsWith('{')) …
 *
 * The counter opened a block that never closed, the lift ran past the end of
 * the function, and the test failed with `SyntaxError: Unexpected token
 * 'function'` — an error that says nothing at all about the actual problem.
 *
 * So this skips strings, template literals, regex literals and comments. Regex
 * detection is undecidable in general; the heuristic here is the standard one —
 * a `/` begins a regex when the last meaningful character was an operator or an
 * opening bracket rather than a value — and it is sufficient for this codebase,
 * where the alternative is a silently truncated lift.
 */

/** Characters after which a `/` starts a regex rather than dividing. */
const BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n']);

/** Keywords after which a `/` also starts a regex. */
const BEFORE_REGEX_WORD = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

/**
 * The index just past the block that starts at `open`.
 *
 * @param {string} src
 * @param {number} open index of the `{` that opens the block
 * @returns {number} index of the matching `}`
 */
export function endOfBlock(src, open) {
  let depth = 0;
  let i = open;

  while (i < src.length) {
    const ch = src[i];

    // ── comments ──
    if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    // ── strings and template literals ──
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // A template's ${…} can contain anything, braces included, so it is
        // walked rather than skipped over.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          i = endOfBlock(src, i + 1) + 1;
          continue;
        }
        i++;
      }
      continue;
    }

    // ── regex literals ──
    if (ch === '/') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      const prev = j >= 0 ? src[j] : '\n';
      const word = src.slice(Math.max(0, j - 12), j + 1);
      if (BEFORE_REGEX.has(prev) || BEFORE_REGEX_WORD.test(word)) {
        i++;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; break; }
          else if (src[i] === '\n') break; // unterminated — bail rather than run on
          i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // ── the braces we are actually here for ──
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }

  throw new Error('the block never closed — the lift would have run past the end of the function');
}

/**
 * Take one function declaration out of a source file, by name.
 *
 * Throws when the name is gone, which is the point: a rename should break the
 * test loudly rather than let it drift into testing nothing.
 */
export function lift(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(`the source no longer declares ${name}() — this test is out of date, not wrong`);
  }
  const open = source.indexOf('{', source.indexOf(')', start));
  return source.slice(start, endOfBlock(source, open) + 1);
}

/** Lift several, in order, ready to be pasted into a `new Function` body. */
export function liftAll(source, names) {
  return names.map((n) => lift(source, n)).join('\n');
}
