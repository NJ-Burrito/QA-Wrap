/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The permissions this extension asks for, and the two gates in front of them.
 *
 *   node tools/test-permissions.mjs
 *
 * Decision 8 of `research/56-decisions-2026-09-07.md` moved `<all_urls>` out of
 * `host_permissions`. That is one line in a manifest and six mechanisms behind
 * it, and every one of them fails silently:
 *
 *   · a `content_scripts` block put back in the manifest reinstates the
 *     install-time "read and change all your data on all websites" warning and
 *     nothing else changes, so nobody notices until a store review;
 *   · a file added to `content/` and to the manifest but not to `SITE_SCRIPTS`
 *     is simply never injected, and the feature it belongs to is quietly dead;
 *   · an `await` slipped in front of `chrome.permissions.request` in the popup
 *     spends the user gesture, and Chrome refuses the request with no dialog at
 *     all — the tester presses Wake and nothing happens;
 *   · two spellings of the refusal sentence read, to a tester who meets them
 *     both, as two different faults;
 *   · a consent gate that fails open shows the recorder to somebody who was
 *     never shown the notice, which is the thing the gate exists to prevent;
 *   · a policy value an administrator typed by hand and this product does not
 *     know is a popup offering a button Chrome will refuse.
 *
 * Static, and deliberately so. `chrome.permissions.request` is answered by a
 * bubble the *browser* draws, with no element for a harness to click — measured
 * in `tools/recording.mjs` for `desktopCapture`, where the request sat
 * unanswered for forty-five seconds. So the headed suites pre-seed the grant
 * the way `tools/lib-granted.mjs` describes, and what can only be proved by
 * reading the source is proved here, where it fails on the commit that breaks
 * it rather than on the machine of whoever runs a browser next.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc as allWorkerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const manifest = JSON.parse(read('manifest.json'));
const siteAccessSrc = read('background/site-access.js');
const armedSrc = read('background/armed.js');
const workerSrc = allWorkerSrc();
const popupJs = read('popup/popup.js');
const popupHtml = read('popup/popup.html');
const popupCss = read('popup/popup.css');
const optionsJs = read('options/options.js');
const optionsHtml = read('options/options.html');
const settingsSrc = read('platform/settings.js');
const schema = JSON.parse(read('managed-schema.json'));

const site = await import('../background/site-access.js');

/* ── the manifest asks for nothing it has not been given ───────────────── */

console.log('permissions — what the install dialog says');

await test('ui-1019: <all_urls> is the one required host permission (Start is the consent; no per-site prompt), and nothing else is', () => {
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.ok(!(manifest.optional_host_permissions || []).includes('<all_urls>'), 'not offered twice');
});

await test('ui-1019: the three AI-writing hosts are covered by <all_urls> and not listed again (Chrome warns on a redundant optional permission)', () => {
  assert.equal(manifest.optional_host_permissions, undefined);
});

await test('no content script is declared in the manifest', () => {
  assert.equal(
    manifest.content_scripts,
    undefined,
    'a declared content script needs its matches at install time, so declaring one puts the ' +
      'all-sites warning back on the install dialog. They are registered against the granted ' +
      'origins by background/site-access.js instead.'
  );
});

await test('cookies, desktopCapture and nativeMessaging are the only optional API permissions; the agent bridge asks for its own in the click that turns it on', () => {
  assert.deepEqual(manifest.optional_permissions, ['cookies', 'desktopCapture', 'nativeMessaging']);
  assert.ok(!manifest.permissions.includes('nativeMessaging'), 'nativeMessaging is never held at install (features-1010, decision 6)');
  const bridge = optionsJs.length ? fs.readFileSync(path.join(EXT, 'options/buffer-bridge.js'), 'utf8') : '';
  assert.match(bridge, /const asking = chrome\.permissions\.request\(\{ permissions: \['nativeMessaging'\] \}\); \/\/ first statement/);
});

/* T-006 (owner decision Q-02): `debugger` is required, both ways pinned, and no
 * document or source comment calls it optional. */
