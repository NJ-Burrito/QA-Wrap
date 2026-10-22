/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `DEPLOYMENT-VALUES.txt` is true, and the package carries no credential.
 *
 *   node tools/test-deployment-values.mjs
 *
 * ── the two things this holds shut ────────────────────────────────────────
 *
 * **A map that has stopped matching the ground is worse than no map.** Brief
 * item G5 asks for one text file naming every value somebody deploying this
 * would want to change, "point to file and line for each". A file:line
 * reference rots the moment anybody inserts a line above it, and it rots
 * silently — nobody re-reads a deployment note until the day they need it, and
 * that is the worst day to find it points at the wrong string. So every
 * reference in that file is parsed out of it here and checked against the
 * source, on every test run.
 *
 * **Nothing that looks like a credential may be in the package.** Everything
 * in a CRX is readable by anyone who unzips it, so a token committed by
 * accident is a token published. The scan below is the crude, useful kind: the
 * literal shapes that tokens actually have. It cannot catch every secret, and
 * it catches the ones people actually leak.
 *
 * ── the reference format the map must use ─────────────────────────────────
 *
 *   path/to/file.js:123   anything after the reference is prose
 *   path/to/file.js:181-185
 *   path/to/file.js       (no line: only the file has to exist)
 *
 * A range is checked at both ends. Anything else in the file is prose and is
 * ignored, which is what keeps the map readable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = 'DEPLOYMENT-VALUES.txt';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const map = fs.readFileSync(path.join(EXT, MAP), 'utf8');

/* ── every reference points at something ───────────────────────────────── */

/** `core/product.js:41` or `core/blackbox.js:181-185`, at the start of a line. */
const REF = /^\s{2}([A-Za-z0-9_./-]+\.(?:js|json|html|txt|md))(?::(\d+)(?:-(\d+))?)?\b/gm;

const refs = [...map.matchAll(REF)].map((m) => ({
  file: m[1],
  from: m[2] ? Number(m[2]) : null,
  to: m[3] ? Number(m[3]) : null,
}));

console.log(`${MAP} — every reference in it still points at something`);

test('the map names some references at all', () => {
  // A map that has quietly become prose would otherwise pass every check below
  // by having nothing to check.
  assert.ok(refs.length >= 20, `only ${refs.length} references found; the map has lost its content`);
});

test('every file it names is in the package', () => {
  const missing = [...new Set(refs.map((r) => r.file))].filter((f) => !fs.existsSync(path.join(EXT, f)));
  assert.deepEqual(missing, [], `named in ${MAP} and not in the package: ${missing.join(', ')}`);
});

test('every line it names exists', () => {
  const bad = [];
  for (const ref of refs) {
    if (ref.from == null) continue;
    const lines = fs.readFileSync(path.join(EXT, ref.file), 'utf8').split('\n');
    for (const n of [ref.from, ref.to].filter(Boolean)) {
      if (n > lines.length) bad.push(`${ref.file}:${n} (the file has ${lines.length} lines)`);
    }
  }
  assert.deepEqual(bad, []);
});

/**
 * The value quoted beside a reference is on the line it names.
 *
 * This is the check that actually catches drift: a line number can still exist
 * after somebody inserts twenty lines above it, and point at something else
 * entirely. The map writes the value it means in the same row, so the row can
 * be verified as a whole.
 */
test('the value quoted beside each reference is on that line', () => {
  const B = JSON.parse(fs.readFileSync(path.join(EXT, 'brand/brand.json'), 'utf8'));
  const quoted = [
    ['brand/brand.json', 'name', B.name],
    ['brand/brand.json', 'code', B.code],
    ['brand/brand.json', 'tagline', B.tagline],
    ['brand/brand.json', 'extensionId', B.extensionId],
    ['brand/brand.json', 'maker', B.maker.en],
  ];
  for (const [file, key, value] of quoted) {
    // Find the row in the map that names this key, take its line number, and
    // read that line out of the source.
    const row = new RegExp(`^\\s{2}${file.replace(/[.]/g, '\\.')}:(\\d+)\\s+${key}\\b`, 'm').exec(map);
    assert.ok(row, `${MAP} no longer names ${file} ${key}`);
    const line = fs.readFileSync(path.join(EXT, file), 'utf8').split('\n')[Number(row[1]) - 1] || '';
    assert.ok(
      line.includes(value),
      `${MAP} says ${file}:${row[1]} is "${value}"; that line reads:\n         ${line.trim()}`
    );
  }
});

test('the values repeated outside brand.json still match it (generated; see test-brand-sync)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(EXT, 'brand/brand.json'), 'utf8'));
  assert.equal(manifest.homepage_url || '', B.urls.homepage);
  assert.equal(manifest.name, B.name);
});

/* ── nothing in the package looks like a credential ────────────────────── */

/** What actually ships. `tools/` and the fixtures in it never do. */
const SHIPPED = ['background', 'content', 'core', 'platform', 'offscreen', 'popup', 'options', 'report',
  'replay', 'reporter', 'annotate', 'api', 'diagram', 'devtools', 'sidepanel', 'ui', 'manifest.json'];

function shippedFiles(rel = '') {
  const abs = path.join(EXT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return /\.(js|json|html|css)$/.test(rel) ? [rel] : [];
  return fs.readdirSync(abs).flatMap((name) => shippedFiles(path.join(rel, name)));
}

const files = SHIPPED.flatMap((s) => shippedFiles(s));

/**
 * The shapes real leaked credentials have.
 *
 * Deliberately literal prefixes rather than "a long random-looking string":
 * this file is full of base64 (the manifest key, embedded fonts, icons) and a
 * high-entropy heuristic would cry wolf on every one of them until somebody
 * turned the check off. A prefix scan catches what people actually paste.
 */
const CREDENTIAL_SHAPES = [
  [/\bghp_[A-Za-z0-9]{20,}/, 'a GitHub personal access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'],
  [/\bglpat-[A-Za-z0-9_-]{15,}/, 'a GitLab token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bsk-[A-Za-z0-9]{32,}/, 'an OpenAI-style secret key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bATATT[A-Za-z0-9_-]{20,}/, 'an Atlassian API token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]/, 'a real Slack webhook'],
  [/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d/, 'a real Discord webhook'],
  [/\bapi\.telegram\.org\/bot\d{6,}:/, 'a real Telegram bot token'],
];

console.log('\nthe package — no credential is in it');

test('the shipped tree scan found files to scan', () => {
  assert.ok(files.length > 40, `only ${files.length} shipped files found; the scan is not looking at the product`);
});

test('nothing in the shipped tree is shaped like a credential', () => {
  const found = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
    for (const [shape, what] of CREDENTIAL_SHAPES) {
      const hit = shape.exec(src);
      if (hit) found.push(`${rel}: ${what} (${hit[0].slice(0, 12)}…)`);
    }
  }
  assert.deepEqual(found, [], `a credential is in the package:\n         ${found.join('\n         ')}`);
});

test('the credential fields ship empty', () => {
  const settings = fs.readFileSync(path.join(EXT, 'platform/settings.js'), 'utf8');
  assert.match(settings, /jira: \{ baseUrl: '', email: '', token: '', project: '', issueType: 'Bug', authMode: 'auto' \}/);
  assert.match(settings, /slack: \{ webhookUrl: '', mention: '' \}/);
});

test('the manifest carries the public key and no private one', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.ok(manifest.key, 'the public key fixes the extension id and must be here');
  assert.ok(!/PRIVATE/.test(manifest.key));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
