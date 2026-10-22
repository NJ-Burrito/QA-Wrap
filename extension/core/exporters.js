/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The export formats that were missing: HTML, plain text, JUnit, HAR, YAML.
 *
 * Each one exists because a different tool eats it. HTML is what you send to
 * someone who will not open a Markdown file; JUnit is what a CI server and every
 * test-management tool ingests; HAR is what a network engineer opens in DevTools
 * without needing this extension at all. None of them is a novelty format — they
 * are the shapes the rest of a QA toolchain already speaks.
 */

import { isTesterNote } from './events.js';
import { correlate, isFailure, reproSteps, clampLabel, dropDoubleSubmits, decodeSafe } from './artifact.js';
import { shell, sessionIsArabic, escHtml } from './docshell.js';
import { visibleProblems } from './signal.js';
import { byPageOf } from './artifact-docs.js';
import { problemCounts } from './finding-count.js';
import { MAKER, attribution, docFooter, embed, provenance, stripControl, commentText } from './provenance.js';
import { htmlWatermark, checksumFooter } from './provenance-stamp.js';
import { docLabels, fill, confWord } from './doc-labels.js';
import { toBase64 } from './xlsx.js';
import { isSecretParam, REDACTION, isSecretHeader, maskBodyKeys } from './secret-scan-text.js';
import { normaliseNetEvent, formParts } from './postman.js';
import { captureGapLine, techniqueLine } from './formats-export.js';


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/**
 * The version, in one place, read from the build rather than typed.
 *
 * It was typed into the HAR creator block as a literal and said 1.7.0 in a
 * 1.9.0 build — which is exactly how a network capture gets blamed on the wrong
 * release. Moving it here fixed that and then did the same thing more slowly:
 * `research/54-real-session-review.md` opened Nader's own session folder and
 * found every artefact in it stamped **QA Wrap 1.10.0** while the manifest and
 * the session card beside them said 3.1.0. A constant somebody has to remember
 * to bump is a constant that will be wrong, and this one was wrong in files a
 * client receives.
 *
 * So it is read from the manifest, which is the one copy of the version Chrome
 * itself enforces and the packagers already rewrite. `core/product.js` takes the
 * same route for the same reason.
 *
 * The fallback is for Node, where the tests import this module with no
 * `chrome` at all. It is deliberately not a plausible-looking release number:
 * a stamp reading `0.0.0-dev` is obviously a build nobody shipped, where
 * `1.10.0` looked like a fact.
 */
export const VERSION = globalThis.chrome?.runtime?.getManifest?.()?.version || '0.0.0-dev';

/* ── compressed exports ──────────────────────────────────────────────────── */

/**
 * Above this, a JSON-family export is written gzipped.
 *
 * 256 KB is where a raw session export stops being something a person opens in
 * an editor and starts being something a tool reads — and where the saving
 * becomes worth the extra step of unzipping. Below it, plain text stays plain:
 * a 40 KB HAR that a network engineer wants to drag into DevTools must not need
 * a decompression tool first, and gzipping it would save a rounding error.
 *
 * The threshold is measured on the *bytes*, not the characters: a session
 * against an Arabic site is mostly multi-byte text, and counting `length` would
 * under-report it by half.
 */
export const GZIP_THRESHOLD = 256 * 1024;

/**
 * The formats this applies to: the JSON family, and nothing else.
 *
 * These are the exports that are read by a program — an agent brief, a HAR, a
 * Postman collection, a page map — so an extra `.gz` costs the reader nothing
 * and every one of them is mostly repeated keys, which is what gzip is best at.
 * Markdown, HTML and the spec files are left alone on purpose: those are opened
 * by a person, usually straight from the download bar, and a report that will
 * not open when double-clicked is not a report.
 */
export const GZIP_FORMATS = Object.freeze([
  'json', 'harvest-map', 'flow-json', 'storyboard',
]);
// T-067: HAR, Postman and the agent brief are dragged straight into DevTools, Postman or an agent, so a
// decompression step defeats their purpose (the note above says so); they stay plain whatever their size.

const utf8 = new TextEncoder();

/** Bytes, not characters — see the note on GZIP_THRESHOLD. */
export const byteLength = (text) => utf8.encode(String(text ?? '')).length;

/**
 * Should this export be compressed? Format first, then size.
 *
 * Kept as its own predicate so the exporter, the test and anything that has to
 * explain the decision to a tester all read the same rule rather than three
 * copies of it.
 */
export function shouldGzipExport(format, content, threshold = GZIP_THRESHOLD) {
  if (!GZIP_FORMATS.includes(format)) return false;
  if (typeof content !== 'string') return false;
  return byteLength(content) > threshold;
}

/**
 * Gzip a string with the platform's own compressor.
 *
 * `CompressionStream` is in every Chrome that can run this extension and in
 * Node 18 and later, which is what lets `tools/test-compress.mjs` check the
 * output against Node's `zlib` as an independent oracle. No dependency, no
 * bundled deflate implementation, and the format is the one every tool on the
 * planet already reads.
 */
