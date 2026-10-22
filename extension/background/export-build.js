/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Every document this product hands over, built where a document may be built.
 *
 * ── why this file exists ───────────────────────────────────────────────────
 *
 * `buildExport()` used to live in `background/service-worker.js`, and with it
 * the twenty modules it reaches for: the exporters, the ISO 29119 documents, the
 * Playwright spec writer, the workbooks, the flow diagram, the Postman pair.
 * None of that is needed to record a session, and all of it was parsed on every
 * cold start, because a service worker's module graph must be knowable at
 * registration and `import()` throws there
 * (`tools/test-worker-imports.mjs` carries the whole finding).
 *
 * So the switch moved here, and this module is loaded **on demand by the
 * offscreen document** — an ordinary page, which may `import()` — at the moment
 * somebody presses Export. `offscreen/offscreen.js` owns the door;
 * `background/media.js` `exportOp()` is the worker's side of it.
 *
 * ── what did not change ───────────────────────────────────────────────────
 *
 * The switch is the same switch, case for case. Every format keeps its filename
 * shape, its MIME type and its encoding, because the popup, the report page and
 * the DevTools panel all decode what comes back and none of them was touched.
 * `UQA_EXPORT` is still `UQA_EXPORT`. The provenance signature is still stamped
 * by the builders themselves in `core/`, exactly where `tools/test-provenance.mjs`
 * asserts it, and nothing here talks to a network.
 *
 * Reading the session is the D2 pattern: this page opens IndexedDB itself
 * through `core/db.js` rather than having a worker pass megabytes of screenshots
 * over a message channel one field at a time.
 */
import { getSession, getEvents, getCaptures } from '../core/db.js';
import { sha256Hex, captureHashes } from '../core/integrity.js';
import { stampDocument } from '../core/provenance-stamp.js';
import { getSettings } from '../platform/settings.js';
import { scanOutbound } from '../core/secret-scan-text.js';
import { loadDocFonts } from '../core/docshell.js';
import { buildPlaywrightSpec } from '../core/artifact.js';
/*
 * The Markdown, JSON and session-sheet builders live in their own module
 * since 8 September 2026. They are only ever built here, in the offscreen
 * document, and keeping them out of `core/artifact.js` keeps twelve kilobytes
 * the service worker can never call out of the graph it re-parses on every
 * cold start. See the note at the top of `core/artifact-docs.js`.
 */
import { buildMarkdown, buildJson, buildSessionSheet } from '../core/artifact-docs.js';
import {
  buildHtml, buildText, buildJunit, buildHar, buildYaml,
  shouldGzipExport, gzipText, gzName, byteLength, GZIP_MIME,
} from '../core/exporters.js';
import { buildSrs, buildManual, buildStoryboard, buildStoryboardHtml, buildSessionManifest, buildSrsHtml, buildManualHtml } from '../core/docs.js';
import { toJira } from '../core/formats.js';
import { toMarkdownIssue, toCsv } from '../core/formats-export.js';
import { buildAgentBrief } from '../core/agent.js';
import { buildLocatorSet } from '../core/locatorset.js';
import { buildTestPlan, buildLocatorSheet, kebab } from '../core/locatorplan.js';
import { buildTestSuite, suiteToMarkdown, suiteToCsv } from '../core/suite.js';
import { buildPostmanCollection, buildPostmanEnvironment } from '../core/postman.js';
import { buildPageMap, buildPageObject, buildHarvestBrief, className as pageClassName } from '../core/harvest.js';
import { buildLinksReport, buildLinksHtml } from '../core/links-report.js';
import { buildTimelineWorkbook, buildSessionWorkbook } from '../core/sheets.js';
import { toBase64, XLSX_MIME } from '../core/xlsx.js';
import { buildFlow, flowToSvg } from '../core/flow.js';
import { stripControl } from '../core/exporters.js';
import { buildBundleZip, BUNDLE_SHOTS, bundleIds, bundleFilename, exportSlug } from '../core/presets.js';

/** One session and its events, read here rather than passed in. */
async function loadSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`No session with the id ${sessionId}.`);
  return { session, events: await getEvents(sessionId) };
}

