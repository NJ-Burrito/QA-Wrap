/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Recording, driven the awkward ways a real tester does it — and asserted.
 *
 *   node tools/recording.mjs        (headed; needs no session of its own)
 *
 * Written because "the screen recording feature is not stable, has a lot of
 * bugs" is not a bug report you can act on, and the way to turn it into one is
 * to press the thing in every wrong order and check what survives.
 *
 * ── this file used to prove nothing ───────────────────────────────────────
 *
 * The first version printed what happened and exited 0 whatever happened. It
 * had no assertion, no counter and no failing exit, and two documents cited its
 * "errors: none" line as the evidence that R1–R29 were fixed. A run in which
 * every single operation was refused and no clip was ever stored printed
 * exactly the same line as a run in which everything worked. Every step below
 * now states the outcome it expects, by name, and the process exits 1 if one of
 * them does not happen.
 *
 * ── how a real activeTab grant is obtained here ───────────────────────────
 *
 * Chrome only lets an extension capture a tab the user has just invoked it on.
 * The harness cannot click a toolbar icon, which is why every earlier run was
 * refused — but a keyboard command bound in the manifest is also an invocation,
 * and CDP's `Input.dispatchKeyEvent` reaches Chrome's own accelerator handling
 * rather than only the renderer. Pressing the manifest's `record-tab` shortcut
 * that way produces a genuine grant: `chrome.tabCapture.getMediaStreamId`
 * returns a real stream id afterwards, and `UQA_CAN_RECORD` flips to
 * `{ can: true }`. Nothing is faked, stubbed or bypassed; the routes that do
 * not work are written up in `research/39-fixes-media.md` so nobody spends the
 * afternoon on them again.
 *
 * So this suite covers both halves: the refusals, exactly as a tester reads
 * them, and a real clip recorded from a real stream, checked byte by byte.
 */
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/*
 * The shipping package with the site permission already granted.
 *
 * The copy-with-one-manifest-line-changed trick below was this file's, invented
 * for `desktopCapture`; since decision 8 made `<all_urls>` optional too, three
 * suites need it and it lives in `tools/lib-granted.mjs`. Same routine, same
 * `copyShipping`, one caller each.
 */
const EXT = grantedExtension({ label: 'recording' });
const PROFILE = profile('.rec-profile');

