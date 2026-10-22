/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The contact sheet for the film masters.
 *
 * `deliverables/tutorials/` keeps the full-quality originals — the ones to hand
 * to a marketing team or drop into a deck. The extension ships compressed
 * copies of the same films, and its own page inside the product is the one a
 * tester sees. This page exists so the masters can be reviewed without loading
 * the extension.
 *
 * It is generated from `tutorials/lessons.json`, so it cannot drift from what
 * was actually recorded: a film that is not in the manifest does not appear,
 * and a manifest entry with no file says so plainly instead of rendering a
 * broken player.
 */
import { BRAND } from './lib-brand.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const OUT = path.resolve(EXT, '..', 'deliverables', 'tutorials');

const lessons = JSON.parse(fs.readFileSync(path.join(EXT, 'tutorials', 'lessons.json'), 'utf8'));
const kb = (f) => {
  const p = path.join(OUT, f);
  return fs.existsSync(p) ? `${Math.round(fs.statSync(p).size / 1024)} KB` : null;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * What each `kind` is called on a figure.
 *
 * `tool` is the third value, added when the set grew from six films to
 * twenty-two: one commercial, five overview features, and one film for each of
 * the sixteen tools in the popup. Sixteen figures all captioned "Feature"
 * would have made the contact sheet unreadable at exactly the moment it became
 * worth reading. An unknown kind still reads "Feature", which is what every
 * non-trailer entry read before.
 */
const KIND = { trailer: 'The product', feature: 'Feature', category: 'A group of tools', tool: 'Tool' };

/*
 * The chapter list, with the tool names read out of the shared table.
 *
 * A category film is two to three minutes long and a reviewer's question is
 * "where in it is the thing I care about". `lessons.json` carries the seek
 * points and names each one by its i18n key rather than by a copy of the
 * English, so this sheet and the product's own page cannot print different
 * words for the same chapter.
 */
const EN = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'en.json'), 'utf8'));
const chapters = (l) => (l.chapters?.length
  ? `<ol class="chapters">${l.chapters.map((c) => `<li><b>${mmss(Math.floor(c.t))}</b> ${EN[c.titleKey] || c.titleKey}</li>`).join('')}</ol>`
  : '');

const total = lessons.reduce((n, l) => n + l.secs, 0);
const missing = [];

const figure = (l) => {
  // Whatever languages the manifest actually names — the films are English
  // only today and were bilingual last week, and a page that hard-codes the
  // list breaks on whichever version it did not expect.
  const rows = Object.keys(l.files).map((lang) => {
    const file = l.files[lang];
    const size = kb(file);
    if (!size) { missing.push(file); return `<p class="gone">${file} — not in this folder</p>`; }
    return `<div class="take">
      <p class="lang">${{ en: 'American English', ar: 'Arabic — Jordanian' }[lang] || lang} <small>${size}</small></p>
      <video controls preload="none" poster="${l.poster}"><source src="${file}" type="video/mp4"></video>
    </div>`;
  }).join('\n      ');

  return `  <figure>
    <figcaption>
      <p class="kind">${KIND[l.kind] || 'Feature'} · ${mmss(l.secs)}</p>
      <b>${l.en}</b> <bdi dir="rtl">${l.ar}</bdi>
      <span>${l.blurb}</span>
      ${chapters(l)}
    </figcaption>
    <div class="takes">
      ${rows}
    </div>
  </figure>`;
};

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>QA Wrap — the films</title>
<style>
 :root{color-scheme:light dark}
 body{margin:0;padding:40px;background:#F1EFE9;color:#1D2024;font-family:Thmanyah Sans,system-ui,sans-serif}
 h1{font-size:30px;margin:0 0 4px}
 .sub{color:#5D646B;margin:0 0 6px;max-width:70ch;line-height:1.6}
 .note{color:#7A8188;margin:0 0 30px;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:24px;max-width:1400px}
 figure{margin:0;background:#FAF8F4;border:1px solid #DAD6CD;border-radius:14px;overflow:hidden;padding:16px}
 figcaption{padding:0 2px 14px;font-size:14px;line-height:1.5}
 .kind{margin:0 0 4px;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#B5432B}
 figcaption b{font-size:17px} figcaption span{display:block;color:#5D646B;margin-top:4px}
 bdi{color:#5D646B;font-weight:600;margin-inline-start:8px}
 .takes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
 .lang{margin:0 0 5px;font-size:11.5px;font-weight:600;color:#5D646B}
 .lang small{font-weight:500;color:#8A9096;margin-inline-start:6px}
 video{width:100%;display:block;border-radius:8px;background:#1D2024}
 .gone{color:#B5432B;font-size:12px}
 .chapters{margin:8px 0 0;padding-inline-start:0;list-style:none;columns:2;font-size:12px;color:#5D646B}
 .chapters li{margin:0 0 2px;break-inside:avoid}
 .chapters b{color:#B5432B;font-variant-numeric:tabular-nums;margin-inline-end:6px}
 footer{margin-top:34px;color:#7A8188;font-size:12px}
 @media (max-width:720px){.takes{grid-template-columns:1fr}}
</style>
<h1>QA Wrap — the films</h1>
<p class="sub">The full-quality masters. Each one was
recorded from the extension driving itself through a real session: the same
buttons a tester presses, the same report at the end.</p>
<p class="note">${lessons.length} films · ${mmss(total)} in all · the product ships compressed copies of these.</p>
<div class="grid">
${lessons.map(figure).join('\n')}
</div>
<footer>${BRAND.name} · ${BRAND.madeBy.en.replace('{maker}', BRAND.publisher.en)}</footer>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log(`wrote deliverables/tutorials/index.html — ${lessons.length} films, ${mmss(total)}`);

/*
 * The manifest, copied beside the masters rather than kept by hand.
 *
 * `deliverables/tutorials/lessons.json` existed as a hand copy and had been
 * one film behind since the moment a fifth feature was recorded: five entries
 * next to six masters, in the folder a marketing team is handed. A manifest
 * nobody regenerates goes stale the first time the set changes, and this one
 * did — so it is now written here, where the contact sheet that reads the same
 * source is written, byte for byte from `tutorials/lessons.json` as it stands
 * at this moment. Copied rather than re-serialised: a re-serialisation is a
 * second opinion about formatting, and two files that are meant to be
 * identical should be identical.
 */
fs.copyFileSync(path.join(EXT, 'tutorials', 'lessons.json'), path.join(OUT, 'lessons.json'));
console.log(`wrote deliverables/tutorials/lessons.json — copied from tutorials/lessons.json`);
if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
