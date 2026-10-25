# qa-wrap-bridge: shared listing text (English)

Source of every MCP listing in this folder. Facts come from `helper/README.md` and `helper/package.json`. Paste as is; trim to a form's limit by dropping the last paragraph first.

## Name

QA Wrap bridge (npm package `qa-wrap-bridge`, registry name `io.github.NJ-Burrito/qa-wrap-bridge`)

## Short description (89 characters; the registry schema allows up to 100)

Read-only MCP server: a coding agent reads test sessions recorded in QA Wrap. Local only.

## Long description

qa-wrap-bridge lets a coding agent (Claude Code, Cursor, any MCP client) read the test sessions recorded in QA Wrap, a free browser extension for testers.

Four tools, all marked read-only:

- `list_sessions`: the sessions on this machine, newest first.
- `get_session`: one session in the documented `qawrap.session/1` format.
- `get_failures`: only the failures of a session (failing requests and console errors, duplicates folded).
- `get_ai_brief`: the compact plain-text block that "Copy for AI" produces.

It cannot write, because no tool starts, changes, renames or deletes anything. It does not reach the network: the server talks to a local socket and opens no outgoing connection. Answers are built by the same function as QA Wrap's AI export, which masks passwords, tokens, keys, cards and credential-named URL parameters before the text leaves the extension.

It is optional and off until you turn "Agent bridge" on in QA Wrap's Settings. It needs Node 20 or newer, the QA Wrap extension (Chrome or Edge) and a one-time `npx qa-wrap-bridge` to register the native messaging host.

## Install line

```
claude mcp add qa-wrap -- npx -y qa-wrap-bridge@0.1.0 mcp
```

## Links

- Repository: https://github.com/NJ-Burrito/QA-Wrap (folder `helper/`)
- Product page: https://nj-burrito.github.io/QA-Wrap/
- Setup guide: https://github.com/NJ-Burrito/QA-Wrap/blob/main/helper/README.md
- Issues: https://github.com/NJ-Burrito/QA-Wrap/issues

## Tags

mcp, qa, testing, bug-report, browser-extension, developer-tools, read-only, local

## Arabic

No MCP directory in this kit shows an Arabic field, so there is no Arabic MCP text. The Arabic store texts for the extension are in `extension/store/edge/listing.ar.md` and `extension/store/firefox/listing.ar.md`.
