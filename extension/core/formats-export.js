/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The two ticket formats only the export builder uses (Markdown issue, CSV).
 * Kept out of `formats.js` so the service worker does not parse them at boot.
 */
import { embed } from './provenance.js';
import { isFailure } from './artifact.js';
import { sections, plural, when, summarise } from './formats.js';
import { sessionIsArabic, fenceFor, mdEsc, mdCell, oneLine } from './docshell.js';
import { docLabels, fill, confWord } from './doc-labels.js';
import { REPRODUCIBILITY } from './istqb.js';

const ENV_KEY = { URL: 'envUrl', Viewport: 'envViewport', Browser: 'envBrowser', Platform: 'envPlatform', Language: 'envLanguage', Recorded: 'envRecorded' };

/** D-1010-131: [label, value] for the optional build and the reproducibility of a record, in the document's language; an empty build reads "not stated". */
export function buildFields(src, ar) {
  const W = docLabels(ar ? 'ar' : 'en'), r = REPRODUCIBILITY.includes(src?.reproducibility) ? src.reproducibility : 'unknown';
  return [[W.defBuild, String(src?.build ?? '').trim() || W.notStated], [W.defRepro, W['repro' + r[0].toUpperCase() + r.slice(1)]]];
}

/* ── GitHub / Azure DevOps / Linear — all take Markdown ───────────────── */

/* r1-11-1: the escapers live in docshell.js so every Markdown builder shares them; re-exported for existing callers. */
export { mdEsc, mdCell };

/* D-1010-108: the one reader of the capture-gap notes. It reads the structured fields (never the text): the numeric lost and
 * unconfirmed counts, and `gap` codes (coverage-detached, recording-orphaned, any other string) for the notes that carry no count. */
export function captureGap(events) {
  const g = { lost: 0, unconfirmed: 0, other: [] };
  for (const e of events || []) {
    if (e.kind !== 'note' || e.tag !== 'capture-gap') continue;
    g.lost += +e.lost || 0;
    g.unconfirmed += +e.unconfirmed || 0;
    if (e.gap && !g.other.includes(String(e.gap))) g.other.push(String(e.gap));
  }
  return g;
}

/** The sentence key (a doc-labels key) of a gap code. An unknown code gets the generic sentence. */
export const GAP_LABEL = { 'coverage-detached': 'gapCoverageDetached', 'recording-orphaned': 'gapRecordingOrphaned', 'session-cap': 'gapSessionCap', 'body-cap': 'gapBodyCap', 'low-disk': 'gapLowDisk', 'replay-cap': 'gapReplayCap' };

/** The export-header sentence for a capture gap; empty when nothing was lost. */
export const captureGapLine = (events, ar) => {
  const { lost, unconfirmed, other } = captureGap(events);
  const W = docLabels(ar ? 'ar' : 'en');
  const parts = [];
  if (lost || unconfirmed) parts.push(fill(W.gapLine, { lost, unconfirmed }));
  for (const c of other) parts.push(W[GAP_LABEL[c] || 'gapOther']);
  return parts.join(' ');
};

/* r3-04-1: how much of the designed black-box rows a tester applied. Ids are unique, so this is a set count. */
export const techniqueCoverage = (designed, applied) => {
  const a = new Set(applied), d = [...new Set(designed)];
  return { covered: d.filter((id) => a.has(id)).length, total: d.length };
};

/** One line for a session's black-box coverage, from its tag:'technique' notes ("Technique: applied <id>" / "Technique: designed <id> <id>"). */
export function techniqueLine(events, ar) {
  const d = [], a = [];
  for (const e of events || []) {
    const m = e.kind === 'note' && e.tag === 'technique' && /^Technique: (applied|designed) (.+)$/.exec(e.text || '');
    if (m) (m[1] === 'applied' ? a : d).push(...m[2].trim().split(/\s+/));
  }
  const { covered, total } = techniqueCoverage(d, a);
  const fields = new Set(d.map((id) => id.slice(0, id.lastIndexOf('#')))).size; // D-1010-94: counted by field (the locator key), not by the 24-char name
  const W = docLabels(ar ? 'ar' : 'en');
  return total ? fill(fields === 1 ? W.techLineOne : W.techLine, { covered, total, fields }) : '';
}