/* ------------------------------------------------------------- assertions */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** Deep-enough equality for the shapes these handlers answer with. */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function is(name, actual, expected) {
  check(name, () => {
    if (!same(actual, expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`);
    }
  });
}

function truthy(name, value, why = 'was not true') {
  check(name, () => {
    if (!value) throw new Error(`${why} (got ${JSON.stringify(value)})`);
  });
}

/* ---------------------------------------------------------------- fixture */

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>rec</title></head>
<body><h1>Recording fixture</h1><button id="b">Go</button>
<script>
  // Something moving, so a clip of this tab is not a single static frame that
  // any encoder would compress to almost nothing.
  setInterval(() => { document.title = 't' + Date.now(); document.body.style.background = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); }, 120);
  // A tone the tab can be asked to play, so "tab sound" has something to
  // record. An oscillator and not an audio file: no asset to ship, no decoder
  // to depend on, and the waveform is known, so silence is unambiguous.
  window.startTone = () => {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    return ac.state;
  };
</script></body></html>`;

const server = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
/* The same server under a second origin: the navigation that really does cost
   Chrome's own activeTab grant, rather than only the product's record of it. */
const CROSS_URL = `http://localhost:${server.address().port}/`;

purgeWorkerCache(PROFILE);
const base = launchOptions(EXT);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...base,
  // 3.8.3: no viewport emulation. An emulated page is not the size its tab is, and the recorder now
  // waits (up to 4 s) for the tab's real size; the window is resized for real below instead.
  viewport: null,
  /*
   * A microphone that is granted and that makes a sound.
   *
   * `--use-fake-device-for-media-stream` puts a generated tone on the
   * microphone instead of whatever is plugged into this machine, and the
   * `--auto-accept-camera-and-microphone-capture` answers the device prompt
   * yes, which is the same answer a tester gives once in the Permissions
   * section of Settings and the browser then remembers.
   *
   * Deliberately NOT `--use-fake-ui-for-media-stream`: that flag also answers
   * the tab-capture stream request, and it answers it with a fake camera. The
   * whole suite failed with 'Cannot capture a tab with an active stream'
   * because the substituted stream was never released. Grant the permission,
   * leave the media pipeline alone.
   *
   * Nothing in the extension is stubbed either way: the offscreen document
   * calls the same `getUserMedia` it always calls, and the clip is asserted by
   * decoding the audio that came out of it.
   */
  /*
   * The screen picker, answered.
   *
   * `--auto-select-desktop-capture-source` makes Chrome answer its own source
   * chooser with the first source whose name matches, instead of showing a
   * modal no harness can click. **This is stated out loud because it is the one
   * thing in this suite that is not what a tester does**: everything else here
   * is the real API on the real path, and this flag replaces exactly one human
   * decision — which screen — and nothing else. The stream that comes back is a
   * real screen stream (its track is labelled `screen:0:0`), the recorder is
   * the shipped one, and the clip is checked byte by byte like every other.
   *
   * Without the flag the same code opens Chrome's real picker and waits, which
   * is verified by hand and cannot be asserted here.
   */
  args: [
    ...base.args,
    '--use-fake-device-for-media-stream',
    '--auto-accept-camera-and-microphone-capture',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
});
const w = await freshWorker(ctx);
const id = new URL(w.url()).host;
// The first-run notice gates the whole popup; answered here, not clicked.
await seedConsent(w);
// And the page scripts in place before anything navigates. See lib-granted.mjs.
await awaitSiteScripts(w);


/**
 * Console errors from any surface. Reported, never mistaken for a result.
 *
 * `UQA_TRACE=1` prints every worker line as it happens, and says when the
 * worker restarts. Added on 8 September 2026 because the failure being chased
 * was a handler that answered nothing at all: the assertions said what did not
 * happen, and nothing said where it stopped. The `console.log` the worker was
 * temporarily given to find it belongs in the harness, not in the product.
 */
const errs = [];
const trace = !!process.env.UQA_TRACE;
w.on('console', (m) => {
  if (trace) console.log(`    <worker:${m.type()}> ${m.text()}`);
  if (m.type() === 'error') errs.push('[worker] ' + m.text());
});
if (trace) {
  w.on('pageerror', (e) => console.log('    <worker:pageerror> ' + e.message));
  ctx.on('serviceworker', (sw) => console.log('    <worker restarted> ' + sw.url()));
}

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('[page] ' + e.message));
await page.goto(URL_);

const popup = await ctx.newPage();
popup.on('pageerror', (e) => errs.push('[popup] ' + e.message));
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(900);

const send = (msg) => popup.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
const state = async () => (await send({ type: 'UQA_RECORD_STATE' }))?.result;
const sessionId = async () => (await send({ type: 'UQA_GET_STATE' }))?.result?.session?.id;
const clips = async (sid) => (await send({ type: 'UQA_MEDIA_LIST', sessionId: sid ?? (await sessionId()) }))?.result ?? [];

/**
 * The shortcut, pressed the way Chrome counts as an invocation.
 *
 * `Input.dispatchKeyEvent` on a tab's own CDP session reaches the browser's
 * accelerator handling, so `chrome.commands.onCommand` fires and the tab gets a
 * real `activeTab` grant. `bringToFront` is a tab activation inside our own
 * window, not an OS focus change, so it does not break the rule that a suite
 * must never come to the front of your screen.
 */
async function pressRecordShortcut(target) {
  const cdp = await ctx.newCDPSession(target);
  await target.bringToFront();
  for (const type of ['rawKeyDown', 'keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'V',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers: 1 + 8, // Alt + Shift
    });
  }
  await cdp.detach().catch(() => {});
}

/** The first bytes of a stored clip, as text, straight out of IndexedDB. */
function storedHead(mediaId, whole = false) {
  return popup.evaluate(async ([mid, whole]) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('uqa');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const rec = await new Promise((res) => {
      const q = db.transaction('media', 'readonly').objectStore('media').get(mid);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
    db.close();
    if (!rec?.blob) return null;
    const bytes = new Uint8Array(await rec.blob.slice(0, 24).arrayBuffer());
    return {
      bytes: rec.bytes,
      type: rec.type,
      sessionId: rec.sessionId,
      label: rec.label,
      ascii: [...bytes].map((c) => (c > 31 && c < 127 ? String.fromCharCode(c) : '.')).join(''),
      b64: whole ? await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(rec.blob); }) : undefined,
    };
  }, [mediaId, whole]);
}

/* ------------------------------------------------------- wake and charter */

await popup.locator('#switch').click();
await popup.waitForTimeout(400);
await popup.locator('#charter').fill('Recording stress');
await popup.locator('#start').click();
await popup.waitForTimeout(1000);

const tabId = await popup.evaluate(
  () => new Promise((r) => chrome.tabs.query({}, (ts) => r(ts.find((t) => t.url.startsWith('http'))?.id)))
);
const shortcut = await popup.evaluate(
  () => new Promise((r) => chrome.commands.getAll((cs) => r(cs.find((c) => c.name === 'record-tab')?.shortcut || '')))
);

/** The refusal `background/media.js` builds when there is no grant, word for word. */
const NO_GRANT =
  'Chrome drops permission to record a tab as soon as it navigates. ' +
  (shortcut
    ? `Press ${shortcut} on the page, or right-click it and choose QA Wrap › Record a video of this tab.`
    : 'Right-click the page and choose QA Wrap → Record a video of this tab.');

try {
  /* 1. what the product says before anything is pressed ------------------ */

  console.log('\nbefore any invocation');
  const before = (await send({ type: 'UQA_CAN_RECORD', tabId }))?.result;
  is('the Record card knows there is no grant yet', { can: before?.can, why: before?.why }, { can: false, why: 'not-invoked' });
  is('and it names the shortcut the tester has actually bound', before?.shortcut, shortcut);

  /* 2. the refusal path -------------------------------------------------- */

  console.log('\nstarting without a grant');
  const sid = await sessionId();
  const clipsBefore = (await clips(sid)).length;
  const refused = await send({ type: 'UQA_RECORD_START', tabId, format: 'mp4' });
  is('a start with no grant is refused', refused?.ok, false);
  is('with the exact wording media.js builds', refused?.error, NO_GRANT);
  is('no clip is stored by a refused start', (await clips(sid)).length, clipsBefore);
  is('and nothing is left recording', (await state())?.recording, false);

  /* 3. stopping when nothing is running ---------------------------------- */

  const idleStop = await send({ type: 'UQA_RECORD_STOP' });
  is('stopping when idle is refused', idleStop?.ok, false);
  is('with the wording the offscreen recorder uses', idleStop?.error, 'Nothing is being recorded.');

  /* 4. storage headroom -------------------------------------------------- */

  console.log('\nwith the disk nearly full');
  /*
   * `navigator.storage.estimate` is replaced inside the worker for one call.
   * The refusal it produces is a number the tester reads, so the number is
   * asserted and not merely the fact that something was refused: 100 MB of
   * quota with 90 MB used leaves 10 MB, and `startRecording` refuses under 50.
   */
  await w.evaluate(() => {
    globalThis.__uqaRealEstimate = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ quota: 100 * 1024 * 1024, usage: 90 * 1024 * 1024 });
  });
  const headroom = (await send({ type: 'UQA_STORAGE' }))?.result;
  is('the headroom report agrees it is low', { free: headroom?.free, low: headroom?.low }, { free: 10 * 1024 * 1024, low: true });
  const full = await send({ type: 'UQA_RECORD_START', tabId, format: 'mp4' });
  is('a start is refused before the capture is even attempted', full?.ok, false);
  is(
    'and the refusal names the megabytes left and what to do',
    full?.error,
    'Only 10MB of storage left. Not enough to record. Delete some old sessions first.'
  );
  await w.evaluate(() => {
    navigator.storage.estimate = globalThis.__uqaRealEstimate;
    delete globalThis.__uqaRealEstimate;
  });
  const restored = (await send({ type: 'UQA_STORAGE' }))?.result;
  truthy('the real headroom is back', restored?.free !== 10 * 1024 * 1024, 'the estimate stub outlived its step');

  /* 5. a genuine grant, and a genuine clip -------------------------------- */

  console.log('\nwith a real activeTab grant');
  await pressRecordShortcut(page);
  await popup.waitForTimeout(1500);

  const granted = (await send({ type: 'UQA_CAN_RECORD', tabId }))?.result;
  is('the shortcut is an invocation, so the tab becomes recordable', granted?.can, true);

  const running = await state();
  is('and the shortcut started the clip itself', running?.recording, true);

  // rec-resize-1027: the tab changes shape mid-clip, as DevTools or a window drag
  // does. The clip must still decode end to end (checked with ffmpeg below).
  await popup.waitForTimeout(1200);
  {
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 780, height: 980 } });
    await cdp.detach().catch(() => {});
  }
  await popup.waitForTimeout(1800);
  const stillRunning = await state();
  is('three seconds later it is still recording', stillRunning?.recording, true);

  await pressRecordShortcut(page);
  await popup.waitForTimeout(2500);

  const after = await state();
  is('pressing the shortcut again stops it', after?.recording, false);

  const stored = await clips(sid);
  const clip = stored.find((m) => m.kind === 'recording');
  truthy('a clip is stored in the session', !!clip, 'no recording was stored');
  const head = clip ? await storedHead(clip.id, true) : null;
  check('the clip decodes with no error although the tab changed size mid-clip (rec-resize-1027)', () => {
    if (!head?.b64) throw new Error('nothing was stored to decode');
    const file = path.join(os.tmpdir(), `qaw-rec-resize-${process.pid}.mp4`);
    fs.writeFileSync(file, Buffer.from(head.b64, 'base64'));
    const ff = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    if (ff.error) { fs.rmSync(file, { force: true }); console.log(`  note  ffmpeg not on PATH, decode not checked: ${ff.error.code}`); return; }
    const errs = ff.stderr.trim().split(/\r?\n/).filter(Boolean);
    if (!errs.length) fs.rmSync(file, { force: true }); // kept on a failure so it can be looked at
    if (errs.length) throw new Error(`${errs.length} decoder errors, first: ${errs[0]} (kept: ${file})`);
  });
  truthy('the stored clip has bytes', (head?.bytes ?? 0) > 0, 'the stored clip is empty');
  check('the stored clip is an MP4 (ftypisom in its first bytes)', () => {
    if (!head) throw new Error('nothing was stored to look at');
    if (!head.ascii.includes('ftypisom')) {
      throw new Error(`first bytes were "${head.ascii}" and the stored type is ${head.type}`);
    }
  });
  truthy(
    'the clip is about three seconds long, not a single frame',
    (clip?.durationMs ?? 0) >= 2000 && (clip?.durationMs ?? 0) <= 12_000,
    `durationMs was ${clip?.durationMs}`
  );

  /* 5b. the microphone, granted, and audible in the clip ------------------ */

  /*
   * The grant survives the stop.
   *
   * Chrome revokes `activeTab` on navigation and on the tab closing, not on a
   * recording ending, so the clip above leaves the tab still recordable and
   * this can start a second one directly with the sources it wants. That is
   * also what a tester gets: press the shortcut once, then use the popup.
   */
  console.log('\nwith the microphone allowed');
  const micStart = await send({ type: 'UQA_RECORD_START', tabId, format: 'mp4', mic: true, webcam: true });
  is('a start with the mic ticked is accepted', micStart?.ok, true);
  is('and the mic is one of the sources the clip records', micStart?.result?.sources?.mic, true);
  is('and so is the camera', micStart?.result?.sources?.webcam, true);
  is('nothing about it was refused', micStart?.result?.refused ?? [], []);
  // 3.8.3: how the frame locked, from the real offscreen document (rvfc = presented frames counted there).
  console.log(`  note  frame lock ${JSON.stringify(micStart?.result?.lock)}`);
  truthy('the start says how its frame locked', !!micStart?.result?.lock?.by, JSON.stringify(micStart?.result?.lock));

  await popup.waitForTimeout(3200);
  const micStop = await send({ type: 'UQA_RECORD_STOP' });
  is('the clip with sound stops cleanly', micStop?.ok, true);
  is('and it is recorded as having had a microphone', micStop?.result?.sources?.mic, true);
  is('and a camera', micStop?.result?.sources?.webcam, true);

  /*
   * Decoded, not inferred.
   *
   * `sources.mic` says a track was attached; it does not say a single sample
   * reached the file, and a silent audio track is exactly what a broken mic
   * path produces. So the stored clip is decoded and the samples measured.
   */
  const sound = await popup.evaluate(async (mid) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('uqa');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const rec = await new Promise((res) => {
      const q = db.transaction('media', 'readonly').objectStore('media').get(mid);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
    db.close();
    if (!rec?.blob) return { error: 'not stored' };
    const ctx2 = new AudioContext();
    try {
      const audio = await ctx2.decodeAudioData(await rec.blob.arrayBuffer());
      const data = audio.getChannelData(0);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
        if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
      }
      return { channels: audio.numberOfChannels, seconds: audio.duration, rms: Math.sqrt(sum / data.length), peak };
    } catch (err) {
      return { error: err.message };
    } finally {
      await ctx2.close().catch(() => {});
    }
  }, micStop?.result?.id);

  truthy('the stored clip has a decodable audio track', !sound?.error && sound?.channels > 0, `decode said ${JSON.stringify(sound)}`);
  truthy('the audio is about as long as the clip', (sound?.seconds ?? 0) >= 2, `audio was ${sound?.seconds}s`);
  // Chrome's fake device is a tone, so silence here means the microphone was
  // attached and carried nothing, which is the defect this step exists for.
  truthy('and it is sound rather than silence', (sound?.rms ?? 0) > 0.001, `RMS was ${sound?.rms}, peak ${sound?.peak}`);

  /*
   * A camera track, proved from the picture rather than from the metadata.
   *
   * A webcam recording is a canvas composite: the tab and the camera are drawn
   * onto one canvas, because a MediaRecorder takes exactly one video track. So
   * "the camera is in the clip" cannot be read off a track list, and what is
   * checked instead is that the composite produced a real picture. The failure
   * this catches is the one that shipped once already: the composite loop drew
   * a single frame, or none, and the clip opened black.
   */
  const picture = await popup.evaluate(async (mid) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('uqa');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const rec = await new Promise((res) => {
      const q = db.transaction('media', 'readonly').objectStore('media').get(mid);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
    db.close();
    if (!rec?.blob) return { error: 'not stored' };
    const url = URL.createObjectURL(rec.blob);
    try {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error('the clip would not open'));
        setTimeout(() => rej(new Error('the clip never reported its metadata')), 8000);
      });
      return { width: v.videoWidth, height: v.videoHeight, seconds: v.duration };
    } catch (err) {
      return { error: err.message };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, micStop?.result?.id);

  truthy('the webcam composite produced a real picture', (picture?.width ?? 0) > 0 && (picture?.height ?? 0) > 0, `video was ${JSON.stringify(picture)}`);
  truthy('and the picture lasts as long as the clip', (picture?.seconds ?? 0) >= 2, `video was ${picture?.seconds}s`);

  /* 5c. tab sound ---------------------------------------------------------- */

  /*
   * Tab audio is not a device and needs no grant: Chrome hands the tab's own
   * output to the capture stream. It has its own failure, and it is the one
   * testers report as "the video has no sound": the audio track is attached and
   * carries silence. So the fixture is asked to play a 440 Hz tone, and the
   * stored clip is decoded and measured, exactly as the microphone is.
   */
  console.log('\nwith the tab making a sound');
  await page.bringToFront();
  await page.evaluate(() => window.startTone());
  await popup.waitForTimeout(500);

  const tabStart = await send({ type: 'UQA_RECORD_START', tabId, format: 'mp4', tabAudio: true });
  is('a start with tab sound ticked is accepted', tabStart?.ok, true);
  is('and tab sound is one of the sources', tabStart?.result?.sources?.tabAudio, true);
  await popup.waitForTimeout(3200);
  const tabStop = await send({ type: 'UQA_RECORD_STOP' });
  is('the clip with tab sound stops cleanly', tabStop?.ok, true);

  const tabSound = await popup.evaluate(async (mid) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('uqa');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const rec = await new Promise((res) => {
      const q = db.transaction('media', 'readonly').objectStore('media').get(mid);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
    db.close();
    if (!rec?.blob) return { error: 'not stored' };
    const ac = new AudioContext();
    try {
      const audio = await ac.decodeAudioData(await rec.blob.arrayBuffer());
      const data = audio.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return { seconds: audio.duration, rms: Math.sqrt(sum / data.length) };
    } catch (err) {
      return { error: err.message };
    } finally {
      await ac.close().catch(() => {});
    }
  }, tabStop?.result?.id);

  truthy('the tab-sound clip has a decodable audio track', !tabSound?.error, `decode said ${JSON.stringify(tabSound)}`);
  truthy('and the tab tone is in it rather than silence', (tabSound?.rms ?? 0) > 0.001, `RMS was ${tabSound?.rms}`);

  /* 6. the grant dies on navigation ---------------------------------------- */

  /*
   * Two navigations, because Chrome and the product do not draw the line in the
   * same place, and the difference is worth pinning down rather than
   * discovering again.
   *
   * The product drops its grant on any commit (`forgetInvoked` on
   * `webNavigation.onCommitted`). Chrome keeps `activeTab` across a same-origin
   * navigation and revokes it when the origin changes. So after a reload with a
   * query string the product answers "not recordable" while `getMediaStreamId`
   * would in fact still work: the product is the conservative one, which is the
   * right way round for a capture permission. The refusal is therefore asserted
   * after a real cross-origin move.
   *
   * `localhost` and `127.0.0.1` are the same server and two different origins,
   * which is all that move has to be.
   */
  /*
   * Rule 4 (3.8.3): Stop pressed while the clip is still starting. Every surface shows "recording" from the press, so
   * the Stop must either file what was recorded or the start must refuse; it used to answer "That clip is still
   * starting", the start finished afterwards, and the clip the tester stopped was never filed.
   */
  console.log('\nStop pressed while the start is still running');
  {
    const startP = send({ type: 'UQA_RECORD_START', tabId, format: 'mp4' });
    await popup.waitForTimeout(60);
    const mid = await state();
    const early = await send({ type: 'UQA_RECORD_STOP' });
    const st = await startP;
    console.log(`  note  state at the Stop ${JSON.stringify({ recording: mid?.recording, starting: mid?.starting })}; start ${JSON.stringify({ ok: st?.ok, lock: st?.result?.lock?.by })}; stop ${JSON.stringify({ ok: early?.ok, error: early?.error, ms: early?.result?.durationMs })}`);
    check('a Stop during the start files the clip, or the start refused and nothing was shown', () => {
      if (st?.ok && !early?.ok) throw new Error(`the start went on but the Stop was refused: ${early?.error}`);
      if (!st?.ok && early?.ok) throw new Error('the start failed but the Stop claims a clip');
    });
    if (early?.ok) {
      const h = await storedHead(early.result?.id, true);
      truthy('and the early-stopped clip is stored with bytes', (h?.bytes ?? 0) > 0, `stored ${JSON.stringify(h && { bytes: h.bytes })}`);
    }
    is('nothing is left recording after it', (await state())?.recording, false);
  }

  console.log('\nafter the page navigates');
  await page.goto(URL_ + '?again');
  await popup.waitForTimeout(900);
  const afterNav = (await send({ type: 'UQA_CAN_RECORD', tabId }))?.result;
  is('a reload costs the grant as far as the product is concerned', { can: afterNav?.can, why: afterNav?.why }, { can: false, why: 'not-invoked' });

  await page.goto(CROSS_URL);
  await popup.waitForTimeout(900);
  const afterCross = (await send({ type: 'UQA_CAN_RECORD', tabId }))?.result;
  is('and a move to another origin costs it in Chrome too', { can: afterCross?.can, why: afterCross?.why }, { can: false, why: 'not-invoked' });
  const navStart = await send({ type: 'UQA_RECORD_START', tabId, format: 'mp4' });
  is('a start after a cross-origin navigation is refused', navStart?.ok, false);
  is('with the same wording as before', navStart?.error, NO_GRANT);
  is('and nothing was left half started', (await state())?.recording, false);

  /* 7. two starts at once -------------------------------------------------- */

  console.log('\npressing Record twice');
  await pressRecordShortcut(page);
  await popup.waitForTimeout(1500);
  is('the first press is recording', (await state())?.recording, true);
  const second = await send({ type: 'UQA_RECORD_START', tabId });
  is('a second start is refused', second?.ok, false);
  check('and it says a recording cannot change what it is filming', () => {
    const text = String(second?.error || '');
    if (!/Already recording a tab\./.test(text) || !/cannot change what it is filming/.test(text)) {
      throw new Error(`refusal read: ${text}`);
    }
  });
  const clipsWhileRunning = (await clips(sid)).length;
  const stop = await send({ type: 'UQA_RECORD_STOP' });
  is('the first clip still stops cleanly', stop?.ok, true);
  is('and exactly one more clip is stored', (await clips(sid)).length, clipsWhileRunning + 1);

  /* 8. the recorded tab closes mid-clip ------------------------------------ */

  console.log('\nwhen the recorded tab closes mid-clip');
  const doomed = await ctx.newPage();
  await doomed.goto(URL_);
  await doomed.waitForTimeout(400);
  const doomedId = await popup.evaluate(
    () => new Promise((r) => chrome.tabs.query({}, (ts) => r(ts.filter((t) => t.url.startsWith('http')).pop()?.id)))
  );
  await pressRecordShortcut(doomed);
  await popup.waitForTimeout(1600);
  is('the doomed tab is recording', (await state())?.recording, true);
  const beforeClose = (await clips(sid)).length;

  await doomed.close();
  await popup.waitForTimeout(4000);

  const afterClose = await state();
  is('the recorder does not keep encoding a dead source', afterClose?.recording, false);
  truthy(
    'the part that was filmed is saved rather than thrown away',
    (await clips(sid)).length === beforeClose + 1,
    `clips went from ${beforeClose} to ${(await clips(sid)).length}`
  );
  const rescueStop = await send({ type: 'UQA_RECORD_STOP' });
  is('and a Stop pressed afterwards is refused, not a second save', rescueStop?.ok, false);
  is('with the same idle wording as before', rescueStop?.error, 'Nothing is being recorded.');
  truthy(
    'the closed tab keeps no grant behind it',
    (await send({ type: 'UQA_CAN_RECORD', tabId: doomedId }))?.result?.can !== true,
    'a closed tab still reports itself recordable'
  );

  /* 9. sleep stops the clip and saves it ----------------------------------- */

  console.log('\nwhen the window goes to sleep mid-clip');
  await pressRecordShortcut(page);
  await popup.waitForTimeout(1800);
  is('a clip is running before sleep', (await state())?.recording, true);
  const beforeSleep = (await clips(sid)).length;

  const slept = await send({ type: 'UQA_DISARM' });
  await popup.waitForTimeout(1500);
  is('sleep succeeds', slept?.ok, true);
  truthy('sleep reports the clip it stopped', !!slept?.result?.stopped?.clip, 'sleepWindow reported no clip');
  is('nothing is recording after sleep', (await state())?.recording, false);
  const sleepClip = await storedHead(slept?.result?.stopped?.clip);
  truthy('the clip sleep stopped is on disk', (sleepClip?.bytes ?? 0) > 0, 'the clip sleep saved is empty or absent');
  is('and it is labelled as what stopped it', sleepClip?.label, 'Stopped by sleep');
  is('the session gained exactly that one clip', (await clips(sid)).length, beforeSleep + 1);

  /* 10. and the extension still works afterwards --------------------------- */

  /*
   * Through the message layer rather than the popup's controls. Waking and
   * chartering a session are the click-through suite's subject; what matters
   * here is that recording comes back after a sleep took a clip out from under
   * it, and driving that through a repainting popup would only add a second
   * thing that can fail.
   */
  console.log('\nafter all of that');
  const woke = await send({ type: 'UQA_ARM' });
  is('the window wakes again', woke?.result?.armed, true);
  const fresh = await send({ type: 'UQA_START', charter: 'After the stress' });
  is('a new session starts', fresh?.ok, true);
  const sid2 = await sessionId();
  truthy('and it is a different session', !!sid2 && sid2 !== sid, `session id was ${sid2}`);
  await pressRecordShortcut(page);
  await popup.waitForTimeout(2500);
  is('and recording still works', (await state())?.recording, true);
  const last = await send({ type: 'UQA_RECORD_STOP' });
  is('the last clip stops', last?.ok, true);
  truthy('with bytes in it', (last?.result?.bytes ?? 0) > 0, `bytes were ${last?.result?.bytes}`);
  if (!last?.ok) console.log(`  note  step 10 state ${JSON.stringify(await state())}, stop said ${JSON.stringify(last)}`);
  const lastHead = last?.result?.id ? await storedHead(last.result.id) : null;
  is('filed under the new session, not the old one', lastHead?.sessionId, sid2);
  /* 11. the screen, not the tab ------------------------------------------- */

  /*
   * R30. "The screen recording for windows keeps erroring on starting the
   * record" — and it had never worked, on any platform, since the day it was
   * written. Every press ended in `AbortError: Error starting tab capture`,
   * which names the wrong API and no reason.
   *
   * A `chrome.desktopCapture` stream id is bound to the render frame that asked
   * for it, so an id minted by the service worker could never be opened by the
   * offscreen document that does the recording. `getDisplayMedia`, called in
   * the offscreen document itself, needs no id to cross a frame boundary.
   * `tools/test-screen-recording.mjs` holds the measurements and the unit
   * assertions; this is the end-to-end proof that a screen clip records.
   */
  console.log('\nthe screen, which is a different capture from the tab');

  /*
   * First the refusal, which is what a tester meets before they have granted
   * anything, and which has to name the next step rather than a permission.
   */
  const ungranted = await send({ type: 'UQA_RECORD_SCREEN', mic: false, systemAudio: false, webcam: false });
  is('a screen recording with no permission is refused', ungranted?.ok, false);
  is(
    'and the refusal says what to press, not what is missing',
    ungranted?.error,
    'Chrome needs your permission to record a screen. QA Wrap Settings is opening at ' +
      'the Permissions section: press "Allow screen recording" there, then press Record again.'
  );

  /*
   * Then the recording itself, in a second browser that already holds it.
   *
   * `desktopCapture` is optional, and `chrome.permissions.request` is answered
   * by a bubble the *browser* draws, not any page — measured here: the request
   * sits unanswered for forty-five seconds, because there is no element for a
   * harness to click. So the second browser loads the same extension with that
   * one permission moved from `optional_permissions` into `permissions`, which
   * is the state a tester's browser is in one press after they grant it.
   *
   * **That manifest line is the only difference.** Not the recorder, not the
   * offscreen document, not the picker: the same files, copied by the same
   * `copyShipping` that builds the store package.
   */
  const GRANTED_EXT = grantedExtension({ desktopCapture: true, label: 'screen' });

  let permissionHeld = null;
  let screenStart = null;
  let screenState = null;
  let screenStop = null;
  let screenHead = null;
  let afterScreen = null;
  let screenSession = null;
  const grantedBase = launchOptions(GRANTED_EXT);
  /*
   * The second profile's worker cache, purged like the first one's.
   *
   * It never was, and it cost an afternoon on 8 September 2026. Chrome revives
   * the service worker it cached inside the profile, and `freshWorker()` can
   * only tell that it is stale by comparing the *version* — so a change made
   * without a version bump comes back as yesterday's worker running today's
   * pages, silently. The symptom was a screen browser in which no page script
   * was ever registered, with the permission plainly granted and nothing in
   * the log. See `purgeWorkerCache` in tools/lib-fresh.mjs.
   */
  purgeWorkerCache(profile('.rec-screen-profile'));
  const ctx2 = await chromium.launchPersistentContext(profile('.rec-screen-profile'), {
    ...grantedBase,
    viewport: { width: 1000, height: 700 },
    args: [...grantedBase.args, '--auto-select-desktop-capture-source=Entire screen'],
  });
  try {
    const w2 = await freshWorker(ctx2);
    const id2 = new URL(w2.url()).host;
    await seedConsent(w2);
    // And the page scripts in place before anything navigates. See lib-granted.mjs.
    await awaitSiteScripts(w2);
    w2.on('console', (m) => {
      if (m.type() === 'error') errs.push('[screen worker] ' + m.text());
    });
    const page2 = await ctx2.newPage();
    await page2.goto(URL_);
    const popup2 = await ctx2.newPage();
    await popup2.goto(`chrome-extension://${id2}/popup/popup.html`);
    await popup2.waitForTimeout(900);
    const send2 = (m) => popup2.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
    await send2({ type: 'UQA_ARM' });
    await send2({ type: 'UQA_START', charter: 'Screen recording' });
    screenSession = (await send2({ type: 'UQA_GET_STATE' }))?.result?.session?.id;
    permissionHeld = await popup2.evaluate(
      () => new Promise((r) => chrome.permissions.contains({ permissions: ['desktopCapture'] }, r))
    );

    /*
     * A screen capture only encodes what changes. On a shared, idle desktop the
     * picture can be a single still frame, and a clip of one frame is under the
     * byte floor below: the flake of 30 September 2026 (2, 7 and 5 failures on
     * three runs, this group varying). So put something moving on the screen
     * and hold it in front, then record across more than one 2 s timeslice.
     */
    await page2.bringToFront();
    await page2.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:200px;z-index:2147483647;background:#e33';
      d.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(600px)' }], { duration: 800, iterations: Infinity, direction: 'alternate' });
      document.body.appendChild(d);
    });
    screenStart = await send2({ type: 'UQA_RECORD_SCREEN', mic: false, systemAudio: false, webcam: false });
    screenState = (await send2({ type: 'UQA_RECORD_STATE' }))?.result;
    await popup2.waitForTimeout(4500);
    screenStop = await send2({ type: 'UQA_RECORD_STOP', label: 'Screen recording' });
    if (screenStop?.result?.id) {
      screenHead = await popup2.evaluate(async (mid) => {
        const db = await new Promise((res, rej) => {
          const q = indexedDB.open('uqa');
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        const rec = await new Promise((res) => {
          const q = db.transaction('media', 'readonly').objectStore('media').get(mid);
          q.onsuccess = () => res(q.result);
          q.onerror = () => res(null);
        });
        db.close();
        return rec?.blob ? { bytes: rec.bytes, sessionId: rec.sessionId, sources: rec.sources } : null;
      }, screenStop.result.id);
    }
    afterScreen = await send2({ type: 'UQA_RECORD_STATE' });
  } finally {
    await ctx2.close();
    fs.rmSync(GRANTED_EXT, { recursive: true, force: true });
  }

  is('the permission is held, with no bubble for anybody to answer', permissionHeld, true);
  is('pressing Record with the screen scope starts a recording', screenStart?.ok, true);
  truthy(
    'and it does not come back as the tester having cancelled',
    !screenStart?.result?.cancelled,
    'the picker answered as a cancel'
  );
  is('what is filmed is the screen, not a tab', screenStart?.result?.sources?.screen, true);
  is('and the tab source is off, so the two cannot be confused', screenStart?.result?.sources?.tab, false);
  is('the scope travels back to the surface that asked', screenStart?.result?.scope, 'screen');
  is('the recorder says it is recording', screenState?.recording, true);
  is('and it says the screen is what it holds', screenState?.sources?.screen, true);
  is('the screen clip stops', screenStop?.ok, true);
  truthy(
    'with real bytes in it',
    (screenStop?.result?.bytes ?? 0) > 10_000,
    `a screen clip of ${screenStop?.result?.bytes} bytes is not a recording of anything`
  );
  truthy('and it is on disk', (screenHead?.bytes ?? 0) > 0, 'the screen clip was not stored');
  is('filed under the session that was running', screenHead?.sessionId, screenSession);
  is('and the stored record says it was the screen', screenHead?.sources?.screen, true);
  is('nothing is left recording afterwards', afterScreen?.result?.recording, false);
} finally {
  await ctx.close();
  server.close();
}

/*
 * Console errors are reported, never counted as a result.
 *
 * They were the whole of the old summary, which is how a run where nothing
 * worked reported "errors: none" and was quoted as proof that everything did.
 */
console.log('\nconsole errors:', errs.length ? '\n  ' + errs.join('\n  ') : 'none');
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('  ' + failures.join('\n  '));
  process.exit(1);
}
