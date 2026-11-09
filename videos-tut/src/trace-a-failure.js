  // ===== trace-a-failure (treatment docs/film/treatments/trace-a-failure.md), round 2 =====
  const BL = 120, BW = 1000, PT = 214;
  const P = (u, v) => [B(BL, BW, u), PT + v];
  const clicks = [P(233, 258), P(820, 198), P(820, 282)];                         // presses: each control's inline-end third (C5)
  const marks = [P(60, 230), P(580, 170), P(580, 250)];                            // rings: each control's top inline-start corner, half outside, so labels stay readable
  marks.forEach(([x, y], i) => gsap.set('#r' + (i + 1), { x, y }));
  gsap.set('#plane1', { transformOrigin: '50% 70%' });
  act(7.4);

  // S1 0-7.2 WS, high angle: three quick clicks, the page breaks, a red 500; which click?
  fadeIn('#browser', 0, { y: 24 }, 0.6);
  cursorAt(0, 1500, 900);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 0.2);
  clicks.forEach(([x, y], i) => { cursorToRaw(0.25 + i * 0.42, x, y, 0.3); press(0.55 + i * 0.42, x, y, '#rip', true); });
  fadeIn('#brk', 1.45, { y: -8 }, 0.25);
  tl.fromTo('#browser', { x: 0 }, { keyframes: [{ x: -8, duration: 0.05 }, { x: 7, duration: 0.07 }, { x: -4, duration: 0.07 }, { x: 0, duration: 0.08 }], immediateRender: false }, 1.45);
  fadeOut('#cursor', 1.7);
  fadeIn('#cons', 1.9, { x: mx(60) }, 0.5);
  slam('#c500', 2.7, 0.3);
  tl.to('#plane1', { rotationX: 30, duration: 1.4, ease: E.io }, 3.4);                              // high angle: the tester is small
  [0, 1, 2].forEach((i) => tl.fromTo('#r' + (i + 1), { opacity: 0, z: 0, scale: 0.4 }, { opacity: 1, z: 70, scale: 1, duration: 0.45, ease: E.back, immediateRender: false }, 3.9 + i * 0.22));
  pop('#qm', 4.6, { y: 30, scale: 0.4 }, 0.5);
  tl.to('#qm', { y: 12, duration: 1.2, ease: E.drift, yoyo: true, repeat: 1 }, 5.2);
  camOn(5.0, 2.1, 780, 420, 1.08, 'sine.inOut');

  // S2 7.2-14.6 EWS: the turn; one timeline, every event on it in order
  camOn(7.2, 1.0, 960, 540, 1.0);
  tl.to('#s1, #qm', { opacity: 0, duration: 0.45, ease: 'power1.in' }, 7.2);
  tl.set('#tll', { opacity: 1 }, 7.6);
  draw('#tll', 7.6, 3.6);
  const lands = [8.0, 8.4, 8.8, 9.2, 9.7, 10.15, 10.6];
  lands.forEach((a, i) => pop('#t' + (i + 1), a, { y: -60, scale: 0.3 }, 0.4));
  fadeIn('#tt5', 9.9); fadeIn('#tt6', 10.35);
  pop('#p500', 11.0, { y: 20 }, 0.45);
  key(11.0, 1600, 540, 0.6, 1.0);

  // S3 14.6-21.8 MS: push in on the two dots; the thread draws back in time to the click before
  camOn(14.6, 1.3, 1480, 500, 1.75);
  tl.to('#t1, #t2, #t3, #t4, #t5, #tt5', { opacity: 0.22, duration: 0.6 }, 14.8);
  fadeOut('#p500', 14.8, 0.4);
  tl.set('#thread', { opacity: 1 }, 16.4);
  stroke('#thread', 16.4, 1.2, 320, 'power2.inOut');
  tl.fromTo('#t6', { scale: 1 }, { scale: 1.5, duration: 0.25, ease: 'power2.out', yoyo: true, repeat: 1, immediateRender: false, transformOrigin: '50% 50%' }, 17.55);
  pop('#plk', 17.8, { y: 14 }, 0.45);
  key(16.4, 1480, 500, 0.75, 1.0);

  // S4 21.8-28.8 CU, low angle: the click becomes a card with its name and time
  camOn(21.8, 1.0, 960, 540, 1.0);
  fadeOut('#tline', 21.85, 0.4);
  tl.fromTo('#ccard', { opacity: 0, scale: 0.08, x: mx(300), y: 30, rotationX: 0, transformPerspective: 1200 },
    { opacity: 1, scale: 1, x: 0, y: 0, rotationX: 14, duration: 0.9, ease: E.back, immediateRender: false, transformOrigin: '50% 100%' }, 22.0);
  tl.to('#ccard', { y: -20, duration: 4.0, ease: 'sine.out' }, 22.9);
  tl.fromTo('#ctime', { color: '#ecebe7' }, { color: '#f0b94a', duration: 0.4, immediateRender: false }, 24.4);
  key(22.2, 960, 470, 0.7, 0.9);
  fadeOut('#ccard', 28.5, 0.35);

  // S5 28.8-35.8 MS: where the answer lives in the report
  key(28.6, 960, 450, 0, 0.6);
  tl.fromTo('#s5', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', immediateRender: false }, 28.85);
  tl.to('#s5 .ctx', { opacity: 0.3, duration: 0.6 }, 30.4);
  tl.to('#rf', { backgroundColor: 'rgba(255,125,99,.16)', boxShadow: '0 0 0 2px rgba(255,125,99,.6)', duration: 0.5 }, 30.6);
  tl.to('#rc', { backgroundColor: 'rgba(240,185,74,.10)', duration: 0.5 }, 31.8);
  tl.fromTo('#lnk', { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: 'power2.inOut', immediateRender: false }, 31.8);
  pop('#lkp', 32.3, { x: mx(30) }, 0.45);
  fadeOut('#s5', 35.5, 0.35);

  // S6 35.8-43.0 MS: cause, arrow, effect, over a blurred console
  tl.to('#blurc', { opacity: 0.5, duration: 0.5 }, 35.8);
  tl.set('#pair', { opacity: 1 }, 35.85);
  pop('#bc1', 35.9, { x: mx(-40) }, 0.5);
  stroke('#arw', 36.6, 0.6, 330, 'power2.out');
  pop('#bc2', 37.1, { x: mx(40) }, 0.5);
  key(36.4, 960, 465, 0.55, 0.9);

  // S7 43.0-49.6 WS: hand it over; truck with the pair toward the developer
  fadeOut('#blurc', 43.0, 0.5);
  // the developer's card arrives from the inline end and takes the pair into its top half (MS, centre third)
  tl.fromTo('#dev', { opacity: 0, x: mx(520) }, { opacity: 1, x: 0, duration: 0.9, ease: E.io, immediateRender: false }, 43.1);
  tl.to('#pair', { x: mx(60), y: -232, scale: 0.42, duration: 1.1, ease: E.io, transformOrigin: '50% 50%' }, 43.4);
  tl.to('#pair', { x: 0, duration: 0.5, ease: E.io }, 44.5);
  key(44.2, 960, 420, 0.5, 0.8);
  cursorAt(45.0, 1500, 860);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 45.0);
  cursorTo(45.2, 960 + 264 - 34, 668, 0.8);          // C5: past the label, inside the button's inline-end edge
  push('#rpl', 46.2); press(46.2, 960 + 264 - 34, 668);
  tl.to('#bc1, #bc2', { borderColor: 'rgba(123,211,137,.7)', duration: 0.4 }, 46.5);
  tl.fromTo('#okc', { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)', immediateRender: false, transformOrigin: '50% 50%' }, 46.45);
  tl.to('#glowA', { x: X(1196) - 450, y: 210 - 450, opacity: 0.6, duration: 0.5, ease: E.out }, 46.45);
  fadeOut('#cursor', 47.3);
  fadeOut('#main', 49.25, 0.4);

  // S8 49.8-52 end card
  camSet(49.7, { s: 1 });
  endCard(49.8);
