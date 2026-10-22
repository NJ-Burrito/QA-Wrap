/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Harvester's outputs: a page map, a page object, a brief for an AI.
 *
 * The content script walks the page and hands back every interactive element
 * with a locator the selector engine has *verified* — resolved against the
 * live DOM, matched to exactly one element or flagged. This module turns that
 * list into the three files a test writer, human or machine, actually wants:
 *
 *   - `page-map.json`  — the facts, schema'd, for any tool to consume;
 *   - `<Name>Page.ts`  — a Playwright page object, locators as readonly
 *                        fields, one fill/submit pair per form;
 *   - `brief.md`       — instructions and the same table for an AI that is
 *                        asked to write the tests, so it uses these locators
 *                        and invents none.
 *
 * A generated page object is not a finished one: names are guessed from
 * labels, ambiguous locators are marked rather than silently `.first()`-ed,
 * and the assertions are left to the person. Honest scaffolding beats
 * confident fiction.
 */

import { MAKER } from './provenance.js';
import { fence, FENCE_NOTE } from './fence.js';

const KIND_SUFFIX = {
  button: 'Button', link: 'Link', field: 'Field', textarea: 'Field', select: 'Select',
  checkbox: 'Checkbox', radio: 'Radio', control: 'Control', other: 'Element',
};

/**
 * Arabic → a Latin key, letter by letter.
 *
 * A page object for an Arabic site used to name every field `inputField2`,
 * because the key maker only knew Latin. A tester who reads Arabic can read
 * `alkhdmatAlalktrwnyaLink` at a glance; a tester who does not can still tell
 * two fields apart. Diacritics are dropped, the definite article is kept.
 */
