/* =============================================================================
   QA Wrap identity — the brand board.

     node tools/brand-board.mjs

   One image that shows the whole system: the mark, how it is built, the
   product in use, the promise, the colours, the type, a physical piece, the
   image direction and the small system details. Nine panels on a basalt
   canvas, the way an identity studio presents a brand — sparse, one idea per
   panel, everything from the same assets the product ships with.

     dist/brand-board.svg     the board, as vector
     dist/brand-board.png     the same at 2×, by Playwright

   Nothing is drawn twice: the mark, the lockups and the type come from the
   generated files in logo/, so the board cannot drift from the product.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { brand, meta } from './tokens.source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.resolve(ROOT, '../extension');
const require = createRequire(path.join(EXT, 'package.json'));

const inner = (file) => {
  const svg = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/<style>[\s\S]*?<\/style>/g, '');
};
const vb = (file) => { const m = fs.readFileSync(path.join(ROOT, file), 'utf8').match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return { w: +m[1], h: +m[2] }; };
const place = (file, x, y, w, extra = '') => { const b = vb(file); const k = w / b.w; return `<g transform="translate(${x} ${y}) scale(${k.toFixed(4)})" ${extra}>${inner(file)}</g>`; };

const P = { ink: '#1D2024', paper: '#F1EFE9', card: '#FAF8F4', petra: '#B5432B', guac: '#2A7A3B', corn: '#E2AE38', ochre: '#8E5A10', tortilla: '#D8C6A4', slate: '#7A8188', line: '#DAD6CD', canvas: '#141719' };
const RH = 300; // extra row height: the 16px-actual-size panel (I04)
const W = 1800, H = 1350 + RH + 28, GUT = 28, PAD = 40;
const cw = (W - PAD * 2 - GUT * 2) / 3;
const ch = (1350 - PAD * 2 - GUT * 2 - 46) / 3;
const cell = (c, r) => ({ x: PAD + c * (cw + GUT), y: PAD + 46 + r * (ch + GUT), w: cw, h: ch });
// full-width row, below the 3x3 grid
const rowCell = () => ({ x: PAD, y: PAD + 46 + 3 * (ch + GUT), w: W - PAD * 2, h: RH });
const EXTICONS = path.resolve(ROOT, '../extension/icons').replace(/\\/g, '/');
const fileUrl = (abs) => `file:///${abs}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const F = `font-family="Thmanyah Sans, system-ui, sans-serif"`;
const panel = (c, r, fill, body, label) => { const b = cell(c, r); return `<g transform="translate(${b.x} ${b.y})"><rect width="${b.w}" height="${b.h}" rx="18" fill="${fill}"/>${body(b)}<text x="18" y="${b.h - 16}" ${F} font-size="11" letter-spacing="2" fill="${fill === P.ink || fill === P.petra ? 'rgba(255,255,255,.55)' : P.slate}">${esc(label)}</text></g>`; };

const parts = [];
parts.push(`<rect width="${W}" height="${H}" fill="${P.canvas}"/>`);
parts.push(`<text x="${PAD}" y="${PAD + 18}" ${F} font-size="13" letter-spacing="3" fill="rgba(255,255,255,.55)">QA WRAP · BRAND SYSTEM · ${new Date().getFullYear()}</text>`);
parts.push(`<text x="${W - PAD}" y="${PAD + 18}" text-anchor="end" ${F} font-size="13" letter-spacing="3" fill="rgba(255,255,255,.55)">BY ${meta.publisher.toUpperCase()} · AMMAN EDITION</text>`);

// 1 — logo cover
parts.push(panel(0, 0, P.paper, (b) => `${place('logo/qa-wrap-lockup-stacked.svg', b.w / 2 - 150, b.h / 2 - 150, 300)}`, '01 — MARK AND LOCKUP'));

// 2 — construction: the mark on a grid with its geometry
parts.push(panel(1, 0, P.card, (b) => {
  const g = []; const s = 24;
  for (let x = 40; x < b.w - 20; x += s) g.push(`<line x1="${x}" y1="40" x2="${x}" y2="${b.h - 50}" stroke="${P.line}" stroke-width=".6"/>`);
  for (let y = 40; y < b.h - 50; y += s) g.push(`<line x1="40" y1="${y}" x2="${b.w - 20}" y2="${y}" stroke="${P.line}" stroke-width=".6"/>`);
  g.push(place('logo/mark.svg', b.w / 2 - 130, b.h / 2 - 140, 260));
  g.push(`<circle cx="${b.w / 2}" cy="${b.h / 2 - 10}" r="132" fill="none" stroke="${P.petra}" stroke-width="1" stroke-dasharray="4 4"/>`);
  g.push(`<line x1="${b.w / 2 - 150}" y1="${b.h / 2 - 10}" x2="${b.w / 2 + 150}" y2="${b.h / 2 - 10}" stroke="${P.petra}" stroke-width="1"/>`);
  g.push(`<text x="${b.w / 2 + 150}" y="${b.h / 2 + 4}" ${F} font-size="11" fill="${P.petra}">r 17</text>`);
  g.push(`<text x="40" y="${b.h - 46}" ${F} font-size="12" fill="${P.slate}">Ring r 17 on a 64 grid · one stroke, 7 · seam 45° ± 28° · the check leaves through it</text>`);
  return g.join('');
}, '02 — CONSTRUCTION'));

// 3 — digital application: the popup as a frame
parts.push(panel(2, 0, P.ink, (b) => {
  const x = 60, y = 40, w = b.w - 120, h = b.h - 96;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${P.paper}"/>
    <rect x="${x}" y="${y}" width="${w}" height="44" rx="14" fill="${P.card}"/><rect x="${x}" y="${y + 30}" width="${w}" height="14" fill="${P.card}"/>
    ${place('logo/mark.svg', x + 14, y + 10, 24)}<text x="${x + 46}" y="${y + 28}" ${F} font-size="15" font-weight="800" fill="${P.ink}">QA Wrap</text><text x="${x + 116}" y="${y + 28}" ${F} font-size="10" fill="${P.slate}">${meta.byline}</text>
    <rect x="${x + 14}" y="${y + 60}" width="${w - 28}" height="40" rx="10" fill="${P.petra}"/><text x="${x + w / 2}" y="${y + 86}" text-anchor="middle" ${F} font-size="14" font-weight="700" fill="#fff">Start recording</text>
    ${[['Photograph the page', P.card], ['Record the screen', P.card], ['Check accessibility', P.card], ['Check page speed', P.card], ['Harvest the page', P.card], ['Draw the flow', P.card]].map(([t, f], i) => { const cx = x + 14 + (i % 2) * ((w - 28) / 2 + 8); const cy = y + 112 + Math.floor(i / 2) * 54; return `<rect x="${cx}" y="${cy}" width="${(w - 36) / 2}" height="46" rx="10" fill="${f}" stroke="${P.line}"/><circle cx="${cx + 20}" cy="${cy + 23}" r="7" fill="none" stroke="${P.ink}" stroke-width="1.75"/><text x="${cx + 36}" y="${cy + 27}" ${F} font-size="11.5" font-weight="600" fill="${P.ink}">${esc(t)}</text>`; }).join('')}
    <text x="${x + 14}" y="${y + h - 14}" ${F} font-size="10" fill="${P.slate}">Every failure, traced. · nothing leaves this machine</text>`;
}, '03 — IN THE BROWSER'));

// 4 — the promise
parts.push(panel(0, 1, P.petra, (b) => `<text x="40" y="${b.h / 2 - 20}" ${F} font-size="54" font-weight="800" fill="#fff" letter-spacing="-1">Every failure,</text><text x="40" y="${b.h / 2 + 40}" ${F} font-size="54" font-weight="800" fill="#fff" letter-spacing="-1">traced.</text><text x="40" y="${b.h / 2 + 84}" ${F} font-size="15" fill="rgba(255,255,255,.8)">كل خطأ، وأثره.</text>`, '04 — THE PROMISE'));

// 5 — colour
parts.push(panel(1, 1, P.card, (b) => {
  const sw = [['Petra', brand.petra.light, 'failure · the one action'], ['Guac', brand.guac.light, 'pass'], ['Corn', brand.corn.light, 'highlight'], ['Wadi Rum', brand.wadirum.light, 'blocked'], ['Tortilla', brand.tortilla.light, 'the foil'], ['Limestone', brand.limestone.light, 'ground by day'], ['Basalt', brand.basalt.light, 'ink by day']];
  const colw = (b.w - 80) / 4;
  return sw.map(([n, hex, use], i) => { const cx = 40 + (i % 4) * colw; const cy = 36 + Math.floor(i / 4) * 152; return `<rect x="${cx}" y="${cy}" width="${colw - 14}" height="84" rx="12" fill="${hex}" stroke="${P.line}"/><text x="${cx}" y="${cy + 106}" ${F} font-size="13" font-weight="700" fill="${P.ink}">${n}</text><text x="${cx}" y="${cy + 120}" ${F} font-size="10.5" fill="${P.slate}">${hex}</text><text x="${cx}" y="${cy + 134}" ${F} font-size="10.5" fill="${P.slate}">${use}</text>`; }).join('') + `<text x="${b.w - 40}" y="${b.h - 34}" text-anchor="end" ${F} font-size="12" fill="${P.slate}">Results carry colour. Nothing else does.</text>`;
}, '05 — COLOUR'));

// 6 — type
parts.push(panel(2, 1, P.paper, (b) => `<text x="40" y="96" ${F} class="disp" font-size="56" font-weight="700" fill="${P.ink}" letter-spacing="-1">Thmanyah</text><text x="40" y="150" ${F} font-size="30" font-weight="800" fill="${P.ink}">Aa Bb Cc 0123</text><text x="${b.w - 40}" y="150" text-anchor="start" direction="rtl" ${F} font-size="30" font-weight="800" fill="${P.ink}">أ ب ت ث ٠١٢٣</text><text x="40" y="196" ${F} font-size="16" font-weight="500" fill="${P.ink}">Sans 400 · 500 · 700, Serif Display 400 · 700. Arabic and English, both first-class.</text><text x="${b.w - 40}" y="232" text-anchor="start" direction="rtl" ${F} font-size="16" font-weight="500" fill="${P.ink}">خط واحد للعربية والإنجليزية، كلاهما أساسي.</text><text x="40" y="${b.h - 70}" ${F} font-size="12" fill="${P.slate}">Display (Serif) 700 · headings 700 · body 400–500 · labels 500 · figures tabular</text>`, '06 — TYPE'));

// 7 — physical: a sticker and a badge
parts.push(panel(0, 2, P.tortilla, (b) => `<circle cx="${b.w / 2 - 110}" cy="${b.h / 2 - 10}" r="112" fill="${P.paper}" stroke="${P.ink}" stroke-width="3"/>${place('logo/mark.svg', b.w / 2 - 110 - 64, b.h / 2 - 10 - 80, 128)}<text x="${b.w / 2 - 110}" y="${b.h / 2 + 70}" text-anchor="middle" ${F} font-size="16" font-weight="800" fill="${P.ink}">QA Wrap</text>
  <rect x="${b.w / 2 + 40}" y="${b.h / 2 - 90}" width="200" height="160" rx="14" fill="${P.ink}"/>${place('logo/mark-mono.svg', b.w / 2 + 110, b.h / 2 - 76, 60, 'style="color:#F1EFE9"')}<text x="${b.w / 2 + 140}" y="${b.h / 2 + 20}" text-anchor="middle" ${F} font-size="14" font-weight="700" fill="#F1EFE9">TESTER</text><text x="${b.w / 2 + 140}" y="${b.h / 2 + 42}" text-anchor="middle" ${F} font-size="10" fill="rgba(241,239,233,.7)">QAW-3.1.0</text>`, '07 — STICKER AND BADGE'));

// 8 — image direction: Petra bands, limestone, basalt
parts.push(panel(1, 2, P.ink, (b) => {
  const bands = [P.petra, '#C9563C', '#D8C6A4', '#F1EFE9', '#8E5A10', '#1D2024'];
  return bands.map((c, i) => `<path d="M0 ${b.h * (0.25 + i * 0.11)} C ${b.w * 0.3} ${b.h * (0.18 + i * 0.11)}, ${b.w * 0.6} ${b.h * (0.34 + i * 0.11)}, ${b.w} ${b.h * (0.22 + i * 0.11)} V${b.h} H0 Z" fill="${c}" opacity=".92"/>`).join('') + `<text x="40" y="70" ${F} font-size="22" font-weight="700" fill="#F1EFE9">Sandstone, limestone, basalt.</text><text x="40" y="96" ${F} font-size="12" fill="rgba(241,239,233,.75)">Landscapes and materials, never stock people. Halftone over photographs.</text>`;
}, '08 — IMAGE DIRECTION'));

// 9 — system detail: chips, a status line, the recording dot
parts.push(panel(2, 2, P.card, (b) => `${[['PASS', P.guac], ['FAIL', P.petra], ['BLOCKED', P.ochre], ['SKIPPED', P.slate]].map(([t, c], i) => `<rect x="${40 + i * 118}" y="46" width="104" height="30" rx="15" fill="none" stroke="${c}" stroke-width="1.5"/><text x="${92 + i * 118}" y="66" text-anchor="middle" ${F} font-size="12" font-weight="700" fill="${c}">${t}</text>`).join('')}
  <rect x="40" y="104" width="${b.w - 80}" height="48" rx="12" fill="${P.paper}" stroke="${P.line}"/><circle cx="64" cy="128" r="6" fill="${P.petra}"/><text x="82" y="133" ${F} font-size="13" font-weight="600" fill="${P.ink}">Recording · 14 steps · 1 failure linked to its cause</text>
  <rect x="40" y="170" width="${b.w - 80}" height="48" rx="12" fill="${P.paper}" stroke="${P.line}"/><rect x="52" y="182" width="24" height="24" rx="6" fill="${P.guac}"/><text x="88" y="199" ${F} font-size="13" font-weight="600" fill="${P.ink}">Saved 12 files, filed by shelf and category.</text>
  <text x="40" y="256" ${F} font-size="12" font-weight="600" fill="${P.ink}">page.getByRole('button', { name: 'Submit application', exact: true })</text>
  <text x="40" y="${b.h - 46}" ${F} font-size="12" fill="${P.slate}">A dot records. A ring succeeds. A shake refuses. Sound off by default.</text>`, '09 — SYSTEM DETAIL'));

// 10 — the mark at the one size every user actually sees (I04): 16/32px,
// shipped raster (extension/icons), both grounds, plus a 4x pixelated
// blow-up of the 16 so a collision there cannot hide behind board-size art.
{
  const rb = rowCell();
  const grounds = [{ bg: P.paper, fg: P.ink, label: 'LIGHT GROUND' }, { bg: P.ink, fg: P.paper, label: 'DARK GROUND' }];
  const gw = (rb.w - GUT) / 2;
  const row10 = grounds.map((g, gi) => {
    const gx = gi * (gw + GUT);
    const icon16 = fileUrl(`${EXTICONS}/icon16.png`);
    const icon32 = fileUrl(`${EXTICONS}/icon32.png`);
    let x = 24;
    const items = [];
    // 1x actual-size row
    for (const [href, size, label] of [[icon16, 16, '16px'], [icon32, 32, '32px']]) {
      items.push(`<image href="${href}" x="${x}" y="${rb.h - 40 - size}" width="${size}" height="${size}" style="image-rendering:pixelated"/><text x="${x + size / 2}" y="${rb.h - 14}" text-anchor="middle" ${F} font-size="10" fill="${g.fg}" opacity=".7">${label}</text>`);
      x += size + 32;
    }
    // 4x nearest-neighbour blow-up of the 16 — the shape a real toolbar user never gets to zoom into
    const zx = x + 20, zs = 64;
    items.push(`<rect x="${zx - 8}" y="16" width="${zs + 16}" height="${zs + 16}" fill="none" stroke="${g.fg}" stroke-width="1" opacity=".35"/>`);
    items.push(`<image href="${icon16}" x="${zx}" y="24" width="${zs}" height="${zs}" style="image-rendering:pixelated"/><text x="${zx + zs / 2}" y="${24 + zs + 18}" text-anchor="middle" ${F} font-size="10" fill="${g.fg}" opacity=".7">16px × 4, nearest-neighbour</text>`);
    return `<g transform="translate(${gx} 0)"><rect width="${gw}" height="${rb.h}" rx="18" fill="${g.bg}"/>${items.join('')}<text x="18" y="24" ${F} font-size="11" letter-spacing="2" fill="${g.fg}" opacity=".55">${g.label}</text></g>`;
  }).join('');
  parts.push(`<g transform="translate(${rb.x} ${rb.y})">${row10}<text x="0" y="${rb.h + 20}" ${F} font-size="11" letter-spacing="2" fill="${P.slate}">10 — THE MARK AT ITS ACTUAL SIZE (SHIPPED PIXELS, NOT BOARD SIZE)</text></g>`);
}

parts.push(`<text x="${W - PAD}" y="${H - 14}" text-anchor="end" ${F} font-size="11" fill="rgba(255,255,255,.4)">© ${new Date().getFullYear()} ${esc(meta.owner)}. Generated from identity/logo by tools/brand-board.mjs.</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n<style>text{font-family:'Thmanyah Sans',system-ui,sans-serif}.disp{font-family:'Thmanyah Serif Display',serif}</style>\n${parts.join('\n')}\n</svg>\n`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/brand-board.svg'), svg, 'utf8');
console.log('  dist/brand-board.svg ' + (svg.length / 1024).toFixed(1) + ' KB');

const { chromium } = require('playwright');
const fontCss = fs.readFileSync(path.join(EXT, 'ui/fonts.css'), 'utf8').replace(/url\((['"]?)fonts\//g, `url($1file:///${EXT.replace(/\\/g, '/')}/ui/fonts/`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await p.setContent(`<style>${fontCss}body{margin:0}</style>${svg}`, { waitUntil: 'load' });
await p.waitForTimeout(700);
await p.screenshot({ path: path.join(ROOT, 'dist/brand-board.png') });
await b.close();
console.log('  dist/brand-board.png (2×)');
