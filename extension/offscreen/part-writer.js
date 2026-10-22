/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The disk-write path of a recorder, on its own so Node can test it.
 *
 * Every chunk goes through one serial chain so the order on disk is the order
 * the encoder produced. The first failed write flips it to a RAM fallback: the
 * blob is already in hand, so nothing is lost, but the fallback is bounded and
 * it is announced the moment it starts, not at Stop.
 *
 *   onFail(err)  called once, on the first failed write
 *   onCap()      called once, when the RAM held reaches `capBytes`; the caller
 *                stops the recorder, and the clip is saved from what is held
 */
export const RAM_FALLBACK_CAP = 512 * 1024 * 1024;

export function partWriter({ put, onFail = () => {}, onCap = () => {}, capBytes = RAM_FALLBACK_CAP }) {
  const w = { chunks: [], error: null, chain: Promise.resolve(), ramBytes: 0, capped: false };
  let toDisk = true;
  w.add = (blob, seq) => {
    w.chain = w.chain.then(async () => {
      if (toDisk) {
        try {
          return await put(seq, blob);
        } catch (err) {
          toDisk = false;
          w.error ||= err;
          try { onFail(err); } catch { /* a broken warning must not lose the chunk */ }
        }
      }
      w.chunks.push(blob);
      w.ramBytes += blob.size || 0;
      if (!w.capped && w.ramBytes >= capBytes) {
        w.capped = true;
        try { onCap(); } catch { /* the cap is best effort; the clip is kept either way */ }
      }
    });
  };
  return w;
}
