/* =============================================================================
   QA Wrap identity — watermarks that can be found.

     node tools/watermark.mjs            stamp every asset in logo/, icons/, dist/
     node tools/watermark.mjs --verify   read the marks back and report

   Copyright exists the moment the work is made; a watermark is evidence. The
   useful properties are that it survives a copy, that the owner can find it,
   and that it does not damage the asset. Three layers, in every file:

   DECLARED    rights metadata anyone can read. SVG: <metadata> with Dublin
               Core (creator, rights, identifier). PNG: tEXt chunks — Author,
               Copyright, Comment — which Explorer, Preview and ExifTool show.

   VERIFIABLE  a token in that metadata: the SHA-256 of the owner line and the
               asset's own drawing. Edit the drawing and the token no longer
               matches — the mark fails rather than lies. (Same idea as
               extension/lib/provenance.js for exports.)

   HIDDEN      a signature nobody sees. SVG: an extra path of zero opacity
               whose coordinates spell the owner's initials in code points —
               it survives re-export by every tool that keeps paths. PNG: the
               owner string in the least significant bit of the blue channel
               of the first pixels of the ground. Invisible; readable here.

   The visible, creative mark is the seal (logo/seal.svg) and the star cut
   into the foil; those are the identity's own and need no hiding.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { meta } from './tokens.source.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('../../extension/node_modules/pngjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YEAR = new Date().getFullYear();
const OWNER = `© ${YEAR} ${meta.owner}. All rights reserved.`;
/* Goes into <dc:identifier> on every watermarked asset, where a reader who
   opens the file sees it. It read 'nj-burrito'; the identity names one product
   and one owner (BRAND.md §2). No asset carries the old value, so nothing that
   was signed with it needs re-verifying. */
const ID = 'qa-wrap';
const VERIFY = process.argv.includes('--verify');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);

/* ── SVG ─────────────────────────────────────────────────────────────── */

/** The drawing alone: the file with our own marks and comments removed. */
const drawingOf = (svg) =>
  svg
    .replace(/<metadata[\s\S]*?<\/metadata>\s*/g, '')
    .replace(/<path id="qaw-sig"[^>]*\/>\s*/g, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The product code as a path: Q=81, A=65, W=87, in the coordinates. Zero opacity, zero size. */
const hiddenPath = () => {
  const cps = [...`QAW${YEAR}`].map((c) => c.charCodeAt(0));
  const d = 'M' + cps.map((c, i) => `${(c / 100).toFixed(2)} ${(i * 0.01).toFixed(2)}`).join('L');
  return `<path id="qaw-sig" d="${d}" fill="none" stroke="none" opacity="0" aria-hidden="true"/>`;
};

const metadataFor = (svg, file) => {
  const token = sha(OWNER + '|' + path.basename(file) + '|' + drawingOf(svg));
  return `<metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <rdf:Description rdf:about="">
        <dc:title>${path.basename(file, '.svg')}</dc:title>
        <dc:creator>${meta.owner}</dc:creator>
        <dc:rights>${OWNER}</dc:rights>
        <dc:identifier>${ID}:${token}</dc:identifier>
        <dc:source>identity/tools — QA Wrap identity</dc:source>
      </rdf:Description>
    </rdf:RDF>
  </metadata>`;
};

function stampSvg(file) {
  let svg = fs.readFileSync(file, 'utf8');
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>\s*/g, '').replace(/\s*<path id="qaw-sig"[^>]*\/>/g, '');
  const open = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const stamped = svg.slice(0, open) + '\n  ' + metadataFor(svg, file) + '\n  ' + hiddenPath() + svg.slice(open);
  fs.writeFileSync(file, stamped, 'utf8');
  return true;
}

function verifySvg(file) {
  const svg = fs.readFileSync(file, 'utf8');
  // Built from ID, not repeated: a hardcoded copy here is how a rename of the
  // identifier above silently stops every asset verifying.
  const m = svg.match(new RegExp(`<dc:identifier>${ID}:([0-9a-f]+)</dc:identifier>`));
  const hidden = /<path id="qaw-sig"/.test(svg);
  if (!m) return { declared: false, hidden, verified: false };
  const expected = sha(OWNER + '|' + path.basename(file) + '|' + drawingOf(svg));
  return { declared: true, hidden, verified: m[1] === expected };
}

