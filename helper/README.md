# qa-wrap-bridge

Lets a coding agent (Claude Code, Cursor, any MCP client) **read** the test sessions recorded in QA Wrap.

It is a small Node program with two jobs:

- an **MCP server** (stdio) that your agent starts, and
- a **native messaging host** that Chrome or Edge starts, so the server can ask the QA Wrap extension for what it holds.

It is optional. QA Wrap works the same without it, and it is off until you turn **Agent bridge** on in QA Wrap's Settings.

## Set it up

1. Install the helper's registration, once, in a terminal:

   ```
   npx qa-wrap-bridge
   ```

   This copies the host to `~/.qa-wrap-bridge/host/`, writes the native messaging host manifest for **Chrome and Edge** (the registry on Windows, the browsers' `NativeMessagingHosts` folders on macOS and Linux), creates a private key file next to it, and prints the config for your agent. Node 20 or newer is needed.

2. In QA Wrap open **Settings > Privacy** and turn on **Agent bridge**. The browser asks for one permission, `nativeMessaging`. QA Wrap asks for it only at that moment and hands it back when you turn the bridge off.

3. Tell your agent about the server. The command prints these for your system:

   Claude Code:

   ```
   claude mcp add qa-wrap -- npx -y qa-wrap-bridge@0.1.0 mcp
   ```

   Cursor (`.cursor/mcp.json`) or any client that reads `.mcp.json`:

   ```json
   { "mcpServers": { "qa-wrap": { "command": "npx", "args": ["-y", "qa-wrap-bridge", "mcp"] } } }
   ```

   On Windows the command is `cmd` with the arguments `/c npx -y qa-wrap-bridge@0.1.0 mcp`.

Using the Microsoft Edge Add-ons build of QA Wrap, whose extension id differs? Add it: `npx qa-wrap-bridge install --extension-id <the 32-letter id from edge://extensions>`.

To remove everything: `npx qa-wrap-bridge uninstall`.

## What the agent can ask

| Tool | Returns |
|---|---|
| `list_sessions` | the sessions on this machine, newest first: id, title, start and end, status, event and failure counts. Optional `limit`. |
| `get_session` | one session in the documented `qawrap.session/1` format ([`extension/docs/session-json.md`](../extension/docs/session-json.md)). Optional `session_id`; the newest session if omitted. |
| `get_failures` | only the failures of a session (failing requests and console errors, duplicates folded with a count). |
| `get_ai_brief` | the compact plain-text block that "Copy for AI" produces. |

All four are marked read-only in MCP.

## What it can never do

- **Write.** There is no tool that starts, changes, renames or deletes anything. The host forwards only the four names above, and the extension answers them from code that has no write call in it. A test pins both.
- **Reach the network.** The host listens on a local pipe (Windows) or a unix socket (macOS, Linux), never on a TCP port, and opens no outgoing connection. A test fails if the source mentions an HTTP, TLS, UDP or WebSocket module.
- **Be used by another program on the machine.** The key in `~/.qa-wrap-bridge/token` (readable by your user only; on Windows the installer limits it to you with `icacls`) never crosses the socket: the server and the host each prove they hold it with a one-time challenge before a question is sent, so a program that took over the socket name learns nothing. The socket is `0600` on macOS and Linux.
- **Leak what masking removed.** Answers are built by the same function as QA Wrap's AI export, which masks passwords, tokens, keys, cards and credential-named URL parameters before the text leaves the extension. Request and response bodies are never included in full. Anything the extension cannot fit in the browser's 1 MiB limit is shortened and says so.

What your agent does with the text it receives, including sending it to a model, is the agent's behaviour. Turn the bridge on only for an agent you trust with your test data.

## How the pieces talk

```
agent --stdio--> qa-wrap-bridge mcp --local socket--> host (started by the browser) --native messaging--> QA Wrap extension
```

The extension keeps the native port open only while the bridge is on **and** the permission is granted. If the browser is closed or the bridge is off, a tool call answers with a sentence saying QA Wrap is not connected.

Only one browser at a time can hold the host (the second one's host exits because the socket is taken).

## Development

```
npm install
npm test
```

`npm test` runs the real host as a child process against a fake browser port, the MCP server through the official client, and the installer for Windows, macOS and Linux against temporary folders. The extension's `node tools/test-agent-bridge.mjs` runs it too, and tests the extension's side.
