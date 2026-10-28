/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One test, every browser dist (docs/BROWSERS-GUIDE.md rules B1-B15).
 *
 *   node tools/test-browser-dists.mjs        (from extension/; QAW_WEBEXT=1 also runs `npx web-ext lint` on the Firefox dist)
 *
 * Reads dist/<target> for chrome, chrome-managed, edge, brave, opera, operagx, duckduckgo, firefox and safari. A missing or
 * stale folder is rebuilt once into a temp QAW_DIST, so the delivered dist/ is never overwritten. Reuses TARGETS and
 * CAPABILITIES; the support matrix below is the guide's matrix in data form (MDN browser-compat-data 8.1.6, 2026-10-20).
 *
 * Live: every Chromium-family dist is loaded into Playwright's bundled Chromium (headless, no window on the owner's
 * screen), the service worker must boot with no error and popup/popup.html must render. Gecko and WebKit cannot be loaded
 * from Windows by Playwright: Firefox gets web-ext lint (opt-in), Safari/iOS/Android are static only (guide, "not testable").
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { DIST, EXT } from './lib-paths.mjs';
import { TARGETS } from './targets.mjs';
import { CAPABILITIES } from '../core/capabilities.js';

const SRC = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const CHROMIUM = ['chrome', 'chrome-managed', 'edge', 'brave', 'opera', 'operagx', 'duckduckgo'];
const ALL = [...CHROMIUM, 'firefox', 'safari'];

/* ── the matrix, in data form: what each engine lacks (BCD 8.1.6; offscreen/tabCapture/desktopCapture/system.display are
   absent from BCD's webextensions tree and graded [A] from MDN + the build's own TARGETS) ───────────────────────────── */
const ABSENT = {
  gecko: { permissions: ['sidePanel', 'offscreen', 'tabCapture', 'desktopCapture', 'debugger', 'system.display'], apis: ['sidePanel', 'offscreen', 'tabCapture', 'desktopCapture', 'debugger', 'system.display'] },
  webkit: { permissions: ['sidePanel', 'offscreen', 'tabCapture', 'desktopCapture', 'debugger', 'system.display'], apis: ['sidePanel', 'offscreen', 'tabCapture', 'desktopCapture', 'debugger', 'system.display', 'runtime.getContexts'] },
};

const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
let n = 0;

/* ── get the dists ────────────────────────────────────────────────────────── */
const readManifest = (d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
const same = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };
/* current = right version and the newest edited files equal the tree's (a dist built before an edit is stale) */
const ready = (root) => ALL.every((id) => { try { return readManifest(path.join(root, id)).version === SRC.version && ['welcome/welcome.js', 'welcome/welcome.html', 'background/service-worker.js'].every((f) => same(path.join(root, id, f), path.join(EXT, f))); } catch { return false; } });
let ROOT = DIST;
if (!ready(ROOT)) {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-browser-dists-'));
  const env = { ...process.env, QAW_DIST: ROOT, PYTHONUTF8: '1' };
  for (const args of [['all'], ['chrome', '--flavour', 'managed']]) {
    const r = spawnSync(process.execPath, ['tools/build-browsers.mjs', ...args], { encoding: 'utf8', env, cwd: EXT });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
}
const dir = (id) => path.join(ROOT, id);
const man = (id) => readManifest(dir(id));
const engineOf = (id) => (id === 'firefox' ? 'gecko' : id === 'safari' ? 'webkit' : 'chromium');
const walk = (d, keep) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
});
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

/* ── B1-B5 the manifest, per engine ───────────────────────────────────────── */
await t('every dist has a valid MV3 manifest, a unique permission list, its icons and en+ar locales', () => {
  for (const id of ALL) {
    const m = man(id);
    assert.equal(m.manifest_version, 3, id);
    assert.equal(m.version, SRC.version, id);
    for (const l of ['permissions', 'optional_permissions', 'host_permissions']) {
      const a = m[l] || [];
      assert.equal(new Set(a).size, a.length, `${id}: duplicate in ${l}`);
    }
    assert.ok(!(m.permissions || []).some((p) => (m.optional_permissions || []).includes(p)), `${id}: a permission is both required and optional`);
    for (const p of [...Object.values(m.icons), ...Object.values(m.action.default_icon)]) assert.ok(fs.existsSync(path.join(dir(id), p)), `${id}: missing ${p}`);
    for (const loc of ['en', 'ar']) assert.ok(fs.existsSync(path.join(dir(id), '_locales', loc, 'messages.json')), `${id}: no ${loc} locale`);
    assert.ok(fs.existsSync(path.join(dir(id), 'BROWSER.md')), `${id}: no BROWSER.md`);
    for (const f of [m.options_ui?.page, m.devtools_page, m.side_panel?.default_path, m.background.service_worker, ...(m.background.scripts || [])].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(dir(id), f)), `${id}: manifest names ${f}, not shipped`);
    }
  }
});

