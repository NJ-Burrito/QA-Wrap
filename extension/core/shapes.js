/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The drawing engine, shared by the markup editor and the video editor.
 *
 * Every shape a tester can put on a screenshot was written inside
 * `annotate/annotate.js`, as a `switch` over twenty cases with the geometry
 * inline. The video editor needs the same twenty shapes over a frame of video,
 * and a second copy of a star's inner radius is a second copy that drifts: the
 * first time somebody makes an arrowhead blunter, one of the two editors keeps
 * the old head and nothing says so.
 *
 * So the geometry lives here, once, and both editors call it. The module is
 * pure in the sense that matters for a test: it touches no DOM at import time
 * and holds no state. What it cannot do by itself is blur, because blurring a
 * region means reading back the pixels of whichever canvas is being drawn on —
 * that one is injected as `blurRegion`, and each editor passes its own.
 *
 * `drawShape(ctx, shape, { blurRegion })` is the whole surface. The rest is
 * exported because the tests and the two editors name it.
 */

/**
 * Every `tool` value `drawShape` can draw.
 *
 * The gate asserts this list covers every shape id the markup editor's rail
 * and grid can arm, so a shape that loses its geometry in a refactor fails a
 * test rather than drawing nothing.
 */
export const SHAPE_IDS = [
  'arrow',
  'rect',
  'rounded',
  'ellipse',
  'circle',
  'line',
  'double-arrow',
  'triangle',
  'diamond',
  'star',
  'tick',
  'cross',
  'question',
  'exclaim',
  'dot',
  'pen',
  'highlight',
  'text',
  'step',
  'redact',
  'blur',
];

/**
 * The one face canvas text is set in (T-024). Thmanyah first; the rest only covers the
 * instant before it loads, and `ensureCanvasFont()` makes each editor wait for it once,
 * so no system face is ever burned into a PNG.
 */
export const CANVAS_FACE = '"Thmanyah Sans", system-ui, sans-serif';
let canvasFontReady = null;
export function ensureCanvasFont() {
  const fonts = globalThis.document?.fonts;
  if (!fonts) return Promise.resolve(true);
  canvasFontReady ||= Promise.all(['400', '500', '700'].map((w) => fonts.load(`${w} 16px "Thmanyah Sans"`)))
    .then(() => fonts.check('700 16px "Thmanyah Sans"'), () => false);
  return canvasFontReady;
}

/** The redaction block: opaque black, never themed, never translucent. */
export const REDACT_FILL = '#000000';

/** The rectangle a drag describes, with a backwards drag normalised away. */
export function bounds(s) {
  return {
    x: Math.min(s.x, s.x + s.w),
    y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w),
    h: Math.abs(s.h),
  };
}

/**
 * Move a shape by (dx, dy), keeping its box inside a w by h frame (T-072, 2.5.7).
 *
 * The keyboard alternative to dragging. A pen line moves as a whole, a mark with
 * no width (a step badge, a label) moves by its anchor, and a shape already past
 * an edge can still be moved back in. Returns true when it moved.
 */
export function nudgeShape(s, dx, dy, w, h) {
  const xs = s.points ? s.points.map((p) => p.x) : [s.x, s.x + (s.w || 0)];
  const ys = s.points ? s.points.map((p) => p.y) : [s.y, s.y + (s.h || 0)];
  const fit = (d, lo, hi, max) => (d > 0 ? Math.min(d, Math.max(0, max - hi)) : Math.max(d, Math.min(0, -lo)));
  dx = fit(dx, Math.min(...xs), Math.max(...xs), w);
  dy = fit(dy, Math.min(...ys), Math.max(...ys), h);
  if (!dx && !dy) return false;
  if (s.points) s.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  else { s.x += dx; s.y += dy; }
  return true;
}

/**
 * T-060 (WCAG 2.1.1, 2.5.7): the box a key press draws where a drag would, centred and a third of the frame wide by a fifth tall.
 * Enter places it, the arrow keys move it (`nudgeShape`), and `resizeShape` sizes it, so nothing needs a pointer.
 */
export function keyboardBox(w, h) {
  const bw = Math.round(w * 0.3);
  const bh = Math.round(h * 0.2);
  return { x: Math.round((w - bw) / 2), y: Math.round((h - bh) / 2), w: bw, h: bh };
}

/** Size a shape about its centre by `factor`, staying inside a w by h frame. Returns true when it changed; a mark with no extent never does. */
export function resizeShape(s, factor, w, h) {
  if (s.points) {
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const next = s.points.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
    if (next.some((p) => p.x < 0 || p.y < 0 || p.x > w || p.y > h) || Math.max(...xs) === Math.min(...xs)) return false;
    s.points = next;
    return true;
  }
  if (!s.w && !s.h) return false;
  const nw = s.w * factor, nh = s.h * factor;
  const x = s.x - (nw - s.w) / 2, y = s.y - (nh - s.h) / 2;
  const x2 = Math.max(x, x + nw), y2 = Math.max(y, y + nh);
  if (Math.min(x, x + nw) < 0 || Math.min(y, y + nh) < 0 || x2 > w || y2 > h || Math.abs(nw) < 8 || Math.abs(nh) < 8) return false;
  Object.assign(s, { x, y, w: nw, h: nh });
  return true;
}

