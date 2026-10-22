/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-060: what "a visible focus ring" means to a test, in one place.
 *
 * `FOCUS_PROBE` runs inside a page (it is self-contained, it is passed to `page.evaluate`), walks
 * down through open shadow roots to the element that really holds focus, and reports its computed
 * outline and box-shadow. `ringVisible` judges that report. The in-page bar lives in a shadow
 * root, so a probe that read `document.activeElement` would stop at the host and call it a ring.
 */
export const FOCUS_PROBE = () => {
  let el = document.activeElement;
  // QA Wrap's own bar sits in a closed shadow root: only the content script's world holds the key
  // (window.UQAUiHost.uiRoot()), so a probe run there descends into it and one run in the page stops at the host.
  const rootOf = (n) => n.shadowRoot || (n.tagName === 'QAW-UI' && window.UQAUiHost?.uiRoot?.()) || null;
  for (let r = el && rootOf(el); r && r.activeElement; r = rootOf(el)) el = r.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true };
  const cs = getComputedStyle(el);
  const seen = (window.__uqaFocusSeen ||= new WeakSet());
  const again = seen.has(el);
  seen.add(el);
  const r = el.getBoundingClientRect();
  return {
    none: false,
    id: el.id || '',
    tag: el.tagName.toLowerCase(),
    cls: String(el.getAttribute('class') || '').slice(0, 40),
    name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 40),
    focusVisible: el.matches(':focus-visible'),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    boxShadow: cs.boxShadow,
    on: r.width > 0 && r.height > 0,
    again,
  };
};

const transparent = (c) => /^(transparent|rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\))$/i.test(String(c).trim());

/** True when the report describes an element that shows a focus ring a keyboard user can see. */
export function ringVisible(d) {
  if (!d || d.none || !d.on || !d.focusVisible) return false;
  const outline = !/^(none|hidden)$/.test(d.outlineStyle) && parseFloat(d.outlineWidth) > 0 && !transparent(d.outlineColor);
  const shadow = d.boxShadow && d.boxShadow !== 'none' && !/ 0px 0px 0px 0px$/.test(d.boxShadow.trim()) && !/^rgba\(\s*0,\s*0,\s*0,\s*0\)/.test(d.boxShadow.trim());
  return !!(outline || shadow);
}

/** D-1010-66: the outline colour right after the first Tab must already be painted (the arrival animation may not hide it). */
export const outlineOpaque = (d) => !!d && !d.none && !!d.focusVisible && !transparent(d.outlineColor);

/** What a failing focus probe prints: the four fields that say why no ring shows. */
export const describeFocus = (d) => d?.none ? 'none' : `${d.tag}#${d.id || d.cls || d.name} focusVisible=${d.focusVisible} outlineStyle=${d.outlineStyle} outlineColor=${d.outlineColor} boxShadow=${d.boxShadow}`;
