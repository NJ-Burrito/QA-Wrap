// DOM-only probes for the formats in file-types.js; split out so the service worker's boot graph does not carry them (devil r2 E2).
import { IMAGE_TYPES, VIDEO_TYPES, byId } from './file-types.js';

/**
 * Which image and video types this browser can really write.
 *
 * Must run somewhere with a DOM — the offscreen document — because both probes
 * need a canvas or a MediaRecorder, and a service worker has neither.
 */
export function probeFormats() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;

  const images = {};
  for (const t of IMAGE_TYPES) {
    try {
      // toDataURL returns a PNG for anything it cannot encode, so the answer is
      // in the prefix that comes back, never in the argument that went in.
      images[t.id] = canvas.toDataURL(t.mime).startsWith(`data:${t.mime}`);
    } catch {
      images[t.id] = false;
    }
  }

  const videos = {};
  for (const t of VIDEO_TYPES) {
    if (t.alwaysAvailable) {
      videos[t.id] = true;
      continue;
    }
    videos[t.id] =
      typeof MediaRecorder !== 'undefined' && t.candidates.some((c) => MediaRecorder.isTypeSupported(c));
  }

  return { images, videos };
}

/** The exact codec string to hand MediaRecorder for a chosen container. */
export function videoMime(id) {
  const type = byId(VIDEO_TYPES, id);
  if (!type || type.alwaysAvailable) return null;
  return type.candidates.find((c) => MediaRecorder.isTypeSupported(c)) || null;
}

/** Tab capture at the tab's own size (rec-quality-1025): max-only letterboxed into the box; a min box of another shape (2:1 vs 1:1) is "any size within limit". Long edge capped. */
export const CAPTURE_EDGE = { low: 1280, medium: 1920, high: 2560 };
export function tabVideo(streamId, quality, fps) {
  const edge = CAPTURE_EDGE[quality] || CAPTURE_EDGE.medium;
  return { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, minWidth: 4, minHeight: 2, maxWidth: edge, maxHeight: edge, maxFrameRate: fps || 15 } };
}

/**
 * The recorded frame is fixed at the first frame's size, even, for the whole clip (rec-resize-1027). Chrome's MP4 muxer keeps the
 * first SPS only, so a picture that changes size mid-clip (DevTools, a side panel, a window resize: the tab capture follows the tab
 * since 3.8.1) encodes frames no player can decode. Later frames are fitted inside, centred, by fitRect.
 */
export function lockFrame(w, h) {
  return { w: Math.max(2, Math.round(w) & ~1), h: Math.max(2, Math.round(h) & ~1) };
}
export function fitRect(sw, sh, dw, dh) {
  const s = Math.min(dw / sw, dh / sh);
  const w = Math.round(sw * s), h = Math.round(sh * s);
  return { x: Math.round((dw - w) / 2), y: Math.round((dh - h) / 2), w, h };
}

/** 3 / 8 / 16 Mbps at 1080p for low / medium / high, scaled by pixels (0.25x-2x). */
export function videoBitrate(quality, width, height) {
  const base = { low: 3_000_000, medium: 8_000_000, high: 16_000_000 }[quality] || 8_000_000;
  const scale = (width > 0 && height > 0) ? (width * height) / (1920 * 1080) : 1;
  return Math.round(base * Math.min(2, Math.max(0.25, scale)));
}
