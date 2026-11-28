/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

import { DEFAULTS, RANGES } from '../platform/settings.js';
import { wireVault } from './vault-ui.js';
import { wireProfile, wireOpenSection } from './profile-ui.js';
import { normaliseArabic } from '../core/fingerprint.js';
import { erasedText } from '../core/store-registry.js';
import { wireIntegrations } from './integrations.js';
import { wireEgress } from './egress-panel.js';
import { booted, integ, profileUi, setBooted, setInteg, setProfileUi, setSettings, settings } from './options-state.js';
import { paintAbout, paintAll, paintFilms, paintFolder, paintFootprint, paintSound, paintTheme, wireDownloadFolder, wireFolder, wireLanguage, wireMaskPattern, wireWelcome } from './options-paint.js';
import { $, TIMING, adopt, flashSaved, group, save, send, t, werr, wireRetentionNotice } from './options-base.js';
import { recording, renderCommands, wireJira, wireMediaGrant, wireOutput, wireRange, wireSwitch } from './options-panels.js';

$('theme')?.addEventListener('click', () => {
  window.UQATheme.cycle();
  paintTheme();
});

$('reset').addEventListener('click', async () => {
  if (!confirm(erasedText(t, 'reset'))) return;
  const res = await send({ type: 'UQA_RESET_SETTINGS' });
  if (res.ok) {
    setSettings(res.result);
    paintAll();
    flashSaved(t('options.save.reset'));
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * Nothing is declared externally connectable, so a web page cannot reach this
   * at all and another extension's message would carry that extension's id.
   * `sender.id` is stamped by the browser rather than claimed by the sender,
   * which is what makes it the thing to check; `sender.url` is not, and is
   * never checked here (research/51d §7).
   */
  if (sender?.id !== chrome.runtime.id) return;
  // Another surface changed something — stay in step.
  if (msg?.type === 'UQA_SETTINGS_CHANGED' && !recording) {
    setSettings(adopt(msg.settings));
    paintAll();
  }
});

(async function boot() {
  Object.keys(RANGES).forEach(wireRange);
  wireLanguage();
  wireRetentionNotice();
  wireMediaGrant();
  wireWelcome();
  ['keymapEnabled', 'rtlMirror', 'rtlAccent', 'rtlBidi', 'vfxEnabled', 'redact', 'preRollBuffer', 'saveAs', 'autoSubmitDefect'].forEach(wireSwitch);
  wireDownloadFolder();

  // The two ambiguous redaction families.
  for (const chip of document.querySelectorAll('#redactExtra button')) {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      const chosen = [...document.querySelectorAll('#redactExtra button')]
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => c.dataset.family);
      save({ redactExtra: chosen }, { immediate: true });
    });
  }

  // Retention, run on demand, so a person can see it work rather than trust it.
  $('purge-now')?.addEventListener('click', async () => {
    const note = $('purge-state');
    if (note) note.textContent = t('options.privacy.purgeLooking');
    const res = await send({ type: 'UQA_PURGE_NOW' });
    if (!note) return;
    if (!res?.ok) { note.textContent = werr(res) || t('options.privacy.purgeFailed'); return; }
    const { purged, keptForever, days } = res.result || {};
    note.textContent = keptForever
      ? t('options.privacy.purgeNever')
      : purged
        ? t(purged === 1 ? 'options.privacy.purgedOne' : 'options.privacy.purgedMany', { n: purged, days })
        : t('options.privacy.purgedNone', { days });
    paintPinned();
  });
  /* r2-03-4: beside "Run it now", how many sessions are pinned by hand and so never deleted whatever their age. */
  const paintPinned = async () => {
    const host = $('purge-state');
    if (!host) return;
    let el = $('purge-pinned');
    if (!el) {
      el = document.createElement('span');
      el.id = 'purge-pinned';
      el.className = 'range-note';
      host.after(el);
    }
    const res = await send({ type: 'UQA_LIST_SESSIONS' });
    const n = res?.ok && Array.isArray(res.result) ? res.result.filter((s) => s && s.keep).length : 0;
    el.textContent = res?.ok ? t('options.privacy.pinned', { n: group(n) }) : '';
  };
  paintPinned();
  QAWi18n.onChange(paintPinned);
  paintTheme();
  wireMaskPattern();
  wireJira();
  wireFolder();
  setInteg(wireIntegrations({ $, t, send, save, getSettings: () => settings, repaintAll: paintAll }));
  window.dispatchEvent(new Event('hashchange')); // now that the services exist, open #sec-integrations/<service>

  $('soundEnabled')?.addEventListener('change', (e) => {
    save({ soundEnabled: e.target.checked }, { immediate: true });
    paintSound();
    // Played straight away, because the answer to "what does that sound like"
    // should not require finding a second button.
    if (e.target.checked) window.UQASound?.play('switch.wake');
  });
  for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="soundScope"]'))) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      save({ soundScope: r.value }, { immediate: true });
      /** @type {any} */ (window).UQASound?.configure({ scope: r.value });
    });
  }
  $('soundVolume')?.addEventListener('input', (e) => {
    settings.soundVolume = Number(e.target.value);
    window.UQASound?.configure({ level: settings.soundVolume / 100, scope: settings.soundScope });
  });
  // Only on release: a preview on every pixel of the slider is a siren.
  $('soundVolume')?.addEventListener('change', () => window.UQASound?.play('tap', { force: true }));

  const res = await send({ type: 'UQA_GET_SETTINGS' });
  if (res.ok) setSettings(res.result);
  wireVault({
    send, t, werr, // r10-02-2: VAULT_BACKOFF and VAULT_REKEY are worded by code in platform/worker-errors.js
    unreadable: () => !!/** @type {any} */ (settings).vaultUnreadable, // T-011: say so, do not let a save fail in English
    changed: async () => {
      const r = await send({ type: 'UQA_GET_SETTINGS' });
      if (r.ok) { setSettings(r.result); paintAll(); }
    },
  });
  wireEgress(document, t); // T-070
  setProfileUi(wireProfile({ $, t, save, getSettings: () => settings }));
  wireOpenSection();
  paintAll();
  renderCommands();
  await wireOutput();
  paintAll();       // repaint: the format list only existed after wireOutput
  paintFolder();
  setBooted(true);
  document.body.dataset.optionsReady = '1'; // the page has wired every control (tests wait for it)
})();

