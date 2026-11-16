/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Session replay, the playback half: a log of DOM changes back into a document.
 *
 * Pure functions, no `chrome`, no IndexedDB, no DOM of its own — so the replay
 * page uses them and `tools/test-replay.mjs` checks them in plain Node. The
 * recorder is `content/replay-recorder.js`; the store is `core/db.js`.
 *
 * ── the shape of a log ─────────────────────────────────────────────────────
 *
 * One `snapshot` entry, then a stream of changes, each stamped `t` in
 * milliseconds since the session's clock started:
 *
 *   snapshot  { doc, url, title, w, h, x, y }   the whole document, once
 *   add       { parent, before, nodes }         nodes inserted
 *   remove    { id }                            a node taken out
 *   attr      { id, name, v }                   one attribute
 *   text      { id, v }                         a text node's new value
 *   input     { id, v, checked }                what was typed
 *   scroll    { x, y }                          where the page was
 *   css       { id, v }                         a stylesheet's rules, as text (a <style> or a <link>)
 *   viewport  { w, h }                          how big the window was
 *
 * A node is `{ t: 1, id, n, a, c, value?, checked?, masked? }` for an element
 * and `{ t: 3, v }` for text. Ids are the recorder's own and mean nothing
 * outside one log.
 *
 * ── it is rebuilt as HTML, not as a live document ──────────────────────────
 *
 * `toHtml()` renders the state at a given moment into a string that goes into a
 * sandboxed iframe's `srcdoc`. Not `innerHTML` on a live node, and not a
 * document the player can touch: the iframe is `sandbox` with nothing granted,
 * so scripts do not run and no origin is shared. Three things are stripped or
 * blanked on the way out, and each one is a way a replay could otherwise reach
 * the network or the page around it:
 *
 *   `<script>` and friends   never serialised by the recorder, and dropped
 *                            again here, because a log can arrive from an
 *                            older build.
 *   `<base>`                 a base tag would re-point every relative URL in
 *                            the replay at a real origin.
 *   src / href / action      recorded as empty strings; rendered as `about:blank`
 *                            or dropped, so nothing is fetched.
 *
 * The result is a picture that cannot phone home, which is the same promise the
 * exported report makes.
 */

/** Tags that never make it into a replay, whatever the log says. */
const FORBIDDEN = new Set([
  'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'OBJECT', 'EMBED', 'APPLET', 'BASE', 'META', 'LINK', 'IFRAME', 'FRAME',
]);

/** Attributes that would fetch something. Rendered inert rather than removed,
 *  so the layout an `img` reserves is still reserved. */
const URL_ATTRS = new Set(['src', 'srcset', 'href', 'action', 'formaction', 'data', 'poster', 'ping', 'background', 'xlink:href']);

const VOID = new Set([
  'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR',
]);

const escText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

/** A deep copy, so replaying does not mutate the caller's log. */
const clone = (node) => JSON.parse(JSON.stringify(node));

/**
 * Every node in a tree, by id — the index every mutation is applied through.
 *
 * Built once per rebuild rather than searched per entry: a long session is tens
 * of thousands of entries, and a linear search per entry is what turns a scrub
 * into a freeze.
 */
export function indexNodes(root, into = new Map(), parents = new Map()) {
  if (!root) return { byId: into, parentOf: parents };
  if (root.id != null) into.set(root.id, root);
  for (const child of root.c || []) {
    if (child.t === 1) parents.set(child.id, root);
    indexNodes(child, into, parents);
  }
  return { byId: into, parentOf: parents };
}

/**
 * The document as it stood at `at` milliseconds.
 *
 * Replayed from the snapshot forward every time rather than kept as a moving
 * cursor. Scrubbing backwards is the common case — a tester lands on the
 * failure and steps back to see what they pressed — and a cursor that can only
 * go forward has to rebuild from the start for that anyway. This way there is
 * one code path, and it is the one that is tested.
 */
