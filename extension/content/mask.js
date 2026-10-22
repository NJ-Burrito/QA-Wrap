/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Masking: hide real data by hand, for the rest of the session.
 *
 * Testing happens on staging systems full of real people's names, national
 * numbers, addresses and case files. The moment a tester presses record, all
 * of it is on its way into a screenshot, a video and a report that will be
 * attached to a ticket and read by people who had no business seeing it.
 *
 * Blurring is not masking. A Gaussian blur of a short string is reversible —
 * the search space is small enough to brute-force, and this has been done to
 * published redactions more than once. So a mask here is an **opaque block**
 * painted over the element, and the text underneath is removed from anything
 * the product records, not merely covered in the picture.
 *
 * Four places have to agree, or the mask is theatre:
 *
 *   the picture   an opaque overlay in the page itself, so `captureVisibleTab`
 *                 and the tab recorder capture the block — they photograph the
 *                 page, and the page is already redacted
 *   the harvest   masked elements are skipped, so no locator, no example value
 *                 and no page object carries the text
 *   the recording the recorder replaces the value of a masked field before the
 *                 event is stored, so the timeline never held it
 *   the report    what was masked is *stated* — "3 values masked" — because a
 *                 report that silently omits evidence is a worse document than
 *                 one that says what it is not showing
 *
 * Masks live for the session. They are keyed by a verified CSS path plus the
 * element's accessible name, re-applied on every navigation and on anything the
 * page renders later, so a table that reloads comes back masked.
 *
 * ── three faults fixed on 7 September 2026 ────────────────────────────────
 *
 * Nader: "some elements fail to mask; a table or sheet masks as a whole, not
 * per cell; I want a reset per tab and I want to uncover one thing at a time."
 * All three were real, and each had a different cause.
 *
 * 1. **Elements that failed to mask.** The block is drawn with `::after`, and
 *    `::after` does not render on a replaced element. So masking an `<img>`, a
 *    `<canvas>`, a `<video>`, an `<svg>` or an `<iframe>` set the attribute,
 *    painted nothing at all, and left the picture in the screenshot — the
 *    worst possible outcome, because the tester was told it was covered. The
 *    same for anything with `display: contents`, which generates no box for a
 *    pseudo-element to be positioned against, and for a zero-sized element.
 *    `paint()` now classifies before it marks: a replaced element is marked
 *    `data-uqa-masked-media` and covered by a filter that maps every pixel to
 *    ink, and an element that can carry no box at all is resolved up to the
 *    nearest ancestor that can.
 *
 * 2. **A table masking as a whole.** Two causes, both here. `cssPath()` walks
 *    at most six ancestors and is therefore a *suffix*, not an anchored path:
 *    `tbody > tr:nth-of-type(2) > td:nth-of-type(3)` matches that cell in every
 *    table on the page, so one click masked a column of them. And the accessible
 *    name fallback matched **every** element on the page whose text was equal,
 *    which on a sheet is a whole row. Paths are now verified unique at pick
 *    time and carry the index of the element among their own matches; the name
 *    fallback is bounded to the same tag and to one element.
 *    Picking a table, a row or a grid now masks its **cells, one block each**,
 *    which is what a redacted sheet is supposed to look like and what survives
 *    a re-render with the columns in a different order.
 *
 * 3. **Reset, per tab.** `UQA_MASK_CLEAR` exists and is browser-wide by
 *    design: it belongs to the session. What was missing was a way to say "not
 *    on this page", which is a different sentence. The picking bar now carries
 *    it, and it is local: the session keeps its list, this document stops
 *    applying the entries it was showing, and anything masked afterwards still
 *    works. Nothing new crosses the message boundary for it, because the
 *    control is where the tester already is.
 */
