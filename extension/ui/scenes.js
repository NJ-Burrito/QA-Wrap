/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The explainers: one animated mini mock-up of the real action per tool
 * (DESIGN-SPEC §11, work/ui-rework-0927/prototype/data/visuals.json).
 *
 *   UQAScenes.svg(id)    -> '<svg class="qaw-x" data-scene="id" data-loop viewBox="0 0 240 144">...</svg>' or null
 *   UQAScenes.ids()      -> the 22 scene ids
 *   UQAScenes.play(root) -> plays each explainer under root while at least half of it is visible
 *
 * Paint and motion live in ui/visuals.css, which the page links after the tokens.
 *
 * Rules the drawings keep:
 * - One frame, 240 x 144, 12 units of margin. No words: text is drawn as bars, and digits,
 *   only in timer and count cells, are stroked paths in 0.7em cells (no <text>, no font).
 * - Every colour is a token class (f- fill, s- stroke) resolved in visuals.css. No hex here.
 * - The un-animated state of every element IS the final beat, so reduced motion, an explainer
 *   out of view and the end of its second play all show the finished picture.
 * - No id attributes: many of these sit in one document, so arrowheads are paths, not markers.
 * - RTL mirrors the whole drawing (visuals.css); `.cm` groups flip back what must stay as
 *   drawn: digits, code, ticks, the mark and the pointer's shape.
 *
 * Loading this file touches nothing but `window`: tools/test-tool-cards.mjs and
 * tools/test-explainers.mjs run it against a bare object. Observers are wired by play().
 */
