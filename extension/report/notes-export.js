/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The «Export notes» buttons on the Timeline tab (ui-1019). A separate file on purpose: report.js is at its line ratchet.
 * It reads the loaded session from `window.UQAReport.mail` (set by report.js once the verdict is drawn) at press time.
 */
(() => {
  const say = (key, tone = '', vars) => {
    const s = document.getElementById('status');
    if (!s) return;
    s.textContent = window.QAWi18n.t(key, vars);
    s.className = `status ${tone}`;
  };
  async function run(format) {
    const ctx = window.UQAReport?.mail;
    if (!ctx) return say('report.timeline.exportNone', 'err');
    const { buildNotesExport } = await import('./notes-build.js');
    const out = buildNotesExport(ctx.session, ctx.events, format);
    if (!out.count) return say('report.timeline.exportNone', 'err');
    // exp1022: Documents/<title> <date>/<title> <date> notes.<ext>, like the Save sheet's notes file.
    const filing = await import('../core/filing.js');
    out.filename = filing.notesPath(ctx.session, format === 'csv' ? 'csv' : 'md');
    const res = await window.UQADownload.downloadText(out.content, out.filename, out.mime);
    say(res.ok ? 'report.timeline.exported' : 'report.timeline.exportFailed', res.ok ? 'ok' : 'err', { n: out.count, name: out.filename });
  }
  for (const [id, format] of [['export-notes', 'markdown'], ['export-notes-csv', 'csv']]) {
    document.getElementById(id)?.addEventListener('click', () => { run(format).catch(() => say('report.timeline.exportFailed', 'err')); });
  }
})();
