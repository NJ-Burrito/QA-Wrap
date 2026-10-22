/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

// The Seam: one brand banner in this panel's own console (platform/console-brand.js; never the tested page's).
try { globalThis.QAConsole?.banner('devtools panel'); } catch { /* decoration */ }

/**
 * A count and its noun, agreeing.
 *
 * Top level, because this file is a plain script: `audit.js` loads beside it on
 * the same global and wraps itself in an IIFE precisely so its own `const $`
 * cannot collide with this one. A helper declared out here has to stay unique
 * across both files, and `plural` is the name that proved it: declared `const`
 * in both on 6 September, it threw `Identifier 'plural' has already been
 * declared` and took the whole panel down with it.
 */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/* ── sound ─────────────────────────────────────────────────────────────
   Off until switched on in Settings; the library only listens until then.
   Wired once, delegated, so a control rendered later is covered the moment
   it appears. */
(async () => {
  const settings = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.ok ? res.result : {}))
  );
  window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQASound?.wire(document);
})();
const $ = (id) => document.getElementById(id);
const { el } = window.UQADom; // ui/dom.js: a node with a class and plain text
const t = (k, v) => QAWi18n.t(k, v);

let SIG = null;
let FC = null;
const sigReady = Promise.all([
  import('../core/signal.js').then((m) => { SIG = m; }),
  import('../core/finding-count.js').then((m) => { FC = m; }),
]).catch(() => {});

/* ── the one problem number: core/signal.js visibleProblems (spec §7) ───────
 * The same block is in popup.js, devtools/panel.js and report.js: the number
 * comes from one function, the words from `common.signal.*`.
 */
const sgGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const sgSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* no storage: the choice lasts the page */ } };
const sgLevel = () => (sgGet('qaw.sg.level', 'problems') === 'all' ? 'all' : 'problems');
const sgPromoted = (sid) => { try { return new Set(JSON.parse(localStorage.getItem(`qaw.sg.promo.${sid}`) || '[]')); } catch { return new Set(); } };
const sgPath = (u) => { try { const p = new URL(u); return p.pathname + p.search; } catch { return String(u || ''); } };
/** The rows the level shows: Problems, or Everything; a promoted note joins Problems. */
function sgView(events, sid) {
  const sig = SIG.visibleProblems(events, 'all');
  const level = sgLevel();
  const promo = sgPromoted(sid);
  const rows = level === 'all' ? sig.rows : sig.rows.filter((r) => r.c === 'D' || promo.has(r.key));
  // The headline is the one problem number (core/finding-count.js: distinct failures, repeats folded), the same on the chip, the done card, the toast and the report.
  // What the tester's own tools found (a11y, links, layout, fine print) is a Finding, counted apart.
  const num = FC ? FC.problemCounts(events).groups : sig.problems;
  return { sig, num, level, rows, promo, induced: sig.inducedRows };
}
function sgRow(r, v, sid, again) {
  const row = el('div', `sg-row${r.c === 'D' ? ' is-d' : ''}`);
  // T-021: the tier is a glyph shape and a word (ui/tone.js), never the row colour alone.
  if (window.UQATone) { const tier = window.UQATone.tierOf(SIG.REASONS[r.r]?.tier); row.append(window.UQATone.chip(tier, t(`common.signal.tier.${tier}`))); }
  row.append(el('span', 'sg-chip', t(`common.signal.r.${r.r}`)));
  if (r.r === 'd-third') row.append(el('span', 'sg-chip sg-warn', t('common.signal.warning')));
  const msg = el('span', 'sg-msg');
  const b = document.createElement('bdi');
  b.dir = 'auto';
  b.textContent = String(r.kind === 'net' ? `${r.status || ''} ${sgPath(r.url)}`.trim() : r.text || r.url || '').slice(0, 140);
  msg.append(b);
  row.append(msg);
  if (r.n > 1) row.append(el('span', 'sg-n', `x${r.n}`));
  if (r.c !== 'D') {
    if (v.promo.has(r.key)) row.append(el('span', 'sg-chip', t('common.signal.promoted')));
    else {
      const p = el('button', 'sg-btn', t('common.signal.promote'));
      p.type = 'button';
      p.addEventListener('click', () => { const s = sgPromoted(sid); s.add(r.key); sgSet(`qaw.sg.promo.${sid}`, JSON.stringify([...s])); again(); });
      row.append(p);
    }
  }
  return row;
}
/** Control, counts, "hiding" line, coverage line, Induced section. `again` repaints the page. */
function sgBlock(v, sid, again) {
  const { sig } = v;
  const box = el('div', 'sg');
  const seg = el('div', 'sg-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', t('common.signal.show'));
  for (const [lv, key] of [['problems', t('common.signal.show.problems')], ['all', t('common.signal.show.all')]]) {
    const b = el('button', 'sg-btn', key);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v.level === lv));
    b.addEventListener('click', () => { sgSet('qaw.sg.level', lv); again(); });
    seg.append(b);
  }
  box.append(seg);
  if (v.level === 'problems' && sig.notes) {
    box.append(el('p', 'sg-line', `${t('common.signal.notes', { n: sig.notes })} · ${t('common.signal.requests', { n: sig.requests })}`));
    const list = Object.entries(sig.hiding).map(([c, n]) => `${t(`common.signal.r.${c}`)} ${n}`).join(', ');
    box.append(el('p', 'sg-line sg-hiding', t('common.signal.hiding', { n: sig.notes, list })));
  }
  if (sig.collapsed) box.append(el('p', 'sg-line', t('common.signal.moreCollapsed', { n: sig.collapsed })));
  if (!sig.problems) box.append(el('p', 'sg-line sg-cov', t('common.signal.coverage')));
  if (v.induced.length) {
    const d = el('details', 'sg-induced');
    d.append(el('summary', '', `${t('common.signal.induced')} (${v.induced.length})`));
    for (const r of v.induced) d.append(sgRow(r, v, sid, again));
    box.append(d);
  }
  return box;
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: t('common.workerUnresponsive') });
    });
  });
}

