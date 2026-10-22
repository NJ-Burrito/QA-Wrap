/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Tests for the chat and bot layer.
 *
 *   node tools/test-notify.mjs
 *
 * The payload builders are pure, so they are checked directly. Sending is
 * checked against a **real local server** that impersonates each provider,
 * including the ways they signal failure — because the bug this class of code
 * always has is treating a 200 as success when Slack has answered `invalid_payload`
 * with a 200 and thrown the message away.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  summarise, buildPayload, detectProvider, renderTemplate, passesFloor, send, broadcast, PROVIDERS,
} from '../background/notify.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_700_000_000_000;
const session = {
  id: 's_n', charter: 'Submit an application', startedAt: T0, startUrl: 'https://example.gov/apply',
  env: { viewport: '1920×1080', userAgent: 'Chrome/126' },
};
const events = [
  { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'Submit', frameUrl: 'a' },
  { kind: 'net', ts: T0 + 1400, method: 'POST', url: '/api/x', status: 500, durationMs: 20, error: false, frameUrl: 'a' },
  { kind: 'note', ts: T0 + 2000, tag: 'bug', text: 'Happens every time.' },
];

const defect = {
  summary: 'POST /api/x returns 500 after clicked Submit',
  severity: 'critical',
  priority: 'highest',
  expected: 'The application is submitted',
  actual: 'POST /api/x returned 500',
  steps: ['Open the form', 'Click Submit'],
};

const base = summarise({ session, events, defect, links: { 'Open the report': 'https://example.test/r', 'PROJ-9': 'https://jira.test/browse/PROJ-9' } });

console.log('notify.js — the summary is built once, for everyone');

await test('it carries what every provider needs', () => {
  assert.equal(base.title, defect.summary);
  assert.equal(base.severity, 'critical');
  assert.equal(base.priority, 'highest');
  assert.equal(base.counts.failures, 1);
  assert.equal(base.counts.steps, 1);
  assert.equal(base.where, session.startUrl);
});

await test('a session with no defect still summarises', () => {
  const s = summarise({ session, events, defect: null, links: {} });
  assert.equal(s.severity, null);
  assert.equal(s.title, session.charter);
});

console.log('\nnotify.js — the URL usually identifies the provider');

await test('each known provider is detected from its webhook URL', () => {
  assert.equal(detectProvider('https://hooks.slack.com/services/T/B/x'), 'slack');
  assert.equal(detectProvider('https://acme.webhook.office.com/webhookb2/x'), 'teams');
  assert.equal(detectProvider('https://discord.com/api/webhooks/1/x'), 'discord');
  assert.equal(detectProvider('https://chat.googleapis.com/v1/spaces/x'), 'google');
  assert.equal(detectProvider('https://bots.internal.example/hook'), 'custom', 'anything else falls back to custom');
});

await test('every provider in the list has a hint a person can act on', () => {
  PROVIDERS.forEach((p) => {
    assert.ok(p.hint && p.hint.length > 15, `${p.id} has no usable hint`);
    assert.ok(p.label, `${p.id} has no label`);
  });
});

console.log('\nnotify.js — each payload is the shape that provider takes');

await test('Slack gets Block Kit, with severity and priority as separate fields', () => {
  const p = buildPayload('slack', base, { mention: '<!here>' });
  assert.ok(Array.isArray(p.blocks));
  assert.equal(p.blocks[0].type, 'header');
  assert.ok(p.text.startsWith('<!here>'), 'the mention should lead the fallback text');

  const fields = p.blocks.filter((b) => b.fields).flatMap((b) => b.fields).map((f) => f.text);
  assert.ok(fields.some((t) => /Severity/.test(t) && /impact on the system/.test(t)));
  assert.ok(fields.some((t) => /Priority/.test(t) && /urgency of the fix/.test(t)));
});

await test('Slack links become buttons, and only real ones', () => {
  const p = buildPayload('slack', base, {});
  const actions = p.blocks.find((b) => b.type === 'actions');
  assert.ok(actions, 'no action block');
  assert.equal(actions.elements.length, 2);
  actions.elements.forEach((e) => assert.ok(e.url, 'a button with no URL is a dead button'));

  const none = buildPayload('slack', summarise({ session, events, defect, links: {} }), {});
  assert.ok(!none.blocks.some((b) => b.type === 'actions'), 'no links should mean no action block at all');
});

