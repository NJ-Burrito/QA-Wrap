/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

/* ── sound ─────────────────────────────────────────────────────────────
   Off until switched on in Settings; the library only listens until then.
   Wired once, delegated, so a control rendered later is covered the moment
   it appears. */
(async () => {
  const settings = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.ok ? res.result : {}))
  );
  window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQASound?.wire(document);
})();
/**
 * Marking up a screenshot.
 *
 * The gap this closes is the one the field guide named as the last thing the
 * dedicated bug-report tools still did better: pointing at the thing. A
 * screenshot with an arrow on it and the customer's name blurred out is a bug
 * report; the same screenshot raw is a puzzle for whoever opens the ticket.
 *
 * Two decisions worth stating up front.
 *
 * **Shapes are kept as objects, not painted into the image.** Everything is
 * redrawn from a list on every change, so undo is dropping the last entry rather
 * than restoring a bitmap — and a mistake three shapes ago is still recoverable.
 *
 * **Blur is the exception, and it is destructive on purpose.** A black box drawn
 * over a name is still a name to anyone who opens the file in an editor and
 * deletes the box. Blur replaces the pixels underneath in the exported image, so
 * what leaves the building genuinely cannot be read back.
 */

const $ = (id) => document.getElementById(id);
const t = (k, v) => QAWi18n.t(k, v);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: 'Background worker is not responding.' });
    });
  });
}

function say(text, tone = '') {
  $('status').textContent = text;
  $('status').removeAttribute('title');
  $('status').className = `status ${tone}`;
}

/** D-1010-140: a caught failure as the keyed sentence; the raw message is the tooltip only. */
async function sayFailure(err) {
  let d;
  try { d = (await import('../platform/worker-errors.js')).describeError(err, t); }
  catch { d = { text: t('common.err.unknown'), title: String(err?.message ?? '') }; }
  say(d.text, 'err');
  (await import('../platform/worker-errors.js')).attachDetails($('status'), d, t);
}

const params = new URLSearchParams(location.search);
const mediaId = params.get('id');

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

let source = null; // the untouched image, redrawn under every render
let Shapes = null; // core/shapes.js, imported at boot (see below)
let Obj = null; // core/objects.js: hit-test and move (ann1022)
let selected = -1; // index into `shapes` of the picked object
let moving = null; // { last } while a picked object is being dragged
let lastErase = null; // { i, s }: the object the eraser took last, until the next new shape
let meta = null;
let settings = null;

/* ── state ─────────────────────────────────────────────────────────────── */

let tool = 'arrow';
let shape = 'rect'; // which geometry the Shapes button is holding
let colour = '#B5432B';
let width = 4;
let fontSize = 22;
let blurStrength = 12;
let stepCounter = 0;

const shapes = [];
let drawing = null;
const redoStack = [];
const base = document.createElement('canvas'); // committed layer, see render()
let baseDirty = true;
const paintCount = { full: 0, fast: 0 }; // T-072: repaint cost, read from the console
window.__uqaPaintCount = paintCount;
let crop = null; // { x, y, w, h } in image pixels, applied at export
/** D-1010-160: marks or a crop that are not saved yet. Closing the tab with any asks first; a save records what it stored. */
let savedState = null;
const stateKey = () => JSON.stringify([shapes, crop]);
const isDirty = () => (shapes.length > 0 || crop !== null) && stateKey() !== savedState;
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

/**
 * Everything the Shapes button can arm.
 *
 * One table, and it is the only place any of this is written down: the grid is
 * built from it, the rail button's glyph and label are read from it, and the
 * test asserts that every `id` here has a case in `paint()`. A shape added to
 * this list and nowhere else either works or fails the suite; it cannot become
 * a button that draws nothing, which is what a hand-maintained second list
 * eventually produces.
 *
 * `kind` is the whole difference between the two halves. A `drag` shape is
 * sized by the drag that makes it, the way a box always was. A `mark` is
 * stamped where it is pressed, because "put a tick on that row" is one gesture
 * and asking a tester to drag a tick to size is asking them to draw a tick.
 */
/**
 * `label` and `short` used to be typed in here as English literals. They now
 * live in the i18n tables, keyed as `annotate.shapes.<id>.label` and
 * `annotate.shapes.<id>.short`, so the id below is the only name this table
 * carries.
 */
