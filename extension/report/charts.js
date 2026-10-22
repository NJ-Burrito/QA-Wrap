/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The charts on the report page, drawn by hand in SVG.
 *
 * ── nothing is fetched, and that is a product rule, not a preference ───────
 *
 * Chart.js, D3, Recharts and every hosted script that draws one of these is
 * out of the question here for three separate reasons, any one of which would
 * be enough. The manifest's content security policy is `script-src 'self'`, so
 * a CDN tag would not execute at all. The package must not grow a megabyte of
 * dependency to draw thirty rectangles. And the whole promise of this product
 * is that a session never leaves the machine, which a chart library phoning a
 * CDN for a font quietly breaks.
 *
 * So: four forms, a few hundred lines, and no dependency. The arithmetic is in
 * `core/chart-model.js`, where a test can reach it without a browser; this file
 * is the painter and holds no arithmetic worth arguing about.
 *
 * ── what is drawn, and what is deliberately not ────────────────────────────
 *
 *   activity   the session on one clock, one bar per bucket, failures in red
 *   bars       magnitude across named things, one row each, longest first
 *   meters     one measurement against its published threshold, as a bullet
 *
 * There is no pie, no donut and no dual axis. A pie cannot compare close
 * values, and a second y-scale invents a correlation that is not in the data.
 * There is also no categorical palette: every chart here is a single series in
 * one colour, and the only second colour is the failure red, which appears only
 * where a mark means *this failed*.
 *
 * ── every chart ships three things ─────────────────────────────────────────
 *
 * A **title** that names the series, so no legend box is needed for one series.
 * A **hover and focus layer**: the value is on the mark, reachable by keyboard,
 * never only by mouse. A **table twin**, folded shut, because a value that can
 * only be hovered is a value half the readers cannot get to.
 */