export async function gzipText(text) {
  const stream = new Blob([String(text ?? '')]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The inverse, for anything that has to read one back. */
export async function gunzipText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * The gzipped name of a file: the whole original name, plus `.gz`.
 *
 * Appended and never substituted — `Session-….json.gz` says both what the bytes
 * are and what they were, so unzipping gives back a file with the right
 * extension without anybody having to rename it.
 */
export const gzName = (name) => (String(name).endsWith('.gz') ? String(name) : `${name}.gz`);

/** The MIME type of a gzipped artefact, in one place. */
export const GZIP_MIME = 'application/gzip';

/**
 * One export, compressed if it is big enough to be worth it: the same rule and the same result shape as
 * `exportSession` in `background/export-build.js`, but applied to a document the offscreen door has already
 * stamped (T-066), so the checksum footer is inside what is compressed. A workbook or other base64 output passes through.
 */
export async function gzipExport(out, format) {
  if (out.encoding || !shouldGzipExport(format, out.content)) return out;
  const raw = byteLength(out.content);
  const bytes = await gzipText(out.content);
  const saved = Math.round((1 - bytes.length / raw) * 100);
  return {
    ...out,
    filename: gzName(out.filename),
    mime: GZIP_MIME,
    encoding: 'base64',
    content: toBase64(bytes),
    gzipped: true,
    rawBytes: raw,
    bytes: bytes.length,
    note: `Compressed: ${Math.round(raw / 1024)} KB of JSON written as ${Math.round(bytes.length / 1024)} KB of gzip (${saved}% smaller). Unzip it with any archiver, or read it straight with a tool that speaks gzip.`,
  };
}

export { stripControl };

const esc = (s) => escHtml(stripControl(s));

const NOT_LATIN = '\\u0600-\\u06FF\\u00ab\\u00bb\\u2018-\\u201d'; // Arabic, guillemets and curly quotes stay outside an isolate
/** D-1010-176: one run per Latin phrase, first to last ASCII letter or digit, spaces and Latin punctuation inside. */
const LATIN_RUN = new RegExp(`[^\\s${NOT_LATIN}]*[A-Za-z0-9](?:[^\\n\\r${NOT_LATIN}]*[A-Za-z0-9])?[^\\s${NOT_LATIN}]*`, 'g');
/** Escaped text with every Latin phrase (URL, verb, locator, number) in one `<bdi>`, so punctuation cannot flip inside Arabic (T-053). */
export function isolateLatin(text) {
  const t = String(text ?? '');
  let out = '';
  let at = 0;
  for (const m of t.matchAll(LATIN_RUN)) {
    out += esc(t.slice(at, m.index)) + `<bdi>${esc(m[0])}</bdi>`;
    at = m.index + m[0].length;
  }
  return out + esc(t.slice(at));
}

const when = (ts, start) => `+${((ts - start) / 1000).toFixed(2)}s`;

/** The Arabic sentence for an event; the caller runs it through `isolateLatin` so URLs, verbs and locators keep their own direction (T-053). */
function summariseAr(ev) {
  const t = ev.label || ev.tag || 'element';
  switch (ev.kind) {
    case 'nav': return `فُتح ${ev.url}`;
    case 'dom':
      if (ev.action === 'click') return `نُقر على ${t}`;
      if (ev.action === 'input') return `كُتب "${ev.value ?? ''}" في ${t}`;
      if (ev.action === 'change') return `ضُبط ${t} على "${ev.value ?? ''}"`;
      if (ev.action === 'submit') return `أُرسل ${t}`;
      if (ev.action === 'keydown') return `ضُغط ${ev.key} على ${t}`;
      return `${ev.action} على ${t}`;
    case 'net': return `${ev.method} ${ev.url} ← ${ev.error ? 'خطأ شبكة' : ev.status} (${Math.round(ev.durationMs)} مللي ثانية)`;
    default: return summarise(ev);
  }
}

function summarise(ev) {
  switch (ev.kind) {
    case 'nav':
      return `Opened ${ev.url}`;
    case 'dom': {
      const t = ev.label || ev.tag || 'element';
      if (ev.action === 'click') return `Clicked ${t}`;
      if (ev.action === 'input') return `Typed "${ev.value ?? ''}" into ${t}`;
      if (ev.action === 'change') return `Set ${t} to "${ev.value ?? ''}"`;
      if (ev.action === 'submit') return `Submitted ${t}`;
      if (ev.action === 'keydown') return `Pressed ${ev.key} on ${t}`;
      return `${ev.action} on ${t}`;
    }
    case 'net':
      return `${ev.method} ${ev.url} → ${ev.error ? 'network error' : ev.status} (${Math.round(ev.durationMs)}ms)`;
    case 'console':
      return `console.${ev.level}: ${ev.text}`;
    case 'pageerror':
      return ev.text;
    default:
      return ev.text || ev.kind;
  }
}

/* ── HTML ──────────────────────────────────────────────────────────────── */

/**
 * A self-contained page: no stylesheet, no script, no network.
 *
 * That constraint is the point. This file gets attached to a ticket, dropped in
 * a shared drive, opened on a machine that has never heard of this extension —
 * so it has to render correctly with nothing else present, for ever.
 */
export function buildHtml(session, events, captures = {}, assets = {}) {
  const chains = correlate(events);
  const failures = events.filter(isFailure);
  const problems = problemCounts(events).groups; // 1011 B5: distinct problems, the one number the popup, report and every export print
  const notes = events.filter(isTesterNote);
  const perf = [...events].reverse().find((e) => e.kind === 'perf');
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  const links = [...events].reverse().find((e) => e.kind === 'links');
  const harvest = [...events].reverse().find((e) => e.kind === 'harvest');
  const duration = ((session.endedAt || Date.now()) - session.startedAt) / 1000;
  const shots = events.filter((e) => e.kind === 'screenshot' && captures[e.captureId]?.dataUrl);
  /*
   * Every selector that reached the clipboard, in the order it was taken.
   *
   * `buildHtml` walks the kinds it renders one at a time rather than folding
   * sections generically, so a new kind is invisible here until it is named.
   * The element is described *and*, since 3.2.0, photographed: the picker
   * stores a cropped `data:image/` on the event, so the export inlines it with
   * the outline as its alt text. No file is fetched; there is nothing to fetch.
   */
  const copied = events.filter((e) => e.kind === 'selectorcopy');
  const elementOf = (e) =>
    [
      `<${e.tag || 'element'}>`,
      e.elementId ? `#${e.elementId}` : '',
      e.classes ? `.${e.classes.split(' ').join(' .')}` : '',
      e.text || '',
    ].filter(Boolean).join(' ');
  const shotOf = (e) =>
    typeof e.preview === 'string' && e.preview.startsWith('data:image/')
      ? `<img src="${esc(e.preview)}" alt="${esc(elementOf(e))}" style="max-width:220px;max-height:130px;display:block;margin-bottom:4px;border:1px solid #ddd;border-radius:4px">`
      : '';
  // Absolute time as well as the offset: a reader matching this against a
  // screen recording has a wall clock and not a stopwatch. UTC, because the
  // file is opened on machines that are not the one that recorded it.
  const clockOf = (ts) => `${new Date(ts).toISOString().slice(11, 19)} UTC`;

  // T-053: an Arabic session (the tester wrote Arabic) gets an Arabic document; English stays as it was.
  const ar = sessionIsArabic(session, events);
  const L = docLabels(ar ? 'ar' : 'en');
  const T = ar ? isolateLatin : esc;
  const sum = (ev) => (ar ? summariseAr(ev) : summarise(ev));
  const mins = (d) => (d >= 90 ? `${Math.round(d / 60)} ${L.min}` : `${d.toFixed(1)}${ar ? ` ${L.sec}` : 's'}`);
  const rated = (r) => (r === 'good' ? L.rateGood : r === 'poor' ? L.ratePoor : r === 'needs-improvement' ? L.rateNeeds : r ?? L.rateNa);
  const WRAP = `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(L.tableScroll)}">`;
  const row = (k, v) => `<tr><th scope="row">${esc(k)}</th><td>${T(v)}</td></tr>`;
  const headings = [];
  const h2 = (text, id) => { headings.push({ level: 2, text, id }); return `<h2 id="${id}">${esc(text)}</h2>`; };

  const body = `
<div class="cards">
  <div class="card ${problems ? 'bad' : 'ok'}"><b>${problems}</b><span>${problems === 1 ? L.problemFound : L.problemsFound}</span></div>
  <div class="card"><b>${events.filter((e) => e.kind === 'dom').length}</b><span>${L.stepsRecorded}</span></div>
  <div class="card"><b>${mins(duration)}</b><span>${L.duration}</span></div>
  <div class="card"><b>${events.filter((e) => e.kind === 'net').length}</b><span>${L.requests}</span></div>
  <div class="card"><b>${shots.length}</b><span>${L.screenshotsCount}</span></div>
  <div class="card"><b>${notes.length}</b><span>${L.notesCount}</span></div>
</div>
${[captureGapLine(events, ar), techniqueLine(events, ar)].filter(Boolean).map((x) => `<p><span class="tag warn">${esc(x)}</span></p>`).join('')}

${h2(L.hBroke, 'broke')}
${
  chains.length
    ? chains
        .map(
          (c, i) => `<div class="chain">
  <h3>${i + 1}. ${T(sum(c.failure))} <span class="tag bad">${esc(fill(L.confidence, { v: ar ? confWord(L, c.confidence) : c.confidence }))}</span></h3>
  <div class="flow">
    ${
      c.trigger
        ? `<div class="step"><em>${L.youDid}</em><p>${T(sum(c.trigger))}</p>${
            c.trigger.locator ? `<code>page.${esc(c.trigger.framePrefix || '')}${esc(c.trigger.locator)}</code>` : ''
          }</div>`
        : ''
    }
    <div class="step bad"><em>${c.gapMs != null ? fill(L.thenGap, { ms: c.gapMs }) : L.then}</em><p>${T(sum(c.failure))}</p></div>
  </div>
  ${c.failure.responsePreview ? `<pre>${esc(c.failure.responsePreview)}</pre>` : ''}
</div>`
        )
        .join('\n')
    : '<p><span class="tag ok">${L.clean}</span> ${L.nothingFailed}</p>'
}

${h2(L.hSteps, 'steps')}
<ol>${reproSteps(events, byPageOf(session, events)).map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>

${
  notes.length
    ? `${h2(L.hNotes, 'notes')}<ol>${notes
        .map((n) => `<li>${n.tag ? `<span class="tag ${n.tag === 'bug' ? 'bad' : n.tag === 'question' ? 'warn' : ''}">${esc(n.tag)}</span> ` : ''}${T(n.text)} <span class="tag">${when(n.ts, session.startedAt)}</span></li>`)
        .join('')}</ol>`
    : ''
}

${
  copied.length
    ? `${h2(L.hSelectors, 'selectors')}${WRAP}<table><tr><th scope="col">${L.colWhen}</th><th scope="col">${L.colSelector}</th><th scope="col">${L.colElement}</th></tr>${copied
        .map(
          (e) => `<tr><td>${esc(clockOf(e.ts))} <span class="tag">${when(e.ts, session.startedAt)}</span></td><td><code>${esc(e.copied || '')}</code>${
            (e.flavours || []).filter((f) => !f.copied).length
              ? `<br>${(e.flavours || []).filter((f) => !f.copied).map((f) => `<code>${esc(f.expr)}</code>`).join('<br>')}`
              : ''
          }</td><td>${shotOf(e)}${T(elementOf(e))}</td></tr>`
        )
        .join('')}</table></div>`
    : ''
}

${
  perf
    ? `${h2(L.hSpeed, 'speed')}<div class="cards">${Object.entries(perf.metrics)
        .map(([k, v]) => `<div class="card ${perf.ratings?.[k] === 'poor' ? 'bad' : perf.ratings?.[k] === 'good' ? 'ok' : perf.ratings?.[k] ? 'warn' : ''}"><b>${v ?? '—'}${v != null && k !== 'cls' ? ' ms' : ''}</b><span>${ar ? `<bdi>${esc(k.toUpperCase())}</bdi>` : esc(k.toUpperCase())} · ${esc(rated(perf.ratings?.[k]))}</span></div>`)
        .join('')}</div>`
    : ''
}

${
  a11y
    ? `${h2(L.hA11y, 'a11y')}${WRAP}<table><tr><th scope="col">${L.colImpact}</th><th scope="col">${L.colRule}</th><th scope="col">${L.colIssue}</th><th scope="col">${L.colElements}</th></tr>${a11y.violations
        .map((v) => `<tr><td><span class="tag ${/critical|serious/.test(v.impact) ? 'bad' : 'warn'}">${esc(v.impact || 'n/a')}</span></td><td><code>${esc(v.id)}</code></td><td>${T(v.help)}</td><td>${v.count}</td></tr>`)
        .join('')}</table></div>`
    : ''
}

${
  links
    ? `${h2(L.hLinks, 'links')}<div class="cards">
  <div class="card ${links.broken.length ? 'bad' : 'ok'}"><b>${links.broken.length}</b><span>${L.linksBroken}</span></div>
  <div class="card"><b>${links.redirected.length}</b><span>${L.linksRedirected}</span></div>
  <div class="card ${links.slow.length ? 'warn' : ''}"><b>${links.slow.length}</b><span>${L.linksSlow}</span></div>
  <div class="card"><b>${links.total}</b><span>${L.linksTotal}</span></div>
</div>${links.broken.length ? `${WRAP}<table><tr><th scope="col">${L.colLink}</th><th scope="col">${L.colText}</th><th scope="col">${L.colStatus}</th></tr>${links.broken.map((r) => `<tr><td><code>${esc(r.href)}</code></td><td>${T(r.text)}</td><td><span class="tag bad">${esc(r.status || r.error || '')}</span></td></tr>`).join('')}</table></div>` : ''}`
    : ''
}

${
  harvest
    ? `${h2(L.hMap, 'map')}<p>${esc(fill(L.pageMap, { e: harvest.counts?.elements ?? 0, u: harvest.counts?.unique ?? 0, f: ar ? harvest.forms?.length ?? 0 : plural(harvest.forms?.length ?? 0, 'form') }))}</p>`
    : ''
}

${h2(L.hEnv, 'env')}
${WRAP}<table>
${row(L.envUrl, session.startUrl || '—')}
${row(L.envViewport, session.env?.viewport || '—')}
${row(L.envBrowser, session.env?.userAgent || '—')}
${row(L.envPlatform, session.env?.platform || '—')}
${row(L.envLanguage, session.env?.language || '—')}
${row(L.envRecorded, new Date(session.startedAt).toISOString())}
${row(L.envEvents, ar ? fill(L.eventsValue, { n: events.length, p: problems, f: failures.length }) : `${events.length} (${problems} problems, ${failures.length} raw failures)`)}
${row(L.envSession, session.id || '—')}
</table></div>

${shots.length ? h2(L.hShots, 'shots') : ''}
${shots.map((e) => `<h3>${T(e.text || L.screenshot)} <span class="tag">${when(e.ts, session.startedAt)}</span></h3><img alt="${esc(e.text || L.screenshot)}" src="${captures[e.captureId].dataUrl}">`).join('\n')}

${embed.html({ session, version: VERSION, kind: 'report' })}
${htmlWatermark({ session, version: VERSION })}
`;

  return shell({
    language: ar ? 'ar' : '',
    title: session.charter,
    kind: L.kindReport,
    subtitle: `${T(session.startUrl || '')} &middot; ${T(fmtWhen(session.startedAt, ar))}`,
    verdict: problems
      ? { tone: 'bad', text: ar ? (problems === 1 ? L.verdictProblem : fill(L.verdictProblems, { n: problems })) : `${problems} ${problems === 1 ? 'problem' : 'problems'}` }
      : { tone: 'ok', text: L.verdictClean },
    body,
    headings,
    lockup: assets.lockup,
    version: VERSION,
    provenance: `${esc(attribution({ version: VERSION }))} · ${esc(docFooter({ session, version: VERSION }))}${shots.length ? `<br>${checksumFooter(Object.fromEntries(shots.map((e) => [e.captureId, captures[e.captureId].sha256])), ar ? 'ar' : 'en', true)}` : ''}`,
  });
}

/* ── plain text ────────────────────────────────────────────────────────── */

/** The Arabic plain-text report: Arabic words from DOC_LABELS, Latin runs (URLs, selectors) isolated. */
/** Plain-text twin of isolateLatin: Latin runs wrapped in first-strong isolates (FSI ... PDI), no markup. */
const isoTxt = (text) => String(text ?? '').replace(LATIN_RUN, (m) => `\u2068${m}\u2069`);

function buildTextAr(session, events, chains) {
  const L = docLabels('ar');
  const line = (c = '-') => c.repeat(64);
  const out = [];
  const total = problemCounts(events).groups; // 1011 B5
  const clock = (ts) => `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
  out.push(isoTxt(session.charter), line('='));
  out.push(`${L.envUrl}:  ${isoTxt(session.startUrl || '—')}`);
  out.push(`${L.colWhen}:  ${clock(session.startedAt)}`);
  out.push(`${total === 1 ? L.verdictProblem : fill(L.verdictProblems, { n: total })} (${L.envEvents}: ${events.length})`);
  for (const x of [captureGapLine(events, true), techniqueLine(events, true)]) if (x) out.push(x);
  out.push('');
  out.push(L.hBroke, line());
  if (chains.length) {
    chains.forEach((c, i) => {
      out.push(`${i + 1}. ${isoTxt(summariseAr(c.failure))}`);
      out.push(
        c.trigger
          ? `   ${L.jCause}: ${isoTxt(summariseAr(c.trigger))} (${fill(L.jEarlier, { ms: c.gapMs })}، ${fill(L.confidence, { v: confWord(L, c.confidence) })})`
          : `   ${L.jNoCause}`
      );
      if (c.failure.responsePreview) out.push(`   ${isoTxt(c.failure.responsePreview.slice(0, 300))}`);
      out.push('');
    });
  } else {
    out.push(L.nothingFailed, '');
  }
  out.push(L.hSteps, line());
  dropDoubleSubmits(events)
    .filter((e) => e.kind === 'dom' || e.kind === 'nav')
    .forEach((e, i) => out.push(`${i + 1}. ${isoTxt(summariseAr(e))}`));
  out.push('');
  const notes = events.filter(isTesterNote);
  if (notes.length) {
    out.push(L.hNotes, line());
    notes.forEach((n) => out.push(`${n.tag ? `[${n.tag.toUpperCase()}] ` : ''}${isoTxt(n.text)} (${when(n.ts, session.startedAt)})`));
    out.push('');
  }
  out.push(L.hEnv, line());
  out.push(`${L.envViewport}: ${session.env?.viewport || '—'}`);
  out.push(`${L.envBrowser}: ${session.env?.userAgent || '—'}`);
  out.push(`${L.envPlatform}: ${session.env?.platform || '—'}`);
  out.push(`${L.envLanguage}: ${session.env?.language || '—'}`);
  out.push('');
  out.push(attribution({ version: VERSION }));
  out.push(docFooter({ session, version: VERSION }));
  out.push(embed.markdown({ session, version: VERSION, kind: 'text-report' }).replace(/^<!-- | -->$/g, ''));
  return out.join('\n');
}

/** No markup at all — for an email body or a chat window. */
/** D-1010-112: the report's one date rule (report.js localeTag): en-GB or ar-JO with Western digits, 24-hour, whatever the machine locale. */
const fmtWhen = (ts, ar) => new Intl.DateTimeFormat(ar ? 'ar-JO-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));

export function buildText(session, events) {
  const chains = correlate(events);
  const line = (c = '-') => c.repeat(64);
  const L = [];

  // 10-2: an Arabic session gets an Arabic .txt, from the same label table the HTML uses.
  const ar = sessionIsArabic(session, events);
  if (ar) return buildTextAr(session, events, chains);

  L.push(session.charter.toUpperCase(), line('='));
  L.push(`Where:    ${session.startUrl || '—'}`);
  L.push(`When:     ${fmtWhen(session.startedAt, false)}`);
  const sig = visibleProblems(events);
  L.push(`Found:    ${plural(problemCounts(events).groups, 'problem')} in ${events.length} events (ruleset v${sig.ruleset}; ${sig.notes} notes hidden)`);
  for (const x of [captureGapLine(events), techniqueLine(events)]) if (x) L.push(`Note:     ${x}`);
  L.push('');

  L.push('WHAT BROKE', line());
  if (chains.length) {
    chains.forEach((c, i) => {
      L.push(`${i + 1}. ${summarise(c.failure)}`);
      L.push(
        c.trigger
          ? `   Caused by: ${summarise(c.trigger)} (${c.gapMs}ms earlier, ${c.confidence} confidence)`
          : '   No action of yours lines up with this: likely background activity.'
      );
      if (c.failure.responsePreview) L.push(`   Server said: ${c.failure.responsePreview.slice(0, 300)}`);
      L.push('');
    });
  } else {
    L.push('Nothing failed.', '');
  }

  L.push('STEPS TO REPRODUCE', line());
  reproSteps(events, byPageOf(session, events)).forEach((s) => L.push(s));
  L.push('');

  const notes = events.filter(isTesterNote);
  if (notes.length) {
    L.push('TESTER NOTES', line());
    notes.forEach((n) => L.push(`${n.tag ? `[${n.tag.toUpperCase()}] ` : ''}${n.text} (${when(n.ts, session.startedAt)})`));
    L.push('');
  }

  L.push('ENVIRONMENT', line());
  L.push(`Viewport: ${session.env?.viewport || '—'}`);
  L.push(`Browser:  ${session.env?.userAgent || '—'}`);
  L.push(`Platform: ${session.env?.platform || '—'}`);
  L.push(`Language: ${session.env?.language || '—'}`);
  L.push('');
  L.push(attribution({ version: VERSION }));
  L.push(docFooter({ session, version: VERSION }));
  // The verifiable half, on its own line: a person reads the one above, an
  // agent reads this one.
  L.push(embed.markdown({ session, version: VERSION, kind: 'text-report' }).replace(/^<!-- | -->$/g, ''));
  return L.join('\n');
}

/* ── JUnit XML ─────────────────────────────────────────────────────────── */

/**
 * What CI servers and test managers ingest.
 *
 * The mapping is deliberate: **one test case per reproduction step**, so a
 * failure lands on the step it happened at rather than on a single opaque
 * "session" case. That is what makes the file useful in a CI dashboard instead
 * of merely valid.
 */
export function buildJunit(session, events) {
  const chains = correlate(events);
  const failures = events.filter(isFailure);
  const duration = ((session.endedAt || Date.now()) - session.startedAt) / 1000;

  // Walk the events themselves rather than the rendered step strings. Matching
  // a chain to a step by comparing text meant comparing "Click Submit" from
  // reproSteps against "Clicked Submit" from summarise — two renderings of the
  // same event that happen to word the verb differently, so nothing ever
  // matched and no failure was ever attached to anything.
  const stepEvents = dropDoubleSubmits(events).filter((e) => e.kind === 'dom' || e.kind === 'nav');

  const cases = stepEvents.map((ev, i) => {
    const name = `${i + 1}. ${ev.kind === 'nav' ? `Navigate to ${ev.url}` : summarise(ev)}`;
    // T-067: every failure a step caused, not the first: a chain's siblings (same trigger, within 250 ms) are
    // failures too. One <failure> per case (consumers read the first and dashboards count elements): its
    // message the first, its body all of them, numbered.
    const all = chains.filter((c) => c.trigger === ev).flatMap((c) => [c.failure, ...(c.siblings || [])]);
    const detail = (f) => f.responsePreview || f.stack || summarise(f);
    const took = i + 1 < stepEvents.length ? (stepEvents[i + 1].ts - ev.ts) / 1000 : 0;
    const body = all.length
      ? `      <failure message="${esc(summarise(all[0]))}" type="${esc(all[0].kind)}">${esc(
          all.length === 1 ? detail(all[0]) : all.map((f, k) => `${k + 1}/${all.length} ${summarise(f)}\n${detail(f)}`).join('\n\n')
        )}</failure>\n`
      : '';
    return `    <testcase classname="${esc(session.charter)}" name="${esc(name)}" time="${took.toFixed(
      3
    )}">\n${body}    </testcase>`;
  });

  // Anything that failed with no action behind it still has to be reported, or
  // the file quietly says fewer things went wrong than actually did.
  for (const c of chains.filter((x) => !x.trigger)) {
    cases.push(
      `    <testcase classname="${esc(session.charter)}" name="${esc(`Background: ${summarise(c.failure)}`)}" time="0">\n` +
        `      <failure message="${esc(summarise(c.failure))}" type="${esc(c.failure.kind)}">${esc(
          c.siblings?.length ? [c.failure, ...c.siblings].map((f, k, a) => `${k + 1}/${a.length} ${summarise(f)}`).join('\n') : c.failure.responsePreview || summarise(c.failure)
        )}</failure>\n    </testcase>`
    );
  }

  if (!cases.length) {
    cases.push(
      `    <testcase classname="${esc(session.charter)}" name="Session recorded" time="${duration.toFixed(3)}">\n` +
        `      <skipped message="No reproduction steps were captured."/>\n    </testcase>`
    );
  }

  const failed = (cases.join('').match(/<failure /g) || []).length;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${commentText(esc(docFooter({ session, version: VERSION })))} -->
