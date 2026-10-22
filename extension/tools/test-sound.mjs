/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The recorded UI sounds (6 Oct 2026): the files and their rights, the table
 * that plays them, the rules of play, the wiring, and the fence around the
 * service-worker boot graph.
 *
 * What a sound actually sounds like is not testable here and nobody has listened
 * to this set: Nader checks it by ear. What is testable is that every name maps
 * to a file that exists, every file is used and has its licence on record, the
 * gain table follows its stated rule (and `error` ends up the loudest sound),
 * and the player drops what it should without a real AudioContext.
 *
 * ffmpeg is not needed here: tools/sound-measure.mjs measured the files into
 * tools/sound-levels.json, and this suite checks that record against the files'
 * hashes and the table's trims.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(EXT, rel))).digest('hex');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ------------------------------------------------------ a fake audio graph */

/** Load a fresh copy of sound.js against a fake AudioContext, fetch and runtime. */
async function load({ hidden = false, decode = true } = {}) {
  const log = { buffers: [], started: 0, released: 0, fetched: [], sent: [], created: 0, resumed: 0 };
  let now = 0;
  const node = () => ({
    gain: { value: 1, setTargetAtTime(_t, at, tau) { if (tau === 0.004 && at === now) log.released++; } },
    connect(x) { return x; },
    start() { log.started++; log.buffers.push(this.buffer?.length); },
  });
  class Ctx {
    constructor() { this.state = 'suspended'; this.destination = node(); log.created++; }
    get currentTime() { return now; }
    resume() { log.resumed++; return Promise.resolve(); }
    createGain() { return node(); }
    createBufferSource() { return node(); }
  }
  class Offline {
    decodeAudioData(bytes) { return decode ? Promise.resolve({ duration: 0.3, length: bytes.byteLength }) : Promise.reject(new Error('bad data')); }
  }
  globalThis.fetch = async (url) => { log.fetched.push(url); return { arrayBuffer: async () => new ArrayBuffer([...url].reduce((n, c) => n + c.charCodeAt(0), 0)) }; };
  globalThis.chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: (m) => { log.sent.push(m); return Promise.resolve(); },
    },
  };
  const win = { AudioContext: Ctx, OfflineAudioContext: Offline };
  const doc = { hidden, addEventListener() {} };
  new Function('window', 'document', 'performance', read('ui/sound.js'))(win, doc, { now: () => 0 });
  let t = 1e6;
  const S = win.UQASound;
  const clock = { at: (ms) => (t = 1e6 + ms) };
  S.configure({ on: true, level: 1, scope: 'all', clock: () => t });
  if (!hidden) await S.preload();
  return { S, log, clock, doc, win, setNow: (x) => { now = x; } };
}

const stub = await load();
const S = stub.S;

/* ------------------------------------------------------ the files and their rights */

console.log('sound files: every name has a file, every file a licence');

const CORE = ['wake', 'sleep', 'start', 'stop', 'shot', 'done', 'notice', 'error'];
const TOUCH = ['tap', 'on', 'off', 'open', 'close', 'remove', 'copy'];
const levels = JSON.parse(read('tools/sound-levels.json'));
const onDisk = fs.readdirSync(path.join(EXT, 'ui/sfx')).filter((f) => /\.(ogg|wav)$/.test(f)).sort();
const referenced = Object.values(S.SOUNDS).flatMap((s) => s.files.map((f) => f.file));

await test('fifteen sound names: eight core moments and seven touch sounds', () => {
  assert.deepEqual(Object.keys(S.SOUNDS).filter((n) => S.SOUNDS[n].scope === 'core').sort(), [...CORE].sort());
  assert.deepEqual(Object.keys(S.SOUNDS).filter((n) => S.SOUNDS[n].scope === 'touch').sort(), [...TOUCH].sort());
  assert.deepEqual(Object.keys(S.SOUND_SCOPE).sort(), Object.keys(S.SOUNDS).sort());
});

await test('every sound name maps to a file that exists, and every file on disk is used once', () => {
  for (const f of referenced) assert.ok(onDisk.includes(f), `${f} is in the table and not on disk`);
  assert.deepEqual([...onDisk], [...referenced].sort(), 'files on disk and files in the table differ');
  assert.equal(new Set(referenced).size, referenced.length, 'a file is listed twice');
  assert.equal(onDisk.length, 24);
  assert.deepEqual([...S.FILES].sort(), onDisk);
});