await test('Slack blocks stay inside the size Slack accepts', () => {
  const huge = summarise({
    session,
    events,
    defect: { ...defect, actual: 'x'.repeat(9000), steps: Array.from({ length: 40 }, (_, i) => `step ${i} ${'y'.repeat(200)}`) },
    links: {},
  });
  const p = buildPayload('slack', huge, {});
  p.blocks.forEach((b) => {
    if (b.text?.text) assert.ok(b.text.text.length <= 3000, `a section of ${b.text.text.length} chars — Slack caps at 3000`);
    if (b.fields) assert.ok(b.fields.length <= 10, 'Slack caps a section at 10 fields');
  });
  assert.ok(p.blocks.length <= 50, 'Slack caps a message at 50 blocks');
});

await test('Teams Workflows URLs are recognised, and get an Adaptive Card with buttons', () => {
  const wf = 'https://prod-12.westeurope.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=x';
  assert.equal(detectProvider(wf), 'teams');
  assert.equal(detectProvider('https://prod-01.westus.logic.azure.com:443/workflows/abc'), 'teams');
  assert.equal(detectProvider('https://example.com/api.powerplatform.com/'), 'custom');
  const a = buildPayload('teams', base, { url: wf });
  assert.equal(a.type, 'message');
  const card = a.attachments[0];
  assert.equal(card.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.content.type, 'AdaptiveCard');
  assert.ok(card.content.body.some((b) => b.type === 'FactSet' && b.facts.some((f) => f.title === 'Severity')));
  assert.equal(card.content.actions.length, 2);
  assert.ok(card.content.actions.every((x) => x.type === 'Action.OpenUrl' && /^https?:/.test(x.url)));
});

await test('Discord gets an embed, with its colour from the severity', () => {
  const p = buildPayload('discord', base, {});
  assert.equal(p.embeds.length, 1);
  assert.equal(p.embeds[0].color, 0xc00000, 'critical should be the strongest colour');
  assert.ok(p.embeds[0].timestamp);
  assert.ok(p.embeds[0].title.length <= 256, 'Discord caps an embed title at 256');
});

await test('Google Chat gets a card, and the preview text that goes with it', () => {
  const p = buildPayload('google', base, {});
  // The fallback line: what a notification and a search result show.
  assert.ok(typeof p.text === 'string' && p.text.length <= 4096);
  assert.match(p.text, /1 problem/);

  // The card: what a reader actually sees in the space.
  const card = p.cardsV2?.[0]?.card;
  assert.ok(card, 'cardsV2 is what the API takes now');
  assert.match(card.header.title, /POST \/api\/x/);
  const widgets = card.sections[0].widgets;
  const labels = widgets.map((w) => w.decoratedText?.topLabel).filter(Boolean);
  assert.deepEqual(labels, ['Where', 'Severity', 'What happened', 'Expected', 'Actual']);
  assert.match(widgets.find((w) => w.decoratedText?.topLabel === 'Where').decoratedText.text, /example\.gov/);

  // Links become buttons, which is the difference between a summary somebody
  // acts on and one they scroll past.
  const buttons = widgets.find((w) => w.buttonList)?.buttonList.buttons || [];
  assert.equal(buttons.length, 2, 'both links should be buttons');
  assert.match(buttons[0].onClick.openLink.url, /^https?:/);

  // A session with nothing to link to must not draw an empty button row.
  const bare = buildPayload('google', { ...base, links: {} }, {});
  assert.ok(!bare.cardsV2[0].card.sections[0].widgets.some((w) => w.buttonList), 'an empty button row is worse than none');
});

