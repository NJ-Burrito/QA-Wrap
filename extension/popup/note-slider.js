/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * r363: a thin slider under the note box, shown only while the text is wider than the box.
 * The thumb is the visible part of the text (size = visible / total); its place is scrollLeft.
 * Direction is logical: the track inherits the box's direction, so an Arabic box (scrollLeft <= 0 in
 * Chromium and Gecko) fills from the right with the same maths — only the pointer maths needs `rtl`.
 * It is a [data-live] indicator with role="scrollbar", not a control: not focusable, the caret is the keyboard way.
 */
const MIN_THUMB = 0.08;

/** The pure model. `scrollLeft` may be negative (RTL). Returns { visible, size, pos } with size, pos in 0..1 of the track. */
export function thumbModel(scrollLeft, clientWidth, scrollWidth) {
  if (!(scrollWidth > clientWidth) || !(clientWidth > 0)) return { visible: false, size: 1, pos: 0 };
  const size = Math.max(MIN_THUMB, clientWidth / scrollWidth);
  const max = scrollWidth - clientWidth;
  const done = Math.min(1, Math.abs(scrollLeft) / max);
  return { visible: true, size, pos: done * (1 - size) };
}

/** Pointer at `frac` (0..1 along the track from its logical start) centres the thumb there: the scrollLeft to set. */
export function scrollForFraction(frac, clientWidth, scrollWidth, rtl) {
  const size = Math.max(MIN_THUMB, clientWidth / scrollWidth);
  const max = scrollWidth - clientWidth;
  const done = size >= 1 ? 0 : Math.min(1, Math.max(0, (frac - size / 2) / (1 - size)));
  return (rtl ? -1 : 1) * done * max;
}

function mount(doc) {
  const input = doc.getElementById('note-text');
  const row = doc.getElementById('note-row');
  if (!input || !row) return;
  const track = doc.createElement('div');
  track.id = 'note-slider';
  track.className = 'note-slider';
  track.hidden = true;
  track.setAttribute('role', 'scrollbar');
  track.setAttribute('aria-orientation', 'horizontal');
  track.setAttribute('aria-controls', 'note-text');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.dataset.live = '';
  const thumb = doc.createElement('span');
  thumb.className = 'note-slider-thumb';
  track.append(thumb);
  row.append(track);
  const isRtl = () => getComputedStyle(input).direction === 'rtl';
  const paint = () => {
    const m = thumbModel(input.scrollLeft, input.clientWidth, input.scrollWidth);
    track.hidden = !m.visible;
    if (!m.visible) return;
    // Sits under the box itself, in physical pixels, so the buttons beside it are not covered and the row does not grow.
    track.style.top = `${input.offsetTop + input.offsetHeight - 3}px`;
    track.style.left = `${input.offsetLeft}px`;
    track.style.width = `${input.offsetWidth}px`;
    track.dir = isRtl() ? 'rtl' : 'ltr';
    thumb.style.inlineSize = `${m.size * 100}%`;
    thumb.style.insetInlineStart = `${m.pos * 100}%`;
    track.setAttribute('aria-valuenow', String(Math.round((m.pos / Math.max(1e-9, 1 - m.size)) * 100)));
  };
  const drag = (e) => {
    const r = track.getBoundingClientRect();
    const rtl = isRtl();
    const frac = (rtl ? r.right - e.clientX : e.clientX - r.left) / r.width;
    input.scrollLeft = scrollForFraction(frac, input.clientWidth, input.scrollWidth, rtl);
    paint();
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture?.(e.pointerId);
    drag(e);
    const move = (ev) => drag(ev);
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  for (const ev of ['input', 'scroll', 'keyup', 'click', 'focus', 'wheel']) input.addEventListener(ev, paint);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(paint).observe(input);
  paint();
}

if (typeof document !== 'undefined') mount(document);
