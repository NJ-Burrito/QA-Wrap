/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The mark's motion — the one animation the product has that is about the
 * product rather than about a control.
 *
 * ── the rules, because they are the design ────────────────────────────────
 *
 * 1. **The mark moves on meaning, never on load.** Two states and no third:
 *
 *      wake       played once, when the extension is woken in this window.
 *                 The ring draws itself (520 ms) and then the check strokes
 *                 out through the seam (260 ms) with a 4% overshoot that
 *                 settles. 780 ms, and then it is a static mark again.
 *      recording  held while a session or a clip is running. Nothing moves;
 *                 the check breathes 1 → 0.55 → 1 over 1.8 s. It has to be
 *                 quiet enough to still be ignorable after a minute, because
 *                 that is how long a session lasts.
 *
 * 2. **Reduced motion means static, not slower.** With the setting on this
 *    file does not swap the image at all, so the animated file is never even
 *    fetched.
 *
 * ── how the states get in ─────────────────────────────────────────────────
 *
 * The header mark is an <img>, and an <img>'s SVG is an isolated document: no
 * class on this page can reach the paths inside it. The state travels in the
 * URL fragment instead — `mark-motion.svg#wake` — and `:target` inside the
 * file picks it up. (Measured in Chromium before it was built this way; it is
 * the one hook that survives the isolation.) A cache-busting counter is what
 * makes `wake` replayable: the same URL twice is not a fresh load, and a
 * fragment change alone does not restart an animation.
 *
 * The same classes are also set on the image's parent, for the surfaces that
 * inline the mark as <svg> rather than pointing at it — ui/motion.css picks
 * those up.
 *
 * ── why nothing else had to change ────────────────────────────────────────
 *
 * `bind()` listens to signals the popup already emits: `body[data-awake]`,
 * which the wake switch writes, and `#step-live`, the section that is
 * un-hidden while a session runs. No other file learns that this one exists.
 *
 * Classic script, like sound.js and vfx.js: `window.UQAMotion`.
 */
