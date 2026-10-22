/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Console banner for "Inspect views: service worker": printed once per worker life, log and a collapsed group only (never warn or error). */

import { MAKER, copyright, token } from '../core/provenance.js';


const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

const C = { basalt: '#1D2024', lift: '#2A2E33', limestone: '#F1EFE9', petra: '#B5432B', foil: '#D8C6A4', coral: '#FF8A6E', ring: '#ECEAE3', mist: '#9AA0A6', gloss: '#C9CDD2' };
const SANS = "'Thmanyah Sans',ui-sans-serif,system-ui,sans-serif";

const MARK = (ring, check) =>
  `<g fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" transform="translate(-2 1)">` +
  `<path d="M45.01 37.98A17 17 0 1 0 34.97 46.26" stroke="${ring}"/><path d="M36 36L42.5 44L55 20" stroke="${check}"/></g>`;

// A tag: the failure (X) traced to the check.
const PLATE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 56"><path fill="${C.basalt}" fill-rule="evenodd" d="M14 0H560V56H0V14ZM16 28a5 5 0 1 0 10 0a5 5 0 1 0-10 0Z"/>` +
  `<g transform="translate(38 5) scale(.8)">${MARK(C.ring, C.coral)}</g>` +
  `<g transform="translate(448 -7) scale(1.2)">${MARK('#ECEAE324', C.coral)}</g>` +
  `<path d="M101 23l10 10m0-10l-10 10M117 28H150V40H236V18H330V38H486" fill="none" stroke="${C.coral}" stroke-opacity=".6" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const url = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
const PLATE_URL = url(PLATE_SVG);
export const MARK_URL = url(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${MARK(C.ring, C.coral)}</svg>`);

const WORDS = {
  en: {
    tape: 'EVERY FAILURE, TRACED.', build: 'BUILD', boot: 'AT BOOT', now: 'NOW', helpers: 'helpers',
    where: 'service worker', recording: 'recording', idle: 'idle', asleep: 'asleep everywhere',
    awake: (n) => `awake in ${plural(n, 'window')}`, rights: copyright(),
  },
  ar: {
    tape: 'كل خطأ، وأثره.', build: 'الإصدار', boot: 'عند الإقلاع', now: 'الآن', helpers: 'المساعدات',
    where: 'عامل الخدمة', recording: 'تسجيل', idle: 'خامل', asleep: 'نائم في كل النوافذ',
    awake: (n) => `مستيقظ في ${n === 1 ? 'نافذة واحدة' : n === 2 ? 'نافذتان' : n <= 10 ? n + ' نوافذ' : n + ' نافذة'}`,
    rights: `\u200F© 2026 \u2066${MAKER.owner}\u2069 · جميع الحقوق محفوظة`,
  },
};
const lang = () => { try { return /^ar/i.test(globalThis.navigator?.language || '') ? 'ar' : 'en'; } catch { return 'en'; } };

const HELPERS = [ // call, async, EN gloss, AR gloss
  ['help()', 0, 'print this card again', 'أعد طباعة هذه البطاقة'],
  ['state()', 1, 'what the worker is doing', 'حالة العامل الآن'],
  ['sessions()', 1, 'stored sessions', 'الجلسات المخزّنة'],
  ['used()', 1, 'tools used this session', 'الأدوات المستخدمة'],
  ['handlers()', 0, 'messages it answers', 'الرسائل التي يجيب عنها'],
  ['wake()', 1, 'arm the current window', 'فعّل النافذة الحالية'],
  ['sleep()', 1, 'put all windows to sleep', 'أعد النوافذ إلى النوم'],
  ['provenance()', 1, 'what this build stamps', 'ما يختمه هذا الإصدار'],
  ['verify(text)', 0, 'read a \u2066qaw1\u2069 seal from text', 'استخرج ختم \u2066qaw1\u2069 من نص'],
];

