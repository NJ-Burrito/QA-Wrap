/* QA Wrap — report: trackers, Mattermost, theme, session picking and boot (split from report.js; classic script, same global scope). */
/* ── telling the team ──────────────────────────────────────────────────── */

/**
 * The one summary every destination gets, built where the session already is.
 *
 * `background/notify.js` owns the shape of a chat summary and builds it for the
 * webhook route. This page needs the same object to post to a Mattermost
 * channel directly, and the honest way to get it is to call that function
 * rather than to write a second one: two summarisers is how a team reading
 * Slack and a team reading Mattermost end up comparing different numbers for
 * the same session, which is a small disaster and entirely avoidable.
 *
 * It is a plain module with no Chrome API at the top of it, so importing it
 * here reads Group G's file without changing it, which is the arrangement for
 * this round.
 */
async function chatSummary() {
  const { summarise } = await import('../background/notify.js');
  return summarise({ session, events, defect: null, links: reportLinks() });
}

/** Where a reader can go from the message: the report, and the issue if one was filed. */
function reportLinks() {
  // English, deliberately: this is a label inside a chat message, which is an
  // export body and not part of this page's interface.
  const links = { 'Open the report': location.href };
  const filed = window.UQAReport?.lastJira;
  if (filed?.url) links[filed.key] = filed.url;
  return links;
}

/**
 * Mattermost as an account, not a webhook (F5).
 *
 * ── the bug this answers ───────────────────────────────────────────────────
 *
 * "Tell the team / post to chat does nothing." It did nothing visible, which
 * for a tester is the same thing and is arguably worse. The button sits at the
 * bottom of a long panel and reported into `#file-status`, a muted line in the
 * filter bar at the very top of it: a press at the bottom of the page wrote its
 * answer somewhere off screen. And with no destination configured the worker
 * threw a perfectly good sentence that landed in that same invisible place.
 * Every outcome now appears directly under the button that caused it.
 *
 * ── why an account and not another webhook ─────────────────────────────────
 *
 * A webhook posts into one channel that somebody chose when they made the URL.
 * Nader asked to be able to pick a channel, and picking means listing, and
 * listing means being signed in. So this half signs in with a personal access
 * token, asks the server which teams the account is in and which channels are
 * in the team, and posts into the one chosen. Four REST v4 calls, in
 * `platform/chat-mattermost.js`.
 *
 * The token is held in `chrome.storage.local` for this profile only, is never
 * put in a log or an export, and there is a button to forget it beside the
 * field that asks for it. The surface says the word "Mattermost" and never
 * shows the mark: Mattermost requires written approval for any use of its
 * logos, while using the name to say what the button talks to is nominative
 * use. See research/51d-legal-privacy-licensing.md, sections 6 and 8.
 */
let mattermost = null;
const mmLib = async () => (mattermost ||= await import('../platform/chat-mattermost.js'));

/**
 * r3-06-1 (D-1010-45): a recording that lost events says so at the top. The worker leaves a tag:'capture-gap' note for every batch the
 * store refused ("... could not be stored: N") or could not confirm ("N events could not be confirmed ..."); the numbers are summed here.
 */
async function paintGapBanner(events) {
  const box = $('gap-banner');
  if (!box) return;
  // D-1010-108: core/formats-export.js captureGap() is the one reader (structured fields, never the note text).
  const { captureGap } = await import('../core/formats-export.js');
  const { lost, unconfirmed, other } = captureGap(events);
  const GAP_KEYS = {
    'coverage-detached': 'report.gap.coverageDetached',
    'recording-orphaned': 'report.gap.recordingOrphaned',
    'session-cap': 'report.gap.sessionCap',
    'body-cap': 'report.gap.bodyCap',
    'low-disk': 'report.gap.lowDisk',
    'replay-cap': 'report.gap.replayCap',
  };
  const lines = [];
  if (lost || unconfirmed) lines.push(t('report.gap.banner', { lost, unconfirmed }));
  for (const code of other) lines.push(t(GAP_KEYS[code] || 'report.gap.other'));
  box.hidden = !lines.length;
  if (lines.length) box.textContent = lines.join(' ');
}

