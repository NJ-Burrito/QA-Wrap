/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The viewport panel: the offered sizes, inheritLine, renderViewports, paintRestoreSize. A sibling of popup.js on the same global scope, loaded before it. */
/* ------------------------------------------------------- viewport panel */

/**
 * The sizes the worker offers, remembered.
 *
 * The list is fetched once at boot but the panel that shows it is stamped
 * again on every render, so the answer is kept here and redrawn rather than
 * re-fetched. Called with nothing, it repaints what it already knows.
 */
let viewports = [];

/**
 * What the new window took with it, in one sentence.
 *
 * The contract (`research/55-window-sizes-contract.md`, §2 and §5) says the
 * worker decides and reports; this turns its two lists into English. Written
 * as a pure function of `run` so `tools/test-viewport-inherit.mjs` can check
 * every combination without a browser, which is the only way a sentence with
 * this many branches stays true.
 *
 * @param {null|{inherited?: any, refused?: string[], mode?: string}} run
 */
function inheritLine(run) {
  /*
   * The English is named beside every key, and the table is reached through
   * `typeof`, because `tools/test-viewport-inherit.mjs` lifts this function out
   * of the file by source and runs it in Node against every combination of
   * `run`. There is no `QAWi18n` there, and the point of the test is that this
   * stays a pure function of its argument.
   */
  const say2 = (key, english, vars) => {
    const text = typeof QAWi18n !== 'undefined' && QAWi18n.has(key) ? QAWi18n.t(key, vars) : english;
    return vars ? String(text).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text;
  };
  if (!run) return say2('popup.viewport.awakeThere', 'Awake there too.');
  const took = [];
  if (run.inherited?.video) took.push(say2('popup.viewport.tookRecording', 'recording'));
  if (run.inherited?.mask) took.push(say2('popup.viewport.tookMasking', 'masking'));
  const refused = (run.refused || []).length
    ? say2('popup.viewport.refused', ` It could not take: ${run.refused.join(', ')}.`, { list: run.refused.join(', ') })
    : '';
  /*
   * A run that resized this window rather than opening a new one.
   *
   * "It is awake there too" is a sentence about somewhere else, and there is no
   * somewhere else: while a clip is recording, "Check another size" resizes the
   * tester's own window so the run happens inside that clip. Saying otherwise
   * sends them looking for a window that was never opened.
   */
  const here = run.mode === 'resized';
  if (!took.length) {
    return `${here ? say2('popup.viewport.sameWindow', 'Same window, still awake.') : say2('popup.viewport.awakeThere', 'Awake there too.')}${refused}`;
  }
  const lead = here
    ? say2('popup.viewport.leadHere', 'Same window, awake, with')
    : say2('popup.viewport.leadThere', 'Awake there, with');
  const list = took.join(say2('popup.viewport.and', ' and '));
  return `${say2('popup.viewport.took', `${lead} ${list}.`, { lead, list })}${refused}`;
}

/**
 * The size the browser actually gave, when it is not the size that was asked
 * for.
 *
 * Said in the popup and not only in the report, because the tester is about to
 * spend ten minutes checking a layout at a width the browser refused. Chrome
 * will not make a window much narrower than 500 CSS pixels on Windows, so a
 * 390-wide phone viewport in a real window is a size it cannot give; the honest
 * answer is the one that saves the ten minutes.
 */
function sizeNote(result) {
  if (!result || result.exact !== false) return '';
  const asked = `${result.viewport?.width}×${result.viewport?.height}`;
  const got = result.measured;
  // The English templates stay: tools/test-viewport-resize.mjs reads both of
  // them out of this source to prove a refused size is said out loud.
  return got
    ? tf('popup.viewport.notExactGot', ` Browser gave ${got.w}×${got.h}, not ${asked}.`, { asked, w: got.w, h: got.h })
    : tf('popup.viewport.notExact', ` Size not confirmed: ${asked}.`, { asked });
}

function renderViewports(list) {
  if (list) viewports = list;
  const host = panelFor('viewport')?.querySelector('#viewport-list');
  if (!host) return;
  host.replaceChildren();
  for (const v of viewports) {
    const row = el('button', 'part is-plain');
    row.type = 'button';
    row.append(el('b', null, v.label));
    row.append(el('code', 'part-sample', `${v.width}\u00d7${v.height}`));
    row.append(el('em', null, v.why));
    row.addEventListener('click', async () => {
      say(t('popup.viewport.opening', { w: v.width, h: v.height }));
      await resolveCtx();
      /*
       * E16, the popup's half. The contract is research/55-window-sizes-contract.md.
       *
       * `inherit` is sent and nothing else: the popup does not decide what a
       * new window copies, because it cannot see whether a clip is running
       * without a second round trip, and a second round trip is a second
       * chance for the two halves to disagree. The worker decides, at
       * creation, and says what it decided in `run`. This says that back.
       *
       * A reply with no `run` is the shape this handler answered before the
       * contract existed, so nothing regresses while Group G is still working:
       * the old sentence is still the one that gets printed.
       */
      const res = await send({ type: 'UQA_OPEN_VIEWPORT', viewport: v.id, tabId: ctx.tabId, inherit: true });
      if (!res.ok) return say(res.error, 'err');
      const out = res.result;
      // Two routes, two first words. A resize did not "open" anything, and a
      // tester told a window opened will go looking for it.
      // Both English templates stay: tools/test-viewport-resize.mjs reads the
      // first of them to prove a resize is not announced as a new window.
      const head = out?.mode === 'resized'
        ? tf('popup.viewport.resized', `This window is now ${v.label}.`, { label: v.label })
        : tf('popup.viewport.opened', `Open at ${v.label}.`, { label: v.label });
      // A size the browser refused is not a success, whatever else went right.
      say(out?.exact === false ? sizeNote(out).trim() : `${head} ${inheritLine(out?.run)}`, out?.exact === false ? 'err' : 'ok'); // a refused size is the one fact to say, in one line
      renderViewports();
    });
    host.append(row);
  }
  paintRestoreSize(host);
}

/**
 * The way back out of a size, when there is no window to close.
 *
 * A run that opened its own window ends when the tester shuts it. A run that
 * resized *this* window has no window to shut, and without this the only ways
 * out would be to stop the session or to pick a different size — which is a
 * trap, not a feature. It is drawn only while such a run is open, so the panel
 * gains a control exactly when there is something for it to do.
 *
 * Asked rather than remembered: the run may have been opened by another surface
 * — the side panel, a second popup — and a popup that trusted its own memory
 * would offer the button after the window had already gone back.
 */
async function paintRestoreSize(host) {
  const res = await send({ type: 'UQA_VIEWPORT_RUNS' });
  const open = (res?.ok ? res.result || [] : []).find((r) => r.mode === 'resized' && !r.closedAt);
  if (!open || !host.isConnected) return;
  const back = el('button', 'part is-plain');
  back.type = 'button';
  back.append(el('b', null, t('popup.viewport.back')));
  back.append(el('em', null, t('popup.viewport.heldAt', { label: open.viewport?.label || t('popup.viewport.anotherSize') })));
  back.addEventListener('click', async () => {
    const out = await send({ type: 'UQA_RESTORE_WINDOW_SIZE' });
    if (!out?.ok) return say(out?.error || t('popup.viewport.backFailed'), 'err');
    say(t('popup.viewport.backDone'), 'ok');
    return renderViewports();
  });
  host.append(back);
}
