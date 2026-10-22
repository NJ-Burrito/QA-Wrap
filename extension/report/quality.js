/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The report Quality tab: renderQuality. A sibling of report.js on the same global scope, loaded before it; called at event time only. */
/* ── quality ───────────────────────────────────────────────────────────── */

async function renderQuality() {
  const perf = [...events].reverse().find((e) => e.kind === 'perf');
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  const links = [...events].reverse().find((e) => e.kind === 'links');
  const harvest = [...events].reverse().find((e) => e.kind === 'harvest');
  $('count-quality').textContent = (perf ? 1 : 0) + (a11y ? 1 : 0) + (links ? 1 : 0) + (harvest ? 1 : 0) || '';
  $('quality-empty').hidden = !!(perf || a11y || links || harvest);

  /*
   * The fine print, rendered as four words and nothing softer.
   *
   * DECLARED, OBSERVED, GAP and MANUAL are the whole vocabulary, and the block
   * uses them literally: a GAP is where what the page says and what it does
   * disagree, and it is the finding the check exists to produce. The manual
   * questions are drawn in their own list, never with a status a reader could
   * mistake for a result.
   */
  const fine = [...events].reverse().find((e) => e.kind === 'fineprint');
  $('fineprint-block').hidden = !fine;
  if (fine) {
    const host = $('fineprint');
    host.replaceChildren();
    const c = fine.counts || {};
    host.append(
      el(
        'p',
        'muted',
        t('report.fine.counts', {
          checks: t((c.total ?? 0) === 1 ? 'report.count.machineCheckOne' : 'report.count.machineCheckMany', { n: c.total ?? 0 }),
          declared: c.declared ?? 0,
          observed: c.observed ?? 0,
          gaps: t((c.gaps ?? 0) === 1 ? 'report.count.gapOne' : 'report.count.gapMany', { n: c.gaps ?? 0 }),
        }) +
          (c.unmeasured ? t('report.fine.unmeasured', { n: c.unmeasured }) : '') +
          `. ${t('report.fine.manualLine', { questions: t((c.manual ?? 0) === 1 ? 'report.count.questionOne' : 'report.count.questionMany', { n: c.manual ?? 0 }) })}`
      )
    );
    // Which documents the answer covers, before any row of it is read.
    host.append(
      el(
        'p',
        'fine',
        (fine.frames || []).length
          ? t('report.fine.readInList', { frames: framesRead(fine), list: fine.frames.map((f) => f.url).join(', ') })
          : t('report.fine.readIn', { frames: framesRead(fine) })
      )
    );
    for (const check of fine.checks || []) {
      const row = el('div', 'a11y-row');
      /*
       * MANUAL gets its own mark, and it is not the one DECLARED wears.
       *
       * The `: 'sev-minor'` tail used to catch DECLARED and MANUAL together, so
       * a row the browser could not measure — no cookies to read, no HTTPS to
       * see — was painted exactly like a row that passed. That is the one
       * mistake this block cannot make: it turns "nobody checked" into "fine".
       */
      const tone = check.status === 'GAP'
        ? 'sev-serious'
        : check.status === 'MANUAL'
          ? 'sev-unknown'
          : check.status === 'OBSERVED' ? 'sev-moderate' : 'sev-minor';
      row.append(el('span', `impact ${tone}`, check.status));
      const mid = el('div');
      mid.append(el('p', 'a11y-help', check.title));
      mid.append(el('code', 'a11y-rule', check.detail));
      row.append(mid);
      host.append(row);
    }
    if (fine.manual?.length) {
      host.append(el('h3', null, t('report.fine.manualTitle')));
      const list = el('ul', 'fine-manual');
      for (const m of fine.manual) {
        const item = el('li');
        item.append(el('b', null, m.title), el('span', 'muted', ` (${m.law}). `), el('span', null, m.how));
        list.append(item);
      }
      host.append(list);
    }
  }

  $('links-block').hidden = !links;
  if (links) {
    const host = $('links');
    host.replaceChildren();
    host.append(
      el('p', 'muted', t('report.links.counts', {
        links: t(links.total === 1 ? 'report.count.linkOne' : 'report.count.linkMany', { n: links.total }),
        checked: links.checked,
        broken: links.broken.length,
        redirected: links.redirected.length,
        slow: links.slow.length,
        skipped: links.skipped,
      }))
    );
    // The words are already lower case in the table, so the `.toLowerCase()`
    // that used to sit on the pill is gone: it is a no-op in Arabic and would
    // have been the one place a translated word was reshaped by English rules.
    for (const [title, rows, cls] of [[t('report.links.broken'), links.broken, 'sev-critical'], [t('report.links.redirected'), links.redirected, 'sev-moderate'], [t('report.links.slow'), links.slow, 'sev-minor']]) {
      for (const r of rows) {
        const row = el('div', 'a11y-row');
        row.append(el('span', `impact ${cls}`, title));
        const mid = el('div');
        // The link's words and its URL are two lines, not one string. As
        // siblings they were both inline, so a link labelled "Downloads"
        // rendered as `Downloadshttp://127.0.0.1:8973/forms/2019.pdf` with
        // nothing between them. The a11y rows above have always put the
        // sentence in a block and the code under it; this is the same shape.
        const label = el('p', 'a11y-help');
        label.append(safeLink(r.href, null, r.text || r.href));
        mid.append(label);
        mid.append(el('code', 'a11y-rule', r.finalUrl ? `${r.href} › ${r.finalUrl}` : r.href));
        row.append(mid);
        row.append(el('span', 'a11y-n', r.status ? String(r.status) : werr(r) || `${r.ms} ms`));
        host.append(row);
      }
    }
    // D-236: a link the checker would not request because its query carries a secret-named parameter. Listed with the
    // reason, and never as a link or with its query: the query is the secret.
    const heldBack = (Array.isArray(links.skipped) ? links.skipped : (links.rows || []).filter((r) => r.state === 'skipped')).filter((r) => r.reason === 'secret-query');
    for (const r of heldBack) {
      let shown = String(r.href || '');
      try { const u = new URL(shown); shown = `${u.origin}${u.pathname}?…`; } catch { shown = ''; }
      const row = el('div', 'a11y-row');
      const mid = el('div');
      if (r.text) mid.append(el('p', 'a11y-help', r.text));
      if (shown) mid.append(el('code', 'a11y-rule', shown));
      mid.append(el('p', 'muted', t('report.links.skipSecret')));
      row.append(mid);
      host.append(row);
    }
    if (!links.broken.length && !links.redirected.length && !links.slow.length && !heldBack.length) host.append(el('p', 'muted', t('report.links.allFine')));
  }

  $('harvest-block').hidden = !harvest;
  if (harvest) {
    const host = $('harvest');
    host.replaceChildren();
    const c = harvest.counts || {};
    const grid = el('div', 'metric-grid');
    // The id is what the tone is chosen by, and it never moves; the name is
    // what the reader sees, and it does.
    for (const [id, name, v] of [
      ['elements', t('report.harvest.elements'), c.elements],
      ['verified', t('report.harvest.verified'), c.unique],
      ['ambiguous', t('report.harvest.ambiguous'), c.ambiguous],
      ['forms', t('report.harvest.forms'), c.forms],
    ]) {
      const m = el('div', `metric rating-${id === 'ambiguous' && v ? 'needs-improvement' : 'good'}`);
      m.append(el('span', 'metric-k', name), el('span', 'metric-v', String(v ?? 0)), el('span', 'metric-r', id === 'ambiguous' ? (v ? t('report.harvest.needAHand') : t('report.harvest.none')) : ''));
      grid.append(m);
    }
    host.append(grid);
    const kinds = Object.entries(c.byKind || {}).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ');
    host.append(el('p', 'muted', `${kinds}${harvest.truncated ? t('report.harvest.truncated') : ''}. ${t('report.harvest.note')}`));
  }

  /*
   * Page speed, as a distance rather than a verdict.
   *
   * The tiles used to say "3200ms" and "poor" and stop there, which tells a
   * reader the answer and nothing about the size of the job: 3200 is a fifth
   * of the way past the boundary and 9000 is not, and those are different
   * afternoons. Each tile now carries the two published boundaries behind the
   * measurement, so the gap is the thing on screen.
   */
  $('perf-block').hidden = !perf;
  if (perf) {
    const host = $('perf');
    host.replaceChildren();
    const grid = el('div');
    host.append(grid);
    await window.UQACharts?.meters(grid, {
      metrics: [
        { key: 'lcp', label: 'LCP', unit: 'ms', value: perf.metrics?.lcp },
        { key: 'cls', label: 'CLS', unit: '', value: perf.metrics?.cls },
        { key: 'inp', label: 'INP', unit: 'ms', value: perf.metrics?.inp },
        { key: 'fcp', label: 'FCP', unit: 'ms', value: perf.metrics?.fcp },
        { key: 'ttfb', label: 'TTFB', unit: 'ms', value: perf.metrics?.ttfb },
      ],
      caption: t('report.chart.metersCaption'),
    });
    const r = perf.resources || {};
    host.append(
      el('p', 'muted', t('report.perf.resources', {
        requests: t((r.count ?? 0) === 1 ? 'report.count.requestOne' : 'report.count.requestMany', { n: r.count ?? 0 }),
        bytes: kb(r.bytes ?? 0),
        cached: r.cachedCount ?? 0,
        longTasks: t((perf.longTasks?.count ?? 0) === 1 ? 'report.count.longTaskOne' : 'report.count.longTaskMany', { n: perf.longTasks?.count ?? 0 }),
      }))
    );
  }

  $('a11y-block').hidden = !a11y;
  if (a11y) {
    const host = $('a11y');
    host.replaceChildren();
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    host.append(el('p', 'muted', t('report.a11y.summary', {
      issues: t(a11y.total === 1 ? 'report.count.issueOne' : 'report.count.issueMany', { n: a11y.total }),
      rules: t(a11y.violations.length === 1 ? 'report.count.ruleOne' : 'report.count.ruleMany', { n: a11y.violations.length }),
    })));

    /*
     * The flow's findings, folded, above the last scan's list.
     *
     * A five-page form with one bad header produces five scans and five copies
     * of the same sentence, and a reader cannot tell five problems from one.
     * The fold answers that: the same rule on the same *shape* of selector is
     * one finding with the pages it appeared on. It is drawn first because it
     * is the answer; the per-rule list underneath stays, because a tester
     * fixing one page still wants that page's list.
     */
    const folded = await foldFlow();
    if (folded && folded.counts.pages > 1) {
      const head = el('div', 'a11y-fold');
      head.append(el('h3', null, t('report.a11y.foldTitle')));
      head.append(el('p', 'muted', t('report.a11y.foldNote', {
        findings: t(folded.counts.unique === 1 ? 'report.count.uniqueFindingOne' : 'report.count.uniqueFindingMany', { n: folded.counts.unique }),
        pages: t(folded.counts.pages === 1 ? 'report.count.pageOne' : 'report.count.pageMany', { n: folded.counts.pages }),
        raw: t(folded.counts.raw === 1 ? 'report.count.rawViolationOne' : 'report.count.rawViolationMany', { n: folded.counts.raw }),
      }) + (folded.counts.everywhere ? ` ${t('report.a11y.foldEverywhere', { n: folded.counts.everywhere })}` : '')));
      host.append(head);
      for (const f of folded.findings.slice(0, 40)) {
        const row = el('div', 'a11y-row');
        row.append(el('span', `impact sev-${f.impact}`, impactWord(f.impact)));
        const mid = el('div');
        mid.append(el('p', 'a11y-help', `${f.help}${f.isNew ? '' : ''}`));
        mid.append(el('code', 'a11y-rule', `${f.rule} · ${f.component}`));
        mid.append(el('p', 'a11y-where', describeFold(f)));
        row.append(mid);
        const count = el('span', 'a11y-n');
        count.append(el('span', null, t(f.pages.length === 1 ? 'report.count.pageOne' : 'report.count.pageMany', { n: f.pages.length })));
        if (f.isNew) count.append(el('span', 'is-new', t('report.a11y.new')));
        row.append(count);
        host.append(row);
      }
      host.append(el('p', 'muted', t('report.a11y.foldGrouped')));
    }
    /*
     * The findings, with the detail beside them (F7, and Group E's E14).
     *
     * Nader's complaint was exact: the accessibility check "keeps pointing to
     * the timeline for more details". It did, and the details were never in the
     * timeline either. They were on the event the whole time: axe records the
     * selector of every failing element, the markup it found there, and its own
     * failure summary explaining what is wrong with it, and this page threw all
     * three away and printed a count.
     *
     * So the elements are here, folded, with the rule's own documentation one
     * click away and a button that opens the page and highlights the element.
     * Nothing sends the reader anywhere else to find out what a finding means.
     */
    const impacts = ['critical', 'serious', 'moderate', 'minor'];
    const spread = impacts
      .map((name) => ({
        key: name,
        label: impactWord(name),
        value: a11y.violations.filter((v) => (v.impact || 'minor') === name).reduce((n, v) => n + (v.count || 1), 0),
        tone: name === 'critical' ? 'bad' : '',
      }))
      .filter((row) => row.value);
    if (spread.length > 1) {
      const chartHost = el('div');
      host.append(chartHost);
      await window.UQACharts?.bars(chartHost, {
        rows: spread,
        title: t('report.a11y.impactTitle'),
        caption: t('report.a11y.impactCaption'),
        unit: '',
      });
    }

    [...a11y.violations]
      .sort((x, y) => (order[x.impact] ?? 9) - (order[y.impact] ?? 9))
      .forEach((v) => {
        const row = el('div', 'a11y-row');
        row.append(el('span', `impact sev-${v.impact || 'minor'}`, v.impact ? impactWord(v.impact) : t('report.a11y.impactNone')));
        const mid = el('div');
        mid.append(el('p', 'a11y-help', v.help));
        mid.append(el('code', 'a11y-rule', v.id));

        if (v.nodes?.length) {
          const det = el('details', 'a11y-detail');
          det.append(
            el(
              'summary',
              null,
              v.count > v.nodes.length
                ? t('report.a11y.keptElements', {
                    elements: t(v.nodes.length === 1 ? 'report.count.elementOne' : 'report.count.elementMany', { n: v.nodes.length }),
                    total: v.count,
                  })
                : t('report.a11y.showElements', {
                    elements: t(v.nodes.length === 1 ? 'report.count.elementOne' : 'report.count.elementMany', { n: v.nodes.length }),
                  })
            )
          );
          for (const node of v.nodes) {
            const item = el('div', 'a11y-node');
            const sel = el('code', null, node.target || t('report.a11y.noSelector'));
            sel.title = t('report.a11y.copySelectorTitle');
            sel.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(node.target || '');
                say(t('report.status.selectorCopied'));
              } catch {
                say(t('report.status.clipboardFailed'), 'err');
              }
            });
            item.append(sel);
            if (node.html) item.append(el('pre', null, node.html));
            // axe writes this sentence, and it is the one that says what is
            // actually wrong. Printing a rule id instead of it was the whole
            // reason this section felt like a dead end.
            if (node.summary) item.append(el('p', 'a11y-why', node.summary));

            const actions = el('div', 'a11y-actions');
            /*
             * `UQA_HIGHLIGHT` already existed and already does exactly this:
             * it finds the tab under test and asks the picker to draw a ring
             * round the selector. Adding a second message that opens a page and
             * highlights in it would have been a second thing to keep working;
             * this reuses the one the popup's own findings use, so the two
             * surfaces behave the same and there is one place to fix.
             */
            const show = el('button', 'btn btn-xs', t('report.a11y.showOnPage'));
            show.title = t('report.a11y.showOnPageTitle');
            show.addEventListener('click', async () => {
              show.disabled = true;
              const out = await send({ type: 'UQA_HIGHLIGHT', selector: node.target });
              show.disabled = false;
              say(
                out.ok
                  ? t('report.a11y.highlighted')
                  : werr(out) || t('report.a11y.highlightFailed'),
                out.ok ? 'ok' : 'err'
              );
            });
            actions.append(show);
            if (safeHref(v.helpUrl)) actions.append(safeLink(v.helpUrl, 'a11y-doc', t('report.a11y.ruleDoc')));
            item.append(actions);
            det.append(item);
          }
          mid.append(det);
        }

        row.append(mid);
        const where = frameNote(v, a11y.url);
        if (where) mid.append(el('p', 'fine', t('report.a11y.inFrame', { url: iso(where) })));
        row.append(el('span', 'a11y-n', t(v.count === 1 ? 'report.count.elementOne' : 'report.count.elementMany', { n: v.count })));
        host.append(row);
      });
  }
}
