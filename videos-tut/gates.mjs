/* QA Wrap tutorials: the text gates that need no model and no render.
 *   node videos-tut/gates.mjs
 * - Arabic visible text (lines, strings, captions in built projects): no tashkeel, no Persian letters, no Latin punctuation next to Arabic.
 * - Pace: English <= 2.5 words/s, Arabic <= 1.9 words/s inside each line's slot (the voice step stretches within 0.85-1.25 only).
 * - Slots are ordered, inside the film, and leave a breath between lines.
 * - ar_tts, where present, differs from the visible Arabic by tashkeel only (letters unchanged) and carries marks.
 * - Built projects: caption text equals the script's chunks (nothing captioned that is not narrated).
 * Exit 1 on any failure. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunks } from './chunks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const TASHKEEL = /[ً-ْٰـ]/; // marks and tatweel
const PERSIAN = /[پچژگکیۀےھ]/;
const LATINPUNCT_NEAR_AR = /[؀-ۿ][,;?]|[,;?][\s]*[؀-ۿ]/;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
let fails = 0; let checks = 0;
const bad = (w, m) => { fails++; console.log(`  FAIL ${w}: ${m}`); };
const ok = () => { checks++; };
const arText = (s) => (PERSIAN.test(s) ? 'Persian letter' : TASHKEEL.test(s) ? 'visible tashkeel/tatweel' : LATINPUNCT_NEAR_AR.test(s) ? 'Latin punctuation in Arabic' : null);

for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.json')).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
  const w = m.id;
  for (const k of ['title', 'blurb']) { const e = arText(m[k].ar); e ? bad(`${w}.${k}.ar`, e) : ok(); }
  for (const [k, v] of Object.entries(m.strings || {})) { const e = arText(v.ar); e ? bad(`${w}.strings.${k}.ar`, e) : ok(); }
  for (const s of m.onscreen || []) { const ar = s.split(' / ')[1]; if (ar) { const e = arText(ar); e ? bad(`${w}.onscreen`, `${ar}: ${e}`) : ok(); } }
  let prevEnd = 0;
  for (const L of m.lines) {
    const id = `${w}.${L.id}`;
    const e = arText(L.ar); e ? bad(`${id}.ar`, e) : ok();
    const slot = L.end - L.start;
    const enR = words(L.en) / slot; const arR = words(L.ar) / slot;
    enR <= 2.5 ? ok() : bad(id, `English ${enR.toFixed(2)} words/s over 2.5`);
    arR <= 1.9 ? ok() : bad(id, `Arabic ${arR.toFixed(2)} words/s over 1.9`);
    (L.start >= prevEnd + 0.4 && L.end <= m.dur - 3) ? ok() : bad(id, `slot ${L.start}-${L.end} not ordered, not breathing or into the end card`);
    prevEnd = L.end;
    if (L.ar_tts) {
      const strip = (s) => s.replace(/[ً-ْٰ]/g, '').replace(/[\s،؟.«»:؛!]/g, '');
      strip(L.ar_tts).replace('خمسمائة', '500') === strip(L.ar) ? ok() : bad(id, `ar_tts letters differ from ar: ${strip(L.ar_tts)} vs ${strip(L.ar)}`);
      (L.ar_tts.match(/[ً-ْ]/g) || []).length >= words(L.ar) ? ok() : bad(id, 'ar_tts is not fully voweled');
    }
  }
  if (m.dur < 40 || m.dur > 60) bad(w, `duration ${m.dur} outside 40-60`); else ok();
  // built projects: caption text = narration chunks
  for (const lang of ['en', 'ar']) {
    const p = path.join(HERE, `${w}-${lang}`, 'index.html');
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    const caps = [...html.matchAll(/<div class="cap" id="cap-(L\d+)-(\d+)">([^<]*)<\/div>/g)].map((x) => [x[1], +x[2], x[3]]);
    const want = m.lines.flatMap((L) => chunks(L[lang]).map((c, i) => [L.id, i, c]));
    JSON.stringify(caps) === JSON.stringify(want) ? ok() : bad(`${w}-${lang}`, 'captions differ from narration chunks');
    if (lang === 'ar') for (const c of caps) { const e = arText(c[2]); e ? bad(`${w}-ar caption ${c[0]}`, e) : ok(); }
    // the whole page's visible Arabic text
    if (lang === 'ar') {
      const vis = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
      const e = arText(vis); e ? bad(`${w}-ar page`, e) : ok();
    }
  }
}
console.log(`\n${checks} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
