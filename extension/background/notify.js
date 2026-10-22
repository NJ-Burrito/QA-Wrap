/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Telling a chat tool what happened, at three levels: Slack (a Block Kit message), Teams / Discord / anything else
 * (their own native payloads), and a custom endpoint (a template the tester writes).
 * Routing is by severity floor; every destination is off until a URL is pasted in.
 */

import { SEVERITY } from '../core/istqb.js';
import { mmText, safeHref, isTesterNote } from '../core/events.js';
/** r3-14-4: Markdown link target the parser cannot end early: those characters are percent-encoded. */
const mdHref = (u) => safeHref(u).replace(/[\s()[\]<>"'`\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
import { PRODUCT } from '../core/product.js';
import { getSettings, assertPolicy } from '../platform/settings.js';
import { fetchT as rawFetch, noteScan, recordEgress, ledgerRow } from '../core/egress.js';
export { noteScan };
// Jira and tracker clients run in the offscreen document (no storage), so their sends are ledgered here, at the seam.
export const recordSend = (kind, url, msg) => recordEgress({ ...ledgerRow(kind, url, JSON.stringify(msg)), findingsCount: null, scanned: null }); // the scan runs offscreen; its result is not carried back
export const recordCopy = (text) => recordEgress(ledgerRow('clipboard', '', text, { findingsCount: 0, scanned: false }));
const fetchT = (u, i, o) => rawFetch(u, i, { ...o, kind: 'webhook' });


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/* the other kind of telling: the tester's own desktop */

/**
 * A desktop notification, for what happens where nobody is looking (the popup has closed).
 * Rules: the tester can switch them off (`systemNotifications`); one per `subject`, replaced
 * not stacked (it is the notification id); it never throws, so a recording cannot fail because
 * the notification centre refused; it says the thing ("Saved to Downloads/QA Wrap"), not the category.
 *
 * @param {string} subject one of NOTES' keys — the notification id
 * @param {string} title
 * @param {string} message
 * @param {{force?: boolean}} [opts] `force` ignores the setting; used by
 *        `UQA_NOTIFY_TEST` so the settings page can prove the permission works.
 */
export async function announce(subject, title, message, { force = false } = {}) {
  try {
    if (!chrome.notifications?.create) return { shown: false, reason: 'unavailable' };
    if (!force) {
      const settings = await getSettings().catch(() => null);
      if (settings && settings.systemNotifications === false) {
        return { shown: false, reason: 'switched-off' };
      }
    }
    const id = await new Promise((resolve) => {
      chrome.notifications.create(
        `qawrap-${subject}`,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: String(title || PRODUCT.name).slice(0, 120),
          message: String(message || '').slice(0, 500),
          // Never sticky. A notification that will not go away is a
          // notification people turn off at the operating system, and then the
          // one that mattered is off too.
          requireInteraction: false,
          silent: true,
        },
        resolve
      );
    });
    // Read and dropped: `lastError` here means the notification did not appear,
    // which is not a reason to tell anybody their recording failed.
    void chrome.runtime.lastError;
    return { shown: !!id, id: id || null, subject };
  } catch (err) {
    return { shown: false, reason: String(err?.message || err) };
  }
}

/**
 * The four sentences, in one place so they can be read together.
 *
 * Written as functions rather than templates because each of them has a case
 * where the honest sentence is a different sentence — a clip with no session
 * to file into, a sleep that stopped nothing.
 */
export const NOTES = {
  recordingStarted: ({ scope, refused = [] }) =>
    [
      `Recording ${scope === 'screen' ? 'the screen' : 'this tab'}.`,
      refused.length ? `Without: ${refused.join(', ')}.` : 'Press Record again to stop.',
    ].join(' '),

  recordingStopped: ({ bytes, seconds }) => {
    const mb = bytes ? `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB` : null;
    const len = seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : null;
    return [
      'Recording saved.',
      [len, mb].filter(Boolean).join(', '),
      'It is in the report under Screens & video.',
    ]
      .filter(Boolean)
      .join(' ');
  },

  sessionStopped: ({ charter, events, failures }) =>
    `${charter || 'Session'} finished: ${plural(events || 0, 'event')}, ${plural(failures || 0, 'problem')}. ` +
    'Open the report to file it.',

  slept: ({ clip, session }) =>
    [
      'QA Wrap is asleep in this window.',
      clip ? 'The recording was stopped and saved.' : null,
      session ? 'The session was closed and kept.' : null,
      !clip && !session ? 'Nothing is recorded, hooked or read until you wake it.' : null,
    ]
      .filter(Boolean)
      .join(' '),
};

const SEVERITY_RANK = Object.fromEntries(SEVERITY.map((s, i) => [s.id, SEVERITY.length - i]));

/** Known shapes, so a URL alone is usually enough to guess the format right. */
export const PROVIDERS = [
  {
    id: 'slack',
    label: 'Slack',
    match: /^https:\/\/hooks\.slack\.com\//,
    hint: 'Incoming webhook. Create one at api.slack.com › Incoming Webhooks.',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    // Workflows: <env>.environment.api.powerplatform.com; the two old hosts still say Teams.
    match: /^https:\/\/[^/]*\.(webhook\.office|logic\.azure|api\.powerplatform)\.com(:\d+)?\//,
    hint: 'Workflows: "Post to a channel when a webhook request is received".',
  },
  {
    id: 'discord',
    label: 'Discord',
    match: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//,
    hint: 'Channel › Integrations › Webhooks.',
  },
  {
    id: 'google',
    label: 'Google Chat',
    match: /^https:\/\/chat\.googleapis\.com\//,
    hint: 'Space › Apps & integrations › Webhooks.',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    match: /^https:\/\/api\.telegram\.org\/bot/,
    // The only provider here that is not a webhook: a bot token identifies the
    // sender and a chat id says where it lands, so the destination needs both.
    needs: ['token', 'chatId'],
    hint: 'Talk to @BotFather for a token, then add the bot to the chat and put the chat id here.',
  },
  {
    id: 'mattermost',
    label: 'Mattermost',
    // Self-hosted by definition: the host is whatever the team runs, so the
    // path is what identifies it. `/hooks/<id>` is the shape every Mattermost
    // incoming webhook has, on any domain.
    match: /^https?:\/\/[^/]+\/hooks\/[\w-]+/,
    hint: 'Integrations › Incoming Webhooks, on your own server.',
  },
  {
    id: 'custom',
    label: 'Anything else',
    match: /^https?:\/\//,
    hint: 'Any endpoint that takes a POST. Write the JSON body yourself below.',
  },
];

/** Guess from the URL, so the tester rarely has to choose. */
export function detectProvider(url) {
  return (PROVIDERS.find((p) => p.match.test(String(url || ''))) || PROVIDERS[PROVIDERS.length - 1]).id;
}

/* the message, before it is dressed for anywhere */

/**
 * One neutral summary, rendered per provider afterwards.
 *
 * Built once so every destination says the same thing — a team reading Slack and
 * a manager reading Teams comparing notes and finding different numbers is a
 * small disaster that is entirely avoidable.
 */
export function summarise({ session, events, defect, links = {} }) {
  const failures = events.filter((e) => e.kind === 'net' ? e.error || (e.status >= 400 && e.status < 600) : e.kind === 'console' ? e.level === 'error' : e.kind === 'pageerror');
  const notes = events.filter(isTesterNote);
  const perf = [...events].reverse().find((e) => e.kind === 'perf');
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');

  return {
    lang: /^ar/i.test(session.env?.language || '') || /[\u0600-\u06FF]/.test([session.charter].join(' ')) ? 'ar' : 'en',
    title: defect?.summary || session.charter || 'QA session',
    severity: defect?.severity || null,
    priority: defect?.priority || null,
    where: session.startUrl || null,
    charter: session.charter,
    counts: {
      events: events.length,
      failures: failures.length,
      steps: events.filter((e) => e.kind === 'dom').length,
      notes: notes.length,
      screenshots: events.filter((e) => e.kind === 'screenshot').length,
      recordings: events.filter((e) => e.kind === 'recording').length,
    },
    expected: defect?.expected || null,
    actual: defect?.actual || null,
    steps: (defect?.steps || []).slice(0, 6),
    quality: {
      lcp: perf?.metrics?.lcp ?? null,
      requests: perf?.resources?.count ?? null,
      a11y: a11y ? a11y.total : null,
    },
    links,
    // Which "Post here when" events this message counts as: every finished
    // session is `done`; `fail` if something failed or a defect was written up;
    // `report` when a filed ticket or report link came with it.
    on: ['done', ...(failures.length || defect ? ['fail'] : []), ...(Object.values(links || {}).some(Boolean) ? ['report'] : [])],
    when: new Date(session.startedAt).toISOString(),
  };
}

/* per-provider payloads */

const LABELS = {
  en: { sev: 'Severity', pri: 'Priority', sg: 'impact on the system', pg: 'urgency of the fix', pb: 'Problems found', steps: 'Steps recorded', sh: 'Steps', where: 'Where', exp: 'Expected', act: 'Actual', rs: 'Result' },
  ar: { sev: 'الخطورة', pri: 'الأولوية', sg: 'الأثر على النظام', pg: 'إلحاح الإصلاح', pb: 'المشكلات المرصودة', steps: 'الخطوات المسجلة', sh: 'الخطوات', where: 'المكان', exp: 'المتوقع', act: 'الفعلي', rs: 'النتيجة' },
};
const k = (s) => LABELS[s.lang] || LABELS.en;
const arN = (n, a, b, c, d) => (n === 1 ? a : n === 2 ? b : n > 2 && n < 11 ? `${n} ${c}` : `${n} ${d}`);
const problemCount = (s) => (s.lang !== 'ar' ? plural(s.counts.failures, 'problem') : s.counts.failures ? arN(s.counts.failures, 'مشكلة واحدة', 'مشكلتان', 'مشكلات', 'مشكلة') : 'لا مشكلات');
const problemsIn = (s) => (s.lang !== 'ar' ? `${problemCount(s)} in ${plural(s.counts.events, 'event')}` : `${problemCount(s)} في ${s.counts.events ? arN(s.counts.events, 'حدث واحد', 'حدثين', 'أحداث', 'حدثًا') : 'صفر أحداث'}`);

const EMOJI = { critical: ':rotating_light:', major: ':red_circle:', moderate: ':large_orange_circle:', minor: ':large_yellow_circle:' };

function slackPayload(s, { mention }) {
  const fields = [];
  const L = k(s);
  const add = (label, value) => value != null && fields.push({ type: 'mrkdwn', text: `*${label}*\n${value}` });

  if (s.severity) add(L.sev, `${EMOJI[s.severity] || ''} ${s.severity}: ${L.sg}`);
  if (s.priority) add(L.pri, `${s.priority}: ${L.pg}`);
  add(L.pb, String(s.counts.failures));
  add(L.steps, String(s.counts.steps));
  if (s.quality.lcp != null) add('LCP', `${s.quality.lcp}ms`);
  if (s.quality.a11y != null) add('Accessibility', plural(s.quality.a11y, 'issue'));

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: s.title.slice(0, 150), emoji: true } },
  ];

  if (s.where) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `:round_pushpin: ${s.where}` }] });
  }
  if (fields.length) blocks.push({ type: 'section', fields: fields.slice(0, 10) });

  if (s.expected || s.actual) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${L.exp}*\n${s.expected || '—'}\n\n*${L.act}*\n${s.actual || '—'}`.slice(0, 2900) },
    });
  }
  if (s.steps.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${L.sh}*\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}`.slice(0, 2900) },
    });
  }

  // Buttons only when there is somewhere to send people. A dead button in a
  // channel is worse than no button.
  const actions = Object.entries(s.links)
    .filter(([, url]) => url)
    .slice(0, 5)
    .map(([label, url]) => ({
      type: 'button',
      text: { type: 'plain_text', text: label.slice(0, 74) },
      url,
    }));
  if (actions.length) blocks.push({ type: 'actions', elements: actions });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Captured locally with QA Wrap · passwords and cookie values were never recorded' }],
  });

  return { text: `${mention ? mention + ' ' : ''}${s.title}`, blocks };
}