/** One filled head, at a point, pointing along an angle. */
export function arrowHead(ctx, x, y, angle, head) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - Math.cos(angle - 0.42) * head, y - Math.sin(angle - 0.42) * head);
  ctx.lineTo(x - Math.cos(angle + 0.42) * head, y - Math.sin(angle + 0.42) * head);
  ctx.closePath();
  ctx.fill();
}

/** A shaft that stops short of its point, and a solid head on the end of it. */
export function arrow(ctx, s) {
  const head = Math.max(12, s.width * 3.2);
  const angle = Math.atan2(s.h, s.w);
  const endX = s.x + s.w;
  const endY = s.y + s.h;

  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  // Stop the shaft short of the point so the head is a solid triangle rather
  // than a line poking through it.
  ctx.lineTo(endX - Math.cos(angle) * head * 0.7, endY - Math.sin(angle) * head * 0.7);
  ctx.stroke();

  arrowHead(ctx, endX, endY, angle, head);
}

/** A star as a closed path, left on the context for the caller to stroke. */
export function starPath(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/**
 * How big a stamped mark is, and how heavy its stroke.
 *
 * Both come from the two sliders the tester already has rather than from a
 * constant: a tick sized in absolute pixels is a speck on a 3000px full-page
 * screenshot and a blot on a 400px crop.
 */
export function markSize(s) {
  return Math.max(14, (s.fontSize || 22) * 1.1);
}

export function markStroke(s) {
  return Math.max(3, (s.width || 4) * 1.4);
}

/** Black or white, whichever the fill will actually show through. */
export function pickContrast(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Rec. 709 luma: green carries most of the perceived brightness.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#111111' : '#FFFFFF';
}

/**
 * A mark drawn as polylines, haloed first in its contrast colour.
 *
 * A tick in Guac on a green success banner is a tick nobody can find. The halo
 * pass costs one extra stroke and means a mark is legible on the one ground
 * that would otherwise swallow it.
 */
export function strokeMark(ctx, s, lines) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [pen, scale] of [
    [pickContrast(s.colour), 2.2],
    [s.colour, 1],
  ]) {
    ctx.strokeStyle = pen;
    ctx.lineWidth = markStroke(s) * scale;
    for (const line of lines) {
      ctx.beginPath();
      line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }
}

/** A question or an exclamation mark, set as type and haloed the same way. */
export function glyphMark(ctx, s, glyph) {
  const r = markSize(s);
  ctx.font = `700 ${Math.round(r * 2)}px ${CANVAS_FACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pickContrast(s.colour);
  ctx.lineWidth = Math.max(3, r * 0.32);
  ctx.strokeText(glyph, s.x, s.y);
  ctx.fillStyle = s.colour;
  ctx.fillText(glyph, s.x, s.y);
}

/**
 * A filled dot inside a ring: "this exact pixel", not "somewhere around here".
 *
 * The pale ring between the two is what keeps the target readable when the
 * drawing colour happens to be the colour of whatever is under it.
 */
export function targetDot(ctx, s) {
  const r = markSize(s);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = pickContrast(s.colour);
  ctx.lineWidth = Math.max(1.5, markStroke(s) * 0.6);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.71, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = s.colour;
  ctx.lineWidth = markStroke(s);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** A numbered disc, its digit in whichever of black or white can be read. */
export function stepBadge(ctx, s) {
  const r = Math.max(14, s.fontSize * 0.9);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pickContrast(s.colour);
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.stroke();

  ctx.fillStyle = pickContrast(s.colour);
  ctx.font = `700 ${Math.round(r * 1.15)}px ${CANVAS_FACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(s.n), s.x, s.y + 1);
}

/**
 * Blur one rectangle of a canvas by scaling it down and back up.
 *
 * `ctx.filter = 'blur()'` would be tidier, but it blurs *outward* from the
 * region — pixels from outside bleed in and pixels from inside bleed out, so
 * fragments of the hidden text end up painted next to the box. Downscaling
 * throws the detail away instead, which is the behaviour that can be promised.
 *
 * `surface` is the canvas being drawn on and `scratch` a canvas factory, both
 * passed in: a module that reached for `document` could not be imported by a
 * test, and the video editor's surface is not the page's.
 */
export function downscaleBlur(ctx, s, surface, scratch) {
  const x = Math.round(Math.min(s.x, s.x + s.w));
  const y = Math.round(Math.min(s.y, s.y + s.h));
  const w = Math.round(Math.abs(s.w));
  const h = Math.round(Math.abs(s.h));
  if (w < 2 || h < 2) return;

  const factor = Math.max(2, s.strength);
  const small = scratch();
  small.width = Math.max(1, Math.round(w / factor));
  small.height = Math.max(1, Math.round(h / factor));
  const sctx = small.getContext('2d');
  sctx.drawImage(surface, x, y, w, h, 0, 0, small.width, small.height);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
}

