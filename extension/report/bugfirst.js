/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The bug-first part of the report page (features-1010, lane R).
 */
import { groupChains } from '../core/dupes.js';
import { buildAiBlock, buildSessionJson } from '../core/ai-brief.js';
import { suggestControl } from './ai-suggest.js'; // S2: «Suggest title and steps», only while AI writing is on
export { problemCounts } from '../core/finding-count.js'; // C5 (autopilot 1011): the one problem number; `.groups` is what the headline, the card and the Findings tab print

/** The header controls in the order a tester reaches for them: the picker, Save, Copy, a separator, then the destructive one (P1-13). */
export const HEADER_ORDER = ['session-select', 'save-all', 'copy-report', 'bar-sep', 'session-delete'];

/** The header Copy: the same Markdown the verdict card copies, without hunting for that card. `ctx` is `window.UQAReport.mail`. */
export async function headerCopy({ ctx, t, say }) {
  try {
    const text = ctx && await ctx.markdown();
    if (!text) return say(t('report.v.copyMarkdownEmpty'), 'err');
    await navigator.clipboard.writeText(withoutInlineImages(text));
    say(t('report.v.copiedMarkdown'), 'ok');
  } catch { say(t('report.raw.copyFallback'), 'err'); }
}

const cut = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const fkey = (k) => String(k || '').slice(0, 200); // `forKey` is capped at 200 on the way in (C1), so compare capped

/**
 * The title of the report: the tester's charter unless it is the popup's placeholder, else the first Bug note, else the lead failure as `METHOD…
 */
export function heroTitle({ session, events, t, summarise }) {
  const charter = cut(session?.charter, 120);
  if (charter && !/^untitled session$/i.test(charter) && charter !== cut(t('popup.session.untitled'), 120)) return charter;
  const bug = (events || []).find((e) => e.kind === 'note' && e.tag === 'bug' && cut(e.text));
  if (bug) return cut(bug.text);
  const fail = (events || []).find((e) => e.kind === 'net' && (e.error || e.status >= 400));
  if (fail) {
    let path = String(fail.url || '');
    try { path = new URL(path).pathname; } catch { path = path.split(/[?#]/)[0]; }
    return cut(`${String(fail.method || 'GET').toUpperCase()} ${path} ${fail.error ? t('report.ev.networkError') : fail.status}`);
  }
  const bad = (events || []).find((e) => e.kind === 'pageerror' || (e.kind === 'console' && e.level === 'error'));
  if (bad) return cut(summarise ? summarise(bad) : bad.text);
  try { const u = new URL(session.startUrl); return /^(chrome|moz)-extension:$/.test(u.protocol) ? t('report.hero.untitled') : u.host || t('report.hero.untitled'); } catch { return t('report.hero.untitled'); }
}

/** Marked «Not a bug» on the page (an `expected` event with this group's key), or flagged by the data layer. */
export const isExpected = (events, g) => !!g && (g.expected === true || (events || []).some((e) => e.kind === 'expected' && fkey(e.forKey) === fkey(g.key)));

/** The screenshot the page took by itself for this group (`auto` + same `forKey`), if it saved one. */
export const groupShot = (events, g) => (events || []).find((e) => e.kind === 'screenshot' && e.auto && g && fkey(e.forKey) === fkey(g.key) && (e.mediaId || e.captureId)) || null;

/** Badges for one group: «Marked expected by tester» when the tester said it was not a bug. Empty array when none. */
export const flags = (el, t, events, g) => (isExpected(events, g) ? [el('span', 'badge badge-skipped dup-expected', t('report.dup.expected'))] : []);

/** The failure groups of a list of chains: identical failures are one entry with a count. */
export const groups = (chains, shownEvents) => groupChains(chains, shownEvents);

/** The ×N badge of a folded failure. */
export const countBadge = (el, t, n) => el('span', 'dup-count', t('report.dup.times', { n }));

/** A Markdown report for the clipboard: a screenshot embedded as a data URI would paste megabytes, so each becomes a one-line note. */
export const withoutInlineImages = (md) => String(md).replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, (m, alt) => `_[${alt || 'screenshot'}: saved as a file, not pasted]_`);

/** «Every time it happened», collapsed until asked for. Shows the first 200 occurrences; the exports keep all of them. */
export function occurrences({ group, el, t, rel, summarise }) {
  const LIMIT = 200;
  const all = el('details', 'chain-detail dup-all');
  all.append(el('summary', null, t('report.dup.showAll', { n: group.count })));
  const ul = el('ul', 'chain-siblings');
  group.occurrences.slice(0, LIMIT).forEach((o) => ul.append(el('li', null, `${rel(o.ts)} ${summarise(o)}`)));
  const hidden = group.count - Math.min(group.occurrences.length, LIMIT);
  if (hidden > 0) ul.append(el('li', 'muted', t('report.dup.more', { n: hidden })));
  all.append(ul);
  return all;
}

/**
 * The two copy buttons of the verdict card.
 */
export function copyButtons({ el, t, say, ctx, session, events }) {
  const make = (cls, key, id, run) => {
    const b = el('button', cls, t(key));
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', async () => {
      try { await run(); } catch { say(t('report.raw.copyFallback'), 'err'); }
    });
    return b;
  };
  const md = make('btn btn-primary', 'report.v.copyMarkdown', 'btn-copy-md', async () => {
    say(t('report.status.building'));
    const text = await ctx.markdown();
    if (!text) return say(t('report.v.copyMarkdownEmpty'), 'err');
    await navigator.clipboard.writeText(withoutInlineImages(text));
    say(t('report.v.copiedMarkdown'), 'ok');
  });
  const ai = make('btn btn-secondary', 'report.ai.copy', 'btn-copy-ai', async () => {
    await navigator.clipboard.writeText(buildAiBlock(session, events()));
    say(t('report.ai.copied'), 'ok');
  });
  return [md, ai, suggestControl({ el, t, say, session, events })];
}

/** The Raw export picker's `session.json`, built from the events the page already holds. */
export const sessionJson = (session, events) => ({ content: buildSessionJson(session, events), mime: 'application/json', filename: 'session.json' });
