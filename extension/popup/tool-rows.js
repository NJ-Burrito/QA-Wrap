/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The tool rows: renderTools, the favourites, the stamped option panels, toolRow. A sibling of popup.js on the same global scope, loaded before it; nothing here runs at load except the two keyboard listeners. */
/**
 * Why the option panels are stamped from a <template>, and never moved.
 *
 * Two designs were on the table. This is the second: each tool with options
 * owns a `<template>` in popup.html, and `toolRow()` stamps a fresh copy of it
 * into the row at creation time. The first — leaving the four panels where
 * they are in the document and pulling them under the open row with CSS
 * `order` — would have worked, but it keeps the panels as four singleton
 * elements that a dozen readers can still reach by global id, so it papers
 * over the same class of bug rather than removing it.
 *
 * Stamping removes the class of bug outright. Nothing is moved, so nothing can
 * be moved out of the document; nothing is parked, so the parking div is gone;
 * and because a panel now exists only inside the row that owns it, the only
 * way to reach one is `panelFor(tool)` — which answers `null` for a tool that
 * is not on screen instead of handing back a stale element or throwing.
 *
 * The cost is that a fresh panel is a blank panel, so anything that used to
 * survive a render because the element itself survived has to be painted
 * again: the capture ticks from `settings`, the scope radios from `scopes`,
 * the viewport sizes and the last partition reading from what they remember.
 * That is the work at the bottom of this function.
 */
function renderTools() {
  const host = $('tools');
  host.replaceChildren();
  const byId = (id) => TOOLS.find((t) => t.tool === id);

  // Favourites first, in the order they were starred. Each is a way to the
  // real row's press, not a second row: `[data-action]` stays one element per
  // tool, which is what every suite and film clicks.
  const favs = favourites.map(byId).filter(Boolean);
  const fav = el('section', 'favourites');
  const favHead = el('h3', 'fav-head');
  favHead.append(el('span', 'activity-label', t('popup.rail.favourites')));
  fav.append(favHead);
  if (favs.length) {
    const list = el('div', 'fav-list');
    for (const tool of favs) list.append(favItem(tool));
    fav.append(list);
  } else {
    fav.append(el('p', 'fav-empty fine', t('popup.rail.favouritesEmpty')));
  }
  host.append(fav);

  // A tool that is in TOOLS but in no group used to vanish without a word —
  // which is how masking shipped and was invisible. Anything ungrouped lands
  // here instead, where it is obviously misfiled rather than obviously absent.
  const grouped = new Set(GROUPS.flatMap((g) => g.tools));
  const orphans = TOOLS.filter((t) => t.tool && !grouped.has(t.tool)).map((t) => t.tool);
  const groups = orphans.length
    ? [...GROUPS, { id: 'other', label: tf('popup.groups.other.label', 'Not yet filed'), hint: tf('popup.groups.other.hint', 'These belong in a group above'), tools: orphans }]
    : GROUPS;
  for (const g of groups) {
    const tools = g.tools.map(byId).filter(Boolean);
    if (!tools.length) continue;
    const group = document.createElement('section');
    group.className = 'activity';
    group.dataset.activity = g.id;
    const head = document.createElement('h3');
    head.className = 'activity-head';
    head.append(el('span', 'activity-label', groupLabel(g)), el('span', 'activity-hint', groupHint(g)));
    const meter = el('span', 'activity-meter');
    meter.setAttribute('role', 'img');
    head.append(meter);
    group.append(head);
    const tiles = el('div', 'tiles');
    for (const tool of tools) tiles.append(toolRow(tool));
    group.append(tiles);
    host.append(group);
  }

  const count = $('tool-count');
  if (count) count.textContent = String(TOOLS.length);
  foldTools(host);
  rove(roveItems()[0]);

  paintUsage();
  // Every panel in the list is brand new, so everything that lives in one is
  // painted again from what it is derived from. paintFromSettings() covers the
  // capture ticks and the shortcut chips; these two cover the answers the
  // worker gave once and will not be asked for again.
  paintFromSettings();
  renderViewports();
  paintPartitions();
  paintCommandChips();
  // Fresh rows are enabled rows until the switch has its say. See gateControls().
  gateControls();
  // And the recording state, which a fresh Record row does not carry: the
  // button's label, its pressed state and the lock on the capture inputs are
  // all painted, not stored. Skipped during boot, where refresh() is about to
  // do it anyway and two more round trips are two more on the critical path.
  if (document.body.dataset.ready === 'true') paintRecording();
}

