/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The workflow diagram: a session read as a flow, laid out on one A4 page.
 *
 * What a recording knows is a sequence — this page, that click, those fields,
 * a request that failed. Read as a flowchart that sequence is: a start, one
 * box per thing the user did, a decision wherever the application answered,
 * a red box where it answered wrongly, an end. The user story beside it says
 * the same thing in the tester's language, Arabic first.
 *
 * Fixed decisions, on purpose:
 *   - the canvas is A4 landscape, always (297 × 210 mm at 96 dpi = 1123 × 794);
 *   - the flow runs left to right, top to bottom, always — a workflow reads
 *     in one direction whatever language its labels are in;
 *   - the text inside is Arabic, right-to-left, with English under it small;
 *   - every colour, shape and arrow used is explained in the legend footer,
 *     built from what is actually on the page — never a legend for things
 *     that are not there.
 *
 * `buildFlow()` makes the model from a session; `layout()` places it;
 * `flowToSvg()` draws it. The editor page moves nodes, edits labels and
 * restyles; it writes the same model back, so an edited diagram exports the
 * same way an automatic one does.
 */

import { correlate, isFailure, stepLabel, pathLabel, pageLabel, clampLabel, LABEL_MAX } from './artifact.js';
import { MAKER } from './provenance.js';
import { escHtml as esc } from './docshell.js';

export const A4 = { w: 1123, h: 794 };
export const MM = A4.w / 297;

/*
 * Every label below names 'Thmanyah Sans' first, literally, not through a
 * shared constant: `tools/test-styles.mjs` reads this file's own source text
 * to check the first font-family in every declaration, so a `${}` in its
 * place would read as the family name instead of resolving to one. Thmanyah
 * first (research/56:167-168,194, supersedes decision 135: exports embed the
 * face), the system stack after it for the instant before the embedded
 * `@font-face` in `flowToSvg()`'s `<style>` resolves, and for a caller —
 * `diagram/diagram.js`'s editor page — that draws this SVG inline on a page
 * which never passes the `fonts` option in at all.
 */

export const PALETTE = {
  petra: '#B5432B', guac: '#2A7A3B', corn: '#E2AE38', wadirum: '#8E5A10',
  basalt: '#1D2024', limestone: '#F1EFE9', paper: '#FAF8F4', line: '#DAD6CD', slate: '#7A8188', tortilla: '#D8C6A4', band: '#E8E3D6',
};

/** Node kinds: the shape says what kind of step it is; the colour says how it went. */
export const KINDS = {
  start: { shape: 'terminator', fill: PALETTE.guac, ink: '#FFFFFF', stroke: PALETTE.guac, ar: 'بداية المسار', en: 'start' },
  end: { shape: 'terminator', fill: PALETTE.basalt, ink: '#FFFFFF', stroke: PALETTE.basalt, ar: 'نهاية المسار', en: 'end' },
  page: { shape: 'rect', fill: PALETTE.paper, ink: PALETTE.basalt, stroke: PALETTE.basalt, ar: 'صفحة تم فتحها', en: 'a page opened' },
  process: { shape: 'rect', fill: PALETTE.paper, ink: PALETTE.basalt, stroke: PALETTE.slate, ar: 'إجراء قام به المستخدم', en: 'an action' },
  input: { shape: 'parallelogram', fill: '#F8EFD6', ink: PALETTE.basalt, stroke: PALETTE.corn, ar: 'إدخال بيانات', en: 'data entry' },
  decision: { shape: 'diamond', fill: PALETTE.corn, ink: PALETTE.basalt, stroke: PALETTE.wadirum, ar: 'قرار: هل نجح؟', en: 'a decision' },
  failure: { shape: 'rect', fill: PALETTE.petra, ink: '#FFFFFF', stroke: PALETTE.petra, ar: 'خطأ من النظام', en: 'a failure' },
  note: { shape: 'note', fill: PALETTE.limestone, ink: PALETTE.basalt, stroke: PALETTE.slate, ar: 'ملاحظة المختبِر', en: 'a tester note' },
};

/** Edge kinds: the line says what kind of movement it is. */
export const EDGES = {
  flow: { stroke: PALETTE.basalt, dash: '', ar: 'تسلسل العمل', en: 'the flow, in order' },
  yes: { stroke: PALETTE.guac, dash: '', ar: 'نعم: نجح', en: 'yes: it worked' },
  no: { stroke: PALETTE.petra, dash: '', ar: 'لا: فشل', en: 'no: it failed' },
  request: { stroke: PALETTE.slate, dash: '6 4', ar: 'طلب إلى الخادم', en: 'a request to the server' },
  loop: { stroke: PALETTE.wadirum, dash: '2 3', ring: true, ar: 'تكرار أو إعادة محاولة', en: 'a retry, back to an earlier step' },
};