let sessions = [];
/* ?session=<id> opens straight onto one session — the report page and the
   popup link here, and landing on "whichever was newest" instead of the one
   the tester just clicked is the kind of small lie that wastes ten minutes. */
let currentId = new URLSearchParams(location.search).get('session') || null;
let events = [];
let session = null;
let settings = null;
const hidden = new Set(); // event kinds the tester has switched off

/** How far the timeline has already been drawn, so a poll appends instead of rebuilding. */
let renderedSeq = 0;
let renderedCount = 0;

/** Screenshots load only when scrolled into view; one observer for all of them. */
const shotObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      shotObserver.unobserve(entry.target);
      loadShot(entry.target);
    }
  },
  { rootMargin: '200px' }
);

async function loadShot(figure) {
  const { captureId, alt } = figure.dataset;
  const res = await send({ type: 'UQA_GET_CAPTURE', captureId });
  if (!res.ok || !res.result?.dataUrl) return;
  const img = document.createElement('img');
  if (!/^data:image\//.test(String(res.result.dataUrl))) return; // S-10: a worker reply is not trusted to be an image
  img.src = res.result.dataUrl;
  img.alt = alt || t('panel.timeline.screenshotAltFallback');
  img.loading = 'lazy';
  img.decoding = 'async';
  if (settings?.screenshotWidth) img.style.maxWidth = settings.screenshotWidth + 'px';
  img.addEventListener('click', () => lightbox(res.result.dataUrl));
  figure.replaceChildren(img);
}

/** Coalesce renders into one animation frame — a chatty page fires many events. */
function scheduleRender(fn) {
  if (scheduleRender.queued) return;
  scheduleRender.queued = true;
  requestAnimationFrame(() => {
    scheduleRender.queued = false;
    fn();
  });
}

/* ------------------------------------------------------------- correlation */
/*
 * The failure rule and the correlation rule come from `core/`, they are not
 * written again here.
 *
 * This panel used to carry its own transcription of both, and so did
 * `report/report.js`, because a classic script cannot `import`. That is three
 * copies of one question — "what caused this failure" — and three chances for
 * the panel, the report and the filed defect to disagree about the answer for
 * the same session.
 *
 * `report/charts.js` had already found the shape that works in an extension
 * page: a dynamic `import()`, awaited once in `boot()` before anything is
 * drawn. `import()` is forbidden in the MV3 service worker and nowhere else,
 * and `core/correlate.js` carries exactly one dependency so that pulling it in
 * here costs nothing else.
 *
 * The stubs are safe rather than null: a draw that somehow beat `boot()` shows
 * an uncoloured timeline instead of throwing inside a row renderer.
 */

let sharedIsFailure = () => false;
let sharedCorrelate = () => [];
const rulesReady = import('../core/correlate.js').then((m) => {
  sharedIsFailure = m.isFailure;
  sharedCorrelate = m.correlate;
});

const DEFAULT_CAUSAL_WINDOW_MS = 5000;
const causalWindow = () => settings?.causalWindowMs ?? DEFAULT_CAUSAL_WINDOW_MS;

const isFailure = (ev) => sharedIsFailure(ev);
const correlate = (all) => sharedCorrelate(all, causalWindow());

/* ------------------------------------------------------------------ helpers */

function rel(t) {
  return session ? `+${((t - session.startedAt) / 1000).toFixed(2)}s` : '';
}

/*
 * `ev.kind` itself ('dom', 'net', 'console', …) is data: it is stored in the
 * session, matched against by `hidden`/filters, and read back by every export.
 * That code never changes language. What a tester reads is the human label
 * next to it — the filter chip and the column badge in each timeline row — so
 * only the label side of this table gets a translation key. Declared at
 * module top level per the i18n contract (English stays the source of
 * record, the key resolves at render time through `kindLabel()`).
 */
const KIND_LABEL = {
  dom: { en: 'Actions', key: 'panel.timeline.kind.dom' },
  net: { en: 'Network', key: 'panel.timeline.kind.net' },
  console: { en: 'Console', key: 'panel.timeline.kind.console' },
  pageerror: { en: 'Errors', key: 'panel.timeline.kind.pageerror' },
  nav: { en: 'Pages', key: 'panel.timeline.kind.nav' },
  note: { en: 'Notes', key: 'panel.timeline.kind.note' },
  screenshot: { en: 'Shots', key: 'panel.timeline.kind.screenshot' },
  a11y: { en: 'Accessibility', key: 'panel.timeline.kind.a11y' },
  rtl: { en: 'Layout stress', key: 'panel.timeline.kind.rtl' },
  inject: { en: 'Test data', key: 'panel.timeline.kind.inject' },
  perf: { en: 'Performance', key: 'panel.timeline.kind.perf' },
};
const kindLabel = (kind) => (KIND_LABEL[kind] ? t(KIND_LABEL[kind].key) : kind);

/**
 * The badge for a note's tag. `ev.tag` ('bug' / 'issue' / 'question') is the
 * stored value; the icon (identity/icons/ui/icons.json `stage2_map.devtools`)
 * and the word after it are what a tester reads. UI rework round 2, S11b
 * left these as emoji with a reason (a redesign of `summarise()`'s five
 * consumers, not an icon swap); this fix does that redesign — see
 * `noteIcon()` and `buildRow()` below. Thamanyah has no emoji glyph, and
 * `summarise()` itself keeps returning plain text for the chain view, which
 * `core/correlate.js` never hands a `note`-kind event anyway (`trigger` is
 * always dom/nav, `failure`/`siblings` are always net/console/pageerror).
 */
const NOTE_BADGE = {
  bug: { icon: 'tag-bug', key: 'panel.timeline.note.bug' },
  issue: { icon: 'tag-issue', key: 'panel.timeline.note.issue' },
  question: { icon: 'tag-question', key: 'panel.timeline.note.question' },
};

/** The badge icon for a note event, or null for every other kind. */
function noteIcon(ev) {
  const badge = ev.kind === 'note' ? NOTE_BADGE[ev.tag] : null;
  if (!badge) return null;
  const span = document.createElement('span');
  span.className = 'note-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = window.UQAIcon?.(badge.icon, { size: 16 }) || '';
  return span;
}

function summarise(ev) {
  switch (ev.kind) {
    case 'nav':
      return t('panel.timeline.summary.nav', { url: ev.url });
    case 'dom': {
      const target = ev.label || ev.tag || t('panel.timeline.summary.element');
      if (ev.action === 'click') return t('panel.timeline.summary.clicked', { target });
      if (ev.action === 'input') return t('panel.timeline.summary.typed', { value: ev.value ?? '', target });
      if (ev.action === 'change') return t('panel.timeline.summary.set', { target, value: ev.value ?? '' });
      if (ev.action === 'submit') return t('panel.timeline.summary.submitted', { target });
      if (ev.action === 'keydown') return t('panel.timeline.summary.pressed', { key: ev.key, target });
      // `ev.action` beyond these five is whatever the recorder saw on the page
      // (a raw DOM event name); that value is data, but "on" between it and
      // the target is still an English word a tester reads, so it is still
      // routed through t().
      return t('panel.timeline.summary.actionOn', { action: ev.action, target });
    }
    case 'net': {
      const outcome = ev.error ? t('panel.timeline.summary.networkError') : ev.status;
      const forced = ev.overridden ? t('panel.timeline.summary.forcedBy', { rule: ev.ruleLabel || t('panel.timeline.summary.qaWrapRule') }) : '';
      return `${ev.method} ${ev.url} › ${outcome} (${Math.round(ev.durationMs)}ms)${forced}`;
    }
    case 'console':
      return `console.${ev.level}: ${ev.text}`;
    case 'pageerror':
      return ev.text;
    case 'note': {
      const badge = NOTE_BADGE[ev.tag];
      return badge ? `${t(badge.key)}: ${ev.text}` : ev.text;
    }
    case 'screenshot':
      return ev.text || t('panel.timeline.summary.screenshot');
    case 'a11y': {
      const totalOne = ev.total === 1;
      const rulesOne = ev.violations.length === 1;
      const key = totalOne
        ? (rulesOne ? 'panel.timeline.summary.a11yScanOneOne' : 'panel.timeline.summary.a11yScanOneMany')
        : (rulesOne ? 'panel.timeline.summary.a11yScanManyOne' : 'panel.timeline.summary.a11yScanManyMany');
      return t(key, { total: ev.total, rules: ev.violations.length });
    }
    case 'rtl': {
      const n = ev.overflowCount ?? 0;
      return ev.enabled
        ? t(n === 1 ? 'panel.timeline.summary.rtlOnOne' : 'panel.timeline.summary.rtlOnMany', { n })
        : t('panel.timeline.summary.rtlOff');
    }
    case 'inject':
      return t(ev.truncated ? 'panel.timeline.summary.injectedTruncated' : 'panel.timeline.summary.injected', {
        label: ev.label,
        field: ev.fieldLabel || t('panel.timeline.summary.aField'),
        n: ev.actualLength,
      });
    case 'perf': {
      const poor = Object.entries(ev.ratings || {}).filter(([, v]) => v === 'poor').map(([k]) => k.toUpperCase());
      const suffix = poor.length ? t('panel.timeline.summary.ratedPoor', { list: poor.join(', ') }) : '';
      return t('panel.timeline.summary.perf', {
        lcp: ev.metrics?.lcp ?? '—',
        cls: ev.metrics?.cls ?? '—',
        count: ev.resources?.count ?? 0,
        suffix,
      });
    }
    default:
      return ev.kind;
  }
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2200);
}