/** The real row's press, from a favourite: one tool, one button, one handler. */
function pressTool(id) {
  document.querySelector(`.tool-row[data-tool="${id}"] .tool`)?.click();
}

/** A star: keep this tool at the top. The same state wherever it is drawn. */
function starButton(tool) {
  const on = favourites.includes(tool.tool);
  const star = el('button', 'tool-star');
  star.type = 'button';
  star.tabIndex = -1;
  star.setAttribute('aria-pressed', String(on));
  star.setAttribute('aria-label', t('popup.rail.star', { label: tool.label }));
  star.title = star.getAttribute('aria-label');
  star.append(icon(on ? 'star-filled' : 'star'));
  star.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavourite(tool.tool);
  });
  return star;
}

function favItem(source) {
  const tool = localiseTool(source);
  const item = el('div', 'fav-item');
  item.dataset.fav = tool.tool;
  const run = el('button', 'fav-run');
  run.type = 'button';
  run.tabIndex = -1;
  // The one-liner is the tooltip; the row itself carries no description (§1.8).
  run.title = tool.one;
  run.append(icon(tool.icon), el('span', 'fav-name', tool.label));
  run.addEventListener('click', () => pressTool(tool.tool));
  item.append(run, starButton(tool));
  return item;
}

/*
 * One tab stop for the whole list (DESIGN-SPEC §6): the arrow keys move
 * between rows, Tab goes on to that row's star and chevron, then leaves.
 */
const roveItems = () => [...($('tools')?.querySelectorAll('.fav-run, .tool-row > .tool') || [])];
function rove(target) {
  const host = $('tools');
  if (!host) return;
  for (const b of roveItems()) b.tabIndex = b === target ? 0 : -1;
  for (const b of host.querySelectorAll('.tool-star, .tool-more')) b.tabIndex = -1;
  const holder = target?.closest('.tool-row, .fav-item');
  for (const b of holder?.querySelectorAll(':scope > .tool-star, :scope > .tool-bar > .tool-star, :scope > .tool-bar > .tool-more') || []) b.tabIndex = 0;
}
document.getElementById('tools').addEventListener('focusin', (event) => {
  if (roveItems().includes(event.target)) rove(event.target);
});
document.getElementById('tools').addEventListener('keydown', (event) => {
  const items = roveItems().filter((b) => b.offsetParent);
  const at = items.indexOf(event.target);
  if (at === -1) return;
  const list = event.target.closest('.tiles, .fav-list');
  const cols = list ? (getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1) : 1;
  const rtl = document.documentElement.dir === 'rtl';
  const step = {
    ArrowDown: cols,
    ArrowUp: -cols,
    ArrowRight: cols > 1 ? (rtl ? -1 : 1) : 0,
    ArrowLeft: cols > 1 ? (rtl ? 1 : -1) : 0,
  }[event.key];
  let next = null;
  if (step) next = items[at + step];
  else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items[items.length - 1];
  if (!next) return;
  event.preventDefault();
  rove(next);
  next.focus();
});

/**
 * A fresh copy of this tool's option panel, cut from its template.
 *
 * `tool.options` is the panel's id — kept because the disclosure names it in
 * `aria-controls`, and because the suites open the popup and look for it — and
 * the template that holds the markup is `tpl-` plus that id. Nothing reads the
 * id from popup.js: `panelFor()` goes through the row.
 *
 * A missing template returns null rather than throwing, and the caller then
 * draws no disclosure at all. That is the honest shape: a chevron that opens
 * nothing is worse than no chevron.
 */
