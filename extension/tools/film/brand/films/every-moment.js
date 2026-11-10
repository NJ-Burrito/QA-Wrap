/* Film 1, every-moment: "Every Moment, Kept" (brand-films.md Film 1). Words from films.json via K.scr; extras via K.N. */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, V, iso, N, to, fr, set, out, pop, fadeIn, move, cam } = K;
const S = (id) => K.scr(id), w = K.world, f = K.fg;
K.light([1015, 420], [1400, 560]); // warm key behind the red column; green rises frame right
// 9:16: b1 frames the miniature and the column close (0.88), then the wide thread beats return to 0.62
K.cam(0, { vs: 0.88, vx: 185, vy: 60 }); K.cam(0, { vs: 0.88, vx: 185, vy: 60 }, f); K.cam(4.7, { d: 0.6 }); K.cam(4.7, { d: 0.6 }, f);
// ---------- layout (16:9 world px, EN)
// p1: rows enlarged to 24 px text (Director fix a): pitch 40, ~18 rows in the frame; the column still holds 40 rows (the count
// "40" is drawn beside it); the real 500 row (index 28) sits in the lower half of the visible window
const SHOP = { x: 150, y: 240, w: 480, h: 490 }, COL = { x: 680, w: 790, top: -650 + 40, clipY: 40, clipH: 720 }, PITCH = 40, REAL = 28, VIS0 = 16;
const THY = 820, THX0 = 170, THX1 = 1750, BARY = 400;
// ---------- b1: the shop miniature (Sauce Demo look; page text stays Latin in AR) and the flood of coral rows
const shop = K.card({ x: SHOP.x, y: SHOP.y, w: SHOP.w, h: SHOP.h, show: true, html: `
 <div class="abs" style="left:0;right:0;top:0;height:64px;border-bottom:1px solid #343a41;direction:ltr">
  ${[0, 1, 2].map((i) => `<i class="abs" style="left:${26 + i * 22}px;top:26px;width:12px;height:12px;border-radius:50%;background:#4a5057"></i>`).join("")}
  <div class="abs lbl" style="left:120px;top:16px;font:900 26px/32px 'Thmanyah Sans';color:#cfcdc8;letter-spacing:.02em">${N.shop.brand}</div></div>
 <div class="abs" style="left:30px;top:90px;width:410px;height:210px;border-radius:12px;background:#1f2327;display:flex;align-items:center;justify-content:center">${K.ico("bag", "dim", 110)}</div>
 <div class="abs lbl" style="left:30px;top:322px;direction:ltr;font-size:26px">${N.shop.item}</div>
 <div class="abs lbl dim" style="left:30px;top:362px;direction:ltr;font-size:24px">${N.shop.price}</div>
 <div class="abs" id="addBtn" style="left:30px;top:404px;width:420px;height:58px;border-radius:12px;border:2px solid #5a6068;font:700 24px/54px 'Thmanyah Sans';text-align:center;color:#e3e1dc;direction:ltr">${N.shop.add}</div>` });
