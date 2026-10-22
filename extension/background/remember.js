/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// Remember this site, the shortcut wake, the name asked at stop (features-1010 lane O) and the two opt-in autopilot powers (1011). Kept small: the worker graph is at its ceiling.

/** The powers stay off until the on-page recording dot ships: they never run unseen. */
const dotShips = (site) => site.SITE_SCRIPTS.some((s) => s.js.includes('content/autopilot.js'));
/** @type {(k: string | string[]) => Promise<Record<string, any>>} */
const sget = (k) => chrome.storage.session.get(k);
/** @type {(k: string | string[]) => Promise<Record<string, any>>} */
const lget = (k) => chrome.storage.local.get(k);

/** Opt-in, per site. Wakes a window the first time it opens a remembered, allowed site, once per window per browser run, so a deliberate sleep stays asleep. */
export async function autoWake(d, { armed, site, arm }) {
  if (d.frameId !== 0) return;
  const [{ rememberedSites: r }, { rememberWoke: w = [] }] = /** @type {[{ rememberedSites?: string[] }, { rememberWoke?: number[] }]} */ (await Promise.all([chrome.storage.local.get('rememberedSites'), chrome.storage.session.get('rememberWoke')]));
  if (!r?.length || !r.includes(site.originPattern(d.url)) || !(await site.hasSiteAccess(d.url)) || !(await armed.consentCurrent())) return;
  const win = (await chrome.tabs.get(d.tabId).catch(() => null))?.windowId;
  if (win == null || w.includes(win)) return;
  await chrome.storage.session.set({ rememberWoke: [...w, win] });
  if (!(await armed.isArmedWindow(win))) await arm({ windowId: win });
}

/** A shortcut in a window that was never woken. 'woke': awake now (it was, or the allowed site woke it). 'open-popup': the site is not allowed yet, so the popup opened on "Test this site" (no permission prompt here). False: it could not open, so the caller says the one next step. */
export async function wakeForShortcut(tab, { armed, site, arm }) {
  if (await armed.isArmedWindow(tab?.windowId)) return 'woke';
  if (await site.hasSiteAccess(tab?.url)) { await arm({ windowId: tab.windowId }); return 'woke'; }
  try { await chrome.action.openPopup(); return 'open-popup'; } catch { return false; }
}

/** The one-press start leaves the test unnamed; the popup asks for the name after the stop. */
export async function renameSession({ sessionId, charter }, { getSession, putSession, rememberSession }) {
  const s = await getSession(sessionId);
  const name = String(charter || '').trim().slice(0, 120);
  if (!s || !name) return false;
  s.charter = name;
  await putSession(s);
  rememberSession(s);
  return true;
}

/** Rule 5: the pin the retention cleanup honours. Flipping it also forgets an old purge notice, so a session un-kept later is warned again. */
export async function keepSession({ sessionId, keep }, { getSession, putSession, rememberSession }) {
  const s = await getSession(sessionId);
  if (!s) return false;
  s.keep = keep === true;
  delete s.purgeNotice;
  await putSession(s);
  rememberSession(s);
  return true;
}

/** Rule 5: sessions a crash closed, kept (id, saved event count, time; no content) until the first popup open shows them. */
export async function noteInterrupted(closed, countEvents) {
  const rows = await Promise.all(closed.map(async (s) => ({ id: s.id, n: await countEvents(s.id).catch(() => 0), at: s.endedAt })));
  await chrome.storage.local.set({ interrupted: [...((await lget('interrupted')).interrupted || []), ...rows].slice(-5) });
}

/** Rule 5: tell the owner (a count, never content) a week before the cleanup would take sessions; the mark on each row is what lets the cleanup take it later. */
export async function warnPurge(list, { putSession, rememberSession, say }) {
  for (const s of list) { s.purgeNotice = Date.now(); await putSession(s); rememberSession(s); }
  if (list.length) await say(list.length);
}

/** Rule 5 (cap): a recording that reached its row limit goes on as "part N" of the same test in the same window: same charter, parent link, no click. */
export async function rollPart(id, { getSession, putSession, startSession, rememberSession, live }) {
  const old = await getSession(id);
  if (!old || old.status !== 'recording' || !(await live()).includes(id)) return null;
  const part = (old.part || 1) + 1;
  const next = await startSession({ charter: `${String(old.charter).replace(/ \(part \d+\)$/, '')} (part ${part})`, tabId: old.tabId, env: old.env, startUrl: old.startUrl });
  Object.assign(next, { part, partOf: old.partOf || old.id, previous: old.id });
  await putSession(next);
  rememberSession(next);
  return next;
}

/** One chain per window: a second navigation waits for the first to finish, so two tabs opening together start one session. */
const starting = new Map();
/** The dot's own switch is stored twice (the local key and the settings object): either one saying "off" keeps both powers off. */
const dotOn = async (deps, local) => local.pageIndicator !== false && (await deps.dotOn?.().catch(() => true)) !== false;
/** The title month follows the UI language: the Arabic UI gets an Arabic month. */
async function dateTag() {
  const { qawLanguage: pick } = (await chrome.storage.sync?.get('qawLanguage').catch(() => null)) || {};
  return pick === 'ar' || (pick !== 'en' && /^ar/i.test(chrome.i18n?.getUILanguage?.() || '')) ? 'ar-JO-u-nu-latn' : 'en-GB';
}

