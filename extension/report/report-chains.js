/* QA Wrap — report: charts, verdict, chains, selector copies, filters and timeline (split from report.js; a classic script loaded right after it, same global scope). */
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
  // The card is headed by the name the tester typed (2026-11-10); the failure moves to its own «What broke» row.
  const named = BF.namedTitle(session, t);
  const h1 = el('h1'), bdi = document.createElement('bdi');
  h1.id = 'v-h'; h1.title = bdi.textContent = named || headline;
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
  const broke = named && lead ? vrow('report.tabs.broke', headline, headline, failUrl != null) : null;
  for (const part of [broke, where, did, queryBox]) if (part) main.append(part);
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
  replay.addEventListener('click', openReplay);
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
