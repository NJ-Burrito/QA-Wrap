/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Cookie and web-storage editor (feature 9).
 *
 * The recording side of this product deliberately captures cookie **names and
 * flags and never values** — a bug report that leaks a session token is worse
 * than no bug report. That rule is about what gets written into an artefact,
 * and it stays exactly as it is.
 *
 * Editing is a different job with a different risk. A tester who needs to
 * expire a session, flip a feature flag or reproduce a role has to see and
 * change the value, and there is no way to do that job blind. So: values are
 * readable and writable **here**, in a panel the tester is looking at, and they
 * still never enter a session, an export or a ticket.
 *
 * The two paths never meet. `safeCookies()` in the worker builds artefacts;
 * nothing in this file writes to the database.
 */

/* The format readers and writers (15 KB) run behind the offscreen door: see media.js cookieFormatsOp. */
import { cookieFormatsOp as fmt } from './media.js';
import { loadSealed, saveSealed } from '../platform/vault.js';

/* ── cookies ───────────────────────────────────────────────────────────── */

/** `cookies` is an optional permission: until the tester allows it in the panel, the API is absent. */
export const COOKIES_NEEDED = 'Cookie access is off. Open the Storage tab and choose "Allow cookie access".';
const cookiesApi = () => {
  if (!chrome.cookies) throw new Error(COOKIES_NEEDED);
  return chrome.cookies;
};

const same = (v) => (v === 'no_restriction' ? 'none' : v === 'unspecified' ? '' : v || '');

export async function listCookies({ url }) {
  if (!url) throw new Error('No page to read cookies for.');
  const cookies = await cookiesApi().getAll({ url });
  return cookies
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: same(c.sameSite),
      session: c.session,
      expirationDate: c.expirationDate ?? null,
      storeId: c.storeId,
      // A cookie the page's own JavaScript cannot touch is worth marking:
      // it explains why document.cookie does not show it.
      scriptReadable: !c.httpOnly,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Chrome has no "update cookie" — set() replaces by (name, domain, path), so a
 * change of any of those three creates a second cookie rather than moving the
 * first. Delete the original explicitly when its identity changed.
 */
export async function setCookie({ url, cookie, previous }) {
  if (!url) throw new Error('No page to set a cookie on.');
  if (!cookie?.name) throw new Error('A cookie needs a name.');

  if (previous && (previous.name !== cookie.name || previous.path !== cookie.path)) {
    await cookiesApi().remove({ url, name: previous.name, storeId: previous.storeId }).catch(() => {});
  }

  const spec = {
    url,
    name: cookie.name,
    value: cookie.value ?? '',
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
  };
  // A host-only cookie must not carry a domain at all; sending one silently
  // widens its scope to every subdomain.
  if (cookie.domain && cookie.domain.startsWith('.')) spec.domain = cookie.domain;
  if (cookie.sameSite) spec.sameSite = cookie.sameSite === 'none' ? 'no_restriction' : cookie.sameSite;
  if (!cookie.session && cookie.expirationDate) spec.expirationDate = Number(cookie.expirationDate);

  const written = await cookiesApi().set(spec);
  if (!written) {
    // set() resolves null and puts the reason on lastError. Without this the
    // UI would report success on a cookie Chrome refused — SameSite=None
    // without Secure being the usual one.
    const why = chrome.runtime.lastError?.message || 'Chrome refused the cookie';
    throw new Error(
      `${why}. SameSite=None requires Secure, and a Secure cookie needs an https page.`
    );
  }
  return { name: written.name, domain: written.domain, path: written.path };
}

export async function removeCookie({ url, name, storeId }) {
  const gone = await cookiesApi().remove({ url, name, storeId });
  if (!gone) throw new Error(`Could not delete "${name}". It may belong to a different domain or path.`);
  return { name };
}

export async function clearCookies({ url }) {
  const all = await cookiesApi().getAll({ url });
  let removed = 0;
  for (const c of all) {
    const ok = await cookiesApi().remove({ url, name: c.name, storeId: c.storeId }).catch(() => null);
    if (ok) removed++;
  }
  return { removed, total: all.length };
}

/**
 * Import in the shape Cookie Editor and Puppeteer both emit, so a jar exported
 * anywhere else can be dropped straight in. Every cookie is reported on
 * individually: a jar that half-applies and says "done" is how a tester ends up
 * debugging the wrong session.
 */
/**
 * Import cookies in whatever shape they arrived in.
 *
 * Was JSON only, which meant a `cookies.txt` from curl or a `Cookie:` header
 * out of DevTools had to be retyped — and retyped cookies are wrong in ways
 * that cost an afternoon. `core/cookie-formats.js` reads all four and says which
 * one it thinks this is, so the tester can correct the guess rather than pick
 * from a dropdown every time.
 */
export async function importCookies({ url, json, text, format }) {
  const body = text ?? json;
  if (!String(body || '').trim()) throw new Error('Nothing to import.');

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  // A `Cookie:` header carries no domain, so one has to be supplied. The page
  // being looked at is the only defensible answer; inventing one silently
  // writes cookies somewhere the tester did not intend.
  const detected = await fmt('detectFormat', [body]);
  const list = await fmt('parse', [body, format, { domain: host, path: '/' }]);
  if (!list.length) throw new Error('That parsed cleanly but contained no cookies.');

  // Anything unwritable is reported, never dropped. "12 of 13 imported" with
  // no way to find the thirteenth is the failure this guards against.
  const { ok, refused } = await fmt('usable', [list]);

  const results = refused.map((c) => ({ name: c.name || '(no name)', ok: false, error: c.reason }));
  for (const c of ok) {
    try {
      await setCookie({ url, cookie: { ...c, sameSite: same(c.sameSite) } });
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: err.message });
    }
  }
  return {
    applied: results.filter((r) => r.ok).length,
    total: list.length,
    format: format || detected,
    results,
  };
}