/* ── T-063: support details, previewed, copied by the tester, never sent ── */
$('bundle-open')?.addEventListener('click', async () => {
  const [{ buildBundle }, { detect }, { RING_KEY }, { describe }] = await Promise.all([
    import('../core/support-bundle.js'), import('../core/capabilities.js'), import('../core/on.js'), import('../core/product.js'),
  ]);
  const local = /** @type {any} */ (await chrome.storage.local.get([RING_KEY, 'firstReportOpenedAt', 'bootMs', 'toolUseTicks']));
  const perms = await chrome.permissions.getAll().catch(() => ({ origins: [] }));
  const d = describe();
  $('bundle-text').value = buildBundle({
    name: d.name, build: `${d.code} (v${d.version})`, version: chrome.runtime.getManifest().version, ua: navigator.userAgent,
    capabilities: detect().caps, originCount: (perms.origins || []).length, settings, defaults: DEFAULTS,
    ring: local[RING_KEY], firstReportOpenedAt: local.firstReportOpenedAt, bootMs: local.bootMs, toolUseTicks: local.toolUseTicks,
  });
  $('bundle-dialog').showModal();
});
$('bundle-copy')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('bundle-text').value); flashSaved(t('options.about.bundleCopied')); } catch { $('bundle-text').select(); }
});
$('bundle-close')?.addEventListener('click', () => $('bundle-dialog').close());

(async () => {
  try {
    const { describe } = await import('../core/product.js');
    paintAbout.described = describe();
    paintAbout();
  } catch { /* the card is decorative if the module cannot load */ }
})();

/* ── a passive rating link, never after a session, hidden under any managed policy (T-050) ── */
(async () => {
  const link = document.getElementById('about-rate');
  if (!link) return;
  try {
    const { rateUrl } = await import('../core/rate-links.js');
    link.href = rateUrl();
    const managed = await chrome.storage.managed?.get?.(null);
    if (managed && Object.keys(managed).length) throw new Error('managed');
  } catch {
    document.getElementById('about-rate-dt')?.setAttribute('hidden', '');
    document.getElementById('about-rate-dd')?.setAttribute('hidden', '');
  }
})();

(async () => {
  if (!document.getElementById('about-tutorials')) return;
  try {
    const lessons = await (await fetch(chrome.runtime.getURL('tutorials/lessons.json'))).json();
    if (Array.isArray(lessons) && lessons.length) paintFilms.count = lessons.length;
    paintFilms();
  } catch { /* "Short films" is in the markup and is already true */ }
})();

