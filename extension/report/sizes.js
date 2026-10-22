/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The report window-sizes view: renderSizes. A sibling of report.js on the same global scope, loaded before it; called at event time only. */
/* ── window sizes ──────────────────────────────────────────────────────── */

/**
 * "Check another size" opened a real window; this is what happened in it.
 *
 * The shape is fixed by `research/55-window-sizes-contract.md`, agreed with
 * Groups E and G before any of the three halves was written, and the two rules
 * that matter to this page are section 8 and section 9.
 *
 * **Section 8: read the fold, do not repeat it.** A run is two events on the
 * parent session's stream, an `opened` and a `closed` joined by `runId`. Group G
 * built `UQA_VIEWPORT_RUNS`, which folds them in the place that already holds
 * the data, so there is one fold in the product rather than two that can
 * disagree about a run that never closed.
 *
 * **Section 9: never re-derive inheritance from settings.** If `inherited.video`
 * is false then the run had no video, whatever the settings happen to say by
 * the time somebody opens this report. The flags record what was true at the
 * moment the window was created, and treating them as a preference to be
 * re-read would turn a fact into a guess.
 *
 * The refusals are shown as prominently as the inheritance, because a run that
 * quietly did less than the tester asked is the failure mode this whole section
 * exists to make visible. Section 5's amendment means a clip is refused for
 * every run while the parent is recording, and a tester who does not know that
 * would conclude their evidence was captured when it was not.
 */
