/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The report, as something you look at rather than something you read.
 *
 * What this replaced: one `<pre>` holding the whole Markdown export. Everything
 * was in there — and that was the problem. A reader who wants to know "what
 * broke" had to scan a few thousand characters to find three lines, and a
 * reader who wants the screenshot had to find a base64 blob and decode it.
 *
 * So the same data is now presented six ways, one question per tab:
 *
 *   Overview   the verdict, the counts, and the shape of the session
 *   What broke each failure with the action that caused it
 *   Timeline   everything, on a rail, filterable
 *   Media      screenshots and recordings as cards you can play and save
 *   Quality    page speed and accessibility, which are read by other people
 *   Raw export the text artefact, unchanged, for anyone who wants it
 *
 * Nothing is lost — the raw tab is the old page. What changed is that finding
 * one fact no longer means reading all of them.
 */

const $ = (id) => document.getElementById(id);
const { el } = window.UQADom, TIMING = { flash: 320, savedLabel: 1800 }; // el: ui/dom.js. TIMING: display times in ms

/** The words for a key, from platform/i18n.js. Short, so the call sites stay short. */
const t = (k, v) => QAWi18n.t(k, v);
/** D-219: a page's own text (url, label, typed value) wrapped in a bidi isolate so it keeps its direction inside a sentence. */
const iso = (v) => QAWi18n.iso(v);

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

/*
 * The words of a failure in the tester's language (r2-08-6, D-1010-23): the same table the popup reads, loaded
 * once and lazily so the report opens without it. Until it arrives, or if it cannot load, the English stays.
 */
let WERR = null;
import('../platform/worker-errors.js').then((m) => { WERR = m; }).catch(() => { /* English stays on screen */ });
const werr = (x) => (WERR ? WERR.localizeError(x, t, QAWi18n.lang()) : typeof x === 'string' ? x : String(x?.error ?? x?.message ?? ''));

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: t('report.status.workerSilent') });
    });
  });
}

/**
 * Ask the browser for the origin of a service before calling it (needs the
 * click that started this). Jira Cloud, Slack and the trackers send no CORS
 * headers to an extension, so without their own grant a tester on per-site
 * access gets "Failed to fetch". Answers { ok } or { ok: false, error }.
 */
async function askServiceAccess(...urls) {
  const origins = [];
  for (const u of urls.flat()) {
    try {
      const p = new URL(String(u || '').trim());
      if (p.protocol === 'https:' || p.protocol === 'http:') origins.push(`${p.protocol}//${p.host}/*`);
    } catch { /* not a URL: the service will say so */ }
  }
  const need = [...new Set(origins)];
  if (!need.length || !chrome.permissions?.request) return { ok: true };
  if (await chrome.permissions.contains({ origins: need }).catch(() => false)) return { ok: true };
  if (await chrome.permissions.request({ origins: need }).catch(() => false)) return { ok: true };
  const hosts = need.map((o) => o.replace(/^https?:\/\//, '').replace(/\/\*$/, '')).join(', ');
  return { ok: false, error: `QA Wrap has not been allowed to reach ${hosts}. Press the button again and choose Allow when the browser asks.` };
}

function say(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}

/** r1-02-6: a link built from data (a page's own URL, a rule's help address) is http, https, mailto or tel, else plain text. One rule, in filing.js. */
const safeHref = (u) => window.UQAFiling.safeHref(u);
/** An anchor when the address is safe, else a span with the same words: the text is shown, nothing is clickable. */
function safeLink(href, className, text) {
  const ok = safeHref(href);
  const n = el(ok ? 'a' : 'span', className, text);
  if (ok) { n.href = ok; n.target = '_blank'; n.rel = 'noopener'; }
  return n;
}

const params = new URLSearchParams(location.search);
let sessionId = params.get('session');
let session = null;
let events = [];
/**
 * Two lists, and the difference is the whole webcam contract.
 *
 * A webcam companion (`role: 'webcam'`) is a layer of its parent, not a second
 * clip: research/106 says it is never its own card, count or row. So `media` —
 * which every count, every card, every row and every export filter reads — is
 * the store without them, and `allMedia` is the store, for the two places that
 * genuinely need a companion: the overlay in the lightbox, and deleting a
 * parent along with its layer.
 */
let allMedia = [];
let media = [];
const isCompanion = (m) => m.role === 'webcam';
/** Set both lists at once. Setting one of them alone is the bug. */
function setMedia(list) {
  allMedia = list || [];
  media = allMedia.filter((m) => !isCompanion(m));
}
/** The webcam track belonging to a clip, by the parent's own id. */
const webcamTrackOf = (item) =>
  (item?.webcamTrackId && allMedia.find((m) => m.id === item.webcamTrackId))
  || allMedia.find((m) => isCompanion(m) && m.parentId === item?.id)
  || null;
/** Is this stored id a companion: asked by the timeline, which has events not records. */
const isCompanionId = (id) => !!id && allMedia.some((m) => m.id === id && isCompanion(m));
let settings = null;
/** T-068: a control the organisation took away is disabled and says why, instead of failing on click. */
const managed = (b, key) => { if (b && settings?.policy?.[key] === false) { b.disabled = true; b.classList.add('is-managed'); b.title = t('options.policy.setByOrg', { key }); } return b; };
let current = null; // the raw export: { filename, mime, content }
let fileTabReady = false;

/** What the Jira tab needs from this page, without importing it. */
window.UQAReport = { sessionId: null, lastJira: null, werr };

/* ── shared vocabulary ─────────────────────────────────────────────────── */

/** One glass-family glyph, `<use>`-ing a `<symbol>` defined once in report.html. */
const SVGNS = 'http://www.w3.org/2000/svg';
const XLINKNS = 'http://www.w3.org/1999/xlink';
/* UI rework round 2, S11b: the ids whose new drawing is direction-sensitive
 * (identity/icons/ui/icons.json UQAIconMirror, restricted to what this sprite
 * uses: i-nav -> event-nav, i-note -> note, i-inject -> tool-inject).
 * report.css already has `[dir='rtl'] .i.mirror { transform: scaleX(-1); }`;
 * it had nothing to select before this. */
const MIRRORED = new Set(['i-nav', 'i-note', 'i-inject']);
function svgIcon(id) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', MIRRORED.has(id) ? 'i mirror' : 'i');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#${id}`);
  use.setAttributeNS(XLINKNS, 'xlink:href', `#${id}`);
  svg.append(use);
  return svg;
}
function iconP(id) {
  const p = el('p', 'empty-icon');
  p.append(svgIcon(id));
  return p;
}
function iconSpan(id, className) {
  const s = el('span', className);
  s.append(svgIcon(id));
  return s;
}

const KIND = {
  dom: { label: 'Action', icon: 'i-action', tone: 'neutral' },
  net: { label: 'Request', icon: 'i-request', tone: 'neutral' },
  console: { label: 'Console', icon: 'i-console', tone: 'neutral' },
  pageerror: { label: 'Error', icon: 'i-error', tone: 'bad' },
  nav: { label: 'Page', icon: 'i-nav', tone: 'neutral' },
  note: { label: 'Note', icon: 'i-note', tone: 'note' },
  screenshot: { label: 'Screenshot', icon: 'i-screenshot', tone: 'media' },
  recording: { label: 'Recording', icon: 'i-recording', tone: 'media' },
  a11y: { label: 'Accessibility', icon: 'i-a11y', tone: 'info' },
  perf: { label: 'Page speed', icon: 'i-perf', tone: 'info' },
  rtl: { label: 'Layout stress', icon: 'i-rtl', tone: 'info' },
  inject: { label: 'Test data', icon: 'i-inject', tone: 'info' },
};

/**
 * The word for an event kind, in the reader's language.
 *
 * `KIND` above stays the English source of record: the icon and the tone are
 * read from it wherever a row is painted, and only the label moves. It is
 * resolved here rather than in the table because a table declared at module
 * top level is built before the language file has finished loading.
 */
function kindLabel(kind) {
  switch (kind) {
    case 'dom': return t('report.kind.dom');
    case 'net': return t('report.kind.net');
    case 'console': return t('report.kind.console');
    case 'pageerror': return t('report.kind.pageerror');
    case 'nav': return t('report.kind.nav');
    case 'note': return t('report.kind.note');
    case 'screenshot': return t('report.kind.screenshot');
    case 'recording': return t('report.kind.recording');
    case 'a11y': return t('report.kind.a11y');
    case 'perf': return t('report.kind.perf');
    case 'rtl': return t('report.kind.rtl');
    case 'inject': return t('report.kind.inject');
    default: return (KIND[kind] || {}).label || kind;
  }
}

/** axe's four impact bands as words (r9-10-1): the one copy lives in platform/i18n.js; the `sev-` class keeps the English id. */
const impactWord = (name) => QAWi18n.impactWord(name);

/*
 * The failure rule and the correlation rule come from `core/`, they are not
 * written again here.
 *
 * This page used to carry its own transcription of both, and so did
 * `devtools/panel.js`, because a classic script cannot `import`. Three copies
 * of "what caused this failure" is three answers to one question, and the one
 * that reached the developer was whichever surface the tester exported from.
 *
 * The way out is the one `report/charts.js` already uses for the chart
 * arithmetic: a dynamic `import()`, awaited once in `boot()` before anything
 * renders. `import()` is forbidden in the MV3 service worker and nowhere else,
 * and `core/correlate.js` was split out with exactly one dependency so that
 * pulling it in here costs nothing else.
 *
 * Both start as a safe stub rather than as `null`, so a render that somehow
 * runs before `boot()` shows an empty "What broke" tab instead of throwing.
 */
let coreIsFailure = () => false;
let correlateChains = () => [];
const rulesReady = import('../core/correlate.js').then((m) => {
  coreIsFailure = m.isFailure;
  correlateChains = m.correlate;
});
/* T-020: "a problem" is one definition on this page, the Problems tier of core/signal.js visibleProblems
 * (a hidden Note is not a problem here, so the chip, "What broke", the timeline filter and the badge agree). */
const isFailure = (e) => (SIG ? SIG.classify(e).c === 'D' : coreIsFailure(e));
let BF = null; const bugfirstReady = import('./bugfirst.js').then((m) => { BF = m; }); // features-1010 R: Copy as Markdown, Copy for AI, duplicate collapse, session.json

const rel = (ts) => (session ? `+${((ts - session.startedAt) / 1000).toFixed(2)}s` : '');
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * A position inside a clip, as a player shows it: `mm:ss`, or `h:mm:ss`.
 *
 * `secs()` above is a *duration* — "open for 12.3s" — and reads wrong as a
 * timecode. A row that says a run is at 4:07 of the session's recording is
 * telling the reader where to drag the scrubber, so it has to look like the
 * number written under the scrubber.
 */
const clock = (ms) => {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

function summarise(ev) {
  switch (ev.kind) {
    case 'nav':
      return t('report.ev.opened', { url: iso(ev.url) });
    case 'dom': {
      // Named `what` and not `t`: the translator is called `t` on this page, and
      // a local of that name would shadow it for the rest of this block.
      const what = ev.label || ev.tag || t('report.ev.element');
      if (ev.action === 'click') return t('report.ev.clicked', { what });
      if (ev.action === 'input') return t('report.ev.typed', { value: iso(ev.value ?? ''), what: iso(what) });
      if (ev.action === 'change') return t('report.ev.changed', { what: iso(what), value: iso(ev.value ?? '') });
      if (ev.action === 'submit') return t('report.ev.submitted', { what });
      if (ev.action === 'keydown') return t('report.ev.pressed', { key: ev.key, what });
      return t('report.ev.actionOn', { action: ev.action, what });
    }
    case 'net':
      return `${ev.method} ${ev.url} › ${ev.error ? t('report.ev.networkError') : ev.status} (${Math.round(ev.durationMs)}ms)`;
    case 'console':
      return `console.${ev.level}: ${ev.text}`;
    case 'pageerror':
      return ev.text;
    case 'note':
      return ev.text;
    case 'expected': return t('report.ev.expected');
    case 'screenshot':
      return ev.text || t('report.ev.screenshot');
    case 'recording':
      return `${ev.label || t('report.ev.screenRecording')}: ${secs(ev.durationMs || 0)}, ${kb(ev.bytes || 0)}`;
    case 'a11y':
      return t('report.ev.a11y', {
        issues: t(ev.total === 1 ? 'report.count.a11yIssueOne' : 'report.count.a11yIssueMany', { n: ev.total }),
        rules: t(ev.violations.length === 1 ? 'report.count.ruleOne' : 'report.count.ruleMany', { n: ev.violations.length }),
      });
    case 'perf':
      return t('report.ev.perf', {
        lcp: measured(ev.metrics?.lcp, 'ms'),
        cls: measured(ev.metrics?.cls),
        requests: t((ev.resources?.count ?? 0) === 1 ? 'report.count.requestOne' : 'report.count.requestMany', { n: ev.resources?.count ?? 0 }),
      });
    case 'rtl':
      return ev.enabled ? t('report.ev.rtlOn', { n: ev.overflowCount ?? 0 }) : t('report.ev.rtlOff');
    case 'inject':
      return t('report.ev.injected', { label: iso(ev.label), field: iso(ev.fieldLabel) || t('report.ev.aField') });
    case 'harvest':
      return t('report.ev.harvest', {
        elements: ev.counts?.elements ?? 0,
        locators: ev.counts?.unique ?? 0,
        forms: t((ev.forms?.length ?? 0) === 1 ? 'report.count.formOne' : 'report.count.formMany', { n: ev.forms?.length ?? 0 }),
      });
    case 'links':
      return t('report.ev.links', {
        links: t(ev.total === 1 ? 'report.count.linkOne' : 'report.count.linkMany', { n: ev.total }),
        broken: ev.broken?.length ?? 0,
        redirected: ev.redirected?.length ?? 0,
      });
    case 'autofill':
      return t('report.ev.autofill', {
        fields: t(ev.filled === 1 ? 'report.count.fieldOne' : 'report.count.fieldMany', { n: ev.filled }),
      }) + (ev.invalid?.length ? t('report.ev.autofillRejected', { n: ev.invalid.length }) : '');
    case 'export':
      return t('report.ev.saved', { what: formatLabelKey(ev.format) ? t(formatLabelKey(ev.format)) : ev.label || ev.format, path: ev.path });
    case 'diagram':
      return t('report.ev.diagram', { nodes: ev.nodes, edges: ev.edges });
    default:
      return ev.text || ev.kind;
  }
}

/** Same rule as core/artifact.js — the panel and the report must agree. */
/**
 * A count and its noun, agreeing.
 *
 * "1 screenshot(s) and 0 recording(s)" is a line a presenter reads aloud, and
 * it is the tell that nobody did. The product already wrote the agreement by
 * hand in one place; this is that, once, for the twelve that did not.
 */
function plural(n, one, many = `${one}s`) {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

/**
 * A metric that was not measured says so.
 *
 * These tiles used to print a bare em dash for a missing value, and at display
 * size in the INP tile that is a long horizontal line where a number should be:
 * on a projector it reads as a broken tool, not as an absent measurement. INP
 * in particular is absent for an honest reason — nobody interacted with the
 * page — and "not measured" is the whole of what the reader needs.
 */
function measured(value, unit = '') {
  return value == null ? t('report.value.notMeasured') : `${value}${unit}`;
}

/**
 * Dates by the page's language, never the browser's default (which printed
 * "AM 10:11:25 ,9/29/2026" in Arabic). Western digits in Arabic, as the glossary
 * says; 24-hour clock in both.
 */
const localeTag = () => (QAWi18n.lang() === 'ar' ? 'ar-JO-u-nu-latn-ca-gregory' : 'en-GB');
const fmtDate = (ts) => new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
const fmtClock = (ts) => new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));

/**
 * A timestamp in an order nobody can misread: `2026-09-06 08:45`, local time.
 *
 * `toLocaleString()` on a machine set to en-US prints `9/5/2026` for the fifth
 * of September, and to the Amman audience this report is written for that is
 * the ninth of May. ISO order is the one date format that reads the same in
 * both rooms, and at minute precision it also stops the session picker running
 * out of room mid-timestamp.
 */
function stamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * How many documents a scan read, in the words the popup uses.
 *
 * A scan of a page whose content lives in a cross-origin iframe used to read
 * the wrapper and say nothing about it, so "0 violations" and "1 link" were
 * reported for a document nobody had tested (research/58, finding 14). The
 * scanners read every frame now; naming the count is the half of the fix that
 * lets a reader tell a thorough answer from a narrow one.
 */
function framesRead(ev) {
  const n = ev?.frameCount ?? ev?.frames?.length ?? 1;
  return t(n === 1 ? 'report.count.frameOne' : 'report.count.frameMany', { n });
}

/** Where a finding was, when it was not the top document. */
function frameNote(item, topUrl) {
  const url = item?.frameUrl;
  return url && url !== topUrl ? url : '';
}

/** The shared rule, given this page's causal-window setting. */
const shownEvents = (all) => all.filter((e) => !coreIsFailure(e) || isFailure(e));
function correlate(all) { return correlateChains(shownEvents(all), settings?.causalWindowMs ?? 5000); }

/* ── tabs ──────────────────────────────────────────────────────────────── */

/*
 * Every way of looking at this session, in the order a reader wants them.
 *
 * `diagram` is here rather than in the corner of the action bar (F2). It is a
 * view of the run, not an action on it, and as a button beside "Save" it read
 * as an export nobody pressed. `sizes` is the Window sizes section fixed by
 * research/55-window-sizes-contract.md, and it sits after the evidence because
 * that is what it holds.
 */
const TABS = ['broke', 'timeline', 'selectors', 'overview', 'media', 'notes', 'sizes', 'diagram', 'quality', 'file', 'raw'];

/*
 * Round 3, direction C: ten panels, four sections. The panel ids, the `data-tab`
 * buttons and the `#deep-links` are exactly what they were; a section only
 * decides which sub-tabs are on show. Section buttons are `.sec-btn`, never `.tab`.
 */
const SECTIONS = [
  ['findings', ['broke', 'timeline', 'selectors', 'overview']],
  ['evidence', ['media', 'notes', 'sizes', 'diagram']],
  ['quality', ['quality']],
  ['share', ['file', 'raw']],
];
const sectionOf = (tab) => (SECTIONS.find(([, list]) => list.includes(tab)) || SECTIONS[0])[0];

function showTab(name, { focus = false } = {}) {
  let toFocus = null; // D-1010-110: focus is moved only after the row's `hidden` is settled; a focus call into a hidden row drops to body
  // A line about the last tab ("1,459 characters ready") is not news on the next one.
  say('');
  // Named `id` and not `t`: `t` is the translator on this page.
  const sec = sectionOf(name);
  for (const id of TABS) {
    $(`panel-${id}`).hidden = id !== name;
    const btn = document.querySelector(`[data-tab="${id}"]`);
    btn.setAttribute('aria-selected', String(id === name));
    btn.setAttribute('aria-controls', `panel-${id}`); // r5-08-2: a tab controls its panel, not the tablist
    btn.tabIndex = id === name ? 0 : -1;
    // A sub-tab belongs to one section; the others are off the row (not `hidden`,
    // which the selectors tab already owns).
    btn.toggleAttribute('data-off', sectionOf(id) !== sec);
    if (id === name) {
      // MOTION.md "Report" rule 1: the active tab scrolls into view in the row
      // without a jump, if the tab row itself is scrolled (narrow window).
      btn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (focus) toFocus = btn;
    }
  }
  for (const [id] of SECTIONS) {
    const b = document.getElementById(`sec-${id}`);
    b.setAttribute('aria-selected', String(id === sec));
    b.tabIndex = id === sec ? 0 : -1;
  }
  const row = $('tabs');
  // A section with one view (Quality) needs no row of its own.
  row.hidden = TABS.filter((id) => sectionOf(id) === sec && !document.querySelector(`[data-tab="${id}"]`).hidden).length < 2;
  if (toFocus && !row.hidden) toFocus.focus();
  $('panel-' + name).setAttribute('aria-labelledby', `tab-${name}`);
  // Built lazily, all three: nobody should pay to serialise a whole session
  // into Markdown, to build an ISTQB document, or to lay out a workflow diagram
  // for a tab they never opened.
  if (name === 'raw' && !current) loadRaw();
  if (name === 'diagram' && !diagramReady) renderDiagram(); if (name === 'notes') import('./notes-tab.js').then((m) => m.openNotes()).catch(() => say(t('report.timeline.exportFailed'), 'err'));
  if (name === 'file' && !fileTabReady) {
    fileTabReady = true;
    window.UQAIstqb?.init();
  }
  location.hash = name;
}

$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (btn) showTab(btn.dataset.tab);
});
/** D-1010-110: select a section; the first visible view of it opens. `focus` moves focus into that view (a pointer click only). */
function openSection(btn, focus) {
  showTab(SECTIONS.find(([id]) => id === btn.dataset.sec)[1].find((id) => !document.querySelector(`[data-tab="${id}"]`).hidden), { focus });
}
$('secbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sec]');
  // detail is 0 for a keyboard activation (Enter, Space): the section tab keeps focus, as the arrow keys do.
  if (btn && !btn.disabled) { openSection(btn, e.detail > 0); if (e.detail === 0) btn.focus(); }
});