await test('debugger is required, never optional, and nothing calls it optional', () => {
  assert.ok(manifest.permissions.includes('debugger'));
  assert.ok(!(manifest.optional_permissions || []).includes('debugger'));
  const callsItOptional = /debugger`?\W+(is |as |be |being )?optional|optional\W+(permission\W+)?`?debugger/i;
  for (const f of ['background/whitebox.js', 'store/LISTING.md', 'PRIVACY.md', 'SECURITY.md', 'README.md', '../site/privacy.html']) {
    const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, callsItOptional, `${f} calls debugger optional`);
  }
});

/*
 * S4 (work/ui-rework-0927): the float window is placed against the real
 * screen work areas, not the anchor window, and that needs `system.display`.
 * It shows no install-time warning (there is no line for it in Chrome's own
 * permission-warnings table), so it is a required permission, not optional
 * behind a runtime prompt like `desktopCapture`.
 */
await test('system.display is a required permission, for float placement', () => {
  assert.ok(manifest.permissions.includes('system.display'));
});

await test('the display lookup is read defensively, for a browser without it', () => {
  assert.match(workerSrc, /chrome\.system\?\.display\?\.getInfo/,
    'chrome.system is absent on Firefox and on browsers where the permission was stripped; ' +
      'reading it with optional chaining is what keeps openFloat() from throwing there'
  );
});

/* ── the registered scripts are the ones the manifest used to declare ──── */

console.log('\npermissions — the scripts that used to be in the manifest');

/**
 * The two groups, exactly as `manifest.json` carried them until 8 September
 * 2026, written out rather than derived.
 *
 * Derived from the current source this test would pass no matter what was
 * deleted. This list is the record of the wire, in the shape
 * `tools/test-handlers.mjs` keeps the message names in and for the same reason:
 * changing it has to be a decision.
 */
const FORMER_STATIC = [
  {
    id: 'uqa-site-start',
    js: ['content/selector-engine.js', 'content/replay-buffer.js', 'content/bridge.js', 'content/recorder.js', 'content/ui-host.js'],
    css: ['content/overlay.css'],
    allFrames: true,
    runAt: 'document_start',
    world: 'ISOLATED',
  },
  {
    id: 'uqa-site-idle',
    js: ['content/mask.js', 'content/replay-recorder.js', 'content/vitals.js', 'content/checks.js', 'content/keymap.js', 'content/autopilot.js'],
    allFrames: true,
    runAt: 'document_idle',
    world: 'ISOLATED',
  },
];

await test('the registered scripts mirror the former static list, file for file', () => {
  assert.deepEqual(site.SITE_SCRIPTS.map((s) => ({ ...s })), FORMER_STATIC);
});

await test('every registered script is actually in the package', () => {
  for (const spec of site.SITE_SCRIPTS) {
    for (const file of [...spec.js, ...(spec.css || [])]) {
      assert.ok(fs.existsSync(path.join(EXT, file)), `${file} is registered at runtime but is not in the package`);
    }
  }
});

await test('the registration is computed from the grant rather than hard-coded', () => {
  assert.match(siteAccessSrc, /const matches = await siteMatches\(\);/);
  assert.doesNotMatch(
    siteAccessSrc.slice(siteAccessSrc.indexOf('export async function syncSiteScripts')),
    /matches: \['<all_urls>'\]/,
    'syncSiteScripts registers on <all_urls> whatever was granted'
  );
});

await test('the MAIN-world hooks follow the granted origins too', () => {
  assert.match(armedSrc, /import \{ siteMatches \} from '\.\/site-access\.js';/);
  assert.match(armedSrc, /function hooksSpec\(matches\)/);
  assert.doesNotMatch(
    armedSrc,
    /matches: \['<all_urls>'\]/,
    'registerContentScripts refuses a pattern outside the granted set, so a literal <all_urls> ' +
      'here throws on every machine where one origin was allowed'
  );
});

