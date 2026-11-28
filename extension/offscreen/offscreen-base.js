/* QA Wrap — offscreen document: format probing, permissions, audio extraction (split from offscreen.js). */
import { getMedia } from '../core/db.js';
import { IMAGE_TYPES, VIDEO_TYPES } from '../core/file-types.js';
import { probeFormats, videoMime } from '../core/file-probe.js';
import { sha256Hex } from '../core/integrity.js';
import { encodeWav, decodeFailure, MAX_DECODE_BYTES } from './wav.js';

/** T-066: every stored artifact carries its SHA-256, computed here with crypto.subtle. */
const withHash = async (record) => ({ ...record, sha256: await sha256Hex(record.blob) });

/* ── what this Chrome can actually encode ──────────────────────────────────
   Asked, never assumed. MediaRecorder support for MP4 arrived in Chrome 126 and
   is not present in every Chromium build a tester might be on; offering a format
   the browser will refuse produces a zero-byte file and no explanation. */

const pickMime = (format) => videoMime(format);

const cancelled = () => Object.assign(new Error('Stopped before the recording began. Nothing was recorded.'), { code: 'REC_CANCELLED' });
const within = (p, ms, v) => Promise.race([Promise.resolve(p), new Promise((res) => setTimeout(res, ms, v))]);

/**
 * Which formats this browser can really write, image and video both.
 *
 * The catalogue lives in core/file-types.js; what is asked here is which entries
 * survive contact with this particular build. Offering one that does not is how
 * a tester ends up with a `.avif` that is really a PNG.
 */
export function supportedFormats() {
  const { images, videos } = probeFormats();
  return {
    images,
    videos,
    imageTypes: IMAGE_TYPES.map((t) => ({ ...t, available: !!images[t.id] })),
    videoTypes: VIDEO_TYPES.map((t) => ({ ...t, available: !!videos[t.id], candidates: undefined })),
  };
}

/**
 * A disk write failed: say so now, while the tester can still act on it.
 * The worker shows it (badge and notification); the clip carries on from RAM,
 * bounded by the cap in `part-writer.js`, and the warning is repeated at Stop.
 */
function warnDisk(err) {
  chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', reason: 'disk-warn', error: String(err?.message || err) }).catch(() => {});
}

/** Put the shared media elements back, so the next clip starts from nothing. */
function releaseElements() {
  for (const id of ['feed', 'cam', 'echo']) {
    const node = document.getElementById(id);
    if (node) node.srcObject = null;
  }
}

/**
 * Ask the browser for the extra sources the tester ticked.
 *
 * Each is requested separately and each failure is reported by name. Asking for
 * mic and webcam in one `getUserMedia` call means a refused microphone also
 * costs you the camera, with one opaque error covering both — and a tester who
 * ticked two boxes and got neither has no idea which one to fix.
 *
 * **The permission is checked before it is asked for.** An offscreen document
 * is never rendered, so Chrome has nowhere to draw a permission bubble in it:
 * `getUserMedia` here does not prompt, it fails — and it failed with
 * `NotAllowedError`, which reads as "you refused" to somebody who was never
 * asked. Querying first is what lets the refusal name the one place that *can*
 * ask, which is the Settings page, because it opens in a tab.
 */
async function permissionState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    // Firefox has no `camera`/`microphone` permission descriptor. Unknown is
    // not "denied" — fall through and let getUserMedia answer.
    return 'unknown';
  }
}

const GRANT_ROUTE =
  'open QA Wrap Settings and press "Allow the microphone and camera": an offscreen ' +
  'recorder cannot show the browser’s permission prompt itself';

/**
 * What the browser says about the microphone and the camera, right now.
 *
 * Read here because this is the only context of ours with
 * `navigator.permissions` and `navigator.mediaDevices` that is not a page the
 * tester has to have open. A service worker has neither.
 */
async function devicePermissions() {
  const [microphone, camera] = await Promise.all([
    permissionState('microphone'),
    permissionState('camera'),
  ]);
  return { microphone, camera };
}

/**
 * The audio of a stored clip, on its own, as a WAV.
 *
 * Asked for because a recording with narration on it is often wanted as
 * narration — a defect described out loud, attached to a ticket, without a
 * hundred megabytes of video around it.
 *
 * Decoded and re-encoded rather than remuxed. Pulling the AAC or Opus track out
 * of the container without re-encoding would be smaller and would need a
 * demuxer this product does not have; `decodeAudioData` is in the platform,
 * gives PCM, and WAV is the one audio container that needs no encoder at all.
 * That is also why it is WAV and not MP3: no browser can write an MP3, and a
 * file named `.mp3` that is not one is the exact failure `file-types.js` exists
 * to prevent.
 *
 * A clip with no audio track is an error and not an empty file, because a
 * zero-length WAV is indistinguishable from a bug when somebody opens it.
 */
async function extractAudio({ id }) {
  const record = await getMedia(id);
  if (!record?.blob) throw new Error('That recording is no longer stored.');

  if (record.blob.size > MAX_DECODE_BYTES) {
    throw new Error(
      `This clip is ${Math.round(record.blob.size / 1024 / 1024)} MB, too large to decode for sound in one piece ` +
        `(limit ${Math.round(MAX_DECODE_BYTES / 1024 / 1024)} MB). Download the video and extract the sound from it instead.`
    );
  }
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await record.blob.arrayBuffer());
  } catch (err) {
    throw decodeFailure(err);
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!decoded.length || !decoded.numberOfChannels) {
    throw new Error('That clip has no sound to export.');
  }

  const wav = encodeWav(decoded);
  return {
    id,
    bytes: wav.size,
    type: 'audio/wav',
    durationMs: Math.round(decoded.duration * 1000),
    channels: decoded.numberOfChannels,
    sampleRate: decoded.sampleRate,
    // The Blob goes back through the worker as an object URL, never as bytes on
    // the message port. See the D2 note in background/service-worker.js.
    url: URL.createObjectURL(wav),
    filename: `${(record.label || 'Recording').replace(/[^\w -]+/g, '')}.wav`,
  };
}

async function extraSources({ mic, webcam }) {
  const out = { micStream: null, camStream: null, refused: [] };

  if (mic) {
    if ((await permissionState('microphone')) === 'denied') {
      out.refused.push(`microphone (not granted: ${GRANT_ROUTE})`);
    } else {
      try {
        out.micStream = await navigator.mediaDevices.getUserMedia({
          // Voice-over narration, not a music recording: the browser's own
          // cleanup is exactly what is wanted here.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        out.refused.push(
          `microphone (${err.name === 'NotAllowedError' ? `not granted: ${GRANT_ROUTE}` : err.message})`
        );
      }
    }
  }

  if (webcam) {
    if ((await permissionState('camera')) === 'denied') {
      out.refused.push(`camera (not granted: ${GRANT_ROUTE})`);
    } else {
      try {
        out.camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
      } catch (err) {
        out.refused.push(
          `camera (${err.name === 'NotAllowedError' ? `not granted: ${GRANT_ROUTE}` : err.message})`
        );
      }
    }
  }

  return out;
}

export { cancelled, devicePermissions, extraSources, extractAudio, pickMime, releaseElements, warnDisk, withHash, within };
