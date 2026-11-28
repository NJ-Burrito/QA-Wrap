/* QA Wrap — report: media urls, gallery, lightbox, raw view and saving (split from report.js; classic script, same global scope). */
/* ── media ─────────────────────────────────────────────────────────────── */

/**
 * Cache of object URLs, so scrolling the gallery does not re-fetch bytes.
 *
 * Every entry pins its Blob in memory until the tab is closed, and a clip is
 * hundreds of megabytes — so a report where five recordings had been opened
 * held all five for the life of the page, and switching sessions added the next
 * session's on top. `revokeAll()` is called wherever the cache is dropped, so
 * the bytes go with the entry rather than outliving it.
 */
const urlCache = new Map();

function revokeAll() {
  for (const url of urlCache.values()) {
    // A legacy screenshot is cached as its own `data:` URI, which is a string
    // and not something to revoke.
    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  urlCache.clear();
}

/**
 * The stored bytes, read here rather than asked for.
 *
 * This page and the service worker are the same extension in the same profile,
 * so they see the same IndexedDB. Asking the worker for a clip meant the worker
 * read the Blob, turned it into an array of numbers, JSON-encoded it, and this
 * page parsed it back: `chrome.runtime` messaging cannot carry a Blob at all,
 * it serialises to `{}` with no error, so bytes-as-numbers was the only way
 * across. For a screenshot that is wasteful; for a recording it was several
 * times the clip's size in live memory on both sides at once, which is what a
 * report page that froze on a long session was actually doing.
 *
 * `import()` and not a static import: `report.html:432` loads this file as a
 * classic script, so a top-level `import` would not parse. The dynamic form
 * works in a classic script and keeps `db.js` off the critical path of a report
 * that has no media in it.
 *
 * The worker route stays as the fallback, because there are two states this
 * cannot serve: a profile whose database will not open, and a session recorded
 * before the media store existed, whose screenshot is still a data URI in the
 * old captures table.
 */
async function mediaBlob(id) {
  try {
    const { getMedia } = await import('../core/db.js');
    const record = await getMedia(id);
    if (record?.blob) return { blob: record.blob, type: record.type || record.blob.type };
  } catch {
    /* fall through to the worker, which is the only other reader */
  }
  const res = await send({ type: 'UQA_MEDIA_BLOB', id });
  if (!res.ok) return null;
  return {
    blob: new Blob([new Uint8Array(res.result.data)], { type: res.result.type }),
    type: res.result.type,
  };
}

async function mediaUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const got = await mediaBlob(id);
  if (!got) {
    // A session recorded before the media store existed still has its
    // screenshot in the old captures table; fall back rather than showing a
    // broken image on every old report.
    const legacy = await send({ type: 'UQA_GET_CAPTURE', captureId: id });
    if (legacy.ok && legacy.result?.dataUrl) {
      urlCache.set(id, legacy.result.dataUrl);
      return legacy.result.dataUrl;
    }
    return null;
  }
  const url = URL.createObjectURL(got.blob);
  urlCache.set(id, url);
  return url;
}

async function loadMediaInto(img, id) {
  const url = await mediaUrl(id);
  if (url) img.src = url;
  else img.replaceWith(el('p', 'muted', t('report.media.imageGone')));
}

/**
 * One clip, one home.
 *
 * A recording made inside a window-size run is filed with the parent session so
 * it cannot be orphaned, and it carries a `runId` saying which run it belongs
 * to (research/55-window-sizes-contract.md, section 4). Showing it in both
 * places would double the count and make a tester chasing a clip look in the
 * wrong one; the contract's rule is that `runId` decides, and this is where the
 * report obeys it.
 */
const ownMedia = () => media.filter((m) => !m.runId);
const runMedia = (runId) => media.filter((m) => m.runId === runId);

