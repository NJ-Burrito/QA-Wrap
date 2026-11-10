/* Film 3, show-it: "Show It, Don't Describe It" (brand-films.md Film 3). Worker b2, 2026-11-10.
   Words from films.json via K.scr; drawn-page strings via K.N (build-notes.json "show-it").
   16:9 and 9:16 are laid out separately (L(h, v)); 9:16 keeps the world at scale 1 so labels stay >= 28 px. */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, V, iso, N, to, fr, set, out, pop, fadeIn, cam } = K;
const S = (id) => K.scr(id), L = (h, v) => (V ? v : h), w = K.world, f = K.fg;
// 9:16 end-card pills at 30 px (the kit's 27 px is under the phone floor); film-local, the kit is untouched
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".v #ec .v2tg{font-size:30px;height:60px;line-height:58px}" }));
const P30 = "font-size:30px;height:62px;line-height:60px;padding:0 28px;";
K.light([420, 520], [1300, 560]);
if (V) { cam(0, { vs: 1 }); cam(0, { vs: 1 }, f); } // 9:16: world at 1:1, the beats are re-laid out for portrait
const svg = (d, px, st = "") => `<svg viewBox="0 0 24 24" class="ic" style="width:${px}px;height:${px}px;${st}">${d}</svg>`;
const IC = { arrow: '<path d="M5 19L18 6M9 6h9v9"/>', step: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9l2-1.2v8.4"/>', text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  redact: '<rect x="3" y="8" width="18" height="8" rx="1.5" style="fill:#eceae6"/>', film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>' };
// ---------- the cart page (Sauce Demo look). Natural 900 x 560, always LTR. bare = text drawn as bars (thumbnails), marks = the annotate marks
const PW = 900, PH = 560, CN = N.cart;
const tx = (s, x, y, fs, wt, col, bare, extra = "") => bare
  ? `<div class="bar" style="left:${x}px;top:${y + fs * 0.32}px;width:${Math.round(s.length * fs * 0.5)}px;height:${Math.round(fs * 0.42)}px;background:${col};opacity:.55"></div>`
  : `<div class="abs" style="left:${x}px;top:${y}px;font:${wt} ${fs}px/1.2 'Thmanyah Sans';color:${col};white-space:nowrap;${extra}">${s}</div>`;
const cartHTML = (bare, marks) => `
 <div class="abs" style="left:0;right:0;top:0;height:86px;border-bottom:1px solid #343a41"></div>
 ${tx(CN.brand, 30, 24, 34, 900, "#cfcdc8", bare)}${tx(CN.email, 500, 28, 30, 500, "#a5abb0", bare)}
 <div class="abs" style="left:826px;top:22px">${K.ico("bag", "dim", 42)}</div>
 ${tx(CN.title, 30, 108, 32, 700, "#ecebe7", bare)}
 <div class="abs" style="left:30px;top:170px;width:840px;height:150px;border-radius:10px;background:#2a2e33"></div>
 <div class="abs" style="left:54px;top:215px;width:60px;height:60px;border-radius:8px;border:1.5px solid #4a5057;font:500 30px/58px 'Thmanyah Serif Text';text-align:center;color:#d9d7d2">${bare ? "" : CN.qty}</div>
 ${tx(CN.item, 140, 200, 32, 700, "#ecebe7", bare)}${tx(CN.price, 140, 252, 30, 500, "#a5abb0", bare)}
 <div class="abs" style="left:30px;top:450px;width:330px;height:74px;border-radius:10px;border:2px solid #5a6068"></div>${bare ? "" : tx(CN.back, 30, 468, 30, 700, "#e3e1dc", false, "width:330px;text-align:center")}
 <div class="abs" style="left:620px;top:450px;width:250px;height:74px;border-radius:10px;background:#d8d6d1"></div>${bare ? "" : tx(CN.checkout, 620, 468, 30, 700, "#1d2024", false, "width:250px;text-align:center")}
 ${marks ? `<svg class="abs mk" style="left:0;top:0;overflow:visible" width="${PW}" height="${PH}">
   <path class="arw" pathLength="1" d="M330 300 Q520 300 660 438" fill="none" stroke="#7bd389" stroke-width="10" stroke-linecap="round"/>
   <path class="arh" d="M622 436 L668 446 L664 398" fill="none" stroke="#7bd389" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="abs red" style="left:494px;top:20px;width:306px;height:50px;border-radius:6px;background:#0c0e10;border:2px solid #3a4047"></div>` : ""}`;
const pageEl = (x, y, k, bare, marks, p = w, extra = "", PWp = 1920) => {
  const e = add(`<div class="abs" style="left:${AR ? PWp - x - PW * k : x}px;top:${y}px;width:${PW}px;height:${PH}px;transform-origin:0 0;direction:ltr;border-radius:14px;background:#1f2327;border:1px solid #343a41;box-shadow:0 30px 60px rgba(0,0,0,.45);overflow:hidden;${extra}">${cartHTML(bare, marks)}</div>`, p);
  gsap.set(e, { scale: k }); return e; };
// ---------- b1: the ticket's edge frame right third; three coral question bubbles pop onto it (back.out 2, 0.6 s apart)
const TK = L({ x: 1240, y: 230, w: 900, h: 600 }, { x: 1350, y: 110, w: 900, h: 840 });
const ticket = K.card({ ...TK, show: true, html: `
 <div class="abs" style="left:0;right:0;top:0;height:86px;border-bottom:1px solid #343a41"></div>
 <div class="bar" style="inset-inline-start:40px;top:34px;width:300px;background:#4b4f55"></div>
 ${[0, 1, 2, 3].map((i) => `<div class="bar" style="inset-inline-start:40px;top:${130 + i * 46}px;width:${[520, 460, 560, 380][i]}px;height:14px;background:#3a4047"></div>`).join("")}` });
// 9:16: only the ticket's edge is in frame, so the gallery tab sits under the bubbles instead of inside the card
ticket.setAttribute("data-layout-allow-overflow", ""); // the ticket hangs off the frame edge on purpose (only its edge is shown)
const tab = V ? K.pill({ x: 1050, y: 760, anchor: "c", text: S("b6")[0], cls: "lineG", style: P30 }) : K.pill({ x: 40, y: 500, text: S("b6")[0], p: ticket, cls: "lineG", style: P30 });
const BB = L({ x: 760, w: 660, h: 120, fs: 40, ys: [270, 420, 570] }, { x: 690, w: 720, h: 140, fs: 44, ys: [170, 360, 550] });
const SLOT = L(590, 560); // centre x of the media slot on the inline-start side of each bubble (b6)
const bubbles = S("b1").map((t, i) => add(`<div class="abs" style="left:${mx(BB.x, BB.w)}px;top:${BB.ys[i]}px;width:${BB.w}px;height:${BB.h}px;opacity:0;${AR ? "direction:rtl;" : ""}">
  <div class="bb" style="position:absolute;inset:0;border-radius:${BB.h / 2}px;background:linear-gradient(#2c3137,#25292e);border:3px solid #ff7d63;box-shadow:0 20px 40px rgba(0,0,0,.4)"></div>
  <div class="abs" style="inset-inline-start:22px;top:${(BB.h - 70) / 2}px;width:70px;height:70px;border-radius:50%;background:#1f2327;border:2px solid #4a5057;display:flex;align-items:center;justify-content:center">${K.ico("chat", "dim", 36)}</div>
  <div class="lbl" style="position:absolute;inset-inline-start:114px;top:${(BB.h - BB.fs * 1.25) / 2}px;font:700 ${BB.fs}px/1.25 'Thmanyah Sans';color:#f1efea">${iso(t)}</div>
  <div class="abs bc" style="inset-inline-end:28px;top:${(BB.h - 56) / 2}px;width:56px;height:56px;opacity:0">${K.CHECK}</div></div>`));
bubbles.forEach((b, i) => pop(b, 0.3 + i * 0.6, 0.45, 2, 0.4));
// exit: the ticket slides out past the frame edge, the bubbles shrink (the flash wipes the frame at 5.5)
to(ticket, { x: SG(560), opacity: 0, duration: 0.5, ease: "power2.in" }, 4.3);
to(bubbles, { scale: 0.8, opacity: 0, duration: 0.3, ease: "power2.in" }, 4.3);
// ---------- b2: the cart page; Take a screenshot (Alt+C) pressed; the flash; the still lifts off and lands on the session line at 00:23
const PG = L({ x: 200, y: 240, k: 740 / PW }, { x: 532, y: 70, k: 0.95 });
const page = pageEl(PG.x, PG.y, PG.k, false, false);
gsap.set(page, { opacity: 0 });
fr(page, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45 }, 4.6);
const S2 = S("b2");
const BT = L({ x: 1040, y: 280, w: 560 }, { x: 490, y: 650, w: 560 });
const shotB = K.btn({ x: BT.x, y: BT.y, w: BT.w, h: 104, text: `${svg('<rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="12" cy="13" r="3"/><path d="M9 7l1.5-2h3L15 7"/>', 40, "stroke:#2a2008;margin-inline-end:16px")}${S2[0]}`, style: "font-size:32px" });
const altC = K.pill({ x: L(BT.x + BT.w / 2, 1200), y: L(BT.y + 160, BT.y + 52), anchor: "c", text: S2[1], style: P30 + "direction:ltr" });
pop(shotB, 4.8, 0.4, 2, 0.4); pop(altC, 5.05, 0.3, 2, 0.5);
const cur = K.cursor();
const btnC = [BT.x + BT.w / 2, BT.y + 52];
cur.at(4.75, L(1800, 1300), L(1000, 990)).to(4.85, btnC[0], btnC[1], 0.4); K.press(shotB, 5.3); cur.press(5.3, btnC[0], btnC[1]); cur.hide(5.8);
const flash = add('<div data-layout-ignore style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:40"></div>', K.ui);
fr(flash, { opacity: 0 }, { opacity: 0.85, duration: 0.04, ease: "none" }, 5.5); to(flash, { opacity: 0, duration: 0.08, ease: "none" }, 5.54);
// the session line (time: linear, AR right to left) and its dot at the still's moment
const LN = L({ x0: 160, x1: 1760, y: 790, dot: 1290 }, { x0: 470, x1: 1450, y: 915, dot: 1230 });
const line = add(`<div class="abs" style="left:${mx(LN.x0, LN.x1 - LN.x0)}px;top:${LN.y - 2}px;width:${LN.x1 - LN.x0}px;height:4px;border-radius:2px;background:#dddbd6;opacity:0;transform-origin:${AR ? "100%" : "0"} 50%"></div>`);
fr(line, { opacity: 1, scaleX: 0 }, { scaleX: 1, duration: 1.3, ease: "none" }, 6.2);
const dot = add(`<div class="dot" style="left:${MX(LN.dot)}px;top:${LN.y}px;width:30px;height:30px;margin:-15px 0 0 -15px;background:#7bd389;opacity:0;box-shadow:0 0 0 6px rgba(123,211,137,.18)"></div>`);
const t23 = K.pill({ x: L(LN.dot, LN.dot - 170), y: L(LN.y + 56, LN.y), anchor: "c", text: S2[2], style: P30 + "direction:ltr;font-family:'Thmanyah Serif Text';font-weight:500" });
// the still: a copy of the page lifts (back.out 1.6), hovers, then flies on an arc and lands above the dot as a thumbnail
const TH = { w: 240, k: 240 / PW }, TH_H = PH * TH.k;
const land = { x: LN.dot - TH.w / 2, y: LN.y - 34 - TH_H };
const still = pageEl(PG.x, PG.y, PG.k, false, false, w, "border:4px solid #f1efea;opacity:0");
const thumb0 = pageEl(land.x, land.y, TH.k, true, false, w, "border:3px solid #f1efea;opacity:0");
// the lifted still, the thumbnails and the strip frames are pictures of the page (texture, not reading): the layout audit skips them
[still, thumb0].forEach((e) => e.setAttribute("data-layout-ignore", ""));
set(still, { opacity: 1 }, 5.6);
to(still, { scale: PG.k * 1.05, y: -34, boxShadow: "0 50px 90px rgba(0,0,0,.6)", duration: 0.5, ease: "back.out(1.6)" }, 5.65);
const dx = (AR ? 1920 - land.x - TH.w : land.x) - (AR ? 1920 - PG.x - PW * PG.k : PG.x);
K.tl.to(still, { keyframes: [{ x: dx * 0.5, y: -150, scale: (PG.k + TH.k) / 2, duration: 0.25, ease: "sine.out" }, { x: dx, y: land.y - PG.y, scale: TH.k, duration: 0.25, ease: "sine.in" }] }, 7.4);
set(still, { opacity: 0 }, 7.9); set(thumb0, { opacity: 1 }, 7.9);
pop(dot, 7.9, 0.3, 2.5, 0.3); pop(t23, 8.0, 0.3, 2, 0.5);
// ---------- b3: push-in (1.6x) on the still; the markup canvas; Arrow draws to Checkout, Step 1 pops, Redact slams over the email
const thC = [LN.dot, land.y + TH_H / 2];
cam(10.0, { s: 1.6, x: -(thC[0] - 960) * 1.6, y: -(thC[1] - 540) * 1.6, vs: 1.6, vx: -(thC[0] - 960) * 1.6, vy: -(thC[1] - 540) * 1.6, d: 0.7 });
to(w, { opacity: 0.22, filter: "blur(5px)", duration: 0.5 }, 10.2);
const CV = L({ x: 345, y: 225, w: 1230, h: 640 }, { x: 450, y: 90, w: 1020, h: 800 });
const SK = L(1, 960 / PW);
const canvas = K.card({ ...CV, p: f, style: "border-color:#3f6d49;box-shadow:0 30px 60px rgba(0,0,0,.45),0 0 40px rgba(123,211,137,.12)" });
const names = S("b3");
const rail = [IC.arrow, IC.step, IC.text, IC.redact].map((ic, i) => {
  const R = L({ x: 30, y: 40 + i * 136, w: 230, h: 116 }, { x: 30 + i * 246, y: 28, w: 230, h: 116 });
  return add(`<div class="abs" style="inset-inline-start:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px;border-radius:14px;background:#2a2e33;border:2px solid #3a4047;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;opacity:0">
   ${svg(ic, 40)}<div class="lbl" style="font-size:30px">${iso(names[i])}</div></div>`, canvas); });
