/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one HTML shell every document QA Wrap hands to a person is wrapped in.
 *
 * A report, a manual, a specification and a storyboard are four documents
 * with one reader: someone who did not run the session and has to trust the
 * file. So they share a cover that says what this is and where it came from,
 * a contents list, a "how to read it" legend that explains the colours and
 * marks before they appear, and a footer that carries the provenance. The
 * face is Thmanyah, embedded, and the palette is the product's: limestone,
 * basalt, Petra for a failure, guac for a pass, Wadi Rum for blocked.
 * Nothing else carries colour.
 *
 * ── Thmanyah, embedded, and still no network request ────────────────────
 *
 * This sheet used to open with an `@import` of a font stylesheet from Google's
 * font service. The extension never made that request; the browser that later
 * opened the exported file did, which could be a client's machine on a
 * client's network, announcing to a third party that they were reading a QA
 * Wrap document. That was the one place the local-first promise leaked, and
 * the `@import` is still gone: nothing here is ever fetched from a remote
 * host — `tools/test-exporters.mjs` proves it in a real browser, and that
 * does not change with this file.
 *
 * (History: 2026-09-21, decision 135 (`research/56:158`), this sheet dropped
 * an embedded earlier-typeface `@font-face` for the reader's own system stack, because
 * Thmanyah's licence forbade the face leaving the machine as a *file* and
 * every export leaves the machine. 2026-09-27, the round-2 decision at
 * `research/56:167-168,194` supersedes 135: every export — this shell, the
 * SVG diagram in `core/flow.js` — embeds Thmanyah after all, as a base64
 * `data:` URI, which travels inside the document rather than as a file on a
 * disk. Only the XLSX writer, which cannot embed anything, names it instead.
 * `loadDocFonts()` below reads the same base64 cuts `ui/fonts.css` already
 * carries for the product's own UI, so there is exactly one licensed copy of
 * each weight in the whole extension.)
 *
 * `shell()` refuses to build a document if `loadDocFonts()` was never
 * awaited first — see the comment on `fontsCache` below — so a caller that
 * forgets fails loudly instead of quietly shipping a document with no face.
 *
 * Print is a first-class reader: A4, margins, page numbers, no dark mode,
 * every block kept whole.
 */

import { docLabels } from './doc-labels.js';
import { MAKER } from './provenance.js';

/**
 * The three cuts an exported document needs: body text and bold emphasis
 * (Sans 400/700), and the cover title and section headings (Serif Display
 * 700) — read out of the one file `tools/build-fonts.mjs` already generates
 * for the product's own UI, so nothing here carries a second embedded copy.
 */
const FONT_CUTS = [
  { family: 'Thmanyah Sans', weight: 400 },
  { family: 'Thmanyah Sans', weight: 700 },
  { family: 'Thmanyah Serif Display', weight: 700 },
];

