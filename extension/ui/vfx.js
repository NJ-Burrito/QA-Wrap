/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The motion of the extension — a small library of effects, and the rules
 * that keep it from costing anything.
 *
 * ── the rules first, because they are the design ──────────────────────────
 *
 * 1. **Transform and opacity only.** Nothing here animates width, height,
 *    margin, colour or a shadow. Those cause layout or paint on every frame;
 *    a transform is composited and costs the main thread nothing. This is
 *    what "not at the expense of speed" means in practice.
 * 2. **Short.** 120–480 ms. An effect is punctuation, not a sentence.
 * 3. **Few nodes.** The largest effect makes eight spans and removes them.
 * 4. **Reduced motion is honoured.** With `prefers-reduced-motion: reduce`,
 *    or the setting off, `play()` does nothing — except `flash`, which is a
 *    plain opacity fade and is what a screenshot *is*.
 * 5. **Never blocks.** Every effect is a CSS class plus `animationend`; there
 *    is no JavaScript per frame, and no effect awaits anything.
 * 6. **Meaning, not decoration.** Each effect marks one kind of event and is
 *    used for that alone, so a reader learns the vocabulary in a minute:
 *
 *      pulse    a control was pressed and taken               (scale)
 *      pop      something succeeded here                       (ring + scale)
 *      shake    refused, or wrong                              (x-translate)
 *      flash    a picture was taken                            (opacity)
 *      wobble   the burrito wakes                              (rotate)
 *      sparks   a ticket left the machine / a file was filed   (particles)
 *      glow     recording — a state, not an event              (class only)
 *      settle   a panel or dialog arrived                      (translate + fade)
 *      count    a number changed                               (scale tick)
 *
 * Classic script, like sound.js: `window.UQAVfx.play('pop', element)`.
 */
(() => {
  if (window.UQAVfx) return;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let enabled = true;

  const EFFECTS = {
    pulse: { cls: 'vfx-pulse', ms: 180 },
    pop: { cls: 'vfx-pop', ms: 320, ring: true },
    shake: { cls: 'vfx-shake', ms: 260 },
    flash: { cls: 'vfx-flash', ms: 180, overlay: true, always: true },
    wobble: { cls: 'vfx-wobble', ms: 420 },
    sparks: { cls: 'vfx-sparks', ms: 520, particles: 8 },
    settle: { cls: 'vfx-settle', ms: 220 },
    count: { cls: 'vfx-count', ms: 200 },
  };

  /** Run once, then clean up — never leave a class behind that would replay. */
  function animate(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    // Force a style flush so the same class can replay on a fast repeat.
    void el.offsetWidth;
    el.classList.add(cls);
    const done = () => el.classList.remove(cls);
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, ms + 80);
  }

  function ring(el) {
    const r = document.createElement('span');
    r.className = 'vfx-ring';
    r.setAttribute('aria-hidden', 'true');
    place(r, el);
    document.body.append(r);
    setTimeout(() => r.remove(), 420);
  }

  function place(node, el) {
    const b = el.getBoundingClientRect();
    node.style.left = `${b.left + b.width / 2}px`;
    node.style.top = `${b.top + b.height / 2}px`;
  }

  /** Eight round sparks in the three result colours, thrown out and faded. */
  function sparks(el, n) {
    const b = el.getBoundingClientRect();
    const colours = ['petra', 'corn', 'guac'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = `vfx-spark vfx-spark-${colours[i % 3]}`;
      s.setAttribute('aria-hidden', 'true');
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 26 + Math.random() * 22;
      s.style.left = `${b.left + b.width / 2}px`;
      s.style.top = `${b.top + b.height / 2}px`;
      s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * dist - 10}px`);
      s.style.setProperty('--rot', `${Math.round(Math.random() * 180)}deg`);
      document.body.append(s);
      setTimeout(() => s.remove(), 600);
    }
  }

  function flash() {
    const f = document.createElement('div');
    f.className = 'vfx-flash-layer';
    f.setAttribute('aria-hidden', 'true');
    document.body.append(f);
    setTimeout(() => f.remove(), 260);
  }

  /**
   * Play one effect on one element. Silent when motion is off; returns
   * whether anything was drawn so a caller can fall back to words.
   */
  function play(name, el) {
    const fx = EFFECTS[name];
    if (!fx) return false;
    if (fx.overlay) {
      if (!enabled && !fx.always) return false;
      flash();
      return true;
    }
    if (!enabled || reduced()) return false;
    if (!el || !el.isConnected) return false;
    if (fx.ring) ring(el);
    if (fx.particles) sparks(el, fx.particles);
    animate(el, fx.cls, fx.ms);
    return true;
  }

  /** Recording is a state: a class that breathes until it is removed. */
  function state(name, el, on) {
    if (!el) return;
    el.classList.toggle(`vfx-${name}`, !!on && enabled && !reduced());
  }

  function configure({ enabled: on } = {}) {
    if (typeof on === 'boolean') enabled = on;
  }

  /**
   * Wire the common cases so surfaces need no per-button code: a pressed
   * primary pulses; a tile pulses; a status line pops on good news and
   * shakes on bad. Everything else calls play() by name.
   */
  function wire(root = document) {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.btn-primary, .tool, .seg-btn, .mode-btn');
      if (btn && !btn.disabled) play('pulse', btn);
      // The wake switch: the burrito wobbles awake beside it.
      if (btn?.dataset.sound === 'switch.wake') play('wobble', root.querySelector('.brand-mark'));
    }, true);
  }

  /** For a status line: the tone decides the effect. */
  function status(el, tone) {
    if (!el) return;
    if (tone === 'ok') play('pop', el);
    else if (tone === 'err') play('shake', el);
  }

  const catalogue = () => Object.entries(EFFECTS).map(([name, fx]) => ({ name, ms: fx.ms, kind: fx.overlay ? 'overlay' : fx.particles ? 'particles' : 'class' }));

  window.UQAVfx = { play, state, status, configure, wire, catalogue };
})();
