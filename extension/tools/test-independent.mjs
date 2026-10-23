/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The extension depends on nothing at runtime that it does not carry.
 *
 *   node tools/test-independent.mjs
 *
 * Brief item G7: "The extension is independent: nothing relies on Claude or any
 * external service at runtime; grep and prove."
 *
 * ── why this is worth a suite rather than a paragraph ─────────────────────
 *
 * Three separate promises rest on it and each one fails differently:
 *
 *   **The product promise.** PRIVACY.md says the session stays on the machine.
 *   The moment one asset is fetched from a CDN, every page a tester records
 *   tells that CDN's operator when they were working and, through the referrer,
 *   what on.
 *
 *   **The store promise.** Chrome, Edge and Firefox all reject remote code
 *   (rejection code Blue Argon): no external `<script>`, no `eval` of a fetched
 *   string, no interpreter over fetched commands. A CDN font is not remote code
 *   but a CDN script is, and the line between them is easy to cross by copying
 *   a snippet.
 *
 *   **The it-still-works promise.** A QA tool is used on intranets, staging
 *   networks and aeroplanes. Anything fetched from the internet is a feature
 *   that stops working where the tool is most needed, and it stops working
 *   silently, in a way that reads as the extension being broken.
 *
 * ── what "external" means here, precisely ─────────────────────────────────
 *
 * Not "no network". The product makes exactly three kinds of request, all of
 * them to a host the tester typed in themselves:
 *
 *   · the page under test, which is the point;
 *   · an issue tracker, when somebody presses File;
 *   · a chat webhook, when somebody presses Tell the team.
 *
 * Everything else must be zero. This file proves it by walking the shipped
 * source rather than by watching a browser, because a network test only proves
 * what did not happen during the test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

/** What actually ships. `tools/` does not, and neither does anything in it. */
const SHIPPED_DIRS = ['background', 'content', 'core', 'platform', 'offscreen', 'popup', 'options', 'report',
  'replay', 'reporter', 'annotate', 'api', 'diagram', 'devtools', 'sidepanel', 'ui', 'vendor'];

function walk(rel = '') {
  const abs = path.join(EXT, rel);
  if (!fs.existsSync(abs)) return [];
  // Forward slashes, always. `path.join` gives backslashes on Windows and every
  // comparison below is against a written path like 'core/tracker-hosts.json' —
  // which quietly never matched, so the one file that is *allowed* to name
  // other people's hosts was scanned as if it were product code.
  const key = rel.split(path.sep).join('/');
  if (fs.statSync(abs).isFile()) return /\.(js|json|html|css)$/.test(key) ? [key] : [];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}

const files = [...SHIPPED_DIRS.flatMap((d) => walk(d)), 'manifest.json'];
const source = new Map(files.map((f) => [f, fs.readFileSync(path.join(EXT, f), 'utf8')]));

/** Strip comments and template literals, so prose about a URL is not a hit. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

console.log(`the package — ${files.length} shipped files, walked`);

test('the scan is actually looking at the product', () => {
  assert.ok(files.length > 60, `only ${files.length} files found`);
  assert.ok(source.get('background/handlers-session.js')?.length > 30_000); // OF-18: the worker's bulk lives in the split modules
});

/* ── no AI service, no vendor, no phone home ───────────────────────────── */

/**
 * The names of every service this must not touch.
 *
 * Claude is named in the brief because the product was built with it, and a
 * tool built with an assistant is exactly the tool most likely to have an API
 * call left in it by accident. The rest are here because they are the ones a
 * generated snippet reaches for.
 */
const SERVICES = [
  [/\banthropic\b/i, 'Anthropic'],
  [/api\.anthropic\.com/i, 'the Anthropic API'],
  [/\bclaude(?:-\d|\.ai|_api)/i, 'Claude'],
  [/api\.openai\.com|openai\.com\/v1/i, 'the OpenAI API'],
  [/generativelanguage\.googleapis\.com/i, 'the Gemini API'],
  [/\bopenrouter\.ai\b/i, 'OpenRouter'],
  [/api-inference\.huggingface\.co/i, 'Hugging Face inference'],
  [/\bsentry\.io\b|browser\.sentry-cdn/i, 'Sentry'],
  [/google-analytics\.com|googletagmanager\.com/i, 'Google Analytics'],
  [/\bmixpanel\b|\bamplitude\.com\b|\bposthog\b|\bsegment\.(?:io|com)\b/i, 'a product-analytics service'],
];

/**
 * The one named exception (features-1010 S2, owner decision 5): «AI writing». Off by default, the user's own key, one request
 * per press of a button in a report, text masked first. These files may NAME the three providers; the next test pins how narrow
 * the exception is. Any other file naming a model service, or any other service in this list, still fails.
 */
