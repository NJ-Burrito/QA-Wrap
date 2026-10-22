/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// placeFloat() rules: tools/test-float-place.mjs.

const SIZE = { w: 560, h: 720 }, GAP = 8;

const ov = (a, b) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

const best = (areas, r) => areas.reduce((b, a) => (ov(r, a) > (b ? ov(r, b) : 0) ? a : b), null);

const clamp = (r, a) => {
  const w = Math.min(r.width, a.width), h = Math.min(r.height, a.height);
  return {
    left: Math.round(Math.min(Math.max(r.left, a.left), a.left + a.width - w)),
    top: Math.round(Math.min(Math.max(r.top, a.top), a.top + a.height - h)),
    width: Math.round(w), height: Math.round(h),
  };
};

export function placeFloat({ stored, anchor, workAreas = [], size = SIZE }) {
  const areas = Array.isArray(workAreas) ? workAreas : [];
  const a = anchor && Number.isFinite(anchor.left) && Number.isFinite(anchor.top) ? anchor : null;
  const aa = (a && best(areas, a)) || a;

  if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
    const migrate = (stored.width ?? 0) <= 400 && !stored.floatBoundsV;
    const r = {
      left: stored.left, top: stored.top,
      width: migrate ? size.w : stored.width ?? size.w,
      height: migrate ? size.h : stored.height ?? size.h,
    };
    const area = best(areas, r);
    if (area && ov(r, area) / (r.width * r.height) >= 0.5) return { ...clamp(r, area), migrate };
  }

  if (a) {
    for (const left of [a.left + a.width + GAP, a.left - GAP - size.w]) {
      const fits = left >= a.left ? left + size.w <= aa.left + aa.width : left >= aa.left;
      if (fits) return { ...clamp({ left, top: a.top, width: size.w, height: Math.min(size.h, aa.height) }, aa), migrate: false };
    }
    const width = Math.min(size.w, a.width), height = Math.min(size.h, a.height);
    return { ...clamp({ left: a.left + a.width - width - 24, top: a.top + 88, width, height }, aa), migrate: false };
  }

  return { left: undefined, top: undefined, width: size.w, height: size.h, migrate: false };
}
