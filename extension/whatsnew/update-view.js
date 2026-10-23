/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The update page (f1023). `?update=<version>`: updating -> (updated by reload) | helper missing | failed. No query: "You are on vX".
 * Everything is built with createElement/textContent: release notes are remote text and never reach innerHTML.
 * The page lives in a tab, not the popup, so closing the popup cannot cut the update off.
 * No download starts unless the tester presses "Update manually instead".
 */
import { STAGES, parseNotes, detectOS, helperFile, helperCommand, stepsText, probe, runUpdate } from '../ui/update-lib.js';

const NS = 'http://www.w3.org/2000/svg';
const SEC = { added: ['update.upd2.sec.added', 'add'], changed: ['update.upd2.sec.changed', 'change'], fixed: ['update.upd2.sec.fixed', 'fix'], other: ['update.upd2.sec.other', 'other'] };
const STAGE_KEY = { downloading: 'update.upd2.stage.downloading', checking: 'update.upd2.stage.checking', installing: 'update.upd2.stage.installing', reloading: 'update.upd2.stage.reloading' };
const ICON = {
  check: 'M4.5 12.5l5 5L19.5 7', cross: 'M6 6l12 12M18 6L6 18', circle: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', arc: 'M12 3a9 9 0 0 1 9 9',
  add: 'M12 5v14M5 12h14', change: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5', fix: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z', other: 'M12 6h.01M12 12h.01M12 18h.01', info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8h.01M12 12v5',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
};

