/* QA Wrap — popup: the tool wall, favourites, usage, theme and the menu (split from popup.js; classic script, same global scope). */
/* ---------------------------------------------------------- break-a-request */

const PRESETS = {
  500: { action: 'status', status: 500, body: '{"error":"Forced by QA Wrap"}', label: 'Server error (500)' },
  503: { action: 'status', status: 503, body: '{"error":"Forced by QA Wrap"}', label: 'Service unavailable (503)' },
  403: { action: 'status', status: 403, body: '{"error":"Forced by QA Wrap"}', label: 'Forbidden (403)' },
  404: { action: 'status', status: 404, body: '{"error":"Forced by QA Wrap"}', label: 'Not found (404)' },
  empty: { action: 'status', status: 200, body: '', label: 'Empty response' },
  slow: { action: 'delay', label: 'Slow response' },
  offline: { action: 'fail', label: 'Network failure' },
  // Modifiers: they change the request rather than replacing the response, so
  // the real call still happens and you see what the server actually did.
  redirect: { action: 'redirect', label: 'Redirected' },
  header: { action: 'headers', label: 'Header changed' },
  noauth: { action: 'headers', label: 'Authorization removed' },
};

// Each preset needs a different extra field, and showing all of them at once
// is how a five-control form becomes a nine-control one nobody reads.
const EXTRA_FIELD = {
  slow: 'break-delay-field',
  redirect: 'break-redirect-field',
  header: 'break-header-field',
};

$('break-preset').addEventListener('change', () => {
  const wanted = EXTRA_FIELD[$('break-preset').value];
  for (const id of new Set(Object.values(EXTRA_FIELD))) $(id).hidden = id !== wanted;
});

/**
 * Line art for each tool: the UI round 2 family (ui/icons.js, S2), loaded
 * before this file. Each TOOLS entry names its drawing as `icon`, copied from
 * the tool -> icon map in identity/icons/ui/icons.json, and toolRow() draws
 * `UQAIcons[tool.icon]`. The drawings inherit `currentColor`, so a tool that is
 * used, pressed or asleep draws its glyph in that state's own colour.
 */

/**
 * Every tool, with the sentence that explains it and the place it holds in the
 * test process.
 *
 * The explanation lives next to the thing it explains rather than in a glossary
 * at the bottom, because a glossary is a place people have to decide to visit.
 * Each is written for someone who has never used a QA tool: what it does, and
 * what they will get, in one breath and no jargon.
 *
 * `tool` is the id the session's usage log and the ISTQB model both use, and it
 * is not always the same as `action` — "Break a request" is an action that
 * opens a panel, and a rule armed from that panel is what actually counts as
 * having used it.
 */
