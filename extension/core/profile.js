/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The profile: who did this work, in a form every export can carry.
 *
 * A person sets a name (and, if they like, a small picture) once in Settings. From then on every export ends with
 * one fine-print line, "Prepared by <name> · <date> · QA Wrap <version>", so a file that has left the machine can be
 * traced to its author. The same name goes into the sealed timeline (core/seal.js).
 *
 * This module is pure (no chrome.*, no DOM): the Node suites, the offscreen document that builds exports and the KPI
 * page all import it. It does not read storage itself, because core/ may not touch chrome.*: `loadProfile()` fetches
 * platform/profile-source.js on first use (which reads Settings), or uses the source a test registered with
 * `setProfileSource`. `loadProfile()` is the only reader anyone calls.
 *
 * The name is the tester's own word and goes into files other people open: it is cut to one line, stripped of
 * control and bidi-override characters, and capped. The picture stays on this machine as a small data URL and is
 * embedded only in the sealed timeline, never in the fine-print line.
 */

/** Longest name kept (matches the Settings field). */
export const NAME_MAX = 60;
/** Largest picture kept, as a data URL (a 128 px picture is far below this; a bigger one is refused, not shrunk silently). */
export const PICTURE_MAX = 60_000;

const PICTURE_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/* C0 and C1 controls, line and paragraph separators, and the bidi overrides/embeddings that could flip the line a reader sees. Isolates are added by us, never accepted. */
const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200E\u200F\uFEFF]/g;

/** A name as it may be printed: one line, no control or bidi characters, trimmed, at most NAME_MAX characters. */
export function cleanName(raw) {
  return String(raw ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** A picture the profile will keep: a small base64 image data URL, else ''. */
export function cleanPicture(raw) {
  const s = String(raw ?? '');
  return s.length <= PICTURE_MAX && PICTURE_RE.test(s) ? s : '';
}

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** True when the text holds Arabic script. */
export function hasArabic(text) {
  return ARABIC_RE.test(String(text ?? ''));
}

/**
 * @typedef {{ name: string, nameAr: string, nameEn: string, picture: string, named: boolean }} Profile
 * `name` is the single fallback name; `named` is true when any name is set (an unnamed profile still gets a trace line).
 */

/**
 * The profile in the one shape everything reads. A profile with only the older single name (`testerName`) has neither
 * language field, so that name migrates into the field for its script: Arabic letters to `nameAr`, else `nameEn`.
 * @returns {Profile}
 */
export function normaliseProfile(raw) {
  let nameAr = cleanName(raw?.nameAr ?? raw?.profileNameAr);
  let nameEn = cleanName(raw?.nameEn ?? raw?.profileNameEn);
  const legacy = cleanName(raw?.name ?? raw?.testerName);
  if (!nameAr && !nameEn && legacy) { if (hasArabic(legacy)) nameAr = legacy; else nameEn = legacy; }
  const name = legacy || nameEn || nameAr;
  return { name, nameAr, nameEn, picture: cleanPicture(raw?.picture ?? raw?.profilePicture), named: name !== '' };
}

/** The name for a language: its own, else the other one's, else the fallback ('' when none). */
export function pickName(profile, lang = 'en') {
  const p = normaliseProfile(profile);
  return String(lang).slice(0, 2).toLowerCase() === 'ar' ? (p.nameAr || p.nameEn || p.name) : (p.nameEn || p.nameAr || p.name);
}

/** One or two letters for an avatar with no picture ('' for no name). */
export function initials(name) {
  const words = cleanName(name).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 2).map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '').join('').toUpperCase();
}

/** @type {null | (() => Promise<{name?: string, nameAr?: string, nameEn?: string, picture?: string} | null | undefined>)} */
let source = null;
/** @type {Profile} */
let last = { name: '', nameAr: '', nameEn: '', picture: '', named: false };

/** A test (or a page with its own storage) may register where the profile lives; the default is platform/profile-source.js. */
export function setProfileSource(fn) {
  source = typeof fn === 'function' ? fn : null;
}

/**
 * The saved profile, read now. Never throws: a failed read gives the last good profile (or an unnamed one), because an
 * export must not fail over a missing name.
 * @returns {Promise<Profile>}
 */
export async function loadProfile() {
  try {
    // core/ may not import platform/ at load time or call chrome.*, so the reader is fetched on first use (a named exception in tools/test-layers.mjs)
    if (!source) source = (await import('../platform/profile-source.js')).readProfile;
    last = normaliseProfile(await source());
  } catch { /* keep the last good profile */ }
  return { ...last };
}

/** `YYYY-MM-DD` in the reader's local time, from a Date, a timestamp or an ISO string; today when absent or unreadable. */
export function dayOf(date) {
  const d = date === undefined || date === null || date === '' ? new Date() : new Date(date);
  const x = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

const FSI = '\u2068';
const PDI = '\u2069';
const iso = (s) => `${FSI}${s}${PDI}`;

/**
 * The fine-print trace line: name, date, tool version.
 *
 *   en  Prepared by Layla Haddad · 2026-11-09 · QA Wrap 3.8.4
 *   ar  إعداد: ليلى حداد · 2026-11-09 · QA Wrap 3.8.4
 *
 * With no name set the name part is dropped rather than invented ("Prepared with QA Wrap 3.8.4 · 2026-11-09").
 * In Arabic the name, date and tool are wrapped in bidi isolates so the Latin parts and digits keep their own order.
 * `profile` (from loadProfile()) or `name` may be passed; with neither, the last loaded profile is used. The name is the
 * one for `lang`, else the other language's, else the fallback; an explicit `name` wins.
 *
 * @param {{ lang?: string, date?: any, version?: string, name?: string, profile?: {name?: string, nameAr?: string, nameEn?: string} }} [o]
 */
export function traceLine({ lang = 'en', date, version = '', name, profile } = {}) {
  const who = name !== undefined && name !== null ? cleanName(name) : pickName(profile ?? last, lang);
  const day = dayOf(date);
  const tool = `QA Wrap${version ? ` ${String(version).replace(UNSAFE, '').slice(0, 24)}` : ''}`;
  if (String(lang).slice(0, 2).toLowerCase() === 'ar') {
    return who
      ? `إعداد: ${iso(who)} · ${iso(day)} · ${iso(tool)}`
      : `تم الإعداد بواسطة ${iso(tool)} · ${iso(day)}`;
  }
  return who ? `Prepared by ${who} · ${day} · ${tool}` : `Prepared with ${tool} · ${day}`;
}
