/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/*
 * Settings > Integrations > «Jira helper». The markup lives in jira-helper.fragment.html and is added at run time, like AI writing.
 * Everything is stored in chrome.storage.local under qawJira. Notifications stay off until the switch is turned on, and turning it on
 * is the press that asks for the address and starts the once-a-minute alarm; turning it off clears the alarm.
 */
import { KEY, ALARM, cleanHost, normalise } from '../core/jira-helper-core.js';

(async () => {
  const mount = document.getElementById('sec-integrations');
  if (!mount) return;
  const t = (key, params) => globalThis.QAWi18n.t(key, params);
  try {
    const res = await fetch(new URL('jira-helper.fragment.html', import.meta.url));
    if (!res.ok) return;
    const box = document.createElement('div');
    box.innerHTML = await res.text();
    mount.append(box);
    await globalThis.QAWi18n.ready();
    globalThis.QAWi18n.apply(box);
  } catch { return; }
  const $ = (id) => document.getElementById(id);
  const say = (key, params) => { $('jh-state').textContent = key ? t(key, params) : ''; };

  async function paint() {
    const got = /** @type {any} */ (await chrome.storage.local.get([KEY, 'qawJiraSeen']));
    const s = normalise(got[KEY]);
    const seen = got.qawJiraSeen;
    // Jiras opened in this browser: pick one (the last opened is used when this stays empty).
    $('jh-seen').replaceChildren(...Object.keys(seen?.hosts || {}).map((h) => Object.assign(document.createElement('option'), { value: h })));
    if (!s.host && seen?.last) $('jh-host').placeholder = seen.last;
    $('jh-dropdown').checked = s.dropdown;
    $('jh-rtl').checked = s.rtl;
    $('jh-notify').checked = s.notify;
    if (document.activeElement !== $('jh-host')) $('jh-host').value = s.host;
    if (document.activeElement !== $('jh-projects')) $('jh-projects').value = s.projects.join(', ');
    if (document.activeElement !== $('jh-labels')) $('jh-labels').value = s.labels.join(', ');
    for (const k of Object.keys(s.on)) $(`jh-on-${k}`).checked = s.on[k];
  }

  const read = () => ({
    dropdown: $('jh-dropdown').checked,
    rtl: $('jh-rtl').checked,
    notify: $('jh-notify').checked,
    host: $('jh-host').value,
    projects: $('jh-projects').value,
    labels: $('jh-labels').value,
    on: Object.fromEntries(['assigned', 'watched', 'mentions', 'labels', 'related'].map((k) => [k, $(`jh-on-${k}`).checked])),
  });

  /** The user's address. The helper scripts are registered by the worker for the saved address (background/site-access.js syncJiraScripts); here the browser is only asked if it was somehow not already allowed. */
  async function allow(host) {
    if (!host) return say('options.jira.status.badHost'), false;
    const origins = [`https://${host}/\*`];
    if (!(await chrome.permissions.contains({ origins })) && !(await chrome.permissions.request({ origins }))) return say('options.jira.status.denied'), false;
    return true;
  }

  const persist = async () => {
    const s = normalise(read());
    const last = cleanHost(/** @type {any} */ ((await chrome.storage.local.get('qawJiraSeen')).qawJiraSeen)?.last);
    if (s.notify && !((s.host || last) && (await allow(s.host || last)))) {
      s.notify = false; // no address, or not allowed: the switch goes back off
    }
    await chrome.storage.local.set({ [KEY]: s });
    if (s.notify) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    else await chrome.alarms.clear(ALARM);
    await paint();
  };
  for (const el of document.querySelectorAll('#jira-helper input')) el.addEventListener('change', persist);

  $('jh-allow').addEventListener('click', async () => {
    const host = cleanHost($('jh-host').value);
    if (await allow(host)) { await persist(); say('options.jira.status.allowed'); }
  });
  $('jh-check').addEventListener('click', async () => {
    const seen = /** @type {any} */ ((await chrome.storage.local.get('qawJiraSeen')).qawJiraSeen);
    const host = cleanHost($('jh-host').value) || cleanHost(seen?.last);
    if (!host) return say('options.jira.status.badHost');
    if (!(await chrome.permissions.contains({ origins: [`https://${host}/\*`] }))) return say('options.jira.status.needAllow');
    try {
      const { check } = await import('../core/jira-notifier.js');
      const code = await check(host, undefined, seen?.hosts?.[host]);
      say(code === 200 ? 'options.jira.status.ok' : 'options.jira.status.refused', { code });
    } catch { say('options.jira.status.unreachable'); }
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch[KEY] || ch.qawJiraSeen)) paint(); });
  await paint();
})();
