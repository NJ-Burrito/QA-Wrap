/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The documentation pack: a requirements specification, a user manual and a
 * video storyboard, all written from one recorded session.
 *
 * None of these is the finished document. A recording shows what the product
 * *did*; a specification says what it *should* do, and only a person knows
 * the difference. So every derived statement is marked with where it came
 * from — OBSERVED (the recording saw it), DERIVED (it follows from what was
 * seen), GAP (nobody knows yet) — and the reader is told, at the top, that the
 * marks are the point. A draft that is honest about its own gaps saves a day;
 * one that hides them costs a week.
 *
 * Two audiences, one set of facts:
 *   - people read `srs.md`, `manual.md`, `storyboard.html`;
 *   - a machine reads `storyboard.json` (scenes, narration, timings) and the
 *     same requirements as a table in the page map's JSON style.
 */

import { isTesterNote } from './events.js';
import { correlate, reproSteps, areasCovered, isFailure, inlinePlan, describeOmitted } from './artifact.js';
import { MAKER } from './provenance.js';
import { byPageOf } from './artifact-docs.js';
import { problemCounts } from './finding-count.js';
import { shell, mdEsc, mdCell, escHtml as esc } from './docshell.js';
import { mdToHtml } from './mdhtml.js';

const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
const host = (url) => { try { return new URL(url).host; } catch { return url || ''; } };
const plus = (t, origin) => `+${Math.max(0, Math.round((t - origin) / 1000))}s`;

function lastOf(events, kind) {
  return [...events].reverse().find((e) => e.kind === kind) || null;
}

/**
 * The steps, each with the screenshots taken just after it, so a manual can
 * illustrate itself.
 *
 * The pictures are spent against the document's budget in the order they were
 * taken, by the same `inlinePlan()` the bug report uses: a manual that embedded
 * every capture at full size is how `research/54` found a 13.7 MB Markdown
 * file. A step whose screenshot did not fit keeps the screenshot in its list
 * with `dataUrl: null` and a sentence in `omitted`, so the document can say
 * "the picture is in the folder" rather than showing a gap.
 */
function illustratedSteps(session, events, captures = {}) {
  const acts = events.filter((e) => e.kind === 'dom' || e.kind === 'nav');
  const texts = reproSteps(events, byPageOf(session, events)).map((s) => s.replace(/^\d+\.\s*/, ''));
  const shots = events.filter((e) => e.kind === 'screenshot');
  const fails = events.filter(isFailure);
  const plan = inlinePlan(shots, captures);
  const ordinal = new Map(shots.map((s, i) => [s.captureId, i + 1]));
  return acts.map((a, i) => {
    const next = acts[i + 1]?.ts ?? Infinity;
    return {
      n: i + 1,
      ts: a.ts,
      at: plus(a.ts, session.startedAt),
      text: texts[i] || '',
      url: a.kind === 'nav' ? a.url : a.frameUrl,
      screenshots: shots.filter((s) => s.ts >= a.ts && s.ts < next).map((s) => {
        const entry = plan.get(s.captureId);
        return {
          id: s.captureId,
          text: s.text || '',
          dataUrl: entry?.inline ? entry.dataUrl : null,
          // "Not exported at all" and "exported but too big to embed" are two
          // different facts, and only the second one is worth a sentence about
          // the folder. A capture the worker never handed over keeps the
          // manual's own line, which names the step it belongs to.
          omitted: entry && !entry.inline && !entry.missing ? describeOmitted(entry, ordinal.get(s.captureId) || 1) : null,
        };
      }),
      failures: fails.filter((f) => f.ts >= a.ts && f.ts < next),
    };
  });
}

/* ── SRS ───────────────────────────────────────────────────────────────── */

