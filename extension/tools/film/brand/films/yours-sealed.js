/* Film 5, yours-sealed: "Yours, and Sealed" (brand-films.md Film 5). Worker b3, 2026-11-10.
   Words from films.json via K.scr; strings films.json lacks via K.N (build-notes.json "yours-sealed").
   16:9 and 9:16 are laid out separately (L(h, v)); 9:16 keeps the world at scale 1 so labels stay >= 28 px. */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, V, iso, N, to, fr, set, out, pop, fadeIn, cam } = K;
const S = (id, l) => K.scr(id, l), L = (h, v) => (V ? v : h), w = K.world, f = K.fg, tl = K.tl;
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".v #ec .v2tg{font-size:30px;height:60px;line-height:58px}" }));
const P30 = "font-size:30px;height:62px;line-height:60px;padding:0 28px;";
K.light([420, 520], [1300, 560]);
if (V) { cam(0, { vs: 1 }); cam(0, { vs: 1 }, f); }
const svg = (d, px, st = "") => `<svg viewBox="0 0 24 24" class="ic" style="width:${px}px;height:${px}px;${st}">${d}</svg>`;
const IC = { mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>', card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2.5"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>', seal: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.6"/>', arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>' };
// a box in a 1920-wide layer (world / fg): x is the EN inline-start edge, AR mirrors. ltr: keeps direction ltr (page data, do not flip)
const B = (o) => add(`<div class="${o.cls || "abs"}" style="left:${mx(o.x, o.w)}px;top:${o.y}px;width:${o.w}px;${o.h ? `height:${o.h}px;` : ""}${o.ltr ? "direction:ltr;" : AR ? "direction:rtl;" : ""}${o.show ? "" : "opacity:0;"}${o.st || ""}">${o.html || ""}</div>`, o.p || w);
// text inside a box: x = inline-start offset (or physical left with ltr boxes: l)
const tx = (s, fs, o = {}) => `<div class="abs ${o.cls || ""}" style="${o.l != null ? `left:${o.l}px;` : `inset-inline-start:${o.x ?? 0}px;`}top:${o.y ?? 0}px;font:${o.wt || 700} ${fs}px/1.25 '${o.fam || "Thmanyah Sans"}';color:${o.c || "#ecebe7"};${o.wrap ? `white-space:normal;width:${o.wrap}px;` : "white-space:nowrap;"}${o.st || ""}">${o.raw ? s : iso(s)}</div>`;
const bar = (x, y, bw, h = 16, c = "#3a4047", o = "") => `<div class="bar ${o}" style="inset-inline-start:${x}px;top:${y}px;width:${bw}px;height:${h}px;background:${c}"></div>`;
const dots = (n, d, gap, c = "#ecebe7") => `<span style="display:inline-flex;gap:${gap}px;vertical-align:middle">${Array.from({ length: n }, () => `<i style="display:block;width:${d}px;height:${d}px;border-radius:50%;background:${c}"></i>`).join("")}</span>`;
const solid = (st) => `<div class="abs" style="${st}border-radius:8px;background:#0c0e10;border:2px solid #3a4047;opacity:0"></div>`;
const S1 = S("b1", "en"), [pwLab, pwVal] = S1[2].split(": "); // field values stay Latin in both cuts (doc: do not flip)
// ================= b1: the session file card (inside window 1, whose frame is not drawn yet) drifts toward the inline-end edge
const WN = { w: 900, h: 640 }, CD = { x: 60, y: 100, w: 780, h: 470 };
const W1 = L({ x: 420, y: 180, d: 140 }, { x: 470, y: 150, d: 60 }); // frame-0 place and the drift
const win1 = B({ x: W1.x, y: W1.y, w: WN.w, h: WN.h, show: true, st: `transform-origin:${AR ? "100%" : "0"} 0;` });
const frameSvg = (ww, hh) => `<svg class="abs wf" width="${ww}" height="${hh}" style="left:0;top:0;overflow:visible"><rect class="wfr" x="1.5" y="1.5" width="${ww - 3}" height="${hh - 3}" rx="18" pathLength="1" fill="none" stroke="#5a6068" stroke-width="3"/></svg>`;
const topBar = (ww) => `<div class="abs tb" style="left:0;top:0;width:${ww}px;height:64px;border-bottom:1px solid #343a41;opacity:0">
  ${[0, 1, 2].map((i) => `<i style="position:absolute;inset-inline-start:${24 + i * 26}px;top:24px;width:16px;height:16px;border-radius:50%;background:#4a5057"></i>`).join("")}
  <div class="bar" style="inset-inline-start:120px;top:20px;width:${ww - 260}px;height:24px;border-radius:12px;background:#2a2e33"></div></div>`;
win1.innerHTML = `<div class="abs wbg" style="inset:0;border-radius:18px;background:#1c2024;opacity:0"></div>${topBar(WN.w)}${frameSvg(WN.w, WN.h)}`;
const card = add(`<div class="card" style="left:${CD.x}px;top:${CD.y}px;width:${CD.w}px;height:${CD.h}px;direction:ltr;box-shadow:0 30px 60px rgba(0,0,0,.45)"></div>`, win1);
// rows: text (.tx) and, for the shrunk 9:16 windows, the same rows as bars (.bx)
card.innerHTML = `<div class="abs" style="left:0;right:0;top:0;height:70px;border-bottom:1px solid #343a41"></div>
 <div class="abs" style="left:28px;top:16px">${K.ico("doc", "dim", 38)}</div>${bar(84, 27, 240, 16, "#4b4f55")}
 <div class="abs" style="left:30px;top:100px">${svg(IC.mail, 36, "stroke:#9aa0a6")}</div>
 ${tx(S1[0], 34, { l: 90, y: 94, c: "#d9d7d2", cls: "tx" })}${bar(90, 106, 330, 18, "#53575d", "bx")}
 <div class="abs" style="left:30px;top:178px">${svg(IC.card, 36, "stroke:#9aa0a6")}</div>
 <div class="abs tx cn" style="left:90px;top:160px;font:500 54px/1.2 'Thmanyah Serif Text';color:#ffffff;white-space:nowrap;padding-bottom:4px;border-bottom:4px solid #ff7d63">${S1[1]}</div>${bar(90, 180, 540, 28, "#5d6168", "bx")}
 <div class="abs" style="left:30px;top:270px">${svg(IC.key, 36, "stroke:#9aa0a6")}</div>
 ${tx(`${pwLab}: <span class="pv">${pwVal}</span><span class="pb" style="display:none">${dots(8, 16, 9)}</span>`, 34, { l: 90, y: 264, c: "#d9d7d2", cls: "tx", raw: true })}${bar(90, 276, 360, 18, "#53575d", "bx")}
 ${solid("left:84px;top:88px;width:350px;height:56px;")}${solid("left:84px;top:156px;width:560px;height:84px;")}
 <div class="abs ft" style="left:30px;right:30px;top:340px;border-top:1px solid #343a41;opacity:0"></div>
 <div class="abs ft" style="${AR ? "right" : "left"}:30px;top:352px;font:700 28px/1.25 'Thmanyah Sans';color:#cfcdc8;white-space:nowrap;direction:${AR ? "rtl" : "ltr"};opacity:0">${iso(S("b5").slice(AR ? 2 : 3).join(" · "))}</div>
 <div class="abs ft sb" style="left:30px;right:30px;top:400px;height:50px;border-radius:10px;background:#1d2125;border:1.5px solid #3f6d49;opacity:0;display:flex;align-items:center;gap:14px;padding:0 16px">${svg(IC.seal, 32, "stroke:#7bd389")}<i style="display:block;height:12px;width:420px;border-radius:6px;background:repeating-linear-gradient(90deg,#4f6b55 0 26px,transparent 26px 34px)"></i></div>`;
const q1 = (s) => card.querySelectorAll(s);
gsap.set(q1(".bx"), { opacity: 0 });
gsap.set(card, { boxShadow: `${SG(-60)}px 0 70px rgba(255,125,99,.22), 0 30px 60px rgba(0,0,0,.45)` }); // the faint coral trail (act 1)
gsap.set(win1.querySelector(".wfr"), { strokeDasharray: 1, strokeDashoffset: 1 });
tl.fromTo(win1, { x: 0 }, { x: SG(W1.d), duration: 5.0, ease: "sine.inOut", immediateRender: false }, 0);
// ================= b2: the frame draws round the card; Asleep; a second window slides in and is woken alone
to(card, { boxShadow: "0 0 0 rgba(255,125,99,0), 0 30px 60px rgba(0,0,0,.45)", duration: 0.6 }, 5.0);
to(card.querySelector(".cn"), { borderBottomColor: "rgba(255,125,99,0)", duration: 0.4 }, 5.4);
fr(win1.querySelector(".wfr"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 5.0);
fadeIn(win1.querySelector(".wbg"), 5.3, 0.3); fadeIn(win1.querySelector(".tb"), 5.4, 0.3);
to(win1.querySelector(".wfr"), { stroke: "#5f9a6a", duration: 0.4 }, 5.6); // the thin green rim at the turn
const S2 = S("b2");
// p3: windows raised (60 px clear above the caption line); popup 1 moved off the ASLEEP title (the title keeps its place)
const LB2 = L({ w1: { x: 90, y: 250, k: 0.85 }, w2: { x: 1065, y: 250, k: 0.85 }, p1: { x: 560, y: 128 }, p2: { x: 1380, y: 128 } },
  { w1: { x: 470, y: 120, k: 0.55 }, w2: { x: 470, y: 560, k: 0.55 }, p1: { x: 990, y: 190 }, p2: { x: 990, y: 630 } });
const PP = { w: 460, h: 150 };
// popup: mini mark + the switch; body slot. Text 30 px, not scaled with the windows
const popup = (p) => B({ cls: "card", x: p.x, y: p.y, w: PP.w, h: PP.h, html: `
  <div class="abs" style="inset-inline-start:22px;top:16px;width:48px;height:40px">${K.MARK()}</div>
  <div class="abs sw" style="inset-inline-end:22px;top:18px;width:72px;height:38px;border-radius:19px;background:#3a4047"><i class="kn" style="position:absolute;top:5px;inset-inline-start:5px;width:28px;height:28px;border-radius:50%;background:#cfcdc8"></i></div>` });
const pop1 = popup(LB2.p1), pop2 = popup(LB2.p2);
const sayAsleep = add(`<div class="pill lineG" style="position:absolute;inset-inline-start:22px;top:72px;opacity:0;${P30}">${iso(S2[0])}</div>`, pop1);
const wake = add(`<div class="btn" style="position:absolute;inset-inline-start:22px;top:70px;height:62px;font-size:30px;opacity:0">${iso(S2[1])}</div>`, pop2);
const sayAwake = add(`<div class="pill lineG" style="position:absolute;inset-inline-start:22px;top:72px;opacity:0;${P30}">${iso(S2[2])}</div>`, pop2);
// popup 1 first hangs from window 1 where the drift left it, then travels with it (6.2)
{ const P1 = L({ x: W1.x + W1.d + WN.w - PP.w - 20, y: 118 }, { x: W1.x + W1.d + WN.w - PP.w - 20, y: 100 });
  gsap.set(pop1, { x: SG(P1.x - LB2.p1.x), y: P1.y - LB2.p1.y }); to(pop1, { x: 0, y: 0, duration: 0.8, ease: "power2.inOut" }, 6.2); }
pop(pop1, 5.45, 0.4, 1.6, 0.6); pop(sayAsleep, 5.6, 0.35, 2, 0.5);
// lead move (6.2): window 1 steps aside and shrinks; window 2 slides in beside it
const k2 = (wk) => ({ x: SG(wk.x - W1.x), y: wk.y - W1.y, scale: wk.k });
to(win1, Object.assign(k2(LB2.w1), { duration: 0.8, ease: "power2.inOut" }), 6.2);
if (V) { to(q1(".tx"), { opacity: 0, duration: 0.3 }, 6.3); to(q1(".bx"), { opacity: 0.6, duration: 0.3 }, 6.3); } // 9:16: the shrunk window is a picture
// window 2: the form page (drawn, page text Latin in both cuts)
const FM = N.form;
const formRows = (bare, lx, vx, vw, y0, dy, fs) => FM.labels.map((lab, i) => `
  ${bare ? `<div class="bar" style="left:${lx}px;top:${y0 + i * dy + 26}px;width:${lab.length * fs * 0.5}px;height:${fs * 0.45}px;background:#53575d"></div>` : `<div class="abs" style="left:${lx}px;top:${y0 + i * dy + 18}px;font:700 ${fs}px/1.25 'Thmanyah Sans';color:#a5abb0;white-space:nowrap">${lab}</div>`}
  <div class="abs fb" style="left:${vx}px;top:${y0 + i * dy}px;width:${vw}px;height:76px;border-radius:10px;border:1.5px solid #4a5057;background:#22262b"></div>
  ${bare ? `<div class="bar" style="left:${vx + 22}px;top:${y0 + i * dy + 29}px;width:${FM.values[i].length * fs * 0.52}px;height:${fs * 0.45}px;background:#6a6f76"></div>` : `<div class="abs fv" style="left:${vx + 22}px;top:${y0 + i * dy + 15}px;width:${vw - 44}px;font:500 ${fs + 2}px/1.25 'Thmanyah Sans';color:#ecebe7;white-space:nowrap">${FM.values[i]}</div>`}`).join("");
const win2 = B({ x: LB2.w2.x, y: LB2.w2.y, w: WN.w, h: WN.h, st: `transform-origin:${AR ? "100%" : "0"} 0;`, html: `
  <div class="abs" style="inset:0;border-radius:18px;background:#1c2024;border:3px solid #5a6068"></div>${topBar(WN.w).replace("opacity:0", "")}
  <div class="abs" style="left:60px;top:96px;width:780px;height:510px;direction:ltr;border-radius:14px;background:#24282c;border:1px solid #343a41">
   <div class="bar" style="left:40px;top:36px;width:220px;height:22px;background:#4b4f55"></div>${formRows(V, 40, 270, 470, 100, 100, 30)}</div>` });
gsap.set(win2, { scale: LB2.w2.k });
fr(win2, { opacity: 0, x: SG(600) }, { opacity: 1, x: 0, duration: 0.8, ease: "power2.inOut" }, 6.2);
pop(pop2, 6.8, 0.4, 1.6, 0.6); pop(wake, 6.95, 0.35, 2, 0.5);
const cur = K.cursor();
const wakeC = [LB2.p2.x + 22 + 80, LB2.p2.y + 101];
cur.at(7.2, L(1500, 1300), L(760, 900)).to(7.3, wakeC[0], wakeC[1], 0.5); K.press(wake, 8.0); cur.press(8.0, wakeC[0], wakeC[1]); cur.hide(8.5);
out(wake, 8.15, 0.12); pop(sayAwake, 8.25, 0.35, 2, 0.5);
to(pop2.querySelector(".sw"), { backgroundColor: "#7bd389", duration: 0.2 }, 8.15); to(pop2.querySelector(".kn"), { x: SG(34), backgroundColor: "#10331a", duration: 0.25, ease: "back.out(2)" }, 8.15);
K.glow("green", 6.2, L(1300, 960), L(520, 700), 1.0);
// ================= b3: push-in on the awake window's form; the secrets wipe to bullets; Mask real data; blocks cover name and email
const S3 = S("b3");
const w2c = [LB2.w2.x + WN.w * LB2.w2.k / 2, LB2.w2.y + WN.h * LB2.w2.k / 2];
cam(10.0, { s: 1.3, x: -(w2c[0] - 960) * 1.3, y: -(w2c[1] - 540) * 1.3, vs: 1.3, vx: -(w2c[0] - 960) * 1.3, vy: -(w2c[1] - 540) * 1.3, d: 0.6 });
to(w, { opacity: 0.2, filter: "blur(5px)", duration: 0.5 }, 10.1);
const FB = L({ x: 160, y: 250, w: 1080, h: 560, lx: 50, vx: 300, vw: 730, y0: 120, dy: 105 }, { x: 470, y: 100, w: 980, h: 560, lx: 36, vx: 260, vw: 680, y0: 120, dy: 105 });
const form = B({ cls: "card", x: FB.x, y: FB.y, w: FB.w, h: FB.h, ltr: true, p: f, st: "box-shadow:0 30px 60px rgba(0,0,0,.45),0 0 40px rgba(123,211,137,.10)", html: `
  <div class="bar" style="left:${FB.lx}px;top:44px;width:240px;height:24px;background:#4b4f55"></div>${formRows(false, FB.lx, FB.vx, FB.vw, FB.y0, FB.dy, 32)}` });
fr(form, { opacity: 0, scale: 0.55 }, { opacity: 1, scale: 1, duration: 0.6, ease: "power2.inOut" }, 10.1);
const fvs = form.querySelectorAll(".fv"), fbs = form.querySelectorAll(".fb");
// the bullet wipe on Password (2) and API token (3): linear 0.5 s, in the inline direction (AR right to left)
[2, 3].forEach((i, k) => {
  const bl = add(`<div class="abs" style="left:${FB.vx + 22}px;top:${FB.y0 + i * FB.dy + 22}px;height:34px;display:flex;align-items:center;opacity:0">${dots(8, 18, 10)}</div>`, form);
  const t0 = 10.6 + k * 0.15, sideOut = AR ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 0% 100%)", sideIn = AR ? "inset(0% 0% 0% 100%)" : "inset(0% 100% 0% 0%)";
  fr(fvs[i], { clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: sideOut, duration: 0.5, ease: "none" }, t0);
  fr(bl, { opacity: 1, clipPath: sideIn }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.5, ease: "none" }, t0);
});
const blocks = [0, 1].map((i) => add(`<div class="abs" style="left:${FB.vx + 8}px;top:${FB.y0 + i * FB.dy + 8}px;width:${FB.vw - 16}px;height:60px;border-radius:8px;background:#0c0e10;border:2px solid #3a4047;opacity:0"></div>`, form));
const MBp = L({ x: 1300, y: 300, w: 480 }, { x: 490, y: 700, w: 560 });
const maskB = K.btn({ x: MBp.x, y: MBp.y, w: MBp.w, h: 100, text: S3[1], p: f, style: "font-size:32px" });
const CT = L({ x: 1300, y: 460, w: 480, h: 150 }, { x: 490, y: 840, w: 940, h: 120 });
const ctr = B({ cls: "card", p: f, x: CT.x, y: CT.y, w: CT.w, h: CT.h, html: `${tx(S3[2], 30, { x: 30, y: V ? 40 : 28, c: "#cfcdc8" })}
  <div class="abs" style="${V ? "inset-inline-end:40px;top:18px" : "inset-inline-start:30px;top:70px"};font:500 64px/1.1 'Thmanyah Serif Text';color:#f1efea">${[0, 1, 2].map((n) => `<span class="cn${n}" style="${n ? "display:none" : ""}">${n}</span>`).join("")}</div>` });
