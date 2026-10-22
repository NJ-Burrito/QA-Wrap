/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-043 (G03): the engine's locators against real Chromium. `agreement N/N` is the pass line (the report's own exit
 * ramp is 95 percent; this suite is stricter, any disagreement is red). No Chromium: prints SKIPPED and exits 2 (skip protocol,
 * test pipeline 2.7: a skipped suite is never a pass); tools/release-check.mjs greps the line and refuses a release.
 *
 *   node tools/test-locator-truth.mjs [--engine <path to selector-engine.js>]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { truthAll, namedChecks, FIXTURES } from './lib-truth.mjs';
import { buildReverseSrs } from '../core/srs-reverse.js';
import { sanitiseEvent } from '../core/events.js';

const argv = process.argv.slice(2);
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = argv.includes('--engine') ? path.resolve(argv[argv.indexOf('--engine') + 1]) : path.join(EXT, 'content', 'selector-engine.js');

let browser;
try { browser = await chromium.launch({ headless: true }); } catch (e) { console.log(`SKIPPED: no Chromium (${String(e.message).split('\n')[0]})`); process.exit(2); }
try {
  const page = await browser.newPage();
  const res = await truthAll(page, engine);
  const bad = res.filter((r) => !r.ok);
  const named = namedChecks(res);
  for (const n of named) console.log(`  FAIL named: ${n}`);
  for (const r of bad) console.log(`  FAIL ${r.file} ${r.id}: ${r.why}`);
  // G05: the spec reader in a real page with an iframe: each frame asked by id, masked words never in the model.
  const spec = await specFrames(browser);
  for (const n of spec) console.log(`  FAIL spec reader: ${n}`);
  bad.push(...spec);
  // T-043: the engine's warnings take the road the recorder gives them (`locatorWarnings`) through the ingest
  // allow-list, and arrive as `warnCodes` the report words.
  const codes = await warnRoad(page);
  for (const n of codes) console.log(`  FAIL warn codes: ${n}`);
  bad.push(...codes);
  // D-1010-101 (r5-05-3): open shadow roots are pierced the way Playwright pierces them; XPath is not offered on such a page.
  const shadow = await shadowRoad(page);
  for (const n of shadow) console.log(`  FAIL shadow: ${n}`);
  bad.push(...shadow);
  console.log(`agreement ${res.length - bad.length}/${res.length}`);
  process.exitCode = bad.length || named.length ? 1 : 0;
  if (!bad.length && !named.length) console.log('spec reader frames and masks: ok');
} finally { await browser.close(); }

async function warnRoad(page) {
  const out = [];
  await page.goto(pathToFileURL(path.join(FIXTURES, 'bidi.html')).href);
  await page.addScriptTag({ content: fs.readFileSync(engine, 'utf8') });
  const desc = await page.evaluate(() => { const d = window.UQASelector.describe(document.querySelector('[data-truth=long130]')); return { warnings: d.warnings, warnCodes: d.warnCodes, matches: d.matches }; });
  const clean = sanitiseEvent({ kind: 'dom', action: 'click', locator: 'x', locatorMatches: desc.matches, locatorWarnings: desc.warnings });
  if (!desc.warnCodes.includes('truncated')) out.push('the 130-character label names no code');
  // completion review 4: a testid locator never quoted the label, so it carries no warning about it.
  const tid = await page.evaluate(() => { const d = window.UQASelector.describe(document.querySelector('[data-warncase=testid130]')); return { strategy: d.strategy, warnCodes: d.warnCodes, warnings: d.warnings }; });
  if (tid.strategy !== 'testid') out.push(`the testid fixture chose ${tid.strategy}, so the case proves nothing`);
  if (tid.warnCodes.length || tid.warnings.some((w) => w.startsWith('code:'))) out.push(`a testid locator carries ${JSON.stringify(tid.warnCodes)} for a label it did not quote`);
  if (JSON.stringify(clean.warnCodes) !== '["truncated"]') out.push(`ingest kept ${JSON.stringify(clean.warnCodes)}, not ["truncated"]`);
  if (clean.locatorWarnings.some((w) => w.startsWith('code:'))) out.push('a code token stayed in the sentences');
  return out;
}

