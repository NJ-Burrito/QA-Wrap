/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The page the films are shot on.
 *
 * A permits portal with one form and one submit that fails on purpose. It is
 * the same fixture the suites already drive — `tools/clickthrough.mjs` and
 * `tools/recording.mjs` both serve a form over `http://127.0.0.1` and break
 * `/api/` from the server side — with three differences the film needs:
 *
 *   1. **A fixed port.** The bible (5.1) asks that every recorded page's
 *      origin be assertable, and an assertion against a port that changes
 *      every run is an assertion against nothing. `UQA_FILM_PORT` moves it.
 *   2. **A stubbed 200 path.** Shot 3 of the commercial is the same form
 *      submitting successfully, which is what makes the bug a story nobody can
 *      check. `succeed()` and `fail()` flip it from the driver, in process, so
 *      the film never has to reload a different page to change the answer.
 *   3. **A failure the page does not announce, read by what is missing.**
 *      Nader's ruling, and the stronger story. The page promises a reference
 *      number at the top: "All fields are required. You will receive a
 *      reference number." So a submit that works issues one, in the page's own
 *      style, and a submit that fails issues nothing at all: the button goes
 *      busy and returns to idle, the form stays exactly as it was, no red text
 *      and no toast. The failure is legible as the absence of the thing the
 *      page promised, which is how a real one reads. The 500 is still on the
 *      wire and the console line is still written, because the console is not
 *      in frame.
 *   4. **Three honest faults.** The Quality tab filmed empty on the first
 *      capture: a clean four-field form gives axe-core nothing to find, so the
 *      frame read "0 issues found across 0 rules" and the bible's "real counts"
 *      were zero. A staging portal that is perfect is not a realistic subject
 *      for a testing tool, so the fixture now carries one unlabelled control,
 *      one piece of low-contrast text and one dead link. They are named in
 *      `FAULTS` below, they are the only faults, and every count the films show
 *      is a real count of them.
 *   5. **A fixed synthetic person list.** Every value the camera ever sees
 *      comes from `PEOPLE` below. Nothing is read from the machine, generated
 *      at random, or typed by hand into a step file. `film/record/safety.mjs`
 *      is allowed to find these strings in a frame and nothing else, which is
 *      only a meaningful guarantee because the list is right here, committed,
 *      and short enough to read.
 *
 * Run it on its own to look at the page:
 *
 *   node tools/film/record/fixture.mjs
 */
import http from 'node:http';
import { PRODUCT } from '../../../core/product.js';

/**
 * The only people who ever appear on camera.
 *
 * Invented, and deliberately not the name of anybody on this project. The
 * masking beat covers one of them, which is the film's own privacy proof: the
 * product is shown doing the thing this pipeline separately guarantees, and
 * nothing real was ever on the machine to hide.
 */
export const PEOPLE = [
  { name: 'Layla Haddad', email: 'layla.haddad@example.com' },
  { name: 'Faris Nabulsi', email: 'faris.nabulsi@example.com' },
  { name: 'Rana Qudah', email: 'rana.qudah@example.com' },
];

/** What the form is filled with, every take, in every film. */
export const APPLICATION = {
  applicant: PEOPLE[0].name,
  email: PEOPLE[0].email,
  quantity: '40',
  country: 'Jordan',
};

/** Everything a frame is allowed to contain that looks like a person. */
export const ALLOWED_STRINGS = [
  ...PEOPLE.flatMap((p) => [p.name, p.email, ...p.name.split(' ')]),
  'example.com',
  'Permits portal',
  'Food import permit',
  /* The product's own published support mailbox. It is printed in the popup's
     Settings, so any shot of that surface carries it; it is a company address
     in the shipping build, not a person or this machine. Read from
     `core/product.js` so it cannot drift from what the product shows. */
  PRODUCT.supportEmail,
];

export const DEFAULT_PORT = Number(process.env.UQA_FILM_PORT || 8973);

/**
 * The faults the page carries on purpose, so every count on screen is real.
 *
 * Listed here rather than left to be discovered in the markup, because a film
 * that shows "3 issues" has to be able to say which three.
 */