pop(maskB, 10.9, 0.4, 2, 0.4); pop(ctr, 11.1, 0.35, 1.7, 0.5);
const mC = [MBp.x + MBp.w / 2, MBp.y + 50];
cur.at(11.5, L(1700, 1300), L(760, 980)).to(11.6, mC[0], mC[1], 0.5); K.press(maskB, 12.2); cur.press(12.2, mC[0], mC[1]); cur.hide(12.7);
blocks.forEach((b, i) => { K.slam(b, 12.3 + i * 0.12, 0.2, 0); const cns = ctr.querySelectorAll("span"); set(cns[i], { display: "none" }, 12.5 + i * 0.12); set(cns[i + 1], { display: "inline" }, 12.5 + i * 0.12); });
void fbs;
// out: pull-out to the whole browser
to(form, { scale: 0.5, opacity: 0, duration: 0.4, ease: "power2.in" }, 15.2); out([maskB, ctr], 15.2, 0.3);
out([win1, win2, pop1, pop2], 10.6, 0.3); // gone behind the form once the push-in has read
cam(15.4, { s: 1, x: 0, y: 0, vs: 1, d: 0.5 }); to(w, { opacity: 1, filter: "blur(0px)", duration: 0.4 }, 15.5);
// ================= b4: arrows try to leave the browser and stop at its edge; File to Jira is the one door
const S4 = S("b4");
const BR = L({ x: 200, y: 250, w: 1100, h: 440 }, { x: 470, y: 100, w: 980, h: 500 });
const MC = L({ x: 60, y: 110, w: 480, h: 270 }, { x: 40, y: 100, w: 440, h: 260 });
const brw = B({ x: BR.x, y: BR.y, w: BR.w, h: BR.h, html: `<div class="abs" style="inset:0;border-radius:18px;background:#1c2024"></div>${topBar(BR.w).replace("opacity:0", "")}${frameSvg(BR.w, BR.h).replace('stroke="#5a6068"', 'stroke="#6b7178"')}
  <div class="abs" data-layout-ignore style="${AR ? "right" : "left"}:${MC.x}px;top:${MC.y}px;width:${MC.w}px;height:${MC.h}px;direction:ltr;border-radius:12px;background:#25292e;border:1px solid #343a41">
   <div class="bar" style="left:24px;top:22px;width:150px;height:14px;background:#4b4f55"></div>
   <div class="abs" style="left:24px;top:64px;width:240px;height:36px;border-radius:6px;background:#0c0e10;border:2px solid #3a4047"></div>
   <div class="abs" style="left:24px;top:116px;width:${MC.w - 80}px;height:44px;border-radius:6px;background:#0c0e10;border:2px solid #3a4047"></div>
   <div class="abs" style="left:24px;top:180px">${dots(8, 13, 8, "#cfcdc8")}</div></div>` });
