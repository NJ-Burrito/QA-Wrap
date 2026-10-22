/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Screenshot a local html file in both themes. Own profile, own handle. */
import path from 'node:path'; import http from 'node:http'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
import { profile } from './lib-paths.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [file, outDir] = process.argv.slice(2);
const body = fs.readFileSync(file, 'utf8');
const html = /^\s*<!doctype/i.test(body) ? body
  : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${body}`;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(profile('.shot-profile'), {
  headless: true, args: ['--no-first-run', '--no-default-browser-check'], viewport: { width: 1280, height: 900 },
});
fs.mkdirSync(outDir, { recursive: true });
for (const scheme of ['light', 'dark']) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, `${scheme}-top.png`) });
  await page.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${scheme}-mid.png`) });
  await page.close();
}
await context.close(); server.close();
console.log('shots in ' + outDir);
