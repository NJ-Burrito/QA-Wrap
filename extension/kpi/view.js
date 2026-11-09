/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The dashboard as HTML strings, from `buildKpi()` output. Pure: the words (`t`), the language and the numbers' locale come in as
 * arguments, so a node test can render the same markup the page shows, in both languages, without a browser.
 */

import { SEVERITIES } from '../core/kpi.js';
import { esc, trend, hbars, stacked, table } from './charts.js';

const MIN = 6e4;

/**
 * @param {import('../core/kpi.js').buildKpi extends (...a:any)=>infer R ? R : never} data
 * @param {{ t:(k:string,v?:object)=>string, lang:'en'|'ar', numTag:string, view:'day'|'week', site:string }} o
 */
export function render(data, o) {
  const { t, lang, numTag, view } = o;
  const rtl = lang === 'ar';
  const nf = new Intl.NumberFormat(numTag, { maximumFractionDigits: 1 });
  const n = (v) => nf.format(v);
  /** page-owned text (a host) keeps its own direction inside a sentence */
  const iso = (s) => (s ? `\u2068${s}\u2069` : '');
  const siteName = (s) => (s ? iso(s) : t('kpi.site.unknown'));

  const dur = (ms) => {
    const m = Math.round(ms / MIN);
    const h = Math.floor(m / 60);
    return h ? t('kpi.dur.hm', { h: n(h), m: n(m % 60) }) : t('kpi.dur.m', { m: n(m) });
  };

  const scope = o.site ? data.sites.find((s) => s.site === o.site) || data.all : data.all;
  /* Arabic month names are long and collide on an axis, so Arabic labels are day/month in Latin digits */
  const dateLabel = (key) => new Intl.DateTimeFormat(numTag, { day: 'numeric', month: rtl ? 'numeric' : 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`)).replace(/^(.*)$/, (m) => (rtl ? `\u2066${m}\u2069` : m));
  const series = view === 'week' ? scope.weeks : scope.days;
  const pts = (pick) => series.map((p) => ({ label: dateLabel(p.key), value: pick(p) }));
  const colHead = view === 'week' ? t('kpi.col.week') : t('kpi.col.day');

  const maxMin = Math.max(0, ...series.map((p) => p.ms / MIN));
  const hours = maxMin >= 120;
  const toUnit = (ms) => Number((hours ? ms / (60 * MIN) : ms / MIN).toFixed(hours ? 2 : 1));
  const unitWord = t(hours ? 'kpi.unit.hours' : 'kpi.unit.minutes');

  const peakLast = (ps, fmt) => {
    const top = ps.reduce((b, p) => (p.value > b.value ? p : b), { value: 0, label: '' });
    return t('kpi.desc.trend', { n: n(ps.length), peak: fmt(top.value), last: fmt(ps.at(-1)?.value ?? 0) });
  };

  const card = (id, title, figure, tbl, note = '') => `
    <section class="card chart" aria-labelledby="h-${id}">
      <h3 id="h-${id}">${esc(title)}</h3>
      ${figure}
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <details class="as-table"><summary>${esc(t('kpi.table.show'))}</summary>${tbl}</details>
    </section>`;

  /* ── trends ── */
  const timeTitle = t(view === 'week' ? 'kpi.chart.time.week' : 'kpi.chart.time.day');
  const timePts = pts((p) => toUnit(p.ms));
  const timeFmt = (v) => n(v);
  const timeFig = trend({ points: timePts, kind: 'line', rtl, title: `${timeTitle} (${unitWord})`, desc: peakLast(timePts, timeFmt), fmt: (v) => `${n(v)} ${unitWord}`, axisFmt: n, series: 'c1' });
  const timeTbl = table([[colHead, t('kpi.col.time'), unitWord], ...series.map((p) => [dateLabel(p.key), dur(p.ms), n(toUnit(p.ms))])], { caption: timeTitle });

  const sessTitle = t(view === 'week' ? 'kpi.chart.sessions.week' : 'kpi.chart.sessions.day');
  const sessPts = pts((p) => p.sessions);
  const sessFig = trend({ points: sessPts, kind: 'bar', rtl, title: sessTitle, desc: peakLast(sessPts, n), fmt: n, integer: true, series: 'c3' });
  const sessTbl = table([[colHead, t('kpi.col.sessions')], ...series.map((p) => [dateLabel(p.key), n(p.sessions)])], { caption: sessTitle });

  const bugTitle = t(view === 'week' ? 'kpi.chart.bugs.week' : 'kpi.chart.bugs.day');
  const bugPts = pts((p) => p.bugs);
  const bugFig = trend({ points: bugPts, kind: 'bar', rtl, title: bugTitle, desc: peakLast(bugPts, n), fmt: n, integer: true, series: 'c2' });
  const bugTbl = table([[colHead, t('kpi.col.bugs')], ...series.map((p) => [dateLabel(p.key), n(p.bugs)])], { caption: bugTitle });

  /* ── per site: always every site, the filter narrows the trends and tiles ── */
  const siteRows = data.sites.map((s) => ({ label: siteName(s.site), value: s.testingMs, text: dur(s.testingMs) }));
  const siteTitle = t('kpi.chart.sites');
  const siteFig = hbars({ rows: siteRows, rtl, title: siteTitle, desc: t('kpi.desc.rows', { title: siteTitle, n: n(siteRows.length) }), series: 'c1' });
  const siteTbl = table([[t('kpi.col.site'), t('kpi.col.time'), t('kpi.col.sessions')], ...data.sites.map((s) => [siteName(s.site), dur(s.testingMs), n(s.sessions)])], { caption: siteTitle });

  const covRows = data.sites.filter((s) => s.coverage.discovered > 0);
  const covTitle = t('kpi.chart.coverage');
  const covFig = stacked({
    rows: covRows.map((s) => ({ label: siteName(s.site), a: s.coverage.tested, b: s.coverage.notTested, text: t('kpi.row.coverage', { tested: n(s.coverage.tested), total: n(s.coverage.discovered), pct: n(s.coverage.pct ?? 0) }) })),
    rtl, title: covTitle, desc: t('kpi.desc.rows', { title: covTitle, n: n(covRows.length) }),
  });
  const legend = `<ul class="legend" aria-label="${esc(t('kpi.legend.label'))}"><li><span class="sw c1"></span>${esc(t('kpi.legend.tested'))}</li><li><span class="sw untested"></span>${esc(t('kpi.legend.untested'))}</li></ul>`;
  const basisOf = (b) => t(b === 'links' ? 'kpi.basis.links' : 'kpi.basis.visited');
  const covTbl = table([[t('kpi.col.site'), t('kpi.col.pages'), t('kpi.col.tested'), t('kpi.col.untested'), t('kpi.col.basis')], ...covRows.map((s) => [siteName(s.site), n(s.coverage.discovered), n(s.coverage.tested), n(s.coverage.notTested), basisOf(s.coverage.basis)])], { caption: covTitle });
  const bases = [...new Set(covRows.map((s) => s.coverage.basis))];
  const covNote = bases.map((b) => t(b === 'links' ? 'kpi.note.basis.links' : 'kpi.note.basis.visited')).join(' ');

  const sevTitle = t('kpi.chart.severity');
  const sevRows = SEVERITIES.map((k) => ({ label: t(`kpi.sev.${k}`), value: scope.severity[k], text: n(scope.severity[k]) }));
  const sevFig = hbars({ rows: sevRows, rtl, title: sevTitle, desc: t('kpi.desc.rows', { title: sevTitle, n: n(sevRows.length) }), series: 'c2' });
  const sevTbl = table([[t('kpi.col.severity'), t('kpi.col.bugs')], ...sevRows.map((r) => [r.label, r.text])], { caption: sevTitle });

  /* ── tiles ── */
  const cov = scope.coverage;
  const tile = (label, value, sub = '') => `<div class="tile"><dt>${esc(label)}</dt><dd><span class="big">${esc(value)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</dd></div>`;
  const tiles = `<dl class="tiles">${[
    tile(t('kpi.tile.time'), dur(scope.testingMs)),
    tile(t('kpi.tile.sessions'), n(scope.sessions)),
    tile(t('kpi.tile.avg'), dur(scope.avgSessionMs)),
    tile(t('kpi.tile.bugs'), n(scope.bugs)),
    tile(t('kpi.tile.coverage'), cov.pct == null ? t('kpi.tile.none') : `${n(cov.pct)}%`, cov.pct == null ? '' : t('kpi.tile.coverageSub', { tested: n(cov.tested), total: n(cov.discovered) })),
  ].join('')}</dl>`;

  const notes = `<ul class="notes"><li>${esc(t('kpi.note.bugs'))}</li><li>${esc(t('kpi.note.severity'))}</li><li>${esc(t('kpi.note.time'))}</li></ul>`;

  return {
    tiles,
    charts: [
      card('time', `${timeTitle} (${unitWord})`, timeFig, timeTbl),
      card('bugs', bugTitle, bugFig, bugTbl),
      card('sessions', sessTitle, sessFig, sessTbl),
      card('sites', siteTitle, siteFig, siteTbl),
      card('coverage', covTitle, legend + (covRows.length ? covFig : `<p class="note">${esc(t('kpi.tile.none'))}</p>`), covTbl, covNote),
      card('severity', sevTitle, sevFig, sevTbl),
    ].join(''),
    notes,
  };
}
