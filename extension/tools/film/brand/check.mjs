#!/usr/bin/env node
/* Gates for a built brand film, all four variants (the commercial40/gate_text.mjs logic on the brand strings):
   - page errors: 0
   - fonts: the platform fonts Chrome actually used for every text-bearing element (CDP CSS.getPlatformFontsForNode),
     seeked to every beat's key time so time-toggled text is laid out; anything that is not Thmanyah fails; Cairo fails
   - Arabic on screen (AR variants): 0 tashkeel, 0 tatweel, 0 Persian letters, 0 Latin , ; ? next to Arabic, 0 Arabic-Indic digits
   node check.mjs --film <slug>     (build first: node build.mjs --film <slug> --all) */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const require = createRequire(path.resolve(here, "../../../package.json"));
const { chromium } = require("playwright");
const slug = process.argv[process.argv.indexOf("--film") + 1];
const F = JSON.parse(fs.readFileSync(path.join(root, "work/film/brand/films.json"), "utf8")).films.find((f) => f.slug === slug);
if (!F) throw new Error("unknown --film");
const BAD = { tashkeel: /[ً-ْٰ]/, tatweel: /ـ/, persian: /[کیگپچژ]/, latinPunct: /[؀-ۿ]\s*[,;?]|[,;?]\s*[؀-ۿ]/, arabicIndicDigits: /[٠-٩۰-۹]/ };
const profile = path.join(root, `work/film/tmp/${process.env.FILM_TAG || "b1"}/chrome-gate`);
fs.mkdirSync(profile, { recursive: true });
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1920, height: 1920 } });
let fail = 0;
for (const v of ["en-16x9", "ar-16x9", "en-9x16", "ar-9x16"]) {
  const page = await ctx.newPage(), errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  // the CDP DOM walk below makes Chrome log "Unsafe attempt to load URL file:..." for the page itself; that is the gate, not the film
  page.on("console", (m) => { if (m.type() === "error" && !/^Unsafe attempt to load URL file:/.test(m.text())) errs.push(m.text()); });
  await page.goto(pathToFileURL(path.join(root, "work/film/brand", slug, v, "index.html")).href);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const fonts = new Map(), texts = new Set();
  for (const t of [0, ...F.beats.map((b) => b.keySec), F.duration - 0.05]) {
    const got = await page.evaluate((x) => { Object.values(window.__timelines)[0].seek(x, false);
      document.querySelectorAll("[data-g]").forEach((e) => e.removeAttribute("data-g"));
      const w = document.createTreeWalker(document.getElementById("stage"), NodeFilter.SHOW_TEXT), o = []; let n;
      while ((n = w.nextNode())) if (n.nodeValue.trim() && n.parentElement.getClientRects().length) { n.parentElement.setAttribute("data-g", "1"); o.push(n.nodeValue.trim()); }
      return o; }, t);
    got.forEach((s) => texts.add(s));
    const { root: r } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: r.nodeId, selector: "[data-g]" });
    for (const id of nodeIds) { try { const res = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id }); for (const f of res.fonts) fonts.set(f.familyName, (fonts.get(f.familyName) || 0) + f.glyphCount); } catch {} }
  }
  await page.close();
  const ar = [...texts].filter((s) => /[؀-ۿ]/.test(s));
  const hits = Object.fromEntries(Object.entries(BAD).map(([k, re]) => [k, ar.filter((s) => re.test(s))]));
  const nHits = Object.values(hits).reduce((a, b) => a + b.length, 0);
  const fam = [...fonts.keys()], foreign = fam.filter((f) => !/^Thmanyah/i.test(f));
  const looked = fam.some((f) => /^Thmanyah/i.test(f)) && (!v.startsWith("ar") || ar.length > 10);
  const ok = !errs.length && !foreign.length && !nHits && looked;
  if (!ok) fail++;
  console.log(`${v}: ${ok ? "PASS" : "FAIL"} page errors ${errs.length}; text strings ${texts.size}, Arabic ${ar.length}; tashkeel ${hits.tashkeel.length}, tatweel ${hits.tatweel.length}, Persian ${hits.persian.length}, Latin punct ${hits.latinPunct.length}, Arabic-Indic digits ${hits.arabicIndicDigits.length}; glyphs ${JSON.stringify(Object.fromEntries(fonts))}; non-Thmanyah ${foreign.length}`);
  if (nHits) console.log("  hits:", JSON.stringify(hits));
  if (errs.length) console.log("  errors:", errs.slice(0, 3).join(" | "));
}
await ctx.close();
process.exit(fail ? 1 : 0);