/**
 * One tab stop per row, arrows move, Home and End jump (WAI-ARIA tabs). In a
 * right-to-left page the arrows mirror. Selection follows focus, so the panel
 * is always the one the focused tab names.
 */
function roving(row, pick, pickItem) {
  row.addEventListener('keydown', (e) => {
    const items = [...row.querySelectorAll(pick)].filter((b) => !b.disabled && !b.hidden && !b.hasAttribute('data-off'));
    const at = items.indexOf(document.activeElement);
    if (at < 0) return;
    const rtl = QAWi18n.dir() === 'rtl';
    const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? (at + 1) % items.length
      : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? (at - 1 + items.length) % items.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    pickItem(items[next]);
  });
}
roving($('tabs'), '[data-tab]', (b) => showTab(b.dataset.tab, { focus: true }));
// Keyboard roving (APG tabs): selection follows focus and focus stays on the section tab; only a pointer click moves into the panel.
roving($('secbar'), '[data-sec]', (b) => { openSection(b, false); b.focus(); });

// MOTION.md "Report" rule 5: the sticky header gains its shadow/tint once
// content scrolls under it — one class, toggled by an IntersectionObserver on
// a 1px sentinel, never a per-frame scroll listener.
{
  const sentinel = document.getElementById('scroll-sentinel');
  const bar = document.querySelector('.app-bar');
  if (sentinel && bar && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => bar.classList.toggle('is-under-content', !entry.isIntersecting)).observe(sentinel);
  }
}

/* ── overview ──────────────────────────────────────────────────────────── */

/**
 * R07: with no session the tiles and the two Overview charts have nothing to
 * plot, so they are hidden entirely rather than rendered blank, and the
 * DevTools panel's own empty state (same markup, same i18n keys) stands in
 * their place.
 */
function setOverviewEmpty(empty) {
  $('cards').hidden = empty;
  $('glance-block').hidden = empty;
  $('mix-block').hidden = empty;
  $('overview-empty').hidden = !empty;
  // F4 (research/91): the hero's own empty state already says this. Hiding
  // the H1 and its sub-line while it is showing leaves one statement on
  // screen instead of two, without deleting either i18n string.
  $('hero-title').hidden = empty;
  $('hero-where').hidden = empty;
}

/**
 * What was hidden, by page and by kind — the evidence behind "n values masked".
 *
 * A count alone asks the reader to take masking on trust. This says which pages
 * were redacted and how heavily, so a reviewer can tell the difference between
 * a session where one field was covered and one where the whole patient table
 * was. It reads `session.maskList`, which the service worker writes through
 * `redactedMaskList()`: page, element kind and clock, and deliberately nothing
 * else — the words themselves never left the browser's session storage.
 *
 * An older session has no `maskList` at all, and then this renders nothing and
 * the count sentence above it stands alone, exactly as it did before.
 */
function renderMaskDetail() {
  const host = document.getElementById('mask-detail');
  if (!host) return;
  host.replaceChildren();
  const list = Array.isArray(session.maskList) ? session.maskList : [];
  if (!list.length) return;

  // One row per page, and within it a count per element kind.
  const pages = new Map();
  for (const m of list) {
    const key = m.page || '';
    let row = pages.get(key);
    if (!row) {
      row = { page: key, n: 0, tags: new Map(), first: m.at, last: m.at };
      pages.set(key, row);
    }
    row.n += 1;
    row.tags.set(m.tag || '?', (row.tags.get(m.tag || '?') || 0) + 1);
    if (m.at && m.at < row.first) row.first = m.at;
    if (m.at && m.at > row.last) row.last = m.at;
  }
  const rows = [...pages.values()].sort((a, b) => b.n - a.n);
  const worst = rows[0]?.n || 1;

  const table = el('table', 'saved-table mask-table');
  const head = el('tr');
  for (const key of ['page', 'elements', 'count', 'when']) {
    head.append(el('th', '', t(`report.mask.col.${key}`)));
  }
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');

    // The page, as a path — the origin is the same one the header already says,
    // and a query string on a staging system is regularly a record id.
    let label = row.page;
    try { label = new URL(row.page).pathname || '/'; } catch { /* not a URL: print it as stored */ }
    tr.append(el('td', 'mono', label));

    const kinds = [...row.tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, n]) => (n === 1 ? `<${tag}>` : `<${tag}> ×${n}`))
      .join(', ');
    tr.append(el('td', '', kinds));

    // The coverage strip: one bar per page, widest page full width. It is the
    // one thing in this panel readable at a glance from across a desk.
    const count = el('td');
    const bar = el('div', 'mask-bar');
    const fill = el('span', 'mask-bar-fill');
    fill.style.inlineSize = `${Math.round((row.n / worst) * 100)}%`;
    bar.append(fill);
    count.append(bar, el('span', 'mask-bar-n', String(row.n)));
    tr.append(count);

    // The clock is the way in, rather than a tick rail of its own: a mask is
    // not an event and has no timeline row, so the most this can honestly do is
    // put the reader beside the row that was recorded next — which is exactly
    // what `selcopy-jump` already does for a copied selector.
    const when = el('td');
    const jump = el('button', 'btn btn-sm btn-quiet mask-jump', row.first === row.last
      ? offsetOf(row.first)
      : `${offsetOf(row.first)} – ${offsetOf(row.last)}`);
    jump.type = 'button';
    jump.title = t('report.mask.jump');
    jump.addEventListener('click', () => jumpTo(row.first));
    when.append(jump);
    tr.append(when);
    body.append(tr);
  }
  table.append(body);
  host.append(table, el('p', 'muted mask-foot', t('report.mask.foot')));
}

function renderOverview() {
  setOverviewEmpty(false);
  // Say what is not here, and why. Masked values were removed at capture, so
  // there is nothing in this file to reveal — the statement is the evidence
  // that something was deliberately withheld rather than never recorded.
  const masked = Number(session.masked || 0);
  const maskBlock = document.getElementById('masked-block');
  if (maskBlock) {
    maskBlock.hidden = masked === 0;
    const note = document.getElementById('masked-note');
    if (note) {
      note.textContent = t(masked === 1 ? 'report.overview.maskedOne' : 'report.overview.maskedMany', { n: masked });
    }
    renderMaskDetail();
  }

  const failures = events.filter(isFailure);
  const chains = correlate(events);
  const notes = events.filter((e) => e.kind === 'note' && e.tag !== 'technique');
  paintGapBanner(events);
  const perf = [...events].reverse().find((e) => e.kind === 'perf');
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  const duration = (session.endedAt || Date.now()) - session.startedAt;

  $('hero-title').textContent = BF.heroTitle({ session, events, t, summarise });
  $('hero-when').textContent = fmtDate(session.startedAt);
  $('hero-where').textContent = session.startUrl || '';
  document.title = t('common.pageTitle', { name: iso($('hero-title').textContent) });

  /**
   * The headline counts the application's failures, not everybody's.
   *
   * It used to count every failure whoever's server produced it, so on any site
   * with analytics it reported the ad blocker's work: an independent field test
   * saw "27 problems found" where all 27 were blocked third-party beacons and
   * the application under test had failed zero times.
   *
   * The third-party ones are still counted and still named — hiding them would
   * be its own kind of lie — but beside the number rather than inside it.
   */
  const { own, theirs, theirHosts } = origins
    ? origins.splitFailures(failures, origins.sessionHosts(session, events))
    : { own: failures, theirs: [], theirHosts: [] };

  /*
   * Every finding, not only the failing requests.
   *
   * `own.length` is still what the third-party aside is written from, and it is
   * still a subset of this number: `countFindings` applies the same split from
   * the same host set. What it adds is everything the tester actually pressed a
   * tool to find, which is what a reader takes the first number on the page to
   * mean.
   */
  const found = sessionsLib
    ? sessionsLib.countFindings(events, { session })
    : { total: own.length, failures: own.length, theirHosts };

  // The one number: visibleProblems().problems, the function the popup, panel, badge and filing read.
  const sg = SIG ? sgView(events, session.id) : null;
  const num = BF.problemCounts(shownEvents(events)).groups; // C5: groups, the unit the popup prints too
  found.total = num; // what the chip prints: failure groups (the tester's own tool findings stay in the title and on the card)
  const again = () => { renderOverview(); renderVerdict(); };
  const verdict = $('hero-verdict');
  verdict.className = `verdict-chip ${num || (sg ? sg.num : 0) ? 'bad' : 'good'}`;
  verdict.replaceChildren(
    el('span', 'verdict-num', String(found.total)),
    el('span', 'verdict-word', t(num === 1 ? 'report.overview.problemOne' : 'report.overview.problemMany'))
  );
  const sgHost = $('sg-report');
  if (sgHost) {
    sgHost.replaceChildren();
    if (sg) {
      sgHost.append(el('p', 'sg-line', t('common.signal.rules', { v: sg.sig.ruleset })));
      sgHost.append(sgBlock(sg, session.id, again));
      for (const r of sg.rows.slice(0, 50)) sgHost.append(sgRow(r, sg, session.id, again));
    }
  }
  // What the number is made of, so nobody has to open four tabs to find out.
  if (sessionsLib) verdict.title = sessionsLib.describeFindings({ ...found, failures: num }); // ui-1016 L: same number as the chip

  const aside = origins?.describeThirdParty({ theirs, theirHosts });
  if (aside) verdict.append(el('span', 'verdict-aside', aside));

  /*
   * Two numbers sit on this screen and they count different things.
   *
   * The headline counts raw failures the application produced; the "What broke"
   * tab counts the ones correlated to the click that caused them. Side by side
   * with no words, "2 problems found" beside "What broke 1" reads as a bug in
   * the report. Both are worth having: the first is what went wrong, the second
   * is what we can already explain. So the difference is stated here, where the
   * bigger number is.
   */
  if (own.length && chains.length !== own.length) {
    verdict.append(el('span', 'verdict-aside', t(chains.length === 1 ? 'report.overview.tracedOne' : 'report.overview.tracedMany', { n: chains.length })));
  }

  const cards = [
    { k: t('report.card.steps'), v: String(events.filter((e) => e.kind === 'dom').length), sub: t('report.card.stepsSub') },
    {
      k: t('report.card.duration'),
      v: secs(duration),
      sub: session.timeboxMinutes ? t('report.card.durationBox', { n: session.timeboxMinutes }) : t('report.card.durationNoBox'),
      tone: session.timeboxMinutes && duration > session.timeboxMinutes * 60_000 ? 'warn' : '',
    },
    { k: t('report.card.requests'), v: String(events.filter((e) => e.kind === 'net').length), sub: t('report.card.requestsSub', { n: failures.filter((f) => f.kind === 'net').length }), tone: failures.some((f) => f.kind === 'net') ? 'bad' : '' },
    { k: t('report.card.notes'), v: String(notes.length), sub: notes.filter((n) => n.tag === 'bug').length ? t('report.card.notesBug', { n: notes.filter((n) => n.tag === 'bug').length }) : t('report.card.notesSub') },
    { k: t('report.card.media'), v: String(media.length), sub: media.length ? kb(media.reduce((n, m) => n + (m.bytes || 0), 0)) : t('report.card.mediaNone') },
  ];
  if (perf) {
    const poor = Object.entries(perf.ratings || {}).filter(([, v]) => v === 'poor').length;
    cards.push({
      k: t('report.card.speed'),
      v: measured(perf.metrics.lcp, 'ms'),
      sub: poor
        ? t('report.card.speedPoor', { metrics: t(poor === 1 ? 'report.count.metricOne' : 'report.count.metricMany', { n: poor }) })
        : t('report.card.speedFine'),
      tone: poor ? 'bad' : 'good',
    });
  }
  if (a11y) {
    cards.push({
      k: t('report.card.a11y'),
      v: String(a11y.total),
      sub: t('report.card.a11ySub', { rules: t(a11y.violations.length === 1 ? 'report.count.ruleOne' : 'report.count.ruleMany', { n: a11y.violations.length }) }),
      tone: a11y.total ? 'warn' : 'good',
    });
  }

  const qc = $('count-sec-quality');
  qc.textContent = a11y?.total || '';
  const host = $('cards');
  host.replaceChildren();
  for (const c of cards) {
    const card = el('div', `card ${c.tone || ''}`.trim());
    card.append(el('span', 'card-k', c.k), el('span', 'card-v', c.v), el('span', 'card-sub', c.sub));
    host.append(card);
  }

  renderCharts();

  // The single most useful sentence in the report, said first.
  $('headline-block').hidden = !chains.length;
  if (chains.length) {
    const head = $('headline');
    head.replaceChildren();
    const c = chains[0];
    const line = el('p', 'headline-line');
    line.append(el('b', null, summarise(c.failure)));
    if (c.trigger) {
      line.append(document.createTextNode(t('report.headline.after')));
      line.append(el('b', null, summarise(c.trigger).replace(/^\w/, (m) => m.toLowerCase())));
      line.append(document.createTextNode(t('report.headline.earlier', { ms: c.gapMs })));
    } else {
      line.append(document.createTextNode(t('report.headline.noTrigger')));
    }
    head.append(line);
    if (chains.length > 1) {
      const more = el('button', 'btn btn-sm', t('report.headline.seeAll', { n: chains.length }));
      more.addEventListener('click', () => showTab('broke'));
      head.append(more);
    }
  }
}

/**
 * The two charts on the overview, drawn by `report/charts.js`.
 *
 * What this replaced was one hand-rolled SVG in this file that painted every
 * bar in `--accent` and marked a failing bucket by turning the opacity up.
 * `--accent` and `--danger` are the same hue in this identity, so on a
 * projector a busy second and a broken one looked identical: the chart's one
 * job was the distinction it was not making. The bars are neutral now and the
 * red means one thing.
 *
 * The second chart is new and answers the question the first cannot: not when
 * the session was busy, but what it was busy *with*. Both are single-series
 * and neither invents a palette; see the note at the top of charts.js.
 */
async function renderCharts() {
  await window.UQACharts?.activity($('chart-activity'), {
    events,
    session,
    isFailure,
    onPick: (at) => {
      showTab('timeline');
      jumpTo(at);
    },
  });

  // Named with the same words the filter row and the timeline use, so a reader
  // moving between them is not translating.
  const kinds = [...new Set(events.map((e) => e.kind))].map((kind) => ({
    key: kind,
    label: kindLabel(kind),
    value: events.filter((e) => e.kind === kind).length,
    tone: kind === 'pageerror' ? 'bad' : '',
  }));
  $('mix-block').hidden = kinds.length < 2;
  if (kinds.length < 2) return;

  await window.UQACharts?.bars($('chart-mix'), {
    rows: kinds,
    caption: t('report.chart.mixCaption'),
    onPick: (kind) => {
      // Show that kind and nothing else: the reader picked it, so the filter
      // row should say what they asked for rather than adding to it.
      hidden.clear();
      for (const other of new Set(events.map((e) => e.kind))) if (other !== kind) hidden.add(other);
      renderFilters();
      renderTimeline();
      showTab('timeline');
    },
  });
}

// No stylesheet can reach a JS `behavior: 'smooth'` option, so the reduced-
// motion check has to live here too (F13).
const prefersReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function jumpTo(ts) {
  // The rows live in the Timeline tab and the callers no longer do.
  if ($('panel-timeline').hidden) showTab('timeline');
  const rows = [...document.querySelectorAll('#timeline .ev')];
  const target = rows.find((r) => Number(r.dataset.ts) >= ts) || rows[rows.length - 1];
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: prefersReduced() ? 'auto' : 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), TIMING.flash);
}

/* ── what broke ────────────────────────────────────────────────────────── */

/* ── the verdict, the steps and File (round 3, direction C) ─────────────── */

/** The numbered steps a tester would follow: the DOM and navigation stream, in the page's words. */
function stepList() {
  const chains = correlate(events);
  const stop = chains[0]?.failure.ts ?? Infinity;
  const all = events.filter((e) => (e.kind === 'dom' || e.kind === 'nav') && e.ts <= stop + 1);
  return all.map((e) => summarise(e));
}

/**
 * A URL cut into the parts a reader wants one at a time: where it goes (host,
 * path) and the query, which is often the longest and least useful part.
 * `full` is always the untouched input; nothing exported reads this.
 */
function urlParts(url) {
  const full = String(url || '');
  try {
    const u = new URL(full);
    const query = u.search.replace(/^\?/, '');
    return { host: u.host, path: u.pathname || '/', query, params: query ? query.split('&').filter(Boolean).length : 0, full };
  } catch {
    const i = full.indexOf('?');
    const query = i < 0 ? '' : full.slice(i + 1);
    return { host: '', path: i < 0 ? full : full.slice(0, i), query, params: query ? query.split('&').filter(Boolean).length : 0, full };
  }
}