function renderGallery() {
  const mine = ownMedia();
  $('count-media').textContent = mine.length || '';
  const host = $('gallery');
  host.replaceChildren();

  const shots = mine.filter((m) => m.kind === 'screenshot');
  const clips = mine.filter((m) => m.kind === 'recording');
  const elsewhere = media.length - mine.length;
  $('media-summary').textContent = mine.length
    ? t('report.media.summary', {
        shots: t(shots.length === 1 ? 'report.count.screenshotOne' : 'report.count.screenshotMany', { n: shots.length }),
        clips: t(clips.length === 1 ? 'report.count.recordingOne' : 'report.count.recordingMany', { n: clips.length }),
        size: kb(mine.reduce((n, m) => n + (m.bytes || 0), 0)),
      }) + (elsewhere ? ` ${t(elsewhere === 1 ? 'report.media.elsewhereOne' : 'report.media.elsewhereMany', { n: elsewhere })}` : '')
    : '';

  if (!mine.length) {
    const empty = el('div', 'empty');
    empty.append(
      iconP('i-screenshot'),
      el('h2', null, t('report.media.emptyTitle')),
      el('p', 'muted', t('report.media.emptyNote'))
    );
    host.append(empty);
    return;
  }

  for (const item of mine) {
    const card = el('article', 'shot-card');

    const stage = el('button', 'shot-stage');
    stage.type = 'button';
    // Type, not kind — see the same fix on the timeline row. A GIF clip has a
    // picture to show, so it gets a thumbnail rather than a play badge over a
    // video element that would never render it.
    const isVideo = item.kind === 'recording' && !(item.type || '').startsWith('image/');
    if (isVideo) {
      const badge = el('span', 'shot-play'); badge.append(svgIcon('i-play'));
      stage.append(badge);
      stage.classList.add('is-video');
      const clipName = item.label || t('report.ev.screenRecording');
      stage.setAttribute('aria-label', t('report.ev.openLarge', { what: clipName }));
      stage.addEventListener('click', () => lightbox(item.id, item.type || 'video/webm', { sourceEl: stage }));
    } else {
      const img = el('img');
      img.alt = item.label || t('report.ev.screenshot');
      img.loading = 'lazy';
      loadMediaInto(img, item.id);
      stage.append(img);
      stage.setAttribute('aria-label', t('report.ev.openLarge', { what: img.alt }));
      stage.addEventListener('click', () => lightbox(item.id, item.type || 'image/png', { sourceEl: stage, alt: img.alt }));
    }
    card.append(stage);

    const meta = el('div', 'shot-meta');
    meta.append(el('p', 'shot-label', item.label || (item.kind === 'recording' ? t('report.ev.screenRecording') : t('report.ev.screenshot'))));
    const facts = [rel(item.ts), (item.type || '').split('/')[1]?.toUpperCase(), kb(item.bytes || 0)];
    if (item.durationMs) facts.splice(1, 0, secs(item.durationMs));
    if (item.annotated) facts.push(t('report.media.annotated'));
    // A clip whose recorder died, or that a crash left half-written, is still
    // evidence — and the card has to say it is short rather than let somebody
    // conclude the bug stopped happening.
    if (item.incomplete) facts.push(t('report.media.incomplete'));
    // What went into the clip, so a silent recording is explained on the card
    // rather than discovered on playback.
    if (item.sources) {
      const on = Object.entries(item.sources).filter(([k, v]) => v && k !== 'tab').map(([k]) =>
        (k === 'tabAudio' ? t('report.media.tabAudio') : k === 'mic' ? t('report.media.mic') : k === 'webcam' ? t('report.media.webcam') : k)
      );
      if (on.length) facts.push(on.join(' + '));
    }
    meta.append(el('p', 'shot-facts', facts.filter(Boolean).join(' · ')));
    // The face is not missing, it is a track. Said on the card, because the
    // thumbnail of a clip recorded this way has no inset in it and a tester who
    // ticked the webcam will otherwise think it failed to record.
    if (webcamTrackOf(item)) meta.append(el('p', 'shot-webcam', t('report.media.webcamTrack')));
    card.append(meta);

    const actions = el('div', 'shot-actions');
    /*
     * Verify, not stamp.
     *
     * Every PNG is marked as it is stored — invisibly, in a tEXt chunk, without
     * a pixel moving — so there is nothing to ask for. What is worth offering
     * is the opposite: proof that the mark is there and a way to read what it
     * says, because a claim of attribution nobody can check is not attribution.
     */
    if (item.kind !== 'recording' && (item.type || '').includes('png')) {
      const check = el('button', 'btn btn-xs', t('report.media.origin'));
      check.title = t('report.media.originTitle');
      check.addEventListener('click', async () => {
        // T-066: the content check first, on the stored bytes in this page (crypto.subtle; no bytes through the worker).
        let content = { status: 'no checksum' };
        try {
          const got = await mediaBlob(item.id);
          if (got) content = await (await import('../core/integrity.js')).originCheck(await got.blob.arrayBuffer());
        } catch {
          /* unreadable: said as "no checksum", never as intact */
        }
        const words = t({ intact: 'report.media.contentIntact', 'content changed': 'report.media.contentChanged' }[content.status] || 'report.media.noChecksum');
        const res = await send({ type: 'UQA_MEDIA_PROVENANCE', id: item.id });
        if (!res.ok) return say(werr(res), 'err');
        const p = res.result;
        if (!p.provenance) {
          return say(`${words} ${t('report.media.noProvenance')}`, 'err');
        }
        say(
          `${words} ` +
          t('report.media.provenance', {
            software: p.Software,
            author: p.Author,
            session: p.provenance.session || t('report.media.noSession'),
            state: p.provenance.intact ? t('report.media.tokenOk') : t('report.media.tokenAltered'),
          }),
          p.provenance.intact && content.status === 'intact' ? 'ok' : 'err'
        );
      });
      actions.append(check);
    }
    if (item.kind !== 'recording') {
      const mark = el('button', 'btn btn-xs btn-primary', t('report.media.markUp'));
      mark.title = t('report.media.markUpTitle');
      mark.addEventListener('click', () => send({ type: 'UQA_OPEN_ANNOTATE', id: item.id }));
      actions.append(mark);
    }
    // A GIF is a recording and an image at once, and it has no editor —
    // the editor re-encodes into the clip's own container, which a GIF has
    // never had.
    if (item.kind === 'recording' && !(item.type || '').startsWith('image/')) {
      const edit = el('button', 'btn btn-xs btn-primary', t('report.media.editVideo'));
      edit.title = t('report.media.editVideoTitle');
      edit.addEventListener('click', () => send({ type: 'UQA_OPEN_VIDEOEDIT', id: item.id }));
      actions.append(edit);
    }
    const save = el('button', 'btn btn-xs', t('report.media.save'));
    save.addEventListener('click', (e) => e.detail > 1 || saveOne(item, save));
    const del = el('button', 'btn btn-xs btn-danger', t('report.media.delete'));
    del.addEventListener('click', async () => {
      if (!confirm(t('report.media.deleteConfirm', { label: iso(item.label) }))) return;
      const res = await send({ type: 'UQA_MEDIA_DELETE', id: item.id });
      if (!res.ok) return say(werr(res), 'err');
      // The companion goes with its parent, here as well as in the store: a
      // layer whose clip is gone is not evidence of anything.
      setMedia(allMedia.filter((m) => m.id !== item.id && m.parentId !== item.id));
      renderGallery();
      say(t('report.media.deleted'));
    });
    actions.append(save, del);
    card.append(actions);

    host.append(card);
  }
}

