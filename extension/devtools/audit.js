/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The accessibility audit block, and the cookie / storage editor.
 *
 * Both are tab-scoped rather than session-scoped, which is why they live apart
 * from panel.js: the rest of the panel renders whatever session you selected in
 * the dropdown, while these two always act on the page you are inspecting right
 * now. Mixing the two models in one file is how you end up editing cookies on a
 * tab you closed an hour ago.
 */

/* One scope of its own. panel.js is a plain script on the same global, and a
   second top-level `const $` there throws SyntaxError before a line of this
   file runs — silently, unless something is watching the console. */
(() => {
const $ = (id) => document.getElementById(id);
/** A count and its noun, agreeing. Inside the wall, like every helper here. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const t = (k, v) => QAWi18n.t(k, v);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: t('common.workerUnresponsive') });
    });
  });
}

const { el } = window.UQADom; // ui/dom.js: a node with a class and plain text

/**
 * The tab under inspection.
 *
 * Inside DevTools that is `inspectedWindow.tabId` and nothing else will do —
 * "the active tab" is the DevTools window itself. Outside DevTools (the panel
 * opened as a plain page, which is how the test suite drives it) fall back to
 * the active tab so the block still works rather than sitting dead.
 */
const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? null;
const target = () => (inspectedTabId != null ? { tabId: inspectedTabId } : {});

function state(id, text, kind = '') {
  const n = $(id);
  if (!n) return;
  n.textContent = text;
  n.className = `muted ${kind}`.trim();
}

/* ═══════════════════════════════════════════════ accessibility audit ══════ */

let allRules = [];
const selected = new Set();

function renderRules() {
  const host = $('rules');
  const term = $('rule-search').value.trim().toLowerCase();
  const tag = $('rule-tag').value;

  const shown = allRules.filter(
    (r) =>
      (!tag || r.tags.includes(tag)) &&
      (!term || r.id.includes(term) || r.help.toLowerCase().includes(term) || r.description.toLowerCase().includes(term))
  );

  host.replaceChildren();
  if (!allRules.length) {
    host.append(el('p', 'muted', t('panel.audit.loadToChoose')));
    return;
  }
  if (!shown.length) {
    host.append(el('p', 'muted', t('panel.audit.noRuleMatches', { term: term || tag })));
    return;
  }

  // One fragment, one insertion: the full catalogue is ~100 rules and rebuilding
  // on every keystroke of the filter is exactly the kind of thing that makes a
  // panel feel heavy.
  const frag = document.createDocumentFragment();
  for (const rule of shown) {
    const row = el('label', 'rule-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.has(rule.id);
    box.addEventListener('change', () => {
      box.checked ? selected.add(rule.id) : selected.delete(rule.id);
      $('rule-run').disabled = selected.size === 0;
      state(
        'rule-state',
        selected.size
          ? t(selected.size === 1 ? 'panel.audit.ruleSelectedOne' : 'panel.audit.ruleSelectedMany', { n: selected.size })
          : t('panel.audit.rulesLoadedCount', { n: allRules.length })
      );
    });

    const mid = el('div', 'rule-mid');
    // rule.help, rule.id and the wcag/category tag below all come from
    // axe-core's own catalogue (via UQA_A11Y_RULES): axe rule ids and WCAG
    // references are data, not this pass's copy to translate.
    mid.append(el('strong', null, rule.help));
    mid.append(el('span', 'rule-id', rule.id));

    const level = rule.tags.find((tag) => tag.startsWith('wcag2')) || (rule.tags.includes('best-practice') ? 'best-practice' : '');
    const badge = el('span', `rule-tag${level === 'best-practice' ? ' rule-tag-bp' : ''}`, level || t('panel.audit.tagOther'));

    const help = document.createElement('a');
    help.href = rule.helpUrl;
    help.target = '_blank';
    help.rel = 'noopener';
    help.className = 'rule-help';
    help.textContent = t('panel.audit.howToFix');
    help.addEventListener('click', (e) => e.stopPropagation());

    row.append(box, mid, badge, help);
    frag.append(row);
  }
  host.append(frag);
}

async function loadRules() {
  state('rule-state', t('panel.audit.loadingCatalogue'));
  const res = await send({ type: 'UQA_A11Y_RULES', ...target() });
  if (!res.ok) return state('rule-state', res.error, 'err');
  allRules = res.result.rules.sort((a, b) => a.help.localeCompare(b.help));
  state('rule-state', t('panel.audit.rulesLoadedFrom', { n: allRules.length, version: res.result.version }));
  renderRules();
}

async function runScan(ruleIds) {
  state(
    'rule-state',
    ruleIds
      ? t(ruleIds.length === 1 ? 'panel.audit.runningOne' : 'panel.audit.runningMany', { n: ruleIds.length })
      : t('panel.audit.runningAll')
  );
  const res = await send({ type: 'UQA_SCAN_A11Y', ...target(), ruleIds });
  if (!res.ok) return state('rule-state', res.error, 'err');
  const { total, violations } = res.result;
  let key = 'panel.audit.resultNone';
  if (total) {
    const totalOne = total === 1;
    const rulesOne = violations.length === 1;
    key = totalOne
      ? (rulesOne ? 'panel.audit.resultOneOne' : 'panel.audit.resultOneMany')
      : (rulesOne ? 'panel.audit.resultManyOne' : 'panel.audit.resultManyMany');
  }
  state('rule-state', t(key, { total, rules: violations.length }), total ? 'err' : 'ok');
}

/* ── the checks axe cannot make ─────────────────────────────────────────── */

async function renderGuided() {
  const res = await send({ type: 'UQA_A11Y_GUIDED' });
  if (!res.ok) return;
  const host = $('guided');
  host.replaceChildren();

  // check.wcag / check.title / check.how are handed back by the background
  // worker's UQA_A11Y_GUIDED (background/service-worker.js, not owned this
  // round); left as delivered.
  for (const check of res.result) {
    const row = el('div', 'guided-row');

    const head = el('div', 'guided-title');
    head.append(el('span', 'guided-wcag', check.wcag));
    head.append(el('strong', null, check.title));
    row.append(head);
    row.append(el('p', 'muted guided-how', check.how));

    const actions = el('div', 'guided-actions');
    const note = document.createElement('input');
    note.type = 'text';
    note.placeholder = t('panel.audit.guidedNotePlaceholder');
    note.className = 'guided-note';

    const VERDICT_LABEL = { pass: 'panel.audit.verdictPass', fail: 'panel.audit.verdictFail', unsure: 'panel.audit.verdictUnsure' };
    const VERDICT_SAID = { pass: 'panel.audit.saidPassed', fail: 'panel.audit.saidFailed', unsure: 'panel.audit.saidFlagged' };
    for (const verdict of ['pass', 'fail', 'unsure']) {
      const btn = el('button', `btn btn-sm verdict-${verdict}`, t(VERDICT_LABEL[verdict]));
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const res2 = await send({
          type: 'UQA_A11Y_GUIDED_RESULT',
          id: check.id,
          verdict,
          comment: note.value.trim(),
        });
        if (!res2.ok) {
          // The usual cause is no session running, and saying so beats a
          // generic failure the tester has to guess at.
          row.dataset.answered = 'error';
          return (head.querySelector('.guided-said') || head.appendChild(el('span', 'guided-said err')))
            .replaceChildren(document.createTextNode(t('panel.audit.notFiled', { error: res2.error })));
        }
        row.dataset.answered = verdict;
        const said = head.querySelector('.guided-said') || head.appendChild(el('span', 'guided-said'));
        said.className = `guided-said verdict-${verdict}`;
        said.textContent = t(VERDICT_SAID[verdict]);
        note.value = '';
      });
      actions.append(btn);
    }
    actions.append(note);
    row.append(actions);
    host.append(row);
  }
}

/* ═══════════════════════════════════════════════ cookies and storage ══════ */

const fmtExpiry = (c) => {
  if (c.session) return t('panel.storage.cookieSessionExpiry');
  if (!c.expirationDate) return '—';
  const d = new Date(c.expirationDate * 1000);
  const days = Math.round((d - Date.now()) / 86_400_000);
  return `${d.toLocaleDateString(QAWi18n.numTag())} (${days < 0 ? t('panel.storage.expired') : t('panel.storage.daysSuffix', { days })})`;
};

let cookies = [];

async function loadStorage() {
  state('storage-state', t('panel.storage.reading'));
  // `cookies` is optional: ask on a click, never on load, and say so when it is refused.
  if (!(await chrome.permissions.contains({ permissions: ['cookies'] }).catch(() => false))) {
    const allow = el('button', 'btn btn-primary', t('panel.storage.cookiesAllow'));
    allow.addEventListener('click', async () => {
      const ok = await chrome.permissions.request({ permissions: ['cookies'] }).catch(() => false);
      if (ok) loadStorage();
      else state('storage-state', t('panel.storage.cookiesRefused'), 'err');
    });
    $('cookies').replaceChildren(el('p', 'muted', t('panel.storage.cookiesNeeded')), allow);
    cookies = [];
    const ws = await send({ type: 'UQA_WEBSTORAGE', ...target() });
    if (ws.ok) renderWebStorage(ws.result);
    else $('webstorage').replaceChildren(el('p', 'muted err', ws.error));
    state('storage-state', t('panel.storage.cookiesNeeded'), 'err');
    return;
  }
  const [cs, ws] = await Promise.all([
    send({ type: 'UQA_COOKIES', ...target() }),
    send({ type: 'UQA_WEBSTORAGE', ...target() }),
  ]);

  if (!cs.ok) {
    $('cookies').replaceChildren(el('p', 'muted err', cs.error));
    cookies = [];
  } else {
    cookies = cs.result;
    renderCookies();
  }

  if (ws.ok) renderWebStorage(ws.result);
  else $('webstorage').replaceChildren(el('p', 'muted err', ws.error));

  // Never blank on failure: an empty status line reads as "nothing to report"
  // when what actually happened is that the read was refused.
  state(
    'storage-state',
    cs.ok ? t(cookies.length === 1 ? 'panel.storage.cookieCountOne' : 'panel.storage.cookieCountMany', { n: cookies.length }) : cs.error,
    cs.ok ? '' : 'err'
  );
}

function renderCookies() {
  const host = $('cookies');
  host.replaceChildren();
  if (!cookies.length) {
    host.append(el('p', 'muted', t('panel.storage.noCookies')));
    return;
  }

  const table = el('table', 'kv-table');
  const head = el('tr');
  [
    t('panel.storage.colName'),
    t('panel.storage.colValue'),
    t('panel.storage.colDomain'),
    t('panel.storage.colPath'),
    t('panel.storage.colExpires'),
    t('panel.storage.colFlags'),
    '',
  ].forEach((h) => head.append(el('th', null, h)));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);

  const body = el('tbody');
  for (const c of cookies) {
    const tr = el('tr');
    tr.append(el('td', 'kv-name', c.name));

    const valueCell = el('td');
    const value = document.createElement('input');
    value.type = 'text';
    value.className = 'kv-value';
    value.value = c.value;
    value.spellcheck = false;
    valueCell.append(value);
    tr.append(valueCell);

    tr.append(el('td', 'kv-dim', c.domain));
    tr.append(el('td', 'kv-dim', c.path));
    tr.append(el('td', 'kv-dim', fmtExpiry(c)));

    // HttpOnly / Secure / SameSite are the cookie's own protocol flags: HTTP
    // vocabulary, not this pass's copy to translate.
    const flags = el('td', 'kv-flags');
    if (c.httpOnly) flags.append(el('span', 'flag flag-lock', 'HttpOnly'));
    if (c.secure) flags.append(el('span', 'flag', 'Secure'));
    if (c.sameSite) flags.append(el('span', 'flag', `SameSite=${c.sameSite}`));
    tr.append(flags);

    const actions = el('td', 'kv-actions');
    const save = el('button', 'btn btn-xs btn-primary', t('common.save'));
    save.addEventListener('click', async () => {
      const res = await send({
        type: 'UQA_COOKIE_SET',
        ...target(),
        cookie: { ...c, value: value.value },
        previous: c,
      });
      state('storage-state', res.ok ? t('panel.storage.savedName', { name: c.name }) : res.error, res.ok ? 'ok' : 'err');
      if (res.ok) loadStorage();
    });
    const del = el('button', 'btn btn-xs btn-danger', t('panel.storage.deleteButton'));
    del.addEventListener('click', async () => {
      const res = await send({ type: 'UQA_COOKIE_DELETE', ...target(), name: c.name, storeId: c.storeId });
      state('storage-state', res.ok ? t('panel.storage.deletedName', { name: c.name }) : res.error, res.ok ? 'ok' : 'err');
      if (res.ok) loadStorage();
    });
    actions.append(save, del);
    tr.append(actions);
    body.append(tr);
  }
  table.append(body);
  const scroller = el('div', 'kv-scroller');
  scroller.append(table);
  host.append(scroller);
}