const AI_WRITING_FILES = new Set(['core/ai-write.js', 'platform/i18n/en.json', 'platform/i18n/ar.json', 'manifest.json', 'options/ai-writing.html-fragment']);

test('AI writing is the one opt-in exception, and it is narrow: off by default, one caller module, no background caller', () => {
  const w = source.get('core/ai-write.js') || '';
  assert.match(w, /DEFAULT_CONFIG = Object\.freeze\(\{ on: false/, 'off by default');
  const callers = [...source].filter(([f, s]) => /ai-write\.js/.test(s) && !AI_WRITING_FILES.has(f)).map(([f]) => f).sort();
  assert.deepEqual(callers, ['options/ai-writing.js', 'report/ai-suggest.js'].sort(), 'only the Settings panel and the report button import it');
  assert.ok(!callers.some((f) => /^(background|content|offscreen|popup)\//.test(f)), 'no background caller');
});

test('no AI service is called at runtime', () => {
  const found = [];
  for (const [file, src] of source) {
    // core/tracker-hosts.json is the *blocklist* the fine-print tool matches
    // against: naming a tracker there is the feature. Everywhere else, naming
    // one is a call to it.
    if (file === 'core/tracker-hosts.json') continue;
    if (AI_WRITING_FILES.has(file)) continue; // the named opt-in exception above
    for (const [shape, what] of SERVICES.slice(0, 7)) {
      if (shape.test(codeOnly(src))) found.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(found, [], `an external model service is referenced:\n         ${found.join('\n         ')}`);
});

test('no telemetry or crash-reporting service is called', () => {
  const found = [];
  for (const [file, src] of source) {
    if (file === 'core/tracker-hosts.json') continue;
    for (const [shape, what] of SERVICES.slice(7)) {
      if (shape.test(codeOnly(src))) found.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(found, [], `telemetry is in the package:\n         ${found.join('\n         ')}`);
});

/* ── no remote code, which is a store rejection ────────────────────────── */

test('no page loads a script from anywhere but this package', () => {
  const found = [];
  for (const [file, src] of source) {
    if (!file.endsWith('.html')) continue;
    for (const m of src.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:|^\/\//i.test(m[1])) found.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(found, [], 'an external <script> is remote code, and a store rejection');
});

test('no stylesheet, font or image is fetched from the internet', () => {
  // A CDN font tells its operator when a tester was working. `core/docshell.js`
  // records that this used to be an `@import` from fonts.googleapis.com and is
  // now embedded, so the comment survives and the fetch does not.
  const found = [];
  for (const [file, src] of source) {
    const code = codeOnly(src);
    for (const m of code.matchAll(/@import\s+url\(\s*["']?(https?:)?\/\/[^)]+\)/gi)) {
      found.push(`${file}: ${m[0].slice(0, 60)}`);
    }
    if (!file.endsWith('.html')) continue;
    for (const m of src.matchAll(/<link[^>]*\shref\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:|^\/\//i.test(m[1])) found.push(`${file}: ${m[1]}`);
    }
    for (const m of src.matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:|^\/\//i.test(m[1])) found.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(found, []);
});

test('nothing evaluates a string as code', () => {
  const found = [];
  for (const [file, src] of source) {
    const code = codeOnly(src);
    // `new Function` is how a fetched string becomes code without the word
    // `eval` appearing anywhere. Both are rejection code Blue Argon.
    if (/(^|[^.\w$])eval\s*\(/.test(code)) found.push(`${file}: eval(`);
    if (/new\s+Function\s*\(/.test(code)) found.push(`${file}: new Function(`);
  }
  assert.deepEqual(found, []);
});

test('the manifest forbids remote code in the extension’s own pages', () => {
  const manifest = JSON.parse(source.get('manifest.json'));
  const csp = manifest.content_security_policy?.extension_pages || '';
  assert.match(csp, /script-src 'self'/, 'only scripts from this package may run');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/, "a page must not be able to move its own base");
  assert.ok(!/unsafe-eval|unsafe-inline/.test(csp), 'that is the whole point of the policy');
});

/* ── every request the product does make ───────────────────────────────── */

/**
 * The complete list of hosts named in the shipped source.
 *
 * Frozen. A new host appearing here is either a tracker adapter (which posts
 * to a site the tester configured) or something that should not be in the
 * package, and the difference is a decision somebody has to make on purpose.
 */
const ALLOWED_HOSTS = new Set([
  'chromewebstore.google.com', // PRODUCT.reviewUrl: a passive 'Rate' link in Settings and on the welcome page; opened only by the person, never fetched
  // Issue trackers and chat services. Every one is reached only when a tester
  // presses File or Tell the team, against a host and a token they configured.
  'hooks.slack.com', 'api.telegram.org', 'chat.googleapis.com',
  'discord.com', 'discordapp.com', 'api.trello.com', 'app.asana.com',
  'api.clickup.com', 'api.linear.app', 'api.github.com', 'github.com',
  // e1022: the About card's maker links (portfolio), opened only when the tester presses them.
  'nj-burrito.github.io', 'www.linkedin.com', // the maker's LinkedIn link in About, opened only on a press
  'gitlab.com', 'dev.azure.com',
  // Shortcut and YouTrack, added 8 September 2026 with their adapters. Shortcut
  // has one fixed API host; YouTrack is self-hosted or a per-customer cloud
  // instance, so the host in the source is the placeholder shown in Settings.
  'api.app.shortcut.com', 'yourname.youtrack.cloud',
  // Standards and documentation, quoted in generated documents and in help
  // text. Never requested.
  'www.w3.org', 'schemas.openxmlformats.org', 'schema.org', 'purl.org',
  'schema.getpostman.com', 'dequeuniversity.com', 'en.wikipedia.org',
  'mozilla.org', 'feross.org', 'www.patreon.com', 'developer.chrome.com',
  'registry.npmjs.org',
  // Reserved and unroutable by design: RFC 2606 example domains, the parsing
  // base in core/istqb.js, and loopback for a team's own bot.
  'example.com', 'example.test', 'placeholder.invalid', 'staging-es.example.gov',
  'yourteam.atlassian.net', 'localhost', '127.0.0.1',
  // «AI writing» (S2, off by default): reached only when the person has turned it on, pasted their own key and pressed Send in a
  // report. Named in core/ai-write.js and the manifest's optional_host_permissions, asked for in that click.
  'api.anthropic.com', 'api.openai.com', 'openrouter.ai',
]);

test('every host named in the package is one we have accounted for', () => {
  const seen = new Map();
  for (const [file, src] of source) {
    // The tracker blocklist is a list of other people's hosts on purpose.
    if (file === 'core/tracker-hosts.json') continue;
    // Comments stripped: `core/docshell.js` records in prose that it used to
    // `@import` a font from fonts.googleapis.com and no longer does, and a note
    // saying a thing was removed must not read as the thing.
    // Placeholder text is never fetched — it is example copy shown in an
    // empty input — so a host-shaped string inside `placeholder="..."` is
    // exempt here; hrefs and script src attributes still get scanned.
    const scanned = file.endsWith('.html')
      ? codeOnly(src).replace(/\bplaceholder\s*=\s*"[^"]*"|\bplaceholder\s*=\s*'[^']*'/g, '')
      : codeOnly(src);
    for (const m of scanned.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].toLowerCase().replace(/\.$/, '');
      // `https://${host}/...` in a template literal leaves an empty or partial
      // capture. A host has a dot in it, or is loopback.
      if (!host || (!host.includes('.') && host !== 'localhost')) continue;
      if (ALLOWED_HOSTS.has(host)) continue;
      if (!seen.has(host)) seen.set(host, file);
    }
  }
  assert.deepEqual(
    [...seen].map(([h, f]) => `${h} (${f})`),
    [],
    'a host nobody has accounted for is named in the package. If it is a new tracker, ' +
      'add it to ALLOWED_HOSTS with a line saying who reaches it and when.'
  );
});

test('nothing fetches on its own: every fetch is behind a press', () => {
  // The service worker's own top level is where a phone-home would live: a
  // licence check, an update ping, a "how many installs" beacon. There is no
  // fetch there at all, and this is what keeps it that way.
  const sw = [...source].filter(([k]) => /^background\/(service-worker|worker-|handlers-)/.test(k)).map(([, v]) => v).join('\n');
  const topLevel = codeOnly(sw)
    .split('\n')
    // Anything at column 0 that is not inside a function body. Crude, and
    // enough: a phone-home has to run without being called.
    .filter((l) => /^(await |fetch\(|void fetch)/.test(l));
  assert.deepEqual(topLevel, [], 'the worker fetches something at load');
});

test('the product says so in its own words, and the words are still there', () => {
  // A promise in a document nobody keeps in step with the code is worse than
  // no promise. This is the sentence, and this is what checks it.
  const privacy = fs.readFileSync(path.join(EXT, 'PRIVACY.md'), 'utf8');
  assert.match(privacy, /local|machine/i);
  const product = source.get('core/product.js');
  assert.match(product, /Local-first/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