let verdictSeq = 0;
async function renderVerdict() {
  const host = $('verdict');
  if (!host) return;
  const my = ++verdictSeq;
  if (!session || (session.synthetic && !events.length)) { host.hidden = true; return; }
  const chains = correlate(events);
  const failures = events.filter(isFailure);
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  const found = sessionsLib ? sessionsLib.countFindings(events, { session }) : { total: failures.length };
  const sgv = SIG ? sgView(events, session.id) : null;
  const num = sgv ? sgv.num : found.total;
  const lead = chains[0];
  const steps = stepList();
  const duration = ((session.endedAt || Date.now()) - session.startedAt) / 1000;
  const bad = !!(lead || num);
  const seenNone = !bad && !found.total && !num;
  let line;
  if (lead) {
    line = summarise(lead.failure);
    if (lead.trigger) line += t('report.v.after', { what: summarise(lead.trigger) });
  } else line = t(found.total || num ? (num === 1 ? 'report.v.findingsOne' : 'report.v.findingsMany') : 'report.v.clean', {
    n: num,
    steps: steps.length,
    requests: events.filter((e) => e.kind === 'net').length,
    pages: new Set(events.filter((e) => e.kind === 'nav').map((e) => e.url)).size,
  });

  // What the card shows: one short sentence. `line` (with the trigger, full URL) stays what filing and exports read.
  const failUrl = lead?.failure.kind === 'net' ? urlParts(lead.failure.url) : null;
  const headline = failUrl
    ? `${lead.failure.method} ${failUrl.path} · ${lead.failure.error ? t('report.ev.networkError') : lead.failure.status}`
    : lead ? summarise(lead.failure) : line;
  const queryParts = failUrl?.query ? failUrl : urlParts(session.startUrl);

  const ctx = {
    sessionId, session, events, send, say, steps, line,
    // Filing reads the same function: only shown problems, Notes and Induced never filed unless asked.
    signal: sgv && { problems: sgv.num, rows: sgv.rows.filter((r) => r.c === 'D'), notes: [...sgv.sig.rows.filter((r) => r.c === 'N'), ...events.filter((e) => e.kind === 'note' && !['technique', 'capture-gap', 'split', 'dropped'].includes(e.tag))] },
    title: BF.heroTitle({ session, events, t, summarise }),
    screenshotCount: events.filter((e) => e.kind === 'screenshot').length,
    markdown: async () => { const r = await send({ type: 'UQA_EXPORT', sessionId, format: 'markdown' }); return r.ok ? r.result.content : ''; },
    screens: emlScreens,
    onFiled: () => renderVerdict(),
  };
  window.UQAReport.mail = ctx;
  const file = await UQAFiling.control(ctx);
  if (my !== verdictSeq) return;

  const earlier = Math.max(0, steps.length - 4);
  const shown = steps.slice(-4);
  const badge = el('span', `badge ${bad ? 'badge-fail' : 'badge-skipped'}`, t(bad ? 'report.v.failed' : 'report.v.seenNone'));
  const related = chains.reduce((n, c) => n + c.siblings.length, 0);
  const relatedBadge = related ? el('span', 'badge badge-fail', t(related === 1 ? 'report.v.relatedOne' : 'report.v.relatedMany', { n: related })) : null;
  const meta = el('span', 'cap muted', `${fmtDate(session.startedAt)} · ${duration.toFixed(1)} ${t('report.v.sec')}`);
  const h1 = el('h1');
  h1.id = 'v-h';
  h1.title = headline;
  const bdi = document.createElement('bdi');
  bdi.textContent = headline;
  h1.append(bdi);
  // A labelled one-line row; the value is clipped, the whole of it is in `title`.
  const vrow = (key, text, full, ltr) => {
    const row = el('p', 'v-row');
    const v = document.createElement('bdi');
    v.className = 'v-val';
    if (ltr) v.dir = 'ltr';
    v.textContent = text;
    v.title = full || text;
    row.append(el('span', 'v-k', t(key)), v);
    return row;
  };
  const startParts = urlParts(session.startUrl);
  const where = session.startUrl ? vrow('report.v.where', `${startParts.host}${startParts.path === '/' && startParts.host ? '' : startParts.path}` || startParts.full, startParts.full, true) : null;
  const did = lead?.trigger ? vrow('report.v.youDid', summarise(lead.trigger), summarise(lead.trigger), false) : null;
  let queryBox = null;
  if (queryParts.query) {
    queryBox = el('details', 'v-query');
    queryBox.append(el('summary', null, `${t('report.v.query')} · ${t('report.v.queryParams', { n: queryParts.params })} · ${t('report.v.queryChars', { count: queryParts.query.length, n: queryParts.query.length.toLocaleString(QAWi18n.numTag()) })}`));
    const code = el('code', null, queryParts.query);
    code.dir = 'ltr';
    const copyBtn = (key, text) => {
      const b = el('button', 'btn btn-ghost', t(key));
      b.type = 'button';
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); say(t('report.v.copied'), 'ok'); } catch { say(t('report.raw.copyFallback'), 'err'); }
      });
      return b;
    };
    const qrow = el('div', 'hrow');
    qrow.append(copyBtn('report.v.copyUrl', queryParts.full), copyBtn('report.v.copyQuery', queryParts.query));
    queryBox.append(code, qrow);
  }
  const counts = el('div', 'counts');
  const tracedN = BF.problemCounts(shownEvents(events)).groups; // identical failures count once; same number as the headline
  if (tracedN) counts.append(el('span', 'badge badge-fail', t(tracedN === 1 ? 'report.v.tracedOne' : 'report.v.tracedMany', { n: tracedN })));
  if (a11y?.total) counts.append(el('span', 'badge badge-warn', t('report.v.a11y', { n: a11y.total })));
  const acts = el('div', 'hrow acts');
  const [copyMd, copyAi, aiBox] = BF.copyButtons({ el, t, say, ctx, session, events: () => shownEvents(events) });
  const copy = el('button', 'btn btn-ghost', t('report.v.copySteps'));
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(steps.map((x, i) => `${i + 1}. ${x}`).join('\n')); say(t('report.v.copied'), 'ok'); } catch { say(t('report.raw.copyFallback'), 'err'); }
  });
  const jump = el('button', 'btn btn-ghost', t('report.v.timeline'));
  jump.type = 'button';
  jump.addEventListener('click', () => { showTab('timeline', { focus: true }); if (lead) jumpTo(lead.failure.ts); });
  acts.append(copyMd, copyAi, file, copy, jump);
  const sync = el('div', 'v-sync');
  const top = el('div', 'hrow');
  top.append(badge, ...(relatedBadge ? [relatedBadge] : []), meta);
  const main = el('div', 'stack');
  main.append(top, h1);
  // T-020: a verdict from absence carries its basis beside it, at the same weight.
  if (seenNone) main.append(el('p', 'v-cov', t('common.signal.coverage')));
  for (const part of [where, did, queryBox]) if (part) main.append(part);
  main.append(counts, acts, aiBox, sync);

  const side = el('div', 'stack');
  const ol = el('ol', 'steps');
  ol.setAttribute('aria-label', t('report.v.steps'));
  if (earlier) ol.append(el('li', 'earlier muted', t(earlier === 1 ? 'report.v.earlierOne' : 'report.v.earlierMany', { n: earlier })));
  shown.forEach((x, i) => {
    const li = el('li', i === shown.length - 1 && lead ? 'bad' : '');
    li.value = earlier + i + 1;
    const sp = document.createElement('span');
    sp.textContent = x;
    li.append(sp);
    ol.append(li);
  });
  if (!shown.length) ol.append(el('li', 'muted', t('report.v.noSteps')));
  side.append(el('h2', null, t('report.v.steps')), ol);
  host.replaceChildren(main, side);
  host.hidden = false;
  UQAFiling.syncChips(sync, ctx);
}

/** Up to six screenshots for the .eml, 8 MB in all: a mail app that cannot open the file helps nobody. */
async function emlScreens() {
  const out = [];
  let total = 0;
  for (const e of events.filter((x) => x.kind === 'screenshot').slice(0, 6)) {
    const got = await mediaBlob(e.mediaId || e.captureId);
    if (!got || total + got.blob.size > 8 * 1024 * 1024) continue;
    total += got.blob.size;
    const ext = (got.type || 'image/png').split('/')[1]?.split(';')[0] || 'png';
    out.push({ name: `screenshot-${out.length + 1}.${ext}`, type: got.type || 'image/png', bytes: new Uint8Array(await got.blob.arrayBuffer()) });
  }
  return out;
}
$('eml-btn')?.addEventListener('click', () => { if (window.UQAReport.mail) UQAFiling.download(); });

/* ── what broke: one failure at a time, the evidence side by side ───────── */