export function stateAt(entries, at) {
  const log = entries || [];
  // A session crosses pages: show the page whose snapshot is the latest at `at`
  // (or the first, before any), and apply only that page's own changes after it.
  let first = null;
  let from = 0;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.k !== 'snapshot') continue;
    if (!first || (e.t || 0) <= at) { first = e; from = i; }
    if ((e.t || 0) > at) break;
  }
  if (!first) return null;
  const pageOf = first.p;

  const doc = clone(first.doc);
  let { byId, parentOf } = indexNodes(doc);
  const state = {
    url: first.url,
    title: first.title,
    w: first.w,
    h: first.h,
    scroll: { x: first.x || 0, y: first.y || 0 },
    doc,
    applied: 0,
    skipped: 0,
  };

  for (let i = from + 1; i < log.length; i++) {
    const e = log[i];
    if ((e.t || 0) > at) break;
    if (e.p !== pageOf) continue; // another page's change: its ids mean other nodes
    switch (e.k) {
      case 'snapshot':
        break;
      case 'attr': {
        const n = byId.get(e.id);
        if (!n) { state.skipped++; break; }
        n.a = { ...(n.a || {}), [e.name]: e.v };
        state.applied++;
        break;
      }
      case 'text': {
        const n = byId.get(e.id);
        if (!n) { state.skipped++; break; }
        n.c = [{ t: 3, v: e.v }];
        delete n.css; // a <style> rewritten as text: the text is the sheet now
        state.applied++;
        break;
      }
      case 'css': {
        const n = byId.get(e.id);
        if (!n) { state.skipped++; break; }
        n.css = String(e.v ?? '');
        state.applied++;
        break;
      }
      case 'input': {
        const n = byId.get(e.id);
        if (!n) { state.skipped++; break; }
        n.value = e.v;
        if (e.checked !== undefined) n.checked = e.checked;
        state.applied++;
        break;
      }
      case 'add': {
        const parent = byId.get(e.parent);
        if (!parent) { state.skipped++; break; }
        parent.c = parent.c || [];
        if (parent.css !== undefined && String(parent.n).toUpperCase() === 'STYLE') delete parent.css;
        const nodes = (e.nodes || []).map(clone);
        const i = e.before == null ? parent.c.length : parent.c.findIndex((c) => c.id === e.before);
        parent.c.splice(i < 0 ? parent.c.length : i, 0, ...nodes);
        for (const n of nodes) {
          if (n.t === 1) parentOf.set(n.id, parent);
          indexNodes(n, byId, parentOf);
        }
        state.applied++;
        break;
      }
      case 'remove': {
        const parent = parentOf.get(e.id);
        if (!parent) { state.skipped++; break; }
        parent.c = (parent.c || []).filter((c) => c.id !== e.id);
        byId.delete(e.id);
        state.applied++;
        break;
      }
      case 'scroll':
        state.scroll = { x: e.x, y: e.y };
        state.applied++;
        break;
      case 'viewport':
        state.w = e.w;
        state.h = e.h;
        state.applied++;
        break;
      default:
        state.skipped++;
    }
  }
  return state;
}

/**
 * A stylesheet's text, safe inside `<style>`. That element is raw text, so nothing is entity-escaped (an escaped `>` is a broken
 * child selector); the only way out of it is a closing tag, and `<\/` is the same CSS with no tag in it. `@import` would fetch.
 */
