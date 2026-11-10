/* Film 4, the-toolbox: "The Whole Toolbox" (brand-films.md Film 4). Worker b2, 2026-11-10.
   Words from films.json via K.scr; drawn-page strings via K.N (build-notes.json "the-toolbox").
   16:9 and 9:16 are laid out separately (L(h, v)); 9:16 keeps the world near 1:1 so labels stay >= 28 px. */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, V, iso, N, to, fr, set, out, pop, fadeIn, cam } = K;
const S = (id) => K.scr(id), L = (h, v) => (V ? v : h), w = K.world, f = K.fg;
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".v #ec .v2tg{font-size:30px;height:60px;line-height:58px}" }));
const P30 = "font-size:30px;height:62px;line-height:60px;padding:0 28px;", ORANGE = N.stressColour.value;
K.light([420, 520], [1100, 540]);
if (V) { cam(0, { vs: 1 }); cam(0, { vs: 1 }, f); }
const svg = (d, px, st = "") => `<svg viewBox="0 0 24 24" class="ic" style="width:${px}px;height:${px}px;${st}">${d}</svg>`;
const IC = { person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>', a11y: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8.5l7 1.5 7-1.5M12 10v5l-3 6M12 15l3 6"/>',
  stress: '<path d="M4 7h16M4 12h11M4 17h16M18 10l3 2-3 2"/>', size: '<rect x="3" y="4" width="11" height="16" rx="2"/><rect x="16" y="9" width="5" height="11" rx="1"/>',
  pliers: '<path d="M7 3l4 8M13 3l-2 8M11 11l-5 10M11 11l5 10"/>', hammer: '<path d="M4 6h10l3 3-3 3H4zM9 12v9"/>', cookie: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r="1"/><circle cx="14" cy="14" r="1"/><circle cx="14" cy="8.5" r=".8"/>' };
const S2 = S("b2"), NAMES = S2.slice(1); // the eight tool rows, in the popup's order
const RICON = [K.ico("code", "", 36), K.ico("alert", "", 36), K.ico("cols", "", 36), svg(IC.stress, 36), K.ico("cross", "", 36), svg(IC.size, 36), svg(IC.a11y, 36), K.ico("timer", "", 36)]; // p2: 36 px icons in the larger rows
// ---------- drawn pages (Practice Software Testing look, always LTR, page text Latin in AR)
const SH = N.shop;
const at = (s, x, y, fs, wt, col, extra = "") => `<div class="abs" style="left:${x}px;top:${y}px;font:${wt} ${fs}px/1.2 'Thmanyah Sans';color:${col};white-space:nowrap;${extra}">${s}</div>`;
const pageBox = (x, y, W, H, k, html, p = w, extra = "") => { const e = add(`<div class="abs" style="left:${AR ? 1920 - x - W * k : x}px;top:${y}px;width:${W}px;height:${H}px;transform-origin:0 0;direction:ltr;border-radius:14px;background:#1f2327;border:1px solid #343a41;box-shadow:0 30px 60px rgba(0,0,0,.45);overflow:hidden;${extra}">${html}</div>`, p); gsap.set(e, { scale: k }); return e; };
const head = (W, fs) => `<div class="abs" style="left:0;right:0;top:0;height:${fs * 2.6}px;border-bottom:1px solid #343a41"></div>${at(SH.brand, 30, fs * 0.7, fs, 900, "#cfcdc8")}
  <div class="abs av" style="left:${W - fs * 2.4}px;top:${fs * 0.4}px;width:${fs * 1.8}px;height:${fs * 1.8}px;border-radius:50%;background:#2d3238;border:2px solid #5a6068;display:flex;align-items:center;justify-content:center">${svg(IC.person, fs)}</div>`;
// the listing (b1): two product tiles
const LW = 640, LH = 400;
const listHTML = `${head(LW, 30)}${[0, 1].map((i) => `<div class="abs" style="left:${30 + i * 300}px;top:100px;width:280px;height:280px;border-radius:12px;background:#2a2e33">
  <div class="abs" style="left:0;right:0;top:0;height:150px;display:flex;align-items:center;justify-content:center">${svg(i ? IC.hammer : IC.pliers, 90, "stroke:#9aa0a6")}</div>
  ${at(SH.items[i], 16, 168, 26, 700, "#ecebe7")}${at(SH.prices[i], 16, 212, 26, 500, "#a5abb0", "font-family:'Thmanyah Serif Text'")}</div>`).join("")}`;
// the product page (b3-b6): natural 1100 x 620
const PW = 1100, PH = 620;
const prodHTML = `${head(PW, 36)}
 <div class="abs" style="left:40px;top:130px;width:400px;height:400px;border-radius:12px;background:#2a2e33;display:flex;align-items:center;justify-content:center">${svg(IC.pliers, 220, "stroke:#9aa0a6;stroke-width:1.6")}</div>
 ${at(SH.items[0], 500, 126, 42, 700, "#ecebe7", "transform-origin:0 50%").replace('class="abs"', 'class="abs nm"')}
 <div class="abs" style="left:500px;top:200px;width:96px;height:66px;border-radius:8px;border:1.5px solid #4a5057"></div>
 ${at(SH.prices[0], 514, 210, 38, 500, "#d9d7d2", "font-family:'Thmanyah Serif Text'").replace('class="abs"', 'class="abs pr"')}
 ${at(SH.qty, 500, 300, 34, 700, "#a5abb0")}
 <div class="abs qf" style="left:500px;top:350px;width:160px;height:72px;border-radius:10px;border:1.5px solid #4a5057;background:#24282c"></div>
 <div class="abs qv1" style="left:500px;top:350px;width:160px;font:500 36px/72px 'Thmanyah Serif Text';text-align:center;color:#ecebe7">1</div>
 <div class="abs qv2" style="left:500px;top:350px;width:160px;font:500 36px/72px 'Thmanyah Serif Text';text-align:center;color:#f0b94a;opacity:0">${N.nasty.value}</div>
 <div class="abs add" style="left:690px;top:350px;width:370px;height:72px;border-radius:10px;background:#33383e;font:700 34px/72px 'Thmanyah Sans';text-align:center;color:#7b8187">${SH.add}</div>
 <div class="abs nx" style="left:860px;top:500px;width:200px;height:72px;border-radius:10px;border:2px solid #5a6068;font:700 34px/68px 'Thmanyah Sans';text-align:center;color:#e3e1dc">${S("b5")[0]}</div>`;
// ---------- b1: the listing small in the centre, five grey tool windows drift round it (high angle, sine.inOut)
const LP = L({ x: 640, y: 300, k: 1 }, { x: 640, y: 340, k: 1 });
const list = pageBox(LP.x, LP.y, LW, LH, LP.k, listHTML, w, "border-color:#3f454c");
const WN = L({ w: 330, h: 180, c: [[340, 360], [1580, 340], [330, 700], [1590, 700], [960, 830]] }, { w: 300, h: 170, c: [[640, 180], [1280, 170], [620, 880], [960, 880], [1300, 880]] });
const WI = [K.ico("timer", "dim", 46), svg(IC.a11y, 46, "stroke:#9aa0a6"), K.ico("code", "dim", 46), svg(IC.cookie, 46, "stroke:#9aa0a6"), K.ico("bars", "dim", 46)];
const wins = S("b1").map((t, i) => { const [cx, cy] = WN.c[i];
  const e = add(`<div class="abs" style="left:${MX(cx) - WN.w / 2}px;top:${cy - WN.h / 2}px;width:${WN.w}px;height:${WN.h}px;border-radius:14px;background:#2a313b;border:1px solid #3a4250;box-shadow:0 20px 40px rgba(0,0,0,.35);opacity:.9;filter:blur(.6px);${AR ? "direction:rtl;" : ""}">
   <div class="abs" style="left:0;right:0;top:0;height:40px;border-bottom:1px solid #3a4250"></div>
   ${[0, 1, 2].map((d) => `<i class="abs" style="inset-inline-start:${18 + d * 20}px;top:14px;width:12px;height:12px;border-radius:50%;background:#4a5363"></i>`).join("")}
   <div class="abs" style="inset-inline-start:24px;top:${40 + (WN.h - 40 - 50) / 2}px;width:50px;height:50px">${WI[i]}</div>
   <div class="lbl" style="position:absolute;inset-inline-start:92px;top:${40 + (WN.h - 40 - 38) / 2}px;font-size:30px;color:#c3c8cf">${iso(t)}</div></div>`);
  gsap.set(e, { transformPerspective: 1600, rotationX: 14 });
  e.setAttribute("data-layout-allow-overlap", ""); // b7: the windows return as fading ghosts behind the popup
  K.tl.fromTo(e, { y: 0, rotation: 0 }, { y: [-10, 8, -6, 10, -8][i], rotation: SG([-1.5, 1.2, 1, -1.2, .8][i]), duration: 1.4 + i * 0.1, ease: "sine.inOut", yoyo: true, repeat: 2, immediateRender: false }, 0);
  return e; });
gsap.set(list, { transformPerspective: 1600, rotationX: 14 });
// ---------- b2: graphic match: the windows fly on arcs into one point, the point opens as the QA Wrap popup; rows tick in top to bottom
const meterH = L(84, 100);
const PU = L({ x: 820, y: 60, w: 920, pitch: 68, fs: 36, top: 172 }, { x: 470, y: 80, w: 980, pitch: 72, fs: 34, top: 196 });
PU.h = PU.top + 8 * PU.pitch + meterH + 10;
const ptc = [PU.x + PU.w / 2, PU.y + PU.h / 2];
wins.forEach((e, i) => { const [cx, cy] = WN.c[i], ddx = SG(ptc[0] - cx), ddy = ptc[1] - cy;
  K.tl.to(e, { keyframes: [{ x: ddx * 0.55, y: ddy * 0.45 - 90, scale: 0.6, rotationX: 0, duration: 0.4, ease: "power2.in" }, { x: ddx, y: ddy, scale: 0.08, opacity: 0, duration: 0.4, ease: "power2.out" }] }, 4.6 + i * 0.04); });
to(list, { x: SG(L(-540, 0)), scale: L(0.95, 1), rotationX: 0, opacity: L(0.45, 0), duration: 0.8, ease: "power2.inOut" }, 4.7);
const popup = (o, rows, cls = "") => {
  const c = K.card({ x: o.x, y: o.y, w: o.w, h: o.h, cls, style: "border-color:#3f6d49;box-shadow:0 30px 60px rgba(0,0,0,.45),0 0 40px rgba(123,211,137,.12)", html: `
   <div class="abs" style="inset-inline-start:30px;top:24px;width:${L(58, 66)}px;height:${L(48, 55)}px">${K.MARK()}</div>
   <div class="abs" style="${K.start(L(104, 116))}top:22px;font:700 ${L(36, 40)}px/52px 'Thmanyah Serif Display';color:#f1efea;direction:ltr">${N.qaWrap}</div>
   <div class="abs" style="left:0;right:0;top:${L(92, 104)}px;height:1px;background:#343a41"></div>` });
  const els = rows.map((r, i) => add(`<div class="abs" style="inset-inline-start:24px;top:${o.top + i * o.pitch}px;width:${o.w - 48}px;height:${o.pitch - 8}px;border-radius:12px;border:2px solid transparent;display:flex;align-items:center;gap:18px;padding-inline:14px">
    <div style="width:${o.pitch - 18}px;height:${o.pitch - 18}px;border-radius:10px;background:#2d3238;display:flex;align-items:center;justify-content:center;flex:none">${RICON[r]}</div>
    <div class="lbl" style="font-size:${o.fs}px">${iso(NAMES[r])}</div>
    <div class="tk" style="margin-inline-start:auto;width:${o.pitch - 22}px;height:${o.pitch - 22}px;flex:none;opacity:0">${K.CHECK}</div></div>`, c));
  return { c, els };
};
const P2 = popup(PU, [0, 1, 2, 3, 4, 5, 6, 7]);
const fold = add(`<div class="abs" style="inset-inline-start:30px;top:${L(112, 126)}px;display:flex;align-items:center;gap:14px">
  <div class="lbl" style="font:900 ${L(30, 34)}px/40px 'Thmanyah Sans';letter-spacing:.06em;color:#f1efea">${iso(S2[0])}</div>${svg('<path d="M6 9l6 6 6-6"/>', 30)}</div>`, P2.c);
fr(P2.c, { opacity: 0, scale: 0.08 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.4)" }, 5.5);
P2.els.forEach((r) => gsap.set(r, { opacity: 0 })); // p2: rows hidden until they tick in (they showed, then re-ran, from 5.5)
P2.els.forEach((r, i) => { fr(r, { opacity: 0, x: SG(-24) }, { opacity: 1, x: 0, duration: 0.2, ease: "none" }, 6.2 + i * 0.12); pop(r.querySelector(".tk"), 6.3 + i * 0.12, 0.25, 2, 0.4); });
void fold;
const a11yRow = P2.els[6];
fr(a11yRow, { borderColor: "rgba(240,185,74,0)", backgroundColor: "rgba(240,185,74,0)" }, { borderColor: "#f0b94a", backgroundColor: "rgba(240,185,74,.1)", duration: 0.25 }, 9.5);
// ---------- b3: the product page; Check accessibility pressed; a scan line sweeps (linear); finding pins pop; Show me rings the pale Add to cart
const ST = L({ b3: { x: 660, y: 230, k: 1 }, b5: { x: 410, y: 230, k: 1 }, b6: { x: 820, y: 250, k: 0.95 } },
             { b3: { x: 470, y: 400, k: 0.89 }, b5: { x: 470, y: 330, k: 0.89 }, b6: { x: 492, y: 410, k: 0.85 } });
const prod = pageBox(ST.b3.x, ST.b3.y, PW, PH, ST.b3.k, prodHTML, w, "opacity:0");
const pq = (s) => prod.querySelector(s);
const left = (s) => (AR ? 1920 - s.x - PW * s.k : s.x);
const ppt = (s, px, py) => [left(s) + px * s.k, s.y + py * s.k]; // frame-space point of a page pixel in state s (already mirrored)
const goPage = (s, t, d = 0.6, extra = {}) => to(prod, Object.assign({ x: left(s) - left(ST.b3), y: s.y - ST.b3.y, scale: s.k, duration: d, ease: "power2.inOut" }, extra), t);
to(P2.c, { opacity: 0, scale: 0.9, x: SG(-120), duration: 0.35, ease: "power2.in" }, 9.95);
out(list, 9.95, 0.3);
fr(prod, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45 }, 10.1);
const S3 = S("b3"), BT = L({ x: 112, y: 250 }, { x: 490, y: 90 });
const a11yB = K.btn({ x: BT.x, y: BT.y, h: 96, text: `${svg(IC.a11y, 36, "stroke:#2a2008;margin-inline-end:14px")}${S3[0]}`, style: "font-size:30px" });
pop(a11yB, 10.0, 0.35, 2, 0.5);
const cur = K.cursor();
const bC = [BT.x + 180, BT.y + 48];
cur.at(10.05, L(700, 1300), L(700, 600)).to(10.1, bC[0], bC[1], 0.2); K.press(a11yB, 10.4); cur.press(10.4, bC[0], bC[1]);
const scan = add(`<div class="abs" style="left:${left(ST.b3)}px;top:${ST.b3.y}px;width:${PW * ST.b3.k}px;height:8px;margin-top:-4px;background:linear-gradient(90deg,transparent,#7bd389 15%,#7bd389 85%,transparent);box-shadow:0 0 24px rgba(123,211,137,.6);opacity:0"></div>`);
fr(scan, { opacity: 1, y: 0 }, { y: PH * ST.b3.k, duration: 1.4, ease: "none" }, 10.6); to(scan, { opacity: 0, duration: 0.15 }, 12.0);
// pins: the logo, the price box, the pale Add to cart; they pop when the line passes them; within a row they read from the inline start
const PINS = [[222, 30], [652, 236], [1060, 386]];
const pins = PINS.map(([px, py], i) => { const [x, y] = ppt(ST.b3, px, py);
  const e = add(`<div class="abs" style="left:${x - 26}px;top:${y - 26}px;width:52px;height:52px;border-radius:50%;background:#ff7d63;color:#2a1410;font:500 30px/52px 'Thmanyah Serif Text';text-align:center;opacity:0;box-shadow:0 6px 16px rgba(0,0,0,.4)">${i + 1}</div>`);
  pop(e, 10.6 + (py / PH) * 1.4, 0.3, 2, 0.3); return e; });
const FD = L({ x: 112, y: 400, w: 500, h: 330 }, { x: 1060, y: 50, w: 400, h: 316 });
const finds = K.card({ ...FD, html: `<div class="abs" style="inset-inline-start:28px;top:22px;font:900 32px/40px 'Thmanyah Sans';color:#f1efea">${iso(S3[1])}</div>
  ${[0, 1, 2].map((i) => `<div class="abs" style="inset-inline-start:28px;top:${84 + i * L(58, 52)}px;width:40px;height:40px;border-radius:50%;background:#ff7d63;color:#2a1410;font:500 26px/40px 'Thmanyah Serif Text';text-align:center">${i + 1}</div>
   <div class="bar" style="inset-inline-start:80px;top:${94 + i * L(58, 52)}px;width:${[150, 120, 170][i]}px;height:14px;background:#4b4f55"></div>`).join("")}` });
const showMe = K.pill({ x: 28, y: L(252, 238), text: S3[2], p: finds, style: P30 + "border:2px solid #f0b94a;color:#ffd98a" });
fr(finds, { opacity: 0, x: SG(-30) }, { opacity: 1, x: 0, duration: 0.35 }, 11.3);
pop(showMe, 11.8, 0.3, 2, 0.5);
const smC = [FD.x + 28 + 80, FD.y + L(252, 238) + 31];
cur.to(12.2, smC[0], smC[1], 0.5); cur.press(12.9, smC[0], smC[1]); K.press(showMe, 12.9); cur.hide(13.3);
// Show me: the page scrolls the finding into view (a short lift), then a ring draws round the pale button
to(prod, { y: -24, duration: 0.3, ease: "power2.inOut" }, 12.95);
const [ax, ay] = ppt(ST.b3, 690, 350), aw = 370 * ST.b3.k, ah = 72 * ST.b3.k;
const ringA = add(`<svg class="abs" style="left:${ax - 18}px;top:${ay - 18 - 24}px;overflow:visible;opacity:0" width="${aw + 36}" height="${ah + 36}"><rect pathLength="1" x="2" y="2" width="${aw + 32}" height="${ah + 32}" rx="${(ah + 32) / 2}" fill="none" stroke="#ff7d63" stroke-width="5"/></svg>`);
set(ringA, { opacity: 1 }, 13.0);
fr(ringA.firstChild, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.inOut" }, 13.0);
// ---------- b4: Check page speed; the page dims; three gauges draw (power2.out 0.7 s), low angle; the toast in the tool's format; the signed-in avatar
const S4 = S("b4");
out([a11yB, finds, showMe, ...pins], 15.9, 0.25);
to(ringA, { scale: 0.4, opacity: 0, duration: 0.35, ease: "power2.in" }, 15.9);
to(prod, { opacity: 0.3, filter: "blur(3px)", y: 0, duration: 0.5 }, 16.0);
const speedB = K.btn({ x: BT.x, y: BT.y, h: 96, text: `${K.ico("timer", "", 36).replace('class="ic ', 'style="stroke:#2a2008;width:36px;height:36px;margin-inline-end:14px" class="ic ')}${S4[0]}`, style: "font-size:30px" });
pop(speedB, 16.05, 0.35, 2, 0.5);
cur.at(16.1, bC[0] + 200, bC[1] + 200).to(16.15, bC[0], bC[1], 0.2); K.press(speedB, 16.4); cur.press(16.4, bC[0], bC[1]); cur.hide(16.8);
const GA = L({ y: 400, h: 380, ws: [660, 360, 360], gap: 40, x0: 230, vfs: [96, 64, 64] }, { y: 510, h: 380, ws: [420, 280, 280], gap: 20, x0: 460, vfs: [64, 52, 52] });
const FRAC = [0.74, 0.4, 0.5];
const gauges = S4.slice(1).map((t, i) => {
  const m = t.match(/^(.*?):?\s+(\S+)$/), lab = m[1], val = m[2];
  const gx = GA.x0 + GA.ws.slice(0, i).reduce((a, b) => a + b + GA.gap, 0), gw = GA.ws[i], r = Math.min(gw * 0.36, L(120, 110)), cx = gw / 2, cy = 70 + r;
  const hero = i === 0, col = hero ? "#7bd389" : "#d8d6d1";
  const e = add(`<div class="card" style="left:${mx(gx, gw)}px;top:${GA.y}px;width:${gw}px;height:${GA.h}px;opacity:0;${hero ? "border-color:#3f6d49;" : ""}">
    <div class="lbl" style="position:absolute;left:0;right:0;top:24px;text-align:center;font:900 ${L(34, 30)}px/40px 'Thmanyah Sans';letter-spacing:.06em;color:${hero ? "#bfe8c6" : "#c9c7c2"};${AR ? "direction:rtl" : ""}">${iso(lab)}</div>
    <svg class="abs" style="left:0;top:${L(40, 46)}px;overflow:visible;${AR ? "transform:scaleX(-1)" : ""}" width="${gw}" height="${cy + 10}">
     <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#343a41" stroke-width="${L(22, 18)}" stroke-linecap="round"/>
     <path class="ga" pathLength="1" d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${col}" stroke-width="${L(22, 18)}" stroke-linecap="round" stroke-dasharray="${FRAC[i]} 1" stroke-dashoffset="${FRAC[i]}"/></svg>
    <div class="abs" style="left:0;right:0;top:${L(40, 46) + cy + 12}px;text-align:center;font:500 ${GA.vfs[i]}px/1.1 'Thmanyah Serif Text';color:${hero ? "#f1efea" : "#d9d7d2"};direction:ltr">${val}</div></div>`);
  gsap.set(e, { transformPerspective: 1400, transformOrigin: "50% 100%" });
  fr(e, { opacity: 0, y: 40, rotationX: 0 }, { opacity: 1, y: 0, rotationX: -10, duration: 0.45, ease: "back.out(1.4)" }, 16.7 + i * 0.1);
  fr(e.querySelector(".ga"), { strokeDashoffset: FRAC[i] }, { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, 17.1 + i * 0.12);
  return e; });
const toast = K.pill({ x: 960, y: GA.y + GA.h + L(60, 56), anchor: "c", cls: "lineG", text: S4.slice(1).join(" · "), style: P30 });
fadeIn(toast, 18.1, 0.35, 14);
const avS = ST.b3, [avx, avy] = ppt(avS, PW - 36 * 2.4 + 32, 15 + 32);
const avRing = add(`<div class="abs" style="left:${avx - 52}px;top:${avy - 52}px;width:104px;height:104px;border-radius:50%;border:4px solid #7bd389;box-shadow:0 0 26px rgba(123,211,137,.5);opacity:0"></div>`);
pop(avRing, 18.4, 0.35, 2, 0.5);
// ---------- b5: the page returns; Next is pressed; nothing happens; a 1.7 s ring draws (linear) and turns coral: a dead click. The price runs out of its box: orange outline
out([speedB, ...gauges, toast], 21.4, 0.3); out(avRing, 21.4, 0.2);
goPage(ST.b5, 21.5, 0.6, { opacity: 1, filter: "blur(0px)" });
const [nx, ny] = ppt(ST.b5, 960, 536), RR = 110 * ST.b5.k;
cur.at(21.9, nx + SG(260), ny + 220).to(22.0, nx, ny + 6, 0.5); cur.press(22.6, nx, ny + 6); K.press(pq(".nx"), 22.6); cur.hide(23.2);
const dead = add(`<svg class="abs" style="left:${nx - RR - 10}px;top:${ny - RR - 10}px;overflow:visible;opacity:0;${AR ? "transform:scaleX(-1)" : ""}" width="${2 * RR + 20}" height="${2 * RR + 20}">
  <circle cx="${RR + 10}" cy="${RR + 10}" r="${RR}" fill="none" stroke="#3a4047" stroke-width="8"/>
  <circle class="cr" pathLength="1" cx="${RR + 10}" cy="${RR + 10}" r="${RR}" fill="none" stroke="#d8d6d1" stroke-width="8" stroke-linecap="round" transform="rotate(-90 ${RR + 10} ${RR + 10})"/></svg>`);
set(dead, { opacity: 1 }, 22.7);
fr(dead.querySelector(".cr"), { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.7, ease: "none" }, 22.7);
to(dead.querySelector(".cr"), { stroke: "#ff7d63", duration: 0.12, ease: "none" }, 24.4);
fr(dead, { filter: "drop-shadow(0 0 0px rgba(255,125,99,0))" }, { filter: "drop-shadow(0 0 18px rgba(255,125,99,.7))", duration: 0.2 }, 24.4);
const sec = K.pill({ x: AR ? 1920 - (nx - RR - 110) : nx - RR - 110, y: ny, anchor: "c", cls: "coral", text: S("b5")[1], style: P30 + "direction:ltr" });
pop(sec, 24.45, 0.3, 2.5, 0.4);
const [px0, py0] = ppt(ST.b5, 506, 204);
const over = add(`<div class="abs" style="left:${px0}px;top:${py0}px;width:${140 * ST.b5.k}px;height:${58 * ST.b5.k}px;border:3px dashed ${ORANGE};border-radius:6px;opacity:0"></div>`);
fadeIn(over, 25.2, 0.25);
// out: the two finding chips fly back toward the popup's side
const chips = [[nx, ny], [px0 + 60, py0 + 30]].map(([x, y], i) => { const c = add(`<div class="abs" style="left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:${i ? ORANGE : "#ff7d63"};opacity:0"></div>`);
  fr(c, { opacity: 1, x: 0, y: 0, scale: 1 }, { x: AR ? 1920 - 300 - x : 300 - x, y: L(420, 200) - y, scale: 0.4, opacity: 0, duration: 0.55, ease: "power2.in" }, 26.3 + i * 0.12); return c; });
void chips;
// ---------- b6: popup inline-start, page inline-end; four rows fire in turn, each with its result on the page
out([dead, sec, over], 26.4, 0.3);
goPage(ST.b6, 26.8, 0.6);
const P6o = L({ x: 112, y: 250, w: 640, h: 440, pitch: 78, fs: 34, top: 118 }, { x: 470, y: 40, w: 980, h: 360, pitch: 62, fs: 30, top: 100 });
const P6 = popup(P6o, [0, 1, 3, 4]);
fr(P6.c, { opacity: 0, x: SG(-60) }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, 26.9);
P6.els.forEach((r) => fadeIn(r, 27.1, 0.25));
const S6 = S("b6"), FIRE = [27.4, 28.8, 30.2, 31.4];
P6.els.forEach((r, i) => { fr(r, { borderColor: "rgba(240,185,74,0)", backgroundColor: "rgba(240,185,74,0)" }, { borderColor: "#f0b94a", backgroundColor: "rgba(240,185,74,.12)", duration: 0.15 }, FIRE[i] - 0.15);
  to(r, { borderColor: "rgba(240,185,74,0)", backgroundColor: "rgba(240,185,74,0)", duration: 0.3 }, FIRE[i] + 0.9); pop(r.querySelector(".tk"), FIRE[i], 0.3, 2.5, 0.3); });
// 1 the locator chip under the page; 2 the nasty value in Quantity; 3 the name stretched with orange outline; 4 a forced 500
const s6 = ST.b6, pg6 = [left(s6), s6.y, PW * s6.k, PH * s6.k];
const loc = add(`<div class="abs" style="left:${pg6[0] + pg6[2] / 2}px;top:${pg6[1] + pg6[3] + L(14, 12)}px;height:56px;padding:0 24px;border-radius:12px;background:#24282c;border:2px solid #7bd389;font:700 30px/52px 'Thmanyah Sans';color:#bfe8c6;white-space:nowrap;direction:ltr;opacity:0">${S6[1]}</div>`);
gsap.set(loc, { xPercent: -50 });
fr(loc, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.4, ease: "back.out(1.6)" }, FIRE[0] + 0.1);
set(pq(".qv1"), { opacity: 0 }, FIRE[1] + 0.1); set(pq(".qv2"), { opacity: 1 }, FIRE[1] + 0.1);
fr(pq(".qf"), { borderColor: "#4a5057" }, { borderColor: "#f0b94a", duration: 0.2 }, FIRE[1] + 0.1);
set(pq(".nm"), { outline: `3px solid ${ORANGE}`, outlineOffset: "6px" }, FIRE[2] + 0.1);
fr(pq(".nm"), { letterSpacing: "0em" }, { letterSpacing: "0.12em", duration: 0.5, ease: "power2.out" }, FIRE[2] + 0.1);
const f500 = add(`<div class="abs" style="left:${pg6[0] + 250 * s6.k - 90}px;top:${pg6[1] + 330 * s6.k - 66}px;width:180px;height:132px;border-radius:18px;border:3px solid #f2876d;background:#2a2b30;box-shadow:0 12px 26px rgba(0,0,0,.35);font:500 76px/126px 'Thmanyah Serif Text';color:#f48a70;text-align:center;opacity:0;direction:ltr">${S6[5]}</div>`);
pop(f500, FIRE[3] + 0.1, 0.4, 2, 0.4);
// ---------- b7: the bookend: the page shrinks behind the popup; the b1 scatter returns as faint ghosts and fades (linear 1.2 s); the coverage meter fills as seven marks tick
to([prod, loc, f500], { scale: (i) => (i ? 0.6 : s6.k * 0.6), opacity: 0, duration: 0.5, ease: "power2.in" }, 32.9);
to(P6.c, { opacity: 0, scale: 0.9, duration: 0.35, ease: "power2.in" }, 32.9);
const PC = L({ x: 500, y: 60 }, { x: 470, y: 60 });
const meter = add(`<div class="abs" style="inset-inline-start:30px;top:${PU.top + 8 * PU.pitch + 4}px;width:${PU.w - 60}px;height:${meterH}px">
  <div class="abs" style="left:0;right:0;top:${L(14, 18)}px;height:14px;border-radius:7px;background:#343a41"></div>
  <div class="abs mf" style="left:0;right:0;top:${L(14, 18)}px;height:14px;border-radius:7px;background:#7bd389;transform-origin:${AR ? "100%" : "0"} 50%"></div>
  <div class="abs" style="left:0;right:0;top:${L(42, 50)}px;display:flex;justify-content:space-between">${[...Array(7)].map(() => `<i class="mt" style="display:block;width:${L(30, 36)}px;height:${L(30, 36)}px;border-radius:50%;border:3px solid #4a5057"></i>`).join("")}</div></div>`, P2.c);
to(a11yRow, { borderColor: "rgba(240,185,74,0)", backgroundColor: "rgba(240,185,74,0)", duration: 0.01 }, 32.9);
fr(P2.c, { opacity: 0, scale: 0.78, x: SG(PC.x - PU.x), y: PC.y - PU.y }, { opacity: 1, scale: L(0.9, 1), x: SG(PC.x - PU.x), y: PC.y - PU.y, duration: 0.5, ease: "back.out(1.4)" }, 33.2);
gsap.set(meter.querySelector(".mf"), { scaleX: 0 }); // p2: the meter is empty until b7 (it showed full from 5.5)
fr(meter.querySelector(".mf"), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power2.out" }, 34.7);
[...meter.querySelectorAll(".mt")].forEach((m, i) => fr(m, { borderColor: "#4a5057", backgroundColor: "rgba(123,211,137,0)" }, { borderColor: "#7bd389", backgroundColor: "#7bd389", duration: 0.12, ease: "none" }, 34.7 + i * 0.09));
wins.forEach((e) => { fr(e, { opacity: 0.4, x: 0, y: 0, scale: 1, rotationX: 0, filter: "grayscale(1) blur(1.5px)" }, { opacity: 0, filter: "grayscale(1) blur(3px)", duration: 1.2, ease: "none" }, 34.2); });
K.glow("green", 33.3, 960, 520, 1.0);
// ---------- b8: shared end card
K.titles({ b1: [0, 4.15] });
K.captions();
// ---------- p2 polish: anticipation glows before the amber presses; slow sine drifts of the camera on the holds
const glowBtn = (el, at) => fr(el, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 0 0 rgba(240,185,74,0)" }, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 34px 6px rgba(240,185,74,.35)", duration: 0.2, ease: "sine.inOut" }, at);
glowBtn(a11yB, 10.18); glowBtn(speedB, 16.2);
cam(0.15, { s: 1.03, vs: 1.03, d: 4.2, ease: "sine.inOut" }); cam(4.4, { s: 1, vs: 1, d: 0.5 }); // b1 scatter breathes
cam(7.6, { s: 1.025, vs: 1.025, d: 2.3, ease: "sine.inOut" }); cam(9.95, { s: 1, vs: 1, d: 0.5 }); // b2 popup hold
cam(13.6, { s: 1.025, vs: 1.025, d: 2.2, ease: "sine.inOut" }); cam(15.85, { s: 1, vs: 1, d: 0.4 }); // b3 ring hold
cam(18.6, { s: 1.03, vs: 1.03, d: 2.7, ease: "sine.inOut" }); cam(21.4, { s: 1, vs: 1, d: 0.5 }); // b4 gauges hold
cam(25.4, { s: 1.025, vs: 1.025, d: 1.3, ease: "sine.inOut" }); cam(26.75, { s: 1, vs: 1, d: 0.4 }); // b5 dead-click hold
cam(27.3, { s: 1.02, vs: 1.02, d: 5.4, ease: "sine.inOut" }); cam(32.9, { s: 1, vs: 1, d: 0.4 }); // b6 while the rows fire
cam(33.8, { s: 1.035, vs: 1.035, d: 3.6, ease: "sine.inOut" }); // b7 the bookend breathes until the drain
K.endCard(K.beat("b8"), undefined, { links: true }); // p2 fix c
void fr; void mx;
K.done();
})();
