/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * WAV, written by hand, because nothing else has to be.
 *
 * Its own file so it can be tested in Node. `offscreen.js` needs a DOM, a
 * MediaRecorder and `chrome.*` before it will load at all, and an encoder that
 * can only be exercised inside a browser is an encoder whose header nobody
 * ever checks.
 */

/**
 * PCM into a RIFF/WAVE container: 44 bytes of header and the samples.
 *
 * 16-bit signed little-endian, interleaved, which is the one WAV variant every
 * editor, transcriber and ticket system reads without being told anything.
 * Float samples are clamped before scaling: `decodeAudioData` can hand back
 * values slightly outside -1..1 and the wrap-around from not clamping is heard
 * as a click on every peak.
 */
export function wavBytes(audio) {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) data.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  data.setUint32(4, 36 + frames * channels * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  data.setUint32(16, 16, true); // PCM header length
  data.setUint16(20, 1, true); // PCM, uncompressed
  data.setUint16(22, channels, true);
  data.setUint32(24, audio.sampleRate, true);
  data.setUint32(28, audio.sampleRate * channels * 2, true); // bytes per second
  data.setUint16(32, channels * 2, true); // bytes per frame
  data.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  data.setUint32(40, frames * channels * 2, true);

  const tracks = [];
  for (let c = 0; c < channels; c++) tracks.push(audio.getChannelData(c));

  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, tracks[c][i]));
      data.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }
  return data.buffer;
}


/**
 * The same bytes as a Blob, built a window of frames at a time so the 16-bit
 * copy never exists twice as one giant buffer next to the decoded floats.
 * ponytail: the decode itself is still whole-file (no demuxer to feed it
 * pieces); this bounds only the encode side.
 */
export function encodeWav(audio, windowFrames = 1 << 20) {
  const frames = audio.length;
  const parts = [];
  const head = wavBytes({ numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate, length: 0, getChannelData: () => [] });
  const view = new DataView(head);
  const bytes = frames * audio.numberOfChannels * 2;
  view.setUint32(4, 36 + bytes, true);
  view.setUint32(40, bytes, true);
  parts.push(head);
  const tracks = [];
  for (let c = 0; c < audio.numberOfChannels; c++) tracks.push(audio.getChannelData(c));
  for (let from = 0; from < frames; from += windowFrames) {
    const to = Math.min(frames, from + windowFrames);
    const out = new Int16Array((to - from) * tracks.length);
    let at = 0;
    for (let i = from; i < to; i++) {
      for (let c = 0; c < tracks.length; c++) {
        const x = Math.max(-1, Math.min(1, tracks[c][i]));
        out[at++] = x < 0 ? x * 0x8000 : x * 0x7fff;
      }
    }
    parts.push(out.buffer);
  }
  return new Blob(parts, { type: 'audio/wav' });
}

/** Most a clip may be before decoding it whole is refused with a real reason. */
export const MAX_DECODE_BYTES = 400 * 1024 * 1024;

/**
 * What a failed decode actually was. `EncodingError` is what the platform
 * says for "no decodable audio in this file" (a clip recorded without sound
 * is the usual cause, not the only one); anything else — out of memory, a
 * closed context — is reported as itself, never as "no sound".
 */
export function decodeFailure(err) {
  const why = `${err?.name || 'Error'}: ${err?.message || err}`;
  if (err?.name === 'EncodingError' || err?.name === 'NotSupportedError') {
    return new Error(
      `The sound of this clip could not be decoded (${why}). If it was recorded without "Tab sound" or "Mic", ` +
        'it has no sound track; otherwise the file may be damaged.'
    );
  }
  return new Error(`Exporting the sound failed (${why}). The clip may be too long to decode in memory.`);
}