await t('Chromium family: service worker, side panel, same key, floor 116, nothing Gecko-only', () => {
  for (const id of CHROMIUM) {
    const m = man(id);
    assert.ok(m.background.service_worker && !m.background.scripts, id);
    if (TARGETS[id === 'chrome-managed' ? 'chrome' : id].drop.includes('sidePanel')) assert.ok(!m.side_panel && !m.permissions.includes('sidePanel'), `${id}: no side panel (dropped)`);
    else assert.ok(m.side_panel?.default_path && m.permissions.includes('sidePanel'), `${id}: side panel`);
    assert.equal(m.key, SRC.key, `${id}: same extension id as the store build`);
    assert.ok(Number(m.minimum_chrome_version) >= 116, `${id}: runtime.getContexts needs Chrome 116`);
    assert.equal(m.browser_specific_settings, undefined, id);
    assert.equal(m.action.default_area, undefined, `${id}: default_area is Firefox's key`);
  }
});

await t('managed flavour: the Chrome build minus debugger and only debugger', () => {
  const m = man('chrome-managed');
  assert.deepEqual(m.permissions, SRC.permissions.filter((p) => p !== 'debugger'));
  assert.ok(!(m.optional_permissions || []).includes('debugger'));
  assert.match(fs.readFileSync(path.join(dir('chrome-managed'), 'BROWSER.md'), 'utf8'), /force_pinned/);
  assert.match(fs.readFileSync(path.join(dir('chrome-managed'), 'BROWSER.md'), 'utf8'), /force_shown/);
});

await t('Firefox: event page, gecko id, data_collection_permissions, navbar pin, nothing Gecko rejects or warns on', () => {
  const m = man('firefox');
  assert.ok(m.background.scripts?.length && !m.background.service_worker);
  const g = m.browser_specific_settings.gecko;
  assert.match(g.id, /^[^@\s]+@[^@\s]+$/);
  assert.ok(parseInt(g.strict_min_version, 10) >= 127, 'runtime.getContexts needs Firefox 127; action.default_area 109; getUserSettings 116');
  assert.deepEqual(g.data_collection_permissions.required, ['none']);
  assert.ok(Array.isArray(g.data_collection_permissions.optional));
  assert.equal(m.action.default_area, 'navbar', 'B14: Firefox pins from the manifest');
  for (const k of ['side_panel', 'key', 'minimum_chrome_version']) assert.equal(m[k], undefined, k);
  const all = [...m.permissions, ...(m.optional_permissions || [])];
  for (const p of ABSENT.gecko.permissions) assert.ok(!all.includes(p), `firefox names ${p}`);
});

await t('Safari: prepared folder, no Chromium-only key or permission the converter would carry', () => {
  const m = man('safari');
  for (const k of ['side_panel', 'key', 'minimum_chrome_version', 'browser_specific_settings']) assert.equal(m[k], undefined, k);
  const all = [...m.permissions, ...(m.optional_permissions || [])];
  for (const p of ABSENT.webkit.permissions) assert.ok(!all.includes(p), `safari names ${p}`);
  for (const p of TARGETS.safari.omit) assert.ok(!all.includes(p), `safari names ${p}: Safari implements neither downloads nor notifications (BCD)`); // F2 fixed 2026-10-20
});

await t('F3 fixed: Firefox strict_min_version is at the data_collection_permissions floor (140)', () => {
  assert.ok(parseInt(man('firefox').browser_specific_settings.gecko.strict_min_version, 10) >= 140, 'data_collection_permissions is read from Firefox 140');
});

await t('targets.mjs and the manifests agree: every dropped permission is absent from that dist', () => {
  for (const id of ALL) {
    const drop = TARGETS[id === 'chrome-managed' ? 'chrome' : id].drop;
    const m = man(id);
    for (const p of drop) assert.ok(![...m.permissions, ...(m.optional_permissions || [])].includes(p), `${id} still names ${p}`);
  }
});

