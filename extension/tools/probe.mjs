/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Focused probe: run code inside the service worker and report exactly what
 * happens. Used to pin down a failure the feature tests cannot see.
 *
 *   node tools/probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const LIVE = profile('.uqa-profile');
const PROFILE = profile('.probe-profile');

fs.rmSync(PROFILE, { recursive: true, force: true });
if (fs.existsSync(LIVE)) fs.cpSync(LIVE, PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 900, height: 700 },
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  worker.on('console', (m) => console.log(`  [sw ${m.type()}] ${m.text()}`));

  console.log('\n1. database version and indexes');
  console.log(
    JSON.stringify(
      await worker.evaluate(
        () =>
          new Promise((resolve) => {
            const req = indexedDB.open('uqa');
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction('events', 'readonly');
              resolve({
                version: db.version,
                stores: [...db.objectStoreNames],
                eventIndexes: [...tx.objectStore('events').indexNames],
              });
            };
            req.onerror = () => resolve({ error: String(req.error) });
          })
      ),
      null,
      2
    )
  );

  console.log('\n2. does chrome.storage.sync answer at all?');
  console.log(
    JSON.stringify(
      await worker.evaluate(async () => {
        const out = {};
        out.syncExists = typeof chrome.storage.sync !== 'undefined';
        out.localExists = typeof chrome.storage.local !== 'undefined';
        try {
          const settled = await Promise.race([
            chrome.storage.sync.get(null).then(() => 'resolved'),
            new Promise((r) => setTimeout(() => r('TIMED OUT after 3s'), 3000)),
          ]);
          out.syncGetNull = settled;
        } catch (e) {
          out.syncGetNull = 'threw: ' + e.message;
        }
        try {
          const settled = await Promise.race([
            chrome.storage.sync.get('settings').then((v) => 'resolved: ' + JSON.stringify(v).slice(0, 80)),
            new Promise((r) => setTimeout(() => r('TIMED OUT after 3s'), 3000)),
          ]);
          out.syncGetKey = settled;
        } catch (e) {
          out.syncGetKey = 'threw: ' + e.message;
        }
        return out;
      }),
      null,
      2
    )
  );

  console.log('\n3. what does the UQA_GET_SETTINGS handler actually do?');
  const page = await context.newPage();
  const id = new URL(worker.url()).host;
  await page.goto(`chrome-extension://${id}/popup/popup.html`);
  console.log(
    JSON.stringify(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ result: 'NO RESPONSE after 5s' }), 5000);
            chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => {
              clearTimeout(timer);
              resolve({
                lastError: chrome.runtime.lastError?.message || null,
                res: res ? JSON.stringify(res).slice(0, 200) : String(res),
              });
            });
          })
      ),
      null,
      2
    )
  );
} finally {
  await context.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
}
