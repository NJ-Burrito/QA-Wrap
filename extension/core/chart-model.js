/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The arithmetic behind every chart on the report page, with no DOM in it.
 *
 * ── why this file exists apart from the painter ────────────────────────────
 *
 * `report/charts.js` turns these numbers into SVG. Everything that can be got
 * *wrong* about a chart is in here instead: which bucket an event falls in,
 * what the tallest bar is, where a threshold sits on a meter, what the table
 * twin says. A painter can be looked at; arithmetic has to be tested, and a
 * pure module is a module `tools/test-report.mjs` can import in Node with no
 * browser at all.
 *
 * ── the rules these functions encode ───────────────────────────────────────
 *
 * The report draws four forms and no more, each because the data has a
 * different job (see the `dataviz` method: the job picks the form, and colour
 * comes last):
 *
 *   **activity**  change over time: the session on one clock.
 *   **bars**      magnitude across named things: what the session was made of.
 *   **meter**     one measurement against a published threshold: a Core Web Vital.
 *   **table**     the twin of any of the three, because a value must never be
 *                 reachable only by hovering, and colour must never be the only
 *                 thing carrying a meaning.
 *
 * There is deliberately **no categorical palette here and none in the
 * painter.** Every chart on this page is a single series, so it is drawn in one
 * colour and the axis carries identity; the only second colour any of them uses
 * is the product's failure red, and it appears only where a mark genuinely
 * means *this failed*. That is not a shortcut, it is the rule: a value ramp
 * over nominal categories double-encodes length as hue and burns the one free
 * channel on information the bar already shows.
 *
 * The two colours were validated rather than eyeballed, with the `dataviz`
 * validator, against the surface each is drawn on:
 *
 *   light  `#4C535A` data / `#B5432B` failure on `#F1EFE9`
 *          CVD separation ΔE 8.4 (protan), normal vision ΔE 19.2, contrast pass
 *   dark   `#8A9199` data / `#FF8A6E` failure on `#15181B`
 *          CVD separation ΔE 8.6 (protan), normal vision ΔE 19.0, contrast pass
 *
 * The validator also reports both as failing its *categorical* chroma floor,
 * which is correct and is the point: the neutral is meant to read as neutral,
 * so that the red is the only thing on the chart that means anything.
 */

/* ── change over time ────────────────────────────────────────────────────── */

/**
 * The session's events, dropped into equal buckets on one clock.
 *
 * Equal *time* buckets, not equal counts: the shape of a session is where the
 * activity clumped, and a chart with one bar per event would hide exactly that.
 * A bucket knows how many events it holds and how many of them failed, because
 * the failures are the reason anybody looks at this chart.
 *
 * `span` has a floor of one second so that a session recorded in a blink still
 * divides, rather than dividing by zero and painting every bar in bucket 0.
 *
 * @param {Array<{ts?: number}>} events
 * @param {{start?: number, end?: number, buckets?: number, isFailure?: (ev: any) => boolean}} [options]
 */
export function bucketise(events, { start, end, buckets = 60, isFailure = () => false } = {}) {
  /*
   * The clock comes from the session, and falls back to the events.
   *
   * A session read back from an export, or one still running when the report
   * was opened, can arrive without a usable `startedAt` — and every arithmetic
   * below then produced `NaN`: `list[NaN]` is `undefined`, so the first event
   * threw on `.n++` and the chart drew nothing at all for a session that plainly
   * had events in it. The events carry their own timestamps and are the same
   * clock, so they are the fallback rather than a reason to give up.
   */
  const stamps = events.map((ev) => Number(ev?.ts)).filter(Number.isFinite);
  const from = Number.isFinite(start) ? start : stamps.length ? Math.min(...stamps) : 0;
  const to = Number.isFinite(end) ? end : stamps.length ? Math.max(...stamps) : from;
  const span = Math.max(1000, (to || from) - from);
  const list = Array.from({ length: buckets }, (_, i) => ({
    i,
    at: from + (i / buckets) * span,
    n: 0,
    fail: 0,
  }));
  for (const ev of events) {
    // An event with no readable timestamp still happened, so it is counted at
    // the start of the run rather than dropped or allowed to poison the index.
    const ts = Number(ev?.ts);
    const at = Number.isFinite(ts) ? Math.floor(((ts - from) / span) * buckets) : 0;
    const i = Math.min(buckets - 1, Math.max(0, at));
    list[i].n++;
    if (isFailure(ev)) list[i].fail++;
  }
  const peak = Math.max(1, ...list.map((b) => b.n));
  return { buckets: list, peak, span, start: from, end: from + span };
}