function mmSay(text, tone = '') {
  const n = $('mm-status');
  if (!n) return;
  n.textContent = text;
  n.className = `chat-out ${tone}`.trim();
}

async function setupMattermost() {
  const panel = $('mattermost-panel');
  if (!panel) return;
  const lib = await mmLib();
  const saved = await lib.load();

  $('mm-url').value = saved.url || '';
  // The token is never written back into the field. A password box repopulated
  // from storage is a credential sitting in the DOM of a page that can be
  // screenshotted, and it teaches the reader nothing they did not know.
  // r3-09-1 (D-1010-46): forget is offered whenever a server is saved, locked or not (a locked vault says so when it refuses).
  $('mm-forget').hidden = !saved.url;
  // The closed-vault sentence names the way out: a link to unlock in Settings.
  const mmLocked = () => {
    const n = $('mm-status');
    if (!n) return;
    n.className = 'chat-out err';
    const link = el('a', null, t('report.mm.unlockLink'));
    link.setAttribute('href', '../options/options.html#sec-integrations'); // a constant page of this extension
    link.target = '_blank';
    link.rel = 'noopener';
    n.replaceChildren(`${t('report.mm.locked')} `, link);
  };
  const lockedNow = !saved.token && !!saved.url && !!saved.locked;
  if (saved.url && saved.token) {
    mmSay(t('report.mm.signedIn', { url: saved.url }));
  } else if (lockedNow) {
    mmLocked(); // r1-03-1: the token is in the vault; closed vault, no token, no post
    $('mm-post').disabled = true;
  }

  const account = () => ({
    url: $('mm-url').value.trim() || saved.url,
    token: $('mm-token').value.trim() || saved.token,
  });

  let me = null;

  $('mm-connect').addEventListener('click', async () => {
    const cfg = account();
    if (!cfg.token) return mmSay(t('report.mm.needToken'), 'err');
    $('mm-connect').disabled = true;
    mmSay(t('report.mm.signingIn'));
    try {
      lib.checkUrl(cfg.url);
      me = await lib.whoAmI(cfg);
      const list = await lib.teams(cfg);
      if (!list.length) throw new Error(t('report.mm.noTeams'));

      const teamSelect = $('mm-team');
      teamSelect.replaceChildren();
      for (const t of list) teamSelect.append(new Option(t.name, t.id));
      teamSelect.value = saved.teamId && list.some((t) => t.id === saved.teamId) ? saved.teamId : list[0].id;

      await lib.save({ url: lib.checkUrl(cfg.url), token: cfg.token });
      $('mm-token').value = '';
      $('mm-forget').hidden = false;
      $('mm-pickers').hidden = false;
      $('mm-post').disabled = false;
      $('mm-who').textContent = t('report.mm.signedInAs', { name: me.name });
      await loadChannels();
      mmSay(t('report.mm.teamsToChoose', { teams: t(list.length === 1 ? 'report.count.teamOne' : 'report.count.teamMany', { n: list.length }) }), 'ok');
    } catch (err) {
      $('mm-pickers').hidden = true;
      mmSay(werr(err), 'err');
    } finally {
      $('mm-connect').disabled = false;
    }
  });

  async function loadChannels() {
    const cfg = await lib.load();
    const teamId = $('mm-team').value;
    const select = $('mm-channel');
    select.replaceChildren(new Option(t('report.mm.readingChannels'), ''));
    select.disabled = true;
    try {
      const list = await lib.channels(cfg, me.id, teamId);
      select.replaceChildren();
      if (!list.length) {
        select.append(new Option(t('report.mm.noChannels'), ''));
        return;
      }
      // A private channel is marked as one. Posting a session summary into a
      // channel the reader thought was open is the kind of surprise a tool
      // should not spring, and the other way round matters just as much.
      for (const c of list) select.append(new Option(c.private ? t('report.mm.privateChannel', { name: c.name }) : c.name, c.id));
      select.value = saved.channelId && list.some((c) => c.id === saved.channelId) ? saved.channelId : list[0].id;
      select.disabled = false;
    } catch (err) {
      select.replaceChildren(new Option(werr(err), ''));
    }
  }

  $('mm-team').addEventListener('change', loadChannels);

  $('mm-post').addEventListener('click', async () => {
    const channel = $('mm-channel');
    if (!channel.value) return mmSay(t('report.mm.pickChannel'), 'err');
    // r3-09-1: the vault is checked BEFORE the confirm, so a certain refusal never costs the tester a decision.
    const cfg = await lib.load();
    if (cfg.locked && !cfg.token) return mmLocked();
    const where = channel.selectedOptions[0]?.textContent || t('report.mm.thatChannel');
    if (!confirm(t('report.mm.confirm', { where }))) return;

    $('mm-post').disabled = true;
    mmSay(t('report.mm.posting'));
    try {
      const summary = await chatSummary();
      // r1-03-1: policy, secret scan and ledger row are inside postSummary, before and around the one fetch
      const made = await lib.postSummary(cfg, channel.value, summary, reportLinks());
      await lib.save({ teamId: $('mm-team').value, channelId: channel.value });
      mmSay(made.id ? t('report.mm.posted', { where }) : t('report.mm.postedUnnamed', { where }), 'ok');
      window.UQASound?.play('chat.sent');
    } catch (err) {
      mmSay(werr(err), 'err');
      window.UQASound?.play('status.error');
    } finally {
      $('mm-post').disabled = false;
    }
  });

  $('mm-forget').addEventListener('click', async () => {
    if (!confirm(t('report.mm.forgetConfirm'))) return;
    try {
      await lib.forget();
    } catch (err) {
      return mmSay(werr(err), 'err'); // a closed vault cannot drop its copy of the token; say so rather than claim it is gone
    }
    $('mm-url').value = '';
    $('mm-token').value = '';
    $('mm-pickers').hidden = true;
    $('mm-forget').hidden = true;
    $('mm-who').textContent = '';
    mmSay(t('report.mm.forgotten'));
  });
}