/* ------------------------------------------------------------------- render */

function renderStats() {
  const host = $('stats');
  host.innerHTML = '';
  if (!session) return;

  // One number, one function: the same visibleProblems the popup, badge and report read.
  const sg = SIG ? sgView(events, session.id) : null;
  const failures = sg ? sg.num : events.filter(isFailure).length;
  const sgHost = $('sg-panel');
  if (sgHost) {
    sgHost.replaceChildren();
    if (sg) {
      sgHost.append(el('p', 'sg-head', t('common.signal.problems', { n: failures })), sgBlock(sg, session.id, renderStats));
      const shown = sg.rows.slice(0, 30);
      for (const r of shown) sgHost.append(sgRow(r, sg, session.id, renderStats));
      if (sg.rows.length > shown.length) sgHost.append(el('p', 'sg-line', t('common.signal.moreCollapsed', { n: sg.rows.length - shown.length })));
    }
  }
  const a11yEvent = [...events].reverse().find((e) => e.kind === 'a11y');
  const duration = session.endedAt
    ? `${((session.endedAt - session.startedAt) / 1000).toFixed(1)}s`
    : t('panel.stats.recording');

  const cards = [
    { k: t('panel.stats.session'), v: session.charter, small: true },
    { k: t('panel.stats.problems'), v: String(failures), tone: failures ? 'bad' : 'good' },
    { k: t('panel.stats.steps'), v: String(events.filter((e) => e.kind === 'dom').length) },
    {
      k: t('panel.stats.duration'),
      v: session.timeboxMinutes
        ? t('panel.stats.durationBox', { duration, minutes: session.timeboxMinutes })
        : duration,
      tone:
        session.timeboxMinutes && session.endedAt &&
        (session.endedAt - session.startedAt) / 60000 > session.timeboxMinutes
          ? 'bad'
          : '',
      small: !!session.timeboxMinutes,
    },
    {
      k: t('panel.stats.accessibility'),
      v: a11yEvent ? t('panel.stats.a11yIssues', { n: a11yEvent.total }) : t('panel.stats.a11yNotScanned'),
      tone: a11yEvent?.total ? 'bad' : '',
      small: !a11yEvent,
    },
    { k: t('panel.stats.viewport'), v: session.env?.viewport || '—', small: true },
  ];

  for (const c of cards) {
    const card = el('div', `stat ${c.tone || ''}`);
    card.append(el('span', 'k', c.k), el('span', `v ${c.small ? 'small' : ''}`, c.v));
    host.append(card);
  }
}

