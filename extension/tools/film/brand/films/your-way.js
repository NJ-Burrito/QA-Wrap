/* Film 6, your-way: "Your Language, Your Numbers, Your Agent" (brand-films.md Film 6). Worker b3, 2026-11-10.
   Words from films.json via K.scr; strings films.json lacks via K.N (build-notes.json "your-way").
   b1-b2 are about direction, so the note card's CONTENT is the same in both cuts (broken left to right, then right to
   left); only the layout around it mirrors (doc "Arabic cut"). 16:9 and 9:16 are laid out separately (L(h, v)). */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, V, iso, N, to, fr, set, out, pop, fadeIn, cam } = K;
const S = (id, l) => K.scr(id, l), L = (h, v) => (V ? v : h), w = K.world, f = K.fg, tl = K.tl;
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".v #ec .v2tg{font-size:30px;height:60px;line-height:58px}" }));
const P30 = "font-size:30px;height:62px;line-height:60px;padding:0 28px;";
const P34 = V ? P30 : "font-size:34px;height:68px;line-height:66px;padding:0 30px;"; // p3: 16:9 bridge and companion labels enlarged
K.light([420, 520], [1100, 520]);
if (V) { cam(0, { vs: 1 }); cam(0, { vs: 1 }, f); }
const svg = (d, px, st = "") => `<svg viewBox="0 0 24 24" class="ic" style="width:${px}px;height:${px}px;${st}">${d}</svg>`;
const IC = { lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', note: '<path d="M5 3h10l4 4v14H5zM15 3v4h4M8 11h8M8 15h6"/>' };
const B = (o) => add(`<div class="${o.cls || "abs"}" style="left:${mx(o.x, o.w)}px;top:${o.y}px;width:${o.w}px;${o.h ? `height:${o.h}px;` : ""}${o.dir ? `direction:${o.dir};` : AR ? "direction:rtl;" : ""}${o.show ? "" : "opacity:0;"}${o.st || ""}">${o.html || ""}</div>`, o.p || w);
const tx = (s, fs, o = {}) => `<div class="abs ${o.cls || ""}" style="inset-inline-start:${o.x ?? 0}px;top:${o.y ?? 0}px;font:${o.wt || 700} ${fs}px/1.25 '${o.fam || "Thmanyah Sans"}';color:${o.c || "#ecebe7"};${o.wrap ? `white-space:normal;width:${o.wrap}px;` : "white-space:nowrap;"}${o.st || ""}">${o.raw ? s : iso(s)}</div>`;
const bar = (x, y, bw, h = 16, c = "#3a4047") => `<div class="bar" style="inset-inline-start:${x}px;top:${y}px;width:${bw}px;height:${h}px;background:${c}"></div>`;
// ================= b1: the note card, laid out left to right; the Arabic line broken by it (both cuts)
const LINE = S("b1", "ar")[0], cut = LINE.indexOf("API");
const NC = L({ x: 220, y: 290, w: 1080, h: 340, fs: 52 }, { x: 470, y: 170, w: 980, h: 380, fs: 50 });
const noteLayer = (dir, broken) => `<div class="abs ${broken ? "lb" : "lr"}" style="inset:0;direction:${dir};${broken ? "" : "opacity:0;"}">
  <div class="abs" style="left:0;right:0;top:0;height:76px;border-bottom:1px solid #343a41"></div>
  <div class="abs" style="inset-inline-start:30px;top:18px">${svg(IC.note, 40, "stroke:#9aa0a6")}</div>${bar(90, 30, 220, 16, "#4b4f55")}
  <div class="abs" style="inset-inline-start:40px;top:${V ? 130 : 118}px;font:700 ${NC.fs}px/1.3 'Thmanyah Sans';color:#f4f2ee;white-space:nowrap;direction:${dir}">${broken
    ? `${LINE.slice(0, cut)}<span class="u" style="border-bottom:5px solid #ff7d63;padding-bottom:2px">${LINE.slice(cut)}</span>`
    : `${LINE.slice(0, cut)}<bdi dir="ltr">API</bdi>${LINE.slice(cut + 3)}`}</div>
  ${bar(40, V ? 250 : 236, NC.w * 0.62, 16)}${bar(40, V ? 292 : 276, NC.w * 0.44, 16)}</div>`;
const note = B({ cls: "card", x: NC.x, y: NC.y, w: NC.w, h: NC.h, show: true, dir: "ltr", html: `${noteLayer("ltr", true)}${noteLayer("rtl", false)}
  <div class="abs sweep" data-layout-ignore style="top:0;bottom:0;left:-30%;width:30%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);opacity:0"></div>` });
note.style.overflow = "hidden";
gsap.set(note, { transformPerspective: 1600 });
const nq = (s) => note.querySelector(s);
// ================= b2: the language pill; العربية pressed; the card flips on its vertical axis and lands right to left
const S2en = S("b2", "en"), S2ar = S("b2", "ar");
const REC = { en: S2en[2].split(" / ")[0], ar: S2ar[2] };
const LP = L({ cx: NC.x + NC.w / 2, y: NC.y + NC.h + 40 }, { cx: 960, y: NC.y + NC.h + 36 });
const lp = add(`<div class="abs" style="left:${MX(LP.cx) - 230}px;top:${LP.y}px;width:460px;height:70px;border-radius:35px;background:#272b30;border:1px solid #3a4047;display:flex;gap:8px;padding:6px;${AR ? "direction:rtl;" : ""}opacity:0">
  <div class="sE" style="flex:1;border-radius:29px;background:#3a4047;font:700 30px/58px 'Thmanyah Sans';text-align:center;color:#f1efea;direction:ltr">${S2en[0]}</div>
  <div class="sA" dir="rtl" lang="ar" style="flex:1;border-radius:29px;font:700 30px/58px 'Thmanyah Sans';text-align:center;color:#a5abb0;direction:rtl">${S2en[1]}</div></div>`);
const sE = lp.querySelector(".sE"), sA = lp.querySelector(".sA");
fr(lp, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: "back.out(1.6)" }, 5.25);
const cur = K.cursor();
const aC = [LP.cx + 115, LP.y + 35]; // the العربية half (the cursor helper mirrors x)
cur.at(5.0, L(1400, 1300), L(900, 960)).to(5.1, aC[0], aC[1], 0.5);
to(sA, { backgroundColor: "#c99a3c", duration: 0.15, ease: "none" }, 5.65); // anticipation
to(sA, { backgroundColor: "#f0b94a", color: "#2a2008", duration: 0.1 }, 5.8); to(sE, { backgroundColor: "rgba(58,64,71,0)", color: "#a5abb0", duration: 0.15 }, 5.8);
tl.to(sA, { y: 4, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.in" }, 5.8); cur.press(5.8, aC[0], aC[1]); cur.hide(6.3);
// the popup behind (rows left-aligned, then right-aligned)
const PPp = L({ x: 1380, y: 250, w: 420, h: 380 }, { x: 490, y: 690, w: 940, h: 290 });
const popRows = (dir, lang) => `<div class="abs ${lang === "ar" ? "pa" : "pe"}" style="inset:0;direction:${dir};${lang === "ar" ? "opacity:0;" : ""}">
  <div class="abs" style="${dir === "rtl" ? "right" : "left"}:24px;top:20px;width:52px;height:44px;direction:ltr">${K.MARK()}</div>
  <div class="abs" style="${dir === "rtl" ? "right" : "left"}:90px;top:22px;font:700 32px/1.2 'Thmanyah Serif Display';color:#f1efea;direction:ltr;unicode-bidi:isolate">QA Wrap</div>
  <div class="btn" style="position:absolute;inset-inline-start:24px;top:96px;height:76px;font-size:30px;direction:${dir}">${REC[lang]}</div>
  ${bar(24, V ? 210 : 210, PPp.w * 0.62, 16)}${bar(24, V ? 246 : 250, PPp.w * 0.44, 16)}${V ? "" : bar(24, 290, PPp.w * 0.54, 16)}</div>`;
const popup = B({ cls: "card", x: PPp.x, y: PPp.y, w: PPp.w, h: PPp.h, dir: "ltr", html: popRows("ltr", "en") + popRows("rtl", "ar") });
fr(popup, { opacity: 0, x: SG(80) }, { opacity: 0.92, x: 0, duration: 0.5, ease: "power2.out" }, 5.3);
// lead move (6.2): the flip, power2.inOut 0.8 s in two halves; the layers swap edge-on
tl.to(note, { rotationY: SG(-90), duration: 0.4, ease: "power2.in" }, 6.2);
set(nq(".lb"), { opacity: 0 }, 6.6); set(nq(".lr"), { opacity: 1 }, 6.6);
tl.fromTo(note, { rotationY: SG(90) }, { rotationY: 0, duration: 0.4, ease: "power2.out", immediateRender: false }, 6.6);
fr(nq(".sweep"), { opacity: 1, x: 0 }, { x: NC.w * 1.35, duration: 0.8, ease: "power2.inOut" }, 6.2);
tl.to(popup, { rotationY: SG(-90), duration: 0.3, ease: "power2.in" }, 6.4);
set(popup.querySelector(".pe"), { opacity: 0 }, 6.7); set(popup.querySelector(".pa"), { opacity: 1 }, 6.7);
tl.fromTo(popup, { rotationY: SG(90) }, { rotationY: 0, duration: 0.3, ease: "power2.out", immediateRender: false }, 6.7);
gsap.set(popup, { transformPerspective: 1400 });
fr(note, { boxShadow: "0 30px 60px rgba(0,0,0,.45)" }, { boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 46px rgba(123,211,137,.22)", duration: 0.5 }, 7.0);
// out: the card shrinks to the corner (top inline-end); the pill and the popup leave
const CORNER = L({ x: 1700, y: 150, k: 0.24 }, { x: 1330, y: 90, k: 0.26 });
const ncC = [NC.x + NC.w / 2, NC.y + NC.h / 2];
to(note, { x: SG(CORNER.x - ncC[0]), y: CORNER.y - ncC[1], scale: CORNER.k, opacity: 0.55, duration: 0.6, ease: "power2.inOut" }, 10.9);
out([lp, popup], 10.9, 0.3);
// ================= b3: Performance indicators: four tiles count up, the time-per-day chart grows bar by bar (no severity, no trend)
const S3 = S("b3");
const DB = L({ x: 160, y: 250, w: 1600, h: 550 }, { x: 470, y: 120, w: 980, h: 870 });
const split = (s) => { const m = s.match(/^(\D+?)\s+(\d.*)$/); return [m[1], m[2]]; };
const tiles = S3.slice(2, 6).map(split);
const TL = L((i) => ({ x: 50 + i * 380, y: 160, w: 355, h: 165 }), (i) => ({ x: 40 + (i % 2) * 465, y: 210 + Math.floor(i / 2) * 190, w: 435, h: 165 }));
const chartY = L(350, 600), barsY = L([402, 505], [650, 840]), barW = L(130, 92), barGap = L(80, 42);
const dash = B({ cls: "card", x: DB.x, y: DB.y, w: DB.w, h: DB.h, html: `
  ${tx(S3[0], 28, { x: 50, y: 30, c: "#9aa0a6", st: "letter-spacing:.1em", cls: "eb" })}
  ${tx(S3[1], 46, { x: 50, y: 70, fam: "Thmanyah Serif Display", c: "#f1efea" })}
  <div class="pill" style="position:absolute;${V ? "inset-inline-start:40px;top:140px" : "inset-inline-end:50px;top:44px"};${P30}">${svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', 28, "vertical-align:-5px;margin-inline-end:12px")}${iso(S3[7])}</div>
  ${tiles.map(([lab, val], i) => { const t = TL(i); return `<div class="abs" style="inset-inline-start:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;border-radius:14px;background:#2a2e33;border:1px solid ${i ? "#3a4047" : "#5a6068"}">
    ${tx(lab, L(32, 28), { x: 26, y: L(18, 22), c: "#a5abb0" })}<div class="abs tv" data-i="${i}" style="inset-inline-start:26px;top:${V ? 74 : 70}px;font:500 ${V ? (i ? 46 : 54) : (i ? 46 : 58)}px/1.15 'Thmanyah Serif Text';color:${i ? "#d9d7d2" : "#ffffff"};white-space:nowrap"></div></div>`; }).join("")}
  ${tx(S3[6], L(30, 28), { x: 50, y: chartY, c: "#cfcdc8" })}
  <div class="abs" style="inset-inline-start:50px;top:${barsY[1]}px;width:${7 * barW + 6 * barGap}px;border-top:2px solid #4a5057"></div>
  ${N.bars.values.map((v, i) => `<div class="abs kb" style="inset-inline-start:${50 + i * (barW + barGap)}px;top:${barsY[1] - (barsY[1] - barsY[0]) * v}px;width:${barW}px;height:${(barsY[1] - barsY[0]) * v}px;border-radius:8px 8px 2px 2px;background:#8a9096;transform-origin:50% 100%"></div>`).join("")}` });
gsap.set(dash, { transformPerspective: 1800, rotationX: 7, transformOrigin: "50% 100%" }); // low angle: the work made big
fr(dash, { opacity: 0, y: 140, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, 11.2);
// the count (linear 1.0 s, 12.4-13.4), in the KPI's own formats (kpi.dur.hm / kpi.dur.m, the tile values)
const STEPS = 12, C0 = 12.4, C1 = 13.4;
const fmt = (i, p) => { const v = tiles[i][1];
  if (i === 0) { const m = v.match(/^(\d+)(\D+)(\d+)(\D*)$/), tot = Math.round(N.minutes.value * p), h = Math.floor(tot / 60), mm = tot % 60; return h ? `${h}${m[2]}${mm}${m[4]}` : `${mm}${m[4]}`; }
  return v.replace(/^\d+/, String(Math.round(parseInt(v, 10) * p))); };
dash.querySelectorAll(".tv").forEach((el) => { const i = +el.dataset.i;
  el.innerHTML = Array.from({ length: STEPS + 1 }, (_, k) => `<span style="${k === STEPS ? "" : "display:none"}">${iso(fmt(i, k / STEPS))}</span>`).join("");
  const sp = el.querySelectorAll("span");
  gsap.set(sp[STEPS], { display: "none" }); gsap.set(sp[0], { display: "inline" });
  sp.forEach((s, k) => { if (k) set(s, { display: "inline" }, C0 + (k * (C1 - C0)) / STEPS); if (k < STEPS) set(s, { display: "none" }, C0 + ((k + 1) * (C1 - C0)) / STEPS); }); });
gsap.set(dash.querySelectorAll(".kb"), { scaleY: 0 }); // p3: the bars are empty until they grow (13.5)
dash.querySelectorAll(".kb").forEach((b, i) => fr(b, { scaleY: 0 }, { scaleY: 1, duration: 0.35, ease: "back.out(1.4)" }, 13.5 + i * 0.12));
K.glow("green", 11.2, L(700, 960), L(420, 500), 1.0);
// out: the dashboard slides away (inline-start)
to(dash, { x: SG(-500), opacity: 0, duration: 0.5, ease: "power2.in" }, 16.9);
// ================= b4: Agent bridge on; a dotted line to a coding-agent chip through the helper; get_failures out, failures back; read only
const S4 = S("b4");
const TG = L({ x: 160, y: 340, w: 600, h: 270 }, { x: 490, y: 100, w: 940, h: 230 });
const P = L({ A: [760, 475], Lk: [880, 475], H: [1040, 475], G: [1580, 475] }, { A: [960, 330], Lk: [960, 440], H: [960, 600], G: [960, 840] });
const tog = B({ cls: "card", x: TG.x, y: TG.y, w: TG.w, h: TG.h, html: `${tx(S4[0], 38, { x: 32, y: 30 })}
  <div class="abs trk" style="inset-inline-end:32px;top:30px;width:112px;height:60px;border-radius:30px;background:#3a4047"><i class="kn" style="position:absolute;top:7px;inset-inline-start:7px;width:46px;height:46px;border-radius:50%;background:#cfcdc8"></i></div>
  <div class="abs st" style="inset-inline-start:32px;top:${V ? 120 : 130}px;width:${TG.w - 64}px;font:500 32px/1.3 'Thmanyah Sans';color:#e3e1dc;opacity:0">${iso(S4[1])}</div>` });
fr(tog, { opacity: 0, x: SG(-80) }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" }, 17.1);
const trk = tog.querySelector(".trk"), tC = [TG.x + TG.w - 32 - 56, TG.y + 60];
cur.at(17.2, L(900, 1300), L(800, 600)).to(17.25, tC[0], tC[1], 0.3);
to(trk, { backgroundColor: "#c99a3c", duration: 0.15, ease: "none" }, 17.45); to(trk, { backgroundColor: "#f0b94a", duration: 0.1 }, 17.6);
to(tog.querySelector(".kn"), { x: SG(52), backgroundColor: "#2a2008", duration: 0.25, ease: "back.out(2)" }, 17.6);
cur.press(17.6, tC[0], tC[1]); cur.hide(18.0); fadeIn(tog.querySelector(".st"), 17.8, 0.3, 6);
// the line: a dotted polyline drawn from the toggle (inline start) to the agent
const ln = add(`<svg class="abs" width="1920" height="1100" style="left:0;top:0;overflow:visible"><path d="M${MX(P.A[0])} ${P.A[1]} L${MX(P.G[0])} ${P.G[1]}" fill="none" stroke="#cfcdc8" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 17"/></svg>`);
const horiz = !V, cA = horiz ? `inset(0px ${AR ? 1920 - MX(P.A[0]) : 1920 - P.A[0]}px 0px ${AR ? MX(P.A[0]) : P.A[0]}px)` : `inset(${P.A[1]}px 0px ${1100 - P.A[1]}px 0px)`;
const cG = horiz ? `inset(0px ${AR ? 1920 - MX(P.A[0]) : 1920 - P.G[0]}px 0px ${AR ? MX(P.G[0]) : P.A[0]}px)` : `inset(${P.A[1]}px 0px ${1100 - P.G[1]}px 0px)`;
gsap.set(ln, { clipPath: cA });
fr(ln, { clipPath: cA }, { clipPath: cG, duration: 0.8, ease: "power2.inOut" }, 18.4);
const helper = K.chip({ x: P.H[0], y: P.H[1], s: 112, icon: "hook" });
const agent = K.chip({ x: P.G[0], y: P.G[1], s: 170, html: `<svg viewBox="0 0 24 24" class="ic" style="width:60%;height:60%;stroke-width:1.8">${'<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>'}</svg>` });
const lock = K.chip({ x: P.Lk[0], y: P.Lk[1], s: 96, html: svg(IC.lock, 56, "stroke:#ffffff;stroke-width:2.4"), style: "border-color:#8a9096" });
const pl = (t, x, y, st = "") => K.pill({ x, y, anchor: "c", text: t, style: P34 + st });
const bridgeP = pl(S4[2], L(P.H[0], P.H[0] + 250), L(P.H[1] + 100, P.H[1]), "direction:ltr");
const roP = pl(S4[4], L(P.Lk[0], P.Lk[0] + 200), L(P.Lk[1] - 96, P.Lk[1]));
pop(helper, 18.6, 0.4, 2, 0.4); pop(bridgeP, 18.75, 0.3, 2, 0.5); pop(agent, 19.0, 0.45, 1.8, 0.4);
pop(lock, 19.25, 0.35, 2.5, 0.3); pop(roP, 19.4, 0.3, 2, 0.5);
// get_failures travels from the agent to the helper; a short list of failures returns. No arrow back into QA Wrap.
const reqP = pl(S4[3], L(P.G[0] - 120, P.G[0] - 230), L(P.G[1] - 74, P.G[1] - 40), "direction:ltr;border-color:#6b7178");
const rq = L([P.H[0] + 150 - (P.G[0] - 120), 0], [0, P.H[1] + 80 - (P.G[1] - 40)]);
fr(reqP, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 19.55);
to(reqP, { x: SG(rq[0]), y: rq[1], duration: 1.0, ease: "power2.inOut" }, 19.75);
out(reqP, 20.75, 0.2);
const LS = L({ x: P.H[0] + 40, y: P.H[1] + 150 }, { x: P.H[0] + 90, y: P.H[1] + 20 });
const list = B({ cls: "card", x: LS.x, y: LS.y, w: 250, h: 136, st: "border-color:#5a6068", html: [0, 1, 2].map((i) => `<i style="position:absolute;inset-inline-start:22px;top:${28 + i * 36}px;width:14px;height:14px;border-radius:50%;background:#ff7d63"></i>${bar(50, 27 + i * 36, [150, 120, 160][i], 14, "#5d6168")}`).join("") });
const ld = L([P.G[0] - 125 - LS.x - 260, 0], [0, P.G[1] - 68 - LS.y - 30]);
fr(list, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 20.8);
to(list, { x: SG(ld[0]), y: ld[1], duration: 0.8, ease: "power2.inOut" }, 21.0);
K.glow("green", 17.0, L(900, 960), L(480, 500), 1.0);
// out: the agent chip shrinks; the rest leaves
to(agent, { scale: 0.4, opacity: 0, duration: 0.4, ease: "power2.in" }, 22.9);
out([tog, ln, helper, lock, bridgeP, roP, list], 22.9, 0.3);
// ================= b5: Bug Hunt: Level 3 of 5, Dead button; Next pressed, nothing; a note; Bug caught slams; a sticker flies to the corner
const S5 = S("b5");
const GC = L({ x: 200, y: 250, w: 1520, h: 560 }, { x: 470, y: 100, w: 980, h: 890 });
const MP = L({ x: 760, y: 100, w: 720, h: 420 }, { x: 40, y: 280, w: 900, h: 400 });
const NB = L({ x: 40, y: 330, w: 660, h: 100 }, { x: 40, y: 720, w: 900, h: 100 });
const game = B({ cls: "card", x: GC.x, y: GC.y, w: GC.w, h: GC.h, html: `
  <div class="abs" style="inset-inline-start:30px;top:22px;width:58px;height:58px;border-radius:14px;background:#2d3238;display:flex;align-items:center;justify-content:center">${K.ico("bug", "green", 38)}</div>
  ${tx(S5[0], 38, { x: 104, y: 26, fam: "Thmanyah Serif Display", c: "#f1efea" })}
  <div class="pill" style="position:absolute;inset-inline-end:30px;top:22px;${P30}">${iso(S5[1])}</div>
  ${tx(S5[2], 36, { x: 40, y: L(118, 106), c: "#f1efea" })}
  ${tx(S5[3], 30, { x: 40, y: L(170, 162), wt: 500, c: "#cfcdc8", wrap: L(640, 900) })}
  <div class="abs" style="inset-inline-start:${MP.x}px;top:${MP.y}px;width:${MP.w}px;height:${MP.h}px;border-radius:12px;background:#1f2327;border:1px solid #343a41">
   ${bar(30, 30, 200, 18, "#4b4f55")}
   <div class="abs" style="inset-inline-start:30px;top:80px;width:${V ? 220 : 260}px;height:${V ? 200 : 260}px;border-radius:10px;background:#2a2e33;display:flex;align-items:center;justify-content:center">${K.ico("bag", "dim", 110)}</div>
   ${bar(V ? 280 : 320, 96, 240, 18, "#53575d")}${bar(V ? 280 : 320, 136, 160, 16)}${bar(V ? 280 : 320, 172, 200, 16)}
   <div class="abs nx" style="inset-inline-end:30px;bottom:30px;width:220px;height:76px;border-radius:10px;background:#d8d6d1;font:700 32px/76px 'Thmanyah Sans';text-align:center;color:#1d2024">${iso(K.T(N.next))}</div></div>
  <div class="abs field" style="inset-inline-start:${NB.x}px;top:${NB.y}px;width:${NB.w}px;height:${NB.h}px"></div>
  <div class="abs nt" style="inset-inline-start:${NB.x + 26}px;top:${NB.y + 30}px;font:500 32px/1.25 'Thmanyah Sans';color:#ecebe7;white-space:nowrap;opacity:0">${iso(K.T(N.note))}</div>` });
fr(game, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, 23.3);
const nxC = [GC.x + MP.x + MP.w - 30 - 110, GC.y + MP.y + MP.h - 30 - 38];
cur.at(23.8, L(1400, 1300), L(900, 980)).to(23.9, nxC[0], nxC[1], 0.4);
const nx = game.querySelector(".nx");
tl.to(nx, { y: 4, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.in" }, 24.4); cur.press(24.4, nxC[0], nxC[1]); cur.hide(24.9);
K.type(game.querySelector(".nt"), 24.95, 0.6);
const bc = K.stamp({ x: GC.x + MP.x + MP.w / 2, y: GC.y + MP.y + MP.h / 2 - 20, text: S5[4], cls: "green" });
K.slam(bc, 25.7, 0.3, -8); // lands 26.0 (sting)
if (!V) { to(game, { filter: "brightness(0.85)", duration: 0.2, ease: "none" }, 25.5); to(game, { filter: "brightness(1)", duration: 0.25 }, 26.0); // p3: anticipation dim
  tl.to(game, { y: "+=5", duration: 0.06, yoyo: true, repeat: 1, ease: "power2.out" }, 26.0); } // p3: follow-through
const stk = add(`<div class="abs" style="left:${MX(GC.x + MP.x + MP.w / 2) - 48}px;top:${GC.y + MP.y + MP.h / 2 - 68}px;width:96px;height:96px;border-radius:50%;background:#7bd389;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(0,0,0,.4);opacity:0">${K.ico("bug", "").replace('class="ic "', 'class="ic" style="stroke:#10331a;width:54px;height:54px"')}</div>`);
const sk = [GC.x + GC.w - 70 - (GC.x + MP.x + MP.w / 2), GC.y + 110 - (GC.y + MP.y + MP.h / 2 - 20)];
set(stk, { opacity: 1 }, 26.75);
tl.to(stk, { keyframes: [{ x: SG(sk[0] * 0.5), y: sk[1] * 0.5 - 90, duration: 0.25, ease: "sine.out" }, { x: SG(sk[0]), y: sk[1], duration: 0.25, ease: "back.out(1.4)" }] }, 26.8);
to(bc, { opacity: 0.85, duration: 0.3 }, 27.4);
// ================= b6: the bookend: the note card back in its place, right to left; three companions settle on arcs
out([game, bc], 29.0, 0.3);
to(stk, { scale: 0.4, opacity: 0, duration: 0.3, ease: "power2.in" }, 29.0);
to(note, { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.6, ease: "power2.inOut" }, 29.05);
fr(lp, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 }, 29.4);
K.glow("green", 29.0, L(760, 960), L(460, 400), 1.0);
const S6 = S("b6");
const CP = L((i) => ({ x: 1360, y: 330 + i * 140 }), (i) => ({ x: 560, y: 720 + i * 110 }));
const icons = [K.ico("bars", "", 40), `<svg viewBox="0 0 24 24" class="ic" style="width:40px;height:40px"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/></svg>`, K.ico("bug", "green", 40)];
[1, 2, 3].forEach((k, i) => {
  const c = CP(i), ch = K.chip({ x: c.x, y: c.y, s: 84, html: icons[i] }), lb = K.pill({ x: c.x + 64, y: c.y - L(34, 31), text: S6[k], style: P34 });
  const fromX = SG(L(320, 420)), fromY = L(-220 + i * 60, 240);
  tl.fromTo([ch, lb], { opacity: 0, x: fromX, y: fromY }, { keyframes: [{ opacity: 1, x: fromX * 0.45, y: fromY * 0.2 - 60, duration: 0.3, ease: "sine.out" }, { x: 0, y: 0, duration: 0.35, ease: "back.out(1.4)" }], immediateRender: false }, 29.6 + i * 0.12);
});
// ================= p3 polish (16:9; 9:16 keeps its own framing): slow sine drifts on the holds so no frame sits frozen.
// b1 pushes in slowly, b2 pulls out a touch as the card mirrors (script: "a slight pull-out"); each drift ends before the next move.
if (!V) {
  const drift = (t, s, d) => cam(t, { s, d, ease: "sine.inOut" });
  drift(0.2, 1.035, 4.8);                       // b1 hold on the broken line
  cam(5.6, { s: 0.98, d: 1.4 });                // b2: the slight pull-out through the flip (power2.inOut)
  drift(7.2, 1.0, 3.6);                         // b2 hold
  drift(12.0, 1.02, 4.7); cam(16.85, { s: 1, d: 0.4 }); // b3 hold (the count, the bars)
  drift(19.6, 1.025, 3.25); cam(22.9, { s: 1, d: 0.4 }); // b4 hold
  drift(26.9, 1.025, 2.05); cam(29.0, { s: 1, d: 0.45 }); // b5 hold after the sticker
  drift(30.5, 1.03, 3.95);                      // b6 bookend hold, ends as the drain starts (34.5)
}
// ================= b7: shared end card
K.titles({ b1: [0, 4.15] });
K.captions(); // p3: every caption window sits within the voice (fit-en/ar.json): no shift
K.endCard(K.beat("b7"), undefined, { links: true });
K.done();
})();