/* ── theme ─────────────────────────────────────────────────────────────── */

function paintTheme() {
  const btn = $('theme');
  if (!btn || !window.UQATheme) return;
  const state = window.UQATheme.describe();
  // `ui/theme.js` belongs to every surface and answers in English. The mode is
  // the thing worth reading out of it; the words come from the shared table,
  // keyed by that mode, with the English answer as the fallback.
  const mode = window.UQATheme.read?.() || 'system';
  const { label, next } = window.UQADom.themeWords(mode, state);
  // The glyph comes from the icon family (UQAIcon), never a text character.
  btn.innerHTML = window.UQAIcon?.(`theme-${['light', 'dark'].includes(mode) ? mode : 'system'}`, { size: 16 }) || '';
  btn.title = t('common.theme.tooltip', { label, next: next.toLowerCase() });
}

$('theme')?.addEventListener('click', () => {
  window.UQATheme.cycle();
  paintTheme();
});

/* ── boot ──────────────────────────────────────────────────────────────── */

async function pickSession() {
  const res = await send({ type: 'UQA_LIST_SESSIONS' });
  const list = res.ok ? res.result || [] : [];
  const select = $('session-select');
  select.replaceChildren();
  for (const s of list) {
    const o = document.createElement('option');
    o.value = s.id;
    /*
     * The name first, then the date, and the ellipsis on the name.
     *
     * A `<select>` clips its option text at the control's width, and the old
     * order put the timestamp last, so a long charter ate it: "Food import
     * permit submit fails · 9/5/2026, 10:" — cut mid-hour, with a US-ordered
     * date in front of an Amman audience. The date is the shorter half and the
     * one that must survive, so the charter is trimmed here, in words, rather
     * than being cut by the control wherever it happens to run out.
     */
    const name = s.charter || t('report.session.untitled');
    o.textContent = `${name.length > 34 ? `${name.slice(0, 33).trimEnd()}…` : name} · ${stamp(s.startedAt)}`;
    o.title = `${name} · ${stamp(s.startedAt)}`;
    select.append(o);
  }

  /*
   * Unfiled — clips recorded outside a session, and clips whose session was
   * deleted while they were being written.
   *
   * They are real files taking real disk, and until this entry existed there
   * was no screen anywhere in the product that could show one, save one or
   * delete one. The bucket is only offered when it holds something, so an
   * ordinary profile never sees an empty shelf.
   */
  const unfiled = await send({ type: 'UQA_MEDIA_LIST', sessionId: 'unfiled' });
  if (unfiled.ok && (unfiled.result || []).length) {
    const o = document.createElement('option');
    o.value = 'unfiled';
    o.textContent = t('report.session.unfiled', { n: unfiled.result.length });
    select.append(o);
  }

  if (!sessionId || !list.some((s) => s.id === sessionId)) sessionId = list[0]?.id ?? null;
  select.value = sessionId || '';
  // A destructive delete, a save, a session picker and the eight content
  // tabs offered against no session are dead controls wearing live paint.
  // This is the one place that both populates the picker and knows whether
  // anything was found, so it is the one place that gets to decide whether
  // any of them are pressable (F5, research/91).
  setSessionControlsEnabled(!!sessionId);
  return sessionId;
}

