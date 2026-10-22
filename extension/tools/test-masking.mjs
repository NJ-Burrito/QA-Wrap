/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Masking, on a DOM.
 *
 * Same technique as `test-graphql.mjs` and `test-rules.mjs`: the functions are
 * lifted out of `content/mask.js` **by name** and rebuilt here, because that
 * file is an IIFE that runs in a page and cannot be imported. The lift fails
 * loudly if anything is renamed, which is the only thing keeping this from
 * testing a copy that has quietly diverged from the shipped code.
 *
 * There is no jsdom in this tree and there is not going to be one for four
 * functions, so the DOM is a small honest stub at the bottom of this file: the
 * ten or so calls the lifted code actually makes, and nothing else. Its
 * `querySelectorAll` understands a comma-separated list of tag names and
 * attribute presence or value, which is exactly what `GRID` and `CELLS`
 * are made of; anything else it is asked for is a registered path, which the
 * tests control, so a fake selector engine cannot flatter the code under test.
 *
 * What these tests are actually about, in Nader's words: "some elements fail to
 * mask; a table or sheet masks as a whole, not per cell". Both were true. The
 * first group below is the picture failing to be painted at all on a replaced
 * element; the second is one click covering the same cell in every table on the
 * page; the third is the locator picker putting a covered name on the clipboard,
 * which is the same leak leaving by a different door.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift as liftSource } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'content', 'mask.js'), 'utf8');
