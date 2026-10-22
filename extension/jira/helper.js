/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/*
 * Jira helper, content script (classic script, isolated world; registered on every http(s) page by site-access.js, and it
 * does nothing unless the page is Jira: *.atlassian.net, a page that says application-name JIRA or has body#jira (Jira Server
 * and Data Center), or the address typed in Settings; any company, any host). Reads the Settings switches and does two things: tells scrollfix.js (page world)
 * and helper.css to keep long lists inside themselves, and draws the RTL || LTR sliding switch that flips only the user-written text blocks (never html/body, so the page layout stays).
 * The direction (until Chrome closes) and the tab position are remembered per host. Nothing leaves the extension, nothing is logged to the page.
 * Storage goes through the worker (UQA_GET_SETTINGS with `jira`, jiraPage in background/site-access.js): it closes storage.local to
 * content scripts (setAccessLevel TRUSTED_CONTEXTS), so a read or write from here fails in Chrome (work/ui-1020/jira-storage.md).
 */
(() => {
  const W = 120; // tab width in px, same as helper.css
  const root = document.documentElement;
  const host = location.host;
  const looksJira = () => /\.atlassian\.net$/.test(host) || /^jira$/i.test(document.querySelector('meta[name="application-name"]')?.content || '') || !!document.querySelector('body#jira');
  // One door for reads and writes, this host only; a worker that cannot answer (an extension reload) means defaults, never a console line.
  const ask = (jira = {}) => new Promise((ok) => {
    try { chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS', jira }, (res) => { void chrome.runtime.lastError; ok((res?.ok && res.result) || {}); }); } catch { ok({}); }
  });
  const start = (page) => {
  const cfg = { dropdown: page.dropdown !== false, rtl: page.rtl !== false };
  let dir = page.dir; // 'rtl' | 'ltr' | undefined (LTR)
  let pos = page.pos; // {l} or {r}: px from the nearest edge
  let down = false; let moved = false;

  // The user-written text only: summary, description, comments, editors, field values (Jira Server/AUI and Cloud). Never html/body.
  const TEXT = [
    '#summary-val', '#summary', '#description-val', '#description', '#comment', '.user-content-block', '.action-body', '.activity-comment .action-body',
    'textarea.wiki-textfield', '.wiki-edit textarea', '.field-group textarea', '.editable-field textarea', '.type-textarea .value', '.type-text .value', '#details-module .value',
    '[data-testid*="summary.heading"]', '[data-testid*="rich-text"]', '[data-testid*="description"] .ak-renderer-document', '.ak-renderer-document', '.ProseMirror',
    '[data-component-selector*="rich-text"]', '[data-testid*="comment"] .ak-renderer-document', '.inline-edit-fields textarea', '.inline-edit-fields input[type="text"]',
  ].join(',');
  // The Visual editor (Jira Server 8+ description and comment, TinyMCE) types into body#tinymce of a same-origin iframe: page CSS and dir do not reach it.
  const FRAMES = '.rte-container iframe, .mce-tinymce iframe, iframe.tox-edit-area__iframe';
  // Only text, never chrome (jira-edit-rtl-2): #description-val, #summary-val and the field .value blocks are the inline-edit wrappers
  // Jira keeps in the page when a field opens, and then they hold the form, the toolbar, the Visual | Text tabs and Save. A match that
  // sits in a toolbar or menu, or holds a form, a field, an editor or a toolbar, is a wrapper: it is never marked (its textarea,
  // input, iframe body or .ProseMirror is marked on its own).
  const TOOLS = '[role="toolbar"], [role="menu"], [role="tablist"], .aui-toolbar2, .aui-buttons, .aui-nav, .mce-toolbar, .tox-toolbar, button';
  const HOLDS = '[role="toolbar"], [role="menu"], [role="tablist"], .aui-toolbar2, .mce-toolbar, .tox-toolbar, form, textarea, select, iframe, input:not([type="hidden"]):not([type="checkbox"]), [contenteditable]:not([contenteditable="false"])';
  const leaf = (el) => !el.closest(TOOLS) && !el.querySelector(HOLDS);
  const tag = (el, want) => { // only attributes, and only when they change, so a field being typed in keeps its caret; never its value or content
    if (!want) { if (el.hasAttribute('data-qaw-dir')) { el.removeAttribute('data-qaw-dir'); el.removeAttribute('dir'); } return; }
    if (el.getAttribute('data-qaw-dir') !== want) { el.setAttribute('data-qaw-dir', want); el.setAttribute('dir', want); }
  };
  // same rules as helper.css, for the editor's iframe document (its own content CSS sets alignment too, hence !important)
  const DIRCSS = '[data-qaw-dir]{unicode-bidi:plaintext!important}[data-qaw-dir="rtl"]{direction:rtl!important;text-align:right!important}[data-qaw-dir="ltr"]{direction:ltr!important;text-align:left!important}';
  const seen = new WeakSet();
  const mark = (want) => {
    for (const el of document.querySelectorAll(TEXT)) tag(el, leaf(el) ? want : '');
    for (const f of document.querySelectorAll(FRAMES)) {
      if (!seen.has(f)) { seen.add(f); f.addEventListener('load', () => mark(wanted)); } // the editor writes its document after the frame is in the page
      let d = null; try { d = f.contentDocument; } catch { /* another origin */ }
      if (!d?.body) continue;
      if (want && !d.getElementById('qaw-jira-dir-css')) { const s = d.createElement('style'); s.id = 'qaw-jira-dir-css'; s.textContent = DIRCSS; (d.head || d.documentElement).append(s); } // the editor saves body content only
      tag(d.body, want);
    }
  };
  let wanted = ''; let timer = 0;
  const later = () => { if (!timer) timer = setTimeout(() => { timer = 0; mark(wanted); }, 250); }; // Jira loads text later: rescan, throttled
  let mo = null;

  // Restarts the one-shot stream along the bar (the water, the strings and the tilt are plain CSS transitions on data-side; reduced motion drops them).
  const flow = (b) => { b.removeAttribute('data-flow'); void b.offsetWidth; b.setAttribute('data-flow', ''); };
  const clampX = (x, cw) => Math.min(Math.max(x, W / 2), Math.max(W / 2, cw - W / 2));
  const place = (b) => {
    if (!b) return;
    const cw = root.clientWidth; const p = pos;
    const x = p && 'r' in p ? cw - p.r : p && 'l' in p ? p.l : cw / 2;
    b.style.left = clampX(x, cw) + 'px';
  };
  const nudge = (b, px) => { // stored against the nearest edge, so scrollbars and window size cannot move it
    const cw = root.clientWidth || 1; const x = clampX((parseFloat(b.style.left) || cw / 2) + px, cw);
    pos = x < cw / 2 ? { l: x } : { r: cw - x }; place(b);
  };
  let saveT = 0; // one write per settle: Alt+Arrow repeats
  const savePos = (wait = 0) => { clearTimeout(saveT); const go = () => ask({ pos }); if (wait) saveT = setTimeout(go, wait); else go(); };

  const apply = () => {
    if (cfg.dropdown) root.dataset.qawJiraFix = '1'; else delete root.dataset.qawJiraFix;
    const d = cfg.rtl ? dir : undefined;
    wanted = d === 'rtl' || d === 'ltr' ? d : '';
    if (wanted) root.dataset.qawJiraDir = wanted; else delete root.dataset.qawJiraDir;
    mark(wanted);
    // a field opening its editor inside a marked wrapper is unmarked before the next paint (the full rescan stays throttled)
    if (wanted && !mo && document.body) { mo = new MutationObserver(() => { for (const el of document.querySelectorAll('[data-qaw-dir]')) if (!leaf(el)) tag(el, ''); later(); }); mo.observe(document.body, { childList: true, subtree: true }); }
    if (!wanted && mo) { mo.disconnect(); mo = null; }
    let btn = document.getElementById('qaw-jira-dir');
    if (!cfg.rtl || !document.body) { btn?.remove(); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'qaw-jira-dir';
      btn.type = 'button';
      btn.dataset.side = wanted === 'rtl' ? 'rtl' : 'ltr'; // before it is in the page, so the first draw is already settled (no pour on load)
      btn.setAttribute('role', 'switch');
      btn.title = 'RTL || LTR';
      const cup = (c, t) => `<span class="qaw-c ${c}"><svg class="qaw-w" viewBox="0 0 56 22" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6 q7 -3.5 14 0 t14 0 t14 0 t14 0 V22 H0z"/></svg><b class="qaw-lbl">${t}</b></span>`;
      btn.innerHTML = `<i class="qaw-str qaw-str-r"></i><i class="qaw-str qaw-str-l"></i><span class="qaw-beam"><i class="qaw-bar"></i>${cup('qaw-r', '← RTL')}${cup('qaw-l', 'LTR →')}<i class="qaw-flow"></i></span>`; // glyph-ok: drawn inside the Jira page, in its own font
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        down = true; moved = false;
        const sx = e.clientX; const x0 = parseFloat(btn.style.left) || root.clientWidth / 2;
        btn.setPointerCapture?.(e.pointerId);
        const mv = (m) => {
          if (!moved && Math.abs(m.clientX - sx) < 5) return;
          moved = true; btn.dataset.drag = '';
          nudge(btn, x0 + (m.clientX - sx) - (parseFloat(btn.style.left) || x0)); // X only: the top stays at the edge
        };
        const ends = ['pointerup', 'pointercancel', 'lostpointercapture']; // a page that eats pointerup still lets lostpointercapture through
        const up = () => {
          if (!down) return;
          btn.removeEventListener('pointermove', mv); for (const t of ends) btn.removeEventListener(t, up);
          down = false; delete btn.dataset.drag;
          if (moved) { savePos(); setTimeout(() => { moved = false; }, 0); } // the click that follows a drag is swallowed
        };
        btn.addEventListener('pointermove', mv); for (const t of ends) btn.addEventListener(t, up);
      });
      // An open Jira editor saves and closes when focus leaves it or on a mousedown outside it: a press keeps focus, caret and
      // selection where they are (no focus on mousedown; Tab still reaches the switch) and never reaches the page's outside-click handlers.
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      for (const t of ['pointerup', 'mouseup']) btn.addEventListener(t, (e) => e.stopPropagation());
      btn.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault(); nudge(btn, e.key === 'ArrowLeft' ? -32 : 32); savePos(250);
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (moved) return;
        dir = dir === 'rtl' ? 'ltr' : 'rtl';
        apply();
        flow(btn);
        ask({ dir });
      });
      document.body.append(btn);
    }
    if (!down) place(btn);
    const rtl = wanted === 'rtl';
    btn.dataset.side = rtl ? 'rtl' : 'ltr';
    btn.setAttribute('aria-pressed', String(rtl));
    btn.setAttribute('aria-checked', String(rtl));
  };

  // jira-switch-5 kept the position in storage.sync (the Google account) for a few hours: bring this host's value home, then remove the key.
  try { chrome.storage.sync.get('qawJiraPos').then((s) => { const old = s.qawJiraPos; if (!old) return; if (!pos && old[host]) { pos = old[host]; savePos(); place(document.getElementById('qaw-jira-dir')); } return chrome.storage.sync.remove('qawJiraPos'); }).catch(() => {}); } catch { /* no sync area */ }
  // Jira is a single-page app: the body, or the button inside it, can be replaced; draw it again (apply places it from the stored position).
  let watched = null;
  const keep = new MutationObserver(() => {
    if (document.body && watched !== document.body) { watched = document.body; keep.observe(watched, { childList: true }); }
    if (cfg.rtl && document.body && !document.getElementById('qaw-jira-dir')) apply();
  });
  keep.observe(root, { childList: true });
  if (document.body) { watched = document.body; keep.observe(watched, { childList: true }); }
  // window resize, the side panel opening and a late scrollbar all change clientWidth: re-place whichever button is in the page now
  new ResizeObserver(() => { if (!down) place(document.getElementById('qaw-jira-dir')); }).observe(root);
  apply();
  // Notifications poll the Jira you last opened when no address is picked: the worker records this host (no page content) and the
  // REST API generation it speaks (Cloud build numbers start at 1000) in qawJiraSeen, for the poll and the Settings list.
  const ver = document.querySelector('meta[name="application-name"]')?.getAttribute('data-version') || '';
  ask({ api: /\.atlassian\.net$/.test(host) || parseInt(ver, 10) >= 1000 ? 3 : 2 }); // written only when it changed
  };

  // Not Jira until the page says so (the head is not parsed yet at document_start): then a page that is not Jira is left alone.
  const boot = async () => {
    const jira = looksJira(); const page = await ask(); // the switches, this host's direction and position, and whether it is the typed address
    if (jira || page.typed) start(page);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