let pickChain = 0;
function renderChains() {
  const chains = correlate(events);
  const groups = BF.groups(chains, shownEvents(events)); // identical failures are one card with a count
  const n = BF.problemCounts(shownEvents(events)).groups; // the headline's number
  $('count-broke').textContent = n || '';
  $('count-broke').classList.toggle('is-bad', n > 0);
  const secCount = $('count-sec-findings');
  secCount.textContent = n || '';
  secCount.classList.toggle('is-bad', n > 0);
  const host = $('chains');
  host.replaceChildren();

  if (!chains.length) {
    const empty = el('div', 'empty');
    empty.append(
      iconP('i-check'),
      el('h2', null, t('report.broke.emptyTitle')),
      el('p', 'muted', t('report.broke.emptyNote', { n: events.length }))
    );
    host.append(empty);
    return;
  }
  if (pickChain >= groups.length) pickChain = 0;

  const list = el('div', 'card flist');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('report.broke.listAria'));
  groups.forEach((g, i) => {
    const b = el('button', null);
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(i === pickChain));
    b.tabIndex = i === pickChain ? 0 : -1;
    b.append(iconSpan('i-error', 'flist-i'), el('span', null, summarise(g.chain.failure)), ...(g.count > 1 ? [BF.countBadge(el, t, g.count)] : []), ...BF.flags(el, t, events, g));
    b.addEventListener('click', () => { pickChain = i; renderChains(); $('chains').querySelector('[aria-selected="true"]').focus(); });
    list.append(b);
  });
  list.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -groups.length : e.key === 'End' ? groups.length : 0;
    if (!step) return;
    e.preventDefault();
    pickChain = Math.min(groups.length - 1, Math.max(0, pickChain + step));
    renderChains();
    $('chains').querySelector('[aria-selected="true"]').focus();
  });

  const c = groups[pickChain].chain;
  const pane = el('article', 'stack chain');
  const head = el('header', 'chain-head');
  head.append(el('span', 'chain-num', String(pickChain + 1)), el('h2', null, summarise(c.failure)), ...(groups[pickChain].count > 1 ? [BF.countBadge(el, t, groups[pickChain].count)] : []), ...BF.flags(el, t, events, groups[pickChain]));
  head.append(el('span', `conf conf-${c.confidence}`, t(c.confidence === 'high' ? 'report.broke.confHigh' : c.confidence === 'low' ? 'report.broke.confLow' : 'report.broke.confMedium')));
  pane.append(head);

  // Cause and effect as two steps with an arrow between them: the whole
  // reason this product exists is that other tools show these separately.
  const flow = el('div', 'flow');
  if (c.trigger) {
    const cause = el('div', 'flow-step');
    cause.append(el('span', 'flow-tag', t('report.broke.youDid')), el('p', null, summarise(c.trigger)));
    if (c.trigger.locator) cause.append(el('code', 'flow-loc', `page.${c.trigger.framePrefix || ''}${c.trigger.locator}`));
    flow.append(cause);
    // The arrow is direction, not decoration: cause sits before effect, so in
    // Arabic the glyph points the other way (the rule draws it from data-glyph).
    const arrow = el('div', 'flow-arrow', `${c.gapMs}ms`);
    arrow.dataset.glyph = '›';
    flow.append(arrow);
  }
  const effect = el('div', 'flow-step bad');
  effect.append(el('span', 'flow-tag', t('report.broke.then')), el('p', null, summarise(c.failure)));
  flow.append(effect);
  pane.append(flow);

  const f = c.failure;
  const block = (title, text) => {
    const box = el('div', 'stack evi');
    const pre = el('pre', 'pre', text);
    pre.dir = 'ltr';
    pre.tabIndex = 0;
    box.append(el('h3', null, title), pre);
    return box;
  };
  const cols = el('div', 'cols');
  const body = (o) => (o == null ? '' : `\n\n${typeof o === 'string' ? o : JSON.stringify(o, null, 2)}`);
  if (f.kind === 'net') {
    cols.append(
      block(t('report.broke.request'), `${f.method} ${f.url}${f.reqHeaders ? `\n${Object.entries(f.reqHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}` : ''}${body(f.reqBody)}`),
      block(t('report.broke.response'), `${f.error ? t('report.ev.networkError') : f.status} · ${Math.round(f.durationMs || 0)}ms${f.resHeaders ? `\n${Object.entries(f.resHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}` : ''}${body(f.responsePreview)}`)
    );
  } else {
    cols.append(block(f.stack ? t('report.broke.stack') : t('report.broke.what'), `${f.text || summarise(f)}${f.stack ? `\n\n${f.stack}` : ''}`));
  }
  pane.append(cols);

  const near = events.filter((e) => (e.kind === 'console' || e.kind === 'pageerror') && e.ts >= f.ts - 4000 && e.ts <= f.ts + 2000 && e !== f).slice(0, 12);
  if (near.length) pane.append(block(t('report.broke.console'), near.map((e) => summarise(e)).join('\n')));

  const shot = BF.groupShot(events, groups[pickChain]) || nearestScreenshot(f.ts); // the page's own auto shot for this group first
  const row = el('div', 'cols');
  const fig = el('figure', 'chain-shot');
  if (shot) {
    const img = el('img');
    img.alt = t('report.broke.screenAt', { at: rel(shot.ts) });
    img.loading = 'lazy';
    loadMediaInto(img, shot.mediaId || shot.captureId);
    const opener = evidenceOpener(img, (btn) => lightbox(shot.mediaId || shot.captureId, 'image', { sourceEl: btn, alt: img.alt }));
    fig.append(opener, el('figcaption', 'muted', t('report.broke.screenAt', { at: rel(shot.ts) })));
  } else fig.append(el('p', 'muted', t('report.broke.noShot')));
  const side = el('div', 'stack');
  const replay = managed(el('button', 'btn btn-secondary', t('report.broke.replay')), 'replayAllowed');
  replay.type = 'button';
  replay.hidden = $('watch-replay')?.hidden !== false;
  replay.addEventListener('click', () => send({ type: 'UQA_OPEN_REPLAY', sessionId }));
  const jump = el('button', 'btn btn-ghost', t('report.broke.showInTimeline'));
  jump.type = 'button';
  jump.addEventListener('click', () => { showTab('timeline', { focus: true }); jumpTo(f.ts); });
  side.append(replay, jump);
  if (f.locator || c.trigger?.locator) {
    const loc = `page.${(c.trigger || f).framePrefix || ''}${(c.trigger || f).locator}`;
    const cp = el('button', 'btn btn-ghost', t('report.broke.copyLocator'));
    cp.type = 'button';
    cp.addEventListener('click', () => navigator.clipboard?.writeText(loc).then(() => say(t('report.v.copied'), 'ok')).catch(() => {}));
    side.append(cp);
  }
  if (c.siblings.length) {
    const det = el('details', 'chain-detail');
    det.append(el('summary', null, t(c.siblings.length === 1 ? 'report.broke.alsoOne' : 'report.broke.alsoMany', { n: c.siblings.length })));
    const also = el('ul', 'chain-siblings');
    c.siblings.forEach((x) => also.append(el('li', null, summarise(x))));
    det.append(also);
    side.append(det);
  }
  row.append(fig, side);
  pane.append(row);
  if (groups[pickChain].count > 1) pane.append(BF.occurrences({ group: groups[pickChain], el, t, rel, summarise })); // every time it happened, on demand

  const wrap = el('div', 'case');
  wrap.append(list, pane);
  host.append(wrap);
}

const nearestScreenshot = (ts) =>
  events
    .filter((e) => e.kind === 'screenshot' && Math.abs(e.ts - ts) < 15_000)
    .sort((a, b) => Math.abs(a.ts - ts) - Math.abs(b.ts - ts))[0] || null;

/* ── the selectors that reached the clipboard ──────────────────────────── */

/**
 * Kinds that have a section of their own and are therefore not in the timeline
 * list.
 *
 * `selectorcopy` is the detail of a copy, not a second thing that happened: the
 * picker files a readable note on the same clock, that note is the timeline
 * row, and this section is the long form of it. Listing both would show the
 * same moment twice, so the section anchors into the row instead.
 */
const OWN_SECTION = new Set(['selectorcopy']);

/** The wall clock, in the reader's own locale. */
const clockOf = (ts) => fmtClock(ts);

/**
 * How far into the session, as mm:ss.
 *
 * Not `rel()`, which is `+12.34s` and is right for a timeline row whose
 * neighbours are milliseconds away. A copy is something a person did minutes
 * in, and `+03:12` is the form they will match against a recording.
 */
function offsetOf(ts) {
  if (!session?.startedAt) return '';
  const total = Math.max(0, Math.round((ts - session.startedAt) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `+${mm}:${ss}`;
}

/**
 * The buckets a pick's `category` sorts into, in the order the section
 * shows them — the same five `content/picker.js#categoryOf` derives, plus
 * `other` for a pick recorded before this field existed (or one the picker
 * genuinely couldn't place). Falling back to `other` rather than hiding the
 * row is what keeps an old session's picks on screen.
 */
const SELCOPY_CATEGORY_ORDER = ['label', 'text', 'field', 'image', 'sensitive', 'other'];

/**
 * The four things a pick can be FOR, in the order a script author reads them:
 * what the flow does, what it must account for, where a secret goes, and the
 * rest. `content/picker.js#PURPOSES` is where the tester says which.
 */
const SELCOPY_PURPOSE_ORDER = ['step', 'element', 'sensitive', 'any'];
const selcopyPurposeOf = (ev) => (SELCOPY_PURPOSE_ORDER.includes(ev.purpose) ? ev.purpose : 'any');

function selcopyCategoryLabel(cat) {
  switch (cat) {
    case 'label': return t('report.selcopy.cat.label');
    case 'text': return t('report.selcopy.cat.text');
    case 'field': return t('report.selcopy.cat.field');
    case 'image': return t('report.selcopy.cat.image');
    case 'sensitive': return t('report.selcopy.cat.sensitive');
    default: return t('report.selcopy.cat.other');
  }
}

/** Why the preview cell has no photograph, in a sentence. */
function whyNoPicture(note) {
  if (note === 'offscreen') return t('report.selcopy.offscreen');
  if (note === 'frame') return t('report.selcopy.inFrame');
  if (note === 'sensitive') return t('report.selcopy.sensitivePicture');
  return t('report.selcopy.noPicture');
}

/** The page a pick happened on, as origin+path — the unit the walk map groups by. */
function pickPage(ev) {
  try {
    const u = new URL(ev.frameUrl);
    return { key: u.origin + u.pathname, label: u.pathname || '/' };
  } catch {
    return { key: '', label: t('report.selcopy.walk.unknownPage') };
  }
}

/**
 * The walk, as a picture: numbered chips in the order they were picked,
 * grouped and labelled by page.
 *
 * The locator set's own header says it in words — *that order IS the navigation
 * the automated script should follow* — and until now the report said it only
 * by listing rows in order, grouped by category, which is the one arrangement
 * that hides the walk. This is the same data, shown as the sequence it is.
 *
 * A chip is solid when the tester acted on the element and outlined when they
 * picked it to assert on; a key glyph means the pick carries a credential name.
 */
function renderWalkMap(copies) {
  const wrap = el('div', 'walkmap');
  wrap.append(el('h3', 'selcopy-cat-heading', t('report.selcopy.walk.title')));

  const ordered = [...copies].sort((a, b) => a.ts - b.ts);
  let lastKey = null;
  let strip = null;
  ordered.forEach((ev, i) => {
    const page = pickPage(ev);
    if (page.key !== lastKey) {
      lastKey = page.key;
      wrap.append(el('p', 'walkmap-page mono', page.label));
      strip = el('div', 'walkmap-strip');
      wrap.append(strip);
    }
    const assert = ev.intent === 'assert';
    const chip = el('button', `btn btn-sm walkmap-chip${assert ? ' is-assert' : ''}`);
    chip.append(el('span', 'walkmap-n', String(i + 1)));
    chip.append(el('span', 'walkmap-label', ev.role || ev.tag || 'element'));
    if (ev.credRef?.name) chip.append(iconSpan('i-key', 'walkmap-key'));
    chip.title = ev.copied || '';
    // Same anchor the row's own jump button uses: a chip is a way into the
    // timeline, not a second UI.
    chip.type = 'button';
    chip.addEventListener('click', () => jumpTo(ev.ts));
    strip.append(chip);
  });
  return wrap;
}

/**
 * Whether this basket would survive being handed to an agent — stated, not implied.
 *
 * Three numbers decide it and all three were previously buried one per row:
 * how many picks are unique, how many matched more than one element (the single
 * biggest reason a generated script goes red), and how many had every locator
 * flavour withheld because the element was masked. The fourth line is the one
 * that matters most and is the easiest to leave out: a walk with no assert
 * picks produces a script that runs and verifies nothing.
 */
function renderPickHealth(copies) {
  const unique = copies.filter((e) => !e.ambiguous).length;
  const ambiguous = copies.filter((e) => e.ambiguous).length;
  const withheld = copies.filter((e) => e.maskedSource).length;
  const asserts = copies.filter((e) => e.intent === 'assert').length;

  const wrap = el('div', 'pick-health');
  const add = (key, n, tone) => {
    const item = el('div', `pick-health-item${tone ? ` ${tone}` : ''}`);
    item.append(el('span', 'pick-health-n', String(n)), el('span', '', t(key)));
    wrap.append(item);
  };
  add('report.selcopy.health.unique', unique);
  add('report.selcopy.health.ambiguous', ambiguous, ambiguous ? 'warn' : '');
  add('report.selcopy.health.withheld', withheld);
  add('report.selcopy.health.asserts', asserts, asserts ? '' : 'warn');
  wrap.append(el('p', 'muted pick-health-verdict',
    asserts ? t('report.selcopy.health.ready', { n: asserts }) : t('report.selcopy.health.noAsserts')));
  return wrap;
}

/**
 * Every selector this session put on the clipboard, in the order it was taken.
 *
 * The row is a two-column grid and both columns are logical: the selectors at
 * the inline start with a copy button each, the element at the inline end. In
 * Arabic that puts the element on the left with no second rule, which is what
 * "on the right of each one" means once the page can be read either way.
 */
function renderSelectorCopies() {
  const copies = events.filter((e) => e.kind === 'selectorcopy');
  const host = $('selcopy');
  host.replaceChildren();
  $('selcopy-note').textContent = copies.length ? t('report.selcopy.blurb') : '';

  // The tab exists only for a session that used the tool. Hidden rather than
  // disabled: a greyed tab asks "why can I not open this", and the answer —
  // nothing was ever copied — is not worth a place in the row.
  const tab = document.querySelector('[data-tab="selectors"]');
  if (tab) tab.hidden = !copies.length;
  $('count-selectors').textContent = copies.length || '';
  if (!copies.length && !$('panel-selectors').hidden) showTab('overview');

  if (!copies.length) {
    const empty = el('div', 'empty');
    empty.append(iconP('i-copy'), el('p', '', t('report.selcopy.empty')));
    host.append(empty);
    return;
  }

  host.append(renderWalkMap(copies), renderPickHealth(copies));

  // One card per PURPOSE — what the tester said each pick was for — and inside
  // a card the picked order is exactly `copies`'s own: a `filter()` per bucket,
  // never a re-sort. What kind of element it is (`category`, read off the tag)
  // is a badge on the row now; it describes the element, and the card says why
  // anyone cared about it. A session from before purposes existed has none, and
  // lands whole in `any`, which is what every one of its picks was.
  const list = el('div', 'selcopy-list');
  for (const purpose of SELCOPY_PURPOSE_ORDER) {
    const rows = copies.filter((ev) => selcopyPurposeOf(ev) === purpose);
    if (!rows.length) continue;
    const card = el('section', 'selcopy-card');
    card.dataset.purpose = purpose;
    const head = el('header', 'selcopy-card-head');
    head.append(
      el('h3', 'selcopy-card-title', t(`report.selcopy.purpose.${purpose}`)),
      el('span', 'selcopy-card-count', String(rows.length))
    );
    card.append(head, el('p', 'muted selcopy-card-note', t(`report.selcopy.purposeNote.${purpose}`)));
    list.append(card);
    for (const ev of rows) {
      const row = el('div', 'selcopy-row');

      /* ---- the selectors ---- */
      const main = el('div', 'selcopy-main');

      const when = el('p', 'selcopy-when');
      when.append(
        el('span', 'selcopy-clock', clockOf(ev.ts)),
        el('span', 'selcopy-dot', '·'),
        el('span', 'selcopy-offset', offsetOf(ev.ts))
      );
      when.append(el('span', 'selcopy-badge', selcopyCategoryLabel(SELCOPY_CATEGORY_ORDER.includes(ev.category) ? ev.category : 'other')));
      const jump = el('button', 'btn btn-sm btn-quiet selcopy-jump', t('report.selcopy.jump'));
      jump.type = 'button';
      jump.addEventListener('click', () => jumpTo(ev.ts));
      when.append(jump);
      main.append(when);

      const flavours = el('ul', 'selcopy-flavours');
      for (const f of ev.flavours || []) {
        const item = el('li', 'selcopy-flavour');
        if (f.copied) item.dataset.copied = 'yes';

        const copy = el('button', 'btn btn-sm selcopy-copy', t('report.selcopy.copy'));
        copy.type = 'button';
        const put = async () => {
          try {
            await navigator.clipboard.writeText(f.expr);
            say(t('report.status.locatorCopied'));
          } catch {
            say(t('report.status.clipboardFailed'), 'err');
          }
        };
        copy.addEventListener('click', put);

        const body = el('div', '');
        // `textContent`, like every other page-derived string here: the
        // expression was built out of the page under test.
        const expr = el('code', 'selcopy-expr', f.expr);
        expr.addEventListener('click', put);
        const bits = [f.name];
        if (f.copied) bits.push(t('report.selcopy.copied'));
        if (f.unique) bits.push(t('report.selcopy.unique'));
        else if (f.matches != null) bits.push(t('report.selcopy.matches', { n: f.matches }));
        body.append(expr, el('span', 'selcopy-meta', bits.join(' · ')));

        item.append(copy, body);
        flavours.append(item);
      }
      main.append(flavours);

      if (ev.maskedSource) main.append(el('p', 'selcopy-where', t('report.selcopy.masked')));
      for (const note of locatorNotes({ warnCodes: ev.warnCodes })) main.append(el('p', 'selcopy-where', note));
      const where = [ev.tabTitle, ev.frameUrl].filter(Boolean).join(' · ');
      if (where) main.append(el('p', 'selcopy-where', where));

      // Gap G2: the action(s) recorded on this locator, walk order. `null`
      // (a pick made to assert on, never acted on) renders nothing — no
      // dash, no "none", no warning; that is the ordinary case.
      const actions = actionJoinLib?.actionsForPick?.(ev, events) || null;
      if (actions) {
        main.append(el('p', 'selcopy-where', t('report.selcopy.actions', { list: actions.join(' › ') })));
      }

      // Gap G5, stage 1: a placeholder NAME only — never a value, nothing
      // stored. See research/120 §6.
      if (ev.credRef?.name) {
        main.append(el('p', 'selcopy-where', t('report.selcopy.credRef', { name: iso(ev.credRef.name) })));
      }

      /* ---- the element ---- */
      const preview = el('figure', 'selcopy-preview');
      const outline = el('div', 'selcopy-outline');
      if (ev.label) outline.append(el('p', 'selcopy-el-label', ev.label));
      const name = el('p', 'selcopy-el', `<${ev.tag || 'element'}>`);
      if (ev.elementId) name.append(el('span', 'selcopy-el-id', ` #${ev.elementId}`));
      if (ev.classes) name.append(el('span', '', ` .${ev.classes.split(' ').join(' .')}`));
      outline.append(name);
      if (ev.role) outline.append(el('span', 'selcopy-why', ev.role));
      if (ev.text) outline.append(el('span', 'selcopy-el-text', ev.text));
      if (ev.width && ev.height) {
        outline.append(el('span', 'selcopy-why', t('report.selcopy.size', { w: ev.width, h: ev.height })));
      }
      /*
       * The picture of the element, when there is one.
       *
       * `content/picker.js` cuts it out of a photograph of the tab and files it
       * as a base64 JPEG on the event. It is still a string that arrived in a
       * session file, so it is admitted only when it says it is inline image
       * data: an `img.src` pointing at a remote address would turn opening a
       * report into a request to whoever wrote the session.
       *
       * The outline stays underneath it as the caption, and doubles as the alt
       * text - a reader who cannot see the crop still gets the tag, the id, the
       * words and the size. Only when there is no picture does the cell say why.
       */
      const shot =
        typeof ev.preview === 'string' && ev.preview.startsWith('data:image/') ? ev.preview : null;
      if (!shot) outline.append(el('span', 'selcopy-why', whyNoPicture(ev.previewNote)));
      if (shot) {
        const img = el('img', 'selcopy-shot');
        img.src = shot;
        img.alt = outline.textContent;
        // No `loading="lazy"`: the bytes are already in the page, so there is
        // nothing to defer, and a lazy image inside a panel the reader has not
        // opened yet is one that has still not decoded when they do.
        if (ev.previewW) img.width = ev.previewW;
        if (ev.previewH) img.height = ev.previewH;
        preview.append(img);
      }
      preview.append(outline);

      row.append(main, preview);
      card.append(row);
    }
  }
  host.append(list);
}

/* ── timeline ──────────────────────────────────────────────────────────── */

const hidden = new Set();

function renderFilters() {
  const present = [...new Set(events.map((e) => e.kind))].filter((k) => !OWN_SECTION.has(k));
  const host = $('filters');
  host.replaceChildren();
  for (const kind of present) {
    const meta = KIND[kind] || { label: kind, icon: 'i-dot' };
    const btn = el('button', 'filter');
    btn.append(svgIcon(meta.icon), document.createTextNode(` ${kindLabel(kind)}`));
    btn.dataset.kind = kind;
    btn.setAttribute('aria-pressed', String(!hidden.has(kind)));
    btn.append(el('span', 'filter-n', String(events.filter((e) => e.kind === kind).length)));
    btn.addEventListener('click', () => {
      hidden.has(kind) ? hidden.delete(kind) : hidden.add(kind);
      renderFilters();
      renderTimeline();
    });
    host.append(btn);
  }
}

/** A readable name for a tab: its title if we caught one, else its address. */
function tabName(ev) {
  if (ev.tabTitle) return ev.tabTitle;
  try {
    return new URL(ev.frameUrl || ev.url).host;
  } catch {
    return ev.tabId != null ? t('report.timeline.tabN', { n: ev.tabId }) : t('report.timeline.thisPage');
  }
}

function renderTimeline() {
  const onlyFail = $('only-failures').checked;
  // A companion track is a layer of the clip above it, never a row of its own,
  // whatever the recorder wrote to the session. Kept as a second filter so the
  // section rule beside it stays the one line the report suite reads.
  const notCompanionRow = (e) => !(e.kind === 'recording' && isCompanionId(e.mediaId || e.captureId));
  const listed = events.filter((e) => !OWN_SECTION.has(e.kind)).filter(notCompanionRow);
  const shown = listed.filter((e) => !hidden.has(e.kind) && (!onlyFail || isFailure(e)));
  $('count-timeline').textContent = listed.length || '';

  const host = $('timeline');
  host.replaceChildren();
  if (!shown.length) {
    host.append(el('p', 'muted', t('report.timeline.noMatch')));
    return;
  }

  // A session covers every tab in its window, so a flow that opens a payment
  // window or an OAuth hand-off produces two streams on one clock. Marking
  // where it moves keeps that readable instead of interleaved and confusing.
  let lastTab;
  const frag = document.createDocumentFragment();
  for (const ev of shown) {
    if (ev.tabId != null && ev.tabId !== lastTab) {
      if (lastTab !== undefined) {
        const jump = el('div', 'tab-break');
        jump.append(el('span', 'tab-break-label', tabName(ev)));
        frag.append(jump);
      }
      lastTab = ev.tabId;
    }
    const meta = KIND[ev.kind] || { label: ev.kind, icon: 'i-dot', tone: 'neutral' };
    const row = el('div', `ev tone-${isFailure(ev) ? 'bad' : meta.tone}`);
    row.dataset.ts = String(ev.ts);

    row.append(el('span', 'ev-time', rel(ev.ts)));
    const evIcon = el('span', 'ev-icon');
    evIcon.append(svgIcon(meta.icon));
    row.append(evIcon);

    const body = el('div', 'ev-body');
    // T-021: a row the report calls a problem says its tier in a glyph and a word, not by the red edge alone.
    if (window.UQATone && isFailure(ev)) { const tier = window.UQATone.tierOf(SIG?.REASONS[SIG.classify(ev).r]?.tier); body.append(window.UQATone.chip(tier, t(`common.signal.tier.${tier}`))); }
    body.append(el('p', 'ev-text', summarise(ev)));
    if (ev.preRoll) body.append(el('span', 'ev-preroll', t('report.ev.preRoll')));

    if (ev.locator) {
      const loc = el('code', 'ev-loc', `page.${ev.framePrefix || ''}${ev.locator}`);
      loc.title = t('report.timeline.copyLocator');
      loc.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(loc.textContent);
          say(t('report.status.locatorCopied'));
        } catch {
          say(t('report.status.clipboardFailed'), 'err');
        }
      });
      body.append(loc);
      for (const note of locatorNotes(ev)) body.append(el('p', 'selcopy-where', note));
    }

    if (ev.kind === 'screenshot') {
      const img = el('img', 'ev-shot');
      img.alt = ev.text || t('report.ev.screenshot');
      img.loading = 'lazy';
      loadMediaInto(img, ev.mediaId || ev.captureId);
      body.append(evidenceOpener(img, (btn) => lightbox(ev.mediaId || ev.captureId, ev.imageType || 'image/png', { sourceEl: btn, alt: img.alt })));
    }

    if (ev.kind === 'recording') {
      /*
       * The type decides the element, not the kind.
       *
       * A GIF recording is stored `kind: 'recording'`, `type: 'image/gif'` —
       * and both playback sites branched on the kind alone, so every GIF was
       * handed to a `<video>` element, which renders nothing at all. The
       * feature had no error and no picture: the lightbox simply opened black.
       * `ev.mediaType` is what the worker writes on the event (sw:2098); the
       * fallback is for events written before it did.
       */
      const type = ev.mediaType || 'video/webm';
      const isImage = type.startsWith('image/');
      const play = el('button', 'btn btn-sm', isImage ? t('report.timeline.showClip') : t('report.timeline.playClip'));
      if (!isImage && window.UQAIcon) play.insertAdjacentHTML('afterbegin', window.UQAIcon('play', { size: 16 }));
      play.addEventListener('click', () => lightbox(ev.mediaId, type, { sourceEl: play }));
      body.append(play);
    }

    row.append(body);
    frag.append(row);
  }
  host.append(frag);
}

/**
 * T-043: what a recorded locator was checked against, and why it may be weaker than it looks. The basis line only
 * appears where the recorder stored the engine's own match count; the warning words come from an allow-list of
 * codes, so a page cannot put its own sentence in the report.
 */
function locatorNotes(ev) {
  const notes = [];
  if (ev.locatorMatches === 1 && !ev.locatorAmbiguous) notes.push(t('report.timeline.locChecked'));
  else if (ev.locatorMatches > 1) notes.push(t('report.timeline.locMatches', { n: ev.locatorMatches }));
  for (const code of ['bidi', 'truncated']) {
    if (Array.isArray(ev.warnCodes) && ev.warnCodes.includes(code)) notes.push(t(`report.timeline.locWarn.${code}`));
  }
  return notes;
}

$('only-failures').addEventListener('change', renderTimeline);

/* ── media ─────────────────────────────────────────────────────────────── */

/**
 * Cache of object URLs, so scrolling the gallery does not re-fetch bytes.
 *
 * Every entry pins its Blob in memory until the tab is closed, and a clip is
 * hundreds of megabytes — so a report where five recordings had been opened
 * held all five for the life of the page, and switching sessions added the next
 * session's on top. `revokeAll()` is called wherever the cache is dropped, so
 * the bytes go with the entry rather than outliving it.
 */
const urlCache = new Map();

function revokeAll() {
  for (const url of urlCache.values()) {
    // A legacy screenshot is cached as its own `data:` URI, which is a string
    // and not something to revoke.
    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  urlCache.clear();
}

/**
 * The stored bytes, read here rather than asked for.
 *
 * This page and the service worker are the same extension in the same profile,
 * so they see the same IndexedDB. Asking the worker for a clip meant the worker
 * read the Blob, turned it into an array of numbers, JSON-encoded it, and this
 * page parsed it back: `chrome.runtime` messaging cannot carry a Blob at all,
 * it serialises to `{}` with no error, so bytes-as-numbers was the only way
 * across. For a screenshot that is wasteful; for a recording it was several
 * times the clip's size in live memory on both sides at once, which is what a
 * report page that froze on a long session was actually doing.
 *
 * `import()` and not a static import: `report.html:432` loads this file as a
 * classic script, so a top-level `import` would not parse. The dynamic form
 * works in a classic script and keeps `db.js` off the critical path of a report
 * that has no media in it.
 *
 * The worker route stays as the fallback, because there are two states this
 * cannot serve: a profile whose database will not open, and a session recorded
 * before the media store existed, whose screenshot is still a data URI in the
 * old captures table.
 */
async function mediaBlob(id) {
  try {
    const { getMedia } = await import('../core/db.js');
    const record = await getMedia(id);
    if (record?.blob) return { blob: record.blob, type: record.type || record.blob.type };
  } catch {
    /* fall through to the worker, which is the only other reader */
  }
  const res = await send({ type: 'UQA_MEDIA_BLOB', id });
  if (!res.ok) return null;
  return {
    blob: new Blob([new Uint8Array(res.result.data)], { type: res.result.type }),
    type: res.result.type,
  };
}

async function mediaUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const got = await mediaBlob(id);
  if (!got) {
    // A session recorded before the media store existed still has its
    // screenshot in the old captures table; fall back rather than showing a
    // broken image on every old report.
    const legacy = await send({ type: 'UQA_GET_CAPTURE', captureId: id });
    if (legacy.ok && legacy.result?.dataUrl) {
      urlCache.set(id, legacy.result.dataUrl);
      return legacy.result.dataUrl;
    }
    return null;
  }
  const url = URL.createObjectURL(got.blob);
  urlCache.set(id, url);
  return url;
}

async function loadMediaInto(img, id) {
  const url = await mediaUrl(id);
  if (url) img.src = url;
  else img.replaceWith(el('p', 'muted', t('report.media.imageGone')));
}

/**
 * One clip, one home.
 *
 * A recording made inside a window-size run is filed with the parent session so
 * it cannot be orphaned, and it carries a `runId` saying which run it belongs
 * to (research/55-window-sizes-contract.md, section 4). Showing it in both
 * places would double the count and make a tester chasing a clip look in the
 * wrong one; the contract's rule is that `runId` decides, and this is where the
 * report obeys it.
 */
const ownMedia = () => media.filter((m) => !m.runId);
const runMedia = (runId) => media.filter((m) => m.runId === runId);

