/* QA Wrap — the axe-core licence stays on the file it came pinned to. */
/**
 * `vendor/axe.min.js` is the one piece of this extension the maker did not
 * write: axe-core, redistributed unmodified under the Mozilla Public
 * License. MPL-2.0 is a file-level copyleft, not a project-level one, which
 * is exactly why it works for a vendored bundle. The licence rides inside
 * the file itself, as the comment block at the very top, and that comment
 * says in its own words that it "must appear in every copy". A build step
 * that minifies, concatenates or otherwise touches this file without
 * knowing that would strip the one thing that makes redistributing it legal,
 * silently, because nothing downstream would notice the file still runs
 * fine without its opening comment. This test reads the banner and fails
 * loudly if it is ever gone, shortened, or swapped for a different licence.
 *
 * The second failure mode is quieter and more likely: the version drifts.
 * `axe-core@4.13.0` is named in six places in this repo, not one, because
 * a version number is the kind of fact that gets typed by hand into
 * whatever document someone happens to be writing that week (`NOTICE`,
 * `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`, the Firefox store
 * submission notes) rather than read from a single source. Six copies of a
 * fact agree only until the next `npm i -D axe-core` refresh, at which
 * point five of them go stale and nothing before this test would ever say
 * so. So `vendor/README.md` is made the one pin: everything else is
 * checked against it, and it in turn is checked against the banner actually
 * sitting in the vendored file, so the file, not a person's memory of the
 * file, is the root of truth.
 *
 * Third: the vendored file could simply change out from under the pin,
 * whether by a careless hand-edit, a bad merge, or a supply-chain swap of
 * the file on disk, and none of the checks above would catch it if the new
 * file happened to keep a valid-looking banner. So the exact bytes are
 * pinned too, by length and by SHA-256, recorded in `vendor/README.md`
 * next to the version. `tools/release-check.mjs`, `core/product.js` and the
 * repo-root `site/` folder already have their own jobs; this test does not
 * touch any of them; it only reads the vendored file and the docs that
 * describe it.
 *
 *   node tools/test-axe-banner.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

const axePath = path.join(EXT, 'vendor', 'axe.min.js');
const readmePath = path.join(EXT, 'vendor', 'README.md');
const axeSrc = fs.readFileSync(axePath, 'utf8');
const readmeSrc = fs.readFileSync(readmePath, 'utf8');

await test('vendor/axe.min.js opens with the axe licence banner', () => {
  const m = /^\/\*!\s*axe v(\d+\.\d+\.\d+)/.exec(axeSrc);
  if (!m) {
    throw new Error(
      'vendor/axe.min.js does not start with the "/*! axe vX.Y.Z" banner. ' +
        'The MPL-2.0 notice this file ships under lives in that opening comment; ' +
        'if the file was refreshed or re-minified without it, redistributing it is no longer covered.',
    );
  }
  const blockEnd = axeSrc.indexOf('*/');
  const block = blockEnd === -1 ? axeSrc.slice(0, 700) : axeSrc.slice(0, blockEnd + 2);
  // The banner wraps across comment lines, each continuation starting with
  // a "*" gutter, so "Mozilla Public\n * License" is one phrase split by the
  // block-comment formatting, not two. Strip the per-line "*" gutter and
  // collapse whitespace before looking for the sentences, so a reflow of the
  // same words never trips this.
  const flat = block
    .split('\n')
    .map((l) => l.replace(/^\s*\*+\/?\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
  for (const needle of ['Mozilla Public License', 'MPL', 'This entire copyright notice must appear in every copy']) {
    if (!flat.includes(needle)) {
      throw new Error(`vendor/axe.min.js banner is missing the phrase "${needle}". Full opening block:\n${block}`);
    }
  }
});

function bannerVersion() {
  const m = /^\/\*!\s*axe v(\d+\.\d+\.\d+)/.exec(axeSrc);
  if (!m) throw new Error('cannot read version out of vendor/axe.min.js banner');
  return m[1];
}

function readmeVersion() {
  const m = /^- Package: axe-core@(\d+\.\d+\.\d+)\s*$/m.exec(readmeSrc);
  if (!m) {
    throw new Error(
      'vendor/README.md has no "- Package: axe-core@X.Y.Z" line. That line is the single pin ' +
        'every other mention of the version in this repo is checked against.',
    );
  }
  return m[1];
}

