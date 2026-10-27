/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The site's meta CSP and referrer policy (security audit 2026-10-27, site L2). Every page carries a meta CSP whose
 * script-src lists 'self' plus the SHA-256 of each executable inline script on that page, computed from the file as it is now.
 * Change an inline script and this fails until you run:   node tools/test-site-csp.mjs --write
 *   node tools/test-site-csp.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './test-site-powers.mjs';

const SITE = path.join(EXT, '..', 'site');
const write = process.argv.includes('--write');
const pages = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) pages.push(p); } };
walk(SITE);

/** The executable inline scripts of a page: <script> with no src and a JavaScript (or no) type. JSON-LD is data and never runs. */
export const inlineScripts = (html) => [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\ssrc\s*=/i.test(m[1] || '') && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1] || ''))
  .map((m) => m[2]);
const hash = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export const cspFor = (html, rel) => {
  const hashes = [...new Set(inlineScripts(html).map(hash))];
  const worker = rel.replace(/\\/g, '/') === 'try/index.html' ? " worker-src 'self';" : '';
  return `default-src 'self'; script-src 'self'${hashes.length ? ` ${hashes.join(' ')}` : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';${worker}`.replace(/;$/, '');
};
const META_CSP = /[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*">\r?\n/;
const META_REF = /[ \t]*<meta name="referrer" content="[^"]*">\r?\n/;

let n = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

for (const file of pages) {
  const rel = path.relative(SITE, file);
  let html = fs.readFileSync(file, 'utf8');
  const want = `<meta http-equiv="Content-Security-Policy" content="${cspFor(html, rel)}">\n<meta name="referrer" content="strict-origin-when-cross-origin">\n`;
  if (write) {
    html = html.replace(META_CSP, '').replace(META_REF, '');
    html = html.replace(/(<meta charset=[^>]*>\n)/i, `$1${want}`);
    assert.ok(html.includes(want), `${rel}: no <meta charset> to anchor the CSP`);
    fs.writeFileSync(file, html);
  }
  test(`${rel}: meta CSP lists exactly this page's inline script hashes, the referrer policy is set, and the CSP comes before any script`, () => {
    const h = fs.readFileSync(file, 'utf8');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(h);
    assert.ok(csp, 'no meta CSP');
    assert.equal(csp[1], cspFor(h, rel));
    assert.ok(/<meta name="referrer" content="strict-origin-when-cross-origin">/.test(h), 'no referrer meta');
    assert.ok(h.indexOf('Content-Security-Policy') < h.search(/<script/i), 'the CSP must precede every script');
    assert.ok(!/unsafe-eval|script-src[^;]*'unsafe-inline'/.test(csp[1]));
  });
}
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
