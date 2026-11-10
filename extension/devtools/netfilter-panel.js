/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The DevTools panel's side of the network filter (D1, D6, D9, D10 of docs/decisions/2026-11-10-network-filter-and-click-labels.md).
 * An ES module loaded with import() by panel.js, so the panel's own file stays small. The tester's preset and rules live in
 * chrome.storage.local under `qaw.netfilter`; the recorder (click labels) and the bridge (pinned hosts, denylist) read the same key.
 */
import * as NF from '../core/netfilter.js';
import { isNet, groupRows, groupLabel } from '../core/netkeys.js';

export { NF };
const KEY = 'qaw.netfilter';

export async function loadCfg() {
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    return { ...NF.DEFAULT_CONFIG, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...NF.DEFAULT_CONFIG };
  }
}
export const saveCfg = (cfg) => chrome.storage.local.set({ [KEY]: cfg });
export const onChange = (fn) => chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY]) fn(); });

/** The site a rule belongs to: the registrable domain of the session's start page. */
export function siteOf(session) {
  try { return NF.etld1(new URL(session?.startUrl || '').hostname); } catch { return ''; }
}

/** Prepared events, cached by the list and the config so a poll that adds nothing costs nothing. */
let cache = { events: null, len: -1, cfg: null, site: '', out: [] };
export function prepared(events, cfg, site) {
  if (cache.events === events && cache.len === events.length && cache.cfg === cfg && cache.site === site) return cache.out;
  cache = { events, len: events.length, cfg, site, out: NF.prepare(events, cfg, site) };
  return cache.out;
}

/** The role word in the UI language; an unknown role is shown as it is. */
const ROLE_KEYS = {
  button: 'panel.nf.role.button', checkbox: 'panel.nf.role.checkbox', gridcell: 'panel.nf.role.gridcell', cell: 'panel.nf.role.gridcell', link: 'panel.nf.role.link',
  menuitem: 'panel.nf.role.menuitem', option: 'panel.nf.role.option', radio: 'panel.nf.role.radio', row: 'panel.nf.role.row', switch: 'panel.nf.role.switch',
  tab: 'panel.nf.role.tab', textbox: 'panel.nf.role.textbox',
};
export const roleWord = (t, role) => (ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role);

/** `Clicked "Save" (button)` / `نقر على «حفظ» (زر)`, `Clicked an icon button`, `Clicked (grid cell)`. The label goes in <bdi> where the caller can; this returns text plus the parts. */
export function clickSummary(t, ev) {
  const role = roleWord(t, ev.role || ev.tag || 'element');
  if (ev.label && ev.role) return { text: t('panel.timeline.summary.clickedLabel', { label: ev.label, role }), label: ev.label, role };
  if (ev.unnamed === 'icon') return { text: t('panel.timeline.summary.clickedIconButton') };
  if (ev.unnamed === 'none') return { text: t('panel.timeline.summary.clickedNoName') };
  if (ev.role && !ev.label) return { text: t('panel.timeline.summary.clickedRole', { role }) };
  return null;
}

/** The header chip: "Filter: Balanced · 3 rules for this site". */
export function chip(t, el, cfg, site) {
  const c = el('span', 'sg-chip nf-chip', t('panel.nf.chip', { preset: t(`common.nf.preset.${cfg.preset}`), n: NF.siteRuleCount(cfg, site) }));
  c.title = t('options.nf.title');
  return c;
}

/** "N background calls hidden · Show", the counted reasons, and the accounting line. `onToggle` flips the Show state. */
export function hiddenBar(t, el, sum, shown, onToggle) {
  const box = el('div', 'sg nf-bar');
  const line = el('p', 'sg-line sg-hiding');
  line.append(document.createTextNode(`${t('panel.nf.hiddenBar', { n: sum.hiddenTotal })} · `));
  const b = el('button', 'sg-btn', shown ? t('panel.nf.hideHidden') : t('panel.nf.showHidden'));
  b.type = 'button';
  b.setAttribute('aria-pressed', String(shown));
  b.addEventListener('click', onToggle);
  line.append(b);
  box.append(line);
  const parts = Object.entries(sum.hidden).map(([k, n]) => `${t(`common.signal.r.n-${k === 'redirect' ? 'junk' : k}`)} ${n}`);
  if (parts.length) box.append(el('p', 'sg-line', parts.join(', ')));
  return box;
}

/** D6: repeats inside a 30 s window, across click epochs, as one row: `12× GET /api/users/:id › 404 · over 3 s`, `9 ok, 3× 500`; coloured by the worst status. */
export function groupedRows(t, el, rows) {
  const lead = new Map();
  const skip = new Set();
  const leadOf = new Map(); // a folded member -> the row that leads its group
  for (const g of groupRows(rows)) {
    lead.set(g.items[0], g);
    for (const it of g.items.slice(1)) { skip.add(it); leadOf.set(it, g.items[0]); }
  }
  return { skip, leadOf, row: (ev) => {
    const g = lead.get(ev);
    if (!g) return null;
    const r = el('div', `ev fail nf-group${g.worst >= 500 || g.worst === 0 ? ' sev-high' : ''}`);
    const body = el('div', 'body');
    const label = groupLabel(g, (s) => t('panel.nf.over', { s }));
    body.textContent = label;
    r.title = label;
    r.append(el('span', 't', ''), el('span', 'k', 'net'), body);
    return r;
  } };
}

/**
 * The per-row menu (D9): Hide this endpoint, Hide this domain, Always show. A hide rule defaults to one method + path template and
 * asks first when it would hide more than 20 recorded rows. Every change shows an Undo for 8 seconds.
 */
export function rowMenu({ t, el, ev, events, cfg, site, apply, toast, base }) {
  const p = (() => { try { return new URL(ev.url, ev.frameUrl || base || 'file:///'); } catch { return null; } })();
  if (!p || !isNet(ev)) return null;
  const host = p.hostname || '';
  const endpoint = { kind: 'hide', scope: 'endpoint', host, method: String(ev.method || 'GET').toUpperCase(), path: NF.pathTemplate(p.pathname) };
  const wrap = el('span', 'nf-menu');
  const make = (label, rule, what) => {
    const b = el('button', 'sg-btn', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (rule.kind === 'hide') {
        const n = NF.rowsHiddenBy(rule, events);
        if (n > 20 && !window.confirm(t('panel.nf.hideWarn', { n }))) return;
      }
      const before = cfg;
      await apply(NF.addRule(cfg, site, rule));
      toast(t(rule.kind === 'hide' ? 'panel.nf.hideToast' : 'panel.nf.shownToast', { what }), t('panel.nf.undo'), () => apply(before));
    });
    return b;
  };
  wrap.append(
    make(t('panel.nf.hideEndpoint'), endpoint, `${endpoint.method} ${endpoint.path}`),
    make(t('panel.nf.hideDomain'), { kind: 'hide', scope: 'domain', host }, host),
    make(t('panel.nf.alwaysShow'), { ...endpoint, kind: 'show' }, `${endpoint.method} ${endpoint.path}`),
  );
  return wrap;
}
