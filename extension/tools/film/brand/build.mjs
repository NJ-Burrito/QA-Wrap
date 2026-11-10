#!/usr/bin/env node
/* QA Wrap brand films: build one HyperFrames project per film, language and aspect (worker b1, 2026-11-10).
   Usage:
     THMANYAH_DIR=C:/Users/ACER/Desktop/QA-Wrap/work/film/fonts node build.mjs --film <slug> --lang en|ar --aspect 16x9|9x16
       -> work/film/brand/<slug>/<lang>-<aspect>/index.html (+ assets/: gsap, fonts copied into the gitignored work dir only)
     node build.mjs --film <slug> --all        builds the four variants
   What goes into index.html: kit.css, window.FILM (the film's entry in work/film/brand/films.json, untouched),
   window.NOTES (work/film/brand/build-notes.json: strings films.json lacks, with their i18n keys), kit.js, films/<slug>.js.
   Add a film: write films/<slug>.js:   const K = QAK();  ...draw beats with K.card/K.pill/K.btn/...;  K.titles(); K.captions();
   K.endCard(K.beat("bN")); K.done();   then  node build.mjs --film <slug> --all  and  node board.mjs --film <slug>.
   Text comes from films.json through K.scr(beatId) (the shot table's on-screen words split on " · "), K.F.captions,
   beat titles; never retype it in the film file. Coordinates are 16:9 world px for the EN cut; the K helpers mirror AR.
   Checks: node check.mjs --film <slug>  (page errors, rendered-glyph fonts, Arabic on-screen gate) and
   npx hyperframes lint <built dir>. Snapshots: node board.mjs --film <slug> [--v916]. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const film = arg("film");
const films = JSON.parse(fs.readFileSync(path.join(root, "work/film/brand/films.json"), "utf8"));
const F = films.films.find((f) => f.slug === film);
if (!F) throw new Error("unknown --film; one of: " + films.films.map((f) => f.slug).join(", "));
if (!fs.existsSync(path.join(here, "films", film + ".js"))) throw new Error(`films/${film}.js not written yet`);
const notesAll = JSON.parse(fs.readFileSync(path.join(root, "work/film/brand/build-notes.json"), "utf8"));
const notes = Object.assign({}, notesAll.shared, notesAll[film] || {});
const variants = process.argv.includes("--all") ? [["en", "16x9"], ["ar", "16x9"], ["en", "9x16"], ["ar", "9x16"]] : [[arg("lang", "en"), arg("aspect", "16x9")]];
const fontSrc = process.env.THMANYAH_DIR || path.join(root, "work/film/fonts");
const FACES = [["Thmanyah Sans", "thmanyahsans", [400, 500, 700, 900]], ["Thmanyah Serif Display", "thmanyahserifdisplay", [700, 900]], ["Thmanyah Serif Text", "thmanyahseriftext", [500]]];
const WN = { 400: "Regular", 500: "Medium", 700: "Bold", 900: "Black" };
const fontCSS = FACES.flatMap(([fam, file, ws]) => ws.map((w) => `@font-face{font-family:"${fam}";src:url("./assets/fonts/${file}-${WN[w]}.woff2") format("woff2");font-weight:${w}}`)).join("\n");
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
for (const [lang, aspect] of variants) {
  if (!["en", "ar"].includes(lang) || !["16x9", "9x16"].includes(aspect)) throw new Error("bad --lang/--aspect");
  const [W, H] = aspect === "16x9" ? [1920, 1080] : [1080, 1920];
  const out = path.join(root, "work/film/brand", film, `${lang}-${aspect}`);
  fs.mkdirSync(path.join(out, "assets", "fonts"), { recursive: true });
  for (const [, file, ws] of FACES) for (const w of ws) fs.copyFileSync(path.join(fontSrc, `${file}-${WN[w]}.woff2`), path.join(out, "assets/fonts", `${file}-${WN[w]}.woff2`));
  fs.copyFileSync(path.join(root, "site/assets/vendor/gsap.min.js"), path.join(out, "assets/gsap.min.js"));
  const css = fs.readFileSync(path.join(here, "kit.css"), "utf8").replaceAll("__W__", W).replaceAll("__H__", H);
  const id = `qaw-${film}-${lang}-${aspect}`;
  const html = `<!doctype html>
<!-- QA Wrap brand film "${film}" (${lang}, ${aspect}). Built by extension/tools/film/brand/build.mjs: do not edit, edit kit.* or films/${film}.js. -->
<html lang="${lang}" dir="ltr">
<head>
<meta charset="utf-8">
<script src="./assets/gsap.min.js"></script>
<style>
${fontCSS}
${css}
</style>
</head>
<body class="${aspect === "9x16" ? "v" : "h"} ${lang}" data-lang="${lang}">
<div id="stage" data-composition-id="${id}" data-start="0" data-duration="${F.duration}" data-fps="${F.fps || 30}" data-width="${W}" data-height="${H}"></div>
<script>
window.FILM=${json(F)};
window.NOTES=${json(notes)};
${fs.readFileSync(path.join(here, "kit.js"), "utf8")}
${fs.readFileSync(path.join(here, "films", film + ".js"), "utf8")}
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(out, "index.html"), html);
  fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2));
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id, name: id }));
  fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: id, private: true, type: "module" }));
  console.log(out);
}