await test('the worker keeps the registration in step with the grant on every start', () => {
  assert.match(workerSrc, /site\.watchSiteAccess\(/);
  assert.match(siteAccessSrc, /permissions\.onAdded/);
  assert.match(siteAccessSrc, /permissions\.onRemoved/);
});

/* ── the origin pattern is the narrowest thing worth asking for ────────── */

console.log('\npermissions — what one press asks for');

await test('a page is asked for by origin, never by path', () => {
  assert.equal(site.originPattern('https://shop.example.com/orders/8813?x=1'), 'https://shop.example.com/*');
  assert.equal(site.originPattern('http://localhost:3000/a/b'), 'http://localhost:3000/*');
  assert.equal(site.originPattern('https://a.example.com:8443/'), 'https://a.example.com:8443/*');
});

await test('a subdomain is a different site, and is asked for separately', () => {
  assert.notEqual(site.originPattern('https://api.example.com/'), site.originPattern('https://example.com/'));
});

await test('a page no grant could cover is not asked for at all', () => {
  for (const url of ['chrome://extensions/', 'about:blank', 'data:text/html,x', 'devtools://x', '', 'not a url']) {
    assert.equal(site.originPattern(url), null, `${url} should not be askable`);
  }
});

await test('a local file is asked for as file:///*, which is all Chrome offers', () => {
  assert.equal(site.originPattern('file:///C:/tmp/page.html'), 'file:///*');
});

/* ── the refusal, in one wording ───────────────────────────────────────── */

console.log('\npermissions — the refusal');

const REFUSAL = 'QA Wrap is not allowed on this site yet. Wake up here to allow it.';

await test('the refusal is the sentence a tester can act on', () => {
  assert.equal(site.NOT_ALLOWED, REFUSAL);
});

await test('the popup refuses in exactly the same words', () => {
  assert.ok(
    popupJs.includes(`const NOT_ALLOWED = '${REFUSAL}';`),
    'the popup has drifted from background/site-access.js NOT_ALLOWED'
  );
});

await test('the refusal carries no em dash, like every other line a tester reads', () => {
  assert.doesNotMatch(REFUSAL, /—/);
});

await test('every gated message is refused before it reaches a page', () => {
  const guard = workerSrc.slice(workerSrc.indexOf('async function guard('));
  assert.match(guard.slice(0, 2000), /throw site\.notAllowedError\(\)/);
});

await test('a recording does not start on a site nobody allowed', () => {
  const start = workerSrc.slice(workerSrc.indexOf('async function runStart('));
  assert.match(start.slice(0, 1500), /throw site\.notAllowedError\(\)/);
});

await test('a page Chrome allows nobody into falls through to its own sentence', () => {
  // `originPattern()` guards the refusal, so a chrome:// tab is never told to
  // press Wake, which would not help it.
  const guard = workerSrc.slice(workerSrc.indexOf('async function guard('), workerSrc.indexOf('async function guard(') + 2500);
  assert.match(guard, /site\.originPattern\(tab\?\.url \|\| ''\) && !\(await site\.hasSiteAccess\(tab\.url\)\)/);
});

/* ── the request is made inside the gesture, which is the whole trick ──── */

console.log('\npermissions — the press');

/** The body of the wake button's click handler, from the source. */
const wakeHandler = (() => {
  const start = popupJs.indexOf("document.getElementById('switch').addEventListener('click'");
  assert.ok(start > 0, 'the wake handler could not be found');
  return popupJs.slice(start, popupJs.indexOf('\n});', start));
})();

await test('the wake press asks for the site before it awaits anything', () => {
  const asking = wakeHandler.indexOf('const asking =');
  const firstAwait = wakeHandler.indexOf('await ');
  assert.ok(asking > 0, 'the wake press never asks for the site');
  assert.ok(
    asking < firstAwait,
    'chrome.permissions.request is refused unless a user gesture is live, and the first await ' +
      'spends the gesture. The request must be issued on the first lines of the handler and ' +
      'waited for inside the dispatch.'
  );
});

await test('requestSite() calls Chrome with nothing awaited in front of it', () => {
  const body = popupJs.slice(popupJs.indexOf('function requestSite('), popupJs.indexOf('/** Tell the worker'));
  assert.match(body, /return chrome\.permissions\.request\(\{ origins: \[ask\] \}\);/);
  assert.doesNotMatch(body, /await /, 'an await inside requestSite would spend the gesture before the request');
});

await test('the state the press needs is read before the press, not during it', () => {
  assert.match(popupJs, /let siteAccess = \{/);
  assert.match(popupJs, /send\(\{ type: 'UQA_SITE_ACCESS' \}\)/);
});

await test('"All sites" and "Wake only" are gone: the card is one switch, awake on THIS site', () => {
  for (const id of ['wake-all', 'wake-access', 'wake-options']) assert.ok(!popupHtml.includes(`id="${id}"`), id);
  assert.ok(/<button id="switch"[^>]*role="switch"[^>]*aria-checked/.test(popupHtml), 'the card is a role=switch button');
  assert.equal(popupJs.split("origins: ['<all_urls>']").length - 1, 0, 'the popup never asks for <all_urls> by itself');
  assert.ok(!/accessLine|allSites/.test(popupJs), 'no all-sites state is left in the popup');
});

await test('no all-sites grant is requested, and the dead drop-grant code is gone', () => {
  const sa = read('background/site-access.js');
  assert.ok(!/dropAllSitesGrant|allSitesDropped/.test(sa), '<all_urls> is required in the manifest, so a removal was a no-op');
  assert.ok(!/permissions\.request\(\{ origins: \['<all_urls>'\]/.test(read('options/options.js')), 'Settings has no Allow all sites');
});

await test('granting tells the worker, so the tab in front of the tester is covered', () => {
  assert.match(popupJs, /type: 'UQA_SITE_GRANTED'/);
  assert.match(workerSrc, /UQA_SITE_GRANTED: async \(msg, sender\) => \{/);
  assert.match(siteAccessSrc, /export async function injectSiteScripts\(windowId\)/);
});

await test('Settings lists what was granted and can take it back', () => {
  assert.ok(optionsHtml.includes('id="site-list"'));
  assert.match(optionsJs, /chrome\.permissions\.remove\(\{ origins: \[origin\] \}\)/);
  assert.match(optionsJs, /chrome\.permissions\.remove\(\{ origins \}\)/);
});

await test('sleep revokes nothing: the tester takes a site back in Settings', () => {
  const disarm = armedSrc.slice(armedSrc.indexOf('export async function disarm('));
  assert.doesNotMatch(disarm, /permissions\.remove/, 'sleep must stop the work, not the permission');
  assert.doesNotMatch(workerSrc, /permissions\.remove/, 'the worker must never revoke a grant behind the tester');
});

/* ── the consent gate ──────────────────────────────────────────────────── */

console.log('\npermissions — the first-run notice');

await test('the welcome page is in the package', () => {
  for (const file of ['welcome/welcome.html', 'welcome/welcome.js']) {
    assert.ok(fs.existsSync(path.join(EXT, file)), `${file} is missing`);
  }
});

await test('it is opened once, on install, and not on an update', () => {
  const hook = workerSrc.slice(workerSrc.indexOf("'runtime.onInstalled › the welcome page'"));
  assert.match(hook.slice(0, 1100), /details\?\.reason !== 'install'/);
  assert.match(hook.slice(0, 1100), /openOwnPage\('welcome\/welcome\.html'\)/);
});

await test('accepting records when, and against which build', () => {
  assert.match(workerSrc, /UQA_CONSENT_ACCEPT: async \(\) => \{/);
  assert.match(workerSrc, /chrome\.storage\.local\.set\(\{ consentedAt, consentVersion, consentRevision: armed\.CONSENT_REVISION \}\)/);
});

await test('the popup opens closed and fails closed', () => {
  assert.ok(popupHtml.includes('data-consented="false"'), 'the popup starts by assuming consent was given');
  assert.match(popupJs, /paintConsent\(!!gotConsent\?\.ok && !!gotConsent\.result\.consented\)/);
});

await test('the gate hides the tools, not merely the switch', () => {
  const gate = popupCss.slice(popupCss.indexOf("body[data-consented='false']"));
  for (const hidden of ['.wake', '.scroll', '.tools', '.session-strip', '.pointer']) {
    assert.ok(gate.includes(hidden), `${hidden} is still shown before the notice is accepted`);
  }
});

await test('Tutorials stays reachable before consent, and Timeline does not', () => {
  const gate = popupCss.slice(popupCss.indexOf("body[data-consented='false']"));
  const rule = gate.slice(0, gate.indexOf('}'));
  assert.ok(rule.includes('#open-panel'), 'Timeline is offered before there is a session to see');
  assert.ok(!rule.includes('#open-tutorials'), 'Tutorials must stay reachable: it is what somebody reads first');
});

await test('Settings can show the notice again', () => {
  assert.ok(optionsHtml.includes('id="show-welcome"'));
  assert.match(optionsJs, /type: 'UQA_OPEN_WELCOME'/);
});

/* ── the administrator's switch ────────────────────────────────────────── */

console.log('\npermissions — what an administrator may decide');

await test('the schema declares hostPermissionsPolicy with its three values', () => {
  const key = schema.properties?.hostPermissionsPolicy;
  assert.ok(key, 'managed-schema.json has no hostPermissionsPolicy');
  assert.equal(key.type, 'string');
  assert.deepEqual(key.enum, ['ask', 'all', 'none']);
});

await test('the schema stays inside the subset Chrome refuses to load without', () => {
  // The full walk is tools/manifest-check.mjs. This is the one line that broke
  // the extension on 7 September 2026, asserted where npm test can see it.
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    assert.ok(!('required' in node), 'required is outside Chrome\'s policy-schema subset');
    assert.ok(
      !('additionalProperties' in node) || typeof node.additionalProperties === 'object',
      'a boolean additionalProperties stops the whole extension loading'
    );
    for (const child of Object.values(node.properties || {})) walk(child);
  };
  walk(schema);
});

await test('the default is ask, which is what an unmanaged machine gets', async () => {
  const { POLICY_DEFAULTS } = await import('../platform/policy.js'); // the registry moved there (T-068)
  assert.equal(POLICY_DEFAULTS.hostPermissionsPolicy, 'ask');
});

await test('a value nobody knows falls back to ask rather than to a dead button', async () => {
  const { normalisePolicy } = await import('../platform/policy.js');
  for (const bad of ['sometimes', '', 3, null, undefined]) assert.equal(normalisePolicy({ hostPermissionsPolicy: bad }).hostPermissionsPolicy, 'ask');
  for (const ok of ['ask', 'all', 'none']) assert.equal(normalisePolicy({ hostPermissionsPolicy: ok }).hostPermissionsPolicy, ok);
});

await test('"all" makes one press ask for everything', () => {
  const body = popupJs.slice(popupJs.indexOf('function requestSite('), popupJs.indexOf('/** Tell the worker'));
  assert.match(body, /siteAccess\.policy === 'all' \? '<all_urls>' : wanted/);
});

await test('"none" removes the request and says who decided', () => {
  const body = popupJs.slice(popupJs.indexOf('function requestSite('), popupJs.indexOf('/** Tell the worker'));
  assert.match(body, /siteAccess\.policy === 'none'/);
  assert.match(popupJs, /const blocked = [^\n]*siteAccess\.policy === 'none'/);
  assert.match(popupJs, /if \(blocked\) return \{ ok: false, error: tf\('popup\.access\.adminBlocked', 'An administrator has decided/);
});

await test('the policy is read, never written back into the tester\'s own settings', () => {
  // The rule platform/settings.js already holds for microphoneAllowed, restated
  // because a second policy key is the moment somebody adds a second exception.
  assert.match(settingsSrc, /delete next\.policy;/);
});

/* ── the headed suites, and how they get a grant a bubble cannot give ──── */

console.log('\npermissions — how the harnesses stand in for a tester');

await test('there is one helper that builds the granted copy, and three users of it', () => {
  assert.ok(fs.existsSync(path.join(EXT, 'tools/lib-granted.mjs')), 'tools/lib-granted.mjs is missing');
  for (const harness of ['tools/clickthrough.mjs', 'tools/diagnose.mjs', 'tools/recording.mjs']) {
    assert.match(read(harness), /from '\.\/lib-granted\.mjs'/, `${harness} runs against an extension with no site access`);
  }
});

await test('the granted copy differs from the shipped one by the permission and nothing else', () => {
  const src = read('tools/lib-granted.mjs');
  assert.match(src, /mf\.host_permissions = \['<all_urls>'\]/);
  assert.match(src, /delete mf\.optional_host_permissions/);
  assert.match(src, /copyShipping/, 'the copy must be built by the same routine that builds the package');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