async function specFrames(b) {
  const out = [];
  const want = (c, m) => { if (!c) out.push(m); };
  const page = await b.newPage();
  await page.addInitScript(() => {
    window.chrome = { runtime: { id: 'x', onMessage: { addListener: (fn) => { window.__ask = () => new Promise((r) => fn({ type: 'UQA_READ_SPEC' }, { id: 'x' }, r)); } } } };
    // The masking contract mask.js keeps: an element is masked when it or an ancestor carries data-uqa-masked.
    window.UQAMask = { isMasked: (el) => !!el.closest?.('[data-uqa-masked]') };
  });
  await page.goto(pathToFileURL(path.join(FIXTURES, 'spec-frames.html')).href);
  const reader = fs.readFileSync(path.join(EXT, 'content', 'spec-reader.js'), 'utf8');
  await page.waitForFunction(() => window.frames.length === 1 && window.frames[0].document.readyState === 'complete');
  for (const f of page.frames()) await f.addScriptTag({ content: reader });
  const [top, inner] = await Promise.all(page.frames().map((f) => f.evaluate(() => window.__ask())));
  want(top.title === 'Top frame' && inner.title === 'Inner frame', 'each frame answers for itself');
  want(!JSON.stringify(top).includes('SECRET-42'), 'masked words are absent from the model');
  want(top.withheld >= 4, `withheld counts masked roots (${top.withheld})`);
  want(inner.forms[0].fields[0].name === 'age', 'the inner frame is read as its own page');
  const md = buildReverseSrs({ model: { ...top, frames: [{ url: 'https://x.test/inner', model: inner }, { url: 'https://x.test/gone', model: null, why: 'no answer in 6 s' }] } });
  want(!md.includes('SECRET-42'), 'masked words are absent from the Markdown');
  want(/\*\*Frame: https:\/\/x\.test\/inner\*\*/.test(md) && md.includes('F2:FR-F1'), 'the inner frame is its own labelled section');
  want(/Frame not read \(no answer in 6 s\)/.test(md), 'a frame that cannot be read is a GAP line');
  want(/withheld by masking/.test(md), 'the withheld count is stated');
  await page.close();
  return out;
}

async function shadowRoad(page) {
  const out = [];
  await page.goto(pathToFileURL(path.join(FIXTURES, 'shadow.html')).href);
  await page.addScriptTag({ content: fs.readFileSync(engine, 'utf8') });
  const descs = await page.evaluate(() => [...document.querySelectorAll('[data-truth]'), ...document.getElementById('host').shadowRoot.querySelectorAll('[data-truth]')].map((el) => {
    const d = window.UQASelector.describe(el);
    return { id: el.getAttribute('data-truth'), d: d && { playwright: d.playwright, matches: d.matches, ambiguous: d.ambiguous, strategy: d.strategy } };
  }));
  for (const { id, d } of descs) {
    if (!d) { out.push(`${id}: engine described nothing`); continue; }
    const bare = d.playwright.replace(/\.first\(\)$/, '');
    const count = await new Function('page', `return ${bare}`)(page).count();
    if (count !== d.matches) out.push(`${id}: playwright count ${count} vs engine matches ${d.matches} [${d.playwright}]`);
    if (d.strategy === 'xpath') out.push(`${id}: xpath chosen on a page with an open shadow root`);
  }
  const by = (id) => descs.find((x) => x.id === id)?.d;
  if (by('shadow-only')?.strategy !== 'testid' || by('shadow-only')?.matches !== 1) out.push(`a shadow-only test id should resolve to 1, got ${JSON.stringify(by('shadow-only'))}`);
  for (const id of ['dup-light', 'dup-shadow']) if (by(id)?.strategy === 'testid' && by(id)?.matches === 1) out.push(`${id}: a light/shadow duplicate test id was counted unique`);
  return out;
}
