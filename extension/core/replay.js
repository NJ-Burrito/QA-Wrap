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
  const first = log.find((e) => e.k === 'snapshot');
  if (!first) return null;

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

  for (const e of log) {
    if ((e.t || 0) > at) break;
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

/** One node as HTML. Inert by construction — see the header. */
export function toHtml(node) {
  if (!node) return '';
  if (node.t === 3) return escText(node.v);
  if (node.t !== 1) return '';
  const tag = String(node.n || '').toUpperCase();
  if (FORBIDDEN.has(tag)) return '';

  const name = tag.toLowerCase();
  const parts = [];
  for (const [k, v] of Object.entries(node.a || {})) {
    if (/^(on|srcdoc$)/i.test(k) || !/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue; // r2-02-3: an attribute name from a log is never markup
    parts.push(`${k}="${escAttr(URL_ATTRS.has(k) ? 'about:blank' : v)}"`);
  }
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
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
    `<title>${escText(state.title || '')}</title>` +
    '<style>[data-uqa-masked]{position:relative}' +
    '[data-uqa-masked]::after{content:"";position:absolute;inset:0;background:#1D2024;border-radius:3px}' +
    '</style></head>' +
    (toHtml(state.doc?.c?.find((c) => String(c.n).toUpperCase() === 'BODY')) || `<body>${toHtml(state.doc)}</body>`) +
    '</html>'
  );
}

/** First and last timestamps in the log — the scrubber's range. */
export function span(entries) {
  const log = entries || [];
  if (!log.length) return { from: 0, to: 0, ms: 0 };
  const from = log[0].t || 0;
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