export function buildSrs(session, events) {
  const areas = areasCovered(events);
  const steps = illustratedSteps(session, events);
  const chains = correlate(events);
  const perf = lastOf(events, 'perf');
  const a11y = lastOf(events, 'a11y');
  const harvest = lastOf(events, 'harvest');
  const links = lastOf(events, 'links');
  const notes = events.filter(isTesterNote);
  const questions = notes.filter((n) => n.tag === 'question');
  const env = session.env || {};
  const product = host(session.startUrl) || 'the application';
  const L = [];
  const reqs = [];
  const add = (id, text, source, status) => { reqs.push({ id, text, source, status }); return `- **${id}** ${text} _(${source}; ${status})_`; };

  L.push(`# Software Requirements Specification: ${session.charter}`);
  L.push('');
  L.push(`Derived from a recorded session on ${product}, ${when(session.startedAt)}, by ${MAKER.full}. Shaped after ISO/IEC/IEEE 29148.`);
  L.push('');
  L.push('> **How to read this.** Every requirement carries its source and a status. OBSERVED means the recording saw the behaviour; DERIVED means it follows from what was seen; GAP means the recording could not know and a person must decide. A specification is finished when no GAP remains.');
  L.push('');
  L.push('## 1. Introduction');
  L.push('');
  L.push(`**1.1 Purpose.** Describe the behaviour of ${product} as exercised under the charter "${session.charter}", so that it can be reviewed, agreed and tested.`);
  L.push('');
  L.push(`**1.2 Scope.** ${areas.length} area${areas.length === 1 ? '' : 's'} of the product:`);
  for (const a of areas) L.push(`- ${mdCell(a.url)}: ${a.hits} event${a.hits === 1 ? '' : 's'}`);
  L.push('');
  L.push('**1.3 Definitions.** *Session*: one recorded walk under one charter. *Failure*: a 5xx response, a console error or an uncaught page error. *Cause*: the user action within the causal window before a failure.');
  L.push('');
  L.push('## 2. Overall description');
  L.push('');
  L.push(`**2.1 Product perspective.** A web application reached at ${session.startUrl || 'the recorded URL'}.`);
  L.push(`**2.2 Operating environment (observed).** ${[env.platform, env.viewport, env.language, env.userAgent ? env.userAgent.slice(0, 80) : null].filter(Boolean).join(' · ') || 'not recorded'}.`);
  L.push(`**2.3 User classes.** GAP: the recording shows one tester; the roles the product serves must be named by the product owner.`);
  L.push('');
  L.push('## 3. Functional requirements');
  L.push('');
  let n = 1;
  const byUrl = new Map();
  for (const s of steps) {
    const key = host(s.url) + (s.url ? new URL(s.url).pathname : '');
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(s);
  }
  for (const [page, list] of byUrl) {
    L.push(`### 3.${n} ${mdEsc(page) || 'Unknown page'}`);
    L.push('');
    for (const s of list) {
      const failed = s.failures.length > 0;
      L.push(add(`FR-${String(n).padStart(2, '0')}.${s.n}`, `The system shall allow the user to ${mdEsc(s.text.replace(/^[A-Z]/, (c) => c.toLowerCase()))}.`, `step ${s.n} at ${s.at}`, failed ? 'OBSERVED: FAILED' : 'OBSERVED'));
    }
    L.push('');
    n++;
  }
  if (harvest?.forms?.length) {
    L.push(`### 3.${n} Forms (from the page map)`);
    L.push('');
    const byN = new Map((harvest.elements || []).map((e) => [e.n, e]));
    for (const f of harvest.forms) {
      const fields = f.fields.map((i) => byN.get(i)).filter(Boolean);
      L.push(add(`FR-F${f.n + 1}`, `The "${mdEsc(f.name)}" form shall accept ${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.map((e) => mdEsc(e.label || e.name || e.tag)).join(', ') || 'none'}.`, 'page map', 'OBSERVED'));
      for (const e of fields.filter((x) => x.required)) L.push(add(`FR-F${f.n + 1}.${e.n}`, `"${mdEsc(e.label || e.name)}" shall be required; the form shall not submit without it and shall say which field is missing.`, 'page map: required attribute', 'DERIVED'));
    }
    L.push('');
    n++;
  }
  if (chains.length) {
    L.push(`### 3.${n} Behaviour under failure`);
    L.push('');
    for (const c of chains) {
      const f = c.failure;
      const what = f.kind === 'net' ? `${f.method} ${mdCell(f.url)} returned ${f.status}` : mdEsc(f.text || f.kind);
      L.push(add(`FR-E${chains.indexOf(c) + 1}`, `When ${what}, the user shall be told what happened and what to do next, and no data shall be lost. GAP: the intended message is not known from the recording.`, c.trigger ? `caused by "${mdEsc((reproSteps([c.trigger], byPageOf(session, events))[0] || '').replace(/^\d+\.\s*/, ''))}"` : 'no cause within the window', 'OBSERVED: FAILED'));
    }
    L.push('');
    n++;
  }
  L.push('## 4. Non-functional requirements');
  L.push('');
  if (perf?.metrics) {
    const m = perf.metrics;
    L.push(add('NFR-P1', `Largest Contentful Paint shall be ≤ 2.5 s on a typical connection. Observed: ${m.lcp != null ? `${m.lcp} ms` : 'not measured'}.`, 'page speed', m.lcp != null ? (m.lcp <= 2500 ? 'OBSERVED: MET' : 'OBSERVED: NOT MET') : 'GAP'));
    L.push(add('NFR-P2', `Cumulative Layout Shift shall be ≤ 0.1. Observed: ${m.cls ?? 'not measured'}.`, 'page speed', m.cls != null ? (m.cls <= 0.1 ? 'OBSERVED: MET' : 'OBSERVED: NOT MET') : 'GAP'));
    L.push(add('NFR-P3', `Interaction to Next Paint shall be ≤ 200 ms. Observed: ${m.inp != null ? `${m.inp} ms` : 'not measured'}.`, 'page speed', m.inp != null ? (m.inp <= 200 ? 'OBSERVED: MET' : 'OBSERVED: NOT MET') : 'GAP'));
  } else {
    L.push(add('NFR-P1', 'Page speed thresholds (LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms) shall be met.', 'not measured in this session', 'GAP'));
  }
  L.push(add('NFR-A1', `The product shall conform to WCAG 2.2 level AA. Observed: ${a11y ? `${a11y.total} issue(s) across ${a11y.violations.length} rule(s) by axe-core` : 'not scanned in this session'}.`, 'accessibility scan', a11y ? (a11y.total ? 'OBSERVED: NOT MET' : 'OBSERVED: MET (automated checks)') : 'GAP'));
  L.push(add('NFR-L1', `Every link on the page shall resolve. Observed: ${links ? `${links.broken.length} broken of ${links.total}` : 'not checked'}.`, 'link check', links ? (links.broken.length ? 'OBSERVED: NOT MET' : 'OBSERVED: MET') : 'GAP'));
  L.push(add('NFR-I1', `The product shall render correctly right-to-left and in Arabic where offered. ${harvest?.dir === 'rtl' ? 'The page is RTL.' : 'The recorded page is LTR.'}`, 'page map', 'GAP'));
  L.push(add('NFR-R1', 'No user action shall produce a 5xx response or an uncaught error.', 'failure log', chains.length ? 'OBSERVED: NOT MET' : 'OBSERVED: MET'));
  L.push('');
  L.push('## 5. Verification');
  L.push('');
  L.push('| Requirement | Verified by | Status |');
  L.push('|---|---|---|');
  for (const r of reqs) L.push(`| ${r.id} | ${r.source} | ${r.status} |`);
  L.push('');
  if (questions.length) {
    L.push('## 6. Open questions (from the tester)');
    L.push('');
    for (const q of questions) L.push(`- ${mdEsc(q.text)} _(${plus(q.ts, session.startedAt)})_`);
    L.push('');
  }
  L.push('---');
  L.push(`${reqs.length} requirements; ${reqs.filter((r) => /GAP/.test(r.status)).length} marked GAP. Generated by ${MAKER.full}; session \`${session.id}\`.`);
  L.push('');
  return L.join('\n');
}

