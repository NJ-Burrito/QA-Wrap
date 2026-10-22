/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Worker-side doors to the offscreen document, where modules load on demand (`import()` is barred in a worker): the ticket
 * draft, spec, title and repro steps, and the agent bridge's native port. Only a session id crosses; the page reads IndexedDB.
 * The caller flushes the write queue first (see `draftOp` in service-worker.js). Transport: `exportOp` with `op: 'draft'`.
 */
import { exportOp } from './media.js';

const call = (fn) => (args) => exportOp('draft', { fn, args });

/** Written out, not a Proxy: a typo is a `TypeError` here, at the call site. */
export const playwrightSpec = call('playwrightSpec');
/** `{ sessionId }` -> the ticket title, or null when the session is gone. */
export const ticketTitle = call('ticketTitle');
/** `{ kind, sessionId, problemsOnly }` -> `{ summary, body, ... }`. */
export const draftIssue = call('draftIssue');
/** `{ kind, types }` -> the matching issue type or undefined. */
export const pickIssueType = call('pickIssueType');

/**
 * The agent bridge (decision 6): the native port exists only while the user has it on AND nativeMessaging is granted.
 * Questions are forwarded to the offscreen page (`offscreen/agent-bridge.js`, read-only) and answered on the port.
 * Never rejects. `wait`: ms to see whether the host is really there (the browser reports a missing host after a beat).
 */
let port = null;
export async function bridgeSync(wait = 0) {
  try {
    const on = (await chrome.storage.local.get('agentBridge')).agentBridge === true && (await chrome.permissions.contains({ permissions: ['nativeMessaging'] }));
    if (!on) { port?.disconnect(); port = null; return { on: false, connected: false, error: '' }; }
    if (port) return { on, connected: true, error: '' };
    const p = (port = chrome.runtime.connectNative('com.qawrap.bridge'));
    let error = '';
    p.onDisconnect.addListener(() => { error = chrome.runtime.lastError?.message || 'closed'; if (port === p) port = null; });
    p.onMessage.addListener(async (m) => {
      const ok = ['list_sessions', 'get_session', 'get_failures', 'get_ai_brief'].includes(m?.tool);
      const r = ok ? await exportOp('bridge', { fn: m.tool, args: m.args }).catch((e) => ({ ok: false, error: String(e?.message || e) })) : { ok: false, error: 'unknown tool' };
      try { p.postMessage({ id: m?.id, ...r }); } catch { /* the host went away */ }
    });
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return { on, connected: port === p, error };
  } catch (e) { return { on: false, connected: false, error: String(e?.message || e) }; }
}

/** The replay buffer (decision 4): did the user switch it on for the site this page is on? Content scripts cannot read storage, so they ask. */
export async function bufferOn(url) {
  try { return (/** @type {string[]} */ ((await chrome.storage.local.get('bufferSites')).bufferSites) || []).includes(new URL(url).origin); } catch { return false; }
}