function renderChains() {
  const chains = correlate(events);
  $('block-failures').hidden = chains.length === 0;
  $('fail-count').textContent = String(chains.length);
  const host = $('chains');
  host.innerHTML = '';

  for (const c of chains) {
    const box = el('div', 'chain');

    const h = el('h3');
    h.append(document.createTextNode(summarise(c.failure)));
    const conf = el('span', `conf ${c.confidence}`);
    conf.textContent = t(
      c.confidence === 'none' ? 'panel.failures.confNone' : c.confidence === 'high' ? 'panel.failures.confHigh' : 'panel.failures.confLow'
    );
    h.append(conf);
    box.append(h);

    const ol = el('ol', 'chain-steps');
    const step = (when, lead, rest) => {
      const li = el('li');
      li.append(el('span', 'when', when + ' '), el('span', 'lead', lead), document.createTextNode(' ' + rest));
      return li;
    };
    if (c.trigger) {
      ol.append(step(rel(c.trigger.ts), t('panel.failures.youDidThis'), t('panel.failures.gapBefore', { text: summarise(c.trigger), gapMs: c.gapMs })));
    } else {
      ol.append(step('', t('panel.failures.noActionFound'), t('panel.failures.likelyBackground')));
    }
    ol.append(step(rel(c.failure.ts), t('panel.failures.thenThisFailed'), summarise(c.failure)));
    c.siblings.forEach((s) => ol.append(step(rel(s.ts), t('panel.failures.sameMoment'), summarise(s))));
    box.append(ol);

    const detail = c.failure.responsePreview || c.failure.stack;
    if (detail) box.append(el('pre', null, detail));

    host.append(box);
  }
}

