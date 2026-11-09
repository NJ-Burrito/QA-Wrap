#!/usr/bin/env node
/* Seek the built composition to given times and write PNGs (and a contact sheet via ffmpeg is the caller's job).
   node snap.mjs <projectDir> <outDir> t1 t2 ...    (needs extension/node_modules/playwright) */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../package.json"));
const { chromium } = require("playwright");
const [proj, out, ...ts] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(proj, "index.html"), "utf8");
const W = +/data-width="(\d+)"/.exec(html)[1], H = +/data-height="(\d+)"/.exec(html)[1];
const browser = await chromium.launchPersistentContext("O:/Temp/qaw1109/chrome-qaw-1109", { headless: true, viewport: { width: W, height: H } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(pathToFileURL(path.join(proj, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length, null, { timeout: 5000 }).catch(async () => { console.log("ERRORS", errs); await browser.close(); process.exit(1); });
for (const t of ts) {
  await page.evaluate((x) => { const tl = Object.values(window.__timelines)[0]; tl.seek(+x, false); }, t);
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(out, `t${String(t).replace(".", "_")}.png`) });
}
await browser.close();
if (errs.length) console.log("ERRORS", errs.slice(0, 5));
