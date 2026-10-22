/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Every file type the product can produce, in one list.
 *
 * The rule that shaped this: **offer nothing the browser cannot actually
 * write.** `canvas.toBlob('image/avif')` hands back a PNG on a browser without
 * the encoder, with no error at all — so a menu that lists AVIF because AVIF
 * exists produces a file named `.avif` that is not one, discovered by whoever
 * opens it. Image and video support is therefore probed at runtime against this
 * table, not assumed from it.
 *
 * Text formats have no such problem: a string is a string, and every one of them
 * is a transform we wrote, so all of them always work.
 */

/* ── images ────────────────────────────────────────────────────────────── */

export const IMAGE_TYPES = [
  { id: 'png', mime: 'image/png', ext: 'png', label: 'PNG', note: 'Lossless. Biggest, and the safest default.' },
  { id: 'jpeg', mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', note: 'Small. No transparency: flattened onto white.' },
  { id: 'webp', mime: 'image/webp', ext: 'webp', label: 'WebP', note: 'Small and sharp. Read by every current browser.' },
  { id: 'avif', mime: 'image/avif', ext: 'avif', label: 'AVIF', note: 'Smallest of all, where the encoder exists.' },
  { id: 'bmp', mime: 'image/bmp', ext: 'bmp', label: 'BMP', note: 'Uncompressed. For tools that read nothing else.' },
];

/* ── video ─────────────────────────────────────────────────────────────── */

/**
 * Several candidate codec strings per container: `video/mp4` alone can be
 * refused while `video/mp4;codecs=avc1.42E01E` is accepted, and which one works
 * differs by build. First that answers yes, wins.
 */
export const VIDEO_TYPES = [
  {
    id: 'mp4',
    ext: 'mp4',
    label: 'MP4',
    note: 'Plays everywhere: Jira, Teams, Slack, any phone.',
    candidates: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
  },
  {
    id: 'webm',
    ext: 'webm',
    label: 'WebM',
    note: 'Smallest, and always available in Chrome.',
    // VP8 before VP9 on purpose: VP9 is the costliest software encoder Chrome
    // ships, and a recording that stutters the browser is worth nothing.
    candidates: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm'],
  },
  {
    id: 'mkv',
    ext: 'mkv',
    label: 'Matroska',
    note: 'For editors that prefer it. Same H.264 inside.',
    candidates: ['video/x-matroska;codecs=avc1', 'video/x-matroska'],
  },
  {
    id: 'gif',
    ext: 'gif',
    label: 'GIF',
    note: 'Plays inline in any ticket system. Capped at 60s, 800px wide.',
    // No browser can write a GIF; core/gif.js does it, so this one never needs
    // probing and is never unavailable.
    candidates: [],
    alwaysAvailable: true,
  },
];

/* ── text ──────────────────────────────────────────────────────────────── */

/**
 * Text artefacts. `kind` decides which folder it is filed under.
 *
 * Each is a transform in `core/artifact.js` or `core/formats.js` — nothing here
 * depends on a browser capability, so every one of them always works.
 */
export const TEXT_TYPES = [
  { id: 'markdown', ext: 'md', mime: 'text/markdown', kind: 'report', label: 'Bug report (Markdown)', note: 'The readable artefact. Screenshots embedded.' },
  { id: 'html', ext: 'html', mime: 'text/html', kind: 'report', label: 'Bug report (HTML)', note: 'The same report, styled, opens in any browser.' },
  { id: 'text', ext: 'txt', mime: 'text/plain', kind: 'report', label: 'Plain text', note: 'No markup at all. For email and chat.' },
  { id: 'json', ext: 'json', mime: 'application/json', kind: 'report', label: 'Raw JSON', note: 'Everything, machine-readable.' },
  { id: 'sbtm', ext: 'md', mime: 'text/markdown', kind: 'sheet', label: 'Session sheet (SBTM)', note: 'Charter, areas, task breakdown, notes.' },
  { id: 'playwright', ext: 'spec.ts', mime: 'text/plain', kind: 'test', label: 'Playwright spec', note: 'A runnable test from what you did.' },
  { id: 'jira', ext: 'txt', mime: 'text/plain', kind: 'ticket', label: 'Jira ticket (wiki markup)', note: 'Paste straight into a Jira description.' },
  { id: 'github', ext: 'md', mime: 'text/markdown', kind: 'ticket', label: 'GitHub / Linear / Azure issue', note: 'Markdown with tables.' },
  { id: 'csv', ext: 'csv', mime: 'text/csv', kind: 'ticket', label: 'Timeline CSV', note: 'TestRail, Xray, or a spreadsheet.' },
  { id: 'junit', ext: 'xml', mime: 'application/xml', kind: 'test', label: 'JUnit XML', note: 'What CI servers and test managers ingest.' },
  { id: 'har', ext: 'har', mime: 'application/json', kind: 'report', label: 'HAR (network)', note: 'Every request, in the format DevTools exports.' },
  { id: 'yaml', ext: 'yaml', mime: 'text/yaml', kind: 'report', label: 'YAML', note: 'Readable structure, for config-driven pipelines.' },
  { id: 'agent', ext: 'json', mime: 'application/json', kind: 'report', label: 'Agent brief (for an AI)', note: 'Findings, severity and confidence. Third-party noise removed.' },
  { id: 'harvest-map', ext: 'json', mime: 'application/json', kind: 'test', label: 'Page map (JSON)', note: 'Every interactive element with a verified locator.' },
  { id: 'harvest-pom', ext: 'ts', mime: 'text/plain', kind: 'test', label: 'Page object (Playwright)', note: 'Locators as fields, one fill/submit pair per form.' },
  { id: 'harvest-brief', ext: 'md', mime: 'text/markdown', kind: 'test', label: 'Page brief (for an AI)', note: 'The locators and the rules for writing tests from them.' },
  { id: 'links', ext: 'md', mime: 'text/markdown', kind: 'report', label: 'Link check', note: 'Every link on the page, its status, and where it really went.' },
  { id: 'fine-print', ext: 'md', mime: 'text/markdown', kind: 'report', label: 'The fine print', note: 'Policies, consent, tracking, hygiene and security, with the questions only a person can answer.' },
  { id: 'timeline-xlsx', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'ticket', label: 'Timeline (Excel)', note: 'Summary, timeline, failures and steps as sheets; filter with one click.' },
  { id: 'sheet-xlsx', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'sheet', label: 'Session sheet (Excel)', note: 'The SBTM record as a workbook.' },
  { id: 'srs', ext: 'md', mime: 'text/markdown', kind: 'docs', label: 'Requirements specification', note: '29148-shaped, from what was walked; gaps marked.' },
  { id: 'srs-html', ext: 'html', mime: 'text/html', kind: 'docs', label: 'Requirements specification (page)', note: 'The same, styled, with a legend and contents.' },
  { id: 'manual-html', ext: 'html', mime: 'text/html', kind: 'docs', label: 'User manual (page)', note: 'The manual with its screenshots, ready to read or print.' },
  { id: 'links-html', ext: 'html', mime: 'text/html', kind: 'report', label: 'Link check (page)', note: 'Broken, redirected and slow, styled.' },
  { id: 'manual', ext: 'md', mime: 'text/markdown', kind: 'docs', label: 'User manual', note: 'Step by step, with the screenshots, from the recording.' },
  { id: 'storyboard-html', ext: 'html', mime: 'text/html', kind: 'docs', label: 'Video storyboard (review)', note: 'Scenes, narration and timings, for a person to check.' },
  { id: 'storyboard', ext: 'json', mime: 'application/json', kind: 'docs', label: 'Video storyboard (JSON)', note: 'The same scenes, for a video generator or an AI.' },
  { id: 'flow-svg', ext: 'svg', mime: 'image/svg+xml', kind: 'docs', label: 'Workflow diagram (SVG)', note: 'A4 landscape, flow left to right, Arabic labels, legend footer.' },
  { id: 'flow-json', ext: 'json', mime: 'application/json', kind: 'docs', label: 'Workflow diagram (model)', note: 'Boxes, arrows and the user story, for a tool or an AI.' },
];

export const byId = (list, id) => list.find((t) => t.id === id) || null;
