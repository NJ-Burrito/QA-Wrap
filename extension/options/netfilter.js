/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Settings > Timeline > Network filter (D9) and the "Record click labels" switch (D10).
 * Stored in chrome.storage.local under `qaw.netfilter`, which the DevTools panel, the report, the recorder and the bridge read.
 * Rules made from the timeline's row menu live in the same record, per site.
 */
import { DEFAULT_CONFIG, PRESETS, parseStatuses } from '../core/netfilter.js';

const KEY = 'qaw.netfilter';
const $ = (id) => document.getElementById(id);
const lines = (v) => String(v || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
const t = (k, v) => (window.QAWi18n ? window.QAWi18n.t(k, v) : k);

async function load() {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  return { ...DEFAULT_CONFIG, ...(stored && typeof stored === 'object' ? stored : {}) };
}

function paint(cfg) {
  for (const r of document.querySelectorAll('input[name="nfPreset"]')) r.checked = r.value === (PRESETS.includes(cfg.preset) ? cfg.preset : 'balanced');
  $('nf-clickLabels').checked = cfg.clickLabels !== false;
  $('nf-ignoreDomains').value = (cfg.ignoreDomains || []).join('\n');
  $('nf-ignorePaths').value = (cfg.ignorePaths || []).join('\n');
  $('nf-ignoreStatuses').value = (cfg.ignoreStatuses || []).join(', ');
  $('nf-myHosts').value = (cfg.myHosts || []).join('\n');
}

async function save() {
  const cfg = await load();
  const preset = document.querySelector('input[name="nfPreset"]:checked')?.value;
  const next = {
    ...cfg,
    preset: PRESETS.includes(preset) ? preset : 'balanced',
    clickLabels: $('nf-clickLabels').checked,
    ignoreDomains: lines($('nf-ignoreDomains').value).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]),
    ignorePaths: lines($('nf-ignorePaths').value),
    ignoreStatuses: parseStatuses($('nf-ignoreStatuses').value),
    myHosts: lines($('nf-myHosts').value).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]),
  };
  await chrome.storage.local.set({ [KEY]: next });
  $('nf-status').textContent = t('options.nf.saved');
}

if ($('nf-field')) {
  paint(await load());
  for (const id of ['nf-clickLabels', 'nf-ignoreDomains', 'nf-ignorePaths', 'nf-ignoreStatuses', 'nf-myHosts']) $(id).addEventListener('change', save);
  for (const r of document.querySelectorAll('input[name="nfPreset"]')) r.addEventListener('change', save);
}