/** Workflows webhooks render an Adaptive Card (MessageCard buttons are ignored). */
function teamsAdaptivePayload(s) {
  const L = k(s);
  const facts = [
    s.severity && { title: L.sev, value: `${s.severity} (${L.sg})` },
    s.priority && { title: L.pri, value: `${s.priority} (${L.pg})` },
    { title: L.pb, value: String(s.counts.failures) },
    { title: L.steps, value: String(s.counts.steps) },
    s.where && { title: L.where, value: s.where },
  ].filter(Boolean);
  const text = (t, extra = {}) => ({ type: 'TextBlock', text: t, wrap: true, ...extra });
  const body = [
    text(s.title.slice(0, 150), { weight: 'Bolder', size: 'Medium' }),
    { type: 'FactSet', facts },
    s.expected || s.actual ? text(`**${L.exp}** ${s.expected || '—'}\n\n**${L.act}** ${s.actual || '—'}`) : null,
    s.steps.length ? text(s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n\n')) : null,
  ].filter(Boolean);
  const actions = Object.entries(s.links)
    .filter(([, url]) => url)
    .slice(0, 4)
    .map(([label, url]) => ({ type: 'Action.OpenUrl', title: label, url }));
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(actions.length ? { actions } : {}),
        },
      },
    ],
  };
}