/* ── lightbox ──────────────────────────────────────────────────────────── */

/**
 * Show one stored item full size.
 *
 * Takes the item's MIME type, not a word for its kind. It used to take
 * `'video'` or `'image'` and every caller derived that from `kind ===
 * 'recording'` — so an animated GIF, which is a recording *and* an image, was
 * always handed to `<video>` and rendered nothing.
 */
/**
 * The clip currently on screen, which is nobody's after the lightbox closes.
 *
 * A screenshot stays in `urlCache`, because the same URL is already on a
 * thumbnail and reusing it costs a few hundred kilobytes. A recording is
 * hundreds of megabytes and is on screen exactly once, so it gets a URL of its
 * own that is revoked the moment the lightbox shuts. Cached, it stayed pinned
 * until the tab closed, and watching five clips in one report held all five.
 */
let clipUrl = null;
/** And its webcam layer, which is a second clip's worth of bytes. */
let camUrl = null;

/**
 * The webcam layer, over the clip, in CSS.
 *
 * No re-encode to watch: the two recordings are two `<video>` elements, the
 * companion positioned at the geometry that was ticked and started at
 * `offsetMs` behind the clip. The stack is an inline-block sized by the clip
 * itself, so a percentage here is a percentage of the picture rather than of
 * the black around it.
 *
 * The clip drives, always. Two elements playing themselves drift within a few
 * seconds, and a face reacting to something that has not happened yet is worse
 * evidence than no face.
 */
function stackWebcam(main, cam, url) {
  const wrap = el('div', 'clip-stack');
  const layer = document.createElement('video');
  layer.className = 'clip-cam';
  layer.src = url;
  layer.muted = true; // the mix is on the clip; the cam recorder was video only
  layer.playsInline = true;
  const size = Math.min(60, Math.max(5, Number(cam.geometry?.size) || 22));
  const corner = cam.geometry?.position || 'bottom-right';
  layer.style.width = `${size}%`;
  layer.style[corner.includes('top') ? 'top' : 'bottom'] = '3%';
  layer.style[corner.includes('left') ? 'left' : 'right'] = '3%';

  const align = () => {
    const want = Math.max(0, main.currentTime * 1000 - (cam.offsetMs || 0)) / 1000;
    if (Number.isFinite(layer.duration) && want > layer.duration) return;
    if (Math.abs(layer.currentTime - want) > 0.25) layer.currentTime = want;
    if (main.paused && !layer.paused) layer.pause();
    if (!main.paused && layer.paused) layer.play().catch(() => {});
  };
  for (const event of ['play', 'pause', 'seeked', 'timeupdate']) main.addEventListener(event, align);
  layer.addEventListener('loadedmetadata', align, { once: true });

  wrap.append(main, layer);
  return wrap;
}

