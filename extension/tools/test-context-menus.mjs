/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The right-click menu: its shape, and the copy of the popup's tool list it
 * carries.
 *
 * ── why the second half of this file exists ────────────────────────────────
 *
 * `core/tool-catalogue.json` holds a copy of `popup/popup.js`'s `TOOLS[]` and
 * `GROUPS`, and a copy is normally the wrong answer — the menu's own header says
 * so about "start recording" having been implemented twice.
 *
 * It is a copy here for a measured reason. `background/context-menus.js` is in
 * the service worker's static boot graph, and that graph is held to a hard byte
 * ceiling by `tools/test-worker-imports.mjs` because MV3 re-parses all of it on
 * every cold start. The catalogue is JSON, fetched when a menu is built rather
 * than imported, so it is not in the graph at all — but the price of not
 * importing is that nothing in the language keeps the two lists equal.
 *
 * This file is that price: the two must agree on ids, labels, groups and order,
 * and the moment they do not, this fails and prints the difference. A rename in
 * the popup — "File it" to "Jira filing", say — cannot silently leave the menu
 * reading the old word.
 *
 * The catalogue is parsed as JSON. `popup.js` is read as TEXT and its literals
 * parsed, because it touches `document` at module scope and cannot be loaded in
 * Node. Parsing is what is available, and it is enough: what is compared is
 * exactly the literal a person edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/* ── reading the two lists ──────────────────────────────────────────────── */

/** The body of a top-level `const NAME = [ … ];`, brace-counted rather than regexed. */
function arrayLiteral(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `no "const ${name} = [" in the source`);
  let i = src.indexOf('[', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`"const ${name} = [" never closes`);
}

/**
 * `{ key: 'value' }` pairs out of one array literal, one object per entry.
 *
 * Only the string-valued keys this file compares are read. Everything else in
 * those objects — the `what`/`why` prose, the icons, the panel ids — is the
 * popup's business and no concern of the menu's.
 */
function entries(literal, keys) {
  const out = [];
  // Whole-line comments first: the entries are separated by `},` and a comment
  // between two of them made the split miss the boundary, so three tools were
  // read as part of the entry above and silently vanished from the comparison.
  // Whole-line only, so a `//` inside a string is left alone.
  const clean = literal.replace(/^\s*\/\/.*$/gm, '');
  // Split on the top-level `},` boundaries between objects.
  for (const chunk of clean.split(/\}\s*,?\s*(?=\{)/)) {
    const row = {};
    for (const key of keys) {
      const m = new RegExp(`(?:^|[{,\\s])${key}:\\s*'((?:\\\\.|[^'\\\\])*)'`).exec(chunk);
      if (m) row[key] = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    if (Object.keys(row).length) out.push(row);
  }
  return out;
}

const popup = read('popup/popup.js');
const menu = read('background/context-menus.js');
const catalogue = JSON.parse(read('core/tool-catalogue.json'));

const popupTools = entries(arrayLiteral(popup, 'TOOLS'), ['action', 'tool', 'label']);
const menuTools = catalogue.tools;
const popupGroups = entries(arrayLiteral(popup, 'GROUPS'), ['id', 'label']);
const menuGroups = catalogue.groups;

/** `tools: ['a','b']` off each popup group, which is where the grouping lives. */
const popupGrouping = [...arrayLiteral(popup, 'GROUPS').matchAll(/id:\s*'([a-z]+)'[\s\S]*?tools:\s*\[([^\]]*)\]/g)].map(
  ([, id, list]) => ({ id, tools: [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]) })
);

console.log('the right-click menu, and the tool list it copies');

/* ── the copy is a copy ─────────────────────────────────────────────────── */

test('the menu carries every tool the popup has, and no others', () => {
  assert.deepEqual(
    menuTools.map((t) => t.tool).sort(),
    popupTools.map((t) => t.tool).sort(),
    'the menu and the popup disagree about which tools exist'
  );
  // Eighteen since "Check the fine print" landed on 6 September, the second
  // number is asserted as well as the set, so a tool quietly lost from both
  // files at once still fails here.
  // Against the popup, never against a number written here: a literal is a
  // second place to remember, and it is the place nobody remembers.
  assert.equal(menuTools.length, popupTools.length,
    `${menuTools.length} tools in the menu, ${popupTools.length} in the popup`);
});

