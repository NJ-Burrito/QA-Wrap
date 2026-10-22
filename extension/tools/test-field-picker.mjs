/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The field picker, and every kind of field it now has to understand.
 *
 * E7: "design the values: like the mask or the locator picker, pressing it
 * gives a cursor to pick a field, instead of pre-clicking one; support every
 * input type (text, number, date, select, radio, checkbox, file, range,
 * textarea, contenteditable)."
 * E8: "try nasty values: the same picker; a reset button that unmarks the
 * selection."
 *
 * Both tools read the page through `content/data-injector.js`, which knew about
 * `input` and `textarea` and nothing else: its crosshair matched two tags, its
 * `setValue` wrote `el.value = 'true'` at a checkbox (which sets the value a
 * form submits and leaves the box exactly as unticked as it was, so every
 * checkbox test the palette offered was a silent no-op), and its value list
 * offered "5000 characters" to a dropdown.
 *
 * Lifted by name out of the real file, the way `test-graphql.mjs` lifts the
 * page hooks, because that file is an IIFE in a content script and cannot be
 * imported. A copy of the logic here would pass for ever while the shipped code
 * moved.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift as liftSource } from './lib-lift.mjs';
import { partitions, boundaries } from '../core/blackbox.js';
import { workerSrc } from './lib-worker-src.mjs';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const SOURCE = fs.readFileSync(path.join(EXT, 'content', 'data-injector.js'), 'utf8');
const CSS = fs.readFileSync(path.join(EXT, 'content', 'overlay.css'), 'utf8');
const POPUP_JS = surfaceSource('popup/popup.js');
const POPUP_HTML = fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8');
const DISPATCH_TABLES = fs.readFileSync(path.join(EXT, 'background', 'dispatch-tables.js'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const lift = (name) => liftSource(SOURCE, name);

/** A `const NAME = …;` out of the source. The tree is CRLF, so the newline is matched loosely. */
function constOf(name) {
  // The `=` may be on the next line: `PICKABLE` is a selector built from three
  // concatenated strings and is written that way so it stays readable.
  const at = SOURCE.search(new RegExp(`\\bconst ${name}\\s*=`));
  if (at === -1) throw new Error(`data-injector.js no longer declares ${name} — this test is out of date, not wrong`);
  const rest = SOURCE.slice(at);
  // A trailing comment is still the end of the line: `const TATWEEL = '…'; //
  // tatweel` ended at the *next* line-final semicolon without this, which
  // silently swallowed the declaration after it and failed as a duplicate
  // identifier three constants later.
  const end = rest.search(/;(?:[ \t]*\/\/[^\n]*)?\r?\n/);
  if (end === -1) throw new Error(`the declaration of ${name} does not end on its own line`);
  return rest.slice(0, end + 1);
}

/* ── the stub: only what the lifted functions touch ─────────────────────── */

class Field {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.attrs = new Map(Object.entries(props.attrs || {}));
    this.type = props.type || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select-one' : 'text');
    this.value = props.value ?? '';
    this.checked = props.checked ?? false;
    this.name = props.name || '';
    this.options = props.options || [];
    this.multiple = props.multiple ?? false;
    this.isContentEditable = props.contentEditable ?? false;
    this.textContent = props.text || '';
    this.events = [];
    this.clicks = 0;
    this.focused = false;
  }

  get id() { return this.attrs.get('id') || ''; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  focus() { this.focused = true; }
  click() { this.clicks++; this.checked = !this.checked; this.events.push('click'); }
  dispatchEvent(e) { this.events.push(e.type); return true; }
  matches(selector) { return matchesPickable(selector, this); }
}

/**
 * `PICKABLE` is a real selector and the stub is not a real engine, so this
 * reads the selector out of the shipped file and answers the two questions it
 * actually asks: is this one of the listed tags, and is this input of a type
 * the `:not()` list excludes.
 */
function matchesPickable(selector, el) {
  const parts = selector.split(',').map((s) => s.trim());
  for (const part of parts) {
    if (part.startsWith('input')) {
      if (el.tagName !== 'INPUT') continue;
      const banned = [...part.matchAll(/:not\(\[type=([\w-]+)\]\)/g)].map((m) => m[1]);
      if (banned.includes((el.type || '').toLowerCase())) return false;
      return true;
    }
    if (part.startsWith('[contenteditable')) {
      if (el.isContentEditable) return true;
      continue;
    }
    if (el.tagName === part.toUpperCase()) return true;
  }
  return false;
}

class Option {
  constructor(value, label, selected = false) {
    this.value = value;
    this.textContent = label;
    this.selected = selected;
  }
}

const build = new Function(
  'doc',
  `const document = doc;
   const window = { UQASelector: { accessibleName: (el) => (el.attrs.get('aria-label') || el.name || '') } };
   const CSS = { escape: (s) => s };
   class FakeEvent { constructor(type) { this.type = type; } }
   const Event = FakeEvent;
   const InputEvent = FakeEvent;
   const HTMLTextAreaElement = function () {};
   const HTMLInputElement = function () {};
   ${constOf('SEMANTICS')}
   ${constOf('AR_NAME')}
   ${constOf('AR_LONG')}
   ${constOf('TATWEEL')}
   ${constOf('BIDI_MIX')}
   ${constOf('ZALGO')}
   ${constOf('PICKABLE')}
   ${constOf('CHOICE')}
   ${constOf('landedResult')}
   ${lift('labelText')}
   ${lift('inspect')}
   ${lift('boundaryValues')}
   ${lift('fire')}
   ${lift('setValue')}
   return { inspect, boundaryValues, setValue, PICKABLE, CHOICE };`
);

const api = build({ querySelectorAll: () => [] });

/* ── 1. every field type is read ────────────────────────────────────────── */

console.log('data-injector.js — reading every kind of field');

test('a select is read as a choice, with its options', () => {
  const el = new Field('select', {
    type: 'select-one',
    options: [new Option('amman', 'Amman', true), new Option('irbid', 'Irbid')],
  });
  const f = api.inspect(el);
  assert.equal(f.kind, 'choice');
  assert.equal(f.tag, 'select');
  assert.deepEqual(f.options.map((o) => o.value), ['amman', 'irbid']);
});

test('a checkbox reports whether it is ticked', () => {
  const f = api.inspect(new Field('input', { type: 'checkbox', checked: true }));
  assert.equal(f.type, 'checkbox');
  assert.equal(f.checked, true);
});

test('a radio is read as its whole group, because one button is never the question', () => {
  const a = new Field('input', { type: 'radio', name: 'city', value: 'amman', checked: true });
  const b = new Field('input', { type: 'radio', name: 'city', value: 'irbid' });
  const withGroup = build({ querySelectorAll: (sel) => (sel.includes('radio') ? [a, b] : []) });
  const f = withGroup.inspect(a);
  assert.deepEqual(f.options.map((o) => o.value), ['amman', 'irbid']);
});

test('a file field reports what it says it accepts', () => {
  const f = api.inspect(new Field('input', { type: 'file', attrs: { accept: '.pdf,.png' } }));
  assert.equal(f.kind, 'file');
  assert.equal(f.accept, '.pdf,.png');
});

test('a range is a number with bounds, not a text box', () => {
  const f = api.inspect(new Field('input', { type: 'range', attrs: { min: '0', max: '10', step: '2' } }));
  assert.equal(f.kind, 'amount');
  assert.equal(f.step, '2');
});

test('a contenteditable div is read as an editor, not skipped', () => {
  const f = api.inspect(new Field('div', { contentEditable: true, text: 'notes' }));
  assert.equal(f.type, 'contenteditable');
  assert.equal(f.contentEditable, true);
  assert.equal(f.kind, 'notes');
});

/* ── 2. the crosshair sees all of them ──────────────────────────────────── */

console.log('\ndata-injector.js — the crosshair reaches every one of them');

test('PICKABLE matches a select, a radio, a tickbox, a slider and an editor', () => {
  const wanted = [
    new Field('select'),
    new Field('input', { type: 'radio' }),
    new Field('input', { type: 'checkbox' }),
    new Field('input', { type: 'range' }),
    new Field('input', { type: 'file' }),
    new Field('textarea'),
    new Field('div', { contentEditable: true }),
  ];
  for (const el of wanted) {
    assert.equal(el.matches(api.PICKABLE), true, `${el.tagName}/${el.type} is invisible to the crosshair`);
  }
});

test('PICKABLE ignores the controls that are not fields', () => {
  for (const type of ['hidden', 'submit', 'button', 'reset', 'image']) {
    assert.equal(
      new Field('input', { type }).matches(api.PICKABLE),
      false,
      `an input of type ${type} would be offered edge-case values`
    );
  }
});

test('the page outlines every pickable type while the crosshair is up', () => {
  const armed = CSS.match(/html\.uqa-injecting[\s\S]*?\{/);
  assert.ok(armed, 'nothing is outlined while the injector is armed');
  for (const token of ['select', 'contenteditable', 'textarea']) {
    assert.ok(armed[0].includes(token), `${token} is not outlined, so the tool looks as if it has nothing to offer it`);
  }
});

test('the crosshair is armed for both tools, and knows which one asked', () => {
  assert.match(SOURCE, /function armPick\(purpose = 'nasty'\)/, 'the crosshair is not shared by the two tools');
  assert.match(SOURCE, /armPick\('values'\)/, '"Design the values" never puts a crosshair up');
  assert.match(SOURCE, /armPick\('nasty'\)/, '"Try nasty values" never puts a crosshair up');
});

test('a deliberate pick beats an accidental focus', () => {
  // `fieldFor` is the order of preference, and the picked field has to come
  // first: focus is wherever the last click happened to land.
  const fn = liftSource(SOURCE, 'fieldFor');
  const picked = fn.indexOf('selected?.isConnected');
  const focused = fn.indexOf('document.activeElement');
  assert.ok(picked > -1 && focused > -1, 'fieldFor no longer consults both');
  assert.ok(picked < focused, 'the focused field is preferred over the one the tester deliberately picked');
});

/* ── 3. the reset ───────────────────────────────────────────────────────── */

console.log('\nthe reset that unmarks the selection');

test('the page carries a reset on the crosshair bar', () => {
  assert.match(SOURCE, /function clearSelection\(\)/, 'nothing unmarks the selection');
  assert.match(SOURCE, /Clear the selection/, 'the crosshair bar has no reset button');
});

test('the popup carries the same reset, on both cards', () => {
  assert.match(POPUP_HTML, /id="partitions-clear"/, '"Design the values" has no reset');
  assert.match(POPUP_HTML, /id="inject-clear"/, '"Try nasty values" has no reset');
  assert.match(POPUP_JS, /function clearPickedField\(\)/, 'the popup has no reset to wire');
  assert.match(POPUP_JS, /#inject-clear'\)\?\.addEventListener/, 'the nasty-values reset is not wired');
});

test('both sides of the reset name the same selector, and each other', () => {
  assert.match(POPUP_JS, /type:\s*'UQA_CLEAR_FIELD'/, 'the popup no longer sends UQA_CLEAR_FIELD');
  assert.match(SOURCE, /msg\?\.type === 'UQA_CLEAR_FIELD'/, 'the content script no longer handles UQA_CLEAR_FIELD');
  assert.match(DISPATCH_TABLES, /'UQA_CLEAR_FIELD'/, 'the dispatch table no longer routes UQA_CLEAR_FIELD');
});

/* ── 4. values that belong to the control ───────────────────────────────── */

console.log('\ndata-injector.js — values that belong to the control');

test('a dropdown is not offered "5000 chars"', () => {
  const f = api.inspect(new Field('select', {
    type: 'select-one',
    options: [new Option('a', 'Amman'), new Option('b', 'Irbid'), new Option('c', 'Zarqa')],
  }));
  const values = api.boundaryValues(f);
  const labels = values.map((v) => v.label);
  assert.ok(!labels.some((l) => /chars|spaces/i.test(l)), `a dropdown was offered text boundaries: ${labels.join(', ')}`);
  assert.ok(labels.some((l) => /not on the list/i.test(l)), 'the one test a mouse cannot make is missing');
  assert.ok(labels.some((l) => /Nothing chosen/i.test(l)));
});

test('a tickbox gets two states and nothing else', () => {
  const values = api.boundaryValues(api.inspect(new Field('input', { type: 'checkbox' })));
  assert.deepEqual(values.map((v) => v.label), ['Ticked', 'Unticked']);
});

test('a slider gets its own bounds, one step outside each', () => {
  const f = api.inspect(new Field('input', { type: 'range', attrs: { min: '5', max: '20', step: '5' } }));
  const values = api.boundaryValues(f);
  const byLabel = Object.fromEntries(values.map((v) => [v.label, v.value]));
  assert.equal(byLabel['Minimum (5)'], '5');
  assert.equal(byLabel['Maximum (20)'], '20');
  assert.equal(byLabel['Below the minimum'], '0');
  assert.equal(byLabel['Above the maximum'], '25');
});

test('a file field says plainly that no script can attach one', () => {
  const values = api.boundaryValues(api.inspect(new Field('input', { type: 'file', attrs: { accept: '.pdf' } })));
  assert.ok(values.some((v) => /by hand/i.test(v.note || '')), 'a file field pretends it can be filled');
});

test('a text box still gets the list it always had', () => {
  const values = api.boundaryValues(api.inspect(new Field('input', { type: 'text', attrs: { maxlength: '10' } })));
  const labels = values.map((v) => v.label);
  assert.ok(labels.includes('Exactly max (10)'));
  assert.ok(labels.some((l) => /Arabic name/.test(l)), 'the RTL group, which is the whole point of this tool, is gone');
});

/* ── 5. writing to a control that is not a text box ─────────────────────── */

console.log('\ndata-injector.js — writing a value the control actually notices');

test('a tickbox is ticked by clicking it, not by writing a string at it', () => {
  const box = new Field('input', { type: 'checkbox', checked: false });
  const out = api.setValue(box, 'true');
  assert.equal(box.checked, true, 'the box was not ticked: el.value = "true" leaves it exactly as it was');
  assert.equal(box.clicks, 1, 'a framework listening for the click never heard it');
  assert.equal(out.truncated, false);
});

test('a tickbox already in the wanted state is left alone, and still fires', () => {
  const box = new Field('input', { type: 'checkbox', checked: true });
  api.setValue(box, 'true');
  assert.equal(box.checked, true, 'the value was toggled off by asking for the state it was already in');
  assert.ok(box.events.includes('change'));
});

test('a select is chosen by value, and by the words the tester can see', () => {
  const make = () => new Field('select', {
    type: 'select-one',
    options: [new Option('amman', 'Amman'), new Option('irbid', 'Irbid')],
  });
  const byValue = make();
  api.setValue(byValue, 'irbid');
  assert.equal(byValue.value, 'irbid');
  const byLabel = make();
  api.setValue(byLabel, 'Irbid');
  assert.equal(byLabel.value, 'irbid', 'the label a tester reads is not accepted');
});

test('a select refuses a value it does not offer, and says so', () => {
  const el = new Field('select', { type: 'select-one', options: [new Option('a', 'Amman')] });
  const out = api.setValue(el, '__not_an_option__');
  assert.equal(out.rejected, true, 'the control silently accepted a value it does not have');
});

test('a file field refuses rather than reporting a fill that never happened', () => {
  const out = api.setValue(new Field('input', { type: 'file' }), 'payload.exe');
  assert.equal(out.rejected, true);
  assert.match(out.reason, /by hand/i);
});

test('a contenteditable editor is written through its text, and told about it', () => {
  const el = new Field('div', { contentEditable: true });
  api.setValue(el, 'ملاحظة');
  assert.equal(el.textContent, 'ملاحظة');
  assert.ok(el.events.includes('input'), 'a rich-text editor that hears no input event believes it is still empty');
});

/* ── 6. the partition engine agrees ─────────────────────────────────────── */

console.log('\nblackbox.js — the classes a choice actually has');

test('a dropdown gets its options, nothing chosen, and a value off the list', () => {
  const out = partitions({
    type: 'select-one',
    required: true,
    options: [{ value: 'a', label: 'Amman' }, { value: 'b', label: 'Irbid' }],
  });
  const ids = out.map((p) => p.id);
  assert.ok(ids.includes('option-0') && ids.includes('option-1'));
  assert.ok(ids.includes('off-list'), 'the class only a scripted post can reach is missing');
  assert.equal(out.find((p) => p.id === 'none').valid, false, 'a required dropdown treats "nothing chosen" as valid');
  assert.ok(!out.some((p) => /length|characters/i.test(p.label)), 'a dropdown was given length classes');
});

test('a required tickbox treats unticked as the invalid class', () => {
  const out = partitions({ type: 'checkbox', required: true });
  assert.equal(out.find((p) => p.id === 'unticked').valid, false);
  assert.equal(partitions({ type: 'checkbox' }).find((p) => p.id === 'unticked').valid, true);
});

test('a file field gets the four classes it really has', () => {
  const ids = partitions({ type: 'file', accept: '.pdf', required: true }).map((p) => p.id);
  assert.deepEqual(ids.sort(), ['accepted-type', 'none', 'oversized', 'wrong-type']);
});

test('a choice has no boundary, and is not handed length boundaries instead', () => {
  for (const type of ['select-one', 'radio', 'checkbox', 'file']) {
    assert.deepEqual(boundaries({ type }), [], `${type} was given a boundary it does not have`);
  }
  assert.ok(boundaries({ type: 'text', maxlength: 10 }).length, 'text lost its length boundary');
});

/* ── every copy the locator picker makes is filed ────────────────────────── */

/**
 * A locator on the clipboard and nothing in the report is the fault this
 * checks for. `content/picker.js` is an IIFE in a content script and cannot be
 * imported, so this reads it - the same reason the injector above is lifted.
 */
const PICKER = fs.readFileSync(path.join(EXT, 'content', 'picker.js'), 'utf8');
const EVENTS = fs.readFileSync(path.join(EXT, 'core', 'events.js'), 'utf8');

test('both ways of copying file the copy, on the note\'s own clock', () => {
  assert.equal((PICKER.match(/fileCopies\(/g) || []).length, 3,
    'declared once, called from the single click and from the basket');
  assert.ok(/fileCopies\(basket, ts\)/.test(PICKER), 'the basket copy files nothing');
  assert.ok(/fileCopies\(\[\{ el: current\.el, desc: current\.desc, intent: [^)]*\}\], ts\)/.test(PICKER),
    'a plain click files nothing');
  assert.ok(!/ts: Date\.now\(\),\n\s+frameUrl: location\.href,\n\s+text: `Picked/.test(PICKER),
    'the note and the record must share one timestamp, or the section cannot anchor into the row');
});

test('the record carries every flavour the picker had on offer, and marks the copied one', () => {
  const from = PICKER.indexOf('function fileCopies');
  const body = PICKER.slice(from, PICKER.indexOf('\n  }', from));
  for (const flavour of ["name: 'playwright'", "name: 'css'", "name: 'xpath'"]) {
    assert.ok(body.includes(flavour), `no ${flavour} in the record`);
  }
  assert.ok(/copied: true/.test(body), 'nothing marks the flavour that reached the clipboard');
  assert.ok(/desc\.alternatives/.test(body), 'the alternatives the tooltip offered are dropped');
});

test('a covered element never puts its words in the report', () => {
  const from = PICKER.indexOf('function fileCopies');
  const body = PICKER.slice(from, PICKER.indexOf('\n  }', from));
  assert.ok(/leaks\(String\(expr\)\)/.test(body),
    'a flavour built out of covered words is offered to the report');
  assert.ok(/masked \? \(M\?\.placeholder\?\.\(\) \|\| ''\)/.test(body),
    'a covered element files its own text');
});

test('the store only accepts the fields the record is made of', () => {
  const from = EVENTS.indexOf('selectorcopy: [');
  assert.ok(from > 0, 'the allow-list does not know the kind, so every copy is dropped silently');
  const list = EVENTS.slice(from, EVENTS.indexOf(']', from));
  for (const field of ['copied', 'flavours', 'tag', 'elementId', 'classes', 'text', 'previewNote',
    'preview', 'previewW', 'previewH']) {
    assert.ok(list.includes(`'${field}'`), `${field} is stripped on the way into the store`);
  }
});

/**
 * The picture of the element, and the one thing about it that must not drift.
 *
 * The worker's boot graph is re-parsed on every cold start and has under a
 * kilobyte of headroom against the ceiling in `tools/test-worker-imports.mjs`,
 * so the crop lives in the page and the worker's whole share is one call it is
 * the only context allowed to make. If a later hand moves the canvas work back
 * into the worker, that suite goes red — but only after the fact and only if
 * the bytes happen to tip it over, so this one says it out loud here.
 */
const WORKER = workerSrc();
const UI_HOST = fs.readFileSync(path.join(EXT, 'content', 'ui-host.js'), 'utf8');

test('the crop is cut in the page; the worker only takes the photograph', () => {
  assert.ok(/UQA_SHOT_URL: \(msg, sender\) =>/.test(WORKER), 'no relay for the photograph');
  assert.ok(/sender\?\.tab\?\.active/.test(WORKER),
    'captureVisibleTab photographs whatever is on screen: a background tab would be ' +
    'handed a picture of somebody else\'s page');
  assert.ok(/withoutOverlays\(sender\.tab\.id/.test(WORKER),
    'the extension\'s own highlight and toast would be in the crop');
  const relay = WORKER.slice(WORKER.indexOf('UQA_SHOT_URL'), WORKER.indexOf('UQA_SHOT_URL') + 400);
  assert.ok(!/canvas|createImageBitmap|drawImage/.test(relay), 'the crop belongs in the page');
  assert.ok(/createImageBitmap/.test(PICKER) && /toDataURL\('image\/jpeg'/.test(PICKER),
    'the page does not crop anything');
});

test('one photograph per basket, bounded, and never from a frame', () => {
  const from = PICKER.indexOf('async function previews');
  assert.ok(from > 0, 'no preview step');
  const body = PICKER.slice(from, PICKER.indexOf('\n  }', from));
  assert.equal((body.match(/UQA_SHOT_URL/g) || []).length, 1,
    'captureVisibleTab is rate-limited: one capture for the whole basket, not one per element');
  assert.ok(/window\.top !== window/.test(body),
    'a child frame measures its rectangles against its own origin, not the tab\'s');
  assert.ok(/startsWith\('data:image\/'\)/.test(body), 'the answer is trusted unchecked');
  assert.ok(/MAX_PREVIEW = 40 \* 1024/.test(PICKER), 'nothing bounds the size of a preview');
  assert.ok(/url\.length <= MAX_PREVIEW/.test(PICKER), 'the bound is declared and not applied');
  assert.ok(/PREVIEW_W = 240/.test(PICKER) && /PREVIEW_H = 160/.test(PICKER),
    'a full-size crop on the event, not a thumbnail');
  assert.ok(/rect: onScreen \? r : null/.test(PICKER),
    'an element off the screen must keep the outline rather than crop whatever is in its place');
});

test('the right-click copy describes its element, like the picker\'s does', () => {
  const from = UI_HOST.indexOf('function describeContextTarget');
  const body = UI_HOST.slice(from, UI_HOST.indexOf('\n  }', from));
  for (const field of ['tag:', 'elementId:', 'classes:', 'role:', 'text:', 'rect:']) {
    assert.ok(body.includes(field), `the menu path still answers without ${field}`);
  }
  assert.ok(/M\?\.isMasked\?\.\(el\) \? \(M\.placeholder\?\.\(\) \|\| ''\)/.test(body),
    'a covered element files its own words through the menu');
  assert.equal((body.match(/\.\.\.about,/g) || []).length, 2,
    'the masked answer and the plain one must both carry the description');
  assert.ok(/sendWithPreviews\(\[\{/.test(PICKER), 'the menu row gets no picture');
});

test('an assert pick carries the outcome, and a plain one does not', () => {
  assert.match(PICKER, /const assertPick = e\.shiftKey && \(e\.ctrlKey \|\| e\.metaKey\)/,
    'Ctrl+Shift+click is not the assert pick any more');
  assert.match(PICKER, /if \(e\.shiftKey && !assertPick\)/,
    'the basket branch swallows the assert pick before it is filed');
  assert.match(PICKER, /ev\.expected = \{/, 'an assert pick files no expected outcome');
  // The same gate every other page-derived string here passes through.
  assert.match(PICKER, /expected = \{[^}]*text: masked \? \(M\?\.placeholder\?\.\(\) \|\| ''\)/s,
    'an assert pick on a covered element would file its words');
  assert.match(EVENTS, /'credRef', 'intent', 'expected'/,
    'the store drops intent and expected on the floor');
  // S8: the shortcut hint moved off the basket counter into the in-page bar's
  // purpose tooltip (overlay.chip.hint, DESIGN-SPEC §5.5).
  const BAR = fs.readFileSync(path.join(EXT, 'content', 'bar.js'), 'utf8');
  assert.match(BAR, /Ctrl\+Shift\+click marks something to check/,
    'the picking bar does not say the modifier exists, so nobody will find it');
});

test('a pick says what it is for, and a sensitive one keeps its words to itself', () => {
  // Four purposes, named once, and the event carries the one in force.
  // S8: the ids stay here; their labels and hints are `overlay.purpose.*` strings.
  assert.ok(PICKER.includes("const PURPOSES = ['any', 'step', 'element', 'sensitive'];"), 'a purpose is gone from PURPOSES');
  assert.ok(PICKER.includes("purpose: isPurpose(why) ? why : 'any',"), 'the event does not say what the pick was for');
  assert.ok(EVENTS.includes("'purpose'"), 'the store drops the purpose on the floor');
  assert.ok(EVENTS.includes("'purpose', 'label'"), 'the store drops the label on the floor');

  // Sensitive is treated as covered: text, flavours and the photograph.
  assert.ok(PICKER.includes("const masked = !!M?.isMasked?.(el) || sensitive;"),
    'a sensitive pick files its own words as text');
  assert.ok(PICKER.includes('!(own && String(expr).includes(own))'),
    'a flavour built out of a sensitive value is still filed');
  assert.ok(PICKER.includes('rect: onScreen && !sensitive ? r : null,'),
    'a sensitive value is photographed for the report');
  assert.ok(PICKER.includes("purpose === 'sensitive' ? ownText(el) : ''"),
    'the clipboard still gets a locator built out of the sensitive value');

  // An element pick is a check, so it carries the state it was in.
  assert.ok(PICKER.includes("if (intent === 'assert' || why === 'element')"),
    'an element to account for files no expected outcome');

  // One rule for every purpose: a plain click copies one and stops, and only
  // Shift+click collects. The basket entry remembers what it was picked for.
  assert.ok(!PICKER.includes("if (purpose === 'any')"), 'a purpose changes how the tool is driven again');
  assert.ok(PICKER.includes('entry = { el: current.el, desc: current.desc, purpose };'),
    'a Shift+click pick forgets what it was picked for');

  // A purpose arriving on a running picker switches it; it must not toggle it off.
  assert.ok(PICKER.includes('else if (isPurpose(msg.purpose))'), 'choosing a purpose mid-walk closes the crosshair');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