/**
 * @param {string} id the stored media record
 * @param {string} type its MIME type
 * @param {{seekMs?: number}} [at] where in a clip to start — used by the Window
 *   sizes rows, which point into the middle of the session's own recording
 *   rather than owning a clip of their own.
 */
/**
 * A thumbnail that opens the lightbox, as a real button (r2-08-1): a bare <img> with a click listener cannot
 * be reached or pressed from the keyboard. The label names what opens, in both languages.
 * @param {HTMLElement} child
 * @param {(btn: HTMLButtonElement) => void} open
 */
function evidenceOpener(child, open) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ev-open';
  btn.setAttribute('aria-label', t('report.ev.openLarge', { what: child.getAttribute('alt') || t('report.ev.screenshot') }));
  btn.append(child);
  btn.addEventListener('click', () => open(btn));
  return btn;
}

/** Whoever opened the lightbox, so closing it hands the keyboard back there (r2-08-1). */
let lightboxOpener = null;

async function lightbox(id, type = 'image/png', { seekMs = 0, sourceEl = null, alt = '' } = {}) {
  lightboxOpener = sourceEl && sourceEl.isConnected ? sourceEl : document.activeElement;
  const isImage = String(type).startsWith('image/');
  let url;
  if (isImage) {
    url = await mediaUrl(id);
  } else {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = null;
    const got = await mediaBlob(id);
    url = got ? URL.createObjectURL(got.blob) : null;
    clipUrl = url;
  }
  if (!url) return say(t('report.media.itemGone'), 'err');
  const stage = $('lightbox-stage');
  stage.replaceChildren();
  // The stage scales up from the thumbnail that was clicked, not from the
  // viewport centre — so it reads as that thumbnail materializing (F14).
  const origin = sourceEl?.getBoundingClientRect?.();
  stage.style.transformOrigin = origin
    ? `${origin.left + origin.width / 2}px ${origin.top + origin.height / 2}px`
    : '50% 50%';

  // The parent record, and the layer that belongs to it. Read from the store's
  // own list rather than passed in, so every call site gets the overlay without
  // knowing the companion exists.
  const parent = allMedia.find((m) => m.id === id) || null;
  const cam = isImage ? null : webcamTrackOf(parent);
  if (camUrl) { URL.revokeObjectURL(camUrl); camUrl = null; }
  if (cam) {
    const got = await mediaBlob(cam.id);
    camUrl = got ? URL.createObjectURL(got.blob) : null;
  }

  if (!isImage) {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    // D-1010-142 (WCAG 2.2.2): a person who asked for less motion is not given a clip that plays and loops on its own.
    v.autoplay = !prefersReduced();
    v.loop = !prefersReduced();
    if (seekMs > 0) {
      // On `loadedmetadata` and not before: `currentTime` set on a video whose
      // duration is unknown is silently dropped, and the clip starts at zero
      // with nothing to say it ignored the ask. Once, so the loop above does
      // not drag the viewer back to the offset on every repeat.
      v.addEventListener(
        'loadedmetadata',
        () => {
          const at = seekMs / 1000;
          if (Number.isFinite(v.duration) && at < v.duration) v.currentTime = at;
        },
        { once: true }
      );
    }
    stage.append(cam && camUrl ? stackWebcam(v, cam, camUrl) : v);
    // Same gate as the card button: only a real recording gets an editor.
    const editBtn = $('lightbox-edit');
    editBtn.hidden = false;
    editBtn.onclick = () => send({ type: 'UQA_OPEN_VIDEOEDIT', id });
  } else {
    $('lightbox-edit').hidden = true;
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt || t('report.ev.screenshot');
    stage.append(img);
  }
  const dlg = $('lightbox');
  if (!dlg.open) dlg.showModal();
}

const closeLightbox = () => {
  const dlg = $('lightbox');
  if (dlg.open) dlg.close();
  $('lightbox-stage').replaceChildren(); // stop any playing video
  // The clip's bytes go with it. `replaceChildren` drops the <video>, but the
  // object URL still holds the Blob alive, and a clip is the one item here big
  // enough for that to matter.
  if (clipUrl) {
    URL.revokeObjectURL(clipUrl);
    clipUrl = null;
  }
  if (camUrl) {
    URL.revokeObjectURL(camUrl);
    camUrl = null;
  }
  const back = lightboxOpener;
  lightboxOpener = null;
  if (back?.isConnected) back.focus?.();
};
$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox').addEventListener('close', closeLightbox); // native Escape closes the dialog without going through closeLightbox
$('lightbox').addEventListener('click', (e) => {
  if (e.target === $('lightbox')) closeLightbox();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('lightbox').open) closeLightbox();
});

