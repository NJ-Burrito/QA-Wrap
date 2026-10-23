/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Boot for whatsnew.html: wait for the language, then hand over to update-view.js (all the states live there). */
(async function () {
  await globalThis.QAWi18n?.ready?.();
  const { start } = await import('./update-view.js');
  await start({ tr: (k, v) => QAWi18n.t(k, v) });
})();
