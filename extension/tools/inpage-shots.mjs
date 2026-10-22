/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The in-page layer, measured once in a real browser (UI rework round 2, S8).
 *
 *   node tools/inpage-shots.mjs      → work/inpage-shots/report.json + one PNG per state
 *
 * A stranger's page is the whole point of this layer, so the fixtures are
 * pages in their own neutral styles, served in memory by `context.route`
 * (no fixture files): light, dark (#111), one whose CSP says `font-src 'none'`,
 * and one with an iframe. On each, in English and Arabic, it docks the bar to
 * the four edges and the pill, picks an element beside the bar, opens the four
 * old panels, films-without-filming, and measures from inside the closed root
 * (`UQA_UI_HIDE` with `measure: true`, content/ui-host.js):
 *
 *   the bar never overlaps a locked ring, the chip never meets the ring + 4 px
 *   and stays on screen, text ≥ 12 px, targets ≥ 24 px, the drawn text is in
 *   the private face, the page's own font is unchanged, a product screenshot
 *   has no bar pixels, the host is display:none while a video runs, and at
 *   most one UQA_OVERLAY_ASSETS request per frame that draws (none from a
 *   frame that draws nothing).
 *
 * One run, no retries (Owner exception): a failed check is reported, not re-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile, REPO } from './lib-paths.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const OUT = path.join(REPO, 'work', 'inpage-shots');
const PROFILE = profile('.inpage-shots-profile');
const ORIGIN = 'https://inpage.test';
const VW = 1280;
const VH = 800;
fs.mkdirSync(OUT, { recursive: true });

/* ── fixtures: someone else's page, never our tokens ───────────────────── */
const SITE = {
  light: { bg: [246, 247, 249], css: 'background:#F6F7F9;color:#1A1D23' },
  dark: { bg: [17, 17, 17], css: 'background:#111111;color:#ECECEC' },
};
const page = (theme, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>
<style>
  html,body{margin:0;height:100%} body{${SITE[theme].css};font-family:"Segoe UI", Arial, sans-serif;font-size:14px}
  main{position:absolute;inset:150px;display:grid;gap:12px;align-content:start}
  input,button{font:inherit;padding:8px 12px} iframe{width:420px;height:160px;border:1px solid #888}
  #near{position:fixed;left:50%;bottom:72px;transform:translateX(-50%)}
</style></head><body><main>
  <h1>Sign in</h1>
  <label for="email">Email</label><input id="email" type="email" placeholder="you@example.com">
  <button id="go" type="button">Continue</button>
  ${body}
</main></body></html>`;
const FIXTURES = {
  '/light': { html: page('light', ''), theme: 'light' },
  '/dark': { html: page('dark', ''), theme: 'dark' },
  '/csp': { html: page('light', '<p>font-src none</p>'), theme: 'light', csp: "font-src 'none'" },
  '/frame': { html: page('light', `<iframe id="child" src="${ORIGIN}/inner"></iframe>`), theme: 'light' },
  '/inner': { html: page('light', '<button id="inner-btn" type="button">Inside the frame</button>').replace('inset:150px', 'inset:8px'), theme: 'light' },
};

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `\n       ${detail}`}`);
};
const grow = (r, px) => ({ left: r.left - px, top: r.top - px, right: r.right + px, bottom: r.bottom + px });
const meets = (a, b) => !!a && !!b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
const inView = (r) => r.left >= 0 && r.top >= 0 && r.right <= VW && r.bottom <= VH;

const EXT = grantedExtension({ label: 'inpage' });
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, { ...launchOptions(EXT, { width: VW, height: VH + 100 }), viewport: { width: VW, height: VH } });
await keepOnTop(context); // test window stays above others; released on close
await context.route(`${ORIGIN}/**`, (route) => {
  const f = FIXTURES[new URL(route.request().url()).pathname];
  if (!f) return route.fulfill({ status: 204, body: '' });
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (f.csp) headers['content-security-policy'] = f.csp;
  return route.fulfill({ status: 200, headers, body: f.html });
});