fr(brw, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }, 15.45);
const JB = L({ x: 640, y: 200, w: 400 }, { x: 510, y: 380, w: 420 });
const jira = add(`<div class="btn" style="position:absolute;inset-inline-start:${JB.x}px;top:${JB.y}px;width:${JB.w}px;height:96px;font-size:32px;opacity:0"><span>${iso(S4[1])}</span></div>`, brw); // p3: one flex item, so the space before the isolated "Jira" survives in AR
pop(jira, 15.9, 0.4, 2, 0.4);
// arrows (EN world px): from the card's centre to just inside an edge, then a back.out bounce (they stop at the frame)
const O = [BR.x + MC.x + MC.w / 2, BR.y + MC.y + MC.h / 2];
const ends = L([[BR.x + 330, BR.y + 90], [BR.x + 150, BR.y + BR.h - 30], [BR.x + 420, BR.y + BR.h - 30], [BR.x + 30, BR.y + 200], [BR.x + 30, BR.y + 330], [BR.x + 560, BR.y + 90], [BR.x + BR.w - 30, BR.y + 120], [BR.x + BR.w - 30, BR.y + 400]],
  [[BR.x + 160, BR.y + 90], [BR.x + 380, BR.y + 90], [BR.x + 30, BR.y + 180], [BR.x + 30, BR.y + 300], [BR.x + 150, BR.y + BR.h - 30], [BR.x + 640, BR.y + 90], [BR.x + BR.w - 30, BR.y + 150], [BR.x + BR.w - 30, BR.y + 300]]);
