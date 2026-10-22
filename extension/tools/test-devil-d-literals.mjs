// Devil point 13: no user-visible English literal in the on-page overlay scripts.
// A literal assigned to textContent/innerText/title/placeholder/aria-label, or passed
// straight to flash(), must go through t(). Run from extension/: node tools/test-devil-d-literals.mjs
//
// P6 (test pipeline, 12 Oct 2026): the file list is every content/*.js found on disk (it was an 11-name list that
// left autopilot.js, replay-buffer.js, page-hooks.js, selector-engine.js, spec-reader.js and ui-host.js unscanned), a
// discovery that finds nothing is red, an ALLOWED entry must name a file and a snippet that still exist, and the scan
// proves it has teeth on a known-bad source before it reads the real files.
import fs from 'node:fs';
import { assert, nonEmpty, proveTeeth, ok, finish } from './lib-assert.mjs';

const DIR = new URL('../content/', import.meta.url);
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
// file:snippet -> reason. Keep this list short; each entry must say why it is not user-visible text.
const ALLOWED = {
  'rtl-stress.js:style.textContent': 'CSS source injected into a <style>, not text shown to the tester',
  "replay-buffer.js:H.t('buffer.pill'": 'goes through t(): H.t(key, fallback) with the same English only as the fallback when the helper is absent',
};

const LIT = String.raw`(?:'[^'\n]+'|"[^"\n]+"|\x60[^\x60]*\x60)`;
const RES = [
  new RegExp(String.raw`\b([\w.]+)\.(?:textContent|innerText|title|placeholder|ariaLabel)\s*=\s*(${LIT})`, 'g'),
  new RegExp(String.raw`setAttribute\(\s*['"](?:aria-label|title|placeholder)['"]\s*,\s*(${LIT})`, 'g'),
  new RegExp(String.raw`\bflash\(\s*(${LIT})`, 'g'),
];

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');

/** Literal hits of a (comment-stripped) source: [{ line, hit }]. */
function literalsIn(code) {
  const out = [];
  for (const re of RES) {
    for (const m of code.matchAll(re)) out.push({ line: code.slice(0, m.index).split('\n').length, hit: m[0].slice(0, 90) });
  }
  return out;
}

{
  nonEmpty(FILES, 'content/*.js files');
  proveTeeth('the literal scan', (src) => literalsIn(strip(src)), "el.textContent = 'Visible English text';\nflash('Saved');");

  // An ALLOWED entry that names a missing file, or a snippet nothing matches any more, is stale: red.
  const used = new Set();
  let bad = 0;
  let scanned = 0;
  for (const f of FILES) {
    const file = `${f}.js`;
    const code = strip(fs.readFileSync(new URL(file, DIR), 'utf8'));
    scanned++;
    for (const { line, hit } of literalsIn(code)) {
      const key = Object.keys(ALLOWED).find((k) => k.startsWith(`${file}:`) && hit.includes(k.slice(file.length + 1)));
      if (key) { used.add(key); continue; }
      console.log(`LITERAL ${file}:${line}  ${hit}`);
      bad++;
    }
  }
  for (const k of Object.keys(ALLOWED)) {
    const file = k.slice(0, k.indexOf(':'));
    ok(FILES.includes(file.replace(/\.js$/, '')), `ALLOWED names a file that exists: ${file}`);
    ok(used.has(k), `ALLOWED entry still matches a literal: ${k}`);
  }
  assert.ok(scanned === FILES.length && scanned >= 15, `scanned ${scanned} content scripts (expected every one on disk, at least 15)`);
  ok(bad === 0, `${scanned} content scripts scanned, ${bad} unlisted literal(s)`);
  console.log(bad ? `FAIL ${bad} unlisted literal(s)` : `PASS 0 unlisted literals in ${scanned} scripts`);
  finish('test-devil-d-literals');
}
