#!/usr/bin/env node
// qa-wrap-bridge: `npx qa-wrap-bridge` registers the native messaging host and prints the MCP snippet;
// `npx qa-wrap-bridge mcp` is the MCP server your agent starts; `uninstall` takes it all back out.
import { install, uninstall } from '../lib/install.mjs';

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'install';
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const extra = args.flatMap((a, i) => (a === '--extension-id' && args[i + 1] ? [args[i + 1]] : []));

const HELP = `qa-wrap-bridge

  npx qa-wrap-bridge                 register the host for Chrome and Edge, print the MCP config
  npx qa-wrap-bridge install [--extension-id <id>]   same; --extension-id adds another QA Wrap id (e.g. the Edge store build)
  npx qa-wrap-bridge uninstall       remove the host registration and the local folder
  npx qa-wrap-bridge mcp             the MCP server (your agent starts this; it talks over stdio)
`;

if (cmd === 'mcp') {
  const { runMcp } = await import('../lib/mcp.mjs');
  await runMcp();
} else if (cmd === 'uninstall') {
  const { removed } = uninstall();
  console.log(`Removed:\n${removed.map((r) => `  ${r}`).join('\n')}`);
} else if (cmd === 'install') {
  if (flag('--extension-id') !== undefined && !/^[a-p]{32}$/.test(flag('--extension-id'))) { console.error('--extension-id must be the 32-letter id from chrome://extensions'); process.exit(2); }
  const r = install({ extraIds: extra });
  console.log(`QA Wrap bridge host registered.\n${r.written.map((w) => `  ${w}`).join('\n')}\n`);
  console.log('Next:\n  1. In QA Wrap, open Settings and turn on "Agent bridge" (Chrome asks for one permission).\n  2. Add the MCP server to your agent:\n');
  console.log(`  Claude Code:\n    ${r.snippets.claudeCode}\n`);
  console.log(`  Cursor (.cursor/mcp.json) or any MCP client (.mcp.json):\n${r.snippets.json.split('\n').map((l) => `    ${l}`).join('\n')}\n`);
  console.log('The bridge can only read. It cannot start or change a session, and it never opens a network connection.');
} else {
  console.log(HELP);
  process.exit(cmd === 'help' || args.includes('--help') ? 0 : 2);
}