test('every label in the menu is the popup’s label, character for character', () => {
  const popupLabel = Object.fromEntries(popupTools.map((t) => [t.tool, t.label]));
  const wrong = menuTools
    .filter((t) => t.label !== popupLabel[t.tool])
    .map((t) => `${t.tool}: menu "${t.label}" vs popup "${popupLabel[t.tool]}"`);
  assert.deepEqual(wrong, [], `a label was renamed in one file and not the other:\n       ${wrong.join('\n       ')}`);
});

test('the four groups are the popup’s four groups, with its labels', () => {
  assert.deepEqual(
    menuGroups.map((g) => `${g.id}:${g.label}`),
    popupGroups.map((g) => `${g.id}:${g.label}`)
  );
  assert.deepEqual(menuGroups.map((g) => g.id), ['capture', 'check', 'design', 'break']);
});

test('each tool sits in the group the popup puts it in, in the popup’s order', () => {
  for (const { id, tools } of popupGrouping) {
    assert.deepEqual(
      menuTools.filter((t) => t.group === id).map((t) => t.tool),
      tools,
      `the "${id}" group differs from the popup's`
    );
  }
});

test('no tool is in the popup’s list but in none of its groups', () => {
  // The popup guards this at runtime by logging orphans; here it is a failure,
  // because an orphan in the menu is a submenu entry that never gets created.
  const grouped = new Set(popupGrouping.flatMap((g) => g.tools));
  const orphans = popupTools.map((t) => t.tool).filter((t) => !grouped.has(t));
  assert.deepEqual(orphans, []);
});

/* ── the routes ─────────────────────────────────────────────────────────── */

test('every tool routes to a handler the worker actually has', () => {
  const worker = workerSrc();
  // The words are the tools whose popup card is not one message: the clip
  // (which spends an activeTab grant), coverage (a toggle across two messages),
  // the diagram (which opens a tab), and break and `popup` - cards that open a
  // panel, which a context menu cannot be, so the entry says where the panel is.
  const words = new Set(['clip', 'coverage', 'diagram', 'break', 'popup']);
  const missing = menuTools
    .filter((t) => !words.has(t.send) && !new RegExp(`^\\s*${t.send}:`, 'm').test(worker))
    .map((t) => `${t.tool} → ${t.send}`);
  assert.deepEqual(missing, [], `routed at a message the worker does not handle: ${missing.join(', ')}`);
});

