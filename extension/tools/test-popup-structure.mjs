/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The popup's structure, checked so it cannot quietly go back.
 *
 * Every edit to the popup for two days broke something next to it, and all of
 * it came from one arrangement: `renderTools()` MOVED four option panels out of
 * the document and into tool rows, a re-render destroyed them, a parking div
 * caught what it could — and about a dozen places still read those panels by
 * global id. `$('capture-panel').querySelectorAll(...)` is fine right up until
 * a render, a mode switch or a surface does not draw that row, and then it is
 * "Cannot read properties of null" on the extension's card at
 * chrome://extensions, where it reads as a broken extension.
 *
 * The arrangement is now: one `<template>` per tool with options, stamped fresh
 * into the row at creation, and one way in — `panelFor(tool)`, which goes
 * through the row and answers `null` for a tool that is not on screen.
 *
 * None of that survives on good intentions. These rules are cheap, they run in
 * Node with no browser, and each one names the failure it prevents:
 *
 *   1. popup.js never reads an option panel by its global id;
 *   2. popup.js never reads a capture tick by its global id;
 *   3. every panel TOOLS[].options names has a template to be stamped from;
 *   4. every `.opts-tool` in the page lives inside a template, so nothing is
 *      ever a stray singleton for a reader to grab again;
 *   5. the parking div is gone, and nothing refers to it;
 *   6. the ids and names the suites drive the popup by are all still there.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const html = fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8');
const js = surfaceSource('popup/popup.js');

/**
 * The code, without its prose.
 *
 * Every rule below is about what the popup *does*, and this file's comments
 * quote the very reads they forbid — a naive grep would fail on the paragraph
 * explaining why the read is gone, which is the worst kind of false alarm.
 */
const code = js
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Every `<template id="...">…</template>`, by id. */
const templates = new Map(
  [...html.matchAll(/<template\s+id="([^"]+)"\s*>([\s\S]*?)<\/template>/g)].map((m) => [m[1], m[2]])
);

/** The panels TOOLS[].options names, in popup.js source order. */
const optionPanels = [...code.matchAll(/\boptions:\s*'([^']+)'/g)].map((m) => m[1]);

/* ── 1. no panel is read by its global id ──────────────────────────────── */

test('popup.js reads no option panel by its global id', () => {
  const hits = [...code.matchAll(/\$\('(shot|capture|partitions|viewport)-panel'\)/g)].map((m) => m[0]);
  assert.deepEqual(
    hits,
    [],
    `these read a panel by id instead of through panelFor(): ${hits.join(', ')}`
  );
});

