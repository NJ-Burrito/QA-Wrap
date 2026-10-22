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
