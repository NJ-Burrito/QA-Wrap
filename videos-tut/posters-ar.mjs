#!/usr/bin/env node
/* The Arabic posters (Nader, 2026-11-10: "the AR banner holds Arabic words, so the user knows it is an Arabic video
 * before pressing on it"). One designed card per Arabic film, built on a frame of that film's own Arabic master:
 *   the frame, a basalt scrim over its burned-in caption, the QA Wrap lockup (inline-start, right in RTL),
 *   the length pill, a clear «بالعربية» language tag, the film's Arabic title (from lessons.json) and an amber play disc.
 * The frame sits 72 px low so the lockup and the length pill own a clear band of ground at the top.
 * Bible values only (docs/film/commercial-bible.md): ground #171a1d, ink #ecebe7, pills #272b30/#3a4047,
 * amber #f0b94a = the user's action, green #7bd389 = proof. Thmanyah only (videos-tut/kit/fonts). No tashkeel.
 *   node videos-tut/posters-ar.mjs        -> site/media/tutorials/<id>-ar.jpg (1280x720),
 *                                            site/media/qa-wrap-commercial-40s-ar.jpg (1920x1080) and -ar-1280.jpg,
 *                                            extension/tutorials/qa-wrap-film-ar.webp (640x360, the in-tool card)
 * Needs ffmpeg on PATH and playwright (extension/node_modules, or QAW_NODE_MODULES=<dir containing playwright>).
 * Scratch goes to O:/Temp/qaw-posters; the English posters are not touched. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const MEDIA = path.join(REPO, 'site', 'media');
const KIT = path.join(HERE, 'kit');
const TMP = process.env.QAW_POSTER_TMP || 'O:/Temp/qaw-posters';
fs.mkdirSync(TMP, { recursive: true });

let chromium;
try { ({ chromium } = createRequire(path.join(REPO, 'extension', 'package.json'))('playwright')); }
catch { ({ chromium } = createRequire(path.join(process.env.QAW_NODE_MODULES || '', 'x.js'))('playwright')); }

const lessons = JSON.parse(fs.readFileSync(path.join(REPO, 'extension', 'tutorials', 'lessons.json'), 'utf8'));
const byId = Object.fromEntries(lessons.map((l) => [l.id, l]));

/* The frame each poster is cut from (seconds into the Arabic master): the beat that shows what the film teaches. */
const FRAME = {
  'record-a-session': 14, 'trace-a-failure': 38, 'notes-and-bugs': 22,
  'export-and-seal': 30, 'profile-and-fine-print': 14, 'kpi-dashboard': 30,
};