/* ── PNG ─────────────────────────────────────────────────────────────── */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const tEXt = (key, text) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]));
const iTXt = (key, text) =>
  chunk('iTXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0, 0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from(text, 'utf8')]));

/** Walk the chunks of a PNG buffer. */
function* chunks(buf) {
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    yield { type, data: buf.subarray(p + 8, p + 8 + len), start: p, end: p + 12 + len };
    p += 12 + len;
  }
}

/** The owner string, one bit per pixel, in the blue channel's lowest bit. */
const SIG = `${ID}:${meta.owner}`;
function writeLsb(png) {
  const bits = [...Buffer.from(SIG, 'utf8')].flatMap((b) => [...Array(8)].map((_, i) => (b >> (7 - i)) & 1));
  // 16 bits of length first, then the bytes.
  const len = bits.length;
  const all = [...Array(16)].map((_, i) => (len >> (15 - i)) & 1).concat(bits);
  for (let i = 0; i < all.length && i * 4 + 2 < png.data.length; i++) {
    png.data[i * 4 + 2] = (png.data[i * 4 + 2] & 0xfe) | all[i];
  }
}
function readLsb(png) {
  const bit = (i) => png.data[i * 4 + 2] & 1;
  let len = 0;
  for (let i = 0; i < 16; i++) len = (len << 1) | bit(i);
  if (!len || len > 4096) return null;
  const bytes = [];
  for (let b = 0; b < len / 8; b++) {
    let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 1) | bit(16 + b * 8 + i);
    bytes.push(v);
  }
  return Buffer.from(bytes).toString('utf8');
}

function stampPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  writeLsb(png);
  const encoded = PNG.sync.write(png);
  // Insert the text chunks after IHDR.
  const out = [];
  let inserted = false;
  const pixelsHash = sha(png.data.toString('base64'));
  out.push(encoded.subarray(0, 8));
  for (const c of chunks(encoded)) {
    if (c.type === 'tEXt' || c.type === 'iTXt') continue; // ours from a previous run
    out.push(encoded.subarray(c.start, c.end));
    if (c.type === 'IHDR' && !inserted) {
      out.push(tEXt('Author', meta.owner));
      out.push(iTXt('Copyright', OWNER));
      out.push(tEXt('Software', 'QA Wrap identity/tools/watermark.mjs'));
      out.push(tEXt('Comment', `${ID}:${sha(OWNER + '|' + path.basename(file) + '|' + pixelsHash)}`));
      inserted = true;
    }
  }
  fs.writeFileSync(file, Buffer.concat(out));
  return true;
}

function verifyPng(file) {
  const buf = fs.readFileSync(file);
  let comment = null;
  for (const c of chunks(buf)) {
    if (c.type === 'tEXt' && c.data.subarray(0, 7).toString('latin1') === 'Comment') comment = c.data.subarray(8).toString('latin1');
  }
  const png = PNG.sync.read(buf);
  const hidden = readLsb(png);
  const expected = comment ? `${ID}:${sha(OWNER + '|' + path.basename(file) + '|' + sha(png.data.toString('base64')))}` : null;
  return { declared: !!comment, hidden: hidden === SIG, verified: !!comment && comment === expected };
}

/* ── run ─────────────────────────────────────────────────────────────── */

const files = [];
for (const dir of ['logo', 'icons', 'dist']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (/\.(svg|png)$/i.test(f) && !f.startsWith('_')) files.push(path.join(d, f));
}

let bad = 0;
for (const f of files) {
  const isSvg = f.endsWith('.svg');
  if (!VERIFY) (isSvg ? stampSvg : stampPng)(f);
  const r = (isSvg ? verifySvg : verifyPng)(f);
  const ok = r.declared && r.hidden && r.verified;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${path.relative(ROOT, f).padEnd(34)} declared:${r.declared ? 'y' : 'n'} hidden:${r.hidden ? 'y' : 'n'} verified:${r.verified ? 'y' : 'n'}`);
}
console.log(`\n${VERIFY ? 'verified' : 'stamped and verified'} ${files.length} asset(s)${bad ? `, ${bad} not carrying a full mark` : ''}`);
process.exit(bad ? 1 : 0);
