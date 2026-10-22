/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The practice page's behaviour, faults included. Nothing here leaves the browser: the "server" is a path inside the extension that does not exist. */
const $ = (id) => document.getElementById(id);
const i18n = globalThis.QAWi18n;
const t = (key) => (i18n?.t ? i18n.t(key) : key);
/* The dictionary arrives a moment after the page: wait for it before painting any text, or t() hands back the raw key. */
const ready = Promise.resolve(i18n?.ready?.()).catch(() => {});
/* The status line keeps its key, so a language switch repaints it instead of leaving the old language behind. */
let savedKey = '';
i18n?.onChange?.(() => { if (savedKey) $('p-save-state').textContent = t(savedKey); });

/* Fault 1: the request fails (there is no such file), the page says "Saved" anyway, and the error goes to the console. */
$('p-save').addEventListener('click', async () => {
  try {
    await fetch('api/save-profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('p-name').value }) });
  } catch (err) {
    console.error('Save profile failed:', err);
  }
  await ready;
  const state = $('p-save-state');
  savedKey = 'welcome.practice.saved';
  state.textContent = t(savedKey);
  state.className = 'state ok';
});

/* Fault 2: an uncaught error (the coupon table was never loaded). */
$('p-apply').addEventListener('click', () => {
  const table = globalThis.__coupons;
  $('p-apply-state').textContent = table[$('p-coupon').value.trim().toUpperCase()].label;
});

/* Fault 3: "Next step" has no handler on purpose. */
