/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The release gate: what the Chrome Web Store reviewer checks, checked here
 * first, on the zip that will actually be uploaded.
 *
 *   node tools/release-check.mjs [dist/qa-wrap-<version>.zip]
 *
 * Every line is a rule from the Web Store programme policies or the manifest
 * reference, or a house rule that has cost a rejection somewhere: a private
 * key in the zip, a test folder shipped, a permission nobody justified, a
 * description one character over the limit. It reads the zip, not the source
 * tree, because the zip is what leaves the building.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, fileEntries } from './lib-zip.mjs';
import { TARGETS } from './targets.mjs';
import { isWorkingNote, isStrayTopLevel } from './lib-ship.mjs';
import { PRODUCT } from '../core/product.js';
import { BRAND } from './lib-brand.mjs';
import { MAKER } from '../core/provenance.js';
import { DIST } from './lib-paths.mjs';
import * as guard from './lib-release-guard.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const manifestSrc = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
/* T-069: `--flavour managed` checks the managed build (Chrome minus `debugger`) with the same gate. */
const argv = process.argv.slice(2);
const FLAVOUR = argv.includes('--flavour') ? argv[argv.indexOf('--flavour') + 1] : null;
const zipArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--flavour');
const zipPath = zipArg || path.join(DIST, FLAVOUR ? `qa-wrap-${manifestSrc.version}-chrome-${FLAVOUR}.zip` : `qa-wrap-${manifestSrc.version}.zip`);

const REPO_ROOT = path.resolve(EXT, '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');

let pass = 0;
const problems = [];
const ok = (name, detail = '') => { pass++; console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { problems.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

/* The zip reader moved to tools/lib-zip.mjs — the build needs the same one, and
   two readers of the same format is one reader that will disagree with itself. */

if (!fs.existsSync(zipPath)) {
  console.log(`no zip at ${zipPath} — run: npm run build && node tools/package.mjs`);
  process.exit(2);
}
/* ── store-facing documents match the package (devil point 9-12) ──────────
   Source-tree reads, not zip reads: the docs and the site are what a reviewer
   opens. Fails on the earlier typeface or a Google font host anywhere in the
   shipped docs, the store folder or the site, and on a provider the
   integrations screen offers that PRIVACY.md never names. */
console.log('\nstore-facing documents');
{
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'shots') walk(f, out); } else if (/\.(md|html|css|txt)$|^NOTICE$/.test(e.name)) out.push(f); } return out; };
  const docs = [
    ...fs.readdirSync(EXT).filter((n) => /\.md$/.test(n) || n === 'NOTICE').map((n) => path.join(EXT, n)),
    ...walk(path.join(EXT, 'store')), ...walk(SITE_DIR),
    // D-1010-44 (r3-14-1): the deliverables folder and the brand SVGs are redistributed too. Ban-assertion tests live in tools/, outside this list.
    ...walk(path.join(REPO_ROOT, 'deliverables')),
    ...fs.readdirSync(path.join(EXT, 'brand')).filter((n) => /\.svg$/.test(n)).map((n) => path.join(EXT, 'brand', n)),
  ].filter((f) => f !== fileURLToPath(import.meta.url) && !/thmanyah\.css$/.test(f));
  const banned = /cairo|fonts\.googleapis|fonts\.gstatic/i;
  // D-1010-75: the generated identity/dist board is redistributed too, and a PDF names its fonts in binary (latin1 keeps the bytes).
  const distTree = path.join(REPO_ROOT, 'identity', 'dist');
  const distDocs = fs.existsSync(distTree) ? walk(distTree).concat(fs.readdirSync(distTree).filter((n) => /\.svg$/.test(n)).map((n) => path.join(distTree, n))) : [];
  const pdfs = []; const findPdf = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) findPdf(f); else if (/\.pdf$/i.test(e.name)) pdfs.push(f); } };
  findPdf(path.join(REPO_ROOT, 'deliverables'));
  const hits = [...new Set(docs.concat(distDocs))].filter((f) => banned.test(fs.readFileSync(f, 'utf8')))
    .concat(pdfs.filter((f) => banned.test(fs.readFileSync(f, 'latin1')))).map((f) => path.relative(REPO_ROOT, f));
  check(!hits.length, 'no shipped doc, store file, site page, identity/dist file or deliverables PDF names the banned typeface or a Google font host', hits.join(', '));
  // D-1010-76: a Thmanyah face a brand/*.svg header names has to be in NOTICE, and an outline-only SVG has to be called outlines there.
  {
    const noticeLc = fs.readFileSync(path.join(EXT, 'NOTICE'), 'utf8').toLowerCase();
    const faceRe = /thmanyah\s+(sans|serif display)(?:\s+(regular|medium|bold|black|\d{3}))?/gi;
    const missingFaces = [];
    let outlines = false;
    for (const n of fs.readdirSync(path.join(EXT, 'brand')).filter((x) => /\.svg$/.test(x))) {
      const head = fs.readFileSync(path.join(EXT, 'brand', n), 'utf8').split('-->')[0];
      if (/thmanyah[^]*outlines/i.test(head)) outlines = true;
      for (const mm of head.matchAll(faceRe)) { const face = mm[0].replace(/\s+/g, ' ').toLowerCase(); if (!noticeLc.replace(/\s+/g, ' ').includes(face)) missingFaces.push(`${n}: ${mm[0]}`); }
    }
    check(!missingFaces.length && (!outlines || (/serif display black/.test(noticeLc) && /outlines/.test(noticeLc))), 'NOTICE names every Thmanyah face the brand SVGs name, and the outline-only Black face', missingFaces.join(', ') || (outlines ? '' : 'no brand SVG names Thmanyah as outlines'));
  }
  const integ = fs.readFileSync(path.join(EXT, 'options', 'integrations.js'), 'utf8');
  const ids = [...integ.matchAll(/\{ id: '(\w+)', provider:/g)].map((x) => x[1]);
  const track = (integ.match(/TRACK_IDS = \[([^\]]*)\]/) || [, ''])[1].match(/\w+/g) || [];
  const providers = [...new Set(['jira', 'email', ...ids, ...track])];
  const priv = fs.readFileSync(path.join(EXT, 'PRIVACY.md'), 'utf8');
  const missing = providers.filter((id) => !new RegExp(`\\b${id}`, 'i').test(priv));
  check(providers.length >= 18 && !missing.length, `PRIVACY.md names every one of the ${providers.length} integration providers`, missing.length ? `missing: ${missing.join(', ')}` : `found ${providers.length}`);
  const noticeFams = [...fs.readFileSync(path.join(EXT, 'ui', 'fonts.css'), 'utf8').matchAll(/-family:\s*'([^']+)'/g)].map((x) => x[1]);
  const notice = fs.readFileSync(path.join(EXT, 'NOTICE'), 'utf8').toLowerCase();
  const noFam = [...new Set(noticeFams)].filter((f) => !notice.includes(f.toLowerCase()));
  check(noticeFams.length > 0 && !noFam.length, 'NOTICE lists every font family ui/fonts.css embeds', noFam.join(', '));
  console.log(`  WARN  these store URLs must be published and answer 200 before upload (Nader's step, not checked offline): ${Object.values(PRODUCT.urls).join(', ')}`);
}