// the page itself is never flipped: keep its insides LTR when the card sits on the right
shop.style.direction = "ltr";
// the flood is texture (forty rows nobody can read at once): the layout audit skips it; the rows that matter are drawn again as content
const col = add(`<div class="abs" data-layout-ignore style="left:${mx(COL.x, COL.w)}px;top:${COL.clipY}px;width:${COL.w}px;height:${COL.clipH}px;overflow:hidden;-webkit-mask-image:linear-gradient(transparent,#000 120px);mask-image:linear-gradient(transparent,#000 120px)"></div>`);
const rowY = (i) => COL.top - COL.clipY + i * PITCH;
const rows = [...Array(40)].map((_, i) => {
  const t = i === REAL ? "POST /api/checkout 500" : N.noise[Math.floor(K.rnd() * N.noise.length)];
  const [m, ...rest] = t.split(" "), last = rest.pop();
  return add(`<div class="abs" style="left:0;top:${rowY(i)}px;width:${COL.w}px;height:34px;border-radius:6px;background:rgba(255,125,99,.12);border-left:4px solid #ff7d63;font:700 24px/34px 'Thmanyah Sans';color:#ffb4a4;direction:ltr;white-space:nowrap;transform-origin:0 50%">
   <span style="position:absolute;left:16px;width:80px">${m}</span><span style="position:absolute;left:104px">${rest.join(" ")}</span><span style="position:absolute;right:18px">${last}</span></div>`, col);
});
const real = rows[REAL];
// the count beside the column (the script's "40"): Serif Text numeral, coral; it stays with the column until the fold
const count = add(`<div class="abs num" style="left:${mx(COL.x + COL.w + 26, 150)}px;top:58px;width:150px;font:500 112px/1 'Thmanyah Serif Text';color:#ff8f78;text-align:${AR ? "right" : "left"};direction:ltr">40</div>`);
// the cascade: a wave of arrivals top to bottom over the visible rows (back.out 1.6, stagger 0.07 s), from 0.1 s
rows.forEach((r, i) => fr(r, { scaleX: 0.9, backgroundColor: "rgba(255,125,99,.42)" }, { scaleX: 1, backgroundColor: "rgba(255,125,99,.12)", duration: 0.35, ease: "back.out(1.6)" }, 0.1 + Math.max(0, i - VIS0) * 0.07));
fr(count, { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, ease: "sine.inOut" }, 1.4); // follow-through as the wave ends
const cur = K.cursor();
cur.at(4.4, 1500, 980).to(4.5, 1150, 600, 0.7);
// ---------- b2: the popup rises beside the miniature; Asleep -> Awake; Start recording; the thread catches the session
to([col, count], { opacity: 0.22, filter: "blur(3px)", duration: 0.4 }, 4.7);
// p1: the popup is the beat's hero: 660 px wide (>= a third of the frame), button 600 px
const pop2 = K.card({ x: 690, y: 150, w: 660, h: 520, html: `
 <div class="abs" style="inset-inline-start:36px;top:28px;width:66px;height:55px">${K.MARK()}</div>
 <div class="abs" style="${K.start(118)}top:30px;font:700 42px/52px 'Thmanyah Serif Display';color:#f1efea;direction:ltr">QA Wrap</div>
 <div class="abs" style="left:0;right:0;top:112px;height:1px;background:#343a41"></div>` });
