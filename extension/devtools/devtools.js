/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * DevTools entry point.
 *
 * A DevTools page has very limited access to chrome.* APIs, so this file does
 * nothing but register the panel. Everything real happens in panel.js, which
 * talks to the background service worker over runtime messaging.
 */
chrome.devtools.panels.create('QA Wrap', '../icons/icon48.png', 'panel.html', () => {
  /* panel created */
});
