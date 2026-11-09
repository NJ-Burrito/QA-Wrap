  // ===== export-and-seal: timeline =====
  const S = RTL ? -1 : 1;                 // screen direction: AR mirrors travel
  cursorAt(0, 1560, 760);
  gsap.set('#sheen', { rotation: 20 });
  gsap.set('#s1', { opacity: 1 });
  gsap.set('#wline', { scaleX: 0 });

  // S1 0-7: the saved session, More, Timeline (sealed)
  act(6.4);                    // warm until the file comes out of the tool, green after
  key(0.6, 1320, 470, 0.6); key(6.2, 960, 400, 0, 0.6);
  tl.fromTo('#s1', { scale: 1.0 }, { scale: 1.03, duration: 7.2, ease: 'none', immediateRender: false, transformOrigin: '50% 50%' }, 0);
  tl.to('#cursor', { opacity: 1, duration: 0.25 }, 0.9);
  cursorTo(1.1, 1462, 348, 0.8);
  tl.to('#morebtn', { scale: 0.96, borderColor: 'rgba(226,174,56,.7)', duration: 0.15, ease: 'power1.in', transformOrigin: '50% 50%' }, 1.95);
  press(2.1, 1462, 348);
  tl.to('#morebtn', { scale: 1, duration: 0.2, ease: E.out }, 2.2);
  tl.fromTo('#menu', { opacity: 0, y: -14, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: E.back, immediateRender: false, transformOrigin: '50% 0%' }, 2.35);
  cursorTo(3.4, 1470, 605, 0.8);
  tl.to('#mi', { backgroundColor: 'rgba(226,174,56,.22)', duration: 0.2 }, 4.1);
  press(4.5, 1470, 605);
  tl.to('#mi', { backgroundColor: 'rgba(226,174,56,.5)', duration: 0.12, yoyo: true, repeat: 1 }, 4.5);
  fadeOut('#cursor', 5.4);
  tl.to('#s1', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 6.8);

  // S2 7-14: the file slides out of the popup and unfolds; events write in order (green: the tool has acted)
  tl.set('#docwrap', { opacity: 1 }, 6.0);
  tl.fromTo('#doc', { x: 360 * S, y: 40, scale: 0.12, opacity: 0 }, { x: 0, y: 0, scale: 1, opacity: 1, duration: 1.5, ease: E.io, immediateRender: false, transformOrigin: '50% 50%' }, 6.1);
  tl.set('#doc', { opacity: 0 }, 0);
  fadeIn('#dh', 7.9, { y: 12 }, 0.4);
  tl.set('#dh', { opacity: 0 }, 0);
  tl.set('.erow', { opacity: 0 }, 0);
  tl.fromTo('.erow', { opacity: 0, x: -24 * S }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.42, ease: E.out, immediateRender: false }, 8.8);
  tl.set('#prow', { opacity: 0 }, 0);

  // S3 14-21: close on the head; her name types in an amber band
  tl.to('#doc', { height: 280, scale: 1.6, duration: 1.1, ease: E.io, transformOrigin: '50% 0%' }, 13.9); // crop to the head, 68 % of the width
  tl.to('.erow', { opacity: 0, duration: 0.5, ease: 'power1.in' }, 13.9); // the CU isolates the head
  fadeIn('#prow', 14.9, {}, 0.25);
  type('#pband', 15.2, 1.3);
  pop('#pav', 16.7, { y: 0, scale: 0.4 }, 0.45);
  tl.set('#pav', { opacity: 0 }, 0);
  tl.fromTo('#pband', { boxShadow: '0 0 0 0 rgba(226,174,56,0)' }, { boxShadow: '0 0 0 10px rgba(226,174,56,.15)', duration: 0.6, yoyo: true, repeat: 1, ease: 'sine.inOut', immediateRender: false }, 17.6);
  tl.to('#doc', { height: 700, scale: 1, duration: 1.0, ease: E.io }, 20.2);
  tl.to('.erow:nth-of-type(n+7)', { opacity: 1, duration: 0.4 }, 21.6); // rows 4-6 return as the page scrolls; 1-3 stay gone

  // S4 21-29: scroll to the end; the seal slams down; its rows list name, date, fingerprint, signature
  tl.to('#docin', { y: -440, duration: 1.5, ease: E.io }, 21.2);
  tl.fromTo('#sealblk', { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'power4.in', immediateRender: false, transformOrigin: '50% 50%' }, 22.9);
  tl.fromTo('#doc', { y: 0 }, { y: 8, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out', immediateRender: false }, 23.35);
  tl.set('.sr', { opacity: 0 }, 0);
  tl.fromTo('.sr', { opacity: 0, x: -16 * S }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.75, ease: E.out, immediateRender: false }, 23.9);
  tl.fromTo('#sigbars i', { scaleX: 0 }, { scaleX: 1, duration: 0.6, stagger: 0.12, ease: 'none', immediateRender: false, transformOrigin: RTL ? '100% 50%' : '0% 50%' }, 27.0);
  pop('#sck', 27.7, { y: 0, scale: 0.3 }, 0.45);
  tl.set('#sck', { opacity: 0 }, 0);

  // S5 29-36: push in on one row; a pencil changes one word; the seal's check flips to a coral cross
  tl.to('#doc', { scale: 1.2, duration: 1.0, ease: E.io, transformOrigin: RTL ? '65% 10%' : '35% 10%' }, 29.0); // bottom stays above the caption band
  const wx = RTL ? 1005 : 915, wy = 187;
  tl.set('#pencil', { x: wx - 15 + 140 * S, y: wy - 71 - 150 }, 29.5);
  tl.to('#pencil', { opacity: 1, duration: 0.25 }, 29.6);
  tl.to('#pencil', { keyframes: [{ x: wx - 15 + 60 * S, y: wy - 71 - 120, duration: 0.35 }, { x: wx - 15, y: wy - 71, duration: 0.45 }], ease: 'sine.inOut' }, 29.7);
  tl.to('#pencil', { x: '+=' + 22 * S, y: '-=4', duration: 0.12, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 30.6);
  tl.to('#wline', { scaleX: 1, duration: 0.35, ease: 'none', transformOrigin: RTL ? '100% 50%' : '0% 50%' }, 30.65);
  fadeOut('#wold', 31.15, 0.2);
  tl.fromTo('#wnew', { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.3, ease: E.back, immediateRender: false }, 31.3);
  fadeOut('#wline', 31.3, 0.15);
  tl.to('#pencil', { opacity: 0, y: '-=60', duration: 0.4, ease: E.in }, 31.9);
  tl.to('#glowW', { opacity: 0.85, duration: 0.8, ease: 'sine.inOut' }, 31.8); tl.to('#glowG', { opacity: 0.2, duration: 0.8, ease: 'sine.inOut' }, 31.8); // the warm light returns with the tamper
  tl.to('#glowW', { opacity: 0, duration: 0.8, ease: 'sine.inOut' }, 35.6); tl.to('#glowG', { opacity: 0.9, duration: 0.8, ease: 'sine.inOut' }, 35.6);
  tl.to('#sck', { rotationY: 90, opacity: 0, duration: 0.18, ease: 'power2.in' }, 32.5);
  tl.fromTo('#scx', { opacity: 0, rotationY: -90, scale: 1 }, { opacity: 1, rotationY: 0, duration: 0.3, ease: E.back, immediateRender: false }, 32.68);
  tl.to('#sealblk', { borderColor: 'rgba(255,146,112,.75)', backgroundColor: 'rgba(255,146,112,.08)', duration: 0.3 }, 32.68);
  tl.to('#sigbars i', { backgroundColor: '#8a4a3d', duration: 0.3 }, 32.8);
  tl.to('#docwrap', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 35.5);

  // S6 36-44: Settings > Sessions > Verify a sealed file; two verdicts side by side
  scene('#s6', 36.0, 43.8, { from: { scale: 1.06 }, to: { scale: 1.0 } }); // pull-out to fit both cards
  cursorAt(36.4, 760, 820);
  tl.to('#cursor', { opacity: 1, duration: 0.2 }, 36.5);
  cursorTo(36.7, 548, 498, 0.8);
  tl.to('#vbtn', { scale: 0.96, duration: 0.15, ease: 'power1.in', transformOrigin: '50% 50%' }, 37.65);
  press(37.8, 548, 498);
  tl.to('#vbtn', { scale: 1, duration: 0.2, ease: E.out }, 37.9);
  fadeOut('#cursor', 38.6);
  tl.fromTo('#vok', { opacity: 0, x: -40 * S, scale: 0.9 }, { opacity: 1, x: 0, scale: 1, duration: 0.5, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, 38.4);
  tl.fromTo('#vbad', { opacity: 0, x: -40 * S, scale: 0.9 }, { opacity: 1, x: 0, scale: 1, duration: 0.5, ease: E.back, immediateRender: false, transformOrigin: '50% 50%' }, 40.1);
  tl.fromTo('#vbad', { x: 0 }, { x: 8, duration: 0.06, yoyo: true, repeat: 3, ease: 'none', immediateRender: false }, 40.65);

  // S7 44-51: the same file, intact, under clear glass; the honest line
  tl.set('#wold', { opacity: 1 }, 43.9); tl.set('#wnew', { opacity: 0 }, 43.9);
  tl.set('#sck', { opacity: 1, rotationY: 0 }, 43.9); tl.set('#scx', { opacity: 0 }, 43.9);
  tl.set('#sealblk', { borderColor: 'rgba(126,208,138,.55)', backgroundColor: 'rgba(126,208,138,.06)' }, 43.9);
  tl.set('#sigbars i', { backgroundColor: '#4c535b' }, 43.9);
  tl.set('#docin', { y: -440 }, 43.9); // rows 4-6 and the whole seal
  tl.set('#doc', { scale: 0.74, y: 70, transformOrigin: '50% 50%' }, 43.9);
  tl.to('#docwrap', { opacity: 1, duration: 0.5, ease: 'power1.out' }, 44.0);
  tl.to('#plate', { opacity: 1, duration: 0.6, ease: 'sine.out' }, 44.5);
  tl.fromTo('#sheen', { x: 0 }, { x: 1500, duration: 1.8, ease: E.io, immediateRender: false }, 45.2);
  fadeIn('#honest', 45.6, { y: 16 }, 0.5);
  fadeOut('#honest', 50.6, 0.35);
  tl.to('#docwrap', { opacity: 0, duration: 0.4, ease: 'power1.in' }, 50.7);

  // end card 51-54
  endCard(51.0);