(() => {
  const NS = 'http://www.w3.org/2000/svg';

  /** The words for a key, from platform/i18n.js. */
  const t = (k, v) => QAWi18n.t(k, v);

  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
    return n;
  };

  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * The arithmetic module, fetched when this file loads.
   *
   * `charts.js` is a classic script and `chart-model.js` is a module, so the
   * only way across is `import()`. It used to be started by the first chart
   * that needed it — which put a module fetch on the critical path of the
   * overview's own chart: the hero, the cards and the timeline painted, and the
   * chart under them arrived a beat later into a box that was empty until it
   * did. Four opens in ten were caught mid-gap by `tools/diagnose.mjs`, which is
   * a reader seeing the page settle under them four times in ten.
   *
   * Starting it here costs nothing — the file is on disk, in the extension —
   * and by the time anything renders the module is already there, so the chart
   * lands with the rest of the page. The `catch` is a handler and nothing more:
   * a real failure is still reported wherever the promise is awaited.
   */
  const modelReady = import('../core/chart-model.js');
  modelReady.catch(() => {});
  const loadModel = () => modelReady;

  /* ── the frame every chart sits in ─────────────────────────────────────── */

  /**
   * A figure: the title, the plot, the caption, and the table underneath.
   *
   * The caption is not decoration. It is where the one sentence goes that says
   * what the reader is looking at, and it is what makes the chart legible in a
   * printed report where nothing can be hovered.
   */
  function figure({ title, caption, table }) {
    const fig = el('figure', 'chart');
    if (title) fig.append(el('h3', 'chart-title', title));
    const plot = el('div', 'chart-plot');
    fig.append(plot);
    if (caption) fig.append(el('figcaption', 'chart-caption', caption));
    if (table && table.rows.length) {
      const det = el('details', 'chart-table');
      det.append(el('summary', null, t(table.rows.length === 1 ? 'report.chart.tableOne' : 'report.chart.tableMany', { n: table.rows.length })));
      // Named `grid` and not `t`: `t` is the translator in this file.
      const grid = el('table', 'saved-table');
      const head = el('tr');
      for (const h of table.head) head.append(el('th', null, h));
      grid.append(head);
      for (const row of table.rows) {
        const tr = el('tr');
        for (const cell of row) tr.append(el('td', null, cell));
        grid.append(tr);
      }
      det.append(grid);
      fig.append(det);
    }
    return { fig, plot };
  }

  /**
   * One tooltip for the whole page, moved rather than made.
   *
   * A tooltip per mark is a few hundred nodes on a busy chart, all of them
   * hidden nearly all of the time. This is one element that follows whichever
   * mark is hovered or focused, so a chart with sixty bars costs one node.
   */
  let tip = null;
  function tooltip() {
    if (!tip) {
      tip = el('div', 'chart-tip');
      tip.hidden = true;
      tip.setAttribute('role', 'presentation');
      document.body.append(tip);
    }
    return tip;
  }

  // Position is coalesced through one rAf and written to `transform` only —
  // no `top`/`left` per call, nothing for the browser to lay out on every
  // pointermove (F31, same treatment as the picker's F02/F05).
  let tipRafId = 0;
  let pendingTip = null;

  function paintTip() {
    tipRafId = 0;
    if (!pendingTip) return;
    const { target, text } = pendingTip;
    const tip = tooltip();
    tip.textContent = text;
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    // Above the mark when there is room, below it when there is not: a tooltip
    // clipped by the top of the window is a tooltip nobody reads.
    const above = box.top > 60;
    // Left/top read straight off `getBoundingClientRect()`, which is viewport
    // geometry and already correct in both directions — a logical offset here
    // would mirror a number that has been mirrored once already. They now
    // drive a single `translate3d`, never a layout property.
    const left = Math.round(box.left + box.width / 2);
    const top = Math.round(above ? box.top - 8 : box.bottom + 8);
    // The centring/above-below offset used to live in the stylesheet's own
    // `transform`; it has to move in here now, since an inline `transform`
    // (needed for `translate3d`) would otherwise win over it and drop it.
    const offset = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
    tip.style.transform = `translate3d(${left}px, ${top}px, 0) ${offset}`;
    tip.dataset.side = above ? 'above' : 'below';
  }

  function showTip(target, text) {
    pendingTip = { target, text };
    if (tipRafId) return;
    tipRafId = requestAnimationFrame(paintTip);
  }

  const hideTip = () => {
    pendingTip = null;
    if (tipRafId) {
      cancelAnimationFrame(tipRafId);
      tipRafId = 0;
    }
    if (tip) tip.hidden = true;
  };

  /**
   * Wire one mark so hover, focus and keyboard all say the same thing.
   *
   * `<title>` stays as well as the tooltip: it is what a screen reader reads
   * and what survives the SVG being saved on its own, and it costs one node.
   */
  function markable(node, { label, onPick }) {
    const native = svgEl('title');
    native.textContent = label;
    node.append(native);
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', onPick ? 'button' : 'img');
    node.setAttribute('aria-label', label);
    node.addEventListener('pointerenter', () => showTip(node, label));
    node.addEventListener('pointermove', () => showTip(node, label));
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', () => showTip(node, label));
    node.addEventListener('blur', hideTip);
    if (onPick) {
      node.addEventListener('click', onPick);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      });
    }
    return node;
  }

  /* ── the session on one clock ──────────────────────────────────────────── */

  /**
   * Activity over the run, one bar per bucket, failures in the failure colour.
   *
   * What this replaced drew every bar in the accent, which is the same hue as
   * the failure colour, and separated the two by opacity alone. On a projector
   * that is no separation at all: a busy second and a broken one looked the
   * same. Now a bucket holding a failure is red and a bucket that does not is
   * neutral, which is the only distinction the chart is making.
   *
   * The baseline is a hairline and there is no vertical grid: sixty bars over
   * one minute do not need ruling, and gridlines behind small marks are noise.
   */
  async function activity(host, { events, session, isFailure, onPick }) {
    const m = await loadModel();
    host.replaceChildren();
    /*
     * One event is still a session, and still gets its bar.
     *
     * The floor was two, which meant a run holding a single event — one
     * failure, which is the run somebody is most likely to be reading — showed
     * a line of apology where the chart goes. Nothing about one bar is wrong:
     * it says when the thing happened and whether it failed, which is the whole
     * job. Only an empty session has nothing to draw.
     */
    if (!events.length) {
      host.append(el('p', 'muted', t('report.chart.activityEmpty')));
      return;
    }

    const built = m.bucketise(events, {
      start: session?.startedAt,
      end: session?.endedAt || events[events.length - 1]?.ts,
      buckets: 60,
      isFailure,
    });
    const failing = built.buckets.filter((b) => b.fail).length;

    // "1 events" is the kind of thing a reader notices and stops trusting the
    // rest of the page over, and one event is now a chart the reader can reach.
    const many = t(events.length === 1 ? 'report.count.eventOne' : 'report.count.eventMany', { n: events.length });

    const { fig, plot } = figure({
      title: t('report.chart.activityTitle'),
      caption: t('report.chart.activityCaption', {
        events: many,
        seconds: (built.span / 1000).toFixed(1),
        slices: failing
          ? t(failing === 1 ? 'report.chart.sliceOne' : 'report.chart.sliceMany', { n: failing })
          : t('report.chart.noFailingSlice'),
      }),
      table: m.tableFor('activity', built),
    });

    const W = 1000;
    const H = 132;
    const FOOT = 12; // room under the baseline, so the axis is not on top of it
    const gap = 2;
    const bw = W / built.buckets.length;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'chart-svg chart-activity',
      role: 'img',
      'aria-label': t('report.chart.activityAria', { seconds: (built.span / 1000).toFixed(1), events: many }),
      preserveAspectRatio: 'none',
    });

    svg.append(svgEl('line', {
      x1: 0, y1: H - FOOT, x2: W, y2: H - FOOT, class: 'chart-axis-line',
    }));

    for (const b of built.buckets) {
      if (!b.n) continue;
      const h = Math.max(2, (b.n / built.peak) * (H - FOOT - 8));
      const bar = svgEl('rect', {
        x: b.i * bw + gap / 2,
        y: H - FOOT - h,
        width: Math.max(1, bw - gap),
        height: h,
        rx: 1.5,
        class: b.fail ? 'chart-bar is-bad' : 'chart-bar',
      });
      markable(bar, {
        label:
          t('report.chart.barLabel', {
            at: m.relative(b.at, built.start),
            events: t(b.n === 1 ? 'report.count.eventOne' : 'report.count.eventMany', { n: b.n }),
          }) + (b.fail ? t('report.chart.barFailed', { n: b.fail }) : ''),
        onPick: onPick ? () => onPick(b.at) : null,
      });
      svg.append(bar);
    }

    /*
     * The plot area stays left to right, and says so.
     *
     * The bars are `<rect>`s at explicit x coordinates and the axis row under
     * them is a flex row of start, count, end. `dir="rtl"` mirrors the row and
     * leaves the SVG exactly where it was, so an Arabic reader would get the
     * end of the session labelled at the start of the chart: axes reversed,
     * data not. Pinning the plot to `ltr` is the honest half of the choice.
     * The title, the caption and the table twin around it are all in the
     * reader's direction, and time reads left to right, which is what a clock
     * scrubber does in every language.
     */
    plot.setAttribute('dir', 'ltr');
    plot.append(svg);
    const axis = el('div', 'chart-axis');
    axis.append(
      el('span', null, m.relative(built.start, built.start)),
      el('span', null, many),
      el('span', null, m.relative(built.end, built.start))
    );
    plot.append(axis);
    host.append(fig);
  }

  /* ── magnitude across named things ─────────────────────────────────────── */

  /**
   * A horizontal bar per row, longest first, value at the end of the bar.
   *
   * Horizontal and not vertical because the labels are words: rotated axis
   * labels are the single most common reason a bar chart goes unread. The value
   * is direct-labelled on every row, which is correct here and only here: this
   * form has one row per category, not a number on every point of a series.
   *
   * `tone` paints one row in the failure colour when that row *is* the failure.
   * It is never used to rank rows by size.
   */
  async function bars(host, { rows, title, caption, top, unit = '', onPick } = {}) {
    const m = await loadModel();
    host.replaceChildren();
    const built = m.barRows(rows, top ? { top } : {});
    if (!built.rows.length) {
      host.append(el('p', 'muted', t('report.chart.barsEmpty')));
      return;
    }

    const { fig, plot } = figure({ title, caption, table: m.tableFor('bars', built) });
    const list = el('div', 'chart-bars');
    for (const row of built.rows) {
      const line = el('div', `chart-row${row.tone ? ` tone-${row.tone}` : ''}`);
      line.append(el('span', 'chart-row-label', row.label));

      const track = el('span', 'chart-track');
      const fill = el('span', `chart-fill${row.tone === 'bad' ? ' is-bad' : ''}`);
      // A width in percent of the longest bar: the painter never recomputes a
      // scale the model already decided.
      fill.style.width = `${row.width.toFixed(2)}%`;
      track.append(fill);
      line.append(track);

      line.append(el('span', 'chart-row-value', `${row.value}${unit}`));
      const label = t('report.chart.rowLabel', {
        label: row.label,
        value: `${row.value}${unit}`,
        share: row.share.toFixed(1),
        total: built.total,
      }) + (row.note ? ` (${row.note})` : '');
      line.title = label;
      line.setAttribute('aria-label', label);
      if (onPick && row.key) {
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        line.addEventListener('click', () => onPick(row.key));
        line.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(row.key);
          }
        });
      }
      list.append(line);
    }
    plot.append(list);
    host.append(fig);
  }

  /* ── one measurement against its threshold ─────────────────────────────── */

  /**
   * A bullet chart per metric: the good band, the needs-work band, and a marker.
   *
   * A tile saying "3200ms · poor" tells a reader the verdict and nothing about
   * the distance: 3200 is a fifth of the way past the boundary and 9000 is not,
   * and the fix is a different size of job in each case. The bands are drawn
   * once behind the marker so the whole row is read at a glance.
   *
   * A metric that was not measured is drawn as words, not as a zero. Zero is
   * the best possible score for every one of these, and painting an absent
   * measurement as one would be the worst kind of quiet lie.
   */
  /**
   * The three bands a measurement can land in, as words.
   *
   * The rating itself comes from `core/chart-model.js` and keeps its English id
   * everywhere it picks a class (`rating-needs-work`). Only the word shown
   * beside the bar moves, and only through literal keys.
   */
  function ratingWord(rating) {
    switch (rating) {
      case 'good': return t('report.chart.ratingGood');
      case 'needs work': return t('report.chart.ratingNeedsWork');
      case 'poor': return t('report.chart.ratingPoor');
      default: return rating;
    }
  }

  async function meters(host, { metrics, title, caption }) {
    const m = await loadModel();
    host.replaceChildren();
    const built = metrics.map((row) => ({ ...row, meter: m.meterFor(row.key, row.value) }));

    const { fig, plot } = figure({ title, caption, table: m.tableFor('meters', built) });
    const grid = el('div', 'chart-meters');

    for (const row of built) {
      const cell = el('div', `chart-meter${row.meter ? ` rating-${row.meter.rating.replace(' ', '-')}` : ' is-blank'}`);
      cell.append(el('span', 'chart-meter-k', row.label));
      cell.append(
        el('span', `chart-meter-v${row.meter ? '' : ' is-blank'}`, row.meter ? `${row.meter.value}${row.unit || ''}` : t('report.value.notMeasured'))
      );

      if (row.meter) {
        const track = el('span', 'chart-meter-track');
        const good = el('span', 'chart-band is-good');
        good.style.width = `${row.meter.goodAt.toFixed(2)}%`;
        const mid = el('span', 'chart-band is-mid');
        mid.style.width = `${(row.meter.poorAt - row.meter.goodAt).toFixed(2)}%`;
        const bad = el('span', 'chart-band is-bad');
        bad.style.width = `${(100 - row.meter.poorAt).toFixed(2)}%`;
        const marker = el('span', 'chart-marker');
        marker.style.insetInlineStart = `${row.meter.valueAt.toFixed(2)}%`;
        track.append(good, mid, bad, marker);
        const label =
          t('report.chart.meterLabel', {
            metric: row.label,
            value: `${row.meter.value}${row.unit || ''}`,
            rating: ratingWord(row.meter.rating),
            good: `${row.meter.good}${row.unit || ''}`,
            poor: `${row.meter.poor}${row.unit || ''}`,
          }) + (row.meter.beyond ? t('report.chart.meterBeyond') : '');
        track.title = label;
        track.setAttribute('aria-label', label);
        cell.append(track);
        cell.append(el('span', 'chart-meter-r', ratingWord(row.meter.rating)));
      } else {
        cell.append(el('span', 'chart-meter-r', t('report.chart.nothingToCompare')));
      }
      grid.append(cell);
    }
    plot.append(grid);
    host.append(fig);
  }

  window.UQACharts = { activity, bars, meters, figure };
})();