ends.forEach(([ex, ey], i) => {
  const dx = MX(ex) - MX(O[0]), dy = ey - O[1], ang = (Math.atan2(dy, dx) * 180) / Math.PI, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const a = add(`<div class="abs" style="left:${MX(O[0]) - 26}px;top:${O[1] - 26}px;width:52px;height:52px;opacity:0">${svg(IC.arrow, 52, "stroke:#b4b9be;stroke-width:2.6")}</div>`);
  const t0 = 15.95 + i * 0.05;
  gsap.set(a, { rotation: ang });
  fr(a, { opacity: 0, x: ux * 120, y: uy * 120 }, { opacity: 1, x: dx - ux * 24, y: dy - uy * 24, duration: 0.4, ease: "power2.in" }, t0);
  to(a, { x: dx - ux * 70, y: dy - uy * 70, duration: 0.35, ease: "back.out(3)" }, t0 + 0.4);
  to(a, { opacity: 0.45, duration: 0.3 }, t0 + 0.9);
  out(a, 20.2, 0.25);
});
const FL = L({ x: BR.x, y: BR.y + BR.h + 18 }, { x: BR.x + 20, y: BR.y + BR.h + 18 });
const foot = K.label({ x: FL.x, y: FL.y, text: `${svg(IC.lock, 30, "stroke:#cfcdc8;vertical-align:-5px;margin-inline-end:12px")}${iso(S4[0])}`, size: 30 });
fadeIn(foot, 16.3, 0.3);
const EG = L({ x: 1360, y: 250, w: 440, h: 440 }, { x: 490, y: 700, w: 940, h: 280 });
const ER = N.egressRow;
const eg = B({ cls: "card", x: EG.x, y: EG.y, w: EG.w, h: EG.h, html: `${tx(S4[2], 30, { x: 30, y: 26 })}
  <div class="abs" style="left:30px;right:30px;top:80px;border-top:1px solid #343a41"></div>
  ${tx(K.T(N.egressEmpty), 28, { x: 30, y: 100, c: "#a5abb0", wt: 500, wrap: EG.w - 60, cls: "em" })}
  <div class="abs row1" style="inset-inline-start:30px;top:100px;width:${EG.w - 60}px;opacity:0">
   <div style="font:500 28px/1.3 'Thmanyah Serif Text';color:#f1efea;direction:ltr;text-align:${AR ? "right" : "left"}">${ER.when}</div>
   <div style="font:500 28px/1.3 'Thmanyah Sans';color:#d9d7d2;margin-top:6px">${iso(K.T(ER))}</div></div>` });
