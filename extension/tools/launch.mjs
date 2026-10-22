/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Opens a browser with UQA loaded, ready to use, and keeps it open.
 *
 *   node tools/launch.mjs            # probes QAW_LAUNCH_HOSTS if set, else a demo page
 *   node tools/launch.mjs <url>      # start somewhere specific
 *
 * Uses its own persistent profile (.uqa-profile), so logins and UQA's own
 * sessions survive between launches. Close the window, or Ctrl+C here, to stop.
 * It never touches your normal Chrome.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PROFILE = profile('.uqa-profile');

// QAW_LAUNCH_HOSTS: optional comma-separated URLs to probe first (a staging site of yours); none by default
const HOSTS = (process.env.QAW_LAUNCH_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

/* A page with something worth testing, for when no host is reachable. */
const DEMO = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>QA Wrap demo — application form</title>
<style>
 body{font:15px/1.6 "Thmanyah Sans",sans-serif;margin:0;background:#f4f6f8;color:#1a1f27}
 .wrap{max-width:620px;margin:40px auto;background:#fff;padding:28px 32px;border-radius:12px;
       box-shadow:0 1px 3px rgba(16,24,40,.12)}
 h1{margin:0 0 4px;font-size:20px} p.sub{margin:0 0 22px;color:#6b7684;font-size:13px}
 label{display:block;margin:14px 0 4px;font-weight:600;font-size:13px}
 input,select,textarea{width:100%;padding:9px 11px;border:1px solid #c2cbd6;border-radius:8px;font:inherit}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 button{margin-top:22px;padding:10px 18px;border:0;border-radius:8px;background:#3b5bdb;color:#fff;
        font:inherit;font-weight:600;cursor:pointer}
 .clip{margin-top:22px;padding:8px 10px;border:1px solid #dbe1e8;border-radius:8px;height:38px;
       overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;color:#55606d}
 #out{margin-top:16px;font-size:13px;min-height:20px}
 .bad{color:#c92a2a;font-weight:600}
</style></head>
<body><div class="wrap">
 <h1>Application form</h1>
 <p class="sub">A demo page for trying QA Wrap. Submit fails on purpose.</p>

 <label for="applicant">Applicant name / اسم مقدم الطلب</label>
 <input id="applicant" name="applicant" type="text" maxlength="40" required />

 <div class="row">
  <div>
   <label for="nid">National ID / الرقم الوطني</label>
   <input id="nid" name="nationalId" type="text" maxlength="10" inputmode="numeric" />
  </div>
  <div>
   <label for="phone">Mobile / رقم الهاتف</label>
   <input id="phone" name="phone" type="tel" />
  </div>
 </div>

 <div class="row">
  <div>
   <label for="issued">Issue date / تاريخ الإصدار</label>
   <input id="issued" name="issued" type="date" />
  </div>
  <div>
   <label for="qty">Quantity / الكمية</label>
   <input id="qty" name="quantity" type="number" min="1" max="500" />
  </div>
 </div>

 <label for="pw">Password / كلمة المرور</label>
 <input id="pw" name="password" type="password" />

 <label for="notes">Notes / ملاحظات</label>
 <textarea id="notes" name="notes" rows="3"></textarea>

 <div class="clip">This container clips its content, so it lights up under layout stress once the text grows.</div>

 <button id="submit" type="button">Submit application</button>
 <div id="out"></div>
</div>
<script>
 document.getElementById('submit').addEventListener('click', async () => {
   const out = document.getElementById('out');
   out.textContent = 'Submitting…';
   try {
     const res = await fetch('/api/applications', { method: 'POST', body: '{}' });
     if (!res.ok) console.error('Submit failed: ' + res.status);
     out.innerHTML = res.ok ? 'Submitted.' : '<span class="bad">Submission failed (' + res.status + ')</span>';
   } catch (e) {
     console.error('Submit threw', e);
     out.innerHTML = '<span class="bad">Could not reach the server</span>';
   }
 });
</script>
</body></html>`;

async function reachable(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let target = process.argv[2] || null;
let server = null;

if (!target) {
  for (const host of HOSTS) {
    process.stdout.write(`probing ${new URL(host).host} … `);
    if (await reachable(host)) {
      console.log('up');
      target = host;
      break;
    }
    console.log('unreachable');
  }
}

if (!target) {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"NullPointerException at ApplicationService.submit"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(DEMO);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  target = `http://127.0.0.1:${server.address().port}/`;
  console.log('no host reachable — serving the demo form instead');
}

// Chrome would otherwise keep running a worker cached from a previous build.
if (purgeWorkerCache(PROFILE)) console.log('cleared the cached service worker so the current build loads');

const context = await chromium.launchPersistentContext(PROFILE, {
  ...launchOptions(EXT, { headed: true, width: 1400, height: 940 }),
  viewport: null, // let the window size drive the page, not a fixed viewport
});

const worker = await freshWorker(context);
const id = new URL(worker.url()).host;

const page = context.pages()[0] || (await context.newPage());
await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {});

// Read the bindings that are actually in force rather than printing a guess.
let keys = { pick: 'Alt+S', inject: 'Alt+E', rtl: 'Alt+D', note: 'Alt+N', a11y: 'Alt+A' };
try {
  const [worker2] = context.serviceWorkers();
  const live = await worker2.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    return settings?.keymap || null;
  });
  if (live) {
    const pretty = (b) =>
      !b ? 'unset'
        : b.split('+').map((p) => (p.startsWith('Key') ? p.slice(3) : p.startsWith('Digit') ? p.slice(5) : p)).join('+');
    keys = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, pretty(v)]));
  }
} catch {
  /* defaults are fine */
}

console.log(`
────────────────────────────────────────────────────────────
 QA Wrap is loaded and running.   extension id: ${id}
 Page: ${target}

 FIRST: click the puzzle-piece icon in the toolbar and pin QA Wrap,
        so its button is always visible.

 THEN:
   1. Click the QA Wrap icon.
   2. Type what you are testing, pick a time-box, Start recording.
   3. Use the page. Your current shortcuts:
        ${(keys.pick || 'unset').padEnd(12)} click any element → Playwright locator copied
        ${(keys.inject || 'unset').padEnd(12)} click a field    → edge-case values for THAT field
        ${(keys.rtl || 'unset').padEnd(12)} flip to RTL and grow every label
        ${(keys.note || 'unset').padEnd(12)} quick note (tag it bug / issue / question)
        ${(keys.a11y || 'unset').padEnd(12)} accessibility scan
      Change any of them: Settings, at the bottom of the popup.
      "Break the next request" is in the popup — arm it, then Submit.
   4. Press F12 and open the QA Wrap tab for the live timeline.
   5. Stop, then export.

 Every failure, traced.
 Everything stays on this machine. Nothing is uploaded.
 Close the window, or press Ctrl+C here, to finish.
────────────────────────────────────────────────────────────
`);

context.on('close', () => {
  server?.close();
  console.log('Browser closed.');
  process.exit(0);
});

await new Promise(() => {});
