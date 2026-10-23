/* QA Wrap site — the language toggle, and nothing else.
   Every page carries an English block and an Arabic block for the same
   content (assets/site.css hides the one `data-lang` on <body> does not
   name). This file flips that one attribute, keeps <html lang>/<dir> in
   step so the browser and any assistive tech agree with what is on screen,
   and remembers the choice in localStorage for the next page. No network
   request, no analytics, nothing else on the page depends on this running:
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