/* ── the user manual ───────────────────────────────────────────────────── */

export function buildManual(session, events, captures = {}) {
  const steps = illustratedSteps(session, events, captures);
  const chains = correlate(events);
  const harvest = lastOf(events, 'harvest');
  const product = host(session.startUrl) || 'the application';
  const L = [];

  L.push(`# User manual: ${session.charter}`);
  L.push('');
  L.push(`How to ${session.charter.replace(/^[A-Z]/, (c) => c.toLowerCase())} on ${product}, written from a recorded walkthrough on ${when(session.startedAt)}. Screenshots are the screens as they were that day.`);
  L.push('');
  L.push('> Draft. Steps are what the tester did; wording is derived. Check each step against the intended flow before publishing.');
  L.push('');
  L.push('## Before you start');
  L.push('');
  L.push(`- Open ${mdCell(session.startUrl || product)} in a current browser.`);
  if (session.env?.viewport) L.push(`- The screenshots were taken at ${session.env.viewport}; the layout may differ on a phone.`);
  L.push('- Have your details ready. The form fields are listed at the end.');
  L.push('');
  L.push('## Step by step');
  L.push('');
  for (const s of steps) {
    L.push(`### ${s.n}. ${mdEsc(s.text)}`);
    L.push('');
    for (const shot of s.screenshots) {
      if (shot.dataUrl) L.push(`![${mdEsc(shot.text || `Step ${s.n}`)}](${shot.dataUrl})`);
      else L.push(shot.omitted || `_Screenshot: ${mdEsc(shot.text || `step ${s.n}`)} (saved with the session)_`);
      L.push('');
    }
    if (s.failures.length) {
      L.push(`> ⚠ On the day this was recorded, this step produced ${s.failures.length} error${s.failures.length === 1 ? '' : 's'}. See "If something goes wrong".`);
      L.push('');
    }
  }
  L.push('## If something goes wrong');
  L.push('');
  if (!chains.length) L.push('Nothing went wrong in the recorded walkthrough. Add the known error states here.');
  for (const c of chains) {
    const f = c.failure;
    const what = f.kind === 'net' ? `the request to ${mdEsc((() => { try { return new URL(f.url).pathname; } catch { return f.url; } })())} fails (${f.status})` : `an error appears: "${mdEsc((f.text || '').slice(0, 80))}"`;
    L.push(`- **If ${what}** after "${c.trigger ? mdEsc((reproSteps([c.trigger], byPageOf(session, events))[0] || '').replace(/^\d+\.\s*/, '')) : 'a step'}": wait a moment and try again. If it happens twice, contact support and quote the time and the page you were on.`);
  }
  L.push('');
  if (harvest?.forms?.length) {
    L.push('## The fields');
    L.push('');
    const byN = new Map((harvest.elements || []).map((e) => [e.n, e]));
    for (const f of harvest.forms) {
      L.push(`**${mdEsc(f.name)}**`);
      L.push('');
      L.push('| Field | Required | Notes |');
      L.push('|---|---|---|');
      for (const i of f.fields) {
        const e = byN.get(i);
        if (!e) continue;
        L.push(`| ${mdEsc(e.label || e.name || e.tag)} | ${e.required ? 'yes' : 'no'} | ${e.placeholder ? `e.g. ${mdEsc(e.placeholder)}` : e.type ? mdEsc(e.type) : ''} |`);
      }
      L.push('');
    }
  }
  L.push('---');
  L.push(`Generated by ${MAKER.full} from session \`${session.id}\`.`);
  L.push('');
  return L.join('\n');
}

