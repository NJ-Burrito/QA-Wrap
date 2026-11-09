/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The KPI charts as SVG strings: vector, real <text> (so a print to PDF keeps selectable words), no library.
 *
 * Rules (dataviz skill): one axis, thin marks, 4 px rounded data ends on the baseline, a 2 px gap between stacked segments,
 * recessive grid, direct labels on the peak and the latest value only, text in ink tokens never in the series colour, an
 * accessible name and description on every figure, and a texture (diagonal hatch) beside colour for "not tested" so the pair
 * never relies on hue. Colours are CSS variables defined in kpi.css (light and dark, both validated).
 *
 * RTL: with `rtl` the plot mirrors. Time runs right to left, the value axis sits on the right, bars grow from the right edge and
 * labels anchor to the reading start. Digits stay Latin (the caller formats them), page-owned text is bidi-isolated by the caller.
 */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A round axis maximum at or above `max`, and its ticks. */
export function niceScale(max, ticks = 4, integer = false) {
  if (!(max > 0)) return { max: 1, step: 1, ticks: [0, 1] };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 1e6; v += step) out.push(Number(v.toFixed(10)));
  return { max: top, step, ticks: out };
}

const W = 600;
const M = { l: 44, r: 14, t: 16, b: 30 };

function frame({ title, desc, h }) {
  return {
    open: `<svg class="viz" viewBox="0 0 ${W} ${h}" width="100%" role="img" aria-labelledby="vt vd" focusable="false"><title id="vt">${esc(title)}</title><desc id="vd">${esc(desc)}</desc>`,
    close: '</svg>',
  };
}

/**
 * SVG `text-anchor` is relative to the text direction: in a right-to-left page `start` is the RIGHT edge. Callers pass the PHYSICAL
 * side they mean (`left` = text begins at x and runs right, `right` = text ends at x, `middle`); this returns the anchor that gives it.
 */
const anc = (side, rtl) => (side === 'middle' ? 'middle' : (side === 'left') === rtl ? 'end' : 'start');

/** Unique ids per figure so two charts on one page never share a title id. */
let uid = 0;
const withIds = (svg) => { uid += 1; return svg.replaceAll('"vt vd"', `"vt${uid} vd${uid}"`).replace('id="vt"', `id="vt${uid}"`).replace('id="vd"', `id="vd${uid}"`); };

/**
 * A trend over time: bars (counts) or a line with a soft area (a measure).
 * @param {{ points: {label:string, value:number}[], kind?: 'bar'|'line', rtl?: boolean, title: string, desc: string, integer?: boolean, fmt?: (n:number)=>string, axisFmt?: (n:number)=>string, series?: string }} o
 */
export function trend(o) {
  const { points, kind = 'bar', rtl = false, fmt = String, series = 'c1' } = o;
  const axisFmt = o.axisFmt || fmt;
  const h = 230;
  const f = frame({ title: o.title, desc: o.desc, h });
  const x0 = rtl ? M.r : M.l; // the value axis takes the margin on the reading-start side
  const x1 = rtl ? W - M.l : W - M.r;
  const pw = x1 - x0;
  const ph = h - M.t - M.b;
  const sc = niceScale(Math.max(0, ...points.map((p) => p.value)), 4, !!o.integer);
  const n = Math.max(1, points.length);
  const slot = pw / n;
  const px = (i) => (rtl ? x1 - slot * (i + 0.5) : x0 + slot * (i + 0.5));
  const py = (v) => M.t + ph - (v / sc.max) * ph;
  const axisX = rtl ? x1 + 6 : x0 - 6;
  const anchor = anc(rtl ? 'left' : 'right', rtl);
  let g = '';
  for (const t of sc.ticks) {
    g += `<line class="grid" x1="${x0}" x2="${x1}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}"/>`;
    g += `<text class="axis" x="${axisX}" y="${(py(t) + 4).toFixed(1)}" text-anchor="${anchor}">${esc(axisFmt(t))}</text>`;
  }
  g += `<line class="base" x1="${x0}" x2="${x1}" y1="${py(0)}" y2="${py(0)}"/>`;

  const every = Math.ceil(n / 7);
  points.forEach((p, i) => {
    if ((n - 1 - i) % every === 0) g += `<text class="axis" x="${px(i).toFixed(1)}" y="${h - 9}" text-anchor="middle">${esc(p.label)}</text>`;
  });

  const peak = points.reduce((b, p, i) => (p.value > (points[b]?.value ?? -1) ? i : b), 0);
  const label = (i) => `<text class="val" x="${px(i).toFixed(1)}" y="${(py(points[i].value) - 8).toFixed(1)}" text-anchor="middle">${esc(fmt(points[i].value))}</text>`;
  const marks = new Set(points.length ? [peak, n - 1].filter((i) => points[i]?.value > 0) : []);

  if (kind === 'bar') {
    const bw = Math.min(26, Math.max(3, slot * 0.6));
    points.forEach((p, i) => {
      if (!(p.value > 0)) return;
      const y = py(p.value);
      const x = px(i) - bw / 2;
      const r = Math.min(4, bw / 2, py(0) - y);
      g += `<path class="${series}" d="M${x.toFixed(1)} ${py(0)}V${(y + r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${-r}h${(bw - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}V${py(0)}z"><title>${esc(`${p.label}: ${fmt(p.value)}`)}</title></path>`;
    });
  } else {
    const pts = points.map((p, i) => `${px(i).toFixed(1)},${py(p.value).toFixed(1)}`);
    if (pts.length > 1) {
      g += `<path class="${series}-soft" d="M${px(0).toFixed(1)},${py(0)}L${pts.join('L')}L${px(n - 1).toFixed(1)},${py(0)}z"/>`;
      g += `<polyline class="line ${series}-line" points="${pts.join(' ')}"/>`;
    }
    points.forEach((p, i) => {
      if (i === n - 1 || marks.has(i)) g += `<circle class="dot ${series}-dot" cx="${px(i).toFixed(1)}" cy="${py(p.value).toFixed(1)}" r="4.5"><title>${esc(`${p.label}: ${fmt(p.value)}`)}</title></circle>`;
    });
  }
  for (const i of marks) g += label(i);
  return withIds(f.open + g + f.close);
}

