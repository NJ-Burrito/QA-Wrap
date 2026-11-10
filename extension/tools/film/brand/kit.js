/* QA Wrap brand films: the shared kit (worker b1, 2026-11-10). Lifted value for value from the 40 s commercial
   (commercial40/composition.template.html). One paused GSAP timeline, seek-safe, seeded randomness only.
   build.mjs injects window.FILM (the film's entry in films.json), window.NOTES (build-notes.json) before this file.
   A film script calls  const K = QAK();  draws its beats with K's builders, then  K.done().
   Coordinates in films are 16:9 world pixels, written for the English cut; AR mirrors through the helpers. */
window.QAK = function () {
  const F = window.FILM, N = window.NOTES || {}, body = document.body, stage = document.getElementById("stage");
  const LANG = body.dataset.lang, AR = LANG === "ar", V = body.classList.contains("v");
  const ID = stage.dataset.compositionId, W = V ? 1080 : 1920, H = V ? 1920 : 1080;
  // ---------- helpers
  let seed = 20261110 + (F.n || 0);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const mx = (x, w) => (AR ? 1920 - x - w : x), MX = (x) => (AR ? 1920 - x : x), SG = (n) => (AR ? -n : n);
  // Latin runs (and the numbers that travel with them) inside Arabic are isolated (bible §8, rule 9)
  const iso = (s) => (AR && s ? String(s).split(/(<[^>]*>|&[#a-z0-9]+;)/i).map((part, i) => (i % 2 ? part : part.replace(/[A-Za-z0-9][A-Za-z0-9 .:\/\-+_'"#&]*[A-Za-z0-9]/g, (m) => `<bdi dir="ltr">${m}</bdi>`))).join("") : s);
  // inline-start offset for an element that must keep direction:ltr inside a mirrored card (inset-inline-* follows the element's own direction)
  const start = (n) => `${AR ? "right" : "left"}:${n}px;`;
  const T = (o) => (o && typeof o === "object" && "en" in o ? o[LANG] : o); // pick the language of a {en, ar} pair
  const $ = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; };
  const bg = stage.appendChild($('<div id="bg"></div>'));
  const world = stage.appendChild($('<div id="world"></div>'));
  const fg = stage.appendChild($('<div id="fg"></div>'));
  const ec = stage.appendChild($('<div id="ec"></div>')); // end card layer: never scaled by a camera
  const ui = stage.appendChild($('<div id="ui"></div>'));
  const add = (h, p = world) => p.appendChild($(h));
  const beat = (id) => F.beats.find((b) => b.id === id);
  // on-screen words of a beat, from films.json (split on " · "; the doc's own notes in brackets dropped)
  const scr = (id, lang = LANG) => beat(id).screen[lang].replace(/^\([^)]*\)\s*/, "").replace(/\s*\([^)]*stay Latin\)/, "").split(" · ");
  // ---------- line icons (commercial set + the few the films add)
  const SVG = {
    burst: '<path d="M12 9a3 3 0 110 6 3 3 0 010-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    bars: '<path d="M4.5 20v-10M11.5 20V4.5M18.5 20.5v-11.5"/>',
    alert: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 8v5M12 16v.5"/>',
    bug: '<path d="M9 7a3 3 0 016 0v1H9zM7 9h10v5a5 5 0 01-10 0zM3 8l3 2M21 8l-3 2M2 14h4M18 14h4M4 20l3-3M20 20l-3-3M12 9v10"/>',
    timer: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2 2M9 2h6"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
    cols: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    cam: '<rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="12" cy="13" r="3"/>',
    dl: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    bag: '<path d="M6 8h12l-1 12H7zM9 8V6a3 3 0 016 0v2"/>',
    doc: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    hook: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><circle cx="12" cy="7" r="3"/><path d="M10 17h4M10.5 9.5L8 14.5M13.5 9.5l2.5 5"/>',
    cross: '<path d="M7 7l10 10M17 7L7 17"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    clip: '<path d="M21 12l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8"/>',
  };
  const ico = (k, cls = "", px) => `<svg viewBox="0 0 24 24" class="ic ${cls}"${px ? ` style="width:${px}px;height:${px}px"` : ""}>${SVG[k]}</svg>`;
  const CHECK = '<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="12" fill="#7bd389"/><path d="M7 12.5l3.5 3.5L17 9" fill="none" stroke="#10331a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="12" fill="#ff7d63"/><path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#2a1410" stroke-width="3" stroke-linecap="round"/></svg>';
  // the QA mark (commercial MARK2: ring open at the lower right, coral check leaving it). Never mirrored.
  const MARK = (rid, kid) => `<svg viewBox="0 0 180 150" width="100%" height="100%" style="overflow:visible"><path ${rid ? `id="${rid}"` : ""} pathLength="1" d="M125.3 90.9A52.5 52.5 0 1 0 81.4 128.1" fill="none" stroke="#ecebe7" stroke-width="23" stroke-linecap="round"/><path ${kid ? `id="${kid}"` : ""} pathLength="1" d="M92 93L115 122L160 42" fill="none" stroke="#ff7d63" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // ---------- timeline
  const tl = gsap.timeline({ paused: true });
  const set = (t, v, at) => tl.set(t, v, at);
  const to = (t, v, at) => tl.to(t, Object.assign({ ease: "power2.out" }, v), at);
  const fr = (t, a, b, at) => tl.fromTo(t, a, Object.assign({ ease: "power2.out", immediateRender: false }, b), at);
  F.beats.forEach((b) => tl.addLabel(b.id, b.inSec));
  // ---------- ambient world: vignette, glows, ghost blocks, grain (commercial v1 values)
  bg.appendChild($('<div id="vig"></div>'));
  const glowR = add('<div id="glowR"></div>', bg), glowG = add('<div id="glowG"></div>', bg);
  if (V) gsap.set(glowG, { scale: 0.72 });
  // glow centre (x, y in 16:9 world px, EN) -> frame px; AR mirrors; 9:16 maps the world centre to the frame centre
  const gpos = (x, y) => { x = MX(x); return V ? [540 + (x - 960) * 0.62 - 750, 960 + (y - 540) * 0.9 - 750] : [x - 750, y - 750]; };
  const glow = (which, at, x, y, d = 1.2, op = 1) => { const [gx, gy] = gpos(x, y); to(which === "warm" ? glowR : glowG, { x: gx, y: gy, opacity: op, duration: d, ease: "sine.inOut" }, at); };
  { const [rx, ry] = gpos(416, 536), [gx, gy] = gpos(1320, 600); gsap.set(glowR, { x: rx, y: ry }); gsap.set(glowG, { x: gx, y: gy }); }
  // act light: warm from the first frame (poster), green rises at turnSec over 0.8 s while the warm one fades (brand VFX notes)
  gsap.set(glowR, { opacity: 1 }); // frame-0 state is set directly, not by a tween at 0
  fr(glowR, { opacity: 1 }, { opacity: 0, duration: 0.8, ease: "sine.inOut" }, F.turnSec);
  fr(glowG, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "sine.inOut" }, F.turnSec);
  const GH = [[340,230,146,60],[560,356,128,36],[384,400,148,96],[516,490,108,94],[766,600,70,100],[820,660,90,56],[1096,640,104,96],[624,746,138,48],[1324,716,120,34],[144,804,122,40],[114,892,144,52],[514,856,126,88],[830,880,130,90],[1616,866,84,50]];
  const GHV = [[166,353,122,56],[294,587,112,51],[184,683,130,93],[267,846,133,89],[403,1067,85,94],[606,1139,95,92],[440,1185,87,59],[746,1287,102,35],[327,1339,121,53],[51,1459,99,37],[267,1559,105,74],[918,1583,67,39],[451,1603,111,77],[35,1626,114,49]];
  const DUR = F.duration;
  (V ? GHV : GH).forEach(([x, y, w, h], i) => {
    const g = add(`<div class="ghost" style="width:${w}px;height:${h}px"></div>`, bg);
    const x0 = AR ? W - x - w : x, rot = [-3,2,0,-2,4,-4,1,3,-1,2,-3,0,2,-2][i];
    tl.fromTo(g, { x: x0, y, rotation: rot }, { x: x0 + SG([8,-6,4,10,-4,6,0,12,-8,15,2,-6,5,0][i]), y: y - 3.6 * DUR - (i % 4) * 6, rotation: rot, duration: DUR, ease: "none", immediateRender: true }, 0);
  });
  const grain = add('<div id="grain" data-layout-ignore></div>', stage); // texture, not content: the layout audit skips it
  { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), d = x.createImageData(256, 256);
    for (let p = 0; p < d.data.length; p += 4) { const v = Math.max(0, Math.min(255, Math.round(128 + 3 * 1.73 * (rnd() + rnd() + rnd() + rnd() - 2)))); d.data[p] = d.data[p + 1] = d.data[p + 2] = v; d.data[p + 3] = 255; }
    x.putImageData(d, 0, 0); grain.style.backgroundImage = `url(${c.toDataURL()})`; }
  const FR = Math.round(DUR * (F.fps || 30));
  tl.fromTo(grain, { backgroundPosition: "0px 0px" }, { backgroundPosition: `${FR * 97}px ${FR * 61}px`, duration: DUR, ease: `steps(${FR})`, immediateRender: true }, 0);
  // ---------- camera: world (or fg) scale/offset per beat; 9:16 takes its own values (default: 16:9 values at 0.62)
  const cam = (at, o, el = world) => { const v = { scale: V ? (o.vs ?? (o.s ?? 1) * 0.62) : (o.s ?? 1), x: SG(V ? (o.vx ?? 0) : (o.x ?? 0)), y: V ? (o.vy ?? 0) : (o.y ?? 0) };
    if (at <= 0) return gsap.set(el, v); // frame-0 framing is set directly (a tween at 0 does not render on a seek to 0)
    to(el, Object.assign(v, { duration: o.d ?? 0.6, ease: o.ease || "power2.inOut" }), at); };
  if (V) { gsap.set(world, { scale: 0.62 }); gsap.set(fg, { scale: 0.62 }); }
  // ---------- components. x is the inline-start edge in EN world px; AR mirrors. anchor "c" = x,y is the centre.
  const place = (el, x, y, w, anchor) => {
    // mirror inside the parent: world/fg are 1920 wide; a card's children mirror across the card's own width
    const p = el.parentElement, PW = p === world || p === fg || p === ec ? 1920 : parseFloat(p.style.width) || 1920;
    if (anchor === "c") { el.style.left = (AR ? PW - x : x) + "px"; el.style.top = y + "px"; gsap.set(el, { xPercent: -50, yPercent: -50 }); }
    else if (w != null) { el.style.left = (AR ? PW - x - w : x) + "px"; el.style.top = y + "px"; }
    else { el.style[AR ? "right" : "left"] = x + "px"; el.style.top = y + "px"; }
    return el;
  };
  const hide = (o) => (o.show ? "" : "opacity:0;");
  const card = (o) => place(add(`<div class="card ${o.cls || ""}" style="${hide(o)}${AR ? "direction:rtl;" : ""}width:${o.w}px;height:${o.h}px;${o.style || ""}">${o.html || ""}</div>`, o.p), o.x, o.y, o.w, o.anchor);
  const chip = (o) => place(add(`<div class="chip ${o.cls || ""}" style="${hide(o)}width:${o.s || 60}px;height:${o.s || 60}px;border-radius:${Math.round((o.s || 60) * 0.23)}px;${o.style || ""}">${o.html || ico(o.icon, o.icls || "")}</div>`, o.p), o.x, o.y, o.s || 60, o.anchor || "c");
  const pill = (o) => place(add(`<div class="pill ${o.cls || ""}" style="${hide(o)}${o.style || ""}">${iso(o.text)}</div>`, o.p), o.x, o.y, null, o.anchor);
  const btn = (o) => place(add(`<div class="btn ${o.cls || ""}" style="${hide(o)}height:${o.h || 90}px;${o.w ? `width:${o.w}px;` : ""}${o.style || ""}">${iso(o.text)}</div>`, o.p), o.x, o.y, o.w, o.anchor);
  const tag = (o) => place(add(`<div class="tag ${o.cls || ""}" style="${hide(o)}${o.style || ""}">${iso(o.text)}</div>`, o.p), o.x, o.y, null, o.anchor);
  const stamp = (o) => place(add(`<div class="stamp ${o.cls || ""}" style="opacity:0;${o.size ? `font-size:${o.size}px;` : ""}${o.style || ""}">${iso(o.text)}</div>`, o.p), o.x, o.y, null, "c");
  const label = (o) => place(add(`<div class="abs lbl ${o.cls || ""}" style="${hide(o)}${o.size ? `font-size:${o.size}px;` : ""}${o.style || ""}">${iso(o.text)}</div>`, o.p), o.x, o.y, o.w, o.anchor);
  // a row of pills laid out by the browser (flex, inline-start first; AR reads right to left). Returns the pills.
  const row = (o) => { const r = place(add(`<div class="abs" style="display:flex;gap:${o.gap ?? 16}px;${AR ? "direction:rtl;" : ""}${o.style || ""}"></div>`, o.p), o.x, o.y, null, o.anchor);
    return o.items.map((it) => { const e = r.appendChild($(`<div class="pill ${it.cls || ""}" style="position:relative;${it.show ? "" : "opacity:0;"}${it.style || ""}">${iso(it.text)}</div>`)); return e; }); };
  const check = (o) => place(add(`<div class="abs" style="${hide(o)}width:${o.s || 56}px;height:${o.s || 56}px">${o.cross ? CROSS : CHECK}</div>`, o.p), o.x, o.y, o.s || 56, "c");
  const mark = (o) => place(add(`<div class="abs" style="${hide(o)}width:${o.w || 180}px;height:${(o.w || 180) * 150 / 180}px">${MARK(o.rid, o.kid)}</div>`, o.p), o.x, o.y, null, "c");
  // ---------- motion classes (bible §4)
  const pop = (el, at, d = 0.35, o = 1.7, from = 0.3) => fr(el, { opacity: 0, scale: from }, { opacity: 1, scale: 1, duration: d, ease: `back.out(${o})` }, at);
  const slam = (el, at, d = 0.3, rot = -9) => fr(el, { opacity: 0, scale: 1.4, rotation: rot }, { opacity: 1, scale: 1, rotation: rot, duration: d, ease: "power4.in" }, at);
  const fadeIn = (el, at, d = 0.3, y = 0) => fr(el, { opacity: 0, y }, { opacity: 1, y: 0, duration: d }, at);
  const out = (els, at, d = 0.25) => to(els, { opacity: 0, duration: d, ease: "power1.in" }, at);
  const move = (el, at, v, d = 0.6) => to(el, Object.assign({ duration: d, ease: "power2.inOut" }, v), at);
  // typing: the text is revealed from the inline start, linear (time); returns the end time
  const type = (el, at, d) => { fr(el, { opacity: 1, clipPath: AR ? "inset(0% 0% 0% 100%)" : "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "none" }, at); return at + d; };
  // a press: 0.15 s anticipation (dim), the 8 px under-edge compresses, release
  const press = (el, at) => { to(el, { filter: "brightness(0.85)", duration: 0.15, ease: "none" }, at - 0.15); tl.to(el, { y: 6, duration: 0.08, ease: "power2.in" }, at); tl.to(el, { y: 0, filter: "brightness(1)", duration: 0.12, ease: "power2.out" }, at + 0.08); };
  // ---------- the tester: a cursor with a press ripple (bible §9.8). Never mirrored (an OS pointer).
  const cursor = (p = fg) => {
    const el = add('<div class="cursor" style="opacity:0"><svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2l15 11-7 1.2 4 7.3-2.6 1.4-4-7.4L4 20z" fill="#f4f2ee" stroke="#1d2024" stroke-width="1.4" stroke-linejoin="round"/></svg></div>', p);
    const rip = add('<div class="ripple"></div>', p);
    return { el,
      at(t, x, y) { fr(el, { opacity: 0, x: MX(x), y }, { opacity: 1, duration: 0.2 }, t); return this; },
      to(t, x, y, d = 0.6) { to(el, { x: MX(x), y, duration: d, ease: "power2.inOut" }, t); return this; },
      press(t, x, y) { tl.to(el, { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.in" }, t); fr(rip, { opacity: 1, scale: 0.4, x: MX(x), y }, { opacity: 0, scale: 1.6, duration: 0.45, ease: "power1.out" }, t); return this; },
      hide(t) { out(el, t, 0.2); return this; } };
  };
  // ---------- beat titles (Serif Display caps, one coloured word marked *word* in films.json); EN rises from a mask, AR wipes from the right
  const MARG = V ? 70 : 112, TTLY = V ? 392 : 128, CAPY = V ? 1432 : 880;
  const titleEls = {};
  const titleHTML = (t) => iso(T(t)).replace(/\*([^*]+)\*/, `<span class="c-${t.colour}">$1</span>`);
  const titles = (times = {}) => F.beats.forEach((b) => {
    if (!b.title) return;
    const w = add(`<div class="ttlw" style="top:${TTLY}px;${AR ? `right:${MARG}px;direction:rtl;text-align:right` : `left:${MARG}px`};width:${V ? 940 : 1500}px"><div class="ttl" style="opacity:0">${titleHTML(b.title)}</div></div>`, ui);
    const el = (titleEls[b.id] = w.firstChild), [a, z] = times[b.id] || [b.inSec + 0.4, b.outSec - 0.35];
    if (a <= 0) gsap.set(el, { opacity: 1 }); // on from frame 0 (a set at 0 would not render on a seek to 0)
    else if (AR) fr(el, { opacity: 1, clipPath: "inset(0% 0% 0% 100%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "power2.inOut" }, a);
    else fr(el, { opacity: 0, yPercent: 110 }, { opacity: 1, yPercent: 0, duration: 0.4 }, a);
    to(el, { opacity: 0, y: -8, duration: 0.15, ease: "power2.in" }, z);
  });
  // ---------- captions: Sans 500 bottom inline-start; a line that hands over at the same instant is fully out one frame before the next is in
  // over (p3, additive): { <caption n>: { inSec?, outSec? } } shifts a window to the voice for this build only (films.json untouched)
  const captions = (over = {}) => { const CS = F.captions.map((c) => Object.assign({}, c, over[c.n])); CS.forEach((c, i) => {
    const e = add(`<div class="cap" style="opacity:0;${AR ? `right:${MARG}px;text-align:right` : `left:${MARG}px`};top:${CAPY}px">${iso(c[LANG])}</div>`, ui);
    const n = CS[i + 1], abut = n && n.inSec - c.outSec < 0.05;
    fr(e, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.1 }, c.inSec);
    if (abut) to(e, { opacity: 0, duration: 0.08, ease: "none" }, n.inSec - 0.12); else to(e, { opacity: 0, duration: 0.1 }, c.outSec - 0.1);
  }); };
  // ---------- shared end card: everything named drains to the centre and becomes the mark (graphic match), the mark draws
  // its check, the lockup settles, maker line, pills, Download free last (brand-films.md "Shared end card")
  const endCard = (b, drain = [world, fg], opts = {}) => {
    const fg = ec;
    const t0 = b.inSec, E = scr(b.id);
    to(drain, { scale: (V ? 0.62 : 1) * 0.08, opacity: 0, duration: 0.5, ease: "power2.in" }, t0);
    const m = add(`<div class="abs" style="left:${960 - 57.6}px;top:${540 - 48}px;width:115.2px;height:96px;opacity:0">${MARK("ecR", "ecK")}</div>`, fg);
    fr(m, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1.6, duration: 0.1, ease: "none" }, t0 + 0.4);
    fr("#ecR", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.inOut" }, t0 + 0.4);
    fr("#ecK", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out" }, t0 + 0.6);
    to(m, { x: 678 - (960 - 57.6), y: 321 - (540 - 48), scale: 1, duration: 0.5, ease: "back.out(1.4)" }, t0 + 1.2);
    const word = add(`<div class="abs" style="left:818px;top:302px;font:700 93px/1 'Thmanyah Serif Display';color:#f1efea;white-space:nowrap;direction:ltr;opacity:0">${E[0]}</div>`, fg);
    fr(word, { opacity: 1, clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.35, ease: "none" }, t0 + 1.35);
    const made = add(`<div class="abs e2" style="top:438px;font:500 30px/40px 'Thmanyah Sans';color:#a5abb0;opacity:0;${AR ? "direction:rtl" : ""}">${iso(E[1])}</div>`, fg);
    const row = add(`<div class="abs e2" style="top:493px;display:flex;justify-content:center;gap:13px;${AR ? "direction:rtl" : ""}">${E.slice(2, 5).map((t) => `<span class="v2tg" style="opacity:0">${iso(t)}</span>`).join("")}</div>`, fg);
    const dl = add(`<div class="abs" style="left:${960 - 160}px;top:577px;width:320px;height:65px;border-radius:33px;background:#7bd389;color:#10331a;font:700 30px/65px 'Thmanyah Sans';text-align:center;opacity:0">${iso(E[5])}</div>`, fg);
    fr(made, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25 }, t0 + 1.7);
    [...row.children].forEach((p, i) => pop(p, t0 + 1.9 + i * 0.08, 0.3, 2, 0.5));
    pop(dl, t0 + 2.3, 0.35, 2, 0.4);
    // opts.links (p1, additive): the commercial's site URL and GitHub lines under Download free, same type, same order and
    // spacing as the commercial (Download free, +0.25 s URL, +0.55 s GitHub; blur-in 0.25 s). Latin in both languages.
    let url = null, gh = null;
    if (opts.links) {
      url = add(`<div class="abs e2" style="top:661px;font:400 35px/44px 'Thmanyah Sans';color:#e8e6e1;direction:ltr;opacity:0">${opts.url || "https://nj-burrito.github.io/QA-Wrap/"}</div>`, fg);
      gh = add(`<div class="abs e2" style="top:711px;font:400 26px/34px 'Thmanyah Sans';color:#9aa0a6;direction:ltr;opacity:0">${opts.github || "github.com/NJ-Burrito/QA-Wrap"}</div>`, fg);
      fr(url, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25 }, t0 + 2.55);
      fr(gh, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25 }, t0 + 2.85);
    }
    return { mark: m, word, made, row, dl, url, gh };
  };
  // key-light positions for the act (16:9 world px, EN): warm (problem) and green (tool) glow centres at frame 0
  const light = (warm, green) => { if (warm) gsap.set(glowR, { x: gpos(...warm)[0], y: gpos(...warm)[1] }); if (green) gsap.set(glowG, { x: gpos(...green)[0], y: gpos(...green)[1] }); };
  const done = () => { window.__timelines = window.__timelines || {}; window.__timelines[ID] = tl; };
  return { F, N, LANG, AR, V, W, H, ID, tl, rnd, mx, MX, SG, iso, T, add, beat, scr, ico, CHECK, CROSS, MARK, world, fg, ui, bg,
    set, to, fr, glow, cam, card, chip, pill, btn, tag, stamp, label, check, mark, pop, slam, fadeIn, out, move, type, press,
    cursor, row, light, start, titles, titleEls, captions, endCard, done };
};
