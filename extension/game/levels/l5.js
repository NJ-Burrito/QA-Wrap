/* QA Wrap Bug Hunt - level 5 "The slow one" (lane B). Planted bug: POST /api/pay takes 4 s.
 * Hidden bonus: the text "Loading" stuck in a corner. Prove: QA Wrap goes to "stopped" AFTER the catch.
 * The paste-only finale gate lives in engine.js (inspectReport / bindPasteGate). */
export const id = 'l5';
export const n = 5;
export const proveKind = 'after-catch';     // tool 'stop'. Features taught: Stop, then Copy report (the paste gate is in engine.js)
/** Optional, self-reported: "Save last 2 minutes" (the replay buffer, switched on in the popup before the bug). */
export const chips = [{ id: 'buffer', tool: 'buffer', after: 'caught', signal: 'buffer' }];
export const SLOW_MS = 3000;

const h = (doc, tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  return el;
};

let cur = null; // { ctx, caught, alive, offs, busy, sawNotStopped }

/** Pure. evt: { type:'pay', durationMs, ok } | bonus-click | decoy-click. */
export function detect(evt) {
  if (!evt || typeof evt !== 'object') return { caught: false, reason: 'ignored' };
  if (evt.type === 'bonus-click') return { caught: false, bonus: true, reason: 'bonus' };
  if (evt.type === 'decoy-click') return { caught: false, decoy: String(evt.id || 'decoy'), reason: 'decoy' };
  if (evt.type !== 'pay') return { caught: false, reason: 'ignored' };
  if (evt.ok === false) return { caught: false, reason: 'pay-failed' };   // a failed request is not the slow bug
  if (!(Number(evt.durationMs) > SLOW_MS)) return { caught: false, reason: 'fast' };
  return { caught: true, reason: 'slow-call' };
}

/** "stopped" must be reached after the catch: if it already read "stopped" at the catch, wait for a change away and back. */
export function proveSignal(ctx) {
  if (!cur || !cur.caught) return false;
  const s = ctx.qawState();
  if (s !== 'stopped') { cur.sawNotStopped = true; return false; }
  return cur.sawNotStopped;
}

function handle(ctx, evt) {
  if (!cur || cur.ctx !== ctx || !cur.alive) return;
  evt.qaw = ctx.qawState();
  const r = detect(evt);
  if (r.caught) { cur.caught = true; cur.sawNotStopped = evt.qaw !== 'stopped'; ctx.emit({ type: 'catch', reason: r.reason }); }
  if (r.bonus) ctx.emit({ type: 'bonus' });
  if (r.nudge) ctx.emit({ type: 'nudge', key: r.nudge });
  if (r.decoy) ctx.emit({ type: 'wrong', kind: 'decoy', id: r.decoy });
}

export function mount(root, ctx) {
  const d = root.ownerDocument || ctx.doc;
  const t = ctx.t;
  root.append(h(d, 'div', { class: 'shop-window shop-dark', 'data-level': '5' },
    h(d, 'div', { class: 'shop-chrome' }, t('shop.l5.title')),
    h(d, 'div', { class: 'shop-row shop-total' }, h(d, 'span', { class: 'shop-label' }, t('shop.l5.total')), h(d, 'span', { class: 'shop-price' }, t('shop.l5.price'))),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'button', { class: 'shop-btn', id: 'pay', type: 'button' }, t('shop.l5.pay')),
      h(d, 'button', { class: 'shop-btn', id: 'cancel', type: 'button', 'data-decoy': 'cancel' }, t('shop.l5.cancel')),
      h(d, 'span', { class: 'shop-state', id: 'pay-state', 'aria-live': 'polite' }, '')),
    h(d, 'div', { class: 'shop-fine', 'data-bonus': 'l5' }, t('shop.l5.loading'))));
}

export function arm(ctx) {
  dispose();
  cur = { ctx, caught: false, alive: true, offs: [], busy: false, sawNotStopped: false };
  const root = ctx.root;
  const onClick = async (e) => {
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const bonus = el.closest('[data-bonus="l5"]');
    if (bonus && root.contains(bonus)) return handle(ctx, { type: 'bonus-click' });
    const decoy = el.closest('[data-decoy]');
    if (decoy && root.contains(decoy)) return handle(ctx, { type: 'decoy-click', id: decoy.getAttribute('data-decoy') });
    const btn = el.closest('#pay');
    if (!btn || !root.contains(btn)) return;
    const mine = cur;
    if (mine.busy) return;
    mine.busy = true;
    const out = root.querySelector('#pay-state');
    if (out) out.textContent = ctx.t('shop.l5.paying');
    const t0 = ctx.now();
    let ok = false;
    try {
      const res = await ctx.fetch('/api/pay', { method: 'POST', cache: 'no-store' });
      ok = !!res.ok;
    } catch { ok = false; }
    const durationMs = ctx.now() - t0;
    mine.busy = false;
    if (mine !== cur || !mine.alive) return;
    if (out) out.textContent = ''; // the "paying" line goes away; the bug is only that it took 4 s
    handle(ctx, { type: 'pay', durationMs, ok });
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