function renderWebStorage(data) {
  const host = $('webstorage');
  host.replaceChildren();

  for (const [area, label] of [['local', 'localStorage'], ['session', 'sessionStorage']]) {
    const rows = data[area];
    if (rows?.error) {
      host.append(el('p', 'muted err', `${label}: ${rows.error}`));
      continue;
    }
    const wrap = el('div', 'ws-area');
    wrap.append(el('h4', null, `${label}: ${t(rows.length === 1 ? 'panel.storage.keyCountOne' : 'panel.storage.keyCountMany', { n: rows.length })}`));
    if (!rows.length) {
      wrap.append(el('p', 'muted', t('panel.storage.empty')));
      host.append(wrap);
      continue;
    }

    for (const row of rows) {
      const line = el('div', 'ws-row');
      line.append(el('span', 'kv-name', row.key));
      const value = document.createElement('input');
      value.type = 'text';
      value.className = 'kv-value';
      value.value = row.value;
      value.spellcheck = false;
      if (row.truncated) value.title = t('panel.storage.truncatedTitle', { bytes: row.bytes });
      line.append(value);

      const save = el('button', 'btn btn-xs btn-primary', t('common.save'));
      save.disabled = row.truncated; // never let a save silently cut a value short
      save.addEventListener('click', async () => {
        const res = await send({ type: 'UQA_WEBSTORAGE_SET', ...target(), area, key: row.key, value: value.value });
        state('storage-state', res.ok ? t('panel.storage.savedName', { name: row.key }) : res.error, res.ok ? 'ok' : 'err');
      });
      const del = el('button', 'btn btn-xs btn-danger', t('panel.storage.deleteButton'));
      del.addEventListener('click', async () => {
        const res = await send({ type: 'UQA_WEBSTORAGE_DELETE', ...target(), area, key: row.key });
        if (res.ok) loadStorage();
        else state('storage-state', res.error, 'err');
      });
      line.append(save, del);
      if (row.truncated) line.append(el('span', 'muted ws-cap', t('panel.storage.tooLongToEdit', { bytes: row.bytes })));
      wrap.append(line);
    }
    host.append(wrap);
  }
}

