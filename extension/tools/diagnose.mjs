/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Diagnostic run against a COPY of the real profile.
 *
 *   node tools/diagnose.mjs
 *
 * Every other suite starts from an empty profile, so the database upgrade path
 * and anything else that depends on existing state has never been exercised.
 * This copies the live .uqa-profile, drives a full flow, and reports every
 * console error and unhandled rejection from the worker, the page and the popup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, seedProfileData } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/*
 * The shipping package with the site permission already granted.
 *
 * `<all_urls>` is an optional host permission since decision 8, and the bubble
 * that grants it is drawn by the browser with nothing for a harness to click.
 * See tools/lib-granted.mjs for what that copy does and does not prove.
 */
const EXT = grantedExtension({ label: 'diagnose' });
const LIVE = profile('.uqa-profile');
const PROFILE = profile('.diagnose-profile');

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>diag</title></head>
<body><h1>Application form</h1>
<label for="applicant">Applicant name</label><input id="applicant" type="text" maxlength="40"/>
<button id="submit" type="button">Submit application</button><div id="r"></div>
<!-- deliberately missing alt, so the image-alt rule has something to find -->
<img id="seal" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="20" height="20">
<script>document.getElementById('submit').onclick=async()=>{
  const res=await fetch('/api/x',{method:'POST',body:'{}'});
  if(!res.ok)console.error('Submit failed: '+res.status);
  document.getElementById('r').textContent='status '+res.status;};</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
    return;
  }
  // A real Set-Cookie, so the cookie editor has something that exists in
  // Chrome's jar rather than one written by script.
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'njb_probe=before; Path=/; SameSite=Lax',
  });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* Work on a copy so a diagnostic can never damage the real profile. */
// Copy everything EXCEPT the cached worker scripts: we want the real database
// and storage, with the code that is actually on disk.
if (seedProfileData(LIVE, PROFILE)) {
  console.log('seeded a fresh profile with the real database (upgrade path runs, code is current)');
} else {
  console.log('no live profile found — running against a fresh one');
}

const errors = [];
const logs = [];
const diagnosticDownloads = [];

const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { height: 860 }));
await keepOnTop(context); // test window stays above others; released on close