export async function start({ doc = document, api = chrome, tr, nav = navigator, search = location.search, win = window } = {}) {
  const cur = api.runtime.getManifest().version;
  const view = doc.getElementById('wn-view');
  const { qawPendingNotes: p, qawUpdateToken: token } = await api.storage.local.get(['qawPendingNotes', 'qawUpdateToken']);
  const want = new URLSearchParams(search).get('update');
  const live = win.UQALive;

  const el = (tag, text, cls) => { const e = doc.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const svg = (d) => { const s = doc.createElementNS(NS, 'svg'); const q = doc.createElementNS(NS, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); q.setAttribute('d', d); s.append(q); return s; };
  const ico = (d, cls = 'wn-ico') => { const s = el('span', null, cls); s.append(svg(d)); return s; };
  const btn = (text, cls, fn) => { const b = el('button', text, `btn ${cls || ''}`.trim()); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const hero = (icon, tone, title, lead) => {
    const h = el('header', null, 'wn-hero');
    const badge = el('div', null, `wn-badge ${tone}`); badge.append(svg(icon));
    h.append(badge, el('h1', title));
    if (lead) h.append(el('p', lead, 'wn-lead'));
    return h;
  };
  const safeLink = (url, cls) => {
    if (!/^https:\/\/github\.com\//.test(url || '')) return null;
    const a = el('a', tr('update.upd2.fullRelease'), cls); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a;
  };
  const show = (...nodes) => { view.replaceChildren(...nodes); doc.title = tr('update.upd1022.pageTitle'); };

  function notesBlock(text) {
    const box = el('div', null, 'wn-notes');
    const secs = parseNotes(text);
    if (!secs.length) box.append(el('p', tr('update.noNotes'), 'wn-lead'));
    for (const s of secs) {
      const sec = el('section', null, 'wn-sec'); sec.dataset.k = s.kind;
      const h = el('h2'); h.append(ico(ICON[SEC[s.kind][1]]), el('span', tr(SEC[s.kind][0])));
      const ul = el('ul'); for (const t of s.items) ul.append(el('li', t));
      sec.append(h, ul); box.append(sec);
    }
    return box;
  }

  /* ---- (b) updated ---- */
  function updated(rel) {
    const actions = el('div', null, 'wn-actions');
    const a = safeLink(rel?.url || `https://github.com/NJ-Burrito/QA-Wrap/releases/tag/v${cur}`, 'btn btn-primary');
    if (a) actions.append(a);
    show(hero(ICON.check, 'is-ok', tr('update.upd2.youreOn', { version: cur }), tr('update.upd2.untouched')), notesBlock(rel?.notes), actions);
  }

  /* ---- (a) updating ---- */
  const msgOf = (r) => ({ op: 'update', version: r.version, zip: r.zip, zipApi: r.zipApi, sha256: r.sha256, token: token || '' });

  async function updating(rel) {
    const list = el('ol', null, 'wn-stages');
    const rows = STAGES.map((s) => { const li = el('li', null, 'wn-stage'); const h = ico(ICON.circle); li.append(h, el('span', tr(STAGE_KEY[s]))); li.dataset.s = 'todo'; li.dataset.stage = s; list.append(li); return { li, h }; });
    const bar = el('div', null, 'wn-bar'); bar.append(el('i'));
    show(hero(ICON.download, '', tr('update.upd1022.updating', { version: rel.version }), tr('update.upd2.keepOpen')), list, bar);
    const set = (i, state, d) => { const r = rows[i]; r.li.dataset.s = state; r.h.querySelector('path').setAttribute('d', d); live?.[state === 'active' ? 'start' : 'clear']?.(r.h); };
    const at = (i) => {
      rows.forEach((r, j) => { if (j < i && r.li.dataset.s !== 'done') { set(j, 'done', ICON.check); live?.end(r.h, true); } });
      if (rows[i].li.dataset.s !== 'active') set(i, 'active', ICON.arc);
      bar.firstChild.style.setProperty('--p', `${Math.round((i / STAGES.length) * 100 + 8)}%`);
    };
    at(0);
    try {
      const r = await runUpdate(api, msgOf(rel), (s) => { const i = STAGES.indexOf(s); if (i >= 0) at(i); });
      if (!r.ok) throw r;
      at(3);
      bar.firstChild.style.setProperty('--p', '100%');
      setTimeout(() => api.runtime.reload(), 900); // the new build opens "You are on vX" itself (core/whats-new-open.js)
    } catch (e) {
      if (e && e.missing) return missing(rel);
      const i = rows.findIndex((r) => r.li.dataset.s === 'active');
      if (i >= 0) { set(i, 'fail', ICON.cross); live?.end(rows[i].h, false); }
      failed(rel);
    }
  }

  /* ---- (c) helper missing ---- */
  function missing(rel) {
    const os = detectOS(nav);
    const file = helperFile(os);
    const note = el('p', null, 'wn-note'); note.setAttribute('role', 'status');
    const steps = el('ol');
    for (const t of [tr('update.upd2.stepOpen'), tr(os === 'win' ? 'update.upd2.stepRunWin' : 'update.upd2.stepRunUnix'), tr('update.upd2.stepBack')]) steps.append(el('li', t));
    const fileRow = el('div', null, 'wn-file'); fileRow.append(ico(ICON.folder), el('code', file.path), el('span', tr('update.upd2.inFolder')));
    const again = btn(tr('update.upd2.checkAgain'), 'btn-primary', async () => {
      again.disabled = true; note.textContent = tr('update.upd2.looking');
      await Promise.resolve(api.permissions?.request?.({ permissions: ['nativeMessaging'] })).catch(() => false); // inside the press
      if (await probe(api)) return updating(rel);
      note.textContent = tr('update.upd2.notYet'); again.disabled = false;
    });
    const copy = btn(tr('update.upd2.copySteps'), '', async () => {
      try { await nav.clipboard.writeText(`${file.path}\n${stepsText(os, tr)}`); copy.textContent = tr('update.upd2.copied'); } catch { note.textContent = steps.textContent; }
    });
    const panel = el('section', null, 'wn-panel');
    panel.append(el('h2', tr('update.upd2.turnOn')), el('p', tr('update.upd2.turnOnLead')), fileRow, steps, el('p', tr('update.upd2.orCommand'), 'wn-or'), el('code', helperCommand(os), 'wn-cmd'), note, (() => { const r = el('div', null, 'wn-actions'); r.append(again, copy); return r; })());
    const alt = el('div', null, 'wn-alt'); alt.append(btn(tr('update.upd2.manualInstead'), 'btn-quiet', () => manual(rel)));
    show(hero(ICON.bolt, '', tr('update.upd2.ready', { version: rel.version }), tr('update.upd2.chooseHow')), panel, alt);
  }

  function manual(rel) { // the only place the zip is downloaded
    if (rel.zip) api.downloads.download({ url: rel.zip, filename: String(rel.zip).split('/').pop() || `qa-wrap-${rel.version}.zip`, conflictAction: 'uniquify' }).catch(() => {});
    const list = el('ol', null, 'wn-steps');
    [[ICON.download, 'update.step1'], [ICON.folder, 'update.upd2.manual2'], [ICON.change, 'update.step2']].forEach(([d, k]) => { const li = el('li'); li.append(ico(d), el('span', tr(k))); list.append(li); });
    const actions = el('div', null, 'wn-actions'); actions.append(btn(tr('update.upd2.back'), '', () => missing(rel)));
    const a = safeLink(rel.url, 'wn-link'); if (a) actions.append(a);
    show(hero(ICON.download, '', tr('update.upd2.manualTitle'), tr('update.upd2.manualLead')), list, actions);
  }

  /* ---- (d) failure ---- */
  function failed(rel) {
    const actions = el('div', null, 'wn-actions'); actions.append(btn(tr('update.upd2.retry'), 'btn-primary', () => updating(rel)));
    const a = safeLink(rel?.url, 'wn-link'); if (a) actions.append(a);
    show(hero(ICON.info, 'is-calm', tr('update.upd2.failedTitle'), tr('update.upd1022.failed')), el('p', tr('update.upd2.backup'), 'wn-backup'), actions);
  }

  if (want && p && p.version === want) { await updating(p); return 'updating'; }
  if (want) { failed(null); return 'failed'; }
  updated(p && p.version === cur ? p : null);
  return 'updated';
}
