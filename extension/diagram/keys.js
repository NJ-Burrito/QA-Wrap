/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The diagram's keyboard model (D-1010-178), as pure functions.
 *
 * The boxes and the arrows are ONE roving-tabindex group: Tab reaches exactly
 * one stop, and PageDown / PageUp / Home / End walk the rest. Arrow keys belong
 * to the box that has focus (they move it by the snap step, Shift by four), so
 * a keyboard user can place a box without a pointer. Enter or Space selects;
 * C starts an arrow from the focused box and Enter on a second box finishes
 * it; Escape cancels; Delete removes.
 *
 * Nothing here touches the DOM, so tools/test-a11y-flow.mjs drives it directly.
 */
import { A4, MM } from '../core/flow.js';

/** The snap grid the pointer uses too: 4 mm. */
export const STEP = 4 * MM;
export const snap = (v) => Math.round(v / STEP) * STEP;

/** Boxes first, then arrows, in model order: the reading order of the group. */
export function stops(flow) {
  return [
    ...flow.nodes.map((n) => ({ type: 'node', id: n.id })),
    ...flow.edges.map((e) => ({ type: 'edge', id: e.id })),
  ];
}

export const same = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;

/** The one stop that sits in the Tab order: the one last used, else the first. */
export function restStop(flow, wanted) {
  const all = stops(flow);
  return all.find((s) => same(s, wanted)) || all[0] || null;
}

/** Where focus goes from `cur`: 'next' | 'prev' | 'first' | 'last'. It does not wrap. */
export function walk(flow, cur, how) {
  const all = stops(flow);
  if (!all.length) return null;
  if (how === 'first') return all[0];
  if (how === 'last') return all[all.length - 1];
  const i = all.findIndex((s) => same(s, cur));
  const j = how === 'prev' ? i - 1 : i + 1;
  return all[Math.max(0, Math.min(all.length - 1, j))];
}

/** What a key means on a stop. `ctx` is { type: 'node' | 'edge', connecting: bool }. */
export function intent(e, ctx) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key;
  if (k === 'Enter' || k === ' ' || k === 'Spacebar') return { do: 'select' };
  if (k === 'Escape') return { do: 'cancel' };
  if (k === 'Delete' || k === 'Backspace') return { do: 'delete' };
  if ((k === 'c' || k === 'C') && ctx.type === 'node') return { do: 'connect' };
  if (k === 'PageDown') return { do: 'walk', how: 'next' };
  if (k === 'PageUp') return { do: 'walk', how: 'prev' };
  if (k === 'Home') return { do: 'walk', how: 'first' };
  if (k === 'End') return { do: 'walk', how: 'last' };
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[k];
  if (!dir) return null;
  // An arrow (the line) has no position of its own: the arrow keys walk instead.
  if (ctx.type === 'edge') return { do: 'walk', how: dir[0] + dir[1] > 0 ? 'next' : 'prev' };
  const n = e.shiftKey ? 4 : 1;
  return { do: 'move', dx: dir[0] * n * STEP, dy: dir[1] * n * STEP };
}

/** Move a box inside the sheet. Returns true when it went somewhere. */
export function nudge(node, dx, dy) {
  const x = Math.max(0, Math.min(A4.w - node.w, snap(node.x + dx)));
  const y = Math.max(0, Math.min(A4.h - node.h, snap(node.y + dy)));
  const moved = x !== node.x || y !== node.y;
  node.x = x; node.y = y;
  return moved;
}

/** Position in whole millimetres, for the spoken report of a move. */
export const mm = (v) => Math.round(v / MM);