const TOOLS = [
  {
    action: 'mask',
    tool: 'mask',
    icon: 'tool-mask',
    label: 'Mask real data',
    pin: true,
    toggle: true,
    one: 'Cover anything on the page so it never reaches a picture, a video or the report.',
    /*
     * E5, the copy audit. The old sentence opened "click anything on the page
     * (a name, a national number, a whole table column)", which reads as
     * fields, and the catalogue label had been "mask the names". It does not
     * mask names; it covers whole elements, whatever they hold, including
     * pictures. Saying so is not a detail: a tester who believes this masks
     * text will point it at a screenshot of a passport and be wrong.
     */
    what: 'Click any element on the page and a solid block covers the whole of it: a cell, a heading, a photograph, a chart, an embedded frame. Point at a table and every cell is covered separately. It stays covered through every navigation, in every screenshot and in the video, and the words underneath never reach the report or the clipboard.',
    why: 'Testing happens on staging systems full of real people. Without this, the first screenshot puts their records into a ticket anyone on the project can open. Click a covered block again to uncover it, or use "Uncover all on this page" on the bar at the top, which leaves the other tabs alone.',
  },
  {
    action: 'pick',
    tool: 'pick',
    icon: 'tool-pick',
    label: 'Copy a locator',
    options: 'pick-panel',
    optionsLabel: 'What the pick is for', optionsShort: 'Purpose',
    one: 'Point at anything and get the one line of code a test needs to find it again.',
    what: 'Click any button, field or link on the page and this copies the one line of code a test needs to find it again. Shift+click several, then press Enter, and all of them are copied at once, one per line.',
    why: 'Writing that line by hand is slow and easy to get wrong. This checks the line really does match one thing, and only one, before handing it over. Anything you have masked is refused: a locator built out of a covered name would put that name in a test file, which outlives the screenshot the mask was protecting.',
  },
  {
    action: 'api',
    tool: 'api',
    icon: 'tool-api',
    label: 'Send a request',
    options: 'api-panel',
    optionsLabel: 'What this is for, with an example', optionsShort: 'Example',
    // E12: "don't understand it, make it better". The card led with "opens a
    // page where you can write an API request by hand", which describes the
    // furniture and not the job. One line about the job now sits on the card,
    // and the panel carries a worked example.
    one: 'Call the site’s own API as the user who is logged in, without copying a token into another app.',
    what: 'Opens a page where you can write an API request by hand and send it from this browser, so the cookies the site has already set go with it. Method, URL, headers, body, environments with {{variables}}, and a short list of commands that run before it is sent. The endpoints this session already watched can be imported and re-sent with one header changed.',
    why: 'Checking an endpoint mid-flow usually means copying a token into a separate app and losing the session. This keeps the session: the request is authenticated the way the page is, the answer is on screen with its status, its time and its headers, and both go into the timeline and the Postman export beside the traffic the application made on its own.',
  },
  {
    action: 'diagram',
    tool: 'diagram',
    icon: 'tool-diagram',
    label: 'Draw the flow',
    one: 'Turn what you just did into a workflow diagram on one page.',
    what: 'Turns what you did so far into a workflow diagram on one A4 page: start, each step, a decision where the application answered, a red box where it failed, the end, with the user story beside it in Arabic.',
    why: 'A picture of the flow is what a product owner asks for and a tester never has time to draw. Every box and arrow can be moved, reworded and recoloured; the legend explains itself.',
  },
  {
    action: 'harvest',
    tool: 'harvest',
    icon: 'tool-harvest',
    label: 'Map the page',
    one: 'Read every control on the page into a page object a test suite can use.',
    what: 'Reads every button, link and field on the page and gives each one a locator that has been checked against the page, then writes a page map, a Playwright page object and a brief an AI can write tests from.',
    why: 'Writing a page object by hand is an afternoon of guessing selectors. This is that afternoon, done: every locator verified, every guess marked. The three files are in the report under Raw export. Anything you have masked is left out of all three.',
  },
  {
    action: 'autofill',
    tool: 'autofill',
    icon: 'tool-autofill',
    label: 'Fill the form',
    options: 'autofill-panel',
    optionsLabel: 'What it fills, and what it could not', optionsShort: 'Result',
    // E9: "design it better, it's trash". The card said what it fills and
    // nothing about what happened, so a run that filled nine fields and was
    // refused by two read exactly like a run that did nothing. The panel now
    // holds the result, field by field, and it is opened by the press.
    one: 'Fill every field at once with a value a tester would have chosen, and name what it could not.',
    what: 'Fills every field on the page with the value a tester would have chosen: a real-shaped phone number, an IBAN that passes its checksum, a date inside the allowed range, an amount between min and max, and in Arabic where the page is Arabic. It does not press submit.',
    why: 'A random word in every box gets a form submitted; a designed value gets it tested. Every field it filled, every field the page rejected and every field it left alone is listed under "Result" on this card, so a partial run is legible instead of looking like a failure.',
  },
  {
    action: 'links',
    tool: 'links',
    icon: 'tool-links',
    label: 'Check the links',
    one: 'Ask every link on the page whether it still answers.',
    what: 'Finds every link on the page and asks each one whether it still answers: broken, redirected, slow, or fine.',
    why: 'Dead links are the bug every visitor finds and no tester logs. Checked from the extension, so links to other sites are tested too, and the result goes into the session.',
  },
  {
    action: 'inject',
    tool: 'inject',
    icon: 'tool-inject',
    label: 'Try nasty values',
    options: 'inject-panel',
    optionsLabel: 'Which field, and how to clear it', optionsShort: 'Field',
    one: 'Point at any field and get the awkward values built for that exact field.',
    // E5: "pick a text box" was wrong the moment the picker learned to see a
    // dropdown, a radio, a tickbox, a slider and a rich-text editor.
    what: 'Press it and click any field: a text box, a dropdown, a radio, a tickbox, a date, a slider or a rich-text editor. The list offered is built for that field: very long text, Arabic, a date in the year 1800, an emoji, a value the dropdown does not offer, nothing at all.',
    why: 'Most bugs live at the edges. This gives you the edges without having to think them up. The field you pick stays picked and outlined until you clear it, so the next value goes where the last one went.',
  },
  {
    action: 'rtl',
    tool: 'rtl',
    icon: 'tool-rtl',
    label: 'Stress the layout',
    one: 'Flip the page right-to-left and lengthen every label, the way a translation would.',
    // E5: this said "about 40% longer" flatly, and 40 is only the default.
    // Settings takes it from 0 to 200, so a tester who had turned it up was
    // reading a number the tool was not using.
    what: 'Flips the whole page right-to-left and makes every label longer, the way a translation would: 40% longer to start with, and whatever Settings says after you change it.',
    why: 'Shows you which boxes will break when the app is translated, before a translator is ever hired. Anything that cuts text off gets outlined. Press it again to put the page back.',
    toggle: true,
  },
  {
    action: 'fineprint',
    tool: 'fineprint',
    icon: 'tool-fineprint',
    label: 'Check the fine print',
    one: 'Check the legal surface of the page: policies, consent, trackers, who is behind it.',
    what: 'Reads the legal surface of the page from what this session already captured: are the privacy, terms, cookie and refund pages there and reachable, was consent asked before anything was stored, does each form ask for consent and only what it needs, who else the page called, and whether there is a real business behind it.',
    why: 'Nine of the nineteen worries on every "will my site get sued" list are properties of the page, and none of them was checked anywhere in this product. Four more are questions no browser can answer, and those are filed as questions rather than ticked. Accessibility is not re-checked here: "Check accessibility" already does it in more depth.',
  },
  {
    action: 'a11y',
    pin: true,
    tool: 'a11y',
    icon: 'tool-a11y',
    label: 'Check accessibility',
    options: 'a11y-panel',
    optionsLabel: 'What the last scan found', optionsShort: 'Findings',
    // E14: "keeps pointing to the timeline for more details". The findings are
    // on this card now, each with a button that puts the element on screen.
    one: 'List what would stop somebody using this page with a screen reader or a keyboard.',
    what: 'Runs the same engine that Chrome DevTools uses, and lists what would stop someone using a screen reader or a keyboard.',
    why: 'Every rule it breaks is listed under "Findings" on this card, with the elements and a button that scrolls each one into view and rings it. The findings also go into the session, so they are in the report next to everything else, and the panel has a full rule list and 12 checks a machine cannot make.',
  },
  {
    action: 'perf',
    pin: true,
    tool: 'perf',
    icon: 'tool-perf',
    label: 'Check page speed',
    one: 'Measure how fast this page really drew and answered, logged in and mid-flow.',
    what: 'Measures how fast this page actually drew and responded, plus every request it made.',
    why: 'This reads the page as it is right now: logged in, mid-flow, on your real network. That is the number Lighthouse cannot give you.',
  },
  {
    action: 'shot',
    pin: true,
    tool: 'shot',
    icon: 'tool-shot',
    label: 'Take a screenshot',
    options: 'shot-panel',
    optionsLabel: 'Screenshot options', optionsShort: 'Format',
    one: 'Take a screenshot and keep it with the session.',
    what: 'Takes a picture of the page and keeps it with the session: either the part on screen, or the whole thing scrolled and stitched into one tall image.',
    why: 'A screenshot is the evidence that survives after the page has changed. The whole-page option is for long forms and reports, where the problem is usually below the fold.',
  },
  {
    action: 'record',
    pin: true,
    tool: 'record',
    icon: 'tool-record',
    label: 'Record the screen',
    id: 'record-tool',
    // The mic / sound / webcam choices live on this row now, behind its own
    // disclosure — they used to sit under the whole tool list, where they read
    // as settings for everything rather than options for this one thing.
    options: 'capture-panel',
    optionsLabel: 'Video options', optionsShort: 'Scope',
    one: 'Film this tab, or the whole screen, into a video kept with the session.',
    what: 'Films this tab into a video that is kept with the session. Open "Video options" on this row first if you want your microphone, the tab’s sound, or your webcam in it.',
    why: 'There is no time limit. It runs until you press stop, or the disk fills. Press it again to stop.',
    toggle: true,
  },
  {
    action: 'partitions',
    tool: 'blackbox',
    icon: 'tool-blackbox',
    label: 'Design the values',
    options: 'partitions-panel',
    optionsLabel: 'Partitions and boundaries', optionsShort: 'Values',
    // E7: the panel hands over a crosshair now instead of telling the tester to
    // have clicked into a field already.
    one: 'Point at a field and get the handful of values worth testing, and why each one.',
    what: 'Press "Pick a field" and click any field on the page. This reads what the field itself declares (its type, its minimum, its maximum, its options, whether it is required) and works out the distinct classes of input it has, plus the exact values on each edge.',
    why: 'Trying forty random values covers less than four chosen ones. This tells you which four, and names each one so you can say what you tested rather than that you "tried some things". It reads dropdowns, radios, tickboxes, sliders, file choosers and rich-text editors as well as text boxes.',
  },
  {
    action: 'coverage',
    tool: 'whitebox',
    icon: 'tool-whitebox',
    label: 'Measure code coverage',
    options: 'whitebox-panel',
    optionsLabel: 'Whether this page can be measured', optionsShort: 'Ready?',
    // E15: "not really working". It works where Chrome lets it and could not
    // say where that was, so a page it cannot measure looked like a broken
    // tool. The card now answers that question before it is pressed.
    one: 'Measure which of this page’s own JavaScript actually ran while you used it.',
    what: 'Measures which of the page’s own JavaScript actually ran while you used it, function by function.',
    why: 'Shows the code your test never reached. It uses Chrome’s debugger, so Chrome puts a bar across the top of the window while it runs. That is expected: it comes off the moment you press stop, and nothing is attached until you press start. "Ready?" on this card says in advance whether this page can be measured, and names the reason when it cannot.',
    toggle: true,
  },
  {
    action: 'viewport',
    tool: 'viewport',
    icon: 'tool-viewport',
    label: 'Check another size',
    options: 'viewport-panel',
    optionsLabel: 'Screen sizes', optionsShort: 'Sizes',
    one: 'Open this same page again in a real window at a phone, tablet or laptop size.',
    what: 'Opens this same page again in a new window at a real phone, tablet or laptop size. The new window carries the session on: it is awake there, and it is masked there if you have masked anything here.',
    why: 'A real window that really reflows, not a zoomed picture of this one. Most layout bugs are found here and need no other browser. What you find in it goes into the report under its own heading, Window sizes, so a phone-sized finding is never filed as though it happened on the desktop.',
  },
  {
    action: 'spec',
    tool: 'spec',
    icon: 'tool-spec',
    label: 'Reverse-engineer the spec',
    options: 'spec-panel',
    optionsLabel: 'Document format', optionsShort: 'Format',
    one: 'Read this page back as a draft specification, in Arabic and English.',
    what: 'Reads this page the way a specification would: every form and what it will accept, every button, where the links go, and the errors it is showing. Writes it up as requirements with acceptance criteria, Arabic and English.',
    why: 'Most software this old has no specification, and writing one from scratch is a fortnight. The page already declares half of it: what is required, what pattern a field takes, what the options are. This reads that back, marks what it had to guess, and leaves you editing a draft instead of starting one.',
  },
  {
    action: 'break-toggle',
    tool: 'break',
    icon: 'tool-break',
    label: 'Break a request',
    one: 'Make the site fail on purpose, then stop it failing without reloading anything.',
    what: 'Makes the site fail on purpose: a 500 error, a dead connection, a slow reply, or a request sent somewhere else entirely.',
    why: 'Lets you see how the app behaves when the server misbehaves, without needing anyone to break the server. Rules stack. "Stop breaking it" takes every rule off at once: the next request goes through normally, nothing reloads, and everything the broken requests already put in the session stays there.',
    expands: true,
  },
];