function stampPanel(tool) {
  if (!tool.options) return null;
  const tpl = $(`tpl-${tool.options}`);
  const source = tpl?.content?.firstElementChild;
  if (!source) return null;

  const panel = source.cloneNode(true);
  panel.hidden = true;
  // The clone comes out of a <template>, which QAWi18n.apply() never walks
  // because template content is not in the document. Filled in here, once, so a
  // panel stamped after a language change is stamped in that language.
  QAWi18n.apply(panel);

  // The scope the tester last chose. A stamped panel starts at the template's
  // default, and losing "Window or screen" because somebody pressed Expert
  // would be a new bug rather than a preserved behaviour.
  for (const radio of panel.querySelectorAll('input[type="radio"][name]')) {
    if (radio.name in scopes) radio.checked = radio.value === scopes[radio.name];
  }

  // Wired here, at creation, for the same reason the tool buttons are
  // delegated: boot() used to attach this to an element that boot() could see,
  // and every render after the first replaced that element with another one
  // nobody had wired.
  panel.querySelector('#partitions-read')?.addEventListener('click', readPartitions);
  panel.querySelector('#partitions-clear')?.addEventListener('click', clearPickedField);
  // E8's reset is the same reset: one picked field, two tools that read it.
  panel.querySelector('#inject-clear')?.addEventListener('click', clearPickedField);
  // Copy a locator's four purposes: each starts the crosshair in that mode,
  // and the popup gets out of the way exactly as the tool's own button does.
  for (const b of panel.querySelectorAll('[data-pick-purpose]')) {
    b.addEventListener('click', async () => {
      const ok = await toolResult(await send({ type: 'UQA_PICK', tabId: ctx.tabId, purpose: b.dataset.pickPurpose }));
      if (ok) dismiss();
    });
  }

  // The three panels that show a result rather than take a choice are painted
  // from what the popup already knows, for the same reason the partitions and
  // the viewport list are: a stamped panel is a blank one, and the answer was
  // given to the popup, not to the element.
  if (tool.tool === 'autofill') paintAutofill(panel);
  if (tool.tool === 'a11y') paintA11y(panel);
  if (tool.tool === 'whitebox') paintCoverageReadiness(panel);

  return panel;
}

/**
 * The capture chips say what the browser has already refused.
 *
 * `UQA_MEDIA_PERMISSIONS` asks the offscreen document what the platform will
 * actually grant. A `denied` device cannot be talked round from here — Chrome
 * only takes that answer back on its own settings page — so the chip is
 * disabled and says where to change it, rather than being tickable and then
 * silently absent from the clip. Anything that is not a flat `denied` is left
 * alone: `prompt` is a question the browser will ask when recording starts,
 * which is the state the chips were built for.
 */
async function paintMediaPermissions(panel) {
  const host = panel || panelFor('record');
  if (!host) return;
  const res = await send({ type: 'UQA_MEDIA_PERMISSIONS' });
  const states = res?.ok ? res.result || {} : {};
  // Mic and camera only: tab sound is not a device, it needs no grant, and
  // `mediaPermissions()` has nothing to say about it (background/media.js:131).
  for (const [id, device] of [['cap-mic', 'microphone'], ['cap-webcam', 'camera']]) {
    const box = host.querySelector(`#${id}`);
    if (!box) continue;
    const denied = states[device] === 'denied';
    box.disabled = denied;
    const chip = box.closest('.chip');
    if (chip) {
      chip.title = denied ? t('popup.capture.deniedChip') : '';
      chip.classList.toggle('is-denied', denied);
    }
    if (denied) box.checked = false;
  }
}

/**
 * A tool's options panel opens, and closes when the tester looks elsewhere.
 *
 * These are disclosures on a card, not dialogs: opening Format, Scope, Sizes,
 * Values or the video options and then going back to the wall left the form
 * standing open behind every scroll, and a popup 392px wide cannot afford two
 * of them. So one is open at a time, a click anywhere outside closes it, and
 * Escape closes it — the three ways a person expects to dismiss something they
 * did not commit to.
 *
 * `panel.hidden` stays the state, `.tool-bar`, `.tool-more` and
 * `aria-expanded` stay exactly where the suites read them: nothing here is a
 * new mechanism, it is the same toggle with the two ways out that were missing.
 */
function setToolPanel(row, more, panel, open) {
  // The detail (what it does, the explainer, the options) opens as one:
  // DESIGN-SPEC §1.8, the single tools one level deeper.
  const help = row.querySelector('.tool-help');
  if (help) help.hidden = !open;
  if (panel) panel.hidden = !open;
  more.setAttribute('aria-expanded', String(open));
  row.classList.toggle('is-open', open);
  row.classList.toggle('has-options-open', open && !!panel);
  if (open) fitIntoView(row);
  // break-panel lives in `.work`, outside the rows: opening a row closes it (setBreakPanel).
  if (open) setBreakPanel(false, false);
  // The explainer plays while it is in view, twice, then rests (S3).
  if (open && help) window.UQAScenes?.play?.(help);
}

/**
 * Break a request is the one panel that lives in `.work`, not stamped into a row. This is the only place that opens or closes it, so
 * the row, the Back button and Escape agree and the Tools list is never left behind it (the 15 Oct "stuck on the panel" fault).
 */