function renderGallery() {
  const mine = ownMedia();
  $('count-media').textContent = mine.length || '';
  const host = $('gallery');
  host.replaceChildren();

  const shots = mine.filter((m) => m.kind === 'screenshot');
  const clips = mine.filter((m) => m.kind === 'recording');
  const elsewhere = media.length - mine.length;
  $('media-summary').textContent = mine.length
    ? t('report.media.summary', {
        shots: t(shots.length === 1 ? 'report.count.screenshotOne' : 'report.count.screenshotMany', { n: shots.length }),
        clips: t(clips.length === 1 ? 'report.count.recordingOne' : 'report.count.recordingMany', { n: clips.length }),
        size: kb(mine.reduce((n, m) => n + (m.bytes || 0), 0)),
      }) + (elsewhere ? ` ${t(elsewhere === 1 ? 'report.media.elsewhereOne' : 'report.media.elsewhereMany', { n: elsewhere })}` : '')
    : '';

  if (!mine.length) {
    const empty = el('div', 'empty');
    empty.append(
      iconP('i-screenshot'),
      el('h2', null, t('report.media.emptyTitle')),
      el('p', 'muted', t('report.media.emptyNote'))
    );
    host.append(empty);
    return;
  }

  for (const item of mine) {
    const card = el('article', 'shot-card');

    const stage = el('button', 'shot-stage');
    stage.type = 'button';
    // Type, not kind — see the same fix on the timeline row. A GIF clip has a
    // picture to show, so it gets a thumbnail rather than a play badge over a
    // video element that would never render it.
    const isVideo = item.kind === 'recording' && !(item.type || '').startsWith('image/');
    if (isVideo) {
      const badge = el('span', 'shot-play'); badge.append(svgIcon('i-play'));
      stage.append(badge);
      stage.classList.add('is-video');
      const clipName = item.label || t('report.ev.screenRecording');
      stage.setAttribute('aria-label', t('report.ev.openLarge', { what: clipName }));
      stage.addEventListener('click', () => lightbox(item.id, item.type || 'video/webm', { sourceEl: stage }));
    } else {
      const img = el('img');
      img.alt = item.label || t('report.ev.screenshot');
      img.loading = 'lazy';
      loadMediaInto(img, item.id);
      stage.append(img);
      stage.setAttribute('aria-label', t('report.ev.openLarge', { what: img.alt }));
      stage.addEventListener('click', () => lightbox(item.id, item.type || 'image/png', { sourceEl: stage, alt: img.alt }));
    }
    card.append(stage);

    const meta = el('div', 'shot-meta');
    meta.append(el('p', 'shot-label', item.label || (item.kind === 'recording' ? t('report.ev.screenRecording') : t('report.ev.screenshot'))));
    const facts = [rel(item.ts), (item.type || '').split('/')[1]?.toUpperCase(), kb(item.bytes || 0)];
    if (item.durationMs) facts.splice(1, 0, secs(item.durationMs));
    if (item.annotated) facts.push(t('report.media.annotated'));
    // A clip whose recorder died, or that a crash left half-written, is still
    // evidence — and the card has to say it is short rather than let somebody
    // conclude the bug stopped happening.
    if (item.incomplete) facts.push(t('report.media.incomplete'));
    // What went into the clip, so a silent recording is explained on the card
    // rather than discovered on playback.
    if (item.sources) {
      const on = Object.entries(item.sources).filter(([k, v]) => v && k !== 'tab').map(([k]) =>
        (k === 'tabAudio' ? t('report.media.tabAudio') : k === 'mic' ? t('report.media.mic') : k === 'webcam' ? t('report.media.webcam') : k)
      );
      if (on.length) facts.push(on.join(' + '));
    }
    meta.append(el('p', 'shot-facts', facts.filter(Boolean).join(' · ')));
    // The face is not missing, it is a track. Said on the card, because the
    // thumbnail of a clip recorded this way has no inset in it and a tester who
    // ticked the webcam will otherwise think it failed to record.
    if (webcamTrackOf(item)) meta.append(el('p', 'shot-webcam', t('report.media.webcamTrack')));
    card.append(meta);

    const actions = el('div', 'shot-actions');
    /*
     * Verify, not stamp.
     *
     * Every PNG is marked as it is stored — invisibly, in a tEXt chunk, without
     * a pixel moving — so there is nothing to ask for. What is worth offering
     * is the opposite: proof that the mark is there and a way to read what it
     * says, because a claim of attribution nobody can check is not attribution.
     */
    if (item.kind !== 'recording' && (item.type || '').includes('png')) {
      const check = el('button', 'btn btn-xs', t('report.media.origin'));
      check.title = t('report.media.originTitle');
      check.addEventListener('click', async () => {
        // T-066: the content check first, on the stored bytes in this page (crypto.subtle; no bytes through the worker).
        let content = { status: 'no checksum' };
        try {
          const got = await mediaBlob(item.id);
          if (got) content = await (await import('../core/integrity.js')).originCheck(await got.blob.arrayBuffer());
        } catch {
          /* unreadable: said as "no checksum", never as intact */
        }
        const words = t({ intact: 'report.media.contentIntact', 'content changed': 'report.media.contentChanged' }[content.status] || 'report.media.noChecksum');
        const res = await send({ type: 'UQA_MEDIA_PROVENANCE', id: item.id });
        if (!res.ok) return say(werr(res), 'err');
        const p = res.result;
        if (!p.provenance) {
          return say(`${words} ${t('report.media.noProvenance')}`, 'err');
        }
        say(
          `${words} ` +
          t('report.media.provenance', {
            software: p.Software,
            author: p.Author,
            session: p.provenance.session || t('report.media.noSession'),
            state: p.provenance.intact ? t('report.media.tokenOk') : t('report.media.tokenAltered'),
          }),
          p.provenance.intact && content.status === 'intact' ? 'ok' : 'err'
        );
      });
      actions.append(check);
    }
    if (item.kind !== 'recording') {
      const mark = el('button', 'btn btn-xs btn-primary', t('report.media.markUp'));
      mark.title = t('report.media.markUpTitle');
      mark.addEventListener('click', () => send({ type: 'UQA_OPEN_ANNOTATE', id: item.id }));
      actions.append(mark);
    }
    // A GIF is a recording and an image at once, and it has no editor —
    // the editor re-encodes into the clip's own container, which a GIF has
    // never had.
    if (item.kind === 'recording' && !(item.type || '').startsWith('image/')) {
      const edit = el('button', 'btn btn-xs btn-primary', t('report.media.editVideo'));
      edit.title = t('report.media.editVideoTitle');
      edit.addEventListener('click', () => send({ type: 'UQA_OPEN_VIDEOEDIT', id: item.id }));
      actions.append(edit);
    }
    const save = el('button', 'btn btn-xs', t('report.media.save'));
    save.addEventListener('click', () => saveOne(item, save));
    const del = el('button', 'btn btn-xs btn-danger', t('report.media.delete'));
    del.addEventListener('click', async () => {
      if (!confirm(t('report.media.deleteConfirm', { label: iso(item.label) }))) return;
      const res = await send({ type: 'UQA_MEDIA_DELETE', id: item.id });
      if (!res.ok) return say(werr(res), 'err');
      // The companion goes with its parent, here as well as in the store: a
      // layer whose clip is gone is not evidence of anything.
      setMedia(allMedia.filter((m) => m.id !== item.id && m.parentId !== item.id));
      renderGallery();
      say(t('report.media.deleted'));
    });
    actions.append(save, del);
    card.append(actions);

    host.append(card);
  }
}

/* ── lightbox ──────────────────────────────────────────────────────────── */

/**
 * Show one stored item full size.
 *
 * Takes the item's MIME type, not a word for its kind. It used to take
 * `'video'` or `'image'` and every caller derived that from `kind ===
 * 'recording'` — so an animated GIF, which is a recording *and* an image, was
 * always handed to `<video>` and rendered nothing.
 */
/**
 * The clip currently on screen, which is nobody's after the lightbox closes.
 *
 * A screenshot stays in `urlCache`, because the same URL is already on a
 * thumbnail and reusing it costs a few hundred kilobytes. A recording is
 * hundreds of megabytes and is on screen exactly once, so it gets a URL of its
 * own that is revoked the moment the lightbox shuts. Cached, it stayed pinned
 * until the tab closed, and watching five clips in one report held all five.
 */
let clipUrl = null;
/** And its webcam layer, which is a second clip's worth of bytes. */
let camUrl = null;

/**
 * The webcam layer, over the clip, in CSS.
 *
 * No re-encode to watch: the two recordings are two `<video>` elements, the
 * companion positioned at the geometry that was ticked and started at
 * `offsetMs` behind the clip. The stack is an inline-block sized by the clip
 * itself, so a percentage here is a percentage of the picture rather than of
 * the black around it.
 *
 * The clip drives, always. Two elements playing themselves drift within a few
 * seconds, and a face reacting to something that has not happened yet is worse
 * evidence than no face.
 */
function stackWebcam(main, cam, url) {
  const wrap = el('div', 'clip-stack');
  const layer = document.createElement('video');
  layer.className = 'clip-cam';
  layer.src = url;
  layer.muted = true; // the mix is on the clip; the cam recorder was video only
  layer.playsInline = true;
  const size = Math.min(60, Math.max(5, Number(cam.geometry?.size) || 22));
  const corner = cam.geometry?.position || 'bottom-right';
  layer.style.width = `${size}%`;
  layer.style[corner.includes('top') ? 'top' : 'bottom'] = '3%';
  layer.style[corner.includes('left') ? 'left' : 'right'] = '3%';

  const align = () => {
    const want = Math.max(0, main.currentTime * 1000 - (cam.offsetMs || 0)) / 1000;
    if (Number.isFinite(layer.duration) && want > layer.duration) return;
    if (Math.abs(layer.currentTime - want) > 0.25) layer.currentTime = want;
    if (main.paused && !layer.paused) layer.pause();
    if (!main.paused && layer.paused) layer.play().catch(() => {});
  };
  for (const event of ['play', 'pause', 'seeked', 'timeupdate']) main.addEventListener(event, align);
  layer.addEventListener('loadedmetadata', align, { once: true });

  wrap.append(main, layer);
  return wrap;
}

/**
 * @param {string} id the stored media record
 * @param {string} type its MIME type
 * @param {{seekMs?: number}} [at] where in a clip to start — used by the Window
 *   sizes rows, which point into the middle of the session's own recording
 *   rather than owning a clip of their own.
 */
/**
 * A thumbnail that opens the lightbox, as a real button (r2-08-1): a bare <img> with a click listener cannot
 * be reached or pressed from the keyboard. The label names what opens, in both languages.
 * @param {HTMLElement} child
 * @param {(btn: HTMLButtonElement) => void} open
 */
function evidenceOpener(child, open) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ev-open';
  btn.setAttribute('aria-label', t('report.ev.openLarge', { what: child.getAttribute('alt') || t('report.ev.screenshot') }));
  btn.append(child);
  btn.addEventListener('click', () => open(btn));
  return btn;
}

/** Whoever opened the lightbox, so closing it hands the keyboard back there (r2-08-1). */
let lightboxOpener = null;

async function lightbox(id, type = 'image/png', { seekMs = 0, sourceEl = null, alt = '' } = {}) {
  lightboxOpener = sourceEl && sourceEl.isConnected ? sourceEl : document.activeElement;
  const isImage = String(type).startsWith('image/');
  let url;
  if (isImage) {
    url = await mediaUrl(id);
  } else {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = null;
    const got = await mediaBlob(id);
    url = got ? URL.createObjectURL(got.blob) : null;
    clipUrl = url;
  }
  if (!url) return say(t('report.media.itemGone'), 'err');
  const stage = $('lightbox-stage');
  stage.replaceChildren();
  // The stage scales up from the thumbnail that was clicked, not from the
  // viewport centre — so it reads as that thumbnail materializing (F14).
  const origin = sourceEl?.getBoundingClientRect?.();
  stage.style.transformOrigin = origin
    ? `${origin.left + origin.width / 2}px ${origin.top + origin.height / 2}px`
    : '50% 50%';

  // The parent record, and the layer that belongs to it. Read from the store's
  // own list rather than passed in, so every call site gets the overlay without
  // knowing the companion exists.
  const parent = allMedia.find((m) => m.id === id) || null;
  const cam = isImage ? null : webcamTrackOf(parent);
  if (camUrl) { URL.revokeObjectURL(camUrl); camUrl = null; }
  if (cam) {
    const got = await mediaBlob(cam.id);
    camUrl = got ? URL.createObjectURL(got.blob) : null;
  }

  if (!isImage) {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    // D-1010-142 (WCAG 2.2.2): a person who asked for less motion is not given a clip that plays and loops on its own.
    v.autoplay = !prefersReduced();
    v.loop = !prefersReduced();
    if (seekMs > 0) {
      // On `loadedmetadata` and not before: `currentTime` set on a video whose
      // duration is unknown is silently dropped, and the clip starts at zero
      // with nothing to say it ignored the ask. Once, so the loop above does
      // not drag the viewer back to the offset on every repeat.
      v.addEventListener(
        'loadedmetadata',
        () => {
          const at = seekMs / 1000;
          if (Number.isFinite(v.duration) && at < v.duration) v.currentTime = at;
        },
        { once: true }
      );
    }
    stage.append(cam && camUrl ? stackWebcam(v, cam, camUrl) : v);
    // Same gate as the card button: only a real recording gets an editor.
    const editBtn = $('lightbox-edit');
    editBtn.hidden = false;
    editBtn.onclick = () => send({ type: 'UQA_OPEN_VIDEOEDIT', id });
  } else {
    $('lightbox-edit').hidden = true;
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt || t('report.ev.screenshot');
    stage.append(img);
  }
  const dlg = $('lightbox');
  if (!dlg.open) dlg.showModal();
}

const closeLightbox = () => {
  const dlg = $('lightbox');
  if (dlg.open) dlg.close();
  $('lightbox-stage').replaceChildren(); // stop any playing video
  // The clip's bytes go with it. `replaceChildren` drops the <video>, but the
  // object URL still holds the Blob alive, and a clip is the one item here big
  // enough for that to matter.
  if (clipUrl) {
    URL.revokeObjectURL(clipUrl);
    clipUrl = null;
  }
  if (camUrl) {
    URL.revokeObjectURL(camUrl);
    camUrl = null;
  }
  const back = lightboxOpener;
  lightboxOpener = null;
  if (back?.isConnected) back.focus?.();
};
$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox').addEventListener('close', closeLightbox); // native Escape closes the dialog without going through closeLightbox
$('lightbox').addEventListener('click', (e) => {
  if (e.target === $('lightbox')) closeLightbox();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('lightbox').open) closeLightbox();
});

/* ── raw export ────────────────────────────────────────────────────────── */

const CHUNK_LINES = 120;
const DATA_URI = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g;

/**
 * Never put a base64 screenshot on screen.
 *
 * The whole export used to go into one <pre> with white-space: pre-wrap, and a
 * Markdown report embeds every screenshot as a data URI — so that single text
 * node ran to hundreds of kilobytes and scrolling it dropped frames. The
 * display copy swaps each URI for a marker; `current.content` is untouched, so
 * Copy and Save still carry the real thing.
 */
function renderRaw(text) {
  const host = $('content');
  // The skeleton rows in report.html carry `aria-busy="true"`; replacing them
  // without clearing it leaves a screen reader told the pane is still loading
  // for the rest of the page's life.
  host.setAttribute('aria-busy', 'false');
  host.replaceChildren();
  const lines = text
    .replace(DATA_URI, (m) => t('report.raw.embedded', { kb: Math.round(m.length / 1024) }))
    .split('\n');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const block = el('pre', 'chunk', lines.slice(i, i + CHUNK_LINES).join('\n'));
    frag.append(block);
  }
  host.append(frag);
}

async function loadRaw() {
  const format = $('format').value;
  say(t('report.status.building'));
  // session.json is built here from the events the page holds, masked like every export (core/ai-brief.js)
  const res = format === 'session-json' ? { ok: true, result: BF.sessionJson(session, shownEvents(events)) } : await send({ type: 'UQA_EXPORT', sessionId, format });
  if (!res.ok) {
    $('content').textContent = '';
    return say(werr(res), 'err');
  }
  current = res.result;
  if (current.mime === 'image/svg+xml') {
    renderRaw(current.content);
    return say(t('report.raw.svgReady', { n: current.content.length.toLocaleString(QAWi18n.numTag()) }));
  }
  if (current.encoding === 'base64') {
    const kb = Math.round((current.content.length * 3) / 4 / 1024);
    renderRaw(t('report.raw.workbookBody', { kb, filename: current.filename }));
    return say(t('report.raw.workbookReady', { kb }));
  }
  renderRaw(current.content);
  say(t('report.raw.charsReady', { n: current.content.length.toLocaleString(QAWi18n.numTag()) }));
}

$('format').addEventListener('change', loadRaw);

$('copy').addEventListener('click', async () => {
  if (!current) return;
  if (current.encoding === 'base64') return say(t('report.raw.workbookNoCopy'), 'err');
  try {
    await navigator.clipboard.writeText(current.content);
    say(t('report.raw.copied'));
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('content'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    say(t('report.raw.copyFallback'), 'err');
  }
});

/* ── saving, into the category tree ────────────────────────────────────── */

let filing = null;
async function filingLib() {
  if (!filing) { filing = await import('../core/filing.js'); await bugfirstReady; filing.useTitle(() => BF.heroTitle({ session, events, t, summarise })); }
  return filing;
}

/**
 * r10-10-5 (D-240): a saved file's name in the tester's language. The format's own key is the one the format
 * picker already uses (report.raw.fmt*, read off its option), so the table, the picker and the card agree; a
 * format with no entry there keeps the label it was saved with. core/filing.js keeps the English label.
 * @param {string} format
 */
function formatLabelKey(format) {
  if (!format) return '';
  const key = format === 'session-manifest'
    ? 'report.part.sessionCard'
    : [...document.querySelectorAll('#format option')].find((o) => o.value === format)?.getAttribute('data-i18n');
  return key && QAWi18n.has(key) ? key : '';
}

/** @param {string} format @param {string} content @param {string} mime @param {{ encoding?: string, audience?: boolean, label?: string }} [opts] */
async function saveExport(format, content, mime, { encoding, audience = true, label } = {}) {
  // The extension and the folder both come from core/filing.js. They used to be
  // a local table here that knew about seven formats while the worker exported
  // twelve, so the five it had never heard of were written as `.txt`.
  const { exportPath, FORMATS } = await filingLib();
  const path = exportPath(format, session, { clock: settings?.clock || '24', folder: settings?.downloadFolder || '' });
  let data = content;
  if (encoding === 'base64') {
    const { fromBase64 } = await import('../core/xlsx.js');
    data = new Blob([fromBase64(content)], { type: mime });
  }
  const res = await window.UQADownload.saveFiled(data, path, mime);
  if (res.ok) {
    await send({
      type: 'UQA_EXPORT_SAVED', sessionId, format, label: label || (formatLabelKey(format) ? t(formatLabelKey(format)) : FORMATS[format]?.label || format),
      path: res.path || path, bytes: data instanceof Blob ? data.size : String(data).length, how: res.how,
    });
    renderSaved();
  }
  return res;
}

/* ── what was saved, kept with the session ─────────────────────────────── */

async function renderSaved() {
  /* The replay, if one was recorded. Asked for by size rather than by content:
     `UQA_REPLAY_INFO` reads the chunk headers and inflates nothing, so a
     session with a large replay costs the timeline nothing to offer it. */
  send({ type: 'UQA_REPLAY_INFO', sessionId }).then((info) => {
    const btn = document.getElementById('watch-replay');
    if (!btn || !info?.ok || !info.result?.entries) return;
    const kb = Math.max(1, Math.round((info.result.stored || 0) / 1024));
    btn.textContent = t('report.timeline.replayKb', { kb });
    btn.hidden = false;
    managed(btn, 'replayAllowed');
    btn.addEventListener('click', () => send({ type: 'UQA_OPEN_REPLAY', sessionId }));
  });

  // D-1010-155: ask for the export rows only. A worker that ignores `kinds` answers the whole session, so the filter stays;
  // and the answer is read into a local, because the page-wide `events` must never be narrowed to the exports.
  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId, kinds: ['export'] });
  const rows = res.ok ? res.result.events || events : events;
  const saved = rows.filter((e) => e.kind === 'export');
  $('saved-block').hidden = !saved.length;
  if (!saved.length) return;
  const host = $('saved');
  host.replaceChildren();
  const table = el('table', 'saved-table');
  const head = el('tr');
  for (const h of [t('report.saved.when'), t('report.saved.what'), t('report.saved.where')]) head.append(el('th', null, h));
  table.append(head);
  for (const e of [...saved].reverse()) {
    const tr = el('tr');
    tr.append(el('td', 'muted', fmtDate(e.ts)));
    tr.append(el('td', null, formatLabelKey(e.format) ? t(formatLabelKey(e.format)) : e.label || e.format)); // r10-10-5: the picker's own word, in the language on screen
    tr.append(el('td', 'mono', e.path));
    table.append(tr);
  }
  host.append(table);
}