/* ── the storyboard ────────────────────────────────────────────────────── */

/** Scenes for a walkthrough video: title, one per step, one per failure, outro. */
export function storyboardScenes(session, events, captures = {}) {
  const steps = illustratedSteps(session, events, captures);
  const product = host(session.startUrl) || 'the application';
  const scenes = [];
  let t = 0;
  const push = (scene, seconds) => { scenes.push({ n: scenes.length + 1, startSec: t, durationSec: seconds, ...scene }); t += seconds; };

  push({ kind: 'title', onScreen: session.charter, narration: `${session.charter}. A short walkthrough on ${product}.`, action: 'Title card over the first screen.', screenshot: steps[0]?.screenshots[0]?.id || null }, 4);
  for (const s of steps) {
    const shot = s.screenshots[0] || null;
    push({
      kind: 'step',
      step: s.n,
      onScreen: s.text,
      narration: `Step ${s.n}. ${s.text}.`,
      action: s.url && s.n === 1 ? `Open ${s.url}.` : `Highlight the control; ${s.text.replace(/^[A-Z]/, (c) => c.toLowerCase())}.`,
      screenshot: shot?.id || null,
      url: s.url || null,
    }, Math.max(3, Math.min(8, 2 + Math.ceil(s.text.length / 25))));
    for (const f of s.failures) {
      push({
        kind: 'failure',
        step: s.n,
        onScreen: f.kind === 'net' ? `${f.method} ${f.url} → ${f.status}` : (f.text || 'Error').slice(0, 100),
        narration: 'Here the application failed. This is what the user saw, and what the ticket describes.',
        action: 'Zoom on the error; show the network panel or console line.',
        screenshot: s.screenshots[1]?.id || shot?.id || null,
      }, 5);
    }
  }
  push({ kind: 'outro', onScreen: `${steps.length} step${steps.length === 1 ? '' : 's'} · ${problemCounts(events).groups} problem${problemCounts(events).groups === 1 ? '' : 's'}`, narration: `That is the whole flow. Recorded with ${MAKER.full}.`, action: 'Summary card.', screenshot: null }, 4);
  return { scenes, totalSec: t };
}

