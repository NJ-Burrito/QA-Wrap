/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The full timeline of a session as readable Markdown, with the profile in it (R5). Sealing is a separate step
 * (core/seal.js): this builds the text a person reads; `background/export-build.js` appends the trace line and the seal.
 *
 * Every recorded event is a row: when (seconds from the start), what kind, and one line of what happened. Page text is
 * hostile input, so every cell goes through `mdCell`. In an Arabic session the words are Arabic and every Latin phrase
 * (URL, method, locator) sits in a bidi isolate so punctuation cannot flip inside the sentence.
 */
import { summarise, when } from './formats.js';
import { mdCell, mdEsc, sessionIsArabic } from './docshell.js';
import { reportTitle } from './artifact-docs.js';

const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
/** Every Latin phrase (first to last ASCII letter or digit) in its own isolate. */
const LATIN = /[^\s؀-ۿ«»]*[A-Za-z0-9](?:[^\n\r؀-ۿ«»]*[A-Za-z0-9])?[^\s؀-ۿ«»]*/g;
const isolate = (s) => String(s).replace(LATIN, (m) => `${FSI}${m}${PDI}`);

const W = {
  en: {
    title: 'Timeline', profile: 'Profile', name: 'Name', picture: 'Picture', none: 'not set', session: 'Session', id: 'Session id',
    started: 'Started', duration: 'Duration', url: 'Start URL', events: 'Events', rows: 'Timeline',
    colN: '#', colWhen: 'When', colKind: 'Kind', colWhat: 'What happened', empty: 'No events were recorded in this session.',
    kinds: { nav: 'Navigation', dom: 'Action', net: 'Request', console: 'Console', pageerror: 'Page error', note: 'Note', screenshot: 'Screenshot', recording: 'Recording' },
  },
  ar: {
    title: 'الجدول الزمني', profile: 'الملف الشخصي', name: 'الاسم', picture: 'الصورة', none: 'غير محدد', session: 'الجلسة', id: 'رقم الجلسة',
    started: 'بدأت', duration: 'المدة', url: 'عنوان البداية', events: 'الأحداث', rows: 'الجدول الزمني',
    colN: '#', colWhen: 'الوقت', colKind: 'النوع', colWhat: 'ما حدث', empty: 'لم يسجل أي حدث في هذه الجلسة.',
    kinds: { nav: 'تنقل', dom: 'إجراء', net: 'طلب', console: 'وحدة التحكم', pageerror: 'خطأ في الصفحة', note: 'ملاحظة', screenshot: 'لقطة', recording: 'تسجيل' },
  },
};

/** The Arabic sentence for an event, written without vowel marks; anything else falls back to the shared English line. */
function describeAr(ev) {
  const t = ev.label || ev.tag || 'element';
  switch (ev.kind) {
    case 'nav': return `فتح ${ev.url}`;
    case 'dom':
      if (ev.action === 'click') return `نقر على ${t}`;
      if (ev.action === 'input') return `كتابة "${ev.value ?? ''}" في ${t}`;
      if (ev.action === 'change') return `ضبط ${t} على "${ev.value ?? ''}"`;
      if (ev.action === 'submit') return `إرسال ${t}`;
      if (ev.action === 'keydown') return `ضغط ${ev.key} على ${t}`;
      return `${ev.action} على ${t}`;
    case 'net': return `${ev.method} ${ev.url} ← ${ev.error ? 'خطأ في الشبكة' : ev.status} (${Math.round(ev.durationMs)} مللي ثانية)`;
    case 'screenshot': return ev.text || 'لقطة شاشة';
    default: return summarise(ev);
  }
}

const cut = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * @param {any} session
 * @param {any[]} events
 * @param {{ profile?: { name?: string, picture?: string }, version?: string }} [o]
 * @returns {string} the readable document, ending with a newline; no trace line and no seal yet
 */
export function buildTimelineMarkdown(session, events, { profile } = {}) {
  const ar = sessionIsArabic(session, events);
  const L = ar ? W.ar : W.en;
  const out = [];
  const cell = (s) => (ar ? isolate(mdCell(s)) : mdCell(s));
  out.push(`# ${L.title}: ${mdEsc(cut(reportTitle(session, events), 120))}`, '');

  out.push(`## ${L.profile}`, '');
  const name = String(profile?.name || '').trim();
  out.push(`- ${L.name}: ${name ? (ar ? isolate(mdEsc(name)) : mdEsc(name)) : L.none}`);
  if (profile?.picture) out.push(`- ${L.picture}: ![${mdEsc(name || L.picture)}][qaw-profile-picture]`);
  out.push('');

  out.push(`## ${L.session}`, '');
  out.push(`- ${L.id}: \`${String(session.id ?? '').replace(/`/g, '')}\``);
  out.push(`- ${L.started}: ${new Date(session.startedAt).toISOString()}`);
  if (session.endedAt) out.push(`- ${L.duration}: ${((session.endedAt - session.startedAt) / 1000).toFixed(1)}s`);
  if (session.startUrl) out.push(`- ${L.url}: ${cell(session.startUrl)}`);
  out.push(`- ${L.events}: ${events.length}`, '');

  out.push(`## ${L.rows}`, '');
  if (!events.length) out.push(L.empty, '');
  else {
    out.push(`| ${L.colN} | ${L.colWhen} | ${L.colKind} | ${L.colWhat} |`, '|---|---|---|---|');
    const sorted = [...events].sort((a, b) => (a.ts - b.ts) || ((a.seq ?? 0) - (b.seq ?? 0)));
    sorted.forEach((ev, i) => {
      const line = cut(ar ? describeAr(ev) : summarise(ev));
      out.push(`| ${i + 1} | ${when(ev.ts, session.startedAt)} | ${L.kinds[ev.kind] || cell(ev.kind)} | ${cell(line)} |`);
    });
    out.push('');
  }
  if (profile?.picture) out.push(`[qaw-profile-picture]: ${profile.picture}`, '');
  return `${out.join('\n').replace(/\s+$/, '')}\n`;
}