const SHAPES = [
  { id: 'rect', kind: 'drag' },
  { id: 'rounded', kind: 'drag' },
  { id: 'ellipse', kind: 'drag' },
  { id: 'circle', kind: 'drag' },
  { id: 'line', kind: 'drag' },
  { id: 'double-arrow', kind: 'drag' },
  { id: 'triangle', kind: 'drag' },
  { id: 'diamond', kind: 'drag' },
  { id: 'star', kind: 'drag' },
  { id: 'tick', kind: 'mark' },
  { id: 'cross', kind: 'mark' },
  { id: 'question', kind: 'mark' },
  { id: 'exclaim', kind: 'mark' },
  { id: 'dot', kind: 'mark' },
];

const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

/**
 * UI rework round 2, S11b: each shape's button glyph, from the new icon
 * family rather than a Unicode character — the id below is always
 * `shape-<id>` (identity/icons/ui/icons.json `stage2_map.annotate`).
 */
const shapeIcon = (id) => window.UQAIcon?.(`shape-${id}`, { size: 16 }) || '';

/** The drag shapes Shift should straighten rather than square off. */
const AXIS_LOCKED = new Set(['line', 'arrow', 'double-arrow']);

/* ── drawing ───────────────────────────────────────────────────────────── */

/**
 * Redraw everything, in order, from the original image up.
 *
 * Cheap enough to run on every pointer move: the source is a decoded bitmap and
 * the shape list is short. Doing it this way is what makes undo trivial and
 * makes a shape editable later without any of it having been baked in.
 */
function render(preview = null) {
  if (!source) return;
  // T-072: the committed layer (image + shapes) is painted once into `base`, a
  // second canvas; a pointer move only blits it and paints the one preview.
  if (baseDirty || base.width !== source.width || base.height !== source.height) {
    canvas.width = source.width;
    canvas.height = source.height;
    ctx.drawImage(source, 0, 0);
    for (const shape of shapes) paint(shape);
    base.width = source.width;
    base.height = source.height;
    base.getContext('2d').drawImage(canvas, 0, 0);
    baseDirty = false;
    paintCount.full++;
  } else {
    ctx.drawImage(base, 0, 0);
    paintCount.fast++;
  }
  if (preview) paint(preview);
  if (selected >= 0 && shapes[selected] && Obj) paintSelection(shapes[selected]);
  if (crop) paintCropOverlay();
}

/** Pointer moves coalesce to one repaint per animation frame. */
let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render(drawing);
  });
}

function paint(s) {
  if (!Shapes) return;
  switch (s.tool) {
    // Every geometry in one arm on purpose: the list is the whitelist, and the
    // drawing itself is `core/shapes.js`, which the video editor calls too.
    case 'arrow':
    case 'rect':
    case 'rounded':
    case 'ellipse':
    case 'circle':
    case 'line':
    case 'double-arrow':
    case 'triangle':
    case 'diamond':
    case 'star':
    case 'tick':
    case 'cross':
    case 'question':
    case 'exclaim':
    case 'dot':
    case 'pen':
    case 'highlight':
    case 'text':
    case 'step':
    case 'redact':
    case 'blur':
      // `blurRegion` is injected because it reads back THIS canvas; nothing
      // else about a shape depends on which editor is drawing it.
      Shapes.drawShape(ctx, s, { blurRegion });
      break;
    default:
      break;
  }
}

/*
 * The seams below are the names this file has always drawn through, kept as
 * one-line calls into the shared engine.
 *
 * They are not indirection for its own sake: `tools/test-annotate.mjs` stands
 * over exactly these — that an arrow is drawn by `arrow`, that a stamped mark
 * scales with the text-size slider and its stroke with the thickness one — and
 * those rules are about the markup editor's two sliders, which is a question
 * about this page rather than about geometry. The geometry is in
 * `core/shapes.js`; the sliders are here.
 */
function arrow(s) {
  Shapes.arrow(ctx, s);
}

function markSize(s) {
  return Shapes.markSize({ fontSize: s.fontSize });
}

function markStroke(s) {
  return Shapes.markStroke({ width: s.width });
}

function strokeMark(s, lines) {
  Shapes.strokeMark(ctx, s, lines);
}

/**
 * Blur one rectangle by scaling it down and back up.
 *
 * `ctx.filter = 'blur()'` would be tidier, but it blurs *outward* from the
 * region — pixels from outside bleed in and pixels from inside bleed out, so
 * fragments of the hidden text end up painted next to the box. Downscaling
 * throws the detail away instead, which is the behaviour that can be promised.
 */
function blurRegion(s) {
  Shapes.downscaleBlur(ctx, s, canvas, () => document.createElement('canvas'));
}

/** The picked object's dashed box. Drawn after the bitmap is cached, and cleared before export. */
function paintSelection(s) {
  const b = Obj.extent(s);
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#E2AE38';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

function paintCropOverlay() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(crop.x, crop.y, crop.w, crop.h);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#E2AE38';
  ctx.lineWidth = 2;
  ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  ctx.restore();
}

