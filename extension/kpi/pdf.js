/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Export the dashboard as a PDF with the profile fine print (R4, R3).
 *
 * The PDF is the browser's own print-to-PDF of this page under kpi.css `@media print`: the words stay real text (selectable,
 * searchable), the charts stay vector SVG, Thmanyah is the page's own font and the page direction is the UI language's, so
 * Arabic is joined and right to left. Nothing is rasterised and nothing is uploaded.
 */

/**
 * THE ONE CALL SITE of the profile lane (core/profile.js, R3). It returns the trace line printed under the report
 * (name, date, tool version) or '' while that module is not in this build; the caller then prints the plain tool line.
 * @param {{ lang: string, date: string, version: string }} args
 */
export async function traceLine(args) {
  try {
    const mod = await import('../core/profile.js');
    await mod.loadProfile?.();
    return String((await mod.traceLine(args)) || '');
  } catch {
    return '';
  }
}

/**
 * Fill the print-only footer, print, and clear it again.
 * @param {{ lang: string, date: string, version: string, fallback: string, heading: string, scope: string }} o
 * @param {{ print?: () => void }} [env]
 */
export async function exportPdf(o, env = window) {
  const foot = document.getElementById('print-trace');
  const head = document.getElementById('print-scope');
  const title = document.title;
  const line = (await traceLine({ lang: o.lang, date: o.date, version: o.version })) || o.fallback;
  if (foot) foot.textContent = line;
  if (head) head.textContent = o.scope;
  document.title = `${o.heading} ${o.date}`; // the file name Chrome proposes
  const done = () => { document.title = title; if (foot) foot.textContent = ''; if (head) head.textContent = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  env.print?.();
  return line;
}
