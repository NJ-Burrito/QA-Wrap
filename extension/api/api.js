/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The API panel.
 *
 * ── why the sending happens here and not in the service worker ────────────
 *
 * `core/api-send.js` is imported by this page rather than by the worker,
 * and that is a deliberate cost decision rather than an accident of where the
 * file sits. The worker's static import graph is **at** its cap (43 direct / 47
 * transitive, `tools/test-worker-imports.mjs`), MV3 forbids `import()` inside a
 * `ServiceWorkerGlobalScope` by spec, and every module on that graph is parsed
 * on every cold start — thirty seconds of idleness, all day. Putting a panel
 * almost no session opens onto that path would make every screenshot and every
 * event slightly slower for a feature they never use.
 *
 * Nothing is lost by sending from here. This page carries the extension's
 * `host_permissions`, so its `fetch` is not subject to CORS and
 * `credentials: 'include'` uses the same profile cookie jar the tab under test
 * uses. The worker still owns the part that is genuinely its own: writing the
 * result into the running session (`UQA_API_RECORD`), because the session is
 * its state and no page may append to it directly.
 */

import { substituteRequest, runPreScript, parseCollection, SCRIPT_HELP } from './sandbox.js';
import { sendApiRequest } from '../core/api-send.js';
import { policy } from '../platform/settings.js';
import { allows } from '../platform/policy.js';
import { recordEgress, ledgerRow } from '../core/egress.js';
import { loadSealed, saveSealed } from '../platform/vault.js';
import { localizeError } from '../platform/worker-errors.js';

/**
 * Arabic and English both (council-1009 10-1). `platform/i18n.js` is a classic script in the head, so
 * `QAWi18n` exists before this module runs; static copy is stamped by `data-i18n*` in the HTML and
 * everything painted below goes through `t()`. Numbers, URLs, header names and the HTTP words stay as the wire has them.
 */
await QAWi18n.ready();
const t = (k, v) => QAWi18n.t(k, v);
document.title = t('api.title');

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SESSION = params.get('session');

/** Environments live per profile, sealed in the encrypted vault (r4-02-2): pasted tokens are not kept as plain text. */
const STORE = 'apiEnvironments';
/** A variable named like a credential is drawn masked, with a reveal toggle. */
const SECRET_VAR = /pass|pwd|secret|token|auth|bearer|api.?key|private.?key|cookie|session|jwt|csrf|xsrf/i;

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: t('common.workerUnresponsive') });
    });
  });
}

const say = (text, kind = '') => {
  const node = $('say');
  node.textContent = text;
  node.className = `save-state ${kind}`;
};

/* ── environments ──────────────────────────────────────────────────────── */

let envs = { active: 'Default', list: { Default: {} } };

const sayVault = (err) => say(localizeError(err, t, document.documentElement.lang || 'en'), 'err');

async function loadEnvs() {
  try {
    const stored = await loadSealed(STORE);
    if (stored?.list && Object.keys(stored.list).length) envs = stored;
  } catch (err) {
    sayVault(err); // a closed or unreadable vault: the existing sentence, and nothing is overwritten
  }
  paintEnvs();
}

const saveEnvs = () => saveSealed(STORE, envs).catch(sayVault);

/** The variables of the environment currently chosen. */
const activeVars = () => envs.list[envs.active] || {};

function paintEnvs() {
  const select = $('env');
  select.replaceChildren();
  for (const name of Object.keys(envs.list)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === envs.active;
    select.append(option);
  }
  paintVars();
}

function paintVars() {
  const host = $('vars');
  host.replaceChildren();
  const vars = activeVars();
  for (const [name, value] of Object.entries(vars)) host.append(varRow(name, value));
  if (!Object.keys(vars).length) host.append(varRow('', ''));
}

/** r2-08-1: the visible word is "Remove" on every row; the accessible name says which row, and follows the name as it is typed. */
function nameRemove(drop, key) {
  const label = () => drop.setAttribute('aria-label', key.value.trim() ? t('api.removeNamed', { name: key.value.trim() }) : t('api.remove'));
  key.addEventListener('input', label);
  label();
}

