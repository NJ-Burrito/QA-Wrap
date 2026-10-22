/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Reporter mode: the surface for the person who is not a tester.
 *
 * The product's other surfaces assume somebody who knows what a session is,
 * what a charter is for, and why a locator matters. This one assumes none of
 * that. It exists because the most valuable bug report in any organisation is
 * the one from the person who actually hit the problem, and the reason those
 * reports are useless is never the person: it is that nobody attached the page,
 * the console error and the failed request, because nobody asked them to and
 * they would not have known how.
 *
 * So it asks for the one thing only they have — what they were doing and what
 * happened — and attaches everything else itself.
 *
 * **No test-activity vocabulary anywhere on this page.** Not "session", not
 * "charter", not "artefact", not "evidence", not "defect". The words are the
 * ones a person would use out loud. This is a rule about the copy, and it is
 * checked in `tools/test-copy.mjs`'s sibling below rather than left to taste.
 */

import { filingState } from '../ui/outcome.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: 'The extension did not answer.' })));

/** Arabic and English, both first-class, switched by one button. */
const COPY = {
  en: {
    dir: 'ltr',
    lang: 'en',
    docTitle: 'Report a problem',
    title: 'What went wrong?',
    prompt: 'Describe it in your own words. One or two sentences is plenty.',
    placeholder: 'I pressed Submit and the page went blank.',
    send: 'Send it',
    save: 'Save it instead',
    other: 'عربي',
    privacy: 'A picture of this page is attached, along with the address, any errors the page reported, and your browser and screen size. Nothing else, and nothing leaves this machine unless you press Send.',
    preparing: 'Preparing the details…',
    attached: (n) => `Attached for you: a picture of the page, its address, ${n} technical detail${n === 1 ? '' : 's'} the developer will want.`,
    empty: 'Write a sentence about what happened first.',
    saving: 'Saving…',
    sending: 'Sending…',
    saved: 'Saved. You can close this page.',
    sent: 'Sent. Thank you: that was the useful kind of bug report.',
    partial: (n, m) => `Posted to ${n} of ${m} destinations. The report is saved here either way.`,
    notSent: (why) => `Saved here, but not sent${why ? `: ${why}` : '. No place to send it to is set up.'}`,
  },
  ar: {
    dir: 'rtl',
    lang: 'ar',
    docTitle: 'الإبلاغ عن مشكلة',
    title: 'ما الذي حدث؟',
    prompt: 'اكتب ما حدث بكلماتك. جملة أو جملتان تكفيان.',
    placeholder: 'ضغطت على «إرسال» فصارت الصفحة فارغة.',
    send: 'أرسل',
    save: 'احفظ بدل الإرسال',
    other: 'English',
    privacy: 'تُرفق صورة لهذه الصفحة مع عنوانها وأي أخطاء أبلغت عنها ونوع المتصفح وقياس الشاشة. لا شيء غير ذلك، ولا يغادر شيء هذا الجهاز إلا بضغطك على «أرسل».',
    preparing: 'يجري تجهيز التفاصيل…',
    attached: (n) => `أُرفق عنك: صورة للصفحة وعنوانها و${n} من التفاصيل التقنية التي سيحتاجها المطوّر.`,
    empty: 'اكتب أولاً جملة عمّا حدث.',
    saving: 'يجري الحفظ…',
    sending: 'يجري الإرسال…',
    saved: 'تم الحفظ. يمكنك إغلاق الصفحة.',
    sent: 'أُرسل. شكرًا لك: هذا هو البلاغ المفيد.',
    partial: (n, m) => `نُشر في ${n} من ${m} وجهات. البلاغ محفوظ هنا في الحالتين.`,
    notSent: (why) => `حُفظ هنا لكنه لم يُرسل${why ? `: ${why}` : '. لم تُضبط جهة لإرساله إليها.'}`,
  },
};

/*
 * Remembered if they chose, otherwise the browser's own language.
 *
 * The brackets matter, and their absence was a real bug: `stored || isArabic ?
 * 'ar' : 'en'` parses as `(stored || isArabic) ? 'ar' : 'en'`, so *any* stored
 * value — including the string 'en' — opened the page in Arabic. One switch to
 * Arabic and back left the page in Arabic for ever, and it made an English copy
 * assertion in the headed suite fail on every run after the first, in the same
 * profile, which reads exactly like a flake and is not one.
 */
let lang = (() => {
  try {
    const stored = localStorage.getItem('qaw-reporter-lang');
    if (stored === 'ar' || stored === 'en') return stored;
    /*
     * Otherwise: whatever the tester set the product itself to.
     *
     * `qaw-lang` is the mirror `platform/i18n.js` writes before every other surface
     * paints, on this same extension origin, so reading the key directly costs
     * this page nothing. Loading the whole mechanism here would be the wrong
     * trade: it exists to hold two tables of four hundred keys in step, and
     * this page has eleven sentences and a button that switches them. What it
     * must not do is disagree with the rest of the product about which
     * language a person reads, which is what happened while the two mechanisms
     * knew nothing about each other.
     */
    const product = localStorage.getItem('qaw-lang');
    if (product === 'ar' || product === 'en') return product;
  } catch { /* a private window: fall through to the browser's language */ }
  return (navigator.language || '').startsWith('ar') ? 'ar' : 'en';
})();
let attached = null;

function paint() {
  const c = COPY[lang];
  document.documentElement.dir = c.dir;
  document.documentElement.lang = c.lang;
  $('doctitle').textContent = c.docTitle;
  $('title').textContent = c.title;
  $('prompt').textContent = c.prompt;
  $('what').placeholder = c.placeholder;
  $('send').textContent = c.send;
  $('save').textContent = c.save;
  $('lang').textContent = c.other;
  $('privacy').textContent = c.privacy;
  $('attached').textContent = attached ? c.attached(attached.details) : c.preparing;
}

$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'ar' : 'en';
  try { localStorage.setItem('qaw-reporter-lang', lang); } catch { /* a private window */ }
  paint();
});

/**
 * Everything technical, gathered before the person has finished typing.
 *
 * Done on load rather than on send, for one reason that matters: the state
 * worth capturing is the state the page was in when the problem happened, and
 * every second between then and the press is a second in which it changes.
 */
async function gather() {
  const res = await send({ type: 'UQA_REPORTER_CONTEXT' });
  attached = res.ok ? res.result : { details: 0, error: res.error };
  paint();
}

async function file(how) {
  const words = $('what').value.trim();
  const c = COPY[lang];
  if (!words) {
    $('status').textContent = c.empty;
    $('status').className = 'status err';
    $('what').focus();
    return;
  }
  for (const b of [$('send'), $('save')]) b.disabled = true;
  $('status').className = 'status';
  $('status').textContent = how === 'send' ? c.sending : c.saving;

  const res = await send({ type: 'UQA_REPORTER_FILE', how, words, lang });
  for (const b of [$('send'), $('save')]) b.disabled = false;
  if (!res.ok) {
    $('status').textContent = res.error;
    $('status').className = 'status err';
    return;
  }
  const f = filingState(how, res.result?.posted);
  const text = { saved: c.saved, sent: c.sent }[f.state] || (f.state === 'partial' ? c.partial(f.sent, f.total) : c.notSent(f.reason));
  $('status').textContent = text;
  $('status').className = f.state === 'saved' || f.state === 'sent' ? 'status ok' : 'status err';
  $('what').value = '';
}

$('send').addEventListener('click', () => file('send'));
$('save').addEventListener('click', () => file('save'));

paint();
gather();