/* ── B6-B8 API usage vs matrix: every call to an API the engine lacks is guarded inline or sits behind a CAPABILITIES gate ── */
await t('static scan: no unguarded call to an API Firefox or Safari lacks, outside a capability-gated module', () => {
  const GATED_FILES = /^(background[\\/](media|whitebox)\.js|offscreen[\\/].*)$/; // reached only through the offscreen/tabCapture/debugger capability the popup checks
  const ids = new Set(CAPABILITIES.map((c) => c.id));
  for (const engine of ['gecko', 'webkit']) {
    const id = engine === 'gecko' ? 'firefox' : 'safari';
    const re = new RegExp(`chrome\\.(${ABSENT[engine].apis.map((a) => a.replace('.', '\\.')).join('|')})\\b`);
    const bad = [];
    const gatedApis = new Set();
    for (const f of walk(dir(id), (p) => p.endsWith('.js') && !/[\\/]vendor[\\/]/.test(p))) {
      const rel = path.relative(dir(id), f);
      const L = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      L.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        const m = l.match(re);
        if (!m) return;
        const ctx = L.slice(Math.max(0, i - 8), i + 1).join('\n');
        const guarded = /chrome\.[\w.]*\?\./.test(l) || /typeof|hasSidePanel|whyNot|detect\(|\bhas\(/.test(ctx) || /try \{/.test(L.slice(Math.max(0, i - 3), i + 1).join('\n')) || /\.catch\(/.test(l);
        if (guarded) return;
        if (GATED_FILES.test(rel)) { gatedApis.add(m[1].split('.')[0]); return; }
        bad.push(`${rel}:${i + 1} ${l.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(bad, [], `${id}: unguarded calls`);
    for (const api of gatedApis) assert.ok(ids.has(api) || api === 'runtime', `${id}: ${api} is used in a gated module but has no CAPABILITIES entry`);
  }
});

await t('the unguarded-by-line APIs each have a capability that names them and a TARGETS drop', () => {
  for (const api of ['offscreen', 'tabCapture', 'desktopCapture', 'debugger']) {
    assert.ok(CAPABILITIES.some((c) => c.id === api), api);
    assert.ok(TARGETS.firefox.drop.includes(api) || api === 'desktopCapture', `firefox drop ${api}`);
    assert.ok(TARGETS.safari.drop.includes(api) || api === 'desktopCapture', `safari drop ${api}`);
  }
});

/* ── B9 one source: the dists differ from the tree only by manifest and BROWSER.md (so every Autopilot/Jira test on the
   tree is a test of the dist) ───────────────────────────────────────────────────────────────────────────────────────── */
await t('every dist is byte-identical to the source tree except manifest.json and BROWSER.md (Jira helper and Autopilot code included)', () => {
  const ref = new Map();
  for (const id of ALL) {
    const files = walk(dir(id), () => true).map((f) => path.relative(dir(id), f)).filter((f) => f !== 'manifest.json' && f !== 'BROWSER.md');
    assert.ok(files.some((f) => f.startsWith('jira')), `${id}: no Jira helper shipped`);
    for (const must of ['background/service-worker.js', 'popup/popup.html', 'welcome/welcome.html', 'core/capabilities.js']) assert.ok(files.includes(must) || files.includes(must.replace(/\//g, '\\')), `${id}: ${must}`);
    if (id === 'chrome') { for (const f of files) ref.set(f, sha(path.join(dir(id), f))); continue; }
    assert.equal(files.length, ref.size, `${id}: file count`);
    for (const f of files) assert.equal(sha(path.join(dir(id), f)), ref.get(f), `${id}: ${f} differs from the chrome build`);
  }
  for (const f of ['background/service-worker.js', 'welcome/welcome.js', 'popup/popup.js']) {
    assert.equal(ref.get(f.replace(/\//g, path.sep)), sha(path.join(EXT, f)), `${f} differs from the source tree`);
  }
});

/* ── B14 the pin ─────────────────────────────────────────────────────────── */
await t('pin: managed policy recipe names force_pinned, welcome asks getUserSettings behind a guard, hides once pinned', () => {
  const admin = fs.readFileSync(path.join(EXT, 'ADMIN.md'), 'utf8');
  assert.match(admin, /"toolbar_pin": "force_pinned"/);
  assert.match(admin, /"toolbar_state": "force_shown"/);
  const js = fs.readFileSync(path.join(EXT, 'welcome', 'welcome.js'), 'utf8');
  assert.match(js, /chrome\.action\?\.getUserSettings\?\./, 'guarded call');
  assert.match(js, /onUserSettingsChanged\?\./);
  assert.match(js, /isOnToolbar/);
  assert.match(js, /visibilitychange/);
  const html = fs.readFileSync(path.join(EXT, 'welcome', 'welcome.html'), 'utf8');
  const steps = [...html.matchAll(/<li data-pin="(\w+)"[^>]*>(.*?)<\/li>/g)];
  assert.deepEqual([...new Set(steps.map((s) => s[1]))].sort(), ['default', 'edge', 'opera', 'safari']);
  for (const s of steps) {
    assert.match(s[2], /lang="ar"/);
    assert.match(s[2], /lang="en"/);
    const en = s[2].match(/<bdi dir="ltr" lang="en">(.*?)<\/bdi>/)[1];
    assert.ok(en.split(/\s+/).length <= 25, `hint over 25 words: ${en}`);
    assert.ok(!/[&+]/.test(en.replace(/&middot;/g, '')), `no & or + in a label: ${en}`);
  }
  const css = fs.readFileSync(path.join(EXT, 'welcome', 'welcome.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion[^}]*\{[^}]*\.pin-ring \{ animation: none/s, 'the pin animation is reduced-motion safe');
});

/* ── B10-B11 UX that can be asserted without a device ─────────────────────── */
await t('keyboard chords: every suggested key is Alt+Shift+letter, unique, none on a chord Opera or Firefox reserve', () => {
  // [V] https://help.opera.com/en/latest/shortcuts/ (read 2026-10-20): Opera's only Alt chords are Alt+P, Alt+Left/Right, Alt+F4, Alt+Tab; its Shift chords all carry Ctrl/Cmd. Kept: Firefox menu-bar toggles [A], the old guess.
  const RESERVED = new Set(['Alt+Shift+F', 'Alt+Shift+D', 'Alt+Shift+P', 'Alt+Shift+T', 'Alt+Shift+B']);
  const seen = new Set();
  for (const [name, c] of Object.entries(SRC.commands)) {
    const k = c.suggested_key?.default;
    if (!k) continue;
    assert.match(k, /^Alt\+Shift\+[A-Z]$/, name);
    assert.ok(!seen.has(k) && !RESERVED.has(k), `${name}: ${k}`);
    seen.add(k);
  }
  assert.ok(Object.keys(SRC.commands).length <= 6, 'Firefox Android and Safari cap what is shown; keep every command reachable from the popup too');
});

await t('popup is touch-sized and RTL-safe: hit-size token >= 44 px or a coarse-pointer rule, and logical properties', () => {
  const css = fs.readFileSync(path.join(EXT, 'popup', 'popup.css'), 'utf8');
  assert.ok(/--sz-hit:\s*(4[4-9]|[5-9]\d)px/.test(fs.readFileSync(path.join(EXT, 'ui', 'tokens.css'), 'utf8') + css + fs.readFileSync(path.join(EXT, 'ui', 'scale.css'), 'utf8')) || /pointer:\s*coarse/.test(css), 'hit target');
  assert.match(fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8'), /name="viewport"/);
});

/* ── B12 live, Chromium family ────────────────────────────────────────────── */
for (const id of CHROMIUM) {
  await t(`live ${id}: loads in Chromium, the worker boots with no error, the popup renders`, async () => {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), `qaw-live-${id}-`));
    const ctx = await chromium.launchPersistentContext(prof, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${dir(id)}`, `--load-extension=${dir(id)}`, '--no-first-run'],
    });
    const errs = [];
    try {
      ctx.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      ctx.on('weberror', (e) => errs.push(String(e.error())));
      const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
      const extId = new URL(sw.url()).host;
      const page = await ctx.newPage();
      await page.goto(`chrome-extension://${extId}/popup/popup.html`);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      const perms = await sw.evaluate(() => chrome.runtime.getManifest().permissions);
      assert.equal(perms.includes('debugger'), id !== 'chrome-managed', `${id}: debugger`);
      const welcome = await ctx.newPage();
      await welcome.goto(`chrome-extension://${extId}/welcome/welcome.html`);
      assert.ok(await welcome.locator('#pin-block').count() === 1);
      assert.deepEqual(errs.filter((e) => !/favicon|net::ERR/.test(e)), [], `${id}: console errors`);
    } finally {
      await ctx.close();
      fs.rmSync(prof, { recursive: true, force: true });
    }
  });
}

/* ── B13 Firefox lint (opt-in: npx needs the network) ─────────────────────── */
if (process.env.QAW_WEBEXT === '1') {
  await t('web-ext lint on the Firefox dist: 0 errors, no manifest or permission warning', () => {
    const r = spawnSync('npx', ['--yes', 'web-ext', 'lint', '--source-dir', dir('firefox'), '--output', 'json', '--self-hosted'], { encoding: 'utf8', shell: true, env: process.env });
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(j.errors.length, 0, JSON.stringify(j.errors.map((e) => e.code)));
    const manifestWarn = j.warnings.filter((w) => /^MANIFEST_|^KEY_(?!FIREFOX(_ANDROID)?_UNSUPPORTED_BY_MIN_VERSION)/.test(w.code));
    assert.deepEqual(manifestWarn.map((w) => w.message), []);
  });
} else console.log('  skip  web-ext lint (QAW_WEBEXT=1 to run; needs the network for npx)');

console.log('  note  not testable on Windows: Safari / iOS / iPadOS (needs Xcode), Firefox for Android, Edge/Opera mobile (no extension support): static checks only, see docs/BROWSERS-GUIDE.md');
if (ROOT !== DIST) fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${n} passed, 0 failed`);