/**
 * Save one stored item, and always say what happened.
 *
 * It used to return `undefined` on every path — including its two early
 * returns — so the caller's `failed` list was unreachable and "Save everything"
 * counted a file it had not written. Worse, two of its statements can *throw*:
 * `fetch(url).blob()` on an object URL that has been revoked, and
 * `UQAFolder.usable({ prompt: true })` once the user gesture is spent. A throw
 * out of here aborted the whole loop in "Save everything" and left `#save-go`
 * disabled for ever, with no message and no way back but a reload.
 *
 * So: one result shape on every path, and a try/catch that turns a throw into
 * that same shape.
 */
async function saveOne(item, button) {
  const fail = (error) => {
    if (button) {
      button.textContent = t('report.media.failed');
      setTimeout(() => button && (button.textContent = t('report.media.save')), TIMING.savedLabel);
    }
    say(t('report.save.couldNot', { error }), 'err');
    return { ok: false, item: item.id, error };
  };

  try {
    const { evidencePath } = await filingLib();
    /*
     * The folder permission, asked for before anything else.
     *
     * `saveFiled` asks for it deep inside itself, by which point the user
     * gesture that opened this save has usually been spent on the fetch and the
     * encode — so a granted team folder silently fell back to the downloads
     * directory, and the tester's filing tree stopped filling up with no
     * warning that it had. Asking first, while the gesture is still live, is
     * what keeps the folder.
     */
    await window.UQAFolder?.usable?.({ prompt: true })?.catch?.(() => false);

    // The Blob itself, not an object URL fetched back into one. Saving a clip
    // used to mint a cached URL for it and then read the whole thing through
    // `fetch`, which pinned the clip in this page for the life of the tab for
    // no reason: the file goes to disk and is never shown here.
    const got = await mediaBlob(item.id);
    if (!got) return fail(t('report.save.itemGoneShort'));
    const blob = got.blob;
    // Numbered in the order it was taken, among its own kind.
    const kin = media.filter((m) => (m.kind === 'recording') === (item.kind === 'recording')).sort((a, b) => a.ts - b.ts);
    const ordinal = Math.max(1, kin.findIndex((m) => m.id === item.id) + 1);
    const path = evidencePath(item, ordinal, session, { clock: settings?.clock || '24', folder: settings?.downloadFolder || '' });
    if (button) button.textContent = t('report.media.saving');
    const res = await window.UQADownload.saveFiled(blob, path);
    if (button) button.textContent = res.ok ? t('report.media.saved') : t('report.media.failed');
    setTimeout(() => button && (button.textContent = t('report.media.save')), TIMING.savedLabel);
    if (!res.ok) return fail(werr(res));
    say(t('report.save.savedTo', { path: res.path || path }), '');
    // `how` travels with the result so the caller can say whether the browser
    // listed the file. It is per file because the fallback is per file: one
    // clip can go to Downloads while the rest reached the granted folder.
    return { ok: true, item: item.id, path: res.path || path, how: res.how };
  } catch (err) {
    return fail(werr(err) || String(err));
  }
}

$('save').addEventListener('click', async () => {
  if (!current) return;
  say(t('report.media.saving'));
  const res = await saveExport($('format').value, current.content, current.mime, { encoding: current.encoding });
  if (!res.ok) return say(t('report.save.couldNot', { error: werr(res) }), 'err');
  // One file, so the path is the confirmation. The clause after it is the half
  // that was missing: where to look for it if it is not in the downloads bar.
  say(
    res.how === 'folder'
      ? t('report.save.savedFolder', { path: res.path })
      : t('report.save.savedDownloads', { path: res.path || current.filename })
  );
});

$('media-save').addEventListener('click', async () => {
  // What this tab shows is what this button saves. A clip belonging to a
  // window-size run has its own card under Window sizes, so it is not written
  // twice under two names.
  const mine = ownMedia();
  if (!mine.length) return say(t('report.media.nothingToSave'), 'err');
  say(t('report.save.savingFiles', { files: t(mine.length === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: mine.length }) }));
  let done = 0;
  const failed = [];
  const routes = new Set();
  for (const item of mine) {
    // Sequential on purpose: Chrome throttles concurrent downloads and drops
    // the excess, which would silently save four of nine files.
    const out = await saveOne(item, null);
    if (out?.how) routes.add(out.how);
    if (out?.ok) done++;
    else failed.push(`${item.label || item.kind}: ${werr(out) || t('report.save.unknownError')}`);
  }
  // The same sentence the Save sheet prints, for the same reason: a count on
  // its own does not tell anybody where to go and look.
  const { describeSaved } = await filingLib();
  const where = await saveWhere();
  const how = routes.has('downloads-fallback') ? 'downloads-fallback' : routes.has('folder') ? 'folder' : 'downloads';
  let line = describeSaved({
    count: done,
    where: how === 'downloads-fallback' ? '' : `${where.path}Screenshots/ and Recordings/`,
    how,
    failed: failed.length,
  });
  if (failed.length) line += ` ${failed.join('; ')}`;
  say(line, failed.length ? 'err' : '');
  if (done) {
    window.UQADownload.announce(
      t('report.save.announceTitle', { files: t(done === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: done }) }),
      how === 'folder'
        ? t('report.save.announceFolder', { path: where.path })
        : t('report.save.announceDownloads', { path: where.path })
    );
  }
});

/**
 * "Save everything" — the whole session as a filed set, not one file.
 *
 * This is what the category tree is for: one press produces the report, the
 * ticket, the spec, the session sheet and every screenshot and clip, each in
 * the folder its reader will look in.
 */
/* ── the save dialog: which parts, for whom, where ─────────────────────── */

/**
 * One of each kind per shelf, not one of each format: the reader who wants
 * Markdown does not also want YAML. "For people" is what a colleague opens;
 * "For AI" is what an agent is pointed at. Tool outputs appear only when the
 * tool ran — an export that throws "no page map" is noise, not a file.
 */
function saveParts() {
  const has = (k) => events.some((e) => e.kind === k);
  const groups = [
    { id: 'human', label: t('report.save.groupPeople'), items: [
      ['markdown', t('report.part.markdown'), t('report.part.markdownNote')],
      ['html', t('report.part.html'), t('report.part.htmlNote')],
      ['sbtm', t('report.part.sbtm'), t('report.part.sbtmNote')],
      ['sheet-xlsx', t('report.part.sheetXlsx'), t('report.part.sheetXlsxNote')],
      ['timeline-xlsx', t('report.part.timelineXlsx'), t('report.part.timelineXlsxNote')],
      ['srs-html', t('report.part.srsHtml'), t('report.part.srsHtmlNote')],
      ['srs', t('report.part.srs'), t('report.part.srsNote')],
      ['manual-html', t('report.part.manualHtml'), t('report.part.manualHtmlNote')],
      // Only when one was read: a document nobody asked for should not be
      // offered as though it exists.
      ...(has('spec') ? [['spec-reverse', t('report.part.specReverse'), t('report.part.specReverseNote')]] : []),
      ...(has('fineprint') ? [['fine-print', t('report.part.finePrint'), t('report.part.finePrintNote')]] : []),
      ['manual', t('report.part.manual'), t('report.part.manualNote')],
      ['storyboard-html', t('report.part.storyboardHtml'), t('report.part.storyboardHtmlNote')],
      ['flow-svg', t('report.part.flowSvg'), t('report.part.flowSvgNote')],
      ...(has('links') ? [['links-html', t('report.part.linksHtml'), t('report.part.linksHtmlNote')], ['links', t('report.part.links'), t('report.part.linksNote')]] : []),
    ] },
    { id: 'ai', label: t('report.save.groupMachine'), items: [
      ['json', t('report.part.json'), t('report.part.jsonNote')],
      ['agent', t('report.part.agent'), t('report.part.agentNote')],
      ['locator-set', t('report.part.locatorSet'), t('report.part.locatorSetNote')],
      ['test-plan', t('report.part.testPlan'), t('report.part.testPlanNote')],
      ['locator-sheet', t('report.part.locatorSheet'), t('report.part.locatorSheetNote')],
      ['yaml', t('report.part.yaml'), t('report.part.yamlNote')],
      ['storyboard', t('report.part.storyboard'), t('report.part.storyboardNote')],
      ['flow-json', t('report.part.flowJson'), t('report.part.flowJsonNote')],
      ['playwright', t('report.part.playwright'), t('report.part.playwrightNote')],
      ['junit', t('report.part.junit'), t('report.part.junitNote')],
      ['har', t('report.part.har'), t('report.part.harNote')],
      ['postman', t('report.part.postman'), t('report.part.postmanNote')],
      ['postman-env', t('report.part.postmanEnv'), t('report.part.postmanEnvNote')],
      ...(has('harvest') ? [['harvest-map', t('report.part.harvestMap'), t('report.part.harvestMapNote')], ['harvest-pom', t('report.part.harvestPom'), t('report.part.harvestPomNote')], ['harvest-brief', t('report.part.harvestBrief'), t('report.part.harvestBriefNote')]] : []),
      ...(has('a11y') ? [['a11y', t('report.part.a11y'), t('report.part.a11yNote')]] : []),
    ] },
    { id: 'tickets', label: t('report.save.groupTickets'), items: [
      ['jira', t('report.part.jira'), t('report.part.jiraNote')],
      ['github', t('report.part.github'), t('report.part.githubNote')],
      ['csv', t('report.part.csv'), t('report.part.csvNote')],
    ] },
    { id: 'evidence', label: t('report.save.groupEvidence'), items: [
      ['media:screenshot', t('report.part.screenshots', { n: media.filter((m) => m.kind !== 'recording').length }), t('report.part.screenshotsNote')],
      ['media:recording', t('report.part.recordings', { n: media.filter((m) => m.kind === 'recording').length }), t('report.part.recordingsNote')], ['media:notes', t('report.part.exp1022Notes', { n: (events || []).filter((e) => e.kind === 'note' && e.tag !== 'technique' && String(e.text ?? '').trim()).length }), t('report.part.exp1022NotesNote')],
      // The soundtrack on its own, for the half of QA that is listened to: a
      // tester quoting what the app said, a transcript, a bug where the audio
      // is the evidence and a 40 MB clip is not.
      ...(media.some((m) => m.kind === 'recording')
        ? [['media:audio', t('report.part.audio', { n: media.filter((m) => m.kind === 'recording').length }), t('report.part.audioNote')]]
        : []),
    ] },
    { id: 'team', label: t('report.save.groupTeam'), items: [
      ['session-manifest', t('report.part.sessionCard'), t('report.part.sessionCardNote')],
    ] },
  ];
  return groups;
}

/**
 * The whole walk's accessibility findings, folded to unique ones.
 *
 * Loaded on demand: `core/a11y-flow.js` is only wanted when a report with more
 * than one scan is opened, and this page already imports enough.
 */
let foldMod = null;
async function foldFlow() {
  if (!events.some((e) => e.kind === 'a11y')) return null;
  foldMod ||= await import('../core/a11y-flow.js');
  return foldMod.foldFindings(events, { currentUrl: session?.startUrl || '' });
}

/** One line for where a folded finding was seen. */
function describeFold(f) {
  if (f.pages.length === 1) return t('report.a11y.foldOn', { page: iso(f.pages[0]) });
  if (f.everywhere) return t('report.a11y.foldEverywhereList', { list: f.pages.join(', ') });
  return t('report.a11y.foldPages', {
    pages: t(f.pages.length === 1 ? 'report.count.pageOne' : 'report.count.pageMany', { n: f.pages.length }),
    list: f.pages.join(', '),
  });
}

/** How many parts are ticked, said in the sheet rather than counted by eye. */
function paintSaveCount() {
  const boxes = [...$('save-parts').querySelectorAll('input[type="checkbox"]')];
  const on = boxes.filter((b) => b.checked).length;
  $('save-count').textContent = boxes.length
    ? on
      ? t('report.save.selected', { files: t(on === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: on }), total: boxes.length })
      : t('report.save.nothingSelected')
    : '';
  // Each section's pair says what that section is, so the tester can see at a
  // glance which ones are whole and which are partial.
  for (const fs of $('save-parts').querySelectorAll('fieldset.attach')) {
    const own = [...fs.querySelectorAll('input[type="checkbox"]')];
    const ticked = own.filter((b) => b.checked).length;
    fs.querySelector('[data-section-all]')?.setAttribute('aria-pressed', String(ticked === own.length));
    fs.querySelector('[data-section-none]')?.setAttribute('aria-pressed', String(ticked === 0));
  }
}

async function renderSaveParts() {
  const host = $('save-parts');
  const { isMoreFormat } = await filingLib();
  // T-049: formats off the keep-list move to a last, unticked "More" shelf.
  const groups = saveParts();
  const more = [];
  for (const g of groups) g.items = g.items.filter((it) => (isMoreFormat(it[0]) ? (more.push(it), false) : true));
  groups.push({ id: 'more', label: t('report.save.groupMore'), items: more });
  host.replaceChildren();
  for (const g of groups) {
    if (!g.items.length) continue;
    const fs = el('fieldset', 'attach');
    /*
     * All and None per section, not once for the sheet.
     *
     * "Everything" and "Nothing" at the foot are the two extremes, and a tester
     * saving a session almost never wants either: they want the documents and
     * not the eleven screenshots, or the evidence and none of the JSON. Doing
     * that with one button meant clearing all of it and re-ticking by hand.
     * These are real buttons in the tab order, they say which section they
     * belong to, and `aria-pressed` says whether that section is currently
     * whole or empty.
     */
    const head = el('div', 'attach-head');
    head.append(el('legend', null, g.label));
    const pair = el('div', 'attach-pick');
    for (const [word, on] of [[t('report.save.sectionAll'), true], [t('report.save.sectionNone'), false]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-quiet';
      b.textContent = word;
      b.dataset[on ? 'sectionAll' : 'sectionNone'] = g.id;
      b.setAttribute('aria-label', t('report.save.sectionAria', { word, group: g.label }));
      b.addEventListener('click', () => {
        for (const box of fs.querySelectorAll('input[type="checkbox"]')) box.checked = on;
        paintSaveCount();
      });
      pair.append(b);
    }
    head.append(pair);
    fs.append(head);
    const list = el('div', 'attach-list');
    for (const [id, label, note] of g.items) {
      const item = el('label', 'attach-item');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = id;
      box.checked = g.id !== 'more';
      box.dataset.group = g.id;
      box.addEventListener('change', paintSaveCount);
      item.append(box, el('span', 'attach-name', label), el('span', 'attach-note', note));
      list.append(item);
    }
    fs.append(list);
    host.append(fs);
  }
  paintSaveCount();
  renderPresets();
}

/** T-067: five chips above the shelves. A chip only ticks boxes; it never saves. */
async function renderPresets() {
  const { PRESETS, presetFormats } = await import('../core/presets.js');
  const row = $('save-presets');
  row.replaceChildren();
  for (const id of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-quiet';
    b.dataset.preset = id;
    b.textContent = t(`report.preset.${id}`);
    b.title = t(`report.preset.${id}.hint`);
    b.addEventListener('click', () => {
      const want = new Set(presetFormats(id));
      for (const box of $('save-parts').querySelectorAll('input[type="checkbox"]')) {
        if (!box.value.startsWith('media:')) box.checked = want.has(box.value);
      }
      paintSaveCount();
    });
    row.append(b);
  }
}

/**
 * Where the files are about to go, and whether the browser will list them.
 *
 * Built from `destination()` in core/filing.js rather than from `ROOT` and a
 * folder name, so this sheet, the Settings page and the sentence printed after
 * the save cannot disagree — and so a folder already called `QA Wrap` is
 * described the way it is actually written to, with one root and not two.
 *
 * The download-list half is the point. Nader saved thirty-eight files into a
 * granted folder and found nothing in his downloads; the sheet has to say that
 * before he presses the button, not after.
 */
async function saveWhere() {
  const { destination } = await filingLib();
  const handle = await window.UQAFolder?.get();
  const usable = handle ? await window.UQAFolder.usable() : null;
  // The remembered subfolder, in the sentence that says where things land. It
  // is the only half of "remember my folder" a browser extension is allowed to
  // keep: see DOWNLOAD_FOLDER_HELP in platform/settings.js.
  const folder = (settings?.downloadFolder || '').trim();
  return {
    handle,
    usable,
    path: destination({ folderName: usable ? handle.name : '', folder }),
    how: usable ? 'folder' : 'downloads',
  };
}

async function paintSaveWhere() {
  const { handle, usable, path } = await saveWhere();
  $('save-where').textContent = !handle
    ? t('report.save.whereDownloads', { path })
    : usable
      ? t('report.save.whereFolder', { path })
      : t('report.save.whereAsk', { name: handle.name });
  $('save-use-downloads').hidden = !handle;
}

async function openSaveDialog() {
  await renderSaveParts();
  paintSaveWhere();
  $('save-status').textContent = '';
  $('save-dialog').showModal();
  window.UQASound?.play('save.open');
  window.UQAVfx?.play('settle', $('save-dialog').querySelector('form'));
}

/**
 * Clicking outside the sheet closes it, as well as the × (D6).
 *
 * A `<dialog>` opened with `showModal()` fills the viewport: the backdrop is
 * painted by the dialog element itself, and the form inside it is what the
 * tester sees. So a click whose target *is* the dialog landed on the backdrop
 * and nowhere else, and a click anywhere on the form does not reach here at
 * all. That one comparison is the whole test, and it needs no overlay div, no
 * capture-phase listener and no coordinate arithmetic against
 * `getBoundingClientRect()`, which is the version that gets the edges wrong on
 * a scrolled or scaled page.
 *
 * `Escape` already closes it: `<dialog>` does that itself.
 */
$('save-dialog').addEventListener('click', (e) => {
  if (e.target === $('save-dialog')) $('save-dialog').close();
});

$('save-all').addEventListener('click', openSaveDialog);
$('copy-report').addEventListener('click', () => BF.headerCopy({ ctx: window.UQAReport.mail, t, say }));
$('save-close').addEventListener('click', () => $('save-dialog').close());
$('save-everything').addEventListener('click', () => { $('save-parts').querySelectorAll('input').forEach((i) => { i.checked = true; }); paintSaveCount(); });
$('save-none').addEventListener('click', () => { $('save-parts').querySelectorAll('input').forEach((i) => { i.checked = false; }); paintSaveCount(); });
/** D-1010-140: the keyed sentence on screen, the raw message only in the title. */
async function showFailure(node, err) {
  const { describeError } = await import('../platform/worker-errors.js');
  const d = describeError(err, t);
  node.textContent = d.text;
  (await import('../platform/worker-errors.js')).attachDetails(node, d, t);
}
$('save-pick-folder').addEventListener('click', async () => {
  try {
    const handle = await window.UQAFolder.choose();
    await send({ type: 'UQA_SET_SETTINGS', patch: { saveFolderName: handle.name } });
  } catch (err) {
    if (err?.name !== 'AbortError') showFailure($('save-status'), err);
  }
  paintSaveWhere();
});
$('save-use-downloads').addEventListener('click', async () => {
  await window.UQAFolder.clear();
  await send({ type: 'UQA_SET_SETTINGS', patch: { saveFolderName: '' } });
  paintSaveWhere();
});

$('save-go').addEventListener('click', async () => {
  const chosen = [...$('save-parts').querySelectorAll('input:checked')].map((i) => i.value);
  if (!chosen.length) return ($('save-status').textContent = t('report.save.nothingTicked'));
  const status = $('save-status');
  const failed = [];
  const written = [];
  // Which route each file actually took. Read back rather than assumed: a
  // granted folder that has become unwritable falls back to Downloads per
  // file, and that is the case the confirmation most needs to report.
  const routes = new Set();
  $('save-go').disabled = true;
  // Re-enabled in a `finally` below whatever any of this does: the button was
  // disabled here and re-enabled only on the success path, so one throw left
  // "Save everything" dead for the life of the page.
  try {

    const formats = chosen.filter((c) => !c.startsWith('media:') && c !== 'session-manifest');
    if ($('save-zip').checked && formats.length) {
      // T-067: one zip instead of one file per part; the worker builds every part and adds the pictures.
      status.textContent = t('report.save.savingFormat', { format: 'zip' });
      const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'bundle', parts: formats });
      if (!res.ok) failed.push(`zip: ${werr(res)}`);
      else {
        const out = await saveExport('bundle', res.result.content, res.result.mime, { encoding: res.result.encoding });
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path || res.result.filename) : failed.push(`zip: ${werr(out)}`);
      }
      formats.length = 0;
    }
    for (const format of formats) {
      status.textContent = t('report.save.savingFormat', { format });
      const res = await send({ type: 'UQA_EXPORT', sessionId, format });
      if (!res.ok) { failed.push(`${format}: ${werr(res)}`); continue; }
      const out = await saveExport(format, res.result.content, res.result.mime, { encoding: res.result.encoding });
      if (out.how) routes.add(out.how);
      out.ok ? written.push(out.path || res.result.filename) : failed.push(`${format}: ${werr(out)}`);
    }
    const wantShots = chosen.includes('media:screenshot');
    const wantClips = chosen.includes('media:recording');
    for (const item of media) {
      const isClip = item.kind === 'recording';
      if ((isClip && !wantClips) || (!isClip && !wantShots)) continue;
      status.textContent = t('report.save.savingItem', { label: item.label || item.kind });
      // Branched on the result, which is the whole point of there being one.
      const out = await saveOne(item, null);
      if (out?.how) routes.add(out.how);
      if (out?.ok) written.push(out.path || item.label || item.kind);
      else failed.push(`${item.label || item.kind}: ${werr(out) || t('report.save.unknownError')}`);
    }
    /*
     * The soundtrack, taken out of the clips that have one.
     *
     * `UQA_MEDIA_AUDIO` does the extraction in the worker (it is the side that
     * holds the bytes) and answers with a wav. The filename is built here, from
     * the same `evidencePath()` every other artefact goes through, so an audio
     * export lands in Recordings beside the clip it came from and carries the
     * same stamp — and the remembered "Save into" folder, like everything else.
     */
    /*
     * The reverse-engineered specification is already written.
     *
     * Every other document in this list is made on demand by the worker; this
     * one was made when the tester pressed the tool, and the Markdown is on the
     * event. Re-deriving it would read a page that has since changed and hand
     * back a different document under the same name.
     */
    if (chosen.includes('fine-print')) {
      const read = [...events].reverse().find((e) => e.kind === 'fineprint');
      if (!read?.markdown) failed.push(t('report.save.finePrintMissing'));
      else {
        status.textContent = t('report.save.savingFinePrint');
        // Its own format id, not `srs`. Filing it under the specification's
        // name is what put a 12 KB "Requirements specification (2).md" in
        // Nader's folder that was not one: see rule 5 in core/filing.js.
        const out = await saveExport('fine-print', read.markdown, 'text/markdown');
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.finePrintFailed', { error: werr(out) }));
      }
    }
    if (chosen.includes('spec-reverse')) {
      const read = [...events].reverse().find((e) => e.kind === 'spec');
      if (!read?.markdown) failed.push(t('report.save.specMissing'));
      else {
        status.textContent = t('report.save.savingSpec');
        const out = await saveExport('spec-reverse', read.markdown, 'text/markdown');
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.specFailed', { error: werr(out) }));
      }
    }
    if (chosen.includes('media:notes')) { const r = await (await import('./notes-file.js')).saveNotes({ session, events, filing: await filingLib(), settings, say: t }); r.routes.forEach((x) => routes.add(x)); written.push(...r.written); failed.push(...r.failed); }
    if (chosen.includes('media:audio')) { const { evidencePath } = await filingLib();
      const clips = media.filter((m) => m.kind === 'recording').sort((a, b) => a.ts - b.ts);
      for (const [i, clip] of clips.entries()) {
        status.textContent = t('report.save.savingAudio', { label: clip.label || t('report.save.theRecording') });
        const filename = evidencePath({ ...clip, type: 'audio/wav' }, i + 1, session, {
          clock: settings?.clock || '24',
          folder: settings?.downloadFolder || '',
        }).replace(/\.[^./]+$/, '.wav');
        const res = await send({ type: 'UQA_MEDIA_AUDIO', id: clip.id, filename, saveAs: !!settings?.saveAs });
        if (res?.ok) { routes.add('downloads'); written.push(res.result?.path || filename); }
        else failed.push(t('report.save.audioFailed', { label: clip.label || t('report.save.aRecording'), error: werr(res) || t('report.save.unknownError') }));
      }
    }
    if (chosen.includes('session-manifest')) {
      // Written last, so the card lists what was actually saved beside it.
      const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'session-manifest', files: written });
      if (!res.ok) failed.push(t('report.save.cardFailed', { error: werr(res) }));
      else {
        const out = await saveExport('session-manifest', res.result.content, res.result.mime);
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.cardFailed', { error: werr(out) }));
      }
    }

    /*
     * The confirmation, which is the whole of D2.
     *
     * It has to name three things: how many files, which folder they are in,
     * and whether the browser knows about them. The count alone was what
     * shipped, and it is exactly the sentence that sends somebody hunting
     * through Downloads for files that were never downloaded.
     *
     * The route is read back from what actually happened rather than from the
     * settings, because `saveFiled()` falls back to Downloads when a granted
     * folder turns out to be unwritable, and that fallback is the case the
     * tester most needs told.
     */
    const { describeSaved } = await filingLib();
    const where = await saveWhere();
    const how = routes.has('downloads-fallback') ? 'downloads-fallback'
      : routes.has('folder') ? 'folder'
        : 'downloads';
    let line = describeSaved({
      count: written.length,
      where: how === 'downloads-fallback' ? '' : where.path,
      how,
      failed: failed.length,
    });
    if (failed.length) line += ` ${failed.join('; ')}`;
    status.textContent = line;
    say(line, failed.length ? 'err' : '');
    // The same three facts, outside the page, for the tester who pressed Save
    // and switched to another window (D8).
    if (written.length) {
      window.UQADownload.announce(
        t('report.save.announceTitle', { files: t(written.length === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: written.length }) }),
        how === 'folder'
          ? t('report.save.announceFolder', { path: where.path })
          : t('report.save.announceDownloads', { path: where.path })
      );
    }
    window.UQASound?.play(failed.length ? 'status.warn' : 'save.done');
    window.UQAVfx?.status(status, failed.length ? 'err' : 'ok');
    renderSaved();
    renderTeam();
  } finally {
    $('save-go').disabled = false;
  }
});

