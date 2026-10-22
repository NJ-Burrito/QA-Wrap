/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Guarantee the loaded service worker is the code on disk.
 *
 * Chrome caches an extension's registered service worker inside the profile and
 * will happily keep running it after the files on disk change. The popup and
 * content scripts are read fresh, so you end up with today's UI talking to
 * yesterday's backend: blank controls, no recording, no exports, and messages
 * dying with "the message port closed". It is the single most confusing failure
 * this project has produced, so the tooling refuses to run into it.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Remove the cached service-worker scripts from a profile.
 *
 * Only the script cache is touched — cookies, storage and the UQA database are
 * left exactly as they are, which is the point: we want the real profile state
 * with the current code.
 */
export function purgeWorkerCache(profileDir) {
  const targets = [
    path.join(profileDir, 'Default', 'Service Worker'),
    path.join(profileDir, 'Service Worker'),
  ];
  let removed = 0;
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  return removed > 0;
}

/**
 * Build a fresh profile that carries only the extension's DATA.
 *
 * Purging the worker cache from a copied profile was not enough — Chrome still
 * revived the old registration. Rather than fight it, start from an empty
 * profile (so the code is unambiguously current) and bring across just the
 * IndexedDB and extension storage. That is what makes the database upgrade path
 * testable, which was the whole point of running against real data.
 */
export function seedProfileData(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  if (!fs.existsSync(from)) return false;

  const carry = [
    ['Default', 'IndexedDB'],
    ['Default', 'Local Extension Settings'],
    ['Default', 'Local Storage'],
  ];
  let copied = 0;
  for (const parts of carry) {
    const src = path.join(from, ...parts);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(to, ...parts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    copied++;
  }
  return copied > 0;
}

export async function freshWorker(context, { timeout = 20_000 } = {}) {
  const expected = await (async () => {
    let w = context.serviceWorkers()[0];
    if (!w) w = await context.waitForEvent('serviceworker', { timeout });
    return w.evaluate(() => chrome.runtime.getManifest().version);
  })();

  const build = (w) => w.evaluate(() => globalThis.__UQA_BUILD ?? null).catch(() => null);

  const findCurrent = async () => {
    for (const w of context.serviceWorkers()) {
      if ((await build(w)) === expected) return w;
    }
    return null;
  };

  let current = await findCurrent();
  if (current) return current;

  console.log(`  stale worker detected (expected build ${expected}) — reloading the extension`);
  const first = context.serviceWorkers()[0];
  // An unpacked extension is DISABLED by a reload while developer mode is off,
  // so switch it on first (as test-boot-smoke does).
  const mgr = await context.newPage();
  try {
    await mgr.goto('chrome://extensions');
    await mgr.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  } catch { /* the reload below still runs; the error message names the state */ } finally {
    await mgr.close().catch(() => {});
  }
  await first?.evaluate(() => chrome.runtime.reload()).catch(() => {});

  // Poll every worker the context knows about; a reload can produce a new
  // registration that waitForEvent does not always surface.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    current = await findCurrent();
    if (current) return current;
  }

  throw new Error(
    `The service worker is still not on build ${expected} after a reload.\n` +
      '  Delete the profile\'s "Default/Service Worker" directory (purgeWorkerCache) and relaunch,\n' +
      '  or reload the extension by hand at chrome://extensions.'
  );
}
