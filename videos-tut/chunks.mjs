/* Caption chunking shared by build.mjs and gates.mjs. */
export const words = (s) => s.trim().split(/\s+/).filter(Boolean);
/** Sentences first; a sentence of more than 9 words splits once at its comma nearest the middle. */
export function chunks(text) {
  const out = [];
  for (const s of text.split(/(?<=[.!?؟])\s+/).filter(Boolean)) {
    const w = words(s);
    if (w.length <= 9) { out.push(s); continue; }
    const idx = w.map((x, i) => (/[,،:]$/.test(x) ? i : -1)).filter((i) => i >= 0 && i < w.length - 2);
    if (!idx.length) { out.push(s); continue; }
    const mid = w.length / 2;
    const cut = idx.reduce((a, b) => (Math.abs(b + 1 - mid) < Math.abs(a + 1 - mid) ? b : a));
    out.push(w.slice(0, cut + 1).join(' '), w.slice(cut + 1).join(' '));
  }
  return out;
}