function discordPayload(s) {
  return {
    username: PRODUCT.name,
    embeds: [
      {
        title: s.title.slice(0, 250),
        url: Object.values(s.links).find(Boolean) || undefined,
        color: s.severity === 'critical' ? 0xc00000 : s.severity === 'major' ? 0xe24e3a : 0xf2b234,
        description: [s.expected && `**${k(s).exp}** ${s.expected}`, s.actual && `**${k(s).act}** ${s.actual}`]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4000),
        fields: [
          s.severity && { name: k(s).sev, value: s.severity, inline: true },
          s.priority && { name: k(s).pri, value: s.priority, inline: true },
          { name: k(s).pb, value: String(s.counts.failures), inline: true },
          s.where && { name: k(s).where, value: s.where.slice(0, 1000) },
        ].filter(Boolean),
        footer: { text: 'Captured locally with QA Wrap' },
        timestamp: s.when,
      },
    ],
  };
}

/**
 * Google Chat, as a card rather than a paragraph.
 *
 * `cardsV2` is what the API takes now, and it is worth the extra shape: a card
 * puts the counts in a grid a reader scans instead of a sentence they parse,
 * and it turns the links into buttons, which is the difference between a
 * summary somebody acts on and one they scroll past. The `text` stays as well:
 * it is what a notification preview and a search result show.
 */
