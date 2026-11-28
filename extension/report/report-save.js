/* QA Wrap — report: save parts and presets, team, diagram, media refresh (split from report.js; classic script, same global scope). */
/**
 * The whole walk's accessibility findings, folded to unique ones.
 *
 * Loaded on demand: `core/a11y-flow.js` is only wanted when a report with more
 * than one scan is opened, and this page already imports enough.
 */
let foldMod = null;
async function foldFlow() {
  if (!events.some((e) => e.kind === 'a11y')) return null;
  foldMod ||= await import('../core/a11y-flow.js');
  return foldMod.foldFindings(events, { currentUrl: session?.startUrl || '' });
}

/** One line for where a folded finding was seen. */
function describeFold(f) {
  if (f.pages.length === 1) return t('report.a11y.foldOn', { page: iso(f.pages[0]) });
  if (f.everywhere) return t('report.a11y.foldEverywhereList', { list: f.pages.join(', ') });
  return t('report.a11y.foldPages', {
    pages: t(f.pages.length === 1 ? 'report.count.pageOne' : 'report.count.pageMany', { n: f.pages.length }),
    list: f.pages.join(', '),
  });
}

/** How many parts are ticked, said in the sheet rather than counted by eye. */
function paintSaveCount() {
  const boxes = [...$('save-parts').querySelectorAll('input[type="checkbox"]')];
  const on = boxes.filter((b) => b.checked).length;
  $('save-count').textContent = boxes.length
    ? on
      ? t('report.save.selected', { files: t(on === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: on }), total: boxes.length })
      : t('report.save.nothingSelected')
    : '';
  // Each section's pair says what that section is, so the tester can see at a
  // glance which ones are whole and which are partial.
  for (const fs of $('save-parts').querySelectorAll('fieldset.attach')) {
    const own = [...fs.querySelectorAll('input[type="checkbox"]')];
    const ticked = own.filter((b) => b.checked).length;
    fs.querySelector('[data-section-all]')?.setAttribute('aria-pressed', String(ticked === own.length));
    fs.querySelector('[data-section-none]')?.setAttribute('aria-pressed', String(ticked === 0));
  }
}

