/* QA-Wrap site motion: one authored moment and one echo of it.
   1. The report window writes itself: the steps type in, step 3 is hit, the trace line
      drops, the failure lands, the badges pop. Once, on arrival.
   2. How it works: as the three steps scroll in, the connector between them traces in the
      accent colour, the same "trace" the hero just showed.
   site.js loads this after the page has loaded and only when the reader has not asked for
   reduced motion (html.motion). GSAP 3 and ScrollTrigger are served from assets/vendor, so
   the page makes no third-party request. Without this file every element is already in its
   final state; a CSS fallback reveals the hero after 2.6 s if this file never runs. */
(function () {
  'use strict';
  var root = document.documentElement;
  var gsap = window.gsap;
  if (!gsap || !root.classList.contains('motion')) return;

  // The CSS fallback reveals the hero at 2.6 s. If we arrive after it, the reader has
  // already seen the final frame: do not hide it again just to replay it.
  var late = (window.performance && performance.now() > 2300);

  if (!late) {
    document.querySelectorAll('.rw').forEach(function (rw) {
      var steps = rw.querySelectorAll('.rw-steps li');
      var hit = rw.querySelector('.rw-steps li.hit');
      var line = rw.querySelector('.rw-line');
      var fail = rw.querySelector('.rw-fail');
      var pops = rw.querySelectorAll('.rw-badge, .rw-conf');
      if (!steps.length || !hit || !line || !fail) return;
      var rtl = !!rw.closest('[dir="rtl"]');
      var hitStyle = window.getComputedStyle(hit);
      var hitBorder = hitStyle.borderTopColor;
      var hitColor = hitStyle.color;
      var restColor = window.getComputedStyle(steps[0]).color;

      rw.classList.add('rw-live'); // switches the CSS fallback off for this window
      var tl = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.2 });
      tl.fromTo(steps,
        { autoAlpha: 0, y: 8, clipPath: rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' },
        { autoAlpha: 1, y: 0, clipPath: 'inset(0 0% 0 0%)', duration: 0.6, stagger: 0.3, clearProps: 'clipPath,transform' })
        .fromTo(hit,
          { borderColor: 'rgba(255, 138, 110, 0)', color: restColor },
          { borderColor: hitBorder, color: hitColor, duration: 0.35, ease: 'power2.out', clearProps: 'borderColor,color' }, '+=0.05')
        .fromTo(hit, { scale: 1 }, { scale: 1.025, duration: 0.16, yoyo: true, repeat: 1, ease: 'power1.inOut', clearProps: 'transform' }, '<')
        .fromTo(line, { autoAlpha: 1, scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: 'power2.inOut', clearProps: 'transform' })
        .fromTo(fail, { autoAlpha: 0, y: 14, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, clearProps: 'transform' }, '-=0.08')
        .fromTo(pops, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(2.2)', stagger: 0.12, clearProps: 'transform' }, '-=0.35');
    });
  }

  var ST = window.ScrollTrigger;
  if (!ST) return;
  gsap.registerPlugin(ST);
  document.querySelectorAll('.steps').forEach(function (ol) {
    var items = Array.prototype.filter.call(ol.children, function (li) { return li.tagName === 'LI'; });
    if (!items.length) return;
    gsap.set(items, { '--trace': 0 });
    var tl = gsap.timeline({ scrollTrigger: { trigger: ol, start: 'top 78%', once: true } });
    items.forEach(function (li, i) {
      var ico = li.querySelector('.step-ico');
      if (ico) tl.fromTo(ico, { scale: 0.82 }, { scale: 1, duration: 0.5, ease: 'back.out(2)', clearProps: 'transform' }, i * 0.45);
      tl.to(li, { '--trace': 1, duration: 0.55, ease: 'power2.inOut' }, i * 0.45 + 0.2);
    });
  });
  // The language toggle swaps which block is visible; re-measure so the other block's trigger is right.
  var lt = document.getElementById('lang-toggle');
  if (lt) lt.addEventListener('click', function () { window.requestAnimationFrame(function () { ST.refresh(); }); });
})();