/* ── pointer ───────────────────────────────────────────────────────────── */

/** Canvas pixels, not CSS pixels — the image is displayed scaled to fit. */
function at(e) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) / box.width) * canvas.width,
    y: ((e.clientY - box.top) / box.height) * canvas.height,
  };
}

/**
 * The tools that stamp where they are put, by a press or by Enter (T-060): the text box, the step badge and the marks.
 * A mark has nothing to drag, so it commits at once like a step badge. True when `p` was taken by one of them.
 */
function stampAt(p) {
  if (tool === 'text') { placeText(p); return true; }
  if (tool === 'step') { shapes.push({ tool: 'step', x: p.x, y: p.y, colour, fontSize, n: ++stepCounter }); commit(); return true; }
  const armed = tool === 'shape' ? SHAPE_BY_ID.get(shape) : null;
  if (armed?.kind === 'mark') { shapes.push({ tool: armed.id, x: p.x, y: p.y, colour, width, fontSize }); commit(); return true; }
  return false;
}

/** A finished drag, or the box a key press places: the crop, or one more shape. */
function finishShape(s) {
  if (s.tool === 'crop') {
    crop = {
      x: Math.round(Math.min(s.x, s.x + s.w)),
      y: Math.round(Math.min(s.y, s.y + s.h)),
      w: Math.round(Math.abs(s.w)),
      h: Math.round(Math.abs(s.h)),
    };
    say(t('annotate.status.cropSet'));
    return render();
  }
  shapes.push(s);
  commit();
}

/** Enter on the focused canvas: the current tool, placed at the centre without a pointer (WCAG 2.1.1, 2.5.7). Arrows move it, + and - size it. */
function keyPlace() {
  if (!source) return;
  const w = Math.round(source.width * 0.3), h = Math.round(source.height * 0.2);
  const x = Math.round((source.width - w) / 2), y = Math.round((source.height - h) / 2);
  if (stampAt({ x: x + w / 2, y: y + h / 2 })) return;
  const armed = tool === 'shape' ? SHAPE_BY_ID.get(shape) : null;
  const kind = armed ? armed.id : tool;
  finishShape(kind === 'pen'
    ? { tool: kind, colour, width, points: [{ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }] }
    : { tool: kind, colour, width, strength: blurStrength, fontSize, x, y, w, h });
}

/** + and -: the last shape grows or shrinks a tenth about its centre, staying inside the image. */
function keySize(factor) {
  const s = shapes[shapes.length - 1];
  if (!s) return false;
  const pts = s.points || (s.w || s.h ? [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }] : null);
  if (!pts) return true; // a mark has no extent
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const next = pts.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
  if (next.some((p) => p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height)) return true;
  if (s.points) s.points = next;
  else { s.x = next[0].x; s.y = next[0].y; s.w = next[1].x - next[0].x; s.h = next[1].y - next[0].y; }
  say(t('annotate.status.sized'));
  settle();
  return true;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!source) return;
  const p = at(e);

  /*
   * The text tool takes this press away from the canvas entirely.
   *
   * This is the bug that made the text tool look broken and *was* the text
   * tool being broken. The press ran its default action, which moved focus off
   * the input the same tick the input was given focus; `blur` fired with an
   * empty value; the commit-on-blur handler tidied the box away before a single
   * key could be typed. Preventing the default keeps focus where it is put, and
   * the pointer is deliberately NOT captured: capture routes the rest of the
   * gesture to the canvas, and this tool has no gesture to route — it has a
   * text box that needs the pointer more than the canvas does.
   */
  if (tool === 'text') e.preventDefault();
  if (stampAt(p)) return;
  if (tool === 'select' || tool === 'erase') {
    const i = Obj.hitTest(shapes, p);
    if (tool === 'erase') {
      if (i >= 0) { lastErase = { i, s: shapes.splice(i, 1)[0] }; selected = -1; say(t('annotate.obj.erased')); settle(); }
      return;
    }
    selected = i;
    if (i >= 0) { canvas.setPointerCapture(e.pointerId); moving = { last: p }; say(t('annotate.obj.picked')); }
    render();
    return;
  }
  const armed = tool === 'shape' ? SHAPE_BY_ID.get(shape) : null;

  canvas.setPointerCapture(e.pointerId);

  // Shapes carry the geometry's own name, not "shape": `paint()` switches on
  // one concrete kind per case, so undo and every redraw stay exactly what they
  // were before the rail collapsed into one button.
  const kind = armed ? armed.id : tool;
  drawing =
    kind === 'pen'
      ? { tool: kind, colour, width, points: [p] }
      : { tool: kind, colour, width, strength: blurStrength, fontSize, x: p.x, y: p.y, w: 0, h: 0 };
});

