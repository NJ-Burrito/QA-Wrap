/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Measures the shipped sound files and writes tools/sound-levels.json.
 *
 *   node tools/sound-measure.mjs          (needs ffmpeg and ffprobe on PATH)
 *
 * Peak and mean come from ffmpeg's volumedetect, duration from ffprobe, the hash
 * from the file as shipped. tools/test-sound.mjs reads sound-levels.json, so the suite
 * itself needs no ffmpeg; run this again whenever a file is added or swapped,
 * then set the file's `trim` in ui/sound.js from the rule in that file's header.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(EXT, 'ui', 'sfx');
const out = {};
for (const file of fs.readdirSync(DIR).filter((f) => /\.(ogg|wav)$/.test(f)).sort()) {
  const full = path.join(DIR, file);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full], { encoding: 'utf8' });
  const det = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', full, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const peak = Number(/max_volume: (-?[\d.]+)/.exec(det)?.[1]);
  const mean = Number(/mean_volume: (-?[\d.]+)/.exec(det)?.[1]);
  if (!Number.isFinite(peak) || !Number.isFinite(mean)) throw new Error(`no level for ${file}`);
  const bytes = fs.readFileSync(full);
  out[file] = {
    duration: Math.round(Number(probe) * 1000) / 1000,
    peak, mean, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
fs.writeFileSync(path.join(EXT, 'tools', 'sound-levels.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`tools/sound-levels.json: ${Object.keys(out).length} files`);