const PICKER = fs.readFileSync(path.join(HERE, '..', 'content', 'picker.js'), 'utf8');
const CSS = fs.readFileSync(path.join(HERE, '..', 'content', 'overlay.css'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const lift = (name) => liftSource(SOURCE, name);

/**
 * A `const NAME = …;` taken out of the source, by name.
 *
 * The four sets and selectors the lifted functions close over are declarations
 * too, and copying them here would be exactly the drift this whole file exists
 * to prevent: `GRID` gaining `[role="treegrid"]` in the shipped file and not
 * here would leave the test green about a case the product no longer handles.
 */
function constOf(source, name) {
  const at = source.indexOf(`const ${name} = `);
  if (at === -1) throw new Error(`content/mask.js no longer declares ${name} — this test is out of date, not wrong`);
  // `;\n` is not the end of a line in this repository: the working tree is
  // CRLF, and matching the wrong newline silently returned an empty string for
  // every one of these, which showed up as "REPLACED is not defined" fifteen
  // tests later rather than as a bad lift here.
  const rest = source.slice(at);
  const end = rest.search(/;\r?\n/);
  if (end === -1) throw new Error(`the declaration of ${name} does not end on its own line`);
  return rest.slice(0, end + 1);
}

/* ── the smallest DOM these functions can be honest against ─────────────── */

/** One selector, compiled: `tag`, `[attr]`, `[attr="value"]`, `*`, or a list of those. */
function matcher(selector) {
  const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const tests = parts.map((part) => {
    const attr = part.match(/^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/);
    if (attr) {
      const [, key, value] = attr;
      return (el) => (value === undefined ? el.hasAttribute(key) : el.getAttribute(key) === value);
    }
    if (part === '*') return () => true;
    const tag = part.toUpperCase();
    return (el) => el.tagName === tag;
  });
  return (el) => tests.some((t) => t(el));
}

class El {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.attrs = new Map();
    this.children = [];
    this.parentElement = null;
    this.own = opts.text || '';
    this.display = opts.display || 'block';
    this.box = opts.box || { width: 120, height: 20 };
    this.path = opts.path || null;
    for (const [k, v] of Object.entries(opts.attrs || {})) this.attrs.set(k, v);
  }

  get id() { return this.attrs.get('id') || ''; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  getBoundingClientRect() { return { width: this.box.width, height: this.box.height, left: 0, top: 0 }; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }

  append(...kids) {
    for (const kid of kids) { kid.parentElement = this; this.children.push(kid); }
    return this;
  }

  matches(selector) { return matcher(selector)(this); }

  querySelectorAll(selector) {
    const hit = matcher(selector);
    const out = [];
    const walk = (node) => {
      for (const kid of node.children) { if (hit(kid)) out.push(kid); walk(kid); }
    };
    walk(this);
    return out;
  }

  closest(selector) {
    const hit = matcher(selector);
    for (let n = this; n; n = n.parentElement) if (hit(n)) return n;
    return null;
  }
}

/** The document: a root element, plus the paths the test has registered. */
function makeDocument(root) {
  const paths = new Map();
  return {
    documentElement: root,
    /** Register `path` as resolving to these elements, in this order. */
    register(pathText, list) { paths.set(pathText, list); },
    querySelectorAll(selector) {
      if (paths.has(selector)) return paths.get(selector);
      return root.querySelectorAll(selector);
    },
  };
}

/**
 * The lifted masking functions, over one document.
 *
 * Everything the shipped code closes over is passed in rather than redefined:
 * the selector engine (`S`), whether a node is one of ours, the mask list and
 * the dismissed set. `masks` is a parameter because `remove()` reassigns it.
 */
const buildMask = new Function(
  'doc',
  'styles',
  'S',
  'isOursRef',
  'startMasks',
  'dismissedRef',
  `const document = doc;
   const getComputedStyle = (el) => ({ display: el.display || 'block' });
   const isOurs = isOursRef;
   const asleep = () => false; // awake: the sleep guard is pinned in test-sleep-stop
   let masks = startMasks;
   const dismissed = dismissedRef;
   const newId = () => 'm' + (newId.n = (newId.n || 0) + 1);
   ${constOf(SOURCE, 'REPLACED')}
   ${constOf(SOURCE, 'FIELD')}
   ${constOf(SOURCE, 'GRID')}
   ${constOf(SOURCE, 'CELLS')}
   const location = { origin: 'https://staging.example.com', pathname: '/patients' };
   ${lift('coverable')}
   ${lift('targets')}
   ${lift('paint')}
   ${lift('unpaint')}
   ${lift('pathFor')}
   ${lift('accName')}
   ${lift('apply')}
   ${lift('add')}
   ${lift('remove')}
   ${lift('leaksMaskedText')}
   return {
     coverable, targets, paint, unpaint, pathFor, accName, apply, add, remove,
     leaksMaskedText,
     masks: () => masks,
   };`
);

const engine = (root, { isOurs = () => false, masks = [], dismissed = new Set(), cssPath } = {}) => {
  const doc = makeDocument(root);
  const S = { cssPath: cssPath || ((el) => el.path || el.tagName.toLowerCase()) };
  return { api: buildMask(doc, null, S, isOurs, masks, dismissed), doc };
};

/* ── 1. the elements that failed to mask ────────────────────────────────── */

console.log('mask.js — the elements that used to fail silently');

test('a picture is marked as media, because ::after never renders on one', () => {
  const root = new El('html');
  const img = new El('img');
  root.append(img);
  const { api } = engine(root);
  api.paint(img);
  assert.equal(img.hasAttribute('data-uqa-masked'), true);
  assert.equal(
    img.hasAttribute('data-uqa-masked-media'),
    true,
    'an <img> carries no ::after, so without this attribute the mask painted nothing at all'
  );
});

test('the stylesheet actually paints that attribute over the content', () => {
  // The attribute is only half the fix; the rule that covers the pixels is the
  // other half, and it lives in a file this test would otherwise never read.
  // Anchored at a line start: the generated token block also names this selector (S8).
  const rule = CSS.match(/^\[data-uqa-masked-media\] \{([^}]*)\}/m);
  assert.ok(rule, 'overlay.css has no rule for [data-uqa-masked-media]');
  assert.match(rule[1], /filter:\s*brightness\(0\)/, 'the media mask does not map the picture to ink');
  // S8: the ink is the page-scope token the generated region declares on these
  // very selectors, so it resolves on the masked element itself.
  assert.match(rule[1], /background:\s*var\(--uqa-brand-basalt\)\s*!important/, 'a transparent PNG would still show its shape through the filter');
  const scope = CSS.match(/\.uqa-injecting, \[data-uqa-masked\], \[data-uqa-masked-media\], \[data-uqa-masked-field\] \{([^}]*)\}/);
  assert.ok(scope, 'the masked elements no longer carry their own ink token');
  assert.match(scope[1], /--uqa-brand-basalt:\s*#1D2024;/, 'the media mask ink is not the opaque basalt it was');
});

test('a field keeps the field paint, not the media paint', () => {
  const root = new El('html');
  const input = new El('input');
  root.append(input);
  const { api } = engine(root);
  api.paint(input);
  assert.equal(input.hasAttribute('data-uqa-masked-field'), true);
  assert.equal(input.hasAttribute('data-uqa-masked-media'), false, 'an input would get the filter twice');
});

test('display:contents is resolved up to something that has a box', () => {
  // The element the tester clicked generates no box at all, so a block
  // positioned against it is a block positioned against nothing: the attribute
  // is set, the mask is invisible, and the tester is told it is covered.
  const root = new El('html');
  const outer = new El('section', { box: { width: 300, height: 60 } });
  const wrapper = new El('div', { display: 'contents', box: { width: 0, height: 0 } });
  const cell = new El('span', { text: 'Ahmad', box: { width: 80, height: 18 } });
  root.append(outer);
  outer.append(wrapper);
  wrapper.append(cell);
  const { api } = engine(root);
  assert.equal(api.coverable(wrapper), outer, 'a display:contents element cannot carry the block');
  assert.equal(api.coverable(cell), cell, 'and its child, which does have a box, is left alone');
});

test('a zero-sized element is resolved up to its nearest ancestor with a box', () => {
  const root = new El('html');
  const outer = new El('div', { box: { width: 200, height: 40 } });
  const empty = new El('span', { box: { width: 0, height: 0 } });
  root.append(outer);
  outer.append(empty);
  const { api } = engine(root);
  assert.equal(api.coverable(empty), outer, 'covering a box of no size covers nothing');
});

test('a replaced element is chosen even when it measures zero', () => {
  // An image that has not loaded yet is 0×0 and is still the thing to cover.
  const root = new El('html');
  const outer = new El('div', { box: { width: 200, height: 40 } });
  const img = new El('img', { box: { width: 0, height: 0 } });
  root.append(outer);
  outer.append(img);
  const { api } = engine(root);
  assert.equal(api.coverable(img), img);
});

/* ── 2. a table masks per cell ──────────────────────────────────────────── */

console.log('\nmask.js — a table masks per cell, not as a whole');

function sheet() {
  const root = new El('html');
  const table = new El('table');
  const body = new El('tbody');
  const row1 = new El('tr');
  const row2 = new El('tr');
  const cells = [
    new El('td', { text: 'Ahmad Al Zaghloul', path: 'td.name' }),
    new El('td', { text: '9881234567', path: 'td.id' }),
    new El('td', { text: 'Fatima Odeh', path: 'td.name' }),
    new El('td', { text: '9987654321', path: 'td.id' }),
  ];
  row1.append(cells[0], cells[1]);
  row2.append(cells[2], cells[3]);
  body.append(row1, row2);
  table.append(body);
  root.append(table);
  return { root, table, row1, cells };
}

test('picking one cell picks one cell', () => {
  const { root, cells } = sheet();
  const { api } = engine(root);
  assert.deepEqual(api.targets(cells[0]), [cells[0]]);
});

test('picking the table masks every cell separately, one block each', () => {
  const { root, table, cells } = sheet();
  const { api } = engine(root);
  const picked = api.targets(table);
  assert.deepEqual(picked, cells, 'the table was covered as one block instead of cell by cell');
});

test('picking a row masks that row’s cells and not the whole table', () => {
  const { root, row1, cells } = sheet();
  const { api } = engine(root);
  assert.deepEqual(api.targets(row1), [cells[0], cells[1]]);
});

test('a sheet built from divs with grid roles behaves the same way', () => {
  const root = new El('html');
  const grid = new El('div', { attrs: { role: 'grid' } });
  const a = new El('div', { attrs: { role: 'gridcell' }, text: 'A' });
  const b = new El('div', { attrs: { role: 'gridcell' }, text: 'B' });
  grid.append(a, b);
  root.append(grid);
  const { api } = engine(root);
  assert.deepEqual(api.targets(grid), [a, b]);
});

test('a container with no cells in it is just an element', () => {
  const root = new El('html');
  const table = new El('table', { text: 'nothing structured here' });
  root.append(table);
  const { api } = engine(root);
  assert.deepEqual(api.targets(table), [table]);
});

test('one cell’s path matching four cells masks one of them, not four', () => {
  /*
   * The bug in one assertion.
   *
   * `cssPath()` walks six ancestors at most, so a cell's path is a *suffix*
   * and matches the same cell in every table on the page. `apply()` painted
   * every match. One click therefore covered a column, and the tester who
   * masked one salary saw four go dark and reasonably concluded the tool was
   * broken.
   */
  const { root, cells } = sheet();
  const { api, doc } = engine(root);
  doc.register('td.name', [cells[0], cells[2]]);
  doc.register('td.id', [cells[1], cells[3]]);

  const entry = api.add(cells[2]);
  assert.equal(entry.path, 'td.name');
  assert.equal(entry.index, 1, 'the index of the picked cell among its path’s matches was not recorded');

  // Everything unpainted, then re-applied from the stored list alone.
  for (const c of cells) api.unpaint(c);
  api.apply();
  assert.equal(cells[2].hasAttribute('data-uqa-masked'), true, 'the masked cell did not come back');
  assert.equal(cells[0].hasAttribute('data-uqa-masked'), false, 'somebody else’s row was masked too');
});

test('the accessible-name fallback covers one element, of the tag that was picked', () => {
  /*
   * The other half of the same bug. When the path no longer matches, the name
   * is the second key, and it used to sweep `input, textarea, select, td, th,
   * span, div, p, li` and paint **every** element whose text was equal. On a
   * sheet that is the cell, the wrapper inside it, the row's own text and any
   * div that happens to hold the same string.
   */
  const root = new El('html');
  const wrapper = new El('div');
  const cell = new El('td', { text: 'Ahmad Al Zaghloul' });
  const elsewhere = new El('div', { text: 'Ahmad Al Zaghloul' });
  wrapper.append(cell);
  root.append(wrapper, elsewhere);
  const { api } = engine(root, {
    masks: [{ id: 'm1', path: 'td.gone', index: 0, name: 'Ahmad Al Zaghloul', tag: 'td' }],
  });
  api.apply();
  assert.equal(cell.hasAttribute('data-uqa-masked'), true);
  assert.equal(elsewhere.hasAttribute('data-uqa-masked'), false, 'a div with the same words was masked as well');
});

/* ── 3. taking one back, and the per-tab reset ──────────────────────────── */

console.log('\nmask.js — uncovering one thing, and uncovering this page');

test('uncovering one cell leaves the others covered', () => {
  const { root, cells } = sheet();
  const { api, doc } = engine(root);
  doc.register('td.name', [cells[0], cells[2]]);
  doc.register('td.id', [cells[1], cells[3]]);
  for (const c of cells) api.add(c);
  assert.equal(api.masks().length, 4);

  const gone = api.remove(cells[2]);
  assert.equal(gone.length, 1, 'removing by path took every entry that shared the path');
  assert.equal(api.masks().length, 3);
  assert.equal(cells[2].hasAttribute('data-uqa-masked'), false);
  assert.equal(cells[0].hasAttribute('data-uqa-masked'), true, 'the rest of the column was uncovered too');
});

test('uncovering a row takes the cells nested inside it with it', () => {
  const { root, row1, cells } = sheet();
  const { api } = engine(root);
  api.add(cells[0]);
  api.add(cells[1]);
  const gone = api.remove(row1);
  assert.equal(gone.length, 2, 'a half-redacted row is worse than either state');
  assert.equal(cells[0].hasAttribute('data-uqa-masked'), false);
  assert.equal(cells[1].hasAttribute('data-uqa-masked'), false);
});

test('a dismissed mask is not re-applied on this page, and is still in the session', () => {
  const { root, cells } = sheet();
  const dismissed = new Set(['m1']);
  const { api, doc } = engine(root, {
    masks: [{ id: 'm1', path: 'td.name', index: 0, name: 'Ahmad Al Zaghloul', tag: 'td' }],
    dismissed,
  });
  doc.register('td.name', [cells[0]]);
  api.apply();
  assert.equal(cells[0].hasAttribute('data-uqa-masked'), false, 'the per-tab reset did not hold');
  assert.equal(api.masks().length, 1, 'the session lost the mask, so the other tabs lost it too');
});

test('the reset is on the page, where the tester is standing', () => {
  // It cannot be a message: the mask list belongs to the session and is
  // deliberately browser-wide, so a reset that cleared it would clear it
  // everywhere. See the comment on `resetThisPage`.
  assert.match(SOURCE, /function resetThisPage\(\)/, 'the per-tab reset is gone');
  assert.match(SOURCE, /Uncover all on this page/, 'the reset has no control on the picking bar');
  assert.doesNotMatch(
    SOURCE.match(/function resetThisPage[\s\S]*?\n  \}/)[0],
    /UQA_MASK_SET|UQA_MASK_CLEAR/,
    'the per-tab reset writes the session list, which makes it browser-wide again'
  );
});