canvas.addEventListener('pointermove', (e) => {
  if (moving) {
    const p = at(e);
    Obj.moveBy(shapes[selected], p.x - moving.last.x, p.y - moving.last.y);
    moving.last = p;
    baseDirty = true;
    scheduleRender();
    return;
  }
  if (!drawing) return;
  const p = at(e);
  if (drawing.tool === 'pen') drawing.points.push(p);
  else {
    drawing.w = p.x - drawing.x;
    drawing.h = p.y - drawing.y;
    // Shift constrains a line or arrow to the horizontal or the vertical,
    // which is what anyone drawing along a row of a table wants.
    if (e.shiftKey && AXIS_LOCKED.has(drawing.tool)) {
      if (Math.abs(drawing.w) > Math.abs(drawing.h)) drawing.h = 0;
      else drawing.w = 0;
    }
  }
  scheduleRender();
});

canvas.addEventListener('pointerup', () => {
  if (moving) { moving = null; settle(); return; }
  if (!drawing) return;
  const s = drawing;
  drawing = null;

  const tiny = s.tool !== 'pen' && Math.abs(s.w) < 3 && Math.abs(s.h) < 3;
  if (tiny) return render(); // a click, not a drag

  finishShape(s);
});

/**
 * Type a label where the canvas was pressed.
 *
 * Three things here are load-bearing, and all three are the fix for a tool that
 * simply did not work:
 *
 * 1. `focused` says whether the caret ever actually arrived. A `blur` before
 *    that is not a tester finishing a label, it is the opening click's own
 *    focus change, and committing on it threw the empty box away before the
 *    first keystroke. Only a blur *after* focus commits anything.
 * 2. The `focus()` is deferred to the next frame. Focusing inside the
 *    pointerdown that revealed the element is a race with the browser's own
 *    focus handling, and the browser wins often enough to be a bug report.
 * 3. `done` makes finishing idempotent, because Enter blurs the input and the
 *    blur handler would otherwise commit the same label twice.
 */
function placeText(p) {
  const input = $('text-input');
  const box = canvas.getBoundingClientRect();
  const scale = box.width / canvas.width;
  input.hidden = false;
  input.style.left = `${p.x * scale}px`;
  input.style.top = `${p.y * scale}px`;
  input.style.fontSize = `${Math.max(11, fontSize * scale)}px`;
  input.value = '';

  let focused = false;
  let done = false;

  const finish = (keep) => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    input.hidden = true;
    input.onkeydown = null;
    input.onblur = null;
    input.onfocus = null;
    if (keep && text) {
      shapes.push({ tool: 'text', x: p.x, y: p.y, colour, fontSize, text });
      commit();
    }
  };

  input.onfocus = () => {
    focused = true;
  };
  input.onkeydown = (e) => {
    // The page's own Ctrl+Z and Escape have no business in a text box.
    e.stopPropagation();
    // The Enter that picks an IME candidate (and the Escape that cancels the composition) is not ours.
    if (e.isComposing) return;
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => {
    if (focused) finish(true);
  };

  requestAnimationFrame(() => {
    if (!done) input.focus();
  });
}

function commit() {
  redoStack.length = 0;
  lastErase = null; // a new shape ends the redo branch
  settle();
}

/** Repaint after the list changed; undo, redo and nudge call this, keeping the redo stack. */
function settle() {
  baseDirty = true;
  if (selected >= shapes.length) selected = -1;
  $('undo').disabled = shapes.length === 0 && !lastErase;
  $('redo').disabled = redoStack.length === 0;
  render();
}

addEventListener('keydown', (e) => {
  // Whoever is typing a label owns their own keys, undo included.
  if (document.activeElement === $('text-input')) return;
  if (e.key === 'Escape') closeShapeGrid();
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0 && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    lastErase = { i: selected, s: shapes.splice(selected, 1)[0] };
    selected = -1;
    settle();
  }
  if (e.key === 'Escape' && drawing) {
    drawing = null;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (document.activeElement === canvas && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    keyPlace();
  } else if (document.activeElement === canvas && /^[-+=]$/.test(e.key)) {
    if (keySize(e.key === '-' ? 0.9 : 1.1)) e.preventDefault();
  } else if (e.key.startsWith('Arrow') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(document.activeElement?.tagName || '')) { // a focused control keeps its arrow keys
    // 2.5.7: moving the last shape needs no drag. One pixel; Shift ten.
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if ((dx || dy) && nudge(dx, dy)) e.preventDefault();
  }
});