async function renderSizes() {
  const host = $('sizes');
  const summary = $('sizes-summary');
  if (!host) return;

  const res = await send({ type: 'UQA_VIEWPORT_RUNS', sessionId });
  const raw = res.ok ? res.result || [] : [];
  const { runRow, describeRun, joinWords } = await import('../core/chart-model.js');
  const runs = raw.map(runRow);

  $('count-sizes').textContent = runs.length || '';
  host.replaceChildren();

  if (!runs.length) {
    $('sizes-chart-block').hidden = true;
    summary.textContent = '';
    const empty = el('div', 'empty');
    empty.append(
      iconP('i-sizes'),
      el('h2', null, t('report.sizes.emptyTitle')),
      el('p', 'muted', t('report.sizes.emptyNote'))
    );
    host.append(empty);
    return;
  }

  const open = runs.filter((r) => r.closedAt == null).length;
  // "Checked", not "opened": half of these runs open nothing. While a clip is
  // recording the session's own window is resized in place, so that the run
  // lands inside the clip — see the note on each such row.
  const sizeCount = new Set(runs.map((r) => r.viewport?.id)).size;
  summary.textContent =
    t('report.sizes.summary', {
      runs: t(runs.length === 1 ? 'report.count.runOne' : 'report.count.runMany', { n: runs.length }),
      sizes: t(sizeCount === 1 ? 'report.count.sizeOne' : 'report.count.sizeMany', { n: sizeCount }),
    }) +
    `${open ? t('report.sizes.stillOpenN', { n: open }) : ''}${t('report.sizes.summaryTail')}`;

  for (const run of runs) {
    const card = el('article', 'size-card');

    const head = el('div', 'size-head');
    head.append(el('h3', 'size-name', run.viewport?.label || t('report.sizes.aWindow')));
    const asked = run.viewport ? `${run.viewport.width}×${run.viewport.height}` : t('report.sizes.noSize');
    head.append(el('span', 'size-dims', asked));
    // Which of the two routes this run took, said on the row, because "where
    // did my recording go" has a different answer for each.
    head.append(
      el('span', 'size-route', run.mode === 'resized' ? t('report.sizes.routeResized') : t('report.sizes.routeNew'))
    );
    card.append(head);

    /*
     * The size Chrome actually gave, whenever it is not the size asked for.
     *
     * `chrome.windows.create` sizes the outer window, so the page inside is
     * short by the frame and the toolbar, and that difference is exactly the
     * margin a broken breakpoint hides in. Saying only what was requested would
     * report a test that was never run at that width.
     */
    if (run.measured) {
      const got = `${run.measured.w}×${run.measured.h}`;
      if (got !== asked) {
        card.append(
          el(
            'p',
            'size-short',
            t('report.sizes.short', { got, w: run.shortBy?.w || 0, h: run.shortBy?.h || 0 })
          )
        );
      }
    }

    /*
     * A size the browser would not give, said as plainly as it deserves.
     *
     * `exact` is the worker's answer to "is this the size that was asked for",
     * and it is a separate fact from the pixels above. A run that asked for
     * 768 and was clamped by Chrome to its own minimum used to be reported as
     * a success with the wrong number quietly attached beside it — a test
     * recorded as having been run at a width it was never run at, which is
     * worse than no test at all.
     */
    if (run.exact === false) {
      card.append(
        el(
          'p',
          'size-short',
          run.measured
            ? t('report.sizes.notExact', { asked })
            : t('report.sizes.notMeasured', { asked })
        )
      );
    }

    const tags = el('div', 'size-tags');
    for (const [key, word] of [
      ['video', t('report.sizes.tagVideo')],
      ['mask', t('report.sizes.tagMask')],
      ['mic', t('report.sizes.tagMic')],
      ['tabAudio', t('report.sizes.tagTabAudio')],
    ]) {
      const on = !!run.inherited?.[key];
      const refused = (run.refused || []).includes(key);
      // Three states and three words, never a colour on its own: carried over,
      // refused, or simply not on in the session it came from.
      tags.append(el('span', `size-tag ${on ? 'is-on' : refused ? 'is-off' : ''}`.trim(), on ? word : refused ? t('report.sizes.tagNo', { word }) : word));
    }
    card.append(tags);

    card.append(el('p', 'size-facts', describeRun(run)));

    if (run.refused?.length) {
      card.append(
        el(
          'p',
          'size-facts',
          t('report.sizes.refused', { list: joinWords(run.refused) }) +
            // Only the video refusal has a route out of it, and only that
            // refusal should print one. A mask refusal followed by advice about
            // the recording shortcut is advice about the wrong thing.
            (run.refused.includes('video') ? t('report.sizes.videoRefusedHelp') : '')
        )
      );
    }

    /*
     * A run that happened inside the session's own clip.
     *
     * When the parent session is recording, "Check another size" does not open
     * a second window — a window this extension opened is one Chrome will not
     * film — it resizes the tester's own window, so the capture that is already
     * running keeps filming the same tab at the new size. There is no clip of
     * this run's own to show: there is a stretch of the session's clip, and the
     * useful thing to give the reader is the way into it at the right second.
     *
     * One clip, one home holds either way. The session's clip stays under
     * Screens & video, where it belongs, and this row links into it rather than
     * claiming it.
     */
    if (run.mode === 'resized' && run.clip?.mediaId) {
      const clip = media.find((m) => m.id === run.clip.mediaId);
      const from = clock(run.clip.offsetMs || 0);
      const to = run.clip.endOffsetMs != null ? clock(run.clip.endOffsetMs) : null;
      card.append(
        el(
          'p',
          'size-facts',
          clip
            ? to
              ? t('report.sizes.inClipTo', { from, to })
              : t('report.sizes.inClipEnd', { from })
            : to
              ? t('report.sizes.inClipGoneTo', { from, to })
              : t('report.sizes.inClipGone', { from })
        )
      );
      if (clip) {
        const seek = el('button', 'btn btn-xs', t('report.sizes.playFrom', { from }));
        seek.addEventListener('click', () =>
          lightbox(clip.id, clip.type || 'video/webm', { seekMs: run.clip.offsetMs || 0 })
        );
        const strip = el('div', 'size-media');
        strip.append(seek);
        card.append(strip);
      }
    }

    const facts = [
      fmtClock(run.openedAt),
      run.closedAt ? t('report.sizes.openFor', { time: secs(run.durationMs ?? run.closedAt - run.openedAt) }) : t('report.sizes.stillOpen'),
      run.reason && run.reason !== 'closed' ? run.reason.replace(/-/g, ' ') : null,
    ].filter(Boolean);
    card.append(el('p', 'size-facts', facts.join(' · ')));

    if (run.url) {
      card.append(safeLink(run.url, 'size-open', run.url));
    }

    // The clips filed against this run. One clip, one home: they are here and
    // deliberately not in the gallery.
    const clips = runMedia(run.runId);
    if (clips.length) {
      const strip = el('div', 'size-media');
      for (const clip of clips) {
        const play = el(
          'button',
          'btn btn-xs',
          t((clip.type || '').startsWith('image/') ? 'report.sizes.showClip' : 'report.sizes.playClip', { label: clip.label || t('report.sizes.theClip') })
        );
        play.addEventListener('click', () => lightbox(clip.id, clip.type || 'video/webm', { sourceEl: play }));
        const keep = el('button', 'btn btn-xs', t('report.media.save'));
        keep.addEventListener('click', () => saveOne(clip, keep));
        strip.append(play, keep);
      }
      card.append(strip);
    }

    host.append(card);
  }

  // How long each size was actually exercised. One series, one colour: the
  // question is which size got the attention, not which size is which.
  const timed = runs
    .filter((r) => r.durationMs || r.closedAt)
    .map((r) => ({
      key: r.runId,
      label: r.viewport?.label || t('report.sizes.aWindow'),
      value: Math.round((r.durationMs ?? r.closedAt - r.openedAt) / 1000),
    }));
  $('sizes-chart-block').hidden = timed.length < 2;
  if (timed.length >= 2) {
    await window.UQACharts?.bars($('chart-sizes'), {
      rows: timed,
      unit: 's',
      caption: t('report.sizes.chartCaption'),
    });
  }
}
