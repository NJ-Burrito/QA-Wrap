/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Read-only Chrome Web Store status (T-074): `fetchStatus` of Chrome Web Store API v2, nothing else.
 *
 *   node tools/store-status.mjs
 *
 * Credentials live only in ~/.config/qa-wrap/chromewebstore.env (never in the repo):
 *   CWS_PUBLISHER_ID, CWS_ITEM_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
 * This tool has no upload, publish, cancel or rollout call and CI never runs it. The write calls
 * (upload, publish, setPublishedDeployPercentage) are the owner's, by hand, per store/CHECKLIST.md.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_FILE = path.join(os.homedir(), '.config', 'qa-wrap', 'chromewebstore.env');
export const NEEDED = ['CWS_PUBLISHER_ID', 'CWS_ITEM_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];

export const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]));

export const statusUrl = (e) =>
  `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(e.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(e.CWS_ITEM_ID)}:fetchStatus`;

export const missing = (e) => NEEDED.filter((k) => !e[k]);

async function main() {
  if (!fs.existsSync(ENV_FILE)) { console.error(`no ${ENV_FILE} — see work/delivery/owner/T-074-vendor-risk.md`); process.exit(2); }
  const env = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
  const gone = missing(env);
  if (gone.length) { console.error(`${ENV_FILE} lacks: ${gone.join(', ')}`); process.exit(2); }
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET, refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!tok.ok) { console.error(`token request failed: HTTP ${tok.status}`); process.exit(1); }
  const res = await fetch(statusUrl(env), { headers: { authorization: `Bearer ${(await tok.json()).access_token}` } });
  const body = await res.text();
  if (!res.ok) { console.error(`fetchStatus failed: HTTP ${res.status}\n${body}`); process.exit(1); }
  console.log(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