function renderA11y() {
  const latest = [...events].reverse().find((e) => e.kind === 'a11y');
  $('block-a11y').hidden = !latest;
  if (!latest) return;

  $('a11y-count').textContent = String(latest.total);
  const host = $('a11y');
  host.innerHTML = '';

  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  [...latest.violations]
    .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9))
    .forEach((v) => {
      const row = el('div', 'a11y-row');
      row.append(el('span', `a11y-impact sev-${v.impact || 'minor'}`, v.impact ? QAWi18n.impactWord(v.impact) : t('panel.common.na')));

      const mid = el('div');
      // D-200: axe's help is English only; keep it English and left-to-right in an Arabic panel. The rule id sits beside it below.
      const help = el('span', 'a11y-help', v.help);
      help.lang = 'en';
      help.dir = 'ltr';
      mid.append(help);
      const rule = el('span', 'a11y-rule');
      rule.dir = 'ltr';
      rule.textContent = `${v.id}: ${v.nodes[0]?.target || ''}`;
      mid.append(rule);
      row.append(mid);

      const right = el('div', 'a11y-right');
      right.append(el('span', 'a11y-count', t(v.count === 1 ? 'panel.a11y.oneElement' : 'panel.a11y.manyElements', { n: v.count })));

      // "colour-contrast, 3 elements" is a statistic. Putting each one on
      // screen, ringed, is a finding someone can act on.
      const first = v.nodes?.[0]?.target;
      if (first) {
        const show = el('button', 'btn btn-xs', t('panel.a11y.showMe'));
        show.type = 'button';
        show.title = first;
        show.addEventListener('click', async () => {
          const res = await send({ type: 'UQA_HIGHLIGHT', selector: first });
          show.textContent = t(res.ok ? 'panel.a11y.shown' : 'panel.a11y.gone');
          show.title = res.ok ? first : res.error;
          setTimeout(() => (show.textContent = t('panel.a11y.showMe')), 1600);
        });
        right.append(show);
      }
      row.append(right);
      host.append(row);
    });
}

/**
 * `latest.ratings[metric]` comes back from `core/chart-model.js` (not owned
 * this round) as one of exactly these three English words. Mapped here to a
 * key rather than translated in that file.
 */
const PERF_RATING_KEY = {
  good: 'panel.perf.ratingGood',
  'needs work': 'panel.perf.ratingNeedsWork',
  poor: 'panel.perf.ratingPoor',
};

function renderPerf() {
  const latest = [...events].reverse().find((e) => e.kind === 'perf');
  const block = $('block-perf');
  if (block) block.hidden = !latest;
  if (!latest) return;

  const host = $('perf');
  host.replaceChildren();

  /*
   * The five names (LCP, CLS, …) are Web Vitals abbreviations, cited by that
   * abbreviation in Arabic engineering writing exactly as in English, so they
   * stay Latin like `axe` or `CSS`. The sentence explaining each one is
   * translated; the rating word after it is looked up through
   * PERF_RATING_KEY below because `latest.ratings[…]` (from core/chart-model.js,
   * not owned this round) hands back the raw English word.
   */
  const metrics = [
    ['LCP', latest.metrics.lcp, 'ms', t('panel.perf.whyLcp')],
    ['CLS', latest.metrics.cls, '', t('panel.perf.whyCls')],
    ['INP', latest.metrics.inp, 'ms', t('panel.perf.whyInp')],
    ['FCP', latest.metrics.fcp, 'ms', t('panel.perf.whyFcp')],
    ['TTFB', latest.metrics.ttfb, 'ms', t('panel.perf.whyTtfb')],
  ];

  const grid = el('div', 'perf-grid');
  for (const [name, value, unit, why] of metrics) {
    const rating = latest.ratings[name.toLowerCase()] || 'n/a';
    const card = el('div', `perf-metric rating-${rating.replace(' ', '-')}`);
    card.title = why;
    card.append(
      el('span', 'k', name),
      el('span', 'v', value == null ? '—' : `${value}${unit}`),
      el('span', 'r', t(PERF_RATING_KEY[rating] || 'panel.common.na'))
    );
    grid.append(card);
  }
  host.append(grid);

  const r = latest.resources || {};
  const line = el('p', 'muted');
  line.textContent = t('panel.perf.summary', {
    count: r.count ?? 0,
    kb: Math.round((r.bytes ?? 0) / 1024),
    cached: r.cachedCount ?? 0,
    longTasks: latest.longTasks?.count ?? 0,
    longestMs: latest.longTasks?.longestMs ?? 0,
  });
  host.append(line);

  if (r.slowest?.length) {
    const list = el('div', 'perf-slow');
    list.append(el('h3', null, t('panel.perf.slowestRequests')));
    for (const s of r.slowest.slice(0, 6)) {
      const row = el('div', 'perf-slow-row');
      row.append(
        el('span', 'ms', `${s.ms}ms`),
        el('span', 'url', s.url),
        el('span', 'sz', s.cached ? t('panel.perf.cached') : `${Math.round(s.bytes / 1024)} KB`)
      );
      list.append(row);
    }
    host.append(list);
  }

  const note = el('p', 'muted small');
  note.textContent = latest.note || '';
  host.append(note);
}

function renderFilters() {
  const host = $('filters');
  host.innerHTML = '';
  const counts = new Map();
  events.forEach((e) => counts.set(e.kind, (counts.get(e.kind) || 0) + 1));

  for (const kind of Object.keys(KIND_LABEL)) {
    const n = counts.get(kind) || 0;
    if (!n) continue; // never show a filter for something that is not there
    const chip = el('label', 'filter-chip');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !hidden.has(kind);
    box.addEventListener('change', () => {
      box.checked ? hidden.delete(kind) : hidden.add(kind);
      scheduleRender(renderTimeline);
    });
    chip.append(box, document.createTextNode(kindLabel(kind)), el('span', 'n', String(n)));
    host.append(chip);
  }
}

