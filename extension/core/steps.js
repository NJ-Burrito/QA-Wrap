/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Step labels and repro steps.
 *
 * Split out of `core/artifact.js` (council-1009 r3, 10 October 2026): the defect
 * form `core/istqb.js` is in the service worker's boot graph and needs only
 * `reproSteps()` and the label helpers under it, not the 24 KB artefact builder
 * that used to ride along. `core/artifact.js` re-exports everything here, so no
 * importer changes. Pure; no imports.
 */

/* ── labels: what a step is allowed to be called ──────────────────────── */

/**
 * A label is a name a person can read, and it has to fit where it is drawn. Decided once, here, where an event becomes
 * words: decode before showing (never percent-encoding), a selector is never shown as a name, nothing is unbounded
 * (a node label fits its box, a line of prose fits a line). The locator, the full URL and the event itself are still
 * in the session and the JSON export; this governs what a reader is shown, not what is kept.
 */

/** The longest a label may be inside a diagram node (it must fit the box). */
export const LABEL_MAX = 28;
/**
 * The longest a label may be in a line of prose — a repro step, a requirement.
 * Wider than a node because a line of Markdown is wider than a 150px box, and
 * a full button name is worth having in a ticket. Same rule, different vessel.
 */
export const LABEL_PROSE_MAX = 80;

/** `decodeURIComponent` throws on a lone `%`; a bad escape is not a crash. */
export const decodeSafe = (s) => { try { return decodeURIComponent(String(s ?? '')); } catch { return String(s ?? ''); } };

/**
 * Cap a label. A path loses its middle, because both ends carry meaning
 * (`/Ar/Pages/…/drug-registration`); prose loses its tail, the way prose does.
 */
