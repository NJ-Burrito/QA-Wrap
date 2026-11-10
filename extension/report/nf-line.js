/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The report page's network filter lines (D1): "M real failures, N hidden, K third-party" under the problem number, and
 * "N calls hidden by filter (preset)" at its foot. An ES module loaded with import() by report.js, because that file is at
 * its line ceiling. Reads the tester's preset and rules from chrome.storage.local (`qaw.netfilter`).
 */
import { DEFAULT_CONFIG, prepare, summary, siteOf } from '../core/netfilter.js';
import { visibleProblems } from '../core/signal.js';

const KEY = 'qaw.netfilter';

export async function mount(box, events, session, t, el) {
  let cfg = DEFAULT_CONFIG;
  try { cfg = { ...DEFAULT_CONFIG, ...(/** @type {any} */ ((await chrome.storage.local.get(KEY))[KEY]) || {}) }; } catch { /* the default preset */ }
  const site = siteOf(session); // the registrable domain, the same key the panel stores rules under
  const prep = prepare(events, cfg, site);
  const sum = summary(prep, { preset: cfg.preset });
  const sig = visibleProblems(prep);
  const preset = t(`common.nf.preset.${cfg.preset}`);
  box.append(el('p', 'sg-line nf-counts', t('common.nf.counts', { m: sig.errors, n: sum.hiddenTotal, k: sig.warnings })));
  if (sum.recovered) box.append(el('p', 'sg-line', t('common.nf.recovered', { n: sum.recovered })));
  const noName = new Set(events.filter((e) => e.kind === 'dom' && e.unnamed === 'none').map((e) => String(e.locator || e.selector || e.tag))).size;
  if (noName) box.append(el('p', 'sg-line nf-noname', t(noName === 1 ? 'report.v.noNameOne' : 'report.v.noNameMany', { n: noName }))); // D10: an accessibility finding
  box.append(el('p', 'sg-line nf-total', t('common.nf.hiddenLine', { n: sum.hiddenTotal, preset })));
}
