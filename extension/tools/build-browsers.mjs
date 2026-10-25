/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One source, eight targets.
 *
 *   node tools/build-browsers.mjs [--store] [chrome|edge|brave|opera|operagx|duckduckgo|firefox|safari|all]
 *
 * `--store` drops the manifest `key` field from every target. Edge Partner
 * Center ("The manifest shouldn't contain the key field") and the Opera
 * add-ons store refuse a package that carries it; the store assigns its own
 * id. Without the flag the key stays, so unpacked installs and the one-press
 * update path keep the stable id. `--store` also leaves out updater/ and types/ (Opera refuses
 * updater/host.cmd) and stamps BUILD_STORE in core/rate-links.js, which turns off the GitHub
 * update check and hides the Updates controls. Build store packages with `--store` only; the
 * GitHub-release zips are built without it and are unchanged.
 *
 * Seven of them come out as a zip; Safari comes out as a prepared folder, for
 * the reason under "Safari is prepared, not built" below. The list is
 * `TARGETS` in `tools/targets.mjs` and nowhere else — this header said "four
 * packages" for three releases after the sixth was added.
 *
 * ── what actually differs, and what does not ──────────────────────────────
 *
 * Almost nothing differs. The content scripts, the UI, the exporters and the
 * ISTQB model are byte-identical in all eight. What changes is the manifest, and
 * it changes for two reasons:
 *
 *   **A permission Firefox does not implement makes the install fail.** Not a
 *   disabled feature — a rejected package. So `offscreen`, `tabCapture`,
 *   `desktopCapture` and `debugger` are removed from the Gecko manifest, and
 *   `core/capabilities.js` makes the features that needed them explain
 *   themselves at runtime rather than throw.
 *
 *   **Gecko wants an event page, not a service worker.** Firefox's MV3 runs
 *   `background.scripts`, so the same worker file is declared differently. It is
 *   the same file: nothing in it assumes a ServiceWorkerGlobalScope, which is
 *   worth keeping true.
 *
 * ── Safari is prepared, not built ─────────────────────────────────────────
 *
 * Safari needs `xcrun safari-web-extension-converter`, which is Xcode, which is
 * macOS. This script cannot run it, so it writes the folder and prints the
 * command rather than producing a `.zip` and calling it a Safari build. A
 * package that was never built by the tool that has to build it is a claim, not
 * an artefact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { TARGETS } from './targets.mjs';
import { packVerified } from './lib-zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { shipping, copyShipping } from './lib-ship.mjs';
import { DIST } from './lib-paths.mjs';
import { sync as syncPrivacyNames } from './gen-privacy-names.mjs';


const EXT = path.resolve(HERE, '..');
/* Out of the extension folder: `dist` was 565 MB of it, and Chrome shows the
   folder's size on the card. See tools/lib-paths.mjs. */
const OUT = DIST;

// The MAIN-world and recorder name lists are generated from core/privacy-names.json (T-013).
syncPrivacyNames();

/* T-069: `--flavour managed` is the Chrome build minus `debugger` (no code coverage), for a named organisation
   whose policy lists `blocked_permissions: ["debugger"]`. Same tree, one flag, never a store listing. */
const args = process.argv.slice(2);
const si = args.indexOf('--store');
const STORE = si >= 0;
if (STORE) args.splice(si, 1);
const fi = args.indexOf('--flavour');
const FLAVOUR = fi >= 0 ? args.splice(fi, 2)[1] : null;
if (FLAVOUR && FLAVOUR !== 'managed') { console.error(`Unknown flavour "${FLAVOUR}". Only: managed`); process.exit(1); }
const wanted = FLAVOUR ? 'chrome' : (args[0] || 'all').toLowerCase();
const targets = wanted === 'all' ? Object.keys(TARGETS) : [wanted];
const MANAGED_DROP = ['debugger'];
const STORE_SKIP = new Set(['updater', 'types']);
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Unknown target "${t}". One of: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
  }
}

/* What ships. Deliberately a list rather than an exclusion, so a new folder is
   opted in rather than accidentally published. */
