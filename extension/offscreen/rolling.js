/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The rolling one-minute tab video (cap1022), loaded on the first press only (offscreen.js imports it lazily). Video only, in memory only:
 * the chunks live in this document's arrays and are written to the media store when, and only when, the tester presses «Save last 1 minute».
 * It runs while a session records and stops the moment the session ends (the worker's UQA_STATE_CHANGED, then `alive`), a normal Record
 * starts (offscreen.js calls stopRoll first: one tab, one capture), or the document goes. The arithmetic is core/rolling-buffer.js.
 */
import { putMedia } from '../core/db.js';
import { sha256Hex } from '../core/integrity.js';
import { videoMime, tabVideo } from '../core/file-probe.js';
import { SLOTS, dueRestarts, pickSave, reconcileDuration } from '../core/rolling-buffer.js';

/** @type {null | { stream: MediaStream, sessionId: string, tabId: number, onState?: any, mime: string, t0: number, slots: any[], timer: number }} */
let r = null;

const isOn = () => !!r;
export const rolling = isOn;

function startSlot(i) {
  const old = r.slots[i];
  if (old) { old.rec.onstop = null; try { old.rec.stop(); } catch { /* already inactive */ } }
  const rec = new MediaRecorder(r.stream, { mimeType: r.mime, videoBitsPerSecond: 1_500_000 });
  const slot = { rec, chunks: [], startedAt: Date.now() };
  rec.ondataavailable = (e) => { if (e.data?.size) slot.chunks.push(e.data); };
  rec.start(1000);
  r.slots[i] = slot;
}

async function alive() {
  const res = await chrome.runtime.sendMessage({ type: 'UQA_GET_STATE', tabId: r.tabId }).catch(() => null);
  return res?.result?.session?.id === r.sessionId;
}

async function tick() {
  if (!r) return;
  if (Date.now() - r.t0 > 5000 && Date.now() % 20000 < 1000 && !(await alive())) return stopRoll(); // belt and braces: the session may have ended unseen
  for (const i of dueRestarts(r.slots, Date.now(), r.t0)) startSlot(i);
}


export function stopRoll() {
  if (!r) return;
  clearInterval(r.timer);
  chrome.runtime.onMessage.removeListener(r.onState);
  for (const s of r.slots) if (s) { s.rec.onstop = null; try { s.rec.stop(); } catch { /* already inactive */ } }
  r.stream.getTracks().forEach((t) => t.stop());
  r = null;
}

/** What the blob really decodes to, in ms; null when it cannot be read. A MediaRecorder file has no duration header, so seek far past the end to make the element compute it. */
async function decodedMs(blob) {
  const v = document.createElement('video');
  const url = URL.createObjectURL(blob);
  const wait = (ev) => new Promise((ok, no) => { v.addEventListener(ev, ok, { once: true }); v.addEventListener('error', no, { once: true }); setTimeout(no, 8000); });
  try {
    v.muted = true; v.preload = 'auto'; v.src = url;
    await wait('loadedmetadata');
    if (!Number.isFinite(v.duration)) { const w = wait('durationchange'); v.currentTime = 1e9; await w; }
    return Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** @param {{ label?: string }} msg */
async function save({ label }) {
  const i = r ? pickSave(r.slots) : -1;
  if (i < 0) throw new Error('Nothing is buffered yet.');
  const slot = r.slots[i];
  const { sessionId, mime } = r;
  const stopped = new Promise((res) => { slot.rec.onstop = res; });
  slot.rec.stop();
  await stopped;
  const blob = new Blob(slot.chunks, { type: mime });
  startSlot(i); // keep rolling: the slot starts a fresh minute
  if (!blob.size) throw new Error('The buffer was empty.');
  const type = mime.split(';')[0];
  const record = {
    id: crypto.randomUUID(), sessionId, kind: 'recording', label: label || 'Last minute', type, ext: type.includes('mp4') ? 'mp4' : 'webm',
    durationMs: reconcileDuration(Date.now() - slot.startedAt, await decodedMs(blob)), ts: slot.startedAt, sources: { tab: true }, incomplete: null, bytes: blob.size, blob,
  };
  await putMedia({ ...record, sha256: await sha256Hex(blob) });
  const { blob: _b, ...meta } = record;
  return { ...meta, stored: true };
}

/** @param {{op: string, streamId?: string, sessionId?: string, tabId?: number, label?: string}} msg */
export async function rollOp(msg, blocked) {
  if (msg.op === 'state') return { rolling: isOn() };
  if (msg.op === 'stop') { stopRoll(); return { rolling: false }; }
  if (msg.op === 'save') return save(msg);
  if (msg.op !== 'start') throw new Error(`Unknown roll op: ${msg.op}`);
  if (r) return { rolling: true };
  // WebM only: this records the raw tab track, which changes size with the tab, and VP8 carries each size in its own keyframes;
  // an MP4 keeps the first size only and turns the rest to smear (rec-resize-1027).
  const mime = videoMime('webm');
  if (!mime) throw new Error('This browser cannot record video at all: no supported encoder.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: /** @type {any} */ (tabVideo(msg.streamId, 'medium', 15)),
  });
  // A Record pressed while this capture was opening (3.8.3): it wins, and this one lets the tab go before it ever holds it.
  if (blocked?.()) { stream.getTracks().forEach((t) => t.stop()); return { rolling: false, why: 'recording' }; }
  r = { stream, sessionId: msg.sessionId, tabId: msg.tabId, mime, t0: Date.now(), slots: Array(SLOTS).fill(null), timer: 0 };
  r.timer = setInterval(tick, 1000);
  chrome.runtime.onMessage.addListener(r.onState = async (m, sender) => {
    if (sender?.id !== chrome.runtime.id) return;
    if (m?.type === 'UQA_STATE_CHANGED' && r && !(await alive())) stopRoll();
  });
  stream.getVideoTracks()[0].addEventListener('ended', stopRoll);
  await tick();
  return { rolling: true };
}