function googlePayload(s) {
  const rows = [
    s.where ? { decoratedText: { topLabel: k(s).where, text: s.where, startIcon: { knownIcon: 'BOOKMARK' } } } : null,
    s.severity ? { decoratedText: { topLabel: k(s).sev, text: `${s.severity} · ${k(s).pri} ${s.priority}` } } : null,
    { decoratedText: { topLabel: s.lang === 'ar' ? 'ما حدث' : 'What happened', text: problemsIn(s) } },
    s.expected ? { decoratedText: { topLabel: k(s).exp, text: s.expected, wrapText: true } } : null,
    s.actual ? { decoratedText: { topLabel: k(s).act, text: s.actual, wrapText: true } } : null,
  ].filter(Boolean);

  const buttons = Object.entries(s.links)
    .filter(([, url]) => url)
    .map(([label, url]) => ({ text: label, onClick: { openLink: { url } } }));
  if (buttons.length) rows.push({ buttonList: { buttons } });

  return {
    text: `${s.title}: ${problemCount(s)}`,
    cardsV2: [{
      cardId: `qaw-${s.sessionId || 'session'}`,
      card: {
        header: { title: s.title.slice(0, 200), subtitle: s.where || 'QA Wrap', imageType: 'CIRCLE' },
        sections: [{ collapsible: false, widgets: rows }],
      },
    }],
  };
}