await test('the licence is on record: every recorded layer with author, URL, CC0 licence and date, the 128 kbps note, and a NOTICE line', () => {
  const credits = read('ui/sfx/CREDITS.txt');
  assert.match(credits, /https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//);
  assert.match(credits, /http:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//);
  assert.match(credits, /Glass & Air/);
  assert.match(credits, /original synthesis/);
  assert.match(credits, /2026-10-06/);
  assert.match(credits, /128 kbps preview/);
  const layers = [...credits.matchAll(/^URL:\s+(https:\/\/freesound\.org\/people\/[\w-]+\/sounds\/\d+)$/gm)].map((m) => m[1]);
  assert.ok(layers.length >= 20, `only ${layers.length} layers listed`);
  assert.equal(new Set(layers).size, layers.length, 'a layer is listed twice');
  const blocks = credits.split(/\n\n/).filter((x) => /^Title:/m.test(x));
  assert.equal(blocks.length, layers.length);
  for (const blk of blocks) {
    assert.match(blk, /^Author:\s+\S/m);
    assert.match(blk, /^Licence: CC0 1\.0, https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/$/m);
    assert.match(blk, /^Format:\s+128 kbps preview, retrieved 2026-10-06/m);
  }
  assert.ok(!/kenney/i.test(credits), 'CREDITS.txt still names Kenney');
  assert.ok(!fs.existsSync(path.join(EXT, 'ui/sfx/kenney-license.txt')), 'a Kenney licence file still ships');
  assert.match(read('NOTICE'), /ui\/sfx\/CREDITS\.txt/);
  assert.ok(!/kenney/i.test(read('NOTICE')), 'NOTICE still names Kenney');
  assert.ok(!/no third-party audio/i.test(read('NOTICE')), 'NOTICE still claims there is no third-party audio');
});

await test('every file is listed in CREDITS.txt and sound-levels.json with the sha256 of the file as shipped', () => {
  const credits = read('ui/sfx/CREDITS.txt');
  for (const f of onDisk) {
    const h = sha(`ui/sfx/${f}`);
    assert.ok(credits.includes(`${h}  ${f}`), `${f}: CREDITS.txt has no matching sha256 line`);
    assert.equal(levels[f]?.sha256, h, `${f}: sound-levels.json is stale (run tools/sound-measure.mjs)`);
  }
  assert.deepEqual(Object.keys(levels).sort(), onDisk);
  const hashes = onDisk.map((f) => levels[f].sha256);
  assert.equal(new Set(hashes).size, hashes.length, 'two files are the same file');
});

await test('every file is a short OGG: 0.04 to 1.00 s, inside the 3 s of WCAG 1.4.2', () => {
  for (const f of onDisk) {
    const magic = 'OggS';
    assert.equal(fs.readFileSync(path.join(EXT, 'ui/sfx', f)).subarray(0, 4).toString('latin1'), magic, `${f} is not a ${magic} file`);
    assert.ok(levels[f].duration >= 0.04 && levels[f].duration <= 1, `${f} is ${levels[f].duration} s`);
  }
});

/* The rule in the header of ui/sound.js: the A4 files are loudness-matched, so trim is 0 dB, except error (+2.5). */
const finals = [];
for (const [name, s2] of Object.entries(S.SOUNDS)) {
  for (const f of s2.files) {
    const m = levels[f.file];
    finals.push({ name, file: f.file, trim: f.trim, peak: m.peak + f.trim, mean: m.mean + f.trim, scope: s2.scope });
  }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

await test('the gain table is unity except error (+2.5 dB), and no file ends at or above -1 dBFS', () => {
  for (const x of finals) {
    const want = x.name === 'error' ? 2.5 : 0;
    assert.ok(Math.abs(x.trim - want) <= 0.15, `${x.file}: trim ${x.trim}, expected ${want}`);
    assert.ok(x.peak <= -1, `${x.file}: final peak ${x.peak.toFixed(1)} can clip`);
  }
});

await test('every file in a class sits inside its loudness window (measured, volumedetect mean)', () => {
  for (const x of finals) {
    if (x.scope === 'core') assert.ok(x.mean >= -27.5 && x.mean <= -18, `${x.file}: mean ${x.mean.toFixed(1)}`);
    else assert.ok(x.mean >= -32.5 && x.mean <= -25, `${x.file}: mean ${x.mean.toFixed(1)}`);
  }
});

await test('error is the loudest sound after gain, by peak and by mean', () => {
  const err = finals.find((x) => x.name === 'error');
  for (const x of finals.filter((y) => y.name !== 'error')) {
    assert.ok(err.peak > x.peak, `error peak ${err.peak.toFixed(1)} is not above ${x.file} (${x.peak.toFixed(1)})`);
    assert.ok(err.mean > x.mean, `error mean ${err.mean.toFixed(1)} is not above ${x.file} (${x.mean.toFixed(1)})`);
  }
});

await test('touch sounds are quieter than moments: class medians 3 dB apart by mean, and no touch peak above a moment peak', () => {
  const core = finals.filter((x) => x.scope === 'core');
  const touch = finals.filter((x) => x.scope === 'touch');
  assert.ok(median(touch.map((x) => x.mean)) < median(core.map((x) => x.mean)) - 3, 'class medians too close');
  assert.ok(Math.max(...touch.map((x) => x.peak)) < Math.min(...core.map((x) => x.peak)) + 0.001, 'a touch peak is above a moment peak');
});

await test('round-robin sets: tap has 3 files; shot, on, off, open, close, remove, copy have 2; the rest 1', () => {
  const want = { tap: 3, shot: 2, on: 2, off: 2, open: 2, close: 2, remove: 2, copy: 2, wake: 1, sleep: 1, start: 1, stop: 1, done: 1, notice: 1, error: 1 };
  for (const [n, k] of Object.entries(want)) assert.equal(S.SOUNDS[n].files.length, k, n);
});

await test('the confusable pairs are different sounds: no shared file, no shared hash, and the length class that keeps them apart (A4 distinctness)', () => {
  const pairs = [['start', 'open'], ['stop', 'close'], ['wake', 'start'], ['sleep', 'stop'], ['on', 'open'], ['off', 'close'], ['done', 'notice'],
    ['copy', 'tap'], ['shot', 'tap'], ['remove', 'close'], ['error', 'stop'], ['start', 'stop'], ['on', 'off'], ['open', 'close']];
  const files = (n) => S.SOUNDS[n].files.map((f) => f.file);
  for (const [a, b] of pairs) {
    const fa = files(a), fb = files(b);
    assert.ok(fa.every((f) => !fb.includes(f)), `${a} and ${b} share a file`);
    const ha = new Set(fa.map((f) => levels[f].sha256));
    assert.ok(fb.every((f) => !ha.has(levels[f].sha256)), `${a} and ${b} share a hash`);
  }
  const len = (n) => Math.max(...files(n).map((f) => levels[f].duration));
  const lenMin = (n) => Math.min(...files(n).map((f) => levels[f].duration));
  for (const n of ['wake', 'sleep']) assert.ok(lenMin(n) >= 0.9, `${n} is the longest class (>= 0.9 s), got ${lenMin(n)}`);
  for (const n of ['start', 'stop']) assert.ok(lenMin(n) >= 0.75 && len(n) <= 0.95, `${n} is a long two-note signature (0.75 to 0.95 s), got ${lenMin(n)}`);
  for (const n of ['open', 'close']) assert.ok(len(n) <= 0.3, `${n} is a short air swell (<= 0.3 s), got ${len(n)}`);
  for (const n of ['on', 'off']) assert.ok(len(n) <= 0.25, `${n} is a switch click (<= 0.25 s), got ${len(n)}`);
  for (const n of ['start', 'stop']) for (const m of ['open', 'close', 'on', 'off', 'remove', 'copy', 'tap']) assert.ok(lenMin(n) >= 2.5 * len(m), `${n} is not at least 2.5x as long as ${m}`);
});

console.log('\nsound events: nothing dead, nothing misspelled');

await test('every event maps to a sound, and every sound has an event', () => {
  assert.equal(Object.keys(S.EVENTS).length, 53);
  for (const [event, id] of Object.entries(S.EVENTS)) assert.ok(S.SOUNDS[id], `"${event}" points at "${id}", which is not a sound`);
  const reachable = new Set(Object.values(S.EVENTS));
  const orphans = Object.keys(S.SOUNDS).filter((id) => !reachable.has(id));
  assert.deepEqual(orphans, [], `unreachable: ${orphans.join(', ')}`);
});

/** Every `play('x')`, `uqaSound()?.play('x')` and `data-sound="x"` in the pages. */
function callSites() {
  const names = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(EXT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!['node_modules', 'vendor', 'tools', 'tutorials/media'].includes(e.name)) walk(rel); continue; }
      if (!/\.(js|html)$/.test(e.name) || rel === 'ui/sound.js' || /\.min\./.test(e.name)) continue;
      const src = read(rel);
      for (const m of src.matchAll(/UQASound\??\.play\(\s*'([\w.-]+)'/g)) names.set(m[1], rel);
      for (const m of src.matchAll(/\.play\(\s*(?:full \? '([\w.-]+)' : '([\w.-]+)'|res\.ok \? '([\w.-]+)' : '([\w.-]+)')/g)) for (const n of m.slice(1)) if (n) names.set(n, rel);
      for (const m of src.matchAll(/data-sound="([\w.-]+)"/g)) names.set(m[1], rel);
    }
  };
  for (const d of ['popup', 'options', 'report', 'annotate', 'devtools', 'diagram', 'tutorials', 'videoedit', 'offscreen', 'ui', 'content']) walk(d);
  return names;
}

await test('every name a call site plays is a real event or sound (a typo plays nothing, silently)', () => {
  const sites = callSites();
  assert.ok(sites.size > 15, `only ${sites.size} call-site names found; the scanner is broken`);
  for (const [name, file] of sites) {
    assert.ok(name === 'none' || name in S.EVENTS || name in S.SOUNDS, `${file} plays "${name}", which is not an event`);
  }
});

await test('every core sound is reachable from a call site or a pop-up wiring', () => {
  const sites = new Set([...callSites().keys()]);
  const popup = surfaceSource('popup/popup.js') + read('background/media.js');
  for (const name of CORE) {
    const events = Object.keys(S.EVENTS).filter((e) => S.EVENTS[e] === name);
    const hit = events.some((e) => sites.has(e) || popup.includes(`'${e}'`) || popup.includes(e));
    assert.ok(hit, `no call site plays the "${name}" sound (events: ${events.join(', ')})`);
  }
});

console.log('\nsound.js: the player and its rules (fake clock, fake audio)');

await test('preload fetches every file from the extension\'s own origin, once, and decodes it', async () => {
  const h = await load();
  assert.equal(h.log.fetched.length, 24);
  assert.ok(h.log.fetched.every((u) => /^chrome-extension:\/\/test\/ui\/sfx\/[\w]+\.ogg$/.test(u)), h.log.fetched.join(', '));
  assert.equal(await h.S.preload(), 24, 'a second preload reuses the first');
  assert.equal(h.log.fetched.length, 24);
  assert.equal(h.log.created, 0, 'decoding must not create a playing AudioContext');
});

await test('a sound that is not decoded yet plays nothing and returns false', async () => {
  const h = await load({ decode: false });
  h.clock.at(0);
  assert.equal(h.S.play('scan.clean'), false);
  assert.equal(h.log.started, 0);
});

await test('play() of an unknown name, "none" and a muted volume play nothing', async () => {
  const { S: s, clock } = await load();
  clock.at(0);
  assert.equal(s.play('no.such.event'), false);
  assert.equal(s.play('none'), false);
  s.configure({ level: 0 });
  assert.equal(s.play('scan.clean'), false);
});

await test('a played sound starts one buffer, and the first press creates and resumes the context', async () => {
  const { S: s, log, clock } = await load();
  clock.at(0);
  assert.equal(s.play('scan.clean'), true);
  assert.equal(log.started, 1);
  assert.equal(log.created, 1);
  assert.equal(log.resumed, 1);
});

await test('rule 1: the same sound is dropped inside 60 ms', async () => {
  const { S: s, clock } = await load();
  clock.at(0); assert.equal(s.play('ui.tap'), true);
  clock.at(40); assert.equal(s.play('ui.tap'), false, 'inside 60 ms');
  clock.at(70); assert.equal(s.play('ui.tap'), true, 'after 60 ms');
});

await test('round-robin: a name with several files picks at random and never the same file twice in a row', async () => {
  const { S: s2, log, clock } = await load();
  const n = 60;
  for (let i = 0; i < n; i++) { clock.at(i * 500); assert.equal(s2.play('ui.tap'), true); }
  assert.equal(log.started, n);
  for (let i = 1; i < n; i++) assert.notEqual(log.buffers[i], log.buffers[i - 1], `play ${i} repeats the file of play ${i - 1}`);
  assert.equal(new Set(log.buffers).size, 3, 'all three tap variants are used');
  for (const [event, k] of [['ui.on', 2], ['ui.off', 2], ['ui.open', 2], ['ui.close', 2], ['ui.remove', 2], ['ui.copy', 2], ['capture.shot', 2]]) {
    const h = await load();
    for (let i = 0; i < 20; i++) { h.clock.at(i * 2000); assert.equal(h.S.play(event), true); }
    assert.equal(new Set(h.log.buffers).size, k, `${event} uses ${k} files`);
    for (let i = 1; i < 20; i++) assert.notEqual(h.log.buffers[i], h.log.buffers[i - 1], `${event} repeats`);
  }
});

await test('round-robin picks follow Math.random but still skip the last file', async () => {
  const real = Math.random;
  try {
    Math.random = () => 0; // always asks for the first candidate
    const { S: s2, log, clock } = await load();
    for (let i = 0; i < 6; i++) { clock.at(i * 500); s2.play('ui.tap'); }
    for (let i = 1; i < 6; i++) assert.notEqual(log.buffers[i], log.buffers[i - 1]);
    Math.random = () => 0.999999;
    const h = await load();
    for (let i = 0; i < 6; i++) { h.clock.at(i * 500); h.S.play('ui.tap'); }
    for (let i = 1; i < 6; i++) assert.notEqual(h.log.buffers[i], h.log.buffers[i - 1]);
  } finally { Math.random = real; }
});

await test('rule 2: a touch sound yields to a different sound within 120 ms; a moment never yields', async () => {
  const { S: s, clock } = await load();
  clock.at(0); assert.equal(s.play('ui.tap'), true);
  clock.at(30); assert.equal(s.play('status.ok'), false, 'status.ok is copy (touch): the click came first');
  clock.at(110); assert.equal(s.play('ui.on'), false, 'still inside 120 ms of the tap');
  clock.at(1000); assert.equal(s.play('scan.clean'), true);
  clock.at(1100); assert.equal(s.play('ui.tap'), false, 'a touch sound inside 120 ms of a moment');
  clock.at(1200); assert.equal(s.play('ui.tap'), true);
  clock.at(1210); assert.equal(s.play('export.done'), true, 'a moment is never dropped by the class rule');
  clock.at(1220); assert.equal(s.play('status.error'), true);
});

await test('rule 3: over three at once the oldest touch sound is released; a moment is never cut', async () => {
  const { S: s, log, clock } = await load();
  clock.at(0); assert.equal(s.play('ui.tap'), true);
  for (const [i, e] of ['switch.wake', 'session.start'].entries()) { clock.at(500 + i * 10); assert.equal(s.play(e), true); }
  assert.equal(log.released, 0);
  clock.at(600); assert.equal(s.play('session.stop'), true);
  assert.equal(log.released, 1, 'the tap was released');
  clock.at(700); assert.equal(s.play('status.error'), true, 'a fourth moment still plays, nothing left to release');
  assert.equal(log.released, 1);
  clock.at(2000); assert.equal(s.play('ui.on'), false, 'a touch sound gives way when only moments are sounding');
});

await test('rule 4: hidden, disabled, suspended and out-of-scope all play nothing', async () => {
  assert.equal((await load({ hidden: true })).S.play('scan.clean'), false, 'hidden document');
  const a = await load(); a.S.configure({ on: false }); assert.equal(a.S.play('scan.clean'), false, 'disabled');
  const b = await load(); b.S.configure({ suspended: true }); assert.equal(b.S.play('scan.clean'), false, 'suspended');
  b.S.configure({ suspended: false }); b.clock.at(5000); assert.equal(b.S.play('scan.clean'), true, 'resumed');
  const c = await load(); c.S.configure({ scope: 'core' });
  assert.equal(c.S.play('ui.tap'), false, 'touch sound under core');
  assert.equal(c.S.play('ui.tap', { force: true }), true, 'a settings preview forces it');
  c.clock.at(2000); assert.equal(c.S.play('scan.clean'), true, 'a moment under core');
});

await test('configure() defaults the scope to core, so a call site that forgets it is harmless', async () => {
  const w = {};
  new Function('window', 'document', 'performance', read('ui/sound.js'))(w, { hidden: false, addEventListener() {} }, { now: () => 0 });
  assert.equal(w.UQASound.configure({ on: true, level: 0.7 }).scope, 'core');
  assert.equal(w.UQASound.configure({ scope: 'bogus' }).scope, 'core', 'an unknown scope is ignored');
});

await test('a hidden page hands a moment to the worker; a touch sound is never handed over', async () => {
  const h = await load({ hidden: true });
  assert.equal(h.S.play('links.clean'), false, 'a hidden page plays nothing itself');
  assert.equal(h.S.play('ui.tap', { force: true }), false);
  assert.deepEqual(h.log.sent, [{ type: 'UQA_CUE', name: 'links.clean' }], 'one moment forwarded, no touch cue');
  const off = await load({ hidden: true }); off.S.configure({ on: false });
  off.S.play('links.clean');
  assert.equal(off.log.sent.length, 0, 'a page with the setting off forwards nothing');
  const vis = await load(); vis.clock.at(0); vis.S.play('links.clean');
  assert.equal(vis.log.sent.length, 0, 'a visible page plays its own and forwards nothing');
});

await test('nothing is synthesised any more: no oscillators, no noise; Math.random only picks a round-robin variant', () => {
  const src = read('ui/sound.js');
  for (const bad of [/createOscillator/, /createConvolver/, /createDynamicsCompressor/, /createBiquadFilter/, /mulberry32/]) {
    assert.ok(!bad.test(src), `ui/sound.js still contains ${bad}`);
  }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l));
  const uses = code.filter((l) => /Math\.random/.test(l));
  assert.equal(uses.length, 1, 'Math.random is used on more than the one variant-pick line');
  assert.match(uses[0], /robin\[id\]/, 'Math.random is used for something other than the variant pick');
});