function watch(target, label) {
  target.on?.('console', (m) => {
    const text = m.text();
    logs.push(`[${label}] ${m.type()}: ${text}`);
    if (m.type() === 'error') errors.push(`[${label}] ${text}`);
  });
  target.on?.('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

try {
  const worker = await freshWorker(context);
  watch(worker, 'worker');
  const id = new URL(worker.url()).host;
  // The first-run notice gates the whole popup, so it is answered here rather
  // than clicked through in every suite.
  await seedConsent(worker);
  // And the page scripts in place before anything navigates. See lib-granted.mjs.
  await awaitSiteScripts(worker);

  const page = await context.newPage();
  watch(page, 'page');
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const ctl = await context.newPage();
  watch(ctl, 'popup');
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  await ctl.waitForTimeout(600);

  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const step = async (name, fn) => {
    try {
      const r = await fn();
      console.log(`  ok    ${name}${r === undefined ? '' : ` → ${JSON.stringify(r).slice(0, 140)}`}`);
      return r;
    } catch (e) {
      console.log(`  FAIL  ${name}\n          ${e.message}`);
      errors.push(`[step:${name}] ${e.message}`);
      return null;
    }
  };

  console.log('\n— database —');

  // The upgrade runs when the extension first opens the store, so inspecting
  // before that always reports the old version. Touch it through the worker first.
  await call({ type: 'UQA_LIST_SESSIONS' });

  await step('the store is migrated to v2 with the failure index', async () => {
    const r = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('uqa');
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames];
            let indexes = [];
            try {
              const tx = db.transaction('events', 'readonly');
              indexes = [...tx.objectStore('events').indexNames];
            } catch (e) {
              indexes = ['<error: ' + e.message + '>'];
            }
            resolve({ version: db.version, stores, indexes });
            db.close();
          };
          req.onerror = () => resolve({ error: String(req.error) });
          req.onblocked = () => resolve({ error: 'blocked' });
        })
    );
    if (r.error) throw new Error(r.error);
    if (!r.indexes.includes('bySessionFail')) throw new Error('the v2 index is missing: ' + r.indexes.join(','));
    return r;
  });

  await step('count what is already stored', () =>
    worker.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('uqa');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['sessions', 'events'], 'readonly');
            const s = tx.objectStore('sessions').count();
            const e = tx.objectStore('events').count();
            tx.oncomplete = () => {
              // Closing matters: a lingering connection at the old version
              // blocks the upgrade the extension is about to attempt.
              db.close();
              resolve({ sessions: s.result, events: e.result });
            };
            tx.onerror = () => {
              db.close();
              resolve({ error: String(tx.error) });
            };
          };
          req.onerror = () => resolve({ error: String(req.error) });
        })
    )
  );

  console.log('\n— messaging —');
  await step('UQA_GET_STATE responds', async () => {
    const r = await call({ type: 'UQA_GET_STATE' });
    if (!r?.ok) throw new Error(r?.error || 'no response');
    return r.result;
  });

  await step('UQA_GET_SETTINGS responds', async () => {
    const r = await call({ type: 'UQA_GET_SETTINGS' });
    if (!r?.ok) throw new Error(r?.error || 'no response');
    return { timeboxMinutes: r.result.timeboxMinutes, pick: r.result.keymap?.pick };
  });

  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin
  );

  console.log('\n— the master switch —');

  await step('everything refuses while the window is asleep', async () => {
    // Nothing has been armed yet, so this is the extension's state on a fresh
    // install: installed, inert, and saying so.
    const refusals = [];
    for (const type of ['UQA_START', 'UQA_PICK', 'UQA_CAPTURE', 'UQA_SCAN_A11Y', 'UQA_COOKIES', 'UQA_RECORD_START']) {
      const r = await call({ type, tabId });
      if (r?.ok) refusals.push(`${type} ran anyway`);
      else if (!/asleep/i.test(r.error)) refusals.push(`${type} refused with: ${r.error}`);
    }
    if (refusals.length) throw new Error(refusals.join('; '));
    return { refused: 6 };
  });

  await step('the page is told it is asleep, and its hooks stay inert', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const [{ result }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => ({ awake: window.UQAAwake }),
        }),
      tabId
    );
    if (result.awake !== false) throw new Error(`the content script thinks it is ${result.awake}`);

    // And the MAIN world must not be reporting anything either.
    const seen = await page.evaluate(async () => {
      const heard = [];
      const listen = (e) => e.data?.source === 'uqa-page' && heard.push(e.data);
      addEventListener('message', listen);
      await fetch('/api/quiet').catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      removeEventListener('message', listen);
      return heard.length;
    });
    if (seen) throw new Error(`${seen} event(s) reported by a sleeping page`);
    return { awake: result.awake, reported: seen };
  });

  const windowId = await ctl.evaluate(async () => (await chrome.windows.getLastFocused()).id);

  await step('waking one window arms every tab in it, and nothing else', async () => {
    const r = await call({ type: 'UQA_ARM', windowId });
    if (!r?.ok) throw new Error(r?.error);
    if (!r.result.armed) throw new Error('it reported success but is not armed');

    const state = await call({ type: 'UQA_ARMED', windowId });
    if (!state.result.armed) throw new Error('asking again says asleep');
    return { windowId, windows: r.result.windows.length };
  });

  await step('the page hears about it without needing a reload', async () => {
    await page.waitForTimeout(400);
    const [{ result }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => ({ awake: window.UQAAwake }),
        }),
      tabId
    );
    if (result.awake !== true) throw new Error(`still ${result.awake} after arming`);
    return result;
  });

  console.log('\n— the encoder —');

  await step('a recording round-trips through the media store and plays back', async () => {
    // Two things are being checked, and only one of them is ours.
    //
    // Ours: `putMedia` / `getMedia` / `listMedia` — that a video-sized Blob
    // survives storage byte for byte, and that listing a session's media does
    // NOT drag the payloads along, because a gallery that loads every video to
    // draw its thumbnails is the difference between instant and unusable.
    //
    // Chrome's: that a real encode produces something a browser will play. That
    // half is attempted, and **skipped rather than failed** when this profile
    // will not hand out canvas frames — which it sometimes will not, silently,
    // after a long run. Reporting "could not check" is honest; failing would
    // blame this extension for a browser resource it does not control.
    const stage = await context.newPage();
    await stage.goto(origin, { waitUntil: 'domcontentloaded' });

    const recorded = await stage.evaluate(async () => {
      const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) return { error: 'no supported encoder' };

      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      document.body.append(canvas);
      const ctx = canvas.getContext('2d');
      let tick = 0;
      const paint = setInterval(() => {
        ctx.fillStyle = `hsl(${(tick += 12) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 160, 120);
      }, 60);

      const stream = canvas.captureStream(15);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(200);
      await new Promise((r) => setTimeout(r, 2200));
      rec.requestData();
      await new Promise((r) => setTimeout(r, 200));
      const blob = await new Promise((done) => {
        rec.onstop = () => done(new Blob(chunks, { type: mime }));
        rec.stop();
      });
      clearInterval(paint);
      stream.getTracks().forEach((t) => t.stop());
      canvas.remove();

      return { mime, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    });
    await stage.close();

    if (recorded.error) throw new Error(recorded.error);
    const live = recorded.bytes.length >= 2000;

    // Storage is exercised either way. When the browser gave us nothing, a
    // synthetic payload of the same size still proves every line we wrote.
    const payload = live
      ? recorded
      : { mime: recorded.mime, bytes: [...new Uint8Array(64 * 1024).map((_, i) => i % 251)] };

    const outcome = await ctl.evaluate(async ({ mime, bytes }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const { putMedia, getMedia, listMedia, deleteMedia } = await import('/core/db.js');
      const id = `m_probe_${Date.now().toString(36)}`;
      await putMedia({
        id, sessionId: 's_probe', kind: 'recording', label: 'probe',
        blob, type: blob.type, bytes: blob.size, durationMs: 2200, ts: Date.now(),
      });

      const listed = await listMedia('s_probe');
      const back = await getMedia(id);
      const same = new Uint8Array(await back.blob.arrayBuffer());
      const identical = same.length === bytes.length && same.every((v, i) => v === bytes[i]);

      let playable = null;
      const url = URL.createObjectURL(back.blob);
      try {
        const v = document.createElement('video');
        v.muted = true;
        v.src = url;
        await new Promise((ok, no) => {
          v.onloadedmetadata = ok;
          v.onerror = () => no(new Error('not decodable as video'));
          setTimeout(() => no(new Error('metadata never arrived')), 5000);
        });
        playable = { width: v.videoWidth, height: v.videoHeight };
      } catch {
        playable = null; // only meaningful for a real encode
      } finally {
        URL.revokeObjectURL(url);
        await deleteMedia(id);
      }

      return {
        stored: back.blob.size,
        identical,
        listedWithoutBlob: listed.length === 1 && listed[0].blob === undefined,
        gone: (await listMedia('s_probe')).length === 0,
        playable,
      };
    }, payload);

    if (outcome.stored !== payload.bytes.length) throw new Error('the stored blob is not the one put in');
    if (!outcome.identical) throw new Error('the bytes changed in storage');
    if (!outcome.listedWithoutBlob) throw new Error('listMedia returned the payload — the gallery would load every video');
    if (!outcome.gone) throw new Error('deleteMedia left the item behind');

    if (!live) {
      return { storage: 'verified', encode: 'skipped — this profile produced no canvas frames' };
    }
    if (!outcome.playable?.width) throw new Error('a real encode was stored but will not decode as video');
    return { storage: 'verified', encode: recorded.mime, bytes: recorded.bytes.length, playable: outcome.playable };
  });

  console.log('\n— recording —');

  await step('start a session', async () => {
    const r = await call({ type: 'UQA_START', charter: 'Diagnostic', tabId, startUrl: `${origin}/` });
    if (!r?.ok) throw new Error(r?.error || 'no response');
    return { id: r.result.id, timebox: r.result.timeboxMinutes };
  });

  await page.waitForTimeout(500);

  await step('the content script knows it is recording', async () => {
    const [{ result }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => ({
            bridge: !!window.UQABridge,
            recording: window.UQABridge?.isRecording?.(),
            settings: !!window.UQASettings,
            selector: !!window.UQASelector,
            picker: !!window.UQAPicker,
            keymap: !!window.UQAKeymap,
          }),
        }),
      tabId
    );
    if (!result.bridge) throw new Error('the bridge content script is not present');
    if (!result.recording) throw new Error('the bridge does not think a session is recording');
    return result;
  });
  await page.fill('#applicant', 'Layla');
  await page.click('#submit');
  await page.waitForTimeout(1400);

  const state = await step('events actually landed', async () => {
    const r = await call({ type: 'UQA_GET_STATE' });
    if (!r?.ok) throw new Error(r?.error);
    if (!r.result.eventCount) throw new Error('zero events recorded after a fill and a click');
    return r.result;
  });

  console.log('\n— locator —');

  await step('describe() returns a locator', async () => {
    const [{ result }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            try {
              const d = window.UQASelector.describe(document.querySelector('#submit'));
              return { ok: true, locator: d?.playwright, unique: !d?.ambiguous };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          },
        }),
      tabId
    );
    if (!result.ok) throw new Error(result.error);
    if (!result.locator) throw new Error('no locator produced');
    return result;
  });

  await step('clipboard write from the content script', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const [{ result }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: async () => {
            try {
              await navigator.clipboard.writeText('uqa-clipboard-probe');
              return { ok: true };
            } catch (e) {
              return { ok: false, error: e.name + ': ' + e.message };
            }
          },
        }),
      tabId
    );
    if (!result.ok) throw new Error(result.error);
    return result;
  });

  console.log('\n— every file type —');

  await step('the browser is asked which image and video formats it can write', async () => {
    const r = await call({ type: 'UQA_FILE_TYPES' });
    if (!r?.ok) throw new Error(r?.error);
    const { images, videos, text } = r.result;
    if (!images?.png) throw new Error('PNG is not available, which cannot be true');
    if (!videos?.gif) throw new Error('GIF should always be available — this extension encodes it');
    if (!Array.isArray(text) || text.length < 10) throw new Error(`only ${text?.length} text formats`);
    // A format the encoder would refuse must be reported false, not offered.
    return {
      images: Object.entries(images).filter(([, v]) => v).map(([k]) => k),
      videos: Object.entries(videos).filter(([, v]) => v).map(([k]) => k),
      textFormats: text.length,
    };
  });

  console.log('\n— screens and video —');

  await step('a screenshot is stored as a real image, in the chosen format', async () => {
    const set = await call({ type: 'UQA_SET_SETTINGS', patch: { imageFormat: 'webp', imageQuality: 85 } });
    if (!set?.ok) throw new Error(set?.error);

    const r = await call({ type: 'UQA_CAPTURE', text: 'Diagnostic shot', tabId });
    if (!r?.ok) throw new Error(r?.error);
    // The format asked for is the format stored — canvas.toBlob silently falls
    // back to PNG for a type it cannot encode, which would ship a .webp that is
    // really a PNG.
    if (r.result.type !== 'image/webp') throw new Error(`asked for webp, stored ${r.result.type}`);
    if (!(r.result.bytes > 100)) throw new Error(`stored ${r.result.bytes} bytes — that is not an image`);
    return { type: r.result.type, bytes: r.result.bytes };
  });

  await step('the stored bytes decode back into an image', async () => {
    const list = await call({ type: 'UQA_MEDIA_LIST', sessionId: (await call({ type: 'UQA_GET_STATE' }))?.result?.session?.id });
    if (!list?.ok || !list.result.length) throw new Error('nothing in the media store');
    const shot = list.result.find((m) => m.kind === 'screenshot');
    if (!shot) throw new Error('no screenshot stored');

    const blob = await call({ type: 'UQA_MEDIA_BLOB', id: shot.id });
    if (!blob?.ok) throw new Error(blob?.error);

    // Hand it to the browser and make it decode. "The bytes came back" is not
    // "the image is valid" — that gap is where a broken encoder hides.
    const decoded = await ctl.evaluate(async ({ data, type }) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
      try {
        const img = new Image();
        await new Promise((ok, no) => {
          img.onload = ok;
          img.onerror = () => no(new Error('the browser refused to decode it'));
          img.src = url;
        });
        return { width: img.naturalWidth, height: img.naturalHeight };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, blob.result);

    if (!decoded.width || !decoded.height) throw new Error('decoded to a zero-sized image');
    return { ...decoded, bytes: shot.bytes, type: shot.type };
  });

  await step('the disk, not a timer, is what limits a recording', async () => {
    const r = await call({ type: 'UQA_STORAGE' });
    if (!r?.ok) throw new Error(r?.error);
    // The point of the feature: a number the tester can act on, not a cap.
    if (!r.result.knows) return { knows: false, note: 'the browser would not estimate' };
    if (typeof r.result.minutesOfVideo !== 'number') throw new Error('no minutes-of-video estimate');
    return { freeGB: Math.round(r.result.free / 1024 / 1024 / 1024), minutes: r.result.minutesOfVideo };
  });

  await step('this browser reports which video formats it can really write', async () => {
    const r = await call({ type: 'UQA_VIDEO_FORMATS' });
    if (!r?.ok) throw new Error(r?.error);
    const { videos, videoTypes } = r.result;
    // GIF is always true because the extension encodes it itself; webm is the
    // floor for MediaRecorder. If neither is offered, the settings page would
    // present a format that silently produces nothing.
    if (!videos?.gif) throw new Error('GIF should always be available — this extension encodes it');
    if (!videos.webm && !videos.mp4) throw new Error('no native video encoder at all');
    // The catalogue is what the settings page renders, so it has to carry the
    // label and the availability together.
    const gif = (videoTypes || []).find((t) => t.id === 'gif');
    if (!gif?.label || gif.available !== true) throw new Error('the catalogue disagrees with the probe');
    return videos;
  });

  await step('recording refuses without a gesture, in words a tester can act on', async () => {
    // Chrome only allows tab capture on a tab the user has just invoked the
    // extension on, and a test cannot click a toolbar icon. That gate is real
    // and worth keeping — so what is asserted is the thing that IS in our
    // control: that the refusal explains what to do, rather than surfacing
    // Chrome's own wording, which names a permission and no action.
    const r = await call({ type: 'UQA_RECORD_START', tabId, format: 'webm', fps: 10 });
    if (r?.ok) {
      // A gesture was somehow available — then it must really have recorded.
      await page.waitForTimeout(2000);
      const stop = await call({ type: 'UQA_RECORD_STOP', label: 'Diagnostic clip' });
      if (!stop?.ok) throw new Error(stop?.error);
      if (!(stop.result.bytes > 1000)) throw new Error(`the clip is ${stop.result.bytes} bytes`);
      return { captured: true, bytes: stop.result.bytes };
    }
    // Two separate assertions, because they used to be conflated and the check
    // was wrong, not the message.
    //
    // What must not appear is Chrome's *API* wording — `activeTab` is the name
    // of a manifest permission and "has not been invoked" is the internal
    // phrasing; neither names anything a tester can press. The word
    // "permission" on its own is not that: "Chrome drops permission to record a
    // tab as soon as it navigates" is the plain-English fact that explains why
    // the button that worked a minute ago does not now, and forbidding it drove
    // the message towards saying less. So it is allowed.
    if (/activeTab|has not been invoked/i.test(r.error)) {
      throw new Error(`the refusal still leaks Chrome's API wording: ${r.error}`);
    }
    // And what must appear is a route the tester can take from where they are
    // standing. This used to demand "Click the QA Wrap icon" — the one
    // instruction that does NOT work, because the tester has just done it and
    // the grant was dropped by the navigation since. The message now names the
    // shortcut and the context-menu entry, and this asserts on the entry, which
    // is the route that exists whether or not a shortcut is bound.
    if (!/Record a video of this tab/i.test(r.error)) {
      throw new Error(`the refusal does not name a route the tester can take: ${r.error}`);
    }
    return { refused: 'with instructions', message: r.error };
  });

  console.log('\n— cookies & storage (9) —');

  await step('cookies are readable, with values', async () => {
    const r = await call({ type: 'UQA_COOKIES', tabId });
    if (!r?.ok) throw new Error(r?.error);
    const seeded = r.result.find((c) => c.name === 'njb_probe');
    if (!seeded) throw new Error('the fixture cookie is not in the list');
    // The recorder must never see a value; the editor must. Both halves matter.
    if (seeded.value !== 'before') throw new Error(`value came back as "${seeded.value}"`);
    return { cookies: r.result.length, sample: seeded.name };
  });

  await step('a cookie value can be changed, and the page sees the change', async () => {
    const set = await call({
      type: 'UQA_COOKIE_SET',
      tabId,
      cookie: { name: 'njb_probe', value: 'after', path: '/' },
    });
    if (!set?.ok) throw new Error(set?.error);
    // Read it back from the page, not from the API that just wrote it.
    const inPage = await page.evaluate(() =>
      document.cookie.split('; ').find((c) => c.startsWith('njb_probe='))?.split('=')[1]
    );
    if (inPage !== 'after') throw new Error(`the page still reads "${inPage}"`);
    return { value: inPage };
  });

  await step('a cookie can be deleted', async () => {
    const r = await call({ type: 'UQA_COOKIE_DELETE', tabId, name: 'njb_probe' });
    if (!r?.ok) throw new Error(r?.error);
    const gone = await page.evaluate(() => !document.cookie.includes('njb_probe='));
    if (!gone) throw new Error('the cookie is still in the page');
    return { deleted: true };
  });

  await step('a cookie jar imports, and reports what was refused', async () => {
    const jar = JSON.stringify([
      { name: 'njb_a', value: '1', path: '/' },
      { name: 'njb_b', value: '2', path: '/' },
      { name: '', value: 'nameless', path: '/' },
    ]);
    const r = await call({ type: 'UQA_COOKIES_IMPORT', tabId, json: jar });
    if (!r?.ok) throw new Error(r?.error);
    if (r.result.applied !== 2) throw new Error(`applied ${r.result.applied}, expected 2`);
    if (r.result.results.filter((x) => !x.ok).length !== 1) {
      throw new Error('the nameless cookie should have been reported as refused, not silently dropped');
    }
    return { applied: r.result.applied, of: r.result.total };
  });

  await step('localStorage is readable and writable', async () => {
    await page.evaluate(() => localStorage.setItem('njb_ls', 'before'));
    const list = await call({ type: 'UQA_WEBSTORAGE', tabId });
    if (!list?.ok) throw new Error(list?.error);
    const found = list.result.local.find((k) => k.key === 'njb_ls');
    if (found?.value !== 'before') throw new Error('the seeded key did not come back');

    const set = await call({ type: 'UQA_WEBSTORAGE_SET', tabId, area: 'local', key: 'njb_ls', value: 'after' });
    if (!set?.ok) throw new Error(set?.error);
    const inPage = await page.evaluate(() => localStorage.getItem('njb_ls'));
    if (inPage !== 'after') throw new Error(`the page still reads "${inPage}"`);
    return { keys: list.result.local.length, value: inPage };
  });

  await step('an artefact still carries cookie names without values', async () => {
    // The editor showing values must not have loosened what gets recorded.
    const state = await call({ type: 'UQA_GET_STATE' });
    const sid = state?.result?.session?.id;
    const json = await call({ type: 'UQA_EXPORT', sessionId: sid, format: 'json' });
    if (json?.ok && /"value"\s*:\s*"(before|after|1|2)"/.test(json.result.content)) {
      throw new Error('a cookie value reached the export');
    }
    return { checked: true };
  });

  console.log('\n— accessibility audit (7) —');

  await step('the axe rule catalogue is available to choose from', async () => {
    const r = await call({ type: 'UQA_A11Y_RULES', tabId });
    if (!r?.ok) throw new Error(r?.error);
    if (!r.result.rules?.length) throw new Error('no rules returned');
    const contrast = r.result.rules.find((x) => x.id === 'color-contrast');
    if (!contrast?.helpUrl) throw new Error('rules came back without their help links');
    return { rules: r.result.rules.length, axe: r.result.version };
  });

  await step('a scan can be narrowed to chosen rules', async () => {
    const r = await call({ type: 'UQA_SCAN_A11Y', tabId, ruleIds: ['image-alt'] });
    if (!r?.ok) throw new Error(r?.error);
    const other = r.result.violations.filter((v) => v.id !== 'image-alt');
    if (other.length) throw new Error(`asked for image-alt, got ${other.map((v) => v.id).join(', ')}`);
    return { violations: r.result.violations.length };
  });

  await step('the manual checks are offered with a method, not just a title', async () => {
    const r = await call({ type: 'UQA_A11Y_GUIDED' });
    if (!r?.ok) throw new Error(r?.error);
    if (r.result.length < 8) throw new Error(`only ${r.result.length} checks`);
    const bad = r.result.filter((c) => !c.wcag || !c.how || c.how.length < 40);
    if (bad.length) throw new Error(`${bad.length} check(s) have no usable method`);
    return { checks: r.result.length };
  });

  await step('answering a guided check files it into the session', async () => {
    const before = await call({ type: 'UQA_GET_STATE' });
    const r = await call({
      type: 'UQA_A11Y_GUIDED_RESULT',
      id: 'focus-visible',
      verdict: 'fail',
      comment: 'No focus ring on the primary button',
    });
    if (!r?.ok) throw new Error(r?.error);
    const sid = before?.result?.session?.id;
    const tl = await call({ type: 'UQA_GET_TIMELINE', sessionId: sid });
    const note = (tl.result.events || []).filter((e) => e.kind === 'note').pop();
    if (!note) throw new Error('nothing was filed');
    if (note.tag !== 'bug') throw new Error(`a failing check should be tagged bug, got "${note.tag}"`);
    if (!note.text.includes('2.4.7')) throw new Error('the note lost its WCAG reference');
    return { tag: note.tag, text: note.text.slice(0, 60) };
  });

  console.log('\n— page speed —');

  await step('a page speed scan returns real Core Web Vitals', async () => {
    const r = await call({ type: 'UQA_SCAN_PERF', tabId });
    if (!r?.ok) throw new Error(r?.error);
    const { metrics, ratings, resources } = r.result;
    // Assert the outcome, not that the handler answered: a scan returning an
    // object full of nulls has measured nothing and would still "pass".
    if (typeof metrics?.ttfb !== 'number') throw new Error('no TTFB — nothing was measured');
    if (typeof metrics?.fcp !== 'number') throw new Error('no FCP — nothing was measured');
    if (!resources || resources.count < 1) throw new Error('no requests seen on a page that made some');
    for (const key of Object.keys(metrics)) {
      if (metrics[key] != null && !ratings[key]) throw new Error(`${key} has a value but no rating`);
    }
    return { ttfb: metrics.ttfb, fcp: metrics.fcp, cls: metrics.cls, requests: resources.count };
  });

  await step('the scan is recorded in the session, not just returned', async () => {
    const live = await call({ type: 'UQA_GET_STATE' });
    const sid = live?.result?.session?.id;
    if (!sid) throw new Error('no live session to look in');
    const r = await call({ type: 'UQA_GET_TIMELINE', sessionId: sid });
    if (!r?.ok) throw new Error(r?.error);
    const perf = (r.result.events || []).filter((e) => e.kind === 'perf');
    if (!perf.length) throw new Error('the measurement never reached the timeline');
    return { perfEvents: perf.length };
  });

  console.log('\n— export —');

  const stopped = await step('stop the session', async () => {
    const r = await call({ type: 'UQA_STOP' });
    if (!r?.ok) throw new Error(r?.error);
    return { id: r.result?.id };
  });

  // Each format is checked for the markup it claims to be. "Not empty" would
  // pass on a Markdown body handed to Jira, which renders as literal hashes.
  const FORMAT_SHAPE = {
    markdown: (t) => t.includes('## Steps to reproduce'),
    json: (t) => JSON.parse(t).session && Array.isArray(JSON.parse(t).events),
    playwright: (t) => t.includes('page.goto(') && t.includes('test('),
    sbtm: (t) => t.includes('CHARTER') || t.includes('## Charter'),
    jira: (t) => /^h2\. /m.test(t) && t.includes('||') && !/^## /m.test(t),
    github: (t) => /^## /m.test(t) && t.includes('|---|') && !/^h2\. /m.test(t),
    csv: (t) => t.split('\n')[0] === 'at,kind,summary,locator,failure' && t.split('\n').length > 1,
  };

  for (const [format, looksRight] of Object.entries(FORMAT_SHAPE)) {
    await step(`export ${format}`, async () => {
      const r = await call({ type: 'UQA_EXPORT', sessionId: stopped?.id, format });
      if (!r?.ok) throw new Error(r?.error);
      if (!r.result?.content?.length) throw new Error('empty content');
      if (!looksRight(r.result.content)) throw new Error(`the ${format} export is not ${format} markup`);
      return { filename: r.result.filename, bytes: r.result.content.length };
    });
  }

  await step('the ticket title is one line a tracker will accept', async () => {
    const r = await call({ type: 'UQA_TICKET_TITLE', sessionId: stopped?.id });
    if (!r?.ok) throw new Error(r?.error);
    const t = r.result;
    if (!t) throw new Error('no title');
    if (t.includes('\n')) throw new Error('a Jira summary cannot contain a newline');
    if (t.length > 255) throw new Error(`${t.length} chars — Jira rejects a summary over 255`);
    return { title: t };
  });

  await step('the download anchor path works in the popup', async () => {
    const r = await ctl.evaluate(async (sid) => {
      const res = await new Promise((ok) =>
        chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: sid, format: 'markdown' }, ok)
      );
      if (!res?.ok) return { ok: false, error: res?.error };
      try {
        const url = URL.createObjectURL(new Blob([res.result.content], { type: res.result.mime }));
        URL.revokeObjectURL(url);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, stopped?.id);
    if (!r.ok) throw new Error(r.error);
    return r;
  });

  await step('the popup shows live counters while recording', async () => {
    // A screenshot showed "0 events" during a live session — caused by a stale
    // element reference aborting refresh() halfway. Assert it, don't eyeball it.
    await call({ type: 'UQA_START', charter: 'Live counter check', tabId, startUrl: `${origin}/` });
    await page.waitForTimeout(400);
    await page.fill('#applicant', 'Layla');
    await page.click('#submit');
    await page.waitForTimeout(1500);

    const live = await context.newPage();
    watch(live, 'popup:live');
    await live.goto(`chrome-extension://${id}/popup/popup.html`);
    await live.waitForTimeout(1200);
    const shape = await live.evaluate(() => ({
      liveHidden: document.getElementById('step-live').hidden,
      events: document.getElementById('live-events').textContent,
      fails: document.getElementById('live-fails').textContent,
      clock: document.getElementById('live-time').textContent,
    }));
    await live.close();
    await call({ type: 'UQA_STOP' });

    if (shape.liveHidden) throw new Error('the recording section was hidden during a live session');
    if (Number(shape.events) < 1) throw new Error(`live-events showed "${shape.events}" after a fill and a click`);
    return shape;
  });

  console.log('\n— output —');

  await step('a Markdown export lands on disk as a real file', async () => {
    const started = await ctl.evaluate(
      async (sid) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: sid, format: 'markdown' }, (res) => {
            if (!res?.ok) return resolve({ error: res?.error || 'export failed' });
            const url = URL.createObjectURL(new Blob([res.result.content], { type: res.result.mime }));
            chrome.downloads.download({ url, filename: res.result.filename, saveAs: false }, (dlId) => {
              if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError.message });
              resolve({ id: dlId, expected: res.result.filename });
            });
          });
        }),
      stopped?.id
    );
    if (started.error) throw new Error(started.error);

    const landed = await ctl.evaluate(
      (dlId) =>
        new Promise((resolve) => {
          let tries = 0;
          const poll = () =>
            chrome.downloads.search({ id: dlId }, ([item]) => {
              if (item?.state === 'complete') return resolve({ path: item.filename });
              if (item?.state === 'interrupted') return resolve({ error: item.error || 'interrupted' });
              if (++tries > 40) return resolve({ error: `still ${item?.state || 'unknown'} after 6s` });
              setTimeout(poll, 150);
            });
          poll();
        }),
      started.id
    );
    if (landed.error) throw new Error(landed.error);

    // The whole point: a file the tester can actually open.
    if (!fs.existsSync(landed.path)) {
      throw new Error(`the download reported success but no file exists at ${landed.path}`);
    }
    const onDisk = fs.readFileSync(landed.path, 'utf8');
    if (!onDisk.includes('## Steps to reproduce')) throw new Error('the file on disk is not the report');
    diagnosticDownloads.push(landed.path);
    return { path: landed.path, bytes: onDisk.length };
  });

  await step('the report opens on something you can read at a glance', async () => {
    const view = await context.newPage();
    const viewErrors = [];
    view.on('pageerror', (e) => viewErrors.push(e.message));
    watch(view, 'report');
    await view.goto(`chrome-extension://${id}/report/report.html?session=${stopped?.id}`);
    /*
     * Wait for the chart, not only for the cards.
     *
     * The cards are appended synchronously and the charts are drawn by an async
     * function, so "a card exists" is true a beat before the chart is there.
     * Counting the bars at that moment answered zero on four opens in ten and
     * read as a broken feature. The chart is what the assertion below is about,
     * so the chart is what the wait is on.
     */
    await view.waitForFunction(
      () =>
        document.querySelectorAll('#cards .card').length > 0 &&
        document.getElementById('chart-activity')?.childElementCount > 0,
      { timeout: 8000 }
    ).catch(() => {});

    const shape = await view.evaluate(() => ({
      title: document.getElementById('hero-title')?.textContent || '',
      verdict: document.getElementById('hero-verdict')?.textContent || '',
      cards: document.querySelectorAll('#cards .card').length,
      /*
       * The activity chart, asked for where it now lives.
       *
       * It used to be a hand-rolled sparkline in `report.js` painting
       * `.spark-bar` marks into `#sparkline`. It is drawn by `report/charts.js`
       * now, as an SVG figure of `.chart-bar` rects inside `#chart-activity`,
       * and neither the old id nor the old class exists in `report.html` any
       * more — so this counted an element that cannot be there and could only
       * ever answer zero. The assertion underneath is unchanged: a session with
       * events must draw bars.
       */
      sparkBars: document.querySelectorAll('#chart-activity .chart-bar').length,
      chains: document.querySelectorAll('#chains .chain').length,
      timelineRows: document.querySelectorAll('#timeline .ev').length,
      // Cause and effect drawn side by side is the thing this page exists for.
      flows: document.querySelectorAll('#chains .flow-step').length,
      // The raw pane's first paint is the skeleton rows report.html ships, not
      // the word "Loading…" it used to hold. What the assertion is really about
      // is unchanged: nothing has serialised an export into it yet, which
      // `renderRaw()` would show as `.chunk` blocks in place of the skeleton.
      rawStillEmpty:
        !!document.querySelector('#content .skeleton') && !document.querySelector('#content .chunk'),
    }));
    await view.close();

    if (viewErrors.length) throw new Error(`the report threw: ${viewErrors.join('; ')}`);
    if (!shape.title || shape.title === 'Loading…') throw new Error('the hero never rendered');
    if (!shape.cards) throw new Error('no summary cards');
    if (!shape.sparkBars) throw new Error('the activity chart drew nothing');
    if (!shape.chains) throw new Error('the failures did not become cards');
    if (!shape.flows) throw new Error('the cause-and-effect flow is missing');
    if (!shape.timelineRows) throw new Error('the timeline is empty');
    // The raw export costs a full serialise; opening the page must not pay it.
    if (!shape.rawStillEmpty) throw new Error('the raw export was built before anyone asked for it');
    return shape;
  });

  await step('the raw export is still there, one tab away', async () => {
    const view = await context.newPage();
    watch(view, 'report');
    await view.goto(`chrome-extension://${id}/report/report.html?session=${stopped?.id}#raw`);
    await view.waitForFunction(() => document.querySelectorAll('#content .chunk').length > 0, { timeout: 8000 })
      .catch(() => {});
    const shape = await view.evaluate(() => ({
      chunks: document.querySelectorAll('#content .chunk').length,
      hasSteps: (document.getElementById('content')?.textContent || '').includes('## Steps to reproduce'),
      rawHidden: document.getElementById('panel-raw')?.hidden,
    }));
    await view.close();
    if (shape.rawHidden !== false) throw new Error('the #raw deep link did not open that tab');
    if (!shape.hasSteps) throw new Error('the export did not render');
    return shape;
  });

  await step('the panel renders the page speed block', async () => {
    const panel = await context.newPage();
    watch(panel, 'panel');
    await panel.goto(`chrome-extension://${id}/devtools/panel.html?session=${stopped?.id}`);
    await panel
      .waitForFunction(() => document.getElementById('block-perf')?.hidden === false, { timeout: 8000 })
      .catch(() => {});
    const shape = await panel.evaluate(() => ({
      hidden: document.getElementById('block-perf')?.hidden,
      metrics: [...document.querySelectorAll('#perf .perf-metric .k')].map((n) => n.textContent),
      rated: [...document.querySelectorAll('#perf .perf-metric')].filter((n) =>
        /rating-(good|needs-work|poor)/.test(n.className)
      ).length,
      summary: document.querySelector('#perf p.muted')?.textContent || '',
    }));
    await panel.close();
    if (shape.hidden !== false) throw new Error('the page speed block never appeared');
    if (!shape.metrics.includes('LCP')) throw new Error('the block rendered without its metrics');
    if (!shape.rated) throw new Error('no metric carries a rating — the colour coding is dead');
    if (!/requests/.test(shape.summary)) throw new Error('the network summary line is missing');
    return shape;
  });

  await step('every panel block renders — not just the first script', async () => {
    // The perf check above passes on panel.js alone. audit.js is a second plain
    // script on the same global, and a redeclared top-level `const` there throws
    // before a line of it runs: the audit and storage blocks come up empty with
    // nothing on screen to say why. Assert what each script is responsible for.
    const panel = await context.newPage();
    const panelErrors = [];
    panel.on('pageerror', (e) => panelErrors.push(e.message));
    watch(panel, 'panel');
    await panel.goto(`chrome-extension://${id}/devtools/panel.html?session=${stopped?.id}`);
    await panel.waitForFunction(() => document.querySelectorAll('#guided .guided-row').length > 0, { timeout: 8000 })
      .catch(() => {});
    // The storage block is a second round trip to the worker, and `audit.js`
    // paints "Reading…" while it is in flight. Waiting on the guided rows alone
    // read that placeholder and called it a failure, which is a race in the
    // check and not a fault in the panel. Wait for it to settle, or say so.
    await panel.waitForFunction(
      () => !/^Reading/.test(document.getElementById('storage-state')?.textContent || 'Reading'),
      { timeout: 8000 },
    ).catch(() => {});
    const shape = await panel.evaluate(() => ({
      guided: document.querySelectorAll('#guided .guided-row').length,
      storageSaid: document.getElementById('storage-state')?.textContent || '',
      cookieRows: document.querySelectorAll('#cookies tbody tr').length,
      rulesPrompt: document.getElementById('rules')?.textContent || '',
      timeline: document.querySelectorAll('#timeline .ev').length,
    }));
    await panel.close();
    if (panelErrors.length) throw new Error(`the panel threw: ${panelErrors.join('; ')}`);
    if (!shape.guided) throw new Error('the guided checks never rendered — audit.js did not run');
    if (!/cookie/i.test(shape.storageSaid)) throw new Error(`the storage block said "${shape.storageSaid}"`);
    if (!shape.timeline) throw new Error('the timeline never rendered — panel.js did not run');
    return shape;
  });

  console.log('\n— right-click menu —');

  await step('the menu is built, and matches the context it sits in', async () => {
    const shape = await ctl.evaluate(async () => {
      const seen = [];
      // contextMenus has no read API, so record what the worker created.
      return new Promise((done) => chrome.runtime.sendMessage({ type: 'UQA_MENU_STATE' }, (r) => done(r || seen)));
    });
    if (!shape?.ok) throw new Error(shape?.error || 'no menu state');
    const byId = Object.fromEntries(shape.result.items.map((i) => [i.id, i]));
    if (!byId['qaw-locator']) throw new Error('no "copy locator" entry');
    if (!byId['qaw-inject'].contexts.includes('editable')) throw new Error('the injector is not on form fields');
    if (byId['qaw-inject'].contexts.includes('page')) throw new Error('the injector should not be on the whole page');
    if (!byId['qaw-link-500'].contexts.includes('link')) throw new Error('the link rules are not on links');
    if (!byId['qaw-note-selection'].contexts.includes('selection')) throw new Error('notes are not on selected text');
    return { entries: shape.result.items.length, recordingLabel: shape.result.recordLabel };
  });

  await step('every tool in the popup is in the menu, under its own group', async () => {
    const shape = await ctl.evaluate(
      () => new Promise((done) => chrome.runtime.sendMessage({ type: 'UQA_MENU_STATE' }, done))
    );
    if (!shape?.ok) throw new Error(shape?.error || 'no menu state');
    const { items, groups, total, max } = shape.result;
    const byMenuId = Object.fromEntries(items.map((i) => [i.id, i]));

    // The grouping the popup itself declares, read out of the shipped file
    // rather than written down here: a list in the harness would pass happily
    // while the two files it is meant to compare drifted apart.
    const popupGroups = await ctl.evaluate(async () => {
      const src = await (await fetch(chrome.runtime.getURL('popup/popup.js'))).text();
      const from = src.indexOf('const GROUPS = [');
      const block = src.slice(from, src.indexOf('];', from));
      return [...block.matchAll(/id: '([a-z]+)'[^]*?tools: \[([^\]]*)\]/g)].map(([, id, list]) => ({
        id,
        tools: [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]),
      }));
    });
    /*
     * The shape comes from `core/tool-catalogue.json`, which is the same source
     * `tools/test-context-menus.mjs` checks the popup against. It said
     * `expected 16` and `expected 4` in three places, and the day a seventeenth
     * tool landed this step went red about a number rather than about a fault:
     * the tool was in the popup, in the catalogue and in the menu, correctly
     * grouped. A count typed into a test is a second source of truth.
     */
    const catalogue = JSON.parse(fs.readFileSync(path.join(EXT, 'core/tool-catalogue.json'), 'utf8'));
    const wantGroups = catalogue.groups.map((g) => g.label);
    const wantTools = catalogue.tools.length;

    if (popupGroups.length !== wantGroups.length) {
      throw new Error(`read ${popupGroups.length} groups out of popup.js, the catalogue has ${wantGroups.length}`);
    }

    if (groups.length !== wantGroups.length) {
      throw new Error(`${groups.length} groups in the menu, the catalogue has ${wantGroups.join('/')}`);
    }
    if (groups.map((g) => g.label).join(',') !== wantGroups.join(',')) {
      throw new Error(`the groups read ${groups.map((g) => g.label).join(', ')}, the catalogue says ${wantGroups.join(', ')}`);
    }
    for (const { id, tools } of popupGroups) {
      const inMenu = groups.find((g) => g.id === `qaw-group-${id}`)?.tools || [];
      if (inMenu.join(',') !== tools.join(',')) {
        throw new Error(`the "${id}" group is [${inMenu}] in the menu and [${tools}] in the popup`);
      }
    }

    const count = groups.reduce((n, g) => n + g.tools.length, 0);
    if (count !== wantTools) {
      throw new Error(`${count} tools across the groups, the catalogue has ${wantTools}`);
    }

    // Each one really is an entry, not merely a name in the grouping table.
    const missing = groups.flatMap((g) => g.tools).filter((t) => !byMenuId[`qaw-tool-${t}`]);
    if (missing.length) throw new Error(`grouped but never created: ${missing.join(', ')}`);

    // And each hangs off its group parent. Every tool flattened into the top
    // list is the failure the grouping exists to avoid.
    const flat = items.filter((i) => i.tool && !i.parent).map((i) => i.id);
    if (flat.length) throw new Error(`flattened into the parent: ${flat.join(', ')}`);
    if (total > max) throw new Error(`${total} menu items against a ceiling of ${max}`);

    // With no session running, a tool whose result is kept with one must still
    // be listed, and must say why it will not work.
    const needy = items.filter((i) => i.tool && / \(start a session first\)$/.test(i.title));
    if (!needy.length) throw new Error('no tool says it needs a session, with none running');

    return { groups: groups.length, tools: count, items: total, ceiling: max, sayNeedSession: needy.length };
  });

  await step('the content script can describe the last right-clicked element', async () => {
    await page.evaluate(() => {
      const btn = document.getElementById('submit');
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true }));
    });
    const described = await ctl.evaluate(
      (t) => chrome.tabs.sendMessage(t, { type: 'UQA_DESCRIBE_CONTEXT_TARGET' }),
      tabId
    );
    if (!described?.locator) throw new Error('the right-clicked element was not remembered');
    if (!described.locator.startsWith('page.')) throw new Error(`not a Playwright locator: ${described.locator}`);
    return described;
  });

  // Moved to the end for the same reason as the step below it: these start
  // and stop sessions of their own, so anything running afterwards would be
  // reporting on whichever empty session they left behind.
  console.log('\n— everything belongs to the session —');

  await step('rules stack instead of replacing each other', async () => {
    await call({ type: 'UQA_SET_RULES', rules: [] });
    await call({ type: 'UQA_ADD_RULE', rule: { label: 'First', enabled: true, pattern: '/api/a', action: 'fail', remaining: 2 } });
    const after = await call({ type: 'UQA_ADD_RULE', rule: { label: 'Second', enabled: true, pattern: '/api/b', action: 'status', status: 503, remaining: 3 } });
    if (!after?.ok) throw new Error(after?.error);
    if (after.result.length !== 2) {
      throw new Error(`${after.result.length} rule(s) — arming the second replaced the first`);
    }
    // Each keeps its own budget; one countdown shared between them would make
    // "break the next 3" mean something different depending on what else is armed.
    const budgets = after.result.map((r) => r.remaining).sort();
    if (String(budgets) !== '2,3') throw new Error(`budgets came back as ${budgets}`);
    return { rules: after.result.length, budgets };
  });

  await step('a rule can be dropped without disturbing the others', async () => {
    const rules = (await call({ type: 'UQA_GET_RULES' })).result;
    const first = rules.find((r) => r.label === 'First');
    const left = await call({ type: 'UQA_DROP_RULE', id: first.id });
    if (left.result.length !== 1 || left.result[0].label !== 'Second') {
      throw new Error(`after dropping First, left with ${left.result.map((r) => r.label).join(', ')}`);
    }
    return { left: left.result.map((r) => r.label) };
  });

  await step('the countdown survives a page reload', async () => {
    await call({ type: 'UQA_SET_RULES', rules: [] });
    const armed = await call({
      type: 'UQA_ADD_RULE',
      rule: { label: 'Three times', enabled: true, pattern: '/api/', action: 'fail', remaining: 3 },
    });
    const id = armed.result[0].id;

    // Fire once, reload, fire again. The page keeps its own copy of the rules
    // and resets it on navigation — so without a countdown held outside the
    // page, "the next three requests" silently became "three per page load".
    await call({ type: 'UQA_RULE_FIRED', ruleId: id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await call({ type: 'UQA_RULE_FIRED', ruleId: id });

    const now = (await call({ type: 'UQA_GET_RULES' })).result.find((r) => r.id === id);
    if (now.remaining !== 1) throw new Error(`${now.remaining} left after two firings across a reload, expected 1`);
    return { remaining: now.remaining };
  });

  await step('starting another session clears everything the last one armed', async () => {
    await call({
      type: 'UQA_ADD_RULE',
      rule: { label: 'Leftover', enabled: true, pattern: '/api/', action: 'fail', remaining: 9 },
    });
    const before = (await call({ type: 'UQA_GET_RULES' })).result.length;
    if (!before) throw new Error('nothing was armed to begin with');

    const fresh = await call({ type: 'UQA_START', charter: 'Second session', tabId, startUrl: `${origin}/` });
    if (!fresh?.ok) throw new Error(fresh?.error);

    const after = (await call({ type: 'UQA_GET_RULES' })).result;
    if (after.length) {
      throw new Error(`${after.length} rule(s) survived into the new session — it inherited the last one's setup`);
    }

    // And back to the diagnostic session, so the steps after this still have one.
    await call({ type: 'UQA_STOP' });
    await call({ type: 'UQA_START', charter: 'Diagnostic', tabId, startUrl: `${origin}/` });
    return { cleared: before };
  });

  await step('stopping a session leaves no rule armed behind it', async () => {
    await call({
      type: 'UQA_ADD_RULE',
      rule: { label: 'Should not outlive', enabled: true, pattern: '/api/', action: 'fail', remaining: 5 },
    });
    await call({ type: 'UQA_STOP' });
    const after = (await call({ type: 'UQA_GET_RULES' })).result;
    if (after.length) {
      throw new Error('a rule outlived its session — the tester keeps browsing behind it');
    }
    await call({ type: 'UQA_START', charter: 'Diagnostic', tabId, startUrl: `${origin}/` });
    return { armedAfterStop: 0 };
  });

  await step('the time-box does not limit anything, and is off by default', async () => {
    const settings = (await call({ type: 'UQA_GET_SETTINGS' })).result;
    if (settings.timeboxEnabled) throw new Error('the time-box is on by default — recording should never be timed');
    // And a session started with no explicit box carries none at all.
    const state = (await call({ type: 'UQA_GET_STATE' })).result;
    if (state.session?.expiresAt) throw new Error('a session was given an expiry nobody asked for');
    return { timeboxEnabled: settings.timeboxEnabled, expiresAt: state.session?.expiresAt ?? null };
  });


  // Last, deliberately: this one starts and deletes its own throwaway
  // session, and while it is active the diagnostic session is not. Run it
  // earlier and every later step reports on an empty session.
  await step('deleting a session frees its recordings too', async () => {
    const start = await call({ type: 'UQA_START', charter: 'Throwaway', tabId, startUrl: `${origin}/` });
    const sid = start.result.id;
    await call({ type: 'UQA_CAPTURE', text: 'to be deleted', tabId });
    const before = await call({ type: 'UQA_MEDIA_LIST', sessionId: sid });
    if (!before.result.length) throw new Error('nothing was stored to delete');

    await call({ type: 'UQA_STOP' });
    await call({ type: 'UQA_DELETE_SESSION', sessionId: sid });

    const after = await call({ type: 'UQA_MEDIA_LIST', sessionId: sid });
    if (after.result.length) throw new Error(`${after.result.length} item(s) survived the delete — the disk was never freed`);

    // Put the diagnostic session back so the steps after this still have one.
    await call({ type: 'UQA_START', charter: 'Diagnostic', tabId, startUrl: `${origin}/` });
    return { freed: before.result.length };
  });


  console.log('\n— ISTQB artefacts —');

  await step('a defect report is built to the standard shape', async () => {
    const r = await call({ type: 'UQA_DEFECT', sessionId: stopped?.id });
    if (!r?.ok) throw new Error(r?.error);
    const d = r.result.defect;

    for (const field of ['identifier', 'summary', 'severity', 'priority', 'expected', 'actual', 'steps', 'environment', 'evidence', 'traceability']) {
      if (!(field in d)) throw new Error(`no ${field} — that is not a 29119-3 defect report`);
    }
    // The distinction the syllabus is emphatic about, and that tools usually
    // collapse: severity is impact, priority is urgency, and they are separate.
    if (!d.severity || !d.priority) throw new Error('severity and priority must both be present');
    if (!d.severityIsSuggestion || !d.priorityIsSuggestion) {
      throw new Error('an automatic severity or priority must be labelled a suggestion');
    }
    if (d.expected !== '') throw new Error('expected must be left for the reporter — only a person knows it');
    if (!/500/.test(d.actual)) throw new Error(`actual did not carry the evidence: ${d.actual}`);
    return { id: d.identifier, severity: d.severity, priority: d.priority, steps: d.steps.length };
  });

  await step('a test case is built, and asks to be reviewed when it should', async () => {
    const r = await call({ type: 'UQA_TEST_CASE', sessionId: stopped?.id });
    if (!r?.ok) throw new Error(r?.error);
    const tc = r.result.testCase;

    if (!tc.steps.length) throw new Error('a test case with no steps');
    if (!tc.preconditions.length) throw new Error('a case with no preconditions cannot be re-run by anyone else');
    // The session it is built from contains a 500, so at least one expected
    // result is really an observed failure — and must be flagged, not filed.
    if (!tc.needsReview) throw new Error('a case derived from a failing run must ask to be reviewed');
    if (!/Review before use/i.test(r.result.markdown)) throw new Error('the warning did not survive into the Markdown');
    if (!r.result.gherkin.startsWith('#')) throw new Error('the feature file lost its provenance comment');
    return { id: tc.identifier, steps: tc.steps.length, preconditions: tc.preconditions.length };
  });

  await step('a chosen severity stops being called a suggestion', async () => {
    // Nested, like every other caller — options that sat beside `type` used to
    // overwrite the message's own type.
    const r = await call({ type: 'UQA_DEFECT', sessionId: stopped?.id, options: { severity: 'minor', priority: 'low' } });
    if (!r?.ok) throw new Error(r?.error);
    if (r.result.defect.severityIsSuggestion) throw new Error('a severity the tester set is not a suggestion');
    if (r.result.defect.severity !== 'minor') throw new Error('the chosen severity was ignored');
    return { severity: r.result.defect.severity, labelled: r.result.defect.severityIsSuggestion };
  });

  await step('the vocabulary offered is the CTFL vocabulary', async () => {
    const r = await call({ type: 'UQA_ISTQB_VOCAB' });
    if (!r?.ok) throw new Error(r?.error);
    const { severity, priority, levels, types } = r.result;
    if (severity.length < 4 || priority.length < 4) throw new Error('too few severity or priority values');
    // Every one has to explain itself, or the picker is four words with no
    // guidance and everybody picks the middle.
    for (const v of [...severity, ...priority]) {
      if (!v.hint || v.hint.length < 20) throw new Error(`"${v.id}" has no usable explanation`);
    }
    if (!levels.includes('System')) throw new Error('the CTFL test levels are missing');
    if (!types.includes('Functional')) throw new Error('the CTFL test types are missing');
    return { severity: severity.length, priority: priority.length, levels: levels.length, types: types.length };
  });

  await step('Jira refuses clearly when it is not configured', async () => {
    // No credentials in a diagnostic profile, so this is the path every new
    // user hits first. It must name the fix, not the field.
    const r = await call({ type: 'UQA_JIRA_TEST' });
    if (r?.ok) return { configured: true, note: 'this profile has Jira credentials' };
    if (!/not configured|site URL|email|API token/i.test(r.error)) {
      throw new Error(`the refusal does not say what to do: ${r.error}`);
    }
    return { refused: r.error.slice(0, 60) };
  });

  await step('posting to chat refuses when nothing is configured', async () => {
    const r = await call({ type: 'UQA_NOTIFY', sessionId: stopped?.id });
    if (r?.ok) return { configured: true };
    if (!/no chat destination/i.test(r.error)) throw new Error(`unexpected refusal: ${r.error}`);
    return { refused: 'with instructions' };
  });

  await step('the providers offered each carry a hint', async () => {
    const r = await call({ type: 'UQA_NOTIFY_PROVIDERS' });
    if (!r?.ok) throw new Error(r?.error);
    if (r.result.length < 4) throw new Error('too few providers');
    for (const p of r.result) {
      if (!p.hint || p.hint.length < 15) throw new Error(`${p.id} has no usable hint`);
    }
    return { providers: r.result.map((p) => p.id) };
  });

  await step('the report offers both documents, and asks for the judgement calls', async () => {
    const view = await context.newPage();
    const viewErrors = [];
    view.on('pageerror', (e) => viewErrors.push(e.message));
    watch(view, 'report');
    await view.goto(`chrome-extension://${id}/report/report.html?session=${stopped?.id}#file`);
    await view.waitForFunction(() => document.querySelectorAll('#judgement select').length >= 2, { timeout: 8000 })
      .catch(() => {});

    const shape = await view.evaluate(() => ({
      tabOpen: document.getElementById('panel-file')?.hidden === false,
      kinds: [...document.querySelectorAll('[data-artefact]')].map((b) => b.dataset.artefact),
      // The three things a recording cannot know, asked for above everything else.
      hasExpected: !!document.getElementById('defect-expected'),
      severityOptions: document.getElementById('defect-severity')?.options.length ?? 0,
      priorityOptions: document.getElementById('defect-priority')?.options.length ?? 0,
      // Both must be visibly marked as guesses until someone chooses.
      guesses: document.querySelectorAll('.judge-guess').length,
      // And the note that explains why they are two questions.
      explains: /two different judgements/i.test(document.getElementById('judgement')?.textContent || ''),
      // The document is the editable text itself now, not a read-only preview.
      preview: (document.getElementById('jira-body')?.value || '').length,
      jiraHidden: document.getElementById('jira-panel')?.hidden,
      // Diagnostics for when this fails, so the next person is not guessing.
      status: document.getElementById('file-status')?.textContent || '',
      istqbLoaded: typeof window.UQAIstqb,
      reportSession: window.UQAReport?.sessionId || null,
    }));
    await view.close();

    if (viewErrors.length) throw new Error(`the report threw: ${viewErrors.join('; ')}`);
    if (!shape.tabOpen) throw new Error('the #file deep link did not open that tab');
    // Seven kinds now — the two ISTQB documents, then story, epic, task, sub-task, plain.
    if (!shape.kinds.includes('defect') || !shape.kinds.includes('testcase') || shape.kinds.length !== 7) {
      throw new Error(`kinds offered: ${shape.kinds.join(', ')} — expected the defect report and the test case among seven`);
    }
    if (!shape.hasExpected) {
      throw new Error(
        `the expected-result field is missing — status "${shape.status}", ` +
          `UQAIstqb ${shape.istqbLoaded}, session ${shape.reportSession}`
      );
    }
    if (shape.severityOptions < 4 || shape.priorityOptions < 4) throw new Error('severity or priority has no choices');
    if (shape.guesses !== 2) throw new Error(`${shape.guesses} field(s) marked as suggested, expected 2`);
    if (!shape.explains) throw new Error('nothing explains why severity and priority are separate');
    if (!(shape.preview > 200)) throw new Error('the document preview is empty');
    if (shape.jiraHidden !== true) throw new Error('the Jira panel should stay closed until Connect is pressed');
    return shape;
  });

  console.log('\n— popup UI —');

  await ctl.reload();
  await ctl.waitForTimeout(900);

  // One mode since UI round 2 (S6): every control is already on the rail.
  await ctl.waitForTimeout(900);

  await step('popup renders its controls', async () => {
    const shape = await ctl.evaluate(() => {
      /*
       * Does the topper actually stay put while the body scrolls?
       *
       * This used to ask whether `.topper` computed to `flex: 0 0 auto`, which
       * is one implementation of the answer rather than the answer itself. The
       * popup body is a three-row grid now (`auto 1fr auto`, so the footer sits
       * on the bottom edge of a float the user has resized), the topper holds
       * its place for a different reason, and the old check failed a layout
       * that works — the worst kind of failure, because it points at the
       * feature rather than at the assertion.
       *
       * So measure the behaviour: scroll the body to the bottom and ask whether
       * the topper moved, whether the body is what scrolled, and whether the
       * document stayed still.
       */
      const topper = document.querySelector('.topper');
      const scroll = document.querySelector('.scroll');
      const canScroll = scroll.scrollHeight > scroll.clientHeight;
      const topBefore = Math.round(topper.getBoundingClientRect().top);
      const docBefore = document.scrollingElement.scrollTop;
      scroll.scrollTop = 9999;
      const scrolledBy = scroll.scrollTop;
      // getBoundingClientRect flushes layout, so this is the position after the
      // scroll rather than a stale one from the frame before it.
      const topAfter = Math.round(topper.getBoundingClientRect().top);
      const docAfter = document.scrollingElement.scrollTop;
      scroll.scrollTop = 0;

      return {
        // The switch is the first thing in the popup and must always render.
        switchTitle: document.getElementById('switch-title')?.textContent,
        switchBtn: document.getElementById('switch')?.textContent,
        // The topper is what stays put while the body scrolls.
        topperHeld: Math.abs(topAfter - topBefore) <= 1,
        topBefore,
        topAfter,
        // The scrolling has to happen inside `.scroll`. In Expert mode the tool
        // list always overflows, but the guard keeps a short list from failing
        // this for having nothing to scroll.
        bodyScrolled: !canScroll || scrolledBy > 0,
        scrolledBy,
        // ...and the page itself must not have moved with it.
        docHeld: docBefore === docAfter,
        scrolls: getComputedStyle(scroll).overflowY,
        tools: document.querySelectorAll('.tool-row').length,
        // Every tool carries its own explanation, in words, next to it.
        helps: document.querySelectorAll('.tool-help .tool-what').length,
        shortestHelp: Math.min(
          ...[...document.querySelectorAll('.tool-help .tool-what')].map((n) => n.textContent.length)
        ),
        themeBtn: document.getElementById('theme')?.textContent?.trim(),
        // The time-box control is gone: recording has no limit.
        timebox: !!document.getElementById('timebox'),
        stepIdleHidden: document.getElementById('step-idle')?.hidden,
        kbds: [...document.querySelectorAll('[data-action] kbd')].map((k) => k.textContent),
      };
    });
    if (!shape.switchTitle) throw new Error('the wake switch did not render');
    if (!shape.topperHeld) {
      throw new Error(
        `the topper scrolls away with the body — its top went ${shape.topBefore} → ${shape.topAfter}`
      );
    }
    if (!shape.bodyScrolled) throw new Error('the body did not scroll under the topper');
    if (!shape.docHeld) throw new Error('the whole document scrolled instead of the body');
    if (shape.scrolls !== 'auto' && shape.scrolls !== 'scroll') throw new Error('the body does not scroll on its own');
    if (shape.tools < 6) throw new Error(`only ${shape.tools} tools rendered`);
    if (shape.helps !== shape.tools) throw new Error('a tool has no explanation under it');
    if (!(shape.shortestHelp > 60)) throw new Error('an explanation is too short to explain anything');
    if (!shape.themeBtn) throw new Error('no theme control');
    if (shape.timebox) throw new Error('the time-box slider is still there');
    return shape;
  });
} finally {
  await context.close();
  server.close();
  // Do not leave test exports in the user's Downloads folder.
  for (const f of diagnosticDownloads) {
    try { fs.rmSync(f, { force: true }); } catch { /* already gone */ }
  }
}

console.log('\n──────────────── console errors ────────────────');
if (!errors.length) console.log('  none');
else errors.forEach((e) => console.log('  ' + e));

const noisy = logs.filter((l) => /error|fail|denied|refus|undefined is not/i.test(l));
if (noisy.length) {
  console.log('\n──────────────── suspicious log lines ────────────────');
  noisy.slice(0, 25).forEach((l) => console.log('  ' + l));
}