/** The syllabus model, fetched once at boot. Null until then. */
let model = null;
/** What this browser can actually do. Null until boot has asked. */
let capabilities = null;
/** Which tools this session has used: `{ [tool]: { count, firstAt, lastAt } }`. */
let used = {};
/** The usage log of the session that was last stopped, for the saved screen. */

/**
 * Every icon is the same 20x20 stroked drawing; only the paths differ. A map
 * rather than nine `setAttribute` lines, so the shared look is one thing to
 * change. Attributes, not properties: SVG presentation attributes are.
 */
const ICON_ATTRS = {
  viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
  'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [attr, value] of Object.entries(ICON_ATTRS)) svg.setAttribute(attr, value);
  svg.innerHTML = window.UQAIcons?.[name] || '';
  if (window.UQAIconMirror?.includes(name)) svg.classList.add('mirror');
  return svg;
}

/**
 * The tools, laid out as the test process rather than as a list of gadgets.
 *
 * A QA extension is normally a bag of buttons in whatever order they were
 * built, which leaves the tester to hold the process in their head. Grouping
 * them under the ISTQB test activities makes the same buttons answer a question
 * they could not answer before — what have I not done on this run yet — and it
 * costs nothing, because the mapping is real rather than invented.
 *
 * If the model cannot be fetched the tools still render, ungrouped. A missing
 * heading is a worse popup; a missing tool is a broken one.
 */
