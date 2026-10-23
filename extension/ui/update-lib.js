/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Pure helpers for the update page and the Settings > Updates tab (no DOM, so node tests load it as is).
 *   parseNotes   release-note text -> sections (added / changed / fixed / other). Plain text only: markup is dropped, never parsed.
 *   detectOS     'win' | 'mac' | 'linux' from navigator.userAgentData / platform
 *   helperFile   the file to run for that OS, inside the QA Wrap folder
 *   probe        is the native updater host installed? (op 'ping'; any answer, even an error, means yes)
 *   runUpdate    one connectNative round trip with stage events; rejects with {missing:true} when the host is not there
 * Lazy: only the update page and the Updates tab import it.
 */
export const HOST = 'com.njburrito.qawrap.updater';
export const STAGES = ['downloading', 'checking', 'installing', 'reloading'];

const clean = (x) => x.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1').replace(/[*_`<>]/g, '').trim();
/** @returns {'added'|'fixed'|'changed'|''} */
const kindOf = (/** @type {string} */ s) => (/^(added|new)\b/i.test(s) ? 'added' : /^(fixed|fixes|fix)\b/i.test(s) ? 'fixed' : /^(changed|changes|improved|improvements?)\b/i.test(s) ? 'changed' : '');

/** @returns {{kind: 'added'|'changed'|'fixed'|'other', items: string[]}[]} in the order Added, Changed, Fixed, other; empty sections left out. */
export function parseNotes(text) {
  /** @type {Record<'added'|'changed'|'fixed'|'other', string[]>} */
  const by = { added: [], changed: [], fixed: [], other: [] };
  /** @type {'added'|'changed'|'fixed'|'other'} */
  let cur = 'other', count = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || count >= 60) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { cur = kindOf(clean(h[1])) || 'other'; continue; }
    const li = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    let t = clean(li ? li[1] : line);
    /** @type {'added'|'changed'|'fixed'|'other'} */
    let kind = cur;
    const pre = /^([A-Za-z]+):\s+(.*)$/.exec(t);
    if (pre && kindOf(pre[1])) { kind = kindOf(pre[1]) || kind; t = pre[2]; }
    if (t) { by[kind].push(t); count++; }
  }
  return (/** @type {('added'|'changed'|'fixed'|'other')[]} */ (['added', 'changed', 'fixed', 'other'])).filter((k) => by[k].length).map((kind) => ({ kind, items: by[kind] }));
}

export function detectOS(/** @type {any} */ nav = globalThis.navigator) {
  const p = String(nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '');
  return /win/i.test(p) ? 'win' : /mac|iphone|ipad/i.test(p) ? 'mac' : 'linux';
}

export const helperFile = (os) => (os === 'win' ? { name: 'install.cmd', path: 'updater\\install.cmd' } : { name: 'install.sh', path: 'updater/install.sh' });

/** The exact command to paste in a terminal opened in the QA Wrap folder: installs quietly, never asks anything. */
export const helperCommand = (os) => (os === 'win' ? 'updater\\install.cmd -Quiet' : 'bash updater/install.sh --quiet');

/** The plain-text steps the "Copy steps" button puts on the clipboard. `t` is the i18n function. */
export function stepsText(os, t) {
  return [t('update.upd2.stepOpen'), t(os === 'win' ? 'update.upd2.stepRunWin' : 'update.upd2.stepRunUnix'), t('update.upd2.stepBack')].map((s, i) => `${i + 1}. ${s}`).join('\n') + `\n\n${t('update.upd2.orCommand')}\n${helperCommand(os)}`;
}

/** True when the native updater host answers. Needs the optional nativeMessaging permission (the caller asks for it inside a press). */
export function probe(api = globalThis.chrome, ms = 8000) {
  return new Promise((resolve) => {
    if (!api?.runtime?.sendNativeMessage) return resolve(false);
    const t = setTimeout(() => resolve(false), ms);
    try {
      api.runtime.sendNativeMessage(HOST, { op: 'ping' }, (r) => { clearTimeout(t); resolve(!api.runtime.lastError && !!r); });
    } catch { clearTimeout(t); resolve(false); }
  });
}

/** Run the update through the host. onStage(name) for each progress message (older hosts send none). Resolves the final answer {ok, error?}. */
export function runUpdate(api, msg, onStage = (/** @type {string} */ _s) => {}) {
  return new Promise((resolve, reject) => {
    if (!api?.runtime?.connectNative) return reject({ missing: true });
    let port, done = false;
    try { port = /** @type {any} */ (api.runtime).connectNative(HOST); } catch { return reject({ missing: true }); }
    port.onMessage.addListener((m) => {
      if (m && m.stage) return onStage(m.stage);
      done = true;
      resolve(m || { ok: false });
    });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const e = api.runtime.lastError; // host not registered: Chrome says so here, before any answer
      reject({ missing: true, error: e && e.message });
    });
    port.postMessage(msg);
  });
}
