#!/usr/bin/env node
/* Storyboard boards for a brand film: one still per beat at its key time (films.json keySec), plus the first and the last
   frame, per language, tiled 3 per row at 960 px a tile and labelled with beat id + time.
   node board.mjs --film <slug> [--no-build]
     -> work/film/brand/<slug>/board-en.png, board-ar.png, board-9x16-en.png (4 beats), stills/<variant>/<id>.png
   Page errors are counted per variant and printed; a variant with errors exits 1. Profile: work/film/tmp/b1/chrome-board. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const require = createRequire(path.resolve(here, "../../../package.json"));
const { chromium } = require("playwright");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const slug = arg("film");
const F = JSON.parse(fs.readFileSync(path.join(root, "work/film/brand/films.json"), "utf8")).films.find((f) => f.slug === slug);
if (!F) throw new Error("unknown --film");
if (!process.argv.includes("--no-build")) execFileSync(process.execPath, [path.join(here, "build.mjs"), "--film", slug, "--all"], { stdio: "inherit" });
const base = path.join(root, "work/film/brand", slug);
const last = +(F.duration - 1 / (F.fps || 30)).toFixed(3);
const shots = [["first", 0], ...F.beats.map((b) => [b.id, b.keySec]), ["last", last]];
const v916 = [0, 2, 4, F.beats.length - 1].map((i) => [F.beats[i].id, F.beats[i].keySec]);
// --all916 (b3, additive): the 9:16 strip carries every beat at its key time instead of four
const v916all = process.argv.includes("--all916") ? F.beats.map((b) => [b.id, b.keySec]) : null;
const profile = path.join(root, `work/film/tmp/${process.env.FILM_TAG || "b1"}/chrome-board`);
fs.mkdirSync(profile, { recursive: true });
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1920, height: 1080 } });
let bad = 0;
async function stills(variant, list) {
  const [W, H] = variant.endsWith("9x16") ? [1080, 1920] : [1920, 1080];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(pathToFileURL(path.join(base, variant, "index.html")).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length, null, { timeout: 8000 }).catch(() => errs.push("no timeline registered"));
  const dir = path.join(base, "stills", variant);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [id, t] of list) {
    if (errs.length) break;
    await page.evaluate((x) => { Object.values(window.__timelines)[0].seek(x, false); }, t);
    await page.waitForTimeout(40);
    const file = path.join(dir, `${id}.png`);
    await page.screenshot({ path: file });
    out.push({ id, t, file });
  }
  console.log(`${variant}: ${out.length} stills, page errors ${errs.length}${errs.length ? " " + errs.slice(0, 3).join(" | ") : ""}`);
  bad += errs.length;
  await page.close();
  return out;
}
async function tile(items, file, tw, th, cols) {
  const gap = 16, lab = 44, rows = Math.ceil(items.length / cols);
  const W = cols * tw + (cols + 1) * gap, H = rows * (th + lab) + (rows + 1) * gap;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  const cells = items.map((s) => `<div style="width:${tw}px"><div style="height:${lab}px;font:700 24px/44px 'Thmanyah Sans';color:#f0eee9">${s.id} · ${s.t.toFixed(2)} s</div><img src="data:image/png;base64,${fs.readFileSync(s.file).toString("base64")}" style="display:block;width:${tw}px;height:${th}px"></div>`).join("");
  const face = fs.readFileSync(path.join(process.env.THMANYAH_DIR || path.join(root, "work/film/fonts"), "thmanyahsans-Bold.woff2")).toString("base64");
  await page.setContent(`<style>@font-face{font-family:"Thmanyah Sans";src:url(data:font/woff2;base64,${face}) format("woff2");font-weight:700}</style><body style="margin:0;background:#0d0f11"><div style="display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:${gap}px;padding:${gap}px">${cells}</div></body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  await page.close();
  console.log(file);
}
for (const lang of ["en", "ar"]) {
  const s = await stills(`${lang}-16x9`, shots);
  if (s.length) await tile(s, path.join(base, `board-${lang}.png`), 960, 540, 3);
}
for (const lang of ["en", "ar"]) {
  const s = await stills(`${lang}-9x16`, v916all || v916);
  if (s.length && (lang === "en" || process.argv.includes("--ar916"))) await tile(s, path.join(base, `board-9x16-${lang}.png`), 540, 960, v916all ? 5 : 4);
}
await ctx.close();
process.exit(bad ? 1 : 0);
