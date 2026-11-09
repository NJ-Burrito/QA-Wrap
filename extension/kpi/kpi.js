/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The KPI dashboard page (R4): reads this user's own sessions from the local store, computes `core/kpi.js`, draws `view.js`.
 * Reached from Settings, About, "Performance indicators" (options/options.html). Nothing is fetched and nothing leaves the browser.
 */

import { listSessions, getEventsByKind } from '../core/db.js';
import { buildKpi } from '../core/kpi.js';
import { render } from './view.js';
import { exportPdf } from './pdf.js';

await QAWi18n.ready();

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const t = (k, v) => QAWi18n.t(k, v);
const KINDS = ['nav', 'dom', 'note', 'links'];
const DAY_MS = 864e5;

/** @type {{ sessions: object[], events: Map<string, object[]> } | null} */
let store = null;
let rangeDays = 30;
let site = '';
let view = 'day';

async function load() {
  const sessions = await listSessions();
  const events = new Map();
  for (const s of sessions) events.set(s.id, await getEventsByKind(s.id, KINDS));
  store = { sessions, events };
}

const tzOffsetMin = () => -new Date().getTimezoneOffset();

function compute() {
  if (!store) return null;
  const since = rangeDays ? Date.now() - rangeDays * DAY_MS : undefined;
  return buildKpi(store.sessions, store.events, { since, tzOffsetMin: tzOffsetMin(), weekStartsOn: QAWi18n.lang() === 'ar' ? 6 : 1 });
}

function paintSiteFilter(data) {
  const sel = $('f-site');
  const sites = data.sites.map((s) => s.site);
  if (site && !sites.includes(site)) site = '';
  sel.replaceChildren(new Option(t('kpi.site.all'), ''), ...sites.map((s) => new Option(s || t('kpi.site.unknown'), s)));
  sel.value = site;
}

function paint() {
  const data = compute();
  if (!data) return;
  const lang = QAWi18n.lang() === 'ar' ? 'ar' : 'en';
  paintSiteFilter(data);
  $('empty').hidden = !data.empty;
  $('content').hidden = data.empty;
  $('status').textContent = '';
  if (data.empty) return;
  const out = render(data, { t, lang, numTag: QAWi18n.numTag(), view: view === 'week' ? 'week' : 'day', site });
  $('tiles').innerHTML = out.tiles;
  $('charts').innerHTML = out.charts;
  $('notes').innerHTML = out.notes;
}

const scopeLine = () => {
  const range = t(rangeDays ? `kpi.range.${rangeDays}` : 'kpi.range.all');
  return t('kpi.print.scope', { range, site: site || t('kpi.site.all'), date: new Date().toISOString().slice(0, 10) });
};

$('f-range').addEventListener('change', (e) => { rangeDays = Number(e.target.value); paint(); });
$('f-site').addEventListener('change', (e) => { site = e.target.value; paint(); });
for (const r of document.querySelectorAll('input[name="view"]')) r.addEventListener('change', (e) => { view = e.target.value; paint(); });

$('export-pdf').addEventListener('click', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const version = chrome.runtime.getManifest().version;
  await exportPdf({ lang: QAWi18n.lang(), date, version, fallback: t('kpi.print.trace', { version, date }), heading: t('kpi.print.heading'), scope: scopeLine() });
});

function paintTheme() {
  const btn = $('theme');
  if (!window.UQATheme) return;
  const state = window.UQATheme.describe();
  const mode = window.UQATheme.read?.() || 'system';
  const { label, next } = window.UQADom.themeWords(mode, state);
  btn.innerHTML = window.UQAIcon?.(`theme-${['light', 'dark'].includes(mode) ? mode : 'system'}`, { size: 16 }) || '';
  btn.title = next;
  btn.setAttribute('aria-label', t('tutorials.theme.ariaLabel', { label, next }));
}
$('theme').addEventListener('click', () => { window.UQATheme?.cycle(); paintTheme(); });
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

QAWi18n.onChange(() => { QAWi18n.apply(); paint(); paintTheme(); });
paintTheme();

try {
  await load();
  paint();
  document.body.dataset.kpiReady = '1'; // the ready state a probe waits for (R15)
} catch {
  $('status').textContent = t('kpi.error');
  document.body.dataset.kpiReady = 'error';
}