console.log('\nsound.js: every element gets one');

/** A stand-in element, enough for `closest` and `matches` to answer. */
function el(selectorish, attrs = {}) {
  const classes = (selectorish.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  const tag = (selectorish.match(/^[a-z]+/) || ['div'])[0];
  const node = {
    tagName: tag.toUpperCase(),
    dataset: attrs.dataset || {},
    getAttribute: (name) => attrs[name] ?? null,
    matches: (sel) => sel.split(',').some((s) => classes.includes(s.trim().replace(/^\./, '')) || s.trim() === tag),
    closest(sel) {
      return sel
        .split(',')
        .map((s) => s.trim())
        .some((s) => {
          if (s === '[data-sound]') return !!node.dataset.sound;
          if (s.startsWith('.')) return classes.includes(s.slice(1));
          if (/^[a-z]+\[/.test(s)) return s.startsWith(tag) && attrs.href !== undefined;
          if (/^[a-z]+$/.test(s)) return s === tag;
          if (s.startsWith('[role=')) return attrs.role === s.slice(7, -2);
          if (s.includes('.')) return s.split('.').slice(1).some((c) => classes.includes(c));
          return false;
        })
        ? node
        : null;
    },
  };
  return node;
}

await test('an explicit data-sound always wins, and "none" names no sound', () => {
  assert.equal(S.soundFor(el('button', { dataset: { sound: 'switch.wake' } })), 'switch.wake');
  const none = S.soundFor(el('button.btn-primary', { dataset: { sound: 'none' } }));
  assert.equal(none, 'none');
  assert.equal(stub.S.play('none'), false);
});

await test('a tab, a disclosure, a danger button and a link each resolve to an event that exists', () => {
  assert.equal(S.soundFor(el('button.tab')), 'ui.tab');
  assert.equal(S.soundFor(el('button.tool-info', { 'aria-expanded': 'false' })), 'ui.open');
  assert.equal(S.soundFor(el('button.tool-info', { 'aria-expanded': 'true' })), 'ui.close');
  assert.equal(S.soundFor(el('a', { href: '#' })), 'ui.navigate');
  assert.equal(S.EVENTS[S.soundFor(el('button.btn-danger'))], 'remove');
  for (const sel of ['button.tool', 'button.btn-primary', 'button.btn-quiet', 'button']) assert.ok(S.EVENTS[S.soundFor(el(sel))], sel);
});

await test('an element with no role at all makes no sound', () => {
  assert.equal(S.soundFor(el('div')), null);
  assert.equal(S.soundFor(el('span.muted')), null);
});

await test('the settings catalogue lists every sound once, with its files and events, and has a label in both languages', () => {
  const cat = S.catalogue();
  assert.deepEqual(cat.map((c) => c.id).sort(), Object.keys(S.SOUNDS).sort());
  for (const c of cat) {
    assert.ok(c.files.length >= 1 && c.events.length >= 1, `${c.id} lists nothing`);
  }
  const en = JSON.parse(read('platform/i18n/en.json'));
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const id of Object.keys(S.SOUNDS)) {
    assert.ok(en[`options.sound.name.${id}`] && ar[`options.sound.name.${id}`], `options.sound.name.${id} missing in en or ar`);
    assert.ok(/[؀-ۿ]/.test(ar[`options.sound.name.${id}`]), `options.sound.name.${id} has no Arabic`);
  }
  for (const k of ['count', 'countFallback', 'intro1', 'intro2', 'scopeBold', 'offNote', 'group.core.what', 'group.touch.what']) {
    assert.ok(en[`options.sound.${k}`] && ar[`options.sound.${k}`], `options.sound.${k} missing in en or ar`);
  }
  assert.ok(!/synthesi[sz]ed|Off by default|معطّل افتراضيًا/.test(JSON.stringify([en['options.sound.intro1'], en['options.sound.offNote'], ar['options.sound.intro1'], ar['options.sound.offNote']])), 'a stale claim about synthesis or the default is still in the copy');
});

console.log('\nsound.js: settings, pages and strings');

await test('sound defaults to on with every click (4 Oct 2026), and an upgraded profile with sound on keeps every click', () => {
  const src = read('platform/settings.js');
  assert.match(src, /soundEnabled: true,/);
  assert.match(src, /soundScope: 'all',/);
  assert.match(src, /soundVolume: 70/);
  assert.match(src, /SOUND_SCOPES = \['core', 'all'\]/);
  assert.match(src, /soundScope: merged\.soundScope \?\? \(merged\.soundEnabled \? 'all' : DEFAULTS\.soundScope\)/);
});

await test('every configure() site in the pages passes the scope', () => {
  const files = ['popup/popup.js', 'options/options.js', 'report/report.js', 'annotate/annotate.js', 'devtools/panel.js', 'diagram/diagram.js', 'tutorials/tutorials.js', 'videoedit/videoedit.js'];
  let sites = 0;
  for (const rel of files) {
    const hits = read(rel).split('\n').filter((l) => /UQASound\?\.configure\(/.test(l) && /soundVolume/.test(l));
    assert.ok(hits.length, `${rel} has no configure call`);
    for (const l of hits) { sites++; assert.match(l, /scope:/, `${rel}: ${l.trim().slice(0, 90)}`); }
  }
  assert.equal(sites, 9);
});

await test('the scope control exists on the options page, in both languages', () => {
  const html = read('options/options.html');
  assert.match(html, /name="soundScope" value="core"/);
  assert.match(html, /name="soundScope" value="all"/);
  const en = JSON.parse(read('platform/i18n/en.json'));
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const k of ['label', 'core', 'all']) {
    const key = `options.sound.scope.${k}`;
    assert.ok(en[key] && ar[key], `${key} missing in en or ar`);
    assert.notEqual(en[key], ar[key], `${key} is untranslated`);
    assert.ok(/[؀-ۿ]/.test(ar[key]), `${key} has no Arabic`);
  }
  assert.equal(en['options.sound.scope.core'], 'Results and alerts');
  assert.equal(en['options.sound.scope.all'], 'Every click');
});

/** The refusal function lifted out of popup.js by source, as test-optimistic lifts `optimistic`. */
const popupSrc = surfaceSource('popup/popup.js');
const refusalSound = new Function(`${popupSrc.slice(popupSrc.indexOf('function refusalSound('), popupSrc.indexOf('function say('))}\nreturn refusalSound;`)();

await test('refusalSound: the real asleep / needs-a-page / reload strings are refusals, the rest are errors', () => {
  const en = JSON.parse(read('platform/i18n/en.json'));
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  const armed = read('background/armed.js');
  const asleep = armed.match(/'(QA Wrap is asleep in this window\.[^']*)'/);
  assert.ok(asleep, 'the worker no longer says "QA Wrap is asleep in this window"');
  for (const [where, text] of [
    ['en needsPage', en['popup.err.needsPage']], ['ar needsPage', ar['popup.err.needsPage']],
    ['en needsReload', en['popup.err.needsReload']], ['ar needsReload', ar['popup.err.needsReload']],
    ['worker asleep', asleep[1]],
  ]) assert.equal(refusalSound(text), 'status.refused', `${where} no longer plays the refusal cue: ${text}`);
  assert.equal(refusalSound('Network request failed'), 'status.error');
  assert.equal(refusalSound(en['popup.err.workerSilent']), 'status.error');
});

