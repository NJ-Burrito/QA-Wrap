/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// T-068: the "Policy in effect" list and the disabled-and-explained state. The worker enforces; this only tells the truth.
import { POLICY_DEFAULTS } from '../platform/policy.js';

/** Literal catalogue keys, so the i18n dead-key check can see every one is used. */
const LABEL = {
  microphoneAllowed: 'options.policy.k.microphoneAllowed',
  hostPermissionsPolicy: 'options.policy.k.hostPermissionsPolicy',
  replayAllowed: 'options.policy.k.replayAllowed',
  retentionDaysMax: 'options.policy.k.retentionDaysMax',
  integrationsAllowed: 'options.policy.k.integrationsAllowed',
  integrationHosts: 'options.policy.k.integrationHosts',
  debuggerToolsAllowed: 'options.policy.k.debuggerToolsAllowed',
  redactionLocked: 'options.policy.k.redactionLocked',
  consentMode: 'options.policy.k.consentMode',
  consentUrl: 'options.policy.k.consentUrl',
};
const STATUS = {
  default: 'options.policy.statusDefault',
  managed: 'options.policy.statusManaged',
  unreachable: 'options.policy.statusUnreachable',
};

/** `default` (nothing set), `managed`, or `not reachable` (the area threw or never answered). */
export async function managedStatus(read = () => chrome.storage.managed?.get?.(null), ms = 400) {
  try {
    const got = await Promise.race([Promise.resolve().then(read), new Promise((r) => setTimeout(() => r(undefined), ms))]);
    if (got === undefined) return 'unreachable';
    return Object.keys(got || {}).length ? 'managed' : 'default';
  } catch {
    return 'unreachable';
  }
}

const shown = (key, v, t) =>
  key === 'retentionDaysMax' ? (v ? t('options.policy.days', { n: v }) : t('options.policy.noLimit'))
    : key === 'integrationHosts' ? (v.length ? t('options.policy.hosts', { hosts: v.join(', ') }) : t('options.policy.noLimit'))
      : key === 'redactionLocked' ? t(v ? 'options.policy.locked' : 'options.policy.unlocked')
        : key === 'hostPermissionsPolicy' || key === 'consentMode' ? v
          : key === 'consentUrl' ? (v || t('options.policy.noLimit'))
          : t(v ? 'options.policy.on' : 'options.policy.off');

/** One row per key: its label, its effective value, and whether it differs from the default. */
export function policyRows(p, t) {
  return Object.keys(POLICY_DEFAULTS).map((key) => ({
    key,
    label: t(LABEL[key]),
    value: shown(key, p[key], t),
    set: JSON.stringify(p[key]) !== JSON.stringify(POLICY_DEFAULTS[key]),
  }));
}

/** Controls a key takes away, as CSS selectors. */
const CONTROLS = {
  retentionDaysMax: '#retentionDays',
  redactionLocked: '#redact, #redactExtra button',
  integrationsAllowed: '#sec-integrations input, #sec-integrations select, #sec-integrations textarea, #sec-integrations button',
};

function manage(doc, key, selector, t) {
  for (const el of doc.querySelectorAll(selector)) {
    el.disabled = true;
    el.classList.add('is-managed');
    el.setAttribute('aria-disabled', 'true');
    const host = el.closest('label, .row-2, .card-head, div') || el.parentElement;
    if (host && !host.querySelector(`[data-managed="${key}"]`)) {
      const note = doc.createElement('span');
      note.className = 'range-note is-managed-note';
      note.dataset.managed = key;
      note.textContent = t('options.policy.setByOrg', { key });
      host.append(note);
    }
  }
}

export function paintPolicy(doc, p, status, t) {
  const list = doc.getElementById('policy-list');
  const line = doc.getElementById('policy-status');
  if (line) line.textContent = t(STATUS[status] || STATUS.default);
  if (list) {
    list.replaceChildren(...policyRows(p, t).map((r) => {
      const li = doc.createElement('li');
      li.className = r.set ? 'is-managed' : '';
      li.textContent = `${r.label}: ${r.value}`;
      li.dataset.key = r.key;
      return li;
    }));
  }
  if (p.retentionDaysMax > 0) manage(doc, 'retentionDaysMax', CONTROLS.retentionDaysMax, t);
  if (p.redactionLocked) manage(doc, 'redactionLocked', CONTROLS.redactionLocked, t);
  if (p.integrationsAllowed === false) manage(doc, 'integrationsAllowed', CONTROLS.integrationsAllowed, t);
}