/**
 * The visible grouping: by what a tester is trying to do, in the order they
 * do it. The ISTQB activity each tool serves still lives in its help panel
 * and still drives the process meter — it is the syllabus name, not the
 * navigation. Grouping the list by syllabus made eleven equal rows under
 * seven headings a first-day tester had to decode before pressing anything.
 */
const GROUPS = [
  { id: 'capture', label: 'Capture', hint: 'Keep the evidence', tools: ['shot', 'record', 'viewport', 'mask'] },
  { id: 'check', label: 'Check', hint: 'Let the machine look', tools: ['a11y', 'perf', 'links', 'whitebox', 'fineprint'] },
  { id: 'design', label: 'Design', hint: 'Values, locators, the page map', tools: ['blackbox', 'inject', 'autofill', 'harvest', 'pick', 'diagram', 'spec', 'api'] },
  { id: 'break', label: 'Break', hint: 'Make it fail on purpose', tools: ['break', 'rtl'] },
];

/**
 * One group's heading, in the tester's language.
 *
 * The English above is the source of record: `core/tool-catalogue.json` copies it
 * for the right-click menu and `tools/test-context-menus.mjs` fails the moment
 * the two disagree, so the literal cannot move into a table.
 */
const groupLabel = (g) => tf(`popup.groups.${g.id}.label`, g.label);
const groupHint = (g) => tf(`popup.groups.${g.id}.hint`, g.hint);

