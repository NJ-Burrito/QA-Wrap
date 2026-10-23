/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/*
 * Settings > Integrations > «AI writing» (off by default). The markup lives in ai-writing.fragment.html and is added at run time,
 * so options.html carries one script line for it. The key is written to chrome.storage.local only (never `settings`, which syncs).
 */
import { PROVIDERS, AI_SETTINGS_KEY, AI_KEY_KEY, loadConfig, saveConfig, removeKey, maskKey } from '../core/ai-write.js';
import { readKey, saveKey } from '../platform/ai-key.js';

(async () => {
  const host = document.getElementById('sec-integrations');
  if (!host) return;
  const t = (key, params) => globalThis.QAWi18n.t(key, params);
  try {
    const res = await fetch(new URL('ai-writing.fragment.html', import.meta.url));
    if (!res.ok) return;
    const box = document.createElement('div');
    box.innerHTML = await res.text();
    host.append(box);
    await globalThis.QAWi18n.ready();
    globalThis.QAWi18n.apply(box);
  } catch { return; }
  const $ = (id) => document.getElementById(id);
  const store = chrome.storage.local;

  async function paint() {
    const cfg = await loadConfig(store);
    $('ai-on').checked = cfg.on;
    $('ai-provider').value = cfg.provider;
    $('ai-model').value = cfg.model;
    $('ai-model').placeholder = PROVIDERS[cfg.provider].defaultModel;
    const key = await readKey(store);
    $('ai-key-state').textContent = key ? t('aiwrite.keyStored', { mask: maskKey(key) }) : t('aiwrite.keyNone');
    $('ai-key-remove').disabled = !key;
  }
  const persist = async () => {
    await saveConfig(store, { on: $('ai-on').checked, provider: $('ai-provider').value, model: $('ai-model').value });
    await paint();
  };
  for (const id of ['ai-on', 'ai-provider', 'ai-model']) $(id).addEventListener('change', persist);
  $('ai-key-save').addEventListener('click', async () => {
    const v = $('ai-key').value.trim();
    if (!v) return;
    await saveKey(store, v);
    $('ai-key').value = '';
    await paint();
  });
  $('ai-key-remove').addEventListener('click', async () => { await removeKey(store); await paint(); });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch[AI_SETTINGS_KEY] || ch[AI_KEY_KEY])) paint(); });
  await paint();
})();