function setBreakPanel(open, focus = true) {
  const panel = document.getElementById('break-panel');
  if (!panel || panel.hidden === !open) return;
  panel.hidden = !open;
  const toggle = document.querySelector('[data-action="break-toggle"]');
  toggle?.setAttribute('aria-expanded', String(open));
  if (focus) (open ? document.getElementById('break-back') : toggle)?.focus();
}
document.getElementById('break-back')?.addEventListener('click', () => setBreakPanel(false));

/** The element that actually scrolls this one, at the current width. */
function scrollerOf(node) {
  for (let n = node?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Bring the card and everything it just unfolded into view together.
 *
 * E3: "expanding a feature card's options auto-scrolls so the card and its
 * expansion fit the view". This measures first and moves only by the amount
 * that is actually missing, and never at all when nothing is. The scroller is
 * whichever one holds the row at this width: the page body at 440-719, the
 * sheet below it, the rail above it.
 *
 * Measured on the next frame, because the panel is unhidden in the same turn
 * and has no height until the browser has laid it out.
 */
function fitIntoView(row) {
  if (!row) return;
  requestAnimationFrame(() => {
    const scroller = scrollerOf(row);
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const card = row.getBoundingClientRect();
    let delta = 0;
    if (card.bottom > view.bottom) delta = card.bottom - view.bottom + 16;
    if (card.height > view.height || card.top - delta < view.top) delta = card.top - view.top - 16;
    if (Math.abs(delta) < 2) return;
    // No stylesheet can reach a JS `behavior` option, so reduced motion has
    // to be read here directly (F12).
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
  });
}

/** Close every open tool detail, except the one the caller is about to open. */
function closeToolPanels(keep = null) {
  for (const row of document.querySelectorAll('.tool-row.is-open')) {
    const panel = row.querySelector('.opts-tool');
    if (keep && panel === keep) continue;
    const more = row.querySelector('.tool-more');
    if (more) setToolPanel(row, more, panel, false);
  }
}

/*
 * Outside means outside: not the panel, and not the control that opened it.
 *
 * On `click` in the capture phase, NOT `pointerdown`: closing a panel reflows the
 * list, so a control that moved between press and release never got its click
 * (the first press did nothing; see the Awake card fold). A capture-phase click has
 * already fixed its target, so the control under the press still fires.
 */
document.addEventListener('click', (event) => {
  const inPanel = event.target.closest?.('.opts-tool, .tool-help');
  const onControl = event.target.closest?.('.tool-more');
  if (!inPanel && !onControl) closeToolPanels();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Only when one is actually open, so Escape keeps meaning whatever it means
  // to the dialog, the palette or the browser when it is not.
  const breakOpen = !document.getElementById('break-panel')?.hidden;
  if (!document.querySelector('.tool-row.is-open') && !breakOpen) return;
  const open = document.querySelector('.tool-row.is-open .tool-more');
  closeToolPanels();
  if (breakOpen) setBreakPanel(false);
  else open?.focus();
});

/**
 * Tools the browser gates behind its own prompt.
 *
 * Nothing is wrong with these — the browser is required to ask, and until the
 * tester answers, the extension is holding still. Without a mark on the card
 * that is indistinguishable from a button that does nothing, which is exactly
 * how screen recording was read.
 *
 * The mark is quiet, and that is the point. `record` is a permanent member of
 * this set, so its card carried the amber warning dot on **every** first open,
 * beside fifteen green ones — in a wall shot whose whole argument is "sixteen
 * tools, all ready". "The browser asks permission first" is information: it is
 * true before anything has happened, it needs no decision, and nothing is
 * wrong. Amber is now spent only where something a tester must act on has
 * actually happened: a grant refused after a press (`data-health="warned"`
 * below), or storage running out. The sentence on the card is unchanged; only
 * its colour is, because the colour was making a claim the sentence never did.
 */
const ASKS_FIRST = new Set(['recordScreen', 'record', 'mic', 'webcam']);

function toolRow(source) {
  const tool = localiseTool(source);
  const row = document.createElement('div');
  row.className = 'tool-row';
  row.dataset.tool = tool.tool;

  const run = document.createElement('button');
  run.className = 'tool';
  run.tabIndex = -1;
  run.dataset.action = tool.action;
  if (tool.id) run.id = tool.id;
  if (tool.toggle) run.setAttribute('aria-pressed', 'false');
  if (tool.expands) run.setAttribute('aria-expanded', 'false');

  const glyph = el('span', 'tool-icon');
  // The tile's drawing. Keyed by tool id, falling back to the action name,
  // because three tools (blackbox, whitebox, break) draw under their action.
  // This call was lost in the E4 card rewrite and every tile was an empty square.
  glyph.append(icon(tool.icon));
  // The name only: the one-liner is the tooltip and the rest is one level
  // deeper (DESIGN-SPEC §1.8). A column, so a long name wraps alone.
  const text = el('span', 'tool-text');
  const name = el('span', 'tool-name', tool.label);
  text.append(name);
  // The one-liner is the row's tooltip (DESIGN-SPEC §1.8): a two-line clamp is
  // what clipped 17 of 19 of them. The whole explanation is one level deeper.
  if (tool.one) run.title = tool.one;

  // The used/unused mark. A ring when it has not been used on this run, a tick
  // when it has, and a number once it has been used more than once — because
  // "I took a screenshot" and "I took eleven" are different states of a session.
  const state = el('span', 'tool-state');
  state.dataset.used = 'false';

  // Whether the tool can run at all, said on the card rather than discovered
  // by pressing it. `ready` is the quiet default; the two that matter are
  // `blocked` (this browser cannot) and `asks` (the browser will put up its
  // own permission prompt, which is why screen recording looks like it does
  // nothing until you answer it).
  const health = el('span', 'tool-health');
  health.dataset.health = 'ready';

  const key = document.createElement('kbd');
  // Name, then shortcut, then state — in that order, so the used-mark lands at
  // the same x on every row. With the state in the middle, a row with a
  // shortcut and a row without lined up differently and the column read as
  // ragged.
  run.append(glyph, text, key, health, state);

  // One disclosure per row: the chevron opens the detail (what it does, the
  // explainer and the tool's options). It keeps both class names the suites
  // drive it by: `.tool-info` for the help, `.tool-more` for the options.
  const more = document.createElement('button');
  more.className = 'tool-info tool-more';
  more.type = 'button';
  more.tabIndex = -1;
  more.append(icon('chevron-end'));
  more.setAttribute('aria-expanded', 'false');
  more.title = t('popup.tools.infoTitle', { label: tool.label });
  more.setAttribute('aria-label', t('popup.tools.infoAria', { label: tool.label }));

  const help = document.createElement('div');
  help.className = 'tool-help';
  help.id = `help-${tool.tool}`;
  help.hidden = true;
  more.setAttribute('aria-controls', tool.options || help.id);
  // The head is drawn where the detail stands apart from its row (the wide
  // work pane); its close button is the same toggle.
  const head = el('div', 'detail-head');
  const title = el('h2', 'detail-title', tool.label);
  title.tabIndex = -1;
  const close = el('button', 'icon-btn detail-close');
  close.type = 'button';
  close.setAttribute('aria-label', t('common.close'));
  close.title = t('common.close');
  close.append(icon('close'));
  close.addEventListener('click', () => { setToolPanel(row, more, panel, false); more.focus(); });
  const headIcon = el('span', 'tool-icon');
  headIcon.append(icon(tool.icon));
  // Below 440 the detail is a view of its own inside the sheet; this is its way back.
  const back = el('button', 'detail-back');
  back.type = 'button';
  back.append(icon('back'), el('span', '', t('popup.tools.allTools')));
  back.addEventListener('click', () => { setToolPanel(row, more, panel, false); more.focus(); });
  head.append(back, headIcon, title, close);
  help.append(head);
  // The picture first: the burrito doing what the tool does. A first-day
  // tester reads it before the sentence; an expert never has to look at it.
  const sceneSvg = window.UQAScenes?.svg(tool.tool || tool.action);
  if (sceneSvg) {
    const scene = el('div', 'tool-scene');
    scene.innerHTML = sceneSvg; // our own SVG strings from ui/scenes.js, never page content
    help.append(scene);
  }
  // No paragraphs on the panel: what it does and why sit behind one disclosure (ADHD rule 10).
  const about = el('details', 'tool-about');
  about.append(el('summary', '', t('popup.tools.about')), el('p', 'tool-what', tool.what), el('p', 'tool-why', tool.why));
  help.append(about);

  // What this is called in the syllabus. A tester who can name the technique
  // can defend the test in a review; one who only knows "the nasty values
  // button" cannot.
  // A tool this browser cannot run is disabled here and explained in its own
  // help panel, rather than left to fail when pressed. `permanently` matters:
  // paintSwitch() re-enables everything on wake, and it must not undo this.
  const blocked = capabilities && tool.tool ? capabilities.disabled.includes(tool.tool) : false;
  if (ASKS_FIRST.has(tool.tool)) {
    health.dataset.health = 'asks';
    // The English literal stays on this assignment because
    // tools/test-popup-structure.mjs reads it here, character for character, as
    // the sentence that explains the quiet mark. The table wins on the next line.
    health.title = 'The browser asks permission first. Answer its prompt and this runs.';
    health.title = tf('popup.tools.asksFirst', health.title);
  }
  // Recording this tab is the one tool Chrome can refuse for a reason the
  // tester cannot see: `activeTab` is granted by invoking the extension and
  // revoked by the next navigation. Ask now, so the card can say so while
  // there is still time to do something about it, instead of failing on press.
  if (tool.tool === 'record') {
    send({ type: 'UQA_CAN_RECORD', tabId: ctx.tabId }).then((res) => {
      if (!res?.ok || res.result?.can) return;
      const { shortcut } = res.result;
      health.dataset.health = 'asks';
      health.title = shortcut
        ? t('popup.tools.invokeShortcut', { shortcut })
        : t('popup.tools.invoke');
      /*
       * The mark, and nothing else. Removed 8 September 2026: "remove the
       * yellow notification on the screen recording".
       *
       * There used to be an amber-backed paragraph on the card here, plus
       * `data-needs-invoke` to paint the card's border amber with it. Three
       * things were wrong with it and only the third is cosmetic.
       *
       * It was **not true of half of what the card does**. `activeTab` is what
       * a *tab* capture needs; a window or screen capture goes through
       * `getDisplayMedia` and needs nothing of the kind. One card runs both, so
       * a tester who had chosen "Window or screen" was warned about a
       * limitation that could not touch them.
       *
       * It was **not actionable**: the cure is to press the very button the
       * warning is drawn on, and pressing it works — invoking the extension is
       * what grants `activeTab`, so the warned-about press is the fix.
       *
       * And it was **always there**: on a fresh profile it is the first thing
       * on screen, in both modes, which is how a warning stops being read.
       *
       * The fact itself is kept, in the place a fact of that size belongs: the
       * quiet health mark on the card and its tooltip, which is `title` above.
       * Nothing legal or consent-bearing was in it — the one line that is, the
       * microphone notice, is a separate element in popup.html and untouched.
       */
    }).catch(() => { /* the worker is asleep; the press will explain */ });
  }
  if (blocked) {
    health.dataset.health = 'blocked';
    health.title = t('popup.tools.blocked', { browser: capabilities.browser });
  }
  if (blocked) {
    run.disabled = true;
    run.dataset.unavailable = 'true';
    row.classList.add('is-unavailable');
    const blocker = capabilities.missing.find((m) => m.powers.includes(tool.tool));
    help.append(
      el(
        'p',
        'tool-unavailable',
        t('popup.tools.blockedWhy', { browser: capabilities.browser, instead: blocker?.instead || '' })
      )
    );
  }

  const meta = model?.tools?.[tool.tool];
  if (meta) {
    const line = el('p', 'tool-istqb');
    line.append(el('span', 'tool-technique', meta.technique));
    if (meta.testType) line.append(el('span', 'tool-type', meta.testType));
    about.append(line);

    const principle = model.principles?.find((p) => p.id === meta.principle);
    if (principle) {
      about.append(el('p', 'tool-principle', t('popup.tools.principle', {
        n: principle.n,
        title: principle.title,
        plain: principle.plain,
      })));
    }
  }

  // A tool with its own options stamps them into its detail, under the
  // explanation — not at the bottom of the list, where "Mic / Webcam" read as
  // settings for the whole extension.
  const panel = stampPanel(tool);
  if (panel) help.append(panel);

  more.addEventListener('click', () => {
    const open = help.hidden;
    // One at a time. Two open at once turned the wall into a column of forms.
    if (open) closeToolPanels(panel);
    setToolPanel(row, more, panel, open);
  });

  // The secondary controls share one bar beside the button: a button may not
  // contain a button.
  const bar = el('div', 'tool-bar');
  bar.append(starButton(tool), more);
  row.append(run, bar);
  row.append(help);
  return row;
}