function nudge(dx, dy) {
  const s = shapes[shapes.length - 1];
  if (!s) return false;
  const fit = (d, lo, hi) => Math.min(Math.max(d, -lo), hi); // the shape stays inside the image
  if (s.points) {
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    dx = fit(dx, Math.min(...xs), source.width - Math.max(...xs));
    dy = fit(dy, Math.min(...ys), source.height - Math.max(...ys));
    s.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else {
    s.x += fit(dx, s.x, source.width - s.x);
    s.y += fit(dy, s.y, source.height - s.y);
  }
  settle();
  return true;
}

function undo() {
  if (lastErase) { shapes.splice(lastErase.i, 0, lastErase.s); lastErase = null; return settle(); }
  const last = shapes.pop();
  if (!last) return;
  if (last.tool === 'step') stepCounter = Math.max(0, stepCounter - 1);
  redoStack.push(last);
  settle();
}

function redo() {
  const s = redoStack.pop();
  if (!s) return;
  if (s.tool === 'step') stepCounter += 1;
  shapes.push(s);
  settle();
}

$('redo').addEventListener('click', redo);

/** T-072: the most-used missing verb. PNG is the one type every clipboard takes. */
async function copyImage() {
  try {
    const blob = await exportBlob('image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    say(t('annotate.status.copied'));
  } catch (err) {
    say(t('annotate.status.copyFailed'), 'err');
  }
}
$('copy').addEventListener('click', copyImage);

$('undo').addEventListener('click', undo);

$('clear').addEventListener('click', () => {
  shapes.length = 0;
  stepCounter = 0;
  crop = null;
  commit();
  say(t('annotate.status.cleared'));
});

/* ── tools and controls ────────────────────────────────────────────────── */

$('tools').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tool]');
  if (!btn) return;
  tool = btn.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  canvas.style.cursor = tool === 'text' ? 'text' : tool === 'select' ? 'move' : tool === 'erase' ? 'not-allowed' : 'crosshair';
  if (tool !== 'select' && selected >= 0) { selected = -1; render(); }
  // The Shapes button is a menu as well as a mode: pressing it offers the grid,
  // pressing it again puts the grid away, and pressing anything else on the
  // rail closes it, because a picker left open over the image is in the way.
  if (tool === 'shape') toggleShapeGrid();
  else closeShapeGrid();
});

/* ── the shapes grid ───────────────────────────────────────────────────── */

function buildShapeGrid() {
  const host = $('shape-grid');
  host.replaceChildren();
  for (const [kind, headingKey] of [
    ['drag', 'annotate.shapeGrid.dragHeading'],
    ['mark', 'annotate.shapeGrid.markHeading'],
  ]) {
    const set = document.createElement('div');
    set.className = 'shape-set';
    const label = document.createElement('span');
    label.className = 'shape-set-label';
    label.textContent = t(headingKey);
    const row = document.createElement('div');
    row.className = 'shape-row';

    for (const item of SHAPES.filter((s) => s.kind === kind)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shape-btn';
      btn.dataset.shape = item.id;
      const itemLabel = t(`annotate.shapes.${item.id}.label`);
      btn.title = itemLabel;
      btn.setAttribute('aria-label', itemLabel);
      btn.setAttribute('aria-pressed', String(item.id === shape));
      const glyph = document.createElement('span');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = shapeIcon(item.id);
      btn.append(glyph);
      btn.addEventListener('click', () => armShape(item.id));
      row.append(btn);
    }

    set.append(label, row);
    host.append(set);
  }
}

/**
 * The rail button's glyph, name and tooltip, painted from whichever shape is
 * currently armed — separate from `armShape()` so a language change can
 * repaint the words without touching the tester's tool choice.
 */
function paintShapeButton() {
  const item = SHAPE_BY_ID.get(shape);
  if (!item) return;
  const itemLabel = t(`annotate.shapes.${item.id}.label`);
  const rail = $('shapes-btn');
  $('shapes-glyph').innerHTML = shapeIcon(item.id);
  $('shapes-name').textContent = t(`annotate.shapes.${item.id}.short`);
  const title = t('annotate.tools.shapesTitle', { name: itemLabel });
  rail.title = title;
  rail.setAttribute('aria-label', title);
}

/**
 * Arm one shape, and say so on the rail button.
 *
 * Collapsing nine buttons into one is only an improvement if the tester can
 * still see what a press will draw without opening anything, so the button
 * wears the armed shape's glyph and its name. That is the whole trade: one row
 * of rail instead of nine, and nothing hidden.
 */