/* ── 3b. the picking bar, and the click it must not eat ─────────────────── */

console.log('\nmask.js — the bar takes its own clicks, and nothing else does');

/**
 * The layers `mount()` draws, as small as they can honestly be.
 *
 * `pointerEvents` starts at `'auto'` because that is what `uiLayer()` in
 * `content/ui-host.js` sets **inline** on every layer it hands out, and an
 * inline declaration beats the `pointer-events: none` the box carries in
 * `overlay.css`. A stub that started it empty would make the regression below
 * impossible to reproduce, which is the only way these two tests could lie.
 */
class Layer {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.style = { pointerEvents: 'auto' };
    this.kids = [];
    this.listeners = [];
    this.own = '';
  }
  set textContent(v) { this.own = String(v); }
  get textContent() { return this.own; }
  addEventListener(...args) { this.listeners.push(args); }
  append(...kids) { this.kids.push(...kids); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 40 }; }
}

const HOST = { tagName: 'QAW-UI' };

const buildBar = new Function(
  'doc',
  'win',
  `const document = doc;
   const window = win;
   const t = (key, fallback) => fallback;
   let box = null;
   let tip = null;
   const resetThisPage = () => {};
   ${lift('mount')}
   ${lift('onOurBar')}
   return { mount, onOurBar, layers: () => ({ box, tip }) };`
);

