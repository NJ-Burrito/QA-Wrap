# QA Wrap distribution: free markets, who clicks what

Checked 2026-10-23 from each market's own page. Status column updated 2026-10-23. Logins, `npm publish` and submits are Nader's clicks; ready texts are in `docs/listings/`. "Cost" is what the page said, not a guess; "not verified" means the page did not say.

## Order

1. Publish `qa-wrap-bridge` 0.1.0 to npm (`npm view qa-wrap-bridge version` answers 404 today). 2. Official MCP Registry (needs 1). 3. Other MCP directories (need the public repo; most want the npm name). 4. Extension stores, independent of the rest.

## MCP server `qa-wrap-bridge`

Files: `helper/package.json` (`mcpName`, `repository`, `keywords` added), `helper/server.json` (validated against the 2025-12-11 schema), `helper/glama.json`, `helper/smithery.yaml`. Shared text: `docs/listings/mcp-common.md`.

| Market | URL | Cost | What Nader clicks | Paste / file | Status |
|---|---|---|---|---|---|
| npm | https://www.npmjs.com | free (not re-read today) | `cd helper && npm login && npm publish` | `helper/package.json` | live 2026-10-23: qa-wrap-bridge 0.1.0 |
| Official MCP Registry | https://registry.modelcontextprotocol.io | no fee on its pages (not stated either way) | `mcp-publisher login github`, `mcp-publisher publish` in `helper/` | `official-mcp-registry.md`, `helper/server.json` | live 2026-10-23: io.github.NJ-Burrito/qa-wrap-bridge 0.1.0 |
| mcpservers.org | https://mcpservers.org/submit | Free tier "$0, review within 2 weeks"; $39 premium skipped | fill the form, plan Free | `mcpservers-org.md` | submitted 2026-10-23, Free plan; page said review within 2 weeks (awaiting approval) |
| awesome-mcp-servers (punkpeye) | https://github.com/punkpeye/awesome-mcp-servers | free (a pull request) | fork, add one line, open PR | `awesome-mcp-servers.md` | PR open: https://github.com/punkpeye/awesome-mcp-servers/pull/17378 |
| Cline MCP marketplace | https://github.com/cline/mcp-marketplace | no fee mentioned | open the submission issue | `cline.md` | issue open: https://github.com/cline/mcp-marketplace/issues/3206 |
| Glama | https://glama.ai/mcp/servers | not verified | sign in with GitHub, "Add Server", claim | `glama.md`, `helper/glama.json` | needs Nader's login (GitHub sign-in) |
| Smithery | https://smithery.ai | not verified | `smithery auth login`, then `smithery mcp publish` | `smithery.md`, `helper/smithery.yaml` | needs Nader's login (`smithery auth login`) |
| mcp.directory | https://mcp.directory/submit | not verified; review "within 24 hours" | fill the form if it shows no payment step | `mcp-directory.md` | submitted 2026-10-23, no payment step; page said published within 24 hours |

Skipped, with the reason:

| Market | Reason |
|---|---|
| mcp.so | Paid before (Nader, 2026-10-23); its pricing page lists only sponsor tiers, so a free submit is not verified. Skipped, as for Profile-Wrap. |
| PulseMCP | https://www.pulsemcp.com/submit reads "We are not accepting new MCP server or client submissions right now". |
| Docker MCP catalog | https://github.com/docker/mcp-registry needs a Dockerfile; the bridge must reach a browser's native messaging pipe on the host, which a container cannot. Not a fit. |
| LobeHub, mcprush | Submit page unreachable (LobeHub 403 on the submit page; mcprush 403, no search hits). Cost and path not verified. |
| wong2/awesome-mcp-servers | "We do not accept PRs"; covered by mcpservers.org. appcypher's list is archived. |

Honest limit: the bridge only answers while the QA Wrap extension is installed and "Agent bridge" is on, so any directory that auto-tests a server may see no tools. Every listing text names the four tools for that reason.

## Browser extension QA Wrap

Packs, texts (EN and AR) and images already exist; see `docs/listings/extension-stores.md`.

| Store | URL | Cost | What Nader clicks | Pack | Status |
|---|---|---|---|---|---|
| Microsoft Edge Add-ons | https://partner.microsoft.com/dashboard/microsoftedge/public/login | free: "There is no registration fee" (Microsoft Learn); review up to seven business days | follow `SUBMIT.md` steps 1 to 10 | `extension/store/edge/` | ready |
| Firefox AMO | https://addons.mozilla.org/developers/ | the pack states free; the Extension Workshop page does not state a fee | follow `SUBMIT.md` (needs the source submission) | `extension/store/firefox/` | ready |
| Opera add-ons | https://addons.opera.com/developer/upload/ | the pack states free; Opera's guidelines page does not state a fee | follow `SUBMIT.md` | `extension/store/opera/` | ready |
| Chrome Web Store | https://chrome.google.com/webstore/devconsole | not free: "one-time registration fee" (amount not on Google's page; 5 USD per search results, not verified) | skipped here | `extension/store/LISTING.md` | outside the free kit |
| Safari | https://developer.apple.com | paid Apple Developer Program (not verified from Apple's page) | skipped | none | not free |

## URL check

All URLs above were requested with `curl -sIL`: 200 except PulseMCP (403 to curl, closed per its page) and the Edge Partner Center login (401, a login wall).