// Everything the store package contains, decided by the same rule — see
// tools/lib-ship.mjs for why this is a deny-list and not a list of folders.
const SHIP = shipping(fs.readdirSync(EXT));

const base = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

/* The copy itself, and its file count, live in tools/lib-ship.mjs — the store
   package needs the identical rule, and `release-check.mjs` asserts the two
   produce the same file-name set. Two copy routines is one rule that drifts. */

/**
 * The manifest for one engine.
 *
 * Returns the changes as well as the result, because a build that silently
 * drops four permissions should say which four.
 */
function manifestFor(id) {
  const spec = TARGETS[id];
  const out = structuredClone(base);
  const changes = [];

  const gone = [...spec.drop, ...(spec.omit || [])];
  const dropped = (out.permissions || []).filter((p) => gone.includes(p));
  if (dropped.length) {
    out.permissions = out.permissions.filter((p) => !gone.includes(p));
    changes.push(`removed ${dropped.join(', ')} — ${spec.label} does not implement them, and a manifest naming one is rejected at install`);
  }

  if (FLAVOUR) {
    out.permissions = (out.permissions || []).filter((p) => !MANAGED_DROP.includes(p));
    changes.push(`managed flavour: removed ${MANAGED_DROP.join(', ')} — installs where policy blocks it; code coverage is unavailable (core/capabilities.js explains it in the interface)`);
  }

  if (spec.background === 'scripts') {
    // Same file, declared the way Gecko's MV3 expects. Nothing in the worker
    // assumes a ServiceWorkerGlobalScope, which is what makes this possible.
    out.background = { scripts: [base.background.service_worker], type: 'module' };
    changes.push('background is an event page rather than a service worker');
  }

  if (spec.gecko) {
    out.browser_specific_settings = { gecko: spec.gecko };
    // Firefox can pin from the manifest: action.default_area (MV3, Firefox 109+) puts the button on the toolbar at install.
    out.action = { ...out.action, default_area: 'navbar' };
    changes.push('action.default_area "navbar" — the button is on the toolbar from install');
    changes.push(`added a gecko id (${spec.gecko.id}) — Firefox refuses to install without one`);
  }

  if (STORE && out.key) {
    delete out.key;
    changes.push('store build: dropped the manifest key — Edge and Opera stores refuse it and assign their own id');
  }

  if (spec.engine !== 'chromium') {
    // minimum_chrome_version is meaningless off Chromium and Firefox warns.
    delete out.minimum_chrome_version;
    changes.push('dropped minimum_chrome_version');

    // The side panel is `chrome.sidePanel`, which is Chromium's alone — Gecko's
    // equivalent is `sidebarAction` and takes a different manifest key
    // entirely. Leaving either in means Firefox warns on the permission and
    // rejects the unknown `side_panel` block, and Safari's converter carries
    // both into a project that cannot use them. The code already reaches the
    // panel through `chrome.sidePanel?.`, so removing them costs nothing.
    if ((out.permissions || []).includes('sidePanel')) {
      out.permissions = out.permissions.filter((p) => p !== 'sidePanel');
      changes.push('removed the sidePanel permission — chrome.sidePanel is Chromium-only');
    }
    if (out.side_panel) {
      delete out.side_panel;
      changes.push('dropped the side_panel key — this engine has no such manifest field');
    }

    // 1020 browsers audit: `chrome.system.display` (float placement) and the optional desktopCapture are
    // Chromium-only too; web-ext lint warns on both in the Gecko manifest. Both calls are already guarded
    // (`chrome.system?.display?.getInfo`, core/capabilities.js), so dropping the names changes no behaviour.
    if ((out.permissions || []).includes('system.display')) {
      out.permissions = out.permissions.filter((p) => p !== 'system.display');
      changes.push('removed the system.display permission — Chromium-only; the float falls back to the default placement');
    }
    const optDropped = (out.optional_permissions || []).filter((p) => spec.drop.includes(p));
    if (optDropped.length) {
      out.optional_permissions = out.optional_permissions.filter((p) => !spec.drop.includes(p));
      changes.push(`removed optional ${optDropped.join(', ')} — not implemented here`);
    }

    // `key` pins the extension ID to our signing key, and an extension ID is a
    // Chromium concept. Firefox identifies the add-on by the gecko id set
    // above; Safari by its bundle identifier. Shipping the Chromium key to
    // either is a public key in a package that has no use for it.
    if (out.key) {
      delete out.key;
      changes.push('dropped the Chromium signing key — this engine identifies the add-on another way');
    }
  }

  return { manifest: out, changes, spec };
}

