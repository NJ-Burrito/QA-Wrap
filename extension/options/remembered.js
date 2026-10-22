/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Settings > Permissions: what each site may do by itself.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const t = (key, params) => globalThis.QAWi18n.t(key, params);

  /** The four powers: storage key, label key. The buffer list holds origins ("https://a.com"), the others patterns ("https://a.com/*"). */
  const POWERS = [
    { key: 'rememberedSites', label: 'options.auto.wake' },
    { key: 'autoStartSites', label: 'options.auto.starts' },
    { key: 'autoShotSites', label: 'options.auto.shots' },
    { key: 'bufferSites', label: 'options.auto.buffer' },
  ];
  const site = (entry) => String(entry).replace(/\/\*$/, '');
  const listOf = (stored, key) => (Array.isArray(stored[key]) ? stored[key] : []);

  /** Turns one switch off for one site: only that key changes. */
  async function drop(key, origin) {
    const stored = await chrome.storage.local.get(key);
    const list = listOf(stored, key);
    if (key === 'rememberedSites') await chrome.storage.local.set({ rememberedSites: list.filter((o) => site(o) !== origin) });
    else await chrome.storage.local.set({ [key]: list.filter((o) => site(o) !== origin) });
  }

  async function paint() {
    const stored = await chrome.storage.local.get(POWERS.map((p) => p.key));
    const list = listOf(stored, 'rememberedSites');
    if ($('dot-remembered')) $('dot-remembered').dataset.state = list.length ? 'granted' : 'unknown';
    if ($('state-remembered')) $('state-remembered').textContent = list.length ? t(list.length === 1 ? 'options.remembered.one' : 'options.remembered.many', { n: list.length }) : t('options.remembered.none');
    if ($('forget-sites')) $('forget-sites').disabled = !list.length;
    const ul = $('remembered-list');
    if (!ul) return;
    ul.textContent = '';
    const sites = [...new Set(POWERS.flatMap((p) => listOf(stored, p.key).map(site)))];
    for (const origin of sites) {
      const row = document.createElement('li');
      row.style.flexWrap = 'wrap';
      row.dataset.site = origin;
      const name = document.createElement('span');
      name.textContent = origin;
      const switches = document.createElement('span');
      switches.className = 'site-powers';
      switches.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--sp-2, 8px)';
      for (const p of POWERS) {
        const on = listOf(stored, p.key).some((o) => site(o) === origin);
        const label = document.createElement('label');
        label.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = on;
        box.disabled = !on; // switched on in the popup; here it can only be switched off
        box.dataset.power = p.key;
        box.addEventListener('change', async () => {
          if (box.checked) return;
          await drop(p.key, origin);
          await paint();
        });
        const text = document.createElement('span');
        text.textContent = t(p.label);
        label.append(box, text);
        switches.append(label);
      }
      row.append(name, switches);
      ul.append(row);
    }
  }

  $('forget-sites')?.addEventListener('click', async () => {
    await chrome.storage.local.remove('rememberedSites');
    await paint();
  });

  /** The recording dot on pages: on unless the key says false. Turning it back on removes the key (absent = on). */
  async function paintIndicator() {
    const box = $('auto-indicator');
    if (!box) return;
    box.checked = (await chrome.storage.local.get('pageIndicator')).pageIndicator !== false;
  }
  $('auto-indicator')?.addEventListener('change', async (e) => {
    if (e.target.checked) await chrome.storage.local.remove('pageIndicator');
    else await chrome.storage.local.set({ pageIndicator: false });
    // Pages read the settings object (content scripts cannot read storage.local), so the worker gets the same answer.
    try { await chrome.runtime?.sendMessage?.({ type: 'UQA_SET_SETTINGS', patch: { pageIndicator: e.target.checked } }); } catch { /* the local key above stays the switch the screen shows */ }
  });

  const WATCHED = new Set([...POWERS.map((p) => p.key), 'pageIndicator']);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => WATCHED.has(k))) { paint(); paintIndicator(); }
  });
  const both = () => Promise.all([paint(), paintIndicator()]);
  Promise.resolve(globalThis.QAWi18n.ready?.()).then(both, both);
})();
