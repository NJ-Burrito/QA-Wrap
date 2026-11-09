  // ===== kpi-dashboard: timeline =====
  const S = RTL ? -1 : 1;
  const MX = (x) => (RTL ? 1920 - x : x);
  const CLIP0 = RTL ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
  const wipe = (sel, at, dur) => tl.fromTo(sel, { clipPath: CLIP0 }, { clipPath: 'inset(0% 0% 0% 0%)', duration: dur, ease: 'none', immediateRender: false }, at);
  /** An odometer: the column rolls up to its last value. */
  const roll = (sel, n, at, dur = 1.0) => tl.fromTo(sel, { y: 0 }, { y: -(n - 1) * 110, duration: dur, ease: 'power2.out', immediateRender: false }, at);
  cursorAt(0, 1500, 820);
  gsap.set('#s1', { opacity: 1 });
  gsap.set('#frame', { rotationX: 18, transformPerspective: 1800, transformOrigin: '50% 100%' });
  gsap.set('#grid', { rotationX: 34, transformPerspective: 1600, transformOrigin: '50% 0%' });
  gsap.set('#lede', { clipPath: CLIP0 });

  // S1 0-7: sessions fall on arcs into an empty frame and become its first bars (cards become data)
  act(8.6);                    // warm while sessions pile up, green when the dashboard opens
  key(0.4, 960, 450, 0.6); key(6.6, 960, 450, 0, 0.6);
  tl.fromTo('#frame', { scale: 0.97 }, { scale: 1.0, duration: 7.0, ease: 'none', immediateRender: false }, 0);
  tl.set('#fb1, #fb2, #fb3', { scaleY: 0, transformOrigin: '50% 100%' }, 0);
  const fbl = document.querySelectorAll('.fbl');
  [['#sc1', 0.0, -760, '#fb1', fbl[0]], ['#sc2', 1.7, 0, '#fb2', fbl[1]], ['#sc3', 2.9, 760, '#fb3', fbl[2]]].forEach(([c, a, dx, b, lbl]) => {
    const tx = 960 - 210 + (dx * S) * 0.42, ty = 470;
    tl.set(c, a < 0.5 ? { x: 960 - 210 + dx * S * 0.75, y: 30, rotation: -8 * S } : { x: 960 - 210 + dx * S, y: -260, rotation: 10 * S * Math.sign(dx || 1) }, 0);
    if (a < 0.5) gsap.set(c, { opacity: 1 }); else tl.to(c, { opacity: 1, duration: 0.2 }, a);
    tl.to(c, { keyframes: [{ x: (960 - 210 + dx * S * (a < 0.5 ? 0.75 : 1) + tx) / 2, y: 120, rotation: 4 * S, duration: 0.55, ease: 'sine.out' }, { x: tx, y: ty, rotation: 0, duration: 0.55, ease: 'power2.in' }] }, a);
    tl.to(c, { scaleX: 0.35, scaleY: 0.1, y: ty + 140, opacity: 0, duration: 0.45, ease: 'power2.in', transformOrigin: '50% 100%' }, a + 1.25);
    tl.to(b, { scaleY: 1, duration: 0.5, ease: E.back }, a + 1.55);
    tl.to(lbl, { opacity: 1, duration: 0.3 }, a + 1.45); // the name lands with its data
  });
  tl.to('#s1', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 6.8);

  // S2 7-14.4: Settings > Performance indicators > Open the dashboard; the head lights; the lede writes (green: the tool acts)
  scene('#s2', 6.9, 14.5, { from: { scale: 1.0 }, to: { scale: 1.02 } });
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 7.3);
  cursorTo(7.5, 420, 471, 0.8);
  tl.to('#openl', { backgroundColor: 'rgba(226,174,56,.3)', duration: 0.15 }, 8.25);
  press(8.4, 420, 471);
  fadeOut('#cursor', 8.9);
  tl.to('#setc', { opacity: 0.35, x: -40 * S, scale: 0.94, duration: 0.6, ease: E.io }, 8.8);
  fadeIn('#eb', 9.0, { y: 10 }, 0.35);
  fadeIn('#dt', 9.3, { y: 16 }, 0.45);
  wipe('#lede', 10.2, 2.6);

  // S3 14.4-22: time per day, bars grow one by one, split by site; Group by flips to Week
  scene('#s3', 14.4, 22.0, { from: { scale: 1.0 }, to: { scale: 1.015 } });
  tl.set('#bday .kbar, #bweek .kbar', { scaleY: 0, transformOrigin: '50% 100%' }, 0);
  tl.to('#bday .kbar', { scaleY: 1, duration: 0.5, stagger: 0.22, ease: E.out }, 14.9);
  tl.fromTo('#s3 .lg', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.15, ease: E.out, immediateRender: false }, 16.6);
  cursorAt(17.2, 1500, 520);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 17.3);
  cursorTo(17.4, 1642, 140, 0.8);
  press(18.4, 1642, 140);
  tl.to('#knob', { x: 136 * S, duration: 0.35, ease: E.back }, 18.45);
  tl.to('#sgd', { color: '#F1EFE9', duration: 0.2 }, 18.5);
  tl.to('#sgw', { color: '#1D2024', duration: 0.2 }, 18.5);
  fadeOut('#tday', 18.5, 0.2); fadeIn('#tweek', 18.7, {}, 0.25);
  tl.to('#bday .kbar', { scaleY: 0, duration: 0.35, stagger: 0.04, ease: E.in }, 18.5);
  tl.to('#bweek .kbar', { scaleY: 1, duration: 0.6, stagger: 0.2, ease: E.back }, 18.9);
  fadeOut('#cursor', 19.4);

  // S4 22-30: coverage from above; tested squares fill amber; the ring counts to 9 of 14
  scene('#s4', 22.0, 30.0, { from: { scale: 1.02 }, to: { scale: 1.0 } });
  const sqs = document.querySelectorAll('#grid .sq');
  [0, 1, 2, 4, 7, 8, 9, 11, 12].forEach((k, i) => tl.to(sqs[k], { backgroundColor: '#E2AE38', borderColor: '#E2AE38', duration: 0.25, ease: E.out }, 23.2 + i * 0.42));
  tl.fromTo('#ring', { attr: { 'stroke-dashoffset': 848.2 } }, { attr: { 'stroke-dashoffset': 848.2 * (1 - 9 / 14) }, duration: 3.8, ease: 'none', immediateRender: false }, 23.2);
  tl.fromTo('#covodo', { y: 0 }, { y: -9 * 110, duration: 3.8, ease: 'steps(9)', immediateRender: false }, 23.2);

  // S5 30-37: bugs filed per day; coral flags land; console and request markers drift past and fall away
  scene('#s5', 30.0, 37.0, { from: { scale: 1.0 }, to: { scale: 1.015 } });
  ['#f1', '#f2', '#f3', '#f4', '#f5'].forEach((f, i) => tl.fromTo(f, { opacity: 0, y: -90, scale: 1.3 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power4.in', immediateRender: false }, 30.6 + i * 0.5));
  [['#m1', 32.2], ['#m2', 33.0], ['#m3', 33.8]].forEach(([m, a]) => {
    tl.fromTo(m, { x: 0 }, { x: -560 * S, duration: 1.4, ease: 'none', immediateRender: false }, a);
    tl.fromTo(m, { opacity: 0 }, { opacity: 0.85, duration: 0.2, immediateRender: false }, a);
    tl.to(m, { y: 260, rotation: -14 * S, opacity: 0, duration: 0.6, ease: 'power2.in' }, a + 1.4);
  });
  fadeIn('#bnote', 31.4, { y: 12 }, 0.4);

  // S6 37-44: the tiles; numbers roll; Average session is the focal tile
  scene('#s6', 37.0, 44.0, { from: { scale: 1.0 }, to: { scale: 1.02 } });
  tl.fromTo('.tileK', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.2, ease: E.back, immediateRender: false }, 37.3);
  roll('#o1', 3, 37.6); roll('#o2', 3, 38.4, 1.2); roll('#o3', 3, 38.2); roll('#o4', 3, 38.4);
  tl.to('#k2', { scale: 1.08, y: -16, duration: 0.5, ease: E.back, transformOrigin: '50% 50%' }, 40.6);

  // S7 44-51: Export as PDF; the page assembles; push in on the trace line at its foot
  scene('#s7', 44.0, 50.8, { from: { scale: 1.0 }, to: { scale: 1.0 } });
  cursorAt(44.0, 700, 700);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 44.1);
  cursorTo(44.2, 462, 368, 0.7);
  tl.to('#pdfb', { scale: 0.95, duration: 0.12, ease: 'power1.in', transformOrigin: '50% 50%' }, 44.85);
  press(45.0, 462, 368);
  tl.to('#pdfb', { scale: 1, duration: 0.2, ease: E.out }, 45.1);
  fadeOut('#cursor', 45.5);
  tl.fromTo('#pg', { opacity: 0, y: 60, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, 45.3);
  tl.fromTo('#pg .pb', { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.2, ease: E.out, immediateRender: false }, 45.8);
  fadeIn('#trace', 46.8, {}, 0.3);
  tl.to('#pdfb', { opacity: 0.3, duration: 0.5 }, 46.6);
  tl.to('#pg', { scale: 1.75, duration: 1.4, ease: E.io, transformOrigin: RTL ? '72% 97%' : '28% 97%' }, 47.4);

  // end card 51-54
  endCard(51.0);
