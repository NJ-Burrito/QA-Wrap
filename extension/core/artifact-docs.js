/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The session as a document: Markdown, raw JSON, and the SBTM session sheet.
 *
 * Split out of `core/artifact.js` on 8 September 2026, for one measured reason.
 * These three builders are reached only through `background/export-build.js`,
 * which runs inside the offscreen document — an ordinary page that may import
 * whatever it likes, whenever it likes. `core/artifact.js` is in the *service
 * worker's* static boot graph, and MV3 re-parses that whole graph on every cold
 * start. `tools/test-worker-imports.mjs` holds it under 800 KB because that
 * parse is what a tester waits through when the worker has been asleep, and
 * twelve kilobytes of Markdown rendering the worker cannot call was being paid
 * for on every wake.
 *
 * Nothing about the output changed. Pure, like everything it came from: no
 * network, no Chrome APIs.
 */

import { isTesterNote } from './events.js';
import { correlate, isFailure } from './correlate.js';
import { groupFailures, dupeKey } from './dupes.js';
import { problemCounts, agreeWithProblems } from './finding-count.js';
import { countFindings, describeFindings } from './sessions.js';
import { visibleProblems, classify } from './signal.js';
import {
  reproSteps, dropDoubleSubmits, areasCovered, durationBand,
  inlinePlan, describeOmitted, stepLabel, LABEL_PROSE_MAX,
} from './artifact.js';
import { MAKER, docFooter, embed, provenance } from './provenance.js';
import { sessionIsArabic, fenceFor, mdEsc, mdCell, mdCode, oneLine } from './docshell.js';
import { docLabels, fill, confWord } from './doc-labels.js';

/**
 * The older combined figure (problems after the noise rules plus what the tester's own tools found). `total` is no longer
 * the number an export prints as "problems": that is `problemCounts(events).groups` (core/finding-count.js), the unit the
 * popup, report, Findings tab, Markdown row, session.json, the agent handoff and (1011 B5) the text, HTML, YAML and
 * docs-manifest exports all share. `total` is kept only as the older combined figure; nothing prints it as "problems".
 */
export function headline(events, session = null) {
  const sig = visibleProblems(events);
  const c = countFindings(events, { session });
  const tool = c.a11y + c.links + c.rtl + c.finePrint;
  return { total: sig.problems + tool, problems: sig.problems, tool, ruleset: sig.ruleset, notes: sig.notes };
}

/* ------------------------------------------------------------------ rendering */

function ts(t, origin) {
  const rel = ((t - origin) / 1000).toFixed(2);
  return `+${rel}s`;
}

/**
 * r1-11-1: describeDom() in steps.js builds Markdown around raw page text, so the document builders use this twin:
 * the label is escaped, the typed value sits in a widened code span, and the structure around them is ours.
 */
function mdDom(ev, bold = true) {
  const t = mdEsc(stepLabel(ev, LABEL_PROSE_MAX) || ev.locator || ev.selector || ev.tag || 'element');
  const target = bold ? `**${t}**` : t;
  switch (ev.action) {
    case 'click': return `${Array.isArray(ev.mods) && ev.mods.length ? ev.mods.map(mdEsc).join('+') + '+' : ''}Click ${target}`; // r10-05-1
    case 'input': return `Fill ${target} with ${mdCode(ev.value)}`;
    case 'change': return `Set ${target} to ${mdCode(ev.value)}`;
    case 'upload': return `Upload ${mdCode(ev.value)} to ${target}`;
    case 'submit': return `Submit ${target}`;
    case 'keydown': return `Press ${mdCode(ev.key)} on ${target}`;
    default: return `${mdEsc(ev.action)} on ${target}`;
  }
}

/** The tag a page-scripted repro step carries, in the language the document is written in (DOC_LABELS.byPage). */
export const byPageOf = (session, events) => docLabels(sessionIsArabic(session, events) ? 'ar' : 'en').byPage;

/** The numbered repro steps as safe Markdown (same shape as reproSteps(), with page text escaped). */
function mdReproSteps(events) {
  return dropDoubleSubmits(events)
    .filter((e) => e.kind === 'dom' || e.kind === 'nav')
    .map((e, i) => `${i + 1}. ${e.kind === 'nav' ? `Navigate to ${mdCell(e.url)}` : mdDom(e, false)}`);
}

