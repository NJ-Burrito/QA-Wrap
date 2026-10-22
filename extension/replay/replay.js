/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The replay page: a session's DOM log, scrubbed.
 *
 * Everything that decides *what* the page looks like at a moment is in
 * `core/replay.js`, which is pure and tested in Node. This file is the plumbing:
 * ask the worker for the log, put a document into the sandboxed iframe, and
 * move a slider.
 *
 * The iframe is written through `srcdoc` rather than `document.write` into it,
 * because a sandboxed frame with no `allow-same-origin` cannot be reached from
 * here at all — which is the point. Nothing in the recorded page can run, and
 * nothing in it can look out.
 *
 * Rebuilding from the snapshot on every scrub is deliberate; the reasoning is
 * on `stateAt()`. On the fixture in `tools/test-replay.mjs` a full rebuild is
 * under a millisecond, and a tester scrubbing backwards — which is what they do
 * when they land on a failure — would have cost a rebuild anyway.
 */
import { stateAt, toDocument, span, failureMarks, humanSize } from '../core/replay.js';

/*
 * The words, before anything writes any.
 *
 * `platform/i18n.js` is a parser-blocking classic script in the head, so
 * `QAWi18n` is on the window by the time this module is evaluated. This file
 * is a module (not a classic script like `report.js`/`panel.js`), so it can
 * hold the boot on a top-level `await` instead of wrapping itself in an IIFE.
 *
 * Fix R2 (2026-09-28): this page shipped with no i18n at all — no
 * `platform/i18n.js`, no `data-i18n*`, every string hardcoded English (see
 * `work/ui-rework-0927/S11b-detail.md` §9). Wired here the same way
 * report/options are: static copy through `data-i18n*` in the HTML, computed
 * copy through `t()` here, kept in step on a language switch via
 * `QAWi18n.onChange` below.
 */
await QAWi18n.ready();

const t = (k, v) => QAWi18n.t(k, v);

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sessionId = params.get('session') || '';

const send = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: t('common.workerUnresponsive') })));

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** T-060: a screen reader says "0:12 of 1:04", not 12340. */
const setScrubText = (ms) => $('scrub').setAttribute('aria-valuetext', t('replay.controls.scrubValue', { at: mmss(ms), total: mmss(range.ms) }));

let log = [];
let range = { from: 0, to: 0, ms: 0 };
let timer = null;
let at = 0;
let shownIdx = -1; // entries applied in the frame now on screen
let lastWrite = 0; // when the iframe last reloaded; playback reloads it at most twice a second

/**
 * What the page currently shows, as data rather than only as painted text —
 * so `QAWi18n.onChange` (a language switch mid-session) can redraw exactly
 * what is on screen in the new language, instead of leaving whatever was
 * painted in the old one.
 */
let state = { kind: 'loading' };

/** Paint the moment. The only thing that touches the iframe. */
function render(ms) {
  at = ms;
  // T-073: the document only changes when an entry falls inside the step, so a
  // quiet page costs zero iframe reloads however fast the clock ticks.
  let idx = 0;
  for (let hi = log.length; idx < hi;) { const m = (idx + hi) >> 1; if ((log[m].t || 0) <= ms) idx = m + 1; else hi = m; } // bisect: entries with t <= ms
  // While playing, a busy page reloads the frame at most every 500 ms; scrubbing, pausing and the end draw the exact frame.
  if (idx !== shownIdx && !(timer && Date.now() - lastWrite < 500)) {
    shownIdx = idx;
    lastWrite = Date.now();
    $('stage').srcdoc = toDocument(stateAt(log, ms));
    window.__uqaSrcdocWrites = (window.__uqaSrcdocWrites || 0) + 1;
  }
  $('clock').textContent = mmss(ms);
  $('scrub').value = String(ms);
  setScrubText(ms);
}

/**
 * The play button's icon and word, from the new icon family (UI rework
 * round 2, S11b) — `#play-icon`'s `<use>` is swapped rather than the whole
 * button's innerHTML replaced, so the label stays a text node next to it.
 */
function setPlayState(playing) {
  $('play-icon').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('play-label').textContent = playing ? t('replay.controls.pause') : t('replay.controls.play');
  $('play').setAttribute('aria-label', playing ? t('replay.controls.pause') : t('replay.controls.play'));
}

function stop() {
  clearInterval(timer);
  timer = null;
  setPlayState(false);
}

/**
 * Play at wall-clock speed, in 100 ms steps.
 *
 * Not one timer per entry: a busy second holds hundreds of mutations, and a
 * timer each would starve the render. A step that redraws the whole state is
 * one paint however many changes fell inside it.
 */