function varRow(name, value) {
  const row = document.createElement('div');
  row.className = 'row';
  const key = document.createElement('input');
  key.type = 'text';
  key.value = name;
  key.placeholder = t('api.var.namePh');
  key.setAttribute('aria-label', t('api.var.namePh'));
  key.spellcheck = false;
  const val = document.createElement('input');
  val.type = 'text';
  val.value = value;
  val.placeholder = t('api.var.valuePh');
  val.setAttribute('aria-label', t('api.var.valuePh'));
  val.spellcheck = false;
  val.autocomplete = 'off';
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'btn btn-sm';
  drop.textContent = t('api.remove');
  nameRemove(drop, key);

  // A credential-like name masks the value; the toggle shows or hides it, and only such rows carry it.
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'btn btn-sm';
  let revealed = false;
  const paintReveal = () => {
    const secret = SECRET_VAR.test(key.value);
    val.type = secret && !revealed ? 'password' : 'text';
    reveal.hidden = !secret;
    reveal.textContent = t(revealed ? 'api.var.hide' : 'api.var.show');
    reveal.setAttribute('aria-pressed', String(revealed));
  };
  reveal.addEventListener('click', () => {
    revealed = !revealed;
    paintReveal();
  });
  key.addEventListener('input', paintReveal);
  paintReveal();

  const commit = () => {
    const next = {};
    for (const r of $('vars').querySelectorAll('.row')) {
      const [k, v] = r.querySelectorAll('input');
      if (k.value.trim()) next[k.value.trim()] = v.value;
    }
    envs.list[envs.active] = next;
    saveEnvs();
  };
  key.addEventListener('change', commit);
  val.addEventListener('change', commit);
  drop.addEventListener('click', () => {
    row.remove();
    commit();
  });

  row.append(key, val, reveal, drop);
  return row;
}

/* ── headers ───────────────────────────────────────────────────────────── */

function headerRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'row';
  const key = document.createElement('input');
  key.type = 'text';
  key.value = name;
  key.placeholder = t('api.header.namePh');
  key.setAttribute('aria-label', t('api.header.namePh'));
  key.spellcheck = false;
  const val = document.createElement('input');
  val.type = 'text';
  val.value = value;
  val.placeholder = t('api.var.valuePh');
  val.setAttribute('aria-label', t('api.var.valuePh'));
  val.spellcheck = false;
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'btn btn-sm';
  drop.textContent = t('api.remove');
  nameRemove(drop, key);
  drop.addEventListener('click', () => row.remove());
  row.append(key, val, drop);
  return row;
}

const readHeaders = () =>
  [...$('headers').querySelectorAll('.row')]
    .map((r) => {
      const [k, v] = r.querySelectorAll('input');
      return { name: k.value.trim(), value: v.value };
    })
    .filter((h) => h.name);

/* ── composing, previewing, sending ────────────────────────────────────── */

/**
 * Everything resolved, so the preview is the request and not a description of
 * one. The pre-request script runs here, before the preview is drawn: a script
 * that sets a header the tester cannot see in the preview would defeat the
 * point of showing the request before sending it.
 */
function compose() {
  const script = runPreScript($('prescript').value, { vars: activeVars() });
  const errors = $('script-errors');
  if (script.errors.length) {
    errors.hidden = false;
    errors.textContent = script.errors.map((e) => t('api.script.line', { line: e.line, message: e.message })).join(' ');
  } else {
    errors.hidden = true;
    errors.textContent = '';
  }

  const request = substituteRequest(
    {
      method: $('method').value,
      url: $('url').value.trim(),
      headers: [...readHeaders(), ...script.headers],
      body: $('body').value,
    },
    script.vars
  );
  return { request, script };
}

function drawPreview({ request }) {
  const lines = [
    `${request.method} ${request.url}`,
    ...request.headers.map((h) => `${h.name}: ${h.value}`),
  ];
  if (request.body && request.method !== 'GET' && request.method !== 'HEAD') lines.push('', request.body);
  if (request.missing.length) {
    lines.push('', t('api.preview.unresolved', { names: request.missing.map((m) => `{{${m}}}`).join(', ') }));
  }
  $('preview').textContent = lines.join('\n');
  $('preview-card').hidden = false;
  $('preview-card').scrollIntoView({ block: 'nearest' });
  $('confirm').focus(); // r2-08-2: the card just appeared; keyboard focus goes to its decision, not stays behind it
}

