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
 * page all import it. It does not read storage itself, because core/ may not touch chrome.*; instead
 * platform/settings.js registers the one source (`setProfileSource`) when it loads, and every page that reads
 * settings has therefore registered it. `loadProfile()` is the only reader anyone calls.
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
const UNSAFE = /[\u0000-\u001F\u007F-\u009F  ‪-‮⁦-⁩‎‏﻿]/g;

/** A name as it may be printed: one line, no control or bidi characters, trimmed, at most NAME_MAX characters. */
export function cleanName(raw) {
  return String(raw ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** A picture the profile will keep: a small base64 image data URL, else ''. */
export function cleanPicture(raw) {
  const s = String(raw ?? '');
  return s.length <= PICTURE_MAX && PICTURE_RE.test(s) ? s : '';
}

/**
 * @typedef {{ name: string, picture: string, named: boolean }} Profile
 * `named` is true when the person has set a name; an unnamed profile still produces a trace line (date and tool).
 */

/** @returns {Profile} */
export function normaliseProfile(raw) {
  const name = cleanName(raw?.name);
  return { name, picture: cleanPicture(raw?.picture), named: name !== '' };
}

/** @type {null | (() => Promise<{name?: string, picture?: string} | null | undefined>)} */
let source = null;
/** @type {Profile} */
let last = { name: '', picture: '', named: false };

/** platform/settings.js registers where the profile lives. A test may register its own. */
export function setProfileSource(fn) {
  source = typeof fn === 'function' ? fn : null;
}

/**
 * The saved profile, read now. Never throws: a failed read gives the last good profile (or an unnamed one), because an
 * export must not fail over a missing name.
 * @returns {Promise<Profile>}
 */
export async function loadProfile() {
  if (source) {
    try { last = normaliseProfile(await source()); } catch { /* keep the last good profile */ }
  }
  return { ...last };
}

/** `YYYY-MM-DD` in the reader's local time, from a Date, a timestamp or an ISO string; today when absent or unreadable. */
export function dayOf(date) {
  const d = date === undefined || date === null || date === '' ? new Date() : new Date(date);
  const x = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

const FSI = '⁨';
const PDI = '⁩';
const iso = (s) => `${FSI}${s}${PDI}`;

/**
 * The fine-print trace line: name, date, tool version.
 *
 *   en  Prepared by Layla Haddad · 2026-11-09 · QA Wrap 3.8.4
 *   ar  إعداد: ليلى حداد · 2026-11-09 · QA Wrap 3.8.4
 *
 * With no name set the name part is dropped rather than invented ("Prepared with QA Wrap 3.8.4 · 2026-11-09").
 * In Arabic the name, date and tool are wrapped in bidi isolates so the Latin parts and digits keep their own order.
 * `profile` (from loadProfile()) or `name` may be passed; with neither, the last loaded profile is used.
 *
 * @param {{ lang?: string, date?: any, version?: string, name?: string, profile?: {name?: string} }} [o]
 */
export function traceLine({ lang = 'en', date, version = '', name, profile } = {}) {
  const who = cleanName(name ?? profile?.name ?? last.name);
  const day = dayOf(date);
  const tool = `QA Wrap${version ? ` ${String(version).replace(UNSAFE, '').slice(0, 24)}` : ''}`;
  if (String(lang).slice(0, 2).toLowerCase() === 'ar') {
    return who
      ? `إعداد: ${iso(who)} · ${iso(day)} · ${iso(tool)}`
      : `تم الإعداد بواسطة ${iso(tool)} · ${iso(day)}`;
  }
  return who ? `Prepared by ${who} · ${day} · ${tool}` : `Prepared with ${tool} · ${day}`;
}

/* ── where the line goes, per format ─────────────────────────────────────── */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text inside an XML/HTML comment: `--` is illegal inside one. */
const inComment = (s) => String(s).replace(/-(?=-)/g, '- ');

/**
 * Add the trace line to a finished text export, in the form its format can carry without breaking it:
 * Markdown/text a closing line, HTML a small footer, JSON a `_trace` field (HAR: `log.comment`), CSV/YAML/TS a comment
 * line, XML/SVG a comment. Binary (`encoding`) outputs are left to their builders (workbooks take it as a row; a zip
 * carries it in every part). Returns a new object; an unknown or unparsable text is returned unchanged.
 *
 * @param {{ filename?: string, content?: any, encoding?: string }} out
 * @param {string} line
 */
export function withTrace(out, line) {
  if (!out || !line || out.encoding || typeof out.content !== 'string') return out;
  const name = String(out.filename || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  const text = out.content;
  const tail = text.replace(/\s+$/, '');
  let content;
  switch (ext) {
    case 'md': case 'txt':
      content = `${tail}\n\n${line}\n`; break;
    case 'html': {
      const p = `<p class="qaw-trace" style="margin:24px 0 8px;font-size:11px;color:#595959;text-align:center">${escHtml(line)}</p>`;
      const at = text.toLowerCase().lastIndexOf('</body>');
      content = at >= 0 ? `${text.slice(0, at)}${p}\n${text.slice(at)}` : `${tail}\n${p}\n`;
      break;
    }
    case 'json': case 'har': {
      try {
        const doc = JSON.parse(text);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
        if (ext === 'har' && doc.log && typeof doc.log === 'object') doc.log = { ...doc.log, comment: line };
        else doc._trace = line;
        content = JSON.stringify(doc, null, 2);
      } catch { return out; }
      break;
    }
    case 'csv': case 'yaml': case 'yml': case 'ts':
      content = `${tail}\n${ext === 'ts' ? '//' : '#'} ${line.replace(/[\r\n]+/g, ' ')}\n`; break;
    case 'xml': case 'svg':
      content = `${tail}\n<!-- ${inComment(line)} -->\n`; break;
    default:
      return out;
  }
  return { ...out, content };
}