async function renderSaveParts() {
  const host = $('save-parts');
  const { isMoreFormat } = await filingLib();
  // T-049: formats off the keep-list move to a last, unticked "More" shelf.
  const groups = saveParts();
  const more = [];
  for (const g of groups) g.items = g.items.filter((it) => (isMoreFormat(it[0]) ? (more.push(it), false) : true));
  groups.push({ id: 'more', label: t('report.save.groupMore'), items: more });
  host.replaceChildren();
  for (const g of groups) {
    if (!g.items.length) continue;
    const fs = el('fieldset', 'attach');
    /*
     * All and None per section, not once for the sheet.
     *
     * "Everything" and "Nothing" at the foot are the two extremes, and a tester
     * saving a session almost never wants either: they want the documents and
     * not the eleven screenshots, or the evidence and none of the JSON. Doing
     * that with one button meant clearing all of it and re-ticking by hand.
     * These are real buttons in the tab order, they say which section they
     * belong to, and `aria-pressed` says whether that section is currently
     * whole or empty.
     */
    const head = el('div', 'attach-head');
    head.append(el('legend', null, g.label));
    const pair = el('div', 'attach-pick');
    for (const [word, on] of [[t('report.save.sectionAll'), true], [t('report.save.sectionNone'), false]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-quiet';
      b.textContent = word;
      b.dataset[on ? 'sectionAll' : 'sectionNone'] = g.id;
      b.setAttribute('aria-label', t('report.save.sectionAria', { word, group: g.label }));
      b.addEventListener('click', () => {
        for (const box of fs.querySelectorAll('input[type="checkbox"]')) box.checked = on;
        paintSaveCount();
      });
      pair.append(b);
    }
    head.append(pair);
    fs.append(head);
    const list = el('div', 'attach-list');
    for (const [id, label, note] of g.items) {
      const item = el('label', 'attach-item');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = id;
      box.checked = g.id !== 'more';
      box.dataset.group = g.id;
      box.addEventListener('change', paintSaveCount);
      item.append(box, el('span', 'attach-name', label), el('span', 'attach-note', note));
      list.append(item);
    }
    fs.append(list);
    host.append(fs);
  }
  paintSaveCount();
  renderPresets();
}

/** T-067: five chips above the shelves. A chip only ticks boxes; it never saves. */
async function renderPresets() {
  const { PRESETS, presetFormats } = await import('../core/presets.js');
  const row = $('save-presets');
  row.replaceChildren();
  for (const id of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-quiet';
    b.dataset.preset = id;
    b.textContent = t(`report.preset.${id}`);
    b.title = t(`report.preset.${id}.hint`);
    b.addEventListener('click', () => {
      const want = new Set(presetFormats(id));
      for (const box of $('save-parts').querySelectorAll('input[type="checkbox"]')) {
        if (!box.value.startsWith('media:')) box.checked = want.has(box.value);
      }
      paintSaveCount();
    });
    row.append(b);
  }
}

/**
 * Where the files are about to go, and whether the browser will list them.
 *
 * Built from `destination()` in core/filing.js rather than from `ROOT` and a
 * folder name, so this sheet, the Settings page and the sentence printed after
 * the save cannot disagree — and so a folder already called `QA Wrap` is
 * described the way it is actually written to, with one root and not two.
 *
 * The download-list half is the point. Nader saved thirty-eight files into a
 * granted folder and found nothing in his downloads; the sheet has to say that
 * before he presses the button, not after.
 */
async function saveWhere() {
  const { destination } = await filingLib();
  const handle = await window.UQAFolder?.get();
  const usable = handle ? await window.UQAFolder.usable() : null;
  // The remembered subfolder, in the sentence that says where things land. It
  // is the only half of "remember my folder" a browser extension is allowed to
  // keep: see DOWNLOAD_FOLDER_HELP in platform/settings.js.
  const folder = (settings?.downloadFolder || '').trim();
  return {
    handle,
    usable,
    path: destination({ folderName: usable ? handle.name : '', folder }),
    how: usable ? 'folder' : 'downloads',
  };
}

async function paintSaveWhere() {
  const { handle, usable, path } = await saveWhere();
  $('save-where').textContent = !handle
    ? t('report.save.whereDownloads', { path })
    : usable
      ? t('report.save.whereFolder', { path })
      : t('report.save.whereAsk', { name: handle.name });
  $('save-use-downloads').hidden = !handle;
}

async function openSaveDialog() {
  await renderSaveParts();
  paintSaveWhere();
  $('save-status').textContent = '';
  $('save-dialog').showModal();
  window.UQASound?.play('save.open');
  window.UQAVfx?.play('settle', $('save-dialog').querySelector('form'));
}

/**
 * Clicking outside the sheet closes it, as well as the × (D6).
 *
 * A `<dialog>` opened with `showModal()` fills the viewport: the backdrop is
 * painted by the dialog element itself, and the form inside it is what the
 * tester sees. So a click whose target *is* the dialog landed on the backdrop
 * and nowhere else, and a click anywhere on the form does not reach here at
 * all. That one comparison is the whole test, and it needs no overlay div, no
 * capture-phase listener and no coordinate arithmetic against
 * `getBoundingClientRect()`, which is the version that gets the edges wrong on
 * a scrolled or scaled page.
 *
 * `Escape` already closes it: `<dialog>` does that itself.
 */
$('save-dialog').addEventListener('click', (e) => {
  if (e.target === $('save-dialog')) $('save-dialog').close();
});

$('save-all').addEventListener('click', openSaveDialog);
$('copy-report').addEventListener('click', () => BF.headerCopy({ ctx: window.UQAReport.mail, t, say }));
$('save-close').addEventListener('click', () => $('save-dialog').close());
$('save-everything').addEventListener('click', () => { $('save-parts').querySelectorAll('input').forEach((i) => { i.checked = true; }); paintSaveCount(); });
$('save-none').addEventListener('click', () => { $('save-parts').querySelectorAll('input').forEach((i) => { i.checked = false; }); paintSaveCount(); });
/** D-1010-140: the keyed sentence on screen, the raw message only in the title. */
async function showFailure(node, err) {
  const { describeError } = await import('../platform/worker-errors.js');
  const d = describeError(err, t);
  node.textContent = d.text;
  (await import('../platform/worker-errors.js')).attachDetails(node, d, t);
}
$('save-pick-folder').addEventListener('click', async () => {
  try {
    const handle = await window.UQAFolder.choose();
    await send({ type: 'UQA_SET_SETTINGS', patch: { saveFolderName: handle.name } });
  } catch (err) {
    if (err?.name !== 'AbortError') showFailure($('save-status'), err);
  }
  paintSaveWhere();
});
$('save-use-downloads').addEventListener('click', async () => {
  await window.UQAFolder.clear();
  await send({ type: 'UQA_SET_SETTINGS', patch: { saveFolderName: '' } });
  paintSaveWhere();
});

$('save-go').addEventListener('click', async (e) => { if (e.detail > 1) return;
  const chosen = [...$('save-parts').querySelectorAll('input:checked')].map((i) => i.value);
  if (!chosen.length) return ($('save-status').textContent = t('report.save.nothingTicked'));
  const status = $('save-status');
  const failed = [];
  const written = [];
  // Which route each file actually took. Read back rather than assumed: a
  // granted folder that has become unwritable falls back to Downloads per
  // file, and that is the case the confirmation most needs to report.
  const routes = new Set();
  $('save-go').disabled = true; await window.UQAFolder?.usable({ prompt: true }); // the folder is asked for while the click is live: the exports below outlast it
  // Re-enabled in a `finally` below whatever any of this does: the button was
  // disabled here and re-enabled only on the success path, so one throw left
  // "Save everything" dead for the life of the page.
  try {

    const formats = chosen.filter((c) => !c.startsWith('media:') && c !== 'session-manifest');
    if ($('save-zip').checked && formats.length) {
      // T-067: one zip instead of one file per part; the worker builds every part and adds the pictures.
      status.textContent = t('report.save.savingFormat', { format: 'zip' });
      const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'bundle', parts: formats });
      if (!res.ok) failed.push(`zip: ${werr(res)}`);
      else {
        const out = await saveExport('bundle', res.result.content, res.result.mime, { encoding: res.result.encoding });
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path || res.result.filename) : failed.push(`zip: ${werr(out)}`);
      }
      formats.length = 0;
    }
    for (const format of formats) {
      status.textContent = t('report.save.savingFormat', { format });
      const res = await send({ type: 'UQA_EXPORT', sessionId, format });
      if (!res.ok) { failed.push(`${format}: ${werr(res)}`); continue; }
      const out = await saveExport(format, res.result.content, res.result.mime, { encoding: res.result.encoding });
      if (out.how) routes.add(out.how);
      out.ok ? written.push(out.path || res.result.filename) : failed.push(`${format}: ${werr(out)}`);
    }
    const wantShots = chosen.includes('media:screenshot');
    const wantClips = chosen.includes('media:recording');
    for (const item of media) {
      const isClip = item.kind === 'recording';
      if ((isClip && !wantClips) || (!isClip && !wantShots)) continue;
      status.textContent = t('report.save.savingItem', { label: item.label || item.kind });
      // Branched on the result, which is the whole point of there being one.
      const out = await saveOne(item, null);
      if (out?.how) routes.add(out.how);
      if (out?.ok) written.push(out.path || item.label || item.kind);
      else failed.push(`${item.label || item.kind}: ${werr(out) || t('report.save.unknownError')}`);
    }
    /*
     * The soundtrack, taken out of the clips that have one.
     *
     * `UQA_MEDIA_AUDIO` does the extraction in the worker (it is the side that
     * holds the bytes) and answers with a wav. The filename is built here, from
     * the same `evidencePath()` every other artefact goes through, so an audio
     * export lands in Recordings beside the clip it came from and carries the
     * same stamp — and the remembered "Save into" folder, like everything else.
     */
    /*
     * The reverse-engineered specification is already written.
     *
     * Every other document in this list is made on demand by the worker; this
     * one was made when the tester pressed the tool, and the Markdown is on the
     * event. Re-deriving it would read a page that has since changed and hand
     * back a different document under the same name.
     */
    if (chosen.includes('fine-print')) {
      const read = [...events].reverse().find((e) => e.kind === 'fineprint');
      if (!read?.markdown) failed.push(t('report.save.finePrintMissing'));
      else {
        status.textContent = t('report.save.savingFinePrint');
        // Its own format id, not `srs`. Filing it under the specification's
        // name is what put a 12 KB "Requirements specification (2).md" in
        // Nader's folder that was not one: see rule 5 in core/filing.js.
        const out = await saveExport('fine-print', read.markdown, 'text/markdown');
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.finePrintFailed', { error: werr(out) }));
      }
    }
    if (chosen.includes('spec-reverse')) {
      const read = [...events].reverse().find((e) => e.kind === 'spec');
      if (!read?.markdown) failed.push(t('report.save.specMissing'));
      else {
        status.textContent = t('report.save.savingSpec');
        const out = await saveExport('spec-reverse', read.markdown, 'text/markdown');
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.specFailed', { error: werr(out) }));
      }
    }
    if (chosen.includes('media:notes')) { const r = await (await import('./notes-file.js')).saveNotes({ session, events, filing: await filingLib(), settings, say: t }); r.routes.forEach((x) => routes.add(x)); written.push(...r.written); failed.push(...r.failed); }
    if (chosen.includes('media:audio')) { const { evidencePath } = await filingLib();
      const clips = media.filter(hasSound).sort((a, b) => a.ts - b.ts);
      for (const [i, clip] of clips.entries()) {
        status.textContent = t('report.save.savingAudio', { label: clip.label || t('report.save.theRecording') });
        const filename = evidencePath({ ...clip, type: 'audio/wav' }, i + 1, session, {
          clock: settings?.clock || '24',
          folder: settings?.downloadFolder || '',
        }).replace(/\.[^./]+$/, '.wav');
        const res = await send({ type: 'UQA_MEDIA_AUDIO', id: clip.id, filename, saveAs: !!settings?.saveAs });
        if (res?.ok) { routes.add('downloads'); written.push(res.result?.path || filename); }
        else failed.push(t('report.save.audioFailed', { label: clip.label || t('report.save.aRecording'), error: werr(res) || t('report.save.unknownError') }));
      }
    }
    if (chosen.includes('session-manifest')) {
      // Written last, so the card lists what was actually saved beside it.
      const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'session-manifest', files: written });
      if (!res.ok) failed.push(t('report.save.cardFailed', { error: werr(res) }));
      else {
        const out = await saveExport('session-manifest', res.result.content, res.result.mime);
        if (out.how) routes.add(out.how);
        out.ok ? written.push(out.path) : failed.push(t('report.save.cardFailed', { error: werr(out) }));
      }
    }

    /*
     * The confirmation, which is the whole of D2.
     *
     * It has to name three things: how many files, which folder they are in,
     * and whether the browser knows about them. The count alone was what
     * shipped, and it is exactly the sentence that sends somebody hunting
     * through Downloads for files that were never downloaded.
     *
     * The route is read back from what actually happened rather than from the
     * settings, because `saveFiled()` falls back to Downloads when a granted
     * folder turns out to be unwritable, and that fallback is the case the
     * tester most needs told.
     */
    const { describeSaved } = await filingLib();
    const where = await saveWhere();
    const how = routes.has('downloads-fallback') ? 'downloads-fallback'
      : routes.has('folder') ? 'folder'
        : 'downloads';
    let line = describeSaved({
      count: written.length,
      where: how === 'downloads-fallback' ? '' : where.path,
      how,
      failed: failed.length,
    });
    if (failed.length) line += ` ${failed.join('; ')}`;
    status.textContent = line;
    say(line, failed.length ? 'err' : '');
    // The same three facts, outside the page, for the tester who pressed Save
    // and switched to another window (D8).
    if (written.length) {
      window.UQADownload.announce(
        t('report.save.announceTitle', { files: t(written.length === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: written.length }) }),
        how === 'folder'
          ? t('report.save.announceFolder', { path: where.path })
          : t('report.save.announceDownloads', { path: where.path })
      );
    }
    window.UQASound?.play(failed.length ? 'status.warn' : 'save.done');
    window.UQAVfx?.status(status, failed.length ? 'err' : 'ok');
    renderSaved();
    renderTeam();
  } finally {
    $('save-go').disabled = false;
  }
});

