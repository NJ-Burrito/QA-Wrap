/* QA Wrap Bug Hunt - level 4 "Squeezed" (lane B). Planted bug: the order number overflows its box (#ref.scrollWidth > clientWidth).
 * Hidden bonus: 9 px fine print. Prove: a screenshot taken AFTER the catch (qawShots goes up).
 * The overflow is planted with inline style so it holds whatever the stylesheet does. */
export const id = 'l4';
export const n = 4;
export const proveKind = 'after-catch';     // tool 'shot'. Feature taught: Take a screenshot, then Mark up
/** Optional, self-reported: marking the spot on the screenshot (the annotator is an extension page, no signal). */
export const chips = [{ id: 'markup', tool: 'markup', after: 'caught', signal: 'marks' }];

const h = (doc, tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  return el;
};

let cur = null; // { ctx, caught, alive, offs, baseShots }

/** Pure. evt: { type:'click', id, overflow } (overflow read AT click time) | bonus-click | decoy-click. Load alone never catches. */
export function detect(evt) {
  if (!evt || typeof evt !== 'object') return { caught: false, reason: 'ignored' };
  if (evt.type === 'bonus-click') return { caught: false, bonus: true, reason: 'bonus' };
  if (evt.type === 'decoy-click') return { caught: false, decoy: String(evt.id || 'decoy'), reason: 'decoy' };
  if (evt.type !== 'click') return { caught: false, reason: 'ignored' };
  if (evt.id !== 'ref') return { caught: false, reason: 'not-ref' };
  if (!evt.overflow) return { caught: false, reason: 'fits' };        // e.g. the window was widened: nothing to catch any more
  return { caught: true, reason: 'overflow' };
}

const shotsNow = (ctx) => { const c = ctx.qawCounts(); return c && Number.isFinite(c.shots) ? c.shots : null; };

export function proveSignal(ctx) {
  if (!cur || !cur.caught) return false;
  const now = shotsNow(ctx);
  if (now === null) return false;
  if (cur.baseShots === null || now < cur.baseShots) { cur.baseShots = now; return false; }
  return now > cur.baseShots;
}

/** The count only moves while a session records (the worker logs a tool press against a live session); a shot taken in Ready or after Stop never rises, so there the self-report chip is offered instead of a goal nothing can meet. */
export function signalAvailable(ctx) { return shotsNow(ctx) !== null && ctx.qawState() === 'recording'; }

function handle(ctx, evt) {
  if (!cur || cur.ctx !== ctx || !cur.alive) return;
  evt.qaw = ctx.qawState();
  const r = detect(evt);
  if (r.caught) { cur.caught = true; cur.baseShots = shotsNow(ctx); ctx.emit({ type: 'catch', reason: r.reason }); }
  if (r.bonus) ctx.emit({ type: 'bonus' });
  if (r.nudge) ctx.emit({ type: 'nudge', key: r.nudge });
  if (r.decoy) ctx.emit({ type: 'wrong', kind: 'decoy', id: r.decoy });
}

export function mount(root, ctx) {
  const d = root.ownerDocument || ctx.doc;
  const t = ctx.t;
  root.append(h(d, 'div', { class: 'shop-window', 'data-level': '4' },
    h(d, 'div', { class: 'shop-chrome' }, t('shop.l4.title')),
    h(d, 'div', { class: 'shop-row' }, h(d, 'strong', { class: 'shop-thanks', id: 'thanks', 'data-decoy': 'thanks' }, t('shop.l4.thanks'))),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'span', { class: 'shop-label' }, t('shop.l4.ref')),
      h(d, 'span', { class: 'shop-ref', id: 'ref', dir: 'ltr', tabindex: '0', role: 'button',
        style: 'display:inline-block;box-sizing:border-box;width:9ch;overflow:hidden;white-space:nowrap;text-overflow:clip;' }, 'FE-2026-10-12-0000314')),
    h(d, 'div', { class: 'shop-fine', 'data-bonus': 'l4', style: 'font-size:9px;' }, t('shop.l4.fine'))));
}

export function arm(ctx) {
  dispose();
  cur = { ctx, caught: false, alive: true, offs: [], baseShots: null };
  const root = ctx.root;
  const onClick = (e) => {
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const bonus = el.closest('[data-bonus="l4"]');
    if (bonus && root.contains(bonus)) return handle(ctx, { type: 'bonus-click' });
    const decoy = el.closest('[data-decoy]');
    if (decoy && root.contains(decoy)) return handle(ctx, { type: 'decoy-click', id: decoy.getAttribute('data-decoy') });
    const ref = el.closest('#ref');
    if (!ref || !root.contains(ref)) return;
    handle(ctx, { type: 'click', id: 'ref', overflow: ref.scrollWidth > ref.clientWidth });
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

export default { id, n, proveKind, chips, mount, arm, detect, proveSignal, signalAvailable, dispose };