export const FAULTS = [
  'a reference field with no label, so a screen reader cannot name it',
  'a low-contrast help line under the quantity field, below 4.5:1',
  'a Downloads link in the header that answers 404',
];

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Permits portal</title>
<style>
 body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1f2328;background:#fff}
 header{background:#0f2436;color:#fff;padding:15px 34px;font-weight:700;display:flex;gap:22px;align-items:center}
 header nav a{color:#fff;opacity:.75;text-decoration:none;font-weight:500;font-size:14px;margin-inline-start:14px}
 main{max-width:600px;margin:40px auto;padding:0 24px}
 h1{font-size:27px;margin:0 0 6px} p.sub{color:#666;margin:0 0 24px}
 label{display:block;font-weight:600;margin:15px 0 4px;font-size:14px}
 input,select{width:100%;padding:11px 12px;border:1px solid #c9ced6;border-radius:8px;font:inherit;background:#fff;color:inherit}
 button{margin-top:22px;background:#0f2436;color:#fff;border:0;border-radius:8px;padding:13px 22px;font:inherit;font-weight:700;cursor:pointer}
 /* Kept only so the form's height does not jump when a submit settles. It is
    never given text: the page does not announce a failure. */
 .note{margin-top:14px;color:#a11;font-weight:600;min-height:22px}
 /* The promise the page makes at the top, kept. Its own style, not an alert. */
 .receipt{margin-top:16px;padding:14px 16px;border:1px solid #c9ced6;border-radius:8px;background:#f6f8fa}
 .receipt b{display:block;font-size:15px;margin-bottom:3px}
 .receipt span{color:#555;font-size:14px}
 /* Deliberately below 4.5:1 on white. One of the three faults in FAULTS. */
 .faint{color:#b9bec6;font-size:13px;margin:6px 0 0}
</style></head><body>
<header><b>Permits portal</b><nav><a href="/help">Help</a><a href="/status">Status</a><a href="/forms/2019.pdf">Downloads</a></nav></header>
<main>
  <h1>Apply for a food import permit</h1>
  <p class="sub">All fields are required. You will receive a reference number.</p>
  <form onsubmit="return false">
    <label for="applicant">Applicant name</label><input id="applicant" required maxlength="40">
    <label for="email">Email</label><input id="email" type="email" required>
    <label for="quantity">Quantity (kg)</label><input id="quantity" type="number" min="1" max="500" required>
    <p class="faint">Whole kilograms only. Decimals are rounded down.</p>
    <input id="reference" type="text" placeholder="Reference (optional)">
    <label for="country">Country of origin</label><select id="country" required><option value="">Choose</option><option>Jordan</option><option>Egypt</option></select>
    <button id="submit" type="button">Submit application</button>
    <div class="note" id="note"></div>
    <div class="receipt" id="receipt" hidden></div>
  </form>
</main>
<script>
document.getElementById('submit').onclick = async () => {
  /* The busy state, and nothing else. A failure this page does not announce is
     the point: the button goes busy and settles, the form stays exactly as it
     was, and the only places the 500 shows are the wire and QA Wrap. */
  const btn = document.getElementById('submit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting\\u2026';
  const r = await fetch('/api/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  btn.disabled = false;
  btn.textContent = label;
  const out = document.getElementById('receipt');
  if (r.ok) {
    /* The page keeps its promise: a reference number, in its own style. */
    const body = await r.json().catch(() => ({}));
    out.innerHTML = '<b>Application received</b><span>Reference number ' + (body.reference || 'FIP-2026-000418') + '</span>';
    out.hidden = false;
  } else {
    /* And when it does not, it says nothing at all. */
    out.hidden = true;
    out.innerHTML = '';
    console.error('Submit failed: ' + r.status);
  }
};
</script></body></html>`;

/**
 * Start the fixture.
 *
 * The API answers 500 until `succeed()` is called and 500 again after
 * `fail()`, so a single page can carry both halves of the commercial's hook
 * without a navigation. The 500 body names a fake server-side exception,
 * because the report's failure chain reads better with something in it and a
 * stack trace from a real machine is exactly what must never be filmed.
 */
export async function startFixture({ port = DEFAULT_PORT } = {}) {
  let ok = false;
  let sheet = '';

  const server = http.createServer((req, res) => {
    /*
     * The exported A4 workflow, served back on loopback.
     *
     * The sheet shot films the product's own vector at frame size, which the
     * bible (2.2) permits because rendering a vector at a size is not scaling
     * a capture. It is served here rather than from a `data:` URL so that the
     * origin assertion in safety.mjs still means something on that shot.
     */
    if (req.url === '/sheet' || req.url.startsWith('/sheet?')) {
      /* Never cached: the sheet is re-exported from the product every time it
         is filmed, and a browser that served the last one would put a stale
         diagram on screen with nothing to show for it. */
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
      });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workflow</title>
<style>html,body{margin:0;padding:0;background:#fff;height:100%;overflow:hidden}
svg{display:block;width:100vw;height:100vh}</style></head><body>${sheet}</body></html>`);
      return;
    }
    if (req.url.startsWith('/api/')) {
      if (ok) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"reference":"FIP-2026-000418","status":"received"}');
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"NullPointerException at PermitService.submit"}');
      return;
    }
    /* The dead link, and only that one. `/help` and `/status` answer, so the
       link check has something to report as fine as well as something broken. */
    if (req.url.startsWith('/forms/')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    port: server.address().port,
    people: PEOPLE,
    application: APPLICATION,
    allowed: ALLOWED_STRINGS,
    faults: FAULTS,
    /** The next submit answers 200 and the note clears. */
    succeed() { ok = true; },
    /** The next submit answers 500 and the note lands. */
    fail() { ok = false; },
    /** Hand the exported workflow SVG over so `/sheet` can serve it. */
    setSheet(svg) { sheet = String(svg || ''); },
    get failing() { return !ok; },
    close: () => new Promise((r) => server.close(r)),
  };
}

/* Run directly: serve it and say where. */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fixture.mjs')) {
  const f = await startFixture();
  console.log(`permits fixture on ${f.origin} — the API answers 500. Ctrl+C to stop.`);
}
