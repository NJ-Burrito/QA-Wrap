/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A specification, reverse-engineered from a page and a walk through it.
 *
 * `core/docs.js` writes an SRS from what a *recording* saw. This writes one from
 * what the *page itself declares* — its forms, its rules, its navigation, the
 * errors it is showing — and folds the recording in when there is one, so a
 * tester who has just walked a service gets both halves: what the software asks
 * for, and what it did when they asked back.
 *
 * The house rule from `docs.js` holds here and is the whole reason the document
 * is worth reading: **every statement carries where it came from.** DECLARED is
 * the page saying it in its own markup (`required`, `pattern`, `<option>`);
 * OBSERVED is the recording having seen it; GAP is the DOM being ambiguous and a
 * person having to decide. A draft that is honest about its gaps saves a day;
 * one that hides them costs a week.
 *
 * Arabic first in the headings, English underneath, the same as the SRS and the
 * workflow diagram — a bilingual team reads one document, not two.
 *
 * Loaded through the offscreen door, never by the worker: this module and the
 * pipeline under it are ~40 KB of source and the worker's boot graph is at
 * 794.8 KB of an 800 KB cap. `offscreen.js` imports it on the first press and
 * keeps it; the worker only ever passes a model and gets Markdown back.
 */

import { MAKER } from './provenance.js';
import { correlate, isFailure, stepLabel, pageLabel, LABEL_PROSE_MAX } from './artifact.js';

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
const host = (url) => { try { return new URL(url).host; } catch { return url || ''; } };

/** A field's declared rules, as the sentence a specification would use. */
export function ruleSentence(field) {
  const r = field.rules || {};
  const bits = [];
  if (r.required) bits.push('is required');
  if (r.format) bits.push(`must be a valid ${r.format === 'tel' ? 'telephone number' : r.format}`);
  if (r.minLength != null && r.maxLength != null) bits.push(`must be between ${r.minLength} and ${r.maxLength} characters`);
  else if (r.maxLength != null) bits.push(`must be at most ${plural(r.maxLength, 'character')}`);
  else if (r.minLength != null) bits.push(`must be at least ${plural(r.minLength, 'character')}`);
  if (r.min != null && r.max != null) bits.push(`must be between ${r.min} and ${r.max}`);
  else if (r.min != null) bits.push(`must be at least ${r.min}`);
  else if (r.max != null) bits.push(`must be at most ${r.max}`);
  if (r.step) bits.push(`moves in steps of ${r.step}`);
  if (r.pattern) bits.push(`must match the pattern \`${r.pattern}\``);
  if (field.options?.length) bits.push(`is one of ${plural(field.options.length, 'listed value')}`);
  return bits;
}

/** What to call a field that has no label: never nothing, never a selector. */
export function fieldName(field) {
  const named = (field.label || field.name || '').trim();
  if (named) return named.slice(0, LABEL_PROSE_MAX);
  const kind = (field.type || 'field').trim();
  return kind === 'field' ? 'the unlabelled field' : `the unlabelled ${kind} field`;
}

/**
 * Requirements per form, with their acceptance criteria.
 *
 * One requirement for the form as a whole (what it is for and what it takes),
 * one per declared rule (because a rule the page already enforces is a
 * requirement somebody wrote down once and then lost), and an acceptance
 * criterion in Given/When/Then for each. A field with no label at all produces
 * a GAP instead of a confident sentence: the page knows what it wants and is
 * not saying, and only a person can name it.
 */
