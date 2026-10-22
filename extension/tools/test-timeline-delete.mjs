/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Deleting history from the DevTools panel, checked so it cannot quietly rot.
 *
 * The panel is the page a tester watches a session on, and for months it was
 * the one surface that would show you a session and not let you get rid of it:
 * a bare "Delete" at the end of the export row, which fired
 * `UQA_DELETE_SESSION`, threw the worker's answer away, and reloaded. A refusal
 * ("that session is still recording") therefore looked exactly like a success
 * where the row stubbornly stayed in the list. Erasing everything was not here
 * at all — it lived on the Settings page, which is not where anyone is standing
 * when they decide the last fortnight can go.
 *
 * None of the fix survives on good intentions, so each rule below names the
 * failure it prevents:
 *
 *   1. both buttons are still in the page, under the ids the panel wires;
 *   2. the per-session delete still carries a session id, and the erase still
 *      goes to the handler that flushes the write queue first;
 *   3. neither can fire without `confirm()` first, and the confirm comes
 *      *before* the message, not after it;
 *   4. a refusal shows `res.error` — the worker's sentence names the thing to
 *      press Stop on, and a generic "could not delete" is strictly less useful
 *      than the button doing nothing;
 *   5. a successful delete re-reads the list, so the panel cannot keep drawing
 *      a session that no longer exists;
 *   6. no em dash in either confirmation: `tools/test-copy.mjs` fails the build
 *      on one, and this catches it in the two strings most likely to grow one;
 *   7. panel.js declares no top-level name that `devtools/audit.js` also
 *      declares. Both are plain scripts on one global; a second top-level
 *      `const plural` there threw "Identifier 'plural' has already been
 *      declared" on 6 September and took the whole panel down with it.
 *
 * Node only, no browser: these are questions about the source, and a headless
 * Chrome that has to open a DevTools panel to answer them would be slower and
 * flakier for no more truth.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const html = fs.readFileSync(path.join(EXT, 'devtools', 'panel.html'), 'utf8');
const js = fs.readFileSync(path.join(EXT, 'devtools', 'panel.js'), 'utf8');
const auditJs = fs.readFileSync(path.join(EXT, 'devtools', 'audit.js'), 'utf8');

/**
 * The code, without its prose.
 *
 * Every rule here is about what the panel *does*, and the comments in both
 * files quote the very things these rules look for — the paragraph explaining
 * why the old delete was wrong contains `UQA_DELETE_SESSION`, and the one
 * explaining the name collision contains `const plural`. A naive grep would
 * pass or fail on the explanation rather than on the code, which is the worst
 * kind of false result.
 */
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const code = strip(js);

/** The body of one `$('id').addEventListener('click', …)`, to the closing `});`. */
function handlerFor(id) {
  const start = code.indexOf(`$('${id}').addEventListener('click'`);
  assert.ok(start > 0, `nothing wires a click handler to #${id}`);
  const end = code.indexOf('\n});', start);
  assert.ok(end > start, `the #${id} handler never closes`);
  return code.slice(start, end);
}

/**
 * Every name a file binds at the top level of the global scope.
 *
 * Depth-counted rather than matched at column zero, because `audit.js` wraps
 * itself in an IIFE whose body is *not* indented: `const $ = …` sits at column
 * zero there and is nonetheless local. Strings and comments are blanked first
 * so a brace inside a literal cannot shift the depth.
 */
function topLevelNames(src) {
  const flat = strip(src.replace(/\\./g, ''))
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/`[^`]*`/g, '``');

  const names = new Set();
  let depth = 0;
  for (const line of flat.split('\n')) {
    if (depth === 0) {
      const m = line.match(/^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
      if (m) names.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
  }
  return names;
}

/** The string literals handed to `confirm()` anywhere in the panel. */
const confirmations = [...code.matchAll(/confirm\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map((m) => m[1]);

/* ── 1. the two controls are in the page ───────────────────────────────── */

test('the panel has a per-session delete and a clear-everything, beside the picker', () => {
  for (const id of ['session-delete', 'history-clear']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is gone from panel.html`);
  }
  // Beside the picker, not buried in the export group on the right: that is
  // where the report page puts the same action, and where a tester deciding
  // that last week can go is already looking.
  const bar = html.slice(html.indexOf('id="session-select"'), html.indexOf('class="bar-actions"'));
  for (const id of ['session-delete', 'history-clear']) {
    assert.ok(bar.includes(`id="${id}"`), `#${id} no longer sits beside the session picker`);
  }
});

