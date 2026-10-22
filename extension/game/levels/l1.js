/* QA Wrap Bug Hunt - level 1 "Wake it" (lane B). Planted bug: Save says "Saved" while POST /api/save-profile returns 500.
 * Hidden bonus: the Name label has a typo (click it). Detector contract: see work/sdlc/design/DESIGN-bug-hunt.md s2.3, s11.
 * Every text comes from ctx.t(key); no network except the game's own origin; no timers other than ctx.*. */
export const id = 'l1';
export const n = 1;
export const proveKind = 'awake';           // tool 'wake' (scoring.js). Feature taught: "Test this site" (features.json)
/** Optional, self-reported: the Alt+Shift+Q shortcut (a keypress the page cannot see; read from qawShortcut when shared). */
export const chips = [{ id: 'shortcut', tool: 'shortcut', after: 'any', signal: 'shortcut' }]; // signal: qawShortcut when the extension shares it
const AWAKE = new Set(['ready', 'recording']);          // catch gate
const NOT_ASLEEP = new Set(['ready', 'recording', 'stopped']);  // prove: "qawState left asleep"

const h = (doc, tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  return el;
};

let cur = null; // { ctx, caught, alive, offs }

/** Pure: one page event in, { caught, reason, bonus?, nudge?, decoy? } out. evt.qaw is the qawState at the time. */
export function detect(evt) {
  if (!evt || typeof evt !== 'object') return { caught: false, reason: 'ignored' };
  if (evt.type === 'bonus-click') return { caught: false, bonus: true, reason: 'bonus' };
  if (evt.type === 'decoy-click') return { caught: false, decoy: String(evt.id || 'decoy'), reason: 'decoy' };
  if (evt.type !== 'save') return { caught: false, reason: 'ignored' };
  if (!(Number(evt.status) >= 500)) return { caught: false, reason: 'status-ok' };
  if (!evt.saidSaved) return { caught: false, reason: 'no-saved-text' };
  if (!AWAKE.has(evt.qaw)) return { caught: false, reason: 'asleep', nudge: 'rail.nudgeAsleep' }; // stays armed
  return { caught: true, reason: 'saved-on-500' };
}

/** Objective prove: QA Wrap has left "asleep" (only possible after the catch, which needed it awake). */
export function proveSignal(ctx) {
  return !!(cur && cur.caught && NOT_ASLEEP.has(ctx.qawState()));
}

function handle(ctx, evt) {
  if (!cur || cur.ctx !== ctx || !cur.alive) return;
  evt.qaw = ctx.qawState();
  const r = detect(evt);
  if (r.caught) cur.caught = true;
  if (r.caught) ctx.emit({ type: 'catch', reason: r.reason });
  if (r.bonus) ctx.emit({ type: 'bonus' });
  if (r.nudge) ctx.emit({ type: 'nudge', key: r.nudge });
  if (r.decoy) ctx.emit({ type: 'wrong', kind: 'decoy', id: r.decoy });
}

export function mount(root, ctx) {
  const d = root.ownerDocument || ctx.doc;
  const t = ctx.t;
  root.append(h(d, 'div', { class: 'shop-window', 'data-level': '1' },
    h(d, 'div', { class: 'shop-chrome' }, t('shop.l1.title')),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'label', { class: 'shop-label', for: 'name', 'data-bonus': 'l1' }, t('shop.l1.nameTypo')),
      h(d, 'input', { class: 'shop-field', id: 'name', type: 'text', value: t('shop.l1.nameValue'), autocomplete: 'off' })),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'label', { class: 'shop-label', for: 'phone' }, t('shop.l1.phone')),
      h(d, 'input', { class: 'shop-field', id: 'phone', type: 'text', value: t('shop.l1.phoneValue'), autocomplete: 'off' })),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'button', { class: 'shop-btn', id: 'save', type: 'button' }, t('shop.l1.save')),
      h(d, 'button', { class: 'shop-btn', id: 'cancel', type: 'button', 'data-decoy': 'cancel' }, t('shop.l1.cancel')),
      h(d, 'span', { class: 'shop-state', id: 'save-state', 'aria-live': 'polite' }, ''))));
}

export function arm(ctx) {
  dispose();
  cur = { ctx, caught: false, alive: true, offs: [] };
  const root = ctx.root;
  const onClick = async (e) => {
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const bonus = el.closest('[data-bonus="l1"]');
    if (bonus && root.contains(bonus)) return handle(ctx, { type: 'bonus-click' });
    const decoy = el.closest('[data-decoy]');
    if (decoy && root.contains(decoy)) return handle(ctx, { type: 'decoy-click', id: decoy.getAttribute('data-decoy') });
    if (!el.closest('#save')) return;
    const mine = cur;
    let status = 0;
    try {
      const res = await ctx.fetch('/api/save-profile', { method: 'POST', cache: 'no-store' });
      status = res.status;
    } catch { status = 0; }
    if (!mine || mine !== cur || !mine.alive) return;
    const out = root.querySelector('#save-state');
    if (out) out.textContent = ctx.t('shop.l1.saved'); // the planted lie: it says Saved whatever happened
    handle(ctx, { type: 'save', status, saidSaved: true });
  };
  root.addEventListener('click', onClick);
  cur.offs.push(() => root.removeEventListener('click', onClick));
}

export function dispose() {
  if (!cur) return;
  cur.alive = false;
  for (const off of cur.offs) { try { off(); } catch { /* ignore */ } }
  cur = null;
}

export default { id, n, proveKind, chips, mount, arm, detect, proveSignal, dispose };
