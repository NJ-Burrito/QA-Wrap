/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/*
 * Onboarding for the popup and the side panel (features-1010 lane O). A classic deferred script that runs after popup.js
 * and shares its top-level names (awake, siteAccess, requestSite, send, ctx ...), so popup.js stays under its line ceiling.
 *
 *   - "Test this site": ONE press from Asleep asks for the site, wakes the window, then starts the session.
 *   - "Wake up on this site by itself next time": opt-in, off by default, per site (list in Settings > Permissions).
 *   - The name of the test is asked after the stop, once, and may be skipped.
 *   - The practice page packaged inside the extension.
 */

/** The packaged practice page is the one extension page that can be tested. */
const isPracticeTab = (url) => String(url || '').startsWith(chrome.runtime.getURL('practice/'));

/** The press itself. Call it synchronously from the click: Chrome refuses permissions.request after an await. */
function startOneTap() {
  const waking = !awake;
  const asking = waking && !siteAccess.granted ? requestSite() : null; // first statement that touches Chrome: still inside the gesture
  return (async () => {
    if (!waking) return null;
    if (asking) {
      if (!(await asking.catch(() => false))) return { ok: false, error: notAllowed() };
      await siteGranted();
    }
    const tab = await resolveCtx();
    if (!isTestable(tab)) return null; // the start handler says "open a normal page"
    const woke = await send({ type: 'UQA_ARM', ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
    if (!woke.ok) return woke;
    await paintSwitch(woke.result);
    return null;
  })();
}

/**
 * 1011 B1: a tool tile pressed while asleep is never dead. The same press asks for the site (synchronously, inside the gesture, as
 * "Test this site" does), wakes the window, then presses the tile again so the tool opens or runs. A refusal at the permission bubble
 * leaves one plain line that says why, with "Test this site" beside it.
 */
function wakeOnPress(btn) {
  if (btn.dataset.waking) return true;
  btn.dataset.waking = 'true';
  const oneTap = startOneTap(); // first statement that touches Chrome: still inside the gesture
  (async () => {
    let refused = null;
    try { refused = await oneTap; } finally { delete btn.dataset.waking; }
    if (!refused && awake) return btn.click(); // awake now: the normal press runs the tool
    const asked = !!refused && refused.error === notAllowed();
    const why = !refused ? needsPage() : asked ? tf('popup.tile.refused', 'This tool needs QA Wrap awake on this site, and permission was not given.') : refused.error;
    const fix = refused ? { key: 'popup.onboard.testSite', label: 'Test this site', run: () => { $('start').click(); } } : undefined;
    say(why, 'err', { fix });
  })();
  return true;
}

/** Asleep the button says what one press does; awake it is the plain Start. */
function paintStartLabel() {
  const label = $('start-label');
  if (label) label.textContent = t(awake ? 'popup.session.start' : 'popup.onboard.testSite');
}

/**
 * Autopilot (1011, AUTO-3): two more ticks under "Wake up on this site by itself", each with its consent sentence in view.
 * Off by default, per site, shown only while the wake tick is on; the lists are `autoStartSites` and `autoShotSites`
 * (origin patterns, like `rememberedSites`). The rows are built here because popup.html is not this file's.
 */
const AUTO_TICKS = [
  { key: 'autoStartSites', id: 'auto-start-site', label: 'popup.auto.startLabel', consent: 'popup.auto.startConsent' },
  { key: 'autoShotSites', id: 'auto-shot-site', label: 'popup.auto.shotLabel', consent: 'popup.auto.shotConsent' },
];
const AUTO_KEYS = AUTO_TICKS.map((x) => x.key);
/** @returns {string[]} the list stored under `key` (absent or damaged = empty) */
const listIn = (stored, key) => (Array.isArray(stored?.[key]) ? stored[key] : []);

function autoRows() {
  let box = $('auto-rows');
  if (box) return box;
  const anchor = $('remember-row');
  if (!anchor) return null;
  box = document.createElement('div');
  box.id = 'auto-rows';
  box.hidden = true;
  for (const tick of AUTO_TICKS) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'remember';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = tick.id;
    const text = document.createElement('span');
    text.dataset.i18n = tick.label;
    const fine = document.createElement('p');
    fine.className = 'fine';
    fine.dataset.i18n = tick.consent;
    label.append(input, text);
    wrap.append(label, fine);
    box.append(wrap);
    input.addEventListener('change', async (e) => {
      const p = siteAccess.pattern;
      if (!p) return;
      const stored = await chrome.storage.local.get(tick.key);
      const next = new Set(listIn(stored, tick.key));
      if (e.target.checked) next.add(p); else next.delete(p);
      await chrome.storage.local.set({ [tick.key]: [...next] });
      say(t(e.target.checked ? 'popup.auto.on' : 'popup.auto.off'), 'ok');
    });
  }
  anchor.after(box);
  return box;
}

async function paintRemember() {
  const row = $('remember-row');
  if (!row) return;
  const p = siteAccess.pattern;
  row.hidden = !p || p === 'practice' || siteAccess.policy === 'none';
  const auto = autoRows();
  if (auto) auto.hidden = true;
  if (row.hidden) return;
  const stored = await chrome.storage.local.get(['rememberedSites', ...AUTO_KEYS]);
  const woke = listIn(stored, 'rememberedSites').includes(p);
  $('remember-site').checked = woke;
  if (!auto) return;
  auto.hidden = !woke;
  for (const tick of AUTO_TICKS) {
    $(tick.id).checked = listIn(stored, tick.key).includes(p);
    for (const el of auto.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  }
}

$('remember-site')?.addEventListener('change', async (e) => {
  const p = siteAccess.pattern;
  if (!p) return;
  const { rememberedSites: list = [] } = /** @type {{ rememberedSites?: string[] }} */ (await chrome.storage.local.get('rememberedSites'));
  const next = new Set(list);
  if (e.target.checked) next.add(p); else next.delete(p);
  await chrome.storage.local.set({ rememberedSites: [...next] });
  if (!e.target.checked) { // the two powers below the wake tick go off with it, so nothing stays on out of sight
    const stored = await chrome.storage.local.get(AUTO_KEYS);
    await chrome.storage.local.set(Object.fromEntries(AUTO_KEYS.map((k) => [k, listIn(stored, k).filter((o) => o !== p)])));
  }
  say(t(e.target.checked ? 'popup.onboard.rememberOn' : 'popup.onboard.rememberOff'), 'ok');
  paintRemember();
});

/** The name box shows only for a test that was started unnamed. */
function paintDoneName(finished) {
  const row = $('done-name-row');
  if (row) row.hidden = finished.charter !== t('popup.session.untitled');
}

async function saveDoneName() {
  const charter = $('done-name').value.trim();
  const id = state.lastSession?.id;
  if (!charter || !id) return;
  const res = await send({ type: 'UQA_RENAME', sessionId: id, charter });
  if (res.ok) { $('done-name').value = ''; refresh(); } else say(res.error, 'err');
}
$('done-name-save')?.addEventListener('click', saveDoneName);
$('done-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) saveDoneName(); });

/** The practice page, in a tab of the window under test, so waking that window reaches it. One tab only: an open one is brought forward. */
async function openPractice() {
  await resolveCtx();
  const url = chrome.runtime.getURL('practice/practice.html');
  const [open] = await chrome.tabs.query({ url });
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    if (open.windowId != null) await chrome.windows.update(open.windowId, { focused: true });
    return;
  }
  chrome.tabs.create({ url, ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
}