/* ── raw export ────────────────────────────────────────────────────────── */

const CHUNK_LINES = 120;
const DATA_URI = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g;

/**
 * Never put a base64 screenshot on screen.
 *
 * The whole export used to go into one <pre> with white-space: pre-wrap, and a
 * Markdown report embeds every screenshot as a data URI — so that single text
 * node ran to hundreds of kilobytes and scrolling it dropped frames. The
 * display copy swaps each URI for a marker; `current.content` is untouched, so
 * Copy and Save still carry the real thing.
 */
function renderRaw(text) {
  const host = $('content');
  // The skeleton rows in report.html carry `aria-busy="true"`; replacing them
  // without clearing it leaves a screen reader told the pane is still loading
  // for the rest of the page's life.
  host.setAttribute('aria-busy', 'false');
  host.replaceChildren();
  const lines = text
    .replace(DATA_URI, (m) => t('report.raw.embedded', { kb: Math.round(m.length / 1024) }))
    .split('\n');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const block = el('pre', 'chunk', lines.slice(i, i + CHUNK_LINES).join('\n'));
    frag.append(block);
  }
  host.append(frag);
}

async function loadRaw() {
  const format = $('format').value;
  say(t('report.status.building'));
  // session.json is built here from the events the page holds, masked like every export (core/ai-brief.js)
  const res = format === 'session-json' ? { ok: true, result: BF.sessionJson(session, shownEvents(events)) } : await send({ type: 'UQA_EXPORT', sessionId, format });
  if (!res.ok) {
    $('content').textContent = '';
    return say(werr(res), 'err');
  }
  current = res.result;
  if (current.mime === 'image/svg+xml') {
    renderRaw(current.content);
    return say(t('report.raw.svgReady', { n: current.content.length.toLocaleString(QAWi18n.numTag()) }));
  }
  if (current.encoding === 'base64') {
    const kb = Math.round((current.content.length * 3) / 4 / 1024);
    renderRaw(t('report.raw.workbookBody', { kb, filename: current.filename }));
    return say(t('report.raw.workbookReady', { kb }));
  }
  renderRaw(current.content);
  say(t('report.raw.charsReady', { n: current.content.length.toLocaleString(QAWi18n.numTag()) }));
}

$('format').addEventListener('change', loadRaw);

