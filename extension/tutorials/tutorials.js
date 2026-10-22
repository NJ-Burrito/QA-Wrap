/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tutorials page: pick a film by its title, or a chapter by its tool.
 *
 * The list is `lessons.json`, written by the film pipeline when the films are
 * recorded, so the page and the recorder cannot disagree about what exists.
 *
 * ── the shape of the set, round 3 (research/63 §1) ─────────────────────────
 *
 * The page used to be two lists: six overview films, then sixteen tool films
 * as an index. Round 3 puts a fifth `kind` between them — `category` — one
 * film per popup group, carrying a chapter for each tool in that group. So the
 * page is now:
 *
 *   Start here    the commercial, then the five walkthroughs
 *   Capture …     one section per popup group: the group's own film with its
 *                 chapter list, then that group's short tool films underneath
 *
 * A chapter is `{ t, titleKey }` in `lessons.json`: `t` is where the chapter
 * starts in the DELIVERED film (the storyboard's own clock plus the 2 s poster
 * card the film opens on), and `titleKey` names the tool in the shared table —
 * `tools.<id>.label`, the same string the popup card carries, so the chapter
 * and the button it is about can never read differently in either language.
 * Clicking one seeks the player.
 *
 * ── a film that has not been recorded yet ──────────────────────────────────
 *
 * The four category films land in `tutorials/media/` after the page does. A
 * lesson marked `pending` has no file and no poster on disk, and the shipped
 * page does not draw it at all — no card, no chapter rail, and it is not
 * counted in any section's tally. The card used to render with a "coming"
 * chip; that promises a date the product cannot keep, so a film that is not
 * coming this week is simply not on the page. Its entry stays in
 * `lessons.json` because that file is the recorder's contract — chapters,
 * copy and clock are already written — and the day the master is encoded the
 * flag comes off and the section gains its film with nothing else to change.
 *
 * `cardFor` and `chapterList` still know the pending state: a lesson passed to
 * them renders without an `<img>` and without a player, so no route through
 * this file can point a `<video>` at a file that is not there.
 *
 * ── the language ───────────────────────────────────────────────────────────
 *
 * The films are English only. The Arabic narrations were recorded once and
 * withdrawn, and the five files shipped unreachable in every package for a
 * release afterwards. So `lang` defaults to `en`, and the language switch is
 * gone, because the buttons it bound to were removed from the markup.
 *
 * `lang` is kept rather than deleted: the deep link carries it
 * (`tutorials.html?v=the-tools&lang=en`, which is how Settings sends you
 * straight to a film), other pages build that link, and the films are meant to
 * be recorded in Arabic again. `?t=<seconds>` beside it opens on a chapter.
 */

await QAWi18n.ready();

const $ = (id) => document.getElementById(id);
const t = (k, v) => QAWi18n.t(k, v);

/**
 * Where every film is watched (T-048).
 *
 * No film is in the package: they are hosted with the product's site and loaded
 * when a person presses a card, so an update no longer re-ships 42 MB to every
 * install. `lessons.json` marks each recorded lesson `online: true`. When the
 * film cannot arrive (offline, a blocked host, a slow link) the page draws a
 * designed empty state beside the player instead of a dead video, and the
 * written tutorials stand in; a closed-network tester loses the films only.
 * S-07 (sdlc-1014): the films were removed and nothing loads remote media any more.
 */
const hostedUrl = () => ''; // S-07 (sdlc-1014): the films were removed and nothing loads remote media; the extension-page CSP (manifest) allows only 'self' media and images
const onlineUrl = (lesson) => hostedUrl(lesson.files[lang] || lesson.files.en);
/* The poster travels with its film. A hosted one that does not arrive leaves
   the tile the CSS already draws, which carries the title — better than a
   broken-image glyph, and the reason the <img> hides itself on error. */
const posterUrl = (lesson) => hostedUrl(lesson.poster);
const params = new URLSearchParams(location.search);

let lessons = [];
let lang = params.get('lang') || localStorage.getItem('qaw-tutorial-lang') || 'en';
let open = null;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A duration rounds to the nearest second; a seek point never rounds up past itself. */
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * The four groups the popup puts its tools in, the film that covers each, and
 * the short films for the tools inside it.
 *
 * A tester who found "Break a request" under Break in the popup has to find it
 * under Break here, so the order and the labels are `popup.js` `GROUPS`,
 * copied deliberately.
 *
 * Keyed by film id rather than carried in `lessons.json`, because the manifest
 * schema is a contract with the recorder (`research/33-film-bible.md` 7.5) and
 * a group is a fact about the popup, not about the film. An id this table does
 * not know still renders — a tool film under no group label, a category film
 * in no section — which is what a film for a tool added next week should do
 * until somebody adds the line.
 */