const mountedBar = () => {
  const doc = { createElement: (tag) => new Layer(tag) };
  const win = {
    UQAUiHost: {
      isOurs: (n) => n === HOST,
      uiLayer(className) {
        const layer = new Layer('div');
        layer.className = className;
        layer.style.pointerEvents = 'auto'; // exactly what content/ui-host.js does
        return layer;
      },
    },
  };
  const api = buildBar(doc, win);
  api.mount();
  return { api, ...api.layers() };
};

test('the highlight box is inert, whatever uiLayer set on it inline', () => {
  const { box, tip } = mountedBar();
  assert.equal(
    box.style.pointerEvents,
    'none',
    'the box follows the pointer and sits exactly over the element under it, so with events on it is what every click lands on'
  );
  assert.equal(tip.style.pointerEvents, 'auto', 'the bar carries a button, which has to stay pressable');
});

test('the guard is the bar itself, not everything of ours', () => {
  const { api, tip } = mountedBar();
  const reset = tip.kids[tip.kids.length - 1];
  assert.equal(reset.className, 'uqa-mask-reset', 'the bar no longer carries the reset button');

  // The root is CLOSED: a document listener sees the host as the target and a composedPath that
  // stops at the host, so the old `path.includes(tip)` answered false for the bar's own button.
  assert.equal(
    api.onOurBar({ target: HOST, composedPath: () => [HOST, {}, {}], clientX: 10, clientY: 10 }),
    true,
    'a press on the bar’s own button must not also be a press on the page under it'
  );
  // The regression: the guard asked `isOurs(e.target)` alone, and the highlight box is the host too —
  // every pick returned before it masked anything. The pointer must be inside the bar's box.
  assert.equal(
    api.onOurBar({ target: HOST, composedPath: () => [HOST, {}, {}], clientX: 500, clientY: 300 }),
    false,
    'the highlight box counted as the bar, so no pick ever reached the page'
  );
  assert.equal(
    api.onOurBar({ target: { tagName: 'INPUT' }, composedPath: () => [{ tagName: 'INPUT' }, {}], clientX: 10, clientY: 10 }),
    false,
    'an ordinary page element is not the bar'
  );
});