/**
 * Horizontal bars, one row per item, label above the bar so long hosts never collide with the value.
 * @param {{ rows: {label:string, value:number, text:string}[], rtl?: boolean, title: string, desc: string, series?: string }} o
 */
export function hbars(o) {
  const { rows, rtl = false, series = 'c1' } = o;
  const rowH = 38;
  const h = Math.max(60, rows.length * rowH + 10);
  const f = frame({ title: o.title, desc: o.desc, h });
  const max = Math.max(1, ...rows.map((r) => r.value));
  const x0 = M.r;
  const bw = W - 2 * M.r - 70;
  let g = '';
  rows.forEach((r, i) => {
    const y = 6 + i * rowH;
    const len = r.value > 0 ? Math.max(4, (r.value / max) * bw) : 0;
    const start = rtl ? W - x0 : x0;
    const ax = anc(rtl ? 'right' : 'left', rtl);
    g += `<text class="lab" x="${start}" y="${y + 12}" text-anchor="${ax}">${esc(r.label)}</text>`;
    if (len) {
      const x = rtl ? start - len : start;
      g += `<rect class="${series}" x="${x.toFixed(1)}" y="${y + 18}" width="${len.toFixed(1)}" height="10" rx="4"><title>${esc(`${r.label}: ${r.text}`)}</title></rect>`;
    }
    const tx = rtl ? start - len - 8 : start + len + 8;
    g += `<text class="val" x="${tx.toFixed(1)}" y="${y + 27}" text-anchor="${anc(rtl ? 'right' : 'left', rtl)}">${esc(r.text)}</text>`;
  });
  return withIds(f.open + g + f.close);
}

/**
 * Stacked horizontal bars, tested then not tested, with a 2 px gap and a hatch on the untested part (colour is never alone).
 * @param {{ rows: {label:string, a:number, b:number, text:string}[], rtl?: boolean, title: string, desc: string }} o
 */
export function stacked(o) {
  const { rows, rtl = false } = o;
  const rowH = 40;
  const h = Math.max(60, rows.length * rowH + 10);
  const f = frame({ title: o.title, desc: o.desc, h });
  const defs = '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line" stroke-width="2"/></pattern></defs>';
  const bw = W - 2 * M.r;
  let g = defs;
  rows.forEach((r, i) => {
    const y = 6 + i * rowH;
    const total = r.a + r.b;
    const start = rtl ? W - M.r : M.r;
    g += `<text class="lab" x="${start}" y="${y + 12}" text-anchor="${anc(rtl ? 'right' : 'left', rtl)}">${esc(r.label)}</text>`;
    g += `<text class="val" x="${rtl ? M.r : W - M.r}" y="${y + 12}" text-anchor="${anc(rtl ? 'left' : 'right', rtl)}">${esc(r.text)}</text>`;
    if (!total) return;
    const aw = (r.a / total) * bw;
    const bwid = bw - aw;
    const gap = r.a > 0 && r.b > 0 ? 2 : 0;
    const ax = rtl ? start - aw : start;
    const bx = rtl ? M.r : start + aw + gap;
    if (r.a > 0) g += `<rect class="c1" x="${ax.toFixed(1)}" y="${y + 18}" width="${Math.max(0, aw - gap).toFixed(1)}" height="12" rx="4"/>`;
    if (r.b > 0) g += `<rect class="untested" x="${bx.toFixed(1)}" y="${y + 18}" width="${Math.max(0, bwid - gap).toFixed(1)}" height="12" rx="4"/>`;
  });
  return withIds(f.open + g + f.close);
}

/** The same numbers as a table, for readers who want values and for assistive tech: `rows` is an array of cell arrays, first row the head. */
export function table(rows, { caption = '' } = {}) {
  const [head, ...body] = rows;
  return `<table class="data"><caption>${esc(caption)}</caption><thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
}