let exitCode = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);

  const under = await context.newPage();
  await under.goto(`${ORIGIN}/light`, { waitUntil: 'load' });
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/options/options.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tabId = await ctl.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url.startsWith(u))?.id, `${ORIGIN}/light`);
  const armed = await call({ type: 'UQA_ARM' });
  if (!armed?.ok) throw new Error(`the window would not wake: ${JSON.stringify(armed)}`);
  const started = await call({ type: 'UQA_START', charter: 'in-page layer', tabId });
  if (!started?.ok) throw new Error(`no session: ${JSON.stringify(started)}`);
  await under.bringToFront();

  /** The measurement from inside the closed root, for one frame. */
  const measure = (frameId = 0) => ctl.evaluate(
    ([t, f]) => new Promise((r) => chrome.tabs.sendMessage(t, { type: 'UQA_UI_HIDE', hidden: false, measure: true }, { frameId: f }, (res) => { void chrome.runtime.lastError; r(res || null); })),
    [tabId, frameId]
  );
  const waitFor = async (pred, ms = 8000, frameId = 0) => {
    const until = Date.now() + ms;
    let m = null;
    while (Date.now() < until) {
      m = await measure(frameId);
      if (m && pred(m)) return m;
      await under.waitForTimeout(150);
    }
    return m;
  };
  const setStore = (area, value) => worker.evaluate(([a, v]) => chrome.storage[a].set(v), [area, value]);
  const shot = (name) => under.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  const textOk = (m, label) => {
    check(`${label}: text ≥ 12 px`, m?.minText >= 12, `smallest text ${m?.minText}px`);
    check(`${label}: targets ≥ 24 px`, m?.minTarget == null || m.minTarget >= 24, `smallest target ${m?.minTarget}px`);
  };
  const load = async (fixture, dock = { edge: 'bottom', pos: 0.5, collapsed: false }) => {
    // bar.js keeps the dock in chrome.storage.sync, not local: the worker
    // closes local to content scripts (S8; see bar.js's own comment above
    // save()/load()). Seeding local here silently no-ops the fixture, so
    // every edge/collapsed case below reads back the bar's compiled-in
    // default instead — S10 CHALLENGE, found by inpage-shots itself.
    // Unpinned at every load: a pin left by an interrupted run must not decide the fade checks.
    await setStore('sync', { qawBarDock: dock, qawBarPinned: false });
    await under.goto(`${ORIGIN}${fixture}`, { waitUntil: 'load' });
    await under.bringToFront();
    const m = await waitFor((x) => x.bar && x.fontReady !== undefined && x.bar.width > 0);
    await under.waitForTimeout(350); // the entrance and the settle (dur-3)
    return (await measure()) || m;
  };

  for (const lang of ['en', 'ar']) {
    await setStore('sync', { qawLanguage: lang });
    for (const fixture of ['/light', '/dark', '/csp', '/frame']) {
      const tag = `${fixture.slice(1)}-${lang}`;
      await under.emulateMedia({ colorScheme: FIXTURES[fixture].theme });
      let m = await load(fixture);
      check(`${tag}: the bar shows while recording`, m?.bar?.width > 0, JSON.stringify(m?.probe || m?.bar));
      if (!m?.bar) continue;
      await under.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 5000 }).catch(() => {});
      m = await measure();
      await shot(`${tag}-bottom`);
      textOk(m, `${tag} bar`);
      check(`${tag}: drawn in the private face`, m.fontReady && m.faces.every((f) => f === 'QAW Thmanyah Sans' || /monospace|Consolas|SFMono/.test(f)), `ready=${m.fontReady} faces=${m.faces.join('|')}`);
      const pageFont = await under.evaluate(() => getComputedStyle(document.body).fontFamily);
      check(`${tag}: the page's own font is unchanged`, pageFont === '"Segoe UI", Arial, sans-serif', pageFont);
      check(`${tag}: host direction follows the language`, m.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `dir=${m.dir}`);
      check(`${tag}: bottom dock, 16 px from the edge`, Math.abs(VH - m.bar.bottom - 16) <= 1, `bottom gap ${VH - m.bar.bottom}`);
      check(`${tag}: one asset request in the top frame`, m.assetRequests === 1, `requests=${m.assetRequests}`);

      if (fixture === '/frame') {
        const frames = await worker.evaluate((t) => chrome.webNavigation.getAllFrames({ tabId: t }), tabId);
        const sub = frames.find((f) => f.frameId !== 0);
        const before = sub ? await measure(sub.frameId) : null;
        check(`${tag}: a frame that draws nothing asks nothing`, before?.assetRequests === 0, JSON.stringify(before && { assetRequests: before.assetRequests }));
        await call({ type: 'UQA_PICK', tabId });
        const inner = under.frameLocator('#child').locator('#inner-btn');
        await inner.hover().catch(() => {});
        const after = sub ? await waitFor((x) => x.hoverRing, 4000, sub.frameId) : null;
        check(`${tag}: a frame that shows a chip asks once`, after?.assetRequests === 1 && !!after?.hoverRing, JSON.stringify(after && { assetRequests: after.assetRequests, ring: !!after.hoverRing }));
        check(`${tag}: no bar in the sub-frame`, !after?.bar, JSON.stringify(after?.bar));
        await under.keyboard.press('Escape');
        continue;
      }
      if (fixture === '/csp') continue;

      // A product screenshot has no bar pixels (the bar sits on a flat band of page colour).
      if (lang === 'en') {
        const res = await call({ type: 'UQA_CAPTURE', tabId, format: 'png', text: 'inpage-shots' });
        const blob = res?.ok ? await call({ type: 'UQA_MEDIA_BLOB', id: res.result.mediaId }) : null;
        if (blob?.ok) {
          const png = PNG.sync.read(Buffer.from(blob.result.data));
          fs.writeFileSync(path.join(OUT, `${tag}-capture.png`), Buffer.from(blob.result.data));
          const dpr = png.width / VW;
          const bg = SITE[FIXTURES[fixture].theme].bg;
          let off = 0;
          let total = 0;
          for (let y = Math.ceil(m.bar.top * dpr); y < Math.floor(m.bar.bottom * dpr); y++) {
            for (let x = Math.ceil(m.bar.left * dpr); x < Math.floor(m.bar.right * dpr); x++) {
              const i = (y * png.width + x) * 4;
              total++;
              if (Math.max(...[0, 1, 2].map((c) => Math.abs(png.data[i + c] - bg[c]))) > 12) off++;
            }
          }
          check(`${tag}: a product screenshot has no bar pixels`, total > 0 && off === 0, `${off} of ${total} pixels in the bar's rect are not the page`);
          const probe = await measure();
          check(`${tag}: the bar is back after the screenshot`, !probe.hidden && !!probe.bar, JSON.stringify({ hidden: probe.hidden }));
        } else check(`${tag}: a product screenshot has no bar pixels`, false, `capture failed: ${JSON.stringify(res)}`);
      }

      // Pick beside the bar: the locked ring sends the bar to the other edge, the chip clears both.
      await under.evaluate(() => { const b = document.createElement('button'); b.id = 'near'; b.type = 'button'; b.textContent = 'Beside the bar'; document.body.append(b); });
      await call({ type: 'UQA_PICK', tabId });
      await under.hover('#near');
      await under.waitForTimeout(250);
      const hover = await measure();
      check(`${tag}: hover ring drawn`, !!hover.hoverRing, '');
      if (hover.chip && hover.hoverRing) {
        check(`${tag}: hover chip clears the ring + 4 px`, !meets(hover.chip, grow(hover.hoverRing, 8)), JSON.stringify({ chip: hover.chip, ring: hover.hoverRing }));
        check(`${tag}: hover chip on screen`, inView(hover.chip), JSON.stringify(hover.chip));
      } else check(`${tag}: hover chip shown`, false, JSON.stringify({ chip: hover.chip }));
      await under.click('#near', { modifiers: ['Shift'] });
      await under.waitForTimeout(400);
      const locked = await measure();
      await shot(`${tag}-picked`);
      const ring = locked.rings?.[0];
      check(`${tag}: a locked ring is drawn`, !!ring, '');
      if (ring) {
        check(`${tag}: the bar never overlaps a locked ring (it yields)`, !meets(locked.bar, grow(ring, 8)) && locked.bar?.top < VH / 2, JSON.stringify({ bar: locked.bar, ring }));
        check(`${tag}: chip clears the locked ring + 4 px, on screen`, !!locked.chip && !meets(locked.chip, grow(ring, 12)) && inView(locked.chip), JSON.stringify({ chip: locked.chip, ring }));
      }
      textOk(locked, `${tag} picking`);
      await under.keyboard.press('Escape');
      await under.evaluate(() => document.getElementById('near')?.remove());
      const home = await waitFor((x) => x.bar && x.bar.bottom > VH / 2, 2000);
      check(`${tag}: the bar goes home once the ring is gone`, home?.bar?.bottom > VH / 2, JSON.stringify(home?.bar));

      // Video: the host is not drawn at all while any clip runs.
      await worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'UQA_RECORDING_CHANGED', recording: true }).catch(() => {}), tabId);
      const filming = await waitFor((x) => x.filming, 2000);
      check(`${tag}: display:none while a video runs`, filming?.filming && filming?.hidden, JSON.stringify({ filming: filming?.filming, hidden: filming?.hidden }));
      await worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'UQA_RECORDING_CHANGED', recording: false }).catch(() => {}), tabId);
      const back = await waitFor((x) => !x.filming && !x.hidden, 2000);
      check(`${tag}: drawn again when the video stops`, back && !back.filming && !back.hidden, '');

      // The four edges and the pill.
      for (const [edge, collapsed] of [['top', false], ['left', false], ['right', false], ['bottom', true]]) {
        const d = await load(fixture, { edge, pos: 0.5, collapsed });
        const name = collapsed ? 'pill' : edge;
        await shot(`${tag}-${name}`);
        const b = d?.bar;
        const gap = !b ? NaN : { top: b.top, bottom: VH - b.bottom, left: b.left, right: VW - b.right }[edge];
        check(`${tag}: ${name} docked 16 px from its edge`, Math.abs(gap - 16) <= 1, `gap ${gap}`);
        if (collapsed) {
          check(`${tag}: the pill is 36 high`, Math.round(b?.height) === 36, `height ${b?.height}`);
          // Round 3: the idle pill carries the brand mark in its two tones (light
          // ground: basalt + rust; dark: limestone + coral), not a grey one-colour mark.
          const want = FIXTURES[fixture].theme === 'dark' ? ['rgb(236, 234, 227)', 'rgb(255, 138, 110)'] : ['rgb(29, 32, 36)', 'rgb(181, 67, 43)'];
          check(`${tag}: the pill mark is in the brand colours`, JSON.stringify(d?.mark) === JSON.stringify(want), `mark ${JSON.stringify(d?.mark)} want ${JSON.stringify(want)}`);
        }
        textOk(d, `${tag} ${name}`);
      }
      await load(fixture);

      // The four old panels, on the new tokens.
      if (fixture === '/light') {
        await call({ type: 'UQA_MASK_PICK', tabId });
        const mask = await waitFor((x) => x.panels?.includes('uqa-mask-tip'), 3000);
        await shot(`${tag}-mask-tip`);
        check(`${tag}: mask tip opens`, mask?.panels?.includes('uqa-mask-tip'), JSON.stringify(mask?.panels));
        textOk(mask, `${tag} mask tip`);
        await under.keyboard.press('Escape');
        await call({ type: 'UQA_INJECT', tabId });
        const field = await waitFor((x) => x.panels?.includes('uqa-field-bar'), 3000);
        check(`${tag}: field bar opens`, field?.panels?.includes('uqa-field-bar'), JSON.stringify(field?.panels));
        textOk(field, `${tag} field bar`);
        await under.click('#email').catch(() => {});
        const palette = await waitFor((x) => x.panels?.includes('uqa-palette'), 3000);
        await shot(`${tag}-palette`);
        check(`${tag}: palette opens`, palette?.panels?.includes('uqa-palette'), JSON.stringify(palette?.panels));
        textOk(palette, `${tag} palette`);
        await under.keyboard.press('Escape');
        await under.keyboard.press('Escape');
        const now = await measure();
        const noteBtn = now?.controls?.find((c) => /note|ملاحظة/i.test(c.label || ''));
        // The bar comes back solid the moment the pointer is near it (round 3 fade).
        if (noteBtn) {
          await under.mouse.move(noteBtn.left + noteBtn.width / 2, noteBtn.top + noteBtn.height / 2);
          await under.waitForTimeout(700);
          await under.mouse.down();
          await under.mouse.up();
        }
        const note = await waitFor((x) => x.panels?.includes('uqa-quicknote'), 3000);
        await shot(`${tag}-quicknote`);
        check(`${tag}: quick note opens from the bar`, note?.panels?.includes('uqa-quicknote'), JSON.stringify({ button: !!noteBtn, panels: note?.panels }));
        textOk(note, `${tag} quick note`);
        await under.keyboard.press('Escape');

        // Round 3 fade: solid while the pointer is near, fades ~1.5 s after it
        // leaves, back at once when it returns; the pin keeps it solid and is
        // remembered in chrome.storage.sync.
        const bar0 = (await measure())?.bar;
        const pinBtn = (await measure())?.controls?.find((c) => c.pressed != null);
        check(`${tag}: the bar has a pin button with aria-pressed`, pinBtn?.pressed === 'false', JSON.stringify(pinBtn));
        if (bar0 && pinBtn) {
          await under.mouse.move(bar0.left + 4, bar0.top + 4);
          await under.waitForTimeout(100);
          check(`${tag}: solid while the pointer is on it`, (await measure())?.probe?.faded === false, '');
          await under.mouse.move(VW / 2, bar0.top > VH / 2 ? 40 : VH - 40);
          await under.waitForTimeout(900);
          check(`${tag}: still solid 0.9 s after the pointer leaves`, (await measure())?.probe?.faded === false, '');
          await under.waitForTimeout(1100);
          check(`${tag}: faded 2 s after the pointer leaves`, (await measure())?.probe?.faded === true, '');
          await under.mouse.move(bar0.left + bar0.width / 2, bar0.top - 12);
          await under.waitForTimeout(50);
          check(`${tag}: back at once when the pointer comes near`, (await measure())?.probe?.faded === false, '');
          await under.mouse.move(pinBtn.left + pinBtn.width / 2, pinBtn.top + pinBtn.height / 2);
          await under.mouse.down();
          await under.mouse.up();
          await under.waitForTimeout(150);
          const pinned = await measure();
          const stored = await worker.evaluate(() => chrome.storage.sync.get('qawBarPinned'));
          check(`${tag}: pin pressed and remembered`, pinned?.probe?.pinned === true && pinned?.controls?.find((c) => c.pressed != null)?.pressed === 'true' && stored.qawBarPinned === true, JSON.stringify({ probe: pinned?.probe, stored }));
          await under.mouse.move(VW / 2, bar0.top > VH / 2 ? 40 : VH - 40);
          await under.waitForTimeout(2000);
          await shot(`${tag}-pinned`);
          check(`${tag}: pinned bar never fades`, (await measure())?.probe?.faded === false, '');
          await under.mouse.move(pinBtn.left + pinBtn.width / 2, pinBtn.top + pinBtn.height / 2);
          await under.mouse.down();
          await under.mouse.up();
          await under.waitForTimeout(100);
          // A click on the page takes focus out of the bar (focus inside holds it solid).
          await under.mouse.click(VW - 40, bar0.top > VH / 2 ? 40 : VH - 40);
          await under.waitForTimeout(2000);
          await shot(`${tag}-faded`);
          check(`${tag}: unpinned, it fades again`, (await measure())?.probe?.faded === true && (await worker.evaluate(() => chrome.storage.sync.get('qawBarPinned'))).qawBarPinned === false, '');
        }
      }
    }
  }
  exitCode = checks.every((c) => c.pass) ? 0 : 1;
} catch (err) {
  check('the run completed', false, err.stack || String(err));
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  await context.close().catch(() => {});
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\ninpage-shots: ${checks.length} checks, ${failed} failed → ${path.relative(REPO, OUT)}`);
  process.exit(exitCode);
}
