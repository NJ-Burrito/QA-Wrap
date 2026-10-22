/* QA Wrap Bug Hunt - level 2 "Console clue" (lane B). Feature taught: the recorder catches a failure by itself, and "Not a bug" marks
 * harmless noise as expected. Planted bug: Apply coupon throws an uncaught TypeError marked __game:'l2'. Planted noise: "Refresh offers"
 * asks for /api/coupons, which answers 404 on purpose (an expected failure, not a bug).
 * Hidden bonus: the currency symbol differs between the two prices (click the total).
 * Prove: a "Not a bug" press after the harmless failure (qawExpected rises); without that count, the self-reported chip "I pressed Not a bug". */
export const id = 'l2';
export const n = 2;
export const proveKind = 'chip';            // tool 'notbug'
/** The recorder caught it: awarded with the catch (it could only be caught with QA Wrap awake). */
export const catchFeature = { tool: 'recorder', kind: 'caught' };
export const chips = [];
const AWAKE = new Set(['ready', 'recording']);

const h = (doc, tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  return el;
};

let cur = null;

/** Pure. evt: { type:'error', error, qaw } | { type:'bonus-click' } | { type:'decoy-click', id }. */
export function detect(evt) {
  if (!evt || typeof evt !== 'object') return { caught: false, reason: 'ignored' };
  if (evt.type === 'bonus-click') return { caught: false, bonus: true, reason: 'bonus' };
  if (evt.type === 'decoy-click') return { caught: false, decoy: String(evt.id || 'decoy'), reason: 'decoy' };
  if (evt.type === 'noise') return { caught: false, noise: true, reason: 'expected-failure' }; // never a catch, never a deduction
  if (evt.type !== 'error') return { caught: false, reason: 'ignored' };
  const marked = !!evt.error && typeof evt.error === 'object' && evt.error.__game === 'l2';
  if (!marked) return { caught: false, reason: 'foreign-error' }; // an extension or another script erred: not our bug
  if (!AWAKE.has(evt.qaw)) return { caught: false, reason: 'asleep', nudge: 'rail.nudgeAsleep' };
  return { caught: true, reason: 'marker-error' };
}

const expectedNow = (ctx) => { const c = ctx.qawCounts(); return c && Number.isInteger(c.expected) ? c.expected : null; };

/** When the extension shares qawExpected (count of "Not a bug" presses): proved by a press AFTER the harmless failure happened. */
export function proveSignal(ctx) {
  if (!cur || !cur.caught || !cur.refreshed) return false;
  const e = expectedNow(ctx);
  if (e === null) return false;
  if (cur.baseExpected === null || e < cur.baseExpected) { cur.baseExpected = e; return false; }
  return e > cur.baseExpected;
}

/** Is the count shared? If not, the self-report chip is the fallback. */
export function signalAvailable(ctx) { return expectedNow(ctx) !== null; }

/** The fallback chip is only honest once the harmless failure has really been recorded. */
export function chipReady() { return !!(cur && cur.refreshed); }

function handle(ctx, evt) {
  if (!cur || cur.ctx !== ctx || !cur.alive) return;
  evt.qaw = ctx.qawState();
  const r = detect(evt);
  if (r.caught) { cur.caught = true; ctx.emit({ type: 'catch', reason: r.reason }); }
  if (r.bonus) ctx.emit({ type: 'bonus' });
  if (r.noise) { cur.refreshed = true; ctx.emit({ type: 'noise' }); }
  if (r.nudge) ctx.emit({ type: 'nudge', key: r.nudge });
  if (r.decoy) ctx.emit({ type: 'wrong', kind: 'decoy', id: r.decoy });
}

export function mount(root, ctx) {
  const d = root.ownerDocument || ctx.doc;
  const t = ctx.t;
  root.append(h(d, 'div', { class: 'shop-window', 'data-level': '2' },
    h(d, 'div', { class: 'shop-chrome' }, t('shop.l2.title')),
    h(d, 'div', { class: 'shop-row' }, h(d, 'span', { class: 'shop-label' }, t('shop.l2.item')), h(d, 'span', { class: 'shop-price' }, t('shop.l2.priceA'))),
    h(d, 'div', { class: 'shop-row shop-total' }, h(d, 'span', { class: 'shop-label' }, t('shop.l2.total')),
      h(d, 'span', { class: 'shop-price', 'data-bonus': 'l2' }, t('shop.l2.priceB'))),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'input', { class: 'shop-field', id: 'coupon', type: 'text', placeholder: t('shop.l2.couponPlaceholder'), 'aria-label': t('shop.l2.coupon'), autocomplete: 'off' }),
      h(d, 'button', { class: 'shop-btn', id: 'apply', type: 'button' }, t('shop.l2.apply')),
      h(d, 'button', { class: 'shop-btn', id: 'remove', type: 'button', 'data-decoy': 'remove' }, t('shop.l2.remove')),
      h(d, 'button', { class: 'shop-btn', id: 'refresh', type: 'button' }, t('shop.l2.refresh')))));
}

export function arm(ctx) {
  dispose();
  cur = { ctx, caught: false, alive: true, offs: [], refreshed: false, baseExpected: null };
  const root = ctx.root;
  const onClick = (e) => {
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const bonus = el.closest('[data-bonus="l2"]');
    if (bonus && root.contains(bonus)) return handle(ctx, { type: 'bonus-click' });
    const decoy = el.closest('[data-decoy]');
    if (decoy && root.contains(decoy)) return handle(ctx, { type: 'decoy-click', id: decoy.getAttribute('data-decoy') });
    if (el.closest('#refresh') && root.contains(el.closest('#refresh'))) { // harmless noise: a 404 the page shrugs off
      if (!cur.refreshed) cur.baseExpected = expectedNow(ctx); // a "Not a bug" press counts from here on
      Promise.resolve(ctx.fetch('/api/coupons', { cache: 'no-store' })).catch(() => {}).then(() => handle(ctx, { type: 'noise' }));
      return;
    }
    if (!el.closest('#apply')) return;
    const code = String((root.querySelector('#coupon') || {}).value || '').trim().toUpperCase();
    const coupons = undefined; // the coupon table was never loaded: the planted bug
    try {
      void coupons[code].label;
    } catch (err) {
      if (err && typeof err === 'object') err.__game = 'l2';
      // Raised as an error EVENT, not thrown: the recorder's window 'error' listener sees it (the clue), but it is no uncaught exception,
      // so Chrome does not add a row to chrome://extensions > QA Wrap > Errors every time a coupon is applied (Nader, 15 Oct 2026).
      if (win && win.dispatchEvent && win.ErrorEvent) win.dispatchEvent(new win.ErrorEvent('error', { error: err, message: 'Uncaught ' + (err && err.name) + ': ' + (err && err.message), filename: String((win.location && win.location.href) || ''), lineno: 1, colno: 1 }));
      else throw err;
    }
  };
  const win = ctx.win;
  const onErr = (e) => handle(ctx, { type: 'error', error: e && e.error });
  root.addEventListener('click', onClick);
  cur.offs.push(() => root.removeEventListener('click', onClick));
  if (win && win.addEventListener) {
    win.addEventListener('error', onErr);
    cur.offs.push(() => win.removeEventListener('error', onErr));
  }
}

export function dispose() {
  if (!cur) return;
  cur.alive = false;
  for (const off of cur.offs) { try { off(); } catch { /* ignore */ } }
  cur = null;
}

export default { id, n, proveKind, catchFeature, chips, mount, arm, detect, proveSignal, signalAvailable, chipReady, dispose };