/**
 * The single switch for every control that only makes sense with a session
 * on screen: the session picker itself, delete, save, and the eight
 * non-Overview tabs. Called only from pickSession(), so a control added
 * later that forgets to wire itself in here stays live over nothing instead
 * of silently working — one place to fix, not the two this replaced.
 */
function setSessionControlsEnabled(hasSession) {
  $('session-select').disabled = !hasSession;
  $('session-delete').disabled = !hasSession;
  $('save-all').disabled = $('copy-report').disabled = !hasSession;
  for (const id of TABS) {
    if (id === 'overview') continue;
    const btn = document.querySelector(`[data-tab="${id}"]`);
    btn.disabled = !hasSession;
    btn.setAttribute('aria-disabled', String(!hasSession));
  }
  for (const [id] of SECTIONS) {
    if (id === 'findings') continue;
    const btn = $(`sec-${id}`);
    btn.disabled = !hasSession;
    btn.setAttribute('aria-disabled', String(!hasSession));
  }
}

/*
 * Deleting the session this report is showing.
 *
 * It sits beside the picker because that is the only place in the product that
 * lists sessions one at a time, and a tester clearing out last week's work is
 * looking at them there. The worker refuses while the session is running or a
 * clip is still being filed into it (`UQA_DELETE_SESSION`), which is the right
 * answer rather than a cascade: they asked to delete something they are in the
 * middle of, and they should stop it first.
 *
 * `confirm()` and not a dialog of our own: one session is recoverable in the
 * sense that the others are still there, the sentence names what goes, and a
 * report page that grew a second modal for this would be carrying it for the
 * one press in a hundred that uses it.
 */
$('session-delete').addEventListener('click', async () => {
  if (!sessionId) return;
  const name = session?.charter || t('report.session.thisSession');
  if (!window.confirm(t('report.session.deleteConfirm', { name, count: events.length }))) return;
  const btn = $('session-delete');
  btn.disabled = true;
  btn.textContent = t('report.session.deleting');
  const res = await send({ type: 'UQA_DELETE_SESSION', sessionId });
  btn.disabled = false;
  btn.textContent = t('report.bar.delete');
  if (!res.ok) return say(werr(res) || t('report.session.deleteFailed'), 'err');
  say(t('report.session.deleted', { name: iso(name) }), 'ok');
  // Straight to whatever is left, or to the empty state if that was the last
  // one: a report showing a session that no longer exists is the bug this
  // whole action would otherwise create.
  sessionId = null;
  current = null;
  revokeAll();
  if (!(await pickSession())) {
    // pickSession() already disabled every session-only control; the hero's
    // own empty state carries the message now (F4/F5, research/91).
    setOverviewEmpty(true);
    return;
  }
  await loadSession();
});

$('session-select').addEventListener('change', (e) => {
  sessionId = e.target.value;
  current = null;
  // The diagram on screen belongs to the session being left. Marking it unbuilt
  // means the tab draws the new one the next time it is opened, rather than
  // showing the last session's workflow under this session's name.
  diagramReady = false;
  revokeAll();
  loadSession();
});