/* ── the team's sessions, read from the shared folder ──────────────────── */

async function renderTeam() {
  const block = $('team-block');
  const handle = await window.UQAFolder?.get();
  if (!handle) return (block.hidden = true);
  block.hidden = false;
  const usable = await window.UQAFolder.usable();
  $('team-grant').hidden = !!usable;
  if (!usable) {
    $('team-note').textContent = t('report.team.needPermission', { name: handle.name });
    $('team').replaceChildren();
    return;
  }
  const { ROOT, CATEGORIES } = await filingLib();
  const cards = [];
  try {
    const root = await usable.getDirectoryHandle(ROOT, { create: false });
    const dir = await root.getDirectoryHandle(CATEGORIES.sessions, { create: false });
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try { cards.push(JSON.parse(await (await h.getFile()).text())); } catch { /* not ours */ }
    }
  } catch {
    $('team-note').textContent = t('report.team.noCards', { where: `${handle.name}/${ROOT}/${CATEGORIES.sessions}` });
    $('team').replaceChildren();
    return;
  }
  cards.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  $('team-note').textContent = t(cards.length === 1 ? 'report.team.cardsOne' : 'report.team.cardsMany', {
    n: cards.length,
    where: `${handle.name}/${ROOT}/${CATEGORIES.sessions}`,
  });
  const host = $('team');
  host.replaceChildren();
  const table = el('table', 'saved-table');
  const head = el('tr');
  for (const h of [t('report.team.when'), t('report.team.who'), t('report.team.charter'), t('report.team.site'), t('report.team.result')]) head.append(el('th', null, h));
  table.append(head);
  for (const c of cards.slice(0, 40)) {
    const tr = el('tr');
    if (c.id === sessionId) tr.className = 'mine';
    tr.append(el('td', 'muted', (c.startedAt || '').replace('T', ' ').slice(0, 16)));
    tr.append(el('td', c.tester ? null : 'muted', c.tester || t('report.team.notNamed')));
    tr.append(el('td', null, c.charter || ''));
    tr.append(el('td', 'muted', c.host || ''));
    tr.append(
      el(
        'td',
        c.verdict === 'clean' ? 'result-pass' : 'result-fail',
        c.verdict === 'clean'
          ? `${t('report.team.clean')} · ${t('common.signal.coverage')}`
          : c.counts?.failures == null
            ? t('report.team.unknownFailures')
            : t(c.counts.failures === 1 ? 'report.count.failureOne' : 'report.count.failureMany', { n: c.counts.failures })
      )
    );
    table.append(tr);
  }
  host.append(table);
}
$('team-grant').addEventListener('click', async () => {
  await window.UQAFolder.usable({ prompt: true });
  renderTeam();
});

