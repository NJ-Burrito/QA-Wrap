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
  const sig = SIG.visibleProblems(FC?.withRecovery?.(events) ?? events, 'all');
  const level = sgLevel();
  const promo = sgPromoted(sid);
  const rows = level === 'all' ? sig.rows : sig.rows.filter((r) => r.c === 'D' || r.r === 'n-recovered' || promo.has(r.key)) /* D5: amber, visible, not a problem */;
  // The headline is the one problem number (core/finding-count.js: distinct failures, repeats folded), the same on the chip, the done card, the toast and the report.
  // What the tester's own tools found (a11y, links, layout, fine print) is a Finding, counted apart.
  const num = FC ? FC.problemCounts(events).groups : sig.problems;
  return { sig, num, level, rows, promo, induced: sig.inducedRows, events };
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
  const box = el('div', 'sg'); import('./nf-line.js').then((m) => m.mount(box, v.events, session, t, el)).catch(console.warn); // D1: the filter's counts and the hidden-calls line
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