(() => {
  if (window.__UQA_MASK__) return;
  window.__UQA_MASK__ = true;

  const B = window.UQABridge;
  const t = (key, fallback) => window.UQAUiHost?.t?.(key, fallback) ?? fallback;

  const S = window.UQASelector;

  /**
   * Everything masked on this page, as
   * `{id, path, index, name, tag, at}` — the session's list.
   *
   * `id` is new and is the thing every other operation now keys on: removing
   * one mask used to filter by `path`, and two cells in the same re-rendered
   * table can share a path when the page has changed underneath. An id cannot.
   */
  let masks = [];
  let picking = false;
  let box = null;
  let tip = null;
  let observer = null;

  /**
   * Masks this tab has been told to stop showing.
   *
   * The per-tab reset. The session's list is untouched — another tab in the
   * same run still shows them, and that is the point of the list living with
   * the session — but this document stops re-applying these ids. A mask made
   * after the reset is not in the set, so the feature still works here.
   */
  const dismissed = new Set();

  const isOurs = (el) => !!window.UQAUiHost?.isOurs?.(el);

  const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /* ── what can carry a block ───────────────────────────────────────────── */

  /**
   * Elements whose box the browser draws itself, and on which `::after` never
   * renders. The list is the HTML spec's replaced elements plus the two that
   * behave like them in every engine that matters.
   */
  const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT', 'INPUT', 'SELECT', 'TEXTAREA']);

  /** A form field keeps its own box and loses its content. Different paint, same promise. */
  const FIELD = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

  /** Containers whose *cells* are the unit a tester means. */
  const GRID = 'table, thead, tbody, tfoot, tr, [role="table"], [role="grid"], [role="rowgroup"], [role="row"]';

  /** The cells inside one of those. */
  const CELLS = 'td, th, [role="gridcell"], [role="cell"], [role="columnheader"], [role="rowheader"]';

  /**
   * The element that will actually be covered, given the one that was clicked.
   *
   * `display: contents` generates no box, so a pseudo-element positioned
   * against it is positioned against nothing and the mask is invisible. A
   * zero-sized element is the same problem arriving by a different road: the
   * text is drawn by a child, and covering a box of no width covers nothing.
   * In both cases the honest answer is the nearest ancestor that has a box,
   * because that is the thing the tester can see.
   */
  function coverable(el) {
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (REPLACED.has(n.tagName)) return n;
      let display = '';
      try {
        display = getComputedStyle(n).display;
      } catch {
        display = '';
      }
      if (display === 'contents') continue;
      const r = n.getBoundingClientRect?.();
      if (r && (r.width > 0 || r.height > 0)) return n;
    }
    return el;
  }

  /**
   * One click, one or many elements.
   *
   * Picking a cell masks the cell. Picking the table, the row or the grid that
   * holds them masks **each cell separately**, so the redaction survives a
   * re-render that reorders the columns, and so uncovering one cell later does
   * not uncover the row. A container with no cells in it is just an element.
   */
  function targets(el) {
    const grid = el.matches?.(GRID) ? el : null;
    if (!grid) {
      // Somebody who drags a selection and lands on the table's own padding
      // means the table, not the page. Anything else is itself.
      return [coverable(el)];
    }
    const cells = [...grid.querySelectorAll(CELLS)].filter((c) => !isOurs(c));
    return cells.length ? cells.map(coverable) : [coverable(grid)];
  }

  /* ── painting ─────────────────────────────────────────────────────────── */

  /**
   * Mark one element as masked.
   *
   * The attribute is what `overlay.css` paints against, and what the harvester
   * and the recorder both test for. Setting it is the whole mechanism: one
   * flag, read by everyone, so a new consumer cannot forget to ask.
   *
   * The second attribute says *how* to paint it, and it is the fix for the
   * elements that used to fail silently. A `<td>` gets the block from
   * `::after`. An `<input>` gets the hatch on its own background. An `<img>`,
   * a `<canvas>`, a `<video>` or an `<iframe>` gets neither, because neither
   * renders on a replaced element, so it gets a filter that maps every pixel
   * it draws to ink instead.
   */
  function paint(el) {
    if (!el || el.nodeType !== 1) return;
    // Asleep paints nothing, whoever asked: see `asleep()` below.
    if (asleep()) return;
    el.setAttribute('data-uqa-masked', '');
    if (FIELD.has(el.tagName)) el.setAttribute('data-uqa-masked-field', '');
    else if (REPLACED.has(el.tagName)) el.setAttribute('data-uqa-masked-media', '');
  }

  function unpaint(el) {
    el?.removeAttribute?.('data-uqa-masked');
    el?.removeAttribute?.('data-uqa-masked-field');
    el?.removeAttribute?.('data-uqa-masked-media');
  }

  /**
   * A path that means one element, and the index that says which.
   *
   * `cssPath()` walks six ancestors at most, which makes it a suffix rather
   * than an anchored path: on a page with three tables, one cell's path
   * matches three cells. It is the right trade for the locator engine, which
   * ranks candidates and verifies them; it is the wrong one for a redaction,
   * where matching too much is not "close enough", it is masking somebody
   * else's row and telling the tester it masked theirs.
   *
   * So the path is measured at pick time. If it matches once, that is the
   * whole key. If it matches several, the index of this element among those
   * matches is stored beside it and `apply()` takes only that one.
   */
  function pathFor(el) {
    let path = '';
    try {
      path = S.cssPath(el);
    } catch {
      path = '';
    }
    if (!path) return { path: '', index: 0 };
    let found = [];
    try {
      found = [...document.querySelectorAll(path)];
    } catch {
      return { path: '', index: 0 };
    }
    const index = found.indexOf(el);
    return { path, index: index < 0 ? 0 : index };
  }

  /**
   * Is this window asleep? The bridge writes `window.UQAAwake` from the
   * worker's answer and from every `UQA_ARMED_CHANGED`; `false` is a decision,
   * `undefined` is "not asked yet" and is not asleep.
   */
  function asleep() {
    return window.UQAAwake === false;
  }

  /**
   * Sleep, full stop (6 Oct 2026, Nader: "when I Sleep it still masks").
   *
   * The worker's `UQA_MASK_CLEAR` is one best-effort push, and a tab that was
   * loading, restored from the back/forward cache, busy past the deadline, or
   * handed a stale `UQA_MASK_APPLY` after it kept its blocks. So the page stops
   * by itself: everything unpainted, the list emptied (masks are cleared, not
   * restored on Wake), the observer gone and any crosshair ended. Idempotent.
   */
  function sleepNow() {
    stop();
    for (const el of document.querySelectorAll('[data-uqa-masked],[data-uqa-masked-field],[data-uqa-masked-media]')) unpaint(el);
    masks = [];
    dismissed.clear();
    observer?.disconnect();
    observer = null;
  }

  /** A tab that missed the message clears itself the next time it is seen. */
  function recheckSleep() {
    if (asleep()) {
      if (masks.length || picking || observer) sleepNow();
      return;
    }
    if (!masks.length && !picking) return;
    B.send({ type: 'UQA_ARMED' })
      .then((res) => {
        if (res?.result?.armed === false || res?.armed === false) {
          window.UQAAwake = false;
          sleepNow();
        }
      })
      .catch(() => {});
  }

  /** Re-apply every stored mask to whatever is on the page now. */
  function apply() {
    if (asleep()) {
      if (masks.length || observer) sleepNow();
      return;
    }
    for (const m of masks) {
      // The per-tab reset. The entry stays in the session, and this document
      // stops drawing it.
      if (m.id && dismissed.has(m.id)) continue;
      let found = [];
      try {
        found = m.path ? [...document.querySelectorAll(m.path)] : [];
      } catch {
        found = [];
      }
      /*
       * One element, not every element the suffix happens to reach.
       *
       * This used to paint the whole list, which is how one click on a cell
       * masked the same cell in every table on the page. The index was
       * measured when the mask was made; if the page still has that many
       * matches it is still the right one, and if it does not, the first match
       * is the honest guess rather than all of them.
       */
      if (found.length > 1) found = [found[m.index] || found[0]];

      // A page that re-renders often changes the nth-of-type under a stable
      // parent, so the accessible name is the second key: same name, same tag,
      // still the field that was masked. Bounded to one element and to the tag
      // that was picked: unbounded, it matched every wrapper whose text was
      // equal, which on a sheet is the row and the table as well as the cell.
      if (!found.length && m.name) {
        const tag = m.tag || '*';
        let candidates = [];
        try {
          candidates = [...document.querySelectorAll(tag)];
        } catch {
          candidates = [];
        }
        const hit = candidates.find((el) => !isOurs(el) && accName(el) === m.name);
        if (hit) found = [hit];
      }
      for (const el of found) paint(el);
    }
  }

  /**
   * The second key a mask is found by.
   *
   * A declaration rather than an arrow, so `tools/test-masking.mjs` can lift it
   * out of this file by name and test the real one. The rule the whole test
   * suite here rests on: a copy of the logic in the test passes for ever while
   * the shipped code diverges.
   */
  function accName(el) {
    const t = (el.getAttribute?.('aria-label') || el.getAttribute?.('name') || el.id || '').trim();
    return t || (el.textContent || '').trim().slice(0, 60);
  }

  /**
   * Watch for the page rendering the same data again.
   *
   * A results table that reloads after a filter, a modal that reopens, a row
   * added by a fetch — all of them bring the text back. Without this the mask
   * lasts until the next click, which is not what "until the session ends"
   * means to the person who asked for it.
   */
  function watch() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      if (asleep()) return sleepNow();
      if (!masks.length) return;
      const touched = records.some((r) => r.addedNodes.length || r.type === 'characterData');
      if (touched) apply();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /* ── the list, changed ────────────────────────────────────────────────── */

  /** Add one element to the session's list, if it is not there already. */
  function add(el) {
    if (asleep()) return;
    const { path, index } = pathFor(el);
    const entry = {
      id: newId(),
      path,
      index,
      name: accName(el),
      tag: el.tagName.toLowerCase(),
      at: Date.now(),
      // Where it was covered, for the report's masking panel. Origin plus
      // pathname and nothing else: a query string on a staging system is
      // regularly the record id of the person being hidden.
      page: location.origin + location.pathname,
    };
    masks.push(entry);
    paint(el);
    return entry;
  }

  /**
   * Take one back.
   *
   * By id, and only by id. Filtering by `path` removed every entry that shared
   * a path, which after a re-render is the rest of the column: uncovering one
   * cell uncovered four. The element is unpainted here rather than left to the
   * next `apply()`, because the next `apply()` may be a scroll away.
   */
  function remove(el) {
    // The block that was clicked, and any block nested inside it: uncovering a
    // row the tester had masked cell by cell has to take the cells with it, or
    // the row comes back looking half redacted.
    const nested = el.querySelectorAll ? [...el.querySelectorAll('[data-uqa-masked]')] : [];
    const gone = [];
    for (const node of new Set([el, ...nested])) {
      const { path, index } = pathFor(node);
      const hit =
        masks.find((m) => m.path && m.path === path && m.index === index) ||
        masks.find((m) => m.name && m.name === accName(node) && m.tag === node.tagName.toLowerCase());
      if (hit) {
        gone.push(hit.id);
        masks = masks.filter((m) => m.id !== hit.id);
      }
      unpaint(node);
    }
    return gone;
  }

  /* ── picking ──────────────────────────────────────────────────────────── */

  function mount() {
    box = window.UQAUiHost.uiLayer('uqa-mask-box');
    /*
     * The highlight is a highlight, never a target.
     *
     * `uiLayer()` sets `pointer-events: auto` inline on every layer it makes,
     * so the tool's own controls stay clickable — and an inline declaration
     * beats the `pointer-events: none` this class carries in `overlay.css`.
     * The box follows the pointer and is positioned exactly over the element
     * under it, so with events on it is *always* the thing a click lands on:
     * every press hit `qaw-ui` instead of the page, and nothing was ever
     * masked. Said here as well as in the stylesheet because this is the
     * declaration that actually wins.
     */
    box.style.pointerEvents = 'none';
    tip = window.UQAUiHost.uiLayer('uqa-mask-tip');
    tip.textContent = '';

    const line = document.createElement('span');
    line.textContent = t('overlay.mask.tip', 'Click to cover or uncover. Esc to finish.');

    /*
     * The reset, on the page rather than in the popup.
     *
     * Nader asked for it "per tab, not browser". The session's mask list is
     * deliberately browser-wide: it is what makes a mask survive a navigation
     * and cover the same column in the tab beside this one. So the per-tab
     * reset cannot be a message that clears the list, and it does not need to
     * be one: the tester is standing on the page, the control belongs where
     * they are standing, and nothing has to cross the message boundary for it.
     */
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'uqa-mask-reset';
    reset.textContent = t('overlay.mask.reset', 'Uncover all on this page');
    reset.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetThisPage();
      },
      true
    );

    // The reticle is the `pick` drawing from the icon family (ui/icons.js is only
    // injected into the top frame with the bar, so a frame without it carries
    // the same path here). ponytail: a second copy of one drawing; read it from
    // UQAIcons alone if icons.js is ever declared in every frame.
    const reticle = document.createElement('span');
    reticle.innerHTML = window.UQAIcon?.('pick', { size: 's' }) ||
      '<svg class="icon is-s" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.42 14.58A6 6 0 1 0 13.5 17.81"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M12 10l2 2-2 2-2-2z" fill="currentColor" stroke-width="1"/></svg>';
    tip.append(reticle, line, reset);
  }

  function unmount() {
    box?.remove();
    tip?.remove();
    box = tip = null;
  }

  /**
   * Stop showing, on this page only.
   *
   * Every entry currently in the list is dismissed here and nowhere else. The
   * observer comes down with it, because there is nothing left for it to
   * re-apply; masking something new starts it again.
   */
  function resetThisPage() {
    const covered = document.querySelectorAll('[data-uqa-masked]').length;
    for (const m of masks) if (m.id) dismissed.add(m.id);
    for (const el of document.querySelectorAll('[data-uqa-masked]')) unpaint(el);
    observer?.disconnect();
    observer = null;
    window.UQAUiHost?.flash(
      covered
        ? t('overlay.mask.uncoveredN', 'Uncovered {n} on this page. The session keeps them for the other tabs.').replace('{n}', covered)
        : t('overlay.mask.uncoveredNone', 'Nothing was covered on this page.')
    );
    return covered;
  }

  function place(el) {
    if (!box || !el) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  function onMove(e) {
    if (!picking) return;
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (isOurs(el)) el = window.UQAUiHost.pageElementAt(e.clientX, e.clientY);
    if (el && el !== document.documentElement) place(el);
  }

  /**
   * Is this click the picking bar's own business?
   *
   * The bar carries a button now, so a press on it must not also be a press on
   * the page underneath. The first version of that guard asked `isOurs(e.target)`
   * — is this anything of ours at all — and that is too wide by exactly one
   * layer: the highlight box is ours too, it tracks the pointer, and a `click`
   * is retargeted at the shadow host, so **every** pick answered yes and
   * returned before it masked anything. The box is inert again above, and the
   * question here is the narrow one it was always meant to be: did this click
   * happen inside the bar?
   *
   * `composedPath()` rather than `e.target`, because retargeting is the whole
   * problem: from the page's side every node in the shadow root arrives as
   * `qaw-ui`, and the composed path is the only place the real one survives.
   */
  function onOurBar(e) {
    if (!tip) return false;
    // The root is closed: a document listener's composedPath() stops at the host and never
    // names `tip`. The target is the host (isOurs) and the pointer must sit inside the bar's box.
    if (!window.UQAUiHost?.isOurs?.(e.target)) return false;
    const r = tip.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  async function onClick(e) {
    if (!picking) return;
    /*
     * The bar's own buttons are the bar's business.
     *
     * Propagation is still stopped: the bar sits over the page, so without
     * this the page under test sees a click on `qaw-ui` and any handler it has
     * on `document` runs. The tool must not be an event the page can observe.
     * `preventDefault` is not called, because the button inside the bar has to
     * keep working.
     */
    if (onOurBar(e)) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (isOurs(el)) el = window.UQAUiHost.pageElementAt(e.clientX, e.clientY);
    if (!el || el === document.documentElement || el === document.body) return;

    // Already masked, and clicked again: that is how you take one back. The
    // click may land on a child of the block, so the masked ancestor is the
    // thing being pointed at.
    const covered = el.closest?.('[data-uqa-masked]');
    if (covered) {
      const gone = remove(covered);
      for (const id of gone) dismissed.delete(id);
      await B.send({ type: 'UQA_MASK_SET', masks });
      window.UQAUiHost?.flash(t('overlay.mask.uncovered', 'Uncovered.'));
      return;
    }

    const picked = targets(el);
    for (const node of picked) {
      if (node.hasAttribute('data-uqa-masked')) continue;
      add(node);
    }
    watch();
    await B.send({ type: 'UQA_MASK_SET', masks });
    if (picked.length > 1) {
      window.UQAUiHost?.flash(t('overlay.mask.cells', '{n} cells covered, one block each.').replace('{n}', picked.length));
    }
  }

  function onKey(e) {
    if (!picking) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      B.send({ type: 'UQA_MASK_DONE', n: document.querySelectorAll('[data-uqa-masked]').length }); // ui-1016 L: the worker ignores the type; the open panel says the outcome
    }
  }

  function start() {
    if (picking || asleep()) return;
    // One crosshair at a time. See claimPointer() in content/ui-host.js: two
    // tools capturing clicks at once means one of them eats the other's, and
    // which one depends on the order two buttons were pressed in.
    window.UQAUiHost?.claimPointer?.('mask', stop);
    picking = true;
    // The tip's words come from the worker (UQA_OVERLAY_ASSETS), and t() reads
    // them once: draw only after they land, or the first open on a fresh page
    // is English in an Arabic UI. A stop() before then leaves nothing to draw.
    Promise.resolve(window.UQAUiHost?.assets?.()).catch(() => {}).then(() => { if (picking && !box) mount(); });
    document.documentElement.classList.add('uqa-masking');
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);
  }

  function stop() {
    if (!picking) return;
    window.UQAUiHost?.releasePointer?.('mask');
    picking = false;
    unmount();
    document.documentElement.classList.remove('uqa-masking');
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', onKey, true);
  }

  /**
   * Does this string contain text the tester has covered?
   *
   * The question the locator picker has to ask. A mask that stops the value
   * reaching the report and lets `getByText('Ahmad Al Zaghloul')` onto the
   * clipboard has not masked anything: the name is in the test file instead of
   * in the screenshot, which is committed to a repository and lives longer.
   *
   * Three characters is the floor, because a masked cell reading "7" would
   * otherwise refuse every locator with a seven anywhere in it, and a tool that
   * refuses everything is a tool that gets switched off.
   */
  function leaksMaskedText(text) {
    const s = String(text ?? '');
    if (!s) return false;
    for (const el of document.querySelectorAll('[data-uqa-masked]')) {
      const inner = (el.textContent || '').trim();
      if (inner.length >= 3 && s.includes(inner)) return true;
      const name = (el.getAttribute?.('aria-label') || '').trim();
      if (name.length >= 3 && s.includes(name)) return true;
    }
    return false;
  }

  /* ── the outside world ────────────────────────────────────────────────── */

  /**
   * Is this element, or anything above it, masked?
   *
   * Asked by the harvester before it describes an element, by the recorder
   * before it stores a value, and by the locator picker before it puts a
   * locator built out of somebody's name on the clipboard. Walking up matters:
   * masking a table cell must also mask the text node inside it, which is what
   * the tester pointed at.
   */
  window.UQAMask = {
    isMasked(el) {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.hasAttribute?.('data-uqa-masked')) return true;
      }
      return false;
    },
    leaks: leaksMaskedText,
    /** What to store in place of a real value. Fixed length: a mask that leaks the length is not a mask. */
    placeholder: () => '••••••',
    count: () => masks.length,
    list: () => masks.slice(),
    apply,
    resetThisPage,
    asleep,
    sleepNow,
  };

  // Back/forward cache and tab switching: a page that was frozen while the
  // window went to sleep wakes up here without having heard anything.
  addEventListener('pageshow', recheckSleep);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recheckSleep();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /*
     * This extension's own worker, and nothing else.
     *
     * `sender.id` is stamped by the browser and cannot be forged: a message from
     * another extension carries that extension's id, and one from a web page
     * carries no id at all. `sender.tab` is refused as well, because every
     * message this listener is meant to hear comes from the service worker,
     * which is not a tab; anything arriving with a tab on it came from somewhere
     * that has no business driving a tool inside the page under test.
     *
     * The model is `content/bridge.js`, and the rule is research/51d §7:
     * authorise on `sender.id`, never on `sender.url`.
     */
    if (sender?.id !== chrome.runtime.id || sender?.tab) return false;
    if (msg?.type === 'UQA_ARMED_CHANGED') {
      // The worker's broadcast on Sleep. Set the flag here as well as in the
      // bridge so the order the two listeners run in does not matter.
      if (msg.armed === false) {
        window.UQAAwake = false;
        sleepNow();
      }
      return false;
    }
    if (msg?.type === 'UQA_MASK_PICK') {
      // `off` is a stop, never a toggle. Sleep has to be able to END picking
      // mode without knowing whether it is on: a toggle sent to a page that was
      // not picking would have STARTED a crosshair in a window the tester had
      // just put to sleep, which is the exact opposite of the master switch's
      // promise.
      if (msg.off) stop();
      else picking ? stop() : start();
      sendResponse({ asleep: asleep(), picking, count: masks.length, onPage: document.querySelectorAll('[data-uqa-masked]').length });
      return true;
    }
    if (msg?.type === 'UQA_MASK_APPLY') {
      if (asleep()) {
        sleepNow();
        sendResponse({ count: 0 });
        return true;
      }
      masks = Array.isArray(msg.masks) ? msg.masks : [];
      apply();
      if (masks.length) watch();
      sendResponse({ count: masks.length });
      return true;
    }
    if (msg?.type === 'UQA_MASK_CLEAR') {
      for (const el of document.querySelectorAll('[data-uqa-masked]')) unpaint(el);
      masks = [];
      dismissed.clear();
      sendResponse({ count: 0 });
      return true;
    }
    /*
     * "Reset masks on this tab", from the popup.
     *
     * GROUP G, 7 September 2026, for decision 6 of
     * `research/56-decisions-2026-09-07.md`. `resetThisPage()` already existed
     * and was reachable only from the in-page bar; the popup is where the tool
     * was armed, so it is where a tester looks for the way to undo it. This is
     * one branch and it calls the same function the bar calls — deliberately
     * not a second implementation of "reset", because two of those is how the
     * page bar and the popup come to mean different things.
     *
     * Distinct from `UQA_MASK_CLEAR` above, which empties the session's whole
     * mask list for every tab. This dismisses them here and leaves the session
     * holding them for the other tabs, which is what "on this tab" says.
     */
    if (msg?.type === 'UQA_CLEAR_MASKS') {
      sendResponse({ uncovered: resetThisPage(), kept: masks.length });
      return true;
    }
    if (msg?.type === 'UQA_MASK_COUNT') {
      sendResponse({
        count: masks.length,
        onPage: document.querySelectorAll('[data-uqa-masked]').length,
        dismissed: dismissed.size,
      });
      return true;
    }
    return false;
  });

  // A navigation brings a fresh page; the session's masks come with it.
  B.send({ type: 'UQA_MASK_GET' })
    .then((res) => {
      const list = res?.result?.masks || res?.masks;
      if (Array.isArray(list) && list.length && !asleep()) {
        masks = list;
        apply();
        watch();
      }
    })
    .catch(() => {
      /* not recording, or the worker is asleep — nothing to re-apply */
    });
})();