/* ── refusals about the tree and the zip's relation to it (T-005) ───────── */
console.log('\nthe tree and the zip');
{
  const refuse = (msg, name) => check(!msg, name, msg || undefined);
  const repo = REPO_ROOT;
  refuse(guard.dirtyTree(repo), 'the tree is clean (nothing uncommitted under extension/ or site/)');
  refuse(guard.versionNotNew(manifestSrc.version, guard.lastTag(repo)), 'manifest.version is greater than the last tag', guard.lastTag(repo) || 'no tag yet');
  refuse(guard.changelogUndated(fs.readFileSync(path.join(EXT, 'CHANGELOG.md'), 'utf8'), manifestSrc.version), 'CHANGELOG.md has a dated section for this version');
  refuse(guard.axeMismatch(fs.readFileSync(path.join(EXT, 'vendor', 'README.md'), 'utf8'), fs.readFileSync(path.join(EXT, 'vendor', 'axe.min.js'))), 'vendor/axe.min.js matches the SHA-256 in vendor/README.md');
  const sentences = JSON.parse(fs.readFileSync(path.join(HERE, 'retired-sentences.json'), 'utf8')).sentences;
  const shippedDocs = [];
  const gather = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'shots') gather(f); } else if (/\.(md|html|txt)$|^NOTICE$/.test(e.name)) shippedDocs.push({ name: path.relative(REPO_ROOT, f), text: fs.readFileSync(f, 'utf8') }); } };
  for (const n of fs.readdirSync(EXT)) if ((/\.md$/.test(n) && n !== 'CHANGELOG.md') || n === 'NOTICE') shippedDocs.push({ name: `extension/${n}`, text: fs.readFileSync(path.join(EXT, n), 'utf8') });
  gather(path.join(EXT, 'store')); gather(SITE_DIR);
  const retired = guard.retiredHits(shippedDocs, sentences);
  check(!retired.length, `none of the ${sentences.length} retired sentences is back in a shipped document`, retired.join(' | '));
  const stale = guard.staleStoreAssets(EXT);
  if (stale) console.log(`  WARN  ${stale}`);
}

/* ── D-1010-77: a stale zip is refused here, before any check that reads the zip.
   The tree checks above still ran and printed; a false licensing FAIL from an old
   zip would mislead, so the zip checks below do not run until it is rebuilt. ── */
{
  const stale = guard.staleZip(fs.statSync(zipPath).mtimeMs, guard.newestSource(EXT), EXT);
  if (stale) {
    bad('the zip is newer than every file it ships from', `${stale} — run npm run build && node tools/package.mjs`);
    console.log('\nzip checks not run: run npm run build && node tools/package.mjs');
    console.log(`\n${pass} checks passed, ${problems.length} problem(s)`);
    console.log('\nfix before uploading:'); for (const q of problems) console.log(`  · ${q}`);
    process.exit(1);
  }
  ok('the zip is newer than every file it ships from');
}

const zip = readZip(zipPath);
const names = [...zip.entries.keys()];
const text = (n) => zip.entries.get(n)?.data().toString('utf8') ?? '';
console.log(`— ${path.basename(zipPath)} · ${names.length} entries · ${(zip.bytes / 1024).toFixed(0)} KB —\n`);

/* ── 1. the manifest, as shipped ─────────────────────────────────────────── */
console.log('manifest');
const m = JSON.parse(text('manifest.json') || '{}');
check(m.manifest_version === 3, 'Manifest V3');
check(m.name === 'QA Wrap', 'name is the product', m.name);
check(/^\d+(\.\d+){1,3}$/.test(m.version || '') && m.version === manifestSrc.version, 'version is dotted integers and matches the source', m.version);
check((m.description || '').length > 0 && m.description.length <= 132, 'description ≤ 132 characters', `${(m.description || '').length}`);
check(!/[!]{2,}|[A-Z]{6,}/.test(m.description || ''), 'description has no shouting');
for (const size of ['16', '32', '48', '128']) check(m.icons?.[size] && zip.entries.has(m.icons[size]), `icon ${size} declared and present`, m.icons?.[size]);
check(m.minimum_chrome_version, 'minimum_chrome_version set', m.minimum_chrome_version);
if (FLAVOUR) {
  const want = (manifestSrc.permissions || []).filter((p) => p !== 'debugger');
  check(!(m.permissions || []).includes('debugger') && !(m.optional_permissions || []).includes('debugger'), 'managed flavour: no debugger permission');
  check(JSON.stringify(m.permissions) === JSON.stringify(want), 'managed flavour: permissions are the source list minus debugger and nothing else');
}
check(typeof m.key === 'string' && m.key.length > 100, 'public key present (keeps the ID stable across machines and the store)');
/*
 * `homepage_url` used to be checked for `https://` and nothing else, so
 * a made-up GitHub repository
 * passed the gate, shipped in the store package, and was copied into all eight
 * browser targets. A 404 is what the Chrome Web Store shows a user as "the
 * developer's website".
 *
 * https is necessary and is not sufficient. The address must also be one this
 * product actually claims: `PRODUCT.urls` in `core/product.js` is the single
 * place they are written down, and `manifest.json` — which cannot import a
 * module — has to repeat one of them verbatim. That equality is the only thing
 * keeping a JSON literal in step with the code.
 *
 * What this still cannot check is that the page exists. Nothing offline can.
 * See the TODO in core/product.js.
 */