test('popup.js reaches option panels through the row that owns them', () => {
  assert.match(code, /function panelFor\(/, 'panelFor() is gone — something is reading panels another way');
  assert.match(
    code,
    /\.tool-row\[data-tool="\$\{toolId\}"\] \.opts-tool/,
    'panelFor() no longer finds the panel through the row'
  );
});

/* ── 2. no capture tick is read by its global id ───────────────────────── */

test('popup.js reads no capture tick by its global id', () => {
  const hits = [...code.matchAll(/\$\('cap-[^']*'\)/g)].map((m) => m[0]);
  assert.deepEqual(hits, [], `these read a tick by id instead of readCaptureOptions(): ${hits.join(', ')}`);
});

test('readCaptureOptions() is the one reader, and falls back to settings', () => {
  const fn = code.match(/function readCaptureOptions\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'readCaptureOptions() is gone');
  for (const key of ['mic', 'tabAudio', 'webcam', 'cursor', 'webcamPosition', 'webcamSize']) {
    assert.match(fn[0], new RegExp(`\\b${key}:`), `readCaptureOptions() no longer returns ${key}`);
  }
  assert.match(fn[0], /panelFor\('record'\)/, 'it no longer reads from the rendered row');
  assert.match(fn[0], /settings\?\./, 'it no longer falls back to the last known settings');
});

/* ── 3. every panel TOOLS names has a template ─────────────────────────── */

test('every panel TOOLS[].options names has a template to be stamped from', () => {
  assert.ok(optionPanels.length >= 4, `only ${optionPanels.length} tools declare options`);
  const missing = optionPanels.filter((id) => !templates.has(`tpl-${id}`));
  assert.deepEqual(missing, [], `no <template id="tpl-…"> for: ${missing.join(', ')}`);

  // And the stamped element must be findable the way popup.js finds it.
  const wrong = optionPanels.filter((id) => {
    const body = templates.get(`tpl-${id}`) || '';
    return !body.includes('class="opts opts-tool"') || !body.includes(`id="${id}"`);
  });
  assert.deepEqual(wrong, [], `these templates hold no .opts-tool with the expected id: ${wrong.join(', ')}`);
});

test('stampPanel() cuts the panel from tpl- plus the id TOOLS names', () => {
  assert.match(code, /function stampPanel\(/, 'stampPanel() is gone');
  assert.match(code, /\$\(`tpl-\$\{tool\.options\}`\)/, 'stampPanel() no longer derives the template id from TOOLS');
});

/* ── 4. no panel is a live singleton in the page ───────────────────────── */

test('every .opts-tool in the page lives inside a template', () => {
  // Blank the templates, then look for anything left over. A panel outside a
  // template is a singleton with a global id, which is the whole class of bug.
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, '');
  const strays = [...outside.matchAll(/<div[^>]*class="[^"]*opts-tool[^"]*"[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(strays, [], `these panels are live elements, not templates: ${strays.join(', ')}`);
});

test('each stamped panel names itself with data-panel', () => {
  const named = [...html.matchAll(/class="opts opts-tool"\s+id="[^"]+"\s+data-panel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    named.sort(),
    ['a11y', 'api', 'autofill', 'capture', 'inject', 'partitions', 'pick', 'shot', 'spec', 'viewport', 'whitebox'],
    `the panels name themselves as: ${named.join(', ')}`
  );
});

/* ── 5. the parking hack is gone ───────────────────────────────────────── */

test('the #tool-panels parking div is gone from the page and the code', () => {
  assert.ok(!html.includes('tool-panels'), 'popup.html still parks panels in #tool-panels');
  assert.ok(!js.includes('tool-panels'), 'popup.js still refers to the parking div');
});

test('renderTools() moves nothing', () => {
  const fn = code.match(/function renderTools\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'renderTools() is gone');
  assert.ok(!/parking/.test(fn[0]), 'renderTools() still rescues panels into a parking div');
  assert.ok(
    !/querySelectorAll\('\.opts-tool'\)/.test(fn[0]),
    'renderTools() still gathers panels to move them'
  );
});

/* ── 6. the selectors the suites drive by are all still there ──────────── */

test('every id and radio name the suites drive the popup by still exists', () => {
  // Named one by one rather than diffed, because the point is that a rename
  // here breaks tools/clickthrough.mjs, tools/uat.mjs and tools/tutorials.mjs
  // silently — they look for these, find nothing, and report a dead control.
  const wanted = [
    'shot-panel', 'capture-panel', 'partitions-panel', 'viewport-panel', 'break-panel',
    'cap-mic', 'cap-tabAudio', 'cap-webcam', 'cap-cursor', 'cap-webcam-pos', 'capture-row', 'record-state',
    'partitions-read', 'partitions-out', 'viewport-list', 'rule-list', 'break-state',
    'switch', 'switch-title',
    'more', 'more-menu', 'lang', 'open-tutorials', 'open-panel', 'open-reporter', 'start', 'stop', 'charter',
    'tools', 'tool-sheet', 'status', 'dock', 'theme',
  ];
  const missing = wanted.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `gone from popup.html: ${missing.join(', ')}`);

  for (const name of ['shot-scope', 'rec-scope']) {
    assert.ok(html.includes(`name="${name}"`), `the ${name} radios are gone`);
  }
});

test('the harness can still drive paintRecording from the window', () => {
  // tools/clickthrough.mjs calls window.paintRecording() to reach a recording
  // state no script can start. A `const` would be a lexical binding it cannot
  // see; only `var` and a bare `function` put the name on the window.
  assert.match(
    code,
    /^var paintRecording = safe\(/m,
    'paintRecording is no longer a window property — clickthrough cannot reach it'
  );
});

/* ── 7. the paints cannot escape as unhandled rejections ───────────────── */

test('every async paint is wrapped once, at its definition', () => {
  assert.match(code, /function safe\(fn, name\)/, 'the safe() wrapper is gone');
  for (const name of ['refresh', 'paintSwitch', 'paintRecording', 'refreshRuleState']) {
    assert.match(
      code,
      new RegExp(`^var ${name} = safe\\(${name}Now, '${name}'\\);`, 'm'),
      `${name}() is no longer wrapped — a throw becomes an unhandled rejection on the extension card`
    );
  }
});

test('nothing shadows the el() element helper any more', () => {
  const shadows = [...code.matchAll(/(?:const|let)\s+el\s*=|\(\s*el\s*\)\s*=>/g)].map((m) => m[0]);
  assert.deepEqual(shadows, [], `these bind a local named el(): ${shadows.join(', ')}`);
});

/* ── 8. one resolved context ───────────────────────────────────────────── */

test('the window under test is named on every message that needs one', () => {
  assert.match(code, /const ctx = \{/, 'the resolved context is gone');
  for (const type of ['UQA_ARM', 'UQA_ARMED']) {
    const at = code.indexOf(`'${type}'`);
    assert.ok(at > 0, `${type} is no longer sent from the popup`);
    assert.match(
      code.slice(at, at + 220),
      /ctx\.windowId/,
      `${type} is sent without ctx.windowId — the float asks about its own window`
    );
  }
  for (const type of ['UQA_CAN_RECORD', 'UQA_MASK_PICK', 'UQA_PICK', 'UQA_PARTITIONS']) {
    const at = code.indexOf(`'${type}'`);
    assert.ok(at > 0, `${type} is no longer sent from the popup`);
    assert.match(code.slice(at, at + 200), /ctx\.tabId/, `${type} is sent without ctx.tabId`);
  }
});

test('settings arrive in one place', () => {
  assert.match(code, /function paintFromSettings\(\)/, 'paintFromSettings() is gone');
  const at = code.indexOf("'UQA_SETTINGS_CHANGED'");
  assert.ok(at > 0, 'the popup no longer listens for UQA_SETTINGS_CHANGED');
  assert.match(
    code.slice(at, at + 400),
    /paintFromSettings\(\)/,
    'the settings broadcast repaints something narrower than paintFromSettings()'
  );
});

test('a resting health mark is never the warning colour', () => {
  /*
   * The film critic's §14, as a rule rather than as a frame.
   *
   * `record` is a permanent member of ASKS_FIRST, so its card carried the amber
   * dot on every first open, beside fifteen green ones, in the shot whose whole
   * argument is "sixteen tools, all ready". "The browser asks permission first"
   * is information: nothing has happened, nothing needs deciding, nothing is
   * wrong. Amber is for a thing a tester must act on, and the only mark that
   * earns it is one set *after* a press was refused.
   *
   * Read out of the sheet rather than asserted by hand, so a future edit that
   * repaints `asks` amber fails here rather than in a frame six weeks later.
   */
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  const paint = (state) => {
    const m = css.match(new RegExp(`\\.tool-health\\[data-health='${state}'\\][^{]*\\{([^}]*)\\}`));
    return m ? m[1] : null;
  };

  // The states a card can be wearing before anything has been pressed.
  for (const state of ['ready', 'asks', 'blocked']) {
    const rule = paint(state);
    assert.ok(rule, `.tool-health[data-health='${state}'] has no rule at all`);
    assert.doesNotMatch(rule, /--warn|--danger/, `a resting "${state}" mark is painted a warning colour`);
  }

  // And amber still exists, on the one state that earns it.
  assert.match(paint('warned') || '', /--warn/, 'nothing is painted with --warn any more: the warning colour has no home');
  assert.match(code, /data-health="warned"|'warned'/, 'popup.js never sets the warned state');
  assert.match(code, /const REFUSAL = \//, 'the refusal test that separates amber from red is gone');

  // The states the suites and the film read by name are all still there.
  for (const state of ['ready', 'asks', 'blocked', 'running', 'ok', 'failed', 'warned']) {
    assert.match(css, new RegExp(`data-health='${state}'`), `the ${state} health state lost its paint`);
  }
  assert.match(code, /health\.title = 'The browser asks permission first/, 'the sentence that explains the quiet mark is gone');
});

test('the Record card carries no yellow banner, in either mode', () => {
  /*
   * "Remove the yellow notification on the screen recording", 8 September 2026.
   *
   * The amber paragraph and the amber card border that `UQA_CAN_RECORD` used to
   * draw when `activeTab` had not been granted. It warned about a limitation of
   * the *tab* path on a card that also runs the screen path, where nothing of
   * the kind applies, and its cure was to press the button it was drawn on.
   *
   * Asserted on the source rather than on a screenshot because there is one
   * card and both modes stamp it from the same template: a rule that holds here
   * holds in Simple and in Expert by construction, which is the property mode
   * parity actually needs.
   */
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  assert.ok(!/data-needs-invoke/.test(code), 'popup.js is stamping the amber record card again');
  assert.ok(!/'tool-invoke'/.test(code), 'the amber note is being drawn on the record card again');
  assert.ok(
    !/^\s*\.tool-invoke\s*\{/m.test(css) && !/data-needs-invoke='true'\]\s*\{/.test(css),
    'the paint for the removed banner is back in popup.css'
  );
  // The fact it carried is kept, quietly: the health mark and its tooltip.
  assert.match(code, /UQA_CAN_RECORD/, 'the popup no longer asks whether it may record at all');
  assert.match(
    code,
    /popup\.tools\.invokeShortcut/,
    'the sentence that explains the quiet mark went with the banner'
  );
});

test('an options panel closes when the tester looks elsewhere', () => {
  /*
   * Three ways out, because a disclosure on a card is not a dialog: one open at
   * a time, a click outside closes it, Escape closes it. Left open, the wall
   * became a column of forms and the second one always belonged to a tool the
   * tester had stopped thinking about.
   */
  assert.match(code, /function closeToolPanels\(/, 'nothing closes the option panels any more');
  assert.match(code, /function setToolPanel\(/, 'the panel toggle is not in one place');
  const outside = code.match(/addEventListener\('click', \(event\) => \{\s*const inPanel[\s\S]{0,400}/);
  assert.ok(outside, 'no outside-press listener (on click, capture)');
  assert.ok(!/addEventListener\('(pointerdown|mousedown|touchstart)'/.test(code), 'outside-press-1006: no popup listener may close or fold UI on pointerdown/mousedown: the reflow moves the control between press and release and the first press never clicks');
  assert.match(outside[0], /closeToolPanels\(\)/, 'the outside press does not close the panels');
  assert.match(outside[0], /\.opts-tool/, 'the outside press does not know what is inside a panel');
  assert.match(outside[0], /\.tool-more/, 'the outside press would close the panel the tester is opening');
  const esc = code.match(/event\.key !== 'Escape'[\s\S]{0,400}/);
  assert.ok(esc, 'Escape does not close an option panel');
  assert.match(esc[0], /closeToolPanels\(\)/, 'Escape does not close the panels');
  assert.match(esc[0], /focus\(\)/, 'Escape closes the panel and drops the focus');
  // Opening one closes the others.
  const toggle = code.match(/more\.addEventListener\('click'[\s\S]{0,300}/);
  assert.match(toggle[0], /closeToolPanels\(panel\)/, 'two panels can be open at once');
  // And the selectors the suites drive it by are untouched.
  for (const hook of ['tool-bar', 'tool-more', 'aria-expanded', 'has-options-open']) {
    assert.ok(code.includes(hook), `${hook} is gone: the suites drive the panels by it`);
  }
});

test('reporter mode is reachable, and speaks no test vocabulary', () => {
  /*
   * The rule this surface exists for, checked rather than trusted.
   *
   * Reporter mode is for the person who found the problem and does not test for
   * a living: a colleague in accounts, a client on a call. The moment the word
   * "session" or "charter" appears on it, it becomes another surface for us and
   * stops being one for them. So the words are a rule, and the rule is a test.
   */
  assert.match(html, /id="open-reporter"/, 'the popup has no way into reporter mode');
  assert.match(code, /UQA_OPEN_REPORTER/, 'the button opens nothing');

  const page = fs.readFileSync(path.join(EXT, 'reporter', 'reporter.html'), 'utf8');
  const script = fs.readFileSync(path.join(EXT, 'reporter', 'reporter.js'), 'utf8');
  // The words a person reads: HTML text nodes, and the copy table's strings.
  const copy = [
    ...[...page.matchAll(/>([^<>{}]{3,})</g)].map((m) => m[1]),
    ...[...script.matchAll(/: '([^'\n]{4,})'/g)].map((m) => m[1]),
  ].join(' ');

  for (const word of ['session', 'charter', 'artefact', 'defect', 'evidence', 'severity']) {
    assert.ok(
      !new RegExp(`\\b${word}`, 'i').test(copy),
      `"${word}" is in the reporter's copy: it is not that person's word`,
    );
  }

  // Three things on screen, and every target big enough to hit in a hurry.
  const controls = (page.match(/<(button|textarea)\b/g) || []).length;
  assert.ok(controls <= 4, `${controls} controls on a page whose whole argument is that there are three`);
  const css = fs.readFileSync(path.join(EXT, 'reporter', 'reporter.css'), 'utf8');
  assert.match(css, /min-height: 44px/, 'the reporter buttons do not clear 44px');

  // Both languages, on the page rather than in a plan.
  assert.match(script, /ar: \{/, 'the Arabic half is missing');
  assert.match(script, /dir: 'rtl'/, 'Arabic without direction is not Arabic');
  // And everything technical is gathered rather than asked for.
  assert.match(script, /UQA_REPORTER_CONTEXT/, 'nothing is attached for the reporter');
});

/* ── 9. every tool tile draws its icon ─────────────────────────────────── */
/**
 * `glyph = el('span', 'tool-icon')` was built, `icon(name)` drew the `<svg>`,
 * and the line that put one inside the other — `glyph.append(icon(...))` —
 * was lost in the E4 card rewrite. Every one of the nineteen tiles rendered
 * a `.tool-icon` with nothing in it, and nothing here failed: the element
 * existed, the class existed, only its child was gone.
 *
 * This file has no browser, so "every `.tools .tool-icon` contains an `<svg>`
 * whose innerHTML is non-empty" is checked the way every other rule here is:
 * on the text. Two things have to both hold for that DOM fact to be true —
 * the append call has to exist at all, and `icon()`'s own source, `ICONS[name]
 * || ''`, has to resolve to something non-empty for every tool the popup can
 * draw. Either one breaking is the same bug from the tester's side: a blank
 * square on the card.
 */

test('toolRow() appends the drawn icon into the tile, not just calling icon()', () => {
  assert.match(
    code,
    /glyph\.append\(icon\(/,
    'the append is gone — icon() can build an <svg> all day and none of it reaches the tile'
  );
});

test('TOOLS[] has one row per tool — 19, the count the wall of cards is built from', () => {
  const toolsBlock = code.match(/const TOOLS = \[([\s\S]*?)\n\];/);
  assert.ok(toolsBlock, 'the TOOLS array is gone');
  const count = [...toolsBlock[1].matchAll(/\baction:\s*'[^']+'/g)].length;
  assert.equal(count, 19, `TOOLS declares ${count} tools, expected 19`);
});

test('every TOOLS[] tool names an icon of the UI round 2 family, and it is drawn', () => {
  /*
   * S6 (attack #9): the ICONS literal is gone; each TOOLS entry names its
   * drawing as `icon: 'tool-<id>'` and toolRow() draws `UQAIcons[tool.icon]`.
   * Read out of ui/icons.js the way the page gets it, so a renamed id there or
   * a typo here is a blank square on the card, caught before anyone opens it.
   */
  const toolsBlock = code.match(/const TOOLS = \[([\s\S]*?)\n\];/);
  assert.ok(toolsBlock, 'the TOOLS array is gone');
  const tools = [...toolsBlock[1].matchAll(/\btool:\s*'([^']+)'/g)].map((m) => m[1]);
  const icons = [...toolsBlock[1].matchAll(/\bicon:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(icons.length, tools.length, 'not every TOOLS entry names an icon');
  const sandbox = {};
  new Function('window', fs.readFileSync(path.join(EXT, 'ui', 'icons.js'), 'utf8'))(sandbox);
  const missing = icons.filter((id) => !sandbox.UQAIcons?.[id]);
  assert.deepEqual(missing, [], `these TOOLS icons are not keys of UQAIcons: ${missing.join(', ')}`);
  assert.match(code, /svg\.innerHTML = window\.UQAIcons\?\.\[name\]/, 'icon() no longer draws from UQAIcons');
  assert.match(code, /glyph\.append\(icon\(tool\.icon\)\)/, 'toolRow() does not draw tool.icon');
  assert.ok(!/const ICONS = \{/.test(code), 'a second, local icon literal is back');
  assert.match(html, /<script defer src="\.\.\/ui\/icons\.js"><\/script>[\s\S]*<script defer src="popup\.js">/, 'ui/icons.js must load before popup.js');
});

/* ── S6: the class contract the harnesses and the film safety scan read ── */

test('the rail keeps the class names the harnesses and the film safety scan read', () => {
  /*
   * attack #7: clickthrough, diagnose, ui-shots and film/record/safety.mjs
   * select on these. If one vanished, the film safety scan would count 0 and
   * pass without checking anything, so each is pinned here by name.
   */
  for (const name of ['activity', 'activity-head', 'tool-row', 'tool-name', 'tool-info', 'tool-help', 'tool-what']) {
    assert.match(code, new RegExp(`'[^']*\\b${name}\\b[^']*'`), `popup.js no longer draws .${name}`);
  }
  assert.match(code, /row\.dataset\.tool = tool\.tool/, '.tool-row lost data-tool');
  assert.match(code, /run\.dataset\.action = tool\.action/, 'the row press lost data-action');
});

test('the header wordmark is never cut: no ellipsis, no clipping, no shrink, no hiding', () => {
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.brand-name[^{},]*(?:,[^{}]*)?)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  assert.ok(rules.length >= 1, 'no .brand-name rule found');
  const base = rules.find((r) => /^\.brand-name$/.test(r.sel.split('\n').pop().trim()));
  assert.ok(base, 'no base .brand-name rule');
  assert.match(base.body, /flex:\s*none/, 'the wordmark may shrink again (needs flex: none)');
  assert.match(base.body, /white-space:\s*nowrap/, 'the wordmark may wrap');
  for (const r of rules) {
    assert.ok(!/text-overflow/.test(r.body), `${r.sel}: the wordmark has an ellipsis`);
    assert.ok(!/overflow\s*:\s*(hidden|clip)/.test(r.body), `${r.sel}: the wordmark is clipped`);
    assert.ok(!/clip-path|position:\s*absolute|display:\s*none|visibility:\s*hidden|max-inline-size|max-width|flex-shrink:\s*[1-9]/.test(r.body), `${r.sel}: the wordmark is hidden or capped at some width`);
  }
  assert.match(html, /<span class="brand-name"><bdi>QA Wrap<\/bdi><\/span>/, 'the wordmark text is not the whole "QA Wrap"');
  // 1011 P1-7: the Awake card and its header pill are gone (test-stable-layout asserts that); nothing in the header gives way any more.
});

test('one page, three widths: the menu, the fixed tools list and the strip', () => {
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  assert.ok(!/max-width:\s*392px/.test(css), 'the 392 cap is back');
  assert.ok(!/\bid="mode-/.test(html), 'a Simple/Expert control is back');
  assert.ok(!/transition:[^;]*max-height/.test(css), 'the sheet animates max-height again (a layout property)');
  assert.match(html, /<button id="more"[^>]*aria-haspopup="menu"/, '#more is not a menu button');
  const menu = html.slice(html.indexOf('id="more-menu"'), html.indexOf('</div>\n    </div>', html.indexOf('id="more-menu"')));
  for (const id of ['theme', 'lang', 'open-tutorials', 'open-panel', 'open-reporter']) {
    assert.ok(menu.includes(`id="${id}"`), `#${id} is not inside the ⋯ menu`);
  }
  // Tools are a fixed list (5 Oct 2026): no sheet, no handle, no slide, no drag, no expand state, at any width.
  const narrow = css.match(/@container app \(width < 440px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, 'no narrow container block');
  assert.ok(!/translateY\(calc\(100% - var\(--peek-h\)\)\)|--sheet-top|data-sheet|sheet-handle|sheet-peek|grabber/.test(css), 'the slidable tools sheet is back in popup.css');
  assert.ok(!/sheet-handle|sheet-peek|grabber|data-expanded|data-sheet|tool-sheet-toggle|peek-favs/.test(html), 'the sheet handle is back in popup.html');
  assert.ok(!/setSheet|pointerdown.*sheet|sheet-peek|tool-sheet-toggle|--sheet-top/.test(js), 'the sheet code is back in popup.js');
  assert.match(narrow[0], /\.app \.tools \{[^}]*grid-row: 4;[^}]*\}/, 'narrow: tools are not a grid row under the session');
  assert.match(narrow[0], /\.app \.tools-body \{[^}]*flex: 1;[^}]*min-block-size: 0;[^}]*overflow-y: auto/, 'narrow: the tool list does not fill and scroll inside itself');
  assert.ok(!/position: absolute/.test(narrow[0].match(/\.app \.tools \{[^}]*\}/)[0]), 'narrow: tools float again');
  assert.match(css, /container: app \/ inline-size/, '.app is not the container');
  // Start and Stop sit in the session strip, outside every scroller.
  const strip = html.slice(html.indexOf('class="session-strip"'), html.indexOf('</div>', html.indexOf('class="session-strip"')));
  assert.ok(strip.includes('id="start"') && strip.includes('id="stop"'), 'Start/Stop are not in the session strip');
  assert.ok(!html.includes('class="popup-foot"'), 'the footer is back (its lines live in the ⋯ menu)');
});

/* ── the microphone interstitial ────────────────────────────────────────── */

test('the microphone line is in the record panel, hidden, with both answers', () => {
  /*
   * Decision 29 item 3. Recording a room is not recording a screen: in an
   * all-party jurisdiction everyone whose voice is captured has to have agreed,
   * and the extension cannot know where it is running. So it says the thing
   * once, at the moment the choice is real, and offers the other option beside
   * it rather than refusing or lecturing.
   *
   * What is asserted here is what a source read can settle: the block exists,
   * it is in the record tool's own panel, it starts hidden so it cannot appear
   * on a run with the microphone off, and both answers are real buttons. The
   * "once per session" half is behaviour, and lives in tools/recording.mjs.
   */
  const panel = html.slice(html.indexOf('id="tpl-capture-panel"'), html.indexOf('id="tpl-spec-panel"'));
  assert.ok(panel.includes('id="mic-consent"'), 'the line must be inside the record tool panel');
  assert.match(panel, /<div class="mic-consent" id="mic-consent" hidden>/,
    'it must start hidden: a run with the microphone off must never see it');

  assert.ok(
    panel.includes('The microphone is on for this recording; the law in some places needs everyone&rsquo;s consent'),
    'the sentence is fixed copy and must not drift'
  );
  assert.ok(!/mic-consent[\s\S]{0,600}\u2014/.test(panel), 'no em dash in a string a tester reads');

  for (const [id, label] of [['mic-consent-go', 'Continue'], ['mic-consent-mute', 'Record without mic']]) {
    assert.match(panel, new RegExp(`id="${id}"[^>]*>${label}<`), `the "${label}" button must exist`);
  }

  assert.match(js, /if \(opts\.mic && !\(await micConsentGiven\(\)\)\)/,
    'it must be asked before the recording call, and only when the microphone is on');
  assert.match(js, /answer === 'mute'/,
    '"Record without mic" must actually clear the option, not merely dismiss the line');
  assert.match(js, /if \(answer === 'cancel'\) return say\(''\);/,
    'closing it without answering must record nothing');
  assert.match(js, /chrome\.storage\.session/,
    'the answer is remembered per session, so it does not survive a browser restart');
  assert.match(js, /const MIC_CONSENT_KEY = 'micConsentShown';/);
});

/* ── S7: session states (DESIGN-SPEC §4) — the review-pane hooks ────────── */

test('the contract ids S6 handed on are still there', () => {
  for (const id of ['start', 'stop', 'charter', 'step-live']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is gone — a harness drives the popup by it`);
  }
  assert.match(html, /data-awake=/, 'data-awake is gone from <body>');
});

test('the review pane (§4.5): a focusable heading, 4 export buttons, both open-report keys', () => {
  const done = html.slice(html.indexOf('id="step-done"'), html.indexOf('</section>', html.indexOf('id="step-done"')));
  assert.match(done, /id="review-heading"[^>]*tabindex="-1"/, '#review-heading is missing or is not a focus target');
  assert.match(done, /id="done-summary"/, 'done-summary is gone — refreshNow()/the stop handler write the dynamic summary into it');

  const formats = [...done.matchAll(/data-format="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(formats.sort(), ['json', 'markdown', 'playwright', 'sbtm'], 'the review pane does not offer exactly the 4 existing export formats');

  assert.match(done, /id="stat-duration"/, 'the duration stat tile is gone');
  assert.match(done, /id="stat-steps"/, 'the steps stat tile is gone');
  assert.match(done, /id="stat-problems"/, 'the problems stat tile is gone');
  assert.match(done, /id="stat-notes"/, 'the notes stat tile is gone');
  assert.match(done, /id="findings-list"/, 'nowhere for the key findings to be drawn');

  // The Lead's decision (research/56, 27 Sept, NEW-STRINGS row 31): the review
  // pane's primary is the NEW key; the existing one "stays where it is" — in
  // the tables, so a caller elsewhere can still ask for it by name.
  assert.match(done, /id="view-report"[^>]*data-i18n="popup\.review\.openFullReport"/, '#view-report does not carry the review pane\'s own key');
  for (const table of ['en', 'ar']) {
    const rows = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${table}.json`), 'utf8'));
    assert.ok('popup.done.openReport' in rows, `popup.done.openReport left the ${table} table — NEW-STRINGS row 31 keeps it`);
  }
});

test('last locator as a label; no quick row, no Problems/Everything switch on the panel (5 Oct 2026)', () => {
  for (const section of ['step-idle', 'step-live']) {
    const body = html.slice(html.indexOf(`id="${section}"`), html.indexOf('</section>', html.indexOf(`id="${section}"`)));
    assert.ok(!/quick-row|data-quick|quick-proxy/.test(body), `#${section} still carries the quick row`);
    assert.match(body, /class="last-locator"/, `#${section} has no last-locator row`);
  }
  assert.ok(!html.includes('id="sg-live"'), 'the live Problems/Everything block is gone');
  assert.ok(!/quick-row|quick-proxy|data-quick/.test(code), 'nothing wires or gates the removed quick row');
  assert.ok(!code.includes("'common.signal.show"), 'the popup draws no Problems/Everything switch');
  assert.match(code, /const sgLevel = \(\) => 'problems';/, 'the popup is fixed on Problems; the report keeps the switch');
  assert.match(code, /code\.textContent = lastLocator \? locatorLabel\(lastLocator\)/, 'the preview shows the label');
  assert.match(code, /code\.title = lastLocator/, 'the raw locator stays in the title');
  const src = code.slice(code.indexOf('function locatorLabel'), code.indexOf('async function copyLocatorAgain'));
  const label = new Function('t', `${src}; return locatorLabel;`)((k) => k.split('.').pop());
  assert.equal(label("page.getByRole('button', { name: 'Submit', exact: true })"), 'Submit · button');
  assert.equal(label("getByTestId('qoe-card')"), 'qoe-card · testId');
  assert.equal(label("getByRole('link')"), 'link');
  assert.equal(label("page.locator('#a')"), "page.locator('#a')", 'anything else is shown as it is');
  assert.equal(label("getByRole('button').first()"), "getByRole('button').first()", 'a chain is shown as it is');
  for (const k of ['testId', 'label', 'placeholder', 'text', 'alt', 'title']) {
    const en = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'en.json'), 'utf8'));
    const ar = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'ar.json'), 'utf8'));
    assert.ok(en[`popup.live.loc.${k}`] && ar[`popup.live.loc.${k}`], `popup.live.loc.${k} in both languages`);
  }
});

test('the header status chip and the restricted/worker banner exist', () => {
  assert.match(html, /id="status-chip"[^>]*hidden/, '#status-chip is gone, or starts visible');
  assert.match(html, /id="state-banner"[^>]*role="status"/, '#state-banner is gone, or is not role=status');
  assert.match(code, /function paintBanner\(/, 'nothing paints the banner');
  // §4.7: warn colours, never red — the S1 rule this stage must not break.
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  const rule = css.match(/\.state-banner\s*\{[^}]*\}/);
  assert.ok(rule, '.state-banner has no rule at all');
  assert.doesNotMatch(rule[0], /--fail|--danger/, 'the banner is painted a failure colour, not a warning one');
});

test('the live-session work pane exists, wide-gated, inside the work pane', () => {
  const body = html.slice(html.indexOf('id="body"'), html.indexOf('id="tpl-shot-panel"'));
  assert.match(body, /id="work-live"[^>]*hidden/, '#work-live is gone, or starts visible with no state to hide it');
  assert.match(code, /function paintWorkLive\(/, 'nothing paints the work pane');
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  assert.match(css, /@container app \(width >= 720px\) \{\s*\.work-live/, 'the work pane is not gated to wide');
});

/* ── 7. T-056 / T-063: the Trust link on the consent card, the footer's mail link ─ */

const modUrl = (m) => new URL(`../${m.replace(/^\.\.\//, '')}`, import.meta.url).href;
// The real function from popup.js, run against the real modules; `import('../x.js')` is routed to `__imp`.
const lift = (re) => code.match(re)[0].replace(/import\('([^']+)'\)/g, "__imp('$1')");

try {
  const link = { hidden: true, href: '' };
  assert.match(html, /<section class="consent" id="consent-card"[\s\S]*id="consent-trust"[^>]*hidden[\s\S]*<\/section>/, 'no #consent-trust link inside the card');
  assert.match(html, /id="consent-trust"[^>]*rel="noopener noreferrer"/);
  assert.match(code, /paintTrustLink\(\);/, 'boot never paints the trust link');
  const { PRODUCT } = await import('../core/product.js');
  // brand/brand.json may leave the address empty (then the link stays hidden); a stub with an address proves the link is built from it.
  const paint = async (product) => {
    const l = { hidden: true, href: '' };
    const ctx = { $: (id) => (id === 'consent-trust' ? l : null), __imp: (m) => (m.endsWith('product.js') ? Promise.resolve(product) : import(modUrl(m))) };
    vm.createContext(ctx);
    vm.runInContext(`${lift(/function paintTrustLink\(\) \{[\s\S]*?\n\}/)}\npaintTrustLink();`, ctx);
    await new Promise((r) => setTimeout(r, 100));
    return l;
  };
  const built = await paint({ PRODUCT: { urls: { trust: 'https://example.test/trust' } } });
  assert.equal(built.href, 'https://example.test/trust');
  assert.equal(built.hidden, false);
  const real = await paint({ PRODUCT });
  assert.equal(real.hidden, PRODUCT.urls.trust === '', 'an empty address keeps the link hidden');
  passed++; console.log('  ok  T-056 the consent card links the Trust page from PRODUCT.urls.trust, hidden until the address is read (and while it is empty)');
} catch (err) { failures.push('T-056 consent trust link'); console.log(`  FAIL T-056 consent trust link\n       ${err.message}`); }

try {
  assert.match(html, /<a class="menu-row"[^>]*id="report-mail"[^>]*href="#"[^>]*hidden/, 'no hidden #report-mail anchor in the menu');
  assert.ok(!/id="report-mail"[^>]*target=/.test(html), 'a mailto must not open a tab');
  assert.match(code, /setTimeout\(paintMailLink, (\d+|TIMING\.\w+)\)/, 'boot never builds the mail link');
  const src = lift(/const MAIL_MAX = \d+;[^\n]*\nasync function paintMailLink\(\) \{[\s\S]*?\n\}/);
  assert.ok(!/fetch\(|sendMessage|XMLHttpRequest|sendBeacon/.test(src), 'the mail link sends nothing itself');
  globalThis.chrome ??= { runtime: { getManifest: () => ({ version: '9.9.9' }), id: 'x' } };
  const MAIL = 'help@example.test';
  const a = { hidden: true, href: '#' };
  const ring = Array.from({ length: 40 }, (_, i) => ({ t: 1e12 + i, name: 'Error', msg: `handler ${i} failed on https://secret.example.com/x?token=abc123456789` }));
  const stub = { capabilities: { detect: () => ({ caps: { clipboard: true } }) }, on: { RING_KEY: 'handlerRing' }, settings: { DEFAULTS: { redact: true } } };
  const ctx = {
    $: (id) => (id === 'report-mail' ? a : null), settings: {}, navigator: { userAgent: 'Chrome/1 (Windows NT)' },
    __imp: (m) => (m.endsWith('capabilities.js') ? stub.capabilities : m.endsWith('/on.js') ? stub.on : m.endsWith('/settings.js') ? stub.settings : m.endsWith('/product.js') ? Promise.resolve({ describe: () => ({ name: 'QA Wrap', version: '9.9.9', code: 'QAW-9.9.9', supportEmail: MAIL }) }) : import(modUrl(m))), // a stub address: brand/brand.json may leave the mailbox empty, and then the link stays hidden
    chrome: { storage: { local: { get: async () => ({ handlerRing: ring, bootMs: [120, 140], toolUseTicks: 7 }) } }, permissions: { getAll: async () => ({ origins: ['https://secret.example.com/*'] }) }, runtime: { getManifest: () => ({ version: '9.9.9' }) } },
    encodeURIComponent, Promise, Math,
  };
  vm.createContext(ctx);
  await vm.runInContext(`${src}\npaintMailLink()`, ctx);
  assert.equal(a.hidden, false, 'the link was never built');
  const u = new URL(a.href);
  assert.equal(u.protocol, 'mailto:');
  assert.equal(decodeURIComponent(u.pathname), MAIL);
  const text = u.searchParams.get('body');
  assert.match(text, /support details/);
  assert.match(text, /worker start times \(ms, last 5\): 120, 140/);
  assert.match(text, /tool uses on this machine: 7/);
  assert.ok(!/secret\.example\.com|abc123456789/.test(a.href), 'the bundle leaked an origin or a token');
  assert.ok(encodeURIComponent(text).length <= Number(code.match(/const MAIL_MAX = (\d+)/)[1]), 'the body is cut to what a mail client takes');
  passed++; console.log('  ok  T-063 the footer mail link carries the support bundle, opens a mail client and sends nothing');
} catch (err) { failures.push('T-063 footer mail link'); console.log(`  FAIL T-063 footer mail link\n       ${err.message}`); }

test('r4-09-1: "New session" stays dismissed across refresh(): the id is kept outside `state`, and a fresh snapshot of the same session is not "stopped"', () => {
  assert.ok(!/state\.dismissed/.test(code), 'state.dismissed is back: refresh() replaces `state`, so the dismissal is lost');
  assert.match(code, /^let dismissedSessionId = null;/m, 'no module-level dismissedSessionId');
  assert.match(code, /dismissedSessionId = state\.lastSession\?\.id \?\? null;/, 'the New session handler does not record the id');
  const line = code.match(/const stopped = [^\n]*;/)[0];
  assert.match(line, /finished\.id !== dismissedSessionId/, 'stopped must compare the finished id with the dismissed one');
  const run = (state, dismissedSessionId) => vm.runInNewContext(`(() => { const recording = !!state.recording && !!state.session; const finished = state.lastSession || null; ${line} return stopped; })()`, { state, dismissedSessionId });
  const snap = () => ({ recording: false, session: null, lastSession: { id: 's1' } }); // what refresh() hands back: always a new object
  assert.equal(run(snap(), null), true, 'a finished, undismissed session shows the Stopped card');
  assert.equal(run(snap(), 's1'), false, 'a fresh state object after dismissal must not bring the card back');
  assert.equal(run({ ...snap(), lastSession: { id: 's2' } }, 's1'), true, 'a different finished session is offered again');
});

// 1011 P1-7: the two Awake-card collapse pins (5 s timer, pill, Wake/Sleep arming) were deleted with the card; tools/test-stable-layout.mjs asserts it is gone.

test('09-3: Enter in the charter field starts a session only outside an IME composition', () => {
  const code = surfaceSource('popup/popup.js');
  assert.match(code, /if \(e\.key === 'Enter' && !e\.isComposing\) \$\('start'\)\.click\(\)/, 'the charter Enter must check isComposing');
});

test('every Enter-to-submit handler skips an IME composition (r2-09-2)', () => {
  for (const [file, pattern] of [
    ['content/picker.js', /if \(e\.key === 'Enter' && !e\.isComposing\) submit\(\)/],
    ['content/keymap.js', /if \(e\.key === 'Enter' && !e\.isComposing\) send\(/],
    ['annotate/annotate.js', /if \(e\.isComposing\) return;\s*if \(e\.key === 'Enter'\) finish\(true\)/],
    ['videoedit/videoedit.js', /if \(e\.key === 'Enter' && !e\.isComposing\) finish\(true\)/],
  ]) {
    const src = fs.readFileSync(path.join(EXT, file), 'utf8');
    assert.match(src, pattern, `${file}: Enter must check isComposing, or the Enter that picks an IME candidate submits`);
  }
});

test('r3-07-2 / r3-07-3: refreshNow and the ticker share one since/maxSeq read behind the workReadBusy guard', () => {
  const code = surfaceSource('popup/popup.js');
  const read = code.slice(code.indexOf('async function readWorkLive('), code.indexOf('function paintWorkLive('));
  assert.ok(read.length > 100, 'readWorkLive exists');
  assert.match(read, /if \(!live \|\| workReadBusy\) return;/, 'one read in flight');
  assert.match(read, /fetchTimeline\(live\.id, since \? \{ sinceSeq: since \} : \{\}\)/, 'incremental by seq after the first read');
  assert.match(read, /if \(tl\.incremental && !tl\.events\?\.length\) return;/, 'an empty incremental answer repaints nothing');
  const refresh = code.slice(code.indexOf('async function refreshNow('), code.indexOf('var refresh = safe(refreshNow'));
  assert.match(refresh, /readWorkLive\(state\.session\)/, 'refreshNow reads through the shared path');
  assert.ok(!/fetchTimeline\(state\.session\.id\)/.test(refresh), 'refreshNow no longer reads the whole session itself');
  const ticker = code.slice(code.indexOf('const sessionTicker = makeTicker('), code.indexOf('}, 1000);'));
  assert.match(ticker, /await readWorkLive\(live\)/, 'the ticker reads through the shared path');
  assert.ok(!/fetchTimeline\(/.test(ticker), 'the ticker has no read of its own');
});

test('r3-09-5: the ticker captures its session before the await and bails if it changed', () => {
  const code = surfaceSource('popup/popup.js');
  const ticker = code.slice(code.indexOf('const sessionTicker = makeTicker('), code.indexOf('}, 1000);'));
  const at = ticker.indexOf("await send({ type: 'UQA_GET_STATE' })");
  assert.ok(ticker.indexOf('const live = state.session;') > -1 && ticker.indexOf('const live = state.session;') < at, 'live is captured before the first await');
  assert.match(ticker.slice(at), /if \(state\.session\?\.id !== live\.id\) return;/, 'bails if the session changed during the await (by id: refresh() swaps the object, r4-09-3)');
  assert.ok(!/state\.session\.id/.test(ticker.slice(at)), 'no unguarded state.session.id after the await');
});

test('r3-09-3: an export disables its button before the first await, restores it in finally and says the error', () => {
  const code = surfaceSource('popup/popup.js');
  const h = code.slice(code.indexOf("document.querySelectorAll('[data-format]').forEach((btn) => {"), code.indexOf('/* --------------------------------------------------------------------- tools */'));
  assert.ok(h.indexOf('btn.disabled = true;') > -1 && h.indexOf('btn.disabled = true;') < h.indexOf('await '), 'disabled before the first await');
  assert.match(h, /\} catch \(err\) \{\s*say\(t\('popup\.export\.failed'/, 'a throw is spoken');
  assert.match(h, /\} finally \{\s*btn\.disabled = false;/, 'restored in finally');
});

test('r3-09-4: the stopped card shows a duration through {time}, as an en/ar pair', () => {
  // sdlc-1014b: ONE duration source (doneTime in popup/done-card.js) feeds the line, the Duration tile and the clean line.
  const code = surfaceSource('popup/popup.js');
  const card = fs.readFileSync(path.join(EXT, 'popup', 'done-card.js'), 'utf8');
  assert.match(card, /function doneTime\(finished\) \{\s*return fmtDuration\(Math\.max\(0, \(finished\.endedAt \|\| Date\.now\(\)\) - finished\.startedAt\)\);/);
  assert.match(card, /t\('popup\.done\.summary', \{ charter: iso\(titleNow\(finished\)\), time: doneTime\(finished\) \}\)/);
  assert.match(code, /\$\('done-summary'\)\.textContent = doneLine\(finished\)/);
  assert.ok(!/Math\.round\(\(\(finished\.endedAt/.test(code), 'no second rounding of the duration in popup.js');
  for (const lang of ['en', 'ar']) {
    const table = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', lang + '.json'), 'utf8'));
    assert.match(table['popup.done.summary'], /\{time\}/, lang + ': {time} placeholder');
    assert.ok(!/\{secs\}/.test(table['popup.done.summary']), lang + ': no raw seconds');
  }
});

test('r3-10-3: the settings search folds the term and the row text through normaliseArabic', () => {
  const code = fs.readFileSync(path.join(EXT, 'options', 'options.js'), 'utf8');
  assert.match(code, /import \{ normaliseArabic \} from '\.\.\/core\/fingerprint\.js'/);
  assert.match(code, /const term = fold\(q\.value\.trim\(\)\);/);
  assert.match(code, /fold\(`\$\{r\.textContent\} \$\{r\.dataset\.kw \|\| ''\}`\)\.includes\(term\)/);
});

test('r3-10-5: identity-tokens.css names Thmanyah, not Cairo', () => {
  assert.ok(!/cairo/i.test(fs.readFileSync(path.join(EXT, 'ui', 'identity-tokens.css'), 'utf8')), 'identity-tokens.css mentions Cairo');
});

test('r5-09-1: the dismissal is persisted in chrome.storage.session for the worker to honour', () => {
  assert.match(code, /chrome\.storage\.session\.set\(\{ dismissedSessionId \}\)/, 'the popup does not persist the dismissed id');
  const at = code.indexOf("$('new-session').addEventListener('click'");
  const handler = code.slice(at, code.indexOf('});', at));
  assert.match(handler, /storage\.session\.set\(\{ dismissedSessionId \}\)/, 'persisted from the New session handler');
});

test('r1-09-4 (D-1010-05): Enter in the note field always uses the chosen tag, with no shift branch', () => {
  const at = code.indexOf("$('note-text').addEventListener('keydown'");
  assert.ok(at > 0, 'the note field keydown handler is gone');
  const handler = code.slice(at, code.indexOf('});', at));
  assert.ok(!/shiftKey/.test(handler), 'the Enter handler still reads shiftKey');
  assert.match(handler, /addNote\(chosenTag\)/, 'Enter does not file under the chosen tag');
});

test('r1-09-3: the sleep settle path reads .stopped and says a session or clip was stopped and saved', () => {
  const at = code.indexOf('const slept = res.result');
  assert.ok(at > 0, 'the settle path no longer reads res.result');
  const block = code.slice(at, at + 1100);
  assert.match(block, /res\.result\?\.stopped/, 'settle does not read .stopped');
  assert.match(block, /popup\.switch\.saidAsleepStopped/, 'no sentence for a stopped session');
  assert.match(block, /popup\.switch\.saidAsleepClip/, 'no sentence for a stopped clip');
  assert.match(block, /popup\.switch\.saidAsleep'/, 'the plain sleep sentence is gone');
});

test('r1-10-1 / r1-04-3: the partitions panel renders the core\'s codes through t() and handles needsInput', () => {
  const at = code.indexOf('function paintPartitions()');
  const body = code.slice(at, code.indexOf('async function fillField', at));
  for (const needle of ['bbText(part.i18n?.label', 'bbText(part.i18n?.why', 'bbText(boundary.i18n?.boundary', 'bbText(value.i18n?.position', 'bbText(value.i18n?.why', 'part.needsInput']) {
    assert.ok(body.includes(needle), `paintPartitions no longer uses ${needle}`);
  }
  assert.ok(!/el\('em', null, (?:part|value)\.why\)/.test(body), 'a raw English why is appended again');
  assert.ok(!/el\('b', null, (?:part\.label|value\.position)\)/.test(body), 'a raw English label is appended again');
  assert.match(code, /popup\.partitions\.bb\.\$\{ref\.code\}/, 'bbText no longer builds the key from the code');
});

test('r1-09-1 (D-1010-04): worker errors are translated on the UI side, after the fix chip and sound are chosen', () => {
  assert.match(code, /import\('\.\.\/platform\/worker-errors\.js'\)/, 'popup does not load platform/worker-errors.js');
  const at = code.indexOf('function say(text');
  const body = code.slice(at, at + 2600);
  assert.match(body, /workerErrorText\(text\)/, 'say() does not translate a worker sentence');
  assert.match(body, /fixFor\(text\)/, 'the fix chip must still be chosen from the original words');
  assert.match(body, /refusalSound\(text\)/, 'the refusal sound must still be chosen from the original words');
  const bg = workerSrc();
  assert.ok(!/worker-errors/.test(bg), 'the worker must not import worker-errors.js (zero worker bytes)');
});

test('D-1010-139: the own-value input is a masked password input for a password field, and nothing echoes the value', () => {
  const at = code.indexOf('function ownValueForm(');
  const body = code.slice(at, code.indexOf('async function fillField', at));
  assert.ok(body.includes("lastPartitions?.field?.type === 'password'"), 'the password check is gone');
  assert.ok(body.includes("input.type = secret ? 'password' : 'text'"), 'the input is not typed password for a password field');
  assert.ok(body.includes("input.autocomplete = 'off'"), 'autocomplete is not switched off');
  assert.ok(!/say\([^;]*input\.value/.test(body), 'say() echoes the typed value');
  const fill = code.slice(code.indexOf('async function fillField'), code.indexOf('async function fillField') + 900);
  assert.ok(!/say\([^;]*value/.test(fill.replace(/res\.error/g, '')), 'fillField says the value');
});

test('D-1010-141: five STATE_CHANGED paints of a finished session cost one UQA_GET_TIMELINE', () => {
  const from = js.indexOf('let finishedTimeline');
  const to = js.indexOf('async function fetchTimeline');
  assert.ok(from > 0 && to > from, 'the finished-timeline cache is gone');
  let reads = 0;
  const ctx = { reads: () => reads, fetchTimeline: async () => { reads++; return { events: [] }; } };
  vm.createContext(ctx);
  vm.runInContext(js.slice(from, to) + '; this.finishedTimelineFor = finishedTimelineFor;', ctx);
  const finished = { id: 's1', endedAt: 1000 };
  [1, 2, 3, 4, 5].forEach(() => ctx.finishedTimelineFor(finished)); // the read is counted at the call, so no await is needed
  assert.equal(reads, 1, 'five paints of the same finished session read the timeline more than once');
  ctx.finishedTimelineFor({ id: 's1', endedAt: 2000 });
  assert.equal(reads, 2, 'a different endedAt must read again');
  assert.ok(code.includes('finishedTimelineFor(finished)'), 'the stopped branch no longer uses the cache');
});

test('D-1010-143: the dead time-box UI code is gone, the stored setting stays', () => {
  assert.ok(!code.includes('UQA_TIMEBOX_EXPIRED'), 'the popup still handles a message nothing sends');
  assert.ok(!code.includes('popup.err.timebox'), 'the popup still reads popup.err.timebox');
  assert.ok(code.includes('timeboxEnabled'), 'the timeboxEnabled setting key must stay');
});

test('D-1010-140: the popup shows a caught failure through describeError, raw text only in the title', () => {
  assert.ok(code.includes('function sayFailure(err)') && code.includes('describeError(err, t)'), 'sayFailure is gone');
  assert.ok(!code.includes("say(String(err?.message || err), 'err')"), 'a raw message reaches say() again');
});

test('D-218: Start, Pick, Inject data and Record tab show the bound browser shortcut, and nothing when none is bound', async () => {
  const from = js.indexOf('const COMMAND_TARGETS');
  const to = js.indexOf('/* -------------------------------------------------------------- the panels */');
  assert.ok(from > 0 && to > from, 'the command-chip block is gone');
  assert.equal((js.match(/type: 'UQA_COMMANDS'/g) || []).length, 1, 'the popup must ask UQA_COMMANDS exactly once');
  // A minimal element: attributes, children, and the selectors the block uses.
  const make = (tag, cls = '') => {
    const e = { tag, cls, attrs: {}, kids: [], parent: null, hidden: false, dir: '', textContent: '' };
    Object.defineProperty(e, 'className', { get: () => e.cls, set: (v) => { e.cls = v; } });
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    e.removeAttribute = (k) => { delete e.attrs[k]; };
    e.append = (c) => { c.parent = e; e.kids.push(c); };
    e.after = (c) => { const i = e.parent.kids.indexOf(e); c.parent = e.parent; e.parent.kids.splice(i + 1, 0, c); };
    e.remove = () => { e.parent.kids.splice(e.parent.kids.indexOf(e), 1); e.parent = null; };
    e.querySelector = (sel) => e.kids.find((k) => (sel === 'kbd.cmd' ? k.tag === 'kbd' && k.cls.includes('cmd') : sel === 'kbd:not(.cmd)' ? k.tag === 'kbd' && !k.cls.includes('cmd') : false)) || null;
    return e;
  };
  const start = make('button'); start.append(make('kbd', 'cmd'));
  const rows = {};
  for (const tool of ['pick', 'inject', 'record']) { rows[tool] = make('button'); rows[tool].append(make('kbd')); }
  const document = {
    querySelector: (sel) => (sel === '#start' ? start : rows[/data-tool="(\w+)"/.exec(sel)?.[1]] || null),
    createElement: (tag) => make(tag),
  };
  const ctx = { document, send: async () => ({ ok: true, result: [
    { name: 'toggle-recording', shortcut: 'Alt+Shift+Q' }, { name: 'pick-element', shortcut: 'Alt+Shift+S' },
    { name: 'inject-data', shortcut: '' }, { name: 'record-tab', shortcut: 'Alt+Shift+V' }, { name: '_execute_action' },
  ] }) };
  vm.createContext(ctx);
  vm.runInContext(js.slice(from, to) + '; this.loadCommandChips = loadCommandChips;', ctx);
  await ctx.loadCommandChips();
  assert.equal(start.attrs['aria-keyshortcuts'], 'Alt+Shift+Q');
  assert.equal(start.querySelector('kbd.cmd').textContent, 'Alt+Shift+Q');
  assert.equal(start.querySelector('kbd.cmd').hidden, false);
  assert.equal(rows.pick.attrs['aria-keyshortcuts'], 'Alt+Shift+S');
  assert.equal(rows.pick.querySelector('kbd.cmd').dir, 'ltr', 'the chip must be left-to-right inside an Arabic page');
  assert.equal(rows.record.attrs['aria-keyshortcuts'], 'Alt+Shift+V');
  // Unset: an unassigned command shows nothing at all.
  assert.ok(!('aria-keyshortcuts' in rows.inject.attrs), 'an unassigned command must not promise a key');
  assert.equal(rows.inject.querySelector('kbd.cmd'), null, 'an unassigned command must not draw a chip');
  // A command unbound later disappears on the next paint.
  ctx.send = async () => ({ ok: true, result: [] });
  await ctx.loadCommandChips();
  assert.ok(!('aria-keyshortcuts' in rows.pick.attrs) && rows.pick.querySelector('kbd.cmd') === null, 'an unbound command kept its chip');
  assert.ok(html.includes('<kbd class="cmd" dir="ltr" hidden></kbd>'), 'the Start button lost its chip slot');
});

test('the float Dock button opens the side panel in the window beneath, synchronously (sidepanel-1010)', () => {
  const js = surfaceSource('popup/popup.js');
  const at = js.indexOf("$('dock')?.addEventListener('click'");
  assert.ok(at > 0, 'the dock handler is gone');
  const body = js.slice(at, js.indexOf("$('view-report')", at));
  assert.ok(body.indexOf('chrome.sidePanel') > 0, 'the dock handler no longer calls sidePanel.open');
  assert.ok(!/\bawait\b/.test(body.slice(0, body.indexOf('chrome.sidePanel')).replace(/\/\/.*$/gm, '')), 'an await before sidePanel.open spends the user gesture');
  assert.ok(/!== ctx\.ownWindowId/.test(body) && /ctx\.windowId/.test(body), 'the target may be the float itself, which cannot host the panel');
  assert.ok(/ctx\.hostWindowId/.test(body) && /hostWindowId = w\?\.id/.test(js), 'the browser window beneath is not cached at boot');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
