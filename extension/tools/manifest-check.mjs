/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Read the warnings Chrome itself puts on the extension.
 *
 * A warning label on chrome://extensions is the first thing anyone sees, and it
 * undermines every claim the extension makes about carefulness — but nothing in
 * the test suites could see one, because a warning does not stop the extension
 * working. It sat there for a version while every suite was green.
 *
 * Two ways to read it and both are used, because they catch different things:
 *
 *   **Chrome's own stderr.** Loading an unpacked extension logs every manifest
 *   complaint. This catches the ones that happen before the extensions page
 *   renders anything.
 *
 *   **The extensions page.** `chrome://extensions` is a Polymer app built from
 *   open shadow roots, and Playwright's CSS engine pierces those, so the warning
 *   text can be read straight off the card the user is looking at.
 *
 *   node tools/manifest-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* T-069: `--ext <dir>` checks a built flavour (dist/chrome-managed) instead of the source tree. */
const argv = process.argv.slice(2);
const EXT = argv.includes('--ext') ? path.resolve(argv[argv.indexOf('--ext') + 1]) : path.resolve(HERE, '..');
const PROFILE = profile('.manifest-check-profile');

/* ── the limits Chrome enforces quietly ───────────────────────────────── */

const LIMITS = [
  { key: 'name', max: 75 },
  { key: 'short_name', max: 12 },
  { key: 'description', max: 132 },
  { key: 'version_name', max: 132 },
];

/**
 * Permissions Chrome refuses to make optional.
 *
 * Kept here rather than remembered, because the failure is a warning nobody
 * reads and a feature that silently cannot be granted at runtime.
 */
const NEVER_OPTIONAL = new Set([
  'debugger',
  'declarativeNetRequest',
  'devtools',
  'experimental',
  'geolocation',
  'mdns',
  'proxy',
  'tts',
  'ttsEngine',
  'wallpaper',
]);

const problems = [];
/*
 * What the browser said, kept apart from what the file said.
 *
 * The static half prints before the browser is even launched, so anything the
 * browser finds needs its own list or it is counted in the total and never
 * printed — which is how a "2 problems" line came to name only one of them.
 */
const loadProblems = [];
const notes = [];

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

for (const { key, max } of LIMITS) {
  const value = manifest[key];
  if (typeof value === 'string' && value.length > max) {
    problems.push(`"${key}" is ${value.length} characters; Chrome truncates and warns past ${max}.`);
  }
}

if (manifest.author !== undefined && (typeof manifest.author !== 'object' || !manifest.author.email)) {
  problems.push('"author" must be an object with an "email" in MV3. A string warns.');
}

for (const p of manifest.optional_permissions || []) {
  if (NEVER_OPTIONAL.has(p)) {
    problems.push(
      `"${p}" cannot be an optional permission — Chrome rejects it and warns. ` +
        'Either declare it up front, or drop the feature that needs it.'
    );
  }
}

/* Files the manifest names must exist, or Chrome warns about each one. */
const referenced = [
  manifest.background?.service_worker,
  manifest.devtools_page,
  manifest.options_ui?.page,
  manifest.action?.default_popup,
  ...Object.values(manifest.action?.default_icon || {}),
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
];
for (const rel of referenced.filter(Boolean)) {
  if (!fs.existsSync(path.join(EXT, rel))) problems.push(`manifest names "${rel}", which is not there.`);
}

/**
 * At most four commands may carry a suggested key.
 *
 * Chrome refuses to load the whole extension past that — "Too many shortcuts
 * specified for 'commands': The maximum is 4" — and refuses it at *load*, so
 * the first thing that happens is a modal and an extension that is simply not
 * there. Every other check here passed on the manifest that did it.
 */
const suggested = Object.entries(manifest.commands || {}).filter(([, c]) => c.suggested_key);
if (suggested.length > 4) {
  problems.push(
    `${suggested.length} commands carry a suggested_key (${suggested.map(([n]) => n).join(', ')}); ` +
      'Chrome allows 4 and refuses to load the extension at all past that. ' +
      'Drop the key from the least-used one — the command still works, bound at chrome://extensions/shortcuts.'
  );
}