/* ── magnitude across named things ───────────────────────────────────────── */

/**
 * Rows for a horizontal bar chart, longest first, with the tail folded.
 *
 * Two decisions worth stating.
 *
 * **Longest first.** These categories have no natural order (an "Action" is
 * not before or after a "Request"), so the only ordering that helps a reader is
 * the one that answers the question the chart is for: what was this session
 * mostly made of.
 *
 * **A tail, not a ninth bar.** Past about eight rows a bar chart stops being
 * read and starts being scanned, and the small ones are individually
 * meaningless. Anything below the cut is folded into one row that says how many
 * kinds it stands for, so nothing is silently dropped. The table twin still
 * lists every one.
 *
 * `width` is a percentage of the longest bar, which is what the painter needs
 * and what makes the arithmetic checkable without a viewport.
 */
export function barRows(items, { top = 8, otherLabel = 'Everything else' } = {}) {
  const clean = items.filter((r) => Number(r.value) > 0).sort((a, b) => b.value - a.value);
  const head = clean.slice(0, top);
  const tail = clean.slice(top);
  const rows = [...head];
  if (tail.length) {
    rows.push({
      label: otherLabel,
      value: tail.reduce((n, r) => n + r.value, 0),
      note: `${tail.length} more kind${tail.length === 1 ? '' : 's'}`,
      folded: tail.map((r) => r.label),
    });
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = clean.reduce((n, r) => n + r.value, 0);
  return {
    rows: rows.map((r) => ({
      ...r,
      width: (r.value / max) * 100,
      share: total ? (r.value / total) * 100 : 0,
    })),
    max,
    total,
  };
}

/* ── one measurement against a published threshold ───────────────────────── */

/**
 * web.dev's good / needs-work boundaries, the same pair `content/vitals.js`
 * rates against.
 *
 * Repeated here rather than imported because that file is a content script that
 * runs inside somebody else's page and this one runs in the report; the numbers
 * are published constants, and `tools/test-report.mjs` asserts the two copies
 * agree so they cannot drift apart in silence.
 */
export const VITAL_BOUNDS = Object.freeze({
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
});

/**
 * Where a measurement sits on its own scale, as a bullet chart.
 *
 * The scale runs to `poor * 1.5` so that a value in the poor band still has
 * somewhere to be drawn: a scale that ends at the poor boundary paints every
 * bad result as a full bar, which is the one case the reader most needs to
 * judge the size of. A value beyond the end is clamped and the caller is told,
 * so the label can say the number even when the bar cannot.
 *
 * Returns `null` for a metric that was not measured. A missing measurement is
 * not a zero, and drawing it as one is a lie the tile would tell silently.
 */
export function meterFor(key, value) {
  const bounds = VITAL_BOUNDS[key];
  if (!bounds || value == null || !Number.isFinite(Number(value))) return null;
  const [good, poor] = bounds;
  const scale = poor * 1.5;
  const v = Number(value);
  const pct = (n) => Math.max(0, Math.min(100, (n / scale) * 100));
  return {
    key,
    value: v,
    good,
    poor,
    scale,
    rating: v <= good ? 'good' : v <= poor ? 'needs work' : 'poor',
    goodAt: pct(good),
    poorAt: pct(poor),
    valueAt: pct(v),
    beyond: v > scale,
  };
}

/* ── window sizes ────────────────────────────────────────────────────────── */

/**
 * One run from `UQA_VIEWPORT_RUNS`, decorated with the one number the handler
 * does not carry.
 *
 * `research/55-window-sizes-contract.md` §8 offered Group F the choice of
 * folding the two `viewport` event phases here or reading a handler that does
 * it in the place that already holds the data. Group G built the handler, so
 * the report reads that and there is exactly one fold in the product. This
 * function is not a second one: it takes a row that is already folded and adds
 * `shortBy`, which is a question about the row rather than about the events.
 *
 * `shortBy` is the gap between the size that was asked for and the size Chrome
 * actually gave the window. §4 calls it out as the honest number: where the two
 * differ is where a broken breakpoint hides, so the row has to be able to say
 * so rather than repeat the request as though it were the result.
 *
 * A run that never closed is still a row. The window may simply still be open,
 * and a tester looking for the size they are testing in right now is exactly
 * the person reading this, so the missing fields are null rather than zero.
 */
export function runRow(run = {}) {
  const measured = run.measured || null;
  const viewport = run.viewport || null;
  return {
    closedAt: null,
    durationMs: null,
    mediaId: null,
    reason: null,
    inherited: {},
    refused: [],
    // 8 September 2026. A run is either a window the worker opened ('window')
    // or the session's own window put at the size in place ('resized'), and a
    // resized run sits inside the session's clip rather than owning one of its
    // own — `clip` is `{ mediaId, startedAt, offsetMs, endOffsetMs }` when it
    // does. `exact` is false when the browser refused the size asked for; a
    // run recorded before this existed says nothing, and nothing is not "no".
    mode: 'window',
    clip: null,
    exact: true,
    ...run,
    shortBy: measured && viewport
      ? { w: (viewport.width || 0) - (measured.w || 0), h: (viewport.height || 0) - (measured.h || 0) }
      : null,
  };
}

/**
 * What a run inherited, as a sentence, and what it was refused.
 *
 * Read from the run's own flags and never re-derived from settings, which is
 * §9 of the contract: if `inherited.video` is false the run had no video,
 * whatever the settings happen to say by the time the report is opened.
 */
export function describeRun(run) {
  const on = [];
  if (run.inherited?.video) on.push('recording');
  if (run.inherited?.mask) on.push('masking');
  if (run.inherited?.mic) on.push('the microphone');
  if (run.inherited?.tabAudio) on.push('the tab sound');
  const carried = on.length ? `Carried over: ${joinWords(on)}.` : 'Nothing was carried over from the session.';
  const refused = run.refused?.length ? ` Not carried: ${joinWords(run.refused)}.` : '';
  return `${carried}${refused}`;
}

/** `a`, `a and b`, `a, b and c`. The Oxford comma is not the house style here. */
export function joinWords(list) {
  const words = list.filter(Boolean).map(String);
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* ── the table twin ──────────────────────────────────────────────────────── */

/**
 * Any chart above, as rows a screen reader and a spreadsheet can both read.
 *
 * Not an afterthought and not optional: a chart whose values are reachable only
 * by hovering is a chart half the readers cannot read, and this page is a
 * document people hand to other people. Every chart the painter draws ships one
 * of these under it, folded shut.
 */
export function tableFor(kind, model) {
  if (kind === 'activity') {
    return {
      head: ['From', 'Events', 'Failed'],
      rows: model.buckets
        .filter((b) => b.n)
        .map((b) => [relative(b.at, model.start), String(b.n), String(b.fail)]),
    };
  }
  if (kind === 'bars') {
    return {
      head: ['What', 'Count', 'Share'],
      rows: model.rows.map((r) => [
        r.folded ? `${r.label} (${r.folded.join(', ')})` : r.label,
        String(r.value),
        `${r.share.toFixed(1)}%`,
      ]),
    };
  }
  if (kind === 'meters') {
    return {
      head: ['Metric', 'Measured', 'Good at or under', 'Poor over'],
      rows: model.map((m) =>
        m.meter
          ? [m.label, `${m.meter.value}${m.unit || ''}`, `${m.meter.good}${m.unit || ''}`, `${m.meter.poor}${m.unit || ''}`]
          : [m.label, 'not measured', '', '']
      ),
    };
  }
  return { head: [], rows: [] };
}

/** `+12.30s`, the same clock the timeline prints. */
export function relative(ts, start) {
  return `+${((ts - start) / 1000).toFixed(2)}s`;
}
