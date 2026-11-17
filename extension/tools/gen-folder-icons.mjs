/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The folder icons: brand/folder-icons/*.ico and their map (folders.json), drawn here and rasterised in headless Chromium.
 *
 *   node tools/gen-folder-icons.mjs                 write the .ico files and folders.json
 *   node tools/gen-folder-icons.mjs --preview <png> also shoot one sheet of every icon at the sizes Explorer shows, on a light and a dark ground
 *
 * One icon for the QA Wrap folder itself (the mark), one per category in core/filing.js CATEGORIES (the glyph is the product's own
 * icon for that thing, from ui/icons.js). Windows shows a folder icon from 16 px (details view, the tree) to 256 px (extra large
 * icons), so every .ico carries ten sizes and two drawings. From 32 px up it is the folder with a paper edge and the product's
 * line glyph. Under 32 px a line glyph is mush, so the folder is a flat shape on a 16 grid and the glyph is a block drawing, one
 * cell per pixel at 16 (PIXELS below). Nothing is scaled from one bitmap: each size is drawn at its own size.
 *
 * The updater host (updater/host.ps1, op "icons") puts them on the download folders. Icons go on folders only, never on files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CATEGORIES } from '../core/filing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'brand', 'folder-icons');
// The top image is 256. The shell takes the first entry whose directory size is 0 and scales it itself, so a 512 there is
// downsampled by Explorer and comes out softer at 256 than a 256 drawn at 256; at 320 both are the same (measured 2026-11-17
// through SHDefExtractIcon). The blur seen on 3.10.1 was Explorer's icon cache, which the hashed file names below fix.
export const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'ui/icons.js'), 'utf8'), sandbox);
const GLYPHS = sandbox.window.UQAIcons;

/** Category (the key in CATEGORIES) -> the product icon that already means it. */
const GLYPH_OF = {
  report: 'open-report',
  ticket: 'tag-bug',
  test: 'export-playwright',
  sheet: 'export-sheet',
  screenshot: 'tool-shot',
  recording: 'tool-record',
  accessibility: 'tool-a11y',
  docs: 'tool-spec',
  sessions: 'timeline',
};

/** The same nine things as blocks, 8 cells by 6: what a 16 px icon can carry. Keyed like GLYPH_OF. */
const PIXELS = {
  report: ['.#####..', '.######.', '.#....#.', '.######.', '.#....#.', '.######.'],
  ticket: ['...##...', '...##...', '..####..', '..####..', '.######.', '.######.'],
  test: ['..#..#..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..#..#..'],
  sheet: ['########', '#..#...#', '########', '#..#...#', '########', '........'],
  screenshot: ['##....##', '#......#', '...##...', '...##...', '#......#', '##....##'],
  recording: ['########', '#......#', '#..##..#', '########', '...##...', '..####..'],
  accessibility: ['...##...', '.######.', '...##...', '...##...', '..#..#..', '.#....#.'],
  docs: ['###..###', '#..##..#', '#..##..#', '#..##..#', '########', '........'],
  sessions: ['........', '........', '##.##.##', '##.##.##', '........', '........'],
};

// The identity's own colours (ui/identity-tokens.css, brand/mark.svg): ochre, its ink, the pale tint, the mark's ink and its red.
const C = { back: '#633F0B', top: '#B27A22', front: '#8E5A10', edge: '#D9A451', paper: '#F8EBD8', glyph: '#FFF7EA', ink: '#1D2024', check: '#B5432B' };
const MARK = '<g transform="translate(-2 1)" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
  `<path stroke="${C.ink}" d="M45.01 37.98 A17 17 0 1 0 34.97 46.26"/><path stroke="${C.check}" d="M36 36L42.5 44L55 20"/></g>`;