/* ── the team's sessions, read from the shared folder ──────────────────── */

async function renderTeam() {
  const block = $('team-block');
  const handle = await window.UQAFolder?.get();
  if (!handle) return (block.hidden = true);
  block.hidden = false;
  const usable = await window.UQAFolder.usable();
  $('team-grant').hidden = !!usable;
  if (!usable) {
    $('team-note').textContent = t('report.team.needPermission', { name: handle.name });
    $('team').replaceChildren();
    return;
  }
  const { ROOT, CATEGORIES } = await filingLib();
  const cards = [];
  try {
    const root = await usable.getDirectoryHandle(ROOT, { create: false });
    const dir = await root.getDirectoryHandle(CATEGORIES.sessions, { create: false });
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try { cards.push(JSON.parse(await (await h.getFile()).text())); } catch { /* not ours */ }
    }
  } catch {
    $('team-note').textContent = t('report.team.noCards', { where: `${handle.name}/${ROOT}/${CATEGORIES.sessions}` });
    $('team').replaceChildren();
    return;
  }
  cards.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  $('team-note').textContent = t(cards.length === 1 ? 'report.team.cardsOne' : 'report.team.cardsMany', {
    n: cards.length,
    where: `${handle.name}/${ROOT}/${CATEGORIES.sessions}`,
  });
  const host = $('team');
  host.replaceChildren();
  const table = el('table', 'saved-table');
  const head = el('tr');
  for (const h of [t('report.team.when'), t('report.team.who'), t('report.team.charter'), t('report.team.site'), t('report.team.result')]) head.append(el('th', null, h));
  table.append(head);
  for (const c of cards.slice(0, 40)) {
    const tr = el('tr');
    if (c.id === sessionId) tr.className = 'mine';
    tr.append(el('td', 'muted', (c.startedAt || '').replace('T', ' ').slice(0, 16)));
    tr.append(el('td', c.tester ? null : 'muted', c.tester || t('report.team.notNamed')));
    tr.append(el('td', null, c.charter || ''));
    tr.append(el('td', 'muted', c.host || ''));
    tr.append(
      el(
        'td',
        c.verdict === 'clean' ? 'result-pass' : 'result-fail',
        c.verdict === 'clean'
          ? `${t('report.team.clean')} · ${t('common.signal.coverage')}`
          : c.counts?.failures == null
            ? t('report.team.unknownFailures')
            : t(c.counts.failures === 1 ? 'report.count.failureOne' : 'report.count.failureMany', { n: c.counts.failures })
      )
    );
    table.append(tr);
  }
  host.append(table);
}
$('team-grant').addEventListener('click', async () => {
  await window.UQAFolder.usable({ prompt: true });
  renderTeam();
});

/* ── the diagram, as a view rather than a button in the corner ─────────── */

/**
 * The workflow diagram, drawn inside the report (F2).
 *
 * It used to be a button in the action bar that opened a separate page, which
 * put the one picture the report has among the actions rather than among the
 * ways of looking at the session, so most readers never learned it was there.
 * The SVG the exporter already builds is the same SVG the editor draws, so this
 * costs nothing but a message: the tab shows it, and the editor stays one press
 * away for anyone who wants to move a box or print it.
 *
 * `innerHTML` would be the short way to put an SVG string on a page and it is
 * deliberately not used: the diagram is built from the session's own labels,
 * which come from whatever page was under test, and parsing a stranger's text
 * as markup inside an extension page is the exact shape of bug this product
 * must not have. `DOMParser` with an XML type parses it as data.
 */
let diagramReady = false;

async function renderDiagram() {
  const frame = $('diagram-frame');
  if (!frame) return;
  diagramReady = true;
  frame.replaceChildren(el('p', 'muted', t('report.diagram.laying')));

  const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'flow-svg' });
  if (!res.ok) {
    frame.replaceChildren(el('p', 'muted err', werr(res) || t('report.diagram.failed')));
    return;
  }
  try {
    const doc = new DOMParser().parseFromString(res.result.content, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName === 'parsererror') throw new Error(t('report.diagram.malformed'));
    frame.replaceChildren(document.importNode(svg, true));
  } catch (err) {
    frame.replaceChildren(el('p', 'muted err', t('report.diagram.shownFailed', { error: err.message })));
  }
}

$('diagram-open')?.addEventListener('click', () =>
  window.open(chrome.runtime.getURL(`diagram/diagram.html?session=${encodeURIComponent(sessionId)}`), '_blank', 'noopener')
);
$('diagram-refresh')?.addEventListener('click', renderDiagram);

/* ── keeping up with the worker ────────────────────────────────────────── */

/**
 * The report repaints when the stored evidence changes under it.
 *
 * Two bugs, one cause. A screenshot marked up in the annotate page is written
 * back under the same media id, and this page held both a cached object URL for
 * it and a `media` array read once at load: so the report went on showing the
 * unmarked picture for the life of the tab, which is F3's "after editing, the
 * report outside must show the edited image". Worse, and found by Group G in a
 * real session, "Save every file" enumerated that same stale array, so a
 * session whose seventh screenshot was a marked-up copy saved six of seven and
 * reported that it had saved everything.
 *
 * Re-reading the list and dropping the URL cache fixes both, and it is one fix
 * rather than two, because they were the same stale read.
 *
 * `UQA_VIEWPORT_CHANGED` is the other half, from section 7 of the window-sizes
 * contract: a run opening or closing while the report is open repaints that one
 * tab and nothing else.
 */
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
  if (!msg?.type) return;
  if (msg.type === 'UQA_MEDIA_CHANGED') {
    refreshMedia();
  } else if (msg.type === 'UQA_VIEWPORT_CHANGED' && (!msg.sessionId || msg.sessionId === sessionId)) {
    refreshMedia().then(() => renderSizes());
  }
});

async function refreshMedia() {
  const res = await send({ type: 'UQA_MEDIA_LIST', sessionId });
  if (!res.ok) return;
  setMedia(res.result);
  // The bytes behind every cached URL may have been replaced and there is no
  // way to ask which: the ids are the same. Dropping the whole cache is one
  // re-read of what is on screen, and correct by construction.
  revokeAll();
  renderGallery();
  renderTimeline();
  renderChains();
}

/* ── integrations ──────────────────────────────────────────────────────── */

/* The Jira, chat and e-mail filing lives in filing.js (the File menu in the verdict card). */

/**
 * The trackers that are not Jira: one row each, drawn only when configured.
 *
 * They were filed by message and covered by a suite for two versions while
 * this page offered no button for them; code that is tested and unreachable
 * is not shipped. Targets are fetched when the row is drawn, and a target the
 * adapter does not need is simply not offered.
 */
async function setupTrackers() {
  const block = $('trackers-block');
  const host = $('trackers');
  if (!block || !host) return;
  const res = await send({ type: 'UQA_TRACKER_STATE' });
  if (!res.ok) return;
  const ready = res.result.filter((t) => t.configured);
  block.hidden = !ready.length;
  if (!ready.length) return;
  host.replaceChildren();

  // The loop variable is `tr` and not `t`: `t` is the translator on this page.
  for (const tr of ready) {
    const row = el('div', 'tracker-row');
    const name = el('strong', null, tr.label);
    const target = document.createElement('select');
    target.setAttribute('aria-label', t('report.trackers.targetAria', { name: tr.label }));
    target.append(new Option(t('report.trackers.loading'), ''));
    target.disabled = true;
    const file = el('button', 'btn btn-sm btn-primary', t('report.trackers.file'));
    file.type = 'button';
    const last = el('span', 'tracker-last');
    row.append(name, target, file, last);
    host.append(row);

    send({ type: 'UQA_TRACKER_TARGETS', tracker: tr.id }).then((out) => {
      target.replaceChildren();
      if (!out.ok) {
        target.append(new Option(out.error, ''));
        return;
      }
      for (const o of out.result) target.append(new Option(o.note ? `${o.label} (${o.note})` : o.label, o.id));
      target.disabled = false;
    });

    file.addEventListener('click', async () => {
      const asked = await askServiceAccess(tr.url);
      if (!asked.ok) { last.textContent = asked.error; last.className = 'tracker-last err'; return; }
      if (!confirm(t('report.trackers.confirm', { name: tr.label }))) return;
      file.disabled = true;
      last.textContent = t('report.trackers.filing');
      last.className = 'tracker-last';
      const out = await send({ type: 'UQA_TRACKER_FILE', sessionId, tracker: tr.id, target: target.value || undefined });
      file.disabled = false;
      if (!out.ok) {
        last.textContent = werr(out);
        last.className = 'tracker-last err';
        return;
      }
      last.textContent = `${t('report.trackers.filed', { key: out.result.key })} `;
      // D-1010-157: a link beside the key, not a window.open (a popup blocker eats it after the await).
      last.append(safeLink(out.result.url, 'tracker-open', t('report.trackers.open')));
    });
  }
}

/* ── telling the team ──────────────────────────────────────────────────── */

/**
 * The one summary every destination gets, built where the session already is.
 *
 * `background/notify.js` owns the shape of a chat summary and builds it for the
 * webhook route. This page needs the same object to post to a Mattermost
 * channel directly, and the honest way to get it is to call that function
 * rather than to write a second one: two summarisers is how a team reading
 * Slack and a team reading Mattermost end up comparing different numbers for
 * the same session, which is a small disaster and entirely avoidable.
 *
 * It is a plain module with no Chrome API at the top of it, so importing it
 * here reads Group G's file without changing it, which is the arrangement for
 * this round.
 */
async function chatSummary() {
  const { summarise } = await import('../background/notify.js');
  return summarise({ session, events, defect: null, links: reportLinks() });
}

/** Where a reader can go from the message: the report, and the issue if one was filed. */
function reportLinks() {
  // English, deliberately: this is a label inside a chat message, which is an
  // export body and not part of this page's interface.
  const links = { 'Open the report': location.href };
  const filed = window.UQAReport?.lastJira;
  if (filed?.url) links[filed.key] = filed.url;
  return links;
}

/**
 * Mattermost as an account, not a webhook (F5).
 *
 * ── the bug this answers ───────────────────────────────────────────────────
 *
 * "Tell the team / post to chat does nothing." It did nothing visible, which
 * for a tester is the same thing and is arguably worse. The button sits at the
 * bottom of a long panel and reported into `#file-status`, a muted line in the
 * filter bar at the very top of it: a press at the bottom of the page wrote its
 * answer somewhere off screen. And with no destination configured the worker
 * threw a perfectly good sentence that landed in that same invisible place.
 * Every outcome now appears directly under the button that caused it.
 *
 * ── why an account and not another webhook ─────────────────────────────────
 *
 * A webhook posts into one channel that somebody chose when they made the URL.
 * Nader asked to be able to pick a channel, and picking means listing, and
 * listing means being signed in. So this half signs in with a personal access
 * token, asks the server which teams the account is in and which channels are
 * in the team, and posts into the one chosen. Four REST v4 calls, in
 * `platform/chat-mattermost.js`.
 *
 * The token is held in `chrome.storage.local` for this profile only, is never
 * put in a log or an export, and there is a button to forget it beside the
 * field that asks for it. The surface says the word "Mattermost" and never
 * shows the mark: Mattermost requires written approval for any use of its
 * logos, while using the name to say what the button talks to is nominative
 * use. See research/51d-legal-privacy-licensing.md, sections 6 and 8.
 */
let mattermost = null;
const mmLib = async () => (mattermost ||= await import('../platform/chat-mattermost.js'));

/**
 * r3-06-1 (D-1010-45): a recording that lost events says so at the top. The worker leaves a tag:'capture-gap' note for every batch the
 * store refused ("... could not be stored: N") or could not confirm ("N events could not be confirmed ..."); the numbers are summed here.
 */
async function paintGapBanner(events) {
  const box = $('gap-banner');
  if (!box) return;
  // D-1010-108: core/formats-export.js captureGap() is the one reader (structured fields, never the note text).
  const { captureGap } = await import('../core/formats-export.js');
  const { lost, unconfirmed, other } = captureGap(events);
  const GAP_KEYS = {
    'coverage-detached': 'report.gap.coverageDetached',
    'recording-orphaned': 'report.gap.recordingOrphaned',
    'session-cap': 'report.gap.sessionCap',
    'body-cap': 'report.gap.bodyCap',
    'low-disk': 'report.gap.lowDisk',
    'replay-cap': 'report.gap.replayCap',
  };
  const lines = [];
  if (lost || unconfirmed) lines.push(t('report.gap.banner', { lost, unconfirmed }));
  for (const code of other) lines.push(t(GAP_KEYS[code] || 'report.gap.other'));
  box.hidden = !lines.length;
  if (lines.length) box.textContent = lines.join(' ');
}

function mmSay(text, tone = '') {
  const n = $('mm-status');
  if (!n) return;
  n.textContent = text;
  n.className = `chat-out ${tone}`.trim();
}

