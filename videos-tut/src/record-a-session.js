  // ===== record-a-session (treatment docs/film/treatments/record-a-session.md), round 2 =====
  const BL = 140, BW = 1180, PT = 194;            // browser box (EN), page top on stage
  const P = (u, v) => [B(BL, BW, u), PT + v];      // a point inside the English site, as a stage point
  const pressAt = (at, [x, y]) => { cursorToRaw(at - 0.75, x, y, 0.7); press(at, x, y, '#rip', true); };
  const count = (c, n, at) => {
    tl.set(`#pop .${c} .n${n - 1}`, { opacity: 0 }, at);
    tl.fromTo(`#pop .${c} .n${n}`, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.back, immediateRender: false }, at);
  };
  gsap.set('#sleepz .z', { opacity: 0 });
  gsap.set('#typed', { clipPath: RTL ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' });
  gsap.set('#fn', { opacity: 0 });
  act(12.15);

  // S1 0-7.2 WS: the shop, QA Wrap asleep; a slow truck toward the toolbar (we go where the tool sleeps)
  fadeIn('#browser', 0, { y: 30 }, 0.8);
  // three z glyphs rise from the icon on an arc (drifting toward the inline end) and fade, in turn
  for (let k = 0; k < 11; k++) {                   // three always in the air: one rises every 0.6 s, lives 1.8 s
    const a = 0.3 + k * 0.6, z = '#sleepz .z' + ((k % 3) + 1);
    tl.fromTo(z, { opacity: 0, x: 0, y: 30, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'sine.out', immediateRender: false }, a);
    tl.to(z, { x: mx(46), duration: 1.8, ease: 'sine.inOut' }, a);
    tl.to(z, { y: -110, duration: 1.8, ease: 'none' }, a);              // even rise: 47 px between neighbours, more than a glyph, so none overlap
    tl.to(z, { opacity: 0, duration: 0.6, ease: 'power1.in' }, a + 1.2);
  }
  cam(2.6, 4.4, { x: -40, y: 40, s: 1.07 }, 'sine.inOut');

  // S2 7.2-13.8 CU icon, then MS popup: the single action of the film
  camOn(7.2, 0.9, 1276, 162, 1.9);
  tl.to('#ext', { scale: 0.86, duration: 0.18, ease: 'power1.in' }, 7.75);                       // anticipation dip
  tl.to('#ext', { scale: 1, duration: 0.4, ease: 'back.out(3)' }, 7.93);
  tl.to('#xr', { attr: { stroke: '#ecebe7' }, duration: 0.25 }, 7.93);
  tl.to('#xc', { attr: { stroke: '#ff7d63' }, duration: 0.25 }, 7.93);
  key(7.7, 1276, 162, 0.9, 0.5);
  fadeIn('#beam', 8.4);
  stroke('#beamp', 8.4, 0.5, 120, 'power2.out');
  camOn(8.6, 1.1, 1470, 570, 1.15);                                                 // the browser plate ends 60 px above the caption band
  pop('#pop', 8.75, { y: -24, scale: 0.8 }, 0.55);
  key(8.75, 1590, 346, 0.85, 0.9);
  fadeOut('#beam', 10.0);
  tl.to('#ph', { opacity: 0, duration: 0.1 }, 9.7);
  type('#typed', 9.75, 1.1);
  cursorAt(10.6, 1700, 520);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 10.6);
  const edge = (cx, w) => cx + w / 2 - 34;          // C5: past the label, inside the button's inline-end edge
  cursorTo(10.9, edge(1590, 412), 346, 0.85);
  push('#startbtn', 12.0); press(12.0, edge(1590, 412), 346);
  fadeOut('#viewA', 12.6);
  fadeIn('#viewB', 12.8);
  fadeIn('#recdot', 12.85);
  tl.to('#recdot', { opacity: 0.3, duration: 0.5, ease: 'sine.inOut', yoyo: true, repeat: 47 }, 13.3);
  key(12.4, 1590, 346, 0, 0.8);

  // S3 14.0-20.2 MS: test as usual (one press per word); the counter card docked at the side
  camOn(13.8, 1.1, 980, 500, 1.06);
  pressAt(15.3, P(251, 506));
  tl.fromTo('#badge', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.back, immediateRender: false }, 15.35);
  count('c-a', 1, 15.4); count('c-n', 1, 15.9);
  pressAt(16.6, P(1116, 46));
  count('c-a', 2, 16.65);
  fadeOut('#pg-inv', 16.75, 0.2); fadeIn('#pg-info', 16.75, {}, 0.2);
  pressAt(17.8, P(300, 188));
  count('c-a', 3, 17.85);
  tl.to('#fn-ph', { opacity: 0, duration: 0.05 }, 18.2);
  tl.set('#fn', { opacity: 1 }, 18.2); type('#fn', 18.2, 0.6, true);
  tl.to('#pgscroll', { y: -40, duration: 0.7, ease: E.io }, 19.1);                                // scroll

  // S4 20.2-28.0 pull-out: one lane under the page; each event flies on an arc and becomes a dot
  camOn(20.2, 1.4, 960, 640, 0.8);
  fadeIn('#lane', 20.3);
  draw('#laneline', 20.4, 4.4);
  const evt = (n, at, x0, y0, xd, cnt) => {
    fly('#e' + n, at, 0.01, x0, y0, x0, y0, 0);                                                      // place
    tl.fromTo('#e' + n, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: E.back, immediateRender: false }, at);
    fly('#e' + n, at + 0.75, 0.85, x0, y0, xd, 1001, 120, 0.12);
    tl.to('#e' + n, { opacity: 0, duration: 0.12 }, at + 1.5);
    tl.fromTo('#d' + n, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.back, immediateRender: false }, at + 1.55);
    if (cnt) cnt();
  };
  evt(1, 20.8, 340, 610, 360);
  evt(2, 21.5, 760, 330, 620);
  pressAt(22.3, P(1033, 464));
  evt(3, 22.3, 1120, 760, 880, () => count('c-a', 4, 22.35));
  fadeIn('#pg-err', 22.55); tl.fromTo('#pg-err', { x: -10 }, { x: 0, duration: 0.5, ease: 'elastic.out(1,0.3)', immediateRender: false }, 22.55);
  evt(4, 22.65, 500, 500, 1140, () => count('c-e', 1, 22.7));
  flash(23.35);
  evt(5, 23.4, 860, 230, 1400, () => count('c-s', 1, 23.45));
  fadeOut('#cursor', 24.0);
  fadeIn('#lanelbl', 24.9);
  key(25.0, 880, 1001, 0.7, 1.0);

  // S5 28.0-35.0 EWS high angle: everything stays on this computer
  camOn(27.7, 0.7, 960, 600, 0.5, E.in);
  fadeOut('#main', 27.75, 0.45);
  key(27.8, 960, 600, 0, 0.6);
  gsap.set('#plane', { rotationX: 32, y: 60, scale: 0.55 });
  gsap.set('#arrow', { strokeDasharray: '14 14' });
  tl.fromTo('#s5', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out', immediateRender: false }, 28.1);
  tl.fromTo('#plane', { scale: 0.5 }, { scale: 0.55, duration: 1.2, ease: E.out, immediateRender: false }, 28.1);
  title('#t5', 29.6, 34.6);
  fadeIn('#cloud', 30.6);
  tl.fromTo('#arrow', { opacity: 0, strokeDashoffset: 300 }, { opacity: 1, strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', immediateRender: false }, 31.0);
  slam('#barrier', 32.35, 0.3);
  tl.to('#arrow', { opacity: 0.35, duration: 0.4 }, 32.7);
  fadeOut('#s5', 34.75, 0.35);

  // S6 35.0-41.0 MS popup (same framing as shot 2, to rhyme): Stop, saved
  tl.set('#browser, #lane, #sleepz', { opacity: 0 }, 34.9);
  tl.set('.ev', { opacity: 0 }, 34.9);
  tl.set('#pop', { x: mx(-1000), y: 60, opacity: 0 }, 34.9);
  camSet(34.9, { s: 1 });
  tl.set('#main', { opacity: 1 }, 34.95);
  tl.fromTo('#pop', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.55, ease: E.back, immediateRender: false }, 35.1);
  cursorAt(35.6, 900, 900);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 35.8);
  cursorTo(36.0, third(590, 412), 702, 0.9);
  push('#stopbtn', 37.0); press(37.0, third(590, 412), 702);
  tl.to('#recdot', { opacity: 0, duration: 0.12, overwrite: 'auto' }, 37.15);
  pop('#saved', 37.5, { x: mx(60), scale: 0.8 }, 0.55);
  pop('#savedpill', 38.3, { y: 12 }, 0.45);
  key(37.4, 1310, 490, 0.75, 0.8);
  fadeOut('#cursor', 38.3);
  fadeOut('#pop', 40.7, 0.3); fadeOut('#saved', 40.7, 0.3);
  key(40.6, 1310, 490, 0, 0.6);

  // S7 41.0-48.4 MS then CU of the Timeline card: read it, step by step
  tl.fromTo('#s7', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', immediateRender: false }, 41.0);
  tl.fromTo('#s7 .trow', { opacity: 0, x: mx(-30) }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.12, ease: E.out, immediateRender: false }, 41.3);
  camOn(42.2, 5.8, 960, 440, 1.1, 'sine.inOut');
  fadeIn('#hl', 42.6);
  [[43.6, 106], [44.6, 212], [45.6, 318], [46.6, 424]].forEach(([a, y]) => tl.to('#hl', { y, duration: 0.42, ease: E.io }, a));
  fadeOut('#s7', 48.1, 0.35);

  // S8 48.5-52 end card, centred and still
  camSet(48.45, { s: 1 });
  endCard(48.5);
