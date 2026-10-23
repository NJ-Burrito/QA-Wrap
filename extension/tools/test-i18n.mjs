/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The pair is the unit.
 *
 * Arabic and English are both first-class in this product, which means a key
 * that exists in one table and not in the other is not "a translation still to
 * do", it is an interface that changes language in the middle of a sentence.
 * That is worse than an untranslated product, because the tester cannot tell
 * whether the missing half is a bug in the tool or a bug in the thing they are
 * testing. So the two tables are held identical, by key, by this file, and a
 * key added to `en.json` alone fails the build the same minute it is typed.
 *
 * Eight things are checked, and each of them is a fault that shipped somewhere
 * before somebody wrote a test for it:
 *
 *   1. the tables are flat objects of strings, sorted, with no empty value
 *   2. their key sets are identical
 *   3. no em dash and no "(s)" plural in either — `tools/test-copy.mjs` and
 *      `tools/test-plurals.mjs` read `.js` and `.html` and never open a
 *      `.json`, so these are the same two rules at the door the copy now
 *      comes through
 *   4. every key the sources ask for exists in both tables
 *   5. every key in the tables is asked for by something
 *   6. the Arabic is mechanically clean: no invisible or bidi-control
 *      characters, no tatweel, no Persian letters, no Arabic-Indic digits, no
 *      Latin punctuation inside an Arabic run
 *   7. no Arabic value is just the English one copied across
 *   8. no surface still writes English straight into the DOM
 *
 * Check 6 is the mechanical half of an Arabic/English proofreading pass,
 * reimplemented here rather than shelled out to, for one reason: this runs in
 * `npm test` on every machine that clones the repository, and a Node suite that
 * needs a Python interpreter on the PATH is a suite that gets skipped. The
 * skill's own scanner is still the thing to run when the Arabic is being
 * written; this is the thing that stops it regressing afterwards.
 *
 *   node tools/test-i18n.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = path.join(EXT, 'platform', 'i18n');

/** The pages a tester reads. `core/`, `platform/` and `background/` are not surfaces. */
const SURFACES = ['popup', 'options', 'report', 'welcome', 'whatsnew', 'tutorials', 'devtools', 'annotate', 'diagram', 'videoedit', 'replay', 'api', 'practice'];

/**
 * The key prefixes, which are not quite the directories.
 *
 * `panel` rather than `devtools`, because the surface is the panel and the
 * directory also holds the DevTools host page, which has no copy on it. And
 * four that belong to no single page: `common` for a word three surfaces share,
 * `tools` for the nineteen cards keyed by the id the session's usage log uses,
 * `press` for what a press says, `fix` for the one action a refusal has.
 */
const PREFIXES = new Set(['popup', 'options', 'report', 'welcome', 'tutorials', 'panel', 'annotate', 'diagram', 'videoedit', 'replay', 'api', 'common', 'tools', 'press', 'fix', 'overlay', 'buffer', 'bridge', 'aiwrite', 'update']);

let fail = 0;
let checks = 0;
const bad = (where, why) => { fail++; console.log(`  FAIL  ${where}\n          ${why}`); };
const ok = () => { checks++; };

/* ── 1. the tables themselves ───────────────────────────────────────────── */

const read = (code) => {
  const at = path.join(TABLES, `${code}.json`);
  if (!fs.existsSync(at)) { bad(`platform/i18n/${code}.json`, 'the table is missing'); return {}; }
  const raw = fs.readFileSync(at, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch (e) { bad(`platform/i18n/${code}.json`, `not valid JSON: ${e.message}`); return {}; }
  if (raw.includes('\r')) bad(`platform/i18n/${code}.json`, 'CRLF line endings; this repository is LF');
  return json;
};

const en = read('en');
const ar = read('ar');

for (const [code, table] of [['en', en], ['ar', ar]]) {
  const keys = Object.keys(table);
  if (!keys.length) { bad(`platform/i18n/${code}.json`, 'the table is empty'); continue; }

  const sorted = [...keys].sort();
  const firstOutOfOrder = keys.findIndex((k, i) => k !== sorted[i]);
  if (firstOutOfOrder !== -1) {
    bad(`platform/i18n/${code}.json`, `keys are not sorted: "${keys[firstOutOfOrder]}" comes after "${keys[firstOutOfOrder - 1]}". Sorted keys mean a merge conflict is one line, not the whole file.`);
  } else ok();

  for (const key of keys) {
    const value = table[key];
    if (typeof value !== 'string') { bad(`platform/i18n/${code}.json:${key}`, `values must be strings, this is ${typeof value}. A sentence that needs markup is split into its own elements in the HTML.`); continue; }
    if (!value.trim()) { bad(`platform/i18n/${code}.json:${key}`, 'empty value'); continue; }
    if (value.includes('—')) bad(`platform/i18n/${code}.json:${key}`, `em dash in copy: "${value.slice(0, 70)}"`);
    // The same argument as the em dash, for the same reason: `tools/test-plurals.mjs`
    // walks `.js`, `.mjs` and `.html` and never opens a `.json`, and "1 screenshot(s)"
    // is now a sentence that would arrive through this door instead.
    if (/\(s\)/.test(value)) bad(`platform/i18n/${code}.json:${key}`, `an "(s)" plural: "${value.slice(0, 70)}". Two keys and a count, the way report.js does it.`);
    /*
     * A single leading or trailing space is allowed, and only that.
     *
     * Twenty-five of these values are clause continuations: " Allowed on 1
     * site.", " and ", " · next: {label}". The space that joins them to the
     * sentence in front lives with the words on purpose. Moving it into the
     * template — `${a} ${t('b')}` — hides it from the person writing the other
     * language, who is exactly the person who needs to see it: an Arabic
     * clause does not always attach where the English one does, and a joiner
     * they cannot reach is a joiner that ends up doubled or missing. A tab, a
     * newline or two spaces is never that, and is always a typo.
     */
    const inner = value.replace(/^ /, '').replace(/ $/, '');
    if (inner !== inner.trim()) bad(`platform/i18n/${code}.json:${key}`, 'whitespace beyond a single leading or trailing space');
    if (/ {2}/.test(value)) bad(`platform/i18n/${code}.json:${key}`, 'a double space');
    if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(key)) bad(`platform/i18n/${code}.json`, `"${key}" is not a dotted key of the shape surface.area.name`);
    else if (!PREFIXES.has(key.split('.')[0])) {
      bad(`platform/i18n/${code}.json`, `"${key}" is under an unknown prefix; they are ${[...PREFIXES].join(', ')}`);
    }
  }
  ok();
}

/* ── 2. identical key sets ──────────────────────────────────────────────── */

const enKeys = new Set(Object.keys(en));
const arKeys = new Set(Object.keys(ar));
const onlyEn = [...enKeys].filter((k) => !arKeys.has(k));
const onlyAr = [...arKeys].filter((k) => !enKeys.has(k));
if (onlyEn.length) bad('platform/i18n', `${onlyEn.length} key(s) in en.json with no Arabic: ${onlyEn.slice(0, 12).join(', ')}${onlyEn.length > 12 ? ' …' : ''}`);
if (onlyAr.length) bad('platform/i18n', `${onlyAr.length} key(s) in ar.json with no English: ${onlyAr.slice(0, 12).join(', ')}${onlyAr.length > 12 ? ' …' : ''}`);
if (!onlyEn.length && !onlyAr.length) ok();

/**
 * Where the two languages genuinely join differently, and the reason.
 *
 * Arabic's «و» is not the English "and": it is a prefix, written onto the front
 * of the word it joins, so «القياس1 والقياس2» has no space after it and " and "
 * has one on both sides. A test that demanded the same edges here would be
 * demanding wrong Arabic.
 */
const JOINS_DIFFERENTLY = new Set(['popup.viewport.and']);

/*
 * And a clause continuation continues in both languages.
 *
 * `panel.storage.introPre` ends in a space in English because the next clause
 * is welded onto it; an Arabic value that trimmed it renders two sentences run
 * together with no gap, and nothing else in this file would notice, because the
 * key is present and the value is not empty.
 */
for (const key of enKeys) {
  if (!arKeys.has(key)) continue;
  const e = String(en[key]);
  const a = String(ar[key]);
  if (JOINS_DIFFERENTLY.has(key)) continue;
  const edge = (v) => `${/^\s/.test(v) ? '<' : ''}${/\s$/.test(v) ? '>' : ''}`;
  if (edge(e) !== edge(a)) {
    bad(`platform/i18n/ar.json:${key}`, `the English joins to a neighbouring clause and the Arabic does not (or the other way round): en ${JSON.stringify(e.slice(0, 40))}, ar ${JSON.stringify(a.slice(0, 40))}`);
  }
}
ok();

/* ── 3. what the sources ask for ────────────────────────────────────────── */

const GAME_PAGE = 'practice/practice.html';
function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const at = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'media') continue;
      out.push(...walk(path.join(dir, entry.name), at));
    } else if (at === GAME_PAGE) continue; // the game has its own tables (game/strings, held by test-game-i18n)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) out.push(at);
  }
  return out;
}

// r9-10-1: platform/i18n.js owns impactWord(), which asks for four keys, so it is read as a source too.
const files = [...SURFACES.flatMap((s) => (fs.existsSync(path.join(EXT, s)) ? walk(path.join(EXT, s), s) : [])), 'platform/i18n.js', 'ui/dom.js', 'ui/update-card.js'];

