/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A control whose browser feature is missing is not drawn (sdlc-1014b; completed 1015 after Opera GX still showed the Dock button).
 *
 * `chrome.sidePanel` is Chrome's and Edge's. Opera and Opera GX ship the same Chromium code, so with the `sidePanel` permission in the manifest
 * (dist/chrome, which is the build the owner loads into Opera GX) the object and `open` exist there too, and the call then fails: "does the
 * API exist" is not "does a side panel exist". So the test is both: the API is present AND the browser is not Opera (user agent `OPR/`, or an
 * "Opera" brand in userAgentData). A browser this list does not know is caught by `dockFailed`: an `open()` that fails hides the button and
 * says the plain sentence, never the "Something went wrong" status with the cause behind a tooltip. The same test (`hasSidePanel`) gates the
 * press in popup.js; Settings and the worker read the module copy, `hasSidePanel` in platform/settings.js (a classic script cannot import it; test-sessions checks the pair agrees).
 */
const isOpera = /\bOPR\//.test(navigator.userAgent) || !!(/** @type {any} */ (navigator)).userAgentData?.brands?.some((b) => /opera/i.test(b.brand));
const hasSidePanel = () => typeof chrome !== 'undefined' && typeof chrome.sidePanel?.open === 'function' && !isOpera;
if (!hasSidePanel()) document.getElementById('dock')?.setAttribute('hidden', '');

/** An `open()` that was refused: where the browser has no side panel the button goes away for good and the sentence says why; anything else is a real failure. */
function dockFailed(err) {
  if (isOpera || /not (supported|available)|unsupported|no side panel|reading 'open'/i.test(String(err?.message))) {
    document.getElementById('dock')?.setAttribute('hidden', '');
    say(t('common.worker.err.noSidePanel'), 'err');
  } else sayFailure(err);
}