// The tab going away is the last chance to hand the bytes back. Chrome collects
// them eventually either way; a report left open in a background tab for a day
// should not be holding a gigabyte until then.
addEventListener('pagehide', revokeAll);

/**
 * The mark in the corner.
 *
 * Painted once the session is known, because a signature without the run it
 * signs is decoration. Fixed to the viewport rather than the document so it
 * does not drift into the middle of a screenshot of a long report, and
 * pointer-events:none so it can never intercept a click.
 */
async function paintMark(session) {
  const host = document.getElementById('report-mark');
  if (!host) return;
  const { GLYPH, MAKER, stamp } = await import('../core/provenance.js');
  // A glyph and a name, at the weight of a page number. The full colophon is on
  // hover for anyone who wants it, and costs nothing to everyone who does not.
  host.textContent = GLYPH;
  const label = document.createElement('span');
  label.textContent = MAKER.product;
  host.append(label);
  host.title = stamp({ session, version: chrome.runtime.getManifest().version });
}


/* ── sound ─────────────────────────────────────────────────────────────
   Off until switched on in Settings; the library only listens until then.
   Wired once here rather than per control, so anything rendered later is
   covered the moment it appears. */
(async () => {
  const settings = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.ok ? res.result : {}))
  );
  window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
  window.UQAVfx?.configure({ enabled: settings.vfxEnabled !== false });
  window.UQAVfx?.wire();
  window.UQASound?.wire(document);
})();

/**
 * The first-party classifier, loaded once.
 *
 * A dynamic import rather than a static one: this file is a classic script,
 * because `report/istqb.js` loads after it and needs `window.UQAReport` to
 * exist synchronously — making this a module would defer it past that.
 * `filingLib()` below takes the same route for the same reason.
 */
let origins = null;
/*
 * The finding count, from the one place that defines it.
 *
 * The headline used to count first-party *failures* and nothing else, so a
 * session that had found 83 accessibility violations, two broken links, four
 * clipped elements and five fine-print gaps opened with "0 problems found"
 * (research/58, finding 16). `countFindings` in core/sessions.js is the same
 * arithmetic the popup's live line and the Markdown export now do, which is the
 * point: one number, three surfaces.
 */
let sessionsLib = null;
/** Gap G2's join, loaded once — `renderSelectorCopies()` reads it synchronously. */
let actionJoinLib = null;

async function loadSession() {
  origins ||= await import('../core/origins.js').catch(() => null);
  sessionsLib ||= await import('../core/sessions.js').catch(() => null);
  actionJoinLib ||= await import('../core/action-join.js').catch(() => null);
  window.UQAReport.sessionId = sessionId;
  offerReplay();

  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId });
  if (!res.ok) return say(werr(res), 'err');
  session = res.result.session;
  events = res.result.events || [];

  const mediaRes = await send({ type: 'UQA_MEDIA_LIST', sessionId, companions: true });
  setMedia(mediaRes.ok ? mediaRes.result || [] : []);

  /*
   * The Unfiled shelf has no session row, because it is not a session.
   *
   * Every renderer below reads `session.startedAt`, `session.charter` and
   * `session.masked` without a guard, and rightly so — a report is a report of
   * a session. The bucket is given a record of its own instead, built from what
   * the clips themselves say, so the page renders as an ordinary report whose
   * timeline happens to be empty and whose gallery is the point.
   */
  if (!session && sessionId === 'unfiled' && media.length) {
    const times = media.map((m) => m.ts).filter(Number.isFinite);
    session = {
      id: 'unfiled',
      charter: t('report.session.unfiledCharter'),
      startedAt: times.length ? Math.min(...times) : Date.now(),
      endedAt: times.length ? Math.max(...times) : Date.now(),
      status: 'unfiled',
      masked: 0,
      synthetic: true,
    };
  }

  $('subtitle').textContent = session?.charter || t('report.bar.subtitle');
  renderOverview();
  renderChains();
  renderVerdict();
  renderFilters();
  renderSelectorCopies();
  renderTimeline();
  renderGallery();
  renderSizes();
  paintMark(session).catch(() => {});
  renderQuality();
  renderSaved();
  renderTeam();
  // The File-it tab holds a document built from this session; a different
  // session means a different document.
  if (fileTabReady) window.UQAIstqb?.rebuild();
  say('');
}