/** What a key looks like, and nothing else does: `popup.header.simple`. */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+$/;
/** `data-i18n`, `-title`, `-aria`, `-placeholder`, on an element in the HTML. */
const ATTR = /data-i18n(?:-title|-aria|-placeholder)?=["']([\w.-]+)["']/g;
/** The call sites: `t(…)`, `tf(…)`, `QAWi18n.t(…)`, `QAWi18n.has(…)`. */
const CALL = /(?<![\w$.])(?:tf?|QAWi18n\.t|QAWi18n\.has)\(/g;
/** A key built at run time out of a literal head: `` t(`options.sound.${id}`) ``. */
const TEMPLATE = /(?<![\w$.])(?:tf?|QAWi18n\.t|QAWi18n\.has)\(\s*`([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*\.?[a-zA-Z0-9]*)\$\{/g;

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * The keys named inside one `t(…)` call, however the call is shaped.
 *
 * `t('a.b')` is the easy half. The half that matters is
 * `t(n === 1 ? 'x.one' : 'x.many', { n })`, which is how every count in this
 * product is written, and a regex anchored to the quote right after the bracket
 * sees none of them. So the call is walked to its closing bracket, tracking
 * quotes and nesting, and every string inside it that has a key's shape is one.
 * A stray argument that happens to look like a key would have to also BE a key
 * in the table before anything believes it, which nothing else in these files
 * is.
 */
function keysInCalls(code) {
  const found = [];
  CALL.lastIndex = 0;
  for (const call of code.matchAll(CALL)) {
    let i = call.index + call[0].length;
    let depth = 1;
    const stop = Math.min(code.length, i + 600);
    while (i < stop && depth > 0) {
      const c = code[i];
      if (c === '(') { depth++; i++; continue; }
      if (c === ')') { depth--; i++; continue; }
      if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        const from = ++i;
        // 92 is the backslash. Written as a code point so the escape in this
        // scanner cannot be mangled by the next person editing the scanner.
        // 92 is the backslash, written as a code point so this scanner cannot be
        // broken by the next person escaping it wrong.
        while (i < code.length && code[i] !== quote) { if (code.charCodeAt(i) === 92) i++; i++; }
        const text = code.slice(from, i);
        if (KEY_SHAPE.test(text)) found.push({ key: text, at: lineOf(code, from) });
        i++;
        continue;
      }
      i++;
    }
  }
  return found;
}

/** Keys named in a call, so a missing one is a bug the caller can be sent to. */
const asked = new Map();
/**
 * Keys the sources mention ANYWHERE, which is a looser question and a different
 * one: it decides whether a key in the table is dead, and a false positive
 * there costs a translator nothing while a false negative deletes a live
 * sentence. A literal only counts if it is also a key, so nothing is invented.
 */
const mentioned = new Set();
/** Literal heads of run-time keys: everything under them is spoken for. */
const prefixes = new Set();

/**
 * A quoted string that has a key's shape, wherever it stands.
 *
 * No escape handling, because it needs none: a key is lower-case letters,
 * digits, dots and hyphens, so it can never contain a quote or a backslash,
 * and a literal that does is not one.
 */
const ANY_LITERAL = /(['\"`])([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+)\1/g;

for (const rel of files) {
  const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
  // Comments are prose about the code, and a key named in one is not a call.
  const code = rel.endsWith('.js')
    ? src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
    : src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

  for (const { key, at } of keysInCalls(code)) if (!asked.has(key)) asked.set(key, `${rel}:${at}`);

  ATTR.lastIndex = 0;
  for (const m of code.matchAll(ATTR)) {
    if (!m[1].includes('.')) continue;
    if (!asked.has(m[1])) asked.set(m[1], `${rel}:${lineOf(code, m.index)}`);
  }

  TEMPLATE.lastIndex = 0;
  for (const m of code.matchAll(TEMPLATE)) prefixes.add(m[1]);

  ANY_LITERAL.lastIndex = 0;
  for (const m of code.matchAll(ANY_LITERAL)) if (KEY_SHAPE.test(m[2])) mentioned.add(m[2]);
}

for (const [key, where] of asked) {
  if (!enKeys.has(key)) bad(where, `t('${key}') has no English`);
  if (!arKeys.has(key)) bad(where, `t('${key}') has no Arabic`);
}
if (asked.size) ok();

/* ── 4. and nothing in the tables that nobody asks for ──────────────────── */

/**
 * Keys assembled from something the table cannot see. Each needs a reason.
 *
 * `tools.<id>.*` is the nineteen cards, keyed by the id the session's usage log
 * and the ISTQB model both use; `popup.press.<id>` is what a press says, keyed
 * the same way; `popup.fix.*` is the one action a refusal has, chosen by
 * matching the sentence rather than a code, because the refusals arrive from
 * the worker, the offscreen document, `chrome.*` and four content scripts and
 * none of them shares one.
 */
const DYNAMIC = [
  /^tools\.[a-z0-9-]+\.(?:label|one|what|why|optionsLabel|optionsShort)$/,
  /^popup\.press\.[a-z0-9-]+$/,
  /^popup\.fix\.[a-z0-9-]+$/,
  /^options\.jira\.kind\.[a-z]+$/, // the worker builds the key from the kind of a Jira note (new, comment, mention, update)
  // Sent by the worker to the content world as one subset (UQA_OVERLAY_ASSETS,
  // S8) — content/ carries no i18n mechanism of its own, and test-i18n scans
  // only SURFACES above, never content/, so without this every overlay.* key
  // is dead forever (UI rework round 2, S1).
  /^overlay\.[a-zA-Z0-9.]+$/,
  /^buffer\.pill$/, // the replay buffer note, drawn by content/replay-buffer.js through the overlay string subset (OVERLAY_KEYS), like overlay.*
  // Built from the data registry (core/store-registry.js, T-054): one confirm sentence for both Reset buttons.
  /^options\.reset\.erases/,
  // Read by core/sessions.js describeFootprint(footprint, t) with literal keys (Next-review T-054): core/ is not a scanned surface.
  /^options\.safe\.fp\./,
  // Read by the service worker through tw() (background/ is not a scanned surface): the recorder's disk-failure notification and clip labels (devil r2 C2).
  /^common\.worker\.(?:disk|clip|policy|menu|toast|note|badge|coverage|debugger)\.[a-zA-Z0-9]+$/, /^common\.worker\.needsConsent$/, /^common\.worker\.shortcutNeedsSite$/,
    // D-1010-172: the shortcut toast names its command by a short noun phrase; the service worker builds the key from the command id (background/ is not scanned), and popup.refusal.notAllowed is the NOT_ALLOWED refusal text the popup reads by the error code.
  /^common\.worker\.command\.[a-zA-Z]+$/, /^popup\.refusal\.notAllowed$/,
  // Kept with no caller by decision: NEW-STRINGS row 31 (research/56, 27 Sept)
  // moved #view-report to popup.review.openFullReport and ruled that the old
  // "Open the report" key stays in both tables (test-popup-structure holds it).
  /^popup\.done\.openReport$/,
  // Read by core/api-send.js t() with literal keys (r2-10-2): core/ is not a scanned surface. test-api holds the pairs.
  /^api\.err\.(?:badUrl|scheme|unresolved|timeout|noAnswer|policy|redirect)$/,
  // The shortcut charter: read by the service worker as T('common.worker.quickCharter', 'Quick session') (D10, r4-09-2), like the context-menu strings above.
  /^common\.worker\.quickCharter$/,
  // r1-09-1: read by platform/worker-errors.js (a UI-side module, not a scanned surface) with the key built from an id; section 9 below holds every id to a worker throw.
  /^common\.worker\.err\.[a-zA-Z]+$/,
  // r1-10-1: the codes core/blackbox.js returns beside its English text (core/ is not a scanned surface); popup.js builds the key from the code. Section 8 holds every key to a code the engine emits.
  /^popup\.partitions\.bb\.(?:label|why|boundary|pos|bwhy|unit)\.[a-zA-Z]+$/,
  // D-1010-140: read by describeError() in platform/worker-errors.js (a UI-side module, not a scanned surface) with literal keys; the section "D-1010-140" below drives every one.
  /^common\.err\.(?:aborted|notAllowed|security|noFolderApi|debuggerMissing)$/,
];

const spokenFor = (k) =>
  asked.has(k)
  || mentioned.has(k)
  || DYNAMIC.some((re) => re.test(k))
  || [...prefixes].some((p) => k.startsWith(p));

const unused = [...enKeys].filter((k) => !spokenFor(k));
if (unused.length) {
  bad('platform/i18n/en.json', `${unused.length} key(s) nothing asks for: ${unused.slice(0, 15).join(', ')}${unused.length > 15 ? ' …' : ''}\n          A dead key is a sentence a translator will keep in step for nothing. Delete it, or add its shape to DYNAMIC in this file with the reason.`);
} else {
  ok();
  console.log('0 key(s) nothing asks for'); // D-1010-116: the number run-suites records; a ceiling that never sees a number is inert
}

/* ── 4a. the worker-read pairs (T-015, T-021): the worker passes an English fallback, so a half-pair would pass every other check ── */
for (const [key, holes] of [
  ['common.worker.toast.commandFailed', ['{command}', '{message}']],
  ['common.worker.badge.done', []], ['common.worker.badge.errors', []], ['common.worker.badge.warnings', []],
]) {
  if (!en[key] || !ar[key]) { bad(key, 'a worker-read key must exist in en.json and ar.json'); continue; }
  const lost = holes.filter((h) => !en[key].includes(h) || !ar[key].includes(h));
  if (lost.length) bad(key, `placeholder(s) ${lost.join(' ')} missing from one side`); else ok();
}

/* ── 4b. no English name the Arabic popup cannot translate (S6, S11b) ────── */

/**
 * A static `aria-label="…"` or `title="…"` is read by a screen reader and
 * shown as a tooltip, and `QAWi18n.apply()` only replaces it when the same
 * element carries `data-i18n-aria` / `data-i18n-title`. Without one the
 * Arabic page names the control in English (critic U9: `#lang`), and the key
 * scan above cannot see it because there is no key to find. So every literal
 * with Latin letters must sit beside the attribute that translates it.
 *
 * v2 (S11b): extended from popup.html alone to the Stage-2 pages that stage
 * touched. `replay/replay.html` was left out then — it loaded no
 * `platform/i18n.js` at all and had no `data-i18n` anywhere, a pre-existing
 * gap that stage's brief (icons, motion, this one rule) did not cover.
 *
 * v3 (Fix R2, 2026-09-28): that gap is closed — `replay/replay.html` now
 * carries `platform/i18n.js` and a full set of `data-i18n*` keys (`replay.*`
 * in both tables), so it joins the list this check runs against.
 */
const STATIC_ATTR_PAGES = [
  'popup/popup.html',
  'report/report.html',
  'options/options.html',
  'welcome/welcome.html',
  'devtools/panel.html',
  'annotate/annotate.html',
  'replay/replay.html',
];
/**
 * Elements a script overwrites on every boot with an already-translated,
 * interpolated string, before a person can read the static default — so a
 * flat `data-i18n-title`/`data-i18n-aria` here would either fight the script
 * (report/options: `paintTheme()`, harmless but pointless) or, worse, cannot
 * express the substitution at all (annotate: `paintShapeButton()` fills in
 * `{name}`) and would show a broken literal if that script ever failed.
 * report.html and options.html get `data-i18n-title` anyway, as a fallback
 * for the one path that skips the paint (`window.UQATheme` not yet loaded);
 * annotate's shapes button does not have an equally safe flat fallback, so it
 * stays on the exemption list.
 */
const STATIC_ATTR_EXEMPT = new Set(['annotate/annotate.html:#shapes-btn:aria-label', 'annotate/annotate.html:#shapes-btn:title']);
{
  let found = 0;
  for (const rel of STATIC_ATTR_PAGES) {
    const html = fs.readFileSync(path.join(EXT, rel.replace('/', path.sep)), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of html.match(/<[a-z][^>]*>/gi) || []) {
      for (const [attr, partner] of [['aria-label', 'data-i18n-aria'], ['title', 'data-i18n-title']]) {
        const m = tag.match(new RegExp(`\\s${attr}="([^"]*)"`));
        if (!m || !/[A-Za-z]/.test(m[1]) || tag.includes(`${partner}=`)) continue;
        const idm = tag.match(/\sid="([^"]*)"/);
        if (idm && STATIC_ATTR_EXEMPT.has(`${rel}:#${idm[1]}:${attr}`)) continue;
        found++;
        bad(rel, `${attr}="${m[1]}" has no ${partner}, so it stays English in Arabic: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
  }
  if (!found) ok();
}


/* ── 5. the Arabic, mechanically ────────────────────────────────────────── */

/**
 * Every fault here is decidable from the codepoints, which is exactly why it is
 * a test and not a reading. Reading misses an invisible character by definition.
 */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
/**
 * Tatweel, except where Arabic typography requires it.
 *
 * A one-letter preposition or the definite article cannot stand alone in its
 * isolated form in front of a Latin word: «ب QA Wrap» draws a disconnected
 * ba. The convention every Arabic technical publisher uses is «بـ QA Wrap»,
 * the connector carrying the letter's medial shape. So that exact token, one
 * or two Arabic letters ending in a tatweel and standing on its own, is
 * allowed, and a tatweel anywhere else is what it always was: a stretch
 * somebody typed inside a word, which breaks every search for that word.
 */
const CONNECTOR_TATWEEL = /(?:^|\s)(?:ال|[بلكفو])ـ(?=\s|$)/g;
const TATWEEL_BEYOND_A_CONNECTOR = { test: (v) => v.replace(CONNECTOR_TATWEEL, ' ').includes('ـ') };

const MECHANICAL = [
  [/[​-‏‪-‮⁦-⁩﻿]/, 'an invisible or bidi-control character, the kind Word leaves behind. It breaks every search for the word containing it.'],
  [TATWEEL_BEYOND_A_CONNECTOR, 'tatweel (ـ). It is a typesetting stretch, not a letter, and it breaks search and copy.'],
  [/[کیھہےپچژگ]/, 'a Persian or Urdu letter typed for an Arabic one (ک for ك, ی for ي, and friends).'],
  [/[٠-٩۰-۹]/, 'an Arabic-Indic digit. Numbers are Western everywhere in this product, so a count on screen matches the same count in an exported report.'],
  [/\s[،؛؟!]|\s[.:](?=\s|$)/, 'a space before punctuation.'],
  [/(^|\s)(\S+)\s+\2(\s|$)/, 'the same word twice in a row.'],
];

for (const key of arKeys) {
  const value = ar[key];
  if (typeof value !== 'string') continue;
  for (const [re, why] of MECHANICAL) {
    if (re.test(value)) bad(`platform/i18n/ar.json:${key}`, `${why}\n          "${value.slice(0, 70)}"`);
  }
  // Latin punctuation inside an Arabic run. Only where both neighbours are
  // Arabic: `Chrome, Jira` inside an Arabic sentence is Latin text and keeps
  // its own comma, and `PRIVACY.md` keeps its full stop.
  const latinInArabic = /[؀-ۿ][,;?][\s؀-ۿ]/.exec(value);
  if (latinInArabic) bad(`platform/i18n/ar.json:${key}`, `Latin punctuation inside an Arabic sentence: use ، ؛ ؟\n          "${value.slice(0, 70)}"`);
}
ok();

/* ── 6. and it is not the English copied across ─────────────────────────── */

/**
 * A value that is identical in both tables is either a proper name or a key
 * somebody forgot. The difference is decidable only by a person, so the ones
 * that are deliberate are listed, each with the reason it is deliberate.
 */
/**
 * r3-10-6 (D-1010-62): the allowlist of identical pairs, a reason per key. An identical en/ar pair that is not here fails, however
 * short it is, and a key listed here that has since been translated fails too (the list cannot go stale).
 */
const IDENTICAL_OK = {
  'common.pageTitle': 'the brand (kept Latin) and one placeholder, nothing else',
  // A language picker that names a language in a language you cannot read is the one control that must never be translated.
  'options.language.en': 'language picker: a language is named in itself',
  'options.language.ar': 'language picker: a language is named in itself',
  // Pure assembly: every word arrives through a hole; the rest is a separator or a unit.
  'popup.a11y.impact': 'placeholders and a separator only',
  'popup.viewport.took': 'placeholders and a separator only: the lead and the list arrive through holes',
  'popup.autofill.groupHead': 'placeholders and a colon only',
  'popup.break.slowFor': 'placeholders and a unit only',
  'popup.links.examples': 'placeholder in brackets only',
  'popup.partitions.fieldHead': 'placeholders and a colon only',
  'popup.perf.ms': 'a number and the unit ms',
  'popup.range.millis': 'a number and the unit ms',
  'popup.range.seconds': 'a number and the unit s',
  'popup.rule.line': 'placeholders and a separator only',
  'report.chart.barLabel': 'placeholders and a colon only',
  'report.ev.perf': 'Web Vitals metric names (LCP, CLS) stay Latin in both languages',
  'report.istqb.chatFailed': 'placeholders and a colon only',
  'tutorials.section.headingWithTally': 'placeholders and a separator only',
  'videoedit.progress.percent': 'a number and a percent sign',
  // File and product names: the name of the format, not a description of it.
  'popup.done.formatJson': 'file format name',
  'popup.done.formatMarkdown': 'file format name',
  'popup.done.formatPlaywright': 'product name',
  'popup.spec.markdown': 'file format name',
  'report.part.githubNote': 'file format name',
  'report.part.junit': 'file format name (JUnit XML)',
  'report.part.sheetXlsxNote': 'product name (Excel)',
  'report.part.yaml': 'file format name',
  'report.raw.fmtYaml': 'file format name',
};
const SAME_ON_PURPOSE = new Set(Object.keys(IDENTICAL_OK));
/** Arabic values that are two product names with only the list comma localised (r2-10-1 script check): not identical, no Arabic letter. */
const AR_LATIN_OK = new Set(['report.part.csvNote']);
/** Values that are a name, a code or a glyph rather than words. */
const NOT_WORDS = /^(?:[A-Z][A-Za-z0-9+#.]*|[\d\W_]+)$/;

/**
 * A value with nothing in it to translate.
 *
 * Fourteen of these tables' values are pure assembly: `{v}ms`, `{s}s`,
 * `{scope} · {left}`, `LCP {lcp} · CLS {cls} · {requests}`. Every word a
 * reader sees in them arrives through a hole, and the only characters the value
 * itself contributes are separators, units and metric names that stay Latin in
 * both languages. Demanding a different Arabic string for those would mean
 * inventing a difference that is not there. So: take the holes out, and if what
 * is left has no lower-case Latin word of three letters or more, there was no
 * prose in it to begin with.
 */
const NOTHING_TO_TRANSLATE = (v) => !/[a-z]{3,}/.test(String(v).replace(/\{\w+\}/g, ' '));

const echoed = [...enKeys].filter((k) => arKeys.has(k) && ar[k] === en[k] && !(k in IDENTICAL_OK));
const stale = Object.keys(IDENTICAL_OK).filter((k) => !(k in en) || ar[k] !== en[k]);
if (stale.length) bad('tools/test-i18n.mjs', `${stale.length} IDENTICAL_OK key(s) are no longer identical pairs (translated or removed): ${stale.join(', ')}. Remove them from the allowlist.`);
if (echoed.length) {
  bad('platform/i18n/ar.json', `${echoed.length} value(s) are the English, untranslated: ${echoed.slice(0, 15).join(', ')}${echoed.length > 15 ? ' …' : ''}\n          If one of them is a proper name, put its key in IDENTICAL_OK in this file with the reason.`);
} else ok();

/* ── 6b. each value is in its own script (r2-10-1: a swapped pair passed every check above) ── */

/**
 * The English table holds no Arabic letter at all. The Arabic table holds at
 * least one, unless the value has nothing to translate (separators, units,
 * metric names, a placeholder-only string), is a name or a code, or is listed
 * in SAME_ON_PURPOSE. Takes the two tables so the self-check below can feed it
 * a deliberately swapped pair and prove the check is not vacuous.
 */
const ARABIC_LETTER = /[ء-يٮ-ۓݐ-ݿ]/;
function scriptFaults(enTable, arTable) {
  const out = [];
  for (const [k, v] of Object.entries(enTable)) {
    if (ARABIC_LETTER.test(String(v)) && !SAME_ON_PURPOSE.has(k)) out.push(`en.json:${k} holds Arabic letters: "${String(v).slice(0, 50)}"`);
  }
  for (const [k, v] of Object.entries(arTable)) {
    const s = String(v);
    if (ARABIC_LETTER.test(s) || SAME_ON_PURPOSE.has(k) || AR_LATIN_OK.has(k) || NOT_WORDS.test(s.trim()) || NOTHING_TO_TRANSLATE(s)) continue;
    out.push(`ar.json:${k} has no Arabic letter: "${s.slice(0, 50)}"`);
  }
  return out;
}
const scriptBad = scriptFaults(en, ar);
if (scriptBad.length) {
  bad('platform/i18n', `${scriptBad.length} value(s) in the wrong script: ${scriptBad.slice(0, 8).join(' | ')}${scriptBad.length > 8 ? ' …' : ''}\n          A value that is a name or a format goes in IDENTICAL_OK with the reason.`);
} else ok();
{
  // Negative self-check: the swapped pair r2-10-1 found must be caught, or the check above proves nothing.
  const swapped = scriptFaults({ 'report.quality.finePrintGloss': 'التدقيق القانوني' }, { 'report.quality.finePrintGloss': 'The fine print' });
  if (swapped.length === 2) ok(); else bad('test-i18n.mjs', `the script check did not catch a swapped en/ar pair (${swapped.length} of 2)`);
}

/* ── 7. nothing writes English straight into the DOM any more ───────────── */

/**
 * The check that stops this decaying.
 *
 * A key table is easy to add and easy to route around: the next feature writes
 * `el.textContent = 'Nothing yet'` because that is one line and `t()` is two,
 * and six months later half the interface is English again in Arabic. So the
 * assignment itself is the thing that is banned, and the exceptions are listed
 * one by one with the reason each is not copy.
 */
const WRITES = [
  [/\.(?:textContent|innerText)\s*=\s*(['"])([^'"\n]{2,})\1/g, 'textContent'],
  // A template literal is the same assignment with a hole in it, and the hole
  // is a number or a name; the words around it are still copy.
  [/\.(?:textContent|innerText)\s*=\s*(`)([^`]{2,})\1/g, 'textContent'],
  [/\.(?:title|placeholder|ariaLabel)\s*=\s*(['"`])([^'"`\n]{2,})\1/g, 'attribute'],
  [/setAttribute\(\s*['"](?:aria-label|placeholder|title)['"]\s*,\s*(['"`])([^'"`\n]{2,})\1/g, 'attribute'],
];
/** Two or more words of Latin letters: a sentence, not an id or a unit. */
const READS_AS_ENGLISH = /^[^؀-ۿ]*\b[A-Za-z]{2,}\b[^؀-ۿ]*\b[A-Za-z]{2,}\b/;

/**
 * Not copy, and why. Each entry is the exact string, so a new one has to be
 * argued for rather than absorbed by a loose pattern.
 */
const NOT_COPY = new Set([
    /*
   * Read out of popup.js as source by tools/test-popup-structure.mjs, character
   * for character, as the sentence that explains the quiet health mark. The
   * literal is assigned and the line after it reassigns from the table, so the
   * tester reads Arabic and the suite still finds its sentence.
   */
  'The browser asks permission first. Answer its prompt and this runs.',
  /*
   * An example address in a placeholder, showing the shape of a Slack webhook.
   * It is a URL a tester copies the form of, not a sentence they read.
   */
  'https://hooks.slack.com/services/…',
  /*
   * The browser tab's title: the product name, then the tester's own charter.
   * "QA Wrap" is Latin in both tables, and a charter is what somebody typed.
   */
  'QA Wrap:',
]);

for (const rel of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
  for (const [re, what] of WRITES) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) {
      // `${…}` is a value, not words: what is judged is the copy around it.
      const text = m[2].replace(/\$\{[^}]*\}/g, ' ').trim();
      // A hole that would not close held another template inside it, so what is
      // left is source and not a sentence: `${name.length > 34 ? …` is code.
      if (text.includes('${')) continue;
      if (!READS_AS_ENGLISH.test(text)) continue;
      if (NOT_COPY.has(text) || NOT_COPY.has(m[2])) continue;
      bad(`${rel}:${lineOf(code, m.index)}`, `English written straight into ${what}: "${text}"\n          Use t('…'), or add the exact string to NOT_COPY in this file with the reason it is not copy.`);
    }
  }
}
ok();

/* ── 8. every surface loads the mechanism ───────────────────────────────── */

for (const rel of files.filter((f) => f.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
  // A page with no script of its own has nothing to translate.
  if (!/<script[^>]+src=/.test(src)) continue;
  // The DevTools host page and the side panel are iframes and shells with no
  // copy in them; they are covered by the page they load.
  if (/devtools\/devtools\.html$/.test(rel)) continue;
  if (!src.includes('platform/i18n.js')) bad(rel, 'does not load platform/i18n.js, so nothing on it can be Arabic');
}
ok();

/* ── 8. the black-box engine speaks codes, and every code is in both tables (r1-10-1) ── */

const { pathToFileURL } = await import('node:url');
const BB = await import(pathToFileURL(path.join(EXT, 'core', 'blackbox.js')).href);
const bbSource = fs.readFileSync(path.join(EXT, 'core', 'blackbox.js'), 'utf8');
const BBP = 'popup.partitions.bb.';

/** t(): fill {holes}; a param may itself be a { code, params }. */
function resolveRef(table, r) {
  if (!r || !r.code) return null;
  const vars = {};
  for (const [k, v] of Object.entries(r.params || {})) vars[k] = v && typeof v === 'object' && v.code ? resolveRef(table, v) : v;
  const raw = table[BBP + r.code];
  if (raw == null) return `<<missing ${BBP}${r.code}>>`;
  return String(raw).replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w));
}

/** Every field shape the engine branches on. The patterns and accept lists carry no Latin letter run, so they cannot trip the Arabic gate below. */
const BB_SWEEP = [
  { type: 'checkbox' }, { type: 'checkbox', required: true },
  { type: 'select-one', options: [{ value: '1' }, { label: 'x', value: '2' }] }, { type: 'radio', required: true, options: [{ value: '1' }] },
  { type: 'file' }, { type: 'file', accept: '.png', required: true },
  { type: 'text' }, { type: 'text', required: true, minlength: 2, maxlength: 9 }, { type: 'text', minlength: 3 }, { type: 'url', maxlength: 30 },
  { type: 'email', maxlength: 20 }, { type: 'email', pattern: '\\d+', maxlength: 12 }, { type: 'tel' }, { type: 'tel', pattern: '\\d+', maxlength: 9 },
  { type: 'text', pattern: '\\d+', required: true },
  { type: 'number', min: 1, max: 10 }, { type: 'number', min: 2 }, { type: 'number', max: 7 }, { type: 'number' }, { type: 'number', min: 0, max: 10, step: 3 },
  { type: 'number', min: 5, max: 1 }, { type: 'range' },
  { type: 'date', min: '2026-01-01', max: '2026-12-31' }, { type: 'date' }, { type: 'month', min: '2026-02', max: '2026-04' },
  { type: 'week', min: '2026-W05', max: '2026-W09' }, { type: 'datetime-local', min: '2026-06-01T09:00', max: '2026-06-02T09:00' },
  { type: 'time', min: '09:00', max: '17:00' }, { type: 'time', min: '22:00', max: '06:00' }, { type: 'time' }, { type: 'color' },
];

/** [English literal, ref] pairs for every message the engine puts on a row. */
function bbMessages(field) {
  const pairs = [];
  for (const p of BB.partitions(field)) pairs.push([p.label, p.i18n.label], [p.why, p.i18n.why]);
  for (const b of BB.boundaries(field)) {
    pairs.push([b.boundary, b.i18n.boundary]);
    for (const v of b.values) pairs.push([v.position, v.i18n.position], [v.why, v.i18n.why]);
  }
  return pairs.filter(([, r]) => r);
}

const usedCodes = new Set();
const LATIN_WORD = /[A-Za-z]{4,}/g;
let bbRows = 0;
for (const field of BB_SWEEP) {
  for (const [english, r] of bbMessages(field)) {
    bbRows++;
    const where = `core/blackbox.js ${JSON.stringify(field)} "${english.slice(0, 40)}"`;
    const collect = (x) => { if (x && x.code) { usedCodes.add(x.code); for (const v of Object.values(x.params || {})) collect(v); } };
    collect(r);
    if (resolveRef(en, r) !== english) bad(where, `the English table does not reproduce the English text:\n          ${resolveRef(en, r)}`);
    const arabic = resolveRef(ar, r);
    if (/<<missing|\{\w+\}/.test(arabic)) bad(where, `Arabic has a missing key or an unfilled hole: ${arabic}`);
    const latin = arabic.match(LATIN_WORD);
    if (latin) bad(where, `Latin word(s) ${latin.join(', ')} in the Arabic popup: ${arabic}`);
  }
}
if (bbRows) ok();

// Every bb key is a code the engine emits, and every code the source names is keyed (the second half guards a code the sweep does not reach).
const sourceCodes = new Set([...bbSource.matchAll(/'((?:label|why|boundary|pos|bwhy)\.[a-zA-Z]+)'/g)].map((m) => m[1]));
for (const name of ['day', 'month', 'minute', 'week']) if (bbSource.includes(`name: '${name}'`)) sourceCodes.add(`unit.${name}`);
for (const code of sourceCodes) {
  if (!(BBP + code in en) || !(BBP + code in ar)) bad('core/blackbox.js', `code "${code}" has no key ${BBP}${code} in both tables`);
}
const keyedCodes = Object.keys(en).filter((k) => k.startsWith(BBP)).map((k) => k.slice(BBP.length));
const orphan = keyedCodes.filter((c) => !sourceCodes.has(c));
if (orphan.length) bad('platform/i18n/en.json', `popup.partitions.bb key(s) no code in core/blackbox.js emits: ${orphan.join(', ')}`);
ok();

// The holes a code's sentence carries are the same in both languages.
for (const code of keyedCodes) {
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  if (holes(en[BBP + code]) !== holes(ar[BBP + code])) bad(BBP + code, `placeholders differ: en {${holes(en[BBP + code])}} ar {${holes(ar[BBP + code])}}`);
}
ok();

/* ── D-1010-113: both languages carry the same {placeholders}. A plural key is compared by the union over its forms. ── */
{
  /** Known, reasoned differences. Never widened to pass: a new entry needs a reason a reader can check. */
  const PLACEHOLDER_ALLOW = {
    'options.privacy.purgedOne': 'singular form (Arabic says "one session" in words; {days} is kept)',
    'options.safe.eraseDoneOne': 'singular form (Arabic says "one session" in words; {mb} is kept)',
    'report.chart.sliceOne': 'singular form (Arabic says "one slice" in words)',
    'report.istqb.emptyRequiredOne': 'singular form (Arabic says "one required field" in words)',
    'report.istqb.fileConfirmAttachOne': 'singular form (Arabic says "one file" in words)',
    'report.istqb.filesOne': 'singular form (Arabic says "one file" in words)',
    'report.istqb.projectsOne': 'singular form (Arabic says "one project" in words)',
    'report.team.cardsOne': 'singular form (Arabic says "one card" in words; {where} is kept)',
    'tools.api.what': 'English shows the literal syntax {{variables}} as an example; the Arabic sentence names the feature without printing the braces',
  };
  const holeSet = (value) => {
    const forms = /^(?:zero|one|two|few|many|other): /.test(value) ? value.split(' · ') : [value];
    return [...new Set(forms.flatMap((f) => [...f.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
  };
  let used = 0;
  for (const key of Object.keys(en)) {
    if (!(key in ar)) continue;
    const a = holeSet(en[key]), b = holeSet(ar[key]);
    if (a === b) continue;
    if (key in PLACEHOLDER_ALLOW) { used++; continue; }
    bad(key, `placeholders differ: en {${a}} ar {${b}}. A dropped placeholder shows the tester a sentence with a hole in it.`);
  }
  for (const key of Object.keys(PLACEHOLDER_ALLOW)) if (holeSet(en[key] ?? '') === holeSet(ar[key] ?? '')) bad(key, 'is on PLACEHOLDER_ALLOW but the placeholders match now; delete the entry');
  void used;
  ok();
}

/* ── 9. the worker's own errors: every throw is keyed or on the internal list (r1-09-1, D-1010-04) ── */

const WE = await import(pathToFileURL(path.join(EXT, 'platform', 'worker-errors.js')).href);
const swSource = workerSrc(); // OF-18: the entry and the modules split out of it
const siteSource = fs.readFileSync(path.join(EXT, 'background', 'site-access.js'), 'utf8');

/** The arguments of every `throw new Error(...)`, each as a list of literal / template / expression parts. */
function throwParts(code, withCoded = false) {
  const found = [];
  // r10-10-2 (D-224): `throw coded('sentence', 'CODE')` is a throw of the sentence too; only its first argument is read.
  const re = withCoded ? /throw (?:new Error|coded)\(/g : /throw new Error\(/g;
  let m;
  const skipString = (i) => { const q = code[i]; i++; while (code[i] !== q) { if (code[i] === '\\') i++; i++; } return i + 1; };
  const skipTemplate = (i) => {
    i++;
    for (let depth = 0; !(code[i] === '`' && depth === 0); i++) {
      if (code[i] === '\\') i++;
      else if (code[i] === '$' && code[i + 1] === '{') { depth++; i++; }
      else if (code[i] === '}' && depth) depth--;
    }
    return i + 1;
  };
  while ((m = re.exec(code))) {
    const at = code.slice(0, m.index).split('\n').length;
    const parts = [];
    let i = re.lastIndex;
    let depth = 0;
    let buf = '';
    const flush = () => { if (buf.trim()) parts.push({ expr: buf.trim() }); buf = ''; };
    for (;;) {
      const c = code[i];
      if (c === undefined) break;
      if (c === ')' && depth === 0) break;
      if (c === "'" || c === '"') { flush(); const j = skipString(i); parts.push({ lit: code.slice(i + 1, j - 1).replace(/\\(.)/g, '$1') }); i = j; continue; }
      if (c === '`') { flush(); const j = skipTemplate(i); parts.push({ tpl: code.slice(i + 1, j - 1).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '\u0000').replace(/\\(.)/g, '$1') }); i = j; continue; }
      if (c === '+' && depth === 0) { flush(); i++; continue; }
      if (c === ',' && depth === 0 && withCoded) break;
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') depth--;
      buf += c; i++;
    }
    flush();
    found.push({ at, parts });
  }
  return found;
}

const constants = {
  WORKSPACES_OFF: (/const WORKSPACES_OFF = '([^']*)';/.exec(swSource) || [])[1],
  'site.NOT_ALLOWED': (/export const NOT_ALLOWED =\s*'([^']*)';/.exec(siteSource) || [])[1],
};
const throwSites = throwParts(swSource, true);
if (throwSites.length < 50) bad('background/service-worker.js', `only ${throwSites.length} throw sites found; the scan is broken`);
const exactThrown = new Set();
const internalUsed = new Set();
let unkeyed = 0;
// r10-10-2 (D-224): throws outside the main sentence table that have no key yet, per file. A RATCHET, not a licence: a new unkeyed throw
// in a file raises its count and fails; fixing one lowers the count and the test demands the number come down. The sentences come
// out in English for an Arabic tester until each is keyed in platform/worker-errors.js with an EN+AR pair.
const UNKEYED_DEBT = {
  'export-build.js': 3, 'fullpage.js': 4, 'jira.js': 7, 'media.js': 4, 'notify.js': 10, 'security-headers.js': 1,
  'service-worker.js': 3, 'handlers-app.js': 1, 'handlers-tools.js': 2, 'worker-scans.js': 5, 'worker-session.js': 2, 'storage-editor.js': 17, 'whitebox.js': 4,
};
const debtFound = {};
const debtNote = (file, where, message) => { (debtFound[file] ||= []).push(`${where}: ${message}`); };
// r10-10-2 (D-224): every background/*.js file is scanned, not only service-worker.js: storage-editor.js throws the two cookie sentences.
const throwFiles = fs.readdirSync(path.join(EXT, 'background')).filter((f) => f.endsWith('.js')).sort();
if (throwFiles.length < 15 || !throwFiles.includes('storage-editor.js')) bad('background', `only ${throwFiles.length} files found; the throw scan is broken`);
for (const file of throwFiles) {
  const sites = throwParts(fs.readFileSync(path.join(EXT, 'background', file), 'utf8'), true);
  for (const { at, parts } of sites) {
    const where = `background/${file}:${at}`;
    let text = '';
    let single = null;
    for (const p of parts) {
      if (p.lit != null) text += p.lit;
      else if (p.tpl != null) text += p.tpl;
      else if (parts.length === 1 && constants[p.expr] != null) text += constants[p.expr];
      else { single = p.expr; text = null; break; }
    }
    if (single != null) {
      const hit = WE.INTERNAL.findIndex((e) => e.expr && e.expr.test(single));
      if (hit < 0) debtNote(file, where, `throw ${single} forwards an expression that is not on the INTERNAL list of platform/worker-errors.js`); else internalUsed.add(hit);
      continue;
    }
    const hasHole = text.includes('\u0000');
    const sample = text.replace(/\u0000/g, '7');
    if (hasHole) {
      const internalHole = WE.INTERNAL.findIndex((e) => e.text && e.text.test(sample));
      if (internalHole >= 0) { internalUsed.add(internalHole); continue; }
      if (!WE.PATTERNS.some((p) => p.re.test(sample))) debtNote(file, where, `"${sample}" has a hole and no PATTERN in platform/worker-errors.js matches it`);
      continue;
    }
    exactThrown.add(text);
    const internal = WE.INTERNAL.findIndex((e) => e.text && e.text.test(text));
    if (internal >= 0) internalUsed.add(internal);
    else if (!WE.EXACT.has(text)) debtNote(file, where, `"${text.slice(0, 70)}" is neither keyed in platform/worker-errors.js nor on its INTERNAL list`);
  }
}
for (const file of new Set([...Object.keys(UNKEYED_DEBT), ...Object.keys(debtFound)])) {
  const found = debtFound[file] || [];
  const allowed = UNKEYED_DEBT[file] || 0;
  if (found.length > allowed) { for (const m of found) bad(`background/${file}`, `${m} (${found.length} unkeyed throws, the ratchet allows ${allowed})`); unkeyed += found.length; }
  else if (found.length < allowed) { bad('tools/test-i18n.mjs', `UNKEYED_DEBT['${file}'] is ${allowed} but only ${found.length} unkeyed throws are left; lower the number`); unkeyed++; }
}
// D-1010-172: the not-allowed refusal is thrown as site.notAllowedError() (an Error carrying code 'NOT_ALLOWED'), not as a literal; it counts as a throw of the keyed sentence.
if (/throw site\.notAllowedError\(\)/.test(swSource)) {
  if (!/notAllowedError = \(\) => Object\.assign\(new Error\(NOT_ALLOWED\), \{ code: 'NOT_ALLOWED' \}\)/.test(siteSource)) bad('background/site-access.js', "notAllowedError() must build new Error(NOT_ALLOWED) with code 'NOT_ALLOWED'");
  else if (constants['site.NOT_ALLOWED']) exactThrown.add(constants['site.NOT_ALLOWED']);
}
// D-1010-105: core/db.js builds its three open-failure sentences with withCode(new Error(...), CODE); the 8000 is OPEN_TIMEOUT_MS.
{
  const dbSrc = fs.readFileSync(path.join(EXT, 'core', 'db.js'), 'utf8');
  const timeout = (/const OPEN_TIMEOUT_MS = (\d+);/.exec(dbSrc) || [])[1];
  if (!timeout) bad('core/db.js', 'OPEN_TIMEOUT_MS is not a plain number any more; the dbSlow row in platform/worker-errors.js cannot be pinned');
  let dbSentences = 0;
  const flat = dbSrc.replace(/\$\{OPEN_TIMEOUT_MS\}/g, timeout || '0');
  for (const { parts } of throwParts(flat.replace(/new Error\(/g, 'throw new Error('))) {
    if (parts.length && parts.every((p) => p.lit != null || p.tpl != null) && !parts.some((p) => p.tpl != null && p.tpl.includes('\u0000'))) {
      exactThrown.add(parts.map((p) => p.lit ?? p.tpl).join('')); dbSentences++;
    }
  }
  if (dbSentences < 3) bad('core/db.js', `only ${dbSentences} literal Error sentences found; the three open-failure sentences must stay verbatim (D-1010-105)`);
  for (const [id, needle] of [['dbSlow', 'did not open within'], ['dbBlocked', 'held open by another'], ['dbBroken', 'failed to open']]) {
    const row = [...WE.EXACT].find(([, v]) => v === id);
    if (!row || !row[0].includes(needle) || !exactThrown.has(row[0])) bad('platform/worker-errors.js', `the ${id} row must match the sentence core/db.js throws, word for word`);
  }
}
// D-235 (r10): a worker reply can carry a keyed sentence as `error: '...'` beside a flag (the stop reply with saved:false), not as a throw; a literal like that counts as emitted.
for (const m of swSource.matchAll(/\berror: '((?:[^'\\\n]|\\.)*)'/g)) exactThrown.add(m[1].replace(/\\(.)/g, '$1'));
// D-1010-70: whitebox.js throws the coverage-detached sentence; a keyed row counts as thrown when a literal throw there says it.
for (const { parts } of throwParts(fs.readFileSync(path.join(EXT, 'background', 'whitebox.js'), 'utf8'))) {
  if (parts.length === 1 && parts[0].lit != null) exactThrown.add(parts[0].lit);
}
if (!unkeyed) ok();
for (const i of WE.INTERNAL.keys()) {
  if (!internalUsed.has(i)) bad('platform/worker-errors.js', `INTERNAL entry ${i} (${WE.INTERNAL[i].why}) matches no throw in service-worker.js; delete it`);
}
for (const text of WE.EXACT.keys()) {
  if (!exactThrown.has(text)) bad('platform/worker-errors.js', `"${text.slice(0, 60)}" is keyed but service-worker.js no longer throws it; delete the row`);
}
ok();

// Each key exists in both tables with the same holes; the English table reproduces the sentence it replaces.
const WEP = 'common.worker.err.';
const weIds = new Set([...WE.EXACT.values(), ...Object.keys(en).filter((k) => k.startsWith(WEP)).map((k) => k.slice(WEP.length))]);
for (const id of weIds) {
  if (!(WEP + id in en) || !(WEP + id in ar)) { bad(WEP + id, 'not in both tables'); continue; }
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  if (holes(en[WEP + id]) !== holes(ar[WEP + id])) bad(WEP + id, `placeholders differ: en {${holes(en[WEP + id])}} ar {${holes(ar[WEP + id])}}`);
}
for (const [text, id] of WE.EXACT) if (en[WEP + id] !== text) bad(WEP + id, `the English table must hold the worker sentence word for word: "${en[WEP + id]}"`);
ok();
const tOf = (table) => (key, vars = {}) => String(table[key] ?? key).replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w));
{
  const sentence = 'Nothing on the page matches "a b" any more.';
  const viaAr = WE.translateWorkerError(sentence, tOf(ar), 'ar');
  if (!viaAr || viaAr === sentence || !viaAr.includes('a b')) bad('platform/worker-errors.js', `Arabic did not translate a pattern sentence: ${viaAr}`);
  if (WE.translateWorkerError(sentence, tOf(en), 'en') !== null) bad('platform/worker-errors.js', 'English must be left alone (null)');
  if (WE.translateWorkerError('Something nobody keyed.', tOf(ar), 'ar') !== null) bad('platform/worker-errors.js', 'an unknown sentence must be left as it came (null)');
  const big = WE.translateWorkerError('That item is 12MB, which is too large to pass through a message. Open it from the report page, which reads it straight from local storage.', tOf(ar), 'ar');
  if (!big || !big.includes('12')) bad('platform/worker-errors.js', `the size hole was not filled: ${big}`);
  const screen = WE.translateWorkerError('Already recording the screen. Stop the current clip first. A recording cannot change what it is filming half way through.', tOf(ar), 'ar');
  if (!screen || screen === ar[WEP + 'alreadyTab']) bad('platform/worker-errors.js', 'the screen/tab variants were not told apart');
}
ok();

/* ── r2-08-6: a failure is localized by its code first, then by its sentence ─── */
{
  const lockedChange = ar[WEP + 'vaultLockedChange'];
  const lockedFile = ar[WEP + 'vaultLockedFile'];
  if (!lockedChange || !lockedFile || lockedChange === en[WEP + 'vaultLockedChange']) bad(WEP + 'vaultLocked*', 'both locked-vault sentences need a real Arabic line');
  const settingsErr = Object.assign(new Error('Unlock QA Wrap to change saved connections'), { code: 'VAULT_LOCKED' });
  if (WE.localizeError(settingsErr, tOf(ar), 'ar') !== lockedChange) bad('platform/worker-errors.js', 'a VAULT_LOCKED error did not become the Arabic change line');
  if (WE.localizeError({ ok: false, code: 'VAULT_LOCKED', error: 'Unlock QA Wrap to file' }, tOf(ar), 'ar') !== lockedFile) bad('platform/worker-errors.js', 'a VAULT_LOCKED reply about filing did not become the Arabic file line');
  if (WE.localizeError(settingsErr, tOf(en), 'en') !== en[WEP + 'vaultLockedChange']) bad('platform/worker-errors.js', 'English keeps the English line for a code');
  if (en[WEP + 'vaultLockedChange'] !== settingsErr.message) bad(WEP + 'vaultLockedChange', 'the English table must hold the settings sentence word for word');
  if (WE.localizeError({ ok: false, error: 'No active tab.' }, tOf(ar), 'ar') !== ar[WEP + 'noActiveTab']) bad('platform/worker-errors.js', 'the exact table is read after the code');
  if (WE.localizeError('Something nobody keyed.', tOf(ar), 'ar') !== 'Something nobody keyed.') bad('platform/worker-errors.js', 'an unknown sentence is handed back as it came');
  if (WE.localizeError(null, tOf(ar), 'ar') !== '' || WE.localizeError({ ok: false }, tOf(ar), 'ar') !== '') bad('platform/worker-errors.js', 'nothing to say gives an empty string so a fallback can speak');
  const settingsSrc = fs.readFileSync(path.join(EXT, 'platform', 'settings.js'), 'utf8');
  if (!settingsSrc.includes("throw Object.assign(new Error('Unlock QA Wrap to change saved connections'), { code: 'VAULT_LOCKED' })")) bad('platform/settings.js', 'the locked-vault write must throw with code VAULT_LOCKED');
  for (const f of ['report/report.js', 'options/options.js']) {
    if (!fs.readFileSync(path.join(EXT, f), 'utf8').includes("import('../platform/worker-errors.js')")) bad(f, 'must load platform/worker-errors.js lazily');
  }
}
ok();

/* ── r2-10-4: a number or a date on screen is never left to the machine's own locale ─── */
{
  const forced = /numTag\(\)|nu-latn|'en-US'|'en-GB'/;
  let scanned = 0;
  for (const dir of ['popup', 'options', 'report', 'replay', 'core', 'devtools']) { // D-1010-112: core and devtools format dates too
    for (const f of fs.readdirSync(path.join(EXT, dir)).filter((n) => n.endsWith('.js'))) {
      const lines = fs.readFileSync(path.join(EXT, dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        for (const m of line.matchAll(/\.toLocale(?:Date|Time)?String\(((?:[^()]|\([^()]*\))*)\)/g)) {
          scanned++;
          if (!forced.test(m[1])) bad(`${dir}/${f}:${i + 1}`, `${m[0]} follows the machine's locale (Arabic digits on some PCs); pass QAWi18n.numTag()`);
        }
      });
    }
  }
  if (!scanned) bad('tools/test-i18n.mjs', 'the numeral scan found no toLocale call at all: the scan is broken');
  const i18nSrc = fs.readFileSync(path.join(EXT, 'platform', 'i18n.js'), 'utf8');
  if (!/numTag = \(\) => \(active === 'ar' \? 'ar-JO-u-nu-latn' : 'en-GB'\)/.test(i18nSrc) || !i18nSrc.includes('numTag, setting')) bad('platform/i18n.js', 'QAWi18n.numTag must exist and match the forced Latin-digit tag');
  if (!/^[0-9]/.test(new Intl.NumberFormat('ar-JO-u-nu-latn').format(1234567))) bad('platform/i18n.js', 'the Arabic tag printed non-Latin digits');
}
ok();


/* ── D-1010-140: a caught failure reaches the screen as a keyed sentence, never as the raw message ─── */
{
  const tAr = tOf(ar); const tEn = tOf(en);
  const cases = [
    [{ name: 'AbortError', message: 'The user aborted a request.' }, 'common.err.aborted'],
    [{ name: 'NotAllowedError', message: 'x' }, 'common.err.notAllowed'],
    [{ name: 'SecurityError', message: 'x' }, 'common.err.security'],
    [Object.assign(new Error('This browser cannot grant a folder.'), { code: 'NO_FOLDER_API' }), 'common.err.noFolderApi'],
    [Object.assign(new Error('Coverage needs the debugger permission.'), { code: 'DEBUGGER_MISSING' }), 'common.err.debuggerMissing'],
    [new Error('Failed to fetch'), 'common.err.unknown'],
  ];
  for (const [err, key] of cases) {
    for (const [tt, table, lang] of [[tAr, ar, 'ar'], [tEn, en, 'en']]) {
      const d = WE.describeError(err, tt);
      if (d.text !== table[key]) bad('platform/worker-errors.js', `describeError(${err.name || err.code}) in ${lang} did not give ${key}: ${d.text}`);
      if (d.title !== String(err.message)) bad('platform/worker-errors.js', 'the raw message must be the title, untouched');
      if (key !== 'common.err.noFolderApi' && d.text.includes(err.message)) bad('platform/worker-errors.js', 'the raw message leaked into the visible text');
    }
  }
  if (WE.describeError({ message: 'No active tab.' }, tAr).text !== ar[WEP + 'noActiveTab']) bad('platform/worker-errors.js', 'describeError must translate a worker sentence it knows');
  if (WE.describeError(undefined, tAr).text !== ar['common.err.unknown']) bad('platform/worker-errors.js', 'describeError(undefined) must give the unknown sentence');
  for (const k of ['aborted', 'notAllowed', 'security', 'noFolderApi', 'debuggerMissing', 'unknown']) {
    if (!en['common.err.' + k] || !ar['common.err.' + k] || en['common.err.' + k] === ar['common.err.' + k]) bad('common.err.' + k, 'needs a real Arabic line');
  }
  // D-1010-151: a worker reply { ok: false, code: 'DEBUGGER_MISSING' } reaches the popup through localizeError, in both languages.
  for (const [tt, table] of [[tAr, ar], [tEn, en]]) {
    if (WE.localizeError({ ok: false, error: 'x', code: 'DEBUGGER_MISSING' }, tt, 'en') !== table['common.err.debuggerMissing']) bad('platform/worker-errors.js', 'localizeError(DEBUGGER_MISSING) did not give common.err.debuggerMissing');
  }
  const folderSrc = fs.readFileSync(path.join(EXT, 'ui', 'folder.js'), 'utf8');
  if (!/code: 'NO_FOLDER_API'/.test(folderSrc)) bad('ui/folder.js', "the no-folder-API throw must carry code: 'NO_FOLDER_API'");

  // The sink scan: a raw `.message` (or `.error`) of a caught value must not reach textContent or say(). Allow-list by file, each with its reason.
  const ALLOW = {
    'api/api.js': 'the failure text is already a keyed sentence from core/api-send.js (api.err.*), which wraps the browser detail the tester needs to fix the host',
  };
  const sinkFiles = ['popup/popup.js', 'options/options.js', 'report/report.js', 'api/api.js', 'annotate/annotate.js', 'videoedit/videoedit.js'];
  let scannedSinks = 0;
  for (const f of sinkFiles) {
    const lines = fs.readFileSync(path.join(EXT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
      if (/\b(?:err|e|error|failure|ex)\??\.message\b/.test(line)) scannedSinks++;
      if (!/(?:textContent\s*=|\bsay\w*\()[^;]*\b(?:err|e|error|failure|ex)\??\.(?:message|error)\b/.test(line)) return;
      if (ALLOW[f] || /(?:^|[^\w$.])t\(\s*['"`]/.test(line)) return; // a keyed sentence that carries the detail in a {hole} is a sentence, not a raw message
      bad(`${f}:${i + 1}`, 'a raw .message reaches textContent or say(); use describeError(err, t) and put the raw text in title only');
    });
  }
  if (!scannedSinks) bad('tools/test-i18n.mjs', 'the sink scan found no .message at all: the scan is broken');
  for (const f of Object.keys(ALLOW)) if (!sinkFiles.includes(f)) bad('tools/test-i18n.mjs', `allow-list entry ${f} is not scanned`);
}
ok();

/* ── r7-10-1: plural() reads vars.count before vars.n, so a formatted n ("1,000") never picks the form ── */
{
  const vm = await import('node:vm');
  const sandbox = { Intl, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(EXT, 'platform', 'i18n.js'), 'utf8'), sandbox);
  const I = sandbox.QAWi18n;
  I.load('en', en); I.load('ar', ar);
  I.setLang('ar').catch(() => {});
  const chars = (count, n) => I.t('report.v.queryChars', { count, n });
  if (chars(1000, '1,000') !== '1,000 حرف') bad('platform/i18n.js plural', `count 1000 with n "1,000" gave "${chars(1000, '1,000')}", wanted "1,000 حرف"`);
  if (chars(0, '0') !== 'لا أحرف') bad('platform/i18n.js plural', `count 0 gave "${chars(0, '0')}", wanted "لا أحرف"`);
  if (chars(1, '1') !== 'حرف واحد') bad('platform/i18n.js plural', `count 1 gave "${chars(1, '1')}"`);
  if (!/count: queryParts\.query\.length, n: /.test(fs.readFileSync(path.join(EXT, 'report', 'report.js'), 'utf8'))) bad('report/report.js', 'queryChars no longer passes the raw count beside the formatted n');
}
ok();

/* ── r8-10-3: a static aria-label or title in a surface page needs its data-i18n twin ────────────────
 * A literal English aria-label="Shapes: Rectangle" is announced in English to an Arabic screen-reader user until a script repaints it.
 * Every non-empty literal needs data-i18n-aria (or data-i18n-title) beside it, so apply() writes the right language on first paint.
 * An empty attribute is a template slot that a script fills (popup.html's cloned copy button); it carries no words. */
function staticLabels(html) {
  const src = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const found = [];
  for (const m of src.matchAll(/<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = m[2];
    const line = src.slice(0, m.index).split('\n').length;
    for (const [attr, twin] of [['aria-label', 'data-i18n-aria'], ['title', 'data-i18n-title']]) {
      const lit = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
      if (!lit || !(lit[1] ?? lit[2] ?? '').trim()) continue;
      if (!new RegExp(`(?:^|\\s)${twin}\\s*=`).test(attrs)) found.push({ line, tag: m[1], attr });
    }
  }
  return found;
}
{
  const falsifier = staticLabels('<p>\n<button aria-label="Shapes: Rectangle" title="Shapes">x</button>\n<i aria-label="" title="ok" data-i18n-title="a.b"></i>\n</p>');
  if (falsifier.length !== 2) bad('tools/test-i18n.mjs', `the static-label scan found ${falsifier.length} of its 2 planted faults: the scan is broken`);
  let pages = 0;
  const htmlOf = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htmlOf(path.join(dir, e.name)) : e.name.endsWith('.html') && !e.name.endsWith('.fragment.html') ? [path.join(dir, e.name)] : []));
  for (const s of SURFACES) {
    if (!fs.existsSync(path.join(EXT, s))) continue;
    for (const f of htmlOf(path.join(EXT, s)).filter((x) => path.relative(EXT, x).replace(/\\/g, '/') !== GAME_PAGE)) {
      pages++;
      for (const x of staticLabels(fs.readFileSync(f, 'utf8'))) bad(`${path.relative(EXT, f).replace(/\\/g, '/')}:${x.line}`, `<${x.tag}> has a literal ${x.attr} and no ${x.attr === 'title' ? 'data-i18n-title' : 'data-i18n-aria'}; the other language reads English until a script runs`);
    }
  }
  if (!pages) bad('tools/test-i18n.mjs', 'the static-label scan read no page');
}
ok();

/* ── the count ──────────────────────────────────────────────────────────── */

/* ── r9-10-1 / r9-10-4 / r9-10-5 (D-219): impact words, the Arabic-letter gate, the bidi isolate ── */
{
  const vm = await import('node:vm');
  const sandbox = { Intl, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(EXT, 'platform', 'i18n.js'), 'utf8'), sandbox);
  const I = sandbox.QAWi18n;
  I.load('en', en); I.load('ar', ar);
  // r9-10-1: axe's band is a translated word in the pill; the English id stays for the sev- class.
  I.setLang('ar').catch(() => {});
  for (const [band, key] of [['critical', 'report.a11y.impactCritical'], ['serious', 'report.a11y.impactSerious'], ['moderate', 'report.a11y.impactModerate'], ['minor', 'report.a11y.impactMinor']]) {
    if (I.impactWord(band) !== ar[key]) bad('platform/i18n.js impactWord', `${band} gave "${I.impactWord(band)}", wanted the Arabic "${ar[key]}"`);
    if (!/[؀-ۿ]/.test(I.impactWord(band))) bad('platform/i18n.js impactWord', `${band} shows no Arabic letter in Arabic`);
  }
  if (I.impactWord('weird') !== 'weird') bad('platform/i18n.js impactWord', 'an unknown band must come back as it came');
  for (const f of ['popup/popup.js', 'devtools/panel.js', 'report/report.js']) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8');
    if (!/impactWord\(/.test(src)) bad(f, 'the impact pill no longer goes through impactWord()');
  }
  if (/function impactWord/.test(fs.readFileSync(path.join(EXT, 'report', 'report.js'), 'utf8'))) bad('report/report.js', 'impactWord() is copied here again; platform/i18n.js owns the one copy');
  // r9-10-5: a page's own text is wrapped in U+2068..U+2069, and empty stays empty.
  if (I.iso('example.com') !== '⁨example.com⁩') bad('platform/i18n.js iso', 'iso() must wrap in U+2068..U+2069');
  if (I.iso('') !== '' || I.iso(null) !== '' || I.iso(undefined) !== '') bad('platform/i18n.js iso', 'iso() of nothing must be the empty string');
  if (I.iso(0) !== '⁨0⁩') bad('platform/i18n.js iso', 'iso(0) is a value, not nothing');
  for (const f of ['popup/popup.js', 'report/report.js']) {
    if (!/QAWi18n\.iso\(/.test(fs.readFileSync(path.join(EXT, f), 'utf8'))) bad(f, 'the page data in sentences no longer goes through iso()');
  }
  // r9-10-4: an Arabic value with Latin letters must also hold an Arabic letter, unless the key is a placeholder, unit, brand, format or language name.
  const LATIN_ONLY_OK = {
    'common.pageTitle': 'brand + placeholder', 'options.language.en': 'the language names itself',
    'popup.break.slowFor': 'placeholders and a unit', 'popup.perf.ms': 'a unit', 'popup.range.millis': 'a unit', 'popup.range.seconds': 'a unit',
    'popup.done.formatJson': 'format name', 'popup.done.formatMarkdown': 'format name', 'popup.done.formatPlaywright': 'brand', 'popup.spec.markdown': 'format name',
    'report.ev.perf': 'metric names (LCP, CLS) and placeholders', 'report.part.githubNote': 'format name', 'report.part.junit': 'format name',
    'report.part.sheetXlsxNote': 'brand', 'report.part.yaml': 'format name', 'report.raw.fmtYaml': 'format name',
  };
  const offenders = [];
  for (const [k, v] of Object.entries(ar)) {
    const bare = String(v).replace(/\{[^}]*\}/g, '');
    if (/[A-Za-z]/.test(bare) && !/[؀-ۿ]/.test(bare) && !(k in LATIN_ONLY_OK)) offenders.push(k);
  }
  if (offenders.length) bad('platform/i18n/ar.json', `${offenders.length} Arabic value(s) hold Latin letters and no Arabic letter, so they were probably left untranslated: ${offenders.slice(0, 10).join(', ')}`);
  for (const k of Object.keys(LATIN_ONLY_OK)) if (!(k in ar)) bad('tools/test-i18n.mjs LATIN_ONLY_OK', `${k} is allowed but no longer exists; delete the entry`);
  ok();
}

/* ── r10-10-1 (D-223): every human export format has an option in the report's format picker ── */
{
  const filing = await import(pathToFileURL(path.join(EXT, 'core', 'filing.js')).href);
  const reportHtml = fs.readFileSync(path.join(EXT, 'report', 'report.html'), 'utf8');
  const pickerBlock = /<select id="format"[\s\S]*?<\/select>/.exec(reportHtml)?.[0] || '';
  const options = new Set([...pickerBlock.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]));
  if (options.size < 30) bad('report/report.html', `only ${options.size} options found in #format; the scan is broken`);
  // Filed from another surface, never chosen in this picker.
  const NOT_IN_PICKER = {
    'flow-png': 'saved by the diagram page (diagram/diagram.js UQA_EXPORT_SAVED), which draws the picture',
    'spec-reverse': 'filed from the page-spec reader tool, not an export of a session',
    'fine-print': 'filed from the fine-print tool, not an export of a session',
  };
  const human = Object.entries(filing.FORMATS).filter(([, f]) => f.audience === 'human').map(([id]) => id);
  for (const id of human) if (!options.has(id) && !(id in NOT_IN_PICKER)) bad('report/report.html', `format "${id}" is a human export (core/filing.js) with no <option value="${id}"> in #format; a tester cannot choose it`);
  for (const id of Object.keys(NOT_IN_PICKER)) if (options.has(id) || !human.includes(id)) bad('tools/test-i18n.mjs NOT_IN_PICKER', `${id} is on the list but has an option now, or is no longer a human format; delete the entry`);
  ok();
}

/* ── r10-10-4 (D-239): Latin text in a page is keyed, or a named token, or painted by a script ── */
{
  const HTML_DIRS = ['popup', 'options', 'report', 'tutorials', 'devtools', 'annotate', 'diagram', 'videoedit', 'replay', 'api', 'reporter'];
  // welcome/ is a deliberately bilingual static page: both languages sit in the markup, side by side, with no table behind them.
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const SKIP = new Set(['script', 'style', 'code', 'kbd', 'samp', 'pre', 'svg', 'template', 'noscript']);
  const TOKEN = /\b(?:QA Wrap|Nader Alzghoul|DevTools|Markdown|Playwright|JSON|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ERASE|WCAG|ARIA|[AI]{1,3}|ISTQB)\b/g;
  const CITATION = /^(?:GDPR )?Art\. [\d()a-z]+$|^ISO\/IEC(?:\/IEEE)? [\d.:-]+(?: (?:cl\.|control) [\d.]+)?$/;
  const attrOf = (attrs, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  // No named exceptions remain (OF-6): the reporter <title> is painted from reporter.js COPY.
  const NAMED = {};
  const namedUsed = new Set();
  // Placeholders that are examples of the site's own English words, not sentences for the tester.
  const EXAMPLE_PLACEHOLDER = new Set(['Test, Test Case, or Task']);
  const jsOf = (dir) => fs.readdirSync(path.join(EXT, dir)).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(EXT, dir, f), 'utf8')).join('\n');
  let scanned = 0;
  for (const dir of HTML_DIRS) {
    const js = jsOf(dir);
    const painted = (id) => id && new RegExp(`\\(\\s*['"]${id}['"]\\s*\\)\\??\\.(?:textContent|innerHTML|placeholder|title|replaceChildren)\\b`).test(js);
    for (const file of fs.readdirSync(path.join(EXT, dir)).filter((f) => f.endsWith('.html') && !f.endsWith('.fragment.html'))) {
      const rel = `${dir}/${file}`;
      const src = fs.readFileSync(path.join(EXT, dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
      const stack = [];
      const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
      let m;
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length;
        if (m[4] != null) {
          const text = m[4].replace(/&[a-z#0-9]+;/gi, ' ').replace(/\{\{[^}]*\}\}/g, ' ').trim();
          if (!text || /^!?doctype\b/i.test(text) || stack.some((e) => e.skip || e.i18n)) continue;
          if (CITATION.test(text)) continue;
          if (!/[A-Za-z]{3,}/.test(text.replace(TOKEN, ' '))) continue;
          if (stack.some((e) => painted(e.id))) continue;
          const named = `${rel}|${text}`;
          if (named in NAMED) { namedUsed.add(named); continue; }
          bad(`${rel}:${line}`, `Latin text "${text.slice(0, 50)}" has no data-i18n on it or an ancestor, is no brand/standard token, and no script paints its element. A tester reading Arabic sees English; key it as an EN+AR pair.`);
          continue;
        }
        const tag = m[2].toLowerCase();
        const attrs = m[3] || '';
        if (m[1]) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
        const own = /\sdata-i18n(?:-html)?\s*=/.test(` ${attrs}`);
        for (const [attr, key] of [['title', 'title'], ['placeholder', 'placeholder'], ['aria-label', 'aria'], ['alt', 'alt']]) {
          const v = attrOf(attrs, attr);
          // A placeholder is an example value (a URL, an address, a Jira type name) unless it reads as a sentence of four words or more.
          const sentence = attr !== 'placeholder' || (v && v.replace(TOKEN, ' ').split(/\s+/).filter((w) => /^[A-Za-z]{2,}\W*$/.test(w)).length >= 4 && !EXAMPLE_PLACEHOLDER.has(v));
          if (v && sentence && /[A-Za-z]{3,}/.test(v.replace(TOKEN, ' ')) && !new RegExp(`\\sdata-i18n-${key}\\s*=`).test(` ${attrs}`) && !own && !stack.some((e) => e.i18n || painted(e.id)) && !painted(attrOf(attrs, 'id'))) {
            bad(`${rel}:${line}`, `${attr}="${v.slice(0, 50)}" is Latin text with no data-i18n-${key} beside it`);
          }
        }
        if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
        stack.push({ tag, skip: SKIP.has(tag), i18n: own, id: attrOf(attrs, 'id') });
        scanned++;
      }
    }
  }
  if (scanned < 2000) bad('tools/test-i18n.mjs', `only ${scanned} elements scanned; the HTML scan is broken`);
  for (const k of Object.keys(NAMED)) if (!namedUsed.has(k)) bad('tools/test-i18n.mjs NAMED', `${k} no longer appears; delete the entry`);
  ok();
}

const perSurface = {};
for (const key of enKeys) {
  const head = key.split('.')[0];
  perSurface[head] = (perSurface[head] || 0) + 1;
}
console.log(`\n  ${enKeys.size} key(s), Arabic and English, across ${Object.keys(perSurface).length} prefixes:`);
for (const [head, n] of Object.entries(perSurface).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${head}`);

console.log(
  fail
    ? `\n${fail} problem(s) in the language tables\n`
    : `\nthe pair holds: ${enKeys.size} keys, both languages, ${checks} checks\n`,
);
process.exit(fail ? 1 : 0);
