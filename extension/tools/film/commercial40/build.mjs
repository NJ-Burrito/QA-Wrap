#!/usr/bin/env node
/* Build the HyperFrames project for the 40 s commercial.
   node build.mjs --lang en|ar --aspect 16x9|9x16 [--tag name]  ->  work/film/c40/<lang>-<aspect>[-name]/ (index.html + assets) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const lang = arg("lang", "en"), aspect = arg("aspect", "16x9");
if (!["en", "ar"].includes(lang) || !["16x9", "9x16"].includes(aspect)) throw new Error("bad --lang/--aspect");
const [W, H] = aspect === "16x9" ? [1920, 1080] : [1080, 1920];
const tag = arg("tag", ""); // --tag <name>: work/film/c40/<lang>-<aspect>-<tag>, so parallel workers do not overwrite each other
if (tag && !/^[\w.-]+$/.test(tag)) throw new Error("bad --tag");
const out = path.join(root, "work", "film", "c40", `${lang}-${aspect}${tag ? "-" + tag : ""}`);
fs.mkdirSync(path.join(out, "assets", "fonts"), { recursive: true });
const fontSrc = process.env.THMANYAH_DIR || "O:/VScode Projects/Linkedin/assets/fonts";
for (const f of fs.readdirSync(fontSrc).filter((n) => /^thmanyah.*\.woff2$/.test(n))) fs.copyFileSync(path.join(fontSrc, f), path.join(out, "assets", "fonts", f));
fs.copyFileSync(path.join(root, "site", "assets", "vendor", "gsap.min.js"), path.join(out, "assets", "gsap.min.js"));
let html = fs.readFileSync(path.join(here, "composition.template.html"), "utf8");
html = html.replaceAll("__LANG__", lang).replaceAll("__ASPECT__", aspect === "9x16" ? "v" : "h").replaceAll("__W__", String(W)).replaceAll("__H__", String(H)).replaceAll("__DIR__", lang === "ar" ? "rtl" : "ltr");
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(out, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2));
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ id: `qaw-c40-${lang}-${aspect}`, name: `qaw-c40-${lang}-${aspect}` }));
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: `qaw-c40-${lang}-${aspect}`, private: true, type: "module" }));
console.log(out);