export function formRequirements(model) {
  const out = [];
  (model.forms || []).forEach((form, i) => {
    const id = `FR-F${i + 1}`;
    const name = form.name || (form.implicit ? 'the fields on this page' : `form ${i + 1}`);
    const required = form.fields.filter((f) => f.rules?.required);
    out.push({
      id,
      source: form.implicit ? 'page: fields outside any form' : `page: <form${form.action ? ` action="${form.action}"` : ''}>`,
      status: 'DECLARED',
      text: `The system shall offer "${name}" with ${plural(form.fields.length, 'field')}${required.length ? `, of which ${required.length} ${required.length === 1 ? 'is' : 'are'} required` : ''}.`,
      criteria: [
        `Given the page is open, when the user opens "${name}", then every field listed below is present.`,
        required.length
          ? `Given "${name}", when the user submits it with ${plural(required.length, 'required field')} empty, then the system shall refuse and say which field is missing.`
          : `Given "${name}", when the user submits it, then the system shall answer without an error.`,
      ],
    });

    form.fields.forEach((field, j) => {
      const bits = ruleSentence(field);
      if (!field.label && !field.name) {
        out.push({
          id: `${id}.${j + 1}`,
          source: `page: ${field.tag}[type=${field.type}] with no label`,
          status: 'GAP',
          text: `A ${field.type} field is offered with no label, no name and no aria-label. What it asks for cannot be read from the page and must be named by the product owner.`,
          criteria: [],
        });
        return;
      }
      if (!bits.length) return;
      out.push({
        id: `${id}.${j + 1}`,
        source: `page: ${Object.keys(field.rules || {}).join(', ')}`,
        status: 'DECLARED',
        text: `"${fieldName(field)}" ${bits.join(', and ')}.`,
        criteria: [
          field.rules?.required
            ? `Given "${name}", when "${fieldName(field)}" is left empty, then the system shall not accept the form.`
            : `Given "${name}", when "${fieldName(field)}" is filled with a value outside its rule, then the system shall say so before submitting.`,
        ],
      });
    });
  });
  return out;
}

/** Where this page can take a person: the navigation map an SRS needs. */
export function navigationRequirements(model) {
  const links = model.links || [];
  const nav = links.filter((l) => l.inNav);
  const internal = links.filter((l) => l.internal);
  const out = [];
  if (nav.length) {
    out.push({
      id: 'FR-N1',
      source: 'page: <nav> / role=navigation',
      status: 'DECLARED',
      text: `The system shall offer ${plural(nav.length, 'navigation link')} from this page: ${nav.slice(0, 12).map((l) => `"${l.label}"`).join(', ')}${nav.length > 12 ? ', and others' : ''}.`,
      criteria: [`Given this page, when the user follows any navigation link, then the destination shall load without an error.`],
    });
  }
  if (links.length && !nav.length) {
    out.push({
      id: 'FR-N1',
      source: 'page: links outside any nav landmark',
      status: 'GAP',
      text: `${plural(links.length, 'link')} are offered and none of them is inside a navigation landmark, so which of them is the page's navigation cannot be read from the markup.`,
      criteria: [],
    });
  }
  const external = links.length - internal.length;
  if (external > 0) {
    out.push({
      id: 'FR-N2',
      source: 'page: links to another host',
      status: 'DECLARED',
      text: `${plural(external, 'link')} ${external === 1 ? 'leaves' : 'leave'} this site. The specification shall say whether leaving is intended and whether it opens in the same window.`,
      criteria: [],
    });
  }
  return out;
}

/**
 * T-043 (G05): the frames after the top one, each a labelled group of its own requirements (never merged into the
 * top frame's), a frame nobody could read as a GAP line, and what masking withheld as one GAP line.
 */
export function frameRequirements(model) {
  const out = [];
  const where = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u || ''); } };
  let withheld = model.withheld || 0;
  (model.frames || []).forEach((f, i) => {
    const k = i + 2;
    const frame = where(f.url);
    if (!f.model) {
      out.push({ id: `FR-X${k}`, source: `frame: ${frame}`, status: 'GAP', frame, criteria: [], text: `Frame not read (${f.why || 'no answer'}), so nothing in it is in this document. · لم يُقرأ الإطار، فلا يظهر شيء منه في هذه الوثيقة.` });
      return;
    }
    withheld += f.model.withheld || 0;
    for (const r of [...formRequirements(f.model), ...navigationRequirements(f.model), ...errorRequirements(f.model)]) {
      out.push({ ...r, id: `F${k}:${r.id}`, source: `${r.source}; frame ${frame}`, frame });
    }
  });
  if (model.framesCapped > 0) {
    out.push({ id: 'FR-X0', source: 'frames: the reader stops at 8', status: 'GAP', criteria: [], text: `${plural(model.framesCapped, 'further frame')} not read, past the limit of 8. · لم تُقرأ إطارات إضافية لتجاوز الحد الأقصى وهو 8.` });
  }
  if (withheld > 0) {
    out.push({ id: 'FR-M1', source: 'page: masked by the tester', status: 'GAP', criteria: [], text: `${plural(withheld, 'item')} withheld by masking and absent from this document. · حُجب ${withheld} من العناصر بالإخفاء ولا تظهر في هذه الوثيقة.` });
  }
  return out;
}