/** Pretty-print JSON, and leave anything else exactly as it arrived. */
function pretty(text, headers) {
  const type = (headers.find((h) => h.name.toLowerCase() === 'content-type') || {}).value || '';
  if (!/json/i.test(type)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // A body that says it is JSON and is not is itself the finding, so it is
    // shown raw rather than swallowed by the parser.
    return text;
  }
}

async function reallySend(request) {
  $('preview-card').hidden = true;
  $('send').focus(); // r2-08-2: the focused button is now hidden; focus returns to where the request began
  say(t('api.status.sending'));
  let result = null;
  let failure = null;
  let passed = false; // the policy let this address through, so a failure after it may still have left the machine
  try {
    const org = await policy();
    passed = !allows(org, 'integrations', request.url);
    // r4-02-2: the managed policy is asked before fetch; r5-03-1: redirects are refused only while a host list restricts the tool
    result = await sendApiRequest({ ...request, gate: async (url) => allows(org, 'integrations', url), guardRedirects: Boolean(org.integrationHosts?.length) });
  } catch (err) {
    failure = err;
  }

  // r1-03-3: every send leaves a ledger row (host and size, never the body), answered or not; a refusal before the fetch (policy, or a bad URL: no `ms`, no code) sent nothing
  if (passed && (!failure || failure.ms !== undefined || failure.code === 'POLICY_BLOCKED')) {
    const bodyless = ['GET', 'HEAD'].includes(String(request.method).toUpperCase());
    recordEgress(ledgerRow('api', request.url, bodyless ? '' : request.body, { findingsCount: 0, scanned: false }));
    // D-1010-59: a followed redirect reached a second host; the ledger names it too (no refusal when no policy is set).
    if (result?.redirected && result.finalUrl) recordEgress(ledgerRow('api', result.finalUrl, bodyless ? '' : request.body, { findingsCount: 0, scanned: false }));
  }

  const card = $('response-card');
  card.hidden = false;
  if (failure) {
    $('res-status').textContent = t('api.res.noAnswer');
    $('res-status').dataset.tone = 'bad';
    $('res-time').textContent = `${failure.ms ?? 0} ms`;
    $('res-size').textContent = '0 B';
    $('res-headers').textContent = '';
    $('res-body').textContent = failure.message;
    $('res-summary').textContent = t('api.res.incomplete');
    say(failure.message, 'err');
  } else {
    $('res-status').textContent = `${result.status} ${result.statusText}`.trim();
    $('res-status').dataset.tone = result.ok ? 'good' : 'bad';
    $('res-time').textContent = `${result.ms} ms`;
    $('res-size').textContent = `${result.bytes} B`;
    $('res-headers').textContent = result.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
    $('res-body').textContent = pretty(result.body, result.headers) + (result.truncated ? `\n\n${t('api.res.truncated')}` : '');
    $('res-summary').textContent = result.redirected ? t('api.res.redirected', { url: result.finalUrl }) : '';
    if (result.refusedHeaders.length) {
      say(t('api.say.sentRefused', { names: result.refusedHeaders.join(', ') }), 'err');
    } else {
      say(t('api.say.sent'), 'ok');
    }
  }

  // Into the session, whether it worked or not. A request that got no answer is
  // exactly the evidence a bug report needs, and dropping it because it failed
  // would lose the one people came for.
  const recorded = await send({
    type: 'UQA_API_RECORD',
    sent: failure ? { ...request, startedAt: Date.now() } : result.request && { ...result.request, startedAt: result.startedAt },
    received: failure
      ? { ok: false, status: 0, error: failure.message, ms: failure.ms ?? 0 }
      : {
          ok: result.ok,
          status: result.status,
          ms: result.ms,
          bytes: result.bytes,
          headers: result.headers,
          body: result.body,
        },
  });
  $('res-recorded').textContent = recorded?.result?.stored
    ? t('api.res.recorded')
    : t('api.res.notRecorded');
}

/* ── importing what the session already saw ────────────────────────────── */

