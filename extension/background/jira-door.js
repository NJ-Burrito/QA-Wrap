/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Jira, called from the worker and executed behind the offscreen document.
 *
 * `background/jira.js` is the Jira client. It is not imported here because a
 * worker's module graph is parsed on every cold start and the client matters
 * for a few seconds when somebody files a defect. This shim keeps the call
 * sites reading as if it were imported, while the client loads on demand in a
 * page that may load it.
 *
 * The names are written out, not a Proxy: calling something Jira does not
 * have is a `TypeError` here, at the call site.
 *
 * Nothing binary crosses a message channel (a Blob does not survive
 * `chrome.runtime.sendMessage`). Evidence is built and uploaded behind the
 * door: `fileIssue` and `fileSuite` are handed the session id and the plan
 * (`{ screenshots, formats }`), and `offJira()` in `offscreen/offscreen.js`
 * supplies the file builder.
 */
import { jiraOp } from './media.js';

const call = (fn) => (...args) => jiraOp(fn, args);

export const projects = call('projects');
export const issueTypes = call('issueTypes');
export const linkTypes = call('linkTypes');
export const linkTargets = call('linkTargets');
export const issueStatus = call('issueStatus');
export const summariseStatuses = call('summariseStatuses');
export const testConnection = call('testConnection');
export const findDuplicates = call('findDuplicates');
/** The one filing path and its suite form: scan, shape fields, create, link, attach. */
export const fileIssue = call('fileIssue');
export const fileSuite = call('fileSuite');