/**
 * The six tools that must not go back into every page.
 *
 * They were declared `content_scripts` on `<all_urls>` with `all_frames: true`,
 * which put 63 KB of JavaScript into every frame of every page a person opened
 * whether or not this extension had ever been woken in that window. The worker
 * puts them in on first use instead (`background/service-worker.js ON_DEMAND`),
 * and there is no way to see from the manifest that this was deliberate. So it
 * is written down here: adding one of these back to `content_scripts` fails
 * this check, and the fix is to route the feature through `sendToFeature()`.
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
const declared = new Set((manifest.content_scripts || []).flatMap((c) => c.js || []));
for (const file of ON_DEMAND) {
  if (declared.has(file)) {
    problems.push(
      `"${file}" is declared as a content script again. It is injected on first use by ` +
        'the worker (see ON_DEMAND in background/service-worker.js); declaring it puts it ' +
        'back into every frame of every page while the extension is asleep.'
    );
  }
  if (!fs.existsSync(path.join(EXT, file))) {
    problems.push(`"${file}" is injected on demand but is not in the package.`);
  }
}

/**
 * The MAIN-world hooks, which must not be declared at all.
 *
 * `content/page-hooks.js` patches `fetch` and `XMLHttpRequest` in the page's
 * own JavaScript context, at `document_start`, on `<all_urls>`, in every frame.
 * Declared here it does that on every page anybody opens, awake or asleep —
 * inert behind a boolean, but present, which is not what "asleep means the
 * extension cannot see, modify or work in any way" says.
 *
 * `background/armed.js` registers it with `chrome.scripting` when the first
 * window is woken and unregisters it when the last one sleeps, refcounted, and
 * `persistAcrossSessions: false` so a browser restart starts with nothing in
 * any page. Putting it back in the manifest silently undoes all of that, and
 * nothing else would notice.
 */
if (declared.has('content/page-hooks.js')) {
  problems.push(
    '"content/page-hooks.js" is declared as a content script again. It is registered while ' +
      'at least one window is awake and unregistered when the last one sleeps (see armed.js ' +
      'HOOKS_ID); declaring it patches fetch and XHR in every page while the extension is asleep.'
  );
}
if (!fs.existsSync(path.join(EXT, 'content/page-hooks.js'))) {
  problems.push('"content/page-hooks.js" is registered at wake time but is not in the package.');
}

/**
 * The managed-storage schema, validated against the subset Chrome accepts.
 *
 * ── the failure this exists to make impossible ────────────────────────────
 *
 * `storage.managed_schema` names a JSON Schema that Chrome parses with its own
 * policy-schema reader, not with a general JSON Schema library, and that reader
 * accepts a much smaller language. Give it something outside the subset and
 * Chrome does not warn, does not disable the feature, and does not mention the
 * schema: it refuses to load the entire extension, with
 *
 *     Failed to load extension from <path>.
 *     Invalid type for attribute 'additionalProperties'
 *
 * That happened on 7 September 2026, from one line — `"additionalProperties":
 * false`, which is ordinary JSON Schema and is not in Chrome's subset, because
 * the reader expects a schema *object* there and a boolean has no type. Every
 * other check in this file passed on that tree, `npm test` was green, and the
 * only symptom was a dialog on every reload.
 *
 * ── the subset, from Chrome's policy templates ────────────────────────────
 *
 * Types: object, array, string, integer, number, boolean.
 * Keywords: type, properties, items, additionalProperties (as a schema object),
 * title, description, id, $ref (only within the same document, and avoided
 * here), enum (strings or integers), pattern, minimum, maximum.
 *
 * What is checked below is the shape that actually broke, plus the neighbours
 * that would break the same way: a boolean `additionalProperties`, a type
 * Chrome does not know, and `required` as an array, which draft-04 puts on the
 * object and Chrome's draft-03 reader does not accept.
 */
