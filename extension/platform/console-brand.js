/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-nocheck
/**
 * The Evidence Tag: QA Wrap's voice in the browser console.
 *
 * Loaded ONLY by our own contexts that own a console of their own: the service worker (import) and the
 * DevTools panel (script tag). Never by a content script: the console of the page under test is the
 * tester's evidence and this product adds nothing to it (console-redesign-1004).
 *
 *   QAConsole.banner('service worker')      one brand banner per context, once
 *   QAConsole.warn('could not store:', err) a styled "QA Wrap" chip, then the message as given
 *
 * Classic script that sets one global, so the module service worker and a plain <script> use the same file.
 * Colours live on their own chip (own background), so they read on a light or a dark console.
 */
(function (root) {
  if (root.QAConsole) return;

  const C = { basalt: '#1D2024', lift: '#2A2E33', limestone: '#F1EFE9', petra: '#B5432B', coral: '#FF8A6E', ring: '#ECEAE3', slate: '#5D646B', mist: '#9AA0A6', gloss: '#C9CDD2' };
  const base = (bg, fg, extra) => `background:${bg};color:${fg};${extra || ''}`;

  const SANS = "'Thmanyah Sans',ui-sans-serif,system-ui,sans-serif"; // a console cannot load a web font: the family name plus a generic
  const MARK = (ring, check) =>
    `<g fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" transform="translate(-2 1)">` +
    `<path d="M45.01 37.98A17 17 0 1 0 34.97 46.26" stroke="${ring}"/><path d="M36 36L42.5 44L55 20" stroke="${check}"/></g>`;
  const url = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  // The Evidence Tag, same plate as the service worker's (background/signature.js): a chamfered tag, a punched hole, a trail traced to the check.
  const PLATE_URL = url(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 56"><path fill="${C.basalt}" fill-rule="evenodd" d="M14 0H560V56H0V14ZM16 28a5 5 0 1 0 10 0a5 5 0 1 0-10 0Z"/>` +
    `<g transform="translate(38 5) scale(.8)">${MARK(C.ring, C.coral)}</g><g transform="translate(448 -7) scale(1.2)">${MARK('#ECEAE324', C.coral)}</g>` +
    `<path d="M101 23l10 10m0-10l-10 10M117 28H150V40H236V18H330V38H486" fill="none" stroke="${C.coral}" stroke-opacity=".6" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  const MARK_URL = url(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${MARK(C.ring, C.coral)}</svg>`);

  const WORDS = {
    en: { tape: 'EVERY FAILURE, TRACED.', by: 'Made by Nader Alzghoul' },
    ar: { tape: 'كل خطأ، وأثره.', by: 'من تطوير نادر الزغول' },
  };

  function lang() {
    try { return /^ar/i.test(root.navigator?.language || '') ? 'ar' : 'en'; } catch { return 'en'; }
  }

  function version() {
    try { return root.chrome?.runtime?.getManifest?.().version || ''; } catch { return ''; }
  }

  /** The banner as console arguments: one format string, then its CSS list. Pure, so it can be tested. */
  function bannerArgs(context) {
    const ar = lang() === 'ar';
    const W = WORDS[ar ? 'ar' : 'en'];
    const fs = ar ? 12 : 11;
    const chip = (bg, fg, extra) => `background:${bg};color:${fg};font:700 ${fs}px/1.9 ${SANS};padding:0 10px;${extra || ''}`;
    const v = version();
    const fmt = '\n%c \n\u200E%c' + (ar ? '\u2067' + W.tape + '\u2069' : W.tape) + '%c QA Wrap %c' + context + (v ? ' · ' + v : '') + ' %c\n\u200E%c' + W.by + ' ';
    return [fmt,
      `background:${PLATE_URL};background-size:100% 100%;background-repeat:no-repeat;padding:28px 280px;line-height:56px;font-size:0`,
      chip(C.petra, C.limestone, ar ? 'padding:0 14px;' : 'letter-spacing:.14em;padding:0 14px;'),
      chip(C.basalt, C.limestone, `font-size:${fs + 2}px;`), chip(C.lift, C.gloss, 'font-weight:400;'), '',
      `background:${C.basalt};color:${C.mist};font:400 10px/1.9 ${SANS};padding:0 10px`];
  }

  const done = new Set();
  function banner(context) {
    if (done.has(context)) return;
    done.add(context);
    try { root.console.info(...bannerArgs(context)); } catch { /* a console that cannot style prints nothing */ }
  }

  const LEVEL_BG = { log: C.slate, info: C.basalt, warn: C.petra, error: C.petra, debug: C.slate };
  const LEVEL_FG = { log: C.limestone, info: C.gloss, warn: C.limestone, error: C.limestone, debug: C.limestone };

  /** `console[level]` with a brand chip in front; the caller's arguments follow untouched. */
  function say(level, ...args) {
    const fn = root.console?.[level] || root.console?.log;
    if (!fn) return;
    try {
      fn.call(root.console, '%c QA Wrap %c', base(`${MARK_URL} no-repeat 4px 50%/11px,${LEVEL_BG[level] || C.slate}`, LEVEL_FG[level] || C.limestone, 'font-weight:700;border-radius:3px;padding-left:16px;'), '', ...args);
    } catch { /* never let logging throw */ }
  }

  root.QAConsole = {
    banner, bannerArgs,
    log: (...a) => say('log', ...a),
    info: (...a) => say('info', ...a),
    warn: (...a) => say('warn', ...a),
    error: (...a) => say('error', ...a),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