/** A note in the package saying what this build cannot do, and why. */
function readmeFor(id, changes) {
  const spec = TARGETS[id];
  const drops = [...spec.drop, ...(FLAVOUR ? MANAGED_DROP : [])];
  return `# QA Wrap for ${spec.label}

${spec.note}

## Built from

One source tree. Every content script, every export and the whole ISTQB model
are identical to the Chrome build; only the manifest differs.

${changes.length ? changes.map((c) => `- ${c}`).join('\n') : '- nothing was changed'}

## Loading it

${
  id === 'firefox'
    ? '`about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.json`.\n\n' +
      'For a permanent install the package has to be signed by addons.mozilla.org.'
    : id === 'safari'
    ? 'This folder is **not a Safari extension yet**. On a Mac with Xcode:\n\n' +
      '```bash\nxcrun safari-web-extension-converter ./safari\n```\n\n' +
      'That produces an Xcode project which builds the app Safari loads.'
    : `\`${id}://extensions\` → Developer mode → Load unpacked → pick this folder.`
}

${
  FLAVOUR
    ? ['## Pin it for your testers', '', 'Chrome: `ExtensionSettings` -> `"<extension-id>": { "installation_mode": "force_installed", "toolbar_pin": "force_pinned", "blocked_permissions": ["debugger"] }`.',
      'Edge: the same entry with `"toolbar_state": "force_shown"` in place of `toolbar_pin`. See ADMIN.md.', '', ''].join('\n')
    : ''
}## What is unavailable here

