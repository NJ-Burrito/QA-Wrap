/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The report's one filing control: the File menu, the Jira dialog, the other trackers, the chat
 * post and the .eml. Loaded before report.js, which calls `UQAFiling.control(ctx)` each time the
 * verdict card is drawn.
 *
 * Messages and codes are the ones in work/round3/JIRA-API.md. Every code is answered in the page's
 * own words (report.f.*); `error` sentences from the worker are shown only for codes-less
 * failures (network, 401, 403), which stay plain English by contract.
 *
 * ctx = { sessionId, session, events, send, say, steps: string[], line, title, screenshotCount,
 *         markdown(): Promise<string>, screens(): Promise<{name,type,bytes}[]>, onFiled() }
 */
(function () {
  const t = (k, v) => QAWi18n.t(k, v);
  const $ = (id) => document.getElementById(id);
  const { esc } = window.UQADom; // ui/dom.js: the full five-character HTML escape
  const ltr = (s) => `<bdi dir="ltr" class="code">${esc(s)}</bdi>`;
  /** r1-02-6: the one link rule for data-built hrefs: http, https, mailto or tel (any case, leading space ignored) returns the address, anything else returns ''. */
  function safeHref(u) {
    try { const p = new URL(String(u ?? '').trim()); return ['http:', 'https:', 'mailto:', 'tel:'].includes(p.protocol) ? p.href.replace(/[() ]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : ''; } catch { return ''; } // r2-03-2: same rule as core/events.js safeHref (a classic script cannot import it; test-egress checks the two agree)
  }
  /** An anchor around `inner` (already escaped HTML) when the address is safe, else the bare `inner`. */
  const anchor = (url, inner) => (safeHref(url) ? `<a href="${esc(safeHref(url))}" target="_blank" rel="noopener">${inner}</a>` : inner);
  const icon = (id) => (window.UQAIcon ? window.UQAIcon(id, { size: 16 }) : '');
  const OPTIONS = '../options/options.html#sec-integrations';

  let X = null; // the ctx of the card on screen
  let S = null; // settings as this page sees them (secrets masked)
  let D = null; // the dialog's state
  let seq = 0;
  let outside = null;

  /* ── what is set up ─────────────────────────────────────────────────── */

  async function integrations() {
    const s = await X.send({ type: 'UQA_GET_SETTINGS' });
    S = s.ok ? s.result : {};
    const j = S.jira || {};
    const jira = !!(j.baseUrl && j.token && j.project);
    const tr = await X.send({ type: 'UQA_TRACKER_STATE' });
    const trackers = tr.ok ? tr.result.filter((x) => x.configured) : [];
    const chat = (S.webhooks || []).filter((d) => d.url && d.enabled !== false).length + (S.slack?.webhookUrl ? 1 : 0);
    return { jira, trackers, chat, any: jira || trackers.length > 0 || chat > 0 };
  }

  const originOf = (u) => { try { const p = new URL(String(u).trim()); return /^https?:$/.test(p.protocol) ? `${p.protocol}//${p.host}/*` : null; } catch { return null; } };
  const hostOf = (u) => { try { return new URL(String(u).trim()).host; } catch { return String(u || ''); } };
  async function hasAccess(urls) {
    const need = [...new Set(urls.map(originOf).filter(Boolean))];
    if (!need.length || !chrome.permissions?.contains) return true;
    return chrome.permissions.contains({ origins: need }).catch(() => false);
  }
  async function askAccess(urls) {
    const need = [...new Set(urls.map(originOf).filter(Boolean))];
    if (!need.length || !chrome.permissions?.request) return true;
    return chrome.permissions.request({ origins: need }).catch(() => false);
  }

  /* ── the control ────────────────────────────────────────────────────── */

  async function control(ctx) {
    X = ctx;
    const my = ++seq;
    const I = await integrations();
    window.UQAReport.hasFiling = I.any;
    if (!I.any && $('auto-submit-row')) $('auto-submit-row').hidden = true;
    if (my !== seq) return document.createComment('stale');
    if (!I.any) {
      const a = document.createElement('a');
      a.className = 'btn btn-secondary';
      a.id = 'btn-file';
      a.href = `${OPTIONS}`;
      a.innerHTML = `${icon('settings')}<span>${esc(t('report.f.setup'))}</span>`;
      return a;
    }
    const host = document.createElement('span');
    host.className = 'menu-host';
    const items = [];
    if (I.jira) items.push(['jira', 'export-markdown', t('report.f.toJira')]);
    for (const tr of I.trackers) items.push([`tracker:${tr.id}`, 'export-markdown', t('report.f.toTracker', { name: tr.label })]);
    if (I.chat) items.push(['chat', 'events', t(I.chat === 1 ? 'report.f.chatOne' : 'report.f.chatMany', { n: I.chat })]);
    items.push(['eml', 'external', t('report.f.email')]);
    host.innerHTML = `<button type="button" class="btn btn-secondary" id="btn-file" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-file"><span>${esc(t('report.f.file'))}</span>${icon('chevron-down')}</button>
      <div class="menu glass" id="menu-file" role="menu" hidden>${items.map(([id, ic, label]) => `<button type="button" role="menuitem" data-file="${esc(id)}" tabindex="-1">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}
      <a role="menuitem" tabindex="-1" href="${OPTIONS}">${icon('settings')}<span>${esc(t('report.f.more'))}</span></a></div>`;
    const btn = host.querySelector('#btn-file');
    const menu = host.querySelector('#menu-file');
    const close = (focus) => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
    const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('[role=menuitem]').focus(); };
    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } });
    menu.addEventListener('keydown', (e) => {
      const list = [...menu.querySelectorAll('[role=menuitem]')];
      const at = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') list[(at + 1) % list.length].focus();
      else if (e.key === 'ArrowUp') list[(at - 1 + list.length) % list.length].focus();
      else if (e.key === 'Home') list[0].focus();
      else if (e.key === 'End') list[list.length - 1].focus();
      else if (e.key === 'Escape') close(true);
      else if (e.key === 'Tab') close();
      else return;
      e.preventDefault();
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-file]');
      if (!item) return;
      close();
      const [what, id] = item.dataset.file.split(':');
      if (what === 'jira') openJira();
      else if (what === 'tracker') openTracker(I.trackers.find((x) => x.id === id));
      else if (what === 'chat') openChat();
      else if (what === 'eml') download();
    });
    // One outside-click listener at a time: the card is redrawn on every language change and filing.
    if (outside) document.removeEventListener('click', outside);
    outside = (e) => { if (!host.contains(e.target)) close(); };
    document.addEventListener('click', outside);
    return host;
  }

  /* ── the dialog shell ───────────────────────────────────────────────── */

  const dlg = () => $('dlg-file');
  function shell(title, site, body, footer) {
    dlg().innerHTML = `<div class="dh"><h2 id="dj-h" class="grow">${esc(title)}</h2>${site ? `<span class="scope">${ltr(site)}</span>` : ''}<button type="button" class="btn btn-icon btn-quiet" data-d="close" aria-label="${esc(t('report.f.close'))}">${icon('close')}</button></div>
      <div class="db">${body}</div><div class="df">${footer}</div>`;
  }
  const note = (kind, ic, inner) => `<div class="note ${kind}" ${kind === 'err' || kind === 'warn' ? 'role="alert"' : ''}>${icon(ic)}<div class="stack">${inner}</div></div>`;
  function show(after) {
    const d = dlg();
    if (!d.open) d.showModal();
    if (after) after();
  }
  const keepFocus = (fn) => {
    const id = document.activeElement?.id || document.activeElement?.dataset?.d;
    fn();
    const back = id && (document.getElementById(id) || dlg().querySelector(`[data-d="${id}"]`));
    if (back) back.focus();
  };

  /* ── Jira ───────────────────────────────────────────────────────────── */

  const KINDS = ['private-key', 'jwt', 'authorization', 'cookie', 'vendor-token', 'webhook-url', 'url-credentials', 'password', 'saved-token'];
  const kindWord = (k) => t(`report.f.kind.${KINDS.includes(k) ? k : 'other'}`);
  const fieldWord = (f) => {
    const [ref, ...rest] = String(f).split(':');
    const name = rest.length ? rest.join(':') : ref;
    if (ref === 'summary') return t('report.f.fSummary');
    if (ref === 'description') return t('report.f.fDescription');
    if (ref === 'attachment') return t('report.f.fAttachment', { name });
    if (ref === 'field') return t('report.f.fField', { name });
    return f;
  };
  const REASONS = ['no-metadata', 'no-such-type', 'not-on-screen', 'unshapeable', 'value-not-allowed'];
  const reasonWord = (r) => t(`report.f.reason.${REASONS.includes(r) ? r : 'other'}`);
  const SEVERITY = ['critical', 'major', 'moderate', 'minor'];
  const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

  async function openJira() {
    const j = S.jira || {};
    D = { kind: 'jira', mode: 'new', perm: await hasAccess([j.baseUrl]), checking: false, dupes: null, scan: null, redact: false, target: '', typed: '', busy: false, err: null, done: null,
      site: hostOf(j.baseUrl), project: j.project || '', type: j.issueType || 'Bug', summary: '', draft: null, projects: [], types: [], severity: 'major', priority: '', mapped: '', drop: false, fp: null };
    paintJira();
    show();
    if (D.perm) check();
  }

  async function allow() {
    const j = S.jira || {};
    // The browser's own prompt: it needs this click, which is why it is a button and not automatic.
    D.perm = await askAccess([j.baseUrl]);
    if (!D.perm) { D.err = { text: t('report.f.notAllowed', { site: D.site }) }; return paintJira(); }
    D.err = null;
    check();
  }

  async function check() {
    D.checking = true;
    paintJira();
    const sessionId = X.sessionId;
    const base = { sessionId, kind: 'defect', projectKey: D.project || undefined, issueTypeName: D.type || undefined };
    const [dup, scan, draft, projects, types, sev] = await Promise.all([
      X.send({ type: 'UQA_JIRA_DUPES', sessionId, projectKey: D.project || undefined }),
      X.send({ type: 'UQA_JIRA_SCAN', ...base }),
      X.send({ type: 'UQA_JIRA_DRAFT', sessionId, kind: 'defect' }),
      X.send({ type: 'UQA_JIRA_PROJECTS' }),
      D.project ? X.send({ type: 'UQA_JIRA_TYPES', projectKey: D.project }) : { ok: false },
      severityOf(),
    ]);
    if (!dlg().open) return;
    D.checking = false;
    if (dup.ok) { D.dupes = dup.result.candidates || []; D.fp = dup.result.fingerprint; } else { D.dupes = []; D.dupeErr = dup; }
    if (scan.ok) D.scan = scan.result; else if (scan.code === 'VAULT_LOCKED') D.err = { code: 'VAULT_LOCKED' }; else if (scan.code === 'SECRET_FOUND') D.scan = { clean: false, findings: scan.data?.findings || [], dropped: [], skipped: [] };
    if (draft.ok) { D.draft = draft.result; D.summary = D.summary || draft.result.summary || ''; }
    if (projects.ok) D.projects = projects.result;
    if (types.ok) D.types = types.result.filter((x) => !x.subtask);
    D.severity = sev.severity;
    D.mapped = sev.priority;
    D.priority = D.priority || sev.priority;
    paintJira();
  }

  /** Severity of this session's defect and the Jira priority the map gives it (settings override the default per key). */
  async function severityOf() {
    let severity = 'major';
    try {
      const { buildDefectReport } = await import('../core/istqb.js');
      severity = buildDefectReport(X.session, X.events, {}).severity || 'major';
    } catch { /* the worker still decides; this is only the label */ }
    let map = { critical: 'Highest', major: 'High', moderate: 'Medium', minor: 'Low' };
    try { map = { ...(await import('../platform/settings.js')).DEFAULT_PRIORITY_MAP }; } catch { /* keep the mirror */ }
    Object.assign(map, S.jira?.priorityMap || {});
    return { severity, priority: map[severity] || '' };
  }

  function paintJira() {
    if (D?.kind !== 'jira') return;
    keepFocus(() => {
      const perm = D.perm;
      let b = '';
      if (D.done) return shell(t('report.f.doneTitle'), D.site, jiraDone(), `<button type="button" class="btn btn-primary" data-d="close">${esc(t('report.f.done'))}</button>`);
      if (!perm) {
        b += note('info', 'consent', `<b>${esc(t('report.f.permTitle'))} ${ltr(D.site)}</b><span>${esc(t('report.f.permBody'))}</span>` +
          `<span><button type="button" class="btn btn-primary btn-sm" data-d="allow">${esc(t('report.f.allow'))}</button></span>`);
        if (D.err?.text) b += note('err', 'warning', `<span>${esc(D.err.text)}</span>`);
      } else {
        b += `<div class="seg" role="group" aria-label="${esc(t('report.f.mode'))}"><button type="button" data-d="mode" data-m="new" aria-pressed="${D.mode === 'new'}">${esc(t('report.f.modeNew'))}</button><button type="button" data-d="mode" data-m="existing" aria-pressed="${D.mode === 'existing'}">${esc(t('report.f.modeExisting'))}</button></div>`;
        b += dupesHtml();
        b += signalHtml();
        b += D.mode === 'new' ? newHtml() : existingHtml();
        b += problemsHtml();
        b += sentHtml();
      }
      const can = perm && !D.checking && !D.busy && (D.mode === 'new' || D.target);
      shell(D.mode === 'existing' ? t('report.f.titleExisting') : t('report.f.title'), D.site, b,
        `<button type="button" class="btn btn-quiet" data-d="close">${esc(t('report.f.cancel'))}</button>` +
        `<button type="button" class="btn btn-primary" data-d="create"${can ? '' : ' disabled'}>${esc(D.busy ? t('report.f.filing') : D.mode === 'existing' ? t('report.f.addTo', { key: D.target || '…' }) : t('report.f.create'))}</button>`);
    });
  }

  function dupesHtml() {
    const rows = (D.dupes || []).map((d) => `<div class="hrow"><span class="scope">${ltr(d.key)}</span><span class="grow small">${esc(d.summary)}</span><span class="badge badge-skipped">${esc(d.status || '')}</span>` +
      `<button type="button" class="btn btn-secondary btn-sm" data-d="target" data-k="${esc(d.key)}" aria-pressed="${D.target === d.key}">${esc(D.target === d.key ? t('report.f.selected') : t('report.f.addEvidence'))}</button></div>`).join('');
    return `<div class="card pad stack" aria-live="polite"><div class="hrow"><h3 class="grow">${esc(t('report.f.dupTitle'))}</h3>${D.checking ? `<span class="cap muted pulse">${esc(t('report.f.dupChecking'))}</span>` : D.dupeErr ? '' : `<span class="badge ${D.dupes?.length ? 'badge-warn' : 'badge-pass'}">${D.dupes?.length || 0}</span>`}</div>` +
      (D.checking ? '' : (D.dupeErr ? `<p class="hint">${esc(t('report.f.dupFailed'))}</p>` : rows || `<p class="hint">${esc(t('report.f.dupNone'))}</p>`) + `<p class="hint">${esc(t('report.f.dupNever'))}</p>`) + '</div>';
  }

  function newHtml() {
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label || v)}</option>`;
    const projs = D.projects.some((p) => p.key === D.project) || !D.project ? D.projects : [{ key: D.project, name: D.project }, ...D.projects];
    const types = D.types.some((x) => x.name === D.type) || !D.type ? D.types : [{ name: D.type }, ...D.types];
    const prios = PRIORITIES.includes(D.priority) || !D.priority ? PRIORITIES : [D.priority, ...PRIORITIES];
    return `<div class="grid2"><div class="field"><label for="j-p">${esc(t('report.f.project'))}</label><select id="j-p" class="input" data-d="project">${projs.map((p) => opt(p.key, D.project, `${p.name} (${p.key})`)).join('') || opt('', '', '—')}</select></div>` +
      `<div class="field"><label for="j-t">${esc(t('report.f.type'))}</label><select id="j-t" class="input" data-d="type">${types.map((x) => opt(x.name, D.type)).join('') || opt(D.type, D.type)}</select></div></div>` +
      `<div class="field"><label for="j-s">${esc(t('report.f.summary'))}</label><input id="j-s" class="input" data-d="summary" value="${esc(D.summary)}" maxlength="255"></div>` +
      `<div class="card pad stack"><h3>${esc(t('report.f.sevTitle'))}</h3><div class="grid3">` +
      `<div class="field"><span class="lbl">${esc(t('report.f.sevIn'))}</span><span class="badge badge-fail">${esc(t(`report.f.sev.${SEVERITY.includes(D.severity) ? D.severity : 'major'}`))}</span></div>` +
      `<div class="field"><label for="j-pr">${esc(t('report.f.priority'))}</label><select id="j-pr" class="input" data-d="priority">${prios.map((p) => opt(p, D.priority)).join('')}</select></div>` +
      `<div class="field"><span class="lbl">${esc(t('report.f.labels'))}</span><span class="hrow"><span class="scope">qa-wrap</span>${D.fp ? `<span class="scope">${ltr(D.fp)}</span>` : ''}</span></div></div>` +
      `<p class="hint">${esc(t('report.f.sevHint'))}</p></div>`;
  }

  function existingHtml() {
    return `<div class="field"><label for="j-k">${esc(t('report.f.keyLabel'))}</label><input id="j-k" class="input mono" dir="ltr" data-d="typed" value="${esc(D.typed)}" placeholder="PROJ-123" autocomplete="off"><span class="hint">${esc(t('report.f.existingHint'))}</span></div>`;
  }

  /** The number filed is the report's own: X.signal comes from visibleProblems. Notes are filed only when asked. */
  function signalHtml() {
    const s = X.signal;
    if (!s) return '';
    return `<p class="hint">${esc(t('common.signal.filedProblems', { n: s.problems }))}</p>` +
      (s.notes.length ? `<label class="check"><input type="checkbox" data-d="notes"${D.notes ? ' checked' : ''}> <span>${esc(t('common.signal.includeNotes'))}</span></label>` : '');
  }

  function problemsHtml() {
    let h = '';
    if (D.err) h += errHtml(D.err);
    const sc = D.scan;
    if (sc?.dropped?.length && D.mode === 'new') h += note('warn', 'warning', `<b>${esc(t('report.f.droppedTitle'))}</b>` + sc.dropped.map((f) => `<span>${ltr(f.name || f.key)}: ${esc(reasonWord(f.reason))}</span>`).join(''));
    if (sc && !sc.clean && sc.findings?.length) {
      if (D.redact) h += note('ok', 'check', `<span>${esc(t('report.f.hidden'))}</span>`);
      else h += note('warn', 'warning', `<b>${esc(t(sc.findings.length === 1 ? 'report.f.secretOne' : 'report.f.secretMany', { n: sc.findings.length }))}</b>` +
        sc.findings.map((f) => `<span class="small">${esc(fieldWord(f.field))}: ${esc(kindWord(f.kind))}</span>`).join('') +
        `<span><button type="button" class="btn btn-secondary btn-sm" data-d="redact">${esc(t('report.f.hideIt'))}</button></span>`);
    }
    return h;
  }

  function errHtml(e) {
    if (e.code === 'VAULT_LOCKED') return note('err', 'warning', `<b>${esc(t('report.f.locked'))}</b><span><a class="btn btn-secondary btn-sm" href="${OPTIONS}" target="_blank" rel="noopener">${esc(t('report.f.unlock'))}</a></span>`);
    if (e.code === 'JIRA_FIELD_DROPPED') return note('err', 'warning', `<b>${esc(t('report.f.fieldDropped'))}</b>` + (e.fields || []).map((f) => `<span>${ltr(f.name || f.key)}: ${esc(reasonWord(f.reason))}</span>`).join('') +
      `<span><button type="button" class="btn btn-secondary btn-sm" data-d="withoutTyped">${esc(t('report.f.fileWithout'))}</button></span>`);
    return note('err', 'warning', `<span>${esc(e.text || t('report.f.failed'))}</span>`);
  }

  function sentHtml() {
    const shots = X.screenshotCount || 0;
    const chars = D.draft?.body ? D.draft.body.length : 0;
    const site = D.site;
    return `<div class="card pad stack"><h3>${esc(t('report.f.sentTitle', { site }))}</h3><ul class="stack small">` +
      `<li>${icon('check')} ${esc(t('report.f.sentText', { n: chars.toLocaleString(QAWi18n.numTag()) }))}</li>` +
      `<li>${icon('check')} ${esc(t(shots === 1 ? 'report.f.sentShotsOne' : 'report.f.sentShots', { n: shots }))}</li>` +
      `<li class="muted">${icon('cross')} ${esc(t('report.f.notSent'))}</li></ul>` +
      (shots ? `<p class="small filing-unscanned">${icon('warning')} ${esc(t('report.f.mediaUnscanned'))}</p>` : '') + `</div>`;
  }

  function jiraDone() {
    const r = D.done;
    const bad = (r.attachments || []).filter((a) => !a.ok);
    return note('ok', 'check', `<b>${esc(t(r.mode === 'commented' ? 'report.f.addedTo' : 'report.f.created'))} ${anchor(r.url, ltr(r.key))}</b>` +
      `<span>${esc(t('report.f.attached', { n: (r.attachments || []).length - bad.length }))}</span>` +
      (bad.length ? `<span class="small">${esc(t('report.f.attachFailed', { names: bad.map((a) => a.name).join(', ') }))}</span>` : '') +
      (r.redacted ? `<span class="small">${esc(t('report.f.redactedN', { n: r.redacted }))}</span>` : '') +
      ((r.skipped || []).length ? `<span class="small">${esc(t('report.f.skipped', { names: r.skipped.map((s) => s.key).join(', ') }))}</span>` : '') +
      ((r.relationships || []).some((x) => x.error) ? `<span class="small">${esc(t('report.f.linkFailed'))}</span>` : ''));
  }

  async function create() {
    if (D.busy) return;
    const existing = D.mode === 'existing';
    const key = (existing ? D.target : '').trim();
    D.busy = true; D.err = null; paintJira();
    // The same evidence set as the quick route (worker QUICK_ATTACH.defect); UQA_JIRA_FILE sends only what it is told to.
    const msg = { type: 'UQA_JIRA_FILE', sessionId: X.sessionId, kind: 'defect', attach: { screenshots: true, formats: ['markdown', 'sbtm', 'har'] }, redact: D.redact || undefined, includeNotes: D.notes || undefined };
    if (existing) msg.existingKey = key;
    else {
      msg.projectKey = D.project || undefined;
      msg.issueTypeName = D.type || undefined;
      if (D.summary && D.summary !== D.draft?.summary) msg.summary = D.summary;
      if (D.priority && D.priority !== D.mapped && !D.drop) msg.fields = { priority: { name: D.priority } };
    }
    const out = await X.send(msg);
    D.busy = false;
    if (!dlg().open) return;
    if (out.ok) {
      D.done = out.result;
      window.UQAReport.lastJira = { key: out.result.key, url: out.result.url };
      paintJira();
      X.onFiled?.();
      return;
    }
    if (out.code === 'SECRET_FOUND') { D.scan = { ...(D.scan || { dropped: [], skipped: [] }), clean: false, findings: out.data?.findings || [] }; D.err = null; }
    else if (out.code === 'JIRA_FIELD_DROPPED') D.err = { code: out.code, fields: out.data?.fields || [] };
    else if (out.code === 'VAULT_LOCKED') D.err = { code: out.code };
    else D.err = { text: window.UQAReport.werr(out) };
    paintJira();
  }

  /* ── the other trackers ─────────────────────────────────────────────── */

  async function openTracker(tr) {
    if (!tr) return;
    D = { kind: 'tracker', tr, site: hostOf(tr.url), perm: await hasAccess([tr.url]), targets: null, target: '', busy: false, err: null, done: null };
    paintTracker();
    show();
    if (D.perm) loadTargets();
  }
  async function loadTargets() {
    const out = await X.send({ type: 'UQA_TRACKER_TARGETS', tracker: D.tr.id });
    if (D?.kind !== 'tracker') return;
    D.targets = out.ok ? out.result : [];
    if (!out.ok) D.err = out.code === 'VAULT_LOCKED' ? { code: out.code } : { text: window.UQAReport.werr(out) };
    D.target = D.targets[0]?.id || '';
    paintTracker();
  }
  /** How each tracker takes the screenshots, said before Create. GitHub has no call for it: its notice is report.f.noAttach. */
  const ATTACH_HOW = { gitlab: 'report.f.attachGitlab', azure: 'report.f.attachAzure', linear: 'report.f.attachLinear' };
  /** The outcome as the tracker reported it: what was attached, what was not, what was hidden. */
  function trackerDone(r) {
    const got = (r.attached || []).filter((a) => a.ok).length;
    const bad = (r.attached || []).filter((a) => !a.ok);
    if (r.duplicate) return note('info', 'check', `<b>${esc(t('report.f.duplicateFound'))} ${anchor(r.url, ltr(r.key))}</b><span class="small">${esc(t('report.f.duplicateNote'))}</span>`);
    return note(bad.length ? 'warn' : 'ok', bad.length ? 'warning' : 'check', `<b>${esc(t('report.f.created'))} ${anchor(r.url, ltr(r.key))}</b>` +
      (r.attachSupported === false && X.screenshotCount ? `<span class="small">${esc(t('report.f.noAttachDone', { name: r.label || D.tr.label }))}</span>` : '') +
      (got ? `<span class="small">${esc(t('report.f.attached', { n: got }))}</span>` : '') +
      (bad.length ? `<span class="small">${esc(t('report.f.attachFailed', { names: bad.map((a) => a.name).join(', ') }))}</span>` : '') +
      (r.redacted ? `<span class="small">${esc(t('report.f.redactedN', { n: r.redacted }))}</span>` : ''));
  }
  function paintTracker() {
    if (D?.kind !== 'tracker') return;
    keepFocus(() => {
      let b = '';
      if (D.done) b = trackerDone(D.done);
      else if (!D.perm) b = note('info', 'consent', `<b>${esc(t('report.f.permTitle'))} ${ltr(D.site)}</b><span>${esc(t('report.f.permBody'))}</span><span><button type="button" class="btn btn-primary btn-sm" data-d="allowT">${esc(t('report.f.allow'))}</button></span>`);
      else {
        if (D.targets?.length) b += `<div class="field"><label for="tr-t">${esc(t('report.f.trTarget'))}</label><select id="tr-t" class="input" data-d="trTarget">${D.targets.map((o) => `<option value="${esc(o.id)}"${o.id === D.target ? ' selected' : ''}>${esc(o.note ? `${o.label} (${o.note})` : o.label)}</option>`).join('')}</select></div>`;
        else if (!D.err) b += `<p class="muted pulse">${esc(t('report.f.loading'))}</p>`;
        b += `<div class="card pad stack"><h3>${esc(t('report.f.sentTitle', { site: D.site }))}</h3><ul class="stack small"><li>${icon('check')} ${esc(t(D.tr.attach ? 'report.f.trSent' : 'report.f.trSentText'))}</li>` +
          (D.tr.attach ? '' : `<li class="muted filing-noattach">${icon('cross')} ${esc(t('report.f.noAttach', { name: D.tr.label }))}</li>`) +
          (D.tr.attach && ATTACH_HOW[D.tr.id] ? `<li class="muted">${icon('check')} ${esc(t(ATTACH_HOW[D.tr.id]))}</li>` : '') +
          `<li class="muted">${icon('cross')} ${esc(t('report.f.notSent'))}</li></ul>` +
          (D.tr.attach && X.screenshotCount ? `<p class="small filing-unscanned">${icon('warning')} ${esc(t('report.f.mediaUnscanned'))}</p>` : '') + `</div>`;
      }
      if (D.err) b += errHtml(D.err);
      shell(t('report.f.toTracker', { name: D.tr.label }).replace('…', ''), D.site, b, D.done ? `<button type="button" class="btn btn-primary" data-d="close">${esc(t('report.f.done'))}</button>`
        : `<button type="button" class="btn btn-quiet" data-d="close">${esc(t('report.f.cancel'))}</button><button type="button" class="btn btn-primary" data-d="createT"${D.perm && !D.busy ? '' : ' disabled'}>${esc(D.busy ? t('report.f.filing') : t('report.f.create'))}</button>`);
    });
  }
  async function createTracker() {
    D.busy = true; D.err = null; paintTracker();
    const out = await X.send({ type: 'UQA_TRACKER_FILE', sessionId: X.sessionId, tracker: D.tr.id, target: D.target || undefined });
    D.busy = false;
    if (out.ok) { D.done = out.result; window.UQAReport.lastJira = window.UQAReport.lastJira || null; X.onFiled?.(); } else D.err = out.code === 'VAULT_LOCKED' ? { code: out.code } : { text: window.UQAReport.werr(out) };
    paintTracker();
  }

  /* ── chat ───────────────────────────────────────────────────────────── */

  async function openChat() {
    const urls = (S.webhooks || []).filter((d) => d.url && d.enabled !== false).map((d) => d.url);
    if (S.slack?.webhookUrl) urls.push(S.slack.webhookUrl);
    D = { kind: 'chat', urls, n: urls.length, perm: await hasAccess(urls), busy: false, err: null, results: null };
    paintChat();
    show();
  }
  function paintChat() {
    if (D?.kind !== 'chat') return;
    keepFocus(() => {
      let b = '';
      const where = t(D.n === 1 ? 'report.f.destOne' : 'report.f.destMany', { n: D.n });
      if (D.results) {
        b = D.results.map((r) => note(r.sent ? 'ok' : r.skipped ? 'info' : 'err', r.sent ? 'check' : 'warning', `<span><b>${esc(r.label || '')}</b> ${esc(r.sent ? t('report.f.posted') : r.skipped ? t('report.f.belowFloor') : (r.error || t('report.f.failed')))}</span>`)).join('') || note('info', 'info', `<span>${esc(t('report.f.nothingPosted'))}</span>`);
      } else {
        b = `<p>${esc(t('report.f.chatBody', { where }))}</p>`;
        if (!D.perm) b += note('info', 'consent', `<b>${esc(t('report.f.permChat'))}</b><span>${esc(t('report.f.permBody'))}</span><span><button type="button" class="btn btn-primary btn-sm" data-d="allowC">${esc(t('report.f.allow'))}</button></span>`);
        if (D.err) b += errHtml(D.err);
      }
      shell(t('report.f.chatTitle'), '', b, D.results ? `<button type="button" class="btn btn-primary" data-d="close">${esc(t('report.f.done'))}</button>`
        : `<button type="button" class="btn btn-quiet" data-d="close">${esc(t('report.f.cancel'))}</button><button type="button" class="btn btn-primary" data-d="post"${D.perm && !D.busy ? '' : ' disabled'}>${esc(D.busy ? t('report.f.posting') : t('report.f.post'))}</button>`);
    });
  }
  async function post() {
    D.busy = true; D.err = null; paintChat();
    const out = await X.send({ type: 'UQA_NOTIFY', sessionId: X.sessionId, links: { 'Open the report': location.href } });
    D.busy = false;
    if (out.ok) D.results = out.result?.results || out.result || [];
    else D.err = out.code === 'VAULT_LOCKED' ? { code: out.code } : { text: window.UQAReport.werr(out) || t('report.f.nothingPosted') };
    paintChat();
  }

  /* ── e-mail ─────────────────────────────────────────────────────────── */

  async function download() {
    X.say(t('report.f.emlBuilding'));
    const [md, shots] = await Promise.all([X.markdown().catch(() => ''), X.screens().catch(() => [])]);
    const link = location.href;
    // T-012: the title, the line and the steps are typed by the tester or lifted from the page, so they go through
    // the same scan as the export and the chat post. If the scan cannot run nothing is written (a dead door is not "clean").
    const sc = await X.send({ type: 'UQA_SCAN', fields: { title: X.title, line: X.line, ...Object.fromEntries(X.steps.map((s, i) => [`s${i}`, s])) } });
    if (!sc?.ok || !sc.result?.redacted) { X.say(t('report.f.emlScanFailed'), 'err'); return; }
    const r = sc.result.redacted;
    const title = r.title ?? X.title;
    const text = [title, '', r.line ?? X.line, '', t('report.f.emlSteps'), ...X.steps.map((_, i) => `${i + 1}. ${r[`s${i}`] ?? X.steps[i]}`), '', `${t('report.f.emlOpen')}: ${link}`, '', t('report.f.emlAttached'), ''].join('\r\n');
    const attachments = [...(md ? [{ name: 'QA-Wrap-report.md', type: 'text/markdown; charset=utf-8', bytes: new TextEncoder().encode(md) }] : []), ...shots];
    const eml = UQAEml.build({ subject: `${t('report.f.emlSubject')}: ${title}`, text, attachments });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
    a.download = 'QA-Wrap-report.eml';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    X.say(t('report.f.emlDone'), 'ok');
  }

  /* ── status of what was filed ───────────────────────────────────────── */

  const CAT = { new: 'badge-skipped', indeterminate: 'badge-warn', done: 'badge-pass' };
  async function syncChips(host, ctx, force = false) {
    host.replaceChildren();
    const f = await ctx.send({ type: 'UQA_FILED', sessionId: ctx.sessionId });
    const filed = f.ok ? (f.result.filed || []).filter((x) => x.key && x.tracker !== 'github') : [];
    if (!filed.length) return;
    const line = document.createElement('div');
    line.className = 'hrow note ok';
    line.innerHTML = `${icon('check')}<span>${esc(t('report.f.filedAs'))}</span>` + [...new Map(filed.map((x) => [x.key, x])).values()].map((x) => (safeHref(x.url) ? `<a class="chip" href="${esc(safeHref(x.url))}" target="_blank" rel="noopener" data-key="${esc(x.key)}">${ltr(x.key)}</a>` : `<span class="chip" data-key="${esc(x.key)}">${ltr(x.key)}</span>`)).join('') +
      `<button type="button" class="btn btn-quiet btn-sm" data-sync>${esc(t('report.f.checkStatus'))}</button>`;
    host.append(line);
    const run = async (again) => {
      const r = await ctx.send({ type: 'UQA_JIRA_SYNC', sessionId: ctx.sessionId, force: again });
      if (!r.ok) { if (again) ctx.say(r.code === 'VAULT_LOCKED' ? t('report.f.locked') : r.error, 'err'); return; }
      for (const it of r.result.filed || []) {
        const chip = line.querySelector(`[data-key="${CSS.escape(it.key)}"]`);
        if (!chip) continue;
        chip.querySelector('.st')?.remove();
        const st = document.createElement('span');
        st.className = `badge st ${it.gone ? 'badge-fail' : CAT[it.category] || 'badge-skipped'}`;
        st.textContent = it.gone ? t('report.f.gone') : it.status || it.categoryName || '';
        chip.append(st);
      }
      if (again) ctx.say(r.result.summary?.line || '', '');
    };
    line.querySelector('[data-sync]').addEventListener('click', () => run(true));
    if (window.UQAReport.autoSync !== false) run(false);
  }

  /* ── dialog events (one listener) ───────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    const d = dlg();
    if (!d) return;
    d.addEventListener('click', (e) => {
      if (e.target === d) return d.close();
      const b = e.target.closest('[data-d]');
      if (!b || !D) return;
      const act = b.dataset.d;
      if (act === 'close') d.close();
      else if (act === 'allow') allow();
      else if (act === 'allowT') askAccess([D.tr.url]).then((ok) => { D.perm = ok; if (!ok) D.err = { text: t('report.f.notAllowed', { site: D.site }) }; paintTracker(); if (ok) loadTargets(); });
      else if (act === 'allowC') askAccess(D.urls).then((ok) => { D.perm = ok; if (!ok) D.err = { text: t('report.f.notAllowed', { site: t('report.f.chatTitle') }) }; paintChat(); });
      else if (act === 'mode') { D.mode = b.dataset.m; D.err = null; paintJira(); }
      else if (act === 'target') { D.target = D.target === b.dataset.k ? '' : b.dataset.k; D.mode = D.target ? 'existing' : 'new'; paintJira(); }
      else if (act === 'redact') { D.redact = true; paintJira(); }
      else if (act === 'withoutTyped') { D.drop = true; D.err = null; paintJira(); }
      else if (act === 'create') create();
      else if (act === 'createT') createTracker();
      else if (act === 'post') post();
    });
    d.addEventListener('input', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b || D?.kind !== 'jira') return;
      if (b.dataset.d === 'summary') D.summary = b.value;
      if (b.dataset.d === 'typed') { D.typed = b.value; D.target = /^[A-Z][A-Z0-9_]*-\d+$/i.test(b.value.trim()) ? b.value.trim().toUpperCase() : ''; const go = d.querySelector('[data-d="create"]'); if (go) { go.disabled = !D.target; go.textContent = t('report.f.addTo', { key: D.target || '…' }); } }
    });
    d.addEventListener('change', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      if (D?.kind === 'tracker' && b.dataset.d === 'trTarget') { D.target = b.value; return; }
      if (D?.kind !== 'jira') return;
      if (b.dataset.d === 'project') { D.project = b.value; D.types = []; D.mapped = D.mapped; check(); }
      if (b.dataset.d === 'type') D.type = b.value;
      if (b.dataset.d === 'notes') D.notes = b.checked;
      if (b.dataset.d === 'priority') D.priority = b.value;
    });
    d.addEventListener('close', () => { D = null; });
  });

  /** A confirmation in the filing dialog, for the two one-press paths. It replaces confirm(). */
  function ask(text) {
    return new Promise((resolve) => {
      const d = dlg();
      let yes = false;
      D = { kind: 'ask' };
      shell(t('report.f.askTitle'), '', `<p style="white-space:pre-line">${esc(text)}</p>`,
        `<button type="button" class="btn btn-secondary" data-a="no">${esc(t('report.f.cancel'))}</button><button type="button" class="btn btn-primary" data-a="yes">${esc(t('report.f.askYes'))}</button>`);
      d.querySelector('[data-a="yes"]').addEventListener('click', () => { yes = true; d.close(); });
      d.querySelector('[data-a="no"]').addEventListener('click', () => d.close());
      d.addEventListener('close', () => resolve(yes), { once: true });
      show();
    });
  }

  /** The secret warning with its "Hide it" button, as a node, for the paths that have no dialog body. */
  function secretNote(findings, onHide) {
    const w = document.createElement('div');
    w.innerHTML = note('warn', 'warning', `<b>${esc(t(findings.length === 1 ? 'report.f.secretOne' : 'report.f.secretMany', { n: findings.length }))}</b>` +
      findings.map((f) => `<span class="small">${esc(fieldWord(f.field))}: ${esc(kindWord(f.kind))}</span>`).join('') +
      `<span><button type="button" class="btn btn-secondary btn-sm" data-h>${esc(t('report.f.hideIt'))}</button></span>`);
    w.querySelector('[data-h]').addEventListener('click', onHide);
    return w.firstElementChild;
  }

  window.UQAFiling = { safeHref, control, syncChips, download, ask, secretNote, integrations: async (ctx) => { X = ctx; return integrations(); } };
})();
