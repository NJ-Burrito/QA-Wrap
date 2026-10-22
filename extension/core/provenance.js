/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Provenance: whose tool made this, in a way that survives being copied.
 *
 * ── the mistake this replaces ─────────────────────────────────────────────
 *
 * The first version burned a plate of text into every screenshot. It was ugly,
 * it sat on top of the page it was documenting, and it was the wrong instinct
 * entirely: a QA tool exists to record what a screen showed, and drawing on
 * that record is exactly the contamination the shadow-root work spent a day
 * removing from the other direction.
 *
 * So **nothing is painted on evidence any more.** The mark lives where it
 * belongs instead — in the file's own metadata, in the document's own footer,
 * in the ticket's own properties — and it is designed to be found rather than
 * seen.
 *
 * ── three layers, because three different readers ─────────────────────────
 *
 * **A person glancing** gets one glyph and two words. `◈ QA Wrap`. Not a
 * sentence, not a logo, not a banner. Long enough to recognise, short enough
 * that nobody resents it.
 *
 * **A person looking** gets a footer line: the tool, the version, the owner,
 * the session, the time. One line, at the bottom, where a colophon goes.
 *
 * **A machine** gets `qaw1:<payload>.<check>` — a self-describing, greppable,
 * checksummed token. It says what it is in its first four characters, so an
 * agent that has never heard of this tool can still recognise it, parse it and
 * attribute the file correctly. That is the point: the copyright is only worth
 * something if the thing that finds the file can read it.
 *
 * ── and it is honest about what it is ─────────────────────────────────────
 *
 * This is **attribution, not a seal**. The token is signed with a checksum so
 * tampering is detectable, not with a key so tampering is impossible — an
 * extension cannot hold a private key that the person running it cannot read.
 * Anyone determined can strip any of this in seconds. What it does is make
 * accidental loss of attribution very unlikely and deliberate removal
 * demonstrable, and that is a real and useful thing without pretending to be
 * cryptographic provenance.
 */

import { PRODUCT } from './product.js';

/* ── who ───────────────────────────────────────────────────────────────── */

export const MAKER = {
  product: /** @type {string} */ (PRODUCT.name),
  full: PRODUCT.name,
  /** Who holds the rights: from brand/brand.json through ./product.js. */
  owner: /** @type {string} */ (PRODUCT.maker),
  publisher: PRODUCT.publisher,
  tagline: PRODUCT.tagline,
  /** Printed as plain text in document footers (T-057). Empty while the owner has no website: the footer then omits it. */
  url: PRODUCT.homepage,
  kind: 'Local-first QA toolkit',
  /** The year the work started; a range is rendered from it. */
  since: PRODUCT.since,
};

/** The one glyph. Distinctive, one character, renders everywhere. */
export const GLYPH = '◈';

/**
 * `© 2026 QA Wrap. Released under the MIT licence.`
 *
 * The owner and nothing else. A copyright notice names the rights holder; the
 * product name belongs beside it, not inside it — carrying both made every
 * banner say "QA Wrap" twice.
 */
export function copyright(when = Date.now()) {
  const year = new Date(when).getFullYear();
  const span = year > MAKER.since ? `${MAKER.since}–${year}` : String(MAKER.since);
  return `© ${span} ${MAKER.owner}. Released under the MIT licence.`;
}

/* ── the mark, for a person ────────────────────────────────────────────── */

/** Two words and a glyph. The whole visible mark. */
export const SHORT = `${GLYPH} ${MAKER.product}`;

const iso = (when) => new Date(when || Date.now()).toISOString().replace('T', ' ').slice(0, 16);

/**
 * The colophon line.
 *
 * Deliberately one line and deliberately at the bottom. The useful part six
 * months later is not the product name — it is the session id, which is the
 * only thing that ties a loose file back to the run that produced it.
 */
