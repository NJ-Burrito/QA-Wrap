/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The affirmative action, and the two ways to read the policy behind it.
 *
 * The page above is the disclosure; this file is the part the store rule
 * (`research/51d` section 1) actually turns on — a specific press, recorded
 * against the build it was given for. `UQA_CONSENT_ACCEPT` writes `consentedAt`
 * and `consentVersion`, and the popup's gate reads them; nothing here decides
 * anything on its own, so a worker that never answered must not leave a tester
 * believing they consented. That is why the failure branch exists and says so
 * in both languages rather than claiming success.
 *
 * A module, not a classic script, for one reason: `PRODUCT.urls.privacy` is the
 * single place the hosted address is written. `core/product.js` documents why
 * (the old address was a 404 that shipped in eight packages), and a second copy
 * of a URL in a consent screen is exactly the copy that goes stale.
 *
 * The packaged policy opens as the raw file. There is no Markdown viewer page
 * in this extension — `core/docshell.js` and `core/mdhtml.js` build *exported*
 * documents in the worker and have no route a tab can navigate to — so this
 * follows the precedent already set by the About card in `options/options.html`,
 * which links `../PRIVACY.md` directly. The note under the buttons says plainly
 * that it opens the packaged text, so nobody presses it expecting a web page.
 */
import { PRODUCT } from '../core/product.js';
import { rateUrl } from '../core/rate-links.js';

const byId = (id) => document.getElementById(id);

/* The hosted page, read from the product's own record of it. */
const web = byId('privacy-web');
if (web) { if (PRODUCT.urls.privacy) web.href = PRODUCT.urls.privacy; else web.hidden = true; }
const trust = byId('trust-web');
if (trust) { if (PRODUCT.urls.trust) trust.href = PRODUCT.urls.trust; else trust.hidden = true; }

/* The practice page, and a passive rating link. The rating link is hidden on a
   managed machine: an organisation's own profile is not asked to review the product. */
/* The practice page ships inside the extension: no network, nothing that can be down. */
const PRACTICE = chrome.runtime.getURL('practice/practice.html');
for (const id of ['practice-link', 'practice-link-ar', 'done-practice']) { const a = byId(id); if (a) a.href = PRACTICE; }
for (const id of ['rate-link', 'rate-link-ar']) { const a = byId(id); if (a) a.href = rateUrl(); }
/* r363: the link follows the dist (GitHub repo until a store lists it), so there is no 404 to hide. */
/* Not awaited: managed storage can fail to answer, and the consent button below must not wait for it. */
Promise.resolve(chrome.storage.managed?.get?.(null)).then((managed) => {
  if (managed && Object.keys(managed).length) for (const id of ['rate-en', 'rate-ar']) { const n = byId(id); if (n) n.hidden = true; }
}).catch(() => { /* no managed manifest: nothing is managed, the link stays */ });

/* The copy inside this build, which is the text that governs this build. */
byId('privacy-packaged')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('PRIVACY.md') });
});

/**
 * Press, record, say so; the person closes the tab.
 *
 * The confirmation replaces the buttons rather than sitting under them, so the
 * page cannot be pressed twice, and the tab stays until its owner closes it: a tab
 * that vanishes on a timer leaves a screen-reader user unsure anything was saved.
 */
const accept = byId('accept');
/* One obvious next action: the button has focus when the page opens. */
accept?.focus();
accept?.addEventListener('click', async () => {
  const failed = byId('failed');
  if (failed) failed.hidden = true;
  accept.disabled = true;

  let recorded = false;
  try {
    // A missing reply (the channel closed) or { ok: false } is a failure like a throw: the write did not land.
    const res = await chrome.runtime.sendMessage({ type: 'UQA_CONSENT_ACCEPT' });
    recorded = !!res && res.ok !== false;
  } catch {
    recorded = false;
  }
  if (!recorded) {
    // The worker was asleep or restarting and the write did not land. Saying
    // "saved" here would be the one lie this page cannot afford.
    if (failed) failed.hidden = false;
    accept.disabled = false;
    return;
  }

  const actions = byId('actions');
  if (actions) actions.hidden = true;
  const done = byId('done');
  if (done) done.hidden = false;
  // T-018: no timer closes this tab. Focus moves to the close button, so a screen reader reads the
  // confirmation and the way out; the person closes it when they have read it.
  byId('close-tab')?.focus();
});

byId('close-tab')?.addEventListener('click', async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) await chrome.tabs.remove(tab.id);
  } catch {
    /* Opened somewhere with no tab of its own: the page simply stays, which is not a failure. */
  }
});

/**
 * The pin hint (1020): no API can pin an extension from inside the browser, so the page shows how, and only while
 * it is needed. `chrome.action.getUserSettings` (Chrome/Edge/Opera 91+, Firefox 116+) reports `isOnToolbar`; where it
 * is missing (Safari) the hint stays. Re-checked on focus and visibility, and on `onUserSettingsChanged` where it exists.
 * Wording follows the browser: Edge shows an eye, Opera a cube, Safari a toolbar editor. Lazy page code, not boot code.
 */
const pinBlock = byId('pin-block');
if (pinBlock) {
  const ua = globalThis.navigator?.userAgent || '';
  const kind = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua) && !/Firefox\//.test(ua)) ? 'safari' : 'default';
  for (const li of pinBlock.querySelectorAll?.('li[data-pin]') || []) li.hidden = li.dataset.pin !== kind;
  const refresh = async () => {
    try {
      const s = await chrome.action?.getUserSettings?.();
      pinBlock.hidden = !!s?.isOnToolbar;
    } catch { /* unknown: leave the hint where it is */ }
  };
  refresh();
  globalThis.addEventListener?.('focus', refresh);
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden) refresh(); });
  chrome.action?.onUserSettingsChanged?.addListener?.(refresh);
}