function buildRow(ev) {
  const row = el('div', `ev${isFailure(ev) ? ' fail' : ''}${ev.overridden ? ' overridden' : ''}`);
  row.dataset.seq = ev.seq ?? '';
  row.append(el('span', 't', rel(ev.ts)), el('span', 'k', kindLabel(ev.kind)));

  const body = el('div', 'body');
  const icon = noteIcon(ev);
  if (icon) body.append(icon);
  body.append(document.createTextNode(summarise(ev)));

  if (ev.locator) {
    const loc = el('code', `loc${ev.locatorAmbiguous ? ' ambiguous' : ''}`);
    const text = `page.${ev.framePrefix || ''}${ev.locator}`;
    loc.textContent = text;
    loc.title = ev.locatorAmbiguous
      ? t('panel.timeline.locatorAmbiguous', { n: ev.locatorMatches })
      : t('panel.timeline.locatorVerified');
    loc.addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      toast(t('panel.timeline.locatorCopied'));
    });
    body.append(document.createElement('br'), loc);
  }

  if (ev.kind === 'screenshot' && ev.captureId) {
    // Placeholder only; the image is fetched when it scrolls into view.
    const fig = el('figure', 'shot-pending');
    fig.dataset.captureId = ev.captureId;
    fig.dataset.alt = ev.text || t('panel.timeline.summary.screenshot');
    body.append(fig);
    shotObserver.observe(fig);
  }

  row.append(body);
  return row;
}

function visibleEvents() {
  const onlyFailures = $('only-failures').checked;
  const cap = settings?.maxTimelineRows ?? 1000;
  const all = events.filter((e) => !hidden.has(e.kind) && (!onlyFailures || isFailure(e)));
  // Cap what is DRAWN, never what is stored or exported. Newest rows win.
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/**
 * Append only the rows added since the last draw. Rebuilding the whole list on
 * every two-second poll is what made a long session crawl.
 */
function appendNewRows(fresh) {
  const host = $('timeline');
  if (!host.firstChild || host.querySelector('.empty')) return renderTimeline();

  const onlyFailures = $('only-failures').checked;
  const rows = fresh.filter((e) => !hidden.has(e.kind) && (!onlyFailures || isFailure(e)));
  if (!rows.length) return;

  const frag = document.createDocumentFragment();
  rows.forEach((ev) => frag.append(buildRow(ev)));
  host.append(frag);

  // Honour the draw cap without re-rendering: drop from the top.
  const cap = settings?.maxTimelineRows ?? 1000;
  while (host.childElementCount > cap) host.firstElementChild.remove();

  renderedCount = host.childElementCount;
}

function renderTimeline() {
  const host = $('timeline');
  host.replaceChildren();
  const visible = visibleEvents();

  if (!visible.length) {
    const p = el('p', 'empty');
    p.textContent = t(events.length ? 'panel.timeline.emptyFiltered' : 'panel.timeline.emptyNoEvents');
    host.append(p);
    return;
  }

  // One reflow instead of one per row.
  const frag = document.createDocumentFragment();
  visible.forEach((ev) => frag.append(buildRow(ev)));
  host.append(frag);
  renderedCount = visible.length;

  const dropped = events.filter((e) => !hidden.has(e.kind)).length - visible.length;
  if (dropped > 0) {
    const notice = el('p', 'empty');
    notice.textContent = t(dropped === 1 ? 'panel.timeline.droppedOne' : 'panel.timeline.droppedMany', { n: dropped });
    host.prepend(notice);
  }
}

function lightbox(src) {
  if (!/^data:image\//.test(String(src))) return; // S-10
  const box = el('div', 'lightbox');
  const img = document.createElement('img');
  img.src = src;
  box.append(img);
  box.addEventListener('click', () => box.remove());
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      box.remove();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.append(box);
}

function renderAll() {
  const has = !!session;
  $('empty-stage').hidden = has;
  $('content').hidden = !has;
  if (!has) return;
  renderStats();
  renderChains();
  renderA11y();
  renderPerf();
  renderFilters();
  renderTimeline();
}

/* ---------------------------------------------------------------------- data */

async function loadSessions() {
  const res = await send({ type: 'UQA_LIST_SESSIONS' });
  if (!res.ok) return;
  sessions = res.result || [];

  const sel = $('session-select');
  sel.innerHTML = '';

  if (!sessions.length) {
    session = null;
    events = [];
    sel.disabled = true;
    document.querySelectorAll('.bar-actions button').forEach((b) => (b.disabled = true));
    paintHistoryActions();
    return renderAll();
  }

  sel.disabled = false;
  document.querySelectorAll('.bar-actions button').forEach((b) => (b.disabled = false));

  sessions.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id;
    const when = new Date(s.startedAt).toLocaleString(QAWi18n.numTag());
    const prefix = s.status === 'recording' ? t('panel.header.recordingPrefix') : '';
    o.textContent = `${prefix}${s.charter} · ${when}`;
    sel.append(o);
  });

  // Prefer the session actually being recorded over merely the newest one.
  const live = sessions.find((s) => s.status === 'recording');
  if (!currentId || !sessions.some((s) => s.id === currentId)) currentId = (live || sessions[0]).id;
  sel.value = currentId;
  paintHistoryActions();
  await loadTimeline();
}