$('copy').addEventListener('click', async () => {
  if (!current) return;
  if (current.encoding === 'base64') return say(t('report.raw.workbookNoCopy'), 'err');
  try {
    await navigator.clipboard.writeText(current.content);
    say(t('report.raw.copied'));
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('content'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    say(t('report.raw.copyFallback'), 'err');
  }
});

/* ── saving, into the category tree ────────────────────────────────────── */

let filing = null;
async function filingLib() {
  if (!filing) { filing = await import('../core/filing.js'); await bugfirstReady; filing.useTitle(() => BF.heroTitle({ session, events, t, summarise })); }
  return filing;
}

/**
 * r10-10-5 (D-240): a saved file's name in the tester's language. The format's own key is the one the format
 * picker already uses (report.raw.fmt*, read off its option), so the table, the picker and the card agree; a
 * format with no entry there keeps the label it was saved with. core/filing.js keeps the English label.
 * @param {string} format
 */
function formatLabelKey(format) {
  if (!format) return '';
  const key = format === 'session-manifest'
    ? 'report.part.sessionCard'
    : [...document.querySelectorAll('#format option')].find((o) => o.value === format)?.getAttribute('data-i18n');
  return key && QAWi18n.has(key) ? key : '';
}

/** @param {string} format @param {string} content @param {string} mime @param {{ encoding?: string, audience?: boolean, label?: string }} [opts] */
async function saveExport(format, content, mime, { encoding, audience = true, label } = {}) {
  // The extension and the folder both come from core/filing.js. They used to be
  // a local table here that knew about seven formats while the worker exported
  // twelve, so the five it had never heard of were written as `.txt`.
  const { exportPath, FORMATS } = await filingLib();
  const path = exportPath(format, session, { clock: settings?.clock || '24', folder: settings?.downloadFolder || '' });
  let data = content;
  if (encoding === 'base64') {
    const { fromBase64 } = await import('../core/xlsx.js');
    data = new Blob([fromBase64(content)], { type: mime });
  }
  const res = await window.UQADownload.saveFiled(data, path, mime);
  if (res.ok) {
    await send({
      type: 'UQA_EXPORT_SAVED', sessionId, format, label: label || (formatLabelKey(format) ? t(formatLabelKey(format)) : FORMATS[format]?.label || format),
      path: res.path || path, bytes: data instanceof Blob ? data.size : String(data).length, how: res.how,
    });
    renderSaved();
  }
  return res;
}

/* ── what was saved, kept with the session ─────────────────────────────── */

/** The replay, if one was recorded: `UQA_REPLAY_INFO` reads the chunk headers and inflates nothing. One press opens one tab: the handler is
 *  set, never added, because this runs again on every repaint of the saved list (each run used to add a listener, so one press opened several tabs). */
function offerReplay() {
  send({ type: 'UQA_REPLAY_INFO', sessionId }).then((info) => {
    const btn = document.getElementById('watch-replay');
    if (!btn || !info?.ok || !info.result?.entries) return;
    btn.textContent = t('report.timeline.replayKb', { kb: Math.max(1, Math.round((info.result.stored || 0) / 1024)) });
    btn.hidden = false;
    managed(btn, 'replayAllowed');
    btn.onclick = openReplay;
  });
}

/** One replay tab per session: a second press shows the one that is open. Here, not in the worker: its boot graph has no room. */
async function openReplay() {
  const url = chrome.runtime.getURL(`replay/replay.html?session=${encodeURIComponent(sessionId)}`);
  const open = (await chrome.tabs.query({}).catch(() => [])).find((tab) => tab.url === url);
  if (open?.id) chrome.tabs.update(open.id, { active: true }).catch(() => null);
  else send({ type: 'UQA_OPEN_REPLAY', sessionId });
}

async function renderSaved() {
  offerReplay();

  // D-1010-155: ask for the export rows only. A worker that ignores `kinds` answers the whole session, so the filter stays;
  // and the answer is read into a local, because the page-wide `events` must never be narrowed to the exports.
  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId, kinds: ['export'] });
  const rows = res.ok ? res.result.events || events : events;
  const saved = rows.filter((e) => e.kind === 'export');
  $('saved-block').hidden = !saved.length;
  if (!saved.length) return;
  const host = $('saved');
  host.replaceChildren();
  const table = el('table', 'saved-table');
  const head = el('tr');
  for (const h of [t('report.saved.when'), t('report.saved.what'), t('report.saved.where')]) head.append(el('th', null, h));
  table.append(head);
  for (const e of [...saved].reverse()) {
    const tr = el('tr');
    tr.append(el('td', 'muted', fmtDate(e.ts)));
    tr.append(el('td', null, formatLabelKey(e.format) ? t(formatLabelKey(e.format)) : e.label || e.format)); // r10-10-5: the picker's own word, in the language on screen
    tr.append(el('td', 'mono', e.path));
    table.append(tr);
  }
  host.append(table);
}

/**
 * Save one stored item, and always say what happened.
 *
 * It used to return `undefined` on every path — including its two early
 * returns — so the caller's `failed` list was unreachable and "Save everything"
 * counted a file it had not written. Worse, two of its statements can *throw*:
 * `fetch(url).blob()` on an object URL that has been revoked, and
 * `UQAFolder.usable({ prompt: true })` once the user gesture is spent. A throw
 * out of here aborted the whole loop in "Save everything" and left `#save-go`
 * disabled for ever, with no message and no way back but a reload.
 *
 * So: one result shape on every path, and a try/catch that turns a throw into
 * that same shape.
 */