${
  drops.length
    ? drops.map((d) => `- \`${d}\``).join('\n') +
      '\n\nThe features that need these are disabled in the interface and say which browser they need, ' +
      'rather than failing when pressed. See `core/capabilities.js`.'
    : 'Nothing. This build has the full surface.'
}
`;
}

// zipdir:begin  (self-contained: tools/test-portable-zip.mjs loads exactly this block)
/**
 * Write every file under `dir` into a zip at `out`, in Node alone (T-039).
 *
 * The entry names are forward-slash paths sorted by name, the timestamp is
 * fixed, and each file is deflated in one pass, so the same tree always
 * yields the same bytes and nothing here needs a shell, a platform or a
 * system zipper. Folder markers are not written (the readers ignore them).
 * Not ZIP64: a package beyond 4 GB or 65535 entries throws rather than
 * writing a broken archive. Needs zlib.crc32 (Node 22.2 or later).
 */
function zipDir(dir, out) {
  const names = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else names.push(r);
    }
  };
  walk('');
  names.sort();
  if (names.length > 0xffff) throw new Error(`too many entries for a plain zip: ${names.length}`);
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_DATE = 0x0021; // 1980-01-01, fixed so the archive is reproducible
  for (const name of names) {
    const raw = fs.readFileSync(path.join(dir, name));
    const body = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10); head.writeUInt16LE(0, 12); head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(body.length, 20); head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    parts.push(local, nameBuf, body);
    offset += 30 + nameBuf.length + body.length;
    if (offset > 0xffffffff) throw new Error('package beyond 4 GB needs ZIP64');
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(out, Buffer.concat([...parts, cd, end]));
}
// zipdir:end

/**
 * Compress one folder, and refuse to lie about the result.
 *
 * The retry (a Windows Defender scan can hold a fresh file open), the entry
 * count and the write-beside-then-rename live in `tools/lib-zip.mjs`, beside
 * the reasoning for each. What is left here is the packer: `zipDir` above,
 * which has no shell in it, so the same build runs on Windows and on Ubuntu.
 */
async function compress(dir, zip, expectedFiles) {
  return packVerified({
    zip,
    expectedFiles,
    pack: (tmp) => zipDir(dir, tmp),
    onRetry: (note) => console.log(`  note  ${path.basename(zip)} ${note}`),
  });
}

console.log(`QA Wrap ${base.version} — building ${targets.length} target(s)\n`);

const built = [];
const failed = [];

for (const id of targets) {
  const { manifest, changes, spec } = manifestFor(id);
  const slugId = FLAVOUR ? `${id}-${FLAVOUR}` : id;
  const dir = path.join(OUT, slugId);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let files = 0;
  for (const entry of SHIP) {
    const from = path.join(EXT, entry);
    if (!fs.existsSync(from)) continue;
    if (entry === 'manifest.json') continue;
    // Store packages carry neither the native updater (stores refuse updater/host.cmd and a store updates the add-on itself) nor the dev type stubs.
    if (STORE && STORE_SKIP.has(entry)) { console.log(`  - ${entry}/  (store build, not shipped)`); continue; }
    // Nested working notes are dropped here rather than only at the top level:
    // `popup/REFACTOR.md` shipped in all eight packages because the old filter
    // read the extension folder's own entries and nothing below them. Named on
    // the way past, so a package's contents are never a surprise.
    files += copyShipping(from, path.join(dir, entry), (skipped) =>
      console.log(`  - ${skipped}  (working note, not shipped)`));
  }
  // r363: the rating link depends on the dist (core/rate-links.js). Fails loudly if the marker line is gone.
  const rl = path.join(dir, 'core', 'rate-links.js');
  const rlSrc = fs.readFileSync(rl, 'utf8');
  const rlOut = rlSrc.replace(/^export const BUILD_DIST = '[a-z]+';/m, `export const BUILD_DIST = '${id}';`);
  if (rlOut === rlSrc && id !== 'chrome') throw new Error('core/rate-links.js: BUILD_DIST line not found');
  const rlFlav = rlOut.replace(/^export const BUILD_FLAVOUR = '[a-z]*';/m, `export const BUILD_FLAVOUR = '${FLAVOUR || ''}';`);
  if (rlFlav === rlOut && FLAVOUR) throw new Error('core/rate-links.js: BUILD_FLAVOUR line not found');
  const rlStore = rlFlav.replace(/^export const BUILD_STORE = (?:false|true);/m, `export const BUILD_STORE = ${STORE};`);
  if (rlStore === rlFlav && STORE) throw new Error('core/rate-links.js: BUILD_STORE line not found');
  fs.writeFileSync(rl, rlStore);
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'BROWSER.md'), readmeFor(id, changes));
  files += 2; // the two written above rather than copied

  /* Zip it, except for Safari, which is not a package until Xcode has been. */
  let zip = null;
  if (id !== 'safari') {
    const target = path.join(OUT, `qa-wrap-${base.version}-${slugId}.zip`);
    const result = await compress(dir, target, files);
    if (result.ok) {
      zip = target;
      if (result.attempts > 1) console.log(`  note  ${path.basename(target)} took ${result.attempts} attempts`);
    } else {
      // Loud, and fatal at the end. A build that could not write a package must
      // not print a tidy table and exit 0 — that is precisely how a missing
      // Firefox zip went unnoticed for a release.
      console.log(`  FAIL  could not zip ${id}: ${result.error}`);
      failed.push(id);
    }
  }

  const size = zip && fs.existsSync(zip) ? `${(fs.statSync(zip).size / 1024).toFixed(1)} KB` : 'folder only';
  built.push({ id: slugId, dir, zip, size, changes, files });

  console.log(`  ${spec.label.padEnd(9)} ${size.padStart(12)}  ${path.relative(EXT, zip || dir)}  ${files} files`);
  for (const c of changes) console.log(`            · ${c}`);
  if (id === 'safari') {
    console.log('            · not packaged: run `xcrun safari-web-extension-converter` on a Mac with Xcode');
  }
  console.log('');
}

console.log('Every build is the same source. Only the manifest differs — see each BROWSER.md.');

if (failed.length) {
  console.error(`\n${failed.length} target(s) produced no package: ${failed.join(', ')}`);
  process.exit(1);
}