(() => {
  if (window.UQAMotion) return;

  const STATIC = 'mark.svg';
  const MOTION = 'mark-motion.svg';
  const WAKE_MS = 900; // 780 of animation, plus a frame's grace

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Every mark on the surface, unless the caller named one. */
  const marks = (el) => (el ? [el] : [...document.querySelectorAll('img.brand-mark')]);

  /**
   * The folder the mark lives in, taken from the element rather than assumed.
   * The popup, the report and the diagram sheet all reach `../brand/` from
   * different depths, and `el.src` is already absolute by the time we read it.
   */
  // The header carries `mark-small.svg`, and the first pattern here only knew
  // `mark.svg` and `mark-motion.svg`: nothing was stripped, the motion file was
  // appended to the whole URL, and the logo became a broken image the moment a
  // window woke. Dark themes hid it, because there a CSS `content:` rule paints
  // over whatever `src` says; light themes (the Arabic screenshots) showed it.
  const MARK_FILE = /mark(-small|-motion)?(-dark)?\.svg.*$/;
  const base = (el) => el.src.replace(MARK_FILE, '');
  /** The still mark this element started with, so a release puts back ITS file, not the big one. */
  const home = (el) => (el.dataset.qawMarkHome ||= (el.getAttribute('src') || '').match(/mark(-small)?\.svg/)?.[0] || STATIC);

  let swaps = 0;
  function swap(el, file) {
    const still = home(el); // read before the first swap changes src
    const next = base(el) + (file === STATIC ? still : file);
    if (el.src === next) return;
    el.src = next;
    el.classList.remove('qaw-mark-swap');
    void el.offsetWidth; // flush, so a second swap replays the fade
    el.classList.add('qaw-mark-swap');
  }

  /** The class goes on the parent, so an inlined <svg> sibling gets it too. */
  const flag = (el, name, on) => el.parentElement?.classList.toggle(name, on);

  /**
   * What each mark is currently holding — `'wake'`, `'recording'` or nothing.
   *
   * This exists because of a bug worth naming. The first version had `recording
   * (el, false)` put the static mark back unconditionally, which reads as the
   * obvious thing to do. But the popup re-syncs `#step-live` on every refresh,
   * and a refresh lands within a few milliseconds of waking: the wake started,
   * and six milliseconds later a "not recording" sync reset the image to
   * mark.svg and the animation was over before a frame of it was drawn. So a
   * release only releases what it was holding; a wake in flight is not its to
   * cancel.
   */
  const held = new WeakMap();

  /**
   * Play the wake once. Returns whether anything was drawn, so a caller can
   * tell the difference between "played" and "motion is off here".
   */
  function wake(el) {
    if (reduced()) return false;
    let played = false;
    for (const m of marks(el)) {
      if (held.get(m) === 'recording') continue; // a running session outranks a greeting
      held.set(m, 'wake');
      flag(m, 'qaw-wake', true);
      swap(m, `${MOTION}?w=${++swaps}#wake`);
      played = true;
      setTimeout(() => {
        if (held.get(m) !== 'wake') return; // recording took over while it played
        held.delete(m);
        flag(m, 'qaw-wake', false);
        swap(m, STATIC);
      }, WAKE_MS);
    }
    return played;
  }

  /** Hold, or release, the recording breathe. A state, not an event. */
  function recordingState(el, on) {
    const want = !!on;
    let holding = false;
    for (const m of marks(el)) {
      flag(m, 'qaw-recording', want);
      if (want) {
        held.set(m, 'recording');
        flag(m, 'qaw-wake', false);
        if (!reduced()) swap(m, `${MOTION}#recording`);
        holding = true;
      } else {
        if (held.get(m) !== 'recording') continue;
        held.delete(m);
        if (!reduced()) swap(m, STATIC);
      }
    }
    return holding;
  }

  /**
   * Listen for the signals the surfaces already give off.
   *
   * `data-awake` is an attribute on <body>; `#step-live` is hidden until a
   * session is running. Both are observed rather than polled, and both are
   * read once at bind time so a page that opens mid-session is already right.
   */
  function bind(root = document) {
    const body = root.body || document.body;
    if (!body) return () => {};
    const observers = [];

    let awake = body.dataset.awake === 'true';
    const bodyWatch = new MutationObserver(() => {
      const now = body.dataset.awake === 'true';
      if (now && !awake) wake();
      awake = now;
    });
    bodyWatch.observe(body, { attributes: true, attributeFilter: ['data-awake'] });
    observers.push(bodyWatch);

    const live = root.querySelector('#step-live');
    if (live) {
      const sync = () => recordingState(null, !live.hidden);
      const liveWatch = new MutationObserver(sync);
      liveWatch.observe(live, { attributes: true, attributeFilter: ['hidden'] });
      observers.push(liveWatch);
      sync();
    }

    return () => observers.forEach((o) => o.disconnect());
  }

  /**
   * Replay a CSS animation on an element that is already on screen.
   *
   * This is the one thing CSS cannot do on its own, and it is the reason this
   * file grew a second half. A CSS animation starts when an element STARTS
   * matching the selector: `#status:not(:empty)` plays once, and then the next
   * fifteen messages land in an element that has been matching all along and
   * nothing moves. The popup's status line and Settings' "Saved" are both one
   * element written over and over, so both need the animation restarted by
   * hand.
   *
   * Remove, reflow, add — the standard restart, and the same three lines
   * `swap()` above uses on the mark for the same reason. `offsetWidth` is read
   * and thrown away purely to force the style flush between the two class
   * changes; without it the browser coalesces them and nothing happens.
   *
   * Declines under reduced motion, so the class is never even added there.
   */
  function replay(el, name = 'qaw-notice') {
    if (!el || reduced()) return false;
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
    return true;
  }

  /**
   * A line of text that has just changed, saying so.
   *
   * Kept separate from `replay()` by name rather than by mechanism, because
   * the callers are surfaces and what they mean is "this is a new message",
   * not "restart an animation". If the notice ever stops being a slide-down,
   * every caller keeps working.
   */
  const notice = (el) => replay(el, 'qaw-notice');

  window.UQAMotion = { wake, recording: recordingState, bind, reduced, replay, notice };

  // Auto-bind, so a surface needs the script tag and nothing else. The scripts
  // are deferred in the popup and plain in the other pages, so both orders of
  // arrival have to work.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bind(), { once: true });
  else bind();
})();