if (manifest.storage?.managed_schema) {
  const rel = manifest.storage.managed_schema;
  const abs = path.join(EXT, rel);
  if (!fs.existsSync(abs)) {
    problems.push(`"storage.managed_schema" names "${rel}", which is not there. Chrome refuses to load the extension at all.`);
  } else {
    const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean']);
    let schema = null;
    try {
      schema = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      problems.push(`"${rel}" is not valid JSON: ${err.message}. Chrome refuses to load the extension at all.`);
    }

    const walkSchema = (node, where) => {
      if (!node || typeof node !== 'object') return;
      if (node.type !== undefined && !TYPES.has(node.type)) {
        problems.push(
          `"${rel}" ${where}: type "${node.type}" is not one of ${[...TYPES].join(', ')}. ` +
            'Chrome refuses to load the whole extension over this, with no mention of the schema.'
        );
      }
      if ('additionalProperties' in node && typeof node.additionalProperties !== 'object') {
        problems.push(
          `"${rel}" ${where}: "additionalProperties" must be a schema object such as {"type": "string"}, ` +
            `not ${JSON.stringify(node.additionalProperties)}. This is the line that produced ` +
            'Invalid type for attribute "additionalProperties", and stopped the extension loading.'
        );
      }
      for (const banned of ['required', '$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'definitions', '$defs']) {
        if (banned in node) {
          problems.push(`"${rel}" ${where}: "${banned}" is outside the subset Chrome's policy reader accepts.`);
        }
      }
      if (node.enum && node.enum.some((v) => typeof v !== 'string' && !Number.isInteger(v))) {
        problems.push(`"${rel}" ${where}: "enum" may hold only strings or integers.`);
      }
      for (const [name, child] of Object.entries(node.properties || {})) walkSchema(child, `${where} > ${name}`);
      if (node.items) walkSchema(node.items, `${where} > items`);
      if (typeof node.additionalProperties === 'object') {
        walkSchema(node.additionalProperties, `${where} > additionalProperties`);
      }
    };

    if (schema) {
      if (schema.type !== 'object') {
        problems.push(`"${rel}" must have "type": "object" at its root; Chrome's reader requires it.`);
      }
      walkSchema(schema, 'root');
    }
  }
}

console.log('— static check —');
if (problems.length) problems.forEach((p) => console.log(`  FAIL  ${p}`));
else console.log('  ok    nothing the manifest rules forbid');

/* ── what Chrome actually says ────────────────────────────────────────── */

console.log('\n— what Chrome says when it loads it —');

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
let chromeWarnings = [];

try {
  const page = await context.newPage();
  await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // The extensions page is Polymer, built from open shadow roots. Playwright's
  // CSS engine pierces those, so the card the user is looking at is readable.
  await page.evaluate(() => {
    const toggle = document
      .querySelector('extensions-manager')
      ?.shadowRoot?.querySelector('extensions-toolbar')
      ?.shadowRoot?.querySelector('#devMode');
    if (toggle && !toggle.checked) toggle.click();
  });
  await page.waitForTimeout(600);

  /*
   * Is it there at all?
   *
   * This check read the warnings on the card and nothing else, so the one
   * failure it could not see was the extension **not loading**. That happened
   * on 7 September 2026: a `managed-schema.json` outside Chrome's policy subset
   * made Chrome refuse the whole package with a modal dialog, and this suite
   * reported "Chrome shows no warning on the card" — perfectly true, because
   * there was no card. Nader saw the dialog on every reload while every suite
   * was green.
   *
   * An extension that is absent, disabled, or carrying an Errors control is now
   * the loudest failure here rather than the invisible one.
   */
  const card = await page.evaluate((wanted) => {
    const manager = document.querySelector('extensions-manager')?.shadowRoot;
    const list = manager?.querySelector('extensions-item-list')?.shadowRoot;
    const items = [...(list?.querySelectorAll('extensions-item') || [])];
    const names = items.map((i) => i.shadowRoot?.querySelector('#name')?.textContent?.trim() || '');
    const mine = items.find((i) => (i.shadowRoot?.querySelector('#name')?.textContent || '').includes(wanted));
    if (!mine) return { present: false, names };
    const root = mine.shadowRoot;
    return {
      present: true,
      names,
      // Chrome puts an "Errors" button on a card whose extension failed to load
      // or is throwing at runtime.
      errors: !!root.querySelector('#errors-button, #errorsButton'),
      enabled: root.querySelector('#enableToggle')?.checked !== false,
    };
  }, manifest.name);

  if (!card.present) {
    loadProblems.push(
      `Chrome did not load the extension at all. The cards on the page are: ${card.names.join(', ') || '(none)'}. ` +
        'A manifest or a file it names is invalid; Chrome refuses the whole package rather than warning about it. ' +
        'Load it by hand at chrome://extensions to read the dialog.'
    );
  } else {
    if (card.errors) loadProblems.push('The card carries an Errors button: Chrome has something to say about this build.');
    if (!card.enabled) loadProblems.push('The extension loaded but is disabled.');
  }

  chromeWarnings = await page.evaluate(() => {
    const out = [];
    const manager = document.querySelector('extensions-manager')?.shadowRoot;
    const list = manager?.querySelector('extensions-item-list')?.shadowRoot;
    for (const item of list?.querySelectorAll('extensions-item') || []) {
      const root = item.shadowRoot;
      const name = root?.querySelector('#name')?.textContent?.trim();
      const warnings = root?.querySelector('#warnings');
      if (!warnings) continue;
      const text = warnings.textContent.replace(/\s+/g, ' ').trim();
      if (text) out.push({ name, text });
    }
    return out;
  });

  if (!chromeWarnings.length) {
    // The card only shows a summary; the detail view carries the full text.
    const detail = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager')?.shadowRoot;
      const detail = manager?.querySelector('extensions-detail-view')?.shadowRoot;
      return detail?.querySelector('#warnings')?.textContent?.replace(/\s+/g, ' ').trim() || null;
    });
    if (detail) chromeWarnings.push({ name: 'detail view', text: detail });
  }

  await page.close();
} catch (err) {
  notes.push(`could not read chrome://extensions — ${err.message}`);
} finally {
  await context.close();
}

loadProblems.forEach((p) => console.log(`  FAIL  ${p}`));
if (chromeWarnings.length) {
  chromeWarnings.forEach((w) => console.log(`  FAIL  ${w.name}: ${w.text}`));
} else if (loadProblems.length) {
  /* already said, and louder */
} else if (notes.length) {
  notes.forEach((n) => console.log(`  note  ${n}`));
} else {
  console.log('  ok    Chrome shows no warning on the card');
}

const failed = problems.length + chromeWarnings.length + loadProblems.length;
console.log(`\n${failed ? `${failed} manifest problem(s)` : 'the manifest is clean'}\n`);
process.exit(failed ? 1 : 0);
