/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/*
 * Settings > Privacy: the 2-minute replay buffer (decision 4) and the agent bridge (decision 6). Kept out of options.js so
 * that file stays under its line ceiling.
 *
 *   - Replay buffer: the sites it is on for (`bufferSites`), each removable, or all at once. It is turned ON from the popup,
 *     on the site itself; this page only lists and switches off.
 *   - Agent bridge: off by default. `nativeMessaging` is an OPTIONAL permission, asked for here, in the click that turns the
 *     bridge on, and handed back when it is turned off. The service worker holds the native port only while both are true.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const t = (key, params) => globalThis.QAWi18n.t(key, params);

  /** Every open page asks the worker again whether the buffer is on for its site (a removed site stops at once). */
  const refreshPages = async () => { for (const tab of await chrome.tabs.query({})) chrome.tabs.sendMessage(tab.id, { type: 'UQA_BUFFER_REFRESH' }, { frameId: 0 }).catch(() => {}); };

  async function paintBuffer() {
    const { bufferSites: list = [] } = /** @type {{ bufferSites?: string[] }} */ (await chrome.storage.local.get('bufferSites'));
    if ($('buffer-count')) $('buffer-count').textContent = list.length ? t('buffer.options.count', { n: list.length }) : t('buffer.options.none');
    if ($('buffer-clear')) $('buffer-clear').disabled = !list.length;
    const ul = $('buffer-list');
    if (!ul) return;
    ul.textContent = '';
    for (const origin of list) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = origin;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'btn btn-xs btn-quiet';
      drop.textContent = t('options.permissions.remove');
      drop.addEventListener('click', async () => {
        await chrome.storage.local.set({ bufferSites: list.filter((o) => o !== origin) });
        await refreshPages();
        await paintBuffer();
      });
      row.append(name, drop);
      ul.append(row);
    }
  }
  $('buffer-clear')?.addEventListener('click', async () => {
    await chrome.storage.local.remove('bufferSites');
    await refreshPages();
    await paintBuffer();
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.bufferSites) paintBuffer(); });

  /** `wait`: ms the worker may take to learn whether the helper is really there. */
  async function paintBridge(wait = 0) {
    const box = $('agentBridge');
    if (!box) return;
    const { agentBridge } = await chrome.storage.local.get('agentBridge');
    const granted = await chrome.permissions.contains({ permissions: ['nativeMessaging'] });
    const on = agentBridge === true && granted;
    box.checked = on;
    $('bridge-check').hidden = !on;
    let key = 'bridge.state.off';
    if (on) {
      const res = await chrome.runtime.sendMessage({ type: 'UQA_BRIDGE_SYNC', wait }).catch(() => null);
      key = res?.result?.connected ? 'bridge.state.on' : 'bridge.state.noHelper';
    }
    $('bridge-state').textContent = t(key);
  }

  $('agentBridge')?.addEventListener('change', (e) => {
    if (!e.target.checked) {
      chrome.storage.local.set({ agentBridge: false })
        .then(() => chrome.permissions.remove({ permissions: ['nativeMessaging'] }))
        .then(() => paintBridge(), () => paintBridge());
      return;
    }
    const asking = chrome.permissions.request({ permissions: ['nativeMessaging'] }); // first statement: still inside the click
    asking.catch(() => false).then(async (granted) => {
      if (!granted) { e.target.checked = false; await paintBridge(); $('bridge-state').textContent = t('bridge.state.denied'); return; }
      await chrome.storage.local.set({ agentBridge: true });
      await paintBridge(900);
    });
  });
  $('bridge-check')?.addEventListener('click', () => paintBridge(900));

  Promise.resolve(globalThis.QAWi18n.ready?.()).then(() => { paintBuffer(); paintBridge(); }, () => { paintBuffer(); paintBridge(); });
})();