const SX = L(290, 30), SY = L(40, 168), SWd = PW * SK;
const big = pageEl(SX, SY, SK, false, true, canvas, "", CV.w);
const q = (s) => big.querySelector(s);
const badge = add(`<div class="abs" style="left:540px;top:440px;width:84px;height:84px;border-radius:50%;background:#7bd389;color:#10331a;font:500 48px/84px 'Thmanyah Serif Text';text-align:center;opacity:0;box-shadow:0 8px 20px rgba(0,0,0,.4)">${names[4]}</div>`, big);
gsap.set(q(".arw"), { strokeDasharray: 1, strokeDashoffset: 1 }); gsap.set(q(".arh"), { opacity: 0 }); gsap.set(q(".red"), { opacity: 0 });
fr(canvas, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.55, ease: "power2.inOut" }, 10.3);
rail.forEach((r, i) => pop(r, 10.7 + i * 0.08, 0.3, 2, 0.5));
const act = (i, at, until) => { fr(rail[i], { borderColor: "#3a4047", backgroundColor: "#2a2e33" }, { borderColor: "#7bd389", backgroundColor: "#2f3a33", duration: 0.15 }, at);
  if (until) to(rail[i], { borderColor: "#3a4047", backgroundColor: "#2a2e33", duration: 0.15 }, until); };