/**
 * P0-5: text the tester typed. Not backslash-escaped like page text (`mdEsc` turned "30th bug (x)" into `\(`): only what could
 * hide a link, an image, raw HTML, a live URL or a table cell is escaped, plus a leading `#`. Page text keeps `mdEsc`.
 */
const mdTester = (t) => oneLine(t).replace(/[[\]<|]/g, '\\$&').replace(/^(\s*)#/, '$1\\#')
  .replace(/\b(https?|ftp):\/\//gi, '$1:\\/\\/').replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`); // no live autolink (r1-11-1)

/** Page text (console lines, uncaught errors): `mdEsc` minus the escape of `(`, `)` and `!`, which cannot form a link, image or autolink once `[`, `]` and `<` are escaped. */
const mdPage = (t) => mdEsc(t).replace(/\\([()!])/g, '$1');

/** AUTO-5: the flag a group carries after "Not a bug". Not a removal: the group is still counted. */
const EXPECTED = { en: 'Marked expected by tester', ar: 'وسمه المختبِر على أنه متوقَّع' };

const UNTITLED = /^\s*(untitled session|جلسة بلا عنوان|qa session)\s*$/i;
const cut = (t, n) => { const x = oneLine(t).trim(); return x.length > n ? `${x.slice(0, n - 3).trimEnd()}...` : x; };

/**
 * P0-5: the title of a report, the same fallback as the report page (`report/bugfirst.js` heroTitle): the name the tester
 * set unless it is the "Untitled session" placeholder; else the first Bug note; else the first failing request as
 * `METHOD /path STATUS` (no query); else the first console or uncaught error; else the host. Never `document.title`.
 * Only fields the recorder already masked; the export masks the whole text again. Pure.
 * @param {any} session @param {any[]} [events]
 */
export function reportTitle(session, events = []) {
  const set = cut(session?.charter, 120);
  if (set && !UNTITLED.test(set)) return set;
  const bug = events.find((e) => isTesterNote(e) && e.tag === 'bug' && cut(e.text, 80));
  if (bug) return cut(bug.text, 80);
  const net = events.find((e) => e.kind === 'net' && (e.error || e.status >= 400));
  if (net) {
    let path = String(net.url || '');
    try { path = new URL(path, net.frameUrl || undefined).pathname; } catch { path = path.split(/[?#]/)[0]; }
    return cut(`${String(net.method || 'GET').toUpperCase()} ${path} ${net.error || !(net.status > 0) ? 'network error' : net.status}`, 120);
  }
  const bad = events.find((e) => e.kind === 'pageerror' || (e.kind === 'console' && e.level === 'error'));
  if (bad) return cut(bad.text, 80);
  try {
    const u = new URL(String(session?.startUrl));
    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') return /\/practice\//.test(u.pathname) ? 'Practice page' : 'QA session'; // the host there is the extension id
    return u.host || 'QA session';
  } catch { return 'QA session'; }
}

function describe(ev, origin) {
  const at = ts(ev.ts, origin);
  switch (ev.kind) {
    case 'nav':
      return `\`${at}\` **Navigate** → ${mdCell(ev.url)}`;
    case 'dom':
      return `\`${at}\` ${mdDom(ev)}`;
    case 'net':
      return `\`${at}\` **${mdEsc(ev.method)}** ${mdCell(ev.url)} → ${
        ev.error ? 'network error' : mdEsc(ev.status)
      } (${Math.round(ev.durationMs)}ms)`;
    case 'console':
      return `\`${at}\` **console.${mdEsc(ev.level)}** ${mdPage(ev.text)}`;
    case 'pageerror':
      return `\`${at}\` **Uncaught** ${mdPage(ev.text)}`;
    case 'note':
      return `\`${at}\` 📝 ${mdTester(ev.text)}`;
    case 'expected':
      return `\`${at}\` ${EXPECTED.en}`;
    case 'screenshot':
      return `\`${at}\` 📷 Screenshot${ev.auto ? ' (automatic)' : ''}${ev.text ? `: ${mdEsc(ev.text)}` : ''}`;
    case 'a11y':
      return `\`${at}\` ♿ Accessibility scan: ${ev.total} issue${
        ev.total === 1 ? '' : 's'
      } across ${ev.violations.length} rule${ev.violations.length === 1 ? '' : 's'}`;
    case 'inject':
      return `\`${at}\` 🧪 Injected **${mdCell(ev.label)}** into **${mdEsc(ev.fieldLabel || 'a field')}**${
        ev.truncated ? `, truncated to ${ev.actualLength} chars` : ''
      }`;
    case 'rtl':
      return `\`${at}\` 🔄 Layout stress ${ev.enabled ? 'ON' : 'OFF'}${
        ev.overflowCount ? `: ${ev.overflowCount} element${ev.overflowCount === 1 ? '' : 's'} clipped their content` : ''
      }`;
    default:
      return `\`${at}\` ${mdEsc(ev.kind)}`;
  }
}

export function buildMarkdown(session, events, captures = {}) {
  const origin = session.startedAt;
  const chains = correlate(events);
  const failures = events.filter(isFailure);
  const L = [];
  const W = docLabels(sessionIsArabic(session, events) ? 'ar' : 'en'); // T-053: labels follow the tester's language; event sentences (describe) stay as they are

  L.push(`# ${mdTester(reportTitle(session, events))}`);
  L.push('');
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| ${W.mSession} | ${mdCode(session.id, true)} |`);
  L.push(`| ${W.mStarted} | ${new Date(session.startedAt).toISOString()} |`);
  if (session.endedAt) {
    L.push(`| ${W.mDuration} | ${((session.endedAt - session.startedAt) / 1000).toFixed(1)}s |`);
  }
  // P0-5: a row with nothing to say is left out, not printed as a dash.
  for (const [label, v] of [[W.mStartUrl, session.startUrl], [W.envViewport, session.env?.viewport], [W.mUserAgent, session.env?.userAgent], [W.envPlatform, session.env?.platform], [W.envLanguage, session.env?.language]]) {
    if (v && String(v).trim() !== '—') L.push(`| ${label} | ${mdCell(v)} |`);
  }
  const sig = visibleProblems(events);
  // Events is the raw event count and nothing else: the old "(4 failures)" counted every repeat and sat above a Problems row of 2 (ui-1016 K3).
  L.push(`| ${W.mEvents} | ${events.length} |`);
  /*
   * The same number the report's headline and the popup's live line show.
   *
   * Raw failure rows are not what a reader means by "what did this
   * run find": an accessibility scan with 83 violations, a link check with two
   * broken links and a fine-print check with five gaps all sat outside it, and
   * a document whose only count said "0 failures" read as a clean run
   * (research/58, finding 16). `countFindings` is defined once in
   * `core/sessions.js` precisely so these three surfaces cannot each answer
   * differently.
   */
  const found = agreeWithProblems(countFindings(events, { session }), events); // ui-1016 L: the headline below agrees with the Problems row
  L.push(`| ${W.mFindings} | ${found.total} |`);
  // P0-3: the one problem number, as on every screen (core/finding-count.js): distinct problems, repeats folded.
  L.push(`| ${W.mProblems} | ${problemCounts(events).groups} |`);
  L.push(`| Ruleset | v${sig.ruleset}; ${sig.notes} known-benign notes hidden, kept in the events |`);
  L.push('');
  L.push(describeFindings(found));
  L.push('');

  if (chains.length) {
    L.push(`## ${W.mCorrelated}`);
    L.push('');
    L.push(W.mCorrelatedNote);
    L.push('');
    // features-1010 R3: identical failures are one entry with the count (core/dupes.js); the Raw JSON keeps every occurrence.
    const seenDupe = new Set();
    const dupeGroup = new Map(groupFailures(events).map((g) => [g.key, g]));
    chains.filter((c) => { const k = dupeKey(c.failure); return seenDupe.has(k) ? false : (seenDupe.add(k), true); }).forEach((c, i) => {
      const times = dupeGroup.get(dupeKey(c.failure))?.count || 1;
      L.push(`### ${i + 1}. ${describe(c.failure, origin).replace(/^`[^`]+`\s*/, '')}${times > 1 ? ` ×${times}` : ''}`);
      L.push('');
      if (c.trigger) {
        L.push(`- **${W.mTriggeredBy}** ${describe(c.trigger, origin)} _(${fill(W.jEarlier, { ms: c.gapMs })}, ${fill(W.confidence, { v: confWord(W, c.confidence) })})_`);
      } else {
        L.push(`- **${W.mTriggeredBy}** _${W.mNoTrigger}_`);
      }
      L.push(`- **${W.mFailure}** ${describe(c.failure, origin)}`);
      if (c.failure.kind === 'net' && c.failure.responsePreview) {
        L.push('');
        const f = fenceFor(c.failure.responsePreview);
        L.push(f);
        L.push(c.failure.responsePreview);
        L.push(f);
      }
      if (c.failure.stack) {
        L.push('');
        const f = fenceFor(c.failure.stack);
        L.push(f);
        L.push(c.failure.stack);
        L.push(f);
      }
      c.siblings.forEach((s) => L.push(`- **${W.mAlsoAt}** ${describe(s, origin)}`));
      if (times > 1) L.push(`- **${W.mOccurred}** ${fill(W.mOccurredN, { n: times })}`);
      if (dupeGroup.get(dupeKey(c.failure))?.expected) L.push(`- _${EXPECTED[sessionIsArabic(session, events) ? 'ar' : 'en']}_`);
      L.push('');
    });
  }

  L.push(`## ${W.hSteps}`);
  L.push('');
  const steps = mdReproSteps(events);
  L.push(steps.length ? steps.join('\n') : `_${W.mNoInteractions}_`);
  L.push('');

  const notes = events.filter(isTesterNote);
  if (notes.length) {
    L.push(`## ${W.hNotes}`);
    L.push('');
    /*
     * Grouped by the tag the tester chose.
     *
     * The tag is recorded, stored, kept by the JSON export and grouped by the
     * session sheet — and was dropped by exactly one format: Markdown, which is
     * the one most people paste into a ticket, and the one place where the
     * difference between a bug and a question matters most.
     *
     * Same order as the session sheet, so the two documents read alike.
     */
    const GROUPS = [
      ['bug', W.mBugs],
      ['issue', W.mIssues],
      ['question', W.mQuestions],
      [null, W.mNotes],
    ];
    for (const [tag, heading] of GROUPS) {
      const rows = notes.filter((n) => (n.tag || null) === tag);
      if (!rows.length) continue; // a tag with no notes must not leave an empty heading
      L.push(`### ${heading}`);
      L.push('');
      rows.forEach((n) => L.push(`- \`${ts(n.ts, origin)}\` ${mdTester(n.text)}`));
      L.push('');
    }
    L.push('');
  }

  const shots = events.filter((e) => e.kind === 'screenshot');
  if (shots.length) {
    // The budget, not every picture. See `inlinePlan()` above for why a report
    // that carried all of them stopped being a report.
    const plan = inlinePlan(shots, captures);
    const linked = shots.filter((s) => !plan.get(s.captureId)?.inline).length;
    L.push(`## ${W.hShots}`);
    L.push('');
    if (linked) {
      L.push(
        `${shots.length - linked} of ${shots.length} screenshot${shots.length === 1 ? '' : 's'} ${shots.length - linked === 1 ? 'is' : 'are'} embedded below. ` +
          'The rest are named instead, and the files are saved beside this report, so it stays a file you can open.'
      );
      L.push('');
    }
    shots.forEach((s, i) => {
      const entry = plan.get(s.captureId);
      L.push(`**${i + 1}.** \`${ts(s.ts, origin)}\`${s.text ? `: ${mdEsc(s.text)}` : ''}`);
      if (entry?.inline) L.push(`\n![screenshot ${i + 1}](${entry.dataUrl})\n`);
      else L.push(`\n${describeOmitted(entry, i + 1)}\n`);
    });
  }

  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  if (a11y) {
    L.push(`## ${W.hA11y}`);
    L.push('');
    L.push(`Scanned ${mdCell(a11y.url)} with axe-core: **${a11y.total} issue${a11y.total === 1 ? '' : 's'}** across ${a11y.violations.length} rule${a11y.violations.length === 1 ? '' : 's'}.`);
    L.push('');
    L.push('| Impact | Rule | Elements | Issue |');
    L.push('|---|---|---|---|');
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    [...a11y.violations]
      .sort((x, y) => (order[x.impact] ?? 9) - (order[y.impact] ?? 9))
      .forEach((v) => L.push(`| ${mdEsc(v.impact || 'n/a')} | ${mdCode(v.id, true)} | ${v.count} | ${mdEsc(v.help)} |`));
    L.push('');
    L.push(`_${W.mA11yNote}_`);
    L.push('');
  }

  L.push(`## ${W.mTimeline}`);
  L.push('');
  events.forEach((e) => L.push(`- ${describe(e, origin)}`));
  L.push('');

  if (session.cookies?.length) {
    L.push(`## ${W.mCookies}`);
    L.push('');
    L.push(`| ${W.mName} | ${W.mDomain} | ${W.mPath} | HttpOnly | Secure | SameSite |`);
    L.push('|---|---|---|---|---|---|');
    session.cookies.forEach((c) =>
      L.push(`| ${mdEsc(c.name)} | ${mdEsc(c.domain)} | ${mdEsc(c.path)} | ${c.httpOnly} | ${c.secure} | ${mdEsc(c.sameSite)} |`)
    );
    L.push('');
    L.push(`_${W.mCookieNote}_`);
    L.push('');
  }

  L.push('---');
  L.push('');
  // No full stop after `docFooter()`: `copyright()` already ends in one, and
  // the two together printed "Released under the MIT licence.. Nothing in this report..."
  // at the foot of every exported report.
  L.push(`_${docFooter({ session })} ${W.mLeft}_`);
  // Invisible when rendered, plainly there in the source, preserved by every
  // Markdown implementation — and the thing an agent greps for.
  L.push('');
  L.push(embed.markdown({ session, kind: 'bug-report' }));
  return L.join('\n');
}

export function buildJson(session, events, captures = {}) {
  return JSON.stringify(
    {
      _provenance: provenance({ session, kind: 'session-json' }),
      tool: MAKER.product,
      owner: MAKER.owner,
      // Stamped from the manifest by the worker rather than typed here: this
      // literal said 0.6.0 in a 1.9.0 build.
      generatedAt: new Date().toISOString(),
      session,
      correlatedFailures: correlate(events).map((c) => ({
        trigger: c.trigger,
        failure: c.failure,
        siblings: c.siblings,
        gapMs: c.gapMs,
        confidence: c.confidence,
      })),
      reproSteps: reproSteps(events, byPageOf(session, events)),
      // Distinct problems, the one number every screen, the Markdown row, session.json and the agent handoff print (core/finding-count.js).
      problems: problemCounts(events).groups,
      problemsBreakdown: { unit: 'distinct problems (repeats folded)', occurrences: problemCounts(events).events, afterNoiseRules: headline(events, session).problems, toolFindings: headline(events, session).tool },
      ruleset: visibleProblems(events).ruleset,
      // AUTO-5: groups the tester marked "Not a bug". Still counted above and still listed in `events`.
      markedExpected: groupFailures(events).filter((g) => g.expected).map((g) => g.key),
      // Raw events, every one kept. `derived` is computed at export time, never stored;
      // `suppressedReason` names why a Note or an Induced event is not counted as a problem.
      events: events.map((e) => {
        const { c, r } = classify(e);
        return { ...e, derived: { c, r }, ...(c === 'N' || c === 'X' ? { suppressedReason: r } : {}) };
      }),
      captures,
    },
    null,
    2
  );
}

export function buildSessionSheet(session, events) {
  const L = [embed.markdown({ session, kind: 'session-sheet' }), ''];
  const notes = events.filter(isTesterNote);
  const tagged = (tag) => notes.filter((n) => n.tag === tag);
  const bugs = tagged('bug');
  const issues = tagged('issue');
  const questions = tagged('question');
  const plain = notes.filter((n) => !n.tag);

  const endedAt = session.endedAt || Date.now();
  const actualMinutes = Math.max(1, Math.round((endedAt - session.startedAt) / 60000));
  const at = (t) => `+${Math.floor((t - session.startedAt) / 60000)}m`;

  L.push('# Session sheet');
  L.push('');

  L.push('## CHARTER');
  L.push('');
  L.push(session.charter ? mdEsc(session.charter) : '_none recorded_');
  L.push('');

  L.push('## START');
  L.push('');
  L.push(new Date(session.startedAt).toISOString());
  L.push('');

  L.push('## DURATION');
  L.push('');
  if (session.timeboxMinutes) {
    const over = actualMinutes - session.timeboxMinutes;
    L.push(
      `${durationBand(actualMinutes)}: ${actualMinutes} min actual against a ${session.timeboxMinutes} min time-box` +
        (over > 0 ? ` (**${over} min over**)` : over < 0 ? ` (${-over} min under)` : ' (on time)')
    );
  } else {
    L.push(`${durationBand(actualMinutes)}: ${actualMinutes} min`); // r7-14-3: no time-box wording when none was set; the stored field stays
  }
  L.push('');

  L.push('## TASK BREAKDOWN');
  L.push('');
  const b = session.breakdown;
  if (b) {
    L.push('| Activity | % |');
    L.push('|---|---|');
    L.push(`| Test design and execution | ${b.design ?? 0} |`);
    L.push(`| Bug investigation and reporting | ${b.bugs ?? 0} |`);
    L.push(`| Session setup | ${b.setup ?? 0} |`);
    L.push('');
    L.push(`Charter / opportunity: **${b.charter ?? 100} / ${100 - (b.charter ?? 100)}**`);
    L.push('');
    L.push('_Self-reported by the tester at the end of the session, as SBTM intends._');
  } else {
    L.push('_Not reported. SBTM asks the tester to estimate this at the end of the session._');
  }
  L.push('');

  L.push('## AREAS COVERED');
  L.push('');
  const areas = areasCovered(events);
  if (areas.length) {
    areas.forEach((a) => L.push(`- ${mdCell(a.url)} _(${a.hits} event${a.hits === 1 ? '' : 's'})_`));
  } else {
    L.push('_No pages recorded._');
  }
  L.push('');
  if (session.env) {
    L.push(`Environment: ${mdEsc(session.env.viewport || '—')}, ${mdEsc(session.env.language || '—')}, dir=${mdEsc(session.env.dir || '—')}`);
    L.push('');
  }

  L.push('## BUGS');
  L.push('');
  if (bugs.length) bugs.forEach((n) => L.push(`- \`${at(n.ts)}\` ${mdEsc(n.text)}`));
  else L.push('_None flagged by the tester._');
  L.push('');

  const machineFound = correlate(events);
  if (machineFound.length) {
    L.push(`QA Wrap also correlated **${machineFound.length}** failure${machineFound.length === 1 ? '' : 's'} the tester did not flag by hand:`);
    L.push('');
    machineFound.forEach((c) =>
      L.push(`- ${describe(c.failure, session.startedAt).replace(/^`[^`]+`\s*/, '')}${c.trigger ? `, after ${mdDom(c.trigger, false)}` : ''}`)
    );
    L.push('');
  }

  L.push('## ISSUES');
  L.push('');
  if (issues.length) issues.forEach((n) => L.push(`- \`${at(n.ts)}\` ${mdEsc(n.text)}`));
  else L.push('_None raised._');
  L.push('');

  if (questions.length) {
    L.push('## QUESTIONS');
    L.push('');
    questions.forEach((n) => L.push(`- \`${at(n.ts)}\` ${mdEsc(n.text)}`));
    L.push('');
  }

  L.push('## TEST NOTES');
  L.push('');
  if (plain.length) plain.forEach((n) => L.push(`- \`${at(n.ts)}\` ${mdEsc(n.text)}`));
  else L.push('_No free-form notes._');
  L.push('');

  L.push('## SESSION METRICS');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Steps recorded | ${events.filter((e) => e.kind === 'dom').length} |`);
  L.push(`| Requests observed | ${events.filter((e) => e.kind === 'net').length} |`);
  L.push(`| Failures correlated | ${machineFound.length} |`);
  L.push(`| Screenshots | ${events.filter((e) => e.kind === 'screenshot').length} |`);
  L.push(`| Test data injected | ${events.filter((e) => e.kind === 'inject').length} |`);
  L.push('');

  L.push('---');
  L.push('');
  L.push(`_${docFooter({ session })} Nothing left the machine._`);
  return L.join('\n');
}
