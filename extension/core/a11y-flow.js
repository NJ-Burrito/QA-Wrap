/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The same violation, on every page of a wizard, counted once.
 *
 * A five-page application form with one bad header produces five accessibility
 * scans, five "critical" rows and five copies of the same sentence. A tester
 * reading that report cannot tell whether they have five problems or one, and
 * the honest answer — one problem, on five pages — is the one that gets fixed,
 * because it names a component rather than a page.
 *
 * So a finding is keyed by **what is wrong and where in the markup**, not by
 * which URL happened to be open:
 *
 *   rule id + the *shape* of the selector + the message
 *
 * The shape, not the selector: `#step-2 > nav > a:nth-child(3)` and
 * `#step-4 > nav > a:nth-child(3)` are the same link in the same header on two
 * pages of one flow, and a key that included the step number would report them
 * as two problems. Digits, ids and nth-child indices are flattened out; what is
 * left is the structural path, which is as close to "the same element" as a
 * page-by-page scan can get.
 *
 * **Component grouping is a first approximation and the copy says so.** The
 * nearest landmark or section in the selector is used as the component
 * boundary, because that is what a DOM scan can see. A design system's real
 * component boundaries are not in the markup; a `<header>` is the closest thing
 * to one that is, and calling it an approximation in the report is the
 * difference between a useful grouping and a false claim.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/** A page, named the way a person would name it rather than by its query string. */
export function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, '') || u.host;
  } catch {
    return String(url || 'this page');
  }
}

/**
 * The structural shape of a selector, with the page-specific parts removed.
 *
 * `#step-2 > .nav > a:nth-child(3)` becomes `# > .nav > a:nth-child(n)`. Two
 * scans of the same header on two pages produce the same shape; two genuinely
 * different links do not, because their tag path and class path still differ.
 */
export function selectorShape(target) {
  return String(target || '')
    .split(/\s*>\s*|\s+/)
    .map((part) => part
      .replace(/#[\w-]+/g, '#')
      .replace(/:nth-(child|of-type)\(\d+\)/g, ':nth($1)')
      .replace(/\[\d+\]/g, '[n]')
      .replace(/\d+/g, 'n'))
    .join(' > ')
    .trim();
}

const LANDMARKS = /^(header|nav|main|footer|aside|section|form|dialog|table)\b|\[role=["']?(banner|navigation|main|contentinfo|complementary|region|search|form|dialog)/i;

/**
 * The nearest landmark in a selector, as a stand-in for a component.
 *
 * Read from the left, because a selector runs outermost-first: the first
 * landmark it passes through is the region the element lives in.
 */
export function componentOf(target) {
  const parts = String(target || '').split(/\s*>\s*|\s+/).filter(Boolean);
  const hit = parts.find((p) => LANDMARKS.test(p));
  if (hit) return hit.replace(/:nth-[\w-]+\(\d+\)/g, '').replace(/#[\w-]+/, '#');
  // No landmark at all is itself worth saying: an element outside every region
  // is a finding for the page structure as much as for the rule.
  return 'outside any landmark';
}

/**
 * Every accessibility scan in a session, folded into unique findings.
 *
 * Order matters and is deliberate: the pages are walked oldest first, so
 * "first seen on" is the page a tester should start from, and a finding that
 * appears for the first time on the page they are looking at is marked `isNew`
 * — which is the one thing a page-by-page report gets right and a naive
 * deduplication would throw away.
 */
export function foldFindings(events = [], { currentUrl = '' } = {}) {
  const scans = events
    .filter((e) => e.kind === 'a11y' && Array.isArray(e.violations))
    .sort((a, b) => a.ts - b.ts);

  const byKey = new Map();
  const pages = [];

  for (const scan of scans) {
    const page = pageKey(scan.url || scan.frameUrl || '');
    if (!pages.includes(page)) pages.push(page);

    for (const violation of scan.violations) {
      const nodes = violation.nodes?.length ? violation.nodes : [{ target: '', html: '', summary: '' }];
      for (const node of nodes) {
        const shape = selectorShape(node.target);
        const message = (node.summary || violation.help || '').slice(0, 200);
        const key = `${violation.id}::${shape}::${message}`;
        const found = byKey.get(key);
        if (found) {
          if (!found.pages.includes(page)) found.pages.push(page);
          found.occurrences += 1;
          continue;
        }
        byKey.set(key, {
          key,
          rule: violation.id,
          impact: violation.impact || 'minor',
          help: violation.help || '',
          helpUrl: violation.helpUrl || '',
          shape,
          component: componentOf(node.target),
          target: node.target,
          html: node.html || '',
          message,
          pages: [page],
          firstSeenOn: page,
          occurrences: 1,
        });
      }
    }
  }

  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const findings = [...byKey.values()].sort((a, b) => {
    const impact = (order[a.impact] ?? 9) - (order[b.impact] ?? 9);
    if (impact) return impact;
    return b.pages.length - a.pages.length;
  });

  const here = currentUrl ? pageKey(currentUrl) : '';
  for (const f of findings) {
    f.everywhere = pages.length > 1 && f.pages.length === pages.length;
    f.isNew = !!here && f.firstSeenOn === here && f.pages.length === 1;
  }

  return {
    findings,
    pages,
    counts: {
      unique: findings.length,
      raw: scans.reduce((n, s) => n + (s.total ?? s.violations.reduce((m, v) => m + (v.count || 1), 0)), 0),
      pages: pages.length,
      everywhere: findings.filter((f) => f.everywhere).length,
      components: new Set(findings.map((f) => f.component)).size,
    },
  };
}

/** The findings grouped by the region they live in, worst first. */
export function byComponent(folded) {
  const groups = new Map();
  for (const f of folded.findings) {
    const g = groups.get(f.component) || { component: f.component, findings: [], pages: new Set() };
    g.findings.push(f);
    f.pages.forEach((p) => g.pages.add(p));
    groups.set(f.component, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, pages: [...g.pages] }))
    .sort((a, b) => b.findings.length - a.findings.length);
}

/** One line a person can read, for a finding that spans a flow. */
export function describeFinding(f) {
  if (f.pages.length === 1) return `On ${f.pages[0]}.`;
  if (f.everywhere) return `On every page walked (${f.pages.length}): ${f.pages.join(', ')}.`;
  return `On ${plural(f.pages.length, 'page')}: ${f.pages.join(', ')}.`;
}

/** The block the report and the exported documents both render. */
export function foldedMarkdown(folded) {
  if (!folded.findings.length) return '';
  const L = ['## Accessibility findings, deduplicated', ''];
  L.push(`${plural(folded.counts.unique, 'unique finding')} across ${plural(folded.counts.pages, 'page')}, from ${plural(folded.counts.raw, 'raw violation')}. ${folded.counts.everywhere ? `${folded.counts.everywhere} appear on every page walked, which makes them component problems rather than page problems.` : ''}`);
  L.push('');
  L.push('| Finding | Impact | Where | Component |');
  L.push('|---|---|---|---|');
  for (const f of folded.findings) {
    L.push(`| ${f.rule}: ${f.help} | ${f.impact} | ${describeFinding(f)} | ${f.component} |`);
  }
  L.push('');
  L.push('_Findings are grouped by the nearest landmark or section in the selector. That is a first approximation of a component boundary: a design system\'s real boundaries are not in the markup, and a `<header>` is the closest thing to one that a DOM scan can see._');
  L.push('');
  return L.join('\n');
}
