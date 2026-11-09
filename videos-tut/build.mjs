/* QA Wrap tutorial films: build the HyperFrames projects (one EN, one AR per film) from src/<id>.json + .html + .js.
 *   node videos-tut/build.mjs [id ...]      (default: every film that has a scenes file)
 * Output: videos-tut/<id>-en/ and videos-tut/<id>-ar/ (index.html, assets/, hyperframes.json, package.json).
 * Captions are cut from the narration lines and timed by word share inside each line's slot, so the voice runs
 * through caption changes and never stops at a caption's last word. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const KIT = path.join(HERE, 'kit');
const read = (p) => fs.readFileSync(p, 'utf8');
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(SRC).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));

import { chunks, words } from './chunks.mjs';

for (const id of ids) {
  const meta = JSON.parse(read(path.join(SRC, `${id}.json`)));
  const scenes = read(path.join(SRC, `${id}.html`));
  // scene file: world layer (moves with the camera), then after the marker the overlay layer (titles, never scaled)
  const [world, overlay = ''] = scenes.split('<!-- overlay -->');
  const script = read(path.join(SRC, `${id}.js`));
  const css = read(path.join(KIT, 'kit.css'));
  const symbols = read(path.join(KIT, 'symbols.html'));
  const kitjs = read(path.join(KIT, 'kit.js'));
  for (const lang of ['en', 'ar']) {
    const sub = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = meta.strings[k];
      if (!v || v[lang] == null) throw new Error(`${id}: no string "${k}" for ${lang}`);
      return v[lang];
    });
    const caps = []; // {id, start, end}
    let capHtml = '';
    for (const L of meta.lines) {
      const cs = chunks(L[lang]);
      const total = cs.reduce((n, c) => n + words(c).length, 0);
      let t = L.start;
      cs.forEach((c, i) => {
        const dur = (L.end - L.start) * (words(c).length / total);
        const cid = `cap-${L.id}-${i}`;
        caps.push({ id: cid, start: +t.toFixed(3), end: +(t + dur).toFixed(3), last: i === cs.length - 1 });
        capHtml += `<div class="cap" id="${cid}">${c}</div>\n    `;
        t += dur;
      });
    }
    const lines = Object.fromEntries(meta.lines.map((L) => [L.id, { start: L.start, end: L.end }]));
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const pid = `qaw-tut-${id}-${lang}`;
    const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${meta.title[lang]} (QA Wrap tutorial, ${lang.toUpperCase()})</title>
<script src="./gsap.min.js"></script>
<style>
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="${pid}" data-start="0" data-width="1920" data-height="1080" data-duration="${meta.dur}" data-fps="30">
  <div id="ground" class="fill">
    <div id="amb"><div class="ghost" style="left:794px;top:162px;width:283px;height:150px"></div><div class="ghost" style="left:157px;top:44px;width:304px;height:159px"></div><div class="ghost" style="left:1347px;top:168px;width:209px;height:116px"></div><div class="ghost" style="left:1669px;top:417px;width:178px;height:186px"></div><div class="ghost" style="left:1866px;top:95px;width:265px;height:126px"></div><div class="ghost" style="left:398px;top:882px;width:213px;height:161px"></div><div class="ghost" style="left:1443px;top:712px;width:306px;height:130px"></div><div class="ghost" style="left:1063px;top:29px;width:306px;height:157px"></div><div class="ghost" style="left:1455px;top:338px;width:339px;height:175px"></div><div class="bokeh" style="left:451px;top:316px;width:11px;height:11px"></div><div class="bokeh" style="left:384px;top:646px;width:23px;height:23px"></div><div class="bokeh" style="left:327px;top:326px;width:22px;height:22px"></div><div class="bokeh" style="left:1917px;top:429px;width:10px;height:10px"></div><div class="bokeh" style="left:1257px;top:773px;width:8px;height:8px"></div><div class="bokeh" style="left:1349px;top:498px;width:19px;height:19px"></div><div class="bokeh" style="left:1634px;top:87px;width:18px;height:18px"></div><div class="bokeh" style="left:245px;top:465px;width:25px;height:25px"></div><div class="bokeh" style="left:1111px;top:662px;width:25px;height:25px"></div><div class="bokeh" style="left:1663px;top:264px;width:19px;height:19px"></div><div class="bokeh" style="left:127px;top:750px;width:13px;height:13px"></div><div class="bokeh" style="left:1812px;top:301px;width:20px;height:20px"></div><div class="bokeh" style="left:985px;top:352px;width:15px;height:15px"></div><div class="bokeh" style="left:11px;top:664px;width:10px;height:10px"></div></div>
    <div id="glowW" class="glow g-warm" style="inset-inline-start:-420px;top:-160px"></div>
    <div id="glowG" class="glow g-green" style="inset-inline-end:-420px;top:-120px"></div>
    <div id="glowA" class="glow g-amber" style="left:0;top:0"></div>
  </div>
  <div id="world">
${symbols}
${sub(world)}
    <div id="end" class="scene">
      <img id="lockup" src="./assets/qa-wrap-wordmark-dark.svg" alt="QA Wrap" />
      <div id="maker">${lang === 'ar' ? 'من صنع نادر الزغول (<bdi>NJ-Burrito</bdi>)' : 'Made by Nader Alzghoul (<bdi>NJ-Burrito</bdi>)'}</div>
      <div class="abs lbl" id="endnote" style="left:0;right:0;top:600px;text-align:center;font-size:36px">${sub('{{more}}')}</div>
    </div>
    <div class="ripple" id="rip"></div>
    <svg id="cursor" class="cursor" viewBox="0 0 56 56" style="opacity:0"><path d="M8 4l0 38 10-9 7 16 7-3-7-15 14-1z" fill="#ecebe7" stroke="#171a1d" stroke-width="3" stroke-linejoin="round"/></svg>
  </div>
${sub(overlay)}
  <div id="cap">
    ${capHtml}</div>
  <div id="flash" class="fill" style="background:#fff;opacity:0"></div>
</div>
<script>
(() => {
  const ID = ${JSON.stringify(pid)}, D = ${meta.dur}, LANG = ${JSON.stringify(lang)}, RTL = ${lang === 'ar'};
  const LINES = ${JSON.stringify(lines)};
  const CAPS = ${JSON.stringify(caps)};
  const tl = gsap.timeline({ paused: true });
  const q = (s) => document.querySelector(s);
${kitjs}
${script}
  // ambient depth: ghosts and bokeh drift linearly for the whole film (the world is alive), in the film's direction
  tl.fromTo('#amb', { x: 0, y: 0 }, { x: mx(70), y: -24, duration: D, ease: 'none', immediateRender: false }, 0);
  tl.fromTo('.bokeh', { x: 0 }, { x: (i) => mx(18 + (i % 5) * 9), duration: D, ease: 'none', immediateRender: false }, 0);
  // captions: fade up, hold until the next one, the last of a line lingers a beat past its slot
  CAPS.forEach((c, i) => {
    const next = CAPS[i + 1];
    const out = Math.min(c.end + (c.last ? 0.3 : 0), next ? next.start - 0.02 : D - 0.1);
    tl.fromTo('#' + c.id, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', immediateRender: false }, c.start);
    tl.to('#' + c.id, { opacity: 0, duration: 0.2, ease: 'power1.in' }, Math.max(c.start + 0.4, out - 0.2));
  });
  window.__timelines = window.__timelines || {};
  window.__timelines[ID] = tl;
})();
</script>
</body>
</html>
`;
    const dest = path.join(HERE, `${id}-${lang}`);
    fs.mkdirSync(path.join(dest, 'assets', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'index.html'), html.replace(/\r\n/g, '\n'));
    for (const f of fs.readdirSync(path.join(KIT, 'fonts'))) fs.copyFileSync(path.join(KIT, 'fonts', f), path.join(dest, 'assets', 'fonts', f));
    for (const f of ['qa-wrap-wordmark-dark.svg', 'mark-dark.svg']) fs.copyFileSync(path.join(KIT, f), path.join(dest, 'assets', f));
    fs.copyFileSync(path.join(KIT, 'gsap.min.js'), path.join(dest, 'gsap.min.js'));
    fs.writeFileSync(path.join(dest, 'hyperframes.json'), JSON.stringify({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: pid, private: true, type: 'module' }, null, 2) + '\n');
    console.log(`built ${path.relative(process.cwd(), dest)}  (${caps.length} captions)`);
  }
}