/* ── the diagram, as a view rather than a button in the corner ─────────── */

/**
 * The workflow diagram, drawn inside the report (F2).
 *
 * It used to be a button in the action bar that opened a separate page, which
 * put the one picture the report has among the actions rather than among the
 * ways of looking at the session, so most readers never learned it was there.
 * The SVG the exporter already builds is the same SVG the editor draws, so this
 * costs nothing but a message: the tab shows it, and the editor stays one press
 * away for anyone who wants to move a box or print it.
 *
 * `innerHTML` would be the short way to put an SVG string on a page and it is
 * deliberately not used: the diagram is built from the session's own labels,
 * which come from whatever page was under test, and parsing a stranger's text
 * as markup inside an extension page is the exact shape of bug this product
 * must not have. `DOMParser` with an XML type parses it as data.
 */
let diagramReady = false;

async function renderDiagram() {
  const frame = $('diagram-frame');
  if (!frame) return;
  diagramReady = true;
  frame.replaceChildren(el('p', 'muted', t('report.diagram.laying')));

  const res = await send({ type: 'UQA_EXPORT', sessionId, format: 'flow-svg' });
  if (!res.ok) {
    frame.replaceChildren(el('p', 'muted err', werr(res) || t('report.diagram.failed')));
    return;
  }
  try {
    const doc = new DOMParser().parseFromString(res.result.content, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName === 'parsererror') throw new Error(t('report.diagram.malformed'));
    frame.replaceChildren(document.importNode(svg, true));
  } catch (err) {
    frame.replaceChildren(el('p', 'muted err', t('report.diagram.shownFailed', { error: err.message })));
  }
}