/**
 * Telegram, which takes its message as form fields rather than as a body.
 *
 * `sendMessage` is a GET-shaped API that also accepts JSON; the chat id and the
 * text are the message. HTML parse mode rather than Markdown because Telegram's
 * Markdown escaping rules reject perfectly ordinary characters in a URL, and a
 * summary that fails to post because a query string contained an underscore is
 * a bug nobody would ever guess at.
 */
function telegramPayload(s, { chatId }) {
  // r1-13-6: the same escape serves text and a quoted attribute, so quotes are escaped too
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // a link is an http(s) address or plain text: javascript:, data: and the rest never reach an href
  const web = (u) => { try { return /^https?:$/.test(new URL(String(u).trim()).protocol) ? String(u).trim() : ''; } catch { return ''; } };
  const lines = [
    `<b>${esc(s.title)}</b>`,
    s.where ? esc(s.where) : null,
    s.severity ? `${k(s).sev}: <b>${esc(s.severity)}</b> · ${k(s).pri}: <b>${esc(s.priority)}</b>` : null,
    problemsIn(s),
    s.expected ? `\n<b>${k(s).exp}</b> ${esc(s.expected)}` : null,
    s.actual ? `<b>${k(s).act}</b> ${esc(s.actual)}` : null,
    ...Object.entries(s.links).filter(([, u]) => u).map(([label, url]) => (web(url) ? `<a href="${esc(web(url))}">${esc(label)}</a>` : esc(label))),
  ].filter(Boolean);
  return {
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: lines.join('\n').slice(0, 4000),
  };
}

/**
 * Mattermost, which speaks Slack's dialect and its own at the same time.
 *
 * The `text` field is Slack-compatible markdown and every server renders it;
 * `attachments` is the richer half and is ignored by servers that do not want
 * it. Sending both is what makes one payload work across versions a QA team
 * does not control.
 */
function mattermostPayload(s, { channel, username }) {
  const facts = [
    s.where ? `**${k(s).where}** ${mmText(s.where)}` : null,
    s.severity ? `**${k(s).sev}** ${mmText(s.severity)} · **${k(s).pri}** ${mmText(s.priority)}` : null,
    `**${k(s).rs}** ${problemsIn(s)}`,
    s.expected ? `**${k(s).exp}** ${mmText(s.expected)}` : null,
    s.actual ? `**${k(s).act}** ${mmText(s.actual)}` : null,
  ].filter(Boolean);
  const links = Object.entries(s.links).filter(([, u]) => u).map(([label, url]) => (safeHref(url) ? `[${mmText(label)}](${mdHref(url)})` : mmText(label))); // r2-03-2
  return {
    ...(channel ? { channel } : {}),
    username: username || 'QA Wrap',
    text: [`#### ${mmText(s.title)}`, ...facts, links.join(' · ')].filter(Boolean).join('\n').slice(0, 16000),
    attachments: [{
      color: s.counts.failures ? '#B5432B' : '#2A7A3B',
      title: mmText(s.title),
      text: facts.join('\n'),
      fields: [
        { short: true, title: 'Problems', value: String(s.counts.failures) },
        { short: true, title: 'Events', value: String(s.counts.events) },
      ],
    }],
  };
}

/**
 * A tester-written body.
 *
 * `{{path.to.value}}` is substituted from the summary. Deliberately dumb: no
 * expressions, no logic, nothing that can loop — a template language inside a
 * QA tool is a second product nobody asked for.
 */
export function renderTemplate(template, summary) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, path) => {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), summary);
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    // The result is spliced into JSON, so it has to survive being a JSON string.
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  });
}