/* ── 4. the fourth door: a locator built out of covered words ───────────── */

console.log('\nmask.js and picker.js — a covered name does not reach the clipboard');

test('leaks() sees the covered text inside a locator', () => {
  const root = new El('html');
  const cell = new El('td', { text: 'Ahmad Al Zaghloul', attrs: { 'data-uqa-masked': '' } });
  root.append(cell);
  const { api } = engine(root);
  assert.equal(api.leaksMaskedText("getByText('Ahmad Al Zaghloul')"), true);
  assert.equal(api.leaksMaskedText("getByRole('cell')"), false);
});

test('leaks() ignores a covered value too short to be a name', () => {
  const root = new El('html');
  root.append(new El('td', { text: '7', attrs: { 'data-uqa-masked': '' } }));
  const { api } = engine(root);
  assert.equal(
    api.leaksMaskedText("getByRole('row', { name: '7 items' })"),
    false,
    'a masked cell reading "7" would refuse every locator with a seven in it'
  );
});

test('the picker offers a clean alternative before it refuses', () => {
  const build = new Function(
    'maskRef',
    `const window = { UQAMask: maskRef };
     ${liftSource(PICKER, 'withoutMaskedText')}
     return withoutMaskedText;`
  );
  const withoutMaskedText = build({
    isMasked: () => true,
    leaks: (text) => String(text).includes('Ahmad'),
  });
  const desc = {
    playwright: "page.getByText('Ahmad Al Zaghloul')",
    locator: "getByText('Ahmad Al Zaghloul')",
    strategy: 'text',
    alternatives: [
      { expr: "page.getByText('Ahmad')", strategy: 'text', matches: 1, unique: true },
      { expr: 'page.locator("#row-4 td:nth-of-type(2)")', strategy: 'css', matches: 1, unique: true },
    ],
  };
  const out = withoutMaskedText({}, desc);
  assert.equal(out.blocked, undefined, 'a usable alternative existed and was refused anyway');
  assert.equal(out.playwright, 'page.locator("#row-4 td:nth-of-type(2)")');
  assert.equal(out.maskedSource, true, 'the substitution is not stated, so nobody knows why the locator changed');
});

