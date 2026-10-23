/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Update check: one unauthenticated GET of GitHub's releases/latest, nothing else. No cookies, no ids, no body.
 * Loaded on demand by the offscreen document (offscreen/offscreen.js, op 'update'); never part of the worker's boot graph.
 * The owner/repo lives in core/update-source.json only. While it still says OWNER/REPO nothing is requested.
 * Private repo: an OPTIONAL read-only token the tester pasted (Settings, key qawUpdateToken) rides as a Bearer header. It never enters the stored state.
 * Every failure (404 included: a private repo without a token) is silent: the answer is the old state, or null (nothing to write).
 */

import { BUILD_DIST, BUILD_FLAVOUR } from './rate-links.js';

const REPO_RE = /^\w[\w.-]*\/\w[\w.-]*$/;
const BACKOFF_MS = 60 * 60 * 1000;
const NOTES_MAX = 4000;

/** `v3.5.10` -> [3,5,10]; a pre-release (`3.6.0-beta.1`), a build tag or junk -> null (never offered). */
export function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when `latest` is a clean release strictly above `current`. Numeric, so 3.5.10 > 3.5.9. */
export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export const validRepo = (repo) => REPO_RE.test(String(repo ?? '')) && repo !== 'OWNER/REPO';

const safeUrl = (u, fallback) => (/^https:\/\/github\.com\//.test(String(u)) ? String(u) : fallback);

/** The release JSON -> what the card needs, or null for a draft, a pre-release or a tag that is not a clean version. */
export function pickRelease(j, repo, dist = BUILD_DIST + (BUILD_FLAVOUR ? `-${BUILD_FLAVOUR}` : '')) {
  if (!j || j.draft || j.prerelease || !parseVersion(j.tag_name)) return null;
  const zips = (Array.isArray(j.assets) ? j.assets : []).filter((a) => /\.zip$/i.test(String(a?.browser_download_url)) && /^https:\/\/github\.com\//.test(String(a?.browser_download_url)));
  const ver = String(j.tag_name).replace(/^v/, '');
  const named = (n) => zips.find((a) => String(a?.name) === n);
  // This build's own asset (qa-wrap-<ver>-<dist>.zip), else the chrome alias qa-wrap-<ver>.zip that 3.6.x-3.7.x releases carry.
  // The host still checks the zip's name and key before it swaps anything.
  const z = named(`qa-wrap-${ver}-${dist}.zip`) || named(`qa-wrap-${ver}.zip`) || zips.find((a) => /^qa-wrap-\d+\.\d+\.\d+\.zip$/.test(String(a?.name))) || zips[0];
  const api = /^https:\/\/api\.github\.com\/repos\//.test(String(z?.url)) ? String(z.url) : ''; // the token-readable asset URL of a private repo
  const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, NOTES_MAX);
  return {
    version: String(j.tag_name).replace(/^v/, ''),
    url: safeUrl(j.html_url, `https://github.com/${repo}/releases/latest`),
    zip: z ? String(z.browser_download_url) : '',
    zipApi: api,
    sha256: /^sha256:[0-9a-f]{64}$/.test(String(z?.digest)) ? String(z.digest).slice(7) : '', // GitHub's own digest of the asset, when it gives one
    notes: clean(j.body),
  };
}

/**
 * @param {{repo: string, current: string, state?: any, token?: string, fetch?: typeof fetch, now?: number}} a
 * @returns {Promise<any|null>} the new state to store, or null when nothing should change
 */
export async function checkLatest({ repo, current, state = {}, token = '', fetch: f = globalThis.fetch, now = Date.now() }) {
  if (!validRepo(repo) || !parseVersion(current)) return null;
  if (state?.backoffUntil > now) return null;
  const headers = { Accept: 'application/vnd.github+json' };
  if (state?.etag) headers['If-None-Match'] = state.etag;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await f(`https://api.github.com/repos/${repo}/releases/latest`, { method: 'GET', headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (res.status === 304) return { ...state, checkedAt: now };
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers?.get?.('x-ratelimit-reset')) * 1000 - now;
      const wait = Number(res.headers?.get?.('retry-after')) * 1000;
      return { ...state, backoffUntil: now + Math.min(Math.max(wait || reset || BACKOFF_MS, BACKOFF_MS), 24 * BACKOFF_MS) };
    }
    if (!res.ok) return null;
    const rel = pickRelease(await res.json(), repo);
    return { etag: res.headers?.get?.('etag') || '', checkedAt: now, latest: rel && isNewer(rel.version, current) ? rel : null };
  } catch { return null; }
}

/** The offscreen door: `{ state, version }` from the worker -> the state to store, or null. */
export async function run({ state, version, token }) {
  const src = await (await fetch(new URL('./update-source.json', import.meta.url))).json();
  return checkLatest({ repo: src.repo, current: version, state, token });
}