await test('Telegram addresses a chat, escapes what it sends, and stays under 4096', () => {
  const p = buildPayload('telegram', { ...base, title: 'a <script> & "quotes"' }, { chatId: '-1001234567890' });
  assert.equal(p.chat_id, '-1001234567890', 'a message with no chat id goes nowhere');
  assert.equal(p.parse_mode, 'HTML');
  assert.ok(p.disable_web_page_preview, 'a link preview would repeat the report page in the chat');
  // HTML parse mode means the summary is markup: a charter with an angle
  // bracket in it must not become a tag, and Telegram rejects the whole message
  // if it does.
  assert.match(p.text, /&lt;script&gt; &amp; &quot;quotes&quot;/, 'quotes are escaped too: the same escape fills a quoted href');
  assert.ok(!/<script>/.test(p.text), 'the charter was spliced in as markup');
  assert.ok(p.text.length <= 4000, `${p.text.length} is over Telegram's cap`);
  assert.match(p.text, /<a href="[^"]+">Open the report<\/a>/, 'the links should be anchors');
});

await test('Mattermost speaks its own dialect and Slack\'s at once', () => {
  const p = buildPayload('mattermost', base, { channel: 'qa', username: 'QA Wrap' });
  assert.equal(p.channel, 'qa');
  assert.equal(p.username, 'QA Wrap');
  assert.match(p.text, /#### POST \/api\/x/, 'the markdown half is what every server renders');
  assert.match(p.text, /\[Open the report\]\(/, 'links as markdown, not as raw URLs');
  const a = p.attachments[0];
  assert.equal(a.color, '#B5432B', 'a session with failures is the red one');
  assert.deepEqual(a.fields.map((f) => f.title), ['Problems', 'Events']);
  const clean = buildPayload('mattermost', { ...base, counts: { ...base.counts, failures: 0 } }, {});
  assert.equal(clean.attachments[0].color, '#2A7A3B', 'a clean session is the green one');
  assert.ok(!('channel' in clean), 'no channel means the webhook\'s own default, not an empty one');
});

console.log('\nnotify.js — a custom endpoint, for a bot nobody here has heard of');

await test('a template is filled from the summary', () => {
  const out = renderTemplate('{"title":"{{title}}","fails":"{{counts.failures}}"}', base);
  assert.deepEqual(JSON.parse(out), { title: defect.summary, fails: '1' });
});

await test('a missing placeholder becomes empty, not the word undefined', () => {
  const out = renderTemplate('{"x":"{{nope.at.all}}"}', base);
  assert.deepEqual(JSON.parse(out), { x: '' });
});

await test('a value with quotes or newlines still produces valid JSON', () => {
  const risky = { ...base, title: 'He said "no"\nand left \\ behind' };
  const out = renderTemplate('{"t":"{{title}}"}', risky);
  assert.doesNotThrow(() => JSON.parse(out), `template produced invalid JSON: ${out}`);
  assert.equal(JSON.parse(out).t, 'He said "no"\nand left \\ behind');
});

await test('a broken template is refused with a message about the template', () => {
  assert.throws(
    () => buildPayload('custom', base, { template: '{"t": {{title}}}' }),
    /did not produce valid JSON.*quotes/s
  );
});

console.log('\nnotify.js — routing by severity');

await test('a destination with a floor rejects what is below it', () => {
  const dest = { minSeverity: 'major' };
  assert.equal(passesFloor(dest, 'critical'), true);
  assert.equal(passesFloor(dest, 'major'), true);
  assert.equal(passesFloor(dest, 'moderate'), false);
  assert.equal(passesFloor(dest, 'minor'), false);
});

await test('no floor means everything, and a summary with no severity always goes', () => {
  assert.equal(passesFloor({}, 'minor'), true);
  assert.equal(passesFloor({ minSeverity: 'critical' }, null), true, 'a session summary is not a defect');
});

console.log('\nnotify.js — sending, against servers that behave like the real ones');

/** Impersonates each provider, including how each one signals a refusal. */
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ path: req.url, body });
    if (req.url === '/slack-ok') return res.writeHead(200).end('ok');
    // The one that catches everybody: Slack answers 200 and throws it away.
    if (req.url === '/slack-bad') return res.writeHead(200).end('invalid_payload');
    if (req.url === '/teams-ok') return res.writeHead(200).end('1');
    if (req.url === '/discord-ok') return res.writeHead(204).end();
    if (req.url === '/refuse') return res.writeHead(400).end('channel_not_found');
    // Telegram answers 200 whether it accepted the message or not; the truth is
    // in the body, which is exactly the trap `/slack-bad` covers for Slack.
    if (/\/bot[^/]+\/sendMessage$/.test(req.url)) {
      const chat = (() => { try { return JSON.parse(body).chat_id; } catch { return null; } })();
      return chat === 'bad-chat'
        ? res.writeHead(200).end(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }))
        : res.writeHead(200).end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    }
    if (req.url === '/hooks/mm-ok') return res.writeHead(200).end('ok');
    if (req.url === '/hooks/mm-bad') return res.writeHead(200).end(JSON.stringify({ id: 'web.incoming_webhook.channel_locked.app_error', message: 'This webhook is locked to a channel' }));
    if (req.url === '/gchat-ok') return res.writeHead(200).end(JSON.stringify({ name: 'spaces/AAA/messages/BBB' }));
    res.writeHead(200).end('ok');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

