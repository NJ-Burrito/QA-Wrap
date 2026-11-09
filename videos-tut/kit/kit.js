  // ---- kit (round 2): helpers shared by every film, inlined by build.mjs. In scope: tl, q, D, LANG, RTL. ----
  // Eases by object class (commercial-bible §4): arrivals overshoot, moves ease in-out, time is linear, stamps slam.
  const E = { out: 'power3.out', in: 'power2.in', io: 'power2.inOut', back: 'back.out(1.6)', slam: 'power4.in', time: 'none', drift: 'sine.inOut' };
  /** Screen direction. X(x): an EN stage x as the AR stage mirrors it; mx(dx): a horizontal move, mirrored in AR. */
  const X = (x) => (RTL ? 1920 - x : x);
  const mx = (dx) => (RTL ? -dx : dx);
  /** A point inside an English site miniature (LTR content) whose box sits at EN left L, width W; u = x inside it. */
  const B = (L, W, u) => (RTL ? 1920 - L - W + u : L + u);

  /** A scene is on stage from a to b (0.35 s fade at each end). drift is optional; the default holds still. */
  const scene = (sel, a, b, drift) => {
    tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power1.out', immediateRender: false }, a);
    if (drift) tl.fromTo(sel, drift.from, { ...drift.to, duration: b - a + 0.3, ease: 'none', immediateRender: false, transformOrigin: '50% 50%' }, a);
    tl.to(sel, { opacity: 0, duration: 0.35, ease: 'power1.in' }, b);
  };
  /** Arrive with an overshoot (light things). */
  const pop = (sel, at, from = {}, dur = 0.45) => tl.fromTo(sel, { opacity: 0, scale: 0.6, y: 18, ...from }, { opacity: 1, scale: 1, x: 0, y: 0, duration: dur, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, at);
  const fadeIn = (sel, at, vars = {}, dur = 0.3) => tl.fromTo(sel, { opacity: 0, ...vars }, { opacity: 1, x: 0, y: 0, duration: dur, ease: E.out, immediateRender: false }, at);
  const fadeOut = (sel, at, dur = 0.25) => tl.to(sel, { opacity: 0, duration: dur, ease: 'power1.in' }, at);
  /** A verdict or a heavy thing: from 1.4x, accelerating into rest. */
  const slam = (sel, at, dur = 0.32) => tl.fromTo(sel, { opacity: 0, scale: 1.45 }, { opacity: 1, scale: 1, duration: dur, ease: E.slam, immediateRender: false, transformOrigin: '50% 50%' }, at);
  /** A glow breathes up to o at `at` and back down at `end`. */
  const glow = (sel, at, end, o = 1) => { tl.to(sel, { opacity: o, duration: 0.8, ease: 'sine.out' }, at); if (end != null) tl.to(sel, { opacity: 0, duration: 0.8, ease: 'sine.in' }, end); };
  /** The act light: warm coral on the inline-start side until the tool acts at `turn`, green on the inline-end side after. */
  const act = (turn, warm = 0.95, green = 0.9) => {
    tl.fromTo('#glowW', { opacity: 0 }, { opacity: warm, duration: 1.0, ease: 'sine.out', immediateRender: false }, 0);
    tl.to('#glowW', { opacity: 0, duration: 0.9, ease: 'sine.inOut' }, turn - 0.2);
    tl.fromTo('#glowG', { opacity: 0 }, { opacity: green, duration: 1.0, ease: 'sine.inOut', immediateRender: false }, turn);
  };
  /** One amber key light that moves to the focal point of a beat (EN coordinates of its centre). */
  const key = (at, x, y, o = 0.8, dur = 0.8) => tl.to('#glowA', { x: X(x) - 450, y: y - 450, opacity: o, duration: dur, ease: E.io }, at);
  /** Camera on #world: x is mirrored in AR; s is the scale (1 = rest). */
  const cam = (at, dur, { x = 0, y = 0, s = 1 } = {}, ease = E.io) => tl.to('#world', { x: mx(x), y, scale: s, duration: dur, ease }, at);
  const camSet = (at, { x = 0, y = 0, s = 1 } = {}) => tl.set('#world', { x: mx(x), y, scale: s }, at);
  /** The beat title (one per film, Serif Display, top inline-start). */
  const title = (sel, at, out) => { tl.fromTo(sel, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: E.out, immediateRender: false }, at); if (out != null) fadeOut(sel, out, 0.3); };
  /** Fly on an arc (never a straight diagonal): from (x0,y0) to (x1,y1) in EN stage px, lifting by `lift`. */
  const fly = (sel, at, dur, x0, y0, x1, y1, lift = 140, s1 = 1) => {
    const top = Math.min(y0, y1) - lift;
    tl.set(sel, { x: X(x0), y: y0, xPercent: -50, yPercent: -50, opacity: 1, scale: 1 }, at);
    tl.to(sel, { x: X(x1), duration: dur, ease: 'sine.inOut' }, at);
    tl.to(sel, { y: top, duration: dur * 0.45, ease: 'power2.out' }, at);
    tl.to(sel, { y: y1, duration: dur * 0.55, ease: 'power2.in' }, at + dur * 0.45);
    tl.to(sel, { scale: s1, duration: dur, ease: E.in }, at);
  };
  /** Cursor: its tip goes to the EN stage point (x, y); X() mirrors it in AR. Press = a dip and an amber ripple. */
  const cursorAt = (at, x, y) => tl.set('#cursor', { x: X(x) - 8, y: y - 4 }, at);
  const cursorTo = (at, x, y, dur = 0.7) => tl.to('#cursor', { x: X(x) - 8, y: y - 4, duration: dur, ease: E.io }, at);
  /** C5: where a cursor presses a button: the inline-end third, so the tip never hides the label.
   *  third(cx, w) for tool buttons in EN stage px (X() mirrors it to the AR inline end); for English site buttons use cx + w / 6 inside B(). */
  const third = (cx, w) => cx + w / 6;
  /** As cursorTo, but x is already a stage x (from B()). */
  const cursorToRaw = (at, x, y, dur = 0.7) => tl.to('#cursor', { x: x - 8, y: y - 4, duration: dur, ease: E.io }, at);
  const press = (at, x, y, rip = '#rip', raw = false) => {
    const sx = raw ? x : X(x);
    tl.to('#cursor', { scale: 0.82, duration: 0.09, ease: 'power1.in', transformOrigin: '8px 4px' }, at);
    tl.to('#cursor', { scale: 1, duration: 0.18, ease: 'power2.out', transformOrigin: '8px 4px' }, at + 0.09);
    tl.set(rip, { x: sx - 35, y: y - 35 }, at);
    tl.fromTo(rip, { opacity: 0.95, scale: 0.3 }, { opacity: 0, scale: 1.7, duration: 0.5, ease: 'power2.out', immediateRender: false }, at);
  };
  /** A button pressed: anticipation (a dip into its hard edge) then release. */
  const push = (sel, at) => { tl.to(sel, { y: 6, duration: 0.08, ease: 'power1.in' }, at); tl.to(sel, { y: 0, duration: 0.22, ease: 'back.out(2)' }, at + 0.08); };
  /** Type text into a clip: the wrapper's clip-path opens from the inline start like a caret. ltr = true for
   *  English site text, which always types left to right. */
  const type = (wrap, at, dur, ltr = false) => tl.fromTo(wrap, { clipPath: RTL && !ltr ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0%)', duration: dur, ease: `steps(${Math.max(6, Math.round(dur * 14))})`, immediateRender: false }, at);
  /** A screenshot flash. */
  const flash = (at) => { tl.fromTo('#flash', { opacity: 0 }, { opacity: 0.8, duration: 0.06, ease: 'none', immediateRender: false }, at); tl.to('#flash', { opacity: 0, duration: 0.35, ease: 'power2.out' }, at + 0.06); };
  /** Draw a time line (linear, it is time) from the inline start. */
  const draw = (sel, at, dur) => tl.fromTo(sel, { scaleX: 0 }, { scaleX: 1, duration: dur, ease: E.time, immediateRender: false }, at);
  /** Draw an SVG stroke whose path length is len. */
  const stroke = (sel, at, dur, len, ease = 'power2.inOut') => tl.fromTo(sel, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: dur, ease, immediateRender: false }, at);
  /** The end card: lockup arrives, then the note; held to the last frame. */
  const endCard = (a) => {
    tl.fromTo('#end', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', immediateRender: false }, a);
    pop('#lockup', a + 0.15, { y: 14, scale: 0.85 }, 0.6);
    fadeIn('#maker', a + 0.6, { y: 8 }, 0.45);
    fadeIn('#endnote', a + 1.1, { y: 10 }, 0.5);
  };
  /** Push in (s > 1) or pull out so the EN stage point (px, py) comes to the frame centre; mirrored in AR. */
  const camOn = (at, dur, px, py, s, ease = E.io) => cam(at, dur, { x: -s * (px - 960), y: -s * (py - 540), s }, ease);
