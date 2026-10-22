/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * e1022: the Settings "Updates" tab and the About links. Lazy: its own module, not part of any boot graph.
 * The automatic daily check (worker, offscreen door) is untouched. The button here is the manual trigger: one GET of releases/latest
 * (core/update-check.js, the same code), only on a press, and it ignores the backoff so a press always asks.
 */
export const WEBSITE_URL = /** @type {string} */ ('https://nj-burrito.github.io/QA-Wrap/'); // the QA Wrap website (GitHub Pages, served from site/)

/** "Chrome 141 on Windows" from a user-agent string; falls back to the raw string. */
export function envLine(ua = '') {
  const b = /(Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua);
  const name = b ? ({ Edg: 'Edge', OPR: 'Opera' }[b[1]] || b[1]) : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return name && os ? `${name} ${b[2]} · ${os}` : ua;
}

export async function checkNow({ state, version, token, run }) {
  const next = await run({ state: { ...(state || {}), backoffUntil: 0 }, version, token });
  return next; // null: the check failed or there is no source repo yet; otherwise the state to store
}

async function mount(doc) {
  const $ = (id) => doc.getElementById(id);
  const tr = (k, v) => globalThis.QAWi18n.t(k, v);
  for (const id of ['about-github', 'about-portfolio']) { const a = /** @type {HTMLAnchorElement|null} */ ($(id)); if (a) a.textContent = a.href.replace(/^https:\/\//, ''); } // Latin address, painted from the href
  if (WEBSITE_URL && $('about-website')) {
    const a = Object.assign(doc.createElement('a'), { href: WEBSITE_URL, target: '_blank', rel: 'noopener', textContent: WEBSITE_URL.replace(/^https?:\/\//, '') });
    $('about-website').removeAttribute('data-i18n');
    $('about-website').replaceChildren(a);
  }
  if (!$('upd-check')) return;
  await globalThis.QAWi18n.ready?.();
  const { describe } = await import('../core/product.js');
  const d = describe();
  const version = chrome.runtime.getManifest().version;
  $('upd-build').textContent = `${d.code} (v${d.version})`;
  $('upd-id').textContent = d.extensionId;
  $('upd-env').textContent = envLine(navigator.userAgent);
  const paint = async () => {
    const s = /** @type {any} */ (await chrome.storage.local.get(['qawUpdate', 'qawUpdateTried']));
    const at = Math.max(s.qawUpdate?.checkedAt || 0, s.qawUpdateTried || 0);
    $('upd-checked').textContent = at ? new Date(at).toLocaleString(globalThis.QAWi18n.numTag()) : tr('options.e1022.updNever');
    const found = globalThis.QAWUpdateCard?.pending(s.qawUpdate, '', version);
    $('upd-now').hidden = !found;
    return found;
  };
  await paint();
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && ('qawUpdate' in c || 'qawUpdateTried' in c)) paint(); });
  $('upd-check').addEventListener('click', async () => {
    const btn = $('upd-check');
    btn.disabled = true;
    $('upd-status').textContent = tr('options.e1022.updChecking');
    try {
      const s = await chrome.storage.local.get(['qawUpdate', 'qawUpdateToken']);
      const { run } = await import('../core/update-check.js');
      const next = await checkNow({ state: s.qawUpdate, version, token: s.qawUpdateToken, run });
      await chrome.storage.local.set({ qawUpdateTried: Date.now(), ...(next ? { qawUpdate: next } : {}) });
      if (next) await chrome.storage.session.set({ 'uqa.updateNew': !!next.latest });
      const found = await paint();
      $('upd-status').textContent = !next ? tr('options.e1022.updFailed') : found ? tr('options.e1022.updFound', { version: found.version }) : tr('options.e1022.updUpToDate');
    } catch {
      $('upd-status').textContent = tr('options.e1022.updFailed');
    } finally {
      btn.disabled = false;
    }
  });
  $('upd-now').addEventListener('click', async () => {
    await globalThis.QAWUpdateCard.paint(doc.querySelector('main'), true);
    $('update-go')?.click();
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) mount(document).catch(() => {});