export function clampLabel(text, max = LABEL_MAX) {
  // Bidi controls are stripped, not counted and never cut: an isolate cut in
  // half by a cap leaves an opening FSI with no PDI, and everything after it on
  // the line resolves in the wrong direction. Direction is applied where the
  // text is drawn, once, on a line that is already the width it will be.
  const s = String(text ?? '').replace(/[\u200E\u200F\u2066-\u2069\u202A-\u202E]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  if (/[/\\]/.test(s)) {
    const keep = max - 1;
    return `${s.slice(0, Math.ceil(keep / 2))}…${s.slice(s.length - Math.floor(keep / 2))}`;
  }
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Elements whose accessible name is the page, not the control: a container's name is all the text inside it. */
const CONTAINER_ROLES = new Set([
  'header', 'banner', 'nav', 'navigation', 'main', 'footer', 'contentinfo',
  'aside', 'complementary', 'section', 'region', 'article', 'body', 'html',
  'ul', 'ol', 'dl', 'list', 'menu', 'menubar', 'toolbar', 'table', 'tbody', 'thead', 'tr',
]);

/** Several words welded together (`PermitsportalHelpStatusDownloads`) are not a phrase: one long unspaced token with 2+ lower-to-upper steps. `eBay`, `PayPal`, `MyAccount` stay names. */
export function isRunOnName(text) {
  const token = String(text ?? '').trim().split(/\s+/).sort((a, b) => b.length - a.length)[0] || '';
  if (token.length < 14) return false;
  const steps = (token.match(/[a-z\u0600-\u06FF][A-Z]/g) || []).length;
  return steps >= 2;
}

/** Is this string a CSS selector rather than a name? A `{…}` body never is a name; otherwise only a string with no spaces is tested (`.NET Developer` is a name). */
export function isSelectorLike(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (/[{}]/.test(s)) return true;
  if (/(^|\s)[>+~](\s|$)/.test(s)) return true;
  if (/\s/.test(s)) return false;
  return /^[#.[]|::|\[[\w-]+[$^*|~]?=|\]$/.test(s);
}

/**
 * What to call the element a step acted on: its accessible name if it has one
 * a person could read, otherwise its role or tag, otherwise nothing — and the
 * caller says "an element" in its own language.
 */
export function stepLabel(ev, max = LABEL_MAX) {
  const raw = String(ev?.label ?? '').replace(/\s+/g, ' ').trim();
  const role = String(ev?.role || ev?.tag || '').trim();
  // A container's name is everything inside it, and a run-on is several names
  // with the spaces eaten. Neither is a phrase, so neither is shown: what the
  // thing is beats a shortened copy of what it contains.
  const container = CONTAINER_ROLES.has(role.toLowerCase()) || CONTAINER_ROLES.has(String(ev?.role || '').toLowerCase());
  if (raw && !isSelectorLike(raw) && !isRunOnName(raw) && !container) return clampLabel(raw, max);
  return role && !isSelectorLike(role) ? clampLabel(role, max) : '';
}

/** A URL's path, decoded and capped: what a failure or a request is against. */
export function pathLabel(url, max = LABEL_MAX) {
  let u;
  try { u = new URL(url); } catch { return clampLabel(decodeSafe(url || ''), max); }
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : u.host;
  return clampLabel(decodeSafe(path), max);
}

/**
 * What to call a page that was opened: the title if the recording has one,
 * else the last segment of the path that means anything — decoded, without its
 * file extension, with the separators read as spaces. `/Ar/Pages/Default.aspx`
 * is "Pages", not "Default.aspx"; a percent-encoded Arabic segment is the
 * Arabic word it stands for; a bare origin is the host.
 */
const GENERIC_SEGMENT = /^(pages?|ar|en|ara|eng|site|sites|web|www|public|content|portal)$/i;

export function pageLabel(url, title = '', max = LABEL_MAX) {
  const named = String(title ?? '').trim();
  if (named) return clampLabel(named, max);
  let u;
  try { u = new URL(url); } catch { return clampLabel(decodeSafe(url || ''), max); }
  const segs = u.pathname.split('/').map((seg) => decodeSafe(seg).trim()).filter(Boolean);
  while (segs.length && /^(index|default|home|main)(\.\w+)?$/i.test(segs[segs.length - 1])) segs.pop();
  const last = segs[segs.length - 1] || '';
  const clean = last.replace(/\.(html?|aspx?|php|jsp|do)$/i, '').replace(/[-_+]+/g, ' ').trim();
  // A segment that names the site's plumbing rather than the page is no better
  // than nothing: /Ar/Pages/Default.aspx is the home page, and "Pages" tells a
  // reader less than the host does.
  return clampLabel(!clean || GENERIC_SEGMENT.test(clean) ? u.host : clean, max);
}

export function describeDom(ev) {
  // The name if it is one, then the locator — which is a selector on purpose
  // here: in a repro step a locator is evidence, and it is the thing a person
  // pastes into a test. What it must not be is unbounded or percent-encoded.
  const target = stepLabel(ev, LABEL_PROSE_MAX) || ev.locator || ev.selector || ev.tag || 'element';
  switch (ev.action) {
    case 'click':
      return `${ev.button === 2 ? 'Right-click' : ev.button === 1 ? 'Middle-click' : 'Click'} **${target}**`;
    case 'dblclick':
      return `Double-click **${target}**`;
    case 'input':
      return `Fill **${target}** with \`${ev.value}\``;
    case 'change':
      return `Set **${target}** to \`${ev.control === 'select-multiple' ? String(ev.value).split('\n').join(', ') : ev.value}\``;
    case 'upload':
      return `Upload \`${ev.value}\` to **${target}**`;
    case 'submit':
      return `Submit **${target}**`;
    case 'keydown':
      return `Press \`${ev.key}\` on **${target}**`;
    default:
      return `${ev.action} on **${target}**`;
  }
}


/** r2-05-2: one action, one step: a submit within 500 ms of the button click or Enter that caused it, or a click within 500 ms of Enter on the same element, is dropped. */
export function dropDoubleSubmits(events) {
  let last = null;
  const out = events.filter((e) => {
    if (e.kind !== 'dom') return true;
    if (e.trusted === false) return true;
    const enter = last?.action === 'keydown' && last.key === 'Enter';
    const near = e.ts - last?.ts >= 0 && e.ts - last.ts <= 500;
    const key = (x) => x.locator || x.selector;
    if (near && ((e.action === 'submit' && (enter || (last.action === 'click' && /^(button|input)$/i.test(last.tag)))) || (e.action === 'click' && enter && key(e) && key(e) === key(last)))) return false;
    last = e;
    return true;
  });
  // D-1010-50: a dblclick replaces the (up to two) plain clicks on the same element within 500 ms before it.
  const fold = new Set();
  out.forEach((e, i) => {
    const key = e.locator || e.selector;
    if (e.kind !== 'dom' || e.action !== 'dblclick' || !key) return;
    for (let j = i - 1, n = 0; j >= 0 && n < 2; j--) {
      const c = out[j];
      if (c.kind !== 'dom') continue;
      if (c.action !== 'click' || c.button || (c.locator || c.selector) !== key || e.ts - c.ts > 500) break;
      fold.add(j);
      n++;
    }
  });
  return fold.size ? out.filter((_, i) => !fold.has(i)) : out;
}

/** Repro steps = the DOM/nav stream only, numbered; `byPage` = DOC_LABELS.byPage, the tag on a page-scripted step. */
export function reproSteps(events, byPage = '(by the page)') {
  const steps = dropDoubleSubmits(events).filter((e) => e.kind === 'dom' || e.kind === 'nav');
  return steps.map((e, i) => {
    const body = e.kind === 'nav' ? `Navigate to ${e.url}` : describeDom(e).replace(/\*\*/g, '');
    return `${i + 1}. ${body}${e.trusted === false ? ` ${byPage}` : ''}`;
  });
}