/** What the page does when it refuses: observed, because it is on screen. */
export function errorRequirements(model) {
  return (model.messages || []).slice(0, 12).map((m, i) => ({
    id: `FR-E${i + 1}`,
    source: m.role ? `page: ${m.role}` : 'page: an error element on screen',
    status: 'OBSERVED',
    text: `When the condition behind it is met, the system shows: "${m.text}".${m.near ? ` Near "${m.near}".` : ''}`,
    criteria: [`Given the failing condition, when it occurs, then the system shall show this message and shall not lose what the user typed.`],
  }));
}

/** What the recording adds: the walk, and what broke during it. */
export function walkRequirements(session, events = []) {
  if (!session || !events.length) return [];
  const acts = events.filter((e) => e.kind === 'dom' || e.kind === 'nav');
  const chains = correlate(events);
  const out = [];
  const pages = [...new Set(acts.filter((e) => e.kind === 'nav').map((e) => pageLabel(e.url)))];
  if (pages.length) {
    out.push({
      id: 'FR-W1',
      source: `recording: ${plural(acts.length, 'action')} on ${when(session.startedAt)}`,
      status: 'OBSERVED',
      text: `The recorded walk covered ${plural(pages.length, 'page')}: ${pages.slice(0, 10).join(', ')}.`,
      criteria: [],
    });
  }
  acts.filter((e) => e.kind === 'dom').slice(0, 20).forEach((e, i) => {
    const name = stepLabel(e, LABEL_PROSE_MAX) || 'an element';
    const failed = chains.some((c) => c.trigger === e);
    out.push({
      id: `FR-W${i + 2}`,
      source: `recording: step ${i + 1}`,
      status: failed ? 'OBSERVED: FAILED' : 'OBSERVED',
      text: `The system shall allow the user to ${e.action === 'input' ? `fill "${name}"` : `${e.action} "${name}"`}.`,
      criteria: [
        failed
          ? `Given the recorded state, when the user ${e.action}s "${name}", then the system shall answer without a failure. A failure was recorded here.`
          : `Given the recorded state, when the user ${e.action}s "${name}", then the system shall answer without an error.`,
      ],
    });
  });
  const failures = events.filter(isFailure);
  if (failures.length) {
    out.push({
      id: 'NFR-R1',
      source: 'recording: failure log',
      status: 'OBSERVED: NOT MET',
      text: `No user action shall produce a 5xx response or an uncaught error. ${plural(failures.length, 'failure')} ${failures.length === 1 ? 'was' : 'were'} recorded in this walk.`,
      criteria: [],
    });
  }
  return out;
}

/**
 * The whole document.
 *
 * Markdown, through the same shape the rest of the pack uses, so the existing
 * `mdToHtml` + `shell()` pipeline renders it and the existing exporters file it
 * without knowing anything new.
 */
