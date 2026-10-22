/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The agent bridge's answers (features-1010, decision 6). Loaded on demand by the offscreen document, which is a page and may
 * `import()`; the service worker only relays a question here and the answer back to the native port.
 *
 * Read only by construction: this file calls `getSession`, `getEvents` and `listSessions` and nothing that writes, starts a
 * session or reaches the network. Everything returned is text that went through `maskOutbound` (the same two steps every
 * export ends with) before it leaves. The browser limits a native message to 1 MiB, so an answer is cut to fit and says so.
 */
import * as defaultDb from '../core/db.js';
import { buildSessionJson, buildAiBlock, maskOutbound } from '../core/ai-brief.js';

export const BRIDGE_TOOLS = Object.freeze(['list_sessions', 'get_session', 'get_failures', 'get_ai_brief']);
export const MAX_ANSWER_CHARS = 900_000;
const SESSION_ID = /^[\w-]{1,64}$/;

/** @param {string} text */
const fit = (text) => (text.length <= MAX_ANSWER_CHARS ? text : `${text.slice(0, MAX_ANSWER_CHARS - 80)}\n\n(cut to fit the browser's 1 MiB limit; ask for get_failures or get_ai_brief)`);

/** session.json without the per-occurrence lists and with fewer steps, when the full file is too large to send. */
function slim(json) {
  const o = JSON.parse(json);
  for (const f of o.failures || []) delete f.occurrences;
  if (Array.isArray(o.steps) && o.steps.length > 200) o.steps = [...o.steps.slice(0, 200), `(${o.steps.length - 200} more steps left out)`];
  o.notCaptured = [...(o.notCaptured || []), 'occurrence lists and some steps (too large to send)'];
  return JSON.stringify(o, null, 2);
}

/**
 * @param {{ fn: string, args?: { session_id?: string, limit?: number } }} request
 * @param {{ db?: any }} [deps]
 * @returns {Promise<{ ok: true, result: string } | { ok: false, error: string }>}
 */
export async function answer({ fn, args = {} }, { db = defaultDb } = {}) {
  try {
    if (!BRIDGE_TOOLS.includes(fn)) return { ok: false, error: `unknown tool ${String(fn).slice(0, 40)}` };
    const rows = (await db.listSessions()).slice().sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
    if (fn === 'list_sessions') {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
      const out = [];
      for (const s of rows.slice(0, limit)) {
        out.push({
          id: s.id,
          seq: s.seq ?? null,
          title: maskOutbound(s.charter || ''),
          startedAt: new Date(s.startedAt).toISOString(),
          endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
          status: s.status || (s.endedAt ? 'stopped' : 'recording'),
          events: await db.countEvents(s.id).catch(() => null),
          failures: await db.countFailures(s.id).catch(() => null),
        });
      }
      return { ok: true, result: fit(maskOutbound(JSON.stringify({ schema: 'qawrap.sessions/1', sessions: out }, null, 2))) };
    }
    const id = args.session_id ?? rows[0]?.id;
    if (!id) return { ok: false, error: 'There are no sessions yet.' };
    if (!SESSION_ID.test(String(id))) return { ok: false, error: 'session_id is not valid' };
    const session = await db.getSession(id);
    if (!session) return { ok: false, error: `No session ${id}.` };
    const events = await db.getEvents(id);
    if (fn === 'get_ai_brief') return { ok: true, result: fit(buildAiBlock(session, events)) };
    let json = buildSessionJson(session, events);
    if (fn === 'get_failures') {
      const o = JSON.parse(json);
      return { ok: true, result: fit(maskOutbound(JSON.stringify({ schema: o.schema, session: { id: o.session.id, startedAt: o.session.startedAt, environment: o.session.environment }, totals: o.totals, failures: o.failures }, null, 2))) };
    }
    if (json.length > MAX_ANSWER_CHARS) json = slim(json);
    return { ok: true, result: fit(json) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