/**
 * Seven tabs over the page's cards (round 3, Nader approved the prototype).
 *
 * Every card keeps its id, so a bookmark or in-page link such as `#sec-permissions`
 * (or `#sec-integrations/slack`) still lands where it did: `ownerOf` maps any id on
 * the page to its card and `GROUPS` maps the card to its tab. Controls are still
 * looked up by `getElementById`, so hiding the other cards changes nothing that is
 * saved. The search box filters the rail (a count per tab) and the rows.
 */
(() => {
  const GROUPS = {
    appearance: ['sec-appearance'],
    profile: ['sec-profile'],
    recording: ['sec-sessions', 'sec-timeline'],
    tools: ['sec-shortcuts', 'sec-stress', 'sec-break'],
    files: ['sec-files'],
    integrations: ['sec-integrations'],
    privacy: ['sec-permissions', 'sec-privacy', 'sec-safe'],
    updates: ['sec-updates'],
    about: ['about-card'],
  };
  const tabs = [...document.querySelectorAll('#rail [role="tab"]')];
  const cards = [...document.querySelectorAll('main > .card')];
  if (!tabs.length || !cards.length) return;
  const groupOfCard = new Map(Object.entries(GROUPS).flatMap(([g, ids]) => ids.map((id) => [id, g])));
  const ownerOf = new Map();
  for (const card of cards) {
    ownerOf.set(card.id, card.id);
    for (const el of card.querySelectorAll('[id]')) ownerOf.set(el.id, card.id);
  }
  ownerOf.set('sec-language', 'sec-appearance');
  ownerOf.set('sec-sound', 'sec-appearance');
  let current = 'appearance';

  function activate(group, { focusTab = false, scrollTarget = null } = {}) {
    if (!GROUPS[group]) group = 'appearance';
    current = group;
    for (const card of cards) card.hidden = groupOfCard.get(card.id) !== group;
    for (const tab of tabs) {
      const on = tab.dataset.rail === group;
      tab.classList.toggle('is-here', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    }
    (scrollTarget ? document.getElementById(scrollTarget) : null)?.scrollIntoView({ block: 'start' });
  }

  function route({ focusTab = false } = {}) {
    const [raw, service] = decodeURIComponent(location.hash.slice(1)).split('/');
    const cardId = ownerOf.get(raw);
    if (!raw || !cardId) { activate(current); return; }
    activate(groupOfCard.get(cardId), { focusTab, scrollTarget: raw === cardId ? null : raw });
    if (cardId === 'sec-integrations' && service) integ.openService?.(service);
  }
  window.addEventListener('hashchange', () => route());
  route();

  /* search */
  const ROW = '.switch,.check,.text-field,.field,.range-field,.svc,.callout,.setting-row,.key-row,.kv';
  const q = document.getElementById('q');
  let moved = false;
  const nores = Object.assign(document.createElement('p'), { id: 'nores', className: 'muted', hidden: true });
  document.querySelector('main').prepend(nores);
  const rowsOf = (card) => [...card.querySelectorAll(ROW)].filter((r) => !r.parentElement.closest(ROW));
  function filter() {
    // r3-10-3: term and row text fold the same way, so a search typed with another alef, taa marbuta
    // or digit form still finds the row.
    const fold = (x) => normaliseArabic(String(x).toLowerCase());
    const term = fold(q.value.trim());
    const counts = {};
    for (const card of cards) {
      const g = groupOfCard.get(card.id);
      counts[g] ??= 0;
      for (const r of rowsOf(card)) {
        const hit = !term || fold(`${r.textContent} ${r.dataset.kw || ''}`).includes(term);
        r.classList.toggle('hide', !hit);
        r.classList.toggle('hit', !!term && hit);
        if (hit && term) counts[g]++;
      }
    }
    for (const tab of tabs) {
      const n = counts[tab.dataset.rail] || 0;
      tab.hidden = !!term && !n;
      let badge = tab.querySelector('.n');
      if (!badge) tab.append((badge = Object.assign(document.createElement('span'), { className: 'n' })));
      badge.hidden = !term;
      badge.textContent = n;
    }
    const first = tabs.find((tb) => !tb.hidden && counts[tb.dataset.rail]);
    nores.hidden = !(term && !first);
    nores.textContent = t('options.search.none', { q: q.value.trim() });
    if (term && first && !counts[current]) { moved = true; activate(first.dataset.rail); }
    if (!term && moved) { moved = false; route(); } // clearing the box returns to the tab the address names
  }
  q?.addEventListener('input', filter);
  QAWi18n.onChange(() => q && filter());
  document.addEventListener('uqa-grid', () => q?.value && filter());

  document.getElementById('rail').addEventListener('keydown', (e) => {
    const visible = tabs.filter((tb) => !tb.hidden);
    const from = visible.findIndex((tb) => tb === document.activeElement);
    if (from === -1) return;
    const rtl = document.documentElement.dir === 'rtl';
    const next = e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !rtl) || (e.key === 'ArrowLeft' && rtl);
    const prev = e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !rtl) || (e.key === 'ArrowRight' && rtl);
    const to = next ? (from + 1) % visible.length : prev ? (from - 1 + visible.length) % visible.length : e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    location.hash = visible[to].getAttribute('href').slice(1);
    activate(visible[to].dataset.rail, { focusTab: true });
  });
})();