const asleep = K.pill({ x: 30, y: 146, text: N.asleep[K.LANG], cls: "", p: pop2, style: "opacity:1;color:#9aa0a6;font-size:28px;height:60px;line-height:58px" });
const awake = K.pill({ x: 30, y: 146, text: `<i style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#7bd389;margin-inline-end:14px"></i>${S("b2")[0]}`, cls: "lineG", p: pop2, style: "font-size:28px;height:60px;line-height:56px" });
const startB = K.btn({ x: 30, y: 330, w: 600, h: 120, text: S("b2")[1], p: pop2, style: "font-size:36px;opacity:1" });
fr(pop2, { opacity: 0, y: 80, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.4)" }, 4.9);
to(asleep, { opacity: 0.45, duration: 0.2, ease: "none" }, 5.6); // anticipation: a 0.2 s dim
to(asleep, { opacity: 0, scale: 0.9, duration: 0.12, ease: "power1.in" }, 5.8); pop(awake, 5.82, 0.3, 2, 0.7);
fr(startB, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 0 0 rgba(240,185,74,0)" }, { boxShadow: "0 8px 0 #c08a25,0 18px 30px rgba(0,0,0,.4),0 0 34px 6px rgba(240,185,74,.35)", duration: 0.3, ease: "sine.inOut" }, 6.0); // glow: anticipation
cur.to(5.9, 1020, 540, 0.4); K.press(startB, 6.4); cur.press(6.4, 1020, 540);
// the thread (time: linear), drawn under the miniature from the record press; AR draws right to left
const thread = add(`<div class="abs" style="left:${mx(THX0, THX1 - THX0)}px;top:${THY - 1.5}px;width:${THX1 - THX0}px;height:3px;background:#dddbd6;opacity:0;transform-origin:${AR ? "100%" : "0"} 50%"></div>`);
fr(thread, { opacity: 1, scaleX: 0 }, { scaleX: 1, duration: 2.4, ease: "none" }, 6.5);
// events on the thread: amber = the tester's clicks, white = requests. [x, kind, time]
const EV = [[420, "a", 6.82], [470, "w", 6.9], [520, "w", 7.0], [560, "a", 7.6], [600, "w", 7.7], [660, "a", 8.1], [700, "w", 8.15], [760, "w", 8.25], [830, "w", 8.35], [910, "w", 8.42], [990, "w", 8.5], [1070, "w", 8.55], [1150, "w", 8.62], [1240, "w", 8.68], [1330, "w", 8.74], [1420, "w", 8.8], [1510, "w", 8.85], [1600, "w", 8.9], [1690, "w", 8.95]];
const dots = EV.map(([x, k, t]) => { const d = add(`<div class="dot" style="left:${MX(x)}px;top:${THY}px;background:${k === "a" ? "#f0bb4f" : "#ebe9e4"};opacity:0"></div>`); fr(d, { opacity: 0, scale: 0.3, y: -14 }, { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(2)" }, t); return d; });
const finishDot = dots[5], realDot = dots[6];
cur.to(6.5, 390, 672, 0.3); cur.press(6.8, 390, 672); K.press(K.world.querySelector("#addBtn"), 6.8);
const addLbl = K.pill({ x: 420, y: 772, text: S("b2")[2], anchor: "c", style: "font-size:24px;height:48px;line-height:46px;padding:0 20px" });
pop(addLbl, 6.82, 0.3, 1.8, 0.5);
cur.to(7.3, 300, 520, 0.4); cur.press(7.6, 300, 520);
move(pop2, 8.7, { y: 60, opacity: 0 }, 0.45); to(addLbl, { opacity: 0, y: 10, duration: 0.3, ease: "power1.in" }, 8.6); cur.hide(8.8);
to([col, count], { opacity: 1, filter: "blur(0px)", duration: 0.5 }, 8.75);
// ---------- b3: silence 9.0-9.5 holds; the turn at 10.4 (kit); at 11.2 the 39 rows fold like a fan closing into one grey bar
const FOLD = 11.2, barTop = BARY - COL.clipY;
rows.forEach((r, i) => { if (i === REAL) return; const d = Math.abs(i - REAL);
  to(r, { y: barTop - rowY(i), scaleY: 0.1, opacity: 0, duration: 0.9, ease: "power2.inOut" }, FOLD + (12 - Math.min(d, 12)) * 0.012); });
to(real, { y: 480 - COL.clipY - rowY(REAL), duration: 0.9, ease: "power2.inOut" }, FOLD);
to(real, { boxShadow: "0 0 26px rgba(255,125,99,.45)", duration: 0.4 }, FOLD + 0.7);
const bar = add(`<div class="abs" style="left:${mx(COL.x, COL.w)}px;top:${BARY}px;width:${COL.w}px;height:60px;border-radius:12px;background:#30353b;border:1px solid #444a51;opacity:0;${AR ? "direction:rtl" : ""}">
  <div class="lbl" style="position:absolute;inset-inline-start:24px;top:14px;font-size:26px;color:#c9c7c2">${iso(S("b3")[0])}</div>
  <div class="lbl" id="showT" style="position:absolute;inset-inline-end:24px;top:14px;font-size:26px;color:#f0b94a">${S("b3")[1]}</div>
  <div class="lbl" id="hideT" style="position:absolute;inset-inline-end:24px;top:14px;font-size:26px;color:#f0b94a;opacity:0">${S("b6")[1]}</div></div>`);
// the count goes with the noise: it folds into the bar's own number
to(count, { opacity: 0, scale: 0.4, y: BARY - 80, duration: 0.8, ease: "power2.inOut" }, FOLD);
fr(bar, { opacity: 0, scaleY: 0.2 }, { opacity: 1, scaleY: 1, duration: 0.4, ease: "back.out(1.6)" }, FOLD + 0.55);
const pills = K.row({ x: COL.x, y: 560, items: S("b3").slice(2).map((t, i) => ({ text: t, cls: i === 1 ? "lineG" : "", style: i === 1 ? "" : "color:#9aa0a6" })) });
pills.forEach((p, i) => pop(p, FOLD + 0.5 + i * 0.08, 0.3, 2, 0.5));
cam(12.4, { s: 1.02, vs: 0.62 * 1.02, d: 2.1, ease: "sine.inOut" }); // p1: the folded frame breathes before the push-in
// ---------- b4: push-in on two points of the thread (world x1.4, the rest dims to 40 %); click and 500 grow, the arc draws
const P4 = 14.5;
cam(P4, { s: 1.4, y: -372, x: 0, d: 0.9, vs: 0.87, vy: -230 });
to(w, { opacity: 0.28, filter: "blur(5px)", duration: 0.6 }, P4 + 0.2);
out(pills, P4);
const CX = 640, FX = 1280, FY = 540;
const clk = K.chip({ x: CX, y: FY, s: 120, icon: "burst", icls: "amber", p: f });
const f500 = add(`<div class="abs" style="left:${MX(FX) - 80}px;top:${FY - 60}px;width:160px;height:120px;border-radius:18px;border:2.5px solid #f2876d;background:#2a2b30;box-shadow:0 12px 26px rgba(0,0,0,.35);font:500 70px/114px 'Thmanyah Serif Text';color:#f48a70;text-align:center;opacity:0;direction:ltr">500</div>`, f);
const S4 = S("b4");
const clkL = K.pill({ x: CX, y: FY + 108, text: S4[0], anchor: "c", p: f });
const f5L = K.pill({ x: FX, y: FY + 108, text: S4[1], anchor: "c", p: f, style: "direction:ltr" });
pop(clk, 15.0, 0.4, 2, 0.4); pop(f500, 15.4, 0.4, 2, 0.4); fadeIn(clkL, 15.3, 0.3, 10); fadeIn(f5L, 15.7, 0.3, 10);
const arc = add(`<svg class="abs" style="left:0;top:0;overflow:visible;opacity:0" width="1920" height="1080"><path pathLength="1" d="M${MX(CX)} ${FY - 66} Q${MX(960)} ${FY - 300} ${MX(FX)} ${FY - 66}" fill="none" stroke="#e8e6e1" stroke-width="3" stroke-linecap="round"/></svg>`, f);
set(arc, { opacity: 1 }, 16.4);
fr(arc.firstChild, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 16.4);
const conf = K.pill({ x: 960, y: FY - 236, text: S4[2], anchor: "c", cls: "green", p: f });
pop(conf, 17.1, 0.3, 2, 0.4);
// ---------- b5: the 500 box flips into the Replay card; the scrub head draws linearly to the red mark at 00:41
const RX = 410, RY = 220, RW = 1100, RH = 620, BX = 40, BW = 1020, BYb = 548;
const S5 = S("b5"), MARKF = 41 / 72;
const stg = (title, inner) => `<div class="abs" style="left:0;top:0;width:100%;height:100%;opacity:0"><div class="abs lbl" style="left:24px;top:20px;font-size:24px;color:#e8e6e1">${title}</div>${inner}</div>`;
const fieldsH = [0, 1, 2].map((i) => `<div class="abs" style="left:24px;top:${70 + i * 62}px;width:420px;height:46px;border-radius:8px;border:1.5px solid #4a5057"></div>`).join("");
const replay = K.card({ x: RX, y: RY, w: RW, h: RH, p: f, style: "border-color:#3f6d49;box-shadow:0 30px 60px rgba(0,0,0,.45),0 0 0 1px rgba(123,211,137,.18),0 0 40px rgba(123,211,137,.12)", html: `
 <div class="abs" style="inset-inline-start:40px;top:28px;font:900 32px/40px 'Thmanyah Sans';color:#f1efea">${S5[0]}</div>
 <div class="abs lbl dim" style="inset-inline-start:${AR ? 270 : 190}px;top:36px;font-size:24px">${S5[1]}</div>
 <div class="abs" id="mini" style="${K.start(40)}top:100px;width:600px;height:400px;border-radius:12px;background:#1f2327;border:1px solid #343a41;direction:ltr;overflow:hidden">
  ${stg(N.shop.cart, `<div class="abs" style="left:24px;top:72px;width:552px;height:70px;border-radius:8px;background:#2a2e33"></div><div class="abs lbl" style="left:44px;top:92px;font-size:24px">${N.shop.item}</div>`)}
  ${stg(N.shop.info, fieldsH)}
  ${stg(N.shop.checkout, `<div class="abs" style="left:24px;top:72px;width:552px;height:70px;border-radius:8px;background:#2a2e33"></div><div class="abs lbl" style="left:44px;top:92px;font-size:24px">${N.shop.item}</div>${[180, 214, 248].map((y, i) => `<div class="bar" style="left:24px;top:${y}px;width:${[260, 220, 300][i]}px;height:12px;background:#3a4047"></div>`).join("")}<div class="abs" id="finB" style="left:376px;top:300px;width:200px;height:60px;border-radius:10px;background:#d8d6d1;color:#1d2024;font:700 24px/60px 'Thmanyah Sans';text-align:center">${N.shop.finish}</div>`)}
 </div>
 <div class="abs" style="inset-inline-start:680px;top:120px;width:380px">
  <div id="tc" style="position:relative;height:64px;font:500 46px/64px 'Thmanyah Serif Text';color:#f1efea;direction:${AR ? "rtl" : "ltr"};text-align:start"></div>
  <div class="lbl" style="margin-top:28px;font:500 26px/36px 'Thmanyah Sans';white-space:normal;color:#c9c7c2">${iso(S5[3])}</div></div>
 <div class="abs" style="left:${BX}px;top:${BYb}px;width:${BW}px;height:10px;border-radius:5px;background:#3a4047"></div>
 <div class="abs" id="fill" style="left:${BX}px;top:${BYb}px;width:${BW}px;height:10px;border-radius:5px;background:#d8d6d1;transform-origin:${AR ? "100%" : "0"} 50%"></div>
 <div class="abs" id="rmark" style="left:${(AR ? BX + BW * (1 - MARKF) : BX + BW * MARKF) - 4}px;top:${BYb - 14}px;width:8px;height:38px;border-radius:4px;background:#ff7d63"></div>
 <div class="abs" id="rring" style="left:${(AR ? BX + BW * (1 - MARKF) : BX + BW * MARKF) - 30}px;top:${BYb - 25}px;width:60px;height:60px;border-radius:50%;border:3px solid #ff7d63;opacity:0"></div>
 <div class="abs" id="head" style="left:${BX - 14 + (AR ? BW : 0)}px;top:${BYb - 9}px;width:28px;height:28px;border-radius:50%;background:#f4f2ee;box-shadow:0 0 0 4px rgba(0,0,0,.35)"></div>` });
const q = (s) => replay.querySelector(s), stages = [...q("#mini").children];
// the timecode "{at} of {total}": one span per second value, toggled (seek-safe)
const R0 = 20.8, R1 = 23.5, tc = q("#tc"), tcv = [...Array(42)].map((_, s) => `00:${String(s).padStart(2, "0")}`);
tc.innerHTML = tcv.map((v) => `<span style="display:none">${iso(S5[2].replace("00:41", v))}</span>`).join("");
[...tc.children].forEach((c, s) => { set(c, { display: "inline" }, s ? R0 + (s * (R1 - R0)) / 41 : 0); if (s < 41) set(c, { display: "none" }, R0 + ((s + 1) * (R1 - R0)) / 41); });
to(f500, { rotationY: 90, opacity: 0, duration: 0.2, ease: "power2.in" }, 19.95);
out([clk, clkL, f5L, arc, conf], 19.9, 0.2);
to(w, { opacity: 0, duration: 0.5, ease: "sine.inOut" }, 20.2); // the Replay card is the close-up; the world returns on the pull-out (b6)
// p1 graphic match: the Replay card unfolds out of the 500 box's place (flip, power2.inOut 0.5 s)
fr(replay, { opacity: 0, rotationY: SG(-90), scale: 0.25, x: SG(FX - 960), y: FY - (RY + RH / 2) }, { opacity: 1, rotationY: 0, scale: 1, x: 0, y: 0, duration: 0.5, ease: "power2.out" }, 20.15);
cam(20.0, { s: 1, vs: 0.9, d: 0.01 }, f);
gsap.set(stages[0], { opacity: 1 }); // p1: each page slides in from the inline end as the head passes (0.25 s), no hard swap
[[0, 1, 21.5], [1, 2, 22.5]].forEach(([a, b, t]) => { to(stages[a], { opacity: 0, x: -40, duration: 0.25, ease: "power2.inOut" }, t); fr(stages[b], { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.25, ease: "power2.inOut" }, t + 0.05); });
fr(q("#fill"), { scaleX: 0 }, { scaleX: MARKF, duration: R1 - R0, ease: "none" }, R0);
fr(q("#head"), { x: 0 }, { x: SG(BW * MARKF), duration: R1 - R0, ease: "none" }, R0);
fr(q("#rring"), { opacity: 1, scale: 0.5 }, { opacity: 0, scale: 1.6, duration: 0.5, ease: "power1.out" }, R1);
fr(q("#finB"), { boxShadow: "0 0 0 0px rgba(240,185,74,0)" }, { boxShadow: "0 0 0 6px rgba(240,185,74,.9)", duration: 0.15 }, R1);
fr(q("#rring"), { opacity: 1, scale: 0.5 }, { opacity: 0, scale: 1.8, duration: 0.5, ease: "power1.out", immediateRender: false }, 25.6);
cam(23.7, { s: 1.03, vs: 0.9 * 1.03, d: 2.6, ease: "sine.inOut" }, f); // p1: the replay hold breathes
// ---------- b6: pull-out back to the thread; Show unfolds the 39 rows (dim, untouched) and they fold again; Save takes every row
to(replay, { scale: 0.2, opacity: 0, duration: 0.4, ease: "power2.in" }, 26.3);
cam(26.4, { s: 1, d: 0.6 }); cam(26.3, { s: 1, vs: 0.9, d: 0.4 }, f); to(w, { opacity: 1, filter: "blur(0px)", duration: 0.5 }, 26.4);
const U0 = 27.0, U1 = 28.0, showT = bar.querySelector("#showT"), hideT = bar.querySelector("#hideT");
fr(showT, { scale: 1 }, { scale: 0.9, duration: 0.08, yoyo: true, repeat: 1 }, U0 - 0.1);
set(showT, { opacity: 0 }, U0 + 0.1); set(hideT, { opacity: 1 }, U0 + 0.1); set(hideT, { opacity: 0 }, U1 + 0.4); set(showT, { opacity: 1 }, U1 + 0.4);
rows.forEach((r, i) => { if (i === REAL) return;
  fr(r, { y: barTop - rowY(i), scaleY: 0.1, opacity: 0 }, { y: 0, scaleY: 1, opacity: 0.35, duration: 0.6, ease: "power2.inOut" }, U0 + 0.05);
  to(r, { y: barTop - rowY(i), scaleY: 0.1, opacity: 0, duration: 0.5, ease: "power2.inOut" }, U1); });
const SH = { x: 1520, y: 250, w: 330, h: 480 }; // p1: clear of the wider column
const sheet = K.card({ ...SH, html: `<div class="abs" style="inset-inline-start:30px;top:26px;font:900 28px/36px 'Thmanyah Sans';letter-spacing:.06em;color:#f1efea">${S("b6")[2]}</div>
 <div class="abs" style="left:0;right:0;top:86px;height:1px;background:#343a41"></div>
 <div class="abs" id="sfill" style="left:30px;right:30px;top:110px;height:340px;background:repeating-linear-gradient(#5b6168 0 6px,transparent 6px 8.5px);border-radius:3px;transform-origin:50% 0"></div>` });
fr(sheet, { opacity: 0, y: 140 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 28.5);
const SX = MX(SH.x + SH.w / 2), barX = MX(COL.x + COL.w / 2);
const stream = [...Array(40)].map((_, i) => {
  const d = add(`<div class="abs" style="left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:${i === REAL ? "#ff7d63" : "#d8d6d1"};opacity:0"></div>`);
  const t = 28.95 + i * 0.03, ty = 380 + (i % 20) * 16;
  fr(d, { opacity: 0, x: barX, y: BARY + 28 }, { opacity: 1, duration: 0.05, ease: "none" }, t);
  tl2(d, t, ty); return d; });
function tl2(d, t, ty) { K.tl.to(d, { keyframes: [{ x: (barX + SX) / 2, y: BARY - 120, duration: 0.35, ease: "sine.inOut" }, { x: SX, y: ty, duration: 0.35, ease: "sine.inOut" }] }, t); to(d, { opacity: 0, duration: 0.08 }, t + 0.66); }
fr(sheet.querySelector("#sfill"), { scaleY: 0 }, { scaleY: 1, duration: 1.4, ease: "none" }, 29.3);
// ---------- b7: the bookend: the b1 frame again, calm; the one row ringed green with its arc to the click; the overview lands
to(sheet, { scale: 0.3, opacity: 0, duration: 0.4, ease: "power2.in" }, 31.3);
K.glow("green", 31.5, COL.x + COL.w / 2, 480, 1.2);
cam(31.5, { s: 1.06, vs: 0.62 * 1.06, x: -30, y: 12, d: 5.0, ease: "sine.inOut" }); // p1: the payoff breathes: a slow push toward the traced row (the hold never stops)
to(real, { backgroundColor: "rgba(123,211,137,.10)", borderLeftColor: "#7bd389", color: "#ecebe7", boxShadow: "0 0 0 2px #7bd389, 0 0 28px rgba(123,211,137,.35)", duration: 0.3 }, 33.7);
const S7 = S("b7");
const arc7 = add(`<svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080"><path pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="M${MX(COL.x - 6)} 497 Q${MX(560)} 525 ${MX(660)} ${THY - 16}" fill="none" stroke="#7bd389" stroke-width="3" stroke-linecap="round"/></svg>`);
fr(arc7.firstChild, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 32.6);
const finL = K.pill({ x: 660, y: 762, text: S4[0], anchor: "c", style: "font-size:24px;height:48px;line-height:46px;padding:0 20px" });
pop(finL, 32.9, 0.3, 1.8, 0.5);
const ov1 = K.pill({ x: COL.x, y: 600, text: S7[0] }), ov2 = K.pill({ x: COL.x, y: 670, text: S7[1], cls: "lineG" });
pop(ov1, 33.45, 0.35, 1.6, 0.5); pop(ov2, 33.6, 0.35, 1.6, 0.5);
// ---------- b8: everything drains to the centre and becomes the mark; the lockup (shared end card)
K.titles({ b1: [0, 4.4] });
K.captions();
K.endCard(K.beat("b8"), undefined, { links: true }); // p1: the commercial's URL + GitHub lines (Director fix b)
void finishDot; void realDot; void stream;
K.done();
})();
