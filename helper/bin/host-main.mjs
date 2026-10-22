// Started by Chrome or Edge (through the launcher `install` writes). Node built-ins only: this file is copied out of the npx cache.
import fs from 'node:fs';
import { runHost } from '../lib/host.mjs';
import { socketPath, tokenFile } from '../lib/paths.mjs';

let token = '';
try { token = fs.readFileSync(tokenFile(), 'utf8').trim(); } catch { /* no token: every request is refused */ }
const { ready } = runHost({ stdin: process.stdin, stdout: process.stdout, socketPath: socketPath(), token, log: (s) => process.stderr.write(`${s}\n`) });
ready.catch((e) => { process.stderr.write(`qa-wrap-bridge host: ${e.message}\n`); process.exit(1); });
process.stdin.on('end', () => setTimeout(() => process.exit(0), 50));