const ARABIC = {
  'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a', 'ء': '', 'ئ': 'y', 'ؤ': 'w',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
export function transliterate(word) {
  return String(word).replace(/[ً-ْـ]/g, '').split('').map((c) => ARABIC[c] ?? c).join('');
}

/** `Sign in` → `signIn`; `الخدمات الإلكترونية` → `alkhdmatAlalktrwnya`. */
function camel(text) {
  const words = String(text || '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => (/[؀-ۿ]/.test(w) ? transliterate(w) : w))
    .filter((w) => /^[A-Za-z0-9]+$/.test(w));
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

/** A PascalCase class name from the page title or path, always ending in `Page`. */
export function className(harvest) {
  let base = camel(harvest.title || '');
  if (base.length > 40) base = base.slice(0, 40);
  if (!base) {
    try {
      const path = new URL(harvest.url).pathname.split('/').filter(Boolean).pop() || 'home';
      base = camel(path.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));
    } catch { /* not a URL */ }
  }
  base = base || 'harvested';
  base = base[0].toUpperCase() + base.slice(1);
  return /Page$/.test(base) ? base : `${base}Page`;
}

/** Field names for the page object: unique, camelCase, suffixed by kind. */
export function withKeys(elements) {
  const used = new Map();
  return elements.map((e) => {
    let base = camel(e.label || e.name || e.placeholder || e.text || '');
    if (!base) base = e.tag || 'element';
    if (/^\d/.test(base)) base = `el${base}`;
    const suffix = KIND_SUFFIX[e.kind] || 'Element';
    let key = base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : base + suffix;
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n > 1) key = `${key}${n}`;
    return { ...e, key };
  });
}

const iso = (ts) => new Date(ts || Date.now()).toISOString();
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/* ── page-map.json ─────────────────────────────────────────────────────── */

export function buildPageMap(harvest, session) {
  const elements = withKeys(harvest.elements || []);
  return JSON.stringify(
    {
      generator: `${MAKER.full} ${session?.version || ''}`.trim(),
      generatedAt: iso(harvest.at),
      session: session ? { id: session.id, charter: session.charter } : undefined,
      page: { url: harvest.url, title: harvest.title, lang: harvest.lang, dir: harvest.dir },
      summary: harvest.counts,
      truncated: !!harvest.truncated,
      elements: elements.map((e) => ({
        n: e.n,
        key: e.key,
        kind: e.kind,
        tag: e.tag,
        role: e.role || undefined,
        name: e.name || undefined,
        label: e.label || undefined,
        type: e.type || undefined,
        placeholder: e.placeholder || undefined,
        required: e.required || undefined,
        href: e.href || undefined,
        region: e.region || undefined,
        form: e.form ?? undefined,
        locator: { playwright: e.playwright, strategy: e.strategy, unique: !!e.unique, matches: e.matches, css: e.css },
      })),
      forms: (harvest.forms || []).map((f) => ({ n: f.n, name: f.name, fields: f.fields, submit: f.submit })),
    },
    null,
    2
  );
}

/* ── the page object ───────────────────────────────────────────────────── */

const FILLABLE = new Set(['field', 'textarea', 'select', 'checkbox', 'radio']);

export function buildPageObject(harvest) {
  const elements = withKeys(harvest.elements || []);
  const name = className(harvest);
  const forms = harvest.forms || [];
  const byN = new Map(elements.map((e) => [e.n, e]));
  const L = [];

  L.push(`import { type Locator, type Page, expect } from '@playwright/test';`);
  L.push('');
  L.push('/**');
  L.push(` * ${name}, harvested from ${harvest.url}`);
  L.push(` * on ${iso(harvest.at).slice(0, 16).replace('T', ' ')} by ${MAKER.full}.`);
  L.push(' *');
  L.push(' * Every locator was resolved against the live page when it was harvested.');
  L.push(' * The ones marked ⚠ matched more than one element and need a hand: a');
  L.push(' * container, a `.filter()`, or a test id added to the application.');
  L.push(' */');
  L.push(`export class ${name} {`);
  L.push('  readonly page: Page;');
  for (const e of elements) L.push(`  readonly ${e.key}: Locator;`);
  L.push('');
  L.push('  constructor(page: Page) {');
  L.push('    this.page = page;');
  for (const e of elements) {
    const flag = e.unique ? '' : ` // ⚠ matched ${e.matches}: disambiguate`;
    L.push(`    this.${e.key} = ${e.playwright.replace(/^page\./, 'page.')};${flag}`.replace('= page.', '= page.'));
  }
  L.push('  }');
  L.push('');
  L.push('  async goto() {');
  L.push(`    await this.page.goto(${q(harvest.url)});`);
  L.push('  }');

  for (const f of forms) {
    const fields = f.fields.map((n) => byN.get(n)).filter((e) => e && FILLABLE.has(e.kind));
    if (!fields.length) continue;
    const fname = camel(f.name) || `form${f.n}`;
    const Fname = fname[0].toUpperCase() + fname.slice(1);
    L.push('');
    L.push(`  /** Fill the "${f.name}" form. Every field is optional; only the ones given are touched. */`);
    L.push(`  async fill${Fname}(data: {`);
    for (const e of fields) L.push(`    ${e.key}?: ${e.kind === 'checkbox' || e.kind === 'radio' ? 'boolean' : 'string'};`);
    L.push('  }) {');
    for (const e of fields) {
      const v = `data.${e.key}`;
      const op =
        e.kind === 'select' ? `await this.${e.key}.selectOption(${v});`
          : e.kind === 'checkbox' ? `await this.${e.key}.setChecked(${v});`
            : e.kind === 'radio' ? `if (${v}) await this.${e.key}.check();`
              : `await this.${e.key}.fill(${v});`;
      L.push(`    if (${v} !== undefined) ${op}`);
    }
    L.push('  }');
    const submit = f.submit != null ? byN.get(f.submit) : null;
    if (submit) {
      L.push('');
      L.push(`  async submit${Fname}() {`);
      L.push(`    await this.${submit.key}.click();`);
      L.push('  }');
    }
  }

  L.push('');
  L.push('  /** The page is the one that was harvested. Tighten this to what "loaded" means for you. */');
  L.push('  async expectLoaded() {');
  const first = elements.find((e) => e.unique);
  if (first) L.push(`    await expect(this.${first.key}).toBeVisible();`);
  else L.push(`    await expect(this.page).toHaveTitle(${q(harvest.title || '')});`);
  L.push('  }');
  L.push('}');
  L.push('');
  return L.join('\n');
}

/* ── the brief ─────────────────────────────────────────────────────────── */

export function buildHarvestBrief(harvest, session) {
  const elements = withKeys(harvest.elements || []);
  const forms = harvest.forms || [];
  const byN = new Map(elements.map((e) => [e.n, e]));
  const unique = elements.filter((e) => e.unique).length;
  const name = className(harvest);
  const L = [];

  L.push(`# Page brief for a test writer: ${fence(harvest.title) || harvest.url}`);
  L.push('');
  L.push(`Harvested ${iso(harvest.at).slice(0, 16).replace('T', ' ')} from ${harvest.url} by ${MAKER.full}${session?.charter ? ` during "${session.charter}"` : ''}.`);
  L.push(`${elements.length} interactive elements, ${unique} with a locator verified to match exactly one element${harvest.truncated ? ' (the walk stopped at the budget; the page has more)' : ''}.`);
  L.push('');
  L.push(`${FENCE_NOTE} Every name, region and form name below is the page's own words, cut short.`);
  L.push('');
  L.push('## Rules for whoever writes the tests');
  L.push('');
  L.push('1. Use the locators in the table **verbatim**. They were resolved against the real page. Do not invent CSS or XPath.');
  L.push('2. A locator marked ⚠ matched more than one element. Scope it inside a container or ask for a test id. Never `.first()` it silently.');
  L.push(`3. Import the generated page object \`${name}\` (\`${name}.ts\`) rather than repeating locators in tests.`);
  L.push('4. Assert with web-first assertions (`expect(locator).toBeVisible()`, `toHaveText`, `toHaveURL`). No fixed waits.');
  L.push('5. Every test states its expected result in plain words in its title; the recording cannot know what *should* happen, only what did.');
  L.push('');
  L.push(`## Elements (${elements.length})`);
  L.push('');
  L.push('| # | Kind | Name | Region | Locator | Unique |');
  L.push('|---|---|---|---|---|---|');
  for (const e of elements) {
    const label = fence(e.label || e.name || e.text || e.placeholder || '').replace(/\|/g, '\\|');
    L.push(`| ${e.n} | ${e.kind} | ${label} | ${fence(e.region)} | \`${e.playwright.replace(/\|/g, '\\|')}\` | ${e.unique ? 'yes' : `⚠ ${e.matches}`} |`);
  }
  if (forms.length) {
    L.push('');
    L.push(`## Forms (${forms.length})`);
    L.push('');
    for (const f of forms) {
      const fields = f.fields.map((n) => byN.get(n)).filter(Boolean);
      const submit = f.submit != null ? byN.get(f.submit) : null;
      L.push(`- **${fence(f.name)}**, ${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.map((e) => `${e.key}${e.required ? ' (required)' : ''}`).join(', ') || 'none'}${submit ? `; submit: ${submit.key}` : ''}`);
    }
  }
  L.push('');
  L.push('## Scenarios worth writing first');
  L.push('');
  let i = 1;
  for (const f of forms) {
    const req = f.fields.map((n) => byN.get(n)).filter((e) => e?.required);
    L.push(`${i++}. Fill "${fence(f.name)}" with valid values and submit: expect the success state the product defines.`);
    if (req.length) L.push(`${i++}. Submit "${fence(f.name)}" with ${req.map((e) => e.key).join(', ')} empty: expect each required field to be named in an error, and nothing sent.`);
  }
  const links = elements.filter((e) => e.kind === 'link' && e.href).slice(0, 8);
  if (links.length) L.push(`${i++}. Each navigation link opens its target: ${links.map((e) => e.key).join(', ')}.`);
  L.push(`${i++}. Keyboard only: reach every control in the table with Tab and activate it with Enter or Space.`);
  L.push('');
  L.push('---');
  L.push(`Generated by ${MAKER.full}. The page object and the JSON map were produced from the same walk.`);
  L.push('');
  return L.join('\n');
}