/* ── the toolbar ────────────────────────────────────────────────────────── */

function wireStorage() {
  $('storage-refresh').addEventListener('click', loadStorage);

  $('cookie-add').addEventListener('click', async () => {
    const name = prompt(t('panel.storage.promptCookieName'));
    if (!name) return;
    const value = prompt(t('panel.storage.promptValueFor', { name }), '') ?? '';
    const res = await send({ type: 'UQA_COOKIE_SET', ...target(), cookie: { name, value, path: '/' } });
    state('storage-state', res.ok ? t('panel.storage.addedName', { name }) : res.error, res.ok ? 'ok' : 'err');
    if (res.ok) loadStorage();
  });

  $('cookie-export').addEventListener('click', async () => {
    if (!cookies.length) return state('storage-state', t('panel.storage.nothingToExport'), 'err');
    // The shape Cookie Editor and Puppeteer both read, so the jar is portable.
    // `sameSite: 'lax'` is the cookie's own protocol value, part of that
    // shape: data written into the export, not copy this pass translates.
    const jar = cookies.map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || 'lax',
      expirationDate: c.expirationDate, session: c.session,
    }));
    const text = JSON.stringify(jar, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      state('storage-state', t(jar.length === 1 ? 'panel.storage.copiedOne' : 'panel.storage.copiedMany', { n: jar.length }), 'ok');
    } catch {
      state('storage-state', t('panel.storage.clipboardUnreachable'), 'err');
    }
  });

  $('cookie-import').addEventListener('click', async () => {
    const json = prompt(t('panel.storage.promptPasteJar'));
    if (!json) return;
    const res = await send({ type: 'UQA_COOKIES_IMPORT', ...target(), json });
    if (!res.ok) return state('storage-state', res.error, 'err');
    const { applied, total, results } = res.result;
    const failed = results.filter((r) => !r.ok);
    state(
      'storage-state',
      failed.length
        ? t('panel.storage.importPartial', { applied, total, list: failed.map((f) => `${f.name} (${f.error})`).join('; ') })
        : t(applied === 1 ? 'panel.storage.importedOne' : 'panel.storage.importedMany', { n: applied }),
      failed.length ? 'err' : 'ok'
    );
    loadStorage();
  });

  $('cookie-clear').addEventListener('click', async () => {
    if (!confirm(t('panel.storage.confirmClearCookies'))) return;
    const res = await send({ type: 'UQA_COOKIES_CLEAR', ...target() });
    state('storage-state', res.ok ? t('panel.storage.deletedOfTotal', { removed: res.result.removed, total: res.result.total }) : res.error, res.ok ? 'ok' : 'err');
    loadStorage();
  });

  $('ls-add').addEventListener('click', async () => {
    const key = prompt(t('panel.storage.promptLocalStorageKey'));
    if (!key) return;
    const value = prompt(t('panel.storage.promptValueFor', { name: key }), '') ?? '';
    const res = await send({ type: 'UQA_WEBSTORAGE_SET', ...target(), area: 'local', key, value });
    state('storage-state', res.ok ? t('panel.storage.setName', { name: key }) : res.error, res.ok ? 'ok' : 'err');
    if (res.ok) loadStorage();
  });

  // 'localStorage' / 'sessionStorage' are the Web API's own names, kept Latin.
  for (const [id, area, label] of [['ls-clear', 'local', 'localStorage'], ['ss-clear', 'session', 'sessionStorage']]) {
    $(id).addEventListener('click', async () => {
      if (!confirm(t('panel.storage.confirmClearArea', { label }))) return;
      const res = await send({ type: 'UQA_WEBSTORAGE_CLEAR', ...target(), area });
      state(
        'storage-state',
        res.ok ? t(res.result.cleared === 1 ? 'panel.storage.clearedOne' : 'panel.storage.clearedMany', { n: res.result.cleared, label }) : res.error,
        res.ok ? 'ok' : 'err'
      );
      loadStorage();
    });
  }
}

function wireAudit() {
  $('rule-load').addEventListener('click', loadRules);
  $('rule-run').addEventListener('click', () => runScan([...selected]));
  $('rule-run-all').addEventListener('click', () => runScan(null));
  $('rule-search').addEventListener('input', renderRules);
  $('rule-tag').addEventListener('change', renderRules);
}

wireAudit();
wireStorage();

/*
 * `audit.js` has no single `boot()` of its own (it is a second plain script,
 * wired the moment it loads); this is that page's boot in miniature. The
 * three renders below all build tester-facing text through `t()`, so they
 * wait on the same table `panel.js` awaits, and a language change repaints
 * them the same way `panel.js` repaints its own blocks.
 */
(async () => {
  await QAWi18n.ready();
  QAWi18n.onChange(() => {
    QAWi18n.apply();
    renderRules();
    renderGuided();
    loadStorage();
  });
  renderRules();   // an empty box explains nothing; say what the button is for
  renderGuided();
  loadStorage();
})();
})();