const GROUPS = [
  { key: 'tutorials.group.capture', film: 'cat-capture', ids: ['tool-photograph-the-page', 'tool-record-the-screen', 'tool-check-another-size', 'tool-mask-real-data'] },
  { key: 'tutorials.group.check', film: 'cat-check', ids: ['tool-check-accessibility', 'tool-check-page-speed', 'tool-check-the-links', 'tool-measure-code-coverage'] },
  { key: 'tutorials.group.design', film: 'cat-design', ids: ['tool-design-the-values', 'tool-try-nasty-values', 'tool-fill-the-form', 'tool-harvest-the-page', 'tool-copy-a-locator', 'tool-draw-the-flow'] },
  { key: 'tutorials.group.break', film: 'cat-break', ids: ['tool-break-a-request', 'tool-stress-the-layout'] },
];
/** The group label, translated. `null` for an id no group claims. */
const groupOf = (id) => {
  const g = GROUPS.find((x) => x.ids.includes(id) || x.film === id);
  return g ? t(g.key) : null;
};

/** `6 films · 2:08`, the arithmetic a section heading owes the reader. */
const tally = (list) => t(list.length === 1 ? 'tutorials.tally.one' : 'tutorials.tally.many', {
  n: list.length,
  time: mmss(list.reduce((n, l) => n + l.secs, 0)),
});

/**
 * One language, so nothing to paint.
 *
 * Kept as a function rather than deleted at every call site: the films are
 * meant to be recorded in Arabic again, and the deep link already carries a
 * `lang` parameter that other pages build.
 */
function paintLang() {
  try { localStorage.setItem('qaw-tutorial-lang', lang); } catch { /* no storage */ }
}

/**
 * The blurb, translated.
 *
 * `lessons.json` is generated from the storyboards, so it is not hand-edited
 * here. The title (`lesson.en`/`lesson.ar`) is a fixed bilingual pair shown
 * together on every card regardless of interface language; only the blurb —
 * English-only in the manifest — is looked up by lesson id in this page's own
 * table, English kept as the source of record.
 */
const blurbOf = (lesson) => t(`tutorials.lesson.${lesson.id}.blurb`);

/** The eyebrow above a card's title. Never a number. */
const labelFor = (lesson) => {
  if (lesson.kind === 'trailer') return t('tutorials.label.theProduct');
  if (lesson.kind === 'category') return t('tutorials.label.category');
  if (lesson.kind === 'tool') return (groupOf(lesson.id) || t('tutorials.group.tool')).toUpperCase();
  return t('tutorials.label.feature');
};

/**
 * One card.
 *
 * A `pending` lesson has no file on disk yet, so the card carries no `<img>`
 * and no play affordance and cannot be pressed: the poster slot is the ground
 * the CSS draws, with a "coming" chip where the play chip goes. The alternative
 * — render it and let the image 404 — is a console error on a page whose whole
 * subject is that the product does what it shows.
 */
function cardFor(lesson) {
  const card = el('button', 'card');
  card.type = 'button';
  if (lesson.pending) card.classList.add('is-pending');
  card.setAttribute('aria-label', lesson.pending
    ? t('tutorials.card.comingAria', { title: lesson.en })
    : t('tutorials.card.playAria', { title: lesson.en }));
  const poster = el('div', 'poster');
  // Nothing is fetched until a click: the tile is CSS and the lesson title, the poster arrives with the film (T-048).
  poster.append(
    el('span', lesson.pending ? 'play soon' : 'play', lesson.pending ? t('tutorials.card.coming') : t('tutorials.card.play')),
    el('span', 'dur', dur(lesson.secs))
  );
  const body = el('div', 'body');
  body.append(
    el('span', 'n', labelFor(lesson)),
    el('h3', null, lesson.en),
    el('span', 'ar', lesson.ar),
    el('p', null, blurbOf(lesson))
  );
  card.append(poster, body);
  if (lesson.pending) card.disabled = true;
  else card.addEventListener('click', () => play(lesson));
  return card;
}

/**
 * A category film's chapter list.
 *
 * Beside the card rather than inside it, because the card is a `<button>` and
 * a button inside a button is not markup any browser agrees about. `where`
 * says what a press does: on the page it opens the player at that second, in
 * the player it seeks the film already loaded.
 */
function chapterList(lesson, cls) {
  const list = el('ol', cls);
  for (const ch of lesson.chapters || []) {
    const title = t(ch.titleKey);
    const item = document.createElement('li');
    const b = el('button', 'ch');
    b.type = 'button';
    b.append(el('span', 'at', mmss(ch.t)), el('span', 'what', title));
    b.setAttribute('aria-label', t('tutorials.chapter.seekAria', { title, time: mmss(ch.t) }));
    if (lesson.pending) b.disabled = true;
    else b.addEventListener('click', () => play(lesson, ch.t));
    item.append(b);
    list.append(item);
  }
  return list;
}