test('both buttons start disabled, before the session list has arrived', () => {
  // The panel paints before UQA_LIST_SESSIONS comes back. A delete that is live
  // while currentId is still null can only send `sessionId: null` and get a
  // puzzling "no such session" for it.
  for (const id of ['session-delete', 'history-clear']) {
    const tag = html.match(new RegExp(`<button id="${id}"[^>]*>`));
    assert.ok(tag, `#${id} is no longer a button`);
    assert.match(tag[0], /\sdisabled\b/, `#${id} is pressable before the panel knows what it holds`);
  }
  assert.match(code, /function paintHistoryActions\(/, 'nothing decides when the two deletes are pressable');
  const paint = code.match(/function paintHistoryActions\(\)\s*\{[\s\S]*?\n\}/)[0];
  assert.match(paint, /disabled = !currentId/, '"Delete this session" no longer follows the selected session');
  assert.match(paint, /disabled = !sessions\.length/, '"Delete all history" no longer follows the session list');
});

/* ── 2. the messages the worker already answers ────────────────────────── */

test('the per-session delete names the session, and the erase is the whole-history one', () => {
  const one = handlerFor('session-delete');
  assert.match(
    one,
    /send\(\{\s*type:\s*'UQA_DELETE_SESSION',\s*sessionId:\s*currentId\s*\}\)/,
    'UQA_DELETE_SESSION is sent without the id of the session on screen'
  );
  const all = handlerFor('history-clear');
  assert.match(all, /send\(\{\s*type:\s*'UQA_ERASE_ALL'\s*\}\)/, 'the clear button no longer sends UQA_ERASE_ALL');
  // Both go through the panel's own send(), which turns a dead worker into
  // { ok: false, error } instead of an undefined the handlers would read from.
  assert.ok(!/chrome\.runtime\.sendMessage\(\{\s*type:\s*'UQA_(DELETE_SESSION|ERASE_ALL)'/.test(code),
    'a delete bypasses send() and will throw on a sleeping worker');
});

/* ── 3. neither can fire by accident ───────────────────────────────────── */

test('both deletes are gated behind a confirm, before the message goes out', () => {
  for (const id of ['session-delete', 'history-clear']) {
    const body = handlerFor(id);
    const asked = body.indexOf('confirm(');
    const sent = body.indexOf('await send(');
    assert.ok(asked > 0, `#${id} deletes without asking`);
    assert.ok(sent > 0, `#${id} sends nothing`);
    assert.ok(asked < sent, `#${id} asks after it has already deleted`);
    assert.match(
      body.slice(asked - 40, sent),
      /if \(!window\.confirm\([\s\S]*?\)\) return;/,
      `#${id} does not stop when the tester says no`
    );
  }
});

test('each confirmation names what goes', () => {
  const one = handlerFor('session-delete');
  const all = handlerFor('history-clear');
  assert.match(one, /confirm\(`Delete "\$\{name\}"\?/, 'the per-session confirm no longer names the session');
  assert.match(one, /screenshots and recordings/, 'the per-session confirm no longer says what goes with it');
  assert.match(all, /\$\{scale\}|plural\(/, 'the erase confirm no longer says how much is about to go');
  for (const body of [one, all]) {
    assert.match(body, /no undo/i, 'a confirmation that does not say it is final');
  }
});

/* ── 4. the worker's refusal reaches the tester ────────────────────────── */

test('a refusal shows the worker’s own sentence, not a house one', () => {
  // The worker refuses while the session is running, or a clip is still being
  // filed into it, and the refusal names the thing to press Stop on. Replacing
  // it with "could not delete" throws away the only useful half.
  for (const id of ['session-delete', 'history-clear']) {
    const body = handlerFor(id);
    assert.match(body, /if \(!res\.ok\)/, `#${id} does not check whether the delete was refused`);
    assert.match(
      body,
      /toast\(res\.error \|\|/,
      `#${id} swallows res.error and shows a sentence of its own instead`
    );
  }
});

test('the busy label is honest while the round trip is out', () => {
  for (const id of ['session-delete', 'history-clear']) {
    const body = handlerFor(id);
    assert.match(body, /btn\.disabled = true;/, `#${id} can be pressed twice while the first delete is in flight`);
    assert.match(body, /btn\.textContent = 'Deleting…';/, `#${id} says nothing while it works`);
    assert.match(body, /paintHistoryActions\(\)/, `#${id} leaves the buttons in whatever state it borrowed`);
  }
});

/* ── 5. the page cannot keep drawing what it deleted ───────────────────── */

test('a successful delete re-reads the session list and drops the dead one', () => {
  for (const id of ['session-delete', 'history-clear']) {
    const body = handlerFor(id);
    assert.match(body, /forgetCurrent\(\)/, `#${id} keeps the deleted session in currentId`);
    assert.match(body, /await loadSessions\(\)/, `#${id} does not re-render the session list afterwards`);
  }
  const forget = code.match(/function forgetCurrent\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(forget, 'forgetCurrent() is gone');
  for (const field of ['currentId', 'session', 'events', 'renderedSeq', 'renderedCount']) {
    assert.match(forget[0], new RegExp(`\\b${field} = `), `forgetCurrent() no longer clears ${field}`);
  }
  // loadSessions() shows the empty state itself when nothing is left, so the
  // handlers must not be doing it a second way.
  assert.match(code, /\$\('empty-stage'\)\.hidden = has/, 'the panel lost its own empty state');
});

test('an erase from another surface leaves this page consistent', () => {
  // Settings has the same action and the worker broadcasts to every open
  // surface. UQA_STATE_CHANGED alone reloads the list and leaves currentId
  // pointing at a row that is gone, so the next poll asks for a timeline that
  // cannot be fetched and the panel draws the erased session until it closes.
  const at = code.indexOf("'UQA_SESSIONS_ERASED'");
  assert.ok(at > 0, 'the panel ignores the erase broadcast');
  assert.match(code.slice(at, at + 200), /forgetCurrent\(\)/, 'the erase broadcast leaves the dead session selected');
  assert.match(code.slice(at, at + 200), /loadSessions\(\)/, 'the erase broadcast does not re-read the list');
  assert.match(code, /'UQA_STATE_CHANGED'\) loadSessions\(\)/, 'the panel no longer follows state changes at all');
});

/* ── 6. the copy rule, at the two strings most likely to break it ──────── */

test('no em dash in anything either confirmation says', () => {
  assert.ok(confirmations.length >= 2, `only ${confirmations.length} confirm() calls in the panel`);
  const bad = confirmations.filter((s) => s.includes('—'));
  assert.deepEqual(bad, [], `an em dash in copy fails tools/test-copy.mjs: ${bad.join(' | ')}`);
});

/* ── 7. one global, two plain scripts ──────────────────────────────────── */

test('panel.js declares no top-level name that audit.js also declares', () => {
  const panelNames = topLevelNames(js);
  const auditNames = topLevelNames(auditJs);
  assert.ok(panelNames.has('plural'), 'the scan found no top-level names in panel.js at all');
  const clash = [...panelNames].filter((n) => auditNames.has(n));
  assert.deepEqual(
    clash,
    [],
    `both files declare these at the top level, which is SyntaxError before either runs: ${clash.join(', ')}`
  );
  // And the new helpers really are new, rather than quietly shadowing.
  for (const name of ['paintHistoryActions', 'forgetCurrent']) {
    assert.ok(panelNames.has(name), `${name}() is no longer a top-level function in panel.js`);
    assert.ok(!auditNames.has(name), `${name}() now collides with audit.js`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
