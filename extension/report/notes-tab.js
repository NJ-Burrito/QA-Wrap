/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Notes tab under Evidence (ui-1020): every note the tester took, with its type, time and page.
 * Loaded on first open (report.js is at its budget). Export and masking are the timeline's: notes-build.js, unchanged.
 * Nothing here runs until the tab is pressed, and nothing re-draws by itself.
 */
import { buildNotesExport, sessionNotes, clean } from './notes-build.js';

const OPEN_ROWS = 7; // Autopilot rule 2: at most 7 rows open by default
const $ = (id) => document.getElementById(id);
const t = (k, v) => window.QAWi18n.t(k, v);
let filter = 'all';
let expanded = false;
let wired = false;

const typeOf = (e) => e.tag || 'note';
const typeLabel = (tag) => (window.QAWi18n.has(`popup.tags.${tag}`) ? t(`popup.tags.${tag}`) : tag);
const say = (key, tone = '', vars) => { const s = $('status'); if (s) { s.textContent = t(key, vars); s.className = `status ${tone}`; } };
const hostOf = (e) => { try { return new URL(e.frameUrl || e.url).host; } catch { return e.tabTitle || ''; } };
const clock = (ts) => new Date(ts).toLocaleTimeString(window.QAWi18n.numTag(), { hour12: false });
const shown = (notes) => (filter === 'all' ? notes : notes.filter((e) => typeOf(e) === filter));

function draw() {
  const ctx = window.UQAReport?.mail;
  const notes = ctx ? sessionNotes(ctx.events) : [];
  const types = [...new Set(notes.map(typeOf))];
  if (filter !== 'all' && !types.includes(filter)) filter = 'all';
  const list = shown(notes);
  const chips = $('notes-filters');
  chips.replaceChildren();
  for (const [key, label, n] of [['all', t('report.notes.all'), notes.length], ...types.map((k) => [k, typeLabel(k), notes.filter((e) => typeOf(e) === k).length])]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'filter'; b.dataset.type = key;
    b.setAttribute('aria-pressed', String(filter === key));
    const c = document.createElement('span'); c.className = 'filter-n'; c.textContent = String(n);
    b.append(document.createTextNode(`${label} `), c);
    b.addEventListener('click', () => { filter = key; expanded = false; draw(); });
    chips.append(b);
  }
  const empty = $('notes-empty');
  empty.hidden = notes.length > 0;
  empty.textContent = notes.length ? '' : t('report.notes.empty');
  $('notes-save').hidden = $('notes-save-csv').hidden = !notes.length;
  const rows = expanded ? list : list.slice(0, OPEN_ROWS);
  $('notes-list').replaceChildren(...rows.map((e) => {
    const li = document.createElement('li'); li.className = 'nt-row'; li.dataset.type = typeOf(e);
    const tag = document.createElement('span'); tag.className = 'nt-tag'; tag.textContent = typeLabel(typeOf(e));
    const body = document.createElement('div');
    const text = document.createElement('p'); text.className = 'nt-text'; text.dir = 'auto'; text.textContent = clean(e.text).trim();
    const meta = document.createElement('p'); meta.className = 'nt-meta';
    meta.textContent = [clock(e.ts), hostOf(e)].filter(Boolean).join(' · ');
    body.append(text, meta);
    const cp = document.createElement('button');
    cp.type = 'button'; cp.className = 'btn btn-sm btn-ghost'; cp.textContent = t('report.file.copy');
    cp.setAttribute('aria-label', t('report.notes.copyAria'));
    cp.addEventListener('click', () => { navigator.clipboard.writeText(text.textContent).then(() => say('report.v.copied', 'ok')).catch(() => say('report.notes.copyFailed', 'err')); });
    li.append(tag, body, cp);
    return li;
  }));
  const more = $('notes-more');
  more.hidden = expanded || list.length <= OPEN_ROWS;
  more.textContent = t('report.notes.showAll', { n: list.length });
}

async function save(format) {
  const ctx = window.UQAReport?.mail;
  const keep = new Set(shown(sessionNotes(ctx?.events || [])));
  const out = buildNotesExport(ctx?.session, (ctx?.events || []).filter((e) => keep.has(e)), format);
  if (!out.count) return say('report.timeline.exportNone', 'err');
  const res = await window.UQADownload.downloadText(out.content, out.filename, out.mime);
  say(res.ok ? 'report.timeline.exported' : 'report.timeline.exportFailed', res.ok ? 'ok' : 'err', { n: out.count, name: out.filename });
}

export function openNotes() {
  if (!wired) {
    wired = true;
    $('notes-more').addEventListener('click', () => { expanded = true; draw(); });
    for (const [id, f] of [['notes-save', 'markdown'], ['notes-save-csv', 'csv']]) $(id).addEventListener('click', () => { save(f).catch(() => say('report.timeline.exportFailed', 'err')); });
    window.QAWi18n.onChange?.(() => { if (!$('panel-notes').hidden) draw(); });
  }
  draw();
}