(() => {
  if (window.UQAScenes) return;

  /* ── primitives (geometry only) ───────────────────────────────────────── */
  const r = (x, y, w, h, rx, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;
  /** A line of text, drawn as a bar with pill ends. */
  const bar = (x, y, w, cls = 'f-border-strong', h = 6) => r(x, y, w, h, h / 2, cls);
  const p = (d, cls, sw) => `<path d="${d}" class="${cls}"${sw ? ` stroke-width="${sw}"` : ''}/>`;
  const g = (cls, body) => `<g class="${cls}">${body}</g>`;
  const cm = (body) => g('cm', body);
  const dot = (cx, cy, rad, cls) => `<circle cx="${cx}" cy="${cy}" r="${rad}" class="${cls}"/>`;
  /** Top-rounded band: a page's or window's header strip. */
  const band = (x, y, w, h, rx, cls) =>
    p(`M${x} ${y + h}V${y + rx}a${rx} ${rx} 0 0 1 ${rx}-${rx}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}V${y + h}Z`, cls);
  /** The nuqta: Thmanyah's diamond dot, softened by a round join. */
  const nuqta = (cx, cy, s, cls) =>
    p(`M${cx} ${cy - s}L${cx + s} ${cy}L${cx} ${cy + s}L${cx - s} ${cy}Z`, `${cls} x-nuqta`, 1);
  const tickD = (cx, cy, s) => `M${cx - s} ${cy + 0.1 * s}L${cx - 0.3 * s} ${cy + 0.75 * s}L${cx + s} ${cy - 0.75 * s}`;
  const crossD = (cx, cy, s) => `M${cx - s} ${cy - s}L${cx + s} ${cy + s}M${cx + s} ${cy - s}L${cx - s} ${cy + s}`;
  /** A tick is never mirrored. */
  const tick = (cx, cy, s, cls, sw = 1.5) => cm(p(tickD(cx, cy, s), `x-line ${cls}`, sw));
  const cross = (cx, cy, s, cls, sw = 1.5) => p(crossD(cx, cy, s), `x-line ${cls}`, sw);
  /** A warn triangle with its bang, centred on (cx, cy). */
  const warnMark = (cx, cy, cls) =>
    p(`M${cx} ${cy - 5}L${cx + 5.5} ${cy + 4.5}H${cx - 5.5}Z`, `x-line s-warn ${cls}`, 1.3)
    + p(`M${cx} ${cy - 1.5}V${cy + 1}M${cx} ${cy + 2.6}V${cy + 2.61}`, `x-line s-warn ${cls}`, 1.3);

  /*
   * Digits: stroked glyphs in a 5.2 x 8.4 box (the 12-unit caption's figure height), absolute
   * M/L/H/V/C/Z only so they can be moved by adding to each number. Cells are 0.7em (8.4) per
   * digit and 0.35em (4.2) for the colon, so a count never shifts its neighbours.
   */
  const GLYPH = {
    0: 'M2.6 0C1 0 0 1.7 0 4.2C0 6.7 1 8.4 2.6 8.4C4.2 8.4 5.2 6.7 5.2 4.2C5.2 1.7 4.2 0 2.6 0Z',
    1: 'M0.9 1.7L3.1 0V8.4',
    2: 'M0.3 1.9C0.7 0.7 1.5 0 2.6 0C4 0 5 0.9 5 2.3C5 3.8 3.9 4.8 0.2 8.4H5.2',
    3: 'M0.4 0.2H4.8L2.3 3.3C4 3.2 5.2 4.2 5.2 5.8C5.2 7.4 4 8.4 2.5 8.4C1.4 8.4 0.6 7.9 0.1 7.1',
    4: 'M3.9 8.4V0L0 5.8H5.2',
    5: 'M4.8 0.2H1.1L0.6 3.7C1.1 3.3 1.8 3.1 2.6 3.1C4.1 3.1 5.2 4.2 5.2 5.7C5.2 7.3 4 8.4 2.5 8.4C1.4 8.4 0.6 7.9 0.1 7.1',
    6: 'M4.5 0.5C4 0.2 3.4 0 2.8 0C1 0 0 1.9 0 4.6C0 7 1 8.4 2.6 8.4C4.1 8.4 5.2 7.3 5.2 5.7C5.2 4.2 4.1 3.1 2.7 3.1C1.5 3.1 0.5 3.8 0.1 4.8',
    7: 'M0 0.2H5.2L1.8 8.4',
    8: 'M2.6 3.9C1.3 3.9 0.4 3.1 0.4 2C0.4 0.8 1.3 0 2.6 0C3.9 0 4.8 0.8 4.8 2C4.8 3.1 3.9 3.9 2.6 3.9ZM2.6 3.9C1.1 3.9 0 4.8 0 6.1C0 7.5 1.1 8.4 2.6 8.4C4.1 8.4 5.2 7.5 5.2 6.1C5.2 4.8 4.1 3.9 2.6 3.9Z',
    9: 'M0.7 7.9C1.2 8.2 1.8 8.4 2.4 8.4C4.2 8.4 5.2 6.5 5.2 3.8C5.2 1.4 4.2 0 2.6 0C1.1 0 0 1.1 0 2.7C0 4.2 1.1 5.3 2.5 5.3C3.7 5.3 4.7 4.6 5.1 3.6',
    ':': 'M0 2.6V2.61M0 7.4V7.41',
  };
  const CELL = 8.4;
  const SEP = 4.2;
  const moveD = (d, dx, dy) => d.replace(/([MLHVCZ])([^MLHVCZ]*)/g, (m, c, args) => {
    const n = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
    return c + n.map((v, i) => +(v + (c === 'H' || (c !== 'V' && i % 2 === 0) ? dx : dy)).toFixed(2)).join(' ');
  });
  /** The path for `str`, cells starting at x, baseline at y. */
  const digitsD = (x, y, str) => {
    let cx = x;
    let d = '';
    for (const ch of str) {
      const w = ch === ':' ? SEP : CELL;
      d += moveD(GLYPH[ch], cx + (ch === ':' ? w / 2 : (w - 5.2) / 2), y - 8.4);
      cx += w;
    }
    return d;
  };
  const digits = (x, y, str, cls, extra = '') => g(`cm x-digits ${cls}`, `<path d="${digitsD(x, y, str)}"/>${extra}`);

  /** The arrow cursor, 12 x 16, tip at (0,0). Its position mirrors in RTL, its shape does not. */
  const pointer = (cls) => g(`x-ptr ${cls}`, p('M0 0V13.4L3.5 10.3L5.9 15.6L8.4 14.5L6 9.3H10.6Z', 'x-ptr-shape'));
  /** The mark, one-colour variant, geometry exactly as brand/mark-mono.svg. */
  const mark = (x, y, size) => cm(`<g transform="translate(${x} ${y}) scale(${size / 64})"><g transform="translate(-2 1)" class="x-line s-text" stroke-width="7"><path d="M45.01 37.98 A17 17 0 1 0 34.97 46.26"/><path d="M36 36L42.5 44L55 20"/></g></g>`);
  /** A landscape picture on the page under test. */
  const picture = (x, y, w, h) => [
    r(x, y, w, h, 3, 'f-raised s-border'),
    p(`M${x + 5.5} ${y + h - 5.5}L${x + 0.25 * w} ${y + 0.4 * h}L${x + 0.45 * w} ${y + 0.66 * h}L${x + 0.6 * w} ${y + 0.52 * h}L${x + w - 5.5} ${y + h - 5.5}`, 'x-line s-border-strong', 1.5),
    dot(x + 0.78 * w, y + 0.26 * h, 3.5, 'f-border-strong'),
  ].join('');
  /** The page under test: ground, header strip with its title bar; the edge is drawn last. */
  const pageBack = (x, y, w, h, rx = 6, title = 24) =>
    r(x, y, w, h, rx, 'f-surface') + band(x, y, w, 12, rx, 'f-raised') + bar(x + 7, y + 3, title);
  const pageEdge = (x, y, w, h, rx = 6) => r(x + 0.5, y + 0.5, w - 1, h - 1, rx, 'x-line s-border');
  /** A text field: raised fill, 1-unit strong border. */
  /** A warn or purpose ring, the 1.5-unit band of the ported scenes. */
  const ring = (x, y, w, h, rx, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="x-line ${cls}" stroke-width="1.5"/>`;
  const field = (x, y, w, h = 12) => r(x + 0.5, y + 0.5, w - 1, h - 1, 3, 'f-raised s-border-strong');
  /** A small film tile: a picture's frame with a play triangle. */
  const tile = (x, y) => r(x + 0.5, y + 0.5, 39, 22, 2.5, 'f-raised s-border')
    + p(`M${x + 17} ${y + 7}L${x + 24} ${y + 11.5}L${x + 17} ${y + 16}Z`, 'f-text-muted');

  /* ── the 22 scenes. Coordinates are the storyboards of visuals.json laid out on 240 x 144. ── */
  const SCENES = {
    /* Record a session: Start pressed, the live chip appears, steps rise, a problem lands. 4000 ms. */
    start: () => [
      r(12.5, 12.5, 215, 119, 8, 'f-ground'),
      band(12.5, 12.5, 215, 20, 8, 'f-surface'),
      p('M12.5 32.5H227.5', 'x-line s-border', 1),
      r(12.5, 12.5, 215, 119, 8, 'x-line s-border'),
      mark(15, 14.5, 16),
      bar(35, 19.5, 26, 'f-text'),
      g('rs-chip', r(134, 15.5, 57, 14, 7, 'f-accent-soft')
        + '<circle class="rs-dot f-live" cx="141.5" cy="22.5" r="2.5"/>'
        + digits(147, 26.7, '00:0', 's-accent-ink',
          `<path class="rs-t0" d="${digitsD(147 + 3 * CELL + SEP, 26.7, '0')}"/><path class="rs-t1" d="${digitsD(147 + 3 * CELL + SEP, 26.7, '1')}"/>`)),
      r(197.5, 18.5, 8, 8, 2, 'x-line s-text-muted'),
      nuqta(213, 22.5, 1.3, 'f-text-muted s-text-muted'),
      nuqta(217.5, 22.5, 1.3, 'f-text-muted s-text-muted'),
      nuqta(222, 22.5, 1.3, 'f-text-muted s-text-muted'),
      /* session card: charter field, then Start that becomes Stop & review */
      r(20.5, 38.5, 199, 46, 6, 'f-surface s-border'),
      r(26.5, 44.5, 187, 14, 3, 'f-raised s-border-strong'),
      bar(31, 48.5, 64),
      g('rs-btn', r(26, 62.5, 188, 16, 4, 'f-accent')
        + g('rs-start', dot(104, 70.5, 2.5, 'f-accent-text') + bar(110, 67.5, 26, 'f-accent-text'))
        + g('rs-stop', r(97, 67.5, 6, 6, 1.5, 'f-accent-text') + bar(107, 67.5, 36, 'f-accent-text'))),
      /* session so far: Steps recorded | Problems found (with its count cell) */
      r(20.5, 90.5, 117, 37, 6, 'f-surface s-border'),
      bar(27, 95, 38, 'f-text-muted', 5),
      ...[[103.5, 70, 'rs-s1'], [111.5, 54, 'rs-s2'], [119.5, 62, 'rs-s3']].map(([y, w, c]) =>
        g(c, nuqta(29.5, y + 2.5, 1.8, 'f-text-muted s-text-muted') + bar(35, y, w, 'f-border-strong', 5))),
      r(143.5, 90.5, 76, 37, 6, 'f-surface s-border'),
      bar(150, 95, 32, 'f-text-muted', 5),
      g('cm x-digits s-text', `<path class="rs-c0" d="${digitsD(203.8, 101.7, '0')}"/><path class="rs-c1" d="${digitsD(203.8, 101.7, '1')}"/>`),
      g('rs-prob', cross(153.5, 111.5, 2.5, 's-fail') + bar(160, 109, 46, 'f-border-strong', 5) + bar(160, 117.5, 28, 'f-text-muted', 4)),
      pointer('rs-ptr'),
    ],

    /* Pick a selector: hover ring, the second ring lands, chip rises, locator reaches the bar. 3600 ms. */
    pick: () => [
      r(12.5, 12.5, 215, 119, 6, 'f-surface'),
      band(12.5, 12.5, 215, 14, 6, 'f-raised'),
      bar(20, 16.5, 28), bar(176, 16.5, 18), bar(200, 16.5, 20),
      r(56.5, 31.5, 127, 12, 3, 'f-raised s-border-strong'), bar(61, 34.5, 36),
      r(56.5, 46.5, 127, 12, 3, 'f-raised s-border-strong'), bar(61, 49.5, 28),
      r(56, 84, 44, 12, 3, 'f-text'), bar(64, 87, 28, 'f-surface'),
      bar(108, 87, 40),
      r(12.5, 12.5, 215, 119, 6, 'x-line s-border'),
      /* the two crisp rings, 1.5-unit bands at this scale */
      '<g class="pk-hover" stroke-width="1.5">' + r(55.25, 83.25, 45.5, 13.5, 3.75, 'x-line s-ring-halo') + r(53.75, 81.75, 48.5, 16.5, 5.25, 'x-line s-p-any') + '</g>',
      '<g class="pk-lock" stroke-width="1.5">' + r(52.25, 80.25, 51.5, 19.5, 6.75, 'x-line s-ring-halo') + r(50.75, 78.75, 54.5, 22.5, 8.25, 'x-line s-p-any') + '</g>',
      /* the name chip: above the ring, never over the element */
      g('pk-chip', r(50.5, 59.5, 60, 16, 4, 'f-surface s-border-strong')
        + r(53, 61.5, 12, 12, 2, 'f-p-any')
        + digits(54.8, 71.7, '1', 's-on-purpose')
        + g('pk-name', bar(69, 64.5, 12, 'f-text-muted') + bar(85, 64.5, 21, 'f-text'))
        + g('pk-cbar', bar(80, 64.5, 24, 'f-text'))
        + tick(73, 67.5, 3.2, 's-text pk-tick')),
      /* the in-page bar, docked bottom: grip | record | purpose 1-4 | last locator + copy */
      r(30.5, 108, 175, 20, 8, 'f-border'),
      r(30.5, 106.5, 175, 20, 8, 'f-glass s-glass-line'),
      ...[[37, 113.5], [37, 119.5], [40.5, 113.5], [40.5, 119.5]].map(([cx, cy]) => dot(cx, cy, 0.9, 'f-text-muted')),
      p('M46.5 110.5V122.5', 'x-line s-border', 1),
      dot(52.5, 116.5, 2.5, 'f-live'), bar(58, 113.5, 18),
      p('M80.5 110.5V122.5', 'x-line s-border', 1),
      r(84, 110.5, 48, 12, 3, 'f-surface-sunken'),
      r(85.5, 112, 10.5, 9, 2, 'f-p-any'),
      nuqta(90.75, 116.5, 1.4, 'f-on-purpose s-on-purpose'),
      nuqta(102.25, 116.5, 1.4, 'f-text-muted s-text-muted'),
      nuqta(113.75, 116.5, 1.4, 'f-text-muted s-text-muted'),
      nuqta(125.25, 116.5, 1.4, 'f-text-muted s-text-muted'),
      p('M136.5 110.5V122.5', 'x-line s-border', 1),
      r(140.5, 110.5, 44, 12, 2, 'f-raised s-border'),
      cm(r(144, 113.5, 34, 6, 3, 'f-text pk-code')),
      g('pk-copy x-line s-text-muted', r(190.5, 111.5, 6.5, 6.5, 1.5, '') + p('M193.5 121.5H198.5a1.5 1.5 0 0 0 1.5-1.5V115', '')),
      tick(195.5, 116.5, 3.2, 's-text pk-tick'),
      pointer('pk-ptr'),
    ],

    /* Read and export: the review card rises, tiles fill, a finding turns red, Playwright drops in the tray. 4000 ms. */
    report: () => {
      const cols = [24, 73, 122, 171];
      const tiles = [['04:12', 24], ['23', 32], ['1', 36], ['2', 20]];
      const glyphs = [
        (x) => p(`M${x + 8.5} 93L${x + 6} 95.5L${x + 8.5} 98M${x + 12} 93L${x + 14.5} 95.5L${x + 12} 98`, 'x-line s-text', 1.3),
        (x) => p(`M${x + 6} 93.5h8M${x + 6} 95.5h8M${x + 6} 97.5h5`, 'x-line s-text', 1),
        (x) => p(`M${x + 8} 92.5q-1.5 0-1.5 1.5v.6q0 .9-1 .9q1 0 1 .9v.6q0 1.5 1.5 1.5M${x + 11} 92.5q1.5 0 1.5 1.5v.6q0 .9 1 .9q-1 0-1 .9v.6q0 1.5-1.5 1.5`, 'x-line s-text', 1),
        (x) => r(x + 6, 92.5, 8, 6, 1.2, 'x-line s-text') + p(`M${x + 6} 95.5h8M${x + 10} 92.5v6`, 'x-line s-text', 1),
      ];
      return [
        g('re-card', [
          r(16.5, 12.5, 207, 94, 8, 'f-surface s-border'),
          r(24, 19, 42, 11, 2, 'f-pass-soft'), tick(30, 24.5, 2.4, 's-pass-ink', 1.3), bar(35, 22, 26, 'f-pass-ink', 5),
          bar(24, 34.5, 86, 'f-text', 7),
          ...cols.map((x, i) => r(x + 0.5, 45.5, 44, 22, 4, 'f-surface s-border')
            + g(`re-n${i + 1}`, digits(x + 4.5, 58, tiles[i][0], 's-text'))
            + bar(x + 4.5, 61.5, tiles[i][1], 'f-text-muted', 3.5)),
          g('re-fail', r(24, 71.5, 192, 14, 3, 'f-fail-soft') + cross(31, 78.5, 2.3, 's-fail')),
          bar(38, 75.5, 96),
          digits(174, 82.7, '02:41', 's-text-muted'),
          ...cols.map((x, i) => g(i === 0 ? 're-b1' : '', r(x + 0.5, 89.5, 44, 12, 3, 'f-surface s-border-strong')
            + glyphs[i](x) + bar(x + 18, 93, [20, 20, 14, 22][i], 'f-text', 5))),
        ].join('')),
        r(16.5, 112.5, 207, 19, 6, 'f-ground s-border'),
        g('re-file', r(22.5, 115.5, 86, 13, 3, 'f-surface s-border-strong')
          + p('M29.5 119.5L27 122L29.5 124.5M33 119.5L35.5 122L33 124.5', 'x-line s-text', 1.3)
          + bar(40, 119, 60, 'f-text-muted')),
        pointer('re-ptr'),
      ];
    },

    /* Photograph the page: corners close in, a flash, the picture shrinks into the strip, 2 becomes 3. 3200 ms. */
    shot: () => {
      const page = () => `<g transform="translate(16 14)">${[
        r(0, 0, 150, 90, 5, 'f-surface'),
        band(0, 0, 150, 12, 5, 'f-raised'), bar(7, 3, 26),
        picture(8.5, 19.5, 56, 34),
        bar(74, 21, 60), bar(74, 32, 50), bar(74, 43, 34),
        r(74, 55, 36, 11, 3, 'f-text'), bar(81, 57.5, 22, 'f-surface'),
        bar(8.5, 63, 56), bar(8.5, 74, 118),
        r(0.5, 0.5, 149, 89, 5, 'x-line s-border'),
      ].join('')}</g>`;
      return [
        page(),
        r(16, 14, 150, 90, 5, 'f-surface sh-flash'),
        p('M12 20V14a4 4 0 0 1 4-4h6M160 10h6a4 4 0 0 1 4 4v6M170 98v6a4 4 0 0 1-4 4h-6M22 108h-6a4 4 0 0 1-4-4v-6', 'x-line s-accent sh-corners', 2),
        r(174.5, 62.5, 53, 69, 6, 'f-surface s-border'),
        r(178, 66.5, 46, 28, 3, 'f-surface-sunken'),
        g('x-line s-text-muted', r(184.5, 111, 10, 7, 1.5, '') + dot(189.5, 114.5, 1.8, '')),
        g('cm x-digits s-text', `<path class="sh-c2" d="${digitsD(207.8, 118.7, '2')}"/><path class="sh-c3" d="${digitsD(207.8, 118.7, '3')}"/>`),
        g('sh-thumb', page()),
      ];
    },

    /* Mask real data: drag a cover over the card number; the picture comes out covered, with a pass tick. 3500 ms. */
    mask: () => {
      const page = () => [
        r(0, 0, 116, 100, 5, 'f-surface'),
        band(0, 0, 116, 12, 5, 'f-raised'), bar(7, 3, 24),
        bar(8, 22, 84),
        bar(8, 40, 30), bar(44, 40, 12), bar(59, 40, 12), bar(74, 40, 12), bar(89, 40, 12),
        bar(8, 58, 64),
        r(8, 74, 36, 12, 3, 'f-text'), bar(15, 77, 22, 'f-surface'),
        r(0.5, 0.5, 115, 99, 5, 'x-line s-border'),
      ].join('');
      return [
        `<g transform="translate(16 22)">${page()}</g>`,
        r(21, 59, 99, 12, 3, 'f-text mk-mask'),
        g('mk-thumb', r(147.5, 40.5, 74, 64, 4, 'f-surface s-border-strong')
          + `<g transform="translate(149.2 42.3) scale(0.6)">${page()}${r(5, 37, 99, 12, 3, 'f-text')}</g>`),
        g('mk-ok', '<circle cx="220" cy="42.5" r="7.5" class="f-pass-soft s-surface" stroke-width="1.5"/>'
          + tick(220, 42.5, 3.4, 's-pass-ink mk-okt', 1.6)),
        pointer('mk-ptr'),
      ];
    },

    /* Check accessibility: a scan band sweeps, two warn rings land, the result tile rises with 2. 3600 ms. */
    a11y: () => [
      r(16, 14, 140, 116, 6, 'f-surface'),
      r(16, 14, 140, 116, 6, 'f-accent-soft ay-band'),
      band(16, 14, 140, 12, 6, 'f-raised'), bar(23, 17, 28),
      picture(24.5, 33.5, 58, 38),
      bar(92, 36, 56), bar(92, 48, 46), bar(92, 60, 32),
      bar(24, 82, 118), bar(24, 94, 96),
      r(24.5, 106.5, 48, 15, 3, 'f-surface-sunken'), bar(34, 111, 28, 'f-raised'),
      r(16.5, 14.5, 139, 115, 6, 'x-line s-border'),
      '<g stroke-width="1.5">' + r(21.5, 30.5, 64, 44, 5.5, 'x-line s-warn ay-r1') + r(21.5, 103.5, 54, 21, 5.5, 'x-line s-warn ay-r2') + '</g>',
      g('ay-tile', r(164.5, 48.5, 63, 46, 6, 'f-surface s-border')
        + p('M179 56L186 68.5H172Z', 'x-line s-warn', 1.5) + p('M179 60.5V63.6', 'x-line s-warn', 1.5)
        + dot(179, 66, 0.95, 'f-warn')
        + digits(195.8, 66.5, '2', 's-text')
        + r(168, 73.5, 54, 11, 2.5, 'f-warn-soft') + bar(171, 76.5, 48, 'f-warn-ink', 5) + bar(171, 87, 32, 'f-text-muted', 5)),
    ],

    /* Check the links: four rows answer tick, tick, cross, tick; the failed row turns red. 3400 ms. */
    links: () => {
      const rows = [21.5, 47.5, 73.5, 99.5];
      const widths = [68, 52, 76, 58];
      return [
        r(16, 16, 76, 112, 6, 'f-surface'),
        band(16, 16, 76, 12, 6, 'f-raised'), bar(22, 19, 22),
        bar(23, 36, 56),
        bar(23, 46, 40, 'f-text-muted', 5), p('M23 53.5H63', 'x-line s-text-muted', 1),
        bar(23, 60, 50),
        bar(23, 70, 32, 'f-text-muted', 5), p('M23 77.5H55', 'x-line s-text-muted', 1),
        bar(23, 84, 58),
        bar(23, 94, 46, 'f-text-muted', 5), p('M23 101.5H69', 'x-line s-text-muted', 1),
        bar(23, 108, 36, 'f-text-muted', 5), p('M23 115.5H59', 'x-line s-text-muted', 1),
        r(16.5, 16.5, 75, 111, 6, 'x-line s-border'),
        g('ln-list', [
          r(100.5, 16.5, 127, 111, 6, 'f-surface s-border'),
          r(103.5, 73.5, 121, 24, 4, 'f-fail-soft ln-fsoft'),
          p('M106 47H222M106 73H222M106 99H222', 'x-line s-border', 1),
          ...rows.map((y, i) => bar(109, y + 8, widths[i], 'f-text', 5)
            + p(`M109 ${y + 15.5}H${109 + widths[i]}`, 'x-line s-text-muted', 1)
            + (i === 2 ? g('ln-m3', cross(212, y + 12, 3.2, 's-fail', 1.75)) : tick(212, y + 12, 4, `s-pass ln-m${i + 1}`, 1.75))),
        ].join('')),
      ];
    },

    /* Break a request: requests travel, the line is cut, the page errors; the toggle heals it. 4000 ms. */
    break: () => [
      p('M96 64H176', 'x-line s-border-strong', 1.5),
      g('bk-nuq', [148, 157, 166].map((x) => nuqta(x, 64, 2.6, 'f-text s-text')).join('')),
      g('bk-cut', p('M131 71L135.5 57H142L137.5 71Z', 'f-surface-sunken') + p('M131 71L135.5 57M137.5 71L142 57', 'x-line s-fail', 1.5)),
      r(16, 22, 80, 100, 6, 'f-surface'),
      band(16, 22, 80, 12, 6, 'f-raised'), bar(22, 25, 24),
      g('bk-banner', r(21.5, 39.5, 69, 14, 3, 'f-fail-soft') + cross(28.5, 46.5, 2.3, 's-fail') + bar(34, 44, 50, 'f-fail-ink', 5)),
      bar(22, 60, 60), bar(22, 70, 46), bar(22, 80, 54),
      r(22.5, 90.5, 67, 12, 3, 'f-raised s-border-strong'), bar(27, 93.5, 30),
      r(22, 107, 30, 10, 3, 'f-text'), bar(28, 109, 18, 'f-surface'),
      r(16.5, 22.5, 79, 99, 6, 'x-line s-border'),
      r(176.5, 36.5, 48, 56, 6, 'f-surface s-border-strong'),
      ...[46, 60, 74].map((y) => bar(183, y, 26, 'f-border-strong', 5) + nuqta(215, y + 2.5, 1.6, 'f-text-muted s-text-muted')),
      r(125.5, 86.5, 22, 12, 6, 'f-raised s-border-strong'),
      r(125.5, 86.5, 22, 12, 6, 'f-accent bk-on'),
      '<circle cx="141.5" cy="92.5" r="4" class="f-surface s-border-strong bk-knob"/>',
      pointer('bk-ptr'),
    ],

    /* Record the screen: a live chip, a progress strip grows, the frame shrinks into a film tile. 3600 ms. */
    record: () => {
      const screen = () => `<g transform="translate(16 29)">${[
        pageBack(0, 0, 150, 86, 5, 26),
        picture(8.5, 19.5, 50, 30),
        bar(68, 21, 60), bar(68, 32, 48), bar(68, 43, 30),
        bar(8.5, 58, 120), bar(8.5, 68, 86),
        g('rc-live', r(116, 2, 28, 8, 4, 'f-accent-soft') + dot(121, 6, 2, 'f-live') + bar(126, 4.5, 13, 'f-accent-ink', 3)),
        g('rc-prog', r(5, 78, 140, 3, 1.5, 'f-live')),
        pageEdge(0, 0, 150, 86, 5),
      ].join('')}</g>`;
      return [
        screen(),
        r(174.5, 29.5, 53, 85, 6, 'f-surface s-border'),
        tile(180, 34), tile(180, 61),
        r(180.5, 88.5, 39, 22, 2.5, 'x-line s-border'),
        g('rc-thumb', screen()),
        g('rc-play', dot(200, 99.5, 6, 'f-text') + p('M198 96.5L203 99.5L198 102.5Z', 'f-surface')),
      ];
    },

    /* Check another size: laptop, tablet, phone in two steps; the blocks re-stack at each width. 3600 ms. */
    viewport: () => [
      g('vp-a', [
        pageBack(20, 12, 200, 94, 6, 28),
        picture(28.5, 31.5, 64, 36),
        bar(102, 34, 90), bar(102, 45, 76), bar(102, 56, 50),
        ...[28.5, 91.5, 154.5].map((x) => r(x, 76.5, 57, 21, 4, 'f-raised s-border') + bar(x + 6, 84, 36, 'f-border-strong', 5)),
        pageEdge(20, 12, 200, 94),
      ].join('')),
      g('vp-b', [
        pageBack(60, 12, 120, 94, 6, 24),
        picture(68.5, 30.5, 103, 30),
        bar(68, 66, 90), bar(68, 76, 64),
        ...[68.5, 122.5].map((x) => r(x, 86.5, 49, 14, 3, 'f-raised s-border') + bar(x + 5, 91, 26, 'f-border-strong', 4)),
        pageEdge(60, 12, 120, 94),
      ].join('')),
      g('vp-c', [
        pageBack(92, 12, 56, 94, 8, 16),
        picture(98.5, 29.5, 43, 24),
        bar(98, 59, 44), bar(98, 68, 34), bar(98, 77, 40),
        r(98.5, 86.5, 43, 14, 3, 'f-raised s-border'), bar(103, 91, 22, 'f-border-strong', 4),
        pageEdge(92, 12, 56, 94, 8),
      ].join('')),
      /* the size picker: laptop | tablet | phone, the chosen one on the accent tint */
      r(84.5, 113.5, 71, 19, 9.5, 'f-surface s-border'),
      g('vp-hl', r(86, 115, 22, 16, 8, 'f-accent-soft')),
      g('x-line s-text', r(91, 118.5, 12, 8, 1.5, '') + p('M89 128.5H105', '')),
      r(116, 117.5, 8, 11, 1.5, 'x-line s-text'),
      r(140.5, 118, 5, 10, 1.2, 'x-line s-text'),
    ],

    /* Check page speed: the needle sweeps to its mark, then three timing bars fill in turn. 3400 ms. */
    perf: () => [
      r(16.5, 16.5, 103, 111, 8, 'f-surface s-border'),
      bar(26, 27, 40, 'f-text'),
      p('M32 88A36 36 0 0 1 104 88', 'x-line s-border', 7),
      p('M32 88A36 36 0 0 1 90.95 60.26', 'x-line s-pass', 7),
      `<g transform="translate(68 88)">${g('pf-needle', p('M0 0H28', 'x-line s-text', 2) + dot(0, 0, 4, 'f-text'))}</g>`,
      bar(52, 102, 32, 'f-text-muted', 5),
      r(127.5, 16.5, 96, 111, 8, 'f-surface s-border'),
      ...[[30, 56], [62, 34], [94, 66]].map(([y, w], i) => bar(136, y, 28, 'f-text-muted', 5)
        + r(136, y + 11, 78, 6, 3, 'f-surface-sunken')
        + bar(136, y + 11, w, `f-text pf-b${i + 1}`)),
    ],

    /* Measure code coverage: code appears, the lines that ran get a pass gutter, coverage fills to two-thirds. 3200 ms. */
    whitebox: () => {
      const lines = [[0, 72, 1], [12, 98, 1], [12, 64, 0], [24, 86, 0], [12, 56, 1], [0, 34, 1], [0, 80, 0]];
      const ys = lines.map((l, i) => 21 + i * 11.5);
      return [
        r(16.5, 12.5, 207, 94, 6, 'f-surface s-border'),
        cm(g('wb-code', lines.map(([ind, w], i) => bar(34, ys[i], 7, 'f-border', 5) + bar(48 + ind, ys[i], w, 'f-border-strong', 5)).join(''))
          + g('wb-ran', lines.map(([ind, w, ran], i) => (ran ? r(24, ys[i] - 1.5, 3, 8, 1.5, 'f-pass') + bar(48 + ind, ys[i], w, 'f-text', 5) : '')).join(''))),
        r(16.5, 113.5, 207, 18, 6, 'f-surface s-border'),
        r(24, 120, 150, 5, 2.5, 'f-surface-sunken'),
        r(24, 120, 100, 5, 2.5, 'f-pass wb-cov'),
      ];
    },

    /* Design the values: the field splits into three ranges, a value drops into each, the boundaries flash. 3400 ms. */
    blackbox: () => [
      r(52.5, 30.5, 135, 18, 4, 'f-raised s-border-strong'), bar(59, 36.5, 40, 'f-text'),
      p('M120 53V67M116 63L120 67L124 63', 'x-line s-border-strong', 1.5),
      ...[32, 93, 154].map((x) => r(x + 0.5, 80.5, 53, 12, 6, 'f-raised s-border-strong')),
      g('bb-whole', r(32.5, 80.5, 175, 12, 6, 'f-raised s-border-strong')),
      g('bb-halo', r(84.5, 71, 10, 30, 5, 'f-accent-soft') + r(145.5, 71, 10, 30, 5, 'f-accent-soft')),
      g('bb-bound', p('M89.5 73V100M150.5 73V100', 'x-line s-accent', 2)),
      ...[59, 120, 181].map((x, i) => g(`bb-n${i + 1}`, nuqta(x, 86.5, 3.2, 'f-text s-text'))),
      ...[46, 107, 168].map((x) => bar(x, 102, 26, 'f-text-muted', 4)),
    ],

    /* Try nasty values: the pointer clicks a field; long, Arabic and empty cross-fade through it; empty gets a warn ring. 4000 ms. */
    inject: () => [
      pageBack(24, 12, 192, 120, 6, 28),
      bar(40, 34, 40, 'f-text-muted', 5),
      g('ij-field', r(40.5, 42.5, 159, 18, 4, 'f-raised s-border-strong')
        + g('ij-v1', bar(46, 48.5, 148, 'f-text'))
        + g('ij-v2', bar(150, 48.5, 44, 'f-text') + bar(118, 48.5, 28, 'f-text') + dot(160, 57.5, 1, 'f-text') + dot(131, 57.5, 1, 'f-text'))
        + g('ij-v3', p('M47 47V56', 'x-line s-text', 1.2))),
      g('ij-ring', ring(37.5, 39.5, 165, 24, 6, 's-warn') + bar(40, 67, 80, 'f-warn-ink', 5)),
      bar(40, 82, 32, 'f-text-muted', 5),
      field(40, 90, 160, 18), bar(46, 96, 64),
      r(40, 116, 44, 11, 3, 'f-text'), bar(48, 118.5, 28, 'f-surface'),
      pageEdge(24, 12, 192, 120),
      pointer('ij-ptr'),
    ],

    /* Fill the form: fields fill from the top; the last stays empty and gets a warn mark. 3200 ms. */
    autofill: () => [
      pageBack(36, 10, 168, 124, 6, 26),
      ...[30, 54, 78, 102].map((y) => bar(48, y + 4.5, 26, 'f-text-muted', 5) + field(84, y, 108, 14)),
      ...[[30, 60], [54, 44], [78, 72]].map(([y, w], i) => bar(90, y + 4, w, `f-text af-f${i + 1}`)),
      g('af-warn', ring(81.5, 99.5, 113, 19, 5, 's-warn') + warnMark(183, 109.5, '')),
      pageEdge(36, 10, 168, 124),
    ],

    /* Harvest the page: rings land on every control, then a row per control stacks into the list. 3600 ms. */
    harvest: () => {
      const controls = [[24.5, 32.5, 95, 12, 3], [24.5, 50.5, 95, 12, 3], [24.5, 68.5, 9, 9, 2], [24.5, 84.5, 64, 12, 3], [24, 104, 40, 12, 3]];
      return [
        pageBack(16, 14, 112, 116, 6, 24),
        r(24.5, 32.5, 95, 12, 3, 'f-raised s-border-strong'), bar(29, 35.5, 34),
        r(24.5, 50.5, 95, 12, 3, 'f-raised s-border-strong'), bar(29, 53.5, 26),
        r(24.5, 68.5, 9, 9, 2, 'f-raised s-border-strong'), tick(29, 73, 2.4, 's-text', 1.2), bar(38, 70.5, 40, 'f-border-strong', 5),
        r(24.5, 84.5, 64, 12, 3, 'f-raised s-border-strong'), bar(29, 87.5, 30), p('M78 89L81 92L84 89', 'x-line s-text-muted', 1.2),
        r(24, 104, 40, 12, 3, 'f-text'), bar(31, 107, 26, 'f-surface'),
        pageEdge(16, 14, 112, 116),
        `<g class="hv-rings" stroke-width="1.5">${controls.map(([x, y, w, h, rx]) => r(x - 2.5, y - 2.5, w + 5, h + 5, rx + 2.5, 'x-line s-p-any')).join('')}</g>`,
        r(136.5, 14.5, 91, 115, 6, 'f-surface s-border'),
        bar(144, 22, 30, 'f-text'),
        ...[44, 36, 28, 40, 32].map((w, i) => g(`hv-r${i + 1}`, r(144, 38 + i * 18, 10, 10, 3, 'x-line s-p-any') + bar(160, 40.5 + i * 18, w, 'f-text', 5))),
      ];
    },

    /* Send a request: a request card slides to the server, a response slides back with a pass badge. 3600 ms. */
    api: () => [
      pageBack(16, 24, 72, 96, 6, 20),
      bar(23, 44, 50), bar(23, 54, 40),
      field(23, 66, 58, 12), bar(27, 69, 26),
      r(23, 86, 30, 11, 3, 'f-text'), bar(29, 88.5, 18, 'f-surface'),
      pageEdge(16, 24, 72, 96),
      p('M88 50H176M88 94H176', 'x-line s-border-strong', 1.5),
      r(176.5, 30.5, 48, 84, 6, 'f-surface s-border-strong'),
      ...[42, 58, 74, 90].map((y) => bar(183, y, 26, 'f-border-strong', 5) + nuqta(215, y + 2.5, 1.6, 'f-text-muted s-text-muted')),
      g('ap-req', r(124.5, 39.5, 46, 22, 4, 'f-surface s-border-strong') + r(129, 45, 14, 10, 3, 'f-accent-soft') + bar(131.5, 47.5, 9, 'f-accent-ink', 5) + bar(147, 47.5, 18, 'f-text', 5)),
      g('ap-res', r(94.5, 83.5, 46, 22, 4, 'f-surface s-border-strong') + bar(100, 92, 20, 'f-text', 5)
        + g('ap-ok', r(124, 88.5, 12, 12, 3, 'f-pass-soft') + tick(130, 94.5, 2.8, 's-pass-ink', 1.3))),
    ],

    /* Reverse-engineer the spec: the page steps aside, a document fills in two columns, one per language. 3800 ms. */
    spec: () => {
      const col = (x0, right, cls) => {
        const at = (w) => (right ? x0 + 48 - w : x0);
        return cm(g(cls, [
          bar(at(34), 36, 34, 'f-text', 5),
          ...[[45, 46], [52, 40], [59, 44], [66, 28]].map(([y, w]) => bar(at(w), y, w, 'f-border-strong', 4)),
          bar(at(30), 78, 30, 'f-text', 5),
          ...[[87, 44], [94, 38], [101, 46], [108, 24]].map(([y, w]) => bar(at(w), y, w, 'f-border-strong', 4)),
        ].join('')));
      };
      return [
        g('sp-page', [
          pageBack(16, 20, 84, 104, 6, 22),
          picture(23.5, 39.5, 69, 30),
          bar(23, 76, 62), bar(23, 86, 48), bar(23, 96, 56),
          r(23, 108, 30, 10, 3, 'f-text'), bar(29, 110.5, 18, 'f-surface'),
          pageEdge(16, 20, 84, 104),
        ].join('')),
        g('sp-doc', r(108.5, 12.5, 119, 119, 6, 'f-surface s-border') + bar(116, 20, 70, 'f-text', 7) + p('M168 36V120', 'x-line s-border', 1)),
        col(116, false, 'sp-c1'),
        col(172, true, 'sp-c2'),
      ];
    },

    /* Check the fine print: a lens passes over the footer; policy, consent and trackers get pass, pass, warn. 3800 ms. */
    fineprint: () => [
      pageBack(16, 12, 124, 120, 6, 26),
      bar(24, 30, 90, 'f-text', 7),
      bar(24, 44, 100), bar(24, 54, 84), bar(24, 64, 94), bar(24, 74, 60),
      p('M16.5 102H139.5', 'x-line s-border', 1),
      bar(24, 109, 22, 'f-text-muted', 4), bar(52, 109, 26, 'f-text-muted', 4), bar(84, 109, 18, 'f-text-muted', 4), bar(108, 109, 22, 'f-text-muted', 4),
      bar(24, 118, 50, 'f-text-muted', 4),
      pageEdge(16, 12, 124, 120),
      r(148.5, 24.5, 79, 96, 6, 'f-surface s-border'),
      bar(156, 32, 36, 'f-text'),
      p('M152 67H224M152 89H224', 'x-line s-border', 1),
      r(156, 50, 8, 10, 1.5, 'x-line s-text-muted'), p('M158 54H162M158 57H161', 'x-line s-text-muted', 1),
      r(155, 73.5, 11, 7, 3.5, 'x-line s-text-muted'), dot(162.5, 77, 1.8, 'f-text-muted'),
      p('M155 99C157 95.5 163 95.5 165 99C163 102.5 157 102.5 155 99Z', 'x-line s-text-muted', 1), dot(160, 99, 1.6, 'f-text-muted'),
      bar(170, 52.5, 30, 'f-text', 5), bar(170, 74.5, 26, 'f-text', 5), bar(170, 96.5, 32, 'f-text', 5),
      tick(216, 55, 3.2, 's-pass fp-m1', 1.6),
      tick(216, 77, 3.2, 's-pass fp-m2', 1.6),
      g('fp-m3', warnMark(216, 99, '')),
      g('fp-lens', '<circle r="10" class="x-line s-text" stroke-width="2"/>' + p('M7.5 7.5L13 13', 'x-line s-text', 3)),
    ],

    /* Stress the layout: text jumps to the other side 40 % longer; one label overruns its box and gets a warn ring. 3600 ms. */
    rtl: () => [
      pageBack(32, 12, 176, 120, 6, 30),
      g('rt-a', bar(44, 30, 60, 'f-text', 7) + [[46, 90], [56, 76], [66, 100], [76, 56]].map(([y, w]) => bar(44, y, w, 'f-border-strong', 5)).join('')),
      g('rt-b', bar(112, 30, 84, 'f-text', 7) + [[46, 126], [56, 106], [66, 140], [76, 78]].map(([y, w]) => bar(196 - w, y, w, 'f-border-strong', 5)).join('')),
      r(164.5, 96.5, 32, 18, 4, 'f-raised s-border-strong'),
      g('rt-la', bar(166.5, 102.5, 28, 'f-text')),
      g('rt-lb', bar(155.5, 102.5, 39, 'f-text')),
      ring(152, 93, 48, 25, 6, 's-warn rt-ring'),
      pageEdge(32, 12, 176, 120),
    ],

    /* File to Jira: the failed finding lifts off the review card and lands as a ticket; its fields fill. 4000 ms. */
    jira: () => {
      const failRow = () => r(24, 58, 92, 14, 3, 'f-fail-soft') + cross(31, 65, 2.3, 's-fail') + bar(38, 62.5, 64, 'f-border-strong', 5);
      return [
        r(16.5, 16.5, 108, 111, 8, 'f-surface s-border'),
        bar(24, 25, 50, 'f-text'),
        ...[[45, 56], [85, 48], [105, 60]].map(([y, w]) => tick(31, y, 2.3, 's-pass', 1.3) + bar(38, y - 2.5, w, 'f-border-strong', 5)),
        failRow(),
        r(132.5, 20.5, 91, 103, 6, 'f-surface s-border'),
        r(140, 28, 10, 10, 2.5, 'f-accent'),
        cm(bar(154, 30, 26, 'f-text-muted')),
        ...[[66, 44], [82, 36], [98, 40]].map(([y, w], i) => bar(140, y, 18, 'f-text-muted', 5) + bar(164, y, w, `f-text jr-f${i + 1}`, 5)),
        g('jr-row', failRow()),
      ];
    },

    /* Draw the flow: the steps become nodes joined in the reading direction, with one decision. 3800 ms. */
    diagram: () => [
      r(16.5, 16.5, 72, 111, 6, 'f-surface s-border'),
      bar(24, 25, 34, 'f-text'),
      ...[[42, 40], [62, 32], [82, 44], [102, 28]].map(([y, w]) => nuqta(28, y + 2.5, 2, 'f-text-muted s-text-muted') + bar(34, y, w, 'f-border-strong', 5)),
      g('dg-n1', r(100, 55, 24, 14, 7, 'f-text')),
      p('M127 62H135M132 59L135 62L132 65', 'x-line s-text-muted dg-c1', 1.3),
      g('dg-n2', r(138.5, 55.5, 30, 13, 3, 'f-surface s-border-strong') + bar(144, 59.5, 19, 'f-border-strong', 5)),
      p('M171 62H179M176 59L179 62L176 65', 'x-line s-text-muted dg-c2', 1.3),
      p('M193 52L205 62L193 72L181 62Z', 'f-surface s-border-strong dg-d'),
      p('M193 75V87M190 84L193 87L196 84', 'x-line s-text-muted dg-c3', 1.3),
      g('dg-n4', r(177, 90, 32, 14, 4, 'f-accent') + bar(185, 94.5, 16, 'f-accent-text', 5)),
    ],
  };

  /* The prototype's ids for the two session explainers. */
  const ALIAS = { 'record-session': 'start', 'read-export': 'report' };

  const svg = (id) => {
    const key = ALIAS[id] || id;
    const draw = Object.prototype.hasOwnProperty.call(SCENES, key) ? SCENES[key] : null;
    return draw
      ? `<svg class="qaw-x" data-scene="${key}" data-loop viewBox="0 0 240 144" aria-hidden="true" focusable="false"><g class="x-root">${draw().join('')}</g></svg>`
      : null;
  };
  const ids = () => Object.keys(SCENES);

  /*
   * Play only while at least half visible, twice, then rest on the poster (an endless loop beside
   * the text being read pulls the eye). `.is-on` sets the animation names in visuals.css; the
   * second play of `x-loop` ends inside the last beat's hold and its animationend drops the class,
   * leaving the same frame. Leaving view drops it too; coming back, hovering, or focusing inside
   * the explainer's card plays it twice again from beat 1.
   */
  let io = null;
  const restart = (el) => {
    el.classList.remove('is-on');
    void el.getBoundingClientRect(); // style flush: the next add starts the loop at 0
    el.classList.add('is-on');
  };
  const play = (root = window.document) => {
    if (!io) {
      const doc = root.ownerDocument || root;
      io = window.IntersectionObserver
        ? new window.IntersectionObserver((entries) => {
          for (const e of entries) e.target.classList.toggle('is-on', e.isIntersecting && e.intersectionRatio >= 0.5);
        }, { threshold: [0, 0.5] })
        : { observe: (el) => el.classList.add('is-on') };
      doc.addEventListener('animationend', (e) => {
        if (e.animationName !== 'x-loop') return;
        const x = e.target.closest && e.target.closest('.qaw-x');
        if (x) x.classList.remove('is-on');
      });
      doc.addEventListener('pointerover', (e) => {
        const x = e.target.closest && e.target.closest('.qaw-x[data-loop]');
        if (x && !x.classList.contains('is-on')) restart(x);
      });
      doc.addEventListener('focusin', (e) => {
        const host = e.target.closest && e.target.closest('.tool-row, .tool-detail, .card, section');
        if (host) host.querySelectorAll('.qaw-x[data-loop]:not(.is-on)').forEach(restart);
      });
    }
    root.querySelectorAll('.qaw-x[data-loop]').forEach((el) => io.observe(el));
  };

  window.UQAScenes = { svg, ids, play };
})();