function paintCollection(collection) {
  const host = $('collection');
  host.replaceChildren();
  if (!collection.requests.length) {
    const empty = document.createElement('p');
    empty.className = 'fine';
    empty.textContent = t('api.collection.empty');
    host.append(empty);
    return;
  }
  for (const req of collection.requests.slice(0, 80)) {
    const row = document.createElement('div');
    row.className = 'row row-1';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'btn btn-sm';
    load.textContent = `${req.method} ${req.name}`;
    load.title = req.url;
    load.addEventListener('click', () => {
      $('method').value = req.method;
      $('url').value = req.url;
      $('body').value = req.body || '';
      const head = $('headers');
      head.replaceChildren();
      for (const h of req.headers) head.append(headerRow(h.name, h.value));
      if (!req.headers.length) head.append(headerRow());
      say(t('api.say.loaded', { method: req.method, name: req.name }), 'ok');
    });
    row.append(load);
    host.append(row);
  }
  // A collection carries its own variables; they go into the environment rather
  // than a second place to look for the same thing.
  const known = activeVars();
  let added = 0;
  for (const [name, value] of Object.entries(collection.variables)) {
    if (!(name in known)) {
      known[name] = value;
      added++;
    }
  }
  if (added) {
    envs.list[envs.active] = known;
    saveEnvs();
    paintVars();
  }
}

async function importFromSession() {
  const res = await send({ type: 'UQA_EXPORT', format: 'postman', sessionId: SESSION });
  if (!res?.ok) return say(res?.error || t('api.err.noCollection'), 'err');
  const raw = typeof res.result === 'string' ? res.result : res.result?.text || res.result?.content;
  try {
    paintCollection(parseCollection(raw));
    say(t('api.say.importedSession'), 'ok');
  } catch (err) {
    say(t('api.err.collectionRead', { message: err.message }), 'err');
  }
}

/* ── wiring ────────────────────────────────────────────────────────────── */

const paintScriptHelp = () => { $('script-help').textContent = t('api.script.help', { commands: SCRIPT_HELP.join(' · ') }); };
paintScriptHelp();
QAWi18n.onChange(() => { document.title = t('api.title'); paintScriptHelp(); });

$('add-header').addEventListener('click', () => $('headers').append(headerRow()));
$('add-var').addEventListener('click', () => $('vars').append(varRow('', '')));
$('headers').append(headerRow());

$('env').addEventListener('change', () => {
  envs.active = $('env').value;
  saveEnvs();
  paintVars();
});
$('env-add').addEventListener('click', () => {
  const name = $('env-name').value.trim();
  if (!name) return say(t('api.err.envName'), 'err');
  envs.list[name] = envs.list[name] || {};
  envs.active = name;
  $('env-name').value = '';
  saveEnvs();
  paintEnvs();
});
$('env-del').addEventListener('click', () => {
  if (Object.keys(envs.list).length < 2) return say(t('api.err.lastEnv'), 'err');
  delete envs.list[envs.active];
  envs.active = Object.keys(envs.list)[0];
  saveEnvs();
  paintEnvs();
});

let pending = null;
$('send').addEventListener('click', () => {
  const composed = compose();
  if (!composed.request.url) return say(t('api.err.noUrl'), 'err');
  pending = composed.request;
  drawPreview(composed);
});
$('cancel').addEventListener('click', () => {
  pending = null;
  $('preview-card').hidden = true;
  $('send').focus(); // r2-08-2
  say(t('api.say.cancelled'));
});
$('confirm').addEventListener('click', () => {
  if (pending) reallySend(pending);
});

$('import-session').addEventListener('click', importFromSession);
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    paintCollection(parseCollection(await file.text()));
    say(t('api.say.importedFile', { file: file.name }), 'ok');
  } catch (err) {
    say(t('api.err.fileRead', { message: err.message }), 'err');
  }
});

$('theme').addEventListener('click', () => window.UQATheme?.cycle?.());

loadEnvs();
if (SESSION) say(t('api.say.ready'));

/*
 * The primer, shown until it is not needed.
 *
 * E12. It answers "what is this page for", which nothing on the page answered
 * before, and a tester who already knows should not have to read it every
 * time. Dismissed into localStorage rather than into settings: it is a fact
 * about this browser's reader, not a preference the product carries around,
 * and a profile with no storage simply keeps showing it, which is the safe
 * direction to fail in.
 */
const PRIMER_KEY = 'qaw-api-primer-seen';
try {
  if (localStorage.getItem(PRIMER_KEY) === '1') $('primer').hidden = true;
} catch {
  /* no storage: the primer stays, which is the harmless half */
}
$('primer-hide')?.addEventListener('click', () => {
  $('primer').hidden = true;
  try {
    localStorage.setItem(PRIMER_KEY, '1');
  } catch {
    /* it will be here again next time, and that is not a failure worth saying */
  }
});