/**
 * The brand assets a document embeds, read from the extension once.
 *
 * A saved HTML file has to carry its own lockup — it will be opened from a
 * disk, offline, by someone without the extension — so the SVG is inlined.
 * Fetched lazily and cached; a failure leaves the shell to set the name in
 * type, which is the honest fallback.
 *
 * The document faces are primed here for the same reason and at the same
 * moment: this function is awaited immediately before every document the
 * product writes, so a report cannot be built with the lockup embedded and
 * the typeface missing. `loadDocFonts()` caches for the life of the page; if
 * `ui/fonts.css` were ever missing a cut it would throw, and that throw lands
 * in the same `catch` as a failed lockup fetch below — the honest fallback
 * for this one shared helper. `core/docshell.js`'s `shell()` is the harder
 * guard: it refuses outright to build an HTML document without a font ever
 * having loaded, so a build that skips this function entirely still fails
 * loudly rather than shipping silently.
 */
let brandAssetsCache = null;
async function brandAssets() {
  if (brandAssetsCache) return brandAssetsCache;
  try {
    const [svg, fonts] = await Promise.all([
      (await fetch(chrome.runtime.getURL('brand/lockup.svg'))).text(),
      loadDocFonts(),
    ]);
    brandAssetsCache = { lockup: svg.replace(/<!--[\s\S]*?-->/g, '').trim(), fonts };
  } catch {
    brandAssetsCache = {};
  }
  return brandAssetsCache;
}

/**
 * A stored screenshot as a data URL a Markdown or HTML report can embed.
 *
 * Chunked deliberately: `String.fromCharCode(...bytes)` on a 650KB image
 * exceeds the maximum argument count and throws, and `FileReader` does not
 * exist in a service worker — so this is the only route from a stored Blob to
 * an embeddable string on this side of the extension.
 */
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

const lastOfKind = (events, kind, what) => {
  const ev = [...events].reverse().find((e) => e.kind === kind);
  if (!ev) throw new Error(`No ${what} in this session. Run the tool while recording, then export.`);
  return ev;
};

/**
 * The bytes of one export, uncompressed.
 *
 * Split from `exportSession` so the compression decision has somewhere to sit
 * that is not inside a thirty-case switch, and so the callers that need the raw
 * text — attaching to a Jira issue, where the far end wants a readable file —
 * can ask for it without going round the gzip.
 */
