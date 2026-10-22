/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1014 B1, bug 2: no empty reserved space above the tools, in the float and the side panel.
 *
 *   node tools/test-top-space.mjs
 *
 * Measured on the rendered DOM of the session region (everything between the header and the tools), in the asleep, idle and
 * recording states, on the float (420 and 560 wide) and the side panel (348 and 400 wide). For each:
 *  - no direct child of the session region is an empty box (an empty status line or an empty "Last locator" row used to reserve
 *    20 to 40 px of nothing);
 *  - the gap between two neighbouring children, between the header and the first child, and between the last child and the tools
 *    is at most twice `--sp-3` (read from the page, not written here), so a band of dead space cannot come back;
 *  - the empty status line is still in the accessibility tree, so the live region is there when the next message lands.
 */
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

const measure = (popup) => popup.evaluate(() => {
  const px = (name) => parseFloat(getComputedStyle(document.documentElement).fontSize) * parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  const maxGap = 2 * px('--sp-3');
  const head = document.getElementById('app-head').getBoundingClientRect();
  const session = document.querySelector('section.session');
  const tools = document.querySelector('.app .tools').getBoundingClientRect();
  const flow = [...session.children].filter((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.position !== 'absolute' && r.height > 0; });
  const label = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}`;
  const empty = flow.filter((e) => !e.textContent.trim() && !e.matches('img,svg,input,button,select,textarea') && !e.querySelector('img,svg,input,button,select,textarea')).map(label);
  const gaps = [];
  let prev = head.bottom;
  // The band that is seen is the one between boxes with something in them; an empty box in between is reported by `empty`, not hidden.
  for (const e of flow.filter((x) => !empty.includes(label(x)))) { const r = e.getBoundingClientRect(); gaps.push([`${prev === head.bottom ? 'header' : 'previous'} -> ${label(e)}`, Math.round((r.top - prev) * 10) / 10]); prev = r.bottom; }
  gaps.push([`${prev === head.bottom ? 'header' : 'last box'} -> tools`, Math.round((tools.top - prev) * 10) / 10]);
  const status = document.getElementById('status');
  const st = status && !status.textContent ? { inFlow: getComputedStyle(status).position !== 'absolute', display: getComputedStyle(status).display, visibility: getComputedStyle(status).visibility } : null;
  return { maxGap, count: flow.length, empty, gaps, status: st };
});

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'top-space' });
  const { popup } = h;
  const open = async (surface, width, height) => {
    await popup.setViewportSize({ width, height });
    await popup.goto(`chrome-extension://${h.id}/popup/popup.html${surface ? `?surface=${surface}` : ''}`);
    await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
    await popup.evaluate(() => { window.close = () => {}; });
    // The status line is a [data-live] message that wipes itself; judge the surface once it has gone.
    await popup.waitForFunction(() => !document.getElementById('status').textContent, null, { timeout: 15000 });
    await popup.waitForTimeout(600);
  };
  const views = [['float', 420, 700], ['float', 560, 700], ['panel', 348, 600], ['panel', 400, 800]];
  for (const state of ['asleep', 'recording', 'idle']) {
    await open('', 348, 600);
    await h.to(state);
    for (const [surface, w, ht] of views) {
      await open(surface, w, ht);
      const m = await measure(popup);
      const tag = `${state} ${surface} ${w}x${ht}`;
      check(m.count >= 1, `${tag}: ready, ${m.count} boxes in the session region`);
      check(m.empty.length === 0, `${tag}: no empty box in the session region`, m.empty.join(', '));
      const bad = m.gaps.filter(([, g]) => g > m.maxGap);
      check(bad.length === 0, `${tag}: no gap above ${m.maxGap}px (header, between boxes, tools)`, bad.map(([n, g]) => `${n}: ${g}px`).join(' | '));
      if (state !== 'recording') check(m.status && !m.status.inFlow && m.status.display !== 'none' && m.status.visibility !== 'hidden', `${tag}: the empty status line is out of the flow and still in the accessibility tree`, JSON.stringify(m.status));
    }
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