await test('popup.html: start, stop and shutter are not fired on click', () => {
  const html = read('popup/popup.html');
  const named = [...html.matchAll(/data-sound="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!named.some((n) => /^session\./.test(n) || n === 'capture.shot' || n === 'capture.full'), `click-time cue left: ${named.join(', ')}`);
  assert.equal(named.filter((n) => n === 'none').length, 3);
  assert.ok(named.includes('switch.wake'), 'the wake switch keeps its cue');
});

await test('popup.js plays start, stop and shutter only from the request and reply handlers, in order', () => {
  const at = (needle, from = 0) => { const i = popupSrc.indexOf(needle, from); assert.ok(i >= 0, `not found: ${needle}`); return i; };
  const start = at("$('start').addEventListener('click'");
  const stop = at("$('stop').addEventListener('click'");
  const startSrc = popupSrc.slice(start, stop);
  assert.ok(startSrc.indexOf("play('session.start')") > 0 && startSrc.indexOf("play('session.start')") < startSrc.indexOf("type: 'UQA_START'"), 'session.start must play before the request is sent');
  assert.ok(startSrc.indexOf('suspended: true') > startSrc.indexOf("play('session.start')"), 'the mic mute comes after the cue is scheduled');
  assert.match(startSrc, /Recording\. Use the page as a tester would\.'\), 'ok', \{ silent: true \}/);
  assert.match(startSrc, /suspended: false/, 'a failed start gives the sound back');
  const stopEnd = at("/*\n * Reporter mode");
  const stopSrc = popupSrc.slice(stop, stopEnd);
  assert.match(stopSrc, /say\(''\); \/\/ the card's own heading says "Session saved\."/);
  assert.ok(stopSrc.indexOf("play('session.stop')") > stopSrc.indexOf('await refresh()'), 'session.stop must play after the reply is settled');
  assert.ok(stopSrc.indexOf('suspended: false') > stopSrc.indexOf('await refresh()') && stopSrc.indexOf('suspended: false') < stopSrc.indexOf("play('session.stop')"), 'unmute, then the cue');
  assert.equal((popupSrc.match(/play\('session\.stop'\)/g) || []).length, 1);
  assert.equal((popupSrc.match(/play\('session\.start'\)/g) || []).length, 1);
  const shotNote = popupSrc.slice(at("$('shot').addEventListener('click'"), at('/* ---------------------------------------------------------- task breakdown'));
  assert.ok(shotNote.indexOf("play('capture.shot')") > shotNote.indexOf('settle'), 'the note screenshot plays in settle');
  assert.match(shotNote, /silent: true/);
  assert.match(popupSrc, /play\(full \? 'capture\.full' : 'capture\.shot'\)/);
});

await test('popup: silent from record start, sound back on a failed start, a cancel and a stop', () => {
  const src = surfaceSource('popup/popup.js');
  const at = (s) => { const i = src.indexOf(s); assert.ok(i >= 0, s); return i; };
  const send = at("type: screen ? 'UQA_RECORD_SCREEN' : 'UQA_RECORD_START'");
  const before = src.lastIndexOf('suspended: true', send);
  assert.ok(before > 0 && send - before < 300, 'suspended just before the record request');
  assert.match(src.slice(send, send + 1600), /!out\.ok \|\| out\.result\?\.cancelled\) uqaSound\(\)\?\.configure\(\{ suspended: false \}\)/);
  const stop = at("send({ type: 'UQA_RECORD_STOP' })");
  assert.match(src.slice(stop, stop + 200), /suspended: false/);
  assert.match(src, /if \(recording\) uqaSound\(\)\?\.configure\(\{ suspended: true \}\)/, 'a popup opened mid-clip is silent');
});

await test('content/mask.js no longer calls a library that is not loaded there', () => {
  assert.ok(!/UQASound/.test(read('content/mask.js')));
});

await test('every page that a person can open loads the library', () => {
  const surfaces = ['popup/popup.html', 'options/options.html', 'report/report.html', 'annotate/annotate.html', 'devtools/panel.html'];
  const silent = surfaces.filter((rel) => !read(rel).includes('ui/sound.js'));
  assert.deepEqual(silent, [], `no sound on: ${silent.join(', ')}`);
});

console.log('\nsound.js: out of the service-worker graph, out of host pages');

await test('no background module imports or names the player or the sound files, except the cue route', () => {
  const dir = path.join(EXT, 'background');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/import[^;]*sound/i.test(src), `background/${f} imports sound code`);
    assert.ok(!/ui\/sfx|\.ogg/.test(src), `background/${f} names a sound file`);
    assert.ok(!/new (Offline)?AudioContext|decodeAudioData/.test(src), `background/${f} touches Web Audio`);
  }
});

await test('the in-page toolbar has no sound.js and no sound files; the manifest exposes no audio', () => {
  assert.ok(!/BAR_FILES = \[[^\]]*sound/.test(read('background/service-worker.js')), 'sound.js is injected into host pages');
  assert.ok(!/UQASound/.test(read('content/bar.js')), 'the bar calls the library');
  const manifest = JSON.parse(read('manifest.json'));
  const war = JSON.stringify(manifest.web_accessible_resources || []);
  assert.ok(!/sfx|\.ogg|ui\/sound/.test(war), `web_accessible_resources exposes sound: ${war}`);
});

await test('the offscreen document gains no AUDIO_PLAYBACK reason and plays cues through the one route', () => {
  const bg = fs.readdirSync(path.join(EXT, 'background')).filter((n) => n.endsWith('.js')).map((n) => read(`background/${n}`)).join('\n');
  assert.ok(!/AUDIO_PLAYBACK/.test(bg), 'a background module asks for AUDIO_PLAYBACK');
  const off = read('offscreen/offscreen.js');
  assert.match(off, /case 'UQA_OFF_CUE':[\s\S]{0,400}UQASound\?\.play\(msg\.name\)/);
  assert.match(off, /UQASound\?\.ready\?\.\(\)/, 'the offscreen cue waits for the files to decode');
  assert.ok(read('offscreen/offscreen.html').includes('ui/sound.js'));
});

await test('the worker cue regex lets through only events that map to core sounds', () => {
  const m = /const CUE = \/(.*)\/;/.exec(read('background/media.js'));
  assert.ok(m, 'the CUE regex moved');
  const cue = new RegExp(m[1]);
  const through = Object.keys(S.EVENTS).filter((e) => cue.test(e));
  assert.ok(through.length >= 6, `only ${through.length} events pass: ${through.join(', ')}`);
  for (const e of through) assert.equal(S.SOUNDS[S.EVENTS[e]].scope, 'core', `${e} is not a core sound`);
});

await test('Wake and Sleep presses resolve to different sounds and files (the switch follows its state)', () => {
  const src = surfaceSource('popup/popup.js');
  const paint = /function paintSwitchState[\s\S]*?\n}\n/.exec(src)?.[0] || '';
  assert.match(paint, /\$\('switch'\)\.dataset\.sound\s*=\s*awake \? 'switch\.sleep' : 'switch\.wake'/, 'paintSwitchState must set the switch sound from the state');
  // The press is read before the handler flips the state: awake -> the press sleeps.
  const press = (awake) => S.soundFor(el('button.btn-primary', { dataset: { sound: awake ? 'switch.sleep' : 'switch.wake' } }));
  const wake = S.EVENTS[press(false)], sleep = S.EVENTS[press(true)];
  assert.equal(wake, 'wake'); assert.equal(sleep, 'sleep');
  assert.notDeepEqual(S.SOUNDS[wake].files, S.SOUNDS[sleep].files);
  assert.match(read('popup/popup.html'), /id="switch"[^>]*data-sound="switch\.wake"/, 'the page starts asleep');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