export function toMarkdownIssue(session, events) {
  const s = sections(session, events);
  const ar = sessionIsArabic(session, events);
  const W = docLabels(ar ? 'ar' : 'en'); // T-053: the document's words follow the tester's language
  const L = [embed.markdown({ session, kind: 'issue-markdown' }), ''];

  L.push(`## ${W.jWhat}`, '');
  if (s.chains.length) {
    for (const c of s.chains) {
      L.push(`- **${mdEsc(c.failure)}**`);
      L.push(
        c.trigger
          ? `  - ${W.jCause}: ${mdEsc(c.trigger)} _(${fill(W.jEarlier, { ms: c.gapMs })}, ${fill(W.confidence, { v: confWord(W, c.confidence) })})_`
          : `  - ${W.jNoCause}`
      );
      if (c.detail) { const f = fenceFor(c.detail); L.push('', f, c.detail, f); }
    }
  } else {
    L.push(`${W.jNoFailures}: ${mdEsc(session.charter)}`);
  }

  L.push('', `## ${W.jSteps}`, '');
  s.steps.forEach((step) => L.push(mdEsc(step)));

  if (s.notes.length) {
    L.push('', `## ${W.jNotes}`, '');
    s.notes.filter((n) => n.tag !== 'technique').forEach((n) => L.push(`- ${n.tag ? `**${mdEsc(n.tag)}** ` : ''}${mdEsc(n.text)} _(${n.at})_`));
  }
  const extra = [captureGapLine(events, ar), techniqueLine(events, ar)].filter(Boolean);
  if (extra.length) L.push('', ...extra.map((x) => `_${mdEsc(x)}_`));

  if (s.a11y) {
    L.push('', `## ${W.jA11y}`, '');
    L.push(`${plural(s.a11y.total, 'issue')} across ${plural(s.a11y.violations.length, 'rule')}, found by axe-core.`, '');
    L.push('| Impact | Rule | Elements | Issue |', '|---|---|---|---|');
    s.a11y.violations.forEach((v) => L.push(`| ${mdEsc(v.impact || 'n/a')} | \`${String(v.id ?? '').replace(/[`|\r\n]+/g, ' ')}\` | ${v.count} | ${mdEsc(v.help)} |`));
  }

  if (s.perf) {
    L.push('', `## ${W.jPerf}`, '');
    L.push('| Metric | Value | Rating |', '|---|---|---|');
    for (const [k, v] of Object.entries(s.perf.metrics)) {
      L.push(`| ${k.toUpperCase()} | ${v ?? '—'} | ${s.perf.ratings[k]} |`);
    }
  }

  L.push('', `## ${W.jEnv}`, '');
  L.push(`| ${W.jField} | ${W.jValue} |`, '|---|---|');
  s.env.forEach(([k, v]) => L.push(`| ${W[ENV_KEY[k]] || k} | ${mdCell(v)} |`));
  buildFields(session, ar).forEach(([k, v]) => L.push(`| ${k} | ${mdCell(v)} |`));

  if (s.locators.length) {
    const loc = s.locators.map((l) => oneLine(l)), f = fenceFor(loc.join('\n'));
    L.push('', `## ${W.jLocators}`, '', f + 'js', ...loc, f);
  }

  L.push('', `_${W.mIssueFoot}_`);
  return L.join('\n');
}

/* ── CSV for TestRail / Xray / a spreadsheet ──────────────────────────── */

/**
 * A cell a spreadsheet would run as a formula starts with = + @ TAB or CR, or with - when it is not a plain number
 * (-5 is a real negative test value and stays numeric). Such a cell gets a leading ' so Excel and Sheets show it as text.
 */
export const csvCell = (v, guard = true) => {
  let s = String(v ?? '');
  if (guard && (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d+(?:\.\d+)?$/.test(s)))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(session, events) {
  /**
   * The one format that carries no mark, and the reason it does not.
   *
   * Every other format has a channel its own parsers already ignore — an HTML
   * comment, a `_`-prefixed HAR key, a YAML comment, an underscore key in JSON.
   * RFC 4180 has none. Every candidate damages the file:
   *
   *   a leading `#` line — the convention pandas, R and csvkit understand, and
   *   the one tried first — puts the headers on row 2 in Excel and Sheets,
   *   which is where this file is actually opened. Making a tester hunt for
   *   their header row is precisely the kind of in-the-way marking the rest of
   *   this work exists to avoid.
   *
   *   an extra column changes the shape of every row, and a column of identical
   *   tokens is worse again.
   *
   *   a trailing comment line leaves a final record with the wrong field count.
   *
   * So this file stays clean, and the attribution is carried by the things
   * around it: the `qaw-timeline-…` filename it is written under, and the JSON,
   * YAML and report exported from the same session, each of which holds the
   * full token. Marking every format is the goal; damaging a format to claim
   * one is not, and pretending otherwise would only mean the mark is dropped by
   * whoever opens the file and re-saves it.
   */
  const rows = [['at', 'kind', 'summary', 'locator', 'failure']];
  for (const ev of events) {
    rows.push([
      when(ev.ts, session.startedAt),
      ev.kind,
      summarise(ev),
      ev.locator ? `page.${ev.framePrefix || ''}${ev.locator}` : '',
      isFailure(ev) ? 'yes' : '',
    ]);
  }
  // D-1010-131: only a session that states a build or a reproducibility gets the two closing rows, so a plain timeline keeps one row per event.
  if (session.build || session.reproducibility) buildFields(session, sessionIsArabic(session, events)).forEach(([k, v]) => rows.push(['', k, v, '', '']));
  // Column 0 is the `+0.10s` offset this file writes itself, never a tester's text, so it is not guarded.
  // r3-10-1: a UTF-8 BOM, because Excel reads BOM-less UTF-8 as ANSI and shows Arabic text as mojibake.
  return '\uFEFF' + rows.map((r) => r.map((c, i) => csvCell(c, i > 0)).join(',')).join('\n');
}