/**
 * The five headings inside the export picker.
 *
 * `<optgroup label>` is an attribute, and `QAWi18n.apply()` fills text plus the
 * three attributes the contract names. The options underneath are ordinary
 * `data-i18n` elements, because an `<option>` carries its words as text; only
 * the group headings need this walk. The keys are read off the DOM, exactly as
 * `apply()` reads its own, and every one of them is listed in
 * `report.dynamic.json`.
 */
function paintFormats() {
  for (const group of $('format').querySelectorAll('optgroup[data-i18n-label]')) {
    group.label = QAWi18n.t(group.dataset.i18nLabel);
  }
}

/**
 * Everything on this page that draws words, drawn again in the new language.
 *
 * A language change must not reload the report. A reload loses the tab the
 * reader is on, the filters they set, the boxes they ticked in the Save sheet
 * and the draft they were typing in the Jira tab, and none of that is worth
 * spending to change a language. So the static text is refilled and every
 * renderer is called again, in the order `loadSession()` calls them.
 *
 * The raw export is dropped rather than translated: its body is built by the
 * worker and is English either way, and only the page's own wrapper around it
 * moves. Rebuilding it costs one message and only when that tab is open.
 */
function repaintAll() {
  QAWi18n.apply();
  paintFormats();
  paintTheme();
  // The picker's own words: "Session" for a run with no charter, and the
  // Unfiled shelf. It re-reads the list and re-selects the session already on
  // screen, so it is safe to call for the labels alone.
  pickSession();
  // Titles only: each of these binds its click once and repaints on every
  // later call. `setupTrackers` redraws its rows from scratch, so its
  // listeners go with the nodes they were on.
  setupTrackers();
  if (!session) {
    if (!sessionId) {
      setOverviewEmpty(true);
    }
    return;
  }
  $('subtitle').textContent = session.charter || t('report.bar.subtitle');
  renderOverview();
  renderChains();
  renderVerdict();
  renderFilters();
  renderSelectorCopies();
  renderTimeline();
  renderGallery();
  renderSizes();
  renderQuality();
  renderSaved();
  renderTeam();
  if (diagramReady) renderDiagram();
  const raw = !$('panel-raw').hidden;
  current = null;
  if (raw) loadRaw();
  if (fileTabReady) window.UQAIstqb?.rebuild();
}

(async function boot() {
  // The words come first, and not as a nicety: `ready()` stamps `lang` and
  // `dir` on the root and fills in every `data-i18n` element in the HTML, and
  // a render that ran before it would paint the wrong language and then jump.
  await QAWi18n.ready();
  QAWi18n.onChange(repaintAll);
  paintFormats();
  paintTheme();
  // Before anything renders: the two rules this page reads a session with come
  // from core/, and a render that ran first would count zero of everything.
  await rulesReady;
  await bugfirstReady;
  await sigReady;
  const s = await send({ type: 'UQA_GET_SETTINGS' });
  if (s.ok) settings = s.result;
  // T-050: when a report was first opened. Local only; the support bundle (T-063) is the one reader.
  chrome.storage.local.get('firstReportOpenedAt').then((r) => {
    if (!r.firstReportOpenedAt) chrome.storage.local.set({ firstReportOpenedAt: Date.now() });
  }).catch(() => {});

  if (!(await pickSession())) {
    setOverviewEmpty(true);
    showTab('overview');
    return;
  }

  await loadSession();
  for (const id of ['jira-quick', 'jira-file', 'jira-connect']) managed($(id), 'integrationsAllowed');
  const want = location.hash.slice(1);
  const bySection = SECTIONS.find(([id]) => id === want);
  showTab(TABS.includes(want) ? want : bySection ? bySection[1][0] : 'broke');
  setupTrackers();
  setupMattermost();
})();
function hasSound(m) { return m.kind === 'recording' && (!m.sources || !!m.sources.tabAudio || !!m.sources.mic); } // no "Tab sound"/"Mic" = no track to export (EncodingError)