/**
 * Two questions, answered in two shapes.
 *
 * **Start here** is watched in order: the commercial, then the five films that
 * walk through a session. **The four groups** are looked up: a tester who
 * wants one group watches its film and jumps to the tool inside it, and the
 * short single-tool films from round 2 stay underneath for the answer that
 * needs twenty seconds rather than two minutes.
 */
function render() {
  const host = $('cards');
  const groups = $('groups');
  host.replaceChildren();
  groups.replaceChildren();
  /* The one line that keeps an unrecorded film off the shipped page. Every
     list below is built from `shown`, so a pending lesson has no card, no
     chapter rail, and no share of a section's tally. */
  const shown = lessons.filter((l) => !l.pending);
  if (!shown.length) {
    const empty = el('div', 'empty');
    empty.append(
      el('p', null, t('tutorials.empty.notBuilt')),
      el('p', null, t('tutorials.empty.howTo'))
    );
    host.append(empty);
    $('start-head').hidden = true;
    return;
  }
  $('start-head').hidden = false;

  const byId = new Map(shown.map((l) => [l.id, l]));
  const start = shown.filter((l) => l.kind === 'trailer' || l.kind === 'feature');
  $('start-head').textContent = t('tutorials.startHere.headingWithTally', { tally: tally(start) });
  for (const lesson of start) host.append(cardFor(lesson));

  for (const group of GROUPS) {
    const film = byId.get(group.film);
    const tools = group.ids.map((id) => byId.get(id)).filter(Boolean);
    if (!film && !tools.length) continue;
    const name = t(group.key);
    const section = el('section', 'group');
    const head = el('h2', 'section-head', t('tutorials.section.headingWithTally', {
      name,
      tally: tally([film, ...tools].filter(Boolean)),
    }));
    section.append(head);

    if (film) {
      const wide = el('div', 'film-wide');
      wide.append(cardFor(film));
      const rail = el('div', 'rail');
      rail.append(
        el('p', 'rail-head', t('tutorials.chapters.heading')),
        chapterList(film, 'chapters')
      );
      wide.append(rail);
      section.append(wide);
    }
    if (tools.length) {
      section.append(el('p', 'sub-head', t('tutorials.tools.perGroup')));
      const grid = el('div', 'tool-cards');
      for (const lesson of tools) grid.append(cardFor(lesson));
      section.append(grid);
    }
    groups.append(section);
  }

  /* A film in the manifest that no group claims and that is not part of the
     opening run still has to be reachable, or the page quietly loses it. */
  const placed = new Set([...start.map((l) => l.id), ...GROUPS.flatMap((g) => [g.film, ...g.ids])]);
  const rest = shown.filter((l) => !placed.has(l.id));
  if (rest.length) {
    const section = el('section', 'group');
    section.append(el('h2', 'section-head', t('tutorials.section.headingWithTally', {
      name: t('tutorials.group.tool'),
      tally: tally(rest),
    })));
    const grid = el('div', 'tool-cards');
    for (const lesson of rest) grid.append(cardFor(lesson));
    section.append(grid);
    groups.append(section);
  }
}

/** The designed empty state: shown in place of the player when a hosted film cannot arrive. */
function setEmpty(on) {
  $('feature-empty').hidden = !on;
  $('feature-video').hidden = !!on;
}
window.addEventListener('online', () => { if (open?.online) play(open); });

