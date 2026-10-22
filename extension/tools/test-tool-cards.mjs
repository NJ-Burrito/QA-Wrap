/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The eighteen cards, and the promises each one makes.
 *
 * Nader, 7 September: "not all feature cards have visuals or an updated
 * explanation; rework all of them" (E4), and "accuracy of copy: the masking
 * tool says 'mask the names', which reads as fields only; it masks whole
 * elements. Audit every tool's one-line and help copy against what the code
 * does" (E5).
 *
 * An audit done once is a state of the tree on one afternoon. These are the
 * rules that keep it: every tool has a picture, an icon, a one-line purpose and
 * both halves of its help; the words on the card do not contradict the code
 * under it; and the six cards that were reworked for a named complaint keep the
 * thing that was added to them.
 *
 * Also here, because they are properties of the same file and need no browser:
 *
 *   E2   an error carries the way out of itself
 *   E3   opening a card's options brings the card and the options into view
 *   E13  the break rules come off without a reload and without losing evidence
 *   E17  every tool press paints before it awaits anything
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const JS = surfaceSource('popup/popup.js');
const HTML = fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8');
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(EXT, 'core', 'tool-catalogue.json'), 'utf8'));

/** The code, without its prose: a comment quoting a forbidden phrase is not a bug. */
const code = JS
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * `TOOLS[]`, read out of the popup rather than copied here.
 *
 * Evaluated, not regexed: the entries carry apostrophes, Arabic and template
 * punctuation, and a regex over eighteen of those is a second parser to get
 * wrong. The array is a literal with no references to anything else in the
 * file, which is exactly why it can be lifted whole.
 */
function readTools() {
  const at = JS.indexOf('const TOOLS = [');
  const end = JS.indexOf('\n];', at);
  assert.ok(at > -1 && end > at, 'popup.js no longer declares TOOLS[]');
  return new Function(`${JS.slice(at, end + 3)}\nreturn TOOLS;`)();
}
const TOOLS = readTools();

