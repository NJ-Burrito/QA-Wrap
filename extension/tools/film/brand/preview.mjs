#!/usr/bin/env node
/* Owner preview of the six brand-film concepts (worker b3, 2026-11-10): ONE self-contained page Nader opens from disk.
   node preview.mjs  ->  work/film/brand/preview.html
   Everything about the films is read, never typed: films.json (titles, beats, captions, voice lines, fit, SFX, mirroring,
   honesty), docs/film/brand-films.md (the coverage matrix), the boards (relative image paths), the builders' notes
   (b1/b2/b3-notes.md: adapted points per film, the open points), vo/voiced.json (lines already voiced) and the voice-style
   registry (good_for). Dark only, Thmanyah only (@font-face to ../fonts, nothing embedded), no scripts, no external requests.
   The text/background contrast pairs are computed here and the build refuses any pair under 7:1. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const BR = path.join(root, "work/film/brand");
const rd = (p) => fs.readFileSync(p, "utf8");
const FJ = JSON.parse(rd(path.join(BR, "films.json"))), FILMS = FJ.films;
const doc = rd(path.join(root, "docs/film/brand-films.md"));
const notes = ["b1", "b2", "b3"].map((b) => ({ b, md: fs.existsSync(path.join(BR, `${b}-notes.md`)) ? rd(path.join(BR, `${b}-notes.md`)) : "" }));
const styles = JSON.parse(rd("C:/Users/ACER/Desktop/nj-plugin/skills/nj-writer/voice-styles.json")).styles;
const voiced = fs.existsSync(path.join(BR, "vo/voiced.json")) ? JSON.parse(rd(path.join(BR, "vo/voiced.json"))) : [];

// ---------- colours and the contrast gate (WCAG relative luminance)
const C = { ground: "#171a1d", panel: "#1f2327", ink: "#ecebe7", dim: "#c3c5c8", green: "#9fdcaa", amber: "#f2c66b", coral: "#ffab98", link: "#b9dcff", line: "#3a4047" };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [["ink", "ground"], ["ground", "dim"], ["ink", "panel"], ["dim", "ground"], ["dim", "panel"], ["green", "ground"], ["green", "panel"], ["amber", "ground"], ["amber", "panel"], ["coral", "panel"], ["link", "ground"], ["link", "panel"]];
const ratios = PAIRS.map(([t, b]) => [t, b, ratio(C[t], C[b])]);
const weak = ratios.filter((r) => r[2] < 7);
if (weak.length) throw new Error("contrast under 7:1: " + weak.map((r) => `${r[0]} on ${r[1]} ${r[2].toFixed(2)}`).join(", "));

// ---------- text helpers: escape, Arabic runs in dir=rtl lang=ar, `code` only for Latin
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Thmanyah has no arrow glyph (b1-notes): a text arrow in the film text is drawn as an inline SVG, the words are unchanged
const ARW = '<svg class="arw" viewBox="0 0 24 24" width="18" height="18" role="img" aria-label="to"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const escA = (s) => esc(s).replace(/→/g, ARW);
const AR_RUN = /[\u0600-\u06FF«][\u0600-\u06FF«»\s،؛؟:.()]*[\u0600-\u06FF»؟.]|[\u0600-\u06FF]/g;
const mix = (s) => escA(s).replace(AR_RUN, (m) => `<span dir="rtl" lang="ar">${m}</span>`);
const md = (s) => String(s).split(/(`[^`]*`)/).map((p, i) => (i % 2 ? (/[\u0600-\u06FF]/.test(p) ? mix(p.slice(1, -1)) : `<code>${esc(p.slice(1, -1))}</code>`) : mix(p).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"))).join("");
const arCell = (s) => `<td dir="rtl" lang="ar">${escA(s)}</td>`;
const arDiv = (s, tag = "div", cls = "") => `<${tag} dir="rtl" lang="ar"${cls ? ` class="${cls}"` : ""}>${esc(s)}</${tag}>`;
const plainTitle = (s) => String(s).replace(/\*/g, "");
const table = (head, rows) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.join("")}</tr>`).join("")}</tbody></table></div>`;
const td = (s, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${s}</td>`;
const sec = (n) => `${Number(n).toFixed(1)} s`;

// ---------- notes: bullets of a section; per-film bullets start with the slug
const section = (mdText, head) => { const i = mdText.indexOf("\n## " + head); if (i < 0) return []; const rest = mdText.slice(i + 4 + head.length); const j = rest.indexOf("\n## "); return (j < 0 ? rest : rest.slice(0, j)).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)); };
const adapted = (slug) => notes.flatMap(({ b, md: m }) => [...section(m, "What could not be drawn exactly as written"), ...section(m, "Script points adapted, and why")].filter((l) => l.startsWith(slug + " ")).map((l) => [b, l]));
const openPoints = section(notes[2].md, "Open points for Nader");

// ---------- coverage matrix: the doc's table, as written
const covMd = (() => { const i = doc.indexOf("## Coverage matrix"); const rest = doc.slice(i); return rest.slice(0, rest.indexOf("\n## ", 5)).split("\n").filter((l) => l.startsWith("|")); })();
const covRows = covMd.slice(2).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const covHead = covMd[0].split("|").slice(1, -1).map((c) => c.trim());

// ---------- the page
const faces = [["Thmanyah Sans", "thmanyahsans", [["Regular", 400], ["Medium", 500], ["Bold", 700]]], ["Thmanyah Serif Display", "thmanyahserifdisplay", [["Bold", 700]]]]
  .flatMap(([fam, file, ws]) => ws.map(([n, w]) => `@font-face{font-family:"${fam}";src:url("../fonts/${file}-${n}.woff2") format("woff2");font-weight:${w};font-display:block}`)).join("\n");
const img = (rel, alt) => fs.existsSync(path.join(BR, rel)) ? `<a href="${rel}"><img src="${rel}" alt="${esc(alt)}" loading="lazy"></a>` : `<p class="miss">Missing: ${esc(rel)}</p>`;
const styleOf = (id) => styles.find((s) => s.id === id) || {};
const totalBeats = FILMS.reduce((a, f) => a + f.beats.length, 0), totalLines = FILMS.reduce((a, f) => a + f.voice.length, 0);

const filmBlock = (F) => {
  const st = styleOf(F.style), ad = adapted(F.slug);
  const fit = (v) => v.fit || {};
  const beats = table(["Beat", "Time (key)", "What happens", "On screen EN", "On screen AR"], F.beats.map((b) => [
    td(`<strong>${b.id}</strong>${b.title ? `<br>${mix(plainTitle(b.title.en))}<br>${arDiv(plainTitle(b.title.ar), "span")}` : ""}`),
    td(`${b.inSec.toFixed(1)}-${b.outSec.toFixed(1)} (${b.keySec.toFixed(1)})`, "num"), td(mix(b.what)), td(mix(b.screen.en)), arCell(b.screen.ar)]));
  const lines = table(["V#", "Start", "EN voice", "AR voice (unvowelled)", "Fit slack EN / AR"], F.voice.map((v) => [
    td(`<strong>${v.id}</strong>`), td(sec(v.startSec), "num"), td(mix(v.en)), arCell(v.ar), td(`${(fit(v).se ?? 0).toFixed(2)} / ${(fit(v).sa ?? 0).toFixed(2)} s`, "num")]));
  const sfx = table(["Time", "Cue", "Hits"], F.sfx.map((s) => [td(sec(s.atSec), "num"), td(esc(s.cue)), td(mix(s.hits))]));
  const tts = `<details><summary>TTS input (tashkeel, never on screen)</summary><ol class="tts">${F.voice.map((v) => `<li><strong>${v.id}</strong> ${arDiv(v.arTts)}</li>`).join("")}</ol></details>`;
  return `<section class="film" id="${F.slug}">
  <h2><span class="n">${F.n}</span> ${esc(F.title.en)} ${arDiv(F.title.ar, "span", "art")}</h2>
  <p class="promise"><strong>Promise.</strong> ${mix(F.promise)}</p>
  <div class="blk"><h3>Arc</h3><p>${mix(F.arc)}</p><p class="dim"><strong>Turn:</strong> the light goes green at ${sec(F.turnSec)}. ${mix(F.bookend)}</p></div>
  <div class="blk"><h3>Boards</h3>
   <div class="boards"><figure>${img(`${F.slug}/board-en.png`, `${F.title.en}: EN 16:9 board`)}<figcaption>EN 16:9 (first frame, every beat at its key time, last frame)</figcaption></figure>
   <figure>${img(`${F.slug}/board-ar.png`, `${F.title.en}: AR 16:9 board`)}<figcaption>AR 16:9</figcaption></figure></div>
   <div class="boards"><figure>${img(`${F.slug}/board-9x16-en.png`, `${F.title.en}: EN 9:16 strip`)}<figcaption>EN 9:16</figcaption></figure>
   <figure>${img(`${F.slug}/board-9x16-ar.png`, `${F.title.en}: AR 9:16 strip`)}<figcaption>AR 9:16</figcaption></figure></div></div>
  <div class="blk"><h3>Beats</h3>${beats}</div>
  <div class="blk"><h3>Voice lines</h3>${lines}${tts}</div>
  <div class="blk"><h3>Voice style</h3><p><strong>${esc(F.style)}</strong>. Registered good_for: “${mix(st.good_for || "not found in the registry")}”</p><p class="dim">Direction (registry, byte-exact): “${mix(F.styleDirection)}”</p>
   <ul>${(F.delivery || []).map((d) => `<li><strong>${mix(d.act)}:</strong> ${mix(d.note)}</li>`).join("")}</ul></div>
  <div class="blk"><h3>Sound cues</h3>${sfx}</div>
  <div class="blk"><h3>Arabic cut (mirroring)</h3><p>${mix(F.mirrorAr)}</p></div>
  <div class="blk"><h3>Honesty</h3><p>${mix(F.honesty)}</p></div>
  <div class="blk"><h3>Adapted while building</h3>${ad.length ? `<ul>${ad.map(([b, l]) => `<li><span class="tag">${b}</span> ${md(l.slice(F.slug.length + 1))}</li>`).join("")}</ul>` : "<p>Nothing adapted.</p>"}</div>
</section>`;
};

const voicedRows = voiced.map((v) => { const [slug, vid] = [v.id.replace(/-V\d+-\w+$/, ""), v.id.match(/-(V\d+)-/)[1]]; const F = FILMS.find((f) => f.slug === slug); const L = F && F.voice.find((x) => x.id === vid);
  return [td(esc(slug)), td(vid), td(`${v.seconds.toFixed(2)} s`, "num"), td(L ? `${L.fit.window.toFixed(2)} s` : "?", "num"), L ? arCell(L.ar) : td("")]; });

const html = `<!doctype html>
<!-- QA Wrap brand films: owner preview. Generated by extension/tools/film/brand/preview.mjs on ${new Date().toISOString().slice(0, 10)}; do not edit by hand.
Text / background contrast (WCAG, all >= 7:1):
${ratios.map(([t, b, r]) => `  ${t} ${C[t]} on ${b} ${C[b]}: ${r.toFixed(2)}:1`).join("\n")}
-->
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Brand film concepts</title>
<style>
${faces}
:root{color-scheme:dark}
*{box-sizing:border-box}
html{background:${C.ground}}
body{margin:0;background:${C.ground};color:${C.ink};font:400 18px/1.6 "Thmanyah Sans";overflow-x:hidden}
main{max-width:1500px;margin:0 auto;padding:24px 16px 80px}
h1,h2{font-family:"Thmanyah Serif Display";font-weight:700;line-height:1.2;margin:0}
h1{font-size:40px}h2{font-size:32px;margin:0 0 12px}h3{font-size:20px;margin:0 0 10px;color:${C.green}}
p{margin:0 0 10px;overflow-wrap:anywhere}
a{color:${C.link}}
.dim{color:${C.dim}}
.result{background:${C.panel};border:1px solid ${C.line};border-radius:14px;padding:18px 20px;margin:18px 0 26px}
.result strong{color:${C.green}}
.blk{background:${C.panel};border:1px solid ${C.line};border-radius:14px;padding:16px 18px;margin:0 0 14px}
.film{margin:44px 0 0;padding-top:20px;border-top:2px solid ${C.line}}
.n{display:inline-block;min-width:44px;color:${C.amber}}
.art{color:${C.dim};font-family:"Thmanyah Sans";font-weight:700;font-size:28px;margin-inline-start:10px}
.promise{font-size:20px}
.tw{overflow-x:auto;max-width:100%;margin:0 0 8px}
table{border-collapse:collapse;font-size:16px;min-width:640px;width:100%}
th,td{border:1px solid ${C.line};padding:8px 10px;vertical-align:top;text-align:start}
th{background:${C.ground};color:${C.dim};font-weight:700}
td.num{white-space:nowrap}
td[dir=rtl]{text-align:right}
code{font-family:"Thmanyah Sans";font-weight:700;color:${C.amber};overflow-wrap:anywhere}
.boards{display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:14px}
@media (min-width:1100px){.boards{grid-template-columns:1fr 1fr}}
figure{margin:0}img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid ${C.line}}
figcaption{font-size:16px;color:${C.dim};margin-top:6px}
details{margin-top:10px}summary{cursor:pointer;color:${C.amber};font-weight:700}
ol.tts{padding-inline-start:28px}ol.tts li{margin:6px 0}ol.tts div{font-size:20px}
.tag{display:inline-block;font-size:16px;font-weight:700;color:${C.ground};background:${C.dim};border-radius:6px;padding:0 6px;margin-inline-end:6px}
ul{padding-inline-start:24px;margin:0}li{margin:4px 0;overflow-wrap:anywhere}
.decide li{margin:8px 0}
.miss{color:${C.coral}}
.arw{vertical-align:-3px}
.own{display:inline-block;width:16px;height:16px;border-radius:50%;background:${C.green}} /* the doc's owner dot, drawn (Thmanyah has no ● glyph) */
</style>
</head>
<body>
<main>
<h1>QA Wrap brand films: six concepts for approval</h1>
<div class="result">
 <p><strong>Result.</strong> Six films are storyboarded in English and Arabic, 16:9 and 9:16: ${totalBeats} beats, ${totalLines} voice lines, every beat drawn at its key time. Nothing is rendered and nothing is voiced beyond the ${voiced.length} name lines listed at the end.</p>
 <p><strong>What you decide.</strong> Approve the six concepts (or name the beats to change), then the points in <a href="#decide">Decisions for Nader</a>. Rendering and voicing all 12 films (phase B2) waits for your go.</p>
