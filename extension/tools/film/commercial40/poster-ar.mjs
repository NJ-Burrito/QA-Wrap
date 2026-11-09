#!/usr/bin/env node
/* Arabic poster for the 40 s film (same layout as the EN poster): node poster-ar.mjs  -> site/media/qa-wrap-commercial-40s-ar.jpg (+ -ar-1280.jpg) */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const require = createRequire(path.resolve(root, "extension/package.json"));
const { chromium } = require("playwright");
const proj = path.join(root, "work/film/c40/ar-16x9");
const chip = (x, y, r, sz, svg) => `<div class="c" style="left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;transform:rotate(${r}deg)">${svg}</div>`;
const I = {
  sun: '<svg viewBox="0 0 24 24" class="ic amb"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  code: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 8v5M12 16v.5"/></svg>',
  bars: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  cols: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
  timer: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
  cam: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="12" cy="13" r="3"/></svg>',
  input: '<svg viewBox="0 0 24 24" class="ic amb"><rect x="3" y="8" width="18" height="8" rx="3"/><path d="M7 12h6"/></svg>',
};
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:S;src:url("${pathToFileURL(path.join(proj, "assets/fonts/thmanyahsans-Bold.woff2"))}")}
@font-face{font-family:D;src:url("${pathToFileURL(path.join(proj, "assets/fonts/thmanyahserifdisplay-Bold.woff2"))}")}
*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;background:#171a1d;position:relative;overflow:hidden;font-family:S;color:#eceae6}
.g{position:absolute;border-radius:50%;filter:blur(50px)}
.c{position:absolute;border-radius:22px;background:linear-gradient(#2d3238,#23272c);box-shadow:0 14px 30px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.c svg{width:55%;height:55%}.ic{fill:none;stroke:#eceae6;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.amb{stroke:#f0b94a}
.play{position:absolute;left:790px;top:370px;width:340px;height:340px;border-radius:50%;border:2px solid #8c7336;display:flex;align-items:center;justify-content:center}
.play i{width:240px;height:240px;border-radius:50%;background:#f0c05e;box-shadow:0 0 0 24px rgba(240,192,94,.22);display:flex;align-items:center;justify-content:center}
.play b{width:0;height:0;border-left:70px solid #171a1d;border-top:42px solid transparent;border-bottom:42px solid transparent;margin-left:18px}
.pill{position:absolute;left:112px;top:104px;height:64px;padding:0 28px;border-radius:32px;background:#25292e;border:1px solid #343a41;font:700 34px/62px S}
.h{position:absolute;right:112px;top:820px;font:700 112px/1.2 D;direction:rtl;white-space:nowrap}
.l{position:absolute;right:112px;top:92px;direction:ltr;font:700 84px/1 D;color:#f1efea}
</style>
<div class="g" style="left:-500px;top:-300px;width:1300px;height:1300px;background:radial-gradient(circle,rgba(190,80,50,.30),transparent 66%)"></div>
<div class="g" style="left:1000px;top:-200px;width:1300px;height:1300px;background:radial-gradient(circle,rgba(70,150,85,.28),transparent 66%)"></div>
${chip(130, 490, -6, 96, I.cam)}${chip(420, 290, 12, 96, I.sun)}${chip(520, 380, -4, 96, I.sun)}${chip(600, 470, 8, 96, I.code)}${chip(270, 640, -3, 96, I.cols)}${chip(370, 630, 6, 96, I.timer)}${chip(610, 625, 8, 96, I.alert)}
${chip(1215, 380, 0, 96, I.input)}${chip(1465, 520, 0, 96, I.bars)}${chip(1680, 260, 0, 64, I.bars)}${chip(1360, 470, 0, 60, I.sun)}${chip(1650, 720, 0, 64, I.cols)}
<div class="play"><i><b></b></i></div>
<div class="pill">40 ثانية</div>
<div class="l">QA Wrap</div>
<div class="h">تعذر تكرارها؟ <span style="color:#7bd389">الدليل مرفق.</span></div>`;
const tmp = path.join(proj, "poster.html");
fs.writeFileSync(tmp, html);
const b = await chromium.launchPersistentContext("O:/Temp/qaw1109/chrome-qaw-1109", { headless: true, viewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
await p.goto(pathToFileURL(tmp).href);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
const out = path.join(root, "site/media");
await p.screenshot({ path: path.join(out, "qa-wrap-commercial-40s-ar.jpg"), type: "jpeg", quality: 90 });
await p.setViewportSize({ width: 1920, height: 1080 });
await b.close();
console.log(path.join(out, "qa-wrap-commercial-40s-ar.jpg"));
