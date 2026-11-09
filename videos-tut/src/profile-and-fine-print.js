  // ===== profile-and-fine-print: timeline =====
  const S = RTL ? -1 : 1;
  const MX = (x) => (RTL ? 1920 - x : x);
  /** Write text in reading order: a clip opens from the inline start (seek-safe, no width measuring). */
  const CLIP0 = RTL ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
  const wipe = (sel, at, dur) => tl.fromTo(sel, { clipPath: CLIP0 }, { clipPath: 'inset(0% 0% 0% 0%)', duration: dur, ease: `steps(${Math.max(6, Math.round(dur * 16))})`, immediateRender: false }, at);
  cursorAt(0, 1400, 760);
  gsap.set('#s1', { opacity: 1 });
  document.querySelectorAll('#stack .paper').forEach((p) => gsap.set(p, { rotationX: 48, rotationZ: +(p.dataset.rz || 3) * S, transformPerspective: 1600, transformOrigin: '50% 50%' }));
  gsap.set('#ntyped', { clipPath: CLIP0 });
  gsap.set('.fw', { clipPath: CLIP0 });

  // S1 0-6.4: unsigned work seen from above, warm light; one page lifts and shows the empty name slot
  act(19.8);                   // warm over unsigned work, green once every export carries her line
  tl.to('#stack', { y: -30, x: 20 * S, duration: 6.6, ease: 'sine.inOut' }, 0);
  document.querySelectorAll('#stack .pg').forEach((p, i) => tl.to(p, { y: (i % 2 ? 18 : -14), rotationZ: '+=' + (i % 2 ? 3 : -3) * S, duration: 6.0, ease: 'sine.inOut' }, 0.1 * i));
  tl.to('#p1', { rotationX: 6, rotationZ: 0, scale: 1.18, y: -40, duration: 1.7, ease: E.io }, 1.8);
  tl.to('#stack .pg', { opacity: 0.45, duration: 1.2 }, 2.2);
  tl.fromTo('#slot', { scale: 1 }, { scale: 1.08, duration: 0.35, yoyo: true, repeat: 3, ease: 'sine.inOut', immediateRender: false, transformOrigin: '50% 50%' }, 3.7);
  tl.to('#s1', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 6.4);

  // S2 7-13.2: Settings > Sessions; her name typed once; the initials circle fills
  scene('#s2', 6.9, 13.3, { from: { scale: 1.0 }, to: { scale: 1.02 } });
  key(7.0, 650, 470, 0.7); key(13.2, 960, 400, 0.7, 1.0); key(19.4, 960, 400, 0, 0.6);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 7.5);
  cursorTo(7.7, 860, 472, 0.8);
  press(8.6, 860, 472);
  tl.to('#nfield', { borderColor: 'rgba(226,174,56,.7)', duration: 0.2 }, 8.65);
  fadeOut('#cursor', 9.0);
  wipe('#ntyped', 9.1, 1.5);
  tl.to('#caret', { opacity: 0, duration: 0.01, yoyo: true, repeat: 7, repeatDelay: 0.4 }, 10.7);
  tl.set('#av', { x: MX(1145) - 75, y: 475 - 75, scale: 1 }, 0);
  tl.fromTo('#av', { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.5, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, 10.9);

  // S3 13.8-19.4: the circle grows to centre (graphic match); a picture flies in on an arc and settles
  tl.to('#av', { x: 960 - 75, y: 400 - 75, scale: 2.2, duration: 1.0, ease: E.io }, 13.2);
  scene('#s3', 13.9, 19.4, { from: { scale: 1.0 }, to: { scale: 1.0 } });
  cursorAt(14.0, 1350, 860);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 14.1);
  cursorTo(14.2, 1092, 678, 0.7);
  press(15.0, 1092, 678);
  tl.to('#choose', { scale: 0.96, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.inOut', transformOrigin: '50% 50%' }, 15.0);
  fadeOut('#cursor', 15.5);
  tl.set('#tile', { x: MX(1700) - 100, y: 170, rotation: 12 * S, scale: 1 }, 0);
  tl.to('#tile', { opacity: 1, duration: 0.2 }, 15.3);
  tl.to('#tile', { keyframes: [{ x: MX(1360) - 100, y: 70, rotation: 6 * S, duration: 0.5, ease: 'sine.out' }, { x: 960 - 100, y: 400 - 100, rotation: 0, scale: 0.8, duration: 0.6, ease: 'power2.in' }] }, 15.4);
  tl.to('#tile', { opacity: 0, duration: 0.1 }, 16.5);
  tl.to('#avpic', { opacity: 1, duration: 0.12 }, 16.48);
  tl.to('#avini', { opacity: 0, duration: 0.12 }, 16.48);
  tl.to('#av', { keyframes: [{ scale: 2.36, duration: 0.14, ease: 'power2.out' }, { scale: 2.2, duration: 0.4, ease: E.back }] }, 16.5);
  pop('#picsaved', 17.2, { y: 12 }, 0.4);
  tl.to('#av', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 19.2);

  // S4 20-27.2: three exports arrive on arcs; the fine-print line writes itself at each foot (green: the tool acts)
  tl.fromTo('#s4', { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power1.out', immediateRender: false }, 19.8);
  tl.to('#s4', { opacity: 0, duration: 0.35, ease: 'power1.in' }, 27.4);
  ['#ex1', '#ex2', '#ex3'].forEach((id, i) => {
    const a = 20.1 + i * 0.45;
    tl.fromTo(id, { opacity: 0, x: -520 * S, y: 260, rotation: -10 * S }, { opacity: 1, keyframes: [{ x: -220 * S, y: -70, rotation: -4 * S, duration: 0.45, ease: 'sine.out' }, { x: 0, y: 0, rotation: 0, duration: 0.5, ease: E.back }], immediateRender: false }, a);
    wipe(`${id} .fw`, 22.3 + i * 1.1, 0.9);
    tl.fromTo(`${id} .foot`, { backgroundColor: 'rgba(226,174,56,0)' }, { backgroundColor: 'rgba(226,174,56,.25)', duration: 0.3, yoyo: true, repeat: 1, immediateRender: false }, 22.3 + i * 1.1);
  });
  tl.to('#s4', { scale: 2.4, duration: 0.9, ease: 'power2.in', transformOrigin: '50% 60%' }, 26.7); // push into the middle foot line

  // S5 27.8-35.2: one fine-print line, big; a highlight walks name, date, version
  scene('#s5', 27.5, 35.3, { from: { scale: 0.94 }, to: { scale: 1.0 } });
  tl.fromTo('#h1', { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, 28.4);
  tl.to('#h1', { opacity: 0, duration: 0.25 }, 30.4);
  tl.fromTo('#h2', { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, 30.5);
  tl.to('#h2', { opacity: 0, duration: 0.25 }, 32.2);
  tl.fromTo('#h3', { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, 32.3);
  tl.fromTo('#bigrule', { scaleX: 0 }, { scaleX: 1, duration: 1.0, ease: 'none', immediateRender: false, transformOrigin: RTL ? '100% 50%' : '0% 50%' }, 27.8);

  // S6 35.8-42.4: low angle, the avatar above; amber threads draw from every document to her
  scene('#s6', 35.5, 42.8, { from: { scale: 1.08 }, to: { scale: 1.0 } });
  tl.set('#av', { x: 960 - 75, y: 250 - 75, scale: 1.6, opacity: 0 }, 35.4);
  tl.fromTo('#av', { opacity: 0, scale: 1.1 }, { opacity: 1, scale: 1.6, duration: 0.55, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, 35.8);
  tl.fromTo('#s6 .md', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.15, ease: E.out, immediateRender: false }, 35.9);
  ['#t1', '#t2', '#t3'].forEach((t, i) => {
    tl.set(t, { attr: { 'stroke-dasharray': 600, 'stroke-dashoffset': 600 } }, 0);
    tl.to(t, { attr: { 'stroke-dashoffset': 0 }, duration: 0.8, ease: E.io }, 36.6 + i * 0.35);
  });
  pop('#avname', 38.4, { y: 10 }, 0.45);
  tl.to('#av', { opacity: 0, duration: 0.35 }, 42.6);

  // end card 43-46
  endCard(42.9);