</div>
<div class="blk"><h3>The six films</h3>${table(["#", "Title EN / AR", "Duration", "Promise", "Voice style", "Beats", "Voice lines"], FILMS.map((F) => [
  td(String(F.n)), td(`<a href="#${F.slug}">${esc(F.title.en)}</a><br>${arDiv(F.title.ar, "span")}`), td(sec(F.duration), "num"), td(mix(F.promise)), td(esc(F.style)), td(String(F.beats.length), "num"), td(String(F.voice.length), "num")]))}</div>
<div class="blk"><h3>Coverage matrix (one owner film per feature, from the script doc)</h3>${table(covHead.map((h) => md(h)), covRows.map((r) => r.map((c) => td(c === "●" ? '<span class="own" role="img" aria-label="owner film"></span>' : md(c)))))}</div>
${FILMS.map(filmBlock).join("\n")}
<section class="film" id="decide">
 <h2>Decisions for Nader</h2>
 <div class="blk decide"><h3>Open points from the three builders and the script doc</h3><ul>${openPoints.map((l) => `<li>${md(l)}</li>`).join("")}</ul></div>
 <div class="blk"><h3>Name lines already voiced (work/film/brand/vo/)</h3><p class="dim">One take each, Kore, Latin “QA Wrap” in the Arabic TTS input. Seconds measured against the line's planned window.</p>
  ${table(["Film", "Line", "Voiced", "Window", "AR line"], voicedRows)}</div>
</section>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(BR, "preview.html"), html);
console.log(path.join(BR, "preview.html"));
console.log(ratios.map(([t, b, r]) => `${t}/${b} ${r.toFixed(2)}`).join("  "));