/**
 * Which of a storyboard's frames the file may carry, in scene order.
 *
 * A thin wrapper over `inlinePlan()` so both storyboard builders spend the same
 * budget on the same frames: the JSON and the HTML are read side by side, and a
 * scene that has a picture in one and not the other is a document nobody
 * trusts.
 */
function storyboardInlinePlan(scenes, captures) {
  return inlinePlan(scenes.filter((s) => s.screenshot).map((s) => ({ captureId: s.screenshot })), captures);
}

export function buildStoryboard(session, events, captures = {}) {
  const { scenes, totalSec } = storyboardScenes(session, events, captures);
  const storyPlan = storyboardInlinePlan(scenes, captures);
  return JSON.stringify(
    {
      generator: MAKER.full,
      title: session.charter,
      product: host(session.startUrl),
      recordedAt: new Date(session.startedAt).toISOString(),
      language: session.env?.language || 'en',
      voice: { tone: 'calm, plain, second person', pace: 'about 140 words a minute', avoid: ['exclamation marks', 'marketing words', 'saying "simply"'] },
      aspect: session.env?.viewport ? `${session.env.viewport}` : '16:9',
      totalSec,
      /*
       * The same budget as every other document, for the same reason.
       *
       * `research/54` measured this file at 22.2 MB and its HTML twin at
       * 29.9 MB, both of them one base64 screenshot per scene. A generator
       * reading the JSON wants the scene list; the picture is a convenience,
       * and a convenience that stops the file being parseable is not one.
       */
      scenes: scenes.map((s) => {
        const entry = s.screenshot ? storyPlan.get(s.screenshot) : null;
        return { ...s, image: entry?.inline ? entry.dataUrl : undefined };
      }),
    },
    null,
    2
  );
}