/** Second opt-in tick, per site. The first load of a ticked, allowed site in an awake window starts a session by itself, once per window per run, never over a live session, never inside the pause and never with the dot switched off. It does not wake a sleeping window. */
export async function autoStart(d, deps) {
  if (d.frameId !== 0 || !dotShips(deps.site)) return;
  const win = (await chrome.tabs.get(d.tabId).catch(() => null))?.windowId;
  if (win == null) return;
  const run = (starting.get(win) || Promise.resolve()).catch(() => {}).then(() => startIn(win, d, deps));
  starting.set(win, run);
  try { await run; } finally { if (starting.get(win) === run) starting.delete(win); }
}
async function startIn(win, d, { armed, site, start, live, putSession, ...deps }) {
  const [local, { autoPauseUntil: until = 0, autoWoke: w = [] }] = await Promise.all([lget(['autoStartSites', 'pageIndicator']), sget(['autoPauseUntil', 'autoWoke'])]);
  if (!local.autoStartSites?.includes(site.originPattern(d.url)) || !(await dotOn(deps, local)) || Date.now() < until || !(await site.hasSiteAccess(d.url)) || !(await armed.consentCurrent())) return;
  if (w.includes(win) || !(await armed.isArmedWindow(win)) || (await live(win))) return;
  const now = new Date();
  const charter = `${new URL(d.url).host} ${now.toLocaleDateString(await dateTag(), { day: 'numeric', month: 'short' })} ${now.toTimeString().slice(0, 5)}`;
  const s = await start({ tabId: d.tabId, charter, startUrl: d.url });
  await chrome.storage.session.set({ autoWoke: [...((await sget('autoWoke')).autoWoke || []), win] }); // after the start resolved: a start that threw keeps the window's one attempt
  s.autoStarted = true;
  await putSession(s);
  await chrome.storage.session.set({ autoStarted: { ...(await sget('autoStarted')).autoStarted, [s.id]: s.startedAt } });
  await chrome.alarms.create('qaw-autoidle', { periodInMinutes: 5 });
}

/** Every 5 minutes while an auto-started session runs: stop the ones with no event for 30 minutes (stopReason 'idle'), forget the ones already over, and clear the alarm when none is left. */
export async function idleStop({ lastEventTs, stopSession, getSession, putSession }) {
  const gone = [];
  for (const [id, at] of Object.entries((await sget('autoStarted')).autoStarted || {})) {
    const s = await getSession(id);
    if (s?.status === 'recording' && Date.now() - ((await lastEventTs(id)) ?? at) > 30 * 6e4) {
      s.stopReason = 'idle';
      await putSession(s);
      await stopSession(id);
    }
    if (s?.status !== 'recording' || s.stopReason === 'idle') gone.push(id);
  }
  const left = (await sget('autoStarted')).autoStarted || {};
  for (const id of gone) delete left[id];
  await chrome.storage.session.set({ autoStarted: left });
  if (!Object.keys(left).length) await chrome.alarms.clear('qaw-autoidle');
}

/** A session was deleted: its auto-start and auto-screenshot rows go with it. */
export async function forget(id) {
  try {
    const all = await sget(['autoStarted', 'autoShotState']);
    for (const k of Object.keys(all)) delete all[k][id];
    await chrome.storage.session.set(all);
  } catch { /* session storage unavailable: the idle sweep prunes the entry */ }
}

/** The page asked for a screenshot on a new kind of error. Everything is re-checked here, and again right before and after the capture (`gate`); the page only asks. Answers { ok } or { ok: false, reason }. */
/** @type {Promise<any>} */
let shots = Promise.resolve();
export const autoShot = (msg, sender, deps) => (shots = shots.catch(() => {}).then(() => shotNow(msg, sender, deps)));
/** Why this tab may not be photographed now, or '' when it may: awake, ticked, allowed, dot on, live session, the active tab of a focused window. */
async function gate(tab, { armed, site, live, ...deps }) {
  if (!tab || !(await armed.isArmedWindow(tab.windowId))) return 'asleep';
  const local = await lget(['autoShotSites', 'pageIndicator']);
  if (!dotShips(site) || !(await dotOn(deps, local)) || !local.autoShotSites?.includes(site.originPattern(tab.url)) || !(await site.hasSiteAccess(tab.url)) || !(await armed.consentCurrent())) return 'off';
  if (!(await live(tab.windowId)) || !tab.active) return 'inactive';
  return (await chrome.windows.get(tab.windowId).catch(() => null))?.focused ? '' : 'unfocused';
}
/** @param {{ key?: string } | undefined} msg @param {any} sender @param {any} deps */
async function shotNow(msg, sender, deps) {
  const key = msg?.key;
  const no = (reason) => ({ ok: false, reason });
  if (!sender?.tab || sender.frameId || typeof key !== 'string' || key.length > 200) return no('off');
  const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
  const why = await gate(tab, deps);
  if (why) return no(why);
  const sid = await deps.live(tab.windowId);
  const { autoShotState: all = {} } = await sget('autoShotState');
  const { n = 0, lastAt = 0, keys = [] } = all[sid] || {};
  const mark = await keyMark(key);
  if (n >= 10) return no('cap');
  if (keys.includes(mark) || Date.now() - lastAt < 20e3) return no('rate');
  await chrome.storage.session.set({ autoShotState: { ...all, [sid]: { n: n + 1, lastAt: Date.now(), keys: [...keys, mark] } } });
  // Asked again by the capture, after the overlays are hidden and before Chrome photographs: the same tab, still active, still in a focused window, same origin, still allowed.
  const same = async () => { const t = await chrome.tabs.get(tab.id).catch(() => null); return !!t && t.windowId === tab.windowId && deps.site.originPattern(t.url) === deps.site.originPattern(tab.url) && !(await gate(t, deps)); };
  return (await deps.shot(tab, key, same)) ? { ok: true } : no('moved');
}
/** The rate list keeps a short hash of the page-built key, not the key (it carries a lower-cased console message shape). */
async function keyMark(key) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(h).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
