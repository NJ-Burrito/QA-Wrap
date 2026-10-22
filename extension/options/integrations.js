/* QA Wrap — options page: the Integrations tab (service grid, one screen per service). */
import { TRACKER_SPECS, trackerUrl } from '../core/tracker-specs.js';
import { DEFAULT_PRIORITY_MAP } from '../platform/settings.js';
import { requestServiceAccess } from './service-request.js';

const LOOP = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/; // a local server, with or without the trailing slash
const CHAT = [
  { id: 'slack', provider: 'slack', name: 'Slack', re: /^https:\/\/hooks\.slack\.com\/services\/[\w-]+\/[\w-]+\/[\w-]+$/, ex: 'https://hooks.slack.com/services/…', hint: 'slack' },
  { id: 'teams', provider: 'teams', name: 'Microsoft Teams', re: /^https:\/\/[\w.-]+\.(environment\.api\.powerplatform|webhook\.office|logic\.azure)\.com(:\d+)?\/.+/, ex: 'https://<env>.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/…', hint: 'teams' },
  { id: 'mattermost', provider: 'mattermost', name: 'Mattermost', re: /^https?:\/\/[^/\s]+\/hooks\/[\w-]+\/?$/, ex: 'https://<server>/hooks/…', hint: 'mattermost', extras: ['channel', 'username'] },
  { id: 'discord', provider: 'discord', name: 'Discord', re: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/, ex: 'https://discord.com/api/webhooks/…', hint: 'discord' },
  { id: 'google', provider: 'google', name: 'Google Chat', re: /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/.+/, ex: 'https://chat.googleapis.com/v1/spaces/…/messages?key=…', hint: 'google' },
  { id: 'telegram', provider: 'telegram', name: 'Telegram', tg: true, hint: 'telegram' },
  { id: 'custom', provider: 'custom', name: 'Custom webhook', re: /^https:\/\/\S+$/, ex: 'https://example.com/hook', hint: 'custom', custom: true },
];
const TRACK_IDS = ['github', 'gitlab', 'azure', 'linear', 'trello', 'clickup', 'asana', 'shortcut', 'youtrack'];
const SEV = ['critical', 'major', 'moderate', 'minor'];
const EVENTS = ['done', 'fail', 'report'];
const CHAT_SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const MAIL_SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const LOCK_SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const icon = (n, s) => (window.UQAIcon ? window.UQAIcon(n, { size: s || 20 }) : '');
const { esc } = window.UQADom; // ui/dom.js: the full five-character HTML escape
const last4 = (v) => String(v || '').slice(-4);
const newId = () => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

/** Shape checks, exported for the unit test. Returns '' when fine, else the reason key. */
export function checkChatUrl(svc, url) {
  if (LOOP.test(url)) return '';
  return svc.re && svc.re.test(url) ? '' : 'shape';
}
export const originOf = (url) => (String(url).match(/^https?:\/\/[^/\s]+/) || [''])[0];

