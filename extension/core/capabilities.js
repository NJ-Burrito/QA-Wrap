/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What this browser can actually do.
 *
 * ── the problem with "supports all browsers" ──────────────────────────────
 *
 * Chrome, Edge, Firefox and Safari all run MV3 extensions, and the manifest is
 * nearly the same in all four. What is *not* the same is the API surface, and
 * the differences land exactly on the expensive features:
 *
 *   `chrome.offscreen`    Chromium only. It is the only place an extension has
 *                         a DOM without a visible page — so it is where every
 *                         canvas, every MediaRecorder and the GIF encoder live.
 *   `chrome.tabCapture`   Chromium only.
 *   `chrome.desktopCapture` Chromium only.
 *   `chrome.debugger`     Chromium only, so no V8 coverage anywhere else.
 *
 * There are two ways to handle that and only one of them is honest.
 *
 * The dishonest one is to ship the same UI everywhere and let each button fail
 * with whatever the platform throws — `chrome.offscreen is undefined`, which
 * tells a tester nothing and reads as a broken extension.
 *
 * The honest one is to **know before the button is drawn**: detect what exists,
 * disable what cannot work, and say why in a sentence that names the browser
 * and the alternative. That is what this file is for.
 *
 * ── detected, not assumed ─────────────────────────────────────────────────
 *
 * Every entry is a live check of the API object, never a user-agent sniff. A UA
 * string is a claim about identity; `typeof chrome.offscreen` is a fact about
 * capability, and the two disagree constantly — Edge claims to be Chrome, every
 * fork claims to be something, and a Chromium build can be compiled without a
 * feature entirely.
 */

/** Which browser this is, for the *message* only. Never for a decision. */
export function browserName() {
  const ua = String(globalThis.navigator?.userAgent || '');
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  if (/\bOPR\//.test(ua)) return 'Opera';
  // Safari is the only one that says Safari without saying Chrome first.
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return 'Safari';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  return 'this browser';
}

const has = (path) => {
  let node = globalThis.chrome ?? globalThis.browser;
  for (const part of path.split('.')) {
    if (!node) return false;
    node = node[part];
  }
  return Boolean(node);
};

/**
 * Every capability the product gates on, what needs it, and what to do instead.
 *
 * `instead` is not a consolation prize — in every case here it is a real route
 * to the same outcome, which is the only reason it is worth writing down.
 */
export const CAPABILITIES = [
  {
    id: 'offscreen',
    label: 'Background canvas and recorder',
    test: () => has('offscreen.createDocument'),
    powers: ['record', 'gif', 'transcode', 'fullpage', 'watermark'],
    instead:
      'Screenshots still work and are saved as PNG or JPEG. Re-encoding to WebP or GIF, ' +
      'stitching a full page, and stamping an image all need a background canvas, which only ' +
      'Chromium-based browsers give an extension.',
  },
  {
    id: 'tabCapture',
    label: 'Recording this tab',
    test: () => has('tabCapture.getMediaStreamId'),
    powers: ['record'],
    instead: 'Use your operating system’s screen recorder, and take screenshots into the session as evidence.',
  },
  {
    id: 'desktopCapture',
    label: 'Recording the screen or another window',
    test: () => has('desktopCapture.chooseDesktopMedia'),
    powers: ['recordScreen'],
    instead: 'Use your operating system’s screen recorder.',
  },
  {
    id: 'debugger',
    label: 'Code coverage',
    test: () => has('debugger.attach'),
    powers: ['whitebox'],
    instead:
      'Statement coverage needs V8’s profiler, which only Chromium exposes to an extension. ' +
      'Everything else in Design (partitions, boundaries, decision tables) works here.',
  },
  {
    id: 'cookies',
    label: 'Reading and writing cookies',
    test: () => has('cookies.getAll'),
    powers: ['storage'],
    instead: 'localStorage and sessionStorage are still editable, because those live in the page.',
  },
  {
    id: 'downloads',
    label: 'Saving into a folder tree',
    test: () => has('downloads.download'),
    powers: ['filing'],
    instead: 'Files are offered through a normal download link instead, one at a time.',
  },
  {
    id: 'contextMenus',
    label: 'The right-click menu',
    test: () => has('contextMenus.create'),
    powers: ['contextMenu'],
    instead: 'Every entry has a button in the popup, and most have a keyboard shortcut.',
  },
  {
    id: 'commands',
    label: 'Keyboard shortcuts',
    test: () => has('commands.getAll'),
    powers: ['shortcuts'],
    instead: 'The in-page shortcuts still work. They are handled by the content script, not the browser.',
  },
];

/**
 * Read the whole surface once.
 *
 * Cheap enough to call on demand and cached by the caller if it wants; the
 * point is that nothing decides from a remembered value taken at install time,
 * because a permission can be revoked while the extension is running.
 */
export function detect() {
  const browser = browserName();
  const caps = {};
  const missing = [];

  for (const cap of CAPABILITIES) {
    let ok = false;
    try {
      ok = cap.test();
    } catch {
      ok = false;
    }
    caps[cap.id] = ok;
    if (!ok) missing.push({ ...cap, test: undefined });
  }

  /** Which product features are unavailable, mapped from the missing APIs. */
  const disabled = new Set(missing.flatMap((m) => m.powers));

  return {
    browser,
    caps,
    missing,
    disabled: [...disabled],
    /** Everything works — the common case, and worth being able to assert. */
    complete: missing.length === 0,
  };
}

/**
 * Can this feature run here, and if not, what should the tester be told?
 *
 * Returns `null` when it can, so the call site reads
 * `const why = whyNot('record'); if (why) …` and the happy path costs nothing.
 */
export function whyNot(feature, state = detect()) {
  const blocker = state.missing.find((m) => m.powers.includes(feature));
  if (!blocker) return null;
  return {
    feature,
    capability: blocker.id,
    label: blocker.label,
    // The browser is named because "not supported" without a subject reads as
    // a fault in the extension.
    message: `${blocker.label} is not something an extension can do in ${state.browser}. ${blocker.instead}`,
  };
}

