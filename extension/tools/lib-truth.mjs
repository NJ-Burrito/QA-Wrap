/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-043 (G03): the real-DOM oracle for emitted locators. For every element marked data-truth="<id>" on a fixture
 * page, ask the engine (UQASelector.describe) and then ask Playwright itself, and compare:
 *   - the emitted locator's count() equals desc.matches (the engine's claim is Playwright's number);
 *   - when the engine says unique, count() is exactly 1 and it is the same node;
 *   - the XPath flavour resolves, in the browser, to exactly that node.
 * Used by test-locator-truth.mjs (working tree) and by test-truth.mjs (zip contents).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'locators');

/** Run one fixture page; returns [{ id, ok, why }]. */
export async function truthPage(page, enginePath, fixtureFile) {
  await page.goto(pathToFileURL(path.join(FIXTURES, fixtureFile)).href);
  await page.addScriptTag({ content: fs.readFileSync(enginePath, 'utf8') });
  const descs = await page.evaluate(() => [...document.querySelectorAll('[data-truth]')].map((el) => {
    const d = window.UQASelector.describe(el);
    return { id: el.getAttribute('data-truth'), d: d && { locator: d.locator, playwright: d.playwright, matches: d.matches, ambiguous: d.ambiguous, xpath: d.xpath, warnCodes: d.warnCodes } };
  }));
  const out = [];
  for (const { id, d } of descs) {
    if (!d) { out.push({ id, ok: false, why: 'engine described nothing', locator: '' }); continue; }
    const fail = (why) => out.push({ id, ok: false, why: `${why} [${d.playwright}]`, locator: d.locator, xpath: d.xpath });
    try {
      const bare = d.playwright.replace(/\.first\(\)$/, '');
      const loc = new Function('page', `return ${bare}`)(page);
      const count = await loc.count();
      if (count !== d.matches) { fail(`playwright count ${count} vs engine matches ${d.matches}`); continue; }
      if (!d.ambiguous) {
        const who = await loc.first().getAttribute('data-truth');
        if (who !== id) { fail(`unique locator resolves to ${who}`); continue; }
      }
      const nx = await page.evaluate((xp) => {
        try { const r = document.evaluate(xp, document, null, 7, null); const o = []; for (let i = 0; i < r.snapshotLength; i++) o.push(r.snapshotItem(i).getAttribute('data-truth')); return o; } catch (e) { return String(e); }
      }, d.xpath);
      if (!Array.isArray(nx) || nx.length !== 1 || nx[0] !== id) { fail(`xpath ${d.xpath} gives ${JSON.stringify(nx)}`); continue; }
      const pw = await page.locator(`xpath=${d.xpath}`).count();
      if (pw !== 1) { fail(`playwright xpath count ${pw} for ${d.xpath}`); continue; }
      out.push({ id, ok: true, locator: d.locator, xpath: d.xpath, warnCodes: d.warnCodes });
    } catch (e) { fail(`threw ${String(e.message).split('\n')[0]}`); }
  }
  return out;
}

export const FIXTURE_FILES = ['arabic.html', 'bidi.html', 'hidden-dup.html', 'table.html'];

export async function truthAll(page, enginePath) {
  const all = [];
  for (const f of FIXTURE_FILES) for (const r of await truthPage(page, enginePath, f)) all.push({ ...r, file: f });
  return all;
}

/** What the engine must say on the named fixtures (the defects the oracle was built to catch). Returns failure strings. */
export function namedChecks(res) {
  const by = (id) => res.find((r) => r.id === id) || { locator: '', xpath: '' };
  const bad = [];
  const want = (cond, msg) => { if (!cond) bad.push(msg); };
  want(by('ar-send').locator.includes("'إرسال'"), 'Arabic button keeps its own letters');
  want(by('ar-service').locator.includes("'الخدمة الإلكترونية'"), 'Arabic link keeps taa marbuta and hamza');
  want(by('ar-taa').locator.includes("'مدرسة'"), 'taa marbuta is not folded to ha');
  want(by('ar-tatweel').locator.includes('الخـدمات'), 'tatweel is kept');
  want(by('ar-hamza-a').locator !== by('ar-hamza-b').locator && !by('ar-hamza-a').locator.includes('.first()'), 'two labels that differ by hamza are two unique locators');
  want(by('lrm').locator.includes('\\u200e') || by('lrm').locator.startsWith('locator('), 'a bidi mark is shown as an escape or the candidate is skipped');
  want(!by('long130').locator.startsWith('getByRole') && by('long130').warnCodes?.includes('truncated'), 'a 130-character label gives no role candidate and says truncated');
  want(by('vis-save').locator.startsWith("getByRole('button', { name: 'Save'"), 'a hidden duplicate does not make the role locator ambiguous');
  want(!by('vis-cancel').locator.startsWith('getByText'), 'a hidden duplicate makes the text locator non-unique');
  want(by('anchored').xpath.startsWith("//*[@id='app-root']"), 'an id-anchored xpath stays id-anchored');
  want(/^\/html\/body/.test(by('edit-1').xpath), 'a root xpath starts with one slash');
  return bad;
}
