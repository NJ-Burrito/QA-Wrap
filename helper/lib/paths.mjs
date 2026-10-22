import os from 'node:os';
import path from 'node:path';

export const HOST_NAME = 'com.qawrap.bridge';

/** The extension's id, derived from the public key in extension/manifest.json (a test pins the two together). */
export const EXTENSION_ID = 'dbdhilacpjeojfnmdbnpcbmohkhgaihn';

/** The four read-only questions, and the only ones the host forwards. */
export const TOOLS = Object.freeze(['list_sessions', 'get_session', 'get_failures', 'get_ai_brief']);

/** Where the installed copy of the host, its launcher and the shared secret live. */
export const homeDir = (env = process.env) => env.QA_WRAP_BRIDGE_HOME || path.join(os.homedir(), '.qa-wrap-bridge');

/** A local socket, never a TCP port: a named pipe on Windows, a unix socket elsewhere. */
export function socketPath(env = process.env, platform = process.platform) {
  if (env.QA_WRAP_BRIDGE_SOCKET) return env.QA_WRAP_BRIDGE_SOCKET;
  const who = String(env.USERNAME || env.USER || os.userInfo().username || 'user').replace(/[^\w.-]/g, '_');
  // S-11: on Unix the socket sits in the owner's bridge folder (mode 0700), never in a shared temp directory.
  return platform === 'win32' ? `\\\\.\\pipe\\qa-wrap-bridge-${who}` : path.join(homeDir(env), 'bridge.sock');
}

export const tokenFile = (env = process.env) => path.join(homeDir(env), 'token');