export function buildReverseSrs({ model, session = null, events = [] } = {}) {
  if (!model || !model.url) throw new Error('Nothing was read from the page.');
  const reqs = [
    ...formRequirements(model),
    ...navigationRequirements(model),
    ...errorRequirements(model),
    ...walkRequirements(session, events),
    ...frameRequirements(model),
  ];
  const gaps = reqs.filter((r) => r.status === 'GAP');
  const site = host(model.url);
  const L = [];

  L.push(`# مواصفات مستخرجة من الصفحة · Specification read back from ${site}`);
  L.push('');
  L.push(`${model.title || site} · ${model.url}`);
  L.push('');
  L.push(`Read from the page's own markup on ${when(Date.now())}${session ? `, with the recorded session "${session.charter}"` : ''}. Shaped after ISO/IEC/IEEE 29148 by ${MAKER.full}.`);
  L.push('');
  L.push('> **كيف تقرأ هذا المستند · How to read this.** Every line says where it came from. **DECLARED** means the page itself says so in its markup: a `required` attribute, a `pattern`, a list of options. Nobody has to guess it. **OBSERVED** means the recording or the page showed it happening. **GAP** means the markup is ambiguous and a person must decide. This is a draft read back from software that already exists: it is a starting point for a specification, not a replacement for one.');
  L.push('');
  L.push('## 1. المقدمة · Introduction');
  L.push('');
  L.push(`**1.1 Purpose.** Describe what ${site} asks of a user on this page, what it will not accept, and where it leads, so that it can be reviewed, agreed and tested.`);
  L.push(`**1.2 Scope.** One page: \`${model.url}\`${model.lang ? `, declared language \`${model.lang}\`` : ''}${model.dir === 'rtl' ? ', right-to-left' : ''}.`);
  L.push(`**1.3 What was read.** ${plural(model.counts?.forms ?? 0, 'form')}, ${plural(model.counts?.fields ?? 0, 'field')}, ${plural(model.counts?.buttons ?? 0, 'button')}, ${plural(model.counts?.links ?? 0, 'link')}${model.counts?.tables ? `, ${plural(model.counts.tables, 'table')}` : ''}.`);
  L.push('');

  if (model.headings?.length) {
    L.push('## 2. بنية الصفحة · The shape of the page');
    L.push('');
    for (const h of model.headings.slice(0, 30)) L.push(`${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`);
    L.push('');
  }

  L.push('## 3. المتطلبات الوظيفية · Functional requirements');
  L.push('');
  let group = null;
  for (const r of reqs) {
    if (r.frame && r.frame !== group) { group = r.frame; L.push('', `**Frame: ${group}**`, ''); }
    L.push(`- **${r.id}** ${r.text} _(${r.source}; ${r.status})_`);
    for (const c of r.criteria) L.push(`  - ${c}`);
  }
  if (!reqs.length) L.push('_Nothing on this page declares a rule, offers a form or navigates anywhere._');
  L.push('');

  if (model.tables?.length) {
    L.push('## 4. البيانات المعروضة · Data on the page');
    L.push('');
    for (const t of model.tables) {
      L.push(`- ${t.caption || 'A table'}: ${plural(t.columns.length, 'column')}${t.columns.length ? ` (${t.columns.join(', ')})` : ''}, ${plural(t.rows, 'row')} shown.`);
    }
    L.push('');
  }

  L.push('## 5. أسئلة مفتوحة · Open questions');
  L.push('');
  if (gaps.length) for (const g of gaps) L.push(`- **${g.id}** ${g.text}`);
  else L.push('- None from the markup. Every field on this page is named and every link sits in a landmark.');
  L.push('- Which of these rules are policy and which are incidental? The page enforces them; only the owner knows which are meant to.');
  if (!session) L.push('- What does the system do *after* a valid submission? Reading a page cannot answer that. Record a session and this section fills itself in.');
  L.push('');

  L.push('## 6. التحقق · Verification');
  L.push('');
  L.push('| Requirement | Read from | Status |');
  L.push('|---|---|---|');
  for (const r of reqs) L.push(`| ${r.id} | ${r.source} | ${r.status} |`);
  L.push('');
  L.push('---');
  L.push(`${plural(reqs.length, 'requirement')}; ${gaps.length} marked GAP. Read back from the page by ${MAKER.full}${session ? `; session \`${session.id}\`` : ''}.`);
  L.push('');
  return L.join('\n');
}