function armShape(id) {
  const item = SHAPE_BY_ID.get(id);
  if (!item) return;
  shape = id;
  tool = 'shape';

  paintShapeButton();
  const rail = $('shapes-btn');

  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b === rail)));
  document.querySelectorAll('[data-shape]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === id)));

  canvas.style.cursor = 'crosshair';
  closeShapeGrid();
  const itemLabel = t(`annotate.shapes.${item.id}.label`);
  say(item.kind === 'mark'
    ? t('annotate.status.shapeArmedMark', { label: itemLabel })
    : t('annotate.status.shapeArmedDrag', { label: itemLabel }));
}

function toggleShapeGrid() {
  if ($('shape-grid').hidden) openShapeGrid();
  else closeShapeGrid();
}

function openShapeGrid() {
  const host = $('shape-grid');
  const anchor = $('shapes-btn').getBoundingClientRect();
  host.hidden = false;
  // Measured after unhiding, because a hidden element has no height to keep on
  // screen with.
  host.style.left = `${Math.round(anchor.right + 8)}px`;
  host.style.top = `${Math.round(Math.max(8, Math.min(anchor.top, innerHeight - host.offsetHeight - 12)))}px`;
  $('shapes-btn').setAttribute('aria-expanded', 'true');
}

function closeShapeGrid() {
  $('shape-grid').hidden = true;
  $('shapes-btn').setAttribute('aria-expanded', 'false');
}

// Anywhere else closes it, including the canvas — pressing the image with a
// shape armed is a tester who has finished choosing and started drawing.
document.addEventListener(
  'pointerdown',
  (e) => {
    if ($('shape-grid').hidden) return;
    if (e.target.closest?.('#shape-grid, #shapes-btn')) return;
    closeShapeGrid();
  },
  true
);

/* ── colour maths ──────────────────────────────────────────────────────── */

/*
 * Four small pure functions, kept together and kept free of the DOM.
 *
 * They are the whole of the colour suggestion: everything below this block is
 * buttons. Pure means `tools/test-annotate.mjs` can lift this section out of
 * the source and assert on it in Node without a browser, which is the only way
 * a rule like "the top pick is the colour furthest from the image" gets checked
 * at all rather than eyeballed once.
 */

function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  const part = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/**
 * How far apart two colours look, rather than how far apart their numbers are.
 *
 * Straight RGB distance says navy and dark green are equally far from black,
 * which is not what an eye reports: green carries most of the perceived
 * brightness and blue almost none. This is the "redmean" weighting, the
 * cheapest approximation that gets the *ordering* right, and ordering is all
 * this needs — no number computed here is ever shown to anybody.
 */
function colourDistance(a, b) {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const mean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

/**
 * The few colours a block of pixels is mostly made of.
 *
 * Coarse buckets on purpose: five shades of the same grey are one colour to
 * whoever is looking at the screenshot, so each channel is cut to eight steps
 * and whatever lands in a bucket is averaged back to one honest hex rather than
 * to the bucket's corner. Near-transparent pixels are skipped, because nobody
 * sees them and on a screenshot with a transparent margin they would otherwise
 * win the count outright and report the page as being the colour of nothing.
 */
function dominantColours(data, count = 6) {
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5);
    const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1;
    bin.r += data[i];
    bin.g += data[i + 1];
    bin.b += data[i + 2];
    bins.set(key, bin);
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((bin) => toHex(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n));
}

/**
 * Candidate pens, best first, for THIS image.
 *
 * A pen is only as visible as its worst moment, so each candidate is scored by
 * the *closest* colour the image actually contains: a red that is miles from
 * everything except the one red button is a red that will vanish on the one red
 * button, and that is the button the bug is usually about. Hence the minimum
 * rather than an average. With nothing to rank against the declared order
 * stands, which keeps the house colours first until the image has an opinion.
 */