export function buildStoryboardHtml(session, events, captures = {}, assets = {}) {
  const { scenes, totalSec } = storyboardScenes(session, events, captures);
  const storyPlan = storyboardInlinePlan(scenes, captures);
  const card = (s) => {
    const entry = s.screenshot ? storyPlan.get(s.screenshot) : null;
    const img = entry?.inline
      ? `<img src="${entry.dataUrl}" alt="">`
      : `<div class="blank">${s.screenshot ? 'the frame is in the Screenshots folder' : 'no screenshot'}</div>`;
    return `<article class="scene ${s.kind}">
  <header><span class="n">${s.n}</span><span class="tag ${s.kind === 'failure' ? 'bad' : ''}">${s.kind}</span><span class="t">${s.startSec}s · ${s.durationSec}s</span></header>
  ${img}
  <p class="on">${esc(s.onScreen)}</p>
  <p class="say"><b>Narration</b> ${esc(s.narration)}</p>
  <p class="do"><b>Action</b> ${esc(s.action)}</p>
</article>`;
  };
  const body = `<style>
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .scene{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;break-inside:avoid}
  .scene header{display:flex;gap:8px;align-items:center;padding:8px 12px;font-size:12px;color:var(--soft);border-bottom:1px solid var(--line)}
  .scene .n{font-weight:800;color:var(--ink)} .scene .t{margin-inline-start:auto}
  .scene.failure header{background:color-mix(in srgb,var(--bad) 12%,transparent)} .scene.title header,.scene.outro header{background:var(--band)}
  .scene img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;margin:0;border:0;border-radius:0}
  .blank{aspect-ratio:16/10;display:grid;place-items:center;color:var(--soft);background:var(--band);font-size:12px}
  .scene p{margin:0;padding:8px 12px;font-size:13px;line-height:1.45} .on{font-weight:600} .say,.do{color:var(--soft);border-top:1px solid var(--line)}
</style>
<h2 id="scenes">Scenes</h2>
<p>${scenes.length} scenes · about ${Math.round(totalSec)} s · the JSON beside this file carries the same scenes for a video generator.</p>
<div class="grid">${scenes.map(card).join('\n')}</div>`;
  return shell({
    title: session.charter,
    kind: 'Video storyboard',
    subtitle: `${esc(host(session.startUrl))} &middot; recorded ${when(session.startedAt)}`,
    body,
    headings: [{ level: 2, text: 'Scenes', id: 'scenes' }],
    legend: [
      { colour: 'var(--bad)', text: 'Petra red: a scene where the application failed; zoom on the error.' },
      { shape: '4s', text: 'Seconds: when the scene starts, and how long it holds.' },
      { shape: 'Say', text: 'Narration: read at about 140 words a minute, plain, second person.' },
      { shape: 'Do', text: 'Action: what the camera or cursor does while the narration plays.' },
    ],
    lockup: assets.lockup,
  });
}

/**
 * Colour the status marks in the rendered specification.
 *
 * The class is chosen by the *status token* — FAILED, NOT MET, MET, or
 * nothing — never by the punctuation in front of it. The first version of this
 * matched `OBSERVED — NOT MET` literally; when the copy sweep turned every em
 * dash into a colon (see the statuses emitted above), that branch stopped
 * matching, and `OBSERVED: NOT MET` fell through to the bare-OBSERVED rule,
 * which `docshell.js` paints `var(--ok)`. A failed requirement rendered green in
 * an exported specification, which is the one thing this document must never do.
 * The separator below is optional and may be a colon, an em or en dash or a
 * hyphen, so the next punctuation sweep cannot repaint a failure as a pass.
 */
const STATUS_TOKEN = /\bOBSERVED\b(?:\s*[:—–-]\s*(NOT MET|FAILED|MET)\b)?/g;
const BAD_TOKENS = new Set(['FAILED', 'NOT MET']);

/**
 * OBSERVED / GAP / MANUAL / DERIVED marks wrapped in the classes `docshell.js` colours.
 *
 * MANUAL joined the vocabulary with the fine-print block and was not painted
 * here, which is not a cosmetic omission: an unpainted word is the same black
 * as the sentence around it, so the one status that means *nobody measured
 * this* read as ordinary prose beside a green OBSERVED and an amber GAP. A row
 * nobody could check must never be the quietest thing on the page.
 */
export function paintStatuses(html) {
  return html
    .replace(STATUS_TOKEN, (whole, token) => `<span class="${BAD_TOKENS.has(token) ? 'status-FAILED' : 'status-OBSERVED'}">${whole}</span>`)
    .replace(/\bGAP\b/g, '<span class="status-GAP">GAP</span>')
    .replace(/\bMANUAL\b/g, '<span class="status-MANUAL">MANUAL</span>')
    .replace(/\bDERIVED\b/g, '<span class="tag">DERIVED</span>');
}

