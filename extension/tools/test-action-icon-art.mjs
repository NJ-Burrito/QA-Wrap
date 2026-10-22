/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1014 B1, bug 3: the toolbar icon never reverts to older artwork, in any state.
 *
 *   node tools/test-action-icon-art.mjs
 *
 * The icon the toolbar shows is either the manifest's own PNGs (idle, asleep, after a stop: `stopRecordingIcon` reads them from the
 * manifest, never from a path written in code) or one of the recording frames the worker draws. The frames used to paint a
 * terracotta tile with limestone strokes, the identity's first cut, so the moment a session started the toolbar changed to an older
 * mark. Part 1 holds the palette in action-icon.js equal to the identity files the PNGs come from and finds no literal icon path
 * handed to setIcon; part 2 renders the real frames in Chromium and compares their colour makeup with each manifest PNG.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { workerSrc } from './lib-worker-src.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');

/* Part 1: the source. */
const icon = read('background', 'action-icon.js');
const art = /export const ART = Object\.freeze\(\{ plate: '(#[0-9A-Fa-f]{6})', ring: '(#[0-9A-Fa-f]{6})', check: '(#[0-9A-Fa-f]{6})' \}\)/.exec(icon);
check(!!art, 'action-icon.js declares the artwork as one ART object');
const small = fs.readFileSync(path.join(EXT, '..', 'identity', 'icons', 'app-icon-small.svg'), 'utf8');
const idPlate = /<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(small)?.[1];
const idStrokes = [...small.matchAll(/stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
check(art && idPlate && art[1].toUpperCase() === idPlate.toUpperCase(), 'the plate colour equals the identity icon\'s plate', `${art?.[1]} vs ${idPlate}`);
check(art && idStrokes.includes(art[2].toUpperCase()) && idStrokes.includes(art[3].toUpperCase()), 'the ring and check colours are the identity icon\'s strokes', `${art?.slice(2)} vs ${idStrokes}`);
const mark = read('brand', 'mark.svg');
check(art && mark.toLowerCase().includes(art[2].toLowerCase()) && mark.toLowerCase().includes(art[3].toLowerCase()), 'and the in-product mark (brand/mark.svg) uses the same two');
const marks = fs.readFileSync(path.join(EXT, '..', 'identity', 'tools', 'marks.mjs'), 'utf8');
const nudge = /nudge:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(marks);
const mine = /nudge:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(icon);
check(nudge && mine && nudge[1] === mine[1] && nudge[2] === mine[2], 'the mark sits where marks.mjs puts it (optical nudge)', `${mine?.slice(1)} vs ${nudge?.slice(1)}`);
check(!/fillStyle = '#?B5432B'|fillStyle = TILE|const TILE/.test(icon), 'no terracotta tile fill is left in the frame drawing');

const worker = workerSrc() + '\n' + icon;
const setIcons = [...worker.matchAll(/chrome\.action\.setIcon\(\{([^}]*)\}\)/g)].map((m) => m[1].trim());
check(setIcons.length >= 2 && setIcons.every((a) => a === 'imageData' || a === 'path'), 'setIcon is only ever given the drawn frame or the manifest path', JSON.stringify(setIcons));
check(/function manifestIcon\(\)\s*\{\s*return chrome\.runtime\.getManifest\(\)\?\.action\?\.default_icon/.test(icon), 'the resting icon is read from the manifest, not repeated in code');
check(!/setIcon\(\{[^}]*['"`]icons\//.test(worker) && !/path:\s*['"`]/.test(worker.split('setIcon')[0] + ''), 'no icon path is written into the worker');

/* Part 2: the real frames against the real PNGs. */
let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'icon-art' });
  const result = await h.popup.evaluate(async (artColours) => {
    const { buildFrames, SIZES } = await import(chrome.runtime.getURL('background/action-icon.js'));
    const manifest = chrome.runtime.getManifest().action.default_icon;
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const near = (px, c, tol) => hex(c).every((v, i) => Math.abs(px[i] - v) <= tol);
    const makeup = (data, size) => {
      const n = { plate: 0, ring: 0, check: 0, total: 0 };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (x > size * 0.55 && y > size * 0.55) continue; // the state-badge corner, drawn on the frames only
        const i = (y * size + x) * 4;
        if (data[i + 3] < 128) continue;
        const px = [data[i], data[i + 1], data[i + 2]];
        n.total++;
        if (near(px, artColours.check, 48)) n.check++; else if (near(px, artColours.ring, 48)) n.ring++; else if (near(px, artColours.plate, 20)) n.plate++;
      }
      return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === 'total' ? v : Number((v / n.total).toFixed(3))]));
    };
    const frames = buildFrames();
    const out = { frames: frames.length, sizes: {} };
    for (const size of SIZES) {
      const key = String(size);
      const png = await createImageBitmap(await (await fetch(chrome.runtime.getURL(manifest[key]))).blob());
      const cv = new OffscreenCanvas(size, size);
      const ctx = cv.getContext('2d');
      ctx.drawImage(png, 0, 0, size, size);
      const base = makeup(ctx.getImageData(0, 0, size, size).data, size);
      out.sizes[size] = { manifest: base, frame: frames.map((f) => makeup(f[size].data, size)) };
    }
    return out;
  }, art ? { plate: art[1], ring: art[2], check: art[3] } : { plate: '#F1EFE9', ring: '#1D2024', check: '#B5432B' });
  check(result.frames === 8, 'ready: eight recording frames were drawn in a real browser', String(result.frames));
  for (const [size, r] of Object.entries(result.sizes)) {
    check(r.manifest.plate > 0.4, `${size}px: the manifest icon is a light plate (${r.manifest.plate} plate)`, JSON.stringify(r.manifest));
    for (const [i, f] of r.frame.entries()) {
      const dPlate = Math.abs(f.plate - r.manifest.plate);
      const dRing = Math.abs(f.ring - r.manifest.ring);
      // The old tile read as 90% terracotta; the artwork is a light plate with a thin ring and check.
      const ok = f.plate > 0.4 && f.check < 0.3 && dPlate < 0.18 && dRing < 0.14;
      if (!ok || i === 0) check(ok, `${size}px frame ${i}: same artwork as the manifest icon (plate ${f.plate} vs ${r.manifest.plate}, ring ${f.ring} vs ${r.manifest.ring}, check ${f.check} vs ${r.manifest.check})`);
    }
  }
  check(h.errors.length === 0, 'no page error', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