fadeIn(eg, 16.1, 0.35, 16);
// the press, and the one arrow that passes (amber), out through the edge to the ledger
const jC = [BR.x + JB.x + JB.w / 2, BR.y + JB.y + 48];
cur.at(17.2, L(1500, 1300), L(820, 900)).to(17.3, jC[0], jC[1], 0.6); K.press(jira, 18.2); cur.press(18.2, jC[0], jC[1]); cur.hide(18.6);
const door = L([[BR.x + JB.x + JB.w, BR.y + JB.y + 48], [EG.x + 40, EG.y + 160]], [[BR.x + JB.x + JB.w / 2, BR.y + JB.y + 96], [EG.x + 470, EG.y + 60]]);
const go = add(`<div class="abs" style="left:${MX(door[0][0]) - 30}px;top:${door[0][1] - 30}px;width:60px;height:60px;opacity:0">${svg(IC.arrow, 60, "stroke:#f0b94a;stroke-width:3")}</div>`);
{ const dx = MX(door[1][0]) - MX(door[0][0]), dy = door[1][1] - door[0][1];
  gsap.set(go, { rotation: (Math.atan2(dy, dx) * 180) / Math.PI });
  fr(go, { opacity: 1, x: 0, y: 0 }, { x: dx, y: dy, duration: 0.45, ease: "power2.inOut" }, 18.3); to(go, { opacity: 0, scale: 0.4, duration: 0.15 }, 18.75); }
out(eg.querySelector(".em"), 18.7, 0.12); fadeIn(eg.querySelector(".row1"), 18.8, 0.3, 8);
to(eg, { borderColor: "#8a6a2a", duration: 0.2 }, 18.75);
// out: the camera rises to the top bar (the browser drops away)
to([brw, foot, eg], { y: "+=220", opacity: 0, duration: 0.5, ease: "power2.in" }, 20.3);
// ================= b5: the profile chip; hover lifts both names; the name drops onto an export's foot and types the trace line
const S5 = S("b5"), NM = N.cursorName;
const TB = L({ x: 160, y: 150, w: 1600, h: 96, chip: 1180 }, { x: 470, y: 100, w: 980, h: 96, chip: 560 });
const avatar = (px) => `<div style="width:${px}px;height:${px}px;border-radius:50%;background:linear-gradient(#3b4d5c,#2b3742);border:2px solid #6a7f8f;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;flex:none">${svg('<circle cx="12" cy="9" r="4.2"/><path d="M3.5 24a8.5 8.5 0 0117 0"/>', px * 0.86, "stroke:#c9d3da;fill:#c9d3da")}</div>`;
const tbar = B({ cls: "card", x: TB.x, y: TB.y, w: TB.w, h: TB.h, html: `
  <div class="abs" style="inset-inline-start:26px;top:22px;width:62px;height:52px">${K.MARK()}</div>
  <div class="abs" style="${AR ? "right" : "left"}:104px;top:24px;font:700 36px/1.2 'Thmanyah Serif Display';color:#f1efea;direction:ltr">QA Wrap</div>
  <div class="abs pchip" style="inset-inline-start:${TB.chip}px;top:14px;height:68px;padding:0 26px 0 8px;padding-inline:8px 26px;border-radius:34px;background:#2d3238;border:1.5px solid #4a5057;display:flex;align-items:center;gap:14px">${avatar(52)}<span style="font:700 30px/1 'Thmanyah Sans';color:#ecebe7;white-space:nowrap">${iso(S5[1])}</span></div>` });
