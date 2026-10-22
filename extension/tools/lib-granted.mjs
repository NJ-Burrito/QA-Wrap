/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A copy of this extension that a tester has already said yes to.
 *
 * ── the problem, measured ─────────────────────────────────────────────────
 *
 * Since decision 8 of `research/56-decisions-2026-09-07.md`, QA Wrap installs
 * with access to no website at all: `<all_urls>` is an optional host permission
 * and the popup's Wake button asks for the site the tester is on. Every headed
 * suite drives a real browser against a real fixture page, and in that browser
 * nobody has answered that question.
 *
 * It cannot be answered from a harness. `chrome.permissions.request` is
 * answered by a bubble the **browser** draws, not any page, and there is no
 * element for Playwright to click — `tools/recording.mjs` measured exactly that
 * for `desktopCapture` in September 2026: the request sat unanswered for
 * forty-five seconds.
 *
 * ── what this does instead, and why it is honest ──────────────────────────
 *
 * The same trick `recording.mjs` already used for the screen permission, now in
 * one place because three suites need it: build a copy of the package with the
 * permission moved from the optional list into the required one, which is
 * precisely the state a tester's browser is in one press after they grant it.
 *
 * **That manifest line is the only difference.** The files are copied by
 * `copyShipping()`, the very routine that builds the store zip, so the recorder,
 * the offscreen document, the popup and the content scripts under test are the
 * shipping ones byte for byte. The runtime path is exercised in full: with
 * `<all_urls>` held, `chrome.permissions.getAll()` answers `['<all_urls>']` and
 * `background/site-access.js` registers the page scripts from that, exactly as
 * it would after a real grant. Nothing is stubbed and no code path is skipped.
 *
 * What it deliberately does **not** prove is the bubble itself: that a tester's
 * press produces a dialog and that answering it grants the origin. Chrome owns
 * both, they are asserted from the source in `tools/test-permissions.mjs`, and
 * a suite that could click a browser dialog would be testing Chrome.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shipping, copyShipping } from './lib-ship.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build the copy and answer where it is.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.desktopCapture] also promote the screen-capture
 *   permission, which `tools/recording.mjs` needs for the browser that records
 *   a screen and no other suite does.
 * @param {string} [opts.label] a word in the directory name, so two suites
 *   running at once do not share one.
 */
export function grantedExtension({ desktopCapture = false, label = 'granted' } = {}) {
  const dir = path.join(os.tmpdir(), `uqa-${label}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of shipping(fs.readdirSync(EXT))) {
    copyShipping(path.join(EXT, entry), path.join(dir, entry));
  }

  const file = path.join(dir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The one line. `host_permissions` is what a granted `<all_urls>` looks like
  // from inside the extension, and leaving the optional list behind as well
  // would be a manifest Chrome warns about.
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_host_permissions;
  if (desktopCapture) {
    mf.permissions = [...mf.permissions, 'desktopCapture'];
    mf.optional_permissions = (mf.optional_permissions || []).filter((n) => n !== 'desktopCapture');
  }
  fs.writeFileSync(file, JSON.stringify(mf, null, 2));
  return dir;
}

/**
 * Wait until the page scripts are registered, before anything navigates.
 *
 * The scripts that used to be declared in `manifest.json` are registered by the
 * worker at boot, from the granted origins, and a registration reaches the
 * **next** navigation and no other. A harness that opens its fixture in the
 * same tick as the worker's first breath therefore loads a page with no
 * `document_start` scripts in it, and every assertion about masking, replay or
 * the page map fails with "nothing happened" — measured on 8 September 2026,
 * three failures in `tools/clickthrough.mjs` that were a race and read as three
 * broken features.
 *
 * A tester never sees this: the registration is `persistAcrossSessions`, so it
 * is already in place on every browser start after the first, and the first is
 * repaired by `injectSiteScripts()`. This is the harness standing where a warm
 * browser already stands.
 *
 * @param {import('playwright').Worker} worker the extension's service worker
 */
export async function awaitSiteScripts(worker, { timeout = 10_000 } = {}) {
  const started = Date.now();
  for (;;) {
    const ids = await worker
      .evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)))
      .catch(() => []);
    if (ids.includes('uqa-site-start')) return ids; // T-075: only the cheap start script is registered asleep
    if (Date.now() - started > timeout) {
      throw new Error(
        'the page scripts were never registered. background/site-access.js registers them from ' +
          `chrome.permissions.getAll(); the worker reported [${ids.join(', ')}].`
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Record the first-run consent, the way pressing "I understand" does.
 *
 * The notice gates the whole popup — `body[data-consented='false']` hides the
 * switch and every tool — so a harness that skipped this would drive a popup
 * with nothing on it and report a hundred missing controls rather than the one
 * missing fact. Written through the service worker because that is the context
 * that owns `chrome.storage.local` for this extension.
 *
 * The keys and their meaning are `UQA_CONSENT_ACCEPT`'s, which is what the
 * button in `welcome/welcome.js` calls; this is the same write, made without a
 * page to click.
 *
 * @param {import('playwright').Worker} worker the extension's service worker
 */
export async function seedConsent(worker) {
  return worker.evaluate(() =>
    chrome.storage.local.set({
      consentedAt: Date.now(),
      consentVersion: chrome.runtime.getManifest().version,
    })
  );
}