$('diagram-open')?.addEventListener('click', () =>
  window.open(chrome.runtime.getURL(`diagram/diagram.html?session=${encodeURIComponent(sessionId)}`), '_blank', 'noopener')
);
$('diagram-refresh')?.addEventListener('click', renderDiagram);

/* ── keeping up with the worker ────────────────────────────────────────── */

/**
 * The report repaints when the stored evidence changes under it.
 *
 * Two bugs, one cause. A screenshot marked up in the annotate page is written
 * back under the same media id, and this page held both a cached object URL for
 * it and a `media` array read once at load: so the report went on showing the
 * unmarked picture for the life of the tab, which is F3's "after editing, the
 * report outside must show the edited image". Worse, and found by Group G in a
 * real session, "Save every file" enumerated that same stale array, so a
 * session whose seventh screenshot was a marked-up copy saved six of seven and
 * reported that it had saved everything.
 *
 * Re-reading the list and dropping the URL cache fixes both, and it is one fix
 * rather than two, because they were the same stale read.
 *
 * `UQA_VIEWPORT_CHANGED` is the other half, from section 7 of the window-sizes
 * contract: a run opening or closing while the report is open repaints that one
 * tab and nothing else.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * Nothing is declared externally connectable, so a web page cannot reach this
   * at all and another extension's message would carry that extension's id.
   * `sender.id` is stamped by the browser rather than claimed by the sender,
   * which is what makes it the thing to check; `sender.url` is not, and is
   * never checked here (research/51d §7).
   */
  if (sender?.id !== chrome.runtime.id) return;
  if (!msg?.type) return;
  if (msg.type === 'UQA_MEDIA_CHANGED') {
    refreshMedia();
  } else if (msg.type === 'UQA_VIEWPORT_CHANGED' && (!msg.sessionId || msg.sessionId === sessionId)) {
    refreshMedia().then(() => renderSizes());
  }
});