fr(tbar, { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 20.6);
const HC = L({ x: 1240, y: 270, w: 520, h: 300 }, { x: 930, y: 216, w: 520, h: 300 });
const hov = B({ cls: "card", x: HC.x, y: HC.y, w: HC.w, h: HC.h, st: "border-color:#4a5057;box-shadow:0 40px 80px rgba(0,0,0,.55)", html: `
  ${tx(S5[0], 28, { x: 30, y: 24, c: "#a5abb0", st: "letter-spacing:.06em" })}
  <div class="abs" style="inset-inline-start:30px;top:80px">${avatar(84)}</div>
  <div class="abs" style="${AR ? "right" : "left"}:136px;top:76px;font:700 34px/1.3 'Thmanyah Sans';color:#f1efea;direction:ltr;text-align:${AR ? "right" : "left"};width:${HC.w - 166}px">${NM.en}</div>
  <div class="abs" dir="rtl" lang="ar" style="${AR ? "right" : "left"}:136px;top:124px;font:700 34px/1.3 'Thmanyah Sans';color:#f1efea;direction:rtl;text-align:${AR ? "right" : "left"};width:${HC.w - 166}px">${NM.ar}</div>
  <div class="pill" style="position:absolute;inset-inline-start:30px;top:206px;${P30}">${iso(K.T(N.editProfile))}</div>` });
const chipEl = tbar.querySelector(".pchip");
cur.at(20.9, L(1700, 1300), L(700, 520)).to(21.0, TB.x + TB.chip + 190, TB.y + 48, 0.4);
to(chipEl, { backgroundColor: "#353b42", borderColor: "#7bd389", duration: 0.15 }, 21.35);
fr(hov, { opacity: 0, y: 20, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.6)" }, 21.4);
cur.hide(22.1);
const EF = L({ x: 160, y: 280, w: 1000, h: 500 }, { x: 470, y: 520, w: 980, h: 480 });
const lines = N.steps;
const efile = B({ cls: "card", x: EF.x, y: EF.y, w: EF.w, h: EF.h, html: `
  <div class="abs" style="left:0;right:0;top:0;height:76px;border-bottom:1px solid #343a41"></div>
  <div class="abs" style="inset-inline-start:30px;top:18px">${K.ico("doc", "dim", 40)}</div>
  ${bar(90, 30, 240, 16, "#4b4f55", "hb")}${tx(S("b6")[0], 32, { x: 90, y: 18, cls: "ht", st: "opacity:0" })}
  ${[0, 1, 2].map((i) => bar(30, 112 + i * 56, [620, 520, 580][i], 16, "#3a4047", "lb")).join("")}
  ${[0, 1, 2].map((i) => `<div class="abs lt" style="inset-inline-start:30px;top:${96 + i * 56}px;font:500 30px/1.3 'Thmanyah Sans';color:#e3e1dc;white-space:nowrap;opacity:0"><span style="font-family:'Thmanyah Serif Text';color:#a5abb0;${AR ? "margin-left" : "margin-right"}:22px;direction:ltr;unicode-bidi:isolate">${lines.times[i]}</span>${i === lines.flip.line ? flipLine(i) : iso(K.T(lines)[i])}</div>`).join("")}
  <div class="abs" style="left:30px;right:30px;top:290px;border-top:1px solid #343a41"></div>
  <div class="abs trace" style="inset-inline-start:30px;top:306px;font:700 30px/1.25 'Thmanyah Sans';color:#ecebe7;white-space:nowrap;opacity:0">${iso((AR ? S5.slice(2) : S5.slice(3)).join(" · "))}</div>
  <div class="abs seal" style="left:30px;right:30px;top:362px;height:60px;border-radius:10px;background:#1d2125;border:1.5px solid #3f6d49;display:flex;align-items:center;gap:16px;padding:0 18px;opacity:0">${svg(IC.seal, 36, "stroke:#7bd389")}<i style="display:block;height:14px;flex:1;border-radius:7px;background:repeating-linear-gradient(90deg,#4f6b55 0 30px,transparent 30px 40px)"></i></div>
  <div class="abs fp" style="inset-inline-start:30px;top:436px;font:500 30px/1.25 'Thmanyah Sans';color:#cfcdc8;white-space:nowrap;opacity:0">${iso(S("b7")[0])}</div>` });
function flipLine(i) { // the line whose one letter changes in b6: the word is Latin in both cuts
  const s = K.T(lines)[i], wd = lines.flip.word, at = lines.flip.at, j = s.indexOf(wd);
  const word = `<bdi dir="ltr">${wd.slice(0, at)}<span class="fl" style="position:relative;display:inline-block"><span class="fa">${wd[at]}</span><span class="fb" style="position:absolute;left:0;top:0;opacity:0;border-radius:4px">${lines.flip.to}</span></span>${wd.slice(at + 1)}</bdi>`;
  return iso(s.slice(0, j)) + word + iso(s.slice(j + wd.length));
}
fr(efile, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 21.6);
// lead move: the chip's name drops down onto the export's foot (an arc), then the trace line types out (linear)
const nameTok = B({ x: TB.x + TB.chip + 74, y: TB.y + 30, w: 200, st: `font:700 30px/1.2 'Thmanyah Sans';color:#f1efea;white-space:nowrap`, html: iso(S5[1]) });
const nd = [ (EF.x + 30) - (TB.x + TB.chip + 74), (EF.y + 306) - (TB.y + 30) ];
set(nameTok, { opacity: 1 }, 22.3);
tl.to(nameTok, { keyframes: [{ x: SG(nd[0] * 0.5), y: nd[1] * 0.5 - 120, duration: 0.25, ease: "sine.out" }, { x: SG(nd[0]), y: nd[1], duration: 0.25, ease: "sine.in" }] }, 22.3);
set(nameTok, { opacity: 0 }, 22.82);
K.type(efile.querySelector(".trace"), 22.8, 0.5);
// ================= b6: the export becomes Timeline (sealed); the seal slams; Verify: INTACT; one letter flips; Verify again: ALTERED
const S6 = S("b6");
out([tbar, hov], 26.0, 0.3);
if (V) to(efile, { y: 100 - EF.y, duration: 0.5, ease: "power2.inOut" }, 26.0); // 9:16: the top bar leaves, the file rises
const ef = (s) => efile.querySelector(s), efa = (s) => efile.querySelectorAll(s);
out([ef(".hb"), ...efa(".lb")], 26.05, 0.2); fadeIn(ef(".ht"), 26.15, 0.3); efa(".lt").forEach((e, i) => fadeIn(e, 26.2 + i * 0.08, 0.3, 6));
fr(ef(".seal"), { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power4.in" }, 26.25); // lands at 26.65 (sting 26.6)
const VBp = L({ x: 1240, y: 330, w: 520 }, { x: 490, y: 620, w: 600 });
const vb = K.btn({ x: VBp.x, y: VBp.y, w: VBp.w, h: 100, text: S6[1], style: "font-size:32px" });
pop(vb, 26.8, 0.4, 2, 0.4);
const RL = L({ x: 1240, y: 460, w: 520 }, { x: 490, y: 750, w: 940 });
const res = B({ x: RL.x, y: RL.y, w: RL.w, st: "font:700 28px/1.35 'Thmanyah Sans';color:#a7dcb0;white-space:normal", html: iso(S6[2]) });
const SP = L({ x: 900, y: 440 }, { x: 1230, y: 250 });
const stI = K.stamp({ x: SP.x, y: SP.y, text: S("b8")[0], cls: "green" });
const stA = K.stamp({ x: SP.x + 30, y: SP.y + 26, text: S6[3] });
const vC = [VBp.x + VBp.w / 2, VBp.y + 50];
cur.at(27.0, L(1700, 1300), L(800, 960)).to(27.0, vC[0], vC[1], 0.25); K.press(vb, 27.3); cur.press(27.3, vC[0], vC[1]); cur.hide(27.7);
K.slam(stI, 27.35, 0.25, -9); fadeIn(res, 27.6, 0.3, 6);
// one letter flips (coral flash on that letter)
fr(ef(".fb"), { opacity: 0 }, { opacity: 1, duration: 0.05, ease: "none" }, 28.6); set(ef(".fa"), { opacity: 0 }, 28.65);
fr(ef(".fb"), { backgroundColor: "rgba(255,125,99,0)", color: "#e3e1dc" }, { backgroundColor: "rgba(255,125,99,.9)", color: "#2a1410", duration: 0.12, ease: "none" }, 28.6);
to(ef(".fb"), { backgroundColor: "rgba(255,125,99,.28)", color: "#ff9d88", duration: 0.5 }, 28.9);
cur.at(29.8, L(1700, 1300), L(800, 960)).to(29.85, vC[0], vC[1], 0.35); K.press(vb, 30.4); cur.press(30.4, vC[0], vC[1]); cur.hide(30.8);
to(stI, { opacity: 0, duration: 0.15 }, 30.8); // the green verdict gives way to the coral one to(res, { opacity: 0.35, duration: 0.2 }, 30.55);
K.slam(stA, 30.5, 0.3, -6); // lands 30.8 (sting)
K.glow("green", 26.0, L(800, 960), L(560, 500), 1.0);
// ================= b7: the honest beat: the seal block under fully readable text; the fingerprint; a second file, another key
const S7 = S("b7");
out([vb, res, stI, stA], 32.0, 0.3);
to([ef(".ht"), ef(".trace")], { opacity: 0.5, duration: 0.6 }, 32.1); // dim everything except the seal block and the text it covers
K.type(ef(".fp"), 32.6, 0.7);
cam(32.2, { s: 1.05, vs: 1.04, d: 2.0 });
const SF = L({ x: 1220, y: 300, w: 580, h: 440 }, { x: 490, y: 600, w: 940, h: 380 });
const sf = B({ cls: "card", x: SF.x, y: SF.y, w: SF.w, h: SF.h, html: `
  <div class="abs" style="left:0;right:0;top:0;height:76px;border-bottom:1px solid #343a41"></div>
  <div class="abs" style="inset-inline-start:30px;top:18px">${K.ico("doc", "dim", 40)}</div>${tx(S6[0], 32, { x: 90, y: 18 })}
  ${V ? "" : `${bar(30, 108, 420, 16)}${bar(30, 148, 340, 16)}`}
  <div class="abs" style="left:30px;right:30px;top:${V ? 100 : 190}px;height:56px;border-radius:10px;background:#1d2125;border:1.5px solid #3a4047;display:flex;align-items:center;gap:16px;padding:0 18px">${svg(IC.seal, 34, "stroke:#9aa0a6")}<i style="display:block;height:14px;flex:1;border-radius:7px;background:repeating-linear-gradient(90deg,#4b5057 0 22px,transparent 22px 32px)"></i></div>
  ${tx(S7[0].replace(/[0-9a-f]{4} [0-9a-f]{4} …/, N.fingerprint2.value), 30, { x: 30, y: V ? 176 : 266, c: "#cfcdc8", wt: 500 })}
  <div class="abs nk" style="inset-inline-start:30px;top:${V ? 230 : 320}px;width:${SF.w - 60}px;font:700 30px/1.3 'Thmanyah Sans';color:#f0b94a;opacity:0">${iso(S7[1])}</div>` });
fr(sf, { opacity: 0, x: SG(260) }, { opacity: 1, x: 0, duration: 0.6, ease: "power2.out" }, 34.0);
fadeIn(sf.querySelector(".nk"), 34.7, 0.4, 6);
// ================= b8: the bookend: the b1 card again, masked, its Prepared by line, the seal and INTACT, inside the browser frame
to([efile, sf], { opacity: 0, scale: 0.92, duration: 0.3, ease: "power2.in" }, 38.6); // p3: fully out before the bookend arrives (no double exposure)
cam(38.9, { s: 1, vs: 1, d: 0.4 });
const W8 = L({ x: 510, y: 150 }, { x: 510, y: 140 });
set(win1, { x: SG(W8.x - W1.x), y: W8.y - W1.y, scale: 1 }, 38.95);
if (V) { set(q1(".tx"), { opacity: 1 }, 38.95); set(q1(".bx"), { opacity: 0 }, 38.95); }
set([q1(".tx")[0], card.querySelector(".cn")], { opacity: 0 }, 38.95); // covered by the masks: the values are not under the blocks any more
set(card.querySelector(".pv"), { display: "none" }, 38.95); set(card.querySelector(".pb"), { display: "inline" }, 38.95);
set([...q1(".abs")].filter((e) => e.getAttribute("style").includes("#0c0e10")), { opacity: 1 }, 38.95); set(q1(".ft"), { opacity: 1 }, 38.95);
fr(win1, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.55, ease: "power2.out" }, 38.92); // p3: the card settles back into its frame (arrival, not a cut)
const st8 = K.stamp({ x: W8.x + 660, y: W8.y + 300, text: S("b8")[0], cls: "green" });
to(card, { filter: "brightness(0.82)", duration: 0.2, ease: "none" }, 39.55); to(card, { filter: "brightness(1)", duration: 0.25 }, 40.0); // p3: anticipation dim
K.slam(st8, 39.75, 0.25, -9); // lands 40.0 (success)
tl.to(win1, { y: "+=5", duration: 0.06, yoyo: true, repeat: 1, ease: "power2.out" }, 40.0); // p3: follow-through
to(st8, { boxShadow: "0 0 50px rgba(123,211,137,.6)", duration: 0.1, ease: "none" }, 40.0); to(st8, { boxShadow: "0 0 0 rgba(123,211,137,0)", duration: 0.2 }, 40.1);
K.glow("green", 39.0, 960, L(560, 620), 0.8);
// ================= p3 polish (16:9; 9:16 keeps its own framing): slow sine drifts on the holds so no frame sits frozen,
// anticipations before the stamps, follow-through after them. Each drift ends before the next camera move on that layer.
if (!V) {
  const drift = (t, s, d, el) => cam(t, { s, d, ease: "sine.inOut" }, el);
  drift(0.3, 1.02, 4.2);                        // b1: the stage breathes with the card's drift
  cam(4.5, { s: 1, d: 0.6 });                   // level before the frame draws (5.0)
  drift(7.1, 1.02, 2.8);                        // b2 hold (Wake up, Awake)
  drift(10.75, 1.03, 4.3, f); cam(15.15, { s: 1, d: 0.35 }, f); // b3: the form breathes; back before it leaves
  drift(16.5, 1.025, 3.7); cam(20.25, { s: 1, d: 0.35 });       // b4 hold; level before the top bar arrives
  drift(22.6, 1.02, 3.4);                       // b5 hold (the trace line)
  drift(26.1, 1.0, 0.5);                        // b6: level for the seal slam
  drift(28.0, 1.025, 4.1);                      // b6 hold (Verify, the flip, ALTERED); b7 continues the push from here
  drift(34.3, 1.07, 4.3);                       // b7: the honest hold keeps its slow push
  drift(39.5, 1.03, 2.45);                      // b8 bookend hold, ends as the drain starts (42.0)
  // anticipation: the efile glows a beat before each verdict; follow-through: the card gives under each stamp
  to(efile, { boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 40px rgba(123,211,137,.22)", duration: 0.2, ease: "none" }, 27.1);
  to(efile, { boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 0 rgba(123,211,137,0)", duration: 0.4 }, 27.7);
  tl.to(efile, { y: "+=5", duration: 0.06, yoyo: true, repeat: 1, ease: "power2.out" }, 26.65);
  tl.to(efile, { y: "+=4", duration: 0.06, yoyo: true, repeat: 1, ease: "power2.out" }, 27.6);
  to(efile, { boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 40px rgba(255,125,99,.22)", duration: 0.2, ease: "none" }, 30.3);
  to(efile, { boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 0 rgba(255,125,99,0)", duration: 0.5 }, 30.9);
  tl.to(efile, { y: "+=5", duration: 0.06, yoyo: true, repeat: 1, ease: "power2.out" }, 30.8);
}
// ================= b9: shared end card
K.titles({ b1: [0, 4.15] });
K.captions(AR ? {} : { 19: { outSec: 42.2 } }); // p3: EN V8 ends 42.06 s (fit-en.json), 156 ms past 41.9: caption held to 42.2
K.endCard(K.beat("b9"), undefined, { links: true });
K.done();
})();