async function loadTimeline({ incremental = false } = {}) {
  if (!currentId) return;

  const res = await send({
    type: 'UQA_GET_TIMELINE',
    sessionId: currentId,
    sinceSeq: incremental ? renderedSeq : 0,
  });
  if (!res.ok) return;

  session = res.result.session;
  const fresh = res.result.events || [];

  if (res.result.incremental) {
    if (!fresh.length) return; // nothing new — do not touch the DOM at all
    events = events.concat(fresh);
    renderedSeq = Math.max(renderedSeq, ...fresh.map((e) => e.seq || 0));
    scheduleRender(() => {
      renderStats();
      renderChains();
      renderA11y();
      renderPerf();
      renderFilters();
      appendNewRows(fresh);
    });
    return;
  }

  events = fresh;
  renderedSeq = events.length ? Math.max(...events.map((e) => e.seq || 0)) : 0;
  renderAll();
}

async function exportAs(format) {
  if (!currentId) return;
  const res = await send({ type: 'UQA_EXPORT', sessionId: currentId, format });
  if (!res.ok) return toast(res.error);
  const { filename, content, mime, encoding } = res.result;
  const tl = await send({ type: 'UQA_GET_TIMELINE', sessionId: currentId });
  const { exportPath } = await import('../core/filing.js');
  // Same clock and same folder as every other surface: an export from the
  // panel that lands somewhere else than an export from the report is the
  // inconsistency, not a convenience.
  const path = tl?.ok
    ? exportPath(format, tl.result.session, {
      clock: settings?.clock || '24',
      folder: settings?.downloadFolder || '',
    })
    : filename;
  let data = content;
  if (encoding === 'base64') { const { fromBase64 } = await import('../core/xlsx.js'); data = new Blob([fromBase64(content)], { type: mime }); }
  const out = await window.UQADownload.saveFiled(data, path, mime);
  if (!out.ok) return toast(t('panel.export.saveFailed', { error: out.error }));
  const where = out.path || (await window.UQADownload.whereIsIt(out.id));
  toast(where ? t('panel.export.savedTo', { where }) : t('panel.export.saved', { filename }));
}

/* -------------------------------------------------------------------- wiring */

$('session-select').addEventListener('change', (e) => {
  currentId = e.target.value;
  renderedSeq = 0;
  events = [];
  loadTimeline();
});

$('refresh').addEventListener('click', loadSessions);
$('open-report').addEventListener('click', () =>
  send({ type: 'UQA_OPEN_REPORT', sessionId: currentId, format: 'markdown' })
);
$('export-sbtm').addEventListener('click', () => exportAs('sbtm'));
$('export-md').addEventListener('click', () => exportAs('markdown'));
$('export-json').addEventListener('click', () => exportAs('json'));
$('export-pw').addEventListener('click', () => exportAs('playwright'));
$('only-failures').addEventListener('change', renderTimeline);

/**
 * Deleting history from the panel.
 *
 * The old button did the right call and told the tester nothing. It asked
 * "Delete X and everything recorded in it?", threw the worker's answer away,
 * and then reloaded — so a refusal ("that session is still recording") looked
 * exactly like a success where the session stubbornly stayed in the list. That
 * is the failure this rewrite exists to stop: the worker refuses
 * UQA_DELETE_SESSION while the session is running or a clip is still being
 * filed into it, and refuses UQA_ERASE_ALL while anything at all is recording,
 * and in both cases the refusal names the thing to press Stop on. That sentence
 * is the whole answer, so it is what goes in the toast; a generic "could not
 * delete" would be strictly less useful than the button doing nothing.
 *
 * Erasing everything was reachable only from the Settings page, which is not
 * where anyone is standing when they decide the last fortnight of sessions can
 * go: they are looking at the list of them, which is here.
 *
 * `window.confirm()` and not a dialog of our own, for the same reason the
 * report page uses it: the panel can be docked at 300px, a modal of ours would
 * have to be built and kept working for the one press in a hundred that uses
 * it, and the browser's own dialog cannot be drawn off screen or missed.
 */

/**
 * Which of the two deletes can be pressed right now.
 *
 * Deliberately not folded into the `.bar-actions` sweep in loadSessions(): that
 * sweep answers "are there any sessions at all", which is the right question
 * for the exports and for "Delete all history", and the wrong one for "Delete
 * this session" — the picker can be sitting on nothing while the list is full,
 * and a delete that fires with `currentId` null sends `sessionId: null` to the
 * worker and gets a confusing "no such session" back.
 */
function paintHistoryActions() {
  const one = $('session-delete');
  const all = $('history-clear');
  if (!one || !all) return;
  one.disabled = !currentId;
  all.disabled = !sessions.length;
}

/**
 * Forget the session the page was drawing, all of it.
 *
 * `renderedSeq` and `renderedCount` are the incremental renderer's memory of
 * how far down the timeline it has already drawn. Left at their old values
 * after a delete, the next poll appends the new session's rows below the dead
 * session's, which reads as one session that changed subject halfway through.
 */
