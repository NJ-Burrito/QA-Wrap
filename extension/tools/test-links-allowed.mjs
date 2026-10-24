/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// Every outbound link the extension UI, the site and the docs show is on one allowed list (the author's links, the repo, the site).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EXT, '..');
// prefix match on the full URL; badges are images in the README only
const ALLOWED = [
  'https://www.linkedin.com/in/nader-alzghoul',
  'https://github.com/NJ-Burrito',
  'https://nj-burrito.github.io',
  'https://img.shields.io/badge/',
  // QA Wrap's own store and registry listings (published 2026-10-23) and its two directory submissions
  'https://addons.mozilla.org/firefox/addon/qa-wrap/',
  'https://microsoftedge.microsoft.com/addons/detail/nidbfaeniiaagkecgkiapcebojbjfbha', // Edge Add-ons listing, live 2026-10-24
  'https://www.npmjs.com/package/qa-wrap-bridge',
  'https://registry.modelcontextprotocol.io/v0/servers?search=qa-wrap-bridge',
  'https://github.com/punkpeye/awesome-mcp-servers/pull/17378',
  'https://github.com/cline/mcp-marketplace/issues/3206',
];
const SKIP = new Set(['node_modules', 'tools', 'vendor', '.git', 'dist', 'fixtures']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|md)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(EXT), ...walk(path.join(ROOT, 'site')), path.join(ROOT, 'README.md'), path.join(ROOT, 'README.ar.md')];
const consts = ['core/product.js', 'core/rate-links.js', 'options/e1022.js', 'manifest.json'].map((f) => path.join(EXT, f));

test('every outbound link in html and markdown is on the allowed list', () => {
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:href=["']|\]\()(https?:\/\/[^"')\s]+)/g)) {
      if (!ALLOWED.some((a) => m[1].startsWith(a))) bad.push(`${path.relative(ROOT, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every URL constant of the product is on the allowed list', () => {
  const bad = [];
  for (const f of consts) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/["'](https?:\/\/[^"'\s]+)["']/g)) {
      if (m[1].includes('www.w3.org')) continue;
      if (!ALLOWED.some((a) => m[1].startsWith(a))) bad.push(`${path.relative(ROOT, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the website is the GitHub Pages address, in the manifest, the product and Settings', () => {
  const W = 'https://nj-burrito.github.io/QA-Wrap/';
  assert.equal(JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).homepage_url, W);
  assert.match(fs.readFileSync(path.join(EXT, 'core/product.js'), 'utf8'), /homepage: 'https:\/\/nj-burrito\.github\.io\/QA-Wrap\/'/);
  assert.ok(fs.readFileSync(path.join(EXT, 'options/e1022.js'), 'utf8').includes(`WEBSITE_URL = /** @type {string} */ ('${W}')`));
});
