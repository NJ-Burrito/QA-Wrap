/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * e1022: two small panel behaviours, kept out of popup.js (at its line ratchet).
 *  - The wheel over the note box scrolls the text sideways, no Shift needed.
 *  - The side panel keeps no list of notes: say() hands each outcome to UQAActions.add(), which shows the newest three as green (ok) or
 *    red (err) lines, with a round count of every action this session on the box. Records still go to the session/report as before.
 */
export const MAX_LINES = 3;

/** The pure model: newest first, at most `max` kept, `total` counts everything. */
export function createStack(max = MAX_LINES) {
  let rows = [];
  let total = 0;
  return {
    add(text, ok) { total++; rows = [{ text: String(text ?? ''), ok: !!ok }, ...rows].slice(0, max); },
    reset() { rows = []; total = 0; },
    rows: () => rows.slice(),
    total: () => total,
  };
}

/** Vertical wheel -> horizontal scroll of a text input that overflows. Returns true when it consumed the event. */
export function wheelSideways(input, e) {
  if (!input || input.scrollWidth <= input.clientWidth) return false;
  input.scrollLeft += e.deltaY || e.deltaX;
  e.preventDefault();
  return true;
}

function mount(doc) {
  const input = doc.getElementById('note-text');
  input?.addEventListener('wheel', (e) => wheelSideways(input, e), { passive: false });
  const live = doc.getElementById('step-live');
  if (!live || doc.documentElement.dataset.surface !== 'panel') return null;
  const tr = (k, v) => (globalThis.QAWi18n ? globalThis.QAWi18n.t(k, v) : k);
  const stack = createStack();
  const box = doc.createElement('div');
  box.id = 'action-stack';
  box.className = 'action-stack';
  box.hidden = true;
  const badge = doc.createElement('span');
  badge.id = 'action-badge';
  badge.className = 'action-badge';
  const list = doc.createElement('ul');
  list.id = 'action-lines';
  list.setAttribute('aria-live', 'polite');
  box.append(badge, list);
  live.append(box);
  const paint = () => {
    box.hidden = stack.total() === 0;
    badge.textContent = String(stack.total());
    badge.setAttribute('aria-label', tr('popup.e1022.actionsAria', { n: stack.total() }));
    list.replaceChildren(...stack.rows().map((r) => {
      const li = doc.createElement('li');
      li.className = r.ok ? 'is-ok' : 'is-err';
      li.textContent = r.text;
      return li;
    }));
  };
  // A new session starts with an empty box: the live section is hidden between sessions.
  new MutationObserver(() => { if (live.hidden) { stack.reset(); paint(); } }).observe(live, { attributes: true, attributeFilter: ['hidden'] });
  return {
    add(text, tone) {
      if (live.hidden || (tone !== 'ok' && tone !== 'err') || !String(text ?? '').trim()) return;
      stack.add(text, tone === 'ok');
      paint();
    },
  };
}

if (typeof document !== 'undefined') globalThis.UQAActions = mount(document);
