/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Light, night, or whatever the machine says.
 *
 * The identity tokens already answer all three states — a bare `:root` for
 * light, a `prefers-color-scheme` block for an unstamped document, and a
 * `[data-theme]` block that beats both. All this does is stamp the root element
 * and remember the choice, so every surface agrees.
 *
 * Applied before first paint, from a classic script in `<head>`, because a page
 * that renders light and then flips to dark is a worse experience than one that
 * simply opens dark. `chrome.storage` is async and would flash, so the choice is
 * mirrored into `localStorage` — per-profile, synchronous, and exactly what is
 * needed for a value read once at boot.
 */
(() => {
  if (window.UQATheme) return;

  const KEY = 'qaw-theme';
  // Midnight retired (Nader, 27 Sept 2026, UI rework round 2): light + dark,
  // following the system, with a manual switch — one third mode fewer.
  const MODES = ['system', 'light', 'dark'];

  /** Stamp the root. `system` means no stamp at all, so the media query rules. */
  function apply(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    root.dataset.themeMode = mode;
  }

  /** A stored 'midnight' — before this rework — becomes 'dark', once. */
  function migrate(stored) {
    if (stored !== 'midnight') return stored;
    try { localStorage.setItem(KEY, 'dark'); } catch { /* still applies for this page */ }
    return 'dark';
  }

  function read() {
    try {
      const stored = migrate(localStorage.getItem(KEY));
      return MODES.includes(stored) ? stored : 'system';
    } catch {
      // A profile with site data blocked throws on access; system is the right
      // answer there and needs no storage at all.
      return 'system';
    }
  }

  /** Mirror the mode to the in-page bar's own storage, so a tester who never
   *  opens the ⋯ menu still gives the bar a value to read (S8). */
  function mirror(mode) {
    try { chrome.storage?.local?.set?.({ qawTheme: mode }); } catch { /* not an extension context */ }
  }

  function set(mode) {
    const next = MODES.includes(mode) ? mode : 'system';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* nothing to remember it with — it still applies for this page */
    }
    apply(next);
    mirror(next);
    // Other open surfaces follow without needing a reload.
    try {
      chrome.runtime?.sendMessage?.({ type: 'UQA_THEME_CHANGED', mode: next });
    } catch {
      /* no worker listening — the local page is already correct */
    }
    return next;
  }

  /** system → light → dark → system. Three states, one button. */
  function cycle() {
    return set(MODES[(MODES.indexOf(read()) + 1) % MODES.length]);
  }

  /** What the button should say it will do, and what it is showing now. */
  function describe(mode = read()) {
    return {
      system: { label: 'Follows your machine', next: 'Switch to light' },
      light: { label: 'Light', next: 'Switch to night' },
      dark: { label: 'Night', next: 'Follow your machine' },
    }[mode];
  }

  const initial = read();
  apply(initial);
  mirror(initial);

  // Another surface changed it while this one was open.
  try {
    chrome.runtime?.onMessage?.addListener?.((msg) => {
      if (msg?.type === 'UQA_THEME_CHANGED') apply(msg.mode);
    });
  } catch {
    /* not an extension page */
  }

  window.UQATheme = { read, set, cycle, apply, describe, MODES };
})();