async function buildExportRaw({ sessionId, format, withImages = true, files, version, shotPaths }) {
  /*
   * The build number is passed in, not read here.
   *
   * `chrome.runtime.getManifest()` is a service-worker and extension-page API;
   * in this document it is not a function, and two formats called it. The
   * failure was quiet in the worst way: the export came back as an error the
   * report showed in its status line while the pane sat empty, so the pane said
   * "wrong content" and the status said what had actually happened. The caller
   * has the version; it sends it.
   */
  const build = version || globalThis.chrome?.runtime?.getManifest?.()?.version || '';
  const { session, events } = await loadSession(sessionId);

  let captures = {};
  if (withImages) {
    // `&& e.captureId`, because a screenshot event can exist without one: an
    // interrupted capture writes the event before the blob lands. Without the
    // guard that `undefined` reaches IndexedDB as a key and throws, and the
    // whole export dies over one missing thumbnail.
    const ids = events.filter((e) => e.kind === 'screenshot' && e.captureId).map((e) => e.captureId);
    const records = await getCaptures(ids);
    for (const [id, rec] of Object.entries(records)) {
      // `blob: undefined` keeps a multi-megabyte binary out of the Raw JSON
      // export, which has to stay text — while the data URL is what makes the
      // Markdown and HTML reports actually carry their evidence.
      captures[id] = rec.dataUrl
        ? { ...rec, path: shotPaths?.[id] }
        : { ...rec, blob: undefined, sha256: rec.sha256 || (rec.blob ? await sha256Hex(rec.blob) : ''), dataUrl: rec.blob ? await blobToDataUrl(rec.blob) : null, path: shotPaths?.[id] };
    }
  }

  const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = exportSlug(session.charter, session.id);

  switch (format) {
    case 'markdown':
      return { filename: `qaw-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildMarkdown(session, events, captures) };
    case 'json':
      return { filename: `qaw-${slug}-${stamp}.json`, mime: 'application/json', content: buildJson(session, events, captures) };
    case 'playwright':
      return { filename: `qaw-${slug}-${stamp}.spec.ts`, mime: 'text/plain', content: buildPlaywrightSpec(session, events) };
    case 'sbtm':
      return { filename: `qaw-session-sheet-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildSessionSheet(session, events) };
    case 'jira':
      return { filename: `qaw-jira-${slug}-${stamp}.txt`, mime: 'text/plain', content: toJira(session, events) };
    case 'github':
      return { filename: `qaw-issue-${slug}-${stamp}.md`, mime: 'text/markdown', content: toMarkdownIssue(session, events) };
    case 'csv':
      return { filename: `qaw-timeline-${slug}-${stamp}.csv`, mime: 'text/csv', content: toCsv(session, events) };
    case 'html':
      return { filename: `qaw-${slug}-${stamp}.html`, mime: 'text/html', content: buildHtml(session, events, captures, await brandAssets()) };
    case 'text':
      return { filename: `qaw-${slug}-${stamp}.txt`, mime: 'text/plain', content: buildText(session, events) };
    case 'junit':
      return { filename: `qaw-junit-${slug}-${stamp}.xml`, mime: 'application/xml', content: buildJunit(session, events) };
    case 'har':
      return { filename: `qaw-network-${slug}-${stamp}.har`, mime: 'application/json', content: buildHar(session, events) };
    case 'yaml':
      return { filename: `qaw-${slug}-${stamp}.yaml`, mime: 'text/yaml', content: buildYaml(session, events) };
    case 'agent':
      return {
        filename: `qaw-agent-brief-${slug}-${stamp}.json`,
        mime: 'application/json',
        content: buildAgentBrief(session, events, captures),
      };
    case 'locator-set':
      return {
        filename: `qaw-locator-set-${slug}-${stamp}.json`,
        mime: 'application/json',
        content: buildLocatorSet(session, events),
      };
    /*
     * The same picks, in the format the tool that consumes them actually reads:
     * `specs/<feature>.plan.md` for `playwright-cli`'s Plan stage. Named by the
     * charter rather than the session, because that is the file name the plan's
     * own scenarios refer to. See `core/locatorplan.js` for why this exists
     * beside the JSON rather than instead of it.
     */
    case 'test-plan':
      return {
        filename: `${kebab(session.charter || slug)}.plan.md`,
        mime: 'text/markdown',
        content: buildTestPlan(session, events),
      };
    /* The same picks as a reference sheet, sorted by what each was picked for. */
    case 'locator-sheet':
      return {
        filename: `${kebab(session.charter || slug)}.locators.md`,
        mime: 'text/markdown',
        content: buildLocatorSheet(session, events),
      };
    case 'suite':
      return {
        filename: `qaw-suite-${slug}-${stamp}.md`,
        mime: 'text/markdown',
        content: suiteToMarkdown(buildTestSuite(session, events)),
      };
    case 'suite-csv':
      return {
        filename: `qaw-suite-${slug}-${stamp}.csv`,
        mime: 'text/csv',
        content: suiteToCsv(buildTestSuite(session, events)),
      };
    case 'postman':
      return {
        filename: `qaw-${slug}-${stamp}.postman_collection.json`,
        mime: 'application/json',
        content: JSON.stringify(buildPostmanCollection({ ...session, version: build }, events), null, 2),
      };
    case 'postman-env':
      return {
        filename: `qaw-${slug}-${stamp}.postman_environment.json`,
        mime: 'application/json',
        /*
         * The build number, which this one file was shipping as `null`.
         *
         * `buildPostmanEnvironment` passes its session straight to
         * `provenance()`, which reads `version` off it — and every other case
         * in this switch spreads `{ ...session, version: build }` while this
         * one did not, so the environment's `_qawrap_provenance.version` came
         * out `null` on every export. Found in Nader's own session folder of 7
         * September 2026 (research/54-real-session-review.md, finding 10):
         * every other artefact beside it named a build and this one named
         * nothing, which is the one thing a provenance block exists to do.
         */
        content: JSON.stringify(buildPostmanEnvironment({ ...session, version: build }, events), null, 2),
      };
    case 'harvest-map': {
      const h = lastOfKind(events, 'harvest', 'page map');
      return { filename: `qaw-page-map-${slug}-${stamp}.json`, mime: 'application/json', content: buildPageMap(h, { ...session, version: build }) };
    }
    case 'harvest-pom': {
      const h = lastOfKind(events, 'harvest', 'page map');
      return { filename: `${pageClassName(h)}.ts`, mime: 'text/plain', content: buildPageObject(h) };
    }
    case 'harvest-brief': {
      const h = lastOfKind(events, 'harvest', 'page map');
      return { filename: `qaw-page-brief-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildHarvestBrief(h, session) };
    }
    case 'links':
      return { filename: `qaw-links-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildLinksReport(lastOfKind(events, 'links', 'link check')) };
    /*
     * The fine print, read off the event rather than rebuilt.
     *
     * `core/filing.js:212` has declared this artefact since it was written, and
     * `report/report.js` has been saving it by hand out of the event's stored
     * Markdown, but `UQA_EXPORT` had no case for it: the format answered
     * `{"ok":false,"error":"Unknown export format: fine-print"}` to anything
     * that asked (research/58, finding 15). So the document existed on one
     * route and did not exist on the other, which is the worst of both.
     *
     * It is not re-derived here, and that is deliberate. Every other case in
     * this switch builds its document now, from the session; this one was built
     * when the tester pressed the tool, against the page as it was then.
     * Re-deriving it would read a page that has since changed and hand back a
     * different document under the same name, and half the checks (consent
     * timing, what was contacted) cannot be re-answered after the fact at all.
     */
    case 'fine-print':
      return {
        filename: `qaw-fine-print-${slug}-${stamp}.md`,
        mime: 'text/markdown',
        content: lastOfKind(events, 'fineprint', 'fine-print check').markdown || '',
      };
    case 'a11y':
      return { filename: `qaw-a11y-${slug}-${stamp}.json`, mime: 'application/json', content: JSON.stringify(lastOfKind(events, 'a11y', 'accessibility scan'), null, 2) };
    // Workbooks are bytes; the message channel carries JSON, so they travel as
    // base64 with the encoding declared, and the page turns them back.
    case 'timeline-xlsx':
      return { filename: `qaw-timeline-${slug}-${stamp}.xlsx`, mime: XLSX_MIME, encoding: 'base64', content: toBase64(buildTimelineWorkbook(session, events, await shotHashes(events))) };
    case 'sheet-xlsx':
      return { filename: `qaw-session-sheet-${slug}-${stamp}.xlsx`, mime: XLSX_MIME, encoding: 'base64', content: toBase64(buildSessionWorkbook(session, events, await shotHashes(events))) };
    case 'srs':
      return { filename: `qaw-srs-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildSrs(session, events) };
    case 'manual':
      return { filename: `qaw-manual-${slug}-${stamp}.md`, mime: 'text/markdown', content: buildManual(session, events, captures) };
    case 'storyboard':
      return { filename: `qaw-storyboard-${slug}-${stamp}.json`, mime: 'application/json', content: buildStoryboard(session, events, captures) };
    case 'storyboard-html':
      return { filename: `qaw-storyboard-${slug}-${stamp}.html`, mime: 'text/html', content: buildStoryboardHtml(session, events, captures, await brandAssets()) };
    case 'srs-html':
      return { filename: `qaw-srs-${slug}-${stamp}.html`, mime: 'text/html', content: buildSrsHtml(session, events, await brandAssets()) };
    case 'manual-html':
      return { filename: `qaw-manual-${slug}-${stamp}.html`, mime: 'text/html', content: buildManualHtml(session, events, captures, await brandAssets()) };
    case 'links-html':
      return { filename: `qaw-links-${slug}-${stamp}.html`, mime: 'text/html', content: await buildLinksHtml(lastOfKind(events, 'links', 'link check'), await brandAssets()) };
    case 'flow-svg':
    case 'flow-json': {
      // The tester's edited diagram if they kept one, else the flow read from
      // the recording — the same model either way, drawn the same way.
      const saved = [...events].reverse().find((e) => e.kind === 'diagram' && e.flow?.nodes?.length);
      const flow = saved ? saved.flow : buildFlow(session, events);
      if (format === 'flow-json') return { filename: `qaw-workflow-${slug}-${stamp}.json`, mime: 'application/json', content: JSON.stringify(flow, null, 2) };
      const assets = await brandAssets();
      return { filename: `qaw-workflow-${slug}-${stamp}.svg`, mime: 'image/svg+xml', content: flowToSvg(flow, { lockup: assets.lockup || '', fonts: assets.fonts || '' }) };
    }
    case 'session-manifest': {
      const settings = await getSettings();
      return {
        filename: `qaw-session-${slug}-${stamp}.json`,
        mime: 'application/json',
        content: buildSessionManifest(session, events, {
          tester: settings.testerName || '', version: build, files: files || [],
          checksums: await shotHashes(events),
        }),
      };
    }
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

/**
 * T-067: one zip a client can be handed: the ticked documents, the session JSON (always, without
 * pictures inside it) and every screenshot as a file under Screenshots/. Each part is built by
 * `buildExport`, so the secret scan and the control-character cut apply to every entry too.
 */
/** `{captureId: sha256}` for the session's stored screenshots (T-066; a legacy record is hashed from its blob). */
const shotHashes = async (events) => captureHashes(await getCaptures(events.filter((e) => e.kind === 'screenshot' && e.captureId).map((e) => e.captureId)));

async function buildBundle({ sessionId, parts, version }) {
  const ids = bundleIds(parts);
  const { session, events } = await loadSession(sessionId);
  // r10-11-2: the picture names come first, so each document links an omitted picture to its zip entry.
  const records = await getCaptures(events.filter((e) => e.kind === 'screenshot' && e.captureId).map((e) => e.captureId));
  const screenshots = [], shotPaths = {};
  for (const [id, rec] of Object.entries(records)) {
    const dataUrl = rec.dataUrl || (rec.blob ? await blobToDataUrl(rec.blob) : null);
    const name = `${id}.${/^data:image\/(\w+)/.exec(dataUrl || '')?.[1] || 'png'}`;
    screenshots.push({ name, dataUrl });
    shotPaths[id] = `${BUNDLE_SHOTS}/${name}`;
  }
  const built = [];
  // completion review 3: each part carries the same checksum footer or `checksums` it would as a single export (the zip's own hash is the result's sha256).
  const hashes = await shotHashes(events);
  for (const format of ids) {
    const part = await buildExport({ sessionId, format, withImages: format !== 'json', version, shotPaths });
    built.push(['markdown', 'manual', 'srs', 'sbtm', 'json'].includes(format) ? await stampDocument(part, { format, hashes }) : part);
  }
  return {
    filename: bundleFilename(session.charter, session.startedAt, session.id), mime: 'application/zip', encoding: 'base64',
    content: toBase64(buildBundleZip({ parts: built, screenshots })), parts: built.map((b) => b.filename),
  };
}

/**
 * Every text export passes the text half of the secret scan (T-012). Observe mode: findings ride
 * along as `secretScan`, and only confirmed shapes (keys, JWTs, vendor tokens, Basic auth) are cut.
 * Workbooks and other base64 output are not text and are left alone.
 */
export async function buildExport(request) {
  if (request.format === 'bundle') return buildBundle(request);
  const out = await buildExportRaw(request);
  if (out.encoding || typeof out.content !== 'string') return out;
  // T-067: control characters out of every text, here, once (they are not valid XML and mean nothing in a report).
  out.content = stripControl(out.content);
  const { findings, redacted } = scanOutbound({ content: out.content });
  return findings.length ? { ...out, content: redacted.content, secretScan: findings } : out;
}

/**
 * One export, compressed if it is big enough to be worth it.
 *
 * The rule and the threshold live in `core/exporters.js`; this is only the seam
 * that applies them. A gzipped export travels the same road every workbook
 * already travels — `encoding: 'base64'`, which the popup, the report page and
 * the DevTools panel already know how to turn back into bytes — so nothing
 * downstream needed a new code path, and `.gz` is appended to the filename so
 * the saved file says what it is.
 *
 * `note` is filled in so the surface that shows a status line can say the
 * export was compressed and by how much, rather than the tester discovering it
 * from a file that will not open in an editor.
 */
export async function exportSession(msg) {
  const out = await buildExport(msg);
  // A workbook is already bytes and already base64; gzipping an XLSX (a ZIP)
  // would add a header and save nothing.
  if (out.encoding) return out;

  if (!shouldGzipExport(msg.format, out.content)) return out;

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
