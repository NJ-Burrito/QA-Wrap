/* Writes work/sdlc/build-tut/PREPRO.md from videos-tut/src/*.json (the single source of every script line, so the document and the films cannot disagree). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from './chunks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'work', 'sdlc', 'build-tut', 'PREPRO.md');
const films = fs.readdirSync(path.join(HERE, 'src')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(HERE, 'src', f), 'utf8'))).sort((a, b) => a.no - b.no);

let md = `# QA Wrap tutorials, pre-production (run qaw-1109, R2 / D1)

Six AR + EN pairs, each 40 to 60 s, 1920x1080, 30 fps, narrated, HyperFrames. The pair is the unit: one script file per film
(\`videos-tut/src/<id>.json\`) holds EN, AR, the Arabic TTS text and the shot list, and this document is generated from those
files by \`node videos-tut/gen-prepro.mjs\`, so it cannot drift from the films.

## Style (the commercial's look)
- Basalt ground (#1D2024), blurred ghost blocks drifting, one soft glow per scene (corn, coral, green), raised cards with a hairline edge,
  corn (#E2AE38) as the highlight, coral (#FF9270) for failure, limestone ink. Thmanyah only (Sans 400/700, Serif Display 700). No Cairo.
- Illustrative motion and story, never a screen recording and never a walkthrough. Each film is one story: a tester, a page, a thing
  the tool does, the proof. The tool is drawn (popup, report card), not captured.
- Web scenes are miniatures of public practice apps: Sauce Demo (Swag Labs), Practice Software Testing (Toolshop), the-internet. No lorem.
- Motion: cursor with press ripple, pill events that fly onto one timeline lane, counters that tick, a glow that follows the action, a slow push-in on every scene.
- Captions: bottom, inline-start (right in Arabic), cut from the narration lines and timed by word share, so the voice runs
  through caption changes and never stops at a caption's last word. No emoji.
- End card: QA Wrap lockup (carries the maker line) and "More tutorials, inside the tool".

## Language rules
- Visible Arabic: no tashkeel, no tatweel, no Persian letters, Arabic punctuation (، ؟ «»), Western digits, product words as the tool writes them
  (ابدأ التسجيل، الخط الزمني، ملاحظة، خلل). The brand in captions is كيو إيه راب; the tool's own drawn header stays "QA Wrap" as in the product.
  Foreign words with an Arabic meaning are glossed in Arabic (console = وحدة التحكم); PDF is spelled بي دي إف.
- TTS Arabic (\`ar_tts\`, films 1 to 3): full tashkeel on every word and case ending, letters unchanged, numbers spelled out where they are voiced.
  Visible text never carries the marks. \`node videos-tut/gates.mjs\` checks letters-unchanged and that the marks are there.
- English: plain, one idea per sentence, UI words capitalised as in the tool (Start, Stop, Timeline, Note, Bug).
- Pace: English 150 wpm (gate: at most 2.5 words/s per slot), Arabic 115 wpm (gate: at most 1.9 words/s per slot). Breath of at least 0.4 s between lines.

## Voice plan (owner exception for this job only, 2026-11-09)
Gemini Kore via OpenRouter \`google/gemini-3.1-flash-tts-preview\`, registered style \`manual\` (tutorials), direction byte-exact from
\`voice-styles.json\`. One request per line, one take, no verify, no re-voice, no ASR or LLM judge. Key file
\`~/.config/openrouter/qa-wrap-1109.env\`, loaded at runtime only. \`videos-tut/voice.py\` voices each line, places it at its slot and muxes
it onto the rendered master (video stream copied, not re-encoded). A line longer than its slot is sped up by at most 1.25 and otherwise left to run into the breath.

`;
for (const f of films) {
  md += `## Film ${f.no}: ${f.id} (${f.title.en} / ${f.title.ar})\n\n`;
  md += `- Status: ${f.status}. Length ${f.dur} s. Site props: ${f.site}.\n`;
  md += `- Blurb EN: ${f.blurb.en}\n- Blurb AR: ${f.blurb.ar}\n\n`;
  md += `### Script and voice lines\n\n| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |\n|---|---|---|---|---|\n`;
  for (const L of f.lines) md += `| ${L.id} | ${L.start}-${L.end} | ${L.en} | ${L.ar} | ${words(L.en).length}/${words(L.ar).length} |\n`;
  if (f.lines.some((L) => L.ar_tts)) {
    md += `\nArabic TTS text (voice only):\n\n`;
    for (const L of f.lines) if (L.ar_tts) md += `- ${L.id}: ${L.ar_tts}\n`;
  }
  md += `\n### Shot list\n\n| Time | What happens |\n|---|---|\n`;
  for (const s of f.shots) md += `| ${s.t} | ${s.what} |\n`;
  md += `\n### On-screen words (EN / AR)\n\n${f.onscreen.map((x) => `- ${x}`).join('\n')}\n\n`;
}
md += `## Build status
Films 1 to 3 are built and rendered (EN and AR). Films 4 to 6 are scripted and shot-listed; their on-screen strings are provisional and
are frozen by the Lead's AMEND after the profile, KPI and seal lanes land their UI strings.
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
console.log('wrote', path.relative(process.cwd(), OUT), md.length, 'chars');
