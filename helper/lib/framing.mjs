// Chrome native messaging framing: a 4-byte little-endian length, then that many bytes of UTF-8 JSON.
// Chrome accepts at most 1 MiB from a host, so `encode` refuses anything larger rather than let the browser kill the port.

export const MAX_TO_BROWSER = 1024 * 1024;

export function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (body.length > MAX_TO_BROWSER) throw new Error('message larger than 1 MiB');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** A decoder you feed chunks; it calls `onMessage` once per complete frame. A broken frame calls `onError` and stops. */
export function decoder(onMessage, onError = () => {}, maxBytes = 64 * 1024 * 1024) {
  let buf = Buffer.alloc(0);
  let dead = false;
  return (chunk) => {
    if (dead) return;
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (n > maxBytes) { dead = true; onError(new Error('frame too large')); return; }
      if (buf.length < 4 + n) return;
      const body = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      try { onMessage(JSON.parse(body.toString('utf8'))); } catch (e) { dead = true; onError(e); return; }
    }
  };
}