/** The specification and the manual as pages, through the same shell as the report. */
export function buildSrsHtml(session, events, assets = {}) {
  const { html, headings } = mdToHtml(buildSrs(session, events));
  const gaps = (html.match(/GAP/g) || []).length;
  return shell({
    title: `Requirements: ${session.charter}`,
    kind: 'Software requirements specification · ISO/IEC/IEEE 29148 shape',
    subtitle: `${esc(host(session.startUrl))} &middot; derived from the session of ${when(session.startedAt)}`,
    verdict: gaps ? { tone: 'bad', text: `${gaps} GAP${gaps === 1 ? '' : 'S'} to decide` } : { tone: 'ok', text: 'no gaps' },
    body: paintStatuses(html),
    headings,
    legend: [
      { colour: 'var(--ok)', text: 'OBSERVED: the recording saw this behaviour; MET when a measured value passed its threshold.' },
      { colour: 'var(--bad)', text: 'FAILED / NOT MET, observed and wrong: a 5xx, an error, a threshold missed.' },
      { colour: 'var(--warn)', text: 'GAP: the recording could not know; a person decides, and the mark goes away.' },
      { shape: 'FR', text: 'FR-n functional; NFR-n non-functional; FR-F from a form on the page map; FR-E behaviour under failure.' },
    ],
    lockup: assets.lockup,
  });
}

export function buildManualHtml(session, events, captures = {}, assets = {}) {
  const { html, headings } = mdToHtml(buildManual(session, events, captures));
  return shell({
    title: `How to ${session.charter.replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
    kind: 'User manual · draft from a recorded walkthrough',
    subtitle: `${esc(host(session.startUrl))} &middot; screens as they were on ${when(session.startedAt).slice(0, 10)}`,
    body: html,
    headings,
    legend: [
      { shape: '1.', text: 'Numbered steps: exactly what the tester did, in order; each with the screen as it looked.' },
      { colour: 'var(--corn)', text: 'A note in a box: something to check before publishing this page.' },
      { colour: 'var(--bad)', text: 'A warning: this step produced an error on the day; see "If something goes wrong".' },
    ],
    lockup: assets.lockup,
  });
}

/* ── the session manifest, for a shared folder ─────────────────────────── */

export function buildSessionManifest(session, events, { tester = '', version = '', files = [], checksums = {} } = {}) {
  const fails = events.filter(isFailure);
  return JSON.stringify(
    {
      generator: `${MAKER.full} ${version}`.trim(),
      id: session.id,
      charter: session.charter,
      tester: tester || undefined,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      url: session.startUrl,
      host: host(session.startUrl),
      env: session.env || undefined,
      counts: {
        events: events.length,
        interactions: events.filter((e) => e.kind === 'dom').length,
        requests: events.filter((e) => e.kind === 'net').length,
        problems: problemCounts(events).groups, // 1011 B5: distinct problems; `failures` below is the raw count
        failures: fails.length,
        /*
         * What is in the folder, not what was taken.
         *
         * Nader's own session of 7 September 2026 said `"screenshots": 7` on a
         * card sitting beside six PNGs (`research/54-real-session-review.md`,
         * finding 13). Both numbers were true of something: seven screenshot
         * events happened, and six files were written. The seventh was a
         * marked-up copy made after the session had stopped
         * (`c_mtr7xv8s_j4ll`, 12:30:22Z) which the report page's save loop had
         * not picked up.
         *
         * A manifest that ships beside the files has to describe the files. It
         * lists them in `files` already, so the count comes from there and the
         * two halves of this document can no longer disagree. The event count
         * is kept as the fallback for a manifest written without a file list.
         *
         * The save-loop half is Group F's: see the routing note in Group G's
         * report of the same day.
         */
        screenshots: files.length
          ? files.filter((f) => /(^|\/)Screenshots\//.test(String(f))).length
          : events.filter((e) => e.kind === 'screenshot').length,
        notes: events.filter(isTesterNote).length,
      },
      verdict: fails.length ? 'failures' : 'clean',
      files,
      // T-066: SHA-256 per stored screenshot (capture id -> hex). A checksum, not a signature.
      checksums: Object.keys(checksums).length ? checksums : undefined,
      savedAt: new Date().toISOString(),
    },
    null,
    2
  );
}
