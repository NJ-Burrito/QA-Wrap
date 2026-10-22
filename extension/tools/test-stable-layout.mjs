/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R7 (autopilot-1011, REQ-P1-7): nothing moves by itself.
 *
 *   node tools/test-stable-layout.mjs
 *
 * Part 1 reads the source: the Awake-card shrink timer (AWAKE_CARD_MS and its pill) is gone, and so is its allow-list entry. Part 2 drives the real popup
 * (348x600): on the asleep surface and on the idle (awake) surface, the bounding box of every visible element outside
 * [data-live] is the same at 1 s and at 8 s, and no element appears or disappears. The primary button box is within 2 px
 * between asleep, idle and recording.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

const js = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8');
check(!/AWAKE_CARD_MS|AWAKE_MANUAL_MS|armAwakeCard|setAwakeCard/.test(js), 'popup.js has no Awake-card shrink timer');
check(!/awake-pill/.test(html), 'popup.html has no Awake pill');
/* 16 Oct 2026 (Nader): the card is a switch and nothing else, always one slim row, so there is no shrink timer and no allow-list entry for it. */
const guards = fs.readFileSync(path.join(EXT, 'popup', 'guards.js'), 'utf8');
check(!/compact\(|data-compact|dataset\.compact|setTimeout/.test(guards) && !/data-compact/.test(html), 'the Awake card has no shrink timer and no compact state');
check(/id="status"[^>]*data-live/.test(html) && /id="live-time"[^>]*data-live/.test(html), 'the live regions carry [data-live]');

const snapshot = (popup) => popup.evaluate(() => {
  const out = {};
  const path = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
      parts.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}[${i}]`);
    }
    return parts.join('>');
  };
  for (const e of document.body.querySelectorAll('*')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    if (e.closest('[data-live]')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    out[path(e)] = [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 2) / 2);
  }
  return out;
});
const primaryBox = (popup) => popup.evaluate(() => {
  const e = document.querySelector('[data-primary]');
  const r = e.getBoundingClientRect();
  return { id: e.id, left: r.left, top: r.top, width: r.width, height: r.height };
});
const close = (a, b, tol) => ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= tol);

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-r7' });
  const { popup } = h;
  const boxes = {};
  const surface = async (name) => {
    // The status line is a [data-live] message that wipes itself after 4 s; the surface is judged once it has gone.
    await popup.waitForFunction(() => !document.getElementById('status').textContent, null, { timeout: 15000 });
    // The entrance rise of a step (qaw-in-up, 6 px) is the screen arriving, not the screen moving by itself: judge it once it has landed.
    await popup.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running' && x.playState !== 'pending'), null, { timeout: 15000 });
    await popup.waitForTimeout(1000);
    const a = await snapshot(popup);
    await popup.waitForTimeout(7000);
    const b = await snapshot(popup);
    const moved = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    check(Object.keys(a).length > 20, `${name}: ${Object.keys(a).length} elements measured`);
    check(moved.length === 0, `${name}: every box outside [data-live] is equal at 1 s and 8 s`, moved.slice(0, 5).map((k) => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join('\n        '));
  };
  await h.to('asleep');
  boxes.asleep = await primaryBox(popup);
  await surface('asleep');
  await h.to('recording');
  boxes.recording = await primaryBox(popup);
  // P0-4, on the real popup: the card clock and the header chip clock agree, keep moving, and agree again when the popup is reopened.
  const clocks = () => popup.evaluate(() => {
    const sec = (id) => { const m = /^(\d+):(\d\d)$/.exec(document.getElementById(id).textContent.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
    return { card: sec('live-time'), chip: sec('chip-timer') };
  });
  const agree = (c) => Number.isFinite(c.card) && Number.isFinite(c.chip) && Math.abs(c.card - c.chip) <= 1;
  const c1 = await clocks();
  check(agree(c1), 'P0-4: the card clock and the header chip clock differ by at most 1 s', JSON.stringify(c1));
  await popup.waitForTimeout(3000);
  const c2 = await clocks();
  check(agree(c2) && c2.card >= c1.card + 2 && c2.chip >= c1.chip + 2, 'P0-4: both clocks moved on by 2 s or more in 3 s and still agree', JSON.stringify([c1, c2]));
  await popup.reload();
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.waitForSelector('#step-live:not([hidden])', { timeout: 20000 });
  await popup.waitForTimeout(1200);
  const c3 = await clocks();
  check(agree(c3) && c3.card >= c2.card && c3.chip >= c2.chip, 'P0-4: reopened, the clocks have not restarted and still agree', JSON.stringify([c2, c3]));
  await h.to('idle');
  boxes.idle = await primaryBox(popup);
  await surface('idle (awake)');
  check(close(boxes.asleep, boxes.idle, 2), 'the primary box is within 2 px between asleep and idle', JSON.stringify([boxes.asleep, boxes.idle]));
  check(close(boxes.idle, boxes.recording, 2), 'the primary box is within 2 px between idle and recording', JSON.stringify([boxes.idle, boxes.recording]));
  /* The switch, driven: Sleep then Wake. The card is the same height asleep, awake and 6 s later; aria-checked follows the state. */
  const card = () => popup.evaluate(() => ({ h: Math.round(document.getElementById('switch-card').getBoundingClientRect().height), on: document.getElementById('switch').getAttribute('aria-checked') }));
  const awakeCard = await card();
  await popup.click('#switch');
  await popup.waitForFunction(() => document.body.dataset.awake === 'false', null, { timeout: 10000 });
  const asleepCard = await card();
  await popup.click('#switch');
  await popup.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 15000 });
  await popup.waitForTimeout(6000);
  const later = await card();
  check(awakeCard.on === 'true' && asleepCard.on === 'false' && later.on === 'true', 'aria-checked follows the switch', JSON.stringify([awakeCard, asleepCard, later]));
  check(awakeCard.h === asleepCard.h && asleepCard.h === later.h, 'the card is the same height asleep, awake and 6 s after a Wake', JSON.stringify([awakeCard, asleepCard, later]));
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