act(0, 11.5, 12.6); act(1, 12.6, 13.1); act(3, 13.1);
fr(q(".arw"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 12.0);
pop(q(".arh"), 12.55, 0.25, 2, 0.3);
pop(badge, 12.7, 0.35, 2, 0.3);
fr(q(".red"), { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.25, ease: "power4.in" }, 13.15);
out([page, shotB, altC, line, dot, t23, thumb0], 10.6, 0.2);
// out: pull-out; the canvas shrinks into a thumbnail parked top inline-end (it waits for the answer in b6)
const TRAY = L({ x: 1520, y: 64 }, { x: 1210, y: -300 });
const thumb = pageEl(TRAY.x, TRAY.y, TH.k, true, true, w, "border:3px solid #f1efea;opacity:0");
thumb.setAttribute("data-layout-ignore", "");
const badge2 = add(`<div class="abs" style="left:${MX(TRAY.x - 56) - 36}px;top:${TRAY.y + TH_H / 2 - 36}px;width:72px;height:72px;border-radius:50%;background:#7bd389;color:#10331a;font:500 42px/72px 'Thmanyah Serif Text';text-align:center;opacity:0">${names[4]}</div>`);
to(canvas, { scale: 0.22, opacity: 0, x: SG((TRAY.x + 120) - (CV.x + CV.w / 2)), y: TRAY.y + 75 - (CV.y + CV.h / 2), duration: 0.45, ease: "power2.in" }, 16.0);
cam(16.15, { s: 1, vs: 1, d: 0.5 }); to(w, { opacity: 1, filter: "blur(0px)", duration: 0.4 }, 16.2);
fr(thumb, { opacity: 0, scale: TH.k * 0.6 }, { opacity: 1, scale: TH.k, duration: 0.35, ease: "back.out(1.6)" }, 16.4); pop(badge2, 16.5, 0.3, 2, 0.4);
// ---------- b4: Record the screen; the rec dot breathes; the strip draws (linear) while the counter runs; mic and webcam ride; MP4 · WebM · GIF
const S4 = S("b4");
const RB = L({ x: 160, y: 250 }, { x: 490, y: 90 });
const recB = K.btn({ x: RB.x, y: RB.y, h: 100, text: N.recordBtn[K.LANG], style: "font-size:32px" }); // p2 fix a: overlay.bar.f1022Record, not films.json «سجل الشاشة»
pop(recB, 16.6, 0.4, 2, 0.4);
cur.at(16.7, L(900, 1300), L(420, 400)).to(16.75, RB.x + 150, RB.y + 50, 0.25); K.press(recB, 17.0); cur.press(17.0, RB.x + 150, RB.y + 50); cur.hide(17.4);
const fill = (s, m, sec) => (AR ? s.replace(/\d+ د \d+ ث/, `${m} د ${String(sec).padStart(2, "0")} ث`) : s.replace(/\d+m \d+s/, `${m}m ${String(sec).padStart(2, "0")}s`));
const STEPS = 40, vals = [...Array(STEPS + 1)].map((_, k) => 1 + Math.round((133 * k) / STEPS));
const counter = K.label({ x: L(RB.x + 520, RB.x), y: L(RB.y + 28, RB.y + 128), size: 32, style: "font-weight:700;opacity:0", text:
  `<span class="rd" style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#ff7d63;margin-inline-end:16px;vertical-align:-2px"></span>` +
  vals.map((v) => `<span class="cv" style="display:none">${iso(fill(S4[1], Math.floor(v / 60), v % 60))}</span>`).join("") });
const cvs = [...counter.querySelectorAll(".cv")];
gsap.set(cvs[0], { display: "inline" });
const R0 = 17.2, R1 = 21.9;
cvs.forEach((c, k) => { if (k) set(c, { display: "inline" }, R0 + (k * (R1 - R0)) / STEPS); if (k < STEPS) set(c, { display: "none" }, R0 + ((k + 1) * (R1 - R0)) / STEPS); });
fadeIn(counter, 17.1, 0.25);
tl2();
function tl2() { K.tl.fromTo(counter.querySelector(".rd"), { opacity: 1 }, { opacity: 0.3, duration: 0.6, yoyo: true, repeat: 9, ease: "sine.inOut", immediateRender: false }, 17.2); }
const ST = L({ x: 160, y: 410, w: 1600, h: 220 }, { x: 440, y: 330, w: 1040, h: 240 });
const FRW = 300, FRK = (ST.h - 70) / PH, FRWd = PW * FRK, nF = Math.ceil(ST.w / (FRWd + 30));
const strip = add(`<div class="abs" style="left:${mx(ST.x, ST.w)}px;top:${ST.y}px;width:${ST.w}px;height:${ST.h}px;border-radius:12px;background:#2a2e33;border:1px solid #3f454c;box-shadow:0 24px 50px rgba(0,0,0,.4);overflow:hidden;opacity:0">
  <div class="abs" style="left:0;right:0;top:8px;height:16px;background:repeating-linear-gradient(90deg,#1b1e22 0 16px,transparent 16px 34px)"></div>
  <div class="abs" style="left:0;right:0;bottom:8px;height:16px;background:repeating-linear-gradient(90deg,#1b1e22 0 16px,transparent 16px 34px)"></div></div>`);
for (let i = 0; i < nF; i++) { const fx = 16 + i * (FRWd + 30); pageEl(fx, 35, FRK, true, false, strip, "box-shadow:none", ST.w); }
strip.setAttribute("data-layout-ignore", "");
void FRW;
fr(strip, { opacity: 1, clipPath: AR ? "inset(0% 0% 0% 100%)" : "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: R1 - 0.3 - R0, ease: "none" }, R0);
const riders = [
  add(`<div class="abs" style="left:${MX(ST.x) - 50}px;top:${ST.y + ST.h + 22}px;width:100px;height:76px;border-radius:16px;background:linear-gradient(#2d3238,#23272c);border:1px solid #3a3f46;display:flex;align-items:center;justify-content:center;gap:5px;opacity:0">${[22, 40, 30, 50, 26, 36].map((hh) => `<i style="display:block;width:6px;height:${hh}px;border-radius:3px;background:#eceae6"></i>`).join("")}</div>`),
  add(`<div class="abs" style="left:${MX(ST.x) - 46 - SG(130)}px;top:${ST.y + ST.h + 14}px;width:92px;height:92px;border-radius:50%;background:#1f2327;border:3px solid #9aa0a6;display:flex;align-items:center;justify-content:center;opacity:0">${K.ico("cam", "", 44)}</div>`)];
riders.forEach((r) => { fr(r, { opacity: 0 }, { opacity: 1, duration: 0.25 }, R0 + 0.1); to(r, { x: SG(ST.w - 40), duration: R1 - 0.3 - R0, ease: "none" }, R0); });
const fmts = K.row({ x: 960, y: L(ST.y + ST.h + 130, ST.y + ST.h + 150), anchor: "c", gap: 18, style: "direction:ltr", items: S4.slice(2).map((t) => ({ text: t, cls: "lineG", style: P30 })) });
fmts.forEach((p, i) => pop(p, 21.9 + i * 0.1, 0.35, 2, 0.4));
// ---------- b5: the strip curls into a ring that keeps turning (the rolling buffer); a coral flicker on the page; Save last 1 minute; the last arc drops out as a 01:00 clip
const S5 = S("b5");
const RC = L({ x: 760, y: 545, r: 280 }, { x: 900, y: 540, r: 200 });
out([recB, counter, ...fmts, ...riders], 23.0, 0.25);
to(strip, { scaleX: 0.25, scaleY: 0.6, opacity: 0, duration: 0.45, ease: "power2.in" }, 23.0);
const ringBox = 2 * RC.r + 120;
const ring = add(`<div class="abs" style="left:${MX(RC.x) - ringBox / 2}px;top:${RC.y - ringBox / 2}px;width:${ringBox}px;height:${ringBox}px;opacity:0">
 <svg viewBox="0 0 ${ringBox} ${ringBox}" width="100%" height="100%" style="overflow:visible"><g class="rot" style="transform-origin:50% 50%">
  <circle cx="${ringBox / 2}" cy="${ringBox / 2}" r="${RC.r}" fill="none" stroke="#2a2e33" stroke-width="96"/>
  <circle cx="${ringBox / 2}" cy="${ringBox / 2}" r="${RC.r}" fill="none" stroke="#4b5057" stroke-width="56" stroke-dasharray="44 12"/>
  <circle cx="${ringBox / 2}" cy="${ringBox / 2}" r="${RC.r + 38}" fill="none" stroke="#1b1e22" stroke-width="8" stroke-dasharray="9 13"/>
  <circle cx="${ringBox / 2}" cy="${ringBox / 2}" r="${RC.r - 38}" fill="none" stroke="#1b1e22" stroke-width="8" stroke-dasharray="9 13"/></g>
  <path class="arc" d="${(() => { const c = ringBox / 2, a0 = -80 * Math.PI / 180, a1 = -20 * Math.PI / 180, sx = AR ? -1 : 1; const p = (a) => `${c + sx * RC.r * Math.cos(a)} ${c + RC.r * Math.sin(a)}`; return `M${p(a0)} A${RC.r} ${RC.r} 0 0 ${AR ? 0 : 1} ${p(a1)}`; })()}" fill="none" stroke="#f0b94a" stroke-width="60" opacity="0"/></svg></div>`);
fr(ring, { opacity: 0, scale: 0.35 }, { opacity: 1, scale: 1, duration: 0.55, ease: "power2.out" }, 23.25);
fr(ring.querySelector(".rot"), { rotation: 0 }, { rotation: SG(360 * 1.6), duration: 29.3 - 23.25, ease: "none" }, 23.25);
const PM = L({ x: 60, y: 345, k: 0.38 }, { x: 1110, y: 80, k: 0.38 });
const mini = pageEl(PM.x, PM.y, PM.k, true, false, w, "opacity:0");
mini.setAttribute("data-layout-ignore", "");
const flick = add(`<div class="abs" style="left:${mx(PM.x, PW * PM.k)}px;top:${PM.y}px;width:${PW * PM.k}px;height:${PH * PM.k}px;border-radius:8px;border:4px solid #ff7d63;box-shadow:0 0 30px rgba(255,125,99,.5);opacity:0"></div>`);
fadeIn(mini, 23.4, 0.35, 14);
[0, 1, 2].forEach((k) => { set(flick, { opacity: 1 }, 23.9 + k * 0.18); set(flick, { opacity: 0 }, 23.99 + k * 0.18); });
set(flick, { opacity: 0.55 }, 24.45);
const SB = L({ x: 1180, y: 250 }, { x: 490, y: 90 });
const saveB = K.btn({ x: SB.x, y: SB.y, h: 100, text: S5[0], style: "font-size:32px" });
pop(saveB, 24.2, 0.4, 2, 0.4);
cur.at(24.3, L(1700, 1300), L(700, 640)).to(24.35, SB.x + 170, SB.y + 50, 0.4); K.press(saveB, 25.0); cur.press(25.0, SB.x + 170, SB.y + 50); cur.hide(25.4);
const arc = ring.querySelector(".arc");
fr(arc, { opacity: 0 }, { opacity: 0.9, duration: 0.2, ease: "none" }, 24.85); // anticipation: the last minute lights amber on the ring
to(arc, { opacity: 0, duration: 0.25 }, 25.3);
const CL = L({ x: 1130, y: 470, w: 640, h: 150 }, { x: 560, y: 820, w: 800, h: 150 });
const clip = add(`<div class="card" style="left:${mx(CL.x, CL.w)}px;top:${CL.y}px;width:${CL.w}px;height:${CL.h}px;opacity:0;border-color:#8a6a2a;${AR ? "direction:rtl;" : ""}">
  <div class="abs" style="inset-inline-start:30px;top:31px;width:88px;height:88px;border-radius:20px;background:#2d3238;display:flex;align-items:center;justify-content:center">${svg(IC.film, 52, "stroke:#f0b94a")}</div>
  <div class="abs" style="inset-inline-start:150px;top:22px;font:500 84px/104px 'Thmanyah Serif Text';color:#f1efea"><bdi dir="ltr">${S5[1]}</bdi></div>
  <div class="abs" style="inset-inline-end:34px;top:52px;width:${CL.w - 470}px;height:46px;border-radius:8px;background:repeating-linear-gradient(90deg,#f0b94a 0 34px,transparent 34px 44px);opacity:.75"></div></div>`);
const arcPt = [RC.x + RC.r * Math.cos(-50 * Math.PI / 180), RC.y + RC.r * Math.sin(-50 * Math.PI / 180)];
fr(clip, { opacity: 0, scale: 0.3, x: SG(arcPt[0] - (CL.x + CL.w / 2)), y: arcPt[1] - (CL.y + CL.h / 2) }, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.6, ease: "back.out(1.4)" }, 25.3);
// ---------- b6: the bookend: the ticket and its three bubbles return; still, Step 1 and the clip snap to them on arcs; each turns green; Screens & video lights
out([ring, mini, flick, saveB], 29.0, 0.3);
to(ticket, { x: 0, opacity: 1, duration: 0.5, ease: "power2.out" }, 29.1);
bubbles.forEach((b, i) => to(b, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(1.6)" }, 29.2 + i * 0.08));
K.glow("green", 29.2, L(1100, 1000), L(450, 500), 1.0);
const slotY = (i) => BB.ys[i] + BB.h / 2;
const flyTo = (el, from, toC, t0, sc, d = 0.5) => {
  const ddx = SG(toC[0] - from[0]), ddy = toC[1] - from[1];
  K.tl.to(el, { keyframes: [{ x: ddx * 0.5, y: ddy * 0.5 - 140, scale: 1 + (sc - 1) * 0.5, duration: d / 2, ease: "sine.out" }, { x: ddx, y: ddy, scale: sc, duration: d / 2, ease: "back.out(1.4)" }] }, t0); };
// the thumbnail: origin 0 0 at scale TH.k; send its top-left so it centres on slot 1
gsap.set(thumb, { transformOrigin: "0 0" });
const thSc = L(1, 0.85);
const tgtL = SLOT - 120 * thSc, thDx = AR ? (TRAY.x + 240) - (tgtL + 240 * thSc) : tgtL - TRAY.x;
K.tl.to(thumb, { keyframes: [{ x: thDx * 0.5, y: (slotY(0) - TH_H * thSc / 2 - TRAY.y) * 0.5 - 120, duration: 0.25, ease: "sine.out" }, { x: thDx, y: slotY(0) - TH_H * thSc / 2 - TRAY.y, scale: TH.k * thSc, duration: 0.25, ease: "back.out(1.4)" }] }, 29.6);
flyTo(badge2, [TRAY.x - 56, TRAY.y + TH_H / 2], [SLOT, slotY(1)], 30.1, 1);
flyTo(clip, [CL.x + CL.w / 2, CL.y + CL.h / 2], [SLOT, slotY(2)], 30.5, L(0.45, 0.33));
const green = (b, at) => { to(b.querySelector(".bb"), { borderColor: "#7bd389", boxShadow: "0 0 0 4px rgba(123,211,137,.25), 0 0 34px rgba(123,211,137,.35)", duration: 0.2 }, at); pop(b.querySelector(".bc"), at, 0.3, 2.5, 0.3); };
green(bubbles[0], 30.1); green(bubbles[1], 30.6); green(bubbles[2], 31.0);
pop(tab, 31.2, 0.35, 2, 0.5);
// ---------- p2 polish: an anticipation glow before each amber press, and slow sine drifts of the camera on the holds
// (no frame sits frozen; each drift hands over to the next beat's own camera move)
const glowBtn = (el, at) => fr(el, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 0 0 rgba(240,185,74,0)" }, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 34px 6px rgba(240,185,74,.35)", duration: 0.25, ease: "sine.inOut" }, at);
glowBtn(shotB, 5.0); glowBtn(recB, 16.72); glowBtn(saveB, 24.7);
cam(0.15, { s: 1.03, vs: 1.03, d: 4.0, ease: "sine.inOut" }); cam(4.2, { s: 1, vs: 1, d: 0.5 }); // b1 breathes, settles for the page
cam(8.2, { s: 1.025, vs: 1.025, d: 1.8, ease: "sine.inOut" }); // b2 hold after the landing; b3's push-in takes over at 10.0
cam(13.5, { s: 1.025, vs: 1.025, d: 2.4, ease: "sine.inOut" }, f); cam(15.95, { s: 1, vs: 1, d: 0.4 }, f); // b3 canvas hold
cam(17.5, { s: 1.02, vs: 1.02, d: 5.3, ease: "sine.inOut" }); // b4 while the strip runs
cam(25.9, { s: 1.045, vs: 1.045, d: 3.0, ease: "sine.inOut" }); // b5 after the clip drops out
cam(29.0, { s: 1, vs: 1, d: 0.6 }); cam(31.4, { s: 1.03, vs: 1.03, d: 3.0, ease: "sine.inOut" }); // b6: back to 1 for the flights, then the payoff breathes
// ---------- b7: shared end card
K.titles({ b1: [0, 4.15] });
K.captions();
K.endCard(K.beat("b7"), undefined, { links: true }); // p2 fix c
K.done();
})();