const cssText = (s) => String(s ?? '').replace(/<\//g, '<\\/').replace(/@import\b[^;]*;?/gi, '');

/** A `<style>` for a recorded sheet: a `<style>` element, or a `<link>` whose rules the recorder kept. '' when there is nothing to show. */
function styleHtml(node) {
  const css = node.css !== undefined ? node.css : (node.c || []).map((c) => (c.t === 3 ? c.v : '')).join('');
  if (!css) return '';
  const media = String(node.a?.media || '');
  return `<style${media && !/[<>"]/.test(media) ? ` media="${escAttr(media)}"` : ''}>${cssText(css)}</style>`;
}

/** The recorded sheets of a tree, in document order: what the head of a replay is made of. */
function sheetsOf(node, out = []) {
  if (!node || node.t !== 1) return out;
  const tag = String(node.n || '').toUpperCase();
  if (tag === 'STYLE' || (tag === 'LINK' && node.css !== undefined)) out.push(styleHtml(node));
  else for (const c of node.c || []) sheetsOf(c, out);
  return out;
}

/** An element's attributes as markup; the same filter for every element, `<html>` and `<body>` included. */
function attrsHtml(node) {
  const parts = [];
  for (const [k, v] of Object.entries(node?.a || {})) {
    if (/^(on|srcdoc$)/i.test(k) || !/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue; // r2-02-3: an attribute name from a log is never markup
    parts.push(`${k}="${escAttr(URL_ATTRS.has(k) ? 'about:blank' : v)}"`);
  }
  return parts;
}

/** One node as HTML. Inert by construction — see the header. */
export function toHtml(node) {
  if (!node) return '';
  if (node.t === 3) return escText(node.v);
  if (node.t !== 1) return '';
  const tag = String(node.n || '').toUpperCase();
  if (tag === 'STYLE') return styleHtml(node);
  if (tag === 'LINK' && node.css !== undefined) return styleHtml(node);
  if (FORBIDDEN.has(tag)) return '';

  const name = tag.toLowerCase();
  const parts = attrsHtml(node);
  if (node.value !== undefined && (tag === 'INPUT' || tag === 'TEXTAREA')) {
    parts.push(`value="${escAttr(node.value)}"`);
  }
  if (node.checked) parts.push('checked');

  const open = `<${name}${parts.length ? ' ' + parts.join(' ') : ''}>`;
  if (VOID.has(tag)) return open;
  const inner = tag === 'TEXTAREA'
    ? escText(node.value ?? '')
    : (node.c || []).map(toHtml).join('');
  return `${open}${inner}</${name}>`;
}

/**
 * A whole document for the iframe's `srcdoc`.
 *
 * The CSP is belt as well as braces: the iframe is already sandboxed with
 * nothing granted, and this says the same thing again in a header the page
 * cannot argue with. `default-src 'none'` with `style-src 'unsafe-inline'` is
 * exactly what a replay needs — inline style attributes, and not one byte
 * fetched.
 */
export function toDocument(state) {
  if (!state) return '<!doctype html><meta charset="utf-8"><p>Nothing was recorded.</p>';
  const kids = state.doc?.c || [];
  const is = (tag) => (c) => c.t === 1 && String(c.n).toUpperCase() === tag;
  const head = kids.find(is('HEAD'));
  const body = kids.find(is('BODY'));
  const html = attrsHtml(state.doc);
  // The page is shown where it was scrolled to. Nothing runs in the frame, so nothing can scroll it: the root is moved instead
  // (relative, so what was laid out against the page moves with it and what was fixed to the window stays).
  const x = Math.round(Number(state.scroll?.x) || 0);
  const y = Math.round(Number(state.scroll?.y) || 0);
  return (
    `<!doctype html><html${html.length ? ' ' + html.join(' ') : ''}><head><meta charset="utf-8">` +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
    `<title>${escText(state.title || '')}</title>` +
    // Before the page's own sheets, so they win: an image is an empty box in a replay, and an icon with no sheet to size it is not a wall.
    '<style>img,video,canvas,iframe{background:rgba(127,127,127,.16)}' +
    (missingSheets(head) ? 'svg:not([width]):not([style*="width"]){inline-size:1.25em;block-size:1.25em}img:not([width]){max-inline-size:100%}' : '') +
    '</style>' +
    sheetsOf(head).join('') +
    // After them, so these hold.
    '<style>[data-uqa-masked]{position:relative}' +
    '[data-uqa-masked]::after{content:"";position:absolute;inset:0;background:#1D2024;border-radius:3px}' +
    `html{overflow:hidden!important;scroll-behavior:auto!important${x || y ? `;position:relative!important;left:${-x}px!important;top:${-y}px!important` : ''}}` +
    '</style></head>' +
    (toHtml(body) || `<body>${toHtml(state.doc)}</body>`) +
    '</html>'
  );
}

/** True when the page had stylesheet files whose rules are not in the log: every replay recorded before 3.9.5, and a sheet served from another site. */
export function missingSheets(head) {
  return (head?.c || []).some((c) => c.t === 1 && String(c.n).toUpperCase() === 'LINK' && /stylesheet/i.test(c.a?.rel || '') && c.css === undefined);
}

/** First and last timestamps in the log — the scrubber's range. */
export function span(entries) {
  const log = entries || [];
  if (!log.length) return { from: 0, to: 0, ms: 0 };
  const from = 0; // the session clock starts at 0; the first page may open later
  const to = log.reduce((n, e) => Math.max(n, e.t || 0), from);
  return { from, to, ms: to - from };
}

/**
 * The moments worth a mark on the scrubber.
 *
 * Taken from the session's own events rather than from the replay: the replay
 * knows the DOM changed, not that a request failed. `ts` is wall clock on the
 * event and `t` is milliseconds since the session started, so the session's
 * `startedAt` is what turns one into the other.
 */
export function failureMarks(events, startedAt) {
  return (events || [])
    .filter((e) => e.fail === 1 || e.fail === true)
    .map((e) => ({
      t: Math.max(0, (e.ts || 0) - (startedAt || 0)),
      what: e.kind === 'net' ? `${e.method || ''} ${e.url || ''}`.trim() : e.kind || 'failure',
    }))
    .sort((a, b) => a.t - b.t);
}

/** "1.4 MB", "812 KB", "0 B" — the size the page prints beside the scrubber. */
export function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
