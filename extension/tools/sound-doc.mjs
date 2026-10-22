/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Writes ui/SOUNDS.md from ui/sound.js and tools/sound-levels.json, so the document
 * and the code cannot disagree. Run after editing the table or the files:
 *
 *   node tools/sound-measure.mjs && node tools/sound-doc.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
new Function('window', 'document', 'performance', fs.readFileSync(path.join(EXT, 'ui/sound.js'), 'utf8'))(win, { hidden: false }, { now: () => 0 });
const { SOUNDS, EVENTS } = win.UQASound;
const levels = JSON.parse(fs.readFileSync(path.join(EXT, 'tools/sound-levels.json'), 'utf8'));
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

const L = [];
L.push('# QA Wrap UI sounds', '');
L.push('Generated from `ui/sound.js` and `tools/sound-levels.json` by `tools/sound-doc.mjs`; do not edit by hand.', '');
L.push('Twenty-four OGG files, family "Glass & Air": QA Wrap\'s own synthesis with CC0 recorded layers (see `ui/sfx/CREDITS.txt` for each layer\'s author, source, licence and the sha256 of each file). Names with several files (tap 3; shot, on, off, open, close, remove, copy 2 each) play one at random, never the same twice in a row. Fifteen sound names in two scopes: eight **core** moments ("Results and alerts") and seven **touch** sounds (added by "Every click"). Defaults: on, every click, volume 70.', '');
L.push('The files are already loudness-matched per class (moments about -16 to -20 LKFS, touch -23 to -28), so the per-file gain in dB at volume 100 is 0, except `error` at +2.5 so that it is the loudest and most distinct sound in the product, on purpose. Nobody has listened to the set yet; Nader checks it by ear.', '');
L.push('| sound | scope | file | length s | peak | mean | trim dB | final peak | final mean |', '|---|---|---|---|---|---|---|---|---|');
for (const [name, s] of Object.entries(SOUNDS)) {
  for (const f of s.files) {
    const m = levels[f.file];
    L.push(`| ${name} | ${s.scope} | ${f.file} | ${m.duration.toFixed(3)} | ${r1(m.peak)} | ${r1(m.mean)} | ${r1(f.trim)} | ${r1(m.peak + f.trim)} | ${r1(m.mean + f.trim)} |`);
  }
}
L.push('', '## Events', '', 'A call site names *what happened* (`UQASound.play(\'jira.filed\')`), never a sound; this map is the only place the two meet.', '', '| event | sound |', '|---|---|');
for (const [event, name] of Object.entries(EVENTS)) L.push(`| \`${event}\` | ${name} |`);
L.push('', '## Rules of play', '',
  '1. The same sound is dropped inside 60 ms of itself.',
  '2. A touch sound is dropped when a different sound started within 120 ms; a moment never is.',
  '3. At most three at once; over that the oldest touch sound is released over about 15 ms.',
  '4. A hidden page, a disabled setting, a scope mismatch, `suspended` (microphone hot) and "not decoded yet" play nothing. A hidden page hands a moment to the worker (`UQA_CUE`).',
  '5. The in-page toolbar plays no sound (its files are not web-accessible); the offscreen document plays moments for finished jobs and gets no `AUDIO_PLAYBACK` reason.', '');
fs.writeFileSync(path.join(EXT, 'ui/SOUNDS.md'), `${L.join('\n')}\n`);
console.log(`ui/SOUNDS.md: ${Object.keys(SOUNDS).length} sounds, ${Object.keys(EVENTS).length} events`);