/** The scenes, by running the real file against a bare window. */
function readScenes() {
  const src = fs.readFileSync(path.join(EXT, 'ui', 'scenes.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  assert.ok(win.UQAScenes, 'ui/scenes.js no longer publishes UQAScenes');
  return win.UQAScenes;
}
const SCENES = readScenes();

/* ── E4: every card has a picture and an explanation ────────────────────── */

console.log('E4 — every card has a picture and an explanation');

test('every tool has a scene drawn for it', () => {
  // Four of the eighteen had none: mask, api, spec and fineprint carried a
  // sentence where their neighbours in the same wall carried a drawing.
  const without = TOOLS.filter((t) => !SCENES.svg(t.tool || t.action)).map((t) => t.label);
  assert.deepEqual(without, [], `no picture for: ${without.join(', ')}`);
});

test('every scene is drawn to the same frame, from the same primitives', () => {
  // 240x144 since UI round 2 (S3): the explainers are mini mock-ups, DESIGN-SPEC §11.
  // tools/test-explainers.mjs holds the rest of their rules.
  for (const id of SCENES.ids()) {
    const svg = SCENES.svg(id);
    assert.match(svg, /viewBox="0 0 240 144"/, `${id} is not on the 240x144 frame`);
    assert.ok(!/font-|<text/.test(svg), `${id} carries type, which does not scale with the card`);
  }
});

test('every tool has an icon of its own', () => {
  // S6 (attack #9): every TOOLS[].icon is a key of UQAIcons (ui/icons.js, S2).
  const sandbox = {};
  new Function('window', fs.readFileSync(path.join(EXT, 'ui', 'icons.js'), 'utf8'))(sandbox);
  const missing = TOOLS.filter((t) => !t.icon || !sandbox.UQAIcons[t.icon]).map((t) => t.action);
  assert.deepEqual(missing, [], `no line art for: ${missing.join(', ')}`);
  assert.equal(new Set(TOOLS.map((t) => t.icon)).size, TOOLS.length, 'two tools share one drawing');
});

test('every tool has a one-line purpose, a what and a why', () => {
  for (const tool of TOOLS) {
    for (const key of ['one', 'what', 'why']) {
      assert.ok(tool[key], `"${tool.label}" has no ${key}`);
      assert.ok(String(tool[key]).length > 25, `"${tool.label}" has a ${key} too short to say anything`);
    }
    assert.ok(
      tool.one.length <= 130,
      `"${tool.label}" has a one-liner of ${tool.one.length} characters, which is not one line on a 392px card`
    );
    assert.match(tool.one, /[.!?]$/, `"${tool.label}" has a one-liner that does not finish its sentence`);
  }
});

test('the one-liner is the row tooltip, and what is in the detail', () => {
  // DESIGN-SPEC §1.8: the two-line clamp clipped 17 of 19 one-liners, so the
  // row carries no description; the one-liner is its tooltip and `what` sits
  // one level deeper, in the detail.
  assert.match(code, /run\.title = tool\.one/, 'the one-liner is not the row tooltip');
  assert.ok(!/el\('span', 'tool-one'/.test(code), 'the row draws its description again');
  // 15 Oct 2026: no paragraphs on the panel, so `what` and `why` sit behind the "About this tool" disclosure inside the detail.
  assert.match(code, /about\.append\([^;]*el\('p', 'tool-what', tool\.what\)/, '`what` is not in the detail');
  assert.match(code, /help\.append\(about\)/, 'the disclosure is not in the detail');
});

/* ── E5: the words match the code ───────────────────────────────────────── */

console.log('\nE5 — the copy says what the code does');

const toolByAction = Object.fromEntries(TOOLS.map((t) => [t.action, t]));

test('the masking copy does not describe it as masking names or fields', () => {
  const mask = toolByAction.mask;
  const copy = `${mask.one} ${mask.what} ${mask.why}`;
  assert.ok(!/mask the names/i.test(copy), 'the old "mask the names" wording is back');
  assert.match(mask.what, /element/i, 'the copy still does not say it covers whole elements');
  // It really does cover pictures now, so the copy is allowed to say so, and
  // has to: a tester who thinks this masks text will not point it at a photo.
  assert.match(mask.what, /photograph|picture|image/i, 'the copy does not mention what is now covered');
  assert.match(
    fs.readFileSync(path.join(EXT, 'content', 'mask.js'), 'utf8'),
    /data-uqa-masked-media/,
    'the copy promises pictures are covered and the code no longer does it'
  );
});

test('the nasty-values copy does not say "a text box" now the picker sees every field', () => {
  const inject = toolByAction.inject;
  const copy = `${inject.one} ${inject.what}`;
  assert.ok(
    !/pick a text box/i.test(copy),
    'the copy still offers only text boxes while the picker matches selects, radios, sliders and editors'
  );
  for (const word of ['dropdown', 'tickbox', 'slider']) {
    assert.match(inject.what, new RegExp(word, 'i'), `the copy does not mention ${word}, which it now supports`);
  }
});

test('the partitions copy tells the tester to pick, because that is what the button says', () => {
  assert.match(toolByAction.partitions.what, /Pick a field/, 'the copy still says to click into a field first');
  assert.match(HTML, /id="partitions-read"[^>]*>Pick a field</, 'the button and the copy disagree');
});

test('no card promises a thing the tool does not do', () => {
  // Two claims that were false in the tree before this round and are the kind
  // that get repeated: the locator picker refusing masked elements, and the
  // harvester leaving them out. Both are now true, and both are asserted
  // against the code rather than trusted.
  assert.match(toolByAction.pick.why, /masked/i, 'the locator card does not mention the masking rule it now honours');
  assert.match(
    fs.readFileSync(path.join(EXT, 'content', 'picker.js'), 'utf8'),
    /withoutMaskedText/,
    'the locator card claims a rule the picker does not apply'
  );
});

test('the catalogue and the popup still agree, character for character', () => {
  // tools/test-context-menus.mjs owns this rule; it is repeated here because
  // this file is the one that rewrites labels, and finding out in a different
  // suite is a slower way to learn it.
  for (const entry of CATALOGUE.tools) {
    const tool = TOOLS.find((t) => t.tool === entry.tool);
    assert.ok(tool, `the catalogue lists ${entry.tool} and the popup does not`);
    assert.equal(tool.label, entry.label, `the label for ${entry.tool} differs between the popup and the menu`);
  }
});

/* ── the six reworked cards keep what was added ─────────────────────────── */

console.log('\nthe cards that were reworked for a named complaint');

test('E9: the fill result is kept and drawn, not left in a line that clears itself', () => {
  assert.match(code, /function paintAutofill\(/, 'the fill result has nowhere to go');
  assert.match(code, /lastAutofill = r;/, 'the result is not kept, so a re-render loses it');
  assert.match(code, /openToolPanel\('autofill'\)/, 'the card does not open itself on the result');
  assert.match(code, /Still rejected by the page/, 'the fields the page refused are not named');
  assert.match(HTML, /id="autofill-out"/, 'the fill card has no panel to draw into');
});

test('E12: the request tool explains itself on the card and on its first screen', () => {
  assert.equal(toolByAction.api.options, 'api-panel');
  assert.match(HTML, /worked/, 'the card has no worked example');
  const page = fs.readFileSync(path.join(EXT, 'api', 'api.html'), 'utf8');
  assert.match(page, /id="primer"/, 'the request page still opens on a method dropdown and no explanation');
  assert.match(page, /Import from the session/, 'the worked example does not name the control it tells you to press');
  const js = fs.readFileSync(path.join(EXT, 'api', 'api.js'), 'utf8');
  assert.match(js, /primer-hide/, 'the explanation cannot be dismissed, so it is read every time');
});

test('E14: the accessibility findings are on the card, with a way to each element', () => {
  assert.match(code, /function paintA11y\(/, 'the findings have nowhere to go');
  assert.match(code, /function showOnPage\(/, 'a finding still cannot be pointed at');
  assert.match(code, /UQA_HIGHLIGHT/, 'nothing rings the element on the page');
  assert.ok(
    !/Open the timeline for detail/.test(code),
    'the card still sends the tester to another page for the detail'
  );
  assert.match(HTML, /id="a11y-out"/, 'the accessibility card has no panel to draw into');
});

test('E15: coverage says in advance whether this page can be measured', () => {
  assert.match(code, /function checkCoverageReadiness\(/, 'the card cannot answer the question before it is pressed');
  assert.match(code, /debugger permission/, 'the build-level refusal is not named');
  assert.match(code, /Web Store|chrome:/, 'the page-level refusal is not named');
  assert.match(code, /Every script that ran came from another origin/, 'a measurement of nothing is still reported blank');
  assert.match(HTML, /id="whitebox-out"/, 'the coverage card has no panel to draw into');
});

test('E13: the break rules come off without a reload and without losing the evidence', () => {
  const at = code.indexOf("$('break-clear').addEventListener('click'");
  assert.ok(at > -1, 'the break-clear handler is gone');
  const body = code.slice(at, code.indexOf('\n});', at));
  assert.match(body, /UQA_SET_RULES/, 'it no longer takes the rules off');
  // The sentence it prints contains the word "reloaded", because saying so is
  // the point; what it must not contain is a call that does it.
  assert.ok(
    !/(tabs|location)\.reload|runtime\.reload/.test(body),
    'it reloads something, which is the thing E13 exists to avoid'
  );
  const handler = [body];
  assert.match(handler[0], /still there|stays/, 'it does not say that the evidence is kept');
  assert.match(HTML, /data-i18n="popup.break.clear"[^>]*>[^<]*Stop</, 'the button is still called "Clear all", which sounds like it clears the session');
});

test('E16: the sizes card says what a new window carries with it', () => {
  assert.match(HTML, /id="viewport-inherit"/, 'the sizes panel does not say what is inherited');
  assert.match(code, /function inheritLine\(/, 'the popup cannot say what the new window took');
  assert.match(code, /inherit: true/, 'the popup does not ask for inheritance');
});

/* ── E2, E3, E17: the three that are about the press itself ─────────────── */

console.log('\nE2, E3 and E17 — the press, the way out, and the view');

test('E17: every tool paints before it awaits anything', () => {
  const actions = [...code.matchAll(/^\s{2}'?([\w-]+)'?: (?:async )?\(/gm)]
    .map((m) => m[1]);
  const map = code.slice(code.indexOf('const PRESS_SAYS = {'), code.indexOf('\n};', code.indexOf('const PRESS_SAYS = {')));
  for (const tool of TOOLS) {
    assert.ok(
      new RegExp(`(^|\\s)'?${tool.action}'?:`, 'm').test(map),
      `"${tool.label}" has no word to paint on the press, so a cold worker leaves it looking dead`
    );
  }
  assert.ok(actions.length > 0, 'no handlers were found: this test is reading the wrong thing');
});

test('E17: the press word is said in the same turn as the click', () => {
  const handler = code.match(/document\.addEventListener\('click', async \(event\) => \{\s*const btn = event\.target\.closest\?\.\('\[data-action\]'\)[\s\S]{0,2200}/);
  assert.ok(handler, 'the delegated tool listener is gone');
  const saidAt = handler[0].indexOf('say(pressWord)');
  const firstAwait = handler[0].indexOf('await ');
  assert.ok(saidAt > -1, 'the press paints nothing');
  assert.ok(saidAt < firstAwait, 'the press word is painted after an await, which is exactly the delay E17 is about');
});

test('E2: an error carries the way out of itself', () => {
  assert.match(code, /const FIXES = \[/, 'no refusal has an action attached');
  assert.match(code, /function spotlight\(/, 'nothing can point at the control that has to be changed');
  assert.match(code, /function fixFor\(|const fixFor =/, 'nothing chooses the action for a message');
  // Only with the message, and only on a refusal: a button that outlived its
  // message would send the tester to fix something already fixed.
  const say = code.match(/function say\(text[\s\S]{0,1800}/);
  assert.match(say[0], /fixBtn = null;/, 'the action button is never taken away');
  assert.match(say[0], /tone === 'err'/, 'an action is offered on messages that are not refusals');
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  assert.match(css, /\.status-fix\s*\{/, 'the action button has no paint');
  assert.match(css, /\.is-spotlit\s*\{/, 'the highlight has no paint');
});

test('E2: the refusals that have a way out all have one', () => {
  const fixes = code.slice(code.indexOf('const FIXES = ['), code.indexOf('\n];', code.indexOf('const FIXES = [')));
  for (const situation of ['asleep', 'permission', 'reload the extension', 'reload this tab']) {
    assert.ok(
      new RegExp(situation.replace(/ /g, '.'), 'i').test(fixes),
      `"${situation}" is a refusal a tester can act on and it carries no button`
    );
  }
});

test('E3: opening a card’s options brings the card and the options into view', () => {
  assert.match(code, /function fitIntoView\(/, 'nothing scrolls an expanded card into view');
  const toggle = code.match(/function setToolPanel\([\s\S]{0,400}/);
  assert.match(toggle[0], /if \(open\) fitIntoView\(row\)/, 'the toggle does not bring the card into view');
  const fit = code.match(/function fitIntoView\(row\)[\s\S]{0,900}/);
  assert.match(fit[0], /requestAnimationFrame/, 'the panel is measured before it has been laid out, so it measures zero');
  assert.match(fit[0], /Math\.abs\(delta\) < 2/, 'it scrolls a card that is already fully in view');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