test('the picker refuses when every candidate carries the covered words', () => {
  const build = new Function(
    'maskRef',
    `const window = { UQAMask: maskRef };
     ${liftSource(PICKER, 'withoutMaskedText')}
     return withoutMaskedText;`
  );
  const withoutMaskedText = build({ isMasked: () => true, leaks: () => true });
  const out = withoutMaskedText({}, {
    playwright: "page.getByText('Ahmad')",
    alternatives: [{ expr: "page.getByLabel('Ahmad')", strategy: 'label', matches: 1, unique: true }],
  });
  assert.equal(out.blocked, true, 'a covered name was handed to the clipboard');
});

test('an unmasked element is handed back exactly as the engine described it', () => {
  const build = new Function(
    'maskRef',
    `const window = { UQAMask: maskRef };
     ${liftSource(PICKER, 'withoutMaskedText')}
     return withoutMaskedText;`
  );
  const withoutMaskedText = build({ isMasked: () => false, leaks: () => false });
  const desc = { playwright: "page.getByRole('button')", alternatives: [] };
  assert.equal(withoutMaskedText({}, desc), desc, 'the ordinary path grew a copy, which is a place to lose a field');
});

test('the click path refuses rather than copying, and the right-click menu does too', () => {
  assert.match(PICKER, /if \(current\.desc\.blocked\)/, 'the picker copies a blocked locator anyway');
  const host = fs.readFileSync(path.join(HERE, '..', 'content', 'ui-host.js'), 'utf8');
  assert.match(host, /UQAMask/, 'the right-click menu never asks whether the element is masked');
  assert.match(host, /covered by the masking tool/, 'the right-click menu has no refusal to give');
});

