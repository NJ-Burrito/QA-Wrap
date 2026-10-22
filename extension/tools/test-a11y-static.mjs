/* T-060: the cheap half of the accessibility ratchet. node tools/test-a11y-static.mjs
 * The browser half is `npm run test:a11y` (axe on ten pages x light/dark x en/ar, zero critical and serious). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

/** Buttons in an HTML source that have no accessible name: no text, aria-label, data-i18n(-aria), title or aria-labelledby. */
export function unlabeledButtons(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = m[1];
    const text = m[2].replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
    if (text || /\bhidden\b/.test(attrs) /* named by script when shown; axe covers it at run time */ || /\b(aria-label|aria-labelledby|data-i18n|data-i18n-aria|title|data-i18n-title)\s*=/.test(attrs)) continue;
    out.push(attrs.trim().slice(0, 80));
  }
  return out;
}

// the check itself must fail on an unlabeled button
assert.equal(unlabeledButtons('<button class="x"><svg><use href="#i"/></svg></button>').length, 1);
assert.equal(unlabeledButtons('<button aria-label="Close"><svg></svg></button><button>Save</button>').length, 0);

/**
 * r2-08-1: inputs, selects and textareas in an HTML source that have no accessible name: no aria-label,
 * aria-labelledby, data-i18n-aria or title, and no <label for="id">. A placeholder is not a name.
 * Hidden controls and type=hidden/button/submit/reset/image are skipped; script names them or axe covers them.
 */
export function unlabeledControls(source) {
  const out = [];
  const html = source.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length)); // a comment that mentions <select> is not a control
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/gi)].map((m) => m[1]));
  // r3-08-1: a control inside <label>...</label> is named by it, with or without for=
  const wrapped = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const type = (/\btype\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1] || 'text';
    if (m[1].toLowerCase() === 'input' && /^(hidden|button|submit|reset|image)$/i.test(type)) continue;
    if (/\bhidden(\s|$|=)/.test(attrs)) continue;
    if (/\b(aria-label|aria-labelledby|data-i18n-aria|title|data-i18n-title)\s*=/.test(attrs)) continue;
    const id = (/\bid\s*=\s*"([^"]+)"/i.exec(attrs) || [])[1];
    if (id && labelled.has(id)) continue;
    if (wrapped.some(([from, to]) => m.index > from && m.index < to)) continue;
    out.push(`${m[1]} ${attrs.trim().slice(0, 70)}`);
  }
  return out;
}

// the check itself must fail on a control named only by its placeholder
assert.equal(unlabeledControls('<textarea id="b" placeholder="x"></textarea>').length, 1);
assert.equal(unlabeledControls('<input type="text" placeholder="x" /><select id="s"></select>').length, 2);
assert.equal(unlabeledControls('<label for="u">U</label><input id="u" type="text"><input aria-label="n"><textarea aria-labelledby="h"></textarea><input type="file" hidden><input type="hidden">').length, 0);

assert.equal(unlabeledControls('<label>Name <input type="text"></label>').length, 0, 'a control wrapped in a label is named');
assert.equal(unlabeledControls('<label>Name</label><input type="text">').length, 1, 'a label beside a control, with no for=, names nothing');

assert.deepEqual(unlabeledControls(read('api/api.html')), [], 'api/api.html: a form control with no accessible name');

const pages = ['popup/popup.html', 'options/options.html', 'report/report.html', 'devtools/panel.html', 'welcome/welcome.html',
  'annotate/annotate.html', 'videoedit/videoedit.html', 'diagram/diagram.html', 'replay/replay.html', 'reporter/reporter.html'];
for (const p of pages) {
  assert.deepEqual(unlabeledButtons(read(p)), [], `${p}: a button with no accessible name`);
  assert.deepEqual(unlabeledControls(read(p)), [], `${p}: a form control with no accessible name`);
  assert.match(read(p), /ui\/tokens\.css/, `${p} must load the shared tokens (the one focus ring)`);
}

