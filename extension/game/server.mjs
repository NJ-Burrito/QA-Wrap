/* QA Wrap Bug Hunt - the local game server (lane B). Static only, 127.0.0.1 only, no CORS, no request body is ever read.
 * Contract: work/sdlc/design/DESIGN-bug-hunt.md s8. `npm run game` (from extension/) prints one line and serves http://localhost:4173/.
 * The origin is exact on purpose (the extension's session grant is for http://localhost:4173/): NO port fallback.
 *
 *   createGameServer({ port, onRequest, payDelayMs })  -> node:http Server (not listening yet)
 *   onRequest({ method, url, contentLength })           -> lets a test assert every request body length is 0
 *   audioRoot                                           -> test hook: where /audio/** is read from (default game/audio)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GAME_PORT = 4173;
export const GAME_URL = `http://localhost:${GAME_PORT}/`;
export const PAY_DELAY_MS = 4000;

const here = path.dirname(fileURLToPath(import.meta.url));   // extension/game
const extRoot = path.dirname(here);                           // extension
const audioDir = path.join(here, 'audio');

export const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src data:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-ancestors 'none'";

/* Exact paths that map to a fixed file. Everything else is 404 (an allow-list, never a directory server). */
const FIXED = new Map([
  ['/', path.join(here, 'index.html')],
  ['/index.html', path.join(here, 'index.html')],
  ['/game.css', path.join(here, 'game.css')],
  ['/shop.css', path.join(here, 'shop.css')],
  ['/game.js', path.join(here, 'game.js')],
  ['/engine.js', path.join(here, 'engine.js')],
  ['/scoring.js', path.join(here, 'scoring.js')],
  ['/scoring.json', path.join(here, 'scoring.json')],
  ['/trial.js', path.join(here, 'trial.js')],        // hard trials 6-7 (lane T1)
  ['/trial-ui.js', path.join(here, 'trial-ui.js')],  // lane T2
  ['/trial.css', path.join(here, 'trial.css')],      // lane T2
  ['/features.json', path.join(here, 'features.json')],
  ['/ui/fonts.css', path.join(extRoot, 'ui', 'fonts.css')],
  ['/brand/mark.svg', path.join(extRoot, 'brand', 'mark.svg')],
  ['/brand/mark-motion.svg', path.join(extRoot, 'brand', 'mark-motion.svg')],
]);
const LEVEL_RE = /^\/levels\/(l[1-5])\.js$/;
const STRINGS_RE = /^\/strings\/(en|ar)\.json$/;
const TRIALS_RE = /^\/trials\/(t[67]|attune)\.js$/;
/* The trial's own files may be cached for 30 s so a death restart (a page reload) stays under a second; every other file stays no-store. */
const TRIAL_CACHED_RE = /^\/(?:trial\.js|trial-ui\.js|trial\.css|trials\/(?:t[67]|attune)\.js)$/;
const ORDERS_RE = /^\/api\/orders\/[A-Za-z0-9_-]{1,32}$/;

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Host header check (DNS rebinding): only the loopback names are served, on any port. */
function hostOk(hostHeader) {
  if (!hostHeader) return true;
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(String(hostHeader).trim().toLowerCase());
  return !!m && HOSTS.has(m[1]);
}

/** Resolve a pathname to a real file inside the allow-list, or null. */
function resolveStatic(pathname, audioRoot) {
  if (FIXED.has(pathname)) return FIXED.get(pathname);
  if (TRIALS_RE.test(pathname)) return path.join(here, 'trials', pathname.slice('/trials/'.length));
  if (LEVEL_RE.test(pathname)) return path.join(here, 'levels', pathname.slice('/levels/'.length));
  if (STRINGS_RE.test(pathname)) return path.join(here, 'strings', pathname.slice('/strings/'.length));
  if (pathname.startsWith('/audio/')) {
    let dec;
    try { dec = decodeURIComponent(pathname.slice('/audio/'.length)); } catch { return null; }
    if (!dec || /[\\:\0]/.test(dec)) return null;
    const parts = dec.split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null;
    const full = path.join(audioRoot, ...parts);
    if (!full.startsWith(audioRoot + path.sep)) return null;
    return full;
  }
  return null;
}

