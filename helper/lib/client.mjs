// The MCP server's side of the local socket: one question out, one answer back. Local socket only.
// The token never travels: a nonce goes out, the host proves it holds the token, and only then does this side send its own proof with the question.
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { socketPath as defaultSocket, tokenFile } from './paths.mjs';

export const NOT_CONNECTED = 'QA Wrap is not connected. Open Chrome or Edge with QA Wrap installed, and turn on "Agent bridge" in QA Wrap Settings. Then try again.';

const mac = (token, who, nc, nh) => crypto.createHmac('sha256', token).update(`${who}|${nc}|${nh}`).digest('hex');
const sameMac = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function readToken(env = process.env) {
  try { return fs.readFileSync(tokenFile(env), 'utf8').trim(); } catch { return ''; }
}

/** @returns {Promise<string>} the answer text, or rejects with a sentence a person can act on */
export function ask(tool, args = {}, { socket = defaultSocket(), token = readToken(), timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const nc = crypto.randomBytes(16).toString('hex');
    let buf = '';
    let done = false;
    let sent = false;
    const sock = net.connect(socket);
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); fn(v); };
    const timer = setTimeout(() => end(reject, new Error('QA Wrap did not answer in time.')), timeoutMs);
    sock.setEncoding('utf8');
    sock.once('connect', () => sock.write(`${JSON.stringify({ hello: nc })}\n`));
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (!sent) {
          // The host speaks first only to prove it holds the same key. A wrong proof ends it before any question is sent.
          if (m.hello !== true || !token || !sameMac(m.proof ?? '', mac(token, 'host', nc, String(m.nonce)))) return end(reject, new Error(m.error === 'bad token' ? 'bad token: the bridge host refused this key' : 'bad token: the bridge host does not hold this key'));
          sent = true;
          sock.write(`${JSON.stringify({ id, auth: mac(token, 'client', nc, String(m.nonce)), tool, args })}\n`);
          return;
        }
        if (m.ok === true && typeof m.result === 'string') end(resolve, m.result);
        else end(reject, new Error(String(m.error || 'QA Wrap could not answer.')));
      } catch { end(reject, new Error('The bridge host sent something unreadable.')); }
    });
    sock.once('error', () => end(reject, new Error(NOT_CONNECTED)));
    sock.once('close', () => end(reject, new Error('The bridge host closed the connection.')));
  });
}