export function buildPayload(provider, summary, options = {}) {
  switch (provider) {
    case 'slack':
      return slackPayload(summary, options);
    case 'teams':
      return teamsAdaptivePayload(summary);
    case 'discord':
      return discordPayload(summary);
    case 'google':
      return googlePayload(summary);
    case 'telegram':
      return telegramPayload(summary, options);
    case 'mattermost':
      return mattermostPayload(summary, options);
    case 'custom': {
      if (!options.template) return { text: `${summary.title}: ${problemCount(summary)}`, summary };
      const rendered = renderTemplate(options.template, summary);
      try {
        return JSON.parse(rendered);
      } catch (err) {
        throw new Error(
          `Your custom template did not produce valid JSON: ${err.message}. ` +
            'Check the quotes around each {{placeholder}}.'
        );
      }
    }
    default:
      return { text: summary.title };
  }
}

/* sending */

/** Does this destination want something of this severity? */
export function passesFloor(destination, severity) {
  if (!destination.minSeverity || destination.minSeverity === 'all') return true;
  if (!severity) return true; // a session summary with no defect always goes
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[destination.minSeverity] ?? 0);
}

/**
 * Post to one destination.
 *
 * Every provider signals success differently — Slack answers the literal string
 * `ok`, Teams answers `1`, Discord answers 204 with no body. Treating a 200 as
 * success is how a message that Slack rejected gets reported as delivered.
 */
/**
 * Where a destination actually posts.
 *
 * Every provider but one is a webhook: the URL *is* the secret and the address
 * at once. Telegram splits them — a bot token identifies the sender and a chat
 * id says which conversation — so the endpoint is built here, from the token,
 * and `api.telegram.org` is the only host it can ever be. A destination may
 * name its own base (a self-hosted Bot API server is a real deployment), and if
 * it does, that base is where it goes and nowhere else.
 */
export function endpointFor(destination) {
  const provider = destination.provider || detectProvider(destination.url);
  if (provider !== 'telegram') return String(destination.url || '').trim();
  const token = String(destination.token || '').trim();
  if (!token) throw new Error('Telegram needs a bot token. Talk to @BotFather, then paste it here.');
  if (!String(destination.chatId || '').trim()) {
    throw new Error('Telegram needs a chat id. Add the bot to the chat, then paste the id here.');
  }
  const base = String(destination.url || 'https://api.telegram.org').trim().replace(/\/+$/, '');
  return `${base}/bot${token}/sendMessage`;
}

