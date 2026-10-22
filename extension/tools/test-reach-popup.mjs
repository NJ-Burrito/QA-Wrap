/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R2 (autopilot-1011, REQ-P1-2 and P1-12): the tool list is folded, and nothing is lost.
 *
 *   node tools/test-reach-popup.mjs
 *
 * On the real popup (348x600):
 *   - the idle first screen has at most 5 actionable controls outside the header icons, the favourites (tool-list entries, judged by the row rule) and the "All tools" disclosure;
 *   - no list is open by default (at most 7 rows visible);
 *   - favourites stay above the fold, and every tool in core/tool-catalogue.json (a fixed list, checked against the popup's TOOLS) is reachable in at most 2 clicks: one on the
 *     disclosure, one on the tool (checked as visible, enabled, and the element under its centre);
 *   - open or closed is remembered (`toolsOpen`) across a reload;
 *   - an opened tool panel starts with a labelled "Back to session" within 100 px of the top of its row, carrying the session
 *     clock while recording; pressing it closes the panel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

/** The fixed source of the tool list: the catalogue the right-click menu is built from, not the popup under test. */
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(EXT, 'core', 'tool-catalogue.json'), 'utf8')).tools.map((t) => t.tool);

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-r2' });
  const { popup } = h;
  const built = await popup.evaluate(() => TOOLS.map((t) => t.tool).filter(Boolean));
  const ids = CATALOGUE;
  check(ids.length >= 19, `the catalogue lists ${ids.length} tools`);
  check(JSON.stringify([...built].sort()) === JSON.stringify([...ids].sort()), 'the popup builds exactly the catalogue tools (none dropped, none added)', `catalogue only: ${ids.filter((i) => !built.includes(i))}; popup only: ${built.filter((i) => !ids.includes(i))}`);

  /* P1-12 first: it needs a recording. */
  await h.to('recording');
  await popup.click('#tools-fold > summary');
  const row = popup.locator('.tool-row[data-tool="shot"]');
  await row.locator('.tool-more').click();
  await popup.waitForSelector('.tool-row.is-open .back-to-session');
  const back = await popup.evaluate(() => {
    const open = document.querySelector('.tool-row.is-open');
    const b = open.querySelector('.back-to-session');
    const t = b.querySelector('.back-timer');
    const shown = (e) => !!e.offsetParent;
    return { gap: b.getBoundingClientRect().top - open.getBoundingClientRect().top, label: b.querySelector('.back-label').textContent.trim(), timer: t.textContent, timerShown: shown(t) && !t.hidden, buttonShown: shown(b) };
  });
  check(back.buttonShown && back.gap >= 0 && back.gap <= 100, 'an opened tool shows "Back to session" within 100 px of its top', JSON.stringify(back));
  check(/Back to session/.test(back.label), 'the Back control is labelled', back.label);
  check(back.timerShown && /^\d\d:\d\d$/.test(back.timer), 'the session clock is visible beside it while recording', back.timer);
  const chip = await popup.textContent('#chip-timer');
  const diff = Math.abs((Number(back.timer.slice(0, 2)) * 60 + Number(back.timer.slice(3))) - (Number(chip.slice(0, 2)) * 60 + Number(chip.slice(3))));
  check(diff <= 1, 'the Back clock and the header chip agree within 1 s', `${back.timer} vs ${chip}`);
  await popup.click('.tool-row.is-open .back-to-session');
  check(await popup.locator('.tool-row.is-open').count() === 0, 'pressing Back to session closes the panel');
  await popup.click('#tools-fold > summary'); // put the fold back as it was found (closed)
  await popup.waitForTimeout(300);

  /* The first screen, idle. */
  await h.to('idle');
  await popup.waitForFunction(() => !document.getElementById('status').textContent, null, { timeout: 15000 });
  const first = await popup.evaluate(() => {
    const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true }); // a closed <details> hides by content-visibility, which offsetParent does not see
    const all = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary')].filter(shown);
    const counted = all.filter((e) => !e.closest('.app-head, .favourites') && !e.matches('#tools-fold > summary'));
    return {
      controls: counted.map((e) => e.id || e.className || e.tagName),
      rows: [...document.querySelectorAll('.tool-row')].filter(shown).length,
      foldOpen: document.getElementById('tools-fold')?.open,
      favBeforeFold: !!(document.querySelector('.favourites')?.compareDocumentPosition(document.getElementById('tools-fold')) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  check(first.controls.length <= 5, `idle first screen: ${first.controls.length} actionable controls (max 5)`, first.controls.join(', '));
  check(first.foldOpen === false && first.rows <= 7, `no list is open by default (${first.rows} rows visible)`);
  check(first.favBeforeFold, 'favourites sit above the fold');

  /* Every tool, two clicks. */
  const missing = [];
  await popup.click('#tools-fold > summary');
  for (const id of ids) {
    const seen = await popup.evaluate(async (tool) => {
      const run = document.querySelector(`.tool-row[data-tool="${tool}"] .tool`);
      if (!run) return { ok: false, why: 'no row' };
      run.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 30));
      const r = run.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !!run.offsetParent && !run.disabled && !!top && (top === run || run.contains(top)), why: run.disabled ? 'disabled' : !run.offsetParent ? 'hidden' : `covered by ${top?.id || top?.className || top?.tagName}` };
    }, id);
    if (!seen.ok) missing.push(`${id}:${seen.why}`);
  }
  check(missing.length === 0, `all ${ids.length} tools are pressable after one click on the disclosure`, missing.join(', '));

  /* No trap (15 Oct 2026): every tool detail and Break a request has a visible way back, Escape closes it, and the Tools list is there after. */
  const trapped = await popup.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shown = (e) => !!e && !!e.offsetParent && e.checkVisibility({ visibilityProperty: true });
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const bad = [];
    for (const row of document.querySelectorAll('.tool-row')) {
      const more = row.querySelector('.tool-more');
      if (!more) continue;
      row.scrollIntoView({ block: 'center' });
      more.click();
      await wait(60);
      if (!row.classList.contains('is-open')) { bad.push(`${row.dataset.tool}: did not open`); continue; }
      if (!shown(row.querySelector('.detail-back')) && !shown(row.querySelector('.detail-close'))) bad.push(`${row.dataset.tool}: no way back is visible`);
      esc();
      await wait(60);
      if (row.classList.contains('is-open')) bad.push(`${row.dataset.tool}: Escape did not close it`);
    }
    const brk = document.getElementById('break-panel');
    const toggle = document.querySelector('[data-action="break-toggle"]');
    toggle.click();
    await wait(80);
    if (brk.hidden) bad.push('break: did not open');
    if (!shown(document.getElementById('break-back'))) bad.push('break: no Back button');
    document.getElementById('break-back').click();
    await wait(80);
    if (!brk.hidden || document.getElementById('tools').offsetHeight < 100) bad.push(`break: Back left it open or the tools list at ${document.getElementById('tools').offsetHeight}px`);
    toggle.click();
    await wait(80);
    esc();
    await wait(80);
    if (!brk.hidden || document.getElementById('tools').offsetHeight < 100) bad.push('break: Escape did not return to the tools list');
    return bad;
  });
  check(trapped.length === 0, 'every tool panel and Break a request has a visible way back, and Escape returns to the Tools list', trapped.join(' | '));

  /* Remembered. */
  await popup.reload();
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.waitForTimeout(500);
  check(await popup.evaluate(() => document.getElementById('tools-fold').open) === true, 'open is remembered across a reload');
  await popup.click('#tools-fold > summary');
  await popup.reload();
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.waitForTimeout(500);
  check(await popup.evaluate(() => document.getElementById('tools-fold').open) === false, 'closed is remembered across a reload');
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