function play() {
  if (timer) {
    stop();
    shownIdx = -1; // paused: draw the exact frame
    return render(at);
  }
  if (at >= range.ms) at = 0;
  setPlayState(true);
  timer = setInterval(() => {
    at += 100;
    if (at >= range.ms) {
      stop();
      render(range.ms);
      return;
    }
    render(at);
  }, 100);
}

/** Redraw everything `state` describes, in the active language. */
function paintState() {
  switch (state.kind) {
    case 'noSession':
      $('sub').textContent = t('replay.status.noSession');
      $('empty').hidden = false;
      break;
    case 'unreadable':
      // `state.error` is whatever the worker sent back — data, not copy — so
      // it is shown as-is, the same fallback shape `send()` above uses.
      $('sub').textContent = state.error || t('replay.status.unreadable');
      $('empty').hidden = false;
      break;
    case 'ready':
      $('title').textContent = state.title ? t('replay.header.titled', { title: state.title }) : t('replay.header.title');
      $('size').textContent = t(state.chunks === 1 ? 'replay.size.body.one' : 'replay.size.body.many', {
        size: humanSize(state.stored),
        n: state.count.toLocaleString(QAWi18n.numTag()),
        chunks: state.chunks,
      });
      if (state.empty) {
        $('sub').textContent = t('replay.empty.body');
        $('empty').hidden = false;
      } else {
        $('sub').textContent = state.unreadable
          ? t(state.unreadable === 1 ? 'replay.status.partial.one' : 'replay.status.partial.many', { n: state.unreadable })
          : t(state.heavy ? 'replay.status.heavy' : 'replay.status.ready');
        $('failure-note').textContent = state.marks
          ? t(state.marks === 1 ? 'replay.marks.one' : 'replay.marks.many', { n: state.marks })
          : t('replay.marks.none');
      }
      break;
    default:
      $('sub').textContent = t('replay.status.loading');
  }
}

async function load() {
  if (!sessionId) {
    state = { kind: 'noSession' };
    paintState();
    return;
  }
  const res = await send({ type: 'UQA_REPLAY_GET', sessionId });
  if (!res.ok) {
    state = { kind: 'unreadable', error: res.error };
    paintState();
    return;
  }
  const r = res.result;
  log = (r.entries || []).slice().sort((a, b) => (a.t || 0) - (b.t || 0)); // time order: render() bisects it
  range = span(log);

  state = {
    kind: 'ready',
    title: r.title,
    stored: r.stored,
    count: log.length,
    chunks: r.chunks,
    unreadable: r.unreadable,
    empty: !log.length,
    marks: 0,
    heavy: false,
  };

  if (!log.length) {
    paintState();
    return;
  }

  $('scrub').max = String(range.ms);
  $('total').textContent = mmss(range.ms);
  setScrubText(at);

  // The marks come from the session's events, not from the replay: a DOM log
  // knows the page changed, not that a request came back 500.
  const marks = failureMarks(r.events, r.startedAt);
  $('marks').replaceChildren(
    ...marks
      .filter((m) => m.t <= range.ms)
      // `insetInlineStart`, not `left`: the track flows end-to-start in
      // Arabic same as everywhere else in this product, so a mark placed by
      // its logical offset lands at the same moment in the recording in
      // either direction, not mirrored to the wrong end of the scrubber.
      .map((m) => {
        // A button, so a keyboard user can land on the failure too.
        const i = document.createElement('button');
        i.type = 'button';
        i.style.insetInlineStart = `${range.ms ? (m.t / range.ms) * 100 : 0}%`;
        i.title = m.what;
        i.setAttribute('aria-label', t('replay.marks.jump', { at: mmss(m.t), what: m.what }));
        i.addEventListener('click', () => {
          stop();
          render(m.t);
        });
        return i;
      })
  );
  state.marks = marks.length;
  state.heavy = log.some((e) => e.k === 'heavy');
  paintState();

  // Open at the first failure: that is the moment the tester came for.
  const first = marks.find((m) => m.t <= range.ms);
  render(first ? first.t : 0);
}

$('play').addEventListener('click', play);
$('scrub').addEventListener('input', (e) => {
  stop();
  render(Number(e.target.value) || 0);
});
$('theme')?.addEventListener('click', () => window.UQATheme?.cycle?.());

/*
 * A language change repaints this page. It does not reload it.
 *
 * `QAWi18n.apply()` covers everything marked with `data-i18n*` in the HTML;
 * `paintState()` covers the text this file computed itself, and the play
 * button's own words, which are neither.
 */
QAWi18n.onChange(() => {
  QAWi18n.apply();
  setPlayState(Boolean(timer));
  paintState();
});

load();
