/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `summarisePostman()`, called from the worker, executed behind the door.
 *
 * The worker wants one number before an export is made: how many requests a
 * Postman collection would actually contain, so that a session spent on a
 * static page is told "nothing to collect" rather than handed an empty file.
 * Answering it costs the whole of `core/postman.js`, because the summary builds
 * the collection in order to count it — 13 KB re-parsed on every cold start for
 * a function pressed a handful of times a week.
 *
 * The offscreen document already holds that module: `background/export-build.js`
 * imports it to write the collection and the environment. So the count is made
 * there, next to the thing being counted, and the worker keeps a name and a
 * message. Same shape as `background/istqb-render-door.js`, and for the same
 * reason — JSON in, JSON out, nothing a message channel cannot carry.
 *
 * Written out rather than proxied so that calling something that is not there
 * fails at this line instead of inside the offscreen document.
 */
import { postmanOp } from './media.js';

export const summarisePostman = (session, events) => postmanOp('summarisePostman', [session, events]);