/**
 * One tool's words, in the tester's language.
 *
 * `TOOLS` keeps its English for the same reason `GROUPS` does, and for two more:
 * `tools/test-tool-cards.mjs` measures the one-liner and audits the copy against
 * what the code does, both against the literal. The keys are built from the tool
 * id, which is why every one of them is listed in `popup.dynamic.json`.
 */
function localiseTool(source) {
  const id = source.tool;
  const pick = (field) => (source[field] == null ? source[field] : tf(`tools.${id}.${field}`, source[field]));
  return {
    ...source,
    label: pick('label'),
    one: pick('one'),
    what: pick('what'),
    why: pick('why'),
    optionsLabel: pick('optionsLabel'),
    optionsShort: pick('optionsShort'),
  };
}

/**
 * Favourites: the tools a tester keeps at the top (DESIGN-SPEC §1.7).
 *
 * One mode now, not Simple and Expert: every tool is on the rail, grouped, and
 * the starred ones sit above the groups in the order they were starred. The
 * default set is the five the old Simple mode showed (`pin: true` in TOOLS).
 * Stored per profile in `chrome.storage.sync`, and in `local` when sync is
 * unavailable. Popup-owned on purpose: settings.js is in the worker's boot
 * graph, and this adds nothing to it.
 */
const FAV_KEY = 'qawFavourites';
let favourites = TOOLS.filter((t) => t.pin).map((t) => t.tool);