await test('plain http to another host is refused before anything is sent', async () => {
  await assert.rejects(
    () => send({ url: 'http://bots.example.test/hook', provider: 'slack' }, base),
    /must be https, or point at this machine/,
    'a webhook over http to a remote host would carry the report in the clear'
  );
  assert.equal(seen.length, 0, 'nothing should have been sent');
});

await test('a real Slack success is accepted', async () => {
  const out = await send({ url: `${origin}/slack-ok`, provider: 'slack' }, base);
  assert.equal(out.sent, true);
  assert.equal(out.provider, 'slack');
  const last = seen[seen.length - 1];
  assert.match(last.path, /slack-ok/);
  assert.ok(JSON.parse(last.body).blocks, 'Slack should have been sent Block Kit');
});

await test('a Slack 200 that says invalid_payload is a FAILURE, not a success', async () => {
  // The bug this whole file exists for. Slack answers 200 and throws the
  // message away; treating the status as the answer reports a delivery that
  // never happened.
  await assert.rejects(
    () => send({ url: `${origin}/slack-bad`, provider: 'slack' }, base),
    /Slack refused the message.*invalid_payload/s
  );
});

await test('Teams and Discord successes are recognised despite different answers', async () => {
  const teams = await send({ url: `${origin}/teams-ok`, provider: 'teams' }, base);
  assert.equal(teams.sent, true);
  assert.equal(JSON.parse(seen[seen.length - 1].body).attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');

  // Discord answers 204 with no body at all.
  const discord = await send({ url: `${origin}/discord-ok`, provider: 'discord' }, base);
  assert.equal(discord.sent, true);
  assert.equal(discord.status, 204);
});

await test('a refusal carries the reason the provider gave', async () => {
  await assert.rejects(
    () => send({ url: `${origin}/refuse`, provider: 'teams', label: 'Team channel' }, base),
    /Team channel refused the message \(400\): channel_not_found/
  );
});

await test('broadcast reports every destination separately', async () => {
  const results = await broadcast(
    [
      { id: 'a', label: 'Team channel', url: `${origin}/slack-ok`, provider: 'slack' },
      { id: 'b', label: 'Disabled one', url: `${origin}/slack-ok`, enabled: false },
      { id: 'c', label: 'Criticals only', url: `${origin}/slack-ok`, minSeverity: 'critical' },
      { id: 'd', label: 'No URL' },
    ],
    { ...base, severity: 'moderate' }
  );

  assert.equal(results.length, 2, 'a disabled destination and one with no URL should not appear at all');
  const skipped = results.find((r) => r.skipped);
  assert.ok(skipped, 'the criticals-only destination should be reported as skipped, not silently dropped');
  assert.match(skipped.skipped, /critical/);

  const delivered = results.find((r) => r.sent);
  assert.ok(delivered, 'the enabled destination should have been delivered to');
  assert.equal(delivered.label, 'Team channel');
});

await test('one broken destination does not stop the others', async () => {
  const results = await broadcast(
    [
      { id: 'x', label: 'Broken', url: 'not-a-url' },
      { id: 'y', label: 'Also broken', url: 'https://127.0.0.1:1/nope' },
    ],
    base
  );
  assert.equal(results.length, 2);
  results.forEach((r) => assert.equal(r.sent, false));
  results.forEach((r) => assert.ok(r.error, 'every failure needs a reason'));
});


console.log('\nnotify.js — the three that were added on 6 September');

await test('Telegram builds its endpoint from the token, and never from anywhere else', async () => {
  const { endpointFor } = await import('../background/notify.js');
  const url = endpointFor({ provider: 'telegram', token: 'A1:B2', chatId: '99' });
  assert.equal(url, 'https://api.telegram.org/botA1:B2/sendMessage', 'the host is not the tester\'s to choose by accident');
  // Both halves are required, and each says which one is missing.
  assert.throws(() => endpointFor({ provider: 'telegram', chatId: '99' }), /bot token/);
  assert.throws(() => endpointFor({ provider: 'telegram', token: 'A1:B2' }), /chat id/);
  // A self-hosted Bot API server is a real deployment, and then that base is
  // the only place it goes.
  assert.equal(
    endpointFor({ provider: 'telegram', url: 'https://tg.internal.test/', token: 'T', chatId: '1' }),
    'https://tg.internal.test/botT/sendMessage',
  );
});

await test('Telegram: a 200 carrying ok:false is a FAILURE, not a success', async () => {
  const before = seen.length;
  const good = await send({ provider: 'telegram', url: origin, token: 'T-OK', chatId: '99' }, base);
  assert.equal(good.sent, true);
  const sent = JSON.parse(seen[seen.length - 1].body);
  assert.equal(sent.chat_id, '99', 'the chat id is the address, not a decoration');
  assert.equal(sent.parse_mode, 'HTML');
  assert.match(seen[seen.length - 1].path, /\/botT-OK\/sendMessage$/, 'the token belongs in the path, once');

  await assert.rejects(
    () => send({ provider: 'telegram', url: origin, token: 'T-OK', chatId: 'bad-chat' }, base),
    /Telegram refused the message \(400\): Bad Request: chat not found/,
    'the provider\'s own reason is the only thing that says which of three things is wrong',
  );
  assert.ok(seen.length > before, 'the requests were made');
});

await test('Mattermost: ok is ok, and a locked webhook is a refusal in its own words', async () => {
  const out = await send({ provider: 'mattermost', url: `${origin}/hooks/mm-ok`, channel: 'qa' }, base);
  assert.equal(out.sent, true);
  assert.equal(out.provider, 'mattermost');
  const body = JSON.parse(seen[seen.length - 1].body);
  assert.equal(body.channel, 'qa');
  assert.ok(body.text.includes('####'), 'the markdown half every server renders');
  assert.ok(body.attachments[0].fields.length === 2, 'the richer half for servers that want it');

  await assert.rejects(
    () => send({ provider: 'mattermost', url: `${origin}/hooks/mm-bad` }, base),
    /Mattermost refused the message \(200\): This webhook is locked to a channel/,
  );
});

await test('Google Chat: the card is what goes over the wire', async () => {
  const out = await send({ provider: 'google', url: `${origin}/gchat-ok` }, base);
  assert.equal(out.sent, true);
  const body = JSON.parse(seen[seen.length - 1].body);
  assert.ok(body.cardsV2?.[0]?.card?.sections?.[0]?.widgets?.length, 'the card was not sent');
  assert.ok(typeof body.text === 'string', 'the preview line was not sent');
});

await test('the three new providers are recognised from a URL, and none steals another\'s', () => {
  assert.equal(detectProvider('https://api.telegram.org/bot123:abc/sendMessage'), 'telegram');
  assert.equal(detectProvider('https://mattermost.example.test/hooks/xyz123'), 'mattermost');
  assert.equal(detectProvider('https://chat.googleapis.com/v1/spaces/AAA/messages?key=k'), 'google');
  assert.equal(detectProvider('https://hooks.slack.com/services/T/B/x'), 'slack', 'Slack must not be read as Mattermost');
  assert.equal(detectProvider('https://discord.com/api/webhooks/1/x'), 'discord');
  assert.equal(detectProvider('https://example.test/anything'), 'custom');
  for (const id of ['slack', 'teams', 'discord', 'google', 'telegram', 'mattermost', 'custom']) {
    assert.ok(PROVIDERS.some((p) => p.id === id), `${id} is not in the table Settings lists`);
  }
});

await test('one broken destination among the six does not stop the rest', async () => {
  const results = await broadcast([
    { label: 'Slack', provider: 'slack', url: `${origin}/slack-ok` },
    { label: 'Telegram', provider: 'telegram', url: origin, token: 'T-OK', chatId: 'bad-chat' },
    { label: 'Mattermost', provider: 'mattermost', url: `${origin}/hooks/mm-ok` },
    { label: 'Google Chat', provider: 'google', url: `${origin}/gchat-ok` },
  ], base);
  assert.equal(results.length, 4);
  assert.equal(results.filter((r) => r.sent).length, 3, 'three should have gone');
  const bad = results.find((r) => r.label === 'Telegram');
  assert.equal(bad.sent, false);
  assert.match(bad.error, /chat not found/, 'the failure carries the provider\'s reason, not ours');
});

await test('"Post here when": a channel posts only for the events it picked; one that never picked posts for all', async () => {
  const mk = (id, events) => ({ id, label: id, url: `${origin}/slack-ok`, provider: 'slack', ...(events ? { events } : {}) });
  const chans = [mk('done-only', { done: true, fail: false, report: false }), mk('fail-only', { done: false, fail: true, report: false }), mk('report-only', { done: false, fail: false, report: true }), mk('legacy')];
  const quiet = await broadcast(chans, { ...base, on: ['done'] });
  const said = (rs) => rs.filter((r) => r.sent).map((r) => r.label).sort().join();
  assert.equal(said(quiet), 'done-only,legacy', 'a session with no failure reaches "done" channels and the older channel with no events');
  assert.ok(quiet.filter((r) => r.skipped).every((r) => /not subscribed/.test(r.skipped)));
  const bad = await broadcast(chans, { ...base, on: ['done', 'fail'] });
  assert.equal(said(bad), 'done-only,fail-only,legacy');
  const filed = await broadcast(chans, { ...base, on: ['done', 'report'] });
  assert.equal(said(filed), 'done-only,legacy,report-only');
});

await test('summarise derives the events: done always, fail on failures or a defect, report when a link comes with it', () => {
  const session = { charter: 'c', startedAt: 0, startUrl: 'https://x.test/' };
  assert.deepEqual(summarise({ session, events: [] }).on, ['done']);
  assert.deepEqual(summarise({ session, events: [{ kind: 'console', level: 'error' }] }).on, ['done', 'fail']);
  assert.deepEqual(summarise({ session, events: [], links: { ticket: 'https://j.test/QA-1' } }).on, ['done', 'report']);
});

await test('r1-13-6: a Telegram link cannot break out of its href, and only http(s) links stay links', () => {
  const links = {
    quote: `https://example.test/r?a="1"&b='2'`,
    breakout: 'https://example.test/" onmouseover="alert(1)',
    js: 'javascript:alert(1)',
    mixed: 'JaVaScRiPt:alert(1)',
    space: '  javascript:alert(1)',
    tab: 'java\tscript:alert(1)',
    data: 'data:text/html,<b>x</b>',
    vb: 'vbscript:msgbox(1)',
    file: 'file:///c:/windows/win.ini',
    ok: 'HTTPS://example.test/ok',
  };
  const { text } = buildPayload('telegram', { ...base, links }, { chatId: '1' });
  const hrefs = [...text.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)];
  assert.deepEqual(hrefs.map((m) => m[2]).sort(), ['breakout', 'ok', 'quote'], 'only http(s) addresses stay anchors');
  for (const m of hrefs) assert.ok(!/["'<>]/.test(m[1]), `a raw quote or bracket reached an href: ${m[1]}`);
  assert.ok(!/onmouseover="/.test(text), 'the attribute breakout is escaped');
  assert.ok(!/(?:java\s*script|vbscript|data|file):/i.test(text.replace(/<a href="[^"]*">/g, '')), 'a dropped link leaves its label only, never its address');
  for (const label of ['js', 'mixed', 'space', 'tab', 'data', 'vb', 'file']) assert.ok(text.includes(label), `${label} is kept as plain text`);
});

await test('a Telegram destination with a token and no URL is still delivered to', async () => {
  const results = await broadcast([{ id: 't', label: 'tg', provider: 'telegram', url: `${origin}`, token: 'x', chatId: '1' }], base);
  assert.equal(results.length, 1);
});

server.close();

console.log('\nnotify.js — r2-03-2 / r2-11-5: page text in a Mattermost payload');

await test('Mattermost: @channel, an image, a javascript: link and a url with ) and a space are neutralised, in text and attachment', () => {
  const ZW = String.fromCharCode(0x200b);
  const base = summarise({ session, events, defect, links: {} });
  const s = { ...base, title: '@channel ![](http://x) look', where: 'ping @all and @here', expected: '[a](javascript:alert(1))', links: { Report: 'http://x.test/a)b c', Bad: 'javascript:alert(1)' } };
  const p = buildPayload('mattermost', s, {});
  for (const md of [p.text, p.attachments[0].text, p.attachments[0].title]) {
    assert.ok(!/@(all|channel|here)/i.test(md), 'a live mention reached the payload: ' + md);
    assert.ok(!/(^|[^\\])!\[/.test(md), 'an image reached the payload: ' + md);
    assert.ok(!/\]\(javascript:/i.test(md), 'a javascript: link reached the payload: ' + md);
  }
  assert.ok(p.text.includes('@' + ZW + 'channel'), p.text);
  assert.ok(p.text.includes('[Report](http://x.test/a%29b%20c)'), p.text);
  assert.ok(!p.text.includes('](javascript') && p.text.includes('Bad'));
});

await test('r3-14-4: a link target cannot end early: ( ) [ ] < > quotes, backtick and backslash are percent-encoded', () => {
  const base = summarise({ session, events, defect, links: {} });
  const p = buildPayload('mattermost', { ...base, links: { Odd: "http://x.test/a(b)c[d]e<f>g'h`i" + '"k l' } }, {});
  const at = p.text.indexOf('[Odd](');
  assert.ok(at >= 0, p.text);
  const target = p.text.slice(at + 6, p.text.indexOf(')', at + 6));
  for (const c of ['(', '[', ']', '<', '>', '"', "'", '`', ' ']) assert.ok(!target.includes(c), `a raw ${c} survived in the target: ${target}`);
  for (const code of ['%28', '%29', '%5B', '%5D']) assert.ok(p.text.includes(code), `${code} missing: ${p.text}`);
  assert.ok(p.text.indexOf(')', at + 6) === at + 6 + target.length && !p.text.slice(at + 6).startsWith(target + '))'), 'the target ends at its own closing parenthesis');
});

/* ── council-1010 round 4: r4-04-1 (D-1010-80) the chat summary leaves machine notes out ── */
await test('r4-04-1: a technique, capture-gap, split or dropped note is not in the chat summary; a tester note is counted', () => {
  const machine = [
    { kind: 'note', ts: T0 + 10, tag: 'technique', text: 'Technique: designed price#p:valid-in-range' },
    { kind: 'note', ts: T0 + 11, tag: 'capture-gap', text: 'Capture gap: events that could not be stored' },
    { kind: 'note', ts: T0 + 12, tag: 'split', text: 'MACHINE-SPLIT' },
    { kind: 'note', ts: T0 + 13, tag: 'dropped', text: 'MACHINE-DROPPED' },
    { kind: 'note', ts: T0 + 14, tag: 'bug', text: 'TESTER-OWN-NOTE' },
  ];
  const s = JSON.stringify(summarise({ session, events: [...events, ...machine], defect: null, links: {} }));
  assert.ok(!/price#p|MACHINE-|could not be stored/.test(s), s);
  assert.equal(summarise({ session, events: [...events, ...machine], defect: null, links: {} }).counts.notes, events.filter((e) => e.kind === 'note').length + 1, 'only the tester note is counted');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
