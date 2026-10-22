/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one tone module (T-021). A tier is never colour alone: every use carries a
 * glyph SHAPE (filled square Error, triangle Warning, hollow circle Note, all from
 * ui/icons.js) and a WORD, so a colour-blind tester, a forced-colours session and a
 * screen reader read the same thing. Page-side only; the service worker never loads it.
 * The colours are `--tone-error` / `--tone-warn` in ui/tone.css (and `--uqa-tone-*`
 * inside the in-page overlay, which draws its own glyphs from the same function).
 *
 *   UQATone.tierOf('Error')            -> 'error' | 'warning' | 'note'
 *   UQATone.glyph(tier)                -> '<svg …>' (needs ui/icons.js loaded first)
 *   UQATone.chip(tier, word)           -> <span class="tone-chip tier-error"><svg/><span class="tone-word">Error</span></span>
 */
window.UQATone = (function () {
  var TIERS = {
    error: { icon: 'stop', key: 'common.signal.tier.error' },
    warning: { icon: 'tag-bug', key: 'common.signal.tier.warning' },
    note: { icon: 'tag-question', key: 'common.signal.tier.note' },
  };
  function tierOf(x) {
    var s = String(x || '').toLowerCase();
    return TIERS[s] ? s : 'note';
  }
  function glyph(tier) {
    return window.UQAIcon ? window.UQAIcon(TIERS[tierOf(tier)].icon, { size: 's' }) : '';
  }
  function chip(tier, word) {
    var tr = tierOf(tier);
    var s = document.createElement('span');
    s.className = 'tone-chip tier-' + tr;
    s.innerHTML = glyph(tr);
    var w = document.createElement('span');
    w.className = 'tone-word';
    w.textContent = word;
    s.append(w);
    return s;
  }
  return { TIERS: TIERS, tierOf: tierOf, glyph: glyph, chip: chip };
})();