async function loadFavourites() {
  for (const area of ['sync', 'local']) {
    try {
      const got = await chrome.storage[area].get(FAV_KEY);
      if (Array.isArray(got?.[FAV_KEY])) {
        favourites = got[FAV_KEY].filter((id) => TOOLS.some((t) => t.tool === id));
        return;
      }
    } catch { /* this area is unavailable; try the next */ }
  }
}

async function saveFavourites() {
  for (const area of ['sync', 'local']) {
    try {
      await chrome.storage[area].set({ [FAV_KEY]: favourites });
      return;
    } catch { /* sync refused (quota, policy): keep it on this machine */ }
  }
}

function toggleFavourite(id) {
  const at = favourites.indexOf(id);
  if (at === -1) favourites.push(id);
  else favourites.splice(at, 1);
  saveFavourites();
  const focused = document.activeElement?.closest?.('.tool-row, .fav-item');
  const key = focused?.dataset.tool || focused?.dataset.fav;
  renderTools();
  // The press moved nothing the tester was holding: focus returns to the same
  // star, wherever the row now sits.
  const again = key && document.querySelector(`.tool-row[data-tool="${key}"] .tool-star`);
  if (again) { rove(again.closest('.tool-row').querySelector('.tool')); again.focus(); }
}

/**
 * Paint what has and has not been used, this session.
 *
 * The question this answers is one every tester asks out loud — "did I already
 * check accessibility on this one, or am I thinking of the last run?" — and
 * until now the popup had no opinion, so the honest answer was to run it again.
 */
function paintUsage() {
  for (const row of document.querySelectorAll('.tool-row[data-tool]')) {
    const entry = used[row.dataset.tool];
    const count = entry?.count ?? 0;
    const state = row.querySelector('.tool-state');
    if (!state) continue;

    state.dataset.used = String(count > 0);
    state.textContent = count > 1 ? String(count) : '';
    state.title = count
      ? t(count === 1 ? 'popup.usage.usedOne' : 'popup.usage.usedMany', { n: count })
      : t('popup.usage.unused');
    row.classList.toggle('is-used', count > 0);
  }

  for (const group of document.querySelectorAll('.activity')) {
    const rows = [...group.querySelectorAll('.tool-row[data-tool]')];
    const done = rows.filter((r) => r.classList.contains('is-used')).length;
    group.classList.toggle('is-touched', done > 0);

    const meter = group.querySelector('.activity-meter');
    if (!meter) continue;
    meter.replaceChildren();
    for (let i = 0; i < rows.length; i++) {
      const pip = document.createElement('i');
      pip.className = i < done ? 'on' : '';
      meter.append(pip);
    }
    meter.setAttribute('aria-label', t('popup.usage.meter', { done, total: rows.length }));
  }

  paintTimelineLink();
}

/* ── the ⋯ menu: theme, language, the pages, the reporter ────────────── */

/**
 * Theme and language are choices in the ⋯ menu (research/56, round 2), not
 * buttons that cycle: the radios name all three states at once, so nobody has
 * to press through one they did not want to reach the one they did. The ids the
 * suites drive by survive: `#theme` and `#lang` are the two radio groups.
 */
function paintTheme() {
  const mode = window.UQATheme.read?.() || 'system';
  for (const row of document.querySelectorAll('[data-theme-choice]')) {
    row.setAttribute('aria-checked', String(row.dataset.themeChoice === mode));
  }
}

function paintLang() {
  const choice = QAWi18n.setting?.() || 'auto';
  for (const row of document.querySelectorAll('[data-lang-choice]')) {
    row.setAttribute('aria-checked', String(row.dataset.langChoice === choice));
  }
}