/* ── the safe route ────────────────────────────────────────────────────── */

/**
 * Two undo buttons, and a confirmation that costs something.
 *
 * A dialog that asks "are you sure?" and takes a click is answered by reflex.
 * Resetting settings is recoverable — everything on this page can be typed
 * again — so it takes a click. Erasing sessions is not: it is the tester's
 * evidence, and it takes a typed word, which is the smallest thing that cannot
 * be pressed by accident.
 *
 * Neither button does the work: the worker does, behind `UQA_RESET_SETTINGS`
 * and `UQA_ERASE_ALL`, which flush the write queue first and broadcast when
 * they are done, so the popup and the report repaint themselves rather than
 * being repainted from here.
 */
function askThen(question, { typed = false, run }) {
  const dlg = document.getElementById('confirm-dialog');
  const word = document.getElementById('confirm-word');
  document.getElementById('confirm-text').textContent = question;
  document.getElementById('confirm-typed').hidden = !typed;
  word.value = '';
  const go = document.getElementById('confirm-go');
  const check = () => { go.disabled = typed && word.value.trim().toUpperCase() !== 'ERASE'; };
  check();
  word.oninput = check;
  go.onclick = async () => {
    if (typed && word.value.trim().toUpperCase() !== 'ERASE') return;
    dlg.close();
    await run();
  };
  document.getElementById('confirm-cancel').onclick = () => dlg.close();
  document.getElementById('confirm-close').onclick = () => dlg.close();
  dlg.showModal();
  (typed ? word : go).focus();
}

document.getElementById('reset-settings')?.addEventListener('click', () => {
  askThen(erasedText(t, 'reset'), {
    run: async () => {
      const state = document.getElementById('reset-state');
      const res = await send({ type: 'UQA_RESET_SETTINGS' });
      if (!res?.ok) { state.textContent = res?.error || t('options.safe.resetFailed'); return; }
      setSettings(res.result);
      state.textContent = t('options.safe.resetDone');
      paintFootprint();
      // Every control on this page is painted during boot, from one snapshot.
      // Re-reading it is the page's own job and it does it once, so the honest
      // repaint after a reset is the page itself. The line above survives it
      // long enough to be read, and the reloaded page shows the defaults.
      setTimeout(() => location.reload(), TIMING.reloadAfterReset);
    },
  });
});

document.getElementById('erase-all')?.addEventListener('click', () => {
  askThen(erasedText(t, 'eraseAll') || t('options.safe.eraseQuestion'), {
    typed: true,
    run: async () => {
      const state = document.getElementById('erase-state');
      state.textContent = t('options.safe.erasing');
      const res = await send({ type: 'UQA_ERASE_ALL' });
      if (!res?.ok) { state.textContent = res?.error || t('options.safe.eraseFailed'); return; }
      const { sessions = 0, mb = 0, failed = [] } = res.result || {};
      // D-1010-103: a store that would not clear is a privacy fact. Never the done or gone sentence over it.
      if (Array.isArray(failed) && failed.length) {
        state.textContent = t('options.safe.erasePartial', { n: failed.length });
        paintFootprint();
        return;
      }
      state.textContent = sessions
        ? `${t(sessions === 1 ? 'options.safe.eraseDoneOne' : 'options.safe.eraseDoneMany', { n: sessions, mb })} ${erasedText(t, 'eraseAll', { gone: true })}`.trim()
        : t('options.safe.eraseNothing');
      paintFootprint();
    },
  });
});

paintFootprint();