test('the record tool spends the same activeTab grant the page entry does', () => {
  // Two case labels, one body. A second implementation of "start or stop the
  // clip" is how the two end up disagreeing about what stop means.
  assert.match(menu, /case 'qaw-clip':\s*\n\s*case 'qaw-tool-record': \{/);
  const record = menuTools.find((t) => t.tool === 'record');
  assert.equal(record.send, 'clip');
});

/* ── what the menu says, in each state ──────────────────────────────────── */

test('a tool that needs a session stays visible and says so', () => {
  // Both halves matter. Hidden, a tester cannot tell the two menus apart from
  // a broken extension; silent, they press it and nothing explains itself.
  assert.match(menu, /\(start a session first\)/);
  assert.match(menu, /if \(tool\?\.session && !recording\)/);
  // And the catalogue is what it reads that flag from, not a second list here.
  assert.match(menu, /core\/tool-catalogue\.json/);
  assert.ok(menuTools.some((t) => t.session), 'no tool is marked as needing a session');
});

test('the menu stays inside its own ceiling', () => {
  const max = Number(/const MAX_ITEMS = (\d+)/.exec(menu)?.[1]);
  assert.ok(Number.isFinite(max), 'MAX_ITEMS is not declared');
  // 1 parent + the existing entries and separators + 4 group parents + 18 tools.
  const existing = (arrayLiteral(menu, 'ITEMS').match(/id:\s*'/g) || []).length;
  const total = 1 + existing + 1 + menuGroups.length + menuTools.length;
  assert.ok(total <= max, `${total} menu items against a ceiling of ${max}`);
  console.log(`      (${total} items, ceiling ${max})`);
});

test('the tools are grouped under the parent, not flattened into it', () => {
  // Every tool entry names a group parent; none is created straight on the
  // QA Wrap parent, which is what would make the menu 29 entries long.
  assert.match(menu, /parentId: parent \|\| PARENT/);
  assert.match(menu, /id: `qaw-group-\$\{group\.id\}`/);
});

/* ── concurrent rebuilds (root cause of 44 "duplicate id" lastErrors, 4 Oct) ── */

/**
 * A chrome.contextMenus that behaves like the real one where it matters: ids
 * are unique, removeAll and create complete on a later tick, a duplicate sets
 * runtime.lastError for the callback only, and an error nobody read is
 * "Unchecked runtime.lastError" — the exact line on the Errors page.
 */
function fakeChrome() {
  const live = new Map();
  const log = { duplicates: [], unchecked: [] };
  const rt = {};
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const api = {
    removeAll(cb) {
      tick().then(() => { live.clear(); cb?.(); });
    },
    create(props, cb) {
      let err = null;
      if (live.has(props.id)) { err = `Cannot create item with duplicate id ${props.id}`; log.duplicates.push(props.id); }
      else live.set(props.id, props);
      tick().then(() => {
        let read = false;
        if (err) Object.defineProperty(rt, 'lastError', { configurable: true, get() { read = true; return { message: err }; } });
        cb?.();
        delete rt.lastError;
        if (err && !(cb && read)) log.unchecked.push(err);
      });
      return props.id;
    },
  };
  return { api, live, log, rt };
}

async function withFake(fn) {
  const f = fakeChrome();
  const catalogueJson = read('core/tool-catalogue.json');
  globalThis.chrome = {
    contextMenus: f.api,
    runtime: Object.assign(f.rt, { getURL: (p) => p }),
  };
  globalThis.fetch = async () => {
    await new Promise((r) => setTimeout(r, 3));
    return { json: async () => JSON.parse(catalogueJson) };
  };
  const mod = await import(`../background/context-menus.js?cm=${Math.random()}`);
  await fn(f, mod);
}
const settle = () => new Promise((r) => setTimeout(r, 60));
const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

let expectedIds = null;
atest('a single build creates the menu once (reference set)', () =>
  withFake(async (f, m) => {
    await m.buildContextMenus({ recording: false });
    await settle();
    assert.equal(f.log.duplicates.length, 0);
    assert.ok(f.live.size > 20, `only ${f.live.size} items`);
    expectedIds = [...f.live.keys()];
  }));

atest('three concurrent rebuilds: zero duplicate ids, zero unchecked errors, same menu', () =>
  withFake(async (f, m) => {
    await Promise.all([m.buildContextMenus({ recording: false }), m.buildContextMenus({ recording: false }), m.buildContextMenus({ recording: true })]);
    await settle();
    assert.deepEqual(f.log.duplicates, [], `${f.log.duplicates.length} duplicate ids`);
    assert.deepEqual(f.log.unchecked, [], `${f.log.unchecked.length} unchecked lastErrors`);
    assert.deepEqual([...f.live.keys()], expectedIds);
  }));

atest('a rebuild requested during a rebuild coalesces into one trailing rebuild with the latest state', () =>
  withFake(async (f, m) => {
    const first = m.buildContextMenus({ recording: false });
    await new Promise((r) => setTimeout(r, 4));
    const second = m.buildContextMenus({ recording: true });
    await Promise.all([first, second]);
    await settle();
    assert.deepEqual(f.log.duplicates, []);
    assert.deepEqual(f.log.unchecked, []);
    assert.deepEqual([...f.live.keys()], expectedIds);
    assert.equal(f.live.get('qaw-record').title, 'Stop the QA session', 'the trailing rebuild must carry the latest state');
  }));

for (const [name, fn] of asyncTests) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