// r4-08-1: every aria-labelledby / aria-controls / aria-describedby id must exist in the page that names it.
// Allow-list: ids the page's own script creates at run time (report.js builds these headings).
const RUNTIME_IDS = { 'report/report.html': ['v-h', 'dj-h'] };
const danglingRefs = (html, allowed = []) => {
  const ids = new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
  const out = [];
  for (const m of html.matchAll(/\b(aria-labelledby|aria-controls|aria-describedby)\s*=\s*"([^"]*)"/g)) {
    for (const ref of m[2].split(/\s+/).filter(Boolean)) if (!ids.has(ref) && !allowed.includes(ref)) out.push(`${m[1]}="${ref}"`);
  }
  return out;
};
for (const p of [...pages, 'api/api.html', 'sidepanel/sidepanel.html', 'tutorials/tutorials.html', 'offscreen/offscreen.html', 'devtools/devtools.html']) {
  assert.deepEqual(danglingRefs(read(p), RUNTIME_IDS[p]), [], `${p}: an ARIA id reference points at no element`);
}
const reportJs = ['report/report.js', 'report/filing.js'].map(read).join('\n');
for (const id of RUNTIME_IDS['report/report.html']) assert.match(reportJs, new RegExp(`\\bid\\s*=\\s*["'\`]${id}["'\`]`), `report script no longer creates ${id}: drop it from the allow-list`);
// negative self-check: the real options page with one reference broken must be caught, and so must an unlisted run-time id
assert.deepEqual(danglingRefs(read('options/options.html').replace('aria-labelledby="h-sec-safe"', 'aria-labelledby="tab-sec-safe"')), ['aria-labelledby="tab-sec-safe"'], 'the id-reference check cannot see a dangling aria-labelledby');
assert.equal(danglingRefs('<p id="a" aria-describedby="a b">', ['b']).length, 0);
assert.equal(danglingRefs('<p id="a" aria-controls="zz">').length, 1);

// r3-08-1: the check must go red when any of the three labels is stripped from the real page
for (const [p, id] of [['popup/popup.html', 'charter'], ['popup/popup.html', 'note-text'], ['options/options.html', 'bundle-text']]) {
  const src = read(p);
  const tag = new RegExp(String.raw`<(?:input|textarea)\b[^>]*\bid="${id}"[^>]*>`).exec(src);
  assert.ok(tag, `${p}: #${id} exists`);
  assert.match(tag[0], /aria-label="[^"]+"/, `${p}: #${id} carries aria-label`);
  assert.match(tag[0], /data-i18n-aria="[^"]+"/, `${p}: #${id} carries data-i18n-aria`);
  const stripped = src.replace(tag[0], tag[0].replace(/\s(?:data-i18n-)?aria(?:-label)?="[^"]*"/g, ''));
  assert.equal(unlabeledControls(stripped).length, 1, `${p}: stripping the label from #${id} must turn the check red`);
  const key = /data-i18n-aria="([^"]+)"/.exec(tag[0])[1];
  for (const lang of ['en', 'ar']) {
    const table = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${lang}.json`), 'utf8'));
    assert.ok(table[key], `${lang}.json has ${key}`);
  }
}

// one shared focus ring, in the tokens
const tokens = read('ui/tokens.css');
assert.match(tokens, /--focus-ring-width/, 'focus ring token');
assert.match(tokens, /^:focus-visible\s*\{[^}]*outline:/m, 'global :focus-visible rule in ui/tokens.css');

// in-page host: per-layer aria-hidden, never on the host
const host = read('content/ui-host.js');
assert.doesNotMatch(host, /host\.setAttribute\('aria-hidden'/, 'the host must not be aria-hidden');
assert.match(host, /layer\.setAttribute\('aria-hidden', 'true'\)/, 'purely visual layers are hidden one by one');

// the seventh in-page key and the toolbar command
const { DEFAULTS, ACTIONS } = await import('../platform/settings.js');
assert.equal(Object.keys(DEFAULTS.keymap).length, 7);
assert.equal(DEFAULTS.keymap.bar, 'Alt+KeyB');
assert.ok(ACTIONS.bar.label);
assert.match(read('content/keymap.js'), /bar:\s*\(\)\s*=>\s*window\.UQABar\?\.focusBar/);
assert.match(read('content/bar.js'), /focusBar:/);
const manifest = JSON.parse(read('manifest.json'));
assert.ok(manifest.commands._execute_action, '_execute_action command');
assert.equal(Object.values(manifest.commands).filter((c) => c.suggested_key).length <= 4, true);
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));
for (const k of ['options.actions.bar.label', 'options.actions.bar.hint', 'report.lightbox.title', 'replay.controls.scrubValue']) {
  assert.ok(en[k] && ar[k], `${k} in both languages`);
}
assert.match(en['replay.controls.scrubValue'], /\{at\}.*\{total\}/);

// lightbox is a modal dialog; replay scrubber speaks time
assert.match(read('report/report.html'), /<dialog class="lightbox" id="lightbox"[^>]*aria-label/);
assert.match(read('report/report.js'), /showModal\(\)/);
assert.match(read('replay/replay.js'), /setAttribute\('aria-valuetext'/);

// r5-08-1: every scrollable <pre> in the API page is reachable by keyboard and named
const apiHtml = read('api/api.html');
const pres = [...apiHtml.matchAll(/<pre\b([^>]*)>/gi)].map((m) => m[1]);
assert.ok(pres.length >= 3, 'the API page has its three pre blocks');
for (const a of pres) {
  assert.match(a, /\btabindex="0"/, `a scrollable <pre> needs tabindex=0: ${a.trim().slice(0, 60)}`);
  assert.match(a, /\bdata-i18n-aria="[^"]+"/, `a focusable <pre> needs a translated name: ${a.trim().slice(0, 60)}`);
}
assert.match(read('api/api.css'), /\.pre:focus-visible\s*\{/, 'a focused .pre shows an outline');

// r5-08-2: no tab's aria-controls names a tablist; a view tab controls its panel
const repHtml = read('report/report.html');
const tablists = new Set([...repHtml.matchAll(/<[a-z]+\b[^>]*\brole="tablist"[^>]*>/gi)].map((m) => (/\bid="([^"]+)"/.exec(m[0]) || [])[1]).filter(Boolean));
for (const m of repHtml.matchAll(/<button\b[^>]*\brole="tab"[^>]*>/gi)) {
  const c = (/\baria-controls="([^"]+)"/.exec(m[0]) || [])[1];
  assert.ok(!c || !tablists.has(c), `a tab's aria-controls names a tablist (${c})`);
}
assert.match(read('report/report.js'), /setAttribute\('aria-controls', `panel-\$\{id\}`\)/, 'showTab points each view tab at its panel');

