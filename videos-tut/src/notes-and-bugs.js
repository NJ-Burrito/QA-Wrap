  // ===== notes-and-bugs (treatment docs/film/treatments/notes-and-bugs.md), round 2 =====
  const BL = 360, BW = 1200, PT = 194;
  const P = (u, v) => [B(BL, BW, u), PT + v];
  const NC = (o, y) => [1240 + o, y];               // a point in the note card (EN stage), mirrored by X() in the helpers
  gsap.set('#ntx', { clipPath: RTL ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' });
  gsap.set('#caret', { opacity: 0 });
  act(23.4);

  // S1 0-7.2 MS: something is off; Send stays dead
  fadeIn('#browser', 0, { y: 24 }, 0.6);
  const [sx, sy] = P(193, 572);                    // Send's inline-end third (C5)
  cursorAt(0.2, 1500, 900);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 0.4);
  cursorToRaw(0.8, sx, sy, 1.0);
  [2.1, 2.9].forEach((a) => { press(a, sx, sy, '#rip', true); tl.to('#send', { y: 2, duration: 0.06, yoyo: true, repeat: 1 }, a); });
  key(2.0, B(BL, BW, 160), 766, 0.55, 0.6);
  pop('#bub', 3.9, { scale: 0.3, y: 20 }, 0.5);
  tl.to('#bub', { y: -8, duration: 1.4, ease: E.drift, yoyo: true, repeat: 1 }, 4.5);
  fadeOut('#cursor', 5.2);

  // S2 7.2-13.8 MS split: the page makes room at the inline start; the note card arrives at the inline end
  tl.to('#browser', { x: mx(-300), scale: 0.8, duration: 0.9, ease: E.io, transformOrigin: RTL ? '100% 50%' : '0% 50%' }, 7.2);
  fadeOut('#bub', 7.2, 0.3);
  key(7.4, 1520, 300, 0.5, 0.8);
  tl.fromTo('#nc', { opacity: 0, x: mx(220) }, { opacity: 1, x: 0, duration: 0.7, ease: E.out, immediateRender: false }, 7.6);
  tl.to('#caret', { opacity: 1, duration: 0.05 }, 8.4);
  tl.to('#caret', { opacity: 0, duration: 0.05, yoyo: true, repeat: 5, repeatDelay: 0.35 }, 8.7);
  tl.to('#nph', { opacity: 0, duration: 0.1 }, 10.6);
  type('#ntx', 10.7, 1.6);
  tl.set('#caret', { opacity: 0 }, 10.6);

  // S3 13.8-21.0 CU: the type menu; Note, then Bug
  camOn(13.8, 1.0, 1400, 601, 1.4);
  cursorAt(14.4, 1520, 700);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 14.6);
  cursorTo(14.8, ...NC(157, 450), 0.7);
  press(15.6, ...NC(157, 450));
  tl.fromTo('#menu', { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.3, ease: E.out, immediateRender: false }, 15.75);
  tl.to('#mN', { backgroundColor: 'rgba(157,184,232,.18)', duration: 0.2 }, 16.2);
  cursorTo(17.6, ...NC(184, 582), 0.6);
  tl.to('#mN', { backgroundColor: 'rgba(157,184,232,0)', duration: 0.2 }, 17.9);
  tl.to('#mB', { backgroundColor: 'rgba(255,125,99,.2)', duration: 0.2 }, 17.9);
  press(18.5, ...NC(184, 582));
  tl.to('#menu', { opacity: 0, duration: 0.2 }, 18.75);
  tl.to('#tagN', { opacity: 0, duration: 0.15 }, 18.8);
  slam('#tagB', 18.8, 0.28);
  key(18.6, 1364, 450, 0.0, 0.5);

  // S4 21.0-27.8 MS: proof joins the claim; the light turns green as it clips on
  camOn(21.0, 0.9, 1460, 560, 1.18);
  cursorTo(21.6, ...NC(365, 658), 0.6);
  push('#shotb', 22.4); press(22.4, ...NC(365, 658));
  flash(22.55);
  tl.fromTo('#thumb', { opacity: 0, y: -160, rotation: -10 }, { opacity: 1, y: 0, rotation: 0, duration: 0.55, ease: 'back.out(2.2)', immediateRender: false }, 22.9);
  tl.to('#thumb', { rotation: 3, duration: 0.12, ease: 'power1.out', yoyo: true, repeat: 1 }, 23.45);      // follow-through: clipped on
  cursorTo(24.8, ...NC(365, 754), 0.6);
  push('#addb', 25.6); press(25.6, ...NC(365, 754));
  tl.to('#nc', { boxShadow: '0 30px 60px rgba(0,0,0,.45), 0 0 0 2px rgba(123,211,137,.55)', duration: 0.4 }, 25.8);
  fadeOut('#cursor', 26.3);

  // S5 27.8-35.9 WS pull-out: the note lands at its moment on the timeline
  camOn(27.8, 1.4, 960, 640, 0.8);
  fadeIn('#lane', 28.0);
  draw('#laneline', 28.1, 1.8);
  ['#l1', '#l2', '#l3', '#l4', '#l6'].forEach((s, i) => pop(s, 28.3 + i * 0.32, { y: -40, scale: 0.3 }, 0.35));
  fly('#fl', 29.6, 0.01, 1520, 330, 1520, 330, 0);
  tl.fromTo('#fl', { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: E.back, immediateRender: false }, 29.6);
  fly('#fl', 30.4, 1.0, 1520, 330, 1251, 1000, 160, 0.15);
  tl.to('#fl', { opacity: 0, duration: 0.12 }, 31.3);
  tl.fromTo('#flag', { opacity: 0, scaleY: 0 }, { opacity: 1, scaleY: 1, duration: 0.55, ease: 'back.out(1.8)', immediateRender: false }, 31.35);
  key(31.3, 1340, 900, 0.6, 0.8);
  tl.to('#browser, #nc, #lane', { opacity: 0, duration: 0.4 }, 35.5);
  key(35.4, 1340, 900, 0, 0.5);

  // S6 36.0-43.0 MS: the Timeline tab; Bugs, and everything else leaves
  camSet(35.95, { s: 1 });
  tl.fromTo('#s6', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', immediateRender: false }, 36.0);
  cursorAt(37.0, 1300, 700);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 37.0);
  cursorTo(37.3, 1552, 142, 0.8);
  press(38.3, 1552, 142);
  tl.to('#fAll', { borderColor: 'rgba(58,64,71,1)', duration: 0.2 }, 38.4);
  tl.to('#fBug', { backgroundColor: 'rgba(255,125,99,.2)', duration: 0.2 }, 38.4);
  tl.to('#s6 .o', { opacity: 0, x: mx(-30), duration: 0.4, stagger: 0.06 }, 38.6);
  [['#b1', -92], ['#b2', -184], ['#b3', -276]].forEach(([s, dy], i) => tl.to(s, { y: dy, duration: 0.55, ease: E.io }, 39.1 + i * 0.12));
  fadeOut('#cursor', 39.2);
  fadeOut('#s6', 43.0, 0.35);

  // S7 43.4-49.6 CU, low angle: only bugs count
  tl.fromTo('#ctr', { opacity: 0, scale: 0.8, rotationX: 0, transformPerspective: 1200 }, { opacity: 1, scale: 1, rotationX: 12, duration: 0.6, ease: E.back, immediateRender: false, transformOrigin: '50% 100%' }, 43.35);
  title('#t7', 43.7, 49.25);
  key(43.6, 960, 480, 0.55, 0.8);
  [44.4, 45.2, 46.0].forEach((a, i) => {
    fly('#q' + (i + 1), a, 0.65, 700 + i * 260, 120, 850, 520, 60, 0.3);
    tl.to('#q' + (i + 1), { opacity: 0, duration: 0.1 }, a + 0.6);
    if (i) tl.set('#ctr .k' + i, { opacity: 0 }, a + 0.62);
    tl.fromTo('#ctr .k' + (i + 1), { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.slam, immediateRender: false }, a + 0.62);
  });
  [[44.8, 760], [45.8, 820]].forEach(([a, y], i) => {
    fly('#w' + (i + 1), a, 2.4, 260, y, 1660, y - 40, 30, 1);
    tl.fromTo('#w' + (i + 1), { opacity: 0.9 }, { opacity: 0, duration: 1.0, immediateRender: false }, a + 1.4);
  });
  fadeOut('#main', 49.25, 0.4);

  // S8 49.8-52 end card
  camSet(49.7, { s: 1 });
  endCard(49.8);
