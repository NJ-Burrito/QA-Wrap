/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Marks as objects (ann1022): picking one, moving it, erasing it, and the
 * keyframes that animate it in the video editor. Pure functions over the same
 * shape records `core/shapes.js` draws; no DOM, so the test runs without a browser.
 *
 * Keyframes: an object may carry `keys: [{ t, x, y, text? }]` (t in source ms,
 * x/y the anchor: `points[0]` for a pen line, else `x`,`y`). Between two keys the
 * anchor moves linearly; a text change is a step at its key. Before the first
 * key and after the last the object holds that key.
 */

/** Where the object is pinned: its first point, or its x/y. */
export function anchor(s) {
  return s.points ? { x: s.points[0].x, y: s.points[0].y } : { x: s.x, y: s.y };
}

/** Move an object by (dx, dy), unclamped; a drag may carry a mark half off the frame. */
export function moveBy(s, dx, dy) {
  if (s.points) s.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  else { s.x += dx; s.y += dy; }
}

const LINEAR = new Set(['line', 'arrow', 'double-arrow']);

/** The box an object occupies, for the selection outline and the hit-test. */
export function extent(s) {
  const pad = Math.max(4, (s.width || 0) / 2);
  if (s.points) {
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    return box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), pad);
  }
  if (s.tool === 'text') {
    const fs = s.fontSize || 22;
    return box(s.x, s.y, s.x + String(s.text || '').length * fs * 0.6, s.y + fs * 1.2, 2);
  }
  if (s.w || s.h) return box(Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h), Math.max(s.x, s.x + s.w), Math.max(s.y, s.y + s.h), pad);
  const r = (s.fontSize || 22) * 0.9; // a stamped mark or step badge, centred on its press
  return box(s.x - r, s.y - r, s.x + r, s.y + r, 0);
}

function box(x0, y0, x1, y1, pad) {
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Does point p touch the object? Lines and pen strokes by distance, everything else by box. */
export function hits(s, p, slop = 6) {
  if (LINEAR.has(s.tool)) return segDist(p, s, { x: s.x + s.w, y: s.y + s.h }) <= (s.width || 4) / 2 + slop;
  if (s.points) {
    const reach = (s.width || 4) / 2 + slop;
    for (let i = 0; i < s.points.length; i++) {
      if (segDist(p, s.points[i], s.points[Math.min(i + 1, s.points.length - 1)]) <= reach) return true;
    }
    return false;
  }
  const b = extent(s);
  return p.x >= b.x - slop && p.x <= b.x + b.w + slop && p.y >= b.y - slop && p.y <= b.y + b.h + slop;
}

/** Index of the topmost object under p, or -1. `visible(o, i)` hides objects that are not on screen now. */
export function hitTest(list, p, /** @type {(o: any, i: number) => boolean} */ visible = () => true) {
  for (let i = list.length - 1; i >= 0; i--) if (visible(list[i], i) && hits(list[i], p)) return i;
  return -1;
}

/** The object as it appears at source time ms: the keyed position and text applied to a copy. */
export function resolveAt(o, ms) {
  const k = o.keys;
  if (!k || !k.length) return o;
  let a = k[0], b = k[0];
  for (const key of k) {
    if (key.t <= ms) a = b = key;
    else { b = key; break; }
  }
  const f = b.t > a.t ? Math.min(1, Math.max(0, (ms - a.t) / (b.t - a.t))) : 0;
  const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
  const out = { ...o };
  const base = anchor(o);
  if (o.points) out.points = o.points.map((p) => ({ x: p.x + x - base.x, y: p.y + y - base.y }));
  else { out.x = x; out.y = y; }
  // Text steps: the latest key at or before ms that carries text wins; before any, the first key's.
  const texted = k.filter((q) => q.text !== undefined);
  const pick = texted.filter((q) => q.t <= ms).pop() || texted[0];
  if (pick) out.text = pick.text;
  return out;
}

/** Add or replace the key at ms. The first key also pins the original spot at the object's start, so earlier frames do not jump. */
export function setKey(o, ms, { x, y, text }) {
  o.keys ??= [];
  if (!o.keys.length && ms > o.from) {
    const a = anchor(o);
    o.keys.push({ t: o.from, x: a.x, y: a.y, ...(o.text !== undefined ? { text: o.text } : {}) });
  }
  const key = { t: Math.round(ms), x, y, ...(text !== undefined ? { text } : {}) };
  const at = o.keys.findIndex((q) => q.t === key.t);
  if (at >= 0) o.keys[at] = key; else o.keys.push(key);
  o.keys.sort((p, q) => p.t - q.t);
}

/** Drag a visible object by (dx, dy) at time ms: a keyed object gets a key there, a plain one just moves. */
export function dragAt(o, ms, dx, dy) {
  if (!o.keys || !o.keys.length) return moveBy(o, dx, dy);
  const cur = resolveAt(o, ms), a = anchor(cur);
  setKey(o, ms, { x: a.x + dx, y: a.y + dy, text: cur.text });
}
