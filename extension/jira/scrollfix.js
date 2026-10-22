/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/*
 * Jira helper, page world. Why the page runs away when a long list opens: the picker focuses the highlighted option and
 * calls scrollIntoView() on it as you arrow through, and both scroll every scrollable ancestor, the page included.
 * Here an option or menu item scrolls its own list and nothing else. It does nothing until helper.js (the isolated
 * world, which can read the setting) sets data-qaw-jira-fix on <html>. It is registered on every page but patches nothing
 * until that flag appears, so a page that is not Jira keeps its own scrollIntoView and focus.
 * Jira Server / Data Center lists (AUI dropdowns, .ajs-layer, aui-list, select2) count as lists as well as role=listbox/menu.
 */
(() => {
  const ITEM = '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],.aui-list-item,.aui-list-item-link,.select2-result,.aui-dropdown2 a';
  const LIST = '[role="listbox"],[role="menu"],.aui-list,.aui-list-scroll,.aui-dropdown2,.ajs-layer,.select2-results';
  const on = () => document.documentElement.dataset.qawJiraFix === '1';
  const inList = (el) => el instanceof Element && el.matches(ITEM) && !!el.closest(LIST);
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
    }
    return null;
  };
  let installed = false;
  const install = () => {
  if (installed) return;
  installed = true;
  const was = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg) {
    if (!on() || !inList(this)) return was.call(this, arg);
    const box = scroller(this);
    if (!box) return undefined; // no list of its own to scroll: leave the page where it is
    const a = this.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.top < b.top) box.scrollTop -= b.top - a.top;
    else if (a.bottom > b.bottom) box.scrollTop += a.bottom - b.bottom;
    return undefined;
  };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (opts) {
    return focus.call(this, on() && (inList(this) || guarded()) ? { ...opts, preventScroll: true } : opts);
  };
  // Root cause of "the page jumps down when a list opens": Jira (AUI layer, select2, the transition dialog) focuses an element and/or
  // scrolls a container as it opens, and Jira Server scrolls #page / .aui-page-panel, not only window. So for a short guard window after
  // a click or key on a list trigger (or after a list node appears), every scroll we did not get from wheel/touch is put back.
  const pos = new Map(); // scroller (window or element) -> last [x, y] that the user (or nothing) put there
  const now = () => performance.now();
  let guardTo = 0; let userTo = 0; let busy = false;
  const key = (t) => (t === document || t === document.documentElement || t === document.body || t === window ? window : t);
  const at = (k) => (k === window ? [window.scrollX, window.scrollY] : [k.scrollLeft, k.scrollTop]);
  const guarded = () => on() && now() < guardTo && now() >= userTo;
  const arm = (ms) => { if (on()) { guardTo = now() + ms; for (const [k] of pos) pos.set(k, at(k)); pos.set(window, at(window)); } };
  addEventListener('scroll', (e) => {
    if (!on() || busy) return;
    const t = e.target; const k = key(t);
    if (k !== window && !(k instanceof Element)) return;
    if (k !== window && k.closest?.(LIST)) return; // a list scrolling itself is the point
    if (guarded()) {
      const [x, y] = pos.get(k) || [0, 0]; const [cx, cy] = at(k); // never seen scrolled: it was at the top
      if (x !== cx || y !== cy) { busy = true; if (k === window) scrollTo(x, y); else { k.scrollLeft = x; k.scrollTop = y; } busy = false; }
    } else pos.set(k, at(k));
  }, true);
  const human = () => { userTo = now() + 400; guardTo = 0; };
  addEventListener('wheel', human, { capture: true, passive: true });
  addEventListener('touchmove', human, { capture: true, passive: true });
  const TRIGGER = '[aria-haspopup],[aria-expanded],[aria-owns],[aria-controls],[role=combobox],[role=button],[role=menuitem],[role=option],select,.aui-dropdown2-trigger,.aui-button,.drop-arrow,.dropdown-trigger,.toolbar-trigger,.issue-action,.select2-container,.aui-list-item-link,button,summary';
  const SCROLLKEY = /^(PageUp|PageDown|Home|End| )$/;
  addEventListener('click', (e) => { if (e.target instanceof Element && (e.target.closest(TRIGGER) || e.target.closest(LIST))) arm(900); }, true);
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || e.ctrlKey || e.metaKey) return;
    if (SCROLLKEY.test(e.key) && !t.closest(TRIGGER) && !t.closest(LIST)) return human(); // paging the page itself is the user's
    if (t.closest(TRIGGER) || t.closest(LIST)) arm(900);
  }, true);
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n instanceof Element && (n.matches(LIST) || n.querySelector(LIST))) return arm(900);
  }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (on()) install();
  else { const mo = new MutationObserver(() => { if (on()) { install(); mo.disconnect(); } }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-qaw-jira-fix'] }); }
})();
