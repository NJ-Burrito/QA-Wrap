/* Writes extension/tutorials/lessons.json: the commercial first, then the six tutorials, from videos-tut/src/*.json.
 * A tutorial is `pending` (not drawn on the page) until both its EN and AR masters exist in site/media/tutorials/.
 *   node videos-tut/gen-lessons.mjs
 * File names are relative to the site's media folder: the page builds https://.../media/<file> and picks en or ar by the UI language. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const MEDIA = path.join(REPO, 'site', 'media');
const films = fs.readdirSync(path.join(HERE, 'src')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(HERE, 'src', f), 'utf8'))).sort((a, b) => a.no - b.no);

const out = [{
  id: 'qa-wrap',
  kind: 'trailer',
  ar: 'كيو إيه راب',
  en: 'QA Wrap in 40 seconds',
  blurb: { en: 'The whole product in under a minute: what it records, what it proves, and what you hand over.', ar: 'المنتج كله في أقل من دقيقة: ما يسجله، وما يثبته، وما تسلمه.' },
  files: { en: 'qa-wrap-commercial-40s.mp4', ar: 'qa-wrap-commercial-40s-ar.mp4' },
  poster: 'qa-wrap-commercial-40s-1280.jpg',
  thumb: 'qa-wrap-film.webp',
  // the packaged in-tool banner, one per language (Nader, 2026-11-10): the Arabic card shows Arabic words before a press
  thumbs: { en: 'qa-wrap-film.webp', ar: 'qa-wrap-film-ar.webp' },
  secs: 40,
}];
for (const f of films) {
  const files = { en: `tutorials/${f.id}-en.mp4`, ar: `tutorials/${f.id}-ar.mp4` };
  const built = fs.existsSync(path.join(MEDIA, files.en)) && fs.existsSync(path.join(MEDIA, files.ar));
  // the pair is the unit: one poster per language, cut from that language's master; `poster` (the English one) stays for older readers
  const posters = { en: `tutorials/${f.id}-en.jpg`, ar: `tutorials/${f.id}-ar.jpg` };
  const l = { id: f.id, kind: 'feature', ar: f.title.ar, en: f.title.en, blurb: f.blurb, files, poster: posters.en, posters, secs: f.dur };
  if (!built) l.pending = true;
  out.push(l);
}
fs.writeFileSync(path.join(REPO, 'extension', 'tutorials', 'lessons.json'), JSON.stringify(out, null, 2) + '\n');
console.log(out.map((l) => `${l.id}${l.pending ? ' (pending)' : ''}`).join(', '));
