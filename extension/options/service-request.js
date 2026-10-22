/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
import { serviceOrigin, hasServiceAccess, notAllowedMessage } from '../platform/service-access.js';

/** Ask the browser for one service's origin. Call from a click handler on an extension page. */
export async function requestServiceAccess(url) {
  const origin = serviceOrigin(url);
  if (!origin || !chrome.permissions?.request || (await hasServiceAccess(url))) return { ok: true };
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  return granted ? { ok: true } : { ok: false, error: notAllowedMessage(url) };
}