async function refreshMedia() {
  const res = await send({ type: 'UQA_MEDIA_LIST', sessionId, companions: true }); // setMedia splits off the webcam layers
  if (!res.ok) return;
  setMedia(res.result);
  // The bytes behind every cached URL may have been replaced and there is no
  // way to ask which: the ids are the same. Dropping the whole cache is one
  // re-read of what is on screen, and correct by construction.
  revokeAll();
  renderGallery();
  renderTimeline();
  renderChains();
}

/* ── integrations ──────────────────────────────────────────────────────── */

/* The Jira, chat and e-mail filing lives in filing.js (the File menu in the verdict card). */

/**
 * The trackers that are not Jira: one row each, drawn only when configured.
 *
 * They were filed by message and covered by a suite for two versions while
 * this page offered no button for them; code that is tested and unreachable
 * is not shipped. Targets are fetched when the row is drawn, and a target the
 * adapter does not need is simply not offered.
 */
async function setupTrackers() {
  const block = $('trackers-block');
  const host = $('trackers');
  if (!block || !host) return;
  const res = await send({ type: 'UQA_TRACKER_STATE' });
  if (!res.ok) return;
  const ready = res.result.filter((t) => t.configured);
  block.hidden = !ready.length;
  if (!ready.length) return;
  host.replaceChildren();

  // The loop variable is `tr` and not `t`: `t` is the translator on this page.
  for (const tr of ready) {
    const row = el('div', 'tracker-row');
    const name = el('strong', null, tr.label);
    const target = document.createElement('select');
    target.setAttribute('aria-label', t('report.trackers.targetAria', { name: tr.label }));
    target.append(new Option(t('report.trackers.loading'), ''));
    target.disabled = true;
    const file = el('button', 'btn btn-sm btn-primary', t('report.trackers.file'));
    file.type = 'button';
    const last = el('span', 'tracker-last');
    row.append(name, target, file, last);
    host.append(row);

    send({ type: 'UQA_TRACKER_TARGETS', tracker: tr.id }).then((out) => {
      target.replaceChildren();
      if (!out.ok) {
        target.append(new Option(out.error, ''));
        return;
      }
      for (const o of out.result) target.append(new Option(o.note ? `${o.label} (${o.note})` : o.label, o.id));
      target.disabled = false;
    });

    file.addEventListener('click', async () => {
      const asked = await askServiceAccess(tr.url);
      if (!asked.ok) { last.textContent = asked.error; last.className = 'tracker-last err'; return; }
      if (!confirm(t('report.trackers.confirm', { name: tr.label }))) return;
      file.disabled = true;
      last.textContent = t('report.trackers.filing');
      last.className = 'tracker-last';
      const out = await send({ type: 'UQA_TRACKER_FILE', sessionId, tracker: tr.id, target: target.value || undefined });
      file.disabled = false;
      if (!out.ok) {
        last.textContent = werr(out);
        last.className = 'tracker-last err';
        return;
      }
      last.textContent = `${t('report.trackers.filed', { key: out.result.key })} `;
      // D-1010-157: a link beside the key, not a window.open (a popup blocker eats it after the await).
      last.append(safeLink(out.result.url, 'tracker-open', t('report.trackers.open')));
    });
  }
}