/** One icon as SVG on a 64 grid. `glyph` is ui/icons.js markup (24 grid) or null for the mark. */
function svg(glyph, size, kind) {
  if (size < 32) return svgSmall(kind, size);
  const small = false;
  // The folder: a back with its tab, then the front panel. Small sizes fill more of the square and drop the paper edge.
  const m = small ? 3 : 6; // margin
  const r = small ? 5 : 4;
  const top = small ? 9 : 10;
  const fold = small ? 21 : 21;
  const back = `<path d="M${m} ${top + r}a${r} ${r} 0 0 1 ${r}-${r}h${small ? 15 : 14.3}a4 4 0 0 1 3 1.4l3.1 3.6H${64 - m - r}a${r} ${r} 0 0 1 ${r} ${r}v${small ? 34 : 33}a${r} ${r} 0 0 1-${r} ${r}H${m + r}a${r} ${r} 0 0 1-${r}-${r}z" fill="${C.back}"/>`;
  const paper = small ? '' : `<rect x="${m + 4}" y="17" width="${64 - 2 * m - 8}" height="10" rx="2" fill="${C.paper}"/>`;
  const bottom = small ? 58 : 56;
  const front = `<path d="M${m} ${fold + r}a${r} ${r} 0 0 1 ${r}-${r}h${64 - 2 * m - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${bottom - fold - 2 * r}a${r} ${r} 0 0 1-${r} ${r}H${m + r}a${r} ${r} 0 0 1-${r}-${r}z" fill="url(#f)"/>`;
  const edge = size >= 48 ? `<path d="M${m + r} ${fold + 1.2}h${64 - 2 * m - 2 * r}" stroke="${C.edge}" stroke-opacity=".75" stroke-width="1.2" stroke-linecap="round"/>` : '';
  const cx = 32;
  const cy = (fold + bottom) / 2 + (small ? 0 : 0.5);
  let art;
  if (glyph == null) {
    // The QA Wrap folder: the mark in its own colours on a pale disc.
    const d = small ? 15 : 13.5; // disc radius
    const k = (d * 1.5) / 64;
    art = `<circle cx="${cx}" cy="${cy}" r="${d}" fill="${C.glyph}"/><g transform="translate(${cx - 32 * k} ${cy - 32 * k}) scale(${k})">${MARK}</g>`;
  } else {
    const box = small ? 32 : 26; // the glyph's 24 grid, on the 64 grid
    const k = box / 24;
    const w = small ? 2.5 : size < 64 ? 2.2 : 2;
    art = `<g transform="translate(${cx - box / 2} ${cy - box / 2}) scale(${k})" fill="none" stroke="${C.glyph}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="color:${C.glyph}">${glyph}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.top}"/><stop offset="1" stop-color="${C.front}"/></linearGradient></defs>${back}${paper}${front}${edge}${art}</svg>`;
}

/** Under 32 px: a flat folder on a 16 grid, and the block glyph (the mark's red check on a pale disc for the QA Wrap folder itself). */
function svgSmall(kind, size) {
  const rows = PIXELS[kind];
  const art = rows
    ? rows.map((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${4 + x}" y="${7 + y}" width="1" height="1"/>` : '')).join('')).join('')
    : `<circle cx="8" cy="10" r="3.4"/><path d="M6.5 10.1l1.2 1.4 2-3.3" fill="none" stroke="${C.check}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}"${size === 16 ? ' shape-rendering="crispEdges"' : ''}>` +
    `<path d="M1 3a1 1 0 0 1 1-1h4l1.5 2H14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="${C.back}"/>` +
    `<path d="M1 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="${C.front}"/>` +
    `<g fill="${C.glyph}"${rows ? '' : ' shape-rendering="geometricPrecision"'}>${art}</g></svg>`;
}

/** An .ico from [{ size, rgba (Uint8 RGBA, top-down), png (Buffer) }]: 32-bit bitmaps under 32 px (the sizes old shell code reads raw), PNG from 32 up (a tenth of the bytes). */
export function ico(images) {
  const blobs = images.map(({ size, rgba, png }) => {
    if (size >= 32) return png;
    const maskRow = Math.ceil(size / 32) * 4;
    const head = Buffer.alloc(40);
    head.writeUInt32LE(40, 0); head.writeInt32LE(size, 4); head.writeInt32LE(size * 2, 8); // height counts the mask too
    head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14); head.writeUInt32LE(size * size * 4 + maskRow * size, 20);
    const px = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = (y * size + x) * 4;
        const d = ((size - 1 - y) * size + x) * 4; // bottom-up, BGRA
        px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s]; px[d + 3] = rgba[s + 3];
      }
    }
    return Buffer.concat([head, px, Buffer.alloc(maskRow * size)]); // the mask is all zero: alpha decides
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let at = dir.length;
  images.forEach(({ size }, i) => {
    const e = 6 + 16 * i;
    dir.writeUInt8(size >= 256 ? 0 : size, e); dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(blobs[i].length, e + 8); dir.writeUInt32LE(at, e + 12);
    at += blobs[i].length;
  });
  return Buffer.concat([dir, ...blobs]);
}

/** file name -> glyph markup (null = the mark), and the map the host reads. */
export function plan() {
  const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const icons = { 'qa-wrap.ico': { glyph: null, kind: null } };
  const folders = {};
  for (const [kind, name] of Object.entries(CATEGORIES)) {
    const id = GLYPH_OF[kind];
    if (!id || !GLYPHS[id]) throw new Error(`no glyph for the category "${kind}" (${name}): add it to GLYPH_OF`);
    if (!PIXELS[kind]) throw new Error(`no block drawing for the category "${kind}": add it to PIXELS`);
    icons[`${slug(name)}.ico`] = { glyph: GLYPHS[id], kind };
    folders[name] = `${slug(name)}.ico`;
  }
  return { icons, map: { root: 'qa-wrap.ico', folders } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { icons, map } = plan();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const raster = (markup, size) => page.evaluate(async ({ markup, size }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, size, size);
      return { rgba: size < 32 ? Array.from(g.getImageData(0, 0, size, size).data) : [], png: c.toDataURL('image/png').split(',')[1] };
    }, { markup, size });
    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.ico')) fs.rmSync(path.join(OUT, f)); // generated, and the hashed names change
    for (const [file, { glyph, kind }] of Object.entries(icons)) {
      const images = [];
      for (const size of SIZES) {
        const r = await raster(svg(glyph, size, kind), size);
        images.push({ size, rgba: Uint8Array.from(r.rgba), png: Buffer.from(r.png, 'base64') });
      }
      // The name carries a hash of the bytes. Explorer caches a folder icon by path, so new art under an old name is never shown;
      // a new name rewrites every desktop.ini (updater/host.ps1) and Explorer reads the new file.
      const bytes = ico(images);
      const named = file.replace(/\.ico$/, `-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.ico`);
      fs.writeFileSync(path.join(OUT, named), bytes);
      if (map.root === file) map.root = named;
      for (const k of Object.keys(map.folders)) if (map.folders[k] === file) map.folders[k] = named;
    }
    fs.writeFileSync(path.join(OUT, 'folders.json'), `${JSON.stringify(map, null, 2)}\n`);
    console.log(`${Object.keys(icons).length} icons, ${SIZES.length} sizes each -> ${path.relative(root, OUT)}`);

    const at = process.argv.indexOf('--preview');
    if (at > 0) {
      // The small sizes magnified pixel for pixel (what Explorer's list and tree show), then 48 and 96 as they are.
      const cell = async (glyph, kind, s, zoom) => `<img src="data:image/png;base64,${(await raster(svg(glyph, s, kind), s)).png}" width="${s * zoom}" height="${s * zoom}" style="image-rendering:pixelated">`;
      const rows = [];
      for (const [file, { glyph, kind }] of Object.entries(icons)) {
        const cells = [];
        for (const [s, zoom] of [[16, 5], [20, 4], [24, 4], [32, 3], [16, 1], [24, 1], [48, 1], [96, 1]]) cells.push(await cell(glyph, kind, s, zoom));
        rows.push(`<div style="display:flex;align-items:end;gap:14px"><span style="width:110px;font:12px sans-serif">${file}</span>${cells.join('')}</div>`);
      }
      const half = (ground, ink) => `<div style="background:${ground};color:${ink};padding:12px;display:grid;gap:8px">${rows.join('')}</div>`;
      await page.setViewportSize({ width: 1500, height: 1200 });
      await page.setContent(`<body style="margin:0;display:flex">${half('#ffffff', '#000')}${half('#202124', '#fff')}</body>`);
      await page.locator('body').screenshot({ path: process.argv[at + 1] });
    }
  } finally {
    await browser.close();
  }
}
