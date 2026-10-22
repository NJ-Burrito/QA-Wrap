// The native messaging host: Chrome starts it, talks to it on stdin/stdout, and it serves ONE local socket for the MCP server.
//
//   MCP server --(nonce, then a proof of the key)--> socket --> this host --(framed JSON)--> extension
//   MCP server <--(JSON line)--------- socket <-- this host <--(framed JSON)-- extension
//
// What it will not do: listen on TCP, open any outbound connection, forward a tool that is not in TOOLS, or forward anything
// without proof of the token. The token itself never crosses the socket: the client sends a nonce, the host answers with its own nonce and
// HMAC(token, "host"|nonces), the client checks it (so a squatter on the name learns nothing and is refused), and only then sends its
// HMAC(token, "client"|nonces) with the request. It carries questions to the extension and answers back. It has no way to write.
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { encode, decoder } from './framing.mjs';
import { TOOLS } from './paths.mjs';

const ARG_KEYS = new Set(['session_id', 'limit']);
const SESSION_ID = /^[\w-]{1,64}$/;

/** Arguments the extension may be asked with; anything else is refused here, before it leaves this process. */
export function cleanArgs(args) {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (!ARG_KEYS.has(k)) throw new Error(`unknown argument ${k}`);
    if (k === 'session_id' && v != null) { if (typeof v !== 'string' || !SESSION_ID.test(v)) throw new Error('session_id is not valid'); out.session_id = v; }
    if (k === 'limit' && v != null) { if (!Number.isInteger(v) || v < 1 || v > 200) throw new Error('limit must be 1 to 200'); out.limit = v; }
  }
  return out;
}

const NONCE = /^[0-9a-f]{16,64}$/;
const mac = (token, who, nc, nh) => crypto.createHmac('sha256', token).update(`${who}|${nc}|${nh}`).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/**
 * @param {{ stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, socketPath: string, token: string, timeoutMs?: number, log?: (s: string) => void }} o
 */
export function runHost({ stdin, stdout, socketPath, token, timeoutMs = 20000, log = () => {} }) {
  const pending = new Map();
  let seq = 0;
  let closed = false;

  const reply = (sock, obj) => { if (!sock.destroyed) sock.write(`${JSON.stringify(obj)}\n`); };

  function handle(sock, line, chal) {
    let req;
    try { req = JSON.parse(line); } catch { return reply(sock, { ok: false, error: 'not JSON' }); }
    const id = req?.id;
    if (typeof req?.hello === 'string') {
      if (!token || !NONCE.test(req.hello)) return reply(sock, { ok: false, error: 'bad token' });
      chal.nc = req.hello;
      chal.nh = crypto.randomBytes(16).toString('hex');
      return reply(sock, { hello: true, nonce: chal.nh, proof: mac(token, 'host', chal.nc, chal.nh) });
    }
    if (!token || !chal.nc || !same(req?.auth ?? '', mac(token, 'client', chal.nc, chal.nh))) return reply(sock, { id, ok: false, error: 'bad token' });
    if (!TOOLS.includes(req.tool)) return reply(sock, { id, ok: false, error: `unknown tool ${String(req.tool).slice(0, 40)}` });
    let args;
    try { args = cleanArgs(req.args); } catch (e) { return reply(sock, { id, ok: false, error: e.message }); }
    const hostId = ++seq;
    const timer = setTimeout(() => { pending.delete(hostId); reply(sock, { id, ok: false, error: 'QA Wrap did not answer in time.' }); }, timeoutMs);
    pending.set(hostId, { sock, id, timer });
    try { stdout.write(encode({ id: hostId, tool: req.tool, args })); } catch (e) { clearTimeout(timer); pending.delete(hostId); reply(sock, { id, ok: false, error: e.message }); }
  }

  const server = net.createServer((sock) => {
    let buf = '';
    const chal = { nc: '', nh: '' };
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > 16384) return sock.destroy();
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handle(sock, line, chal); }
    });
    sock.on('error', () => {});
    sock.on('close', () => { for (const [k, p] of pending) if (p.sock === sock) { clearTimeout(p.timer); pending.delete(k); } });
  });

  stdin.on('data', decoder((m) => {
    const p = pending.get(m?.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (m.ok === true && typeof m.result === 'string') reply(p.sock, { id: p.id, ok: true, result: m.result });
    else reply(p.sock, { id: p.id, ok: false, error: typeof m.error === 'string' ? m.error.slice(0, 300) : 'QA Wrap could not answer.' });
  }, (e) => log(`bad frame from the browser: ${e.message}`)));

  const close = () => {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); reply(p.sock, { id: p.id, ok: false, error: 'QA Wrap disconnected.' }); }
    pending.clear();
    server.close();
    if (!socketPath.startsWith('\\\\')) { try { fs.unlinkSync(socketPath); } catch { /* already gone */ } }
  };
  stdin.on('end', close);
  stdin.on('close', close);

  const ready = new Promise((resolve, reject) => {
    const go = () => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        if (!socketPath.startsWith('\\\\')) { try { fs.chmodSync(socketPath, 0o600); } catch { /* best effort */ } }
        resolve();
      });
    };
    // A socket file left by a host that was killed: if nobody answers on it, it is stale.
    if (socketPath.startsWith('\\\\') || !fs.existsSync(socketPath)) return go();
    const probe = net.connect(socketPath);
    probe.once('connect', () => { probe.destroy(); reject(Object.assign(new Error('another QA Wrap bridge host is already running'), { code: 'EADDRINUSE' })); });
    probe.once('error', () => { try { fs.unlinkSync(socketPath); } catch { /* raced */ } go(); });
  });
  return { server, ready, close };
}