async function setupMattermost() {
  const panel = $('mattermost-panel');
  if (!panel) return;
  const lib = await mmLib();
  const saved = await lib.load();

  $('mm-url').value = saved.url || '';
  // The token is never written back into the field. A password box repopulated
  // from storage is a credential sitting in the DOM of a page that can be
  // screenshotted, and it teaches the reader nothing they did not know.
  // r3-09-1 (D-1010-46): forget is offered whenever a server is saved, locked or not (a locked vault says so when it refuses).
  $('mm-forget').hidden = !saved.url;
  // The closed-vault sentence names the way out: a link to unlock in Settings.
  const mmLocked = () => {
    const n = $('mm-status');
    if (!n) return;
    n.className = 'chat-out err';
    const link = el('a', null, t('report.mm.unlockLink'));
    link.setAttribute('href', '../options/options.html#sec-integrations'); // a constant page of this extension
    link.target = '_blank';
    link.rel = 'noopener';
    n.replaceChildren(`${t('report.mm.locked')} `, link);
  };
  const lockedNow = !saved.token && !!saved.url && !!saved.locked;
  if (saved.url && saved.token) {
    mmSay(t('report.mm.signedIn', { url: saved.url }));
  } else if (lockedNow) {
    mmLocked(); // r1-03-1: the token is in the vault; closed vault, no token, no post
    $('mm-post').disabled = true;
  }

  const account = () => ({
    url: $('mm-url').value.trim() || saved.url,
    token: $('mm-token').value.trim() || saved.token,
  });

  let me = null;

  $('mm-connect').addEventListener('click', async () => {
    const cfg = account();
    if (!cfg.token) return mmSay(t('report.mm.needToken'), 'err');
    $('mm-connect').disabled = true;
    mmSay(t('report.mm.signingIn'));
    try {
      lib.checkUrl(cfg.url);
      me = await lib.whoAmI(cfg);
      const list = await lib.teams(cfg);
      if (!list.length) throw new Error(t('report.mm.noTeams'));

      const teamSelect = $('mm-team');
      teamSelect.replaceChildren();
      for (const t of list) teamSelect.append(new Option(t.name, t.id));
      teamSelect.value = saved.teamId && list.some((t) => t.id === saved.teamId) ? saved.teamId : list[0].id;

      await lib.save({ url: lib.checkUrl(cfg.url), token: cfg.token });
      $('mm-token').value = '';
      $('mm-forget').hidden = false;
      $('mm-pickers').hidden = false;
      $('mm-post').disabled = false;
      $('mm-who').textContent = t('report.mm.signedInAs', { name: me.name });
      await loadChannels();
      mmSay(t('report.mm.teamsToChoose', { teams: t(list.length === 1 ? 'report.count.teamOne' : 'report.count.teamMany', { n: list.length }) }), 'ok');
    } catch (err) {
      $('mm-pickers').hidden = true;
      mmSay(werr(err), 'err');
    } finally {
      $('mm-connect').disabled = false;
    }
  });

  async function loadChannels() {
    const cfg = await lib.load();
    const teamId = $('mm-team').value;
    const select = $('mm-channel');
    select.replaceChildren(new Option(t('report.mm.readingChannels'), ''));
    select.disabled = true;
    try {
      const list = await lib.channels(cfg, me.id, teamId);
      select.replaceChildren();
      if (!list.length) {
        select.append(new Option(t('report.mm.noChannels'), ''));
        return;
      }
      // A private channel is marked as one. Posting a session summary into a
      // channel the reader thought was open is the kind of surprise a tool
      // should not spring, and the other way round matters just as much.
      for (const c of list) select.append(new Option(c.private ? t('report.mm.privateChannel', { name: c.name }) : c.name, c.id));
      select.value = saved.channelId && list.some((c) => c.id === saved.channelId) ? saved.channelId : list[0].id;
      select.disabled = false;
    } catch (err) {
      select.replaceChildren(new Option(werr(err), ''));
    }
  }

  $('mm-team').addEventListener('change', loadChannels);

  $('mm-post').addEventListener('click', async () => {
    const channel = $('mm-channel');
    if (!channel.value) return mmSay(t('report.mm.pickChannel'), 'err');
    // r3-09-1: the vault is checked BEFORE the confirm, so a certain refusal never costs the tester a decision.
    const cfg = await lib.load();
    if (cfg.locked && !cfg.token) return mmLocked();
    const where = channel.selectedOptions[0]?.textContent || t('report.mm.thatChannel');
    if (!confirm(t('report.mm.confirm', { where }))) return;

    $('mm-post').disabled = true;
    mmSay(t('report.mm.posting'));
    try {
      const summary = await chatSummary();
      // r1-03-1: policy, secret scan and ledger row are inside postSummary, before and around the one fetch
      const made = await lib.postSummary(cfg, channel.value, summary, reportLinks());
      await lib.save({ teamId: $('mm-team').value, channelId: channel.value });
      mmSay(made.id ? t('report.mm.posted', { where }) : t('report.mm.postedUnnamed', { where }), 'ok');
      window.UQASound?.play('chat.sent');
    } catch (err) {
      mmSay(werr(err), 'err');
      window.UQASound?.play('status.error');
    } finally {
      $('mm-post').disabled = false;
    }
  });

  $('mm-forget').addEventListener('click', async () => {
    if (!confirm(t('report.mm.forgetConfirm'))) return;
    try {
      await lib.forget();
    } catch (err) {
      return mmSay(werr(err), 'err'); // a closed vault cannot drop its copy of the token; say so rather than claim it is gone
    }
    $('mm-url').value = '';
    $('mm-token').value = '';
    $('mm-pickers').hidden = true;
    $('mm-forget').hidden = true;
    $('mm-who').textContent = '';
    mmSay(t('report.mm.forgotten'));
  });
}

/* ── theme ─────────────────────────────────────────────────────────────── */

function paintTheme() {
  const btn = $('theme');
  if (!btn || !window.UQATheme) return;
  const state = window.UQATheme.describe();
  // `ui/theme.js` belongs to every surface and answers in English. The mode is
  // the thing worth reading out of it; the words come from the shared table,
  // keyed by that mode, with the English answer as the fallback.
  const mode = window.UQATheme.read?.() || 'system';
  const { label, next } = window.UQADom.themeWords(mode, state);
  // The glyph comes from the icon family (UQAIcon), never a text character.
  btn.innerHTML = window.UQAIcon?.(`theme-${['light', 'dark'].includes(mode) ? mode : 'system'}`, { size: 16 }) || '';
  btn.title = t('common.theme.tooltip', { label, next: next.toLowerCase() });
}

$('theme')?.addEventListener('click', () => {
  window.UQATheme.cycle();
  paintTheme();
});

/* ── boot ──────────────────────────────────────────────────────────────── */

async function pickSession() {
  const res = await send({ type: 'UQA_LIST_SESSIONS' });
  const list = res.ok ? res.result || [] : [];
  const select = $('session-select');
  select.replaceChildren();
  for (const s of list) {
    const o = document.createElement('option');
    o.value = s.id;
    /*
     * The name first, then the date, and the ellipsis on the name.
     *
     * A `<select>` clips its option text at the control's width, and the old
     * order put the timestamp last, so a long charter ate it: "Food import
     * permit submit fails · 9/5/2026, 10:" — cut mid-hour, with a US-ordered
     * date in front of an Amman audience. The date is the shorter half and the
     * one that must survive, so the charter is trimmed here, in words, rather
     * than being cut by the control wherever it happens to run out.
     */
    const name = s.charter || t('report.session.untitled');
    o.textContent = `${name.length > 34 ? `${name.slice(0, 33).trimEnd()}…` : name} · ${stamp(s.startedAt)}`;
    o.title = `${name} · ${stamp(s.startedAt)}`;
    select.append(o);
  }

  /*
   * Unfiled — clips recorded outside a session, and clips whose session was
   * deleted while they were being written.
   *
   * They are real files taking real disk, and until this entry existed there
   * was no screen anywhere in the product that could show one, save one or
   * delete one. The bucket is only offered when it holds something, so an
   * ordinary profile never sees an empty shelf.
   */
  const unfiled = await send({ type: 'UQA_MEDIA_LIST', sessionId: 'unfiled' });
  if (unfiled.ok && (unfiled.result || []).length) {
    const o = document.createElement('option');
    o.value = 'unfiled';
    o.textContent = t('report.session.unfiled', { n: unfiled.result.length });
    select.append(o);
  }

  if (!sessionId || !list.some((s) => s.id === sessionId)) sessionId = list[0]?.id ?? null;
  select.value = sessionId || '';
  // A destructive delete, a save, a session picker and the eight content
  // tabs offered against no session are dead controls wearing live paint.
  // This is the one place that both populates the picker and knows whether
  // anything was found, so it is the one place that gets to decide whether
  // any of them are pressable (F5, research/91).
  setSessionControlsEnabled(!!sessionId);
  return sessionId;
}

/**
 * The single switch for every control that only makes sense with a session
 * on screen: the session picker itself, delete, save, and the eight
 * non-Overview tabs. Called only from pickSession(), so a control added
 * later that forgets to wire itself in here stays live over nothing instead
 * of silently working — one place to fix, not the two this replaced.
 */
function setSessionControlsEnabled(hasSession) {
  $('session-select').disabled = !hasSession;
  $('session-delete').disabled = !hasSession;
  $('save-all').disabled = $('copy-report').disabled = !hasSession;
  for (const id of TABS) {
    if (id === 'overview') continue;
    const btn = document.querySelector(`[data-tab="${id}"]`);
    btn.disabled = !hasSession;
    btn.setAttribute('aria-disabled', String(!hasSession));
  }
  for (const [id] of SECTIONS) {
    if (id === 'findings') continue;
    const btn = $(`sec-${id}`);
    btn.disabled = !hasSession;
    btn.setAttribute('aria-disabled', String(!hasSession));
  }
}

/*
 * Deleting the session this report is showing.
 *
 * It sits beside the picker because that is the only place in the product that
 * lists sessions one at a time, and a tester clearing out last week's work is
 * looking at them there. The worker refuses while the session is running or a
 * clip is still being filed into it (`UQA_DELETE_SESSION`), which is the right
 * answer rather than a cascade: they asked to delete something they are in the
 * middle of, and they should stop it first.
 *
 * `confirm()` and not a dialog of our own: one session is recoverable in the
 * sense that the others are still there, the sentence names what goes, and a
 * report page that grew a second modal for this would be carrying it for the
 * one press in a hundred that uses it.
 */
$('session-delete').addEventListener('click', async () => {
  if (!sessionId) return;
  const name = session?.charter || t('report.session.thisSession');
  if (!window.confirm(t('report.session.deleteConfirm', { name, count: events.length }))) return;
  const btn = $('session-delete');
  btn.disabled = true;
  btn.textContent = t('report.session.deleting');
  const res = await send({ type: 'UQA_DELETE_SESSION', sessionId });
  btn.disabled = false;
  btn.textContent = t('report.bar.delete');
  if (!res.ok) return say(werr(res) || t('report.session.deleteFailed'), 'err');
  say(t('report.session.deleted', { name: iso(name) }), 'ok');
  // Straight to whatever is left, or to the empty state if that was the last
  // one: a report showing a session that no longer exists is the bug this
  // whole action would otherwise create.
  sessionId = null;
  current = null;
  revokeAll();
  if (!(await pickSession())) {
    // pickSession() already disabled every session-only control; the hero's
    // own empty state carries the message now (F4/F5, research/91).
    setOverviewEmpty(true);
    return;
  }
  await loadSession();
});

$('session-select').addEventListener('change', (e) => {
  sessionId = e.target.value;
  current = null;
  // The diagram on screen belongs to the session being left. Marking it unbuilt
  // means the tab draws the new one the next time it is opened, rather than
  // showing the last session's workflow under this session's name.
  diagramReady = false;
  revokeAll();
  loadSession();
});

// The tab going away is the last chance to hand the bytes back. Chrome collects
// them eventually either way; a report left open in a background tab for a day
// should not be holding a gigabyte until then.
addEventListener('pagehide', revokeAll);

/**
 * The mark in the corner.
 *
 * Painted once the session is known, because a signature without the run it
 * signs is decoration. Fixed to the viewport rather than the document so it
 * does not drift into the middle of a screenshot of a long report, and
 * pointer-events:none so it can never intercept a click.
 */
async function paintMark(session) {
  const host = document.getElementById('report-mark');
  if (!host) return;
  const { GLYPH, MAKER, stamp } = await import('../core/provenance.js');
  // A glyph and a name, at the weight of a page number. The full colophon is on
  // hover for anyone who wants it, and costs nothing to everyone who does not.
  host.textContent = GLYPH;
  const label = document.createElement('span');
  label.textContent = MAKER.product;
  host.append(label);
  host.title = stamp({ session, version: chrome.runtime.getManifest().version });
}


/* ── sound ─────────────────────────────────────────────────────────────
   Off until switched on in Settings; the library only listens until then.
   Wired once here rather than per control, so anything rendered later is
   covered the moment it appears. */
(async () => {
  const settings = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.ok ? res.result : {}))
  );
  window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQAVfx?.configure({ enabled: settings.vfxEnabled !== false });
  window.UQAVfx?.wire();
  window.UQASound?.wire(document);
})();

/**
 * The first-party classifier, loaded once.
 *
 * A dynamic import rather than a static one: this file is a classic script,
 * because `report/istqb.js` loads after it and needs `window.UQAReport` to
 * exist synchronously — making this a module would defer it past that.
 * `filingLib()` below takes the same route for the same reason.
 */
let origins = null;
/*
 * The finding count, from the one place that defines it.
 *
 * The headline used to count first-party *failures* and nothing else, so a
 * session that had found 83 accessibility violations, two broken links, four
 * clipped elements and five fine-print gaps opened with "0 problems found"
 * (research/58, finding 16). `countFindings` in core/sessions.js is the same
 * arithmetic the popup's live line and the Markdown export now do, which is the
 * point: one number, three surfaces.
 */
let sessionsLib = null;
/** Gap G2's join, loaded once — `renderSelectorCopies()` reads it synchronously. */
let actionJoinLib = null;

async function loadSession() {
  origins ||= await import('../core/origins.js').catch(() => null);
  sessionsLib ||= await import('../core/sessions.js').catch(() => null);
  actionJoinLib ||= await import('../core/action-join.js').catch(() => null);
  window.UQAReport.sessionId = sessionId;
  /* The replay, if one was recorded. Asked for by size rather than by content:
     `UQA_REPLAY_INFO` reads the chunk headers and inflates nothing, so a
     session with a large replay costs the timeline nothing to offer it. */
  send({ type: 'UQA_REPLAY_INFO', sessionId }).then((info) => {
    const btn = document.getElementById('watch-replay');
    if (!btn || !info?.ok || !info.result?.entries) return;
    const kb = Math.max(1, Math.round((info.result.stored || 0) / 1024));
    btn.textContent = t('report.timeline.replayKb', { kb });
    btn.hidden = false;
    managed(btn, 'replayAllowed');
    btn.addEventListener('click', () => send({ type: 'UQA_OPEN_REPLAY', sessionId }));
  });

  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId });
  if (!res.ok) return say(werr(res), 'err');
  session = res.result.session;
  events = res.result.events || [];

  const mediaRes = await send({ type: 'UQA_MEDIA_LIST', sessionId });
  setMedia(mediaRes.ok ? mediaRes.result || [] : []);

  /*
   * The Unfiled shelf has no session row, because it is not a session.
   *
   * Every renderer below reads `session.startedAt`, `session.charter` and
   * `session.masked` without a guard, and rightly so — a report is a report of
   * a session. The bucket is given a record of its own instead, built from what
   * the clips themselves say, so the page renders as an ordinary report whose
   * timeline happens to be empty and whose gallery is the point.
   */
  if (!session && sessionId === 'unfiled' && media.length) {
    const times = media.map((m) => m.ts).filter(Number.isFinite);
    session = {
      id: 'unfiled',
      charter: t('report.session.unfiledCharter'),
      startedAt: times.length ? Math.min(...times) : Date.now(),
      endedAt: times.length ? Math.max(...times) : Date.now(),
      status: 'unfiled',
      masked: 0,
      synthetic: true,
    };
  }

  $('subtitle').textContent = session?.charter || t('report.bar.subtitle');
  renderOverview();
  renderChains();
  renderVerdict();
  renderFilters();
  renderSelectorCopies();
  renderTimeline();
  renderGallery();
  renderSizes();
  paintMark(session).catch(() => {});
  renderQuality();
  renderSaved();
  renderTeam();
  // The File-it tab holds a document built from this session; a different
  // session means a different document.
  if (fileTabReady) window.UQAIstqb?.rebuild();
  say('');
}

/**
 * The five headings inside the export picker.
 *
 * `<optgroup label>` is an attribute, and `QAWi18n.apply()` fills text plus the
 * three attributes the contract names. The options underneath are ordinary
 * `data-i18n` elements, because an `<option>` carries its words as text; only
 * the group headings need this walk. The keys are read off the DOM, exactly as
 * `apply()` reads its own, and every one of them is listed in
 * `report.dynamic.json`.
 */
function paintFormats() {
  for (const group of $('format').querySelectorAll('optgroup[data-i18n-label]')) {
    group.label = QAWi18n.t(group.dataset.i18nLabel);
  }
}

/**
 * Everything on this page that draws words, drawn again in the new language.
 *
 * A language change must not reload the report. A reload loses the tab the
 * reader is on, the filters they set, the boxes they ticked in the Save sheet
 * and the draft they were typing in the Jira tab, and none of that is worth
 * spending to change a language. So the static text is refilled and every
 * renderer is called again, in the order `loadSession()` calls them.
 *
 * The raw export is dropped rather than translated: its body is built by the
 * worker and is English either way, and only the page's own wrapper around it
 * moves. Rebuilding it costs one message and only when that tab is open.
 */
function repaintAll() {
  QAWi18n.apply();
  paintFormats();
  paintTheme();
  // The picker's own words: "Session" for a run with no charter, and the
  // Unfiled shelf. It re-reads the list and re-selects the session already on
  // screen, so it is safe to call for the labels alone.
  pickSession();
  // Titles only: each of these binds its click once and repaints on every
  // later call. `setupTrackers` redraws its rows from scratch, so its
  // listeners go with the nodes they were on.
  setupTrackers();
  if (!session) {
    if (!sessionId) {
      setOverviewEmpty(true);
    }
    return;
  }
  $('subtitle').textContent = session.charter || t('report.bar.subtitle');
  renderOverview();
  renderChains();
  renderVerdict();
  renderFilters();
  renderSelectorCopies();
  renderTimeline();
  renderGallery();
  renderSizes();
  renderQuality();
  renderSaved();
  renderTeam();
  if (diagramReady) renderDiagram();
  const raw = !$('panel-raw').hidden;
  current = null;
  if (raw) loadRaw();
  if (fileTabReady) window.UQAIstqb?.rebuild();
}

(async function boot() {
  // The words come first, and not as a nicety: `ready()` stamps `lang` and
  // `dir` on the root and fills in every `data-i18n` element in the HTML, and
  // a render that ran before it would paint the wrong language and then jump.
  await QAWi18n.ready();
  QAWi18n.onChange(repaintAll);
  paintFormats();
  paintTheme();
  // Before anything renders: the two rules this page reads a session with come
  // from core/, and a render that ran first would count zero of everything.
  await rulesReady;
  await bugfirstReady;
  await sigReady;
  const s = await send({ type: 'UQA_GET_SETTINGS' });
  if (s.ok) settings = s.result;
  // T-050: when a report was first opened. Local only; the support bundle (T-063) is the one reader.
  chrome.storage.local.get('firstReportOpenedAt').then((r) => {
    if (!r.firstReportOpenedAt) chrome.storage.local.set({ firstReportOpenedAt: Date.now() });
  }).catch(() => {});

  if (!(await pickSession())) {
    setOverviewEmpty(true);
    showTab('overview');
    return;
  }

  await loadSession();
  for (const id of ['jira-quick', 'jira-file', 'jira-connect']) managed($(id), 'integrationsAllowed');
  const want = location.hash.slice(1);
  const bySection = SECTIONS.find(([id]) => id === want);
  showTab(TABS.includes(want) ? want : bySection ? bySection[1][0] : 'broke');
  setupTrackers();
  setupMattermost();
})();
