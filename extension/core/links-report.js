/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The link check as a document, and as a page.
 *
 * ── why these two are not in `core/links.js` ───────────────────────────────
 *
 * They were, until 8 September 2026, and the note that sat above them there is
 * worth keeping because it is half right. `buildLinksHtml` had once reached for
 * its two renderers with `await Promise.all([import('./docshell.js'),
 * import('./mdhtml.js')])`, which looks like a sensible way to keep a document
 * shell out of the common path. It cannot work in `core/links.js`: the HTML
 * specification forbids `import()` inside a ServiceWorkerGlobalScope, Chrome
 * answers it with "import() is disallowed on ServiceWorkerGlobalScope by the
 * HTML specification", and the "Link check (page)" export threw on every build.
 * So the imports were made static.
 *
 * That fixed the crash and paid for it in the wrong currency. `core/links.js` is
 * in the service worker's static boot graph — the worker is the only place that
 * can HEAD a foreign origin, so it owns the checking — and static imports meant
 * these two renderers dragged `core/docshell.js`, `core/mdhtml.js` and, behind
 * docshell, `core/xlsx.js` in with them. Thirty kilobytes of document shell
 * re-parsed on every cold start, for a function only
 * `background/export-build.js` ever calls, and that runs in the offscreen
 * document, which is an ordinary page and may import whatever it likes.
 *
 * The checking stayed where it has to be; the rendering moved to where it is
 * used. `tools/test-worker-imports.mjs` keeps the score, and it still refuses
 * any `import()` in anything the worker loads, for the original reason.
 */

import { shell, escHtml } from './docshell.js';
import { mdToHtml } from './mdhtml.js';

/** The link check as a document: what broke first, then everything. */
export function buildLinksReport(ev) {
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');
  const L = [
    `# Link check: ${ev.title || ev.url}`,
    '',
    `${ev.url} · ${new Date(ev.ts || Date.now()).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `${ev.total} link${ev.total === 1 ? '' : 's'}, ${ev.checked} checked: **${ev.broken.length} broken**, ${ev.redirected.length} redirected, ${ev.slow.length} slow, ${ev.skipped} not checkable (mailto, tel, anchors, sites that block reading the answer).`,
    '',
  ];
  for (const [title, rows] of [['Broken', ev.broken], ['Redirected', ev.redirected], ['Slow', ev.slow]]) {
    if (!rows.length) continue;
    L.push(`## ${title} (${rows.length})`, '', '| Link | Text | Status | Went to |', '|---|---|---|---|');
    for (const r of rows) L.push(`| ${cell(r.href)} | ${cell(r.text)} | ${cell(r.status || r.error || '')} | ${cell(r.finalUrl || '')} |`);
    L.push('');
  }
  L.push('## Every link', '', '| Link | Text | State | Status | ms |', '|---|---|---|---|---|');
  for (const r of ev.rows || []) L.push(`| ${cell(r.href)} | ${cell(r.text)} | ${r.state} | ${cell(r.status || r.error || '')} | ${r.ms ?? ''} |`);
  L.push('');
  return L.join('\n');
}

/** The link check as a page, through the shared shell. */
export async function buildLinksHtml(ev, assets = {}) {
  const { html, headings } = mdToHtml(buildLinksReport(ev));
  return shell({
    title: `Links: ${ev.title || ev.url}`,
    kind: 'Link check',
    subtitle: `${escHtml(ev.url)} · ${new Date(ev.ts || Date.now()).toISOString().slice(0, 16).replace('T', ' ')}`,
    verdict: ev.broken.length ? { tone: 'bad', text: `${ev.broken.length} broken` } : { tone: 'ok', text: 'every link answered' },
    body: html,
    headings,
    legend: [
      { colour: 'var(--bad)', text: 'Broken: a 4xx/5xx, or no answer at all.' },
      { colour: 'var(--warn)', text: 'Redirected: it answered, from somewhere else than it says.' },
      { colour: 'var(--corn)', text: 'Slow: more than three seconds to answer.' },
    ],
    lockup: assets.lockup,
  });
}
