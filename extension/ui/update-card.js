/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * "Version X is available": one card on the popup and the Settings page, from the state the worker stored under `qawUpdate`
 * (background/worker-lifecycle.js checkUpdates, core/update-check.js). A classic script, loaded after i18n on both pages.
 *
 * Rules: updating is never forced. "Not now" hides that version until the browser next starts (key qawUpdateDismissed in storage.session); the card shows again for the next version or the next start.
 * "Update" asks the optional nativeMessaging permission (inside the press), then opens whatsnew/whatsnew.html?update=<version>, which runs the native host; without the host it downloads the zip and shows three steps.
 * The release notes are remote text: they reach the page only through textContent, one element per line. Never innerHTML.
 * Also wires the Settings switch #check-updates (key checkUpdates, absent = on), when the page has it.
 */
(function () {
  const KEY = 'qawUpdate';
  const DISMISSED = 'qawUpdateDismissed';
  const READY = 'qawUpdateReady'; // set by the worker on runtime.onUpdateAvailable: the store build is staged, a restart applies it
  const TOKEN = 'qawUpdateToken'; // optional read-only GitHub token for a private repo; never sent anywhere but api.github.com
  const BADGE = 'NEW';
  const flag = (on) => chrome.storage.session?.set?.({ 'uqa.updateNew': on })?.catch?.(() => {}); // the idle-badge flag paintBadge reads

  const num = (v) => String(v ?? '').replace(/^v/, '').split('.').map(Number);
  /** True when `a` is a clean release above `b` (numeric: 3.5.10 > 3.5.9). Same rule as core/update-check.js isNewer. */
  function newer(a, b) {
    const x = num(a), y = num(b);
    if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isInteger(n))) return false;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  }

  /** The release the card should offer, or null: newer than this build, and not dismissed. */
  function pending(state, dismissed, current) {
    const l = state && state.latest;
    return l && newer(l.version, current) && l.version !== dismissed ? l : null;
  }

  /** Release-note text -> [{tag, text}] (h4, li, p). Plain text only; the minimal markdown marks are dropped, nothing is parsed as HTML. */
  function notesBlocks(text) {
    const out = [];
    const clean = (x) => x.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1').replace(/[*_`]/g, '').trim();
    for (const raw of String(text ?? '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      const li = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      const text1 = clean(h ? h[1] : li ? li[1] : line);
      if (text1) out.push({ tag: h ? 'h4' : li ? 'li' : 'p', text: text1 });
      if (out.length >= 60) break;
    }
    return out;
  }

  const tr = (k, v) => (globalThis.QAWi18n ? QAWi18n.t(k, v) : k);
  const open = (url) => { try { chrome.tabs.create({ url }); } catch { window.open(url, '_blank', 'noopener'); } };
  /** Save the zip into Downloads (chrome.downloads). A private repo needs the pasted token and the API asset URL; any failure falls back to the release page. */
  async function download(rel) {
    try {
      const tok = (await chrome.storage.local.get(TOKEN))[TOKEN];
      const priv = tok && rel.zipApi;
      await chrome.downloads.download({ url: priv ? rel.zipApi : rel.zip, filename: `qa-wrap-${rel.version}.zip`, conflictAction: 'uniquify', ...(priv ? { headers: [{ name: 'Accept', value: 'application/octet-stream' }, { name: 'Authorization', value: `Bearer ${tok}` }] } : {}) });
    } catch { open(rel.url); }
  }
  const isStore = () => !!chrome.runtime.getManifest().update_url;

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function render(rel, host, ready) {
    const card = el('div', null, 'state-banner is-info update-card');
    card.id = 'update-card';
    card.setAttribute('role', 'status');
    const body = el('div', null, 'state-banner-text');
    body.append(el('p', tr('update.available', { version: rel.version }), 'state-banner-line'));
    const more = el('details', null, 'update-notes');
    more.append(el('summary', tr('update.whatsNew')));
    const blocks = notesBlocks(rel.notes);
    if (!blocks.length) more.append(el('p', tr('update.noNotes')));
    let ul = null;
    for (const b of blocks) {
      if (b.tag !== 'li') { ul = null; more.append(el(b.tag, b.text)); continue; }
      if (!ul) { ul = el('ul'); more.append(ul); }
      ul.append(el('li', b.text));
    }
    body.append(more);
    const steps = el('ol', null, 'update-steps');
    steps.hidden = true;
    for (const k of ['update.step1', 'update.step2', 'update.step3']) steps.append(el('li', tr(k)));
    body.append(steps);
    const go = el('button', tr(ready ? 'update.restart' : 'update.update'), 'btn btn-sm');
    go.type = 'button';
    go.id = 'update-go'; // e1022: the ⋯ menu and the Updates tab press this same button
    const later = el('button', tr('update.notNow'), 'btn btn-sm btn-quiet');
    later.type = 'button';
    let restart = !!ready;
    go.addEventListener('click', async () => {
      if (restart) return void chrome.runtime.reload();
      if (isStore() && chrome.runtime.requestUpdateCheck) {
        const r = await Promise.resolve(chrome.runtime.requestUpdateCheck()).catch(() => null);
        if ((r && r.status || (Array.isArray(r) ? r[0] : r)) === 'update_available') { restart = true; go.textContent = tr('update.restart'); return; }
      }
      if (isStore()) return void open(rel.url);
      const granted = rel.zip ? await Promise.resolve(chrome.permissions.request({ permissions: ['nativeMessaging'] })).catch(() => false) : false; // first await: still inside the press
      await chrome.storage.local.set({ qawPendingNotes: { version: rel.version, url: rel.url, zip: rel.zip, zipApi: rel.zipApi || '', sha256: rel.sha256 || '', notes: rel.notes } }); // the What's new page reads it
      if (granted) return void open(chrome.runtime.getURL(`whatsnew/whatsnew.html?update=${encodeURIComponent(rel.version)}`));
      steps.hidden = false;
      if (rel.zip) download(rel); else open(rel.url);
    });
    later.addEventListener('click', async () => {
      await chrome.storage.session.set({ [DISMISSED]: rel.version });
      flag(false);
      card.remove();
      if ((await chrome.action.getBadgeText({}).catch(() => '')) === BADGE) chrome.action.setBadgeText({ text: '' });
    });
    card.append(body, go, later);
    host.prepend(card);
    return card;
  }

  async function paint(host, force) { // force: show it even after "Not now" (the Updates tab)
    document.getElementById('update-card')?.remove();
    const s = { ...(await chrome.storage.local.get([KEY, READY])), ...(await chrome.storage.session.get(DISMISSED)) };
    const cur = chrome.runtime.getManifest().version;
    const ready = newer(s[READY], cur) && s[READY] !== s[DISMISSED];
    const rel = pending(s[KEY], force ? '' : s[DISMISSED], cur) || (ready ? { version: String(s[READY]), url: '', zip: '', notes: '' } : null);
    if (rel) return render(rel, host, ready && rel.version === String(s[READY]));
    flag(false);
    if ((await chrome.action.getBadgeText({}).catch(() => '')) === BADGE) chrome.action.setBadgeText({ text: '' }); // updated, or dismissed elsewhere
    return null;
  }

  async function wireSwitch() {
    const box = document.getElementById('check-updates');
    if (!box) return;
    box.checked = (await chrome.storage.local.get('checkUpdates')).checkUpdates !== false;
    box.addEventListener('change', () => (box.checked ? chrome.storage.local.remove('checkUpdates') : chrome.storage.local.set({ checkUpdates: false })));
    const tok = document.getElementById('update-token'); // masked field: the saved token is never shown back, only "saved"
    const status = document.getElementById('update-token-status');
    if (!tok) return;
    const show = async () => { const has = !!(await chrome.storage.local.get(TOKEN))[TOKEN]; status.textContent = has ? tr('update.upd1022.tokenSaved') : ''; document.getElementById('update-token-clear').hidden = !has; };
    document.getElementById('update-token-save').addEventListener('click', async () => { const v = tok.value.trim(); if (v) await chrome.storage.local.set({ [TOKEN]: v }); tok.value = ''; show(); });
    document.getElementById('update-token-clear').addEventListener('click', async () => { await chrome.storage.local.remove(TOKEN); show(); });
    show();
  }

  async function mount() {
    try {
      await globalThis.QAWi18n?.ready?.();
      const host = document.getElementById('app-body') || document.querySelector?.('main') || document.body;
      await wireSwitch();
      if (/\/whatsnew\//.test(globalThis.location?.pathname || '')) return; // the What's new page only borrows notesBlocks; no card above its title
      await paint(host);
      chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (KEY in c || READY in c)) paint(host); else if (area === 'session' && DISMISSED in c) paint(host); });
    } catch { /* the card is a courtesy; a page without it works the same */ }
  }

  globalThis.QAWUpdateCard = { newer, pending, notesBlocks, mount, paint };
  if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage && !globalThis.__QAW_NO_MOUNT) mount();
})();
