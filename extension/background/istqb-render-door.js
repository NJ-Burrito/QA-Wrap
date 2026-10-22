/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The ISO 29119 renderers, called from the worker, executed behind the door.
 *
 * `core/istqb-render.js` turns a built test case or defect report into Atlassian
 * Document Format, Markdown or Gherkin. It is 17 KB, it is needed only while
 * somebody is filing or drafting, and in the service worker it was parsed on
 * every cold start.
 *
 * Everything here is JSON in, JSON or a string out — a built document object
 * going one way and rendered text coming back — so unlike the attachments in
 * `jira-door.js` there is nothing that a message channel cannot carry. The
 * names are written out rather than proxied so that calling something that does
 * not exist fails here, at the call site.
 */
import { renderOp } from './media.js';

const call = (fn) => (...args) => renderOp(fn, args);

export const testCaseToAdf = call('testCaseToAdf');
export const testCaseToMarkdown = call('testCaseToMarkdown');
export const testCaseToGherkin = call('testCaseToGherkin');
export const defectToAdf = call('defectToAdf');
export const defectToMarkdown = call('defectToMarkdown');