/* ── what survives the session ────────────────────────────────── */

const WORKER = workerSrc();

test('only page, tag and time are persisted — never the hidden words', () => {
  const make = new Function(`${liftSource(WORKER, 'redactedMaskList')} return redactedMaskList;`);
  const redactedMaskList = make();
  const out = redactedMaskList([{
    id: 'm1', path: '#patient-layla-haddad > td:nth-of-type(3)', index: 0,
    name: 'Layla Haddad', tag: 'td', at: 1700000000000,
    page: 'https://staging.example.com/patients',
  }]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['at', 'page', 'tag'],
    'a field crossed the line into permanent storage — argue for it in writing first');
  const blob = JSON.stringify(out);
  assert.ok(!blob.includes('Layla'), 'the masked text was persisted');
  assert.ok(!blob.includes('patient-layla'), 'the CSS path was persisted, and a path carries names');
});

test('the session record is written from the redacted list, not the raw one', () => {
  assert.match(WORKER, /const maskEntries = redactedMaskList\(/,
    'the mask list reaches the session record without passing through the redactor');
  assert.match(WORKER, /session\.maskList = maskEntries;/, 'the session record carries no mask list');
});

test('four purposes: the pick is two rings in var(--uqa-p-*), each declared on :host, no blur', () => {
  // Decision 132's bug was a token declared on the tip and read on the box, so
  // the whole shadow was the guaranteed-invalid value and three of four
  // purposes drew nothing. The tokens now live on `:host` (generated), so every
  // layer inherits them; what this pins is that each purpose's colour is one
  // of those tokens and that the ring is crisp — spread only, no blur radius,
  // which is what a glow is (UI rework round 2, S8; DESIGN-SPEC §5.5).
  const host = CSS.match(/:host \{([^}]*)\}/);
  assert.ok(host, 'overlay.css declares no tokens on :host');
  for (const id of ['any', 'step', 'element', 'sensitive']) {
    const rule = CSS.match(new RegExp(`\\[data-purpose="${id}"\\] \\{([^}]*)\\}`));
    assert.ok(rule, `the purpose ${id} has no colour of its own`);
    const token = rule[1].match(/--p:\s*var\((--uqa-p-[a-z]+)\)/);
    assert.ok(token, `the purpose ${id} does not read a --uqa-p-* token`);
    assert.match(host[1], new RegExp(`${token[1]}:\\s*#[0-9A-Fa-f]{6};`), `${token[1]} is not declared on :host`);
  }
  const rings = CSS.split('}').filter((r) => /\.uqa-ring(\.is-locked::after)?\s*\{/.test(r) && r.includes('box-shadow'));
  assert.ok(rings.length >= 2, 'the hover ring and the locked outer pair are not both drawn');
  for (const r of rings) {
    const shadow = r.slice(r.indexOf('box-shadow:')).split(';')[0];
    assert.match(shadow, /0 0 0 2px var\(--uqa-ring-halo\), 0 0 0 4px var\(--p, var\(--uqa-p-any\)\)/, 'the ring is not halo + purpose colour');
    const flat = shadow.replace(/^box-shadow:/, '').replace(/var\((?:[^()]|\([^()]*\))*\)/g, 'C');
    for (const layer of flat.split(',')) {
      assert.match(layer.trim(), /^0 0 0 \d+px /, `a ring layer has a blur radius, which is a glow: ${layer.trim()}`);
    }
  }
  const ring = CSS.match(/\.uqa-ring \{([^}]*)\}/);
  assert.match(ring[1], /background:\s*none/, 'the ring box tints the element it points at');
});