${embed.xml({ session, version: VERSION, kind: 'junit' })}
<testsuites name="${esc(MAKER.product)}" tests="${cases.length}" failures="${failed}" time="${duration.toFixed(3)}">
  <testsuite name="${esc(session.charter)}" tests="${cases.length}" failures="${failed}" time="${duration.toFixed(
    3
  )}" timestamp="${new Date(session.startedAt).toISOString()}" hostname="${esc(session.env?.platform || 'browser')}">
    <properties>
      <property name="url" value="${esc(session.startUrl || '')}"/>
      <property name="browser" value="${esc(session.env?.userAgent || '')}"/>
      <property name="viewport" value="${esc(session.env?.viewport || '')}"/>
      <property name="language" value="${esc(session.env?.language || '')}"/>
      <property name="failureEvents" value="${failures.length}"/>
    </properties>
${cases.join('\n')}
  </testsuite>
</testsuites>`;
}

/* ── HAR ───────────────────────────────────────────────────────────────── */

/**
 * The network log, in the format DevTools exports and every HTTP tool imports.
 *
 * Honest about what it is: the recorder captures method, URL, status, duration
 * and a response preview — not headers, not request bodies. Those fields are
 * emitted empty rather than invented, and the comment says so, because a HAR
 * with fabricated headers is worse than one that is plainly partial.
 */
export function buildHar(session, events) {
  const net = events.filter((e) => e.kind === 'net').map(normaliseNetEvent).map((e) => (e.reqBody ? { ...e, reqBody: maskBodyKeys(e.reqBody) } : e)); // D-1010-133: credential body keys leave as the marker
  const started = new Date(session.startedAt).toISOString();

  return JSON.stringify(
    {
      log: {
        version: '1.2',
        // The version is imported, not typed. It used to say 1.7.0 in a 1.9.0
        // build, which is exactly how a HAR gets blamed on the wrong release.
        creator: { name: MAKER.product, version: VERSION, comment: `by ${MAKER.owner}` },
        browser: { name: 'Chrome', version: (/Chrome\/([\d.]+)/.exec(session.env?.userAgent || '') || [])[1] || session.env?.userAgent || 'unknown' },
        // The HAR spec reserves `_`-prefixed keys for tools and requires
        // readers to ignore what they do not know, so the full record fits
        // here with nothing traded away — no comment line, no lost field.
        //
        // `_njb` until 5 September 2026. Nothing in this product reads a HAR
        // back in — the file is written for DevTools, Charles and whoever the
        // tester sends it to — so there is no old key to keep reading, and a
        // HAR exported before today keeps the name it was written with.
        _qawrap: provenance({ session, version: VERSION, kind: 'har' }),
        comment:
          'Captured by a browser extension from fetch/XHR instrumentation, not from the ' +
          'network stack, so timings are wall-clock around the call rather than connect / ' +
          'send / wait phases, and sizes are of what JavaScript saw. Values of headers and ' +
          'fields whose names look like credentials are masked as they are captured, and this ' +
          'file is scanned again when it is written: keys, JWTs, vendor tokens and Basic-auth ' +
          'values found in it are redacted, as are URL-query values named like a token, password or ' +
          'secret. An opaque token with no recognisable shape carried in a URL query is kept as the page ' +
          'sent it, so read the file before you share it. Cookie values are not recorded.',
        pages: [
          {
            startedDateTime: started,
            id: 'page_1',
            title: session.charter,
            pageTimings: { onContentLoad: -1, onLoad: -1 },
          },
        ],
        entries: net.map((e) => ({
          pageref: 'page_1',
          // `ts` is when the response came back, so the request began `durationMs` earlier; a missing or bad ts never throws.
          startedDateTime: new Date((Number.isFinite(e.ts) ? e.ts : Date.parse(started) || 0) - Math.min(Math.max(Number(e.durationMs) || 0, 0), 120000)).toISOString(),
          time: Math.round(e.durationMs || 0),
          request: {
            method: e.method || 'GET',
            url: harUrl(e.url, session.startUrl),
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: harHeaders(e.reqHeaders),
            queryString: harQuery(e.url),
            ...(formParts(e.reqBody)
              ? {
                  postData: {
                    mimeType: 'multipart/form-data',
                    params: formParts(e.reqBody).map((p) => (p.file
                      ? { name: p.name, fileName: p.file.name, contentType: p.file.type || 'application/octet-stream' }
                      : { name: p.name, value: String(p.value ?? '') })),
                  },
                }
              : e.reqBody?.text
              ? {
                  postData: {
                    mimeType:
                      e.reqBody.kind === 'form'
                        ? 'application/x-www-form-urlencoded'
                        : e.reqBody.kind === 'json'
                        ? 'application/json'
                        : 'text/plain',
                    text: e.reqBody.text,
                  },
                }
              : {}),
            headersSize: -1,
            bodySize: e.reqBody?.text != null ? byteLength(e.reqBody.text) : -1,
          },
          response: {
            status: e.error ? 0 : e.status || 0,
            statusText: e.error ? 'Network error' : '',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: harHeaders(e.resHeaders),
            content: {
              size: byteLength(e.responsePreview || ''),
              mimeType: harHeaders(e.resHeaders).find((h) => h.name.toLowerCase() === 'content-type')?.value || 'application/octet-stream',
              text: e.responsePreview || '',
              comment: e.responsePreview ? 'Preview only: truncated at capture time.' : '',
            },
            redirectURL: e.redirectedTo || '',
            headersSize: -1,
            bodySize: byteLength(e.responsePreview || ''),
          },
          cache: {},
          timings: { send: 0, wait: Math.round(e.durationMs || 0), receive: 0 },
          comment: e.overridden ? `Forced by a QA Wrap rule: ${e.ruleLabel || 'unnamed'}` : '',
        })),
      },
    },
    null,
    2
  );
}

/** HAR 1.2 wants an absolute URL; the page hook stores same-origin ones as path + query. */
function harUrl(url, base) {
  const u = url || '';
  try {
    const h = new URL(u, base || undefined);
    // r2-11-1: a query value whose name says credential (token, api_key, sig, ...) leaves as the redaction marker.
    if (h.search) h.search = h.search.slice(1).split('&').map((p) => { const i = p.indexOf('='); const n = i < 0 ? p : p.slice(0, i); return i >= 0 && isSecretParam(decodeSafe(n.replace(/\+/g, ' '))) ? n + '=' + encodeURIComponent(REDACTION) : p; }).join('&');
    return h.href;
  } catch { return u; }
}

/** HAR wants name/value pairs; the recorder holds an object. D-1010-133: a credential header leaves as the marker whether or not redaction was on. */
function harHeaders(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value: isSecretHeader(name) ? REDACTION : String(value) }));
}

/**
 * The query string, split out.
 *
 * HAR carries it twice — inside `url` and again as pairs — and every viewer
 * reads the pairs. Leaving them empty is what makes an imported HAR show a
 * blank Params tab on a request that plainly has parameters.
 */
function harQuery(url) {
  try {
    return [...new URL(url, 'https://placeholder.invalid').searchParams].map(([name, value]) => ({ name, value: isSecretParam(name) ? REDACTION : value }));
  } catch {
    return [];
  }
}

/* ── YAML ──────────────────────────────────────────────────────────────── */

/** Minimal, correct YAML — quoting anything that could be misread as a scalar. */
export function yamlValue(v, indent) {
  if (v == null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '\n' + v.map((item) => `${' '.repeat(indent)}- ${yamlValue(item, indent + 2).replace(/^\n */, '')}`).join('\n');
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '\n' + keys.map((k) => `${' '.repeat(indent)}${k}: ${yamlValue(v[k], indent + 2)}`).join('\n');
  }
  const s = String(v);
  // Quote anything that would parse as something other than a string (YAML 1.1 as well as 1.2:
  // yes/no/on/off, dates, 1e3, 0x1F, +5, 1_000, .inf), anything with a character YAML gives meaning
  // to, and any control character. A double-quoted scalar in JSON syntax is valid YAML.
  if (
    s === '' ||
    /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|:$|: |#|[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(s) ||
    /^(true|false|yes|no|on|off|y|n|null|~|=|<<)$/i.test(s) ||
    /^[-+]?(\.\d|\d)[\w.+:-]*$/.test(s) ||
    /^\d{4}-\d\d?-\d\d?/.test(s) ||
    /^[-+]?\.(inf|nan)$/i.test(s)
  ) {
    return JSON.stringify(s).replace(/[\u007f\u0085\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  return s;
}

/**
 * The longest a sentence in the YAML may run before its middle is elided.
 *
 * 160 is a wide terminal and a comfortable editor column plus the key in front
 * of it. Long enough to keep a real message whole, short enough that a stream
 * of query parameters cannot push the next key off the screen.
 */
const YAML_LINE_MAX = 160;

export function buildYaml(session, events) {
  const failures = events.filter(isFailure);
  const doc = {
    charter: session.charter,
    url: session.startUrl || null,
    startedAt: new Date(session.startedAt).toISOString(),
    durationSeconds: Number((((session.endedAt || Date.now()) - session.startedAt) / 1000).toFixed(1)),
    environment: session.env || {},
    counts: {
      events: events.length,
      problems: problemCounts(events).groups, // 1011 B5: distinct problems (repeats folded); `failures` below is the raw count
      failures: failures.length,
      steps: events.filter((e) => e.kind === 'dom').length,
      requests: events.filter((e) => e.kind === 'net').length,
    },
    /**
     * The failures, in a line a person can actually read.
     *
     * `research/54-real-session-review.md` opened the YAML from a real session
     * on YouTube and found one `what:` value that was a 1.5 KB telemetry URL on
     * a single line. YAML has no way out of that: a folded scalar joins the
     * wrapped lines back with spaces and a literal one keeps the newlines, so
     * both of them return a *different* URL to whoever parses the file. The
     * only honest choices are the unreadable long line or a shortened one that
     * says it is shortened, and this format's whole job in the list is
     * "readable structure".
     *
     * So the sentence is clamped in the middle, where `clampLabel` puts the
     * ellipsis, because both ends of a URL carry meaning. Nothing is lost: the
     * HAR has every request whole, and `json` has the untouched event.
     */
    problems: correlate(events).map((c) => ({
      what: clampLabel(summarise(c.failure), YAML_LINE_MAX),
      causedBy: c.trigger ? clampLabel(summarise(c.trigger), YAML_LINE_MAX) : null,
      gapMs: c.gapMs,
      confidence: c.confidence,
      locator: c.trigger?.locator ? `page.${c.trigger.framePrefix || ''}${c.trigger.locator}` : null,
    })),
    stepsToReproduce: reproSteps(events, byPageOf(session, events)).map((s) => s.replace(/^\d+\.\s*/, '')),
    notes: events.filter(isTesterNote).map((n) => ({ tag: n.tag || null, text: n.text, at: when(n.ts, session.startedAt) })),
  };

  return (
    `# ${attribution({ version: VERSION })}\n# ${docFooter({ session, version: VERSION })}\n` +
    `${embed.csv({ session, version: VERSION, kind: 'timeline' })}\n` +
    Object.keys(doc)
      .map((k) => `${k}: ${yamlValue(doc[k], 2)}`)
      .join('\n') +
    '\n'
  );
}