const NODE = { w: 150, h: 60, gapX: 46, gapY: 46 };

/**
 * Arabic counts its nouns in four shapes, and a sheet that gets this wrong
 * reads as machine output in the first line a reviewer sees.
 *
 * One: the noun alone, feminine agreement (خطوة واحدة). Two: the dual, which is
 * a word, not a numeral (خطوتان, حالتا فشل) — "2 فشل" is not Arabic. Three to
 * ten: the numeral and the plural (5 خطوات). Eleven and up: the numeral and the
 * *singular* (11 خطوة), which is the rule everyone with only English breaks.
 * Zero gets its own words, because "0 فشل" says nothing a person would say.
 */
export function countAr(n, forms) {
  const k = Math.max(0, Math.round(Number(n) || 0));
  if (k === 0) return forms.zero;
  if (k === 1) return forms.one;
  if (k === 2) return forms.two;
  if (k <= 10) return `${k} ${forms.few}`;
  return `${k} ${forms.many}`;
}

export const STEPS_AR = { zero: 'دون خطوات', one: 'خطوة واحدة', two: 'خطوتان', few: 'خطوات', many: 'خطوة' };
export const FAILURES_AR = { zero: 'دون فشل', one: 'حالة فشل واحدة', two: 'حالتا فشل', few: 'حالات فشل', many: 'حالة فشل' };

/*
 * Both of these used to be one-liners here, and both produced labels that ran
 * off the sheet: `pathOf` printed a percent-encoded Arabic path verbatim, and
 * `shortLabel` printed whatever the recorder had, which is a CSS selector when
 * the element has no accessible name and the whole page's text when the
 * keypress was recorded at document level. They are `artifact.js`'s job now,
 * capped to LABEL_MAX so no label can be wider than the box it is drawn in.
 */
const pathOf = (url) => pathLabel(url);
const shortLabel = (ev) => stepLabel(ev);
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Keep a left-to-right run reading left to right inside a right-to-left line.
 *
 * `/api/applications` inside an Arabic sentence renders as `applications/api/`,
 * and a trailing full stop jumps to the far end of the line, because the
 * neutral characters between the two runs take the paragraph's direction. A
 * first-strong isolate (U+2066 … U+2069) gives the run its own paragraph, so
 * the shaper resolves it on its own terms and the punctuation stays put.
 *
 * Whitespace is left outside the isolate: a wrapped isolate that ends a line
 * would otherwise carry the trailing space into the next one.
 *
 * So is a separator that belongs to the Arabic before it. `فشل: 500` was
 * isolated as `فشل` + ⟦: 500⟧, and an isolate with no strong character in it
 * resolves left-to-right, so the colon was drawn at the far end of the line:
 * "فشل500 :". The colon is punctuation belonging to the Arabic word, not the
 * first character of the Latin run, and left in the right-to-left flow it sits
 * where an Arabic reader expects it. Only the separators do this (`:` `،` `؛`
 * `;` `,` `·`); a leading `/` stays inside, because `/api/x` isolated from its
 * slash renders the slash on the wrong side of the path.
 */
/* The same on the other side: a dot between the date and the next Arabic word
   belongs to the Arabic line, not to the date. A trailing full stop is left
   inside, which is what the isolate was written for. */