/**
 * Write the current jar out in a chosen format.
 *
 * `whatIsLost` travels with it, because discovering after the export that a
 * `Cookie:` header dropped every flag is a bad afternoon and an entirely
 * avoidable one.
 */
export async function exportCookies({ url, format = 'json' }) {
  const cookies = await listCookies({ url });
  const spec = (await fmt('FORMATS')).find((f) => f.id === format);
  if (!spec) throw new Error(`Unknown cookie format: ${format}`);
  return {
    format,
    ext: spec.ext,
    mime: spec.mime,
    count: cookies.length,
    lost: await fmt('whatIsLost', [format, cookies]),
    content: await fmt('serialise', [cookies, format]),
  };
}

/* ── profiles ──────────────────────────────────────────────────────────── */

const PROFILE_KEY = 'cookieProfiles';

/**
 * A named jar you can put back: an admin session, a plain-user session, a logged-out state, in seconds.
 * Kept in storage.local so it survives the session, and sealed in the encrypted vault (r4-02-2): the profile
 * list shows what each one contains, and Erase all removes the sealed copy without unlocking.
 */
const loadProfiles = async () => Object.assign(Object.create(null), await loadSealed(PROFILE_KEY)); // D-208: no inherited names
const coded = (m, code) => Object.assign(new Error(m), { code });

export async function listCookieProfiles() {
  const profiles = await loadProfiles();
  return Object.entries(profiles).map(([name, p]) => ({
    name,
    url: p.url,
    count: p.cookies.length,
    savedAt: p.savedAt,
    names: p.cookies.map((c) => c.name).slice(0, 12),
  }));
}

export async function saveCookieProfile({ url, name }) {
  if (!String(name || '').trim()) throw new Error('Give the profile a name.');
  if (/^(__proto__|constructor|prototype)$/.test(name.trim())) throw coded('That name cannot be used for a cookie profile.', 'COOKIE_BAD_NAME');
  const cookies = await listCookies({ url });
  if (!cookies.length) throw new Error('There are no cookies on this page to save.');

  const profiles = await loadProfiles();
  profiles[name.trim()] = { url, savedAt: Date.now(), cookies };
  await saveSealed(PROFILE_KEY, profiles);
  return { name: name.trim(), count: cookies.length };
}

/** Put a saved jar back. Clears first by default: restoring over a live session leaves a half-and-half state. */
export async function restoreCookieProfile({ url, name, clearFirst = true }) {
  const profiles = await loadProfiles();
  const profile = Object.hasOwn(profiles, name) ? profiles[name] : null;
  if (!profile) throw new Error(`No cookie profile called "${name}".`);
  let saved = ''; let here = '';
  try { saved = profile.url && new URL(profile.url).origin; here = new URL(url).origin; } catch { /* unparseable: compared as-is */ }
  if (saved && saved !== here) throw coded('This cookie profile was saved for another site. Open that site to restore it.', 'COOKIE_OTHER_SITE'); // a legacy profile with no url is allowed

  let cleared = 0;
  if (clearFirst) ({ cleared } = await clearCookies({ url }));

  const results = [];
  for (const c of profile.cookies) {
    try {
      await setCookie({ url, cookie: { ...c, sameSite: same(c.sameSite) } });
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: err.message });
    }
  }
  return { name, cleared, applied: results.filter((r) => r.ok).length, total: profile.cookies.length, results };
}

export async function deleteCookieProfile({ name }) {
  const profiles = await loadProfiles();
  if (!Object.hasOwn(profiles, name)) throw new Error(`No cookie profile called "${name}".`);
  delete profiles[name];
  await saveSealed(PROFILE_KEY, profiles);
  return { name, left: Object.keys(profiles).length };
}

/* ── localStorage / sessionStorage ─────────────────────────────────────── */

/**
 * Web storage lives in the page, not in an extension API, so every one of these
 * runs a function in the tab. Reads are capped: a single localStorage entry can
 * hold megabytes, and shipping all of it into the panel to render a preview is
 * a good way to hang DevTools.
 */
const PREVIEW = 2000;

export async function listWebStorage({ tabId }) {
  if (tabId == null) throw new Error('No tab to read storage from.');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [PREVIEW],
    func: (cap) => {
      const read = (store) => {
        try {
          return Object.keys(store).map((k) => {
            const v = store.getItem(k) ?? '';
            return { key: k, value: v.slice(0, cap), bytes: v.length, truncated: v.length > cap };
          });
        } catch (err) {
          // Storage throws outright when the browser is set to block site data.
          return { error: err.message };
        }
      };
      return { local: read(localStorage), session: read(sessionStorage), origin: location.origin };
    },
  });
  return result;
}

export async function setWebStorage({ tabId, area, key, value }) {
  if (tabId == null) throw new Error('No tab to write storage to.');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [area, key, value],
    func: (a, k, v) => {
      try {
        (a === 'session' ? sessionStorage : localStorage).setItem(k, v);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  });
  if (!result?.ok) throw new Error(result?.error || 'The page refused the write.');
  return { key };
}

export async function removeWebStorage({ tabId, area, key }) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [area, key],
    func: (a, k) => {
      try {
        (a === 'session' ? sessionStorage : localStorage).removeItem(k);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  });
  if (!result?.ok) throw new Error(result?.error || 'The page refused the delete.');
  return { key };
}

export async function clearWebStorage({ tabId, area }) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [area],
    func: (a) => {
      const store = a === 'session' ? sessionStorage : localStorage;
      const n = store.length;
      store.clear();
      return { cleared: n };
    },
  });
  return result;
}
