#!/usr/bin/env node
/* Arabic on-screen text + font gate on the live composition (review-checklist B2, B3).
   node gate_text.mjs <projectDir>
   - every text node in the stage: 0 tashkeel, 0 tatweel, 0 Persian letters, 0 Latin , ; ? next to Arabic, 0 Arabic-Indic digits
   - fonts: the platform fonts Chrome actually used for every text-bearing element (CDP CSS.getPlatformFontsForNode),
     seeked to each caption window so hidden-by-time text is laid out; any face that is not Thmanyah fails; Cairo fails. */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../package.json"));
const { chromium } = require("playwright");
const proj = process.argv[2];
const browser = await chromium.launchPersistentContext("O:/Temp/qaw1109/chrome-qaw-1109-gate", { headless: true, viewport: { width: 1920, height: 1920 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(proj, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length);
const texts = await page.evaluate(() => { const w = document.createTreeWalker(document.getElementById("stage"), NodeFilter.SHOW_TEXT); const o = []; let n; while ((n = w.nextNode())) if (n.nodeValue.trim()) o.push(n.nodeValue.trim()); return o; });
const ar = texts.filter((t) => /[\u0600-\u06FF]/.test(t));
const bad = { tashkeel: /[\u064B-\u0652\u0670]/, tatweel: /\u0640/, persian: /[\u06A9\u06CC\u06AF\u067E\u0686\u0698]/, latinPunct: /[\u0600-\u06FF]\s*[,;?]|[,;?]\s*[\u0600-\u06FF]/, arabicIndicDigits: /[\u0660-\u0669\u06F0-\u06F9]/ };
const hits = {}; for (const [k, re] of Object.entries(bad)) hits[k] = ar.filter((t) => re.test(t));
const cdp = await browser.newCDPSession(page);
await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
const fonts = new Map();
// opacity-0 text is still laid out, so one pass sees every string; t=11.5 adds the clock digits (display-toggled)
for (const t of [0, 11.5]) {
  await page.evaluate((x) => { Object.values(window.__timelines)[0].seek(x, false); document.querySelectorAll("[data-g]").forEach((e) => e.removeAttribute("data-g"));
    const w = document.createTreeWalker(document.getElementById("stage"), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.trim()) n.parentElement.setAttribute("data-g", "1"); }, t);
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-g]" });
  for (const id of nodeIds) {
    try { const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id }); for (const f of r.fonts) fonts.set(f.familyName, (fonts.get(f.familyName) || 0) + f.glyphCount); } catch {}
  }
}
await browser.close();
const fam = [...fonts.keys()];
const foreign = fam.filter((f) => !/^Thmanyah/i.test(f));
const n = Object.values(hits).reduce((s, v) => s + v.length, 0);
console.log(JSON.stringify({ arabicStrings: ar.length, hits, fonts: Object.fromEntries(fonts) }, null, 0));
// R15: the gate must have seen Arabic strings and Thmanyah glyphs
const looked = ar.length > 20 && fam.some((f) => /^Thmanyah/i.test(f));
const ok = looked && n === 0 && foreign.length === 0;
console.log(`TEXT ${ok ? "PASS" : "FAIL"}: ${ar.length} Arabic strings; tashkeel ${hits.tashkeel.length}, tatweel ${hits.tatweel.length}, Persian ${hits.persian.length}, Latin punctuation ${hits.latinPunct.length}, Arabic-Indic digits ${hits.arabicIndicDigits.length}; fonts used [${fam.join(", ")}]; non-Thmanyah ${foreign.length}; Cairo ${fam.filter((f) => /cairo/i.test(f)).length}`);
process.exit(ok ? 0 : 1);