const TAIL_SEPARATORS = /[\s:،؛;,·]*$/;
const LEAD_SEPARATORS = /^[\s:،؛;,·]*/;
const iso = (t) => {
  const str = String(t ?? '');
  if (!str) return str;
  if (!ARABIC.test(str)) return /[A-Za-z0-9]/.test(str) ? `⁦${str}⁩` : str;
  return str.replace(/[^\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g, (run) => {
    if (!/[A-Za-z0-9]/.test(run)) return run;   // punctuation and spaces alone need no isolate
    const lead = run.match(LEAD_SEPARATORS)[0];
    const tail = run.match(TAIL_SEPARATORS)[0];
    return `${lead}⁦${run.slice(lead.length, run.length - tail.length)}⁩${tail}`;
  });
};

/* ── the model from a session ─────────────────────────────────────────── */

export function buildFlow(session, events) {
  const nodes = [];
  const edges = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const add = (kind, ar, en, extra = {}) => { const node = { id: id(kind[0]), kind, ar, en, ...extra }; nodes.push(node); return node; };
  const link = (from, to, kind = 'flow', label = '') => { edges.push({ id: `e${edges.length + 1}`, from: from.id, to: to.id, kind, label }); };

  const chains = correlate(events);
  const causes = new Map(chains.map((c) => [c.trigger, c]));
  const acts = events.filter((e) => e.kind === 'dom' || e.kind === 'nav');

  const start = add('start', 'البداية', 'Start');
  let last = start;
  let pendingInputs = null;
  let lastFailure = null;
  const seenClicks = new Map();

  const flushInputs = () => {
    if (!pendingInputs) return;
    // Four field names at most, and the joined line capped as a whole: four
    // labels of 28 would still be 112 characters across a 150px box.
    const labels = [...new Set(pendingInputs.fields)].slice(0, 4);
    /*
     * Plain text here, isolates only where it is drawn.
     *
     * These labels used to be isolated as they were built, and `nodeText()`
     * isolates every line it draws — so each run came out wrapped twice, and
     * the wrap that fits a line to the box then cut one of those isolates in
     * half. An FSI with no PDI takes everything after it left-to-right, which
     * is why `Applicant name، Email` drew as `،Email`: the comma belongs to the
     * Arabic and was being resolved as though it belonged to the Latin. The
     * model is text; direction is a property of the line, applied once, after
     * the line is as wide as it is going to be.
     */
    const arFields = clampLabel(labels.join('، '), LABEL_MAX * 2);
    const enFields = clampLabel(labels.join(', '), LABEL_MAX * 2);
    const node = add('input', `تعبئة الحقول: ${arFields}`, `Fill in: ${enFields}`, { ts: pendingInputs.ts });
    link(last, node);
    last = node;
    pendingInputs = null;
  };

  for (const ev of acts) {
    if (ev.kind === 'nav') {
      flushInputs();
      // The page's own name: its title if the recording caught one, else the
      // last segment of the path that means anything, decoded.
      const name = pageLabel(ev.url, ev.title || '');
      const node = add('page', `فتح الصفحة: ${name}`, `Open ${name}`, { ts: ev.ts, url: ev.url });
      link(last, node);
      last = node;
      continue;
    }
    if (ev.action === 'input' || ev.action === 'change') {
      if (!pendingInputs) pendingInputs = { ts: ev.ts, fields: [] };
      pendingInputs.fields.push(shortLabel(ev) || 'حقل');
      continue;
    }
    if (ev.action === 'click' || ev.action === 'submit' || ev.action === 'keydown') {
      flushInputs();
      const named = shortLabel(ev);
      const label = named || 'عنصر';
      const labelEn = named || 'an element';
      const isSubmit = ev.action === 'submit' || /submit|إرسال|تقديم|حفظ|save|send/i.test(label);
      const node = add('process', isSubmit ? `إرسال: ${label}` : `النقر على «${label}»`, isSubmit ? `Submit: ${labelEn}` : `Click "${labelEn}"`, { ts: ev.ts });
      // The same control pressed again is a retry: a loop back, not a new step.
      const key = label.toLowerCase();
      if (seenClicks.has(key) && last !== seenClicks.get(key)) {
        // A retry loops back from where the user was — the red box if the
        // last press failed — and the decision keeps its "yes" for whatever
        // came next, which is what a retry that worked looks like.
        const from = last.kind === 'decision' && lastFailure ? lastFailure : last;
        link(from, seenClicks.get(key), 'loop', 'إعادة محاولة');
        nodes.pop();
        n--;
        if (last.kind !== 'decision') last = seenClicks.get(key);
      } else {
        seenClicks.set(key, node);
        link(last, node);
        last = node;
      }
      const chain = causes.get(ev);
      if (chain) {
        const f = chain.failure;
        /*
         * "فشل: 500", and the path on the line under it.
         *
         * It used to be one line, the status and the path joined by a middle
         * dot, and it rendered as "فشل· 500 :" — a colon and a dot are neutral
         * characters, so in a right-to-left line they resolve against whatever
         * run sits beside them and land on the wrong side of the number. A
         * separator between two runs of opposite direction is a bidi bug
         * waiting to happen; a line break is not. So the status is a line, the
         * path is a line, and there is no separator left to misplace. A
         * failure that is not a request (a console error, an uncaught throw)
         * has no path, so it gets no second line and no trailing punctuation.
         */
        const head = f.kind === 'net' ? String(f.status ?? '') : clampLabel(f.text || 'خطأ', LABEL_MAX + 8);
        const detail = f.kind === 'net' ? pathOf(f.url) : '';
        const decision = add('decision', 'هل نجحت العملية؟', 'Did it succeed?', { ts: f.ts });
        const failure = add(
          'failure',
          detail ? `فشل: ${head}\n${detail}` : `فشل: ${head}`,
          `Failure: ${head}`,
          { ts: f.ts, gapMs: chain.gapMs }
        );
        link(last, decision);
        link(decision, failure, 'no', 'لا');
        lastFailure = failure;
        last = decision;
        last.pendingYes = true;
      }
      continue;
    }
  }
  flushInputs();
  /*
   * The end of a recording is not a verdict.
   *
   * This used to leave a decision through the green "نعم: نجح / yes: it worked"
   * arrow, so a session that ended right after a 500 drew a green arrow out of
   * the failure into النهاية, with the legend underneath saying "it worked".
   * Reaching the end of a recording says only that the tester stopped. The
   * green arrow is kept for a decision that continues into another step, which
   * is the case where the application really did carry on.
   */
  const end = add('end', 'النهاية', 'End');
  link(last, end, 'flow', '');
  for (const node of nodes) delete node.pendingYes;
  // Every decision has a "yes" continuation: to whatever came next.
  for (const e of edges) {
    const from = nodes.find((x) => x.id === e.from);
    const to = nodes.find((x) => x.id === e.to);
    if (from?.kind === 'decision' && e.kind === 'flow' && to?.kind !== 'end') { e.kind = 'yes'; e.label = 'نعم'; }
  }

  const notes = events.filter((e) => e.kind === 'note' && e.tag === 'bug').slice(0, 2);
  for (const note of notes) add('note', clampLabel(note.text, 70), '', { ts: note.ts, floating: true });

  const flow = {
    version: 1,
    title: { ar: session.charterAr || session.charter, en: session.charter },
    meta: { session: session.id, url: session.startUrl, date: new Date(session.startedAt).toISOString().slice(0, 10), failures: events.filter(isFailure).length, steps: acts.length },
    story: buildStory(session, events, chains),
    nodes,
    edges,
  };
  layout(flow);
  return flow;
}

/* ── the user story, Arabic first ─────────────────────────────────────── */

export function buildStory(session, events, chains = correlate(events)) {
  const host = (() => { try { return new URL(session.startUrl).host; } catch { return 'النظام'; } })();
  const acts = events.filter((e) => e.kind === 'dom' && (e.action === 'click' || e.action === 'submit'));
  const criteriaAr = acts.slice(0, 5).map((a, i) => {
    const failed = chains.some((c) => c.trigger === a);
    return `${i + 1}. عندما ${/submit|إرسال/i.test(a.label || '') ? 'أُرسل' : 'أنقر على'} «${shortLabel(a) || 'عنصر'}» فإن النظام ${failed ? 'يجب أن يستجيب دون خطأ (سُجِّل فشل في هذا التسجيل)' : 'يستجيب دون خطأ'}.`;
  });
  const criteriaEn = acts.slice(0, 5).map((a, i) => {
    const failed = chains.some((c) => c.trigger === a);
    return `${i + 1}. When I ${/submit|إرسال/i.test(a.label || '') ? 'submit' : 'click'} "${shortLabel(a) || 'an element'}", the system responds without error${failed ? ' (a failure was recorded here)' : ''}.`;
  });
  return {
    ar: {
      title: 'قصة المستخدم',
      as: `بصفتي مستخدمًا لموقع ${host}`,
      // A charter is whatever the tester typed — "submit an application", but
      // just as often "Application submit returns 500". Splicing it after "I
      // want to" produces broken grammar in both languages, so it is quoted as
      // the goal instead of conjugated into the sentence.
      want: `أريد: «${clampLabel(session.charterAr || session.charter, 96)}»`,
      so: 'حتى أُنجز المهمة من البداية إلى النهاية دون عائق.',
      criteriaTitle: 'معايير القبول',
      criteria: criteriaAr,
    },
    en: {
      title: 'User story',
      as: `As a user of ${host}`,
      want: `I want: "${clampLabel(session.charter, 96)}"`,
      so: 'so that I complete the task from start to end without a blocker.',
      criteriaTitle: 'Acceptance criteria',
      criteria: criteriaEn,
    },
  };
}

/* ── layout: left to right, row by row, inside the drawing area ────────── */

/** The page regions, in px: a frame, a title band, the story column, the legend footer. */
export function regions(flow) {
  const pad = 8 * MM;
  const title = { x: pad, y: pad, w: A4.w - pad * 2, h: 16 * MM };
  const legendH = (12 + Math.ceil(usedLegend(flow).length / 3) * 7) * MM;
  const legend = { x: pad, y: A4.h - pad - legendH, w: A4.w - pad * 2, h: legendH };
  const story = { x: A4.w - pad - 68 * MM, y: title.y + title.h + 4 * MM, w: 68 * MM, h: legend.y - (title.y + title.h) - 8 * MM };
  const canvas = { x: pad, y: title.y + title.h + 4 * MM, w: story.x - pad - 4 * MM, h: story.h };
  return { pad, title, story, canvas, legend };
}

export function layout(flow) {
  const { canvas } = regions(flow);
  const placed = flow.nodes.filter((nd) => !nd.floating);
  const cols = Math.max(2, Math.floor((canvas.w - NODE.gapX) / (NODE.w + NODE.gapX)));
  const rows = Math.max(1, Math.ceil(placed.length / cols));
  // Too many rows for the page: scale the boxes and the gaps together, so the
  // sheet stays A4 and the drawing stays readable rather than overflowing.
  const need = rows * (NODE.h + NODE.gapY);
  const scale = need > canvas.h - 12 ? Math.max(0.42, (canvas.h - 12) / need) : 1;
  const w = NODE.w * scale;
  const h = NODE.h * scale;
  const gapX = NODE.gapX * scale;
  const gapY = NODE.gapY * scale;
  const colsScaled = Math.max(2, Math.floor((canvas.w - gapX) / (w + gapX)));
  placed.forEach((node, i) => {
    const row = Math.floor(i / colsScaled);
    const col = i % colsScaled; // always left to right: the workflow direction never flips
    node.w = w;
    node.h = node.kind === 'decision' ? h + 12 * scale : h;
    node.x = canvas.x + gapX / 2 + col * (w + gapX);
    node.y = canvas.y + 6 + row * (h + gapY);
    node.scale = scale;
  });
  flow.nodes.filter((nd) => nd.floating).forEach((node, i) => {
    node.w = NODE.w + 30; node.h = 44;
    node.x = canvas.x + canvas.w - node.w - 4;
    node.y = canvas.y + canvas.h - node.h - 4 - i * 52;
  });
  return flow;
}

/* ── the legend: only what is on the page ─────────────────────────────── */

export function usedLegend(flow) {
  const out = [];
  const kinds = new Set(flow.nodes.map((nd) => nd.kind));
  for (const [k, spec] of Object.entries(KINDS)) if (kinds.has(k)) out.push({ type: 'node', kind: k, ...spec });
  const ekinds = new Set(flow.edges.map((e) => e.kind));
  for (const [k, spec] of Object.entries(EDGES)) if (ekinds.has(k)) out.push({ type: 'edge', kind: k, ...spec });
  return out;
}

/* ── drawing ──────────────────────────────────────────────────────────── */

/** Word-wrap for SVG text; Arabic words wrap the same way, the direction is on the element. */
export function wrap(text, max = 22) {
  // A token longer than the line has no space to break at (a path, a token, a
  // percent-encoded segment) and left whole it draws straight out of the box.
  // Cutting it at the measure is what every text engine does; the label was
  // already capped when the model was built, so this is the last guard.
  const words = String(text || '').split(/\s+/).filter(Boolean)
    .flatMap((w) => (w.length <= max ? [w] : w.match(new RegExp(`.{1,${max}}`, 'gu')) || [w]));
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function shapePath(node, spec) {
  const { x, y, w, h } = { x: Number(node.x) || 0, y: Number(node.y) || 0, w: Number(node.w) || 0, h: Number(node.h) || 0 }; // S-10: geometry is numbers, whatever a stored flow says
  switch (spec.shape) {
    case 'terminator': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${esc(node.fill || spec.fill)}" stroke="${esc(node.stroke || spec.stroke)}" stroke-width="2"/>`;
    case 'diamond': return `<path d="M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z" fill="${esc(node.fill || spec.fill)}" stroke="${esc(node.stroke || spec.stroke)}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'parallelogram': return `<path d="M${x + 14} ${y}H${x + w}L${x + w - 14} ${y + h}H${x}Z" fill="${esc(node.fill || spec.fill)}" stroke="${esc(node.stroke || spec.stroke)}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'note': return `<path d="M${x} ${y}H${x + w - 12}L${x + w} ${y + 12}V${y + h}H${x}Z" fill="${esc(node.fill || spec.fill)}" stroke="${esc(node.stroke || spec.stroke)}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${esc(node.fill || spec.fill)}" stroke="${esc(node.stroke || spec.stroke)}" stroke-width="2"/>`;
  }
}

function nodeText(node, spec) {
  const cx = node.x + node.w / 2;
  const k = node.scale || 1;
  // A label may ask for a line break of its own: a failure puts its status on
  // one line and the path on the next, so no separator sits between two runs
  // of opposite direction. Each part is still wrapped to the box.
  const measure = node.kind === 'decision' ? 16 : 22;
  const ar = String(node.ar ?? '').split('\n').flatMap((part) => wrap(part, measure)).slice(0, k < 0.8 ? 2 : 3);
  /*
   * One English line, and it says that it is one line.
   *
   * `wrap().slice(0, 1)` used to drop the rest silently, so a field list came
   * out as "Fill in: Applicant name," — a trailing comma and nothing after it,
   * which reads as a rendering bug rather than as a summary.
   */
  const enLines = node.en && k >= 0.7 ? wrap(node.en, 30) : [];
  const en = enLines.length
    ? [enLines.length > 1 ? `${enLines[0].replace(/[\s,;:،؛·-]+$/, '')}…` : enLines[0]]
    : [];
  const lh = 15 * k;
  const total = ar.length * lh + en.length * 11 * k;
  let y = node.y + node.h / 2 - total / 2 + 12 * k;
  let out = `<text x="${cx}" y="${y}" text-anchor="middle" direction="rtl" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="${(12.5 * k).toFixed(1)}" font-weight="700" fill="${esc(node.ink || spec.ink)}">`;
  ar.forEach((line, i) => { out += `<tspan x="${cx}" dy="${i ? lh : 0}">${esc(iso(line))}</tspan>`; });
  out += '</text>';
  if (en.length) {
    y += ar.length * lh - 2;
    out += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="${(9.5 * k).toFixed(1)}" fill="${esc(node.ink || spec.ink)}" opacity=".78">${esc(en[0])}</text>`;
  }
  return out;
}

const center = (nd) => ({ x: nd.x + nd.w / 2, y: nd.y + nd.h / 2 });

/** Where a straight line from `from` leaves `to`'s box, so arrowheads land on the edge. */
function edgePoint(node, towards) {
  const c = center(node);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  const hw = node.w / 2;
  const hh = node.h / 2;
  if (!dx && !dy) return c;
  const sx = Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function edgePath(e, from, to) {
  const spec = EDGES[e.kind] || EDGES.flow;
  const a = edgePoint(from, center(to));
  const b = edgePoint(to, center(from));
  let d;
  if (spec.ring) {
    // A loop back: a ring above the nodes, so it never crosses the flow.
    const top = Math.min(from.y, to.y) - 34;
    d = `M${a.x} ${from.y} C ${a.x} ${top}, ${b.x} ${top}, ${b.x} ${to.y}`;
  } else if (Math.abs(a.y - b.y) < 2) {
    d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
  } else if (to.y > from.y && to.x < from.x) {
    // Row wrap: down, then across to the left, then down into the next row.
    const midY = from.y + from.h + 18;
    d = `M${center(from).x} ${from.y + from.h} V${midY} H${center(to).x} V${to.y}`;
  } else {
    const midX = (a.x + b.x) / 2;
    d = `M${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
  }
  const marker = `url(#arrow-${esc(e.kind)})`;
  const label = e.label ? `<text x="${(a.x + b.x) / 2}" y="${spec.ring ? Math.min(from.y, to.y) - 22 : (a.y + b.y) / 2 - 6}" text-anchor="middle" direction="rtl" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="10.5" font-weight="600" fill="${spec.stroke}" paint-order="stroke" stroke="${PALETTE.paper}" stroke-width="3">${esc(iso(e.label))}</text>` : '';
  return `<g data-edge="${esc(e.id)}"><path d="${d}" fill="none" stroke="${spec.stroke}" stroke-width="2" ${spec.dash ? `stroke-dasharray="${spec.dash}"` : ''} marker-end="${marker}"/>${label}</g>`;
}

/*
 * The story column, fitted to its box.
 *
 * The page is A4 landscape by decision, not by accident: it is printed, filed
 * and stapled to a test report, so the sheet cannot grow to swallow a long
 * charter or five wordy criteria. What it must never do is what it did in the
 * film sample: run a sentence past the bottom edge and cut it mid-word
 * ("respond..."), which reads as a broken product rather than as a summary.
 *
 * So the block measures before it draws. The English half is reserved for
 * before the Arabic criteria are laid down, and whatever does not fit is
 * *named*: the count, and where the rest can be read. A reader is told what
 * they are not being shown, which is the contract the rest of this product
 * keeps.
 */
function storyBlock(story, r) {
  const L = [];
  const x = r.x + r.w - 10; // RTL: logical start is the right edge, so text-anchor="start" here
  const bottom = r.y + r.h - 10;
  let y = r.y + 22;
  const text = (t, size, weight, fill, dir = 'rtl', anchor = 'start', xx = x) => { L.push(`<text x="${xx}" y="${y}" direction="${dir}" text-anchor="${anchor}" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(dir === 'rtl' ? iso(t) : t)}</text>`); };
  const para = (t, size, weight, fill, max, dir = 'rtl', anchor = 'start', xx = x) => { for (const line of wrap(t, max)) { text(line, size, weight, fill, dir, anchor, xx); y += size * 1.55; } };
  /** What a paragraph will cost in height, before any of it is drawn. */
  const costOf = (t, size, max) => wrap(t, max).length * size * 1.55;
  L.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${PALETTE.paper}" stroke="${PALETTE.line}"/>`);
  text(story.ar.title, 14, 800, PALETTE.basalt); y += 22;
  para(`${story.ar.as}،`, 11.5, 600, PALETTE.basalt, 32);
  para(story.ar.want, 11.5, 600, PALETTE.basalt, 32);
  para(story.ar.so, 11.5, 500, PALETTE.slate, 32);
  y += 8;
  text(story.ar.criteriaTitle, 12.5, 800, PALETTE.basalt); y += 18;

  // Reserved before a single criterion is drawn: the English half's rule and
  // heading, its one-line summary, one criterion, and the line naming the rest.
  const enSummary = `${story.en.as}, ${story.en.want}, ${story.en.so}`;
  const reserve = 10 + 18 + 16 + costOf(enSummary, 9.5, 44)
    + (story.en.criteria.length ? costOf(story.en.criteria[0], 9, 46) : 0) + 16;

  let shownAr = 0;
  for (const c of story.ar.criteria) {
    if (y + costOf(c, 10.5, 36) > bottom - reserve) break;
    para(c, 10.5, 500, PALETTE.basalt, 36);
    shownAr++;
  }
  const restAr = story.ar.criteria.length - shownAr;
  if (restAr) para(restAr === 1 ? 'ومعيار آخر في التقرير.' : `و${restAr} معايير أخرى في التقرير.`, 10, 700, PALETTE.slate, 36);

  y += 10;
  L.push(`<line x1="${r.x + 12}" x2="${r.x + r.w - 12}" y1="${y}" y2="${y}" stroke="${PALETTE.line}"/>`); y += 18;
  const lx = r.x + 10;
  text(story.en.title, 11.5, 800, PALETTE.slate, 'ltr', 'start', lx); y += 16;
  para(enSummary, 9.5, 500, PALETTE.slate, 44, 'ltr', 'start', lx);

  let shownEn = 0;
  for (const c of story.en.criteria) {
    if (y + costOf(c, 9, 46) > bottom - 14) break;
    para(c, 9, 500, PALETTE.slate, 46, 'ltr', 'start', lx);
    shownEn++;
  }
  const restEn = story.en.criteria.length - shownEn;
  if (restEn) para(`and ${restEn} more in the report.`, 9, 700, PALETTE.slate, 46, 'ltr', 'start', lx);
  return L.join('\n');
}

function legendBlock(flow, r) {
  const items = usedLegend(flow);
  const cols = 3;
  const colW = (r.w - 24) / cols;
  const L = [`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${PALETTE.band}" stroke="${PALETTE.line}"/>`];
  L.push(`<text x="${r.x + r.w - 12}" y="${r.y + 18}" direction="rtl" text-anchor="start" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="11.5" font-weight="800" fill="${PALETTE.basalt}">دليل الرسم: كيف تقرأ هذا المخطط</text>`);
  L.push(`<text x="${r.x + 12}" y="${r.y + 18}" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="10" font-weight="600" fill="${PALETTE.slate}">Legend · read left to right; the text inside is Arabic</text>`);
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = r.x + 12 + col * colW;
    const cy = r.y + 34 + row * 7 * MM;
    if (it.type === 'node') {
      const mini = { x: cx, y: cy - 8, w: 34, h: 16, fill: it.fill, stroke: it.stroke };
      L.push(shapePath(mini, it));
    } else {
      L.push(`<path d="M${cx} ${cy}${it.ring ? ` C ${cx + 10} ${cy - 16}, ${cx + 24} ${cy - 16}, ${cx + 34} ${cy}` : ` H${cx + 34}`}" fill="none" stroke="${it.stroke}" stroke-width="2" ${it.dash ? `stroke-dasharray="${it.dash}"` : ''} marker-end="url(#arrow-${it.kind})"/>`);
    }
    L.push(`<text x="${cx + 44}" y="${cy + 4}" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="10.5" font-weight="700" fill="${PALETTE.basalt}">${esc(it.ar)}</text>`);
    L.push(`<text x="${cx + 44}" y="${cy + 15}" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="8.5" fill="${PALETTE.slate}">${esc(it.en)}</text>`);
  });
  return L.join('\n');
}

/**
 * The whole page as SVG. `lockup` is the brand SVG text when the caller has
 * it; `fonts` is the `@font-face` CSS `core/docshell.js`'s `loadDocFonts()`
 * returns, embedded in the same `data:` form the HTML exports use, so the
 * diagram renders in Thmanyah with no font request of its own. Both are
 * optional: `diagram/diagram.js`'s live editor page draws this SVG inline,
 * where the page's own stylesheet already supplies the face.
 */
export function flowToSvg(flow, { lockup = '', interactive = false, fonts = '' } = {}) {
  const r = regions(flow);
  const byId = new Map(flow.nodes.map((nd) => [nd.id, nd]));
  const markers = Object.entries(EDGES)
    .map(([k, s]) => `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="${s.stroke}"/></marker>`)
    .join('');
  /*
   * Every node clips its own text.
   *
   * The labels are capped where the model is built, which is the real fix; this
   * is the guarantee. A diagram edited by hand, a model from an older session,
   * a face that shapes wider than it counts: none of them can put a word
   * outside its box, because the box is a clip path.
   */
  const clips = flow.nodes
    .map((nd) => `<clipPath id="clip-${esc(nd.id)}"><rect x="${nd.x}" y="${nd.y}" width="${nd.w}" height="${nd.h}" rx="8"/></clipPath>`)
    .join('');
  const nodes = flow.nodes
    .map((nd) => { const spec = KINDS[nd.kind] || KINDS.process; return `<g data-node="${esc(nd.id)}" ${interactive ? 'style="cursor:grab"' : ''}>${shapePath(nd, spec)}<g clip-path="url(#clip-${esc(nd.id)})">${nodeText(nd, spec)}</g></g>`; })
    .join('\n');
  const edges = flow.edges
    .map((e) => { const a = byId.get(e.from); const b = byId.get(e.to); return a && b ? edgePath(e, a, b) : ''; })
    .join('\n');
  const lockupG = lockup
    ? `<g transform="translate(${r.title.x + 12} ${r.title.y + 10}) scale(0.46)">${lockup.replace(/<\/?svg[^>]*>/g, '')}</g>`
    : `<text x="${r.title.x + 12}" y="${r.title.y + 30}" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" font-size="16" font-weight="800" fill="${PALETTE.basalt}">${esc(MAKER.product)}</text>`;
  const date = flow.meta?.date || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A4.w} ${A4.h}" width="297mm" height="210mm" font-family="'Thmanyah Sans', -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif" data-flow-version="${esc(flow.version || 1)}">
<title>${esc(flow.title?.ar || '')}: ${esc(flow.title?.en || '')}</title>
<desc>Workflow diagram from a QA Wrap session ${esc(flow.meta?.session || '')}. A4 landscape, flow left to right, labels in Arabic. Generated by ${esc(MAKER.full)}.</desc>
<defs>${markers}${clips}
  <pattern id="grid" width="${4 * MM}" height="${4 * MM}" patternUnits="userSpaceOnUse"><path d="M${4 * MM} 0H0V${4 * MM}" fill="none" stroke="${PALETTE.line}" stroke-width=".4" opacity=".6"/></pattern>
  ${fonts ? `<style>${fonts}</style>` : ''}
</defs>
<rect width="${A4.w}" height="${A4.h}" fill="${PALETTE.limestone}"/>
<rect x="${r.pad - 6}" y="${r.pad - 6}" width="${A4.w - r.pad * 2 + 12}" height="${A4.h - r.pad * 2 + 12}" rx="14" fill="none" stroke="${PALETTE.basalt}" stroke-width="2.5"/>
<rect x="${r.pad - 2}" y="${r.pad - 2}" width="${A4.w - r.pad * 2 + 4}" height="${A4.h - r.pad * 2 + 4}" rx="11" fill="none" stroke="${PALETTE.petra}" stroke-width="1" opacity=".8"/>
<g data-region="title">
  <rect x="${r.title.x}" y="${r.title.y}" width="${r.title.w}" height="${r.title.h}" rx="10" fill="${PALETTE.paper}" stroke="${PALETTE.line}"/>
  ${lockupG}
  <text x="${r.title.x + r.title.w - 14}" y="${r.title.y + 26}" direction="rtl" text-anchor="start" font-size="17" font-weight="800" fill="${PALETTE.basalt}">${esc(iso(flow.title?.ar || ''))}</text>
  <text x="${r.title.x + r.title.w - 14}" y="${r.title.y + 46}" direction="rtl" text-anchor="start" font-size="10.5" fill="${PALETTE.slate}">${esc(`مخطط سير العمل · ${iso(date)} · ${countAr(flow.meta?.steps ?? 0, STEPS_AR)} · ${countAr(flow.meta?.failures ?? 0, FAILURES_AR)}`)}</text>
</g>
<g data-region="canvas">
  <rect x="${r.canvas.x}" y="${r.canvas.y}" width="${r.canvas.w}" height="${r.canvas.h}" rx="10" fill="url(#grid)" stroke="${PALETTE.line}"/>
  <g data-layer="edges">${edges}</g>
  <g data-layer="nodes">${nodes}</g>
</g>
<g data-region="story">${storyBlock(flow.story, r.story)}</g>
<g data-region="legend">${legendBlock(flow, r.legend)}</g>
<text x="${A4.w - r.pad - 4}" y="${A4.h - 5}" text-anchor="end" font-size="7.5" fill="${PALETTE.slate}">${esc(MAKER.full)} · ${esc(MAKER.tagline)}</text>
</svg>`;
}