const font = (fam, file) => `@font-face{font-family:${fam};src:url("${pathToFileURL(path.join(KIT, 'fonts', file))}")}`;
const lockup = fs.readFileSync(path.join(KIT, 'qa-wrap-lockup-dark.svg'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** One poster card, laid out at 1280x720 CSS px (the commercial renders the same card at 1.5x for 1920x1080). */
const card = ({ frame, title, secs, big, banner }) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
${font('S', 'thmanyah-sans-700.woff2')}${font('D', 'thmanyah-serif-display-700.woff2')}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;position:relative;overflow:hidden;background:#171a1d;color:#ecebe7;font-family:S}
.f{position:absolute;left:0;right:0;top:72px;bottom:-72px;background:url("${pathToFileURL(frame)}") center/cover;filter:brightness(.82) saturate(.95)}
.s{position:absolute;inset:0;background:linear-gradient(to top,#171a1d 0%,rgba(23,26,29,.97) 22%,rgba(23,26,29,.55) 42%,rgba(23,26,29,0) 62%),
  linear-gradient(to bottom,#171a1d 0%,#171a1d 10%,rgba(23,26,29,0) 22%)}
.lock{position:absolute;top:40px;right:56px;height:44px;direction:ltr}.lock svg{height:44px;width:auto;display:block}
.pill{position:absolute;top:44px;left:56px;height:38px;padding:0 18px;border-radius:19px;background:#272b30;border:1px solid #3a4047;
  font:700 20px/36px S;color:#ecebe7}
.tag{position:absolute;right:56px;bottom:${banner ? 214 : big ? 176 : 150}px;height:44px;padding:0 20px;border-radius:22px;background:#ecebe7;color:#171a1d;
  font:700 24px/44px S;display:flex;align-items:center;gap:10px}
.tag i{width:10px;height:10px;border-radius:50%;background:#7bd389;display:block}
.t{position:absolute;right:56px;left:${banner ? 56 : 180}px;bottom:${banner ? 92 : 54}px;font:700 ${big ? 66 : 62}px/1.25 D;text-align:right;white-space:nowrap}
.t em{font-style:normal;color:#7bd389}
.play{position:absolute;left:56px;bottom:56px;width:92px;height:92px;border-radius:50%;background:#f0b94a;
  box-shadow:0 0 0 12px rgba(240,185,74,.2),0 18px 40px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.play.mid{left:50%;top:50%;bottom:auto;width:150px;height:150px;transform:translate(-50%,-50%)}
.play.mid b{border-left-width:46px;border-top-width:28px;border-bottom-width:28px;margin-left:12px}
.play b{width:0;height:0;border-left:30px solid #171a1d;border-top:18px solid transparent;border-bottom:18px solid transparent;margin-left:8px}
</style><body>
<div class="f"></div><div class="s"></div>
<div class="lock">${lockup}</div>
${banner ? '' : `<div class="pill">${secs} ثانية</div>`}
<div class="tag"><i></i>بالعربية</div>
<div class="t">${title}</div>
<div class="play${banner ? ' mid' : ''}"><b></b></div>
</body></html>`;

const grab = (mp4, t, out) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', out]);

const jobs = [];
for (const [id, t] of Object.entries(FRAME)) {
  const l = byId[id];
  if (!l || !l.posters?.ar) throw new Error(`lessons.json has no Arabic poster for ${id}`);
  const frame = path.join(TMP, `${id}-ar-f.png`);
  grab(path.join(MEDIA, l.files.ar), t, frame);
  jobs.push({ html: card({ frame, title: esc(l.ar), secs: l.secs }), outs: [[path.join(MEDIA, l.posters.ar), 1]] });
}
{ // the commercial: the "cannot reproduce" stamp (3 s), its Arabic headline with the proof half in green, at 1920 and 1280
  const l = byId['qa-wrap'];
  const frame = path.join(TMP, 'c40-ar-f.png');
  grab(path.join(MEDIA, l.files.ar), 3, frame);
  jobs.push({
    html: card({ frame, title: 'تعذر تكرارها؟ <em>الدليل مرفق.</em>', secs: l.secs, big: true }),
    outs: [[path.join(MEDIA, 'qa-wrap-commercial-40s-ar.jpg'), 1.5], [path.join(MEDIA, 'qa-wrap-commercial-40s-ar-1280.jpg'), 1]],
  });
  /* the in-tool card draws its own length chip, play chip (bottom corners) and a ring round the centre: the banner
     leaves those places to the card, as the English banner does (play disc centred, no length pill, title raised) */
  jobs.push({ html: card({ frame, title: 'تعذر تكرارها؟ <em>الدليل مرفق.</em>', secs: l.secs, big: true, banner: true }),
    outs: [[path.join(TMP, 'c40-ar-banner.png'), 1]] });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const j of jobs) {
    const src = path.join(TMP, 'card.html');
    fs.writeFileSync(src, j.html);
    for (const [out, scale] of j.outs) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
      await page.goto(pathToFileURL(src).href);
      await page.evaluate(() => document.fonts.ready);
      const missing = await page.evaluate(() => [...document.fonts].filter((f) => f.status !== 'loaded').length);
      if (missing) throw new Error(`a Thmanyah face did not load for ${out}`);
      const over = await page.evaluate(() => { const t = document.querySelector('.t'); return t.scrollWidth > t.clientWidth + 1; });
      if (over) throw new Error(`the title overflows its line in ${out}`);
      await page.screenshot(out.endsWith('.png') ? { path: out, type: 'png' } : { path: out, type: 'jpeg', quality: 86 });
      await page.close();
      console.log(path.relative(REPO, out));
    }
  }
} finally { await browser.close(); }

/* The in-tool film card's Arabic banner: the banner card at 640x360, packaged beside the tutorials page (never hosted,
 * T-048). Its English twin is extension/tutorials/qa-wrap-film.webp; test-films-hosted keeps each under 60 KB. */
const banner = path.join(REPO, 'extension', 'tutorials', 'qa-wrap-film-ar.webp');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(TMP, 'c40-ar-banner.png'), '-vf', 'scale=640:360:flags=lanczos',
  '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', banner]);
console.log(path.relative(REPO, banner));
