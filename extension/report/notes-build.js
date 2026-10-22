/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Export notes (ui-1019): the session's own notes as one file, Markdown or CSV.
 *
 * Notes are masked when written, but the file is the copy that leaves the browser, so every text is passed through
 * the same redactors the outbound scan uses (privacy.js `redact`, then `redactEntropy`) once more. Pure: no DOM, no chrome.
 */
import { redact, redactEntropy } from '../core/privacy.js';

export const clean = (s) => redactEntropy(redact(String(s ?? '')).text).text;
const stamp = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19).replace(/[T:]/g, '-') : 'session');

/** The notes a tester wrote, oldest first. Technique notes are generated, not written. */
export const sessionNotes = (events) => (events || []).filter((e) => e.kind === 'note' && e.tag !== 'technique' && String(e.text ?? '').trim()).sort((a, b) => a.ts - b.ts);

/** CSV cell; a leading = + - @ would run as a formula in a spreadsheet, so it is defused with a quote. */
const cell = (s) => { const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

/**
 * @param {{ startedAt?: number, charter?: string }} session
 * @param {object[]} events
 * @param {'markdown'|'csv'} [format]
 * @returns {{ content: string, mime: string, filename: string, count: number }}
 */
export function buildNotesExport(session, events, format = 'markdown') {
  const notes = sessionNotes(events).map((e) => ({
    at: Number.isFinite(session?.startedAt) ? Math.max(0, (e.ts - session.startedAt) / 1000).toFixed(2) : '',
    tag: clean(e.tag || 'note'),
    text: clean(e.text).replace(/\r\n?/g, '\n').trim(),
  }));
  const base = `notes-${stamp(session?.startedAt)}`;
  if (format === 'csv') {
    const rows = [['seconds', 'type', 'note'], ...notes.map((n) => [n.at, n.tag, n.text])];
    return { content: `${rows.map((r) => r.map((c) => cell(String(c))).join(',')).join('\r\n')}\r\n`, mime: 'text/csv', filename: `${base}.csv`, count: notes.length };
  }
  const title = clean(session?.charter).replace(/\s+/g, ' ').trim() || 'Session notes';
  const body = notes.map((n) => `- **+${n.at}s** \`${n.tag}\`: ${n.text.replace(/\n/g, '\n  ')}`).join('\n');
  return { content: `# ${title}\n\n${body}\n`, mime: 'text/markdown', filename: `${base}.md`, count: notes.length };
}