export function wireIntegrations({ $, t, send, save, getSettings, repaintAll }) {
  const S = () => getSettings();
  let view = null; // service id whose screen is open
  let mode = null; // null | 'add' | { replace: destination id }
  let err = '';
  let tests = {}; // channel id -> html
  const grid = $('svc-grid'), screen = $('svc-screen'), home = $('svc-home'), holder = $('svc-holder');
  const jiraFields = $('jira-fields'), jiraTypes = $('jira-types');

  /* ── data ─────────────────────────────────────────────────────────── */
  const chatOf = (svc) => {
    const list = (S().webhooks || []).filter((d) => (d.provider || 'custom') === svc.provider);
    const legacy = S().slack?.webhookUrl;
    if (svc.id === 'slack' && legacy && !list.some((d) => d.url === legacy)) list.unshift({ id: '__legacy', label: 'Slack', provider: 'slack', url: legacy, legacy: true });
    return list;
  };
  const trackerSpec = (id) => TRACKER_SPECS.find((s) => s.id === id);
  const trackerCfg = (id) => S().trackers?.[id] || {};
  const jiraOn = () => !!(S().jira?.baseUrl && S().jira?.token);
  const trackerOn = (id) => { const sp = trackerSpec(id); const c = trackerCfg(id); return sp.needs.filter((n) => n.secret || n.key === 'token' || n.key === 'key').every((n) => String(c[n.key] || '').trim()) && sp.needs.some((n) => String(c[n.key] || '').trim()); };
  const status = (id) => {
    if (id === 'email') return { on: true, text: t('options.svc.ready') };
    if (id === 'jira') return jiraOn() ? { on: true, text: t('options.svc.connected') } : { on: false, text: t('options.svc.notSet') };
    const chat = CHAT.find((c) => c.id === id);
    if (chat) { const n = chatOf(chat).length; return n ? { on: true, text: n > 1 ? t('options.svc.connectedN', { n }) : t('options.svc.connected') } : { on: false, text: t('options.svc.notSet') }; }
    return trackerOn(id) ? { on: true, text: t('options.svc.connected') } : { on: false, text: t('options.svc.notSet') };
  };
  const nameOf = (id) => (id === 'jira' ? 'Jira' : id === 'email' ? t('options.svc.email') : (CHAT.find((c) => c.id === id) || trackerSpec(id) || {}).name || (trackerSpec(id) || {}).label || id);
  const anyOn = () => ['jira', ...TRACK_IDS, ...CHAT.map((c) => c.id)].some((id) => status(id).on);

  /* ── grid ─────────────────────────────────────────────────────────── */
  function card(id, ic, kw) {
    const s = status(id);
    return `<button type="button" class="svc" data-svc="${id}" data-kw="${esc(`${nameOf(id)} ${kw || ''}`)}"><span class="svc-ic">${ic}</span><span class="svc-name">${esc(nameOf(id))}</span><span class="svc-st ${s.on ? 'on' : ''}">${esc(s.text)}</span></button>`;
  }
  function paintGrid() {
    const group = (title, items) => `<h3 class="svc-group">${esc(t(title))}</h3><div class="svc-row">${items}</div>`;
    grid.innerHTML =
      group('options.svc.gTrackers', card('jira', icon('tag-bug'), 'ticket issue') + TRACK_IDS.map((id) => card(id, icon('tag-issue'), 'ticket issue token')).join('')) +
      group('options.svc.gChat', CHAT.map((c) => card(c.id, CHAT_SVG, 'chat webhook channel')).join('')) +
      group('options.svc.gNoAccount', card('email', MAIL_SVG, 'eml mail message'));
    $('filing-row').hidden = !anyOn();
    grid.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = () => open(b.dataset.svc)));
    document.dispatchEvent(new Event('uqa-grid'));
  }
  const viz = () => `<div class="viz" data-loop>
    <div class="viz-card"><h3>${esc(t('options.svc.vizVault'))}</h3><div class="flow">
      <div class="node no"><b>${esc(t('options.svc.vizSites'))}</b><span>${esc(t('options.svc.vizSitesNote'))}</span></div><i class="link x"></i>
      <div class="node solid">${LOCK_SVG}<b>${esc(t('options.svc.vizVaultName'))}</b><span>${esc(t('options.svc.vizVaultNote'))}</span></div><i class="link x"></i>
      <div class="node no"><b>${esc(t('options.svc.vizSync'))}</b><span>${esc(t('options.svc.vizSyncNote'))}</span></div></div></div>
    <div class="viz-card"><h3>${esc(t('options.svc.vizLeaves'))}</h3><div class="flow">
      <div class="node"><b>${esc(t('options.svc.vizSession'))}</b><span>${esc(t('options.svc.vizSessionNote'))}</span></div><i class="link on"></i>
      <div class="node solid"><b>${esc(t('options.svc.vizRedact'))}</b><span>${esc(t('options.svc.vizRedactNote'))}</span></div><i class="link on"></i>
      <div class="node solid"><b>${esc(t('options.svc.vizService'))}</b><span>${esc(t('options.svc.vizServiceNote'))}</span></div></div>
      <p class="muted">${esc(t('options.svc.vizNone'))}</p></div></div>`;

  /* ── a service screen ─────────────────────────────────────────────── */
  const steps = (kind, hintKey) => {
    const s = kind === 'chat'
      ? [[t('options.svc.s1Chat'), hintKey ? t(`options.svc.hint.${hintKey}`) : ''], [t('options.svc.s2Chat'), t('options.svc.s2ChatNote')], [t('options.svc.s3'), t('options.svc.s3Chat')]]
      : [[t('options.svc.s1Token'), t('options.svc.s1TokenNote')], [t('options.svc.s2Token'), t('options.svc.s2TokenNote')], [t('options.svc.s3'), t('options.svc.s3Token')]];
    return `<ol class="steps3" data-loop aria-label="${esc(t('options.svc.threeSteps'))}">${s.map((x, i) => `<li><span class="num">${i + 1}</span><b>${esc(x[0])}</b><span>${esc(x[1])}</span></li>`).join('')}</ol>`;
  };
  const head = (id, on) => `<div class="svc-head"><button type="button" class="btn btn-sm btn-ghost" data-act="back">${icon('back', 16)}<span>${esc(t('options.svc.all'))}</span></button>
    <h3 tabindex="-1" id="svc-title">${esc(nameOf(id))}</h3><span class="badge ${on ? 'on' : ''}">${esc(on ? t('options.svc.connected') : t('options.svc.notSet'))}</span></div>`;
  const askNote = (host) => `<p class="ask muted">${esc(t('options.svc.askPre'))} <bdi class="code">${esc(host || t('options.svc.thisAddress'))}</bdi>${esc(t('options.svc.askPost'))}</p>`;
  const sample = (name, ev) => `<div class="preview" aria-label="${esc(t('options.svc.whatSent'))}"><b>${esc(t('options.svc.previewIn'))} <bdi>${esc(name)}</bdi></b><p>${esc(t('options.svc.sampleTitle'))}</p><p class="muted">${esc(t('options.svc.sampleBody'))}</p></div>`;
  const testRows = (rows) => `<ul class="tests">${rows.map((r) => `<li class="${r[0]}"><span class="ic">${icon(r[0] === 'ok' ? 'pass' : 'warning', 16)}</span><span>${esc(r[1])}</span></li>`).join('')}</ul>`;
  const sentBlock = () => `<div class="sent"><div><b>${esc(t('options.svc.sent'))}</b><ul><li>${esc(t('options.svc.sent1'))}</li><li>${esc(t('options.svc.sent2'))}</li><li>${esc(t('options.svc.sent3'))}</li></ul></div>
    <div><b>${esc(t('options.svc.never'))}</b><ul><li>${esc(t('options.svc.never1'))}</li><li>${esc(t('options.svc.never2'))}</li><li>${esc(t('options.svc.never3'))}</li></ul></div></div>`;

  function evChips(sel = { done: true, fail: true, report: true }, attr = '') {
    return `<div class="chips" role="group" aria-label="${esc(t('options.svc.postWhen'))}">${EVENTS.map((e) => `<button type="button" class="chip" data-ev="${e}" ${attr} aria-pressed="${!!sel[e]}">${esc(t(`options.svc.ev.${e}`))}</button>`).join('')}</div>`;
  }
  const evText = (ev) => (EVENTS.filter((e) => !ev || ev[e]).map((e) => t(`options.svc.ev.${e}`)).join(t('options.svc.sep')) || t('options.svc.none'));

  function chatScreen(svc) {
    const list = chatOf(svc);
    const editing = mode && mode.replace ? list.find((d) => d.id === mode.replace) : null;
    const showForm = !list.length || mode === 'add' || editing;
    let html = head(svc.id, list.length > 0) + steps('chat', svc.hint);
    if (list.length) {
      html += `<h4 class="sub">${esc(t('options.svc.channels'))}</h4><ul class="chans">${list.map((d, i) => `<li class="chan" data-id="${esc(d.id)}">
        <div class="chan-main"><b><bdi>${esc(d.label || svc.name)}</bdi></b><span class="saved">${esc(t('options.svc.savedLast', { last: last4(d.token || d.url) }))}</span></div>
        <div class="chan-ev muted">${esc(t('options.svc.postsOn'))} ${esc(evText(d.events))}</div>
        ${d.legacy ? '' : evChips(d.events || { done: true, fail: true, report: true }, `data-chan="${esc(d.id)}"`)}
        <div class="acts"><button type="button" class="btn btn-sm${!showForm && i === 0 ? ' btn-primary" data-primary="' : ''}" data-act="test" data-id="${esc(d.id)}">${esc(t('options.svc.test'))}</button>
        <button type="button" class="btn btn-sm btn-quiet" data-act="replace" data-id="${esc(d.id)}">${esc(t('options.svc.replace'))}</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="forget" data-id="${esc(d.id)}">${esc(t('options.svc.forget'))}</button></div>
        <div class="test-out" id="test-${esc(d.id)}" role="status" aria-live="polite">${tests[d.id] || ''}</div></li>`).join('')}</ul>`;
      if (!showForm) html += `<button type="button" class="btn" data-act="add">${esc(t('options.svc.addChannel'))}</button>`;
    }
    if (showForm) {
      const f = editing || {};
      html += `<form class="svc-form" novalidate><h4 class="sub">${esc(editing ? t('options.svc.replace') : list.length ? t('options.svc.addChannel') : t('options.svc.connect'))}</h4>
        <label class="text-field"><span>${esc(t('options.svc.chanName'))}</span><input type="text" id="f-name" value="${esc(editing ? f.label : '')}" placeholder="${esc(t('options.svc.chanPh'))}" autocomplete="off" /><em>${esc(t('options.svc.chanNote'))}</em></label>
        ${svc.tg ? `<label class="text-field"><span>${esc(t('options.svc.botToken'))}</span><input type="password" id="f-token" autocomplete="off" placeholder="123456:ABC…" /></label>
          <label class="text-field"><span>${esc(t('options.svc.chatId'))}</span><input type="text" id="f-chatId" value="${esc(editing ? f.chatId : '')}" autocomplete="off" /></label>`
        : `<label class="text-field"><span>${esc(t('options.svc.addr'))}</span><input type="password" id="f-url" autocomplete="off" placeholder="${esc(svc.ex)}" /><em>${esc(t('options.svc.writeOnce'))}</em></label>`}
        ${(svc.extras || []).map((k) => `<label class="text-field"><span>${esc(t(`options.svc.x.${k}`))}</span><input type="text" id="f-${k}" value="${esc(editing ? f[k] : '')}" autocomplete="off" /></label>`).join('')}
        ${svc.id === 'slack' ? `<label class="text-field"><span>${esc(t('options.slack.mentionLabel'))}</span><input type="text" id="f-mention" value="${esc(editing ? f.mention : '')}" placeholder="&lt;!here&gt;" autocomplete="off" /></label>` : ''}
        ${svc.custom ? `<label class="text-field"><span>${esc(t('options.svc.template'))}</span><textarea id="f-template" rows="3" placeholder='{"text": "{{title}}"}'>${esc(editing ? f.template : '')}</textarea></label>` : ''}
        <div class="text-field"><span>${esc(t('options.svc.postWhen'))}</span>${evChips(editing?.events)}</div>
        <label class="text-field"><span>${esc(t('options.svc.floor'))}</span><select id="f-floor">${['all', 'minor', 'moderate', 'major', 'critical'].map((v) => `<option value="${v}" ${(f.minSeverity || 'all') === v ? 'selected' : ''}>${esc(t(`options.dest.floor${v[0].toUpperCase()}${v.slice(1)}`))}</option>`).join('')}</select></label>
        ${askNote(svc.tg ? 'api.telegram.org' : '')}
        <p class="err" id="f-err" role="alert">${esc(err)}</p>
        <div class="acts"><button type="submit" class="btn btn-primary" data-primary data-act="save">${esc(t('options.svc.save'))}</button>
        ${list.length ? `<button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('options.svc.cancel'))}</button>` : ''}</div></form>`;
    }
    return html + (list.length ? sample(nameOf(svc.id)) : '');
  }

  function trackerScreen(id) {
    const sp = trackerSpec(id), cfg = trackerCfg(id), on = trackerOn(id);
    const editing = mode && mode.replace;
    let html = head(id, on) + steps('track');
    if (on && !editing) {
      const secret = sp.needs.find((n) => n.secret);
      html += `<div class="conn"><span class="saved">${esc(t('options.svc.savedLast', { last: last4(cfg[secret?.key || 'token']) }))}</span>
        <span class="muted">${esc(t('options.svc.encNote'))}</span>
        <div class="acts"><button type="button" class="btn btn-sm btn-primary" data-primary data-act="test" data-id="${id}">${esc(t('options.svc.test'))}</button>
        <button type="button" class="btn btn-sm btn-quiet" data-act="replace" data-id="${id}">${esc(t('options.svc.replace'))}</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="forget" data-id="${id}">${esc(t('options.svc.forget'))}</button></div>
        <div class="test-out" id="test-${id}" role="status" aria-live="polite">${tests[id] || ''}</div></div>` + sentBlock();
    } else {
      html += `<form class="svc-form" novalidate>${sp.needs.map((n) => `<label class="text-field"><span>${esc(n.label)}</span>
        <input type="${n.secret ? 'password' : 'text'}" id="f-${n.key}" autocomplete="off" value="${n.secret ? '' : esc(cfg[n.key] || '')}" placeholder="${n.secret ? esc(on ? t('options.svc.keepSaved', { last: last4(cfg[n.key]) }) : '') : esc(n.hint || '')}" />${n.secret && n.hint ? `<em>${esc(n.hint)}</em>` : ''}</label>`).join('')}
        ${askNote(originOf(trackerUrl(id, cfg)).replace(/^https?:\/\//, ''))}
        <p class="err" id="f-err" role="alert">${esc(err)}</p>
        <div class="acts"><button type="submit" class="btn btn-primary" data-primary data-act="save">${esc(t('options.svc.save'))}</button>
        ${on ? `<button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('options.svc.cancel'))}</button>` : ''}</div></form>`;
    }
    return html;
  }

  function jiraScreen() {
    const on = jiraOn();
    const map = { ...DEFAULT_PRIORITY_MAP, ...(S().jira?.priorityMap || {}) };
    return head('jira', on) + steps('track') + `<div id="jira-slot"></div>
      ${on ? `<p class="conn"><span class="saved">${esc(t('options.svc.savedLast', { last: last4(S().jira.token) }))}</span> <span class="muted">${esc(t('options.svc.encNote'))}</span></p>` : ''}
      <div class="acts"><button type="button" class="btn btn-primary" data-primary data-act="jira-save">${esc(t('options.svc.saveAllow'))}</button>
      <button type="button" class="btn" data-act="test" data-id="jira">${esc(t('options.svc.test'))}</button>
      <button type="button" class="btn btn-sm btn-danger" data-act="forget" data-id="jira">${esc(t('options.svc.forget'))}</button></div>
      ${askNote(originOf(S().jira?.baseUrl || '').replace(/^https?:\/\//, ''))}
      <div class="test-out" id="test-jira" role="status" aria-live="polite">${tests.jira || ''}</div>
      <h4 class="sub">${esc(t('options.svc.prioTitle'))}</h4><p class="muted">${esc(t('options.svc.prioNote'))}</p>
      <div class="prio">${SEV.map((s) => `<label class="text-field"><span>${esc(t(`options.dest.floor${s[0].toUpperCase()}${s.slice(1)}`))}</span><input type="text" data-prio="${s}" value="${esc(map[s])}" autocomplete="off" /></label>`).join('')}</div>
      <div id="jira-types-slot"></div>` + sentBlock();
  }

  function emailScreen() {
    return head('email', true) + `<p class="muted">${esc(t('options.svc.emailNote'))}</p>
      <ol class="steps3"><li><span class="num">1</span><b>${esc(t('options.svc.e1'))}</b><span>${esc(t('options.svc.e1n'))}</span></li><li><span class="num">2</span><b>${esc(t('options.svc.e2'))}</b><span>${esc(t('options.svc.e2n'))}</span></li><li><span class="num">3</span><b>${esc(t('options.svc.e3'))}</b><span>${esc(t('options.svc.e3n'))}</span></li></ol>
      <div class="acts"><button type="button" class="btn btn-primary" data-primary data-act="eml">${esc(t('options.svc.openMail'))}</button></div>
      <p class="muted">${esc(t('options.svc.emailNone'))}</p>`;
  }

  /* ── render ───────────────────────────────────────────────────────── */
  let repainting = false;
  // completion review 2: a save/forget repaints 350 ms later from the masked copy. If the tester has moved on in that time
  // (Back, another service, Add, Cancel) the stale render() rebuilt the new, half-filled form empty. `nav` counts those moves.
  let nav = 0;
  const settled = (fn) => { const at = nav; return () => { if (at === nav) fn(); }; };
  function render() {
    holder.append(jiraFields, jiraTypes); // keep the Jira inputs alive across a repaint
    if (!view) { screen.hidden = true; home.hidden = false; paintGrid(); $('svc-viz').innerHTML = viz(); return; }
    home.hidden = true; screen.hidden = false;
    const chat = CHAT.find((c) => c.id === view);
    screen.innerHTML = `<div class="svc-screen">${view === 'jira' ? jiraScreen() : view === 'email' ? emailScreen() : chat ? chatScreen(chat) : trackerScreen(view)}</div>`;
    if (view === 'jira') {
      $('jira-slot').append(jiraFields); $('jira-types-slot').append(jiraTypes);
      // paintAll() ends by calling repaint() -> render() again: without this guard opening Jira recursed until the stack ran out.
      if (!repainting) { repainting = true; try { repaintAll(); } finally { repainting = false; } }
    }
    const form = screen.querySelector('.svc-form');
    if (form) form.onsubmit = (e) => { e.preventDefault(); act('save'); };
    screen.querySelectorAll('[data-act]').forEach((b) => { if (b.type !== 'submit') b.onclick = () => act(b.dataset.act, b.dataset.id); });
    screen.querySelectorAll('.chip').forEach((c) => (c.onclick = () => chip(c)));
    screen.querySelectorAll('[data-prio]').forEach((i) => (i.oninput = () => save({ jira: { priorityMap: Object.fromEntries(SEV.map((s) => [s, (screen.querySelector(`[data-prio="${s}"]`).value || '').trim() || DEFAULT_PRIORITY_MAP[s]])) } })));
  }
  function open(id) { nav++; view = id; mode = null; err = ''; tests = {}; try { history.replaceState(null, '', `#sec-integrations/${id}`); } catch { /* not fatal */ } render(); $('svc-title')?.focus(); }
  function chip(c) {
    const on = c.getAttribute('aria-pressed') !== 'true';
    c.setAttribute('aria-pressed', String(on));
    if (!c.dataset.chan) return; // form chip: read at Save
    const list = (S().webhooks || []).map((d) => (d.id === c.dataset.chan ? { ...d, events: { ...(d.events || { done: true, fail: true, report: true }), [c.dataset.ev]: on } } : d));
    save({ webhooks: list }, { immediate: true });
    const li = c.closest('.chan'); const d = list.find((x) => x.id === c.dataset.chan);
    li.querySelector('.chan-ev').textContent = `${t('options.svc.postsOn')} ${evText(d.events)}`;
  }
  const val = (id) => (screen.querySelector(`#${id}`)?.value || '').trim();
  const fail = (m) => { err = m; const e = $('f-err'); if (e) e.textContent = m; return false; };
  const grant = async (url) => { const r = await requestServiceAccess(url); return r.ok ? true : fail(r.error); };

  async function act(name, id) {
    const chat = CHAT.find((c) => c.id === view);
    if (name === 'back') { nav++; view = null; mode = null; err = ''; try { history.replaceState(null, '', '#sec-integrations'); } catch { /* ok */ } render(); grid.querySelector('.svc')?.focus(); return; }
    if (name === 'add') { nav++; mode = 'add'; err = ''; render(); $('f-name')?.focus(); return; }
    if (name === 'cancel') { nav++; mode = null; err = ''; render(); return; }
    if (name === 'replace') { nav++; mode = { replace: id }; err = ''; render(); (screen.querySelector('#f-url,#f-token')||{}).focus?.(); return; }
    if (name === 'eml') return eml();
    if (name === 'jira-save') {
      const url = $('jira-baseUrl').value.trim();
      if (!/^https:\/\/\S+$/.test(url) && !LOOP.test(url)) { $('jira-state').textContent = t('options.svc.badShape', { what: t('options.svc.addrWord'), ex: 'https://yourteam.atlassian.net' }); return; }
      if (!(await grant(url))) { $('jira-state').textContent = err; return; }
      $('jira-state').textContent = t('options.svc.allowedSaved', { host: originOf(url) });
      return;
    }
    if (name === 'save') return chat ? saveChat(chat) : saveTracker(view);
    if (name === 'test') return runTest(id);
    if (name === 'forget') return forget(id);
  }

  async function saveChat(svc) {
    const editing = mode && mode.replace ? chatOf(svc).find((d) => d.id === mode.replace) : null;
    const name = val('f-name');
    const events = Object.fromEntries(EVENTS.map((e) => [e, screen.querySelector(`.svc-form [data-ev="${e}"]`).getAttribute('aria-pressed') === 'true']));
    if (!name) return fail(t('options.svc.needName'));
    const d = { id: editing && !editing.legacy ? editing.id : newId(), label: name, provider: svc.provider, minSeverity: val('f-floor') || 'all', enabled: true, events };
    if (svc.tg) {
      const token = val('f-token') || (editing ? editing.token : '');
      if (!token || (!val('f-token') ? false : !/^\d+:[\w-]{20,}$/.test(token))) return fail(t('options.svc.badShape', { what: t('options.svc.tokenWord'), ex: '123456:ABC…' }));
      if (!val('f-chatId')) return fail(t('options.svc.needChat'));
      Object.assign(d, { token, chatId: val('f-chatId'), url: '' });
    } else {
      const url = val('f-url') || (editing ? editing.url : '');
      if (!url || checkChatUrl(svc, url)) return fail(t('options.svc.badShape', { what: t('options.svc.addrWord'), ex: svc.ex }));
      d.url = url;
      if (svc.custom) d.template = val('f-template');
      if (svc.id === 'slack') d.mention = val('f-mention');
      for (const k of svc.extras || []) d[k] = val(`f-${k}`);
    }
    if (!(await grant(svc.tg ? 'https://api.telegram.org/' : d.url))) return;
    const rest = (S().webhooks || []).filter((x) => x.id !== d.id);
    const jobs = { webhooks: [...rest, d] };
    if (editing?.legacy) jobs.slack = { webhookUrl: '' };
    save(jobs, { immediate: true });
    mode = null; err = ''; tests = {};
    const again = settled(() => { render(); $('svc-title')?.focus(); });
    await new Promise((r) => setTimeout(r, 350)); // the save answers with the masked copy; repaint from it
    again();
  }

  async function saveTracker(id) {
    const sp = trackerSpec(id), cfg = { ...trackerCfg(id) };
    for (const n of sp.needs) {
      const v = val(`f-${n.key}`);
      if (v) cfg[n.key] = v;
      else if (!n.secret) cfg[n.key] = '';
      const cur = String(cfg[n.key] || '');
      if (!cur && !/optional|leave empty/i.test(n.hint || '')) return fail(t('options.svc.needField', { field: n.label }));
      if (!cur) continue;
      if (n.secret && !cur.includes('••••') && cur.length < 8) return fail(t('options.svc.short'));
      if (n.key === 'host' && !/^https:\/\/\S+$/.test(cur) && !LOOP.test(cur)) return fail(t('options.svc.badShape', { what: t('options.svc.addrWord'), ex: 'https://gitlab.com' }));
      if (id === 'github' && n.key === 'repo' && !/^[\w.-]+\/[\w.-]+$/.test(cur)) return fail(t('options.svc.badShape', { what: n.label, ex: 'owner/name' }));
    }
    if (!(await grant(trackerUrl(id, cfg)))) return;
    save({ trackers: { [id]: cfg } }, { immediate: true });
    mode = null; err = ''; tests = {};
    const again = settled(() => { render(); $('svc-title')?.focus(); });
    await new Promise((r) => setTimeout(r, 350));
    again();
  }

  // F1: the worker answers in English; its tracker and Jira sentences are keyed in platform/worker-errors.js, loaded only on a failure.
  const say = (res) => import('../platform/worker-errors.js').then((m) => m.localizeError(res, t, window.QAWi18n?.lang?.() || 'en'), () => res.error);
  async function runTest(id) {
    // looked up again at the end: a repaint while the request was out replaced the element
    const put = (rows, extra = '') => { tests[id] = testRows(rows) + extra; const o = $(`test-${id}`); if (o) o.innerHTML = tests[id]; };
    const out = $(`test-${id}`);
    tests[id] = `<p class="muted">${esc(t('options.svc.checking'))}</p>`;
    if (out) out.innerHTML = tests[id];
    const chat = CHAT.find((c) => c.id === view);
    if (chat) {
      const d = chatOf(chat).find((x) => x.id === id);
      const asked = await requestServiceAccess(chat.tg ? 'https://api.telegram.org/' : d.url);
      if (!asked.ok) return put([['warn', asked.error]]);
      const res = await send({ type: 'UQA_NOTIFY_TEST', destination: d });
      return put(res.ok ? [['ok', t('options.svc.chromeOk')], ['ok', t('options.svc.posted', { name: d.label || chat.name })]] : [['ok', t('options.svc.chromeOk')], ['warn', await say(res)]], res.ok ? sample(d.label || chat.name) : '');
    }
    const url = id === 'jira' ? S().jira?.baseUrl : trackerUrl(id, trackerCfg(id));
    const asked = await requestServiceAccess(url);
    if (!asked.ok) return put([['warn', asked.error]]);
    const res = id === 'jira' ? await send({ type: 'UQA_JIRA_TEST' }) : await send({ type: 'UQA_TRACKER_TEST', tracker: id, config: trackerCfg(id) });
    const who = res.ok ? (res.result?.account || res.result || {}) : {};
    const nm = who.name || who.displayName || who.emailAddress || who.id || t('options.trackers.you');
    put(res.ok ? [['ok', t('options.svc.chromeOk')], ['ok', t('options.trackers.signedIn', { who: nm })]] : [['ok', t('options.svc.chromeOk')], ['warn', await say(res)]]);
  }

  function forget(id) {
    const chat = CHAT.find((c) => c.id === view);
    if (id === 'jira') { save({ jira: { baseUrl: '', email: '', token: '', project: '' } }, { immediate: true }); setTimeout(settled(() => { repaintAll(); render(); }), 350); return; }
    if (chat) {
      if (id === '__legacy') save({ slack: { webhookUrl: '' } }, { immediate: true });
      else save({ webhooks: (S().webhooks || []).filter((d) => d.id !== id) }, { immediate: true });
    } else {
      const sp = trackerSpec(id);
      save({ trackers: { [id]: Object.fromEntries(sp.needs.map((n) => [n.key, ''])) } }, { immediate: true });
    }
    mode = null; tests = {};
    setTimeout(settled(render), 350);
  }

  function eml() {
    const body = [`Subject: ${t('options.svc.sampleTitle')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'X-Unsent: 1', '', t('options.svc.sampleBody'), ''].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'message/rfc822' }));
    a.download = 'QA-Wrap-report.eml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return {
    /** Settings or words changed: repaint unless someone is typing in a form here. */
    repaint() {
      if (view && screen.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
      // T-074: focus on a chip or button is not typing, yet an open form is half-filled. render() rebuilds it from settings,
      // so carry the fields, the event chips and the focus across the rebuild (a language change still relabels it).
      const form = view && screen.querySelector('.svc-form');
      const fields = form ? [...form.querySelectorAll('input,select,textarea')].map((e) => [e.id, e.value]) : [];
      const chips = form ? [...form.querySelectorAll('[data-ev]')].map((b) => [b.dataset.ev, b.getAttribute('aria-pressed')]) : [];
      const at = form && form.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = at ? (at.id ? `#${at.id}` : at.dataset.ev ? `[data-ev="${at.dataset.ev}"]` : at.dataset.act ? `[data-act="${at.dataset.act}"]` : '') : '';
      render();
      const now = form && screen.querySelector('.svc-form');
      if (!now) return;
      for (const [id, v] of fields) { const e = id && now.querySelector(`#${id}`); if (e) e.value = v; }
      for (const [ev, on] of chips) now.querySelector(`[data-ev="${ev}"]`)?.setAttribute('aria-pressed', on);
      if (focusKey) now.querySelector(focusKey)?.focus();
    },
    openService: open,
    view: () => view,
  };
}
