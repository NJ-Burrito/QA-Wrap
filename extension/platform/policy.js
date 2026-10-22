/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What an administrator may fix through `chrome.storage.managed` (T-068). One registry, read once
 * (`policy()` in settings.js), asked at the seam (`assertPolicy`) and again at the last line.
 * Fails open: only a literal `false`, `true`, a known word or a positive integer counts; a typo restricts nothing.
 * Also holds service-access (the old platform/service-access.js re-exports it) so the worker graph keeps its module count.
 */
export const POLICY_DEFAULTS = Object.freeze({
  microphoneAllowed: true,
  hostPermissionsPolicy: 'ask',
  replayAllowed: true,
  retentionDaysMax: 0,
  integrationsAllowed: true,
  integrationHosts: [],
  debuggerToolsAllowed: true,
  redactionLocked: false,
  consentMode: 'user',
  consentUrl: '',
});

// T-071: organisation mode needs an https link, else the welcome page opens as usual.
const httpsUrl = (u) => { try { return new URL(String(u).trim()).protocol === 'https:' ? String(u).trim() : ''; } catch { return ''; } };

export const normalisePolicy = (s) => {
  s = s && typeof s === 'object' ? s : {};
  const consentUrl = httpsUrl(s.consentUrl);
  const days = Number(s.retentionDaysMax);
  return {
    microphoneAllowed: s.microphoneAllowed !== false,
    hostPermissionsPolicy: ['ask', 'all', 'none'].includes(s.hostPermissionsPolicy) ? s.hostPermissionsPolicy : 'ask',
    replayAllowed: s.replayAllowed !== false,
    retentionDaysMax: Number.isInteger(days) && days > 0 ? days : 0,
    integrationsAllowed: s.integrationsAllowed !== false,
    integrationHosts: Array.isArray(s.integrationHosts)
      ? s.integrationHosts.filter((h) => typeof h === 'string' && h.trim()).map((h) => h.trim().toLowerCase())
      : [],
    debuggerToolsAllowed: s.debuggerToolsAllowed !== false,
    redactionLocked: s.redactionLocked === true,
    consentMode: s.consentMode === 'organisation' && consentUrl ? 'organisation' : 'user',
    consentUrl,
  };
};

const KEY = { replay: 'replayAllowed', integrations: 'integrationsAllowed', debugger: 'debuggerToolsAllowed' };

/** The message types behind each feature, so the worker's one seam needs no table of its own. */
export const featureOf = (type) =>
  /^UQA_(REPLAY_GET|OPEN_REPLAY)$/.test(type) ? 'replay'
    : /^UQA_(JIRA_(TEST|PROJECTS|TYPES|TARGETS|LINK_TYPES|FILE|QUICK|SYNC|SCAN|DUPES)|TRACKER_(TEST|TARGETS|FILE)|NOTIFY(_TEST)?)$/.test(type) ? 'integrations'
      : /^UQA_COVERAGE_(START|REQUEST)$/.test(type) ? 'debugger'
        : null;

/** `null` when allowed, else `{code:'POLICY', key}` naming the key that refused. `url` is checked against integrationHosts. */
export function allows(p, feature, url) {
  if (p[KEY[feature]] === false) return { code: 'POLICY', key: KEY[feature] };
  if (feature === 'integrations' && p.integrationHosts?.length && url) {
    let h = '';
    try { h = new URL(url).hostname.toLowerCase(); } catch { /* unparseable: nothing to match, so refused below */ }
    if (!p.integrationHosts.some((x) => h === x || h.endsWith(`.${x}`))) return { code: 'POLICY', key: 'integrationHosts' };
  }
  return null;
}

/** Thrown with the popup's existing localised row (POLICY_BLOCKED) and the key that refused. */
export const policyError = (hit) =>
  Object.assign(new Error(`Turned off by your organisation (${hit.key}). Ask your IT administrator.`), { code: 'POLICY_BLOCKED', key: hit.key });

/** A saved retention window under a ceiling: 0 (keep for ever) and anything above it become the ceiling. */
export const capRetention = (days, max) => (max > 0 && (!days || days > max) ? max : days);

/** Locked redaction: on, and both ambiguous families on; the tester's own choices can only add. */
export const LOCKED_FAMILIES = ['nationalId', 'email'];

/* ── service access (was platform/service-access.js) ─────────────────── */

/** `https://host/*` for an http(s) URL, else null. */
export const serviceOrigin = (url) => {
  try {
    const u = new URL(String(url).trim());
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.host}/*` : null;
  } catch {
    return null;
  }
};

/** Has the tester allowed QA Wrap to reach this service? No permissions API (unit tests) counts as yes. */
export async function hasServiceAccess(url) {
  const origin = serviceOrigin(url);
  return !origin || !chrome.permissions?.contains || (await chrome.permissions.contains({ origins: [origin] }).catch(() => false));
}

export const notAllowedMessage = (url) =>
  `QA Wrap has not been allowed to reach ${(serviceOrigin(url) || url).replace(/^https?:\/\/|\/\*$/g, '')}. ` +
  'Press the button again and choose Allow when the browser asks.';