/* r4-08-4: previewOf lost its backslashes (`/^s+/`) and replaced spaces with a literal NUL, so 'safe' previewed as '·afe'. */
const INJECTOR = fs.readFileSync(path.join(HERE, '..', 'content', 'data-injector.js'), 'utf8');
test('data-injector.js holds no NUL byte (a literal one was a regex)', () => {
  assert.ok(!INJECTOR.includes(String.fromCharCode(0)), 'content/data-injector.js contains a NUL byte');
});
test('previewOf shows edge spaces as dots and leaves other letters alone', () => {
  const previewOf = new Function(`${liftSource(INJECTOR, 'previewOf')}; return previewOf;`)();
  assert.equal(previewOf('safe'), 'safe');
  assert.equal(previewOf(''), '(empty)');
  assert.equal(previewOf('  a  '), '··a··');
  assert.equal(previewOf('   '), '··· (3 spaces)');
  assert.equal(previewOf('a b'), 'a·b');
  assert.equal(previewOf('\tx'), '·x');
});

/* r4-03-3 / D-1010-83: a maskExtraPattern that does not compile masks every text input instead of none. */
const RECORDER = fs.readFileSync(path.join(HERE, '..', 'content', 'recorder.js'), 'utf8');
function recorderMasker(maskExtraPattern) {
  const warns = [];
  const win = { UQASettings: { maskExtraPattern } };
  const body = `let extraSource = null; let extraRe = null; let extraBroken = false;
    const SECRET_TYPES = new Set(['password']); const isSecretName = (n) => /password/i.test(n);
    ${liftSource(RECORDER, 'extraPattern')}
    ${liftSource(RECORDER, 'isSecret')}
    return isSecret;`;
  const isSecret = new Function('window', 'console', body)(win, { warn: (m) => warns.push(m) });
  return { isSecret, warns, win };
}
const field = (type, name = 'q') => ({ tagName: 'INPUT', type, name, id: '', autocomplete: '', getAttribute: () => '' });
test('a pattern with an unclosed ( fails closed: every text input is masked, with one warning', () => {
  const m = recorderMasker('(');
  assert.equal(m.isSecret(field('text')), true);
  assert.equal(m.isSecret({ tagName: 'TEXTAREA', name: 'notes', id: '', getAttribute: () => '' }), true);
  assert.equal(m.isSecret(field('email')), true);
  assert.equal(m.isSecret(field('checkbox')), false, 'a checkbox holds no typed text');
  assert.equal(m.warns.length, 1, 'one console.warn, not one per field');
});
test('a pattern that compiles masks only what it matches, and fixing a broken one releases the fields', () => {
  const ok = recorderMasker('iban');
  assert.equal(ok.isSecret(field('text', 'iban')), true);
  assert.equal(ok.isSecret(field('text', 'city')), false);
  assert.equal(ok.warns.length, 0);
  const m = recorderMasker('(');
  assert.equal(m.isSecret(field('text', 'city')), true);
  m.win.UQASettings.maskExtraPattern = 'iban';
  assert.equal(m.isSecret(field('text', 'city')), false, 'the setting was fixed and the fields are still masked');
});

test('ui-1016 L: Esc on the masking crosshair tells the open panel how much is covered, and the panel says it', () => {
  assert.match(SOURCE, /e\.key === 'Escape'[\s\S]{0,120}stop\(\);\s*B\.send\(\{ type: 'UQA_MASK_DONE', n: document\.querySelectorAll\('\[data-uqa-masked\]'\)\.length/);
  const tool = fs.readFileSync(path.join(HERE, '..', 'popup', 'tool-actions.js'), 'utf8');
  assert.match(tool, /msg\?\.type === 'UQA_MASK_DONE'[\s\S]*popup\.mask\.maskedOne[\s\S]*popup\.mask\.none/);
  assert.match(tool, /picking\s*\? t\('popup\.mask\.picking'\)/, 'while the crosshair is on, the panel says what to do');
  assert.match(PICKER, /type: 'UQA_PICKED', text: noteText/, 'a locator copy reaches the panel even with no session');
  assert.match(tool, /msg\?\.type === 'UQA_PICKED'[\s\S]*pickFrom = ''[\s\S]*paintLocatorNow\(\)/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