/*
 * A whole-surface change cross-fades through a view transition, and is simply
 * instant where there is none or where reduced motion asks for none (motion
 * catalogue #22). Colour itself never transitions.
 */
function withViewTransition(change) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduced) document.startViewTransition(change);
  else change();
}

const menu = $('more-menu');
const moreBtn = $('more');
const menuRows = () => [...menu.querySelectorAll('.menu-row:not(:disabled)')];

/**
 * Open or close the menu. While it is open, what it covers (the session, the
 * tools, the work pane) is `inert` — not merely covered — and focus stays in
 * the menu; the header and the session strip stay live (Lead rule, 27 Sept).
 * Esc, a choice or the toggle return focus to `#more`; a click outside closes
 * it without moving focus.
 */
function setMenu(open, { focus = 'first', restore = true } = {}) {
  if (!menu || !moreBtn) return;
  const was = !menu.hidden;
  menu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
  $('app-body').inert = open;
  if (open) {
    paintTheme();
    paintLang();
    menu.classList.remove('is-entering');
    void menu.offsetWidth;
    menu.classList.add('is-entering');
    const rows = menuRows();
    (focus === 'last' ? rows[rows.length - 1] : rows[0])?.focus();
  } else if (was && restore) {
    moreBtn.focus();
  }
}

moreBtn?.addEventListener('click', () => setMenu(menu.hidden));
moreBtn?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  setMenu(true, { focus: e.key === 'ArrowUp' ? 'last' : 'first' });
});
menu?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setMenu(false);
    return;
  }
  const rows = menuRows();
  const at = rows.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = rows[(at + 1) % rows.length];
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = rows[(at - 1 + rows.length) % rows.length];
  else if (e.key === 'Home') next = rows[0];
  else if (e.key === 'End') next = rows[rows.length - 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
});
// Light dismiss: a press anywhere else closes it, and focus stays where it went.
document.addEventListener('click', (e) => {
  if (menu.hidden || e.target.closest?.('#more-menu, #more')) return;
  setMenu(false, { restore: false });
});

menu?.addEventListener('click', async (e) => {
  const themeRow = e.target.closest('[data-theme-choice]');
  if (themeRow) {
    withViewTransition(() => {
      window.UQATheme.set?.(themeRow.dataset.themeChoice);
      paintTheme();
    });
    setMenu(false);
    return;
  }
  const langRow = e.target.closest('[data-lang-choice]');
  if (langRow) {
    setMenu(false);
    withViewTransition(() => QAWi18n.setLang(langRow.dataset.langChoice));
    return;
  }
  // Tutorials, Timeline and the reporter each carry their own handler; the
  // menu only gets out of the way first.
  if (e.target.closest('.menu-row')) setMenu(false, { restore: false });
});

/* ── the page's shape: the sheet, the strip, the icons ───────────────── */

// The header's glyphs, and every other static `data-icon`, from the one family.
for (const n of document.querySelectorAll('[data-icon]')) n.insertAdjacentHTML('afterbegin', window.UQAIcon?.(n.dataset.icon) || '');

const app = $('app');

/*
 * Two measured edges, written as custom properties on `.app`: the session
 * card's bottom (where the wide tool detail starts) and the
 * strip's height (where both end, and where the ⋯ menu stops). A
 * ResizeObserver rather than a guess, because the session card changes height
 * with every state and every language.
 */
(() => {
  if (!app || !window.ResizeObserver) return;
  const session = $('session');
  const strip = $('session-strip');
  const head = $('app-head');
  const measure = () => {
    const stripH = strip && strip.offsetParent ? strip.offsetHeight : 0;
    const top = session && session.offsetHeight ? session.offsetTop + session.offsetHeight : head.offsetTop + head.offsetHeight;
    app.style.setProperty('--strip-h', `${stripH}px`);
    app.style.setProperty('--work-top', `${Math.round(top)}px`);
  };
  const ro = new ResizeObserver(measure);
  for (const n of [app, session, strip]) if (n) ro.observe(n);
  measure();
})();