async function saveOne(item, button) {
  const fail = (error) => {
    if (button) {
      button.textContent = t('report.media.failed');
      setTimeout(() => button && (button.textContent = t('report.media.save')), TIMING.savedLabel);
    }
    say(t('report.save.couldNot', { error }), 'err');
    return { ok: false, item: item.id, error };
  };

  try {
    const { evidencePath } = await filingLib();
    /*
     * The folder permission, asked for before anything else.
     *
     * `saveFiled` asks for it deep inside itself, by which point the user
     * gesture that opened this save has usually been spent on the fetch and the
     * encode — so a granted team folder silently fell back to the downloads
     * directory, and the tester's filing tree stopped filling up with no
     * warning that it had. Asking first, while the gesture is still live, is
     * what keeps the folder.
     */
    await window.UQAFolder?.usable?.({ prompt: true })?.catch?.(() => false);

    // The Blob itself, not an object URL fetched back into one. Saving a clip
    // used to mint a cached URL for it and then read the whole thing through
    // `fetch`, which pinned the clip in this page for the life of the tab for
    // no reason: the file goes to disk and is never shown here.
    const got = await mediaBlob(item.id);
    if (!got) return fail(t('report.save.itemGoneShort'));
    const blob = got.blob;
    // Numbered in the order it was taken, among its own kind.
    const kin = media.filter((m) => (m.kind === 'recording') === (item.kind === 'recording')).sort((a, b) => a.ts - b.ts);
    const ordinal = Math.max(1, kin.findIndex((m) => m.id === item.id) + 1);
    const path = evidencePath(item, ordinal, session, { clock: settings?.clock || '24', folder: settings?.downloadFolder || '' });
    if (button) button.textContent = t('report.media.saving');
    const res = await window.UQADownload.saveFiled(blob, path);
    if (button) button.textContent = res.ok ? t('report.media.saved') : t('report.media.failed');
    setTimeout(() => button && (button.textContent = t('report.media.save')), TIMING.savedLabel);
    if (!res.ok) return fail(werr(res));
    say(t('report.save.savedTo', { path: res.path || path }), '');
    // `how` travels with the result so the caller can say whether the browser
    // listed the file. It is per file because the fallback is per file: one
    // clip can go to Downloads while the rest reached the granted folder.
    return { ok: true, item: item.id, path: res.path || path, how: res.how };
  } catch (err) {
    return fail(werr(err) || String(err));
  }
}

$('save').addEventListener('click', async () => {
  if (!current) return;
  say(t('report.media.saving'));
  const res = await saveExport($('format').value, current.content, current.mime, { encoding: current.encoding });
  if (!res.ok) return say(t('report.save.couldNot', { error: werr(res) }), 'err');
  // One file, so the path is the confirmation. The clause after it is the half
  // that was missing: where to look for it if it is not in the downloads bar.
  say(
    res.how === 'folder'
      ? t('report.save.savedFolder', { path: res.path })
      : t('report.save.savedDownloads', { path: res.path || current.filename })
  );
});

$('media-save').addEventListener('click', async (e) => { if (e.detail > 1) return;
  // What this tab shows is what this button saves. A clip belonging to a
  // window-size run has its own card under Window sizes, so it is not written
  // twice under two names.
  const mine = ownMedia();
  if (!mine.length) return say(t('report.media.nothingToSave'), 'err');
  say(t('report.save.savingFiles', { files: t(mine.length === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: mine.length }) }));
  let done = 0;
  const failed = [];
  const routes = new Set();
  for (const item of mine) {
    // Sequential on purpose: Chrome throttles concurrent downloads and drops
    // the excess, which would silently save four of nine files.
    const out = await saveOne(item, null);
    if (out?.how) routes.add(out.how);
    if (out?.ok) done++;
    else failed.push(`${item.label || item.kind}: ${werr(out) || t('report.save.unknownError')}`);
  }
  // The same sentence the Save sheet prints, for the same reason: a count on
  // its own does not tell anybody where to go and look.
  const { describeSaved } = await filingLib();
  const where = await saveWhere();
  const how = routes.has('downloads-fallback') ? 'downloads-fallback' : routes.has('folder') ? 'folder' : 'downloads';
  let line = describeSaved({
    count: done,
    where: how === 'downloads-fallback' ? '' : `${where.path}Screenshots/ and Recordings/`,
    how,
    failed: failed.length,
  });
  if (failed.length) line += ` ${failed.join('; ')}`;
  say(line, failed.length ? 'err' : '');
  if (done) {
    window.UQADownload.announce(
      t('report.save.announceTitle', { files: t(done === 1 ? 'report.count.fileOne' : 'report.count.fileMany', { n: done }) }),
      how === 'folder'
        ? t('report.save.announceFolder', { path: where.path })
        : t('report.save.announceDownloads', { path: where.path })
    );
  }
});

/**
 * "Save everything" — the whole session as a filed set, not one file.
 *
 * This is what the category tree is for: one press produces the report, the
 * ticket, the spec, the session sheet and every screenshot and clip, each in
 * the folder its reader will look in.
 */
/* ── the save dialog: which parts, for whom, where ─────────────────────── */

/**
 * One of each kind per shelf, not one of each format: the reader who wants
 * Markdown does not also want YAML. "For people" is what a colleague opens;
 * "For AI" is what an agent is pointed at. Tool outputs appear only when the
 * tool ran — an export that throws "no page map" is noise, not a file.
 */