export async function send(destination, summary) {
  const url = endpointFor(destination);
  if (!url) throw new Error('That destination has no URL.');
  // https, or loopback (an internal bot on 127.0.0.1 is not a network).
  const loopback = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(\/|$)/.test(url);
  if (!/^https:\/\//.test(url) && !loopback) {
    throw new Error(
      'A webhook URL must be https, or point at this machine. Over plain http to another host ' +
        'the payload, including anything in your report, would travel in the clear.'
    );
  }

  const provider = destination.provider || detectProvider(url);
  const payload = buildPayload(provider, summary, {
    mention: destination.mention,
    template: destination.template,
    chatId: destination.chatId,
    channel: destination.channel,
    username: destination.username,
  });

  await assertPolicy('integrations', url); // T-068 last line
  let res;
  try {
    res = await fetchT(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(destination.headers || {}) },
      body: JSON.stringify(payload),
    }, { noRedirect: true });
  } catch (err) {
    throw new Error(`Could not reach ${destination.label || provider}. ${err.message}`);
  }

  const body = (await res.text()).trim();

  if (provider === 'slack' && body !== 'ok') {
    throw new Error(`Slack refused the message (${res.status}): ${body.slice(0, 200) || 'no reason given'}`);
  }
  // Telegram answers 200 with {"ok":false,"description":...}: a wrong chat id, an unadded bot or a revoked token.
  if (provider === 'telegram') {
    let answer = null;
    try { answer = JSON.parse(body); } catch { /* not JSON: fall through to the status check */ }
    if (answer && answer.ok === false) {
      throw new Error(`Telegram refused the message (${answer.error_code ?? res.status}): ${String(answer.description || 'no reason given').slice(0, 200)}`);
    }
  }
  // Mattermost answers 200 `ok`; a refusal is JSON whose `message` is the sentence a tester needs.
  if (provider === 'mattermost' && res.ok && body && body !== 'ok') {
    let answer = null;
    try { answer = JSON.parse(body); } catch { /* a plain body from an older server */ }
    if (answer?.message || answer?.id) {
      throw new Error(`Mattermost refused the message (${res.status}): ${String(answer.message || answer.id).slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`${destination.label || provider} refused the message (${res.status}): ${body.slice(0, 200)}`);
  }
  return { sent: true, provider, status: res.status };
}

/**
 * Post to every configured destination, and report each outcome separately.
 *
 * One failing endpoint must not stop the others, and "sent" must never cover a
 * destination that was skipped by its own severity floor.
 */
export async function broadcast(destinations, summary) {
  // Every destination at once: a hung one costs its own timeout, not everyone else's. Order is kept.
  const settled = await Promise.allSettled(destinations.map(async (d) => {
    if ((!d.url && d.provider !== 'telegram') || d.enabled === false) return null;
    // A channel that picked its events posts only for those; one that never did (older settings) posts for all.
    if (d.events && summary.on && !summary.on.some((e) => d.events[e])) {
      return { label: d.label || d.provider, skipped: 'not subscribed to this event' };
    }
    if (!passesFloor(d, summary.severity)) {
      return { label: d.label || d.provider, skipped: `below its ${d.minSeverity} floor` };
    }
    try {
      const out = await send(d, summary);
      return { label: d.label || out.provider, ...out };
    } catch (err) {
      return { label: d.label || d.provider, sent: false, error: err.message };
    }
  }));
  return settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { label: destinations[i].label || destinations[i].provider, sent: false, error: String(r.reason?.message || r.reason) })).filter(Boolean);
}

/**
 * T-053: the same notes in the tester's language. `tr(key, english)` is the worker's catalogue
 * lookup; the English here is the fallback and NOTES above stays the source of record for tests.
 */
export async function noteL(tr, name, a = {}) {
  const f = async (k, en, v = {}) => (await tr(`common.worker.note.${k}`, en)).replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));
  if (name === 'recordingStarted') {
    return [await f(a.scope === 'screen' ? 'recScreen' : 'recTab', a.scope === 'screen' ? 'Recording the screen.' : 'Recording this tab.'),
      (a.refused || []).length ? await f('without', 'Without: {list}.', { list: a.refused.join(', ') }) : await f('pressAgain', 'Press Record again to stop.')].join(' ');
  }
  if (name === 'recordingStopped') {
    const mb = a.bytes ? `${Math.round((a.bytes / 1024 / 1024) * 10) / 10} MB` : null;
    const len = a.seconds ? `${Math.floor(a.seconds / 60)}:${String(Math.round(a.seconds % 60)).padStart(2, '0')}` : null;
    return [await f('saved', 'Recording saved.'), [len, mb].filter(Boolean).join(', '), await f('where', 'It is in the report under Screens & video.')].filter(Boolean).join(' ');
  }
  if (name === 'sessionStopped') {
    return f('session', '{charter} finished: events {events}, problems {failures}. Open the report to file it.', {
      charter: a.charter || (await f('sessionWord', 'Session')), events: a.events || 0, failures: a.failures || 0 });
  }
  return [await f('slept', 'QA Wrap is asleep in this window.'),
    a.clip ? await f('sleptClip', 'The recording was stopped and saved.') : null,
    a.session ? await f('sleptSession', 'The session was closed and kept.') : null,
    !a.clip && !a.session ? await f('sleptNothing', 'Nothing is recorded, hooked or read until you wake it.') : null].filter(Boolean).join(' ');
}
