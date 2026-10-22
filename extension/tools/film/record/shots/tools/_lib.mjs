/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The verbs the sixteen tool films share.
 *
 * A tool film is always the same shape: a problem on the permits fixture, the
 * tool's own row pressed in the panel, the tool doing its job on the page, and
 * the result arriving. What differs between them is which row and which job,
 * so everything that does not differ lives here and each film's file stays
 * short enough to read beside its row in bible §10.3.
 */

/** Wake the window and start a session, if this batch has not already. */
export async function session(t, charter = 'Food import permit, submit path') {
  await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
  await t.panelReady();
  if ((await t.panel.evaluate(() => document.body.dataset.awake)) !== 'true') {
    await t.panel.click('#switch');
    await t.panel.waitForFunction(() => document.body.dataset.awake === 'true', undefined, { timeout: 12000 });
  }
  if (await t.panel.evaluate(() => !!document.getElementById('step-live')?.hidden)) {
    await t.panel.fill('#charter', charter).catch(() => {});
    await t.panel.click('#start').catch(() => {});
    await t.panel.waitForFunction(() => !document.getElementById('step-live').hidden, undefined, { timeout: 12000 }).catch(() => {});
  }
  await t.clearStatus();
}

const isOpen = (t, id) => t.panel.evaluate((p) => { const el = document.getElementById(p); return !!el && !el.hidden; }, id);

/**
 * Open a tool's own disclosure, whichever control the product hangs it on.
 *
 * Some tools open their panel from a "more" control on the row and some from
 * the tool button itself. Pressing whatever is there and then waiting for the
 * panel keeps this file out of a layout decision it has no business knowing.
 */
export async function openPanel(t, tool, panelId, action) {
  if (await isOpen(t, panelId)) return;
  const more = t.panel.locator(`.tool-row[data-tool="${tool}"] .tool-more`);
  if (await more.count()) { await more.click().catch(() => {}); await t.wait(500); }
  if (!(await isOpen(t, panelId)) && action) { await t.panel.locator(`[data-action="${action}"]`).click().catch(() => {}); await t.wait(600); }
  for (let i = 0; i < 10 && !(await isOpen(t, panelId)); i++) await t.wait(200);
  /* Throw rather than film a shot about a panel that never opened: a silent
     miss here reads downstream as "the control was never ticked". */
  if (!(await isOpen(t, panelId))) throw new Error(`${panelId} would not open from the ${tool} row`);
  await t.reveal(t.panel, `#${panelId}`);
}

/** The row brought into frame, then pressed, with the press on the film's clock. */
export async function pressTool(t, tool, action, { at = 0.3 } = {}) {
  await t.until(at);
  await t.click(t.panel, `[data-action="${action}"]`).catch(() => {});
  await t.hold(0.4);
}

/** Bring a tool's row into the frame before its shot opens. */
export async function frameRow(t, tool) {
  await t.clearStatus();
  await t.reveal(t.panel, `.tool-row[data-tool="${tool}"]`);
}

/**
 * Scroll a page a few pixels a frame, so the film sees a scroll and not a jump.
 *
 * The popup does not scroll its document: it scrolls an inner element, which is
 * why a `scrollHeight <= clientHeight` check on the document once passed while
 * eleven of sixteen tool tiles sat below the frame. So the scroller is found
 * from the thing being scrolled towards, and the document is only the fallback.
 */
export async function scrollOverFrames(t, page, totalPx, frames, anchor = null) {
  const step = totalPx / frames;
  for (let i = 0; i < frames; i++) {
    await page.evaluate(({ by, sel }) => {
      const start = (sel && document.querySelector(sel)) || document.body;
      let el = start.parentElement;
      while (el) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop += by;
          return;
        }
        el = el.parentElement;
      }
      (document.scrollingElement || document.documentElement).scrollBy(0, by);
    }, { by: step, sel: anchor });
    if (!(await t.frame())) return;
  }
}

/** Type into a field a few characters at a time, so the film sees it fill. */
export async function typeOverFrames(t, page, sel, text) {
  await page.fill(sel, '');
  const chunk = Math.max(1, Math.ceil(text.length / 10));
  for (let i = chunk; i <= text.length + chunk; i += chunk) {
    await page.fill(sel, text.slice(0, Math.min(i, text.length)));
    if (!(await t.frame())) return;
    if (!(await t.frame())) return;
  }
}

/** Watch a tool's row report, a frame at a time, for `sec` of film. */
export async function watchRow(t, sec) {
  await t.hold(sec);
}

/** The report, opened on a tab, with the block this film is about in frame. */
export async function reportOn(t, tab, focus) {
  await t.openReport(tab);
  if (focus) await t.reveal(t.report, focus, 'center');
}

/**
 * A real activeTab grant on the fixture tab, taken after the last navigation.
 *
 * Without one the Record row draws an amber `p.tool-invoke` telling the tester
 * to press Alt+Shift+V, and the critic found it in frame across several
 * seconds of the commercial. Chrome revokes the grant on navigation, so this
 * runs after the last `goto`, and the panel is redrawn afterwards because the
 * row asks `UQA_CAN_RECORD` when it renders. Nothing is hidden: the condition
 * the note reports is made untrue.
 */
export async function grantRecording(t, { redrawPanel = true } = {}) {
  await t.pressRecordShortcut(t.stage);
  await t.wait(1500);
  await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
  await t.wait(1000);
  const tabId = await t.panel.evaluate(
    (origin) => new Promise((r) => chrome.tabs.query({}, (ts) => r(ts.find((x) => x.url?.startsWith(origin))?.id ?? null))),
    t.origin
  );
  const can = await t.send({ type: 'UQA_CAN_RECORD', tabId });
  if (!can?.result?.can) {
    throw new Error(`the tab is not recordable after the shortcut (${can?.result?.why ?? 'no answer'}), so the row would draw its amber note`);
  }
  if (redrawPanel) {
    await t.panel.reload();
    await t.panelReady();
    await t.wait(400);
  }
  await t.panel.evaluate(() => {
    for (const h of document.querySelectorAll('.tool-help')) h.hidden = true;
  }).catch(() => {});
  await t.clearStatus();
}
