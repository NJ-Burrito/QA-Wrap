/* QA Wrap — shared page helpers: UQADom.el (node with class and plain text), .esc (5-char HTML escape), .themeWords (label and next from the shared table). */
(() => {
  const H = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const has = (k) => QAWi18n.has(k);
  window.UQADom = Object.freeze({
    el(tag, className, text) {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text != null) n.textContent = text;
      return n;
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => H[c]),
    themeWords: (mode, state) => ({
      label: has(`common.theme.${mode}.label`) ? QAWi18n.t(`common.theme.${mode}.label`) : state.label,
      next: has(`common.theme.${mode}.next`) ? QAWi18n.t(`common.theme.${mode}.next`) : state.next,
    }),
  });
})();
