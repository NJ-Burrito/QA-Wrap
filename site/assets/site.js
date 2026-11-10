/* QA Wrap site — the language toggle, and nothing else.
   Every page carries an English block and an Arabic block for the same
   content (assets/site.css hides the one `data-lang` on <body> does not
   name). This file flips that one attribute, keeps <html lang>/<dir> in
   step so the browser and any assistive tech agree with what is on screen,
   and remembers the choice in localStorage for the next page. No network
   request, no analytics, nothing else on the page depends on this running
   (the home page's motion, below, loads two local files and nothing remote):
   with JavaScript off, `data-lang="en"` from the markup below still shows
   the English block. */
(function () {
  'use strict';
  var KEY = 'qaw-site-lang';
  var body = document.body;

  function apply(lang) {
    var l = lang === 'ar' ? 'ar' : 'en';
    body.setAttribute('data-lang', l);
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
  }

  var saved = null;
  try { saved = window.localStorage.getItem(KEY); } catch (err) { /* private mode, or blocked */ }
  apply(saved);

  var THEME_KEY = 'qaw-site-theme';
  var root = document.documentElement;
  var tbtn = document.getElementById('theme-toggle');
  if (tbtn) {
    tbtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch (err) { /* private mode, or blocked */ }
    });
  }

  /* The screens gallery: the arrow buttons scroll one slide, in reading direction. */
  document.querySelectorAll('.gallery-ctl button').forEach(function (b) {
    b.addEventListener('click', function () {
      var wrap = b.parentNode.nextElementSibling;
      if (!wrap) return;
      var slide = wrap.querySelector('figure');
      var step = (slide ? slide.getBoundingClientRect().width : 400) + 16;
      var dir = window.getComputedStyle(wrap).direction === 'rtl' ? -1 : 1;
      wrap.scrollBy({ left: Number(b.getAttribute('data-gal')) * step * dir, behavior: 'smooth' });
    });
  });

  var btn = document.getElementById('lang-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var next = body.getAttribute('data-lang') === 'ar' ? 'en' : 'ar';
      apply(next);
      try { window.localStorage.setItem(KEY, next); } catch (err) { /* private mode, or blocked */ }
    });
  }
})();

/* The 40-second film sections show at once with their poster; a HEAD check (no body is fetched) hides them only if the file is missing. */
(function () {
  var films = document.querySelectorAll('.film');
  if (!films.length || !window.fetch) return;
  fetch('media/qa-wrap-commercial-40s.mp4', { method: 'HEAD' }).then(function (r) {
    if (!r.ok) films.forEach(function (f) { f.hidden = true; });
  }).catch(function () { /* a network error says nothing about the file: keep the poster */ });
})();

/* The animated banner is 4 MB: it is fetched only when its slide is about to be seen. */
(function () {
  var imgs = document.querySelectorAll('img[data-src]');
  function load(i) { i.src = i.getAttribute('data-src'); i.removeAttribute('data-src'); }
  if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { load(e.target); io.unobserve(e.target); } });
  }, { rootMargin: '200px' });
  imgs.forEach(function (i) { io.observe(i); });
})();

/* Motion (home page only): GSAP from assets/vendor and assets/motion.js, fetched after the page
   has loaded and when the browser is idle, never when the reader asked for reduced motion
   (the inline head script sets html.motion only then). Every element is visible without it. */
(function () {
  if (!document.documentElement.classList.contains('motion') || !document.querySelector('.rw')) return;
  function add(src, done) { var s = document.createElement('script'); s.src = src; if (done) s.onload = done; document.head.appendChild(s); }
  function go() { add('assets/vendor/gsap.min.js', function () { add('assets/vendor/ScrollTrigger.min.js', function () { add('assets/motion.js'); }); }); }
  function idle() { (window.requestIdleCallback || function (f) { setTimeout(f, 1); })(go, { timeout: 700 }); }
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle);
})();

/* Films stay on the page. Every link to an .mp4 opens one native <dialog> with the film in it; the href is kept, so
   without JavaScript (or with a modifier key) the link still opens the file. The video element is built on a press
   and removed on close, so nothing is fetched before one. The commercial's own player (#film) loses its controls at
   load and gets a big play button; a press anywhere on the frame adds the controls back and plays. */
(function () {
  'use strict';
  var T = { en: { close: 'Close', play: 'Play the film', film: 'Film' }, ar: { close: 'إغلاق', play: 'شغّل الفيلم', film: 'فيلم' } };
  function lang(el) { var l = el.closest('[lang]'); return l && l.lang === 'ar' ? 'ar' : 'en'; }

  /* In-page player. */
  var dlg, holder, opener;
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'vdlg';
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'vdlg-x';
    x.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    x.addEventListener('click', function () { dlg.close(); });
    holder = document.createElement('div');
    holder.className = 'vdlg-body';
    dlg.appendChild(x); dlg.appendChild(holder);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); /* the backdrop is the dialog itself */
    dlg.addEventListener('close', function () {
      var v = holder.querySelector('video');
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
      holder.textContent = '';
      if (opener && document.contains(opener)) opener.focus();
      opener = null;
    });
    document.body.appendChild(dlg);
  }
  function open(a) {
    if (!dlg) build();
    var L = T[lang(a)];
    var card = a.closest('li');
    var h = card && card.querySelector('h3');
    var img = card && card.querySelector('img');
    var v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.setAttribute('playsinline', '');
    if (img) v.poster = img.getAttribute('src');
    v.src = a.getAttribute('href');
    holder.textContent = '';
    holder.appendChild(v);
    dlg.setAttribute('aria-label', h ? h.textContent : L.film);
    dlg.querySelector('.vdlg-x').setAttribute('aria-label', L.close);
    opener = a;
    dlg.showModal();
    var p = v.play(); if (p && p.catch) p.catch(function () { /* the controls are there to press */ });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href$=".mp4"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof HTMLDialogElement !== 'function' || !HTMLDialogElement.prototype.showModal) return;
    e.preventDefault();
    open(a);
  });

  /* Click anywhere on the commercial to play. */
  document.querySelectorAll('.film-box video').forEach(function (v) {
    var box = v.parentNode;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'film-play';
    b.setAttribute('aria-label', T[lang(v)].play);
    b.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-play"/></svg>';
    box.appendChild(b);
    v.removeAttribute('controls');
    function start() {
      box.removeEventListener('click', start);
      v.controls = true; b.hidden = true;
      var p = v.play(); if (p && p.catch) p.catch(function () { /* the controls are there to press */ });
      v.focus();
    }
    box.addEventListener('click', start); /* the button and the bare video both bubble here; native toggling is off while controls are absent */
  });
})();