function baseHeaders(extra = {}) {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function send(res, status, body, extra = {}) {
  const buf = Buffer.from(body);
  res.writeHead(status, baseHeaders({ 'Content-Length': buf.length, ...extra }));
  res.end(buf);
}

export function createGameServer({ port = GAME_PORT, onRequest, payDelayMs = PAY_DELAY_MS, audioRoot = audioDir } = {}) {
  audioRoot = path.resolve(audioRoot);
  void port; // the caller listens; the value is kept in the signature for the contract
  const runNonce = randomBytes(16).toString('hex'); // S-13: one per server run, written into the page; the extension bridge talks only to a page that carries one
  const timers = new Set();
  const server = http.createServer((req, res) => {
    req.resume(); // the body is never read: the planted routes take none, and nothing here stores one
    const method = req.method || 'GET';
    const te = String(req.headers['transfer-encoding'] || '');
    const contentLength = /chunked/i.test(te) ? -1 : Number(req.headers['content-length'] || 0);
    if (typeof onRequest === 'function') { try { onRequest({ method, url: req.url, contentLength }); } catch { /* a test hook must not break serving */ } }
    if (!hostOk(req.headers.host)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });

    let pathname;
    // origin-form targets only ("/x"): "//host/x" and absolute URLs are not parsed as a different host
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' }); }
    const json = { 'Content-Type': 'application/json; charset=utf-8' };

    // ---- planted routes (method fixed)
    if (pathname === '/api/save-profile') {
      if (method !== 'POST') return send(res, 405, '{"error":"method"}', { ...json, Allow: 'POST' });
      return send(res, 500, '{"ok":false,"error":"save failed"}', json);
    }
    if (pathname === '/api/pay') {
      if (method !== 'POST') return send(res, 405, '{"error":"method"}', { ...json, Allow: 'POST' });
      const timer = setTimeout(() => { timers.delete(timer); if (!res.writableEnded && !res.destroyed) send(res, 200, '{"ok":true}', json); }, payDelayMs);
      timers.add(timer);
      res.on('close', () => { clearTimeout(timer); timers.delete(timer); });
      return undefined;
    }
    if (pathname === '/api/coupons') {
      if (method !== 'GET') return send(res, 405, '{"error":"method"}', { ...json, Allow: 'GET' });
      return send(res, 404, '{"error":"no such table"}', json);
    }

    // ---- planted routes of the hard trials (immediate, method fixed, the body is never read)
    const planted = pathname === '/api/sync' ? ['POST', 503, '{"ok":false,"error":"sync unavailable"}']
      : pathname === '/api/telemetry' ? ['POST', 500, '{"ok":false,"error":"telemetry failed"}']
        : pathname === '/api/checkout' ? ['POST', 500, '{"ok":false,"error":"payment failed"}']
          : ORDERS_RE.test(pathname) ? ['POST', 503, '{"ok":false,"error":"kitchen offline"}']
            : pathname === '/api/menu' ? ['GET', 404, '{"error":"no such menu"}'] : null;
    if (planted) {
      if (method !== planted[0]) return send(res, 405, '{"error":"method"}', { ...json, Allow: planted[0] });
      return send(res, planted[1], planted[2], json);
    }

    // ---- static allow-list
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    const file = resolveStatic(pathname, audioRoot);
    if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      if (file === FIXED.get('/')) {
        return fs.readFile(file, 'utf8', (e2, html) => {
          if (e2) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
          const buf = Buffer.from(html.replace('__QAW_RUN__', runNonce));
          res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Content-Length': buf.length }));
          return res.end(method === 'HEAD' ? undefined : buf);
        });
      }
      res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Content-Length': st.size, ...(TRIAL_CACHED_RE.test(pathname) ? { 'Cache-Control': 'max-age=30' } : {}) }));
      if (method === 'HEAD') return res.end();
      const rs = fs.createReadStream(file);
      rs.on('error', () => res.destroy());
      rs.pipe(res);
      return undefined;
    });
    return undefined;
  });
  server.on('close', () => { for (const t of timers) clearTimeout(t); timers.clear(); });
  return server;
}

/* ---- CLI: `node game/server.mjs` (npm run game). One line out, loopback only, no port fallback. */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.BUG_HUNT_PORT) || GAME_PORT; // the env override exists for tests; the product port is 4173
  const server = createGameServer({ port });
  server.on('error', (err) => {
    console.error(err && err.code === 'EADDRINUSE'
      ? `Bug Hunt: port ${port} is busy. Close the other program using it and run again (the port cannot change).`
      : `Bug Hunt: could not start (${err && err.message}).`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => { console.log(`Bug Hunt: http://localhost:${port}/`); });
  const stop = () => { server.close(() => process.exit(0)); if (server.closeAllConnections) server.closeAllConnections(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