function rankByVisibility(candidates, against) {
  if (!against.length) return [...candidates];
  return [...candidates]
    .map((hex, i) => ({ hex, i, score: Math.min(...against.map((seen) => colourDistance(hex, seen))) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((entry) => entry.hex);
}

/* ── colour panel ──────────────────────────────────────────────────────── */

/**
 * The pens on offer before the image has been read.
 *
 * The three house colours, plus a blue, a magenta, black and white — a spread
 * chosen so that whatever a screenshot turns out to be made of, something here
 * is a long way from it. These are candidates, not an order: the order comes
 * from the image.
 */
const HOUSE_COLOURS = [
  ['#B5432B', 'petra'],
  ['#E2AE38', 'corn'],
  ['#2A7A3B', 'guac'],
  ['#2563EB', 'blue'],
  ['#C2249B', 'magenta'],
  ['#111111', 'black'],
  ['#FFFFFF', 'white'],
];

/** Swatch names are i18n keys (`annotate.colour.name.<id>`), never English literals. */
const COLOUR_NAMES = new Map(HOUSE_COLOURS);

/** What the screenshot is made of, filled in once it has loaded. */
let imageColours = [];

/** The house pens, ranked for the image currently on the canvas. */
function rankedPens() {
  return rankByVisibility(
    HOUSE_COLOURS.map(([hex]) => hex),
    imageColours
  );
}

function pickColour(hex) {
  colour = hex;
  document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.hex === hex)));
  const custom = $('colour-custom');
  if (custom.value !== hex.toLowerCase()) custom.value = hex.toLowerCase();
}

function swatchButton(hex, label, best = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = best ? 'swatch best' : 'swatch';
  btn.dataset.hex = hex;
  btn.style.background = hex;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(hex === colour));
  btn.addEventListener('click', () => pickColour(hex));
  return btn;
}

function buildSwatches() {
  const fromImage = $('swatches-image');
  fromImage.replaceChildren();
  if (imageColours.length) {
    for (const hex of imageColours) fromImage.append(swatchButton(hex, t('annotate.colour.takenFromImage', { hex })));
  } else {
    const waiting = document.createElement('p');
    waiting.className = 'swatch-note';
    waiting.textContent = t('annotate.colour.waiting');
    fromImage.append(waiting);
  }

  const visible = $('swatches-visible');
  visible.replaceChildren();
  rankedPens().forEach((hex, i) => {
    const name = COLOUR_NAMES.has(hex) ? t(`annotate.colour.name.${COLOUR_NAMES.get(hex)}`) : hex;
    const best = i === 0 && imageColours.length > 0;
    visible.append(swatchButton(hex, best ? t('annotate.colour.bestContrast', { name }) : name, best));
  });

  const note = $('best-note');
  note.hidden = imageColours.length === 0;
  note.textContent = imageColours.length
    ? t('annotate.colour.bestNote')
    : '';
}

/**
 * Read the screenshot's colours off a 64px thumbnail of it.
 *
 * A full-page capture can be twenty million pixels and the answer would not
 * change: the question is which colours the page is *mostly* made of, and the
 * browser's own downscale answers it in one `drawImage`. Wrapped, because
 * `getImageData` throws on a tainted canvas, and losing the suggestions is a
 * far smaller thing than losing the editor.
 */
function readImageColours() {
  if (!source) return;
  try {
    const size = 64;
    const thumb = document.createElement('canvas');
    thumb.width = size;
    thumb.height = size;
    const tctx = thumb.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(source, 0, 0, size, size);
    imageColours = dominantColours(tctx.getImageData(0, 0, size, size).data, 6);
  } catch {
    imageColours = [];
  }
}

function wireRange(id, initial, onChange, format) {
  const input = $(id);
  const out = $(`${id}-out`);
  input.value = initial;
  const paint = () => {
    out.textContent = format(Number(input.value));
    onChange(Number(input.value));
  };
  input.addEventListener('input', paint);
  paint();
}

/* ── saving ────────────────────────────────────────────────────────────── */

/**
 * Export at full resolution, with the crop applied.
 *
 * The on-screen canvas is already the full image — it is only *displayed*
 * scaled — so nothing is resampled here beyond the crop itself.
 */
async function exportBlob(forceType) {
  if (selected >= 0) { selected = -1; render(); } // the dashed pick box is never part of the picture
  const type = forceType || (meta?.type && meta.type !== 'image/gif' ? meta.type : 'image/png');
  const quality = (settings?.imageQuality ?? 92) / 100;

  let out = canvas;
  if (crop && crop.w > 4 && crop.h > 4) {
    out = document.createElement('canvas');
    out.width = crop.w;
    out.height = crop.h;
    out.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  }

  const blob = await new Promise((resolve) =>
    out.toBlob(resolve, type, type === 'image/png' ? undefined : quality)
  );
  if (!blob) throw new Error(t('annotate.error.cannotEncode', { type }));
  return blob;
}