// D-1010-109 (WCAG 2.4.2 / 3.1.1): every page title is i18n-driven, or is the bare brand name. Pages that are not a tester's surface, or
// that have no i18n yet, are named here with the reason; the list is never widened to pass.
{
  const TITLE_EXEMPT = {
    'devtools/devtools.html': 'a hidden DevTools host page, never shown to anyone',
    'offscreen/offscreen.html': 'a hidden offscreen document, never shown to anyone',
    'reporter/reporter.html': 'an English-only page with no i18n wiring at all (its own round-6 item); loading i18n.js alone would flip it to RTL around English text',
  };
  const walk = (dir) => fs.readdirSync(path.join(EXT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (['vendor', 'node_modules', 'tools', 'dist', 'game'].includes(d.name) ? [] : walk(path.join(dir, d.name))) : d.name.endsWith('.html') ? [path.join(dir, d.name).replace(/\\/g, '/')] : []));
  const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
  let titled = 0;
  for (const p of walk('.')) {
    const m = /<title\b([^>]*)>([^<]*)<\/title>/i.exec(read(p));
    if (!m) continue;
    titled++;
    if (p in TITLE_EXEMPT) continue;
    const key = (/\bdata-i18n="([^"]+)"/.exec(m[1]) || [])[1];
    if (key) assert.ok(key in en && key in ar, `${p}: <title data-i18n="${key}"> must exist in both tables`);
    else assert.equal(m[2].trim(), 'QA Wrap', `${p}: the title "${m[2].trim()}" is English-only; give it data-i18n and an EN+AR pair (or it must be the bare brand name)`);
  }
  assert.ok(titled >= 12, `the title scan found only ${titled} pages; the walk is broken`);
  for (const [p] of Object.entries(TITLE_EXEMPT)) assert.ok(fs.existsSync(path.join(EXT, p)), `${p} is exempt but gone; delete the entry`);
  // A page that sets its title in code goes through the one keyed template, with the brand kept Latin in Arabic.
  for (const f of ['report/report.js', 'annotate/annotate.js', 'videoedit/videoedit.js']) assert.match(read(f), /document\.title = t\('common\.pageTitle'/, `${f} sets its title through common.pageTitle`);
  assert.doesNotMatch(read('report/report.js') + read('annotate/annotate.js') + read('videoedit/videoedit.js'), /document\.title = `QA Wrap/, 'no hard-coded English title template');
}

// D-1010-110 (APG tabs): arrow keys on the section bar move selection and keep focus on the section tab; focus is set after the row's `hidden`.
{
  const rep = read('report/report.js');
  assert.match(rep, /roving\(\$\('secbar'\), '\[data-sec\]', \(b\) => \{ openSection\(b, false\); b\.focus\(\); \}\)/, 'roving the section bar opens without focus, then focuses the section tab');
  assert.ok(rep.indexOf('if (toFocus && !row.hidden) toFocus.focus();') > rep.indexOf('row.hidden = TABS.filter('), 'showTab focuses only after row.hidden is settled');
}

// D-1010-111: the popup's live regions are in the HTML, empty, and code only toggles `hidden` / sets text.
{
  const html = read('popup/popup.html'), js = read('popup/popup.js');
  for (const id of ['live-loss', 'tech-cover-live', 'mask-broken']) assert.match(html, new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"[^>]*>\\s*</p>`), `#${id} is a persistent empty polite status region`);
  assert.doesNotMatch(js, /p\.setAttribute\('role', 'status'\)|chip\.setAttribute\('role', 'status'\)/, 'no live region is created already holding its text');
  assert.match(js, /requestAnimationFrame\(\(\) => \{ if \(node\.dataset\.liveText === want\)/, 'text is cleared, then set in a frame');
}

// D-219 (r9-08-2): the pages a tester lives in have exactly one <main> landmark and exactly one <h1>.
{
  const PAGES = ['popup/popup.html', 'options/options.html', 'api/api.html', 'diagram/diagram.html', 'devtools/panel.html', 'annotate/annotate.html', 'videoedit/videoedit.html', 'report/report.html'];
  for (const p of PAGES) {
    const src = read(p).replace(/<!--[\s\S]*?-->/g, '');
    assert.equal((src.match(/<main\b/gi) || []).length, 1, `${p}: exactly one <main> landmark`);
    assert.equal((src.match(/<h1\b/gi) || []).length, 1, `${p}: exactly one <h1>`);
  }
  // the check itself must fail on a page with none and on a page with two
  const count = (s, tag) => s.split(`<${tag}`).length - 1;
  assert.equal(count('<p>no landmark</p>', 'main'), 0);
  assert.equal(count('<h1>a</h1><h1>b</h1>', 'h1'), 2);
}

// D-217 (r9-08-1): every <table the core writes into an exported page sits directly inside a focusable, labelled .table-wrap,
// so a wide table scrolls by keyboard (WCAG 2.1.1). A table written bare fails here, not in a screen reader a year later.
{
  let tables = 0;
  for (const f of fs.readdirSync(path.join(EXT, 'core')).filter((n) => n.endsWith('.js'))) {
    const src = read(`core/${f}`);
    for (const m of src.matchAll(/<table\b/g)) {
      tables++;
      const before = src.slice(Math.max(0, m.index - 220), m.index);
      assert.match(before, /(\$\{WRAP\}|class="table-wrap" tabindex="0" role="region" aria-label="[^"]*"[^>]*>)\s*$/, `core/${f}: a <table at offset ${m.index} is not inside a focusable .table-wrap`);
    }
  }
  assert.ok(tables >= 5, `the table scan found only ${tables} tables; the walk is broken`);
  assert.match(read('core/exporters.js'), /const WRAP = `<div class="table-wrap" tabindex="0" role="region" aria-label="\$\{esc\(L\.tableScroll\)\}">`;/, 'WRAP stays a focusable labelled region');
}

// the baseline only shrinks: no critical or serious rule may be listed
const base = JSON.parse(read('tools/a11y-baseline.json'));
assert.deepEqual(Object.values(base).flat(), [], 'a11y baseline lists no rule');
console.log('  ok  test-a11y-static (T-060)');