function pickFontFaces(css) {
  const blocks = [...String(css || '').matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
  const picked = FONT_CUTS.map(({ family, weight }) =>
    blocks.find((b) => b.includes(`font-family: '${family}'`) && new RegExp(`font-weight:\\s*${weight}\\b`).test(b))
  );
  return { css: picked.filter(Boolean).join('\n'), found: picked.filter(Boolean).length };
}

/**
 * `ui/fonts.css`, read once: `fetch(chrome.runtime.getURL(...))` in the
 * offscreen document this module is loaded into, a plain file read when this
 * module is loaded under Node instead (`tools/test-exporters.mjs`, which has
 * no `chrome` at all).
 */
async function readFontSource() {
  // `globalThis.chrome?.`, never a bare `chrome.` — core/ is the layer the
  // Node suites run with no `chrome` global at all (tools/test-layers.mjs).
  const getURL = globalThis.chrome?.runtime?.getURL;
  if (getURL) return (await fetch(getURL('ui/fonts.css'))).text();
  // A variable specifier: the extension's tsconfig carries no Node types, and this branch only runs under Node (council-1009 r3-13-3).
  const nodeFs = 'node:fs/promises';
  const { readFile } = await import(nodeFs);
  return readFile(new URL('../ui/fonts.css', import.meta.url), 'utf8');
}

/**
 * The embedded cuts, once read and kept for the life of the page.
 *
 * `null` until a successful read. `shell()` reads this module-level cache
 * directly rather than taking the CSS as one of its own parameters, so every
 * caller of `shell()` is bound by the rule this comment states: nothing is
 * built before this has resolved at least once.
 */
let fontsCache = null;

/**
 * The `@font-face` rules every exported document embeds.
 *
 * Cached for the life of the page, the same way `brandAssets()` in
 * `background/export-build.js` caches the lockup SVG beside it. A missing
 * cut throws rather than caching a partial result, so a drift in
 * `ui/fonts.css` is found here and not as a silently font-less export.
 */
export async function loadDocFonts() {
  if (fontsCache != null) return fontsCache;
  const raw = await readFontSource().catch(() => '');
  const { css, found } = pickFontFaces(raw);
  if (found < FONT_CUTS.length) {
    throw new Error(`loadDocFonts(): ui/fonts.css is missing a cut an export needs (found ${found}/${FONT_CUTS.length})`);
  }
  fontsCache = css;
  return fontsCache;
}

/** The one HTML/XML escaper: & < > " and ' (as &#39;). Export modules import it. */
export const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const esc = escHtml;

export const SHELL_CSS = `
  :root{--ink:#1D2024;--soft:#5D646B;--line:#DAD6CD;--bg:#F1EFE9;--card:#FAF8F4;--band:#E8E3D6;
        --bad:#B5432B;--ok:#2A7A3B;--warn:#8E5A10;--corn:#E2AE38;--tortilla:#D8C6A4}
  @media (prefers-color-scheme:dark){:root{--ink:#ECEAE3;--soft:#A3A9AF;--line:#454C53;--bg:#15181B;--card:#1D2125;--band:#22272C;
        --bad:#FF8A6E;--ok:#7ED08A;--warn:#F1BE5C;--corn:#FFD166;--tortilla:#6F5C40}}
  *{box-sizing:border-box}
  @media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 'Thmanyah Sans',-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;font-variant-numeric:tabular-nums}
  main{max-width:960px;margin:0 auto;padding:0 20px 64px}
  .cover{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 28px 22px;margin:28px 0 22px;position:relative;overflow:hidden}
  .cover::before{content:"";position:absolute;inset:0 0 auto 0;height:6px;background:repeating-linear-gradient(90deg,var(--bad) 0 22px,var(--bg) 22px 30px,var(--ink) 30px 52px,var(--bg) 52px 60px)}
  .cover .lockup{height:34px;margin:6px 0 16px;display:block}
  .cover .lockup svg{height:34px;width:auto}
  .cover .kind{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);margin:0 0 6px;font-weight:600}
  .cover h1{font-family:'Thmanyah Serif Display','Thmanyah Sans',-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;font-size:30px;line-height:1.15;margin:0 0 8px;font-weight:800;letter-spacing:-.01em;text-wrap:balance}
  .cover .sub{color:var(--soft);font-size:13.5px;margin:0}
  .cover .verdict{position:absolute;top:26px;right:26px;padding:8px 14px;border-radius:999px;font-weight:700;font-size:13px;border:1.5px solid}
  .verdict.bad{color:var(--bad);border-color:var(--bad)} .verdict.ok{color:var(--ok);border-color:var(--ok)}
  .legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 18px;background:var(--band);border-radius:12px;padding:14px 18px;margin:0 0 26px;font-size:12.5px}
  .legend h2{grid-column:1/-1;margin:0 0 2px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);border:0;padding:0}
  .legend div{display:flex;gap:9px;align-items:flex-start}
  .swatch{flex:none;width:14px;height:14px;border-radius:4px;margin-top:3px;border:1px solid rgba(0,0,0,.08)}
  .contents{columns:2;column-gap:28px;font-size:13px;margin:0 0 26px;padding:0 0 0 18px}
  .contents li{break-inside:avoid;margin:2px 0}
  .contents a{display:inline-block;min-block-size:24px;line-height:24px;color:inherit;text-decoration:none;border-bottom:1px dotted var(--line)}
  h2{font-family:'Thmanyah Serif Display','Thmanyah Sans',-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;font-size:18px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line);font-weight:700}
  h3{font-size:15px;margin:20px 0 6px;font-weight:700}
  p{margin:8px 0}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}
  .card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:11px 13px}
  .card.bad{border-left-color:var(--bad)} .card.ok{border-left-color:var(--ok)} .card.warn{border-left-color:var(--warn)}
  .card b{display:block;font-size:22px;line-height:1.2;font-weight:800} .card span{font-size:11.5px;color:var(--soft)}
  .chain{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:10px;padding:14px 16px;margin-bottom:12px}
  .chain h3{margin:0 0 10px}
  .flow{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch}
  .step{flex:1 1 240px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 11px;position:relative}
  .step.bad{border-color:var(--bad)}
  .step+.step::before{content:"→";position:absolute;left:-13px;top:50%;transform:translateY(-50%);color:var(--soft);font-weight:700}
  .step em{font-style:normal;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--soft)}
  .step p{margin:3px 0 0;font-size:13.5px}
  code{font-family:'Thmanyah Sans',"Segoe UI",Tahoma,Arial,sans-serif;font-variant-numeric:tabular-nums;font-size:12.5px;background:var(--band);padding:1px 5px;border-radius:4px;word-break:break-all}
  pre{background:var(--band);border-radius:8px;padding:10px 12px;overflow-x:auto;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
  pre code{background:none;padding:0}
  .table-wrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{text-align:start;padding:7px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child th,tr:last-child td{border-bottom:0}
  th{color:var(--soft);font-weight:600;background:var(--band)}
  ol,ul{padding-inline-start:22px} li{margin:3px 0}
  blockquote{margin:12px 0;padding:10px 14px;border-inline-start:4px solid var(--corn);background:var(--card);border-radius:0 8px 8px 0;color:var(--ink)}
  img{max-width:100%;border:1px solid var(--line);border-radius:8px;display:block;margin:10px 0}
  .tag{font-size:10.5px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--soft);white-space:nowrap}
  .tag.bad{color:var(--bad);border-color:var(--bad)} .tag.ok{color:var(--ok);border-color:var(--ok)} .tag.warn{color:var(--warn);border-color:var(--warn)}
  .status-OBSERVED{color:var(--ok)} .status-FAILED,.status-NOT{color:var(--bad)} .status-GAP{color:var(--warn);font-weight:700}
  /* MANUAL: measured by nobody. Not a pass, not a failure, so it borrows
     neither colour. Weight and a dotted rule set it apart, and survive a black-and-white print. */
  .status-MANUAL{color:var(--soft);font-weight:700;border-bottom:1px dotted var(--soft)}
  footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--soft);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  [dir=rtl] th,[dir=rtl] td{text-align:right}
  /* T-053: Latin runs (locators, URLs, verbs, hex) keep their own direction inside an Arabic page. */
  bdi{unicode-bidi:isolate}
  [dir=rtl] code,[dir=rtl] pre{direction:ltr;unicode-bidi:isolate;text-align:left}
  [dir=rtl] .step+.step::before{left:auto;right:-13px;content:"←"}
  @page{size:A4;margin:16mm 14mm}
  @media print{
    body{background:#fff;color:#1D2024;font-size:12.5px}
    main{max-width:none;padding:0}
    .cover{border:0;padding:0 0 12px;margin:0 0 14px;border-bottom:2px solid #1D2024;border-radius:0}
    .cover::before{display:none}
    .legend,.card,.chain,.step,table,blockquote,pre,img{break-inside:avoid}
    .cover .verdict{position:static;display:inline-block;margin-top:8px}
    a{color:inherit;text-decoration:none}
    footer{position:running(footer)}
  }
`;

export const LEGEND_DEFAULT = [
  { colour: 'var(--bad)', text: 'Petra red: a failure, or the one action that caused it.' },
  { colour: 'var(--ok)', text: 'Guac green: a pass; measured, met, verified.' },
  { colour: 'var(--warn)', text: 'Wadi Rum ochre: blocked, or a gap only a person can fill.' },
  { colour: 'var(--corn)', text: 'Corn: a note from the tool, worth reading before the section.' },
  { shape: '→', text: 'An arrow: cause on the left, effect on the right, the gap in milliseconds above it.' },
  { shape: 'GAP', text: 'GAP in a status: the recording could not know; decide it and the mark goes away.' },
];

/**
 * Wrap a body in the shell.
 *
 * `lockup` is the SVG text of brand/lockup.svg when the caller has it (the
 * worker fetches it once); otherwise the name is set in type.
 *
 * Throws if `loadDocFonts()` was never awaited: see the comment on
 * `fontsCache` above. Every current caller reaches this through
 * `background/export-build.js`'s `brandAssets()`, which always awaits it
 * first, so this only fires when a future entry point forgets to.
 */
/** T-053: `language` ('ar', 'ar-JO', 'en-US') decides `lang` and `dir`; an Arabic document is rtl. */
export const docDirection = (language) => {
  const lang = String(language || 'en').slice(0, 2).toLowerCase();
  return { lang, dir: /^(ar|he|fa|ur)$/.test(lang) ? 'rtl' : 'ltr' };
};

/** True when most of the letters in the text (markup and styles ignored) are Arabic. */
export function contentIsArabic(html) {
  const text = String(html || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return arabic > 0 && arabic >= latin;
}

/**
 * T-067: does the tester's own writing (charter, notes, the labels and values they met) read mostly Arabic?
 * The document's fixed labels are English, so a count over the whole page can never tip to Arabic; this reads
 * only what the tester wrote, and an Arabic session then exports rtl, lang ar.
 */
/** A Markdown fence one backtick longer than the longest backtick run in `text` (minimum 3). */
export function fenceFor(text) {
  let longest = 0;
  for (const m of String(text ?? '').matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function sessionIsArabic(session, events = []) {
  // T-053 step 3: the tester's own language (`env.language`, recorded at Start) makes the document Arabic even when the page they
  // tested is English; the content test below stays for an Arabic session in an English browser (completion review 5).
  if (/^ar/i.test(String(session?.env?.language || ''))) return true;
  const text = [session?.charter, ...events.flatMap((e) => (e.kind === 'note' ? [e.text] : e.kind === 'dom' ? [e.label, e.value] : []))].join(' ');
  return contentIsArabic(text);
}

/** The legend in the document's language (T-053); a caller's own legend is kept as it is. */
const legendFor = (legend, L) => {
  if (legend !== LEGEND_DEFAULT) return legend;
  const text = [L.legendBad, L.legendOk, L.legendWarn, L.legendCorn, L.legendArrow, L.legendGap];
  return LEGEND_DEFAULT.map((l, i) => ({ ...l, text: text[i] }));
};

/** D-1010-55: a standalone document runs no script and loads only inline styles and data: assets, so a page-text escaping slip cannot become a script or a request. */
export const DOC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";

export function shell({ title, kind, subtitle, verdict, body, headings = [], legend = LEGEND_DEFAULT, lockup, language = '', lang = 'en', dir = 'ltr', version, provenance = '' }) {
  // No caller names a language and the exporters' own labels are English, so the document follows its content: mostly Arabic letters is an Arabic, rtl document (T-053).
  if (!language && contentIsArabic(`${title} ${subtitle || ''} ${verdict || ''} ${body}`)) language = 'ar';
  if (language) ({ lang, dir } = docDirection(language));
  if (fontsCache == null) {
    throw new Error(
      'shell(): loadDocFonts() was never awaited before this document was built. ' +
      'Every export embeds Thmanyah (research/56:167-168,194, supersedes decision 135): ' +
      'await loadDocFonts() first, the way background/export-build.js\'s brandAssets() does.'
    );
  }
  const L = docLabels(lang);
  const toc = headings.filter((h) => h.level <= 2).map((h) => `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('');
  const legendHtml = legendFor(legend, L)
    .map((l) => `<div>${l.colour ? `<span class="swatch" style="background:${l.colour}"></span>` : `<b style="min-width:28px">${esc(l.shape)}</b>`}<span>${esc(l.text)}</span></div>`)
    .join('');
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${esc(dir)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOC_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${esc(MAKER.full)}${version ? ` ${esc(version)}` : ''}">
<title>${esc(title)}: ${esc(MAKER.product)}</title>
<style>${fontsCache}
${SHELL_CSS}</style></head><body><main>
<header class="cover">
  <div class="lockup">${lockup || `<strong style="font-size:18px;font-weight:800">${esc(MAKER.product)}</strong> <span style="color:var(--soft);font-size:12px">${esc(L.by)} ${esc(MAKER.owner)}</span>`}</div>
  <p class="kind">${esc(kind)}</p>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<p class="sub">${subtitle}</p>` : ''}
  ${verdict ? `<span class="verdict ${verdict.tone}">${esc(verdict.text)}</span>` : ''}
</header>
<section class="legend" aria-label="${esc(L.howToReadAria)}"><h2>${esc(L.howToRead)}</h2>${legendHtml}</section>
${toc ? `<ol class="contents">${toc}</ol>` : ''}
${body}
<footer><span>${esc(MAKER.full)}${version ? ` ${esc(version)}` : ''} · ${esc(MAKER.tagline)} · ${esc(L.madeBy)} ${esc(MAKER.publisher)}${MAKER.url ? ` · ${esc(MAKER.url)}` : ''}</span><span>${provenance}</span></footer>
</main></body></html>`;
}

/*
 * r1-11-1: Markdown escaping for text that came from a page (labels, console lines, notes, URLs, locators), shared by every
 * Markdown builder. Page text is hostile input: it could plant an image, a link that reads as the tester's own, an autolink,
 * raw HTML or a second heading. `mdEsc` joins lines, backslash-escapes Markdown characters and breaks http:// / www. / @ so no
 * autolink forms; `mdCell` keeps a URL clickable and escapes structure, links, images and HTML; `mdCode` widens its backtick fence.
 */
const MD_LINES = /[\r\n\u2028\u2029]/; // glyph-ok: line-separator detector, never rendered

/* r2-07-1: each run of whitespace is tested once; the old pattern (spaces, line breaks, spaces) rescanned a long run of spaces from every start (quadratic). A run holding a line break becomes one space. */
export const oneLine = (text) => String(text ?? '').replace(/\s+/g, (m) => (MD_LINES.test(m) ? ' ' : m));
export { safeHref } from './events.js'; // r2-03-2: the one link rule, defined beside the other page-text rules

export function mdEsc(text) {
  // r10-11-1: '#' always (issue links, headings); a leading + - = or "N." only where a line could start a block
  return oneLine(text)
    .replace(/[\\`*_[\]()!<>|~@#]/g, '\\$&')
    .replace(/^(\s*)([+\-=])(?=[\s+\-=]|$)/, '$1\\$2')
    .replace(/^(\s*\d{1,9})(?=\.(?:\s|$))/, '$1\\')
    .replace(/\b(https?|ftp):\/\//gi, '$1:\\/\\/')
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`);
}

export function mdCell(text) {
  return oneLine(text).replace(/[\\`[\]!<>|]/g, '\\$&');
}

/** An inline code span: one line, a fence longer than any backtick run inside, padded when the text edges on a backtick. */
export function mdCode(text, inTable = false) {
  let s = oneLine(text);
  if (inTable) s = s.replace(/\|/g, '\\|');
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const f = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${f}${pad}${s}${pad}${f}`;
}