export function stamp({ session, version, when } = {}) {
  const parts = [`${GLYPH} ${MAKER.product}${version ? ` ${version}` : ''}`];
  // The owner is named only when it is not already the product, so the line
  // never reads "QA Wrap 3.0.0 · QA Wrap".
  if (MAKER.owner !== MAKER.product) parts.push(MAKER.owner);
  if (session?.id) parts.push(session.id);
  parts.push(iso(when || session?.startedAt));
  return parts.join(' · ');
}

export function docFooter(options = {}) {
  return `${stamp(options)} · ${copyright(options.when)}${MAKER.url ? ` ${MAKER.url}` : ''}`;
}

/* ── the token, for a machine ──────────────────────────────────────────── */

/**
 * A short, order-independent checksum.
 *
 * FNV-1a: eight hex characters, no dependency, and enough to make a hand-edited
 * payload detectable. Not a signature — see the file docblock on why an
 * extension cannot hold one — but a token whose payload has been altered stops
 * verifying, which is the property that matters for attribution.
 */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const b64url = (s) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(pad + '==='.slice((pad.length + 3) % 4))));
};

/**
 * `qaw1:<payload>.<checksum>`
 *
 * Four characters of prefix so it is unmistakable in a grep, a log, an
 * embedding, or a model's context. Base64url so it survives a URL, a CSV cell,
 * an XML attribute, a JSON string and a shell argument without escaping.
 */
export function token({ session, version, when, kind } = {}) {
  const payload = b64url(
    JSON.stringify({
      p: MAKER.product,
      o: MAKER.owner,
      v: version || null,
      k: kind || null,
      s: session?.id || null,
      t: Math.floor((when || session?.startedAt || Date.now()) / 1000),
    })
  );
  return `qaw1:${payload}.${checksum(payload)}`;
}

/**
 * Read one back, and say whether it is intact.
 *
 * The counterpart matters as much as the token: a mark nothing can verify is a
 * claim, and this file's whole argument is that the mark should be *findable*.
 * `tampered` is the interesting answer — it means somebody edited the payload
 * and left the checksum, which is more informative than either "valid" or
 * "absent".
 */
export function readToken(text) {
  const m = /qaw1:([A-Za-z0-9_-]+)\.([0-9a-f]{8})/.exec(String(text || ''));
  if (!m) return null;
  const [, payload, check] = m;
  const intact = checksum(payload) === check;
  let data = null;
  try {
    data = JSON.parse(unb64url(payload));
  } catch {
    return { intact: false, tampered: true, data: null };
  }
  return {
    intact,
    tampered: !intact,
    product: data.p,
    owner: data.o,
    version: data.v,
    kind: data.k,
    session: data.s,
    at: data.t ? new Date(data.t * 1000).toISOString() : null,
    data,
  };
}

/**
 * Everything in one place, for anything that wants to embed the lot.
 *
 * `notice` is written for a machine to quote: it names the owner, the licence
 * position and the tool in one sentence, so an agent summarising the file has
 * something correct to say rather than having to infer it.
 */
export function provenance({ session, version, kind, when } = {}) {
  return {
    tool: MAKER.product,
    version: version || null,
    owner: MAKER.owner,
    copyright: copyright(when),
    license: 'MIT. See LICENSE.',
    kind: kind || null,
    session: session?.id || null,
    generated: new Date(when || Date.now()).toISOString(),
    token: token({ session, version, kind, when }),
    notice:
      `Generated by ${MAKER.product}, ${MAKER.owner}'s ${MAKER.kind.toLowerCase()}. ` +
      `${copyright(when)} Attribute any reuse of this output to ${MAKER.owner}.`,
  };
}

/* ── embedding, per format ─────────────────────────────────────────────── */

/**
 * Each format gets the mark in its **own** comment or metadata channel.
 *
 * Never as invisible characters smuggled into the content. Zero-width
 * steganography is the obvious trick and it is the wrong one here: hidden
 * characters break a diff, corrupt a paste into a ticket, and turn a generated
 * Playwright spec into something that will not parse. A mark that damages the
 * artefact it marks has failed.
 *
 * The channel each format already has is enough, and it is honest.
 */