/**
 * One shape, painted.
 *
 * The colour, the thickness and the caps are set once here rather than by each
 * case, exactly as the markup editor always did, and the whole thing is wrapped
 * in save/restore so a case that reaches for `globalCompositeOperation` — the
 * highlighter does — cannot leak it into the next shape in the list.
 */
export function drawShape(ctx, s, { blurRegion } = {}) {
  ctx.save();
  ctx.strokeStyle = s.colour;
  ctx.fillStyle = s.colour;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (s.tool) {
    case 'arrow':
      arrow(ctx, s);
      break;
    case 'rect':
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      break;
    case 'rounded': {
      const b = bounds(s);
      const r = Math.min(b.w, b.h) * 0.18;
      ctx.beginPath();
      // `roundRect` has been in the canvas since Chrome 99. The square-cornered
      // fallback is there so an older engine draws the wrong corners rather
      // than throwing and losing every shape after this one in the list.
      if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, r);
      else ctx.rect(b.x, b.y, b.w, b.h);
      ctx.stroke();
      break;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'circle': {
      // Inscribed in the square the drag would have made, so the circle grows
      // in the direction the hand is moving rather than jumping to a centre.
      const r = Math.max(Math.abs(s.w), Math.abs(s.h)) / 2;
      ctx.beginPath();
      ctx.arc(s.x + Math.sign(s.w || 1) * r, s.y + Math.sign(s.h || 1) * r, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.stroke();
      break;
    case 'double-arrow': {
      // "From here to here", which is what a spacing or an alignment bug is
      // usually about, and which a single arrow states only half of.
      const head = Math.max(12, s.width * 3.2);
      const angle = Math.atan2(s.h, s.w);
      const endX = s.x + s.w;
      const endY = s.y + s.h;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(angle) * head * 0.7, s.y + Math.sin(angle) * head * 0.7);
      ctx.lineTo(endX - Math.cos(angle) * head * 0.7, endY - Math.sin(angle) * head * 0.7);
      ctx.stroke();
      arrowHead(ctx, endX, endY, angle, head);
      arrowHead(ctx, s.x, s.y, angle + Math.PI, head);
      break;
    }
    case 'triangle': {
      const b = bounds(s);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'diamond': {
      const b = bounds(s);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w / 2, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h / 2);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'star': {
      const b = bounds(s);
      const outer = Math.min(b.w, b.h) / 2;
      starPath(ctx, b.x + b.w / 2, b.y + b.h / 2, outer, outer * 0.42, 5);
      ctx.stroke();
      break;
    }
    case 'tick': {
      const r = markSize(s);
      strokeMark(ctx, s, [
        [
          [s.x - r * 0.62, s.y + r * 0.06],
          [s.x - r * 0.18, s.y + r * 0.56],
          [s.x + r * 0.66, s.y - r * 0.58],
        ],
      ]);
      break;
    }
    case 'cross': {
      const r = markSize(s) * 0.55;
      strokeMark(ctx, s, [
        [
          [s.x - r, s.y - r],
          [s.x + r, s.y + r],
        ],
        [
          [s.x + r, s.y - r],
          [s.x - r, s.y + r],
        ],
      ]);
      break;
    }
    case 'question':
      glyphMark(ctx, s, '?');
      break;
    case 'exclaim':
      glyphMark(ctx, s, '!');
      break;
    case 'dot':
      targetDot(ctx, s);
      break;
    case 'pen':
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;
    case 'highlight':
      // Multiply, so the text underneath stays readable through the colour —
      // an opaque bar would hide the very thing being pointed out.
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.42;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      break;
    case 'text':
      ctx.font = `600 ${s.fontSize}px ${CANVAS_FACE}`;
      ctx.textBaseline = 'top';
      // A halo, so the label survives landing on a busy screenshot.
      ctx.strokeStyle = pickContrast(s.colour);
      ctx.lineWidth = Math.max(3, s.fontSize / 7);
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillText(s.text, s.x, s.y);
      break;
    case 'step':
      stepBadge(ctx, s);
      break;
    case 'redact':
      // An opaque fill and nothing else: the one tool that actually removes what is under it (T-025).
      // Colour and alpha are fixed on purpose; a redaction the tester can tint is one they can fade.
      ctx.globalAlpha = 1;
      ctx.fillStyle = REDACT_FILL;
      { const b = bounds(s); ctx.fillRect(b.x, b.y, b.w, b.h); }
      break;
    case 'blur':
      // Injected, because blurring means reading back the surface being drawn
      // on and only the caller knows what that is.
      if (blurRegion) blurRegion(s);
      break;
    default:
      break;
  }
  ctx.restore();
}
