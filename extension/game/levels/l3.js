/* QA Wrap Bug Hunt - level 3 "Dead button" (lane B). Planted bug: the Next button has no handler.
 * Hidden bonus: the stray text "undefined" in the footer. Prove: a note added AFTER the catch (qawNotes goes up). */
export const id = 'l3';
export const n = 3;
export const proveKind = 'after-catch';     // tool 'note'. Feature taught: Add note (type, Enter)
/** Optional, self-reported: choosing a note type (Bug / Issue / Question / Note). */
export const chips = [{ id: 'notetype', tool: 'notetype', after: 'caught', signal: 'noteTypes' }];
export const DEAD_MS = 1700;                // nothing may change inside #app, nor any fetch happen, for this long (past the recorder's own 1.5 s dead-click window, content/checks.js WAIT_MS, so the game's reaction cannot hide the dead press from it)
/* Attribute changes that are only decoration (the target ring, focus styling) do not count as the page reacting. */
const IGNORED_ATTRS = new Set(['class', 'style', 'data-ring', 'aria-describedby']);

const h = (doc, tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  return el;
};

let cur = null; // { ctx, caught, alive, offs, pending, baseNotes }

/** Pure. evt: { type:'click', id, mutated, fetched } (already settled after DEAD_MS) | bonus-click | decoy-click. */
export function detect(evt) {
  if (!evt || typeof evt !== 'object') return { caught: false, reason: 'ignored' };
  if (evt.type === 'bonus-click') return { caught: false, bonus: true, reason: 'bonus' };
  if (evt.type === 'decoy-click') return { caught: false, decoy: String(evt.id || 'decoy'), reason: 'decoy' };
  if (evt.type !== 'click') return { caught: false, reason: 'ignored' };
  if (evt.id !== 'next') return { caught: false, reason: 'not-next' };
  if (evt.mutated) return { caught: false, reason: 'app-changed' };   // a mutation INSIDE #app means it did something
  if (evt.fetched) return { caught: false, reason: 'network' };
  return { caught: true, reason: 'dead-click' };
}

const notesNow = (ctx) => { const c = ctx.qawCounts(); return c && Number.isFinite(c.notes) ? c.notes : null; };

/** True once a note was added after the catch. Baseline = the count at the moment of the catch; a drop (new session) re-bases. */
export function proveSignal(ctx) {
  if (!cur || !cur.caught) return false;
  const now = notesNow(ctx);
  if (now === null) return false;
  if (cur.baseNotes === null || now < cur.baseNotes) { cur.baseNotes = now; return false; }
  return now > cur.baseNotes;
}

/** Can the QA Wrap step be seen automatically? If not the engine offers the self-report chip. */
/** Notes are counted against a live session only: in Ready or after Stop the count cannot rise, so the self-report chip is offered. */
export function signalAvailable(ctx) { return notesNow(ctx) !== null && ctx.qawState() === 'recording'; }

/** True while the 1.7 s dead-click check runs (a note typed right now is not "too early"). */
export function pending() { return !!(cur && cur.pending); }

function handle(ctx, evt) {
  if (!cur || cur.ctx !== ctx || !cur.alive) return;
  evt.qaw = ctx.qawState();
  const r = detect(evt);
  if (r.caught) { cur.caught = true; cur.baseNotes = notesNow(ctx); ctx.emit({ type: 'catch', reason: r.reason }); }
  if (r.bonus) ctx.emit({ type: 'bonus' });
  if (r.nudge) ctx.emit({ type: 'nudge', key: r.nudge });
  if (r.decoy) ctx.emit({ type: 'wrong', kind: 'decoy', id: r.decoy });
}

export function mount(root, ctx) {
  const d = root.ownerDocument || ctx.doc;
  const t = ctx.t;
  root.append(h(d, 'div', { class: 'shop-window', 'data-level': '3' },
    h(d, 'div', { class: 'shop-chrome' }, t('shop.l3.title')),
    h(d, 'div', { class: 'shop-row' }, h(d, 'span', { class: 'shop-label' }, t('shop.l3.item')), h(d, 'span', { class: 'shop-price' }, t('shop.l3.price'))),
    h(d, 'div', { class: 'shop-row' },
      h(d, 'button', { class: 'shop-btn', id: 'next', type: 'button' }, t('shop.l3.next')), // no handler, on purpose
      h(d, 'button', { class: 'shop-btn', id: 'back', type: 'button', 'data-decoy': 'back' }, t('shop.l3.back'))),
    h(d, 'div', { class: 'shop-footer', 'data-bonus': 'l3' }, t('shop.l3.footer'))));
}

export function arm(ctx) {
  dispose();
  cur = { ctx, caught: false, alive: true, offs: [], pending: false, baseNotes: null };
  const root = ctx.root;
  const win = ctx.win;
  const MO = ctx.MutationObserver || (win && win.MutationObserver);
  const onClick = (e) => {
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const bonus = el.closest('[data-bonus="l3"]');
    if (bonus && root.contains(bonus)) return handle(ctx, { type: 'bonus-click' });
    const decoy = el.closest('[data-decoy]');
    if (decoy && root.contains(decoy)) return handle(ctx, { type: 'decoy-click', id: decoy.getAttribute('data-decoy') });
    const btn = el.closest('#next');
    if (!btn || !root.contains(btn)) return;
    if (cur.pending || cur.caught) return;
    const mine = cur;
    mine.pending = true;
    let mutated = false;
    let mo = null;
    const scan = (records) => {
      for (const r of records || []) {
        if (r.type === 'attributes' && IGNORED_ATTRS.has(r.attributeName)) continue;
        mutated = true;
      }
    };
    if (MO) {
      mo = new MO(scan);
      mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true }); // #app only: QA Wrap's overlay lives elsewhere
    }
    const net0 = ctx.netCount();
    const timer = ctx.setTimeout(() => {
      if (mo) { if (mo.takeRecords) scan(mo.takeRecords()); mo.disconnect(); }
      mine.pending = false;
      handle(ctx, { type: 'click', id: 'next', mutated, fetched: ctx.netCount() > net0 });
    }, DEAD_MS);
    mine.offs.push(() => { ctx.clearTimeout(timer); if (mo) mo.disconnect(); });
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

export default { id, n, proveKind, chips, mount, arm, detect, proveSignal, signalAvailable, pending, dispose };