/** `at` is a second inside the film: a chapter, or `?t=` on the deep link. */
function play(lesson, at = null) {
  open = lesson;
  const video = $('feature-video');
  const link = $('feature-online');
  const note = $('feature-offline');

  // An online film is still played in this same element — the browser streams
  // it — so the only difference a tester sees is the link beside it and, with
  // no network, a sentence instead of a spinner that never resolves. The poster
  // ships either way, so the card and the player look the same offline.
  if (lesson.online) {
    const href = onlineUrl(lesson);
    video.src = href;
    link.href = href;
    link.hidden = false;
    note.hidden = navigator.onLine;
    setEmpty(!navigator.onLine);
    note.textContent = navigator.onLine
      ? ''
      : t('tutorials.online.offlineNote');
  } else {
    // Not hosted: no lesson is packaged any more, so this branch is only a hand-edited manifest.
    video.removeAttribute('src');
    link.hidden = true;
    note.hidden = true;
    setEmpty(true);
  }
  video.poster = posterUrl(lesson);
  $('feature-kind').textContent =
    lesson.kind === 'trailer' ? t('tutorials.feature.kindTrailer')
      : lesson.kind === 'category' ? t('tutorials.feature.kindCategory', { group: (groupOf(lesson.id) || lesson.en).toUpperCase() })
        : lesson.kind === 'tool' ? t('tutorials.feature.kindTool', { group: (groupOf(lesson.id) || t('tutorials.group.tool')).toUpperCase() })
          : t('tutorials.label.feature');
  $('feature-title').textContent = lesson.en;
  $('feature-blurb').textContent = blurbOf(lesson);
  const chips = $('feature-chips');
  chips.replaceChildren();
  chips.append(el('span', 'chip', dur(lesson.secs)), el('span', 'chip', t('tutorials.chip.narration')), el('span', 'chip', lesson.ar));
  if (lesson.chapters?.length) {
    chips.append(el('span', 'chip', t(lesson.chapters.length === 1 ? 'tutorials.chapters.one' : 'tutorials.chapters.many', { n: lesson.chapters.length })));
  }
  const rail = $('feature-chapters');
  rail.replaceChildren();
  rail.hidden = !lesson.chapters?.length;
  if (lesson.chapters?.length) rail.append(chapterList(lesson, 'chapters'));
  $('feature').hidden = false;
  document.querySelectorAll('.card').forEach((c) => c.classList.remove('is-open'));
  // r9-08-3: a tester who asked for less motion gets the jump, not the glide.
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  $('feature').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  /* A seek before the file has any duration is dropped by the element, so the
     chapter is applied on the first metadata the browser reports. */
  if (at != null) {
    const seek = () => { try { video.currentTime = at; } catch { /* not seekable yet */ } };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }
  video.play().catch(() => {});
  window.UQASound?.play('ui.open');
  // `play()` resolving is not the same as the file arriving: a hosted film that
  // 404s or times out rejects on the element, not on the promise.
  video.onerror = () => {
    if (!open?.online) return;
    note.hidden = false;
    note.textContent = t('tutorials.online.unreachable', { url: '' });
    setEmpty(true);
  };
  video.onloadeddata = () => setEmpty(false);
  const url = new URL(location.href);
  url.searchParams.set('v', lesson.id);
  url.searchParams.set('lang', lang);
  if (at != null) url.searchParams.set('t', String(at));
  else url.searchParams.delete('t');
  history.replaceState(null, '', url);
}

$('feature-close').addEventListener('click', () => {
  $('feature-video').pause();
  $('feature').hidden = true;
  open = null;
  window.UQASound?.play('ui.close');
});

/* The language switch was here. Its `[data-lang]` buttons were taken out of
   tutorials.html when the films became English only, so the query matched
   nothing and the whole block was dead code that read as a working feature.
   `paintLang()` above still runs — it remembers the deep link's choice. */

/**
 * The theme button in this page's own bar.
 *
 * It was in the markup and wired to nothing: the popup and the settings page
 * each call `UQATheme.cycle()` from their own script, and this page, which was
 * only ever reached from inside Settings, never did. It stands on its own now,
 * so its own controls have to work.
 */
function paintTheme() {
  const btn = $('theme');
  if (!btn || !window.UQATheme) return;
  const state = window.UQATheme.describe();
  // Same as every other surface: the mode from `ui/theme.js`, the words from
  // the shared table, because that file answers in English for all of them.
  const mode = window.UQATheme.read?.() || 'system';
  const { label, next } = window.UQADom.themeWords(mode, state);
  btn.innerHTML = window.UQAIcon?.(`theme-${['light', 'dark'].includes(mode) ? mode : 'system'}`, { size: 16 }) || '';
  btn.title = next;
  btn.setAttribute('aria-label', t('tutorials.theme.ariaLabel', { label, next }));
}
$('theme')?.addEventListener('click', () => {
  window.UQATheme?.cycle();
  paintTheme();
});
paintTheme();

QAWi18n.onChange(() => {
  QAWi18n.apply();
  render();
  paintTheme();
  if (open) play(open);
});

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  paintLang();
  try {
    lessons = await (await fetch('lessons.json')).json();
  } catch {
    lessons = [];
  }
  render();
  const settings = await new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.result || {})));
  window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQAVfx?.configure({ enabled: settings.vfxEnabled !== false });
  window.UQAVfx?.wire();
  const wanted = params.get('v');
  if (wanted) {
    const lesson = lessons.find((l) => l.id === wanted);
    const at = Number(params.get('t'));
    if (lesson && !lesson.pending) play(lesson, Number.isFinite(at) && at > 0 ? at : null);
  }
  // Opening this page is the answer to the one-time pointer in the popup.
  try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ }
})();
