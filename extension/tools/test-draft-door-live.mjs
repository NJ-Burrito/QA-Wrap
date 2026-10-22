/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-075 bytes, through the real caller: real Chrome, the unpacked extension, the worker's own
 * message handlers, the offscreen document, IndexedDB. The answers are compared with what the
 * core functions give when called directly in the same page.
 *
 *   node tools/test-draft-door-live.mjs
 *
 * Not in scripts.test (it needs a headed Chrome, like test-boot-smoke); run it with the smoke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { EXT, profile } from './lib-paths.mjs';

const PROFILE = profile('.draft-door-s1001b-profile');
const failures = [];
let passed = 0;
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

fs.rmSync(PROFILE, { recursive: true, force: true });
console.log('draft door, real Chrome');
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--window-position=60,60', '--window-size=1000,700', '--no-first-run', '--no-default-browser-check'],
});
try {
  const mgr = ctx.pages()[0] || (await ctx.newPage());
  await mgr.goto('chrome://extensions');
  await mgr.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
  (ctx.serviceWorkers().find((w) => w.url().includes(id)) || (await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id), timeout: 10000 })));
  await mgr.waitForTimeout(2500);

  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const out = await page.evaluate(async () => {
    const url = 'https://example.gov/apply';
    const T0 = 1_700_000_000_000;
    const session = { id: 's_draftdoor', charter: 'Submit an application with an expired document', startedAt: T0, endedAt: T0 + 12000, startUrl: url, env: { viewport: '1920x1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'en' }, status: 'stopped' };
    const events = [
      { sessionId: session.id, kind: 'nav', ts: T0 + 100, url, frameUrl: url },
      { sessionId: session.id, kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Send', locator: "getByRole('button', { name: 'Send', exact: true })", framePrefix: '', frameUrl: url, tag: 'button' },
      { sessionId: session.id, kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380, error: false, frameUrl: url },
      { sessionId: session.id, kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500', frameUrl: url },
    ];
    const db = await import(chrome.runtime.getURL('core/db.js'));
    await db.putSession(session);
    await db.appendEvents(events);
    const stored = await db.getEvents(session.id);
    const [art, fmt, jt, ev] = await Promise.all(['artifact', 'formats', 'jira-templates', 'events'].map((m) => import(chrome.runtime.getURL(`core/${m}.js`))));
    const ask = async (msg) => { const r = await chrome.runtime.sendMessage(msg); return r && 'ok' in r ? (r.ok ? r.result : { __error: r.error }) : r; };
    return {
      count: stored.length,
      title: { via: await ask({ type: 'UQA_TICKET_TITLE', sessionId: session.id }), direct: fmt.title(session, stored) },
      gone: await ask({ type: 'UQA_TICKET_TITLE', sessionId: 'nope' }),
      story: { via: await ask({ type: 'UQA_JIRA_DRAFT', sessionId: session.id, kind: 'story' }), direct: JSON.parse(JSON.stringify(jt.draft('story', session, stored))) },
      cross: await ask({ type: 'UQA_CROSS_BROWSER', sessionId: session.id }),
      spec: art.buildPlaywrightSpec(session, stored),
    };
  });
  check(out.count === 4, 'the fixture session is in IndexedDB', String(out.count));
  check(typeof out.title.via === 'string' && out.title.via === out.title.direct, 'UQA_TICKET_TITLE through the worker and the offscreen door equals title()', JSON.stringify(out.title));
  check(out.gone === null, 'UQA_TICKET_TITLE for a gone session is null', JSON.stringify(out.gone));
  check(!out.story.via?.__error && JSON.stringify(out.story.via) === JSON.stringify(out.story.direct), 'UQA_JIRA_DRAFT (story) equals draft() called directly', JSON.stringify(out.story).slice(0, 300));
  const files = out.cross?.files;
  const specFile = Array.isArray(files) ? files.find((f) => /spec/i.test(f.path || f.name || '')) : null;
  check(!out.cross?.__error && Array.isArray(files) && files.length > 0, 'UQA_CROSS_BROWSER answers with a project', JSON.stringify(out.cross).slice(0, 300));
  check(!!specFile && JSON.stringify(specFile).includes('getByRole'), 'the project carries the spec built behind the door', JSON.stringify(files?.map((f) => f.path || f.name)));
} catch (err) {
  check(false, 'the live draft-door run reached the end', err.message);
} finally {
  await ctx.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
