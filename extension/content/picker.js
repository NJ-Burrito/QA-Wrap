/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Element picker.
 *
 * Hover to highlight, click to lock in a verified Playwright locator, Esc to
 * cancel. The tooltip shows the strategy and match count, because a locator you
 * cannot trust is worse than no locator at all.
 */
(() => {
  if (window.__UQA_PICKER__) return;
  window.__UQA_PICKER__ = true;

  const B = window.UQABridge;
  const S = window.UQASelector;

  let active = false;
  let box = null;
  let tip = null;
  let current = null;

  // Pointer tracking is coalesced through one rAf so a fast pointer never
  // queues more than one paint() per frame — see F05.
  let pendingEl = null;
  let rafId = 0;
  let pressed = false;

  // The basket: Shift+click adds the element under the cursor, Enter (or
  // Ctrl+C, or the chip) copies every locator in it, one per line. A plain
  // click still copies the one element and stops, as it always did — the
  // basket is the extra, not a mode to switch on.
  let basket = [];
  let chip = null;

  /**
   * What the tester is picking this element FOR — their word, not a guess.
   *
   * `categoryOf()` below reads a tag and a role and calls the element a label,
   * a field or an image. That is a fact about the element. It is not the thing
   * a script author needs, which is a fact about the *walk*: is this a step of
   * the flow, something the script has to account for once it gets there, or a
   * place a secret goes. Only the person walking the flow knows, so they say.
   *
   *   any        the tool as it always was: copy one locator and stop
   *   step       something the flow does, in order — the navigation
   *   element    something the script must account for: it files what the
   *              element looked like, so the generated test can check it
   *   sensitive  a value that must never be written down: the element's own
   *              words are withheld, exactly as a masked element's are
   *
   * The purpose changes what a pick is filed as, never how the tool is driven:
   * in every one of the four a plain click copies one and stops, and Shift+click
   * collects several (each remembering the purpose it was added under).
   *
   * ponytail: held per document, so a navigation mid-walk starts again at
   * whatever the tool was launched with. Carry it on the session if that bites.
   */
  const PURPOSES = ['any', 'step', 'element', 'sensitive'];
  const HINTS = {
    any: 'Any: a locator and nothing more.',
    step: 'Step: a step of the flow, in order. Shift+click to take several.',
    element: 'Element: something the script must account for. What it looks like now is recorded as the expected outcome.',
    sensitive: 'Sensitive: a value that must never be written down. Its own words are withheld.',
  };
  const isPurpose = (p) => PURPOSES.includes(p);
  /** A string in the tester's language (`overlay.*`, sent with the face), English until it lands. */
  const t = (key, fallback) => window.UQAUiHost?.t?.(key, fallback) ?? fallback;
  const hint = (p) => t(`overlay.purpose.${p}Hint`, HINTS[p]);
  let purpose = 'any';

  /**
   * The frameLocator chain this frame sits behind, when it cannot see it.
   *
   * A page under test on claude.ai lives in an iframe on another origin, and
   * `window.frameElement` throws there. So the engine could only offer
   * `page.locator('[data-dc-tpl="420"]')` with a warning that the chain was
   * incomplete: a locator that does not run, handed to a tester who then has to
   * work out the missing half themselves. The service worker can see the frame
   * tree that no frame can, so it builds the chain and the answer is kept here
   * for the length of the picking session — an iframe's identity does not
   * change while somebody is pointing inside it, and asking on every mousemove
   * would be a round trip per pixel.
   */
  let chain = null;

  /** What describe() should be told about this frame's ancestry, if anything. */
  const describeOpts = () => (chain ? { frame: chain } : undefined);

  async function resolveChain() {
    if (window.top === window) return;
    // Same-origin ancestors are walkable from here and always were. Only the
    // frame that cannot see its own boundary needs the worker.
    if (!S.framePrefix().crossOrigin) return;
    const res = await B?.send({ type: 'UQA_FRAME_CHAIN' });
    const built = res?.ok ? res.result : null;
    if (built?.complete && built.prefix) {
      chain = { prefix: built.prefix, crossOrigin: false, depth: built.depth };
      // A pointer that got there first was described without the chain, and
      // paint() skips an element it already shows: describe it again.
      if (active && current?.el?.isConnected) paint(current.el);
    }
  }

  /**
   * End the picking session in every frame, not only this one.
   *
   * The script is injected with `allFrames: true`, so a page with an iframe has
   * two crosshairs running and each hears only its own keyboard. Escape pressed
   * inside the iframe used to cancel that frame and leave the top frame still
   * armed, so the cursor stayed and the tester pressed Escape again somewhere
   * else to be rid of it. A copy ends it for the same reason: it is one
   * session, however many documents it spans.
   */
  function endEverywhere() {
    stop();
    B?.send({ type: 'UQA_PICK_OFF' });
  }

  /*
   * The pick style (DESIGN-SPEC §5.5): two crisp rings in the purpose colour
   * with a white halo between, drawn over the element and never inside it —
   * no glow, no tint — and a name chip that never covers what it names.
   * The purpose switch lives on the in-page bar (`content/bar.js`) and on the
   * keys 1 to 4; the old strip of four buttons is gone.
   */
  const layer = (cls) => {
    const n = window.UQAUiHost.uiLayer(cls);
    // uiLayer() turns pointer events on inline; a ring over the element must never take the click.
    n.style.pointerEvents = 'none';
    return n;
  };

  function mount() {
    // `html.uqa-picking` stays in the light DOM — it only sets a cursor, and a
    // cursor on the page is the point. Everything drawn is in the shadow root.
    box = layer('uqa-ring');
    tip = layer('uqa-chip');
  }

  function unmount() {
    box?.remove();
    tip?.remove();
    chip?.remove();
    for (const r of ringLayers) r.remove();
    ringLayers.clear();
    box = tip = current = chip = null;
    if (window.top === window) window.UQABar?.setLocked?.([]);
  }

  const grow = (r, px) => ({ left: r.left - px, top: r.top - px, right: r.right + px, bottom: r.bottom + px });
  const meets = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /** A ring box exactly over the element, with the element's own corners. */
  function placeRing(ring, el, r = el.getBoundingClientRect()) {
    ring.style.width = `${r.width}px`;
    ring.style.height = `${r.height}px`;
    ring.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
    try { ring.style.borderRadius = getComputedStyle(el).borderRadius || ''; } catch { /* a detached node */ }
  }

  /**
   * Where the chip goes: the first of six places that is fully on screen,
   * clear of the ring box plus 4px, and clear of the bar (§5.5). If none is
   * (an element that fills the viewport), it is pinned 8px inside the edge
   * opposite the bar — the only case it can overlap the element at all.
   */
  function placeChip(label, r, locked) {
    const vw = innerWidth;
    const vh = innerHeight;
    const cw = label.offsetWidth;
    const ch = label.offsetHeight;
    const ltr = getComputedStyle(label).direction !== 'rtl';
    const ring = grow(r, locked ? 8 : 4);
    const keep = grow(ring, 4);
    const bar = window.top === window ? window.UQABar?.rect?.() : null;
    const gap = 6;
    const start = ltr ? ring.left : ring.right - cw;
    const end = ltr ? ring.right - cw : ring.left;
    const above = ring.top - ch - gap;
    const below = ring.bottom + gap;
    const mid = r.top + r.height / 2 - ch / 2;
    const spots = [
      [start, above], [start, below], [end, above], [end, below],
      [ltr ? ring.right + gap : ring.left - cw - gap, mid],
      [ltr ? ring.left - cw - gap : ring.right + gap, mid],
    ];
    let at = spots.find(([x, y]) => {
      const c = { left: x, top: y, right: x + cw, bottom: y + ch };
      return c.left >= 0 && c.top >= 0 && c.right <= vw && c.bottom <= vh && !meets(c, keep) && !(bar && meets(c, bar));
    });
    if (!at) {
      const lo = (v, max) => Math.min(Math.max(v, 8), Math.max(8, max));
      const barTop = bar && bar.top + bar.height / 2 > vh / 2;
      at = [lo(r.left, vw - 8 - cw), bar && !barTop ? vh - 8 - ch : 8];
    }
    label.style.transform = `translate3d(${Math.round(at[0])}px, ${Math.round(at[1])}px, 0)`;
    // It rises away from the element (motion #34).
    label.style.setProperty('--chip-from', at[1] >= ring.bottom ? '-4px' : '4px');
  }

  /** What the chip says: the purpose, the role, and the accessible name — never covered words. */
  function chipText(el, desc) {
    const M = window.UQAMask;
    const role = desc?.role || el?.tagName?.toLowerCase() || '';
    const withheld = !!M?.isMasked?.(el) || !!desc?.maskedSource || purpose === 'sensitive';
    const raw = withheld ? (M?.placeholder?.() || '••••') : String(desc?.name || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const name = raw.length > 60 ? `${raw.slice(0, 59)}…` : raw;
    const rtl = getComputedStyle(tip).direction === 'rtl';
    const quoted = name ? (rtl ? `«${name}»` : `“${name}”`) : '—';
    return `<span class="uqa-chip-square" aria-hidden="true">${PURPOSES.indexOf(purpose) + 1}</span>` +
      `<span class="uqa-chip-role">${esc(role)}</span><span aria-hidden="true">·</span>` +
      `<span class="uqa-chip-name">${esc(quoted)}</span>`;
  }

  /**
   * The copy, shown where it happened: the ring lands and the chip says
   * "Copied" for 1200 ms, then both go. Separate layers from the live ring and
   * chip, so ending the picker on the same click does not take them away.
   */
  function linger(el, why) {
    const r = el.getBoundingClientRect();
    const ring = layer('uqa-ring is-locked is-visible');
    ring.dataset.purpose = why;
    placeRing(ring, el, r);
    const label = layer('uqa-chip');
    label.dataset.purpose = why;
    label.innerHTML = `<span class="uqa-chip-copied">${window.UQAIcon?.('check', { size: 's' }) || ''}${esc(t('options.sound.ui.copy', 'Copied'))}</span>`;
    placeChip(label, r, true);
    requestAnimationFrame(() => label.classList.add('is-visible'));
    const top = window.top === window;
    if (top) window.UQABar?.setLocked?.([grow(r, 8)]);
    setTimeout(() => {
      ring.remove();
      label.remove();
      if (top && !active) window.UQABar?.setLocked?.([]);
    }, 1200);
  }

  /**
   * Switch what the next pick is for.
   *
   * `announce` is the difference between the tester pressing a key and the
   * worker relaying that press to the other frames of the tab: only the first
   * tells the worker, or two frames would relay each other's relay for ever.
   */
  function setPurpose(next, announce) {
    if (!isPurpose(next)) return;
    purpose = next;
    if (box) box.dataset.purpose = purpose;
    if (tip) tip.dataset.purpose = purpose;
    if (current && tip) {
      tip.innerHTML = current.desc && !current.desc.blocked ? chipText(current.el, current.desc) : tip.innerHTML;
    }
    if (window.top === window) window.UQABar?.setPurpose?.(purpose);
    if (!announce) return;
    flash(hint(purpose));
    B?.send({ type: 'UQA_PICK', purpose });
  }

  /** Every basket entry wears a locked ring, numbered once there are two. */
  const ringLayers = new Set();
  function paintBasketRings() {
    basket.forEach((b, i) => {
      if (!b.ring) {
        b.ring = layer('uqa-ring is-locked is-visible');
        b.ring.dataset.purpose = b.purpose;
        ringLayers.add(b.ring);
      }
      placeRing(b.ring, b.el);
      let badge = b.ring.querySelector('.uqa-ring-badge');
      if (basket.length > 1) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'uqa-ring-badge';
          b.ring.append(badge);
        }
        badge.textContent = String(i + 1);
      } else badge?.remove();
    });
    if (window.top === window) window.UQABar?.setLocked?.(basket.map((b) => grow(b.el.getBoundingClientRect(), 8)));
  }

  function paintChip() {
    // The shadow root is closed on purpose; the count is mirrored here so a
    // harness or another tool can read it without reaching inside.
    document.documentElement.dataset.uqaBasket = String(basket.length);
    paintBasketRings();
    if (!basket.length) { chip?.remove(); chip = null; return; }
    if (!chip) chip = window.UQAUiHost.uiLayer('uqa-pick-chip');
    chip.textContent = '';
    const n = document.createElement('b');
    n.textContent = t('overlay.chip.picked', 'Picked: {n}').replace('{n}', basket.length);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('overlay.chip.copyAll', 'Copy all');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); copyBasket(); }, true);
    chip.append(n, btn);
  }

  /** The basket, as text a test file can take: one locator per line, unique ones first. */
  function basketText() {
    const lines = basket.map((b) => b.desc.playwright);
    return [...new Set(lines)].join('\n');
  }

  /**
   * File every selector that went to the clipboard, one event each.
   *
   * The note beside it stays what it always was: one readable line in the
   * timeline. This carries the rest, which is what the report's Selector copy
   * section is built from. Every flavour the tool had on offer with the one
   * that actually went to the clipboard marked; the element's tag, id, classes,
   * role and visible text; and its size on the page.
   *
   * Sent through `UQA_EVENT` rather than a message of its own, so it inherits
   * `ingest()` whole: the sender checks, the field allow-list in
   * `core/events.js`, the refusal to record a sleeping window or a tab that
   * belongs to another session, and the browser's word rather than the page's
   * for the frame URL and the tab title.
   *
   * There is a picture, and where it is cut is the whole design. A crop has to
   * come out of `chrome.tabs.captureVisibleTab`, which only the service worker
   * can call - but the worker's boot graph has under a kilobyte of headroom
   * against the `MAX_BYTES` ceiling in `tools/test-worker-imports.mjs`, which
   * that file says must not be raised until the export builders move behind the
   * offscreen document. So the worker takes the photograph and nothing else,
   * and the cropping happens here, in the page, where bytes cost nothing. See
   * `previews()` below and `research/71-selector-preview-image-2026-09-09.md`.
   *
   * Every event carries the same `ts` the note does, which is what lets the
   * section point at the timeline row for the same copy.
   */
  /**
   * label / text / field / image / sensitive — the same coarse bucket
   * `content/harvester.js#kindOf` sorts a whole-page walk into, read off the
   * one element a pick already describes. `desc.maskedSource` wins over
   * everything else: a locator built from covered words is sensitive
   * regardless of what tag it sits on. "function"/"action" (a button that
   * *does* something) is not attempted here — that needs the recorder's
   * `dom` events joined in, which is gap G2, not this one.
   */
  function categoryOf(el, desc) {
    if (desc?.maskedSource) return 'sensitive';
    const tag = (desc?.tag || el?.tagName?.toLowerCase() || '').toLowerCase();
    const role = (desc?.role || el?.getAttribute?.('role') || '').toLowerCase();
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || role === 'img' || role === 'image') return 'image';
    if (
      tag === 'input' || tag === 'textarea' || tag === 'select' ||
      ['textbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider'].includes(role)
    ) return 'field';
    if (tag === 'label' || tag === 'legend' || /^h[1-6]$/.test(tag) || role === 'heading') return 'label';
    return 'text';
  }

  /**
   * The words a sensitive pick must not carry: the element's own text.
   *
   * Empty for a form field — its text is its label, the value is never read by
   * this file at all — and empty under three characters, where "contains the
   * text" would match half of every locator on the page and withhold them all.
   */
  function ownText(el) {
    if (!el || categoryOf(el, null) === 'field') return '';
    const t = String(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return t.length >= 3 ? t : '';
  }

  function fileCopies(items, ts) {
    if (!items.length) return;
    const M = window.UQAMask;
    const leaks = (text) => (M?.leaks ? !!M.leaks(text) : false);
    // A flavour built out of covered words is not offered, for exactly the
    // reason `withoutMaskedText` above refuses to copy one: the report is a
    // file that ends up committed to a repository.
    const cleanMasked = (expr) => (expr && !leaks(String(expr)) ? String(expr) : null);
    const trim = (value, n) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

    // Built first, sent after the photograph: every rectangle has to be read
    // before anything awaits, because a rect measured after the page has had a
    // chance to move is a crop of whatever moved into that box.
    const records = [];

    items.forEach(({ el, desc, credRef, intent, purpose: why }, i) => {
      // A sensitive pick is treated as a covered element from here down: its
      // own words are the thing being protected, so they are withheld from the
      // text, from every flavour built out of them, and from the photograph.
      const sensitive = why === 'sensitive';
      const own = sensitive ? ownText(el) : '';
      const clean = (expr) => (cleanMasked(expr) && !(own && String(expr).includes(own)) ? String(expr) : null);
      const masked = !!M?.isMasked?.(el) || sensitive;
      const r = el?.getBoundingClientRect?.() || null;
      const onScreen =
        !!r && r.width > 0 && r.height > 0 &&
        r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const flavours = [
        {
          name: 'playwright',
          expr: desc.playwright,
          copied: true,
          strategy: desc.strategy,
          matches: desc.matches ?? null,
          unique: !desc.ambiguous,
        },
        { name: 'css', expr: clean(desc.css) },
        { name: 'xpath', expr: clean(desc.xpath) },
        ...(desc.alternatives || []).map((a) => ({
          name: a.strategy, expr: clean(a.expr), matches: a.matches ?? null, unique: !!a.unique,
        })),
      ].filter((f) => f.expr);
      if (!flavours.length) return;

      records.push({
        rect: onScreen && !sensitive ? r : null,
        event: {
          kind: 'selectorcopy',
          purpose: isPurpose(why) ? why : 'any',
          // A millisecond apart, so a basket of five keeps the order it was
          // picked in through a store that sorts on the clock.
          ts: ts + i,
          frameUrl: location.href,
          copied: desc.playwright,
          flavours,
          strategy: desc.strategy || null,
          matches: desc.matches ?? null,
          ambiguous: !!desc.ambiguous,
          warnCodes: desc.warnCodes,
          maskedSource: !!desc.maskedSource,
          category: categoryOf(el, desc),
          tag: desc.tag || el?.tagName?.toLowerCase() || null,
          elementId: trim(el?.id, 60) || null,
          classes: trim(typeof el?.className === 'string' ? el.className : '', 90) || null,
          role: desc.role || null,
          // The accessible name: what a person calls this element, and the one
          // thing a form field has that `text` cannot give (an input has no
          // text of its own). Withheld wherever the words themselves are.
          label: (M?.isMasked?.(el) || own) ? null : trim(desc.name, 80) || null,
          // The same 80 characters `UQA_HIGHLIGHT_SELECTOR` answers with, and
          // the same rule: a covered element says its placeholder, never its
          // words.
          text: masked ? (M?.placeholder?.() || '••••••') : trim(el?.textContent, 80),
          width: r ? Math.round(r.width) : null,
          height: r ? Math.round(r.height) : null,
          // Why the preview cell has no photograph, in one word the report
          // turns into a sentence.
          previewNote: sensitive ? 'sensitive' : window.top !== window ? 'frame' : onScreen ? 'nocapture' : 'offscreen',
        },
      });
      /*
       * An assert pick: what the page was supposed to be doing here.
       *
       * The locators in this file can be re-derived from a live page by any
       * agent that opens one — `playwright-cli`'s generate stage does exactly
       * that. What cannot be re-derived is the tester's intent, and an
       * automated check with no expected outcome is a click macro that passes
       * for ever. So a pick marked with Ctrl+Shift+click carries the state the
       * element was in when the tester said "this is what should happen".
       *
       * Read through the same gate as everything else here: a covered element
       * files its placeholder, never its words.
       */
      // An `element` pick IS an assert pick: "account for this" means the
      // script checks it, and a check needs the state it was in.
      if (intent === 'assert' || why === 'element') {
        const ev = records[records.length - 1].event;
        ev.intent = 'assert';
        ev.expected = {
          visible: onScreen,
          text: masked ? (M?.placeholder?.() || '') : trim(el?.textContent, 80),
        };
      }
      // Gap G5 stage 1, basket path: a NAME only, attached by Alt+Shift+click
      // in onClick() below — same field, same rule as fileMenuCopy()'s.
      if (credRef) records[records.length - 1].event.credRef = credRef;
    });

    sendWithPreviews(records);
  }

  /* ── the element's picture ─────────────────────────────────────────────── */

  /**
   * How big a preview may get before the outline is the better record.
   *
   * A session is a file somebody mails, and a hundred copied selectors at a
   * hundred kilobytes each is a report nobody can open. Forty kilobytes of
   * base64 is a generous ceiling for a 240x160 JPEG - the ones this makes come
   * out around six - so a crop that goes over it is a crop of something that
   * was never going to read as a thumbnail anyway.
   */
  const MAX_PREVIEW = 40 * 1024;
  const PREVIEW_W = 240;
  const PREVIEW_H = 160;

  /**
   * File the records, each with a picture of its element where there is one.
   *
   * Fire and forget, exactly as the version without pictures was: the copy has
   * already reached the clipboard and the note has already reached the
   * timeline, so nothing the tester is waiting on is behind this promise. A
   * capture that fails files the record anyway, with the outline.
   */
  function sendWithPreviews(records) {
    if (!records.length) return;
    previews(records.map((rec) => rec.rect)).then((shots) => {
      records.forEach((rec, i) => {
        const shot = shots[i];
        if (shot) {
          rec.event.preview = shot.url;
          rec.event.previewW = shot.w;
          rec.event.previewH = shot.h;
        }
        B?.send({ type: 'UQA_EVENT', event: rec.event });
      });
    });
  }

  /**
   * One photograph of the viewport, cut into one thumbnail per element.
   *
   * **One capture for the whole basket, not one per element.**
   * `captureVisibleTab` is rate-limited by the browser - a basket of five would
   * spend most of its captures on a quota error - and every element in a basket
   * was on the same screen at the same instant, so one photograph is not a
   * shortcut, it is the correct picture for all of them.
   *
   * The worker hides the extension's own overlays around the capture
   * (`withoutOverlays`), so the picker's highlight box, its tooltip and the
   * "copied" toast are out of the frame and back afterwards. The masking tool's
   * covers are **not** in that host - they are painted onto the page's own
   * elements - so a covered element photographs as covered, which is the rule
   * every other screenshot in this extension follows.
   *
   * Off-screen elements keep the outline and say so. Scrolling them into view
   * would photograph a page in a position the tester never put it in, and on a
   * lazy-loading page it would also change what the page contains; a copy is
   * not allowed to move the page under the person who made it.
   */
  async function previews(rects) {
    const none = rects.map(() => null);
    // Only the top frame. A crop is cut in viewport coordinates and a child
    // frame's rectangles are measured against its own origin, not the tab's.
    if (window.top !== window || !rects.some(Boolean)) return none;
    const res = await B?.send({ type: 'UQA_SHOT_URL' });
    const dataUrl = res?.ok && typeof res.result === 'string' ? res.result : null;
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return none;
    let bmp = null;
    try {
      bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      // `captureVisibleTab` answers in physical pixels and a rectangle is in
      // CSS pixels; on a 2x display the two differ by exactly this.
      const dpr = bmp.width / Math.max(1, innerWidth);
      return rects.map((r) => (r ? crop(bmp, r, dpr) : null));
    } catch {
      return none;
    } finally {
      bmp?.close?.();
    }
  }

  /**
   * One element's rectangle, clipped to the screen and scaled down.
   *
   * A detached `<canvas>` rather than an `OffscreenCanvas`, for one reason:
   * `toDataURL` is synchronous and gives the string the record wants, where the
   * offscreen kind hands back a Blob that then needs a FileReader to become
   * one. The canvas is never inserted, so the page under test never sees it.
   */
  function crop(bmp, r, dpr) {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const w = Math.min(r.right, innerWidth) - left;
    const h = Math.min(r.bottom, innerHeight) - top;
    if (!(w >= 1 && h >= 1)) return null;

    const scale = Math.min(1, PREVIEW_W / w, PREVIEW_H / h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    try {
      c.getContext('2d').drawImage(
        bmp, left * dpr, top * dpr, w * dpr, h * dpr, 0, 0, c.width, c.height
      );
      const url = c.toDataURL('image/jpeg', 0.72);
      return url.length <= MAX_PREVIEW ? { url, w: c.width, h: c.height } : null;
    } catch {
      return null;
    }
  }

  /**
   * The right-click menu's copy, filed with what that path knows.
   *
   * `content/ui-host.js` answers the menu with the same description the picker
   * builds - tag, id, classes, role, the visible words under the same masking
   * rule, and the rectangle - so this row gets the outline and the picture that
   * a picked row gets, out of the one code path below.
   *
   * Only from the top frame. `chrome.tabs.sendMessage` without a `frameId`
   * reaches every frame and the menu injects this file into all of them, so
   * filing from each would put one copy in the report as many times as the page
   * has documents.
   */
  function fileMenuCopy(res, credName) {
    if (!res?.locator || window.top !== window) return;
    const r = res.rect || null;
    const onScreen =
      !!r && r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const event = {
      kind: 'selectorcopy',
      ts: Date.now(),
      frameUrl: location.href,
      copied: res.locator,
      flavours: [{
        name: 'playwright',
        expr: res.locator,
        copied: true,
        matches: res.matches ?? null,
        unique: !!res.unique,
      }],
      strategy: res.strategy || null,
      matches: res.matches ?? null,
      ambiguous: !res.unique,
      warnCodes: res.warnCodes,
      maskedSource: !!res.maskedSource,
      category: categoryOf(null, res),
      tag: res.tag || null,
      elementId: res.elementId || null,
      classes: res.classes || null,
      role: res.role || null,
      text: res.text || '',
      width: r ? Math.round(r.width) : null,
      height: r ? Math.round(r.height) : null,
      previewNote: onScreen ? 'nocapture' : 'offscreen',
    };
    // Gap G5, stage 1 only: a NAME, never a value — see credNamePrompt() above.
    // `credRef` (not `credential`) so `workspace.js`'s SECRET_KEY regex never
    // strips it back out of a saved workspace file.
    if (credName) event.credRef = { name: credName };
    sendWithPreviews([{ rect: onScreen ? r : null, event }]);
  }

  /**
   * Gap G5, stage 1 only — "Mark credential name…" on the right-click menu.
   *
   * A NAME, never a value: no input here is `type="password"`, nothing typed
   * into this box is stored, and there is no vault to store it in — see
   * `research/120` §6. The name travels into the session, the report and every
   * export; the tester's real credential does not travel anywhere and is
   * expected to live in the environment the generated script runs in.
   *
   * `window.prompt` is avoided deliberately (see `keymap.js`'s note on it) in
   * favour of the same tiny shadow-root composer `promptNote()` there uses, so
   * nothing on the page under test can read what is being typed.
   */
  const CRED_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
  let credBox = null;
  /**
   * `onSave`, when given, receives the validated name instead of the
   * composer filing the copy itself via `fileMenuCopy`. The basket path
   * (`onClick`'s Alt+Shift+click branch below) uses this to attach the name
   * to a basket entry that is not filed until `copyBasket()` runs; the
   * right-click menu path (`UQA_MARK_CRED`) omits it and keeps its original
   * behaviour of filing immediately.
   */
  function credNamePrompt(res, onSave) {
    if (credBox?.isConnected) return credBox.querySelector('input')?.focus();
    const box = window.UQAUiHost.uiLayer('uqa-credname');
    credBox = box;
    asDialog(box, t('overlay.cred.dialog', 'Name the credential'), 'uqa-cred-hint');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('overlay.cred.placeholder', 'CREDENTIAL_NAME, e.g. LOGIN_PASSWORD');
    input.setAttribute('aria-label', input.placeholder);
    const hint = document.createElement('p');
    hint.id = 'uqa-cred-hint';
    hint.className = 'uqa-credname-hint';
    hint.textContent = t('overlay.cred.hint', 'Only this name travels. Never type the password itself here.');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = t('overlay.cred.save', 'Save');

    const submit = () => {
      const name = input.value.trim().toUpperCase();
      if (!CRED_NAME_RE.test(name)) {
        flash(t('overlay.cred.badName', 'Name must be UPPER_SNAKE_CASE, e.g. LOGIN_PASSWORD'), 'err');
        return;
      }
      if (onSave) onSave(name);
      else fileMenuCopy(res, name);
      flash(t('overlay.cred.recorded', 'Credential name recorded: {name}').replace('{name}', name));
      box.remove();
    };
    save.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) submit();
      if (e.key === 'Escape') box.remove();
    });

    box.append(input, hint, save);
    input.focus();
  }

  function copyBasket() {
    if (!basket.length) return;
    const text = basketText();
    const count = new Set(basket.map((b) => b.desc.playwright)).size;
    copyText(text, { silent: true }).then((how) => {
      if (how === 'failed') return showFallback(text);
      flash(t(count === 1 ? 'overlay.chip.copiedOne' : 'overlay.chip.copiedMany', count === 1 ? 'Copied {n} locator, one per line.' : 'Copied {n} locators, one per line.').replace('{n}', count));
    });
    const ts = Date.now();
    B?.send({
      type: 'UQA_EVENT',
      event: {
        kind: 'note',
        ts,
        frameUrl: location.href,
        text: `Picked ${count} locators:\n${text}`,
      },
    });
    fileCopies(basket, ts);
    basket = [];
    endEverywhere();
  }

  /**
   * A locator that does not carry covered data.
   *
   * The masking tool exists so a real person's name never leaves the machine,
   * and it covers it in the picture, drops it from the harvest and replaces it
   * in the recording. This was the fourth door, and it was open: the best
   * locator for a table cell is usually `getByText('Ahmad Al Zaghloul')`, and
   * copying that put the name on the clipboard and into the test file, where
   * it is *more* durable than the screenshot the mask was protecting. The
   * value ends up committed to a repository.
   *
   * So a masked element is offered the best of its own alternatives that
   * carries none of the covered text — a role, an id, a CSS path are all
   * usually available and all say the same thing about the element. When none
   * of them is clean, the honest answer is to refuse and say why, because a
   * locator quietly rebuilt from the DOM would defeat the same promise.
   */
  function withoutMaskedText(el, desc, own = '') {
    const M = window.UQAMask;
    if (!desc || (!M && !own)) return desc;
    const masked = M?.isMasked?.(el);
    // `own` is a sensitive pick's own text: withheld by the tester's word
    // rather than by a mask, and refused by exactly the same route.
    const leaks = (text) => (M?.leaks ? M.leaks(text) : false) || (!!own && String(text).includes(own));
    if (!masked && !leaks(desc.playwright)) return desc;

    for (const alt of desc.alternatives || []) {
      if (leaks(alt.expr)) continue;
      return {
        ...desc,
        locator: alt.expr.replace(/^page\./, ''),
        playwright: alt.expr,
        strategy: alt.strategy,
        matches: alt.matches,
        ambiguous: !alt.unique,
        maskedSource: true,
        warnings: [
          ...(desc.warnings || []),
          'The best locator for this element was built from covered data, so this one was used instead.',
        ],
      };
    }
    return { ...desc, blocked: true };
  }

  /**
   * The frame element is never the target.
   *
   * Both pickers are alive at once, and while the pointer is inside an iframe
   * the top frame's idea of "the element under the pointer" is the `<iframe>`
   * itself. That drew a second tooltip offering `page.locator('#frame-content')`
   * — the box, not the thing inside it that the tester is pointing at — and it
   * stayed on screen, because a frame that has the pointer sends its parent no
   * further mousemove to correct it. So the top frame stands down over a frame
   * and lets the picker inside it own the pointer. One tooltip.
   */
  const isFrame = (el) => el?.tagName === 'IFRAME' || el?.tagName === 'FRAME';

  /*
   * Which frame is showing a tooltip, mirrored into the light DOM.
   *
   * Same reason as the basket count above it: the shadow root is closed, so
   * "exactly one tooltip is on screen across two frames" is otherwise a thing
   * only a person looking at the screen can check, and that is the bug this
   * whole file was changed for.
   */
  const showTip = (on) => {
    document.documentElement.dataset.uqaPickTip = on ? 'on' : 'off';
  };

  function standDown() {
    if (box) {
      box.classList.remove('is-visible');
      box.removeAttribute('data-pressed');
    }
    if (tip) tip.classList.remove('is-visible');
    showTip(false);
    current = null;
    pressed = false;
  }

  function paint(el) {
    if (!el || !box) return;
    if (isFrame(el)) return standDown();
    const r = el.getBoundingClientRect();
    // Position moves on transform only — no layout property is written per
    // move, so there is nothing for a transition to lag behind (F01/F02).
    box.dataset.purpose = purpose;
    placeRing(box, el, r);
    box.classList.add('is-visible');

    let desc = null;
    try {
      desc = withoutMaskedText(el, S.describe(el, describeOpts()), purpose === 'sensitive' ? ownText(el) : '');
    } catch (err) {
      desc = null;
    }

    tip.dataset.purpose = purpose;
    tip.classList.toggle('is-masked', !!desc?.blocked);
    tip.classList.toggle('is-warn', !!desc?.ambiguous);
    if (desc?.blocked) {
      tip.textContent = t('overlay.chip.masked', 'That is covered by the masking tool, so no locator is copied for it.');
    } else if (!desc) {
      tip.textContent = t('overlay.chip.noLocator', 'No locator could be generated for this element.');
    } else {
      tip.innerHTML = chipText(el, desc);
    }
    // An element already in the basket wears the outer pair too; the chip clears that.
    placeChip(tip, r, basket.some((b) => b.el === el));
    tip.classList.add('is-visible');

    current = { el, desc };
    showTip(true);
  }

  /** A scroll moves the page under fixed rings: put them back over their elements. */
  const onScroll = () => {
    if (!active) return;
    if (current?.el?.isConnected) paint(current.el);
    if (basket.length) paintBasketRings();
  };

  const onMove = (e) => {
    if (!active) return;
    let el = e.composedPath?.()[0] || e.target;
    // Over one of our own layers — the highlight, the tip, the toast, the
    // chip — look through it to the page element underneath. Without this
    // the picker went blind wherever its own toast happened to be.
    if (window.UQAUiHost?.isOurs?.(el)) {
      if (el === chip || chip?.contains(el)) return;
      el = window.UQAUiHost.pageElementAt(e.clientX, e.clientY);
      if (!el) return;
    }
    // Coalesce through one rAf: store the latest element and paint at most
    // once per frame, so a fast pointer never queues unbounded work (F05).
    pendingEl = el;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const next = pendingEl;
      pendingEl = null;
      if (next && next !== current?.el) paint(next);
    });
  };

  /**
   * Was this press on the chip? The chip lives in the closed shadow root, so a
   * document listener's composedPath() stops at the host and never names it:
   * the target is the host (isOurs) and the pointer must be inside the chip's box.
   */
  const onChip = (e) => {
    if (!chip || !window.UQAUiHost?.isOurs?.(e.target)) return false;
    const r = chip.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  const onPointerDown = (e) => {
    if (!active || !box) return;
    if (onChip(e)) return;
    pressed = true;
    box.setAttribute('data-pressed', '1');
  };

  const onClick = (e) => {
    if (!active) return;
    // A click on the chip is the chip's own business.
    if (onChip(e)) return;
    pressed = false;
    if (box) box.removeAttribute('data-pressed');
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!current?.desc) return endEverywhere();
    // Refused rather than copied, and the picker stays open so the tester can
    // point at something else. Uncovering the element is the way to get a
    // locator for it, and that is a decision only they can make.
    if (current.desc.blocked) {
      flash(t('overlay.chip.masked', 'That is covered by the masking tool, so no locator is copied for it.'), 'err');
      return;
    }

    // Ctrl+Shift (or Cmd+Shift) is the assert pick, and it is checked before
    // the basket branch because it is a single pick, not a list: the tester is
    // saying "this is the outcome", which is one statement about one element.
    const assertPick = e.shiftKey && (e.ctrlKey || e.metaKey);

    if (e.shiftKey && !assertPick) {
      const already = basket.some((b) => b.el === current.el);
      let entry = null;
      if (!already) {
        entry = { el: current.el, desc: current.desc, purpose };
        basket.push(entry);
      }
      paintChip();
      if (tip && current?.el) placeChip(tip, current.el.getBoundingClientRect(), true);
      // Alt+Shift+click on a field: add as usual, then offer a credential
      // name for that entry through the same composer the right-click menu
      // uses — see research/122. Plain Shift+click (no Alt) is unchanged.
      if (entry && e.altKey && categoryOf(current.el, current.desc) === 'field') {
        credNamePrompt(null, (name) => { entry.credRef = { name }; });
        return;
      }
      if (e.altKey && !already) {
        flash(t('overlay.chip.addedNoField', 'Added: {n} in the list. Not an editable field, so no credential name is offered.').replace('{n}', basket.length));
        return;
      }
      flash(already
        ? t('overlay.chip.alreadyAdded', 'Already in the list.')
        : t('overlay.chip.added', 'Added: {n} in the list. Enter copies them all.').replace('{n}', basket.length));
      return;
    }

    const text = current.desc.playwright;
    copyText(text).then((how) => {
      if (how === 'failed') showFallback(text);
    });
    // `text` is the finished locator, chain and all, so the note in the
    // timeline carries the same string that went to the clipboard.
    const ts = Date.now();
    const noteText = `${assertPick ? 'Picked to check' : 'Picked locator'} (${current.desc.strategy}, ${current.desc.ambiguous ? `${current.desc.matches} matches` : 'unique'}): ${text}`;
    B?.send({ type: 'UQA_EVENT', event: { kind: 'note', ts, frameUrl: location.href, text: noteText } });
    // ui-1016 L: with no session the note is stored nowhere; the popup's pick line listens for this instead (the worker ignores the type).
    B?.send({ type: 'UQA_PICKED', text: noteText });
    fileCopies([{ el: current.el, desc: current.desc, intent: assertPick ? 'assert' : 'act', purpose }], ts);
    linger(current.el, purpose);
    if (assertPick) flash(t('overlay.chip.markedCheck', 'Marked as something to check. The report and the test plan carry it as an expected outcome.'));
    // One rule for all four purposes (Nader, 20 Sept): a plain click copies
    // one and stops; Shift+click is how several are taken. A purpose changes
    // what a pick is filed AS, never how the tool is driven.
    endEverywhere();
  };

  /**
   * Copy, and know whether it worked.
   *
   * navigator.clipboard.writeText throws NotAllowedError whenever the document
   * is not focused — which is exactly the case when the tester has DevTools
   * focused. The old code swallowed that and still said "copied ✓", so the
   * locator was silently never on the clipboard. Fall back to execCommand, and
   * if even that fails, say so and show the text to copy by hand.
   *
   * Inside a cross-origin iframe neither of those two can work at all. The
   * default Permissions-Policy is `clipboard-write=self`, so the promise is
   * refused before it reaches the clipboard, and execCommand in a frame that
   * has had no gesture of its own is refused about as often as it is allowed.
   * That is the whole of the tester's report — "it couldn't copy any selector".
   * So a frame that is not the top one asks the worker first, which has two
   * doors this frame does not: the top frame of the same tab, which is the
   * page's own origin and is allowed, and the offscreen document, which is a
   * page of this extension. Only a confirmed success says "copied ✓".
   *
   * `silent` is for the callers that have their own sentence to say — the
   * basket counts what it copied — and for a top frame copying on behalf of
   * another, which must not put a toast where nobody is looking.
   */
  async function copyText(text, { silent = false } = {}) {
    const done = (how) => {
      if (!silent) flash(t('overlay.chip.copiedTick', 'Locator copied'));
      if (window.top === window) window.UQABar?.setLocator?.(text);
      return how;
    };
    if (window.top !== window) {
      const res = await B?.send({ type: 'UQA_COPY_TEXT', text });
      const out = res?.ok ? res.result : null;
      if (out?.copied) return done(out.how);
    }
    try {
      await navigator.clipboard.writeText(text);
      return done('clipboard');
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return done('execCommand');
    } catch {
      /* fall through */
    }
    return 'failed';
  }

  /** r6-08-3: a name for the box, and the page's focus back where it was when the box goes. */
  function asDialog(box, label, describedBy) {
    if (typeof box?.setAttribute !== 'function') return; // a bare stub in a unit test has no DOM node to name
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', label);
    if (describedBy) box.setAttribute('aria-describedby', describedBy);
    const was = document.activeElement;
    const remove = box.remove.bind(box);
    box.remove = () => {
      remove();
      try { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); } catch { /* the page may have moved on */ }
    };
  }

  /** Last resort: put the locator on screen, pre-selected, so it can be copied. */
  function showFallback(text) {
    clearToasts();
    const box = window.UQAUiHost.uiLayer('uqa-copy-fallback');
    asDialog(box, t('overlay.copy.dialog', 'Copy the locator'), 'uqa-copy-hint');
    const label = document.createElement('span');
    label.id = 'uqa-copy-hint';
    label.textContent = t('overlay.copy.fallback', 'Could not reach the clipboard. Press Ctrl+C:');
    const field = document.createElement('textarea');
    field.readOnly = true;
    field.setAttribute('aria-label', t('overlay.copy.field', 'Locator text, selected for copying'));
    field.value = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = t('overlay.copy.close', 'Close');
    close.addEventListener('click', () => box.remove());
    box.append(label, field, close);
    field.focus();
    field.select();
  }

  const onKey = (e) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      basket = [];
      endEverywhere();
      return;
    }
    // 1 to 4 switch what the next pick is for. Bare keys only: Ctrl+1 is the
    // browser's, and a page shortcut on Alt is not ours to take.
    const n = !e.ctrlKey && !e.metaKey && !e.altKey ? Number(e.key) : 0;
    if (n >= 1 && n <= PURPOSES.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPurpose(PURPOSES[n - 1], true);
      return;
    }
    if (basket.length && (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c'))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      copyBasket();
    }
  };

  // Held by reference, not found by selector: a closed shadow root answers no
  // `querySelectorAll`, and there is only ever one toast anyway.
  /*
   * Toasts belong to `ui-host.js` now.
   *
   * They were defined here, and everything that wanted to say something to the
   * tester — the quick-note composer in `keymap.js`, the worker's own
   * `sayLoudly` — had to go through the picker to say it. That was tolerable
   * while the picker was in every page and became wrong the moment it stopped
   * being: a confirmation is not a picking concern, and the host that draws it
   * is declared in the manifest where this file is not.
   */
  const flash = (message, kind) => window.UQAUiHost.flash(message, kind);
  const clearToasts = () => window.UQAUiHost.clearToasts();

  function start() {
    if (active) return;
    // One crosshair at a time. See claimPointer() in content/ui-host.js.
    window.UQAUiHost?.claimPointer?.('locator', stop);
    active = true;
    basket = [];
    chain = null;
    // Not awaited: the crosshair is up on the same tick, and the first tooltip
    // that lands after the answer arrives carries the chain. A round trip is
    // not something to make the tester watch for.
    resolveChain();
    mount();
    box.dataset.purpose = purpose;
    showTip(false);
    // The bar carries the purpose switch; the top frame asks for it once.
    if (window.top === window) {
      if (window.UQABar) window.UQABar.picking(true);
      else B?.send({ type: 'UQA_BAR' });
    }
    flash(t('overlay.pick.start', 'Click an element to copy its locator. 1 to 4 choose what the pick is for; Shift+click collects several; Enter copies them all.'));
    document.addEventListener('pointermove', onMove, true);
    // `pointerover` as well as `pointermove`, and only for the frame case: once
    // the pointer is inside an iframe the browser routes its moves to that
    // frame and the parent hears no more of them, so the parent's last word on
    // the subject has to be the boundary crossing — which is a pointerover, and
    // which is where it stands down.
    document.addEventListener('pointerover', onMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.documentElement.classList.add('uqa-picking');
  }

  function stop() {
    if (!active) return;
    window.UQAUiHost?.releasePointer?.('locator');
    active = false;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerover', onMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onScroll, { capture: true, passive: true });
    if (window.top === window) window.UQABar?.picking?.(false);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingEl = null;
    document.documentElement.classList.remove('uqa-picking');
    delete document.documentElement.dataset.uqaBasket;
    delete document.documentElement.dataset.uqaPickTip;
    chain = null;
    unmount();
    basket = [];
  }

  /* ---------------------------------------------------------------- messages */

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
    // Sleep is a full stop: end the crosshair even if the worker's explicit
    // `off` never arrived, and refuse to start one until Wake.
    if (msg?.type === 'UQA_ARMED_CHANGED') {
      if (msg.armed === false) { window.UQAAwake = false; if (active) stop(); }
      return false;
    }
    if (msg?.type === 'UQA_ACTIVATE_PICKER') {
      if (window.UQAAwake === false && !msg.off) { sendResponse({ active: false, asleep: true }); return true; }
      // `off` is a stop, never a toggle — see the same flag in content/mask.js.
      // Putting a window to sleep has to end the crosshair, and toggling a page
      // that was not picking would have started one instead.
      if (msg.off) stop();
      // A purpose on a running picker is a switch, not a toggle: the popup's
      // four buttons and the bar's relay to other frames both arrive here.
      else if (isPurpose(msg.purpose)) { setPurpose(msg.purpose, false); if (!active) start(); }
      else active ? stop() : start();
      sendResponse({ active });
      return true;
    }

    if (msg?.type === 'UQA_COPY') {
      // `quiet` marks a copy this frame is doing for another one: the toast and
      // the fallback textarea belong where the tester is pointing, which is the
      // frame that asked, not this one.
      copyText(msg.text, { silent: !!msg.quiet }).then((how) => {
        if (how === 'failed' && !msg.quiet) showFallback(msg.text);
        // `file` is the right-click menu's own copy, and only a copy that
        // reached the clipboard is one the report should claim happened.
        if (how !== 'failed' && msg.file) fileMenuCopy(msg.file);
        sendResponse({ ok: how !== 'failed', how });
      });
      return true; // async
    }

    if (msg?.type === 'UQA_MARK_CRED') {
      // No clipboard write here — the name is filed straight from the
      // composer once the tester saves it, in `credNamePrompt()`.
      credNamePrompt(msg.file);
      sendResponse({ ok: true });
      return true;
    }

    /*
     * `UQA_FRAME_SELECTOR` used to be answered here, and it moved to
     * `content/bridge.js` on 8 September 2026.
     *
     * It is the question the worker asks a *parent* frame on behalf of the
     * frame inside it, and it was answered by a script that is injected on
     * demand — so it could only be answered while somebody was picking. The
     * recorder needs the same answer, at the moment a session starts, and the
     * picker is not there then: every click recorded inside a cross-origin
     * frame carried an empty frameLocator chain. The bridge is declared in
     * every frame at document_start, which is where a question about a frame's
     * own ancestry belongs.
     */

    if (msg?.type === 'UQA_HIGHLIGHT_SELECTOR') {
      // axe reports a CSS selector for each failing node. Scroll it into view
      // and ring it, so "colour-contrast, 3 elements" becomes three elements
      // the tester can actually look at.
      let el = null;
      try {
        el = document.querySelector(msg.selector);
      } catch {
        /* axe can emit a selector this browser will not parse */
      }
      if (!el) {
        sendResponse({ found: false });
        return true;
      }
      // Instant, not smooth: the ring is measured on the next line, and it is
      // drawn in the tool's own layer — fixed to the viewport, so it takes
      // viewport coordinates and cannot follow a scroll that is still moving.
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const ring = window.UQAUiHost.uiLayer('uqa-highlight');
      const box = el.getBoundingClientRect();
      ring.style.cssText =
        `top:${box.top}px;left:${box.left}px;` +
        `width:${box.width}px;height:${box.height}px`;
      setTimeout(() => ring.remove(), 2400);
      sendResponse({
        found: true,
        tag: el.tagName.toLowerCase(),
        // The same rule as the locator: a masked element's words do not travel
        // back to the popup, the timeline or the report just because a
        // different feature happened to point at it.
        text: window.UQAMask?.isMasked?.(el)
          ? window.UQAMask.placeholder()
          : (el.textContent || '').trim().slice(0, 80),
      });
      return true;
    }

    return false;
  });

  window.UQAPicker = {
    start, stop, flash, clearToasts,
    // The bar reads and drives the picker through these (top frame only).
    isActive: () => active,
    purpose: () => purpose,
    basketSize: () => basket.length,
    copy: (text) => copyText(text, { silent: true }),
  };
})();
