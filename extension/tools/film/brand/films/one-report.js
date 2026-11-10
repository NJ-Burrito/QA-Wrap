/* Film 2, one-report: "One Report, Every Desk" (brand-films.md Film 2). Words from films.json via K.scr; extras via K.N. */
(() => {
const K = QAK(), { add, MX, mx, SG, AR, iso, N, to, fr, set, out, pop, fadeIn, move, cam, type } = K;
const S = (id) => K.scr(id), L = K.LANG, f = K.fg;
// a drawn arrow (Thmanyah has no arrow glyph, so a text arrow would fall back to another face); points along reading order
const ARROW = `<svg viewBox="0 0 24 24" class="ic dim" style="width:26px;height:26px;vertical-align:-6px;${AR ? "transform:scaleX(-1)" : ""}"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`;
K.light([560, 520], [1380, 560]);
// 9:16: card beats close (0.95), wide beats at the commercial's ~0.62-0.75
const VC = [[0, 0.95], [9.5, 0.7], [15, 0.75], [20.5, 0.62], [27, 0.95], [32, 0.95]];
K.cam(0, { s: 1, vs: VC[0][1], d: 0.01 }); K.cam(0, { s: 1, vs: VC[0][1], d: 0.01 }, f);
VC.slice(1).forEach(([t, v]) => { K.cam(t, { s: 1, vs: v, d: 0.5 }); K.cam(t, { s: 1, vs: v, d: 0.5 }, f); });
// p1: the blank page breathes: a slow push on the empty card (sine), then a pull-out that makes room for Copy report
K.cam(0.2, { s: 1.035, vs: 0.95 * 1.035, d: 4.1, ease: "sine.inOut" }); K.cam(4.45, { s: 1, vs: 0.95, d: 0.7 });
// ---------- b1: the blank ticket: three empty fields, the caret blinks in Steps to reproduce, a faint clock ticks
const T = { x: 560, y: 250, w: 800, h: 560 }, S1 = S("b1");
const lab = (t, y, extra = "") => `<div class="lbl dim" style="position:absolute;inset-inline-start:40px;top:${y}px;font-size:24px;${extra}">${iso(t)}</div>`;
const box = (y, h, id) => `<div class="field" id="${id}" style="inset-inline-start:40px;top:${y}px;width:720px;height:${h}px"></div>`;
const ticket = K.card({ ...T, show: true, html: `
 <div class="bar" style="inset-inline-start:40px;top:30px;width:260px;height:16px;background:#4b4f55"></div>
 <div class="abs" id="clock" style="inset-inline-end:34px;top:20px;width:40px;height:40px;opacity:.45">${K.ico("timer", "dim", 40)}</div>
 <div class="abs" style="left:0;right:0;top:72px;height:1px;background:#343a41"></div>
 ${lab(S1[0], 98)}${box(132, 58, "fSum")}${lab(S1[1], 210)}${box(244, 176, "fSteps")}${lab(S1[2], 436)}${box(470, 58, "fWhat")}
 <div class="abs" id="caret" style="inset-inline-start:62px;top:262px;width:3px;height:40px;background:#f1efea"></div>` });
const q = (s) => ticket.querySelector(s);
// the caret blinks 0.5 s on / 0.5 s off (time: linear steps) until the turn
for (let k = 1; k <= 12; k++) set(q("#caret"), { opacity: k % 2 || k === 12 ? 0 : 1 }, k * 0.5); // on at frame 0 (CSS), off/on every 0.5 s, gone at 6.0
// the clock's hand: a faint tick each second (stepped rotation of the dial)
fr(q("#clock svg"), { rotation: 0 }, { rotation: 300, duration: 5, ease: "steps(5)", immediateRender: true, transformOrigin: "50% 54%" }, 0);
// ---------- b2: Copy report pops beside the card, is pressed at 5.6; at 6.0 the card writes itself top-down
const S2 = S("b2");
const copyB = K.btn({ x: 1420, y: 560, h: 100, text: `${K.ico("copy", "", 34).replace('class="ic ', 'style="stroke:#2a2008;width:34px;height:34px;margin-inline-end:14px" class="ic ')}${S2[0]}`, style: "font-size:28px" });
pop(copyB, 4.7, 0.4, 2, 0.4);
const toast = K.pill({ x: 1420, y: 700, text: `${K.ico("tick", "green", 26)} ${S2[1]}`, cls: "lineG", style: "display:flex;align-items:center;gap:10px" });
const cur = K.cursor();
cur.at(4.6, 1780, 980).to(4.7, 1560, 620, 0.7); K.press(copyB, 5.6); cur.press(5.6, 1560, 620); cur.hide(6.4);
pop(toast, 5.8, 0.3, 2, 0.6);
const line = (parent, id, text, y, extra = "") => add(`<div class="lbl" id="${id}" style="position:absolute;inset-inline-start:20px;top:${y}px;opacity:0;font-size:24px;${extra}">${text}</div>`, parent);
const sum = line(q("#fSum"), "tSum", `<bdi dir="ltr">${S2[2]}</bdi>`, 12, "font-size:26px;color:#f1efea");
const steps = N.steps[L].map((t, i) => line(q("#fSteps"), "st" + i, `<span style="color:#f0b94a">${i + 1}</span>&nbsp; ${iso(t)}`, 12 + i * 39, "font-size:24px"));
const what = line(q("#fWhat"), "tWhat", `<bdi dir="ltr">${N.happened}</bdi>`, 12, "font-size:26px;color:#ff9a85");
const thumb = add(`<div class="abs" style="inset-inline-end:10px;top:6px;width:64px;height:44px;border-radius:6px;background:#3a4047;opacity:0;display:flex;align-items:center;justify-content:center">${K.ico("cam", "dim", 26)}</div>`, q("#fWhat"));
// p1: Latin page text types left to right in both cuts (its own order); the Arabic step lines type from the inline start
const typeL = (el, at, d) => fr(el, { opacity: 1, clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "none" }, at);
typeL(sum, 6.0, 0.7);
steps.forEach((s, i) => type(s, 6.8 + i * 0.45, 0.4));
typeL(what, 8.6, 0.4); pop(thumb, 9.05, 0.3, 2, 0.5);
out([copyB, toast], 9.2, 0.3);
// ---------- b3: the report opens with its tabs; What broke lifts forward: You did, Then, What happened
const R = { x: 260, y: 250, w: 1400, h: 600 }, S3 = S("b3");
to(ticket, { scale: 0.92, opacity: 0, duration: 0.4, ease: "power2.in" }, 9.5);
const rep = K.card({ ...R, html: `
 <div class="abs" style="${K.start(48)}top:28px;font:700 30px/38px 'Thmanyah Sans';color:#f1efea;direction:ltr">${S2[2]}</div>
 <div class="abs" style="left:0;right:0;top:146px;height:1px;background:#343a41"></div>` });
fr(rep, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.6, ease: "power2.inOut" }, 9.6);
const tabs = K.row({ x: 48, y: 84, p: rep, gap: 10, items: N.tabs[L].map((t, i) => ({ text: t, show: true, cls: i === 0 ? "" : "", style: i === 0 ? "background:#2f343a;color:#f1efea;border-color:#7bd389;box-shadow:inset 0 -3px 0 #7bd389" : "background:transparent;border-color:transparent;color:#8a9096" })) });
void tabs;
const panel = add(`<div class="abs" style="inset-inline-start:48px;top:176px;width:1304px;height:390px;border-radius:16px;background:linear-gradient(#2f343a,#2a2e33);border:1px solid #3f454c;box-shadow:0 24px 50px rgba(0,0,0,.4);opacity:0"></div>`, rep);
add(`<div class="abs" style="inset-inline-start:40px;top:30px;font:900 30px/38px 'Thmanyah Sans';color:#f1efea">${S3[0]}</div>`, panel);
const cell = (x, tone, head, body) => add(`<div class="abs" style="inset-inline-start:${x}px;top:110px;width:500px;height:230px;border-radius:14px;border:2px solid ${tone};background:#24282c;opacity:0">
  <div class="lbl" style="position:absolute;inset-inline-start:28px;top:26px;color:${tone};font:900 24px/30px 'Thmanyah Sans';letter-spacing:.08em;text-transform:uppercase">${head}</div>
  <div class="lbl" style="position:absolute;inset-inline-start:28px;top:96px;font-size:28px;white-space:normal;width:440px">${body}</div></div>`, panel);
const youDid = cell(40, "#f0b94a", S3[1], iso(N.steps[L][3]));
const happened = cell(764, "#ff7d63", S3[3], `<bdi dir="ltr">${N.happened}</bdi>`);
const thenP = K.pill({ x: 652, y: 225, text: `${S3[2]} ${ARROW}`, anchor: "c", p: panel, show: false, style: "font-size:24px" });
fr(panel, { opacity: 0, y: 30, scale: 0.96 }, { opacity: 1, y: -6, scale: 1.02, duration: 0.5, ease: "back.out(1.4)" }, 10.3);
fr(youDid, { opacity: 0, x: SG(-80) }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.inOut" }, 11.0);
pop(thenP, 11.5, 0.3, 2, 0.4);
fr(happened, { opacity: 0, x: SG(-80) }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.inOut" }, 11.8);
// ---------- b4: the report splits into two documents (low angle): Test case and Defect report; ISTQB, 29119-3; Severity apart from Priority
const S4 = S("b4");
to(rep, { scale: 0.9, opacity: 0, duration: 0.35, ease: "power2.in" }, 15.0);
const docHTML = (title, rowsW) => `<div class="abs" style="left:0;right:0;top:0;height:76px;border-radius:18px 18px 0 0;background:#30353b;border-bottom:1px solid #444a51"></div>
 <div class="abs" style="inset-inline-start:36px;top:20px;font:900 30px/36px 'Thmanyah Sans';color:#f1efea">${title}</div>
 ${rowsW.map((w, i) => `<div class="bar" style="inset-inline-start:36px;top:${120 + i * 52}px;width:${w}px;height:16px;background:#4b4f55"></div>`).join("")}`;
const d1 = K.card({ x: 330, y: 230, w: 600, h: 500, html: docHTML(S4[0], [420, 500, 360, 470, 300, 440]) });
const d2 = K.card({ x: 990, y: 230, w: 600, h: 500, html: docHTML(S4[1], [460, 380, 500, 0, 340, 0]) });
const sev = K.pill({ x: 36, y: 260, text: S4[4], p: d2, cls: "caps", style: "font-size:24px" });
const pri = K.pill({ x: 36, y: 412, text: S4[5], p: d2, cls: "caps", style: "font-size:24px" });
[d1, d2].forEach((d, i) => { gsap.set(d, { transformPerspective: 1400, transformOrigin: "50% 100%" });
  fr(d, { opacity: 0, x: SG(i ? -330 : 330), rotationX: 0, scale: 0.9 }, { opacity: 1, x: 0, rotationX: 9, scale: 1.04, duration: 0.6, ease: "power2.inOut" }, 15.1); });
const istqb = K.pill({ x: 960, y: 790, text: S4[2], anchor: "c", style: "font-size:24px" });
const iso3 = K.pill({ x: 1290, y: 790, text: S4[3], anchor: "c", cls: "green", style: "direction:ltr" });
fr(istqb, { opacity: 0, x: SG(-120) }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.inOut" }, 16.2);
pop(iso3, 16.9, 0.35, 2, 0.3);
pop(sev, 17.3, 0.3, 2, 0.4); pop(pri, 17.5, 0.3, 2, 0.4);
// ---------- b5: the documents merge into one card; the destinations arrive in a ring (on arcs); File to Jira; copies fly
to([d1, d2], { x: (i) => SG(i ? -330 : 330), scale: 0.5, opacity: 0, rotationX: 0, duration: 0.45, ease: "power2.in" }, 20.3);
out([istqb, iso3], 20.2, 0.2);
const C = K.card({ x: 960, y: 470, w: 360, h: 230, anchor: "c", html: docHTML("", [200, 260, 170]).replace(/top:20px;font:900 30px/, "top:20px;font:900 1px/") });
pop(C, 20.55, 0.4, 1.4, 0.6);
const S5 = S("b5"), EN5 = K.scr("b5", "en");
const trackers = EN5.slice(2, 10), chats = EN5.slice(10, 14);
const RC = [960, 470], RXr = 640, RYr = 300;
const ring = trackers.map((name, i) => { const a = Math.PI * (1 + i / 7), x = RC[0] + RXr * Math.cos(a), y = RC[1] + RYr * Math.sin(a), big = i === 0;
  const el = K.pill({ x, y, text: name, anchor: "c", style: `direction:ltr;${big ? "font-size:34px;height:74px;line-height:72px;padding:0 34px;border-color:#5a6068" : ""}` });
  // travel on an arc from the card: start near the centre, overshoot on arrival (back.out 1.8)
  fr(el, { opacity: 0, scale: 0.4, x: SG(RC[0] - x) * 0.6, y: (RC[1] - y) * 0.6 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.5, ease: "back.out(1.8)" }, 20.7 + i * 0.06);
  return { el, x, y }; });
const chatLbl = K.label({ x: 960, y: 735, text: S5[1], anchor: "c", cls: "dim", style: "font-size:24px" });
// the chat row: fixed widths so the flights know where each pill sits (Slack first, the webhook chip last)
const CW = [140, 150, 172, 232, 320], CG = 12, CT = CW.reduce((a, b) => a + b) + CG * (CW.length - 1);
const chatX = CW.map((w, i) => 960 - CT / 2 + CW.slice(0, i).reduce((a, b) => a + b + CG, 0) + w / 2);
const chatRow = [...chats, `${K.ico("hook", "dim", 24)}&nbsp; ${AR ? S5[2] : EN5[14]}`].map((t, i) => K.pill({ x: chatX[i], y: 800, anchor: "c", text: t,
  style: `width:${CW[i]}px;padding:0;text-align:center;font-size:24px;height:50px;line-height:48px;${i < 4 ? "direction:ltr" : "display:flex;align-items:center;justify-content:center"}` }));
fadeIn(chatLbl, 21.15, 0.3);
chatRow.forEach((p, i) => pop(p, 21.2 + i * 0.06, 0.35, 1.8, 0.4));
const fileB = K.btn({ x: 960, y: 640, h: 72, anchor: "c", text: S5[0], style: "font-size:24px;padding:0 30px" });
pop(fileB, 20.9, 0.35, 2, 0.4);
const cur2 = K.cursor();
cur2.at(20.9, 1300, 900).to(21.0, 980, 650, 0.5); K.press(fileB, 21.6); cur2.press(21.6, 980, 650); cur2.hide(22.2);
// copies of the card fly on arcs: to Jira (21.7 -> 22.3), GitHub (22.9 -> 23.4), Slack (23.6 -> 24.1)
const fly = (tx, ty, t0, d) => { const c = add(`<div class="abs" style="left:${MX(960) - 60}px;top:${470 - 38}px;width:120px;height:76px;border-radius:10px;background:linear-gradient(#2c3137,#24282c);border:1px solid #4a5057;opacity:0"></div>`);
  const mxp = (MX(960) + MX(tx)) / 2, myp = Math.min(470, ty) - 180;
  fr(c, { opacity: 1, x: 0, y: 0, scale: 0.9 }, { opacity: 1, duration: 0.01, ease: "none" }, t0);
  K.tl.to(c, { keyframes: [{ x: mxp - MX(960), y: myp - 470, scale: 0.8, duration: d / 2, ease: "sine.out" }, { x: MX(tx) - MX(960), y: ty - 470, scale: 0.35, duration: d / 2, ease: "sine.in" }] }, t0);
  to(c, { opacity: 0, duration: 0.08 }, t0 + d);
  const ck = K.check({ x: tx + 40, y: ty - 34, s: 44 }); pop(ck, t0 + d, 0.3, 3, 0.1); return ck; };
const chkJ = fly(ring[0].x, ring[0].y, 21.7, 0.6), chkG = fly(ring[1].x, ring[1].y, 22.9, 0.5);
// the chat row is laid out by the browser: Slack is its first pill; its centre is computed from the row's fixed widths
const chkS = fly(chatX[0], 800, 23.6, 0.5);
fr(ring[0].el, { boxShadow: "0 0 0 0 rgba(123,211,137,0)" }, { boxShadow: "0 0 0 3px #7bd389, 0 0 30px rgba(123,211,137,.35)", duration: 0.25 }, 22.3);
// ---------- b6: the Jira chip opens into the confirmation sheet: what leaves, what never does; Severity to Jira priority
// p1: holds breathe (sine drifts on the camera; the next beat's camera move takes over from them)
K.cam(12.3, { s: 1.03, vs: 0.7 * 1.03, d: 2.6, ease: "sine.inOut" }); K.cam(17.6, { s: 1.035, vs: 0.75 * 1.035, d: 2.8, ease: "sine.inOut" }); K.cam(24.2, { s: 1.03, vs: 0.62 * 1.03, d: 2.7, ease: "sine.inOut" });
const S6 = S("b6");
// p1: everything but Jira leaves first; the sheet then opens out of the Jira chip (graphic match) as the chip goes
const b5all = [C, fileB, chatLbl, ...chatRow, ...ring.slice(1).map((r) => r.el), chkG, chkS];
to(b5all, { opacity: 0, scale: 0.8, duration: 0.3, ease: "power2.in" }, 26.8);
to([ring[0].el, chkJ], { opacity: 0, scale: 1.3, duration: 0.25, ease: "power2.in" }, 27.05);

const SHx = { x: 460, y: 236, w: 1000, h: 620 };
const sheet = K.card({ ...SHx, html: `
 <div class="abs" style="inset-inline-start:48px;top:34px;font:900 32px/40px 'Thmanyah Sans';color:#f1efea">${S6[0]}</div>
 <div class="abs" style="left:0;right:0;top:100px;height:1px;background:#343a41"></div>
 <div class="lbl dim" style="position:absolute;inset-inline-start:48px;top:124px;font:900 24px/30px 'Thmanyah Sans';letter-spacing:.08em;text-transform:uppercase">${N.sent[L]}</div>
 <div class="lbl dim" style="position:absolute;inset-inline-start:48px;top:362px;font:900 24px/30px 'Thmanyah Sans';letter-spacing:.08em;text-transform:uppercase">${N.never[L]}</div>` });
fr(sheet, { opacity: 0, scale: 0.15, x: SG(ring[0].x - 960), y: ring[0].y - 546 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.6, ease: "power2.inOut" }, 26.95);
const srow = (t, y, ok) => { const r = add(`<div class="abs" style="inset-inline-start:48px;top:${y}px;display:flex;align-items:center;gap:20px;opacity:0"><div style="width:42px;height:42px">${ok ? K.CHECK : K.CROSS}</div><div class="lbl" style="font-size:28px;${ok ? "" : "color:#ffb3a3"}">${iso(t)}</div></div>`, sheet); return r; };
const sentR = N.sentRows[L].map((t, i) => srow(t, 164 + i * 60, true));
const neverR = srow(S6[1], 400, false);
sentR.forEach((r, i) => fr(r, { opacity: 0, x: SG(-20) }, { opacity: 1, x: 0, duration: 0.25, ease: "none" }, 27.7 + i * 0.25));
fr(neverR, { opacity: 0, x: SG(-20) }, { opacity: 1, x: 0, duration: 0.3 }, 28.6);
const strip = add(`<div class="abs" style="inset-inline-start:48px;top:494px;width:904px;height:96px;border-radius:14px;background:#24282c;border:1px solid #3a4047;opacity:0;display:flex;align-items:center;gap:22px;padding:0 28px">
  <div class="lbl dim" style="font-size:24px">${iso(S6[2])}</div><div style="flex:1"></div>
  <span class="pill" style="position:relative;font-size:24px;height:48px;line-height:46px">${N.sevMajor[L]}</span>${ARROW}
  <span class="pill" style="position:relative;font-size:24px;height:48px;line-height:46px;direction:ltr">${N.jiraHigh}</span></div>`, sheet);
fadeIn(strip, 29.4, 0.35, 16);
K.cam(29.6, { s: 1.03, vs: 0.95 * 1.03, d: 2.3, ease: "sine.inOut" }); // p1: the sheet hold breathes
// ---------- b7: the b1 card returns in the same place, every field filled; FILED slams (power4.in 0.3 s) at 33.8
const S7 = S("b7");
to(sheet, { opacity: 0, scale: 0.85, duration: 0.35, ease: "power2.in" }, 31.9);
fr(ticket, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.45 }, 32.2);
const filed = K.stamp({ x: 960, y: 520, text: S7[0], cls: "green", size: 84, style: "z-index:5" });
fr(filed, { opacity: 0, scale: 1.4, rotation: -9 }, { opacity: 1, scale: 1, rotation: -9, duration: 0.3, ease: "power4.in" }, 33.5);
to(ticket, { filter: "brightness(0.82)", duration: 0.2, ease: "none" }, 33.45); to(ticket, { filter: "brightness(1)", duration: 0.2 }, 33.82); // p1: anticipation dim before the slam
K.tl.to(ticket, { y: -5, duration: 0.06, yoyo: true, repeat: 1 }, 33.8);
const filedAs = K.pill({ x: 1110, y: 287, text: S7[1], anchor: "c" /* p1: in the ticket header, clear of the steps */, cls: "lineG", style: "z-index:6;background:#24282c" });
fr(filedAs, { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" }, 34.0);
K.glow("green", 32.4, 960, 540, 1.0);
K.cam(32.2, { s: 1.04, vs: 0.95 * 1.04, d: 4.6, ease: "sine.inOut" }); // p1: the bookend breathes: a slow push on the filed ticket until the drain
fr(K.bg.querySelector("#glowG"), { scale: 1 }, { scale: 1.18, duration: 0.1, yoyo: true, repeat: 1, ease: "none" }, 33.8); // a 0.2 s green bloom on the slam
// ---------- b8: shared end card
K.titles({ b1: [0, 4.15] });
K.captions();
K.endCard(K.beat("b8"), undefined, { links: true }); // p1: the commercial's URL + GitHub lines (Director fix b)
void mx; void move;
K.done();
})();
