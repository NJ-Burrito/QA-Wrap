/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R8 (autopilot-1011, REQ-P1-5): the finished-session card at 348x600.
 *
 *   node tools/test-done-card.mjs
 *
 * Part 1 evaluates popup/done-card.js's pure model. Part 2 drives the real popup: with no problems and with a problem,
 * "Copy report" is the first button, fully inside the 348x600 viewport without scrolling; at most 3 buttons before any
 * disclosure; Open full report second; the exports, Task breakdown and the name field sit under "More"; Stop opens no tab and
 * writes nothing to the clipboard; the clipboard is written only by the Copy press, with the report's Markdown.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

/* Part 1: the pure model. */
const sandbox = { console, Date, Math, Number, String, Object, Array };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(EXT, 'popup', 'done-card.js'), 'utf8').replace(/\n\$\('copy-report'\)\?\.addEventListener[^\n]*/, '') + '\n;this.doneModel = doneModel;', sandbox);
const clean = sandbox.doneModel({ groups: 0, time: '00:05' });
const dirty = sandbox.doneModel({ groups: 2, time: '00:05' });
check(clean.clean === true && clean.cleanKey === 'popup.done.noProblems', 'no problems: the card says "No problems caught"');
check(dirty.clean === false && dirty.cleanKey === null, 'with problems: no "No problems" line');
check(clean.copyKey === 'popup.done.copyReport' && dirty.copyKey === clean.copyKey, 'one label for the copy button either way');

/* Part 2: the real popup. */
let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-r8' });
  const { popup } = h;
  const inspect = () => popup.evaluate(() => {
    const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true }); // a closed <details> hides by content-visibility, which offsetParent does not see
    const card = document.getElementById('step-done');
    const buttons = [...card.querySelectorAll('button')].filter(shown);
    const outside = buttons.filter((b) => !b.closest('details, #key-findings, #sg-done'));
    const box = document.getElementById('copy-report').getBoundingClientRect();
    return {
      first: buttons[0]?.id,
      second: buttons[1]?.id,
      outside: outside.map((b) => b.id || b.textContent.trim()),
      box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      vw: innerWidth, vh: innerHeight, scrollY: scrollY + (document.scrollingElement?.scrollTop || 0),
      moreOpen: document.getElementById('done-more').open,
      exportsInMore: [...document.querySelectorAll('[data-format]')].every((b) => b.closest('#done-more')),
      breakdownInMore: !!document.querySelector('#done-more #breakdown'),
      nameInMore: !!document.querySelector('#done-more #done-name-row'),
      cleanText: document.getElementById('done-clean').hidden ? '' : document.getElementById('done-clean').textContent.trim(),
      problems: document.getElementById('stat-problems').textContent,
      kfBottom: document.getElementById('key-findings').getBoundingClientRect().bottom,
      toolsTop: document.getElementById('tool-sheet').getBoundingClientRect().top,
      sessionClip: getComputedStyle(document.getElementById('session')).overflowY,
    };
  });

  for (const name of ['done-clean', 'done-problems']) {
    if (name === 'done-problems') await h.to('recording-2');
    await h.to(name);
    const s = await inspect();
    check(s.vw === 348 && s.vh === 600, `${name}: the popup is 348x600`, `${s.vw}x${s.vh}`);
    check(s.first === 'copy-report', `${name}: Copy report is the first button`, JSON.stringify(s.outside));
    check(s.second === 'view-report', `${name}: Open full report is second`, String(s.second));
    check(s.scrollY === 0 && s.box.top >= 0 && s.box.bottom <= s.vh && s.box.left >= 0 && s.box.right <= s.vw, `${name}: Copy report is fully visible without scrolling`, JSON.stringify(s.box));
    check(s.kfBottom <= s.toolsTop + 0.5 && s.sessionClip === 'visible', `${name}: Key findings end above the Tools list and the card does not scroll apart from it (no overlap)`, JSON.stringify([s.kfBottom, s.toolsTop, s.sessionClip]));
    check(s.outside.length <= 3, `${name}: at most 3 buttons before any disclosure`, JSON.stringify(s.outside));
    check(!s.moreOpen && s.exportsInMore && s.breakdownInMore && s.nameInMore, `${name}: exports, Task breakdown and the name field are under a closed "More"`);
    if (name === 'done-clean') check(/^No problems caught in \d\d:\d\d\.?$/.test(s.cleanText) && s.problems === '0', 'no problems: "No problems caught in mm:ss"', JSON.stringify([s.cleanText, s.problems]));
    else check(s.cleanText === '' && Number(s.problems) > 0, 'with a problem: no "No problems" line', JSON.stringify([s.cleanText, s.problems]));

    const before = await popup.evaluate(() => ({ tabs: window.__log.tabs.length, clip: window.__log.clip.length }));
    check(before.tabs === 0 && before.clip === 0, `${name}: Stop opened no tab and wrote nothing to the clipboard`, JSON.stringify(before));
    const pages = h.context.pages().filter((p) => p.url().includes('/report/')).length;
    check(pages === 0, `${name}: no report tab exists`, String(pages));
    await popup.click('#copy-report');
    await popup.waitForFunction(() => window.__log.clip.length === 1, null, { timeout: 15000 });
    const clip = await popup.evaluate(() => window.__log.clip[0]);
    check(typeof clip === 'string' && clip.length > 40 && /^#|\n#/.test(clip), `${name}: the Copy press wrote the report's Markdown`, clip.slice(0, 80));
    check(!/password=[^•\s]{3,}/i.test(clip), `${name}: the copy carries no unmasked password`);
    await popup.evaluate(() => { window.__log.clip.length = 0; }); // the next Stop is judged on its own
  }
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
