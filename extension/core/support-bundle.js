/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * T-063: the support bundle. Plain text the tester copies and pastes into a
 * support message; built here, previewed in a dialog first, never sent anywhere.
 *
 * What it will not carry, by construction: no origin or URL (only the count of
 * granted origins), no free text from settings (a changed text setting is named,
 * its value is not), no secret (ring lines pass the privacy redactor and the
 * secret scanner; a URL, mailbox, IP, host or port, path and long number are each cut to a tag). tools/test-support-bundle.mjs
 * runs a corpus through it.
 */
import { redact } from './privacy.js';
import { scanText, redactText } from './secret-scan-text.js';

// Order matters: scheme URLs, then mailboxes (the person's name goes with the host), then addresses and ports, then dotted hosts, then paths, then long numbers.
const TLD = 'com|org|net|io|dev|app|co|sa|ae|eg|jo|uk|de|fr|gov|edu|info|biz|local|internal|corp|lan|intranet|home|test|example|invalid';
const NOT_HOST = /^(?:chrome|browser|window|document|self|globalThis|console|navigator|location)\./i;
/** @param {string} s */
export function clean(s) {
  let out = String(s ?? '').slice(0, 160);
  out = redactText(out, scanText(out));
  out = redact(out).text;
  return out
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[url]')
    .replace(/[\w.+%-]+@[\w.-]+/g, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[ip]')
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]')
    .replace(/\b[\w-]+(?:\.[\w-]+)*:\d{2,5}\b\S*/g, '[host]')
    .replace(new RegExp('\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:' + TLD + ')\\b\\S*', 'gi'), (m) => (NOT_HOST.test(m) ? m : '[host]'))
    .replace(/\b[A-Za-z]:\\\S*/g, '[path]')
    .replace(/(?:^|(?<=[\s(=:,]))(?:\/[\w.@%+~-]+){2,}\/?/g, '[path]')
    .replace(/\d{5,}/g, '[n]');
}

/**
 * @param {{ name?: string, version?: string, build?: string, ua?: string, capabilities?: object,
 *   originCount?: number, settings?: Record<string, any>, defaults?: Record<string, any>,
 *   ring?: Array<{t:number,name:string,msg:string}>, firstReportOpenedAt?: number,
 *   bootMs?: number[], toolUseTicks?: number }} x
 */
export function buildBundle(x) {
  const diff = Object.keys(x.defaults || {}).filter((k) => JSON.stringify(x.settings?.[k]) !== JSON.stringify(x.defaults?.[k])).map((k) => {
    const v = x.settings?.[k];
    return typeof v === 'boolean' || typeof v === 'number' ? `${k}: ${v}` : `${k}: changed`;
  });
  const ring = (x.ring || []).slice(-30).map((r) => `${new Date(r.t).toISOString()} ${clean(r.name)}: ${clean(r.msg)}`);
  const boots = (Array.isArray(x.bootMs) ? x.bootMs : []).map(Number).filter(Number.isFinite).slice(-5).map(Math.round);
  const caps = Object.entries(x.capabilities || {}).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? v : typeof v === 'number' ? v : 'present'}`);
  return [
    `${x.name || 'QA Wrap'} support details (nothing was sent; you pasted this)`,
    `build: ${x.build || ''}  manifest: ${x.version || ''}`,
    `browser: ${(x.ua || '').replace(/[()]/g, ' ').slice(0, 200)}`,
    `granted sites: ${Number(x.originCount) || 0}`,
    `first report opened: ${x.firstReportOpenedAt ? new Date(x.firstReportOpenedAt).toISOString() : 'never'}`,
    `worker start times (ms, last 5): ${boots.length ? boots.join(', ') : 'none yet'}`,
    `tool uses on this machine: ${Math.max(0, Math.floor(Number(x.toolUseTicks)) || 0)}`,
    '', 'capabilities:', ...(caps.length ? caps : ['(none)']),
    '', 'settings changed from default (text values omitted):', ...(diff.length ? diff : ['(none)']),
    '', 'last handler failures:', ...(ring.length ? ring : ['(none)']),
  ].join('\n');
}