async function save(asCopy) {
  if (!shapes.length && !crop) return say(t('annotate.status.nothingToSave'), 'err');
  say(t('annotate.status.saving'));
  try {
    const blob = await exportBlob();
    const res = await send({
      type: 'UQA_MEDIA_SAVE_EDIT',
      id: mediaId,
      asCopy,
      label: asCopy ? t('annotate.save.copyLabel', { label: meta.label }) : meta.label,
      data: [...new Uint8Array(await blob.arrayBuffer())],
      mime: blob.type,
    });
    if (!res.ok) return say(res.error, 'err');
    say(
      asCopy
        ? t('annotate.status.savedCopy')
        : t('annotate.status.savedInPlace')
    );
    // Reload from what was stored, so what is on screen is what exists. What is stored is saved: leaving is not a loss.
    savedState = stateKey();
    setTimeout(() => location.replace(`annotate.html?id=${encodeURIComponent(res.result.id)}`), 700);
  } catch (err) {
    sayFailure(err);
  }
}

$('save').addEventListener('click', () => save(false));
$('save-copy').addEventListener('click', () => save(true));

/* ── boot ──────────────────────────────────────────────────────────────── */

/**
 * The image to mark up, read out of the store rather than asked for.
 *
 * This page is the same extension in the same profile as the worker, so it can
 * open the same IndexedDB and take the Blob. Going through the worker meant the
 * bytes were turned into an array of numbers and JSON-encoded across the
 * message port, because `chrome.runtime` messaging cannot carry a Blob — it
 * serialises to `{}` with no error at all. That is survivable for a screenshot
 * and it is still three copies of it for nothing.
 *
 * `import()` and not a static import: `annotate.html:120` loads this file as a
 * classic script, so a top-level `import` would not parse.
 *
 * The worker route stays as the fallback for a profile whose database will not
 * open, which is the one case this page cannot serve itself.
 */
async function loadStored(id) {
  try {
    const { getMedia } = await import('../core/db.js');
    const record = await getMedia(id);
    if (record?.blob) return { ok: true, blob: record.blob, type: record.type || record.blob.type };
  } catch {
    /* fall through to the worker */
  }
  const res = await send({ type: 'UQA_MEDIA_BLOB', id });
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    blob: new Blob([new Uint8Array(res.result.data)], { type: res.result.type }),
    type: res.result.type,
  };
}

(async function boot() {
  /*
   * The drawing engine, imported rather than inlined.
   *
   * Dynamic `import()` and not a static one for the same reason `loadStored`
   * uses it: `annotate.html` loads this file as a classic script, so a
   * top-level `import` would not parse and the editor would be a blank page.
   * Nothing paints before this line, so `paint()` can rely on it.
   */
  Shapes = await import('../core/shapes.js');
  Obj = await import('../core/objects.js');
  const fontOk = await Shapes.ensureCanvasFont();

  await QAWi18n.ready();
  if (!fontOk) say(QAWi18n.t('common.canvasFontMissing'), 'err'); // a system face must not be burned into the image unannounced
  QAWi18n.onChange(() => {
    QAWi18n.apply();
    paintShapeButton();
    buildShapeGrid();
    buildSwatches();
  });

  buildSwatches();
  buildShapeGrid();
  paintShapeButton();
  $('colour-custom').addEventListener('input', (e) => pickColour(e.target.value.toUpperCase()));
  wireRange('width', 4, (v) => (width = v), (v) => `${v}px`);
  wireRange('fontsize', 22, (v) => (fontSize = v), (v) => `${v}px`);
  wireRange('blur', 12, (v) => (blurStrength = v), (v) => t(v < 8 ? 'annotate.blurStrength.light' : v < 18 ? 'annotate.blurStrength.medium' : 'annotate.blurStrength.heavy'));
  canvas.style.cursor = 'crosshair';

  const s = await send({ type: 'UQA_GET_SETTINGS' });
  if (s.ok) settings = s.result;

  if (!mediaId) return say(t('annotate.status.noMediaId'), 'err');

  const got = await loadStored(mediaId);
  if (!got.ok) return say(got.error, 'err');

  const list = await send({ type: 'UQA_MEDIA_META', id: mediaId });
  meta = list.ok ? list.result : { label: t('annotate.meta.screenshotFallback'), type: got.type };
  $('subtitle').textContent = meta.label || t('annotate.subtitle.default');
  document.title = t('common.pageTitle', { name: meta.label || t('annotate.subtitle.default') });

  source = await createImageBitmap(got.blob);

  /*
   * Read the image, then arm the pen it argues for.
   *
   * Choosing the top-ranked colour is safe here and nowhere else: this runs
   * before the canvas has an image on it, so nothing has been drawn and there
   * is no tester decision to overrule. Changing the armed colour after that
   * would be rude, hence the guard, which will hold if this ever moves.
   */
  readImageColours();
  if (imageColours.length && !shapes.length) colour = rankedPens()[0];
  buildSwatches();
  pickColour(colour);

  render();
  say(t('annotate.status.ready', { w: source.width, h: source.height }));
})();