/** The tag as [method, ...args] calls. `live` labels the state row NOW (a reprint) instead of AT BOOT. */
export function tagCalls({ version, sessionId, armedWindows, live } = {}) {
  const L = WORDS[lang()];
  const ar = lang() === 'ar';
  const fs = ar ? 12 : 11; // Arabic has a low x-height; tracking breaks its joins, so it gets none
  const trk = (em) => (ar ? '' : `letter-spacing:${em}em;`);
  const pill = (bg, fg, extra = '') => `background:${bg};color:${fg};font:700 ${fs}px/1.9 ${SANS};padding:0 10px;${extra}`;
  const label = (bg, fg) => pill(bg, fg, `font-size:${ar ? 11 : 10}px;${trk(0.1)}`);
  const bidi = (t, rtl) => (ar ? `${rtl ? '\u2067' : '\u2066'}${t}\u2069` : t); // an isolate per Arabic run keeps the row left to right
  const calls = [];

  calls.push(['log', '\n%c ', `background:${PLATE_URL};background-size:100% 100%;background-repeat:no-repeat;padding:28px 280px;line-height:56px;font-size:0`]);
  calls.push(['log', `\u200E%c${bidi(L.tape, ar)}%c QA Wrap %c${bidi(L.where)}%c`,
    pill(C.petra, C.limestone, `padding:0 14px;${trk(0.14)}`), pill(C.basalt, C.limestone, `font-size:${fs + 2}px;`), pill(C.lift, C.gloss, 'font-weight:400;'), '']);

  const [, sum] = token({ version }).split('.');
  const serial = sum ? `QAW1 ${sum.slice(0, 4).toUpperCase()}-${sum.slice(4, 8).toUpperCase()}` : 'QAW1';
  const awake = armedWindows?.length ? L.awake(armedWindows.length) : L.asleep;
  const state = `${sessionId ? `${L.recording} ${sessionId}` : L.idle} · ${awake}`;
  const value = pill(C.lift, C.limestone, 'font-weight:600;');
  calls.push(['log', `\u200E%c${bidi(L.build)}%c\u2066${version || '?'} · ${serial}\u2069%c %c${bidi(live ? L.now : L.boot)}%c\u2066${state}\u2069%c`,
    label(C.basalt, C.foil), value, '', label(C.basalt, C.foil), pill(C.lift, sessionId ? C.coral : C.limestone, 'font-weight:600;'), '']);

  calls.push(['groupCollapsed', `\u200E%c\u2066qaw\u2069 · ${L.helpers} (${HELPERS.length}) `, pill(C.basalt, C.coral)]);
  HELPERS.forEach(([cmd, isAsync, en, ar2]) => calls.push(['log', `\u200E%c\u2066${isAsync ? 'await ' : ''}qaw.${cmd}\u2069%c  ${ar ? ar2 : en}`,
    pill(C.basalt, C.coral, 'font-weight:700;padding:0 2px 0 8px;'), `background:${C.basalt};color:${C.gloss};font:400 ${fs}px/1.9 ${SANS};padding:0 8px 0 0`]));
  calls.push(['log', `\u200E%c${L.rights}`, `background:${C.basalt};color:${C.mist};font:400 10px/1.9 ${SANS};padding:0 8px`]);
  calls.push(['groupEnd']);
  return calls;
}

export function signConsole({ version, sessionId, armedWindows } = {}) {
  if (globalThis.__UQA_SIGNED) return false;
  globalThis.__UQA_SIGNED = true;

  // Frozen record of what this build is and the token its artefacts carry.
  globalThis.__QAW = Object.freeze({
    product: MAKER.full,
    maker: MAKER.owner,
    version: version || null,
    mark: token({ version }),
    rights: copyright(),
    verify: 'qaw.verify(text) reads the mark back out of any file this build wrote',
  });

  try {
    for (const [method, ...args] of tagCalls({ version, sessionId, armedWindows })) console[method](...args);
  } catch { /* a console that cannot style prints nothing */ }
  return true;
}

/** The console handle the banner advertises: read-only helpers plus `wake`, built from the product's own handlers so it cannot drift. */
export function installConsoleApi({ handlers, sessionState, armed }) {
  const api = {
    async help() {
      const { session } = await handlers.UQA_GET_STATE();
      const armedWindows = await armed.armedWindows();
      for (const [method, ...args] of tagCalls({ version: chrome.runtime.getManifest().version, sessionId: session?.id, armedWindows, live: true })) console[method](...args);
    },
    async state() {
      return handlers.UQA_GET_STATE();
    },
    async sessions() {
      const list = await handlers.UQA_LIST_SESSIONS();
      return list.map((s) => ({
        id: s.id,
        charter: s.charter,
        when: new Date(s.startedAt).toISOString().slice(0, 16).replace('T', ' '),
        status: s.status,
      }));
    },
    async used() {
      const { session } = await handlers.UQA_GET_STATE();
      return session ? sessionState.getUsed(session.id) : {};
    },
    handlers() {
      return Object.keys(handlers).sort();
    },
    async wake() {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.windowId == null) return 'no window to wake';
      await armed.arm(tab.windowId);
      return `awake in window ${tab.windowId}`;
    },
    async sleep() {
      const windows = await armed.armedWindows();
      await armed.disarmAll();
      return `put ${plural(windows.length, 'window')} back to sleep`;
    },
    /** What this build stamps on everything, and how anybody can check it. */
    async provenance() {
      return handlers.UQA_PROVENANCE({});
    },
    /** Read a `qaw1:` token out of anything — a file, a ticket, a paste. */
    verify(text) {
      return handlers.UQA_VERIFY({ text });
    },
    get about() {
      return { ...MAKER, build: chrome.runtime.getManifest().version, copyright: copyright() };
    },
  };

  // `njb` is the retired name, kept as an alias for old snippets; never advertised.
  globalThis.qaw = api;
  globalThis.njb = api;
  return api;
}