await test('vendor/README.md pins a version that matches the vendored banner', () => {
  const pinned = readmeVersion();
  const actual = bannerVersion();
  if (pinned !== actual) {
    throw new Error(
      `vendor/README.md pins axe-core@${pinned} but vendor/axe.min.js is actually v${actual}. ` +
        'The pin and the file it describes have drifted apart.',
    );
  }
});

/**
 * Every other place in the repo that names a version for axe-core. Each one
 * is checked against the pin above, not against each other, so a failure
 * message always points at the one place that needs fixing: the stale file.
 */
const OTHER_FILES_NAMING_A_VERSION = [
  'NOTICE',
  'ARCHITECTURE.md',
  'README.md',
  'CHANGELOG.md',
  path.join('store', 'FIREFOX-SOURCE-SUBMISSION.md'),
];

await test('every other file naming an axe-core version agrees with the pin', () => {
  const pinned = readmeVersion();
  const mismatches = [];

  for (const rel of OTHER_FILES_NAMING_A_VERSION) {
    const full = path.join(EXT, rel);
    if (!fs.existsSync(full)) {
      mismatches.push(`${rel}: file not found`);
      continue;
    }
    const src = fs.readFileSync(full, 'utf8');
    // CHANGELOG.md is a history file: an old entry is allowed to describe an
    // old release truthfully. So there the check is scoped to lines that
    // themselves mention "axe", not the whole file, which keeps the pin
    // check from firing on unrelated version numbers that live nearby.
    const lines = rel === 'CHANGELOG.md' ? src.split('\n').filter((l) => /axe/i.test(l)) : [src];
    const re = /axe(?:-core)?[@ v]*(\d+\.\d+\.\d+)/gi;
    let found = 0;
    for (const line of lines) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        found++;
        if (m[1] !== pinned) {
          mismatches.push(`${rel}: found axe-core ${m[1]}, expected ${pinned} (line: "${line.trim()}")`);
        }
      }
    }
    if (found === 0) {
      mismatches.push(`${rel}: no axe-core version found at all, expected to see ${pinned}`);
    }
  }

  if (mismatches.length) {
    throw new Error(`axe-core version pin (${pinned}) is not honoured everywhere:\n` + mismatches.map((m) => `  - ${m}`).join('\n'));
  }
});

await test('NOTICE states the axe-core licence', () => {
  const notice = fs.readFileSync(path.join(EXT, 'NOTICE'), 'utf8');
  if (!/MPL-2\.0/.test(notice) && !/Mozilla Public License/.test(notice)) {
    throw new Error('NOTICE does not mention "MPL-2.0" or "Mozilla Public License" for axe-core.');
  }
});

function readmeBytesAndSha() {
  const bytesMatch = /^- Bytes: (\d+)\s*$/m.exec(readmeSrc);
  const shaMatch = /^- SHA-256: ([0-9a-fA-F]{64})\s*$/m.exec(readmeSrc);
  if (!bytesMatch || !shaMatch) {
    throw new Error(
      'vendor/README.md is missing "- Bytes: <n>" and/or "- SHA-256: <hex>" under the axe.min.js bullet list. ' +
        'Those two lines are what pin the vendored file to exact bytes, not just a version number.',
    );
  }
  return { bytes: Number(bytesMatch[1]), sha: shaMatch[1].toLowerCase() };
}

await test('vendor/axe.min.js is byte-for-byte what vendor/README.md pins', () => {
  const { bytes, sha } = readmeBytesAndSha();
  const buf = fs.readFileSync(axePath);
  const actualBytes = buf.length;
  const actualSha = crypto.createHash('sha256').update(buf).digest('hex');

  if (actualBytes !== bytes) {
    throw new Error(`vendor/axe.min.js is ${actualBytes} bytes but vendor/README.md pins ${bytes} bytes.`);
  }
  if (actualSha !== sha) {
    throw new Error(`vendor/axe.min.js sha256 is ${actualSha} but vendor/README.md pins ${sha}.`);
  }
});

console.log(
  failures.length
    ? `\n${failures.length} failing, ${passed} passing\n`
    : `\n${passed} passing\n`,
);
process.exit(failures.length ? 1 : 0);