function forgetCurrent() {
  currentId = null;
  session = null;
  events = [];
  renderedSeq = 0;
  renderedCount = 0;
}

/*
 * The two `window.confirm()` sentences below, and the two "Deleting…" busy
 * labels, are left as literal English in the source on purpose: this is
 * exactly what `tools/test-timeline-delete.mjs` regex-matches against the raw
 * JS (confirm(`Delete "${name}"?`, `${scale}|plural(`, `btn.textContent =
 * 'Deleting…';`), and that test is not this pass's to edit. So these four
 * strings stay English-only in this round; see the i18n report for the
 * allow-list entry. Everything else in these two handlers is translated.
 */
$('session-delete').addEventListener('click', async () => {
  if (!currentId) return;
  const name = session?.charter || t('panel.session.thisSessionFallback');
  if (!window.confirm(`Delete "${name}"? Its events, screenshots and recordings go with it, and there is no undo.`)) return;

  const btn = $('session-delete');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  const res = await send({ type: 'UQA_DELETE_SESSION', sessionId: currentId });
  btn.textContent = t('panel.session.deleteButton');
  if (!res.ok) {
    paintHistoryActions();
    return toast(res.error || t('panel.session.deleteFailedFallback'));
  }

  toast(t('panel.session.deletedToast', { name }));
  // Then straight to whatever is left, or to the empty state if that was the
  // last one. A panel still drawing a session that no longer exists is the bug
  // this action would otherwise create for itself.
  forgetCurrent();
  await loadSessions();
  paintHistoryActions();
});

$('history-clear').addEventListener('click', async () => {
  if (!sessions.length) return;
  // The count and the pronoun both agree with it: "1 session ... in it",
  // "6 sessions ... in them". A confirmation that reads as a form letter is one
  // a tester stops reading, and this is the one sentence that has to be read.
  const scale = plural(sessions.length, 'session');
  const them = sessions.length === 1 ? 'it' : 'them';
  if (!window.confirm(`Delete all history? That is ${scale}, with every event, screenshot and recording in ${them}. There is no undo.`)) return;

  const btn = $('history-clear');
  btn.disabled = true;
  $('session-delete').disabled = true;
  btn.textContent = 'Deleting…';
  const res = await send({ type: 'UQA_ERASE_ALL' });
  btn.textContent = t('panel.session.clearHistoryButton');
  if (!res.ok) {
    paintHistoryActions();
    return toast(res.error || t('panel.session.clearFailedFallback'));
  }

  toast(t('panel.session.clearedToast'));
  forgetCurrent();
  await loadSessions();
  paintHistoryActions();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * Nothing is declared externally connectable, so a web page cannot reach this
   * at all and another extension's message would carry that extension's id.
   * `sender.id` is stamped by the browser rather than claimed by the sender,
   * which is what makes it the thing to check; `sender.url` is not, and is
   * never checked here (research/51d §7).
   */
  if (sender?.id !== chrome.runtime.id) return;
  if (msg?.type === 'UQA_STATE_CHANGED') loadSessions();
  /*
   * Someone erased everything somewhere else: the Settings page has the same
   * action, and the worker broadcasts to every open surface. UQA_STATE_CHANGED
   * alone would reload the list and leave `currentId` pointing at a row that no
   * longer exists, so the next poll asks for a timeline that cannot be fetched
   * and the panel keeps drawing the erased session until it is closed.
   */
  if (msg?.type === 'UQA_SESSIONS_ERASED') {
    forgetCurrent();
    loadSessions();
  }
  if (msg?.type === 'UQA_SETTINGS_CHANGED') {
    settings = msg.settings;
    renderAll();
  }
});

/**
 * The recorder writes straight to IndexedDB, so the panel polls while a session
 * is live — but only incrementally, only when the tab is visible, and at a rate
 * the user controls.
 */
let pollTimer = null;

function schedulePoll() {
  clearTimeout(pollTimer);
  const period = Math.max(400, settings?.liveRefreshMs ?? 1000);
  pollTimer = setTimeout(async () => {
    if (session?.status === 'recording' && document.visibilityState === 'visible') {
      await loadTimeline({ incremental: true });
    }
    schedulePoll();
  }, period);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session?.status === 'recording') {
    loadTimeline({ incremental: true });
  }
});

async function boot() {
  await QAWi18n.ready();
  // A language change needs no reload: re-fill the static `data-i18n`
  // elements, then re-run the same load-and-render path `boot()` itself uses.
  // The session list and its "● recording:" prefix, the stat strip, the
  // failure chains, the a11y and perf blocks, the filter chips and the
  // timeline rows are all built from `sessions`/`events` already held in
  // memory, so this repaints in the new language without losing the tester's
  // place (`currentId` is untouched).
  QAWi18n.onChange(() => {
    QAWi18n.apply();
    loadSessions();
  });

  // Before the first draw: the rules this panel colours and groups a session
  // with live in core/, and a draw that ran first would find no failures at all.
  await rulesReady;
  await sigReady;
  const res = await send({ type: 'UQA_GET_SETTINGS' });
  if (res.ok) settings = res.result;
  await loadSessions();
  schedulePoll();
}

boot();