const productUrls = Object.values(PRODUCT.urls).filter(Boolean); // an empty URL means "none" (brand/brand.json); every URL that is set must be https
if (PRODUCT.urls.homepage) {
  check(m.homepage_url && /^https:\/\//.test(m.homepage_url), 'homepage_url is https', m.homepage_url);
  check(m.homepage_url === PRODUCT.urls.homepage,
    'homepage_url is the homepage PRODUCT.urls names',
    m.homepage_url === PRODUCT.urls.homepage ? m.homepage_url : `manifest ${m.homepage_url} ≠ product ${PRODUCT.urls.homepage}`);
  check(productUrls.includes(m.homepage_url), "homepage_url is one of the product's declared destinations", m.homepage_url);
} else {
  check(!m.homepage_url, 'no website is set in brand/brand.json, so the manifest declares no homepage_url', m.homepage_url || 'none');
}
check(productUrls.every((u) => /^https:\/\//.test(u)), 'every PRODUCT.urls entry that is set is https', productUrls.join(' · ') || 'none set');

/**
 * The public site folder, checked by path rather than by network.
 *
 * Decision 11 (`research/56-decisions-2026-09-07.md`) put the privacy, terms
 * and support pages in a static `site/` folder at the repository root, one
 * level above this one, published by the owner to the paths `PRODUCT.urls`
 * already names. Nothing this script runs offline can confirm the address
 * actually resolves once published — that would be a real HTTP request
 * against a live host, which is a different kind of check and does not
 * belong in a gate that runs with no network — so this stays a filesystem
 * check: the three pages the store needs exist in the tree that will be
 * copied to the host, and each `PRODUCT.urls` entry's path maps to one of
 * them by name.
 */
console.log('\npublic site folder');
for (const page of ['index.html', 'privacy.html', 'terms.html', 'support.html']) {
  check(fs.existsSync(path.join(SITE_DIR, page)), `site/${page} exists at the repository root`);
}
// The shape PRODUCT.urls writes when a website is set: https://<host>/<product>[/<segment>],
// no trailing slash, no extension. A clean path like that is expected to be
// served as `<segment>.html` — see the rewrite note in site/README.md.
const SITE_PAGE_FOR_SEGMENT = { '': 'index.html', support: 'support.html', privacy: 'privacy.html', try: 'try/index.html', trust: 'trust.html', 'support.html': 'support.html', 'privacy.html': 'privacy.html', 'try/': 'try/index.html', 'trust.html': 'trust.html', 'terms.html': 'terms.html' };
for (const [key, url] of Object.entries(PRODUCT.urls)) {
  if (!url) continue; // no website: nothing to map
  const segment = new URL(url).pathname.replace(/^\/[^/]*\/?/, '');
  const page = SITE_PAGE_FOR_SEGMENT[segment];
  check(!!page, `PRODUCT.urls.${key} (${url}) maps to a page this folder knows how to serve`,
    page || `no site page mapped for path segment "${segment}"`);
  if (page) {
    check(fs.existsSync(path.join(SITE_DIR, page)), `PRODUCT.urls.${key} resolves to site/${page}, which exists`);
  }
}

// MV3 warns on a string author and wants an object with an email; we publish neither.
check(m.author === undefined || typeof m.author === 'object', 'author is absent or an object (a string warns on the card)', typeof m.author);
const csp = m.content_security_policy?.extension_pages || '';
check(/script-src 'self'/.test(csp) && !/unsafe-eval|unsafe-inline|http:|https:/.test(csp.replace(/'self'/g, '')), 'CSP: script-src self only, no unsafe-*, no remote hosts', csp);
check(!m.background?.scripts && m.background?.service_worker, 'background is a service worker');
check(!m.default_popup || zip.entries.has(m.action?.default_popup), 'action popup present if declared');
for (const cs of m.content_scripts || []) for (const js of cs.js || []) check(zip.entries.has(js), `content script present: ${js}`);

/**
 * The six the worker injects instead of declaring.
 *
 * The loop above enumerates the manifest, so taking these out of
 * `content_scripts` silently took six checks out of this suite with it — the
 * count dropped from 119 to 113 and nothing said why. A file that ships but is
 * not declared is exactly the shape a packager gets wrong: the manifest names
 * nothing, so no existing check notices its absence, and the feature fails in
 * the wild at first use with a message about a tab that will not answer.
 *
 * Two assertions each, and the second is the one that matters: it fails if
 * somebody puts the file back into `content_scripts`, which would undo D11 and
 * put 63 KB back into every frame of every page. The same rule is enforced
 * against the working tree by `tools/manifest-check.mjs`; here it is enforced
 * against what actually goes in the box.
 */
const ON_DEMAND = [
  'content/picker.js',
  'content/rtl-stress.js',
  'content/data-injector.js',
  'content/harvester.js',
  'content/links.js',
  'content/autofill.js',
  // The in-page bar and its icons (UI rework round 2, S8): top frame only,
  // injected by `UQA_BAR` when the bar first has to show.
  'content/bar.js',
  'ui/icons.js',
];
const declaredJs = new Set((m.content_scripts || []).flatMap((cs) => cs.js || []));
for (const js of ON_DEMAND) {
  check(zip.entries.has(js), `on-demand content script present: ${js}`);
  check(
    !declaredJs.has(js),
    `on-demand content script is not declared: ${js}`,
    declaredJs.has(js) ? 'it is back in content_scripts — see ON_DEMAND in background/service-worker.js' : 'injected by the worker at first use'
  );
}

/**
 * The eight that used to BE `content_scripts`, and the same trap one level up.
 *
 * The loop above enumerates the manifest, so emptying `content_scripts`
 * entirely — which decision 8 did on 8 September 2026, to take `<all_urls>` off
 * the install dialog — took eight more checks out of this suite with it, in
 * exactly the way the note above warns about. The count fell from 145 to 137
 * and nothing said why.
 *
 * So they are enumerated from where they now live: `background/site-access.js`
 * registers them at runtime against the origins the tester has granted. Three
 * assertions each kind, and the third is the one that matters — a manifest that
 * declares any of them again is a manifest whose install dialog reads "read and
 * change all your data on all websites".
 */
const SITE_SCRIPTS = [
  'content/selector-engine.js', 'content/replay-buffer.js', 'content/bridge.js', 'content/recorder.js', 'content/ui-host.js',
  'content/mask.js', 'content/replay-recorder.js', 'content/vitals.js', 'content/checks.js', 'content/keymap.js',
];
const siteAccess = zip.entries.has('background/site-access.js')
  ? fs.readFileSync(path.join(EXT, 'background/site-access.js'), 'utf8')
  : '';
for (const js of SITE_SCRIPTS) {
  check(zip.entries.has(js), `registered page script present: ${js}`);
  check(
    siteAccess.includes(`'${js}'`),
    `registered page script is named in site-access.js: ${js}`,
    siteAccess ? undefined : 'background/site-access.js is not in the package'
  );
  check(
    !declaredJs.has(js),
    `registered page script is not declared in the manifest: ${js}`,
    declaredJs.has(js) ? 'declaring it puts the all-sites warning back on the install dialog' : 'registered from the granted origins'
  );
}
check(zip.entries.has('content/overlay.css'), 'the overlay stylesheet the page scripts insert is present');

check(zip.entries.has(m.background?.service_worker || ''), 'service worker file present');

/* ── 2. permissions, each one justified in the listing ──────────────────── */
console.log('\npermissions');
const listing = fs.existsSync(path.join(EXT, 'store/LISTING.md')) ? fs.readFileSync(path.join(EXT, 'store/LISTING.md'), 'utf8') : '';
/*
 * `system.display` (S4, the float window's placement) shows no warning on
 * Chrome's install or update dialog — there is nothing on the listing to
 * justify. Every other permission here does put a line on that dialog, and
 * keeps its bullet in store/LISTING.md.
 */
const SILENT_PERMISSIONS = ['system.display'];
const perms = [...(m.permissions || []), ...(m.optional_permissions || [])];
for (const p of perms) {
  if (SILENT_PERMISSIONS.includes(p)) continue;
  check(new RegExp(`\\*\\*[^*]*\\b${p}\\b[^*]*\\*\\*`).test(listing), `"${p}" has a justification in store/LISTING.md`);
}
for (const h of m.host_permissions || []) check(listing.includes(h), `host permission ${h} justified`);
/*
 * Since decision 8 there is no required host permission, and that is the check.
 *
 * A `host_permissions` block reappearing is not a regression this suite could
 * otherwise see: the loop above would simply have one more thing to justify,
 * pass, and say nothing about the install dialog it had just changed.
 */
check(
  (m.host_permissions || []).join() === '<all_urls>',
  'ui-1019: <all_urls> is the one required host permission (Start is the consent; nothing records before it)',
  `host_permissions is ${(m.host_permissions || []).join(', ') || 'empty'}`
);
for (const h of m.optional_host_permissions || []) {
  check(listing.includes(h), `optional host permission ${h} justified in store/LISTING.md`);
}
const risky = perms.filter((p) => ['debugger', 'tabCapture', 'desktopCapture', 'cookies', 'webNavigation'].includes(p));
check(true, `sensitive permissions to explain in the review notes: ${risky.join(', ') || 'none'}`);
check(!m.permissions?.includes('webRequestBlocking'), 'no webRequestBlocking (MV3)');

/* ── 3. nothing that must not ship ──────────────────────────────────────── */
console.log('\ncontents');
const forbidden = [
  [/^keys\//, 'the private key folder'],
  [/\.pem$/, 'a PEM key'],
  [/^tools\//, 'the test and build tools'],
  [/^node_modules\//, 'node_modules'],
  [/^store\//, 'the store listing working files'],
  [/^dist\//, 'a nested build'],
  [/\.map$/, 'a source map'],
  [/^\.|\/\./, 'a dot-file or dot-folder'],
  [/-profile\//, 'a browser profile'],
  [/^research\//, 'research notes'],
  [/\.(zip|log|tmp)$/, 'a zip, log or temp file'],
];
for (const [re, what] of forbidden) {
  const hit = names.find((n) => re.test(n));
  check(!hit, `does not ship ${what}`, hit || '');
}
/*
 * A working note at any depth, not only at the top level. `popup/REFACTOR.md` —
 * a refactor's scratch notes — went out in all eight packages, because the ship
 * filter only ever read the extension folder's own entries and a directory was
 * handed to the packer whole.
 */
const notes = names.filter((n) => isWorkingNote(n) && n !== 'BROWSER.md');
check(!notes.length, 'does not ship a Markdown working note at any depth', notes.join(', '));
/* r10-00-1 (D-222): a scratch `_x.mjs` or any top-level .mjs once shipped in the Chrome package; same rule as shipping(). */
const strays = names.filter((n) => isStrayTopLevel(n));
check(!strays.length, 'no top-level _-prefixed entry (except _locales) and no top-level .mjs in the package', strays.join(', '));
check(!names.some((n) => n === 'ROADMAP.md' || n.endsWith('/ROADMAP.md')), 'ROADMAP.md is not in the package (D-1010-138)');
check(names.some((n) => /^PRIVACY\.md$/.test(n)), 'PRIVACY.md ships (and its text must be hosted at the privacy URL in the listing)');
check(names.some((n) => /^CHANGELOG\.md$/.test(n)), 'CHANGELOG.md ships');
/* D-1010-77: a literal NUL byte in a shipped text file broke previewOf silently (a regex made of a NUL), and nothing else looks for one. */
const nulFiles = names.filter((n) => /\.(js|mjs|css|html|json|md|svg|txt)$|^(NOTICE|LICENSE)$/.test(n) && zip.entries.get(n).data().includes(0));
check(!nulFiles.length, 'no shipped text file contains a NUL byte', nulFiles.join(', '));
/* D-1010-120: the source scan above reads the tree; this reads what actually ships (a stale package once carried Cairo and passed). thmanyah.css is exempt, as in the source scan. */
const bannedInZip = names.filter((n) => /\.(css|js|mjs|html|json|svg|md|txt)$/.test(n) && !/thmanyah\.css$/.test(n) && /cairo|fonts\.googleapis|fonts\.gstatic/i.test(zip.entries.get(n).data().toString('utf8')));
check(!bannedInZip.length, 'no text entry in the zip names the banned typeface or a Google font host', bannedInZip.join(', '));

/*
 * One licence file, naming one rights holder.
 *
 * `LICENSE` and `LICENSE.md` both shipped, and they named different holders:
 * one named the maker, the other said "QA Wrap". Which of the two governs
 * is then a question a court answers, not a question the package answers, and
 * neither can be relied on. The rule is therefore exactly one file, and its
 * holder line has to be the same string as `MAKER.owner` — the value stamped
 * into every screenshot's metadata, every export's provenance token and every
 * generated document's footer.
 */
const licences = names.filter((n) => /^LICENSE(\.[A-Za-z]+)?$/.test(n));
check(licences.length === 1, 'exactly one licence file ships', licences.join(', ') || 'none');
if (licences.length === 1) {
  const licence = text(licences[0]);
  const holder = /Copyright\s+(?:\(c\)|©)\s*[\d–—-]*\s*([^(\n]+?)\s*(?:\([^)\n]*\))?\s*$/im.exec(licence);
  check(!!holder && holder[1].trim() === MAKER.owner,
    `${licences[0]} names the rights holder MAKER.owner names`,
    !holder ? 'no "Copyright (c) … " line found'
      : holder[1].trim() === MAKER.owner ? MAKER.owner
      : `the licence says ${holder[1].trim()}, provenance stamps ${MAKER.owner}`);
  /**
   * The retired lockup, anywhere in the licence.
   *
   * This read `!/^NJ-Burrito —/m` against the first line only. Every em dash in
   * the product was swept to a colon shortly afterwards, so the pattern stopped
   * being able to match anything at all: the check has gone green ever since
   * without once looking at a string that could fail it. A guard whose pattern
   * cannot match is worse than no guard, because the report says "ok".
   *
   * So: the whole file, and the name on its own. NJ-Burrito is still the
   * product line and still correct on the About card; what it must never be is
   * the rights holder on a legal document.
   */
  check(!/NJ-Burrito/i.test(licence), 'the licence does not name the retired lockup',
    /NJ-Burrito/i.test(licence) ? `${licences[0]} names NJ-Burrito; the holder is ${MAKER.owner}` : MAKER.owner);
}

/**
 * The mark that goes out on every exported document cover.
 *
 * `brand/lockup.svg` is read as text and pasted into the cover of every report,
 * manual and specification QA Wrap writes, so whatever it says leaves the
 * machine on a file a client opens. `tools/generate-icons.mjs` copies it
 * straight from the identity, which means a retired name left in
 * `identity/logo/qa-wrap-lockup.svg` walks into the package with nothing in its
 * way. This is that nothing, filled in.
 */
if (names.includes('brand/lockup.svg')) {
  const lockup = text('brand/lockup.svg');
  check(!/NJ-Burrito/i.test(lockup), 'the cover lockup does not name the retired lockup',
    /aria-label="([^"]*)"/.exec(lockup)?.[1] || 'no aria-label');
}
check(zip.bytes < 100 * 1024 * 1024, 'zip under the 100 MB limit', `${(zip.bytes / 1024 / 1024).toFixed(1)} MB`);
const sizes = names.map((n) => [n, zip.entries.get(n).usize]).sort((a, b) => b[1] - a[1]).slice(0, 3);
ok('largest files', sizes.map(([n, s]) => `${n} ${(s / 1024).toFixed(0)} KB`).join(' · '));

/* ── 4. no remote code, no eval, no analytics ───────────────────────────── */
console.log('\ncode');
const js = names.filter((n) => /\.(js|mjs)$/.test(n) && !/^vendor\//.test(n));
const vendor = names.filter((n) => /^vendor\//.test(n) && /\.js$/.test(n));
let evals = [];
let remote = [];
let beacons = [];
for (const n of js) {
  const src = text(n);
  if (/\beval\s*\(|new Function\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))) evals.push(n);
  if (/<script[^>]+src=["']https?:/i.test(src) || /importScripts\(\s*["']https?:/.test(src)) remote.push(n);
  if (/google-analytics|googletagmanager|sentry\.io|mixpanel|segment\.io|hotjar/i.test(src)) beacons.push(n);
}
check(!evals.length, 'no eval / new Function in shipped code', evals.join(', '));
check(!remote.length, 'no remotely hosted code loaded', remote.join(', '));
check(!beacons.length, 'no analytics or telemetry endpoints', beacons.join(', '));
ok('bundled third-party code', vendor.join(', ') || 'none');
const html = names.filter((n) => /\.html$/.test(n));
const inline = html.filter((n) => /<script(?![^>]*src=)[^>]*>\s*[^<\s]/i.test(text(n)) || /\son[a-z]+\s*=\s*["']/i.test(text(n)));
check(!inline.length, 'no inline scripts or on* handlers in extension pages (CSP would block them anyway)', inline.join(', '));
const remoteCss = html.filter((n) => /<link[^>]+href=["']https?:/i.test(text(n)));
check(!remoteCss.length, 'no remote stylesheets in extension pages', remoteCss.join(', '));

/* ── 4b. what is redistributed, and under what ──────────────────────────── */
/**
 * Everything in the package that somebody else wrote has to be named in NOTICE,
 * and any font has to ship with its licence text.
 *
 * Eight Cairo TTFs were once redistributed with no OFL text at all — a
 * condition of the licence they were under — while `NOTICE` inventoried three
 * fonts (Lilita One, Nunito Sans, DM Mono) that appeared nowhere in the
 * source. Wrong in both directions at once.
 *
 * 2026-09-21 (research/138, Stage 1 + 2): the UI face moved to Thmanyah, whose
 * licence forbids the font ever leaving the machine as a *file* — so Stage 1
 * bakes it into `ui/fonts.css` as base64, and nothing under `ui/fonts/` should
 * exist as a loose font file any more.
 *
 * 2026-09-27 (research/56:167-168,194, the round-2 decision that supersedes
 * decision 135): exported documents embed Thmanyah too, rather than falling
 * back to a system stack — `core/docshell.js`'s HTML shell and `core/flow.js`'s
 * SVG both carry the same base64 cuts `ui/fonts.css` already has, as a `data:`
 * URI, which is the font travelling inside a document rather than shipping as
 * a file. Only `core/xlsx.js` cannot follow: an `.xlsx` style part has no slot
 * for embedded bytes, so it names Thmanyah Sans instead of carrying it. Either
 * way, Cairo may never appear in anything the package generates.
 */
console.log('\nlicensing');
const notice = text('NOTICE');
check(notice.length > 0, 'NOTICE ships');
// r2-14-3: NOTICE inventories what ships. A font it names that no shipped source mentions is the same wrong-in-one-direction error as before.
{
  const FONT_NAMES = ['DM Mono', 'Lilita One', 'Nunito Sans', 'Cairo', 'Inter', 'Roboto', 'Open Sans', 'Noto Sans', 'IBM Plex'];
  const shippedSource = names.filter((n) => /\.(js|mjs|css|html|json|svg)$/i.test(n) && n !== 'NOTICE').map((n) => text(n)).join('\n');
  const absent = FONT_NAMES.filter((f) => notice.includes(f) && !shippedSource.includes(f));
  check(!absent.length, 'NOTICE names no font that is absent from the shipped source', absent.join(', '));
}

const looseFonts = names.filter((n) => /^ui\/fonts\/.+\.(ttf|otf|woff2?)$/i.test(n));
check(!looseFonts.length,
  'no loose font file ships under ui/fonts/ (Thmanyah’s licence forbids the file leaving the machine; fonts.css carries it as base64)',
  looseFonts.join(', '));

/*
 * A vendored file with no NOTICE entry is an undeclared dependency, and for
 * axe-core specifically it is an MPL-2.0 breach: §3.2 wants the recipient told
 * where the source is. Matched on the path, so renaming the file makes the gate
 * notice rather than the reviewer.
 */
const vendored = names.filter((n) => /^vendor\/.+/.test(n) && !/\/$/.test(n));
for (const file of vendored) {
  check(notice.includes(file), `NOTICE names the vendored file ${file}`);
}
if (vendored.length) {
  check(/mozilla\.org\/MPL|Mozilla Public License/i.test(notice), 'NOTICE states axe-core\'s licence');
  check(/github\.com\/dequelabs\/axe-core/.test(notice),
    'NOTICE says where axe-core\'s source can be obtained (MPL-2.0 §3.2)');
}

/* ── 4c. the films are hosted, not packaged (T-048) ─────────────────────── */
/**
 * No film and no poster is in the package, and every lesson that is not
 * `pending` is marked `online: true` and has its film and poster in the site
 * folder (`site/tutorials/`), which is where the one tracked copy lives.
 *
 * The package carried 42 MB of films out of 42.6 MB, and every update
 * re-shipped them to every install. The films now load from the product's own
 * site on a user click; offline, the tutorials page draws a designed empty
 * state and the written tutorials stand in. This gate asserts the new shape:
 * the opposite of what it asserted when all twenty-two were packaged.
 */
const media = names.filter((n) => /^tutorials\/.*\.(mp4|webm|webp|png|jpe?g|srt)$/i.test(n) || /^tutorials\/media\//.test(n));
check(!media.length, 'no film, poster or caption file is in the package',
  media.length ? `packaged: ${media.slice(0, 5).join(', ')}` : '0 media files under tutorials/');
{
  let lessons = null;
  try { lessons = JSON.parse(text('tutorials/lessons.json') || 'null'); } catch { /* reported below */ }
  check(Array.isArray(lessons), 'tutorials/lessons.json parses as a list of lessons');
  const live = (lessons || []).filter((l) => !l.pending);
  const notOnline = live.filter((l) => !l.online);
  check(!notOnline.length, 'every recorded lesson is marked online: true (hosted, not packaged)',
    notOnline.length ? `not online: ${notOnline.map((l) => l.id).join(', ')}` : `${live.length} lessons, all online`);
  const hosted = path.join(SITE_DIR, 'tutorials');
  const absent = live.flatMap((l) => [...Object.values(l.files || {}), l.poster])
    .filter((f) => f && !fs.existsSync(path.join(hosted, f)));
  check(!absent.length, 'every hosted film and poster is in site/tutorials/',
    absent.length ? `missing: ${absent.join(', ')}` : `${live.length} films, posters present`);
  const pendingN = (lessons || []).filter((l) => l.pending).length;
  if (pendingN) {
    const page = text('tutorials/tutorials.js') || '';
    check(page.includes('lessons.filter((l) => !l.pending)'),
      'the packaged tutorials page hides the films that have not been recorded');
  }
  const tutorialsBytes = [...zip.entries.entries()].filter(([n]) => n.startsWith('tutorials/')).reduce((n, [, e]) => n + (e.usize || 0), 0);
  ok('the tutorials folder in the package', `${(tutorialsBytes / 1024).toFixed(0)} KB`);
}

/* ── 4d. the version, in every document that states one ─────────────────── */
/**
 * Three shipped documents said 3.0.0 inside a 3.1.0 package, which is the kind
 * of drift nobody sees until a user quotes the wrong build in a support thread.
 *
 * Only a version the document *claims as the product's* is checked — "v3.1.0",
 * "version 3.1.0", "Version 3.1.0". A bare `4.2.1` is an ISTQB clause,
 * `127.0.0.1` is loopback, `axe-core 4.13.0` is somebody else's version, and a
 * rule that failed on those would be turned off within a week. CHANGELOG.md is
 * exempt: listing past versions is the entire job of a changelog.
 */
console.log('\ndocument versions');
const docs = names.filter((n) => /^[A-Z0-9_-]+\.md$/.test(n) && n !== 'CHANGELOG.md');
for (const doc of docs) {
  const claimed = [...text(doc).matchAll(/\b(?:v|version)\s*\**\s*(\d+\.\d+\.\d+)/gi)].map((x) => x[1]);
  const wrong = [...new Set(claimed.filter((v) => v !== manifestSrc.version))];
  check(!wrong.length, `${doc} states the packaged version`,
    wrong.length ? `says ${wrong.join(', ')}, the package is ${manifestSrc.version}` : (claimed.length ? `${manifestSrc.version}` : 'states no version'));
}

/* ── 4b. the build tree is the lockfile (S-08, sdlc-1014): nothing resolvable that the lock does not name ───────────────── */
console.log('\nbuild tree');
{
  const lockFile = path.join(EXT, 'package-lock.json');
  const nm = path.join(EXT, 'node_modules');
  if (fs.existsSync(lockFile) && fs.existsSync(nm)) {
    const inLock = new Set(Object.keys(JSON.parse(fs.readFileSync(lockFile, 'utf8')).packages || {}).filter((k) => k.startsWith('node_modules/') && k.split('node_modules/').length === 2).map((k) => k.slice('node_modules/'.length)));
    const have = [];
    for (const d of fs.readdirSync(nm)) {
      if (d.startsWith('.')) continue;
      if (d.startsWith('@')) for (const e of fs.readdirSync(path.join(nm, d))) have.push(`${d}/${e}`);
      else have.push(d);
    }
    const extra = have.filter((n) => !inLock.has(n));
    check(extra.length === 0, 'node_modules holds only packages package-lock.json names (run npm ci or npm prune)', extra.length ? `${extra.length} extra: ${extra.slice(0, 8).join(', ')}` : `${have.length} packages`);
  }
}

/* ── 5. the listing assets, at the store's sizes ────────────────────────── */
console.log('\nlisting assets');
const png = (file) => { const p = path.join(EXT, file); if (!fs.existsSync(p)) return null; const b = fs.readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
for (const [file, w, h, what] of [
  [`store/promo-440x280-${manifestSrc.version}.png`, 440, 280, 'small promo tile'],
  [`store/promo-1400x560-${manifestSrc.version}.png`, 1400, 560, 'marquee promo tile'],
  [BRAND.icons.action[String(BRAND.icons.notification)], BRAND.icons.notification, BRAND.icons.notification, 'store icon'],
]) { const d = png(file); check(d && d.w === w && d.h === h, `${what} is ${w}×${h}`, d ? `${d.w}×${d.h}` : 'missing'); }
const shots = fs.existsSync(path.join(EXT, 'store/shots')) ? fs.readdirSync(path.join(EXT, 'store/shots')).filter((f) => f.endsWith('.png')) : [];
const shotSizes = shots.map((f) => png(`store/shots/${f}`));
check(shots.length >= 1 && shots.length <= 5 && shotSizes.every((d) => d && d.w === 1280 && d.h === 800), `1–5 screenshots at 1280×800`, `${shots.length} found`);
const newestUi = (d) => fs.readdirSync(path.join(EXT, d), { withFileTypes: true }).reduce((m, e) => (e.isFile() ? Math.max(m, fs.statSync(path.join(EXT, d, e.name)).mtimeMs) : m), 0);
const uiStamp = Math.max(newestUi('ui'), newestUi('popup'));
const listingImgs = [...shots.map((f) => `store/shots/${f}`), `store/promo-440x280-${manifestSrc.version}.png`, `store/promo-1400x560-${manifestSrc.version}.png`];
check(listingImgs.every((f) => f.includes(`-${manifestSrc.version}.png`)), `listing image names carry ${manifestSrc.version} (T-031)`);
check(listingImgs.every((f) => fs.existsSync(path.join(EXT, f)) && fs.statSync(path.join(EXT, f)).mtimeMs >= uiStamp), 'listing images are newer than the newest ui/ and popup/ file (T-031)');
check(/\*\*Summary\*\*[\s\S]*?`([^`]{1,132})`/.test(listing), 'listing summary ≤ 132 characters');
check(/## Single purpose/.test(listing), 'listing states a single purpose');
check(/## Permission justifications/.test(listing), 'listing carries the permission justifications');

/* ── 6. the browser matrix, opened rather than believed ─────────────────── */
/**
 * Every per-browser zip, checked against the store zip it was built beside.
 *
 * This gate used to read exactly one file. That is how a Firefox package could
 * be absent from `dist/` for a release, and how `brave.zip` could ship at 151
 * of 152 entries with `vendor/axe.min.js` missing: `Compress-Archive` had said
 * nothing was wrong, and nobody opened the result.
 *
 * The documented difference is one file — `BROWSER.md`, which the browser build
 * writes and the store package has no use for. Nothing else may differ: every
 * target ships the same tree, including Firefox and Safari, which drop
 * permissions from the manifest and not a single file from the package. So the
 * assertion is on the whole name set, not just the count — a swap of one file
 * for another keeps a count honest and the package broken.
 */
console.log('\nbrowser matrix');
const distDir = DIST;
const storeFiles = new Set(fileEntries(zipPath).filter((n) => !(FLAVOUR && n === 'BROWSER.md')));
const EXTRA_PER_TARGET = ['BROWSER.md'];

// T-047: `npm run release` builds Chrome and Edge. The other targets are on demand
// (`npm run build:all`); they are checked when present and never required.
const RELEASE_TARGETS = ['chrome', 'edge'];
for (const [id, spec] of Object.entries(TARGETS)) {
  if (id === 'safari') {
    // Not a package until Xcode has been. The folder is the artefact.
    if (!fs.existsSync(path.join(distDir, 'safari', 'manifest.json'))) continue;
    check(fs.existsSync(path.join(distDir, 'safari', 'manifest.json')),
      'Safari folder prepared (no zip: it needs xcrun safari-web-extension-converter)');
    continue;
  }
  // Next-review R-2: a leftover zip of an on-demand target must not turn the release red; `--all` checks them.
  if (!RELEASE_TARGETS.includes(id) && !process.argv.includes('--all')) continue;
  const file = path.join(distDir, `qa-wrap-${manifestSrc.version}-${id}.zip`);
  if (!fs.existsSync(file)) {
    if (!RELEASE_TARGETS.includes(id)) continue;
    bad(`${spec.label} package present`, `no ${path.basename(file)} — run: npm run build`);
    continue;
  }
  const files = fileEntries(file);
  const expected = new Set([...storeFiles, ...EXTRA_PER_TARGET]);
  const missing = [...expected].filter((n) => !files.includes(n));
  const extra = files.filter((n) => !expected.has(n));
  check(
    !missing.length && !extra.length,
    `${spec.label} zip holds the store package plus ${EXTRA_PER_TARGET.join(', ')}`,
    missing.length || extra.length
      ? `${files.length} of ${expected.size}${missing.length ? ` · missing ${missing.slice(0, 4).join(', ')}` : ''}${extra.length ? ` · unexpected ${extra.slice(0, 4).join(', ')}` : ''}`
      : `${files.length} files`
  );
}

/* The two manifest transforms that have to have happened, read from the zip
   rather than from the transform's own report of itself. */
const geckoZip = path.join(distDir, `qa-wrap-${manifestSrc.version}-firefox.zip`);
if (fs.existsSync(geckoZip)) {
  const gecko = JSON.parse(readZip(geckoZip).entries.get('manifest.json').data().toString('utf8'));
  check(!(gecko.permissions || []).includes('sidePanel'), 'Firefox manifest drops the sidePanel permission');
  check(!gecko.side_panel, 'Firefox manifest drops the side_panel key');
  check(!gecko.key, 'Firefox manifest drops the Chromium signing key');
  check(!(gecko.permissions || []).some((p) => TARGETS.firefox.drop.includes(p)),
    `Firefox manifest drops ${TARGETS.firefox.drop.join(', ')}`);
  check(!!gecko.background?.scripts && !gecko.background?.service_worker, 'Firefox background is an event page');
  check(!!gecko.browser_specific_settings?.gecko?.id, 'Firefox manifest carries a gecko id');

  /*
   * Required for every new AMO submission since 3 Nov 2025 (see the comment
   * beside `TARGETS.firefox.gecko` in tools/targets.mjs for the sources).
   * Checked twice, on purpose:
   *
   *   - the key exists and is shaped the way Firefox's validator wants it
   *     (`required`/`optional` arrays, `none` only alone in `required`);
   *   - every category it names is one the privacy page actually discloses,
   *     so a future edit that adds a category here without updating
   *     PRIVACY.md/store/LISTING.md — or the reverse — fails the build
   *     instead of shipping a manifest that over- or under-claims.
   *
   * The privacy text is free prose, not Firefox's vocabulary, so each
   * category is matched against the phrase that would have to appear for a
   * reviewer (or a person) to consider it disclosed.
   */
  const dcp = gecko.browser_specific_settings?.gecko?.data_collection_permissions;
  check(!!dcp, 'Firefox manifest carries data_collection_permissions');
  if (dcp) {
    const required = dcp.required || [];
    const optional = dcp.optional || [];
    check(Array.isArray(required) && required.length > 0, 'data_collection_permissions.required is a non-empty array');
    check(
      !(required.includes('none') && required.length > 1),
      "data_collection_permissions.required: 'none' is never combined with another category"
    );

    const PRIVACY_TEXT = [
      fs.readFileSync(path.join(EXT, 'PRIVACY.md'), 'utf8'),
      fs.readFileSync(path.join(EXT, 'store', 'LISTING.md'), 'utf8'),
    ].join('\n');
    // Only categories this product could ever plausibly declare are mapped —
    // an unmapped category fails closed rather than silently passing.
    const DISCLOSURE_PHRASE = {
      websiteContent: /website content/i,
      websiteActivity: /(website activity|user activity)/i,
      authenticationInfo: /authentication (information|info)\b/i,
      personallyIdentifyingInfo: /personally identifying/i,
      browsingActivity: /browsing activity/i,
      technicalAndInteraction: /(telemetry|analytics|usage data)/i,
    };
    const named = [...new Set([...required, ...optional])].filter((c) => c !== 'none');
    for (const category of named) {
      const phrase = DISCLOSURE_PHRASE[category];
      check(
        !!phrase && phrase.test(PRIVACY_TEXT),
        `data_collection_permissions names "${category}" that PRIVACY.md/store/LISTING.md discloses`,
        phrase ? undefined : 'no mapping for this category — add one before shipping it'
      );
    }
  }
}

/* ── the locator truth set (T-043): a release cannot skip it for want of a browser ── */
console.log('\nlocator truth');
{
  let out = '';
  try { out = execFileSync(process.execPath, ['tools/test-locator-truth.mjs'], { cwd: EXT, encoding: 'utf8' }); } catch (e) { out = `${e.stdout || ''}${e.message}`; }
  check(!/SKIPPED/.test(out) && /agreement (\d+)\/\1\b/.test(out), 'tools/test-locator-truth.mjs ran in a real Chromium and agreed on every locator', out.trim().split('\n').slice(-2).join(' | '));
}

/* ── verdict ─────────────────────────────────────────────────────────────── */
console.log(`\n${pass} checks passed, ${problems.length} problem(s)`);
if (problems.length) { console.log('\nfix before uploading:'); for (const p of problems) console.log(`  · ${p}`); process.exit(1); }
console.log('ready for the developer console — see RELEASE.md');
