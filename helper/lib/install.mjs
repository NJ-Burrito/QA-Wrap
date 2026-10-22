// `npx qa-wrap-bridge` (install): copy the host to a stable folder, write the native messaging host manifest for Chrome and
// Edge on this OS, and print the MCP config snippet. Every OS-specific thing is a parameter so a test can run all three.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST_NAME, EXTENSION_ID, homeDir, tokenFile } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, '..');
const HOST_FILES = ['bin/host-main.mjs', 'lib/framing.mjs', 'lib/host.mjs', 'lib/paths.mjs'];

/** Where each browser looks for host manifests (macOS and Linux). Windows uses the registry instead. */
export function manifestDirs(platform, home) {
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [['chrome', path.join(base, 'Google', 'Chrome', 'NativeMessagingHosts')], ['edge', path.join(base, 'Microsoft Edge', 'NativeMessagingHosts')]];
  }
  if (platform === 'linux') {
    return [['chrome', path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts')], ['edge', path.join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts')]];
  }
  return [];
}

export const REG_KEYS = Object.freeze({
  chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
});

export function hostManifest(launcher, ids) {
  return {
    name: HOST_NAME,
    description: 'QA Wrap agent bridge (read-only)',
    path: launcher,
    type: 'stdio',
    allowed_origins: [...new Set(ids)].map((id) => `chrome-extension://${id}/`),
  };
}

/** S-04: the snippet pins the exact version, so a later release (or a take-over of the name) is never run by an agent start. */
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;

export function mcpSnippets(platform) {
  const win = platform === 'win32';
  const pkg = `qa-wrap-bridge@${VERSION}`;
  const cmd = win ? ['cmd', '/c', 'npx', '-y', pkg, 'mcp'] : ['npx', '-y', pkg, 'mcp'];
  return {
    claudeCode: `claude mcp add qa-wrap -- ${cmd.join(' ')}`,
    json: JSON.stringify({ mcpServers: { 'qa-wrap': { command: cmd[0], args: cmd.slice(1) } } }, null, 2),
  };
}

const defaultReg = (key, value) => execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'ignore' });
const defaultRegDelete = (key) => { try { execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' }); } catch { /* it was not there */ } };

/**
 * @param {{ platform?: string, home?: string, env?: NodeJS.ProcessEnv, nodePath?: string, extraIds?: string[], regAdd?: Function, srcDir?: string }} [o]
 */
export function install({ platform = process.platform, home = os.homedir(), env = process.env, nodePath = process.execPath, extraIds = [], regAdd = defaultReg, srcDir = PKG } = {}) {
  const root = homeDir({ ...env, ...(env.QA_WRAP_BRIDGE_HOME ? {} : { QA_WRAP_BRIDGE_HOME: path.join(home, '.qa-wrap-bridge') }) });
  const hostDir = path.join(root, 'host');
  const existed = fs.existsSync(hostDir);
  fs.mkdirSync(hostDir, { recursive: true, mode: 0o700 });
  // R-03: a folder created here is made private regardless of the user's umask (Ubuntu and Debian default to 002); only a folder the user already had is judged below.
  if (!existed && process.platform !== 'win32') { fs.chmodSync(root, 0o700); fs.chmodSync(hostDir, 0o700); }
  // S-04: the launcher in this folder is run by Chrome on every native connect; a folder other users can write to is refused.
  if (process.platform !== 'win32' && (fs.statSync(hostDir).mode & 0o022)) throw new Error(`${hostDir} is writable by group or others; run chmod go-w on it and try again.`);
  for (const f of HOST_FILES) {
    fs.mkdirSync(path.dirname(path.join(hostDir, f)), { recursive: true });
    fs.copyFileSync(path.join(srcDir, f), path.join(hostDir, f));
  }
  // The shared secret: only the owner can read it, and the MCP server and the host are the two readers.
  const token = tokenFile({ QA_WRAP_BRIDGE_HOME: root });
  if (!fs.existsSync(token)) fs.writeFileSync(token, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
  // Windows ignores mode 0o600 (S-11): drop inherited rights and leave the file to the current user alone. Best effort, like the chmod.
  if (process.platform === 'win32') { try { execFileSync('icacls', [token, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'ignore' }); } catch { /* the folder is already under the user's profile */ } }

  const main = path.join(hostDir, 'bin', 'host-main.mjs');
  const win = platform === 'win32';
  const launcher = path.join(hostDir, win ? 'qa-wrap-bridge-host.cmd' : 'qa-wrap-bridge-host.sh');
  fs.writeFileSync(launcher, win ? `@echo off\r\n"${nodePath}" "${main}" %*\r\n` : `#!/bin/sh\nexec "${nodePath}" "${main}" "$@"\n`, { mode: 0o755 });

  const manifest = hostManifest(launcher, [EXTENSION_ID, ...extraIds]);
  const written = [];
  if (win) {
    const file = path.join(hostDir, `${HOST_NAME}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    for (const [browser, key] of Object.entries(REG_KEYS)) { regAdd(key, file); written.push(`${browser}: ${key} -> ${file}`); }
  } else {
    for (const [browser, dir] of manifestDirs(platform, home)) {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${HOST_NAME}.json`);
      fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
      written.push(`${browser}: ${file}`);
    }
  }
  return { root, launcher, manifest, written, snippets: mcpSnippets(platform) };
}

export function uninstall({ platform = process.platform, home = os.homedir(), env = process.env, regDelete = defaultRegDelete } = {}) {
  const root = homeDir({ ...env, ...(env.QA_WRAP_BRIDGE_HOME ? {} : { QA_WRAP_BRIDGE_HOME: path.join(home, '.qa-wrap-bridge') }) });
  const removed = [];
  if (platform === 'win32') for (const key of Object.values(REG_KEYS)) { regDelete(key); removed.push(key); }
  else for (const [, dir] of manifestDirs(platform, home)) { const f = path.join(dir, `${HOST_NAME}.json`); if (fs.existsSync(f)) { fs.rmSync(f); removed.push(f); } }
  fs.rmSync(root, { recursive: true, force: true });
  removed.push(root);
  return { removed };
}