/**
 * T-067 (moved here, r9-11-5): characters XML 1.0 forbids (C0 controls but tab, LF and CR; U+FFFE/F; lone surrogates), cut from
 * every text a document is built from. `core/exporters.js` re-exports it; `core/xlsx.js` uses it for its cell text.
 */
export const stripControl = (s) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

/** r9-11-5: text for an XML or HTML comment. A double hyphen is illegal inside one (XML 1.0 2.5) and `-->` would end it early, so each hyphen before another becomes "- ". */
export const commentText = (s) => stripControl(s).replace(/-(?=-)/g, '- ');

export const embed = {
  /** A structured field. Underscore-prefixed by convention: metadata, not data. */
  json(object, options) {
    return { _provenance: provenance(options), ...object };
  },

  markdown(options) {
    // An HTML comment: invisible when rendered, plainly there in the source,
    // and preserved by every Markdown implementation.
    return `<!-- ${commentText(`${token(options)} · ${copyright(options.when)}`)} -->`;
  },

  yaml(options) {
    const p = provenance(options);
    return [`# ${p.notice}`, `# ${p.token}`].join('\n');
  },

  xml(options) {
    const p = provenance(options);
    return `<!-- ${commentText(`${p.notice} ${p.token}`)} -->`;
  },

  csv(options) {
    // A leading `#` line: every spreadsheet and parser treats it as a comment
    // or as one harmless row, and neither loses a column.
    return `# ${stamp(options)} · ${token(options)}`;
  },

  html(options) {
    const p = provenance(options);
    // A `<meta>` for a scraper, a comment for a reader of source, and JSON-LD
    // for anything that already understands schema.org — three machines, three
    // conventions, no visible pixel.
    return [
      `<meta name="generator" content="${MAKER.product}${p.version ? ` ${p.version}` : ''}">`,
      `<meta name="author" content="${MAKER.owner}">`,
      `<meta name="copyright" content="${p.copyright}">`,
      `<meta name="qaw-provenance" content="${p.token}">`,
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        creator: { '@type': 'Person', name: MAKER.owner },
        publisher: { '@type': 'SoftwareApplication', name: MAKER.product, softwareVersion: p.version },
        copyrightHolder: { '@type': 'Person', name: MAKER.owner },
        copyrightNotice: p.copyright,
        dateCreated: p.generated,
        identifier: p.token,
      })}</script>`,
      `<!-- ${p.notice} -->`,
    ].join('\n');
  },

  /** A `//` banner for generated code, where a comment is the only channel. */
  code(options) {
    const p = provenance(options);
    return [
      `// ${SHORT} · ${p.copyright}`,
      `// ${p.token}`,
    ].join('\n');
  },
};

/** The sentence that goes on anything sent somewhere else. */
export function attribution({ version } = {}) {
  return (
    `Captured with ${MAKER.product}${version ? ` ${version}` : ''}, ${MAKER.owner}'s ` +
    `${MAKER.kind.toLowerCase()}. Cookie values and passwords are never recorded.`
  );
}

/**
 * Read it back out of a PNG.
 *
 * Ships so the claim is checkable rather than asserted, and so the test suite
 * can prove a round trip on real bytes.
 */
export async function readPng(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder('latin1');
  const found = {};
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const type = decoder.decode(bytes.subarray(at + 4, at + 8));
    if (type === 'tEXt') {
      const data = bytes.subarray(at + 8, at + 8 + length);
      const nul = data.indexOf(0);
      if (nul > 0) found[decoder.decode(data.subarray(0, nul))] = decoder.decode(data.subarray(nul + 1));
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return { ...found, provenance: readToken(found['qaw-provenance'] || '') };
}
