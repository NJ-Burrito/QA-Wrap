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
 * ── the language ──────────────────────────────────────────────────────────
 *
 * Every film exists as an English and an Arabic pair (run qaw-1109, decision D2). The page picks the file
 * by the interface language, `QAWi18n.lang()`, and the deep link's `?lang=ar|en` overrides it for that
 * visit. Nothing about the language is stored: change the interface language and the next press opens the
 * other file. `?t=<seconds>` beside `?v=` still names a chapter for the old in-page player.
 *
 * ── where a film plays ─────────────────────────────────────────────────────
 *
 * Films are hosted with the site (`site/media/`, tutorials in `site/media/tutorials/`), never packaged.
 * A press on a card opens the site file in a new tab; nothing loads before a press (3.6.7). The deep link
 * `?v=<id>` opens the details panel, whose "Watch online" link carries the same file.
 */

await QAWi18n.ready();

const $ = (id) => document.getElementById(id);
const t = (k, v) => QAWi18n.t(k, v);

/* Where every film is watched: hosted with the site, never packaged (T-048), opened in a new tab on a press (D2, qaw-1109). */
/** Films are hosted on the site (D2, qaw-1109). `lessons.json` names each file relative to the site's media folder, one per UI language. FILM_LIVE flips to false to take every film off the page without touching the manifest. */
const FILM_LIVE = true;
const MEDIA_URL = 'https://nj-burrito.github.io/QA-Wrap/media/';
const hostedUrl = (f) => (FILM_LIVE && f ? MEDIA_URL + f : ''); // the extension-page CSP allows only 'self' media and images, so a film is opened in a new tab, never loaded here
/** The film for the language in use, falling back to English when a language has no file. */
const fileOf = (lesson) => lesson.files[lang] || lesson.files.en;
const filmUrl = (lesson) => hostedUrl(fileOf(lesson));
/** The poster for the language in use, chosen like the film (an Arabic card never names an English poster). Only a path: the page fetches no poster (T-048). */
const posterOf = (lesson) => lesson.posters?.[lang] || lesson.poster || '';
/** The packaged banner for the language in use (`thumbs.ar` on an Arabic card), a local file beside this page, never remote. */
const thumbOf = (lesson) => lesson.thumbs?.[lang] || lesson.thumb || '';
const params = new URLSearchParams(location.search);

let lessons = [];
/** The deep link's `?lang=` wins for this visit; otherwise the interface language. */
const pickLang = () => (['ar', 'en'].includes(params.get('lang')) ? params.get('lang') : (QAWi18n.lang() === 'ar' ? 'ar' : 'en'));
let lang = pickLang();
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

/** The language in use: the interface's, or the deep link's `?lang=` for this visit. Nothing is stored. */
function paintLang() {
  lang = pickLang();
}

/**
 * The blurb, translated.
 *
 * `lessons.json` is written by `videos-tut/gen-lessons.mjs` from the film scripts, so it is not
 * hand-edited here. The title (`lesson.en`/`lesson.ar`) is a fixed bilingual pair shown together on
 * every card regardless of interface language. The blurb comes from this page's own i18n table when it
 * has a key for the lesson, and otherwise from the manifest's `{ en, ar }` pair.
 */
const blurbOf = (lesson) => {
  if (QAWi18n.has(`tutorials.lesson.${lesson.id}.blurb`)) return t(`tutorials.lesson.${lesson.id}.blurb`);
  return lesson.blurb?.[QAWi18n.lang() === 'ar' ? 'ar' : 'en'] || lesson.blurb?.en || '';
};

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
  // Nothing remote is fetched until a click: the tile is CSS and the lesson title (T-048). The one exception is a
  // thumbnail packaged beside this page (`lesson.thumb`, the hosted film's banner): a local file, never a remote one.
  if (thumbOf(lesson) && !lesson.pending) {
    const img = el('img', 'thumb');
    img.src = thumbOf(lesson);
    img.alt = '';
    img.decoding = 'async';
    poster.classList.add('has-thumb');
    poster.append(img, el('span', 'play-ring'));
  }
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
  if (!lesson.pending && posterOf(lesson)) card.dataset.poster = posterOf(lesson);
  if (lesson.pending) card.disabled = true;
  else {
    card.addEventListener('click', () => {
      const u = filmUrl(lesson);
      if (u && navigator.onLine) { window.open(u, '_blank', 'noopener'); return; }
      // Offline (or the films switched off): the details panel says why instead of opening a tab that cannot load.
      play(lesson);
      if (u) { const n = $('feature-offline'); n.hidden = false; n.textContent = t('tutorials.online.unreachable', { url: MEDIA_URL }); }
    });
  }
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

/**
 * The details panel for one film (the deep link `?v=<id>`; a card press opens the film itself in a new tab).
 *
 * It never loads media: the `<video>` stays hidden and sourceless, because the extension-page CSP allows
 * only 'self' media and the films live on the site. The "Watch online" link is the language's hosted file.
 */
function play(lesson) {
  open = lesson;
  const link = $('feature-online');
  const note = $('feature-offline');
  const href = filmUrl(lesson);
  $('feature-video').hidden = true;
  $('feature-empty').hidden = true;
  link.href = href || '#';
  link.hidden = !href;
  note.hidden = navigator.onLine;
  note.textContent = navigator.onLine ? '' : t('tutorials.online.offlineNote');
  $('feature-kind').textContent =
    lesson.kind === 'trailer' ? t('tutorials.feature.kindTrailer')
      : lesson.kind === 'category' ? t('tutorials.feature.kindCategory', { group: (groupOf(lesson.id) || lesson.en).toUpperCase() })
        : lesson.kind === 'tool' ? t('tutorials.feature.kindTool', { group: (groupOf(lesson.id) || t('tutorials.group.tool')).toUpperCase() })
          : t('tutorials.label.feature');
  $('feature-title').textContent = lesson.en;
  $('feature-blurb').textContent = blurbOf(lesson);
  const chips = $('feature-chips');
  chips.replaceChildren();
  chips.append(el('span', 'chip', dur(lesson.secs)));
  if (lang === 'en') chips.append(el('span', 'chip', t('tutorials.chip.narration')));
  chips.append(el('span', 'chip', lesson.ar));
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
  window.UQASound?.play('ui.open');
  const url = new URL(location.href);
  url.searchParams.set('v', lesson.id);
  url.searchParams.set('lang', lang);
  url.searchParams.delete('t');
  history.replaceState(null, '', url);
}

$('feature-close').addEventListener('click', () => {
  $('feature').hidden = true;
  open = null;
  window.UQASound?.play('ui.close');
});

/* The language follows the interface (QAWi18n.lang()); there is no switch on this page. A change of
   interface language re-renders below, so the next press opens the other file. */

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
  paintLang();
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
    if (lesson && !lesson.pending) play(lesson);
  }
  // Opening this page is the answer to the one-time pointer in the popup.
  try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ }
})();