function saveParts() {
  const has = (k) => events.some((e) => e.kind === k);
  const groups = [
    { id: 'human', label: t('report.save.groupPeople'), items: [
      ['markdown', t('report.part.markdown'), t('report.part.markdownNote')],
      ['html', t('report.part.html'), t('report.part.htmlNote')],
      ['sbtm', t('report.part.sbtm'), t('report.part.sbtmNote')],
      ['sheet-xlsx', t('report.part.sheetXlsx'), t('report.part.sheetXlsxNote')],
      ['timeline-xlsx', t('report.part.timelineXlsx'), t('report.part.timelineXlsxNote')], ['timeline-md', t('seal.part.timelineMd'), t('seal.part.timelineMdNote')],
      ['srs-html', t('report.part.srsHtml'), t('report.part.srsHtmlNote')],
      ['srs', t('report.part.srs'), t('report.part.srsNote')],
      ['manual-html', t('report.part.manualHtml'), t('report.part.manualHtmlNote')],
      // Only when one was read: a document nobody asked for should not be
      // offered as though it exists.
      ...(has('spec') ? [['spec-reverse', t('report.part.specReverse'), t('report.part.specReverseNote')]] : []),
      ...(has('fineprint') ? [['fine-print', t('report.part.finePrint'), t('report.part.finePrintNote')]] : []),
      ['manual', t('report.part.manual'), t('report.part.manualNote')],
      ['storyboard-html', t('report.part.storyboardHtml'), t('report.part.storyboardHtmlNote')],
      ['flow-svg', t('report.part.flowSvg'), t('report.part.flowSvgNote')],
      ...(has('links') ? [['links-html', t('report.part.linksHtml'), t('report.part.linksHtmlNote')], ['links', t('report.part.links'), t('report.part.linksNote')]] : []),
    ] },
    { id: 'ai', label: t('report.save.groupMachine'), items: [
      ['json', t('report.part.json'), t('report.part.jsonNote')],
      ['agent', t('report.part.agent'), t('report.part.agentNote')],
      ['locator-set', t('report.part.locatorSet'), t('report.part.locatorSetNote')],
      ['test-plan', t('report.part.testPlan'), t('report.part.testPlanNote')],
      ['locator-sheet', t('report.part.locatorSheet'), t('report.part.locatorSheetNote')],
      ['yaml', t('report.part.yaml'), t('report.part.yamlNote')],
      ['storyboard', t('report.part.storyboard'), t('report.part.storyboardNote')],
      ['flow-json', t('report.part.flowJson'), t('report.part.flowJsonNote')],
      ['playwright', t('report.part.playwright'), t('report.part.playwrightNote')],
      ['junit', t('report.part.junit'), t('report.part.junitNote')],
      ['har', t('report.part.har'), t('report.part.harNote')],
      ['postman', t('report.part.postman'), t('report.part.postmanNote')],
      ['postman-env', t('report.part.postmanEnv'), t('report.part.postmanEnvNote')],
      ...(has('harvest') ? [['harvest-map', t('report.part.harvestMap'), t('report.part.harvestMapNote')], ['harvest-pom', t('report.part.harvestPom'), t('report.part.harvestPomNote')], ['harvest-brief', t('report.part.harvestBrief'), t('report.part.harvestBriefNote')]] : []),
      ...(has('a11y') ? [['a11y', t('report.part.a11y'), t('report.part.a11yNote')]] : []),
    ] },
    { id: 'tickets', label: t('report.save.groupTickets'), items: [
      ['jira', t('report.part.jira'), t('report.part.jiraNote')],
      ['github', t('report.part.github'), t('report.part.githubNote')],
      ['csv', t('report.part.csv'), t('report.part.csvNote')],
    ] },
    { id: 'evidence', label: t('report.save.groupEvidence'), items: [
      ['media:screenshot', t('report.part.screenshots', { n: media.filter((m) => m.kind !== 'recording').length }), t('report.part.screenshotsNote')],
      ['media:recording', t('report.part.recordings', { n: media.filter((m) => m.kind === 'recording').length }), t('report.part.recordingsNote')], ['media:notes', t('report.part.exp1022Notes', { n: (events || []).filter((e) => e.kind === 'note' && e.tag !== 'technique' && String(e.text ?? '').trim()).length }), t('report.part.exp1022NotesNote')],
      // The soundtrack on its own, for the half of QA that is listened to: a
      // tester quoting what the app said, a transcript, a bug where the audio
      // is the evidence and a 40 MB clip is not.
      ...(media.some(hasSound)
        ? [['media:audio', t('report.part.audio', { n: media.filter(hasSound).length }), t('report.part.audioNote')]]
        : []),
    ] },
    { id: 'team', label: t('report.save.groupTeam'), items: [
      ['session-manifest', t('report.part.sessionCard'), t('report.part.sessionCardNote')],
    ] },
  ];
  return groups;
}
